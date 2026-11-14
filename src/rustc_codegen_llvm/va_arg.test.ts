// Tests of lane ir-fix-a's port of va_arg.rs (`emit_va_arg` and the x86_64 SysV path; va_arg.ts) against the pinned rustc,
// through the port's whole driver and the IR model, as simd_intrinsic.test.ts tests generic_simd_intrinsic.
//
// The oracle crate is va_arg_oracle/va.rs, c-variadic functions that read every kind of argument the x86_64 SysV path tells
// apart (`c_int`, `c_uint`, `c_double`, `c_long`, `c_ulonglong`, a pointer, `usize`). The fixture is the pinned rustc's output
// for `--sysroot <its sysroot> --crate-type lib --target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes -O`;
// with the pinned toolchain present it is re-made and must be unchanged. The crate uses std (`VaList`), so the test needs the
// pinned toolchain's sysroot and is skipped without it, unless RUST_TS_REQUIRE_PROBES=1 makes that a failure.
//
// The IR is compared without comment lines, `; preds` tails and attribute-group numbers and lines (simd_intrinsic.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "va_arg_oracle");
const MAIN = join(import.meta.dir, "..", "rust_ts", "main.ts");
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "";
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned toolchain's sysroot is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const WORK = join(DATA, "tmp", "cg-va-arg-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const FIXTURE = "x86_64-unknown-linux-gnu.O.ll";
const ARGS = ["--sysroot", SYSROOT, "--crate-type", "lib", "--target", "x86_64-unknown-linux-gnu", "--emit=llvm-ir", "-Cno-prepopulate-passes", "-O"];

/** Runs `cmd` on va.rs in WORK; its stderr, exit code and written IR (if any). */
function compile(cmd: string[], out: string): { stderr: string; code: number | null; ir: string | undefined } {
  mkdirSync(WORK, { recursive: true });
  copyFileSync(join(ORACLE, "va.rs"), join(WORK, "va.rs"));
  rmSync(join(WORK, out), { force: true });
  const r = Bun.spawnSync([...cmd, ...ARGS, "va.rs", "-o", out], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
  let ir: string | undefined;
  try {
    ir = readFileSync(join(WORK, out), "utf8");
  } catch {
    ir = undefined;
  }
  return { stderr: r.stderr.toString(), code: r.exitCode, ir };
}

/** The IR without comment lines, `; preds` tails and attribute-group numbers and lines (header). */
function comparable(ir: string): string[] {
  return ir
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(";") && !l.startsWith("attributes #"))
    .map((l) => l.replace(/\s+; preds = .*$/, "").replace(/ #\d+( \{)?$/, "$1"));
}

describe.skipIf(!HAVE && !REQUIRE)("emit_va_arg against the oracle", () => {
  test("va.rs: the port's IR is the oracle's", () => {
    const r = compile([process.execPath, MAIN], "port.ll");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const want = readFileSync(join(ORACLE, FIXTURE), "utf8");
    // Both register classes and the memory path are in the fixture.
    for (const s of ["va_arg.in_reg", "va_arg.in_mem", "@va_int(", "@va_mixed("]) expect(want).toContain(s);
    expect(comparable(r.ir ?? "")).toEqual(comparable(want));
  });

  test("the oracle fixture is current", () => {
    const r = compile([join(SYSROOT, "bin", "rustc")], "oracle.ll");
    expect(r.code).toBe(0);
    expect(r.ir).toBe(readFileSync(join(ORACLE, FIXTURE), "utf8"));
  });
});
