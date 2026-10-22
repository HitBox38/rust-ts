// Lane perf-intern: the faster `intern_key` must give the same key as its first version (`intern_key_reference`,
// rust_ts/intern_key_corpus.ts) for every value, and `intern_key_eq(a, b)` must be `intern_key(a) === intern_key(b)`,
// panics included. Checked on generated values (every leaf kind, odd strings and field names, shuffled field order,
// `undefined` fields, `-0`, `NaN`, values `intern_key` rejects) and on every value of real compilations (the corpus
// runner, three crates: a `#![no_core]` crate, an old-solver crate against the oracle's std, and a next-solver
// overflow case).
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { INTERNED } from "../rustc_data_structures/intern.ts";
import { intern_key, intern_key_eq } from "./intern_key.ts";
import { intern_key_reference, type IkSummary } from "./intern_key_corpus.ts";
import { test_scratch_dir } from "./test_scratch.ts";

// ---- generated values ----

/** A fixed xorshift32 sequence. */
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n) => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}

/** Stand-ins of hash-consed objects: `INTERNED` on the prototype (as rustc_data_structures/intern.ts) and an id. */
class FakeInterned {
  constructor(readonly id: number) {
    Object.freeze(this);
  }
}
Object.defineProperty(FakeInterned.prototype, INTERNED, { value: true });

const INTERNED_POOL = [0, 1, 2, 3, 17, 4096].map((id) => new FakeInterned(id));
const NUMBERS = [0, -0, 1, -1, 7, 1.5, -2.25, NaN, Infinity, -Infinity, 2 ** 53, 1e21, 1e-7, 4294967040, 0xffff_ff00];
const STRINGS = ["", "a", "Not", "Mut", "0", "t", "~", "()", "#1", "1n", '"', "\\", "\n", "\t", "\u0000", "\u001f", "\u007f", "é", "日本", "\ud800", "\udc00", "😀", "a,b", "a:b", "}", "]", "{x:1}", " "];
const BIGINTS = [0n, 1n, -1n, 2n ** 64n - 1n, 2n ** 100n];
const NAMES = ["$", "_0", "_1", "_2", "def_id", "args", "kind", "a", "b", "A", "0", "1", "10", "2", "id"];
const ODD_NAMES = ["", "a:b", "x,y", "é", "a b", "$:", "}"];

/** A random value: depth-bounded arrays / objects over every kind of leaf; `bad` also allows rejected values. */
function gen(r: (n: number) => number, depth: number, bad: boolean): unknown {
  const k = r(depth > 0 ? 16 : 10);
  switch (k) {
    case 0:
    case 1:
      return NUMBERS[r(NUMBERS.length)];
    case 2:
    case 3:
      return STRINGS[r(STRINGS.length)];
    case 4:
      return r(2) === 0;
    case 5:
      return BIGINTS[r(BIGINTS.length)];
    case 6:
      return r(2) === 0 ? undefined : null;
    case 7:
    case 8:
      return INTERNED_POOL[r(INTERNED_POOL.length)];
    case 9:
      if (bad && r(8) === 0) {
        const b = [new Map(), new Set(), () => 0, Symbol("s")];
        return b[r(b.length)];
      }
      return r(100);
    case 10:
    case 11:
    case 12: {
      const n = r(4);
      const a: unknown[] = [];
      for (let i = 0; i < n; i++) a.push(gen(r, depth - 1, bad));
      if (r(10) === 0) a.length += 1; // a hole
      return a;
    }
    default: {
      const n = r(5);
      const o: Record<string, unknown> = r(6) === 0 ? Object.create({ inherited: 1 }) : {};
      for (let i = 0; i < n; i++) {
        const name = r(25) === 0 ? ODD_NAMES[r(ODD_NAMES.length)]! : NAMES[r(NAMES.length)]!;
        o[name] = gen(r, depth - 1, bad);
      }
      return o;
    }
  }
}

/** A deep copy that keys the same: fields in another insertion order, `undefined` fields added or dropped. */
function same(r: (n: number) => number, v: unknown): unknown {
  if (typeof v !== "object" || v === null || (v as { [INTERNED]?: true })[INTERNED] === true) return v;
  if (v instanceof Map || v instanceof Set) return v;
  if (Array.isArray(v)) {
    const a = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) if (i in v) a[i] = same(r, v[i]);
    return a;
  }
  const keys = Object.keys(v);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  const o: Record<string, unknown> = {};
  for (const k of keys) {
    const f = (v as Record<string, unknown>)[k];
    if (f === undefined && r(2) === 0) continue;
    o[k] = same(r, f);
  }
  if (r(4) === 0) o[NAMES[r(NAMES.length)]!] ??= undefined;
  return o;
}

