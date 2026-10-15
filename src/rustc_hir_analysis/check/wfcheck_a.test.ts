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

/** The exact `unported(..)` texts the `wf` cases stop at today (other lanes' items). */
const PENDING = new Set([
  "rustc_trait_selection::traits::normalize_param_env_or_error", // `param_env` (rustc_ty_utils ty.rs), lane trait-sel-traits-a
  "constness provider (not ported)", // `param_env` of an associated fn (`is_conditionally_const`)
  "rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics", // wfcheck.ts stand-in, lane trait-sel-traits-a
  "rustc_trait_selection::regions::ty_known_to_outlive", // wfcheck.ts stand-in, lane trait-sel-traits-a
  "rustc_trait_selection::regions::region_known_to_outlive", // wfcheck.ts stand-in, lane trait-sel-traits-a
  "rustc_trait_selection::traits::misc::type_allowed_to_implement_const_param_ty", // wfcheck.ts stand-in, lane trait-sel-traits-a
]);

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
  ["lint", "gat.rs", "error: missing required bound on `Item`"],
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
    if (m !== null) expect(PENDING).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}
