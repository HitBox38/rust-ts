// Port of compiler/rustc_hir_typeck/src/opaque_types.rs (lane typeck-lib-wb).
//
// - `UsageKind` is generated (opaque_types.gen.ts); `UsageKind::merge(&mut self, ..)` is `UsageKind_merge(self_:
//   MutRef<UsageKind>, other)` (PORTING §8: an enum method; `&mut self` assigns through the cell).
// - rustc_trait_selection's opaque_types.rs (`opaque_type_has_defining_use_args`, `NonDefiningUseReason`,
//   `report_item_does_not_constrain_error`) is not ported: the shims at the end stop as `unported`.
// - `FnCtxt::err_ctxt()` returns the `Pending` `TypeErrCtxt` (wave 19): `TypeErrCtxtView` lists the methods called here.
// - `debug!` / `#[instrument]` are tracing only and stay as comments.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
export * from "./opaque_types.gen.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { DefinitionSiteHiddenType, ProvisionalHiddenType, Term } from "../rustc_middle/ty/mod.ts";
import type { DefiningScopeKind } from "../rustc_middle/ty/mod.ts";
import { debug_LocalDefId, type LocalDefId, LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { FromSolverError_FulfillmentError } from "../rustc_trait_selection/solve/fulfill.ts";
import { deeply_normalize } from "../rustc_trait_selection/solve/normalize.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { Pending } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { fold_tuple2 } from "../rustc_type_ir/fold.ts";
import type { OpaqueTypeKey } from "../rustc_type_ir/opaque_ty.ts";
import { fold_with_OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../rustc_type_ir/opaque_ty.gen.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported, unreachable, unwrap } from "../std/panic.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { InferCtxt } from "../rustc_infer/decls.ts";
import { FnCtxt } from "./decls.ts";
import type { UsageKind } from "./opaque_types.gen.ts";

// impl<'tcx> FnCtxt<'_, 'tcx> {
/// This takes all the opaque type uses during HIR typeck. It first computes
/// the hidden type by iterating over all defining uses.
///
/// A use during HIR typeck is defining if all non-lifetime arguments are
/// unique generic parameters and the hidden type does not reference any
/// inference variables.
///
/// It then uses these defining uses to guide inference for all other uses.
///
/// Unlike `handle_opaque_type_uses_next`, this does not report errors.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/opaque_types.rs:29 try_handle_opaque_type_uses_next
FnCtxt.prototype.try_handle_opaque_type_uses_next = function (this: FnCtxt): void {
  // We clone the opaques instead of stealing them here as we still need
  // to use them after fallback.
  const opaque_types = this.infcx.clone_opaque_types();

  this.compute_definition_site_hidden_types(opaque_types, false);
};

/// This takes all the opaque type uses during HIR typeck. It first computes
/// the concrete hidden type by iterating over all defining uses.
///
/// A use during HIR typeck is defining if all non-lifetime arguments are
/// unique generic parameters and the hidden type does not reference any
/// inference variables.
///
/// It then uses these defining uses to guide inference for all other uses.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/opaque_types.rs:46 handle_opaque_type_uses_next
FnCtxt.prototype.handle_opaque_type_uses_next = function (this: FnCtxt): void {
  // We clone the opaques instead of stealing them here as they are still used for
  // normalization in the next generation trait solver.
  const opaque_types = this.infcx.clone_opaque_types();
  const num_entries = this.inner.opaque_types().deref().num_entries();
  const prev = this.checked_opaque_types_storage_entries;
  this.checked_opaque_types_storage_entries = num_entries;
  // debug_assert_eq!(prev, None);
  void prev;

  this.compute_definition_site_hidden_types(opaque_types, true);
};

// impl<'tcx> UsageKind<'tcx> {
// rustc: compiler/rustc_hir_typeck/src/opaque_types.rs:67 merge
export function UsageKind_merge(self_: MutRef<UsageKind>, other: UsageKind): void {
  const s = self_.value;
  if (s.$ === "HasDefiningUse" || other.$ === "None") {
    unreachable();
  } else if (s.$ === "None") {
    self_.value = other;
  } else if ((s.$ === "NonDefiningUse" || s.$ === "UnconstrainedHiddenType") && other.$ === "NonDefiningUse") {
    // When mergining non-defining uses, prefer earlier ones. This means
    // the error happens as early as possible.
  } else {
    // When merging unconstrained hidden types, we prefer later ones. This is
    // used as in most cases, the defining use is the final return statement
    // of our function, and other uses with defining arguments are likely not
    // intended to be defining.
    // (NonDefiningUse(..) | UnconstrainedHiddenType(..), UnconstrainedHiddenType(..) | HasDefiningUse(_))
    self_.value = other;
  }
}

// impl<'tcx> FnCtxt<'_, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/opaque_types.rs:90 compute_definition_site_hidden_types
FnCtxt.prototype.compute_definition_site_hidden_types = function (
  this: FnCtxt,
  opaque_types: [OpaqueTypeKey, ProvisionalHiddenType][],
  error_on_missing_defining_use: boolean,
): void {
  for (let i = 0; i < opaque_types.length; i++) {
    opaque_types[i] = this.deeply_resolve_ignoring_regions(opaque_types[i]!, fold_OpaqueTypeKey_ProvisionalHiddenType());
  }
  // debug!(?opaque_types);

  const tcx = this.tcx;
  const mode = this.typing_mode();
  // ty::TypingMode::Coherence | Reflection | PostTypeckUntilBorrowck { .. } | PostBorrowck { .. } | PostAnalysis
  // | Codegen => bug!()
  if (mode.$ !== "Typeck") {
    return bug("");
  }
  const defining_opaque_types_and_generators = mode.defining_opaque_types_and_generators;

  for (const def_id of defining_opaque_types_and_generators) {
    const def_kind = tcx.def_kind(def_id);
    if (def_kind.$ === "OpaqueTy") {
      // {}
    } else if (def_kind.$ === "Closure") {
      continue;
    } else {
      unreachable(`not opaque or generator: ${debug_LocalDefId(def_id, PLAIN)}`);
    }

    // We do actually need to check this the second pass (we can't just
    // store this), because we can go from `UnconstrainedHiddenType` to
    // `HasDefiningUse` (because of fallback)
    const usage_kind: MutRef<UsageKind> = { value: { $: "None" } };
    for (const [opaque_type_key, hidden_type] of opaque_types) {
      if (opaque_type_key.def_id !== def_id) {
        continue;
      }

      UsageKind_merge(usage_kind, this.consider_opaque_type_use(opaque_type_key, hidden_type));

      if (usage_kind.value.$ === "HasDefiningUse") {
        break;
      }
    }

    const uk = usage_kind.value;
    if (uk.$ === "HasDefiningUse") {
      const ty = uk._0;
      for (const [opaque_type_key, hidden_type] of opaque_types) {
        if (opaque_type_key.def_id !== def_id) {
          continue;
        }

        const expected = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(ty.ty, tcx, opaque_type_key.args, fold_Ty));
        this.demand_eqtype(hidden_type.span, expected, hidden_type.ty);
      }

      // Being explicit here: it may be possible that we in a
      // previous call to this function we did an insert, but this
      // should be just fine, since they all get equated anyways and
      // we shouldn't ever go from `HasDefiningUse` to anyway else.
      this.typeck_results.hidden_types.set(def_id, ty);
    }

    // If we're in `fn try_handle_opaque_type_uses_next` then do not
    // report any errors.
    if (!error_on_missing_defining_use) {
      continue;
    }

    let guar: ErrorGuaranteed;
    switch (uk.$) {
      case "HasDefiningUse":
        continue;
      case "None": {
        const tainted = this.tainted_by_errors();
        if (tainted !== undefined) {
          guar = tainted;
        } else {
          guar = report_item_does_not_constrain_error(this.tcx, this.body_def_id, def_id, undefined);
        }
        break;
      }
      case "NonDefiningUse": {
        const opaque_type_key = uk._0;
        const hidden_type = uk._1;
        guar = report_item_does_not_constrain_error(this.tcx, this.body_def_id, def_id, [opaque_type_key, hidden_type.span]);
        break;
      }
      case "UnconstrainedHiddenType": {
        const hidden_type = uk._0;
        const tainted = this.tainted_by_errors();
        if (tainted !== undefined) {
          guar = tainted;
        } else {
          let infer_var: Term | undefined;
          for (const arg of hidden_type.ty.walk()) {
            const term = GenericArg.as_term(arg);
            if (term !== undefined && Term.is_infer(term)) {
              infer_var = term;
              break;
            }
          }
          guar = err_ctxt(this)
            .emit_inference_failure_err(this.body_def_id, hidden_type.span, infer_var ?? hidden_type.ty, "E0282", false)
            // The shared E0282 label only says "cannot infer type", which gives no
            // hint that the ambiguity is in an opaque's hidden type rather than an
            // ordinary local inference failure.
            .with_note("cannot infer type of hidden type of opaque")
            .emit_err();
        }
        break;
      }
    }

    this.typeck_results.hidden_types.set(def_id, DefinitionSiteHiddenType.new_error(tcx, guar));
    this.set_tainted_by_errors(guar);
  }
};

