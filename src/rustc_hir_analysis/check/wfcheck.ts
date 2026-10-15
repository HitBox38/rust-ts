// Port of compiler/rustc_hir_analysis/src/check/wfcheck.rs (lanes check-wf-a: lines 1–1139, check-wf-b: 1140–end).
//
// PORT notes (file-wide):
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`. `Result::and(self, res)` evaluates `res`
//   eagerly (it is an argument), so `res.and(f(..))` is `and(res, f(..))` with the call made first.
// - `WfCheckingCtxt` derefs to its `ObligationCtxt` (`impl Deref`, wfcheck.rs:57). The members of `ObligationCtxt` that
//   this file reaches through the deref (`infcx`, `register_bound`, `register_obligation`, `register_obligations`,
//   `evaluate_obligations_error_on_ambiguity`) are forwarding members of the class, next to `deref()`.
// - `value: impl TypeFoldable<TyCtxt>` takes the D4 descriptor `d_T` last (plan-m3 D4).
// - `FxIndexSet<(Region, usize)>` / `FxIndexSet<(Ty, usize)>` are `KeyedSet`s keyed by the interned value's `id` and the
//   index; `FxIndexSet<Clause>` is a `Set` (interned objects are their own keys); `FxIndexMap<LocalDefId, _>` is a `Map`.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// - The rustc_trait_selection items this file calls that are not ported yet (`ObligationCtxt`, `traits::wf`,
//   `regions::{region,ty}_known_to_outlive`, `misc::type_allowed_to_implement_const_param_ty`, the `TypeErrCtxt`
//   reports) and the items of lanes not in this lane's base (`check::check_item_type`, `const_eval_poly` (M4)) are
//   local stand-ins at the end of the check-wf-a region that stop as UNPORTED.
//
// PORT notes of the check-wf-b region (file-wide):
// - `Deref for WfCheckingCtxt` (Target = `ObligationCtxt`) is the field `ocx` (PORTING §8): `wfcx.register_bound(..)`
//   is `wfcx.register_bound(..)`, `wfcx.infcx` is `wfcx.infcx`.
// - `T: TypeFoldable` arguments take the D4 descriptor last (`wfcx.normalize(span, loc, value, d_T)`).
// - `Result<(), ErrorGuaranteed>` is `Result<null, ErrorGuaranteed>`; `?` is `if (r.$ === "Err") return r;`.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// - The items of other lanes / files that are not ported yet (`ObligationCtxt`, `traits::wf`, `Autoderef`,
//   `compare_eii`, `check::entry`, the codegen'd derives of this file's types) are stand-ins at the end of the
//   check-wf-b region ("check-wf-b stand-ins"), each naming its owner; they stop as UNPORTED and are repointed when the
//   owner merges.
//
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.

// check-wf-a imports
import { Applicability, E0714, E0750, type Diag, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { DiagSymbolList_from } from "../../rustc_errors/diagnostic_impls.ts";
import type * as hir from "../../rustc_hir/hir.ts";
import { Defaultness, Node as HirNode, debug_Item } from "../../rustc_hir/hir.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import { OutlivesEnvironment } from "../../rustc_infer/infer/outlives/env.ts";
import { Obligation, type PredicateObligation, type TraitErrors } from "../../rustc_infer/traits/mod.ts";
import { SHADOWING_SUPERTRAIT_ITEMS } from "../../rustc_lint_defs/builtin.gen.ts";
import { pluralize } from "../../rustc_lint_defs/lib.ts";
import { ObligationCause, ObligationCauseCode, type WellFormedLoc } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems, type AssocItem as AssocItemT } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_List_Ty, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { ImplTraitHeader, ParamEnv, type Term, Ty } from "../../rustc_middle/ty/mod.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import { Region as RegionC } from "../../rustc_type_ir/sty/mod.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { type Clause, Clause_upcast_from_ClauseKind, Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { display_Clause, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Span, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { type DefId, DefId_eq, LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Ident, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { fold_tuple2, fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.gen.ts";
import { FnSig as FnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { Const } from "../../rustc_type_ir/sty/mod.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { SupertraitItemShadowing_diagnostic, type SupertraitItemShadowee } from "../diagnostics.ts";
import { check_impl_wf } from "../impl_wf_check.ts";
// merge-w17 imports (the real ports of other wave-17 lanes)
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { err_ctxt } from "../../rustc_trait_selection/traits/mod.ts";
import { type_allowed_to_implement_const_param_ty } from "../../rustc_trait_selection/traits/misc.ts";
import { clause_obligations as wf_clause_obligations, trait_obligations as wf_trait_obligations, unnormalized_obligations as wf_unnormalized_obligations } from "../../rustc_trait_selection/traits/wf.ts";
import { region_known_to_outlive, ty_known_to_outlive } from "../../rustc_trait_selection/regions.ts";
import { check_item_type } from "./check.ts";
import { solve } from "../../rustc_next_trait_solver/lib.ts";
// check-wf-b imports
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type ControlFlow, ControlFlow as ControlFlowC } from "../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { TransitiveRelationBuilder } from "../../rustc_data_structures/transitive_relation.ts";
import { E0392, msg } from "../../rustc_errors/lib.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import { FnRetTy, ImplicitSelfKind, ItemKind, ParamName } from "../../rustc_hir/hir.ts";
import { debug_ItemKind } from "../../rustc_hir/hir.gen.ts";
import { Visitor, walk_item, walk_ty } from "../../rustc_hir/intravisit.ts";
import type { SolverRegionConstraint } from "../../rustc_infer/infer/solver_region_constraints.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.ts";
import { TraitErrors as TraitErrorsC } from "../../rustc_infer/traits/mod.ts";
import { REDUNDANT_LIFETIMES } from "../../rustc_lint_defs/builtin.gen.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import { WellFormedLoc as WellFormedLocC } from "../../rustc_middle/traits/mod.ts";
import { fold_GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { ConstConditions, type GenericClauses, GenericClauses as GenericClausesC, GenericParamDef as GenericParamDefC } from "../../rustc_middle/ty/generics.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, ParamEnv as ParamEnvC, Term as TermC } from "../../rustc_middle/ty/mod.ts";
import { ParamConst } from "../../rustc_middle/ty/sty.ts";
import { clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { Clause_upcast_from_Binder_ClauseKind, Predicate_upcast_from_Binder_ClauseKind, Predicate_upcast_from_Clause, Predicate_upcast_from_PredicateKind, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { DefIdSet, debug_DefId } from "../../rustc_span/def_id.ts";
import { debug_Span, Span as SpanC } from "../../rustc_span/lib.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { fold_Binder } from "../../rustc_type_ir/binder.ts";
import { elaborate, type Elaboratable, Elaboratable_Clause } from "../../rustc_type_ir/elaborate.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef, type TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { as_interner, PolyTraitRef as PolyTraitRefC, ProjectionClause as ProjectionClauseC, type TraitClause, TraitClause as TraitClauseC, TraitRef as TraitRefC } from "../../rustc_type_ir/predicate.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { fold_with_ClauseKind, try_fold_with_ClauseKind, visit_with_ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias, debug_Alias, type AliasTy } from "../../rustc_type_ir/ty/alias.ts";
import { debug_AliasTyKind, fold_with_AliasTyKind, try_fold_with_AliasTyKind, visit_with_AliasTyKind } from "../../rustc_type_ir/ty_kind.gen.ts";
import { debug_Binder } from "../../rustc_type_ir/binder.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { And, Assumptions, debug_And, debug_LeafRegionConstraint, debug_Or, eagerly_handle_placeholders_in_universe, LeafRegionConstraint, type Or, RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import { debug_Region, fold_Const, fold_Region } from "../../rustc_type_ir/sty/mod.ts";
import type { BoundRegion } from "../../rustc_type_ir/binder.ts";
import type { LateParamRegionKind } from "../../rustc_middle/ty/region.ts";
import { fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { BoundVar } from "../../rustc_type_ir/lib.gen.ts";
import type { PolyFnSig, PolyTypeOutlivesClause, RegionOutlivesClause } from "../../rustc_type_ir/decls.ts";
import { type Debug, debug_option, debug_tuple, type Fmt, format_debug, PRETTY } from "../../std/fmt.ts";
import { assert_eq, unreachable } from "../../std/panic.ts";
import type { Parameter } from "../constrained_generic_params.ts";
import type { ItemCtxt } from "../decls.ts";
import type * as diagnostics_t from "../diagnostics.ts";

/** PORT: `impl Upcast<TyCtxt, Predicate> for ClauseKind` takes `TyCtxt` where `Obligation::new` names the `Interner`. */
function as_obligation_upcast<T, U>(upcast: (from: T, tcx: TyCtxt) => U): (from: T, tcx: Interner) => U {
  return upcast as unknown as (from: T, tcx: Interner) => U;
}

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:52 WfCheckingCtxt
export class WfCheckingCtxt {
  constructor(
    public ocx: ObligationCtxt<FulfillmentError>,
    // PORT: private upstream; the rest of the file (lane check-wf-b) reads them.
    public body_def_id: LocalDefId,
    public param_env: ParamEnv,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:59 deref
  deref(): ObligationCtxt<FulfillmentError> {
    return this.ocx;
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::infcx`. */
  get infcx(): InferCtxt {
    return this.deref().infcx;
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::register_bound`. */
  register_bound(cause: ObligationCause, param_env: ParamEnv, ty: Ty, def_id: DefId): void {
    this.deref().register_bound(cause, param_env, ty, def_id);
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::register_obligation`. */
  register_obligation(obligation: PredicateObligation): void {
    this.deref().register_obligation(obligation);
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::register_obligations`. */
  register_obligations(obligations: Iterable<PredicateObligation>): void {
    this.deref().register_obligations(obligations);
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::evaluate_obligations_error_on_ambiguity`. */
  evaluate_obligations_error_on_ambiguity(): TraitErrors<FulfillmentError> {
    return this.deref().evaluate_obligations_error_on_ambiguity();
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:65 tcx
  tcx(): TyCtxt {
    return this.ocx.infcx.tcx;
  }

  // Convenience function to normalize during wfcheck. This performs
  // `ObligationCtxt::normalize`, but provides a nice `ObligationCauseCode`.
  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:71 normalize
  normalize<T>(span: Span, loc: WellFormedLoc, value: Unnormalized<T>, d_T: TypeFoldable<T>): T {
    return this.ocx.normalize(
      ObligationCause.new(span, this.body_def_id, { $: "WellFormed", _0: loc }),
      this.param_env,
      value,
      d_T,
    );
  }

  /// Convenience function to *deeply* normalize during wfcheck. In the old solver,
  /// this just dispatches to [`WfCheckingCtxt::normalize`], but in the new solver
  /// this calls `deeply_normalize` and reports errors if they are encountered.
  ///
  /// This function should be called in favor of `normalize` in cases where we will
  /// then check the well-formedness of the type, since we only use the normalized
  /// signature types for implied bounds when checking regions.
  // FIXME(-Znext-solver): This should be removed when we compute implied outlives
  // bounds using the unnormalized signature of the function we're checking.
  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:91 deeply_normalize
  deeply_normalize<T>(span: Span, loc: WellFormedLoc, value: Unnormalized<T>, d_T: TypeFoldable<T>): T {
    if (this.infcx.next_trait_solver()) {
      const r = this.ocx.deeply_normalize(
        ObligationCause.new(span, this.body_def_id, { $: "WellFormed", _0: loc }),
        this.param_env,
        Unnormalized.as_ref(value),
        d_T,
      );
      if (r.$ === "Ok") {
        return r._0;
      } else {
        const errors = r._0;
        err_ctxt(this.infcx).report_fulfillment_errors(errors);
        return Unnormalized.skip_norm_wip(value);
      }
    } else {
      return this.normalize(span, loc, value, d_T);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:117 register_wf_obligation
  register_wf_obligation(span: Span, loc: WellFormedLoc, term: Term): void {
    const cause = ObligationCause.new(span, this.body_def_id, { $: "WellFormed", _0: loc });
    this.ocx.register_obligation(
      Obligation.new(this.tcx(), cause, this.param_env, { $: "WellFormed", _0: term } as ClauseKind, as_obligation_upcast(Predicate_upcast_from_ClauseKind)),
    );
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:136 unnormalized_obligations
  unnormalized_obligations(span: Span, ty: Ty): PredicateObligation[] | undefined {
    return wf_unnormalized_obligations(this.ocx.infcx, this.param_env, ty, span, this.body_def_id);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:151 enter_wf_checking_ctxt
export function enter_wf_checking_ctxt(
  tcx: TyCtxt,
  body_def_id: LocalDefId,
  f: (wfcx: WfCheckingCtxt) => Result<null, ErrorGuaranteed>,
): Result<null, ErrorGuaranteed> {
  const param_env = tcx.param_env(body_def_id) as ParamEnv;
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  const wfcx = new WfCheckingCtxt(ocx, body_def_id, param_env);

  // As of now, bounds are only enforced on checked type aliases, they're ignored for most type
  // aliases. So, only check for false global bounds if we're not ignoring bounds altogether.
  const ignore_bounds = tcx.def_kind(body_def_id).$ === "TyAlias" && !(tcx.type_alias_is_checked(body_def_id) as boolean);

  if (!ignore_bounds && !tcx.features().trivial_bounds()) {
    wfcx.check_false_global_bounds();
  }
  const r = f(wfcx);
  if (r.$ === "Err") return r;

  const errors = wfcx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    return Err(err_ctxt(infcx).report_fulfillment_errors(errors._0));
  }

  const assumed_wf_types_r = wfcx.ocx.assumed_wf_types_and_report_errors(param_env, body_def_id);
  if (assumed_wf_types_r.$ === "Err") return assumed_wf_types_r;
  const assumed_wf_types = assumed_wf_types_r._0;
  // debug!(?assumed_wf_types);

  const infcx_compat = infcx.fork();

  // We specifically want to *disable* the implied bounds hack, first,
  // so we can detect when failures are due to bevy's implied bounds.
  const outlives_env = OutlivesEnvironment.new_with_implied_bounds_compat(
    infcx,
    body_def_id,
    param_env,
    [...assumed_wf_types],
    true,
  );

  lint_redundant_lifetimes(tcx, body_def_id, outlives_env);

  const errors_ = infcx.resolve_regions_with_outlives_env(outlives_env);
  if (errors_.length === 0) {
    return Ok(null);
  }

  const outlives_env_ = OutlivesEnvironment.new_with_implied_bounds_compat(
    infcx_compat,
    body_def_id,
    param_env,
    assumed_wf_types,
    // Don't *disable* the implied bounds hack; though this will only apply
    // the implied bounds hack if this contains `bevy_ecs`'s `ParamSet` type.
    false,
  );
  const errors_compat = infcx_compat.resolve_regions_with_outlives_env(outlives_env_);
  if (errors_compat.length === 0) {
    // FIXME: Once we fix bevy, this would be the place to insert a warning
    // to upgrade bevy.
    return Ok(null);
  } else {
    return Err(err_ctxt(infcx_compat).report_region_errors(body_def_id, errors_compat));
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:221 check_well_formed
export function check_well_formed(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  let res = check_item_type(tcx, def_id);

  for (const param of (tcx.generics_of(def_id) as Generics).own_params) {
    res = and(res, check_param_wf(tcx, param));
  }

  return res;
}

/// Checks that the field types (in a struct def'n) or argument types (in an enum def'n) are
/// well-formed, meaning that they do not require any constraints not declared in the struct
/// definition itself. For example, this definition would be illegal:
///
/// ```rust
/// struct StaticRef<T> { x: &'static T }
/// ```
///
/// because the type did not declare that `T: 'static`.
///
/// We do this check as a pre-pass before checking fn bodies because if these constraints are
/// not included it frequently leads to confusing errors in fn bodies. So it's better to check
/// the types first.
// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:248 check_item
export function check_item(tcx: TyCtxt, item: hir.Item): Result<null, ErrorGuaranteed> {
  const def_id = item.owner_id.def_id;

  // debug!(
  //     ?item.owner_id,
  //     item.name = ? tcx.def_path_str(def_id)
  // );

  const kind = item.kind;
  switch (kind.$) {
    // Right now we check that every default trait implementation
    // has an implementation of itself. Basically, a case like:
    //
    //     impl Trait for T {}
    //
    // has a requirement of `T: Trait` which was required for default
    // method implementations. Although this could be improved now that
    // there's a better infrastructure in place for this, it's being left
    // for a follow-up work.
    //
    // Since there's such a requirement, we need to check *just* positive
    // implementations, otherwise things like:
    //
    //     impl !Send for T {}
    //
    // won't be allowed unless there's an *explicit* implementation of `Send`
    // for `T`
    case "Impl": {
      const impl_ = kind._0;
      const r = check_impl_wf(tcx, def_id, impl_.of_trait !== undefined);
      if (r.$ === "Err") return r;
      let res: Result<null, ErrorGuaranteed> = Ok(null);
      const of_trait = impl_.of_trait;
      if (of_trait !== undefined) {
        const header = tcx.impl_trait_header(def_id) as ImplTraitHeader;
        const is_auto = tcx.trait_is_auto(EarlyBinder.skip_binder(header.trait_ref).def_id);
        if (of_trait.defaultness.$ === "Default" && is_auto) {
          const sp = of_trait.trait_ref.path.span;
          res = Err(
            tcx
              .dcx()
              .struct_span_err(sp, "impls of auto traits cannot be default")
              .with_span_labels(of_trait.defaultness_span === undefined ? [] : [of_trait.defaultness_span], "default because of this")
              .with_span_label(sp, "auto trait")
              .emit_err(),
          );
        }
        switch (header.polarity) {
          case "Positive": {
            res = and(res, check_impl(tcx, item, impl_));
            break;
          }
          case "Negative": {
            if (of_trait.polarity.$ !== "Negative") {
              return bug("impl_polarity query disagrees with impl's polarity in HIR");
            }
            const span = of_trait.polarity._0;
            // FIXME(#27579): what amount of WF checking do we need for neg impls?
            if (of_trait.defaultness.$ === "Default") {
              const spans = [span];
              if (of_trait.defaultness_span !== undefined) spans.push(of_trait.defaultness_span);
              res = Err(struct_span_code_err(tcx.dcx(), spans, E0750, "negative impls cannot be default impls").emit_err());
            }
            break;
          }
        }
      } else {
        res = and(res, check_impl(tcx, item, impl_));
      }
      return res;
    }
    case "Fn":
      return check_item_fn(tcx, def_id, kind.sig.decl);
    // Note: do not add new entries to this match. Instead add all new logic in `check_item_type`
    default:
      return span_bug(item.span, `should have been handled by the type based wf check: ${debug_Item(item, PLAIN)}`);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:325 check_foreign_item
export function check_foreign_item(tcx: TyCtxt, item: hir.ForeignItem): Result<null, ErrorGuaranteed> {
  const def_id = item.owner_id.def_id;

  // debug!(
  //     ?item.owner_id,
  //     item.name = ? tcx.def_path_str(def_id)
  // );

  const kind = item.kind;
  switch (kind.$) {
    case "Fn":
      return check_item_fn(tcx, def_id, kind._0.decl);
    case "Static":
    case "Type":
      return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:342 check_trait_item
export function check_trait_item(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  // Check that an item definition in a subtrait is shadowing a supertrait item.
  lint_item_shadowing_supertrait_item(tcx, def_id);

  let res: Result<null, ErrorGuaranteed> = Ok(null);

  if (tcx.def_kind(def_id).$ === "AssocFn") {
    for (const assoc_ty_def_id of tcx.associated_types_for_impl_traits_in_associated_fn(LocalDefIdC.to_def_id(def_id))) {
      res = and(res, check_associated_item(tcx, assoc_ty_def_id.expect_local()));
    }
  }
  return res;
}

/// Require that the user writes where clauses on GATs for the implicit
/// outlives bounds involving trait parameters in trait functions and
/// lifetimes passed as GAT args. See `self-outlives-lint` test.
///
/// We use the following trait as an example throughout this function:
/// ```rust,ignore (this code fails due to this lint)
/// trait IntoIter {
///     type Iter<'a>: Iterator<Item = Self::Item<'a>>;
///     type Item<'a>;
///     fn into_iter<'a>(&'a self) -> Self::Iter<'a>;
/// }
/// ```
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:373 check_gat_where_clauses
export function check_gat_where_clauses(tcx: TyCtxt, trait_def_id: LocalDefId): void {
  // Associates every GAT's def_id to a list of possibly missing bounds detected by this lint.
  const required_bounds_by_item = new Map<LocalDefId, Set<Clause>>();
  const associated_items = tcx.associated_items(trait_def_id) as AssocItems;

  // Loop over all GATs together, because if this lint suggests adding a where-clause bound
  // to one GAT, it might then require us to an additional bound on another GAT.
  // In our `IntoIter` example, we discover a missing `Self: 'a` bound on `Iter<'a>`, which
  // then in a second loop adds a `Self: 'a` bound to `Item` due to the relationship between
  // those GATs.
  for (;;) {
    let should_continue = false;
    for (const gat_item_ of AssocItems.in_definition_order(associated_items)) {
      const gat_def_id = gat_item_.def_id.expect_local();
      const gat_item = tcx.associated_item(gat_def_id) as AssocItemT;
      // If this item is not an assoc ty, or has no args, then it's not a GAT
      if (!AssocItem.is_type(gat_item)) {
        continue;
      }
      const gat_generics = tcx.generics_of(gat_def_id) as Generics;
      // FIXME(jackh726): we can also warn in the more general case
      if (gat_generics.is_own_empty()) {
        continue;
      }

      // Gather the bounds with which all other items inside of this trait constrain the GAT.
      // This is calculated by taking the intersection of the bounds that each item
      // constrains the GAT with individually.
      let new_required_bounds: Set<Clause> | undefined = undefined;
      for (const item of AssocItems.in_definition_order(associated_items)) {
        const item_def_id = item.def_id.expect_local();
        // Skip our own GAT, since it does not constrain itself at all.
        if (item_def_id === gat_def_id) {
          continue;
        }

        const param_env = tcx.param_env(item_def_id) as ParamEnv;

        let item_required_bounds: Set<Clause> | undefined;
        const item_kind = (tcx.associated_item(item_def_id) as AssocItemT).kind;
        switch (item_kind.$) {
          // In our example, this corresponds to `into_iter` method
          case "Fn": {
            // For methods, we check the function signature's return type for any GATs
            // to constrain. In the `into_iter` case, we see that the return type
            // `Self::Iter<'a>` is a GAT we want to gather any potential missing bounds from.
            const sig: FnSig = tcx.liberate_late_bound_regions(
              LocalDefIdC.to_def_id(item_def_id),
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(item_def_id) as EarlyBinder<Binder<FnSig>>)),
              d_FnSig,
            );
            item_required_bounds = gather_gat_bounds(
              tcx,
              param_env,
              item_def_id,
              sig.inputs_and_output,
              // We also assume that all of the function signature's parameter types
              // are well formed.
              new Set(FnSigC.inputs(sig)),
              gat_def_id,
              gat_generics,
              fold_List_Ty,
            );
            break;
          }
          // In our example, this corresponds to the `Iter` and `Item` associated types
          case "Type": {
            // If our associated item is a GAT with missing bounds, add them to
            // the param-env here. This allows this GAT to propagate missing bounds
            // to other GATs.
            const param_env_ = augment_param_env(tcx, param_env, required_bounds_by_item.get(item_def_id));
            item_required_bounds = gather_gat_bounds(
              tcx,
              param_env_,
              item_def_id,
              [
                ...EarlyBinder.iter_identity_copied(tcx.explicit_item_bounds(item_def_id) as EarlyBinder<readonly [Clause, Span][]>),
              ].map(Unnormalized.skip_norm_wip),
              new Set(),
              gat_def_id,
              gat_generics,
              d_Vec_Clause_Span,
            );
            break;
          }
          case "Const":
            item_required_bounds = undefined;
            break;
        }

        if (item_required_bounds !== undefined) {
          // Take the intersection of the required bounds for this GAT, and
          // the item_required_bounds which are the ones implied by just
          // this item alone.
          // This is why we use an Option<_>, since we need to distinguish
          // the empty set of bounds from the _uninitialized_ set of bounds.
          if (new_required_bounds !== undefined) {
            for (const b of new_required_bounds) {
              if (!item_required_bounds.has(b)) new_required_bounds.delete(b);
            }
          } else {
            new_required_bounds = item_required_bounds;
          }
        }
      }

      if (new_required_bounds !== undefined) {
        let required_bounds = required_bounds_by_item.get(gat_def_id);
        if (required_bounds === undefined) {
          required_bounds = new Set();
          required_bounds_by_item.set(gat_def_id, required_bounds);
        }
        // PORT: `.any(|p| required_bounds.insert(p))` stops at the first newly inserted bound.
        let any = false;
        for (const p of new_required_bounds) {
          const inserted = !required_bounds.has(p);
          required_bounds.add(p);
          if (inserted) {
            any = true;
            break;
          }
        }
        if (any) {
          // Iterate until our required_bounds no longer change
          // Since they changed here, we should continue the loop
          should_continue = true;
        }
      }
    }
    // We know that this loop will eventually halt, since we only set `should_continue` if the
    // `required_bounds` for this item grows. Since we are not creating any new region or type
    // variables, the set of all region and type bounds that we could ever insert are limited
    // by the number of unique types and regions we observe in a given item.
    if (!should_continue) {
      break;
    }
  }

  for (const [gat_def_id, required_bounds] of required_bounds_by_item) {
    // Don't suggest adding `Self: 'a` to a GAT that can't be named
    if (tcx.is_impl_trait_in_trait(LocalDefIdC.to_def_id(gat_def_id))) {
      continue;
    }

    const gat_item_hir = tcx.hir_expect_trait_item(gat_def_id);
    // debug!(?required_bounds);
    const param_env = tcx.param_env(gat_def_id) as ParamEnv;

    const unsatisfied_bounds: string[] = [...required_bounds]
      .filter((clause) => {
        const k = Binder.skip_binder(clause.kind());
        switch (k.$) {
          case "RegionOutlives": {
            const [a, b] = [k._0._0, k._0._1];
            return !region_known_to_outlive(tcx, gat_def_id, param_env, new Set(), a, b);
          }
          case "TypeOutlives": {
            const [a, b] = [k._0._0, k._0._1];
            return !ty_known_to_outlive(tcx, gat_def_id, param_env, new Set(), Unnormalized.new_wip(a), b);
          }
          default:
            return bug("Unexpected ClauseKind");
        }
      })
      .map((clause) => display_Clause(clause));

    if (unsatisfied_bounds.length !== 0) {
      const plural = pluralize(unsatisfied_bounds.length);
      const suggestion = `${gat_item_hir.generics.add_where_or_trailing_comma()} ${unsatisfied_bounds.join(", ")}`;
      const bound = unsatisfied_bounds.length > 1 ? "these bounds are" : "this bound is";
      tcx
        .dcx()
        .struct_span_err(gat_item_hir.span, `missing required bound${plural} on \`${display_Ident(gat_item_hir.ident)}\``)
        .with_span_suggestion(
          gat_item_hir.generics.tail_span_for_predicate_suggestion(),
          `add the required where clause${plural}`,
          suggestion,
          Applicability.MachineApplicable,
        )
        .with_note(`${bound} currently required to ensure that impls have maximum flexibility`)
        .with_note(
          "we are soliciting feedback, see issue #87479 " + "<https://github.com/rust-lang/rust/issues/87479> for more information",
        )
        .emit();
    }
  }
}

/// Add a new set of predicates to the caller_bounds of an existing param_env.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:560 augment_param_env
function augment_param_env(tcx: TyCtxt, param_env: ParamEnv, new_clauses: Set<Clause> | undefined): ParamEnv {
  if (new_clauses === undefined) {
    return param_env;
  }

  if (new_clauses.size === 0) {
    return param_env;
  }

  const bounds = [...param_env.caller_bounds(), ...new_clauses];
  // FIXME(compiler-errors): Perhaps there is a case where we need to normalize this
  // i.e. traits::normalize_param_env_or_error
  return ParamEnv.new(tcx, bounds);
}

/// We use the following trait as an example throughout this function.
/// Specifically, let's assume that `to_check` here is the return type
/// of `into_iter`, and the GAT we are checking this for is `Iter`.
/// ```rust,ignore (this code fails due to this lint)
/// trait IntoIter {
///     type Iter<'a>: Iterator<Item = Self::Item<'a>>;
///     type Item<'a>;
///     fn into_iter<'a>(&'a self) -> Self::Iter<'a>;
/// }
/// ```
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:589 gather_gat_bounds
function gather_gat_bounds<T>(
  tcx: TyCtxt,
  param_env: ParamEnv,
  item_def_id: LocalDefId,
  to_check: T,
  wf_tys: Set<Ty>,
  gat_def_id: LocalDefId,
  gat_generics: Generics,
  d_T: TypeFoldable<T>,
): Set<Clause> | undefined {
  // The bounds we that we would require from `to_check`
  const bounds = new Set<Clause>();

  const [regions, types] = GATArgsCollector.visit(LocalDefIdC.to_def_id(gat_def_id), to_check, d_T);

  // If both regions and types are empty, then this GAT isn't in the
  // set of types we are checking, and we shouldn't try to do clause analysis
  // (particularly, doing so would end up with an empty set of clauses,
  // since the current method would require none, and we take the
  // intersection of requirements of all methods)
  if (types.size === 0 && regions.size === 0) {
    return undefined;
  }

  for (const [region_a, region_a_idx] of regions) {
    // Ignore `'static` lifetimes for the purpose of this lint: it's
    // because we know it outlives everything and so doesn't give meaningful
    // clues. Also ignore `ReError`, to avoid knock-down errors.
    const ka = region_a.kind();
    if (ka.$ === "ReStatic" || ka.$ === "ReError") {
      continue;
    }
    // For each region argument (e.g., `'a` in our example), check for a
    // relationship to the type arguments (e.g., `Self`). If there is an
    // outlives relationship (`Self: 'a`), then we want to ensure that is
    // reflected in a where clause on the GAT itself.
    for (const [ty, ty_idx] of types) {
      // In our example, requires that `Self: 'a`
      if (ty_known_to_outlive(tcx, item_def_id, param_env, wf_tys, Unnormalized.new_wip(ty), region_a)) {
        // debug!(?ty_idx, ?region_a_idx);
        // debug!("required clause: {ty} must outlive {region_a}");
        // Translate into the generic parameters of the GAT. In
        // our example, the type was `Self`, which will also be
        // `Self` in the GAT.
        const ty_param_ = gat_generics.param_at(ty_idx, tcx);
        const ty_param = Ty.new_param(tcx, ty_param_.index, ty_param_.name);
        // Same for the region. In our example, 'a corresponds
        // to the 'me parameter.
        const region_param_ = gat_generics.param_at(region_a_idx, tcx);
        const region_param = RegionC.new_early_param(tcx, { index: region_param_.index, name: region_param_.name });
        // The clause we expect to see. (In our example,
        // `Self: 'me`.)
        bounds.add(Clause_upcast_from_ClauseKind({ $: "TypeOutlives", _0: { _0: ty_param, _1: region_param } }, tcx));
      }
    }

    // For each region argument (e.g., `'a` in our example), also check for a
    // relationship to the other region arguments. If there is an outlives
    // relationship, then we want to ensure that is reflected in the where clause
    // on the GAT itself.
    for (const [region_b, region_b_idx] of regions) {
      // Again, skip `'static` because it outlives everything. Also, we trivially
      // know that a region outlives itself. Also ignore `ReError`, to avoid
      // knock-down errors.
      const kb = region_b.kind();
      if (kb.$ === "ReStatic" || kb.$ === "ReError" || region_a === region_b) {
        continue;
      }
      if (region_known_to_outlive(tcx, item_def_id, param_env, wf_tys, region_a, region_b)) {
        // debug!(?region_a_idx, ?region_b_idx);
        // debug!("required clause: {region_a} must outlive {region_b}");
        // Translate into the generic parameters of the GAT.
        const region_a_param_ = gat_generics.param_at(region_a_idx, tcx);
        const region_a_param = RegionC.new_early_param(tcx, { index: region_a_param_.index, name: region_a_param_.name });
        // Same for the region.
        const region_b_param_ = gat_generics.param_at(region_b_idx, tcx);
        const region_b_param = RegionC.new_early_param(tcx, { index: region_b_param_.index, name: region_b_param_.name });
        // The clause we expect to see.
        bounds.add(Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: region_a_param, _1: region_b_param } }, tcx));
      }
    }
  }

  return bounds;
}

/// TypeVisitor that looks for uses of GATs like
/// `<P0 as Trait<P1..Pn>>::GAT<Pn..Pm>` and adds the arguments `P0..Pm` into
/// the two vectors, `regions` and `types` (depending on their kind). For each
/// parameter `Pi` also track the index `i`.
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:701 GATArgsCollector
class GATArgsCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public gat: DefId,
    // Which region appears and which parameter index its instantiated with
    public regions: KeyedSet<[Region, number]>,
    // Which params appears and which parameter index its instantiated with
    public types: KeyedSet<[Ty, number]>,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:710 visit
  static visit<T>(gat: DefId, t: T, d_T: TypeFoldable<T>): [KeyedSet<[Region, number]>, KeyedSet<[Ty, number]>] {
    const visitor = new GATArgsCollector(gat, new KeyedSet<[Region, number]>(key_interned_usize), new KeyedSet<[Ty, number]>(key_interned_usize));
    d_T.visit_with(t, visitor);
    return [visitor.regions, visitor.types];
  }

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<U>(t: Binder<U>, d: TypeVisitable<U>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:722 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection" && DefId_eq(k._1.kind.def_id, this.gat)) {
      const args = k._1.args;
      let idx = 0;
      for (const arg of args) {
        const ak = GenericArg.kind(arg);
        switch (ak.$) {
          case "Lifetime": {
            const lt = ak._0;
            if (!lt.is_bound()) {
              this.regions.add([lt, idx]);
            }
            break;
          }
          case "Type": {
            this.types.add([ak._0, idx]);
            break;
          }
          default:
            break;
        }
        idx += 1;
      }
    }
    return fold_Ty.super_visit_with(t, this);
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
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** PORT: the `Hash`+`Eq` of `(Region<'tcx>, usize)` / `(Ty<'tcx>, usize)` (interned by identity, so by `id`). */
function key_interned_usize<T extends { id: number }>(k: [T, number]): string {
  return `${k[0].id}:${k[1]}`;
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:745 lint_item_shadowing_supertrait_item
function lint_item_shadowing_supertrait_item(tcx: TyCtxt, trait_item_def_id: LocalDefId): void {
  const item_name = tcx.item_name(LocalDefIdC.to_def_id(trait_item_def_id));
  const trait_def_id = tcx.local_parent(trait_item_def_id);

  const shadowed: AssocItemT[] = [...supertrait_def_ids(tcx, LocalDefIdC.to_def_id(trait_def_id))]
    .slice(1)
    .flatMap((supertrait_def_id) => [
      ...AssocItems.filter_by_name_unhygienic(tcx.associated_items(supertrait_def_id) as AssocItems, item_name),
    ]);
  if (shadowed.length !== 0) {
    let shadowee: SupertraitItemShadowee;
    if (shadowed.length === 1) {
      const shadowed_ = shadowed[0]!;
      shadowee = {
        $: "Labeled",
        span: tcx.def_span(shadowed_.def_id),
        supertrait: tcx.item_name(AssocItem.trait_container(shadowed_, tcx)!),
      };
    } else {
      const traits: Symbol[] = [];
      const spans: Span[] = [];
      for (const item of shadowed) {
        traits.push(tcx.item_name(AssocItem.trait_container(item, tcx)!));
        spans.push(tcx.def_span(item.def_id));
      }
      shadowee = {
        $: "Several",
        traits: DiagSymbolList_from(traits),
        spans: MultiSpan.from_spans(spans),
      };
    }

    tcx.emit_node_span_lint(
      SHADOWING_SUPERTRAIT_ITEMS,
      tcx.local_def_id_to_hir_id(trait_item_def_id),
      tcx.def_span(LocalDefIdC.to_def_id(trait_item_def_id)),
      SupertraitItemShadowing_diagnostic({
        item: item_name,
        subtrait: tcx.item_name(LocalDefIdC.to_def_id(trait_def_id)),
        shadowee,
      }),
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:787 check_param_wf
export function check_param_wf(tcx: TyCtxt, param: GenericParamDef): Result<null, ErrorGuaranteed> {
  switch (param.kind.$) {
    // We currently only check wf of const params here.
    case "Lifetime":
    case "Type":
      return Ok(null);

    // Const parameters are well formed if their type is structural match.
    case "Const": {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param.def_id) as EarlyBinder<Ty>));
      const span = tcx.def_span(param.def_id);
      const def_id = param.def_id.expect_local();

      if (tcx.features().const_param_ty_unchecked()) {
        return enter_wf_checking_ctxt(tcx, tcx.local_parent(def_id), (wfcx) => {
          wfcx.register_wf_obligation(span, WellFormedLoc_None, ty);
          return Ok(null);
        });
      } else if (tcx.features().adt_const_params() || tcx.features().min_adt_const_params()) {
        return enter_wf_checking_ctxt(tcx, tcx.local_parent(def_id), (wfcx) => {
          wfcx.register_bound(
            ObligationCause.new(span, def_id, { $: "ConstParam", _0: ty }),
            wfcx.param_env,
            ty,
            tcx.require_lang_item(LangItem.ConstParamTy, span),
          );
          return Ok(null);
        });
      } else {
        const span_ = (): Span => {
          const kind = HirNode.expect_generic_param(tcx.hir_node_by_def_id(def_id)).kind;
          if (kind.$ !== "Const") {
            return bug();
          }
          const span = kind.ty.span;
          return span;
        };
        let diag: Diag;
        const k = ty.kind();
        switch (k.$) {
          case "Bool":
          case "Char":
          case "Int":
          case "Uint":
          case "Error":
            return Ok(null);
          case "FnPtr":
            diag = tcx.dcx().struct_span_err(span_(), "using function pointers as const generic parameters is forbidden");
            break;
          case "RawPtr":
            diag = tcx.dcx().struct_span_err(span_(), "using raw pointers as const generic parameters is forbidden");
            break;
          default: {
            // Avoid showing "{type error}" to users. See #118179.
            const r = TypeVisitableExt.error_reported(ty, fold_Ty);
            if (r.$ === "Err") return r;

            diag = tcx.dcx().struct_span_err(span_(), `\`${display_Ty(ty)}\` is forbidden as the type of a const generic parameter`);
            break;
          }
        }

        diag.note("the only supported types are integers, `bool`, and `char`");

        const cause = ObligationCause.misc(span_(), def_id);
        const adt_const_params_feature_string = " more complex and user defined types";
        let may_suggest_feature: [string, Symbol][] | undefined;
        const res = type_allowed_to_implement_const_param_ty(tcx, tcx.param_env(param.def_id) as ParamEnv, ty, cause);
        if (res.$ === "Err") {
          switch (res._0.$) {
            // Can never implement `ConstParamTy`, don't suggest anything.
            case "NotAnAdtOrBuiltinAllowed":
            case "NonExhaustive":
            case "InvalidInnerTyOfBuiltinTy":
              may_suggest_feature = undefined;
              break;
            case "UnsizedConstParamsFeatureRequired":
              may_suggest_feature = [
                [adt_const_params_feature_string, sym.min_adt_const_params],
                [" references to implement the `ConstParamTy` trait", sym.unsized_const_params],
              ];
              break;
            // May be able to implement `ConstParamTy`. Only emit the feature help
            // if the type is local, since the user may be able to fix the local type.
            case "InfrigingFields": {
              may_suggest_feature = ty_is_local(ty) ? [[adt_const_params_feature_string, sym.min_adt_const_params]] : undefined;
              break;
            }
          }
        } else {
          // Implements `ConstParamTy`, suggest adding the feature to enable.
          may_suggest_feature = [[adt_const_params_feature_string, sym.min_adt_const_params]];
        }
        if (may_suggest_feature !== undefined) {
          const features = may_suggest_feature;
          tcx.disabled_nightly_features(diag, features);
        }

        return Err(diag.emit_err());
      }
    }
  }
}

// PORT: the fn item nested in `check_param_wf` (wfcheck.rs:874).
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:874 ty_is_local
function ty_is_local(ty: Ty): boolean {
  const k = ty.kind();
  switch (k.$) {
    case "Adt":
      return k._0.did().is_local();
    // Arrays and slices use the inner type's `ConstParamTy`.
    case "Array":
    case "Slice":
      return ty_is_local(k._0);
    // `&` references use the inner type's `ConstParamTy`.
    // `&mut` are not supported.
    case "Ref":
      if (k._2 === "Not") return ty_is_local(k._1);
      return false;
    // Say that a tuple is local if any of its components are local.
    // This is not strictly correct, but it's likely that the user can fix the local component.
    case "Tuple":
      return [...k._0].some((ty) => ty_is_local(ty));
    default:
      return false;
  }
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:910 check_associated_item
export function check_associated_item(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const loc: WellFormedLoc = { $: "Ty", _0: def_id };
  return enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
    const item = tcx.associated_item(def_id) as AssocItemT;

    // Avoid bogus "type annotations needed `Foo: Bar`" errors on `impl Bar for Foo` in case
    // other `Foo` impls are incoherent.
    const trait_item = AssocItem.trait_item_or_self(item);
    if (trait_item.$ === "Err") return trait_item;
    const r = tcx.ensure_result().coherent_trait(tcx.parent(trait_item._0));
    if (r.$ === "Err") return r;

    let self_ty: Ty;
    switch (item.container.$) {
      case "Trait":
        self_ty = tcx.types.self_param;
        break;
      case "InherentImpl":
      case "TraitImpl":
        self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(AssocItem.container_id(item, tcx)) as EarlyBinder<Ty>));
        break;
    }

    const span = tcx.def_span(LocalDefIdC.to_def_id(def_id));

    switch (item.kind.$) {
      case "Const": {
        const ty_ = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
        const ty = wfcx.deeply_normalize(span, { $: "Ty", _0: def_id }, ty_, fold_Ty);
        wfcx.register_wf_obligation(span, loc, ty);

        if (Defaultness.has_value(AssocItem.defaultness(item, tcx))) {
          const code = ObligationCauseCode.SizedConstOrStatic;
          wfcx.register_bound(ObligationCause.new(span, def_id, code), wfcx.param_env, ty, tcx.require_lang_item(LangItem.Sized, span));
        }

        return check_const_item(wfcx, def_id, ty);
      }
      case "Fn": {
        const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
        const hir_sig = unwrap(HirNode.fn_sig(tcx.hir_node_by_def_id(def_id)), "bad signature for method");
        check_fn_or_method(wfcx, sig, hir_sig.decl, def_id);
        return check_method_receiver(wfcx, hir_sig, item, self_ty);
      }
      case "Type": {
        if (item.container.$ === "Trait") {
          check_associated_type_bounds(wfcx, item, span);
        }
        if (Defaultness.has_value(AssocItem.defaultness(item, tcx))) {
          const ty_ = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
          const ty = wfcx.deeply_normalize(span, { $: "Ty", _0: def_id }, ty_, fold_Ty);
          wfcx.register_wf_obligation(span, loc, ty);
        }
        return Ok(null);
      }
    }
  });
}

/// In a type definition, we check that to ensure that the types of the fields are well-formed.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:972 check_type_defn
export function check_type_defn(tcx: TyCtxt, item: LocalDefId, all_sized_: boolean): Result<null, ErrorGuaranteed> {
  tcx.ensure_ok().check_representability(item);
  const adt_def = tcx.adt_def(item) as AdtDef;

  return enter_wf_checking_ctxt(tcx, item, (wfcx) => {
    const variants = adt_def.variants();
    const packed = adt_def.repr().packed();

    for (const variant of variants) {
      // All field types must be well-formed.
      for (const field of variant.fields) {
        const def_id = field.value;
        if (def_id !== undefined && EarlyBinder.no_bound_vars(tcx.type_of(def_id) as EarlyBinder<Ty>, fold_Ty) !== undefined) {
          // FIXME(generic_const_exprs, default_field_values): this is a hack and needs to
          // be refactored to check the instantiate-ability of the code better.
          const local = def_id.as_local();
          let is_bare_const_param = false;
          if (local !== undefined && tcx.def_kind(local).$ === "AnonConst") {
            const node = tcx.hir_node_by_def_id(local);
            if (node.$ === "AnonConst") {
              const anon = node._0;
              const expr = tcx.hir_body(anon.body).value;
              if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined) {
                const path = expr.kind._0._1;
                if (path.res.$ === "Def" && path.res._0.$ === "ConstParam") {
                  is_bare_const_param = true;
                }
              }
            }
          }
          if (is_bare_const_param) {
            // Do not evaluate bare `const` params, as those would ICE and are only
            // usable if `#![feature(generic_const_exprs)]` is enabled.
          } else {
            // Evaluate the constant proactively, to emit an error if the constant has
            // an unconditional error. We only do so if the const has no type params.
            const_eval_poly(tcx, def_id);
          }
        }
        const field_id = field.did.expect_local();
        const span = tcx.ty_span(field_id);
        const ty = wfcx.deeply_normalize(
          span,
          WellFormedLoc_None,
          EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>),
          fold_Ty,
        );
        wfcx.register_wf_obligation(span, { $: "Ty", _0: field_id }, ty);

        const tk = ty.kind();
        if (tk.$ === "Adt" && tk._0.repr().is_scalable() && !(adt_def.repr().scalable?.$ === "Container")) {
          // Scalable vectors can only be fields of structs if the type has a
          // `rustc_scalable_vector` attribute w/out specifying an element count
          tcx.dcx().span_err(span, `scalable vectors cannot be fields of a ${adt_def.variant_descr()}`);
        }
      }

      // For DST, or when drop needs to copy things around, all
      // intermediate types must be sized.
      const needs_drop_copy = (): boolean => {
        if (!packed) return false;
        let ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(variant.tail().did) as EarlyBinder<Ty>));
        ty = tcx.erase_and_anonymize_regions(ty, fold_Ty);
        assert(!TypeVisitableExt.has_infer(ty, fold_Ty), "assertion failed: !ty.has_infer()");
        return ty.needs_drop(tcx, wfcx.infcx.typing_env(wfcx.param_env));
      };
      // All fields (except for possibly the last) should be sized.
      const all_sized = all_sized_ || variant.fields.length === 0 || needs_drop_copy();
      const unsized_len = all_sized ? 0 : 1;
      const sized_fields = variant.fields.slice(0, variant.fields.length - unsized_len);
      for (let idx = 0; idx < sized_fields.length; idx++) {
        const field = sized_fields[idx]!;
        const last = idx === variant.fields.length - 1;
        const span = tcx.ty_span(field.did.expect_local());
        const ty = wfcx.normalize(span, WellFormedLoc_None, EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>), fold_Ty);
        wfcx.register_bound(
          ObligationCause.new(span, wfcx.body_def_id, {
            $: "FieldSized",
            adt_kind: adt_def.adt_kind(),
            span,
            last,
          }),
          wfcx.param_env,
          ty,
          tcx.require_lang_item(LangItem.Sized, span),
        );
      }

      // Explicit `enum` discriminant values must const-evaluate successfully.
      if (variant.discr.$ === "Explicit") {
        const discr_def_id = variant.discr._0;
        const r = const_eval_poly(tcx, discr_def_id);
        if (r.$ === "Ok") {
          // ok
        } else if (r._0.$ === "Reported") {
          // reported
        } else {
          const sp = r._0._0;
          span_bug(sp, "enum variant discr was too generic to eval");
        }
      }
    }

    check_where_clauses(wfcx, item);
    return Ok(null);
  });
}

