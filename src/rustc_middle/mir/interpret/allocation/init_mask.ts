// Port of compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs (lane mir-contract, plan-m4 D3 / D6; fns ported
// by lane mir-interp-a). The types are generated into init_mask.gen.ts (set rustc_middle_mir).
// PORT (D6): `Block = u64` (a bitmask) is stored as 32-bit words, two per upstream block: `blocks[2 * k]` holds bits 0..32
// of block `k`, `blocks[2 * k + 1]` bits 32..64, each a non-negative number below 2^32. Every block operation works on the
// word pair (`u64::MAX << n` / `u64::MAX >> n` are `max_shl` / `max_shr`), so the word array holds exactly the bits of
// upstream's `Vec<u64>` (same block count, same unused trailing bits): the derived `Eq` / `Hash` (interning) compare the
// same. `BLOCK_SIZE` and every bit / block index stay upstream's (64 bits per block).
// PORT: `InitChunkIter` is a JS iterator (`next()` returns an `IteratorResult`). `Range<Size>` is `{ start, end }`.
// PORT: the generated `debug_InitMaskMaterialized` prints the 32-bit words (upstream prints the u64 blocks); it is only
// reached from the `debug_assert_eq!` of `find_bit` (a comment here), so no output depends on it.
import "../../mod.ts";
import { Size } from "../../../../rustc_abi/lib.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import { assert, panic } from "../../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import type { Hasher } from "../../../../vendor/rustc_stable_hash/lib.ts";
import type { Decoder } from "../../../../rustc_serialize/serialize.ts";
import type { Range } from "../../../ty/decls.ts";
import { AllocRange_from_Range_Size, type AllocRange, MAX_BYTES_TO_HASH, MAX_HASHED_BUFFER_LEN } from "../allocation.ts";
import * as gen from "./init_mask.gen.ts";
import { InitChunkIter, InitCopy, InitMask, InitMaskMaterialized } from "./init_mask.gen.ts";
export * from "./init_mask.gen.ts";


declare module "./init_mask.gen.ts" {
  interface InitChunkIter extends IterableIterator<InitChunk> {}
}
// PORT: `IntoIterator` of the `Iterator` impl (JS iteration over `next()`).
(InitChunkIter.prototype as unknown as { [Symbol.iterator](): unknown })[Symbol.iterator] = function (this: unknown): unknown {
  return this;
};

declare module "./init_mask.gen.ts" {
  namespace InitMask {
    // interpret/allocation/init_mask.rs:38 (lane mir-interp-a)
    function new_(size: Size, state: boolean): InitMask;
    export { new_ as new };
  }
}

declare module "./init_mask.gen.ts" {
  interface InitMask {
    // interpret/allocation/init_mask.rs:49 (lane mir-interp-a)
    is_range_initialized(range: AllocRange): Result<undefined, AllocRange>;
    // interpret/allocation/init_mask.rs:69 (lane mir-interp-a)
    set_range(range: AllocRange, new_state: boolean): void;
    // interpret/allocation/init_mask.rs:163 (lane mir-interp-a)
    materialize_blocks(): InitMaskMaterialized;
    // interpret/allocation/init_mask.rs:176 (lane mir-interp-a)
    get(idx: Size): boolean;
    // interpret/allocation/init_mask.rs:585 (lane mir-interp-a)
    range_as_init_chunks(range: AllocRange): InitChunkIter;
    // interpret/allocation/init_mask.rs:670 (lane mir-interp-a)
    prepare_copy(range: AllocRange): InitCopy;
    // interpret/allocation/init_mask.rs:699 (lane mir-interp-a)
    apply_copy(defined: InitCopy, range: AllocRange, repeat: number): void;
  }
}

declare module "./init_mask.gen.ts" {
  namespace InitMaskMaterialized {
    // interpret/allocation/init_mask.rs:248 (lane mir-interp-a)
    function new_(size: Size, state: boolean): InitMaskMaterialized;
    export { new_ as new };
    // interpret/allocation/init_mask.rs:255 (lane mir-interp-a)
    export function bit_index(bits: Size): [number, number];
    // interpret/allocation/init_mask.rs:266 (lane mir-interp-a)
    export function size_from_bit_index(block: number, bit: number): Size;
  }
}

