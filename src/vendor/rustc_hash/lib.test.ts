// Port of the `#[cfg(test)] mod tests` of rustc-hash =2.1.1 `src/lib.rs` (64-bit expectations).
//
// PORT: `test_hash! { hash(v) == r, }` is `FxBuildHasher.hash_one(v)`; the value's `Hash` impl is
// spelled out per integer type (`u8` -> `write_u8`, `i8` -> `write_i8`, ...).
import { expect, test } from "bun:test";
import type { Hasher } from "../rustc_stable_hash/stable_hasher.ts";
import { FxBuildHasher, FxHasher, hash_one, type HashFn } from "./lib.ts";

const B32 = false; // cfg!(target_pointer_width = "32")

const u8_: HashFn<number> = (v, h) => h.write_u8(v);
const u16_: HashFn<number> = (v, h) => h.write_u16(v);
const u32_: HashFn<number> = (v, h) => h.write_u32(v);
const u64_: HashFn<bigint> = (v, h) => h.write_u64(v);
const u128_: HashFn<bigint> = (v, h) => h.write_u128(v);
const usize_: HashFn<bigint> = (v, h) => h.write_u64(v); // usize::MAX does not fit a `number`
const i8_: HashFn<number> = (v, h) => h.write_i8(v);
const i16_: HashFn<number> = (v, h) => h.write_i16(v);
const i32_: HashFn<number> = (v, h) => h.write_i32(v);
const i64_: HashFn<bigint> = (v, h) => h.write_i64(v);
const i128_: HashFn<bigint> = (v, h) => h.write_i128(v);
const isize_: HashFn<bigint> = (v, h) => h.write_i64(v);

function hash<T>(v: T, f: HashFn<T>): bigint {
  return hash_one(FxBuildHasher, v, f);
}

