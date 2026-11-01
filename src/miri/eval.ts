// Fill lane: `miri-eval` (plan-m6 wave 36): ported by this lane.
// Port of src/tools/miri/src/eval.rs (crate `miri`, plan-m6 D2; lane miri-eval, wave 36): main evaluator loop and
// setting up the initial stack frame. Its types are generated into eval.gen.ts (tools/codegen set `miri`); this module
// re-exports them.
//
// PORT:
// - `impl Default for MiriConfig` is `MiriConfig.default()` (companion of the generated interface). Its
//   `FxHashMap` / `FxHashSet` fields are rust_ts/hash_map.ts's hashbrown-ordered `FxHashMap` / `FxHashSet`: shims/env.rs
//   iterates `set_env_vars`, so its order is observable. `BorTag` / `AllocId` are `NonZero<u64>` (their `Hash` writes
//   the `u64`, which FxHasher treats as `usize` on the 64-bit hosts): `usize_key`.
// - `MainThreadState::on_main_stack_empty(&mut self, ..)` takes the state as a `MutRef` (`*self = X` writes `.value`).
// - `Poll<()>` is src/std/task.ts's `Poll<null>` (also the stack-empty callbacks' result type: thread.ts
//   `StackEmptyCallback`, global_ctor.ts / tls.ts `on_stack_empty`).
// - `#[derive(Default)]` of `GlobalCtorState` / `TlsDtorsState` (both `#[default] Init`) is built here from the generated
//   types (`GlobalCtorStatePriv.Init` / `TlsDtorsStatePriv.Init`).
// - `panic::catch_unwind(|| ecx.run_threads())` is a `try`/`catch`: a `FatalErrorMarker` (rustc's unwinding
//   `dcx().fatal`) is rethrown as is, any other throw first runs `handle_ice` (the ICE report).
import { type BorTag, BorrowTrackerMethod } from "./borrow_tracker/mod.ts";
import { FxHashMap, FxHashSet, type KeyType, LAYOUT_VEC, String_key, usize_key } from "../rust_ts/hash_map.ts";
import { type GenmcCtx } from "./concurrency/genmc/dummy.ts";
import { ThreadId } from "./concurrency/thread.gen.ts";
import { type StackEmptyCallback } from "./concurrency/thread.ts";
import { GlobalDataRaceHandler } from "./concurrency/data_race_handler.ts";
import { report_leaks, report_result } from "./diagnostics.ts";
import * as gen from "./eval.gen.ts";
import { type MainThreadState, type MiriEntryFnType } from "./eval.gen.ts";
import { is_no_core, throw_machine_stop, try_resolve_path } from "./helpers.ts";
import { type ImmTy, type MPlaceTy } from "./lib.ts";
import { MemoryKind_from_MiriMemoryKind, type MiriInterpCx, MiriMachine } from "./machine.ts";
import { MiriImmTy } from "./operator.ts";
import { GlobalCtorState, GlobalCtorStatePriv } from "./shims/global_ctor.gen.ts";
import { TlsDtorsState, TlsDtorsStatePriv } from "./shims/tls.gen.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { check_function_signature } from "../rustc_hir_analysis/check/mod.ts";
import { ExportedSymbol, type SymbolExportInfo } from "../rustc_middle/middle/exported_symbols.ts";
import { type EntryFnType } from "../rustc_passes/entry.ts";
import { type AllocId, debug_AllocId, InterpErrorInfo_from_InterpErrorKind, InterpResult, interp_ok, Scalar as interp_Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import { ObligationCause, ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { LayoutCx } from "../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DEFAULT as sigpipe_DEFAULT } from "../rustc_session/config/sigpipe.ts";
import { DefId, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { fold_FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type MutRef } from "../std/mut_ref.ts";
import { Panic, assert, panic, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import { Poll } from "../std/task.ts";
import { PLAIN, debug_vec } from "../std/fmt.ts";
import * as tracing from "../rust_ts/tracing.ts";
import { debug_InterpErrorKind } from "../rustc_middle/mir/interpret/error.gen.ts";
export * from "./eval.gen.ts";

/// Finds the entry point Miri should execute.
///
/// Public because this is used by Priroda.
// rustc: src/tools/miri/src/eval.rs:40 entry_fn
export function entry_fn(tcx: TyCtxt): [DefId, MiriEntryFnType] {
  const e = tcx.entry_fn(null) as [DefId, EntryFnType] | undefined;
  if (e !== undefined) {
    const [def_id, entry_type] = e;
    return [def_id, { $: "Rustc", _0: entry_type }];
  }
  // Look for a symbol in the local crate named `miri_start`, and treat that as the entry point.
  let sym: ExportedSymbol | undefined;
  for (const [s, _] of tcx.exported_non_generic_symbols(LOCAL_CRATE) as readonly [ExportedSymbol, SymbolExportInfo][]) {
    if (ExportedSymbol.symbol_name_for_local_instance(s, tcx).name === "miri_start") {
      sym = s;
      break;
    }
  }
  if (sym !== undefined && sym.$ === "NonGeneric") {
    const id = sym._0;
    const start_def_id = id.expect_local();
    const start_span = tcx.def_span(start_def_id);

    const expected_sig = Binder.dummy(
      tcx.mk_fn_sig_safe_rust_abi([tcx.types.isize, Ty.new_imm_ptr(tcx, Ty.new_imm_ptr(tcx, tcx.types.u8))], tcx.types.isize),
      fold_FnSig,
    );

    const correct_func_sig =
      check_function_signature(tcx, ObligationCause.new(start_span, start_def_id, ObligationCauseCode.Misc), id, expected_sig).$ === "Ok";

    if (correct_func_sig) {
      return [id, gen.MiriEntryFnType.MiriStart];
    } else {
      return tcx.dcx().fatal("`miri_start` must have the following signature:\nfn miri_start(argc: isize, argv: *const *const u8) -> isize");
    }
  } else {
    return tcx
      .dcx()
      .fatal(
        "Miri can only run programs that have a main function.\n" +
          "Alternatively, you can export a `miri_start` function:\n" +
          "\n" +
          "#[cfg(miri)]\n" +
          "#[unsafe(no_mangle)]\n" +
          "fn miri_start(argc: isize, argv: *const *const u8) -> isize {" +
          "\n    // Call the actual start function that your project implements, based on your target's conventions.\n" +
          "}",
      );
  }
}

/// When the main thread would exit, we will yield to any other thread that is ready to execute.
/// But we must only do that a finite number of times, or a background thread running `loop {}`
/// will hang the program.
const MAIN_THREAD_YIELDS_AT_SHUTDOWN = 256;

/// Configuration needed to spawn a Miri instance.
export type MiriConfig = gen.MiriConfig;
export const MiriConfig = {
  // impl Default for MiriConfig
  // rustc: src/tools/miri/src/eval.rs:178 default
  default(): MiriConfig {
    return {
      env: [],
      validation: "Shallow",
      borrow_tracker: BorrowTrackerMethod.StackedBorrows,
      check_alignment: "Int",
      isolated_op: { $: "Reject", _0: "Abort" },
      ignore_leaks: false,
      forwarded_env_vars: [],
      set_env_vars: FxHashMap.default<string, string>(String_key, LAYOUT_VEC),
      args: [],
      current_exe: undefined,
      seed: undefined,
      tracked_pointer_tags: FxHashSet.default(usize_key as unknown as KeyType<BorTag>),
      tracked_alloc_ids: FxHashSet.default(usize_key as unknown as KeyType<AllocId>),
      track_alloc_accesses: false,
      data_race_detector: true,
      weak_memory_emulation: true,
      genmc_config: undefined,
      track_outdated_loads: false,
      cmpxchg_weak_failure_rate: 0.8, // 80%
      measureme_out: undefined,
      backtrace_style: "Short",
      provenance_mode: "Default",
      mute_stdout_stderr: false,
      preemption_rate: 0.01, // 1%
      report_progress: undefined,
      native_lib: [],
      native_lib_enable_tracing: false,
      gc_interval: 10_000,
      num_cpus: 1,
      page_size: undefined,
      collect_leak_backtraces: true,
      address_reuse_rate: 0.5,
      address_reuse_cross_thread_rate: 0.1,
      fixed_scheduling: false,
      float_nondet: true,
      float_rounding_error: "Random",
      short_fd_operations: true,
      user_relevant_crates: [],
    };
  },
};

/// The state of the main thread. Implementation detail of `on_main_stack_empty`.
// rustc: src/tools/miri/src/eval.rs:243 on_main_stack_empty
function on_main_stack_empty(self: MutRef<MainThreadState>, this_: MiriInterpCx): InterpResult<Poll<null>> {
  // use MainThreadState::*;
  const state = self.value;
  switch (state.$) {
    case "GlobalCtors": {
      const { ctor_state, entry_id, entry_type, argc, argv } = state;
      const p = ctor_state.on_stack_empty(this_);
      if (p.$ === "Err") return p;
      switch (p._0.$) {
        case "Pending":
          break; // just keep going
        case "Ready": {
          const r = call_main(this_, entry_id, entry_type, argc, argv);
          if (r.$ === "Err") return r;
          self.value = gen.MainThreadState.Running;
          break;
        }
      }
      break;
    }
    case "Running": {
      self.value = { $: "TlsDtors", _0: new TlsDtorsState(TlsDtorsStatePriv.Init) };
      break;
    }
    case "TlsDtors": {
      const p = state._0.on_stack_empty(this_);
      if (p.$ === "Err") return p;
      switch (p._0.$) {
        case "Pending":
          break; // just keep going
        case "Ready": {
          if (GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race) !== undefined) {
            // In GenMC mode, we don't yield at the end of the main thread.
            // Instead, the `GenmcCtx` will ensure that unfinished threads get a chance to run at this point.
            self.value = gen.MainThreadState.Done;
          } else {
            // Give background threads a chance to finish by yielding the main thread a
            // couple of times -- but only if we would also preempt threads randomly.
            if (this_.machine.preemption_rate > 0.0) {
              // There is a non-zero chance they will yield back to us often enough to
              // make Miri terminate eventually.
              self.value = { $: "Yield", remaining: MAIN_THREAD_YIELDS_AT_SHUTDOWN };
            } else {
              // The other threads did not get preempted, so no need to yield back to
              // them.
              self.value = gen.MainThreadState.Done;
            }
          }
          break;
        }
      }
      break;
    }
    case "Yield": {
      const remaining = state.remaining;
      if (remaining === 0) {
        self.value = gen.MainThreadState.Done;
      } else {
        const new_remaining = remaining - 1;
        state.remaining = new_remaining;
        this_.yield_active_thread();
      }
      break;
    }
    case "Done": {
      // Figure out exit code.
      const ret_place = this_.machine.main_fn_ret_place;
      if (ret_place === undefined) panic("called `Option::unwrap()` on a `None` value");
      const exit_code_r = this_.read_target_isize(ret_place);
      if (exit_code_r.$ === "Err") return exit_code_r;
      const exit_code64 = exit_code_r._0;
      // Rust uses `isize` but the underlying type of an exit code is `i32`.
      // Do a saturating cast.
      const exit_code =
        exit_code64 >= -0x8000_0000n && exit_code64 <= 0x7fff_ffffn ? Number(exit_code64) : exit_code64 >= 0n ? 0x7fff_ffff : -0x8000_0000;
      // Deal with our thread-local memory. We do *not* want to actually free it, instead we consider TLS
      // to be like a global `static`, so that all memory reached by it is considered to "not leak".
      const t = this_.terminate_active_thread("Leak");
      if (t.$ === "Err") return t;

      // In GenMC mode, we do not immediately stop execution on main thread exit.
      const genmc_ctx = GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race);
      if (genmc_ctx !== undefined) {
        // If there's no error, execution will continue (on another thread).
        const h = genmc_ctx.handle_exit(ThreadId.MAIN_THREAD, exit_code, "MainThreadFinish");
        if (h.$ === "Err") return h;
      } else {
        // Stop interpreter loop.
        return throw_machine_stop({ $: "Exit", code: exit_code, leak_check: true });
      }
      break;
    }
  }
  return interp_ok(Poll.Pending);
}

/// Returns a freshly created `InterpCx`.
/// Public because this is also used by `priroda`.
// rustc: src/tools/miri/src/eval.rs:330 create_ecx
export function create_ecx(
  tcx: TyCtxt,
  entry_id: DefId,
  entry_type: MiriEntryFnType,
  config: MiriConfig,
  genmc_ctx: GenmcCtx | undefined,
): InterpResult<MiriInterpCx> {
  const typing_env = TypingEnv.fully_monomorphized();
  const layout_cx = LayoutCx.new(tcx, typing_env);
  const ecx: MiriInterpCx = InterpCx.new(tcx, DUMMY_SP, typing_env, MiriMachine.new(config, layout_cx, genmc_ctx));

  // Make sure we have MIR. We check MIR for some stable monomorphic function in libcore. However,
  // if the current crate is #![no_core] it's fine to be missing the usual items from libcore.
  if (!is_no_core(tcx)) {
    const sentinel = try_resolve_path(tcx, ["core", "ascii", "escape_default"], "ValueNS");
    if (!(sentinel !== undefined && tcx.is_mir_available(Instance.def_id(sentinel)))) {
      tcx
        .dcx()
        .fatal(
          "the current sysroot was built without `-Zalways-encode-mir`, or libcore seems missing.\n" +
            "Note that directly invoking the `miri` binary is not supported; please use `cargo miri` instead.",
        );
    }
  }

  // Compute argc and argv from `config.args`.
  const argc = MiriImmTy.from_int(BigInt(config.args.length), ecx.machine.layouts.isize);
  let argv: ImmTy;
  {
    // Put each argument in memory, collect pointers.
    const argvs: ImmTy["imm"][] = [];
    for (const arg of config.args) {
      // Make space for `0` terminator.
      const size = BigInt(Buffer.byteLength(arg, "utf8")) + 1n;
      const arg_type = Ty.new_array(tcx, tcx.types.u8, Number(size));
      const layout = ecx.layout_of(arg_type);
      if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
      const arg_place = ecx.allocate(layout._0, MemoryKind_from_MiriMemoryKind("Machine"));
      if (arg_place.$ === "Err") return arg_place;
      const w = ecx.write_os_str_to_c_str(arg, arg_place._0.ptr(), size);
      if (w.$ === "Err") return w;
      ecx.mark_immutable(arg_place._0);
      argvs.push(arg_place._0.to_ref(ecx));
    }
    // Make an array with all these pointers, in the Miri memory.
    const u8_ptr_type = Ty.new_imm_ptr(tcx, tcx.types.u8);
    const u8_ptr_ptr_type = Ty.new_imm_ptr(tcx, u8_ptr_type);
    const argvs_layout = ecx.layout_of(Ty.new_array(tcx, u8_ptr_type, argvs.length));
    if (argvs_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(argvs_layout._0));
    const argvs_place_r = ecx.allocate(argvs_layout._0, MemoryKind_from_MiriMemoryKind("Machine"));
    if (argvs_place_r.$ === "Err") return argvs_place_r;
    const argvs_place = argvs_place_r._0;
    for (let idx = 0; idx < argvs.length; idx++) {
      const arg = argvs[idx]!;
      const place = ecx.project_index(argvs_place, BigInt(idx));
      if (place.$ === "Err") return place;
      const w = ecx.write_immediate(arg, place._0);
      if (w.$ === "Err") return w;
    }
    ecx.mark_immutable(argvs_place);
    // Store `argc` and `argv` for macOS `_NSGetArg{c,v}`, and for the GC to see them.
    {
      const argc_place = ecx.allocate(ecx.machine.layouts.isize, MemoryKind_from_MiriMemoryKind("Machine"));
      if (argc_place.$ === "Err") return argc_place;
      const w = ecx.write_immediate(argc.imm, argc_place._0);
      if (w.$ === "Err") return w;
      ecx.mark_immutable(argc_place._0);
      ecx.machine.argc = argc_place._0.ptr();

      const l = ecx.layout_of(u8_ptr_ptr_type);
      if (l.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(l._0));
      const argv_place = ecx.allocate(l._0, MemoryKind_from_MiriMemoryKind("Machine"));
      if (argv_place.$ === "Err") return argv_place;
      const w2 = ecx.write_pointer(argvs_place.ptr(), argv_place._0);
      if (w2.$ === "Err") return w2;
      ecx.mark_immutable(argv_place._0);
      ecx.machine.argv = argv_place._0.ptr();
    }
    // Store command line as UTF-16 for Windows `GetCommandLineW`.
    if (tcx.sess.target.os.$ === "Windows") {
      // Construct a command string with all the arguments.
      const cmd_utf16: number[] = args_to_utf16_command_string(config.args);

      const cmd_type = Ty.new_array(tcx, tcx.types.u16, cmd_utf16.length);
      const l = ecx.layout_of(cmd_type);
      if (l.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(l._0));
      const cmd_place_r = ecx.allocate(l._0, MemoryKind_from_MiriMemoryKind("Machine"));
      if (cmd_place_r.$ === "Err") return cmd_place_r;
      const cmd_place = cmd_place_r._0;
      ecx.machine.cmd_line = cmd_place.ptr();
      // Store the UTF-16 string. We just allocated so we know the bounds are fine.
      for (let idx = 0; idx < cmd_utf16.length; idx++) {
        const c = cmd_utf16[idx]!;
        const place = ecx.project_index(cmd_place, BigInt(idx));
        if (place.$ === "Err") return place;
        const w = ecx.write_scalar(interp_Scalar.from_u16(c), place._0);
        if (w.$ === "Err") return w;
      }
      ecx.mark_immutable(cmd_place);
    }
    const imm = argvs_place.to_ref(ecx);
    const layout = ecx.layout_of(u8_ptr_ptr_type);
    if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
    argv = MiriImmTy.from_immediate(imm, layout._0);
  }

  // Some parts of initialization require a full `InterpCx`.
  const main_thread_state: MutRef<MainThreadState> = {
    value: {
      $: "GlobalCtors",
      entry_id,
      entry_type,
      argc,
      argv,
      ctor_state: new GlobalCtorState(GlobalCtorStatePriv.Init),
    },
  };
  // Cannot capture anything GC-relevant here.
  // `argc` and `argv` *are* GC_relevant, but they also get stored in `machine.argc` and
  // `machine.argv` so we are good.
  const on_main_stack_empty_cb: StackEmptyCallback = (m) => on_main_stack_empty(main_thread_state, m);
  const li = MiriMachine.late_init(ecx, config, on_main_stack_empty_cb);
  if (li.$ === "Err") return li;

  return interp_ok(ecx);
}


// Call the entry function.
// rustc: src/tools/miri/src/eval.rs:445 call_main
function call_main(ecx: MiriInterpCx, entry_id: DefId, entry_type: MiriEntryFnType, argc: ImmTy, argv: ImmTy): InterpResult {
  const tcx = ecx.tcx_();

  // Setup first stack frame.
  const entry_instance = Instance.mono(tcx, entry_id);

  // Return place (in static memory so that it does not count as leak).
  const ret_place_r = ecx.allocate(ecx.machine.layouts.isize, MemoryKind_from_MiriMemoryKind("Machine"));
  if (ret_place_r.$ === "Err") return ret_place_r;
  const ret_place: MPlaceTy = ret_place_r._0;
  ecx.machine.main_fn_ret_place = ret_place;

  // Call start function.
  switch (entry_type.$) {
    case "Rustc": {
      // MiriEntryFnType::Rustc(EntryFnType::Main { .. })
      const entry_sig = unwrap(EarlyBinder.no_bound_vars(tcx.fn_sig(entry_id), fold_Binder(fold_FnSig)));
      const main_ret_ty_b = PolyFnSig.output(entry_sig);
      const main_ret_ty = unwrap(Binder.no_bound_vars(main_ret_ty_b, fold_Ty));

      const start_id = tcx.lang_items().start_fn() ?? tcx.dcx().fatal("could not find start lang item");
      const start_instance = unwrap(
        unwrap_ok(Instance.try_resolve(tcx, ecx.typing_env_(), start_id, tcx.mk_args([GenericArg.from_Ty(main_ret_ty)]))),
      );

      const main_ptr = ecx.fn_ptr({ $: "Instance", _0: entry_instance });

      // Always using DEFAULT is okay since we don't support signals in Miri anyway.
      // (This means we are effectively ignoring `-Zon-broken-pipe`.)
      const sigpipe = sigpipe_DEFAULT;

      const fn_ptr_layout = unwrap_result(ecx.layout_of(Ty.new_fn_ptr(tcx, entry_sig)), debug_InterpErrorKind);
      const r = ecx.call_function(
        start_instance,
        ExternAbi.Rust,
        [
          MiriImmTy.from_scalar(interp_Scalar.from_pointer(main_ptr, ecx), fn_ptr_layout),
          argc,
          argv,
          MiriImmTy.from_uint(BigInt(sigpipe), ecx.machine.layouts.u8),
        ],
        ret_place,
        { $: "Stop", cleanup: true },
      );
      if (r.$ === "Err") return r;
      break;
    }
    case "MiriStart": {
      const r = ecx.call_function(entry_instance, ExternAbi.Rust, [argc, argv], ret_place, { $: "Stop", cleanup: true });
      if (r.$ === "Err") return r;
      break;
    }
  }

  return interp_ok(undefined);
}

/** `Result::unwrap` on a `Result<_, ErrorGuaranteed>`. */
function unwrap_ok<T, E>(r: Result<T, E>): T {
  if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: ErrorGuaranteed(())");
  return r._0;
}

/** `rustc_driver::EXIT_FAILURE` */
const EXIT_FAILURE = 1;

/// Evaluates the entry function specified by `entry_id`.
/// Returns `Ok(())` if program execution completed with exit code 0.
/// Returns `Err(code)` if an evaluation error occurred or the program returned a non-0 exit code.
// PORT: `NonZeroI32` is a nonzero `number`.
// rustc: src/tools/miri/src/eval.rs:519 eval_entry
export function eval_entry(
  tcx: TyCtxt,
  entry_id: DefId,
  entry_type: MiriEntryFnType,
  config: MiriConfig,
  genmc_ctx: GenmcCtx | undefined,
): Result<null, number> {
  // Copy setting before we move `config`.
  const ignore_leaks = config.ignore_leaks;

  const created = InterpResult.report_err(create_ecx(tcx, entry_id, entry_type, config, genmc_ctx));
  let ecx: MiriInterpCx;
  if (created.$ === "Ok") {
    ecx = created._0;
  } else {
    const [kind, backtrace] = created._0.into_parts();
    backtrace.print_backtrace();
    return panic(`Miri initialization error: ${debug_InterpErrorKind(kind, PLAIN)}`);
  }

  // Perform the main execution.
  let res: InterpResult<never>;
  try {
    res = ecx.run_threads();
  } catch (panic_payload) {
    // PORT: `panic::catch_unwind` catches only unwinds (`Panic`, `FatalErrorMarker`); anything else (e.g. `Unported`)
    // is not an unwind and propagates unchanged, without the ICE report (as rustc_interface's `is_unwind`).
    if (!(panic_payload instanceof Panic || panic_payload instanceof FatalErrorMarker)) throw panic_payload;
    // rustc "handles" some errors by unwinding with FatalErrorMarker
    // (after emitting suitable diagnostics), so do not treat those as ICEs.
    if (!(panic_payload instanceof FatalErrorMarker)) {
      ecx.handle_ice();
    }
    throw panic_payload;
  }
  // Obtain the result of the execution. This is always an `Err`, but that doesn't necessarily
  // indicate an error.
  const reported = InterpResult.report_err(res);
  if (reported.$ === "Ok") return reported._0; // `!`
  const res_err = reported._0;

  // Error reporting: if we survive all checks, we return the exit code the program gave us.
  miri_error: {
    // Show diagnostic, if any.
    const rr = report_result(ecx, res_err);
    if (rr === undefined) {
      break miri_error;
    }
    const [return_code, leak_check] = rr;

    // If we get here there was no fatal error -- yet.
    // Possibly check for memory leaks.
    if (leak_check && !ignore_leaks) {
      // Check for thread leaks.
      if (!ecx.have_all_terminated()) {
        tcx.dcx().err("the main thread terminated without waiting for all remaining threads");
        tcx.dcx().note("set `MIRIFLAGS=-Zmiri-ignore-leaks` to disable this check");
        break miri_error;
      }
      // Check for memory leaks.
      tracing.info("miri::eval", () => `Additional static roots: ${debug_vec(ecx.machine.static_roots, PLAIN, debug_AllocId)}`);
      const leaks = ecx.take_leaked_allocations((ecx) => (ecx as unknown as MiriInterpCx).machine.static_roots);
      if (leaks.length !== 0) {
        report_leaks(ecx, leaks);
        tcx.dcx().note("set `MIRIFLAGS=-Zmiri-ignore-leaks` to disable this check");
        // Ignore the provided return code - let the reported error
        // determine the return code.
        break miri_error;
      }
    }

    // The interpreter has not reported an error.
    // (There could still be errors in the session if there are other interpreters.)
    if (return_code === 0) {
      return Ok(null);
    } else {
      return Err(return_code);
    }
  }

  // The interpreter reported an error.
  assert(tcx.dcx().has_errors() !== undefined, "assertion failed: tcx.dcx().has_errors().is_some()");
  return Err(EXIT_FAILURE);
}


/// Turns an array of arguments into a Windows command line string.
///
/// The string will be UTF-16 encoded and NUL terminated.
///
/// Panics if the zeroth argument contains the `"` character because doublequotes
/// in `argv[0]` cannot be encoded using the standard command line parsing rules.
///
/// Further reading:
/// * [Parsing C++ command-line arguments](https://docs.microsoft.com/en-us/cpp/cpp/main-function-command-line-args?view=msvc-160#parsing-c-command-line-arguments)
/// * [The C/C++ Parameter Parsing Rules](https://daviddeley.com/autohotkey/parameters/parameters.htm#WINCRULES)
// PORT: `I: Iterator<Item = T>, T: AsRef<str>` is an iterable of strings; the result is the `u16` code units.
// rustc: src/tools/miri/src/eval.rs:605 args_to_utf16_command_string
export function args_to_utf16_command_string(args_: Iterable<string>): number[] {
  const args = args_[globalThis.Symbol.iterator]();
  // Parse argv[0]. Slashes aren't escaped. Literal double quotes are not allowed.
  let cmd: string;
  {
    const arg0_n = args.next();
    if (arg0_n.done) {
      return [0];
    }
    const arg0 = arg0_n.value;
    if (arg0.includes('"')) {
      panic('argv[0] cannot contain a doublequote (") character');
    } else {
      // Always surround argv[0] with quotes.
      let s = "";
      s += '"';
      s += arg0;
      s += '"';
      cmd = s;
    }
  }

  // Build the other arguments.
  for (let n = args.next(); !n.done; n = args.next()) {
    const arg = n.value;
    cmd += " ";
    if (arg.length === 0) {
      cmd += '""';
    } else if (![...Buffer.from(arg, "utf8")].some((c) => c === 0x22 || c === 0x09 || c === 0x20)) {
      // No quote, tab, or space -- no escaping required.
      cmd += arg;
    } else {
      // Spaces and tabs are escaped by surrounding them in quotes.
      // Quotes are themselves escaped by using backslashes when in a
      // quoted block.
      // Backslashes only need to be escaped when one or more are directly
      // followed by a quote. Otherwise they are taken literally.

      cmd += '"';
      const chars = [...arg]; // `arg.chars().peekable()` (Unicode scalar values)
      let i = 0;
      for (;;) {
        let nslashes = 0;
        while (i < chars.length && chars[i] === "\\") {
          i++;
          nslashes += 1;
        }

        const c = i < chars.length ? chars[i++] : undefined;
        if (c === '"') {
          cmd += "\\".repeat(nslashes * 2 + 1);
          cmd += '"';
        } else if (c !== undefined) {
          cmd += "\\".repeat(nslashes);
          cmd += c;
        } else {
          cmd += "\\".repeat(nslashes * 2);
          break;
        }
      }
      cmd += '"';
    }
  }

  if (cmd.includes("\0")) {
    panic("interior null in command line arguments");
  }
  // `cmd.encode_utf16().chain(iter::once(0)).collect()`
  const out: number[] = [];
  for (let i = 0; i < cmd.length; i++) out.push(cmd.charCodeAt(i));
  out.push(0);
  return out;
}
