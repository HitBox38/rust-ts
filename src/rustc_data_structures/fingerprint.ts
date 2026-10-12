// Partial port of compiler/rustc_data_structures/src/fingerprint.rs: only what rustc_span uses.
// PORT: `Fingerprint(u64, u64)` is packed into one u128 bigint `(_0 << 64) | _1` so it can be
// compared with `===` and used as a `Map` key.
import { debug_tuple, type Debug } from "../std/fmt.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";

const U64_MASK = (1n << 64n) - 1n;

export type Fingerprint = bigint & { readonly __brand: "Fingerprint" };
export const Fingerprint = {
  ZERO: 0n as Fingerprint,

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:37 new
  /** PORT: `FingerprintComponent` is `Hash64` here (the only component type rustc_span passes). */
  new(_0: Hash64, _1: Hash64): Fingerprint {
    return ((Hash64.as_u64(_0) << 64n) | Hash64.as_u64(_1)) as Fingerprint;
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:56 split
  split(self: Fingerprint): [Hash64, Hash64] {
    return [Hash64.new(self >> 64n), Hash64.new(self & U64_MASK)];
  },
};

/** `#[derive(Debug)]` on `Fingerprint(u64, u64)`. */
export const debug_Fingerprint: Debug<Fingerprint> = (v, f) => {
  const [a, b] = Fingerprint.split(v);
  return debug_tuple(f, "Fingerprint", [String(a), String(b)]);
};