// #[tracing::instrument(skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/opaque_types.rs:219 consider_opaque_type_use
FnCtxt.prototype.consider_opaque_type_use = function (this: FnCtxt, opaque_type_key: OpaqueTypeKey, hidden_type_: ProvisionalHiddenType): UsageKind {
  const r = opaque_type_has_defining_use_args(this.infcx, opaque_type_key, hidden_type_.span, "HirTypeck");
  if (r.$ === "Err") {
    const err = r._0;
    const guar = NonDefiningUseReason_tainted(err);
    if (guar !== undefined) {
      return { $: "HasDefiningUse", _0: DefinitionSiteHiddenType.new_error(this.tcx, guar) };
    } else {
      return { $: "NonDefiningUse", _0: opaque_type_key, _1: hidden_type_ };
    }
  }

  // We ignore uses of the opaque if they have any inference variables
  // as this can frequently happen with recursive calls.
  //
  // See `tests/ui/traits/next-solver/opaques/universal-args-non-defining.rs`.
  if (TypeVisitableExt.has_non_region_infer(hidden_type_.ty, fold_Ty)) {
    return { $: "UnconstrainedHiddenType", _0: hidden_type_ };
  }

  const cause = ObligationCause.misc(hidden_type_.span, this.body_def_id);
  const at = this.at(cause, this.param_env);
  let hidden_type: ProvisionalHiddenType;
  const n = deeply_normalize<ProvisionalHiddenType, FulfillmentError>(at, Unnormalized.new_wip(hidden_type_), FromSolverError_FulfillmentError, fold_ProvisionalHiddenType);
  if (n.$ === "Ok") {
    hidden_type = n._0;
  } else {
    const errors = n._0;
    const guar = err_ctxt(this).report_fulfillment_errors(errors);
    hidden_type = ProvisionalHiddenType.new_error(this.tcx, guar);
  }
  const hidden_type2 = hidden_type.remap_generic_params_to_declaration_params(opaque_type_key, this.tcx, "HirTypeck");
  return { $: "HasDefiningUse", _0: hidden_type2 };
};

