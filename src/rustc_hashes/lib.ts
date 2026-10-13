//! rustc encodes a lot of hashes. If hashes are stored as `u64` or `u128`, a `derive(Encodable)`
//! will apply varint encoding to the hashes, which is less efficient than directly encoding the 8
//! or 16 bytes of the hash. And if that hash depends on the `StableCrateHash` (which most in rustc
//! do), the varint encoding will make the number of bytes encoded fluctuate between compiler
//! versions.
//!
//! The types in this module represent 64-bit or 128-bit hashes produced by a `StableHasher`.
//! `Hash64` and `Hash128` expose some utility functions to encourage users to not extract the inner
//! hash value as an integer type and accidentally apply varint encoding to it.
//!
//! In contrast with `Fingerprint`, users of these types cannot and should not attempt to construct
//! and decompose these types into constituent pieces. The point of these types is only to
//! connect the fact that they can only be produced by a `StableHasher` to their
//! `Encode`/`Decode` impls.
//
// PORT: `Hash64 { inner: u64 }` / `Hash128 { inner: u128 }` are branded bigints (the inner value), so
// they compare with `===` and can key a `Map`; methods live on the companion consts.
// `FromStableHash` is the companion's `from` (`hasher.finish(Hash64)`).

import type { Debug, Fmt } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Hasher, SipHasher128Hash as StableHasherHash } from "../vendor/rustc_stable_hash/lib.ts";

const U64 = (1n << 64n) - 1n;
const U128 = (1n << 128n) - 1n;

/// A `u64` but encoded with a fixed size; for hashes this encoding is more compact than `u64`.
// `#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]`
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

  // rustc: compiler/rustc_hashes/src/lib.rs:41 wrapping_add
  wrapping_add(self: Hash64, other: Hash64): Hash64 {
    return ((self + other) & U64) as Hash64;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:48 bitxor_assign
  /** `impl BitXorAssign<u64> for Hash64` */
  bitxor_assign(self: MutRef<Hash64>, rhs: bigint): void {
    self.value = (self.value ^ rhs) as Hash64;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:57 from
  /** `impl FromStableHash for Hash64`: the first half of the hash. */
  from(hash: StableHasherHash): Hash64 {
    const [_0] = hash._0;
    return _0 as Hash64;
  },

  /** `#[derive(Hash)]`: hashes `inner: u64`. */
  hash(self: Hash64, state: Hasher): void {
    state.write_u64(self);
  },

  /** `#[derive(Default)]` */
  default(): Hash64 {
    return 0n as Hash64;
  },
};

// rustc: compiler/rustc_hashes/src/lib.rs:63 fmt
/** `impl fmt::Debug for Hash64`: the inner `u64`. */
export const debug_Hash64: Debug<Hash64> = (v) => String(v);

// PORT: `Fmt` models only `#` (alternate → `0x` prefix), not width/fill.
// rustc: compiler/rustc_hashes/src/lib.rs:69 fmt
/** `impl fmt::LowerHex for Hash64` */
export const lower_hex_Hash64 = (v: Hash64, f: Fmt): string => (f.alternate ? "0x" : "") + v.toString(16);

/// A `u128` but encoded with a fixed size; for hashes this encoding is more compact than `u128`.
// `#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]`
export type Hash128 = bigint & { readonly __brand: "Hash128" };
export const Hash128 = {
  // We expect Hash128 to be well mixed. So there's no point in hashing both parts.
  //
  // This also allows using Hash128-containing types in UnHash-based hashmaps, which would otherwise
  // debug_assert! that we're hashing more than a single u64.
  // rustc: compiler/rustc_hashes/src/lib.rs:85 hash
  /** `impl std::hash::Hash for Hash128` */
  hash(self: Hash128, h: Hasher): void {
    h.write_u64(Hash64.as_u64(Hash128.truncate(self)));
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:92 new
  new(n: bigint): Hash128 {
    return n as Hash128;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:97 truncate
  truncate(self: Hash128): Hash64 {
    return (self & U64) as Hash64;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:102 wrapping_add
  wrapping_add(self: Hash128, other: Hash128): Hash128 {
    return ((self + other) & U128) as Hash128;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:107 as_u128
  as_u128(self: Hash128): bigint {
    return self;
  },

  // rustc: compiler/rustc_hashes/src/lib.rs:116 from
  /** `impl FromStableHash for Hash128`: `_0 | (_1 << 64)`. */
  from(hash: StableHasherHash): Hash128 {
    const [_0, _1] = hash._0;
    return (_0 | (_1 << 64n)) as Hash128;
  },

  /** `#[derive(Default)]` */
  default(): Hash128 {
    return 0n as Hash128;
  },
};

// rustc: compiler/rustc_hashes/src/lib.rs:122 fmt
/** `impl fmt::Debug for Hash128`: the inner `u128`. */
export const debug_Hash128: Debug<Hash128> = (v) => String(v);

// PORT: `Fmt` models only `#` (alternate → `0x` prefix), not width/fill.
// rustc: compiler/rustc_hashes/src/lib.rs:128 fmt
/** `impl fmt::LowerHex for Hash128` */
export const lower_hex_Hash128 = (v: Hash128, f: Fmt): string => (f.alternate ? "0x" : "") + v.toString(16);
