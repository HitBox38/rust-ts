// Port of src/tools/miri/src/shims/time.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type TimeoutClock } from "../clock.ts";
import { type MPlaceTy, type OpTy, type Pointer, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { unported } from "../../std/panic.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/time.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/time.rs:21
    parse_clockid(this: MiriInterpCx, clk_id: Scalar): TimeoutClock | undefined;
    // shims/time.rs:61
    clock_gettime(this: MiriInterpCx, clk_id_op: OpTy, tp_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/time.rs:98
    gettimeofday(this: MiriInterpCx, tv_op: OpTy, tz_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:128
    localtime_r(this: MiriInterpCx, timep: OpTy, result_op: OpTy): InterpResult<Pointer>;
    // shims/time.rs:213
    GetSystemTimeAsFileTime(this: MiriInterpCx, shim_name: string, LPFILETIME_op: OpTy): InterpResult;
    // shims/time.rs:236
    QueryPerformanceCounter(this: MiriInterpCx, lpPerformanceCount_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:260
    QueryPerformanceFrequency(this: MiriInterpCx, lpFrequency_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:281
    system_time_since_windows_epoch(this: MiriInterpCx, time: Pending<"SystemTime">): InterpResult<Pending<"Duration">>;
    // shims/time.rs:291
    windows_ticks_for(this: MiriInterpCx, duration: Pending<"Duration">): InterpResult<bigint>;
    // shims/time.rs:301
    mach_absolute_time(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/time.rs:316
    mach_timebase_info(this: MiriInterpCx, info_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:331
    mach_wait_until(this: MiriInterpCx, deadline_op: OpTy): InterpResult<Scalar>;
    // shims/time.rs:357
    nanosleep(this: MiriInterpCx, duration: OpTy, rem: OpTy): InterpResult<Scalar>;
    // shims/time.rs:384
    clock_nanosleep(this: MiriInterpCx, clock_id: OpTy, flags: OpTy, timespec: OpTy, rem: OpTy): InterpResult<Scalar>;
    // shims/time.rs:440
    Sleep(this: MiriInterpCx, timeout: OpTy): InterpResult;
    // shims/time.rs:467
    read_timespec(this: MiriInterpCx, tp: MPlaceTy): InterpResult<Pending<"Duration"> | undefined>;
    // shims/time.rs:490
    read_timeval(this: MiriInterpCx, tp: MPlaceTy): InterpResult<Pending<"Duration"> | undefined>;
  }
}

// shims/time.rs:13 (pub)
export function system_time_to_duration(time: Pending<"SystemTime">): InterpResult<Pending<"Duration">> {
  return unported("miri::shims::time::system_time_to_duration (src/tools/miri/src/shims/time.rs:13; lane miri-shims-b)");
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::time::EvalContextExt", "src/tools/miri/src/shims/time.rs", "miri-shims-b", () => InterpCx.prototype, ["parse_clockid", "clock_gettime", "gettimeofday", "localtime_r", "GetSystemTimeAsFileTime", "QueryPerformanceCounter", "QueryPerformanceFrequency", "system_time_since_windows_epoch", "windows_ticks_for", "mach_absolute_time", "mach_timebase_info", "mach_wait_until", "nanosleep", "clock_nanosleep", "Sleep", "read_timespec", "read_timeval"]);
