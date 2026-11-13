// rust-ts: helpers shared by tools.test.ts and evidence.ts (lane llir-tools): the settings rustc's ModuleConfig gives
// `LLVMRustOptimize` for a command line, the options configure_llvm gives `LLVMRustSetLLVMOptions`, and a target machine view
// from cg-write's recorded `LLVMRustCreateTargetMachine` arguments (src/rustc_codegen_llvm/back/write_oracle/<target>.tm).
import type { CodeGenOptLevel, CodeModel, CompressionKind, FloatAbi, PassBuilderOptLevel, RelocModel } from "../ffi_types.ts";
import type { OptimizeSettings } from "../tools.ts";

export type Level = "0" | "1" | "2" | "3" | "s" | "z";

/**
 * What configure_llvm (llvm_util.rs:49) passes for x86_64-unknown-linux-gnu and aarch64-apple-darwin with no `-Cllvm-args` and no
 * `-Z` flag that adds one: `-generate-arange-section` (`generate_arange_section`, default true), `-mergefunc-use-aliases` (the default
 * `MergeFunctions::Aliases`), and the two it always adds. Neither target spec overrides either default (`--print target-spec-json`).
 */
export const CL_ARGS: readonly string[] = ["-generate-arange-section", "-mergefunc-use-aliases", "-preserve-alignment-assumptions-during-inlining=false", "-import-cold-multiplier=0.1"];

const PASS_BUILDER: Readonly<Record<Level, PassBuilderOptLevel>> = { "0": "O0", "1": "O1", "2": "O2", "3": "O3", s: "Os", z: "Oz" };
/** `to_llvm_opt_settings` (write.rs:123): the target machine's level for each `-Copt-level`. */
export const CODEGEN_LEVEL: Readonly<Record<Level, CodeGenOptLevel>> = { "0": "None", "1": "Less", "2": "Default", "3": "Aggressive", s: "Default", z: "Default" };

/** The value of `-C<name>=v`, `-C <name>=v`, `-Z<name>=v` or `-Z <name>=v` (the last one wins), or `undefined`. */
function flag(args: readonly string[], kind: "C" | "Z", name: string): string | undefined {
  let v: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const s = a === `-${kind}` ? args[i + 1] : a.startsWith(`-${kind}`) ? a.slice(2) : undefined;
    if (s === undefined) continue;
    if (s === name) v = "";
    else if (s.startsWith(`${name}=`)) v = s.slice(name.length + 1);
  }
  return v;
}

/**
 * ModuleConfig's settings for `LLVMRustOptimize` (rustc_codegen_ssa back/write.rs `ModuleConfig::new` and rustc_codegen_llvm's
 * `llvm_optimize`) for a regular module of a crate without `#![no_builtins]`, at `level`, honouring the flags in `args` that change
 * them. `undefined` for flags this helper does not model (LTO, sanitizers, other CGU counts, `-Cllvm-args`, PGO, coverage).
 */
export function settingsFor(level: Level, args: readonly string[]): OptimizeSettings | undefined {
  const unmodeled = ["lto", "llvm-args", "profile-generate", "profile-use", "instrument-coverage", "embed-bitcode", "linker-plugin-lto"].some((n) => flag(args, "C", n) !== undefined);
  const cgu = flag(args, "C", "codegen-units");
  if (unmodeled || (cgu !== undefined && cgu !== "1") || flag(args, "Z", "sanitizer") !== undefined || flag(args, "Z", "merge-functions") !== undefined) return undefined;
  const optimize = level;
  const size = level === "s" || level === "z";
  return {
    OptLevel: PASS_BUILDER[level],
    OptStage: "PreLinkNoLTO",
    IsLinkerPluginLTO: false,
    NoPrepopulatePasses: flag(args, "C", "no-prepopulate-passes") !== undefined,
    VerifyIR: flag(args, "Z", "verify-llvm-ir") !== undefined,
    LintIR: flag(args, "Z", "lint-llvm-ir") !== undefined,
    // `MergeFunctions::Aliases` (the default): on at O2, O3, Os and Oz.
    MergeFunctions: optimize === "2" || optimize === "3" || size,
    // `unroll_loops = opt_level != Size && opt_level != SizeMin`.
    UnrollLoops: !size,
    SLPVectorize: flag(args, "C", "no-vectorize-slp") === undefined && optimize === "3",
    LoopVectorize: flag(args, "C", "no-vectorize-loops") === undefined && (optimize === "2" || optimize === "3"),
    DisableSimplifyLibCalls: false,
    SanitizerOptions: {
      sanitize_address: false,
      sanitize_address_recover: false,
      sanitize_cfi: false,
      sanitize_dataflow: false,
      sanitize_dataflow_abilist: [],
      sanitize_dataflow_abilist_len: 0,
      sanitize_kcfi: false,
      sanitize_memory: false,
      sanitize_memory_recover: false,
      sanitize_memory_track_origins: 0,
      sanitize_realtime: false,
      sanitize_thread: false,
      sanitize_hwaddress: false,
      sanitize_hwaddress_recover: false,
      sanitize_kernel_address: false,
      sanitize_kernel_address_recover: false,
      sanitize_kernel_hwaddress: false,
      sanitize_kernel_hwaddress_recover: false,
    },
    ExtraPasses: (flag(args, "C", "passes") ?? "").split(/[ ,]+/).filter((p) => p !== "").join(","),
  };
}

const CODE_MODELS: readonly CodeModel[] = ["Tiny", "Small", "Kernel", "Medium", "Large", "None"];
const RELOC_MODELS: readonly RelocModel[] = ["Static", "PIC", "DynamicNoPic", "ROPI", "RWPI", "ROPI_RWPI"];
const LEVELS: readonly CodeGenOptLevel[] = ["None", "Less", "Default", "Aggressive"];
const FLOAT_ABIS: readonly FloatAbi[] = ["Default", "Soft", "Hard"];
const COMPRESSION: readonly CompressionKind[] = ["None", "Zlib", "Zstd"];

/**
 * A target machine with the fields tools.ts reads, from one line of a `<target>.tm` fixture (record.ts's argument form of
 * `LLVMRustCreateTargetMachine`), with `level` in place of the recorded level (the fixtures were recorded at -Copt-level=0).
 */
export function tmFromRecorded(line: string, level?: CodeGenOptLevel): Record<string, unknown> {
  const inner = line.slice(line.indexOf("(") + 1, line.lastIndexOf(")"));
  const a = JSON.parse(`[${inner}]`) as (string | number)[];
  const s = (i: number): string | undefined => (a[i] === "" ? undefined : String(a[i]));
  const b = (i: number): boolean => a[i] === 1;
  return {
    Triple: String(a[0]),
    CPU: String(a[1]),
    Features: String(a[2]),
    Abi: String(a[3]),
    Model: CODE_MODELS[a[4] as number],
    Reloc: RELOC_MODELS[a[5] as number],
    Level: level ?? LEVELS[a[6] as number],
    FloatABIType: FLOAT_ABIS[a[7] as number],
    FunctionSections: b(8),
    DataSections: b(9),
    UniqueSectionNames: b(10),
    TrapUnreachable: b(11),
    Singlethread: b(12),
    VerboseAsm: b(13),
    EmitStackSizeSection: b(14),
    RelaxELFRelocations: b(15),
    UseInitArray: b(16),
    SplitDwarfFile: s(17),
    OutputObjFile: s(18),
    DebugInfoCompression: COMPRESSION[a[19] as number],
    UseEmulatedTls: b(20),
    UseWasmEH: b(21),
    LargeDataThreshold: BigInt(a[22] as number),
  };
}
