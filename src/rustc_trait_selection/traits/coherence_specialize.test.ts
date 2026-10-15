// Lane trait-sel-traits-c: traits/coherence.rs and traits/specialize/* on small `#![no_core]` crates through the ported
// driver (coherence_test/run.ts), against the pinned rustc and the rustc-dev probe coherence_test/probe.rs.
//
// 1. `facts` (graph.rs, spec.rs): every line run.ts prints equals the line the probe recorded in `<crate>.stdout`
//    (specialization graphs, `overlapping_trait_impls` / `overlapping_inherent_impls`, `specializes`, the orphan check
//    in its three modes, `trait_ref_is_knowable`, `translate_args`), or is a `STOP` at one of `PENDING_FACTS` (other
//    lanes' stand-ins). graph.rs's impls never reach the trait solver, so all of its lines must match.
// 2. `coherence` (overlap.rs E0119, negpos.rs E0751): stderr and exit code equal the oracle rustc's, or the run stops at
//    one of `PENDING_COHERENCE`. When trait-sel-traits-a / trait-sel-solve land, these turn into oracle matches.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "coherence_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const facts_args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", file];
const coherence_args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", "/dev/null", file];

/** The exact `unported(..)` texts a fact may stop at today (other lanes' stand-ins). */
const PENDING_FACTS = new Set([
  // `specializes` of two impls of one polarity reads `param_env` (rustc_ty_utils' stand-in, lane trait-sel-traits-a).
  "rustc_trait_selection::traits::normalize_param_env_or_error",
]);

/** The exact `unported(..)` texts the coherence runs stop at today (overlap.rs matches the oracle since merge-w17). */
const PENDING_COHERENCE = new Set([
  // negpos.rs: `impl Diagnostic for NegativePositiveConflict` (diagnostics.rs, a manual impl; unassigned)
  "rustc_trait_selection::diagnostics::NegativePositiveConflict",
]);

const FACTS: [string, number][] = [
  // [crate, lines that must equal the probe's]
  ["graph.rs", 619],
  ["spec.rs", 39],
];

for (const [file, min_match] of FACTS) {
  test(`coherence_test/${file}: graphs, overlap, specializes, orphan checks and translate_args equal the probe's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const ours = run(["bun", join(DIR, "run.ts"), "facts", ...facts_args(s, file)]);
    expect(ours.exit).toBe(0);
    const mine = ours.stdout.split("\n");
    const theirs = readFileSync(join(DIR, file.replace(/\.rs$/, ".stdout")), "utf8").split("\n");
    expect(mine.length).toBe(theirs.length);
    let matched = 0;
    for (let i = 0; i < theirs.length; i++) {
      const m = mine[i]!;
      if (m === theirs[i]) {
        if (m !== "") matched++;
        continue;
      }
      const stop = /^(.*) STOP UNPORTED: (.*)$/.exec(m);
      expect(stop === null ? `line ${i + 1}: ${m}` : theirs[i]!.startsWith(`${stop[1]} `)).toBe(true);
      expect(PENDING_FACTS).toContain(stop![2]!);
    }
    expect(matched).toBeGreaterThanOrEqual(min_match);
  }, 120_000);
}

for (const [file, code] of [
  ["overlap.rs", "E0119"],
  ["negpos.rs", "E0751"],
] as const) {
  test(`coherence_test/${file}: specialization_graph_of reports ${code} as the oracle, or stops as PENDING`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...coherence_args(s, file)]);
    expect(oracle.stderr).toContain(`error[${code}]`);
    const ours = run(["bun", join(DIR, "run.ts"), "coherence", ...coherence_args(s, file)]);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    // overlap.rs matches the oracle since merge-w17: it must not stop.
    if (file === "overlap.rs") expect(m).toBeNull();
    if (m !== null) expect(PENDING_COHERENCE).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}
