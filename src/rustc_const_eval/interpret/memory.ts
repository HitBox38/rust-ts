//! The memory subsystem.
//!
//! Generally, we use `Pointer` to denote memory addresses. However, some operations
//! have a "size"-like parameter, and they take `Scalar` for the address because
//! if the size is 0, then the pointer can also be a (properly aligned, non-null)
//! integer. It is crucial that these operations call `check_align` *before*
//! short-circuiting the empty case!
//
// Port of compiler/rustc_const_eval/src/interpret/memory.rs (declared by lane interp-contract, ported by lane
// interp-memory, plan-m4 wave 23c). docs/handoff/interp-contract.md has the conventions (interpret/eval_context.ts's
// header repeats them); this file in addition:
// - `throw_ub!(X)` / `throw_ub_format!(..)` / `throw_unsup!(X)` / `throw_unsup_format!(..)` are
//   `return Err(InterpErrorInfo_from_InterpErrorKind(err_ub(..) / err_ub_format(..) / err_unsup(..) / err_unsup_format(..)))`
//   with the macro kept as a comment (the `err_*` helpers at the end of the file are the macros' expansions).
// - `Cow<'tcx, Allocation>` (`get_global_alloc`, `M::adjust_global_allocation`) is the `Allocation`: the CTFE machines'
//   `adjust_global_allocation` always returns `Cow::Borrowed` (interpret/machine.rs:810), so `get_alloc_raw` takes the
//   borrowed arm and `into_owned()` is a clone.
// - The `u64` / `i64` fields of `UndefinedBehaviorInfo` (`addr`, `inbounds_size`, `ptr_offset`) are `number`s in
//   error.gen.ts; this file computes them as `bigint`s and converts with `i64_number` (beyond 2^53: `unported`, never
//   rounded).
// - `ProvenanceExtra` is `boolean` (`CtfeProvenance::immutable`), `AllocExtra` is `null`, `Bytes` is `Uint8Array`;
//   `*const u8` / `*mut u8` / `&[u8]` are `Uint8Array` views (`subarray`) into the allocation's bytes.
import { type Align, Align as AlignC, Align_eq, debug_AlignFromBytesError, Size } from "../../rustc_abi/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type CtfeMemoryKind, type CtfeMemoryMap, type Machine, type MayLeak } from "./machine.ts";
import * as gen from "./memory.gen.ts";
import { AllocInfo, AllocKind } from "./memory.gen.ts";
import {
  AllocError,
  type AllocId,
  type AllocInit,
  type AllocRange,
  type AllocResult,
  Allocation,
  alloc_range,
  type CheckAlignMsg,
  CheckInAllocMsg,
  clone_Allocation,
  type ConstAllocation,
  CtfeProvenance,
  debug_AllocId,
  display_AllocId,
  display_Pointer_Option,
  type InterpErrorInfo,
  type InterpErrorKind,
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  InterpResult,
  interp_ok,
  type Misalignment,
  Pointer,
  PointerArithmetic_provided,
  Pointer_from_AllocId,
  Pointer_Option_from_Pointer,
  Provenance_CtfeProvenance,
  Scalar,
  type UndefinedBehaviorInfo,
  GlobalAlloc,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { display_Instance, type Instance } from "../../rustc_middle/ty/instance.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
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

/** Lazy const_eval/machine.ts (`impl AllocMap for FxIndexMap`, the CTFE `MemoryKind`'s `Display` / `MayLeak`,
 * `swap_remove`; init order, eval_context.ts header). */
function const_eval_machine(): typeof import("../const_eval/machine.ts") {
  return (const_eval_machine_cache ??= require("../const_eval/machine.ts") as typeof import("../const_eval/machine.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var const_eval_machine_cache: typeof import("../const_eval/machine.ts") | undefined;
/** Lazy const_eval/error.ts (`ConstEvalErrKind` into `InterpErrorInfo`). */
function const_eval_error(): typeof import("../const_eval/error.ts") {
  return (const_eval_error_cache ??= require("../const_eval/error.ts") as typeof import("../const_eval/error.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var const_eval_error_cache: typeof import("../const_eval/error.ts") | undefined;
/** Lazy rustc_middle mir/pretty.ts (`display_allocation`, `write_allocation_bytes`). */
function mir_pretty(): typeof import("../../rustc_middle/mir/pretty.ts") {
  return (mir_pretty_cache ??= require("../../rustc_middle/mir/pretty.ts") as typeof import("../../rustc_middle/mir/pretty.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var mir_pretty_cache: typeof import("../../rustc_middle/mir/pretty.ts") | undefined;
/** Lazy rustc_middle ty/print/pretty.ts (`Display` of `Ty` and of the existential predicates). */
function ty_print_pretty(): typeof import("../../rustc_middle/ty/print/pretty.ts") {
  return (ty_print_pretty_cache ??= require("../../rustc_middle/ty/print/pretty.ts") as typeof import("../../rustc_middle/ty/print/pretty.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var ty_print_pretty_cache: typeof import("../../rustc_middle/ty/print/pretty.ts") | undefined;

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

  // ---- Reading and writing. (impl AllocRefMut) ----
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1339 as_ref
  as_ref(): AllocRef {
    return new AllocRef(this.alloc, this.range, this.tcx, this.alloc_id);
  }

  /// `range` is relative to this allocation reference, not the base of the allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1344 write_scalar
  write_scalar(range: AllocRange, val: Scalar): InterpResult {
    const range_ = this.range.subrange(range);
    // debug!("write_scalar at {:?}{range:?}: {val:?}", self.alloc_id);

    return alloc_result_into(this.alloc.write_scalar(this.tcx, range_, val), this.alloc_id);
  }

  /// `offset` is relative to this allocation reference, not the base of the allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1355 write_ptr_sized
  write_ptr_sized(offset: Size, val: Scalar): InterpResult {
    return this.write_scalar(alloc_range(offset, this.tcx.data_layout().pointer_size()), val);
  }

  /// Mark the given sub-range (relative to this allocation reference) as uninitialized.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1360 write_uninit
  write_uninit(range: AllocRange): void {
    const range_ = this.range.subrange(range);

    this.alloc.write_uninit(this.tcx, range_);
  }

  /// Mark the entire referenced range as uninitialized
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1367 write_uninit_full
  write_uninit_full(): void {
    this.alloc.write_uninit(this.tcx, this.range);
  }

  /// Remove all provenance in the reference range.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1372 clear_provenance
  clear_provenance(): void {
    this.alloc.clear_provenance(this.tcx, this.range);
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

  /// `range` is relative to this allocation reference, not the base of the allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1379 read_scalar
  read_scalar(range: AllocRange, read_provenance: boolean): InterpResult<Scalar> {
    const range_ = this.range.subrange(range);
    return alloc_result_into(this.alloc.read_scalar(this.tcx, range_, read_provenance), this.alloc_id);
  }

  /// `range` is relative to this allocation reference, not the base of the allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1392 read_integer
  read_integer(range: AllocRange): InterpResult<Scalar> {
    return this.read_scalar(range, /*read_provenance*/ false);
  }

  /// `offset` is relative to this allocation reference, not the base of the allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1397 read_pointer
  read_pointer(offset: Size): InterpResult<Scalar> {
    return this.read_scalar(alloc_range(offset, this.tcx.data_layout().pointer_size()), /*read_provenance*/ true);
  }

  /// `range` is relative to this allocation reference, not the base of the allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1405 get_bytes_strip_provenance
  get_bytes_strip_provenance(): InterpResult<Uint8Array> {
    return alloc_result_into(this.alloc.get_bytes_strip_provenance(this.tcx, this.range), this.alloc_id);
  }

  /// Returns whether the allocation has provenance anywhere in the range of the `AllocRef`.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1413 has_provenance
  has_provenance(): boolean {
    return !this.alloc.provenance_().range_empty(this.range, this.tcx);
  }
}

/** `alloc_result.map_err(|e| e.to_interp_error(alloc_id)).into()` */
function alloc_result_into<T>(r: AllocResult<T>, alloc_id: AllocId): InterpResult<T> {
  if (r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(AllocError.to_interp_error(r._0, alloc_id)));
  return interp_ok(r._0);
}

// impl<T: MayLeak> MayLeak for MemoryKind<T>
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:42 may_leak
MemoryKind.may_leak = function <T>(self: MemoryKind<T>, T_: MayLeak<T>): boolean {
  switch (self.$) {
    case "Stack":
      return false;
    case "CallerLocation":
      return true;
    case "Machine": {
      const k = self._0;
      return T_.may_leak(k);
    }
  }
};

// impl<T: fmt::Display> fmt::Display for MemoryKind<T>
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:52 fmt
export function display_MemoryKind<T>(self: MemoryKind<T>, f: Fmt, display_T: (v: T, f: Fmt) => string): string {
  switch (self.$) {
    case "Stack":
      return "stack variable";
    case "CallerLocation":
      return "caller location";
    case "Machine": {
      const m = self._0;
      return display_T(m, f);
    }
  }
}

/** PORT: derived `PartialEq` of `MemoryKind<M::MemoryKind>` (the CTFE `MemoryKind::Heap { was_made_global }`). */
function MemoryKind_eq(a: MemoryKind<CtfeMemoryKind>, b: MemoryKind<CtfeMemoryKind>): boolean {
  if (a.$ === "Machine" && b.$ === "Machine") return a._0.$ === b._0.$ && a._0.was_made_global === b._0.was_made_global;
  return a.$ === b.$;
}

/** `Display` of the CTFE machines' `MemoryKind<M::MemoryKind>` (`{kind}`). */
function display_CtfeMemoryKind(kind: MemoryKind<CtfeMemoryKind>): string {
  return display_MemoryKind(kind, PLAIN, const_eval_machine().display_MemoryKind);
}

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:88 new
(AllocInfo as unknown as { new: typeof AllocInfo.new }).new = function (size: Size, align: Align, kind: AllocKind, mutbl: Mutability): AllocInfo {
  return new AllocInfo(size, align, kind, mutbl);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:101 as_instance
FnVal.as_instance = function <Other>(self: FnVal<Other>): InterpResult<Instance> {
  switch (self.$) {
    case "Instance": {
      const instance = self._0;
      return interp_ok(instance);
    }
    case "Other": {
      // throw_unsup_format!("'foreign' function pointers are not supported in this context")
      return Err(InterpErrorInfo_from_InterpErrorKind(err_unsup_format("'foreign' function pointers are not supported in this context")));
    }
  }
};

// ---- impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M> ----

/// Call this to turn untagged "global" pointers (obtained via `tcx`) into
/// the machine pointer to the allocation. Must never be used
/// for any other pointers, nor for TLS statics.
///
/// Using the resulting pointer represents a *direct* access to that memory
/// (e.g. by directly using a `static`),
/// as opposed to access through a pointer that was created by the program.
///
/// This function can fail only if `ptr` points to an `extern static`.
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:190 global_root_pointer
InterpCx.prototype.global_root_pointer = function (this: InterpCx, ptr: Pointer): InterpResult<Pointer> {
  const alloc_id = CtfeProvenance.alloc_id(ptr.provenance);
  // We need to handle `extern static`.
  const g = this.tcx.deref().try_get_global_alloc(alloc_id);
  if (g !== undefined && g.$ === "Static" && this.tcx.deref().is_thread_local_static(g._0)) {
    // Thread-local statics do not have a constant address. They *must* be accessed via
    // `ThreadLocalRef`; we can never have a pointer to them as a regular constant value.
    return bug("global memory cannot point to thread-local static");
  } else if (g !== undefined && g.$ === "Static" && this.tcx.deref().is_foreign_item(g._0)) {
    const def_id = g._0;
    return this.machine.extern_static_pointer(this, def_id);
  } else if (g === undefined) {
    const is_fn_ptr = this.memory.extra_fn_ptr_map.has(alloc_id);
    const is_va_list = this.memory.va_list_map.has(alloc_id);
    assert(is_fn_ptr || is_va_list, () => `${debug_AllocId(alloc_id, PLAIN)} is neither global, va_list nor a function pointer`);
  } else {
    // _ => {}
  }
  // And we need to get the provenance.
  const global_kind = this.machine.GLOBAL_KIND;
  return this.machine.adjust_alloc_root_pointer(this, ptr, global_kind === undefined ? undefined : { $: "Machine", _0: global_kind });
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:219 fn_ptr
InterpCx.prototype.fn_ptr = function (this: InterpCx, fn_val: FnVal<never>): Pointer {
  let id: AllocId;
  switch (fn_val.$) {
    case "Instance": {
      const instance = fn_val._0;
      const salt = this.machine.get_global_alloc_salt(this, instance);
      id = this.tcx.deref().reserve_and_set_fn_alloc(instance, salt);
      break;
    }
    case "Other": {
      const extra = fn_val._0;
      // FIXME(RalfJung): Should we have a cache here?
      const id_ = this.tcx.deref().reserve_alloc_id();
      const old = this.memory.extra_fn_ptr_map.get(id_);
      this.memory.extra_fn_ptr_map.set(id_, extra);
      assert(old === undefined, "assertion failed: old.is_none()");
      id = id_;
      break;
    }
  }
  // Functions are global allocations, so make sure we get the right root pointer.
  // We know this is not an `extern static` so this cannot fail.
  return InterpResult.unwrap(this.global_root_pointer(Pointer_from_AllocId(id)));
};

/// Insert a new variable argument list in the global map of variable argument lists.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:239 va_list_ptr
InterpCx.prototype.va_list_ptr = function (this: InterpCx, varargs: MPlaceTy[]): Pointer {
  const id = this.tcx.deref().reserve_alloc_id();
  const old = this.memory.va_list_map.get(id);
  this.memory.va_list_map.set(id, varargs);
  assert(old === undefined, "assertion failed: old.is_none()");
  // Variable argument lists are global allocations, so make sure we get the right root
  // pointer. We know this is not an `extern static` so this cannot fail.
  return InterpResult.unwrap(this.global_root_pointer(Pointer_from_AllocId(id)));
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:251 allocate_ptr
InterpCx.prototype.allocate_ptr = function (this: InterpCx, size: Size, align: Align, kind: MemoryKind<CtfeMemoryKind>, init: AllocInit): InterpResult<Pointer> {
  const params = this.machine.get_default_alloc_params();
  let alloc: Allocation;
  if (this.machine.PANIC_ON_ALLOC_FAIL) {
    alloc = Allocation.new(size, align, init, params);
  } else {
    const r = Allocation.try_new(size, align, init, params);
    if (r.$ === "Err") return r;
    alloc = r._0;
  }
  return this.insert_allocation(alloc, kind);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:267 allocate_bytes_ptr
InterpCx.prototype.allocate_bytes_ptr = function (this: InterpCx, bytes: Uint8Array, align: Align, kind: MemoryKind<CtfeMemoryKind>, mutability: Mutability): InterpResult<Pointer> {
  const params = this.machine.get_default_alloc_params();
  const alloc = Allocation.from_bytes(bytes, align, mutability, params);
  return this.insert_allocation(alloc, kind);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:279 insert_allocation
InterpCx.prototype.insert_allocation = function (this: InterpCx, alloc: Allocation, kind: MemoryKind<CtfeMemoryKind>): InterpResult<Pointer> {
  // PORT: `self.max_size_of_val()` is `Size::from_bytes(self.target_isize_max())`, beyond 2^53 on 64-bit targets (a
  // `Size` is a number, recorded decision): the comparison is on the bytes, as `bigint`s.
  assert(alloc.size().bytes_u64() <= PointerArithmetic_provided.target_isize_max(this), "assertion failed: alloc.size() <= self.max_size_of_val()");
  const id = this.tcx.deref().reserve_alloc_id();
  // debug_assert_ne!(Some(kind), M::GLOBAL_KIND.map(MemoryKind::Machine), "dynamically allocating global memory");
  // This cannot be merged with the `adjust_global_allocation` code path
  // since here we have an allocation that already uses `M::Bytes`.
  const extra = this.machine.init_local_allocation(this, id, kind, alloc.size(), alloc.align);
  if (extra.$ === "Err") return extra;
  const alloc_ = alloc.with_extra(extra._0);
  this.memory.alloc_map.insert(id, [kind, alloc_]);
  return this.machine.adjust_alloc_root_pointer(this, Pointer_from_AllocId(id), kind);
};

/// If this grows the allocation, `init_growth` determines
/// whether the additional space will be initialized.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:301 reallocate_ptr
InterpCx.prototype.reallocate_ptr = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, old_size_and_align: [Size, Align] | undefined, new_size: Size, new_align: Align, kind: MemoryKind<CtfeMemoryKind>, init_growth: AllocInit): InterpResult<Pointer> {
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset, _prov] = p._0;
  if (offset.bytes() !== 0) {
    // throw_ub_format!("reallocating {ptr} which does not point to the beginning of an object")
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(`reallocating ${display_Pointer_Option(ptr, PLAIN)} which does not point to the beginning of an object`)));
  }

  // For simplicities' sake, we implement reallocate as "alloc, copy, dealloc".
  // This happens so rarely, the perf advantage is outweighed by the maintenance cost.
  // If requested, we zero-init the entire allocation, to ensure that a growing
  // allocation has its new bytes properly set. For the part that is copied,
  // `mem_copy` below will de-initialize things as necessary.
  const new_ptr = this.allocate_ptr(new_size, new_align, kind, init_growth);
  if (new_ptr.$ === "Err") return new_ptr;
  let old_size: Size;
  if (old_size_and_align !== undefined) {
    const [size, _align] = old_size_and_align;
    old_size = size;
  } else {
    const a = this.get_alloc_raw(alloc_id);
    if (a.$ === "Err") return a;
    old_size = a._0.size();
  }
  // This will also call the access hooks.
  const min_size = old_size.bytes() <= new_size.bytes() ? old_size : new_size;
  const c = this.mem_copy(ptr, Pointer_Option_from_Pointer(new_ptr._0), min_size, /*nonoverlapping*/ true);
  if (c.$ === "Err") return c;
  const d = this.deallocate_ptr(ptr, old_size_and_align, kind);
  if (d.$ === "Err") return d;

  return interp_ok(new_ptr._0);
};

/// Mark the `const_allocate`d allocation `ptr` points to as immutable so we can intern it.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:335 make_const_heap_ptr_global
InterpCx.prototype.make_const_heap_ptr_global = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult {
  const into = const_eval_error().ConstEvalErrKind_into_InterpErrorInfo;
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset] = p._0;
  if (offset.bytes() !== 0) {
    return Err(into({ $: "ConstMakeGlobalWithOffset", _0: ptr }));
  }

  if (this.tcx.deref().try_get_global_alloc(alloc_id) !== undefined) {
    // This points to something outside the current interpreter.
    return Err(into({ $: "ConstMakeGlobalPtrIsNonHeap", _0: ptr }));
  }

  // If we can't find it in `alloc_map` it must be dangling (because we don't use
  // `extra_fn_ptr_map` in const-eval).
  const e = this.memory.alloc_map.get_mut_or(alloc_id, () => Err({ $: "ConstMakeGlobalWithDanglingPtr" as const, _0: ptr }));
  if (e.$ === "Err") return Err(into(e._0));
  const entry = e._0;
  const [kind, alloc] = entry;

  // Ensure this is actually a *heap* allocation, and record it as made-global.
  switch (kind.$) {
    case "Stack":
    case "CallerLocation":
      return Err(into({ $: "ConstMakeGlobalPtrIsNonHeap", _0: ptr }));
    case "Machine": {
      // MemoryKind::Machine(crate::const_eval::MemoryKind::Heap { was_made_global })
      const was_made_global = kind._0.was_made_global;
      if (was_made_global) {
        return Err(into({ $: "ConstMakeGlobalPtrAlreadyMadeGlobal", _0: alloc_id }));
      }
      // PORT: `*was_made_global = true` (the kinds are immutable values: the entry gets a new one).
      entry[0] = { $: "Machine", _0: { $: "Heap", was_made_global: true } };
      break;
    }
  }

  // Prevent further mutation, this is now an immutable global.
  alloc.mutability = Mutability.Not;

  return interp_ok(undefined);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:380 deallocate_ptr
InterpCx.prototype.deallocate_ptr = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, old_size_and_align: [Size, Align] | undefined, kind: MemoryKind<CtfeMemoryKind>): InterpResult {
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset, prov] = p._0;
  // trace!("deallocating: {alloc_id}");

  if (offset.bytes() !== 0) {
    // throw_ub_format!("deallocating {ptr} which does not point to the beginning of an object")
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(`deallocating ${display_Pointer_Option(ptr, PLAIN)} which does not point to the beginning of an object`)));
  }

  const removed = this.memory.alloc_map.remove(alloc_id);
  if (removed === undefined) {
    // Deallocating global memory -- always an error
    const g = this.tcx.deref().try_get_global_alloc(alloc_id);
    let err: InterpErrorKind;
    if (g === undefined) {
      err = err_ub({ $: "PointerUseAfterFree", _0: alloc_id, _1: CheckInAllocMsg.MemoryAccess });
    } else {
      switch (g.$) {
        case "Function":
          err = err_ub_format(`deallocating ${display_AllocId(alloc_id)}, which is a function`);
          break;
        case "VTable":
          err = err_ub_format(`deallocating ${display_AllocId(alloc_id)}, which is a vtable`);
          break;
        case "TypeId":
          err = err_ub_format(`deallocating ${display_AllocId(alloc_id)}, which is a type id`);
          break;
        case "Static":
        case "Memory":
          err = err_ub_format(`deallocating ${display_AllocId(alloc_id)}, which is static memory`);
          break;
      }
    }
    return Err(InterpErrorInfo_from_InterpErrorKind(err));
  }
  const [alloc_kind, alloc] = removed;

  if (Mutability.is_not(alloc.mutability)) {
    // throw_ub_format!("deallocating immutable allocation {alloc_id}")
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(`deallocating immutable allocation ${display_AllocId(alloc_id)}`)));
  }
  if (!MemoryKind_eq(alloc_kind, kind)) {
    // throw_ub_format!("deallocating {alloc_id}, which is {alloc_kind} memory, using {kind} deallocation operation")
    return Err(
      InterpErrorInfo_from_InterpErrorKind(
        err_ub_format(
          `deallocating ${display_AllocId(alloc_id)}, which is ${display_CtfeMemoryKind(alloc_kind)} memory, using ${display_CtfeMemoryKind(kind)} deallocation operation`,
        ),
      ),
    );
  }
  if (old_size_and_align !== undefined) {
    const [size, align] = old_size_and_align;
    if (size.bytes() !== alloc.size().bytes() || !Align_eq(align, alloc.align)) {
      // throw_ub_format!("incorrect layout on deallocation: {alloc_id} has size {size} and alignment {align}, but gave size {size_found} and alignment {align_found}",
      //     size = alloc.size().bytes(), align = alloc.align.bytes(), size_found = size.bytes(), align_found = align.bytes())
      return Err(
        InterpErrorInfo_from_InterpErrorKind(
          err_ub_format(
            `incorrect layout on deallocation: ${display_AllocId(alloc_id)} has size ${alloc.size().bytes()} and alignment ${alloc.align.bytes()}, but gave size ${size.bytes()} and alignment ${align.bytes()}`,
          ),
        ),
      );
    }
  }

  // Let the machine take some extra action
  const size = alloc.size();
  const h = this.machine.before_memory_deallocation(this.tcx, this.machine, alloc.extra, ptr, [alloc_id, prov], size, alloc.align, kind);
  if (h.$ === "Err") return h;

  // Don't forget to remember size and align of this now-dead allocation
  const old = this.memory.dead_alloc_map.get(alloc_id);
  this.memory.dead_alloc_map.set(alloc_id, [size, alloc.align]);
  if (old !== undefined) {
    return bug("Nothing can be deallocated twice");
  }

  return interp_ok(undefined);
};

/// Internal helper function to determine the allocation and offset of a pointer (if any).
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:459 get_ptr_access
InterpCx.prototype.get_ptr_access = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<[AllocId, Size, boolean] | undefined> {
  // PORT: `i64::try_from(size.bytes()).unwrap()`: a `Size` is below 2^53 (recorded decision), so it always fits.
  const size_ = size.bytes_u64(); // it would be an error to even ask for more than isize::MAX bytes
  return this.check_and_deref_ptr<[AllocId, Size, boolean], InterpCx>(this, ptr, size_, CheckInAllocMsg.MemoryAccess, (this_, alloc_id, offset, prov) => {
    const r = this_.get_live_alloc_size_and_align(alloc_id, CheckInAllocMsg.MemoryAccess);
    if (r.$ === "Err") return r;
    const [size, align] = r._0;
    return interp_ok<[Size, Align, [AllocId, Size, boolean]]>([size, align, [alloc_id, offset, prov]]);
  });
};

/// Check if the given pointer points to live memory of the given `size`.
/// The caller can control the error message for the out-of-bounds case.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:481 check_ptr_access
InterpCx.prototype.check_ptr_access = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size, msg: CheckInAllocMsg): InterpResult {
  const size_ = size.bytes_u64(); // it would be an error to even ask for more than isize::MAX bytes
  const r = this.check_and_deref_ptr<undefined, InterpCx>(this, ptr, size_, msg, (this_, alloc_id, _1, _2) => {
    const s = this_.get_live_alloc_size_and_align(alloc_id, msg);
    if (s.$ === "Err") return s;
    const [size, align] = s._0;
    return interp_ok<[Size, Align, undefined]>([size, align, undefined]);
  });
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

/// Check whether the given pointer points to live memory for a signed amount of bytes.
/// A negative amounts means that the given range of memory to the left of the pointer
/// needs to be dereferenceable.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:498 check_ptr_access_signed
InterpCx.prototype.check_ptr_access_signed = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: bigint, msg: CheckInAllocMsg): InterpResult {
  const r = this.check_and_deref_ptr<undefined, InterpCx>(this, ptr, size, msg, (this_, alloc_id, _1, _2) => {
    const s = this_.get_live_alloc_size_and_align(alloc_id, msg);
    if (s.$ === "Err") return s;
    const [size, align] = s._0;
    return interp_ok<[Size, Align, undefined]>([size, align, undefined]);
  });
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

/// Low-level helper function to check if a ptr is in-bounds and potentially return a reference
/// to the allocation it points to. Supports both shared and mutable references, as the actual
/// checking is offloaded to a helper closure. Supports signed sizes for checks "to the left" of
/// a pointer.
///
/// `alloc_size` will only get called for non-zero-sized accesses.
///
/// Returns `None` if and only if the size is 0.
// PORT: an associated fn (`Self::check_and_deref_ptr(this, ..)`) called on the receiver; `this.borrow()` (`R: Borrow<Self>`)
// is the receiver.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:519 check_and_deref_ptr
InterpCx.prototype.check_and_deref_ptr = function <T, R>(this: InterpCx, this_: R, ptr: Pointer<CtfeProvenance | undefined>, size: bigint, msg: CheckInAllocMsg, alloc_size: (a0: R, a1: AllocId, a2: Size, a3: boolean) => InterpResult<[Size, Align, T]>): InterpResult<T | undefined> {
  // Everything is okay with size 0.
  if (size === 0n) {
    return interp_ok(undefined);
  }

  const t = this.ptr_try_get_alloc_id(ptr, size);
  if (t.$ === "Err") {
    const addr = t._0;
    // We couldn't get a proper allocation.
    // throw_ub!(DanglingIntPointer { addr, inbounds_size: size, msg })
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "DanglingIntPointer", addr: i64_number(addr), inbounds_size: i64_number(size), msg })));
  } else {
    const [alloc_id, offset_, prov] = t._0;
    const tcx = this.tcx;
    const a = alloc_size(this_, alloc_id, offset_, prov);
    if (a.$ === "Err") return a;
    const [alloc_size_, _alloc_align, ret_val] = a._0;
    const offset = offset_.bytes_u64();
    // Compute absolute begin and end of the range.
    let begin: bigint | undefined;
    let end: bigint | undefined;
    if (size >= 0n) {
      // `(Some(offset), offset.checked_add(size as u64))`
      begin = offset;
      end = offset + size <= U64_MAX ? offset + size : undefined;
    } else {
      // `(offset.checked_sub(size.unsigned_abs()), Some(offset))`
      begin = offset + size >= 0n ? offset + size : undefined;
      end = offset;
    }
    // Ensure both are within bounds.
    const in_bounds = begin !== undefined && end !== undefined && end <= alloc_size_.bytes_u64();
    if (!in_bounds) {
      // throw_ub!(PointerOutOfBounds { alloc_id, alloc_size, ptr_offset: tcx.sign_extend_to_target_isize(offset), inbounds_size: size, msg })
      return Err(
        InterpErrorInfo_from_InterpErrorKind(
          err_ub({
            $: "PointerOutOfBounds",
            alloc_id,
            alloc_size: alloc_size_,
            ptr_offset: i64_number(PointerArithmetic_provided.sign_extend_to_target_isize(tcx, offset)),
            inbounds_size: i64_number(size),
            msg,
          }),
        ),
      );
    }

    return interp_ok(ret_val);
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:568 check_misalign
InterpCx.prototype.check_misalign = function (this: InterpCx, misaligned: Misalignment | undefined, msg: CheckAlignMsg): InterpResult {
  if (misaligned !== undefined) {
    // throw_ub!(AlignmentCheckFailed(misaligned, msg))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "AlignmentCheckFailed", _0: misaligned, _1: msg })));
  }
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:579 is_ptr_misaligned
InterpCx.prototype.is_ptr_misaligned = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, align: Align): Misalignment | undefined {
  if (!this.machine.enforce_alignment(this) || align.bytes() === 1) {
    return undefined;
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:589 is_offset_misaligned
  function is_offset_misaligned(offset: bigint, align: Align): Misalignment | undefined {
    if (offset % BigInt(align.bytes()) === 0n) {
      return undefined;
    } else {
      // The biggest power of two through which `offset` is divisible.
      const offset_pow2 = 1n << trailing_zeros_u64(offset);
      return { has: unwrap_result(AlignC.from_bytes(offset_pow2), debug_AlignFromBytesError), required: align };
    }
  }

  const t = this.ptr_try_get_alloc_id(ptr, 0n);
  if (t.$ === "Err") {
    const addr = t._0;
    return is_offset_misaligned(addr, align);
  } else {
    const [alloc_id, offset, _prov] = t._0;
    const alloc_info = this.get_alloc_info(alloc_id);
    const misalign = this.machine.alignment_check(this, alloc_id, alloc_info.align, alloc_info.kind, offset, align);
    if (misalign !== undefined) {
      return misalign;
    } else if (Provenance_CtfeProvenance.OFFSET_IS_ADDR) {
      return is_offset_misaligned(ptr.addr().bytes_u64(), align);
    } else {
      // Check allocation alignment and offset alignment.
      if (alloc_info.align.bytes() < align.bytes()) {
        return { has: alloc_info.align, required: align };
      } else {
        return is_offset_misaligned(offset.bytes_u64(), align);
      }
    }
  }
};

/// Checks a pointer for misalignment.
///
/// The error assumes this is checking the pointer used directly for an access.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:629 check_ptr_align
InterpCx.prototype.check_ptr_align = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, align: Align): InterpResult {
  return this.check_misalign(this.is_ptr_misaligned(ptr, align), "AccessedPtr");
};

// ---- impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M> ----

/// This function is used by Miri's provenance GC to remove unreachable entries from the dead_alloc_map.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:640 remove_unreachable_allocs
InterpCx.prototype.remove_unreachable_allocs = function (this: InterpCx, reachable_allocs: Set<AllocId>): void {
  // Unlike all the other GC helpers where we check if an `AllocId` is found in the interpreter or
  // is live, here all the IDs in the map are for dead allocations so we don't
  // need to check for liveness.
  for (const id of [...this.memory.dead_alloc_map.keys()]) {
    if (!reachable_allocs.has(id)) this.memory.dead_alloc_map.delete(id);
  }
};

// ---- Allocation accessors (impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M>) ----

/// Helper function to obtain a global (tcx) allocation.
/// This attempts to return a reference to an existing allocation if
/// one can be found in `tcx`. That, however, is only possible if `tcx` and
/// this machine use the same pointer provenance, so it is indirected through
/// `M::adjust_allocation`.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:655 get_global_alloc
InterpCx.prototype.get_global_alloc = function (this: InterpCx, id: AllocId, is_write: boolean): InterpResult<Allocation> {
  const g = this.tcx.deref().try_get_global_alloc(id);
  let alloc: ConstAllocation;
  let def_id: DefId | undefined;
  if (g === undefined) {
    // throw_ub!(PointerUseAfterFree(id, CheckInAllocMsg::MemoryAccess))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "PointerUseAfterFree", _0: id, _1: CheckInAllocMsg.MemoryAccess })));
  }
  switch (g.$) {
    case "Memory": {
      const mem = g._0;
      // Memory of a constant or promoted or anonymous memory referenced by a static.
      [alloc, def_id] = [mem, undefined];
      break;
    }
    case "Function":
      // throw_ub!(DerefFunctionPointer(id))
      return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "DerefFunctionPointer", _0: id })));
    case "VTable":
      // throw_ub!(DerefVTablePointer(id))
      return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "DerefVTablePointer", _0: id })));
    case "TypeId":
      // throw_ub!(DerefTypeIdPointer(id))
      return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "DerefTypeIdPointer", _0: id })));
    case "Static": {
      const def_id_ = g._0;
      assert(this.tcx.deref().is_static(def_id_), "assertion failed: self.tcx.is_static(def_id)");
      // Thread-local statics do not have a constant address. They *must* be accessed via
      // `ThreadLocalRef`; we can never have a pointer to them as a regular constant value.
      assert(!this.tcx.deref().is_thread_local_static(def_id_), "assertion failed: !self.tcx.is_thread_local_static(def_id)");
      // Notice that every static has two `AllocId` that will resolve to the same
      // thing here: one maps to `GlobalAlloc::Static`, this is the "lazy" ID,
      // and the other one is maps to `GlobalAlloc::Memory`, this is returned by
      // `eval_static_initializer` and it is the "resolved" ID.
      // The resolved ID is never used by the interpreted program, it is hidden.
      // This is relied upon for soundness of const-patterns; a pointer to the resolved
      // ID would "sidestep" the checks that make sure consts do not point to statics!
      // The `GlobalAlloc::Memory` branch here is still reachable though; when a static
      // contains a reference to memory that was created during its evaluation (i.e., not
      // to another static), those inner references only exist in "resolved" form.
      if (this.tcx.deref().is_foreign_item(def_id_)) {
        // This is unreachable in Miri, but can happen in CTFE where we actually *do* support
        // referencing arbitrary (declared) extern statics.
        // throw_unsup!(ExternStatic(def_id))
        return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "ExternStatic", _0: def_id_ } }));
      }

      // We don't give a span -- statics don't need that, they cannot be generic or associated.
      const val = this.ctfe_query((tcx) => tcx.eval_static_initializer(def_id_));
      if (val.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(val._0));
      [alloc, def_id] = [val._0, def_id_];
      break;
    }
  }
  const b = this.machine.before_access_global(this.tcx, this.machine, id, alloc, def_id, is_write);
  if (b.$ === "Err") return b;
  // We got tcx memory. Let the machine initialize its "extra" stuff.
  return this.machine.adjust_global_allocation(
    this,
    id, // always use the ID we got as input, not the "hidden" one.
    alloc.inner(),
  );
};

