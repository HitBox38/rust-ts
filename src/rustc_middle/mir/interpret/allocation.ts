// Port of compiler/rustc_middle/src/mir/interpret/allocation.rs (lane mir-contract, plan-m4 D3 / D8). The file's types are
// generated into allocation.gen.ts (set rustc_middle_mir) but for `Allocation` and `ConstAllocation`, hand classes below.
// Every fn is a stub for lane mir-interp-a (docs/handoff/mir-contract.md "How to fill a stub").
// PORT (D8): `Bytes = Box<[u8]>` is a `Uint8Array` (`AllocBytes_Box`); byte slices handed out (`&[u8]`, `&mut [u8]`,
// `*mut u8`) are `Uint8Array` views (`subarray`), so writes go to the allocation. `Prov` stays a type parameter (default
// `CtfeProvenance`), `Extra = ()` is `null`. `<Bytes as AllocBytes>::AllocParams` (`()` for `Box<[u8]>`) is `null`.
// PORT: `Allocation::init_mask()` / `provenance()` are `init_mask_()` / `provenance_()` (the private fields hold the names;
// mod.ts header). `ConstAllocation(Interned<Allocation>)` is a frozen class extending `Interned` (plan-m3 D2), made only
// by `TyCtxt::mk_const_alloc` (`internee` = `self.0.0`); the allocation itself is not deep-frozen (typed arrays cannot be).
//! The virtual memory representation of the MIR interpreter.
import "../mod.ts";
import type { Align, HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import type { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { Interned } from "../../../rustc_data_structures/intern.ts";
import type { Debug } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { Hasher } from "../../../vendor/rustc_stable_hash/lib.ts";
import type { TyDecoder } from "../../ty/codec.ts";
import type { Range } from "../../ty/decls.ts";
import * as gen from "./allocation.gen.ts";
import { AllocRange, type AllocFlags, type AllocInit, type AllocResult } from "./allocation.gen.ts";
import { clone_InitMask, type InitCopy, type InitMask } from "./allocation/init_mask.ts";
import { clone_ProvenanceMap, type ProvenanceCopy, type ProvenanceMap } from "./allocation/provenance_map.ts";
import type { InterpErrorKind, InterpResult } from "./error.ts";
import type { AllocId } from "./mod.ts";
import type { CtfeProvenance, Pointer } from "./pointer.ts";
import type { Scalar } from "./value.ts";
export * from "./allocation.gen.ts";
export * from "./allocation/init_mask.ts";
export * from "./allocation/provenance_map.ts";

// rustc-trait: compiler/rustc_middle/src/mir/interpret/allocation.rs:30 AllocBytes
/// Functionality required for the bytes of an `Allocation`.
/** PORT: the trait as a descriptor over the bytes type `B` (`AllocParams` is `null` for `Box<[u8]>`). */
export interface AllocBytes<B> {
  /// Create an `AllocBytes` from a slice of `u8`.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:37 from_bytes
  from_bytes(slice: Uint8Array, _align: Align, _params: null): B;
  /// Create a zeroed `AllocBytes` of the specified size and alignment.
  /// Returns `None` if we ran out of memory on the host.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:45 zeroed
  zeroed(size: Size, _align: Align, _params: null): B | undefined;
  /// Gives direct access to the raw underlying storage.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:52 as_mut_ptr
  as_mut_ptr(self: B): Uint8Array;
  /// Gives direct access to the raw underlying storage.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:59 as_ptr
  as_ptr(self: B): Uint8Array;
}

/// Default `bytes` for `Allocation` is a `Box<u8>`.
// impl AllocBytes for Box<[u8]>
export const AllocBytes_Box: AllocBytes<Uint8Array> = {
  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:66 from_bytes (lane mir-interp-a)
  from_bytes(slice: Uint8Array, _align: Align, _params: null): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::<Box<[u8]> as AllocBytes>::from_bytes");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:70 zeroed (lane mir-interp-a)
  zeroed(size: Size, _align: Align, _params: null): Uint8Array | undefined {
    return unported("rustc_middle::mir::interpret::allocation::<Box<[u8]> as AllocBytes>::zeroed");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:77 as_mut_ptr (lane mir-interp-a)
  as_mut_ptr(self: Uint8Array): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::<Box<[u8]> as AllocBytes>::as_mut_ptr");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:81 as_ptr (lane mir-interp-a)
  as_ptr(self: Uint8Array): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::<Box<[u8]> as AllocBytes>::as_ptr");
  },
};

/// This type represents an Allocation in the Miri/CTFE core engine.
///
/// Its public API is rather low-level, working directly with allocation offsets and a custom error
/// type to account for the lack of an AllocId on this level. The Miri/CTFE core engine `memory`
/// module provides higher-level access.
// rustc-type: compiler/rustc_middle/src/mir/interpret/allocation.rs:95 Allocation
export class Allocation<Prov = CtfeProvenance, Extra = null, Bytes = Uint8Array> {
  constructor(
    /// The actual bytes of the allocation.
    /// Note that the bytes of a pointer represent the offset of the pointer.
    public bytes: Bytes,
    /// Maps from byte addresses to extra provenance data for each pointer.
    public provenance: ProvenanceMap<Prov>,
    /// Denotes which part of this allocation is initialized.
    public init_mask: InitMask,
    /// The alignment of the allocation to detect unaligned reads.
    public align: Align,
    /// `true` if the allocation is mutable.
    public mutability: Mutability,
    /// Extra state for the machine.
    public extra: Extra,
  ) {}

  // ---- impl<Prov: Provenance, Bytes: AllocBytes> Allocation<Prov, (), Bytes> ----
  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:390 from_bytes (lane mir-interp-a)
  static from_bytes<Prov = CtfeProvenance, Bytes = Uint8Array>(slice: Uint8Array, align: Align, mutability: Mutability, params: null): Allocation<Prov, null, Bytes> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::from_bytes");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:408 from_bytes_byte_aligned_immutable (lane mir-interp-a)
  static from_bytes_byte_aligned_immutable<Prov = CtfeProvenance, Bytes = Uint8Array>(slice: Uint8Array, params: null): Allocation<Prov, null, Bytes> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::from_bytes_byte_aligned_immutable");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:415 new_inner (lane mir-interp-a)
  static new_inner<Prov, Bytes, R>(size: Size, align: Align, init: AllocInit, params: null, fail: () => R): Result<Allocation<Prov, null, Bytes>, R> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::new_inner");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:448 try_new (lane mir-interp-a)
  static try_new<Prov = CtfeProvenance, Bytes = Uint8Array>(size: Size, align: Align, init: AllocInit, params: null): InterpResult<Allocation<Prov, null, Bytes>> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::try_new");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:466 new (lane mir-interp-a)
  static new<Prov = CtfeProvenance, Bytes = Uint8Array>(size: Size, align: Align, init: AllocInit, params: null): Allocation<Prov, null, Bytes> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::new");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:489 with_extra (lane mir-interp-a)
  with_extra<E2>(this: Allocation<Prov, null, Bytes>, extra: E2): Allocation<Prov, E2, Bytes> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::with_extra");
  }

  // ---- impl Allocation ----
  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:504 adjust_from_tcx (lane mir-interp-a)
  adjust_from_tcx<P2, B2>(this: Allocation, cx: HasDataLayout, alloc_bytes: (bytes: Uint8Array, align: Align) => InterpResult<B2>, adjust_ptr: (ptr: Pointer<CtfeProvenance>) => InterpResult<Pointer<P2>>): InterpResult<Allocation<P2, null, B2>> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::adjust_from_tcx");
  }

  // ---- impl<Prov: Provenance, Extra, Bytes: AllocBytes> Allocation<Prov, Extra, Bytes> ----
  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:539 len (lane mir-interp-a)
  len(): number {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::len");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:543 size (lane mir-interp-a)
  size(): Size {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::size");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:551 inspect_with_uninit_and_ptr_outside_interpreter (lane mir-interp-a)
  inspect_with_uninit_and_ptr_outside_interpreter(range: Range<number>): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::inspect_with_uninit_and_ptr_outside_interpreter");
  }

  // PORT: `init_mask()`: the field `init_mask` holds the name
  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:556 init_mask (lane mir-interp-a)
  init_mask_(): InitMask {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::init_mask_");
  }

  // PORT: `provenance()`: the field `provenance` holds the name
  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:561 provenance (lane mir-interp-a)
  provenance_(): ProvenanceMap<Prov> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::provenance_");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:575 get_bytes_unchecked (lane mir-interp-a)
  get_bytes_unchecked(range: AllocRange): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::get_bytes_unchecked");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:586 get_bytes_strip_provenance (lane mir-interp-a)
  get_bytes_strip_provenance(cx: HasDataLayout, range: AllocRange): AllocResult<Uint8Array> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::get_bytes_strip_provenance");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:621 get_bytes_unchecked_for_overwrite (lane mir-interp-a)
  get_bytes_unchecked_for_overwrite(cx: HasDataLayout, range: AllocRange): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::get_bytes_unchecked_for_overwrite");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:634 get_bytes_unchecked_for_overwrite_ptr (lane mir-interp-a)
  get_bytes_unchecked_for_overwrite_ptr(cx: HasDataLayout, range: AllocRange): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::get_bytes_unchecked_for_overwrite_ptr");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:652 get_bytes_unchecked_raw_mut (lane mir-interp-a)
  get_bytes_unchecked_raw_mut(): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::get_bytes_unchecked_raw_mut");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:660 get_bytes_unchecked_raw (lane mir-interp-a)
  get_bytes_unchecked_raw(): Uint8Array {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::get_bytes_unchecked_raw");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:669 mark_init (lane mir-interp-a)
  mark_init(range: AllocRange, is_init: boolean): void {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::mark_init");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:687 read_scalar (lane mir-interp-a)
  read_scalar(cx: HasDataLayout, range: AllocRange, read_provenance: boolean): AllocResult<Scalar<Prov>> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::read_scalar");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:735 write_scalar (lane mir-interp-a)
  write_scalar(cx: HasDataLayout, range: AllocRange, val: Scalar<Prov>): AllocResult<undefined> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::write_scalar");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:768 write_uninit (lane mir-interp-a)
  write_uninit(cx: HasDataLayout, range: AllocRange): void {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::write_uninit");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:779 process_native_write (lane mir-interp-a)
  process_native_write(cx: HasDataLayout, range: AllocRange | undefined): void {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::process_native_write");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:789 clear_provenance (lane mir-interp-a)
  clear_provenance(cx: HasDataLayout, range: AllocRange): void {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::clear_provenance");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:793 provenance_merge_bytes (lane mir-interp-a)
  provenance_merge_bytes(cx: HasDataLayout): boolean {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::provenance_merge_bytes");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:797 provenance_prepare_copy (lane mir-interp-a)
  provenance_prepare_copy(range: AllocRange, cx: HasDataLayout): ProvenanceCopy<Prov> {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::provenance_prepare_copy");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:810 provenance_apply_copy (lane mir-interp-a)
  provenance_apply_copy(copy: ProvenanceCopy<Prov>, range: AllocRange, repeat: number): void {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::provenance_apply_copy");
  }

  // stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:823 init_mask_apply_copy (lane mir-interp-a)
  init_mask_apply_copy(copy: InitCopy, range: AllocRange, repeat: number): void {
    return unported("rustc_middle::mir::interpret::allocation::Allocation::init_mask_apply_copy");
  }
}
/** derive(Clone) of `Allocation` (a hand class): field by field. */
export function clone_Allocation<Prov, Extra, Bytes>(v: Allocation<Prov, Extra, Bytes>, clone_Prov: (v: Prov) => Prov, clone_Extra: (v: Extra) => Extra, clone_Bytes: (v: Bytes) => Bytes): Allocation<Prov, Extra, Bytes> {
  return new Allocation(clone_Bytes(v.bytes), clone_ProvenanceMap(v.provenance, clone_Prov), clone_InitMask(v.init_mask), v.align, v.mutability, clone_Extra(v.extra));
}

// rustc-skip: compiler/rustc_middle/src/mir/interpret/allocation.rs:129 encode Encodable (metadata encoding, M5)

// impl<D: Decoder> Decodable<D> for AllocFlags
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:148 decode (lane mir-interp-a)
export function decode_AllocFlags(decoder: TyDecoder): AllocFlags {
  return unported("rustc_middle::mir::interpret::allocation::<AllocFlags as Decodable>::decode");
}

/// Efficiently detect whether a slice of `u8` is all zero.
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:171 all_zero (lane mir-interp-a)
function all_zero(buf: Uint8Array): boolean {
  return unported("rustc_middle::mir::interpret::allocation::all_zero");
}

// rustc-skip: compiler/rustc_middle/src/mir/interpret/allocation.rs:194 encode Encodable (metadata encoding, M5)

// impl<Prov: Provenance, Extra, D: Decoder> Decodable<D> for Allocation<Prov, Extra, Box<[u8]>>
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:213 decode (lane mir-interp-a)
export function decode_Allocation<Prov, Extra>(decoder: TyDecoder, decode_Prov: (d: TyDecoder) => Prov, decode_Extra: (d: TyDecoder) => Extra): Allocation<Prov, Extra, Uint8Array> {
  return unported("rustc_middle::mir::interpret::allocation::<Allocation as Decodable>::decode");
}

// impl hash::Hash for Allocation
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:244 hash (lane mir-interp-a)
export function hash_Allocation(self: Allocation, state: Hasher): void {
  return unported("rustc_middle::mir::interpret::allocation::<Allocation as Hash>::hash");
}

/// Interned types generally have an `Outer` type and an `Inner` type, where
/// `Outer` is a newtype around `Interned<Inner>`, and all the operations are
/// done on `Outer`, because all occurrences are interned. E.g. `Ty` is an
/// outer type and `TyKind` is its inner type.
// rustc-type: compiler/rustc_middle/src/mir/interpret/allocation.rs:286 ConstAllocation
export class ConstAllocation extends Interned {
  /** PORT: the interned `Allocation` (`self.0.0`). */
  readonly internee: Allocation;

  /** PORT: only `tcx.mk_const_alloc` constructs (plan-m3 D2). */
  constructor(internee: Allocation) {
    super();
    this.internee = internee;
    Object.freeze(this);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:297 inner
  inner(): Allocation {
    return this.internee;
  }
}
/** derive(Clone) of a `Copy` interned handle. */
export function clone_ConstAllocation(v: ConstAllocation): ConstAllocation {
  return v;
}

// impl<'tcx> fmt::Debug for ConstAllocation<'tcx>
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:289 fmt (lane mir-interp-a)
export const debug_ConstAllocation: Debug<ConstAllocation> = (self, f) => {
  return unported("rustc_middle::mir::interpret::allocation::<ConstAllocation as Debug>::fmt");
};

export interface AllocError_methods {
  // allocation.rs:316
  to_interp_error(self: AllocError, alloc_id: AllocId): InterpErrorKind;
}
export type AllocError = gen.AllocError;
export const AllocError = {} as AllocError_methods;
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:316 to_interp_error (lane mir-interp-a)
AllocError.to_interp_error = function (self: AllocError, alloc_id: AllocId): InterpErrorKind {
  return unported("rustc_middle::mir::interpret::allocation::AllocError::to_interp_error");
};

// impl fmt::Display for AllocRange
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:340 fmt (lane mir-interp-a)
export function display_AllocRange(self: AllocRange): string {
  return unported("rustc_middle::mir::interpret::allocation::<AllocRange as Display>::fmt");
}

/// Free-starting constructor for less syntactic overhead.
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:347 alloc_range (lane mir-interp-a)
export function alloc_range(start: Size, size: Size): AllocRange {
  return unported("rustc_middle::mir::interpret::allocation::alloc_range");
}

// impl From<Range<Size>> for AllocRange
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:353 from (lane mir-interp-a)
export function AllocRange_from_Range_Size(r: Range<Size>): AllocRange {
  return unported("rustc_middle::mir::interpret::allocation::<AllocRange as From<Range<Size>>>::from");
}

// impl From<Range<usize>> for AllocRange
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:360 from (lane mir-interp-a)
export function AllocRange_from_Range_usize(r: Range<number>): AllocRange {
  return unported("rustc_middle::mir::interpret::allocation::<AllocRange as From<Range<usize>>>::from");
}

declare module "./allocation.gen.ts" {
  interface AllocRange {
    // allocation.rs:367
    end(): Size;
    // allocation.rs:373
    subrange(subrange: AllocRange): AllocRange;
  }
}
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:367 end (lane mir-interp-a)
AllocRange.prototype.end = function (this: AllocRange): Size {
  return unported("rustc_middle::mir::interpret::allocation::AllocRange::end");
};

/// Returns the `subrange` within this range; panics if it is not a subrange.
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:373 subrange (lane mir-interp-a)
AllocRange.prototype.subrange = function (this: AllocRange, subrange: AllocRange): AllocRange {
  return unported("rustc_middle::mir::interpret::allocation::AllocRange::subrange");
};
