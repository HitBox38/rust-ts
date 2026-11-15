// Tests of the port of va_arg.rs (va_arg.ts) against the pinned rustc, through the port's whole driver and the IR model, as
// simd_intrinsic.test.ts tests generic_simd_intrinsic: lane ir-fix-a's `emit_va_arg` and x86_64 SysV path, and lane
// cg-intrinsic-b's target bodies.
//
// - va_arg_oracle/va.rs: c-variadic functions that read every kind of argument the x86_64 SysV path tells apart (`c_int`,
//   `c_uint`, `c_double`, `c_long`, `c_ulonglong`, a pointer, `usize`). The fixture is the pinned rustc's output for
//   `--sysroot <its sysroot> --crate-type lib --target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes -O`. The
//   crate uses std (`VaList`), so the test needs the pinned toolchain's sysroot and is skipped without it, unless
//   RUST_TS_REQUIRE_PROBES=1 makes that a failure.
// - va_arg_oracle/va_targets.rs (lane cg-intrinsic-b): the `va_arg` intrinsic for each `VaArgSafe` kind over a `#![no_core]`
//   `VaList`, so it builds without a sysroot, for the targets of va_arg.rs's bodies the port has a target spec for:
//   aarch64-apple-darwin (the host, `emit_ptr_va_arg`) and aarch64-unknown-linux-gnu (`emit_aapcs_va_arg`). The fixtures are
//   `va_targets.<target>.O.ll`, the same flags without `--sysroot`, with MACOSX_DEPLOYMENT_TARGET=11.0 (the default) on both
//   sides. On aarch64-unknown-linux-gnu the IR model stops today (`Triple::normalize` and `LLVMRustOptimize` with the target's
//   global features, lane ir-fix-b); the test accepts those stops, and once the model has them the IR must be the oracle's.
//   (The powerpc, s390x, hexagon and xtensa bodies have no built-in target spec in the port yet, and custom JSON targets stop.)
// With the pinned toolchain present, every fixture is re-made and must be unchanged.
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

const TARGETS_ARGS = ["--crate-type", "lib", "--emit=llvm-ir", "-Cno-prepopulate-passes", "-O"];
/** Runs `cmd` on va_targets.rs for `target` in WORK; its stderr, exit code and written IR (if any). */
function compileTargets(cmd: string[], target: string, out: string): { stderr: string; code: number | null; ir: string | undefined } {
  mkdirSync(WORK, { recursive: true });
  copyFileSync(join(ORACLE, "va_targets.rs"), join(WORK, "va_targets.rs"));
  rmSync(join(WORK, out), { force: true });
  const r = Bun.spawnSync([...cmd, ...TARGETS_ARGS, "--target", target, "va_targets.rs", "-o", out], {
    cwd: WORK,
    env: { ...process.env, RUSTC_ICE: "0", MACOSX_DEPLOYMENT_TARGET: "11.0" },
  });
  let ir: string | undefined;
  try {
    ir = readFileSync(join(WORK, out), "utf8");
  } catch {
    ir = undefined;
  }
  return { stderr: r.stderr.toString(), code: r.exitCode, ir };
}
const targetsFixture = (target: string): string => readFileSync(join(ORACLE, `va_targets.${target}.O.ll`), "utf8");

describe("emit_va_arg's target bodies against the oracle (va_targets.rs)", () => {
  test("aarch64-apple-darwin: the port's IR is the oracle's", () => {
    const r = compileTargets([process.execPath, MAIN], "aarch64-apple-darwin", "port_darwin.ll");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const want = targetsFixture("aarch64-apple-darwin");
    for (const f of ["@va_i32(", "@va_f64(", "@va_ptr(", "@va_usize("]) expect(want).toContain(f);
    expect(comparable(r.ir ?? "")).toEqual(comparable(want));
  });

  test("aarch64-unknown-linux-gnu (aapcs): the IR model stops where it does today, or the port's IR is the oracle's", () => {
    const r = compileTargets([process.execPath, MAIN], "aarch64-unknown-linux-gnu", "port_aapcs.ll");
    const want = targetsFixture("aarch64-unknown-linux-gnu");
    // Every block of `emit_aapcs_va_arg` is in the fixture.
    for (const b of ["va_arg.maybe_reg", "va_arg.in_reg", "va_arg.on_stack", "va_arg.end"]) expect(want).toContain(`${b}:`);
    if (r.code === 70) {
      expect(r.stderr).toMatch(/^rust-ts: unported: llir: (Triple::normalize\("aarch64-unknown-linux-gnu"\)|LLVMRustOptimize with global target features "\+v8a,\+outline-atomics" .*)\n$/);
    } else {
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(comparable(r.ir ?? "")).toEqual(comparable(want));
    }
  });
});

describe.skipIf(!HAVE && !REQUIRE)("the va_targets.rs fixtures are current", () => {
  for (const target of ["aarch64-apple-darwin", "aarch64-unknown-linux-gnu"]) {
    test(`va_targets.${target}.O.ll`, () => {
      const r = compileTargets([join(SYSROOT, "bin", "rustc")], target, `oracle_${target}.ll`);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(r.ir).toBe(targetsFixture(target));
    });
  }
});
