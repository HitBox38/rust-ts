//! The next-generation trait solver, currently still WIP.
//!
//! As a user of rust, you can use `-Znext-solver` to enable the new trait solver.
//!
//! As a developer of rustc, you shouldn't be using the new trait
//! solver without asking the trait-system-refactor-initiative, but it can
//! be enabled with `InferCtxtBuilder::with_next_trait_solver`. This will
//! ensure that trait solving using that inference context will be routed
//! to the new trait solver.
//!
//! For a high-level overview of how this solver works, check out the relevant
//! section of the rustc-dev-guide.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/mod.rs (lane evalctxt-contract; the file belongs to lane
// nts-eval). The types of the file (`HasChanged`, `MergeCandidateInfo`, `GoalEvaluation`, `FIXPOINT_STEP_LIMIT`) are
// final. The `EvalCtxt` methods are declared in ../decls.ts (`// solve/mod.rs:<line>`); the call at the end installs
// `unported(..)` placeholders for them. To fill one: assign `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..)
// { .. }` with the `// rustc:` marker above it, in upstream order, and delete the name from the list (the call when
// the list is empty). The free fns below have their final signatures: fill them in place and add the marker.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): lib.ts loads it after decls.ts; its top-level
// code may touch only `EvalCtxt` (decls.ts) and other crates, never another rustc_next_trait_solver module's exports.
//
// PORT: `pub use rustc_type_ir::solve::*` is the `export *` below; `pub mod inspect` is solve/inspect/mod.ts and the
// `pub use self::eval_ctxt::{..}` re-exports are at the end of this file.
import { debug_Predicate } from "../../rustc_middle/ty/structural_impls.ts";
import type { Predicate } from "../../rustc_middle/ty/predicate.ts";
import type { CanonicalResponse, Certainty, Goal, GoalStalledOn, Response } from "../../rustc_type_ir/solve/mod.ts";
import { debug_Certainty, debug_Goal, debug_GoalStalledOn } from "../../rustc_type_ir/solve/mod.gen.ts";
import type { Canonical } from "../../rustc_type_ir/canonical.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { EvalCtxt } from "../decls.ts";

export * from "../../rustc_type_ir/solve/mod.ts";

/// How many fixpoint iterations we should attempt inside of the solver before bailing
/// with overflow.
///
/// We previously used  `cx.recursion_limit().0.checked_ilog2().unwrap_or(0)` for this.
/// However, it feels unlikely that uncreasing the recursion limit by a power of two
/// to get one more iteration is ever useful or desirable. We now instead used a constant
/// here. If there ever ends up some use-cases where a bigger number of fixpoint iterations
/// is required, we can add a new attribute for that or revert this to be dependent on the
/// recursion limit again. However, this feels very unlikely.
export const FIXPOINT_STEP_LIMIT: number = 8;

/// Whether evaluating this goal ended up changing the
/// inference state.
// PORT: `#[derive(PartialEq, Eq, Debug, Hash, Clone, Copy)]` fieldless enum: `===`, Debug is the name.
export type HasChanged = "Yes" | "No";
export const HasChanged = { Yes: "Yes", No: "No" } as const;
export const debug_HasChanged: Debug<HasChanged> = (v) => v;

// FIXME(trait-system-refactor-initiative#117): we don't detect whether a response
// ended up pulling down any universes.
export function has_no_inference_or_external_constraints(_response: Canonical<Response>): boolean {
  return unported("rustc_next_trait_solver::solve::has_no_inference_or_external_constraints");
}

export function has_only_region_constraints(_response: Canonical<Response>): boolean {
  return unported("rustc_next_trait_solver::solve::has_only_region_constraints");
}

/// Whether two canonical responses are exactly equal except for their
/// region constraints.
export function equal_response_modulo_region_constraints(_a: CanonicalResponse, _b: CanonicalResponse): boolean {
  return unported("rustc_next_trait_solver::solve::equal_response_modulo_region_constraints");
}