declare module "./init_mask.gen.ts" {
  interface InitMaskMaterialized {
    // interpret/allocation/init_mask.rs:277 (lane mir-interp-a)
    is_range_initialized(start: Size, end: Size): Result<undefined, AllocRange>;
    // interpret/allocation/init_mask.rs:289 (lane mir-interp-a)
    set_range_inbounds(start: Size, end: Size, new_state: boolean): void;
    // interpret/allocation/init_mask.rs:334 (lane mir-interp-a)
    get(i: Size): boolean;
    // interpret/allocation/init_mask.rs:339 (lane mir-interp-a)
    grow(len: Size, amount: Size, new_state: boolean): void;
    // interpret/allocation/init_mask.rs:366 (lane mir-interp-a)
    find_bit(start: Size, end: Size, is_init: boolean): Size | undefined;
  }
}

export interface InitChunk_methods {
    // interpret/allocation/init_mask.rs:559 (lane mir-interp-a)
    is_init(self: InitChunk): boolean;
    // interpret/allocation/init_mask.rs:567 (lane mir-interp-a)
    range(self: InitChunk): Range<Size>;
}
export type InitChunk = gen.InitChunk;
export const InitChunk = {} as InitChunk_methods;

declare module "./init_mask.gen.ts" {
  interface InitChunkIter {
    // interpret/allocation/init_mask.rs:618 (lane mir-interp-a) impl Iterator
    next(): IteratorResult<InitChunk>;
  }
}

declare module "./init_mask.gen.ts" {
  interface InitCopy {
    // interpret/allocation/init_mask.rs:657 (lane mir-interp-a)
    no_bytes_init(): boolean;
  }
}
// ---- PORT (D6): the u64 block operations on 32-bit word pairs (see the header) ----
const WORD_MAX = 0xffff_ffff;
/** `u64::MAX << n` (`n` in `0..64`) as `[low word, high word]`. */
function max_shl(n: number): [number, number] {
  return n < 32 ? [(WORD_MAX << n) >>> 0, WORD_MAX] : [0, (WORD_MAX << (n - 32)) >>> 0];
}
/** `u64::MAX >> n` (`n` in `0..64`) as `[low word, high word]`. */
function max_shr(n: number): [number, number] {
  return n < 32 ? [WORD_MAX, WORD_MAX >>> n] : [WORD_MAX >>> (n - 32), 0];
}
/** The bounds check of `blocks[block]` (a `Vec<u64>` index). */
function check_block(blocks: readonly number[], block: number): void {
  const len = blocks.length / 2;
  if (!(block < len)) panic(`index out of bounds: the len is ${len} but the index is ${block}`);
}
/** `blocks[block] |= mask` */
function block_or(blocks: number[], block: number, [lo, hi]: [number, number]): void {
  check_block(blocks, block);
  blocks[2 * block] = (blocks[2 * block]! | lo) >>> 0;
  blocks[2 * block + 1] = (blocks[2 * block + 1]! | hi) >>> 0;
}
/** `blocks[block] &= !mask` */
function block_and_not(blocks: number[], block: number, [lo, hi]: [number, number]): void {
  check_block(blocks, block);
  blocks[2 * block] = (blocks[2 * block]! & ~lo) >>> 0;
  blocks[2 * block + 1] = (blocks[2 * block + 1]! & ~hi) >>> 0;
}
/** `blocks[block] = if word { u64::MAX } else { 0 }` */
function block_set(blocks: number[], block: number, ones: boolean): void {
  check_block(blocks, block);
  blocks[2 * block] = ones ? WORD_MAX : 0;
  blocks[2 * block + 1] = ones ? WORD_MAX : 0;
}
/** `u32::trailing_zeros` of a non-zero word. */
function ctz32(x: number): number {
  return 31 - Math.clz32(x & -x);
}
/** `Size` comparisons (`Size: Ord`). */
function size_lt(a: Size, b: Size): boolean {
  return a.bytes() < b.bytes();
}

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:38 new
(InitMask as unknown as { new: typeof InitMask.new }).new = function (size: Size, state: boolean): InitMask {
  // Blocks start lazily allocated, until we have to materialize them.
  const blocks: gen.InitMaskBlocks = { $: "Lazy", state };
  return new InitMask(blocks, size);
};

