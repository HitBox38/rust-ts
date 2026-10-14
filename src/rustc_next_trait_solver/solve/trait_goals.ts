//! Dealing with trait goals, i.e. `T: Trait<'a, U>`.
//
// Port of compiler/rustc_next_trait_solver/src/solve/trait_goals.rs (lane nts-trait-goals; contract by lane
// evalctxt-contract). `impl<D, I> assembly::GoalKind<D> for TraitClause<I>` is the table `GoalKind_TraitClause`
// (assembly/mod.ts header); the provided methods it does not override forward to `GoalKind_provided`. The nested fn
// `trait_def_id_matches` of `fast_reject_assumption` is ported inside it. The `EvalCtxt` methods are declared in
// ../decls.ts (`// solve/trait_goals.rs:<line>`) and assigned onto `EvalCtxt.prototype` below, in upstream order.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): its top-level code touches only `EvalCtxt`
// (decls.ts) and other crates; every other rustc_next_trait_solver export is read inside fn bodies only.
//
// PORT (D3): `cx: I` is `TyCtxt` (decls.ts header). `Interner` methods are called through rustc_type_ir predicate.ts's
// `as_interner` cast (TyCtxt does not structurally satisfy `Interner` yet; nts-eval decision 5), and the `UpcastFrom`
// impls written over `TyCtxt` are cast for `Goal::new` / `Goal::with` (`upcast_tcx`, as nts-eval). Every `I::*Id` is
// `DefId`: `.into()` between them is the identity; `==` on them is `DefId_eq`.
// PORT: `Err(NoSolution.into())` is `Err(NoSolution_into)` (`impl From<NoSolution> for NoSolutionOrRerunNonErased`);
// `?` on a `Result<_, NoSolution>` / `Result<_, RerunNonErased>` inside a fn returning `NoSolutionOrRerunNonErased`
// converts with `NoSolutionOrRerunNonErased.from_NoSolution` / `.from_RerunNonErased`.
// PORT: lazy iterator chains passed to `add_goals` / `probe_and_consider_implied_clause` (`impl IntoIterator`) are
// generators, so they are consumed in the same order and as lazily as upstream.
// PORT: `#[instrument]`, `debug!`, `trace!` (tracing) produce no output in the oracle: kept as comments.
// `debug_assert!` is a comment (release oracle).
import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef, BoundExistentialPredicates, Clause, GenericArgs, Predicate } from "../../rustc_middle/ty/decls.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import {
  Clause_upcast_from_PolyTraitClause,
  Clause_upcast_from_TraitRef,
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_RegionOutlivesClause,
  Predicate_upcast_from_TraitClause,
  Predicate_upcast_from_TraitRef,
  Predicate_upcast_from_TypeOutlivesClause,
} from "../../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { ExternalConstraints_deref } from "../../rustc_middle/traits/solve.ts";
import { type DefId, DefId_eq, DefIdSet } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { AliasTy, ExistentialPredicate, ExistentialProjection, ExistentialTraitRef, OutlivesClause } from "../../rustc_type_ir/decls.ts";
import { supertraits } from "../../rustc_type_ir/elaborate.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import { fold_tuple2, fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Clause_provided, GenericArg_provided, GenericArgs_provided, SliceLike_provided, Ty_provided } from "../../rustc_type_ir/inherent.ts";
import { debug_MayBeErased, debug_TypingMode, TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { display_TraitClause } from "../../rustc_type_ir/ir_print.ts";
import type { SolverTraitLangItem } from "../../rustc_type_ir/lang_items.ts";
import { ClosureKind } from "../../rustc_type_ir/lib.ts";
import {
  as_interner,
  type ClausePolarity,
  ExistentialTraitRef as ExistentialTraitRefC,
  fold_with_TraitClause,
  PolyExistentialPredicate,
  PolyExistentialProjection,
  PolyExistentialTraitRef,
  PolyTraitClause,
  TraitClause,
  TraitRef,
  try_fold_with_TraitClause,
  visit_with_TraitClause,
} from "../../rustc_type_ir/predicate.ts";
import { relate_ExistentialProjection, relate_ExistentialTraitRef, relate_TraitRef, relate_Ty } from "../../rustc_type_ir/relate.ts";
import type { CandidateHeadUsages } from "../../rustc_type_ir/search_graph/mod.ts";
import { ProbeKind } from "../../rustc_type_ir/solve/inspect.ts";
import {
  AccessedOpaques,
  type BuiltinImplSource,
  type CandidateSource,
  CandidatePreferenceMode,
  type CanonicalResponse,
  Certainty,
  Goal,
  type GoalSource,
  MaybeInfo,
  type NoSolution,
  NoSolutionOrRerunNonErased,
  type QueryResultOrRerunNonErased,
  RerunResultExt_for_Result,
  type RerunNonErased,
  Response,
  type SizedTraitKind,
  visit_with_Goal,
} from "../../rustc_type_ir/solve/mod.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { CoroutineArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import type { UpcastFrom } from "../../rustc_type_ir/upcast.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { EvalCtxt } from "../decls.ts";
import { AllowInferenceConstraints, type AssembleCandidatesFrom, type Candidate, type FailedCandidateInfo, type GoalKind, GoalKind_provided } from "./assembly/mod.ts";
import {
  type AsyncCallableRelevantTypes,
  extract_tupled_inputs_and_output_from_async_callable,
  extract_tupled_inputs_and_output_from_callable,
  fold_AsyncCallableRelevantTypes,
  instantiate_constituent_tys_for_auto_trait,
  instantiate_constituent_tys_for_copy_clone_trait,
  instantiate_constituent_tys_for_sizedness_trait,
} from "./assembly/structural_traits.ts";
import { has_only_region_constraints, type MergeCandidateInfo } from "./mod.ts";

// ---- module-local plumbing (no upstream counterpart) --------------------------------------------------------------

/** PORT: the value of the unit struct `NoSolution` (an empty object, as rustc_type_ir error.ts builds it). */
const NoSolution: NoSolution = Object.freeze({});
/** PORT: `NoSolution.into()` (`impl From<NoSolution> for NoSolutionOrRerunNonErased`). */
const NoSolution_into: NoSolutionOrRerunNonErased = Object.freeze({ $: "NoSolution", _0: NoSolution });

/** PORT (D3): an `UpcastFrom` impl written over `TyCtxt`, viewed as one over `Interner` (header; nts-eval). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): UpcastFrom<T, P>["upcast_from"] {
  return f as unknown as UpcastFrom<T, P>["upcast_from"];
}

/** PORT (D4): the `TypeFoldable` descriptor of `TraitClause` (generated derive fns). */
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};
/** PORT (D4): the `TypeVisitable` descriptor of `Goal<I, TraitClause<I>>` (generated derive fn). */
const d_Goal_TraitClause: TypeVisitable<Goal<TraitClause>> = {
  visit_with: (self, visitor) => visit_with_Goal(self, visitor, visit_with_TraitClause),
};

/**
 * PORT: `binder.iter_instantiated(cx, args)` over an `EarlyBinder<I, impl IntoIterator>` whose value is an `Iterable`
 * (the `Interner` returns `EarlyBinder<Iterable<Clause>>`, binder.ts's `iter_instantiated` takes a slice): the items are
 * collected first. The source iterators are pure, so this only changes when they are read.
 */
function iter_instantiated<T>(self: EarlyBinder<Iterable<T>>, cx: TyCtxt, args: GenericArgs, d: TypeFoldable<T>): Iterable<Unnormalized<T>> {
  return EarlyBinder.iter_instantiated(EarlyBinder.map_bound(self, (it) => Array.from(it)), cx, args, d);
}

/** PORT: `Iterator::map` (lazy). */
function* iter_map<T, U>(it: Iterable<T>, f: (x: T) => U): Generator<U> {
  for (const x of it) yield f(x);
}

/** PORT: `Vec::retain` (in place, order kept). */
function retain<T>(v: T[], f: (x: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    const x = v[r]!;
    if (f(x)) v[w++] = x;
  }
  v.length = w;
}

/** PORT: `Vec::extract_if(.., f).collect()`: removes the matching elements in order and returns them. */
function extract_if<T>(v: T[], f: (x: T) => boolean): T[] {
  const out: T[] = [];
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    const x = v[r]!;
    if (f(x)) out.push(x);
    else v[w++] = x;
  }
  v.length = w;
  return out;
}

/** The `(CanonicalResponse<I>, Option<TraitGoalProvenVia>)` result of the merge fns. */
type MergedResponse = [CanonicalResponse, TraitGoalProvenVia | undefined];

const BuiltinImplSource_Misc: BuiltinImplSource = { $: "Misc" };
const BuiltinImplSource_Trivial: BuiltinImplSource = { $: "Trivial" };

// ---- impl<D, I> assembly::GoalKind<D> for TraitClause<I> ----------------------------------------------------------

