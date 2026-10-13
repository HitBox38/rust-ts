// rust-ts: FxHashMap / FxHashSet iteration order (src/rust_ts/hash_map.ts over the vendored
// hashbrown 0.17.1 + rustc-hash 2.1.1) against the oracle compiler's own
// `rustc_data_structures::fx` maps, driven by the `fxorder` rustc-dev probe
// (tools/probes/fxorder/main.rs) through random scripts of inserts, removals, reserve/shrink,
// clear, clone, retain, extend and collect over u32 / String / Symbol / u8 keys
// (hash_map_oracle/scripts.ts).
//
// - The committed fixture (hash_map_oracle/fx_order.txt: digests of the probe's answers to
//   `gen(FIXTURE_SEED, FIXTURE_COUNT)`) is always replayed.
// - More scripts (other seeds) go to the live probe: a visible skip if it isn't built, a failure
//   under RUST_TS_REQUIRE_PROBES=1 (gate hosts build the probes).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAIN, PRETTY, debug_int, debug_str } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { clone_HashMap, FxHashMap, FxHashSet, LAYOUT_USIZE, String_key, debug_HashMap, debug_HashSet, u32_key } from "./hash_map.ts";
import { FIXTURE_COUNT, FIXTURE_SEED, PROBE, digest, gen, probe, replay } from "./hash_map_oracle/scripts.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: fxorder probe not built (bun scripts/probes.ts build fxorder); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

/** Index and both answers of the first mismatch, or undefined. */
function first_mismatch(scripts: readonly string[], want: readonly string[], got: readonly string[]): string | undefined {
  for (let i = 0; i < scripts.length; i++) {
    if (got[i] !== want[i]) return `script ${i}: ${scripts[i]!.slice(0, 200)}\n  oracle ${want[i]!.slice(0, 200)}\n  port   ${got[i]!.slice(0, 200)}`;
  }
  return undefined;
}

test("fixture: the port's iteration orders hash to the probe's (fx_order.txt)", () => {
  const lines = readFileSync(join(import.meta.dir, "hash_map_oracle", "fx_order.txt"), "utf8")
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#"));
  expect(lines.length).toBe(FIXTURE_COUNT);
  const scripts = gen(FIXTURE_SEED, FIXTURE_COUNT);
  const got = replay(scripts).map(digest);
  const bad: string[] = [];
  for (let i = 0; i < scripts.length; i++) if (got[i] !== lines[i] && bad.length < 3) bad.push(`script ${i}: ${scripts[i]!.slice(0, 200)}`);
  expect(bad).toEqual([]);
}, 120_000);

for (const seed of [2, 3]) {
  test.skipIf(SKIP)(`live probe: 2000 scripts (seed ${seed}) match the oracle`, () => {
    const scripts = gen(seed, 2000);
    const want = probe(scripts);
    expect(want.length).toBe(scripts.length);
    expect(first_mismatch(scripts, want, replay(scripts))).toBeUndefined();
  }, 120_000);
}

test("FxHashMap keeps the Map API in sync with the table", () => {
  const m = FxHashMap.default<string, number>(String_key, LAYOUT_USIZE);
  for (let i = 0; i < 100; i++) m.set(`k${i}`, i);
  for (let i = 0; i < 100; i += 3) m.delete(`k${i}`);
  m.set("k1", 1001);
  m.retain((k, v) => v % 5 !== 0);
  expect(m.size).toBe(m.base.len());
  expect(m.get("k1")).toBe(1001);
  expect(m.has("k3")).toBe(false);
  expect(new Set(m.keys())).toEqual(new Set([...Map.prototype.keys.call(m)]));
  for (const [k, v] of m) expect(Map.prototype.get.call(m, k)).toBe(v);
  const c = m.clone();
  expect([...c]).toEqual([...m]);
  const c2 = clone_HashMap(m, (k) => k, (v) => v + 1);
  expect(c2 instanceof FxHashMap).toBe(true);
  expect([...c2].map(([k]) => k)).toEqual([...m.keys()]);
  m.clear();
  expect(m.size).toBe(0);
  expect([...m]).toEqual([]);
});

test("debug_HashMap / debug_HashSet: Fx collections in bucket order, plain ones only up to one entry", () => {
  // FxHashMap<u32, usize> {1, 2, 3} iterates 2, 3, 1 in the oracle (fxorder `u32 +1 +2 +3`).
  const m = FxHashMap.default<number, number>(u32_key, LAYOUT_USIZE);
  m.set(1, 10).set(2, 20).set(3, 30);
  expect(debug_HashMap(m, PLAIN, debug_int, debug_int)).toBe("{2: 20, 3: 30, 1: 10}");
  expect(debug_HashMap(m, PRETTY, debug_int, debug_int)).toBe("{\n    2: 20,\n    3: 30,\n    1: 10,\n}");
  const s = FxHashSet.default<string>(String_key);
  s.add("");
  s.add("a");
  s.add("ab");
  // fxorder `str +_ +61 +6162` iterates "", "a", "ab".
  expect(debug_HashSet(s, PLAIN, debug_str)).toBe('{"", "a", "ab"}');
  expect(debug_HashMap(new Map([[1, 2]]), PLAIN, debug_int, debug_int)).toBe("{1: 2}");
  expect(() => debug_HashMap(new Map([[1, 2], [3, 4]]), PLAIN, debug_int, debug_int)).toThrow(Unported);
  expect(() => debug_HashSet(new Set([1, 2]), PLAIN, debug_int)).toThrow(Unported);
});
