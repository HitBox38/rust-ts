// Port of odht =0.3.1 `src/unhash.rs`.

import type { HashFn } from "./lib.ts";
import { panic } from "../../std/panic.ts";

/// A hash function that simply takes the last 4 bytes of a given key as the
/// hash value.
// #[derive(Eq, PartialEq)]
export const UnHashFn: HashFn = {
  type_name: "odht::unhash::UnHashFn",

  // crate: odht-0.3.1/src/unhash.rs:11 hash
  hash(bytes: Uint8Array): number {
    const len = bytes.length;
    // `u32::from_le_bytes(bytes[len - 4..].try_into().unwrap())`
    // PORT: keys shorter than 4 bytes: `len - 4` wraps (release build, no overflow checks) and the
    // slice index panics.
    if (len < 4) panic(`range start index ${(1n << 64n) - 4n + BigInt(len)} out of range for slice of length ${len}`);
    const b = bytes.subarray(len - 4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  },
};
