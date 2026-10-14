//! Dealing with trait goals, i.e. `T: Trait<'a, U>`.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/trait_goals.rs (lane evalctxt-contract; the file belongs
// to lane nts-trait-goals). `impl<D, I> assembly::GoalKind<D> for TraitClause<I>` is the table `GoalKind_TraitClause`
// (assembly/mod.ts header): its supertrait entries are wired, its methods are stubs with final signatures (fill each in
// place and add the `// rustc:` marker; the nested fn `trait_def_id_matches` of `fast_reject_assumption` is ported inside
// it). Provided methods it does not override forward to `GoalKind_provided` (nothing to port). `TraitGoalProvenVia` is
// final; `trait_predicate_with_def_id` is a stub with its final signature. The `EvalCtxt` methods are declared in
// ../decls.ts (`// solve/trait_goals.rs:<line>`); the call at the end installs `unported(..)` placeholders: assign
// `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` with the marker and delete the name from the list.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): the table's forwarders read `GoalKind_provided`
// only when called.
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
import type { Binder, TraitClause } from "../../rustc_type_ir/decls.ts";
import { display_TraitClause } from "../../rustc_type_ir/ir_print.ts";
import { fold_with_TraitClause, try_fold_with_TraitClause, visit_with_TraitClause } from "../../rustc_type_ir/predicate.ts";
import type { Debug } from "../../std/fmt.ts";

/** `impl<D, I> assembly::GoalKind<D> for TraitClause<I>` (header). */
export const GoalKind_TraitClause: GoalKind<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
  // PORT: derived `PartialEq` of a plain value over interned children: equal canonical keys (rust_ts/intern_key.ts).
  eq: (a, b) => intern_key(a) === intern_key(b),
  display: display_TraitClause,

  self_ty(_self: TraitClause): Ty {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::self_ty");
  },

  trait_ref(_self: TraitClause, _cx: TyCtxt): TraitRef {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::trait_ref");
  },

  with_replaced_self_ty(_self: TraitClause, _cx: TyCtxt, _self_ty: Ty): TraitClause {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::with_replaced_self_ty");
  },

  trait_def_id(_self: TraitClause, _cx: TyCtxt): DefId {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::trait_def_id");
  },

  consider_additional_alias_assumptions(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _alias_ty: AliasTy): Candidate[] {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_additional_alias_assumptions");
  },

  consider_impl_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _goal_trait_ref: TraitRef, _impl_def_id: DefId, _then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_impl_candidate");
  },

  consider_error_guaranteed_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _guar: ErrorGuaranteed): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_error_guaranteed_candidate");
  },

  fast_reject_assumption(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _assumption: Clause): Result<undefined, NoSolution> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::fast_reject_assumption");
  },

  match_assumption(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _assumption: Clause, _then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): QueryResultOrRerunNonErased {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::match_assumption");
  },

  consider_auto_trait_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_auto_trait_candidate");
  },

  consider_trait_alias_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_trait_alias_candidate");
  },

  consider_builtin_sizedness_candidates(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _sizedness: SizedTraitKind): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_sizedness_candidates");
  },

  consider_builtin_copy_clone_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_copy_clone_candidate");
  },

  consider_builtin_fn_ptr_trait_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_fn_ptr_trait_candidate");
  },

  consider_builtin_fn_trait_candidates(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _kind: ClosureKind): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_fn_trait_candidates");
  },

  consider_builtin_async_fn_trait_candidates(_ecx: EvalCtxt, _goal: Goal<TraitClause>, _kind: ClosureKind): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_async_fn_trait_candidates");
  },

  consider_builtin_async_fn_kind_helper_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_async_fn_kind_helper_candidate");
  },

  consider_builtin_tuple_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_tuple_candidate");
  },

  consider_builtin_pointee_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_pointee_candidate");
  },

  consider_builtin_future_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_future_candidate");
  },

  consider_builtin_iterator_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_iterator_candidate");
  },

  consider_builtin_fused_iterator_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_fused_iterator_candidate");
  },

  consider_builtin_async_iterator_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_async_iterator_candidate");
  },

  consider_builtin_coroutine_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_coroutine_candidate");
  },

  consider_builtin_discriminant_kind_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_discriminant_kind_candidate");
  },

  consider_builtin_destruct_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_destruct_candidate");
  },

  consider_builtin_transmute_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_transmute_candidate");
  },

  consider_builtin_bikeshed_guaranteed_no_drop_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_bikeshed_guaranteed_no_drop_candidate");
  },

  consider_structural_builtin_unsize_candidates(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate[], RerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_structural_builtin_unsize_candidates");
  },

  consider_builtin_try_as_dyn_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_try_as_dyn_candidate");
  },

  consider_builtin_field_candidate(_ecx: EvalCtxt, _goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::trait_goals::GoalKind for TraitClause::consider_builtin_field_candidate");
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
export function trait_predicate_with_def_id(_cx: TyCtxt, _clause: Binder<TraitClause>, _did: DefId): Clause {
  return unported("rustc_next_trait_solver::solve::trait_goals::trait_predicate_with_def_id");
}

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

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::trait_goals::EvalCtxt", [
  "consider_builtin_dyn_upcast_candidates",
  "consider_builtin_unsize_to_dyn_candidate",
  "consider_builtin_upcast_to_principal",
  "consider_builtin_array_unsize",
  "consider_builtin_struct_unsize",
  "consider_auto_trait_candidate_for_opaque_ty",
  "disqualify_auto_trait_candidate_due_to_possible_impl",
  "probe_and_evaluate_goal_for_constituent_tys",
  "unsound_prefer_builtin_dyn_impl",
  "try_merge_impl_candidates",
  "merge_candidates_or_bail_with_ambiguity",
  "merge_impl_candidates_or_bail_with_ambiguity",
  "merge_trait_candidates",
  "compute_trait_goal",
  "try_stall_coroutine",
]);
