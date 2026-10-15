// Lane check-wf-b: check/wfcheck.rs 1140..end on small `#![no_core]` crates through the ported driver
// (wfcheck_b_test/run.ts), against the pinned rustc.
//
// 1. `variances`: `check_variances_for_type_defn` on every ADT (as check/check.rs does from `check_well_formed`) prints
//    exactly the oracle's E0392 / "only used recursively" errors, with and without a `phantom_data` lang item (the
//    crates are otherwise clean, so these errors are rustc's whole stderr).
// 2. `wf`: static WF (E0277 `Sync`) and the receiver check (E0307): `check_static_item`, `check_item_fn`, `check_impl`
//    and `check_associated_item` run inside `enter_wf_checking_ctxt` (lane check-wf-a) over `ObligationCtxt`
//    (lane trait-sel-traits-a). The test checks that the oracle reports the error and that ours prints the oracle's
//    stderr, or stops at one of `PENDING_WF` (exact `unported(..)` texts).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "wfcheck_b_test");
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

const args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", "/dev/null", file];

/** The exact `unported(..)` texts the `wf` mode stops at today (re-pinned by merge-w17, codegen-fn-attrs). */
const PENDING_WF = new Set([
  // static_wf.rs: `check_static_item` -> the `Sync` obligation's E0277 report needs `InferCtxt::err_ctxt`
  // (rustc_trait_selection error_reporting, not ported)
  "rustc_trait_selection::error_reporting::InferCtxt::err_ctxt",
  // (receiver.rs prints the oracle's E0307 since merge-w18c: `mir::ConstraintCategory` is generated and the harness runs
  // `check_associated_item` on impl items)
]);

for (const [file, n] of [
  ["unused_params.rs", 9],
  ["unused_params_phantom.rs", 9],
] as const) {
  test(`wfcheck_b_test/${file}: check_variances_for_type_defn prints the oracle's E0392 errors`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), "variances", ...args(s, file)]);
    expect(oracle.stderr).toContain(`error: aborting due to ${n} previous errors`);
    expect(oracle.stderr).toContain("is only used recursively");
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

/** `wf` cases that print the oracle's stderr since merge-w18c: they must not stop. */
const NOW_EXACT = new Set(["receiver.rs"]);

for (const [file, code] of [
  ["static_wf.rs", "error[E0277]"],
  ["receiver.rs", "error[E0307]"],
] as const) {
  test(`wfcheck_b_test/${file}: the oracle reports ${code}; ours prints the same, or stops as PENDING`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    expect(oracle.stderr).toContain(code);
    const ours = run(["bun", join(DIR, "run.ts"), "wf", ...args(s, file)]);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    if (m !== null) expect(PENDING_WF).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}
