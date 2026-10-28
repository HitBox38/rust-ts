// Oracle tests for vendored polonius-engine 0.13.0 + datafrog 2.0.1 (lane polonius-legacy), against the oracle
// toolchain's own copies of both crates through the `polonius` rustc-dev probe (tools/probes/polonius):
//   - facts: seeded random `AllFacts` (CFG-shaped sets with placeholders, moves and drops, plus unstructured
//     ones), each run with every `Algorithm` and with `dump_enabled` off and on: every `Output` field
//     (maps sorted by key; `Vec` values in their order; `BTreeSet` / `BTreeMap` in key order) is identical,
//     and so is any panic message.
//   - reach: datafrog's `reachable_with_var_join` (src/test.rs) of random edge sets.
// Without the probe the oracle tests are a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Panic } from "../../std/panic.ts";
import { Iteration, Relation } from "../datafrog/lib.ts";
import { Algorithm, AllFacts, type FactTypes, Output } from "./lib.ts";
import type { BTreeMap, BTreeSet } from "./output/mod.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "polonius");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: polonius probe not built (bun scripts/probes.ts build polonius); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

interface F extends FactTypes {
  Origin: number;
  Loan: number;
  Point: number;
  Variable: number;
  Path: number;
}

type Tup = readonly number[];
type Facts = Record<string, Tup[]>;

const FIELDS = [
  "loan_issued_at",
  "universal_region",
  "cfg_edge",
  "loan_killed_at",
  "subset_base",
  "loan_invalidated_at",
  "var_used_at",
  "var_defined_at",
  "var_dropped_at",
  "use_of_var_derefs_origin",
  "drop_of_var_derefs_origin",
  "child_path",
  "path_is_var",
  "path_assigned_at_base",
  "path_moved_at_base",
  "path_accessed_at_base",
  "known_placeholder_subset",
  "placeholder",
] as const;

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random fact set: `structured` ones look like rustc's (a CFG, placeholders on universal regions, ...). */
function gen_facts(seed: number): Facts {
  const r = rng(seed);
  const int = (n: number) => Math.floor(r() * n);
  const structured = seed % 4 !== 3;
  const P = 2 + int(structured ? 24 : 10);
  const O = 1 + int(7);
  const L = 1 + int(6);
  const V = 1 + int(5);
  const Pa = 1 + int(7);
  const many = (n: number, f: () => Tup): Tup[] => Array.from({ length: int(n + 1) }, f);
  const f: Facts = {};
  for (const k of FIELDS) f[k] = [];
  if (structured) {
    // a mostly-forward CFG with a few back edges and branches
    for (let p = 0; p + 1 < P; p++) if (r() < 0.9) f.cfg_edge!.push([p, p + 1]);
    for (let i = int(4); i > 0; i--) f.cfg_edge!.push([int(P), int(P)]);
    const U = int(Math.min(O, 4) + 1);
    for (let o = 0; o < U; o++) {
      f.universal_region!.push([o]);
      f.placeholder!.push([o, L + o]);
    }
    for (let i = int(3); i > 0 && U > 0; i--) f.known_placeholder_subset!.push([int(U), int(U)]);
    f.loan_issued_at = many(4, () => [int(O), int(L), int(P)]);
    f.subset_base = many(10, () => [int(O), int(O), int(P)]);
    f.loan_killed_at = many(3, () => [int(L), int(P)]);
    f.loan_invalidated_at = many(6, () => [int(P), int(L + U)]);
    f.var_used_at = many(8, () => [int(V), int(P)]);
    f.var_defined_at = many(6, () => [int(V), int(P)]);
    f.var_dropped_at = many(4, () => [int(V), int(P)]);
    f.use_of_var_derefs_origin = many(6, () => [int(V), int(O)]);
    f.drop_of_var_derefs_origin = many(4, () => [int(V), int(O)]);
    for (let p = 1; p < Pa; p++) if (r() < 0.6) f.child_path!.push([p, int(p)]);
    for (let p = 0; p < Pa; p++) f.path_is_var!.push([p, int(V)]);
    f.path_assigned_at_base = many(6, () => [int(Pa), int(P)]);
    f.path_moved_at_base = many(4, () => [int(Pa), int(P)]);
    f.path_accessed_at_base = many(6, () => [int(Pa), int(P)]);
  } else {
    for (const k of FIELDS) {
      const arity = k === "universal_region" ? 1 : k === "loan_issued_at" || k === "subset_base" ? 3 : 2;
      f[k] = many(8, () => Array.from({ length: arity }, () => int(Math.max(P, O, L, V, Pa))));
    }
  }
  return f;
}

