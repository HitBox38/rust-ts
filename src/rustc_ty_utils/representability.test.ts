// Tests of lane ty-utils: the real rustc_ty_utils representability providers through the driver.
//
// representability_test/run.ts runs the ported driver with the real `check_representability`,
// `check_representability_adt_ty` and `params_in_repr` providers and stand-ins for the rustc_hir_analysis queries they
// read (see its header). The `rec*` programs are the E0072 cases of src/rustc_query_impl/cycle_oracle (which plays
// `check_representability` with a stand-in); `<case>.stderr` is the pinned rustc's output (`REGEN=1` rewrites it).
//
// Through the real providers every E0072 cycle goes through a `check_representability_adt_ty(Ty)` frame, and
// `create_cycle_error` describes every frame: that query's `desc` (`Display` of `rustc_middle::ty::Ty`) is still
// `unported` in queries.gen.ts (queries.ts typemap, handoff merge-w15b "Left for root"), so the cycles stop there. The
// test pins that stop; when the desc lands, the rec cases must match the oracle fixtures instead (`EXPECT_ORACLE`).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "representability_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
const REC = ["rec1", "rec2", "rec3", "rec6", "rec_enum", "rec_alias"] as const;
const DESC_STOP = "unported: desc of query `check_representability_adt_ty` (Display of `rustc_middle::ty::Ty`)";

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

const args = (sysroot: string, c: string): string[] => ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot, "--edition=2021", "-Zui-testing", `${c}.rs`];

function run(cmd: string[]): { exit: number; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of REC) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...args(s, c)]);
    if (r.exit !== 1) throw new Error(`ERROR: oracle exit ${r.exit} on ${c}.rs`);
    writeFileSync(join(DIR, `${c}.stderr`), r.stderr);
  }
}

test("representability_test fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of REC) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...args(s, c)]);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: 1, stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8") });
  }
}, 120_000);

test("representability_test/ok.rs: representable ADTs (fields, tuples, arrays, enums) pass without errors", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const r = run(["bun", join(DIR, "run.ts"), ...args(s, "ok")]);
  expect({ exit: r.exit, stderr: r.stderr }).toEqual({ exit: 0, stderr: "" });
}, 120_000);

for (const c of REC) {
  test(`representability_test/${c}.rs: the cycle reaches create_cycle_error through check_representability_adt_ty`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)]);
    // EXPECT_ORACLE: once the desc is ported, replace with
    //   expect({ exit: r.exit, stderr: r.stderr }).toEqual({ exit: 1, stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8") });
    expect(r.stderr).toContain(DESC_STOP);
    expect(r.exit).not.toBe(0);
  }, 120_000);
}
