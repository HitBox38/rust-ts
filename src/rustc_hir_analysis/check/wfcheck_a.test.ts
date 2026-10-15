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

/** The exact `unported(..)` texts the cases stop at today (re-pinned by merge-w17). */
const PENDING = new Set([
  "rustc_trait_selection::error_reporting::InferCtxt::err_ctxt", // field_bound.rs: E0277 report (wave 19)
  "rustc_middle::ty::region::EarlyParamRegion: RegionName::is_named", // unused.rs (rustc_middle ty/region.rs)
  "rustc_middle::ty::region::LateParamRegionKind::from_bound", // gat.rs: `liberate_late_bound_regions` (rustc_middle)
]);

/** Cases that print the oracle's stderr since merge-w17: they must not stop. */
const NOW_EXACT = new Set(["const_param.rs"]);

/**
 * `lint` mode makes only the calls that build no `ObligationCtxt`, so the oracle diagnostics of the other calls are out of
 * its reach (lane typeck-gaps: gat.rs ran to the end once `ConstraintCategory` was ported). Per file: the first line of
 * each such oracle diagnostic; the expected stderr is the oracle's without those diagnostics and with the error count
 * adjusted. gat.rs: `requires \`legacy_receiver\` lang_item` comes from `check_associated_item`'s receiver check (`wf`
 * mode; the full tydump pipeline prints both errors as the oracle does).
 */
const LINT_NOT_MADE: Record<string, string[]> = { "gat.rs": ["error: requires `legacy_receiver` lang_item"] };

/** The oracle's stderr without the diagnostics starting with one of `heads` (blank-line separated blocks). */
function without_diagnostics(stderr: string, heads: string[]): string {
  const blocks = stderr.split("\n\n");
  const kept = blocks.filter((b) => !heads.some((h) => b.startsWith(h)));
  const removed = blocks.length - kept.length;
  return kept
    .join("\n\n")
    .replace(/error: aborting due to (\d+) previous errors/, (_, n: string) => {
      const left = Number(n) - removed;
      return left === 1 ? "error: aborting due to 1 previous error" : `error: aborting due to ${left} previous errors`;
    });
}

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
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    const not_made = mode === "lint" ? LINT_NOT_MADE[file] : undefined;
    if (not_made !== undefined) for (const h of not_made) expect(oracle.stderr).toContain(h);
    const want = not_made !== undefined ? without_diagnostics(oracle.stderr, not_made) : oracle.stderr;
    if (m !== null) expect(PENDING).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: want });
  }, 120_000);
}
