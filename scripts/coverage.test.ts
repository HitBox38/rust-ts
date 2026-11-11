// `bun scripts/coverage.ts` with per-path scope in a compiler crate and the wrapper figure (lane scope-m7, plan-m7 D4): the modes
// that write nothing (`--crate`, `--missing`). The full run writes $RUST_TS_DATA/coverage.json, so it is not run here.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { REPO_ROOT as REPO } from "./lib/upstream-root.ts"; // not common.ts: see scripts/lib/upstream-root.ts

const cov = (...args: string[]): string[] => {
  const r = Bun.spawnSync([process.execPath, join(REPO, "scripts", "coverage.ts"), ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: process.env });
  expect(r.exitCode).toBe(0);
  return r.stdout.toString().trimEnd().split("\n");
};

describe("rustc_codegen_llvm (harness/scope.json crates)", () => {
  test("--crate: 820 in-scope fns, and no excluded file in the table", () => {
    const out = cov("--crate", "rustc_codegen_llvm");
    expect(out.at(-1)).toMatch(/^TOTAL \d+\/820 fns ported \(\d+\.\d\d%\) in rustc_codegen_llvm$/);
    const files = out.slice(0, -1).map((l) => l.trim().split(/\s+/)[1]!);
    expect(files.length).toBe(57 - 13); // ffi, enzyme_ffi, autodiff, typetree, gpu_offload, offload_ffi and 7 coverageinfo files
    for (const x of ["src/llvm/ffi.rs", "src/llvm/enzyme_ffi.rs", "src/builder/autodiff.rs", "src/typetree.rs", "src/builder/gpu_offload.rs", "src/llvm/offload_ffi.rs", "src/coverageinfo/"]) {
      expect(files.some((f) => f.startsWith(`compiler/rustc_codegen_llvm/${x}`))).toBe(false);
    }
    expect(files).toContain("compiler/rustc_codegen_llvm/src/builder.rs");
  });
  test("--missing on an excluded file and on one under an excluded directory: the note names the entry", () => {
    expect(cov("--missing", "compiler/rustc_codegen_llvm/src/llvm/ffi.rs")[0]).toStartWith("note: compiler/rustc_codegen_llvm/src/llvm/ffi.rs is out of scope (harness/scope.json crates.rustc_codegen_llvm.excluded src/llvm/ffi.rs: the seam");
    expect(cov("--missing", "compiler/rustc_codegen_llvm/src/coverageinfo/mapgen/covfun.rs")[0]).toContain("crates.rustc_codegen_llvm.excluded src/coverageinfo:");
  });
  test("--missing on an in-scope file: no note", () => expect(cov("--missing", "compiler/rustc_codegen_llvm/src/value.rs")[0]).not.toStartWith("note:"));
});

describe("llvm-wrapper", () => {
  test("--crate llvm-wrapper: 197 C++ fns in 6 files, without D18's coverage and offload wrappers (review scope-m7 N6)", () => {
    const out = cov("--crate", "llvm-wrapper");
    expect(out.length).toBe(7);
    expect(out.at(-1)).toMatch(/^TOTAL \d+\/197 fns ported \(\d+\.\d\d%\) in llvm-wrapper$/);
    expect(out.some((l) => /CoverageMappingWrapper|OffloadWrapper/.test(l))).toBe(false);
  });
  test("--missing on a wrapper left out of the figure: a note names why, then its fns", () => {
    const out = cov("--missing", "compiler/rustc_llvm/llvm-wrapper/CoverageMappingWrapper.cpp");
    expect(out[0]).toBe("note: compiler/rustc_llvm/llvm-wrapper/CoverageMappingWrapper.cpp is out of the WRAPPER figure (scripts/lib/llvm-src.ts WRAPPER_EXCLUDED: -Cinstrument-coverage (plan-m7 D18), as rustc_codegen_llvm's src/coverageinfo)");
    expect(out.at(-1)).toMatch(/^\d+\/11 ported$/);
  });
  test("--missing on a wrapper file lists C++ fns", () => {
    expect(cov("--missing", "compiler/rustc_llvm/llvm-wrapper/Linker.cpp")).toEqual([
      "compiler/rustc_llvm/llvm-wrapper/Linker.cpp:14 RustLinker",
      "compiler/rustc_llvm/llvm-wrapper/Linker.cpp:17 LLVMRustLinkerNew",
      "compiler/rustc_llvm/llvm-wrapper/Linker.cpp:23 LLVMRustLinkerFree",
      "compiler/rustc_llvm/llvm-wrapper/Linker.cpp:25 LLVMRustLinkerAdd",
      "0/4 ported",
    ]);
  });
});

// That no runner test file (this one included) loads scripts/lib/common.ts in the gate's runner step is checked for every such file
// by scripts/lib/unit-steps.test.ts (review scope-m7 N4).
