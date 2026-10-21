// Lane typeck-suggest-a: method/suggest.rs:1..2432 (`report_method_error` .. `confusable_method_name`).
//
// 1. `TraitBoundDuplicateTracker` (suggest.rs:56) directly.
// 2. Small `#![no_core]` crates (suggest_a_test/*.rs) through src/rust_ts/tydump.ts against the pinned rustc-dev probe
//    tools/probes/tydump (the tydump-* suites' oracle): stdout, stderr and exit must be equal, or ours stops at one of
//    `PENDING` (other lanes' placeholders, reached before or inside this region). Since merge-w19 (the lanes listed in
//    docs/handoff/typeck-suggest-a.md landed) every case but ambiguity.rs prints exactly the oracle's output (`NOW_EXACT`).
//    - not_found: E0599 on a local struct (`create_no_assoc_err`, `set_not_found_span_label`).
//    - assoc_not_found / path_missing: `Mode::Path` misses (a type, a type parameter, no similar names).
//    - enum_variant: `suggest_enum_variant_for_method_call` (unit, tuple and struct variants).
//    - private: E0624 (`MethodError::PrivateMatch`).
//    - similar_name: `find_likely_intended_associated_item` (same / different argument counts).
//    - unsatisfied / trait_unsatisfied: `handle_unsatisfied_predicates` (inherent impl, trait impl).
//    - static_fn: an associated function called as a method (`suggest_static_method_candidates`).
//    - shadowed: `suggest_use_shadowed_binding_with_method` (the `LetVisitor`).
//    - confusable: `#[rustc_confusables]` (`confusable_method_name`).
//    - chain: `lookup_segments_chain_for_no_match_method`.
//    - ambiguity: E0034 (`MethodError::Ambiguity`); stops in method probing (`SelectionContext::select`) first.
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import "../lib.ts";
import { DefId } from "../../rustc_span/def_id.ts";
import { TraitBoundDuplicateTracker } from "./suggest.ts";

const DIR = join(import.meta.dir, "suggest_a_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
const TYDUMP = join(import.meta.dir, "../../rust_ts/tydump.ts");

/** The exact `unported(..)` texts the cases stop at today (pruned by merge-w19: the lanes typeck-suggest-b,
 *  typeck-fnsugg-a/-b and errrep-sugg-a landed). */
const PENDING = new Set([
  // ambiguity.rs: method probing, before this region
  "rustc_trait_selection::traits::select::SelectionContext::select",
]);

/** Cases that must print the oracle's output (no stop): every case but ambiguity.rs since merge-w19. */
const NOW_EXACT = new Set<string>([
  "assoc_not_found.rs",
  "chain.rs",
  "confusable.rs",
  "enum_variant.rs",
  "not_found.rs",
  "path_missing.rs",
  "private.rs",
  "shadowed.rs",
  "similar_name.rs",
  "static_fn.rs",
  "trait_unsatisfied.rs",
  "unsatisfied.rs",
]);

test("TraitBoundDuplicateTracker: ref / non-ref duplicates, insertion order", () => {
  const a = new DefId(0 as never, 1 as never);
  const b = new DefId(0 as never, 2 as never);
  const t = TraitBoundDuplicateTracker.new();
  t.track(b, false);
  t.track(a, true);
  expect(TraitBoundDuplicateTracker.has_ref_dupes(t)).toBe(false);
  t.track(a, true);
  expect(TraitBoundDuplicateTracker.has_ref_dupes(t)).toBe(false);
  t.track(a, false);
  expect(TraitBoundDuplicateTracker.has_ref_dupes(t)).toBe(true);
  expect([...t.into_trait_def_ids()].map((d) => d.index)).toEqual([b.index, a.index]);
  const u = TraitBoundDuplicateTracker.new();
  u.track(b, false);
  u.track(b, true);
  expect(TraitBoundDuplicateTracker.has_ref_dupes(u)).toBe(true);
});

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function probe(): string | undefined {
  try {
    const { probePath } = require("../../../scripts/probes.ts") as typeof import("../../../scripts/probes.ts");
    const p = probePath("tydump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", file];

const CASES = readdirSync(DIR).filter((f) => f.endsWith(".rs")).sort();

test("suggest_a_test has its cases", () => {
  expect(CASES.length).toBe(13);
});

for (const file of CASES) {
  test(`suggest_a_test/${file}: tydump equals the oracle probe's, or stops as PENDING`, () => {
    const s = sysroot();
    const p = probe();
    if (s === undefined || p === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot or tydump probe missing");
      return;
    }
    const oracle = run([p, ...args(s, file)]);
    expect(oracle.stderr).toMatch(/^error\[E0(599|624|034)\]/);
    const ours = run(["bun", TYDUMP, ...args(s, file)]);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    if (m !== null) {
      expect(ours.exit).toBe(70);
      expect(PENDING).toContain(m[1]!);
    } else expect(ours).toEqual(oracle);
  }, 120_000);
}
