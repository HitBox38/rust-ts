// Port of src/tools/miri/src/shims/cpu_affinity.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
// Its types are generated into cpu_affinity.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: `cx: &impl LayoutOf<'tcx>` is `LayoutOfCx` (helpers.ts `path_ty_layout`'s parameter: an `InterpCx` or the
// machine's `LayoutCx`). `[u8; CPU_MASK_BYTES]` is the generated `number[]` of bytes.
import type { path_ty_layout } from "../helpers.ts";
import { type MPlaceTy, type OpTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type ThreadId } from "../concurrency/thread.ts";
import { CpuAffinityMask } from "./cpu_affinity.gen.ts";
import { LibcError } from "./io_error.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import { unreachable } from "../../std/panic.ts";
import { Err, type Result } from "../../std/result.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
export * from "./cpu_affinity.gen.ts";

/** PORT(C10): helpers.ts assigns `MiriMachine.prototype` methods at load (helpers.ts:1297-1328), so a module that
 *  machine.ts imports cannot import helpers.ts statically (helpers would run before machine.ts defines `MiriMachine`);
 *  it is read on first use instead (everything is loaded by then: src/miri/lib.ts). */
function helpers(): typeof import("../helpers.ts") {
  return require("../helpers.ts") as typeof import("../helpers.ts");
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `cx: &impl LayoutOf<'tcx>` (header): an `InterpCx` (`layout_of` errs with an `InterpErrorKind`) or a `LayoutCx`
 *  (errs with a `LayoutError`). */
export type LayoutOfCx = {
  tcx_(): TyCtxt;
  typing_env_(): TypingEnv;
  layout_of(ty: Ty): Result<TyAndLayout, unknown>;
};

/// The maximum number of CPUs supported by miri.
///
/// This value is compatible with the libc `CPU_SETSIZE` constant and corresponds to the number
/// of CPUs that a `cpu_set_t` can contain.
///
/// Real machines can have more CPUs than this number, and there exist APIs to set their affinity,
/// but this is not currently supported by miri.
export const MAX_CPUS = 1024;

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/cpu_affinity.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/cpu_affinity.rs:96
    sched_getaffinity(this: MiriInterpCx, pid: OpTy, cpusetsize: OpTy, mask: OpTy, dest: MPlaceTy): InterpResult;
    // shims/cpu_affinity.rs:151
    sched_setaffinity(this: MiriInterpCx, pid: OpTy, cpusetsize: OpTy, mask: OpTy, dest: MPlaceTy): InterpResult;
  }
}

declare module "./cpu_affinity.gen.ts" {
  interface CpuAffinityMask {
    // shims/cpu_affinity.rs:42
    set(cx: LayoutOfCx, cpu: number): void;
    // shims/cpu_affinity.rs:76
    as_slice(): readonly number[];
  }
  namespace CpuAffinityMask {
    /** `pub(crate) const CPU_MASK_BYTES: usize = MAX_CPUS / 8` */
    export let CPU_MASK_BYTES: number;
    // shims/cpu_affinity.rs:25
    function new_(cx: LayoutOfCx, cpu_count: number): CpuAffinityMask;
    export { new_ as new };
    // shims/cpu_affinity.rs:36
    export let chunk_size: (cx: LayoutOfCx) => number; // u64 (a type size: PORTING §5 number)
    // shims/cpu_affinity.rs:80
    export let from_array: (cx: LayoutOfCx, cpu_count: number, bytes: readonly number[]) => CpuAffinityMask | undefined;
  }
}

