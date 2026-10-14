// Lane variance-outlives: variance/*, outlives/* on small `#![no_core]` crates through the ported driver
// (variance_outlives_test/run.ts), against the pinned rustc and the tydump probe.
//
// 1. `dump`: `#[rustc_dump_variances]` / `#[rustc_dump_inferred_outlives]` print exactly the oracle rustc's stderr (the
//    crates are otherwise clean, so the dumps that `check_crate` runs last are rustc's whole stderr).
// 2. `facts`: every computed `variances_of` / `clauses_of` line equals the tydump probe's line for that DefId, and every
//    computed non-empty `inferred_outlives_of` list is the tail of the probe's `clauses_of` list (clauses_of.rs appends
//    it). A fact that stops must stop at one of `PENDING_FACTS` (other lanes' stubs).
// 3. pending.rs: fn pointer, `dyn` and projection types reach other lanes' stubs while lowering field types; the dump
//    equals the oracle's or stops at one of `PENDING_DUMP`. When those lanes land, the case turns into an oracle match.
// 4. `implwf`: `check_impl_wf` on every impl (as wfcheck.rs:278) prints exactly the oracle's E0207 errors (implwf.rs is
//    otherwise clean). implwf_spec.rs (`min_specialization`) equals the oracle's or stops at one of `PENDING_DUMP`.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "variance_outlives_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function probe(): string | undefined {
  try {
    const { probePath } = require("../../scripts/probes.ts") as typeof import("../../scripts/probes.ts");
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

const dump_args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", "/dev/null", file];
const facts_args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", file];

/** The exact `unported(..)` texts the facts stop at today (rustc_middle Debug impls of other lanes). */
const PENDING_FACTS = new Set<string>([
  // (none since merge-w16b: tydump-subject's `EarlyParamRegion` and `Binder.bound_vars` Debug impls are merged)
]);

/** The exact `unported(..)` texts pending.rs's dump stops at today, while lowering field types. */
const PENDING_DUMP = new Set([
  "rustc_hir_analysis::check::check::check_abi", // fn pointer types (check/check.rs, wave 17 check-check)
  "rustc_trait_selection::traits::util::expand_trait_aliases", // `dyn Trait` (rustc_trait_selection, wave 17)
  "specialization_graph_of provider (not ported)", // `TraitDef::ancestors` (rustc_trait_selection, wave 17)
  "rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics", // min_specialization.ts stand-in
]);

for (const file of ["variances.rs", "outlives.rs"]) {
  test(`variance_outlives_test/${file}: the dumps print as the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...dump_args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), "dump", ...dump_args(s, file)]);
    expect(oracle.stderr).toContain(file === "variances.rs" ? "error: ['a: +, 'b: +, T: +, U: o]" : "= note: T: 'b");
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

for (const [mode, file] of [["dump", "pending.rs"], ["implwf", "implwf_spec.rs"]] as const) {
  test(`variance_outlives_test/${file}: ${mode} prints as the oracle, or stops as PENDING`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...dump_args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), mode, ...dump_args(s, file)]);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    if (m !== null) expect(PENDING_DUMP).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

test("variance_outlives_test/implwf.rs: check_impl_wf prints the oracle's E0207 errors", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const oracle = run(["rustc", `+${PIN.toolchain}`, ...dump_args(s, "implwf.rs")]);
  const ours = run(["bun", join(DIR, "run.ts"), "implwf", ...dump_args(s, "implwf.rs")]);
  expect(oracle.stderr.split("error[E0207]").length - 1).toBe(7);
  expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
}, 120_000);

/** `{ header -> { fact name -> value } }` and the header order, from a report or the probe's dump. */
function facts(out: string): { order: string[]; by: Map<string, Map<string, string>> } {
  const order: string[] = [];
  const by = new Map<string, Map<string, string>>();
  let cur: Map<string, string> | undefined;
  for (const line of out.split("\n")) {
    if (line === "" || line.startsWith("== ") || line.startsWith("    ")) continue;
    if (!line.startsWith("  ")) {
      order.push(line);
      cur = new Map();
      by.set(line, cur);
    } else {
      const name = line.slice(2).split(" ")[0]!;
      cur!.set(name, line.slice(2 + name.length + 1));
    }
  }
  return { order, by };
}

const CRATES: [string, number, number][] = [
  // [file, computed `variances_of` lines that must match the probe, computed `clauses_of` lines that must match]
  ["variances.rs", 31, 56],
  ["outlives.rs", 24, 42],
];

for (const [file, min_variances, min_clauses] of CRATES) {
  test(`variance_outlives_test/${file}: variances_of / clauses_of / inferred_outlives_of against the tydump probe`, () => {
    const s = sysroot();
    const p = probe();
    if (s === undefined || p === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot or tydump probe missing (bun scripts/probes.ts build tydump)");
      return;
    }
    const ours = run(["bun", join(DIR, "run.ts"), "facts", ...facts_args(s, file)]);
    expect(ours.exit).toBe(0);
    const theirs = facts(run([p, ...facts_args(s, file)]).stdout);
    const mine = facts(ours.stdout);
    expect(mine.order).toEqual(theirs.order);
    const matched = new Map<string, number>();
    const diffs: string[] = [];
    const stops: string[] = [];
    for (const [header, fs] of mine.by) {
      for (const [name, value] of fs) {
        if (value.startsWith("STOP ")) {
          stops.push(value.replace(/^STOP UNPORTED: /, ""));
          continue;
        }
        const probe_clauses = theirs.by.get(header)?.get("clauses_of");
        let ok: boolean;
        if (name === "inferred_outlives_of") {
          // `[(c, sp), ..]` is the tail of the probe's `GenericClauses { parent: .., clauses: [.., (c, sp), ..] }`.
          ok = value === "[]" || (probe_clauses !== undefined && (probe_clauses.endsWith(`, ${value.slice(1, -1)}] }`) || probe_clauses.endsWith(`clauses: ${value} }`)));
        } else {
          ok = theirs.by.get(header)?.get(name) === value;
        }
        if (ok) matched.set(name, (matched.get(name) ?? 0) + 1);
        else diffs.push(`${header}\n  ours:  ${name} ${value}\n  probe: ${theirs.by.get(header)?.get(name)}`);
      }
    }
    expect(diffs).toEqual([]);
    expect(stops.filter((w) => !PENDING_FACTS.has(w))).toEqual([]);
    expect(matched.get("variances_of") ?? 0).toBeGreaterThanOrEqual(min_variances);
    expect(matched.get("clauses_of") ?? 0).toBeGreaterThanOrEqual(min_clauses);
  }, 120_000);
}