/** `impl<D, I> assembly::GoalKind<D> for TraitClause<I>` (header). */
export const GoalKind_TraitClause: GoalKind<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
  // PORT: derived `PartialEq` of a plain value over interned children: equal canonical keys (rust_ts/intern_key.ts).
  eq: (a, b) => intern_key(a) === intern_key(b),
  display: display_TraitClause,

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:36 self_ty
  self_ty(self: TraitClause): Ty {
    return TraitClause.self_ty(self);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:40 trait_ref
  trait_ref(self: TraitClause, _: TyCtxt): TraitRef {
    return self.trait_ref;
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:44 with_replaced_self_ty
  with_replaced_self_ty(self: TraitClause, cx: TyCtxt, self_ty: Ty): TraitClause {
    return TraitClause.with_replaced_self_ty(self, as_interner(cx), self_ty);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:48 trait_def_id
  trait_def_id(self: TraitClause, _: TyCtxt): DefId {
    return TraitClause.def_id(self);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:52 consider_additional_alias_assumptions
  consider_additional_alias_assumptions(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _alias_ty: AliasTy): Candidate[] {
    return [];
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:60 consider_impl_candidate
  consider_impl_candidate(
    ecx: EvalCtxt,
    goal: Goal<TraitClause>,
    goal_trait_ref: TraitRef,
    impl_def_id: DefId,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();

    const impl_trait_ref = as_interner(cx).impl_trait_ref(impl_def_id);
    if (
      !DeepRejectCtxt.relate_rigid_infer(as_interner(ecx.cx())).args_may_unify(
        goal_trait_ref.args,
        EarlyBinder.skip_binder(impl_trait_ref).args,
      )
    ) {
      return Err(NoSolution_into);
    }

    // For every `default impl`, there's always a non-default `impl` that will *also* apply.
    // There's no reason to register a candidate for this impl, since it is *not* proof that
    // the trait goal holds.
    if (as_interner(cx).impl_is_default(impl_def_id)) {
      return Err(NoSolution_into);
    }

    const impl_polarity = as_interner(cx).impl_polarity(impl_def_id);
    const goal_polarity: ClausePolarity = goal.predicate.polarity;
    if (
      // Impl matches polarity
      (impl_polarity === "Positive" && goal_polarity === "Positive") ||
      (impl_polarity === "Negative" && goal_polarity === "Negative")
    ) {
      // {}
    } else {
      // Impl doesn't match polarity
      // (ty::ImplPolarity::Positive, ty::ClausePolarity::Negative)
      // | (ty::ImplPolarity::Negative, ty::ClausePolarity::Positive)
      return Err(NoSolution_into);
    }

    if (TypingMode.is_reflection(ecx.typing_mode()) && !as_interner(cx).is_fully_generic_for_reflection(impl_def_id)) {
      return Err(NoSolution_into);
    }

    return ecx.probe_trait_candidate({ $: "Impl", _0: impl_def_id }).enter((ecx) => {
      const impl_args = ecx.fresh_args_for_item(impl_def_id);
      ecx.record_impl_args(impl_args);
      // PORT: upstream shadows `impl_trait_ref`; a JS `const` cannot read the binding it shadows (TDZ).
      const impl_trait_ref_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(impl_trait_ref, cx, impl_args, relate_TraitRef));

      const r0 = ecx.eq(goal.param_env, goal_trait_ref, impl_trait_ref_, relate_TraitRef);
      if (r0.$ === "Err") return r0;
      const where_clause_bounds = iter_map(
        iter_map(iter_instantiated(as_interner(cx).ir_clauses_of(impl_def_id), cx, impl_args, fold_Clause), Unnormalized.skip_norm_wip),
        (clause) => Goal.with(goal, as_interner(cx), clause, upcast_tcx(Predicate_upcast_from_Clause)),
      );
      const r1 = ecx.add_goals("ImplWhereBound", where_clause_bounds);
      if (r1.$ === "Err") return r1;

      // We currently elaborate all supertrait outlives obligations from impls.
      // This can be removed when we actually do coinduction correctly, and prove
      // all supertrait obligations unconditionally.
      const r2 = ecx.add_goals(
        "Misc",
        iter_map(
          iter_map(iter_instantiated(as_interner(cx).impl_super_outlives(impl_def_id), cx, impl_args, fold_Clause), Unnormalized.skip_norm_wip),
          (pred) => Goal.with(goal, as_interner(cx), pred, upcast_tcx(Predicate_upcast_from_Clause)),
        ),
      );
      if (r2.$ === "Err") return r2;

      return then(ecx);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:127 consider_error_guaranteed_candidate
  consider_error_guaranteed_candidate(
    ecx: EvalCtxt,
    _goal: Goal<TraitClause>,
    _guar: ErrorGuaranteed,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:136 fast_reject_assumption
  fast_reject_assumption(ecx: EvalCtxt, goal: Goal<TraitClause>, assumption: Clause): Result<undefined, NoSolution> {
    // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:141 trait_def_id_matches
    function trait_def_id_matches(cx: Interner, clause_def_id: DefId, goal_def_id: DefId, polarity: ClausePolarity): boolean {
      return (
        DefId_eq(clause_def_id, goal_def_id) ||
        // PERF(sized-hierarchy): Sizedness supertraits aren't elaborated to improve perf, so
        // check for a `MetaSized` supertrait being matched against a `Sized` assumption.
        //
        // `PointeeSized` bounds are syntactic sugar for a lack of bounds so don't need this.
        (polarity === "Positive" &&
          cx.is_trait_lang_item(clause_def_id, "Sized" satisfies SolverTraitLangItem) &&
          cx.is_trait_lang_item(goal_def_id, "MetaSized" satisfies SolverTraitLangItem))
      );
    }

    const trait_clause = Clause_provided.as_trait_clause(assumption);
    if (
      trait_clause !== undefined &&
      PolyTraitClause.polarity(trait_clause) === goal.predicate.polarity &&
      trait_def_id_matches(
        as_interner(ecx.cx()),
        PolyTraitClause.def_id(trait_clause),
        TraitClause.def_id(goal.predicate),
        goal.predicate.polarity,
      ) &&
      DeepRejectCtxt.relate_rigid_rigid(as_interner(ecx.cx())).args_may_unify(
        goal.predicate.trait_ref.args,
        Binder.skip_binder(trait_clause).trait_ref.args,
      )
    ) {
      return Ok(undefined);
    } else {
      return Err(NoSolution);
    }
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:176 match_assumption
  match_assumption(
    ecx: EvalCtxt,
    goal: Goal<TraitClause>,
    assumption: Clause,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): QueryResultOrRerunNonErased {
    const trait_clause = unwrap(Clause_provided.as_trait_clause(assumption));

    // PERF(sized-hierarchy): Sizedness supertraits aren't elaborated to improve perf, so
    // check for a `Sized` subtrait when looking for `MetaSized`. `PointeeSized` bounds
    // are syntactic sugar for a lack of bounds so don't need this.
    // We don't need to check polarity, `fast_reject_assumption` already rejected non-`Positive`
    // polarity `Sized` assumptions as matching non-`Positive` `MetaSized` goals.
    if (
      as_interner(ecx.cx()).is_trait_lang_item(TraitClause.def_id(goal.predicate), "MetaSized") &&
      as_interner(ecx.cx()).is_trait_lang_item(PolyTraitClause.def_id(trait_clause), "Sized")
    ) {
      const meta_sized_clause = trait_predicate_with_def_id(ecx.cx(), trait_clause, TraitClause.def_id(goal.predicate));
      return GoalKind_TraitClause.match_assumption(ecx, goal, meta_sized_clause, then);
    }

    const assumption_trait_pred = ecx.instantiate_binder_with_infer(trait_clause, d_TraitClause);
    const r = ecx.eq(goal.param_env, goal.predicate.trait_ref, assumption_trait_pred.trait_ref, relate_TraitRef);
    if (r.$ === "Err") return r;

    return then(ecx);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:203 consider_auto_trait_candidate
  consider_auto_trait_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const result = ecx.disqualify_auto_trait_candidate_due_to_possible_impl(goal);
    if (result !== undefined) {
      return result;
    }

    // Only consider auto impls of unsafe traits when there are no unsafe
    // fields.
    if (as_interner(cx).trait_is_unsafe(TraitClause.def_id(goal.predicate)) && TraitClause.self_ty(goal.predicate).has_unsafe_fields()) {
      return Err(NoSolution_into);
    }

    // We leak the implemented auto traits of opaques outside of their defining scope.
    // This depends on `typeck` of the defining scope of that opaque, which may result in
    // fatal query cycles.
    //
    // We only get to this point if we're outside of the defining scope as we'd otherwise
    // be able to normalize the opaque type. We may also cycle in case `typeck` of a defining
    // scope relies on the current context, e.g. either because it also leaks auto trait
    // bounds of opaques defined in the current context or by evaluating the current item.
    //
    // To avoid this we don't try to leak auto trait bounds if they can also be proven via
    // item bounds of the opaque. These bounds are always applicable as auto traits must not
    // have any generic parameters. They would also get preferred over the impl candidate
    // when merging candidates anyways.
    //
    // See tests/ui/impl-trait/auto-trait-leakage/avoid-query-cycle-via-item-bound.rs.
    const k = TraitClause.self_ty(goal.predicate).kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      // debug_assert!(is_rigid == ty::IsRigid::Yes);
      return ecx.consider_auto_trait_candidate_for_opaque_ty(goal, def_id, args);
    }

    // We need to make sure to stall any coroutines we are inferring to avoid query cycles.
    const cand = ecx.try_stall_coroutine(TraitClause.self_ty(goal.predicate));
    if (cand !== undefined) {
      return cand;
    }

    return ecx.probe_and_evaluate_goal_for_constituent_tys(
      { $: "BuiltinImpl", _0: BuiltinImplSource_Misc },
      goal,
      instantiate_constituent_tys_for_auto_trait,
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:258 consider_trait_alias_candidate
  consider_trait_alias_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const cx = ecx.cx();

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
      const nested_obligations = iter_map(
        iter_map(
          iter_instantiated(as_interner(cx).ir_clauses_of(TraitClause.def_id(goal.predicate)), cx, goal.predicate.trait_ref.args, fold_Clause),
          Unnormalized.skip_norm_wip,
        ),
        (c) => Goal.with(goal, as_interner(cx), c, upcast_tcx(Predicate_upcast_from_Clause)),
      );
      // While you could think of trait aliases to have a single builtin impl
      // which uses its implied trait bounds as where-clauses, using
      // `GoalSource::ImplWhereClause` here would be incorrect, as we also
      // impl them, which means we're "stepping out of the impl constructor"
      // again. To handle this, we treat these cycles as ambiguous for now.
      const r = ecx.add_goals("Misc", nested_obligations);
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:284 consider_builtin_sizedness_candidates
  consider_builtin_sizedness_candidates(
    ecx: EvalCtxt,
    goal: Goal<TraitClause>,
    sizedness: SizedTraitKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    return ecx.probe_and_evaluate_goal_for_constituent_tys({ $: "BuiltinImpl", _0: BuiltinImplSource_Trivial }, goal, (ecx, ty) =>
      instantiate_constituent_tys_for_sizedness_trait(ecx, sizedness, ty),
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:304 consider_builtin_copy_clone_candidate
  consider_builtin_copy_clone_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    // We need to make sure to stall any coroutines we are inferring to avoid query cycles.
    const cand = ecx.try_stall_coroutine(TraitClause.self_ty(goal.predicate));
    if (cand !== undefined) {
      return cand;
    }

    return ecx.probe_and_evaluate_goal_for_constituent_tys(
      { $: "BuiltinImpl", _0: BuiltinImplSource_Misc },
      goal,
      instantiate_constituent_tys_for_copy_clone_trait,
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:324 consider_builtin_fn_ptr_trait_candidate
  consider_builtin_fn_ptr_trait_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = TraitClause.self_ty(goal.predicate);
    switch (goal.predicate.polarity) {
      // impl FnPtr for FnPtr {}
      case "Positive": {
        if (Ty_provided.is_fn_ptr(self_ty)) {
          return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
            return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
          });
        } else {
          return Err(NoSolution_into);
        }
      }
      //  impl !FnPtr for T where T != FnPtr && T is rigid {}
      case "Negative": {
        // If a type is rigid and not a fn ptr, then we know for certain
        // that it does *not* implement `FnPtr`.
        if (!Ty_provided.is_fn_ptr(self_ty) && Ty_provided.is_known_rigid(self_ty)) {
          return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
            return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
          });
        } else {
          return Err(NoSolution_into);
        }
      }
    }
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:355 consider_builtin_fn_trait_candidates
  consider_builtin_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: Goal<TraitClause>,
    goal_kind: ClosureKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const cx = ecx.cx();
    const r = extract_tupled_inputs_and_output_from_callable(cx, TraitClause.self_ty(goal.predicate), goal_kind);
    if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(r._0));
    const tupled_inputs_and_output = r._0;
    if (tupled_inputs_and_output === undefined) {
      return ecx.forced_ambiguity(MaybeInfo.AMBIGUOUS);
    }
    const [inputs, output] = ecx.instantiate_binder_with_infer(tupled_inputs_and_output, fold_tuple2(fold_Ty, fold_Ty));

    // A built-in `Fn` impl only holds if the output is sized.
    // (FIXME: technically we only need to check this if the type is a fn ptr...)
    const output_is_sized_pred = TraitRef.new(as_interner(cx), as_interner(cx).require_trait_lang_item("Sized"), [output]);

    const pred = Clause_upcast_from_TraitRef(
      TraitRef.new(as_interner(cx), TraitClause.def_id(goal.predicate), [TraitClause.self_ty(goal.predicate), inputs]),
      cx,
    );
    return GoalKind_TraitClause.probe_and_consider_implied_clause(ecx, { $: "BuiltinImpl", _0: BuiltinImplSource_Misc }, goal, pred, [
      ["ImplWhereBound", Goal.with(goal, as_interner(cx), output_is_sized_pred, upcast_tcx(Predicate_upcast_from_TraitRef))],
    ]);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:393 consider_builtin_async_fn_trait_candidates
  consider_builtin_async_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: Goal<TraitClause>,
    goal_kind: ClosureKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const cx = ecx.cx();
    const r = extract_tupled_inputs_and_output_from_async_callable(
      cx,
      TraitClause.self_ty(goal.predicate),
      goal_kind,
      // This region doesn't matter because we're throwing away the coroutine type
      Region.new_static(cx),
    );
    if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(r._0));
    const [tupled_inputs_and_output_and_coroutine, nested_preds] = r._0;
    const { tupled_inputs_ty, output_coroutine_ty, coroutine_return_ty: _ }: AsyncCallableRelevantTypes = ecx.instantiate_binder_with_infer(
      tupled_inputs_and_output_and_coroutine,
      fold_AsyncCallableRelevantTypes,
    );

    // A built-in `AsyncFn` impl only holds if the output is sized.
    // (FIXME: technically we only need to check this if the type is a fn ptr...)
    const output_is_sized_pred = TraitRef.new(as_interner(cx), as_interner(cx).require_trait_lang_item("Sized"), [output_coroutine_ty]);

    const pred = Clause_upcast_from_TraitRef(
      TraitRef.new(as_interner(cx), TraitClause.def_id(goal.predicate), [TraitClause.self_ty(goal.predicate), tupled_inputs_ty]),
      cx,
    );
    // PORT: `[goal.with(cx, output_is_sized_pred)].into_iter().chain(nested_preds.into_iter().map(..)).map(..)` is a
    // generator (header).
    function* requirements(): Generator<[GoalSource, Goal<Predicate>]> {
      for (const g of [Goal.with(goal, as_interner(cx), output_is_sized_pred, upcast_tcx(Predicate_upcast_from_TraitRef))]) {
        yield ["ImplWhereBound", g];
      }
      for (const pred of nested_preds) {
        yield ["ImplWhereBound", Goal.with(goal, as_interner(cx), pred, upcast_from_self)];
      }
    }
    return GoalKind_TraitClause.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource_Misc },
      goal,
      pred,
      requirements(),
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:443 consider_builtin_async_fn_kind_helper_candidate
  consider_builtin_async_fn_kind_helper_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const args = goal.predicate.trait_ref.args;
    if (args.length !== 2) {
      return panic();
    }
    const [closure_fn_kind_ty, goal_kind_ty] = [args[0]!, args[1]!];

    const closure_kind = GenericArg_provided.expect_ty(closure_fn_kind_ty).to_opt_closure_kind();
    if (closure_kind === undefined) {
      // We don't need to worry about the self type being an infer var.
      return Err(NoSolution_into);
    }
    const goal_kind = unwrap(GenericArg_provided.expect_ty(goal_kind_ty).to_opt_closure_kind());
    if (ClosureKind.extends(closure_kind, goal_kind)) {
      return ecx
        .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
        .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
    } else {
      return Err(NoSolution_into);
    }
  },

  /// ```rust, ignore (not valid rust syntax)
  /// impl Tuple for () {}
  /// impl Tuple for (T1,) {}
  /// impl Tuple for (T1, T2) {}
  /// impl Tuple for (T1, .., Tn) {}
  /// ```
  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:470 consider_builtin_tuple_candidate
  consider_builtin_tuple_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    if (TraitClause.self_ty(goal.predicate).kind().$ === "Tuple") {
      return ecx
        .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
        .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
    } else {
      return Err(NoSolution_into);
    }
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:486 consider_builtin_pointee_candidate
  consider_builtin_pointee_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:498 consider_builtin_future_candidate
  consider_builtin_future_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const k = TraitClause.self_ty(goal.predicate).kind();
    if (k.$ !== "Coroutine") {
      return Err(NoSolution_into);
    }
    const def_id = k._0;

    // Coroutines are not futures unless they come from `async` desugaring
    const cx = ecx.cx();
    if (!as_interner(cx).coroutine_is_async(def_id)) {
      return Err(NoSolution_into);
    }

    // Async coroutine unconditionally implement `Future`
    // Technically, we need to check that the future output type is Sized,
    // but that's already proven by the coroutine being WF.
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:523 consider_builtin_iterator_candidate
  consider_builtin_iterator_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const k = TraitClause.self_ty(goal.predicate).kind();
    if (k.$ !== "Coroutine") {
      return Err(NoSolution_into);
    }
    const def_id = k._0;

    // Coroutines are not iterators unless they come from `gen` desugaring
    const cx = ecx.cx();
    if (!as_interner(cx).coroutine_is_gen(def_id)) {
      return Err(NoSolution_into);
    }

    // Gen coroutines unconditionally implement `Iterator`
    // Technically, we need to check that the iterator output type is Sized,
    // but that's already proven by the coroutines being WF.
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:548 consider_builtin_fused_iterator_candidate
  consider_builtin_fused_iterator_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const k = TraitClause.self_ty(goal.predicate).kind();
    if (k.$ !== "Coroutine") {
      return Err(NoSolution_into);
    }
    const def_id = k._0;

    // Coroutines are not iterators unless they come from `gen` desugaring
    const cx = ecx.cx();
    if (!as_interner(cx).coroutine_is_gen(def_id)) {
      return Err(NoSolution_into);
    }

    // Gen coroutines unconditionally implement `FusedIterator`.
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:571 consider_builtin_async_iterator_candidate
  consider_builtin_async_iterator_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const k = TraitClause.self_ty(goal.predicate).kind();
    if (k.$ !== "Coroutine") {
      return Err(NoSolution_into);
    }
    const def_id = k._0;

    // Coroutines are not iterators unless they come from `gen` desugaring
    const cx = ecx.cx();
    if (!as_interner(cx).coroutine_is_async_gen(def_id)) {
      return Err(NoSolution_into);
    }

    // Gen coroutines unconditionally implement `Iterator`
    // Technically, we need to check that the iterator output type is Sized,
    // but that's already proven by the coroutines being WF.
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:596 consider_builtin_coroutine_candidate
  consider_builtin_coroutine_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const self_ty = TraitClause.self_ty(goal.predicate);
    const k = self_ty.kind();
    if (k.$ !== "Coroutine") {
      return Err(NoSolution_into);
    }
    const def_id = k._0;
    const args = k._1;

    // `async`-desugared coroutines do not implement the coroutine trait
    const cx = ecx.cx();
    if (!as_interner(cx).is_general_coroutine(def_id)) {
      return Err(NoSolution_into);
    }

    const coroutine = GenericArgs_provided.as_coroutine(args);
    return GoalKind_TraitClause.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource_Misc },
      goal,
      Clause_upcast_from_TraitRef(
        TraitRef.new(as_interner(cx), TraitClause.def_id(goal.predicate), [self_ty, CoroutineArgs.resume_ty(coroutine)]),
        cx,
      ),
      // Technically, we need to check that the coroutine types are Sized,
      // but that's already proven by the coroutine being WF.
      [],
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:628 consider_builtin_discriminant_kind_candidate
  consider_builtin_discriminant_kind_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    // `DiscriminantKind` is automatically implemented for every type.
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:641 consider_builtin_destruct_candidate
  consider_builtin_destruct_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    // `Destruct` is automatically implemented for every type in
    // non-const environments.
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource_Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:655 consider_builtin_transmute_candidate
  consider_builtin_transmute_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    // `rustc_transmute` does not have support for type or const params
    if (TypeVisitableExt.has_non_region_placeholders(goal.predicate, d_TraitClause)) {
      return Err(NoSolution_into);
    }

    // Match the old solver by treating unresolved inference variables as
    // ambiguous until `rustc_transmute` can compute their layout.
    if (TypeVisitableExt.has_non_region_infer(goal, d_Goal_TraitClause)) {
      return ecx.forced_ambiguity(MaybeInfo.AMBIGUOUS);
    }

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx): QueryResultOrRerunNonErased => {
      const assume = ecx.structurally_normalize_const(goal.param_env, goal.predicate.trait_ref.args.const_at(2));
      if (assume.$ === "Err") return assume;

      const certainty = ecx.is_transmutable(
        goal.predicate.trait_ref.args.type_at(0),
        goal.predicate.trait_ref.args.type_at(1),
        assume._0,
      );
      if (certainty.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(certainty._0));
      return ecx.evaluate_added_goals_and_make_canonical_response(certainty._0);
    });
  },

  /// NOTE: This is implemented as a built-in goal and not a set of impls like:
  ///
  /// ```rust,ignore (illustrative)
  /// impl<T> BikeshedGuaranteedNoDrop for T where T: Copy {}
  /// impl<T> BikeshedGuaranteedNoDrop for ManuallyDrop<T> {}
  /// ```
  ///
  /// because these impls overlap, and I'd rather not build a coherence hack for
  /// this harmless overlap.
  ///
  /// This trait is indirectly exposed on stable, so do *not* extend the set of types that
  /// implement the trait without FCP!
  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:703 consider_builtin_bikeshed_guaranteed_no_drop_candidate
  consider_builtin_bikeshed_guaranteed_no_drop_candidate(
    ecx: EvalCtxt,
    goal: Goal<TraitClause>,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const cx = ecx.cx();
    return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
      const ty = TraitClause.self_ty(goal.predicate);
      const k = ty.kind();
      if (k.$ === "Ref") {
        // `&mut T` and `&T` always implement `BikeshedGuaranteedNoDrop`.
      } else if (k.$ === "Adt" && k._0.is_manually_drop()) {
        // `ManuallyDrop<T>` always implements `BikeshedGuaranteedNoDrop`.
      } else if (k.$ === "Tuple") {
        // Arrays and tuples implement `BikeshedGuaranteedNoDrop` only if
        // their constituent types implement `BikeshedGuaranteedNoDrop`.
        const tys = k._0;
        const r = ecx.add_goals(
          "ImplWhereBound",
          iter_map(tys, (elem_ty) =>
            Goal.with(
              goal,
              as_interner(cx),
              TraitRef.new(as_interner(cx), TraitClause.def_id(goal.predicate), [elem_ty]),
              upcast_tcx(Predicate_upcast_from_TraitRef),
            ),
          ),
        );
        if (r.$ === "Err") return r;
      } else if (k.$ === "Array") {
        const elem_ty = k._0;
        const r = ecx.add_goal(
          "ImplWhereBound",
          Goal.with(
            goal,
            as_interner(cx),
            TraitRef.new(as_interner(cx), TraitClause.def_id(goal.predicate), [elem_ty]),
            upcast_tcx(Predicate_upcast_from_TraitRef),
          ),
        );
        if (r.$ === "Err") return r;
      } else if (
        // All other types implement `BikeshedGuaranteedNoDrop` only if
        // they implement `Copy`. We could be smart here and short-circuit
        // some trivially `Copy`/`!Copy` types, but there's no benefit.
        k.$ === "FnDef" ||
        k.$ === "FnPtr" ||
        k.$ === "Error" ||
        k.$ === "Uint" ||
        k.$ === "Int" ||
        (k.$ === "Infer" && (k._0.$ === "IntVar" || k._0.$ === "FloatVar")) ||
        k.$ === "Bool" ||
        k.$ === "Float" ||
        k.$ === "Char" ||
        k.$ === "RawPtr" ||
        k.$ === "Never" ||
        k.$ === "Pat" ||
        k.$ === "Dynamic" ||
        k.$ === "Str" ||
        k.$ === "Slice" ||
        k.$ === "Foreign" ||
        k.$ === "Adt" ||
        k.$ === "Alias" ||
        k.$ === "Param" ||
        k.$ === "Placeholder" ||
        k.$ === "Closure" ||
        k.$ === "CoroutineClosure" ||
        k.$ === "Coroutine" ||
        k.$ === "UnsafeBinder" ||
        k.$ === "CoroutineWitness"
      ) {
        const r = ecx.add_goal(
          "ImplWhereBound",
          Goal.with(
            goal,
            as_interner(cx),
            TraitRef.new(as_interner(cx), as_interner(cx).require_trait_lang_item("Copy"), [ty]),
            upcast_tcx(Predicate_upcast_from_TraitRef),
          ),
        );
        if (r.$ === "Err") return r;
      } else {
        // ty::Bound(..)
        // | ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
        return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);
      }

      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  /// ```ignore (builtin impl example)
  /// trait Trait {
  ///     fn foo(&self);
  /// }
  /// // results in the following builtin impl
  /// impl<'a, T: Trait + 'a> Unsize<dyn Trait + 'a> for T {}
  /// ```
  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:796 consider_structural_builtin_unsize_candidates
  consider_structural_builtin_unsize_candidates(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate[], RerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Ok([]);
    }

    const result = ecx
      .probe<Candidate[]>((_) => ProbeKind.UnsizeAssembly)
      .enter((ecx): Result<Candidate[], NoSolutionOrRerunNonErased> => {
        const a_ty = TraitClause.self_ty(goal.predicate);
        // We need to normalize the b_ty since it's matched structurally
        // in the other functions below.
        const b_ty_r = ecx.structurally_normalize_ty(goal.param_env, goal.predicate.trait_ref.args.type_at(1));
        if (b_ty_r.$ === "Err") return b_ty_r;
        const b_ty = b_ty_r._0;

        // PORT: upstream shadows `goal`; a JS `const` cannot read the binding it shadows (TDZ).
        const goal_: Goal<[Ty, Ty]> = Goal.with(goal, as_interner(ecx.cx()), [a_ty, b_ty] as [Ty, Ty], upcast_from_self);
        const ak = a_ty.kind();
        const bk = b_ty.kind();
        if (ak.$ === "Infer" && ak._0.$ === "TyVar") {
          return panic(`unexpected infer ${debug_Ty(a_ty, PLAIN)} ${debug_Ty(b_ty, PLAIN)}`);
        } else if (bk.$ === "Infer" && bk._0.$ === "TyVar") {
          const c = ecx.forced_ambiguity(MaybeInfo.AMBIGUOUS);
          if (c.$ === "Err") return c;
          return Ok([c._0]);
        } else if (ak.$ === "Dynamic" && bk.$ === "Dynamic") {
          // Trait upcasting, or `dyn Trait + Auto + 'a` -> `dyn Trait + 'b`.
          const [a_data, a_region, b_data, b_region] = [ak._0, ak._1, bk._0, bk._1];
          return Ok(ecx.consider_builtin_dyn_upcast_candidates(goal_, a_data, a_region, b_data, b_region));
        } else if (bk.$ === "Dynamic") {
          // `T` -> `dyn Trait` unsizing.
          // PORT: upstream binds the fields as `(b_region, b_data)` (names swapped vs. their types); kept.
          const [b_region, b_data] = [bk._0, bk._1];
          const c = ecx.consider_builtin_unsize_to_dyn_candidate(goal_, b_region, b_data);
          if (c.$ === "Err") return c;
          return Ok([c._0]);
        } else if (ak.$ === "Array" && bk.$ === "Slice") {
          // `[T; N]` -> `[T]` unsizing
          const [a_elem_ty, b_elem_ty] = [ak._0, bk._0];
          const c = ecx.consider_builtin_array_unsize(goal_, a_elem_ty, b_elem_ty);
          if (c.$ === "Err") return c;
          return Ok([c._0]);
        } else if (ak.$ === "Adt" && bk.$ === "Adt" && ak._0.is_struct() && ak._0 === bk._0) {
          // `Struct<T>` -> `Struct<U>` where `T: Unsize<U>`
          const [a_def, a_args, b_args] = [ak._0, ak._1, bk._1];
          const c = ecx.consider_builtin_struct_unsize(goal_, a_def, a_args, b_args);
          if (c.$ === "Err") return c;
          return Ok([c._0]);
        } else {
          return Err(NoSolution_into);
        }
      });

    const r = RerunResultExt_for_Result.map_err_to_rerun(result);
    if (r.$ === "Err") return r;
    const resp = r._0;
    if (resp.$ === "Ok") {
      return Ok(resp._0);
    } else {
      // Err(NoSolution)
      return Ok([]);
    }
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:856 consider_builtin_try_as_dyn_candidate
  consider_builtin_try_as_dyn_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }
    const cx = ecx.cx();

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx): QueryResultOrRerunNonErased => {
      const self_ty = TraitClause.self_ty(goal.predicate);
      const ty_lifetime = goal.predicate.trait_ref.args.region_at(1);
      const k = self_ty.kind();
      if (k.$ === "Dynamic") {
        const [bounds, lifetime] = [k._0, k._1];
        for (const bound of bounds) {
          const p: ExistentialPredicate = Binder.skip_binder(bound);
          switch (p.$) {
            case "Trait":
              break;
            // FIXME(try_as_dyn): check what kind of projections we can allow
            case "Projection":
              return Err(NoSolution_into);
            // Auto traits do not affect lifetimes outside of specialization,
            // which is disabled in reflection.
            case "AutoTrait":
              break;
          }
        }
        const outlives: OutlivesClause<Region> = { _0: ty_lifetime, _1: lifetime };
        const r = ecx.add_goal("Misc", Goal.with(goal, as_interner(cx), outlives, upcast_tcx(Predicate_upcast_from_RegionOutlivesClause)));
        if (r.$ === "Err") return r;
        return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      } else if (
        k.$ === "Bound" ||
        (k.$ === "Infer" && (k._0.$ === "TyVar" || k._0.$ === "FreshTy" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy"))
      ) {
        return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      } else {
        return Err(NoSolution_into);
      }
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:899 consider_builtin_field_candidate
  consider_builtin_field_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    if (goal.predicate.polarity !== "Positive") {
      return Err(NoSolution_into);
    }

    const k = TraitClause.self_ty(goal.predicate).kind();
    if (k.$ !== "Adt") {
      return Err(NoSolution_into);
    }
    const [def, args] = [k._0, k._1];

    const info = def.field_representing_type_info(ecx.cx(), args);
    if (info === undefined) {
      return Err(NoSolution_into);
    }
    const { base, ty } = info;

    const bk = base.kind();
    if (bk.$ === "Adt" && bk._0.is_struct() && !bk._0.is_packed()) {
      // {}
    } else if (bk.$ === "Adt") {
      return Err(NoSolution_into);
    } else if (bk.$ === "Tuple") {
      // {}
    } else {
      return unreachable();
    }

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
      const sized_trait = as_interner(ecx.cx()).require_trait_lang_item("Sized");

      // FIXME: add better support for builtin impls of traits that check for the bounds
      // on the trait definition in std.
      //
      // NOTE: these bounds have to be kept in sync with the definition of the `Field`
      // trait in `library/core/src/field.rs` as well as the old trait solver `fn
      // assemble_candidates_for_field_trait` in
      // `compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs`.
      const r0 = ecx.add_goal("ImplWhereBound", {
        param_env: goal.param_env,
        predicate: Predicate_upcast_from_TraitRef(TraitRef.new(as_interner(ecx.cx()), sized_trait, [base]), ecx.cx()),
      });
      if (r0.$ === "Err") return r0;
      const r1 = ecx.add_goal("ImplWhereBound", {
        param_env: goal.param_env,
        predicate: Predicate_upcast_from_TraitRef(TraitRef.new(as_interner(ecx.cx()), sized_trait, [ty]), ecx.cx()),
      });
      if (r1.$ === "Err") return r1;

      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // (provided, not overridden)
  probe_and_consider_implied_clause(ecx: EvalCtxt, parent_source: CandidateSource, goal: Goal<TraitClause>, assumption: Clause, requirements: Iterable<[GoalSource, Goal<Predicate>]>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_consider_implied_clause(GoalKind_TraitClause, ecx, parent_source, goal, assumption, requirements);
  },

  // (provided, not overridden)
  probe_and_consider_object_bound_candidate(ecx: EvalCtxt, source: CandidateSource, goal: Goal<TraitClause>, assumption: Clause): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_consider_object_bound_candidate(GoalKind_TraitClause, ecx, source, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_consider_param_env_candidate(ecx: EvalCtxt, goal: Goal<TraitClause>, assumption: Clause): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased> {
    return GoalKind_provided.probe_and_consider_param_env_candidate(GoalKind_TraitClause, ecx, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_match_goal_against_assumption(ecx: EvalCtxt, source: CandidateSource, goal: Goal<TraitClause>, assumption: Clause, then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_match_goal_against_assumption(GoalKind_TraitClause, ecx, source, goal, assumption, then);
  },

};

/// Small helper function to change the `def_id` of a trait predicate - this is not normally
/// something that you want to do, as different traits will require different args and so making
/// it easy to change the trait is something of a footgun, but it is useful in the narrow
/// circumstance of changing from `MetaSized` to `Sized`, which happens as part of the lazy
/// elaboration of sizedness candidates.
// #[inline(always)]
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:959 trait_predicate_with_def_id
export function trait_predicate_with_def_id(cx: TyCtxt, clause: Binder<TraitClause>, did: DefId): Clause {
  return Clause_upcast_from_PolyTraitClause(
    Binder.map_bound(clause, (c): TraitClause => ({
      trait_ref: TraitRef.new_from_args(as_interner(cx), did, c.trait_ref.args),
      polarity: c.polarity,
    })),
    cx,
  );
}

// ---- impl<D, I> EvalCtxt<'_, D> (trait_goals.rs:972) -------------------------------------------------------------

/// Trait upcasting allows for coercions between trait objects:
/// ```ignore (builtin impl example)
/// trait Super {}
/// trait Trait: Super {}
/// // results in builtin impls upcasting to a super trait
/// impl<'a, 'b: 'a> Unsize<dyn Super + 'a> for dyn Trait + 'b {}
/// // and impls removing auto trait bounds.
/// impl<'a, 'b: 'a> Unsize<dyn Trait + 'a> for dyn Trait + Send + 'b {}
/// ```
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:986 consider_builtin_dyn_upcast_candidates
EvalCtxt.prototype.consider_builtin_dyn_upcast_candidates = function (
  this: EvalCtxt,
  goal: Goal<[Ty, Ty]>,
  a_data: BoundExistentialPredicates,
  a_region: Region,
  b_data: BoundExistentialPredicates,
  b_region: Region,
): Candidate[] {
  const cx = this.cx();
  const [a_ty, _b_ty] = goal.predicate;

  const responses: Candidate[] = [];
  // If the principal def ids match (or are both none), then we're not doing
  // trait upcasting. We're just removing auto traits (or shortening the lifetime).
  const b_principal_def_id = b_data.principal_def_id();
  const a_principal_def_id = a_data.principal_def_id();
  // PORT: `Option<DefId> == Option<DefId>`.
  const principal_def_ids_eq =
    a_principal_def_id === undefined || b_principal_def_id === undefined
      ? a_principal_def_id === b_principal_def_id
      : DefId_eq(a_principal_def_id, b_principal_def_id);
  if (principal_def_ids_eq || b_principal_def_id === undefined) {
    // PORT: `Vec::extend(Result)`: a `Result` iterates over its `Ok` value, so an `Err` (including a
    // `RerunNonErased`) adds nothing.
    const r = this.consider_builtin_upcast_to_principal(
      goal,
      { $: "BuiltinImpl", _0: BuiltinImplSource_Misc },
      a_data,
      a_region,
      b_data,
      b_region,
      a_data.principal(),
    );
    if (r.$ === "Ok") responses.push(r._0);
  } else {
    const a_principal = a_data.principal();
    if (a_principal !== undefined) {
      let idx = 0;
      for (const new_a_principal of supertraits(this.cx(), PolyExistentialTraitRef.with_self_ty(a_principal, as_interner(cx), a_ty))) {
        // `.enumerate().skip(1)`
        const i = idx++;
        if (i < 1) continue;
        const r = this.consider_builtin_upcast_to_principal(
          goal,
          { $: "BuiltinImpl", _0: { $: "TraitUpcasting", _0: i } },
          a_data,
          a_region,
          b_data,
          b_region,
          Binder.map_bound(new_a_principal, (trait_ref) => ExistentialTraitRefC.erase_self_ty(as_interner(cx), trait_ref)),
        );
        if (r.$ === "Ok") responses.push(r._0);
      }
    }
  }

  return responses;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1034 consider_builtin_unsize_to_dyn_candidate
EvalCtxt.prototype.consider_builtin_unsize_to_dyn_candidate = function (
  this: EvalCtxt,
  goal: Goal<[Ty, Ty]>,
  b_data: BoundExistentialPredicates,
  b_region: Region,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  const cx = this.cx();
  const [a_ty] = goal.predicate;

  // Can only unsize to an dyn-compatible trait.
  const b_principal_def_id = b_data.principal_def_id();
  if (b_principal_def_id !== undefined && !as_interner(cx).trait_is_dyn_compatible(b_principal_def_id)) {
    return Err(NoSolution_into);
  }

  return this.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
    // Check that the type implements all of the predicates of the trait object.
    // (i.e. the principal, all of the associated types match, and any auto traits)
    const r0 = ecx.add_goals(
      "ImplWhereBound",
      iter_map(b_data, (pred) =>
        Goal.with(goal, as_interner(cx), PolyExistentialPredicate.with_self_ty(pred, cx, a_ty), upcast_tcx(Predicate_upcast_from_Clause)),
      ),
    );
    if (r0.$ === "Err") return r0;

    // The type must be `Sized` to be unsized.
    const r1 = ecx.add_goal(
      "ImplWhereBound",
      Goal.with(
        goal,
        as_interner(cx),
        TraitRef.new(as_interner(cx), as_interner(cx).require_trait_lang_item("Sized"), [a_ty]),
        upcast_tcx(Predicate_upcast_from_TraitRef),
      ),
    );
    if (r1.$ === "Err") return r1;

    // The type must outlive the lifetime of the `dyn` we're unsizing into.
    const outlives: OutlivesClause<Ty> = { _0: a_ty, _1: b_region };
    const r2 = ecx.add_goal("Misc", Goal.with(goal, as_interner(cx), outlives, upcast_tcx(Predicate_upcast_from_TypeOutlivesClause)));
    if (r2.$ === "Err") return r2;
    return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  });
};

// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1075 consider_builtin_upcast_to_principal
EvalCtxt.prototype.consider_builtin_upcast_to_principal = function (
  this: EvalCtxt,
  goal: Goal<[Ty, Ty]>,
  source: CandidateSource,
  a_data: BoundExistentialPredicates,
  a_region: Region,
  b_data: BoundExistentialPredicates,
  b_region: Region,
  upcast_principal: Binder<ExistentialTraitRef> | undefined,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  const param_env = goal.param_env;

  // We may upcast to auto traits that are either explicitly listed in
  // the object type's bounds, or implied by the principal trait ref's
  // supertraits.
  // PORT: `IndexSet<I::TraitId>` is a `DefIdSet` (only `contains` is used, so its order does not matter).
  const a_auto_traits = new DefIdSet();
  for (const def_id of a_data.auto_traits()) a_auto_traits.add(def_id);
  const principal_def_id = a_data.principal_def_id();
  if (principal_def_id !== undefined) {
    for (const def_id of as_interner(this.cx()).supertrait_def_ids(principal_def_id)) {
      if (as_interner(this.cx()).trait_is_auto(def_id)) a_auto_traits.add(def_id);
    }
  }

  // More than one projection in a_ty's bounds may match the projection
  // in b_ty's bound. Use this to first determine *which* apply without
  // having any inference side-effects. We process obligations because
  // unification may initially succeed due to deferred projection equality.
  const projection_may_match = (
    ecx: EvalCtxt,
    source_projection: Binder<ExistentialProjection>,
    target_projection: Binder<ExistentialProjection>,
  ): Result<boolean, RerunNonErased> => {
    if (!DefId_eq(PolyExistentialProjection.item_def_id(source_projection), PolyExistentialProjection.item_def_id(target_projection))) {
      return Ok(false);
    }
    const r = ecx
      .probe<Certainty>((_) => ProbeKind.ProjectionCompatibility)
      .enter((ecx) => {
        // PORT: upstream shadows `target_projection` (TDZ, as above).
        const target_projection_ = ecx.deeply_resolve_ignoring_regions(target_projection, fold_Binder(relate_ExistentialProjection));
        return ecx.enter_forall_with_assumptions(
          target_projection_,
          param_env,
          (ecx, target_projection): Result<Certainty, NoSolutionOrRerunNonErased> => {
            const source_projection_ = ecx.instantiate_binder_with_infer(source_projection, relate_ExistentialProjection);
            const r = ecx.eq(param_env, source_projection_, target_projection, relate_ExistentialProjection);
            if (r.$ === "Err") return r;
            return ecx.try_evaluate_added_goals();
          },
          relate_ExistentialProjection,
        );
      });
    if (r.$ === "Ok") {
      return Ok(true);
    } else if (r._0.$ === "NoSolution") {
      return Ok(false);
    } else {
      return Err(r._0._0);
    }
  };

  return this.probe_trait_candidate(source).enter((ecx): QueryResultOrRerunNonErased => {
    for (const bound of b_data) {
      const p: ExistentialPredicate = Binder.skip_binder(bound);
      switch (p.$) {
        // Check that a's supertrait (upcast_principal) is compatible
        // with the target (b_ty).
        case "Trait": {
          const source_principal = unwrap(upcast_principal);
          const target_principal0 = Binder.rebind(bound, p._0);
          // We might unify infer vars in previous iterations.
          const target_principal1 = ecx.deeply_resolve_ignoring_regions(target_principal0, fold_Binder(relate_ExistentialTraitRef));
          const r = ecx.enter_forall_with_assumptions(
            target_principal1,
            param_env,
            (ecx, target_principal): Result<Certainty, NoSolutionOrRerunNonErased> => {
              const source_principal_ = ecx.instantiate_binder_with_infer(source_principal, relate_ExistentialTraitRef);
              const r = ecx.eq(param_env, source_principal_, target_principal, relate_ExistentialTraitRef);
              if (r.$ === "Err") return r;
              return ecx.try_evaluate_added_goals();
            },
            relate_ExistentialTraitRef,
          );
          if (r.$ === "Err") return r;
          break;
        }
        // Check that b_ty's projection is satisfied by exactly one of
        // a_ty's projections. First, we look through the list to see if
        // any match. If not, error. Then, if *more* than one matches, we
        // return ambiguity. Otherwise, if exactly one matches, equate
        // it with b_ty's projection.
        case "Projection": {
          const target_projection0 = Binder.rebind(bound, p._0);
          let matching_projection: Binder<ExistentialProjection> | undefined = undefined;
          for (const source_projection of a_data.projection_bounds()) {
            const m = projection_may_match(ecx, source_projection, target_projection0);
            if (m.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(m._0));
            if (m._0) {
              if (matching_projection !== undefined) {
                return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
              }
              matching_projection = source_projection;
            }
          }
          const matching = matching_projection;
          if (matching === undefined) {
            return Err(NoSolution_into);
          }

          // We might unify infer vars in previous iterations.
          const target_projection1 = ecx.deeply_resolve_ignoring_regions(target_projection0, fold_Binder(relate_ExistentialProjection));
          const r = ecx.enter_forall_with_assumptions(
            target_projection1,
            param_env,
            (ecx, target_projection): Result<Certainty, NoSolutionOrRerunNonErased> => {
              const source_projection = ecx.instantiate_binder_with_infer(matching, relate_ExistentialProjection);
              const r = ecx.eq(param_env, source_projection, target_projection, relate_ExistentialProjection);
              if (r.$ === "Err") return r;
              return ecx.try_evaluate_added_goals();
            },
            relate_ExistentialProjection,
          );
          if (r.$ === "Err") return r;
          break;
        }
        // Check that b_ty's auto traits are present in a_ty's bounds.
        case "AutoTrait": {
          const def_id = p._0;
          if (!a_auto_traits.has(def_id)) {
            return Err(NoSolution_into);
          }
          break;
        }
      }
    }

    // Also require that a_ty's lifetime outlives b_ty's lifetime.
    const outlives: OutlivesClause<Region> = { _0: a_region, _1: b_region };
    const r = ecx.add_goal(
      "ImplWhereBound",
      Goal.new(as_interner(ecx.cx()), param_env, outlives, upcast_tcx(Predicate_upcast_from_RegionOutlivesClause)),
    );
    if (r.$ === "Err") return r;

    return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  });
};

/// We have the following builtin impls for arrays:
/// ```ignore (builtin impl example)
/// impl<T: ?Sized, const N: usize> Unsize<[T]> for [T; N] {}
/// ```
/// While the impl itself could theoretically not be builtin,
/// the actual unsizing behavior is builtin. Its also easier to
/// make all impls of `Unsize` builtin as we're able to use
/// `#[rustc_deny_explicit_impl]` in this case.
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1215 consider_builtin_array_unsize
EvalCtxt.prototype.consider_builtin_array_unsize = function (
  this: EvalCtxt,
  goal: Goal<[Ty, Ty]>,
  a_elem_ty: Ty,
  b_elem_ty: Ty,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  const r = this.eq(goal.param_env, a_elem_ty, b_elem_ty, relate_Ty);
  if (r.$ === "Err") return r;
  return this.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) =>
    ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes),
  );
};

/// We generate a builtin `Unsize` impls for structs with generic parameters only
/// mentioned by the last field.
/// ```ignore (builtin impl example)
/// struct Foo<T, U: ?Sized> {
///     sized_field: Vec<T>,
///     unsizable: Box<U>,
/// }
/// // results in the following builtin impl
/// impl<T: ?Sized, U: ?Sized, V: ?Sized> Unsize<Foo<T, V>> for Foo<T, U>
/// where
///     Box<U>: Unsize<Box<V>>,
/// {}
/// ```
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1239 consider_builtin_struct_unsize
EvalCtxt.prototype.consider_builtin_struct_unsize = function (
  this: EvalCtxt,
  goal: Goal<[Ty, Ty]>,
  def: AdtDef,
  a_args: GenericArgs,
  b_args: GenericArgs,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  const cx = this.cx();
  const [_a_ty, b_ty] = goal.predicate;

  const unsizing_params = as_interner(cx).unsizing_params_for_adt(def.def_id());
  // We must be unsizing some type parameters. This also implies
  // that the struct has a tail field.
  if (unsizing_params.is_empty()) {
    return Err(NoSolution_into);
  }

  const tail_field_ty = unwrap(def.struct_tail_ty(cx));

  const a_tail_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tail_field_ty, cx, a_args, fold_Ty));
  const b_tail_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tail_field_ty, cx, b_args, fold_Ty));

  // Instantiate just the unsizing params from B into A. The type after
  // this instantiation must be equal to B. This is so we don't unsize
  // unrelated type parameters.
  const new_a_args = as_interner(cx).mk_args_from_iter(
    a_args.map((a, i) => {
      if (unsizing_params.contains(i)) {
        return unwrap(SliceLike_provided.get(b_args, i));
      } else {
        return a;
      }
    }),
  );
  const unsized_a_ty = Ty.new_adt(cx, def, new_a_args);

  // Finally, we require that `TailA: Unsize<TailB>` for the tail field
  // types.
  const r0 = this.eq(goal.param_env, unsized_a_ty, b_ty, relate_Ty);
  if (r0.$ === "Err") return r0;
  const r1 = this.add_goal(
    "ImplWhereBound",
    Goal.with(
      goal,
      as_interner(cx),
      TraitRef.new(as_interner(cx), as_interner(cx).require_trait_lang_item("Unsize"), [a_tail_ty, b_tail_ty]),
      upcast_tcx(Predicate_upcast_from_TraitRef),
    ),
  );
  if (r1.$ === "Err") return r1;
  return this.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) =>
    ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes),
  );
};

// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1287 consider_auto_trait_candidate_for_opaque_ty
EvalCtxt.prototype.consider_auto_trait_candidate_for_opaque_ty = function (
  this: EvalCtxt,
  goal: Goal<TraitClause>,
  def_id: DefId,
  args: GenericArgs,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  const cx = this.cx();
  const source: CandidateSource = { $: "BuiltinImpl", _0: BuiltinImplSource_Misc };

  for (const item_bound of EarlyBinder.skip_binder(as_interner(cx).item_self_bounds(def_id))) {
    const b = Clause_provided.as_trait_clause(item_bound);
    if (b !== undefined && DefId_eq(PolyTraitClause.def_id(b), TraitClause.def_id(goal.predicate))) {
      return Err(NoSolution_into);
    }
  }

  const candidate_r = this.probe_trait_candidate(source).enter((ecx) => {
    const hidden_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(as_interner(cx).type_of(def_id), cx, args, fold_Ty));
    const r = ecx.add_goal(
      "ImplWhereBound",
      Goal.with(
        goal,
        as_interner(cx),
        TraitClause.with_replaced_self_ty(goal.predicate, as_interner(cx), hidden_ty),
        upcast_tcx(Predicate_upcast_from_TraitClause),
      ),
    );
    if (r.$ === "Err") return r;
    return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  });
  if (candidate_r.$ === "Err") return candidate_r;
  const candidate = candidate_r._0;

  // Proving an auto trait for the hidden type must not constrain inference
  // variables, as that would leak the hidden type itself.
  if (!Response.is_identity_modulo_regions(candidate.result.value)) {
    return this.forced_ambiguity(MaybeInfo.AMBIGUOUS);
  }

  const { region_constraints: _, opaque_types, normalization_nested_goals: _normalization_nested_goals } =
    ExternalConstraints_deref(candidate.result.value.external_constraints);
  // debug_assert!(normalization_nested_goals.is_empty());

  // New defining uses may leak an opaque's hidden type into the caller's
  // inference state. This is safe after typeck, where hidden types are already
  // fixed and only regions are inferred, but not during typeck while hidden
  // types may still contain inference variables.
  if (opaque_types.length !== 0) {
    const typing_mode = this.typing_mode();

    switch (typing_mode.$) {
      // We're inferring regions of opaque types, but
      // the type itself is already fully known, no way
      // to leak the hidden type.
      case "PostTypeckUntilBorrowck":
        break;
      // We're inferring the hidden type of opaques, could
      // leak types through it.
      case "Typeck":
        return this.forced_ambiguity(MaybeInfo.AMBIGUOUS);
      // we never add new uses to the opaque type storage
      case "Coherence":
      case "PostBorrowck":
      case "Reflection":
      case "PostAnalysis":
      case "Codegen":
      case "ErasedNotCoherence":
        return unreachable(
          `internal error: entered unreachable code: we never add new uses to opaque types in typing mode ${debug_TypingMode_(typing_mode)}`,
        );
    }
  }

  return Ok(candidate);
};