/// Checks whether the `range` is entirely initialized.
///
/// Returns `Ok(())` if it's initialized. Otherwise returns a range of byte
/// indexes for the first contiguous span of the uninitialized access.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:49 is_range_initialized
InitMask.prototype.is_range_initialized = function (this: InitMask, range: AllocRange): Result<undefined, AllocRange> {
  const end = range.end();
  if (end.bytes() > this.len.bytes()) {
    return Err(AllocRange_from_Range_Size({ start: this.len, end }));
  }

  const blocks = this.blocks;
  switch (blocks.$) {
    case "Lazy": {
      // Lazily allocated blocks represent the full mask, and cover the requested range by
      // definition.
      return blocks.state ? Ok(undefined) : Err(range);
    }
    case "Materialized": {
      return blocks._0.is_range_initialized(range.start, end);
    }
  }
};

/// Sets a specified range to a value. If the range is out-of-bounds, the mask will grow to
/// accommodate it entirely.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:69 set_range
InitMask.prototype.set_range = function (this: InitMask, range: AllocRange, new_state: boolean): void {
  const start = range.start;
  const end = range.end();

  const is_full_overwrite = start.bytes() === Size.ZERO.bytes() && end.bytes() >= this.len.bytes();

  // Optimize the cases of a full init/uninit state, while handling growth if needed.
  const blocks_ = this.blocks;
  if (blocks_.$ === "Lazy" && is_full_overwrite) {
    // This is fully overwriting the mask, and we'll still have a single initialization
    // state: the blocks can stay lazy.
    blocks_.state = new_state;
    this.len = end;
  } else if (blocks_.$ === "Materialized" && is_full_overwrite) {
    // This is also fully overwriting materialized blocks with a single initialization
    // state: we'll have no need for these blocks anymore and can make them lazy.
    this.blocks = { $: "Lazy", state: new_state };
    this.len = end;
  } else if (blocks_.$ === "Lazy" && blocks_.state === new_state) {
    // Here we're partially overwriting the mask but the initialization state doesn't
    // change: the blocks can stay lazy.
    if (end.bytes() > this.len.bytes()) {
      this.len = end;
    }
  } else {
    // Otherwise, we have a partial overwrite that can result in a mix of initialization
    // states, so we'll need materialized blocks.
    const len = this.len;
    const blocks = this.materialize_blocks();

    // There are 3 cases of interest here, if we have:
    //
    //         [--------]
    //         ^        ^
    //         0        len
    //
    // 1) the range to set can be in-bounds:
    //
    //            xxxx = [start, end]
    //         [--------]
    //         ^        ^
    //         0        len
    //
    // Here, we'll simply set the single `start` to `end` range.
    //
    // 2) the range to set can be partially out-of-bounds:
    //
    //                xxxx = [start, end]
    //         [--------]
    //         ^        ^
    //         0        len
    //
    // We have 2 subranges to handle:
    // - we'll set the existing `start` to `len` range.
    // - we'll grow and set the `len` to `end` range.
    //
    // 3) the range to set can be fully out-of-bounds:
    //
    //                   ---xxxx = [start, end]
    //         [--------]
    //         ^        ^
    //         0        len
    //
    // Since we're growing the mask to a single `new_state` value, we consider the gap
    // from `len` to `start` to be part of the range, and have a single subrange to
    // handle: we'll grow and set the `len` to `end` range.
    //
    // Note that we have to materialize, set blocks, and grow the mask. We could
    // therefore slightly optimize things in situations where these writes overlap.
    // However, as of writing this, growing the mask doesn't happen in practice yet, so
    // we don't do this micro-optimization.

    if (end.bytes() <= len.bytes()) {
      // Handle case 1.
      blocks.set_range_inbounds(start, end, new_state);
    } else {
      if (size_lt(start, len)) {
        // Handle the first subrange of case 2.
        blocks.set_range_inbounds(start, len, new_state);
      }

      // Handle the second subrange of case 2, and case 3.
      blocks.grow(len, end.sub(len), new_state); // `Size` operation
      this.len = end;
    }
  }
};

/// Materializes this mask's blocks when the mask is lazy.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:163 materialize_blocks
InitMask.prototype.materialize_blocks = function (this: InitMask): InitMaskMaterialized {
  if (this.blocks.$ === "Lazy") {
    const state = this.blocks.state;
    this.blocks = { $: "Materialized", _0: InitMaskMaterialized.new(this.len, state) };
  }

  if (this.blocks.$ !== "Materialized") {
    return bug("initmask blocks must be materialized here");
  }
  const blocks = this.blocks._0;
  return blocks;
};