// crate: rustc-hash-2.1.1/src/lib.rs:339 unsigned
test("unsigned", () => {
  expect(hash(0, u8_)).toBe(0n);
  expect(hash(1, u8_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100, u8_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash(0xff, u8_)).toBe(B32 ? 999399879n : 1211781028898739645n);

  expect(hash(0, u16_)).toBe(0n);
  expect(hash(1, u16_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100, u16_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash(0xffff, u16_)).toBe(B32 ? 3440503042n : 16279819243059860173n);

  expect(hash(0, u32_)).toBe(0n);
  expect(hash(1, u32_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100, u32_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash(0xffff_ffff, u32_)).toBe(B32 ? 1293006356n : 7729994835221066939n);

  expect(hash(0n, u64_)).toBe(0n);
  expect(hash(1n, u64_)).toBe(B32 ? 275023839n : 12157901119326311915n);
  expect(hash(100n, u64_)).toBe(B32 ? 1732383522n : 16751747135202103309n);
  expect(hash((1n << 64n) - 1n, u64_)).toBe(B32 ? 1017982517n : 6288842954450348564n);

  expect(hash(0n, u128_)).toBe(0n);
  expect(hash(1n, u128_)).toBe(B32 ? 1860738631n : 13032756267696824044n);
  expect(hash(100n, u128_)).toBe(B32 ? 1389515751n : 12003541609544029302n);
  expect(hash((1n << 128n) - 1n, u128_)).toBe(B32 ? 2156022013n : 11702830760530184999n);

  expect(hash(0n, usize_)).toBe(0n);
  expect(hash(1n, usize_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100n, usize_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash((1n << 64n) - 1n, usize_)).toBe(B32 ? 1293006356n : 6288842954450348564n);
});

// crate: rustc-hash-2.1.1/src/lib.rs:374 signed
test("signed", () => {
  expect(hash(-128, i8_)).toBe(B32 ? 2000713177n : 6684841074112525780n);
  expect(hash(0, i8_)).toBe(0n);
  expect(hash(1, i8_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100, i8_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash(127, i8_)).toBe(B32 ? 3293686765n : 12973684028562874344n);

  expect(hash(-32768, i16_)).toBe(B32 ? 1073764727n : 14218860181193086044n);
  expect(hash(0, i16_)).toBe(0n);
  expect(hash(1, i16_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100, i16_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash(32767, i16_)).toBe(B32 ? 2366738315n : 2060959061933882993n);

  expect(hash(-2147483648, i32_)).toBe(B32 ? 16384n : 9943947977240134995n);
  expect(hash(0, i32_)).toBe(0n);
  expect(hash(1, i32_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100, i32_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash(2147483647, i32_)).toBe(B32 ? 1293022740n : 16232790931690483559n);

  expect(hash(-(1n << 63n), i64_)).toBe(B32 ? 16384n : 33554432n);
  expect(hash(0n, i64_)).toBe(0n);
  expect(hash(1n, i64_)).toBe(B32 ? 275023839n : 12157901119326311915n);
  expect(hash(100n, i64_)).toBe(B32 ? 1732383522n : 16751747135202103309n);
  expect(hash((1n << 63n) - 1n, i64_)).toBe(B32 ? 1017998901n : 6288842954483902996n);

  expect(hash(-(1n << 127n), i128_)).toBe(B32 ? 16384n : 33554432n);
  expect(hash(0n, i128_)).toBe(0n);
  expect(hash(1n, i128_)).toBe(B32 ? 1860738631n : 13032756267696824044n);
  expect(hash(100n, i128_)).toBe(B32 ? 1389515751n : 12003541609544029302n);
  expect(hash((1n << 127n) - 1n, i128_)).toBe(B32 ? 2156005629n : 11702830760496630567n);

  expect(hash(-(1n << 63n), isize_)).toBe(B32 ? 16384n : 33554432n);
  expect(hash(0n, isize_)).toBe(0n);
  expect(hash(1n, isize_)).toBe(B32 ? 3001993707n : 12157901119326311915n);
  expect(hash(100n, isize_)).toBe(B32 ? 3844759569n : 16751747135202103309n);
  expect(hash((1n << 63n) - 1n, isize_)).toBe(B32 ? 1293022740n : 6288842954483902996n);
});

// Avoid relying on any `Hash` implementations in the standard library.
// crate: rustc-hash-2.1.1/src/lib.rs:417 hash
const HashBytes: HashFn<Uint8Array> = (v: Uint8Array, state: Hasher) => {
  state.write(v);
};

// crate: rustc-hash-2.1.1/src/lib.rs:423 bytes
test("bytes", () => {
  const b = (s: string) => new TextEncoder().encode(s);
  expect(hash(new Uint8Array([]), HashBytes)).toBe(B32 ? 2673204745n : 17606491139363777937n);
  expect(hash(new Uint8Array([0]), HashBytes)).toBe(B32 ? 2948228584n : 5448590020104574886n);
  expect(hash(new Uint8Array([0, 0, 0, 0, 0, 0]), HashBytes)).toBe(B32 ? 3223252423n : 16766921560080789783n);
  expect(hash(new Uint8Array([1]), HashBytes)).toBe(B32 ? 2943445104n : 5922447956811044110n);
  expect(hash(new Uint8Array([2]), HashBytes)).toBe(B32 ? 1055423297n : 5229781508510959783n);
  expect(hash(b("uwu"), HashBytes)).toBe(B32 ? 2699662140n : 7168164714682931527n);
  expect(hash(b("These are some bytes for testing rustc_hash."), HashBytes)).toBe(B32 ? 2303640537n : 2349210501944688211n);
});

// crate: rustc-hash-2.1.1/src/lib.rs:436 with_seed_actually_different
test("with_seed_actually_different", () => {
  const seeds: [bigint, bigint][] = [
    [1n, 2n],
    [42n, 17n],
    [124436707n, 99237n],
    [0n, (1n << 64n) - 1n],
  ];

  for (const [a_seed, b_seed] of seeds) {
    const a = () => FxHasher.with_seed(a_seed);
    const b = () => FxHasher.with_seed(b_seed);

    for (let x = 0; x <= 0xff; x++) {
      const a_ = a();
      const b_ = b();

      a_.write_u8(x);
      b_.write_u8(x);

      expect(a_.finish_u64()).not.toBe(b_.finish_u64());
    }
  }
});
