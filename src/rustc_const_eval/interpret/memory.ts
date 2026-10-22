// Port of compiler/rustc_const_eval/src/interpret/memory.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-memory; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type Align, type Size } from "../../rustc_abi/lib.ts";
import { type Mutability } from "../../rustc_ast_ir/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type CtfeMemoryKind, type CtfeMemoryMap, type Machine, type MayLeak } from "./machine.ts";
import * as gen from "./memory.gen.ts";
import { AllocInfo, AllocKind } from "./memory.gen.ts";
import { type AllocId, type AllocInit, type AllocRange, type Allocation, type CheckAlignMsg, type CheckInAllocMsg, type CtfeProvenance, type InterpResult, type Misalignment, type Pointer, type Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { type Result } from "../../std/result.ts";
import { MPlaceTy } from "./place.gen.ts";

export * from "./memory.gen.ts";

declare module "./memory.gen.ts" {
  namespace AllocInfo {
    // memory.rs:88 (lane interp-memory)
    function new_(size: Size, align: Align, kind: AllocKind, mutbl: Mutability): AllocInfo;
    export { new_ as new };
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // memory.rs:190 (lane interp-memory)
    global_root_pointer(ptr: Pointer): InterpResult<Pointer>;
    // memory.rs:219 (lane interp-memory)
    fn_ptr(fn_val: FnVal<never>): Pointer;
    // memory.rs:239 (lane interp-memory)
    va_list_ptr(varargs: MPlaceTy[]): Pointer;
    // memory.rs:251 (lane interp-memory)
    allocate_ptr(size: Size, align: Align, kind: MemoryKind<CtfeMemoryKind>, init: AllocInit): InterpResult<Pointer>;
    // memory.rs:267 (lane interp-memory)
    allocate_bytes_ptr(bytes: Uint8Array, align: Align, kind: MemoryKind<CtfeMemoryKind>, mutability: Mutability): InterpResult<Pointer>;
    // memory.rs:279 (lane interp-memory)
    insert_allocation(alloc: Allocation, kind: MemoryKind<CtfeMemoryKind>): InterpResult<Pointer>;
    // memory.rs:301 (lane interp-memory)
    reallocate_ptr(ptr: Pointer<CtfeProvenance | undefined>, old_size_and_align: [Size, Align] | undefined, new_size: Size, new_align: Align, kind: MemoryKind<CtfeMemoryKind>, init_growth: AllocInit): InterpResult<Pointer>;
    // memory.rs:335 (lane interp-memory)
    make_const_heap_ptr_global(ptr: Pointer<CtfeProvenance | undefined>): InterpResult;
    // memory.rs:380 (lane interp-memory)
    deallocate_ptr(ptr: Pointer<CtfeProvenance | undefined>, old_size_and_align: [Size, Align] | undefined, kind: MemoryKind<CtfeMemoryKind>): InterpResult;
    // memory.rs:459 (lane interp-memory)
    get_ptr_access(ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<[AllocId, Size, boolean] | undefined>;
    // memory.rs:481 (lane interp-memory)
    check_ptr_access(ptr: Pointer<CtfeProvenance | undefined>, size: Size, msg: CheckInAllocMsg): InterpResult;
    // memory.rs:498 (lane interp-memory)
    check_ptr_access_signed(ptr: Pointer<CtfeProvenance | undefined>, size: bigint, msg: CheckInAllocMsg): InterpResult;
    // memory.rs:519 (lane interp-memory)
    check_and_deref_ptr<T, R>(this_: R, ptr: Pointer<CtfeProvenance | undefined>, size: bigint, msg: CheckInAllocMsg, alloc_size: (a0: R, a1: AllocId, a2: Size, a3: boolean) => InterpResult<[Size, Align, T]>): InterpResult<T | undefined>;
    // memory.rs:568 (lane interp-memory)
    check_misalign(misaligned: Misalignment | undefined, msg: CheckAlignMsg): InterpResult;
    // memory.rs:579 (lane interp-memory)
    is_ptr_misaligned(ptr: Pointer<CtfeProvenance | undefined>, align: Align): Misalignment | undefined;
    // memory.rs:629 (lane interp-memory)
    check_ptr_align(ptr: Pointer<CtfeProvenance | undefined>, align: Align): InterpResult;
    // memory.rs:640 (lane interp-memory)
    remove_unreachable_allocs(reachable_allocs: Set<AllocId>): void;
    // memory.rs:655 (lane interp-memory)
    get_global_alloc(id: AllocId, is_write: boolean): InterpResult<Allocation>;
    // memory.rs:708 (lane interp-memory)
    get_alloc_raw(id: AllocId): InterpResult<Allocation>;
    // memory.rs:745 (lane interp-memory)
    get_alloc_bytes_unchecked_raw(id: AllocId): InterpResult<Uint8Array>;
    // memory.rs:751 (lane interp-memory)
    get_ptr_alloc(ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<AllocRef | undefined>;
    // memory.rs:796 (lane interp-memory)
    get_alloc_extra(id: AllocId): InterpResult<null>;
    // memory.rs:801 (lane interp-memory)
    get_alloc_mutability(id: AllocId): InterpResult<Mutability>;
    // memory.rs:812 (lane interp-memory)
    get_alloc_raw_mut(id: AllocId): InterpResult<[Allocation, M]>;
    // memory.rs:843 (lane interp-memory)
    get_alloc_bytes_unchecked_raw_mut(id: AllocId): InterpResult<Uint8Array>;
    // memory.rs:852 (lane interp-memory)
    get_ptr_alloc_mut(ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<AllocRefMut | undefined>;
    // memory.rs:895 (lane interp-memory)
    get_alloc_extra_mut(id: AllocId): InterpResult<[null, M]>;
    // memory.rs:906 (lane interp-memory)
    is_alloc_live(id: AllocId): boolean;
    // memory.rs:916 (lane interp-memory)
    has_provenance_in_alloc(id: AllocId): InterpResult<boolean>;
    // memory.rs:923 (lane interp-memory)
    get_alloc_info(id: AllocId): AllocInfo;
    // memory.rs:984 (lane interp-memory)
    get_live_alloc_size_and_align(id: AllocId, msg: CheckInAllocMsg): InterpResult<[Size, Align]>;
    // memory.rs:996 (lane interp-memory)
    get_fn_alloc(id: AllocId): FnVal<never> | undefined;
    // memory.rs:1009 (lane interp-memory)
    get_ptr_type_id(ptr: Pointer<CtfeProvenance | undefined>): InterpResult<[Ty, bigint]>;
    // memory.rs:1020 (lane interp-memory)
    get_ptr_fn(ptr: Pointer<CtfeProvenance | undefined>): InterpResult<FnVal<never>>;
    // memory.rs:1034 (lane interp-memory)
    get_ptr_va_list(ptr: Pointer<CtfeProvenance | undefined>): InterpResult<MPlaceTy[]>;
    // memory.rs:1053 (lane interp-memory)
    deallocate_va_list(ptr: Pointer<CtfeProvenance | undefined>): InterpResult<MPlaceTy[]>;
    // memory.rs:1073 (lane interp-memory)
    get_ptr_vtable_ty(ptr: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<Ty>;
    // memory.rs:1097 (lane interp-memory)
    alloc_mark_immutable(id: AllocId): InterpResult;
    // memory.rs:1104 (lane interp-memory)
    visit_reachable_allocs(start: AllocId[], visit: (a0: InterpCx, a1: AllocId, a2: AllocInfo) => InterpResult): InterpResult;
    // memory.rs:1139 (lane interp-memory)
    dump_alloc(id: AllocId): DumpAllocs;
    // memory.rs:1146 (lane interp-memory)
    dump_allocs(allocs: AllocId[]): DumpAllocs;
    // memory.rs:1153 (lane interp-memory)
    print_alloc_bytes_for_diagnostics(id: AllocId): string;
    // memory.rs:1172 (lane interp-memory)
    take_leaked_allocations(static_roots: (a0: InterpCx) => readonly AllocId[]): ([AllocId, MemoryKind<CtfeMemoryKind>, Allocation])[];
    // memory.rs:1219 (lane interp-memory)
    ghost_run_mut<R>(f: (a0: InterpCx) => R): R;
    // memory.rs:1237 (lane interp-memory)
    ghost_run<R>(f: (a0: InterpCx) => R): R;
    // memory.rs:1249 (lane interp-memory)
    validation_in_progress(): boolean;
    // memory.rs:1423 (lane interp-memory)
    read_bytes_ptr_strip_provenance(ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<Uint8Array>;
    // memory.rs:1445 (lane interp-memory)
    write_bytes_ptr(ptr: Pointer<CtfeProvenance | undefined>, src: IterableIterator<number>): InterpResult;
    // memory.rs:1475 (lane interp-memory)
    mem_copy(src: Pointer<CtfeProvenance | undefined>, dest: Pointer<CtfeProvenance | undefined>, size: Size, nonoverlapping: boolean): InterpResult;
    // memory.rs:1490 (lane interp-memory)
    mem_copy_repeatedly(src: Pointer<CtfeProvenance | undefined>, dest: Pointer<CtfeProvenance | undefined>, size: Size, num_copies: bigint, nonoverlapping: boolean): InterpResult;
    // memory.rs:1641 (lane interp-memory)
    scalar_may_be_null(scalar: Scalar): InterpResult<boolean>;
    // memory.rs:1689 (lane interp-memory)
    ptr_try_get_alloc_id(ptr: Pointer<CtfeProvenance | undefined>, size: bigint): Result<[AllocId, Size, boolean], bigint>;
    // memory.rs:1721 (lane interp-memory)
    ptr_get_alloc_id(ptr: Pointer<CtfeProvenance | undefined>, size: bigint): InterpResult<[AllocId, Size, boolean]>;
  }
}

// PORT: `impl<T: MayLeak> MayLeak for MemoryKind<T>` takes the `T: MayLeak` table.
export interface MemoryKind_methods {
  // memory.rs:42 (lane interp-memory)
  may_leak<T>(self: MemoryKind<T>, T_: MayLeak<T>): boolean;
}
export type MemoryKind<T> = gen.MemoryKind<T>;
export const MemoryKind = gen.MemoryKind as typeof gen.MemoryKind & MemoryKind_methods;

export interface FnVal_methods {
  // memory.rs:101 (lane interp-memory)
  as_instance<Other>(self: FnVal<Other>): InterpResult<Instance>;
}
export type FnVal<Other> = gen.FnVal<Other>;
export const FnVal = {} as FnVal_methods;

// `Memory` has to depend on the `Machine` because some of its operations
// (e.g., `get`) call a `Machine` hook.
// rustc-type: compiler/rustc_const_eval/src/interpret/memory.rs:113 Memory
// PORT (D8): `M::MemoryMap` is the CTFE machines' `CtfeMemoryMap` (interpret/machine.ts header); `Cell<bool>` is the field.
export class Memory {
  constructor(
    /// Allocations local to this instance of the interpreter. The kind
    /// helps ensure that the same mechanism is used for allocation and
    /// deallocation. When an allocation is not found here, it is a
    /// global and looked up in the `tcx` for read access. Some machines may
    /// have to mutate this map even on a read-only access to a global (because
    /// they do pointer provenance tracking and the allocations in `tcx` have
    /// the wrong type), so we let the machine override this type.
    /// Either way, if the machine allows writing to a global, doing so will
    /// create a copy of the global allocation here.
    // FIXME: this should not be public, but interning currently needs access to it
    public alloc_map: CtfeMemoryMap,

    /// Map for "extra" function pointers.
    public extra_fn_ptr_map: Map<AllocId, never>,

    /// Map storing variable argument lists.
    public va_list_map: Map<AllocId, MPlaceTy[]>,

    /// To be able to compare pointers with null, and to check alignment for accesses
    /// to ZSTs (where pointers may dangle), we keep track of the size even for allocations
    /// that do not exist any more.
    // FIXME: this should not be public, but interning currently needs access to it
    public dead_alloc_map: Map<AllocId, [Size, Align]>,

    /// This stores whether we are currently doing reads/writes that aren't "real".
    /// Those accesses do not trigger the machine's hooks.
    /// Needless to say, this must only be set with great care!
    public ghost_mode: boolean,
  ) {}

  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:163 new
  static new(): Memory {
    return new Memory(
      /* M::MemoryMap::default() */ const_eval_machine().FxIndexMap_AllocMap.default_<AllocId, [MemoryKind<CtfeMemoryKind>, Allocation]>(),
      /* FxIndexMap::default() */ new Map<AllocId, never>(),
      /* FxIndexMap::default() */ new Map<AllocId, MPlaceTy[]>(),
      /* FxIndexMap::default() */ new Map<AllocId, [Size, Align]>(),
      /* Cell::new( */ false /* ) */,
    );
  }

  /// This is used by [priroda](https://github.com/oli-obk/priroda)
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:174 alloc_map
  // PORT: the method is `alloc_map_()` (clash with the field).
  alloc_map_(): CtfeMemoryMap {
    return this.alloc_map;
  }
}

/** Lazy const_eval/machine.ts (`impl AllocMap for FxIndexMap`; init order, eval_context.ts header). */
function const_eval_machine(): typeof import("../const_eval/machine.ts") {
  return require("../const_eval/machine.ts") as typeof import("../const_eval/machine.ts");
}

/// A reference to some allocation that was already bounds-checked for the given region
/// and had the on-access machine hooks run.
// rustc-type: compiler/rustc_const_eval/src/interpret/memory.rs:155 AllocRefMut
// PORT (D8): `&'a mut Allocation<Prov, Extra, Bytes>` is the (mutable) `Allocation` object.
export class AllocRefMut {
  constructor(
    public alloc: Allocation,
    public range: AllocRange,
    public tcx: TyCtxt,
    public alloc_id: AllocId,
  ) {}

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1339 as_ref (lane interp-memory)
  as_ref(): AllocRef {
    return unported("rustc_const_eval::interpret::memory::AllocRefMut::as_ref");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1344 write_scalar (lane interp-memory)
  write_scalar(range: AllocRange, val: Scalar): InterpResult {
    return unported("rustc_const_eval::interpret::memory::AllocRefMut::write_scalar");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1355 write_ptr_sized (lane interp-memory)
  write_ptr_sized(offset: Size, val: Scalar): InterpResult {
    return unported("rustc_const_eval::interpret::memory::AllocRefMut::write_ptr_sized");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1360 write_uninit (lane interp-memory)
  write_uninit(range: AllocRange): void {
    return unported("rustc_const_eval::interpret::memory::AllocRefMut::write_uninit");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1367 write_uninit_full (lane interp-memory)
  write_uninit_full(): void {
    return unported("rustc_const_eval::interpret::memory::AllocRefMut::write_uninit_full");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1372 clear_provenance (lane interp-memory)
  clear_provenance(): void {
    return unported("rustc_const_eval::interpret::memory::AllocRefMut::clear_provenance");
  }

}

/// A reference to some allocation that was already bounds-checked for the given region
/// and had the on-access machine hooks run.
// #[derive(Copy, Clone)]
// rustc-type: compiler/rustc_const_eval/src/interpret/memory.rs:147 AllocRef
export class AllocRef {
  constructor(
    public alloc: Allocation,
    public range: AllocRange,
    public tcx: TyCtxt,
    public alloc_id: AllocId,
  ) {}

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1379 read_scalar (lane interp-memory)
  read_scalar(range: AllocRange, read_provenance: boolean): InterpResult<Scalar> {
    return unported("rustc_const_eval::interpret::memory::AllocRef::read_scalar");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1392 read_integer (lane interp-memory)
  read_integer(range: AllocRange): InterpResult<Scalar> {
    return unported("rustc_const_eval::interpret::memory::AllocRef::read_integer");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1397 read_pointer (lane interp-memory)
  read_pointer(offset: Size): InterpResult<Scalar> {
    return unported("rustc_const_eval::interpret::memory::AllocRef::read_pointer");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1405 get_bytes_strip_provenance (lane interp-memory)
  get_bytes_strip_provenance(): InterpResult<Uint8Array> {
    return unported("rustc_const_eval::interpret::memory::AllocRef::get_bytes_strip_provenance");
  }

  // stub: compiler/rustc_const_eval/src/interpret/memory.rs:1413 has_provenance (lane interp-memory)
  has_provenance(): boolean {
    return unported("rustc_const_eval::interpret::memory::AllocRef::has_provenance");
  }

}

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:42 may_leak (lane interp-memory)
MemoryKind.may_leak = function <T>(self: MemoryKind<T>, T_: MayLeak<T>): boolean {
  return unported("rustc_const_eval::interpret::memory::MemoryKind::may_leak");
};

// impl Display for MemoryKind
// stub: compiler/rustc_const_eval/src/interpret/memory.rs:52 fmt (lane interp-memory)
export function display_MemoryKind<T>(self: MemoryKind<T>, f: Fmt, display_T: (v: T, f: Fmt) => string): string {
  return unported("rustc_const_eval::interpret::memory::MemoryKind::fmt");
}

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:88 new (lane interp-memory)
(AllocInfo as unknown as { new_: typeof AllocInfo.new }).new_ = function (size: Size, align: Align, kind: AllocKind, mutbl: Mutability): AllocInfo {
  return unported("rustc_const_eval::interpret::memory::AllocInfo::new");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:101 as_instance (lane interp-memory)
FnVal.as_instance = function <Other>(self: FnVal<Other>): InterpResult<Instance> {
  return unported("rustc_const_eval::interpret::memory::FnVal::as_instance");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:190 global_root_pointer (lane interp-memory)
InterpCx.prototype.global_root_pointer = function (this: InterpCx, ptr: Pointer): InterpResult<Pointer> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::global_root_pointer");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:219 fn_ptr (lane interp-memory)
InterpCx.prototype.fn_ptr = function (this: InterpCx, fn_val: FnVal<never>): Pointer {
  return unported("rustc_const_eval::interpret::memory::InterpCx::fn_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:239 va_list_ptr (lane interp-memory)
InterpCx.prototype.va_list_ptr = function (this: InterpCx, varargs: MPlaceTy[]): Pointer {
  return unported("rustc_const_eval::interpret::memory::InterpCx::va_list_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:251 allocate_ptr (lane interp-memory)
InterpCx.prototype.allocate_ptr = function (this: InterpCx, size: Size, align: Align, kind: MemoryKind<CtfeMemoryKind>, init: AllocInit): InterpResult<Pointer> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::allocate_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:267 allocate_bytes_ptr (lane interp-memory)
InterpCx.prototype.allocate_bytes_ptr = function (this: InterpCx, bytes: Uint8Array, align: Align, kind: MemoryKind<CtfeMemoryKind>, mutability: Mutability): InterpResult<Pointer> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::allocate_bytes_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:279 insert_allocation (lane interp-memory)
InterpCx.prototype.insert_allocation = function (this: InterpCx, alloc: Allocation, kind: MemoryKind<CtfeMemoryKind>): InterpResult<Pointer> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::insert_allocation");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:301 reallocate_ptr (lane interp-memory)
InterpCx.prototype.reallocate_ptr = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, old_size_and_align: [Size, Align] | undefined, new_size: Size, new_align: Align, kind: MemoryKind<CtfeMemoryKind>, init_growth: AllocInit): InterpResult<Pointer> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::reallocate_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:335 make_const_heap_ptr_global (lane interp-memory)
InterpCx.prototype.make_const_heap_ptr_global = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::make_const_heap_ptr_global");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:380 deallocate_ptr (lane interp-memory)
InterpCx.prototype.deallocate_ptr = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, old_size_and_align: [Size, Align] | undefined, kind: MemoryKind<CtfeMemoryKind>): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::deallocate_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:459 get_ptr_access (lane interp-memory)
InterpCx.prototype.get_ptr_access = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<[AllocId, Size, boolean] | undefined> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_access");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:481 check_ptr_access (lane interp-memory)
InterpCx.prototype.check_ptr_access = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size, msg: CheckInAllocMsg): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::check_ptr_access");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:498 check_ptr_access_signed (lane interp-memory)
InterpCx.prototype.check_ptr_access_signed = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: bigint, msg: CheckInAllocMsg): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::check_ptr_access_signed");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:519 check_and_deref_ptr (lane interp-memory)
InterpCx.prototype.check_and_deref_ptr = function <T, R>(this: InterpCx, this_: R, ptr: Pointer<CtfeProvenance | undefined>, size: bigint, msg: CheckInAllocMsg, alloc_size: (a0: R, a1: AllocId, a2: Size, a3: boolean) => InterpResult<[Size, Align, T]>): InterpResult<T | undefined> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::check_and_deref_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:568 check_misalign (lane interp-memory)
InterpCx.prototype.check_misalign = function (this: InterpCx, misaligned: Misalignment | undefined, msg: CheckAlignMsg): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::check_misalign");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:579 is_ptr_misaligned (lane interp-memory)
InterpCx.prototype.is_ptr_misaligned = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, align: Align): Misalignment | undefined {
  return unported("rustc_const_eval::interpret::memory::InterpCx::is_ptr_misaligned");
};

// PORT: nested in `is_ptr_misaligned` upstream; moves inside its parent when ported.
// stub: compiler/rustc_const_eval/src/interpret/memory.rs:589 is_offset_misaligned (lane interp-memory)
function is_offset_misaligned(offset: bigint, align: Align): Misalignment | undefined {
  return unported("rustc_const_eval::interpret::memory::is_ptr_misaligned::is_offset_misaligned");
}

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:629 check_ptr_align (lane interp-memory)
InterpCx.prototype.check_ptr_align = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, align: Align): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::check_ptr_align");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:640 remove_unreachable_allocs (lane interp-memory)
InterpCx.prototype.remove_unreachable_allocs = function (this: InterpCx, reachable_allocs: Set<AllocId>): void {
  return unported("rustc_const_eval::interpret::memory::InterpCx::remove_unreachable_allocs");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:655 get_global_alloc (lane interp-memory)
InterpCx.prototype.get_global_alloc = function (this: InterpCx, id: AllocId, is_write: boolean): InterpResult<Allocation> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_global_alloc");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:708 get_alloc_raw (lane interp-memory)
InterpCx.prototype.get_alloc_raw = function (this: InterpCx, id: AllocId): InterpResult<Allocation> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_raw");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:745 get_alloc_bytes_unchecked_raw (lane interp-memory)
InterpCx.prototype.get_alloc_bytes_unchecked_raw = function (this: InterpCx, id: AllocId): InterpResult<Uint8Array> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_bytes_unchecked_raw");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:751 get_ptr_alloc (lane interp-memory)
InterpCx.prototype.get_ptr_alloc = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<AllocRef | undefined> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_alloc");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:796 get_alloc_extra (lane interp-memory)
InterpCx.prototype.get_alloc_extra = function (this: InterpCx, id: AllocId): InterpResult<null> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_extra");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:801 get_alloc_mutability (lane interp-memory)
InterpCx.prototype.get_alloc_mutability = function (this: InterpCx, id: AllocId): InterpResult<Mutability> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_mutability");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:812 get_alloc_raw_mut (lane interp-memory)
InterpCx.prototype.get_alloc_raw_mut = function (this: InterpCx, id: AllocId): InterpResult<[Allocation, Machine]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_raw_mut");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:843 get_alloc_bytes_unchecked_raw_mut (lane interp-memory)
InterpCx.prototype.get_alloc_bytes_unchecked_raw_mut = function (this: InterpCx, id: AllocId): InterpResult<Uint8Array> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_bytes_unchecked_raw_mut");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:852 get_ptr_alloc_mut (lane interp-memory)
InterpCx.prototype.get_ptr_alloc_mut = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<AllocRefMut | undefined> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_alloc_mut");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:895 get_alloc_extra_mut (lane interp-memory)
InterpCx.prototype.get_alloc_extra_mut = function (this: InterpCx, id: AllocId): InterpResult<[null, Machine]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_extra_mut");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:906 is_alloc_live (lane interp-memory)
InterpCx.prototype.is_alloc_live = function (this: InterpCx, id: AllocId): boolean {
  return unported("rustc_const_eval::interpret::memory::InterpCx::is_alloc_live");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:916 has_provenance_in_alloc (lane interp-memory)
InterpCx.prototype.has_provenance_in_alloc = function (this: InterpCx, id: AllocId): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::has_provenance_in_alloc");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:923 get_alloc_info (lane interp-memory)
InterpCx.prototype.get_alloc_info = function (this: InterpCx, id: AllocId): AllocInfo {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_alloc_info");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:984 get_live_alloc_size_and_align (lane interp-memory)
InterpCx.prototype.get_live_alloc_size_and_align = function (this: InterpCx, id: AllocId, msg: CheckInAllocMsg): InterpResult<[Size, Align]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_live_alloc_size_and_align");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:996 get_fn_alloc (lane interp-memory)
InterpCx.prototype.get_fn_alloc = function (this: InterpCx, id: AllocId): FnVal<never> | undefined {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_fn_alloc");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1009 get_ptr_type_id (lane interp-memory)
InterpCx.prototype.get_ptr_type_id = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<[Ty, bigint]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_type_id");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1020 get_ptr_fn (lane interp-memory)
InterpCx.prototype.get_ptr_fn = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<FnVal<never>> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_fn");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1034 get_ptr_va_list (lane interp-memory)
InterpCx.prototype.get_ptr_va_list = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<MPlaceTy[]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_va_list");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1053 deallocate_va_list (lane interp-memory)
InterpCx.prototype.deallocate_va_list = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<MPlaceTy[]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::deallocate_va_list");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1073 get_ptr_vtable_ty (lane interp-memory)
InterpCx.prototype.get_ptr_vtable_ty = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<Ty> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::get_ptr_vtable_ty");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1097 alloc_mark_immutable (lane interp-memory)
InterpCx.prototype.alloc_mark_immutable = function (this: InterpCx, id: AllocId): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::alloc_mark_immutable");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1104 visit_reachable_allocs (lane interp-memory)
InterpCx.prototype.visit_reachable_allocs = function (this: InterpCx, start: AllocId[], visit: (a0: InterpCx, a1: AllocId, a2: AllocInfo) => InterpResult): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::visit_reachable_allocs");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1139 dump_alloc (lane interp-memory)
InterpCx.prototype.dump_alloc = function (this: InterpCx, id: AllocId): DumpAllocs {
  return unported("rustc_const_eval::interpret::memory::InterpCx::dump_alloc");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1146 dump_allocs (lane interp-memory)
InterpCx.prototype.dump_allocs = function (this: InterpCx, allocs: AllocId[]): DumpAllocs {
  return unported("rustc_const_eval::interpret::memory::InterpCx::dump_allocs");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1153 print_alloc_bytes_for_diagnostics (lane interp-memory)
InterpCx.prototype.print_alloc_bytes_for_diagnostics = function (this: InterpCx, id: AllocId): string {
  return unported("rustc_const_eval::interpret::memory::InterpCx::print_alloc_bytes_for_diagnostics");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1172 take_leaked_allocations (lane interp-memory)
InterpCx.prototype.take_leaked_allocations = function (this: InterpCx, static_roots: (a0: InterpCx) => readonly AllocId[]): ([AllocId, MemoryKind<CtfeMemoryKind>, Allocation])[] {
  return unported("rustc_const_eval::interpret::memory::InterpCx::take_leaked_allocations");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1219 ghost_run_mut (lane interp-memory)
InterpCx.prototype.ghost_run_mut = function <R>(this: InterpCx, f: (a0: InterpCx) => R): R {
  return unported("rustc_const_eval::interpret::memory::InterpCx::ghost_run_mut");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1237 ghost_run (lane interp-memory)
InterpCx.prototype.ghost_run = function <R>(this: InterpCx, f: (a0: InterpCx) => R): R {
  return unported("rustc_const_eval::interpret::memory::InterpCx::ghost_run");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1249 validation_in_progress (lane interp-memory)
InterpCx.prototype.validation_in_progress = function (this: InterpCx): boolean {
  return unported("rustc_const_eval::interpret::memory::InterpCx::validation_in_progress");
};

// #[doc(hidden)]
/// There's no way to use this directly, it's just a helper struct for the `dump_alloc(s)` methods.
// rustc-type: compiler/rustc_const_eval/src/interpret/memory.rs:1256 DumpAllocs
export class DumpAllocs<M extends Machine = Machine> {
  constructor(
    public ecx: InterpCx<M>,
    public allocs: AllocId[],
  ) {}
}

// impl Debug for DumpAllocs
// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1262 fmt (lane interp-memory)
export function debug_DumpAllocs(self: DumpAllocs, f: Fmt): string {
  return unported("rustc_const_eval::interpret::memory::DumpAllocs::fmt");
}

// PORT: nested in `fmt` upstream; moves inside its parent when ported.
// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1264 write_allocation_track_relocs (lane interp-memory)
function write_allocation_track_relocs<Prov, Extra, Bytes>(fmt: Fmt, tcx: TyCtxt, allocs_to_print: AllocId[], alloc: Allocation): string {
  return unported("rustc_const_eval::interpret::memory::fmt::write_allocation_track_relocs");
}

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1423 read_bytes_ptr_strip_provenance (lane interp-memory)
InterpCx.prototype.read_bytes_ptr_strip_provenance = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<Uint8Array> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::read_bytes_ptr_strip_provenance");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1445 write_bytes_ptr (lane interp-memory)
InterpCx.prototype.write_bytes_ptr = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, src: IterableIterator<number>): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::write_bytes_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1475 mem_copy (lane interp-memory)
InterpCx.prototype.mem_copy = function (this: InterpCx, src: Pointer<CtfeProvenance | undefined>, dest: Pointer<CtfeProvenance | undefined>, size: Size, nonoverlapping: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::mem_copy");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1490 mem_copy_repeatedly (lane interp-memory)
InterpCx.prototype.mem_copy_repeatedly = function (this: InterpCx, src: Pointer<CtfeProvenance | undefined>, dest: Pointer<CtfeProvenance | undefined>, size: Size, num_copies: bigint, nonoverlapping: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::memory::InterpCx::mem_copy_repeatedly");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1641 scalar_may_be_null (lane interp-memory)
InterpCx.prototype.scalar_may_be_null = function (this: InterpCx, scalar: Scalar): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::scalar_may_be_null");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1689 ptr_try_get_alloc_id (lane interp-memory)
InterpCx.prototype.ptr_try_get_alloc_id = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: bigint): Result<[AllocId, Size, boolean], bigint> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::ptr_try_get_alloc_id");
};

// stub: compiler/rustc_const_eval/src/interpret/memory.rs:1721 ptr_get_alloc_id (lane interp-memory)
InterpCx.prototype.ptr_get_alloc_id = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: bigint): InterpResult<[AllocId, Size, boolean]> {
  return unported("rustc_const_eval::interpret::memory::InterpCx::ptr_get_alloc_id");
};
