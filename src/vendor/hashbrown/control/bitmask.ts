// Port of hashbrown =0.17.1 `src/control/bitmask.rs`.
//
// PORT: `BitMaskWord` is the oracle host's (NEON, see group/mod.ts): a u64, held as a `bigint` in
// 0..2^64. `cfg!(target_arch = "arm")` is false on aarch64, so the plain `trailing_zeros` arms are
// the ones ported. `Option<usize>` is `number | undefined`.

import { BITMASK_ITER_MASK, BITMASK_STRIDE, type BitMaskWord } from "./group/mod.ts";

/** `u64::trailing_zeros` (64 for 0). */
function u64_trailing_zeros(x: bigint): number {
  if (x === 0n) return 64;
  let n = 0;
  while ((x & 1n) === 0n) {
    x >>= 1n;
    n++;
  }
  return n;
}

/** `u64::leading_zeros` (64 for 0). */
function u64_leading_zeros(x: bigint): number {
  let n = 64;
  while (x !== 0n) {
    x >>= 1n;
    n--;
  }
  return n;
}

/// A bit mask which contains the result of a `Match` operation on a `Group` and
/// allows iterating through them.
///
/// The bit mask is arranged so that low-order bits represent lower memory
/// addresses for group match results.
///
/// For implementation reasons, the bits in the set may be sparsely packed with
/// groups of 8 bits representing one element. If any of these bits are non-zero
/// then this element is considered to true in the mask. If this is the
/// case, `BITMASK_STRIDE` will be 8 to indicate a divide-by-8 should be
/// performed on counts/indices to normalize this difference. `BITMASK_MASK` is
/// similarly a mask of all the actually-used bits.
///
/// To iterate over a bit mask, it must be converted to a form where only 1 bit
/// is set per element. This is done by applying `BITMASK_ITER_MASK` on the
/// mask bits.
// PORT: `#[derive(Copy, Clone)]`: instances are never mutated.
export class BitMask {
  constructor(readonly _0: BitMaskWord) {}

  /// Returns a new `BitMask` with the lowest bit removed.
  // crate: hashbrown-0.17.1/src/control/bitmask.rs:27 remove_lowest_bit
  remove_lowest_bit(): BitMask {
    return new BitMask(this._0 & (this._0 - 1n));
  }

  /// Returns whether the `BitMask` has at least one set bit.
  // crate: hashbrown-0.17.1/src/control/bitmask.rs:33 any_bit_set
  any_bit_set(): boolean {
    return this._0 !== 0n;
  }

  /// Returns the first set bit in the `BitMask`, if there is one.
  // crate: hashbrown-0.17.1/src/control/bitmask.rs:39 lowest_set_bit
  lowest_set_bit(): number | undefined {
    if (this._0 !== 0n) {
      return BitMask.nonzero_trailing_zeros(this._0);
    } else {
      return undefined;
    }
  }

  /// Returns the number of trailing zeroes in the `BitMask`.
  // crate: hashbrown-0.17.1/src/control/bitmask.rs:49 trailing_zeros
  trailing_zeros(): number {
    // ARM doesn't have a trailing_zeroes instruction, and instead uses
    // reverse_bits (RBIT) + leading_zeroes (CLZ). However older ARM
    // versions (pre-ARMv7) don't have RBIT and need to emulate it
    // instead. Since we only have 1 bit set in each byte on ARM, we can
    // use swap_bytes (REV) + leading_zeroes instead.
    // (`cfg!(target_arch = "arm")` is false on the oracle host.)
    return Math.floor(u64_trailing_zeros(this._0) / BITMASK_STRIDE);
  }

  /// Same as above but takes a `NonZeroBitMaskWord`.
  // crate: hashbrown-0.17.1/src/control/bitmask.rs:64 nonzero_trailing_zeros
  static nonzero_trailing_zeros(nonzero: BitMaskWord): number {
    // (`cfg!(target_arch = "arm")` is false on the oracle host.)
    return Math.floor(u64_trailing_zeros(nonzero) / BITMASK_STRIDE);
  }

  /// Returns the number of leading zeroes in the `BitMask`.
  // crate: hashbrown-0.17.1/src/control/bitmask.rs:76 leading_zeros
  leading_zeros(): number {
    return Math.floor(u64_leading_zeros(this._0) / BITMASK_STRIDE);
  }

  // ---- impl IntoIterator for BitMask ----

  // crate: hashbrown-0.17.1/src/control/bitmask.rs:86 into_iter
  into_iter(): BitMaskIter {
    // A BitMask only requires each element (group of bits) to be non-zero.
    // However for iteration we need each element to only contain 1 bit.
    return new BitMaskIter(new BitMask(this._0 & BITMASK_ITER_MASK));
  }
}

/// Iterator over the contents of a `BitMask`, returning the indices of set
/// bits.
// PORT: `#[derive(Clone)]` is `clone()`.
export class BitMaskIter {
  constructor(public _0: BitMask) {}

  clone(): BitMaskIter {
    return new BitMaskIter(this._0);
  }

  // crate: hashbrown-0.17.1/src/control/bitmask.rs:102 next
  next(): number | undefined {
    const bit = this._0.lowest_set_bit();
    if (bit === undefined) return undefined;
    this._0 = this._0.remove_lowest_bit();
    return bit;
  }
}
