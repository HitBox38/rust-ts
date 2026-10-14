//! Dealing with host effect goals, i.e. enforcing the constness in
//! `T: const Trait` or `T: [const] Trait`.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/effect_goals.rs (lane evalctxt-contract; the file belongs
// to lane nts-normalizes). `impl<D, I> assembly::GoalKind<D> for ty::HostEffectClause<I>` is the table
// `GoalKind_HostEffectClause` (assembly/mod.ts header): its supertrait entries are wired, its methods are stubs with
// final signatures (fill each in place and add the `// rustc:` marker). Provided methods it does not override forward to
// `GoalKind_provided`. The `EvalCtxt` method is declared in ../decls.ts (`// solve/effect_goals.rs:<line>`); the call at
// the end installs its `unported(..)` placeholder: assign `EvalCtxt.prototype.compute_host_effect_goal = function ..`
// with the marker and delete the call. Extension module (docs/handoff/evalctxt-contract.md "Init order").
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Predicate, Ty } from "../../rustc_middle/ty/decls.ts";
import type { AliasTy, ClosureKind, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { CandidateHeadUsages } from "../../rustc_type_ir/search_graph/mod.ts";
import type {
  CandidateSource,
  Goal,
  GoalSource,
  NoSolution,
  NoSolutionOrRerunNonErased,
  QueryResultOrRerunNonErased,
  RerunNonErased,
  SizedTraitKind,
} from "../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { EvalCtxt } from "../decls.ts";
import { type Candidate, type GoalKind, GoalKind_provided } from "./assembly/mod.ts";
import type { HostEffectClause } from "../../rustc_type_ir/decls.ts";
import { display_HostEffectClause } from "../../rustc_type_ir/ir_print.ts";
import {
  fold_with_HostEffectClause,
  try_fold_with_HostEffectClause,
  visit_with_HostEffectClause,
} from "../../rustc_type_ir/predicate.gen.ts";

/** `impl<D, I> assembly::GoalKind<D> for ty::HostEffectClause<I>` (header). */
export const GoalKind_HostEffectClause: GoalKind<HostEffectClause> = {
  visit_with: visit_with_HostEffectClause,
  try_fold_with: try_fold_with_HostEffectClause,
  fold_with: fold_with_HostEffectClause,
  // PORT: derived `PartialEq` of a plain value over interned children: equal canonical keys (rust_ts/intern_key.ts).
  eq: (a, b) => intern_key(a) === intern_key(b),
  display: display_HostEffectClause,

  self_ty(_self: HostEffectClause): Ty {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::self_ty");
  },

  trait_ref(_self: HostEffectClause, _cx: TyCtxt): TraitRef {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::trait_ref");
  },

  with_replaced_self_ty(_self: HostEffectClause, _cx: TyCtxt, _self_ty: Ty): HostEffectClause {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::with_replaced_self_ty");
  },

  trait_def_id(_self: HostEffectClause, _cx: TyCtxt): DefId {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::trait_def_id");
  },

  fast_reject_assumption(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _assumption: Clause): Result<undefined, NoSolution> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::fast_reject_assumption");
  },

  match_assumption(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _assumption: Clause, _then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): QueryResultOrRerunNonErased {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::match_assumption");
  },

  consider_additional_alias_assumptions(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _alias_ty: AliasTy): Candidate[] {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_additional_alias_assumptions");
  },

  consider_impl_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _goal_trait_ref: TraitRef, _impl_def_id: DefId, _then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_impl_candidate");
  },

  consider_error_guaranteed_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _guar: ErrorGuaranteed): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_error_guaranteed_candidate");
  },

  consider_auto_trait_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_auto_trait_candidate");
  },

  consider_trait_alias_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_trait_alias_candidate");
  },

  consider_builtin_sizedness_candidates(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _sizedness: SizedTraitKind): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_sizedness_candidates");
  },

  consider_builtin_copy_clone_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_copy_clone_candidate");
  },

  consider_builtin_fn_ptr_trait_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_fn_ptr_trait_candidate");
  },

  consider_builtin_fn_trait_candidates(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _kind: ClosureKind): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_fn_trait_candidates");
  },

  consider_builtin_async_fn_trait_candidates(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>, _kind: ClosureKind): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_async_fn_trait_candidates");
  },

  consider_builtin_async_fn_kind_helper_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_async_fn_kind_helper_candidate");
  },

  consider_builtin_tuple_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_tuple_candidate");
  },

  consider_builtin_pointee_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_pointee_candidate");
  },

  consider_builtin_future_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_future_candidate");
  },

  consider_builtin_iterator_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_iterator_candidate");
  },

  consider_builtin_fused_iterator_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_fused_iterator_candidate");
  },

  consider_builtin_async_iterator_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_async_iterator_candidate");
  },

  consider_builtin_coroutine_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_coroutine_candidate");
  },

  consider_builtin_discriminant_kind_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_discriminant_kind_candidate");
  },

  consider_builtin_destruct_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_destruct_candidate");
  },

  consider_builtin_transmute_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_transmute_candidate");
  },

  consider_builtin_bikeshed_guaranteed_no_drop_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_bikeshed_guaranteed_no_drop_candidate");
  },

  consider_builtin_try_as_dyn_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_try_as_dyn_candidate");
  },

  consider_structural_builtin_unsize_candidates(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate[], RerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_structural_builtin_unsize_candidates");
  },

  consider_builtin_field_candidate(_ecx: EvalCtxt, _goal: Goal<HostEffectClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::effect_goals::GoalKind for HostEffectClause::consider_builtin_field_candidate");
  },

  // (provided, not overridden)
  probe_and_consider_implied_clause(ecx: EvalCtxt, parent_source: CandidateSource, goal: Goal<HostEffectClause>, assumption: Clause, requirements: Iterable<[GoalSource, Goal<Predicate>]>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_consider_implied_clause(GoalKind_HostEffectClause, ecx, parent_source, goal, assumption, requirements);
  },

  // (provided, not overridden)
  probe_and_consider_object_bound_candidate(ecx: EvalCtxt, source: CandidateSource, goal: Goal<HostEffectClause>, assumption: Clause): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_consider_object_bound_candidate(GoalKind_HostEffectClause, ecx, source, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_consider_param_env_candidate(ecx: EvalCtxt, goal: Goal<HostEffectClause>, assumption: Clause): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased> {
    return GoalKind_provided.probe_and_consider_param_env_candidate(GoalKind_HostEffectClause, ecx, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_match_goal_against_assumption(ecx: EvalCtxt, source: CandidateSource, goal: Goal<HostEffectClause>, assumption: Clause, then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_match_goal_against_assumption(GoalKind_HostEffectClause, ecx, source, goal, assumption, then);
  },

};

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::effect_goals::EvalCtxt", [
  "compute_host_effect_goal",
]);
