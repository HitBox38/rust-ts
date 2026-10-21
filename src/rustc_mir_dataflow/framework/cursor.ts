// Port of compiler/rustc_mir_dataflow/src/framework/cursor.rs (lane dataflow-contract).
// PORT (plan-m4 D5): `ResultsCursor<'mir, 'tcx, A>` is `ResultsCursor<D, A>` (`D` = `A::Domain`). The field `body` is
// `body_` (the method `body()` collides; precedent `NiceRegionError.regions_`). The `#[cfg(debug_assertions)]` field
// `reachable_blocks` and its checks are not compiled in (rustc ships without debug assertions).
//! Random access inspection of the results of a dataflow analysis.

import { type Debug, debug_option, debug_struct } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import { BasicBlock, type Body, type Location, Location_cmp, START_BLOCK } from "../pending.ts";
import { type Analysis, Effect, Effect_cmp, type EffectIndex, EffectIndex_eq, debug_EffectIndex } from "./mod.ts";
import type { Results } from "./results.ts";

/// This is like `Cow`, but it lacks the `T: ToOwned` bound and doesn't support
/// `to_owned`/`into_owned`.
// rustc-type: compiler/rustc_mir_dataflow/src/framework/cursor.rs:14 SimpleCow
type SimpleCow<T> = { $: "Borrowed"; _0: T } | { $: "Owned"; _0: T };

const SimpleCow = {
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:22 deref
  deref<T>(self: SimpleCow<T>): T {
    switch (self.$) {
      case "Borrowed":
        return self._0;
      case "Owned":
        return self._0;
    }
  },
};

/// Allows random access inspection of the results of a dataflow analysis. Use this when you want
/// to inspect domain values only in certain locations; use `ResultsVisitor` if you want to inspect
/// domain values in many or all locations.
///
/// Because `Results` only has domain values for the entry of each basic block, these inspections
/// involve some amount of domain value recomputations. This cursor only has linear performance
/// within a basic block when its statements are visited in the same order as the `DIRECTION` of
/// the analysis. In the worst case—when statements are visited in *reverse* order—performance will
/// be quadratic in the number of statements in the block. The order in which basic blocks are
/// inspected has no impact on performance.
// rustc-type: compiler/rustc_mir_dataflow/src/framework/cursor.rs:40 ResultsCursor
export class ResultsCursor<D, A extends Analysis<D, unknown> = Analysis<D, unknown>> {
  constructor(
    public body_: Body,
    public results: SimpleCow<Results<D, A>>,
    public state: D,

    public pos: CursorPosition,

    /// Indicates that `state` has been modified with a custom effect.
    ///
    /// When this flag is set, we need to reset to an entry set before doing a seek.
    public state_needs_reset: boolean,

    // #[cfg(debug_assertions)]
    // reachable_blocks: DenseBitSet<BasicBlock>,
  ) {}

  /// Returns the dataflow state at the current location.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:64 get
  get(): D {
    return this.state;
  }

