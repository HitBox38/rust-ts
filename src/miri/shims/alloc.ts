// Port of src/tools/miri/src/shims/alloc.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
//
// PORT:
// - `size`/`align` are `u64` (`bigint`, decision C5).
// - `shim_sig!` is expanded with foreign_items.ts's `shim_sig` / `sig_ty` (see there); `core::mem::Alignment` is the
//   `$krate :: $($path)::+` arm (`path_ty_layout`).
// - `fn prev_power_of_two` (nested in `malloc_align`) is a module fn.
import { type OpTy, type PlaceTy, type Pointer, type Scalar } from "../lib.ts";
import { MemoryKind_from_MiriMemoryKind, type MiriInterpCx } from "../machine.ts";
import { shim_sig, sig_ty as T } from "./foreign_items.ts";
import { Align, type AlignFromBytesError, debug_AlignFromBytesError, Size } from "../../rustc_abi/lib.ts";
import { type SpecialAllocatorMethod } from "../../rustc_ast/expand/allocator.gen.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type AllocInit } from "../../rustc_middle/mir/interpret/allocation.gen.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Pointer as interp_Pointer,
  Scalar as interp_Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { PointerArithmetic_provided } from "../../rustc_middle/mir/interpret/pointer.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { spec } from "../../rustc_target/lib.ts";
import { Err, unwrap_result } from "../../std/result.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/alloc.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/alloc.rs:13
    malloc_align(this: MiriInterpCx, size: bigint): Align;
    // shims/alloc.rs:89
    check_rust_alloc_request(this: MiriInterpCx, size: bigint, align: bigint): InterpResult;
    // shims/alloc.rs:114
    rust_special_allocator_method(this: MiriInterpCx, method: SpecialAllocatorMethod, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: PlaceTy): InterpResult;
    // shims/alloc.rs:191
    malloc(this: MiriInterpCx, size: bigint, init: AllocInit): InterpResult<Pointer>;
    // shims/alloc.rs:199
    posix_memalign(this: MiriInterpCx, memptr: OpTy, align: OpTy, size: OpTy): InterpResult<Scalar>;
    // shims/alloc.rs:226
    free(this: MiriInterpCx, ptr: Pointer): InterpResult;
    // shims/alloc.rs:234
    realloc(this: MiriInterpCx, old_ptr: Pointer, new_size: bigint): InterpResult<Pointer>;
    // shims/alloc.rs:259
    aligned_alloc(this: MiriInterpCx, align: OpTy, size: OpTy): InterpResult<Pointer>;
  }
}

/** `throw_unsup_format!(..)` */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}

/** `Align::from_bytes(x).unwrap()` */
function align_from_bytes_unwrap(x: bigint): Align {
  return unwrap_result(Align.from_bytes(x), debug_AlignFromBytesError);
}

/** `u64::is_power_of_two` */
function is_power_of_two(x: bigint): boolean {
  return x !== 0n && (x & (x - 1n)) === 0n;
}

/** `self.max_size_of_val().bytes()` (`PointerArithmetic`), as the exact `u64`. */
function max_size_of_val_bytes(this_: MiriInterpCx): bigint {
  return PointerArithmetic_provided.max_size_of_val(this_).bytes_u64();
}

