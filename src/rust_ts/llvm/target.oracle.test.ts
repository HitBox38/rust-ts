// rust-ts: tests of the IR model's LLVM initialisation, target machine and MC subtarget (target.ts, triple.ts; lane llir-init).
// The first half runs on the model alone. The second compares it with the pinned toolchain's own libLLVM.dylib through bun:ffi
// (as capi.oracle.test.ts does; tests only, the model never calls libLLVM): the data layout of a created target machine
// (`LLVMCopyStringRepOfTargetData`), `LLVMIsMultithreaded`, the components the oracle's LLVM is built with, the MC subtarget
// table (`MCSubtargetInfo::checkFeatures`, a C++ export of libLLVM), and the `-C llvm-args` values the model accepts.
//
// `REGEN=1` rewrites subtarget_table.ts from libLLVM (the feature names from the pinned `llc -mattr=help`, each answer from
// `checkFeatures`); without it the committed table must equal a fresh recording.
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer, ptr, toArrayBuffer } from "bun:ffi";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { llvmBinDir } from "../../../scripts/lib/llvm-tools.ts";
import { Unported } from "../../std/panic.ts";
import { LLVMRustGetLastError, NORMAL_TRIPLES } from "./core.ts";
import * as L from "./ffi.ts";
import { MC_SUBTARGET_TABLE } from "./subtarget_table.ts";
import {
  ACCEPTED_LLVM_ARGS,
  AVAILABLE_COMPONENTS,
  contextDiagnosticHandler,
  DiagnosticHandler,
  ERROR_HANDLERS,
  initialize_available_targets,
  llvm_cl_args,
  lookupTarget,
  mcSubtargetKey,
  ParseCommandLineOptions,
  registeredTargetNames,
  Target,
  TargetMachine,
} from "./target.ts";
import { TM_FIXTURES, tmArgs } from "./tm_fixture.ts";
import { Triple } from "./triple.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const DYLIB = join(SYSROOT, "lib", "libLLVM.dylib");
const HAVE = SYSROOT !== "" && existsSync(DYLIB) && process.platform === "darwin" && process.arch === "arm64";
if (!HAVE && !REQUIRE) console.log("SKIP: the oracle's libLLVM.dylib is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const stops = (f: () => unknown, re: RegExp): void => {
  let e: unknown;
  try {
    f();
  } catch (x) {
    e = x;
  }
  expect(e).toBeInstanceOf(Unported);
  expect((e as Unported).what).toMatch(re);
};

const fixtureCalls = (target: string): string[] => readFileSync(join(TM_FIXTURES, `${target}.tm`), "utf8").split("\n").filter((l) => l !== "");

/** X86 and AArch64 triples whose data layouts the model computes (27): the M7 ones (core.ts `NORMAL_TRIPLES`, both listed) and
 *  the branches of computeX86DataLayout, computeAArch64DataLayout and getManglingComponent. */
const DL_TRIPLES = [
  "x86_64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnux32",
  "x86_64-unknown-linux-muslx32",
  "x86_64-apple-darwin",
  "x86_64-apple-macosx10.12.0",
  "x86_64-pc-windows-msvc",
  "x86_64-pc-windows-gnu",
  "x86_64-unknown-uefi",
  "x86_64-unknown-freebsd",
  "i686-unknown-linux-gnu",
  "i686-pc-windows-msvc",
  "i686-pc-windows-gnu",
  "i686-apple-darwin",
  "i386-pc-elfiamcu",
  "i586-unknown-linux-gnu",
  "x86_64-elf",
  "x86_64-unknown-linux-gnu-macho",
  "aarch64-unknown-linux-gnu",
  "aarch64_be-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu_ilp32",
  "aarch64-pc-windows-msvc",
  "aarch64-apple-ios",
  "arm64_32-apple-watchos",
  "arm64-apple-macosx11.0.0",
  "arm64e-apple-ios",
  "aarch64-unknown-uefi",
  "aarch64",
];

