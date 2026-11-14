// rust-ts: the IR model's LLVM initialisation, target registry, target machine, MC subtarget, command-line options, error
// handlers and diagnostic handlers (lane llir-init): the calls rustc_codegen_llvm makes on every compile before and around
// codegen (cg-write's list). Not ported code (PORTING §5c): what follows LLVM is marked `// llvm:`, what follows rustc's C++
// wrappers `// rustc: compiler/rustc_llvm/...`.
//
// The target machine is an object that carries what later stages read (lane llir-tools: `LLVMRustOptimize`,
// `LLVMRustWriteOutputFile`): the 23 arguments of `LLVMRustCreateTargetMachine` under the C++ parameter names of ffi.rs, as ffi.ts
// passes them, plus the normalized triple and the data layout LLVM computes for it (`Triple::computeDataLayout`, triple.ts).
//
// PORT decisions (each also at its place):
// - Only the X86 and AArch64 back ends are modelled (the M7 targets, plan-m7 §1f). `initialize_available_targets` registers them as
//   their `LLVMInitialize*` functions do; the other 17 components the oracle's LLVM is built with register nothing, and
//   `lookupTarget` stops for a triple no modelled target matches instead of answering LLVM's "no available targets" error.
// - The model has no `cl::opt` registry: `LLVMRustSetLLVMOptions` accepts the exact arguments of `ACCEPTED_LLVM_ARGS` and stops on
//   any other. It keeps what it accepted for `opt`/`llc` (`llvm_cl_args`), which load the same libLLVM.
// - An MC subtarget's feature bits come from TableGen output that is not in the model: they are answered from an oracle table
//   (subtarget_table.ts), recorded from the pinned libLLVM and checked against it by target.oracle.test.ts. A subtarget whose
//   (triple, CPU, features) the table lacks stops when it is created.
// - `TargetOptions` holds only the fields `LLVMRustCreateTargetMachine` and the modelled target machines set;
//   `codegen::InitTargetOptionsFromCodeGenFlags` is not modelled (its flags are LLVM `cl::opt`s, none of which the model accepts,
//   so they keep their defaults). The effective relocation and code models (`getEffectiveRelocModel`, ...) are not computed:
//   nothing in the model reads them, and `llc` derives them from the same arguments.
import { stderr_write_all } from "../../std/io.ts";
import { assert, unported } from "../../std/panic.ts";
import { LLVMRustSetLastError, NORMAL_TRIPLES } from "./core.ts";
import type { CodeGenOptLevel, CodeModel, CompressionKind, FloatAbi, RelocModel } from "./ffi_types.ts";
import type { Context, Module } from "./ir.ts";
import { MC_SUBTARGET_TABLE } from "./subtarget_table.ts";
import { TRUE, type Bool, type PtrLenStr } from "./support.ts";
import { type ArchType, Triple } from "./triple.ts";

// ---------------------------------------------------------------------------------------------------------------------------
// LLVM initialisation

// llvm: llvm/lib/IR/Core.cpp:4767 LLVMIsMultithreaded
export function LLVMIsMultithreaded(): Bool {
  // return llvm_is_multithreaded();
  // PORT: `llvm_is_multithreaded()` is the oracle libLLVM's build setting `LLVM_ENABLE_THREADS`, which is 1: the recorder sees
  // `1 = LLVMIsMultithreaded()` in every proof script, and target.oracle.test.ts asks the pinned libLLVM.
  return TRUE;
}

/** `fatal_error_handler_t`: `void (*)(void *user_data, const char *reason, bool gen_crash_diag)`. */
type FatalErrorHandler = (UserData: unknown, Reason: string, GenCrashDiag: boolean) => void;

/** `ErrorHandler` / `ErrorHandlerUserData` and `BadAllocErrorHandler` / `BadAllocErrorHandlerUserData` (ErrorHandling.cpp), and
 *  whether `std::set_new_handler` was given `out_of_memory_new_handler`. One process, one thread. */
export const ERROR_HANDLERS: {
  ErrorHandler: FatalErrorHandler | undefined;
  BadAllocErrorHandler: FatalErrorHandler | undefined;
  newHandlerInstalled: boolean;
} = { ErrorHandler: undefined, BadAllocErrorHandler: undefined, newHandlerInstalled: false };

// llvm: llvm/lib/Support/ErrorHandling.cpp:77 install_fatal_error_handler
function install_fatal_error_handler(handler: FatalErrorHandler): void {
  // assert(!ErrorHandler && "Error handler already registered!\n");  (compiled out: the oracle's LLVM is a release build)
  ERROR_HANDLERS.ErrorHandler = handler;
}

// llvm: llvm/lib/Support/ErrorHandling.cpp:159 install_bad_alloc_error_handler
function install_bad_alloc_error_handler(handler: FatalErrorHandler): void {
  // assert(!BadAllocErrorHandler && "Bad alloc error handler already registered!\n");  (compiled out, as above)
  ERROR_HANDLERS.BadAllocErrorHandler = handler;
}

// llvm: llvm/lib/Support/ErrorHandling.cpp:225 install_out_of_memory_new_handler
function install_out_of_memory_new_handler(): void {
  // std::new_handler old = std::set_new_handler(out_of_memory_new_handler);
  // PORT: JS reports allocation failure itself; the model only records that the handler was installed.
  ERROR_HANDLERS.newHandlerInstalled = true;
}

const utf8 = new TextEncoder();

/** Writes `s` to file descriptor 2 as UTF-8 bytes and ignores a failed write, as the handlers' `std::cerr` and `(void)!::write(2,
 *  ...)` do and `report_fatal_error`'s `write_retry` does. It goes through `std/io.ts`'s `stderr_write_all` (never
 *  `process.stderr`, which makes a pipe non-blocking; root at integ-w56, the io.test.ts guard), not `write_stderr`: those C++
 *  writes bypass Rust's `OUTPUT_CAPTURE`, and `write_stderr` would panic on a failed write (review root-w56-recheck nits 1-2). */
function writeStderr(s: string): void {
  void stderr_write_all(utf8.encode(s));
}

// Custom error handler for fatal LLVM errors.
//
// Notably it exits the process with code 101, unlike LLVM's default of 1.
// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:87 FatalErrorHandler
function FatalErrorHandler(UserData: unknown, Reason: string, GenCrashDiag: boolean): never {
  void UserData;
  void GenCrashDiag;
  // Once upon a time we emitted "LLVM ERROR:" specifically to mimic LLVM. Then,
  // we developed crater and other tools which only expose logs, not error
  // codes. Use a more greppable prefix that will still match the "LLVM ERROR:"
  // prefix.
  writeStderr(`rustc-LLVM ERROR: ${Reason}\n`);

  // Since this error handler exits the process, we have to run any cleanup that
  // LLVM would run after handling the error. This might change with an LLVM
  // upgrade.
  //
  // In practice, this will do nothing, because the only cleanup LLVM does is
  // to remove all files that were registered with it via a frontend calling
  // one of the `createOutputFile` family of functions in LLVM and passing true
  // to RemoveFileOnSignal, something that rustc does not do. However, it would
  // be... inadvisable to suddenly stop running these handlers, if LLVM gets
  // "interesting" ideas in the future about what cleanup should be done.
  // We might even find it useful for generating less artifacts.
  // sys::RunInterruptHandlers();  (the model registers no file for removal on a signal, as rustc does not)

  process.exit(101);
}

