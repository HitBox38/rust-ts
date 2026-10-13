// Port of rustc-hash =2.1.1 `src/seeded_state.rs`.
//
// PORT: `FxHashMapSeed` / `FxHashSetSeed` (std `HashMap`/`HashSet` with this state) are not used by
// rustc and have no TS alias.

import { type BuildHasher, FxHasher } from "./lib.ts";

/// [`FxSeededState`] is an alternative state for `HashMap` types, allowing to use [`FxHasher`] with a set seed.
///
/// ```
/// # use std::collections::HashMap;
/// use rustc_hash::FxSeededState;
///
/// let mut map = HashMap::with_hasher(FxSeededState::with_seed(12));
/// map.insert(15, 610);
/// assert_eq!(map[&15], 610);
/// ```
// PORT: `#[derive(Clone)]` is `clone()`; `seed: usize` is a `bigint` (FxHasher's state, see lib.ts).
export class FxSeededState implements BuildHasher<FxHasher> {
  constructor(public seed: bigint) {}

  clone(): FxSeededState {
    return new FxSeededState(this.seed);
  }

  /// Constructs a new `FxSeededState` that is initialized with a `seed`.
  // crate: rustc-hash-2.1.1/src/seeded_state.rs:28 with_seed
  static with_seed(seed: bigint): FxSeededState {
    return new FxSeededState(seed);
  }

  // crate: rustc-hash-2.1.1/src/seeded_state.rs:36 build_hasher
  build_hasher(): FxHasher {
    return FxHasher.with_seed(this.seed);
  }
}
