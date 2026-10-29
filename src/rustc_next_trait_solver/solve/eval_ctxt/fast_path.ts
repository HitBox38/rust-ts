//! This file contains a number of standalone functions useful for taking _fast paths_ in the trait
//! solver. The exact place where we check for these fast paths changes, and matters a lot for
//! performance. Ideally we'd only check them in `evaluate_goal`, but when evaluating root goals
//! we can check them earlier and save some time creating an `EvalCtxt` in the first place.
//!
//! For debugging, fast paths can be disabled using `-Zdisable-fast-paths`.
//
// Port of compiler/rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs (lane nts-eval; contract by lane
// evalctxt-contract). Extension module (docs/handoff/evalctxt-contract.md "Init order"): the imports of this crate's
// other modules are read inside fn bodies only.
// PORT: `#[inline(never)]` / `#[inline(always)]` / `#[cold]` have no TS counterpart: the two pairs of variants stay
// separate fns, as upstream.
import type { Span } from "../../../rustc_span/lib.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import type { Goal, GoalStalledOn, MaybeInfo } from "../../../rustc_type_ir/solve/mod.ts";
import { debug_MaybeInfo } from "../../../rustc_type_ir/solve/mod.ts";
import { type Debug, debug_tuple } from "../../../std/fmt.ts";
import { unreachable } from "../../../std/panic.ts";
import { Certainty } from "../../../rustc_type_ir/solve/mod.ts";
import { HasChanged } from "../mod.ts";
import { should_rerun_after_erased_canonicalization } from "./mod.ts";
import type { SolverDelegate } from "../../delegate.ts";
import type { GoalEvaluation } from "../mod.ts";

// PORT: `#[derive(Debug, Clone, Copy)]`.
export type RerunStalled = { readonly $: "WontMakeProgress"; readonly _0: MaybeInfo } | { readonly $: "MayMakeProgress" };
export const RerunStalled = {
  MayMakeProgress: Object.freeze({ $: "MayMakeProgress" }) as RerunStalled,
} as const;
export const debug_RerunStalled: Debug<RerunStalled> = (v, f) => {
  switch (v.$) {
    case "WontMakeProgress":
      return debug_tuple(f, "WontMakeProgress", [debug_MaybeInfo(v._0, f)]);
    case "MayMakeProgress":
      return "MayMakeProgress";
  }
};

/// If we have run a goal before, and it was stalled, check that any of the goal's
/// args have changed. This is a cheap way to determine that if we were to rerun this goal now,
/// it will remain stalled since it'll canonicalize the same way and evaluation is pure.
/// Therefore, we can skip this rerun
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs:30 rerunning_stalled_goal_may_make_progress
export function rerunning_stalled_goal_may_make_progress(
  delegate: SolverDelegate,
  stalled_on: GoalStalledOn | undefined,
): RerunStalled {
  return inlined_rerunning_stalled_goal_may_make_progress(delegate, stalled_on);
}