/// Gives raw access to the `Allocation`, without bounds or alignment checks.
/// The caller is responsible for calling the access hooks!
///
/// You almost certainly want to use `get_ptr_alloc`/`get_ptr_alloc_mut` instead.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:708 get_alloc_raw
InterpCx.prototype.get_alloc_raw = function (this: InterpCx, id: AllocId): InterpResult<Allocation> {
  // The error type of the inner closure here is somewhat funny. We have two
  // ways of "erroring": An actual error, or because we got a reference from
  // `get_global_alloc` that we can actually use directly without inserting anything anywhere.
  // So the error type is `InterpResult<'tcx, &Allocation<M::Provenance>>`.
  const a = this.memory.alloc_map.get_or<Result<Allocation, InterpErrorInfo>>(id, () => {
    // We have to funnel the `InterpErrorInfo` through a `Result` to match the `get_or` API,
    // so we use `report_err` for that.
    const r = InterpResult.report_err(this.get_global_alloc(id, /*is_write*/ false));
    if (r.$ === "Err") return Err(r);
    const alloc = r._0;
    // PORT: `Cow::Borrowed(alloc)`: the CTFE machines' `adjust_global_allocation` always borrows (header), so
    // the `Cow::Owned` arm (`M::GLOBAL_KIND.expect(..)`, `Ok((MemoryKind::Machine(kind), alloc))`) is not taken.
    // We got a ref, cheaply return that as an "error" so that the
    // map does not get mutated.
    return Err(Ok(alloc));
  });
  // Now unpack that funny error type
  if (a.$ === "Ok") {
    return interp_ok(a._0[1]);
  } else {
    return a._0;
  }
};

