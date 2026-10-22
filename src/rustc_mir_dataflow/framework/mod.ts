// Port of compiler/rustc_mir_dataflow/src/framework/mod.rs (lane dataflow-contract).
//
// PORT (plan-m4 D5), the dataflow contract:
// - `trait Analysis<'tcx>` is the interface `Analysis<D, S>`: `D` is `Self::Domain`, `S` is `Self::SwitchIntData`.
//   The associated types are readonly members holding impl descriptors (the layout-contract precedent):
//   `Domain: Domain<D>` (`Clone + JoinSemiLattice` plus the `Eq` / `DebugWithContext<Self>` bounds the framework and
//   graphviz use; build one with `Domain_of(..)` or the `Domain_*` helpers at the end of this file) and
//   `Direction: Direction` (`Forward` or `Backward`, direction.ts). `const NAME` is `NAME`.
//   Provided methods live in `Analysis_provided` (PORTING §8). Implementors either `extend AnalysisBase<D, S>` (an
//   abstract class whose provided methods forward to `Analysis_provided` and whose `Direction` defaults to `Forward`)
//   or implement the interface with their own forwarders. `apply_effect` is never overridden (upstream: "Do not
//   override this").
// - Domain values are mutable objects changed in place: `&mut Self::Domain` is the object, `state.clone_from(x)` is
//   `analysis.Domain.clone_from(state, x)`, `state.join(x)` is `analysis.Domain.join(state, x)`. An analysis that
//   replaces its state wholesale (`*state = ..`) writes through the object (`MaybeReachable.assign`, lattice.ts).
// - Other traits are impl tables (`BitSetExt<S, T>`, `GenKill<S, T>`, lattice.ts / fmt.ts): `state.gen_(e)` on a
//   `DenseBitSet` domain is `GenKill_DenseBitSet.gen_(state, e)`; a generic `T: GenKill<Local>` takes the table.
// - `IndexVec<BasicBlock, D>` is a `D[]` (PORTING §5). MIR types are rustc_middle mir/'s (mir-contract)
//   and bit sets rustc_index's (index-ds); merge-w21 removed the contract's stand-ins (pending.ts).
//! A framework that can express both [gen-kill] and generic dataflow problems.
//!
//! To use this framework, implement the [`Analysis`] trait. There used to be a `GenKillAnalysis`
//! alternative trait for gen-kill analyses that would pre-compute the transfer function for each
//! block. It was intended as an optimization, but it ended up not being any faster than
//! `Analysis`.
//!
//! The `impls` module contains several examples of dataflow analyses.
//!
//! Then call `iterate_to_fixpoint` on your type that impls `Analysis` to get a `Results`. From
//! there, you can use a `ResultsCursor` to inspect the fixpoint solution to your dataflow problem
//! (good for inspecting a small number of locations), or implement the `ResultsVisitor` interface
//! and use `visit_results` (good for inspecting many or all locations). The following example uses
//! the `ResultsCursor` approach.
//!
//! ```ignore (cross-crate-imports)
//! use rustc_const_eval::dataflow::Analysis; // Makes `iterate_to_fixpoint` available.
//!
//! fn do_my_analysis(tcx: TyCtxt<'tcx>, body: &mir::Body<'tcx>) {
//!     let analysis = MyAnalysis::new()
//!         .iterate_to_fixpoint(tcx, body, None)
//!         .into_results_cursor(body);
//!
//!     // Print the dataflow state *after* each statement in the start block.
//!     for (_, statement_index) in body.block_data[START_BLOCK].statements.iter_enumerated() {
//!         cursor.seek_after(Location { block: START_BLOCK, statement_index });
//!         let state = cursor.get();
//!         println!("{:?}", state);
//!     }
//! }
//! ```
//!
//! [gen-kill]: https://en.wikipedia.org/wiki/Data-flow_analysis#Bit_vector_problems

import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Debug, debug_struct, debug_tuple } from "../../std/fmt.ts";
import { panic, unreachable } from "../../std/panic.ts";
import { type BasicBlock, type BasicBlockData, type Body, type CallReturnPlaces, Location, type Operand, START_BLOCK, type Statement, type SwitchTargets, type Terminator, type TerminatorEdges } from "../../rustc_middle/mir/mod.ts";
import { MixedBitSet } from "../../rustc_index/bit_set.ts";
import { Forward, type Direction } from "./direction.ts";
import {
  type DebugWithContext,
  DebugWithContext_DenseBitSet,
  DebugWithContext_MaybeReachable,
  DebugWithContext_MixedBitSet,
} from "./fmt.ts";
import { write_graphviz_results } from "./graphviz.ts";
import {
  Clone_MaybeReachable,
  type JoinSemiLattice,
  JoinSemiLattice_DenseBitSet,
  JoinSemiLattice_MaybeReachable,
  JoinSemiLattice_MixedBitSet,
  type MaybeReachable,
} from "./lattice.ts";
import { Results } from "./results.ts";

