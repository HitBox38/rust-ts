//! This file contains a number of standalone functions useful for taking _fast paths_ in the trait
//! solver. The exact place where we check for these fast paths changes, and matters a lot for
//! performance. Ideally we'd only check them in `evaluate_goal`, but when evaluating root goals
//! we can check them earlier and save some time creating an `EvalCtxt` in the first place.
//!
//! For debugging, fast paths can be disabled using `-Zdisable-fast-paths`.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/eval_ctxt/fast_path.rs (lane evalctxt-contract; the
// file belongs to lane nts-eval). The type `RerunStalled` is final; the free fns have their final signatures: fill them
// in place and add the `// rustc:` marker. Extension module (docs/handoff/evalctxt-contract.md "Init order").
// PORT: `#[inline(never)]` / `#[inline(always)]` / `#[cold]` have no TS counterpart: the two pairs of variants stay
// separate fns, as upstream.
import type { Span } from "../../../rustc_span/lib.ts";
import type { Predicate } from "../../../rustc_middle/ty/predicate.ts";
import type { Goal, GoalStalledOn, MaybeInfo } from "../../../rustc_type_ir/solve/mod.ts";
import { debug_MaybeInfo } from "../../../rustc_type_ir/solve/mod.gen.ts";
import { type Debug, debug_tuple } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
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
export function rerunning_stalled_goal_may_make_progress(
  _delegate: SolverDelegate,
  _stalled_on: GoalStalledOn | undefined,
): RerunStalled {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::fast_path::rerunning_stalled_goal_may_make_progress");
}

// Always-inlined variant for the one hot call site.
export function inlined_rerunning_stalled_goal_may_make_progress(
  _delegate: SolverDelegate,
  _stalled_on: GoalStalledOn | undefined,
): RerunStalled {
  return unported(
    "rustc_next_trait_solver::solve::eval_ctxt::fast_path::inlined_rerunning_stalled_goal_may_make_progress",
  );
}

/// `compute_goal_fast_path` is complicated enough that outling helps, so it gets optimized
/// separately from the caller. `compute_goal_fast_path` is the inlined version,
/// and most call sites (when adding goals) use it. However, when entering the root
/// we also want to check the fast path, and there the outlining matters.
///
/// FIXME(perf) cold might not be worth it here, given that we shuffled some things around since it
/// mattered.
export function compute_goal_fast_path_cold(
  _delegate: SolverDelegate,
  _goal: Goal<Predicate>,
  _origin_span: Span,
): GoalEvaluation | undefined {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::fast_path::compute_goal_fast_path_cold");
}

/// This is a fast path optimization:
/// See the docs on [`ComputeGoalFastPathOutcome`]
export function compute_goal_fast_path(
  _delegate: SolverDelegate,
  _goal: Goal<Predicate>,
  _origin_span: Span,
): GoalEvaluation | undefined {
  return unported("rustc_next_trait_solver::solve::eval_ctxt::fast_path::compute_goal_fast_path");
}
