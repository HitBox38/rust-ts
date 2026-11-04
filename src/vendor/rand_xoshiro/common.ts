// Port of rand_xoshiro =0.7.0 `src/common.rs`: the macros Xoshiro128StarStar uses, as functions. The other generators'
// macros and `Seed512` are not ported (rustc_abi uses only Xoshiro128StarStar).
//
// PORT: rand_xoshiro 0.7.0 builds on rand_core 0.9.3, whose `impls` and `le` helpers are here too (`fill_bytes_via_next`,
// `next_u64_via_u32`, `read_u32_into`, `read_u64_into`). harness/scope.json holds one version per crate and rand_core is
// there at 0.10.1 for Miri, so these carry no `crate:` marker: each names its rand_core 0.9.3 file and line.
import type { Rng } from "../rand_core/lib.ts";

const M64 = 0xffff_ffff_ffff_ffffn;

/// Apply the ** scrambler used by some RNGs from the xoshiro family.
/** `starstar_u64!($x)` (common.rs:18) on a `u32`, as Xoshiro128StarStar uses it. */
export function starstar_u64(x: number): number {
  const m = Math.imul(x, 5);
  return Math.imul((m << 7) | (m >>> 25), 9) >>> 0;
}

/// Implement the xoshiro iteration for `u32` output.
/** `impl_xoshiro_u32!($self)` (common.rs:174). */
export function impl_xoshiro_u32(self: { s: number[] }): void {
  const s = self.s;
  const t = s[1]! << 9;

  s[2]! ^= s[0]!;
  s[3]! ^= s[1]!;
  s[1]! ^= s[2]!;
  s[0]! ^= s[3]!;

  s[2]! ^= t;

  s[3] = (s[3]! << 11) | (s[3]! >>> 21);

  for (let i = 0; i < 4; i++) s[i] = s[i]! >>> 0;
}

/** `impl_jump!(u32, $self, [$j0, $j1, $j2, $j3])` (common.rs:46, the four-word arm). */
export function impl_jump_u32_4(self: { s: number[]; next_u32(): number }, JUMP: readonly [number, number, number, number]): void {
  const s_ = [0, 0, 0, 0];
  for (const j of JUMP) {
    for (let b = 0; b < 32; b++) {
      if ((j & (1 << b)) !== 0) {
        s_[0]! ^= self.s[0]!;
        s_[1]! ^= self.s[1]!;
        s_[2]! ^= self.s[2]!;
        s_[3]! ^= self.s[3]!;
      }
      self.next_u32();
    }
  }
  self.s = s_.map((x) => x >>> 0);
}

/** `rand_core::impls::next_u64_via_u32` (rand_core-0.9.3/src/impls.rs:23). */
export function next_u64_via_u32(rng: Rng): bigint {
  // Use LE; we explicitly generate one value before the next.
  const x = BigInt(rng.next_u32());
  const y = BigInt(rng.next_u32());
  return (y << 32n) | x;
}

/** `rand_core::impls::fill_bytes_via_next` (rand_core-0.9.3/src/impls.rs:36). */
export function fill_bytes_via_next(rng: Rng, dest: Uint8Array): void {
  let at = 0;
  const view = new DataView(new ArrayBuffer(8));
  while (dest.length - at >= 8) {
    view.setBigUint64(0, rng.next_u64() & M64, /* littleEndian */ true);
    dest.set(new Uint8Array(view.buffer), at);
    at += 8;
  }
  const n = dest.length - at;
  if (n > 4) {
    view.setBigUint64(0, rng.next_u64() & M64, true);
    dest.set(new Uint8Array(view.buffer).subarray(0, n), at);
  } else if (n > 0) {
    view.setUint32(0, rng.next_u32(), true);
    dest.set(new Uint8Array(view.buffer).subarray(0, n), at);
  }
}

/** `rand_core::le::read_u32_into` (rand_core-0.9.3/src/le.rs:21). */
export function read_u32_into(src: Uint8Array, dst: number[]): void {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < dst.length; i++) dst[i] = view.getUint32(4 * i, /* littleEndian */ true);
}

/** `rand_core::le::read_u64_into` (rand_core-0.9.3/src/le.rs:35). */
export function read_u64_into(src: Uint8Array, dst: bigint[]): void {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < dst.length; i++) dst[i] = view.getBigUint64(8 * i, /* littleEndian */ true);
}