// #[instrument(skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1088 check_trait
export function check_trait(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  if (tcx.is_lang_item(LocalDefIdC.to_def_id(def_id), LangItem.PointeeSized)) {
    // `PointeeSized` is removed during lowering.
    return Ok(null);
  }

  const trait_def = tcx.trait_def(def_id) as TraitDef;
  if (trait_def.is_marker || trait_def.specialization_kind === "Marker") {
    for (const associated_def_id of tcx.associated_item_def_ids(def_id) as readonly DefId[]) {
      struct_span_code_err(tcx.dcx(), tcx.def_span(associated_def_id), E0714, "marker traits cannot have associated items").emit();
    }
  }

  const res = enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
    check_where_clauses(wfcx, def_id);
    return Ok(null);
  });

  return res;
}

/// Checks all associated type defaults of trait `trait_def_id`.
///
/// Assuming the defaults are used, check that all predicates (bounds on the
/// assoc type and where clauses on the trait) hold.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1121 check_associated_type_bounds
function check_associated_type_bounds(wfcx: WfCheckingCtxt, item: AssocItemT, _span: Span): void {
  const bounds = wfcx.tcx().explicit_item_bounds(item.def_id) as EarlyBinder<readonly [Clause, Span][]>;

  // debug!("check_associated_type_bounds: bounds={:?}", bounds);
  const wf_obligations = [...EarlyBinder.iter_identity_copied(bounds)]
    .map(Unnormalized.skip_norm_wip)
    .flatMap(([bound, bound_span]) => wf_clause_obligations(wfcx.infcx, wfcx.param_env, wfcx.body_def_id, bound, bound_span));

  wfcx.register_obligations(wf_obligations);
}

