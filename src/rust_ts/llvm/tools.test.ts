// rust-ts: tests of tools.ts (lane llir-tools): `LLVMRustOptimize` and `LLVMRustWriteOutputFile` over the pinned opt/llc.
// - the pipeline: for each recorded command line (tools_oracle/pipelines.json, the oracle's own `MPM.printPipeline`), what opt
//   builds from `opt_plan` must print the same, but for the one PORT'd difference (`slp-vectorizer` at O2);
// - the module: tools_oracle/opt.rs's recorded calls (opt.O<n>.script) replayed into the model, then `LLVMRustOptimize`, must
//   reach the normal form N1 of the oracle's `--emit=llvm-ir` (opt.O<n>.ll) at -Copt-level=0 and 2;
// - llc's flags for cg-write's recorded target machines, and an object and assembly from each;
// - the shared runner's failure (D16), modules held as text, buffers, clone and bitcode.
// The tool runs need the pinned toolchain on aarch64 macOS: without it they skip, unless RUST_TS_REQUIRE_PROBES=1.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../../scripts/lib/common.ts";
import { normalForm } from "../../../scripts/lib/ir-normal.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { LLVMRustGetLastError } from "./core.ts";
import * as L from "./ffi.ts";
import type { TargetMachine } from "./handles.ts";
import { Context, Module } from "./ir.ts";
import { printModule } from "./printer.ts";
import { parseScript, replay } from "./replay.ts";
import {
  assert_model_current,
  canonical_extra_passes,
  is_tool_text,
  llc_target_flags,
  llvm_tmp_dir,
  LLVMRustBuffer,
  module_text,
  opt_plan,
  oracle_sysroot,
  pinned_tool,
  print_pipeline,
  run_pinned_tool,
  run_pinned_tool_or_ice,
  set_module_text,
  triple_probe,
  with_cl_args,
} from "./tools.ts";
import { initialize_available_targets } from "./target.ts";
import { tmArgs } from "./tm_fixture.ts";
import { CL_ARGS, CODEGEN_LEVEL, type Level, settingsFor } from "./tools_oracle/fixtures.ts";
import { COMBOS, TARGET } from "./tools_oracle/record.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HAVE = (() => {
  if (process.platform !== "darwin" || process.arch !== "arm64") return false;
  try {
    pinned_tool("opt");
    pinned_tool("llc");
    return true;
  } catch {
    return false;
  }
})();
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned LLVM tools on aarch64 macOS are unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const HERE = join(import.meta.dir, "tools_oracle");
const WRITE_ORACLE = join(import.meta.dir, "..", "..", "rustc_codegen_llvm", "back", "write_oracle");
/**
 * A real target machine (llir-init's `LLVMRustCreateTargetMachine`, after `initialize_available_targets`) from cg-write's recorded
 * call for `target`'s codegen unit (the fixture's second line), with `level` in place of the recorded -Copt-level=0 level and
 * `features` in place of the recorded `""` (review llir-tools-recheck N3; llir-tools-recheck-2 note 4).
 */
function recordedTm(target: string, level: Level, features?: string): TargetMachine {
  initialize_available_targets();
  const args = tmArgs(readFileSync(join(WRITE_ORACLE, `${target}.tm`), "utf8").split("\n")[1]!);
  args[6] = CODEGEN_LEVEL[level];
  if (features !== undefined) args[2] = features;
  const tm = L.LLVMRustCreateTargetMachine(...args);
  if (tm === undefined) throw new Error(`ERROR: no target machine for ${target}: ${LLVMRustGetLastError() ?? ""}`);
  return tm;
}
const X86 = "x86_64-unknown-linux-gnu";
const HOST = "aarch64-apple-darwin";
const bin = (): string => pinned_tool("opt").replace(/\/opt$/, "");
const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "latin1"));