// PORT: `#[derive(Debug)] enum MergeCandidateInfo { AlwaysApplicable(usize), EqualResponse }`.
export type MergeCandidateInfo = { readonly $: "AlwaysApplicable"; readonly _0: number } | { readonly $: "EqualResponse" };
export const MergeCandidateInfo = {
  EqualResponse: Object.freeze({ $: "EqualResponse" }) as MergeCandidateInfo,
} as const;
export const debug_MergeCandidateInfo: Debug<MergeCandidateInfo> = (v, f) => {
  switch (v.$) {
    case "AlwaysApplicable":
      return debug_tuple(f, "AlwaysApplicable", [debug_int(v._0, f)]);
    case "EqualResponse":
      return "EqualResponse";
  }
};

/// The result of evaluating a goal.
// PORT: `#[derive_where(Debug; I: Interner)]` plain struct.
export interface GoalEvaluation {
  /// The goal we've evaluated. This is the input goal, but potentially with its
  /// inference variables resolved. This never applies any inference constraints
  /// from evaluating the goal.
  ///
  /// We rely on this to check whether root goals in HIR typeck had an unresolved
  /// type inference variable in the input. We must not resolve this after evaluating
  /// the goal as even if the inference variable has been resolved by evaluating the
  /// goal itself, this goal may still end up failing due to region uniquification
  /// later on.
  ///
  /// This is used as a minor optimization to avoid re-resolving inference variables
  /// when reevaluating ambiguous goals. E.g. if we've got a goal `?x: Trait` with `?x`
  /// already being constrained to `Vec<?y>`, then the first evaluation resolves it to
  /// `Vec<?y>: Trait`. If this goal is still ambiguous and we later resolve `?y` to `u32`,
  /// then reevaluating this goal now only needs to resolve `?y` while it would otherwise
  /// have to resolve both `?x` and `?y`,
  goal: Goal<Predicate>;
  certainty: Certainty;
  has_changed: HasChanged;
  /// If the [`Certainty`] was `Maybe`, then keep track of whether the goal has changed
  /// before rerunning it.
  stalled_on: GoalStalledOn | undefined;
}
export const debug_GoalEvaluation: Debug<GoalEvaluation> = (v, f) =>
  debug_struct(f, "GoalEvaluation", [
    ["goal", debug_Goal(v.goal, f, debug_Predicate)],
    ["certainty", debug_Certainty(v.certainty, f)],
    ["has_changed", debug_HasChanged(v.has_changed, f)],
    ["stalled_on", debug_option(v.stalled_on, f, debug_GoalStalledOn)],
  ]);

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::EvalCtxt", [
  "compute_type_outlives_goal",
  "compute_region_outlives_goal",
  "compute_coerce_goal",
  "compute_subtype_goal",
  "compute_dyn_compatible_goal",
  "compute_well_formed_goal",
  "compute_unstable_feature_goal",
  "compute_const_evaluatable_goal",
  "compute_const_arg_has_type_goal",
  "try_merge_candidates",
  "bail_with_ambiguity",
  "flounder",
  "structurally_normalize_ty",
  "structurally_normalize_const",
  "structurally_normalize_term",
]);

// `pub use self::eval_ctxt::{EvalCtxt, GenerateProofTree, SolverDelegateEvalExt,
// evaluate_root_goal_for_proof_tree_raw_provider, fast_path};`
export { EvalCtxt } from "../decls.ts";
export {
  GenerateProofTree,
  SolverDelegateEvalExt_for_D,
  evaluate_root_goal_for_proof_tree_raw_provider,
} from "./eval_ctxt/mod.ts";
export type { SolverDelegateEvalExt } from "./eval_ctxt/mod.ts";
export * as fast_path from "./eval_ctxt/fast_path.ts";
export * as inspect from "./inspect/mod.ts";