// ---- check-wf-a: helpers and stand-ins for items that are not ported yet (M4) ----------------------------------------

/** `WellFormedLoc::None`. */
const WellFormedLoc_None: WellFormedLoc = { $: "None" };

/** D4 descriptor of `ty::FnSig` (for `liberate_late_bound_regions`). */
const d_FnSig: TypeFoldable<FnSig> = FnSigC as unknown as TypeFoldable<FnSig>;

/** D4 descriptor of `Vec<(Clause, Span)>` (`explicit_item_bounds(..).iter_identity_copied().collect()`). */
const d_Vec_Clause_Span: TypeFoldable<readonly [Clause, Span][]> = fold_Vec(fold_tuple2(fold_Clause, fold_Span));

/** `mir::interpret::ErrorHandled` (rustc_middle mir/interpret/error.rs, M4): the variants this file matches. */
type ErrorHandled = { readonly $: "Reported"; _0: unknown; _1: Span } | { readonly $: "TooGeneric"; _0: Span };

/** PORT: stand-in for `TyCtxt::const_eval_poly` (rustc_middle mir/interpret/queries.rs, M4). */
function const_eval_poly(_tcx: TyCtxt, _def_id: DefId): Result<unknown, ErrorHandled> {
  return unported("rustc_middle::mir::interpret::TyCtxt::const_eval_poly (M4)");
}

