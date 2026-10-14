// Lane trait-sel-solve: the first end-to-end test of the next trait solver. rustc_trait_selection's `SolverDelegate`
// (solve/delegate.ts) drives the ported rustc_next_trait_solver over a real `InferCtxt` (rustc_infer) and the real query
// system of a `#![no_core]` crate compiled by the ported driver; `FulfillmentCtxt` (solve/fulfill.ts), its error
// derivation (fulfill/derive_errors.ts), the proof-tree analysis (inspect/analyse.ts) and `select_in_new_trait_solver`
// (select.ts) run on top.
//
// Oracle: solve_test/probe.rs is a rustc-dev program that runs the same script with rustc's own rustc_trait_selection
// (its header documents the lines: per goal the proof tree's root result, candidates and nested goals, the selection;
// per case the `FulfillmentCtxt` errors and the resolved inference variables). The fixtures solve_test/*.stdout are its
// output (`REGEN=1` rebuilds the probe and rewrites them); solve_test/run.ts prints the same lines from the port.
//
// Each case must match the oracle exactly, or stop at one of `PENDING` (other lanes' stand-ins) after printing a prefix
// of the oracle's lines.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "solve_test");
const REGEN = process.env.REGEN === "1";
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** The runs: test crate, extra rustc flags, fixture. */
const RUNS: { file: string; flags: string[]; fixture: string }[] = [
  { file: "goals.rs", flags: ["-Zdisable-fast-paths"], fixture: "goals.nofast.stdout" },
  { file: "goals.rs", flags: [], fixture: "goals.stdout" },
  { file: "proj.rs", flags: ["-Zdisable-fast-paths"], fixture: "proj.nofast.stdout" },
];

/** The exact `unported(..)` texts a case may stop at today (stand-ins for other lanes' ports). */
const PENDING = new Set([
  // delegate.ts `compute_goal_fast_path` for `Sized` / `MetaSized` goals (traits/util.rs, lane trait-sel-traits-a)
  "UNPORTED: rustc_trait_selection::traits::util::sizedness_fast_path",
  // delegate.ts `fetch_eligible_assoc_item` (impl candidates of `NormalizesTo`; traits/specialize, lane trait-sel-traits-b)
  "UNPORTED: rustc_trait_selection::traits::specialize::specialization_graph::assoc_def",
]);

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

const args = (s: string, file: string, flags: string[]): string[] => [...flags, "--edition=2021", "--crate-type", "lib", "--sysroot", s, file];

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined) throw new Error("ERROR: oracle sysroot missing");
  const out = join(tmpdir(), "rust-ts-solve-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exit !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.split("\n")[0]}`);
  for (const r of RUNS) {
    const o = run([exe, ...args(s, r.file, r.flags)]);
    if (o.exit !== 0) throw new Error(`ERROR: probe exit ${o.exit} on ${r.file}`);
    writeFileSync(join(DIR, r.fixture), o.stdout);
  }
}

/** `case <name>` -> its lines. */
function cases(out: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  let cur: string[] | undefined;
  for (const line of out.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("case ")) {
      cur = [];
      m.set(line.slice(5), cur);
    } else {
      cur!.push(line);
    }
  }
  return m;
}

describe("rustc_trait_selection solve/*: the next solver end to end, against rustc_trait_selection", () => {
  for (const r of RUNS) {
    test(`solve_test/${r.file} ${r.flags.join(" ")}: every case prints as the oracle, or stops as PENDING`, () => {
      const s = sysroot();
      if (s === undefined) {
        if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
        return;
      }
      const fixture = join(DIR, r.fixture);
      expect(existsSync(fixture)).toBe(true);
      const oracle = cases(readFileSync(fixture, "utf8"));
      const ours = run(["bun", join(DIR, "run.ts"), ...args(s, r.file, r.flags)]);
      expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: 0, stderr: "" });
      const port = cases(ours.stdout);
      expect([...port.keys()]).toEqual([...oracle.keys()]);
      for (const [name, lines] of port) {
        const want = oracle.get(name)!;
        const last = lines[lines.length - 1] ?? "";
        if (last.startsWith("  STOP ")) {
          expect({ name, stop: PENDING.has(last.slice("  STOP ".length)) ? "PENDING" : last }).toEqual({ name, stop: "PENDING" });
          expect({ name, prefix: lines.slice(0, -1) }).toEqual({ name, prefix: want.slice(0, lines.length - 1) });
        } else {
          expect({ name, lines }).toEqual({ name, lines: want });
        }
      }
    }, 120_000);
  }

  test("with fast paths disabled, every case of goals.rs matches the oracle exactly (no PENDING)", () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const ours = run(["bun", join(DIR, "run.ts"), ...args(s, "goals.rs", ["-Zdisable-fast-paths"])]);
    expect(ours.stdout).toBe(readFileSync(join(DIR, "goals.nofast.stdout"), "utf8"));
    // The script covers: builtin `Sized`, param-env and impl candidates, nested impl where-bounds, auto traits with a
    // negative impl, `FulfillmentError`s with the best leaf obligation, ambiguity and inference through a unique impl.
    expect(ours.stdout).toContain("code=Select(Unimplemented) root=Binder { value: TraitClause(<W<W<U>> as Tr>");
    expect(ours.stdout).toContain("code=Ambiguity(overflow=None)");
    expect(ours.stdout).toContain("resolved: [?0t, ?1t, W<S>]");
  }, 120_000);
});
