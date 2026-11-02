// Fill lane: `miri-shims-c` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/thread.rs (crate `miri`, plan-m6 D2). Its types are generated into
// thread.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - Thread names are byte arrays (`Vec<u8>` → `number[]`, as concurrency/thread.ts's `set_thread_name`).
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type ThreadNameResult } from "./thread.gen.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar as interp_Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { Err } from "../../../std/result.ts";
export * from "./thread.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/thread.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/thread.rs:14
    pthread_create(this: MiriInterpCx, thread: OpTy, _attr: OpTy, start_routine: OpTy, arg: OpTy): InterpResult;
    // shims/unix/thread.rs:40
    pthread_join(this: MiriInterpCx, thread: OpTy, retval: OpTy, return_dest: MPlaceTy): InterpResult;
    // shims/unix/thread.rs:68
    pthread_detach(this: MiriInterpCx, thread: OpTy): InterpResult<Scalar>;
    // shims/unix/thread.rs:83
    pthread_self(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/unix/thread.rs:94
    pthread_setname_np(this: MiriInterpCx, thread: Scalar, name: Scalar, name_max_len: bigint, truncate: boolean): InterpResult<ThreadNameResult>;
    // shims/unix/thread.rs:130
    pthread_getname_np(this: MiriInterpCx, thread: Scalar, name_out: Scalar, len: Scalar, truncate: boolean): InterpResult<ThreadNameResult>;
    // shims/unix/thread.rs:161
    sched_yield(this: MiriInterpCx): InterpResult;
  }
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}

// rustc: src/tools/miri/src/shims/unix/thread.rs:14 pthread_create
InterpCx.prototype.pthread_create = function (this: MiriInterpCx, thread: OpTy, _attr: OpTy, start_routine: OpTy, arg: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  const thread_info_place = this_.deref_pointer_as(thread, this_.libc_ty_layout("pthread_t"));
  if (thread_info_place.$ === "Err") return thread_info_place;

  const start_routine_ = this_.read_pointer(start_routine);
  if (start_routine_.$ === "Err") return start_routine_;

  const func_arg = this_.read_immediate(arg);
  if (func_arg.$ === "Err") return func_arg;

  const r = this_.start_regular_thread(
    thread_info_place._0,
    start_routine_._0,
    { $: "C", unwind: false },
    func_arg._0,
    this_.machine.layouts.unit_ptr_mut,
  );
  if (r.$ === "Err") return r;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/thread.rs:40 pthread_join
InterpCx.prototype.pthread_join = function (this: MiriInterpCx, thread: OpTy, retval: OpTy, return_dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const retval_ = this_.read_pointer(retval);
  if (retval_.$ === "Err") return retval_;
  const is_null = this_.ptr_is_null(retval_._0);
  if (is_null.$ === "Err") return is_null;
  if (!is_null._0) {
    // FIXME: implement reading the thread function's return place.
    return throw_unsup_format("Miri supports pthread_join only with retval==NULL");
  }

  const thread_s = this_.read_scalar(thread);
  if (thread_s.$ === "Err") return thread_s;
  const thread_i = interp_Scalar.to_int(thread_s._0, this_.libc_ty_layout("pthread_t").size);
  if (thread_i.$ === "Err") return thread_i;
  // Joining a terminated thread is valid.
  const lookup = this_.thread_id_try_from(thread_i._0);
  let thread_id;
  if (lookup.$ === "Ok") {
    thread_id = lookup._0;
  } else if (lookup._0.$ === "Terminated") {
    thread_id = lookup._0._0;
  } else {
    return throw_ub_format("pthread_join: invalid pthread_t handle");
  }

  return this_.join_thread_exclusive(
    thread_id,
    /* success_retval */ interp_Scalar.from_u32(0),
    return_dest,
  );
};

// rustc: src/tools/miri/src/shims/unix/thread.rs:68 pthread_detach
InterpCx.prototype.pthread_detach = function (this: MiriInterpCx, thread: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const thread_s = this_.read_scalar(thread);
  if (thread_s.$ === "Err") return thread_s;
  const thread_i = interp_Scalar.to_int(thread_s._0, this_.libc_ty_layout("pthread_t").size);
  if (thread_i.$ === "Err") return thread_i;
  // Detaching a terminated thread is valid.
  const lookup = this_.thread_id_try_from(thread_i._0);
  let thread_id;
  if (lookup.$ === "Ok") {
    thread_id = lookup._0;
  } else if (lookup._0.$ === "Terminated") {
    thread_id = lookup._0._0;
  } else {
    return throw_ub_format("pthread_detach: invalid pthread_t handle");
  }
  const r = this_.detach_thread(thread_id, /*allow_terminated_joined*/ false);
  if (r.$ === "Err") return r;

  return interp_ok(interp_Scalar.from_u32(0));
};

// rustc: src/tools/miri/src/shims/unix/thread.rs:83 pthread_self
InterpCx.prototype.pthread_self = function (this: MiriInterpCx): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const thread_id = this_.active_thread();
  return interp_ok(interp_Scalar.from_uint(BigInt(thread_id.to_u32()), this_.libc_ty_layout("pthread_t").size));
};