// ==== lane check-wf-b: wfcheck.rs:1140..end ====

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1140 check_item_fn
export function check_item_fn(tcx: TyCtxt, def_id: LocalDefId, decl: hir.FnDecl): Result<null, ErrorGuaranteed> {
  return enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
    check_eiis_fn(tcx, def_id);

    const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>));
    check_fn_or_method(wfcx, sig, decl, def_id);
    return Ok(null);
  });
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1154 check_eiis_fn
function check_eiis_fn(tcx: TyCtxt, def_id: LocalDefId): void {
  // does the function have an EiiImpl attribute? that contains the defid of a *macro*
  // that was used to mark the implementation. This is a two step process.
  const i = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "EiiImpl" ? k._0 : undefined));
  if (i !== undefined) {
    const { resolution, span } = i;
    let foreign_item: DefId;
    let name: ReturnType<TyCtxt["item_name"]>;
    switch (resolution.$) {
      case "Macro": {
        const def_id_ = resolution._0;
        // we expect this macro to have the `EiiMacroFor` attribute, that points to a function
        // signature that we'd like to compare the function we're currently checking with
        const foreign_item_ = find_attr(HasAttrs_DefId.get_attrs(def_id_, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0.foreign_item : undefined));
        if (foreign_item_ !== undefined) {
          [foreign_item, name] = [foreign_item_, tcx.item_name(def_id_)];
        } else {
          tcx.dcx().span_delayed_bug(span, "resolved to something that's not an EII");
          return;
        }
        break;
      }
      case "Known": {
        const def_id_ = resolution._0;
        [foreign_item, name] = [def_id_, tcx.item_name(def_id_)];
        break;
      }
      case "Error":
        return;
    }

    compare_eii_function_types(tcx, def_id, foreign_item, name, span);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1179 check_eiis_static
function check_eiis_static(tcx: TyCtxt, def_id: LocalDefId, ty: Ty): void {
  // does the function have an EiiImpl attribute? that contains the defid of a *macro*
  // that was used to mark the implementation. This is a two step process.
  const i = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "EiiImpl" ? k._0 : undefined));
  if (i !== undefined) {
    const { resolution, span } = i;
    let foreign_item: DefId;
    let name: ReturnType<TyCtxt["item_name"]>;
    switch (resolution.$) {
      case "Macro": {
        const def_id_ = resolution._0;
        // we expect this macro to have the `EiiMacroFor` attribute, that points to a function
        // signature that we'd like to compare the function we're currently checking with
        const foreign_item_ = find_attr(HasAttrs_DefId.get_attrs(def_id_, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0.foreign_item : undefined));
        if (foreign_item_ !== undefined) {
          [foreign_item, name] = [foreign_item_, tcx.item_name(def_id_)];
        } else {
          tcx.dcx().span_delayed_bug(span, "resolved to something that's not an EII");
          return;
        }
        break;
      }
      case "Known": {
        const def_id_ = resolution._0;
        [foreign_item, name] = [def_id_, tcx.item_name(def_id_)];
        break;
      }
      case "Error":
        return;
    }

    compare_eii_statics(tcx, def_id, ty, foreign_item, name, span);
  }
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1205 check_static_item
export function check_static_item(tcx: TyCtxt, item_id: LocalDefId, ty: Ty, should_check_for_sync: boolean): Result<null, ErrorGuaranteed> {
  return enter_wf_checking_ctxt(tcx, item_id, (wfcx) => {
    if (should_check_for_sync) {
      check_eiis_static(tcx, item_id, ty);
    }

    const span = tcx.ty_span(item_id);
    const loc: WellFormedLoc = { $: "Ty", _0: item_id };
    const item_ty = wfcx.deeply_normalize(span, loc, Unnormalized.new_wip(ty), fold_Ty);

    const is_foreign_item = tcx.is_foreign_item(item_id);
    const is_structurally_foreign_item = (): boolean => {
      const tail = tcx.struct_tail_raw(
        item_ty,
        ObligationCause.dummy(),
        (ty) => wfcx.deeply_normalize(span, loc, ty, fold_Ty),
        () => {},
      );

      return tail.kind().$ === "Foreign";
    };
    const forbid_unsized = !(is_foreign_item && is_structurally_foreign_item());

    wfcx.register_wf_obligation(span, { $: "Ty", _0: item_id }, TermC.from_Ty(item_ty));
    if (forbid_unsized) {
      const span = tcx.def_span(item_id);
      wfcx.register_bound(
        ObligationCause.new(span, wfcx.body_def_id, ObligationCauseCode.SizedConstOrStatic),
        wfcx.param_env,
        item_ty,
        tcx.require_lang_item(LangItem.Sized, span),
      );
    }

    // Ensure that the end result is `Sync` in a non-thread local `static`.
    const should_check_for_sync_ =
      should_check_for_sync &&
      !is_foreign_item &&
      tcx.static_mutability(LocalDefIdC.to_def_id(item_id)) === "Not" &&
      !tcx.is_thread_local_static(LocalDefIdC.to_def_id(item_id));

    if (should_check_for_sync_) {
      wfcx.register_bound(
        ObligationCause.new(span, wfcx.body_def_id, ObligationCauseCode.SharedStatic),
        wfcx.param_env,
        item_ty,
        tcx.require_lang_item(LangItem.Sync, span),
      );
    }
    return Ok(null);
  });
}

/// Runs checks common to both free consts and associated consts
// #[instrument(level = "debug", skip(wfcx), ret)]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1272 check_const_item
export function check_const_item(wfcx: WfCheckingCtxt, def_id: LocalDefId, item_ty: Ty): Result<null, ErrorGuaranteed> {
  const tcx = wfcx.tcx();
  const span = tcx.def_span(def_id);

  let res: Result<null, ErrorGuaranteed> = Ok(null);

  if (tcx.is_direct_const(LocalDefIdC.to_def_id(def_id))) {
    if (!tcx.features().const_param_ty_unchecked()) {
      wfcx.register_bound(
        ObligationCause.new(span, def_id, { $: "ConstParam", _0: item_ty }),
        wfcx.param_env,
        item_ty,
        tcx.require_lang_item(LangItem.ConstParamTy, span),
      );
    }
    // FIXME(gca_min_const_items): We *might* want to move this check to `type_of`, so we can
    // return `ty::Error` if it references invalid params. However, doing so is hard, because
    // `type_of` doesn't know if it's a direct const - `const_of_item` determines that, and
    // `const_of_item` calls `type_of`.
    if (!tcx.features().generic_const_parameter_types() && TypeVisitableExt.has_param(item_ty, fold_Ty)) {
      res = Err(tcx.dcx().emit_err(diagnostics().ParamInTyOfConstParam_diagnostic({ span, ty: item_ty })));
    }
  }

  const direct_rhs = tcx.const_of_item(def_id) as EarlyBinder<Const> | undefined;
  if (direct_rhs !== undefined) {
    const raw_ct = EarlyBinder.instantiate_identity(direct_rhs);
    const norm_ct = wfcx.deeply_normalize(span, { $: "Ty", _0: def_id }, raw_ct, fold_Const);
    wfcx.register_wf_obligation(span, { $: "Ty", _0: def_id }, TermC.from_Const(norm_ct));

    wfcx.register_obligation(
      Obligation.new(
        tcx,
        ObligationCause.new(span, def_id, { $: "WellFormed", _0: { $: "Ty", _0: def_id } }),
        wfcx.param_env,
        { $: "Clause", _0: { $: "ConstArgHasType", _0: norm_ct, _1: item_ty } },
        as_obligation_upcast(Predicate_upcast_from_PredicateKind),
      ),
    );
  }

  return res;
}

// #[instrument(level = "debug", skip(tcx, impl_))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1321 check_impl
export function check_impl(tcx: TyCtxt, item: hir.Item, impl_: hir.Impl): Result<null, ErrorGuaranteed> {
  return enter_wf_checking_ctxt(tcx, item.owner_id.def_id, (wfcx) => {
    const of_trait = impl_.of_trait;
    if (of_trait !== undefined) {
      const trait_ref_ = EarlyBinder.instantiate_identity(tcx.impl_trait_ref(item.owner_id.def_id));
      // Avoid bogus "type annotations needed `Foo: Bar`" errors on `impl Bar for Foo` in
      // case other `Foo` impls are incoherent.
      const r = tcx.ensure_result().coherent_trait(Unnormalized.skip_normalization(trait_ref_).def_id);
      if (r.$ === "Err") return r;
      const trait_span = of_trait.trait_ref.path.span;
      const trait_ref = wfcx.deeply_normalize(trait_span, { $: "Ty", _0: item.hir_id().expect_owner().def_id }, trait_ref_, d_TraitRef);
      const trait_pred: TraitClause = { trait_ref, polarity: "Positive" };
      const obligations = wf_trait_obligations(wfcx.infcx, wfcx.param_env, wfcx.body_def_id, trait_pred, trait_span, item);
      for (const obligation of obligations) {
        if (obligation.cause.span !== trait_span) {
          // We already have a better span.
          continue;
        }
        // PORT: each Rust obligation owns its `cause`; it is cloned before the span is set, so a cause object shared
        // between obligations in TS is not changed through another one.
        const pred = obligation.predicate.as_trait_clause();
        if (pred !== undefined && TraitClauseC.self_ty(Binder.skip_binder(pred)) === TraitRefC.self_ty(trait_ref)) {
          obligation.cause = clone_ObligationCause(obligation.cause);
          obligation.cause.span = impl_.self_ty.span;
        }
        const pred_ = obligation.predicate.as_projection_clause();
        if (pred_ !== undefined && ProjectionClauseC.self_ty(Binder.skip_binder(pred_)) === TraitRefC.self_ty(trait_ref)) {
          obligation.cause = clone_ObligationCause(obligation.cause);
          obligation.cause.span = impl_.self_ty.span;
        }
      }

      // Ensure that the `[const]` where clauses of the trait hold for the impl.
      if (tcx.is_conditionally_const(LocalDefIdC.to_def_id(item.owner_id.def_id))) {
        for (const [bound] of ConstConditions.instantiate(tcx.const_conditions(trait_ref.def_id) as ConstConditions, tcx, trait_ref.args)) {
          const bound_ = wfcx.normalize(item.span, { $: "Ty", _0: item.hir_id().expect_owner().def_id }, bound, d_PolyTraitRef);
          wfcx.register_obligation(
            Obligation.new(
              tcx,
              ObligationCause.new(impl_.self_ty.span, wfcx.body_def_id, {
                $: "WellFormed",
                _0: { $: "HirId", _0: of_trait.trait_ref.hir_ref_id },
              }),
              wfcx.param_env,
              PolyTraitRefC.to_host_effect_clause(bound_, tcx, "Maybe"),
              as_obligation_upcast(Predicate_upcast_from_Clause),
            ),
          );
        }
      }

      // debug!(?obligations);
      wfcx.register_obligations(obligations);
    } else {
      const self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item.owner_id.def_id) as EarlyBinder<Ty>));
      const self_ty_ = wfcx.deeply_normalize(item.span, { $: "Ty", _0: item.hir_id().expect_owner().def_id }, Unnormalized.new_wip(self_ty), fold_Ty);
      wfcx.register_wf_obligation(impl_.self_ty.span, { $: "Ty", _0: item.hir_id().expect_owner().def_id }, TermC.from_Ty(self_ty_));
    }

    check_where_clauses(wfcx, item.owner_id.def_id);
    return Ok(null);
  });
}

