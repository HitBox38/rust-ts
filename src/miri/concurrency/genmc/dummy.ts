// Port of src/tools/miri/src/concurrency/genmc/dummy.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6
// wave 36), ported. Its types are generated into dummy.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT (decision miri-contract C7): the rustup component is built without feature `genmc`, so `mod genmc` is this file
// (concurrency/mod.rs `#[cfg_attr(not(feature = "genmc"), path = "genmc/dummy.rs")]`); concurrency/genmc/*.rs are out of scope.
// Every fn here is `unreachable!()` upstream (a `GenmcCtx` is never constructed: the dummy has no `new`), ported as such.
import { type AtomicFenceOrd, type AtomicReadOrd, type AtomicRwOrd, type AtomicWriteOrd } from "../data_race.ts";
import { type ExitType, GenmcConfig, GenmcCtx } from "./dummy.gen.ts";
import { type ThreadId, type ThreadManager } from "../thread.ts";
import { type MiriConfig } from "../../eval.ts";
import { type FnArg, type ImmTy, type OpTy, type PlaceTy, type Pointer, type Scalar } from "../../lib.ts";
import { type MemoryKind, type MiriInterpCx, type MiriMachine } from "../../machine.ts";
import { type VisitWith } from "../../provenance_gc.ts";
import { type Align, type Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type AtomicRmwOp } from "../../../rustc_const_eval/interpret/operator.ts";
import { type AllocId, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type Instance } from "../../../rustc_middle/ty/instance.ts";
import { unreachable } from "../../../std/panic.ts";
import { type MutRef } from "../../../std/mut_ref.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
export * from "./dummy.gen.ts";

// mod run

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:31 run_genmc_mode
export function run_genmc_mode(_tcx: TyCtxt, _config: MiriConfig, _eval_entry: (_0: GenmcCtx) => Result<null, number>): Result<null, number> {
  // PORT: `NonZeroI32` is a `number` (never 0).
  return unreachable();
}