export * as fmt from "./fmt.ts";
export * as graphviz from "./graphviz.ts";
export * as lattice from "./lattice.ts";

export { ResultsCursor } from "./cursor.ts";
export { Backward, type Direction, Forward } from "./direction.ts";
export { type JoinSemiLattice, MaybeReachable } from "./lattice.ts";
export { type EntryStates, Results } from "./results.ts";
export { type ResultsVisitor, ResultsVisitor_provided, ResultsVisitorBase, visit_results } from "./visitor.ts";

/// Analysis domains are all bitsets of various kinds. This trait holds
/// operations needed by all of them.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/mod.rs:63 BitSetExt
export interface BitSetExt<S, T> {
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:64 contains
  contains(self: S, elem: T): boolean;
}

export const BitSetExt_DenseBitSet = {
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:68 contains
  contains<T extends number>(self: DenseBitSet<T>, elem: T): boolean {
    return self.contains(elem);
  },
};

export const BitSetExt_MixedBitSet = {
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:74 contains
  contains<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    return MixedBitSet.contains(self, elem);
  },
};

/** `Clone` (std): `clone` and `clone_from` (which writes into `self`). */
export interface Clone<T> {
  clone(self: T): T;
  clone_from(self: T, source: T): void;
}

/**
 * PORT (D5): the descriptor of `type Domain: Clone + JoinSemiLattice`, with the `Eq` and `DebugWithContext<Self>`
 * bounds that `iterate_to_fixpoint` and graphviz put on it (`C` is the analysis, typed `unknown` here).
 */
export interface Domain<D> extends Clone<D>, JoinSemiLattice<D>, DebugWithContext<D, unknown> {}

/// A dataflow problem with an arbitrarily complex transfer function.
///
/// This trait specifies the lattice on which this analysis operates (the domain), its
/// initial value at the entry point of each basic block, and various operations.
///
/// # Convergence
///
/// When implementing this trait it's possible to choose a transfer function such that the analysis
/// does not reach fixpoint. To guarantee convergence, your transfer functions must maintain the
/// following invariant:
///
/// > If the dataflow state **before** some point in the program changes to be greater
/// than the prior state **before** that point, the dataflow state **after** that point must
/// also change to be greater than the prior state **after** that point.
///
/// This invariant guarantees that the dataflow state at a given point in the program increases
/// monotonically until fixpoint is reached. Note that this monotonicity requirement only applies
/// to the same point in the program at different points in time. The dataflow state at a given
/// point in the program may or may not be greater than the state at any preceding point.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/mod.rs:98 Analysis
export interface Analysis<D, S = never> {
  /// The type that holds the dataflow state at any given point in the program.
  readonly Domain: Domain<D>;

  /// The direction of this analysis. Either `Forward` or `Backward`.
  // type Direction: Direction = Forward;
  readonly Direction: Direction;

  /// Auxiliary data used for analyzing `SwitchInt` terminators, if necessary.
  // type SwitchIntData = !;   (the type parameter `S`)

  /// A descriptive name for this analysis. Used only for debugging.
  ///
  /// This name should be brief and contain no spaces, periods or other characters that are not
  /// suitable as part of a filename.
  readonly NAME: string;

  /// Returns the initial value of the dataflow state upon entry to each basic block.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:115 bottom_value
  bottom_value(body: Body): D;

  /// Mutates the initial value of the dataflow state upon entry to the `START_BLOCK`.
  ///
  /// For backward analyses, initial state (besides the bottom value) is not yet supported. Trying
  /// to mutate the initial state will result in a panic.
  //
  // FIXME: For backward dataflow analyses, the initial state should be applied to every basic
  // block where control flow could exit the MIR body (e.g., those terminated with `return` or
  // `resume`). It's not obvious how to handle `yield` points in coroutines, however.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:125 initialize_start_block
  initialize_start_block(body: Body, state: D): void;

  /// Given an `EffectIndex`, calls the appropriate `apply_*` method in the
  /// {early,primary} x {statement,terminator} space.
  ///
  /// Do not override this; instead override one or more of the `apply_*` methods.
  // (provided) mod.rs:132 apply_effect -> Analysis_provided.apply_effect
  apply_effect(state: D, block: BasicBlock, block_data: BasicBlockData, idx: EffectIndex): void;