/** `{:?}` of a `TypingMode` (`S = MayBeErased`). */
function debug_TypingMode_(typing_mode: TypingMode): string {
  return debug_TypingMode(typing_mode, PLAIN, debug_MayBeErased);
}

// Return `Some` if there is an impl (built-in or user provided) that may
// hold for the self type of the goal, which for coherence and soundness
// purposes must disqualify the built-in auto impl assembled by considering
// the type's constituent types.
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1362 disqualify_auto_trait_candidate_due_to_possible_impl
EvalCtxt.prototype.disqualify_auto_trait_candidate_due_to_possible_impl = function (
  this: EvalCtxt,
  goal: Goal<TraitClause>,
): Result<Candidate, NoSolutionOrRerunNonErased> | undefined {
  const self_ty = TraitClause.self_ty(goal.predicate);
  const check_impls = (): Result<Candidate, NoSolutionOrRerunNonErased> | undefined => {
    let disqualifying_impl: DefId | undefined = undefined;
    as_interner(this.cx()).ir_for_each_relevant_impl(
      goal.predicate.trait_ref,
      (impl_def_id) => {
        disqualifying_impl = impl_def_id;
      },
      VisitorResult.unit,
    );
    const def_id: DefId | undefined = disqualifying_impl;
    if (def_id !== undefined) {
      // trace!(?def_id, ?goal, "disqualified auto-trait implementation");
      // No need to actually consider the candidate here,
      // since we do that in `consider_impl_candidate`.
      return Err(NoSolution_into);
    } else {
      return undefined;
    }
  };

  const k = self_ty.kind();
  // Stall int and float vars until they are resolved to a concrete
  // numerical type. That's because the check for impls below treats
  // int vars as matching any impl. Even if we filtered such impls,
  // we probably don't want to treat an `impl !AutoTrait for i32` as
  // disqualifying the built-in auto impl for `i64: AutoTrait` either.
  if (k.$ === "Infer" && (k._0.$ === "IntVar" || k._0.$ === "FloatVar")) {
    return this.forced_ambiguity(MaybeInfo.AMBIGUOUS);
  }

  // Backward compatibility for default auto traits.
  // Test: ui/traits/default_auto_traits/extern-types.rs
  if (k.$ === "Foreign" && as_interner(this.cx()).is_default_trait(TraitClause.def_id(goal.predicate))) {
    return check_impls();
  }

  // These types cannot be structurally decomposed into constituent
  // types, and therefore have no built-in auto impl.
  if (
    k.$ === "Dynamic" ||
    k.$ === "Param" ||
    k.$ === "Foreign" ||
    (k.$ === "Alias" &&
      k._0 === "Yes" &&
      (k._1.kind.$ === "Projection" || k._1.kind.$ === "Free" || k._1.kind.$ === "Inherent")) ||
    k.$ === "Placeholder"
  ) {
    return Err(NoSolution_into);
  }

  // Coroutines have one special built-in candidate, `Unpin`, which
  // takes precedence over the structural auto trait candidate being
  // assembled.
  if (k.$ === "Coroutine" && as_interner(this.cx()).is_trait_lang_item(TraitClause.def_id(goal.predicate), "Unpin")) {
    const def_id = k._0;
    switch (as_interner(this.cx()).coroutine_movability(def_id)) {
      case "Static":
        return Err(NoSolution_into);
      case "Movable":
        return this.probe_builtin_trait_candidate(BuiltinImplSource_Misc).enter((ecx) => {
          return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
        });
    }
  }

  // If we still have an alias here, it must be rigid. For opaques, it's always
  // okay to consider auto traits because that'll reveal its hidden type. For
  // non-opaque aliases, we will not assemble any candidates since there's no way
  // to further look into its type.
  if (k.$ === "Alias" && k._0 === "Yes" && k._1.kind.$ === "Opaque") {
    return undefined;
  }

  // For rigid types, any possible implementation that could apply to
  // the type (even if after unification and processing nested goals
  // it does not hold) will disqualify the built-in auto impl.
  //
  // We've originally had a more permissive check here which resulted
  // in unsoundness, see #84857.
  if (
    k.$ === "Bool" ||
    k.$ === "Char" ||
    k.$ === "Int" ||
    k.$ === "Uint" ||
    k.$ === "Float" ||
    k.$ === "Str" ||
    k.$ === "Array" ||
    k.$ === "Pat" ||
    k.$ === "Slice" ||
    k.$ === "RawPtr" ||
    k.$ === "Ref" ||
    k.$ === "FnDef" ||
    k.$ === "FnPtr" ||
    k.$ === "Closure" ||
    k.$ === "CoroutineClosure" ||
    k.$ === "Coroutine" ||
    k.$ === "CoroutineWitness" ||
    k.$ === "Never" ||
    k.$ === "Tuple" ||
    k.$ === "Adt" ||
    k.$ === "UnsafeBinder"
  ) {
    return check_impls();
  }
  if (k.$ === "Error") {
    return undefined;
  }

  // ty::Infer(_) | ty::Alias(ty::IsRigid::No, _) | ty::Bound(_, _)
  return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
};

