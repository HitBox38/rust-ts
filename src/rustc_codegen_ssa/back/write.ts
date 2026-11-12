// Port of compiler/rustc_codegen_ssa/src/back/write.rs (lane ssa-write, plan-m7 §2d "Write", wave 40o).
//
// PORT (ssa-write), module-wide:
// - **Threads (plan-m7 D15).** Upstream runs the coordinator on its own thread (`start_executing_work`), each LLVM work
//   item on a worker thread (`spawn_work`, `spawn_thin_lto_work`), and asks a jobserver helper thread for extra tokens.
//   rust-ts is one JS thread, so these run as a sequential schedule of the same threads (the section "Sequential threads
//   and channels" below):
//   - the coordinator's closure is a generator. It runs only while the main thread is blocked on it (a blocking `recv`
//     on a channel it sends to, or `join`), and it yields where upstream blocks in `coordinator_receive.recv()` on an
//     empty queue;
//   - a worker runs to completion inside `spawn_work` (its message is queued before the coordinator's next `recv`);
//   - the jobserver helper never delivers a token (`request_token` asks for one that never comes, plan-m7 D11), so the
//     only token is the process's implicit one, `tokens` stays empty, and at most one worker runs at a time.
//   With no extra tokens, the schedule is the one upstream runs: whenever the coordinator spawns work it holds the
//   implicit token ("Lending"), the main thread is blocked waiting for a `CguMessage`, and the only message the
//   coordinator can receive next is that worker's. The order of `optimize`/`codegen` calls is therefore fixed:
//   allocator `optimize`, then per CGU in submission order `optimize`, `codegen`, then allocator `codegen`
//   (`src/rustc_codegen_ssa/back/write.test.ts` derives it from the loop). Diagnostics sent through the
//   `SharedEmitter` are emitted at the same main-thread checkpoints as upstream.
//   A thread's panic is caught at the thread boundary (as `JoinHandle::join` / `catch_unwind` do); `Unported` and a JS
//   stack overflow are not unwinds and propagate (as rustc_data_structures sync/parallel.ts). While a thread runs,
//   `std::thread::current().name()` (std/panicking.ts `CURRENT_THREAD`) is its name, so the panic hook prints it.
//   A schedule in which the blocked thread can never be woken is a deadlock upstream; here it panics with that text.
// - **Generic backend (ssa-contract decision 4).** `B::optimize(..)` and the other no-`self` fns are called on the
//   backend value that stands for `B`. Fns that upstream calls with only a type parameter take it as their first
//   parameter `B_`.
// - `Arc<T>` is the value; `CodegenContext: Clone` (`cgcx.clone()`) is the same value (nothing writes its fields after
//   `start_executing_work` builds it). `#[derive(Encodable, Decodable)]` on `EmitObj`, `BitcodeSection`, `ModuleConfig`
//   and `CodegenContext` is not written (no rlink of these).
// - Incremental compilation is out of scope (plan-m7 D11): the paths that only `-C incremental` reaches stop
//   `unported(..)` where they need rustc_incremental or `link_or_copy` (rustc_fs_util, not ported).
// - `VerboseTimingGuard`s are the rustc_session stand-in's (they print nothing; `-Z time-passes` stops in the stand-in).
//   `generic_activity_with_arg` is the stand-in's `generic_activity` (both are `TimingGuard::none()` with no
//   self-profiler).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { Size } from "../../rustc_abi/lib.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import { Emitter } from "../../rustc_errors/emitter.ts";
import { Diag, DiagCtxt, type DiagCtxtHandle, type DiagInner, FatalError, FatalErrorMarker, type Level, catch_fatal_errors } from "../../rustc_errors/lib.ts";
import type { IncrCompSession, WorkProductMap } from "../../rustc_interface/stand_ins.ts";
import { copy_to_stdout } from "../../rustc_metadata/fs.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import {
  type AutoDiff,
  LinkerPluginLto,
  type Lto,
  type Offload,
  type OptLevel,
  OutFileName,
  type OutputFilenames,
  OutputType,
  type Passes,
  type SplitDwarfKind,
  type SwitchWithOptPath,
} from "../../rustc_session/config.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { CodegenUnits, type Session } from "../../rustc_session/session.ts";
import type { SelfProfilerRef, VerboseTimingGuard } from "../../rustc_session/stand_ins.ts";
import "../../rustc_session/utils.ts";
import { type BytePos, FileName, type InnerSpan, Span } from "../../rustc_span/lib.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import { Arch, type MergeFunctions, type SplitDebuginfo } from "../../rustc_target/spec/mod.ts";
import { SanitizerSet } from "../../rustc_target/stand_ins.ts";
import { path_join } from "../../std/path.ts";
import { type IoError, type IoResult, display_IoError, io_error_from_node } from "../../std/io.ts";
import type { Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Unported, assert, assert_eq, assert_matches, panic, unported, unwrap } from "../../std/panic.ts";
import { CURRENT_THREAD } from "../../std/panicking.ts";
import { Str } from "../../std/str.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import {
  BinaryOutputToTty_diagnostic,
  CopyPath,
  CopyPath_diagnostic,
  ErrorCreatingRemarkDir_diagnostic,
  IgnoringEmitPath_diagnostic,
  IgnoringOutput_diagnostic,
} from "../diagnostics.ts";
import { type CachedModuleCodegen, type CompiledModule, CompiledModules, type CrateInfo, type ModuleCodegen, type ModuleKind } from "../lib.ts";
import { CompiledModule as CompiledModuleC } from "../lib.ts";
import type { WorkProduct, WriteBackendMethods, WriteBackendTypes } from "../traits/write.ts";
import { ensure_removed } from "./link.ts";
import { type SerializedModule, type ThinModule, check_lto_allowed, exported_symbols_for_lto as lto_exported_symbols_for_lto } from "./lto.ts";

// ---- Sequential threads and channels (PORT, plan-m7 D15; see the header) ---------------------------------------------

/** Exceptions a thread boundary must not catch: a missing port and a JS stack overflow are not Rust unwinds. */
function is_not_an_unwind(err: unknown): boolean {
  return err instanceof Unported || (err instanceof RangeError && err.message.startsWith("Maximum call stack size exceeded"));
}

/** `std::sync::mpsc::RecvError` (and `TryRecvError`, whose variants this file never tells apart). */
interface RecvError {
  readonly __RecvError: undefined;
}
const RECV_ERROR: RecvError = Object.freeze({ __RecvError: undefined });
/** `#[derive(Debug)] pub struct RecvError;` */
const debug_RecvError: Debug<RecvError> = () => "RecvError";

/** The shared state of one `std::sync::mpsc::channel`. */
class Chan<T> {
  readonly queue: T[] = [];
  /**
   * PORT: the thread whose closure owns this channel's senders, if they live on a thread other than the receiver's.
   * The senders are dropped when it finishes (or unwinds). `undefined`: the senders live on the receiving thread, so
   * a blocking `recv` on an empty queue there is not a deadlock only if they are all gone (upstream never deadlocks).
   */
  producer: JoinHandle<unknown> | undefined = undefined;
}

/** `std::sync::mpsc::Sender<T>`. `Clone` is the same handle. */
class Sender<T> {
  constructor(readonly chan: Chan<T>) {}

  /** `Sender::send`. PORT: no receiver of this file is dropped while a sender can still send, so this is always `Ok`. */
  send(t: T): Result<null, T> {
    this.chan.queue.push(t);
    return Ok(null);
  }

  clone(): Sender<T> {
    return this;
  }
}

/** `std::sync::mpsc::Receiver<T>`. */
class Receiver<T> {
  constructor(readonly chan: Chan<T>) {}

  /**
   * `Receiver::recv` on the thread that is not the channel's producer (the main thread): while the queue is empty and
   * the producer is alive, the producer runs until it blocks.
   */
  recv(): Result<T, RecvError> {
    for (;;) {
      if (this.chan.queue.length > 0) return Ok(this.chan.queue.shift()!);
      const producer = this.chan.producer;
      if (producer === undefined || producer.is_finished()) return Err(RECV_ERROR);
      if (!producer.run_until_blocked()) deadlock();
    }
  }

  /** `Receiver::recv` inside a sequential thread: yields this channel while its queue is empty. */
  *recv_in_thread(): Generator<Chan<unknown>, Result<T, RecvError>, undefined> {
    // PORT: the senders of every channel a thread here receives on outlive it (the main thread holds them), so this
    // never sees a disconnected channel.
    while (this.chan.queue.length === 0) yield this.chan as Chan<unknown>;
    return Ok(this.chan.queue.shift()!);
  }

  /** `Receiver::try_recv`. */
  try_recv(): Result<T, RecvError> {
    if (this.chan.queue.length > 0) return Ok(this.chan.queue.shift()!);
    return Err(RECV_ERROR);
  }
}

/** `std::sync::mpsc::channel`. */
function channel<T>(): [Sender<T>, Receiver<T>] {
  const chan = new Chan<T>();
  return [new Sender(chan), new Receiver(chan)];
}

/** The thread that cannot make progress waits for one that is itself blocked: upstream hangs here. */
function deadlock(): never {
  return panic("rust-ts: deadlock: the coordinator thread is blocked on an empty channel that no runnable thread sends to (upstream hangs here)");
}

/** `std::thread::JoinHandle<T>` of a sequential thread whose body is a generator (see the header). */
class JoinHandle<T> {
  private result: Result<T, unknown> | undefined = undefined;
  private blocked_on: Chan<unknown> | undefined = undefined;

  constructor(
    readonly name: string,
    private readonly body: Generator<Chan<unknown>, T, undefined>,
  ) {}

  /** `JoinHandle::is_finished` */
  is_finished(): boolean {
    return this.result !== undefined;
  }

  /** Runs the thread until it blocks on an empty channel or finishes. `false`: it is still blocked, nothing ran. */
  run_until_blocked(): boolean {
    if (this.result !== undefined) return false;
    if (this.blocked_on !== undefined && this.blocked_on.queue.length === 0) return false;
    const prev = CURRENT_THREAD.name;
    CURRENT_THREAD.name = this.name;
    try {
      const r = this.body.next();
      if (r.done === true) {
        this.result = Ok(r.value);
        this.blocked_on = undefined;
      } else {
        this.blocked_on = r.value;
      }
    } catch (err) {
      if (is_not_an_unwind(err)) throw err;
      this.result = Err(err);
      this.blocked_on = undefined;
    } finally {
      CURRENT_THREAD.name = prev;
    }
    return true;
  }

  /** `JoinHandle::join`: `Err(payload)` if the thread panicked. */
  join(): Result<T, unknown> {
    while (this.result === undefined) {
      if (!this.run_until_blocked()) deadlock();
    }
    return this.result;
  }
}

/** `std::thread::Builder::new().name(name).spawn(f).expect(..)` for a thread whose closure is a generator. */
function spawn_thread<T>(name: string, f: () => Generator<Chan<unknown>, T, undefined>): JoinHandle<T> {
  return new JoinHandle(name, f());
}

/**
 * `std::thread::Builder::new().name(name).stack_size(stack_size).spawn(f).expect(..)` for a worker thread: it runs to
 * completion now (header). `catch_unwind` is inside `f`, as upstream.
 */
function spawn_worker_thread(name: string, _stack_size: number, f: () => void): void {
  const prev = CURRENT_THREAD.name;
  CURRENT_THREAD.name = name;
  try {
    f();
  } finally {
    CURRENT_THREAD.name = prev;
  }
}

/** `std::panic::catch_unwind(AssertUnwindSafe(f))` */
function catch_unwind<R>(f: () => R): Result<R, unknown> {
  try {
    return Ok(f());
  } catch (err) {
    if (is_not_an_unwind(err)) throw err;
    return Err(err);
  }
}

/** `jobserver::Acquired`: never constructed (no token is ever delivered, header). */
type Acquired = never;

/**
 * `jobserver::HelperThread`, from `jobserver::client().into_helper_thread(f).expect("failed to spawn helper thread")`.
 * PORT (plan-m7 D11, D15): the port holds only the process's implicit token and hands out none, so a requested token
 * never arrives and `f` is never called. rustc_data_structures jobserver.ts `client()` stops; nothing of the client is
 * needed for that answer.
 */
class HelperThread {
  /** `HelperThread::request_token`: the request stays pending. */
  request_token(): void {}
}

/** `Box<dyn Any>` of `B::thread_profiler()` dropped: its value's `Drop` impl is a `drop()` method in the port. */
function drop_profiler(profiler: unknown): void {
  if (typeof profiler === "object" && profiler !== null && "drop" in profiler && typeof profiler.drop === "function") {
    profiler.drop();
  }
}

/**
 * src/std/fs.ts, read lazily: it is the one module this file's static imports would add to the set base.ts already loads
 * at startup (plan-m7 D14), and only `-Z remark-dir` (`canonicalize`) needs it.
 */