  /// Updates the current dataflow state with an "early" effect, i.e. one
  /// that occurs immediately before the given statement.
  ///
  /// This method is useful if the consumer of the results of this analysis only needs to observe
  /// *part* of the effect of a statement (e.g. for two-phase borrows). As a general rule,
  /// analyses should not implement this without also implementing
  /// `apply_primary_statement_effect`.
  // (provided) mod.rs:168 apply_early_statement_effect -> Analysis_provided.apply_early_statement_effect
  apply_early_statement_effect(state: D, statement: Statement, location: Location): void;

  /// Updates the current dataflow state with the effect of evaluating a statement.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:177 apply_primary_statement_effect
  apply_primary_statement_effect(state: D, statement: Statement, location: Location): void;

  /// Updates the current dataflow state with an effect that occurs immediately *before* the
  /// given terminator.
  ///
  /// This method is useful if the consumer of the results of this analysis needs only to observe
  /// *part* of the effect of a terminator (e.g. for two-phase borrows). As a general rule,
  /// analyses should not implement this without also implementing
  /// `apply_primary_terminator_effect`.
  // (provided) mod.rs:191 apply_early_terminator_effect -> Analysis_provided.apply_early_terminator_effect
  apply_early_terminator_effect(state: D, terminator: Terminator, location: Location): void;

  /// Gets the terminator edges. Used by forward analyses only. Called *before*
  /// `apply_primary_terminator_effect` is applied; this might seem strange but in practice
  /// `MaybeInitializedPlaces` needs that ordering and other analyses work with either ordering.
  // (provided) mod.rs:202 get_terminator_edges -> Analysis_provided.get_terminator_edges
  get_terminator_edges(state: D, terminator: Terminator, location: Location): TerminatorEdges;

  /// Updates the current dataflow state with the effect of evaluating a terminator.
  ///
  /// The effect of a successful return from a `Call` terminator should **not** be accounted for
  /// in this function. That should go in `apply_call_return_effect`. For example, in the
  /// `InitializedPlaces` analyses, the return place for a function call is not marked as
  /// initialized here.
  // (provided) mod.rs:217 apply_primary_terminator_effect -> Analysis_provided.apply_primary_terminator_effect
  apply_primary_terminator_effect(state: D, terminator: Terminator, location: Location): void;

  /* Edge-specific effects */

  /// Updates the current dataflow state with the effect of a successful return from a `Call`
  /// terminator.
  ///
  /// This is separate from `apply_primary_terminator_effect` to properly track state across
  /// unwind edges.
  // (provided) mod.rs:232 apply_call_return_effect -> Analysis_provided.apply_call_return_effect
  apply_call_return_effect(state: D, block: BasicBlock, return_places: CallReturnPlaces): void;

  /// Used to update the current dataflow state with the effect of taking a particular branch in
  /// a `SwitchInt` terminator.
  ///
  /// Unlike the other edge-specific effects, which are allowed to mutate `Self::Domain`
  /// directly, overriders of this method must return a `Self::SwitchIntData` value (wrapped in
  /// `Some`). The `apply_switch_int_edge_effect` method will then be called once for each
  /// outgoing edge and will have access to the dataflow state that will be propagated along that
  /// edge, and also the `Self::SwitchIntData` value.
  ///
  /// This interface is somewhat more complex than the other visitor-like "effect" methods.
  /// However, it is both more ergonomic—callers don't need to recompute or cache information
  /// about a given `SwitchInt` terminator for each one of its edges—and more efficient—the
  /// engine doesn't need to clone the exit state for a block unless
  /// `get_switch_int_data` is actually called.
  // (provided) mod.rs:254 get_switch_int_data -> Analysis_provided.get_switch_int_data
  get_switch_int_data(block: BasicBlock, targets: SwitchTargets, discr: Operand): S | undefined;

  /// See comments on `get_switch_int_data`.
  // (provided) mod.rs:264 apply_switch_int_edge_effect -> Analysis_provided.apply_switch_int_edge_effect
  apply_switch_int_edge_effect(state: D, data: S, target_idx: SwitchTargetIndex): void;

  /* Extension methods */

  /// Finds the fixpoint for this dataflow problem.
  ///
  /// You shouldn't need to override this. Its purpose is to enable method chaining like so:
  ///
  /// ```ignore (cross-crate-imports)
  /// let results = MyAnalysis::new(tcx, body)
  ///     .iterate_to_fixpoint(tcx, body, None)
  ///     .into_results_cursor(body);
  /// ```
  /// You can optionally add a `pass_name` to the graphviz output for this particular run of a
  /// dataflow analysis. Some analyses are run multiple times in the compilation pipeline.
  /// Without a `pass_name` to differentiates them, only the results for the latest run will be
  /// saved.
  // (provided) mod.rs:288 iterate_to_fixpoint -> Analysis_provided.iterate_to_fixpoint
  iterate_to_fixpoint(tcx: TyCtxt, body: Body, pass_name: string | undefined): Results<D, this>;
}

