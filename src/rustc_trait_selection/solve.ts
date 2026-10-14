// Port of compiler/rustc_trait_selection/src/solve.rs (lane trait-sel-solve): the `solve` module of the crate.
//
// `pub use rustc_next_trait_solver::solve::*;` plus this crate's solver glue (delegate, fulfill, inspect, normalize,
// select). Init order: the modules are evaluated by ./lib.ts (rustc_infer first); this file only re-exports and holds
// the query provider.
import "../rustc_next_trait_solver/lib.ts";
import type { CanonicalInput } from "../rustc_middle/traits/solve.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { RequiredDepth } from "../rustc_type_ir/search_graph/mod.ts";
import type { Probe } from "../rustc_type_ir/solve/inspect.ts";
import type { QueryResult } from "../rustc_type_ir/solve/mod.ts";
import { solve as nts_solve } from "../rustc_next_trait_solver/lib.ts";
import { SolverDelegate_static_impl } from "./solve/delegate.ts";

export * from "../rustc_next_trait_solver/solve/mod.ts";

// mod delegate; mod fulfill; pub mod inspect; mod normalize; mod select;
export * as inspect from "./solve/inspect.ts";
// pub(crate) use delegate::SolverDelegate;
export { SolverDelegate } from "./solve/delegate.ts";
// pub use fulfill::{FulfillmentCtxt, NextSolverError};
export { FulfillmentCtxt, FromSolverError_FulfillmentError, FromSolverError_ScrubbedTraitError, type NextSolverError } from "./solve/fulfill.ts";
// pub(crate) use normalize::deeply_normalize_for_diagnostics;
// pub use normalize::{deeply_normalize, deeply_normalize_with_skipped_universes,
//     deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals, normalize};
export {
  deeply_normalize,
  deeply_normalize_for_diagnostics,
  deeply_normalize_with_skipped_universes,
  deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals,
  normalize,
} from "./solve/normalize.ts";
// pub use select::InferCtxtSelectExt; (methods on `InferCtxt.prototype`, solve/select.ts)

// rustc: compiler/rustc_trait_selection/src/solve.rs:20 evaluate_root_goal_for_proof_tree_raw
function evaluate_root_goal_for_proof_tree_raw(tcx: TyCtxt, key: [CanonicalInput, number]): [QueryResult, Probe, RequiredDepth] {
  return nts_solve.evaluate_root_goal_for_proof_tree_raw_provider(SolverDelegate_static_impl, tcx, key[0], key[1]);
}

// rustc: compiler/rustc_trait_selection/src/solve.rs:29 provide
export function provide(providers: Providers): void {
  providers.evaluate_root_goal_for_proof_tree_raw = evaluate_root_goal_for_proof_tree_raw;
}
