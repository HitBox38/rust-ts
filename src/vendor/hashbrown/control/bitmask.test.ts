// Lane perf-intern: `u64_trailing_zeros` / `u64_leading_zeros` take a 32-bit-halves fast path for a u64; it must
// give what the bit loops give (the loops below are the first version, verbatim).
import { expect, test } from "bun:test";
import { u64_leading_zeros, u64_trailing_zeros } from "./bitmask.ts";

function trailing_zeros_loop(x: bigint): number {
  if (x === 0n) return 64;
  let n = 0;
  while ((x & 1n) === 0n) {
    x >>= 1n;
    n++;
  }
  return n;
}

function leading_zeros_loop(x: bigint): number {
  let n = 64;
  while (x !== 0n) {
    x >>= 1n;
    n--;
  }
  return n;
}

function values(): bigint[] {
  const out: bigint[] = [0n, 1n, 0xffff_ffffn, 0x1_0000_0000n, 0xffff_ffff_ffff_ffffn, 0x8080_8080_8080_8080n];
  for (let i = 0n; i < 64n; i++) {
    out.push(1n << i, (1n << i) - 1n, 0xffff_ffff_ffff_ffffn ^ ((1n << i) - 1n), (1n << i) | 1n, (1n << i) | (1n << 63n));
  }
  // a fixed xorshift sequence: random u64s, and random bytes masked like the group matches (0x80 per lane)
  let s = 0x9e37_79b9_7f4a_7c15n;
  for (let i = 0; i < 20_000; i++) {
    s ^= (s << 13n) & 0xffff_ffff_ffff_ffffn;
    s ^= s >> 7n;
    s ^= (s << 17n) & 0xffff_ffff_ffff_ffffn;
    out.push(s, s & 0x8080_8080_8080_8080n, s >> BigInt(i % 64));
  }
  return out;
}

test("u64_trailing_zeros / u64_leading_zeros equal the bit loops on u64 values", () => {
  for (const x of values()) {
    expect([x, u64_trailing_zeros(x)]).toEqual([x, trailing_zeros_loop(x)]);
    expect([x, u64_leading_zeros(x)]).toEqual([x, leading_zeros_loop(x)]);
  }
});