// rustc_index::newtype_index! {
//     #[orderable]
//     #[debug_format = "bbr{}"]
//     struct BasicBlockRank {}
// }
// PORT: `BasicBlockRank` is declared inside `iterate_to_fixpoint` upstream; its `newtype_index!` expansion is hoisted
// here (module level) so it is built once.
type BasicBlockRank = number & { readonly __brand: "BasicBlockRank" };
const BasicBlockRank = newtype_index<BasicBlockRank>((n) => `bbr${n}`);

/** The provided methods of `Analysis` (PORTING §8; `self` is the analysis). */
export const Analysis_provided = {
  /// Given an `EffectIndex`, calls the appropriate `apply_*` method in the
  /// {early,primary} x {statement,terminator} space.
  ///
  /// Do not override this; instead override one or more of the `apply_*` methods.
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:132 apply_effect
  apply_effect<D, S>(self: Analysis<D, S>, state: D, block: BasicBlock, block_data: BasicBlockData, idx: EffectIndex): void {
    const statement_index = idx.statement_index;
    const terminator_index = block_data.statements.length;
    const loc: Location = new Location(block, statement_index);
    const is_terminator = statement_index === terminator_index;

    if (!is_terminator) {
      const statement = block_data.statements[statement_index]!;
      switch (idx.effect) {
        case "Early":
          return self.apply_early_statement_effect(state, statement, loc);
        case "Primary":
          return self.apply_primary_statement_effect(state, statement, loc);
      }
    } else {
      const terminator = block_data.terminator_();
      switch (idx.effect) {
        case "Early":
          return self.apply_early_terminator_effect(state, terminator, loc);
        case "Primary": {
          self.apply_primary_terminator_effect(state, terminator, loc);
        }
      }
    }
  },

  /// Updates the current dataflow state with an "early" effect, i.e. one
  /// that occurs immediately before the given statement.
  ///
  /// This method is useful if the consumer of the results of this analysis only needs to observe
  /// *part* of the effect of a statement (e.g. for two-phase borrows). As a general rule,
  /// analyses should not implement this without also implementing
  /// `apply_primary_statement_effect`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:168 apply_early_statement_effect
  apply_early_statement_effect<D, S>(_self: Analysis<D, S>, _state: D, _statement: Statement, _location: Location): void {},

  /// Updates the current dataflow state with an effect that occurs immediately *before* the
  /// given terminator.
  ///
  /// This method is useful if the consumer of the results of this analysis needs only to observe
  /// *part* of the effect of a terminator (e.g. for two-phase borrows). As a general rule,
  /// analyses should not implement this without also implementing
  /// `apply_primary_terminator_effect`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:191 apply_early_terminator_effect
  apply_early_terminator_effect<D, S>(_self: Analysis<D, S>, _state: D, _terminator: Terminator, _location: Location): void {},

  /// Gets the terminator edges. Used by forward analyses only. Called *before*
  /// `apply_primary_terminator_effect` is applied; this might seem strange but in practice
  /// `MaybeInitializedPlaces` needs that ordering and other analyses work with either ordering.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:202 get_terminator_edges
  get_terminator_edges<D, S>(_self: Analysis<D, S>, _state: D, terminator: Terminator, _location: Location): TerminatorEdges {
    return terminator.edges();
  },

  /// Updates the current dataflow state with the effect of evaluating a terminator.
  ///
  /// The effect of a successful return from a `Call` terminator should **not** be accounted for
  /// in this function. That should go in `apply_call_return_effect`. For example, in the
  /// `InitializedPlaces` analyses, the return place for a function call is not marked as
  /// initialized here.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:217 apply_primary_terminator_effect
  apply_primary_terminator_effect<D, S>(_self: Analysis<D, S>, _state: D, _terminator: Terminator, _location: Location): void {},

  /* Edge-specific effects */

  /// Updates the current dataflow state with the effect of a successful return from a `Call`
  /// terminator.
  ///
  /// This is separate from `apply_primary_terminator_effect` to properly track state across
  /// unwind edges.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:232 apply_call_return_effect
  apply_call_return_effect<D, S>(_self: Analysis<D, S>, _state: D, _block: BasicBlock, _return_places: CallReturnPlaces): void {},

  /// Used to update the current dataflow state with the effect of taking a particular branch in
  /// a `SwitchInt` terminator.
  ///
  /// Unlike the other edge-specific effects, which are allowed to mutate `Self::Domain`
  /// directly, overriders of this method must return a `Self::SwitchIntData` value (wrapped in
  /// `Some`). The `apply_switch_int_edge_effect` method will then be called once for each
  /// outgoing edge and will have access to the dataflow state that will be propagated along that
  /// edge, and also the `Self::SwitchIntData` value.
  ///
  /// This interface is somewhat more complex than the other visitor-like "effect" methods.
  /// However, it is both more ergonomic—callers don't need to recompute or cache information
  /// about a given `SwitchInt` terminator for each one of its edges—and more efficient—the
  /// engine doesn't need to clone the exit state for a block unless
  /// `get_switch_int_data` is actually called.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:254 get_switch_int_data
  get_switch_int_data<D, S>(_self: Analysis<D, S>, _block: BasicBlock, _targets: SwitchTargets, _discr: Operand): S | undefined {
    return undefined;
  },

  /// See comments on `get_switch_int_data`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:264 apply_switch_int_edge_effect
  apply_switch_int_edge_effect<D, S>(_self: Analysis<D, S>, _state: D, _data: S, _target_idx: SwitchTargetIndex): void {
    unreachable();
  },

  /* Extension methods */

  /// Finds the fixpoint for this dataflow problem.
  ///
  /// You shouldn't need to override this. Its purpose is to enable method chaining like so:
  ///
  /// ```ignore (cross-crate-imports)
  /// let results = MyAnalysis::new(tcx, body)
  ///     .iterate_to_fixpoint(tcx, body, None)
  ///     .into_results_cursor(body);
  /// ```
  /// You can optionally add a `pass_name` to the graphviz output for this particular run of a
  /// dataflow analysis. Some analyses are run multiple times in the compilation pipeline.
  /// Without a `pass_name` to differentiates them, only the results for the latest run will be
  /// saved.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:288 iterate_to_fixpoint
  iterate_to_fixpoint<D, S, A extends Analysis<D, S>>(self: A, tcx: TyCtxt, body: Body, pass_name: string | undefined): Results<D, A> {
    const entry_states: D[] = [];
    for (let i = 0; i < body.basic_blocks.deref().length; i++) entry_states.push(self.bottom_value(body));
    self.initialize_start_block(body, entry_states[START_BLOCK]!);

    if (self.Direction.IS_BACKWARD && !self.Domain.eq(entry_states[START_BLOCK]!, self.bottom_value(body))) {
      panic("`initialize_start_block` is not yet supported for backward dataflow analyses");
    }

    // Forward analyses use a reverse postorder (`rpo`). Every reachable basic block has a
    // *rank*: its position within `rpo`. Rank order is dataflow order: for every edge A -> B
    // that is not a back edge, rank(A) < rank(B). This is independent of basic block numbering
    // (which depends on the vagaries of CFG construction).
    //
    // The CFG traversal uses a "min-rank" algorithm. First, all reachable basic blocks are
    // marked as dirty. The loop-head invariant is that `curr_rank` always points to the
    // minimum-rank dirty block in `rpo`. Before processing that block we mark it as clean. If
    // the processing dirties a block with a rank lower than or equal to `curr_rank` (via a
    // back edge, which could be an edge-to-self) then `curr_rank` is set to that
    // lower-or-equal rank. After the block is processed, if `curr_rank` doesn't point to a
    // dirty block it is moved to the next dirty block, and we iterate again.
    //
    // This algorithm ensures each basic block is processed only after all its dirty
    // predecessors (ignoring back edges). When a back edge dirties an earlier block we return
    // to that earlier block immediately, which avoids processing later blocks with possibly
    // soon-to-be-stale information. Loop-free code is processed in a single pass.
    //
    // Backward analyses: we want a postorder instead of a reverse postorder, but we also want
    // to avoid the cost of adding a `postorder` field to `mir::basic_blocks::Cache`. We can
    // fake a postorder traversal cheaply by using a reverse postorder and flipping the rank
    // mapping. There is also one wrinkle involving unreachable blocks; see below.

    // rustc_index::newtype_index! { struct BasicBlockRank {} }   (hoisted above `Analysis_provided`)

    const rpo: readonly BasicBlock[] = body.basic_blocks.reverse_postorder();
    const last = rpo.length - 1;

    const ranks: (BasicBlockRank | undefined)[] = new Array<BasicBlockRank | undefined>(body.basic_blocks.deref().length).fill(undefined);
    for (let i = 0; i < rpo.length; i++) {
      const bb = rpo[i]!;
      const rank = self.Direction.IS_FORWARD ? i : last - i;
      ranks[bb] = BasicBlockRank.new(rank);
    }

    const dirty: DenseBitSet<BasicBlockRank> = DenseBitSet.new_filled(rpo.length);
    let curr_rank = BasicBlockRank.ZERO;

    // `state` is not actually used between iterations; this is just an optimization to avoid
    // reallocating every iteration.
    const state = self.bottom_value(body);

    for (;;) {
      const i = BasicBlockRank.as_usize(curr_rank);
      const bb = rpo[self.Direction.IS_FORWARD ? i : last - i]!;
      // debug_assert!(dirty.contains(curr_rank)); // check invariant
      dirty.remove(curr_rank); // invariant temporarily broken

      self.Domain.clone_from(state, entry_states[bb]!);
      const prop = (target: BasicBlock, state: D): void => {
        // A backward analysis may encounter an unreachable block, because a predecessor
        // of a reachable block may be unreachable. Ignore any such block. (In contrast, in
        // a forward analysis any successor of a reachable block must be reachable.)
        const target_rank_ = ranks[target];
        if (self.Direction.IS_BACKWARD && target_rank_ === undefined) {
          return;
        }
        if (target_rank_ === undefined) panic("called `Option::unwrap()` on a `None` value");
        const target_rank = target_rank_;

        const set_changed = self.Domain.join(entry_states[target]!, state);
        if (set_changed) {
          dirty.insert(target_rank);
          curr_rank = Math.min(curr_rank, target_rank) as BasicBlockRank;
        }
      };
      self.Direction.apply_effects_in_block(self, body, state, bb, body.index(bb), prop);

      const rank = dirty.first_set_at_or_after(curr_rank);
      if (rank !== undefined) {
        curr_rank = rank; // broken invariant re-established
      } else {
        break; // no more dirty blocks; finish
      }
    }

    const results = new Results<D, A>(self, entry_states);

    if (tcx.sess.opts.unstable_opts.dump_mir_dataflow) {
      const res = write_graphviz_results(tcx, body, results, pass_name);
      if (res.$ === "Err") {
        // error!("Failed to write graphviz dataflow results: {}", e);
      }
    }

    return results;
  },
};

/**
 * PORT (D5): an `Analysis` implementor's base: the provided methods forward to `Analysis_provided`, `Direction`
 * defaults to `Forward` (`type Direction: Direction = Forward`). Subclasses declare `Domain`, `NAME` and the
 * required methods, and override provided ones as upstream impls do.
 */
export abstract class AnalysisBase<D, S = never> implements Analysis<D, S> {
  abstract readonly Domain: Domain<D>;
  readonly Direction: Direction = Forward;
  abstract readonly NAME: string;
  abstract bottom_value(body: Body): D;
  abstract initialize_start_block(body: Body, state: D): void;
  abstract apply_primary_statement_effect(state: D, statement: Statement, location: Location): void;

  // (provided) mod.rs:132 apply_effect -> Analysis_provided.apply_effect
  apply_effect(state: D, block: BasicBlock, block_data: BasicBlockData, idx: EffectIndex): void {
    Analysis_provided.apply_effect(this, state, block, block_data, idx);
  }
  // (provided) mod.rs:168 apply_early_statement_effect -> Analysis_provided.apply_early_statement_effect
  apply_early_statement_effect(state: D, statement: Statement, location: Location): void {
    Analysis_provided.apply_early_statement_effect(this, state, statement, location);
  }
  // (provided) mod.rs:191 apply_early_terminator_effect -> Analysis_provided.apply_early_terminator_effect
  apply_early_terminator_effect(state: D, terminator: Terminator, location: Location): void {
    Analysis_provided.apply_early_terminator_effect(this, state, terminator, location);
  }
  // (provided) mod.rs:202 get_terminator_edges -> Analysis_provided.get_terminator_edges
  get_terminator_edges(state: D, terminator: Terminator, location: Location): TerminatorEdges {
    return Analysis_provided.get_terminator_edges(this, state, terminator, location);
  }
  // (provided) mod.rs:217 apply_primary_terminator_effect -> Analysis_provided.apply_primary_terminator_effect
  apply_primary_terminator_effect(state: D, terminator: Terminator, location: Location): void {
    Analysis_provided.apply_primary_terminator_effect(this, state, terminator, location);
  }
  // (provided) mod.rs:232 apply_call_return_effect -> Analysis_provided.apply_call_return_effect
  apply_call_return_effect(state: D, block: BasicBlock, return_places: CallReturnPlaces): void {
    Analysis_provided.apply_call_return_effect(this, state, block, return_places);
  }
  // (provided) mod.rs:254 get_switch_int_data -> Analysis_provided.get_switch_int_data
  get_switch_int_data(block: BasicBlock, targets: SwitchTargets, discr: Operand): S | undefined {
    return Analysis_provided.get_switch_int_data(this, block, targets, discr);
  }
  // (provided) mod.rs:264 apply_switch_int_edge_effect -> Analysis_provided.apply_switch_int_edge_effect
  apply_switch_int_edge_effect(state: D, data: S, target_idx: SwitchTargetIndex): void {
    Analysis_provided.apply_switch_int_edge_effect(this, state, data, target_idx);
  }
  // (provided) mod.rs:288 iterate_to_fixpoint -> Analysis_provided.iterate_to_fixpoint
  iterate_to_fixpoint(tcx: TyCtxt, body: Body, pass_name: string | undefined): Results<D, this> {
    return Analysis_provided.iterate_to_fixpoint<D, S, this>(this, tcx, body, pass_name);
  }
}