// Custom error handler for bad-alloc LLVM errors.
//
// It aborts the process without any further allocations, similar to LLVM's
// default except that may be configured to `throw std::bad_alloc()` instead.
// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:115 BadAllocErrorHandler
function BadAllocErrorHandler(UserData: unknown, Reason: string, GenCrashDiag: boolean): never {
  void UserData;
  void GenCrashDiag;
  writeStderr("rustc-LLVM ERROR: out of memory\n");
  writeStderr(Reason);
  writeStderr("\n");
  process.abort();
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:124 LLVMRustInstallErrorHandlers
export function LLVMRustInstallErrorHandlers(): void {
  install_bad_alloc_error_handler(BadAllocErrorHandler);
  install_fatal_error_handler(FatalErrorHandler);
  install_out_of_memory_new_handler();
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:130 LLVMRustDisableSystemDialogsOnCrash
export function LLVMRustDisableSystemDialogsOnCrash(): void {
  DisableSystemDialogsOnCrash();
}

/** `llvm::sys::DisableSystemDialogsOnCrash()`, defined by the host's `Signals.inc`. */
// llvm: llvm/lib/Support/Unix/Signals.inc:991 DisableSystemDialogsOnCrash
function DisableSystemDialogsOnCrash(): void {
  // PORT: Unix/Signals.inc's definition is empty, so nothing is done on a Unix host. A Windows host uses
  // Windows/Signals.inc's, which is not pinned, so it stops by name (fixers-57, review root-w56-check 1).
  if (process.platform === "win32") unported("llir: sys::DisableSystemDialogsOnCrash on a Windows host (llvm/lib/Support/Windows/Signals.inc is not pinned)");
}

/** `report_fatal_error(const Twine &Reason, bool GenCrashDiag = true)`: for model code that reaches one of LLVM's fatal errors. */
// llvm: llvm/lib/Support/ErrorHandling.cpp:103 report_fatal_error
export function report_fatal_error(Reason: string, GenCrashDiag = true): never {
  const handler = ERROR_HANDLERS.ErrorHandler;
  if (handler !== undefined) {
    handler(undefined, Reason, GenCrashDiag);
  } else {
    // Blast the result out to stderr.  We don't try hard to make sure this
    // succeeds (e.g. handling EINTR) and we can't use errs() here because
    // raw ostreams can call report_fatal_error.
    writeStderr(`LLVM ERROR: ${Reason}\n`);
  }

  // If we reached here, we are failing ungracefully. Run the interrupt handlers
  // to make sure any special cleanups get done, in particular that we remove
  // files registered with RemoveFileOnSignal.
  // sys::RunInterruptHandlers();

  if (GenCrashDiag) process.abort();
  else process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Command-line options

/**
 * PORT: the arguments `LLVMRustSetLLVMOptions` accepts (after argv[0], the program name), each an exact string. The model has no
 * `cl::opt` registry, so it cannot parse an argument; it accepts those whose only effect is on LLVM's passes and code generator,
 * which `opt` and `llc` apply (`llvm_cl_args`), and stops on any other.
 * - `configure_llvm`'s own (llvm_util.rs): `-generate-arange-section`, `-mergefunc-use-aliases`,
 *   `-preserve-alignment-assumptions-during-inlining=false`, `-import-cold-multiplier=0.1`;
 * - the `-C llvm-args` values the oracle was seen to accept silently (src/rust_ts/codegen_backend.ts `ORACLE_ACCEPTED_LLVM_ARGS`).
 * target.oracle.test.ts checks that the oracle accepts each with no output (`rustc -Cllvm-args=<arg> --print cfg`).
 */
export const ACCEPTED_LLVM_ARGS: ReadonlySet<string> = new Set([
  "-generate-arange-section",
  "-mergefunc-use-aliases",
  "-preserve-alignment-assumptions-during-inlining=false",
  "-import-cold-multiplier=0.1",
  "-enable-tail-merge=0",
  "--inline-threshold=0",
]);

/** `static bool Initialized` of `LLVMRustSetLLVMOptions`. */
let Initialized = false;
/** What the first `LLVMRustSetLLVMOptions` call parsed, without argv[0]. */
let CL_ARGS: readonly string[] = [];

/** The options `LLVMRustSetLLVMOptions` set (its argv without the program name), or `[]` if it was never called. LLVM's
 *  `cl::opt`s are process-wide; `opt` and `llc` load the same libLLVM, so llir-tools passes these to every run. */
export function llvm_cl_args(): readonly string[] {
  return CL_ARGS;
}

/** Tests only, not upstream: runs `f` as if `LLVMRustSetLLVMOptions` had never been called, then puts the options back as they
 *  were. LLVM's options are process-wide, and one `bun test` process runs every test file, so a test that sets them would
 *  otherwise fix them for every later file, and `opt`/`llc` runs there would get them (root at integ-w56; review
 *  root-w56-check 3, fixers-57). */
export function with_fresh_llvm_options_for_tests<T>(f: () => T): T {
  const saved: [boolean, readonly string[]] = [Initialized, CL_ARGS];
  Initialized = false;
  CL_ARGS = [];
  try {
    return f();
  } finally {
    [Initialized, CL_ARGS] = saved;
  }
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:440 LLVMRustSetLLVMOptions
export function LLVMRustSetLLVMOptions(Argc: number, Argv: readonly string[]): void {
  // Initializing the command-line options more than once is not allowed. So,
  // check if they've already been initialized. (This could happen if we're
  // being called from rustpkg, for example). If the arguments change, then
  // that's just kinda unfortunate.
  if (Initialized) return;
  Initialized = true;
  ParseCommandLineOptions(Argc, Argv);
}

/** `cl::ParseCommandLineOptions(Argc, Argv)` (CommandLine.cpp): PORT, the model's stand-in (header and `ACCEPTED_LLVM_ARGS`). An
 *  accepted argument given twice also stops. LLVM accepts that for these options (each is a `cl::opt` that keeps the last value:
 *  the oracle takes `-enable-tail-merge=0` twice with no output), but the model would then hand `opt`/`llc` the repeat, and
 *  whether every one of those tools' options takes a repeat silently is not checked. Conservative: a stop, never a wrong answer. */
export function ParseCommandLineOptions(Argc: number, Argv: readonly string[]): void {
  const args = Argv.slice(1, Argc);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!ACCEPTED_LLVM_ARGS.has(a)) return unported(`llir: cl::ParseCommandLineOptions of ${JSON.stringify(a)} (the model has no cl::opt registry)`);
    if (args.indexOf(a) !== i) return unported(`llir: cl::ParseCommandLineOptions of ${JSON.stringify(a)} given twice (repeats are not modelled)`);
  }
  CL_ARGS = args;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The target registry (llvm/include/llvm/MC/TargetRegistry.h, llvm/lib/MC/TargetRegistry.cpp)

/** `Target::TargetMachineCtorTy` */
type TargetMachineCtorTy = (T: Target, TT: Triple, CPU: string, Features: string, Options: TargetOptions, RM: RelocModelLLVM, CM: CodeModelLLVM | undefined, OL: CodeGenOptLevel, JIT: boolean) => TargetMachine;
/** `Target::MCSubtargetInfoCtorFnTy` */
type MCSubtargetInfoCtorFnTy = (TT: Triple, CPU: string, Features: string) => MCSubtargetInfo;

/** `class Target`: the fields the model reads. Registration fills them. */
export class Target {
  Next: Target | undefined = undefined;
  Name: string | undefined = undefined;
  ShortDesc = "";
  BackendName = "";
  ArchMatchFn: (Arch: ArchType) => boolean = () => false;
  HasJIT = false;
  TargetMachineCtorFn: TargetMachineCtorTy | undefined = undefined;
  MCSubtargetInfoCtorFn: MCSubtargetInfoCtorFnTy | undefined = undefined;

  // llvm: llvm/include/llvm/MC/TargetRegistry.h:462 createMCSubtargetInfo
  createMCSubtargetInfo(TheTriple: Triple, CPU: string, Features: string): MCSubtargetInfo | undefined {
    if (this.MCSubtargetInfoCtorFn === undefined) return undefined;
    if (!Target.isValidFeatureListFormat(Features)) return undefined;
    return this.MCSubtargetInfoCtorFn(TheTriple, CPU, Features);
  }

  // llvm: llvm/include/llvm/MC/TargetRegistry.h:478 createTargetMachine
  createTargetMachine(TT: Triple, CPU: string, Features: string, Options: TargetOptions, RM: RelocModelLLVM, CM: CodeModelLLVM | undefined, OL: CodeGenOptLevel, JIT = false): TargetMachine | undefined {
    if (this.TargetMachineCtorFn === undefined) return undefined;
    return this.TargetMachineCtorFn(this, TT, CPU, Features, Options, RM, CM, OL, JIT);
  }

  // llvm: llvm/lib/MC/TargetRegistry.cpp:28 isValidFeatureListFormat
  static isValidFeatureListFormat(Features: string): boolean {
    if (Features === "") return true;

    // static const llvm::Regex pattern("^([+-][^,]+)(,[+-][^,]+)*,?$");
    // (POSIX ERE without REG_NEWLINE: `[^,]` matches a newline too, as in JS.)
    return /^([+-][^,]+)(,[+-][^,]+)*,?$/.test(Features);
  }
}

/** `static Target *FirstTarget` (TargetRegistry.cpp:26). */
let FirstTarget: Target | undefined;

/** `TargetRegistry::targets()`: the registered targets, last registered first. */
function* targets(): Generator<Target> {
  for (let T = FirstTarget; T !== undefined; T = T.Next) yield T;
}

/** The components `initialize_available_targets` initialised that the model does not model (header). */
const UNMODELLED_COMPONENTS: string[] = [];

// llvm: llvm/lib/MC/TargetRegistry.cpp:153 lookupTarget
export function lookupTarget(TT: Triple, Error: { value: string }): Target | undefined {
  // Provide special warning when no targets are initialized.
  if (FirstTarget === undefined && UNMODELLED_COMPONENTS.length === 0) {
    Error.value = "Unable to find target for this triple (no targets are registered)";
    return undefined;
  }
  const Arch = TT.getArch();
  const ArchMatch = (T: Target): boolean => T.ArchMatchFn(Arch);
  const all = [...targets()];
  const I = all.findIndex(ArchMatch);

  if (I < 0) {
    // PORT: an unmodelled component's target may match (header).
    if (UNMODELLED_COMPONENTS.length !== 0) return unported(`llir: lookupTarget(${JSON.stringify(TT.str())}): only the X86 and AArch64 targets are modelled`);
    Error.value = `No available targets are compatible with triple "${TT.str()}"`;
    return undefined;
  }

  const J = all.findIndex((T, k) => k > I && ArchMatch(T));
  if (J >= 0) {
    Error.value = `Cannot choose between targets "${all[I]!.Name}" and "${all[J]!.Name}"`;
    return undefined;
  }

  return all[I];
}

// llvm: llvm/lib/MC/TargetRegistry.cpp:180 RegisterTarget
function RegisterTarget(T: Target, Name: string, ShortDesc: string, BackendName: string, ArchMatchFn: (Arch: ArchType) => boolean, HasJIT: boolean): void {
  // assert(Name && ShortDesc && ArchMatchFn && "Missing required target information!");

  // Check if this target has already been initialized, we allow this as a
  // convenience to some clients.
  if (T.Name !== undefined) return;

  // Add to the list of targets.
  T.Next = FirstTarget;
  FirstTarget = T;

  T.Name = Name;
  T.ShortDesc = ShortDesc;
  T.BackendName = BackendName;
  T.ArchMatchFn = ArchMatchFn;
  T.HasJIT = HasJIT;
}

/** `RegisterTarget<TargetArchType, HasJIT>`'s constructor, with its `getArchMatch` (TargetRegistry.h:1077) as the closure. */
// llvm: llvm/include/llvm/MC/TargetRegistry.h:1071 RegisterTarget
function RegisterTargetFor(TargetArchType: ArchType, HasJIT: boolean, T: Target, Name: string, Desc: string, BackendName: string): void {
  RegisterTarget(T, Name, Desc, BackendName, (Arch) => Arch === TargetArchType, HasJIT);
}

// llvm: llvm/include/llvm/MC/TargetRegistry.h:844 RegisterMCSubtargetInfo
function RegisterMCSubtargetInfo(T: Target, Fn: MCSubtargetInfoCtorFnTy): void {
  T.MCSubtargetInfoCtorFn = Fn;
}

// llvm: llvm/include/llvm/MC/TargetRegistry.h:858 RegisterTargetMachine
function RegisterTargetMachine(T: Target, Fn: TargetMachineCtorTy): void {
  T.TargetMachineCtorFn = Fn;
}

// ---- X86 (llvm/lib/Target/X86) ----
const TheX86_32Target = new Target();
const TheX86_64Target = new Target();
// llvm: llvm/lib/Target/X86/TargetInfo/X86TargetInfo.cpp:14 getTheX86_32Target
function getTheX86_32Target(): Target {
  return TheX86_32Target;
}
// llvm: llvm/lib/Target/X86/TargetInfo/X86TargetInfo.cpp:18 getTheX86_64Target
function getTheX86_64Target(): Target {
  return TheX86_64Target;
}

// llvm: llvm/lib/Target/X86/TargetInfo/X86TargetInfo.cpp:23 LLVMInitializeX86TargetInfo
function LLVMInitializeX86TargetInfo(): void {
  RegisterTargetFor("x86", /*HasJIT=*/ true, getTheX86_32Target(), "x86", "32-bit X86: Pentium-Pro and above", "X86");

  RegisterTargetFor("x86_64", /*HasJIT=*/ true, getTheX86_64Target(), "x86-64", "64-bit X86: EM64T and AMD64", "X86");
}

// llvm: llvm/lib/Target/X86/X86TargetMachine.cpp:66 LLVMInitializeX86Target
function LLVMInitializeX86Target(): void {
  // Register the target.
  RegisterTargetMachine(getTheX86_32Target(), X86TargetMachine);
  RegisterTargetMachine(getTheX86_64Target(), X86TargetMachine);
  // initialize*Pass(PR) ...: LLVM's pass registry, which the model does not have (the passes run in `opt`/`llc`).
}

// llvm: llvm/lib/Target/X86/MCTargetDesc/X86MCTargetDesc.cpp:800 LLVMInitializeX86TargetMC
function LLVMInitializeX86TargetMC(): void {
  for (const T of [getTheX86_32Target(), getTheX86_64Target()]) {
    // The MC asm info, instruction info, register info, instruction analyzer, ...: not modelled (nothing reads them).
    // Register the MC subtarget info.
    RegisterMCSubtargetInfo(T, oracleMCSubtargetInfo);
  }
}

/** `RegisterTargetMachine<X86TargetMachine>::Allocator` and the `X86TargetMachine` constructor. */
// llvm: llvm/lib/Target/X86/X86TargetMachine.cpp:187 X86TargetMachine
function X86TargetMachine(T: Target, TT: Triple, CPU: string, FS: string, Options: TargetOptions, RM: RelocModelLLVM, CM: CodeModelLLVM | undefined, OL: CodeGenOptLevel, JIT: boolean): TargetMachine {
  void RM;
  void CM;
  void JIT;
  // : CodeGenTargetMachineImpl(T, TT.computeDataLayout(), TT, CPU, FS, Options, getEffectiveRelocModel(TT, JIT, RM),
  //                            getEffectiveX86CodeModel(TT, CM, JIT), OL)
  const TM = new TargetMachine(T, TT.computeDataLayout(""), TT, CPU, FS, copyTargetOptions(Options), OL);
  // On PS4/PS5, the "return address" of a 'noreturn' call must still be within
  // the calling function. Note that this also includes __stack_chk_fail,
  // so there was some target-specific logic in the instruction selectors
  // to handle that. That code has since been generalized, so the only thing
  // needed is to set TrapUnreachable here.
  if (TT.isPS() || TT.isOSBinFormatMachO()) {
    TM.Options.TrapUnreachable = true;
    TM.Options.NoTrapAfterNoreturn = TT.isOSBinFormatMachO();
  }
  // setMachineOutliner(true); setSupportsDebugEntryValues(true); initAsmInfo();  (code generator state, not modelled)
  return TM;
}

// ---- AArch64 (llvm/lib/Target/AArch64) ----
const TheAArch64leTarget = new Target();
const TheAArch64beTarget = new Target();
const TheAArch64_32Target = new Target();
const TheARM64Target = new Target();
const TheARM64_32Target = new Target();
// llvm: llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp:14 getTheAArch64leTarget
function getTheAArch64leTarget(): Target {
  return TheAArch64leTarget;
}
// llvm: llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp:18 getTheAArch64beTarget
function getTheAArch64beTarget(): Target {
  return TheAArch64beTarget;
}
// llvm: llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp:22 getTheAArch64_32Target
function getTheAArch64_32Target(): Target {
  return TheAArch64_32Target;
}
// llvm: llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp:26 getTheARM64Target
function getTheARM64Target(): Target {
  return TheARM64Target;
}
// llvm: llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp:30 getTheARM64_32Target
function getTheARM64_32Target(): Target {
  return TheARM64_32Target;
}

// llvm: llvm/lib/Target/AArch64/TargetInfo/AArch64TargetInfo.cpp:36 LLVMInitializeAArch64TargetInfo
function LLVMInitializeAArch64TargetInfo(): void {
  // Now register the "arm64" name for use with "-march". We don't want it to
  // take possession of the Triple::aarch64 tags though.
  RegisterTarget(getTheARM64Target(), "arm64", "ARM64 (little endian)", "AArch64", () => false, true);
  RegisterTarget(getTheARM64_32Target(), "arm64_32", "ARM64 (little endian ILP32)", "AArch64", () => false, true);

  RegisterTargetFor("aarch64", /*HasJIT=*/ true, getTheAArch64leTarget(), "aarch64", "AArch64 (little endian)", "AArch64");
  RegisterTargetFor("aarch64_be", /*HasJIT=*/ true, getTheAArch64beTarget(), "aarch64_be", "AArch64 (big endian)", "AArch64");
  RegisterTargetFor("aarch64_32", /*HasJIT=*/ true, getTheAArch64_32Target(), "aarch64_32", "AArch64 (little endian ILP32)", "AArch64");
}

// llvm: llvm/lib/Target/AArch64/AArch64TargetMachine.cpp:239 LLVMInitializeAArch64Target
function LLVMInitializeAArch64Target(): void {
  // Register the target.
  RegisterTargetMachine(getTheAArch64leTarget(), AArch64leTargetMachine);
  RegisterTargetMachine(getTheAArch64beTarget(), AArch64beTargetMachine);
  RegisterTargetMachine(getTheARM64Target(), AArch64leTargetMachine);
  RegisterTargetMachine(getTheARM64_32Target(), AArch64leTargetMachine);
  RegisterTargetMachine(getTheAArch64_32Target(), AArch64leTargetMachine);
  // initialize*(PR) ...: LLVM's pass registry, not modelled.
}

// llvm: llvm/lib/Target/AArch64/MCTargetDesc/AArch64MCTargetDesc.cpp:517 LLVMInitializeAArch64TargetMC
function LLVMInitializeAArch64TargetMC(): void {
  for (const T of [getTheAArch64leTarget(), getTheAArch64beTarget(), getTheAArch64_32Target(), getTheARM64Target(), getTheARM64_32Target()]) {
    // The MC asm info, instruction info, register info, ...: not modelled.
    // Register the MC subtarget info.
    RegisterMCSubtargetInfo(T, oracleMCSubtargetInfo);
  }
}

// llvm: llvm/lib/Target/AArch64/AArch64TargetMachine.cpp:564 AArch64leTargetMachine
function AArch64leTargetMachine(T: Target, TT: Triple, CPU: string, FS: string, Options: TargetOptions, RM: RelocModelLLVM, CM: CodeModelLLVM | undefined, OL: CodeGenOptLevel, JIT: boolean): TargetMachine {
  return AArch64TargetMachine(T, TT, CPU, FS, Options, RM, CM, OL, JIT, true);
}

// llvm: llvm/lib/Target/AArch64/AArch64TargetMachine.cpp:572 AArch64beTargetMachine
function AArch64beTargetMachine(T: Target, TT: Triple, CPU: string, FS: string, Options: TargetOptions, RM: RelocModelLLVM, CM: CodeModelLLVM | undefined, OL: CodeGenOptLevel, JIT: boolean): TargetMachine {
  return AArch64TargetMachine(T, TT, CPU, FS, Options, RM, CM, OL, JIT, false);
}

// llvm: llvm/lib/Target/AArch64/AArch64TargetMachine.cpp:317 computeDefaultCPU
function computeDefaultCPU(TT: Triple, CPU: string): string {
  // if (CPU.empty() && TT.isArm64e()) return "apple-a12";
  // PORT: `isArm64e` reads the sub-architecture, which the model's Triple lacks (triple.ts); an empty CPU stops.
  void TT;
  if (CPU === "") return unported("llir: AArch64 computeDefaultCPU with an empty CPU (Triple::isArm64e reads the sub-architecture)");
  return CPU;
}

// llvm: llvm/lib/Target/AArch64/AArch64TargetMachine.cpp:362 AArch64TargetMachine
function AArch64TargetMachine(T: Target, TT: Triple, CPU: string, FS: string, Options: TargetOptions, RM: RelocModelLLVM, CM: CodeModelLLVM | undefined, OL: CodeGenOptLevel, JIT: boolean, LittleEndian: boolean): TargetMachine {
  void RM;
  void CM;
  void JIT;
  void LittleEndian;
  // : CodeGenTargetMachineImpl(T, TT.computeDataLayout(), TT, computeDefaultCPU(TT, CPU), FS, Options,
  //                            getEffectiveRelocModel(TT, RM), getEffectiveAArch64CodeModel(TT, CM, JIT), OL)
  const TM = new TargetMachine(T, TT.computeDataLayout(""), TT, computeDefaultCPU(TT, CPU), FS, copyTargetOptions(Options), OL);
  // initAsmInfo();

  if (TT.isOSBinFormatMachO()) {
    TM.Options.TrapUnreachable = true;
    TM.Options.NoTrapAfterNoreturn = true;
  }

  // if (getMCAsmInfo().usesWindowsCFI()) { ... TrapUnreachable = true; }: the MC asm info is not modelled. PORT: Windows targets
  // are outside M7 (plan-m7 D18), so a Windows triple stops here.
  if (TT.isOSWindows()) return unported("llir: AArch64TargetMachine on Windows (MCAsmInfo::usesWindowsCFI is not modelled)");

  // `TLSSize` starts at `InitTargetOptionsFromCodeGenFlags`' value, the `-tls-size` cl::opt's default 0 (CommandFlags.cpp; the model
  // accepts no such option).
  if ((TM.Options.TLSSize ?? 0) === 0)
    // default
    TM.Options.TLSSize = 24;
  // The clamps below read `getCodeModel()`, the effective code model, which the model does not compute (header); they can only fire
  // for a TLS size above 24, which no input of the model gives.
  if (TM.Options.TLSSize! > 24) return unported("llir: AArch64TargetMachine TLSSize clamps (the effective code model is not modelled)");
  // if ((getCodeModel() == CodeModel::Small || getCodeModel() == CodeModel::Kernel) && this->Options.TLSSize > 32)
  //   // for the small (and kernel) code model, the maximum TLS size is 4GiB
  //   this->Options.TLSSize = 32;
  // else if (getCodeModel() == CodeModel::Tiny && this->Options.TLSSize > 24)
  //   // for the tiny code model, the maximum TLS size is 1MiB (< 16MiB)
  //   this->Options.TLSSize = 24;

  // The GlobalISel, outliner and SVE settings that follow: code generator state, not modelled.
  return TM;
}

/** The registered MC subtarget constructor of the modelled targets (`X86_MC::createX86MCSubtargetInfo`,
 *  `createAArch64MCSubtargetInfo`). PORT (header): their feature bits are TableGen output, so the subtarget is the oracle table's
 *  entry for these arguments, and an argument list the table lacks stops. */
function oracleMCSubtargetInfo(TT: Triple, CPU: string, FS: string): MCSubtargetInfo {
  const key = mcSubtargetKey(TT.str(), CPU, FS);
  const e = MC_SUBTARGET_TABLE.get(key);
  if (e === undefined) return unported(`llir: MC subtarget ${key} (feature bits are TableGen output; not in subtarget_table.ts)`);
  return new MCSubtargetInfo(TT, CPU, FS, e.features, new Set(e.enabled));
}

/** The oracle table's key: the triple (normalized), CPU and feature string given to `Target::createMCSubtargetInfo`. */
export function mcSubtargetKey(triple: string, CPU: string, FS: string): string {
  return `${triple} ${CPU} "${FS}"`;
}

// ---- the other components ----
/** The `LLVMInitialize<T>TargetInfo/Target/TargetMC/AsmPrinter/AsmParser` of a component the model does not model: PORT
 *  (header), they register nothing; `lookupTarget` then stops instead of failing. */
function unmodelledComponent(component: string): () => void {
  return () => {
    if (!UNMODELLED_COMPONENTS.includes(component)) UNMODELLED_COMPONENTS.push(component);
  };
}

/** The AsmPrinter and AsmParser initialisers of the modelled targets register printers and parsers for `llc`'s code generator,
 *  which the model does not have: they register nothing. */
const noModelState = (): void => {};

/// Initialize targets enabled by the build script via `cfg(llvm_component = "...")`.
/// N.B., this function can't be moved to `rustc_codegen_llvm` because of the `cfg`s.
// rustc: compiler/rustc_llvm/src/lib.rs:73 initialize_available_targets
export function initialize_available_targets(): void {
  // PORT: `cfg(llvm_component = ...)` is set by rustc_llvm's build script from the oracle's `llvm-config --components`. All 19
  // components of this function are present: libLLVM exports each one's `LLVMInitialize*TargetInfo` (target.oracle.test.ts).
  const init_target = (_cfg: string, ...methods: (() => void)[]): void => {
    for (const m of methods) m();
  };
  init_target("x86", LLVMInitializeX86TargetInfo, LLVMInitializeX86Target, LLVMInitializeX86TargetMC, noModelState, noModelState);
  const u = (c: string, n: number): (() => void)[] => Array.from({ length: n }, () => unmodelledComponent(c));
  init_target("arm", ...u("arm", 5));
  init_target("aarch64", LLVMInitializeAArch64TargetInfo, LLVMInitializeAArch64Target, LLVMInitializeAArch64TargetMC, noModelState, noModelState);
  init_target("amdgpu", ...u("amdgpu", 5));
  init_target("avr", ...u("avr", 5));
  init_target("m68k", ...u("m68k", 5));
  init_target("csky", ...u("csky", 5));
  init_target("loongarch", ...u("loongarch", 5));
  init_target("mips", ...u("mips", 5));
  init_target("powerpc", ...u("powerpc", 5));
  init_target("systemz", ...u("systemz", 5));
  init_target("msp430", ...u("msp430", 5));
  init_target("riscv", ...u("riscv", 5));
  init_target("sparc", ...u("sparc", 5));
  init_target("nvptx", ...u("nvptx", 4));
  init_target("hexagon", ...u("hexagon", 5));
  init_target("xtensa", ...u("xtensa", 5));
  init_target("webassembly", ...u("webassembly", 5));
  init_target("bpf", ...u("bpf", 5));
}

/** The components of `initialize_available_targets`, in its order (tests). */
export const AVAILABLE_COMPONENTS: readonly string[] = ["X86", "ARM", "AArch64", "AMDGPU", "AVR", "M68k", "CSKY", "LoongArch", "Mips", "PowerPC", "SystemZ", "MSP430", "RISCV", "Sparc", "NVPTX", "Hexagon", "Xtensa", "WebAssembly", "BPF"];

/** The names `lookupTarget` can see, last registered first (tests). */
export function registeredTargetNames(): string[] {
  return [...targets()].map((t) => t.Name!);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The target machine

/** `Reloc::Model` (llvm/Support/CodeGen.h). */
export type RelocModelLLVM = "Static" | "PIC_" | "DynamicNoPIC" | "ROPI" | "RWPI" | "ROPI_RWPI";
/** `CodeModel::Model` (llvm/Support/CodeGen.h). */
export type CodeModelLLVM = "Tiny" | "Small" | "Kernel" | "Medium" | "Large";

/** The `TargetOptions` fields `LLVMRustCreateTargetMachine` and the modelled target machines set (header); `undefined` is
 *  "as `InitTargetOptionsFromCodeGenFlags` left it". */
export interface TargetOptions {
  FloatABIType?: FloatAbi;
  DataSections?: boolean;
  FunctionSections?: boolean;
  UniqueSectionNames?: boolean;
  MCOptions: {
    AsmVerbose?: boolean;
    PreserveAsmComments?: boolean;
    ABIName?: string;
    SplitDwarfFile?: string;
    CompressDebugSections?: CompressionKind;
    X86RelaxRelocations?: boolean;
  };
  ObjectFilenameForDebug?: string;
  UseInitArray?: boolean;
  EmulatedTLS?: boolean;
  TrapUnreachable?: boolean;
  NoTrapAfterNoreturn?: boolean;
  TLSSize?: number;
  ThreadModel?: "Single";
  ExceptionModel?: "Wasm";
  EmitStackSizeSection?: boolean;
}

/** The arguments of `LLVMRustCreateTargetMachine`, under ffi.rs's parameter names (what llir-tools reads). */
export interface TargetMachineArgs {
  readonly Triple: string | undefined;
  readonly CPU: string | undefined;
  readonly Features: string | undefined;
  readonly Abi: string | undefined;
  readonly Model: CodeModel;
  readonly Reloc: RelocModel;
  readonly Level: CodeGenOptLevel;
  readonly FloatABIType: FloatAbi;
  readonly FunctionSections: boolean;
  readonly DataSections: boolean;
  readonly UniqueSectionNames: boolean;
  readonly TrapUnreachable: boolean;
  readonly Singlethread: boolean;
  readonly VerboseAsm: boolean;
  readonly EmitStackSizeSection: boolean;
  readonly RelaxELFRelocations: boolean;
  readonly UseInitArray: boolean;
  readonly SplitDwarfFile: string | undefined;
  readonly OutputObjFile: string | undefined;
  readonly DebugInfoCompression: CompressionKind;
  readonly UseEmulatedTls: boolean;
  readonly UseWasmEH: boolean;
  readonly LargeDataThreshold: bigint;
}

/** `TargetMachine` (llvm/include/llvm/Target/TargetMachine.h), as the model keeps it: the target, the data layout, the triple, CPU
 *  and features LLVM stores, the options, and (filled by `LLVMRustCreateTargetMachine`) its own arguments. */
export class TargetMachine {
  // The arguments of the `LLVMRustCreateTargetMachine` call that made this machine (`TargetMachineArgs`).
  Triple: string | undefined = undefined;
  CPU: string | undefined = undefined;
  Features: string | undefined = undefined;
  Abi: string | undefined = undefined;
  Model: CodeModel = "None";
  Reloc: RelocModel = "Static";
  Level: CodeGenOptLevel = "None";
  FloatABIType: FloatAbi = "Default";
  FunctionSections = false;
  DataSections = false;
  UniqueSectionNames = false;
  TrapUnreachable = false;
  Singlethread = false;
  VerboseAsm = false;
  EmitStackSizeSection = false;
  RelaxELFRelocations = false;
  UseInitArray = false;
  SplitDwarfFile: string | undefined = undefined;
  OutputObjFile: string | undefined = undefined;
  DebugInfoCompression: CompressionKind = "None";
  UseEmulatedTls = false;
  UseWasmEH = false;
  LargeDataThreshold = 0n;
  /** `TM->setLargeDataThreshold(...)`'s value, when it was called (`LargeDataThreshold != 0`). */
  largeDataThreshold: bigint | undefined = undefined;
  /** `LLVMDisposeTargetMachine` was called. */
  disposed = false;

  // llvm: llvm/lib/Target/TargetMachine.cpp:40 TargetMachine
  constructor(
    readonly TheTarget: Target,
    /** `DL`: the data layout string (`DataLayout` keeps the string it was parsed from). */
    readonly dataLayout: string,
    readonly TargetTriple: Triple,
    readonly TargetCPU: string,
    readonly TargetFS: string,
    readonly Options: TargetOptions,
    /** `OptLevel` (CodeGenTargetMachineImpl). */
    readonly OptLevel: CodeGenOptLevel,
  ) {}

  /** The triple LLVM stores: `Triple::normalize` of the `Triple` argument. */
  get normalizedTriple(): string {
    return this.TargetTriple.str();
  }

  // llvm: llvm/include/llvm/Target/TargetMachine.h:208 createDataLayout
  createDataLayout(): string {
    return this.dataLayout;
  }

  // llvm: llvm/include/llvm/Target/TargetMachine.h:277 setLargeDataThreshold
  setLargeDataThreshold(LRT: bigint): void {
    this.largeDataThreshold = LRT;
  }
}

/** `TargetOptions` taken by value, as the C++ constructors copy it (its `MCOptions` member included). */
function copyTargetOptions(Options: TargetOptions): TargetOptions {
  return { ...Options, MCOptions: { ...Options.MCOptions } };
}

/** `Triple::normalize(StringRef)`: PORT, as `LLVMRustSetNormalizedTarget` (core.ts): only the triples checked to be their own
 *  normal form; any other stops. */
function normalize(Str: string): string {
  if (!NORMAL_TRIPLES.includes(Str)) return unported(`llir: Triple::normalize(${JSON.stringify(Str)})`);
  return Str;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:138 fromRust
function fromRust_CodeModel(Model: CodeModel): CodeModelLLVM | undefined {
  switch (Model) {
    case "Tiny":
      return "Tiny";
    case "Small":
      return "Small";
    case "Kernel":
      return "Kernel";
    case "Medium":
      return "Medium";
    case "Large":
      return "Large";
    case "None":
      return undefined;
  }
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:166 fromRust
function fromRust_CodeGenOptLevel(Level: CodeGenOptLevel): CodeGenOptLevel {
  // LLVMRustCodeGenOptLevel and llvm::CodeGenOptLevel have the same four names.
  return Level;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:225 fromRust
function fromRust_RelocModel(RustReloc: RelocModel): RelocModelLLVM {
  switch (RustReloc) {
    case "Static":
      return "Static";
    case "PIC":
      return "PIC_";
    case "DynamicNoPic":
      return "DynamicNoPIC";
    case "ROPI":
      return "ROPI";
    case "RWPI":
      return "RWPI";
    case "ROPI_RWPI":
      return "ROPI_RWPI";
  }
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:249 fromRust
function fromRust_FloatABI(RustFloatAbi: FloatAbi): FloatAbi {
  // FloatABI::Default / Soft / Hard: the same three names.
  return RustFloatAbi;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:268 fromRust
function fromRust_CompressionKind(Kind: CompressionKind): CompressionKind {
  switch (Kind) {
    case "None":
      return "None";
    case "Zlib":
    case "Zstd":
      // if (!llvm::compression::zlib::isAvailable()) report_fatal_error(...) (zstd alike)
      // PORT: whether the oracle's LLVM has zlib or zstd is `LLVMRustLLVMHasZlibCompression` / `...Zstd`'s answer, a stop in the
      // model, which rustc asks before it passes either here.
      return unported(`llir: LLVMRustCompressionKind::${Kind} (compression availability is not modelled)`);
  }
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:347 LLVMRustCreateTargetMachine
export function LLVMRustCreateTargetMachine(
  TripleStr: string | undefined,
  CPU: string | undefined,
  Feature: string | undefined,
  ABIStr: string | undefined,
  RustCM: CodeModel,
  RustReloc: RelocModel,
  RustOptLevel: CodeGenOptLevel,
  RustFloatABIType: FloatAbi,
  FunctionSections: boolean,
  DataSections: boolean,
  UniqueSectionNames: boolean,
  TrapUnreachable: boolean,
  Singlethread: boolean,
  VerboseAsm: boolean,
  EmitStackSizeSection: boolean,
  X86RelaxRelocations: boolean,
  UseInitArray: boolean,
  SplitDwarfFile: string | undefined,
  OutputObjFile: string | undefined,
  DebugInfoCompression: CompressionKind,
  UseEmulatedTls: boolean,
  UseWasmEH: boolean,
  LargeDataThreshold: bigint,
): TargetMachine | undefined {
  const OptLevel = fromRust_CodeGenOptLevel(RustOptLevel);
  const RM = fromRust_RelocModel(RustReloc);
  const CM = fromRust_CodeModel(RustCM);
  const FloatABIType = fromRust_FloatABI(RustFloatABIType);

  const Error = { value: "" };
  // `Triple(Triple::normalize(TripleStr))`: a null `const char*` is the empty StringRef.
  const Trip = new Triple(normalize(TripleStr ?? ""));
  const TheTarget = lookupTarget(Trip, Error);
  if (TheTarget === undefined) {
    LLVMRustSetLastError(Error.value);
    return undefined;
  }

  // TargetOptions Options = codegen::InitTargetOptionsFromCodeGenFlags(Trip);  (header)
  const Options: TargetOptions = { MCOptions: {} };

  // #if LLVM_VERSION_LT(24, 0)  (the pin is LLVM 23)
  Options.FloatABIType = FloatABIType;
  Options.DataSections = DataSections;
  Options.FunctionSections = FunctionSections;
  Options.UniqueSectionNames = UniqueSectionNames;
  Options.MCOptions.AsmVerbose = VerboseAsm;
  // Always preserve comments that were written by the user
  Options.MCOptions.PreserveAsmComments = true;
  // `ABIName = ABIStr`: a `std::string` from a `const char*` (rustc never passes null).
  Options.MCOptions.ABIName = ABIStr ?? unported("llir: LLVMRustCreateTargetMachine with a null ABIStr");
  if (SplitDwarfFile !== undefined) {
    Options.MCOptions.SplitDwarfFile = SplitDwarfFile;
  }
  if (OutputObjFile !== undefined) {
    Options.ObjectFilenameForDebug = OutputObjFile;
  }
  // To avoid fatal errors, make sure the Rust-side code only passes a
  // compression kind that is known to be supported by this build of LLVM, via
  // `LLVMRustLLVMHasZlibCompression` and `LLVMRustLLVMHasZstdCompression`.
  Options.MCOptions.CompressDebugSections = fromRust_CompressionKind(DebugInfoCompression);
  Options.MCOptions.X86RelaxRelocations = X86RelaxRelocations;
  Options.UseInitArray = UseInitArray;
  Options.EmulatedTLS = UseEmulatedTls;

  if (TrapUnreachable) {
    // Tell LLVM to codegen `unreachable` into an explicit trap instruction.
    // This limits the extent of possible undefined behavior in some cases, as
    // it prevents control flow from "falling through" into whatever code
    // happens to be laid out next in memory.
    Options.TrapUnreachable = true;
    // But don't emit traps after other traps or no-returns unnecessarily.
    // ...except for when targeting WebAssembly, because the NoTrapAfterNoreturn
    // option causes bugs in the LLVM WebAssembly backend. You should be able to
    // remove this check when Rust's minimum supported LLVM version is >= 18
    // https://github.com/llvm/llvm-project/pull/65876
    //
    // Also keep traps after noreturn calls on Windows, because the trap is
    // needed to keep the return address within the calling function's
    // .pdata range. Without it, RtlLookupFunctionEntry resolves the wrong
    // function and SEH unwinding (used for backtraces) terminates early.
    // See https://github.com/rust-lang/rust/issues/140489
    // (`Trip.isWasm()`: the arch is wasm32 or wasm64, Triple.h.)
    if (!(Trip.getArch() === "wasm32" || Trip.getArch() === "wasm64") && !Trip.isOSWindows()) {
      Options.NoTrapAfterNoreturn = true;
    }
  }

  // #if LLVM_VERSION_LT(24, 0)
  if (Singlethread) {
    Options.ThreadModel = "Single";
  }

  if (UseWasmEH) Options.ExceptionModel = "Wasm";

  Options.EmitStackSizeSection = EmitStackSizeSection;

  // `std::string`s from `const char*`s (rustc never passes null for these).
  const TM = TheTarget.createTargetMachine(Trip, CPU ?? "", Feature ?? "", Options, RM, CM, OptLevel);
  if (TM === undefined) return unported("llir: LLVMRustCreateTargetMachine: the target registered no target machine");

  if (LargeDataThreshold !== 0n) {
    TM.setLargeDataThreshold(LargeDataThreshold);
  }

  // The model keeps the call's own arguments on the machine (header).
  Object.assign(TM, {
    Triple: TripleStr,
    CPU,
    Features: Feature,
    Abi: ABIStr,
    Model: RustCM,
    Reloc: RustReloc,
    Level: RustOptLevel,
    FloatABIType: RustFloatABIType,
    FunctionSections,
    DataSections,
    UniqueSectionNames,
    TrapUnreachable,
    Singlethread,
    VerboseAsm,
    EmitStackSizeSection,
    RelaxELFRelocations: X86RelaxRelocations,
    UseInitArray,
    SplitDwarfFile,
    OutputObjFile,
    DebugInfoCompression,
    UseEmulatedTls,
    UseWasmEH,
    LargeDataThreshold,
  } satisfies TargetMachineArgs);
  return TM;
}

// llvm: llvm/lib/Target/TargetMachineC.cpp:229 LLVMDisposeTargetMachine
export function LLVMDisposeTargetMachine(T: TargetMachine): void {
  // delete unwrap(T);
  assert(!T.disposed, "llvm: LLVMDisposeTargetMachine of a target machine already disposed of (a double delete)");
  T.disposed = true;
}

/** A machine that `LLVMDisposeTargetMachine` has not deleted (a use after it is a use after free in the oracle). */
function live(T: TargetMachine, fn: string): TargetMachine {
  assert(!T.disposed, () => `llvm: ${fn} of a disposed target machine`);
  return T;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1196 LLVMRustSetDataLayoutFromTargetMachine
export function LLVMRustSetDataLayoutFromTargetMachine(Module: Module, TMR: TargetMachine): void {
  const Target = live(TMR, "LLVMRustSetDataLayoutFromTargetMachine");
  // unwrap(Module)->setDataLayout(Target->createDataLayout());
  // `Module::setDataLayout(const DataLayout &)`: the module keeps the layout's string, which is ASCII (the module's layout is a
  // byte string, core.ts's `LLVMSetDataLayout`).
  Module.dataLayout = Target.createDataLayout();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The MC subtarget

/** `MCSubtargetInfo` (llvm/include/llvm/MC/MCSubtargetInfo.h), as the model keeps it: its triple, CPU and feature string, the
 *  target's feature table (`ProcFeatures`, sorted by name) and the features enabled (`FeatureBits`). */
export class MCSubtargetInfo {
  /** `LLVMRustDisposeMCSubtargetInfo` was called. */
  disposed = false;
  constructor(
    readonly TargetTriple: Triple,
    readonly CPU: string,
    readonly FS: string,
    readonly ProcFeatures: readonly string[],
    readonly FeatureBits: ReadonlySet<string>,
  ) {}

  // llvm: llvm/lib/MC/MCSubtargetInfo.cpp:328 checkFeatures
  checkFeatures(FS: string): boolean {
    const T = SubtargetFeatures(FS);
    return T.every((F) => {
      // assert(SubtargetFeatures::hasFlag(F) && "Feature flags should start with '+' or '-'");  (compiled out)
      const FeatureEntry = Find(StripFlag(F), this.ProcFeatures);
      if (FeatureEntry === undefined) {
        // reportFatalInternalError(Twine("'") + F + "' is not a recognized feature for this target");
        // PORT: `reportFatalInternalError` prints LLVM's crash report, which the model does not imitate.
        return unported(`llir: MCSubtargetInfo::checkFeatures: '${F}' is not a recognized feature for this target (reportFatalInternalError)`);
      }

      return this.FeatureBits.has(FeatureEntry) === isEnabled(F);
    });
  }
}

/** `SubtargetFeatures(StringRef Initial).getFeatures()`: `Split` (SubtargetFeature.cpp:28) on ',' without empty strings. */
// llvm: llvm/lib/TargetParser/SubtargetFeature.cpp:49 SubtargetFeatures
function SubtargetFeatures(Initial: string): string[] {
  // S.split(Tmp, ',', -1, false /* KeepEmpty */);
  return Initial.split(",").filter((t) => t !== "");
}

// llvm: llvm/include/llvm/TargetParser/SubtargetFeature.h:242 hasFlag
function hasFlag(Feature: string): boolean {
  // assert(!Feature.empty() && "Empty string");
  // Get first character
  const Ch = Feature[0];
  // Check if first character is '+' or '-' flag
  return Ch === "+" || Ch === "-";
}

// llvm: llvm/include/llvm/TargetParser/SubtargetFeature.h:251 StripFlag
function StripFlag(Feature: string): string {
  return hasFlag(Feature) ? Feature.slice(1) : Feature;
}

// llvm: llvm/include/llvm/TargetParser/SubtargetFeature.h:256 isEnabled
function isEnabled(Feature: string): boolean {
  // assert(!Feature.empty() && "Empty string");
  // Get first character
  const Ch = Feature[0];
  // Check if first character is '+' for enabled
  return Ch === "+";
}

/** `Find(StringRef S, ArrayRef<T> A)`: a binary search of the sorted table; the entry is its key here. */
// llvm: llvm/lib/MC/MCSubtargetInfo.cpp:27 Find
function Find(S: string, A: readonly string[]): string | undefined {
  // Binary search the array: auto F = llvm::lower_bound(A, S);
  let lo = 0;
  let hi = A.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (A[mid]! < S) lo = mid + 1;
    else hi = mid;
  }
  // If not found then return NULL
  if (lo === A.length || A[lo] !== S) return undefined;
  // Return the found array item
  return A[lo];
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:87 LLVMRustCreateMCSubtargetInfo
export function LLVMRustCreateMCSubtargetInfo(TripleStr: string | undefined, CPU: string | undefined, Features: string | undefined): MCSubtargetInfo | undefined {
  const Error = { value: "" };
  const Trip = new Triple(normalize(TripleStr ?? ""));
  const TheTarget = lookupTarget(Trip, Error);
  if (TheTarget === undefined) {
    LLVMRustSetLastError(Error.value);
    return undefined;
  }

  return TheTarget.createMCSubtargetInfo(Trip, CPU ?? "", Features ?? "");
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:100 LLVMRustMCSubtargetInfoCheckFeatures
export function LLVMRustMCSubtargetInfoCheckFeatures(MCInfo: MCSubtargetInfo, Features: PtrLenStr | undefined, FeaturesLen: number): boolean {
  assert(!MCInfo.disposed, "llvm: LLVMRustMCSubtargetInfoCheckFeatures of a disposed subtarget");
  // StringRef{Features, FeaturesLen}
  const bytes = typeof Features === "string" ? Buffer.from(Features, "utf8") : Buffer.from(Features ?? new Uint8Array(0));
  return MCInfo.checkFeatures(bytes.subarray(0, FeaturesLen).toString("latin1"));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:106 LLVMRustDisposeMCSubtargetInfo
export function LLVMRustDisposeMCSubtargetInfo(MCInfo: MCSubtargetInfo): void {
  // delete MCInfo;
  assert(!MCInfo.disposed, "llvm: LLVMRustDisposeMCSubtargetInfo of a subtarget already disposed of (a double delete)");
  MCInfo.disposed = true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Diagnostic handlers (llvm/include/llvm/IR/DiagnosticHandler.h, LLVMContext.cpp; RustWrapper.cpp)

/** `DiagnosticHandler::DiagnosticHandlerTy`: `void (*)(const DiagnosticInfo *DI, void *Context)`. */
type DiagnosticHandlerTy = unknown;

/** `struct DiagnosticHandler` (LLVM's default) and rustc's `RustDiagnosticHandler` (`Rust` set), as the model keeps them. The
 *  model raises no diagnostics yet (its passes run in `opt`/`llc`), so nothing calls `handleDiagnostics`. */
export class DiagnosticHandler {
  constructor(
    readonly DiagHandlerCallback: DiagnosticHandlerTy = undefined,
    readonly DiagnosticContext: unknown = undefined,
    /** A `RustDiagnosticHandler`'s remark settings; `undefined` for LLVM's default handler. */
    readonly Rust: { readonly RemarkAllPasses: boolean; readonly RemarkPasses: readonly string[] } | undefined = undefined,
  ) {}
}

/** `pImpl->DiagHandler` and `pImpl->RespectDiagnosticFilters` of each context. A context starts with LLVM's default handler
 *  (`LLVMContextImpl::LLVMContextImpl`: `DiagHandler(std::make_unique<DiagnosticHandler>())`). */
const DIAG = new WeakMap<Context, { DiagHandler: DiagnosticHandler | undefined; RespectDiagnosticFilters: boolean }>();
function diagState(C: Context): { DiagHandler: DiagnosticHandler | undefined; RespectDiagnosticFilters: boolean } {
  let s = DIAG.get(C);
  if (s === undefined) DIAG.set(C, (s = { DiagHandler: new DiagnosticHandler(), RespectDiagnosticFilters: false }));
  return s;
}

/** The context's diagnostic handler, `undefined` while a caller holds it (tests). */
export function contextDiagnosticHandler(C: Context): DiagnosticHandler | undefined {
  return diagState(C).DiagHandler;
}

// llvm: llvm/lib/IR/LLVMContext.cpp:365 getDiagnosticHandler
function getDiagnosticHandler(C: Context): DiagnosticHandler | undefined {
  // return std::move(pImpl->DiagHandler);
  const s = diagState(C);
  const DH = s.DiagHandler;
  s.DiagHandler = undefined;
  return DH;
}

// llvm: llvm/lib/IR/LLVMContext.cpp:133 setDiagnosticHandler
function setDiagnosticHandler(C: Context, DH: DiagnosticHandler | undefined, RespectFilters = false): void {
  const s = diagState(C);
  s.DiagHandler = DH;
  s.RespectDiagnosticFilters = RespectFilters;
}

// Transfers ownership of DiagnosticHandler unique_ptr to the caller.
// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1498 LLVMRustContextGetDiagnosticHandler
export function LLVMRustContextGetDiagnosticHandler(C: Context): DiagnosticHandler | undefined {
  const DH = getDiagnosticHandler(C);
  return DH;
}

// Sets unique_ptr to object of DiagnosticHandler to provide custom diagnostic
// handling. Ownership of the handler is moved to the LLVMContext.
// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1505 LLVMRustContextSetDiagnosticHandler
export function LLVMRustContextSetDiagnosticHandler(C: Context, DH: DiagnosticHandler | undefined): void {
  setDiagnosticHandler(C, DH);
}

// Configures a diagnostic handler that invokes provided callback when a
// backend needs to emit a diagnostic.
//
// When RemarkAllPasses is true, remarks are enabled for all passes. Otherwise
// the RemarkPasses array specifies individual passes for which remarks will be
// enabled.
//
// If RemarkFilePath is not NULL, optimization remarks will be streamed directly
// into this file, bypassing the diagnostics handler.
// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1521 LLVMRustContextConfigureDiagnosticHandler
export function LLVMRustContextConfigureDiagnosticHandler(
  C: Context,
  DiagnosticHandlerCallback: DiagnosticHandlerTy,
  DiagnosticHandlerContext: unknown,
  RemarkAllPasses: boolean,
  RemarkPasses: readonly string[],
  RemarkPassesLen: number,
  RemarkFilePath: string | undefined,
  PGOAvailable: boolean,
): void {
  // class RustDiagnosticHandler final : public DiagnosticHandler { ... }: `DiagnosticHandler` with `Rust` set.
  const Passes: string[] = [];
  for (let I = 0; I !== RemarkPassesLen; ++I) {
    Passes.push(RemarkPasses[I]!);
  }

  // We need to hold onto both the streamers and the opened file
  if (RemarkFilePath !== undefined) {
    // if (PGOAvailable) unwrap(C)->setDiagnosticsHotnessRequested(true); then a ToolOutputFile, a YAML remark serializer and an
    // LLVMRemarkStreamer.
    void PGOAvailable;
    return unported("llir: LLVMRustContextConfigureDiagnosticHandler with a remark file (-Z remark-dir: the remark streamer is not modelled)");
  }

  setDiagnosticHandler(C, new DiagnosticHandler(DiagnosticHandlerCallback, DiagnosticHandlerContext, { RemarkAllPasses, RemarkPasses: Passes }));
}