// ---- the model alone ----
describe("Triple and computeDataLayout", () => {
  test("parses the M7 triples", () => {
    const t = new Triple("arm64-apple-macosx11.0.0");
    expect([t.getArch(), t.getVendor(), t.getOS(), t.getEnvironment(), t.getObjectFormat()]).toEqual(["aarch64", "Apple", "MacOSX", "UnknownEnvironment", "MachO"]);
    const x = new Triple("x86_64-unknown-linux-gnu");
    expect([x.getArch(), x.getVendor(), x.getOS(), x.getEnvironment(), x.getObjectFormat()]).toEqual(["x86_64", "UnknownVendor", "Linux", "GNU", "ELF"]);
    expect(new Triple("i686-pc-windows-msvc").getObjectFormat()).toBe("COFF");
    expect(new Triple("x86_64-pc-linux-gnu-macho").getObjectFormat()).toBe("MachO");
  });
  test("the M7 data layouts are the oracle's (context_oracle's ?datalayout)", () => {
    expect(new Triple("x86_64-unknown-linux-gnu").computeDataLayout("")).toBe("e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128");
    expect(new Triple("arm64-apple-macosx11.0.0").computeDataLayout("")).toBe("e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32");
  });
  test("an arch the model does not lay out stops by name", () => {
    stops(() => new Triple("riscv64-unknown-linux-gnu").computeDataLayout(""), /computeRISCVDataLayout/);
    expect(new Triple("riscv64gc-unknown-linux-gnu").getArch()).toBe("UnknownArch");
    stops(() => new Triple("armv7-unknown-linux-gnueabihf"), /parseARMArch/);
  });
});