/// Gives raw, immutable access to the `Allocation` address, without bounds or alignment checks.
/// The caller is responsible for calling the access hooks!
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:745 get_alloc_bytes_unchecked_raw
InterpCx.prototype.get_alloc_bytes_unchecked_raw = function (this: InterpCx, id: AllocId): InterpResult<Uint8Array> {
  const alloc = this.get_alloc_raw(id);
  if (alloc.$ === "Err") return alloc;
  return interp_ok(alloc._0.get_bytes_unchecked_raw());
};

/// Bounds-checked *but not align-checked* allocation access.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:751 get_ptr_alloc
InterpCx.prototype.get_ptr_alloc = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<AllocRef | undefined> {
  const size_i64 = size.bytes_u64(); // it would be an error to even ask for more than isize::MAX bytes
  const ptr_and_alloc_r = this.check_and_deref_ptr<[AllocId, Size, boolean, Allocation], InterpCx>(this, ptr, size_i64, CheckInAllocMsg.MemoryAccess, (this_, alloc_id, offset, prov) => {
    const alloc = this_.get_alloc_raw(alloc_id);
    if (alloc.$ === "Err") return alloc;
    return interp_ok<[Size, Align, [AllocId, Size, boolean, Allocation]]>([alloc._0.size(), alloc._0.align, [alloc_id, offset, prov, alloc._0]]);
  });
  if (ptr_and_alloc_r.$ === "Err") return ptr_and_alloc_r;
  const ptr_and_alloc = ptr_and_alloc_r._0;
  // We want to call the hook on *all* accesses that involve an AllocId, including zero-sized
  // accesses. That means we cannot rely on the closure above or the `Some` branch below. We
  // do this after `check_and_deref_ptr` to ensure some basic sanity has already been checked.
  if (!this.memory.ghost_mode) {
    const t = this.ptr_try_get_alloc_id(ptr, size_i64);
    if (t.$ === "Ok") {
      const [alloc_id] = t._0;
      const h = this.machine.before_alloc_access(this.tcx, this.machine, alloc_id);
      if (h.$ === "Err") return h;
    }
  }

  if (ptr_and_alloc !== undefined) {
    const [alloc_id, offset, prov, alloc] = ptr_and_alloc;
    const range = alloc_range(offset, size);
    if (!this.memory.ghost_mode) {
      const h = this.machine.before_memory_read(this.tcx, this.machine, alloc.extra, ptr, [alloc_id, prov], range);
      if (h.$ === "Err") return h;
    }
    return interp_ok(new AllocRef(alloc, range, this.tcx.deref(), alloc_id));
  } else {
    return interp_ok(undefined);
  }
};

