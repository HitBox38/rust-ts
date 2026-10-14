//! This module contains methods that assist in checking that impls are general
//! enough, i.e. that they always apply to every valid instantaiton of the ADT
//! they're implemented for.
//!
//! This is necessary for `Drop` and negative impls to be well-formed.
// Port of compiler/rustc_hir_analysis/src/check/always_applicable.rs (lane check-region-intrinsic).
//
// Init order: top-level code here touches only other crates.
//
// PORT: items of lanes that are not in this lane's base are called through `pending` (end of this file), `unported(..)`
// stand-ins that root repoints at merge:
// - `crate::check::missing_items_must_implement_one_of_err` (check/mod.rs, lane check-check);
// - `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics` (traits/engine.rs, lanes trait-sel-*).
// `InferCtxtRegionExt::resolve_regions` (rustc_trait_selection regions.rs) is called on the `InferCtxt` (its contract
// placeholder stops until that lane lands).
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { type Diag, E0366, E0367, type ErrorGuaranteed, struct_span_code_err } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { display_GenericKind } from "../../rustc_infer/infer/region_constraints/mod.ts";
import { RegionResolutionError, SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import { Obligation, type PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import type { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { TraitErrors as TraitErrorsC } from "../../rustc_infer/traits/engine.ts";
import { ObligationCause, ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { suggest_constraining_type_param } from "../../rustc_middle/ty/diagnostics.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { GenericClauses as GenericClausesC } from "../../rustc_middle/ty/generics.ts";
import { fold_with_ParamEnv, HasAttrs_DefId, type ParamEnv, try_fold_with_ParamEnv, Ty, visit_with_ParamEnv } from "../../rustc_middle/ty/mod.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/predicate.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { display_GenericArg, display_Predicate, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { ClauseKind, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { display_Region } from "../../rustc_type_ir/ir_print.ts";
import { as_interner, type ImplPolarity, TraitRef as TraitRefC } from "../../rustc_type_ir/predicate.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { fold_with_ClauseKind, try_fold_with_ClauseKind, visit_with_ClauseKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, expect_result, Ok, type Result } from "../../std/result.ts";
import { debug_TypeError, type TypeError } from "../../rustc_type_ir/error.gen.ts";
import { AssocItems } from "../../rustc_middle/ty/assoc.ts";
import { ConflictImplDropAndPinDrop_diagnostic, NegativeDropImplPolarity_diagnostic, PinV2WithoutPinDrop_diagnostic } from "../diagnostics.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ClauseKind: TypeFoldable<ClauseKind> = { visit_with: visit_with_ClauseKind, try_fold_with: try_fold_with_ClauseKind, fold_with: fold_with_ClauseKind };
const d_ParamEnv: TypeFoldable<ParamEnv> = { visit_with: visit_with_ParamEnv, try_fold_with: try_fold_with_ParamEnv, fold_with: fold_with_ParamEnv };

/** PORT: `impl UpcastFrom<TyCtxt, X> for Predicate` fns are typed over `TyCtxt`; `Obligation::new` takes them over
 *  `Interner` (`I = TyCtxt`). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return f as unknown as (from: T, tcx: Interner) => P;
}

/// This function confirms that the `Drop` implementation identified by
/// `drop_impl_did` is not any more specialized than the type it is
/// attached to (Issue #8142).
///
/// This means:
///
/// 1. The self type must be nominal (this is already checked during
///    coherence),
///
/// 2. The generic region/type parameters of the impl's self type must
///    all be parameters of the Drop impl itself (i.e., no
///    specialization like `impl Drop for Foo<i32>`), and,
///
/// 3. Any bounds on the generic parameters must be reflected in the
///    struct/enum definition for the nominal type itself (i.e.
///    cannot do `struct S<T>; impl<T:Clone> Drop for S<T> { ... }`).
// rustc: compiler/rustc_hir_analysis/src/check/always_applicable.rs:39 check_drop_impl
export function check_drop_impl(tcx: TyCtxt, drop_impl_did: LocalDefId): Result<null, ErrorGuaranteed> {
  switch (tcx.impl_polarity(drop_impl_did)) {
    case "Positive":
      break;
    case "Negative": {
      return Err(
        tcx.dcx().emit_err(
          NegativeDropImplPolarity_diagnostic({
            span: tcx.def_span(drop_impl_did),
          }),
        ),
      );
    }
  }

  {
    const r = tcx.ensure_result().orphan_check_impl(drop_impl_did) as Result<null, ErrorGuaranteed>;
    if (r.$ === "Err") return r;
  }

  const self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(drop_impl_did) as EarlyBinder<Ty>));

  const kind = self_ty.kind();
  if (kind.$ === "Adt") {
    const adt_def = kind._0 as AdtDef;
    const adt_to_impl_args = kind._1 as GenericArgs;
    {
      const r = ensure_impl_params_and_item_params_correspond(tcx, drop_impl_did, adt_def.did(), adt_to_impl_args);
      if (r.$ === "Err") return r;
    }

    {
      const r = ensure_all_fields_are_const_destruct(tcx, drop_impl_did, adt_def.did());
      if (r.$ === "Err") return r;
    }

    {
      const r = ensure_impl_predicates_are_implied_by_item_defn(tcx, drop_impl_did, adt_def.did(), adt_to_impl_args);
      if (r.$ === "Err") return r;
    }

    {
      const r = check_drop_xor_pin_drop(tcx, adt_def.did(), drop_impl_did);
      if (r.$ === "Err") return r;
    }

    return Ok(null);
  } else {
    return span_bug(tcx.def_span(drop_impl_did), "incoherent impl of Drop");
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/always_applicable.rs:84 check_negative_auto_trait_impl
export function check_negative_auto_trait_impl(tcx: TyCtxt, impl_def_id: LocalDefId, impl_trait_ref: TraitRef, polarity: ImplPolarity): Result<null, ErrorGuaranteed> {
  if (polarity !== "Negative") {
    return Ok(null);
  }

  if (!tcx.trait_is_auto(impl_trait_ref.def_id)) {
    return Ok(null);
  }

  if (hir.Defaultness.is_default(tcx.defaultness(impl_def_id) as hir.Defaultness)) {
    tcx.dcx().span_delayed_bug(tcx.def_span(impl_def_id), "default impl cannot be negative");
  }

  {
    const r = tcx.ensure_result().orphan_check_impl(impl_def_id) as Result<null, ErrorGuaranteed>;
    if (r.$ === "Err") return r;
  }

  const kind = TraitRefC.self_ty(impl_trait_ref).kind();
  if (kind.$ === "Adt") {
    const adt_def = kind._0 as AdtDef;
    const adt_to_impl_args = kind._1 as GenericArgs;
    {
      const r = ensure_impl_params_and_item_params_correspond(tcx, impl_def_id, adt_def.did(), adt_to_impl_args);
      if (r.$ === "Err") return r;
    }

    return ensure_impl_predicates_are_implied_by_item_defn(tcx, impl_def_id, adt_def.did(), adt_to_impl_args);
  } else {
    if (tcx.features().auto_traits()) {
      // NOTE: We ignore the applicability check for negative auto impls
      // defined in libcore. In the (almost impossible) future where we
      // stabilize auto impls, then the proper applicability check MUST
      // be implemented here to handle non-ADT rigid types.
      return Ok(null);
    } else {
      return Err(tcx.dcx().span_delayed_bug(tcx.def_span(impl_def_id), "incoherent impl of negative auto trait"));
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/always_applicable.rs:137 ensure_impl_params_and_item_params_correspond
function ensure_impl_params_and_item_params_correspond(
  tcx: TyCtxt,
  impl_def_id: LocalDefId,
  adt_def_id: DefId,
  adt_to_impl_args: GenericArgs,
): Result<null, ErrorGuaranteed> {
  const res = tcx.uses_unique_generic_params(adt_to_impl_args, "OnlyParam");
  if (res.$ !== "Err") {
    return Ok(null);
  }
  const arg = res._0;

  const impl_span = tcx.def_span(impl_def_id);
  const item_span = tcx.def_span(adt_def_id);
  const self_descr = tcx.def_descr(adt_def_id);
  let polarity: string;
  switch (tcx.impl_polarity(impl_def_id)) {
    case "Positive":
      polarity = "";
      break;
    case "Negative":
      polarity = "!";
      break;
  }
  const trait_name = tcx.item_name(tcx.impl_trait_id(LocalDefId.to_def_id(impl_def_id)));
  const err = struct_span_code_err(tcx.dcx(), impl_span, E0366, `\`${polarity}${Symbol.as_str(trait_name)}\` impls cannot be specialized`);
  switch (arg.$) {
    case "DuplicateParam":
      err.note(`\`${display_GenericArg(arg._0)}\` is mentioned multiple times`);
      break;
    case "NotParam":
      err.note(`\`${display_GenericArg(arg._0)}\` is not a generic parameter`);
      break;
  }
  err.span_note(item_span, `use the same sequence of generic lifetime, type and const parameters as the ${self_descr} definition`);
  return Err(err.emit_err());
}

// rustc: compiler/rustc_hir_analysis/src/check/always_applicable.rs:179 ensure_all_fields_are_const_destruct
function ensure_all_fields_are_const_destruct(tcx: TyCtxt, impl_def_id: LocalDefId, adt_def_id: DefId): Result<null, ErrorGuaranteed> {
  if (!tcx.is_conditionally_const(LocalDefId.to_def_id(impl_def_id))) {
    return Ok(null);
  }
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = pending.ObligationCtxt_new_with_diagnostics(infcx);

  const impl_span = tcx.def_span(LocalDefId.to_def_id(impl_def_id));
  const env = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(EarlyBinder.bind(tcx, tcx.param_env(impl_def_id) as ParamEnv, d_ParamEnv)));
  const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(impl_def_id));
  const destruct_trait = unwrap(tcx.lang_items().destruct_trait());
  for (const field of (tcx.adt_def(adt_def_id) as AdtDef).all_fields()) {
    const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
    const cause = ObligationCause.new(tcx.def_span(field.did), impl_def_id, ObligationCauseCode.Misc);
    ocx.register_obligation(
      Obligation.new(
        tcx,
        cause,
        env,
        {
          $: "HostEffect",
          _0: {
            trait_ref: TraitRefC.new(as_interner(tcx), destruct_trait, [GenericArg.from_Ty(field_ty)]),
            constness: "Maybe",
          },
        } as ClauseKind,
        upcast_tcx(Predicate_upcast_from_ClauseKind),
      ),
    );
  }
  // `.into_iter().map(|error| { ..; Err(diag.emit_err()) }).collect::<Result<(), _>>()`: the collect stops at the
  // first `Err`, so at most one error is reported.
  for (const error of TraitErrorsC.into_thin_vec(ocx.evaluate_obligations_error_on_ambiguity())) {
    const k = unwrap(Binder.no_bound_vars(error.root_obligation.predicate.expect_clause().kind(), d_ClauseKind));
    if (k.$ !== "HostEffect") {
      return unreachable();
    }
    const eff = k._0;
    const field_ty = TraitRefC.self_ty(eff.trait_ref);
    const diag: Diag = struct_span_code_err(tcx.dcx(), error.root_obligation.cause.span, E0367, `\`${display_Ty(field_ty)}\` does not implement \`[const] Destruct\``).with_span_note(
      impl_span,
      "required for this `Drop` impl",
    );
    let generics: hir.Generics | undefined;
    if (TypeVisitableExt.has_param(field_ty, fold_Ty) && (generics = hir.Node.generics(tcx.hir_node_by_def_id(impl_def_id))) !== undefined) {
      const destruct_def_id = tcx.lang_items().destruct_trait();
      suggest_constraining_type_param(tcx, generics, diag, display_Ty(field_ty), "[const] Destruct", destruct_def_id, undefined);
    }
    return Err(diag.emit_err());
  }
  return Ok(null);
}

/// Confirms that all predicates defined on the `Drop` impl (`drop_impl_def_id`) are able to be
/// proven from within `adt_def_id`'s environment. I.e. all the predicates on the impl are
/// implied by the ADT being well formed.
// rustc: compiler/rustc_hir_analysis/src/check/always_applicable.rs:251 ensure_impl_predicates_are_implied_by_item_defn
function ensure_impl_predicates_are_implied_by_item_defn(
  tcx: TyCtxt,
  impl_def_id: LocalDefId,
  adt_def_id: DefId,
  adt_to_impl_args: GenericArgs,
): Result<null, ErrorGuaranteed> {
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = pending.ObligationCtxt_new_with_diagnostics(infcx);

  const impl_span = tcx.def_span(LocalDefId.to_def_id(impl_def_id));
  const trait_name = tcx.item_name(tcx.impl_trait_id(LocalDefId.to_def_id(impl_def_id)));
  let polarity: string;
  switch (tcx.impl_polarity(impl_def_id)) {
    case "Positive":
      polarity = "";
      break;
    case "Negative":
      polarity = "!";
      break;
  }
  // Take the param-env of the adt and instantiate the args that show up in
  // the implementation's self type. This gives us the assumptions that the
  // self ty of the implementation is allowed to know just from it being a
  // well-formed adt, since that's all we're allowed to assume while proving
  // the Drop implementation is not specialized.
  //
  // We don't need to normalize this param-env or anything, since we're only
  // instantiating it with free params, so no additional param-env normalization
  // can occur on top of what has been done in the param_env query itself.
  //
  // Note: Ideally instead of instantiating the `ParamEnv` with the arguments from the impl ty we
  // could instead use identity args for the adt. Unfortunately this would cause any errors to
  // reference the params from the ADT instead of from the impl which is bad UX. To resolve
  // this we "rename" the ADT's params to be the impl's params which should not affect behaviour.
  const impl_adt_ty = Ty.new_adt(tcx, tcx.adt_def(adt_def_id) as AdtDef, adt_to_impl_args);
  const adt_env = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind_unchecked(tcx.param_env(adt_def_id) as ParamEnv), tcx, adt_to_impl_args, d_ParamEnv));

  const fresh_impl_args = infcx.fresh_args_for_item(impl_span, LocalDefId.to_def_id(impl_def_id));
  const fresh_adt_ty = TraitRefC.self_ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.impl_trait_ref(impl_def_id), tcx, fresh_impl_args, d_TraitRef)));

  expect_result(ocx.eq(ObligationCause.dummy_with_span(impl_span), adt_env, fresh_adt_ty, impl_adt_ty), "equating fully generic trait ref should never fail", debug_TypeError);

  for (const [clause, span] of GenericClausesC.instantiate(tcx.clauses_of(impl_def_id) as GenericClauses, tcx, fresh_impl_args)) {
    const normalize_cause = ObligationCause.misc(span, impl_def_id);
    const pred = ocx.normalize(normalize_cause, adt_env, clause);
    const cause = ObligationCause.new(span, impl_def_id, ObligationCauseCode.AlwaysApplicableImpl);
    ocx.register_obligation(Obligation.new(tcx, cause, adt_env, pred, upcast_tcx(Predicate_upcast_from_Clause)));
  }

  // All of the custom error reporting logic is to preserve parity with the old
  // error messages.
  //
  // They can probably get removed with better treatment of the new `DropImpl`
  // obligation cause code, and perhaps some custom logic in `report_region_errors`.

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (!TraitErrorsC.no_errors(errors)) {
    let guar: ErrorGuaranteed | undefined = undefined;
    // PORT: `FxHashSet<Predicate>`: only `insert` (never iterated), so a `Set` of the hash-consed predicates.
    const root_predicates = new Set<Predicate>();
    for (const error of TraitErrorsC.into_thin_vec(errors)) {
      const root_predicate = error.root_obligation.predicate;
      if (!root_predicates.has(root_predicate)) {
        root_predicates.add(root_predicate);
        const item_span = tcx.def_span(adt_def_id);
        const self_descr = tcx.def_descr(adt_def_id);
        guar = struct_span_code_err(
          tcx.dcx(),
          error.root_obligation.cause.span,
          E0367,
          `\`${polarity}${Symbol.as_str(trait_name)}\` impl requires \`${display_Predicate(root_predicate)}\` but the ${self_descr} it is implemented for does not`,
        )
          .with_span_note(item_span, "the implementor must specify the same requirement")
          .emit_err();
      }
    }
    return Err(unwrap(guar));
  }

  const errors_ = ocx.infcx.resolve_regions(impl_def_id, adt_env, []);
  if (errors_.length !== 0) {
    let guar: ErrorGuaranteed | undefined = undefined;
    for (const error of errors_) {
      const item_span = tcx.def_span(adt_def_id);
      const self_descr = tcx.def_descr(adt_def_id);
      let outlives: string;
      switch (error.$) {
        case "ConcreteFailure":
          outlives = `${display_Region(error._2)}: ${display_Region(error._1)}`;
          break;
        case "GenericBoundFailure":
          outlives = `${display_GenericKind(error._1)}: ${display_Region(error._2)}`;
          break;
        case "SubSupConflict":
          outlives = `${display_Region(error._5)}: ${display_Region(error._3)}`;
          break;
        case "UpperBoundUniverseConflict":
          outlives = `${display_Region(error._4)}: ${display_Region(Region.new_var(tcx, error._0))}`;
          break;
        case "CannotNormalize":
          return unreachable();
      }
      guar = struct_span_code_err(
        tcx.dcx(),
        SubregionOrigin.span(RegionResolutionError.origin(error)),
        E0367,
        `\`${polarity}${Symbol.as_str(trait_name)}\` impl requires \`${outlives}\` but the ${self_descr} it is implemented for does not`,
      )
        .with_span_note(item_span, "the implementor must specify the same requirement")
        .emit_err();
    }
    return Err(unwrap(guar));
  }

  return Ok(null);
}

/// This function checks at least and at most one of `Drop::drop` and `Drop::pin_drop` is implemented.
/// It also checks that `Drop::pin_drop` must be implemented if `#[pin_v2]` is present on the type.
// rustc: compiler/rustc_hir_analysis/src/check/always_applicable.rs:371 check_drop_xor_pin_drop
function check_drop_xor_pin_drop(tcx: TyCtxt, adt_def_id: DefId, drop_impl_did: LocalDefId): Result<null, ErrorGuaranteed> {
  let drop_span: Span | undefined = undefined;
  let pin_drop_span: Span | undefined = undefined;
  for (const item of AssocItems.in_definition_order(tcx.associated_items(drop_impl_did) as AssocItems)) {
    const kind = item.kind;
    if (kind.$ === "Fn" && kind.name === sym.drop) {
      drop_span = tcx.def_span(item.def_id);
    } else if (kind.$ === "Fn" && kind.name === sym.pin_drop) {
      pin_drop_span = tcx.def_span(item.def_id);
    }
  }

  if (drop_span === undefined && pin_drop_span === undefined) {
    if (tcx.features().pin_ergonomics()) {
      return Err(pending.missing_items_must_implement_one_of_err(tcx, drop_impl_did, [sym.drop, sym.pin_drop].values(), undefined));
    } else {
      return Err(tcx.dcx().span_delayed_bug(tcx.def_span(drop_impl_did), "missing `Drop::drop`"));
    }
  } else if (drop_span !== undefined && pin_drop_span === undefined) {
    const span = drop_span;
    if ((tcx.adt_def(adt_def_id) as AdtDef).is_pin_project()) {
      const pin_v2_span = find_attr(HasAttrs_DefId.get_attrs(adt_def_id, tcx), (k) => (k.$ === "PinV2" ? k._0 : undefined));
      const adt_name = tcx.item_name(adt_def_id);
      return Err(
        tcx.dcx().emit_err(
          PinV2WithoutPinDrop_diagnostic({
            span,
            pin_v2_span,
            adt_name,
          }),
        ),
      );
    }
  } else if (drop_span === undefined && pin_drop_span !== undefined) {
    const span = pin_drop_span;
    if (!tcx.features().pin_ergonomics()) {
      return Err(tcx.dcx().span_delayed_bug(span, "`Drop::pin_drop` should be guarded by the library feature gate"));
    }
  } else {
    return Err(
      tcx.dcx().emit_err(
        ConflictImplDropAndPinDrop_diagnostic({
          span: tcx.def_span(drop_impl_did),
          drop_span: drop_span!,
          pin_drop_span: pin_drop_span!,
        }),
      ),
    );
  }
  return Ok(null);
}

// ---- PORT stand-ins for items of lanes not in this lane's base (root repoints them at merge) ----------------------

/** `rustc_trait_selection::traits::FulfillmentError` (traits/mod.rs, lanes trait-sel-*): the field this file reads. */
interface FulfillmentErrorView {
  root_obligation: PredicateObligation;
}

/** `ObligationCtxt<'_, '_, FulfillmentError>` (rustc_trait_selection traits/engine.rs, lanes trait-sel-*): the methods
 *  this file calls. */
interface ObligationCtxtView {
  infcx: InferCtxt;
  register_obligation(obligation: PredicateObligation): void;
  eq(cause: ObligationCause, param_env: ParamEnv, expected: Ty, actual: Ty): Result<null, TypeError>;
  normalize(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<Clause>): Clause;
  evaluate_obligations_error_on_ambiguity(): TraitErrors<FulfillmentErrorView>;
}

/** Stand-ins, called through this object so root can repoint them in one place. */
export const pending = {
  /** `ObligationCtxt::new_with_diagnostics` (rustc_trait_selection traits/engine.rs, lanes trait-sel-*). */
  ObligationCtxt_new_with_diagnostics(_infcx: InferCtxt): ObligationCtxtView {
    return unported("rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics");
  },
  /** `crate::check::missing_items_must_implement_one_of_err` (check/mod.rs, lane check-check). */
  missing_items_must_implement_one_of_err(_tcx: TyCtxt, _impl_def_id: LocalDefId, _missing_items: Iterator<Symbol>, _annotation_span: Span | undefined): ErrorGuaranteed {
    return unported("rustc_hir_analysis::check::missing_items_must_implement_one_of_err (lane check-check)");
  },
};