// #[derive(Debug, Clone, Copy)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/mod.rs:398 SwitchTargetIndex
export type SwitchTargetIndex =
  // Index of a normal switch target.
  | { readonly $: "Normal"; readonly _0: number }
  // The final "otherwise" fallback target.
  | { readonly $: "Otherwise" };
export const SwitchTargetIndex = {
  Normal(_0: number): SwitchTargetIndex {
    return { $: "Normal", _0 };
  },
  Otherwise: Object.freeze({ $: "Otherwise" }) as SwitchTargetIndex,
};
export const debug_SwitchTargetIndex: Debug<SwitchTargetIndex> = (self, f) =>
  self.$ === "Normal" ? debug_tuple(f, "Normal", [String(self._0)]) : "Otherwise";

/// The legal operations for a transfer function in a gen/kill problem.
// rustc-trait: compiler/rustc_mir_dataflow/src/framework/mod.rs:406 GenKill
export interface GenKill<S, T> {
  /// Inserts `elem` into the state vector.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:408 gen_
  gen_(self: S, elem: T): void;

  /// Removes `elem` from the state vector.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:411 kill
  kill(self: S, elem: T): void;

  /// Calls `gen` for each element in `elems`.
  // (provided) mod.rs:414 gen_all -> GenKill_provided.gen_all
  gen_all(self: S, elems: Iterable<T>): void;

