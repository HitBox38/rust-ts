//! ChaCha variant-specific configurations.
//
// Port of chacha20 =0.10.0 `src/variants.rs`, with the features rand 0.10.1 enables
// (`default-features = false, features = ["rng"]`, so `cipher` is off and `legacy` is on through `rng`).
// PORT: a variant is a table; `Self::Counter` is `number` (u32, Ietf) or `bigint` (u64, Legacy), and
// `size_of::<Self::Counter>()` is `counter_size`. `row` is the `state[12..]` view.
import { unported } from "../../std/panic.ts";

/// A trait that distinguishes some ChaCha variants. Contains configurations
/// for "Legacy" DJB variant and the IETF variant.
export interface Variant<Counter> {
  /** `size_of::<Self::Counter>()` */
  readonly counter_size: number;

  /// Gets the block pos.
  // crate: chacha20-0.10.0/src/variants.rs:20 get_block_pos
  get_block_pos(row: Uint32Array): Counter;

  /// Sets the block pos.
  // crate: chacha20-0.10.0/src/variants.rs:24 set_block_pos
  set_block_pos(row: Uint32Array, pos: Counter): void;

  /// A helper method for calculating the remaining blocks using these types
  // crate: chacha20-0.10.0/src/variants.rs:27 remaining_blocks
  remaining_blocks(block_pos: Counter): number | undefined;
}

/// IETF ChaCha configuration to use a 32-bit counter and 96-bit nonce.
// impl Variant for Ietf
export const Ietf: Variant<number> = {
  counter_size: 4,

  // crate: chacha20-0.10.0/src/variants.rs:40 get_block_pos
  get_block_pos(row: Uint32Array): number {
    return row[0]!;
  },

  // crate: chacha20-0.10.0/src/variants.rs:45 set_block_pos
  set_block_pos(row: Uint32Array, pos: number): void {
    row[0] = pos;
  },

  // crate: chacha20-0.10.0/src/variants.rs:50 remaining_blocks
  remaining_blocks(block_pos: number): number | undefined {
    const remaining = 0xffff_ffff - block_pos;
    // `remaining.try_into().ok()` (u32 -> usize always fits)
    return remaining;
  },
};

/// DJB variant specific features: 64-bit counter and 64-bit nonce.
// impl Variant for Legacy
export const Legacy: Variant<bigint> = {
  counter_size: 8,

  // crate: chacha20-0.10.0/src/variants.rs:69 get_block_pos
  get_block_pos(row: Uint32Array): bigint {
    return (BigInt(row[1]!) << 32n) | BigInt(row[0]!);
  },

  // crate: chacha20-0.10.0/src/variants.rs:74 set_block_pos
  set_block_pos(row: Uint32Array, pos: bigint): void {
    row[0] = Number(pos & 0xffff_ffffn);
    row[1] = Number((pos >> 32n) & 0xffff_ffffn);
  },

  // crate: chacha20-0.10.0/src/variants.rs:80 remaining_blocks
  remaining_blocks(block_pos: bigint): number | undefined {
    const remaining = 0xffff_ffff_ffff_ffffn - block_pos;
    // `remaining.try_into().ok()`
    // PORT: usize is `number`, which cannot hold a count above 2^53 that the 64-bit usize would. Only the
    // disabled `cipher` feature calls this.
    if (remaining > BigInt(Number.MAX_SAFE_INTEGER)) unported("chacha20 Legacy::remaining_blocks above 2^53 (usize as number)");
    return Number(remaining);
  },
};