// mod intercept: `trait EvalContextExt` (pub use as `GenmcEvalContextExt`)

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:45 genmc_intercept_function
InterpCx.prototype.genmc_intercept_function = function (this: MiriInterpCx, _instance: Instance, _args: readonly FnArg[], _dest: PlaceTy): InterpResult<boolean> {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:54 handle_genmc_verifier_assume
InterpCx.prototype.handle_genmc_verifier_assume = function (this: MiriInterpCx, _condition: OpTy): InterpResult {
  return unreachable();
};

// impl GenmcCtx
// We don't provide the `new` function in the dummy module.

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:63 schedule_thread
GenmcCtx.prototype.schedule_thread = function (this: GenmcCtx, _ecx: MiriInterpCx): InterpResult<ThreadId | undefined> {
  return unreachable();
};

/**** Memory access handling ****/

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:72 set_ongoing_action_data_race_free
GenmcCtx.prototype.set_ongoing_action_data_race_free = function (this: GenmcCtx, _enable: boolean): void {
  unreachable();
};

//* might fails if there's a race, load might also not read anything (returns None) */
// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:77 atomic_load
GenmcCtx.prototype.atomic_load = function (this: GenmcCtx, _ecx: MiriInterpCx, _address: Size, _size: Size, _ordering: AtomicReadOrd, _old_val: Scalar | undefined): InterpResult<Scalar> {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:88 atomic_store
GenmcCtx.prototype.atomic_store = function (this: GenmcCtx, _ecx: MiriInterpCx, _address: Size, _size: Size, _value: Scalar, _old_value: Scalar | undefined, _ordering: AtomicWriteOrd): InterpResult<boolean> {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:100 atomic_fence
GenmcCtx.prototype.atomic_fence = function (this: GenmcCtx, _machine: MiriMachine, _ordering: AtomicFenceOrd): InterpResult {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:108 atomic_rmw
GenmcCtx.prototype.atomic_rmw = function (this: GenmcCtx, _ecx: MiriInterpCx, _address: Size, _size: Size, _atomic_op: AtomicRmwOp, _is_signed: boolean, _ordering: AtomicRwOrd, _rhs_scalar: Scalar, _old_value: Scalar): InterpResult<[Scalar, Scalar | undefined]> {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:122 atomic_compare_exchange
GenmcCtx.prototype.atomic_compare_exchange = function (
  this: GenmcCtx,
  _ecx: MiriInterpCx,
  _address: Size,
  _size: Size,
  _expected_old_value: Scalar,
  _new_value: Scalar,
  _success: AtomicRwOrd,
  _fail: AtomicReadOrd,
  _can_fail_spuriously: boolean,
  _old_value: Scalar,
): InterpResult<[Scalar, Scalar | undefined, boolean]> {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:137 memory_load
GenmcCtx.prototype.memory_load = function (this: GenmcCtx, _machine: MiriMachine, _address: Size, _size: Size): InterpResult {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:146 memory_store
GenmcCtx.prototype.memory_store = function (this: GenmcCtx, _machine: MiriMachine, _address: Size, _size: Size): InterpResult {
  return unreachable();
};

/**** Memory (de)allocation ****/

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:157 handle_alloc
GenmcCtx.prototype.handle_alloc = function (this: GenmcCtx, _ecx: MiriInterpCx, _alloc_id: AllocId, _size: Size, _alignment: Align, _memory_kind: MemoryKind): InterpResult<bigint> {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:168 handle_dealloc
GenmcCtx.prototype.handle_dealloc = function (this: GenmcCtx, _machine: MiriMachine, _alloc_id: AllocId, _address: Size, _kind: MemoryKind): InterpResult {
  return unreachable();
};

/**** Thread management ****/

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:180 handle_thread_create
GenmcCtx.prototype.handle_thread_create = function (this: GenmcCtx, _threads: ThreadManager, _start_routine: Pointer, _func_arg: ImmTy, _new_thread_id: ThreadId): InterpResult {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:190 handle_thread_join
GenmcCtx.prototype.handle_thread_join = function (this: GenmcCtx, _active_thread_id: ThreadId, _child_thread_id: ThreadId): InterpResult {
  return unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:198 handle_thread_finish
GenmcCtx.prototype.handle_thread_finish = function (this: GenmcCtx, _threads: ThreadManager): void {
  unreachable();
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:202 handle_exit
GenmcCtx.prototype.handle_exit = function (this: GenmcCtx, _thread: ThreadId, _exit_code: number, _exit_type: ExitType): InterpResult {
  return unreachable();
};

// impl VisitProvenance for GenmcCtx
// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:213 visit_provenance
GenmcCtx.prototype.visit_provenance = function (this: GenmcCtx, _visit: VisitWith): void {
  unreachable();
};

// impl GenmcConfig
// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:219 parse_arg
GenmcConfig.parse_arg = function (_genmc_config: MutRef<GenmcConfig | undefined>, _trimmed_arg: string): Result<null, string> {
  // `if cfg!(feature = "genmc")`: false in the oracle's build (decision miri-contract C7).
  return Err(`GenMC is not supported on this target`);
};

// rustc: src/tools/miri/src/concurrency/genmc/dummy.rs:230 validate
GenmcConfig.validate = function (_miri_config: MiriConfig): Result<null, string> {
  return Ok(null);
};

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/genmc/dummy.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/genmc/dummy.rs:45
    genmc_intercept_function(this: MiriInterpCx, _instance: Instance, _args: readonly FnArg[], _dest: PlaceTy): InterpResult<boolean>;
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
    // concurrency/genmc/dummy.rs:213 (impl VisitProvenance)
    visit_provenance(_visit: VisitWith): void;
  }
}
declare module "./dummy.gen.ts" {
  namespace GenmcConfig {
    // concurrency/genmc/dummy.rs:219
    export let parse_arg: (_genmc_config: MutRef<GenmcConfig | undefined>, _trimmed_arg: string) => Result<null, string>;
    // concurrency/genmc/dummy.rs:230
    export let validate: (_miri_config: MiriConfig) => Result<null, string>;
  }
}

