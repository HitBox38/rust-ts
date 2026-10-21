// Port of compiler/rustc_hir_analysis/src/check/check.rs (lane check-check, wave 17).
//
// Init order: top-level code here touches only other crates; every rustc_hir_analysis export (./mod.ts, ../collect.ts,
// ../diagnostics.ts) is read inside function bodies only.
//
// PORT: the code that needs another wave-17 lane that is not in this lane's base stops with `unported(..)` at the first
// use, after the upstream statements before it. The stand-ins are at the end of this file ("Stand-ins"), one per upstream
// item, each naming the lane that ports it; the merge repoints them to the real ports:
// - rustc_trait_selection error reporting (wave 19): `TypeErrCtxt`, `ReturnsVisitor`;
// - layout (M4): `TyAndLayout` / `LayoutError`, the values of `tcx.layout_of(..)`.
import * as middle_ty from "../../rustc_middle/ty/mod.ts";
import * as compare_impl_item from "./compare_impl_item.ts";
import * as intrinsic from "./intrinsic.ts";
import * as wfcheck from "./wfcheck.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { impl_item_is_final } from "../../rustc_trait_selection/traits/util.ts";
import { display_ExternAbi, ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { Align_eq, type ScalableElt } from "../../rustc_abi/lib.ts";
import { LitKind } from "../../rustc_ast/lib.ts";
import { type ControlFlow, ControlFlow as ControlFlowC, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import {
  Diag,
  type DiagCtxtHandle,
  DiagDecorator,
  type Diagnostic,
  E0044,
  E0075,
  E0076,
  E0077,
  E0081,
  E0084,
  E0091,
  E0587,
  E0634,
  E0690,
  E0720,
  E0732,
  E0749,
  type Level,
  struct_span_code_err,
} from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { Defaultness } from "../../rustc_hir/hir.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { ALIGNED_FIELDS_IN_PACKED, DEAD_CODE, UNINHABITED_STATIC, UNSUPPORTED_CALLING_CONVENTIONS } from "../../rustc_lint_defs/builtin.gen.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import type { EvalResult } from "../../rustc_middle/middle/stability.gen.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, Region } from "../../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { FieldIdx, VariantIdx } from "../../rustc_middle/ty/decls.ts";
import { type Clauses, RawList } from "../../rustc_middle/ty/list.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import type { GenericClauses, Generics } from "../../rustc_middle/ty/generics.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import type { IntrinsicDefView } from "../../rustc_middle/ty/util.ts";
import { clone_Ancestors, Node as Node_ } from "../../rustc_middle/traits/specialization_graph.ts";
import { clone_ObligationCause, ObligationCause, ObligationCauseCode, type WellFormedLoc } from "../../rustc_middle/traits/mod.ts";
import type { PredicateObligation } from "../../rustc_infer/traits/mod.gen.ts";
import { Asyncness, type FieldDef, HasAttrs_LocalDefId, type ImplTraitHeader, type ParamEnv, ProvisionalHiddenType, type Term, Ty, TypingEnv, type VariantDef, Visibility } from "../../rustc_middle/ty/mod.ts";
import { debug_LayoutError, display_LayoutError, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Predicate, fold_Span, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type Discr, display_Discr } from "../../rustc_middle/ty/util.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { type DefId, DefId_eq, DefIdSet, debug_DefId, debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { Ident, sym, Symbol } from "../../rustc_span/symbol.ts";
import { AbiMap } from "../../rustc_target/spec/abi_map.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { fold_regions, fold_tuple2, type PredicateProxy, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { type TraitRef, TraitRef as TraitRefC } from "../../rustc_type_ir/predicate.ts";
import { visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import { debug_Node } from "../../rustc_hir/hir.gen.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.gen.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { assert, assert_eq, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type InferCtxt, ItemCtxt, type TestBinderBody } from "../decls.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/decls.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { type TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { type ToTrace, ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { type Clause, Predicate_upcast_from_Binder_PredicateKind, Predicate_upcast_from_Clause, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { BottomUpFolder } from "../../rustc_middle/ty/fold.ts";
import { TypeError_to_string } from "../../rustc_middle/ty/error.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import { type PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import { fold_with_OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.gen.ts";
import * as diagnostics from "../diagnostics.ts";
import { check_c_variadic_abi } from "../lib.ts";
import { bad_variant_count, default_body_is_unstable, get_owner_return_paths, missing_items_err, missing_items_must_implement_one_of_err } from "./mod.ts";

// rustc_abi `MAX_SIMD_LANES` (rustc_abi/src/lib.rs:265, `pub const MAX_SIMD_LANES: u16 = 1 << 0xF;`).
// PORT: not exported by the TS rustc_abi yet; the upstream constant's value.
const MAX_SIMD_LANES = 1 << 0xf;
// `FieldIdx::ZERO` / `FieldIdx::ONE` / `VariantIdx::ZERO` (rustc_abi newtype_index! consts).
const FieldIdx_ZERO = 0 as FieldIdx;
const FieldIdx_ONE = 1 as FieldIdx;
const VariantIdx_ZERO = 0 as VariantIdx;
/** `TypeVisitable for TraitRef` (derived). */
const TraitRef_visitable: TypeVisitable<TraitRef> = { visit_with: (self, visitor) => visit_with_TraitRef(self, visitor) };

/** `res.and(other)` (`Result<(), ErrorGuaranteed>`): `other` is evaluated by the caller first, as in Rust. */
function and(res: Result<null, ErrorGuaranteed>, other: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return res.$ === "Ok" ? other : res;
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:48 add_abi_diag_help
function add_abi_diag_help(abi: ExternAbi, diag: Diag): void {
  if (abi.$ === "Cdecl") {
    const unwind = abi.unwind;
    const c_abi = ExternAbi.C(unwind);
    diag.help(`use \`extern ${display_ExternAbi(c_abi)}\` instead`);
  } else if (abi.$ === "Stdcall") {
    const unwind = abi.unwind;
    const c_abi = ExternAbi.C(unwind);
    const system_abi = ExternAbi.System(unwind);
    diag.help(
      `if you need \`extern ${display_ExternAbi(abi)}\` on win32 and \`extern ${display_ExternAbi(c_abi)}\` everywhere else, ` +
        `use \`extern ${display_ExternAbi(system_abi)}\``,
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:62 check_abi
export function check_abi(tcx: TyCtxt, hir_id: HirId, span: Span, abi: ExternAbi): void {
  // struct UnsupportedCallingConventions { abi: ExternAbi }
  interface UnsupportedCallingConventions {
    abi: ExternAbi;
  }

  // impl<'a> Diagnostic<'a> for UnsupportedCallingConventions
  // rustc: compiler/rustc_hir_analysis/src/check/check.rs:68 into_diag
  function UnsupportedCallingConventions_into_diag(self: UnsupportedCallingConventions, dcx: DiagCtxtHandle, level: Level): Diag {
    const { abi } = self;
    const lint = Diag.new(dcx, level, `${display_ExternAbi(abi)} is not a supported ABI for the current target`);
    add_abi_diag_help(abi, lint);
    return lint;
  }
  const UnsupportedCallingConventions_diagnostic = (self: UnsupportedCallingConventions): Diagnostic => ({
    into_diag: (dcx, level) => UnsupportedCallingConventions_into_diag(self, dcx, level),
  });
  // FIXME: This should be checked earlier, e.g. in `rustc_ast_lowering`, as this
  // currently only guards function imports, function definitions, and function pointer types.
  // Functions in trait declarations can still use "deprecated" ABIs without any warning.

  const mapping = AbiMap.from_target(tcx.sess.target).canonize_abi(abi, false);
  switch (mapping.$) {
    case "Direct":
      break;
    // already erred in rustc_ast_lowering
    case "Invalid": {
      tcx.dcx().span_delayed_bug(span, `${display_ExternAbi(abi)} should be rejected in ast_lowering`);
      break;
    }
    case "Deprecated": {
      tcx.emit_node_span_lint(UNSUPPORTED_CALLING_CONVENTIONS, hir_id, span, UnsupportedCallingConventions_diagnostic({ abi }));
      break;
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:100 check_struct
function check_struct(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const def = tcx.adt_def(def_id) as AdtDef;
  const span = tcx.def_span(def_id);
  def.destructor(tcx); // force the destructor to be evaluated

  const scalable = def.repr().scalable;
  if (scalable !== undefined) {
    check_scalable_vector(tcx, span, def_id, scalable);
  } else if (def.repr().simd()) {
    check_simd(tcx, span, def_id);
  }

  check_transparent(tcx, def);
  check_packed(tcx, span, def_id);
  return wfcheck.check_type_defn(tcx, def_id, false);
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:116 check_union
function check_union(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const def = tcx.adt_def(def_id) as AdtDef;
  const span = tcx.def_span(def_id);
  def.destructor(tcx); // force the destructor to be evaluated
  check_transparent(tcx, def);
  check_union_fields(tcx, span, def_id);
  check_packed(tcx, span, def_id);
  return wfcheck.check_type_defn(tcx, def_id, true);
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:126 allowed_union_or_unsafe_field
function allowed_union_or_unsafe_field(tcx: TyCtxt, ty_: Ty, typing_env: TypingEnv, span: Span): boolean {
  // HACK (not that bad of a hack don't worry): Some codegen tests don't even define proper
  // impls for `Copy`. Let's short-circuit here for this validity check, since a lot of them
  // use unions. We should eventually fix all the tests to define that lang item or use
  // minicore stubs.
  if (ty_.is_trivially_pure_clone_copy()) {
    return true;
  }
  // If `BikeshedGuaranteedNoDrop` is not defined in a `#[no_core]` test, fall back to `Copy`.
  // This is an underapproximation of `BikeshedGuaranteedNoDrop`,
  const def_id = tcx.lang_items().get(LangItem.BikeshedGuaranteedNoDrop) ?? tcx.require_lang_item(LangItem.Copy, span);
  const r = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty_), fold_Ty);
  if (r.$ !== "Ok") {
    tcx.dcx().span_delayed_bug(span, "could not normalize field type");
    return true;
  }
  const ty = r._0;
  const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env);
  return infcx.predicate_must_hold_modulo_regions(
    Obligation.new(tcx, ObligationCause.dummy_with_span(span), param_env, TraitRefC.new(as_interner(tcx), def_id, [ty]), (from, _cx) => Predicate_upcast_from_TraitRef(from, tcx)),
  );
}

/// Check that the fields of the `union` do not need dropping.
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:159 check_union_fields
function check_union_fields(tcx: TyCtxt, span: Span, item_def_id: LocalDefId): boolean {
  const def = tcx.adt_def(item_def_id) as AdtDef;
  assert(def.is_union(), "assertion failed: def.is_union()");

  const typing_env = TypingEnv.non_body_analysis(tcx, item_def_id);
  const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(item_def_id));

  for (const field of def.non_enum_variant().fields) {
    if (!allowed_union_or_unsafe_field(tcx, Unnormalized.skip_norm_wip(field.ty(tcx, args)), typing_env, span)) {
      const node = tcx.hir_get_if_local(field.did);
      let field_span: Span;
      let ty_span: Span;
      // We are currently checking the type this field came from, so it must be local.
      if (node !== undefined && node.$ === "Field") {
        [field_span, ty_span] = [node._0.span, node._0.ty.span];
      } else {
        return unreachable("internal error: entered unreachable code: mir field has to correspond to hir field");
      }
      tcx.dcx().emit_err(
        diagnostics.InvalidUnionField_diagnostic({
          field_span,
          sugg: {
            lo: Span.shrink_to_lo(ty_span),
            hi: Span.shrink_to_hi(ty_span),
          },
          note: null,
        }),
      );
      return false;
    }
  }

  return true;
}

/// Check that a `static` is inhabited.
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:194 check_static_inhabited
function check_static_inhabited(tcx: TyCtxt, def_id: LocalDefId): void {
  // #[derive(Diagnostic)]
  // #[diag("static of uninhabited type")]
  // #[note("uninhabited statics cannot be initialized, and any access would be an immediate error")]
  // struct StaticOfUninhabitedType;
  // PORT: a fn-local `#[derive(Diagnostic)]` is in no codegen set; the derive's `into_diag` is written out here (a
  // message and one note).
  const StaticOfUninhabitedType: Diagnostic = {
    into_diag: (dcx, level) =>
      Diag.new(dcx, level, "static of uninhabited type").with_note("uninhabited statics cannot be initialized, and any access would be an immediate error"),
  };

  // Make sure statics are inhabited.
  // Other parts of the compiler assume that there are no uninhabited places. In principle it
  // would be enough to check this for `extern` statics, as statics with an initializer will
  // have UB during initialization if they are uninhabited, but there also seems to be no good
  // reason to allow any statics to be uninhabited.
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
  const span = tcx.def_span(def_id);
  const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
  let layout: TyAndLayout;
  if (r.$ === "Ok") {
    layout = r._0;
  } else {
    const e = r._0;
    // Foreign statics that overflow their allowed size should emit an error
    if (
      e.$ === "SizeOverflow" &&
      (() => {
        const k = tcx.def_kind(def_id);
        return k.$ === "Static" && tcx.def_kind(tcx.local_parent(def_id)).$ === "ForeignMod";
      })()
    ) {
      tcx.dcx().emit_err(diagnostics.TooLargeStatic_diagnostic({ span }));
      return;
    }
    // SIMD types with invalid layout (e.g., zero-length) should emit an error
    if (e.$ === "InvalidSimd") {
      const ty_span = tcx.ty_span(def_id);
      tcx.dcx().span_err(ty_span, display_LayoutError(e));
      return;
    }
    // Generic statics are rejected, but we still reach this case.
    tcx.dcx().span_delayed_bug(span, debug_LayoutError(e, PLAIN));
    return;
  }
  if (layout.is_uninhabited()) {
    tcx.emit_node_span_lint(UNINHABITED_STATIC, tcx.local_def_id_to_hir_id(def_id), span, StaticOfUninhabitedType);
  }
}

/// Checks that an opaque type does not contain cycles and does not use `Self` or `T::Foo`
/// projections that would result in "inheriting lifetimes".
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:241 check_opaque
function check_opaque(tcx: TyCtxt, def_id: LocalDefId): void {
  const { origin } = tcx.hir_expect_opaque_ty(def_id);

  // HACK(jynelson): trying to infer the type of `impl trait` breaks documenting
  // `async-std` (and `pub async fn` in general).
  // Since rustdoc doesn't care about the hidden type behind `impl Trait`, just don't look at it!
  // See https://github.com/rust-lang/rust/issues/75100
  if (tcx.sess.opts.actually_rustdoc) {
    return;
  }

  if (TypeVisitableExt.references_error(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)), fold_Ty)) {
    return;
  }
  if (check_opaque_for_cycles(tcx, def_id).$ === "Err") {
    return;
  }

  void check_opaque_meets_bounds(tcx, def_id, origin);
}

/// Checks that an opaque type does not contain cycles.
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:263 check_opaque_for_cycles
function check_opaque_for_cycles(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));

  // First, try to look at any opaque expansion cycles, considering coroutine fields
  // (even though these aren't necessarily true errors).
  if (tcx.try_expand_impl_trait_type(LocalDefId.to_def_id(def_id), args).$ === "Err") {
    const reported = opaque_type_cycle_error(tcx, def_id);
    return Err(reported);
  }

  return Ok(null);
}

/// Check that the hidden type behind `impl Trait` actually implements `Trait`.
///
/// This is mostly checked at the places that specify the opaque type, but we
/// check those cases in the `param_env` of that function, which may have
/// bounds not on this opaque type:
///
/// ```ignore (illustrative)
/// type X<T> = impl Clone;
/// fn f<T: Clone>(t: T) -> X<T> {
///     t
/// }
/// ```
///
/// Without this check the above code is incorrectly accepted: we would ICE if
/// some tried, for example, to clone an `Option<X<&mut ()>>`.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:295 check_opaque_meets_bounds
function check_opaque_meets_bounds(tcx: TyCtxt, def_id: LocalDefId, origin: hir.OpaqueTyOrigin<LocalDefId>): Result<null, ErrorGuaranteed> {
  const best = best_definition_site_of_opaque(tcx, def_id, origin);
  let span: Span;
  let definition_def_id: LocalDefId | undefined;
  if (best !== undefined) {
    const [span_, def_id_] = best;
    [span, definition_def_id] = [span_, def_id_];
  } else {
    [span, definition_def_id] = [tcx.def_span(def_id), undefined];
  }

  const defining_use_anchor = origin.parent;
  const param_env = tcx.param_env(defining_use_anchor) as ParamEnv;

  // FIXME(#132279): Once `PostBorrowck` is supported in the old solver, this branch should be removed.
  const infcx = tcx
    .infer_ctxt()
    .build(
      tcx.next_trait_solver_globally()
        ? TypingMode.post_borrowck_analysis(as_interner(tcx), defining_use_anchor)
        : TypingMode.analysis_in_body(as_interner(tcx), defining_use_anchor),
    );
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  const parent = origin.parent;
  const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(parent)).extend_to(tcx, LocalDefId.to_def_id(def_id), (param, _) =>
    tcx.map_opaque_lifetime_to_parent_lifetime(param.def_id.expect_local()),
  );

  const opaque_ty = Ty.new_opaque(tcx, "No", LocalDefId.to_def_id(def_id), args);

  // `ReErased` regions appear in the "parent_args" of closures/coroutines.
  // We're ignoring them here and replacing them with fresh region variables.
  // See tests in ui/type-alias-impl-trait/closure_{parent_args,wf_outlives}.rs.
  //
  // FIXME: Consider wrapping the hidden type in an existential `Binder` and instantiating it
  // here rather than using ReErased.
  const hidden_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(LocalDefId.to_def_id(def_id)) as EarlyBinder<Ty>, tcx, args, fold_Ty));
  const hidden_ty = fold_regions(
    tcx,
    hidden_ty_,
    (re, _dbi) => (re.kind().$ === "ReErased" ? infcx.next_region_var({ $: "Misc", _0: span }) : re),
    fold_Ty,
  );

  // HACK: We eagerly instantiate some bounds to report better errors for them...
  // This isn't necessary for correctness, since we register these bounds when
  // equating the opaque below, but we should clean this up in the new solver.
  for (const u of EarlyBinder.iter_instantiated_copied(
    tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>,
    tcx,
    args,
    fold_tuple2(fold_Clause, fold_Span),
  )) {
    const [predicate_, pred_span] = Unnormalized.skip_norm_wip(u);
    const predicate = fold_Clause.fold_with(
      predicate_,
      new BottomUpFolder(
        tcx,
        (ty) => (ty === opaque_ty ? hidden_ty : ty),
        (lt) => lt,
        (ct) => ct,
      ),
    );

    ocx.register_obligation(
      Obligation.new(tcx, ObligationCause.new(span, def_id, { $: "OpaqueTypeBound", _0: pred_span, _1: definition_def_id }), param_env, predicate, (from, _cx) => Predicate_upcast_from_Clause(from, tcx)),
    );
  }

  const misc_cause = ObligationCause.misc(span, def_id);
  // FIXME: We should just register the item bounds here, rather than equating.
  // FIXME(const_trait_impl): When we do that, please make sure to also register
  // the `[const]` bounds.
  const eq = ocx.eq(misc_cause, param_env, opaque_ty, hidden_ty, ToTrace_Ty);
  if (eq.$ === "Err") {
    const ty_err_ = eq._0;
    // Some types may be left "stranded" if they can't be reached
    // from a lowered rustc_middle bound but they're mentioned in the HIR.
    // This will happen, e.g., when a nested opaque is inside of a non-
    // existent associated type, like `impl Trait<Missing = impl Trait>`.
    // See <tests/ui/impl-trait/stranded-opaque.rs>.
    const ty_err = TypeError_to_string(ty_err_, tcx);
    const guar = tcx.dcx().span_delayed_bug(span, `could not unify \`${display_Ty(hidden_ty)}\` with revealed type:\n${ty_err}`);
    return Err(guar);
  }

  // Additionally require the hidden type to be well-formed with only the generics of the opaque type.
  // Defining use functions may have more bounds than the opaque type, which is ok, as long as the
  // hidden type is well formed even without those bounds.
  const predicate = Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "WellFormed", _0: hidden_ty } }, d_PredicateKind);
  ocx.register_obligation(Obligation.new(tcx, clone_ObligationCause(misc_cause), param_env, predicate, (from, _cx) => Predicate_upcast_from_Binder_PredicateKind(from, tcx)));

  // Check that all obligations are satisfied by the implementation's
  // version.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const guar = infcx.err_ctxt().report_fulfillment_errors(errors._0);
    return Err(guar);
  }

  // FIXME(impl_trait_in_assoc_type): This computes the implied bounds
  // while being able to normalize opaque types. This is unsound if checking that the
  // opaque type is well-formed relies on an implied bound mentioning that opaque type.
  // This should only affect TAIT as this function is not soundness critical for RPITs.
  //
  // cc trait-system-refactor-initiative#159
  const wf_tys = ocx.assumed_wf_types_and_report_errors(param_env, defining_use_anchor);
  if (wf_tys.$ === "Err") return wf_tys;
  const r = ocx.resolve_regions_and_report_errors(defining_use_anchor, param_env, wf_tys._0);
  if (r.$ === "Err") return r;

  if (infcx.next_trait_solver()) {
    return Ok(null);
  } else if (origin.$ === "FnReturn" || origin.$ === "AsyncFn") {
    // HACK: this should also fall through to the hidden type check below, but the original
    // implementation had a bug where equivalent lifetimes are not identical. This caused us
    // to reject existing stable code that is otherwise completely fine. The real fix is to
    // compare the hidden types via our type equivalence/relation infra instead of doing an
    // identity check.
    void infcx.take_opaque_types();
    return Ok(null);
  } else {
    // Check that any hidden types found during wf checking match the hidden types that `type_of` sees.
    for (let [key, ty] of infcx.take_opaque_types()) {
      ty = new ProvisionalHiddenType(ty.span, infcx.deeply_resolve_ignoring_regions(ty.ty, fold_Ty));
      key = infcx.deeply_resolve_ignoring_regions(key, fold_OpaqueTypeKey);
      const r = sanity_check_found_hidden_type(tcx, key, ty);
      if (r.$ === "Err") return r;
    }
    return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:442 best_definition_site_of_opaque
function best_definition_site_of_opaque(tcx: TyCtxt, opaque_def_id: LocalDefId, origin: hir.OpaqueTyOrigin<LocalDefId>): [Span, LocalDefId] | undefined {
  type R = ControlFlow<[Span, LocalDefId]>;
  class TaitConstraintLocator extends hir.intravisit.Visitor<R> {
    // `type NestedFilter = nested_filter::All;`
    override NestedFilter = All;
    // `type Result = ControlFlow<(Span, LocalDefId)>;`
    override Result: VisitorResult<R, [Span, LocalDefId]> = VisitorResultC.ControlFlow<[Span, LocalDefId]>();

    constructor(
      public opaque_def_id: LocalDefId,
      public tcx: TyCtxt,
    ) {
      super();
    }

    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:452 check
    check(item_def_id: LocalDefId): R {
      if (!this.tcx.has_typeck_results(item_def_id)) {
        return ControlFlowC.CONTINUE;
      }

      const opaque_types_defined_by = this.tcx.opaque_types_defined_by(item_def_id) as readonly LocalDefId[];
      // Don't try to check items that cannot possibly constrain the type.
      if (!opaque_types_defined_by.includes(this.opaque_def_id)) {
        return ControlFlowC.CONTINUE;
      }

      const borrowck = this.tcx.mir_borrowck(item_def_id) as Result<Map<LocalDefId, { span: Span }>, ErrorGuaranteed>;
      const hidden_ty = borrowck.$ === "Ok" ? borrowck._0.get(this.opaque_def_id) : undefined;
      if (hidden_ty !== undefined) {
        return ControlFlowC.Break([hidden_ty.span, item_def_id]);
      } else {
        return ControlFlowC.CONTINUE;
      }
    }

    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:478 maybe_tcx
    override maybe_tcx(): TyCtxt {
      return this.tcx;
    }
    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:481 visit_expr
    override visit_expr(ex: hir.Expr): R {
      return hir.intravisit.walk_expr(this, ex);
    }
    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:484 visit_item
    override visit_item(it: hir.Item): R {
      const r = this.check(it.owner_id.def_id);
      if (r.$ === "Break") return r;
      return hir.intravisit.walk_item(this, it);
    }
    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:488 visit_impl_item
    override visit_impl_item(it: hir.ImplItem): R {
      const r = this.check(it.owner_id.def_id);
      if (r.$ === "Break") return r;
      return hir.intravisit.walk_impl_item(this, it);
    }
    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:492 visit_trait_item
    override visit_trait_item(it: hir.TraitItem): R {
      const r = this.check(it.owner_id.def_id);
      if (r.$ === "Break") return r;
      return hir.intravisit.walk_trait_item(this, it);
    }
    // rustc: compiler/rustc_hir_analysis/src/check/check.rs:496 visit_foreign_item
    override visit_foreign_item(it: hir.ForeignItem): R {
      return hir.intravisit.walk_foreign_item(this, it);
    }
  }

  const break_value = (r: R): [Span, LocalDefId] | undefined => (r.$ === "Break" ? r._0 : undefined);

  const locator = new TaitConstraintLocator(opaque_def_id, tcx);
  switch (origin.$) {
    case "FnReturn":
    case "AsyncFn":
      return break_value(locator.check(origin.parent));
    case "TyAlias": {
      if (origin.in_assoc_ty) {
        const parent = origin.parent;
        const impl_def_id = tcx.local_parent(parent);
        for (const assoc of AssocItems.in_definition_order(tcx.associated_items(impl_def_id) as AssocItems)) {
          switch (assoc.kind.$) {
            case "Const":
            case "Fn": {
              const r = locator.check(assoc.def_id.expect_local());
              if (r.$ === "Break") {
                const span = r._0;
                return span;
              }
              break;
            }
            case "Type":
              break;
          }
        }

        return undefined;
      }
      return break_value(tcx.hir_walk_toplevel_module(locator));
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:527 sanity_check_found_hidden_type
function sanity_check_found_hidden_type(tcx: TyCtxt, key: OpaqueTypeKey, ty_: ProvisionalHiddenType): Result<null, ErrorGuaranteed> {
  // PORT: `mut ty`: the fields of `ProvisionalHiddenType` are readonly, so the reassigned `ty.ty` is a fresh value.
  let ty = ty_;
  if (ty.ty.is_ty_var()) {
    // Nothing was actually constrained.
    return Ok(null);
  }
  const k = ty.ty.kind();
  if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
    const def_id = k._1.kind.def_id;
    const args = k._1.args;
    if (DefId_eq(def_id, LocalDefId.to_def_id(key.def_id)) && args === key.args) {
      // Nothing was actually constrained, this is an opaque usage that was
      // only discovered to be opaque after inference vars resolved.
      return Ok(null);
    }
  }
  const erase_re_vars = (ty: Ty): Ty =>
    fold_regions(
      tcx,
      ty,
      (r, _) => {
        if (r.kind().$ === "ReVar") return tcx.lifetimes.re_erased;
        return r;
      },
      fold_Ty,
    );
  // Closures frequently end up containing erased lifetimes in their final representation.
  // These correspond to lifetime variables that never got resolved, so we patch this up here.
  ty = new ProvisionalHiddenType(ty.span, erase_re_vars(ty.ty));
  // Get the hidden type.
  const hidden_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(key.def_id) as EarlyBinder<Ty>, tcx, key.args, fold_Ty));
  const hidden_ty = erase_re_vars(hidden_ty_);

  // If the hidden types differ, emit a type mismatch diagnostic.
  if (hidden_ty === ty.ty) {
    return Ok(null);
  } else {
    const span = tcx.def_span(key.def_id);
    const other = new ProvisionalHiddenType(span, hidden_ty);
    const r = ty.build_mismatch_error(other, tcx);
    if (r.$ === "Err") return r;
    return Err(r._0.emit_err());
  }
}

/// Check that the opaque's precise captures list is valid (if present).
/// We check this for regular `impl Trait`s and also RPITITs, even though the latter
/// are technically GATs.
///
/// This function is responsible for:
/// 1. Checking that all type/const params are mention in the captures list.
/// 2. Checking that all lifetimes that are implicitly captured are mentioned.
/// 3. Asserting that all parameters mentioned in the captures list are invariant.
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:574 check_opaque_precise_captures
function check_opaque_precise_captures(tcx: TyCtxt, opaque_def_id: LocalDefId): void {
  const { bounds } = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(opaque_def_id));
  let precise_capturing_args: readonly hir.PreciseCapturingArg[] | undefined;
  for (const bound of bounds) {
    if (bound.$ === "Use") {
      precise_capturing_args = bound._0;
      break;
    }
  }
  if (precise_capturing_args === undefined) {
    // No precise capturing args; nothing to validate
    return;
  }

  const expected_captures = new DefIdSet();
  const shadowed_captures = new DefIdSet();
  // `UnordMap<Ident, Span>`: keyed by `Ident`'s `Eq`/`Hash` (the name and the span's `SyntaxContext`).
  const seen_params = new KeyedMap<Ident, Span>((i) => `${i.name}:${Span.ctxt(i.span)}`);
  let prev_non_lifetime_param: Ident | undefined = undefined;
  for (const arg of precise_capturing_args) {
    let hir_id: HirId;
    let ident_: Ident;
    switch (arg.$) {
      case "Param": {
        ({ hir_id, ident: ident_ } = arg._0);
        if (prev_non_lifetime_param === undefined) {
          prev_non_lifetime_param = ident_;
        }
        break;
      }
      case "Lifetime": {
        ({ hir_id, ident: ident_ } = arg._0);
        if (prev_non_lifetime_param !== undefined) {
          // tcx.dcx().emit_err(diagnostics::LifetimesMustBeFirst {
          //     lifetime_span: ident.span,
          //     name: ident.name,
          //     other_span: prev_non_lifetime_param.span,
          // });
          // PORT: `LifetimesMustBeFirst` is in diagnostics/precise_captures.rs, which is in no codegen set.
          return unported("rustc_hir_analysis::diagnostics::precise_captures::LifetimesMustBeFirst");
        }
        break;
      }
    }

    const ident = ident_.normalize_to_macros_2_0();
    const prev = seen_params.get(ident);
    seen_params.set(ident, ident.span);
    if (prev !== undefined) {
      // tcx.dcx().emit_err(diagnostics::DuplicatePreciseCapture {
      //     name: ident.name,
      //     first_span: span,
      //     second_span: ident.span,
      // });
      // PORT: `DuplicatePreciseCapture` is in diagnostics/precise_captures.rs, which is in no codegen set.
      return unported("rustc_hir_analysis::diagnostics::precise_captures::DuplicatePreciseCapture");
    }

    const resolved = tcx.named_bound_var(hir_id);
    if (resolved !== undefined && resolved.$ === "EarlyBound") {
      const def_id = resolved._0;
      expected_captures.add(LocalDefId.to_def_id(def_id));

      // Make sure we allow capturing these lifetimes through `Self` and
      // `T::Assoc` projection syntax, too. These will occur when we only
      // see lifetimes are captured after hir-lowering -- this aligns with
      // the cases that were stabilized with the `impl_trait_projection`
      // feature -- see <https://github.com/rust-lang/rust/pull/115659>.
      if (tcx.def_kind(def_id).$ === "LifetimeParam") {
        const def_id2 = tcx.map_opaque_lifetime_to_parent_lifetime(def_id).opt_param_def_id(tcx, tcx.parent(LocalDefId.to_def_id(opaque_def_id)));
        if (def_id2 !== undefined) {
          shadowed_captures.add(def_id2);
        }
      }
    } else {
      tcx.dcx().span_delayed_bug(tcx.hir_span(hir_id), "parameter should have been resolved");
    }
  }

  const variances = tcx.variances_of(opaque_def_id) as readonly Variance[];
  let def_id: DefId | undefined = LocalDefId.to_def_id(opaque_def_id);
  while (def_id !== undefined) {
    const generics = tcx.generics_of(def_id) as Generics;
    def_id = generics.parent;

    for (const param of generics.own_params) {
      if (expected_captures.has(param.def_id)) {
        assert_eq(variances[param.index], "Invariant", (v) => String(v));
        continue;
      }
      // If a param is shadowed by a early-bound (duplicated) lifetime, then
      // it may or may not be captured as invariant, depending on if it shows
      // up through `Self` or `T::Assoc` syntax.
      if (shadowed_captures.has(param.def_id)) {
        continue;
      }

      switch (param.kind.$) {
        case "Lifetime": {
          const use_span = tcx.def_span(param.def_id);
          const opaque_span = tcx.def_span(opaque_def_id);
          // Check if the lifetime param was captured but isn't named in the precise captures list.
          if (variances[param.index] === "Invariant") {
            let def_id3: DefId | undefined;
            if (
              tcx.def_kind(tcx.parent(param.def_id)).$ === "OpaqueTy" &&
              (def_id3 = tcx
                .map_opaque_lifetime_to_parent_lifetime(param.def_id.expect_local())
                .opt_param_def_id(tcx, tcx.parent(LocalDefId.to_def_id(opaque_def_id)))) !== undefined
            ) {
              // tcx.dcx().emit_err(diagnostics::LifetimeNotCaptured {
              //     opaque_span,
              //     use_span,
              //     param_span: tcx.def_span(def_id),
              // });
              void def_id3;
              void use_span;
              // PORT: `LifetimeNotCaptured` is in diagnostics/precise_captures.rs, which is in no codegen set.
              return unported("rustc_hir_analysis::diagnostics::precise_captures::LifetimeNotCaptured");
            } else {
              if (tcx.def_kind(tcx.parent(param.def_id)).$ === "Trait") {
                // tcx.dcx().emit_err(diagnostics::LifetimeImplicitlyCaptured {
                //     opaque_span,
                //     param_span: tcx.def_span(param.def_id),
                // });
                // PORT: `LifetimeImplicitlyCaptured` is in diagnostics/precise_captures.rs, which is in no codegen set.
                return unported("rustc_hir_analysis::diagnostics::precise_captures::LifetimeImplicitlyCaptured");
              } else {
                // If the `use_span` is actually just the param itself, then we must
                // have not duplicated the lifetime but captured the original.
                // The "effective" `use_span` will be the span of the opaque itself,
                // and the param span will be the def span of the param.
                // tcx.dcx().emit_err(diagnostics::LifetimeNotCaptured {
                //     opaque_span,
                //     use_span: opaque_span,
                //     param_span: use_span,
                // });
                void opaque_span;
                // PORT: `LifetimeNotCaptured` is in diagnostics/precise_captures.rs, which is in no codegen set.
                return unported("rustc_hir_analysis::diagnostics::precise_captures::LifetimeNotCaptured");
              }
            }
            continue;
          }
          break;
        }
        case "Type": {
          const dk = tcx.def_kind(param.def_id);
          if (dk.$ === "Trait" || dk.$ === "TraitAlias") {
            // FIXME(precise_capturing): Structured suggestion for this would be useful
            // tcx.dcx().emit_err(diagnostics::SelfTyNotCaptured {
            //     trait_span: tcx.def_span(param.def_id),
            //     opaque_span: tcx.def_span(opaque_def_id),
            // });
            // PORT: `SelfTyNotCaptured` is in diagnostics/precise_captures.rs, which is in no codegen set.
            return unported("rustc_hir_analysis::diagnostics::precise_captures::SelfTyNotCaptured");
          } else {
            // FIXME(precise_capturing): Structured suggestion for this would be useful
            // tcx.dcx().emit_err(diagnostics::ParamNotCaptured {
            //     param_span: tcx.def_span(param.def_id),
            //     opaque_span: tcx.def_span(opaque_def_id),
            //     kind: "type",
            // });
            // PORT: `ParamNotCaptured` is in diagnostics/precise_captures.rs, which is in no codegen set.
            return unported("rustc_hir_analysis::diagnostics::precise_captures::ParamNotCaptured");
          }
          break;
        }
        case "Const": {
          // FIXME(precise_capturing): Structured suggestion for this would be useful
          // tcx.dcx().emit_err(diagnostics::ParamNotCaptured {
          //     param_span: tcx.def_span(param.def_id),
          //     opaque_span: tcx.def_span(opaque_def_id),
          //     kind: "const",
          // });
          // PORT: `ParamNotCaptured` is in diagnostics/precise_captures.rs, which is in no codegen set.
          return unported("rustc_hir_analysis::diagnostics::precise_captures::ParamNotCaptured");
          break;
        }
      }
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:733 is_enum_of_nonnullable_ptr
function is_enum_of_nonnullable_ptr(tcx: TyCtxt, adt_def: AdtDef, args: GenericArgs): boolean {
  if (adt_def.repr().inhibit_enum_layout_opt()) {
    return false;
  }

  const variants = adt_def.variants();
  if (variants.length !== 2) {
    return false;
  }
  const [var_one, var_two] = [variants[0]!, variants[1]!];
  let field: FieldDef;
  if (var_one.fields.length === 0 && var_two.fields.length === 1) {
    field = var_two.fields[0]!;
  } else if (var_one.fields.length === 1 && var_two.fields.length === 0) {
    field = var_one.fields[0]!;
  } else {
    return false;
  }
  const k = Unnormalized.skip_norm_wip(field.ty(tcx, args)).kind();
  return k.$ === "FnPtr" || k.$ === "Ref";
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:751 check_static_linkage
function check_static_linkage(tcx: TyCtxt, def_id: LocalDefId): void {
  if ((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).import_linkage !== undefined) {
    const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)).kind();
    let bad: boolean;
    switch (k.$) {
      case "RawPtr":
        bad = false;
        break;
      case "Adt":
        bad = !is_enum_of_nonnullable_ptr(tcx, k._0, k._1);
        break;
      default:
        bad = true;
        break;
    }
    if (bad) {
      tcx.dcx().emit_err(diagnostics.LinkageType_diagnostic({ span: tcx.def_span(def_id) }));
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:763 check_item_type
export function check_item_type(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  let res: Result<null, ErrorGuaranteed> = Ok(null);
  const generics = tcx.generics_of(def_id) as Generics;

  for (const param of generics.own_params) {
    const kind = param.kind;
    switch (kind.$) {
      case "Lifetime":
        break;
      case "Type": {
        if (kind.has_default) {
          tcx.ensure_ok().type_of(param.def_id);
        }
        break;
      }
      case "Const": {
        tcx.ensure_ok().type_of(param.def_id);
        if (kind.has_default) {
          // need to store default and type of default
          const ct = EarlyBinder.skip_binder(tcx.const_param_default(param.def_id) as EarlyBinder<Const>);
          const ck = ct.kind();
          if (ck.$ === "Alias") {
            const alias_const = ck._1;
            let def_id: DefId;
            const ak = alias_const.kind;
            switch (ak.$) {
              case "Projection":
                def_id = ak.def_id;
                break;
              case "InherentSelf":
                // NOTE: typically, InherentSelf is illegal to pass to type_of,
                // because the generic args are incorrect (type_of expects impl-form
                // arguments). However, we are just checking ensure_ok().type_of(),
                // we are not instantiating the result, so it's OK here.
                def_id = ak.def_id;
                break;
              case "InherentImpl":
                return span_bug(
                  tcx.def_span(param.def_id),
                  "const_param_default should return an unnormalized constant, which should always be InherentSelf, not InherentImpl",
                );
              case "Free":
                def_id = ak.def_id;
                break;
              case "Anon":
                def_id = ak.def_id;
                break;
            }
            tcx.ensure_ok().type_of(def_id);
          }
        }
        break;
      }
    }
  }

  const def_kind = tcx.def_kind(def_id);
  switch (def_kind.$) {
    case "Static": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);

      check_static_inhabited(tcx, def_id);
      check_static_linkage(tcx, def_id);
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
      res = and(res, wfcheck.check_static_item(tcx, def_id, ty, /* should_check_for_sync */ true));

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "Enum": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      collect().check_enum_variant_types(tcx, def_id);
      check_enum(tcx, def_id);
      wfcheck.check_variances_for_type_defn(tcx, def_id);
      res = and(res, wfcheck.check_type_defn(tcx, def_id, true));
      // enums are fully handled by the type based check and have no hir wfcheck logic
      return res;
    }
    case "Fn": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      tcx.ensure_ok().fn_sig(def_id);
      tcx.ensure_ok().codegen_fn_attrs(def_id);
      const i = tcx.intrinsic(def_id);
      if (i !== undefined) {
        intrinsic.check_intrinsic_type(tcx, def_id, unwrap(tcx.def_ident_span(def_id)), (i as unknown as IntrinsicDefView).name);
      }
      break;
    }
    case "Impl": {
      const of_trait = def_kind.of_trait;
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      tcx.ensure_ok().associated_items(def_id);
      if (of_trait) {
        const impl_trait_header = tcx.impl_trait_header(def_id) as ImplTraitHeader;
        res = and(res, tcx.ensure_result().coherent_trait(EarlyBinder.skip_binder(impl_trait_header.trait_ref).def_id));

        if (res.$ === "Ok") {
          // Checking this only makes sense if the all trait impls satisfy basic
          // requirements (see `coherent_trait` query), otherwise
          // we run into infinite recursions a lot.
          check_impl_items_against_trait(tcx, def_id, impl_trait_header);
        }
      }
      break;
    }
    case "Trait": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().trait_def(def_id);
      tcx.ensure_ok().explicit_super_clauses_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      tcx.ensure_ok().associated_items(def_id);
      const assoc_items = tcx.associated_items(def_id) as AssocItems;

      for (const assoc_item of AssocItems.in_definition_order(assoc_items)) {
        switch (assoc_item.kind.$) {
          case "Type":
            if (Defaultness.has_value(AssocItem.defaultness(assoc_item, tcx))) {
              const trait_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
              void compare_impl_item.check_type_bounds(tcx, assoc_item, assoc_item, TraitRefC.new_from_args(as_interner(tcx), LocalDefId.to_def_id(def_id), trait_args));
            }
            break;
          case "Const":
            if (Defaultness.has_value(AssocItem.defaultness(assoc_item, tcx))) {
              void compare_impl_item.compare_const_directness(tcx, assoc_item, assoc_item);
            }
            break;
          default:
            break;
        }
      }
      res = and(res, wfcheck.check_trait(tcx, def_id));
      wfcheck.check_gat_where_clauses(tcx, def_id);
      // Trait aliases do not have hir checks anymore
      return res;
    }
    case "TraitAlias": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().explicit_implied_clauses_of(def_id);
      tcx.ensure_ok().explicit_super_clauses_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      res = and(res, wfcheck.check_trait(tcx, def_id));
      // Trait aliases do not have hir checks anymore
      return res;
    }
    case "Struct":
    case "Union": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);

      const adt = (tcx.adt_def(def_id) as AdtDef).non_enum_variant();
      for (const f of adt.fields) {
        tcx.ensure_ok().generics_of(f.did);
        tcx.ensure_ok().type_of(f.did);
        tcx.ensure_ok().clauses_of(f.did);
      }

      if (adt.ctor !== undefined) {
        const [, ctor_def_id] = adt.ctor;
        collect().check_ctor(tcx, ctor_def_id.expect_local());
      }
      wfcheck.check_variances_for_type_defn(tcx, def_id);
      let r: Result<null, ErrorGuaranteed>;
      switch (def_kind.$) {
        case "Struct":
          r = check_struct(tcx, def_id);
          break;
        case "Union":
          r = check_union(tcx, def_id);
          break;
      }
      res = and(res, r);
      // structs and enums are fully handled by the type based check and have no hir wfcheck logic
      return res;
    }
    case "OpaqueTy": {
      check_opaque_precise_captures(tcx, def_id);

      const origin = tcx.local_opaque_ty_origin(def_id) as hir.OpaqueTyOrigin<LocalDefId>;
      let skip = false;
      if (origin.$ === "FnReturn" || origin.$ === "AsyncFn") {
        const fn_def_id = origin.parent;
        const node = tcx.hir_node_by_def_id(fn_def_id);
        if (node.$ === "TraitItem") {
          const trait_item = node._0;
          const [, trait_fn] = trait_item.expect_fn();
          if (trait_fn.$ === "Required") {
            skip = true;
          }
        }
      }
      if (skip) {
        // Skip opaques from RPIT in traits with no default body.
      } else {
        check_opaque(tcx, def_id);
      }

      tcx.ensure_ok().clauses_of(def_id);
      tcx.ensure_ok().explicit_item_bounds(def_id);
      tcx.ensure_ok().explicit_item_self_bounds(def_id);
      if (tcx.is_conditionally_const(LocalDefId.to_def_id(def_id))) {
        tcx.ensure_ok().explicit_implied_const_bounds(def_id);
        tcx.ensure_ok().const_conditions(def_id);
      }

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "Const": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);

      res = and(
        res,
        wfcheck.enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
          const ty = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
          const ty_span = tcx.ty_span(def_id);
          const ty_ = wfcx.deeply_normalize(ty_span, { $: "Ty", _0: def_id }, ty, fold_Ty);
          wfcx.register_wf_obligation(ty_span, { $: "Ty", _0: def_id }, ty_);
          wfcx.register_bound(
            ObligationCause.new(ty_span, def_id, ObligationCauseCode.SizedConstOrStatic),
            tcx.param_env(def_id) as ParamEnv,
            ty_,
            tcx.require_lang_item(LangItem.Sized, ty_span),
          );
          wfcheck.check_where_clauses(wfcx, def_id);
          return wfcheck.check_const_item(wfcx, def_id, ty_);
        }),
      );

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "TyAlias": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      const ty = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
      const span = tcx.def_span(def_id);
      if (tcx.type_alias_is_checked(def_id)) {
        res = and(
          res,
          wfcheck.enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
            const item_ty = wfcx.deeply_normalize(span, { $: "Ty", _0: def_id }, ty, fold_Ty);
            wfcx.register_wf_obligation(span, { $: "Ty", _0: def_id }, item_ty);
            wfcheck.check_where_clauses(wfcx, def_id);
            return Ok(null);
          }),
        );
      } else {
        check_type_alias_type_params_are_used(tcx, def_id);
        res = and(
          res,
          wfcheck.enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
            // HACK: We sometimes incidentally check that const arguments have the correct
            // type as a side effect of the anon const desugaring. To make this "consistent"
            // for users we explicitly check `ConstArgHasType` clauses so that const args
            // that don't go through an anon const still have their types checked.
            //
            // We use the unnormalized type as this mirrors the behaviour that we previously
            // would have had when all const arguments were anon consts.
            //
            // Changing this to normalized obligations is a breaking change:
            // `type Bar = [(); panic!()];` would become an error
            const unnormalized_obligations = wfcx.unnormalized_obligations(span, Unnormalized.skip_norm_wip(ty));
            if (unnormalized_obligations !== undefined) {
              const filtered_obligations = unnormalized_obligations.filter((o) => {
                const k = Binder.skip_binder(o.predicate.kind());
                return k.$ === "Clause" && k._0.$ === "ConstArgHasType" && k._0._0.kind().$ === "Param";
              });
              wfcx.ocx.register_obligations(filtered_obligations);
            }
            return Ok(null);
          }),
        );
      }

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "ForeignMod": {
      const it = tcx.hir_expect_item(def_id);
      if (it.kind.$ !== "ForeignMod") {
        return Ok(null);
      }
      const { abi, items } = it.kind;

      check_abi(tcx, it.hir_id(), it.span, abi);

      for (const item of items) {
        const def_id = item.owner_id.def_id;

        const generics = tcx.generics_of(def_id) as Generics;
        const own_counts = generics.own_counts();
        if (generics.own_params.length - own_counts.lifetimes !== 0) {
          let kinds: string;
          let kinds_pl: string;
          let egs: string | undefined;
          if (own_counts.consts === 0) {
            [kinds, kinds_pl, egs] = ["type", "types", "u32"];
          } else if (own_counts.types === 0) {
            // We don't specify an example value, because we can't generate
            // a valid value for any type.
            [kinds, kinds_pl, egs] = ["const", "consts", undefined];
          } else {
            [kinds, kinds_pl, egs] = ["type or const", "types or consts", undefined];
          }
          const name =
            find_attr(tcx.get_all_attrs(LocalDefId.to_def_id(def_id)), (k) => (k.$ === "RustcEiiForeignItem" ? null : undefined)) !== undefined
              ? "externally implementable items"
              : "foreign items";

          const span = tcx.def_span(def_id);
          struct_span_code_err(tcx.dcx(), span, E0044, `${name} may not have ${kinds} parameters`)
            .with_span_label(span, `can't have ${kinds} parameters`)
            .with_help(
              // FIXME: once we start storing spans for type arguments, turn this
              // into a suggestion.
              `replace the ${kinds} parameters with concrete ${kinds_pl}${egs !== undefined ? ` like \`${egs}\`` : ""}`,
            )
            .emit();
        }

        tcx.ensure_ok().generics_of(def_id);
        tcx.ensure_ok().type_of(def_id);
        tcx.ensure_ok().clauses_of(def_id);
        if (tcx.is_conditionally_const(LocalDefId.to_def_id(def_id))) {
          tcx.ensure_ok().explicit_implied_const_bounds(def_id);
          tcx.ensure_ok().const_conditions(def_id);
        }
        switch (tcx.def_kind(def_id).$) {
          case "Fn": {
            tcx.ensure_ok().codegen_fn_attrs(def_id);
            tcx.ensure_ok().fn_sig(def_id);
            const item_ = tcx.hir_foreign_item(item);
            if (item_.kind.$ !== "Fn") {
              return bug();
            }
            const sig = item_.kind._0;
            check_c_variadic_abi(tcx, sig.decl, abi, item_.span);
            break;
          }
          case "Static": {
            tcx.ensure_ok().codegen_fn_attrs(def_id);
            break;
          }
          default:
            break;
        }
      }
      // Doesn't have any hir based checks
      return res;
    }
    case "Closure": {
      // This is guaranteed to be called by metadata encoding,
      // we still call it in wfcheck eagerly to ensure errors in codegen
      // attrs prevent lints from spamming the output.
      tcx.ensure_ok().codegen_fn_attrs(def_id);
      // We do not call `type_of` for closures here as that
      // depends on typecheck and would therefore hide
      // any further errors in case one typeck fails.

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "AssocFn": {
      tcx.ensure_ok().codegen_fn_attrs(def_id);
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().fn_sig(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      res = and(res, wfcheck.check_associated_item(tcx, def_id));
      const assoc_item = tcx.associated_item(def_id) as AssocItem;
      switch (assoc_item.container.$) {
        case "InherentImpl":
        case "TraitImpl":
          break;
        case "Trait": {
          res = and(res, wfcheck.check_trait_item(tcx, def_id));
          break;
        }
      }

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "AssocConst": {
      tcx.ensure_ok().type_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      res = and(res, wfcheck.check_associated_item(tcx, def_id));
      const assoc_item = tcx.associated_item(def_id) as AssocItem;
      switch (assoc_item.container.$) {
        case "InherentImpl":
        case "TraitImpl":
          break;
        case "Trait": {
          res = and(res, wfcheck.check_trait_item(tcx, def_id));
          break;
        }
      }

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "AssocTy": {
      tcx.ensure_ok().clauses_of(def_id);
      res = and(res, wfcheck.check_associated_item(tcx, def_id));

      const assoc_item = tcx.associated_item(def_id) as AssocItem;
      let has_type = false;
      switch (assoc_item.container.$) {
        case "InherentImpl":
        case "TraitImpl":
          has_type = true;
          break;
        case "Trait": {
          tcx.ensure_ok().explicit_item_bounds(def_id);
          tcx.ensure_ok().explicit_item_self_bounds(def_id);
          if (tcx.is_conditionally_const(LocalDefId.to_def_id(def_id))) {
            tcx.ensure_ok().explicit_implied_const_bounds(def_id);
            tcx.ensure_ok().const_conditions(def_id);
          }
          res = and(res, wfcheck.check_trait_item(tcx, def_id));
          has_type = Defaultness.has_value(AssocItem.defaultness(assoc_item, tcx));
          break;
        }
      }
      if (has_type) {
        tcx.ensure_ok().type_of(def_id);
      }

      // Only `Node::Item` and `Node::ForeignItem` still have HIR based
      // checks. Returning early here does not miss any checks and
      // avoids this query from having a direct dependency edge on the HIR
      return res;
    }
    case "TestBinderConstraints": {
      tcx.ensure_ok().generics_of(def_id);
      tcx.ensure_ok().clauses_of(def_id);
      const [, body] = hir.Node.expect_item(tcx.hir_node_by_def_id(def_id)).expect_test_binder_constraints();
      const icx = ItemCtxt.new(tcx, def_id);
      const lowered = icx.lower_test_binder_body(body);
      res = and(
        res,
        wfcheck.enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
          wfcx.check_test_binder_body(lowered);
          return Ok(null);
        }),
      );
      return res;
    }

    // These have no wf checks
    case "AnonConst":
    case "ExternCrate":
    case "Macro":
    case "Use":
    case "GlobalAsm":
    case "Mod":
      return res;

    case "ForeignTy":
      break;

    case "Variant":
    case "TyParam":
    case "ConstParam":
    case "Ctor":
    case "Field":
    case "LifetimeParam":
    case "SyntheticCoroutineBody":
      return unreachable(`internal error: entered unreachable code: ${debug_LocalDefId(def_id, PLAIN)}: ${debug_DefKind(tcx.def_kind(def_id), PLAIN)}`);
  }
  const node = tcx.hir_node_by_def_id(def_id);
  let r: Result<null, ErrorGuaranteed>;
  switch (node.$) {
    case "Crate":
      return bug("check_well_formed cannot be applied to the crate root");
    case "Item":
      r = wfcheck.check_item(tcx, node._0);
      break;
    case "ForeignItem":
      r = wfcheck.check_foreign_item(tcx, node._0);
      break;
    default:
      return unreachable(`internal error: entered unreachable code: ${debug_Node(node, PLAIN)}`);
  }
  return and(res, r);
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1223 check_specialization_validity
function check_specialization_validity(tcx: TyCtxt, trait_def: TraitDef, trait_item: AssocItem, impl_id: DefId, impl_item: DefId): void {
  const ancestors_ = trait_def.ancestors(tcx, impl_id);
  if (ancestors_.$ !== "Ok") return;
  const ancestors = ancestors_._0;
  // `ancestors.skip(1)`
  ancestors.next();
  // `.filter_map(|parent| ..)` and `.find_map(|(parent_impl, parent_item)| ..)`, fused into one loop (both lazy).
  let opt_result: Result<null, DefId> | undefined = undefined;
  for (let parent = ancestors.next(); parent !== undefined; parent = ancestors.next()) {
    if (Node_.is_from_trait(parent)) {
      continue;
    }
    const [parent_impl, parent_item] = [parent, Node_.item(parent, tcx, trait_item.def_id)];
    let r: Result<null, DefId> | undefined;
    if (parent_item !== undefined && impl_item_is_final(tcx, parent_item)) {
      // Parent impl exists, and contains the parent item we're trying to specialize, but
      // doesn't mark it `default`.
      r = Err(Node_.def_id(parent_impl));
    } else if (parent_item !== undefined) {
      // Parent impl contains item and makes it specializable.
      r = Ok(null);
    } else {
      // Parent impl doesn't mention the item. This means it's inherited from the
      // grandparent. In that case, if parent is a `default impl`, inherited items use the
      // "defaultness" from the grandparent, else they are final.
      if (Defaultness.is_default(tcx.defaultness(Node_.def_id(parent_impl)) as Defaultness)) {
        r = undefined;
      } else {
        r = Err(Node_.def_id(parent_impl));
      }
    }
    if (r !== undefined) {
      opt_result = r;
      break;
    }
  }

  // If `opt_result` is `None`, we have only encountered `default impl`s that don't contain the
  // item. This is allowed, the item isn't actually getting specialized here.
  const result = opt_result ?? Ok(null);

  if (result.$ === "Err") {
    const parent_impl = result._0;
    if (!tcx.is_impl_trait_in_trait(impl_item)) {
      const span = tcx.def_span(impl_item);
      const ident = tcx.item_ident(impl_item);

      const sp = tcx.span_of_impl(parent_impl);
      const err: diagnostics.ImplNotMarkedDefault =
        sp.$ === "Ok" ? { $: "Ok", span, ident, ok_label: sp._0 } : { $: "Err", span, ident, cname: sp._0 };

      tcx.dcx().emit_err(diagnostics.ImplNotMarkedDefault_diagnostic(err));
    } else {
      tcx.dcx().delayed_bug(`parent item: ${debug_DefId(parent_impl, PLAIN)} not marked as default`);
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1284 check_overriding_final_trait_item
function check_overriding_final_trait_item(tcx: TyCtxt, trait_item: AssocItem, impl_item: AssocItem): void {
  if (AssocItem.is_fn(trait_item) && Defaultness.is_final(AssocItem.defaultness(trait_item, tcx))) {
    tcx.dcx().emit_err(
      diagnostics.OverridingFinalTraitFunction_diagnostic({
        impl_span: tcx.def_span(impl_item.def_id),
        trait_span: tcx.def_span(trait_item.def_id),
        ident: tcx.item_ident(impl_item.def_id),
      }),
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1298 check_impl_items_against_trait
function check_impl_items_against_trait(tcx: TyCtxt, impl_id: LocalDefId, impl_trait_header: ImplTraitHeader): void {
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(impl_trait_header.trait_ref));
  // If the trait reference itself is erroneous (so the compilation is going
  // to fail), skip checking the items here -- the `impl_item` table in `tcx`
  // isn't populated for such impls.
  if (TypeVisitableExt.references_error(trait_ref, TraitRef_visitable)) {
    return;
  }

  const impl_item_refs = tcx.associated_item_def_ids(impl_id) as readonly DefId[];

  // Negative impls are not expected to have any items
  switch (impl_trait_header.polarity) {
    case "Positive":
      break;
    case "Negative": {
      const first_item_ref = impl_item_refs[0];
      if (first_item_ref !== undefined) {
        const first_item_span = tcx.def_span(first_item_ref);
        struct_span_code_err(tcx.dcx(), first_item_span, E0749, "negative impls cannot have any items").emit();
      }
      return;
    }
    default:
      break;
  }

  const trait_def = tcx.trait_def(trait_ref.def_id) as TraitDef;

  const self_is_guaranteed_unsize_self = tcx.impl_self_is_guaranteed_unsized(impl_id);

  for (const impl_item of impl_item_refs) {
    const ty_impl_item = tcx.associated_item(impl_item) as AssocItem;
    const trait_item_id = AssocItem.expect_trait_impl(ty_impl_item);
    let ty_trait_item: AssocItem;
    if (trait_item_id.$ === "Ok") {
      ty_trait_item = tcx.associated_item(trait_item_id._0) as AssocItem;
    } else {
      continue;
    }

    const res = tcx.ensure_result().compare_impl_item(impl_item.expect_local());
    if (res.$ === "Ok") {
      switch (ty_impl_item.kind.$) {
        case "Fn": {
          compare_impl_item.refine.check_refining_return_position_impl_trait_in_trait(
            tcx,
            ty_impl_item,
            ty_trait_item,
            Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(AssocItem.container_id(ty_impl_item, tcx)) as EarlyBinder<TraitRef>)),
          );
          break;
        }
        case "Const":
          break;
        case "Type":
          break;
      }
    }

    if (self_is_guaranteed_unsize_self && tcx.generics_require_sized_self(ty_trait_item.def_id)) {
      tcx.emit_node_span_lint(
        DEAD_CODE,
        tcx.local_def_id_to_hir_id(ty_impl_item.def_id.expect_local()),
        tcx.def_span(ty_impl_item.def_id),
        diagnostics.UselessImplItem_diagnostic({}),
      );
    }

    check_specialization_validity(tcx, trait_def, ty_trait_item, LocalDefId.to_def_id(impl_id), impl_item);

    check_overriding_final_trait_item(tcx, ty_trait_item, ty_impl_item);
  }

  const ancestors_ = trait_def.ancestors(tcx, LocalDefId.to_def_id(impl_id));
  if (ancestors_.$ === "Ok") {
    const ancestors = ancestors_._0;
    // Check for missing items from trait
    const missing_items: AssocItem[] = [];

    let must_implement_one_of: readonly Ident[] | undefined = trait_def.must_implement_one_of;

    for (const trait_item_id of tcx.associated_item_def_ids(trait_ref.def_id) as readonly DefId[]) {
      // PORT: `Ancestors` is `Copy` and `leaf_def` takes `self`: each call walks a copy.
      const leaf_def = clone_Ancestors(ancestors).leaf_def(tcx, trait_item_id);

      const is_implemented = leaf_def !== undefined && Defaultness.has_value(AssocItem.defaultness(leaf_def.item, tcx));

      if (
        !is_implemented &&
        Defaultness.is_final(tcx.defaultness(impl_id) as Defaultness) &&
        // unsized types don't need to implement methods that have `Self: Sized` bounds.
        !(self_is_guaranteed_unsize_self && tcx.generics_require_sized_self(trait_item_id))
      ) {
        missing_items.push(tcx.associated_item(trait_item_id) as AssocItem);
      }

      // true if this item is specifically implemented in this impl
      const is_implemented_here = leaf_def !== undefined && !Node_.is_from_trait(leaf_def.defining_node);

      if (!is_implemented_here) {
        const full_impl_span = tcx.hir_span_with_body(tcx.local_def_id_to_hir_id(impl_id));
        const eval_ = tcx.eval_default_body_stability(trait_item_id, full_impl_span);
        switch (eval_.$) {
          // When the feature `pin_ergonomics` is disabled, we report `Drop::drop` is missing,
          // instead of `Drop::drop` is unstable that might be confusing.
          case "Deny": {
            if (!tcx.features().pin_ergonomics() && tcx.is_lang_item(trait_ref.def_id, LangItem.Drop) && tcx.item_name(trait_item_id) === sym.drop) {
              missing_items.push(tcx.associated_item(trait_item_id) as AssocItem);
            } else {
              const { feature, reason, issue } = eval_;
              default_body_is_unstable(tcx, full_impl_span, trait_item_id, feature, reason, issue);
            }
            break;
          }

          // Unmarked default bodies are considered stable (at least for now).
          case "Allow":
          case "Unmarked":
            break;
        }
      }

      if (must_implement_one_of !== undefined) {
        const required_items = must_implement_one_of;
        if (is_implemented_here) {
          const trait_item = tcx.associated_item(trait_item_id) as AssocItem;
          const ident = AssocItem.ident(trait_item, tcx);
          if (required_items.some((i) => i.eq(ident))) {
            must_implement_one_of = undefined;
          }
        }
      }

      if (leaf_def !== undefined && !leaf_def.is_final()) {
        const def_id = leaf_def.item.def_id;
        if (tcx.impl_method_has_trait_impl_trait_tys(def_id)) {
          const def_kind = tcx.def_kind(def_id);
          const descr = tcx.def_kind_descr(def_kind, def_id);
          let msg: string;
          let feature: string;
          if (Asyncness.is_async(tcx.asyncness(def_id) as Asyncness)) {
            [msg, feature] = [`async ${descr} in trait cannot be specialized`, "async functions in traits"];
          } else {
            [msg, feature] = [`${descr} with return-position \`impl Trait\` in trait cannot be specialized`, "return position `impl Trait` in traits"];
          }
          tcx
            .dcx()
            .struct_span_err(tcx.def_span(def_id), msg)
            .with_note(`specialization behaves in inconsistent and surprising ways with ${feature}, and for now is disallowed`)
            .emit();
        }
      }
    }

    if (missing_items.length !== 0) {
      missing_items_err(tcx, impl_id, missing_items);
    }

    if (must_implement_one_of !== undefined) {
      const missing_items = must_implement_one_of;
      const attr_span = find_attr(tcx.get_all_attrs(trait_ref.def_id), (k) => (k.$ === "RustcMustImplementOneOf" ? k.attr_span : undefined));
      const missing_items_ = missing_items.map((i) => i.name);
      missing_items_must_implement_one_of_err(tcx, impl_id, missing_items_, attr_span);
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1483 check_simd
function check_simd(tcx: TyCtxt, sp: Span, def_id: LocalDefId): void {
  const t = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
  const tk = t.kind();
  if (tk.$ === "Adt" && tk._0.is_struct()) {
    const [def, args] = [tk._0, tk._1];
    const fields = def.non_enum_variant().fields;
    if (fields.length === 0) {
      struct_span_code_err(tcx.dcx(), sp, E0075, "SIMD vector cannot be empty").emit();
      return;
    }

    const array_field = fields[FieldIdx_ZERO]!;
    const array_ty = Unnormalized.skip_norm_wip(array_field.ty(tcx, args));
    const ak = array_ty.kind();
    if (ak.$ !== "Array") {
      struct_span_code_err(tcx.dcx(), sp, E0076, "SIMD vector's only field must be an array").with_span_label(tcx.def_span(array_field.did), "not an array").emit();
      return;
    }
    const [element_ty, len_const] = [ak._0, ak._1];

    const second_field = fields[FieldIdx_ONE];
    if (second_field !== undefined) {
      struct_span_code_err(tcx.dcx(), sp, E0075, "SIMD vector cannot have multiple fields").with_span_label(tcx.def_span(second_field.did), "excess field").emit();
      return;
    }

    // FIXME(repr_simd): This check is nice, but perhaps unnecessary due to the fact
    // we do not expect users to implement their own `repr(simd)` types. If they could,
    // this check is easily side-steppable by hiding the const behind normalization.
    // The consequence is that the error is, in general, only observable post-mono.
    const len = len_const.try_to_target_usize(tcx);
    if (len !== undefined) {
      if (len === 0) {
        struct_span_code_err(tcx.dcx(), sp, E0075, "SIMD vector cannot be empty").emit();
        return;
      } else if (len > MAX_SIMD_LANES) {
        struct_span_code_err(tcx.dcx(), sp, E0075, `SIMD vector cannot have more than ${MAX_SIMD_LANES} elements`).emit();
        return;
      }
    }

    // Check that we use types valid for use in the lanes of a SIMD "vector register"
    // These are scalar types which directly match a "machine" type
    // Yes: Integers, floats, "thin" pointers
    // No: char, "wide" pointers, compound types
    const ek = element_ty.kind();
    switch (ek.$) {
      case "Param":
        break; // pass struct<T>([T; 4]) through, let monomorphization catch errors
      case "Int":
      case "Uint":
      case "Float":
      case "RawPtr":
        break; // struct([u8; 4]) is ok
      default: {
        // So we can create structs like; `struct bfloat16x4_t (f16b x 4);`
        if (ek.$ === "Adt" && tcx.is_lang_item(ek._0.did(), LangItem.F16B)) {
          break;
        }
        struct_span_code_err(tcx.dcx(), sp, E0077, "SIMD vector element type should be a primitive scalar (integer/float/pointer) type").emit();
        return;
      }
    }
  }
}

// #[tracing::instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1560 check_scalable_vector
function check_scalable_vector(tcx: TyCtxt, span: Span, def_id: LocalDefId, scalable: ScalableElt): void {
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
  const tk = ty.kind();
  if (tk.$ !== "Adt") return;
  const [def, args] = [tk._0, tk._1];
  if (!def.is_struct()) {
    tcx.dcx().delayed_bug("`rustc_scalable_vector` applied to non-struct");
    return;
  }

  const fields = def.non_enum_variant().fields;
  if (scalable.$ === "ElementCount" && fields.length === 0) {
    const err = tcx.dcx().struct_span_err(span, "scalable vectors must have a single field");
    err.help("scalable vector types' only field must be a primitive scalar type");
    err.emit();
    return;
  } else if (scalable.$ === "ElementCount" && fields.length >= 2) {
    tcx.dcx().span_err(span, "scalable vectors cannot have multiple fields");
    return;
  } else if (scalable.$ === "Container" && fields.length === 0) {
    const err = tcx.dcx().struct_span_err(span, "scalable vector tuples must have at least one field");
    err.help("tuples of scalable vectors can only contain multiple of the same scalable vector type");
    err.emit();
    return;
  } else if (scalable.$ === "Container" && fields.length > 8) {
    const err = tcx.dcx().struct_span_err(span, "scalable vector tuples can have at most eight fields");
    err.help("tuples of scalable vectors can only contain multiple of the same scalable vector type");
    err.emit();
    return;
  }

  switch (scalable.$) {
    case "ElementCount": {
      const element_ty = Unnormalized.skip_norm_wip(fields[FieldIdx_ZERO]!.ty(tcx, args));

      // Check that `element_ty` only uses types valid in the lanes of a scalable vector
      // register: scalar types which directly match a "machine" type - integers, floats and
      // bools
      const ek = element_ty.kind();
      switch (ek.$) {
        case "Int":
        case "Uint":
        case "Float":
        case "Bool":
          break;
        default: {
          // We need to treat a `bfloat` (`f16b`) as a primitive scalar
          if (ek.$ === "Adt" && tcx.is_lang_item(ek._0.did(), LangItem.F16B)) {
            break;
          }
          const err = tcx.dcx().struct_span_err(span, "element type of a scalable vector must be a primitive scalar");
          err.help("only `u*`, `i*`, `f*` and `bool` types are accepted");
          err.emit();
          break;
        }
      }
      break;
    }
    case "Container": {
      let prev_field_ty: Ty | undefined = undefined;
      for (const field of fields) {
        const element_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
        const ek = element_ty.kind();
        if (ek.$ === "Adt" && ek._0.repr().is_scalable()) {
          const def = ek._0;
          const s = def.repr().scalable;
          if (s === undefined) {
            return panic("`repr().scalable.is_some()` != `repr().scalable()`");
          }
          let stop = false;
          switch (s.$) {
            case "ElementCount":
              /* expected field */
              break;
            case "Container": {
              tcx.dcx().span_err(tcx.def_span(field.did), "scalable vector structs cannot contain other scalable vector structs");
              stop = true;
              break;
            }
          }
          if (stop) break;
        } else {
          tcx.dcx().span_err(tcx.def_span(field.did), "scalable vector structs can only have scalable vector fields");
          break;
        }

        // `if let Some(prev_ty) = prev_field_ty.replace(element_ty) && prev_ty != element_ty`
        const prev_ty = prev_field_ty;
        prev_field_ty = element_ty;
        if (prev_ty !== undefined && prev_ty !== element_ty) {
          tcx.dcx().span_err(tcx.def_span(field.did), "all fields in a scalable vector struct must be the same type");
          break;
        }
      }
      break;
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1664 check_packed
function check_packed(tcx: TyCtxt, sp: Span, def_id: LocalDefId): void {
  const def = tcx.adt_def(def_id) as AdtDef;
  const repr = def.repr();
  if (repr.packed()) {
    // `#[pin_v2]` on a packed type is unsound: drop glue for a packed type moves an
    // over-aligned field to an aligned location before running its destructor, which would
    // move a structurally pinned field out from under a `Pin<&mut _>` that was handed out.
    if (def.is_pin_project()) {
      tcx.dcx().emit_err(
        diagnostics.PinV2OnPacked_diagnostic({
          span: sp,
          pin_v2_span: find_attr(tcx.get_all_attrs(def.did()), (k) => (k.$ === "PinV2" ? k._0 : undefined)),
          adt_name: tcx.item_name(def.did()),
        }),
      );
    }
    const reprs = find_attr(tcx.get_all_attrs(def.did()), (k) => (k.$ === "Repr" ? k.reprs : undefined));
    if (reprs !== undefined) {
      for (const [r] of reprs) {
        if (r.$ === "ReprPacked") {
          const pack = r._0;
          const repr_pack = repr.pack;
          if (repr_pack !== undefined && !Align_eq(pack, repr_pack)) {
            struct_span_code_err(tcx.dcx(), sp, E0634, "type has conflicting packed representation hints").emit();
          }
        }
      }
    }

    let def_spans: [DefId, Span][] | undefined;
    if (repr.align !== undefined) {
      struct_span_code_err(tcx.dcx(), sp, E0587, "type has conflicting packed and align representation hints").emit();
    } else if (repr.c() && (def_spans = check_packed_inner(tcx, def.did(), [])) !== undefined) {
      const def_spans_ = def_spans;
      tcx.emit_node_span_lint(
        ALIGNED_FIELDS_IN_PACKED,
        tcx.local_def_id_to_hir_id(def_id),
        sp,
        DiagDecorator((diag) => {
          diag.primary_message("packed type cannot transitively contain a `#[repr(align)]` type");

          diag.span_note(tcx.def_span(def_spans_[0]![0]), `\`${Symbol.as_str(tcx.item_name(def_spans_[0]![0]))}\` has a \`#[repr(align)]\` attribute`);

          if (def_spans_.length <= 2) {
            // 2 spans means aligned type is directly inside packed type, no need to add
            // extra notes.
            return;
          }

          let first = true;
          for (const [adt_def, span] of def_spans_.slice(1).reverse()) {
            const ident = tcx.item_name(adt_def);
            diag.span_note(
              span,
              first
                ? `\`${display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def.did()) as EarlyBinder<Ty>)))}\` contains a field of type \`${Symbol.as_str(ident)}\``
                : `...which contains a field of type \`${Symbol.as_str(ident)}\``,
            );
            first = false;
          }
        }),
      );
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1752 check_packed_inner
function check_packed_inner(tcx: TyCtxt, def_id: DefId, stack: DefId[]): [DefId, Span][] | undefined {
  const tk = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)).kind();
  if (tk.$ === "Adt") {
    const [def, args] = [tk._0, tk._1];
    if (def.repr().c() && (def.is_struct() || def.is_union())) {
      if (def.repr().align !== undefined) {
        return [[def.did(), DUMMY_SP]];
      }

      stack.push(def_id);
      for (const field of def.non_enum_variant().fields) {
        const fk = Unnormalized.skip_norm_wip(field.ty(tcx, args)).kind();
        if (fk.$ === "Adt") {
          const def = fk._0;
          let defs: [DefId, Span][] | undefined;
          if (!stack.some((d) => DefId_eq(d, def.did())) && (defs = check_packed_inner(tcx, def.did(), stack)) !== undefined) {
            defs.push([def.did(), field.ident(tcx).span]);
            return defs;
          }
        }
      }
      stack.pop();
    }
  }

  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1780 check_transparent
function check_transparent(tcx: TyCtxt, adt: AdtDef): void {
  if (!adt.repr().transparent()) {
    return;
  }

  if (adt.is_union() && !tcx.features().transparent_unions()) {
    feature_err(tcx.sess, sym.transparent_unions, tcx.def_span(adt.did()), "transparent unions are unstable").emit();
  }

  if (adt.variants().length !== 1) {
    bad_variant_count(tcx, adt, tcx.def_span(adt.did()), adt.did());
    // Don't bother checking the fields.
    return;
  }
  const variant = adt.variant(VariantIdx_ZERO);

  if (variant.fields.length <= 1) {
    // No need to check when there's at most one field.
    return;
  }

  const typing_env = TypingEnv.non_body_analysis(tcx, adt.did());

  /// We call a field "trivial" for `repr(transparent)` purposes if it can be ignored.
  /// IOW, `repr(transparent)` is allowed if there is at most one non-trivial field.
  /// This enum captures all the reasons why a field might not be "trivial".
  type NonTrivialReason =
    | { readonly $: "UnknownLayout" }
    | { readonly $: "NonZeroSized" }
    | { readonly $: "NonTrivialAlignment" }
    | { readonly $: "PrivateField"; inside: Ty }
    | { readonly $: "NonExhaustive"; ty: Ty }
    | { readonly $: "ReprC"; ty: Ty };
  interface NonTrivialFieldInfo {
    span: Span;
    reason: NonTrivialReason;
  }

  /// Check if this type is "trivial" for `repr(transparent)`. If not, return the reason why
  /// and the problematic type.
  // rustc: compiler/rustc_hir_analysis/src/check/check.rs:1827 is_trivial
  function is_trivial(tcx: TyCtxt, typing_env: TypingEnv, ty_: Ty): ControlFlow<NonTrivialReason> {
    // We can encounter projections during traversal, so ensure the type is normalized.
    const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty_), fold_Ty);
    const ty = n.$ === "Ok" ? n._0 : ty_;
    const k = ty.kind();
    switch (k.$) {
      case "Tuple": {
        for (const t of k._0) {
          const r = is_trivial(tcx, typing_env, t);
          if (r.$ === "Break") return r;
        }
        return ControlFlowC.CONTINUE;
      }
      case "Array":
        return is_trivial(tcx, typing_env, k._0);
      case "Adt": {
        const [def, args] = [k._0, k._1];
        if (!def.did().is_local() && find_attr(tcx.get_all_attrs(def.did()), (a) => (a.$ === "RustcPubTransparent" ? null : undefined)) === undefined) {
          const non_exhaustive = def.is_variant_list_non_exhaustive() || def.variants().some((v: VariantDef) => v.is_field_list_non_exhaustive());
          if (non_exhaustive) {
            return ControlFlowC.Break({ $: "NonExhaustive", ty });
          }
          let has_priv = false;
          for (const f of def.all_fields()) {
            if (!Visibility.is_public(f.vis)) {
              has_priv = true;
              break;
            }
          }
          if (has_priv) {
            return ControlFlowC.Break({ $: "PrivateField", inside: ty });
          }
        }
        if (def.repr().c()) {
          return ControlFlowC.Break({ $: "ReprC", ty });
        }
        for (const field of def.all_fields()) {
          const t = Unnormalized.skip_norm_wip(field.ty(tcx, args));
          const r = is_trivial(tcx, typing_env, t);
          if (r.$ === "Break") return r;
        }
        return ControlFlowC.CONTINUE;
      }
      default:
        return ControlFlowC.CONTINUE;
    }
  }

  // PORT: the `filter_map(..).collect::<Vec<_>>()` is a loop pushing each `Some` (`continue` for the early `return Some(..)`).
  const non_trivial_fields: NonTrivialFieldInfo[] = [];
  for (const field of variant.fields) {
    const ty = Unnormalized.skip_norm_wip(field.ty(tcx, RawList.identity_for_item(tcx, field.did)));
    const layout = tcx.layout_of(typing_env.as_query_input(ty));
    // We are currently checking the type this field came from, so it must be local
    const span = unwrap(tcx.hir_span_if_local(field.did));
    // Rule out non-1ZST
    if (!(layout.$ === "Ok" && layout._0.is_1zst())) {
      let reason: NonTrivialReason;
      if (layout.$ === "Err") {
        reason = { $: "UnknownLayout" };
      } else {
        const l = layout._0;
        if (!(l.is_sized() && l.size.bytes() === 0)) {
          reason = { $: "NonZeroSized" };
        } else {
          reason = { $: "NonTrivialAlignment" };
        }
      }
      non_trivial_fields.push({ span, reason });
      continue;
    }
    // Recursively check for other things that have to be ruled out.
    const r = is_trivial(tcx, typing_env, ty);
    if (r.$ === "Break") {
      non_trivial_fields.push({ span, reason: r._0 });
      continue;
    }
    // Otherwise,
    // None
  }

  if (non_trivial_fields.length > 1) {
    const count = non_trivial_fields.length;
    const desc = adt.is_enum() ? `the variant of a transparent ${adt.descr()}` : `transparent ${adt.descr()}`;
    const ty_span = tcx.def_span(adt.did());
    const diag = tcx.dcx().struct_span_err(ty_span, `${desc} needs at most one non-trivial field, but has ${count}`);
    diag.code(E0690);

    // Label for the type.
    diag.span_label(ty_span, `needs at most one non-trivial field, but has ${count}`);
    // Label for each non-trivial field.
    for (const field of non_trivial_fields) {
      let msg: string;
      const reason = field.reason;
      switch (reason.$) {
        case "UnknownLayout":
          msg = "this field is generic and hence may have non-zero size";
          break;
        case "NonZeroSized":
          msg = "this field has non-zero size";
          break;
        case "NonTrivialAlignment":
          msg = "this field requires alignment";
          break;
        case "PrivateField":
          msg = `this field contains \`${display_Ty(reason.inside)}\`, which has private fields, so it could become non-zero-sized in the future`;
          break;
        case "NonExhaustive":
          msg = `this field contains \`${display_Ty(reason.ty)}\`, which is marked with \`#[non_exhaustive]\`, so it could become non-zero-sized in the future`;
          break;
        case "ReprC":
          msg = `this field contains \`${display_Ty(reason.ty)}\`, which is a \`#[repr(C)]\` type, so it is not guaranteed to be zero-sized on all targets`;
          break;
      }
      diag.span_label(field.span, msg);
    }

    diag.emit();
    return;
  }
}

// #[allow(trivial_numeric_casts)]
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:1935 check_enum
function check_enum(tcx: TyCtxt, def_id: LocalDefId): void {
  const def = tcx.adt_def(def_id) as AdtDef;
  def.destructor(tcx); // force the destructor to be evaluated

  if (def.variants().length === 0) {
    const repr = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Repr" ? k : undefined));
    if (repr !== undefined) {
      const { reprs, first_span } = repr;
      struct_span_code_err(tcx.dcx(), reprs[0] !== undefined ? reprs[0][1] : first_span, E0084, "unsupported representation for zero-variant enum")
        .with_span_label(tcx.def_span(def_id), "zero-variant enum")
        .emit();
    }
  }

  for (const v of def.variants()) {
    if (v.discr.$ === "Explicit") {
      const discr_def_id = v.discr._0;
      tcx.ensure_ok().typeck(discr_def_id.expect_local());
    }
  }

  if (def.repr().int === undefined) {
    const is_unit = (var_: VariantDef): boolean => var_.ctor_kind() === "Const";
    const get_disr = (var_: VariantDef): DefId | undefined => (var_.discr.$ === "Explicit" ? var_.discr._0 : undefined);

    const non_unit = def.variants().find((var_) => !is_unit(var_));
    let disr_unit: DefId | undefined;
    for (const var_ of def.variants()) {
      if (is_unit(var_) && (disr_unit = get_disr(var_)) !== undefined) break;
    }
    let disr_non_unit: DefId | undefined;
    for (const var_ of def.variants()) {
      if (!is_unit(var_) && (disr_non_unit = get_disr(var_)) !== undefined) break;
    }

    if (disr_non_unit !== undefined || (disr_unit !== undefined && non_unit !== undefined)) {
      const err = struct_span_code_err(
        tcx.dcx(),
        tcx.def_span(def_id),
        E0732,
        "`#[repr(inttype)]` must be specified for enums with explicit discriminants and non-unit variants",
      );
      if (disr_non_unit !== undefined) {
        err.span_label(tcx.def_span(disr_non_unit), "explicit discriminant on non-unit variant specified here");
      } else {
        err.span_label(tcx.def_span(disr_unit!), "explicit discriminant specified here");
        err.span_label(tcx.def_span(non_unit!.def_id), "non-unit discriminant declared here");
      }
      err.emit();
    }
  }

  detect_discriminant_duplicate(tcx, def);
  check_transparent(tcx, def);
}

/// Part of enum check. Given the discriminants of an enum, errors if two or more discriminants are equal
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:2002 detect_discriminant_duplicate
function detect_discriminant_duplicate(tcx: TyCtxt, adt: AdtDef): void {
  // Helper closure to reduce duplicate code. This gets called everytime we detect a duplicate.
  // Here `idx` refers to the order of which the discriminant appears, and its index in `vs`
  const report = (dis: Discr, idx: VariantIdx, err: Diag): void => {
    const var_ = adt.variant(idx); // HIR for the duplicate discriminant
    let span: Span;
    let display_discr: string;
    const discr = var_.discr;
    if (discr.$ === "Explicit") {
      const discr_def_id = discr._0;
      // In the case the discriminant is both a duplicate and overflowed, let the user know
      const node = tcx.hir_node_by_def_id(discr_def_id.expect_local());
      let lit_value: bigint | undefined;
      if (node.$ === "AnonConst") {
        const expr = node._0;
        const value = tcx.hir_body(expr.body).value;
        if (value.kind.$ === "Lit") {
          const lit = value.kind._0;
          if (lit.node.$ === "Int") {
            lit_value = lit.node._0;
          }
        }
      }
      if (lit_value !== undefined && lit_value !== dis.val) {
        [span, display_discr] = [tcx.def_span(discr_def_id), `\`${display_Discr(dis)}\` (overflowed from \`${lit_value}\`)`];
      } else {
        // Otherwise, format the value as-is
        [span, display_discr] = [tcx.def_span(discr_def_id), `\`${display_Discr(dis)}\``];
      }
    } else if (discr._0 === 0) {
      // This should not happen.
      [span, display_discr] = [tcx.def_span(var_.def_id), `\`${display_Discr(dis)}\``];
    } else {
      const distance_to_explicit = discr._0;
      // At this point we know this discriminant is a duplicate, and was not explicitly
      // assigned by the user. Here we iterate backwards to fetch the HIR for the last
      // explicitly assigned discriminant, and letting the user know that this was the
      // increment startpoint, and how many steps from there leading to the duplicate
      const explicit = idx - distance_to_explicit;
      if (explicit >= 0) {
        const explicit_idx = explicit as VariantIdx;
        const explicit_variant = adt.variant(explicit_idx);
        const ve_ident = var_.name;
        const ex_ident = explicit_variant.name;
        const sp = distance_to_explicit > 1 ? "variants" : "variant";

        err.span_label(
          tcx.def_span(explicit_variant.def_id),
          `discriminant for \`${Symbol.as_str(ve_ident)}\` incremented from this startpoint ` +
            `(\`${Symbol.as_str(ex_ident)}\` + ${distance_to_explicit} ${sp} later ` +
            `=> \`${Symbol.as_str(ve_ident)}\` = ${display_Discr(dis)})`,
        );
      }

      [span, display_discr] = [tcx.def_span(var_.def_id), `\`${display_Discr(dis)}\``];
    }

    err.span_label(span, `${display_discr} assigned here`);
  };

  const discrs: [VariantIdx, Discr][] = [...adt.discriminants(tcx)];

  // Here we loop through the discriminants, comparing each discriminant to another.
  // When a duplicate is detected, we instantiate an error and point to both
  // initial and duplicate value. The duplicate discriminant is then discarded by swapping
  // it with the last element and decrementing the `vec.len` (which is why we have to evaluate
  // `discrs.len()` anew every iteration, and why this could be tricky to do in a functional
  // style as we are mutating `discrs` on the fly).
  let i = 0;
  while (i < discrs.length) {
    const var_i_idx = discrs[i]![0];
    let error: Diag | undefined = undefined;

    let o = i + 1;
    while (o < discrs.length) {
      const var_o_idx = discrs[o]![0];

      if (discrs[i]![1].val === discrs[o]![1].val) {
        if (error === undefined) {
          const ret = struct_span_code_err(tcx.dcx(), tcx.def_span(adt.did()), E0081, `discriminant value \`${display_Discr(discrs[i]![1])}\` assigned more than once`);

          report(discrs[i]![1], var_i_idx, ret);

          error = ret;
        }
        const err = error;

        report(discrs[o]![1], var_o_idx, err);

        // Safe to unwrap here, as we wouldn't reach this point if `discrs` was empty
        discrs[o] = discrs[discrs.length - 1]!;
        discrs.pop();
      } else {
        o += 1;
      }
    }

    if (error !== undefined) {
      error.emit();
    }

    i += 1;
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:2104 check_type_alias_type_params_are_used
function check_type_alias_type_params_are_used(tcx: TyCtxt, def_id: LocalDefId): void {
  const generics = tcx.generics_of(def_id) as Generics;
  if (generics.own_counts().types === 0) {
    return;
  }

  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
  if (TypeVisitableExt.references_error(ty, fold_Ty)) {
    // If there is already another error, do not emit an error for not using a type parameter.
    return;
  }

  // Lazily calculated because it is only needed in case of an error.
  let bounded_params_cell: Map<number, Span> | undefined = undefined;
  const bounded_params = (): Map<number, Span> => {
    if (bounded_params_cell === undefined) {
      const map = new Map<number, Span>();
      for (const [clause, span] of (tcx.explicit_clauses_of(def_id) as GenericClauses).clauses) {
        const k = Binder.skip_binder(clause.kind());
        let bounded_ty: Ty;
        if (k.$ === "Trait") {
          bounded_ty = TraitRefC.self_ty(k._0.trait_ref);
        } else if (k.$ === "TypeOutlives") {
          bounded_ty = k._0._0;
        } else {
          continue;
        }
        const bk = bounded_ty.kind();
        if (bk.$ === "Param") {
          const param = bk._0;
          // FIXME: This assumes that elaborated `Sized` bounds come first (which does hold at the
          // time of writing). This is a bit fragile since we later use the span to detect elaborated
          // `Sized` bounds. If they came last for example, this would break `Trait + /*elab*/Sized`
          // since it would overwrite the span of the user-written bound. This could be fixed by
          // folding the spans with `Span::to` which requires a bit of effort I think.
          map.set(param.index, span);
        }
      }
      bounded_params_cell = map;
    }
    return bounded_params_cell;
  };

  const params_used = new Set<number>();
  for (const leaf of ty.walk()) {
    if (leaf instanceof Ty) {
      const leaf_ty = leaf;
      const lk = leaf_ty.kind();
      if (lk.$ === "Param") {
        const param = lk._0;
        // debug!("found use of ty param {:?}", param);
        params_used.add(param.index);
      }
    }
  }

  for (const param of generics.own_params) {
    if (!params_used.has(param.index) && param.kind.$ === "Type") {
      const span = tcx.def_span(param.def_id);
      const param_name = Ident.new(param.name, span);

      // The corresponding predicates are post-`Sized`-elaboration. Therefore we
      // * check for emptiness to detect lone user-written `?Sized` bounds
      // * compare the param span to the pred span to detect lone user-written `Sized` bounds
      let has_explicit_bounds: boolean;
      if (bounded_params().size === 0) {
        has_explicit_bounds = true;
      } else {
        const pred_sp = bounded_params().get(param.index);
        has_explicit_bounds = pred_sp !== undefined && pred_sp !== span;
      }
      const const_param_help = !has_explicit_bounds;

      const diag = tcx.dcx().create_err(
        diagnostics.UnusedGenericParameter_diagnostic({
          span,
          param_name,
          param_def_kind: tcx.def_descr(param.def_id),
          help: { $: "TyAlias", param_name },
          usage_spans: [],
          const_param_help,
        }),
      );
      diag.code(E0091);
      diag.emit();
    }
  }
}

/// Emit an error for recursive opaque types.
///
/// If this is a return `impl Trait`, find the item's return expressions and point at them. For
/// direct recursion this is enough, but for indirect recursion also point at the last intermediary
/// `impl Trait`.
///
/// If all the return expressions evaluate to `!`, then we explain that the error will go away
/// after changing it. This can happen when a user uses `panic!()` or similar as a placeholder.
// rustc: compiler/rustc_hir_analysis/src/check/check.rs:2187 opaque_type_cycle_error
function opaque_type_cycle_error(tcx: TyCtxt, opaque_def_id: LocalDefId): ErrorGuaranteed {
  const span = tcx.def_span(opaque_def_id);
  const err = struct_span_code_err(tcx.dcx(), span, E0720, "cannot resolve opaque type");

  let label = false;
  const owner = get_owner_return_paths(tcx, opaque_def_id);
  if (owner !== undefined) {
    const [def_id, visitor] = owner;
    const typeck_results = tcx.typeck(def_id) as TypeckResults;
    if (
      visitor.returns
        .map((expr) => typeck_results.node_type_opt(expr.hir_id))
        .filter((ty): ty is Ty => ty !== undefined)
        .every((ty) => ty.kind().$ === "Never")
    ) {
      const spans = visitor.returns.filter((expr) => typeck_results.node_type_opt(expr.hir_id) !== undefined).map((expr) => expr.span);
      const span_len = spans.length;
      if (span_len === 1) {
        err.span_label(spans[0]!, "this returned value is of `!` type");
      } else {
        const multispan = MultiSpan.from_spans([...spans]);
        for (const span of spans) {
          multispan.push_span_label(span, "this returned value is of `!` type");
        }
        err.span_note(multispan, 'these returned values have a concrete "never" type');
      }
      err.help("this error will resolve once the item's body returns a concrete type");
    } else {
      const seen = new Set<Span>();
      seen.add(span);
      err.span_label(span, "recursive opaque type");
      label = true;
      for (const e of visitor.returns) {
        const t = typeck_results.node_type_opt(e.hir_id);
        if (t === undefined) continue;
        const [sp, ty] = [e.span, t];
        if (ty.kind().$ === "Never") continue;

        // #[derive(Default)]
        // struct OpaqueTypeCollector { opaques: Vec<DefId>, closures: Vec<DefId> }
        class OpaqueTypeCollector implements TypeVisitor<undefined> {
          readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;
          opaques: DefId[] = [];
          closures: DefId[] = [];

          /** (provided) `TypeVisitor::visit_binder` */
          visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
            return TypeVisitor_provided.visit_binder(this, t, d);
          }
          // rustc: compiler/rustc_hir_analysis/src/check/check.rs:2234 visit_ty
          visit_ty(t: Ty): undefined {
            const k = t.kind();
            if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
              const def = k._1.kind.def_id;
              this.opaques.push(def);
            } else if (k.$ === "Closure" || k.$ === "Coroutine") {
              const def_id = k._0;
              this.closures.push(def_id);
              fold_Ty.super_visit_with(t, this);
            } else {
              fold_Ty.super_visit_with(t, this);
            }
            return undefined;
          }
          /** (provided) `TypeVisitor::visit_region` */
          visit_region(r: Region): undefined {
            return TypeVisitor_provided.visit_region(this, r);
          }
          /** (provided) `TypeVisitor::visit_const` */
          visit_const(c: Const): undefined {
            return TypeVisitor_provided.visit_const(this, c);
          }
          /** (provided) `TypeVisitor::visit_predicate` */
          visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
            return TypeVisitor_provided.visit_predicate(this, p, d);
          }
          /** (provided) `TypeVisitor::visit_clauses` */
          visit_clauses(c: Clauses): undefined {
            return TypeVisitor_provided.visit_clauses(this, c);
          }
          /** (provided) `TypeVisitor::visit_error` */
          visit_error(g: ErrorGuaranteed): undefined {
            return TypeVisitor_provided.visit_error(this, g);
          }
        }

        const visitor2 = new OpaqueTypeCollector();
        fold_Ty.visit_with(ty, visitor2);
        for (const def_id of visitor2.opaques) {
          const ty_span = tcx.def_span(def_id);
          if (!seen.has(ty_span)) {
            const descr = ty.is_opaque() ? "opaque " : "";
            err.span_label(ty_span, `returning this ${descr}type \`${display_Ty(ty)}\``);
            seen.add(ty_span);
          }
          err.span_label(sp, `returning here with type \`${display_Ty(ty)}\``);
        }

        for (const closure_def_id of visitor2.closures) {
          const closure_local_did = closure_def_id.as_local();
          if (closure_local_did === undefined) {
            continue;
          }
          const typeck_results = tcx.typeck(closure_local_did) as TypeckResults;

          const label_match = (ty: Ty, span: Span): void => {
            for (const arg of ty.walk()) {
              if (arg instanceof Ty) {
                const k = arg.kind();
                if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
                  const captured_def_id = k._1.kind.def_id;
                  if (DefId_eq(captured_def_id, LocalDefId.to_def_id(opaque_def_id))) {
                    err.span_label(span, `${tcx.def_descr(closure_def_id)} captures itself here`);
                  }
                }
              }
            }
          };

          // Label any closure upvars that capture the opaque
          for (const capture of typeck_results.closure_min_captures_flattened(closure_local_did)) {
            label_match(HirPlace_ty(capture.place), capture.get_path_span(tcx));
          }
          // Label any coroutine locals that capture the opaque
          if (tcx.is_coroutine(closure_def_id)) {
            const coroutine_layout = tcx.mir_coroutine_witnesses(closure_def_id);
            if (coroutine_layout !== undefined) {
              void coroutine_layout;
              // for interior_ty in &coroutine_layout.field_tys {
              //     label_match(interior_ty.ty, interior_ty.source_info.span);
              // }
              // PORT: `CoroutineLayout` (rustc_middle mir/query.rs) is MIR (M4).
              return unported("rustc_middle::mir::query::CoroutineLayout (M4)");
            }
          }
        }
      }
    }
  }
  if (!label) {
    err.span_label(span, "cannot resolve opaque type");
  }
  return err.emit_err();
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:2312 check_coroutine_obligations
export function check_coroutine_obligations(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  // debug_assert!(!tcx.is_typeck_child(def_id.to_def_id()));

  const typeck_results = tcx.typeck(def_id) as TypeckResults;
  const param_env = tcx.param_env(def_id) as ParamEnv;

  // debug!(?typeck_results.coroutine_stalled_predicates);

  // This query is conceptually between HIR typeck and
  // MIR borrowck. We use the opaque types defined by HIR
  // and ignore region constraints.
  const mode = tcx.next_trait_solver_globally() ? TypingMode.borrowck(as_interner(tcx), def_id) : TypingMode.analysis_in_body(as_interner(tcx), def_id);

  // Typeck writeback gives us predicates with their regions erased.
  // We only need to check the goals while ignoring lifetimes to give good
  // error message and to avoid breaking the assumption of `mir_borrowck`
  // that all obligations already hold modulo regions.
  const infcx = tcx.infer_ctxt().ignoring_regions().build(mode);

  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  for (const [predicate, cause] of typeck_results.coroutine_stalled_predicates) {
    ocx.register_obligation(Obligation.new(tcx, clone_ObligationCause(cause), param_env, predicate, upcast_from_self));
  }

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  // debug!(?errors);
  if (errors.$ === "HasErrors") {
    return Err(infcx.err_ctxt().report_fulfillment_errors(errors._0));
  }

  if (!tcx.next_trait_solver_globally()) {
    // Check that any hidden types found when checking these stalled coroutine obligations
    // are valid.
    for (const [key_, ty] of infcx.take_opaque_types()) {
      const hidden_type = infcx.deeply_resolve_ignoring_regions(ty, fold_ProvisionalHiddenType);
      const key = infcx.deeply_resolve_ignoring_regions(key_, fold_OpaqueTypeKey);
      const r = sanity_check_found_hidden_type(tcx, key, hidden_type);
      if (r.$ === "Err") return r;
    }
  } else {
    // We're not checking region constraints here, so we can simply drop the
    // added opaque type uses in `TypingMode::PostTypeckUntilBorrowck`.
    void infcx.take_opaque_types();
  }

  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:2366 check_potentially_region_dependent_goals
export function check_potentially_region_dependent_goals(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  if (!tcx.next_trait_solver_globally()) {
    return Ok(null);
  }
  const typeck_results = tcx.typeck(def_id) as TypeckResults;
  const param_env = tcx.param_env(def_id) as ParamEnv;

  // We use `TypingMode::PostTypeckUntilBorrowck` as we want to use the opaque types computed by HIR typeck.
  const typing_mode = TypingMode.borrowck(as_interner(tcx), def_id);
  const infcx = tcx.infer_ctxt().ignoring_regions().build(typing_mode);
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  for (const [predicate_, cause] of typeck_results.potentially_region_dependent_goals) {
    const predicate = fold_regions(tcx, predicate_, (_, __) => infcx.next_region_var({ $: "Misc", _0: cause.span }), fold_Predicate);
    ocx.register_obligation(Obligation.new(tcx, clone_ObligationCause(cause), param_env, predicate, upcast_from_self));
  }

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  // debug!(?errors);
  if (errors.$ === "HasErrors") {
    return Err(infcx.err_ctxt().report_fulfillment_errors(errors._0));
  } else {
    return Ok(null);
  }
}

// ==== Stand-ins (PORT: other wave-17 lanes; see the file header) ====

/** `middle::codegen_fn_attrs::CodegenFnAttrs` (rustc_middle middle/codegen_fn_attrs.rs, not ported): the fields this file reads. */
interface CodegenFnAttrs {
  import_linkage: unknown;
}
/** `hir::place::Place::ty` (rustc_middle hir/place.rs, not ported). */
function HirPlace_ty(_place: unknown): Ty {
  return unported("rustc_middle::hir::place::Place::ty (hir/place.rs)");
}

/** `crate::collect` (read at call time: init order). */
function collect(): typeof import("../collect.ts") {
  return (collect__m ??= require("../collect.ts") as typeof import("../collect.ts"));
}
var collect__m: typeof import("../collect.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** `#[derive(TypeFoldable, TypeVisitable)] for OpaqueTypeKey` (rustc_type_ir opaque_ty.gen.ts). */
const fold_OpaqueTypeKey: TypeFoldable<OpaqueTypeKey> = {
  visit_with: visit_with_OpaqueTypeKey,
  try_fold_with: try_fold_with_OpaqueTypeKey,
  fold_with: fold_with_OpaqueTypeKey,
};
/** The derived `TypeFoldable` of `ty::ProvisionalHiddenType` (rustc_middle ty/mod.rs, generated; built on use: init order). */
const fold_ProvisionalHiddenType: TypeFoldable<ProvisionalHiddenType> = {
  visit_with: (self, visitor) => middle_ty.visit_with_ProvisionalHiddenType(self, visitor),
  try_fold_with: (self, folder) => middle_ty.try_fold_with_ProvisionalHiddenType(self, folder),
  fold_with: (self, folder) => middle_ty.fold_with_ProvisionalHiddenType(self, folder),
};
/** `TypeVisitable for PredicateKind` (derived). */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };
