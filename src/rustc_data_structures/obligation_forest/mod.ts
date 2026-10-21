//! The `ObligationForest` is a utility data structure used in trait
//! matching to track the set of outstanding obligations (those not yet
//! resolved to success or error). It also tracks the "backtrace" of each
//! pending obligation (why we are trying to figure this out in the first
//! place).
//!
//! ### External view
//!
//! `ObligationForest` supports two main public operations (there are a
//! few others not discussed here):
//!
//! 1. Add a new root obligations (`register_obligation`).
//! 2. Process the pending obligations (`process_obligations`).
//!
//! When a new obligation `N` is added, it becomes the root of an
//! obligation tree. This tree can also carry some per-tree state `T`,
//! which is given at the same time. This tree is a singleton to start, so
//! `N` is both the root and the only leaf. Each time the
//! `process_obligations` method is called, it will invoke its callback
//! with every pending obligation (so that will include `N`, the first
//! time). The callback also receives a (mutable) reference to the
//! per-tree state `T`. The callback should process the obligation `O`
//! that it is given and return a `ProcessResult`:
//!
//! - `Unchanged` -> ambiguous result. Obligation was neither a success
//!   nor a failure. It is assumed that further attempts to process the
//!   obligation will yield the same result unless something in the
//!   surrounding environment changes.
//! - `Changed(C)` - the obligation was *shallowly successful*. The
//!   vector `C` is a list of subobligations. The meaning of this is that
//!   `O` was successful on the assumption that all the obligations in `C`
//!   are also successful. Therefore, `O` is only considered a "true"
//!   success if `C` is empty. Otherwise, `O` is put into a suspended
//!   state and the obligations in `C` become the new pending
//!   obligations. They will be processed the next time you call
//!   `process_obligations`.
//! - `Error(E)` -> obligation failed with error `E`. We will collect this
//!   error and return it from `process_obligations`, along with the
//!   "backtrace" of obligations (that is, the list of obligations up to
//!   and including the root of the failed obligation). No further
//!   obligations from that same tree will be processed, since the tree is
//!   now considered to be in error.
//!
//! When the call to `process_obligations` completes, you get back an `Outcome`,
//! which includes two bits of information:
//!
//! - `completed`: a list of obligations where processing was fully
//!   completed without error (meaning that all transitive subobligations
//!   have also been completed). So, for example, if the callback from
//!   `process_obligations` returns `Changed(C)` for some obligation `O`,
//!   then `O` will be considered completed right away if `C` is the
//!   empty vector. Otherwise it will only be considered completed once
//!   all the obligations in `C` have been found completed.
//! - `errors`: a list of errors that occurred and associated backtraces
//!   at the time of error, which can be used to give context to the user.
//!
//! Upon completion, none of the existing obligations were *shallowly
//! successful* (that is, no callback returned `Changed(_)`). This implies that
//! all obligations were either errors or returned an ambiguous result.
//!
//! ### Implementation details
//!
//! For the most part, comments specific to the implementation are in the
//! code. This file only contains a very high-level overview. Basically,
//! the forest is stored in a vector. Each element of the vector is a node
//! in some tree. Each node in the vector has the index of its dependents,
//! including the first dependent which is known as the parent. It also
//! has a current state, described by `NodeState`. After each processing
//! step, we compress the vector to remove completed and error nodes, which
//! aren't needed anymore.
//
// Port of compiler/rustc_data_structures/src/obligation_forest/mod.rs (lane selcx-contract) and graphviz.rs (below).
//
// PORT (representation):
// - `O: ForestObligation` is the D4 descriptor `ForestObligation<O>` (its `Clone`, `Debug` and `as_cache_key`), stored
//   in the forest (`ObligationForest.new(d_O)`).
// - `O::CacheKey: Clone + Hash + Eq` is only ever used as a key of `done_cache` / `active_cache` / `error_cache`, never
//   read back. `as_cache_key` therefore returns its canonical key (`string | number`, equal exactly when the Rust cache
//   keys are `==`), and the caches are plain `Map` / `Set`s of it (no iteration of them reaches any output).
// - `P: ObligationProcessor` is the interface `ObligationProcessor<O, E, OUT>`; the associated type `OUT`'s
//   `OutcomeTrait::new` is the processor's `OUT_new()`. The provided `skippable_obligations` is
//   `ObligationProcessor_provided.skippable_obligations`. `process_obligation(&mut O)` mutates the obligation object in
//   place (it is an object for every non-test `O`).
// - `Cell<NodeState>` is the field itself; `ObligationTreeId(usize)` is a `number`; the opaque
//   `ObligationTreeIdGenerator` (`(0..).map(ObligationTreeId)`) is the counter `ObligationTreeIdGenerator`.
// - `Result<(), ()>` is `Result<null, null>`.