  /// Calls `kill` for each element in `elems`.
  // (provided) mod.rs:421 kill_all -> GenKill_provided.kill_all
  kill_all(self: S, elems: Iterable<T>): void;
}

/** The provided methods of `GenKill` (PORTING §8; the impl table first, then `self`). */
export const GenKill_provided = {
  /// Calls `gen` for each element in `elems`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:414 gen_all
  gen_all<S, T>(impl: GenKill<S, T>, self: S, elems: Iterable<T>): void {
    for (const elem of elems) {
      impl.gen_(self, elem);
    }
  },

  /// Calls `kill` for each element in `elems`.
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:421 kill_all
  kill_all<S, T>(impl: GenKill<S, T>, self: S, elems: Iterable<T>): void {
    for (const elem of elems) {
      impl.kill(self, elem);
    }
  },
};

/** An impl table of `GenKill` from its two required methods (the provided ones forward to `GenKill_provided`). */
function GenKill_impl<S, T>(gen_: (self: S, elem: T) => void, kill: (self: S, elem: T) => void): GenKill<S, T> {
  const impl: GenKill<S, T> = {
    gen_,
    kill,
    gen_all: (self, elems) => GenKill_provided.gen_all(impl, self, elems),
    kill_all: (self, elems) => GenKill_provided.kill_all(impl, self, elems),
  };
  return impl;
}

