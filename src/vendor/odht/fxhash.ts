// Port of odht =0.3.1 `src/fxhash.rs`.
//
// PORT: the u64 hash state is a `bigint` kept in 0..2^64; the result (`hash_value as u32`) is a
// `number`.

import type { HashFn } from "./lib.ts";

const U64_MASK = (1n << 64n) - 1n;

/// Implements the hash function from the rustc-hash crate.
// #[derive(Eq, PartialEq)]
export const FxHashFn: HashFn = {
  type_name: "odht::fxhash::FxHashFn",

  // This function is marked as #[inline] because that allows LLVM to know the
  // actual size of `bytes` and thus eliminate all unneeded branches below.
  // crate: odht-0.3.1/src/fxhash.rs:12 hash
  hash(bytes: Uint8Array): number {
    let hash_value = 0n;

    while (bytes.length >= 8) {
      hash_value = add_to_hash(hash_value, read_u64(bytes));
      bytes = bytes.subarray(8);
    }

    if (bytes.length >= 4) {
      hash_value = add_to_hash(hash_value, BigInt(u32_from_le_bytes(bytes.subarray(0, 4))));
      bytes = bytes.subarray(4);
    }

    if (bytes.length >= 2) {
      hash_value = add_to_hash(hash_value, BigInt(bytes[0]! | (bytes[1]! << 8)));
      bytes = bytes.subarray(2);
    }

    if (bytes.length >= 1) {
      hash_value = add_to_hash(hash_value, BigInt(bytes[0]!));
    }

    return Number(hash_value & 0xffff_ffffn);

    // crate: odht-0.3.1/src/fxhash.rs:43 add_to_hash
    function add_to_hash(current_hash: bigint, value: bigint): bigint {
      // `current_hash.rotate_left(5).bitxor(value).wrapping_mul(0x517cc1b727220a95)`
      const rotated = ((current_hash << 5n) | (current_hash >> 59n)) & U64_MASK;
      // This constant is part of FxHash's definition:
      // https://github.com/rust-lang/rustc-hash/blob/5e09ea0a1/src/lib.rs#L67
      return ((rotated ^ value) * 0x517cc1b727220a95n) & U64_MASK;
    }

    // crate: odht-0.3.1/src/fxhash.rs:54 read_u64
    function read_u64(bytes: Uint8Array): bigint {
      // `u64::from_le_bytes(bytes[..8].try_into().unwrap())`
      return BigInt(u32_from_le_bytes(bytes.subarray(0, 4))) | (BigInt(u32_from_le_bytes(bytes.subarray(4, 8))) << 32n);
    }
  },
};

/** `u32::from_le_bytes(bytes[..4].try_into().unwrap())` */
function u32_from_le_bytes(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}