/** `LLVMRustOptimize` with ModuleConfig's settings for `level` (tools_oracle/fixtures.ts) and configure_llvm's options. */
function optimize(M: Module, tm: TargetMachine, level: Level, args: readonly string[] = []): L.LLVMRustResult {
  const s = settingsFor(level, args)!;
  const extra = new TextEncoder().encode(s.ExtraPasses);
  return with_cl_args(CL_ARGS, () =>
    L.LLVMRustOptimize(M, tm, s.OptLevel, s.OptStage, false, s.NoPrepopulatePasses, s.VerifyIR, s.LintIR, undefined, undefined, s.MergeFunctions, s.UnrollLoops, s.SLPVectorize, s.LoopVectorize, false, true, undefined, false, false, false, s.SanitizerOptions, undefined, undefined, false, undefined, undefined, false, undefined, undefined, undefined, undefined, 0, extra, extra.length, undefined, 0),
  );
}

/** A small valid module for x86_64 Linux, through the model. */
function smallModule(): Module {
  const C = new Context();
  const M = L.LLVMModuleCreateWithNameInContext("small", C);
  set_module_text(M, `; ModuleID = 'x'\nsource_filename = "small"\ntarget datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"\ntarget triple = "${X86}"\n\ndefine i32 @f(i32 %x) {\n  %a = add i32 %x, 1\n  %b = add i32 %a, 1\n  ret i32 %b\n}\n`);
  return M;
}

describe("opt_plan (no tools)", () => {
  const tm = { Reloc: "PIC", Model: "None", Level: "Default" } as const;
  test("O0: buildO0DefaultPipeline, then the ThinLTO buffer passes", () => {
    const p = opt_plan(settingsFor("0", [])!, { ...tm, Level: "None" });
    expect(p.passes).toBe("default<O0>,canonicalize-aliases,name-anon-globals,assign-guid");
    expect(p.flags).toEqual(["-relocation-model=pic", "-codegen-opt-level=0"]);
  });
  test("O2: merge functions on, SLP off (opt's alias turns it on), loop vectorization as the alias", () => {
    const p = opt_plan(settingsFor("2", [])!, tm);
    expect(p.passes).toBe("default<O2>,canonicalize-aliases,name-anon-globals,assign-guid");
    expect(p.flags).toEqual(["-vectorize-slp=false", "-enable-merge-functions", "-relocation-model=pic", "-codegen-opt-level=2"]);
  });
  test("Os and Oz are O2 from LLVM 23, without unrolling, interleaving or vectorization", () => {
    for (const l of ["s", "z"] as const) {
      const p = opt_plan(settingsFor(l, [])!, tm);
      expect(p.passes).toBe("default<O2>,canonicalize-aliases,name-anon-globals,assign-guid");
      expect(p.flags).toEqual(["-disable-loop-unrolling", "-interleave-loops=false", "-vectorize-loops=false", "-vectorize-slp=false", "-enable-merge-functions", "-relocation-model=pic", "-codegen-opt-level=2"]);
    }
  });
  test("LTO stages, the verifier and lint at the PipelineStart extension point, no-prepopulate", () => {
    const s = settingsFor("2", ["-Zverify-llvm-ir", "-Zlint-llvm-ir"])!;
    expect(opt_plan({ ...s, OptStage: "PreLinkThinLTO" }, tm).passes).toBe("thinlto-pre-link<O2>");
    expect(opt_plan({ ...s, OptStage: "PreLinkFatLTO" }, tm).passes).toBe("thinlto-pre-link<O2>");
    expect(opt_plan({ ...s, OptStage: "ThinLTO" }, tm).passes).toBe("thinlto<O2>,canonicalize-aliases,name-anon-globals,assign-guid");
    expect(opt_plan({ ...s, OptStage: "FatLTO" }, tm).passes).toBe("lto<O2>");
    expect(opt_plan(s, tm).flags).toContain("-passes-ep-pipeline-start=verify,function(lint<abort-on-error>)");
    // At O0 an LTO stage uses the LTO pipeline, and a pre-link stage the O0 one with the buffer passes.
    const s0 = settingsFor("0", [])!;
    expect(opt_plan({ ...s0, OptStage: "FatLTO" }, tm).passes).toBe("lto<O0>");
    expect(opt_plan({ ...s0, OptStage: "PreLinkThinLTO" }, tm).passes).toBe("default<O0>,canonicalize-aliases,name-anon-globals,assign-guid");
    expect(opt_plan({ ...s, NoPrepopulatePasses: true, ExtraPasses: "function(instcombine)" }, tm).passes).toBe("verify,function(lint<abort-on-error>),function(instcombine),canonicalize-aliases,name-anon-globals,assign-guid");
    // Without the default pipelines `NeedThinLTOBufferPasses` stays true, even for FatLTO (it is cleared only where they are built).
    expect(opt_plan({ ...s, NoPrepopulatePasses: true, VerifyIR: false, LintIR: false, OptStage: "FatLTO" }, tm).passes).toBe("canonicalize-aliases,name-anon-globals,assign-guid");
  });
  test("what M7 leaves out stops by name", () => {
    const s = settingsFor("2", [])!;
    expect(() => opt_plan({ ...s, SanitizerOptions: { ...s.SanitizerOptions!, sanitize_address: true } }, tm)).toThrow(Unported);
    expect(() => opt_plan({ ...s, SanitizerOptions: { ...s.SanitizerOptions!, sanitize_cfi: true } }, tm)).toThrow(Unported);
  });
  test("llc's flags for cg-write's recorded target machines", () => {
    const flags = llc_target_flags(recordedTm(X86, "2"));
    expect(flags).toEqual([
      `-mtriple=${X86}`,
      "-mcpu=x86-64",
      "-relocation-model=pic",
      "-O2",
      "-float-abi=default",
      "-data-sections=true",
      "-function-sections=true",
      "-unique-section-names=true",
      "-asm-verbose=false",
      // rustc always passes a split DWARF file name, `""` without split debuginfo (write.rs:249-259 `path_to_cstring_helper`), and
      // `LLVMRustCreateTargetMachine` sets `MCOptions.SplitDwarfFile` from any non-null one. The structural view this test used to
      // read mapped `""` to unset (review llir-tools-recheck N3); llc's objects are the same with or without the empty flag.
      "-split-dwarf-file=",
      "-x86-relax-relocations=false",
      "-use-ctors=false",
      "-emulated-tls=false",
      "-trap-unreachable",
      "-no-trap-after-noreturn",
      "-stack-size-section=false",
    ]);
    const host = llc_target_flags(recordedTm(HOST, "0"));
    expect(host.slice(0, 4)).toEqual(["-mtriple=arm64-apple-macosx11.0.0", "-mcpu=apple-m1", "-relocation-model=pic", "-O0"]);
    expect(host).toContain("-data-sections=false");
  });
});

