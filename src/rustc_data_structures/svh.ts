//! Calculation and management of a Strict Version Hash for crates
//!
//! The SVH is used for incremental compilation to track when HIR
//! nodes have changed between compilations, and also to detect
//! mismatches where we have two versions of the same crate that were
//! compiled from distinct sources.
import { type Debug, debug_struct } from "../std/fmt.ts";
import { debug_Fingerprint, decode_Fingerprint, Fingerprint, type RawBytesDecoder } from "./fingerprint.ts";
import type { StableHashCtxt, StableHasher } from "./stable_hash.ts";
import { stable_hash_Fingerprint } from "./stable_hash.ts";

/**
 * `#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)] #[derive(Encodable_NoContext, Decodable_NoContext, StableHash)]
 * pub struct Svh { hash: Fingerprint }`.
 * PORT: an `Svh` is its `to_hex()` text (`format!("{:032x}", self.hash.as_u128())`), a primitive, so `===` is the
 * derived `PartialEq` and it keys a `Map` by value (creader's `hash_to_cnum`); the text is a bijection of the hash
 * (`as_fingerprint` recovers it).
 */
export type Svh = string & { readonly __brand: "Svh" };

export const Svh = {
  /// Creates a new `Svh` given the hash. If you actually want to
  /// compute the SVH from some HIR, you want the `calculate_svh`
  /// function found in `rustc_incremental`.
  // rustc: compiler/rustc_data_structures/src/svh.rs:24 new
  new(hash: Fingerprint): Svh {
    return Fingerprint.as_u128(hash).toString(16).padStart(32, "0") as Svh;
  },

  // rustc: compiler/rustc_data_structures/src/svh.rs:28 as_u128
  as_u128(self: Svh): bigint {
    return Fingerprint.as_u128(Svh.as_fingerprint(self));
  },

  // rustc: compiler/rustc_data_structures/src/svh.rs:32 to_hex
  to_hex(self: Svh): string {
    // `format!("{:032x}", self.hash.as_u128())`: the representation itself.
    return self;
  },

  // rustc: compiler/rustc_data_structures/src/svh.rs:36 as_fingerprint
  as_fingerprint(self: Svh): Fingerprint {
    // The inverse of `new`: `as_u128` is `u128::from(self.1) << 64 | u128::from(self.0)`.
    const v = BigInt(`0x${self}`);
    return Fingerprint.new(v & 0xffff_ffff_ffff_ffffn, v >> 64n);
  },
} as const;

// rustc: compiler/rustc_data_structures/src/svh.rs:42 fmt
/** `impl fmt::Display for Svh`: `f.pad(&self.to_hex())`. PORT: `Fmt` carries no width / fill, so `pad` writes the
 * text as is. */
export const display_Svh = (self: Svh): string => Svh.to_hex(self);

/** `#[derive(Debug)]` */
export const debug_Svh: Debug<Svh> = (v, f) => debug_struct(f, "Svh", [["hash", debug_Fingerprint(Svh.as_fingerprint(v), f)]]);

/** `#[derive(Decodable_NoContext)]`: the one field, `hash: Fingerprint`. */
export function decode_Svh(d: RawBytesDecoder): Svh {
  return Svh.new(decode_Fingerprint(d));
}

/** `#[derive(StableHash)]`: the one field, `hash: Fingerprint`. */
export function stable_hash_Svh(self: Svh, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Fingerprint(Svh.as_fingerprint(self), hcx, hasher);
}