// Always-inlined variant for the one hot call site.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs:43 inlined_rerunning_stalled_goal_may_make_progress
export function inlined_rerunning_stalled_goal_may_make_progress(
  delegate: SolverDelegate,
  stalled_on: GoalStalledOn | undefined,
): RerunStalled {
  // If fast paths are turned off, then we assume all goals can always make progress
  if (delegate.deref().disable_trait_solver_fast_paths()) {
    return RerunStalled.MayMakeProgress;
  }

  // If the goal isn't stalled, we should definitely run it.
  if (stalled_on === undefined) {
    return RerunStalled.MayMakeProgress;
  }
  const { opaques, stalled_vars, sub_roots, stalled_maybe_info } = stalled_on;

  // PORT: (perf) the `iter().any(..)` closures are plain loops (no closure per call: this is the hot path of
  // `goal_remains_stalled`), and the `Deref` of `delegate` is read once.
  const infcx = delegate.deref();

  // If any of the stalled goal's generic arguments changed,
  // rerunning might make progress so we should rerun.
  for (let i = 0; i < stalled_vars.length; i++) {
    if (infcx.ty_or_const_infer_var_changed(stalled_vars[i]!)) {
      return RerunStalled.MayMakeProgress;
    }
  }

  // If some inference took place in any of the sub roots,
  // rerunning might make progress so we should rerun.
  for (let i = 0; i < sub_roots.length; i++) {
    if (!infcx.is_sub_unification_table_root_var(sub_roots[i]!)) {
      return RerunStalled.MayMakeProgress;
    }
  }

  switch (opaques.$) {
    case "No":
      break;
    case "Yes": {
      const { num_opaques_in_storage, previously_succeeded_in_erased } = opaques;
      // If any opaques changed in the opaque type storage,
      // rerunning might make progress so we should rerun.
      if (delegate.deref().opaque_types_storage_num_entries().needs_reevaluation(num_opaques_in_storage)) {
        // Unless this goal previously succeeded in erased mode.
        // If the stalled goal successfully evaluated while erasing opaque types,
        // and the current state of the opaque type storage is not different in a way that is
        // relevant, this stalled goal cannot make any progress and we set this variable to true.
        let previous_erased_run_is_still_valid = false;

        if (previously_succeeded_in_erased.$ === "Yes") {
          const accessed_opaques = previously_succeeded_in_erased.accessed_opaques;
          switch (
            should_rerun_after_erased_canonicalization(
              accessed_opaques,
              delegate.deref().typing_mode_raw(),
              delegate.deref().clone_opaque_types_lookup_table(),
            )
          ) {
            case "Yes":
              break;
            case "EagerlyPropagateToParent":
              return unreachable("internal error: entered unreachable code: we never retry stalled queries if the parent was erased");
            case "No":
              previous_erased_run_is_still_valid = true;
              break;
          }
        }

        if (!previous_erased_run_is_still_valid) {
          return RerunStalled.MayMakeProgress;
        }
      }
      break;
    }
  }

  // Otherwise, we can be sure that this stalled goal cannot make any progress
  // and we can exit early.
  return { $: "WontMakeProgress", _0: stalled_maybe_info };
}

/// `compute_goal_fast_path` is complicated enough that outling helps, so it gets optimized
/// separately from the caller. `compute_goal_fast_path` is the inlined version,
/// and most call sites (when adding goals) use it. However, when entering the root
/// we also want to check the fast path, and there the outlining matters.
///
/// FIXME(perf) cold might not be worth it here, given that we shuffled some things around since it
/// mattered.
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs:133 compute_goal_fast_path_cold
export function compute_goal_fast_path_cold(
  delegate: SolverDelegate,
  goal: Goal<Predicate>,
  origin_span: Span,
): GoalEvaluation | undefined {
  return compute_goal_fast_path(delegate, goal, origin_span);
}

/// This is a fast path optimization:
/// See the docs on [`ComputeGoalFastPathOutcome`]
// rustc: compiler/rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs:147 compute_goal_fast_path
export function compute_goal_fast_path(
  delegate: SolverDelegate,
  goal: Goal<Predicate>,
  origin_span: Span,
): GoalEvaluation | undefined {
  if (delegate.deref().disable_trait_solver_fast_paths()) {
    return undefined;
  }

  const outcome = delegate.compute_goal_fast_path(goal, origin_span);
  switch (outcome.$) {
    case "NoFastPath":
      return undefined;
    case "TriviallyHolds":
      return {
        goal,
        certainty: Certainty.Yes,
        has_changed: HasChanged.No,
        stalled_on: undefined,
      };
    case "TriviallyStalled":
      return {
        goal,
        certainty: Certainty.AMBIGUOUS,
        has_changed: HasChanged.No,
        stalled_on: outcome.stalled_on,
      };
  }
}
