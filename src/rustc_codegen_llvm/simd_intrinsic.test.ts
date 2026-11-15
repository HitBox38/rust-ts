// Tests of lane ir-fix-a's port of the head of `generic_simd_intrinsic` (intrinsic.rs:2047; intrinsic.ts) against the pinned
// rustc, through the port's whole driver and the IR model.
//
// The oracle crates are simd_oracle/simd.rs, a `#![no_core]` lib with one `#[no_mangle]` function per ported arm (and per
// element kind where the arm branches on it), simd_oracle/simd_err.rs, whose calls fail the arms' checks, and simd_oracle/simd_stop.rs,
// which calls an arm that is not ported (review ir-fix-a N4: the port must stop with exit 70, naming the fill lane cg-intrinsic-b). The fixtures are
// the pinned rustc's output for `--crate-type lib --target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes -O`:
// `x86_64-unknown-linux-gnu.O.ll` for simd.rs, and `simd_err.stderr` (stderr, exit 1) for simd_err.rs. With the pinned
// toolchain present they are re-made and must be unchanged.
//
// The port runs as a child process (`src/rust_ts/main.ts`, the subject of the IR suites), in the fixture's own directory with
// the same relative file name, so the two sides' texts can be compared directly. The IR is compared without what plan-m7 §1b's
// normal form drops and the model does not have to reproduce: comment lines, `; preds` tails and the attribute-group numbers
// and lines (`#N`, `attributes #N = ...`). Everything else, every `define` and `declare` and every instruction, must be equal.
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "simd_oracle");
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
const WORK = join(DATA, "tmp", "cg-simd-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const ARGS = ["--crate-type", "lib", "--target", "x86_64-unknown-linux-gnu", "--emit=llvm-ir", "-Cno-prepopulate-passes", "-O"];
const oracle = (file: string): string => readFileSync(join(ORACLE, file), "utf8");

/** Runs `cmd` on the fixture crate `src` in WORK; its stderr, exit code and written IR (if any). */
function compile(cmd: string[], src: string, out: string): { stderr: string; code: number | null; ir: string | undefined } {
  mkdirSync(WORK, { recursive: true });
  copyFileSync(join(ORACLE, src), join(WORK, src));
  rmSync(join(WORK, out), { force: true });
  const r = Bun.spawnSync([...cmd, ...ARGS, src, "-o", out], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
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

describe("generic_simd_intrinsic's ported arms against the oracle", () => {
  test("simd.rs: the port's IR is the oracle's", () => {
    const r = compile([process.execPath, MAIN], "simd.rs", "port.ll");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const want = oracle("x86_64-unknown-linux-gnu.O.ll");
    // The fixture covers every ported arm (header): splat, the comparisons, shuffle, insert / extract, select_bitmask,
    // bitmask, the min / max and bitwise reductions, the binary and unary arithmetic.
    // Review ir-fix-a N1 added `simd_shuffle_const_generic`, the `*_dyn` arms, `ne` / `le` / `gt`, the `*_nsz` arms and integer `rem`.
    for (const f of ["f_splat_u8", "f_lt_f32", "f_shuffle_wide", "f_select_bitmask_array", "f_bitmask_array", "f_reduce_any", "f_rem_f32", "f_neg_f32", "f_cg", "f_insert_dyn", "f_extract_dyn", "f_ne_i32", "f_le_u32", "f_gt_f32", "f_max_nsz", "f_min_nsz", "f_rem_i32", "f_rem_u32"])
      expect(want).toContain(`@${f}(`);
    expect(comparable(r.ir ?? "")).toEqual(comparable(want));
  });

  test("simd_err.rs: the port's InvalidMonomorphization errors are the oracle's", () => {
    const r = compile([process.execPath, MAIN], "simd_err.rs", "port_err.ll");
    expect(r.code).toBe(1);
    // Review ir-fix-a F1: `simd_shuffle_const_generic` reports only its first out-of-bounds index, as `collect::<Option<_>>` stops.
    expect(oracle("simd_err.stderr").match(/simd_shuffle_const_generic` intrinsic: SIMD index/g)?.length).toBe(1);
    expect(r.stderr).toBe(oracle("simd_err.stderr"));
  });

  test("simd_stop.rs: an arm that is not ported stops, naming cg-intrinsic-b", () => {
    const r = compile([process.execPath, MAIN], "simd_stop.rs", "port_stop.ll");
    expect(r.code).toBe(70);
    expect(r.stderr).toBe("rust-ts: unported: cg-intrinsic-b: compiler/rustc_codegen_llvm/src/intrinsic.rs generic_simd_intrinsic simd_fsqrt\n");
  });
});

describe.skipIf(!HAVE && !REQUIRE)("the oracle fixtures are current", () => {
  test("x86_64-unknown-linux-gnu.O.ll", () => {
    const r = compile([join(SYSROOT, "bin", "rustc")], "simd.rs", "oracle.ll");
    expect(r.code).toBe(0);
    expect(r.ir).toBe(oracle("x86_64-unknown-linux-gnu.O.ll"));
  });
  test("simd_stop.rs compiles under the oracle", () => {
    const r = compile([join(SYSROOT, "bin", "rustc")], "simd_stop.rs", "oracle_stop.ll");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });
  test("simd_err.stderr", () => {
    const r = compile([join(SYSROOT, "bin", "rustc")], "simd_err.rs", "oracle_err.ll");
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(oracle("simd_err.stderr"));
  });
});
