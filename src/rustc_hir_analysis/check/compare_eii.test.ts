// Lane small-gaps-17: `compare_eii_function_types` / `compare_eii_statics` (check/compare_eii.rs) through the ported
// driver (compare_eii_test/run.ts, which resolves each `#[eii]` impl as wfcheck.rs `check_eiis_fn` / `check_eiis_static`
// do), against the pinned rustc.
//
// 1. Argument-count mismatches (E0806, with the `#[eii]` macro and with the manual `eii_declaration` desugaring, from
//    tests/ui/error-codes/E0806.rs and tests/ui/eii/type_checking/wrong_ty_2.rs): ours prints exactly the oracle's stderr.
// 2. A matching signature and a static type mismatch are not reachable yet: the first stops at
//    compare_impl_item.rs `check_number_of_early_bound_regions` (lane check-compare; then `ObligationCtxt`, lane
//    trait-sel-traits-a), the second at `type_of` of the static (collect/type_of.ts's stand-in for wfcheck's
//    `check_static_item`). The test checks the oracle's result and that ours stops at one of `PENDING`.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "compare_eii_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const PENDING = new Set<string>([
  // (none since lane typeck-gaps ported `ConstraintCategory`: same_count.rs ran past `assumed_wf_types_and_report_errors`)
]);
/** Cases that equal the oracle since merge-w17: they must not stop. */
const NOW_EXACT = new Set(["static_wrong_ty.rs"]);

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

function both(file: string): { oracle: ReturnType<typeof run>; ours: ReturnType<typeof run> } | undefined {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return undefined;
  }
  const out = mkdtempSync(join(tmpdir(), "rust-ts-eii-"));
  try {
    const args = ["--sysroot", s, "--edition=2021", "--emit=metadata", "-o", join(out, "out.rmeta"), file];
    return { oracle: run(["rustc", `+${PIN.toolchain}`, ...args]), ours: run(["bun", join(DIR, "run.ts"), ...args]) };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

for (const file of ["arg_count.rs", "arg_count_manual.rs", "two_args.rs"]) {
  test(`compare_eii_test/${file}: ours prints the oracle's E0806`, () => {
    const r = both(file);
    if (r === undefined) return;
    expect(r.oracle.stderr).toContain("error[E0806]");
    expect({ exit: r.ours.exit, stderr: r.ours.stderr }).toEqual({ exit: r.oracle.exit, stderr: r.oracle.stderr });
  }, 120_000);
}

for (const [file, code] of [
  ["same_count.rs", undefined],
  ["static_wrong_ty.rs", "error[E0806]"],
] as const) {
  test(`compare_eii_test/${file}: the oracle reports ${code ?? "nothing"}; ours stops as PENDING`, () => {
    const r = both(file);
    if (r === undefined) return;
    if (code !== undefined) expect(r.oracle.stderr).toContain(code);
    else expect({ exit: r.oracle.exit, stderr: r.oracle.stderr }).toEqual({ exit: 0, stderr: "" });
    const m = /^UNPORTED: (.*)\n/m.exec(r.ours.stderr);
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    if (m !== null) {
      expect(r.ours.exit).toBe(70);
      expect(PENDING).toContain(m[1]!);
    } else {
      expect({ exit: r.ours.exit, stderr: r.ours.stderr }).toEqual({ exit: r.oracle.exit, stderr: r.oracle.stderr });
    }
  }, 120_000);
}
