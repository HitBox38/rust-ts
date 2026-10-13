// Port of compiler/rustc_data_structures/src/fingerprint.rs.
// PORT: `Fingerprint(u64, u64)` is one u128 bigint `(_0 << 64) | _1`, so it compares with `===`, keys a
// `Map`, and its bigint order is the derived `Ord` (lexicographic on `(_0, _1)`). Methods live on
// the companion const. `PackedFingerprint` (`#[repr(packed)]`) is the same value, branded apart.
import { debug_tuple, type Debug } from "../std/fmt.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import type { Hasher, SipHasher128Hash as StableHasherHash } from "../vendor/rustc_stable_hash/lib.ts";

const U64_MASK = (1n << 64n) - 1n;
const U128_MASK = (1n << 128n) - 1n;

// `#[derive(Eq, PartialEq, Ord, PartialOrd, Debug, Clone, Copy)] #[repr(C)]`
export type Fingerprint = bigint & { readonly __brand: "Fingerprint" };

// PORT: `trait FingerprintComponent` is implemented by `Hash64` and `u64`, both `bigint` here; its
// `as_u64` is the identity on either.
export interface FingerprintComponent {
  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:16 as_u64
  as_u64(self: bigint): bigint;
}
export const FingerprintComponent = {
  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:21 as_u64
  /** `impl FingerprintComponent for Hash64` */
  as_u64_Hash64(self: Hash64): bigint {
    return Hash64.as_u64(self);
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:28 as_u64
  /** `impl FingerprintComponent for u64` */
  as_u64_u64(self: bigint): bigint {
    return self;
  },
};

/** The `_0` (high) and `_1` (low) fields. */
function f0(self: Fingerprint): bigint {
  return self >> 64n;
}
function f1(self: Fingerprint): bigint {
  return self & U64_MASK;
}
function mk(_0: bigint, _1: bigint): Fingerprint {
  return (((_0 & U64_MASK) << 64n) | (_1 & U64_MASK)) as Fingerprint;
}

export const Fingerprint = {
  ZERO: 0n as Fingerprint,

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:37 new
  /** PORT: `A, B: FingerprintComponent` are `Hash64` / `u64`, both `bigint`. */
  new(_0: Hash64 | bigint, _1: Hash64 | bigint): Fingerprint {
    return mk(_0, _1);
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:46 to_smaller_hash
  to_smaller_hash(self: Fingerprint): Hash64 {
    // Even though both halves of the fingerprint are expected to be good
    // quality hash values, let's still combine the two values because the
    // Fingerprints in DefPathHash have the StableCrateId portion which is
    // the same for all DefPathHashes from the same crate. Combining the
    // two halves makes sure we get a good quality hash in such cases too.
    return Hash64.new((f0(self) * 3n + f1(self)) & U64_MASK);
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:56 split
  split(self: Fingerprint): [Hash64, Hash64] {
    return [Hash64.new(f0(self)), Hash64.new(f1(self))];
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:61 combine
  combine(self: Fingerprint, other: Fingerprint): Fingerprint {
    // See https://stackoverflow.com/a/27952689 on why this function is
    // implemented this way.
    return mk(f0(self) * 3n + f0(other), f1(self) * 3n + f1(other));
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:71 as_u128
  as_u128(self: Fingerprint): bigint {
    return (f1(self) << 64n) | f0(self);
  },

  // Combines two hashes in an order independent way. Make sure this is what
  // you want.
  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:78 combine_commutative
  combine_commutative(self: Fingerprint, other: Fingerprint): Fingerprint {
    const a = (f1(self) << 64n) | f0(self);
    const b = (f1(other) << 64n) | f0(other);

    const c = (a + b) & U128_MASK;

    return mk(c & U64_MASK, c >> 64n);
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:87 to_hex
  to_hex(self: Fingerprint): string {
    return `${f0(self).toString(16)}${f1(self).toString(16)}`;
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:92 to_le_bytes
  to_le_bytes(self: Fingerprint): Uint8Array {
    // This seems to optimize to the same machine code as
    // `unsafe { mem::transmute(*k) }`. Well done, LLVM! :)
    const result = new Uint8Array(16);
    const view = new DataView(result.buffer);

    view.setBigUint64(0, f0(self), true);

    view.setBigUint64(8, f1(self), true);

    return result;
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:107 from_le_bytes
  from_le_bytes(bytes: Uint8Array): Fingerprint {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 16);
    return mk(view.getBigUint64(0, true), view.getBigUint64(8, true));
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:123 hash
  /**
   * `impl Hash for Fingerprint`: `state.write_fingerprint(self)`.
   * PORT: dispatches to the default `FingerprintHasher` impl; the `Unhasher` specialization
   * (`write_fingerprint_unhasher`) applies once `unhash.rs` is ported and passes its hasher there.
   */
  hash(self: Fingerprint, state: Hasher): void {
    FingerprintHasher.write_fingerprint(state, self);
  },

  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:163 from
  /** `impl FromStableHash for Fingerprint` */
  from(hash: StableHasherHash): Fingerprint {
    const [_0, _1] = hash._0;
    return mk(_0, _1);
  },
};

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:116 fmt
/** `impl std::fmt::Display for Fingerprint`: `{:x}-{:x}`. */
export const display_Fingerprint = (v: Fingerprint): string => `${f0(v).toString(16)}-${f1(v).toString(16)}`;

/** `#[derive(Debug)]` on `Fingerprint(u64, u64)`. */
export const debug_Fingerprint: Debug<Fingerprint> = (v, f) => {
  const [a, b] = Fingerprint.split(v);
  return debug_tuple(f, "Fingerprint", [String(a), String(b)]);
};

// `trait FingerprintHasher { fn write_fingerprint(&mut self, fingerprint: &Fingerprint); }`
const FingerprintHasher = {
  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:129 write_fingerprint
  // rustc: compiler/rustc_data_structures/src/fingerprint.rs:134 write_fingerprint
  /** `impl<H: Hasher> FingerprintHasher for H` (the `default fn`). */
  write_fingerprint(self: Hasher, fingerprint: Fingerprint): void {
    self.write_u64(f0(fingerprint));
    self.write_u64(f1(fingerprint));
  },
};

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:142 write_fingerprint
/** `impl FingerprintHasher for crate::unhash::Unhasher` (see `Fingerprint.hash`). */
export function write_fingerprint_unhasher(self: Hasher, fingerprint: Fingerprint): void {
  // Even though both halves of the fingerprint are expected to be good
  // quality hash values, let's still combine the two values because the
  // Fingerprints in DefPathHash have the StableCrateId portion which is
  // the same for all DefPathHashes from the same crate. Combining the
  // two halves makes sure we get a good quality hash in such cases too.
  //
  // Since `Unhasher` is used only in the context of HashMaps, it is OK
  // to combine the two components in an order-independent way (which is
  // cheaper than the more robust Fingerprint::to_smaller_hash()). For
  // HashMaps we don't really care if Fingerprint(x,y) and
  // Fingerprint(y, x) result in the same hash value. Collision
  // probability will still be much better than with FxHash.
  self.write_u64((f0(fingerprint) + f1(fingerprint)) & U64_MASK);
}

// `impl_stable_traits_for_trivial_type!(Fingerprint);` -> `stable_hash_Fingerprint` in
// stable_hash.ts (`Hash::hash(self, hasher)`), and `StableOrd` (unstable sort allowed).

// rustc-skip: compiler/rustc_data_structures/src/fingerprint.rs:172 encode Encodable impl (metadata encoding, M5)

/// PORT: stand-in for the `rustc_serialize::Decoder` method this file calls (rustc_serialize is
/// not ported yet; the serialize lane provides the real trait).
export interface RawBytesDecoder {
  read_raw_bytes(len: number): Uint8Array;
}

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:179 decode
/** `impl<D: Decoder> Decodable<D> for Fingerprint` */
export function decode_Fingerprint(d: RawBytesDecoder): Fingerprint {
  return Fingerprint.from_le_bytes(d.read_raw_bytes(16));
}

/// `PackedFingerprint` wraps a `Fingerprint`.
/// Its purpose is to behave like a `Fingerprint` without alignment requirements.
///
/// This may be preferable to use in large collections of structs containing
/// fingerprints, as it can reduce memory consumption by preventing the padding
/// that the more strictly-aligned `Fingerprint` can introduce. An application of
/// this is in the query dependency graph, which contains a large collection of
/// `DepNode`s. As of this writing, the size of a `DepNode` decreases by 25%
/// (from 24 bytes to 18) by using the packed representation here, which
/// noticeably decreases total memory usage when compiling large crates.
///
/// (Unalignment was previously restricted to `x86` and `x86_64` hosts, but is
/// now enabled by default for all host architectures, in the hope that the
/// memory and cache savings should outweigh any unaligned access penalty.)
///
/// The wrapped `Fingerprint` is private to reduce the chance of a client
/// invoking undefined behavior by taking a reference to the packed field.
// `#[repr(packed)] #[derive(Eq, PartialEq, Ord, PartialOrd, Debug, Clone, Copy, Hash)]`
export type PackedFingerprint = bigint & { readonly __brand: "PackedFingerprint" };

/** `#[derive(Debug)]`: `PackedFingerprint(Fingerprint(a, b))` */
export const debug_PackedFingerprint: Debug<PackedFingerprint> = (v, f) =>
  debug_tuple(f, "PackedFingerprint", [debug_Fingerprint(v as bigint as Fingerprint, f)]);

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:207 fmt
/** `impl std::fmt::Display for PackedFingerprint` */
export const display_PackedFingerprint = (v: PackedFingerprint): string => {
  // Copy to avoid taking reference to packed field.
  const copy = v as bigint as Fingerprint;
  return display_Fingerprint(copy);
};

// rustc-skip: compiler/rustc_data_structures/src/fingerprint.rs:216 encode Encodable impl (metadata encoding, M5)

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:225 decode
/** `impl<D: Decoder> Decodable<D> for PackedFingerprint` */
export function decode_PackedFingerprint(d: RawBytesDecoder): PackedFingerprint {
  return decode_Fingerprint(d) as bigint as PackedFingerprint;
}

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:232 from
/** `impl From<Fingerprint> for PackedFingerprint` */
export function PackedFingerprint_from_Fingerprint(f: Fingerprint): PackedFingerprint {
  return f as bigint as PackedFingerprint;
}

// rustc: compiler/rustc_data_structures/src/fingerprint.rs:239 from
/** `impl From<PackedFingerprint> for Fingerprint` */
export function Fingerprint_from_PackedFingerprint(f: PackedFingerprint): Fingerprint {
  return f as bigint as Fingerprint;
}