/// Returns the alignment that `malloc` would guarantee for requests of the given size.
// rustc: src/tools/miri/src/shims/alloc.rs:13 malloc_align
InterpCx.prototype.malloc_align = function (this: MiriInterpCx, size: bigint): Align {
  const this_ = this.eval_context_ref();
  // The C standard says: "The pointer returned if the allocation succeeds is suitably aligned
  // so that it may be assigned to a pointer to any type of object with a fundamental
  // alignment requirement and size less than or equal to the size requested."
  // So first we need to figure out what the limits are for "fundamental alignment".
  // This is given by `alignof(max_align_t)`. The following list is taken from
  // `library/std/src/sys/alloc/mod.rs` (where this is called `MIN_ALIGN`) and should
  // be kept in sync.
  const target = this_.tcx.deref().sess.target;
  const os = target.os;
  const arch = target.arch;
  let max_fundamental_align: bigint;
  if (arch.$ === "RiscV32" && (os.$ === "EspIdf" || os.$ === "Zkvm")) {
    max_fundamental_align = 4n;
  } else if (arch.$ === "Xtensa" && os.$ === "EspIdf") {
    max_fundamental_align = 4n;
  } else {
    switch (arch.$) {
      case "X86":
      case "Arm":
      case "M68k":
      case "CSky":
      case "LoongArch32":
      case "Mips":
      case "Mips32r6":
      case "PowerPC":
      case "PowerPC64":
      case "Sparc":
      case "Wasm32":
      case "Hexagon":
      case "RiscV32":
      case "Xtensa":
        max_fundamental_align = 8n;
        break;
      case "X86_64":
      case "AArch64":
      case "Arm64EC":
      case "LoongArch64":
      case "Mips64":
      case "Mips64r6":
      case "S390x":
      case "Sparc64":
      case "RiscV64":
      case "Wasm64":
        max_fundamental_align = 16n;
        break;
      case "AmdGpu":
      case "Avr":
      case "Bpf":
      case "Msp430":
      case "Nvptx64":
      case "SpirV":
      case "Other":
        return bug(`unsupported target architecture for malloc: \`${spec.Arch.display(arch)}\``);
    }
  }
  // The C standard only requires sufficient alignment for any *type* with size less than or
  // equal to the size requested. Types one can define in standard C seem to never have an alignment
  // bigger than their size. So if the size is 2, then only alignment 2 is guaranteed, even if
  // `max_fundamental_align` is bigger.
  // This matches what some real-world implementations do, see e.g.
  // - https://github.com/jemalloc/jemalloc/issues/1533
  // - https://github.com/llvm/llvm-project/issues/53540
  // - https://www.open-std.org/jtc1/sc22/wg14/www/docs/n2293.htm
  if (size >= max_fundamental_align) {
    return align_from_bytes_unwrap(max_fundamental_align);
  }
  // C doesn't have zero-sized types, so presumably nothing is guaranteed here.
  if (size === 0n) {
    return Align.ONE;
  }
  // We have `size < min_align`. Round `size` *down* to the next power of two and use that.
  return align_from_bytes_unwrap(prev_power_of_two(size));
};

// rustc: src/tools/miri/src/shims/alloc.rs:74 prev_power_of_two
function prev_power_of_two(x: bigint): bigint {
  // `u64::next_power_of_two` (`x` is below 16 here, so it cannot overflow)
  let next_pow2 = 1n;
  while (next_pow2 < x) next_pow2 <<= 1n;
  if (next_pow2 === x) {
    // x *is* a power of two, just use that.
    return x;
  } else {
    // x is between two powers, so next = 2*prev.
    return next_pow2 / 2n;
  }
}