/// Checks where-clauses and inline bounds that are declared on `def_id`.
// #[instrument(level = "debug", skip(wfcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1416 check_where_clauses
export function check_where_clauses(wfcx: WfCheckingCtxt, def_id: LocalDefId): void {
  const infcx = wfcx.infcx;
  const tcx = wfcx.tcx();

  const gen_clauses = tcx.clauses_of(LocalDefIdC.to_def_id(def_id)) as GenericClauses;
  const generics = tcx.generics_of(def_id) as Generics;

  // Check that concrete defaults are well-formed. See test `type-check-defaults.rs`.
  // For example, this forbids the declaration:
  //
  //     struct Foo<T = Vec<[u32]>> { .. }
  //
  // Here, the default `Vec<[u32]>` is not WF because `[u32]: Sized` does not hold.
  for (const param of generics.own_params) {
    const default_eb = GenericParamDefC.default_value(param, tcx);
    const default_ = default_eb === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(default_eb));
    if (default_ !== undefined) {
      // Ignore dependent defaults -- that is, where the default of one type
      // parameter includes another (e.g., `<T, U = T>`). In those cases, we can't
      // be sure if it will error or not as user might always specify the other.
      // FIXME(generic_const_exprs): This is incorrect when dealing with unused const params.
      // E.g: `struct Foo<const N: usize, const M: usize = { 1 - 2 }>;`. Here, we should
      // eagerly error but we don't as we have `ConstKind::Alias(.., [N, M])`.
      if (!TypeVisitableExt.has_param(default_, fold_GenericArg)) {
        wfcx.register_wf_obligation(
          tcx.def_span(param.def_id),
          param.kind.$ === "Type" ? { $: "Ty", _0: param.def_id.expect_local() } : WellFormedLocC.None,
          unwrap(GenericArg.as_term(default_)),
        );
      } else {
        // If we've got a generic const parameter we still want to check its
        // type is correct in case both it and the param type are fully concrete.
        const k = GenericArg.kind(default_);
        if (k.$ !== "Const") {
          continue;
        }
        const ct = k._0;

        let ct_ty: Ty;
        const ck = ct.kind();
        switch (ck.$) {
          case "Infer":
          case "Placeholder":
          case "Bound":
            return unreachable();
          case "Error":
          case "Expr":
            continue;
          case "Value":
            ct_ty = ck._0.ty;
            break;
          case "Alias": {
            const alias_const = ck._1;
            ct_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(alias_const, infcx.tcx));
            break;
          }
          case "Param": {
            const param_ct = ck._0;
            ct_ty = ParamConst.find_const_ty_from_env(param_ct, wfcx.param_env);
            break;
          }
        }

        const param_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param.def_id) as EarlyBinder<Ty>));
        if (!TypeVisitableExt.has_param(ct_ty, fold_Ty) && !TypeVisitableExt.has_param(param_ty, fold_Ty)) {
          const cause = ObligationCause.new(tcx.def_span(param.def_id), wfcx.body_def_id, { $: "WellFormed", _0: { $: "Ty", _0: def_id } });
          wfcx.register_obligation(
            Obligation.new(tcx, cause, wfcx.param_env, { $: "ConstArgHasType", _0: ct, _1: param_ty }, as_obligation_upcast(Predicate_upcast_from_ClauseKind)),
          );
        }
      }
    }
  }

  // Check that trait clauses are WF when params are instantiated with their defaults.
  // We don't want to overly constrain the clauses that may be written but we want to
  // catch cases where a default my never be applied such as `struct Foo<T: Copy = String>`.
  // Therefore we check if a clause which contains a single type param
  // with a concrete default is WF with that default instantiated.
  // For more examples see tests `defaults-well-formedness.rs` and `type-check-defaults.rs`.
  //
  // First we build the defaulted generic parameters.
  const args = RawList.for_item(tcx, LocalDefIdC.to_def_id(def_id), (param, _) => {
    if (param.index >= generics.parent_count) {
      // If the param has a default, ...
      const default_eb = GenericParamDefC.default_value(param, tcx);
      const default_ = default_eb === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(default_eb));
      // ... and it's not a dependent default, ...
      if (default_ !== undefined && !TypeVisitableExt.has_param(default_, fold_GenericArg)) {
        // ... then instantiate it with the default.
        return default_;
      }
    }
    return tcx.mk_param_from_def(param);
  });

  // Now we build the instantiated clauses.
  // PORT: the `flat_map(..).map(..)` chain is lazy: it runs when `obligations` is collected below, after
  // `assoc_const_obligations` and the WF obligations; a generator keeps that order.
  function* default_obligations(): Generator<PredicateObligation> {
    for (const [clause, sp] of gen_clauses.clauses) {
      // #[derive(Default)]
      // struct CountParams { params: FxHashSet<u32> }
      class CountParams implements TypeVisitor<ControlFlow<null>> {
        readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

        constructor(public params: Set<number> = new Set()) {}

        visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
          return TypeVisitor_provided.visit_binder(this, t, d);
        }

        // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1520 visit_ty
        visit_ty(t: Ty): ControlFlow<null> {
          const k = t.kind();
          if (k.$ === "Param") {
            const param = k._0;
            this.params.add(param.index);
          }
          return fold_Ty.super_visit_with(t, this);
        }

        // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1527 visit_region
        visit_region(_: Region): ControlFlow<null> {
          return ControlFlowC.Break(null);
        }

        // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1531 visit_const
        visit_const(c: Const): ControlFlow<null> {
          const k = c.kind();
          if (k.$ === "Param") {
            const param = k._0;
            this.params.add(param.index);
          }
          return fold_Const.super_visit_with(c, this);
        }

        visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
          return TypeVisitor_provided.visit_predicate(this, p, d);
        }

        visit_clauses(c: Parameters<TypeVisitor<ControlFlow<null>>["visit_clauses"]>[0]): ControlFlow<null> {
          return TypeVisitor_provided.visit_clauses(this, c);
        }

        visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
          return TypeVisitor_provided.visit_error(this, guar);
        }
      }
      const param_count = new CountParams();
      const has_region = fold_Clause.visit_with(clause, param_count).$ === "Break";
      const instantiated_clause = EarlyBinder.instantiate(EarlyBinder.bind(tcx, clause, fold_Clause), tcx, args, fold_Clause);
      // Don't check non-defaulted params, dependent defaults (including lifetimes)
      // or clauses with multiple params.
      let item: [Unnormalized<Clause>, Span] | undefined;
      if (TypeVisitableExt.has_non_region_param(Unnormalized.skip_normalization(instantiated_clause), fold_Clause) || param_count.params.size > 1 || has_region) {
        item = undefined;
      } else if (gen_clauses.clauses.some(([p, _]) => p === Unnormalized.skip_normalization(instantiated_clause))) {
        // Avoid duplication of clauses that contain no parameters, for example.
        item = undefined;
      } else {
        item = [instantiated_clause, sp];
      }
      if (item === undefined) continue;

      const [clause_, sp_] = item;
      // Convert each of those into an obligation. So if you have
      // something like `struct Foo<T: Copy = String>`, we would
      // take that clause `T: Copy`, instantiated with `String: Copy`
      // (actually that happens in the previous `flat_map` call),
      // and then try to prove it (in this case, we'll fail).
      //
      // Note the subtle difference from how we handle `gen_clauses`
      // below: there, we are not trying to prove those clauses
      // to be *true* but merely *well-formed*.
      const clause__ = wfcx.normalize(sp_, WellFormedLocC.None, clause_, fold_Clause);
      const cause = ObligationCause.new(sp_, wfcx.body_def_id, { $: "WhereClause", _0: LocalDefIdC.to_def_id(def_id), _1: sp_ });
      yield Obligation.new(tcx, cause, wfcx.param_env, clause__, as_obligation_upcast(Predicate_upcast_from_Clause));
    }
  }

  // PORT: `let gen_clauses = gen_clauses.instantiate_identity(tcx);` shadows the binding; the generator above keeps
  // the `GenericClauses` it captured, so this one is `gen_clauses_`.
  const gen_clauses_ = GenericClausesC.instantiate_identity(gen_clauses, tcx);

  const assoc_const_obligations: PredicateObligation[] = [];
  for (let i = 0; i < Math.min(gen_clauses_.clauses.length, gen_clauses_.spans.length); i++) {
    const clause_u = gen_clauses_.clauses[i]!;
    const sp = gen_clauses_.spans[i]!;
    const clause = Unnormalized.skip_norm_wip(clause_u);
    const proj = clause.as_projection_clause();
    if (proj === undefined) continue;
    const pred_binder = Binder.transpose(
      Binder.map_bound(proj, (pred) => {
        const ct = TermC.as_const(pred.term);
        if (ct === undefined) return undefined;
        const assoc_const_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(AliasTerm.expect_ct(pred.projection_term), tcx));
        return { $: "ConstArgHasType", _0: ct, _1: assoc_const_ty } as ClauseKind;
      }),
    );
    if (pred_binder !== undefined) {
      const cause = ObligationCause.new(sp, wfcx.body_def_id, { $: "WhereClause", _0: LocalDefIdC.to_def_id(def_id), _1: sp });
      assoc_const_obligations.push(Obligation.new(tcx, cause, wfcx.param_env, pred_binder, as_obligation_upcast(Predicate_upcast_from_Binder_ClauseKind)));
    }
  }

  assert_eq(gen_clauses_.clauses.length, gen_clauses_.spans.length, (n) => `${n}`);
  function* wf_obligations(): Generator<PredicateObligation> {
    for (let i = 0; i < Math.min(gen_clauses_.clauses.length, gen_clauses_.spans.length); i++) {
      const p = gen_clauses_.clauses[i]!;
      const sp = gen_clauses_.spans[i]!;
      yield* wf_clause_obligations(infcx, wfcx.param_env, wfcx.body_def_id, Unnormalized.skip_norm_wip(p), sp);
    }
  }
  const obligations: PredicateObligation[] = [...wf_obligations(), ...default_obligations(), ...assoc_const_obligations];
  wfcx.register_obligations(obligations);
}

// #[instrument(level = "debug", skip(wfcx, hir_decl))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1624 check_fn_or_method
export function check_fn_or_method(wfcx: WfCheckingCtxt, sig_: PolyFnSig, hir_decl: hir.FnDecl, def_id: LocalDefId): void {
  const tcx = wfcx.tcx();
  let sig = tcx.liberate_late_bound_regions(LocalDefIdC.to_def_id(def_id), sig_, fold_FnSig);

  // Normalize the input and output types one at a time, using a different
  // `WellFormedLoc` for each. We cannot call `normalize_associated_types`
  // on the entire `FnSig`, since this would use the same `WellFormedLoc`
  // for each type, preventing the HIR wf check from generating
  // a nice error message.
  const arg_span = (idx: number): Span => {
    const arg = hir_decl.inputs[idx];
    // PORT: `map_or` evaluates its default eagerly; `FnRetTy::span` is pure.
    const default_ = FnRetTy.span(hir_decl.output);
    return arg === undefined ? default_ : arg.span;
  };

  sig = {
    ...sig,
    inputs_and_output: tcx.mk_type_list_from_iter(
      [...sig.inputs_and_output].map((ty, idx) =>
        wfcx.deeply_normalize(
          arg_span(idx),
          {
            $: "Param",
            function: def_id,
            // Note that the `param_idx` of the output type is
            // one greater than the index of the last input type.
            param_idx: idx,
          },
          Unnormalized.new_wip(ty),
          fold_Ty,
        ),
      ),
    ),
  };

  [...sig.inputs_and_output].forEach((ty, idx) => {
    wfcx.register_wf_obligation(arg_span(idx), { $: "Param", function: def_id, param_idx: idx }, TermC.from_Ty(ty));
  });

  check_where_clauses(wfcx, def_id);

  if (FnSigC.abi(sig).$ === ExternAbi.RustCall.$) {
    const span = tcx.def_span(def_id);
    const has_implicit_self = ImplicitSelfKind.has_implicit_self(hir_decl.implicit_self());
    const inputs_all = FnSigC.inputs(sig);
    let pos = has_implicit_self ? 1 : 0;
    const next = (): Ty | undefined => (pos < inputs_all.length ? inputs_all[pos++] : undefined);
    // Check that the argument is a tuple and is sized
    const ty = next();
    if (ty !== undefined) {
      wfcx.register_bound(
        ObligationCause.new(span, wfcx.body_def_id, ObligationCauseCode.RustCall),
        wfcx.param_env,
        ty,
        tcx.require_lang_item(LangItem.Tuple, span),
      );
      wfcx.register_bound(
        ObligationCause.new(span, wfcx.body_def_id, ObligationCauseCode.RustCall),
        wfcx.param_env,
        ty,
        tcx.require_lang_item(LangItem.Sized, span),
      );
    } else {
      const last = hir_decl.inputs[hir_decl.inputs.length - 1];
      tcx.dcx().span_err(last === undefined ? span : last.span, 'functions with the "rust-call" ABI must take a single non-self tuple argument');
    }
    // No more inputs other than the `self` type and the tuple type
    if (next() !== undefined) {
      const last = hir_decl.inputs[hir_decl.inputs.length - 1];
      tcx.dcx().span_err(last === undefined ? span : last.span, 'functions with the "rust-call" ABI must take a single non-self tuple argument');
    }
  }

  // If the function has a body, additionally require that the return type is sized.
  const body = tcx.hir_maybe_body_owned_by(def_id);
  if (body !== undefined) {
    let span: Span;
    switch (hir_decl.output.$) {
      case "Return":
        span = hir_decl.output._0.span;
        break;
      case "DefaultReturn":
        span = body.value.span;
        break;
    }

    wfcx.register_bound(
      ObligationCause.new(span, def_id, ObligationCauseCode.SizedReturnType),
      wfcx.param_env,
      FnSigC.output(sig),
      tcx.require_lang_item(LangItem.Sized, span),
    );
  }
}

/// The `arbitrary_self_types_pointers` feature implies `arbitrary_self_types`.
// #[derive(Clone, Copy, PartialEq)]
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1716 ArbitrarySelfTypesLevel
type ArbitrarySelfTypesLevel =
  | "Basic" // just arbitrary_self_types
  | "WithPointers"; // both arbitrary_self_types and arbitrary_self_types_pointers
const ArbitrarySelfTypesLevel = { Basic: "Basic", WithPointers: "WithPointers" } as const;

// #[instrument(level = "debug", skip(wfcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1722 check_method_receiver
export function check_method_receiver(wfcx: WfCheckingCtxt, fn_sig: hir.FnSig, method: AssocItem, self_ty_: Ty): Result<null, ErrorGuaranteed> {
  const tcx = wfcx.tcx();

  if (!AssocItem.is_method(method)) {
    return Ok(null);
  }

  const span = fn_sig.decl.inputs[0]!.span;
  const loc: WellFormedLoc = { $: "Param", function: method.def_id.expect_local(), param_idx: 0 };

  const sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(method.def_id) as EarlyBinder<PolyFnSig>));
  const sig__ = tcx.liberate_late_bound_regions(method.def_id, sig_, fold_FnSig);
  const sig = wfcx.normalize(DUMMY_SP, loc, Unnormalized.new_wip(sig__), fold_FnSig);

  // debug!("check_method_receiver: sig={:?}", sig);

  const self_ty = wfcx.normalize(DUMMY_SP, loc, Unnormalized.new_wip(self_ty_), fold_Ty);

  const receiver_ty_ = FnSigC.inputs(sig)[0]!;
  const receiver_ty = wfcx.normalize(DUMMY_SP, loc, Unnormalized.new_wip(receiver_ty_), fold_Ty);

  // If the receiver already has errors reported, consider it valid to avoid
  // unnecessary errors (#58712).
  const r = TypeVisitableExt.error_reported(receiver_ty, fold_Ty);
  if (r.$ === "Err") return r;

  let arbitrary_self_types_level: ArbitrarySelfTypesLevel | undefined;
  if (tcx.features().arbitrary_self_types_pointers()) {
    arbitrary_self_types_level = ArbitrarySelfTypesLevel.WithPointers;
  } else if (tcx.features().arbitrary_self_types()) {
    arbitrary_self_types_level = ArbitrarySelfTypesLevel.Basic;
  } else {
    arbitrary_self_types_level = undefined;
  }
  const generics = tcx.generics_of(method.def_id) as Generics;

  const receiver_validity = receiver_is_valid(wfcx, span, receiver_ty, self_ty, arbitrary_self_types_level, generics);
  if (receiver_validity.$ === "Err") {
    const receiver_validity_err = receiver_validity._0;
    let guar: ErrorGuaranteed;
    // Wherever possible, emit a message advising folks that the features
    // `arbitrary_self_types` or `arbitrary_self_types_pointers` might
    // have helped.
    if (arbitrary_self_types_level === undefined && receiver_is_valid(wfcx, span, receiver_ty, self_ty, ArbitrarySelfTypesLevel.Basic, generics).$ === "Ok") {
      // Report error; would have worked with `arbitrary_self_types`.
      guar = feature_err(
        tcx.sess,
        sym.arbitrary_self_types,
        span,
        `\`${display_Ty(receiver_ty)}\` cannot be used as the type of \`self\` without ` + "the `arbitrary_self_types` feature",
      )
        .with_help(
          msg(
            "consider changing to `self`, `&self`, `&mut self`, or a type implementing `Receiver` such as `self: Box<Self>`, `self: Rc<Self>`, or `self: Arc<Self>`",
          ),
        )
        .emit_err();
    } else if (
      (arbitrary_self_types_level === undefined || arbitrary_self_types_level === ArbitrarySelfTypesLevel.Basic) &&
      receiver_is_valid(wfcx, span, receiver_ty, self_ty, ArbitrarySelfTypesLevel.WithPointers, generics).$ === "Ok"
    ) {
      // Report error; would have worked with `arbitrary_self_types_pointers`.
      guar = feature_err(
        tcx.sess,
        sym.arbitrary_self_types_pointers,
        span,
        `\`${display_Ty(receiver_ty)}\` cannot be used as the type of \`self\` without ` + "the `arbitrary_self_types_pointers` feature",
      )
        .with_help(
          msg(
            "consider changing to `self`, `&self`, `&mut self`, or a type implementing `Receiver` such as `self: Box<Self>`, `self: Rc<Self>`, or `self: Arc<Self>`",
          ),
        )
        .emit_err();
    } else {
      // Report error; would not have worked with `arbitrary_self_types[_pointers]`.
      if (receiver_validity_err === "DoesNotDeref" && arbitrary_self_types_level !== undefined) {
        const adt_def = (receiver_ty.builtin_deref(false) ?? receiver_ty).ty_adt_def();

        let hint: diagnostics_t.InvalidReceiverTyHint | undefined;
        if (adt_def !== undefined) {
          const adt = adt_def;
          if (tcx.is_lang_item(adt.did(), LangItem.NonNull)) {
            hint = "NonNull";
          } else {
            const name = tcx.get_diagnostic_name(adt.did());
            if (name === sym.RcWeak || name === sym.ArcWeak) {
              hint = "Weak";
            } else {
              hint = undefined;
            }
          }
        } else {
          hint = undefined;
        }

        guar = tcx.dcx().emit_err(diagnostics().InvalidReceiverTy_diagnostic({ span, receiver_ty, hint }));
      } else if (receiver_validity_err === "DoesNotDeref") {
        guar = tcx.dcx().emit_err(diagnostics().InvalidReceiverTyNoArbitrarySelfTypes_diagnostic({ span, receiver_ty }));
      } else {
        guar = tcx.dcx().emit_err(diagnostics().InvalidGenericReceiverTy_diagnostic({ span, receiver_ty }));
      }
    }
    return Err(guar);
  }
  return Ok(null);
}

