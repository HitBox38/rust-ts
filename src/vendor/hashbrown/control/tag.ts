// Port of hashbrown =0.17.1 `src/control/tag.rs`.
//
// PORT: `struct Tag(u8)` is a plain `number` (0..=255) with the associated consts and methods on the
// companion `Tag` const. `[MaybeUninit<Tag>]` slices are `Uint8Array`s.

import { debug_int, debug_tuple, type Fmt } from "../../../std/fmt.ts";

/// Single tag in a control group.
export type Tag = number;

export const Tag = {
  /// Control tag value for an empty bucket.
  EMPTY: 0b1111_1111 as Tag,

  /// Control tag value for a deleted bucket.
  DELETED: 0b1000_0000 as Tag,

  /// Checks whether a control tag represents a full bucket (top bit is clear).
  // crate: hashbrown-0.17.1/src/control/tag.rs:16 is_full
  is_full(self: Tag): boolean {
    return (self & 0x80) === 0;
  },

  /// Checks whether a control tag represents a special value (top bit is set).
  // crate: hashbrown-0.17.1/src/control/tag.rs:22 is_special
  is_special(self: Tag): boolean {
    return (self & 0x80) !== 0;
  },

  /// Checks whether a special control value is EMPTY (just check 1 bit).
  // crate: hashbrown-0.17.1/src/control/tag.rs:28 special_is_empty
  special_is_empty(self: Tag): boolean {
    // debug_assert!(self.is_special());
    return (self & 0x01) !== 0;
  },

  /// Creates a control tag representing a full bucket with the given hash.
  // crate: hashbrown-0.17.1/src/control/tag.rs:35 full
  full(hash: bigint): Tag {
    // Constant for function that grabs the top 7 bits of the hash.
    // PORT: `min(size_of::<usize>(), size_of::<u64>())` on the 64-bit oracle host.
    const MIN_HASH_LEN = 8n;

    // Grab the top 7 bits of the hash. While the hash is normally a full 64-bit
    // value, some hash functions (such as FxHash) produce a usize result
    // instead, which means that the top 32 bits are 0 on 32-bit platforms.
    // So we use MIN_HASH_LEN constant to handle this.
    const top7 = hash >> (MIN_HASH_LEN * 8n - 7n);
    return Number(top7 & 0x7fn); // truncation
  },
};

// PORT: `Fmt` carries no width/precision, so `f.pad(s)` is `s`.
// crate: hashbrown-0.17.1/src/control/tag.rs:52 fmt
export function debug_Tag(self: Tag, f: Fmt): string {
  if (Tag.is_special(self)) {
    if (Tag.special_is_empty(self)) {
      return "EMPTY";
    } else {
      return "DELETED";
    }
  } else {
    return debug_tuple(f, "full", [debug_int(self & 0x7f, f)]);
  }
}

/// Extension trait for slices of tags.
export const TagSliceExt = {
  /// Fills the control with the given tag.
  // crate: hashbrown-0.17.1/src/control/tag.rs:68 fill_tag
  // crate: hashbrown-0.17.1/src/control/tag.rs:78 fill_tag
  fill_tag(self: Uint8Array, tag: Tag): void {
    // SAFETY: We have access to the entire slice, so, we can write to the entire slice.
    self.fill(tag);
  },

  /// Clears out the control.
  // crate: hashbrown-0.17.1/src/control/tag.rs:72 fill_empty
  fill_empty(self: Uint8Array): void {
    TagSliceExt.fill_tag(self, Tag.EMPTY);
  },
};
