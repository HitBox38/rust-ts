// Fill lane: `miri-shims-c` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/mem.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - `offset: i128` and the `u64` lengths / page size are `bigint` (decision C5).
// - `LibcError("..")` is the generated `IoError` variant object (shims/io_error.gen.ts).

//! This is an incomplete implementation of mmap/munmap which is restricted in order to be
//! implementable on top of the existing memory system. The point of these function as-written is
//! to allow memory allocators written entirely in Rust to be executed by Miri. This implementation
//! does not support other uses of mmap such as file mappings.
//!
//! mmap/munmap behave a lot like alloc/dealloc, and for simple use they are exactly
//! equivalent. That is the only part we support: no MAP_FIXED or MAP_SHARED or anything
//! else that goes beyond a basic allocation API.
//!
//! Note that in addition to only supporting malloc-like calls to mmap, we only support free-like
//! calls to munmap, but for a very different reason. In principle, according to the man pages, it
//! is possible to unmap arbitrary regions of address space. But in a high-level language like Rust
//! this amounts to partial deallocation, which LLVM does not support. So any attempt to call our
//! munmap shim which would partially unmap a region of address space previously mapped by mmap will
//! report UB.

import { type OpTy, type Scalar } from "../../lib.ts";
import { MemoryKind_from_MiriMemoryKind, type MiriInterpCx } from "../../machine.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import {
  CheckInAllocMsg,
  InterpErrorInfo_from_InterpErrorKind,
  InterpResult,
  interp_ok,
  Pointer as interp_Pointer,
  PointerArithmetic_provided,
  Scalar as interp_Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { Err } from "../../../std/result.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/mem.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/mem.rs:24
    mmap(this: MiriInterpCx, addr: OpTy, length: OpTy, prot: OpTy, flags: OpTy, fd: OpTy, offset: bigint): InterpResult<Scalar>;
    // shims/unix/mem.rs:113
    munmap(this: MiriInterpCx, addr: OpTy, length: OpTy): InterpResult<Scalar>;
    // shims/unix/mem.rs:139
    mprotect(this: MiriInterpCx, addr: OpTy, length: OpTy, prot: OpTy): InterpResult<Scalar>;
    // shims/unix/mem.rs:176
    madvise(this: MiriInterpCx, addr: OpTy, length: OpTy, advice: OpTy): InterpResult<Scalar>;
  }
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `i32::count_ones` */
function count_ones_i32(x: number): number {
  let v = x >>> 0;
  let n = 0;
  while (v !== 0) {
    n += v & 1;
    v >>>= 1;
  }
  return n;
}