/// Return the `extra` field of the given allocation.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:796 get_alloc_extra
InterpCx.prototype.get_alloc_extra = function (this: InterpCx, id: AllocId): InterpResult<null> {
  const a = this.get_alloc_raw(id);
  if (a.$ === "Err") return a;
  return interp_ok(a._0.extra);
};

/// Return the `mutability` field of the given allocation.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:801 get_alloc_mutability
InterpCx.prototype.get_alloc_mutability = function (this: InterpCx, id: AllocId): InterpResult<Mutability> {
  const a = this.get_alloc_raw(id);
  if (a.$ === "Err") return a;
  return interp_ok(a._0.mutability);
};

/// Gives raw mutable access to the `Allocation`, without bounds or alignment checks.
/// The caller is responsible for calling the access hooks!
///
/// Also returns a ptr to `self.extra` so that the caller can use it in parallel with the
/// allocation.
///
/// You almost certainly want to use `get_ptr_alloc`/`get_ptr_alloc_mut` instead.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:812 get_alloc_raw_mut
InterpCx.prototype.get_alloc_raw_mut = function (this: InterpCx, id: AllocId): InterpResult<[Allocation, Machine]> {
  // We have "NLL problem case #3" here, which cannot be worked around without loss of
  // efficiency even for the common case where the key is in the map.
  // <https://rust-lang.github.io/rfcs/2094-nll.html#problem-case-3-conditional-control-flow-across-functions>
  // (Cannot use `get_mut_or` since `get_global_alloc` needs `&self`, and that boils down to
  // Miri's `adjust_alloc_root_pointer` needing to look up the size of the allocation.
  // It could be avoided with a totally separate codepath in Miri for handling the absolute address
  // of global allocations, but that's not worth it.)
  if (this.memory.alloc_map.get_mut(id) === undefined) {
    // Slow path.
    // Allocation not found locally, go look global.
    const alloc = this.get_global_alloc(id, /*is_write*/ true);
    if (alloc.$ === "Err") return alloc;
    const kind = unwrap(this.machine.GLOBAL_KIND, "I got a global allocation that I have to copy but the machine does not expect that to happen");
    // PORT: `alloc.into_owned()` of the borrowed global allocation is a clone (header).
    this.memory.alloc_map.insert(id, [{ $: "Machine", _0: kind }, clone_Allocation(alloc._0, (p) => p, (e) => e, (b) => b.slice())]);
  }

  const [_kind, alloc] = unwrap(this.memory.alloc_map.get_mut(id));
  if (Mutability.is_not(alloc.mutability)) {
    // throw_ub!(WriteToReadOnly(id))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "WriteToReadOnly", _0: id })));
  }
  return interp_ok<[Allocation, Machine]>([alloc, this.machine]);
};

