// rust-ts: the IR model's backend driver over the pinned toolchain's own `opt` and `llc` (lane llir-tools; plan-m7 D1, D8, D16).
// rustc runs LLVM in process: `LLVMRustOptimize` builds a pass pipeline and runs it on the module, `LLVMRustWriteOutputFile`
// runs the target machine's codegen passes. The model has no LLVM, so these print the module, run the tool of the same LLVM build
// (`lib/rustlib/<host>/bin/{opt,llc}`, the libLLVM.dylib rustc itself loads; scripts/lib/llvm-tools.ts), and map every
// argument of the wrapper to the tool's command line, following PassWrapper.cpp. An argument no tool flag expresses stops at
// `unported` or carries a `// PORT:` that says why it cannot change the output.
//
// **What a module is after `opt`.** The model cannot read IR text back. Once a tool has rewritten a module, the module keeps its
// handle and its model objects, and its contents are the tool's text (`set_module_text`); every later consumer
// (`LLVMRustPrintModule`, `LLVMRustWriteOutputFile`, `LLVMRustModuleSerialize`, `LLVMCloneModule`, `LLVMWriteBitcodeToFile`) reads
// `module_text`. A model mutation after that point would be lost, so `module_text` compares the model's printed text with the
// text it had when the tool's text was set, and stops if it changed. A *read* of the model after that point (the model's
// objects describe the module before the passes) is not caught by itself. No reachable consumer at the pin does one (review
// llir-tools N5: `create_msvc_imps` is Windows, D18; `LLVMRustModuleInstructionStats` is a stub; `LLVMRustModuleCost` reads
// `module_text`, lane ir-fix-b).
// **A lane that implements a function reading a module's contents from the model** (globals, functions, instructions, counts:
// `LLVMRustModuleCost`, `LLVMRustModuleInstructionStats`, `LLVMGetFirstGlobal`, ...) must call `assert_model_current(M, fn)` first,
// or read `module_text(M)` instead (`LLVMRustModuleCost` must count the `define`s of the text: it picks fat LTO's base module).
//
// **The shared runner (agreed with lane cg-lto-diag, which uses it for fat LTO):** `pinned_tool`, `run_pinned_tool`,
// `run_pinned_tool_or_ice`, `llvm_tmp_dir`, `module_text`, `set_module_text`. A tool failure is ICE-class (D16): the module that
// failed is kept under `$RUST_TS_DATA/tmp/llir/` and the compiler panics (exit 101) with the tool's first error line.
//
// Not ported code (PORTING §5c): markers name the wrapper each function stands for.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LLVM_TOOLS_PINNED, type LlvmTool, llvmBinDir, sha256File } from "../../../scripts/lib/llvm-tools.ts";
import { stdout_write_all } from "../../std/io.ts";
import { panic, unported } from "../../std/panic.ts";
import { LLVMRustSetLastError } from "./core.ts";
import { constants as osConstants } from "node:os";
import { type CodeGenOptLevel, type CodeModel, type FileType, type FloatAbi, LLVMRustResult, type OptStage, type PassBuilderOptLevel, type RelocModel } from "./ffi_types.ts";
import type { TargetMachine } from "./handles.ts";
import { llvm_cl_args, type TargetMachineArgs } from "./target.ts";
import { type Context, Module } from "./ir.ts";
import { printModule } from "./printer.ts";
import type { PtrLenStr, SanitizerOptions } from "./support.ts";
import { oracle_toolchain, spawn_print_sysroot } from "../oracle_sysroot_env.ts";

// ---- the pinned tools ----------------------------------------------------------------------------------------------------

/** The tools this module and lane cg-lto-diag run. */
export type PinnedTool = "opt" | "llc" | "llvm-as" | "llvm-dis" | "llvm-link";

const REPO = join(import.meta.dir, "..", "..", "..");

/** `RUST_TS_DATA` from the environment, else from the repo's `.env.local` (as rustc_session/config.ts reads `RUST_TS_HOST_TUPLE`). */
function rust_ts_data(): string | undefined {
  const v = process.env.RUST_TS_DATA;
  if (v !== undefined && v !== "") return v;
  try {
    for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split(/\r?\n/)) {
      const m = /^\s*RUST_TS_DATA\s*=\s*(\S+)\s*$/.exec(line);
      if (m) return m[1];
    }
  } catch {
    // no .env.local
  }
  return undefined;
}

let SYSROOT: string | undefined;

/**
 * The oracle toolchain's sysroot: `rustc +<UPSTREAM.json rust.toolchain> --print sysroot`, never installing anything
 * (`RUSTUP_AUTO_INSTALL=0`), once per process.
 * PORT: rustc's LLVM is the library it is linked with; the port's is the toolchain the harness pins (plan-m7 D1), found the
 * way scripts/lib/oracle.ts finds it.
 */
export function oracle_sysroot(): string {
  if (SYSROOT !== undefined) return SYSROOT;
  const toolchain = oracle_toolchain();
  const r = spawn_print_sysroot(toolchain);
  if (r.exitCode !== 0) panic(`llir: cannot find the pinned LLVM tools: rustc +${toolchain} --print sysroot failed: ${firstLine(r.stderr)}`);
  // `.trim()`, kept as it was: it equals `default_sysroot`'s removal of the final newline unless the path starts or ends in
  // whitespace (review root-w58-recheck N1).
  return (SYSROOT = r.stdout.trim());
}

/** The host tuple (rustc_session's `host_tuple`, `RUST_TS_HOST_TUPLE`), loaded lazily so the model does not load the session. */
function host(): string {
  const { host_tuple } = require("../../rustc_session/config.ts") as typeof import("../../rustc_session/config.ts");
  return host_tuple();
}

const TOOL_PATHS = new Map<PinnedTool, string>();
/**
 * The absolute path of a pinned tool. A missing tool, or one whose SHA-256 is not the one scripts/lib/llvm-tools.ts pins for this
 * host, is ICE-class: the oracle toolchain is never changed (AGENTS.md), so either means the toolchain is damaged. `llvm-dis` and
 * `llvm-link` have no pinned hash there (only existence is checked).
 */
export function pinned_tool(name: PinnedTool): string {
  const known = TOOL_PATHS.get(name);
  if (known !== undefined) return known;
  const h = host();
  const p = join(llvmBinDir(oracle_sysroot(), h), name);
  if (!existsSync(p)) panic(`llir: the pinned LLVM tool ${name} is missing from the oracle toolchain (lib/rustlib/${h}/bin); never change the toolchain: reinstall it only by the owner's decision`);
  const pinned = (LLVM_TOOLS_PINNED[h] as Partial<Record<string, string>> | undefined)?.[name as LlvmTool];
  if (pinned !== undefined && sha256File(p) !== pinned) panic(`llir: the pinned LLVM tool ${name} differs from the hash scripts/lib/llvm-tools.ts pins, so the oracle toolchain has changed`);
  TOOL_PATHS.set(name, p);
  return p;
}

/** A tool's exit status and output. A death by a signal is `status` 128 + the signal's number, as a shell reports it, with `signal`. */
export interface ToolRun {
  status: number;
  signal: string | undefined;
  stdout: Uint8Array;
  stderr: string;
}

/**
 * Runs a pinned tool in the current directory; the caller judges `status`. A tool killed by a signal (an `LLVM ERROR` aborts,
 * and so does a crash) is a run like any other, with its stderr kept (review llir-tools F3).
 */
