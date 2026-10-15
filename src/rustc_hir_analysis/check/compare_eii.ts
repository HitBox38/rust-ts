//! This module is very similar to `compare_impl_item`.
//! Most logic is taken from there,
//! since in a very similar way we're comparing some declaration of a signature to an implementation.
//! The major difference is that we don't bother with self types, since for EIIs we're comparing freestanding item.
//
// Port of compiler/rustc_hir_analysis/src/check/compare_eii.rs (lane small-gaps-17).
//
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.
//
// PORT notes (file-wide):
// - Query values that are `unknown` in queries.gen.ts (`fn_sig`, `type_of`, `param_env`, `generics_of`) are cast to the
//   upstream value types.
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// - `struct_span_code_err!` is rustc_errors' `struct_span_code_err` with the message formatted here.
// - `TypeErrCtxt`'s `report_fulfillment_errors` / `note_type_err` / `report_region_errors` (wave 19) are a view over
//   `infcx.err_ctxt()` at the end of this file (its stub stops as UNPORTED).
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { potentially_plural_count } from "./mod.ts";
import { type CheckNumberOfEarlyBoundRegionsError, check_number_of_early_bound_regions } from "./compare_impl_item.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { Applicability, E0806, type ErrorGuaranteed, pluralize, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { DefKind, DefKind_eq } from "../../rustc_hir/def.ts";
import { type FnSig as HirFnSig, FnRetTy, IsAsync } from "../../rustc_hir/hir.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { ToTrace_FnSig, ToTrace_Ty, type ToTrace } from "../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.ts";
import type { ValuePairs } from "../../rustc_infer/infer/mod.gen.ts";
import { Obligation, type PredicateObligation, type TraitErrors } from "../../rustc_infer/traits/mod.ts";
import { clone_ObligationCause, ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { HasAttrs_LocalDefId, ParamEnv, type Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_DefId, type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, type Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import { fold_tuple2, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { FnSig, fold_FnSig, PolyFnSig as PolyFnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import {
  EiiDefkindMismatch_diagnostic,
  EiiDefkindMismatchStaticMutability_diagnostic,
  EiiDefkindMismatchStaticSafety_diagnostic,
  EiiWithGenerics_diagnostic,
  LifetimesOrBoundsMismatchOnEii_diagnostic,
} from "../diagnostics.ts";

/// Checks whether the signature of some `external_impl`, matches
/// the signature of `declaration`, which it is supposed to be compatible
/// with in order to implement the item.
// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:37 compare_eii_function_types
export function compare_eii_function_types(
  tcx: TyCtxt,
  external_impl: LocalDefId,
  foreign_item: DefId,
  eii_name: Symbol,
  eii_attr_span: Span,
): Result<null, ErrorGuaranteed> {
  let r = check_eii_target(tcx, external_impl, foreign_item, eii_name, eii_attr_span);
  if (r.$ === "Err") return r;
  r = check_is_structurally_compatible(tcx, external_impl, foreign_item, eii_name, eii_attr_span);
  if (r.$ === "Err") return r;

  const external_impl_span = tcx.def_span(external_impl);
  const cause = ObligationCause.new(external_impl_span, external_impl, { $: "CompareEii", external_impl, declaration: foreign_item });

  // FIXME(eii): even if we don't support generic functions, we should support explicit outlive bounds here
  const param_env = tcx.param_env(foreign_item) as ParamEnv;

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  // We now need to check that the signature of the implementation is
  // compatible with that of the declaration. We do this by
  // checking that `impl_fty <: trait_fty`.
  //
  // FIXME: We manually instantiate the declaration here as we need
  // to manually compute its implied bounds. Otherwise this could just
  // be ocx.sub(impl_sig, trait_sig).

  // PORT: `FxIndexSet<Ty>` is an insertion-ordered `Set` (interned `Ty`s compare by identity).
  const wf_tys = new Set<Ty>();
  const norm_cause = ObligationCause.misc(external_impl_span, external_impl);

  const declaration_sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(foreign_item) as EarlyBinder<PolyFnSig>));
  const declaration_sig__ = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(external_impl), declaration_sig_, fold_FnSig);
  // debug!(?declaration_sig);

  const unnormalized_external_impl_sig = infcx.instantiate_binder_with_fresh_vars(
    external_impl_span,
    BoundRegionConversionTime.HigherRankedType,
    Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(
        tcx.fn_sig(external_impl) as EarlyBinder<PolyFnSig>,
        tcx,
        infcx.fresh_args_for_item(external_impl_span, LocalDefId.to_def_id(external_impl)),
        fold_Binder(fold_FnSig),
      ),
    ),
    fold_FnSig,
  );
  const external_impl_sig = ocx.normalize(norm_cause, param_env, Unnormalized.new_wip(unnormalized_external_impl_sig), fold_FnSig);
  // debug!(?external_impl_sig);

  // Next, add all inputs and output as well-formed tys. Importantly,
  // we have to do this before normalization, since the normalized ty may
  // not contain the input parameters. See issue #87748.
  for (const ty of declaration_sig__.inputs_and_output) wf_tys.add(ty);
  const declaration_sig = ocx.normalize(norm_cause, param_env, Unnormalized.new_wip(declaration_sig__), fold_FnSig);
  // We also have to add the normalized declaration
  // as we don't normalize during implied bounds computation.
  for (const ty of external_impl_sig.inputs_and_output) wf_tys.add(ty);

  // FIXME: Copied over from compare impl items, same issue:
  // We'd want to keep more accurate spans than "the method signature" when
  // processing the comparison between the trait and impl fn, but we sadly lose them
  // and point at the whole signature when a trait bound or specific input or output
  // type would be more appropriate. In other places we have a `Vec<Span>`
  // corresponding to their `Vec<Predicate>`, but we don't have that here.
  // Fixing this would improve the output of test `issue-83765.rs`.
  const result = ocx.sup(cause, param_env, declaration_sig, external_impl_sig, ToTrace_FnSig);

  if (result.$ === "Err") {
    const terr = result._0;
    // debug!(?external_impl_sig, ?declaration_sig, ?terr, "sub_types failed");

    const emitted = report_eii_mismatch(
      infcx,
      clone_ObligationCause(cause),
      param_env,
      terr,
      [foreign_item, declaration_sig],
      [external_impl, external_impl_sig],
      eii_attr_span,
      eii_name,
    );
    return Err(emitted);
  }

  if (!TypeVisitableExt.references_error<[FnSig, FnSig]>([declaration_sig, external_impl_sig], fold_tuple2(fold_FnSig, fold_FnSig))) {
    for (const ty of unnormalized_external_impl_sig.inputs_and_output) {
      ocx.register_obligation(
        Obligation.new(infcx.tcx, clone_ObligationCause(cause), param_env, { $: "WellFormed", _0: ty } as ClauseKind, upcast_tcx(Predicate_upcast_from_ClauseKind)),
      );
    }
  }

  // Check that all obligations are satisfied by the implementation's
  // version.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const reported = infcx.err_ctxt().report_fulfillment_errors(errors._0);
    return Err(reported);
  }

  // Finally, resolve all regions. This catches wily misuses of
  // lifetime parameters.
  const errors_ = infcx.resolve_regions(external_impl, param_env, wf_tys);
  if (!(errors_.length === 0)) {
    return Err(infcx.tainted_by_errors() ?? infcx.err_ctxt().report_region_errors(external_impl, errors_));
  }

  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:158 compare_eii_statics