function facts_line(algorithm: Algorithm, dump: boolean, f: Facts): string {
  const fields = FIELDS.map((k) => `${k}=${f[k]!.length === 0 ? "-" : f[k]!.map((t) => t.join(".")).join(",")}`);
  return `facts ${algorithm} ${dump ? 1 : 0} ${fields.join(" ")}`;
}

function to_all_facts(f: Facts): AllFacts<F> {
  const a = AllFacts.default<F>();
  const two = (k: string) => f[k]!.map((t) => [t[0]!, t[1]!] as const);
  const three = (k: string) => f[k]!.map((t) => [t[0]!, t[1]!, t[2]!] as const);
  a.loan_issued_at = three("loan_issued_at");
  a.universal_region = f.universal_region!.map((t) => t[0]!);
  a.cfg_edge = two("cfg_edge");
  a.loan_killed_at = two("loan_killed_at");
  a.subset_base = three("subset_base");
  a.loan_invalidated_at = two("loan_invalidated_at");
  a.var_used_at = two("var_used_at");
  a.var_defined_at = two("var_defined_at");
  a.var_dropped_at = two("var_dropped_at");
  a.use_of_var_derefs_origin = two("use_of_var_derefs_origin");
  a.drop_of_var_derefs_origin = two("drop_of_var_derefs_origin");
  a.child_path = two("child_path");
  a.path_is_var = two("path_is_var");
  a.path_assigned_at_base = two("path_assigned_at_base");
  a.path_moved_at_base = two("path_moved_at_base");
  a.path_accessed_at_base = two("path_accessed_at_base");
  a.known_placeholder_subset = two("known_placeholder_subset");
  a.placeholder = two("placeholder");
  return a;
}

const sorted_keys = <V>(m: ReadonlyMap<number, V>) => [...m.keys()].sort((a, b) => a - b);
const vec_map = (m: ReadonlyMap<number, readonly number[]>) => sorted_keys(m).map((k) => `${k}:${m.get(k)!.join(",")}`).join(";");
const set_map = (m: ReadonlyMap<number, BTreeSet<number>>) => sorted_keys(m).map((k) => `${k}:${m.get(k)!.iter().join(",")}`).join(";");
const pair_set_map = (m: ReadonlyMap<number, BTreeSet<readonly [number, number]>>) =>
  sorted_keys(m)
    .map((k) => `${k}:${m.get(k)!.iter().map(([a, b]) => `${a}.${b}`).join(",")}`)
    .join(";");
const btree_map = (m: ReadonlyMap<number, BTreeMap<number, BTreeSet<number>>>) =>
  sorted_keys(m)
    .map((k) =>
      `${k}:${m
        .get(k)!
        .iter()
        .map(([k2, s]) => `${k2}=${s.iter().join(",")}`)
        .join("/")}`,
    )
    .join(";");

function run_facts(algorithm: Algorithm, dump: boolean, f: Facts): string {
  let o: Output<F>;
  try {
    o = Output.compute(to_all_facts(f), algorithm, dump);
  } catch (e) {
    if (e instanceof Panic) return `panic ${e.message}`;
    throw e;
  }
  return [
    `errors=${vec_map(o.errors)}`,
    `subset_errors=${pair_set_map(o.subset_errors)}`,
    `move_errors=${vec_map(o.move_errors)}`,
    `loan_live_at=${vec_map(o.loan_live_at)}`,
    `origin_contains_loan_at=${btree_map(o.origin_contains_loan_at)}`,
    `origin_contains_loan_anywhere=${set_map(o.origin_contains_loan_anywhere)}`,
    `origin_live_on_entry=${vec_map(o.origin_live_on_entry)}`,
    `loan_invalidated_at=${vec_map(o.loan_invalidated_at)}`,
    `subset=${btree_map(o.subset)}`,
    `subset_anywhere=${set_map(o.subset_anywhere)}`,
    `var_live_on_entry=${vec_map(o.var_live_on_entry)}`,
    `var_drop_live_on_entry=${vec_map(o.var_drop_live_on_entry)}`,
    `path_maybe_initialized_on_exit=${vec_map(o.path_maybe_initialized_on_exit)}`,
    `path_maybe_uninitialized_on_exit=${vec_map(o.path_maybe_uninitialized_on_exit)}`,
    `known_contains=${set_map(o.known_contains)}`,
    `var_maybe_partly_initialized_on_exit=${vec_map(o.var_maybe_partly_initialized_on_exit)}`,
  ].join(" ");
}