import { path_join } from "../../std/path.ts";
import type { Debug, Fmt } from "../../std/fmt.ts";
import { debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { assert, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";

// rustc-trait: compiler/rustc_data_structures/src/obligation_forest/mod.rs:88 ForestObligation
export interface ForestObligation<O> {
  /** `Clone` */
  clone(o: O): O;
  /** `Debug` */
  debug: Debug<O>;
  /// Converts this `ForestObligation` suitable for use as a cache key.
  /// If two distinct `ForestObligations`s return the same cache key,
  /// then it must be sound to use the result of processing one obligation
  /// (e.g. success for error) for the other obligation
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:95 as_cache_key
  as_cache_key(o: O): string | number;
}

// rustc-trait: compiler/rustc_data_structures/src/obligation_forest/mod.rs:98 ObligationProcessor
export interface ObligationProcessor<O, E, OUT extends OutcomeTrait<O, Error<O, E>>> {
  /** PORT: `<Self::OUT as OutcomeTrait>::new()` (the associated type `OUT`). */
  OUT_new(): OUT;

  /// Implementations can provide a fast-path to obligation-processing
  /// by counting the prefix of the passed iterator for which
  /// `needs_process_obligation` would return false.
  // (provided) mod.rs:106 skippable_obligations -> ObligationProcessor_provided.skippable_obligations
  skippable_obligations(it: Iterable<O>): number;

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:113 needs_process_obligation
  needs_process_obligation(obligation: O): boolean;

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:115 process_obligation
  process_obligation(obligation: O): ProcessResult<O, E>;

  /// As we do the cycle check, we invoke this callback when we
  /// encounter an actual cycle. `cycle` is an iterator that starts
  /// at the start of the cycle in the stack and walks **toward the
  /// top**.
  ///
  /// In other words, if we had O1 which required O2 which required
  /// O3 which required O1, we would give an iterator yielding O1,
  /// O2, O3 (O1 is not yielded twice).
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:128 process_backedge
  process_backedge(cycle: Iterable<O>): Result<null, E>;
}

/** The provided methods of `ObligationProcessor`. */
export const ObligationProcessor_provided = {
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:106 skippable_obligations
  skippable_obligations<O>(_it: Iterable<O>): number {
    return 0;
  },
};

/// The result type used by `process_obligation`.
// `repr(C)` to inhibit the niche filling optimization. Otherwise, the `match` appearing
// in `process_obligations` is significantly slower, which can substantially affect
// benchmarks like `rustc-perf`'s inflate and keccak.
// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:143 ProcessResult
export type ProcessResult<O, E> = { readonly $: "Unchanged" } | { readonly $: "Changed"; readonly _0: O[] } | { readonly $: "Error"; readonly _0: E };
export const ProcessResult = {
  Unchanged: Object.freeze({ $: "Unchanged" }) as { readonly $: "Unchanged" },
} as const;

/** `#[derive(Debug)]` of `ProcessResult<O, E>`. */
export function debug_ProcessResult<O, E>(v: ProcessResult<O, E>, f: Fmt, d_O: Debug<O>, d_E: Debug<E>): string {
  switch (v.$) {
    case "Unchanged":
      return "Unchanged";
    case "Changed":
      return debug_tuple(f, "Changed", [debug_vec(v._0, f, d_O)]);
    case "Error":
      return debug_tuple(f, "Error", [d_E(v._0, f)]);
  }
}

// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:150 ObligationTreeId
type ObligationTreeId = number;

/** `#[derive(Debug)]` of `ObligationTreeId(usize)`. */
function debug_ObligationTreeId(v: ObligationTreeId, f: Fmt): string {
  return debug_tuple(f, "ObligationTreeId", [String(v)]);
}

/** PORT: the opaque `ObligationTreeIdGenerator = impl Iterator<Item = ObligationTreeId>` (`(0..).map(ObligationTreeId)`). */
class ObligationTreeIdGenerator {
  constructor(private next_: number) {}
  next(): ObligationTreeId {
    return this.next_++;
  }
}

// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:152 ObligationForest
export class ObligationForest<O> {
  constructor(
    /** PORT: the `O: ForestObligation` descriptor. */
    readonly d_O: ForestObligation<O>,
    /// The list of obligations. In between calls to [Self::process_obligations],
    /// this list only contains nodes in the `Pending` or `Waiting` state.
    ///
    /// `usize` indices are used here and throughout this module, rather than
    /// [`rustc_index::newtype_index!`] indices, because this code is hot enough
    /// that the `u32`-to-`usize` conversions that would be required are
    /// significant, and space considerations are not important.
    public nodes: Node<O>[],

    /// A cache of predicates that have been successfully completed.
    public done_cache: Set<string | number>,

    /// A cache of the nodes in `nodes`, indexed by predicate. Unfortunately,
    /// its contents are not guaranteed to match those of `nodes`. See the
    /// comments in `Self::process_obligation` for details.
    public active_cache: Map<string | number, number>,

    /// A vector reused in [Self::compress()] and [Self::find_cycles_from_node()],
    /// to avoid allocating new vectors.
    public reused_node_vec: number[],

    public obligation_tree_id_generator: ObligationTreeIdGenerator,

    /// Per tree error cache. This is used to deduplicate errors,
    /// which is necessary to avoid trait resolution overflow in
    /// some cases.
    ///
    /// See [this][details] for details.
    ///
    /// [details]: https://github.com/rust-lang/rust/pull/53255#issuecomment-421184780
    public error_cache: Map<ObligationTreeId, Set<string | number>>,
  ) {}

  // ---- mod helper ----

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:319 new
  static new<O>(d_O: ForestObligation<O>): ObligationForest<O> {
    return new ObligationForest<O>(d_O, [], new Set(), new Map(), [], new ObligationTreeIdGenerator(0), new Map());
  }

  // ---- impl<O: ForestObligation> ObligationForest<O> ----

  /// Returns the total number of nodes in the forest that have not
  /// yet been fully resolved.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:336 len
  len(): number {
    return this.nodes.length;
  }

  /// Registers an obligation.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:341 register_obligation
  register_obligation(obligation: O): void {
    // Ignore errors here - there is no guarantee of success.
    this.register_obligation_at(obligation, undefined);
  }

  // Returns Err(()) if we already know this obligation failed.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:347 register_obligation_at
  register_obligation_at(obligation: O, parent: number | undefined): Result<null, null> {
    const cache_key = this.d_O.as_cache_key(obligation);
    if (this.done_cache.has(cache_key)) {
      // debug!("register_obligation_at: ignoring already done obligation: {:?}", obligation);
      return Ok(null);
    }

    const o = this.active_cache.get(cache_key);
    if (o !== undefined) {
      // Entry::Occupied(o)
      const node = this.nodes[o]!;
      if (parent !== undefined) {
        const parent_index = parent;
        // If the node is already in `active_cache`, it has already
        // had its chance to be marked with a parent. So if it's
        // not already present, just dump `parent` into the
        // dependents as a non-parent.
        if (!node.dependents.includes(parent_index)) {
          node.dependents.push(parent_index);
        }
      }
      if (node.state === NodeState.Error) {
        return Err(null);
      } else {
        return Ok(null);
      }
    } else {
      // Entry::Vacant(v)
      const obligation_tree_id = parent !== undefined ? this.nodes[parent]!.obligation_tree_id : this.obligation_tree_id_generator.next();

      const already_failed = parent !== undefined && (this.error_cache.get(obligation_tree_id)?.has(cache_key) ?? false);

      if (already_failed) {
        return Err(null);
      } else {
        const new_index = this.nodes.length;
        this.active_cache.set(cache_key, new_index);
        this.nodes.push(Node.new(parent, obligation, obligation_tree_id));
        return Ok(null);
      }
    }
  }

  /// Converts all remaining obligations to the given error.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:393 to_errors
  to_errors<E>(error: E, clone_E: (e: E) => E = (e) => e): Error<O, E>[] {
    const errors: Error<O, E>[] = [];
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index]!;
      if (node.state === NodeState.Pending) {
        errors.push({ error: clone_E(error), backtrace: this.error_at(index) });
      }
    }

    this.compress((_) => assert(false, "assertion failed: false"));
    return errors;
  }

  /// Returns the set of obligations that are in a pending state.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:407 map_pending_obligations
  map_pending_obligations<P>(f: (o: O) => P): P[] {
    const out: P[] = [];
    for (const node of this.nodes) {
      if (node.state === NodeState.Pending) out.push(f(node.obligation));
    }
    return out;
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:419 has_pending_obligations
  has_pending_obligations(): boolean {
    return this.nodes.some((node) => node.state === NodeState.Pending);
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:423 insert_into_error_cache
  insert_into_error_cache(index: number): void {
    const node = this.nodes[index]!;
    let set = this.error_cache.get(node.obligation_tree_id);
    if (set === undefined) {
      set = new Set();
      this.error_cache.set(node.obligation_tree_id, set);
    }
    set.add(this.d_O.as_cache_key(node.obligation));
  }

  /// Performs a fixpoint computation over the obligation list.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:433 process_obligations
  process_obligations<E, OUT extends OutcomeTrait<O, Error<O, E>>>(processor: ObligationProcessor<O, E, OUT>): OUT {
    const outcome = processor.OUT_new();

    // Fixpoint computation: we repeat until the inner loop stalls.
    for (;;) {
      let has_changed = false;

      // This is the super fast path for cheap-to-check conditions.
      let index = processor.skippable_obligations(this.nodes.map((n) => n.obligation));

      // Note that the loop body can append new nodes, and those new nodes
      // will then be processed by subsequent iterations of the loop.
      //
      // We can't use an iterator for the loop because `self.nodes` is
      // appended to and the borrow checker would complain. We also can't use
      // `for index in 0..self.nodes.len() { ... }` because the range would
      // be computed with the initial length, and we would miss the appended
      // nodes. Therefore we use a `while` loop.
      while (index < this.nodes.length) {
        const node = this.nodes[index]!;
        // This is the moderately fast path when the prefix skipping above didn't work out.
        if (node.state !== NodeState.Pending || !processor.needs_process_obligation(node.obligation)) {
          index += 1;
          continue;
        }

        // `processor.process_obligation` can modify the predicate within
        // `node.obligation`, and that predicate is the key used for
        // `self.active_cache`. This means that `self.active_cache` can get
        // out of sync with `nodes`. It's not very common, but it does
        // happen, and code in `compress` has to allow for it.

        // This code is much less hot.
        const r = processor.process_obligation(node.obligation);
        switch (r.$) {
          case "Unchanged":
            // No change in state.
            break;
          case "Changed": {
            const children = r._0;
            // We are not (yet) stalled.
            has_changed = true;
            node.state = NodeState.Success;

            for (const child of children) {
              const st = this.register_obligation_at(child, index);
              if (st.$ === "Err") {
                // Error already reported - propagate it
                // to our node.
                this.error_at(index);
              }
            }
            break;
          }
          case "Error": {
            const err = r._0;
            has_changed = true;
            outcome.record_error({ error: err, backtrace: this.error_at(index) });
            break;
          }
        }
        index += 1;
      }

      // If unchanged, then we saw no successful obligations, which means
      // there is no point in further iteration. This is based on the
      // assumption that when trait matching returns `Error` or
      // `Unchanged`, those results do not affect environmental inference
      // state. (Note that this will occur if we invoke
      // `process_obligations` with no pending obligations.)
      if (!has_changed) {
        break;
      }

      this.mark_successes();
      this.process_cycles(processor, outcome);
      this.compress((obl) => outcome.record_completed(obl));
    }

    return outcome;
  }

  /// Returns a vector of obligations for `p` and all of its
  /// ancestors, putting them into the error state in the process.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:517 error_at
  error_at(index: number): O[] {
    const error_stack: number[] = [];
    const trace: O[] = [];

    for (;;) {
      const node = this.nodes[index]!;
      node.state = NodeState.Error;
      trace.push(this.d_O.clone(node.obligation));
      if (node.has_parent) {
        // The first dependent is the parent, which is treated
        // specially.
        error_stack.push(...node.dependents.slice(1));
        index = node.dependents[0]!;
      } else {
        // No parent; treat all dependents non-specially.
        error_stack.push(...node.dependents);
        break;
      }
    }

    for (let index = error_stack.pop(); index !== undefined; index = error_stack.pop()) {
      const node = this.nodes[index]!;
      if (node.state !== NodeState.Error) {
        node.state = NodeState.Error;
        error_stack.push(...node.dependents);
      }
    }

    return trace;
  }

  /// Mark all `Waiting` nodes as `Success`, except those that depend on a
  /// pending node.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:550 mark_successes
  mark_successes(): void {
    // Convert all `Waiting` nodes to `Success`.
    for (const node of this.nodes) {
      if (node.state === NodeState.Waiting) {
        node.state = NodeState.Success;
      }
    }

    // Convert `Success` nodes that depend on a pending node back to
    // `Waiting`.
    for (const node of this.nodes) {
      if (node.state === NodeState.Pending) {
        // This call site is hot.
        this.inlined_mark_dependents_as_waiting(node);
      }
    }
  }

  // This always-inlined function is for the hot call site.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:570 inlined_mark_dependents_as_waiting
  inlined_mark_dependents_as_waiting(node: Node<O>): void {
    for (const index of node.dependents) {
      const node = this.nodes[index]!;
      const state = node.state;
      if (state === NodeState.Success) {
        // This call site is cold.
        this.uninlined_mark_dependents_as_waiting(node);
      } else {
        // debug_assert!(state == NodeState::Waiting || state == NodeState::Error)
      }
    }
  }

  // This never-inlined function is for the cold call site.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:585 uninlined_mark_dependents_as_waiting
  uninlined_mark_dependents_as_waiting(node: Node<O>): void {
    // Mark node Waiting in the cold uninlined code instead of the hot inlined
    node.state = NodeState.Waiting;
    this.inlined_mark_dependents_as_waiting(node);
  }

  /// Report cycles between all `Success` nodes, and convert all `Success`
  /// nodes to `Done`. This must be called after `mark_successes`.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:593 process_cycles
  process_cycles<E, OUT extends OutcomeTrait<O, Error<O, E>>>(processor: ObligationProcessor<O, E, OUT>, outcome: OUT): void {
    const stack = this.reused_node_vec;
    this.reused_node_vec = [];
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index]!;
      // For some benchmarks this state test is extremely hot. It's a win
      // to handle the no-op cases immediately to avoid the cost of the
      // function call.
      if (node.state === NodeState.Success) {
        this.find_cycles_from_node(stack, processor, index, outcome);
      }
    }

    // debug_assert!(stack.is_empty());
    this.reused_node_vec = stack;
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:611 find_cycles_from_node
  find_cycles_from_node<E, OUT extends OutcomeTrait<O, Error<O, E>>>(
    stack: number[],
    processor: ObligationProcessor<O, E, OUT>,
    index: number,
    outcome: OUT,
  ): void {
    const node = this.nodes[index]!;
    if (node.state === NodeState.Success) {
      const rpos = stack.lastIndexOf(index);
      if (rpos === -1) {
        stack.push(index);
        for (const dep_index of node.dependents) {
          this.find_cycles_from_node(stack, processor, dep_index, outcome);
        }
        stack.pop();
        node.state = NodeState.Done;
      } else {
        // Cycle detected.
        const result = processor.process_backedge(stack.slice(rpos).map((i) => this.nodes[i]!.obligation));
        if (result.$ === "Err") {
          const err = result._0;
          outcome.record_error({ error: err, backtrace: this.error_at(index) });
        }
      }
    }
  }

  /// Compresses the vector, removing all popped nodes. This adjusts the
  /// indices and hence invalidates any outstanding indices. `process_cycles`
  /// must be run beforehand to remove any cycles on `Success` nodes.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:649 compress
  compress(outcome_cb: (o: O) => void): void {
    const orig_nodes_len = this.nodes.length;
    const node_rewrites: number[] = this.reused_node_vec;
    this.reused_node_vec = [];
    // debug_assert!(node_rewrites.is_empty());
    for (let i = 0; i < orig_nodes_len; i++) node_rewrites.push(i);
    let dead_nodes = 0;

    // Move removable nodes to the end, preserving the order of the
    // remaining nodes.
    //
    // LOOP INVARIANT:
    //     self.nodes[0..index - dead_nodes] are the first remaining nodes
    //     self.nodes[index - dead_nodes..index] are all dead
    //     self.nodes[index..] are unchanged
    for (let index = 0; index < orig_nodes_len; index++) {
      const node = this.nodes[index]!;
      switch (node.state) {
        case NodeState.Pending:
        case NodeState.Waiting:
          if (dead_nodes > 0) {
            const other = index - dead_nodes;
            this.nodes[index] = this.nodes[other]!;
            this.nodes[other] = node;
            node_rewrites[index]! -= dead_nodes;
          }
          break;
        case NodeState.Done: {
          // The removal lookup might fail because the contents of
          // `self.active_cache` are not guaranteed to match those of
          // `self.nodes`. See the comment in `process_obligation`
          // for more details.
          const cache_key = this.d_O.as_cache_key(node.obligation);
          this.active_cache.delete(cache_key);
          this.done_cache.add(cache_key);

          // Extract the success stories.
          outcome_cb(node.obligation);
          node_rewrites[index] = orig_nodes_len;
          dead_nodes += 1;
          break;
        }
        case NodeState.Error:
          // We *intentionally* remove the node from the cache at this point. Otherwise
          // tests must come up with a different type on every type error they
          // check against.
          this.active_cache.delete(this.d_O.as_cache_key(node.obligation));
          this.insert_into_error_cache(index);
          node_rewrites[index] = orig_nodes_len;
          dead_nodes += 1;
          break;
        case NodeState.Success:
          unreachable();
      }
    }

    if (dead_nodes > 0) {
      // Remove the dead nodes and rewrite indices.
      this.nodes.length = orig_nodes_len - dead_nodes;
      this.apply_rewrites(node_rewrites);
    }

    node_rewrites.length = 0;
    this.reused_node_vec = node_rewrites;
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:710 apply_rewrites
  apply_rewrites(node_rewrites: readonly number[]): void {
    const orig_nodes_len = node_rewrites.length;

    for (const node of this.nodes) {
      let i = 0;
      while (i < node.dependents.length) {
        const dependent = node.dependents[i]!;
        const new_index = node_rewrites[dependent]!;
        if (new_index >= orig_nodes_len) {
          // `swap_remove(i)`
          const last = node.dependents.pop()!;
          if (i < node.dependents.length) node.dependents[i] = last;
          if (i === 0 && node.has_parent) {
            // We just removed the parent.
            node.has_parent = false;
          }
        } else {
          node.dependents[i] = new_index;
          i += 1;
        }
      }
    }

    // This updating of `self.active_cache` is necessary because the
    // removal of nodes within `compress` can fail. See above.
    for (const [predicate, index] of [...this.active_cache]) {
      const new_index = node_rewrites[index]!;
      if (new_index >= orig_nodes_len) {
        this.active_cache.delete(predicate);
      } else {
        this.active_cache.set(predicate, new_index);
      }
    }
  }

  // ---- graphviz.rs: impl<O: ForestObligation> ObligationForest<O> ----

  /// Creates a graphviz representation of the obligation forest. Given a directory this will
  /// create files with name of the format `<counter>_<description>.gv`. The counter is
  /// global and is maintained internally.
  ///
  /// Calling this will do nothing unless the environment variable
  /// `DUMP_OBLIGATION_FOREST_GRAPHVIZ` is defined.
  ///
  /// A few post-processing that you might want to do make the forest easier to visualize:
  ///
  ///  * `sed 's,std::[a-z]*::,,g'` — Deletes the `std::<package>::` prefix of paths.
  ///  * `sed 's,"Binder(TraitClause(<\(.*\)>)) (\([^)]*\))","\1 (\2)",'` — Transforms
  ///    `Binder(TraitClause(<predicate>))` into just `<predicate>`.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:24 dump_graphviz
  dump_graphviz(dir: string, description: string): void {
    if (process.env["DUMP_OBLIGATION_FOREST_GRAPHVIZ"] === undefined) {
      return;
    }

    const counter = DUMP_GRAPHVIZ_COUNTER++;

    const file_path = path_join(dir, `${String(counter).padStart(10, "0")}_${description}.gv`);

    void file_path;
    // PORT: `dot::render(&self, &mut gv_file)`: rustc_graphviz is not ported.
    unported("rustc_graphviz::render (obligation_forest::dump_graphviz)");
  }
}

/** `static COUNTER: AtomicUsize` of `dump_graphviz`. */
let DUMP_GRAPHVIZ_COUNTER = 0;

// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:187 Node
export class Node<O> {
  constructor(
    public obligation: O,
    public state: NodeState,

    /// Obligations that depend on this obligation for their completion. They
    /// must all be in a non-pending state.
    public dependents: number[],

    /// If true, `dependents[0]` points to a "parent" node, which requires
    /// special treatment upon error but is otherwise treated the same.
    /// (It would be more idiomatic to store the parent node in a separate
    /// `Option<usize>` field, but that slows down the common case of
    /// iterating over the parent and other descendants together.)
    public has_parent: boolean,

    /// Identifier of the obligation tree to which this node belongs.
    public obligation_tree_id: ObligationTreeId,
  ) {}

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:207 new
  static new<O>(parent: number | undefined, obligation: O, obligation_tree_id: ObligationTreeId): Node<O> {
    return new Node(obligation, NodeState.Pending, parent !== undefined ? [parent] : [], parent !== undefined, obligation_tree_id);
  }
}

/** `#[derive(Debug)]` of `Node<O>`. */
export function debug_Node<O>(v: Node<O>, f: Fmt, d_O: Debug<O>): string {
  return debug_struct(f, "Node", [
    ["obligation", d_O(v.obligation, f)],
    ["state", debug_struct(f, "Cell", [["value", debug_NodeState(v.state, f)]])],
    ["dependents", debug_vec(v.dependents, f, (x) => String(x))],
    ["has_parent", String(v.has_parent)],
    ["obligation_tree_id", debug_ObligationTreeId(v.obligation_tree_id, f)],
  ]);
}

/// The state of one node in some tree within the forest. This represents the
/// current state of processing for the obligation (of type `O`) associated
/// with this node.
///
/// The non-`Error` state transitions are as follows.
/// ```text
/// (Pre-creation)
///  |
///  |     register_obligation_at() (called by process_obligations() and
///  v                               from outside the crate)
/// Pending
///  |
///  |     process_obligations()
///  v
/// Success
///  |  ^
///  |  |  mark_successes()
///  |  v
///  |  Waiting
///  |
///  |     process_cycles()
///  v
/// Done
///  |
///  |     compress()
///  v
/// (Removed)
/// ```
/// The `Error` state can be introduced in several places, via `error_at()`.
///
/// Outside of `ObligationForest` methods, nodes should be either `Pending` or
/// `Waiting`.
// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:251 NodeState
export type NodeState =
  /// This obligation has not yet been selected successfully. Cannot have
  /// subobligations.
  | "Pending"
  /// This obligation was selected successfully, but may or may not have
  /// subobligations.
  | "Success"
  /// This obligation was selected successfully, but it has a pending
  /// subobligation.
  | "Waiting"
  /// This obligation, along with its subobligations, are complete, and will
  /// be removed in the next collection.
  | "Done"
  /// This obligation was resolved to an error. It will be removed by the
  /// next compression step.
  | "Error";
export const NodeState = { Pending: "Pending", Success: "Success", Waiting: "Waiting", Done: "Done", Error: "Error" } as const;

/** `#[derive(Debug)]` of `NodeState`. */
export const debug_NodeState: Debug<NodeState> = (v) => v;

/// This trait allows us to have two different Outcome types:
///  - the normal one that does as little as possible
///  - one for tests that does some additional work and checking
// rustc-trait: compiler/rustc_data_structures/src/obligation_forest/mod.rs:276 OutcomeTrait
export interface OutcomeTrait<O, Err> {
  // PORT: the associated fn `new() -> Self` has no instance to live on: it is `ObligationProcessor::OUT_new()`.
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:280 new
  // (see `ObligationProcessor.OUT_new`)
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:281 record_completed
  record_completed(outcome: O): void;
  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:282 record_error
  record_error(error: Err): void;
}

// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:286 Outcome
export class Outcome<O, E> implements OutcomeTrait<O, Error<O, E>> {
  constructor(
    /// Backtrace of obligations that were found to be in error.
    public errors: Error<O, E>[],
  ) {}

  // ---- impl<O, E> OutcomeTrait for Outcome<O, E> ----

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:295 new
  static new<O, E>(): Outcome<O, E> {
    return new Outcome<O, E>([]);
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:299 record_completed
  record_completed(_outcome: O): void {
    // do nothing
  }

  // rustc: compiler/rustc_data_structures/src/obligation_forest/mod.rs:303 record_error
  record_error(error: Error<O, E>): void {
    this.errors.push(error);
  }
}

// rustc-type: compiler/rustc_data_structures/src/obligation_forest/mod.rs:309 Error
export interface Error<O, E> {
  error: E;
  backtrace: O[];
}

/** `#[derive(Debug)]` of `Error<O, E>`. */
export function debug_Error<O, E>(v: Error<O, E>, f: Fmt, d_O: Debug<O>, d_E: Debug<E>): string {
  return debug_struct(f, "Error", [
    ["error", d_E(v.error, f)],
    ["backtrace", debug_vec(v.backtrace, f, d_O)],
  ]);
}

// ---- graphviz.rs: `impl dot::Labeller for &ObligationForest<O>` / `impl dot::GraphWalk for &ObligationForest<O>` ----
// PORT: rustc_graphviz is not ported. `dot::Id<'_>` is its validated name (a string; `Id::new` stops as UNPORTED),
// `dot::LabelText` is `{ $: "LabelStr", _0: string }`, `dot::Nodes` / `dot::Edges` are arrays. Nothing calls these
// unless `DUMP_OBLIGATION_FOREST_GRAPHVIZ` is set (and `dump_graphviz` itself stops at `dot::render`).

/** `dot::LabelText::LabelStr` (rustc_graphviz, not ported). */
export interface LabelStr {
  readonly $: "LabelStr";
  readonly _0: string;
}

/** `dot::Id::new(name).unwrap()` (rustc_graphviz, not ported). */
function dot_Id_new(_name: string): string {
  return unported("rustc_graphviz::Id::new");
}

export const Labeller_ObligationForest = {
  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:45 graph_id
  graph_id<O>(_self: ObligationForest<O>): string {
    return dot_Id_new("trait_obligation_forest");
  },

  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:49 node_id
  node_id<O>(_self: ObligationForest<O>, index: number): string {
    return dot_Id_new(`obligation_${index}`);
  },

  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:53 node_label
  node_label<O>(self: ObligationForest<O>, index: number, f: Fmt): LabelStr {
    const node = self.nodes[index]!;
    const label = `${self.d_O.debug(node.obligation, f)} (${debug_NodeState(node.state, f)})`;

    return { $: "LabelStr", _0: label };
  },

  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:60 edge_label
  edge_label<O>(_self: ObligationForest<O>, _edge: [number, number]): LabelStr {
    return { $: "LabelStr", _0: "" };
  },
};

export const GraphWalk_ObligationForest = {
  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:69 nodes
  nodes<O>(self: ObligationForest<O>): number[] {
    return Array.from({ length: self.nodes.length }, (_, i) => i);
  },

  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:73 edges
  edges<O>(self: ObligationForest<O>): [number, number][] {
    const out: [number, number][] = [];
    for (let index = 0; index < self.nodes.length; index++) {
      const node = self.nodes[index]!;
      for (const dependent of node.dependents) out.push([index, dependent]);
    }
    return out;
  },

  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:83 source
  source([s, _]: [number, number]): number {
    return s;
  },

  // rustc: compiler/rustc_data_structures/src/obligation_forest/graphviz.rs:87 target
  target([_, t]: [number, number]): number {
    return t;
  },
};