export function compare_eii_statics(
  tcx: TyCtxt,
  external_impl: LocalDefId,
  external_impl_ty: Ty,
  foreign_item: DefId,
  eii_name: Symbol,
  eii_attr_span: Span,
): Result<null, ErrorGuaranteed> {
  const r = check_eii_target(tcx, external_impl, foreign_item, eii_name, eii_attr_span);
  if (r.$ === "Err") return r;

  const external_impl_span = tcx.def_span(external_impl);
  const cause = ObligationCause.new(external_impl_span, external_impl, { $: "CompareEii", external_impl, declaration: foreign_item });

  const param_env = ParamEnv.empty();

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  const declaration_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(foreign_item) as EarlyBinder<Ty>));
  // debug!(?declaration_ty);

  // FIXME: Copied over from compare impl items, same issue:
  // We'd want to keep more accurate spans than "the method signature" when
  // processing the comparison between the trait and impl fn, but we sadly lose them
  // and point at the whole signature when a trait bound or specific input or output
  // type would be more appropriate. In other places we have a `Vec<Span>`
  // corresponding to their `Vec<Predicate>`, but we don't have that here.
  // Fixing this would improve the output of test `issue-83765.rs`.
  const result = ocx.sup(cause, param_env, declaration_ty, external_impl_ty, ToTrace_Ty);

  if (result.$ === "Err") {
    // debug!(?external_impl_ty, ?declaration_ty, ?terr, "sub_types failed");

    const diag = struct_span_code_err(
      tcx.dcx(),
      cause.span,
      E0806,
      `static \`${display_Symbol(tcx.item_name(LocalDefId.to_def_id(external_impl)))}\` has a type that is incompatible with the declaration of \`#[${display_Symbol(eii_name)}]\``,
    );
    diag.span_note(eii_attr_span, "expected this because of this attribute");

    return Err(diag.emit_err());
  }

  // Check that all obligations are satisfied by the implementation's
  // version.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const reported = infcx.err_ctxt().report_fulfillment_errors(errors._0);
    return Err(reported);
  }

  // Finally, resolve all regions. This catches wily misuses of
  // lifetime parameters.
  const errors_ = infcx.resolve_regions(external_impl, param_env, []);
  if (!(errors_.length === 0)) {
    return Err(infcx.tainted_by_errors() ?? infcx.err_ctxt().report_region_errors(external_impl, errors_));
  }

  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:227 check_eii_target