/// Gives raw, mutable access to the `Allocation` address, without bounds or alignment checks.
/// The caller is responsible for calling the access hooks!
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:843 get_alloc_bytes_unchecked_raw_mut
InterpCx.prototype.get_alloc_bytes_unchecked_raw_mut = function (this: InterpCx, id: AllocId): InterpResult<Uint8Array> {
  const a = this.get_alloc_raw_mut(id);
  if (a.$ === "Err") return a;
  const alloc = a._0[0];
  return interp_ok(alloc.get_bytes_unchecked_raw_mut());
};

/// Bounds-checked *but not align-checked* allocation access.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:852 get_ptr_alloc_mut
InterpCx.prototype.get_ptr_alloc_mut = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<AllocRefMut | undefined> {
  const tcx = this.tcx;
  const validation_in_progress = this.memory.ghost_mode;

  const size_i64 = size.bytes_u64(); // it would be an error to even ask for more than isize::MAX bytes
  const ptr_and_alloc_r = this.check_and_deref_ptr<[AllocId, Size, boolean, Allocation, Machine], InterpCx>(this, ptr, size_i64, CheckInAllocMsg.MemoryAccess, (this_, alloc_id, offset, prov) => {
    const a = this_.get_alloc_raw_mut(alloc_id);
    if (a.$ === "Err") return a;
    const [alloc, machine] = a._0;
    return interp_ok<[Size, Align, [AllocId, Size, boolean, Allocation, Machine]]>([alloc.size(), alloc.align, [alloc_id, offset, prov, alloc, machine]]);
  });
  if (ptr_and_alloc_r.$ === "Err") return ptr_and_alloc_r;
  const ptr_and_alloc = ptr_and_alloc_r._0;

  if (ptr_and_alloc !== undefined) {
    const [alloc_id, offset, prov, alloc, machine] = ptr_and_alloc;
    const range = alloc_range(offset, size);
    if (!validation_in_progress) {
      // For writes, it's okay to only call those when there actually is a non-zero
      // amount of bytes to be written: a zero-sized write doesn't manifest anything.
      const h = machine.before_alloc_access(tcx, machine, alloc_id);
      if (h.$ === "Err") return h;
      const w = machine.before_memory_write(tcx, machine, alloc.extra, ptr, [alloc_id, prov], range);
      if (w.$ === "Err") return w;
    }
    return interp_ok(new AllocRefMut(alloc, range, tcx.deref(), alloc_id));
  } else {
    return interp_ok(undefined);
  }
};

/// Return the `extra` field of the given allocation.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:895 get_alloc_extra_mut
InterpCx.prototype.get_alloc_extra_mut = function (this: InterpCx, id: AllocId): InterpResult<[null, Machine]> {
  const a = this.get_alloc_raw_mut(id);
  if (a.$ === "Err") return a;
  const [alloc, machine] = a._0;
  return interp_ok<[null, Machine]>([alloc.extra, machine]);
};

/// Check whether an allocation is live. This is faster than calling
/// [`InterpCx::get_alloc_info`] if all you need to check is whether the kind is
/// [`AllocKind::Dead`] because it doesn't have to look up the type and layout of statics.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:906 is_alloc_live
InterpCx.prototype.is_alloc_live = function (this: InterpCx, id: AllocId): boolean {
  return (
    this.memory.alloc_map.contains_key_ref(id) ||
    this.memory.extra_fn_ptr_map.has(id) ||
    this.memory.va_list_map.has(id) ||
    // We check `tcx` last as that has to acquire a lock in `many-seeds` mode.
    // This also matches the order in `get_alloc_info`.
    this.tcx.deref().try_get_global_alloc(id) !== undefined
  );
};

/// Check whether an allocation contains provenance.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:916 has_provenance_in_alloc
InterpCx.prototype.has_provenance_in_alloc = function (this: InterpCx, id: AllocId): InterpResult<boolean> {
  const a = this.get_alloc_raw(id);
  if (a.$ === "Err") return a;
  const alloc = a._0;
  return interp_ok(!alloc.provenance_().range_empty(alloc_range(Size.ZERO, alloc.size()), this.tcx));
};

/// Obtain the size and alignment of an allocation, even if that allocation has
/// been deallocated.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:923 get_alloc_info
InterpCx.prototype.get_alloc_info = function (this: InterpCx, id: AllocId): AllocInfo {
  // # Regular allocations
  // Don't use `self.get_raw` here as that will
  // a) cause cycles in case `id` refers to a static
  // b) duplicate a global's allocation in miri
  const local = this.memory.alloc_map.get(id);
  if (local !== undefined) {
    const [_1, alloc] = local;
    return AllocInfo.new(alloc.size(), alloc.align, AllocKind.LiveData, alloc.mutability);
  }

  // # Function pointers
  // (both global from `alloc_map` and local from `extra_fn_ptr_map`)
  const fn_val = this.get_fn_alloc(id);
  if (fn_val !== undefined) {
    let align: Align;
    switch (fn_val.$) {
      case "Instance":
        // FIXME: Until we have a clear design for the effects of align(N) functions
        // on the address of function pointers, we don't consider the align(N)
        // attribute on functions in the interpreter.
        // See <https://github.com/rust-lang/rust/issues/144661> for more context.
        align = AlignC.ONE;
        break;
      // Machine-specific extra functions currently do not support alignment restrictions.
      case "Other":
        align = AlignC.ONE;
        break;
    }

    return AllocInfo.new(Size.ZERO, align, AllocKind.Function, Mutability.Not);
  }

  // # Variable argument lists
  if (this.memory.va_list_map.has(id)) {
    return AllocInfo.new(Size.ZERO, AlignC.ONE, AllocKind.VaList, Mutability.Not);
  }

  // # Global allocations
  const global_alloc = this.tcx.deref().try_get_global_alloc(id);
  if (global_alloc !== undefined) {
    // NOTE: `static` alignment from attributes has already been applied to the allocation.
    const [size, align] = GlobalAlloc.size_and_align(global_alloc, this.tcx.deref(), this.typing_env);
    const mutbl = GlobalAlloc.mutability(global_alloc, this.tcx.deref(), this.typing_env);
    let kind: AllocKind;
    switch (global_alloc.$) {
      case "Static":
      case "Memory":
        kind = AllocKind.LiveData;
        break;
      case "Function":
        return bug("We already checked function pointers above");
      case "VTable":
        kind = AllocKind.VTable;
        break;
      case "TypeId":
        kind = AllocKind.TypeId;
        break;
    }
    return AllocInfo.new(size, align, kind, mutbl);
  }

  // # Dead pointers
  const [size, align] = unwrap(this.memory.dead_alloc_map.get(id), "deallocated pointers should all be recorded in `dead_alloc_map`");
  return AllocInfo.new(size, align, AllocKind.Dead, Mutability.Not);
};

/// Obtain the size and alignment of a *live* allocation.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:984 get_live_alloc_size_and_align
InterpCx.prototype.get_live_alloc_size_and_align = function (this: InterpCx, id: AllocId, msg: CheckInAllocMsg): InterpResult<[Size, Align]> {
  const info = this.get_alloc_info(id);
  if (info.kind === AllocKind.Dead) {
    // throw_ub!(PointerUseAfterFree(id, msg))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "PointerUseAfterFree", _0: id, _1: msg })));
  }
  return interp_ok<[Size, Align]>([info.size, info.align]);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:996 get_fn_alloc
InterpCx.prototype.get_fn_alloc = function (this: InterpCx, id: AllocId): FnVal<never> | undefined {
  if (this.memory.extra_fn_ptr_map.has(id)) {
    const extra = this.memory.extra_fn_ptr_map.get(id)!;
    return { $: "Other", _0: extra };
  } else {
    const g = this.tcx.deref().try_get_global_alloc(id);
    if (g !== undefined && g.$ === "Function") {
      const instance = g.instance;
      return { $: "Instance", _0: instance };
    } else {
      return undefined;
    }
  }
};

/// Takes a pointer that is the first chunk of a `TypeId` and return the type that its
/// provenance refers to, as well as the segment of the hash that this pointer covers.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1009 get_ptr_type_id
InterpCx.prototype.get_ptr_type_id = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<[Ty, bigint]> {
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset, _meta] = p._0;
  const g = this.tcx.deref().try_get_global_alloc(alloc_id);
  if (g === undefined || g.$ !== "TypeId") {
    // throw_ub_format!("invalid `TypeId` value: not all bytes carry type id metadata")
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format("invalid `TypeId` value: not all bytes carry type id metadata")));
  }
  const ty = g.ty;
  return interp_ok<[Ty, bigint]>([ty, offset.bytes_u64()]);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1020 get_ptr_fn
InterpCx.prototype.get_ptr_fn = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<FnVal<never>> {
  // trace!("get_ptr_fn({:?})", ptr);
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset, _prov] = p._0;
  if (offset.bytes() !== 0) {
    // throw_ub!(InvalidFunctionPointer(Pointer::new(alloc_id, offset)))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidFunctionPointer", _0: Pointer.new(alloc_id, offset) })));
  }
  const f = this.get_fn_alloc(alloc_id);
  if (f === undefined) {
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidFunctionPointer", _0: Pointer.new(alloc_id, offset) })));
  }
  return interp_ok(f);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1034 get_ptr_va_list
