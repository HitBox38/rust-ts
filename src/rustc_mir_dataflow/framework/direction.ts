// Port of compiler/rustc_mir_dataflow/src/framework/direction.rs (lane dataflow-contract).
//
// PORT (plan-m4 D5): `trait Direction` is the interface `Direction` (its consts are fields, `IS_BACKWARD` is
// `!IS_FORWARD`); `struct Backward` / `struct Forward` are the two objects implementing it. The generic
// `A: Analysis<'tcx>` is erased to `Analysis<D, S>`; `propagate: impl FnMut(BasicBlock, &A::Domain)` is a closure.

import { panic } from "../../std/panic.ts";
import type { BasicBlock, BasicBlockData, Body, Location } from "../pending.ts";
import type { ResultsVisitor } from "./visitor.ts";
import { type Analysis, Effect, type EffectIndex, SwitchTargetIndex } from "./mod.ts";

// rustc-trait: compiler/rustc_mir_dataflow/src/framework/direction.rs:7 Direction
export interface Direction {
  readonly IS_FORWARD: boolean;
  /** `const IS_BACKWARD: bool = !Self::IS_FORWARD;` */
  readonly IS_BACKWARD: boolean;

  /// Returns the first statement index for this direction. (0 when going forward and
  /// `statements.len()` when going backward.)
  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:13 first_index
  first_index(block_data: BasicBlockData): EffectIndex;

  /// Returns the next index for this direction.
  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:16 next_index
  next_index(idx: EffectIndex): EffectIndex;

  /// Called by `iterate_to_fixpoint` during initial analysis computation.
  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:19 apply_effects_in_block
  apply_effects_in_block<D, S>(
    analysis: Analysis<D, S>,
    body: Body,
    state: D,
    block: BasicBlock,
    block_data: BasicBlockData,
    propagate: (target: BasicBlock, state: D) => void,
  ): void;

  /// Called by `ResultsVisitor` to recompute the analysis domain values for
  /// all locations in a basic block (starting from `entry_state` and to
  /// visit them with `vis`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:32 visit_results_in_block
  visit_results_in_block<D, S, A extends Analysis<D, S>>(
    analysis: A,
    state: D,
    block: BasicBlock,
    block_data: BasicBlockData,
    vis: ResultsVisitor<D, A>,
  ): void;
}

