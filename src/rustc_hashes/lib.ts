// Partial port of compiler/rustc_hashes/src/lib.rs: only what rustc_span uses so far.
// PORT: `Hash64 { inner: u64 }` / `Hash128 { inner: u128 }` are branded bigints, so they compare
// with `===` and can key a `Map`.
import type { Debug } from "../std/fmt.ts";

/// A `u64` but encoded with a fixed size; for hashes this encoding is more compact than `u64`.
export type Hash64 = bigint & { readonly __brand: "Hash64" };
export const Hash64 = {
  ZERO: 0n as Hash64,

  // rustc: compiler/rustc_hashes/src/lib.rs:31 new
  new(n: bigint): Hash64 {
    return n as Hash64;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:36 as_u64
  as_u64(self: Hash64): bigint {
    return self;
  },
};

// rustc: compiler/rustc_hashes/src/lib.rs:63 fmt
/** `impl fmt::Debug for Hash64`: the inner `u64`. */
export const debug_Hash64: Debug<Hash64> = (v) => String(v);

/// A `u128` but encoded with a fixed size; for hashes this encoding is more compact than `u128`.
export type Hash128 = bigint & { readonly __brand: "Hash128" };
