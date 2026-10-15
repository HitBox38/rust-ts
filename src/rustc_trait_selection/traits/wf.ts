// Port of compiler/rustc_trait_selection/src/traits/wf.rs (lane trait-sel-traits-b, wave 17).
//
//! Core logic responsible for determining what it means for various type system
//! primitives to be "well formed". Actually checking whether these primitives are
//! well formed is performed elsewhere (e.g. during type checking or item well formedness
//! checking).
//
// PORT: `debug!` / `#[instrument]` (tracing) are dropped. `WfPredicates` is a class implementing rustc_type_ir's
// `TypeVisitor<()>` (`R = undefined`); `impl FnMut(&mut Self, PredicateObligation)` callbacks are closures taking the
// `WfPredicates` first. `traits::Obligation::with_depth(.., value)` takes the `Upcast` impl fn of the value's type to
// `Predicate` last (rustc_infer decls.ts). The old solver's `SelectionContext::new` (wave 20) is
// normalize.ts's `pending_SelectionContext_new` stand-in; `project::compute_inherent_assoc_term_args` (traits/project.rs,
// wave 20) is a stand-in at the end of the file. Both stop as UNPORTED.
//
// Init order: rustc_infer is loaded through its crate root; other rustc_infer / rustc_middle modules are read inside
// function bodies only.
import { normalize_with_depth_to, pending_SelectionContext_new, type SelectionContext } from "./normalize.ts";
import "../../rustc_infer/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { Obligation, type PredicateObligation, type PredicateObligations, visit_with_Obligation } from "../../rustc_infer/traits/mod.ts";
import { Elaboratable_PredicateObligation } from "../../rustc_infer/traits/util.ts";
import type { Pending } from "../../rustc_type_ir/decls.ts";
import { VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { ObligationCause, ObligationCauseCode, WellFormedLoc, clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Const, GenericArgs, List, Predicate, Region } from "../../rustc_middle/ty/decls.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { GenericArg, fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { type ParamEnv, Term, Ty, fold_Term } from "../../rustc_middle/ty/mod.ts";
import { Value } from "../../rustc_middle/ty/consts/valtree.ts";
import * as middle_predicate from "../../rustc_middle/ty/predicate.ts";
import { fold_BoundExistentialPredicates, fold_Clause, fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { DefId_eq, type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import { Elaboratable_Clause, elaborate } from "../../rustc_type_ir/elaborate.ts";
import { DelayedSet } from "../../rustc_type_ir/data_structures/mod.ts";
import type { PredicateProxy, TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { as_interner, ClausePolarity, ExistentialTraitRef, PolyExistentialPredicate, PolyExistentialProjection, ProjectionClause, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { PatternKind } from "../../rustc_type_ir/pattern.gen.ts";
import type { Pattern } from "../../rustc_middle/ty/decls.ts";
import type { PolyExistentialPredicate as PolyExistentialPredicateT, PolyFnSig as PolyFnSigT } from "../../rustc_type_ir/decls.ts";
import { type OutlivesClause, visit_with_OutlivesClause, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { type ClauseKind, type PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import { fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { fold_Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../rustc_type_ir/ty/alias.ts";
import { ClosureArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { PolyFnSig, UnsafeBinderInner_deref, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized, visit_with_Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";

/** PORT: the generated `TypeVisitable` impl fns as D4 descriptors (`Binder::dummy`, `has_escaping_bound_vars`). */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };
const d_TraitRef: TypeVisitable<TraitRef> = { visit_with: visit_with_TraitRef };
const d_RegionOutlivesClause: TypeVisitable<OutlivesClause<Region>> = {
  visit_with: (v, visitor) => visit_with_OutlivesClause(v, visitor, fold_Region.visit_with),
};
const d_PredicateObligation: TypeVisitable<PredicateObligation> = {
  visit_with: (v, visitor) => visit_with_Obligation(v, visitor, fold_Predicate.visit_with),
};
const d_Unnormalized_Clause: TypeVisitable<Unnormalized<Clause>> = {
  visit_with: (v, visitor) => visit_with_Unnormalized(v, visitor, fold_Clause.visit_with),
};
const d_PolyFnSig: TypeFoldable<PolyFnSigT> = fold_Binder(fold_FnSig);

/**
 * PORT: the `impl UpcastFrom<TyCtxt, X> for Predicate` fns (rustc_middle ty/predicate.ts) take the `TyCtxt`;
 * `Obligation::with_depth` passes `as_interner(tcx)`, which is the same object (D3).
 */
function upcast_via_tcx<P>(f: (from: P, tcx: TyCtxt) => Predicate): (from: P, interner: Interner) => Predicate {
  return (from, interner) => f(from, interner as unknown as TyCtxt);
}
const Predicate_upcast_from_Binder_PredicateKind = upcast_via_tcx(middle_predicate.Predicate_upcast_from_Binder_PredicateKind);
const Predicate_upcast_from_Clause = upcast_via_tcx(middle_predicate.Predicate_upcast_from_Clause);
const Predicate_upcast_from_ClauseKind = upcast_via_tcx(middle_predicate.Predicate_upcast_from_ClauseKind);
const Predicate_upcast_from_PolyRegionOutlivesClause = upcast_via_tcx(middle_predicate.Predicate_upcast_from_PolyRegionOutlivesClause);
const Predicate_upcast_from_PolyTraitRef = upcast_via_tcx(middle_predicate.Predicate_upcast_from_PolyTraitRef);
const Predicate_upcast_from_PredicateKind = upcast_via_tcx(middle_predicate.Predicate_upcast_from_PredicateKind);

/// Returns the set of obligations needed to make `term` well-formed.
/// If `term` contains unresolved inference variables, this may include
/// further WF obligations. However, if `term` IS an unresolved
/// inference variable, returns `None`, because we are not able to
/// make any progress at all. This is to prevent cycles where we
/// say "?0 is WF if ?0 is WF".
// rustc: compiler/rustc_trait_selection/src/traits/wf.rs:31 obligations
export function obligations(
  infcx: InferCtxt,
  param_env: ParamEnv,
  body_def_id: LocalDefId,
  recursion_depth: number,
  term: Term,
  span: Span,
): PredicateObligations | undefined {
  // Handle the "cycle" case (see comment above) by bailing out if necessary.
  const k = Term.kind(term);
  switch (k.$) {
    case "Ty": {
      const ty = k._0;
      const tk = ty.kind();
      let resolved: Ty;
      if (tk.$ === "Infer" && tk._0.$ === "TyVar") {
        const resolved_ty = infcx.shallow_resolve(ty);
        if (resolved_ty === ty) {
          // No progress, bail out to prevent cycles.
          return undefined;
        } else {
          resolved = resolved_ty;
        }
      } else {
        resolved = ty;
      }
      term = Term.from_Ty(resolved);
      break;
    }
    case "Const": {
      const ct = k._0;
      let resolved_: Const;
      if (ct.kind().$ === "Infer") {
        const resolved = infcx.shallow_resolve_const(ct);
        if (resolved === ct) {
          // No progress, bail out to prevent cycles.
          return undefined;
        } else {
          resolved_ = resolved;
        }
      } else {
        resolved_ = ct;
      }
      term = Term.from_Const(resolved_);
      break;
    }
  }

  const wf = new WfPredicates(infcx, param_env, body_def_id, span, [], recursion_depth, undefined, DelayedSet_default());
  wf.add_wf_preds_for_term(term);
  // debug!("wf::obligations({:?}, body_def_id={:?}) = {:?}", term, body_def_id, wf.out);

  const result = wf.normalize(infcx);
  // debug!("wf::obligations({:?}, body_def_id={:?}) ~~> {:?}", term, body_def_id, result);
  return result;
}

/// Compute the predicates that are required for a type to be well-formed.
///
/// This is only intended to be used in the new solver, since it does not
/// take into account recursion depth or proper error-reporting spans.
// rustc: compiler/rustc_trait_selection/src/traits/wf.rs:95 unnormalized_obligations
export function unnormalized_obligations(
  infcx: InferCtxt,
  param_env: ParamEnv,
  term: Term,
  span: Span,
  body_def_id: LocalDefId,
): PredicateObligations | undefined {
  // debug_assert_eq!(term, infcx.deeply_resolve_ignoring_regions(term));

  // However, if `term` IS an unresolved inference variable, returns `None`,
  // because we are not able to make any progress at all. This is to prevent
  // cycles where we say "?0 is WF if ?0 is WF".
  if (Term.is_infer(term)) {
    return undefined;
  }

  const wf = new WfPredicates(infcx, param_env, body_def_id, span, [], 0, undefined, DelayedSet_default());
  wf.add_wf_preds_for_term(term);
  return wf.out;
}

/// Returns the obligations that make this trait reference
/// well-formed. For example, if there is a trait `Set` defined like
/// `trait Set<K: Eq>`, then the trait bound `Foo: Set<Bar>` is WF
/// if `Bar: Eq`.
// rustc: compiler/rustc_trait_selection/src/traits/wf.rs:129 trait_obligations
export function trait_obligations(
  infcx: InferCtxt,
  param_env: ParamEnv,
  body_def_id: LocalDefId,
  trait_pred: TraitClause,
  span: Span,
  item: hir.Item,
): PredicateObligations {
  const wf = new WfPredicates(infcx, param_env, body_def_id, span, [], 0, item, DelayedSet_default());
  wf.add_wf_preds_for_trait_pred(trait_pred, "All");
  // debug!(obligations = ?wf.out);
  return wf.normalize(infcx);
}

/// Returns the requirements for `clause` to be well-formed.
///
/// For example, if there is a trait `Set` defined like
/// `trait Set<K: Eq>`, then the trait bound `Foo: Set<Bar>` is WF
/// if `Bar: Eq`.
// #[instrument(skip(infcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/wf.rs:158 clause_obligations
export function clause_obligations(
  infcx: InferCtxt,
  param_env: ParamEnv,
  body_def_id: LocalDefId,
  clause: Clause,
  span: Span,
): PredicateObligations {
  const wf = new WfPredicates(infcx, param_env, body_def_id, span, [], 0, undefined, DelayedSet_default());

  // It's ok to skip the binder here because wf code is prepared for it
  const k: ClauseKind = Binder.skip_binder(clause.kind());
  switch (k.$) {
    case "Trait": {
      wf.add_wf_preds_for_trait_pred(k._0, "None");
      break;
    }
    case "HostEffect": {
      // Technically the well-formedness of this clause is implied by
      // the corresponding trait clause it should've been generated beside.
      break;
    }
    case "RegionOutlives":
      break;
    case "TypeOutlives": {
      const ty = k._0._0;
      wf.add_wf_preds_for_term(Term.from_Ty(ty));
      break;
    }
    case "Projection": {
      const t = k._0;
      wf.add_wf_preds_for_projection_term(t.projection_term);
      wf.add_wf_preds_for_term(t.term);
      break;
    }
    case "ConstArgHasType": {
      const ct = k._0;
      const ty = k._1;
      wf.add_wf_preds_for_term(Term.from_Const(ct));
      wf.add_wf_preds_for_term(Term.from_Ty(ty));
      break;
    }
    case "WellFormed": {
      const term = k._0;
      wf.add_wf_preds_for_term(term);
      break;
    }

    case "ConstEvaluatable": {
      const ct = k._0;
      wf.add_wf_preds_for_term(Term.from_Const(ct));
      break;
    }
    case "UnstableFeature":
      break;
  }

  return wf.normalize(infcx);
}

/// Controls whether we "elaborate" supertraits and so forth on the WF
/// predicates. This is a kind of hack to address #43784. The
/// underlying problem in that issue was a trait structure like:
///
/// ```ignore (illustrative)
/// trait Foo: Copy { }
/// trait Bar: Foo { }
/// impl<T: Bar> Foo for T { }
/// impl<T> Bar for T { }
/// ```
///
/// Here, in the `Foo` impl, we will check that `T: Copy` holds -- but
/// we decide that this is true because `T: Bar` is in the
/// where-clauses (and we can elaborate that to include `T:
/// Copy`). This wouldn't be a problem, except that when we check the
/// `Bar` impl, we decide that `T: Foo` must hold because of the `Foo`
/// impl. And so nowhere did we check that `T: Copy` holds!
///
/// To resolve this, we elaborate the WF requirements that must be
/// proven when checking impls. This means that (e.g.) the `impl Bar
/// for T` will be forced to prove not only that `T: Foo` but also `T:
/// Copy` (which it won't be able to do, because there is no `Copy`
/// impl for `T`).
// rustc-type: compiler/rustc_trait_selection/src/traits/wf.rs:245 Elaborate
type Elaborate = "All" | "None";

/// Points the cause span of a super predicate at the relevant associated type.
///
/// Given a trait impl item:
///
/// ```ignore (incomplete)
/// impl TargetTrait for TargetType {
///    type Assoc = SomeType;
/// }
/// ```
///
/// And a super predicate of `TargetTrait` that has any of the following forms:
///
/// 1. `<OtherType as OtherTrait>::Assoc == <TargetType as TargetTrait>::Assoc`
/// 2. `<<TargetType as TargetTrait>::Assoc as OtherTrait>::Assoc == OtherType`
/// 3. `<TargetType as TargetTrait>::Assoc: OtherTrait`
///
/// Replace the span of the cause with the span of the associated item:
///
/// ```ignore (incomplete)
/// impl TargetTrait for TargetType {
///     type Assoc = SomeType;
/// //               ^^^^^^^^ this span
/// }
/// ```
///
/// Note that bounds that can be expressed as associated item bounds are **not**
/// super predicates. This means that form 2 and 3 from above are only relevant if
/// the [`GenericArgsRef`] of the projection type are not its identity arguments.
// rustc: compiler/rustc_trait_selection/src/traits/wf.rs:278 extend_cause_with_original_assoc_item_obligation
function extend_cause_with_original_assoc_item_obligation(tcx: TyCtxt, item: hir.Item | undefined, cause: ObligationCause, pred: Predicate): void {
  // debug!(?item, ?cause, ?pred, "extended_cause_with_original_assoc_item_obligation");
  let items: readonly hir.ImplItemId[];
  let impl_def_id: hir.OwnerId;
  if (item !== undefined && item.kind.$ === "Impl") {
    const impl_ = item.kind._0;
    items = impl_.items;
    impl_def_id = item.owner_id;
  } else {
    return;
  }

  const ty_to_impl_span = (ty: Ty): Span | undefined => {
    const k = ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
      const def_id = k._1.kind.def_id;
      const impl_item_id = tcx.impl_item_implementor_ids(impl_def_id.to_def_id()).get(def_id);
      if (impl_item_id !== undefined) {
        const impl_item = items.find((item) => DefId_eq(item.owner_id.to_def_id(), impl_item_id));
        if (impl_item !== undefined) {
          return tcx.hir_impl_item(impl_item).expect_type().span;
        }
      }
    }
    return undefined;
  };

  // It is fine to skip the binder as we don't care about regions here.
  const pk: PredicateKind = Binder.skip_binder(pred.kind());
  if (pk.$ === "Clause" && pk._0.$ === "Projection") {
    const proj = pk._0._0;
    // Form 1: The obligation comes not from the current `impl` nor the `trait` being
    // implemented, but rather from a "second order" obligation, where an associated
    // type has a projection coming from another associated type.
    // See `tests/ui/traits/assoc-type-in-superbad.rs` for an example.
    const term_ty = Term.as_type(proj.term);
    if (term_ty !== undefined) {
      const impl_item_span = ty_to_impl_span(term_ty);
      if (impl_item_span !== undefined) {
        cause.span = impl_item_span;
      }
    }

    // Form 2: A projection obligation for an associated item failed to be met.
    // We overwrite the span from above to ensure that a bound like
    // `Self::Assoc1: Trait<OtherAssoc = Self::Assoc2>` gets the same
    // span for both obligations that it is lowered to.
    const impl_item_span = ty_to_impl_span(ProjectionClause.self_ty(proj));
    if (impl_item_span !== undefined) {
      cause.span = impl_item_span;
    }
  } else if (pk.$ === "Clause" && pk._0.$ === "Trait") {
    const pred = pk._0._0;
    // Form 3: A trait obligation for an associated item failed to be met.
    // debug!("extended_cause_with_original_assoc_item_obligation trait proj {:?}", pred);
    const impl_item_span = ty_to_impl_span(TraitClause.self_ty(pred));
    if (impl_item_span !== undefined) {
      cause.span = impl_item_span;
    }
  }
}

// rustc-type: compiler/rustc_trait_selection/src/traits/wf.rs:210 WfPredicates
class WfPredicates implements TypeVisitor<undefined> {
  /** `impl TypeVisitor`: `type Result = ()`. */
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public infcx: InferCtxt,
    public param_env: ParamEnv,
    public body_def_id: LocalDefId,
    public span: Span,
    public out: PredicateObligations,
    public recursion_depth: number,
    public item: hir.Item | undefined,
    public visited_tys: DelayedSet<Ty>,
  ) {}

  // ---- impl<'a, 'tcx> WfPredicates<'a, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:338 tcx
  tcx(): TyCtxt {
    return this.infcx.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:342 cause
  cause(code: ObligationCauseCode): ObligationCause {
    return ObligationCause.new(this.span, this.body_def_id, code);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:346 normalize
  normalize(infcx: InferCtxt): PredicateObligations {
    // Do not normalize `wf` obligations with the new solver.
    //
    // The current deep normalization routine with the new solver does not
    // handle ambiguity and the new solver correctly deals with unnnormalized goals.
    // If the user relies on normalized types, e.g. for `fn implied_outlives_bounds`,
    // it is their responsibility to normalize while avoiding ambiguity.
    if (infcx.next_trait_solver()) {
      return this.out;
    }

    const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
    const param_env = this.param_env;
    const obligations: PredicateObligations = [];
    for (const obligation of this.out) {
      assert(!TypeVisitableExt.has_escaping_bound_vars(obligation, d_PredicateObligation), "assertion failed: !obligation.has_escaping_bound_vars()");
      const selcx = pending_SelectionContext_new(infcx);
      // Don't normalize the whole obligation, the param env is either
      // already normalized, or we're currently normalizing the
      // param_env. Either way we should only normalize the predicate.
      const normalized_predicate = normalize_with_depth_to(
        selcx,
        param_env,
        clone_ObligationCause(cause),
        this.recursion_depth,
        Unnormalized.new_wip(obligation.predicate),
        obligations,
        fold_Predicate,
      );
      obligation.predicate = normalized_predicate;
      obligations.push(obligation);
    }
    return obligations;
  }

  /// Pushes the obligations required for `trait_ref` to be WF into `self.out`.
  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:381 add_wf_preds_for_trait_pred
  add_wf_preds_for_trait_pred(trait_pred: TraitClause, elaborate_: Elaborate): void {
    const tcx = this.tcx();
    const trait_ref = trait_pred.trait_ref;

    // Negative trait predicates don't require supertraits to hold, just
    // that their args are WF.
    if (trait_pred.polarity === ClausePolarity.Negative) {
      this.add_wf_preds_for_negative_trait_pred(trait_ref);
      return;
    }

    const param_env = this.param_env;
    const depth = this.recursion_depth;

    const item = this.item;

    const extend = (obligation: PredicateObligation): PredicateObligation => {
      const predicate = obligation.predicate;
      let cause = obligation.cause;
      const parent_trait_pred = predicate.as_trait_clause();
      if (parent_trait_pred !== undefined) {
        cause = cause.derived_cause(parent_trait_pred, (d) => ({ $: "WellFormedDerived", _0: d }));
      }
      extend_cause_with_original_assoc_item_obligation(tcx, item, cause, predicate);
      return Obligation.with_depth(tcx, cause, depth, param_env, predicate, upcast_from_Predicate);
    };

    // if the trait predicate is not const, the wf obligations should not be const as well.
    if (elaborate_ === "All") {
      const obligations: PredicateObligations = [];
      this.nominal_obligations(trait_ref.def_id, trait_ref.args, (_, obligation) => {
        obligations.push(obligation);
      });
      // debug!("compute_trait_pred obligations {:?}", obligations);
      const implied_obligations = elaborate(tcx, obligations, Elaboratable_PredicateObligation);
      for (const o of implied_obligations) this.out.push(extend(o));
    } else {
      this.nominal_obligations(trait_ref.def_id, trait_ref.args, (this_, obligation) => {
        this_.out.push(obligation);
      });
    }

    trait_ref.args.forEach((arg, i) => {
      const term = GenericArg.as_term(arg);
      if (term === undefined) return;
      if (TypeVisitableExt.has_escaping_bound_vars(term, fold_Term)) return;
      const cause = ObligationCause.misc(this.span, this.body_def_id);
      // The first arg is the self ty - use the correct span for it.
      if (i === 0) {
        const kind = item?.kind;
        if (kind !== undefined && kind.$ === "Impl") {
          const self_ty = kind._0.self_ty;
          cause.span = self_ty.span;
        }
      }
      this.out.push(Obligation.with_depth(tcx, cause, depth, param_env, { $: "WellFormed", _0: term } satisfies ClauseKind, Predicate_upcast_from_ClauseKind));
    });
  }

  // Compute the obligations that are required for `trait_ref` to be WF,
  // given that it is a *negative* trait predicate.
  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:458 add_wf_preds_for_negative_trait_pred
  add_wf_preds_for_negative_trait_pred(trait_ref: TraitRef): void {
    for (const arg of trait_ref.args) {
      const term = GenericArg.as_term(arg);
      if (term !== undefined) {
        this.add_wf_preds_for_term(term);
      }
    }
  }

  /// Pushes the obligations required for a projection to be WF into `self.out`.
  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:467 add_wf_preds_for_projection_term
  add_wf_preds_for_projection_term(data: AliasTermT): void {
    // A projection is well-formed if
    //
    // (a) its predicates hold (*)
    // (b) its args are wf
    //
    // (*) The predicates of an associated type include the predicates of
    //     the trait that it's contained in. For example, given
    //
    // trait A<T>: Clone {
    //     type X where T: Copy;
    // }
    //
    // The predicates of `<() as A<i32>>::X` are:
    // [
    //     `(): Sized`
    //     `(): Clone`
    //     `(): A<i32>`
    //     `i32: Sized`
    //     `i32: Clone`
    //     `i32: Copy`
    // ]
    this.nominal_obligations(AliasTerm.expect_projection_def_id(data), data.args, (this_, obligation) => {
      this_.out.push(obligation);
    });

    this.add_wf_preds_for_projection_args(data.args);
  }

  /// Pushes the obligations required for an inherent alias to be WF
  /// into `self.out`.
  // FIXME(inherent_associated_types): Merge this function with `fn compute_alias`.
  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:499 add_wf_preds_for_inherent_projection
  add_wf_preds_for_inherent_projection(data: AliasTermT): void {
    // An inherent projection is well-formed if
    //
    // (a) its predicates hold (*)
    // (b) its args are wf
    //
    // (*) The predicates of an inherent associated type include the
    //     predicates of the impl that it's contained in.

    // In an ideal world, there are no escaping bound vars here. However, WF is jank, and
    // sometimes there are. We can only `compute_inherent_assoc_term_args` if the Self ty in the
    // args has no escaping bound vars. If we already have impl format args, though,
    // `compute_inherent_assoc_term_args` is a no-op (and we have no Self type), so no need to
    // check for escaping bound vars.
    const can_compute_impl_args = data.kind.$ === "InherentConstImpl" || !TypeVisitableExt.has_escaping_bound_vars(AliasTerm.self_ty(data), fold_Ty);

    if (can_compute_impl_args) {
      // FIXME(inherent_associated_types): Should this happen inside of a snapshot?
      // FIXME(inherent_associated_types): This is incompatible with the new solver and lazy norm!
      const args = compute_inherent_assoc_term_args(
        pending_SelectionContext_new(this.infcx),
        this.param_env,
        data,
        this.cause({ $: "WellFormed", _0: WellFormedLoc.None }),
        this.recursion_depth,
        this.out,
      );
      const def_id = AliasTerm.expect_inherent_def_id(data);
      this.nominal_obligations(def_id, args, (this_, obligation) => {
        this_.out.push(obligation);
      });
    }

    fold_GenericArgs.visit_with(data.args, this);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:535 add_wf_preds_for_projection_args
  add_wf_preds_for_projection_args(args: GenericArgs): void {
    const tcx = this.tcx();
    const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
    const param_env = this.param_env;
    const depth = this.recursion_depth;

    for (const arg of args) {
      const term = GenericArg.as_term(arg);
      if (term === undefined) continue;
      if (TypeVisitableExt.has_escaping_bound_vars(term, fold_Term)) continue;
      this.out.push(
        Obligation.with_depth(tcx, clone_ObligationCause(cause), depth, param_env, { $: "WellFormed", _0: term } satisfies ClauseKind, Predicate_upcast_from_ClauseKind),
      );
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:557 require_sized
  require_sized(subty: Ty, cause_: ObligationCauseCode): void {
    if (!TypeVisitableExt.has_escaping_bound_vars(subty, fold_Ty)) {
      const cause = this.cause(cause_);
      const trait_ref = TraitRef.new(as_interner(this.tcx()), this.tcx().require_lang_item(LangItem.Sized, cause.span), [GenericArg.from_Ty(subty)]);
      this.out.push(Obligation.with_depth(this.tcx(), cause, this.recursion_depth, this.param_env, Binder.dummy(trait_ref, d_TraitRef), Predicate_upcast_from_PolyTraitRef));
    }
  }

  /// Pushes all the predicates needed to validate that `term` is WF into `out`.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:577 add_wf_preds_for_term
  add_wf_preds_for_term(term: Term): void {
    fold_Term.visit_with(term, this);
    // debug!(?self.out);
  }

  // #[instrument(level = "debug", skip(self, push_obligation))]
  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:583 nominal_obligations
  nominal_obligations(def_id: DefId, args: GenericArgs, push_obligation: (this_: WfPredicates, obligation: PredicateObligation) => void): void {
    // PERF: `Sized`'s predicates include `MetaSized`, but both are compiler implemented marker
    // traits, so `MetaSized` will always be WF if `Sized` is WF and vice-versa. Determining
    // the nominal obligations of `Sized` would in-effect just elaborate `MetaSized` and make
    // the compiler do a bunch of work needlessly.
    if (this.tcx().is_lang_item(def_id, LangItem.Sized)) {
      return;
    }
    if (this.tcx().is_lang_item(def_id, LangItem.ConstParamTy) && this.tcx().features().const_param_ty_unchecked()) {
      return;
    }

    const tcx = this.tcx();
    let head: [DefId, GenericClauses] = [def_id, tcx.clauses_of(def_id) as GenericClauses];
    const inner_levels: [DefId, GenericClauses][] = []; // only allocates if a parent chain exists
    for (;;) {
      const parent = head[1].parent;
      if (parent === undefined) break;
      inner_levels.push(head);
      head = [parent, tcx.clauses_of(parent) as GenericClauses];
    }

    // Emit outermost first, as diagnostics rely on that order.
    for (const [origin_def_id, clauses] of [head, ...[...inner_levels].reverse()]) {
      for (const [clause, span] of GenericClauses.instantiate_own(clauses, tcx, args)) {
        if (!TypeVisitableExt.has_escaping_bound_vars(clause, d_Unnormalized_Clause)) {
          const code: ObligationCauseCode = { $: "WhereClause", _0: origin_def_id, _1: span };
          const cause = this.cause(code);
          const obligation = Obligation.with_depth(tcx, cause, this.recursion_depth, this.param_env, Unnormalized.skip_norm_wip(clause), Predicate_upcast_from_Clause);
          push_obligation(this, obligation);
        }
      }
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:629 add_wf_preds_for_dyn_ty
  add_wf_preds_for_dyn_ty(ty: Ty, data: List<PolyExistentialPredicateT>, region: Region): void {
    // Imagine a type like this:
    //
    //     trait Foo { }
    //     trait Bar<'c> : 'c { }
    //
    //     &'b (Foo+'c+Bar<'d>)
    //         ^
    //
    // In this case, the following relationships must hold:
    //
    //     'b <= 'c
    //     'd <= 'c
    //
    // The first conditions is due to the normal region pointer
    // rules, which say that a reference cannot outlive its
    // referent.
    //
    // The final condition may be a bit surprising. In particular,
    // you may expect that it would have been `'c <= 'd`, since
    // usually lifetimes of outer things are conservative
    // approximations for inner things. However, it works somewhat
    // differently with trait objects: here the idea is that if the
    // user specifies a region bound (`'c`, in this case) it is the
    // "master bound" that *implies* that bounds from other traits are
    // all met. (Remember that *all bounds* in a type like
    // `Foo+Bar+Zed` must be met, not just one, hence if we write
    // `Foo<'x>+Bar<'y>`, we know that the type outlives *both* 'x and
    // 'y.)
    //
    // Note: in fact we only permit builtin traits, not `Bar<'d>`, I
    // am looking forward to the future here.
    if (!TypeVisitableExt.has_escaping_bound_vars(data, fold_BoundExistentialPredicates) && !TypeVisitableExt.has_escaping_bound_vars(region, fold_Region)) {
      const implicit_bounds = object_region_bounds(this.tcx(), data);

      const explicit_bound = region;

      // self.out.reserve(implicit_bounds.len());
      for (const implicit_bound of implicit_bounds) {
        const cause = this.cause({ $: "ObjectTypeBound", _0: ty, _1: explicit_bound });
        const outlives = Binder.dummy<OutlivesClause<Region>>({ _0: explicit_bound, _1: implicit_bound }, d_RegionOutlivesClause);
        this.out.push(Obligation.with_depth(this.tcx(), cause, this.recursion_depth, this.param_env, outlives, Predicate_upcast_from_PolyRegionOutlivesClause));
      }

      // We don't add any wf predicates corresponding to the trait ref's generic arguments
      // which allows code like this to compile:
      // ```rust
      // trait Trait<T: Sized> {}
      // fn foo(_: &dyn Trait<[u32]>) {}
      // ```
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:694 add_wf_preds_for_pat_ty
  add_wf_preds_for_pat_ty(base_ty: Ty, pat: Pattern): void {
    const tcx = this.tcx();
    const p = Pattern_deref(pat);
    switch (p.$) {
      case "Range": {
        const { start, end } = p;
        const check = (c: Const): void => {
          const cause = this.cause(ObligationCauseCode.Misc);
          this.out.push(
            Obligation.with_depth(
              tcx,
              clone_ObligationCause(cause),
              this.recursion_depth,
              this.param_env,
              Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "ConstArgHasType", _0: c, _1: base_ty } }, d_PredicateKind),
              Predicate_upcast_from_Binder_PredicateKind,
            ),
          );
          if (!tcx.features().generic_pattern_types()) {
            if (TypeVisitableExt.has_param(c, fold_Const)) {
              if (Span.is_dummy(this.span)) {
                this.tcx().dcx().delayed_bug("feature error should be reported elsewhere, too");
              } else {
                feature_err(this.tcx().sess, sym.generic_pattern_types, this.span, "wraparound pattern type ranges cause monomorphization time errors").emit();
              }
            }
          }
        };
        check(start);
        check(end);
        break;
      }
      case "NotNull":
        break;
      case "Or": {
        const patterns = p._0;
        for (const pat of patterns) {
          this.add_wf_preds_for_pat_ty(base_ty, pat);
        }
        break;
      }
    }
  }

  // ---- impl<'a, 'tcx> TypeVisitor<TyCtxt<'tcx>> for WfPredicates<'a, 'tcx> ----

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:741 visit_ty
  visit_ty(t: Ty): undefined {
    // debug!("wf bounds for t={:?} t.kind={:#?}", t, t.kind());

    if (!this.visited_tys.insert(t)) {
      return;
    }

    const tcx = this.tcx();

    const k = t.kind();
    switch (k.$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Error":
      case "Str":
      case "CoroutineWitness":
      case "Never":
      case "Param":
      case "Bound":
      case "Placeholder":
      case "Foreign": {
        // WfScalar, WfParameter, etc
        break;
      }

      case "Slice": {
        const subty = k._0;
        this.require_sized(subty, ObligationCauseCode.SliceOrArrayElem);
        break;
      }

      case "Array": {
        const subty = k._0;
        const len = k._1;
        this.require_sized(subty, ObligationCauseCode.SliceOrArrayElem);
        // Note that the len being WF is implicitly checked while visiting.
        // Here we just check that it's of type usize.
        const cause = this.cause({ $: "ArrayLen", _0: t });
        this.out.push(
          Obligation.with_depth(
            tcx,
            cause,
            this.recursion_depth,
            this.param_env,
            Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "ConstArgHasType", _0: len, _1: tcx.types.usize } }, d_PredicateKind),
            Predicate_upcast_from_Binder_PredicateKind,
          ),
        );
        break;
      }

      case "Pat": {
        const base_ty = k._0;
        const pat = k._1;
        this.require_sized(base_ty, ObligationCauseCode.Misc);
        this.add_wf_preds_for_pat_ty(base_ty, pat);
        break;
      }

      case "Tuple": {
        const tys = k._0;
        if (tys.length > 0) {
          const last = tys[tys.length - 1]!;
          const rest = tys.slice(0, tys.length - 1);
          for (const elem of rest) {
            this.require_sized(elem, ObligationCauseCode.TupleElem);
            if (elem.is_scalable_vector() && !Span.is_dummy(this.span)) {
              this.tcx().dcx().struct_span_err(this.span, "scalable vectors cannot be tuple fields").emit();
            }
          }

          if (last.is_scalable_vector() && !Span.is_dummy(this.span)) {
            this.tcx().dcx().struct_span_err(this.span, "scalable vectors cannot be tuple fields").emit();
          }
        }
        break;
      }

      case "RawPtr": {
        // Simple cases that are WF if their type args are WF.
        break;
      }

      case "Alias": {
        const data = k._1;
        const kind = data.kind;
        if (kind.$ === "Projection" || kind.$ === "Opaque" || kind.$ === "Free") {
          const def_id = kind.def_id;
          const args = data.args;
          this.nominal_obligations(def_id, args, (this_, obligation) => {
            this_.out.push(obligation);
          });
        } else {
          this.add_wf_preds_for_inherent_projection(AliasTerm.from_AliasTy(data));
          return; // Subtree handled by compute_inherent_projection.
        }
        break;
      }

      case "Adt": {
        const def = k._0;
        const args = k._1;
        // WfNominalType
        this.nominal_obligations(def.did(), args, (this_, obligation) => {
          this_.out.push(obligation);
        });
        break;
      }

      case "FnDef": {
        const did = k._0;
        const args = Binder_no_bound_vars_unwrap(k._1);
        // HACK: Check the return type of function definitions for
        // well-formedness to mostly fix #84533. This is still not
        // perfect and there may be ways to abuse the fact that we
        // ignore requirements with escaping bound vars. That's a
        // more general issue however.
        const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(did) as EarlyBinder<PolyFnSigT>, tcx, args, d_PolyFnSig));
        fold_Ty.visit_with(Binder.skip_binder(PolyFnSig.output(fn_sig)), this);

        this.nominal_obligations(did, args, (this_, obligation) => {
          this_.out.push(obligation);
        });
        break;
      }

      case "Ref": {
        const r = k._0;
        const rty = k._1;
        // WfReference
        if (!TypeVisitableExt.has_escaping_bound_vars(r, fold_Region) && !TypeVisitableExt.has_escaping_bound_vars(rty, fold_Ty)) {
          const cause = this.cause({ $: "ReferenceOutlivesReferent", _0: t });
          this.out.push(
            Obligation.with_depth(
              tcx,
              cause,
              this.recursion_depth,
              this.param_env,
              Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "TypeOutlives", _0: { _0: rty, _1: r } } }, d_PredicateKind),
              Predicate_upcast_from_Binder_PredicateKind,
            ),
          );
        }
        break;
      }

      case "Coroutine": {
        const did = k._0;
        const args = k._1;
        // Walk ALL the types in the coroutine: this will
        // include the upvar types as well as the yield
        // type. Note that this is mildly distinct from
        // the closure case, where we have to be careful
        // about the signature of the closure. We don't
        // have the problem of implied bounds here since
        // coroutines don't take arguments.
        this.nominal_obligations(did, args, (this_, obligation) => {
          this_.out.push(obligation);
        });
        break;
      }

      case "Closure": {
        const did = k._0;
        const args = k._1;
        // Note that we cannot skip the generic types
        // types. Normally, within the fn
        // body where they are created, the generics will
        // always be WF, and outside of that fn body we
        // are not directly inspecting closure types
        // anyway, except via auto trait matching (which
        // only inspects the upvar types).
        // But when a closure is part of a type-alias-impl-trait
        // then the function that created the defining site may
        // have had more bounds available than the type alias
        // specifies. This may cause us to have a closure in the
        // hidden type that is not actually well formed and
        // can cause compiler crashes when the user abuses unsafe
        // code to procure such a closure.
        // See tests/ui/type-alias-impl-trait/wf_check_closures.rs
        this.nominal_obligations(did, args, (this_, obligation) => {
          this_.out.push(obligation);
        });
        // Only check the upvar types for WF, not the rest
        // of the types within. This is needed because we
        // capture the signature and it may not be WF
        // without the implied bounds. Consider a closure
        // like `|x: &'a T|` -- it may be that `T: 'a` is
        // not known to hold in the creator's context (and
        // indeed the closure may not be invoked by its
        // creator, but rather turned to someone who *can*
        // verify that).
        //
        // The special treatment of closures here really
        // ought not to be necessary either; the problem
        // is related to #25860 -- there is no way for us
        // to express a fn type complete with the implied
        // bounds that it is assuming. I think in reality
        // the WF rules around fn are a bit messed up, and
        // that is the rot problem: `fn(&'a T)` should
        // probably always be WF, because it should be
        // shorthand for something like `where(T: 'a) {
        // fn(&'a T) }`, as discussed in #25860.
        const upvars = ClosureArgs.tupled_upvars_ty(args.as_closure());
        return fold_Ty.visit_with(upvars, this);
      }

      case "CoroutineClosure": {
        const did = k._0;
        const args = k._1;
        // See the above comments. The same apply to coroutine-closures.
        this.nominal_obligations(did, args, (this_, obligation) => {
          this_.out.push(obligation);
        });
        const upvars = CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure());
        return fold_Ty.visit_with(upvars, this);
      }

      case "FnPtr": {
        // Let the visitor iterate into the argument/return
        // types appearing in the fn signature.
        break;
      }
      case "UnsafeBinder": {
        const ty = UnsafeBinderInner_deref(k._0);
        // FIXME(unsafe_binders): For now, we have no way to express
        // that a type must be `ManuallyDrop` OR `Copy` (or a pointer).
        if (!TypeVisitableExt.has_escaping_bound_vars(ty, fold_Binder(fold_Ty))) {
          this.out.push(
            Obligation.new(
              this.tcx(),
              this.cause(ObligationCauseCode.Misc),
              this.param_env,
              Binder.map_bound(ty, (ty) => TraitRef.new(as_interner(this.tcx()), this.tcx().require_lang_item(LangItem.BikeshedGuaranteedNoDrop, this.span), [GenericArg.from_Ty(ty)])),
              Predicate_upcast_from_PolyTraitRef,
            ),
          );
        }

        // We recurse into the binder below.
        break;
      }

      case "Dynamic": {
        const data = k._0;
        const r = k._1;
        // WfObject
        //
        // Here, we defer WF checking due to higher-ranked
        // regions. This is perhaps not ideal.
        this.add_wf_preds_for_dyn_ty(t, data, r);

        // FIXME(#27579) RFC also considers adding trait
        // obligations that don't refer to Self and
        // checking those
        const principal = data.principal();
        if (principal !== undefined) {
          const principal_def_id = Binder.skip_binder(principal).def_id;
          this.out.push(
            Obligation.with_depth(
              tcx,
              this.cause({ $: "WellFormed", _0: WellFormedLoc.None }),
              this.recursion_depth,
              this.param_env,
              Binder.dummy<PredicateKind>({ $: "DynCompatible", _0: principal_def_id }, d_PredicateKind),
              Predicate_upcast_from_Binder_PredicateKind,
            ),
          );

          // For the most part we don't add wf predicates corresponding to
          // the trait ref's generic arguments which allows code like this
          // to compile:
          // ```rust
          // trait Trait<T: Sized> {}
          // fn foo(_: &dyn Trait<[u32]>) {}
          // ```
          //
          // However, we sometimes incidentally check that const arguments
          // have the correct type as a side effect of the anon const
          // desugaring. To make this "consistent" for users we explicitly
          // check `ConstArgHasType` clauses so that const args that don't
          // go through an anon const still have their types checked.
          //
          // See also: https://rustc-dev-guide.rust-lang.org/const-generics.html
          const args = ExistentialTraitRef.with_self_ty(Binder.skip_binder(principal), as_interner(this.tcx()), t).args;
          this.nominal_obligations(principal_def_id, args, (this_, obligation) => {
            const kind: PredicateKind = Binder.skip_binder(obligation.predicate.kind());
            let keep: boolean;
            if (kind.$ === "Clause" && kind._0.$ === "ConstArgHasType" && (kind._0._0.kind().$ === "Param" || kind._0._0.kind().$ === "Placeholder")) {
              // ConstArgHasType clauses are not higher kinded. Assert as
              // such so we can fix this up if that ever changes.
              assert(Binder.bound_vars(obligation.predicate.kind()).length === 0, "assertion failed: obligation.predicate.kind().bound_vars().is_empty()");
              // In stable rust, variables from the trait object binder
              // cannot be referenced by a ConstArgHasType clause. However,
              // under `generic_const_parameter_types`, it can. Ignore those
              // predicates for now, to not have HKT-ConstArgHasTypes.
              keep = !TypeVisitableExt.has_escaping_bound_vars(kind, d_PredicateKind);
            } else {
              keep = false;
            }
            if (keep) {
              this_.out.push(obligation);
            }
          });
        }

        if (!TypeVisitableExt.has_escaping_bound_vars(t, fold_Ty)) {
          for (const projection of data.projection_bounds()) {
            const pred_binder = Binder.transpose(
              Binder.map_bound(PolyExistentialProjection.with_self_ty(projection, tcx, t), (p): PredicateKind | undefined => {
                const ct = Term.as_const(p.term);
                if (ct === undefined) return undefined;
                const assoc_const_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(ProjectionClause.def_id(p)) as EarlyBinder<Ty>, tcx, p.projection_term.args, fold_Ty));
                return { $: "Clause", _0: { $: "ConstArgHasType", _0: ct, _1: assoc_const_ty } };
              }),
            );
            if (pred_binder !== undefined) {
              this.out.push(
                Obligation.with_depth(
                  tcx,
                  this.cause({ $: "WellFormed", _0: WellFormedLoc.None }),
                  this.recursion_depth,
                  this.param_env,
                  pred_binder,
                  Predicate_upcast_from_Binder_PredicateKind,
                ),
              );
            }
          }
        }
        break;
      }

      // Inference variables are the complicated case, since we don't
      // know what type they are. We do two things:
      //
      // 1. Check if they have been resolved, and if so proceed with
      //    THAT type.
      // 2. If not, we've at least simplified things (e.g., we went
      //    from `Vec?0>: WF` to `?0: WF`), so we can
      //    register a pending obligation and keep
      //    moving. (Goal is that an "inductive hypothesis"
      //    is satisfied to ensure termination.)
      // See also the comment on `fn obligations`, describing cycle
      // prevention, which happens before this can be reached.
      // PORT: the arms `ty::Infer(ty::IntVar(_)) => {}` and `ty::Infer(ty::FloatVar(_)) => {}` (upstream after the
      // scalar arms) are the first two checks of this `Infer` case; the patterns are disjoint, so the order is kept.
      case "Infer": {
        // Can only infer to `ty::Int(_) | ty::Uint(_)`.
        if (k._0.$ === "IntVar") break;
        // Can only infer to `ty::Float(_)`.
        if (k._0.$ === "FloatVar") break;

        const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
        this.out.push(
          Obligation.with_depth(
            tcx,
            cause,
            this.recursion_depth,
            this.param_env,
            Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "WellFormed", _0: Term.from_Ty(t) } }, d_PredicateKind),
            Predicate_upcast_from_Binder_PredicateKind,
          ),
        );
        break;
      }
    }

    return fold_Ty.super_visit_with(t, this);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:1088 visit_const
  visit_const(c: Const): undefined {
    const tcx = this.tcx();

    const k = c.kind();
    switch (k.$) {
      case "Alias": {
        const alias_const = k._1;
        if (!TypeVisitableExt.has_escaping_bound_vars(c, fold_Const)) {
          // Skip type consts as mGCA doesn't support evaluatable clauses
          if (!AliasConstKind.is_direct_const(alias_const.kind, as_interner(tcx)) && !tcx.features().gca_const_items()) {
            const predicate = Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "ConstEvaluatable", _0: c } }, d_PredicateKind);
            const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
            this.out.push(Obligation.with_depth(tcx, cause, this.recursion_depth, this.param_env, predicate, Predicate_upcast_from_Binder_PredicateKind));
          }

          const kind = alias_const.kind;
          switch (kind.$) {
            case "InherentSelf": {
              this.add_wf_preds_for_inherent_projection(AliasTerm.from_AliasConst(alias_const));
              return; // Subtree is handled by above function
            }
            // FIXME: This should be unreachable but isn't because we normalize in item
            // wfck before computing wf requirements
            case "InherentImpl": {
              this.add_wf_preds_for_inherent_projection(AliasTerm.from_AliasConst(alias_const));
              return;
            }
            case "Projection":
            case "Free":
            case "Anon": {
              const def_id = kind.def_id;
              this.nominal_obligations(def_id, alias_const.args, (this_, obligation) => {
                this_.out.push(obligation);
              });
              break;
            }
          }
        }
        break;
      }
      case "Infer": {
        const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });

        this.out.push(
          Obligation.with_depth(
            tcx,
            cause,
            this.recursion_depth,
            this.param_env,
            Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "WellFormed", _0: Term.from_Const(c) } }, d_PredicateKind),
            Predicate_upcast_from_Binder_PredicateKind,
          ),
        );
        break;
      }
      case "Expr": {
        // FIXME(generic_const_exprs): this doesn't verify that given `Expr(N + 1)` the
        // trait bound `typeof(N): Add<typeof(1)>` holds. This is currently unnecessary
        // as `ConstKind::Expr` is only produced via normalization of `ConstKind::Alias`
        // which means that the `DefId` would have been typeck'd elsewhere. However in
        // the future we may allow directly lowering to `ConstKind::Expr` in which case
        // we would not be proving bounds we should.

        const predicate = Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "ConstEvaluatable", _0: c } }, d_PredicateKind);
        const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
        this.out.push(Obligation.with_depth(tcx, cause, this.recursion_depth, this.param_env, predicate, Predicate_upcast_from_Binder_PredicateKind));
        break;
      }

      case "Error":
      case "Param":
      case "Bound":
      case "Placeholder": {
        // These variants are trivially WF, so nothing to do here.
        break;
      }
      case "Value": {
        const val = k._0;
        // FIXME(mgca): no need to feature-gate once valtree lifetimes are not erased
        if (tcx.features().gca()) {
          const vk = val.ty.kind();
          switch (vk.$) {
            case "Adt": {
              const adt_def = vk._0;
              const args = vk._1;
              const adt_val = Value.destructure_adt_const(val);
              const variant_def = adt_def.variant(adt_val.variant);
              const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
              const n = Math.min(variant_def.fields.length, adt_val.fields.length);
              for (let i = 0; i < n; i++) {
                const field_def = variant_def.fields[i]!;
                const field_val = adt_val.fields[i]!;
                const field_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(field_def.did) as EarlyBinder<Ty>, tcx, args, fold_Ty));
                const predicate: PredicateKind = { $: "Clause", _0: { $: "ConstArgHasType", _0: field_val, _1: field_ty } };
                this.out.push(Obligation.with_depth(tcx, clone_ObligationCause(cause), this.recursion_depth, this.param_env, predicate, Predicate_upcast_from_PredicateKind));
              }
              break;
            }
            case "Tuple": {
              const field_tys = vk._0;
              const field_vals = Value.to_branch(val);
              const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });
              const n = Math.min(field_tys.length, field_vals.length);
              for (let i = 0; i < n; i++) {
                const field_ty = field_tys[i]!;
                const field_val = field_vals[i]!;
                const predicate: PredicateKind = { $: "Clause", _0: { $: "ConstArgHasType", _0: field_val, _1: field_ty } };
                this.out.push(Obligation.with_depth(tcx, clone_ObligationCause(cause), this.recursion_depth, this.param_env, predicate, Predicate_upcast_from_PredicateKind));
              }
              break;
            }
            case "Array": {
              const elem_ty = vk._0;
              const elem_vals = Value.to_branch(val);
              const cause = this.cause({ $: "WellFormed", _0: WellFormedLoc.None });

              for (const elem_val of elem_vals) {
                const predicate: PredicateKind = { $: "Clause", _0: { $: "ConstArgHasType", _0: elem_val, _1: elem_ty } };
                this.out.push(Obligation.with_depth(tcx, clone_ObligationCause(cause), this.recursion_depth, this.param_env, predicate, Predicate_upcast_from_PredicateKind));
              }
              break;
            }
            default:
              break;
          }
        }

        // FIXME: Enforce that values are structurally-matchable.
        break;
      }
    }

    return fold_Const.super_visit_with(c, this);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/wf.rs:1249 visit_predicate
  visit_predicate<P>(_p: P, _d: PredicateProxy<P>): undefined {
    return bug("predicate should not be checked for well-formedness");
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
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

/// Given an object type like `SomeTrait + Send`, computes the lifetime
/// bounds that must hold on the elided self type. These are derived
/// from the declarations of `SomeTrait`, `Send`, and friends -- if
/// they declare `trait SomeTrait : 'static`, for example, then
/// `'static` would appear in the list.
///
/// N.B., in some cases, particularly around higher-ranked bounds,
/// this function returns a kind of conservative approximation.
/// That is, all regions returned by this function are definitely
/// required, but there may be other region bounds that are not
/// returned, as well as requirements like `for<'a> T: 'a`.
///
/// Requires that trait definitions have been processed so that we can
/// elaborate predicates and walk supertraits.
// rustc: compiler/rustc_trait_selection/src/traits/wf.rs:1268 object_region_bounds
export function object_region_bounds(tcx: TyCtxt, existential_predicates: List<PolyExistentialPredicateT>): Region[] {
  const erased_self_ty = tcx.types.trait_object_dummy_self;

  const clauses = existential_predicates.map((predicate) => PolyExistentialPredicate.with_self_ty(predicate, tcx, erased_self_ty));

  const out: Region[] = [];
  for (const clause of elaborate(tcx, clauses, Elaboratable_Clause)) {
    // debug!(?clause);
    const k: ClauseKind = Binder.skip_binder(clause.kind());
    switch (k.$) {
      case "TypeOutlives": {
        const t = k._0._0;
        const r = k._0._1;
        // Search for a bound of the form `erased_self_ty
        // : 'a`, but be wary of something like `for<'a>
        // erased_self_ty : 'a` (we interpret a
        // higher-ranked bound like that as 'static,
        // though at present the code in `fulfill.rs`
        // considers such bounds to be unsatisfiable, so
        // it's kind of a moot point since you could never
        // construct such an object, but this seems
        // correct even if that code changes).
        if (t === erased_self_ty && !TypeVisitableExt.has_escaping_bound_vars(r, fold_Region)) {
          out.push(r);
        }
        break;
      }
      case "Trait":
      case "HostEffect":
      case "RegionOutlives":
      case "Projection":
      case "ConstArgHasType":
      case "WellFormed":
      case "UnstableFeature":
      case "ConstEvaluatable":
        break;
    }
  }
  return out;
}

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** `DelayedSet<Ty>::default()` (`Ty` is interned: identity keys). */
function DelayedSet_default(): DelayedSet<Ty> {
  return DelayedSet.default_<Ty>();
}

/** `impl UpcastFrom<TyCtxt, Predicate> for Predicate` (the reflexive impl, upcast.rs:21). */
function upcast_from_Predicate(from: Predicate, _tcx: Interner): Predicate {
  return from;
}

/** `ty::FnDef`'s args: `args.no_bound_vars().unwrap()`. */
function Binder_no_bound_vars_unwrap(b: Binder<GenericArgs>): GenericArgs {
  return unwrap(Binder.no_bound_vars(b, fold_GenericArgs));
}

/** PORT: stand-in for `Deref for Pattern` (`*pat`, the interned `PatternKind`; rustc_middle ty/pattern.rs is not ported
 *  yet, as rustc_middle structural_impls.ts's `Pattern_deref`). */
function Pattern_deref(_pat: Pattern): PatternKind {
  return unported("rustc_middle::ty::Pattern: Deref (ty/pattern.rs not ported yet)");
}

// ---- stand-ins for the old solver's project.rs (wave 20); each stops as UNPORTED -------------------------------

/** `traits::project::compute_inherent_assoc_term_args` (traits/project.rs, wave 20). */
function compute_inherent_assoc_term_args(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _alias_term: AliasTermT,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): GenericArgs {
  return unported("rustc_trait_selection::traits::project::compute_inherent_assoc_term_args");
}
