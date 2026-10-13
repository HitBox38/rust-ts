// Port of rustc-stable-hash =0.1.2 `src/stable_hasher.rs`.
//
//! Stable hasher adapted for cross-platform independent hash.
//
// PORT: integer widths (see sip128.ts): u8..u32/i8..i32/usize/isize are `number`, u64/i64/u128/i128
// are `bigint`. `str` arguments (`write_str`) are their UTF-8 bytes.
// PORT: `Hasher::finish(&self) -> u64` is `finish_u64()`, because `ExtendedHasher::finish(self)` and
// the inherent `StableHasher::finish::<W>(self)` (the ones rustc calls) keep the name `finish`.

import { type Debug, type Fmt, PLAIN } from "../../std/fmt.ts";

/// PORT: stand-in for `std::hash::Hasher` (the methods the vendored hashers implement or call),
/// with rustc-stable-hash's `nightly` feature on (`write_str`, `write_length_prefix`), as rustc
/// builds it. Root: move to src/std/hash.ts once std's hashing is ported.
export interface Hasher {
  /** `Hasher::finish(&self) -> u64` */
  finish_u64(): bigint;
  write(bytes: Uint8Array): void;
  write_u8(i: number): void;
  write_u16(i: number): void;
  write_u32(i: number): void;
  write_u64(i: bigint): void;
  write_u128(i: bigint): void;
  write_usize(i: number): void;
  write_i8(i: number): void;
  write_i16(i: number): void;
  write_i32(i: number): void;
  write_i64(i: bigint): void;
  write_i128(i: bigint): void;
  write_isize(i: number): void;
  write_length_prefix(len: number): void;
  write_str(s: Uint8Array): void;
}

/// Provided methods of `std::hash::Hasher` (library/core/src/hash/mod.rs) used by the hashers here.
export const Hasher_provided = {
  /** `fn write_u128(&mut self, i: u128) { self.write(&i.to_ne_bytes()) }` (little-endian host) */
  write_u128(self: Hasher, i: bigint): void {
    self.write(u128_to_le_bytes(i));
  },
  /** `fn write_i128(&mut self, i: i128) { self.write_u128(i as u128) }` */
  write_i128(self: Hasher, i: bigint): void {
    self.write_u128(BigInt.asUintN(128, i));
  },
  /** `fn write_length_prefix(&mut self, len: usize) { self.write_usize(len); }` */
  write_length_prefix(self: Hasher, len: number): void {
    self.write_usize(len);
  },
  /** `fn write_str(&mut self, s: &str) { self.write(s.as_bytes()); self.write_u8(0xff); }` */
  write_str(self: Hasher, s: Uint8Array): void {
    self.write(s);
    self.write_u8(0xff);
  },
};