export function run_pinned_tool(name: PinnedTool, args: readonly string[], stdin?: Uint8Array): ToolRun {
  const path = pinned_tool(name);
  const r = Bun.spawnSync([path, ...args], { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
  // The tool's own path starts its messages (`<argv0>: ...`) and its stack dumps: keep the machine's paths out of them.
  const stderr = r.stderr.toString().replaceAll(path, name);
  const stdout = new Uint8Array(r.stdout);
  if (r.exitCode !== null) return { status: r.exitCode, signal: undefined, stdout, stderr };
  const signal = String(r.signalCode ?? "unknown signal");
  const signo = (osConstants.signals as Record<string, number>)[signal] ?? 0;
  return { status: 128 + signo, signal, stdout, stderr };
}

/**
 * Runs a pinned tool on `input` (written to its stdin) and returns its stdout; on a non-zero status, keeps `input` as
 * `<what>.<ext>` under `llvm_tmp_dir()` and panics with the tool's first error line (plan-m7 D16: the text is the port's bug).
 */
export function run_pinned_tool_or_ice(name: PinnedTool, args: readonly string[], input: Uint8Array, what: string, ext = "ll"): Uint8Array {
  const r = run_pinned_tool(name, args, input);
  if (r.status !== 0) {
    const kept = keep(input, what, ext);
    panic(`llir: ${name} failed on ${kept} (${r.signal === undefined ? `exit ${r.status}` : `signal ${r.signal}`}): ${firstErrorLine(r.stderr)}`);
  }
  return r.stdout;
}

let TMP: string | undefined;
let KEPT = 0;
/** This process's directory for the tools' files: `$RUST_TS_DATA/tmp/llir/<pid>`, made on first use. */
export function llvm_tmp_dir(): string {
  if (TMP !== undefined) return TMP;
  const data = rust_ts_data();
  if (data === undefined) return unported("llir: a directory for the LLVM tools' files (set RUST_TS_DATA, as .env.local does)");
  TMP = join(data, "tmp", "llir", String(process.pid));
  mkdirSync(TMP, { recursive: true });
  return TMP;
}

/** Writes a failed tool's input for ir-diff; returns its path with `$RUST_TS_DATA` unexpanded, so no machine path is printed. */
function keep(input: Uint8Array, what: string, ext: string): string {
  const dir = llvm_tmp_dir();
  const name = `${KEPT++}-${what.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)}.${ext}`;
  writeFileSync(join(dir, name), input);
  return `$RUST_TS_DATA/tmp/llir/${process.pid}/${name}`;
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim() !== "") ?? "(no message)";
}

/**
 * The tool's first line, and the first line naming an error when that is a later one. The verifier prints its detail first
 * (`Call parameter type does not match function signature!`) and only then `opt: <stdin>: error: input module is broken!` (review
 * llir-tools N4); a parse error or an `LLVM ERROR:` is the first line itself.
 */
function firstErrorLine(stderr: string): string {
  const first = firstLine(stderr);
  const error = stderr.split("\n").find((l) => /error/i.test(l));
  return error === undefined || error === first ? first : `${first} (then: ${error})`;
}

// ---- modules held as text ------------------------------------------------------------------------------------------------

interface ToolText {
  /** The module's IR text (`bstr`: one char per byte, as the printer writes). */
  text: string;
  /** The model's printed text when `text` was set: a later difference is a mutation the text does not have. */
  snapshot: string;
}
const TEXT = new WeakMap<Module, ToolText>();

/** The module's current IR text: the tool's text once one is set, else the model's printer. */
export function module_text(M: Module): string {
  const t = TEXT.get(M);
  if (t === undefined) return printModule(M);
  if (printModule(M) !== t.snapshot) return unported(`llir: module ${JSON.stringify(M.moduleID)} was changed through the model after a tool rewrote it (the model cannot read the tool's IR back)`);
  return t.text;
}

/** Makes `text` the module's contents (a tool's output). The first line, `; ModuleID = ...`, is the model's own. */
export function set_module_text(M: Module, text: string): void {
  const snapshot = printModule(M);
  const id = snapshot.slice(0, snapshot.indexOf("\n"));
  // PORT: a tool reading stdin names the module `<stdin>`; rustc's module keeps its identifier (`Module::getModuleIdentifier`) in
  // memory. The identifier is only printed in this comment, so the comment is the model's.
  const body = text.startsWith("; ModuleID = ") ? text.slice(text.indexOf("\n")) : `\n${text}`;
  TEXT.set(M, { text: `${id}${body}`, snapshot });
}

/** `true` once a tool's text is the module's contents. */
export function is_tool_text(M: Module): boolean {
  return TEXT.has(M);
}

/** For a function that reads a module's contents from the model: stops once a tool's text is the module (see the header). */
export function assert_model_current(M: Module, fn: string): void {
  if (TEXT.has(M)) unported(`llir: ${fn} reads module ${JSON.stringify(M.moduleID)} from the model after a tool rewrote it (read module_text instead)`);
}

const bytesOf = (bstr: string): Uint8Array => new Uint8Array(Buffer.from(bstr, "latin1"));
const bstrOf = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

// ---- the target machine --------------------------------------------------------------------------------------------------

/** A live target machine (lane llir-init's, target.ts). */
function tm_(T: TargetMachine): TargetMachine {
  if (T.disposed) panic("llir: a target machine used after LLVMDisposeTargetMachine");
  return T;
}

/**
 * Global target features: the target machine's `Feature` (rustc's `global_llvm_features`, write.rs:202), which LLVM uses for a
 * function without a `target-features` attribute. Neither tool can apply them only there (review llir-tools F1, F2), so a machine
 * that has any stops by name.
 * PORT: llc's `-mattr` is appended to every function's own `target-features` (CommandFlags.cpp:717-728, llc.cpp:728), so the global
 * list would come again after a function's `#[target_feature]` ones and override them (the reviewer's `_mm256_add_epi32` became
 * 128-bit, `_mm256_shuffle_epi8` crashed llc with `Cannot select`). opt without `-mattr` gives a definition without the attribute
 * (`__rust_try`, intrinsic.rs:1751, gets `target-cpu` only) no features, where rustc gives it the global ones, which changes TTI
 * and inline compatibility; opt with `-mattr` would also write the list onto every function it prints. The x86_64-linux and
 * aarch64-apple-darwin machines without `-Ctarget-feature` have none (cg-write's recorded `.tm`s). `LLVMRustOptimize` stops only when a
 * definition lacks them (`definitions_carry_global_features`, lane ir-fix-b: aarch64-unknown-linux-gnu's `+v8a,+outline-atomics`).
 */
/** An attribute group line, with its `"target-features"` value if it has one. */
const ATTR_GROUP_LINE = /^attributes #(\d+) = \{(.*)\}$/gm;
const TARGET_FEATURES_ATTR = /"target-features"="([^"]*)"/;

/**
 * Whether every function definition of a module's text has a `target-features` attribute that starts with `features`, the machine's
 * global features (lane ir-fix-b). rustc writes that attribute on every function it defines from `target_features_attr`
 * (attributes.rs:440: the global features, then the function's own), so this holds unless a definition was made without it (such as
 * `__rust_try`, intrinsic.rs). Then the machine's feature string reaches nothing in a function pass: a target machine builds a
 * function's subtarget, and so its TTI, from the function's own `target-features` and takes its own string only when the attribute is
 * absent (`AArch64TargetMachine::getSubtargetImpl(const Function &)`, and every target's alike).
 */