  /// Returns the body this analysis was run on.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:69 body
  body(): Body {
    return this.body_;
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:73 new
  private static new<D, A extends Analysis<D, unknown>>(body: Body, results: SimpleCow<Results<D, A>>): ResultsCursor<D, A> {
    const bottom_value = SimpleCow.deref(results).analysis.bottom_value(body);
    return new ResultsCursor<D, A>(
      body,
      results,

      // Initialize to the `bottom_value` and set `state_needs_reset` to tell the cursor that
      // it needs to reset to block entry before the first seek. The cursor position is
      // immaterial.
      bottom_value,
      CursorPosition.block_entry(START_BLOCK),
      true,

      // #[cfg(debug_assertions)]
      // reachable_blocks: mir::traversal::reachable_as_bitset(body),
    );
  }

  /// Returns a new cursor that takes ownership of and inspects analysis results.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:92 new_owning
  static new_owning<D, A extends Analysis<D, unknown>>(body: Body, results: Results<D, A>): ResultsCursor<D, A> {
    return ResultsCursor.new<D, A>(body, { $: "Owned", _0: results });
  }

  /// Returns a new cursor that borrows and inspects analysis results.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:97 new_borrowing
  static new_borrowing<D, A extends Analysis<D, unknown>>(body: Body, results: Results<D, A>): ResultsCursor<D, A> {
    return ResultsCursor.new<D, A>(body, { $: "Borrowed", _0: results });
  }

  /// Allows inspection of unreachable basic blocks even with `debug_assertions` enabled.
  // #[cfg(test)]
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:103 allow_unreachable
  allow_unreachable(): void {
    // #[cfg(debug_assertions)]
    // self.reachable_blocks.insert_all()
  }

  /// Returns the `Analysis` used to generate the underlying `Results`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:109 analysis
  analysis(): A {
    return SimpleCow.deref(this.results).analysis;
  }

  /// Resets the cursor to hold the entry set for the given basic block.
  ///
  /// For forward dataflow analyses, this is the dataflow state prior to the first statement.
  ///
  /// For backward dataflow analyses, this is the dataflow state after the terminator.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:118 seek_to_block_entry
  seek_to_block_entry(block: BasicBlock): void {
    // #[cfg(debug_assertions)]
    // assert!(self.reachable_blocks.contains(block));

    const results = SimpleCow.deref(this.results);
    results.analysis.Domain.clone_from(this.state, results.entry_states[block]!);
    this.pos = CursorPosition.block_entry(block);
    this.state_needs_reset = false;
  }

  /// Resets the cursor to hold the state prior to the first statement in a basic block.
  ///
  /// For forward analyses, this is the entry set for the given block.
  ///
  /// For backward analyses, this is the state that will be propagated to its
  /// predecessors (ignoring edge-specific effects).
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:133 seek_to_block_start
  seek_to_block_start(block: BasicBlock): void {
    if (this.analysis().Direction.IS_FORWARD) {
      this.seek_to_block_entry(block);
    } else {
      this.seek_after(BasicBlock.start_location(block), Effect.Primary);
    }
  }

  /// Resets the cursor to hold the state after the terminator in a basic block.
  ///
  /// For backward analyses, this is the entry set for the given block.
  ///
  /// For forward analyses, this is the state that will be propagated to its
  /// successors (ignoring edge-specific effects).
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:147 seek_to_block_end
  seek_to_block_end(block: BasicBlock): void {
    if (this.analysis().Direction.IS_BACKWARD) {
      this.seek_to_block_entry(block);
    } else {
      this.seek_after(this.body_.terminator_loc(block), Effect.Primary);
    }
  }

  /// Advances the cursor to hold the dataflow state at `target` before its "primary" effect is
  /// applied.
  ///
  /// The "early" effect at the target location *will be* applied.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:159 seek_before_primary_effect
  seek_before_primary_effect(target: Location): void {
    this.seek_after(target, Effect.Early);
  }

  /// Advances the cursor to hold the dataflow state at `target` after its "primary" effect is
  /// applied.
  ///
  /// The "early" effect at the target location will be applied as well.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:167 seek_after_primary_effect
  seek_after_primary_effect(target: Location): void {
    this.seek_after(target, Effect.Primary);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:171 seek_after
  private seek_after(target: Location, effect: Effect): void {
    assert(
      Location_cmp(target, this.body_.terminator_loc(target.block)) <= 0,
      "assertion failed: target <= self.body.terminator_loc(target.block)",
    );

    const Direction = this.analysis().Direction;

    // Reset to the entry of the target block if any of the following are true:
    //   - A custom effect has been applied to the cursor state.
    //   - We are in a different block than the target.
    //   - We are in the same block but have advanced past the target effect.
    if (this.state_needs_reset || this.pos.block !== target.block) {
      this.seek_to_block_entry(target.block);
    } else if (this.pos.curr_effect_index !== undefined) {
      const curr_effect = this.pos.curr_effect_index;
      let ord: number = Math.sign(curr_effect.statement_index - target.statement_index);
      if (Direction.IS_BACKWARD) {
        ord = -ord;
      }

      const then_with = ord !== 0 ? ord : Effect_cmp(curr_effect.effect, effect);
      if (then_with === 0) {
        return;
      } else if (then_with > 0) {
        this.seek_to_block_entry(target.block);
      } else {
        // Ordering::Less => {}
      }
    }

    // At this point, the cursor is in the same block as the target location at an earlier
    // statement.
    // debug_assert_eq!(target.block, self.pos.block);

    const block_data = this.body_.index(target.block);
    const next_effect =
      this.pos.curr_effect_index === undefined ? Direction.first_index(block_data) : Direction.next_index(this.pos.curr_effect_index);
    const target_effect_index = Effect.at_index(effect, target.statement_index);

    let idx = next_effect;
    const analysis = this.analysis();
    for (;;) {
      analysis.apply_effect(this.state, target.block, block_data, idx);
      if (EffectIndex_eq(idx, target_effect_index)) {
        break;
      }
      idx = Direction.next_index(idx);
    }

    this.pos = new CursorPosition(target.block, target_effect_index);
  }

  /// Applies `f` to the cursor's internal state.
  ///
  /// This can be used, e.g., to apply the call return effect directly to the cursor without
  /// creating an extra copy of the dataflow state.
  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:221 apply_custom_effect
  apply_custom_effect(f: (analysis: A, state: D) => void): void {
    f(SimpleCow.deref(this.results).analysis, this.state);
    this.state_needs_reset = true;
  }
}

// #[derive(Clone, Copy, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/cursor.rs:228 CursorPosition
class CursorPosition {
  constructor(
    readonly block: BasicBlock,
    readonly curr_effect_index: EffectIndex | undefined,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/framework/cursor.rs:234 block_entry
  static block_entry(block: BasicBlock): CursorPosition {
    return new CursorPosition(block, undefined);
  }
}

export const debug_CursorPosition: Debug<CursorPosition> = (self, f) =>
  debug_struct(f, "CursorPosition", [
    ["block", BasicBlock.debug(self.block, f)],
    ["curr_effect_index", debug_option(self.curr_effect_index, f, debug_EffectIndex)],
  ]);
