// Port of compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs (lane nts-eval; contract by lane
// evalctxt-contract). The `EvalCtxt` struct and its methods are declared in ../../decls.ts
// (`// solve/eval_ctxt/mod.rs:<line>`); this file assigns them onto `EvalCtxt.prototype` / `EvalCtxt` in upstream order.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): lib.ts loads it after decls.ts; its top-level
// code may touch only `EvalCtxt` (decls.ts) and other crates. Every other rustc_next_trait_solver import is read
// inside fn bodies only.
//
// PORT: `trait SolverDelegateEvalExt: SolverDelegate` has one blanket impl (`impl<D: SolverDelegate>
// SolverDelegateEvalExt for D`): the interface `SolverDelegateEvalExt` (markers on the trait's declarations) and the
// impl object `SolverDelegateEvalExt_for_D`, whose fns take the delegate as `self` first (rustc_type_ir's
// `RelateExt_for_Infcx` precedent). Callers write `SolverDelegateEvalExt_for_D.evaluate_root_goal(delegate, ..)`.
// PORT: `evaluate_root_goal_for_proof_tree_raw_provider::<D, I>` is generic over `D` without a `D` value: it takes the
// `SolverDelegate_static` table first (decls.ts header).
// PORT: the structs local to fn bodies (`ContainsTermOrNotNameable` in `term_is_fully_unconstrained`,
// `NonTrivialVars` in `filter_irrelevant_region_constraints`) are ported inside their fns.
// PORT: `self.delegate.<infcx method>` (auto-deref through `D: Deref<Target = D::Infcx>`) is
// `this.delegate.deref().<method>`; `SolverDelegate`'s own methods are called on the delegate (delegate.ts header).
// PORT: `I::Span::dummy()` is `DUMMY_SP` (`impl inherent::Span for rustc_span::Span`).
// PORT (D3): `cx()` is `TyCtxt` (decls.ts header); `Interner` methods `TyCtxt` does not type yet go through
// rustc_type_ir predicate.ts's `as_interner` cast (ty-contract/tyir-misc handoff), and the search graph's `X::Self`
// (`Interner`) gets the same cast (search_graph.ts header).
// PORT: `#[instrument]`, `debug!`, `trace!` and `tracing::span!` (tracing) produce no output in the oracle: kept as
// comments or dropped. `cfg!(debug_assertions)` blocks and `debug_assert*!` are comments (release oracle).
// PORT (D4): the descriptors of the concrete foldables this file traverses (`Goal<I, I::Predicate>`,
// `(OpaqueTypeKey, Ty)`, `QueryInput`, `PredicateKind`, `AliasConst`, `ExternalConstraintsData`, `Response`) are
// module-local, built from the generated `visit_with_*` / `try_fold_with_*` / `fold_with_*` fns (end of file).
import { type ControlFlow, ControlFlow as ControlFlowC, type VisitorResult, VisitorResult as VisitorResultC } from "../../../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { inherent_Features } from "../../../rustc_middle/ty/context.ts";
import type { CanonicalVarKinds, ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import {
  fold_GenericArgs,
  type GenericArg,
  GenericArg as GenericArgC,
  type GenericArgs,
  visit_with_GenericArg,
  visit_with_GenericArgs,
} from "../../../rustc_middle/ty/generic_args.ts";
import { type Clauses, RawList } from "../../../rustc_middle/ty/list.ts";
import {
  fold_Term,
  fold_with_Ty,
  type Term,
  Term as TermC,
  try_fold_with_Ty,
  type Ty,
  visit_with_ParamEnv,
  visit_with_Ty,
} from "../../../rustc_middle/ty/mod.ts";
import {
  fold_with_Predicate,
  type Predicate,
  Predicate_upcast_from_ProjectionClause,
  try_fold_with_Predicate,
  visit_with_Predicate,
} from "../../../rustc_middle/ty/predicate.ts";
import { debug_Predicate, debug_Ty, fold_Clauses, fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type CanonicalInput, CanonicalInput_deref } from "../../../rustc_middle/traits/solve.ts";
import { DefId_eq, type DefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../../rustc_span/lib.ts";
import type { Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import {
  fold_with_AliasConstKind,
  try_fold_with_AliasConstKind,
  visit_with_AliasConstKind,
} from "../../../rustc_type_ir/const_kind.ts";
import type { AliasConst, OpaqueTypeKey, TyVid, Variance } from "../../../rustc_type_ir/decls.ts";
import { NoSolution_from_TypeError, NoSolutionOrRerunNonErased_from_TypeError } from "../../../rustc_type_ir/error.ts";
import {
  type FallibleTypeFolder,
  fold_tuple2,
  fold_Vec,
  fold_with_tuple2,
  type FoldWith,
  type PredicateProxy,
  try_fold_with_tuple2,
  type TryFoldWith,
  type TypeFoldable,
  type TypeFolder,
} from "../../../rustc_type_ir/fold.ts";
import { MayBeErased, TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { may_use_unstable_feature } from "../../../rustc_type_ir/infer_ctxt.ts";
import { as_interner, type NormalizesTo, PolyTraitClause, type ProjectionClause, RegionConstraint as ty_RegionConstraint, TraitClause } from "../../../rustc_type_ir/predicate.ts";
import type { TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import { debug_PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import { fold_with_OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import { RegionConstraint } from "../../../rustc_type_ir/region_constraint.ts";
import { RelateExt_for_Infcx } from "../../../rustc_type_ir/relate/solver_relating.ts";
import { type Relate, relate_Term } from "../../../rustc_type_ir/relate.ts";
import {
  assert_eq_msg,
  type CandidateHeadUsages,
  type LowerAvailableDepth,
  PathKind,
  type RequiredDepth,
  SearchGraph as search_graph_SearchGraph,
} from "../../../rustc_type_ir/search_graph/mod.ts";
import type { GoalEvaluation as inspect_GoalEvaluation, Probe } from "../../../rustc_type_ir/solve/inspect.ts";
import {
  AccessedOpaques,
  type CanonicalResponse,
  Certainty,
  debug_AccessedOpaques,
  debug_Goal,
  debug_NoSolution,
  ExternalConstraintsData,
  type FetchEligibleAssocItemResponse,
  fold_with_ExternalConstraintsData,
  fold_with_Goal,
  fold_with_QueryInput,
  fold_with_Response,
  Goal,
  type GoalSource,
  type GoalStalledOn,
  type MaybeInfo,
  type NestedNormalizationGoals,
  NestedNormalizationGoals as NestedNormalizationGoalsC,
  type NoSolution,
  NoSolutionOrRerunNonErased,
  type QueryInput,
  type QueryResult,
  type QueryResultOrRerunNonErased,
  RerunResultExt_for_Result,
  type RerunNonErased,
  type Response,
  SmallCopySet,
  type SucceededInErased,
  type TyOrConstInferVar,
  try_fold_with_ExternalConstraintsData,
  try_fold_with_Goal,
  try_fold_with_QueryInput,
  try_fold_with_Response,
  type VisibleForLeakCheck,
  visit_with_ExternalConstraintsData,
  visit_with_Goal,
  visit_with_NestedNormalizationGoals,
  visit_with_QueryInput,
  visit_with_Response,
} from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { debug_Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { fold_Region, type Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_Alias, type OpaqueAliasTy, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { max_universe } from "../../../rustc_type_ir/universe.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self, type UpcastFrom } from "../../../rustc_type_ir/upcast.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided, visit_with_tuple2, visit_with_Vec, type VisitWith } from "../../../rustc_type_ir/visit.ts";
import { visit_with_RegionEqPredicate } from "../../../rustc_type_ir/predicate.ts";
import type { TypingMode as TypingModeT } from "../../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { type Debug, PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../../../std/panic.ts";
import { debug_result, Err, Ok, type Result } from "../../../std/result.ts";
import * as coherence from "../../coherence.ts";
import { canonicalize_goal, canonicalize_response, instantiate_and_apply_query_response, response_no_constraints_raw } from "../../canonical/mod.ts";
import { EvalCtxt } from "../../decls.ts";
import type { SolverDelegate, SolverDelegate_static } from "../../delegate.ts";
import { NormalizationFolder, type NormalizationWasAmbiguous } from "../../normalize.ts";
import { BoundVarReplacer } from "../../placeholder.ts";
import { EvaluationStepBuilder, ProofTreeBuilder } from "../inspect/build.ts";
import { FIXPOINT_STEP_LIMIT, type GoalEvaluation, has_only_region_constraints, HasChanged } from "../mod.ts";
import { SearchGraphDelegate } from "../search_graph.ts";
import {
  compute_goal_fast_path,
  compute_goal_fast_path_cold,
  inlined_rerunning_stalled_goal_may_make_progress,
  rerunning_stalled_goal_may_make_progress,
} from "./fast_path.ts";

/** PORT: the value of the unit struct `NoSolution` (an empty object, as rustc_type_ir error.ts builds it). */
const NoSolution: NoSolution = Object.freeze({});

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

  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:85 from_query_input
  from_query_input(cx: TyCtxt, input: QueryInput<Predicate>): CurrentGoalKind {
    const kind = Binder.skip_binder(input.goal.predicate.kind());
    if (kind.$ === "Clause" && kind._0.$ === "Trait") {
      const pred = kind._0._0;
      if (cx.trait_is_coinductive(pred.trait_ref.def_id)) {
        return CurrentGoalKind.CoinductiveTrait;
      } else {
        return CurrentGoalKind.Misc;
      }
    } else if (kind.$ === "Clause" && kind._0.$ === "Projection") {
      return CurrentGoalKind.Projection;
    } else if (kind.$ === "NormalizesTo") {
      return CurrentGoalKind.ProjectionComputeAssocTermCandidate;
    } else {
      return CurrentGoalKind.Misc;
    }
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
  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:232 evaluate_root_goal
  evaluate_root_goal(
    self: SolverDelegate,
    goal: Goal<Predicate>,
    span: Span,
    stalled_on: GoalStalledOn | undefined,
  ): Result<GoalEvaluation, NoSolution> {
    // Run fast paths *before* building an `EvalCtxt`, saving a little bit of time.
    const rerun = rerunning_stalled_goal_may_make_progress(self, stalled_on);
    if (rerun.$ === "WontMakeProgress") {
      const stalled_maybe_info = rerun._0;
      return Ok({
        goal,
        certainty: { $: "Maybe", _0: stalled_maybe_info },
        has_changed: HasChanged.No,
        stalled_on,
      });
    }

    // No need to try the fast path if stalled_on is `None`, since we already try the fast path
    // immediately when adding new goals. If we didn't check `stalled_on` here we'd be trying
    // the fast path twice for some goals.
    if (stalled_on !== undefined) {
      const res = compute_goal_fast_path_cold(self, goal, span);
      if (res !== undefined) {
        return Ok(res);
      }
    }

    const result: MutRef<Result<GoalEvaluation, NoSolutionOrRerunNonErased>> = {
      value: EvalCtxt.enter_root(self, self.cx().ir_recursion_limit(), span, (ecx) =>
        ecx.evaluate_goal_no_fast_paths("Misc", goal),
      ),
    };
    maybe_evaluate_root_goal_with_higher_recursion_limit(self, goal, span, result);

    const r = result.value;
    if (r.$ === "Ok") {
      return Ok(r._0);
    } else if (r._0.$ === "NoSolution") {
      return Err(NoSolution);
    } else {
      return unreachable("internal error: entered unreachable code: this never happens at the root, we're never in erased mode here");
    }
  },

  // This function is very hot and has a single call site.
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:275 goal_remains_stalled
  goal_remains_stalled(self: SolverDelegate, stalled_on: GoalStalledOn): boolean {
    const r = inlined_rerunning_stalled_goal_may_make_progress(self, stalled_on);
    switch (r.$) {
      case "WontMakeProgress":
        return true;
      case "MayMakeProgress":
        return false;
    }
  },

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:283 root_goal_may_hold_opaque_types_jank
  root_goal_may_hold_opaque_types_jank(self: SolverDelegate, goal: Goal<Predicate>): boolean {
    return self.deref().probe(() => {
      const r = SolverDelegateEvalExt_for_D.evaluate_root_goal(self, goal, DUMMY_SP, undefined);
      // `.is_ok_and(|r| match r.certainty { .. })`
      if (r.$ !== "Ok") return false;
      const certainty = r._0.certainty;
      switch (certainty.$) {
        case "Yes":
          return true;
        case "Maybe": {
          const opaque_types_jank = certainty._0.opaque_types_jank;
          switch (opaque_types_jank) {
            case "AllGood":
              return true;
            case "ErrorIfRigidSelfTy":
              return false;
          }
        }
      }
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:302 root_goal_may_hold_with_depth
  root_goal_may_hold_with_depth(self: SolverDelegate, root_depth: number, goal: Goal<Predicate>): boolean {
    return (
      self.deref().probe(() => {
        return EvalCtxt.enter_root(self, root_depth, DUMMY_SP, (ecx) => ecx.evaluate_goal("Misc", goal, undefined));
      }).$ === "Ok"
    );
  },

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:316 evaluate_root_goal_for_proof_tree
  evaluate_root_goal_for_proof_tree(
    self: SolverDelegate,
    goal: Goal<Predicate>,
    span: Span,
  ): [Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation] {
    const result = { value: evaluate_root_goal_for_proof_tree(self, goal, span, self.cx().ir_recursion_limit()) };
    maybe_evaluate_root_goal_for_proof_tree_with_higher_recursion_limit(self, goal, span, result);
    return result.value;
  },
};

/// The old solver doesn't check depth requirement when looking up cache while the next solver
/// does so. Thus the next solver is more prone to overflow. To mitigate breakages, we re-evaluate
/// the overflowed goal with doubled recursion limit and emit a FCW if doing so prevents overflow.
///
/// See the doc comment on `RECURSION_DEPTH_EXCEEDING_LIMIT` and #159228 for more details.
// PORT: `initial_result: &mut Result<..>` is a `MutRef` (PORTING §8).
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:338 maybe_evaluate_root_goal_with_higher_recursion_limit
export function maybe_evaluate_root_goal_with_higher_recursion_limit(
  delegate: SolverDelegate,
  goal: Goal<Predicate>,
  span: Span,
  initial_result: MutRef<Result<GoalEvaluation, NoSolutionOrRerunNonErased>>,
): void {
  if (!delegate.deref().enable_next_solver_overflow_fcw()) {
    return;
  }

  const ir = initial_result.value;
  let predicate: Predicate;
  if (ir.$ === "Err") {
    return;
  } else if (!Certainty.is_overflow(ir._0.certainty)) {
    return;
  } else {
    predicate = ir._0.goal.predicate;
  }

  // PORT: `Err(())` (a stored `()`) is `Err(null)`.
  const rerun_result = delegate.deref().commit_if_ok<Result<GoalEvaluation, NoSolutionOrRerunNonErased>, null>(() => {
    const rerun_result = EvalCtxt.enter_root(delegate, delegate.cx().ir_recursion_limit() * 2, span, (ecx) =>
      ecx.evaluate_goal_no_fast_paths("Misc", goal),
    );

    if (rerun_result.$ === "Ok" && Certainty.is_overflow(rerun_result._0.certainty)) {
      return Err(null);
    } else {
      return Ok(rerun_result);
    }
  });
  if (rerun_result.$ === "Ok") {
    delegate.emit_next_solver_overflow_fcw(Goal.with(goal, as_interner(delegate.cx()), predicate, upcast_from_self), span);
    initial_result.value = rerun_result._0;
  }
}

/// The old solver doesn't check depth requirement when looking up cache while the next solver
/// does so. Thus the next solver is more prone to overflow. To mitigate breakages, we re-evaluate
/// the overflowed goal with doubled recursion limit and emit a FCW if doing so prevents overflow.
///
/// See the doc comment on `RECURSION_DEPTH_EXCEEDING_LIMIT` and #159228 for more details.
// PORT: `initial_result: &mut (..)` is a `MutRef` (PORTING §8).
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:380 maybe_evaluate_root_goal_for_proof_tree_with_higher_recursion_limit
export function maybe_evaluate_root_goal_for_proof_tree_with_higher_recursion_limit(
  delegate: SolverDelegate,
  goal: Goal<Predicate>,
  span: Span,
  initial_result: MutRef<[Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation]>,
): void {
  if (!delegate.deref().enable_next_solver_overflow_fcw()) {
    return;
  }

  const goal_evaluation = initial_result.value[1];
  const result = goal_evaluation.result;
  if (result.$ === "Err") {
    return;
  } else if (!Certainty.is_overflow(result._0.value.certainty)) {
    return;
  } else {
    // Ok(_) => {}
  }

  const rerun_result = delegate
    .deref()
    .commit_if_ok<[Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation], null>(() => {
      const [new_result, new_goal_evaluation] = evaluate_root_goal_for_proof_tree(
        delegate,
        goal,
        span,
        delegate.cx().ir_recursion_limit() * 2,
      );

      if (new_goal_evaluation.result.$ === "Ok" && Certainty.is_overflow(new_goal_evaluation.result._0.value.certainty)) {
        return Err(null);
      } else {
        return Ok([new_result, new_goal_evaluation]);
      }
    });
  if (rerun_result.$ === "Ok") {
    const predicate: Predicate = goal_evaluation.uncanonicalized_goal.predicate;
    delegate.emit_next_solver_overflow_fcw(Goal.with(goal, as_interner(delegate.cx()), predicate, upcast_from_self), span);
    initial_result.value = rerun_result._0;
  }
}

// ---- impl<'a, D, I> EvalCtxt<'a, D> (mod.rs:424) ----------------------------------------------------------------------

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:429 typing_mode
EvalCtxt.prototype.typing_mode = function (this: EvalCtxt): TypingModeT {
  return this.delegate.deref().typing_mode_raw();
};

/// Computes the `PathKind` for the step from the current goal to the
/// nested goal. See #136824 for a more detailed reasoning for this why we care about
/// the step from a goal to its nested goals.
///
/// For now we're entirely ignoring the reason why the current goal depends on the
/// nested goal and instead only depend on the current goal itself. This closely
/// matches the old solver. This is something we'll likely improve as we go forward
/// afterwards.
// FIXME(-Znext-solver=coinductive): Nothing interesting going on here right now
// and we're ignoring the goal source. We should change this going forward.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:443 step_kind_to_nested
EvalCtxt.prototype.step_kind_to_nested = function (this: EvalCtxt, _source: GoalSource): PathKind {
  switch (this.current_goal_kind) {
    // We currently consider a cycle involving a trait goal for a coinductive
    // trait as coinductive as long as it otherwise only includes normalization.
    case "CoinductiveTrait":
      return PathKind.Coinductive;
    // We do need to treat cycles involving only coinductive trait goals
    // and normalization as coinductive due to trait-system-refactor-initiative#10.
    case "ProjectionComputeAssocTermCandidate":
    case "Projection":
      return PathKind.Unknown;
    // We probably want to make all traits coinductive in the future,
    // so we treat cycles involving where-clauses of not-yet coinductive
    // traits as ambiguous for now.
    case "Misc":
      return PathKind.ForcedAmbiguity;
  }
};

/// Creates a root evaluation context and search graph. This should only be
/// used from outside of any evaluation, and other methods should be preferred
/// over using this manually (such as [`SolverDelegateEvalExt::evaluate_root_goal`]).
// PORT: `SearchGraph::new(root_depth)` (`SearchGraph<D>`) is `SearchGraph.new(SearchGraphDelegate(D), root_depth)` with
// the delegate's static table `delegate.Self` (search_graph.ts header). The struct literal's fields are computed in
// upstream order, then passed to the constructor in declaration order.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:463 enter_root
EvalCtxt.enter_root = function <R>(delegate: SolverDelegate, root_depth: number, origin_span: Span, f: (ecx: EvalCtxt) => R): R {
  const search_graph = search_graph_SearchGraph.new(SearchGraphDelegate(delegate.Self), root_depth);

  const nested_goals: [GoalSource, Goal<Predicate>, GoalStalledOn | undefined][] = [];
  const inspect = EvaluationStepBuilder.new_noop();
  // Only relevant when canonicalizing the response,
  // which we don't do within this evaluation context.
  const max_input_universe = UniverseIndex.ROOT;
  const initial_opaque_types_storage_num_entries = delegate.Self.OpaqueTypeStorageEntries_default();
  // PORT: `Default::default()` of `I::CanonicalVarKinds` / `I::GenericArgs` (`&List<_>`) is the empty list.
  const var_kinds: CanonicalVarKinds = RawList.empty();
  const var_values: GenericArgs = RawList.empty();
  const ecx = new EvalCtxt(
    delegate,
    var_kinds,
    CurrentGoalKind.Misc,
    var_values,
    max_input_universe,
    initial_opaque_types_storage_num_entries,
    search_graph,
    nested_goals,
    origin_span,
    Ok(undefined),
    AccessedOpaques.default_(),
    inspect,
  );
  const result = f(ecx);
  assert(ecx.nested_goals.length === 0, "root `EvalCtxt` should not have any goals added to it");
  assert(!AccessedOpaques.might_rerun(ecx.opaque_accesses), "assertion failed: !ecx.opaque_accesses.might_rerun()");
  assert(search_graph.is_empty(), "assertion failed: search_graph.is_empty()");
  return result;
};

/// Creates a nested evaluation context that shares the same search graph as the
/// one passed in. This is suitable for evaluation, granted that the search graph
/// has had the nested goal recorded on its stack. This method only be used by
/// `search_graph::Delegate::compute_goal`.
///
/// This function takes care of setting up the inference context, setting the anchor,
/// and registering opaques from the canonicalized input.
// PORT: `D::build_with_canonical(cx, &canonical_input)` derefs the interned `CanonicalInput` to its
// `CanonicalQueryInput` (`CanonicalInput_deref`); `canonical_input.canonical` / `.typing_mode` read through the same
// `Deref`.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:505 enter_canonical
EvalCtxt.enter_canonical = function <T>(
  D: SolverDelegate_static,
  cx: TyCtxt,
  search_graph: import("../search_graph.ts").SearchGraph,
  canonical_input: CanonicalInput,
  proof_tree_builder: ProofTreeBuilder,
  f: (ecx: EvalCtxt, goal: Goal<Predicate>) => Result<T, NoSolutionOrRerunNonErased>,
): [Result<T, NoSolution>, AccessedOpaques] {
  const [delegate, input, var_values_] = D.build_with_canonical(cx, CanonicalInput_deref(canonical_input), fold_QueryInput_Predicate);
  const var_values = var_values_.var_values;
  for (const [key, ty] of input.predefined_opaques_in_body) {
    const prev = delegate.deref().ir_register_hidden_type_in_storage(key, ty, DUMMY_SP);
    // It may be possible that two entries in the opaque type storage end up
    // with the same key after resolving contained inference variables.
    //
    // We could put them in the duplicate list but don't have to. The opaques we
    // encounter here are already tracked in the caller, so there's no need to
    // also store them here. We'd take them out when computing the query response
    // and then discard them, as they're already present in the input.
    //
    // Ideally we'd drop duplicate opaque type definitions when computing
    // the canonical input. This is more annoying to implement and may cause a
    // perf regression, so we do it inside of the query for now.
    if (prev !== undefined) {
      // debug!(?key, ?ty, ?prev, "ignore duplicate in `opaque_types_storage`");
    }
  }

  const initial_opaque_types_storage_num_entries = delegate.deref().opaque_types_storage_num_entries();
  // if cfg!(debug_assertions) && delegate.typing_mode_raw().is_erased_not_coherence() {
  //     assert!(delegate.clone_opaque_types_lookup_table().is_empty());
  // }

  const canonical = CanonicalInput_deref(canonical_input).canonical;
  const var_kinds = canonical.var_kinds;
  const current_goal_kind = CurrentGoalKind.from_query_input(cx, input);
  const max_input_universe = canonical.max_universe;
  const nested_goals: [GoalSource, Goal<Predicate>, GoalStalledOn | undefined][] = [];
  const origin_span = DUMMY_SP;
  const inspect = proof_tree_builder.new_evaluation_step(var_values);
  const ecx = new EvalCtxt(
    delegate,
    var_kinds,
    current_goal_kind,
    var_values,
    max_input_universe,
    initial_opaque_types_storage_num_entries,
    search_graph,
    nested_goals,
    origin_span,
    Ok(undefined),
    AccessedOpaques.default_(),
    inspect,
  );

  const result = f(ecx, input.goal);
  ecx.inspect.probe_final_state(ecx.delegate, ecx.max_input_universe);
  proof_tree_builder.finish_evaluation_step(ecx.inspect);

  // if canonical_input.typing_mode.0.is_erased_not_coherence() {
  //     debug_assert!(delegate.clone_opaque_types_lookup_table().is_empty());
  // }

  // When creating a query response we clone the opaque type constraints
  // instead of taking them. This would cause an ICE here, since we have
  // assertions against dropping an `InferCtxt` without taking opaques.
  // FIXME: Once we remove support for the old impl we can remove this.
  // FIXME: Could we make `build_with_canonical` into `enter_with_canonical` and call this at the end?
  delegate.deref().reset_opaque_types();

  const opaque_accesses = ecx.opaque_accesses;
  let r: Result<T, NoSolution>;
  if (result.$ === "Ok") {
    r = Ok(result._0);
  } else if (result._0.$ === "NoSolution") {
    r = Err(NoSolution);
  } else {
    // Check that the opaque_accesses state mirrors the result we got.
    assert(AccessedOpaques.should_bail(opaque_accesses).$ === "Err", "assertion failed: opaque_accesses.should_bail().is_err()");
    r = Err(NoSolution);
  }
  return [r, opaque_accesses];
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:585 ignore_candidate_head_usages
EvalCtxt.prototype.ignore_candidate_head_usages = function (this: EvalCtxt, usages: CandidateHeadUsages): void {
  this.search_graph.ignore_candidate_head_usages(usages);
};

/// Recursively evaluates `goal`, returning whether any inference vars have
/// been constrained and the certainty of the result.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:591 evaluate_goal
EvalCtxt.prototype.evaluate_goal = function (
  this: EvalCtxt,
  source: GoalSource,
  goal: Goal<Predicate>,
  stalled_on: GoalStalledOn | undefined,
): Result<GoalEvaluation, NoSolutionOrRerunNonErased> {
  const rerun = rerunning_stalled_goal_may_make_progress(this.delegate, stalled_on);
  if (rerun.$ === "WontMakeProgress") {
    const stalled_maybe_info = rerun._0;
    return Ok({
      goal,
      certainty: { $: "Maybe", _0: stalled_maybe_info },
      has_changed: HasChanged.No,
      stalled_on,
    });
  }

  // No need to try the fast path if stalled_on is `None`, since we already try the fast path
  // immediately when adding new goals. If we didn't check `stalled_on` here we'd be trying
  // the fast path twice for some goals.
  if (stalled_on !== undefined) {
    const res = compute_goal_fast_path_cold(this.delegate, goal, this.origin_span);
    if (res !== undefined) {
      return Ok(res);
    }
  }

  return this.evaluate_goal_no_fast_paths(source, goal);
};

// Outlining and `#[cold]` matter here because fast paths make it less likely to get here.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:623 evaluate_goal_no_fast_paths
EvalCtxt.prototype.evaluate_goal_no_fast_paths = function (
  this: EvalCtxt,
  source: GoalSource,
  goal: Goal<Predicate>,
): Result<GoalEvaluation, NoSolutionOrRerunNonErased> {
  const r = this.evaluate_goal_raw(source, goal);
  if (r.$ === "Err") return r;
  const [normalization_nested_goals, goal_evaluation] = r._0;
  assert(NestedNormalizationGoalsC.is_empty(normalization_nested_goals), "assertion failed: normalization_nested_goals.is_empty()");
  return Ok(goal_evaluation);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:633 evaluate_in_search_graph
EvalCtxt.prototype.evaluate_in_search_graph = function (
  this: EvalCtxt,
  canonical_goal: CanonicalInput,
  step_kind: PathKind,
): [Result<CanonicalResponse, NoSolution>, AccessedOpaques] {
  let increase_depth_for_nested: LowerAvailableDepth;
  const kind = Binder.skip_binder(CanonicalInput_deref(canonical_goal).canonical.value.goal.predicate.kind());
  switch (kind.$) {
    // We don't lower the available depth for the `NormalizesTo` goal, as evaluating
    // it is an extra step only exists in the new solver that behaves like a function
    // call rather than an independent nested goal evaluation. So, decreasing the
    // available depth may end up regressions which hit the recursion limits for crates
    // compiled well with the old solver.
    case "NormalizesTo":
      increase_depth_for_nested = "No";
      break;
    case "Clause": {
      const clause = kind._0;
      switch (clause.$) {
        // We also don't lower depth for witness and rigid opaque when proving auto traits.
        // This is to mitigate the overflow FCW warnings in deeply nested async calls.
        // See #159228.
        //
        // We're eventually going to remove the witness type so it's okay to ignore the
        // depth.
        // For rigid opaques, revealing hidden types can be viewed as normalization so it's
        // consistent with the `NormalizesTo` reasoning above.
        case "Trait": {
          const pred = clause._0;
          if (this.cx().trait_is_auto(pred.trait_ref.def_id)) {
            const self_kind = TraitClause.self_ty(pred).kind();
            switch (self_kind.$) {
              case "CoroutineWitness":
                increase_depth_for_nested = "No";
                break;
              case "Alias": {
                if (self_kind._0 === "Yes" && self_kind._1.kind.$ === "Opaque") {
                  const def_id = self_kind._1.kind.def_id;
                  // We only want to skip lowering depth when the proving is done via
                  // auto trait leakage. If the goal can be proved via item bounds,
                  // we should lower depth faithfully.
                  //
                  // FIXME: We can have param env candidates via TAIT or RTN.
                  // Ideally we'd instead lower the depth for the nested goal instead.
                  // Implementing this is a bit harder.
                  let any = false;
                  for (const bound of EarlyBinder.skip_binder(as_interner(this.cx()).item_self_bounds(def_id))) {
                    const b = bound.as_trait_clause();
                    if (b !== undefined && DefId_eq(PolyTraitClause.def_id(b), TraitClause.def_id(pred))) {
                      any = true;
                      break;
                    }
                  }
                  if (any) {
                    increase_depth_for_nested = "Yes";
                  } else {
                    increase_depth_for_nested = "No";
                  }
                } else {
                  // ty::Alias(_, _)
                  increase_depth_for_nested = "Yes";
                }
                break;
              }
              case "Bool":
              case "Char":
              case "Int":
              case "Uint":
              case "Float":
              case "Str":
              case "Pat":
              case "FnPtr":
              case "Array":
              case "Slice":
              case "RawPtr":
              case "Never":
              case "Tuple":
              case "UnsafeBinder":
              case "Param":
              case "Placeholder":
              case "Bound":
              case "Infer":
              case "Ref":
              case "Adt":
              case "Foreign":
              case "Dynamic":
              case "Error":
              case "FnDef":
              case "Closure":
              case "CoroutineClosure":
              case "Coroutine":
                increase_depth_for_nested = "Yes";
                break;
            }
          } else {
            increase_depth_for_nested = "Yes";
          }
          break;
        }
        case "HostEffect":
        case "Projection":
        case "TypeOutlives":
        case "RegionOutlives":
        case "ConstArgHasType":
        case "UnstableFeature":
        case "WellFormed":
        case "ConstEvaluatable":
          increase_depth_for_nested = "Yes";
          break;
      }
      break;
    }
    case "Subtype":
    case "Coerce":
    case "DynCompatible":
    case "ConstEquate":
    case "Ambiguous":
      increase_depth_for_nested = "Yes";
      break;
  }
  return this.search_graph.evaluate_goal(
    as_interner(this.cx()),
    canonical_goal,
    step_kind,
    increase_depth_for_nested,
    ProofTreeBuilder.new_noop(),
  );
};

/// Recursively evaluates `goal`, returning the nested goals in case
/// the nested goal is a `NormalizesTo` goal.
///
/// As all other goal kinds do not return any nested goals and
/// `NormalizesTo` is only used by `Projection`, all other callsites
/// should use [`EvalCtxt::evaluate_goal`] which discards that empty
/// storage.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:748 evaluate_goal_raw
EvalCtxt.prototype.evaluate_goal_raw = function (
  this: EvalCtxt,
  source: GoalSource,
  goal0: Goal<Predicate>,
): Result<[NestedNormalizationGoals, GoalEvaluation], NoSolutionOrRerunNonErased> {
  // We only care about one entry per `OpaqueTypeKey` here,
  // so we only canonicalize the lookup table and ignore
  // duplicate entries.
  const opaque_types0 = this.delegate.deref().clone_opaque_types_lookup_table();

  const [goal, opaque_types] = this.delegate
    .deref()
    .deeply_resolve_via_unification_table<readonly [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]]>(
      [goal0, opaque_types0],
      fold_Goal_and_opaque_types,
    );
  const typing_mode = this.typing_mode();
  const step_kind = this.step_kind_to_nested(source);

  // let tracing_span = tracing::span!(Level::DEBUG, "evaluate_goal_raw in typing mode", ..).entered();

  let result: Result<CanonicalResponse, NoSolution>;
  let orig_values: GenericArg[];
  let canonical_goal: CanonicalInput;
  let succeeded_in_erased: SucceededInErased;
  retry_canonicalize: {
    let skip_erased_attempt: boolean;
    switch (typing_mode.$) {
      case "Reflection":
      case "Coherence":
        skip_erased_attempt = true;
        break;
      case "Typeck":
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
      case "Codegen":
      case "PostAnalysis":
      case "ErasedNotCoherence": {
        let skip = false;
        if (opaque_types.some(([_, ty]) => ty.is_ty_var())) {
          const k = Binder.skip_binder(goal.predicate.kind());
          if (k.$ === "Clause" && k._0.$ === "Trait") {
            skip = true;
          }
        }

        const k = Binder.skip_binder(goal.predicate.kind());
        if (k.$ === "Clause" && k._0.$ === "Trait") {
          const tr = k._0._0;
          if (TypeVisitableExt.has_coroutines(TraitClause.self_ty(tr), fold_Ty) && this.cx().trait_is_auto(tr.trait_ref.def_id)) {
            // FIXME(#155443): this doesn't make a difference now, but with eager normalization
            // it likely will.
            // skip_erased_attempt = true;
          }
        }

        skip_erased_attempt = skip;
        break;
      }
    }

    if (skip_erased_attempt) {
      if (TypingMode.is_erased_not_coherence(typing_mode)) {
        const r = AccessedOpaques.rerun_always(this.opaque_accesses, "SkipErasedAttempt");
        if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
        return r._0; // `match ..? {}`: `Ok` is uninhabited
      } else {
        // debug!("running in original typing mode");
      }
    } else {
      // debug!("trying without opaques: {goal:?}");

      const [orig_values_e, canonical_goal_e] = canonicalize_goal(this.delegate, goal, [], {
        $: "ErasedNotCoherence",
        _0: MayBeErased,
      });

      const [canonical_result, accessed_opaques] = this.evaluate_in_search_graph(canonical_goal_e, step_kind);

      const should_rerun = should_rerun_after_erased_canonicalization(accessed_opaques, this.typing_mode(), opaque_types);
      switch (should_rerun) {
        case "Yes":
          // debug!("rerunning in original typing mode")
          break;
        case "No": {
          result = canonical_result;
          orig_values = orig_values_e;
          canonical_goal = canonical_goal_e;
          succeeded_in_erased = { $: "Yes", accessed_opaques };
          break retry_canonicalize;
        }
        case "EagerlyPropagateToParent": {
          const u = AccessedOpaques.update(this.opaque_accesses, accessed_opaques);
          if (u.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(u._0));
          result = canonical_result;
          orig_values = orig_values_e;
          canonical_goal = canonical_goal_e;
          // If we're propagating up, we should never retry the goal.
          // That means `No` is fine to return, it doesn't really matter.
          succeeded_in_erased = { $: "No" };
          break retry_canonicalize;
        }
      }
    }

    const [orig_values_o, canonical_goal_o] = canonicalize_goal(this.delegate, goal, opaque_types, typing_mode);

    const [canonical_result, accessed_opaques] = this.evaluate_in_search_graph(canonical_goal_o, step_kind);
    if (AccessedOpaques.might_rerun(accessed_opaques)) {
      panic(
        `we run without TypingMode::ErasedNotCoherence, so opaques are available, and we don't retry if the outer typing mode is ErasedNotCoherence: ${debug_AccessedOpaques(accessed_opaques, PLAIN)} after ${debug_Goal(goal, PLAIN, debug_Predicate)}`,
      );
    }

    result = canonical_result;
    orig_values = orig_values_o;
    canonical_goal = canonical_goal_o;
    succeeded_in_erased = { $: "No" };
  }

  // debug!(?result);
  let response: CanonicalResponse;
  if (result.$ === "Ok") {
    // debug!("success");
    response = result._0;
  } else {
    // debug!("normal failure");
    return Err(NoSolutionOrRerunNonErased.from_NoSolution(NoSolution));
  }

  // drop(tracing_span);

  const has_changed = !has_only_region_constraints(response) ? HasChanged.Yes : HasChanged.No;

  const [normalization_nested_goals, certainty] = instantiate_and_apply_query_response(
    this.delegate,
    orig_values,
    response,
    this.origin_span,
  );

  // FIXME: We previously had an assert here that checked that recomputing
  // a goal after applying its constraints did not change its response.
  //
  // This assert was removed as it did not hold for goals constraining
  // an inference variable to a recursive alias, e.g. in
  // tests/ui/traits/next-solver/overflow/recursive-self-normalization.rs.
  //
  // Once we have decided on how to handle trait-system-refactor-initiative#75,
  // we should re-add an assert here.

  let stalled_on: GoalStalledOn | undefined;
  switch (certainty.$) {
    case "Yes":
      stalled_on = undefined;
      break;
    case "Maybe": {
      const maybe_info = certainty._0;
      switch (has_changed) {
        // FIXME: We could recompute a *new* set of stalled variables by walking
        // through the orig values, resolving, and computing the root vars of anything
        // that is not resolved. Only when *these* have changed is it meaningful
        // to recompute this goal.
        case "Yes":
          stalled_on = undefined;
          break;
        case "No":
          stalled_on = this.build_stalled_on(canonical_goal, maybe_info, orig_values, succeeded_in_erased);
          break;
      }
      break;
    }
  }

  return Ok([normalization_nested_goals, { goal, certainty, has_changed, stalled_on }]);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:921 build_stalled_on
EvalCtxt.prototype.build_stalled_on = function (
  this: EvalCtxt,
  canonical_goal: CanonicalInput,
  maybe_info: MaybeInfo,
  stalled_vars0: GenericArg[],
  previously_succeeded_in_erased: SucceededInErased,
): GoalStalledOn {
  // Remove the canonicalized universal vars, since we only care about stalled existentials.
  const sub_roots: TyVid[] = [];
  const stalled_vars: TyOrConstInferVar[] = [];
  for (const arg of stalled_vars0) {
    let v: TyOrConstInferVar | undefined;
    const ak = GenericArgC.kind(arg);
    switch (ak.$) {
      // Lifetimes can never stall goals.
      case "Lifetime":
        v = undefined;
        break;
      case "Type": {
        const ty = ak._0;
        const k = ty.kind();
        if (k.$ === "Infer" && k._0.$ === "TyVar") {
          const vid = k._0._0;
          sub_roots.push(this.delegate.deref().sub_unification_table_root_var(vid));
          v = { $: "Ty", _0: vid };
        } else if (k.$ === "Infer" && k._0.$ === "IntVar") {
          v = { $: "TyInt", _0: k._0._0 };
        } else if (k.$ === "Infer" && k._0.$ === "FloatVar") {
          v = { $: "TyFloat", _0: k._0._0 };
        } else if (k.$ === "Param" || k.$ === "Placeholder") {
          v = undefined;
        } else {
          return unreachable(`internal error: entered unreachable code: unexpected orig_value: ${debug_Ty(ty, PLAIN)}`);
        }
        break;
      }
      case "Const": {
        const ct = ak._0;
        const k = ct.kind();
        if (k.$ === "Infer" && k._0.$ === "Var") {
          v = { $: "Const", _0: k._0._0 };
        } else if (k.$ === "Param" || k.$ === "Placeholder") {
          v = undefined;
        } else {
          return unreachable(`internal error: entered unreachable code: unexpected orig_value: ${debug_Const(ct, PLAIN)}`);
        }
        break;
      }
    }
    if (v !== undefined) stalled_vars.push(v);
  }

  return {
    stalled_vars,
    sub_roots,
    stalled_maybe_info: maybe_info,
    opaques: {
      $: "Yes",
      num_opaques_in_storage: CanonicalInput_deref(canonical_goal).canonical.value.predefined_opaques_in_body.length,
      previously_succeeded_in_erased,
    },
  };
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:970 compute_goal
EvalCtxt.prototype.compute_goal = function (this: EvalCtxt, goal: Goal<Predicate>): QueryResultOrRerunNonErased {
  const { param_env, predicate } = goal;
  const kind = predicate.kind();
  return this.enter_forall_with_assumptions(
    kind,
    param_env,
    (ecx, kind): QueryResultOrRerunNonErased => {
      let r: QueryResultOrRerunNonErased;
      switch (kind.$) {
        case "Clause": {
          const clause = kind._0;
          switch (clause.$) {
            case "Trait": {
              const r0 = ecx.compute_trait_goal({ param_env, predicate: clause._0 });
              if (r0.$ === "Err") return r0;
              // `.map(|(r, _via)| r)?`
              r = Ok(r0._0[0]);
              break;
            }
            case "HostEffect":
              r = ecx.compute_host_effect_goal({ param_env, predicate: clause._0 });
              break;
            case "Projection":
              r = ecx.compute_projection_goal({ param_env, predicate: clause._0 });
              break;
            case "TypeOutlives":
              r = ecx.compute_type_outlives_goal({ param_env, predicate: clause._0 });
              break;
            case "RegionOutlives":
              r = ecx.compute_region_outlives_goal({ param_env, predicate: clause._0 });
              break;
            case "ConstArgHasType":
              r = ecx.compute_const_arg_has_type_goal({ param_env, predicate: [clause._0, clause._1] });
              break;
            case "UnstableFeature":
              r = ecx.compute_unstable_feature_goal(param_env, clause._0);
              break;
            case "WellFormed":
              r = ecx.compute_well_formed_goal({ param_env, predicate: clause._0 });
              break;
            case "ConstEvaluatable":
              r = ecx.compute_const_evaluatable_goal({ param_env, predicate: clause._0 });
              break;
          }
          break;
        }
        case "Subtype":
          r = ecx.compute_subtype_goal({ param_env, predicate: kind._0 });
          break;
        case "Coerce":
          r = ecx.compute_coerce_goal({ param_env, predicate: kind._0 });
          break;
        case "DynCompatible":
          r = ecx.compute_dyn_compatible_goal(kind._0);
          break;
        case "ConstEquate":
          return panic("ConstEquate should not be emitted when `-Znext-solver` is active");
        case "NormalizesTo":
          r = ecx.compute_normalizes_to_goal({ param_env, predicate: kind._0 });
          break;
        case "Ambiguous":
          r = ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
          break;
      }
      if (r.$ === "Err") return r;
      return Ok(r._0);
    },
    fold_PredicateKind_,
  );
};

// Recursively evaluates all the goals added to this `EvalCtxt` to completion, returning
// the certainty of all the goals.
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1030 try_evaluate_added_goals
EvalCtxt.prototype.try_evaluate_added_goals = function (this: EvalCtxt): Result<Certainty, NoSolutionOrRerunNonErased> {
  for (let i = 0; i < FIXPOINT_STEP_LIMIT; i++) {
    const r0 = RerunResultExt_for_Result.map_err_to_rerun(this.evaluate_added_goals_step());
    if (r0.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r0._0));
    const r = r0._0;
    if (r.$ === "Ok") {
      if (r._0 === undefined) {
        // Ok(None) => {}
      } else {
        const cert = r._0;
        return Ok(cert);
      }
    } else {
      this.tainted = Err(NoSolution);
      return Err(NoSolutionOrRerunNonErased.from_NoSolution(NoSolution));
    }
  }

  // debug!("try_evaluate_added_goals: encountered overflow");
  return Ok(Certainty.overflow(false));
};

/// Iterate over all added goals: returning `Ok(Some(_))` in case we can stop rerunning.
///
/// Goals for the next step get directly added to the nested goals of the `EvalCtxt`.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1051 evaluate_added_goals_step
EvalCtxt.prototype.evaluate_added_goals_step = function (this: EvalCtxt): Result<Certainty | undefined, NoSolutionOrRerunNonErased> {
  // If this loop did not result in any progress, what's our final certainty.
  let unchanged_certainty: Certainty | undefined = Certainty.Yes;
  // This mem::take seems super inefficient, given that we push to it again later.
  // Despite that, replacing it has no effect on performance. We tried.
  // (https://github.com/rust-lang/rust/pull/158126)
  const taken = this.nested_goals;
  this.nested_goals = [];
  for (const [source, goal0, stalled_on0] of taken) {
    // We never handle `NormalizesTo` as a nested goal
    // debug_assert!(!matches!(goal.predicate.kind().skip_binder(), PredicateKind::NormalizesTo(_)));

    const r = this.evaluate_goal(source, goal0, stalled_on0);
    if (r.$ === "Err") return r;
    const { goal, certainty, has_changed, stalled_on } = r._0;
    if (has_changed === HasChanged.Yes) {
      unchanged_certainty = undefined;
    }

    switch (certainty.$) {
      case "Yes":
        break;
      case "Maybe":
        this.nested_goals.push([source, goal, stalled_on]);
        unchanged_certainty = unchanged_certainty === undefined ? undefined : Certainty.and(unchanged_certainty, certainty);
        break;
    }
  }

  return Ok(unchanged_certainty);
};

/// Record impl args in the proof tree for later access by `InspectCandidate`.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1085 record_impl_args
EvalCtxt.prototype.record_impl_args = function (this: EvalCtxt, impl_args: GenericArgs): void {
  this.inspect.record_impl_args(this.delegate, this.max_input_universe, impl_args);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1089 cx
EvalCtxt.prototype.cx = function (this: EvalCtxt): TyCtxt {
  return this.delegate.cx();
};

// #[instrument(level = "debug", skip(self))]
// PORT: `mut goal: Goal<..>` is a by-value `Copy` parameter: the TS object may be shared with the caller, so the
// normalized goal is a fresh object instead of an in-place write.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1094 add_goal
EvalCtxt.prototype.add_goal = function (
  this: EvalCtxt,
  source: GoalSource,
  goal0: Goal<Predicate>,
): Result<undefined, NoSolutionOrRerunNonErased> {
  const normalized = this.normalize(goal0.param_env, Unnormalized.new_wip(goal0.predicate), fold_Predicate);
  if (normalized.$ === "Err") return normalized;
  const goal: Goal<Predicate> = { param_env: goal0.param_env, predicate: normalized._0 };
  this.inspect.add_goal(this.delegate, this.max_input_universe, source, goal);

  const fast = compute_goal_fast_path(this.delegate, goal, this.origin_span);
  if (fast !== undefined) {
    const { goal, certainty, stalled_on } = fast;
    switch (certainty.$) {
      // We're done here
      case "Yes":
        break;
      case "Maybe":
        this.nested_goals.push([source, goal, stalled_on]);
        break;
    }
  } else {
    this.nested_goals.push([source, goal, undefined]);
  }
  return Ok(undefined);
};

// #[instrument(level = "trace", skip(self, goals))]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1120 add_goals
EvalCtxt.prototype.add_goals = function (
  this: EvalCtxt,
  source: GoalSource,
  goals: Iterable<Goal<Predicate>>,
): Result<undefined, NoSolutionOrRerunNonErased> {
  for (const goal of goals) {
    const r = this.add_goal(source, goal);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1131 next_region_var
EvalCtxt.prototype.next_region_var = function (this: EvalCtxt): Region {
  const region = this.delegate.deref().next_region_infer();
  this.inspect.add_var_value(region);
  return region;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1137 next_ty_infer
EvalCtxt.prototype.next_ty_infer = function (this: EvalCtxt): Ty {
  const ty = this.delegate.deref().next_ty_infer();
  this.inspect.add_var_value(ty);
  return ty;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1143 next_const_infer
EvalCtxt.prototype.next_const_infer = function (this: EvalCtxt): Const {
  const ct = this.delegate.deref().next_const_infer();
  this.inspect.add_var_value(ct);
  return ct;
};

/// Returns a ty infer or a const infer depending on whether `kind` is a `Ty` or `Const`.
/// If `kind` is an integer inference variable this will still return a ty infer var.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1151 next_term_infer_of_alias_kind
EvalCtxt.prototype.next_term_infer_of_alias_kind = function (this: EvalCtxt, alias_term: AliasTermT): Term {
  switch (alias_term.kind.$) {
    case "ProjectionTy":
    case "InherentTy":
    case "OpaqueTy":
    case "FreeTy":
      return TermC.from_Ty(this.next_ty_infer());
    case "FreeConst":
    case "InherentConstSelf":
    case "InherentConstImpl":
    case "AnonConst":
    case "ProjectionConst":
      return TermC.from_Const(this.next_const_infer());
  }
};

/// Is the projection predicate is of the form `exists<T> <Ty as Trait>::Assoc = T`.
///
/// This is the case if the `term` does not occur in any other part of the predicate
/// and is able to name all other placeholder and inference variables.
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1173 term_is_fully_unconstrained
EvalCtxt.prototype.term_is_fully_unconstrained = function (this: EvalCtxt, goal: Goal<NormalizesTo>): boolean {
  let universe_of_term: UniverseIndex;
  const tk = TermC.kind(goal.predicate.term);
  switch (tk.$) {
    case "Ty": {
      const k = tk._0.kind();
      if (k.$ === "Infer" && k._0.$ === "TyVar") {
        universe_of_term = unwrap(this.delegate.deref().universe_of_ty(k._0._0));
      } else {
        return false;
      }
      break;
    }
    case "Const": {
      const k = tk._0.kind();
      if (k.$ === "Infer" && k._0.$ === "Var") {
        universe_of_term = unwrap(this.delegate.deref().universe_of_const(k._0._0));
      } else {
        return false;
      }
      break;
    }
  }

  type CF = ControlFlow<null>;
  class ContainsTermOrNotNameable implements TypeVisitor<CF> {
    /** `type Result = ControlFlow<()>;` */
    readonly Result: VisitorResult<CF, unknown> = VisitorResultC.ControlFlow<null>();

    constructor(
      public term: Term,
      public universe_of_term: UniverseIndex,
      public delegate: SolverDelegate,
      public cache: Set<Ty>,
    ) {}

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1199 check_nameable
    check_nameable(universe: UniverseIndex): CF {
      if (UniverseIndex.can_name(this.universe_of_term, universe)) {
        return ControlFlowC.CONTINUE;
      } else {
        return ControlFlowC.Break(null);
      }
    }

    // ---- impl TypeVisitor<I> for ContainsTermOrNotNameable ----

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1212 visit_ty
    visit_ty(t: Ty): CF {
      if (this.cache.has(t)) {
        return ControlFlowC.CONTINUE;
      }

      const k = t.kind();
      if (k.$ === "Infer" && k._0.$ === "TyVar") {
        const vid = k._0._0;
        const term_kind = TermC.kind(this.term);
        if (term_kind.$ === "Ty") {
          const tk2 = term_kind._0.kind();
          if (tk2.$ === "Infer" && tk2._0.$ === "TyVar") {
            const term_vid = tk2._0._0;
            if (this.delegate.deref().root_ty_var(vid) === this.delegate.deref().root_ty_var(term_vid)) {
              return ControlFlowC.Break(null);
            }
          }
        }

        const c = this.check_nameable(unwrap(this.delegate.deref().universe_of_ty(vid)));
        if (c.$ === "Break") return c;
      } else if (k.$ === "Placeholder") {
        const c = this.check_nameable(k._0.universe);
        if (c.$ === "Break") return c;
      } else {
        if (TypeVisitableExt.has_non_region_infer(t, fold_Ty) || TypeVisitableExt.has_placeholders(t, fold_Ty)) {
          const c = fold_Ty.super_visit_with(t, this);
          if (c.$ === "Break") return c;
        }
      }

      // `assert!(self.cache.insert(t))`
      const inserted = !this.cache.has(t);
      this.cache.add(t);
      assert(inserted, "assertion failed: self.cache.insert(t)");
      return ControlFlowC.CONTINUE;
    }

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1240 visit_const
    visit_const(c: Const): CF {
      const k = c.kind();
      if (k.$ === "Infer" && k._0.$ === "Var") {
        const vid = k._0._0;
        const term_kind = TermC.kind(this.term);
        if (term_kind.$ === "Const") {
          const ck2 = term_kind._0.kind();
          if (ck2.$ === "Infer" && ck2._0.$ === "Var") {
            const term_vid = ck2._0._0;
            if (this.delegate.deref().root_const_var(vid) === this.delegate.deref().root_const_var(term_vid)) {
              return ControlFlowC.Break(null);
            }
          }
        }

        return this.check_nameable(unwrap(this.delegate.deref().universe_of_const(vid)));
      } else if (k.$ === "Placeholder") {
        return this.check_nameable(k._0.universe);
      } else {
        if (TypeVisitableExt.has_non_region_infer(c, fold_Const) || TypeVisitableExt.has_placeholders(c, fold_Const)) {
          return fold_Const.super_visit_with(c, this);
        } else {
          return ControlFlowC.CONTINUE;
        }
      }
    }

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1264 visit_predicate
    visit_predicate<P>(p: P, d: PredicateProxy<P>): CF {
      if (TypeVisitableExt.has_non_region_infer(p, d) || TypeVisitableExt.has_placeholders(p, d)) {
        return d.super_visit_with(p, this);
      } else {
        return ControlFlowC.CONTINUE;
      }
    }

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1272 visit_clauses
    visit_clauses(c: Clauses): CF {
      if (TypeVisitableExt.has_non_region_infer(c, fold_Clauses) || TypeVisitableExt.has_placeholders(c, fold_Clauses)) {
        return fold_Clauses.super_visit_with(c, this);
      } else {
        return ControlFlowC.CONTINUE;
      }
    }

    // (provided) TypeVisitor methods this impl does not override.
    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): CF {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }
    visit_region(r: Region): CF {
      return TypeVisitor_provided.visit_region(this, r);
    }
    visit_error(guar: ErrorGuaranteed): CF {
      return TypeVisitor_provided.visit_error(this, guar);
    }
  }

  const visitor = new ContainsTermOrNotNameable(goal.predicate.term, universe_of_term, this.delegate, new Set());
  return (
    visit_with_Alias(goal.predicate.alias, visitor, visit_with_AliasTermKind).$ === "Continue" &&
    visit_with_ParamEnv(goal.param_env, visitor).$ === "Continue"
  );
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1291 sub_unify_ty_vids_raw
EvalCtxt.prototype.sub_unify_ty_vids_raw = function (this: EvalCtxt, a: TyVid, b: TyVid): void {
  this.delegate.deref().sub_unify_ty_vids_raw(a, b);
};

// #[instrument(level = "trace", skip(self, param_env), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1296 eq
EvalCtxt.prototype.eq = function <T>(
  this: EvalCtxt,
  param_env: ParamEnv,
  lhs: T,
  rhs: T,
  d_T: Relate<T>,
): Result<undefined, NoSolutionOrRerunNonErased> {
  return this.relate(param_env, lhs, "Invariant", rhs, d_T);
};

// #[instrument(level = "trace", skip(self, param_env), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1306 sub
EvalCtxt.prototype.sub = function <T>(
  this: EvalCtxt,
  param_env: ParamEnv,
  sub: T,
  sup: T,
  d_T: Relate<T>,
): Result<undefined, NoSolutionOrRerunNonErased> {
  return this.relate(param_env, sub, "Covariant", sup, d_T);
};

// #[instrument(level = "trace", skip(self, param_env), ret)]
// PORT: `self.delegate.relate(..)` is `RelateExt` of the delegate's `Infcx` (`RelateExt_for_Infcx`); its `?` converts
// the `TypeError` with `NoSolutionOrRerunNonErased_from_TypeError` (rustc_type_ir error.ts).
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1316 relate
EvalCtxt.prototype.relate = function <T>(
  this: EvalCtxt,
  param_env: ParamEnv,
  lhs: T,
  variance: Variance,
  rhs: T,
  d_T: Relate<T>,
): Result<undefined, NoSolutionOrRerunNonErased> {
  const goals = RelateExt_for_Infcx.relate(this.delegate.deref(), param_env, lhs, variance, rhs, this.origin_span, d_T);
  if (goals.$ === "Err") return Err(NoSolutionOrRerunNonErased_from_TypeError(goals._0));
  for (const goal of goals._0) {
    let source: GoalSource;
    const p = Binder.skip_binder(goal.predicate.kind());
    if (p.$ === "Clause" && p._0.$ === "Projection") {
      source = "Normalization";
    } else if (p.$ === "Subtype") {
      // FIXME(-Znext-solver=coinductive): subtyping goals should
      // likely be unproductive
      source = "Misc";
    } else if (p.$ === "Clause" && p._0.$ === "WellFormed") {
      // FIXME(-Znext-solver=coinductive): should these WF goals also be unproductive?
      source = "Misc";
    } else {
      return unreachable(`internal error: entered unreachable code: unexpected nested goal in \`relate\`: ${debug_PredicateKind(p, PLAIN)}`);
    }
    const r = this.add_goal(source, goal);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
};

/// Equates two values returning the nested goals without adding them
/// to the nested goals of the `EvalCtxt`.
///
/// If possible, try using `eq` instead which automatically handles nested
/// goals correctly.
// #[instrument(level = "trace", skip(self, param_env), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1347 eq_and_get_goals
EvalCtxt.prototype.eq_and_get_goals = function <T>(
  this: EvalCtxt,
  param_env: ParamEnv,
  lhs: T,
  rhs: T,
  d_T: Relate<T>,
): Result<Goal<Predicate>[], NoSolution> {
  const r = RelateExt_for_Infcx.relate(this.delegate.deref(), param_env, lhs, "Invariant", rhs, this.origin_span, d_T);
  if (r.$ === "Err") return Err(NoSolution_from_TypeError(r._0));
  return Ok(r._0);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1356 instantiate_binder_with_infer
EvalCtxt.prototype.instantiate_binder_with_infer = function <T>(this: EvalCtxt, value: Binder<T>, d_T: TypeFoldable<T>): T {
  return this.delegate.deref().instantiate_binder_with_infer(value, d_T);
};

/// `enter_forall_with_assumptions`, but takes `&mut self` and passes it back through
/// the callback since it can't be aliased during the call.
///
/// The `param_env` is used to *compute* the assumptions of the binder, not *as* the
/// assumptions associated with the binder.
///
/// FIXME(inherent_associated_types): fix this?
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1370 enter_forall_with_assumptions
EvalCtxt.prototype.enter_forall_with_assumptions = function <T, U>(
  this: EvalCtxt,
  value: Binder<T>,
  param_env: ParamEnv,
  f: (ecx: EvalCtxt, value: T) => U,
  d_T: TypeFoldable<T>,
): U {
  return this.delegate.deref().enter_forall_without_assumptions(
    value,
    (value: T): U => {
      // Invariant: we shouldn't insert empty assumptions if assumptions computation fails.
      // When handling placeholder constraints, we rely on vacancies to force ambiguity.
      const u = this.delegate.deref().universe();
      if (this.cx().assumptions_on_binders()) {
        const assumptions = this.region_assumptions_for_placeholders_in_universe(value, u, param_env, d_T);
        if (assumptions !== undefined) {
          this.delegate.deref().insert_placeholder_assumptions(u, assumptions);
        }
      }

      return f(this, value);
    },
    d_T,
  );
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1394 deeply_resolve_ignoring_regions
EvalCtxt.prototype.deeply_resolve_ignoring_regions = function <T>(this: EvalCtxt, value: T, d_T: TypeFoldable<T>): T {
  return this.delegate.deref().deeply_resolve_ignoring_regions(value, d_T);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1401 shallow_resolve
EvalCtxt.prototype.shallow_resolve = function (this: EvalCtxt, ty: Ty): Ty {
  return this.delegate.deref().shallow_resolve(ty);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1405 eager_resolve_region
EvalCtxt.prototype.eager_resolve_region = function (this: EvalCtxt, r: Region): Region {
  const k = r.kind();
  if (k.$ === "ReVar") {
    return this.delegate.deref().shallow_resolve_region_var(k._0);
  } else {
    return r;
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1413 fresh_args_for_item
EvalCtxt.prototype.fresh_args_for_item = function (this: EvalCtxt, def_id: DefId): GenericArgs {
  const args = this.delegate.deref().ir_fresh_args_for_item(def_id);
  for (const arg of args) {
    this.inspect.add_var_value(arg);
  }
  return args;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1421 register_solver_region_constraint
EvalCtxt.prototype.register_solver_region_constraint = function (this: EvalCtxt, c: RegionConstraint): void {
  this.delegate.deref().ir_register_solver_region_constraint(c, this.origin_span);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1425 register_ty_outlives
EvalCtxt.prototype.register_ty_outlives = function (this: EvalCtxt, ty: Ty, lt: Region): void {
  this.delegate.deref().register_ty_outlives(ty, lt, this.origin_span);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1429 register_region_outlives
EvalCtxt.prototype.register_region_outlives = function (this: EvalCtxt, a: Region, b: Region, vis: VisibleForLeakCheck): void {
  // `'a: 'b` ==> `'b <= 'a`
  this.delegate.deref().ir_sub_regions(b, a, vis, this.origin_span);
};

/// Computes the list of goals required for `arg` to be well-formed
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1440 well_formed_goals
EvalCtxt.prototype.well_formed_goals = function (this: EvalCtxt, param_env: ParamEnv, term: Term): Goal<Predicate>[] | undefined {
  return this.delegate.well_formed_goals(param_env, term);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1448 trait_ref_is_knowable
EvalCtxt.prototype.trait_ref_is_knowable = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  trait_ref: TraitRef,
): Result<boolean, NoSolutionOrRerunNonErased> {
  const delegate = this.delegate;
  const lazily_normalize_ty = (ty: Ty): Result<Ty, NoSolutionOrRerunNonErased> => this.structurally_normalize_ty(param_env, ty);
  const r = coherence.trait_ref_is_knowable(delegate.deref(), trait_ref, lazily_normalize_ty);
  if (r.$ === "Err") return r;
  return Ok(r._0.$ === "Ok");
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1459 fetch_eligible_assoc_item
EvalCtxt.prototype.fetch_eligible_assoc_item = function (
  this: EvalCtxt,
  goal_trait_ref: TraitRef,
  trait_assoc_def_id: DefId,
  impl_def_id: DefId,
): FetchEligibleAssocItemResponse {
  return this.delegate.fetch_eligible_assoc_item(goal_trait_ref, trait_assoc_def_id, impl_def_id);
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1469 register_hidden_type_in_storage
EvalCtxt.prototype.register_hidden_type_in_storage = function (
  this: EvalCtxt,
  opaque_type_key: OpaqueTypeKey,
  hidden_ty: Ty,
): Ty | undefined {
  return this.delegate.deref().ir_register_hidden_type_in_storage(opaque_type_key, hidden_ty, this.origin_span);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1477 add_item_bounds_for_hidden_type
EvalCtxt.prototype.add_item_bounds_for_hidden_type = function (
  this: EvalCtxt,
  opaque_def_id: DefId,
  opaque_args: GenericArgs,
  param_env: ParamEnv,
  hidden_ty: Ty,
): Result<undefined, NoSolutionOrRerunNonErased> {
  const goals: Goal<Predicate>[] = [];
  this.delegate.add_item_bounds_for_hidden_type(opaque_def_id, opaque_args, param_env, hidden_ty, goals);
  const r = this.add_goals("AliasWellFormed", goals);
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

// Try to evaluate a const and normalize the type of the resulting value, or return `None` if
// the const is too generic. This doesn't mean the const isn't evaluatable, though, and should
// be treated as an ambiguity rather than no-solution.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1499 evaluate_const
EvalCtxt.prototype.evaluate_const = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  alias_const: AliasConst,
): Result<Const | undefined, NoSolutionOrRerunNonErased> {
  if (TypingMode.is_erased_not_coherence(this.typing_mode())) {
    const resolved = this.deeply_resolve_ignoring_regions(alias_const, fold_AliasConst);
    // FIXME: get rid of this once GCE is removed
    const is_gce = inherent_Features.generic_const_exprs(this.cx().features());
    if (TypeVisitableExt.has_opaque_types(resolved, fold_AliasConst) || is_gce) {
      const r = AccessedOpaques.rerun_always(this.opaque_accesses, "EvaluateConst");
      if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
      return r._0; // `match ..? {}`: `Ok` is uninhabited
    }
  }

  return this.delegate.evaluate_const<NoSolutionOrRerunNonErased>(param_env, alias_const, (ty) => this.normalize(param_env, ty, fold_Ty));
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1516 evaluate_const_and_instantiate_projection_term
EvalCtxt.prototype.evaluate_const_and_instantiate_projection_term = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  projection_term: AliasTermT,
  expected_term: Term,
  alias_const: AliasConst,
): QueryResultOrRerunNonErased {
  const ev = this.evaluate_const(param_env, alias_const);
  if (ev.$ === "Err") return ev;
  const evaluated = ev._0;
  if (evaluated !== undefined) {
    const r = this.eq(param_env, expected_term, TermC.from_Const(evaluated), relate_Term);
    if (r.$ === "Err") return r;
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  } else if (inherent_Features.gca_const_items(this.cx().features())) {
    // HACK(khyperia): calling `deeply_resolve_ignoring_regions` here shouldn't be necessary,
    // `try_evaluate_const` calls `deeply_resolve_ignoring_regions` already. However, we want
    // to check `has_non_region_infer` against the type with vars resolved (i.e. check
    // if there are vars we failed to resolve), so we need to call it again here.
    // Perhaps we could split EvaluateConstErr::HasGenericsOrInfers into HasGenerics and
    // HasInfers or something, make evaluate_const return that, and make this branch be
    // based on that, rather than checking `has_non_region_infer`.
    if (TypeVisitableExt.has_non_region_infer(this.deeply_resolve_ignoring_regions(alias_const, fold_AliasConst), fold_AliasConst)) {
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
    } else {
      // Evaluation failed because the const was too generic or was an invalid type
      // for const generics. The result of normalization is the alias itself,
      // unchanged, but marked as rigid.
      //
      // We do not instantiate to the `alias_const` passed in, but rather
      // `projection_term`, which is the unprocessed, original alias contained within
      // the goal. The `alias_const` passed in might be a Projection whose DefId is an
      // impl of the trait, however, we want to structurally instantiate to the
      // original DefId on the trait itself.
      const r = this.eq(param_env, AliasTerm.to_term(projection_term, this.cx(), "Yes"), expected_term, relate_Term);
      if (r.$ === "Err") return r;
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    }
  } else {
    // Legacy behavior: always treat as ambiguous
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
  }
};

// PORT: upstream passes `(dst, src)` to `D::is_transmutable(src, dst, ..)`; kept as is.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1563 is_transmutable
EvalCtxt.prototype.is_transmutable = function (this: EvalCtxt, src: Ty, dst: Ty, assume: Const): Result<Certainty, NoSolution> {
  return this.delegate.is_transmutable(dst, src, assume);
};

// PORT: `universes: &mut Vec<Option<UniverseIndex>>` is mutated in place.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1572 replace_bound_vars
EvalCtxt.prototype.replace_bound_vars = function <T>(this: EvalCtxt, t: T, universes: (UniverseIndex | undefined)[], d_T: TypeFoldable<T>): T {
  return BoundVarReplacer.replace_bound_vars(this.delegate.deref(), universes, t, d_T)[0];
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1580 may_use_unstable_feature
EvalCtxt.prototype.may_use_unstable_feature = function (this: EvalCtxt, param_env: ParamEnv, symbol: Symbol): Result<boolean, RerunNonErased> {
  if (TypingMode.is_erased_not_coherence(this.typing_mode())) {
    const r = AccessedOpaques.rerun_always(this.opaque_accesses, "MayUseUnstableFeature");
    if (r.$ === "Err") return r;
    return r._0; // `match ..? {}`: `Ok` is uninhabited
  }

  return Ok(may_use_unstable_feature(this.delegate.deref(), param_env, symbol));
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1592 opaques_with_sub_unified_hidden_type
EvalCtxt.prototype.opaques_with_sub_unified_hidden_type = function (this: EvalCtxt, self_ty: Ty): OpaqueAliasTy[] {
  const k = self_ty.kind();
  if (k.$ === "Infer" && k._0.$ === "TyVar") {
    return this.delegate.deref().opaques_with_sub_unified_hidden_type(k._0._0);
  } else {
    return [];
  }
};

/// To return the constraints of a canonical query to the caller, we canonicalize:
///
/// - `var_values`: a map from bound variables in the canonical goal to
///   the values inferred while solving the instantiated goal.
/// - `external_constraints`: additional constraints which aren't expressible
///   using simple unification of inference variables.
///
/// This takes the `shallow_certainty` which represents whether we're confident
/// that the final result of the current goal only depends on the nested goals.
///
/// In case this is `Certainty::Maybe`, there may still be additional nested goals
/// or inference constraints required for this candidate to be hold. The candidate
/// always requires all already added constraints and nested goals.
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1617 evaluate_added_goals_and_make_canonical_response
EvalCtxt.prototype.evaluate_added_goals_and_make_canonical_response = function (
  this: EvalCtxt,
  shallow_certainty: Certainty,
): QueryResultOrRerunNonErased {
  this.inspect.make_canonical_response(shallow_certainty);

  const ge = this.try_evaluate_added_goals();
  if (ge.$ === "Err") return ge;
  let goals_certainty = ge._0;
  assert_eq_msg<Result<undefined, NoSolution>>(
    this.tainted,
    Ok(undefined),
    (a, b) => a.$ === b.$,
    debug_tainted,
    () => "EvalCtxt is tainted -- nested goals may have been dropped in a previous call to `try_evaluate_added_goals!`",
  );

  if (this.delegate.cx().assumptions_on_binders()) {
    const c = this.eagerly_handle_placeholders();
    if (c.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(c._0));
    const certainty = c._0;
    goals_certainty = Certainty.and(certainty, goals_certainty);
  } else {
    // We only check for leaks from universes which were entered inside
    // of the query.
    const lc = this.delegate.leak_check(this.max_input_universe);
    if (lc.$ === "Err") {
      // trace!("failed the leak check");
      return Err(NoSolutionOrRerunNonErased.from_NoSolution(NoSolution));
    }

    // goals_certainty
  }

  let certainty: Certainty;
  let normalization_nested_goals: NestedNormalizationGoals;
  if (this.current_goal_kind === "ProjectionComputeAssocTermCandidate" && shallow_certainty.$ === "Yes") {
    // When normalizing, we've replaced the expected term with an unconstrained
    // inference variable. This means that we dropped information which could
    // have been important. We handle this by instead returning the nested goals
    // to the caller, where they are then handled. We only do so if we do not
    // need to recompute the `NormalizesTo` goal afterwards to avoid repeatedly
    // uplifting its nested goals. This is the case if the `shallow_certainty` is
    // `Certainty::Yes`.
    const goals = this.nested_goals;
    this.nested_goals = [];
    // As we return all ambiguous nested goals, we can ignore the certainty
    // returned by `self.try_evaluate_added_goals()`.
    if (goals.length === 0) {
      assert(goals_certainty.$ === "Yes", "assertion failed: matches!(goals_certainty, Certainty::Yes)");
    }
    certainty = Certainty.Yes;
    normalization_nested_goals = { _0: goals.map(([s, g, _]): [GoalSource, Goal<Predicate>] => [s, g]) };
  } else {
    certainty = Certainty.and(shallow_certainty, goals_certainty);
    normalization_nested_goals = NestedNormalizationGoalsC.empty();
  }

  if (certainty.$ === "Maybe" && certainty._0.cause.$ === "Overflow" && certainty._0.cause.keep_constraints === false) {
    const maybe_info = certainty._0;
    // If we have overflow, it's probable that we're substituting a type
    // into itself infinitely and any partial substitutions in the query
    // response are probably not useful anyways, so just return an empty
    // query response.
    //
    // This may prevent us from potentially useful inference, e.g.
    // 2 candidates, one ambiguous and one overflow, which both
    // have the same inference constraints.
    //
    // Changing this to retain some constraints in the future
    // won't be a breaking change, so this is good enough for now.
    return Ok(this.make_ambiguous_response_no_constraints(maybe_info));
  }

  const external_constraints0 = this.compute_external_query_constraints(certainty, normalization_nested_goals);
  const [var_values, external_constraints] = this.delegate
    .deref()
    .deeply_resolve_via_unification_table<readonly [GenericArgs, ExternalConstraintsData]>(
      [this.var_values, external_constraints0],
      fold_GenericArgs_and_ExternalConstraintsData,
    );

  // Remove any trivial or duplicated region constraints once we've resolved regions
  // PORT: `HashSet<RegionConstraint<I>>` keyed by the derived `Hash + Eq` (intern_key); only `insert` is used.
  const unique = new Set<string>();
  if (external_constraints.region_constraints.$ === "Old") {
    const r = external_constraints.region_constraints._0;
    vec_retain(r, ([outlives, _]) => {
      if (ty_RegionConstraint.is_trivial(outlives)) return false;
      const key = intern_key(outlives);
      const inserted = !unique.has(key);
      unique.add(key);
      return inserted;
    });
  }

  filter_irrelevant_region_constraints(this.delegate, var_values, external_constraints);

  const canonical = canonicalize_response(
    this.delegate,
    this.max_input_universe,
    {
      var_values,
      certainty,
      external_constraints: this.cx().mk_external_constraints(external_constraints),
    } satisfies Response,
    fold_Response_,
  );

  return Ok(canonical);
};

/// Constructs a totally unconstrained, ambiguous response to a goal.
///
/// Take care when using this, since often it's useful to respond with
/// ambiguity but return constrained variables to guide inference.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1730 make_ambiguous_response_no_constraints
EvalCtxt.prototype.make_ambiguous_response_no_constraints = function (this: EvalCtxt, maybe: MaybeInfo): CanonicalResponse {
  return response_no_constraints_raw(this.cx(), this.max_input_universe, this.var_kinds, { $: "Maybe", _0: maybe });
};

/// Computes the region constraints and *new* opaque types registered when
/// proving a goal.
///
/// If an opaque was already constrained before proving this goal, then the
/// external constraints do not need to record that opaque, since if it is
/// further constrained by inference, that will be passed back in the var
/// values.
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1750 compute_external_query_constraints
EvalCtxt.prototype.compute_external_query_constraints = function (
  this: EvalCtxt,
  certainty: Certainty,
  normalization_nested_goals: NestedNormalizationGoals,
): ExternalConstraintsData {
  // We only return region constraints once the certainty is `Yes`. This
  // is necessary as we may drop nested goals on ambiguity, which may result
  // in unconstrained inference variables in the region constraints. It also
  // prevents us from emitting duplicate region constraints, avoiding some
  // unnecessary work. This slightly weakens the leak check in case it uses
  // region constraints from an ambiguous nested goal. This is tested in both
  // `tests/ui/higher-ranked/leak-check/leak-check-in-selection-5-ambig.rs` and
  // `tests/ui/higher-ranked/leak-check/leak-check-in-selection-6-ambig-unify.rs`.
  let region_constraints: ExternalConstraintsData["region_constraints"];
  if (this.cx().assumptions_on_binders()) {
    let c: RegionConstraint;
    if (certainty.$ === "Yes") {
      const constraint = this.delegate.deref().ir_get_solver_region_constraint();
      c = constraint;
    } else {
      c = RegionConstraint.new_true();
    }
    region_constraints = { $: "NextGen", _0: c };
  } else {
    region_constraints = {
      $: "Old",
      _0: certainty.$ === "Yes" ? this.delegate.make_deduplicated_region_constraints() : [],
    };
  }

  // We only return *newly defined* opaque types from canonical queries.
  //
  // Constraints for any existing opaque types are already tracked by changes
  // to the `var_values`.
  const opaque_types = this.delegate.deref().clone_opaque_types_added_since(this.initial_opaque_types_storage_num_entries);

  if (TypingMode.is_erased_not_coherence(this.typing_mode())) {
    assert(opaque_types.length === 0, "assertion failed: opaque_types.is_empty()");
  }

  return { region_constraints, opaque_types, normalization_nested_goals };
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1793 normalize
EvalCtxt.prototype.normalize = function <T>(
  this: EvalCtxt,
  param_env: ParamEnv,
  value0: Unnormalized<T>,
  d_T: TypeFoldable<T>,
): Result<T, NoSolutionOrRerunNonErased> {
  const value = this.delegate.deref().deeply_resolve_ignoring_regions(Unnormalized.skip_normalization(value0), d_T);

  if (!this.cx().renormalize_rigid_aliases() && !TypeVisitableExt.has_non_rigid_aliases(value, d_T)) {
    return Ok(value);
  }

  // To drop the mutable borrow of self early.
  const infcx = this.delegate.deref();
  const folder = NormalizationFolder.new<NoSolutionOrRerunNonErased>(
    infcx,
    [],
    (alias_term: AliasTermT): Result<[Term, NormalizationWasAmbiguous], NoSolutionOrRerunNonErased> => {
      const infer_term = this.next_term_infer_of_alias_kind(alias_term);
      const pred: ProjectionClause = { projection_term: alias_term, term: infer_term };
      const goal = Goal.new(as_interner(this.cx()), param_env, pred, upcast_tcx(Predicate_upcast_from_ProjectionClause));
      const source: GoalSource = "Normalization";
      this.inspect.add_goal(this.delegate, this.max_input_universe, source, goal);
      const ev = this.evaluate_goal(source, goal, undefined);
      if (ev.$ === "Err") return ev;
      const { goal: goal2, certainty, stalled_on } = ev._0;
      let normalization_was_ambiguous: NormalizationWasAmbiguous;
      switch (certainty.$) {
        case "Yes":
          normalization_was_ambiguous = "No";
          break;
        case "Maybe":
          this.nested_goals.push([source, goal2, stalled_on]);
          normalization_was_ambiguous = "Yes";
          break;
      }

      return Ok([this.deeply_resolve_ignoring_regions(infer_term, fold_Term), normalization_was_ambiguous]);
    },
  );
  return d_T.try_fold_with(value, folder);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1828 filter_irrelevant_region_constraints
// PORT: `external_constraints: &mut ExternalConstraintsData<I>` is mutated in place.
export function filter_irrelevant_region_constraints(
  delegate: SolverDelegate,
  var_values: GenericArgs,
  external_constraints: ExternalConstraintsData,
): void {
  // PORT: `#[derive(Default)] struct NonTrivialVars { vars: HashSet<RegionVid> }`; `RegionVid` is a branded number.
  class NonTrivialVars implements TypeVisitor<undefined> {
    /** `type Result = ();` */
    readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

    constructor(public vars: Set<number>) {}

    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1845 visit_ty
    visit_ty(t: Ty): undefined {
      // If a nested type doesn't have any `ReVar`s, then we won't insert
      // anything into `vars` anyway, so skip for better perf.
      if (!TypeVisitableExt.has_infer_regions(t, fold_Ty)) {
        return;
      }
      fold_Ty.super_visit_with(t, this);
    }
    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1853 visit_const
    visit_const(c: Const): undefined {
      // The same goes for consts.
      if (!TypeVisitableExt.has_infer_regions(c, fold_Const)) {
        return;
      }
      fold_Const.super_visit_with(c, this);
    }
    // rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1860 visit_region
    visit_region(r: Region): undefined {
      const k = r.kind();
      if (k.$ === "ReVar") {
        this.vars.add(k._0);
      }
    }

    // (provided) TypeVisitor methods this impl does not override.
    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }
    visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
      return TypeVisitor_provided.visit_predicate(this, p, d);
    }
    visit_clauses(c: Clauses): undefined {
      return TypeVisitor_provided.visit_clauses(this, c);
    }
    visit_error(guar: ErrorGuaranteed): undefined {
      return TypeVisitor_provided.visit_error(this, guar);
    }
  }

  const { region_constraints, opaque_types, normalization_nested_goals } = external_constraints;

  // If we have a constraint like `'re: '?1`, where '?1 can name 're and '?1 appears
  // only on the RHS of region constraints, then this kind of constraint is also trivial,
  // since we're able to pick '?1 := glb('re, other_regions), and by definition of glb,
  // `'re: glb`.
  if (region_constraints.$ === "Old" && region_constraints._0.length !== 0) {
    const r = region_constraints._0;
    const vis = new NonTrivialVars(new Set());
    visit_with_GenericArgs(var_values, vis);
    // We have to visit each component of `external_constraints` individually here
    // because we skip the RHS of outlives constraints, and `TypeVisitor` doesn't
    // have a method we can easily override in order to do this.
    visit_with_Vec(opaque_types, vis, fold_OpaqueTypeKey_Ty.visit_with);
    visit_with_NestedNormalizationGoals(normalization_nested_goals, vis);
    for (const [constraint, _] of r) {
      switch (constraint.$) {
        case "Outlives": {
          const sup = constraint._0._0;
          visit_with_GenericArg(sup, vis);
          break;
        }
        case "Eq": {
          const eq = constraint._0;
          visit_with_RegionEqPredicate(eq, vis);
          break;
        }
      }
    }

    vec_retain(r, ([outlives, _]) => {
      if (outlives.$ === "Outlives") {
        const sup = outlives._0._0;
        const re = outlives._0._1;
        const sup_re = GenericArgC.as_region(sup);
        if (sup_re !== undefined) {
          const rk = re.kind();
          if (rk.$ === "ReVar") {
            const vid = rk._0;
            // This is only safe if we call `eager_resolve_vars` before calling,
            // this function, which we do.
            if (UniverseIndex.can_name(unwrap(delegate.deref().ir_universe_of_region(vid)), max_universe(delegate.deref(), sup_re, fold_Region))) {
              return vis.vars.has(vid);
            }
          }
        }
      }
      return true;
    });
  }
}

// PORT: `#[derive(Debug)]` fieldless enum.
export type RerunDecision = "Yes" | "No" | "EagerlyPropagateToParent";
export const RerunDecision = { Yes: "Yes", No: "No", EagerlyPropagateToParent: "EagerlyPropagateToParent" } as const;
export const debug_RerunDecision: Debug<RerunDecision> = (v) => v;

// #[tracing::instrument(ret)]
// PORT: the destructuring parameter `AccessedOpaques { reason: _, rerun }: AccessedOpaques<I>` is `_0`.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:1918 should_rerun_after_erased_canonicalization
export function should_rerun_after_erased_canonicalization(
  _0: AccessedOpaques,
  original_typing_mode: TypingModeT,
  parent_opaque_types: readonly (readonly [OpaqueTypeKey, Ty])[],
): RerunDecision {
  const rerun = _0.rerun;
  // PORT: `parent_opaque_types.iter().map(|(key, _)| key.def_id.into())` (a lazy iterator, consumed at most once).
  const parent_opaque_def_ids = parent_opaque_types.map(([key, _]) => key.def_id);
  const opaque_in_storage = (opaques: readonly import("../../../rustc_span/def_id.ts").LocalDefId[], def_ids: SmallCopySet<import("../../../rustc_span/def_id.ts").LocalDefId>): RerunDecision => {
    if (SmallCopySet.as_ref(def_ids).length === 0) {
      return RerunDecision.No;
    } else if ([...opaques, ...parent_opaque_def_ids].some((opaque) => SmallCopySet.as_ref(def_ids).includes(opaque))) {
      return RerunDecision.Yes;
    } else {
      return RerunDecision.No;
    }
  };
  const any_opaque_has_infer_as_hidden = (): RerunDecision => {
    if (parent_opaque_types.some(([_, ty]) => ty.is_ty_var())) {
      return RerunDecision.Yes;
    } else {
      return RerunDecision.No;
    }
  };

  const m = original_typing_mode;
  // =============================
  if (rerun.$ === "Never") return RerunDecision.No;
  // =============================
  if (m.$ === "ErasedNotCoherence") return RerunDecision.EagerlyPropagateToParent;
  // =============================
  // In coherence, we never switch to erased mode, so we will never register anything
  // in the rerun state, so we should've taken the first branch of this match
  if (m.$ === "Coherence") return unreachable();
  // =============================
  if (rerun.$ === "Always") return RerunDecision.Yes;
  // =============================
  if (rerun.$ === "OpaqueInStorage" && (m.$ === "PostAnalysis" || m.$ === "Codegen" || m.$ === "Reflection")) {
    return RerunDecision.Yes;
  }
  if (rerun.$ === "OpaqueInStorage") {
    const defids = rerun._0;
    if (m.$ === "PostBorrowck") return opaque_in_storage(m.defined_opaque_types, defids);
    if (m.$ === "Typeck") return opaque_in_storage(m.defining_opaque_types_and_generators, defids);
    if (m.$ === "PostTypeckUntilBorrowck") return opaque_in_storage(m.defining_opaque_types, defids);
  }
  // =============================
  if (rerun.$ === "AnyOpaqueHasInferAsHidden" && m.$ === "Typeck") {
    return any_opaque_has_infer_as_hidden();
  }
  if (
    rerun.$ === "AnyOpaqueHasInferAsHidden" &&
    (m.$ === "PostBorrowck" || m.$ === "PostAnalysis" || m.$ === "Codegen" || m.$ === "Reflection" || m.$ === "PostTypeckUntilBorrowck")
  ) {
    return RerunDecision.No;
  }
  // =============================
  if (rerun.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden" && (m.$ === "PostAnalysis" || m.$ === "Codegen" || m.$ === "Reflection")) {
    return RerunDecision.Yes;
  }
  if (rerun.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden" && m.$ === "Typeck") {
    const defids = rerun._0;
    const opaques = m.defining_opaque_types_and_generators;
    if (any_opaque_has_infer_as_hidden() === "Yes") {
      return RerunDecision.Yes;
    } else if (opaque_in_storage(opaques, defids) === "Yes") {
      return RerunDecision.Yes;
    } else {
      return RerunDecision.No;
    }
  }
  if (rerun.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden") {
    const defids = rerun._0;
    if (m.$ === "PostBorrowck") return opaque_in_storage(m.defined_opaque_types, defids);
    if (m.$ === "PostTypeckUntilBorrowck") return opaque_in_storage(m.defining_opaque_types, defids);
  }
  // The match above is exhaustive.
  return unreachable();
}

/// Do not call this directly, use the `tcx` query instead.
// PORT: `SearchGraph::<D>::evaluate_root_goal_for_proof_tree(cx, ..)` is
// `SearchGraph.evaluate_root_goal_for_proof_tree(SearchGraphDelegate(D), cx, ..)` (search_graph.ts header).
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:2005 evaluate_root_goal_for_proof_tree_raw_provider
export function evaluate_root_goal_for_proof_tree_raw_provider(
  D: SolverDelegate_static,
  cx: TyCtxt,
  canonical_goal: CanonicalInput,
  root_depth: number,
): [QueryResult, Probe, RequiredDepth] {
  const inspect = ProofTreeBuilder.new();
  const [[canonical_result, accessed_opaques], required_depth] = search_graph_SearchGraph.evaluate_root_goal_for_proof_tree(
    SearchGraphDelegate(D),
    as_interner(cx),
    root_depth,
    canonical_goal,
    inspect,
  );
  const final_revision = inspect.unwrap();

  assert(!AccessedOpaques.might_rerun(accessed_opaques), "assertion failed: !accessed_opaques.might_rerun()");
  return [canonical_result, cx.mk_probe(final_revision), required_depth];
}

/// Evaluate a goal to build a proof tree.
///
/// This is a copy of [EvalCtxt::evaluate_goal_raw] which avoids relying on the
/// [EvalCtxt] and uses a separate cache.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs:2031 evaluate_root_goal_for_proof_tree
export function evaluate_root_goal_for_proof_tree(
  delegate: SolverDelegate,
  goal0: Goal<Predicate>,
  origin_span: Span,
  root_depth: number,
): [Result<NestedNormalizationGoals, NoSolution>, inspect_GoalEvaluation] {
  const opaque_types0 = delegate.deref().clone_opaque_types_lookup_table();
  const [goal, opaque_types] = delegate
    .deref()
    .deeply_resolve_via_unification_table<readonly [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]]>(
      [goal0, opaque_types0],
      fold_Goal_and_opaque_types,
    );
  const typing_mode = TypingMode.assert_not_erased(delegate.deref().typing_mode_raw());

  const [orig_values, canonical_goal] = canonicalize_goal(delegate, goal, opaque_types, TypingMode.from_TypingMode(typing_mode));

  const [canonical_result, final_revision, required_depth] = delegate.cx().ir_evaluate_root_goal_for_proof_tree_raw(canonical_goal, root_depth);

  const proof_tree: inspect_GoalEvaluation = {
    uncanonicalized_goal: goal,
    orig_values,
    final_revision,
    result: canonical_result,
    required_depth,
  };

  let response: CanonicalResponse;
  if (canonical_result.$ === "Err") {
    return [Err(canonical_result._0), proof_tree];
  } else {
    response = canonical_result._0;
  }

  const [normalization_nested_goals, _certainty] = instantiate_and_apply_query_response(
    delegate,
    proof_tree.orig_values,
    response,
    origin_span,
  );

  return [Ok(normalization_nested_goals), proof_tree];
}

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** PORT: `Vec::retain(f)` in place (each element visited once, in order). */
function vec_retain<T>(v: T[], f: (x: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (f(x)) v[j++] = x;
  }
  v.length = j;
}

/**
 * PORT (D3): an `UpcastFrom` impl of rustc_middle written over `TyCtxt` (`Predicate_upcast_from_*`) used where
 * rustc_type_ir's `Goal::new` wants it over `Interner`; `TyCtxt` is the only `Interner` (predicate.ts `as_interner`).
 */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): UpcastFrom<T, P>["upcast_from"] {
  return f as unknown as UpcastFrom<T, P>["upcast_from"];
}

/** `{:?}` of `Result<(), NoSolution>` (the `assert_eq!` on `self.tainted`). */
const debug_tainted: Debug<Result<undefined, NoSolution>> = (v, f) => debug_result(v, f, () => "()", debug_NoSolution);

// ---- D4 descriptors (module comment) ---------------------------------------------------------------------------------
// PORT: built lazily (arrow wrappers): the generated fns are read at call time only (init order, contract rule 3).

function descriptor<T>(visit_with: VisitWith<T>, try_fold_with: TryFoldWith<T>, fold_with: FoldWith<T>): TypeFoldable<T> {
  return { visit_with, try_fold_with, fold_with };
}

/** `Goal<I, I::Predicate>` */
const fold_Goal_Predicate: TypeFoldable<Goal<Predicate>> = descriptor(
  <R>(s: Goal<Predicate>, v: TypeVisitor<R>): R => visit_with_Goal(s, v, visit_with_Predicate),
  <E>(s: Goal<Predicate>, f: FallibleTypeFolder<E>): Result<Goal<Predicate>, E> => try_fold_with_Goal(s, f, try_fold_with_Predicate),
  (s: Goal<Predicate>, f: TypeFolder): Goal<Predicate> => fold_with_Goal(s, f, fold_with_Predicate),
);

/** `(OpaqueTypeKey<I>, I::Ty)` */
const fold_OpaqueTypeKey_Ty: TypeFoldable<[OpaqueTypeKey, Ty]> = descriptor(
  <R>(s: [OpaqueTypeKey, Ty], v: TypeVisitor<R>): R => visit_with_tuple2(s, v, visit_with_OpaqueTypeKey, visit_with_Ty),
  <E>(s: [OpaqueTypeKey, Ty], f: FallibleTypeFolder<E>): Result<[OpaqueTypeKey, Ty], E> =>
    try_fold_with_tuple2(s, f, try_fold_with_OpaqueTypeKey, try_fold_with_Ty),
  (s: [OpaqueTypeKey, Ty], f: TypeFolder): [OpaqueTypeKey, Ty] => fold_with_tuple2(s, f, fold_with_OpaqueTypeKey, fold_with_Ty),
);

/** `(Goal<I, I::Predicate>, Vec<(OpaqueTypeKey<I>, I::Ty)>)` */
const fold_Goal_and_opaque_types: TypeFoldable<readonly [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]]> = descriptor(
  <R>(s: readonly [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]], v: TypeVisitor<R>): R =>
    fold_tuple2(fold_Goal_Predicate, fold_Vec(fold_OpaqueTypeKey_Ty)).visit_with(s as [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]], v),
  <E>(s: readonly [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]], f: FallibleTypeFolder<E>) =>
    fold_tuple2(fold_Goal_Predicate, fold_Vec(fold_OpaqueTypeKey_Ty)).try_fold_with(s as [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]], f),
  (s: readonly [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]], f: TypeFolder) =>
    fold_tuple2(fold_Goal_Predicate, fold_Vec(fold_OpaqueTypeKey_Ty)).fold_with(s as [Goal<Predicate>, readonly [OpaqueTypeKey, Ty][]], f),
);

/** `QueryInput<I, I::Predicate>` */
const fold_QueryInput_Predicate: TypeFoldable<QueryInput<Predicate>> = descriptor(
  <R>(s: QueryInput<Predicate>, v: TypeVisitor<R>): R => visit_with_QueryInput(s, v, visit_with_Predicate),
  <E>(s: QueryInput<Predicate>, f: FallibleTypeFolder<E>): Result<QueryInput<Predicate>, E> => try_fold_with_QueryInput(s, f, try_fold_with_Predicate),
  (s: QueryInput<Predicate>, f: TypeFolder): QueryInput<Predicate> => fold_with_QueryInput(s, f, fold_with_Predicate),
);

/** `PredicateKind<I>` */
const fold_PredicateKind_: TypeFoldable<PredicateKind> = descriptor(
  <R>(s: PredicateKind, v: TypeVisitor<R>): R => visit_with_PredicateKind(s, v),
  <E>(s: PredicateKind, f: FallibleTypeFolder<E>): Result<PredicateKind, E> => try_fold_with_PredicateKind(s, f),
  (s: PredicateKind, f: TypeFolder): PredicateKind => fold_with_PredicateKind(s, f),
);

/** `ty::AliasConst<I>` (`Alias<I, AliasConstKind<I>>`) */
const fold_AliasConst: TypeFoldable<AliasConst> = descriptor(
  <R>(s: AliasConst, v: TypeVisitor<R>): R => visit_with_Alias(s, v, visit_with_AliasConstKind),
  <E>(s: AliasConst, f: FallibleTypeFolder<E>): Result<AliasConst, E> => try_fold_with_Alias(s, f, try_fold_with_AliasConstKind),
  (s: AliasConst, f: TypeFolder): AliasConst => fold_with_Alias(s, f, fold_with_AliasConstKind),
);

/** `(I::GenericArgs, ExternalConstraintsData<I>)` */
const fold_ExternalConstraintsData_: TypeFoldable<ExternalConstraintsData> = descriptor(
  <R>(s: ExternalConstraintsData, v: TypeVisitor<R>): R => visit_with_ExternalConstraintsData(s, v),
  <E>(s: ExternalConstraintsData, f: FallibleTypeFolder<E>): Result<ExternalConstraintsData, E> => try_fold_with_ExternalConstraintsData(s, f),
  (s: ExternalConstraintsData, f: TypeFolder): ExternalConstraintsData => fold_with_ExternalConstraintsData(s, f),
);
const fold_GenericArgs_and_ExternalConstraintsData: TypeFoldable<readonly [GenericArgs, ExternalConstraintsData]> = descriptor(
  <R>(s: readonly [GenericArgs, ExternalConstraintsData], v: TypeVisitor<R>): R =>
    fold_tuple2(fold_GenericArgs, fold_ExternalConstraintsData_).visit_with(s as [GenericArgs, ExternalConstraintsData], v),
  <E>(s: readonly [GenericArgs, ExternalConstraintsData], f: FallibleTypeFolder<E>) =>
    fold_tuple2(fold_GenericArgs, fold_ExternalConstraintsData_).try_fold_with(s as [GenericArgs, ExternalConstraintsData], f),
  (s: readonly [GenericArgs, ExternalConstraintsData], f: TypeFolder) =>
    fold_tuple2(fold_GenericArgs, fold_ExternalConstraintsData_).fold_with(s as [GenericArgs, ExternalConstraintsData], f),
);

/** `Response<I>` */
const fold_Response_: TypeFoldable<Response> = descriptor(
  <R>(s: Response, v: TypeVisitor<R>): R => visit_with_Response(s, v),
  <E>(s: Response, f: FallibleTypeFolder<E>): Result<Response, E> => try_fold_with_Response(s, f),
  (s: Response, f: TypeFolder): Response => fold_with_Response(s, f),
);