/// We may in theory add further uses of an opaque after cloning the opaque
/// types storage during writeback when computing the defining uses.
///
/// Silently ignoring them is dangerous and could result in ICE or even in
/// unsoundness, so we make sure we catch such cases here. There's currently
/// no known code where this actually happens, even with the new solver which
/// does normalize types in writeback after cloning the opaque type storage.
///
/// FIXME(@lcnr): I believe this should be possible in theory and would like
/// an actual test here. After playing around with this for an hour, I wasn't
/// able to do anything which didn't already try to normalize the opaque before
/// then, either allowing compilation to succeed or causing an ambiguity error.
// rustc: compiler/rustc_hir_typeck/src/opaque_types.rs:277 detect_opaque_types_added_during_writeback
FnCtxt.prototype.detect_opaque_types_added_during_writeback = function (this: FnCtxt): void {
  const num_entries = unwrap(this.checked_opaque_types_storage_entries);
  this.checked_opaque_types_storage_entries = undefined;
  for (const [key, hidden_type] of this.inner.opaque_types().deref().opaque_types_added_since(num_entries)) {
    const opaque_type_string = this.tcx.def_path_str(LocalDefIdC.to_def_id(key.def_id));
    const msg = `unexpected cyclic definition of \`${opaque_type_string}\``;
    this.dcx().span_delayed_bug(hidden_type.span, msg);
  }
  void this.take_opaque_types();
};