// rustc: src/tools/miri/src/shims/unix/mem.rs:24 mmap
InterpCx.prototype.mmap = function (this: MiriInterpCx, addr: OpTy, length: OpTy, prot: OpTy, flags: OpTy, fd: OpTy, offset: bigint): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  // We do not support MAP_FIXED, so the addr argument is always ignored (except for the MacOS hack)
  const addr_r = this_.read_target_usize(addr);
  if (addr_r.$ === "Err") return addr_r;
  const addr_ = addr_r._0;
  const length_r = this_.read_target_usize(length);
  if (length_r.$ === "Err") return length_r;
  const length_ = length_r._0;
  const prot_s = this_.read_scalar(prot);
  if (prot_s.$ === "Err") return prot_s;
  const prot_r = interp_Scalar.to_i32(prot_s._0);
  if (prot_r.$ === "Err") return prot_r;
  const prot_ = prot_r._0;
  const flags_s = this_.read_scalar(flags);
  if (flags_s.$ === "Err") return flags_s;
  const flags_r = interp_Scalar.to_i32(flags_s._0);
  if (flags_r.$ === "Err") return flags_r;
  const flags_ = flags_r._0;
  const fd_s = this_.read_scalar(fd);
  if (fd_s.$ === "Err") return fd_s;
  const fd_r = interp_Scalar.to_i32(fd_s._0);
  if (fd_r.$ === "Err") return fd_r;
  const fd_ = fd_r._0;

  const map_private = this_.eval_libc_i32("MAP_PRIVATE");
  const map_anonymous = this_.eval_libc_i32("MAP_ANONYMOUS");
  const map_shared = this_.eval_libc_i32("MAP_SHARED");
  const map_fixed = this_.eval_libc_i32("MAP_FIXED");

  // This is a horrible hack, but on MacOS and Solarish the guard page mechanism uses mmap
  // in a way we do not support. We just give it the return value it expects.
  if (this_.frame_in_std()) {
    const os = this_.tcx.deref().sess.target.os.$;
    if ((os === "MacOs" || os === "Solaris" || os === "Illumos") && (flags_ & map_fixed) !== 0) {
      return interp_ok(interp_Scalar.from_maybe_pointer(interp_Pointer.without_provenance(addr_), this_));
    }
  }

  // First, we do some basic argument validation as required by mmap
  if (count_ones_i32(flags_ & (map_private | map_shared)) !== 1) {
    const r = this_.set_last_error({ $: "LibcError", _0: "EINVAL" });
    if (r.$ === "Err") return r;
    return interp_ok(this_.eval_libc("MAP_FAILED"));
  }
  if (length_ === 0n) {
    const r = this_.set_last_error({ $: "LibcError", _0: "EINVAL" });
    if (r.$ === "Err") return r;
    return interp_ok(this_.eval_libc("MAP_FAILED"));
  }

  // If a user tries to map a file, we want to loudly inform them that this is not going
  // to work. It is possible that POSIX gives us enough leeway to return an error, but the
  // outcome for the user (I need to add cfg(miri)) is the same, just more frustrating.
  if (fd_ !== -1) {
    return throw_unsup_format("Miri does not support file-backed memory mappings");
  }

  // Miri doesn't support MAP_FIXED.
  if ((flags_ & map_fixed) !== 0) {
    return throw_unsup_format("Miri does not support calls to mmap with MAP_FIXED as part of the flags argument");
  }

  {
    const r = verify_prot(this_, prot_);
    if (r.$ === "Err") return r;
  }

  // Miri does not support shared mappings, or any of the other extensions that for example
  // Linux has added to the flags arguments.
  if (flags_ !== (map_private | map_anonymous)) {
    return throw_unsup_format("Miri only supports calls to mmap which set the flags argument to MAP_PRIVATE|MAP_ANONYMOUS");
  }

  // This is only used for file mappings, which we don't support anyway.
  if (offset !== 0n) {
    return throw_unsup_format("Miri does not support non-zero offsets to mmap");
  }

  const align = this_.machine.page_align();
  const map_length = round_up_to_page_size(this_, length_);
  if (map_length === undefined) {
    const r = this_.set_last_error({ $: "LibcError", _0: "EINVAL" });
    if (r.$ === "Err") return r;
    return interp_ok(this_.eval_libc("MAP_FAILED"));
  }

  const ptr = this_.allocate_ptr(
    Size.from_bytes(map_length),
    align,
    MemoryKind_from_MiriMemoryKind("Mmap"),
    // mmap guarantees new mappings are zero-init.
    "Zero",
  );
  if (ptr.$ === "Err") return ptr;

  return interp_ok(interp_Scalar.from_pointer(ptr._0, this_));
};

// rustc: src/tools/miri/src/shims/unix/mem.rs:113 munmap
InterpCx.prototype.munmap = function (this: MiriInterpCx, addr: OpTy, length: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const addr_r = this_.read_pointer(addr);
  if (addr_r.$ === "Err") return addr_r;
  const addr_ = addr_r._0;
  const length_r = this_.read_target_usize(length);
  if (length_r.$ === "Err") return length_r;

  // addr must be a multiple of the page size, but apart from that munmap is just implemented
  // as a dealloc.
  if (addr_.addr(this_.machine.Provenance).bytes_u64() % this_.machine.page_size !== 0n) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EINVAL" });
  }

  const length_u = round_up_to_page_size(this_, length_r._0);
  if (length_u === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EINVAL" });
  }

  const length_ = Size.from_bytes(length_u);
  const r = this_.deallocate_ptr(addr_, [length_, this_.machine.page_align()], { $: "Machine", _0: "Mmap" });
  if (r.$ === "Err") return r;

  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/mem.rs:139 mprotect