/** `(i as u128).to_le_bytes()` */
function u128_to_le_bytes(i: bigint): Uint8Array {
  let v = BigInt.asUintN(128, i);
  const out = new Uint8Array(16);
  for (let k = 0; k < 16; k++) {
    out[k] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

const MASK32 = 0xffff_ffffn;
const U32 = 0x1_0000_0000;

/// Extended [`Hasher`] trait for use with [`StableHasher`].
///
/// It permits returning an arbitrary type as the [`Self::Hash`] type
/// contrary to the [`Hasher`] trait which can only return `u64`. This
/// is useful when the hasher uses a different representation.
///
/// # Example
///
/// ```
/// use std::hash::Hasher;
/// use rustc_stable_hash::ExtendedHasher;
///
/// struct BogusHasher(u128);
///
/// impl Hasher for BogusHasher {
///     fn write(&mut self, a: &[u8]) {
///         # self.0 = a.iter().fold(0u128, |acc, a| acc + (*a as u128)) + self.0;
///         // ...
///     }
///
///     fn finish(&self) -> u64 {
///         self.0 as u64 // really bogus
///     }
/// }
///
/// impl ExtendedHasher for BogusHasher {
///     type Hash = u128;
///
///     fn short_write<const LEN: usize>(&mut self, bytes: [u8; LEN]) {
///         self.write(&bytes)
///     }
///
///     fn finish(self) -> Self::Hash {
///         self.0
///     }
/// }
/// ```
// PORT: `type Hash` is the type parameter `Hash`. `short_write<const LEN>(bytes: [u8; LEN])` takes
// `(LEN, lo, hi)`: the integer whose `LEN` (1, 2, 4 or 8) little-endian bytes are written, as its
// low and high 32 bits.
export interface ExtendedHasher<Hash> extends Hasher {
  /// Optimized version of [`Hasher::write`] but for small write.
  // (provided) ExtendedHasher_provided.short_write
  short_write(LEN: number, lo: number, hi: number): void;

  /// Finalization method of the hasher to return the [`Hash`].
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:56 finish
  finish(): Hash;
}

export const ExtendedHasher_provided = {
  /// Optimized version of [`Hasher::write`] but for small write.
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:51 short_write
  short_write(self: Hasher, LEN: number, lo: number, hi: number): void {
    const bytes = new Uint8Array(LEN);
    const view = new DataView(bytes.buffer);
    if (LEN === 1) view.setUint8(0, lo & 0xff);
    else if (LEN === 2) view.setUint16(0, lo & 0xffff, true);
    else if (LEN === 4) view.setInt32(0, lo, true);
    else {
      view.setInt32(0, lo, true);
      view.setInt32(4, hi, true);
    }
    self.write(bytes);
  },
};

/** The `Hash` type of an `ExtendedHasher`. */
export type HashOf<H> = H extends ExtendedHasher<infer X> ? X : never;

/// Trait for processing the result of the stable hashing operation.
///
/// # Example
///
/// ```
/// use rustc_stable_hash::{StableHasher, FromStableHash};
///
/// struct Hash128(u128);
///
/// impl FromStableHash for Hash128 {
///     type Hash = [u64; 2];
///
///     fn from(hash: [u64; 2]) -> Hash128 {
///         let upper: u128 = hash[0] as u128;
///         let lower: u128 = hash[1] as u128;
///
///         Hash128((upper << 64) | lower)
///     }
/// }
/// ```
// PORT: implemented by the companion const of the target type (`Hash64.from(..)`); `type Hash` is
// the parameter `Hash`.
export interface FromStableHash<Self, Hash> {
  /// Convert the finalized state of a [`StableHasher`] and construct
  /// an [`Self`] containing the processed hash.
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:121 from
  from(hash: Hash): Self;
}

/// A Stable Hasher adapted for cross-platform independent hash.
///
/// When hashing something that ends up affecting properties like symbol names,
/// we want these symbol names to be calculated independently of other factors
/// like what architecture you're compiling *from*.
///
/// To that end we always convert integers to little-endian format before
/// hashing and the architecture dependent `isize` and `usize` types are
/// extended to 64 bits if needed.
///
/// # Example
///
/// ```
/// use rustc_stable_hash::hashers::{StableSipHasher128, SipHasher128Hash};
/// use rustc_stable_hash::{StableHasher, FromStableHash};
/// use std::hash::Hasher;
///
/// struct Hash128([u64; 2]);
/// impl FromStableHash for Hash128 {
///     type Hash = SipHasher128Hash;
///
///     fn from(SipHasher128Hash(hash): SipHasher128Hash) -> Hash128 {
///         Hash128(hash)
///     }
/// }
///
/// let mut hasher = StableSipHasher128::new();
/// hasher.write_usize(0xFA);
///
/// let hash: Hash128 = hasher.finish();
/// ```
// PORT: `#[must_use] #[derive(Clone)]`; `clone()` exists when `H` has one.
export class StableHasher<H extends ExtendedHasher<unknown>> implements Hasher {
  constructor(private state: H) {}

  /// Creates a new [`StableHasher`].
  ///
  /// To be used with the [`Hasher`] implementation and [`StableHasher::finish`].
  // PORT: `H: Default` is passed as the companion of `H` (its `default()`).
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:129 new
  static new<H extends ExtendedHasher<unknown>>(H_: { default(): H }): StableHasher<H> {
    return StableHasher.default(H_);
  }

  /// Creates a new [`StableHasher`].
  ///
  /// To be used with the [`Hasher`] implementation and [`StableHasher::finish`].
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:139 default
  static default<H extends ExtendedHasher<unknown>>(H_: { default(): H }): StableHasher<H> {
    return new StableHasher(H_.default());
  }

  /// Creates a new [`StableHasher`] from an already created [`ExtendedHasher`].
  ///
  /// Useful when wanting to initialize a hasher with different parameters/keys.
  ///
  /// **Important**: Any use of the hasher before being given to a [`StableHasher`]
  /// is not covered by this crate guarentees and will make the resulting hash
  /// NOT platform independent.
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:155 with_hasher
  static with_hasher<H extends ExtendedHasher<unknown>>(state: H): StableHasher<H> {
    return new StableHasher(state);
  }

  /// Returns the typed-hash value for the values written.
  ///
  /// The resulting typed-hash value is constructed from an
  /// [`FromStableHash`] implemenation.
  ///
  /// To be used in-place of [`Hasher::finish`].
  // PORT: the target type `W` is passed as its `FromStableHash` companion: `hasher.finish(Hash64)`.
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:167 finish
  finish<W>(W_: FromStableHash<W, HashOf<H>>): W {
    return W_.from(this.state.finish() as HashOf<H>);
  }

  /** derive(Clone) */
  clone(this: StableHasher<H & { clone(): H }>): StableHasher<H> {
    return new StableHasher(this.state.clone());
  }

  /** The wrapped hasher (for `Debug`). */
  get_state(): H {
    return this.state;
  }

  // ---- impl Hasher for StableHasher<H> ----

  /// Returns a combined hash.
  ///
  /// For greater precision use instead [`StableHasher::finish`].
  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:182 finish
  finish_u64(): bigint {
    return this.state.finish_u64();
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:187 write
  write(bytes: Uint8Array): void {
    this.state.write(bytes);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:193 write_str
  /** `#[cfg(feature = "nightly")]` (rustc enables it). */
  write_str(s: Uint8Array): void {
    this.state.write_str(s);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:199 write_length_prefix
  /** `#[cfg(feature = "nightly")]` (rustc enables it). */
  write_length_prefix(len: number): void {
    // Our impl for `usize` will extend it if needed.
    this.write_usize(len);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:205 write_u8
  write_u8(i: number): void {
    this.state.write_u8(i);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:210 write_u16
  write_u16(i: number): void {
    this.state.short_write(2, i & 0xffff, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:215 write_u32
  write_u32(i: number): void {
    this.state.short_write(4, i | 0, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:220 write_u64
  write_u64(i: bigint): void {
    this.state.short_write(8, Number(i & MASK32) | 0, Number((i >> 32n) & MASK32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:225 write_u128
  write_u128(i: bigint): void {
    this.write_u64(BigInt.asUintN(64, i));
    this.write_u64(BigInt.asUintN(64, i >> 64n));
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:231 write_usize
  write_usize(i: number): void {
    // Always treat usize as u64 so we get the same results on 32 and 64 bit
    // platforms. This is important for symbol hashes when cross compiling,
    // for example.
    this.state.short_write(8, i % U32 | 0, Math.floor(i / U32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:239 write_i8
  write_i8(i: number): void {
    this.state.write_i8(i);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:244 write_i16
  write_i16(i: number): void {
    this.state.short_write(2, i & 0xffff, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:249 write_i32
  write_i32(i: number): void {
    this.state.short_write(4, i | 0, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:254 write_i64
  write_i64(i: bigint): void {
    this.state.short_write(8, Number(i & MASK32) | 0, Number((i >> 32n) & MASK32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:259 write_i128
  write_i128(i: bigint): void {
    this.state.write(u128_to_le_bytes(i));
  }

  // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:264 write_isize
  write_isize(i: number): void {
    // Always treat isize as a 64-bit number so we get the same results on 32 and 64 bit
    // platforms. This is important for symbol hashes when cross compiling,
    // for example. Sign extending here is preferable as it means that the
    // same negative number hashes the same on both 32 and 64 bit platforms.
    // PORT: `let value = i as u64;` as its low / high 32 bits (two's complement).
    const lo = i % U32 | 0;
    const hi = Math.floor(i / U32) | 0;

    // Cold path
    // crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:274 hash_value
    function hash_value(state: ExtendedHasher<unknown>, lo: number, hi: number): void {
      state.write_u8(0xff);
      state.short_write(8, lo, hi);
    }

    // `isize` values often seem to have a small (positive) numeric value in practice.
    // To exploit this, if the value is small, we will hash a smaller amount of bytes.
    // However, we cannot just skip the leading zero bytes, as that would produce the same hash
    // e.g. if you hash two values that have the same bit pattern when they are swapped.
    // See https://github.com/rust-lang/rust/pull/93014 for context.
    //
    // Therefore, we employ the following strategy:
    // 1) When we encounter a value that fits within a single byte (the most common case), we
    // hash just that byte. This is the most common case that is being optimized. However, we do
    // not do this for the value 0xFF, as that is a reserved prefix (a bit like in UTF-8).
    // 2) When we encounter a larger value, we hash a "marker" 0xFF and then the corresponding
    // 8 bytes. Since this prefix cannot occur when we hash a single byte, when we hash two
    // `isize`s that fit within a different amount of bytes, they should always produce a different
    // byte stream for the hasher.
    // `value < 0xFF` as u64: a negative `i` is a huge u64.
    if (i >= 0 && i < 0xff) {
      this.state.write_u8(i);
    } else {
      hash_value(this.state, lo, hi);
    }
  }
}

// crate: rustc-stable-hash-0.1.2/src/stable_hasher.rs:173 fmt
/** `impl<H: ExtendedHasher + fmt::Debug> fmt::Debug for StableHasher<H>`: `write!(f, "{:?}", self.state)`
 * (a fresh `{:?}`: the caller's `{:#?}` flag does not reach the state). */
export function debug_StableHasher<H extends ExtendedHasher<unknown>>(v: StableHasher<H>, _f: Fmt, debug_H: Debug<H>): string {
  return debug_H(v.get_state(), PLAIN);
}
