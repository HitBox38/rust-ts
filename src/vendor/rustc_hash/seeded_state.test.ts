// Port of the `#[cfg(test)] mod tests` of rustc-hash =2.1.1 `src/seeded_state.rs`.
import { expect, test } from "bun:test";
import { FxSeededState } from "./lib.ts";

// crate: rustc-hash-2.1.1/src/seeded_state.rs:48 cloned_seeded_states_are_equal
test("cloned_seeded_states_are_equal", () => {
  const seed = 2n;
  const a = FxSeededState.with_seed(seed);
  const b = a.clone();

  expect(a.seed).toBe(b.seed);
  expect(a.seed).toBe(seed);

  expect(a.build_hasher().hash).toBe(b.build_hasher().hash);
});

// crate: rustc-hash-2.1.1/src/seeded_state.rs:60 same_seed_produces_same_hasher
test("same_seed_produces_same_hasher", () => {
  const seed = 1n;
  const a = FxSeededState.with_seed(seed);
  const b = FxSeededState.with_seed(seed);

  // The hashers should be the same, as they have the same seed.
  expect(a.build_hasher().hash).toBe(b.build_hasher().hash);
});

// crate: rustc-hash-2.1.1/src/seeded_state.rs:69 different_states_are_different
test("different_states_are_different", () => {
  const a = FxSeededState.with_seed(1n);
  const b = FxSeededState.with_seed(2n);

  expect(a.build_hasher().hash).not.toBe(b.build_hasher().hash);
});