describe("initialize_available_targets, the target machine and the MC subtarget", () => {
  initialize_available_targets();
  test("registers the modelled targets as their LLVMInitialize* functions do", () => {
    expect(registeredTargetNames()).toEqual(["aarch64_32", "aarch64_be", "aarch64", "arm64_32", "arm64", "x86-64", "x86"]);
    // Registering again changes nothing (`if (T.Name) return;`).
    initialize_available_targets();
    expect(registeredTargetNames().length).toBe(7);
    const err = { value: "" };
    expect(lookupTarget(new Triple("arm64-apple-macosx11.0.0"), err)?.Name).toBe("aarch64");
    expect(lookupTarget(new Triple("x86_64-unknown-linux-gnu"), err)?.Name).toBe("x86-64");
    expect(lookupTarget(new Triple("i686-unknown-linux-gnu"), err)?.Name).toBe("x86");
    // An arch only an unmodelled component could match stops instead of failing.
    stops(() => lookupTarget(new Triple("riscv64-unknown-linux-gnu"), err), /only the X86 and AArch64 targets are modelled/);
  });

  for (const target of ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]) {
    test(`${target}: the recorded LLVMRustCreateTargetMachine calls make a machine with the oracle's data layout`, () => {
      const oracleDl = /^1\t\?datalayout %\d+ "(.*)"$/m.exec(readFileSync(join(import.meta.dir, "../../rustc_codegen_llvm/context_oracle", `${target}.script`), "latin1"))![1]!;
      for (const line of fixtureCalls(target)) {
        const args = tmArgs(line);
        const tm = L.LLVMRustCreateTargetMachine(...args)!;
        expect(tm).toBeInstanceOf(TargetMachine);
        expect(tm.createDataLayout()).toBe(oracleDl);
        // The fields llir-tools reads: the call's arguments, by ffi.rs's parameter names.
        expect([tm.Triple, tm.CPU, tm.Features, tm.Abi, tm.Model, tm.Reloc, tm.Level, tm.FloatABIType] as unknown[]).toEqual(args.slice(0, 8));
        expect([tm.SplitDwarfFile, tm.OutputObjFile, tm.DebugInfoCompression, tm.LargeDataThreshold]).toEqual([args[17], args[18], args[19], args[22]]);
        expect(tm.normalizedTriple).toBe(args[0] as string);
        const ctx = L.LLVMContextCreate();
        const m = L.LLVMModuleCreateWithNameInContext("m", ctx);
        L.LLVMRustSetDataLayoutFromTargetMachine(m, tm);
        expect(L.LLVMGetDataLayoutStr(m)).toBe(oracleDl);
        L.LLVMDisposeTargetMachine(tm);
        expect(() => L.LLVMDisposeTargetMachine(tm)).toThrow(/double delete/);
        expect(() => L.LLVMRustSetDataLayoutFromTargetMachine(m, tm)).toThrow(/disposed/);
      }
    });
  }

  test("TargetOptions as the wrapper and the target machines set them", () => {
    const [x] = fixtureCalls("x86_64-unknown-linux-gnu").map(tmArgs);
    const tmx = L.LLVMRustCreateTargetMachine(...x!)!;
    expect(tmx.Options).toMatchObject({ FunctionSections: true, DataSections: true, UniqueSectionNames: true, TrapUnreachable: true, NoTrapAfterNoreturn: true, UseInitArray: true, MCOptions: { PreserveAsmComments: true, ABIName: "" } });
    expect(tmx.largeDataThreshold).toBeUndefined();
    const [a] = fixtureCalls("aarch64-apple-darwin").map(tmArgs);
    const tma = L.LLVMRustCreateTargetMachine(...a!)!;
    // AArch64TargetMachine: MachO always traps on unreachable.
    expect([tma.Options.TrapUnreachable, tma.Options.NoTrapAfterNoreturn, tma.TargetCPU]).toEqual([true, true, "apple-m1"]);
    const big = [...x!] as Parameters<typeof L.LLVMRustCreateTargetMachine>;
    big[22] = 65536n;
    expect(L.LLVMRustCreateTargetMachine(...big)!.largeDataThreshold).toBe(65536n);
    // A triple that is not its own normal form, as far as the model knows, stops.
    const other = [...x!] as Parameters<typeof L.LLVMRustCreateTargetMachine>;
    other[0] = "x86_64-linux-gnu";
    stops(() => L.LLVMRustCreateTargetMachine(...other), /Triple::normalize/);
  });

  test("MC subtargets answer from the oracle table; checkFeatures follows MCSubtargetInfo.cpp", () => {
    const si = L.LLVMRustCreateMCSubtargetInfo("x86_64-unknown-linux-gnu", "x86-64", "")!;
    const check = (fs: string): boolean => L.LLVMRustMCSubtargetInfoCheckFeatures(si, fs, Buffer.byteLength(fs));
    expect(check("+sse2,")).toBe(true);
    expect(check("+sse2,+fxsr,")).toBe(true);
    expect(check("+avx,")).toBe(false);
    expect(check("-avx")).toBe(true);
    expect(check("")).toBe(true);
    stops(() => check("+no-such-feature,"), /not a recognized feature/);
    L.LLVMRustDisposeMCSubtargetInfo(si);
    expect(() => check("+sse2")).toThrow(/disposed/);
    const ai = L.LLVMRustCreateMCSubtargetInfo("arm64-apple-macosx11.0.0", "apple-m1", "")!;
    expect(L.LLVMRustMCSubtargetInfoCheckFeatures(ai, "+neon,", 6)).toBe(true);
    expect(L.LLVMRustMCSubtargetInfoCheckFeatures(ai, "+sve,", 5)).toBe(false);
    // An invalid feature list is null without an error (Target::createMCSubtargetInfo); an unrecorded CPU stops.
    expect(L.LLVMRustCreateMCSubtargetInfo("x86_64-unknown-linux-gnu", "x86-64", "sse2")).toBeUndefined();
    expect(LLVMRustGetLastError()).toBeUndefined();
    stops(() => L.LLVMRustCreateMCSubtargetInfo("x86_64-unknown-linux-gnu", "znver4", ""), /MC subtarget .*znver4/);
    expect(Target.isValidFeatureListFormat("+a,-b,")).toBe(true);
    expect(Target.isValidFeatureListFormat("+a,,+b")).toBe(false);
  });

  test("LLVMIsMultithreaded and the error handlers", () => {
    expect(L.LLVMIsMultithreaded().is_true()).toBe(true);
    L.LLVMRustInstallErrorHandlers();
    expect(ERROR_HANDLERS.ErrorHandler?.name).toBe("FatalErrorHandler");
    expect(ERROR_HANDLERS.BadAllocErrorHandler?.name).toBe("BadAllocErrorHandler");
    expect(ERROR_HANDLERS.newHandlerInstalled).toBe(true);
  });

  test("LLVMRustSetLLVMOptions: the accepted arguments, once; anything else stops", () => {
    const argv0 = 'rustc -Cllvm-args="..." with';
    expect(llvm_cl_args()).toEqual([]);
    // (The first call wins, so the stops are checked on the parser itself.)
    stops(() => ParseCommandLineOptions(2, [argv0, "-time-passes"]), /cl::ParseCommandLineOptions of "-time-passes"/);
    stops(() => ParseCommandLineOptions(3, [argv0, "-enable-tail-merge=0", "-enable-tail-merge=0"]), /given twice/);
    expect(llvm_cl_args()).toEqual([]);
    const args = [argv0, "-generate-arange-section", "-mergefunc-use-aliases", "-preserve-alignment-assumptions-during-inlining=false", "-import-cold-multiplier=0.1"];
    L.LLVMRustSetLLVMOptions(args.length, args);
    expect(llvm_cl_args()).toEqual(args.slice(1));
    L.LLVMRustSetLLVMOptions(2, [argv0, "-time-passes"]);
    expect(llvm_cl_args()).toEqual(args.slice(1));
  });

  test("diagnostic handlers: get moves the context's handler out, configure installs rustc's, set puts one back", () => {
    const ctx = L.LLVMContextCreate();
    const old = L.LLVMRustContextGetDiagnosticHandler(ctx)!;
    expect(old).toBeInstanceOf(DiagnosticHandler);
    expect(old.Rust).toBeUndefined();
    expect(contextDiagnosticHandler(ctx)).toBeUndefined();
    const cb = (): void => {};
    const data = {};
    L.LLVMRustContextConfigureDiagnosticHandler(ctx, cb, data, false, ["inline", "gvn", "unused"], 2, undefined, false);
    const mine = contextDiagnosticHandler(ctx)!;
    expect([mine.DiagHandlerCallback, mine.DiagnosticContext, mine.Rust]).toEqual([cb, data, { RemarkAllPasses: false, RemarkPasses: ["inline", "gvn"] }]);
    L.LLVMRustContextSetDiagnosticHandler(ctx, old);
    expect(contextDiagnosticHandler(ctx)).toBe(old);
    stops(() => L.LLVMRustContextConfigureDiagnosticHandler(ctx, cb, data, true, [], 0, "remarks.yaml", false), /remark file/);
  });
});