InterpCx.prototype.get_ptr_va_list = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<MPlaceTy[]> {
  // trace!("get_ptr_va_list({:?})", ptr);
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset, _prov] = p._0;
  if (offset.bytes() !== 0) {
    // throw_ub!(InvalidVaListPointer(Pointer::new(alloc_id, offset)))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidVaListPointer", _0: Pointer.new(alloc_id, offset) })));
  }

  const va_list = this.memory.va_list_map.get(alloc_id);
  if (va_list === undefined) {
    // throw_ub!(InvalidVaListPointer(Pointer::new(alloc_id, offset)))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidVaListPointer", _0: Pointer.new(alloc_id, offset) })));
  }

  return interp_ok(va_list);
};

/// Removes this VaList from the global map of variable argument lists. This does not deallocate
/// the VaList elements, that happens when the Frame is popped.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1053 deallocate_va_list
InterpCx.prototype.deallocate_va_list = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>): InterpResult<MPlaceTy[]> {
  // trace!("deallocate_va_list({:?})", ptr);
  const p = this.ptr_get_alloc_id(ptr, 0n);
  if (p.$ === "Err") return p;
  const [alloc_id, offset, _prov] = p._0;
  if (offset.bytes() !== 0) {
    // throw_ub!(InvalidVaListPointer(Pointer::new(alloc_id, offset)))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidVaListPointer", _0: Pointer.new(alloc_id, offset) })));
  }

  const va_list = const_eval_machine().swap_remove(this.memory.va_list_map, alloc_id);
  if (va_list === undefined) {
    // throw_ub!(InvalidVaListPointer(Pointer::new(alloc_id, offset)))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidVaListPointer", _0: Pointer.new(alloc_id, offset) })));
  }

  this.memory.dead_alloc_map.set(alloc_id, [Size.ZERO, AlignC.ONE]);
  return interp_ok(va_list);
};

/// Get the dynamic type of the given vtable pointer.
/// If `expected_trait` is `Some`, it must be a vtable for the given trait.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1073 get_ptr_vtable_ty
InterpCx.prototype.get_ptr_vtable_ty = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<Ty> {
  // trace!("get_ptr_vtable({:?})", ptr);
  const p = InterpResult.map_err_kind(this.ptr_get_alloc_id(ptr, 0n), (err) => {
    if (!(err.$ === "UndefinedBehavior" && err._0.$ === "DanglingIntPointer")) return bug();
    const addr = err._0.addr;
    return err_ub({ $: "InvalidVTablePointer", _0: Pointer.without_provenance<AllocId>(BigInt(addr)) });
  });
  if (p.$ === "Err") return p;
  const [alloc_id, offset, _tag] = p._0;
  if (offset.bytes() !== 0) {
    // throw_ub!(InvalidVTablePointer(Pointer::new(alloc_id, offset).into()))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidVTablePointer", _0: Pointer_Option_from_Pointer(Pointer.new(alloc_id, offset)) })));
  }
  const g = this.tcx.deref().try_get_global_alloc(alloc_id);
  if (g === undefined || g.$ !== "VTable") {
    // throw_ub!(InvalidVTablePointer(Pointer::new(alloc_id, offset).into()))
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "InvalidVTablePointer", _0: Pointer_Option_from_Pointer(Pointer.new(alloc_id, offset)) })));
  }
  const [ty, vtable_dyn_type] = [g._0, g._1];
  if (expected_trait !== undefined) {
    const expected_dyn_type = expected_trait;
    const c = this.check_vtable_for_type(vtable_dyn_type, expected_dyn_type);
    if (c.$ === "Err") return c;
  }
  return interp_ok(ty);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1097 alloc_mark_immutable
InterpCx.prototype.alloc_mark_immutable = function (this: InterpCx, id: AllocId): InterpResult {
  const a = this.get_alloc_raw_mut(id);
  if (a.$ === "Err") return a;
  a._0[0].mutability = Mutability.Not;
  return interp_ok(undefined);
};

/// Visit all allocations reachable from the given start set, by recursively traversing the
/// provenance information of those allocations.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1104 visit_reachable_allocs
InterpCx.prototype.visit_reachable_allocs = function (this: InterpCx, start: AllocId[], visit: (a0: InterpCx, a1: AllocId, a2: AllocInfo) => InterpResult): InterpResult {
  const done = new Set<AllocId>();
  const todo = start;
  let id: AllocId | undefined;
  while ((id = todo.pop()) !== undefined) {
    if (done.has(id)) {
      // We already saw this allocation before, don't process it again.
      continue;
    }
    done.add(id);
    const info = this.get_alloc_info(id);

    // Recurse, if there is data here.
    // Do this *before* invoking the callback, as the callback might mutate the
    // allocation and e.g. replace all provenance by wildcards!
    if (info.kind === AllocKind.LiveData) {
      const a = this.get_alloc_raw(id);
      if (a.$ === "Err") return a;
      const alloc = a._0;
      for (const prov of alloc.provenance_().provenances()) {
        const id_ = Provenance_CtfeProvenance.get_alloc_id(prov);
        if (id_ !== undefined) {
          todo.push(id_);
        }
      }
    }

    // Call the callback.
    const v = visit(this, id, info);
    if (v.$ === "Err") return v;
  }
  return interp_ok(undefined);
};

/// Create a lazy debug printer that prints the given allocation and all allocations it points
/// to, recursively.
// #[must_use]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1139 dump_alloc
InterpCx.prototype.dump_alloc = function (this: InterpCx, id: AllocId): DumpAllocs {
  return this.dump_allocs([id]);
};

/// Create a lazy debug printer for a list of allocations and all allocations they point to,
/// recursively.
// #[must_use]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1146 dump_allocs
InterpCx.prototype.dump_allocs = function (this: InterpCx, allocs: AllocId[]): DumpAllocs {
  allocs.sort((a, b) => a - b);
  // `allocs.dedup()`
  const deduped = allocs.filter((a, i) => i === 0 || allocs[i - 1] !== a);
  return new DumpAllocs(this, deduped);
};

/// Print the allocation's bytes, without any nested allocations.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1153 print_alloc_bytes_for_diagnostics
InterpCx.prototype.print_alloc_bytes_for_diagnostics = function (this: InterpCx, id: AllocId): string {
  // Using the "raw" access to avoid the `before_alloc_read` hook, we specifically
  // want to be able to read all memory for diagnostics, even if that is cyclic.
  const alloc = InterpResult.unwrap(this.get_alloc_raw(id));
  let bytes = "";
  if (alloc.size().bytes() !== Size.ZERO.bytes()) {
    const pretty = mir_pretty();
    const w = new pretty.StringFmtWrite();
    w.write_str("\n");
    // FIXME(translation) there might be pieces that are translatable.
    // `.unwrap()` of a `fmt::Result` (`fmt::Error`'s Debug is `Error`)
    unwrap_result(pretty.write_allocation_bytes(this.tcx.deref(), alloc, w, "    "), () => "Error");
    bytes = w.buf;
  }
  return bytes;
};

/// Find leaked allocations, remove them from memory and return them. Allocations reachable from
/// `static_roots` or a `Global` allocation are not considered leaked, as well as leaks whose
/// kind's `may_leak()` returns true.
///
/// This is highly destructive, no more execution can happen after this!
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1172 take_leaked_allocations
InterpCx.prototype.take_leaked_allocations = function (this: InterpCx, static_roots: (a0: InterpCx) => readonly AllocId[]): ([AllocId, MemoryKind<CtfeMemoryKind>, Allocation])[] {
  // Collect the set of allocations that are *reachable* from `Global` allocations.
  const reachable = ((): Set<AllocId> => {
    const reachable = new Set<AllocId>();
    const global_kind: MemoryKind<CtfeMemoryKind> | undefined = this.machine.GLOBAL_KIND === undefined ? undefined : { $: "Machine", _0: this.machine.GLOBAL_KIND };
    const todo: AllocId[] = this.memory.alloc_map.filter_map_collect((id, [kind, _]) => {
      return global_kind !== undefined && MemoryKind_eq(kind, global_kind) ? id : undefined;
    });
    todo.push(...static_roots(this));
    let id: AllocId | undefined;
    while ((id = todo.pop()) !== undefined) {
      if (!reachable.has(id)) {
        reachable.add(id);
        // This is a new allocation, add the allocations it points to `todo`.
        // We only need to care about `alloc_map` memory here, as entirely unchanged
        // global memory cannot point to memory relevant for the leak check.
        const local = this.memory.alloc_map.get(id);
        if (local !== undefined) {
          const [_1, alloc] = local;
          for (const prov of alloc.provenance_().provenances()) {
            const id_ = Provenance_CtfeProvenance.get_alloc_id(prov);
            if (id_ !== undefined) todo.push(id_);
          }
        }
      }
    }
    return reachable;
  })();

  // All allocations that are *not* `reachable` and *not* `may_leak` are considered leaking.
  const MayLeak_MemoryKind = const_eval_machine().MayLeak_MemoryKind;
  const leaked: AllocId[] = this.memory.alloc_map.filter_map_collect((id, [kind, _]) => {
    return MemoryKind.may_leak(kind, MayLeak_MemoryKind) || reachable.has(id) ? undefined : id;
  });
  const result: [AllocId, MemoryKind<CtfeMemoryKind>, Allocation][] = [];
  for (const id of leaked) {
    const [kind, alloc] = unwrap(this.memory.alloc_map.remove(id));
    result.push([id, kind, alloc]);
  }
  return result;
};

/// Runs the closure in "ghost" mode, which means the machine's memory read hooks will be
/// suppressed. Needless to say, this must only be set with great care! Cannot be nested.
///
/// We do this so Miri's allocation access tracking does not show the validation
/// reads as spurious accesses as those aren't "real" reads. Also useful for debuggers
/// that want to just display the Miri machine state.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1219 ghost_run_mut
InterpCx.prototype.ghost_run_mut = function <R>(this: InterpCx, f: (a0: InterpCx) => R): R {
  // This deliberately uses `==` on `bool` to follow the pattern
  // `assert!(val.replace(new) == old)`.
  assert(cell_replace(this.memory, true) === false, "`ghost_mode` was already set");
  const res = f(this);
  assert(cell_replace(this.memory, false) === true, "`ghost_mode` was unset by someone else");
  return res;
};