/// Dataflow that runs from the exit of a block (terminator), to its entry (the first statement).
// rustc-type: compiler/rustc_mir_dataflow/src/framework/direction.rs:43 Backward
export const Backward: Direction = {
  IS_FORWARD: false,
  IS_BACKWARD: true,

  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:48 first_index
  first_index(block_data: BasicBlockData): EffectIndex {
    return Effect.at_index(Effect.Early, block_data.statements.length);
  },

  /// Returns the next index for this direction.
  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:53 next_index
  next_index(idx: EffectIndex): EffectIndex {
    switch (idx.effect) {
      case "Early":
        return Effect.at_index(Effect.Primary, idx.statement_index);
      case "Primary":
        // PORT: `idx.statement_index - 1` is a `usize` subtraction (overflow panics only with debug assertions).
        return Effect.at_index(Effect.Early, idx.statement_index - 1);
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:60 apply_effects_in_block
  apply_effects_in_block<D, S>(
    analysis: Analysis<D, S>,
    body: Body,
    state: D,
    block: BasicBlock,
    block_data: BasicBlockData,
    propagate: (target: BasicBlock, state: D) => void,
  ): void {
    const terminator = block_data.terminator();
    const location: Location = { block, statement_index: block_data.statements.length };
    analysis.apply_early_terminator_effect(state, terminator, location);
    analysis.apply_primary_terminator_effect(state, terminator, location);
    for (let statement_index = block_data.statements.length - 1; statement_index >= 0; statement_index--) {
      const statement = block_data.statements[statement_index]!;
      const location: Location = { block, statement_index };
      analysis.apply_early_statement_effect(state, statement, location);
      analysis.apply_primary_statement_effect(state, statement, location);
    }

    const exit_state = state;
    for (const pred of body.basic_blocks.predecessors()[block]!) {
      const edges = body.index(pred).terminator().edges();
      // Apply terminator-specific edge effects.
      if (edges.$ === "AssignOnReturn" && edges.return_.includes(block)) {
        const place = edges.place;
        const tmp = analysis.Domain.clone(exit_state);
        analysis.apply_call_return_effect(tmp, pred, place);
        propagate(pred, tmp);
      } else if (edges.$ === "SwitchInt") {
        const { targets, discr } = edges;
        const _data = analysis.get_switch_int_data(pred, targets, discr);
        if (_data !== undefined) {
          panic("SwitchInt edge effects are unsupported in backward dataflow analyses");
        } else {
          propagate(pred, exit_state);
        }
      } else {
        propagate(pred, exit_state);
      }
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:107 visit_results_in_block
  visit_results_in_block<D, S, A extends Analysis<D, S>>(
    analysis: A,
    state: D,
    block: BasicBlock,
    block_data: BasicBlockData,
    vis: ResultsVisitor<D, A>,
  ): void {
    const loc: Location = { block, statement_index: block_data.statements.length };
    const term = block_data.terminator();
    analysis.apply_early_terminator_effect(state, term, loc);
    vis.visit_after_early_terminator_effect(state, term, loc);
    analysis.apply_primary_terminator_effect(state, term, loc);
    vis.visit_after_primary_terminator_effect(state, term, loc);

    for (let statement_index = block_data.statements.length - 1; statement_index >= 0; statement_index--) {
      const stmt = block_data.statements[statement_index]!;
      const loc: Location = { block, statement_index };
      analysis.apply_early_statement_effect(state, stmt, loc);
      vis.visit_after_early_statement_effect(state, stmt, loc);
      analysis.apply_primary_statement_effect(state, stmt, loc);
      vis.visit_after_primary_statement_effect(state, stmt, loc);
    }

    vis.visit_block_exit(state, block);
  },
};

/// Dataflow that runs from the entry of a block (the first statement), to its exit (terminator).
// rustc-type: compiler/rustc_mir_dataflow/src/framework/direction.rs:136 Forward
export const Forward: Direction = {
  IS_FORWARD: true,
  IS_BACKWARD: false,

  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:141 first_index
  first_index(_block_data: BasicBlockData): EffectIndex {
    return Effect.at_index(Effect.Early, 0);
  },

  /// Returns the next index for this direction.
  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:146 next_index
  next_index(idx: EffectIndex): EffectIndex {
    switch (idx.effect) {
      case "Early":
        return Effect.at_index(Effect.Primary, idx.statement_index);
      case "Primary":
        return Effect.at_index(Effect.Early, idx.statement_index + 1);
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:153 apply_effects_in_block
  apply_effects_in_block<D, S>(
    analysis: Analysis<D, S>,
    body: Body,
    state: D,
    block: BasicBlock,
    block_data: BasicBlockData,
    propagate: (target: BasicBlock, state: D) => void,
  ): void {
    for (let statement_index = 0; statement_index < block_data.statements.length; statement_index++) {
      const statement = block_data.statements[statement_index]!;
      const location: Location = { block, statement_index };
      analysis.apply_early_statement_effect(state, statement, location);
      analysis.apply_primary_statement_effect(state, statement, location);
    }
    const terminator = block_data.terminator();
    const location: Location = { block, statement_index: block_data.statements.length };
    analysis.apply_early_terminator_effect(state, terminator, location);
    // Edges are obtained *before* calling `apply_primary_terminator_effect`.
    const edges = analysis.get_terminator_edges(state, terminator, location);
    analysis.apply_primary_terminator_effect(state, terminator, location);

    const exit_state = state;
    switch (edges.$) {
      case "None":
        break;
      case "Single":
        propagate(edges._0, exit_state);
        break;
      case "Double": {
        const [target, unwind] = [edges._0, edges._1];
        propagate(target, exit_state);
        propagate(unwind, exit_state);
        break;
      }
      case "AssignOnReturn": {
        const { return_, cleanup, place } = edges;
        // This must be done *first*, otherwise the unwind path will see the assignments.
        if (cleanup !== undefined) {
          propagate(cleanup, exit_state);
        }

        if (return_.length !== 0) {
          analysis.apply_call_return_effect(exit_state, block, place);
          for (const target of return_) {
            propagate(target, exit_state);
          }
        }
        break;
      }
      case "SwitchInt": {
        const { targets, discr } = edges;
        const data = analysis.get_switch_int_data(block, targets, discr);
        if (data !== undefined) {
          const tmp = analysis.bottom_value(body);
          let i = 0;
          for (const [_value, target] of targets.iter()) {
            analysis.Domain.clone_from(tmp, exit_state);
            const target_idx = SwitchTargetIndex.Normal(i);
            analysis.apply_switch_int_edge_effect(tmp, data, target_idx);
            propagate(target, tmp);
            i++;
          }

          // Once we get to the final, "otherwise" branch, there is no need to preserve
          // `exit_state`, so pass it directly to `apply_switch_int_edge_effect` to save
          // a clone of the dataflow state.
          analysis.apply_switch_int_edge_effect(exit_state, data, SwitchTargetIndex.Otherwise);
          propagate(targets.otherwise(), exit_state);
        } else {
          for (const target of targets.all_targets()) {
            propagate(target, exit_state);
          }
        }
        break;
      }
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/direction.rs:224 visit_results_in_block
  visit_results_in_block<D, S, A extends Analysis<D, S>>(
    analysis: A,
    state: D,
    block: BasicBlock,
    block_data: BasicBlockData,
    vis: ResultsVisitor<D, A>,
  ): void {
    for (let statement_index = 0; statement_index < block_data.statements.length; statement_index++) {
      const stmt = block_data.statements[statement_index]!;
      const loc: Location = { block, statement_index };
      analysis.apply_early_statement_effect(state, stmt, loc);
      vis.visit_after_early_statement_effect(state, stmt, loc);
      analysis.apply_primary_statement_effect(state, stmt, loc);
      vis.visit_after_primary_statement_effect(state, stmt, loc);
    }

    const loc: Location = { block, statement_index: block_data.statements.length };
    const term = block_data.terminator();
    analysis.apply_early_terminator_effect(state, term, loc);
    vis.visit_after_early_terminator_effect(state, term, loc);
    analysis.apply_primary_terminator_effect(state, term, loc);
    vis.visit_after_primary_terminator_effect(state, term, loc);

    vis.visit_block_exit(state, block);
  },
};