InterpCx.prototype.mprotect = function (this: MiriInterpCx, addr: OpTy, length: OpTy, prot: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const addr_r = this_.read_pointer(addr);
  if (addr_r.$ === "Err") return addr_r;
  const addr_ = addr_r._0;
  const length_r = this_.read_target_usize(length);
  if (length_r.$ === "Err") return length_r;
  const prot_s = this_.read_scalar(prot);
  if (prot_s.$ === "Err") return prot_s;
  const prot_r = interp_Scalar.to_i32(prot_s._0);
  if (prot_r.$ === "Err") return prot_r;

  // addr must be a multiple of the page size.
  if (addr_.addr(this_.machine.Provenance).bytes_u64() % this_.machine.page_size !== 0n) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EINVAL" });
  }

  {
    const r = verify_prot(this_, prot_r._0);
    if (r.$ === "Err") return r;
  }

  // The pages from `[addr, addr + length)` must be mapped, so length definitely must not overflow.
  const length_ = round_up_to_page_size(this_, length_r._0);
  if (length_ === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "ENOMEM" });
  }
  // Ensure this is actually allocated memory we can access.
  {
    const r = InterpResult.map_err_kind(this_.check_ptr_access(addr_, Size.from_bytes(length_), CheckInAllocMsg.MemoryAccess), (_) => ({
      $: "UndefinedBehavior",
      _0: { $: "Ub", _0: "`mprotect` called on out-of-bounds memory" },
    }));
    if (r.$ === "Err") return r;
  }

  // If the memory comes from memory the Rust program has allocated with mmap, we only support
  // `PROT_READ|PROT_WRITE`, so this `mprotect` is a no-op. If the memory was mmaped by the
  // runtime (e.g. if it's the stack, executable memory, or static memory), POSIX also allows
  // us to remap it. In those cases, such a call to `PROT_READ|PROT_WRITE` might actually change the permissions,
  // but treating them as the new permissions is still UB. Therefore, we just pretend that we
  // did the permission change by returning success, and will still reject if you try to use
  // it with the "new" permissions.
  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/mem.rs:176 madvise
InterpCx.prototype.madvise = function (this: MiriInterpCx, addr: OpTy, length: OpTy, advice: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const addr_r = this_.read_pointer(addr);
  if (addr_r.$ === "Err") return addr_r;
  const addr_ = addr_r._0;
  const length_r = this_.read_target_usize(length);
  if (length_r.$ === "Err") return length_r;
  const advise_s = this_.read_scalar(advice);
  if (advise_s.$ === "Err") return advise_s;
  const advise_r = interp_Scalar.to_i32(advise_s._0);
  if (advise_r.$ === "Err") return advise_r;
  const advise = advise_r._0;

  // addr must be a multiple of the page size.
  if (addr_.addr(this_.machine.Provenance).bytes_u64() % this_.machine.page_size !== 0n) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EINVAL" });
  }

  // advise must be supported.
  const madv_normal = this_.eval_libc_i32("MADV_NORMAL");
  const madv_random = this_.eval_libc_i32("MADV_RANDOM");
  const madv_sequential = this_.eval_libc_i32("MADV_SEQUENTIAL");
  const madv_willneed = this_.eval_libc_i32("MADV_WILLNEED");
  if (advise !== madv_normal && advise !== madv_random && advise !== madv_sequential && advise !== madv_willneed) {
    return throw_unsup_format(
      "Miri does not support calls to madvise with advice other than MADV_NORMAL, MADV_RANDOM, MADV_SEQUENTIAL, or MADV_WILLNEED",
    );
  }

  // The pages from `[addr, addr + length)` must be mapped, so length definitely must not overflow.
  const length_ = round_up_to_page_size(this_, length_r._0);
  if (length_ === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "ENOMEM" });
  }
  // Ensure this is actually allocated memory we can access.
  {
    const r = InterpResult.map_err_kind(this_.check_ptr_access(addr_, Size.from_bytes(length_), CheckInAllocMsg.MemoryAccess), (_) => ({
      $: "UndefinedBehavior",
      _0: { $: "Ub", _0: "`madvise` called on out-of-bounds memory" },
    }));
    if (r.$ === "Err") return r;
  }

  // All advises we support are no-ops.
  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/mem.rs:221 round_up_to_page_size
function round_up_to_page_size(this_: MiriInterpCx, length: bigint): bigint | undefined {
  // `length.checked_next_multiple_of(page_size)`: `None` if the result overflows `u64`.
  const page_size = this_.machine.page_size;
  const r = length % page_size;
  const next = r === 0n ? length : length + (page_size - r);
  if (next > 0xffff_ffff_ffff_ffffn) return undefined;
  // `.filter(|length| *length <= this.target_isize_max().try_into().unwrap())`
  return next <= PointerArithmetic_provided.target_isize_max(this_) ? next : undefined;
}

// rustc: src/tools/miri/src/shims/unix/mem.rs:227 verify_prot
function verify_prot(this_: MiriInterpCx, prot: number): InterpResult {
  const prot_read = this_.eval_libc_i32("PROT_READ");
  const prot_write = this_.eval_libc_i32("PROT_WRITE");

  // Miri doesn't support protections other than PROT_READ|PROT_WRITE.
  if (prot !== (prot_read | prot_write)) {
    return throw_unsup_format("Miri does not support calls to mmap/mprotect with protections other than PROT_READ|PROT_WRITE");
  }

  return interp_ok(undefined);
}