// ---- against the pinned libLLVM ----
const P = "ptr" as const;
/** The targets the libLLVM tests initialise: the modelled ones, and the oracle's back ends of the literal data layouts. */
const LIB_TARGETS = ["X86", "AArch64", "AVR", "Hexagon", "MSP430", "Xtensa"];
const loaded = (() => {
  if (!HAVE) return undefined;
  const init: Record<string, { args: []; returns: "void" }> = { LLVMInitializeX86AsmPrinter: { args: [], returns: "void" } };
  for (const c of LIB_TARGETS) for (const k of ["TargetInfo", "Target", "TargetMC"]) init[`LLVMInitialize${c}${k}`] = { args: [], returns: "void" };
  return dlopen(DYLIB, {
    ...init,
    LLVMIsMultithreaded: { args: [], returns: "i32" },
    LLVMGetTargetFromTriple: { args: [P, P, P], returns: "i32" },
    LLVMCreateTargetMachine: { args: [P, P, P, P, "u32", "u32", "u32"], returns: P },
    LLVMDisposeTargetMachine: { args: [P], returns: "void" },
    LLVMCreateTargetDataLayout: { args: [P], returns: P },
    LLVMCopyStringRepOfTargetData: { args: [P], returns: P },
    LLVMDisposeTargetData: { args: [P], returns: "void" },
    LLVMDisposeMessage: { args: [P], returns: "void" },
    // `const MCSubtargetInfo &TargetMachine::getMCSubtargetInfo(StringRef CPU, StringRef FS)` and
    // `bool MCSubtargetInfo::checkFeatures(StringRef FS) const`: C++ exports; a StringRef goes in two registers (pointer, length).
    _ZN4llvm13TargetMachine18getMCSubtargetInfoENS_9StringRefES1_: { args: [P, P, "u64", P, "u64"], returns: P },
    _ZNK4llvm15MCSubtargetInfo13checkFeaturesENS_9StringRefE: { args: [P, P, "u64"], returns: "bool" },
    // Code generation of a small module, to observe `TargetOptions::TrapUnreachable` (no C API reads it).
    LLVMContextCreate: { args: [], returns: P },
    LLVMContextDispose: { args: [P], returns: "void" },
    LLVMCreateMemoryBufferWithMemoryRangeCopy: { args: [P, "usize", P], returns: P },
    LLVMParseIRInContext: { args: [P, P, P, P], returns: "i32" },
    LLVMSetTarget: { args: [P, P], returns: "void" },
    LLVMTargetMachineEmitToMemoryBuffer: { args: [P, P, "u32", P, P], returns: "i32" },
    LLVMGetBufferStart: { args: [P], returns: P },
    LLVMGetBufferSize: { args: [P], returns: "usize" },
    LLVMDisposeMemoryBuffer: { args: [P], returns: "void" },
  }).symbols;
})();
/** The libLLVM functions; without the toolchain (under RUST_TS_REQUIRE_PROBES=1) a test fails with one `ERROR:` line. */
function libLLVM(): NonNullable<typeof loaded> {
  if (loaded === undefined) throw new Error(`ERROR: the oracle's libLLVM.dylib is unavailable (${DYLIB}); the pinned toolchain (${PIN.toolchain}) on aarch64 macOS is needed`);
  return loaded;
}
const cstr = (s: string): Buffer => Buffer.from(`${s}\0`, "utf8");
const owned = (p: unknown): string => {
  const s = new CString(p as Pointer).toString();
  libLLVM().LLVMDisposeMessage(p as Pointer);
  return s;
};