// ---- helpers ---------------------------------------------------------------------------------------------------------

/**
 * PORT(wave 19): `error_reporting::TypeErrCtxt` is a `Pending` type (rustc_trait_selection decls.ts); these are the
 * methods this file calls on `FnCtxt::err_ctxt()`. Root drops the view when the errctxt contract lands.
 */
interface TypeErrCtxtView {
  // error_reporting/infer/need_type_info.rs `emit_inference_failure_err` (`TypeAnnotationNeeded::E0282` is `"E0282"`)
  emit_inference_failure_err(body_def_id: LocalDefId, failure_span: Span, term: Term, error_code: "E0282" | "E0283" | "E0284", should_label_span: boolean): Diag;
  // error_reporting/traits/fulfillment_errors.rs `report_fulfillment_errors`
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
}
function err_ctxt(fcx: FnCtxt): TypeErrCtxtView {
  return fcx.err_ctxt() as unknown as TypeErrCtxtView;
}

/** rustc_trait_selection opaque_types.rs `NonDefiningUseReason<'tcx>` (not ported). */
export type NonDefiningUseReason = Pending<"rustc_trait_selection::opaque_types::NonDefiningUseReason">;

/** PORT: rustc_trait_selection opaque_types.rs `opaque_type_has_defining_use_args` (not ported; no lane owns the file). */
export function opaque_type_has_defining_use_args(
  _infcx: InferCtxt,
  _opaque_type_key: OpaqueTypeKey,
  _span: Span,
  _defining_scope_kind: DefiningScopeKind,
): { $: "Ok"; _0: null } | { $: "Err"; _0: NonDefiningUseReason } {
  return unported("rustc_trait_selection::opaque_types::opaque_type_has_defining_use_args");
}

/** PORT: `NonDefiningUseReason::report(&self, infcx)` (rustc_trait_selection opaque_types.rs, not ported). */
export function NonDefiningUseReason_report(_self: NonDefiningUseReason, _infcx: InferCtxt): ErrorGuaranteed {
  return unported("rustc_trait_selection::opaque_types::NonDefiningUseReason::report");
}

/** PORT: `if let NonDefiningUseReason::Tainted(guar) = err` (rustc_trait_selection opaque_types.rs, not ported). */
function NonDefiningUseReason_tainted(_self: NonDefiningUseReason): ErrorGuaranteed | undefined {
  return unported("rustc_trait_selection::opaque_types::NonDefiningUseReason");
}

/** PORT: rustc_trait_selection opaque_types.rs `report_item_does_not_constrain_error` (not ported). */
function report_item_does_not_constrain_error(
  _tcx: TyCtxt,
  _item_def_id: LocalDefId,
  _def_id: LocalDefId,
  _non_defining_use: [OpaqueTypeKey, Span] | undefined,
): ErrorGuaranteed {
  return unported("rustc_trait_selection::opaque_types::report_item_does_not_constrain_error");
}


/** The derived `TypeFoldable` of `OpaqueTypeKey<'tcx>`. */
const fold_OpaqueTypeKey: TypeFoldable<OpaqueTypeKey> = {
  visit_with: visit_with_OpaqueTypeKey,
  try_fold_with: try_fold_with_OpaqueTypeKey,
  fold_with: fold_with_OpaqueTypeKey,
};
/** `#[derive(TypeFoldable, TypeVisitable)] for ty::ProvisionalHiddenType` (rustc_middle ty/mod.rs): not generated. */
const fold_ProvisionalHiddenType: TypeFoldable<ProvisionalHiddenType> = {
  visit_with: () => unported("TypeVisitable for ty::ProvisionalHiddenType (tools/codegen)"),
  try_fold_with: () => unported("TypeFoldable for ty::ProvisionalHiddenType (tools/codegen)"),
  fold_with: () => unported("TypeFoldable for ty::ProvisionalHiddenType (tools/codegen)"),
};
/** `(OpaqueTypeKey<'tcx>, ProvisionalHiddenType<'tcx>)` */
function fold_OpaqueTypeKey_ProvisionalHiddenType(): TypeFoldable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  return fold_tuple2(fold_OpaqueTypeKey, fold_ProvisionalHiddenType);
}

