// Tests of lane mb-custom-tail: `rustc_mir_build::check_tail_calls` (check_tail_calls.rs) through the driver, against
// the oracle.
//
// check_tail_calls_test/run.ts runs the ported driver, then the `check_tail_calls` query on every body owner (see its
// header). `<case>.stderr` / `<case>.exit` are the pinned rustc's output and exit status (`REGEN=1` rewrites them). The
// programs are tests/ui/explicit-tail-calls cases (copied unchanged) whose only errors are `check_tail_calls`'s (and,
// in return-mismatches.rs, typeck's, which `thir_body` reaches first per body as rustc does), plus unsized-argument.rs:
// - become-operator: `report_builtin_op`, `report_op` (overloaded operators, 1 and 2 args, `op_trait_as_method_name`);
// - become-uncallable: `report_non_call`; closure: `report_calling_closure`; in-closure: `report_in_closure`;
// - callee_is_ref / callee_is_weird: `report_nonfn_callee` (with and without the deref suggestion);
// - signature-mismatch / caller-lifetime-presence / ret-ty-hr-mismatch: `report_signature_mismatch`,
//   `report_abi_mismatch`; rust-call: `report_unsupported_abi`; intrinsics: `report_calling_intrinsic`;
// - caller_is_track_caller: `report_track_caller_caller`; c-variadic: `report_c_variadic_callee`;
// - unsized-argument: `report_unsized_argument`, a `#[track_caller]` callee and a fn-pointer callee (accepted).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "check_tail_calls_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES = [
  "become-operator",
  "become-uncallable",
  "c-variadic",
  "callee_is_ref",
  "callee_is_weird",
  "caller-lifetime-presence",
  "caller_is_track_caller",
  "closure",
  "in-closure",
  "intrinsics",
  "ret-ty-hr-mismatch",
  "return-mismatches",
  "rust-call",
  "signature-mismatch",
  "unsized-argument",
] as const;

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
const oracle_args = (sysroot: string, c: string): string[] => [...args(sysroot, c), "--emit=metadata", "-o", join(process.env.TMPDIR ?? "/tmp", `check_tail_calls_test_${c}.rmeta`)];

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

test("check_tail_calls_test fixtures are the current oracle output", () => {
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
  test(`check_tail_calls_test/${c}.rs: check_tail_calls on every body equals the oracle`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)]);
    expect(r).toEqual(expected(c));
  }, 120_000);
}