/// Convenience function for traits that are structural, i.e. that only
/// have nested subgoals that only change the self type. Unlike other
/// evaluate-like helpers, this does a probe, so it doesn't need to be
/// wrapped in one.
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1473 probe_and_evaluate_goal_for_constituent_tys
EvalCtxt.prototype.probe_and_evaluate_goal_for_constituent_tys = function (
  this: EvalCtxt,
  source: CandidateSource,
  goal: Goal<TraitClause>,
  constituent_tys: (ecx: EvalCtxt, ty: Ty) => Result<Binder<Ty[]>, NoSolution>,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  return this.probe_trait_candidate(source).enter((ecx) => {
    const tys = constituent_tys(ecx, TraitClause.self_ty(goal.predicate));
    if (tys.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(tys._0));
    const goals = ecx.enter_forall_with_assumptions(
      tys._0,
      goal.param_env,
      (ecx, tys) => {
        return tys.map((ty) => {
          return Goal.with(
            goal,
            as_interner(ecx.cx()),
            TraitClause.with_replaced_self_ty(goal.predicate, as_interner(ecx.cx()), ty),
            upcast_tcx(Predicate_upcast_from_TraitClause),
          );
        });
      },
      fold_Vec(fold_Ty) as TypeFoldable<Ty[]>,
    );
    const r = ecx.add_goals("ImplWhereBound", goals);
    if (r.$ === "Err") return r;
    return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  });
};