/// Runs the closure in "ghost" mode, which means the machine's memory read hooks will be
/// suppressed. Needless to say, this must only be set with great care! Cannot be nested.
///
/// We do this so Miri's allocation access tracking does not show the validation
/// reads as spurious accesses as those aren't "real" reads. Also useful for debuggers
/// that want to just display the Miri machine state.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1237 ghost_run
InterpCx.prototype.ghost_run = function <R>(this: InterpCx, f: (a0: InterpCx) => R): R {
  // This deliberately uses `==` on `bool` to follow the pattern
  // `assert!(val.replace(new) == old)`.
  assert(cell_replace(this.memory, true) === false, "`ghost_mode` was already set");
  const res = f(this);
  assert(cell_replace(this.memory, false) === true, "`ghost_mode` was unset by someone else");
  return res;
};

/** `self.memory.ghost_mode.replace(v)` (`Cell::replace`). */
function cell_replace(memory: Memory, v: boolean): boolean {
  const old = memory.ghost_mode;
  memory.ghost_mode = v;
  return old;
}

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1249 validation_in_progress
InterpCx.prototype.validation_in_progress = function (this: InterpCx): boolean {
  return this.memory.ghost_mode;
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

// impl<'a, 'tcx, M: Machine<'tcx>> std::fmt::Debug for DumpAllocs<'a, 'tcx, M>
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1262 fmt
export function debug_DumpAllocs(self: DumpAllocs, fmt: Fmt): string {
  // Cannot be a closure because it is generic in `Prov`, `Extra`.
  // rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1264 write_allocation_track_relocs
  function write_allocation_track_relocs<Prov, Extra, Bytes>(fmt: Fmt, tcx: TyCtxt, allocs_to_print: AllocId[], alloc: Allocation<Prov, Extra, Bytes>): string {
    void fmt;
    for (const prov of alloc.provenance_().provenances()) {
      const alloc_id = Provenance_CtfeProvenance.get_alloc_id(prov as unknown as CtfeProvenance);
      if (alloc_id !== undefined) {
        allocs_to_print.push(alloc_id);
      }
    }
    const pretty = mir_pretty();
    return pretty.display_RenderAllocation(pretty.display_allocation(tcx, alloc));
  }

  // PORT: `VecDeque` is an array (`push_back` is `push`, `pop_front` is `shift`); the formatter is the returned string.
  const allocs_to_print: AllocId[] = [...self.allocs];
  // `allocs_printed` contains all allocations that we have already printed.
  const allocs_printed = new Set<AllocId>();
  let out = "";

  let id: AllocId | undefined;
  while ((id = allocs_to_print.shift()) !== undefined) {
    if (allocs_printed.has(id)) {
      // Already printed, so skip this.
      continue;
    }
    allocs_printed.add(id);

    out += debug_AllocId(id, fmt);
    const local = self.ecx.memory.alloc_map.get(id);
    if (local !== undefined) {
      const [kind, alloc] = local;
      // normal alloc
      out += ` (${display_CtfeMemoryKind(kind)}, `;
      out += write_allocation_track_relocs(fmt, self.ecx.tcx.deref(), allocs_to_print, alloc);
    } else {
      // global alloc
      const g = self.ecx.tcx.deref().try_get_global_alloc(id);
      if (g === undefined) {
        out += " (deallocated)";
      } else {
        switch (g.$) {
          case "Memory": {
            const alloc = g._0;
            out += " (unchanged global, ";
            out += write_allocation_track_relocs(fmt, self.ecx.tcx.deref(), allocs_to_print, alloc.inner());
            break;
          }
          case "Function": {
            const instance = g.instance;
            out += ` (fn: ${display_Instance(instance)})`;
            break;
          }
          case "VTable": {
            const [ty, dyn_ty] = [g._0, g._1];
            const pp = ty_print_pretty();
            out += ` (vtable: impl ${pp.display_List_PolyExistentialPredicate(dyn_ty)} for ${pp.display_Ty(ty)})`;
            break;
          }
          case "TypeId": {
            const ty = g.ty;
            out += ` (typeid for ${ty_print_pretty().display_Ty(ty)})`;
            break;
          }
          case "Static": {
            const did = g._0;
            out += ` (static: ${self.ecx.tcx.deref().def_path_str(did)})`;
            break;
          }
        }
      }
    }
    out += "\n";
  }
  return out;
}

// ---- impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M> ----

/// Reads the given number of bytes from memory, and strips their provenance if possible.
/// Returns them as a slice.
///
/// Performs appropriate bounds checks.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1423 read_bytes_ptr_strip_provenance
InterpCx.prototype.read_bytes_ptr_strip_provenance = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: Size): InterpResult<Uint8Array> {
  const a = this.get_ptr_alloc(ptr, size);
  if (a.$ === "Err") return a;
  const alloc_ref = a._0;
  if (alloc_ref === undefined) {
    // zero-sized access
    return interp_ok(new Uint8Array(0));
  }
  // Side-step AllocRef and directly access the underlying bytes more efficiently.
  // (We are staying inside the bounds here so all is good.)
  const b = alloc_result_into(alloc_ref.alloc.get_bytes_strip_provenance(alloc_ref.tcx, alloc_ref.range), alloc_ref.alloc_id);
  if (b.$ === "Err") return b;
  return interp_ok(b._0);
};

/// Writes the given stream of bytes into memory.
///
/// Performs appropriate bounds checks.
// PORT: a JS iterator has no `size_hint`: it is collected first, so its length is precise (`lower == upper`).
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1445 write_bytes_ptr
InterpCx.prototype.write_bytes_ptr = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, src: IterableIterator<number>): InterpResult {
  const src_ = [...src];
  const len = src_.length; // `let (lower, upper) = src.size_hint(); let len = upper.expect(..); assert_eq!(lower, len, ..)`

  const size = Size.from_bytes(len);
  const a = this.get_ptr_alloc_mut(ptr, size);
  if (a.$ === "Err") return a;
  const alloc_ref = a._0;
  if (alloc_ref === undefined) {
    // zero-sized access
    // assert_matches!(src.next(), None, "iterator said it was empty but returned an element"): `len` is 0.
    return interp_ok(undefined);
  }

  // Side-step AllocRef and directly access the underlying bytes more efficiently.
  // (We are staying inside the bounds here and all bytes do get overwritten so all is good.)
  const bytes = alloc_ref.alloc.get_bytes_unchecked_for_overwrite(alloc_ref.tcx, alloc_ref.range);
  // `zip` would stop when the first iterator ends; we want to definitely
  // cover all of `bytes`.
  // PORT: `src.next().expect("iterator was shorter than it said it would be")` and the final
  // `assert_matches!(src.next(), None, "iterator was longer than it said it would be")` hold: `bytes.len() == len`.
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = src_[i]!;
  }
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1475 mem_copy
InterpCx.prototype.mem_copy = function (this: InterpCx, src: Pointer<CtfeProvenance | undefined>, dest: Pointer<CtfeProvenance | undefined>, size: Size, nonoverlapping: boolean): InterpResult {
  return this.mem_copy_repeatedly(src, dest, size, 1n, nonoverlapping);
};