CpuAffinityMask.CPU_MASK_BYTES = MAX_CPUS / 8;

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:25 new
(CpuAffinityMask as unknown as { new: (cx: LayoutOfCx, cpu_count: number) => CpuAffinityMask }).new = function (cx: LayoutOfCx, cpu_count: number): CpuAffinityMask {
  const this_ = new CpuAffinityMask(new Array<number>(CpuAffinityMask.CPU_MASK_BYTES).fill(0));

  // the default affinity mask includes only the available CPUs
  for (let i = 0; i < cpu_count; i++) {
    this_.set(cx, i);
  }

  return this_;
};

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:36 chunk_size
CpuAffinityMask.chunk_size = function (cx: LayoutOfCx): number {
  // The actual representation of the CpuAffinityMask is [c_ulong; _].
  // PORT: `path_ty_layout` only unwraps `layout_of`'s result, so the error type of `cx` does not matter.
  const ulong = helpers().path_ty_layout(cx as Parameters<typeof path_ty_layout>[0], ["core", "ffi", "c_ulong"]);
  return ulong.size.bytes();
};

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:42 set
CpuAffinityMask.prototype.set = function (this: CpuAffinityMask, cx: LayoutOfCx, cpu: number): void {
  // we silently ignore CPUs that are out of bounds. This matches the behavior of
  // `sched_setaffinity` with a mask that specifies more than `CPU_SETSIZE` CPUs.
  if (cpu >= MAX_CPUS) {
    return;
  }

  // The actual representation of the CpuAffinityMask is [c_ulong; _].
  // Within the array elements, we need to use the endianness of the target.
  const target = cx.tcx_().sess.target;
  // #[expect(clippy::arithmetic_side_effects)] // we checked above that `cpu` is small enough
  const chunk = CpuAffinityMask.chunk_size(cx);
  let width: number;
  if (chunk === 4) {
    width = 4;
  } else if (chunk === 8) {
    width = 8;
  } else {
    return bug(`chunk size not supported: ${chunk}`);
  }
  // let start = cpu / 32 * 4; // first byte of the correct u32   (resp. cpu / 64 * 8 for a u64)
  const bits = width * 8;
  const start = Math.floor(cpu / bits) * width;
  const offset = cpu % bits;
  // `*chunk = (uN::from_{le,be}_bytes(*chunk) | (1 << offset)).to_{le,be}_bytes()`: setting bit `offset` of the
  // little-endian (resp. big-endian) integer is setting bit `offset % 8` of its byte `offset / 8` (resp. counted from
  // the end of the chunk).
  const byte_in_chunk = target.endian === "Little" ? Math.floor(offset / 8) : width - 1 - Math.floor(offset / 8);
  const idx = start + byte_in_chunk;
  this._0[idx] = this._0[idx]! | (1 << (offset % 8));
};

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:76 as_slice
CpuAffinityMask.prototype.as_slice = function (this: CpuAffinityMask): readonly number[] {
  return this._0;
};

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:80 from_array
CpuAffinityMask.from_array = function (cx: LayoutOfCx, cpu_count: number, bytes: readonly number[]): CpuAffinityMask | undefined {
  // mask by what CPUs are actually available
  const default_ = CpuAffinityMask.new(cx, cpu_count);
  const masked = Array.from({ length: CpuAffinityMask.CPU_MASK_BYTES }, (_, i) => bytes[i]! & default_._0[i]!);

  // at least one thread must be set for the input to be valid
  return masked.some((b) => b !== 0) ? new CpuAffinityMask(masked) : undefined;
};

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:96 sched_getaffinity
InterpCx.prototype.sched_getaffinity = function (this: MiriInterpCx, pid: OpTy, cpusetsize: OpTy, mask: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const pid_s = this_.read_scalar(pid);
  if (pid_s.$ === "Err") return pid_s;
  const pid_ = interp_Scalar.to_u32(pid_s._0);
  if (pid_.$ === "Err") return pid_;
  const cpusetsize_ = this_.read_target_usize(cpusetsize);
  if (cpusetsize_.$ === "Err") return cpusetsize_;
  const mask_ = this_.read_pointer(mask);
  if (mask_.$ === "Err") return mask_;

  if (this_.machine.thread_cpu_affinity === undefined) {
    return throw_unsup_format("`sched_getaffinity` is not supported on #![no_core] programs");
  }

  let thread_id: ThreadId;
  if (pid_._0 === 0) {
    thread_id = this_.active_thread();
  } else if (["Linux", "Android"].includes(this_.tcx.deref().sess.target.os.$)) {
    // On Linux/Android, pid can be a TID as returned by `gettid`.
    const t = this_.get_thread_id_from_linux_tid(pid_._0);
    if (t === undefined) {
      const r = this_.set_errno_and_return_neg1(LibcError("ESRCH"), dest);
      if (r.$ === "Err") return r;
      return interp_ok(undefined);
    }
    thread_id = t;
  } else {
    return throw_unsup_format(
      "`sched_getaffinity` is only supported with a pid of 0 (indicating the current thread) on non-Linux platforms",
    );
  }

  // The mask is stored in chunks, and the size must be a whole number of chunks.
  const chunk_size = CpuAffinityMask.chunk_size(this_);

  const is_null = this_.ptr_is_null(mask_._0);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    const r = this_.set_errno_and_return_neg1(LibcError("EFAULT"), dest);
    if (r.$ === "Err") return r;
  } else if (cpusetsize_._0 === 0n || cpusetsize_._0 % BigInt(chunk_size) !== 0n) {
    // we only copy whole chunks of size_of::<c_ulong>()
    const r = this_.set_errno_and_return_neg1(LibcError("EINVAL"), dest);
    if (r.$ === "Err") return r;
  } else {
    const cpuset = this_.machine.thread_cpu_affinity.get(thread_id);
    if (cpuset === undefined) return unreachable("internal error: entered unreachable code: we validated the thread ID above");
    // let cpuset = cpuset.clone();
    const slice = cpuset.as_slice().slice();
    // we only copy whole chunks of size_of::<c_ulong>()
    // Ord::min(cpuset.as_slice().len(), cpusetsize.try_into().unwrap()) (u64 -> usize: never fails on a 64-bit host)
    const byte_count = BigInt(slice.length) < cpusetsize_._0 ? slice.length : Number(cpusetsize_._0);
    const w = this_.write_bytes_ptr(mask_._0, slice.slice(0, byte_count).values());
    if (w.$ === "Err") return w;
    const wn = this_.write_null(dest);
    if (wn.$ === "Err") return wn;
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/cpu_affinity.rs:151 sched_setaffinity
InterpCx.prototype.sched_setaffinity = function (this: MiriInterpCx, pid: OpTy, cpusetsize: OpTy, mask: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const pid_s = this_.read_scalar(pid);
  if (pid_s.$ === "Err") return pid_s;
  const pid_ = interp_Scalar.to_u32(pid_s._0);
  if (pid_.$ === "Err") return pid_;
  const cpusetsize_ = this_.read_target_usize(cpusetsize);
  if (cpusetsize_.$ === "Err") return cpusetsize_;
  const mask_ = this_.read_pointer(mask);
  if (mask_.$ === "Err") return mask_;

  if (this_.machine.thread_cpu_affinity === undefined) {
    return throw_unsup_format("`sched_setaffinity` is not supported on #![no_core] programs");
  }

  let thread_id: ThreadId;
  if (pid_._0 === 0) {
    thread_id = this_.active_thread();
  } else if (["Linux", "Android"].includes(this_.tcx.deref().sess.target.os.$)) {
    // On Linux/Android, pid can be a TID as returned by `gettid`.
    const t = this_.get_thread_id_from_linux_tid(pid_._0);
    if (t === undefined) {
      const r = this_.set_errno_and_return_neg1(LibcError("ESRCH"), dest);
      if (r.$ === "Err") return r;
      return interp_ok(undefined);
    }
    thread_id = t;
  } else {
    return throw_unsup_format(
      "`sched_setaffinity` is only supported with a pid of 0 (indicating the current thread) on non-Linux platforms",
    );
  }

  const is_null = this_.ptr_is_null(mask_._0);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    const r = this_.set_errno_and_return_neg1(LibcError("EFAULT"), dest);
    if (r.$ === "Err") return r;
  } else {
    // NOTE: cpusetsize might be smaller than `CpuAffinityMask::CPU_MASK_BYTES`.
    // Any unspecified bytes are treated as zero here (none of the CPUs are configured).
    // This is not exactly documented, so we assume that this is the behavior in practice.
    const bits_slice = this_.read_bytes_ptr_strip_provenance(mask_._0, Size.from_bytes(cpusetsize_._0));
    if (bits_slice.$ === "Err") return bits_slice;
    // This ignores the bytes beyond `CpuAffinityMask::CPU_MASK_BYTES`
    const bits_array = Array.from({ length: CpuAffinityMask.CPU_MASK_BYTES }, (_, i) => bits_slice._0[i] ?? 0);
    const cpuset = CpuAffinityMask.from_array(this_, this_.machine.num_cpus, bits_array);
    if (cpuset !== undefined) {
      this_.machine.thread_cpu_affinity.set(thread_id, cpuset);
      const wn = this_.write_null(dest);
      if (wn.$ === "Err") return wn;
    } else {
      // The intersection between the mask and the available CPUs was empty.
      const r = this_.set_errno_and_return_neg1(LibcError("EINVAL"), dest);
      if (r.$ === "Err") return r;
    }
  }

  return interp_ok(undefined);
};