// ---- impl<D, I> EvalCtxt<'_, D> (trait_goals.rs:1522) ------------------------------------------------------------

/// FIXME(#57893): For backwards compatibility with the old trait solver implementation,
/// we need to handle overlap between builtin and user-written impls for trait objects.
///
/// This overlap is unsound in general and something which we intend to fix separately.
/// To avoid blocking the stabilization of the trait solver, we add this hack to avoid
/// breakage in cases which are *mostly fine*™. Importantly, this preference is strictly
/// weaker than the old behavior.
///
/// We only prefer builtin over user-written impls if there are no inference constraints.
/// Importantly, we also only prefer the builtin impls for trait goals, and not during
/// normalization. This means the only case where this special-case results in exploitable
/// unsoundness should be lifetime dependent user-written impls.
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1539 unsound_prefer_builtin_dyn_impl
EvalCtxt.prototype.unsound_prefer_builtin_dyn_impl = function (this: EvalCtxt, candidates: Candidate[]): void {
  if (TypingMode.is_coherence(this.typing_mode())) {
    return;
  }

  const c = candidates.find((c) => c.source.$ === "BuiltinImpl" && c.source._0.$ === "Object");
  if (c !== undefined && has_only_region_constraints(c.result)) {
    retain(candidates, (c) => {
      if (c.source.$ === "Impl") {
        // debug!(?c, "unsoundly dropping impl in favor of builtin dyn-candidate");
        return false;
      } else {
        return true;
      }
    });
  }
};