/// Error cases which may be returned from `receiver_is_valid`. These error
/// cases are generated in this function as they may be unearthed as we explore
/// the `autoderef` chain, but they're converted to diagnostics in the caller.
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1864 ReceiverValidityError
type ReceiverValidityError =
  /// The self type does not get to the receiver type by following the
  /// autoderef chain.
  | "DoesNotDeref"
  /// A type was found which is a method type parameter, and that's not allowed.
  | "MethodGenericParamUsed";

/// Confirms that a type is not a type parameter referring to one of the
/// method's type params.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1874 confirm_type_is_not_a_method_generic_param
function confirm_type_is_not_a_method_generic_param(ty: Ty, method_generics: Generics): Result<null, ReceiverValidityError> {
  const k = ty.kind();
  if (k.$ === "Param") {
    const param = k._0;
    if (param.index >= method_generics.parent_count) {
      return Err("MethodGenericParamUsed");
    }
  }
  return Ok(null);
}

/// Returns whether `receiver_ty` would be considered a valid receiver type for `self_ty`. If
/// `arbitrary_self_types` is enabled, `receiver_ty` must transitively deref to `self_ty`, possibly
/// through a `*const/mut T` raw pointer if  `arbitrary_self_types_pointers` is also enabled.
/// If neither feature is enabled, the requirements are more strict: `receiver_ty` must implement
/// `Receiver` and directly implement `Deref<Target = self_ty>`.
///
/// N.B., there are cases this function returns `true` but causes an error to be emitted,
/// particularly when `receiver_ty` derefs to a type that is the same as `self_ty` but has the
/// wrong lifetime. Be careful of this if you are calling this function speculatively.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1895 receiver_is_valid
function receiver_is_valid(
  wfcx: WfCheckingCtxt,
  span: Span,
  receiver_ty: Ty,
  self_ty: Ty,
  arbitrary_self_types_enabled: ArbitrarySelfTypesLevel | undefined,
  method_generics: Generics,
): Result<null, ReceiverValidityError> {
  const infcx = wfcx.infcx;
  const tcx = wfcx.tcx();
  const cause = ObligationCause.new(span, wfcx.body_def_id, ObligationCauseCode.MethodReceiver);

  // Special case `receiver == self_ty`, which doesn't necessarily require the `Receiver` lang item.
  if (
    wfcx.infcx.commit_if_ok<null, unknown>((_) => {
      const ocx = ObligationCtxt.new(wfcx.infcx);
      const r = ocx.eq(cause, wfcx.param_env, self_ty, receiver_ty, ToTrace_Ty);
      if (r.$ === "Err") return r;
      if (TraitErrorsC.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
        return Ok(null);
      } else {
        return Err(solve.NO_SOLUTION);
      }
    }).$ === "Ok"
  ) {
    return Ok(null);
  }

  const r = confirm_type_is_not_a_method_generic_param(receiver_ty, method_generics);
  if (r.$ === "Err") return r;

  let autoderef = Autoderef_new(infcx, wfcx.param_env, wfcx.body_def_id, span, receiver_ty);

  // The `arbitrary_self_types` feature allows custom smart pointer
  // types to be method receivers, as identified by following the Receiver<Target=T>
  // chain.
  if (arbitrary_self_types_enabled !== undefined) {
    autoderef = autoderef.use_receiver_trait();
  }

  // The `arbitrary_self_types_pointers` feature allows raw pointer receivers like `self: *const Self`.
  if (arbitrary_self_types_enabled === ArbitrarySelfTypesLevel.WithPointers) {
    autoderef = autoderef.include_raw_pointers();
  }

  // Keep dereferencing `receiver_ty` until we get to `self_ty`.
  for (;;) {
    const step = autoderef.next();
    if (step === undefined) break;
    const [potential_self_ty] = step;
    // debug!(
    //     "receiver_is_valid: potential self type `{:?}` to match `{:?}`",
    //     potential_self_ty, self_ty
    // );

    const r = confirm_type_is_not_a_method_generic_param(potential_self_ty, method_generics);
    if (r.$ === "Err") return r;

    // Check if the self type unifies. If it does, then commit the result
    // since it may have region side-effects.
    if (
      wfcx.infcx.commit_if_ok<null, unknown>((_) => {
        const ocx = ObligationCtxt.new(wfcx.infcx);
        const r = ocx.eq(cause, wfcx.param_env, self_ty, potential_self_ty, ToTrace_Ty);
        if (r.$ === "Err") return r;
        if (TraitErrorsC.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
          return Ok(null);
        } else {
          return Err(solve.NO_SOLUTION);
        }
      }).$ === "Ok"
    ) {
      wfcx.register_obligations(autoderef.into_obligations());
      return Ok(null);
    }

    // Without `feature(arbitrary_self_types)`, we require that each step in the
    // deref chain implement `LegacyReceiver`.
    if (arbitrary_self_types_enabled === undefined) {
      const legacy_receiver_trait_def_id = tcx.require_lang_item(LangItem.LegacyReceiver, span);
      if (!legacy_receiver_is_implemented(wfcx, legacy_receiver_trait_def_id, clone_ObligationCause(cause), potential_self_ty)) {
        // We cannot proceed.
        break;
      }

      // Register the bound, in case it has any region side-effects.
      wfcx.register_bound(clone_ObligationCause(cause), wfcx.param_env, potential_self_ty, legacy_receiver_trait_def_id);
    }
  }

  // debug!("receiver_is_valid: type `{:?}` does not deref to `{:?}`", receiver_ty, self_ty);
  return Err("DoesNotDeref");
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1990 legacy_receiver_is_implemented
function legacy_receiver_is_implemented(wfcx: WfCheckingCtxt, legacy_receiver_trait_def_id: DefId, cause: ObligationCause, receiver_ty: Ty): boolean {
  const tcx = wfcx.tcx();
  const trait_ref = TraitRefC.new(as_interner(tcx), legacy_receiver_trait_def_id, [GenericArg.from_Ty(receiver_ty)]);

  const obligation = Obligation.new(tcx, cause, wfcx.param_env, trait_ref, as_obligation_upcast(Predicate_upcast_from_TraitRef));

  if (wfcx.infcx.predicate_must_hold_modulo_regions(obligation)) {
    return true;
  } else {
    // debug!(
    //     "receiver_is_implemented: type `{:?}` does not implement `LegacyReceiver` trait",
    //     receiver_ty
    // );
    return false;
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2012 check_variances_for_type_defn
export function check_variances_for_type_defn(tcx: TyCtxt, def_id: LocalDefId): void {
  const kind = tcx.def_kind(def_id);
  switch (kind.$) {
    case "Enum":
    case "Struct":
    case "Union":
      // Ok
      break;
    default:
      return span_bug(tcx.def_span(def_id), `cannot compute the variances of ${format_debug(kind, debug_DefKind, PLAIN)}`);
  }

  const ty_clauses = tcx.clauses_of(LocalDefIdC.to_def_id(def_id)) as GenericClauses;
  assert_eq(ty_clauses.parent, undefined, (v) => format_debug(v, (x, f) => debug_option(x, f, debug_DefId), PLAIN));
  const variances = tcx.variances_of(def_id) as readonly Variance[];

  const constrained_parameters = new Set<Parameter>();
  variances.forEach((variance, index) => {
    if (variance !== "Bivariant") constrained_parameters.add(index as Parameter);
  });

  cgp().identify_constrained_generic_params(tcx, ty_clauses, undefined, constrained_parameters);

  // Lazily calculated because it is only needed in case of an error.
  let explicitly_bounded_params_cell: Set<Parameter> | undefined;
  const explicitly_bounded_params = (): Set<Parameter> => {
    if (explicitly_bounded_params_cell === undefined) {
      const icx = collect().ItemCtxt.new(tcx, def_id) as ItemCtxt;
      const out = new Set<Parameter>();
      for (const predicate of unwrap(HirNode.generics(tcx.hir_node_by_def_id(def_id))).predicates) {
        const kind = predicate.kind;
        if (kind.$ === "BoundPredicate") {
          const k = icx.lower_ty(kind._0.bounded_ty).kind();
          if (k.$ === "Param") {
            out.add(k._0.index as Parameter);
          }
        }
      }
      explicitly_bounded_params_cell = out;
    }
    return explicitly_bounded_params_cell;
  };

  for (let index = 0; index < variances.length; index++) {
    const parameter = index as Parameter;

    if (constrained_parameters.has(parameter)) {
      continue;
    }

    const node = tcx.hir_node_by_def_id(def_id);
    const item = HirNode.expect_item(node);
    const hir_generics = unwrap(HirNode.generics(node));
    const hir_param = hir_generics.params[index]!;

    const ty_param = (tcx.generics_of(item.owner_id.def_id) as Generics).own_params[index]!;

    if (!DefId_eq(ty_param.def_id, LocalDefIdC.to_def_id(hir_param.def_id))) {
      // Valid programs always have lifetimes before types in the generic parameter list.
      // ty_generics are normalized to be in this required order, and variances are built
      // from ty generics, not from hir generics. but we need hir generics to get
      // a span out.
      //
      // If they aren't in the same order, then the user has written invalid code, and already
      // got an error about it (or I'm wrong about this).
      tcx.dcx().span_delayed_bug(hir_param.span, "hir generics and ty generics in different order");
      continue;
    }

    // Look for `ErrorGuaranteed` deeply within this type.
    if (fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)), new HasErrorDeep(tcx, new DefIdSet())).$ === "Break") {
      continue;
    }

    switch (hir_param.name.$) {
      case "Error":
        // Don't report a bivariance error for a lifetime that isn't
        // even valid to name.
        break;
      default: {
        const has_explicit_bounds = explicitly_bounded_params().has(parameter);
        report_bivariance(tcx, hir_param, has_explicit_bounds, item);
        break;
      }
    }
  }
}

/// Look for `ErrorGuaranteed` deeply within structs' (unsubstituted) fields.
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2106 HasErrorDeep
class HasErrorDeep implements TypeVisitor<ControlFlow<ErrorGuaranteed>> {
  readonly Result: VisitorResult<ControlFlow<ErrorGuaranteed>, unknown> = VisitorResultC.ControlFlow<ErrorGuaranteed>();

  constructor(
    public tcx: TyCtxt,
    public seen: DefIdSet,
  ) {}

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2113 visit_ty
  visit_ty(ty: Ty): ControlFlow<ErrorGuaranteed> {
    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const def = k._0 as AdtDef;
        if (set_insert(this.seen, def.did())) {
          for (const field of def.all_fields()) {
            const r = fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(field.did) as EarlyBinder<Ty>)), this);
            if (r.$ === "Break") return r;
          }
        }
        break;
      }
      case "Error": {
        const guar = k._0;
        return ControlFlowC.Break(guar);
      }
      default:
        break;
    }
    return fold_Ty.super_visit_with(ty, this);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2132 visit_region
  visit_region(r: Region): ControlFlow<ErrorGuaranteed> {
    const e = TypeVisitableExt.error_reported(r, fold_Region);
    if (e.$ === "Err") {
      return ControlFlowC.Break(e._0);
    } else {
      return ControlFlowC.Continue(null);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2140 visit_const
  visit_const(c: Const): ControlFlow<ErrorGuaranteed> {
    const e = TypeVisitableExt.error_reported(c, fold_Const);
    if (e.$ === "Err") {
      return ControlFlowC.Break(e._0);
    } else {
      return ControlFlowC.Continue(null);
    }
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Parameters<TypeVisitor<ControlFlow<ErrorGuaranteed>>["visit_clauses"]>[0]): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2149 report_bivariance
function report_bivariance(tcx: TyCtxt, param: hir.GenericParam, has_explicit_bounds: boolean, item: hir.Item): ErrorGuaranteed {
  const param_name = ParamName.ident(param.name);

  let help: diagnostics_t.UnusedGenericParameterHelp;
  switch (item.kind.$) {
    case "Enum":
    case "Struct":
    case "Union": {
      const def_id = tcx.lang_items().phantom_data();
      if (def_id !== undefined) {
        help = { $: "Adt", param_name, phantom_data: tcx.def_path_str(def_id) };
      } else {
        help = { $: "AdtNoPhantomData", param_name };
      }
      break;
    }
    default: {
      const item_kind = item.kind;
      return bug(`report_bivariance: unexpected item kind: ${format_debug(item_kind, debug_ItemKind, PLAIN)}`);
    }
  }

  const usage_spans: Span[] = [];
  walk_item(new CollectUsageSpans(usage_spans, LocalDefIdC.to_def_id(param.def_id)), item);

  if (usage_spans.length !== 0) {
    // First, check if the ADT/LTA is (probably) cyclical. We say probably here, since we're
    // not actually looking into substitutions, just walking through fields / the "RHS".
    // We don't recurse into the hidden types of opaques or anything else fancy.
    const item_def_id = LocalDefIdC.to_def_id(item.owner_id.def_id);
    const is_probably_cyclical = new IsProbablyCyclical(tcx, item_def_id, new DefIdSet()).visit_def(item_def_id).$ === "Break";
    // If the ADT/LTA is cyclical, then if at least one usage of the type parameter or
    // the `Self` alias is present in the, then it's probably a cyclical struct/ type
    // alias, and we should call those parameter usages recursive rather than just saying
    // they're unused...
    //
    // We currently report *all* of the parameter usages, since computing the exact
    // subset is very involved, and the fact we're mentioning recursion at all is
    // likely to guide the user in the right direction.
    if (is_probably_cyclical) {
      return tcx.dcx().emit_err(
        diagnostics().RecursiveGenericParameter_diagnostic({
          spans: usage_spans,
          param_span: param.span,
          param_name,
          param_def_kind: tcx.def_descr(LocalDefIdC.to_def_id(param.def_id)),
          help,
          note: null,
        }),
      );
    }
  }

  const const_param_help = param.kind.$ === "Type" && !has_explicit_bounds;

  const diag = tcx.dcx().create_err(
    diagnostics().UnusedGenericParameter_diagnostic({
      span: param.span,
      param_name,
      param_def_kind: tcx.def_descr(LocalDefIdC.to_def_id(param.def_id)),
      usage_spans,
      help,
      const_param_help,
    }),
  );
  diag.code(E0392);
  if (ItemKind.recovered(item.kind)) {
    // Silence potentially redundant error, as the item had a parse error.
    return diag.delay_as_bug();
  } else {
    return diag.emit_err();
  }
}

/// Detects cases where an ADT/LTA is trivially cyclical -- we want to detect this so
/// we only mention that its parameters are used cyclically if the ADT/LTA is truly
/// cyclical.
///
/// Notably, we don't consider substitutions here, so this may have false positives.
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2231 IsProbablyCyclical
class IsProbablyCyclical implements TypeVisitor<ControlFlow<null, null>> {
  readonly Result: VisitorResult<ControlFlow<null, null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    public tcx: TyCtxt,
    public item_def_id: DefId,
    public seen: DefIdSet,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2238 visit_def
  visit_def(def_id: DefId): ControlFlow<null, null> {
    const k = this.tcx.def_kind(def_id);
    switch (k.$) {
      case "Struct":
      case "Enum":
      case "Union": {
        for (const field of (this.tcx.adt_def(def_id) as AdtDef).all_fields()) {
          const r = fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(field.did) as EarlyBinder<Ty>)), this);
          if (r.$ === "Break") return r;
        }
        return ControlFlowC.Continue(null);
      }
      default:
        return ControlFlowC.Continue(null);
    }
  }

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null, null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2257 visit_ty
  visit_ty(ty: Ty): ControlFlow<null, null> {
    const adt_def = ty.ty_adt_def();
    if (adt_def !== undefined) {
      if (DefId_eq(adt_def.did(), this.item_def_id)) {
        return ControlFlowC.Break(null);
      }
      if (set_insert(this.seen, adt_def.did())) {
        const r = this.visit_def(adt_def.did());
        if (r.$ === "Break") return r;
      }
    }
    return fold_Ty.super_visit_with(ty, this);
  }

  visit_region(r: Region): ControlFlow<null, null> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  visit_const(c: Const): ControlFlow<null, null> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null, null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Parameters<TypeVisitor<ControlFlow<null, null>>["visit_clauses"]>[0]): ControlFlow<null, null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<null, null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/// Collect usages of the `param_def_id` and `Res::SelfTyAlias` in the HIR.