/** libLLVM's target machine for `triple`, `cpu`, `fs` (opt level Default, reloc Default, code model Default), and its buffers. */
function oracleTm(triple: string, cpu: string, fs: string): { tm: Pointer; keep: Buffer[] } {
  const L2 = libLLVM();
  for (const c of LIB_TARGETS) for (const k of ["TargetInfo", "Target", "TargetMC"]) (L2 as unknown as Record<string, () => void>)[`LLVMInitialize${c}${k}`]!();
  (L2 as unknown as Record<string, () => void>).LLVMInitializeX86AsmPrinter!();
  const T = new BigUint64Array(1);
  const E = new BigUint64Array(1);
  const tb = cstr(triple);
  if (L2.LLVMGetTargetFromTriple(ptr(tb), ptr(T), ptr(E)) !== 0) throw new Error(`ERROR: libLLVM has no target for ${triple}`);
  const cb = cstr(cpu);
  const fb = cstr(fs);
  const tm = L2.LLVMCreateTargetMachine(Number(T[0]) as Pointer, ptr(tb), ptr(cb), ptr(fb), 2, 0, 0) as Pointer;
  return { tm, keep: [tb, cb, fb] };
}

function oracleDataLayout(triple: string): string {
  const { tm } = oracleTm(triple, "", "");
  const td = libLLVM().LLVMCreateTargetDataLayout(tm)!;
  const s = owned(libLLVM().LLVMCopyStringRepOfTargetData(td));
  libLLVM().LLVMDisposeTargetData(td);
  libLLVM().LLVMDisposeTargetMachine(tm);
  return s;
}

/** The target's feature names, from the pinned `llc -mattr=help` (sorted as LLVM's `ProcFeatures` table is). */
function llcFeatures(triple: string): string[] {
  const r = Bun.spawnSync([join(llvmBinDir(SYSROOT, "aarch64-apple-darwin"), "llc"), `-mtriple=${triple}`, "-mattr=help"], { stdout: "pipe", stderr: "pipe" });
  const text = r.stderr.toString() + r.stdout.toString();
  const from = text.indexOf("Available features for this target:");
  if (from < 0) throw new Error(`ERROR: llc -mattr=help printed no feature list for ${triple}`);
  const out: string[] = [];
  for (const l of text.slice(from).split("\n").slice(1)) {
    const m = /^ {2}(\S+)\s+- /.exec(l);
    if (m !== null) out.push(m[1]!);
    else if (out.length > 0 && l.trim() === "") break;
  }
  return out;
}