/** `impl<T: Idx> GenKill<T> for DenseBitSet<T>` (generic over `T`: `GenKill_DenseBitSet<Local>()`). */
export function GenKill_DenseBitSet<T extends number>(): GenKill<DenseBitSet<T>, T> {
  return GenKill_DenseBitSet_ as GenKill<DenseBitSet<T>, T>;
}
const GenKill_DenseBitSet_: GenKill<DenseBitSet<number>, number> = GenKill_impl<DenseBitSet<number>, number>(
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:429 gen_
  function gen_(self: DenseBitSet<number>, elem: number): void {
    self.insert(elem);
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:433 kill
  function kill(self: DenseBitSet<number>, elem: number): void {
    self.remove(elem);
  },
);

/** `impl<T: Idx> GenKill<T> for MixedBitSet<T>` (generic over `T`: `GenKill_MixedBitSet<MovePathIndex>()`). */
export function GenKill_MixedBitSet<T extends number>(): GenKill<MixedBitSet<T>, T> {
  return GenKill_MixedBitSet_ as GenKill<MixedBitSet<T>, T>;
}
const GenKill_MixedBitSet_: GenKill<MixedBitSet<number>, number> = GenKill_impl<MixedBitSet<number>, number>(
  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:439 gen_
  function gen_(self: MixedBitSet<number>, elem: number): void {
    MixedBitSet.insert(self, elem);
  },

  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:443 kill
  function kill(self: MixedBitSet<number>, elem: number): void {
    MixedBitSet.remove(self, elem);
  },
);

/** `impl<T, S: GenKill<T>> GenKill<T> for MaybeReachable<S>`. */
export function GenKill_MaybeReachable<S, T>(S_: GenKill<S, T>): GenKill<MaybeReachable<S>, T> {
  return GenKill_impl<MaybeReachable<S>, T>(
    // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:449 gen_
    function gen_(self: MaybeReachable<S>, elem: T): void {
      switch (self.$) {
        // If the state is not reachable, adding an element does nothing.
        case "Unreachable":
          break;
        case "Reachable":
          S_.gen_(self._0, elem);
      }
    },

    // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:457 kill
    function kill(self: MaybeReachable<S>, elem: T): void {
      switch (self.$) {
        // If the state is not reachable, killing an element does nothing.
        case "Unreachable":
          break;
        case "Reachable":
          S_.kill(self._0, elem);
      }
    },
  );
}

// NOTE: DO NOT CHANGE VARIANT ORDER. The derived `Ord` impls rely on the current order.
// #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/mod.rs:468 Effect
export type Effect =
  /// The "early" effect (e.g., `apply_early_statement_effect`) for a statement/terminator.
  | "Early"

  /// The "primary" effect (e.g., `apply_primary_statement_effect`) for a statement/terminator.
  | "Primary";
export const Effect = {
  Early: "Early",
  Primary: "Primary",

  // rustc: compiler/rustc_mir_dataflow/src/framework/mod.rs:477 at_index
  at_index(self: Effect, statement_index: number): EffectIndex {
    return { effect: self, statement_index };
  },
} as const;
export function Effect_discriminant(e: Effect): number {
  return e === "Early" ? 0 : 1;
}
/** The derived `Ord` of `Effect`. */
export function Effect_cmp(a: Effect, b: Effect): -1 | 0 | 1 {
  const x = Effect_discriminant(a);
  const y = Effect_discriminant(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// #[derive(Clone, Copy, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/mod.rs:483 EffectIndex
export interface EffectIndex {
  readonly statement_index: number;
  readonly effect: Effect;
}
export function EffectIndex_eq(a: EffectIndex, b: EffectIndex): boolean {
  return a.statement_index === b.statement_index && a.effect === b.effect;
}
export const debug_EffectIndex: Debug<EffectIndex> = (self, f) =>
  debug_struct(f, "EffectIndex", [
    ["statement_index", String(self.statement_index)],
    ["effect", self.effect],
  ]);

// ==== PORT (D5): domain descriptors (not upstream) =================================================================

/** A `Domain<D>` from its `Clone`, `JoinSemiLattice` and `DebugWithContext` impls. */
export function Domain_of<D>(clone: Clone<D>, lattice: JoinSemiLattice<D>, debug: DebugWithContext<D, unknown>): Domain<D> {
  return {
    clone: clone.clone,
    clone_from: clone.clone_from,
    eq: lattice.eq,
    join: lattice.join,
    fmt: debug.fmt,
    fmt_with: debug.fmt_with,
    fmt_diff_with: debug.fmt_diff_with,
  };
}

/** `impl Clone for DenseBitSet<T>` (rustc_index). */
export const Clone_DenseBitSet = {
  clone<T extends number>(self: DenseBitSet<T>): DenseBitSet<T> {
    return self.clone();
  },
  clone_from<T extends number>(self: DenseBitSet<T>, source: DenseBitSet<T>): void {
    self.clone_from(source);
  },
};

/** `impl Clone for MixedBitSet<T>` (rustc_index). */
export const Clone_MixedBitSet = {
  clone: MixedBitSet.clone,
  clone_from: MixedBitSet.clone_from,
};

/** The domain `DenseBitSet<T>` with element impl `T_` (e.g. `DebugWithContext_Local`). */
export function Domain_DenseBitSet<T extends number, C>(T_: DebugWithContext<T, C>): Domain<DenseBitSet<T>> {
  return Domain_of<DenseBitSet<T>>(
    Clone_DenseBitSet,
    JoinSemiLattice_DenseBitSet,
    DebugWithContext_DenseBitSet(T_) as DebugWithContext<DenseBitSet<T>, unknown>,
  );
}

/** The domain `MixedBitSet<T>` with element impl `T_`. */
export function Domain_MixedBitSet<T extends number, C>(T_: DebugWithContext<T, C>): Domain<MixedBitSet<T>> {
  return Domain_of<MixedBitSet<T>>(
    Clone_MixedBitSet,
    JoinSemiLattice_MixedBitSet,
    DebugWithContext_MixedBitSet(T_) as DebugWithContext<MixedBitSet<T>, unknown>,
  );
}

/** The domain `MaybeReachable<S>` over the domain `S_`. */
export function Domain_MaybeReachable<S>(S_: Domain<S>): Domain<MaybeReachable<S>> {
  return Domain_of<MaybeReachable<S>>(Clone_MaybeReachable(S_), JoinSemiLattice_MaybeReachable(S_), DebugWithContext_MaybeReachable(S_));
}
