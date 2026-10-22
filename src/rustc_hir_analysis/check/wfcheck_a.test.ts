// Lane check-wf-a: check/wfcheck.rs lines 1-1139 on small `#![no_core]` crates through the ported driver
// (wfcheck_a_test/run.ts), against the pinned rustc.
//
// 1. `lint` mode (the calls that build no `ObligationCtxt`): shadow.rs (`SHADOWING_SUPERTRAIT_ITEMS`, one and several
//    supertraits; `check_param_wf` on bool/char/int const params) and neg_default.rs (E0750) print exactly the oracle's
//    stderr.
// 2. `wf` mode (the calls `check_item_type` makes into this region): E0277 in a struct field, E0392, a GAT that needs a
//    where clause, E0714 on a marker trait, a raw-pointer const param. Each equals the oracle's output or stops at one
//    of `PENDING` (other lanes' stubs); when those lanes land, the case turns into an oracle match.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "wfcheck_a_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
const OUT = mkdtempSync(join(tmpdir(), "wfcheck_a_"));

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

const args = (s: string, file: string): string[] => [
  "--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", join(OUT, `${file}.rmeta`), file,
];

/** The exact `unported(..)` texts the cases stop at today (none since merge-w19). */
const PENDING = new Set<string>([
  // (field_bound.rs prints the oracle's E0277 since merge-w19: the wave-19 error-reporting lanes landed and the
  // `(Predicate, WellFormedLoc)` query key of `diagnostic_hir_wf_check` is ported)
]);

/** Cases that print the oracle's stderr since merge-w17 (const_param.rs) / merge-w18c (`mir::ConstraintCategory`
 *  generated: gat.rs, marker.rs, unused.rs in `wf` mode) / merge-w19 (field_bound.rs): they must not stop. */
const NOW_EXACT = new Set(["const_param.rs", "gat.rs", "marker.rs", "unused.rs", "field_bound.rs"]);

for (const [file, contains] of [
  ["shadow.rs", "warning: trait item `f` from `Both` shadows identically named item from supertrait"],
  ["neg_default.rs", "error[E0750]: negative impls cannot be default impls"],
] as const) {
  test(`wfcheck_a_test/${file}: lint mode prints as the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), "lint", ...args(s, file)]);
    expect(oracle.stderr).toContain(contains);
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

for (const [mode, file, contains] of [
  ["wf", "field_bound.rs", "error[E0277]: the trait bound `T: Tr` is not satisfied"],
  ["wf", "unused.rs", "error[E0392]: type parameter `T` is never used"],
  ["wf", "gat.rs", "error: missing required bound on `Item`"],
  // (no `lint` case for gat.rs since merge-w18c: lint mode does not run `check_associated_item`, whose receiver check
  // reports the oracle's second error, "requires `legacy_receiver` lang_item"; `wf` mode prints both)
  ["wf", "marker.rs", "error[E0714]: marker traits cannot have associated items"],
  ["wf", "const_param.rs", "error: using raw pointers as const generic parameters is forbidden"],
] as const) {
  test(`wfcheck_a_test/${file}: ${mode} mode prints as the oracle, or stops as PENDING`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), mode, ...args(s, file)]);
    expect(oracle.stderr).toContain(contains);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    if (m !== null) expect(PENDING).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}