/// Like `try_merge_candidates`, but returns `None` if there are multiple user-written
/// impls, or a user-written impl and a builtin impl, in which case we bail with ambiguity.
///
/// Candidates with equal responses can still come from conflicting impls, ex - two
/// overlapping impls which both apply due to impossible where-clauses. We don't want
/// to merge these. Multiple builtin impls are still merged as usual. This is not
/// done for marker traits, as their impls are allowed to overlap.
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1570 try_merge_impl_candidates
EvalCtxt.prototype.try_merge_impl_candidates = function (
  this: EvalCtxt,
  trait_def_id: DefId,
  candidates: readonly Candidate[],
): CanonicalResponse | undefined {
  const is_marker = as_interner(this.cx()).trait_is_marker(trait_def_id);
  const all_builtin = candidates.every((candidate) => candidate.source.$ === "BuiltinImpl");

  if (is_marker || all_builtin) {
    const r = this.try_merge_candidates(candidates);
    return r === undefined ? undefined : r[0];
  } else if (candidates.length > 1) {
    return undefined;
  } else {
    const first = candidates[0];
    return first === undefined ? undefined : first.result;
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1589 merge_candidates_or_bail_with_ambiguity
EvalCtxt.prototype.merge_candidates_or_bail_with_ambiguity = function (
  this: EvalCtxt,
  candidates: readonly Candidate[],
  proven_via: TraitGoalProvenVia,
): [CanonicalResponse, TraitGoalProvenVia | undefined] {
  const r = this.try_merge_candidates(candidates);
  if (r !== undefined) {
    const [response, _] = r;
    return [response, proven_via];
  } else {
    return [this.bail_with_ambiguity(candidates), undefined];
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1601 merge_impl_candidates_or_bail_with_ambiguity
EvalCtxt.prototype.merge_impl_candidates_or_bail_with_ambiguity = function (
  this: EvalCtxt,
  trait_def_id: DefId,
  candidates: readonly Candidate[],
): [CanonicalResponse, TraitGoalProvenVia | undefined] {
  // debug_assert!(candidates.iter().all(|c| matches!(
  //     c.source,
  //     CandidateSource::Impl(_) | CandidateSource::BuiltinImpl(_)
  // )));
  const response = this.try_merge_impl_candidates(trait_def_id, candidates);
  if (response !== undefined) {
    return [response, TraitGoalProvenVia.Misc];
  } else {
    return [this.bail_with_ambiguity(candidates), undefined];
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1617 merge_trait_candidates
EvalCtxt.prototype.merge_trait_candidates = function (
  this: EvalCtxt,
  trait_def_id: DefId,
  candidates: Candidate[],
  failed_candidate_info: FailedCandidateInfo,
): Result<[CanonicalResponse, TraitGoalProvenVia | undefined], NoSolution> {
  if (candidates.length === 0) {
    return Err(NoSolution);
  }

  const candidate_preference_mode = CandidatePreferenceMode.compute(as_interner(this.cx()), trait_def_id);
  if (TypingMode.is_coherence(this.typing_mode())) {
    const response = this.try_merge_impl_candidates(trait_def_id, candidates);
    return Ok<MergedResponse>(response !== undefined ? [response, TraitGoalProvenVia.Misc] : [this.bail_with_ambiguity(candidates), undefined]);
  }

  // We prefer trivial builtin candidates, i.e. builtin impls without any
  // nested requirements, over all others. This is a fix for #53123 and
  // prevents where-bounds from accidentally extending the lifetime of a
  // variable.
  // PORT: the lazy `filter` iterator is advanced at most twice, as upstream.
  const is_trivial_builtin = (c: Candidate): boolean => c.source.$ === "BuiltinImpl" && c.source._0.$ === "Trivial";
  const first_trivial = candidates.findIndex(is_trivial_builtin);
  if (first_trivial !== -1) {
    const candidate = candidates[first_trivial]!;
    // There should only ever be a single trivial builtin candidate
    // as they would otherwise overlap.
    assert(
      candidates.findIndex((c, i) => i > first_trivial && is_trivial_builtin(c)) === -1,
      "assertion failed: trivial_builtin_impls.next().is_none()",
    );
    return Ok<MergedResponse>([candidate.result, TraitGoalProvenVia.Misc]);
  }

  // Extract non-nested alias bound candidates, will be preferred over where bounds if
  // we're proving an auto-trait, sizedness trait or default trait.
  if (
    candidate_preference_mode === CandidatePreferenceMode.Marker &&
    candidates.some((c) => c.source.$ === "AliasBound" && c.source._0 === "SelfBounds")
  ) {
    const alias_bounds = extract_if(candidates, (c) => c.source.$ === "AliasBound");
    return Ok(this.merge_candidates_or_bail_with_ambiguity(alias_bounds, TraitGoalProvenVia.AliasBound));
  }

  // If there are non-global where-bounds, prefer where-bounds
  // (including global ones) over everything else.
  const has_non_global_where_bounds = candidates.some((c) => c.source.$ === "ParamEnv" && c.source._0 === "NonGlobal");
  if (has_non_global_where_bounds) {
    const where_bounds = extract_if(candidates, (c) => c.source.$ === "ParamEnv");
    const merged = this.try_merge_candidates(where_bounds);
    if (merged === undefined) {
      return Ok<MergedResponse>([this.bail_with_ambiguity(where_bounds), undefined]);
    }
    const [response, info]: [CanonicalResponse, MergeCandidateInfo] = merged;
    switch (info.$) {
      // If there's an always applicable candidate, the result of all
      // other candidates does not matter. This means we can ignore
      // them when checking whether we've reached a fixpoint.
      //
      // We always prefer the first always applicable candidate, even if a
      // later candidate is also always applicable and would result in fewer
      // reruns. We could slightly improve this by e.g. searching for another
      // always applicable candidate which doesn't depend on any cycle heads.
      //
      // NOTE: This is optimization is observable in case there is an always
      // applicable global candidate and another non-global candidate which only
      // applies because of a provisional result. I can't even think of a test
      // case where this would occur and even then, this would not be unsound.
      // Supporting this makes the code more involved, so I am just going to
      // ignore this for now.
      case "AlwaysApplicable": {
        const i = info._0;
        where_bounds.forEach((c, j) => {
          if (i !== j) {
            this.ignore_candidate_head_usages(c.head_usages);
          }
        });
        // If a where-bound does not apply, we don't actually get a
        // candidate for it. We manually track the head usages
        // of all failed `ParamEnv` candidates instead.
        this.ignore_candidate_head_usages(failed_candidate_info.param_env_head_usages);
        break;
      }
      case "EqualResponse":
        break;
    }
    return Ok<MergedResponse>([response, TraitGoalProvenVia.ParamEnv]);
  }

  // Next, prefer any alias bound (nested or otherwise).
  if (candidates.some((c) => c.source.$ === "AliasBound")) {
    const alias_bounds = extract_if(candidates, (c) => c.source.$ === "AliasBound");
    return Ok(this.merge_candidates_or_bail_with_ambiguity(alias_bounds, TraitGoalProvenVia.AliasBound));
  }

  this.filter_specialized_impls(AllowInferenceConstraints.No, candidates);
  this.unsound_prefer_builtin_dyn_impl(candidates);

  // If there are *only* global where bounds, then make sure to return that this
  // is still reported as being proven-via the param-env so that rigid projections
  // operate correctly. Otherwise, drop all global where-bounds before merging the
  // remaining candidates.
  const only_global_where_bounds = candidates.every((c) => c.source.$ === "ParamEnv" && c.source._0 === "Global");
  if (only_global_where_bounds) {
    return Ok(this.merge_candidates_or_bail_with_ambiguity(candidates, TraitGoalProvenVia.ParamEnv));
  } else {
    retain(candidates, (c) => !(c.source.$ === "ParamEnv" && c.source._0 === "Global"));
    return Ok(this.merge_impl_candidates_or_bail_with_ambiguity(trait_def_id, candidates));
  }
};

// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1741 compute_trait_goal
EvalCtxt.prototype.compute_trait_goal = function (
  this: EvalCtxt,
  goal: Goal<TraitClause>,
): Result<[CanonicalResponse, TraitGoalProvenVia | undefined], NoSolutionOrRerunNonErased> {
  const r = this.assemble_and_evaluate_candidates(goal, "All" satisfies AssembleCandidatesFrom, GoalKind_TraitClause);
  if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
  const [candidates, failed_candidate_info] = r._0;
  const m = this.merge_trait_candidates(TraitClause.def_id(goal.predicate), candidates, failed_candidate_info);
  if (m.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(m._0));
  return m;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/trait_goals.rs:1752 try_stall_coroutine
EvalCtxt.prototype.try_stall_coroutine = function (
  this: EvalCtxt,
  self_ty: Ty,
): Result<Candidate, NoSolutionOrRerunNonErased> | undefined {
  const k = self_ty.kind();
  if (k.$ === "Coroutine") {
    const def_id = k._0;
    const typing_mode = this.typing_mode();
    switch (typing_mode.$) {
      case "Typeck": {
        const stalled_generators = typing_mode.defining_opaque_types_and_generators;
        const local = def_id.as_local();
        if (local !== undefined && SliceLike_provided.contains(stalled_generators, local)) {
          return this.forced_ambiguity({
            cause: { $: "Ambiguity" },
            opaque_types_jank: "AllGood",
            stalled_on_coroutines: "Yes",
          });
        }
        break;
      }
      case "ErasedNotCoherence": {
        // Trying to continue here isn't worth it.
        const r = AccessedOpaques.rerun_always(this.opaque_accesses, "TryStallCoroutine");
        // match .. { Err(e) => Err(e.into()) }
        return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
      }
      case "Coherence":
      case "PostAnalysis":
      case "Reflection":
      case "Codegen":
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
        break;
    }
  }

  return undefined;
};

/// How we've proven this trait goal.
///
/// This is used by `NormalizesTo` goals to only normalize
/// by using the same 'kind of candidate' we've used to prove
/// its corresponding trait goal. Most notably, we do not
/// normalize by using an impl if the trait goal has been
/// proven via a `ParamEnv` candidate.
///
/// This is necessary to avoid unnecessary region constraints,
/// see trait-system-refactor-initiative#125 for more details.
// PORT: `#[derive(Debug, Clone, Copy)]` fieldless enum.
export type TraitGoalProvenVia =
  /// We've proven the trait goal by something which is
  /// is not a non-global where-bound or an alias-bound.
  ///
  /// This means we don't disable any candidates during
  /// normalization.
  | "Misc"
  | "ParamEnv"
  | "AliasBound";
export const TraitGoalProvenVia = { Misc: "Misc", ParamEnv: "ParamEnv", AliasBound: "AliasBound" } as const;
export const debug_TraitGoalProvenVia: Debug<TraitGoalProvenVia> = (v) => v;