function check_eii_target(tcx: TyCtxt, external_impl: LocalDefId, foreign_item: DefId, eii_name: Symbol, eii_attr_span: Span): Result<null, ErrorGuaranteed> {
  // Error recovery can resolve the EII target to another value item with the same name,
  // such as a tuple-struct constructor. Skip the comparison in that case and rely on the
  // earlier name-resolution error instead of ICEing while building EII diagnostics.
  // See <https://github.com/rust-lang/rust/issues/153502>.
  if (!tcx.is_foreign_item(foreign_item)) {
    return Err(tcx.dcx().delayed_bug("EII is a foreign item"));
  }
  const expected_kind = tcx.def_kind(foreign_item);
  const actual_kind = tcx.def_kind(external_impl);

  // PORT: the `match` (with guards) is an if-chain in arm order.
  // Correct target
  if (DefKind_eq(expected_kind, actual_kind)) {
    return Ok(null);
  } else if (expected_kind.$ === "Static" && actual_kind.$ === "Static") {
    const [m1, s1] = [expected_kind.mutability, expected_kind.safety];
    const [m2, s2] = [actual_kind.mutability, actual_kind.safety];
    let guar: ErrorGuaranteed;
    if (s1 !== s2) {
      guar = tcx.dcx().emit_err(EiiDefkindMismatchStaticSafety_diagnostic({ span: eii_attr_span, eii_name }));
    } else if (m1 !== m2) {
      guar = tcx.dcx().emit_err(EiiDefkindMismatchStaticMutability_diagnostic({ span: eii_attr_span, eii_name }));
    } else {
      return unreachable();
    }
    return Err(guar);
  }
  // Not checked by attr target checking
  else if (expected_kind.$ === "Fn" || expected_kind.$ === "Static") {
    return Err(
      tcx.dcx().emit_err(
        EiiDefkindMismatch_diagnostic({
          span: eii_attr_span,
          eii_name,
          expected_kind: DefKind.descr(expected_kind, foreign_item),
        }),
      ),
    );
  }
  // Checked by attr target checking
  else {
    return Err(tcx.dcx().delayed_bug("Attribute should not be allowed by target checking"));
  }
}

