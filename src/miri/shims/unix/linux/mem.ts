//! This follows the pattern in src/shims/unix/mem.rs: We only support uses of mremap that would
//! correspond to valid uses of realloc.
// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/linux/mem.rs (crate `miri`, plan-m6 D2).
// PORT: `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
import { type OpTy, type Pointer, type Scalar } from "../../../lib.ts";
import { MemoryKind_from_MiriMemoryKind, type MiriInterpCx } from "../../../machine.ts";
import { Size } from "../../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { Err } from "../../../../std/result.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

declare module "../../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/linux/mem.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux/mem.rs:10
    mremap(this: MiriInterpCx, old_address: OpTy, old_size: OpTy, new_size: OpTy, flags: OpTy): InterpResult<Scalar>;
  }
}

// rustc: src/tools/miri/src/shims/unix/linux/mem.rs:10 mremap
InterpCx.prototype.mremap = function (this: MiriInterpCx, old_address_op: OpTy, old_size_op: OpTy, new_size_op: OpTy, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const old_address_r = this_.read_pointer(old_address_op as never);
  if (old_address_r.$ === "Err") return old_address_r;
  const old_address = old_address_r._0 as Pointer;
  const old_size = this_.read_target_usize(old_size_op as never);
  if (old_size.$ === "Err") return old_size;
  const new_size = this_.read_target_usize(new_size_op as never);
  if (new_size.$ === "Err") return new_size;
  const flags_s = this_.read_scalar(flags_op as never);
  if (flags_s.$ === "Err") return flags_s;
  const flags_r = interp_Scalar.to_i32(flags_s._0 as Scalar);
  if (flags_r.$ === "Err") return flags_r;
  const flags = flags_r._0;

  // old_address must be a multiple of the page size
  // (`u64::is_multiple_of`: `page_size` is never 0 here, so this is `% == 0`)
  if (old_address.addr(this_.machine.Provenance).bytes_u64() % this_.machine.page_size !== 0n || new_size._0 === 0n) {
    const r = this_.set_last_error({ $: "LibcError", _0: "EINVAL" });
    if (r.$ === "Err") return r;
    return interp_ok(this_.eval_libc("MAP_FAILED"));
  }

  if ((flags & this_.eval_libc_i32("MREMAP_FIXED")) !== 0) {
    return throw_unsup_format("Miri does not support mremap wth MREMAP_FIXED");
  }

  if ((flags & this_.eval_libc_i32("MREMAP_DONTUNMAP")) !== 0) {
    return throw_unsup_format("Miri does not support mremap wth MREMAP_DONTUNMAP");
  }

  if ((flags & this_.eval_libc_i32("MREMAP_MAYMOVE")) === 0) {
    // We only support MREMAP_MAYMOVE, so not passing the flag is just a failure
    const r = this_.set_last_error({ $: "LibcError", _0: "EINVAL" });
    if (r.$ === "Err") return r;
    return interp_ok(this_.eval_libc("MAP_FAILED"));
  }

  const align = this_.machine.page_align();
  const ptr = this_.reallocate_ptr(
    old_address as never,
    [Size.from_bytes(old_size._0), align],
    Size.from_bytes(new_size._0),
    align,
    MemoryKind_from_MiriMemoryKind("Mmap") as never,
    "Zero",
  );
  if (ptr.$ === "Err") return ptr;

  return interp_ok(interp_Scalar.from_pointer(ptr._0, this_) as unknown as Scalar);
};
