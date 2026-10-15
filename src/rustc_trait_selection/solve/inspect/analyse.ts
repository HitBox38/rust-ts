//! An infrastructure to mechanically analyse proof trees.
//!
//! It is unavoidable that this representation is somewhat
//! lossy as it should hide quite a few semantically relevant things,
//! e.g. canonicalization and the order of nested goals.
//!
//! @lcnr: However, a lot of the weirdness here is not strictly necessary
//! and could be improved in the future. This is mostly good enough for
//! coherence right now and was annoying to implement, so I am leaving it
//! as is until we start using it for something else.
//
// Port of compiler/rustc_trait_selection/src/solve/inspect/analyse.rs (lane trait-sel-solve).
//
// Extension module (docs/handoff/infcx-contract.md "Init order"): `#[extension(pub trait InferCtxtProofTreeExt)]` is
// assigned onto `InferCtxt.prototype`; the other modules of this crate are read inside fn bodies only.
// PORT: `InspectGoal<'a, 'tcx>` / `InspectCandidate<'a, 'tcx>` are classes. Their private fields share names with their
// accessor methods, so the fields get a trailing `_` (infcx-contract "Representation" 2): `infcx_`, `depth_`,
// `required_depth_`, `orig_values_`, `goal_`, `result_`, `source_` (InspectGoal) and `goal_`, `kind_`, `result_`,
// `shallow_certainty_` (InspectCandidate).
// PORT: `trait ProofTreeVisitor<'tcx>` is the interface `ProofTreeVisitor<R>`; `type Result: VisitorResult = ()` is
// the type parameter `R` plus the `Result` impl object (rustc_ast_ir/visit.ts), and the provided methods live in
// `ProofTreeVisitor_provided` (PORTING §8).
// PORT: the `&'a`-borrowed `steps: Vec<&'a inspect::ProbeStep>` hold the probe steps themselves (identity).

