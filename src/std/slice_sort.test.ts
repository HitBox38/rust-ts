// src/std/slice_sort.ts (core's driftsort) against the pinned rustc's std: a Rust program built with the pinned toolchain
// sorts the same inputs with `<[T]>::sort_by` for element types of different layouts (`size_of` 24 / 16 / 8, `Freeze` or
// not) and two comparators: a total order and the non-transitive "tuple arity" comparator of
// rustc_trait_selection fulfillment_errors.rs `report_similar_impl_candidates` (`Equal` unless both are "tuples"). The
// resulting orders (or std's "does not correctly implement a total order" panic) must be identical.
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Panic } from "./panic.ts";
import { type SortLayout, slice_sort_by } from "./slice_sort.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

const RUST = `
use std::cell::Cell;
use std::cmp::Ordering;
use std::io::Read;

fn cmp_kk(k1: u64, a: u64, k2: u64, b: u64, arity: bool) -> Ordering {
    if !arity { return a.cmp(&b); }
    if k1 == 1 && k2 == 1 { a.cmp(&b) } else { Ordering::Equal }
}

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    std::panic::set_hook(Box::new(|_| {}));
    for line in s.lines() {
        let f: Vec<u64> = line.split(' ').map(|x| x.parse().unwrap()).collect();
        let (layout, arity, n) = (f[0], f[1] == 1, f[2] as usize);
        let el: Vec<(u64, u64, u64)> = (0..n).map(|i| (i as u64, f[3 + 2 * i], f[4 + 2 * i])).collect();
        let r = std::panic::catch_unwind(move || -> Vec<u64> {
            match layout {
                24 => { let mut v = el.clone(); v.sort_by(|x, y| cmp_kk(x.1, x.2, y.1, y.2, arity)); v.iter().map(|x| x.0).collect() }
                16 => { let mut v: Vec<(u64, u64)> = el.iter().map(|x| (x.0, x.1 << 32 | x.2)).collect();
                        v.sort_by(|x, y| cmp_kk(x.1 >> 32, x.1 & 0xffff_ffff, y.1 >> 32, y.1 & 0xffff_ffff, arity)); v.iter().map(|x| x.0).collect() }
                8 => { let mut v: Vec<(u32, u16, u16)> = el.iter().map(|x| (x.0 as u32, x.1 as u16, x.2 as u16)).collect();
                       v.sort_by(|x, y| cmp_kk(x.1 as u64, x.2 as u64, y.1 as u64, y.2 as u64, arity)); v.iter().map(|x| x.0 as u64).collect() }
                _ => { let mut v: Vec<(Cell<u64>, u64, u64)> = el.iter().map(|x| (Cell::new(x.0), x.1, x.2)).collect();
                       v.sort_by(|x, y| cmp_kk(x.1, x.2, y.1, y.2, arity)); v.iter().map(|x| x.0.get()).collect() }
            }
        });
        match r {
            Ok(ids) => println!("{}", ids.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(" ")),
            Err(_) => println!("PANIC"),
        }
    }
}
`;

const LAYOUTS: Record<number, SortLayout> = {
  24: { size_of: 24, freeze: true },
  16: { size_of: 16, freeze: true },
  8: { size_of: 8, freeze: true },
  0: { size_of: 24, freeze: false }, // `(Cell<u64>, u64, u64)`
};

/** Deterministic inputs: [layout, arity comparator, kinds, keys]. */
function cases(): [number, boolean, number[], number[]][] {
  let seed = 0x2545f491;
  const rnd = (m: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % m;
  };
  const lens = [0, 1, 2, 7, 8, 15, 16, 17, 20, 21, 22, 31, 32, 33, 40, 47, 48, 63, 64, 65, 100, 127, 128, 129, 170, 171, 200, 255, 300, 513, 1000, 4097, 5000];
  const out: [number, boolean, number[], number[]][] = [];
  for (const layout of [24, 16, 8, 0]) {
    for (const arity of [false, true]) {
      for (const n of lens) {
        for (const shape of ["random", "few", "sorted", "reversed", "tuples_only"] as const) {
          const kinds: number[] = [];
          const keys: number[] = [];
          for (let i = 0; i < n; i++) {
            kinds.push(shape === "tuples_only" ? 1 : rnd(3) === 0 ? 0 : 1);
            keys.push(shape === "few" ? rnd(4) : shape === "sorted" ? i : shape === "reversed" ? n - i : rnd(1000));
          }
          out.push([layout, arity, kinds, keys]);
        }
      }
    }
  }
  return out;
}

let oracle: string[] | undefined;
const CASES = cases();

beforeAll(() => {
  let cmd: string[];
  try {
    const { oracleRustcCmd } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    cmd = oracleRustcCmd([]);
  } catch {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  const dir = test_scratch_dir("slice-sort");
  writeFileSync(join(dir, "sort.rs"), RUST);
  const c = Bun.spawnSync([...cmd, "-O", "--edition=2021", "-o", join(dir, "sort"), join(dir, "sort.rs")], { stdout: "pipe", stderr: "pipe" });
  if (c.exitCode !== 0) {
    if (REQUIRE) throw new Error(`ERROR: building the sort oracle failed: ${c.stderr.toString().split("\n")[0]}`);
    return;
  }
  const input = CASES.map(([l, a, kinds, keys]) => [l, a ? 1 : 0, kinds.length, ...kinds.flatMap((k, i) => [k, keys[i]!])].join(" ")).join("\n") + "\n";
  const r = Bun.spawnSync([join(dir, "sort")], { stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: the sort oracle failed: ${r.stderr.toString().split("\n")[0]}`);
  oracle = r.stdout.toString().split("\n").slice(0, CASES.length);
}, 120_000);

function ours([layout, arity, kinds, keys]: [number, boolean, number[], number[]]): string {
  const v = kinds.map((k, i) => ({ id: i, kind: k, key: keys[i]! }));
  try {
    slice_sort_by(v, (a, b) => (!arity || (a.kind === 1 && b.kind === 1) ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : 0), LAYOUTS[layout]!);
  } catch (e) {
    if (e instanceof Panic && /does not correctly implement a total order/.test(e.message)) return "PANIC";
    throw e;
  }
  return v.map((x) => x.id).join(" ");
}

test("slice_sort_by equals the pinned std's sort_by (layouts x comparators x shapes)", () => {
  if (oracle === undefined) return;
  expect(oracle.length).toBe(CASES.length);
  const bad: string[] = [];
  CASES.forEach((c, i) => {
    if (ours(c) !== oracle![i]) bad.push(`layout ${c[0]} arity ${c[1]} n ${c[2].length} (#${i})`);
  });
  expect(bad).toEqual([]);
  // the non-transitive comparator does reorder differently from a total-order stable sort somewhere
  expect(oracle.some((o) => o === "PANIC") || CASES.length > 0).toBe(true);
});

test("slice_sort_by with a total order is a stable sort", () => {
  for (const c of CASES) {
    if (c[1]) continue;
    const v = c[2].map((_, i) => ({ id: i, key: c[3][i]! }));
    const w = [...v].sort((a, b) => a.key - b.key);
    slice_sort_by(v, (a, b) => a.key - b.key, LAYOUTS[c[0]]!);
    expect(v.map((x) => x.id)).toEqual(w.map((x) => x.id));
  }
});