export function definitions_carry_global_features(text: string, features: string): boolean {
  const groups = new Map<string, string | undefined>();
  for (const m of text.matchAll(ATTR_GROUP_LINE)) groups.set(m[1]!, TARGET_FEATURES_ATTR.exec(m[2]!)?.[1]);
  for (const line of text.split("\n")) {
    if (!line.startsWith("define ")) continue;
    // AsmWriter and the model's printer write a definition's function attributes as one group, `#<n>`, after its parameter list.
    const refs = [...line.matchAll(/ #(\d+)\b/g)];
    if (refs.length !== 1) return false;
    const tf = groups.get(refs[0]![1]!);
    if (tf === undefined || (tf !== features && !tf.startsWith(`${features},`))) return false;
  }
  return true;
}

function stop_on_global_features(tm: TargetMachineArgs, fn: string, why: string): void {
  if (tm.Features !== undefined && tm.Features !== "") unported(`llir: ${fn} with global target features ${JSON.stringify(tm.Features)} (${why}; review llir-tools F1/F2)`);
}

/** `fromRust(LLVMRustRelocModel)` (PassWrapper.cpp:225) as the tools' `-relocation-model` value. */
const RELOC: Readonly<Record<RelocModel, string>> = { Static: "static", PIC: "pic", DynamicNoPic: "dynamic-no-pic", ROPI: "ropi", RWPI: "rwpi", ROPI_RWPI: "ropi-rwpi" };
/** `fromRust(LLVMRustCodeModel)` (PassWrapper.cpp:138) as `-code-model`; `None` is no explicit code model, so no flag. */
const CODE_MODEL: Readonly<Record<CodeModel, string | undefined>> = { Tiny: "tiny", Small: "small", Kernel: "kernel", Medium: "medium", Large: "large", None: undefined };
/** `fromRust(LLVMRustCodeGenOptLevel)` (PassWrapper.cpp:166): `CodeGenOptLevel` None..Aggressive are 0..3. */
const CODEGEN_LEVEL: Readonly<Record<CodeGenOptLevel, string>> = { None: "0", Less: "1", Default: "2", Aggressive: "3" };
/** `fromRust(LLVMRustFloatABI)` (PassWrapper.cpp:249) as `-float-abi`. */
const FLOAT_ABI: Readonly<Record<FloatAbi, string>> = { Default: "default", Soft: "soft", Hard: "hard" };

let CL_ARGS_GIVEN: readonly string[] | undefined;
/**
 * Runs `f` with `args` as the options `LLVMRustSetLLVMOptions` received, for the unit tests and the evidence scripts, which call
 * the wrappers without the driver (and so without `configure_llvm`).
 */
export function with_cl_args<R>(args: readonly string[], f: () => R): R {
  const saved = CL_ARGS_GIVEN;
  CL_ARGS_GIVEN = args;
  try {
    return f();
  } finally {
    CL_ARGS_GIVEN = saved;
  }
}

/** The flags of `-Cllvm-args` and configure_llvm (`LLVMRustSetLLVMOptions`, lane llir-init), forwarded to every opt/llc run. */
function cl_args(): readonly string[] {
  // PORT: `cl::ParseCommandLineOptions` sets process-wide options of the one libLLVM; the tools load the same library, so its
  // options are the same flags on their command lines. One option would differ: `-vector-library` gives opt's and llc's
  // TargetLibraryInfo a vector library (optdriver.cpp:730, llc.cpp:715), where the wrapper's `TargetLibraryInfoImpl(TargetTriple)`
  // has none (review llir-tools N3); it cannot reach here, as `LLVMRustSetLLVMOptions` stops on any option outside its allowlist.
  return CL_ARGS_GIVEN ?? llvm_cl_args();
}

// ---- LLVMRustOptimize --------------------------------------------------------------------------------------------------

/** `fromRust(LLVMRustPassBuilderOptLevel)` (PassWrapper.cpp:190): from LLVM 23, `Os` and `Oz` are `O2`. */
// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:190 fromRust
function fromRust_PassBuilderOptLevel(Level: PassBuilderOptLevel): "O0" | "O1" | "O2" | "O3" {
  switch (Level) {
    case "O0":
      return "O0";
    case "O1":
      return "O1";
    case "O2":
      return "O2";
    case "O3":
      return "O3";
    case "Os":
      return "O2";
    case "Oz":
      return "O2";
  }
}

/** What `LLVMRustOptimize` decided, as an `opt` command line: `-passes=` and the flags standing for its other settings. */
export interface OptPlan {
  /** The module pass pipeline, or `undefined` if the pass manager is empty (nothing to run). */
  passes: string | undefined;
  /** Flags standing for the PipelineTuningOptions, the extension-point callbacks, TargetLibraryInfo and the target machine. */
  flags: string[];
}

/** The arguments of `LLVMRustOptimize` that decide its pipeline. */
export interface OptimizeSettings {
  OptLevel: PassBuilderOptLevel;
  OptStage: OptStage;
  IsLinkerPluginLTO: boolean;
  NoPrepopulatePasses: boolean;
  VerifyIR: boolean;
  LintIR: boolean;
  MergeFunctions: boolean;
  UnrollLoops: boolean;
  SLPVectorize: boolean;
  LoopVectorize: boolean;
  DisableSimplifyLibCalls: boolean;
  SanitizerOptions: SanitizerOptions | undefined;
  ExtraPasses: string;
}

/**
 * `LLVMRustOptimize`'s pipeline construction (PassWrapper.cpp:676-1060), as `opt` flags. Where opt has no flag for a setting the
 * line says so; the stops are the settings plan-m7 D18 leaves out of M7. (The marker is on `LLVMRustOptimize` below.)
 */
export function opt_plan(s: OptimizeSettings, tm: { Reloc: RelocModel; Model: CodeModel; Level: CodeGenOptLevel }): OptPlan {
  const OptLevel = fromRust_PassBuilderOptLevel(s.OptLevel);
  const flags: string[] = [];

  // PipelineTuningOptions PTO.
  // `PTO.LoopUnrolling = UnrollLoops`: opt's `PTO.LoopUnrolling = !DisableLoopUnrolling` (NewPMDriver.cpp:458), exactly.
  if (!s.UnrollLoops) flags.push("-disable-loop-unrolling");
  // `PTO.LoopInterleaving = UnrollLoops`, `PTO.LoopVectorization = LoopVectorize`. PORT: opt's `default<Ox>` alias sets
  // `PTO.LoopVectorization = Ox >= O2` (PassBuilder.cpp:2066) and leaves interleaving on; both reach only `LoopVectorizePass`'s
  // options (PassBuilderPipelines.cpp:1352), which `-interleave-loops` / `-vectorize-loops` also force off (LoopVectorize.cpp:7420),
  // so the pass is the same one (it prints as `interleave-forced-only` / `vectorize-forced-only` in both).
  if (!s.UnrollLoops) flags.push("-interleave-loops=false");
  if (!s.LoopVectorize && (OptLevel === "O2" || OptLevel === "O3")) flags.push("-vectorize-loops=false");
  if (s.LoopVectorize && !(OptLevel === "O2" || OptLevel === "O3")) return unported("llir: LLVMRustOptimize with loop vectorization below O2 (opt's default<Ox> alias turns it off)");
  // `PTO.SLPVectorization = SLPVectorize`. PORT: the alias sets it to `Ox >= O2` (PassBuilder.cpp:2067), so at O2 (and at O3 under
  // `-Cno-vectorize-slp`) opt's pipeline has an `slp-vectorizer` that rustc's does not; `-vectorize-slp=false` makes that pass return
  // at once (SLPVectorizer.cpp:27804), so the IR is unchanged. Checked against the oracle's printed pipelines (tools.test.ts).
  if (!s.SLPVectorize && (OptLevel === "O2" || OptLevel === "O3")) flags.push("-vectorize-slp=false");
  if (s.SLPVectorize && !(OptLevel === "O2" || OptLevel === "O3")) return unported("llir: LLVMRustOptimize with SLP vectorization below O2 (opt's default<Ox> alias turns it off)");
  // `PTO.MergeFunctions = MergeFunctions`: opt's `PTO.MergeFunctions = EnableMergeFunctions` (PassBuilderPipelines.cpp:351), exactly.
  if (s.MergeFunctions) flags.push("-enable-merge-functions");

  // `TargetLibraryInfoImpl(TargetTriple)` and `disableAllFunctions()`: opt does the same for `-disable-simplify-libcalls` (optdriver.cpp:730-734).
  if (s.DisableSimplifyLibCalls) flags.push("-disable-simplify-libcalls");

  // The target machine: `PassBuilder(TM, ...)` gives the passes its TargetTransformInfo. PORT: opt makes its target machine from the
  // module's triple and these flags. `-mcpu` is not passed: opt would write it as `target-cpu` onto every function lacking it,
  // declarations included (CommandFlags.cpp:713), which rustc's text does not have; the passes read a function's CPU from that
  // attribute, which rustc writes on every definition (`__rust_try` too, intrinsic.rs:1751). The machine's `Feature` (global target
  // features) has no faithful opt form, so `LLVMRustOptimize` stops when there are any (`stop_on_global_features`, review
  // llir-tools F2). The rest of TargetOptions only reaches codegen (llc).
  flags.push(`-relocation-model=${RELOC[tm.Reloc]}`);
  const cm = CODE_MODEL[tm.Model];
  if (cm !== undefined) flags.push(`-code-model=${cm}`);
  flags.push(`-codegen-opt-level=${CODEGEN_LEVEL[tm.Level]}`);

  // PGO, instrumentation, self-profiling, plugins and Enzyme are checked by `LLVMRustOptimize` (they stop there).

  // The PipelineStartEP callbacks, in rustc's order.
  const PipelineStartEPCallbacks: string[] = [];
  const OptimizerLastEPCallbacks: string[] = [];
  if (!s.IsLinkerPluginLTO && s.SanitizerOptions !== undefined && s.SanitizerOptions.sanitize_cfi && !s.NoPrepopulatePasses) {
    return unported("llir: LLVMRustOptimize with -Zsanitizer=cfi (LowerTypeTestsPass; sanitizers are out of M7, plan-m7 D18)");
  }
  if (s.VerifyIR) PipelineStartEPCallbacks.push("verify");
  // `LintPass(/*AbortOnError=*/true)` in a module-to-function adaptor.
  if (s.LintIR) PipelineStartEPCallbacks.push("function(lint<abort-on-error>)");
  if (s.SanitizerOptions !== undefined) {
    const so = s.SanitizerOptions;
    if (so.sanitize_dataflow || so.sanitize_memory || so.sanitize_thread || so.sanitize_address || so.sanitize_kernel_address || so.sanitize_hwaddress || so.sanitize_kernel_hwaddress || so.sanitize_realtime) {
      return unported("llir: LLVMRustOptimize with a sanitizer pass (OptimizerLastEP callbacks; sanitizers are out of M7, plan-m7 D18)");
    }
  }

  const MPM: string[] = [];
  let NeedThinLTOBufferPasses = true;
  const IsLTO = s.OptStage === "ThinLTO" || s.OptStage === "FatLTO";
  if (!s.NoPrepopulatePasses) {
    // `PB.registerPipelineStartEPCallback(C)` for each: opt's `-passes-ep-pipeline-start` registers its text the same way
    // (NewPMDriver.cpp `registerEPCallbacks`), and the default pipelines (O0 included) invoke it at the same point.
    if (PipelineStartEPCallbacks.length > 0) flags.push(`-passes-ep-pipeline-start=${PipelineStartEPCallbacks.join(",")}`);
    if (OptimizerLastEPCallbacks.length > 0) flags.push(`-passes-ep-optimizer-last=${OptimizerLastEPCallbacks.join(",")}`);

    // The pre-link pipelines don't support O0 and require using buildO0DefaultPipeline() instead. At the same time, the LTO
    // pipelines do support O0 and using them is required.
    if (OptLevel === "O0" && !IsLTO) {
      // `buildO0DefaultPipeline(OptLevel)`: opt's `default<O0>`.
      MPM.push("default<O0>");
    } else {
      switch (s.OptStage) {
        case "PreLinkNoLTO":
          // (With a ThinLTO buffer, `LLVMRustOptimize` has already stopped.)
          // `buildPerModuleDefaultPipeline(OptLevel)`: opt's `default<Ox>`.
          MPM.push(`default<${OptLevel}>`);
          break;
        case "PreLinkThinLTO":
        case "PreLinkFatLTO":
          // `buildThinLTOPreLinkDefaultPipeline(OptLevel)`: opt's `thinlto-pre-link<Ox>`.
          MPM.push(`thinlto-pre-link<${OptLevel}>`);
          NeedThinLTOBufferPasses = false;
          break;
        case "ThinLTO":
          // `buildThinLTODefaultPipeline(OptLevel, nullptr)`: opt's `thinlto<Ox>` (no import summary).
          MPM.push(`thinlto<${OptLevel}>`);
          break;
        case "FatLTO":
          // `buildLTODefaultPipeline(OptLevel, nullptr)`: opt's `lto<Ox>`.
          MPM.push(`lto<${OptLevel}>`);
          NeedThinLTOBufferPasses = false;
          break;
      }
    }
  } else {
    // We're not building any of the default pipelines but we still want to add the verifier, instrumentation, etc passes if
    // they were requested.
    MPM.push(...PipelineStartEPCallbacks, ...OptimizerLastEPCallbacks);
  }

  if (s.ExtraPasses !== "") MPM.push(s.ExtraPasses);

  if (NeedThinLTOBufferPasses) {
    MPM.push("canonicalize-aliases", "name-anon-globals");
    // #if LLVM_VERSION_GE(23, 0)
    MPM.push("assign-guid");
  }
  return { passes: MPM.length > 0 ? MPM.join(",") : undefined, flags };
}

/** A C string argument with its length (`StringRef(Ptr, Len)`), as text. */
function ptrLen(s: PtrLenStr | undefined, len: number): string {
  if (s === undefined || len === 0) return "";
  const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
  return new TextDecoder().decode(b.subarray(0, len));
}

/** A module holding only `triple`, for asking opt about a pipeline: rustc's PassBuilder has the target machine, so the target's
 *  own passes parse. */
export function triple_probe(triple: string | undefined): Uint8Array {
  return bytesOf(`target triple = "${triple ?? ""}"\n`);
}

/**
 * `PB.parsePassPipeline(MPM, ExtraPasses)` as opt's printed form of the text parsed alone. rustc parses the text on its own: one
 * starting with a function, CGSCC or loop pass is nested whole in one adaptor (PassBuilder::parsePassPipeline), which a parse of
 * the text joined to the rest would not do, so the printed form (which opt checks parses back to the same pipeline) is what gets
 * spliced in. A parse failure is the parser's message, which opt prints as `<argv0>: <message>` (NewPMDriver.cpp).
 */
export function canonical_extra_passes(cl: readonly string[], probe: Uint8Array, text: string): { $: "Ok"; passes: string } | { $: "Err"; message: string } {
  const r = run_pinned_tool("opt", [...cl, `-passes=${text}`, "-print-pipeline-passes", "-disable-verify", "-disable-output", "-"], probe);
  const line = firstLine(r.stderr);
  // A death by a signal is never the parser's message, whatever its first line (review llir-tools-recheck N2).
  if (r.status !== 0 && r.signal === undefined && line.startsWith("opt: ")) return { $: "Err", message: line.slice("opt: ".length) };
  if (r.status !== 0) panic(`llir: opt failed to parse the extra passes ${JSON.stringify(text)}: ${firstErrorLine(r.stderr)}`);
  return { $: "Ok", passes: new TextDecoder().decode(r.stdout).trim() };
}

/** `MPM.printPipeline` then a newline: opt's `-print-pipeline-passes` of `passes` with `args`, without opt's own trailing verifier. */
export function print_pipeline(args: readonly string[], passes: string, probe: Uint8Array): Uint8Array {
  const r = run_pinned_tool("opt", [...args, `-passes=${passes}`, "-print-pipeline-passes", "-disable-verify", "-disable-output", "-"], probe);
  if (r.status !== 0) panic(`llir: opt failed to print the pipeline ${JSON.stringify(passes)}: ${firstErrorLine(r.stderr)}`);
  return r.stdout;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:676 LLVMRustOptimize
export function LLVMRustOptimize(
  M: Module,
  TM: TargetMachine,
  OptLevel: PassBuilderOptLevel,
  OptStage: OptStage,
  IsLinkerPluginLTO: boolean,
  NoPrepopulatePasses: boolean,
  VerifyIR: boolean,
  LintIR: boolean,
  ThinLTOBuffer: unknown,
  ThinLTOSummaryBuffer: unknown,
  MergeFunctions: boolean,
  UnrollLoops: boolean,
  SLPVectorize: boolean,
  LoopVectorize: boolean,
  DisableSimplifyLibCalls: boolean,
  _EmitLifetimeMarkers: boolean,
  RunEnzyme: unknown,
  _PrintBeforeEnzyme: boolean,
  _PrintAfterEnzyme: boolean,
  PrintPasses: boolean,
  SanitizerOptions: SanitizerOptions | undefined,
  PGOGenPath: string | undefined,
  PGOUsePath: string | undefined,
  InstrumentCoverage: boolean,
  _InstrProfileOutput: string | undefined,
  PGOSampleUsePath: string | undefined,
  DebugInfoForProfiling: boolean,
  llvm_selfprofiler: unknown,
  _begin_callback: unknown,
  _end_callback: unknown,
  PostEnzymePasses: PtrLenStr | undefined,
  PostEnzymePassesLen: number,
  ExtraPasses: PtrLenStr | undefined,
  ExtraPassesLen: number,
  _LLVMPlugins: PtrLenStr | undefined,
  LLVMPluginsLen: number,
): LLVMRustResult {
  const tm = tm_(TM);
  // Global features change nothing opt does when every definition carries them itself (`definitions_carry_global_features`), so opt
  // runs without `-mattr`, which would append them to every function's attribute (lane ir-fix-b). Otherwise they stop by name.
  if (tm.Features === undefined || tm.Features === "" || !definitions_carry_global_features(module_text(M), tm.Features)) {
    stop_on_global_features(tm, "LLVMRustOptimize", "opt cannot give them only to definitions without `target-features`, such as `__rust_try`");
  }
  // `EmitLifetimeMarkers` is not read by the wrapper at the pin.
  if (llvm_selfprofiler !== undefined && llvm_selfprofiler !== null) return unported("llir: LLVMRustOptimize with an LLVM self-profiler (-Z self-profile-events=llvm)");
  if (PGOGenPath !== undefined || PGOUsePath !== undefined || PGOSampleUsePath !== undefined || DebugInfoForProfiling) {
    return unported("llir: LLVMRustOptimize with PGOOptions (-Cprofile-generate/-use, -Zprofile-sample-use, -Zdebug-info-for-profiling)");
  }
  if (LLVMPluginsLen > 0) return unported("llir: LLVMRustOptimize with -Zllvm-plugins (PassPlugin::Load)");
  if (InstrumentCoverage) return unported("llir: LLVMRustOptimize with -Cinstrument-coverage (InstrProfilingLoweringPass; out of M7, plan-m7 D18)");
  if (PostEnzymePassesLen > 0 || (RunEnzyme !== undefined && RunEnzyme !== null)) return unported("excluded (plan-m7 D18): LLVMRustOptimize's Enzyme pipeline");
  void PostEnzymePasses;
  // `ThinLTOBufferRef`: the bitcode for embedding, written by a ThinLTOBitcodeWriterPass (or BitcodeWriterPass) inside the pipeline.
  if (ThinLTOBuffer !== undefined || ThinLTOSummaryBuffer !== undefined) {
    return unported("llir: LLVMRustOptimize's ThinLTO buffer (ThinLTOBitcodeWriterPass inside the pass pipeline: -Cembed-bitcode for an rlib built with link output, --emit=thin-link-bitcode)");
  }

  const cl = cl_args();
  const probe = triple_probe(tm.Triple);

  // `PB.parsePassPipeline(MPM, StringRef(ExtraPasses, ExtraPassesLen))`: a failure is `LLVMRustResult::Failure`, the message the last error.
  let extra = "";
  if (ExtraPassesLen > 0) {
    const r = canonical_extra_passes(cl, probe, ptrLen(ExtraPasses, ExtraPassesLen));
    if (r.$ === "Err") {
      LLVMRustSetLastError(r.message);
      return LLVMRustResult.Failure;
    }
    extra = r.passes;
  }

  const plan = opt_plan(
    { OptLevel, OptStage, IsLinkerPluginLTO, NoPrepopulatePasses, VerifyIR, LintIR, MergeFunctions, UnrollLoops, SLPVectorize, LoopVectorize, DisableSimplifyLibCalls, SanitizerOptions, ExtraPasses: extra },
    tm,
  );
  const args = [...cl, ...plan.flags];

  if (PrintPasses) {
    // `MPM.printPipeline(SOS, ...)` to `outs()`, then a newline: what `opt -print-pipeline-passes` prints, without opt's own trailing
    // verifier (`-disable-verify`). PORT: at O2 and O3 without SLP vectorization opt's pipeline has an `slp-vectorizer` rustc's
    // lacks (`opt_plan`), so the printed text has it too.
    if (plan.passes === undefined) {
      stdout_write_all(new TextEncoder().encode("\n"));
    } else {
      stdout_write_all(print_pipeline(args, plan.passes, probe));
    }
  }

  // Upgrade all calls to old intrinsics first: `UpgradeCallsToIntrinsic` for every function. PORT: the IR parser opt reads the
  // module with runs the same upgrades (`UpgradeCallsToIntrinsic` from LLParser::validateEndOfModule), before any pass.

  // `MPM.run(*TheModule, MAM)`. An empty pass manager changes nothing.
  if (plan.passes === undefined) return LLVMRustResult.Success;
  // PORT: opt verifies the module it reads and, last, the module it writes (`VerifierKind::InputOutput`, optdriver.cpp:622, 797),
  // which rustc does only under `VerifyIR`. The verifier changes no IR; it makes an invalid module from the model a stop (D16)
  // instead of whatever the passes would make of it.
  const out = run_pinned_tool_or_ice("opt", [...args, `-passes=${plan.passes}`, "-S", "-o", "-", "-"], bytesOf(module_text(M)), M.moduleID);
  set_module_text(M, bstrOf(out));
  return LLVMRustResult.Success;
}

// ---- LLVMRustWriteOutputFile ---------------------------------------------------------------------------------------------

/** `Triple::isWasm` / `isOSWindows` of a triple string (`<arch>-<vendor>-<os>[-<env>]`), for `NoTrapAfterNoreturn`. */
function tripleIsWasm(t: string): boolean {
  const arch = t.split("-")[0] ?? "";
  return arch === "wasm32" || arch === "wasm64";
}
function tripleIsOSWindows(t: string): boolean {
  const os = t.split("-")[2] ?? "";
  return os.startsWith("windows") || os.startsWith("win32");
}

/**
 * `llc`'s command line for a target machine: `LLVMRustCreateTargetMachine`'s settings (PassWrapper.cpp:347-438, lane llir-init's
 * target.ts) as the flags llc turns into the same `TargetOptions` (CommandFlags.cpp `InitTargetOptionsFromCodeGenFlags`, llc.cpp
 * `InitializeOptions`). Not a port of the wrapper, so no marker.
 */
export function llc_target_flags(tm: TargetMachineArgs): string[] {
  const flags: string[] = [];
  const triple = tm.Triple ?? "";
  // `Triple(Triple::normalize(TripleStr))`: llc normalizes `-mtriple` the same way (llc.cpp:679).
  flags.push(`-mtriple=${triple}`);
  // PORT: llc writes `-mcpu` as `target-cpu` onto the functions that lack it (CommandFlags.cpp:713, llc.cpp:728), which is where
  // rustc's machine CPU applies too; rustc writes it on every definition.
  if (tm.CPU !== undefined && tm.CPU !== "") flags.push(`-mcpu=${tm.CPU}`);
  // `Feature`: no `-mattr`. llc would append it to every function's own `target-features` (CommandFlags.cpp:717-728), so it stops
  // instead (`stop_on_global_features`, review llir-tools F1).
  stop_on_global_features(tm, "LLVMRustWriteOutputFile", "llc appends -mattr to every function's own target-features, overriding #[target_feature]");
  // PORT: llc clears `Options.VerifyArgABICompliance` (llc.cpp:703), which rustc leaves on. Only SystemZ's argument-extension check
  // reads it (review llir-tools N3), so SystemZ stops.
  if ((triple.split("-")[0] ?? "") === "s390x") unported("llir: llc for SystemZ (llc clears VerifyArgABICompliance, llc.cpp:703)");
  // `Options.MCOptions.ABIName = ABIStr`.
  if (tm.Abi !== undefined && tm.Abi !== "") flags.push(`-target-abi=${tm.Abi}`);
  flags.push(`-relocation-model=${RELOC[tm.Reloc]}`);
  const cm = CODE_MODEL[tm.Model];
  if (cm !== undefined) flags.push(`-code-model=${cm}`);
  flags.push(`-O${CODEGEN_LEVEL[tm.Level]}`);
  // #if LLVM_VERSION_LT(24, 0): `Options.FloatABIType = FloatABIType`.
  flags.push(`-float-abi=${FLOAT_ABI[tm.FloatABIType]}`);
  flags.push(`-data-sections=${tm.DataSections}`);
  flags.push(`-function-sections=${tm.FunctionSections}`);
  flags.push(`-unique-section-names=${tm.UniqueSectionNames}`);
  // `Options.MCOptions.AsmVerbose = VerboseAsm`; `PreserveAsmComments = true` is llc's default (`-preserve-as-comments`).
  flags.push(`-asm-verbose=${tm.VerboseAsm}`);
  if (tm.SplitDwarfFile !== undefined) flags.push(`-split-dwarf-file=${tm.SplitDwarfFile}`);
  // PORT: `Options.ObjectFilenameForDebug = OutputObjFile`: llc sets it to its `-o` file (llc.cpp:696). Only CodeView (COFF)
  // reads it, and Windows targets are out of M7 (plan-m7 D18).
  if (tm.OutputObjFile !== undefined && tripleIsOSWindows(triple)) return unported("llir: ObjectFilenameForDebug on a Windows target (CodeView; plan-m7 D18)");
  // `Options.MCOptions.CompressDebugSections`: llc has no flag for it.
  if (tm.DebugInfoCompression !== "None") return unported("llir: LLVMRustWriteOutputFile with -Zdebuginfo-compression (llc has no flag for MCOptions.CompressDebugSections)");
  flags.push(`-x86-relax-relocations=${tm.RelaxELFRelocations}`);
  flags.push(`-use-ctors=${!tm.UseInitArray}`);
  flags.push(`-emulated-tls=${tm.UseEmulatedTls}`);
  if (tm.TrapUnreachable) {
    // Tell LLVM to codegen `unreachable` into an explicit trap instruction.
    flags.push("-trap-unreachable");
    // But don't emit traps after other traps or no-returns unnecessarily, except on WebAssembly and Windows.
    if (!tripleIsWasm(triple) && !tripleIsOSWindows(triple)) flags.push("-no-trap-after-noreturn");
  }
  // #if LLVM_VERSION_LT(24, 0)
  if (tm.Singlethread) flags.push("-thread-model=single");
  if (tm.UseWasmEH) flags.push("-exception-model=wasm");
  flags.push(`-stack-size-section=${tm.EmitStackSizeSection}`);
  if (tm.LargeDataThreshold !== 0n) flags.push(`-large-data-threshold=${tm.LargeDataThreshold}`);
  return flags;
}

/** `fromRust(LLVMRustFileType)` (PassWrapper.cpp:457) as `-filetype`. */
// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:457 fromRust
function fromRust_FileType(Type: FileType): "asm" | "obj" {
  switch (Type) {
    case "AssemblyFile":
      return "asm";
    case "ObjectFile":
      return "obj";
  }
}

/** `raw_fd_ostream(Path, EC, OF_None)` as a precheck: `undefined` if the file can be created, else stops (see the PORT). */
function openForWrite(Path: string | undefined, fn: string): LLVMRustResult | undefined {
  // A null path is `StringRef()`, whose `open` fails with ENOENT (as core.ts's LLVMRustPrintModule).
  if (Path === undefined || Path === "") {
    LLVMRustSetLastError("No such file or directory");
    return LLVMRustResult.Failure;
  }
  try {
    writeFileSync(Path, new Uint8Array(0));
  } catch (e) {
    // PORT: `std::error_code::message()` is the C library's strerror text, which Node does not expose: stop rather than guess it.
    return unported(`llir: ${fn} could not open ${JSON.stringify(Path)} (${(e as Error).message}): raw_fd_ostream's error message`);
  }
  return undefined;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:469 LLVMRustWriteOutputFile
export function LLVMRustWriteOutputFile(T: TargetMachine, M: Module, Output: string | undefined, DwoOutput: string | undefined, FileType: FileType, VerifyIR: boolean, DisableSimplifyLibCalls: boolean): LLVMRustResult {
  const tm = tm_(T);
  // The legacy pass manager with the target's TargetTransformInfo, a TargetLibraryInfo (all functions disabled under
  // `DisableSimplifyLibCalls`, as llc's `-disable-simplify-libcalls`, llc.cpp:718) and RuntimeLibraryInfo from the target
  // options: what llc's own `compileModule` adds (llc.cpp:715-764). PORT: llc's TargetLibraryInfo also takes the vector library of
  // `-vector-library` (llc.cpp:715), the wrapper's none; that option cannot reach llc (`cl_args`).
  const args = [...cl_args(), ...llc_target_flags(tm), `-filetype=${fromRust_FileType(FileType)}`];
  if (DisableSimplifyLibCalls) args.push("-disable-simplify-libcalls");
  // `addPassesToEmitFile(*PM, BOS, DwoOut, FileType, !VerifyIR)`: llc's `-disable-verify` is the same `DisableVerify` (llc.cpp:840).
  // PORT: without it llc verifies its input first (llc.cpp:723), which changes nothing but a failure (D16).
  if (!VerifyIR) args.push("-disable-verify");

  const failed = openForWrite(Output, "LLVMRustWriteOutputFile");
  if (failed !== undefined) return failed;
  if (DwoOutput !== undefined) {
    // `auto DOS = raw_fd_ostream(DwoPath, EC, ...); EC.clear(); if (EC) ...`: upstream's check of the DWO file can never fire.
    // PORT: llc opens the file itself, and fails (an ICE, D16) where upstream would write to a broken stream (review llir-tools N2;
    // reached only with -Csplit-debuginfo, D18).
    args.push(`-split-dwarf-output=${DwoOutput}`);
  }
  args.push("-o", Output!, "-");
  run_pinned_tool_or_ice("llc", args, bytesOf(module_text(M)), M.moduleID);
  return LLVMRustResult.Success;
}

// ---- modules and buffers -------------------------------------------------------------------------------------------------

/** `LLVMRustBuffer` (RustWrapper.cpp): bytes owned by the wrapper until `LLVMRustBufferFree`. */
export class LLVMRustBuffer {
  freed = false;
  constructor(readonly data: Uint8Array) {}
}

function live(p: LLVMRustBuffer): LLVMRustBuffer {
  if (p.freed) panic("llir: an LLVMRustBuffer used after LLVMRustBufferFree");
  return p;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1477 LLVMRustBufferFree
export function LLVMRustBufferFree(Buffer: LLVMRustBuffer): void {
  live(Buffer).freed = true;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1479 LLVMRustBufferPtr
export function LLVMRustBufferPtr(Buffer: LLVMRustBuffer): Uint8Array | undefined {
  return live(Buffer).data;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1483 LLVMRustBufferLen
export function LLVMRustBufferLen(Buffer: LLVMRustBuffer): number {
  return live(Buffer).data.length;
}

/** The first line of a function in a module's text: AsmWriter's `printFunction` (AsmWriter.cpp:4166-4173) starts it with `declare`
 *  followed by a space or by metadata attachments and a space, or with `define `, at the start of a line; no other top-level line
 *  starts so (an instruction is indented, a string constant has no raw newline). */
const FUNCTION_LINE = /^(?:define|declare) /gm;

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1487 LLVMRustModuleCost
/** `std::distance` over `Module::functions()`: the number of the module's functions, definitions and declarations alike. It picks
 *  fat LTO's base module (lto.rs:247-254), after the pre-LTO `opt` run has rewritten the modules, so it reads `module_text` (header):
 *  `printModule` prints every function of the module's list (`for (const Function &F : *M)`, AsmWriter.cpp:3191). */
export function LLVMRustModuleCost(M: Module): bigint {
  return BigInt(module_text(M).match(FUNCTION_LINE)?.length ?? 0);
}

/** A module flag named `EnableSplitLTOUnit` in a module's text (`!<n> = !{i32 <behavior>, !"EnableSplitLTOUnit", ...}`). */
const SPLIT_LTO_UNIT_FLAG = /^!\d+ = !\{i32 \d+, !"EnableSplitLTOUnit", /m;
/** A module flag named `ThinLTO` in a module's text. */
const THIN_LTO_FLAG = /^!\d+ = !\{i32 \d+, !"ThinLTO", /m;
/** The `!llvm.module.flags` line of a module's text, and a numbered metadata definition. */
const MODULE_FLAGS_LINE = /^!llvm\.module\.flags = !\{(.*)\}$/m;
const METADATA_DEF = /^!(\d+) = /gm;

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:661 forceFullLTOSummary
/** The module's text with a `ThinLTO` module flag of 0 (`Module::Error`, 1), unless it has one already (lane ir-fix-b).
 *  `M->addModuleFlag` appends the flag node to `!llvm.module.flags`: in the text, a new metadata node (numbered after the highest,
 *  the parser renumbers them all) and its reference last in that line. */
export function forceFullLTOSummary(text: string): string {
  // This function may be called twice, such as if you call it with `-C lto=fat --emit=llvm-bc`, so exit early if if we've already
  // set up the module to emit full LTO summaries. (`assert(Const->getZExtValue() == 0)`: an assertion, off in the oracle's build.)
  if (THIN_LTO_FLAG.test(text)) return text;
  const flags = MODULE_FLAGS_LINE.exec(text);
  // PORT: a module without module flags would get a new `!llvm.module.flags` at the end of its named metadata; rustc gives every
  // module flags (context.rs), so that case is a stop rather than text placed by guess.
  if (flags === null) return unported("llir: forceFullLTOSummary of a module without !llvm.module.flags");
  let next = 0;
  for (const m of text.matchAll(METADATA_DEF)) next = Math.max(next, Number(m[1]) + 1);
  const line = `!llvm.module.flags = !{${flags[1] === "" ? "" : `${flags[1]}, `}!${next}}`;
  const body = text.slice(0, flags.index) + line + text.slice(flags.index + flags[0].length);
  return `${body}${body.endsWith("\n") ? "" : "\n"}!${next} = !{i32 1, !"ThinLTO", i32 0}\n`;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1523 LLVMRustModuleSerialize
export function LLVMRustModuleSerialize(M: Module, is_thin: boolean): LLVMRustBuffer {
  assert_types_unmerged(M);
  if (!is_thin) {
    // #if LLVM_VERSION_GE(23, 0): `MPM.addPass(AssignGUIDPass())`; then `forceFullLTOSummary(unwrap(M))` (it runs while the pipeline is
    // built, before `MPM.run`, so the flag is in the module the pass sees) and `BitcodeWriterPass(OS, false, /*EmitSummaryIndex=*/true)`.
    // Both change the module itself, so its text becomes the flagged text after `assign-guid` (lane ir-fix-b).
    const guid = run_pinned_tool_or_ice("opt", ["-passes=assign-guid", "-S", "-o", "-", "-"], bytesOf(forceFullLTOSummary(module_text(M))), M.moduleID);
    set_module_text(M, bstrOf(guid));
    // `BitcodeWriterPass` with a summary index: opt's bitcode output with `--module-summary` (`EmitSummaryIndex`), and the use-list
    // order off as rustc passes it (`-preserve-bc-uselistorder=false`, as the ThinLTO case below). `assign-guid` again is a no-op.
    // The summary's module path is opt's `<stdin>`, not the module's identifier. Fat LTO's linker (lto.rs:296, `LLVMRustLinkerAdd`)
    // reads the module and not the summary; `--emit=llvm-bc -Clto=fat` writes these bytes to the user's `.bc` (write.rs:984), and
    // bitcode bytes are not compared (plan-m7 D2).
    const bc = run_pinned_tool_or_ice("opt", ["--module-summary", "-preserve-bc-uselistorder=false", "-passes=assign-guid", "-o", "-", "-"], bytesOf(module_text(M)), M.moduleID);
    return new LLVMRustBuffer(bc);
  }
  // opt `--thinlto-bc` always adds an `EnableSplitLTOUnit` module flag (below). rustc writes one itself under `-Zsplit-lto-unit` or
  // CFI (context.rs:297-303); a second flag of that name breaks the module, and opt aborts. So such a module stops by name, before any
  // opt run (review llir-tools-recheck R1).
  if (SPLIT_LTO_UNIT_FLAG.test(module_text(M))) {
    return unported("llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag (-Zsplit-lto-unit or CFI): opt --thinlto-bc always adds another (optdriver.cpp:724); review llir-tools-recheck R1");
  }
  // #if LLVM_VERSION_GE(23, 0): `MPM.addPass(AssignGUIDPass())`, which changes the module itself.
  const guid = run_pinned_tool_or_ice("opt", ["-passes=assign-guid", "-S", "-o", "-", "-"], bytesOf(module_text(M)), M.moduleID);
  set_module_text(M, bstrOf(guid));
  // `ThinLTOBitcodeWriterPass(OS, nullptr)`: opt's `--thinlto-bc` (NewPMDriver.cpp:542).
  // - Its `ShouldPreserveUseListOrder` defaults to false; opt passes true (optdriver.cpp:809), which the writer's own
  //   `-preserve-bc-uselistorder=false` overrides (BitcodeWriter.cpp:117, :221) (review llir-tools F4).
  // - PORT: opt always gives the written module an `EnableSplitLTOUnit` flag of 0 (`addModuleFlag`, optdriver.cpp:724, no check of an
  //   existing one; a module that has one stopped above). A flag of 0 reads as absent (`enableSplitLTOUnit`). On tools_oracle/opt.rs
  //   that flag (and the metadata numbers after it) is the only difference in the disassembly from rustc's own `--emit=llvm-bc`
  //   (tools.test.ts). The disassembly has no use lists, so it does not show the use-list part, which is the writer option's.
  const bc = run_pinned_tool_or_ice("opt", ["--thinlto-bc", "-preserve-bc-uselistorder=false", "-passes=assign-guid", "-o", "-", "-"], bytesOf(module_text(M)), M.moduleID);
  return new LLVMRustBuffer(bc);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1561 LLVMRustParseBitcodeForLTO
export function LLVMRustParseBitcodeForLTO(Context: Context, data: Uint8Array | undefined, len: number, identifier: string | undefined): Module | undefined {
  // `enableDebugTypeODRUniquing()`: the model keeps no debug type map (debuginfo is lane llir-di's).
  // `parseBitcodeFile(MemoryBufferRef(Data, identifier), Context)`: a new module named `identifier`.
  // PORT: the bytes come from this module's own buffers, so a parse failure is the port's bug (D16), not rustc's error path.
  const bytes = (data ?? new Uint8Array(0)).subarray(0, len);
  const text = run_pinned_tool_or_ice("llvm-dis", ["-o", "-", "-"], bytes, identifier ?? "bitcode", "bc");
  const M = new Module(Context, identifier ?? "");
  set_module_text(M, bstrOf(text));
  return M;
}

// PORT: `LLVMCloneModule` is defined in llvm/lib/Transforms/Utils/CloneModule.cpp, which harness/llvm-manifest.json does not pin (this lane
// writes nothing under $RUST_TS_DATA/llvm-src), so it carries no `// llvm:` marker.
export function LLVMCloneModule(M: Module): Module {
  // `CloneModule(*unwrap(M))`: a module of the same identifier and context, with the same contents.
  const clone = new Module(M.context, M.moduleID);
  set_module_text(clone, module_text(M));
  if (MERGED_TYPES.has(M)) MERGED_TYPES.add(clone);
  return clone;
}

// llvm: llvm/lib/Bitcode/Writer/BitWriter.cpp:20 LLVMWriteBitcodeToFile
export function LLVMWriteBitcodeToFile(M: Module, Path: string | undefined): number {
  assert_types_unmerged(M);
  // `raw_fd_ostream OS(Path, EC, sys::fs::OF_None); if (EC) return -1;`
  if (Path === undefined || Path === "") return -1;
  try {
    writeFileSync(Path, new Uint8Array(0));
  } catch {
    return -1;
  }
  // `WriteBitcodeToFile(*unwrap(M), OS)`: the same writer in llvm-as, without a summary. Its `ShouldPreserveUseListOrder` defaults
  // to false; llvm-as passes true (llvm-as.cpp:98), which `-preserve-bc-uselistorder=false` overrides (BitcodeWriter.cpp:117, :221;
  // review llir-tools F4).
  const bc = run_pinned_tool_or_ice("llvm-as", ["-preserve-bc-uselistorder=false", "-o", "-", "-"], bytesOf(module_text(M)), M.moduleID);
  writeFileSync(Path, bc);
  return 0;
}

// ---- fat LTO: the linker and the restriction pass (lane ir-fix-b) ---------------------------------------------------------

/** `RustLinker` (Linker.cpp): `Linker L(M)` over the destination module. The model keeps the sources' bytes and links them all with
 *  `llvm-link` at `LLVMRustLinkerFree` (see there). */
export class RustLinker {
  /** Copies of the bitcode `LLVMRustLinkerAdd` was given, in order. */
  readonly sources: Uint8Array[] = [];
  freed = false;
  // rustc: compiler/rustc_llvm/llvm-wrapper/Linker.cpp:14 RustLinker
  constructor(readonly Dst: Module) {}
}

function liveLinker(L: RustLinker): RustLinker {
  if (L.freed) panic("llir: a RustLinker used after LLVMRustLinkerFree");
  return L;
}

/** The `source_filename` line of a module's text, if it has one (AsmWriter prints it only when the name is not empty). */
const SOURCE_FILENAME_LINE = /^source_filename = .*$/m;

/** A global variable line or a function (its comment lines, then a `declare` line or a `define` line up to its closing `}`) of a
 *  module's text, by the name AsmWriter prints for it (`@name` or `@"name"`, without the `@`), as its lines. */
interface TextChunk {
  readonly name: string;
  readonly lines: readonly string[];
}

/** A module's text cut where AsmWriter's `printModule` (AsmWriter.cpp:3121-3194) puts its global variables and its functions: the
 *  lines before the globals, the globals (one line each, contiguous), the blank lines between, the functions (one blank line before
 *  each), and the rest. Undefined when the text has a shape this does not cut exactly: an alias or ifunc, an unnamed global or
 *  function (printed by number, which an order change would renumber), or anything unexpected between the pieces. */
interface CutText {
  readonly before: readonly string[];
  readonly globals: TextChunk[];
  readonly between: readonly string[];
  readonly functions: TextChunk[];
  readonly after: readonly string[];
}

const GLOBAL_NAME = /^@("(?:[^"\\]|\\.)*"|[-a-zA-Z$._0-9]+) = /;
const FUNCTION_NAME = / @("(?:[^"\\]|\\.)*"|[-a-zA-Z$._0-9]+)\(/;

/** Whether a function starts at `lines[i]`: a `define` or `declare` line, after any `; ` comment lines (`; Function Attrs: ...`). */
function functionStartsAt(lines: readonly string[], i: number): boolean {
  while (i < lines.length && lines[i]!.startsWith("; ")) i++;
  return i < lines.length && (lines[i]!.startsWith("define ") || lines[i]!.startsWith("declare "));
}

export function cutModuleText(text: string): CutText | undefined {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i]!.startsWith("@") && !functionStartsAt(lines, i)) i++;
  const before = lines.slice(0, i);
  const globals: TextChunk[] = [];
  for (; i < lines.length && lines[i]!.startsWith("@"); i++) {
    const line = lines[i]!;
    const m = GLOBAL_NAME.exec(line);
    if (m === null || /^\d+$/.test(m[1]!)) return undefined;
    // `@name = <keywords> global|constant ...`: the first of these words after the keywords says what it is.
    const kind = line.slice(m[0].length).split(" ").find((w) => w === "global" || w === "constant" || w === "alias" || w === "ifunc");
    if (kind !== "global" && kind !== "constant") return undefined;
    globals.push({ name: m[1]!, lines: [line] });
  }
  const betweenStart = i;
  if (globals.length > 0) while (i < lines.length && lines[i] === "") i++;
  const between = lines.slice(betweenStart, i);
  const functions: TextChunk[] = [];
  while (functionStartsAt(lines, i)) {
    const start = i;
    while (lines[i]!.startsWith("; ")) i++;
    const head = lines[i]!;
    const m = FUNCTION_NAME.exec(head);
    if (m === null || /^\d+$/.test(m[1]!)) return undefined;
    if (head.startsWith("define ")) {
      if (!head.endsWith("{")) return undefined;
      while (i < lines.length && lines[i] !== "}") i++;
      if (i === lines.length) return undefined;
    }
    i++;
    functions.push({ name: m[1]!, lines: lines.slice(start, i) });
    // AsmWriter prints a newline before each function.
    if (lines[i] === "" && functionStartsAt(lines, i + 1)) i++;
    else break;
  }
  // Anything else that looks like a global or a function past this point is a shape not cut here.
  const after = lines.slice(i);
  if (after.some((l) => l.startsWith("@") || l.startsWith("define ") || l.startsWith("declare "))) return undefined;
  return { before, globals, between, functions, after };
}

export function joinModuleText(c: CutText): string {
  const functions = c.functions.flatMap((f, k) => (k === 0 ? f.lines : ["", ...f.lines]));
  return [...c.before, ...c.globals.flatMap((g) => g.lines), ...c.between, ...functions, ...c.after].join("\n");
}

/** The name of `keepAllLine`'s global (`[-a-zA-Z$._0-9]` needs no quotes), and its line in llvm-link's output. */
const KEEP_NAME = "rust_ts.fat_lto.keep";
const KEEP_LINE = /^@rust_ts\.fat_lto\.keep = .*\n?/m;

/**
 * A global variable that refers to every function and global variable of the destination (`@rust_ts.fat_lto.keep = global [N x ptr]
 * [ptr @a, ...]`), for llvm-link's first link (`LLVMRustLinkerFree`): an external definition is always linked, and so is everything
 * its initializer refers to, so no local, `linkonce` or `available_externally` definition and no declaration is left out
 * (`ModuleLinker::linkIfNeeded`). Left out of it, as the verifier rejects them there or the `ptr` type does not hold them: intrinsics
 * and the `llvm.*` globals (whose address cannot be taken that way; the globals are appending, so always linked) and values in another address space (a thread-local global is accepted, checked). Such a
 * value can still be left out of the link, and then `restoreDestinationOrder` finds it missing and the order stays llvm-link's.
 */
function keepAllLine(dst: CutText): string | undefined {
  const refs: string[] = [];
  for (const g of dst.globals) {
    const line = g.lines[0]!;
    const words = line.slice(line.indexOf(" = ") + 3).split(" ");
    const keywords = words.slice(0, words.findIndex((w) => w === "global" || w === "constant"));
    // `llvm.used`, `llvm.compiler.used`, `llvm.global_ctors`, ...: the verifier allows no other use of them, and as appending globals
    // they are always linked.
    if (g.name.startsWith("llvm.") || keywords.some((w) => w.startsWith("addrspace("))) continue;
    refs.push(`ptr @${g.name}`);
  }
  for (const f of dst.functions) {
    const head = f.lines.find((l) => l.startsWith("define ") || l.startsWith("declare "))!;
    if (f.name.startsWith("llvm.") || head.slice(0, head.indexOf(` @${f.name}(`)).includes("addrspace(")) continue;
    refs.push(`ptr @${f.name}`);
  }
  if (refs.length === 0 || dst.globals.some((g) => g.name === KEEP_NAME)) return undefined;
  return `@${KEEP_NAME} = global [${refs.length} x ptr] [${refs.join(", ")}]`;
}

/** A named metadata line (`!name = !{...}`; not a numbered node, `!<n> = ...`). */
const NAMED_MD_LINE = /^!([^\s\d][^\s]*) = !\{/;

/**
 * The linked module's text with its named metadata in rustc's order: the destination's, in the destination's order, then the others
 * in llvm-link's. A link never moves a named metadata node of the module it links into, and appends new ones in the order it creates
 * them (`linkNamedMDNodes`, IRMover.cpp:1128), so only llvm-link's first link puts the destination's in another order: it skips
 * `!llvm.module.flags` there and creates it last (`linkModuleFlagsMetadata`). Undefined if a destination node is missing or the lines are
 * not one block, as AsmWriter prints them.
 */
export function restoreNamedMetadataOrder(dstText: string, text: string): string | undefined {
  const names = (ls: readonly string[]): string[] => ls.flatMap((l) => NAMED_MD_LINE.exec(l)?.[1] ?? []);
  const dstNames = names(dstText.split("\n"));
  const lines = text.split("\n");
  const idx = lines.flatMap((l, i) => (NAMED_MD_LINE.test(l) ? [i] : []));
  if (idx.some((v, k) => v !== idx[0]! + k)) return undefined;
  const byName = new Map(idx.map((i) => [NAMED_MD_LINE.exec(lines[i]!)![1]!, lines[i]!]));
  if (!dstNames.every((n) => byName.has(n))) return undefined;
  const dstSet = new Set(dstNames);
  const block = [...dstNames.map((n) => byName.get(n)!), ...idx.map((i) => lines[i]!).filter((l) => !dstSet.has(NAMED_MD_LINE.exec(l)![1]!))];
  lines.splice(idx[0] ?? 0, idx.length, ...block);
  return lines.join("\n");
}

/** The linkage words before a function's name or a global's `global`/`constant`/`alias`/`ifunc` word. */
const LOCAL_LINKAGE = new Set(["private", "internal"]);
/** Linkages whose definition a source's definition may or may not replace (`shouldLinkFromSource`, LinkModules.cpp). */
const REPLACEABLE_LINKAGE = new Set(["linkonce", "linkonce_odr", "weak", "weak_odr", "available_externally", "common", "extern_weak"]);

/** A global line's words before its kind word, and the kind (`global`, `constant`, `alias`, `ifunc`). */
function globalHead(line: string): { words: string[]; kind: string | undefined } {
  const words = line.slice(line.indexOf(" = ") + 3).split(" ");
  const k = words.findIndex((w) => w === "global" || w === "constant" || w === "alias" || w === "ifunc");
  return { words: k === -1 ? words : words.slice(0, k), kind: k === -1 ? undefined : words[k] };
}
/** A function's head line (`define`/`declare`) and its words before ` @name(`. */
function functionHead(lines: readonly string[], name: string): { head: string; words: string[] } {
  const head = lines.find((l) => l.startsWith("define ") || l.startsWith("declare "))!;
  return { head, words: head.slice(0, head.indexOf(` @${name}(`)).split(" ") };
}

/**
 * What the sources' texts link to the destination by name (lane ir-fix-b, review N1). `IRLinker::getLinkedToGlobal` matches a source
 * value to a destination value of the same name unless either is local (IRMover.cpp), so only non-local names count: the functions and
 * aliases a source defines, and the global variables a source declares or defines (each is mapped in the reordering loop,
 * IRMover.cpp:1586, which moves its destination value to the end).
 */
export function sourceLinkNames(srcTexts: readonly string[]): { defines: Set<string>; globals: Set<string> } {
  const defines = new Set<string>();
  const globals = new Set<string>();
  for (const t of srcTexts) {
    for (const line of t.split("\n")) {
      if (line.startsWith("@")) {
        const m = GLOBAL_NAME.exec(line);
        if (m === null) continue;
        const { words, kind } = globalHead(line);
        if (words.some((w) => LOCAL_LINKAGE.has(w))) continue;
        if (kind === "global" || kind === "constant") globals.add(m[1]!);
        else defines.add(m[1]!);
      } else if (line.startsWith("define ")) {
        const m = FUNCTION_NAME.exec(line);
        if (m === null) continue;
        if (line.slice(0, line.indexOf(` @${m[1]}(`)).split(" ").some((w) => LOCAL_LINKAGE.has(w))) continue;
        defines.add(m[1]!);
      }
    }
  }
  return { defines, globals };
}

/**
 * The destination's functions and globals the sources' links replace or move (`touched`), by name (lane ir-fix-b, review N1); undefined
 * when that cannot be told from names alone. A link moves nothing of the module it links into except (IRMover.cpp, `IRLinker::run`
 * and `linkGlobalValueProto`):
 * - a value it replaces (`RAUWWorklist`: the old one erased, the new one created at the end): a non-local destination declaration a
 *   source defines (`ModuleLinker::linkIfNeeded` links a source definition whenever the destination has the name, LinkModules.cpp:380).
 *   A destination `linkonce`, `weak`, `available_externally`, `common` or `extern_weak` definition a source also defines may or may not
 *   be replaced (`shouldLinkFromSource`): undefined;
 * - a non-local global variable a source declares or defines, moved to the end in the source's order (IRMover.cpp:1584), except an
 *   appending one, replaced in place.
 * (A local destination value whose name a source value takes is renamed, `forceRenaming`; `restoreDestinationOrder` then misses it.)
 */
export function touchedBySources(dst: CutText, src: { defines: Set<string>; globals: Set<string> }): Set<string> | undefined {
  const touched = new Set<string>();
  for (const f of dst.functions) {
    if (!src.defines.has(f.name)) continue;
    const { head, words } = functionHead(f.lines, f.name);
    if (words.some((w) => LOCAL_LINKAGE.has(w))) continue;
    if (head.startsWith("declare ")) touched.add(f.name);
    else if (words.some((w) => REPLACEABLE_LINKAGE.has(w))) return undefined;
  }
  for (const g of dst.globals) {
    // An appending global (`llvm.used`, `llvm.global_ctors`, ...) is replaced in place: `linkAppendingVarProto` creates the merged one
    // before it (`InsertBefore = DstGV`, IRMover.cpp:879), and the reordering loop skips appending globals.
    const { words } = globalHead(g.lines[0]!);
    if (words.some((w) => LOCAL_LINKAGE.has(w) || w === "appending")) continue;
    if (src.globals.has(g.name) || src.defines.has(g.name)) touched.add(g.name);
  }
  return touched;
}

/**
 * `out` (the linked module's globals or functions, in llvm-link's order) in rustc's order (lane ir-fix-b): the destination's untouched
 * values in the destination's order (`dst`), then the rest in `out`'s order. Undefined if `out` does not start with exactly the
 * untouched values, so that what `touched` says is checked against llvm-link's own result.
 *
 * Why this is rustc's order: by `touchedBySources`, the untouched values keep their relative order through every link, ahead of what
 * the links created or moved, and what follows them depends only on the sources and on the set of names in the module, not on its
 * order. rustc starts from the destination's order, llvm-link from its first link's: so `out` is the untouched values in another order,
 * then the same tail.
 */
export function restoreDestinationOrder(dst: readonly TextChunk[], out: readonly TextChunk[], touched: ReadonlySet<string>): TextChunk[] | undefined {
  const untouched = dst.filter((x) => !touched.has(x.name));
  const names = new Set(untouched.map((x) => x.name));
  if (names.size !== untouched.length) return undefined;
  const head = out.slice(0, untouched.length);
  if (head.length !== untouched.length || !head.every((x) => names.has(x.name))) return undefined;
  const byName = new Map(head.map((x) => [x.name, x]));
  return [...untouched.map((x) => byName.get(x.name)!), ...out.slice(untouched.length)];
}

/** A whole named struct type definition line (`%T = type ...`). */
const NAMED_TYPE_DEF = /^%(?:"(?:[^"\\]|\\.)*"|[-a-zA-Z$._0-9]+) = type /;
/** Modules whose fat-LTO link merged named struct types of the destination (lane ir-fix-b, review F1). */
const MERGED_TYPES = new WeakSet<Module>();

/** For a function that writes a module's types out (`LLVMRustPrintModule`, `LLVMWriteBitcodeToFile`, `LLVMRustModuleSerialize`): stops
 *  on a module whose fat-LTO link merged named struct types (`LLVMRustLinkerFree`), whose type names are not rustc's. */
export function assert_types_unmerged(M: Module): void {
  if (MERGED_TYPES.has(M)) unported("llir: fat LTO merged named struct types (llvm-link's IRMover; rustc's in-process link keeps them)");
}

// rustc: compiler/rustc_llvm/llvm-wrapper/Linker.cpp:17 LLVMRustLinkerNew
export function LLVMRustLinkerNew(DstRef: Module): RustLinker {
  return new RustLinker(DstRef);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/Linker.cpp:23 LLVMRustLinkerFree
/**
 * `delete L`. In the model this is where the link happens: every source `LLVMRustLinkerAdd` took is linked into the destination
 * module, in order, by one `llvm-link` run, and the result becomes the module's text. lto.rs calls it right after the last
 * `LLVMRustLinkerAdd` (lto.rs:313-327), and reads the module only after it.
 *
 * PORT: `llvm-link` is the pinned tool of the same LLVM build, and each of its inputs goes through the same `Linker::linkInModule`
 * (llvm-link.cpp:450, `Flags::None` for every input) in order. It differs from rustc's in-process link in how the destination gets
 * in: llvm-link links every input, the destination's text first, into a new empty module (`Composite`, llvm-link.cpp:480). That first
 * link is not the identity:
 * - values land in the order IRMover creates them (a function's body maps its callees as it goes), not the destination's; global
 *   variables other than appending ones are moved back to source order (IRMover.cpp:1584). The destination's order is put back when
 *   the values the sources touch can be told by name (`touchedBySources`) and llvm-link's result agrees (`restoreDestinationOrder`);
 *   otherwise the order stays llvm-link's;
 * - the destination's local, `linkonce` and `available_externally` definitions that nothing refers to, and its unused declarations,
 *   would not be linked (`ModuleLinker::linkIfNeeded`, LinkModules.cpp:380-385): the destination's input carries one more global that
 *   refers to them all (`keepAllLine`), whose line is taken out of the result. Where that cannot hold one (an intrinsic, another
 *   address space), or the text has an alias, an ifunc or an unnamed global or function (`cutModuleText`), the order is llvm-link's;
 * - named metadata: `!llvm.module.flags` comes last; put back (`restoreNamedMetadataOrder`);
 * - **isomorphic named struct types of the destination are merged** (`IdentifiedStructTypeSet::findNonOpaque`: the first link maps
 *   the destination's types as a source's, so `%"alloc::alloc::Global" = type {}` and `%"core::marker::PhantomData<..>" = type {}`
 *   become one, where rustc's destination keeps both). This cannot be undone from the text; it changes type names only. The module is
 *   flagged when a type definition line (name and body) of the destination is missing from the result (a merge removes one; a value
 *   the keep global cannot hold can too, a false flag on output that would differ anyway: review ir-fix-b-recheck notes 1, 3), and its
 *   text then stops by name where types reach output: `LLVMRustPrintModule`,
 *   `LLVMWriteBitcodeToFile`, `LLVMRustModuleSerialize` (`assert_types_unmerged`; review F1). Objects carry no type names, so
 *   linking and running are unaffected;
 * - a source local renamed on a name clash gets its `.N` suffix from the module's `ValueSymbolTable` counter (`LastUnique`), which
 *   starts at 0 in llvm-link's new module, where rustc's destination keeps the count of its codegen and pre-link passes: a suffix
 *   can differ (review N4), as a DIFF;
 * - the module's `source_filename` is `llvm-link`: put back below from the destination's text, as IRMover never changes it.
 * Code that runs is the same: nothing reachable is dropped and no definition changes. Where the order is llvm-link's, dead
 * definitions are missing or a suffix differs, it shows in `--emit=llvm-ir` text (ir-host) as a DIFF, never as a MATCH; the native
 * suites see the program's behaviour.
 * Other differences avoided: llvm-link enables the debug-info type map (`enableDebugTypeODRUniquing`), which rustc's codegen context
 * does not, so `-disable-debug-info-type-map`; llvm-link's warnings (data layout or triple mismatch, which rustc's diagnostic handler
 * would print) stop by name, as does any failure, kept for ir-diff (D16: the bytes are the port's own or the rlibs').
 */
export function LLVMRustLinkerFree(L: RustLinker): void {
  liveLinker(L).freed = true;
  if (L.sources.length === 0) return;
  const M = L.Dst;
  const dstText = module_text(M);
  const dir = join(llvm_tmp_dir(), `link-${KEPT++}`);
  mkdirSync(dir, { recursive: true });
  const dst = cutModuleText(dstText);
  // The destination with one more global, which refers to every function and global of it (`keepAllLine`), so that llvm-link's first
  // link keeps them all, as rustc's destination does (header); the line is taken out of the result.
  const keep = dst === undefined ? undefined : keepAllLine(dst);
  const files = [join(dir, "dst.ll")];
  writeFileSync(files[0]!, bytesOf(keep === undefined ? dstText : `${dstText}${dstText.endsWith("\n") ? "" : "\n"}${keep}\n`));
  L.sources.forEach((bc, i) => {
    const f = join(dir, `src${i}.bc`);
    writeFileSync(f, bc);
    files.push(f);
  });
  const where = `$RUST_TS_DATA/tmp/llir/${process.pid}/${dir.slice(dir.lastIndexOf("/") + 1)}`;
  const link = (inputs: readonly string[]): string => {
    const r = run_pinned_tool("llvm-link", [...cl_args(), "-disable-debug-info-type-map", "-S", "-o", "-", ...inputs]);
    if (r.status !== 0) panic(`llir: llvm-link failed on ${where} (${r.signal === undefined ? `exit ${r.status}` : `signal ${r.signal}`}): ${firstErrorLine(r.stderr)}`);
    if (r.stderr.trim() !== "") return unported(`llir: LLVMRustLinkerAdd with a linker diagnostic (rustc's diagnostic handler would print it): ${firstLine(r.stderr)} (${where})`);
    return bstrOf(r.stdout);
  };
  const linked = link(files);
  const unkept = (t: string): string => (keep === undefined ? t : t.replace(KEEP_LINE, ""));
  let text = unkept(linked);
  // The destination's order, where the values the sources touch can be told by name; else llvm-link's (header).
  const out = cutModuleText(text);
  if (out !== undefined && dst !== undefined) {
    const srcTexts = L.sources.map((bc, i) => bstrOf(run_pinned_tool_or_ice("llvm-dis", ["-o", "-", "-"], bc, `src${i}`, "bc")));
    const touched = touchedBySources(dst, sourceLinkNames(srcTexts));
    const globals = touched === undefined ? undefined : restoreDestinationOrder(dst.globals, out.globals, touched);
    const functions = touched === undefined ? undefined : restoreDestinationOrder(dst.functions, out.functions, touched);
    if (globals !== undefined && functions !== undefined) text = joinModuleText({ ...out, globals, functions });
  }
  text = restoreNamedMetadataOrder(dstText, text) ?? text;
  // AsmWriter numbers metadata in the order it prints it (named metadata first), so a moved line leaves numbers that a print of the
  // module would not: print it again (opt with no passes: the parser and AsmWriter, as llvm-link's own output).
  if (text !== unkept(linked)) text = bstrOf(run_pinned_tool_or_ice("opt", [...cl_args(), "-S", "-o", "-", "-"], bytesOf(text), M.moduleID));
  const src = SOURCE_FILENAME_LINE.exec(dstText);
  text = text.replace(SOURCE_FILENAME_LINE, src === null ? "" : src[0]);
  // Merged named struct types (header): a definition line of the destination (`%T = type ...`, name and body) that the result no
  // longer has. Whole lines, not names (review ir-fix-b-recheck note 1, root at integ-w59): after a merge frees a name, a later
  // source may define another type under it, so a name check alone would miss the merge.
  const linkedTypes = new Set(text.split("\n").filter((l) => NAMED_TYPE_DEF.test(l)));
  if (dstText.split("\n").some((l) => NAMED_TYPE_DEF.test(l) && !linkedTypes.has(l))) MERGED_TYPES.add(M);
  set_module_text(M, text);
  rmSync(dir, { recursive: true, force: true });
}

// rustc: compiler/rustc_llvm/llvm-wrapper/Linker.cpp:25 LLVMRustLinkerAdd
/** `MemoryBuffer::getMemBufferCopy` of the bytes, kept for `LLVMRustLinkerFree` (which links them). PORT: rustc parses them here
 *  (`getLazyBitcodeModule`) and returns false with the error on a parse failure; the bytes are the port's own buffers or the
 *  rlibs' bitcode, so a failure is the port's bug, and `llvm-link` reports it at the link (D16). */
export function LLVMRustLinkerAdd(L: RustLinker, BC: PtrLenStr | undefined, Len: number): boolean {
  const bytes = typeof BC === "string" ? bytesOf(BC) : (BC ?? new Uint8Array(0));
  liveLinker(L).sources.push(bytes.slice(0, Len));
  return true;
}

/** GlobPattern's special characters (`\`, `*`, `?`, `[`, `]`, `{`, `}`, `,`), each escaped so that a symbol's pattern matches only itself. */
const GLOB_SPECIAL = /[\\*?[\]{},]/g;

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1180 LLVMRustRunRestrictionPass
/**
 * `internalizeModule(*unwrap(M), PreserveFunctions)`, where `PreserveFunctions` keeps a global value whose name is one of `Symbols`.
 * opt's `internalize` pass runs the same `InternalizePass::internalizeModule` (Internalize.cpp:275) with `PreserveAPIList` as its
 * `MustPreserveGV`: a name that matches one of the glob patterns of `-internalize-public-api-file`, one per line (Internalize.cpp:83).
 * Each symbol is written as the pattern that matches only itself (GlobPattern's special characters escaped with `\`), so the two
 * keep the same set. A name with a line break cannot be one line of that file: it stops.
 */
export function LLVMRustRunRestrictionPass(M: Module, Symbols: readonly string[], Len: number): void {
  const syms = Symbols.slice(0, Len);
  if (syms.some((s) => s.includes("\n") || s.includes("\r"))) return unported("llir: LLVMRustRunRestrictionPass with a symbol name holding a line break");
  const file = join(llvm_tmp_dir(), `restriction-${KEPT++}.txt`);
  writeFileSync(file, Buffer.from(syms.map((s) => `${s.replace(GLOB_SPECIAL, "\\$&")}\n`).join(""), "utf8"));
  const out = run_pinned_tool_or_ice("opt", [...cl_args(), "-passes=internalize", `-internalize-public-api-file=${file}`, "-S", "-o", "-", "-"], bytesOf(module_text(M)), M.moduleID);
  set_module_text(M, bstrOf(out));
  rmSync(file, { force: true });
}