/// Checks a bunch of different properties of the impl/trait methods for
/// compatibility, such as asyncness, number of argument, self receiver kind,
/// and number of early- and late-bound generics.
///
/// Corresponds to `check_method_is_structurally_compatible` for impl method compatibility checks.
// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:275 check_is_structurally_compatible
function check_is_structurally_compatible(
  tcx: TyCtxt,
  external_impl: LocalDefId,
  declaration: DefId,
  eii_name: Symbol,
  eii_attr_span: Span,
): Result<null, ErrorGuaranteed> {
  let r = check_no_generics(tcx, external_impl, declaration, eii_name, eii_attr_span);
  if (r.$ === "Err") return r;
  r = check_number_of_arguments(tcx, external_impl, declaration, eii_name, eii_attr_span);
  if (r.$ === "Err") return r;
  r = check_early_region_bounds(tcx, external_impl, declaration, eii_attr_span);
  if (r.$ === "Err") return r;
  return Ok(null);
}

/// externally implementable items can't have generics
// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:289 check_no_generics
function check_no_generics(tcx: TyCtxt, external_impl: LocalDefId, _declaration: DefId, eii_name: Symbol, eii_attr_span: Span): Result<null, ErrorGuaranteed> {
  const generics = tcx.generics_of(external_impl) as Generics;
  if (
    generics.own_requires_monomorphization() &&
    // When an EII implementation is automatically generated by the `#[eii]` macro,
    // it will directly refer to the foreign item, not through a macro.
    // We don't want to emit this error if it's an implementation that's generated by the `#[eii]` macro,
    // since in that case it looks like a duplicate error: the declaration of the EII already can't contain generics.
    // So, we check here if at least one of the eii impls has ImplResolution::Macro, which indicates it's
    // not generated as part of the declaration.
    find_attr(HasAttrs_LocalDefId.get_attrs(external_impl, tcx), (k) => (k.$ === "EiiImpl" && k._0.resolution.$ === "Macro" ? null : undefined)) !== undefined
  ) {
    tcx.dcx().emit_err(
      EiiWithGenerics_diagnostic({
        span: tcx.def_span(external_impl),
        attr: eii_attr_span,
        eii_name,
        impl_name: tcx.item_name(LocalDefId.to_def_id(external_impl)),
      }),
    );
  }

  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:317 check_early_region_bounds
function check_early_region_bounds(tcx: TyCtxt, external_impl: LocalDefId, declaration: DefId, eii_attr_span: Span): Result<null, ErrorGuaranteed> {
  const external_impl_generics = tcx.generics_of(LocalDefId.to_def_id(external_impl)) as Generics;
  const external_impl_params = external_impl_generics.own_counts().lifetimes;

  const declaration_generics = tcx.generics_of(declaration) as Generics;
  const declaration_params = declaration_generics.own_counts().lifetimes;

  const r = check_number_of_early_bound_regions(
    tcx,
    external_impl,
    declaration,
    external_impl_generics,
    external_impl_params,
    declaration_generics,
    declaration_params,
  );
  if (r.$ !== "Err") {
    return Ok(null);
  }
  const { span, generics_span, bounds_span, where_span } = r._0;

  const diag = tcx.dcx().create_err(
    LifetimesOrBoundsMismatchOnEii_diagnostic({
      span,
      ident: tcx.item_name(LocalDefId.to_def_id(external_impl)),
      generics_span,
      bounds_span,
      where_span,
    }),
  );

  diag.span_label(eii_attr_span, `required because of this attribute`);
  return Err(diag.emit_err());
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:355 check_number_of_arguments
function check_number_of_arguments(
  tcx: TyCtxt,
  external_impl: LocalDefId,
  declaration: DefId,
  eii_name: Symbol,
  eii_attr_span: Span,
): Result<null, ErrorGuaranteed> {
  const external_impl_fty = tcx.fn_sig(external_impl) as EarlyBinder<PolyFnSig>;
  const declaration_fty = tcx.fn_sig(declaration) as EarlyBinder<PolyFnSig>;
  const declaration_number_args = Binder.skip_binder(PolyFnSigC.inputs(EarlyBinder.skip_binder(declaration_fty))).length;
  const external_impl_number_args = Binder.skip_binder(PolyFnSigC.inputs(EarlyBinder.skip_binder(external_impl_fty))).length;

  // if the number of args are equal, we're trivially done
  if (declaration_number_args === external_impl_number_args) {
    return Ok(null);
  } else {
    return Err(
      report_number_of_arguments_mismatch(tcx, external_impl, declaration, eii_name, eii_attr_span, declaration_number_args, external_impl_number_args),
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:383 report_number_of_arguments_mismatch
function report_number_of_arguments_mismatch(
  tcx: TyCtxt,
  external_impl: LocalDefId,
  declaration: DefId,
  eii_name: Symbol,
  eii_attr_span: Span,
  declaration_number_args: number,
  external_impl_number_args: number,
): ErrorGuaranteed {
  const external_impl_name = tcx.item_name(LocalDefId.to_def_id(external_impl));

  // PORT: the `Option` combinator chain `as_local().and_then(..).or_else(..).unwrap_or_else(..)`, in order.
  let declaration_span: Span | undefined;
  const declaration_local = declaration.as_local();
  if (declaration_local !== undefined) {
    const declaration_sig = get_declaration_sig(tcx, declaration_local);
    if (declaration_sig === undefined) panic("foreign item sig");
    const pos = saturating_sub(declaration_number_args, 1);
    const arg = declaration_sig.decl.inputs[pos];
    if (arg !== undefined) {
      if (pos === 0) {
        declaration_span = arg.span;
      } else {
        declaration_span = Span.with_lo(arg.span, Span.lo(declaration_sig.decl.inputs[0]!.span));
      }
    }
  }
  declaration_span ??= tcx.hir_span_if_local(declaration);
  declaration_span ??= tcx.def_span(declaration);

  const [, external_impl_sig] = tcx.hir_expect_item(external_impl).expect_fn();
  const pos = saturating_sub(external_impl_number_args, 1);
  const impl_arg = external_impl_sig.decl.inputs[pos];
  let impl_span: Span;
  if (impl_arg !== undefined) {
    if (pos === 0) {
      impl_span = impl_arg.span;
    } else {
      impl_span = Span.with_lo(impl_arg.span, Span.lo(external_impl_sig.decl.inputs[0]!.span));
    }
  } else {
    impl_span = tcx.def_span(external_impl);
  }

  const err = struct_span_code_err(
    tcx.dcx(),
    impl_span,
    E0806,
    `\`${display_Symbol(external_impl_name)}\` has ${potentially_plural_count(external_impl_number_args, "parameter")} but #[${display_Symbol(eii_name)}] requires it to have ${declaration_number_args}`,
  );

  err.span_label(declaration_span, `requires ${potentially_plural_count(declaration_number_args, "parameter")}`);

  err.span_label(impl_span, `expected ${potentially_plural_count(declaration_number_args, "parameter")}, found ${external_impl_number_args}`);

  err.span_label(eii_attr_span, `required because of this attribute`);

  return err.emit_err();
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:453 report_eii_mismatch
function report_eii_mismatch(
  infcx: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  terr: TypeError,
  [declaration_did, declaration_sig]: [DefId, FnSig],
  [external_impl_did, external_impl_sig]: [LocalDefId, FnSig],
  eii_attr_span: Span,
  eii_name: Symbol,
): ErrorGuaranteed {
  // PORT: `mut cause: ObligationCause` is taken by value: the caller passes a copy (`cause.span` is assigned below).
  const tcx = infcx.tcx;
  const [impl_err_span, trait_err_span, external_impl_name] = extract_spans_for_error_reporting(infcx, terr, cause, declaration_did, external_impl_did);

  const diag = struct_span_code_err(
    tcx.dcx(),
    impl_err_span,
    E0806,
    `function \`${display_Ident(external_impl_name)}\` has a type that is incompatible with the declaration of \`#[${display_Symbol(eii_name)}]\``,
  );

  diag.span_note(eii_attr_span, "expected this because of this attribute");

  if (terr.$ === "ArgumentMutability" || terr.$ === "ArgumentSorts") {
    const i = terr.$ === "ArgumentMutability" ? terr._0 : terr._1;
    if (FnSig.inputs(declaration_sig).length === i) {
      // Suggestion to change output type. We do not suggest in `async` functions
      // to avoid complex logic or incorrect output.
      const kind = tcx.hir_expect_item(external_impl_did).kind;
      if (kind.$ === "Fn" && !IsAsync.is_async(kind.sig.header.asyncness)) {
        const sig = kind.sig;
        const msg = "change the output type to match the declaration";
        const ap = Applicability.MachineApplicable;
        const output = sig.decl.output;
        switch (output.$) {
          case "DefaultReturn": {
            const sp = output._0;
            const sugg = ` -> ${display_Ty(FnSig.output(declaration_sig))}`;
            diag.span_suggestion_verbose(sp, msg, sugg, ap);
            break;
          }
          case "Return": {
            const hir_ty = output._0;
            const sugg = FnSig.output(declaration_sig);
            diag.span_suggestion_verbose(hir_ty.span, msg, display_Ty(sugg), ap);
            break;
          }
        }
      }
    } else {
      const trait_ty = FnSig.inputs(declaration_sig)[i];
      if (trait_ty !== undefined) {
        diag.span_suggestion_verbose(impl_err_span, "change the parameter type to match the declaration", display_Ty(trait_ty), Applicability.MachineApplicable);
      }
    }
  }

  cause.span = impl_err_span;
  infcx.err_ctxt().note_type_err(
    diag,
    cause,
    trait_err_span === undefined ? undefined : [trait_err_span, "type in declaration", false],
    param_env.and<ValuePairs>({ $: "PolySigs", _0: { expected: Binder.dummy(declaration_sig, fold_FnSig), found: Binder.dummy(external_impl_sig, fold_FnSig) } }),
    terr,
    false,
    undefined,
  );

  return diag.emit_err();
}

// #[instrument(level = "debug", skip(infcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:528 extract_spans_for_error_reporting
function extract_spans_for_error_reporting(
  infcx: InferCtxt,
  terr: TypeError,
  cause: ObligationCause,
  declaration: DefId,
  external_impl: LocalDefId,
): [Span, Span | undefined, Ident] {
  const tcx = infcx.tcx;
  // PORT: the lazy `inputs.map(span).chain(once(output.span()))` iterators are arrays (no side effects).
  const [external_impl_args, external_impl_name] = ((): [Span[], Ident] => {
    const item = tcx.hir_expect_item(external_impl);
    const [ident, sig] = item.expect_fn();
    return [[...sig.decl.inputs.map((t) => t.span), FnRetTy.span(sig.decl.output)], ident];
  })();

  const declaration_def_id = declaration.as_local();
  const declaration_args =
    declaration_def_id === undefined
      ? undefined
      : (() => {
          const sig = get_declaration_sig(tcx, declaration_def_id);
          if (sig !== undefined) {
            return [...sig.decl.inputs.map((t) => t.span), FnRetTy.span(sig.decl.output)];
          } else {
            return panic(`expected ${debug_DefId(LocalDefId.to_def_id(declaration_def_id), PLAIN)} to be a foreign function`);
          }
        })();

  switch (terr.$) {
    case "ArgumentMutability":
    case "ArgumentSorts": {
      const i = terr.$ === "ArgumentMutability" ? terr._0 : terr._1;
      return [unwrap(external_impl_args[i]), declaration_args === undefined ? undefined : declaration_args[i], external_impl_name];
    }
    default:
      return [cause.span, tcx.hir_span_if_local(declaration) ?? tcx.def_span(declaration), external_impl_name];
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_eii.rs:564 get_declaration_sig
function get_declaration_sig(tcx: TyCtxt, def_id: LocalDefId): HirFnSig | undefined {
  const hir_id: HirId = tcx.local_def_id_to_hir_id(def_id);
  return tcx.hir_fn_sig_by_hir_id(hir_id);
}

// ==== helpers ==========================================================================================================

/** `usize::saturating_sub`. */
function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

/** `Upcast<TyCtxt, P>` descriptors are typed over `Interner` (precedent: rustc_infer opaque_types/mod.ts). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return f as unknown as (from: T, tcx: Interner) => P;
}

// ==== Stand-ins (PORT: other lanes; see the file header) ===============================================================

type ParamEnvAndValuePairs = ReturnType<ParamEnv["and"]>;