/** The (triple, CPU, features) argument lists of the table: the M7 targets' `target_config` subtargets (`OwnedMCSubtargetInfo::new`
 *  of `versioned_llvm_target`, `target_cpu` and `global_llvm_features(sess, true)`), and the `-C target-cpu` codegen_backend.ts
 *  knows (`ORACLE_TARGET_CPU_FEATURES`). */
const SUBTARGETS: readonly (readonly [string, string, string])[] = [
  ["x86_64-unknown-linux-gnu", "x86-64", ""],
  ["x86_64-unknown-linux-gnu", "x86-64-v4", ""],
  ["arm64-apple-macosx11.0.0", "apple-m1", ""],
];

/** Each feature's answer from libLLVM's `checkFeatures("+<feature>")` on the subtarget for these arguments. */
function oracleSubtarget(triple: string, cpu: string, fs: string, features: readonly string[]): string[] {
  const { tm, keep } = oracleTm(triple, cpu, fs);
  const cb = cstr(cpu);
  const fb = cstr(fs);
  const sti = libLLVM()._ZN4llvm13TargetMachine18getMCSubtargetInfoENS_9StringRefES1_(tm, ptr(cb), cpu.length, ptr(fb), Buffer.byteLength(fs))!;
  const enabled = features.filter((f) => {
    const b = Buffer.from(`+${f}`);
    return libLLVM()._ZNK4llvm15MCSubtargetInfo13checkFeaturesENS_9StringRefE(sti, ptr(b), b.length);
  });
  void keep;
  libLLVM().LLVMDisposeTargetMachine(tm);
  return enabled;
}

const TABLE = join(import.meta.dir, "subtarget_table.ts");
function tableSource(rows: { key: string; arch: string; features: string[]; enabled: string[] }[]): string {
  const lists = new Map<string, string[]>();
  for (const r of rows) lists.set(r.arch, r.features);
  const q = (xs: readonly string[]): string => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  let s = "// rust-ts: oracle data for the IR model's MC subtargets (target.ts; lane llir-init). Written by target.oracle.test.ts with REGEN=1\n";
  s += "// from the pinned toolchain: each target's feature names (`ProcFeatures`, from `llc -mattr=help`) and, for each (triple, CPU, features)\n";
  s += "// given to `Target::createMCSubtargetInfo`, the features `MCSubtargetInfo::checkFeatures` finds enabled in libLLVM. Do not edit;\n";
  s += "// the test checks every answer against libLLVM.\n\n";
  s += "export interface McSubtargetEntry {\n  /** `ProcFeatures`: the target's feature names, sorted. */\n  readonly features: readonly string[];\n  /** The features set in `FeatureBits`. */\n  readonly enabled: readonly string[];\n}\n\n";
  for (const [arch, fs] of lists) s += `const ${arch.toUpperCase()}_FEATURES: readonly string[] = ${q(fs)};\n\n`;
  s += "/** By `mcSubtargetKey(triple, CPU, features)` (target.ts). */\nexport const MC_SUBTARGET_TABLE: ReadonlyMap<string, McSubtargetEntry> = new Map([\n";
  for (const r of rows) s += `  [${JSON.stringify(r.key)}, { features: ${r.arch.toUpperCase()}_FEATURES, enabled: ${q(r.enabled)} }],\n`;
  return `${s}]);\n`;
}

