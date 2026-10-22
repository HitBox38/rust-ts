// Port of compiler/rustc_mir_dataflow/src/framework/visitor.rs (lane dataflow-contract).
// PORT (plan-m4 D5): `trait ResultsVisitor<'tcx, A>` is the interface `ResultsVisitor<D, A>` (`D` = `A::Domain`); all
// its methods are provided (no-ops) and live in `ResultsVisitor_provided` (PORTING §8). Implementors `extend
// ResultsVisitorBase<D, A>` (forwarders) and override what they need, or write their own forwarders.

import type { BasicBlock, Body, Location, Statement, Terminator } from "../../rustc_middle/mir/mod.ts";
import type { Analysis } from "./mod.ts";
import type { Results } from "./results.ts";

/// Calls the visitor methods in `vis` for every location in every block in `blocks`. Note that
/// every block in `blocks` must be reachable, and a `debug_assert` checks this.
// rustc: compiler/rustc_mir_dataflow/src/framework/visitor.rs:7 visit_results
export function visit_results<D, A extends Analysis<D, unknown>>(
  body: Body,
  blocks: Iterable<BasicBlock>,
  results: Results<D, A>,
  vis: ResultsVisitor<D, A>,
): void {
  const state = results.analysis.bottom_value(body);

  // #[cfg(debug_assertions)]
  // let reachable_blocks = mir::traversal::reachable_as_bitset(body);

  for (const block of blocks) {
    // #[cfg(debug_assertions)]
    // assert!(reachable_blocks.contains(block));

    const block_data = body.index(block);
    results.analysis.Domain.clone_from(state, results.entry_states[block]!);
    results.analysis.Direction.visit_results_in_block(results.analysis, state, block, block_data, vis);
  }
}

/// A visitor over the results of an `Analysis`. Use this when you want to inspect domain values in
/// many or all locations; use `ResultsCursor` if you want to inspect domain values only in certain
/// locations.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/visitor.rs:33 ResultsVisitor
export interface ResultsVisitor<D, A extends Analysis<D, unknown>> {
  /** `A` (erased; the visitor's analysis type). */
  readonly __analysis?: A;

  /// Called after all effects in a block have been applied in the direction
  /// of the analysis.
  ///
  /// In a forwards analysis, `state` is from the block's end. In a backwards
  /// analysis, `state` is from the block's start.
  // (provided) visitor.rs:42 visit_block_exit -> ResultsVisitor_provided.visit_block_exit
  visit_block_exit(state: D, block: BasicBlock): void;

  /// Called after the "early" effect of the given statement is applied to `state`.
  // (provided) visitor.rs:45 visit_after_early_statement_effect -> ResultsVisitor_provided.visit_after_early_statement_effect
  visit_after_early_statement_effect(state: D, statement: Statement, location: Location): void;

  /// Called after the "primary" effect of the given statement is applied to `state`.
  // (provided) visitor.rs:54 visit_after_primary_statement_effect -> ResultsVisitor_provided.visit_after_primary_statement_effect
  visit_after_primary_statement_effect(state: D, statement: Statement, location: Location): void;

  /// Called after the "early" effect of the given terminator is applied to `state`.
  // (provided) visitor.rs:63 visit_after_early_terminator_effect -> ResultsVisitor_provided.visit_after_early_terminator_effect
  visit_after_early_terminator_effect(state: D, terminator: Terminator, location: Location): void;

  /// Called after the "primary" effect of the given terminator is applied to `state`.
  ///
  /// The `call_return_effect` (if one exists) will *not* be applied to `state`.
  // (provided) visitor.rs:74 visit_after_primary_terminator_effect -> ResultsVisitor_provided.visit_after_primary_terminator_effect
  visit_after_primary_terminator_effect(state: D, terminator: Terminator, location: Location): void;
}

/** The provided methods of `ResultsVisitor` (PORTING §8; `self` is the visitor). */
export const ResultsVisitor_provided = {
  /// Called after all effects in a block have been applied in the direction
  /// of the analysis.
  ///
  /// In a forwards analysis, `state` is from the block's end. In a backwards
  /// analysis, `state` is from the block's start.
  // rustc: compiler/rustc_mir_dataflow/src/framework/visitor.rs:42 visit_block_exit
  visit_block_exit<D, A extends Analysis<D, unknown>>(_self: ResultsVisitor<D, A>, _state: D, _block: BasicBlock): void {},

  /// Called after the "early" effect of the given statement is applied to `state`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/visitor.rs:45 visit_after_early_statement_effect
  visit_after_early_statement_effect<D, A extends Analysis<D, unknown>>(
    _self: ResultsVisitor<D, A>,
    _state: D,
    _statement: Statement,
    _location: Location,
  ): void {},

  /// Called after the "primary" effect of the given statement is applied to `state`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/visitor.rs:54 visit_after_primary_statement_effect
  visit_after_primary_statement_effect<D, A extends Analysis<D, unknown>>(
    _self: ResultsVisitor<D, A>,
    _state: D,
    _statement: Statement,
    _location: Location,
  ): void {},

  /// Called after the "early" effect of the given terminator is applied to `state`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/visitor.rs:63 visit_after_early_terminator_effect
  visit_after_early_terminator_effect<D, A extends Analysis<D, unknown>>(
    _self: ResultsVisitor<D, A>,
    _state: D,
    _terminator: Terminator,
    _location: Location,
  ): void {},

  /// Called after the "primary" effect of the given terminator is applied to `state`.
  ///
  /// The `call_return_effect` (if one exists) will *not* be applied to `state`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/visitor.rs:74 visit_after_primary_terminator_effect
  visit_after_primary_terminator_effect<D, A extends Analysis<D, unknown>>(
    _self: ResultsVisitor<D, A>,
    _state: D,
    _terminator: Terminator,
    _location: Location,
  ): void {},
};

/** PORT (D5): a `ResultsVisitor` implementor's base whose methods forward to `ResultsVisitor_provided`. */
export abstract class ResultsVisitorBase<D, A extends Analysis<D, unknown>> implements ResultsVisitor<D, A> {
  // (provided) visitor.rs:42 visit_block_exit -> ResultsVisitor_provided.visit_block_exit
  visit_block_exit(state: D, block: BasicBlock): void {
    ResultsVisitor_provided.visit_block_exit(this, state, block);
  }
  // (provided) visitor.rs:45 visit_after_early_statement_effect -> ResultsVisitor_provided.visit_after_early_statement_effect
  visit_after_early_statement_effect(state: D, statement: Statement, location: Location): void {
    ResultsVisitor_provided.visit_after_early_statement_effect(this, state, statement, location);
  }
  // (provided) visitor.rs:54 visit_after_primary_statement_effect -> ResultsVisitor_provided.visit_after_primary_statement_effect
  visit_after_primary_statement_effect(state: D, statement: Statement, location: Location): void {
    ResultsVisitor_provided.visit_after_primary_statement_effect(this, state, statement, location);
  }
  // (provided) visitor.rs:63 visit_after_early_terminator_effect -> ResultsVisitor_provided.visit_after_early_terminator_effect
  visit_after_early_terminator_effect(state: D, terminator: Terminator, location: Location): void {
    ResultsVisitor_provided.visit_after_early_terminator_effect(this, state, terminator, location);
  }
  // (provided) visitor.rs:74 visit_after_primary_terminator_effect -> ResultsVisitor_provided.visit_after_primary_terminator_effect
  visit_after_primary_terminator_effect(state: D, terminator: Terminator, location: Location): void {
    ResultsVisitor_provided.visit_after_primary_terminator_effect(this, state, terminator, location);
  }
}