import { try_visit, type VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { InferCtxt } from "../../../rustc_infer/decls.ts";
import { fold_GenericArgs, type GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import { fold_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { UniverseIndex } from "../../../rustc_type_ir/decls.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../../../rustc_type_ir/fold.ts";
import { fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import type { RequiredDepth } from "../../../rustc_type_ir/search_graph/mod.ts";
import type { CanonicalState, GoalEvaluation as inspect_GoalEvaluation, Probe, ProbeKind, ProbeStep } from "../../../rustc_type_ir/solve/inspect.ts";
import { debug_Certainty, fold_with_Goal, type Certainty, type Goal, type GoalSource, type NoSolution, type QueryResult, try_fold_with_Goal, visit_with_Goal } from "../../../rustc_type_ir/solve/mod.ts";
import type { TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import { debug_option, PLAIN } from "../../../std/fmt.ts";
import { assert_matches, panic, unreachable } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import { canonical, solve } from "../../../rustc_next_trait_solver/lib.ts";
import { SolverDelegate } from "../delegate.ts";

// PORT(decls): decls.ts declares `visit_proof_tree<R>(goal, visitor: ProofTreeVisitor<R>): R`; `V::Result` is the
// visitor's `R`.

export interface InspectConfig {
  max_depth: number;
}

export class InspectGoal {
  constructor(
    public infcx_: SolverDelegate,
    // Record how deep we are in nested goals from the root goal.
    public depth_: number,
    // Required depth to complete the evaluation of this goal.
    public required_depth_: RequiredDepth,
    public orig_values_: GenericArg[],
    public prev_universe: UniverseIndex,
    public goal_: Goal<Predicate>,
    public result_: Result<Certainty, NoSolution>,
    public final_revision: Probe,
    public source_: GoalSource,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:211 infcx
  infcx(): InferCtxt {
    return this.infcx_.deref();
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:215 goal
  goal(): Goal<Predicate> {
    return this.goal_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:219 result
  result(): Result<Certainty, NoSolution> {
    return this.result_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:223 source
  source(): GoalSource {
    return this.source_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:227 depth
  depth(): number {
    return this.depth_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:231 required_depth
  required_depth(): RequiredDepth {
    return this.required_depth_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:235 orig_values
  orig_values(): readonly GenericArg[] {
    return this.orig_values_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:239 candidates_recur
  candidates_recur(candidates: InspectCandidate[], steps: ProbeStep[], probe: Probe): void {
    let shallow_certainty: Certainty | undefined = undefined;
    for (const step of probe.steps) {
      switch (step.$) {
        case "AddGoal":
        case "RecordImplArgs":
          steps.push(step);
          break;
        case "MakeCanonicalResponse": {
          const c = step.shallow_certainty;
          // `shallow_certainty.replace(c)`
          const prev = shallow_certainty;
          shallow_certainty = c;
          assert_matches(
            prev,
            prev === undefined || (prev.$ === "Maybe" && prev._0.cause.$ === "Ambiguity"),
            // PORT: `stringify!` of the pattern (only an ICE prints it).
            "None | Some(Certainty::Maybe(MaybeInfo { cause: MaybeCause::Ambiguity, opaque_types_jank: _, stalled_on_coroutines: _ }))",
            (v) => debug_option(v, PLAIN, debug_Certainty),
          );
          break;
        }
        case "NestedProbe": {
          const probe = step._0;
          switch (probe.kind.$) {
            // These never assemble candidates for the goal we're trying to solve.
            case "ProjectionCompatibility":
            case "ShadowedEnvProbing":
              continue;

            case "NormalizedSelfTyAssembly":
            case "UnsizeAssembly":
            case "Root":
            case "TraitCandidate":
            case "OpaqueTypeStorageLookup":
            case "RigidAlias": {
              // Nested probes have to prove goals added in their parent
              // but do not leak them, so we truncate the added goals
              // afterwards.
              const num_steps = steps.length;
              this.candidates_recur(candidates, steps, probe);
              steps.length = num_steps;
              break;
            }
          }
          break;
        }
      }
    }

    const kind = probe.kind;
    switch (kind.$) {
      case "ProjectionCompatibility":
      case "ShadowedEnvProbing":
        return panic("internal error: entered unreachable code");

      case "NormalizedSelfTyAssembly":
      case "UnsizeAssembly":
        break;

      // We add a candidate even for the root evaluation if there
      // is only one way to prove a given goal, e.g. for `WellFormed`.
      case "Root":
      case "TraitCandidate":
      case "OpaqueTypeStorageLookup":
      case "RigidAlias": {
        const result = kind.result;
        // We only add a candidate if `shallow_certainty` was set, which means
        // that we ended up calling `evaluate_added_goals_and_make_canonical_response`.
        if (shallow_certainty !== undefined) {
          candidates.push(new InspectCandidate(this, probe.kind, steps.slice(), probe.final_state, result, shallow_certainty));
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:315 candidates
  candidates(): InspectCandidate[] {
    const candidates: InspectCandidate[] = [];
    const nested_goals: ProbeStep[] = [];
    this.candidates_recur(candidates, nested_goals, this.final_revision);
    return candidates;
  }

  /// Returns the single candidate applicable for the current goal, if it exists.
  ///
  /// Returns `None` if there are either no or multiple applicable candidates.
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:325 unique_applicable_candidate
  unique_applicable_candidate(): InspectCandidate | undefined {
    // FIXME(-Znext-solver): This does not handle impl candidates
    // hidden by env candidates.
    let candidates = this.candidates();
    candidates = candidates.filter((c) => c.result().$ === "Ok");
    const last = candidates.pop();
    return last !== undefined && candidates.length === 0 ? last : undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:333 new
  static new(infcx_: InferCtxt, depth: number, root: inspect_GoalEvaluation, source: GoalSource): InspectGoal {
    const infcx = SolverDelegate.from(infcx_);
    const prev_universe = infcx.deref().universe();

    const { uncanonicalized_goal, orig_values, final_revision, result: result0, required_depth } = root;
    // If there's a normalizes-to goal, AND the evaluation result with the result of
    // constraining the normalizes-to RHS and computing the nested goals.
    const result: Result<Certainty, NoSolution> = result0.$ === "Ok" ? Ok(result0._0.value.certainty) : result0;

    return new InspectGoal(
      infcx,
      depth,
      required_depth,
      orig_values,
      prev_universe,
      infcx.deref().deeply_resolve_via_unification_table(uncanonicalized_goal, fold_Goal_Predicate),
      result,
      final_revision,
      source,
    );
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:366 visit_with
  visit_with<R>(visitor: ProofTreeVisitor<R>): R {
    if (this.depth_ < visitor.config().max_depth) {
      let r: R | undefined;
      if ((r = try_visit(visitor.Result, visitor.visit_goal(this))) !== undefined) return r;
      return visitor.Result.output();
    } else {
      return visitor.on_recursion_limit();
    }
  }
}

export class InspectCandidate {
  constructor(
    public goal_: InspectGoal,
    public kind_: ProbeKind,
    public steps: ProbeStep[],
    public final_state: CanonicalState<null>,
    public result_: QueryResult,
    public shallow_certainty_: Certainty,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:55 kind
  kind(): ProbeKind {
    return this.kind_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:59 result
  result(): Result<Certainty, NoSolution> {
    const r = this.result_;
    return r.$ === "Ok" ? Ok(r._0.value.certainty) : r;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:63 goal
  goal(): InspectGoal {
    return this.goal_;
  }

  /// Certainty passed into `evaluate_added_goals_and_make_canonical_response`.
  ///
  /// If this certainty is `Yes`, then we must be confident that the candidate
  /// must hold iff it's nested goals hold. This is not true if the certainty is
  /// `Maybe(..)`, which suggests we forced ambiguity instead.
  ///
  /// This is *not* the certainty of the candidate's full nested evaluation, which
  /// can be accessed with [`Self::result`] instead.
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:75 shallow_certainty
  shallow_certainty(): Certainty {
    return this.shallow_certainty_;
  }

  /// Visit all nested goals of this candidate without rolling
  /// back their inference constraints. This function modifies
  /// the state of the `infcx`.
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:82 visit_nested_no_probe
  visit_nested_no_probe<R>(visitor: ProofTreeVisitor<R>): R {
    for (const goal of this.instantiate_nested_goals(visitor.span())) {
      let r: R | undefined;
      if ((r = try_visit(visitor.Result, goal.visit_with(visitor))) !== undefined) return r;
    }

    return visitor.Result.output();
  }

  /// Instantiate the nested goals for the candidate without rolling back their
  /// inference constraints. This function modifies the state of the `infcx`.
  ///
  /// See [`Self::instantiate_impl_args`] if you need the impl args too.
  // #[instrument(level = "debug", skip_all, fields(goal = ?self.goal.goal, steps = ?self.steps))]
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:99 instantiate_nested_goals
  instantiate_nested_goals(span: Span): InspectGoal[] {
    const infcx = this.goal_.infcx_;
    const orig_values = this.goal_.orig_values_.slice();

    const instantiated_goals: [GoalSource, Goal<Predicate>][] = [];
    for (const step of this.steps) {
      switch (step.$) {
        case "AddGoal":
          instantiated_goals.push([
            step._0,
            canonical.instantiate_canonical_state(infcx, span, this.goal_.prev_universe, orig_values, step._1, fold_Goal_Predicate),
          ]);
          break;
        case "RecordImplArgs":
          break;
        case "MakeCanonicalResponse":
        case "NestedProbe":
          return unreachable();
      }
    }

    // `let () = instantiate_canonical_state(..)`
    canonical.instantiate_canonical_state(infcx, span, this.goal_.prev_universe, orig_values, this.final_state, fold_unit);

    return instantiated_goals.map(([source, goal]) => this.instantiate_proof_tree_for_nested_goal(source, goal, span));
  }

  /// Instantiate the args of an impl if this candidate came from a
  /// `CandidateSource::Impl`. This function modifies the state of the
  /// `infcx`.
  // #[instrument(level = "debug", skip_all, fields(goal = ?self.goal.goal, steps = ?self.steps))]
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:144 instantiate_impl_args
  instantiate_impl_args(span: Span): GenericArgs {
    const infcx = this.goal_.infcx_;
    const orig_values = this.goal_.orig_values_.slice();

    for (const step of this.steps) {
      switch (step.$) {
        case "RecordImplArgs": {
          const impl_args = canonical.instantiate_canonical_state(
            infcx,
            span,
            this.goal_.prev_universe,
            orig_values,
            step.impl_args,
            fold_GenericArgs,
          );

          // `let () = instantiate_canonical_state(..)`
          canonical.instantiate_canonical_state(infcx, span, this.goal_.prev_universe, orig_values, this.final_state, fold_unit);

          return infcx.deref().deeply_resolve_via_unification_table(impl_args, fold_GenericArgs);
        }
        case "AddGoal":
          break;
        case "MakeCanonicalResponse":
        case "NestedProbe":
          return unreachable();
      }
    }

    return panic("expected impl args probe step for `instantiate_impl_args`");
  }

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:178 instantiate_proof_tree_for_nested_goal
  instantiate_proof_tree_for_nested_goal(source: GoalSource, goal: Goal<Predicate>, span: Span): InspectGoal {
    const infcx = this.goal_.infcx_;
    const kind = Binder.no_bound_vars(goal.predicate.kind(), fold_PredicateKind_);
    if (kind !== undefined && kind.$ === "NormalizesTo") {
      // We don't handle `NormalizesTo` as a nested goal
      return unreachable();
    } else {
      // We're using a probe here as evaluating a goal could constrain
      // inference variables by choosing one candidate. If we then recurse
      // into another candidate who ends up with different inference
      // constraints, we get an ICE if we already applied the constraints
      // from the chosen candidate.
      const proof_tree = infcx
        .deref()
        .probe((_) => solve.SolverDelegateEvalExt_for_D.evaluate_root_goal_for_proof_tree(infcx, goal, span)[1]);
      return InspectGoal.new(infcx.deref(), this.goal_.depth_ + 1, proof_tree, source);
    }
  }

  /// Visit all nested goals of this candidate, rolling back
  /// all inference constraints.
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:205 visit_nested_in_probe
  visit_nested_in_probe<R>(visitor: ProofTreeVisitor<R>): R {
    return this.goal_.infcx_.deref().probe((_) => this.visit_nested_no_probe(visitor));
  }
}

/// The public API to interact with proof trees.
// rustc-trait: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:377 ProofTreeVisitor
export interface ProofTreeVisitor<R = unknown> {
  /** `type Result: VisitorResult = ();`: the impl object (module comment). */
  readonly Result: VisitorResult<R, unknown>;

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:380 span
  span(): Span;

  // (provided) analyse.rs:382 config -> ProofTreeVisitor_provided.config
  config(): InspectConfig;

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:386 visit_goal
  visit_goal(goal: InspectGoal): R;

  // (provided) analyse.rs:388 on_recursion_limit -> ProofTreeVisitor_provided.on_recursion_limit
  on_recursion_limit(): R;
}

/** The provided methods of `ProofTreeVisitor` (PORTING §8; `self` first). */
export const ProofTreeVisitor_provided = {
  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:382 config
  config<R>(_self: ProofTreeVisitor<R>): InspectConfig {
    return { max_depth: 10 };
  },

  // rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:388 on_recursion_limit
  on_recursion_limit<R>(self: ProofTreeVisitor<R>): R {
    return self.Result.output();
  },
};

// ---- #[extension(pub trait InferCtxtProofTreeExt<'tcx>)] impl InferCtxt ----

// rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:395 visit_proof_tree
InferCtxt.prototype.visit_proof_tree = function <R>(this: InferCtxt, goal: Goal<Predicate>, visitor: ProofTreeVisitor<R>): R {
  return this.visit_proof_tree_at_depth(goal, 0, visitor);
};

// rustc: compiler/rustc_trait_selection/src/solve/inspect/analyse.rs:403 visit_proof_tree_at_depth
InferCtxt.prototype.visit_proof_tree_at_depth = function <R>(
  this: InferCtxt,
  goal: Goal<Predicate>,
  depth: number,
  visitor: ProofTreeVisitor<R>,
): R {
  const [, proof_tree] = solve.SolverDelegateEvalExt_for_D.evaluate_root_goal_for_proof_tree(SolverDelegate.from(this), goal, visitor.span());
  return visitor.visit_goal(InspectGoal.new(this, depth, proof_tree, "Misc"));
};

// ---- helpers ----------------------------------------------------------------------------------------------------------

// PORT (D4): the descriptors this file instantiates canonical states at.
/** `Goal<'tcx, ty::Predicate<'tcx>>` */
export const fold_Goal_Predicate: TypeFoldable<Goal<Predicate>> = {
  visit_with: <R>(s: Goal<Predicate>, v: TypeVisitor<R>): R => visit_with_Goal(s, v, fold_Predicate.visit_with),
  try_fold_with: <E>(s: Goal<Predicate>, f: FallibleTypeFolder<E>): Result<Goal<Predicate>, E> => try_fold_with_Goal(s, f, fold_Predicate.try_fold_with),
  fold_with: (s: Goal<Predicate>, f: TypeFolder): Goal<Predicate> => fold_with_Goal(s, f, fold_Predicate.fold_with),
};
/** `()` */
export const fold_unit: TypeFoldable<null> = {
  visit_with: <R>(_s: null, v: TypeVisitor<R>): R => v.Result.output(),
  try_fold_with: <E>(s: null, _f: FallibleTypeFolder<E>): Result<null, E> => Ok(s),
  fold_with: (s: null, _f: TypeFolder): null => s,
};
/** `ty::PredicateKind<'tcx>` */
const fold_PredicateKind_: TypeFoldable<PredicateKind> = {
  visit_with: <R>(s: PredicateKind, v: TypeVisitor<R>): R => visit_with_PredicateKind(s, v),
  try_fold_with: <E>(s: PredicateKind, f: FallibleTypeFolder<E>): Result<PredicateKind, E> => try_fold_with_PredicateKind(s, f),
  fold_with: (s: PredicateKind, f: TypeFolder): PredicateKind => fold_with_PredicateKind(s, f),
};