/// Check some basic requirements for this allocation request:
/// non-zero size, power-of-two alignment.
// rustc: src/tools/miri/src/shims/alloc.rs:89 check_rust_alloc_request
InterpCx.prototype.check_rust_alloc_request = function (this: MiriInterpCx, size: bigint, align: bigint): InterpResult {
  const this_ = this.eval_context_ref();
  if (size === 0n) {
    return throw_ub_format("creating allocation with size 0");
  }
  if (size > max_size_of_val_bytes(this_)) {
    return throw_ub_format("creating an allocation larger than half the address space");
  }
  const r = Align.from_bytes(align);
  if (r.$ === "Err") {
    const e = r._0;
    switch (e.$) {
      case "TooLarge":
        return throw_unsup_format(`creating allocation with alignment ${align} exceeding rustc's maximum supported value`);
      case "NotPowerOfTwo":
        return throw_ub_format(`creating allocation with non-power-of-two alignment ${align}`);
    }
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/alloc.rs:114 rust_special_allocator_method
InterpCx.prototype.rust_special_allocator_method = function (
  this: MiriInterpCx,
  method: SpecialAllocatorMethod,
  link_name: Symbol,
  abi: FnAbi<Ty>,
  args: readonly OpTy[],
  dest: PlaceTy,
): InterpResult {
  const this_ = this.eval_context_mut();

  switch (method) {
    case "Alloc":
    case "AllocZeroed": {
      const a = this_.check_shim_sig(shim_sig("Rust", [T.usize, T.path("core", "mem", "Alignment")], T.ptr(T.unit)), [
        link_name,
        abi,
        args,
      ]);
      if (a.$ === "Err") return a;
      const [size_op, align_op] = a._0 as [OpTy, OpTy];
      const size = this_.read_target_usize(size_op);
      if (size.$ === "Err") return size;
      const align = this_.read_target_usize(align_op);
      if (align.$ === "Err") return align;

      const c = this_.check_rust_alloc_request(size._0, align._0);
      if (c.$ === "Err") return c;

      const ptr = this_.allocate_ptr(
        Size.from_bytes(size._0),
        align_from_bytes_unwrap(align._0),
        MemoryKind_from_MiriMemoryKind("Rust"),
        method === "AllocZeroed" ? "Zero" : "Uninit",
      );
      if (ptr.$ === "Err") return ptr;

      return this_.write_pointer(ptr._0, dest);
    }
    case "Dealloc": {
      const a = this_.check_shim_sig(
        shim_sig("Rust", [T.ptr(T.unit), T.usize, T.path("core", "mem", "Alignment")], T.unit),
        [link_name, abi, args],
      );
      if (a.$ === "Err") return a;
      const [ptr_op, old_size_op, align_op] = a._0 as [OpTy, OpTy, OpTy];
      const ptr = this_.read_pointer(ptr_op);
      if (ptr.$ === "Err") return ptr;
      const old_size = this_.read_target_usize(old_size_op);
      if (old_size.$ === "Err") return old_size;
      const align = this_.read_target_usize(align_op);
      if (align.$ === "Err") return align;

      // No need to check old_size/align; we anyway check that they match the allocation.
      return this_.deallocate_ptr(
        ptr._0,
        [Size.from_bytes(old_size._0), align_from_bytes_unwrap(align._0)],
        MemoryKind_from_MiriMemoryKind("Rust"),
      );
    }
    case "Realloc": {
      const a = this_.check_shim_sig(
        shim_sig("Rust", [T.ptr(T.unit), T.usize, T.path("core", "mem", "Alignment"), T.usize], T.ptr(T.unit)),
        [link_name, abi, args],
      );
      if (a.$ === "Err") return a;
      const [ptr_op, old_size_op, align_op, new_size_op] = a._0 as [OpTy, OpTy, OpTy, OpTy];
      const ptr = this_.read_pointer(ptr_op);
      if (ptr.$ === "Err") return ptr;
      const old_size = this_.read_target_usize(old_size_op);
      if (old_size.$ === "Err") return old_size;
      const align_u = this_.read_target_usize(align_op);
      if (align_u.$ === "Err") return align_u;
      const new_size = this_.read_target_usize(new_size_op);
      if (new_size.$ === "Err") return new_size;
      // No need to check old_size; we anyway check that they match the allocation.

      const c = this_.check_rust_alloc_request(new_size._0, align_u._0);
      if (c.$ === "Err") return c;

      const align = align_from_bytes_unwrap(align_u._0);
      const new_ptr = this_.reallocate_ptr(
        ptr._0,
        [Size.from_bytes(old_size._0), align],
        Size.from_bytes(new_size._0),
        align,
        MemoryKind_from_MiriMemoryKind("Rust"),
        "Uninit",
      );
      if (new_ptr.$ === "Err") return new_ptr;
      return this_.write_pointer(new_ptr._0, dest);
    }
  }
};

// rustc: src/tools/miri/src/shims/alloc.rs:191 malloc
InterpCx.prototype.malloc = function (this: MiriInterpCx, size: bigint, init: AllocInit): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  const align = this_.malloc_align(size);
  const ptr = this_.allocate_ptr(Size.from_bytes(size), align, MemoryKind_from_MiriMemoryKind("C"), init);
  if (ptr.$ === "Err") return ptr;
  // `ptr.into()` (`Pointer<Provenance>` -> `Pointer<Option<Provenance>>`: the same object)
  return interp_ok(ptr._0 as Pointer);
};

// rustc: src/tools/miri/src/shims/alloc.rs:199 posix_memalign
InterpCx.prototype.posix_memalign = function (this: MiriInterpCx, memptr: OpTy, align: OpTy, size: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const memptr_ = this_.deref_pointer_as(memptr, this_.machine.layouts.unit_ptr_mut);
  if (memptr_.$ === "Err") return memptr_;
  const align_ = this_.read_target_usize(align);
  if (align_.$ === "Err") return align_;
  const size_ = this_.read_target_usize(size);
  if (size_.$ === "Err") return size_;

  // Align must be power of 2, and also at least ptr-sized (POSIX rules).
  // But failure to adhere to this is not UB, it's an error condition.
  if (!is_power_of_two(align_._0) || align_._0 < PointerArithmetic_provided.pointer_size(this_).bytes_u64()) {
    return interp_ok(this_.eval_libc("EINVAL"));
  } else {
    const ptr = this_.allocate_ptr(
      Size.from_bytes(size_._0),
      align_from_bytes_unwrap(align_._0),
      MemoryKind_from_MiriMemoryKind("C"),
      "Uninit",
    );
    if (ptr.$ === "Err") return ptr;
    const w = this_.write_pointer(ptr._0, memptr_._0);
    if (w.$ === "Err") return w;
    return interp_ok(interp_Scalar.from_i32(0));
  }
};

// rustc: src/tools/miri/src/shims/alloc.rs:226 free
InterpCx.prototype.free = function (this: MiriInterpCx, ptr: Pointer): InterpResult {
  const this_ = this.eval_context_mut();
  const is_null = this_.ptr_is_null(ptr);
  if (is_null.$ === "Err") return is_null;
  if (!is_null._0) {
    const r = this_.deallocate_ptr(ptr, undefined, MemoryKind_from_MiriMemoryKind("C"));
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/alloc.rs:234 realloc
InterpCx.prototype.realloc = function (this: MiriInterpCx, old_ptr: Pointer, new_size: bigint): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  const new_align = this_.malloc_align(new_size);
  const is_null = this_.ptr_is_null(old_ptr);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    // Here we must behave like `malloc`.
    return this.malloc(new_size, "Uninit");
  } else {
    if (new_size === 0n) {
      // C, in their infinite wisdom, made this UB.
      // <https://www.open-std.org/jtc1/sc22/wg14/www/docs/n2464.pdf>
      return throw_ub_format("`realloc` with a size of zero");
    } else {
      const new_ptr = this_.reallocate_ptr(
        old_ptr,
        undefined,
        Size.from_bytes(new_size),
        new_align,
        MemoryKind_from_MiriMemoryKind("C"),
        "Uninit",
      );
      if (new_ptr.$ === "Err") return new_ptr;
      return interp_ok(new_ptr._0 as Pointer);
    }
  }
};

// rustc: src/tools/miri/src/shims/alloc.rs:259 aligned_alloc
InterpCx.prototype.aligned_alloc = function (this: MiriInterpCx, align: OpTy, size: OpTy): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  const align_ = this_.read_target_usize(align);
  if (align_.$ === "Err") return align_;
  const size_ = this_.read_target_usize(size);
  if (size_.$ === "Err") return size_;

  // Alignment must be a power of 2, and "supported by the implementation".
  // We decide that "supported by the implementation" means that the
  // size must be a multiple of the alignment. (This restriction seems common
  // enough that it is stated on <https://en.cppreference.com/w/c/memory/aligned_alloc>
  // as a general rule, but the actual standard has no such rule.)
  // If any of these are violated, we have to return NULL.
  // All fundamental alignments must be supported.
  //
  // macOS and Illumos are buggy in that they require the alignment
  // to be at least the size of a pointer, so they do not support all fundamental
  // alignments. We do not emulate those platform bugs.
  //
  // Linux also sets errno to EINVAL, but that's non-standard behavior that we do not
  // emulate.
  // FreeBSD says some of these cases are UB but that's violating the C standard.
  // http://en.cppreference.com/w/cpp/memory/c/aligned_alloc
  // Linux: https://linux.die.net/man/3/aligned_alloc
  // FreeBSD: https://man.freebsd.org/cgi/man.cgi?query=aligned_alloc&apropos=0&sektion=3&manpath=FreeBSD+9-current&format=html
  // `size.checked_rem(align)`: `None` when `align == 0`.
  const rem = align_._0 === 0n ? undefined : size_._0 % align_._0;
  if (rem === 0n && is_power_of_two(align_._0)) {
    const malloc_align = BigInt(this_.malloc_align(size_._0).bytes());
    const align2 = align_._0 > malloc_align ? align_._0 : malloc_align;
    const ptr = this_.allocate_ptr(
      Size.from_bytes(size_._0),
      align_from_bytes_unwrap(align2),
      MemoryKind_from_MiriMemoryKind("C"),
      "Uninit",
    );
    if (ptr.$ === "Err") return ptr;
    return interp_ok(ptr._0 as Pointer);
  } else {
    return interp_ok(interp_Pointer.null() as Pointer);
  }
};
