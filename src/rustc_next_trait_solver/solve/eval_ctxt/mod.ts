// Contract stub for compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs (lane evalctxt-contract; the file
// belongs to lane nts-eval). The `EvalCtxt` struct and its methods are declared in ../../decls.ts
// (`// solve/eval_ctxt/mod.rs:<line>`); the calls at the end install `unported(..)` placeholders for the methods and
// the two statics. To fill one: assign `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` (a static:
// `EvalCtxt.enter_root = function ..`) with the `// rustc:` marker above it, in upstream order, and delete the name
// from its list (the call when the list is empty). The other items of the file (types, the `SolverDelegateEvalExt`
// trait and its blanket impl, free fns) are below with their final signatures: fill them in place and add the marker.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): lib.ts loads it after decls.ts; its top-level
// code may touch only `EvalCtxt` (decls.ts) and other crates.
//
// PORT: `trait SolverDelegateEvalExt: SolverDelegate` has one blanket impl (`impl<D: SolverDelegate>
// SolverDelegateEvalExt for D`): the interface `SolverDelegateEvalExt` (markers on the trait's declarations) and the
// impl object `SolverDelegateEvalExt_for_D`, whose fns take the delegate as `self` first (rustc_type_ir's
// `RelateExt_for_Infcx` precedent). Callers write `SolverDelegateEvalExt_for_D.evaluate_root_goal(delegate, ..)`.
// PORT: `evaluate_root_goal_for_proof_tree_raw_provider::<D, I>` is generic over `D` without a `D` value: it takes the
// `SolverDelegate_static` table first (decls.ts header).
// PORT: the structs local to fn bodies (`ContainsTermOrNotNameable` in `term_is_fully_unconstrained`,
// `NonTrivialVars` in `filter_irrelevant_region_constraints`) are ported inside their fns.
import type { Span } from "../../../rustc_span/lib.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { CanonicalInput, GenericArgs, Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { OpaqueTypeKey } from "../../../rustc_type_ir/decls.ts";
import type { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import type { RequiredDepth } from "../../../rustc_type_ir/search_graph/mod.ts";
import type { GoalEvaluation as inspect_GoalEvaluation, Probe } from "../../../rustc_type_ir/solve/inspect.ts";
import type {
  AccessedOpaques,
  ExternalConstraintsData,
  Goal,
  GoalStalledOn,
  NestedNormalizationGoals,
  NoSolution,
  NoSolutionOrRerunNonErased,
  QueryInput,
  QueryResult,
} from "../../../rustc_type_ir/solve/mod.ts";
import type { Debug } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import type { Result } from "../../../std/result.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";
import type { SolverDelegate, SolverDelegate_static } from "../../delegate.ts";
import type { GoalEvaluation } from "../mod.ts";

/// The kind of goal we're currently proving.
///
/// This has effects on cycle handling handling and on how we compute
/// query responses, see the variant descriptions for more info.
// PORT: `#[derive(Debug, Copy, Clone)]` fieldless enum; `impl CurrentGoalKind` is its companion.
export type CurrentGoalKind =
  | "Misc"
  /// We're proving an trait goal for a coinductive trait, either an auto trait or `Sized`.
  ///
  /// These are currently the only goals whose impl where-clauses are considered to be
  /// productive steps.
  | "CoinductiveTrait"
  /// A `ProjectionGoal`. These are temporarily special wrt to cycle handling.
  | "Projection"
  // FIXME: Consider renaming `PredicateKind::NormalizesTo` to match with this
  /// Unlike other goals, `NormalizesTo` goals aren't independent goals but just implementation
  /// details for handling projections of associated terms. When we encounter a `Projection` goal
  /// whose `projection_term` is an associated term, we create a `NormalizesTo` goal whose
  /// expected term is fully unconstrained and evaluate it.
  ///
  /// This would weaken inference however, as the nested goals of normalizes-to never get the
  /// inference constraints from the actual expected term. We just gather candidates from the
  /// normalizes-to goal and return any ambiguous nested goals of it to the caller (`Projection
  /// goal`). The caller handle and evaluate them as if they were its own nested goals.
  ///
  /// Because of this, evaluating a normalizes-to goal is computing candidates for projection of
  /// an associated term and it never leaks out of the solver.
  | "ProjectionComputeAssocTermCandidate";
export const CurrentGoalKind = {
  Misc: "Misc",
  CoinductiveTrait: "CoinductiveTrait",
  Projection: "Projection",
  ProjectionComputeAssocTermCandidate: "ProjectionComputeAssocTermCandidate",

  from_query_input(_cx: TyCtxt, _input: QueryInput<Predicate>): CurrentGoalKind {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::CurrentGoalKind::from_query_input");
  },
} as const;
export const debug_CurrentGoalKind: Debug<CurrentGoalKind> = (v) => v;

// PORT: `#[derive(PartialEq, Eq, Debug, Hash, Clone, Copy)]` (+ `StableHash`, M5) fieldless enum.
export type GenerateProofTree = "Yes" | "No";
export const GenerateProofTree = { Yes: "Yes", No: "No" } as const;
export const debug_GenerateProofTree: Debug<GenerateProofTree> = (v) => v;

// rustc-trait: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:176 SolverDelegateEvalExt
export interface SolverDelegateEvalExt {
  /// Evaluates a goal from **outside** of the trait solver.
  ///
  /// Using this while inside of the solver is wrong as it uses a new
  /// search graph which would break cycle detection.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:181 evaluate_root_goal
  evaluate_root_goal(
    self: SolverDelegate,
    goal: Goal<Predicate>,
    span: Span,
    stalled_on: GoalStalledOn | undefined,
  ): Result<GoalEvaluation, NoSolution>;

  /// Checks whether a stalled goal would remain stalled if re-evaluated, without consuming
  /// `stalled_on`.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:190 goal_remains_stalled
  goal_remains_stalled(self: SolverDelegate, stalled_on: GoalStalledOn): boolean;

  /// Checks whether evaluating `goal` may hold while treating not-yet-defined
  /// opaque types as being kind of rigid.
  ///
  /// See the comment on [OpaqueTypesJank] for more details.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:196 root_goal_may_hold_opaque_types_jank
  root_goal_may_hold_opaque_types_jank(self: SolverDelegate, goal: Goal<Predicate>): boolean;

  /// Check whether evaluating `goal` with a depth of `root_depth` may
  /// succeed. This only returns `false` if the goal is guaranteed to
  /// not hold. In case evaluation overflows and fails with ambiguity this
  /// returns `true`.
  ///
  /// This is only intended to be used as a performance optimization
  /// in coherence checking.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:208 root_goal_may_hold_with_depth
  root_goal_may_hold_with_depth(self: SolverDelegate, root_depth: number, goal: Goal<Predicate>): boolean;

  // FIXME: This is only exposed because we need to use it in `analyse.rs`
  // which is not yet uplifted. Once that's done, we should remove this.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:216 evaluate_root_goal_for_proof_tree
  evaluate_root_goal_for_proof_tree(
    self: SolverDelegate,
    goal: Goal<Predicate>,
    span: Span,
  ): [Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation];
}

/** `impl<D, I> SolverDelegateEvalExt for D where D: SolverDelegate<Interner = I>` (header). */
export const SolverDelegateEvalExt_for_D: SolverDelegateEvalExt = {
  evaluate_root_goal(
    _self: SolverDelegate,
    _goal: Goal<Predicate>,
    _span: Span,
    _stalled_on: GoalStalledOn | undefined,
  ): Result<GoalEvaluation, NoSolution> {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::SolverDelegateEvalExt for D::evaluate_root_goal");
  },

  // This function is very hot and has a single call site.
  goal_remains_stalled(_self: SolverDelegate, _stalled_on: GoalStalledOn): boolean {
    return unported("rustc_next_trait_solver::solve::eval_ctxt::SolverDelegateEvalExt for D::goal_remains_stalled");
  },

  root_goal_may_hold_opaque_types_jank(_self: SolverDelegate, _goal: Goal<Predicate>): boolean {
    return unported(
      "rustc_next_trait_solver::solve::eval_ctxt::SolverDelegateEvalExt for D::root_goal_may_hold_opaque_types_jank",
    );
  },

  root_goal_may_hold_with_depth(_self: SolverDelegate, _root_depth: number, _goal: Goal<Predicate>): boolean {
    return unported(
      "rustc_next_trait_solver::solve::eval_ctxt::SolverDelegateEvalExt for D::root_goal_may_hold_with_depth",
    );
  },

  evaluate_root_goal_for_proof_tree(
    _self: SolverDelegate,
    _goal: Goal<Predicate>,
    _span: Span,
  ): [Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation] {
    return unported(
      "rustc_next_trait_solver::solve::eval_ctxt::SolverDelegateEvalExt for D::evaluate_root_goal_for_proof_tree",
    );
  },
};

/// The old solver doesn't check depth requirement when looking up cache while the next solver
/// does so. Thus the next solver is more prone to overflow. To mitigate breakages, we re-evaluate
/// the overflowed goal with doubled recursion limit and emit a FCW if doing so prevents overflow.
///
/// See the doc comment on `RECURSION_DEPTH_EXCEEDING_LIMIT` and #159228 for more details.
// PORT: `initial_result: &mut Result<..>` is a `MutRef` (PORTING §8).
export function maybe_evaluate_root_goal_with_higher_recursion_limit(
  _delegate: SolverDelegate,
  _goal: Goal<Predicate>,
  _span: Span,
  _initial_result: MutRef<Result<GoalEvaluation, NoSolutionOrRerunNonErased>>,
): void {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::maybe_evaluate_root_goal_with_higher_recursion_limit");
}

/// The old solver doesn't check depth requirement when looking up cache while the next solver
/// does so. Thus the next solver is more prone to overflow. To mitigate breakages, we re-evaluate
/// the overflowed goal with doubled recursion limit and emit a FCW if doing so prevents overflow.
///
/// See the doc comment on `RECURSION_DEPTH_EXCEEDING_LIMIT` and #159228 for more details.
// PORT: `initial_result: &mut (..)` is a `MutRef` (PORTING §8).
export function maybe_evaluate_root_goal_for_proof_tree_with_higher_recursion_limit(
  _delegate: SolverDelegate,
  _goal: Goal<Predicate>,
  _span: Span,
  _initial_result: MutRef<[Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation]>,
): void {
  return unported(
    "rustc_next_trait_solver::solve::eval_ctxt::maybe_evaluate_root_goal_for_proof_tree_with_higher_recursion_limit",
  );
}

// PORT: `external_constraints: &mut ExternalConstraintsData<I>` is mutated in place.
export function filter_irrelevant_region_constraints(
  _delegate: SolverDelegate,
  _var_values: GenericArgs,
  _external_constraints: ExternalConstraintsData,
): void {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::filter_irrelevant_region_constraints");
}

// PORT: `#[derive(Debug)]` fieldless enum.
export type RerunDecision = "Yes" | "No" | "EagerlyPropagateToParent";
export const RerunDecision = { Yes: "Yes", No: "No", EagerlyPropagateToParent: "EagerlyPropagateToParent" } as const;
export const debug_RerunDecision: Debug<RerunDecision> = (v) => v;

// PORT: the destructuring parameter `AccessedOpaques { reason: _, rerun }: AccessedOpaques<I>` is `_0`.
export function should_rerun_after_erased_canonicalization(
  _0: AccessedOpaques,
  _original_typing_mode: TypingMode,
  _parent_opaque_types: readonly [OpaqueTypeKey, Ty][],
): RerunDecision {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::should_rerun_after_erased_canonicalization");
}

/// Do not call this directly, use the `tcx` query instead.
export function evaluate_root_goal_for_proof_tree_raw_provider(
  _D: SolverDelegate_static,
  _cx: TyCtxt,
  _canonical_goal: CanonicalInput,
  _root_depth: number,
): [QueryResult, Probe, RequiredDepth] {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::evaluate_root_goal_for_proof_tree_raw_provider");
}

/// Evaluate a goal to build a proof tree.
///
/// This is a copy of [EvalCtxt::evaluate_goal_raw] which avoids relying on the
/// [EvalCtxt] and uses a separate cache.
export function evaluate_root_goal_for_proof_tree(
  _delegate: SolverDelegate,
  _goal: Goal<Predicate>,
  _origin_span: Span,
  _root_depth: number,
): [Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation] {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::evaluate_root_goal_for_proof_tree");
}

unported_methods(EvalCtxt, "rustc_next_trait_solver::solve::eval_ctxt::EvalCtxt", ["enter_root", "enter_canonical"]);

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::eval_ctxt::EvalCtxt", [
  "typing_mode",
  "step_kind_to_nested",
  "ignore_candidate_head_usages",
  "evaluate_goal",
  "evaluate_goal_no_fast_paths",
  "evaluate_in_search_graph",
  "evaluate_goal_raw",
  "build_stalled_on",
  "compute_goal",
  "try_evaluate_added_goals",
  "evaluate_added_goals_step",
  "record_impl_args",
  "cx",
  "add_goal",
  "add_goals",
  "next_region_var",
  "next_ty_infer",
  "next_const_infer",
  "next_term_infer_of_alias_kind",
  "term_is_fully_unconstrained",
  "sub_unify_ty_vids_raw",
  "eq",
  "sub",
  "relate",
  "eq_and_get_goals",
  "instantiate_binder_with_infer",
  "enter_forall_with_assumptions",
  "deeply_resolve_ignoring_regions",
  "shallow_resolve",
  "eager_resolve_region",
  "fresh_args_for_item",
  "register_solver_region_constraint",
  "register_ty_outlives",
  "register_region_outlives",
  "well_formed_goals",
  "trait_ref_is_knowable",
  "fetch_eligible_assoc_item",
  "register_hidden_type_in_storage",
  "add_item_bounds_for_hidden_type",
  "evaluate_const",
  "evaluate_const_and_instantiate_projection_term",
  "is_transmutable",
  "replace_bound_vars",
  "may_use_unstable_feature",
  "opaques_with_sub_unified_hidden_type",
  "evaluate_added_goals_and_make_canonical_response",
  "make_ambiguous_response_no_constraints",
  "compute_external_query_constraints",
  "normalize",
]);