/** datafrog-2.0.1/src/test.rs `reachable_with_var_join` (as the probe runs it). */
function reach(edges_: readonly (readonly [number, number])[]): string {
  const edges = Relation.collect(edges_);
  const iteration = Iteration.new();
  const edges_by_successor = iteration.variable<readonly [number, number]>("edges_invert");
  edges_by_successor.extend(edges.iter().map(([n1, n2]) => [n2, n1] as const));
  const reachable = iteration.variable<readonly [number, number]>("reachable");
  reachable.insert(edges);
  while (iteration.changed()) {
    reachable.from_join(reachable, edges_by_successor, (_, n3, n1) => [n1, n3]);
  }
  return reachable
    .complete()
    .elements.map(([a, b]) => `${a}.${b}`)
    .join(",");
}

function probe(lines: string[]): string[] {
  const r = spawnSync(PROBE, [], { input: lines.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`polonius probe exited ${r.status}: ${r.stderr}`);
  return r.stdout.split("\n").slice(0, lines.length);
}

const ALGORITHMS: Algorithm[] = ["Naive", "DatafrogOpt", "LocationInsensitive", "Compare", "Hybrid"];
const CASES = 400;

test.skipIf(SKIP)("Output::compute equals the oracle's polonius-engine (all algorithms, dump off/on)", () => {
  const cases: { algorithm: Algorithm; dump: boolean; f: Facts; seed: number }[] = [];
  for (let seed = 0; seed < CASES; seed++) {
    const f = gen_facts(seed);
    for (const algorithm of ALGORITHMS) for (const dump of [false, true]) cases.push({ algorithm, dump, f, seed });
  }
  const expected = probe(cases.map((c) => facts_line(c.algorithm, c.dump, c.f)));
  let nonempty_errors = 0;
  let nonempty_subset_errors = 0;
  let nonempty_move_errors = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const got = run_facts(c.algorithm, c.dump, c.f);
    if (got !== expected[i]) {
      expect(got, `seed ${c.seed} ${c.algorithm} dump=${c.dump}: ${facts_line(c.algorithm, c.dump, c.f)}`).toBe(expected[i]!);
    }
    if (!got.startsWith("errors= ")) nonempty_errors++;
    if (!got.includes(" subset_errors= ")) nonempty_subset_errors++;
    if (!got.includes(" move_errors= ")) nonempty_move_errors++;
  }
  // The generator must exercise the interesting paths.
  expect(nonempty_errors).toBeGreaterThan(cases.length / 10);
  expect(nonempty_subset_errors).toBeGreaterThan(cases.length / 20);
  expect(nonempty_move_errors).toBeGreaterThan(cases.length / 10);
}, 120_000);

test.skipIf(SKIP)("datafrog reachable_with_var_join equals the oracle's datafrog", () => {
  const sets: (readonly [number, number])[][] = [];
  for (let seed = 0; seed < 100; seed++) {
    const r = rng(0xdf_0000 + seed);
    const n = Math.floor(r() * 200);
    const range = 1 + Math.floor(r() * 60);
    sets.push(Array.from({ length: n }, () => [Math.floor(r() * range), Math.floor(r() * range)] as const));
  }
  const expected = probe(sets.map((s) => `reach ${s.length === 0 ? "-" : s.map(([a, b]) => `${a}.${b}`).join(",")}`));
  for (let i = 0; i < sets.length; i++) expect(reach(sets[i]!), `set ${i}`).toBe(expected[i]!);
}, 60_000);

test("Algorithm::from_str / variants", () => {
  expect(Algorithm.from_str("hYbRiD")).toEqual({ $: "Ok", _0: "Hybrid" });
  expect(Algorithm.from_str("DatafrogOpt")).toEqual({ $: "Ok", _0: "DatafrogOpt" });
  expect(Algorithm.from_str("x")).toEqual({ $: "Err", _0: "valid values: Naive, DatafrogOpt, LocationInsensitive, Compare, Hybrid" });
  expect(Algorithm.variants()).toEqual(["Naive", "DatafrogOpt", "LocationInsensitive", "Compare", "Hybrid"]);
});