/// Performs `num_copies` many copies of `size` many bytes from `src` to `dest + i*size` (where
/// `i` is the index of the copy).
///
/// Either `nonoverlapping` must be true or `num_copies` must be 1; doing repeated copies that
/// may overlap is not supported.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1490 mem_copy_repeatedly
InterpCx.prototype.mem_copy_repeatedly = function (this: InterpCx, src: Pointer<CtfeProvenance | undefined>, dest: Pointer<CtfeProvenance | undefined>, size: Size, num_copies: bigint, nonoverlapping: boolean): InterpResult {
  const tcx = this.tcx;
  // We need to do our own bounds-checks.
  const src_parts_r = this.get_ptr_access(src, size);
  if (src_parts_r.$ === "Err") return src_parts_r;
  const src_parts = src_parts_r._0;
  const dest_parts_r = this.get_ptr_access(dest, size.mul(num_copies)); // `Size` multiplication
  if (dest_parts_r.$ === "Err") return dest_parts_r;
  const dest_parts = dest_parts_r._0;

  // Similar to `get_ptr_alloc`, we need to call `before_alloc_access` even for zero-sized
  // reads. However, just like in `get_ptr_alloc_mut`, the write part is okay to skip for
  // zero-sized writes.
  const t = this.ptr_try_get_alloc_id(src, size.bytes_u64());
  if (t.$ === "Ok") {
    const [alloc_id] = t._0;
    const h = this.machine.before_alloc_access(tcx, this.machine, alloc_id);
    if (h.$ === "Err") return h;
  }

  // FIXME: we look up both allocations twice here, once before for the `check_ptr_access`
  // and once below to get the underlying `&[mut] Allocation`.

  // Source alloc preparations and access hooks.
  if (src_parts === undefined) {
    // Zero-sized *source*, that means dest is also zero-sized and we have nothing to do.
    return interp_ok(undefined);
  }
  const [src_alloc_id, src_offset, src_prov] = src_parts;
  const src_alloc_r = this.get_alloc_raw(src_alloc_id);
  if (src_alloc_r.$ === "Err") return src_alloc_r;
  const src_alloc = src_alloc_r._0;
  const src_range = alloc_range(src_offset, size);
  assert(!this.memory.ghost_mode, "we can't be copying during validation");

  // Trigger read hook.
  // For the overlapping case, it is crucial that we trigger the read hook
  // before the write hook -- the aliasing model cares about the order.
  const rh = this.machine.before_memory_read(tcx, this.machine, src_alloc.extra, src, [src_alloc_id, src_prov], src_range);
  if (rh.$ === "Err") return rh;
  // We need the `dest` ptr for the next operation, so we get it now.
  // We already did the source checks and called the hooks so we are good to return early.
  if (dest_parts === undefined) {
    // Zero-sized *destination*.
    return interp_ok(undefined);
  }
  const [dest_alloc_id, dest_offset, dest_prov] = dest_parts;

  // Prepare getting source provenance.
  const src_bytes = src_alloc.get_bytes_unchecked(src_range); // raw ptr, so we can also get a ptr to the destination allocation
  // First copy the provenance to a temporary buffer, because
  // `get_bytes_unchecked_for_overwrite_ptr` will clear the provenance (in preparation for
  // inserting the new provenance), and that can overlap with the source range.
  const provenance = src_alloc.provenance_prepare_copy(src_range, this);
  // Prepare a copy of the initialization mask.
  const init = src_alloc.init_mask_().prepare_copy(src_range);

  // Destination alloc preparations...
  const d = this.get_alloc_raw_mut(dest_alloc_id);
  if (d.$ === "Err") return d;
  const [dest_alloc, machine] = d._0;
  const dest_range = alloc_range(dest_offset, size.mul(num_copies));
  // ...and access hooks.
  const ah = machine.before_alloc_access(tcx, machine, dest_alloc_id);
  if (ah.$ === "Err") return ah;
  const wh = machine.before_memory_write(tcx, machine, dest_alloc.extra, dest, [dest_alloc_id, dest_prov], dest_range);
  if (wh.$ === "Err") return wh;
  // Yes we do overwrite all bytes in `dest_bytes`.
  const dest_bytes = dest_alloc.get_bytes_unchecked_for_overwrite_ptr(tcx, dest_range);

  if (init.no_bytes_init()) {
    // Fast path: If all bytes are `uninit` then there is nothing to copy. The target range
    // is marked as uninitialized but we otherwise omit changing the byte representation which may
    // be arbitrary for uninitialized bytes.
    // This also avoids writing to the target bytes so that the backing allocation is never
    // touched if the bytes stay uninitialized for the whole interpreter execution. On contemporary
    // operating system this can avoid physically allocating the page.
    dest_alloc.write_uninit(tcx, dest_range);
    // `write_uninit` also resets the provenance, so we are done.
    return interp_ok(undefined);
  }

  // SAFE: The above indexing would have panicked if there weren't at least `size` bytes
  // behind `src` and `dest`. Also, we use the overlapping-safe `ptr::copy` if `src` and
  // `dest` could possibly overlap.
  // The pointers above remain valid even if the `HashMap` table is moved around because they
  // point into the `Vec` storing the bytes.
  // PORT: `src_bytes` / `dest_bytes` are `subarray` views of the allocations' bytes; `TypedArray.set` copies like
  // `ptr::copy` (memmove) when both views share a buffer.
  if (src_alloc_id === dest_alloc_id) {
    if (nonoverlapping) {
      // `Size` additions
      if (
        (src_offset.bytes() <= dest_offset.bytes() && src_offset.add(size).bytes() > dest_offset.bytes()) ||
        (dest_offset.bytes() <= src_offset.bytes() && dest_offset.add(size).bytes() > src_offset.bytes())
      ) {
        // throw_ub_format!("`copy_nonoverlapping` called on overlapping ranges")
        return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format("`copy_nonoverlapping` called on overlapping ranges")));
      }
    }
  }
  if (num_copies > 1n) {
    assert(nonoverlapping, "multi-copy only supported in non-overlapping mode");
  }

  const size_in_bytes = size.bytes_usize();
  // For particularly large arrays (where this is perf-sensitive) it's common that
  // we're writing a single byte repeatedly. So, optimize that case to a memset.
  if (size_in_bytes === 1) {
    // debug_assert!(num_copies >= 1); // we already handled the zero-sized cases above.
    // SAFETY: `src_bytes` would be read from anyway by `copy` below (num_copies >= 1).
    const value = src_bytes[0]!;
    dest_bytes.fill(value, 0, size.mul(num_copies).bytes_usize());
  } else if (src_alloc_id === dest_alloc_id) {
    let dest_ptr = 0;
    for (let _ = 0n; _ < num_copies; _++) {
      // Here we rely on `src` and `dest` being non-overlapping if there is more than
      // one copy.
      dest_bytes.set(src_bytes, dest_ptr); // `ptr::copy(src_bytes, dest_ptr, size_in_bytes)`
      dest_ptr += size_in_bytes;
    }
  } else {
    let dest_ptr = 0;
    for (let _ = 0n; _ < num_copies; _++) {
      dest_bytes.set(src_bytes, dest_ptr); // `ptr::copy_nonoverlapping(src_bytes, dest_ptr, size_in_bytes)`
      dest_ptr += size_in_bytes;
    }
  }

  // PORT: `num_copies` is a `number` for the `apply_copy` fns: `size * num_copies` is a `Size` here (non-zero size).
  // now fill in all the "init" data
  dest_alloc.init_mask_apply_copy(
    init,
    alloc_range(dest_offset, size), // just a single copy (i.e., not full `dest_range`)
    Number(num_copies),
  );
  // copy the provenance to the destination
  dest_alloc.provenance_apply_copy(provenance, alloc_range(dest_offset, size), Number(num_copies));

  return interp_ok(undefined);
};

// ---- Machine pointer introspection. (impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M>) ----

/// Test if this value might be null.
/// If the machine does not support ptr-to-int casts, this is conservative.
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1641 scalar_may_be_null
InterpCx.prototype.scalar_may_be_null = function (this: InterpCx, scalar: Scalar): InterpResult<boolean> {
  const r = Scalar.try_to_scalar_int(scalar);
  if (r.$ === "Ok") {
    const int = r._0;
    return interp_ok(int.is_null());
  } else {
    // We can't cast this pointer to an integer. Can only happen during CTFE.
    const ptr = Scalar.to_pointer(scalar, this);
    const t = this.ptr_try_get_alloc_id(ptr, 0n);
    if (t.$ === "Ok") {
      const [alloc_id, offset, _] = t._0;
      const info = this.get_alloc_info(alloc_id);
      if (info.kind === AllocKind.TypeId) {
        // We *could* actually precisely answer this question since here,
        // the offset *is* the integer value. But the entire point of making
        // this a pointer is not to leak the integer value, so we say everything
        // might be null.
        return interp_ok(true);
      }
      // If the pointer is in-bounds (including "at the end"), it is definitely not null.
      if (offset.bytes_u64() <= info.size.bytes_u64()) {
        return interp_ok(false);
      }
      // If the allocation is N-aligned, and the offset is not divisible by N,
      // then `base + offset` has a non-zero remainder after division by `N`,
      // which means `base + offset` cannot be null.
      if (offset.bytes_u64() % BigInt(info.align.bytes()) !== 0n) {
        return interp_ok(false);
      }
      // We don't know enough, this might be null.
      return interp_ok(true);
    } else {
      return bug("a non-int scalar is always a pointer");
    }
  }
};

/// Turning a "maybe pointer" into a proper pointer (and some information
/// about where it points), or an absolute address.
///
/// `size` says how many bytes of memory are expected at that pointer. This is largely only used
/// for error messages; however, the *sign* of `size` can be used to disambiguate situations
/// where a wildcard pointer sits right in between two allocations.
/// It is almost always okay to just set the size to 0; this will be treated like a positive size
/// for handling wildcard pointers.
///
/// The result must be used immediately; it is not allowed to convert
/// the returned data back into a `Pointer` and store that in machine state.
/// (In fact that's not even possible since `M::ProvenanceExtra` is generic and
/// we don't have an operation to turn it back into `M::Provenance`.)
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1689 ptr_try_get_alloc_id
InterpCx.prototype.ptr_try_get_alloc_id = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: bigint): Result<[AllocId, Size, boolean], bigint> {
  const p = ptr.into_pointer_or_addr<CtfeProvenance>();
  if (p.$ === "Ok") {
    const ptr_ = p._0;
    const r = this.machine.ptr_get_alloc(this, ptr_, size);
    if (r !== undefined) {
      const [alloc_id, offset, extra] = r;
      return Ok<[AllocId, Size, boolean]>([alloc_id, offset, extra]);
    } else {
      assert(Provenance_CtfeProvenance.OFFSET_IS_ADDR, "assertion failed: M::Provenance::OFFSET_IS_ADDR");
      // Offset is absolute, as we just asserted.
      const [_1, addr] = ptr_.into_raw_parts();
      return Err(addr.bytes_u64());
    }
  } else {
    const addr = p._0;
    return Err(addr.bytes_u64());
  }
};

/// Turning a "maybe pointer" into a proper pointer (and some information about where it points).
///
/// `size` says how many bytes of memory are expected at that pointer. This is largely only used
/// for error messages; however, the *sign* of `size` can be used to disambiguate situations
/// where a wildcard pointer sits right in between two allocations.
/// It is almost always okay to just set the size to 0; this will be treated like a positive size
/// for handling wildcard pointers.
///
/// The result must be used immediately; it is not allowed to convert
/// the returned data back into a `Pointer` and store that in machine state.
/// (In fact that's not even possible since `M::ProvenanceExtra` is generic and
/// we don't have an operation to turn it back into `M::Provenance`.)
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/memory.rs:1721 ptr_get_alloc_id
InterpCx.prototype.ptr_get_alloc_id = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, size: bigint): InterpResult<[AllocId, Size, boolean]> {
  const r = this.ptr_try_get_alloc_id(ptr, size);
  if (r.$ === "Err") {
    const addr = r._0;
    return Err(
      InterpErrorInfo_from_InterpErrorKind(
        err_ub({ $: "DanglingIntPointer", addr: i64_number(addr), inbounds_size: i64_number(size), msg: { $: "Dereferenceable", _0: "pointer" } }),
      ),
    );
  }
  return interp_ok(r._0);
};

// ---- helpers ----

const U64_MAX = (1n << 64n) - 1n;

/** `err_ub!(X)` */
function err_ub(info: UndefinedBehaviorInfo): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: info };
}
/** `err_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function err_ub_format(msg: string): InterpErrorKind {
  return err_ub({ $: "Ub", _0: msg });
}
/** `err_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function err_unsup_format(msg: string): InterpErrorKind {
  return { $: "Unsupported", _0: { $: "Unsupported", _0: msg } };
}

/** PORT: an `u64` / `i64` field of `UndefinedBehaviorInfo` (a `number` in error.gen.ts); never rounded (header). */
function i64_number(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) {
    return unported("rustc_middle::mir::interpret::UndefinedBehaviorInfo u64/i64 field beyond 2^53 (a number in error.gen.ts)");
  }
  return Number(v);
}

/** `u64::trailing_zeros` (of a non-zero value). */
function trailing_zeros_u64(v: bigint): bigint {
  let n = 0n;
  while ((v & 1n) === 0n && n < 64n) {
    v >>= 1n;
    n++;
  }
  return n;
}