/// Returns the initialization state at the specified in-bounds index.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:176 get
InitMask.prototype.get = function (this: InitMask, idx: Size): boolean {
  const blocks = this.blocks;
  switch (blocks.$) {
    case "Lazy":
      return blocks.state;
    case "Materialized":
      return blocks._0.get(idx);
  }
};

// `impl Decodable for InitMask` / `InitMaskBlocks`: derive(Decodable_NoContext) (init_mask.rs:22 / :28), generated in
// init_mask.gen.ts (set rustc_middle_mir, lane meta-mir) and re-exported above.

// rustc-skip: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:198 encode Encodable (metadata encoding, M5)

// This implementation is deliberately not derived, see the matching `Encodable` impl.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:208 decode
export function decode_InitMaskMaterialized<D extends Decoder>(decoder: D): InitMaskMaterialized {
  const num_blocks = decoder.read_usize();
  const blocks: number[] = [];
  for (let i = 0; i < num_blocks; i++) {
    const bytes = decoder.read_raw_bytes(8);
    // `u64::from_le_bytes(bytes.try_into().unwrap())`, PORT (D6): as its two 32-bit words
    const lo = (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
    const hi = (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0;
    blocks.push(lo, hi);
  }
  return new InitMaskMaterialized(blocks);
}

// Const allocations are only hashed for interning. However, they can be large, making the hashing
// expensive especially since it uses `FxHash`: it's better suited to short keys, not potentially
// big buffers like the allocation's init mask. We can partially hash some fields when they're
// large.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:225 hash
export function hash_InitMaskMaterialized(self: InitMaskMaterialized, state: Hasher): void {
  const BLOCK_BYTES = 8; // `size_of::<Block>()`
  const MAX_BLOCKS_TO_HASH = MAX_BYTES_TO_HASH / BLOCK_BYTES;
  const MAX_BLOCKS_LEN = MAX_HASHED_BUFFER_LEN / BLOCK_BYTES;

  // PORT (D6): `<[u64]>::hash`: the length prefix, then the blocks' native-endian (little-endian host) bytes in one
  // `write`, which are the bytes of their word pairs.
  const hash_blocks = (from: number, to: number): void => {
    state.write_length_prefix(to - from);
    const bytes = new Uint8Array((to - from) * BLOCK_BYTES);
    const view = new DataView(bytes.buffer);
    for (let k = from; k < to; k++) {
      view.setUint32((k - from) * 8, self.blocks[2 * k]!, true);
      view.setUint32((k - from) * 8 + 4, self.blocks[2 * k + 1]!, true);
    }
    state.write(bytes);
  };

  // Partially hash the `blocks` buffer when it is large. To limit collisions with common
  // prefixes and suffixes, we hash the length and some slices of the buffer.
  const block_count = self.blocks.length / 2;
  if (block_count > MAX_BLOCKS_LEN) {
    // Hash the buffer's length.
    state.write_usize(block_count);

    // And its head and tail.
    hash_blocks(0, MAX_BLOCKS_TO_HASH);
    hash_blocks(block_count - MAX_BLOCKS_TO_HASH, block_count);
  } else {
    hash_blocks(0, block_count);
  }
}

/** `InitMaskMaterialized::BLOCK_SIZE: u64` */
const BLOCK_SIZE = 64;

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:248 new
(InitMaskMaterialized as unknown as { new: typeof InitMaskMaterialized.new }).new = function (size: Size, state: boolean): InitMaskMaterialized {
  const m = new InitMaskMaterialized([]);
  m.grow(Size.ZERO, size, state);
  return m;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:255 bit_index
(InitMaskMaterialized as unknown as { bit_index: typeof InitMaskMaterialized.bit_index }).bit_index = function (bits: Size): [number, number] {
  // BLOCK_SIZE is the number of bits that can fit in a `Block`.
  // Each bit in a `Block` represents the initialization state of one byte of an allocation,
  // so we use `.bytes()` here.
  const bits_ = bits.bytes();
  const a = Math.floor(bits_ / BLOCK_SIZE);
  const b = bits_ % BLOCK_SIZE;
  return [a, b];
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:266 size_from_bit_index
(InitMaskMaterialized as unknown as { size_from_bit_index: typeof InitMaskMaterialized.size_from_bit_index }).size_from_bit_index = function (block: number, bit: number): Size {
  return Size.from_bytes(block * BLOCK_SIZE + bit);
};

/// Checks whether the `range` is entirely initialized.
///
/// Returns `Ok(())` if it's initialized. Otherwise returns a range of byte
/// indexes for the first contiguous span of the uninitialized access.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:277 is_range_initialized
InitMaskMaterialized.prototype.is_range_initialized = function (this: InitMaskMaterialized, start: Size, end: Size): Result<undefined, AllocRange> {
  const uninit_start = this.find_bit(start, end, false);

  if (uninit_start !== undefined) {
    const uninit_end = this.find_bit(uninit_start, end, true) ?? end;
    return Err(AllocRange_from_Range_Size({ start: uninit_start, end: uninit_end }));
  } else {
    return Ok(undefined);
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:289 set_range_inbounds
InitMaskMaterialized.prototype.set_range_inbounds = function (this: InitMaskMaterialized, start: Size, end: Size, new_state: boolean): void {
  const [block_a, bit_a] = InitMaskMaterialized.bit_index(start);
  const [block_b, bit_b] = InitMaskMaterialized.bit_index(end);
  if (block_a === block_b) {
    // First set all bits except the first `bit_a`,
    // then unset the last `64 - bit_b` bits.
    let range: [number, number];
    if (bit_b === 0) {
      range = max_shl(bit_a);
    } else {
      const [a_lo, a_hi] = max_shl(bit_a);
      const [b_lo, b_hi] = max_shr(64 - bit_b);
      range = [(a_lo & b_lo) >>> 0, (a_hi & b_hi) >>> 0];
    }
    if (new_state) {
      block_or(this.blocks, block_a, range);
    } else {
      block_and_not(this.blocks, block_a, range);
    }
    return;
  }
  // across block boundaries
  if (new_state) {
    // Set `bit_a..64` to `1`.
    block_or(this.blocks, block_a, max_shl(bit_a));
    // Set `0..bit_b` to `1`.
    if (bit_b !== 0) {
      block_or(this.blocks, block_b, max_shr(64 - bit_b));
    }
    // Fill in all the other blocks (much faster than one bit at a time).
    for (let block = block_a + 1; block < block_b; block++) {
      block_set(this.blocks, block, true);
    }
  } else {
    // Set `bit_a..64` to `0`.
    block_and_not(this.blocks, block_a, max_shl(bit_a));
    // Set `0..bit_b` to `0`.
    if (bit_b !== 0) {
      block_and_not(this.blocks, block_b, max_shr(64 - bit_b));
    }
    // Fill in all the other blocks (much faster than one bit at a time).
    for (let block = block_a + 1; block < block_b; block++) {
      block_set(this.blocks, block, false);
    }
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:334 get
InitMaskMaterialized.prototype.get = function (this: InitMaskMaterialized, i: Size): boolean {
  const [block, bit] = InitMaskMaterialized.bit_index(i);
  // `(self.blocks[block] & (1 << bit)) != 0`
  check_block(this.blocks, block);
  const word = this.blocks[2 * block + (bit >>> 5)]!;
  return ((word >>> (bit & 31)) & 1) !== 0;
};

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:339 grow
InitMaskMaterialized.prototype.grow = function (this: InitMaskMaterialized, len: Size, amount: Size, new_state: boolean): void {
  if (amount.bytes() === 0) {
    return;
  }
  const unused_trailing_bits = (this.blocks.length / 2) * BLOCK_SIZE - len.bytes();

  // If there's not enough capacity in the currently allocated blocks, allocate some more.
  if (amount.bytes() > unused_trailing_bits) {
    const additional_blocks = Math.floor(amount.bytes() / BLOCK_SIZE) + 1;

    // We allocate the blocks to the correct value for the requested init state, so we won't
    // have to manually set them with another write.
    const word = new_state ? WORD_MAX : 0;
    for (let k = 0; k < additional_blocks; k++) {
      this.blocks.push(word, word);
    }
  }

  // New blocks have already been set here, so we only need to set the unused trailing bits,
  // if any.
  if (unused_trailing_bits > 0) {
    const in_bounds_tail = Size.from_bytes(unused_trailing_bits);
    this.set_range_inbounds(len, len.add(in_bounds_tail), new_state); // `Size` operation
  }
};

/// Returns the index of the first bit in `start..end` (end-exclusive) that is equal to is_init.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:366 find_bit
InitMaskMaterialized.prototype.find_bit = function (this: InitMaskMaterialized, start: Size, end: Size, is_init: boolean): Size | undefined {
  /// A fast implementation of `find_bit`,
  /// which skips over an entire block at a time if it's all 0s (resp. 1s),
  /// and finds the first 1 (resp. 0) bit inside a block using `trailing_zeros` instead of a loop.
  ///
  /// Note that all examples below are written with 8 (instead of 64) bit blocks for simplicity,
  /// and with the least significant bit (and lowest block) first:
  /// ```text
  ///        00000000|00000000
  ///        ^      ^ ^      ^
  /// index: 0      7 8      15
  /// ```
  /// Also, if not stated, assume that `is_init = true`, that is, we are searching for the first 1 bit.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:379 find_bit_fast
  function find_bit_fast(init_mask: InitMaskMaterialized, start: Size, end: Size, is_init: boolean): Size | undefined {
    /// Search one block, returning the index of the first bit equal to `is_init`.
    // PORT (D6): `bits: Block` is the block's word pair (`bits_lo`, `bits_hi`).
    // rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:386 search_block
    function search_block(bits_lo: number, bits_hi: number, block: number, start_bit: number, is_init: boolean): Size | undefined {
      // For the following examples, assume this function was called with:
      //   bits = 0b00111011
      //   start_bit = 3
      //   is_init = false
      // Note that, for the examples in this function, the most significant bit is written first,
      // which is backwards compared to the comments in `find_bit`/`find_bit_fast`.

      // Invert bits so we're always looking for the first set bit.
      //        ! 0b00111011
      //   bits = 0b11000100
      let lo = is_init ? bits_lo : ~bits_lo >>> 0;
      let hi = is_init ? bits_hi : ~bits_hi >>> 0;
      // Mask off unused start bits.
      //          0b11000100
      //        & 0b11111000
      //   bits = 0b11000000
      const [m_lo, m_hi] = max_shl(start_bit); // `!0 << start_bit`
      lo = (lo & m_lo) >>> 0;
      hi = (hi & m_hi) >>> 0;
      // Find set bit, if any.
      //   bit = trailing_zeros(0b11000000)
      //   bit = 6
      if (lo === 0 && hi === 0) {
        return undefined;
      } else {
        const bit = lo !== 0 ? ctz32(lo) : 32 + ctz32(hi);
        return InitMaskMaterialized.size_from_bit_index(block, bit);
      }
    }

    if (start.bytes() >= end.bytes()) {
      return undefined;
    }

    // Convert `start` and `end` to block indexes and bit indexes within each block.
    // We must convert `end` to an inclusive bound to handle block boundaries correctly.
    //
    // For example:
    //
    //   (a) 00000000|00000000    (b) 00000000|
    //       ^~~~~~~~~~~^             ^~~~~~~~~^
    //     start       end          start     end
    //
    // In both cases, the block index of `end` is 1.
    // But we do want to search block 1 in (a), and we don't in (b).
    //
    // We subtract 1 from both end positions to make them inclusive:
    //
    //   (a) 00000000|00000000    (b) 00000000|
    //       ^~~~~~~~~~^              ^~~~~~~^
    //     start    end_inclusive   start end_inclusive
    //
    // For (a), the block index of `end_inclusive` is 1, and for (b), it's 0.
    // This provides the desired behavior of searching blocks 0 and 1 for (a),
    // and searching only block 0 for (b).
    // There is no concern of overflows since we checked for `start >= end` above.
    const [start_block, start_bit] = InitMaskMaterialized.bit_index(start);
    const end_inclusive = Size.from_bytes(end.bytes() - 1);
    const [end_block_inclusive] = InitMaskMaterialized.bit_index(end_inclusive);

    // Handle first block: need to skip `start_bit` bits.
    //
    // We need to handle the first block separately,
    // because there may be bits earlier in the block that should be ignored,
    // such as the bit marked (1) in this example:
    //
    //       (1)
    //       -|------
    //   (c) 01000000|00000000|00000001
    //          ^~~~~~~~~~~~~~~~~~^
    //        start              end
    check_block(init_mask.blocks, start_block);
    const i = search_block(init_mask.blocks[2 * start_block]!, init_mask.blocks[2 * start_block + 1]!, start_block, start_bit, is_init);
    if (i !== undefined) {
      // If the range is less than a block, we may find a matching bit after `end`.
      //
      // For example, we shouldn't successfully find bit (2), because it's after `end`:
      //
      //             (2)
      //       -------|
      //   (d) 00000001|00000000|00000001
      //        ^~~~~^
      //      start end
      //
      // An alternative would be to mask off end bits in the same way as we do for start bits,
      // but performing this check afterwards is faster and simpler to implement.
      if (size_lt(i, end)) {
        return i;
      } else {
        return undefined;
      }
    }

    // Handle remaining blocks.
    //
    // We can skip over an entire block at once if it's all 0s (resp. 1s).
    // The block marked (3) in this example is the first block that will be handled by this loop,
    // and it will be skipped for that reason:
    //
    //                   (3)
    //                --------
    //   (e) 01000000|00000000|00000001
    //          ^~~~~~~~~~~~~~~~~~^
    //        start              end
    if (start_block < end_block_inclusive) {
      // This loop is written in a specific way for performance.
      // Notably: `..end_block_inclusive + 1` is used for an inclusive range instead of `..=end_block_inclusive`,
      // and `.zip(start_block + 1..)` is used to track the index instead of `.enumerate().skip().take()`,
      // because both alternatives result in significantly worse codegen.
      // `end_block_inclusive + 1` is guaranteed not to wrap, because `end_block_inclusive <= end / BLOCK_SIZE`,
      // and `BLOCK_SIZE` (the number of bits per block) will always be at least 8 (1 byte).
      // PORT: `init_mask.blocks[start_block + 1..end_block_inclusive + 1]` bounds-checks the slice end first.
      if (end_block_inclusive + 1 > init_mask.blocks.length / 2) {
        panic(`range end index ${end_block_inclusive + 1} out of range for slice of length ${init_mask.blocks.length / 2}`);
      }
      for (let block = start_block + 1; block < end_block_inclusive + 1; block++) {
        const i = search_block(init_mask.blocks[2 * block]!, init_mask.blocks[2 * block + 1]!, block, 0, is_init);
        if (i !== undefined) {
          // If this is the last block, we may find a matching bit after `end`.
          //
          // For example, we shouldn't successfully find bit (4), because it's after `end`:
          //
          //                               (4)
          //                         -------|
          //   (f) 00000001|00000000|00000001
          //          ^~~~~~~~~~~~~~~~~~^
          //        start              end
          //
          // As above with example (d), we could handle the end block separately and mask off end bits,
          // but unconditionally searching an entire block at once and performing this check afterwards
          // is faster and much simpler to implement.
          if (size_lt(i, end)) {
            return i;
          } else {
            return undefined;
          }
        }
      }
    }

    return undefined;
  }

  // PORT: only called by the `debug_assert_eq!` below (a comment: rustc ships without debug assertions).
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:530 find_bit_slow
  function find_bit_slow(init_mask: InitMaskMaterialized, start: Size, end: Size, is_init: boolean): Size | undefined {
    // `(start..end).find(|&i| init_mask.get(i) == is_init)`
    for (let i = start.bytes(); i < end.bytes(); i++) {
      if (init_mask.get(Size.from_bytes(i)) === is_init) return Size.from_bytes(i);
    }
    return undefined;
  }
  void find_bit_slow;

  const result = find_bit_fast(this, start, end, is_init);

  // debug_assert_eq!(
  //     result,
  //     find_bit_slow(self, start, end, is_init),
  //     "optimized implementation of find_bit is wrong for start={start:?} end={end:?} is_init={is_init} init_mask={self:#?}"
  // );

  return result;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:559 is_init
InitChunk.is_init = function (self: InitChunk): boolean {
  switch (self.$) {
    case "Init":
      return true;
    case "Uninit":
      return false;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:567 range
InitChunk.range = function (self: InitChunk): Range<Size> {
  switch (self.$) {
    case "Init":
      return { start: self._0.start, end: self._0.end };
    case "Uninit":
      return { start: self._0.start, end: self._0.end };
  }
};

/// Returns an iterator, yielding a range of byte indexes for each contiguous region
/// of initialized or uninitialized bytes inside the range `start..end` (end-exclusive).
///
/// The iterator guarantees the following:
/// - Chunks are nonempty.
/// - Chunks are adjacent (each range's start is equal to the previous range's end).
/// - Chunks span exactly `start..end` (the first starts at `start`, the last ends at `end`).
/// - Chunks alternate between [`InitChunk::Init`] and [`InitChunk::Uninit`].
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:585 range_as_init_chunks
InitMask.prototype.range_as_init_chunks = function (this: InitMask, range: AllocRange): InitChunkIter {
  const start = range.start;
  const end = range.end();
  assert(end.bytes() <= this.len.bytes(), "assertion failed: end <= self.len");

  let is_init: boolean;
  if (size_lt(start, end)) {
    is_init = this.get(start);
  } else {
    // `start..end` is empty: there are no chunks, so use some arbitrary value
    is_init = false;
  }

  return new InitChunkIter(this, is_init, start, end);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:618 next
InitChunkIter.prototype.next = function (this: InitChunkIter): IteratorResult<InitChunk> {
  if (this.start.bytes() >= this.end.bytes()) {
    return { done: true, value: undefined };
  }

  let end_of_chunk: Size;
  const blocks = this.init_mask.blocks;
  switch (blocks.$) {
    case "Lazy": {
      // If we're iterating over the chunks of lazy blocks, we just emit a single
      // full-size chunk.
      end_of_chunk = this.end;
      break;
    }
    case "Materialized": {
      const end_of_chunk_ = blocks._0.find_bit(this.start, this.end, !this.is_init) ?? this.end;
      end_of_chunk = end_of_chunk_;
      break;
    }
  }
  const range = { start: this.start, end: end_of_chunk };
  const ret: InitChunk = this.is_init ? { $: "Init", _0: range } : { $: "Uninit", _0: range };

  this.is_init = !this.is_init;
  this.start = end_of_chunk;

  return { done: false, value: ret };
};

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:657 no_bytes_init
InitCopy.prototype.no_bytes_init = function (this: InitCopy): boolean {
  // The `ranges` are run-length encoded and of alternating initialization state.
  // So if `ranges.len() > 1` then the second block is an initialized range.
  return !this.initial && this.ranges.length === 1;
};

/// Creates a run-length encoding of the initialization mask; panics if range is empty.
///
/// This is essentially a more space-efficient version of
/// `InitMask::range_as_init_chunks(...).collect::<Vec<_>>()`.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:670 prepare_copy
InitMask.prototype.prepare_copy = function (this: InitMask, range: AllocRange): InitCopy {
  // Since we are copying `size` bytes from `src` to `dest + i * size` (`for i in 0..repeat`),
  // a naive initialization mask copying algorithm would repeatedly have to read the initialization mask from
  // the source and write it to the destination. Even if we optimized the memory accesses,
  // we'd be doing all of this `repeat` times.
  // Therefore we precompute a compressed version of the initialization mask of the source value and
  // then write it back `repeat` times without computing any more information from the source.

  // A precomputed cache for ranges of initialized / uninitialized bits
  // 0000010010001110 will become
  // `[5, 1, 2, 1, 3, 3, 1]`,
  // where each element toggles the state.

  const ranges: number[] = [];

  const chunks = this.range_as_init_chunks(range);
  // PORT: `.peekable()` / `peek()`: the first chunk is taken here and pushed first below.
  const first = chunks.next();

  if (first.done) panic("range should be nonempty");
  const initial = InitChunk.is_init(first.value);

  // Here we rely on `range_as_init_chunks` to yield alternating init/uninit chunks.
  for (let chunk: IteratorResult<InitChunk> = first; !chunk.done; chunk = chunks.next()) {
    const len = InitChunk.range(chunk.value).end.bytes() - InitChunk.range(chunk.value).start.bytes();
    ranges.push(len);
  }

  return new InitCopy(initial, ranges);
};

/// Applies multiple instances of the run-length encoding to the initialization mask.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:699 apply_copy
InitMask.prototype.apply_copy = function (this: InitMask, defined: InitCopy, range: AllocRange, repeat: number): void {
  // An optimization where we can just overwrite an entire range of initialization bits if
  // they are going to be uniformly `1` or `0`. If this happens to be a full-range overwrite,
  // we won't need materialized blocks either.
  if (defined.ranges.length <= 1) {
    const start = range.start;
    const end = range.start.add(range.size.mul(repeat)); // `Size` operations
    this.set_range(AllocRange_from_Range_Size({ start, end }), defined.initial);
    return;
  }

  // We're about to do one or more partial writes, so we ensure the blocks are materialized.
  const blocks = this.materialize_blocks();

  for (let j0 = 0; j0 < repeat; j0++) {
    let j = j0;
    j *= range.size.bytes();
    j += range.start.bytes();
    let cur = defined.initial;
    for (const range of defined.ranges) {
      const old_j = j;
      j += range;
      blocks.set_range_inbounds(Size.from_bytes(old_j), Size.from_bytes(j), cur);
      cur = !cur;
    }
  }
};
