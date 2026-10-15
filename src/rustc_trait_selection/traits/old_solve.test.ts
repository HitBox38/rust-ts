// Fixer lane merge-w18c: the old trait solver end to end, against rustc's own. traits/select (`evaluate_root_obligation`,
// `poly_select`, candidate assembly and confirmation), traits/project (`normalize_projection_term`), traits/fulfill (the
// old `FulfillmentContext` behind `FulfillmentEngine`), traits/query (`evaluate_obligation`, `query_normalize` through
// the canonical queries and their rustc_traits providers) run over a real `InferCtxt` and the real query system of a
// `#![no_core]` crate compiled by the ported driver with `-Znext-solver=coherence` (compiletest's argv).
//
// Oracle: old_solve_test/probe.rs is a rustc-dev program that runs the same script with rustc's rustc_trait_selection
// (its header documents the lines). The fixtures old_solve_test/*.stdout are its output (`REGEN=1` rebuilds the probe
// and rewrites them); old_solve_test/run.ts prints the same lines from the port. Every case must match exactly.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "old_solve_test");
const SOLVE_DIR = join(import.meta.dir, "..", "solve_test");
const REGEN = process.env.REGEN === "1";
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** The runs: test crate, extra rustc flags, fixture. goals.rs / proj.rs are the next-solver test crates (solve.test.ts). */
const RUNS: { file: string; flags: string[]; fixture: string }[] = [
  { file: join(SOLVE_DIR, "goals.rs"), flags: ["-Zdisable-fast-paths"], fixture: "goals.nofast.stdout" },
  { file: join(SOLVE_DIR, "goals.rs"), flags: [], fixture: "goals.stdout" },
  { file: join(SOLVE_DIR, "proj.rs"), flags: [], fixture: "proj.stdout" },
  { file: join(DIR, "old.rs"), flags: ["-Zdisable-fast-paths"], fixture: "old.nofast.stdout" },
  { file: join(DIR, "old.rs"), flags: [], fixture: "old.stdout" },
];

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

const args = (s: string, file: string, flags: string[]): string[] => [
  "-Znext-solver=coherence",
  ...flags,
  "--edition=2021",
  "--crate-type",
  "lib",
  "--sysroot",
  s,
  file,
];

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined) throw new Error("ERROR: oracle sysroot missing");
  const out = join(tmpdir(), "rust-ts-old-solve-probe");
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

describe("rustc_trait_selection traits/{select,project,fulfill,query}: the old solver end to end, against rustc", () => {
  for (const r of RUNS) {
    test(`${r.fixture}: every case prints exactly as the oracle`, () => {
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
        expect({ name, lines }).toEqual({ name, lines: oracle.get(name)! });
      }
    }, 120_000);
  }

  test("the fixtures cover the paths the old-solver unit tests used to pin", () => {
    const goals = readFileSync(join(DIR, "goals.nofast.stdout"), "utf8");
    const old = readFileSync(join(DIR, "old.nofast.stdout"), "utf8");
    // `?0: Tr`: `evaluate_root_obligation` (and the `evaluate_obligation` query) is ambiguous, `poly_select` finds no
    // candidate, and the old `FulfillmentContext` keeps it pending until `collect_remaining_errors`.
    expect(goals).toContain("goal 3: Binder { value: TraitClause(<_ as Tr>, polarity:Positive), bound_vars: [] }\n    eval_root: Ok(EvaluatedToAmbig)");
    expect(goals).toContain("code=Ambiguity(overflow=None)");
    // `SizedCandidate` confirmation: `sizedness_conditions` of a tuple is its last field.
    expect(old).toContain(
      "select: Ok(Some(Builtin(Misc, [Obligation(predicate=Binder { value: TraitClause(<U as Sized>, polarity:Positive), bound_vars: [] }, depth=0)])))",
    );
    // Projection through an impl (`opt_normalize_projection_term` -> `project` -> confirmation), and its mismatch error.
    expect(old).toContain("normalize: Term::Ty(S) [Binder { value: TraitClause(<S as Sized>, polarity:Positive), bound_vars: [] }");
    expect(old).toContain("code=Project(Sorts(ExpectedFound { expected: S, found: U }))");
  });
});