describe.skipIf(!HAVE && !REQUIRE)("the model against the pinned libLLVM", () => {
  test("LLVMIsMultithreaded", () => {
    libLLVM();
    expect(libLLVM().LLVMIsMultithreaded()).toBe(1);
  });

  test("the components: each of initialize_available_targets' LLVMInitialize* exists, and no other target is built", () => {
    libLLVM();
    const ok = (sym: string): boolean => {
      try {
        dlopen(DYLIB, { [sym]: { args: [], returns: "void" } }).close();
        return true;
      } catch {
        return false;
      }
    };
    for (const c of AVAILABLE_COMPONENTS) {
      for (const k of ["TargetInfo", "Target", "TargetMC", "AsmPrinter"]) expect(`${c}${k} ${ok(`LLVMInitialize${c}${k}`)}`).toBe(`${c}${k} true`);
      // NVPTX has no assembly parser, and rustc_llvm initialises none for it.
      expect(`${c}AsmParser ${ok(`LLVMInitialize${c}AsmParser`)}`).toBe(`${c}AsmParser ${c !== "NVPTX"}`);
    }
    const nm = Bun.spawnSync(["nm", "-gU", DYLIB], { stdout: "pipe" }).stdout.toString();
    const infos = [...nm.matchAll(/ _LLVMInitialize(\w+)TargetInfo$/gm)].map((m) => m[1]!).sort();
    expect(infos).toEqual([...AVAILABLE_COMPONENTS].sort());
  });

  test("data layouts: the model's computeDataLayout equals libLLVM's target machine's", () => {
    libLLVM();
    expect(DL_TRIPLES.length).toBe(27);
    expect(new Set(DL_TRIPLES).size).toBe(DL_TRIPLES.length);
    for (const t of NORMAL_TRIPLES) expect(DL_TRIPLES).toContain(t);
    const diffs = DL_TRIPLES.map((t) => [t, new Triple(t).computeDataLayout(""), oracleDataLayout(t)] as const).filter(([, a, b]) => a !== b);
    expect(diffs).toEqual([]);
    // And through LLVMRustCreateTargetMachine, for the M7 triples.
    for (const target of ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]) {
      for (const line of fixtureCalls(target)) {
        const args = tmArgs(line);
        expect(L.LLVMRustCreateTargetMachine(...args)!.createDataLayout()).toBe(oracleDataLayout(args[0] as string));
      }
    }
  });

  test("subtarget_table.ts is libLLVM's answer for every feature", () => {
    libLLVM();
    const rows = SUBTARGETS.map(([triple, cpu, fs]) => {
      const features = llcFeatures(triple);
      // `Find` binary-searches the table: it must be sorted as C++ compares strings (bytes).
      expect([...features].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))).toEqual(features);
      const arch = new Triple(triple).getArch() === "x86_64" ? "x86" : "aarch64";
      return { key: mcSubtargetKey(triple, cpu, fs), arch, features, enabled: oracleSubtarget(triple, cpu, fs, features) };
    });
    const src = tableSource(rows);
    if (REGEN) writeFileSync(TABLE, src);
    expect(src).toBe(readFileSync(TABLE, "utf8"));
    expect(MC_SUBTARGET_TABLE.size).toBe(SUBTARGETS.length);
    // The model's answers through the C API names equal libLLVM's, a few features at a time.
    for (const [triple, cpu, fs] of SUBTARGETS) {
      const si = L.LLVMRustCreateMCSubtargetInfo(triple, cpu, fs)!;
      const feats = MC_SUBTARGET_TABLE.get(mcSubtargetKey(triple, cpu, fs))!.features;
      const { tm } = oracleTm(triple, cpu, fs);
      const cb = cstr(cpu);
      const fb = cstr(fs);
      const sti = libLLVM()._ZN4llvm13TargetMachine18getMCSubtargetInfoENS_9StringRefES1_(tm, ptr(cb), cpu.length, ptr(fb), Buffer.byteLength(fs))!;
      for (let i = 0; i < feats.length; i += 3) {
        const q = feats.slice(i, i + 3).map((f, k) => `${(i + k) % 2 ? "-" : "+"}${f}`).join(",") + ",";
        const b = Buffer.from(q);
        expect(`${q} ${L.LLVMRustMCSubtargetInfoCheckFeatures(si, q, b.length)}`).toBe(`${q} ${libLLVM()._ZNK4llvm15MCSubtargetInfo13checkFeaturesENS_9StringRefE(sti, ptr(b), b.length)}`);
      }
      libLLVM().LLVMDisposeTargetMachine(tm);
    }
  });

  test("the literal data layouts of the oracle's other back ends (AVR, Hexagon, MSP430, Xtensa) equal libLLVM's", () => {
    libLLVM();
    // (computeDataLayout's other literal arms, ARC, DXIL, TCE and XCore, have no back end in the oracle's LLVM.)
    for (const t of ["avr-unknown-unknown", "hexagon-unknown-linux-musl", "msp430-none-elf", "xtensa-none-elf"]) {
      expect(`${t}: ${new Triple(t).computeDataLayout("")}`).toBe(`${t}: ${oracleDataLayout(t)}`);
    }
  });

  test("TrapUnreachable: X86TargetMachine sets it for PS4/PS5 (`Triple::isPS`) and MachO, as libLLVM's code shows", () => {
    libLLVM();
    // libLLVM: whether `unreachable` becomes a trap (`ud2`) in the assembly of `define void @f() { unreachable }`. The model: the
    // machine's `Options.TrapUnreachable`, made as LLVMRustCreateTargetMachine makes it with TrapUnreachable false (the model's
    // `Triple::normalize` knows only the M7 triples, so the target's constructor is called directly).
    const oracleTraps = (triple: string): boolean => {
      const L2 = libLLVM();
      const { tm, keep } = oracleTm(triple, "", "");
      const ctx = L2.LLVMContextCreate()!;
      const ir = Buffer.from("define void @f() {\n  unreachable\n}\n");
      const name = cstr("m");
      const mb = L2.LLVMCreateMemoryBufferWithMemoryRangeCopy(ptr(ir), ir.length, ptr(name))!;
      const M = new BigUint64Array(1);
      const Err = new BigUint64Array(1);
      if (L2.LLVMParseIRInContext(ctx, mb, ptr(M), ptr(Err)) !== 0) throw new Error("ERROR: libLLVM could not parse the test module");
      L2.LLVMSetTarget(Number(M[0]) as Pointer, ptr(keep[0]!));
      const out = new BigUint64Array(1);
      if (L2.LLVMTargetMachineEmitToMemoryBuffer(tm, Number(M[0]) as Pointer, 0, ptr(Err), ptr(out)) !== 0) throw new Error(`ERROR: libLLVM could not emit assembly for ${triple}`);
      const buf = Number(out[0]) as Pointer;
      const text = Buffer.from(toArrayBuffer(L2.LLVMGetBufferStart(buf)!, 0, Number(L2.LLVMGetBufferSize(buf)))).toString("latin1");
      L2.LLVMDisposeMemoryBuffer(buf);
      L2.LLVMContextDispose(ctx);
      L2.LLVMDisposeTargetMachine(tm);
      return /\bud2\b/.test(text);
    };
    const modelTraps = (triple: string): boolean => {
      const TT = new Triple(triple);
      const tm = lookupTarget(TT, { value: "" })!.createTargetMachine(TT, "", "", { MCOptions: {} }, "Static", undefined, "Default")!;
      return tm.Options.TrapUnreachable === true;
    };
    initialize_available_targets();
    const triples = ["x86_64-scei-ps4", "x86_64-unknown-ps4", "x86_64-sie-ps5", "x86_64-unknown-ps5", "i686-scei-ps4", "x86_64-unknown-linux-gnu", "x86_64-apple-darwin"];
    const got = triples.map((t) => `${t} ${modelTraps(t)}`);
    expect(got).toEqual(triples.map((t) => `${t} ${oracleTraps(t)}`));
    // The test bites: both answers occur.
    expect(got).toContain("x86_64-scei-ps4 true");
    expect(got).toContain("x86_64-unknown-ps4 false");
  });

  test("ACCEPTED_LLVM_ARGS: the oracle takes each with no output of its own", () => {
    libLLVM();
    for (const arg of ACCEPTED_LLVM_ARGS) {
      for (const target of ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]) {
        const base = ["--print", "cfg", "--target", target];
        const plain = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), ...base], { stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTC_ICE: "0" } });
        const r = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), `-Cllvm-args=${arg}`, ...base], { stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTC_ICE: "0" } });
        expect(`${arg} ${target}: ${r.exitCode} ${r.stderr.toString()}`).toBe(`${arg} ${target}: 0 `);
        expect(r.stdout.toString()).toBe(plain.stdout.toString());
      }
    }
  });
});