///
/// This is used to report places where the user has used parameters in a
/// non-variance-constraining way for better bivariance errors.
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2274 CollectUsageSpans
class CollectUsageSpans extends Visitor {
  constructor(
    public spans: Span[],
    public param_def_id: DefId,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for CollectUsageSpans<'_>

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2282 visit_generics
  override visit_generics(_g: hir.Generics): undefined {
    // Skip the generics. We only care about fields, not where clause/param bounds.
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2286 visit_ty
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    const kind = t.kind;
    if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined) {
      const qpath = kind._0._1;
      const res = qpath.res;
      if (res.$ === "Def" && res._0.$ === "TyParam" && DefId_eq(res._1, this.param_def_id)) {
        this.spans.push(t.span);
        return undefined;
      } else if (res.$ === "SelfTyAlias") {
        this.spans.push(t.span);
        return undefined;
      }
    }
    walk_ty(this, t);
    return undefined;
  }
}

// impl<'tcx> WfCheckingCtxt<'_, 'tcx> (wfcheck.rs:2302)
// PORT: methods of a later upstream `impl` block are assigned to the class's prototype here; the class (check-wf-a's
// region) is merged with this interface.
export interface WfCheckingCtxt {
  check_false_global_bounds(): void;
  check_test_binder_body(body: TestBinderBody): void;
  check_test_binder_forall(forall: TestBinderForall): void;
  build_test_binder_assumptions(span: Span, type_outlives: PolyTypeOutlivesClause[], region_outlives: RegionOutlivesClause[]): Assumptions;
  check_test_binder_region_constraints(fallback_span: Span, expected: SolverRegionConstraint, actual: SolverRegionConstraint): void;
  check_test_binder_exists(exists: TestBinderExists): void;
}