/** A copy with one leaf changed (usually a different key, sometimes not: `0` for `-0` differs, an equal leaf does not). */
function near(r: (n: number) => number, v: unknown): unknown {
  if (typeof v === "object" && v !== null && (v as { [INTERNED]?: true })[INTERNED] !== true && !(v instanceof Map || v instanceof Set)) {
    if (Array.isArray(v)) {
      if (v.length === 0) return [0];
      const a = v.slice();
      const i = r(a.length);
      a[i] = near(r, a[i]);
      return a;
    }
    const keys = Object.keys(v);
    const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
    if (keys.length === 0 || r(5) === 0) o[NAMES[r(NAMES.length)]!] = gen(r, 0, false);
    else o[keys[r(keys.length)]!] = near(r, o[keys[r(keys.length)]!]);
    return o;
  }
  return gen(r, 0, false);
}

type Outcome = { key: string } | { panic: string };
function outcome(f: () => string): Outcome {
  try {
    return { key: f() };
  } catch (e) {
    return { panic: e instanceof Error ? e.message : String(e) };
  }
}
type EqOutcome = { eq: boolean } | { panic: string };
function eq_outcome(f: () => boolean): EqOutcome {
  try {
    return { eq: f() };
  } catch (e) {
    return { panic: e instanceof Error ? e.message : String(e) };
  }
}

test("intern_key: the same key as the first version on generated values (panics included)", () => {
  const r = rng(0x5eed);
  let panics = 0;
  for (let i = 0; i < 30_000; i++) {
    const v = gen(r, 4, true);
    const want = outcome(() => intern_key_reference(v));
    if ("panic" in want) panics++;
    expect(outcome(() => intern_key(v))).toEqual(want);
  }
  expect(panics).toBeGreaterThan(100);
});

test("intern_key_eq: key equality on generated pairs (equal, nearly equal, unrelated; panics included)", () => {
  const r = rng(0xbeef);
  const seen = { eq: 0, ne: 0, panic: 0 };
  for (let i = 0; i < 30_000; i++) {
    const a = gen(r, 4, r(3) === 0);
    const m = r(3);
    const b = m === 0 ? same(r, a) : m === 1 ? near(r, a) : gen(r, 4, r(5) === 0);
    const [x, y] = r(2) === 0 ? [a, b] : [b, a];
    // the reference: `intern_key(x) === intern_key(y)`, evaluated in that order
    const want = eq_outcome(() => intern_key_reference(x) === intern_key_reference(y));
    if ("panic" in want) seen.panic++;
    else if (want.eq) seen.eq++;
    else seen.ne++;
    expect({ i, got: eq_outcome(() => intern_key_eq(x, y)) }).toEqual({ i, got: want });
  }
  expect(seen.eq).toBeGreaterThan(5_000);
  expect(seen.ne).toBeGreaterThan(5_000);
  expect(seen.panic).toBeGreaterThan(100);
});

