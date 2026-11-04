// Oracle test of what rustc_abi's `-Zrandomize-layout` shuffle runs (compiler/rustc_abi/src/layout.rs:1132-1137):
// `Xoshiro128StarStar::seed_from_u64(seed)` and `<[T]>::shuffle`.
//
// `shuffle.oracle.txt` is the output of docs/handoff/miri-tail-a-probe/ (rand =0.9.3 with default features off,
// rand_xoshiro =0.7.0, resolved through upstream's Cargo.lock, built with the pinned toolchain's cargo), which is what
// rustc_abi links. The port's shuffle comes from the vendored rand 0.10.1, so this test is also the check that
// 0.10.1's `shuffle`, `IncreasingUniform` and integer `random_range` draw what 0.9.3's do.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SliceRandom } from "../rand/seq/slice.ts";
import { Xoshiro128StarStar } from "./xoshiro128starstar.ts";

const M64 = 0xffff_ffff_ffff_ffffn;
const LINES = readFileSync(join(import.meta.dir, "shuffle.oracle.txt"), "utf8").trimEnd().split("\n");

test("the fixture is not empty", () => {
  expect(LINES.length).toBe(128);
});

test("seed_from_u64 stream equals the probe", () => {
  for (const line of LINES) {
    if (!line.startsWith("next ")) continue;
    const [, seed, words, long] = line.split(" ") as [string, string, string, string];
    const rng = Xoshiro128StarStar.seed_from_u64(BigInt(seed));
    const got = Array.from({ length: 8 }, () => rng.next_u32()).join(",");
    expect(`${seed} ${got} ${rng.next_u64()}`).toBe(`${seed} ${words} ${long}`);
  }
});

test("shuffle equals the probe", () => {
  for (const line of LINES) {
    if (!line.startsWith("shuffle ")) continue;
    const [, seed, n_] = line.split(" ") as [string, string, string];
    const n = Number(n_);
    const v = Array.from({ length: n }, (_, i) => i);
    SliceRandom.shuffle(v, Xoshiro128StarStar.seed_from_u64(BigInt(seed)));
    let h = 0n;
    for (const x of v) h = ((h * 0x100000001b3n) & M64) ^ BigInt(x);
    expect(`shuffle ${seed} ${n} ${h} ${v.slice(0, 40).join(",")}`).toBe(line);
  }
});
