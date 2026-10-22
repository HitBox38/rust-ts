// Port of compiler/rustc_borrowck/src/type_check/input_output.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
//! This module contains code to equate the input/output types appearing
//! in the MIR with the expected input/output types from the function
//! signature. This requires a bit of processing, as the expected types
//! are supplied to us before normalization and may contain opaque
//! `impl Trait` instances. In contrast, the input/output types found in
//! the MIR (specifically, in the special local variables for the
//! `RETURN_PLACE` the MIR arguments) are always fully normalized (and
//! contain revealed `impl Trait` values).
//
// PORT: `span_mirbug!` (type_check/mod.rs:53) is the module-local helper `span_mirbug`; `#[instrument]` / `debug!` stay
// comments (tracing is off in the oracle); `zip_eq` is an explicit length check (itertools' panic message).
import { type CoroutineKind, debug_CoroutineKind } from "../../rustc_hir/hir.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.ts";
import { ConstraintCategory, debug_Location, Local, Location, RETURN_PLACE } from "../../rustc_middle/mir/mod.ts";
import { UserType } from "../../rustc_middle/ty/typeck_results.ts";
import { RegionCtxt } from "../renumber.gen.ts";
import { debug_NoSolution } from "../../rustc_middle/traits/query.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { Normalizable_Ty } from "../../rustc_trait_selection/traits/query/type_op/normalize.ts";
import { debug_DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { fold_Binder } from "../../rustc_type_ir/binder.ts";
import { CoroutineArgs, CoroutineClosureArgs, CoroutineClosureSignature } from "../../rustc_type_ir/ty_kind/closure.ts";
import { fold_FnSig, FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { debug_option, PLAIN } from "../../std/fmt.ts";
import { panic, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { Locations, mirbug, NormalizeLocation_Locations, TypeChecker } from "./mod.ts";

declare module "./mod.ts" {
  interface TypeChecker {
    // input_output.rs:28
    check_signature_annotation(): void;
    // input_output.rs:163
    equate_inputs_and_outputs(normalized_inputs_and_output: readonly Ty[]): void;
    // input_output.rs:216
    equate_normalized_input_or_output(a: Ty, b: Ty, span: Span): void;
  }
}

/** `span_mirbug!(self, elem, ..)` (type_check/mod.rs:53): `mirbug(tcx, last_span, "broken MIR in {def_id:?} ({elem:?}): {msg}")`. */
function span_mirbug(self: TypeChecker, elem: Location, msg: string): void {
  mirbug(self.tcx(), self.last_span, `broken MIR in ${debug_DefId(self.body_().source.def_id(), PLAIN)} (${debug_Location(elem, PLAIN)}): ${msg}`);
}

/** The `assert_matches!` pattern of `check_signature_annotation`. */
function is_async_or_gen_closure_coroutine(k: CoroutineKind | undefined): boolean {
  return k !== undefined && k.$ === "Desugared" && (k._0 === "Async" || k._0 === "Gen") && k._1 === "Closure";
}

// ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> ----

/// Check explicit closure signature annotation,
/// e.g., `|x: FxIndexMap<_, &'static u32>| ...`.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/input_output.rs:28 check_signature_annotation
TypeChecker.prototype.check_signature_annotation = function (this: TypeChecker): void {
  const mir_def_id = this.body.source.def_id().expect_local();

  if (!this.tcx().is_closure_like(LocalDefId.to_def_id(mir_def_id))) {
    return;
  }

  // If the MIR body was constructed via `construct_error` (because an
  // earlier pass like match checking failed), its args may not match
  // the user-provided signature (e.g. a coroutine with too many
  // parameters). Bail out as this can cause panic,
  // see <https://github.com/rust-lang/rust/issues/139570>.
  if (this.body.tainted_by_errors !== undefined) {
    return;
  }

  const user_provided_poly_sig = this.tcx().closure_user_provided_sig(mir_def_id);

  // Instantiate the canonicalized variables from user-provided signature
  // (e.g., the `_` in the code above) with fresh variables.
  // Then replace the bound items in the fn sig with fresh variables,
  // so that they represent the view from "inside" the closure.
  const user_provided_sig0 = this.instantiate_canonical(this.body.span, user_provided_poly_sig, fold_Binder(fold_FnSig));
  let user_provided_sig = this.infcx.instantiate_binder_with_fresh_vars(this.body.span, BoundRegionConversionTime.FnCall, user_provided_sig0, fold_FnSig);

  // FIXME(async_closures): It's kind of wacky that we must apply this
  // transformation here, since we do the same thing in HIR typeck.
  // Maybe we could just fix up the canonicalized signature during HIR typeck?
  const defining_ty = this.universal_regions.defining_ty;
  if (defining_ty.$ === "CoroutineClosure") {
    const args0 = defining_ty._1;
    const coroutine_kind = this.tcx().coroutine_kind(this.tcx().coroutine_for_closure(LocalDefId.to_def_id(mir_def_id))) as CoroutineKind | undefined;
    if (!is_async_or_gen_closure_coroutine(coroutine_kind)) {
      panic(
        `assertion \`left matches right\` failed: this needs to be modified if we're lowering non-async closures\n  left: ${debug_option(coroutine_kind, PLAIN, debug_CoroutineKind)}\n right: Some(hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::Async | hir::CoroutineDesugaring::Gen,\nhir::CoroutineSource::Closure))`,
      );
    }
    // Make sure to use the args from `DefiningTy` so the right NLL region vids are
    // prepopulated into the type.
    const args = args0.as_coroutine_closure();
    const tupled_upvars_ty = CoroutineClosureSignature.tupled_upvars_by_closure_kind(
      this.tcx(),
      CoroutineClosureArgs.kind(args),
      Ty.new_tup(this.tcx(), FnSig.inputs(user_provided_sig)),
      CoroutineClosureArgs.tupled_upvars_ty(args),
      CoroutineClosureArgs.coroutine_captures_by_ref_ty(args),
      this.infcx.next_region_var({ $: "Misc", _0: this.body.span }, () => RegionCtxt.Unknown),
    );

    const next_ty_var = (): Ty => this.infcx.next_ty_var(this.body.span);
    const output_ty = Ty.new_coroutine(
      this.tcx(),
      this.tcx().coroutine_for_closure(LocalDefId.to_def_id(mir_def_id)),
      CoroutineArgs.new(this.tcx(), {
        parent_args: CoroutineClosureArgs.parent_args(args),
        kind_ty: Ty.from_coroutine_closure_kind(this.tcx(), CoroutineClosureArgs.kind(args)),
        return_ty: FnSig.output(user_provided_sig),
        tupled_upvars_ty,
        // For async closures, none of these can be annotated, so just fill
        // them with fresh ty vars.
        resume_ty: next_ty_var(),
        yield_ty: next_ty_var(),
      }).args,
    );

    user_provided_sig = this.tcx().mk_fn_sig(FnSig.inputs(user_provided_sig), output_ty, user_provided_sig.fn_sig_kind);
  }

  const is_coroutine_with_implicit_resume_ty = this.tcx().is_coroutine(LocalDefId.to_def_id(mir_def_id)) && FnSig.inputs(user_provided_sig).length === 0;

  // In MIR, closure args begin with an implicit `self`.
  // Also, coroutines have a resume type which may be implicitly `()`.
  const user_tys = FnSig.inputs(user_provided_sig);
  const arg_decls = this.body
    .args_iter()
    .slice(1 + (is_coroutine_with_implicit_resume_ty ? 1 : 0))
    .map((local) => this.body.local_decls[local]!);
  // PORT: `zip_eq` panics when one side ends before the other (itertools' message).
  if (user_tys.length !== arg_decls.length) panic("itertools: .zip_eq() reached end of one iterator before the other");
  for (let i = 0; i < user_tys.length; i++) {
    const user_ty = user_tys[i]!;
    const arg_decl = arg_decls[i]!;
    this.ascribe_user_type_skip_wf(arg_decl.ty, UserType.new({ $: "Ty", _0: user_ty }), arg_decl.source_info.span);
  }

  // If the user explicitly annotated the output type, enforce it.
  const output_decl = this.body.local_decls[RETURN_PLACE]!;
  this.ascribe_user_type_skip_wf(output_decl.ty, UserType.new({ $: "Ty", _0: FnSig.output(user_provided_sig) }), output_decl.source_info.span);
};

//  FIXME(BoxyUwU): This should probably be part of a larger borrowck dev-guide chapter
//
/// Enforce that the types of the locals corresponding to the inputs and output of
/// the body are equal to those of the (normalized) signature.
///
/// This is necessary for two reasons:
/// - Locals in the MIR all start out with `'erased` regions and then are replaced
///    with unconstrained nll vars. If we have a function returning `&'a u32` then
///    the local `_0: &'?10 u32` needs to have its region var equated with the nll
///    var representing `'a`. i.e. borrow check must uphold that `'?10 = 'a`.
/// - When computing the normalized signature we may introduce new unconstrained nll
///    vars due to higher ranked where clauses ([#136547]). We then wind up with implied
///    bounds involving these vars.
///
///    For this reason it is important that we equate with the *normalized* signature
///    which was produced when computing implied bounds. If we do not do so then we will
///    wind up with implied bounds on nll vars which cannot actually be used as the nll
///    var never gets related to anything.
///
/// For 'closure-like' bodies this function effectively relates the *inferred* signature
/// of the closure against the locals corresponding to the closure's inputs/output. It *does
/// not* relate the user provided types for the signature to the locals, this is handled
/// separately by: [`TypeChecker::check_signature_annotation`].
///
/// [#136547]: <https://www.github.com/rust-lang/rust/issues/136547>
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/input_output.rs:163 equate_inputs_and_outputs
TypeChecker.prototype.equate_inputs_and_outputs = function (this: TypeChecker, normalized_inputs_and_output: readonly Ty[]): void {
  // `split_last().unwrap()`
  if (normalized_inputs_and_output.length === 0) panic("called `Option::unwrap()` on a `None` value");
  const normalized_output_ty = normalized_inputs_and_output[normalized_inputs_and_output.length - 1]!;
  const normalized_input_tys = normalized_inputs_and_output.slice(0, -1);

  // debug!(?normalized_output_ty);
  // debug!(?normalized_input_tys);

  // Equate expected input tys with those in the MIR.
  for (let argument_index = 0; argument_index < normalized_input_tys.length; argument_index++) {
    const normalized_input_ty = normalized_input_tys[argument_index]!;
    if (argument_index + 1 >= this.body.local_decls.length) {
      this.tcx().dcx().span_bug(this.body.span, "found more normalized_input_ty than local_decls");
    }

    // In MIR, argument N is stored in local N+1.
    const local = Local.arg(argument_index);

    const mir_input_ty = this.body.local_decls[local]!.ty;

    const mir_input_span = this.body.local_decls[local]!.source_info.span;
    this.equate_normalized_input_or_output(normalized_input_ty, mir_input_ty, mir_input_span);
  }

  const mir_yield_ty = this.body.yield_ty();
  if (mir_yield_ty !== undefined) {
    const yield_span = this.body.local_decls[RETURN_PLACE]!.source_info.span;
    this.equate_normalized_input_or_output(unwrap(this.universal_regions.yield_ty), mir_yield_ty, yield_span);
  }

  const mir_resume_ty = this.body.resume_ty();
  if (mir_resume_ty !== undefined) {
    const yield_span = this.body.local_decls[RETURN_PLACE]!.source_info.span;
    this.equate_normalized_input_or_output(unwrap(this.universal_regions.resume_ty), mir_resume_ty, yield_span);
  }

  // Equate expected output ty with the type of the RETURN_PLACE in MIR
  const mir_output_ty = this.body.return_ty();
  const output_span = this.body.local_decls[RETURN_PLACE]!.source_info.span;
  this.equate_normalized_input_or_output(normalized_output_ty, mir_output_ty, output_span);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/input_output.rs:216 equate_normalized_input_or_output
TypeChecker.prototype.equate_normalized_input_or_output = function (this: TypeChecker, a: Ty, b: Ty, span: Span): void {
  if (this.infcx.next_trait_solver()) {
    const r = this.eq_types(a, b, { $: "All", _0: span }, ConstraintCategory.BoringNoLocation);
    if (r.$ === "Err") {
      const terr = r._0;
      span_mirbug(this, Location.START, `equate_normalized_input_or_output: \`${debug_Ty(a, PLAIN)}==${debug_Ty(b, PLAIN)}\` failed with \`${debug_NoSolution(terr, PLAIN)}\``);
    }
    return;
  }

  // This is a hack. `body.local_decls` are not necessarily normalized in the old
  // solver due to not deeply normalizing in writeback. So we must re-normalize here.
  //
  // However, in most cases normalizing is unnecessary so we only do so if it may be
  // necessary for type equality to hold. This leads to some (very minor) performance
  // wins.
  if (this.eq_types(a, b, { $: "All", _0: span }, ConstraintCategory.BoringNoLocation).$ === "Err") {
    const b_ = this.normalize(Unnormalized.new(b), { $: "All", _0: span } as Locations, Normalizable_Ty, display_Ty, NormalizeLocation_Locations);
    const r: Result<null, NoSolution> = this.eq_types(a, b_, { $: "All", _0: span }, ConstraintCategory.BoringNoLocation);
    if (r.$ === "Err") {
      const terr = r._0;
      span_mirbug(this, Location.START, `equate_normalized_input_or_output: \`${debug_Ty(a, PLAIN)}==${debug_Ty(b_, PLAIN)}\` failed with \`${debug_NoSolution(terr, PLAIN)}\``);
    }
  }
};