/// Feature gates RFC 2056 -- trivial bounds, checking for global bounds that
/// aren't true.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2306 check_false_global_bounds
WfCheckingCtxt.prototype.check_false_global_bounds = function (this: WfCheckingCtxt): void {
  const tcx = this.ocx.infcx.tcx;
  let span = tcx.def_span(this.body_def_id);
  const empty_env = ParamEnvC.empty();

  const clauses_with_span = (tcx.clauses_of(LocalDefIdC.to_def_id(this.body_def_id)) as GenericClauses).clauses.map(([c, sp]): [Clause, Span] => [c, sp]);
  // Check elaborated bounds.
  const implied_obligations = elaborate(tcx, clauses_with_span, Elaboratable_Clause_Span);

  for (const [clause, obligation_span] of implied_obligations) {
    const k = Binder.skip_binder(clause.kind());
    switch (k.$) {
      // We lower empty bounds like `Vec<dyn Copy>:` as
      // `WellFormed(Vec<dyn Copy>)`, which will later get checked by
      // regular WF checking
      case "WellFormed":
      // Unstable feature goals cannot be proven in an empty environment so skip them
      case "UnstableFeature":
        continue;
      default:
        break;
    }

    // Match the existing behavior.
    if (TypeVisitableExt.is_global(clause, fold_Clause) && !TypeVisitableExt.has_type_flags(clause, TypeFlags.HAS_BINDER_VARS, fold_Clause)) {
      const clause_ = this.normalize(span, WellFormedLocC.None, Unnormalized.new_wip(clause), fold_Clause);

      // only use the span of the predicate clause (#90869)
      const hir_node = tcx.hir_node_by_def_id(this.body_def_id);
      const generics = HirNode.generics(hir_node);
      if (generics !== undefined) {
        const { predicates } = generics;
        span =
          predicates
            // There seems to be no better way to find out which predicate we are in
            .find((pred) => SpanC.contains(pred.span, obligation_span))?.span ?? obligation_span;
      }

      const obligation = Obligation.new(tcx, ObligationCause.new(span, this.body_def_id, ObligationCauseCode.TrivialBound), empty_env, clause_, as_obligation_upcast(Predicate_upcast_from_Clause));
      this.ocx.register_obligation(obligation);
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2358 check_test_binder_body
WfCheckingCtxt.prototype.check_test_binder_body = function (this: WfCheckingCtxt, body: TestBinderBody): void {
  const { foralls, exists, constraints: constraints_, predicates } = body;
  if (predicates.length !== 0) {
    for (const [predicate, span] of predicates) {
      const cause = ObligationCause.misc(span, this.body_def_id);
      const obligation = Obligation.new(this.tcx(), cause, this.param_env, predicate, as_obligation_upcast(Predicate_upcast_from_Binder_ClauseKind));
      this.register_obligation(obligation);
    }
    const errors = this.ocx.evaluate_obligations_error_on_ambiguity();
    switch (errors.$) {
      case "NoErrors":
        break;
      case "HasErrors":
        err_ctxt(this.infcx).report_fulfillment_errors(errors._0);
        return;
    }
  }

  let constraints: SolverRegionConstraint;
  const v = validate(this.tcx(), constraints_);
  if (v.$ === "Ok") {
    constraints = constraints_;
  } else {
    constraints = RegionConstraint.new_true() as SolverRegionConstraint;
  }

  this.infcx.register_solver_region_constraint(constraints);

  for (const forall of foralls) {
    this.check_test_binder_forall(forall);
  }
  for (const exists_ of exists) {
    this.check_test_binder_exists(exists_);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2389 validate
  function validate(tcx: TyCtxt, constraint: SolverRegionConstraint): Result<null, ErrorGuaranteed> {
    let r: Result<null, ErrorGuaranteed> = Ok(null);

    const validate_and = (and: And<Span>): void => {
      for (const c of and._0) {
        switch (c.$) {
          case "Ambiguity":
          case "RegionOutlives":
          case "AliasTyOutlivesViaEnv":
            break; // OK
          case "PlaceholderTyOutlives": {
            const ty = c._0;
            const span = c._2;
            // we can't check this during lowering, because the ty is a ty::Bound that gets
            // instantiated with a placeholder when entering the containing forall.
            const tk = ty.kind();
            if (tk.$ === "Placeholder" || tk.$ === "Param") {
              // all OK
            } else {
              const err = tcx.dcx().struct_span_err(span, "the lhs of a ty outlives must be a placeholder");
              err.note(`it is a ${display_Ty(ty)}`);
              err.note(`and here it is \`Debug\`ged :3 ${format_debug(ty, debug_Ty, PLAIN)}`);
              r = Err(err.emit_err());
            }
            break;
          }
        }
      }
    };

    validate_and(constraint.and_constraint);
    for (const and of constraint.or_constraint._0) {
      validate_and(and);
    }

    return r;
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2430 check_test_binder_forall
WfCheckingCtxt.prototype.check_test_binder_forall = function (this: WfCheckingCtxt, forall: TestBinderForall): void {
  const prev_u = this.infcx.universe();
  this.infcx.enter_forall(
    forall.binder,
    (body) => {
      let u;
      if (prev_u === this.infcx.universe()) {
        // `enter_forall` has some special cases to avoid creating universes
        // in some cases for perf reasons. Not creating the universe unconditionally
        // breaks calling `eagerly_handle_placeholders` later on in this function.
        //
        // See `test_infra_empty_forall.rs`.
        u = this.infcx.create_next_universe();
      } else {
        u = this.infcx.universe();
      }

      const assumptions = this.build_test_binder_assumptions(forall.span, body.type_outlives, body.region_outlives);
      this.infcx.insert_placeholder_assumptions(u, assumptions);
      this.check_test_binder_body(body.value);
      const solver_region_constraint = this.infcx.get_solver_region_constraint();
      const constraint = RegionConstraint.with_spans(
        eagerly_handle_placeholders_in_universe(this.infcx, RegionConstraint.without_spans(solver_region_constraint), u),
        forall.span,
      ) as SolverRegionConstraint;
      if (forall.assert_on_exit !== undefined) {
        const assert_on_exit = forall.assert_on_exit;
        this.check_test_binder_region_constraints(forall.span, assert_on_exit, constraint);
      }
      this.infcx.overwrite_solver_region_constraint(constraint);
    },
    fold_WithWhereClauses_TestBinderBody,
  );
};

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2465 build_test_binder_assumptions
WfCheckingCtxt.prototype.build_test_binder_assumptions = function (
  this: WfCheckingCtxt,
  span: Span,
  type_outlives: PolyTypeOutlivesClause[],
  region_outlives: RegionOutlivesClause[],
): Assumptions {
  for (const clause of type_outlives) {
    const k = Binder.skip_binder(clause)._0.kind();
    if (!(k.$ === "Alias" || k.$ === "Param" || k.$ === "Placeholder")) {
      const err = this.tcx().dcx().struct_span_err(span, "the lhs of a forall where clause must be " + "an alias, placeholder, or lifetime");
      err.note(`the bad clause is ${display_PolyTypeOutlivesClause(clause)}`);
      err.emit();
    }
  }
  const ty = type_outlives.map((c): Binder<ClauseKind> => Binder.map_bound(c, (o) => ({ $: "TypeOutlives", _0: o }) as ClauseKind));
  const reg = region_outlives.map((c) => Binder.dummy({ $: "RegionOutlives", _0: c } as ClauseKind, d_ClauseKind));
  const explicit_clauses: Clause[] = [...ty, ...reg].map((c) => Clause_upcast_from_Binder_ClauseKind(c, this.tcx()));
  for (const elaborated of elaborate(this.tcx(), explicit_clauses, Elaboratable_Clause)) {
    if (!explicit_clauses.includes(elaborated)) {
      const err = this.tcx().dcx().struct_span_err(span, "all implied bounds of clauses must themselves be " + "included in the where clause of a forall");
      err.note(`missing clause is ${display_Clause(elaborated)}`);
      err.emit();
    }
  }

  const builder = TransitiveRelationBuilder.default<Region>();
  for (const { _0: r1, _1: r2 } of region_outlives) {
    builder.add(r1, r2);
  }
  // Deliberately unelaborated: the assumptions of a `forall` are exactly the ones
  // written down in the test, no extra ones hidden behind the scenes.
  return Assumptions.new_unelaborated(type_outlives, builder.freeze());
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2512 check_test_binder_region_constraints
WfCheckingCtxt.prototype.check_test_binder_region_constraints = function (
  this: WfCheckingCtxt,
  fallback_span: Span,
  expected: SolverRegionConstraint,
  actual: SolverRegionConstraint,
): void {
  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2518 err
  function err<E, A>(tcx: TyCtxt, expected_span: Span, expected: E, debug_E: (v: E) => string, actual_span: Span | undefined, actual: A, debug_A: (v: A) => string): void {
    const err = tcx.dcx().struct_span_err(expected_span, "forall expect clause failed");
    if (actual_span !== undefined) {
      err.span_note(actual_span, "constraint from here");
    }
    err.note(`expected: ${debug_E(expected)}`);
    err.note(`actual: ${debug_A(actual)}`);
    err.emit();
  }

  const span_of_and = (c: And<Span>): Span | undefined =>
    c._0.map((leaf) => LeafRegionConstraint.span(leaf)).reduce<Span | undefined>((span, acc) => (span === undefined ? acc : SpanC.to(acc, span)), undefined);

  const span_of_or = (c: Or<Span>): Span | undefined =>
    c._0.flatMap((and) => {
      const s = span_of_and(and);
      return s === undefined ? [] : [s];
    }).reduce<Span | undefined>((span, acc) => (span === undefined ? acc : SpanC.to(acc, span)), undefined);

  const check_leaf_constraint = (expected: LeafRegionConstraint<Span>, actual: LeafRegionConstraint<Span>): void => {
    if (expected.$ === "AliasTyOutlivesViaEnv" && actual.$ === "AliasTyOutlivesViaEnv") {
      const expected_ = expected._0;
      const expected_span = expected._1;
      const actual_ = actual._0;
      const actual_span = actual._1;
      const expected_anon = this.tcx().anonymize_bound_vars(expected_, d_AliasTyOutlivesViaEnv);
      const actual_anon = this.tcx().anonymize_bound_vars(actual_, d_AliasTyOutlivesViaEnv);
      // PORT: `Binder`'s derived `PartialEq` is `intern_key` equality.
      if (intern_key(expected_anon) !== intern_key(actual_anon)) {
        const err = this.tcx().dcx().struct_span_err(expected_span, "forall expect clause failed");
        err.span_note(actual_span, "constraint from here");
        err.note(`expected: ${debug_alt_AliasTyOutlivesViaEnv(expected_)}`);
        err.note(`actual: ${debug_alt_AliasTyOutlivesViaEnv(actual_)}`);
        err.note(`expected_anon: ${debug_alt_AliasTyOutlivesViaEnv(expected_anon)}`);
        err.note(`actual_anon: ${debug_alt_AliasTyOutlivesViaEnv(actual_anon)}`);
        err.emit();
      }
    } else if (!LeafRegionConstraint_eq(LeafRegionConstraint.without_span(expected), LeafRegionConstraint.without_span(actual))) {
      err(this.tcx(), LeafRegionConstraint.span(expected), expected, debug_alt_Leaf, LeafRegionConstraint.span(actual), actual, debug_alt_Leaf);
    }
  };

  const check_and_constraint = (expected: And<Span>, actual: And<Span>): void => {
    if (expected._0.length !== actual._0.length) {
      err(this.tcx(), span_of_and(expected) ?? fallback_span, expected, debug_alt_And, span_of_and(actual), actual, debug_alt_And);
    } else {
      for (let i = 0; i < expected._0.length; i++) {
        check_leaf_constraint(expected._0[i]!, actual._0[i]!);
      }
    }
  };

  const check_or_constraint = (expected: Or<Span>, actual: Or<Span>): void => {
    if (expected._0.length !== actual._0.length) {
      err(this.tcx(), span_of_or(expected) ?? fallback_span, expected, debug_alt_Or, span_of_or(actual), actual, debug_alt_Or);
    } else {
      for (let i = 0; i < expected._0.length; i++) {
        check_and_constraint(expected._0[i]!, actual._0[i]!);
      }
    }
  };

  check_or_constraint(expected.or_constraint, actual.or_constraint);
  check_and_constraint(expected.and_constraint, actual.and_constraint);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2604 check_test_binder_exists
WfCheckingCtxt.prototype.check_test_binder_exists = function (this: WfCheckingCtxt, exists: TestBinderExists): void {
  const body = this.infcx.instantiate_binder_with_fresh_vars(exists.span, BoundRegionConversionTime.HigherRankedType, exists.binder, fold_TestBinderBody);
  this.check_test_binder_body(body);
};

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2614 check_type_wf
export function check_type_wf(tcx: TyCtxt, _: null): Result<null, ErrorGuaranteed> {
  const items = tcx.hir_crate_items(null) as ModuleItems;
  // PORT: `a.and(b)` evaluates `b` first: every `par_*` runs, in this order.
  const r1 = items.par_items((item) => tcx.ensure_result().check_well_formed(item.owner_id.def_id));
  const r2 = items.par_impl_items((item) => tcx.ensure_result().check_well_formed(item.owner_id.def_id));
  const r3 = items.par_trait_items((item) => tcx.ensure_result().check_well_formed(item.owner_id.def_id));
  const r4 = items.par_foreign_items((item) => tcx.ensure_result().check_well_formed(item.owner_id.def_id));
  const r5 = items.par_nested_bodies((item) => tcx.ensure_result().check_well_formed(item));
  const r6 = items.par_opaques((item) => tcx.ensure_result().check_well_formed(item));
  const res = and(and(and(and(and(r1, r2), r3), r4), r5), r6);

  const r = check_for_entry_fn(tcx);
  if (r.$ === "Err") return r;

  return res;
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2638 lint_redundant_lifetimes
function lint_redundant_lifetimes(tcx: TyCtxt, owner_id: LocalDefId, outlives_env: OutlivesEnvironment): void {
  const def_kind = tcx.def_kind(owner_id);
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Trait":
    case "TraitAlias":
    case "Fn":
    case "Const":
    case "Impl":
    case "TestBinderConstraints":
      // Proceed
      break;
    case "AssocFn":
    case "AssocTy":
    case "AssocConst":
      if (tcx.trait_impl_of_assoc(LocalDefIdC.to_def_id(owner_id)) !== undefined) {
        // Don't check for redundant lifetimes for associated items of trait
        // implementations, since the signature is required to be compatible
        // with the trait, even if the implementation implies some lifetimes
        // are redundant.
        return;
      }
      break;
    case "Mod":
    case "Variant":
    case "TyAlias":
    case "ForeignTy":
    case "TyParam":
    case "ConstParam":
    case "Static":
    case "Ctor":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "ForeignMod":
    case "AnonConst":
    case "OpaqueTy":
    case "Field":
    case "LifetimeParam":
    case "GlobalAsm":
    case "Closure":
    case "SyntheticCoroutineBody":
      return;
  }

  // The ordering of this lifetime map is a bit subtle.
  //
  // Specifically, we want to find a "candidate" lifetime that precedes a "victim" lifetime,
  // where we can prove that `'candidate = 'victim`.
  //
  // `'static` must come first in this list because we can never replace `'static` with
  // something else, but if we find some lifetime `'a` where `'a = 'static`, we want to
  // suggest replacing `'a` with `'static`.
  let lifetimes: Region[] = [tcx.lifetimes.re_static];
  for (const arg of RawList.identity_for_item(tcx, LocalDefIdC.to_def_id(owner_id))) {
    const r = GenericArg.as_region(arg);
    if (r !== undefined) lifetimes.push(r);
  }
  // If we are in a function, add its late-bound lifetimes too.
  if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") {
    const bound_vars = Binder.bound_vars(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(owner_id) as EarlyBinder<PolyFnSig>)));
    bound_vars.forEach((var_, idx) => {
      if (var_.$ !== "Region") return;
      const kind = var_._0;
      const kind_ = LateParamRegionKind_from_bound(idx as BoundVar, kind);
      lifetimes.push(RegionC.new_late_param(tcx, LocalDefIdC.to_def_id(owner_id), kind_));
    });
  }
  lifetimes = lifetimes.filter((candidate) => candidate.is_named(tcx));

  // Keep track of lifetimes which have already been replaced with other lifetimes.
  // This makes sure that if `'a = 'b = 'c`, we don't say `'c` should be replaced by
  // both `'a` and `'b`.
  const shadowed = new Set<Region>();

  lifetimes.forEach((candidate, idx) => {
    // Don't suggest removing a lifetime twice. We only need to check this
    // here and not up in the `victim` loop because equality is transitive,
    // so if A = C and B = C, then A must = B, so it'll be shadowed too in
    // A's victim loop.
    if (shadowed.has(candidate)) {
      return;
    }

    for (const victim of lifetimes.slice(idx + 1)) {
      // All region parameters should have a `DefId` available as:
      // - Late-bound parameters should be of the`BrNamed` variety,
      // since we get these signatures straight from `hir_lowering`.
      // - Early-bound parameters unconditionally have a `DefId` available.
      //
      // Any other regions (ReError/ReStatic/etc.) shouldn't matter, since we
      // can't really suggest to remove them.
      const def_id = victim.opt_param_def_id(tcx, LocalDefIdC.to_def_id(owner_id));
      if (def_id === undefined) {
        continue;
      }

      // Do not rename lifetimes not local to this item since they'll overlap
      // with the lint running on the parent. We still want to consider parent
      // lifetimes which make child lifetimes redundant, otherwise we would
      // have truncated the `identity_for_item` args above.
      if (!DefId_eq(tcx.parent(def_id), LocalDefIdC.to_def_id(owner_id))) {
        continue;
      }

      // If `candidate <: victim` and `victim <: candidate`, then they're equal.
      if (outlives_env.free_region_map().sub_free_regions(tcx, candidate, victim) && outlives_env.free_region_map().sub_free_regions(tcx, victim, candidate)) {
        shadowed.add(victim);
        tcx.emit_node_span_lint(
          REDUNDANT_LIFETIMES,
          tcx.local_def_id_to_hir_id(def_id.expect_local()),
          tcx.def_span(def_id),
          RedundantLifetimeArgsLint_diagnostic({ candidate, victim }),
        );
      }
    }
  });
}

// #[derive(Diagnostic)]
// #[diag("unnecessary lifetime parameter `{$victim}`")]
// #[note("you can use the `{$candidate}` lifetime directly, in place of `{$victim}`")]
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2768 RedundantLifetimeArgsLint
interface RedundantLifetimeArgsLint {
  /// The lifetime we have found to be redundant.
  victim: Region;
  // The lifetime we can replace the victim with.
  candidate: Region;
}

// #[derive(Clone, Debug, TypeFoldable, TypeVisitable)]
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2776 TestBinderBody
export interface TestBinderBody {
  foralls: TestBinderForall[];
  exists: TestBinderExists[];
  /// Constraints to be inserted directly into constraint storage to be proven
  constraints: SolverRegionConstraint;
  /// Constraints declared using `where` syntax, used via `register_obligation`
  predicates: [Binder<ClauseKind>, Span][];
}

// #[derive(Clone, Debug, TypeFoldable, TypeVisitable)]
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2786 TestBinderForall
export interface TestBinderForall {
  span: Span;
  binder: Binder<WithWhereClauses<TestBinderBody>>;
  assert_on_exit: SolverRegionConstraint | undefined;
}

// #[derive(Clone, Debug, TypeFoldable, TypeVisitable)]
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2793 TestBinderExists
export interface TestBinderExists {
  span: Span;
  binder: Binder<TestBinderBody>;
}

// #[derive(Clone, Debug, TypeFoldable, TypeVisitable)]
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:2799 WithWhereClauses
export interface WithWhereClauses<T> {
  value: T;

  // The where clauses on the forall. These eventually will probably get stored inside
  // `ty::Binder` but they're here for now.
  type_outlives: PolyTypeOutlivesClause[];
  region_outlives: RegionOutlivesClause[];
}

// ---- check-wf-b helpers (not ports) ----------------------------------------------------------------------------------

/** `TraitRef: TypeFoldable` (generated) as a D4 descriptor; `PolyTraitRef`'s is `fold_Binder` of it. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_PolyTraitRef: TypeFoldable<Binder<TraitRef>> = fold_Binder(d_TraitRef);
/** `ClauseKind: TypeFoldable` (generated). */
const d_ClauseKind: TypeFoldable<ClauseKind> = { visit_with: visit_with_ClauseKind, try_fold_with: try_fold_with_ClauseKind, fold_with: fold_with_ClauseKind };
/** `(AliasTy, Region): TypeFoldable` (fold.rs's tuple impl over the generated `AliasTy` impl). */
const d_AliasTyOutlivesViaEnv: TypeFoldable<[AliasTy, Region]> = fold_tuple2<AliasTy, Region>(
  {
    visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTyKind),
    try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasTyKind),
    fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTyKind),
  },
  fold_Region,
);

/** `{:#?}` of `Binder<(AliasTy, Region)>` (the derived `Binder` Debug over std's tuple Debug). */
function debug_alt_AliasTyOutlivesViaEnv(v: Binder<[AliasTy, Region]>): string {
  const debug_pair: Debug<[AliasTy, Region]> = (p, f: Fmt) => debug_tuple(f, "", [debug_Alias(p[0], f, debug_AliasTyKind), debug_Region(p[1], f)]);
  return format_debug(v, (b, f) => debug_Binder(b, f, debug_pair), PRETTY);
}
/** `{:#?}` of `LeafRegionConstraint<_, Span>`. */
function debug_alt_Leaf(v: LeafRegionConstraint<Span>): string {
  return format_debug(v, (x, f) => debug_LeafRegionConstraint(x, f, debug_Span), PRETTY);
}
/** `{:#?}` of `And<_, Span>`. */
function debug_alt_And(v: And<Span>): string {
  return format_debug(v, (x, f) => debug_And(x, f, debug_Span), PRETTY);
}
/** `{:#?}` of `Or<_, Span>`. */
function debug_alt_Or(v: Or<Span>): string {
  return format_debug(v, (x, f) => debug_Or(x, f, debug_Span), PRETTY);
}

/** The derived `PartialEq` of `LeafRegionConstraint<I>` (`S = ()`): `intern_key` is the derived `Hash`+`Eq`. */
function LeafRegionConstraint_eq(a: LeafRegionConstraint, b: LeafRegionConstraint): boolean {
  return intern_key(a) === intern_key(b);
}

/** `FxHashSet::insert`: whether the value was newly inserted. */
function set_insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** `crate::diagnostics` (read at call time: init order). */
function diagnostics(): typeof import("../diagnostics.ts") {
  return require("../diagnostics.ts") as typeof import("../diagnostics.ts");
}

/** `crate::collect` (read at call time: init order). */
function collect(): typeof import("../collect.ts") {
  return require("../collect.ts") as typeof import("../collect.ts");
}

/** `crate::constrained_generic_params` (read at call time: init order). */
function cgp(): typeof import("../constrained_generic_params.ts") {
  return require("../constrained_generic_params.ts") as typeof import("../constrained_generic_params.ts");
}

// ---- check-wf-b stand-ins for items that are not ported yet (each stops as UNPORTED; not markers) --------------------

/** `crate::autoderef::Autoderef` (rustc_hir_analysis autoderef.rs, not ported): the members this file uses. */
interface AutoderefView {
  use_receiver_trait(): AutoderefView;
  include_raw_pointers(): AutoderefView;
  next(): [Ty, number] | undefined;
  into_obligations(): PredicateObligation[];
}

/** PORT(stand-in): `Autoderef::new` (rustc_hir_analysis autoderef.rs, not ported; no wave-17 lane). */
function Autoderef_new(_infcx: InferCtxt, _param_env: ParamEnv, _body_def_id: LocalDefId, _span: Span, _base_ty: Ty): AutoderefView {
  return unported("rustc_hir_analysis::autoderef::Autoderef::new");
}

/** PORT(stand-in): `compare_eii::compare_eii_function_types` (check/compare_eii.rs, not ported: EII is out of M3 scope). */
function compare_eii_function_types(_tcx: TyCtxt, _external_impl: LocalDefId, _foreign_item: DefId, _eii_name: unknown, _eii_attr_span: Span): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::compare_eii::compare_eii_function_types");
}

/** PORT(stand-in): `compare_eii::compare_eii_statics` (check/compare_eii.rs, not ported: EII is out of M3 scope). */
function compare_eii_statics(_tcx: TyCtxt, _external_impl: LocalDefId, _external_impl_ty: Ty, _foreign_item: DefId, _eii_name: unknown, _eii_attr_span: Span): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::compare_eii::compare_eii_statics");
}

/** PORT(stand-in): `super::entry::check_for_entry_fn` (check/entry.rs, not ported). */
function check_for_entry_fn(_tcx: TyCtxt): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::entry::check_for_entry_fn");
}

/**
 * PORT(stand-in): `impl Elaboratable<TyCtxt> for (ty::Clause, Span)` (rustc_middle ty/elaborate_impl.rs:66, not ported);
 * a faithful copy without markers, like rustc_type_ir elaborate.ts's `Elaboratable_Clause`.
 */
const Elaboratable_Clause_Span: Elaboratable<[Clause, Span]> = {
  predicate(self) {
    return self[0].as_predicate();
  },
  child(self, clause) {
    return [clause, self[1]];
  },
  child_with_derived_cause(self, clause, _span, _parent_trait_pred, _index) {
    return [clause, self[1]];
  },
};

/** PORT(stand-in): `LateParamRegionKind::from_bound` (rustc_middle ty/region.rs:92, not ported; as rustc_middle fold.ts). */
function LateParamRegionKind_from_bound(_var: BoundVar, _br: BoundRegion["kind"]): LateParamRegionKind {
  return unported("rustc_middle::ty::region::LateParamRegionKind::from_bound");
}

/** PORT(stand-in): `Display for ty::Binder<'tcx, ty::TypeOutlivesClause<'tcx>>` (rustc_middle ty/print/pretty.rs `forward_display_to_print!`, not ported). */
function display_PolyTypeOutlivesClause(_clause: PolyTypeOutlivesClause): string {
  return unported("rustc_middle::ty::print::pretty: Display for Binder<TypeOutlivesClause>");
}

/** PORT(stand-in): `RedundantLifetimeArgsLint`'s `#[derive(Diagnostic)]` (codegen pending: wfcheck.rs is in no codegen set). */
function RedundantLifetimeArgsLint_diagnostic(_self: RedundantLifetimeArgsLint): import("../../rustc_errors/lib.ts").Diagnostic {
  return { into_diag: () => unported("rustc_hir_analysis::check::wfcheck::RedundantLifetimeArgsLint: derive(Diagnostic) (codegen pending)") };
}

/** PORT(stand-in): the derived `TypeFoldable` of `WithWhereClauses<TestBinderBody>` (codegen pending). */
const fold_WithWhereClauses_TestBinderBody: TypeFoldable<WithWhereClauses<TestBinderBody>> = {
  visit_with: () => unported("rustc_hir_analysis::check::wfcheck::WithWhereClauses: derive(TypeVisitable) (codegen pending)"),
  try_fold_with: () => unported("rustc_hir_analysis::check::wfcheck::WithWhereClauses: derive(TypeFoldable) (codegen pending)"),
  fold_with: () => unported("rustc_hir_analysis::check::wfcheck::WithWhereClauses: derive(TypeFoldable) (codegen pending)"),
};

/** PORT(stand-in): the derived `TypeFoldable` of `TestBinderBody` (codegen pending). */
const fold_TestBinderBody: TypeFoldable<TestBinderBody> = {
  visit_with: () => unported("rustc_hir_analysis::check::wfcheck::TestBinderBody: derive(TypeVisitable) (codegen pending)"),
  try_fold_with: () => unported("rustc_hir_analysis::check::wfcheck::TestBinderBody: derive(TypeFoldable) (codegen pending)"),
  fold_with: () => unported("rustc_hir_analysis::check::wfcheck::TestBinderBody: derive(TypeFoldable) (codegen pending)"),
};
