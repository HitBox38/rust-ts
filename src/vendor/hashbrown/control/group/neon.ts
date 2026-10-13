// Port of hashbrown =0.17.1 `src/control/group/neon.rs` (the group implementation of the oracle
// host, see mod.ts).
//
// PORT: `neon::uint8x8_t` is an 8-lane `Uint8Array`; the intrinsics are lane-wise loops:
// `vceq_u8` (0xff where equal), `vcltz_s8` / `vcgez_s8` (0xff where the lane as i8 is < 0 / >= 0),
// `vorr_u8`, `vdup_n_u8`, and `vget_lane_u64(vreinterpret_u64_u8(v), 0)` reads the 8 lanes as a
// little-endian u64 (`bigint`). `*const Tag` pointers are (control-byte array, index) pairs.

import { BitMask } from "../bitmask.ts";
import { Tag } from "../tag.ts";

export type BitMaskWord = bigint;
export type NonZeroBitMaskWord = bigint;
export const BITMASK_STRIDE = 8;
export const BITMASK_ITER_MASK: BitMaskWord = 0x8080_8080_8080_8080n;

/** `vget_lane_u64(vreinterpret_u64_u8(lanes), 0)` */
function lanes_to_u64(lanes: Uint8Array): bigint {
  const lo = (lanes[0]! | (lanes[1]! << 8) | (lanes[2]! << 16) | (lanes[3]! << 24)) >>> 0;
  const hi = (lanes[4]! | (lanes[5]! << 8) | (lanes[6]! << 16) | (lanes[7]! << 24)) >>> 0;
  return BigInt(lo) | (BigInt(hi) << 32n);
}

/// Abstraction over a group of control tags which can be scanned in
/// parallel.
///
/// This implementation uses a 64-bit NEON value.
// PORT: `#[derive(Copy, Clone)]`: instances are never mutated after construction.
export class Group {
  constructor(readonly _0: Uint8Array) {}

  /// Number of bytes in the group.
  static readonly WIDTH: number = 8; // mem::size_of::<Self>()

  /// Returns a full group of empty tags, suitable for use as the initial
  /// value for an empty hash table.
  ///
  /// This is guaranteed to be aligned to the group size.
  // PORT: a fresh array each call (upstream: one static); callers never write to it.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:28 static_empty
  static static_empty(): Uint8Array {
    return new Uint8Array(Group.WIDTH).fill(Tag.EMPTY);
  }

  /// Loads a group of tags starting at the given address.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:43 load
  static load(ctrl: Uint8Array, ptr: number): Group {
    return new Group(ctrl.slice(ptr, ptr + Group.WIDTH));
  }

  /// Loads a group of tags starting at the given address, which must be
  /// aligned to `mem::align_of::<Group>()`.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:50 load_aligned
  static load_aligned(ctrl: Uint8Array, ptr: number): Group {
    // debug_assert_eq!(ptr.align_offset(mem::align_of::<Self>()), 0);
    return new Group(ctrl.slice(ptr, ptr + Group.WIDTH));
  }

  /// Stores the group of tags to the given address, which must be
  /// aligned to `mem::align_of::<Group>()`.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:58 store_aligned
  store_aligned(ctrl: Uint8Array, ptr: number): void {
    // debug_assert_eq!(ptr.align_offset(mem::align_of::<Self>()), 0);
    ctrl.set(this._0, ptr);
  }

  /// Returns a `BitMask` indicating all tags in the group which *may*
  /// have the given value.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:68 match_tag
  match_tag(tag: Tag): BitMask {
    const cmp = new Uint8Array(Group.WIDTH);
    for (let i = 0; i < Group.WIDTH; i++) cmp[i] = this._0[i] === tag ? 0xff : 0;
    return new BitMask(lanes_to_u64(cmp));
  }

  /// Returns a `BitMask` indicating all tags in the group which are
  /// `EMPTY`.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:78 match_empty
  match_empty(): BitMask {
    return this.match_tag(Tag.EMPTY);
  }

  /// Returns a `BitMask` indicating all tags in the group which are
  /// `EMPTY` or `DELETED`.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:85 match_empty_or_deleted
  match_empty_or_deleted(): BitMask {
    const cmp = new Uint8Array(Group.WIDTH);
    for (let i = 0; i < Group.WIDTH; i++) cmp[i] = this._0[i]! >= 0x80 ? 0xff : 0;
    return new BitMask(lanes_to_u64(cmp));
  }

  /// Returns a `BitMask` indicating all tags in the group which are full.
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:94 match_full
  match_full(): BitMask {
    const cmp = new Uint8Array(Group.WIDTH);
    for (let i = 0; i < Group.WIDTH; i++) cmp[i] = this._0[i]! < 0x80 ? 0xff : 0;
    return new BitMask(lanes_to_u64(cmp));
  }

  /// Performs the following transformation on all tags in the group:
  /// - `EMPTY => EMPTY`
  /// - `DELETED => EMPTY`
  /// - `FULL => DELETED`
  // crate: hashbrown-0.17.1/src/control/group/neon.rs:106 convert_special_to_empty_and_full_to_deleted
  convert_special_to_empty_and_full_to_deleted(): Group {
    // Map high_bit = 1 (EMPTY or DELETED) to 1111_1111
    // and high_bit = 0 (FULL) to 1000_0000
    //
    // Here's this logic expanded to concrete values:
    //   let special = 0 > tag = 1111_1111 (true) or 0000_0000 (false)
    //   1111_1111 | 1000_0000 = 1111_1111
    //   0000_0000 | 1000_0000 = 1000_0000
    const out = new Uint8Array(Group.WIDTH);
    for (let i = 0; i < Group.WIDTH; i++) {
      const special = this._0[i]! >= 0x80 ? 0xff : 0;
      out[i] = special | 0x80;
    }
    return new Group(out);
  }
}
