// Tests of lane typeck-lib-wb: `rustc_hir_typeck::loops::check` (loops.rs) through the driver, against the oracle.
//
// loops_test/run.ts runs the ported driver, then `loops::check` on every typeck-root body owner (see its header).
// `<case>.stderr` / `<case>.exit` are the pinned rustc's output and exit status (`REGEN=1` rewrites them). The test
// programs are `#![no_core]` crates whose only errors are `loops::check`'s, so the oracle's full output is what the
// runner must print:
// - `loops_basic`: E0268 (with the "consider labeling this block" suggestion, several breaks in one block), E0267
//   (closures), E0695, E0696, labeled `break` out of a nested labeled block, a `const` item body.
// - `loops_more`: E0590 (`while break` / `while continue`), `if` inside an unlabeled block, inline `const { .. }`,
//   `unsafe` blocks, `#[loop_match]` / `#[const_continue]` (the `emit_fatal` of `ConstContinueBadLabel`).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "loops_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES = ["loops_basic", "loops_more"] as const;

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

const args = (sysroot: string, c: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "-Zui-testing",
  "--crate-type",
  "lib",
  "-A",
  "internal_features",
  `${c}.rs`,
];
const oracle_args = (sysroot: string, c: string): string[] => [...args(sysroot, c), "--emit=metadata", "-o", join(process.env.TMPDIR ?? "/tmp", `loops_test_${c}.rmeta`)];

function run(cmd: string[]): { exit: number; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...oracle_args(s, c)]);
    writeFileSync(join(DIR, `${c}.stderr`), r.stderr);
    writeFileSync(join(DIR, `${c}.exit`), `${r.exit}\n`);
  }
}

const expected = (c: string) => ({
  exit: Number(readFileSync(join(DIR, `${c}.exit`), "utf8").trim()),
  stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8"),
});

test("loops_test fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, ...oracle_args(s, c)]);
    expect({ c, ...r }).toEqual({ c, ...expected(c) });
  }
}, 120_000);

for (const c of CASES) {
  test(`loops_test/${c}.rs: loops::check on every body equals the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)]);
    expect(r).toEqual(expected(c));
  }, 120_000);
}