function lazy_std_fs(): typeof import("../../std/fs.ts") {
  return (lazy_std_fs__m ??= require("../../std/fs.ts") as typeof import("../../std/fs.ts"));
}
var lazy_std_fs__m: typeof import("../../std/fs.ts") | undefined;

/** `std::fs::copy(from, to)`. PORT: Node's `copyFileSync` copies the contents and permission bits, as std does. */
function fs_copy(from: string, to: string): IoResult<null> {
  try {
    copyFileSync(from, to);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

// ---- back/write.rs ----------------------------------------------------------------------------------------------------

const PRE_LTO_BC_EXT: string = "pre-lto.bc";

/// What kind of object file to emit.
// #[derive(Clone, Copy, PartialEq, Encodable, Decodable)]
export type EmitObj =
  // No object file.
  | { readonly $: "None" }

  // Just uncompressed llvm bitcode. Provides easy compatibility with
  // emscripten's ecc compiler, when used as the linker.
  | { readonly $: "Bitcode" }

  // Object code, possibly augmented with a bitcode section.
  | { readonly $: "ObjectCode"; readonly _0: BitcodeSection };
export const EmitObj = {
  None: Object.freeze({ $: "None" }) as EmitObj,
  Bitcode: Object.freeze({ $: "Bitcode" }) as EmitObj,
} as const;
/** `#[derive(PartialEq)]` */
export function EmitObj_eq(a: EmitObj, b: EmitObj): boolean {
  if (a.$ !== b.$) return false;
  return a.$ !== "ObjectCode" || a._0 === (b as { _0: BitcodeSection })._0;
}

/// What kind of llvm bitcode section to embed in an object file.
// #[derive(Clone, Copy, PartialEq, Encodable, Decodable)]
export type BitcodeSection =
  // No bitcode section.
  | "None"

  // A full, uncompressed bitcode section.
  | "Full";
export const BitcodeSection = { None: "None", Full: "Full" } as const;

/// Module-specific configuration for `optimize_and_codegen`.
// #[derive(Encodable, Decodable)]
export class ModuleConfig {
  constructor(
    /// Names of additional optimization passes to run.
    public passes: string[],
    /// Some(level) to optimize at a certain level, or None to run
    /// absolutely no optimizations (used for the allocator module).
    public opt_level: OptLevel | undefined,

    public pgo_gen: SwitchWithOptPath,
    public pgo_use: PathBuf | undefined,
    public pgo_sample_use: PathBuf | undefined,
    public debug_info_for_profiling: boolean,
    public instrument_coverage: boolean,

    public sanitizer: SanitizerSet,
    public sanitizer_cfi_diag: boolean | undefined,
    public sanitizer_cfi_recover: boolean | undefined,
    public sanitizer_recover: SanitizerSet,
    public sanitizer_dataflow_abilist: string[],
    public sanitizer_memory_track_origins: number,

    // Flags indicating which outputs to produce.
    public emit_pre_lto_bc: boolean,
    public emit_bc: boolean,
    public emit_ir: boolean,
    public emit_asm: boolean,
    public emit_obj: EmitObj,
    public emit_thin_lto_summary: boolean,

    // Miscellaneous flags. These are mostly copied from command-line
    // options.
    public verify_llvm_ir: boolean,
    public lint_llvm_ir: boolean,
    public no_prepopulate_passes: boolean,
    public no_builtins: boolean,
    public vectorize_loop: boolean,
    public vectorize_slp: boolean,
    public merge_functions: boolean,
    public emit_lifetime_markers: boolean,
    public llvm_plugins: string[],
    public autodiff: AutoDiff[],
    public autodiff_post_passes: string | undefined,
    public offload: Offload[],
  ) {}

  // impl ModuleConfig
  // PORT: the struct literal's fields are evaluated in the literal's order (it differs from the declaration order at
  // `sanitizer_dataflow_abilist` / `sanitizer_recover`), then passed to the constructor in declaration order.
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:117 new
  static new(kind: ModuleKind, tcx: TyCtxt, no_builtins: boolean): ModuleConfig {
    // If it's a regular module, use `$regular`, otherwise use `$other`.
    // `$regular` and `$other` are evaluated lazily.
    const if_regular = <T>(regular: () => T, other: () => T): T => (kind === "Regular" ? regular() : other());

    const sess = tcx.sess;
    const opt_level_and_size = if_regular<OptLevel | undefined>(() => sess.opts.optimize, () => undefined);

    const save_temps = sess.opts.cg.save_temps;

    let should_emit_obj: boolean;
    if (sess.opts.output_types.contains_key("Exe")) {
      should_emit_obj = true;
    } else {
      switch (kind) {
        case "Regular":
          should_emit_obj = sess.opts.output_types.contains_key("Object");
          break;
        case "Allocator":
          should_emit_obj = false;
          break;
      }
    }

    let emit_obj: EmitObj;
    if (!should_emit_obj) {
      emit_obj = EmitObj.None;
    } else if (sess.target.obj_is_bitcode || (LinkerPluginLto.enabled(sess.opts.cg.linker_plugin_lto) && (!no_builtins || tcx.sess.is_sanitizer_cfi_enabled()))) {
      // This case is selected if the target uses objects as bitcode, or
      // if linker plugin LTO is enabled. In the linker plugin LTO case
      // the assumption is that the final link-step will read the bitcode
      // and convert it to object code. This may be done by either the
      // native linker or rustc itself.
      //
      // By default this branch is skipped for `#![no_builtins]` crates so
      // they emit native object files (machine code), not LLVM bitcode
      // objects for the linker (see rust-lang/rust#146133).
      //
      // However, when LLVM CFI is enabled (`-Zsanitizer=cfi`), this
      // breaks LLVM's expected pipeline: LLVM emits `llvm.type.test`
      // intrinsics and related metadata that must be lowered by LLVM's
      // `LowerTypeTests` pass before instruction selection during
      // link-time LTO. Otherwise, `llvm.type.test` intrinsics and related
      // metadata are not lowered by LLVM's `LowerTypeTests` pass before
      // reaching the target backend, and LLVM may abort during codegen
      // (for example in SelectionDAG type legalization) (see
      // rust-lang/rust#142284).
      //
      // Therefore, with `-Clinker-plugin-lto` and `-Zsanitizer=cfi`, a
      // `#![no_builtins]` crate must still use rustc's `EmitObj::Bitcode`
      // path (and emit LLVM bitcode in the `.o` for linker-based LTO).
      emit_obj = EmitObj.Bitcode;
    } else if (need_bitcode_in_object(tcx) || sess.target.requires_lto) {
      emit_obj = { $: "ObjectCode", _0: "Full" };
    } else {
      emit_obj = { $: "ObjectCode", _0: "None" };
    }

    const passes = if_regular(() => [...sess.opts.cg.passes], () => []);

    const opt_level = opt_level_and_size;

    const pgo_gen = if_regular<SwitchWithOptPath>(() => sess.opts.cg.profile_generate, () => ({ $: "Disabled" }));
    const pgo_use = if_regular(() => sess.opts.cg.profile_use, () => undefined);
    const pgo_sample_use = if_regular(() => sess.opts.cg.profile_sample_use, () => undefined);
    const debug_info_for_profiling = sess.opts.unstable_opts.debuginfo_for_profiling;
    const instrument_coverage = if_regular(() => sess.instrument_coverage(), () => false);

    const sanitizer = if_regular(() => sess.sanitizers(), () => SanitizerSet.empty());
    const sanitizer_cfi_diag = if_regular(() => sess.opts.unstable_opts.sanitizer_cfi_diag, () => undefined);
    const sanitizer_cfi_recover = if_regular(() => sess.opts.unstable_opts.sanitizer_cfi_recover, () => undefined);
    const sanitizer_dataflow_abilist = if_regular(() => [...sess.opts.unstable_opts.sanitizer_dataflow_abilist], () => []);
    const sanitizer_recover = if_regular(() => sess.opts.unstable_opts.sanitizer_recover, () => SanitizerSet.empty());
    const sanitizer_memory_track_origins = if_regular(() => sess.opts.unstable_opts.sanitizer_memory_track_origins, () => 0);

    const emit_pre_lto_bc = if_regular(() => save_temps || need_pre_lto_bitcode_for_incr_comp(sess), () => false);
    const emit_bc = if_regular(
      () => save_temps || sess.opts.output_types.contains_key("Bitcode"),
      () => save_temps,
    );
    const emit_ir = if_regular(() => sess.opts.output_types.contains_key("LlvmAssembly"), () => false);
    const emit_asm = if_regular(() => sess.opts.output_types.contains_key("Assembly"), () => false);
    const emit_thin_lto_summary = if_regular(() => sess.opts.output_types.contains_key("ThinLinkBitcode"), () => false);

    const verify_llvm_ir = sess.verify_llvm_ir();
    const lint_llvm_ir = sess.opts.unstable_opts.lint_llvm_ir;
    const no_prepopulate_passes = sess.opts.cg.no_prepopulate_passes;
    const no_builtins_ = no_builtins || sess.target.no_builtins;

    // Copy what clang does by turning on loop vectorization at O2 and
    // slp vectorization at O3.
    const vectorize_loop = !sess.opts.cg.no_vectorize_loops && (sess.opts.optimize === "More" || sess.opts.optimize === "Aggressive");
    const vectorize_slp = !sess.opts.cg.no_vectorize_slp && sess.opts.optimize === "Aggressive";

    // Some targets (namely, NVPTX) interact badly with the
    // MergeFunctions pass. This is because MergeFunctions can generate
    // new function calls which may interfere with the target calling
    // convention; e.g. for the NVPTX target, PTX kernels should not
    // call other PTX kernels. MergeFunctions can also be configured to
    // generate aliases instead, but aliases are not supported by some
    // backends (again, NVPTX). Therefore, allow targets to opt out of
    // the MergeFunctions pass, but otherwise keep the pass enabled (at
    // O2 and O3) since it can be useful for reducing code size.
    let merge_functions: boolean;
    // PORT: `Session: Deref<Target = EarlySession>`; the TS `Session` forwards only some `EarlySession` methods.
    const mf: MergeFunctions = sess.early_sess.merge_functions();
    switch (mf) {
      case "Disabled":
        merge_functions = false;
        break;
      case "Trampolines":
      case "Aliases": {
        // use config::OptLevel::*;
        switch (sess.opts.optimize) {
          case "Aggressive":
          case "More":
          case "SizeMin":
          case "Size":
            merge_functions = true;
            break;
          case "Less":
          case "No":
            merge_functions = false;
            break;
        }
        break;
      }
    }

    const emit_lifetime_markers = sess.emit_lifetime_markers();
    const llvm_plugins = if_regular(() => [...sess.opts.unstable_opts.llvm_plugins], () => []);
    const autodiff = if_regular(() => [...sess.opts.unstable_opts.autodiff], () => []);
    const autodiff_post_passes = if_regular(() => sess.opts.unstable_opts.autodiff_post_passes, () => undefined);
    const offload = if_regular(() => [...sess.opts.unstable_opts.offload], () => []);

    return new ModuleConfig(
      passes,
      opt_level,
      pgo_gen,
      pgo_use,
      pgo_sample_use,
      debug_info_for_profiling,
      instrument_coverage,
      sanitizer,
      sanitizer_cfi_diag,
      sanitizer_cfi_recover,
      sanitizer_recover,
      sanitizer_dataflow_abilist,
      sanitizer_memory_track_origins,
      emit_pre_lto_bc,
      emit_bc,
      emit_ir,
      emit_asm,
      emit_obj,
      emit_thin_lto_summary,
      verify_llvm_ir,
      lint_llvm_ir,
      no_prepopulate_passes,
      no_builtins_,
      vectorize_loop,
      vectorize_slp,
      merge_functions,
      emit_lifetime_markers,
      llvm_plugins,
      autodiff,
      autodiff_post_passes,
      offload,
    );
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:269 bitcode_needed
  bitcode_needed(): boolean {
    return (
      this.emit_bc ||
      this.emit_thin_lto_summary ||
      EmitObj_eq(this.emit_obj, EmitObj.Bitcode) ||
      EmitObj_eq(this.emit_obj, { $: "ObjectCode", _0: "Full" })
    );
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:276 embed_bitcode
  embed_bitcode(): boolean {
    return EmitObj_eq(this.emit_obj, { $: "ObjectCode", _0: "Full" });
  }
}

/// Configuration passed to the function returned by the `target_machine_factory`.
export interface TargetMachineFactoryConfig {
  /// Split DWARF is enabled in LLVM by checking that `TM.MCOptions.SplitDwarfFile` isn't empty,
  /// so the path to the dwarf object has to be provided when we create the target machine.
  /// This can be ignored by backends which do not need it for their Split DWARF support.
  split_dwarf_file: PathBuf | undefined;

  /// The name of the output object file. Used for setting OutputFilenames in target options
  /// so that LLVM can emit the CodeView S_OBJNAME record in pdb files
  output_obj_file: PathBuf | undefined;
}

// impl TargetMachineFactoryConfig
export const TargetMachineFactoryConfig = {
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:294 new
  new(cgcx: CodegenContext, module_name: string): TargetMachineFactoryConfig {
    let split_dwarf_file: PathBuf | undefined;
    if (cgcx.target_can_use_split_dwarf) {
      split_dwarf_file = cgcx.output_filenames.split_dwarf_path(cgcx.split_debuginfo, cgcx.split_dwarf_kind, module_name);
    } else {
      split_dwarf_file = undefined;
    }

    const output_obj_file = cgcx.output_filenames.temp_path_for_cgu("Object", module_name);
    return { split_dwarf_file, output_obj_file };
  },
} as const;

/** `Arc<dyn Fn(DiagCtxtHandle<'_>, TargetMachineFactoryConfig) -> <B as WriteBackendMethods>::TargetMachine + Send + Sync>` */
export type TargetMachineFactoryFn<W extends WriteBackendTypes> = (dcx: DiagCtxtHandle, config: TargetMachineFactoryConfig) => W["TargetMachine"];

/// Additional resources used by optimize_and_codegen (not module specific)
// #[derive(Clone, Encodable, Decodable)]
export interface CodegenContext {
  // Resources needed when running LTO
  lto: Lto;
  use_linker_plugin_lto: boolean;
  dylib_lto: boolean;
  prefer_dynamic: boolean;
  save_temps: boolean;
  fewer_names: boolean;
  time_trace: boolean;
  crate_types: CrateType[];
  output_filenames: OutputFilenames;
  module_config: ModuleConfig;
  opt_level: OptLevel;
  msvc_imps_needed: boolean;
  is_pe_coff: boolean;
  target_can_use_split_dwarf: boolean;
  target_arch: string;
  target_is_like_darwin: boolean;
  target_is_like_aix: boolean;
  target_is_like_gpu: boolean;
  split_debuginfo: SplitDebuginfo;
  split_dwarf_kind: SplitDwarfKind;
  pointer_size: Size;

  /// LLVM optimizations for which we want to print remarks.
  remark: Passes;
  /// Directory into which should the LLVM optimization remarks be written.
  /// If `None`, they will be written to stderr.
  remark_dir: PathBuf | undefined;
  /// The previous incremental compilation session directory, or None if we
  /// are not compiling incrementally or there is no previous session.
  old_incr_comp_session_dir: PathBuf | undefined;
  /// The incremental compilation session directory, or None if we are not
  /// compiling incrementally
  new_incr_comp_session_dir: PathBuf | undefined;
  /// `Some(limit)` if the codegen should be run in parallel.
  ///
  /// Depends on [`WriteBackendMethods::supports_parallel()`] and `--jobs-backend`.
  parallel: number | undefined;
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:363 generate_thin_lto_work
function generate_thin_lto_work<W extends WriteBackendTypes>(
  B_: WriteBackendMethods<W>,
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  dcx: DiagCtxtHandle,
  exported_symbols_for_lto: readonly string[],
  each_linked_rlib_for_lto: readonly PathBuf[],
  needs_thin_lto: ThinLtoInput<W>[],
): [ThinLtoWorkItem<W>, number][] {
  const _prof_timer = prof.generic_activity("codegen_thin_generate_lto_work");

  const [lto_modules, copy_jobs] = B_.run_thin_lto(cgcx, prof, dcx, exported_symbols_for_lto, each_linked_rlib_for_lto, needs_thin_lto);
  return [
    ...lto_modules.map((module): [ThinLtoWorkItem<W>, number] => {
      const cost = module.cost();
      return [{ $: "ThinLto", _0: module }, cost];
    }),
    ...copy_jobs.map((wp: WorkProduct): [ThinLtoWorkItem<W>, number] => [
      {
        $: "CopyPostLtoArtifacts",
        _0: {
          name: (wp as { cgu_name: string }).cgu_name,
          source: wp,
        },
      },
      0, // copying is very cheap
    ]),
  ];
}

type MaybeLtoModules<W extends WriteBackendTypes> =
  | { readonly $: "NoLto"; _0: CompiledModules }
  | { readonly $: "FatLto"; cgcx: CodegenContext; needs_fat_lto: FatLtoInput<W>[] }
  | { readonly $: "ThinLto"; cgcx: CodegenContext; needs_thin_lto: ThinLtoInput<W>[] };

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:405 need_bitcode_in_object
function need_bitcode_in_object(tcx: TyCtxt): boolean {
  const sess = tcx.sess;
  return sess.opts.cg.embed_bitcode && tcx.crate_types().includes("Rlib") && sess.opts.output_types.contains_key("Exe");
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:412 need_pre_lto_bitcode_for_incr_comp
function need_pre_lto_bitcode_for_incr_comp(sess: Session): boolean {
  if (sess.opts.incremental === undefined) {
    return false;
  }

  switch (sess.lto()) {
    case "No":
      return false;
    case "Fat":
    case "Thin":
    case "ThinLocal":
      return true;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:423 start_async_codegen
export function start_async_codegen<W extends WriteBackendTypes>(
  backend: WriteBackendMethods<W>,
  tcx: TyCtxt,
  regular_config: ModuleConfig,
  allocator_config: ModuleConfig,
  allocator_module: ModuleCodegen<W["Module"]> | undefined,
): OngoingCodegen<W> {
  const [coordinator_send, coordinator_receive] = channel<Message<W>>();

  const [shared_emitter, shared_emitter_main] = SharedEmitter.new();
  const [codegen_worker_send, codegen_worker_receive] = channel<CguMessage>();

  // PORT: `backend.clone()` is the same value (the backends are stateless unit structs; base.ts PORT 4).
  const coordinator_thread = start_executing_work(
    backend,
    tcx,
    shared_emitter,
    codegen_worker_send,
    coordinator_receive,
    regular_config,
    allocator_config,
    allocator_module,
    coordinator_send.clone(),
  );

  return new OngoingCodegen(
    /* backend */ backend,
    /* output_filenames */ tcx.output_filenames(null) as OutputFilenames,
    /* coordinator */ new Coordinator(/* sender */ coordinator_send, /* future */ coordinator_thread),
    /* codegen_worker_receive */ codegen_worker_receive,
    /* shared_emitter_main */ shared_emitter_main,
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:461 copy_all_cgu_workproducts_to_incr_comp_cache_dir
function copy_all_cgu_workproducts_to_incr_comp_cache_dir(
  sess: Session,
  _incr_comp_session: IncrCompSession | undefined,
  _compiled_modules: CompiledModules,
): WorkProductMap {
  const work_products: WorkProductMap = new Map();

  if (sess.opts.incremental === undefined || sess.opts.unstable_opts.disable_incr_comp_backend_caching) {
    return work_products;
  }

  // let _timer = sess.timer("copy_all_cgu_workproducts_to_incr_comp_cache_dir");
  // for module in compiled_modules.modules.iter().filter(|m| m.kind == ModuleKind::Regular) { .. }
  return unported(
    "rustc_codegen_ssa::back::write::copy_all_cgu_workproducts_to_incr_comp_cache_dir (rustc_incremental copy_cgu_workproduct_to_incr_comp_cache_dir; -C incremental, plan-m7 D11)",
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:507 produce_final_output_artifacts
export function produce_final_output_artifacts(sess: Session, compiled_modules: CompiledModules, crate_output: OutputFilenames): void {
  let user_wants_bitcode = false;
  let user_wants_objects = false;

  // Produce final compile outputs.
  const copy_gracefully = (from: PathBuf, to: OutFileName): void => {
    let e: IoResult<null>;
    if (to.$ === "Stdout" && (e = copy_to_stdout(from)).$ === "Err") {
      sess.dcx().emit_err(CopyPath_diagnostic(CopyPath.new(from, OutFileName.as_path(to), e._0)));
    } else if (to.$ === "Real" && (e = fs_copy(from, to._0)).$ === "Err") {
      sess.dcx().emit_err(CopyPath_diagnostic(CopyPath.new(from, to._0, e._0)));
    }
  };

  const copy_if_one_unit = (output_type: OutputType, keep_numbered: boolean): void => {
    if (compiled_modules.modules.length === 1) {
      const module = compiled_modules.modules[0]!;
      // 1) Only one codegen unit. In this case it's no difficulty
      //    to copy `foo.0.x` to `foo.x`.
      const path = crate_output.temp_path_for_cgu(output_type, module.name);
      const output = crate_output.path(output_type);
      if (!OutputType.is_text_output(output_type) && OutFileName.is_tty(output)) {
        sess.dcx().emit_err(BinaryOutputToTty_diagnostic({ shorthand: OutputType.shorthand(output_type) }));
      } else {
        copy_gracefully(path, output);
      }
      if (!sess.opts.cg.save_temps && !keep_numbered) {
        // The user just wants `foo.x`, not `foo.#module-name#.x`.
        ensure_removed(sess.dcx(), path);
      }
    } else {
      if (crate_output.outputs.contains_explicit_name(output_type)) {
        // 2) Multiple codegen units, with `--emit foo=some_name`. We have
        //    no good solution for this case, so warn the user.
        sess.dcx().emit_warn(IgnoringEmitPath_diagnostic({ extension: OutputType.extension(output_type) }));
      } else if (crate_output.single_output_file !== undefined) {
        // 3) Multiple codegen units, with `-o some_name`. We have
        //    no good solution for this case, so warn the user.
        sess.dcx().emit_warn(IgnoringOutput_diagnostic({ extension: OutputType.extension(output_type) }));
      } else {
        // 4) Multiple codegen units, but no explicit name. We
        //    just leave the `foo.0.x` files in place.
        // (We don't have to do any work in this case.)
      }
    }
  };

  // Flag to indicate whether the user explicitly requested bitcode.
  // Otherwise, we produced it only as a temporary output, and will need
  // to get rid of it.
  for (const output_type of crate_output.outputs.keys()) {
    switch (output_type) {
      case "Bitcode":
        user_wants_bitcode = true;
        // Copy to .bc, but always keep the .0.bc. There is a later
        // check to figure out if we should delete .0.bc files, or keep
        // them for making an rlib.
        copy_if_one_unit("Bitcode", true);
        break;
      case "ThinLinkBitcode":
        copy_if_one_unit("ThinLinkBitcode", false);
        break;
      case "LlvmAssembly":
        copy_if_one_unit("LlvmAssembly", false);
        break;
      case "Assembly":
        copy_if_one_unit("Assembly", false);
        break;
      case "Object":
        user_wants_objects = true;
        copy_if_one_unit("Object", true);
        break;
      case "Mir":
      case "Metadata":
      case "Exe":
      case "DepInfo":
        break;
    }
  }

  // Clean up unwanted temporary files.

  // We create the following files by default:
  //  - #crate#.#module-name#.rcgu.bc
  //  - #crate#.#module-name#.rcgu.o
  //  - #crate#.o (linked from crate.##.rcgu.o)
  //  - #crate#.bc (copied from crate.##.rcgu.bc)
  // We may create additional files if requested by the user (through
  // `-C save-temps` or `--emit=` flags).

  if (!sess.opts.cg.save_temps) {
    // Remove the temporary .#module-name#.rcgu.o objects. If the user didn't
    // explicitly request bitcode (with --emit=bc), and the bitcode is not
    // needed for building an rlib, then we must remove .#module-name#.bc as
    // well.

    // Specific rules for keeping .#module-name#.rcgu.bc:
    //  - If the user requested bitcode (`user_wants_bitcode`), and
    //    codegen_units > 1, then keep it.
    //  - If the user requested bitcode but codegen_units == 1, then we
    //    can toss .#module-name#.rcgu.bc because we copied it to .bc earlier.
    //  - If we're not building an rlib and the user didn't request
    //    bitcode, then delete .#module-name#.rcgu.bc.
    // If you change how this works, also update back::link::link_rlib,
    // where .#module-name#.rcgu.bc files are (maybe) deleted after making an
    // rlib.
    const needs_crate_object = crate_output.outputs.contains_key("Exe");

    const keep_numbered_bitcode = user_wants_bitcode && CodegenUnits.as_usize(sess.codegen_units()) > 1;

    const keep_numbered_objects = needs_crate_object || (user_wants_objects && CodegenUnits.as_usize(sess.codegen_units()) > 1);

    for (const module of compiled_modules.modules) {
      if (!keep_numbered_objects) {
        if (module.object !== undefined) {
          ensure_removed(sess.dcx(), module.object);
        }

        if (module.global_asm_object !== undefined) {
          ensure_removed(sess.dcx(), module.global_asm_object);
        }

        if (module.dwarf_object !== undefined) {
          ensure_removed(sess.dcx(), module.dwarf_object);
        }
      }

      if (module.bytecode !== undefined) {
        if (!keep_numbered_bitcode) {
          ensure_removed(sess.dcx(), module.bytecode);
        }
      }
    }

    let allocator_module: CompiledModule | undefined;
    let path: PathBuf | undefined;
    if (!user_wants_bitcode && (allocator_module = compiled_modules.allocator_module) !== undefined && (path = allocator_module.bytecode) !== undefined) {
      ensure_removed(sess.dcx(), path);
    }
  }

  if (sess.opts.json_artifact_notifications) {
    if (compiled_modules.modules.length === 1) {
      const module = compiled_modules.modules[0]!;
      CompiledModuleC.for_each_output(module, (_path, ty) => {
        if (sess.opts.output_types.contains_key(ty)) {
          const descr = OutputType.shorthand(ty);
          // for single cgu file is renamed to drop cgu specific suffix
          // so we regenerate it the same way
          const path = crate_output.path(ty);
          sess.dcx().emit_artifact_notification(OutFileName.as_path(path), descr);
        }
      });
    } else {
      for (const module of compiled_modules.modules) {
        CompiledModuleC.for_each_output(module, (path, ty) => {
          if (sess.opts.output_types.contains_key(ty)) {
            const descr = OutputType.shorthand(ty);
            sess.dcx().emit_artifact_notification(path, descr);
          }
        });
      }
    }
  }

  // We leave the following files around by default:
  //  - #crate#.o
  //  - #crate#.bc
  // These are used in linking steps and will be cleaned up afterward.
}

export type WorkItem<W extends WriteBackendTypes> =
  /// Optimize a newly codegened, totally unoptimized module.
  | { readonly $: "Optimize"; _0: ModuleCodegen<W["Module"]> }
  /// Copy the post-LTO artifacts from the incremental cache to the output
  /// directory.
  | { readonly $: "CopyPostLtoArtifacts"; _0: CachedModuleCodegen };

type ThinLtoWorkItem<W extends WriteBackendTypes> =
  /// Copy the post-LTO artifacts from the incremental cache to the output
  /// directory.
  | { readonly $: "CopyPostLtoArtifacts"; _0: CachedModuleCodegen }
  /// Performs thin-LTO on the given module.
  | { readonly $: "ThinLto"; _0: ThinModule<W> };

// `pthread_setname()` on *nix ignores anything beyond the first 15
// bytes. Use short descriptions to maximize the space available for
// the module name.
// #[cfg(not(windows))]
// PORT: the two cfg'd `desc` fns are both here; `desc` below picks the one for the host rustc runs on.
// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:704 desc
function desc_not_windows(short: string, _long: string, name: string): string {
  // The short label is three bytes, and is followed by a space. That
  // leaves 11 bytes for the CGU name. How we obtain those 11 bytes
  // depends on the CGU name form.
  //
  // - Non-incremental, e.g. `regex.f10ba03eb5ec7975-cgu.0`: the part
  //   before the `-cgu.0` is the same for every CGU, so use the
  //   `cgu.0` part. The number suffix will be different for each
  //   CGU.
  //
  // - Incremental (normal), e.g. `2i52vvl2hco29us0`: use the whole
  //   name because each CGU will have a unique ASCII hash, and the
  //   first 11 bytes will be enough to identify it.
  //
  // - Incremental (with `-Zhuman-readable-cgu-names`), e.g.
  //   `regex.f10ba03eb5ec7975-re_builder.volatile`: use the whole
  //   name. The first 11 bytes won't be enough to uniquely identify
  //   it, but no obvious substring will, and this is a rarely used
  //   option so it doesn't matter much.
  //
  assert_eq(Str.from(short).len(), 3, String);
  let name_ = name;
  const index = name.indexOf("-cgu.");
  if (index >= 0) {
    name_ = name.slice(index + 1); // +1 skips the leading '-'.
  }
  return `${short} ${name_}`;
}

// Windows has no thread name length limit, so use more descriptive names.
// #[cfg(windows)]
// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:735 desc
function desc_windows(_short: string, long: string, name: string): string {
  return `${long} ${name}`;
}

/** `desc` as cfg'd for the host rustc runs on. */
const desc = process.platform === "win32" ? desc_windows : desc_not_windows;

// impl<B: WriteBackendMethods> WorkItem<B>
const WorkItem = {
  /// Generate a short description of this work item suitable for use as a thread name.
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:741 short_description
  short_description<W extends WriteBackendTypes>(self: WorkItem<W>): string {
    switch (self.$) {
      case "Optimize":
        return desc("opt", "optimize module", self._0.name);
      case "CopyPostLtoArtifacts":
        return desc("cpy", "copy LTO artifacts for", self._0.name);
    }
  },
} as const;

// impl<B: WriteBackendMethods> ThinLtoWorkItem<B>
const ThinLtoWorkItem = {
  /// Generate a short description of this work item suitable for use as a thread name.
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:751 short_description
  short_description<W extends WriteBackendTypes>(self: ThinLtoWorkItem<W>): string {
    switch (self.$) {
      case "CopyPostLtoArtifacts":
        return desc("cpy", "copy LTO artifacts for", self._0.name);
      case "ThinLto":
        return desc("lto", "thin-LTO module", self._0.name());
    }
  },
} as const;

/// A result produced by the backend.
export type WorkItemResult<W extends WriteBackendTypes> =
  /// The backend has finished compiling a CGU, nothing more required.
  | { readonly $: "Finished"; _0: CompiledModule }

  /// The backend has finished compiling a CGU, which now needs to go through
  /// fat LTO.
  | { readonly $: "NeedsFatLto"; _0: FatLtoInput<W> }

  /// The backend has finished compiling a CGU, which now needs to go through
  /// thin LTO.
  | { readonly $: "NeedsThinLto"; _0: string; _1: W["ModuleBuffer"] };

export type FatLtoInput<W extends WriteBackendTypes> =
  | { readonly $: "Serialized"; name: string; bitcode_path: PathBuf }
  | { readonly $: "InMemory"; _0: ModuleCodegen<W["Module"]> };

export type ThinLtoInput<W extends WriteBackendTypes> =
  | { readonly $: "Red"; name: string; buffer: SerializedModule<W["ModuleBuffer"]> }
  | { readonly $: "Green"; wp: WorkProduct; bitcode_path: PathBuf };

/// Actual LTO type we end up choosing based on multiple factors.
export type ComputedLtoType = "No" | "Thin" | "Fat";
export const ComputedLtoType = { No: "No", Thin: "Thin", Fat: "Fat" } as const;

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:792 compute_per_cgu_lto_type
export function compute_per_cgu_lto_type(sess_lto: Lto, linker_does_lto: boolean, sess_crate_types: readonly CrateType[]): ComputedLtoType {
  // If the linker does LTO, we don't have to do it. Note that we
  // keep doing full LTO, if it is requested, as not to break the
  // assumption that the output will be a single module.

  // We ignore a request for full crate graph LTO if the crate type
  // is only an rlib, as there is no full crate graph to process,
  // that'll happen later.
  //
  // This use case currently comes up primarily for targets that
  // require LTO so the request for LTO is always unconditionally
  // passed down to the backend, but we don't actually want to do
  // anything about it yet until we've got a final product.
  const is_rlib = sess_crate_types.length === 1 && sess_crate_types[0] === "Rlib";

  if (sess_lto === "ThinLocal" && !linker_does_lto) {
    return "Thin";
  } else if (sess_lto === "Thin" && !linker_does_lto && !is_rlib) {
    return "Thin";
  } else if (sess_lto === "Fat" && !is_rlib) {
    return "Fat";
  } else {
    return "No";
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:819 execute_optimize_work_item
function execute_optimize_work_item<W extends WriteBackendTypes>(
  B_: WriteBackendMethods<W>,
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  module: ModuleCodegen<W["Module"]>,
): WorkItemResult<W> {
  const _timer = prof.generic_activity("codegen_module_optimize");

  B_.optimize(cgcx, prof, shared_emitter, module, cgcx.module_config);

  // After we've done the initial round of optimizations we need to
  // decide whether to synchronously codegen this module or ship it
  // back to the coordinator thread for further LTO processing (which
  // has to wait for all the initial modules to be optimized).

  const lto_type = compute_per_cgu_lto_type(cgcx.lto, cgcx.use_linker_plugin_lto, cgcx.crate_types);

  // If we're doing some form of incremental LTO then we need to be sure to
  // save our module to disk first.
  let bitcode: PathBuf | undefined;
  if (cgcx.module_config.emit_pre_lto_bc) {
    const filename = pre_lto_bitcode_filename(module.name);
    // `cgcx.new_incr_comp_session_dir.as_ref().map(|path| path.join(&filename))`
    bitcode = cgcx.new_incr_comp_session_dir !== undefined ? path_join(cgcx.new_incr_comp_session_dir, filename) : undefined;
  } else {
    bitcode = undefined;
  }

  switch (lto_type) {
    case "No": {
      const module_ = B_.codegen(cgcx, prof, shared_emitter, module, cgcx.module_config);
      return { $: "Finished", _0: module_ };
    }
    case "Thin": {
      const thin_buffer = B_.serialize_module(module.module_llvm, true);
      const path = bitcode;
      if (path !== undefined) {
        write_pre_lto_bitcode(path, thin_buffer.data());
      }
      return { $: "NeedsThinLto", _0: module.name, _1: thin_buffer };
    }
    case "Fat": {
      const path = bitcode;
      if (path !== undefined) {
        const buffer = B_.serialize_module(module.module_llvm, false);
        write_pre_lto_bitcode(path, buffer.data());
        return { $: "NeedsFatLto", _0: { $: "Serialized", name: module.name, bitcode_path: path } };
      } else {
        return { $: "NeedsFatLto", _0: { $: "InMemory", _0: module } };
      }
    }
  }
}

/** `fs::write(&path, data).unwrap_or_else(|e| panic!("Error writing pre-lto-bitcode file `{}`: {}", path.display(), e))` */
function write_pre_lto_bitcode(path: PathBuf, data: Uint8Array): void {
  try {
    writeFileSync(path, data);
  } catch (e) {
    panic(`Error writing pre-lto-bitcode file \`${path}\`: ${display_IoError(io_error_from_node(e))}`);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:876 execute_copy_from_cache_work_item
function execute_copy_from_cache_work_item(
  _cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  module: CachedModuleCodegen,
): CompiledModule {
  const _timer = prof.generic_activity("codegen_copy_artifacts_from_incr_cache");

  const dcx_ = DiagCtxt.new(shared_emitter);
  const _dcx = dcx_.handle();

  // PORT: a `CachedModuleCodegen` exists only with `-C incremental` (its `source` is a `WorkProduct`, never constructed:
  // traits/write.ts). The rest of the body copies its saved files back with `link_or_copy` (rustc_fs_util, not
  // ported) and builds the `CompiledModule`; it needs `module.source.saved_files`, `split_dwarf_path` and
  // `temp_path_for_cgu` / `temp_path_ext_for_cgu`, and emits `NoSavedObjectFile` when the object is missing.
  return unported(
    `rustc_codegen_ssa::back::write::execute_copy_from_cache_work_item (${module.name}: rustc_fs_util link_or_copy, WorkProduct saved_files; -C incremental, plan-m7 D11)`,
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:961 do_fat_lto
function do_fat_lto<W extends WriteBackendTypes>(
  B_: WriteBackendMethods<W>,
  sess: Session,
  cgcx: CodegenContext,
  shared_emitter: SharedEmitter,
  tm_factory: TargetMachineFactoryFn<W>,
  exported_symbols_for_lto: readonly string[],
  each_linked_rlib_for_lto: readonly PathBuf[],
  needs_fat_lto: FatLtoInput<W>[],
): CompiledModule {
  const _timer = sess.prof.verbose_generic_activity("LLVM_fatlto");

  const dcx_ = DiagCtxt.new(shared_emitter.clone());
  const dcx = dcx_.handle();

  check_lto_allowed(cgcx, dcx);

  return B_.optimize_and_codegen_fat_lto(sess, cgcx, shared_emitter, tm_factory, exported_symbols_for_lto, each_linked_rlib_for_lto, needs_fat_lto);
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:988 do_thin_lto
function do_thin_lto<W extends WriteBackendTypes>(
  B_: WriteBackendMethods<W>,
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  tm_factory: TargetMachineFactoryFn<W>,
  exported_symbols_for_lto: readonly string[],
  each_linked_rlib_for_lto: readonly PathBuf[],
  needs_thin_lto: ThinLtoInput<W>[],
  stack_size: number,
): CompiledModule[] {
  const _timer = prof.verbose_generic_activity("LLVM_thinlto");

  const dcx_ = DiagCtxt.new(shared_emitter.clone());
  const dcx = dcx_.handle();

  check_lto_allowed(cgcx, dcx);

  const [coordinator_send, coordinator_receive] = channel<ThinLtoMessage>();

  // First up, convert our jobserver into a helper thread so we can use normal
  // mpsc channels to manage our messages and such.
  // After we've requested tokens then we'll, when we can,
  // get tokens on `coordinator_receive` which will
  // get managed in the main loop below.
  // Note that using `jobserver::Proxy` is not necessary here, the code below always acquires
  // tokens before releasing them, so we can never accidentally release the last token
  // permanently held by rustc process.
  // PORT: `jobserver::client().into_helper_thread(move |token| { .. ThinLtoMessage::Token(token) .. })` (HelperThread).
  const jobserver_helper = cgcx.parallel !== undefined ? new HelperThread() : undefined;

  const work_items: [ThinLtoWorkItem<W>, number][] = [];

  // We have LTO work to do. Perform the serial work here of
  // figuring out what we're going to LTO and then push a
  // bunch of work items onto our queue to do LTO. This all
  // happens on the coordinator thread but it's very quick so
  // we don't worry about tokens.
  const work = generate_thin_lto_work(B_, cgcx, prof, dcx, exported_symbols_for_lto, each_linked_rlib_for_lto, needs_thin_lto);
  for (let i = 0; i < work.length; i++) {
    const [work_, cost] = work[i]!;
    const insertion_index = binary_search_by_cost(work_items, cost);
    work_items.splice(insertion_index, 0, [work_, cost]);
    if (jobserver_helper !== undefined && i < unwrap(cgcx.parallel)) {
      jobserver_helper.request_token();
    }
  }

  let codegen_aborted: FatalError | undefined = undefined;

  // These are the Jobserver Tokens we currently hold. Does not include
  // the implicit Token the compiler process owns no matter what.
  const tokens: Acquired[] = [];

  // Amount of tokens that are used (including the implicit token).
  let used_token_count = 0;

  const compiled_modules: CompiledModule[] = [];

  // Run the message loop while there's still anything that needs message
  // processing. Note that as soon as codegen is aborted we simply want to
  // wait for all existing work to finish, so many of the conditions here
  // only apply if codegen hasn't been aborted as they represent pending
  // work to be done.
  for (;;) {
    if (codegen_aborted === undefined) {
      if (used_token_count === 0 && work_items.length === 0) {
        // All codegen work is done.
        break;
      }

      // Spin up what work we can, only doing this while we've got available
      // parallelism slots and work left to spawn.
      let item: [ThinLtoWorkItem<W>, number] | undefined;
      while (used_token_count < tokens.length + 1 && (item = work_items.pop()) !== undefined) {
        spawn_thin_lto_work(B_, cgcx, prof, shared_emitter.clone(), tm_factory, coordinator_send.clone(), item[0], stack_size);
        used_token_count += 1;
      }
    } else {
      // Don't queue up any more work if codegen was aborted, we're
      // just waiting for our existing children to finish.
      if (used_token_count === 0) {
        break;
      }
    }

    // Relinquish accidentally acquired extra tokens. Subtract 1 for the implicit token.
    tokens.length = Math.min(tokens.length, Math.max(0, used_token_count - 1));

    const msg = unwrap_result(coordinator_receive.recv(), debug_RecvError);
    switch (msg.$) {
      // Save the token locally and the next turn of the loop will use
      // this to spawn a new unit of work, or it may get dropped
      // immediately if we have no more work to spawn.
      case "Token": {
        const token = msg._0;
        if (token.$ === "Ok") {
          tokens.push(token._0);
        } else {
          const e = token._0;
          const msg_ = `failed to acquire jobserver token: ${display_IoError(e)}`;
          shared_emitter.fatal(msg_);
          codegen_aborted = new FatalError();
        }
        break;
      }

      case "WorkItem": {
        const result = msg.result;
        // If a thread exits successfully then we drop a token associated
        // with that worker and update our `used_token_count` count.
        // We may later re-acquire a token to continue running more work.
        // We may also not actually drop a token here if the worker was
        // running with an "ephemeral token".
        used_token_count -= 1;

        if (result.$ === "Ok") {
          compiled_modules.push(result._0);
        } else if (result._0 !== undefined) {
          // Err(Some(WorkerFatalError))
          // Like `CodegenAborted`, wait for remaining work to finish.
          codegen_aborted = new FatalError();
        } else {
          // Err(None)
          // If the thread failed that means it panicked, so
          // we abort immediately.
          bug("worker thread panicked");
        }
        break;
      }
    }
  }

  if (codegen_aborted !== undefined) {
    codegen_aborted.raise();
  }

  return compiled_modules;
}

/**
 * `work_items.binary_search_by_key(&cost, |&(_, cost)| cost)`, then `Ok(idx) | Err(idx) => idx` (or `unwrap_or_else(|e| e)`).
 * PORT: `binary_search_by_key(b, f)` is `binary_search_by(|k| f(k).cmp(b))` (core slice/mod.rs:3084); which index it
 * returns among equal costs is core's loop's, so that loop is ported here.
 */
// std: library/core/src/slice/mod.rs:2982 binary_search_by
function binary_search_by_cost<T>(v: readonly [T, number][], cost: number): number {
  let size = v.length;
  if (size === 0) return 0;
  let base = 0;
  while (size > 1) {
    const half = Math.floor(size / 2);
    const mid = base + half;
    // `f(mid) == Greater` -> keep `base`, else move to `mid`.
    const cmp = v[mid]![1] > cost ? 1 : v[mid]![1] < cost ? -1 : 0;
    base = cmp === 1 ? base : mid;
    size -= half;
  }
  const c = v[base]![1];
  if (c === cost) return base; // Ok(base)
  return base + (c < cost ? 1 : 0); // Err(base + (cmp == Less) as usize)
}

/// Messages sent to the coordinator.
export type Message<W extends WriteBackendTypes> =
  /// A jobserver token has become available. Sent from the jobserver helper
  /// thread.
  | { readonly $: "Token"; _0: Result<Acquired, IoError> }

  /// The backend has finished processing a work item for a codegen unit.
  /// Sent from a backend worker thread.
  | { readonly $: "WorkItem"; result: Result<WorkItemResult<W>, WorkerFatalError | undefined> }

  /// The frontend has finished generating something (backend IR or a
  /// post-LTO artifact) for a codegen unit, and it should be passed to the
  /// backend. Sent from the main thread.
  | { readonly $: "CodegenDone"; llvm_work_item: WorkItem<W>; cost: number }

  /// Similar to `CodegenDone`, but for reusing a pre-LTO artifact
  /// Sent from the main thread.
  | { readonly $: "AddImportOnlyModule"; bitcode_path: PathBuf; work_product: WorkProduct }

  /// The frontend has finished generating everything for all codegen units.
  /// Sent from the main thread.
  | { readonly $: "CodegenComplete" }

  /// Some normal-ish compiler error occurred, and codegen should be wound
  /// down. Sent from the main thread.
  | { readonly $: "CodegenAborted" };

/// Messages sent to the coordinator.
type ThinLtoMessage =
  /// A jobserver token has become available. Sent from the jobserver helper
  /// thread.
  | { readonly $: "Token"; _0: Result<Acquired, IoError> }

  /// The backend has finished processing a work item for a codegen unit.
  /// Sent from a backend worker thread.
  | { readonly $: "WorkItem"; result: Result<CompiledModule, WorkerFatalError | undefined> };

/// A message sent from the coordinator thread to the main thread telling it to
/// process another codegen unit.
export interface CguMessage {
  readonly __CguMessage: undefined;
}
const CguMessage: CguMessage = Object.freeze({ __CguMessage: undefined });

// #[derive(PartialEq, Clone, Copy, Debug)]
type MainThreadState =
  /// Doing nothing.
  | "Idle"

  /// Doing codegen, i.e. MIR-to-LLVM-IR conversion.
  | "Codegenning"

  /// Idle, but lending the compiler process's Token to an LLVM thread so it can do useful work.
  | "Lending";

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1203 start_executing_work
function start_executing_work<W extends WriteBackendTypes>(
  backend: WriteBackendMethods<W>,
  tcx: TyCtxt,
  shared_emitter: SharedEmitter,
  codegen_worker_send: Sender<CguMessage>,
  coordinator_receive: Receiver<Message<W>>,
  regular_config: ModuleConfig,
  allocator_config: ModuleConfig,
  allocator_module_: ModuleCodegen<W["Module"]> | undefined,
  coordinator_send: Sender<Message<W>>,
): JoinHandle<Result<MaybeLtoModules<W>, null>> {
  // PORT: `B` is `backend`'s type (header).
  const B_ = backend;
  let allocator_module = allocator_module_;
  const sess = tcx.sess;
  const prof = sess.prof;

  // Compute the set of symbols we need to retain when doing thin local LTO (if we need to)
  const exported_symbols_for_lto = sess.lto() === "ThinLocal" ? lto_exported_symbols_for_lto(tcx, []) : [];

  // First up, convert our jobserver into a helper thread so we can use normal
  // mpsc channels to manage our messages and such.
  // After we've requested tokens then we'll, when we can,
  // get tokens on `coordinator_receive` which will
  // get managed in the main loop below.
  // Note that using `jobserver::Proxy` is not necessary here, the code below always acquires
  // tokens before releasing them, so we can never accidentally release the last token
  // permanently held by rustc process.
  const n = sess.opts.jobs.backend;
  const parallel = n !== undefined && backend.supports_parallel() ? n : undefined;
  // PORT: `jobserver::client().into_helper_thread(move |token| { .. Message::Token(token) .. })` (HelperThread).
  const jobserver_helper = parallel !== undefined ? new HelperThread() : undefined;

  const opt_level = tcx.backend_optimization_level(null) as OptLevel;
  const tm_factory = backend.target_machine_factory(tcx.sess, opt_level);

  let remark_dir: PathBuf | undefined;
  const dir = sess.opts.unstable_opts.remark_dir;
  if (dir !== undefined) {
    // `fs::create_dir_all(dir).and_then(|_| dir.canonicalize())`
    let result: IoResult<PathBuf>;
    try {
      mkdirSync(dir, { recursive: true });
      result = lazy_std_fs().canonicalize(dir);
    } catch (e) {
      result = Err(io_error_from_node(e));
    }
    if (result.$ === "Ok") {
      remark_dir = result._0;
    } else {
      const error = result._0;
      sess.dcx().emit_fatal(ErrorCreatingRemarkDir_diagnostic({ error }));
    }
  } else {
    remark_dir = undefined;
  }

  const stack_size = sess.opts.recommended_stack_size;

  const cgcx: CodegenContext = {
    crate_types: [...tcx.crate_types()],
    lto: sess.lto(),
    use_linker_plugin_lto: LinkerPluginLto.enabled(sess.opts.cg.linker_plugin_lto),
    dylib_lto: sess.opts.unstable_opts.dylib_lto,
    prefer_dynamic: sess.opts.cg.prefer_dynamic,
    fewer_names: sess.fewer_names(),
    save_temps: sess.opts.cg.save_temps,
    time_trace: sess.opts.unstable_opts.llvm_time_trace,
    remark: sess.opts.cg.remark,
    remark_dir,
    // `tcx.incr_comp_session.as_ref().and_then(|s| s.old_session_directory.as_deref()).map(ToOwned::to_owned)`:
    // PORT: `incr_comp_session` is always `None` (no incremental, plan-m2 D3).
    old_incr_comp_session_dir: tcx.gcx.incr_comp_session,
    new_incr_comp_session_dir: tcx.gcx.incr_comp_session,
    output_filenames: tcx.output_filenames(null) as OutputFilenames,
    module_config: regular_config,
    opt_level,
    msvc_imps_needed: msvc_imps_needed(tcx),
    is_pe_coff: tcx.sess.target.is_like_windows,
    target_can_use_split_dwarf: tcx.sess.target_can_use_split_dwarf(),
    target_arch: Arch.display(tcx.sess.target.arch),
    target_is_like_darwin: tcx.sess.target.is_like_darwin,
    target_is_like_aix: tcx.sess.target.is_like_aix,
    target_is_like_gpu: tcx.sess.target.is_like_gpu,
    split_debuginfo: tcx.sess.split_debuginfo(),
    split_dwarf_kind: tcx.sess.opts.unstable_opts.split_dwarf_kind,
    parallel,
    pointer_size: tcx.data_layout().pointer_size(),
  };

  // This is the "main loop" of parallel work happening for parallel codegen.
  // It's here that we manage parallelism, schedule work, and work with
  // messages coming from clients.
  //
  // There are a few environmental pre-conditions that shape how the system
  // is set up:
  //
  // - Error reporting can only happen on the main thread because that's the
  //   only place where we have access to the compiler `Session`.
  // - LLVM work can be done on any thread.
  // - Codegen can only happen on the main thread.
  // - Each thread doing substantial work must be in possession of a `Token`
  //   from the `Jobserver`.
  // - The compiler process always holds one `Token`. Any additional `Tokens`
  //   have to be requested from the `Jobserver`.
  //
  // Error Reporting
  // ===============
  // The error reporting restriction is handled separately from the rest: We
  // set up a `SharedEmitter` that holds an open channel to the main thread.
  // When an error occurs on any thread, the shared emitter will send the
  // error message to the receiver main thread (`SharedEmitterMain`). The
  // main thread will periodically query this error message queue and emit
  // any error messages it has received. It might even abort compilation if
  // it has received a fatal error. In this case we rely on all other threads
  // being torn down automatically with the main thread.
  // Since the main thread will often be busy doing codegen work, error
  // reporting will be somewhat delayed, since the message queue can only be
  // checked in between two work packages.
  //
  // Work Processing Infrastructure
  // ==============================
  // The work processing infrastructure knows three major actors:
  //
  // - the coordinator thread,
  // - the main thread, and
  // - LLVM worker threads
  //
  // The coordinator thread is running a message loop. It instructs the main
  // thread about what work to do when, and it will spawn off LLVM worker
  // threads as open LLVM WorkItems become available.
  //
  // The job of the main thread is to codegen CGUs into LLVM work packages
  // (since the main thread is the only thread that can do this). The main
  // thread will block until it receives a message from the coordinator, upon
  // which it will codegen one CGU, send it to the coordinator and block
  // again. This way the coordinator can control what the main thread is
  // doing.
  //
  // The coordinator keeps a queue of LLVM WorkItems, and when a `Token` is
  // available, it will spawn off a new LLVM worker thread and let it process
  // a WorkItem. When a LLVM worker thread is done with its WorkItem,
  // it will just shut down, which also frees all resources associated with
  // the given LLVM module, and sends a message to the coordinator that the
  // WorkItem has been completed.
  //
  // Work Scheduling
  // ===============
  // The scheduler's goal is to minimize the time it takes to complete all
  // work there is, however, we also want to keep memory consumption low
  // if possible. These two goals are at odds with each other: If memory
  // consumption were not an issue, we could just let the main thread produce
  // LLVM WorkItems at full speed, assuring maximal utilization of
  // Tokens/LLVM worker threads. However, since codegen is usually faster
  // than LLVM processing, the queue of LLVM WorkItems would fill up and each
  // WorkItem potentially holds on to a substantial amount of memory.
  //
  // So the actual goal is to always produce just enough LLVM WorkItems as
  // not to starve our LLVM worker threads. That means, once we have enough
  // WorkItems in our queue, we can block the main thread, so it does not
  // produce more until we need them.
  //
  // Doing LLVM Work on the Main Thread
  // ----------------------------------
  // Since the main thread owns the compiler process's implicit `Token`, it is
  // wasteful to keep it blocked without doing any work. Therefore, what we do
  // in this case is: We spawn off an additional LLVM worker thread that helps
  // reduce the queue. The work it is doing corresponds to the implicit
  // `Token`. The coordinator will mark the main thread as being busy with
  // LLVM work. (The actual work happens on another OS thread but we just care
  // about `Tokens`, not actual threads).
  //
  // When any LLVM worker thread finishes while the main thread is marked as
  // "busy with LLVM work", we can do a little switcheroo: We give the Token
  // of the just finished thread to the LLVM worker thread that is working on
  // behalf of the main thread's implicit Token, thus freeing up the main
  // thread again. The coordinator can then again decide what the main thread
  // should do. This allows the coordinator to make decisions at more points
  // in time.
  //
  // Striking a Balance between Throughput and Memory Consumption
  // ------------------------------------------------------------
  // Since our two goals, (1) use as many Tokens as possible and (2) keep
  // memory consumption as low as possible, are in conflict with each other,
  // we have to find a trade off between them. Right now, the goal is to keep
  // all workers busy, which means that no worker should find the queue empty
  // when it is ready to start.
  // How do we do achieve this? Good question :) We actually never know how
  // many `Tokens` are potentially available so it's hard to say how much to
  // fill up the queue before switching the main thread to LLVM work. Also we
  // currently don't have a means to estimate how long a running LLVM worker
  // will still be busy with it's current WorkItem. However, we know the
  // maximal count of available Tokens that makes sense (=the number of CPU
  // cores), so we can take a conservative guess. The heuristic we use here
  // is implemented in the `queue_full_enough()` function.
  //
  // Some Background on Jobservers
  // -----------------------------
  // It's worth also touching on the management of parallelism here. We don't
  // want to just spawn a thread per work item because while that's optimal
  // parallelism it may overload a system with too many threads or violate our
  // configuration for the maximum amount of cpu to use for this process. To
  // manage this we use the `jobserver` crate.
  //
  // Job servers are an artifact of GNU make and are used to manage
  // parallelism between processes. A jobserver is a glorified IPC semaphore
  // basically. Whenever we want to run some work we acquire the semaphore,
  // and whenever we're done with that work we release the semaphore. In this
  // manner we can ensure that the maximum number of parallel workers is
  // capped at any one point in time.
  //
  // LTO and the coordinator thread
  // ------------------------------
  //
  // The final job the coordinator thread is responsible for is managing LTO
  // and how that works. When LTO is requested what we'll do is collect all
  // optimized LLVM modules into a local vector on the coordinator. Once all
  // modules have been codegened and optimized we hand this to the `lto`
  // module for further optimization. The `lto` module will return back a list
  // of more modules to work on, which the coordinator will continue to spawn
  // work for.
  //
  // Each LLVM module is automatically sent back to the coordinator for LTO if
  // necessary. There's already optimizations in place to avoid sending work
  // back to the coordinator if LTO isn't requested.
  // PORT: the closure is a generator: it yields where `coordinator_receive.recv()` blocks (header).
  const f = function* (): Generator<Chan<unknown>, Result<MaybeLtoModules<W>, null>, undefined> {
    const _profiler = cgcx.time_trace ? B_.thread_profiler() : undefined;
    try {
      // This is where we collect codegen units that have gone all the way
      // through codegen and LLVM.
      const compiled_modules: CompiledModule[] = [];
      const needs_fat_lto: FatLtoInput<W>[] = [];
      const needs_thin_lto: ThinLtoInput<W>[] = [];
      const lto_import_only_modules: [PathBuf, WorkProduct][] = [];

      /// Possible state transitions:
      /// - Ongoing -> Completed
      /// - Ongoing -> Aborted
      /// - Completed -> Aborted
      // #[derive(Debug, PartialEq)]
      type CodegenState = "Ongoing" | "Completed" | "Aborted";
      const debug_CodegenState = (v: CodegenState): string => v;
      let codegen_state: CodegenState = "Ongoing";

      // This is the queue of LLVM work items that still need processing.
      const work_items: [WorkItem<W>, number][] = [];

      // This are the Jobserver Tokens we currently hold. Does not include
      // the implicit Token the compiler process owns no matter what.
      const tokens: Acquired[] = [];

      let main_thread_state: MainThreadState = "Idle";

      // How many LLVM worker threads are running while holding a Token. This
      // *excludes* any that the main thread is lending a Token to.
      let running_with_own_token = 0;

      // How many LLVM worker threads are running in total. This *includes*
      // any that the main thread is lending a Token to.
      const running_with_any_token = (main_thread_state: MainThreadState, running_with_own_token: number): number =>
        running_with_own_token + (main_thread_state === "Lending" ? 1 : 0);

      const llvm_start_time: MutRef<VerboseTimingGuard | undefined> = { value: undefined };

      if (allocator_module !== undefined) {
        B_.optimize(cgcx, prof, shared_emitter, allocator_module, allocator_config);
      }

      // Run the message loop while there's still anything that needs message
      // processing. Note that as soon as codegen is aborted we simply want to
      // wait for all existing work to finish, so many of the conditions here
      // only apply if codegen hasn't been aborted as they represent pending
      // work to be done.
      for (;;) {
        // While there are still CGUs to be codegened, the coordinator has
        // to decide how to utilize the compiler processes implicit Token:
        // For codegenning more CGU or for running them through LLVM.
        if (codegen_state === "Ongoing") {
          if (main_thread_state === "Idle") {
            // Compute the number of workers that will be running once we've taken as many
            // items from the work queue as we can, plus one for the main thread. It's not
            // critically important that we use this instead of just
            // `running_with_own_token`, but it prevents the `queue_full_enough` heuristic
            // from fluctuating just because a worker finished up and we decreased the
            // `running_with_own_token` count, even though we're just going to increase it
            // right after this when we put a new worker to work.
            // `tokens.len().checked_sub(running_with_own_token).unwrap()`
            const extra_tokens = unwrap(tokens.length >= running_with_own_token ? tokens.length - running_with_own_token : undefined);
            const additional_running = Math.min(extra_tokens, work_items.length);
            const anticipated_running = running_with_own_token + additional_running + 1;

            if (!queue_full_enough(work_items.length, anticipated_running)) {
              // The queue is not full enough, process more codegen units:
              if (codegen_worker_send.send(CguMessage).$ === "Err") {
                panic("Could not send CguMessage to main thread");
              }
              main_thread_state = "Codegenning";
            } else {
              // The queue is full enough to not let the worker
              // threads starve. Use the implicit Token to do some
              // LLVM work too.
              const [item, _] = unwrap(work_items.pop(), "queue empty - queue_full_enough() broken?");
              main_thread_state = "Lending";
              spawn_work(B_, cgcx, prof, shared_emitter.clone(), coordinator_send.clone(), llvm_start_time, item, stack_size);
            }
          }
        } else if (codegen_state === "Completed") {
          if (running_with_any_token(main_thread_state, running_with_own_token) === 0 && work_items.length === 0) {
            // All codegen work is done.
            break;
          }

          // In this branch, we know that everything has been codegened,
          // so it's just a matter of determining whether the implicit
          // Token is free to use for LLVM work.
          switch (main_thread_state) {
            case "Idle": {
              const popped = work_items.pop();
              if (popped !== undefined) {
                const [item, _] = popped;
                main_thread_state = "Lending";
                spawn_work(B_, cgcx, prof, shared_emitter.clone(), coordinator_send.clone(), llvm_start_time, item, stack_size);
              } else {
                // There is no unstarted work, so let the main thread
                // take over for a running worker. Otherwise the
                // implicit token would just go to waste.
                // We reduce the `running` counter by one. The
                // `tokens.truncate()` below will take care of
                // giving the Token back.
                assert(running_with_own_token > 0, "assertion failed: running_with_own_token > 0");
                running_with_own_token -= 1;
                main_thread_state = "Lending";
              }
              break;
            }
            case "Codegenning":
              bug("codegen worker should not be codegenning after codegen was already completed");
            case "Lending":
              // Already making good use of that token
              break;
          }
        } else {
          // Don't queue up any more work if codegen was aborted, we're
          // just waiting for our existing children to finish.
          assert(codegen_state === "Aborted", "assertion failed: codegen_state == Aborted");
          if (running_with_any_token(main_thread_state, running_with_own_token) === 0) {
            break;
          }
        }

        // Spin up what work we can, only doing this while we've got available
        // parallelism slots and work left to spawn.
        if (codegen_state !== "Aborted") {
          let popped: [WorkItem<W>, number] | undefined;
          while (running_with_own_token < tokens.length && (popped = work_items.pop()) !== undefined) {
            const [item, _] = popped;
            spawn_work(B_, cgcx, prof, shared_emitter.clone(), coordinator_send.clone(), llvm_start_time, item, stack_size);
            running_with_own_token += 1;
          }
        }

        // Relinquish accidentally acquired extra tokens.
        tokens.length = Math.min(tokens.length, running_with_own_token);

        const msg = unwrap_result(yield* coordinator_receive.recv_in_thread(), debug_RecvError);
        switch (msg.$) {
          // Save the token locally and the next turn of the loop will use
          // this to spawn a new unit of work, or it may get dropped
          // immediately if we have no more work to spawn.
          case "Token": {
            const token = msg._0;
            if (token.$ === "Ok") {
              tokens.push(token._0);

              if (main_thread_state === "Lending") {
                // If the main thread token is used for LLVM work
                // at the moment, we turn that thread into a regular
                // LLVM worker thread, so the main thread is free
                // to react to codegen demand.
                main_thread_state = "Idle";
                running_with_own_token += 1;
              }
            } else {
              const e = token._0;
              const msg_ = `failed to acquire jobserver token: ${display_IoError(e)}`;
              shared_emitter.fatal(msg_);
              codegen_state = "Aborted";
            }
            break;
          }

          case "CodegenDone": {
            const { llvm_work_item, cost } = msg;
            // We keep the queue sorted by estimated processing cost,
            // so that more expensive items are processed earlier. This
            // is good for throughput as it gives the main thread more
            // time to fill up the queue and it avoids scheduling
            // expensive items to the end.
            // Note, however, that this is not ideal for memory
            // consumption, as LLVM module sizes are not evenly
            // distributed.
            const insertion_index = binary_search_by_cost(work_items, cost);
            work_items.splice(insertion_index, 0, [llvm_work_item, cost]);

            if (jobserver_helper !== undefined && running_with_any_token(main_thread_state, running_with_own_token) < unwrap(cgcx.parallel)) {
              jobserver_helper.request_token();
            }
            assert_eq(main_thread_state, "Codegenning", String);
            main_thread_state = "Idle";
            break;
          }

          case "CodegenComplete": {
            if (codegen_state !== "Aborted") {
              codegen_state = "Completed";
            }
            assert_eq(main_thread_state, "Codegenning", String);
            main_thread_state = "Idle";
            break;
          }

          // If codegen is aborted that means translation was aborted due
          // to some normal-ish compiler error. In this situation we want
          // to exit as soon as possible, but we want to make sure all
          // existing work has finished. Flag codegen as being done, and
          // then conditions above will ensure no more work is spawned but
          // we'll keep executing this loop until `running_with_own_token`
          // hits 0.
          case "CodegenAborted": {
            codegen_state = "Aborted";
            break;
          }

          case "WorkItem": {
            const result = msg.result;
            // If a thread exits successfully then we drop a token associated
            // with that worker and update our `running_with_own_token` count.
            // We may later re-acquire a token to continue running more work.
            // We may also not actually drop a token here if the worker was
            // running with an "ephemeral token".
            if (main_thread_state === "Lending") {
              main_thread_state = "Idle";
            } else {
              running_with_own_token -= 1;
            }

            if (result.$ === "Ok") {
              const r = result._0;
              switch (r.$) {
                case "Finished": {
                  const compiled_module = r._0;
                  compiled_modules.push(compiled_module);
                  break;
                }
                case "NeedsFatLto": {
                  const fat_lto_input = r._0;
                  assert(needs_thin_lto.length === 0, "assertion failed: needs_thin_lto.is_empty()");
                  needs_fat_lto.push(fat_lto_input);
                  break;
                }
                case "NeedsThinLto": {
                  const [name, thin_buffer] = [r._0, r._1];
                  assert(needs_fat_lto.length === 0, "assertion failed: needs_fat_lto.is_empty()");
                  needs_thin_lto.push({
                    $: "Red",
                    name,
                    buffer: { $: "Local", _0: thin_buffer },
                  });
                  break;
                }
              }
            } else if (result._0 !== undefined) {
              // Err(Some(WorkerFatalError))
              // Like `CodegenAborted`, wait for remaining work to finish.
              codegen_state = "Aborted";
            } else {
              // Err(None)
              // If the thread failed that means it panicked, so
              // we abort immediately.
              bug("worker thread panicked");
            }
            break;
          }

          case "AddImportOnlyModule": {
            const { bitcode_path, work_product } = msg;
            assert_eq(codegen_state, "Ongoing", debug_CodegenState);
            assert_eq(main_thread_state, "Codegenning", String);
            lto_import_only_modules.push([bitcode_path, work_product]);
            main_thread_state = "Idle";
            break;
          }
        }
      }

      // Drop to print timings
      // drop(llvm_start_time); PORT: the stand-in guard prints nothing (header).
      llvm_start_time.value = undefined;

      if (codegen_state === "Aborted") {
        return Err(null);
      }

      // drop(codegen_state);
      // drop(tokens);
      // drop(jobserver_helper);
      assert(work_items.length === 0, "assertion failed: work_items.is_empty()");

      if (needs_fat_lto.length !== 0) {
        assert(compiled_modules.length === 0, "assertion failed: compiled_modules.is_empty()");
        assert(needs_thin_lto.length === 0, "assertion failed: needs_thin_lto.is_empty()");

        const am = allocator_module;
        allocator_module = undefined;
        if (am !== undefined) {
          needs_fat_lto.push({ $: "InMemory", _0: am });
        }

        for (const [bitcode_path, wp] of lto_import_only_modules) {
          needs_fat_lto.push({ $: "Serialized", name: (wp as { cgu_name: string }).cgu_name, bitcode_path });
        }

        return Ok({ $: "FatLto", cgcx, needs_fat_lto });
      } else if (needs_thin_lto.length !== 0 || lto_import_only_modules.length !== 0) {
        assert(compiled_modules.length === 0, "assertion failed: compiled_modules.is_empty()");
        assert(needs_fat_lto.length === 0, "assertion failed: needs_fat_lto.is_empty()");

        for (const [bitcode_path, wp] of lto_import_only_modules) {
          needs_thin_lto.push({ $: "Green", wp, bitcode_path });
        }

        if (cgcx.lto === "ThinLocal") {
          compiled_modules.push(...do_thin_lto(B_, cgcx, prof, shared_emitter.clone(), tm_factory, exported_symbols_for_lto, [], needs_thin_lto, stack_size));
        } else {
          const am = allocator_module;
          allocator_module = undefined;
          if (am !== undefined) {
            const thin_buffer = B_.serialize_module(am.module_llvm, true);
            needs_thin_lto.push({
              $: "Red",
              name: am.name,
              buffer: { $: "Local", _0: thin_buffer },
            });
          }

          return Ok({ $: "ThinLto", cgcx, needs_thin_lto });
        }
      }

      return Ok({
        $: "NoLto",
        _0: new CompiledModules(
          /* modules */ compiled_modules,
          /* allocator_module */ allocator_module !== undefined ? B_.codegen(cgcx, prof, shared_emitter, allocator_module, allocator_config) : undefined,
        ),
      });
    } finally {
      // `_profiler` is dropped at the end of the closure.
      drop_profiler(_profiler);
    }
  };
  const handle = spawn_thread("coordinator", f);
  // PORT: the senders `f` owns (`codegen_worker_send`, `shared_emitter`) live as long as this thread.
  codegen_worker_send.chan.producer = handle;
  shared_emitter.sender.chan.producer = handle;
  return handle;

  // A heuristic that determines if we have enough LLVM WorkItems in the
  // queue so that the main thread can do LLVM work instead of codegen
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1787 queue_full_enough
  function queue_full_enough(items_in_queue: number, workers_running: number): boolean {
    // This heuristic scales ahead-of-time codegen according to available
    // concurrency, as measured by `workers_running`. The idea is that the
    // more concurrency we have available, the more demand there will be for
    // work items, and the fuller the queue should be kept to meet demand.
    // An important property of this approach is that we codegen ahead of
    // time only as much as necessary, so as to keep fewer LLVM modules in
    // memory at once, thereby reducing memory consumption.
    //
    // When the number of workers running is less than the max concurrency
    // available to us, this heuristic can cause us to instruct the main
    // thread to work on an LLVM item (that is, tell it to "LLVM") instead
    // of codegen, even though it seems like it *should* be codegenning so
    // that we can create more work items and spawn more LLVM workers.
    //
    // But this is not a problem. When the main thread is told to LLVM,
    // according to this heuristic and how work is scheduled, there is
    // always at least one item in the queue, and therefore at least one
    // pending jobserver token request. If there *is* more concurrency
    // available, we will immediately receive a token, which will upgrade
    // the main thread's LLVM worker to a real one (conceptually), and free
    // up the main thread to codegen if necessary. On the other hand, if
    // there isn't more concurrency, then the main thread working on an LLVM
    // item is appropriate, as long as the queue is full enough for demand.
    //
    // Speaking of which, how full should we keep the queue? Probably less
    // full than you'd think. A lot has to go wrong for the queue not to be
    // full enough and for that to have a negative effect on compile times.
    //
    // Workers are unlikely to finish at exactly the same time, so when one
    // finishes and takes another work item off the queue, we often have
    // ample time to codegen at that point before the next worker finishes.
    // But suppose that codegen takes so long that the workers exhaust the
    // queue, and we have one or more workers that have nothing to work on.
    // Well, it might not be so bad. Of all the LLVM modules we create and
    // optimize, one has to finish last. It's not necessarily the case that
    // by losing some concurrency for a moment, we delay the point at which
    // that last LLVM module is finished and the rest of compilation can
    // proceed. Also, when we can't take advantage of some concurrency, we
    // give tokens back to the job server. That enables some other rustc to
    // potentially make use of the available concurrency. That could even
    // *decrease* overall compile time if we're lucky. But yes, if no other
    // rustc can make use of the concurrency, then we've squandered it.
    //
    // However, keeping the queue full is also beneficial when we have a
    // surge in available concurrency. Then items can be taken from the
    // queue immediately, without having to wait for codegen.
    //
    // So, the heuristic below tries to keep one item in the queue for every
    // four running workers. Based on limited benchmarking, this appears to
    // be more than sufficient to avoid increasing compilation times.
    const quarter_of_workers = workers_running - Math.floor((3 * workers_running) / 4);
    return items_in_queue > 0 && items_in_queue >= quarter_of_workers;
  }
}

/// `FatalError` is explicitly not `Send`.
// #[must_use]
export class WorkerFatalError {}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1847 spawn_work
function spawn_work<W extends WriteBackendTypes>(
  B_: WriteBackendMethods<W>,
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  coordinator_send: Sender<Message<W>>,
  llvm_start_time: MutRef<VerboseTimingGuard | undefined>,
  work: WorkItem<W>,
  stack_size: number,
): void {
  if (llvm_start_time.value === undefined) {
    llvm_start_time.value = prof.verbose_generic_activity("LLVM_passes");
  }

  // let cgcx = cgcx.clone(); let prof = prof.clone(); (the same values, header)

  const name = WorkItem.short_description(work);
  const f = (): void => {
    const _profiler = cgcx.time_trace ? B_.thread_profiler() : undefined;
    try {
      const result = catch_unwind((): WorkItemResult<W> => {
        switch (work.$) {
          case "Optimize":
            return execute_optimize_work_item(B_, cgcx, prof, shared_emitter, work._0);
          case "CopyPostLtoArtifacts":
            return { $: "Finished", _0: execute_copy_from_cache_work_item(cgcx, prof, shared_emitter, work._0) };
        }
      });

      let msg: Message<W>;
      if (result.$ === "Ok") {
        msg = { $: "WorkItem", result: Ok(result._0) };
      } else if (result._0 instanceof FatalErrorMarker) {
        // We ignore any `FatalError` coming out of `execute_work_item`, as a
        // diagnostic was already sent off to the main thread - just surface
        // that there was an error in this worker.
        msg = { $: "WorkItem", result: Err(new WorkerFatalError()) };
      } else {
        msg = { $: "WorkItem", result: Err(undefined) };
      }
      void coordinator_send.send(msg);
    } finally {
      drop_profiler(_profiler);
    }
  };
  spawn_worker_thread(name, stack_size, f);
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1895 spawn_thin_lto_work
function spawn_thin_lto_work<W extends WriteBackendTypes>(
  B_: WriteBackendMethods<W>,
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  tm_factory: TargetMachineFactoryFn<W>,
  coordinator_send: Sender<ThinLtoMessage>,
  work: ThinLtoWorkItem<W>,
  stack_size: number,
): void {
  // let cgcx = cgcx.clone(); let prof = prof.clone(); (the same values, header)

  const name = ThinLtoWorkItem.short_description(work);
  const f = (): void => {
    const _profiler = cgcx.time_trace ? B_.thread_profiler() : undefined;
    try {
      const result = catch_unwind((): CompiledModule => {
        switch (work.$) {
          case "CopyPostLtoArtifacts":
            return execute_copy_from_cache_work_item(cgcx, prof, shared_emitter, work._0);
          case "ThinLto": {
            const m = work._0;
            const _timer = prof.generic_activity("codegen_module_perform_lto");
            return B_.optimize_and_codegen_thin(cgcx, prof, shared_emitter, tm_factory, m);
          }
        }
      });

      let msg: ThinLtoMessage;
      if (result.$ === "Ok") {
        msg = { $: "WorkItem", result: Ok(result._0) };
      } else if (result._0 instanceof FatalErrorMarker) {
        // We ignore any `FatalError` coming out of `execute_work_item`, as a
        // diagnostic was already sent off to the main thread - just surface
        // that there was an error in this worker.
        msg = { $: "WorkItem", result: Err(new WorkerFatalError()) };
      } else {
        msg = { $: "WorkItem", result: Err(undefined) };
      }
      void coordinator_send.send(msg);
    } finally {
      drop_profiler(_profiler);
    }
  };
  spawn_worker_thread(name, stack_size, f);
}

type SharedEmitterMessage =
  | { readonly $: "Diagnostic"; _0: DiagInner }
  | { readonly $: "InlineAsmError"; _0: InlineAsmError }
  | { readonly $: "Fatal"; _0: string };

export interface InlineAsmError {
  // We store byte positions rather than a `Span` because this error is created on a codegen
  // thread which doesn't have access to the span interner within the session globals. The byte
  // positions are converted to a `Span` once they reach a thread with access to the span
  // interner.
  lo: BytePos;
  hi: BytePos;
  msg: string;
  level: Level;
  source: [string, InnerSpan[]] | undefined;
}

// #[derive(Clone)]
export class SharedEmitter extends Emitter {
  constructor(readonly sender: Sender<SharedEmitterMessage>) {
    super();
  }

  /** `#[derive(Clone)]`: the sender is the same handle. */
  clone(): SharedEmitter {
    return new SharedEmitter(this.sender.clone());
  }

  // impl SharedEmitter
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1970 new
  static new(): [SharedEmitter, SharedEmitterMain] {
    const [sender, receiver] = channel<SharedEmitterMessage>();

    return [new SharedEmitter(sender), new SharedEmitterMain(receiver)];
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1976 inline_asm_error
  inline_asm_error(err: InlineAsmError): void {
    void this.sender.send({ $: "InlineAsmError", _0: err });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1980 fatal
  fatal(msg: string): void {
    void this.sender.send({ $: "Fatal", _0: msg });
  }

  // impl Emitter for SharedEmitter
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1986 emit_diagnostic
  emit_diagnostic(diag: DiagInner): void {
    void this.sender.send({ $: "Diagnostic", _0: diag });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1990 source_map
  source_map(): SourceMap | undefined {
    return undefined;
  }
}

export class SharedEmitterMain {
  constructor(private readonly receiver: Receiver<SharedEmitterMessage>) {}

  // impl SharedEmitterMain
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:1996 check
  check(sess: Session, blocking: boolean): void {
    for (;;) {
      let message: Result<SharedEmitterMessage, null>;
      if (blocking) {
        const r = this.receiver.recv();
        message = r.$ === "Ok" ? Ok(r._0) : Err(null);
      } else {
        const r = this.receiver.try_recv();
        message = r.$ === "Ok" ? Ok(r._0) : Err(null);
      }

      if (message.$ === "Ok" && message._0.$ === "Diagnostic") {
        const diag = message._0._0;
        const dcx = sess.dcx();
        dcx.emit_diagnostic(diag);
        sess.dcx().abort_if_errors();
      } else if (message.$ === "Ok" && message._0.$ === "InlineAsmError") {
        const inner = message._0._0;
        assert_matches(inner.level, inner.level.$ === "Error" || (inner.level.$ === "Warning" && inner.level._0 === undefined) || inner.level.$ === "Note", "Level::Error | Level::Warning(None) | Level::Note", (l) => l.$);
        const err = Diag.new(sess.dcx(), inner.level, inner.msg);
        const span = Span.new(inner.lo, inner.hi, SyntaxContext.root(), undefined);
        if (!Span.is_dummy(span)) {
          err.span(span);
        }

        // Point to the generated assembly if it is available.
        if (inner.source !== undefined) {
          const [buffer, spans] = inner.source;
          const source = sess.source_map().new_source_file(FileName.inline_asm_source_code(buffer), Str.from(buffer));
          const spans_ = spans.map((sp) => Span.with_root_ctxt(source.normalized_byte_pos(sp.start), source.normalized_byte_pos(sp.end)));
          err.span_note(spans_, "instantiated into assembly here");
        }

        err.emit();
      } else if (message.$ === "Ok" && message._0.$ === "Fatal") {
        const msg = message._0._0;
        sess.dcx().fatal(msg);
      } else {
        break;
      }
    }
  }
}

export class Coordinator<W extends WriteBackendTypes> {
  constructor(
    readonly sender: Sender<Message<W>>,
    public future: JoinHandle<Result<MaybeLtoModules<W>, null>> | undefined,
    // Only used for the Message type.
    // phantom: PhantomData<B>,
  ) {}

  // impl<B: WriteBackendMethods> Coordinator<B>
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2062 join
  join(): Result<Result<MaybeLtoModules<W>, null>, unknown> {
    const future = unwrap(this.future);
    this.future = undefined;
    return future.join();
  }

  // impl<B: WriteBackendMethods> Drop for Coordinator<B>
  // PORT: `Drop` is this method (as rustc_codegen_llvm's `ModuleLlvm`); nothing in the port drops an `OngoingCodegen`
  // that was not joined yet (handoff).
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2068 drop
  drop(): void {
    const future = this.future;
    this.future = undefined;
    if (future !== undefined) {
      // If we haven't joined yet, signal to the coordinator that it should spawn no more
      // work, and wait for worker threads to finish.
      void this.sender.send({ $: "CodegenAborted" });
      void future.join();
    }
  }
}

export class OngoingCodegen<W extends WriteBackendTypes> {
  constructor(
    readonly backend: WriteBackendMethods<W>,
    readonly output_filenames: OutputFilenames,
    // Field order below is intended to terminate the coordinator thread before two fields below
    // drop and prematurely close channels used by coordinator thread. See `Coordinator`'s
    // `Drop` implementation for more info.
    readonly coordinator: Coordinator<W>,
    readonly codegen_worker_receive: Receiver<CguMessage>,
    readonly shared_emitter_main: SharedEmitterMain,
  ) {}

  // impl<B: WriteBackendMethods> OngoingCodegen<B>
  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2090 join
  join(sess: Session, incr_comp_session: IncrCompSession | undefined, crate_info: CrateInfo): [CompiledModules, WorkProductMap] {
    this.shared_emitter_main.check(sess, true);

    const maybe_lto_modules = sess.time("join_worker_thread", (): MaybeLtoModules<W> => {
      const r = this.coordinator.join();
      if (r.$ === "Ok" && r._0.$ === "Ok") {
        return r._0._0;
      } else if (r.$ === "Ok") {
        sess.dcx().abort_if_errors();
        return panic("expected abort due to worker thread errors");
      } else {
        return bug("panic during codegen/LLVM phase");
      }
    });

    sess.dcx().abort_if_errors();

    const [shared_emitter, shared_emitter_main] = SharedEmitter.new();

    // Catch fatal errors to ensure shared_emitter_main.check() can emit the actual diagnostics
    const compiled_modules_ = catch_fatal_errors((): CompiledModules => {
      switch (maybe_lto_modules.$) {
        case "NoLto": {
          const compiled_modules = maybe_lto_modules._0;
          // drop(shared_emitter);
          return compiled_modules;
        }
        case "FatLto": {
          const { cgcx, needs_fat_lto } = maybe_lto_modules;
          const tm_factory = this.backend.target_machine_factory(sess, cgcx.opt_level);

          return new CompiledModules(
            /* modules */ [
              do_fat_lto(this.backend, sess, cgcx, shared_emitter, tm_factory, crate_info.exported_symbols_for_lto, crate_info.each_linked_rlib_file_for_lto, needs_fat_lto),
            ],
            /* allocator_module */ undefined,
          );
        }
        case "ThinLto": {
          const { cgcx, needs_thin_lto } = maybe_lto_modules;
          const tm_factory = this.backend.target_machine_factory(sess, cgcx.opt_level);

          return new CompiledModules(
            /* modules */ do_thin_lto(
              this.backend,
              cgcx,
              sess.prof,
              shared_emitter,
              tm_factory,
              crate_info.exported_symbols_for_lto,
              crate_info.each_linked_rlib_file_for_lto,
              needs_thin_lto,
              sess.opts.recommended_stack_size,
            ),
            /* allocator_module */ undefined,
          );
        }
      }
    });

    shared_emitter_main.check(sess, true);

    sess.dcx().abort_if_errors();

    if (compiled_modules_.$ === "Err") {
      return panic("fatal error emitted but not sent to SharedEmitter");
    }
    const compiled_modules = compiled_modules_._0;

    // Regardless of what order these modules completed in, report them to
    // the backend in the same order every time to ensure that we're handing
    // out deterministic results.
    compiled_modules.modules.sort((a, b) => str_cmp(a.name, b.name));

    const work_products = copy_all_cgu_workproducts_to_incr_comp_cache_dir(sess, incr_comp_session, compiled_modules);
    produce_final_output_artifacts(sess, compiled_modules, this.output_filenames);

    return [compiled_modules, work_products];
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2176 codegen_finished
  codegen_finished(tcx: TyCtxt): void {
    this.wait_for_signal_to_codegen_item();
    this.check_for_errors(tcx.sess);
    void this.coordinator.sender.send({ $: "CodegenComplete" });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2182 check_for_errors
  check_for_errors(sess: Session): void {
    this.shared_emitter_main.check(sess, false);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2186 wait_for_signal_to_codegen_item
  wait_for_signal_to_codegen_item(): void {
    const r = this.codegen_worker_receive.recv();
    if (r.$ === "Ok") {
      // Ok to proceed.
    } else {
      // One of the LLVM threads must have panicked, fall through so
      // error handling can be reached.
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2199 submit_codegened_module_to_llvm
export function submit_codegened_module_to_llvm<W extends WriteBackendTypes>(coordinator: Coordinator<W>, module: ModuleCodegen<W["Module"]>, cost: number): void {
  const llvm_work_item: WorkItem<W> = { $: "Optimize", _0: module };
  void coordinator.sender.send({ $: "CodegenDone", llvm_work_item, cost });
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2208 submit_post_lto_module_to_llvm
export function submit_post_lto_module_to_llvm<W extends WriteBackendTypes>(coordinator: Coordinator<W>, module: CachedModuleCodegen): void {
  const llvm_work_item: WorkItem<W> = { $: "CopyPostLtoArtifacts", _0: module };
  void coordinator.sender.send({ $: "CodegenDone", llvm_work_item, cost: 0 });
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2216 submit_pre_lto_module_to_llvm
export function submit_pre_lto_module_to_llvm<W extends WriteBackendTypes>(tcx: TyCtxt, coordinator: Coordinator<W>, module: CachedModuleCodegen): void {
  const filename = pre_lto_bitcode_filename(module.name);
  // PORT: the rest copies the pre-LTO bitcode between the incremental session directories (rustc_incremental
  // `in_old_incr_comp_dir_sess` / `in_incr_comp_dir_sess`, rustc_fs_util `link_or_copy`, not ported), emits
  // `CopyPathBuf` on failure, and sends `Message::AddImportOnlyModule { bitcode_path, work_product: module.source }`.
  // A `CguReuse::PreLto` exists only with `-C incremental` (plan-m7 D11).
  void tcx;
  void coordinator;
  return unported(`rustc_codegen_ssa::back::write::submit_pre_lto_module_to_llvm (${filename}: rustc_incremental in_old_incr_comp_dir_sess; -C incremental, plan-m7 D11)`);
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2246 pre_lto_bitcode_filename
function pre_lto_bitcode_filename(module_name: string): string {
  return `${module_name}.${PRE_LTO_BC_EXT}`;
}

// rustc: compiler/rustc_codegen_ssa/src/back/write.rs:2250 msvc_imps_needed
function msvc_imps_needed(tcx: TyCtxt): boolean {
  // This should never be true (because it's not supported). If it is true,
  // something is wrong with commandline arg validation.
  assert(
    !(LinkerPluginLto.enabled(tcx.sess.opts.cg.linker_plugin_lto) && tcx.sess.target.is_like_windows && tcx.sess.opts.cg.prefer_dynamic),
    "assertion failed: !(tcx.sess.opts.cg.linker_plugin_lto.enabled() && tcx.sess.target.is_like_windows && tcx.sess.opts.cg.prefer_dynamic)",
  );

  // We need to generate _imp__ symbol if we are generating an rlib or we include one
  // indirectly from ThinLTO. In theory these are not needed as ThinLTO could resolve
  // these, but it currently does not do so.
  const can_have_static_objects = tcx.sess.lto() === "Thin" || tcx.crate_types().includes("Rlib");

  return (
    tcx.sess.target.is_like_windows &&
    can_have_static_objects &&
    // ThinLTO can't handle this workaround in all cases, so we don't
    // emit the `__imp_` symbols. Instead we make them unnecessary by disallowing
    // dynamic linking when linker plugin LTO is enabled.
    !LinkerPluginLto.enabled(tcx.sess.opts.cg.linker_plugin_lto)
  );
}

/** Not upstream: for tests (write.test.ts). */
export const __test = { binary_search_by_cost, desc_not_windows, desc_windows };
