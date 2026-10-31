// Port of src/tools/miri/src/concurrency/genmc/dummy.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-threads` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into dummy.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
// PORT (decision miri-contract C7): the rustup component is built without feature `genmc`, so `mod genmc` is this file
// (concurrency/mod.rs `#[cfg_attr(not(feature = "genmc"), path = "genmc/dummy.rs")]`); concurrency/genmc/*.rs are out of scope.
import { type AtomicFenceOrd, type AtomicReadOrd, type AtomicRwOrd, type AtomicWriteOrd } from "../data_race.ts";
import { type ExitType, GenmcConfig, GenmcCtx } from "./dummy.gen.ts";
import { type ThreadId, type ThreadManager } from "../thread.ts";
import { type MiriConfig } from "../../eval.ts";
import { type ImmTy, type OpTy, type PlaceTy, type Pointer, type Scalar } from "../../lib.ts";
import { type MemoryKind, type MiriInterpCx, type MiriMachine } from "../../machine.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Align, type Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type AtomicRmwOp } from "../../../rustc_const_eval/interpret/operator.gen.ts";
import { type AllocId, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type Instance } from "../../../rustc_middle/ty/instance.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { unported } from "../../../std/panic.ts";
import { type Result } from "../../../std/result.ts";
export * from "./dummy.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/genmc/dummy.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/genmc/dummy.rs:45
    genmc_intercept_function(this: MiriInterpCx, _instance: Instance, _args: (Pending<"rustc_const_eval::interpret::FnArg<'tcx, crate::Provenance>">)[], _dest: PlaceTy): InterpResult<boolean>;
    // concurrency/genmc/dummy.rs:54
    handle_genmc_verifier_assume(this: MiriInterpCx, _condition: OpTy): InterpResult;
  }
}

declare module "./dummy.gen.ts" {
  interface GenmcCtx {
    // concurrency/genmc/dummy.rs:63
    schedule_thread(_ecx: MiriInterpCx): InterpResult<ThreadId | undefined>;
    // concurrency/genmc/dummy.rs:72
    set_ongoing_action_data_race_free(_enable: boolean): void;
    // concurrency/genmc/dummy.rs:77
    atomic_load(_ecx: MiriInterpCx, _address: Size, _size: Size, _ordering: AtomicReadOrd, _old_val: Scalar | undefined): InterpResult<Scalar>;
    // concurrency/genmc/dummy.rs:88
    atomic_store(_ecx: MiriInterpCx, _address: Size, _size: Size, _value: Scalar, _old_value: Scalar | undefined, _ordering: AtomicWriteOrd): InterpResult<boolean>;
    // concurrency/genmc/dummy.rs:100
    atomic_fence(_machine: MiriMachine, _ordering: AtomicFenceOrd): InterpResult;
    // concurrency/genmc/dummy.rs:108
    atomic_rmw(_ecx: MiriInterpCx, _address: Size, _size: Size, _atomic_op: AtomicRmwOp, _is_signed: boolean, _ordering: AtomicRwOrd, _rhs_scalar: Scalar, _old_value: Scalar): InterpResult<[Scalar, Scalar | undefined]>;
    // concurrency/genmc/dummy.rs:122
    atomic_compare_exchange(_ecx: MiriInterpCx, _address: Size, _size: Size, _expected_old_value: Scalar, _new_value: Scalar, _success: AtomicRwOrd, _fail: AtomicReadOrd, _can_fail_spuriously: boolean, _old_value: Scalar): InterpResult<[Scalar, Scalar | undefined, boolean]>;
    // concurrency/genmc/dummy.rs:137
    memory_load(_machine: MiriMachine, _address: Size, _size: Size): InterpResult;
    // concurrency/genmc/dummy.rs:146
    memory_store(_machine: MiriMachine, _address: Size, _size: Size): InterpResult;
    // concurrency/genmc/dummy.rs:157
    handle_alloc(_ecx: MiriInterpCx, _alloc_id: AllocId, _size: Size, _alignment: Align, _memory_kind: MemoryKind): InterpResult<bigint>;
    // concurrency/genmc/dummy.rs:168
    handle_dealloc(_machine: MiriMachine, _alloc_id: AllocId, _address: Size, _kind: MemoryKind): InterpResult;
    // concurrency/genmc/dummy.rs:180
    handle_thread_create(_threads: ThreadManager, _start_routine: Pointer, _func_arg: ImmTy, _new_thread_id: ThreadId): InterpResult;
    // concurrency/genmc/dummy.rs:190
    handle_thread_join(_active_thread_id: ThreadId, _child_thread_id: ThreadId): InterpResult;
    // concurrency/genmc/dummy.rs:198
    handle_thread_finish(_threads: ThreadManager): void;
    // concurrency/genmc/dummy.rs:202
    handle_exit(_thread: ThreadId, _exit_code: number, _exit_type: ExitType): InterpResult;
  }
}
declare module "./dummy.gen.ts" {
  namespace GenmcConfig {
    // concurrency/genmc/dummy.rs:219
    export let parse_arg: (_genmc_config: GenmcConfig | undefined, _trimmed_arg: string) => Result<null, string>;
    // concurrency/genmc/dummy.rs:230
    export let validate: (_miri_config: MiriConfig) => Result<null, string>;
  }
}

// concurrency/genmc/dummy.rs:31 (pub)
export function run_genmc_mode(_tcx: TyCtxt, _config: MiriConfig, _eval_entry: ((_0: GenmcCtx) => Result<null, Pending<"NonZeroI32">>)): Result<null, Pending<"NonZeroI32">> {
  return unported("miri::concurrency::genmc::run_genmc_mode (src/tools/miri/src/concurrency/genmc/dummy.rs:31; lane miri-threads)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for GenmcCtx (concurrency/genmc/dummy.rs:212): visit_provenance (:213)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::genmc::EvalContextExt", "src/tools/miri/src/concurrency/genmc/dummy.rs", "miri-threads", () => InterpCx.prototype, ["genmc_intercept_function", "handle_genmc_verifier_assume"]);
stub_methods("miri::concurrency::genmc::GenmcCtx", "src/tools/miri/src/concurrency/genmc/dummy.rs", "miri-threads", () => GenmcCtx.prototype, ["schedule_thread", "set_ongoing_action_data_race_free", "atomic_load", "atomic_store", "atomic_fence", "atomic_rmw", "atomic_compare_exchange", "memory_load", "memory_store", "handle_alloc", "handle_dealloc", "handle_thread_create", "handle_thread_join", "handle_thread_finish", "handle_exit"]);
stub_statics("miri::concurrency::genmc::GenmcConfig", "src/tools/miri/src/concurrency/genmc/dummy.rs", "miri-threads", () => GenmcConfig, ["parse_arg", "validate"]);