/// Set the name of the specified thread. If the name including the null terminator
/// is longer or equals to `name_max_len`, then if `truncate` is set the truncated name
/// is used as the thread name, otherwise [`ThreadNameResult::NameTooLong`] is returned.
/// If the specified thread wasn't found, UB is raised.
// rustc: src/tools/miri/src/shims/unix/thread.rs:94 pthread_setname_np
InterpCx.prototype.pthread_setname_np = function (
  this: MiriInterpCx,
  thread: Scalar,
  name: Scalar,
  name_max_len: bigint,
  truncate: boolean,
): InterpResult<ThreadNameResult> {
  const this_ = this.eval_context_mut();

  const thread_i = interp_Scalar.to_int(thread, this_.libc_ty_layout("pthread_t").size);
  if (thread_i.$ === "Err") return thread_i;
  const lookup = this_.thread_id_try_from(thread_i._0);
  if (lookup.$ !== "Ok") {
    // On Linux this has been observed to segfault. FreeBSD documents an error code
    // for this condition but it is not clear whether they *guarantee* that error.
    return throw_ub_format("pthread_setname_np: invalid pthread_t handle");
  }
  const thread_id = lookup._0;
  const name_ptr = interp_Scalar.to_pointer(name, this_);
  const name_r = this_.read_c_str(name_ptr);
  if (name_r.$ === "Err") return name_r;
  let name_ = Array.from(name_r._0);

  // Comparing with `>=` to account for null terminator.
  if (BigInt(name_.length) >= name_max_len) {
    if (truncate) {
      // `name_max_len.saturating_sub(1)`
      name_.length = Number(name_max_len > 0n ? name_max_len - 1n : 0n);
    } else {
      return interp_ok("NameTooLong");
    }
  }

  this_.set_thread_name(thread_id, name_);

  return interp_ok("Ok");
};

/// Get the name of the specified thread. If the thread name doesn't fit
/// the buffer, then if `truncate` is set the truncated name is written out,
/// otherwise [`ThreadNameResult::NameTooLong`] is returned. If the specified
/// thread wasn't found, UB is raised.
// rustc: src/tools/miri/src/shims/unix/thread.rs:130 pthread_getname_np
InterpCx.prototype.pthread_getname_np = function (
  this: MiriInterpCx,
  thread: Scalar,
  name_out: Scalar,
  len: Scalar,
  truncate: boolean,
): InterpResult<ThreadNameResult> {
  const this_ = this.eval_context_mut();

  const thread_i = interp_Scalar.to_int(thread, this_.libc_ty_layout("pthread_t").size);
  if (thread_i.$ === "Err") return thread_i;
  const lookup = this_.thread_id_try_from(thread_i._0);
  if (lookup.$ !== "Ok") {
    // On Linux this has been observed to segfault. FreeBSD documents an error code
    // for this condition but it is not clear whether they *guarantee* that error.
    return throw_ub_format("pthread_getname_np: invalid pthread_t handle");
  }
  const thread_id = lookup._0;
  const name_out_ = interp_Scalar.to_pointer(name_out, this_);
  const len_ = interp_Scalar.to_target_usize(len, this_);
  if (len_.$ === "Err") return len_;

  // FIXME: we should use the program name if the thread name is not set
  const name_all = (this_.get_thread_name(thread_id) ?? UNNAMED).slice();
  let name_: readonly number[];
  if (truncate) {
    // `len.try_into().unwrap_or(usize::MAX).saturating_sub(1)` (a 64-bit host: `u64` fits `usize`)
    const max = len_._0 > 0n ? len_._0 - 1n : 0n;
    name_ = name_all.slice(0, BigInt(name_all.length) < max ? name_all.length : Number(max));
  } else {
    name_ = name_all;
  }

  const w = this_.write_c_str(Uint8Array.from(name_), name_out_, len_._0);
  if (w.$ === "Err") return w;
  const [success, _written] = w._0;
  const res: ThreadNameResult = success ? "Ok" : "NameTooLong";

  return interp_ok(res);
};

/** `b"<unnamed>"` */
const UNNAMED: readonly number[] = Array.from(new TextEncoder().encode("<unnamed>"));

// rustc: src/tools/miri/src/shims/unix/thread.rs:161 sched_yield
InterpCx.prototype.sched_yield = function (this: MiriInterpCx): InterpResult {
  const this_ = this.eval_context_mut();

  this_.yield_active_thread();

  return interp_ok(undefined);
};
