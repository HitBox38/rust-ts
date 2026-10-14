//! Dealing with host effect goals, i.e. enforcing the constness in
//! `T: const Trait` or `T: [const] Trait`.
//
// Port of compiler/rustc_next_trait_solver/src/solve/effect_goals.rs (lane nts-normalizes; contract by
// evalctxt-contract). `impl<D, I> assembly::GoalKind<D> for ty::HostEffectClause<I>` is the table
// `GoalKind_HostEffectClause` (assembly/mod.ts header); provided methods it does not override forward to
// `GoalKind_provided`. `compute_host_effect_goal` is declared in ../decls.ts (`// solve/effect_goals.rs:<line>`).
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): the table's entries read other modules of the crate
// only inside their bodies.
// PORT: the generic code's `I::Clause` / `I::Ty` methods resolve to rustc_type_ir inherent.ts (solve/mod.ts header).
// TyCtxt methods whose query values are typed `unknown` in queries.gen.ts (`impl_trait_ref`) and the `Interner`-typed
// rustc_type_ir helpers are reached through `as_interner(cx)` (rustc_type_ir predicate.ts precedent).
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Predicate, Ty } from "../../rustc_middle/ty/decls.ts";
import {
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_ClauseKind,
  Predicate_upcast_from_TraitRef,
} from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { AliasTy, ClosureKind, TraitRef } from "../../rustc_type_ir/decls.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { elaborate, Elaboratable_Clause } from "../../rustc_type_ir/elaborate.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import { fold_tuple2, fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Clause_provided } from "../../rustc_type_ir/inherent.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { relate_TraitRef } from "../../rustc_type_ir/relate.ts";
import type { CandidateHeadUsages } from "../../rustc_type_ir/search_graph/mod.ts";
import { ProbeKind } from "../../rustc_type_ir/solve/inspect.ts";
import type {
  CandidateSource as CandidateSourceT,
  CanonicalResponse,
  Goal as GoalT,
  NoSolution,
  QueryResultOrRerunNonErased,
  RerunNonErased,
  SizedTraitKind,
} from "../../rustc_type_ir/solve/mod.ts";
import {
  BuiltinImplSource,
  Certainty,
  debug_Goal,
  Goal,
  GoalSource,
  NoSolutionOrRerunNonErased,
} from "../../rustc_type_ir/solve/mod.ts";
import { SolverTraitLangItem } from "../../rustc_type_ir/lang_items.ts";
import { Unnormalized, UnnormalizedPolyTraitRef } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { EvalCtxt } from "../decls.ts";
import { type Candidate, type GoalKind, GoalKind_provided } from "./assembly/mod.ts";
import {
  const_conditions_for_destruct,
  extract_fn_def_from_const_callable,
  instantiate_constituent_tys_for_copy_clone_trait,
} from "./assembly/structural_traits.ts";
import { goal_with, iter_instantiated, map_iter, NO_SOLUTION } from "./mod.ts";
import type { TraitGoalProvenVia } from "./trait_goals.ts";
import type { HostEffectClause as HostEffectClauseT } from "../../rustc_type_ir/decls.ts";
import { display_HostEffectClause } from "../../rustc_type_ir/ir_print.ts";
import {
  as_interner,
  BoundConstness,
  debug_HostEffectClause,
  fold_with_HostEffectClause,
  fold_with_TraitRef,
  HostEffectClause,
  PolyHostEffectClause,
  PolyTraitRef,
  TraitClause,
  TraitRef as TraitRefC,
  try_fold_with_HostEffectClause,
  try_fold_with_TraitRef,
  visit_with_HostEffectClause,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.ts";

type NoSolutionOrRerunNonErasedT = NoSolutionOrRerunNonErased;

/** PORT: the D4 descriptors of `TraitRef` / `Binder<TraitRef>` / `HostEffectClause` (generated derive fns). */
const d_TraitRef: TypeFoldable<TraitRef> = {
  visit_with: visit_with_TraitRef,
  try_fold_with: try_fold_with_TraitRef,
  fold_with: fold_with_TraitRef,
};
const d_PolyTraitRef: TypeFoldable<Binder<TraitRef>> = fold_Binder(d_TraitRef);
const d_HostEffectClause: TypeFoldable<HostEffectClauseT> = {
  visit_with: visit_with_HostEffectClause,
  try_fold_with: try_fold_with_HostEffectClause,
  fold_with: fold_with_HostEffectClause,
};

/** PORT: `?` on a `Result<_, NoSolution>` inside a fn returning `Result<_, NoSolutionOrRerunNonErased>` (`From`). */
function from_no_solution<T>(e: NoSolution): Result<T, NoSolutionOrRerunNonErasedT> {
  return Err(NoSolutionOrRerunNonErased.from_NoSolution(e));
}

/** `impl<D, I> assembly::GoalKind<D> for ty::HostEffectClause<I>` (header). */
export const GoalKind_HostEffectClause: GoalKind<HostEffectClauseT> = {
  visit_with: visit_with_HostEffectClause,
  try_fold_with: try_fold_with_HostEffectClause,
  fold_with: fold_with_HostEffectClause,
  // PORT: derived `PartialEq` of a plain value over interned children: equal canonical keys (rust_ts/intern_key.ts).
  eq: (a, b) => intern_key(a) === intern_key(b),
  display: display_HostEffectClause,

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:26 self_ty
  self_ty(self: HostEffectClauseT): Ty {
    return HostEffectClause.self_ty(self);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:30 trait_ref
  trait_ref(self: HostEffectClauseT, _: TyCtxt): TraitRef {
    return self.trait_ref;
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:34 with_replaced_self_ty
  with_replaced_self_ty(self: HostEffectClauseT, cx: TyCtxt, self_ty: Ty): HostEffectClauseT {
    return HostEffectClause.with_replaced_self_ty(self, as_interner(cx), self_ty);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:38 trait_def_id
  trait_def_id(self: HostEffectClauseT, _: TyCtxt): DefId {
    return HostEffectClause.def_id(self);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:42 fast_reject_assumption
  fast_reject_assumption(ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>, assumption: Clause): Result<undefined, NoSolution> {
    const host_clause = Clause_provided.as_host_effect_clause(assumption);
    if (
      host_clause !== undefined &&
      PolyHostEffectClause.def_id(host_clause) === HostEffectClause.def_id(goal.predicate) &&
      BoundConstness.satisfies(PolyHostEffectClause.constness(host_clause), goal.predicate.constness) &&
      DeepRejectCtxt.relate_rigid_rigid(as_interner(ecx.cx())).args_may_unify(
        goal.predicate.trait_ref.args,
        Binder.skip_binder(host_clause).trait_ref.args,
      )
    ) {
      return Ok(undefined);
    } else {
      return Err(NO_SOLUTION);
    }
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:61 match_assumption
  match_assumption(
    ecx: EvalCtxt,
    goal: GoalT<HostEffectClauseT>,
    assumption: Clause,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): QueryResultOrRerunNonErased {
    const host_clause = unwrap(Clause_provided.as_host_effect_clause(assumption));

    const assumption_trait_pred = ecx.instantiate_binder_with_infer(host_clause, d_HostEffectClause);
    const r = ecx.eq(goal.param_env, goal.predicate.trait_ref, assumption_trait_pred.trait_ref, relate_TraitRef);
    if (r.$ === "Err") return r;

    return then(ecx);
  },

  /// Register additional assumptions for aliases corresponding to `[const]` item bounds.
  ///
  /// Unlike item bounds, they are not simply implied by the well-formedness of the alias.
  /// Instead, they only hold if the const conditions on the alias also hold. This is why
  /// we also register the const conditions of the alias after matching the goal against
  /// the assumption.
  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:81 consider_additional_alias_assumptions
  consider_additional_alias_assumptions(ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>, alias_ty: AliasTy): Candidate[] {
    const cx = ecx.cx();
    const candidates: Candidate[] = [];

    let def_id: DefId;
    switch (alias_ty.kind.$) {
      case "Projection":
        def_id = alias_ty.kind.def_id;
        break;
      case "Inherent":
        def_id = alias_ty.kind.def_id;
        break;
      case "Opaque":
        def_id = alias_ty.kind.def_id;
        break;
      case "Free":
        def_id = alias_ty.kind.def_id;
        break;
    }

    if (!ecx.cx().alias_has_const_conditions(def_id)) {
      return [];
    }

    for (const clause of elaborate(
      cx,
      map_iter(iter_instantiated(cx.ir_explicit_implied_const_bounds(def_id), cx, alias_ty.args, d_PolyTraitRef), (trait_ref) =>
        Unnormalized.skip_norm_wip(UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, cx, goal.predicate.constness)),
      ),
      Elaboratable_Clause,
    )) {
      const r = GoalKind_HostEffectClause.probe_and_match_goal_against_assumption(
        ecx,
        { $: "AliasBound", _0: "SelfBounds" },
        goal,
        clause,
        (ecx) => {
          // Const conditions must hold for the implied const bound to hold.
          const r = ecx.add_goals(
            GoalSource.AliasBoundConstCondition,
            map_iter(iter_instantiated(cx.ir_const_conditions(def_id), cx, alias_ty.args, d_PolyTraitRef), (trait_ref) =>
              goal_with(
                goal,
                cx,
                Unnormalized.skip_norm_wip(
                  UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, cx, goal.predicate.constness),
                ),
                Predicate_upcast_from_Clause,
              ),
            ),
          );
          if (r.$ === "Err") return r;
          return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
        },
      );
      // PORT: `Vec::extend` with a `Result` (an `IntoIterator` of its `Ok` value).
      if (r.$ === "Ok") candidates.push(r._0);
    }

    return candidates;
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:136 consider_impl_candidate
  consider_impl_candidate(
    ecx: EvalCtxt,
    goal: GoalT<HostEffectClauseT>,
    goal_trait_ref: TraitRef,
    impl_def_id: DefId,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    const cx = ecx.cx();

    const impl_trait_ref = as_interner(cx).impl_trait_ref(impl_def_id);
    if (
      !DeepRejectCtxt.relate_rigid_infer(as_interner(ecx.cx())).args_may_unify(
        goal_trait_ref.args,
        EarlyBinder.skip_binder(impl_trait_ref).args,
      )
    ) {
      return from_no_solution(NO_SOLUTION);
    }

    // For every `default impl`, there's always a non-default `impl` that will *also* apply.
    // There's no reason to register a candidate for this impl, since it is *not* proof that
    // the trait goal holds.
    if (cx.impl_is_default(impl_def_id)) {
      return from_no_solution(NO_SOLUTION);
    }

    switch (as_interner(cx).impl_polarity(impl_def_id)) {
      case "Negative":
        return from_no_solution(NO_SOLUTION);
      case "Positive":
        break;
    }

    if (!cx.impl_is_const(impl_def_id)) {
      return from_no_solution(NO_SOLUTION);
    }

    return ecx.probe_trait_candidate({ $: "Impl", _0: impl_def_id }).enter((ecx) => {
      const impl_args = ecx.fresh_args_for_item(impl_def_id);
      ecx.record_impl_args(impl_args);
      const impl_trait_ref_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(impl_trait_ref, cx, impl_args, d_TraitRef));

      const r1 = ecx.eq(goal.param_env, goal_trait_ref, impl_trait_ref_, relate_TraitRef);
      if (r1.$ === "Err") return r1;
      const where_clause_bounds = map_iter(
        map_iter(iter_instantiated(cx.ir_clauses_of(impl_def_id), cx, impl_args, fold_Clause), Unnormalized.skip_norm_wip),
        (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
      );
      const r2 = ecx.add_goals(GoalSource.ImplWhereBound, where_clause_bounds);
      if (r2.$ === "Err") return r2;

      // For this impl to be `const`, we need to check its `[const]` bounds too.
      const const_conditions = map_iter(
        iter_instantiated(cx.ir_const_conditions(impl_def_id), cx, impl_args, d_PolyTraitRef),
        (bound_trait_ref) =>
          goal_with(
            goal,
            cx,
            Unnormalized.skip_norm_wip(
              UnnormalizedPolyTraitRef.to_host_effect_clause(bound_trait_ref, cx, goal.predicate.constness),
            ),
            Predicate_upcast_from_Clause,
          ),
      );
      const r3 = ecx.add_goals(GoalSource.ImplWhereBound, const_conditions);
      if (r3.$ === "Err") return r3;

      return then(ecx);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:199 consider_error_guaranteed_candidate
  consider_error_guaranteed_candidate(
    ecx: EvalCtxt,
    _goal: GoalT<HostEffectClauseT>,
    _guar: ErrorGuaranteed,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return ecx
      .probe_builtin_trait_candidate(BuiltinImplSource.Misc)
      .enter((ecx) => ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:208 consider_auto_trait_candidate
  consider_auto_trait_candidate(ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    ecx.cx().delay_bug("auto traits are never const");
    return from_no_solution(NO_SOLUTION);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:216 consider_trait_alias_candidate
  consider_trait_alias_candidate(ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    const cx = ecx.cx();

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const where_clause_bounds = map_iter(
        map_iter(
          iter_instantiated(cx.ir_clauses_of(HostEffectClause.def_id(goal.predicate)), cx, goal.predicate.trait_ref.args, fold_Clause),
          Unnormalized.skip_norm_wip,
        ),
        (c) => goal_with(goal, cx, c, Predicate_upcast_from_Clause),
      );

      const const_conditions = map_iter(
        iter_instantiated(
          cx.ir_const_conditions(HostEffectClause.def_id(goal.predicate)),
          cx,
          goal.predicate.trait_ref.args,
          d_PolyTraitRef,
        ),
        (bound_trait_ref) =>
          goal_with(
            goal,
            cx,
            Unnormalized.skip_norm_wip(
              UnnormalizedPolyTraitRef.to_host_effect_clause(bound_trait_ref, cx, goal.predicate.constness),
            ),
            Predicate_upcast_from_Clause,
          ),
      );
      // While you could think of trait aliases to have a single builtin impl
      // which uses its implied trait bounds as where-clauses, using
      // `GoalSource::ImplWhereClause` here would be incorrect, as we also
      // impl them, which means we're "stepping out of the impl constructor"
      // again. To handle this, we treat these cycles as ambiguous for now.
      const r1 = ecx.add_goals(GoalSource.Misc, where_clause_bounds);
      if (r1.$ === "Err") return r1;
      const r2 = ecx.add_goals(GoalSource.Misc, const_conditions);
      if (r2.$ === "Err") return r2;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:251 consider_builtin_sizedness_candidates
  consider_builtin_sizedness_candidates(
    _ecx: EvalCtxt,
    _goal: GoalT<HostEffectClauseT>,
    _sizedness: SizedTraitKind,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: Sized/MetaSized is never const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:259 consider_builtin_copy_clone_candidate
  consider_builtin_copy_clone_candidate(ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    const cx = ecx.cx();

    const self_ty = HostEffectClause.self_ty(goal.predicate);
    const constituent_tys_r = instantiate_constituent_tys_for_copy_clone_trait(ecx, self_ty);
    if (constituent_tys_r.$ === "Err") return from_no_solution(constituent_tys_r._0);
    const constituent_tys: Binder<readonly Ty[]> = constituent_tys_r._0;

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.enter_forall_with_assumptions(
        constituent_tys,
        goal.param_env,
        (ecx, tys) =>
          ecx.add_goals(
            GoalSource.ImplWhereBound,
            map_iter(tys, (ty) =>
              goal_with(
                goal,
                cx,
                { $: "HostEffect", _0: HostEffectClause.with_replaced_self_ty(goal.predicate, as_interner(cx), ty) } as ClauseKind,
                Predicate_upcast_from_ClauseKind,
              ),
            ),
          ),
        fold_Vec(fold_Ty),
      );
      if (r.$ === "Err") return r;

      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:288 consider_builtin_fn_ptr_trait_candidate
  consider_builtin_fn_ptr_trait_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return panic("not implemented: Fn* are not yet const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:296 consider_builtin_fn_trait_candidates
  consider_builtin_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: GoalT<HostEffectClauseT>,
    _kind: ClosureKind,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    const cx = ecx.cx();

    const self_ty = HostEffectClause.self_ty(goal.predicate);
    const extracted = extract_fn_def_from_const_callable(cx, self_ty);
    if (extracted.$ === "Err") return from_no_solution(extracted._0);
    const [inputs_and_output, def_id, args] = extracted._0;
    const [inputs, output] = ecx.instantiate_binder_with_infer(inputs_and_output, fold_tuple2(fold_Ty, fold_Ty));

    // A built-in `Fn` impl only holds if the output is sized.
    // (FIXME: technically we only need to check this if the type is a fn ptr...)
    const output_is_sized_pred = TraitRefC.new(
      as_interner(cx),
      cx.require_trait_lang_item(SolverTraitLangItem.Sized),
      [output],
    );
    const requirements = (function* (): Generator<[GoalSource, GoalT<Predicate>]> {
      yield* map_iter(iter_instantiated(cx.ir_const_conditions(def_id), cx, args, d_PolyTraitRef), (trait_ref): [
        GoalSource,
        GoalT<Predicate>,
      ] => [
        GoalSource.ImplWhereBound,
        goal_with(
          goal,
          cx,
          Unnormalized.skip_norm_wip(UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, cx, goal.predicate.constness)),
          Predicate_upcast_from_Clause,
        ),
      ]);
      yield [GoalSource.ImplWhereBound, goal_with(goal, cx, output_is_sized_pred, Predicate_upcast_from_TraitRef)];
    })();

    const pred = PolyTraitRef.to_host_effect_clause(
      Binder.dummy(
        TraitRefC.new(as_interner(cx), HostEffectClause.def_id(goal.predicate), [HostEffectClause.self_ty(goal.predicate), inputs]),
        d_TraitRef,
      ),
      cx,
      goal.predicate.constness,
    );

    return GoalKind_HostEffectClause.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource.Misc },
      goal,
      pred,
      requirements,
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:345 consider_builtin_async_fn_trait_candidates
  consider_builtin_async_fn_trait_candidates(
    _ecx: EvalCtxt,
    _goal: GoalT<HostEffectClauseT>,
    _kind: ClosureKind,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return panic("not implemented: AsyncFn* are not yet const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:353 consider_builtin_async_fn_kind_helper_candidate
  consider_builtin_async_fn_kind_helper_candidate(
    _ecx: EvalCtxt,
    _goal: GoalT<HostEffectClauseT>,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: AsyncFnKindHelper is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:360 consider_builtin_tuple_candidate
  consider_builtin_tuple_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: Tuple trait is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:367 consider_builtin_pointee_candidate
  consider_builtin_pointee_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: Pointee is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:374 consider_builtin_future_candidate
  consider_builtin_future_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: Future is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:381 consider_builtin_iterator_candidate
  consider_builtin_iterator_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return Err(NoSolutionOrRerunNonErased.from_NoSolution(NO_SOLUTION));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:388 consider_builtin_fused_iterator_candidate
  consider_builtin_fused_iterator_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: FusedIterator is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:395 consider_builtin_async_iterator_candidate
  consider_builtin_async_iterator_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: AsyncIterator is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:402 consider_builtin_coroutine_candidate
  consider_builtin_coroutine_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: Coroutine is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:409 consider_builtin_discriminant_kind_candidate
  consider_builtin_discriminant_kind_candidate(
    _ecx: EvalCtxt,
    _goal: GoalT<HostEffectClauseT>,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: DiscriminantKind is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:416 consider_builtin_destruct_candidate
  consider_builtin_destruct_candidate(ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    const cx = ecx.cx();

    const self_ty = HostEffectClause.self_ty(goal.predicate);
    const const_conditions_r = const_conditions_for_destruct(cx, self_ty);
    if (const_conditions_r.$ === "Err") return from_no_solution(const_conditions_r._0);
    const const_conditions = const_conditions_r._0;

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.add_goals(
        GoalSource.AliasBoundConstCondition,
        map_iter(const_conditions, (trait_ref) =>
          goal_with(
            goal,
            cx,
            PolyTraitRef.to_host_effect_clause(Binder.dummy(trait_ref, d_TraitRef), cx, goal.predicate.constness),
            Predicate_upcast_from_Clause,
          ),
        ),
      );
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:440 consider_builtin_transmute_candidate
  consider_builtin_transmute_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: TransmuteFrom is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:447 consider_builtin_bikeshed_guaranteed_no_drop_candidate
  consider_builtin_bikeshed_guaranteed_no_drop_candidate(
    _ecx: EvalCtxt,
    _goal: GoalT<HostEffectClauseT>,
  ): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: BikeshedGuaranteedNoDrop is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:454 consider_builtin_try_as_dyn_candidate
  consider_builtin_try_as_dyn_candidate(_ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable(
      `internal error: entered unreachable code: \`TryAsDynCompat\` is not const: ${debug_Goal(goal, PLAIN, debug_HostEffectClause)}`,
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:461 consider_structural_builtin_unsize_candidates
  consider_structural_builtin_unsize_candidates(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate[], RerunNonErased> {
    return unreachable("internal error: entered unreachable code: Unsize is not const");
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:468 consider_builtin_field_candidate
  consider_builtin_field_candidate(_ecx: EvalCtxt, _goal: GoalT<HostEffectClauseT>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return unreachable("internal error: entered unreachable code: Field is not const");
  },

  // (provided, not overridden)
  probe_and_consider_implied_clause(ecx: EvalCtxt, parent_source: CandidateSourceT, goal: GoalT<HostEffectClauseT>, assumption: Clause, requirements: Iterable<[GoalSource, GoalT<Predicate>]>): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return GoalKind_provided.probe_and_consider_implied_clause(GoalKind_HostEffectClause, ecx, parent_source, goal, assumption, requirements);
  },

  // (provided, not overridden)
  probe_and_consider_object_bound_candidate(ecx: EvalCtxt, source: CandidateSourceT, goal: GoalT<HostEffectClauseT>, assumption: Clause): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return GoalKind_provided.probe_and_consider_object_bound_candidate(GoalKind_HostEffectClause, ecx, source, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_consider_param_env_candidate(ecx: EvalCtxt, goal: GoalT<HostEffectClauseT>, assumption: Clause): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased> {
    return GoalKind_provided.probe_and_consider_param_env_candidate(GoalKind_HostEffectClause, ecx, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_match_goal_against_assumption(ecx: EvalCtxt, source: CandidateSourceT, goal: GoalT<HostEffectClauseT>, assumption: Clause, then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): Result<Candidate, NoSolutionOrRerunNonErasedT> {
    return GoalKind_provided.probe_and_match_goal_against_assumption(GoalKind_HostEffectClause, ecx, source, goal, assumption, then);
  },

};

// rustc: compiler/rustc_next_trait_solver/src/solve/effect_goals.rs:482 compute_host_effect_goal
EvalCtxt.prototype.compute_host_effect_goal = function (this: EvalCtxt, goal: GoalT<HostEffectClauseT>): QueryResultOrRerunNonErased {
  const r = this.probe<[CanonicalResponse, TraitGoalProvenVia | undefined]>(() => ProbeKind.ShadowedEnvProbing).enter((ecx) => {
    const trait_goal = Goal.with(goal, as_interner(ecx.cx()), goal.predicate.trait_ref, TraitClause.upcast_from_TraitRef);
    return ecx.compute_trait_goal(trait_goal);
  });
  if (r.$ === "Err") return r;
  const [, proven_via] = r._0;
  return this.assemble_and_merge_candidates(
    proven_via,
    goal,
    (_ecx) => undefined,
    (_ecx) => Err(NoSolutionOrRerunNonErased.from_NoSolution(NO_SOLUTION)),
    GoalKind_HostEffectClause,
  );
};