test("intern_key_eq: the cases the key text decides", () => {
  const i0 = INTERNED_POOL[0]!;
  // `0` and `-0` key apart, every `NaN` keys alike
  expect(intern_key_eq(0, -0)).toBe(false);
  expect(intern_key_eq([0], [-0])).toBe(false);
  expect(intern_key_eq(NaN, NaN)).toBe(true);
  // a missing field and an `undefined` one key alike; field order does not matter
  expect(intern_key_eq({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  expect(intern_key_eq({ $: "A", _0: 1 }, { _0: 1, $: "A" })).toBe(true);
  // interned objects by id; a hole and `undefined` alike
  expect(intern_key_eq(i0, new FakeInterned(0))).toBe(true);
  expect(intern_key_eq([i0], [INTERNED_POOL[1]])).toBe(false);
  expect(intern_key_eq(new Array(1), [undefined])).toBe(true);
  // an array is not an object with index fields
  expect(intern_key_eq([1], { 0: 1 })).toBe(false);
  // field names that make the key text ambiguous fall back to comparing the keys
  expect(intern_key_reference({ "a:1,b": 2 })).toBe(intern_key_reference({ a: 1, b: 2 }));
  expect(intern_key_eq({ "a:1,b": 2 }, { a: 1, b: 2 })).toBe(true);
  // rejected values panic as the keys do, even where the values already differ before them
  expect(eq_outcome(() => intern_key_eq({ a: 1, b: new Map() }, { a: 2 }))).toEqual({ panic: "intern_key: a Map/Set inside an intern key" });
  expect(eq_outcome(() => intern_key_eq([1], [2, () => 0]))).toEqual({ panic: "intern_key: a function inside an intern key" });
  const same_obj = { f: Symbol("s") };
  expect(eq_outcome(() => intern_key_eq(same_obj, same_obj))).toEqual({ panic: "intern_key: a symbol inside an intern key" });
});

// ---- values of real compilations ----

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUNNER = join(REPO, "src/rust_ts/intern_key_corpus.ts");
const WORK = test_scratch_dir("intern-key");

function oracle_sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function corpus(args: string[], cwd: string): IkSummary {
  const env: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) env[k] = v;
  }
  const r = Bun.spawnSync([process.execPath, RUNNER, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const line = r.stdout.toString().trim().split("\n").at(-1) ?? "";
  if (!line.startsWith("{")) throw new Error(`ERROR: corpus runner: exit ${r.exitCode}: ${r.stderr.toString().split("\n").slice(0, 3).join(" | ")}`);
  return JSON.parse(line) as IkSummary;
}

/** The checked counts; `min_values` guards against a run that keyed (almost) nothing. */
function expect_clean(s: IkSummary, min_values: number, exit_code: number): void {
  expect({ exit_code: s.exit_code, key_mismatches: s.key_mismatches, eq_mismatches: s.eq_mismatches, first_mismatch: s.first_mismatch }).toEqual({
    exit_code,
    key_mismatches: 0,
    eq_mismatches: 0,
    first_mismatch: undefined,
  });
  expect(s.values).toBeGreaterThan(min_values);
  expect(s.eq_true_checks).toBeGreaterThan(0);
  expect(s.eq_false_checks).toBeGreaterThan(0);
}

const MINI_CORE = "compiler/rustc_codegen_cranelift/example/mini_core.rs";

test("corpus: mini_core.rs (#![no_core], cg_clif's flags)", () => {
  const s = oracle_sysroot();
  if (s === undefined || !existsSync(join(UPSTREAM, MINI_CORE))) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot or upstream checkout missing");
    return;
  }
  // tydump-minicore's argv for this file (harness/suites.ts)
  const args = ["-Cdebuginfo=2", "--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "-Cpanic=abort", "--check-cfg=cfg(jit)", "--check-cfg=cfg(target_has_reliable_f128)", "--edition=2024", "-Zforce-unstable-if-unmarked", MINI_CORE, "--crate-type", "lib"];
  expect_clean(corpus(args, UPSTREAM), 10_000, 0);
}, 120_000);

const OLD_SOLVER = `
use std::collections::HashMap;
use std::fmt::Debug;

trait Foo<A> {
    fn foo(&self, a: A);
}
impl<A, F: Fn(A)> Foo<A> for F {
    fn foo(&self, _: A) {}
}
fn baz<A, F: for<'a> Foo<(&'a A,)>>(_: F) {}
fn components<T, A>(t: fn(&A))
where
    fn(&A): for<'a> Foo<(&'a A,)>,
{
    baz(t)
}

trait Shape { type Unit: Copy + Debug; fn area(&self) -> Self::Unit; }
#[derive(Debug, Clone, PartialEq)]
struct Sq(u32);
impl Shape for Sq { type Unit = u32; fn area(&self) -> u32 { self.0 * self.0 } }

pub fn total<S: Shape<Unit = u32>>(xs: &[S]) -> u32 {
    xs.iter().map(|s| s.area()).filter(|a| *a > 1).sum()
}

pub fn index(words: Vec<String>) -> HashMap<String, Vec<usize>> {
    let mut m: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, w) in words.into_iter().enumerate() {
        m.entry(w).or_default().push(i);
    }
    m
}

pub fn wrong() -> u32 {
    let v: Vec<Sq> = vec![Sq(1), Sq(2)];
    total(&v) + "x"
}
`;

test("corpus: an old-solver crate against the oracle's std", () => {
  const s = oracle_sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  writeFileSync(join(WORK, "old_solver.rs"), OLD_SOLVER);
  // `total(&v) + "x"` is an E0277: exit 1
  expect_clean(corpus(["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--edition=2021", "--crate-type", "lib", "old_solver.rs"], WORK), 2_000, 1);
}, 120_000);

test("corpus: next-solver overflow (projection-cache-rematch-impl-141124.rs with a lower recursion limit)", () => {
  const s = oracle_sysroot();
  const file = join(UPSTREAM, "tests/ui/traits/projection-cache-rematch-impl-141124.rs");
  if (s === undefined || !existsSync(file)) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot or upstream checkout missing");
    return;
  }
  writeFileSync(join(WORK, "overflow.rs"), `#![recursion_limit = "20"]\n${readFileSync(file, "utf8")}`);
  // the six E0275 overflow errors: exit 1
  expect_clean(corpus(["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--edition=2015", "-Znext-solver", "overflow.rs"], WORK), 20_000, 1);
}, 120_000);