describe.skipIf(!HAVE && !REQUIRE)("tools.ts against the oracle", () => {
  afterAll(() => rmSync(llvm_tmp_dir(), { recursive: true, force: true }));

  const recorded = JSON.parse(readFileSync(join(HERE, "pipelines.json"), "utf8")) as { name: string; flags: string[]; pipeline: string }[];
  test("pipelines.json covers record.ts's command lines", () => {
    expect(recorded.map((r) => r.name)).toEqual(COMBOS.map(([n]) => n));
  });
  for (const { name, flags, pipeline } of recorded) {
    test(`pipeline: ${name}`, () => {
      const level = (/-Copt-level=(.)/.exec(flags.join(" "))![1] ?? "2") as Level;
      const s = settingsFor(level, flags)!;
      const probe = triple_probe(X86);
      // The extra passes are parsed alone, as rustc parses them.
      if (s.ExtraPasses !== "") {
        const r = canonical_extra_passes(CL_ARGS, probe, s.ExtraPasses);
        expect(r.$).toBe("Ok");
        if (r.$ === "Ok") s.ExtraPasses = r.passes;
      }
      const plan = opt_plan(s, { Reloc: "PIC", Model: "None", Level: CODEGEN_LEVEL[level] });
      let got = plan.passes === undefined ? "" : new TextDecoder().decode(print_pipeline([...CL_ARGS, ...plan.flags], plan.passes, probe)).trim();
      // PORT (opt_plan): opt's `default<O2>` and `default<O3>` have an `slp-vectorizer`, which does nothing under `-vectorize-slp=false`.
      const slpPorted = !s.SLPVectorize && !s.NoPrepopulatePasses && s.OptLevel !== "O0" && s.OptLevel !== "O1";
      if (slpPorted) {
        expect(got).toContain(",slp-vectorizer,");
        got = got.replace(",slp-vectorizer,", ",");
      }
      expect(got).toBe(pipeline);
    });
  }
  test("the oracle's pipelines differ where the settings do (the fixture bites)", () => {
    const by = new Map(recorded.map((r) => [r.name, r.pipeline]));
    expect(by.get("o2")).not.toBe(by.get("o3"));
    expect(by.get("o2")).toContain("mergefunc");
    expect(by.get("o2-verify")).not.toBe(by.get("o2"));
    expect(by.get("o2-passes")).toContain("function(instcombine<max-iterations=1;verify-fixpoint>,dce)");
  });
  test("extra passes that do not parse: Failure, with the parser's message as the last error", () => {
    const M = smallModule();
    const tm = recordedTm(X86, "2");
    expect(optimize(M, tm, "2", ["-Cpasses=no-such-pass"])).toBe(L.LLVMRustResult.Failure);
    expect(LLVMRustGetLastError()).toBe("unknown pass name 'no-such-pass'");
  });

  for (const level of ["0", "2"] as const) {
    test(`opt.rs at -Copt-level=${level}: the replayed module through LLVMRustOptimize reaches the oracle's N1`, async () => {
      const r = replay(parseScript(readFileSync(join(HERE, `opt.O${level}.script`), "latin1")), UPSTREAM);
      const oracle = readFileSync(join(HERE, `opt.O${level}.ll`));
      const M = r.modules.find((m) => oracle.toString("latin1").startsWith(`; ModuleID = '${m.moduleID}'`))!;
      expect(M).toBeDefined();
      const before = printModule(M);
      expect(optimize(M, recordedTm(X86, level), level)).toBe(L.LLVMRustResult.Success);
      expect(is_tool_text(M)).toBe(true);
      const want = await normalForm(new Uint8Array(oracle), "N1", bin());
      const got = await normalForm(bytes(module_text(M)), "N1", bin());
      expect(got).toEqual(want);
      // The fixture bites: the module before the pipeline is not the oracle's after it.
      const pre = await normalForm(bytes(before), "N1", bin());
      expect(pre).not.toEqual(want);
      // `LLVMRustPrintModule` prints the tool's text, with the module's own identifier.
      const out = join(llvm_tmp_dir(), `opt.O${level}.ll`);
      expect(L.LLVMRustPrintModule(M, out, undefined)).toBe(L.LLVMRustResult.Success);
      expect(readFileSync(out, "latin1").split("\n")[0]).toBe(`; ModuleID = '${M.moduleID}'`);
      // Then llc, for object and assembly, as `codegen` does (a clone for the assembly).
      const obj = join(llvm_tmp_dir(), `opt.O${level}.o`);
      const asm = join(llvm_tmp_dir(), `opt.O${level}.s`);
      const tm = recordedTm(X86, level);
      with_cl_args(CL_ARGS, () => {
        expect(L.LLVMRustWriteOutputFile(tm, L.LLVMCloneModule(M), asm, undefined, "AssemblyFile", false, false)).toBe(L.LLVMRustResult.Success);
        expect(L.LLVMRustWriteOutputFile(tm, M, obj, undefined, "ObjectFile", false, false)).toBe(L.LLVMRustResult.Success);
      });
      expect([...readFileSync(obj).subarray(0, 4)]).toEqual([0x7f, 0x45, 0x4c, 0x46]);
      expect(readFileSync(asm, "latin1")).toContain(".section\t.text._RNvCs");
    });
  }

  test("a module changed through the model after a tool rewrote it stops", () => {
    const M = smallModule();
    L.LLVMSetDataLayout(M, "e-m:e");
    expect(() => module_text(M)).toThrow(Unported);
  });
  test("a tool failure is ICE-class: the input is kept, the message has the first error line and no machine path", () => {
    let caught: unknown;
    try {
      run_pinned_tool_or_ice("opt", ["-S", "-o", "-", "-"], bytes("define i32 @f() {\n  ret i64 0\n}\n"), "bad module");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Panic);
    const m = (caught as Panic).message;
    expect(m).toMatch(/^llir: opt failed on \$RUST_TS_DATA\/tmp\/llir\/\d+\/\d+-bad_module\.ll \(exit 1\): opt: <stdin>:2:\d+: error: /);
    const kept = m.slice("llir: opt failed on $RUST_TS_DATA/tmp/llir/".length).split(" ")[0]!;
    expect(existsSync(join(llvm_tmp_dir(), kept.slice(kept.indexOf("/") + 1)))).toBe(true);
  });
  test("an unwritable output: LLVMRustWriteOutputFile fails like raw_fd_ostream", () => {
    const M = smallModule();
    with_cl_args(CL_ARGS, () => expect(L.LLVMRustWriteOutputFile(recordedTm(X86, "0"), M, undefined, undefined, "ObjectFile", false, false)).toBe(L.LLVMRustResult.Failure));
    expect(LLVMRustGetLastError()).toBe("No such file or directory");
  });
  test("serialize (thin), buffers, parse back, bitcode to a file", async () => {
    const M = smallModule();
    const buf = L.LLVMRustModuleSerialize(M, true);
    expect(buf).toBeInstanceOf(LLVMRustBuffer);
    const data = L.LLVMRustBufferPtr(buf)!;
    expect(L.LLVMRustBufferLen(buf)).toBe(data.length);
    expect([...data.subarray(0, 4)]).toEqual([0x42, 0x43, 0xc0, 0xde]);
    // `AssignGUIDPass` ran on the module itself.
    expect(module_text(M)).toContain("!guid");
    const P = L.LLVMRustParseBitcodeForLTO(new Context(), data, data.length, "parsed")!;
    expect(module_text(P).split("\n")[0]).toBe("; ModuleID = 'parsed'");
    expect(module_text(P)).toContain("define i32 @f(i32 %x)");
    L.LLVMRustBufferFree(buf);
    expect(() => L.LLVMRustBufferLen(buf)).toThrow(Panic);
    expect(() => L.LLVMRustModuleSerialize(M, false)).toThrow(Unported);
    const bc = join(llvm_tmp_dir(), "small.bc");
    expect(L.LLVMWriteBitcodeToFile(M, bc)).toBe(0);
    expect([...readFileSync(bc).subarray(0, 4)]).toEqual([0x42, 0x43, 0xc0, 0xde]);
    expect(L.LLVMWriteBitcodeToFile(M, join(llvm_tmp_dir(), "no", "such", "dir.bc"))).toBe(-1);
  });
  test("a module the model built, never rewritten, is printed by the model", () => {
    const M = new Module(new Context(), "plain");
    expect(is_tool_text(M)).toBe(false);
    expect(module_text(M)).toBe(printModule(M));
    void TARGET;
  });

  /** The pinned rustc on `file` (copied into the tools' directory) with `args`; the paths of what it wrote are relative to there. */
  function oracle(file: string, args: string[]): string {
    const dir = llvm_tmp_dir();
    writeFileSync(join(dir, file), readFileSync(join(HERE, file)));
    const r = Bun.spawnSync([join(oracle_sysroot(), "bin", "rustc"), file, ...args], { cwd: dir, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    return dir;
  }

  test("F1, F2: a target machine with global features stops in LLVMRustOptimize and LLVMRustWriteOutputFile", () => {
    // The oracle's pre-pass text of catch_unwind.rs with -Ctarget-feature=+avx2: `__rust_try` is a definition with `target-cpu` and
    // no `target-features`, which in rustc takes the machine's features; every other definition carries the global list.
    const dir = oracle("catch_unwind.rs", ["--target", X86, "-Copt-level=2", "-Ccodegen-units=1", "-Ctarget-feature=+avx2", "-Cno-prepopulate-passes", "--emit=llvm-ir", "-o", "cu.ll"]);
    const text = readFileSync(join(dir, "cu.ll"), "latin1");
    const groupOf = (fn: string): string => {
      const def = text.split("\n").find((l) => l.startsWith("define") && l.includes(`@${fn}(`))!;
      const id = / #(\d+) /.exec(def)![1];
      return text.split("\n").find((l) => l.startsWith(`attributes #${id} = `))!;
    };
    const rustTry = groupOf("__rust_try");
    expect(rustTry).toContain('"target-cpu"="x86-64"');
    expect(rustTry).not.toContain('"target-features"');
    const global = /"target-features"="([^"]*)"/.exec(groupOf(/define [^@]*@(_RNv\S*4main)\(/.exec(text)![1]!))![1]!;
    expect(global).toContain("+avx2");
    const withFeatures = recordedTm(X86, "2", global);
    const M = new Module(new Context(), "cu");
    set_module_text(M, text);
    const stop = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        expect(e).toBeInstanceOf(Unported);
        return (e as Unported).what;
      }
      throw new Error("no stop");
    };
    expect(stop(() => optimize(M, withFeatures, "2"))).toMatch(/^llir: LLVMRustOptimize with global target features "[^"]*\+avx2[^"]*" \(opt cannot give them only to definitions without `target-features`, such as `__rust_try`; review llir-tools F1\/F2\)$/);
    expect(stop(() => with_cl_args(CL_ARGS, () => L.LLVMRustWriteOutputFile(withFeatures, M, join(dir, "cu.o"), undefined, "ObjectFile", false, false)))).toMatch(
      /^llir: LLVMRustWriteOutputFile with global target features .*\(llc appends -mattr to every function's own target-features, overriding #\[target_feature\]; review llir-tools F1\/F2\)$/,
    );
    // The same module through a machine without global features runs.
    expect(optimize(M, recordedTm(X86, "2"), "2")).toBe(L.LLVMRustResult.Success);
  });

  test("F3: a tool killed by a signal is ICE-class like any failure: the first error line, and the input kept", () => {
    const input = bytes(`target triple = "${X86}"\ndeclare <32 x i8> @llvm.x86.avx2.pshuf.b(<32 x i8>, <32 x i8>)\ndefine <32 x i8> @f(<32 x i8> %a, <32 x i8> %b) {\n  %r = call <32 x i8> @llvm.x86.avx2.pshuf.b(<32 x i8> %a, <32 x i8> %b)\n  ret <32 x i8> %r\n}\n`);
    // A backend `LLVM ERROR` aborts llc.
    const args = ["-mattr=-avx2", "-o", "-", "-"];
    const raw = run_pinned_tool("llc", args, input);
    expect(raw.signal).toBe("SIGABRT");
    expect(raw.status).toBe(134);
    let caught: unknown;
    try {
      run_pinned_tool_or_ice("llc", args, input, "pshuf");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Panic);
    const m = (caught as Panic).message;
    expect(m).toMatch(/^llir: llc failed on \$RUST_TS_DATA\/tmp\/llir\/\d+\/\d+-pshuf\.ll \(signal SIGABRT\): LLVM ERROR: /);
    expect(m).not.toContain(oracle_sysroot());
    const kept = m.slice("llir: llc failed on $RUST_TS_DATA/tmp/llir/".length).split(" ")[0]!;
    expect(readFileSync(join(llvm_tmp_dir(), kept.slice(kept.indexOf("/") + 1)))).toEqual(Buffer.from(input));
  });

  test("N4: an invalid module's message keeps the verifier's line", () => {
    let caught: unknown;
    try {
      run_pinned_tool_or_ice("opt", ["-S", "-o", "-", "-"], bytes("define i32 @f() {\n  %a = add i32 %b, 1\n  %b = add i32 1, 1\n  ret i32 %a\n}\n"), "broken");
    } catch (e) {
      caught = e;
    }
    // Parsed, then rejected by the verifier, whose detail comes first and has no "error" in it.
    expect((caught as Panic).message).toMatch(/\(exit 1\): Instruction does not dominate all uses! \(then: opt: -: error: input module is broken!\)$/);
  });

  test("F4: thin bitcode written without use-list order; the only difference in the disassembly from rustc's --emit=llvm-bc is opt's EnableSplitLTOUnit flag", async () => {
    const dir = oracle("opt.rs", ["--target", X86, "-Copt-level=2", "-Ccodegen-units=1", "--emit=llvm-bc,llvm-ir", "--out-dir", "."]);
    const M = new Module(new Context(), "opt2");
    set_module_text(M, readFileSync(join(dir, "opt.ll"), "latin1"));
    const ours = L.LLVMRustBufferPtr(L.LLVMRustModuleSerialize(M, true))!;
    const theirs = new Uint8Array(readFileSync(join(dir, "opt.bc")));
    // What use-list order would add: the same writer with it kept gives other bytes.
    const kept = run_pinned_tool("opt", ["--thinlto-bc", "-passes=assign-guid", "-o", "-", "-"], bytes(module_text(M))).stdout;
    expect(Buffer.from(kept).equals(Buffer.from(ours))).toBe(false);
    // Disassembled, ours has one module flag more; without it, the normal forms are equal. (llvm-dis prints no use lists, so this
    // compares contents only; the use-list part is the check above.)
    const dis = (b: Uint8Array): string => new TextDecoder("latin1").decode(run_pinned_tool_or_ice("llvm-dis", ["-o", "-", "-"], b, "bc", "bc"));
    const flag = /^(!\d+) = !\{i32 1, !"EnableSplitLTOUnit", i32 0\}$/m;
    const o = dis(ours);
    const id = flag.exec(o)![1]!;
    const withoutFlag = o.replace(flag, "").replace(new RegExp(`(!llvm\\.module\\.flags = !\\{.*), ${id}\\}`), "$1}");
    expect(flag.test(dis(theirs))).toBe(false);
    expect(await normalForm(bytes(withoutFlag), "N1", bin())).toEqual(await normalForm(bytes(dis(theirs)), "N1", bin()));
  });

  test("R1: a module that already has an EnableSplitLTOUnit flag stops before opt, which would add a second one and abort", () => {
    const M = new Module(new Context(), "split");
    const text = `; ModuleID = 'x'\nsource_filename = "split"\ntarget triple = "${X86}"\n\ndefine void @f() {\n  ret void\n}\n\n!llvm.module.flags = !{!0}\n\n!0 = !{i32 4, !"EnableSplitLTOUnit", i32 1}\n`;
    set_module_text(M, text);
    // What the stop prevents: opt --thinlto-bc on that text aborts in the verifier, on the second flag it adds (review
    // llir-tools-recheck-2 note 1: the reason, not only the failure).
    const raw = run_pinned_tool("opt", ["--thinlto-bc", "-passes=assign-guid", "-o", "-", "-"], bytes(text));
    expect([raw.status, raw.signal]).toEqual([134, "SIGABRT"]);
    expect(raw.stderr).toContain("module flag identifiers must be unique (or of 'require' type)");
    expect(raw.stderr).toContain('!"EnableSplitLTOUnit"');
    let caught: unknown;
    try {
      L.LLVMRustModuleSerialize(M, true);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Unported);
    expect((caught as Unported).what).toMatch(/^llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag \(-Zsplit-lto-unit or CFI\): opt --thinlto-bc always adds another/);
    // The module was not touched (no assign-guid run).
    expect(module_text(M)).not.toContain("!guid");
  });

  test("R1 end to end: rustc-ts with -Zsplit-lto-unit -Clinker-plugin-lto --emit=llvm-bc exits 70 with the stop's text", () => {
    // The reviewer's case through the driver (review llir-tools-recheck-2 note 2). Before wave 40q the driver stopped at
    // `codegen_crate`; codegen now forwards to the ported backend, which reaches write.rs's `ModuleBuffer::new`. The pinned
    // rustc takes the same command (exit 0); the port stops by name instead of handing opt a module it would abort on.
    const run = (sub: string, extra: string[]): { status: number | null; stderr: string; dir: string } => {
      const dir = join(llvm_tmp_dir(), sub);
      mkdirSync(dir, { recursive: true });
      const args = [join(HERE, "opt.rs"), "--sysroot", oracle_sysroot(), "--target", X86, "-Copt-level=2", "-Ccodegen-units=1", ...extra, "-Clinker-plugin-lto", "--emit=llvm-bc,llvm-ir", "--out-dir", "."];
      const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "main.ts"), ...args], { cwd: dir, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
      return { status: r.exitCode, stderr: r.stderr.toString(), dir };
    };
    const split = run("driver-split-lto-unit", ["-Zsplit-lto-unit"]);
    expect([split.status, split.stderr]).toEqual([
      70,
      "rust-ts: unported: llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag (-Zsplit-lto-unit or CFI): opt --thinlto-bc always adds another (optdriver.cpp:724); review llir-tools-recheck R1\n",
    ]);
    expect(existsSync(join(split.dir, "opt.bc"))).toBe(false);
    // Control: without -Zsplit-lto-unit the module has no such flag, and the same command writes the bitcode.
    const plain = run("driver-no-split-lto-unit", []);
    expect([plain.status, plain.stderr]).toEqual([0, ""]);
    expect(existsSync(join(plain.dir, "opt.bc"))).toBe(true);
  }, 60_000);

  test("LLVMRustModuleCost: every function, defined or declared, of the model or of a tool's text (lane ir-fix-b)", () => {
    // The model: two definitions and two declarations (an intrinsic among them).
    const C = new Context();
    const M = L.LLVMModuleCreateWithNameInContext("cost", C);
    const fnTy = L.LLVMFunctionType(L.LLVMVoidTypeInContext(C), [], 0, L.FALSE);
    const B = L.LLVMCreateBuilderInContext(C);
    for (const n of ["a", "b"]) {
      L.LLVMPositionBuilderAtEnd(B, L.LLVMAppendBasicBlockInContext(C, L.LLVMAddFunction(M, n, fnTy), "start"));
      L.LLVMBuildRetVoid(B);
    }
    L.LLVMAddFunction(M, "c", fnTy);
    L.LLVMGetIntrinsicDeclaration(M, L.LLVMLookupIntrinsicID("llvm.trap", 9), [], 0);
    expect(L.LLVMRustModuleCost(M)).toBe(4n);
    // A tool's text: a declaration with metadata attachments counts; an indented `#dbg_declare`, a string holding "define " and a
    // comment do not.
    const T = L.LLVMModuleCreateWithNameInContext("cost-text", new Context());
    set_module_text(T, `; ModuleID = 'x'\n@s = constant [8 x i8] c"define \\0A"\n\n; define void @no()\ndefine void @f() !dbg !3 {\n  #dbg_declare(ptr null, !4, !DIExpression(), !5)\n  ret void\n}\n\ndeclare !dbg !6 void @g()\n\ndeclare void @h()\n`);
    expect(L.LLVMRustModuleCost(T)).toBe(3n);
    expect(L.LLVMRustModuleCost(L.LLVMModuleCreateWithNameInContext("empty", new Context()))).toBe(0n);
  });

  test("N5: a model read after a tool rewrote the module stops", () => {
    const M = smallModule();
    expect(() => assert_model_current(M, "LLVMRustModuleCost")).toThrow(Unported);
    expect(() => assert_model_current(new Module(new Context(), "fresh"), "LLVMRustModuleCost")).not.toThrow();
  });
});
