// Port of compiler/rustc_middle/src/mir/interpret/pointer.rs (lane mir-contract, plan-m4 D3 / D8). `Pointer<Prov>` is a
// generated class (pointer.gen.ts, set rustc_middle_mir); `CtfeProvenance` is hand-written below. Every fn is a stub for
// lane mir-interp-b (docs/handoff/mir-contract.md "How to fill a stub").
//
// PORT (D8): `CtfeProvenance(NonZero<u64>)` packs the `AllocId` with two flag bits (62, 63): a branded `bigint` (PORTING §5
// `u64`); `AllocId` is a branded number. The two `Provenance` impls are the descriptors `Provenance_CtfeProvenance` /
// `Provenance_AllocId`; generic code over `Prov: Provenance` gets its descriptor from the value's representation
// (`provenance_of(prov)`: a bigint is a `CtfeProvenance`, a number an `AllocId`), so the generated `debug_Pointer(v, f,
// debug_Prov)` keeps the generated call shape. Miri's provenance (M6) re-generalises this.
// PORT: `u64` / `i64` values that can exceed 2^53 (target `usize` / `isize` bounds, raw addresses) are `bigint`s; `Size`
// stays a number (abi-lib decision).
// PORT: `PointerArithmetic` (`impl<T: HasDataLayout> PointerArithmetic for T`) is `PointerArithmetic_provided`, its
// provided methods taking the `HasDataLayout` as `self`.
import "../mod.ts";
import type { HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import type { Debug, Fmt } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { AllocId } from "./mod.ts";
import { Pointer } from "./pointer.gen.ts";
export * from "./pointer.gen.ts";

////////////////////////////////////////////////////////////////////////////////
// Pointer arithmetic
////////////////////////////////////////////////////////////////////////////////

// rustc-trait: compiler/rustc_middle/src/mir/interpret/pointer.rs:16 PointerArithmetic
/** `PointerArithmetic: HasDataLayout`, implemented for every `HasDataLayout` (the methods are all provided). */
export type PointerArithmetic = HasDataLayout;
export const PointerArithmetic_provided = {
  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:18 pointer_size (lane mir-interp-b)
  pointer_size(self: HasDataLayout): Size {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::pointer_size");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:23 max_size_of_val (lane mir-interp-b)
  max_size_of_val(self: HasDataLayout): Size {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::max_size_of_val");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:28 target_usize_max (lane mir-interp-b)
  target_usize_max(self: HasDataLayout): bigint {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::target_usize_max");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:33 target_isize_min (lane mir-interp-b)
  target_isize_min(self: HasDataLayout): bigint {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::target_isize_min");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:38 target_isize_max (lane mir-interp-b)
  target_isize_max(self: HasDataLayout): bigint {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::target_isize_max");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:43 truncate_to_target_usize (lane mir-interp-b)
  truncate_to_target_usize(self: HasDataLayout, val: bigint): bigint {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::truncate_to_target_usize");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:48 sign_extend_to_target_isize (lane mir-interp-b)
  sign_extend_to_target_isize(self: HasDataLayout, val: bigint): bigint {
    return unported("rustc_middle::mir::interpret::pointer::PointerArithmetic::sign_extend_to_target_isize");
  },
};

// rustc-trait: compiler/rustc_middle/src/mir/interpret/pointer.rs:59 Provenance
/// This trait abstracts over the kind of provenance that is associated with a `Pointer`. It is
/// mostly opaque; the `Machine` trait extends it with some more operations that also have access to
/// some global state.
/// The `Debug` rendering is used to display bare provenance, and for the default impl of `fmt`.
export interface Provenance<P> {
  /// Says whether the `offset` field of `Pointer`s with this provenance is the actual physical address.
  readonly OFFSET_IS_ADDR: boolean;
  /// If wildcard provenance is implemented, contains the unique, general wildcard provenance variant.
  readonly WILDCARD: P | undefined;
  /// Determines how a pointer should be printed.
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:73 fmt
  fmt(ptr: Pointer<P>, f: Fmt): string;
  /// If `OFFSET_IS_ADDR == false`, provenance must always be able to
  /// identify the allocation this ptr points to (i.e., this must return `Some`).
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:79 get_alloc_id
  get_alloc_id(self: P): AllocId | undefined;
}

/** PORT: the `Provenance` impl of a provenance value, by its representation (see the header). */
export function provenance_of<P>(prov: P): Provenance<P> {
  return (typeof prov === "bigint" ? Provenance_CtfeProvenance : Provenance_AllocId) as unknown as Provenance<P>;
}

/// The type of provenance in the compile-time interpreter.
/// This is a packed representation of:
/// - an `AllocId` (non-zero)
/// - an `immutable: bool`
/// - a `shared_ref: bool`
///
/// with the extra invariant that if `immutable` is `true`, then so
/// is `shared_ref`.
// rustc-type: compiler/rustc_middle/src/mir/interpret/pointer.rs:91 CtfeProvenance
export type CtfeProvenance = bigint & { readonly __brand: "CtfeProvenance" };
export interface CtfeProvenance_methods {
  // pointer.rs:121
  alloc_id(self: CtfeProvenance): AllocId;
  // pointer.rs:127
  immutable(self: CtfeProvenance): boolean;
  // pointer.rs:133
  shared_ref(self: CtfeProvenance): boolean;
  // pointer.rs:137
  into_parts(self: CtfeProvenance): [AllocId, boolean, boolean];
  // pointer.rs:141
  from_parts(parts: [AllocId, boolean, boolean]): CtfeProvenance;
  // pointer.rs:155
  as_immutable(self: CtfeProvenance): CtfeProvenance;
  // pointer.rs:161
  as_shared_ref(self: CtfeProvenance): CtfeProvenance;
}
export const CtfeProvenance = {} as CtfeProvenance_methods;
/** derive(Clone) of a `Copy` value. */
export function clone_CtfeProvenance(v: CtfeProvenance): CtfeProvenance {
  return v;
}

// impl From<AllocId> for CtfeProvenance
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:94 from (lane mir-interp-b)
export function CtfeProvenance_from_AllocId(value: AllocId): CtfeProvenance {
  return unported("rustc_middle::mir::interpret::pointer::<CtfeProvenance as From<AllocId>>::from");
}

// impl fmt::Debug for CtfeProvenance
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:105 fmt (lane mir-interp-b)
export const debug_CtfeProvenance: Debug<CtfeProvenance> = (self, f) => {
  return unported("rustc_middle::mir::interpret::pointer::<CtfeProvenance as Debug>::fmt");
};

const IMMUTABLE_MASK = 1n << 63n; // the highest bit
const SHARED_REF_MASK = 1n << 62n;
const ALLOC_ID_MASK = ((1n << 64n) - 1n) & ~IMMUTABLE_MASK & ~SHARED_REF_MASK;

/// Returns the `AllocId` of this provenance.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:121 alloc_id (lane mir-interp-b)
CtfeProvenance.alloc_id = function (self: CtfeProvenance): AllocId {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::alloc_id");
};

/// Returns whether this provenance is immutable.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:127 immutable (lane mir-interp-b)
CtfeProvenance.immutable = function (self: CtfeProvenance): boolean {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::immutable");
};

/// Returns whether this provenance is derived from a shared reference.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:133 shared_ref (lane mir-interp-b)
CtfeProvenance.shared_ref = function (self: CtfeProvenance): boolean {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::shared_ref");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:137 into_parts (lane mir-interp-b)
CtfeProvenance.into_parts = function (self: CtfeProvenance): [AllocId, boolean, boolean] {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::into_parts");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:141 from_parts (lane mir-interp-b)
CtfeProvenance.from_parts = function ([alloc_id, immutable, shared_ref]: [AllocId, boolean, boolean]): CtfeProvenance {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::from_parts");
};

/// Returns an immutable version of this provenance.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:155 as_immutable (lane mir-interp-b)
CtfeProvenance.as_immutable = function (self: CtfeProvenance): CtfeProvenance {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::as_immutable");
};

/// Returns a "shared reference" (but not necessarily immutable!) version of this provenance.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:161 as_shared_ref (lane mir-interp-b)
CtfeProvenance.as_shared_ref = function (self: CtfeProvenance): CtfeProvenance {
  return unported("rustc_middle::mir::interpret::pointer::CtfeProvenance::as_shared_ref");
};

// impl Provenance for CtfeProvenance
export const Provenance_CtfeProvenance: Provenance<CtfeProvenance> = {
  // With the `AllocId` as provenance, the `offset` is interpreted *relative to the allocation*,
  // so ptr-to-int casts are not possible (since we do not know the global physical offset).
  OFFSET_IS_ADDR: false,

  // `CtfeProvenance` does not implement wildcard provenance.
  WILDCARD: undefined,

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:174 fmt (lane mir-interp-b)
  fmt(ptr: Pointer<CtfeProvenance>, f: Fmt): string {
    return unported("rustc_middle::mir::interpret::pointer::<CtfeProvenance as Provenance>::fmt");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:188 get_alloc_id (lane mir-interp-b)
  get_alloc_id(self: CtfeProvenance): AllocId | undefined {
    return unported("rustc_middle::mir::interpret::pointer::<CtfeProvenance as Provenance>::get_alloc_id");
  },
};

// We also need this impl so that one can debug-print `Pointer<AllocId>`
// impl Provenance for AllocId
export const Provenance_AllocId: Provenance<AllocId> = {
  // With the `AllocId` as provenance, the `offset` is interpreted *relative to the allocation*,
  // so ptr-to-int casts are not possible (since we do not know the global physical offset).
  OFFSET_IS_ADDR: false,

  // `AllocId` does not implement wildcard provenance.
  WILDCARD: undefined,

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:202 fmt (lane mir-interp-b)
  fmt(ptr: Pointer<AllocId>, f: Fmt): string {
    return unported("rustc_middle::mir::interpret::pointer::<AllocId as Provenance>::fmt");
  },

  // stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:216 get_alloc_id (lane mir-interp-b)
  get_alloc_id(self: AllocId): AllocId | undefined {
    return unported("rustc_middle::mir::interpret::pointer::<AllocId as Provenance>::get_alloc_id");
  },
};

declare module "./pointer.gen.ts" {
  interface Pointer<Prov = CtfeProvenance> {
    // pointer.rs:296 (`impl<Prov> Pointer<Option<Prov>>`)
    into_pointer_or_addr<P>(this: Pointer<P | undefined>): Result<Pointer<P>, Size>;
    // pointer.rs:305
    addr<P>(this: Pointer<P | undefined>): Size;
    // pointer.rs:336 (`impl<Prov> Pointer<Prov>`)
    into_raw_parts(): [Prov, Size];
    // pointer.rs:340
    map_provenance(f: (prov: Prov) => Prov): Pointer<Prov>;
    // pointer.rs:345
    wrapping_offset(i: Size, cx: HasDataLayout): Pointer<Prov>;
    // pointer.rs:352
    wrapping_signed_offset(i: bigint, cx: HasDataLayout): Pointer<Prov>;
    // pointer.rs:362 (`impl Pointer<CtfeProvenance>`)
    prov_and_relative_offset(this: Pointer<CtfeProvenance>): [CtfeProvenance, Size];
  }
  namespace Pointer {
    // pointer.rs:316
    export function without_provenance<P>(addr: bigint): Pointer<P | undefined>;
    // pointer.rs:321 (PORT: `null` is a reserved word: `null_`)
    function null_<P>(): Pointer<P | undefined>;
    export { null_ as null };
    // pointer.rs:328
    function new_<P>(provenance: P, offset: Size): Pointer<P>;
    export { new_ as new };
  }
}

// impl<Prov: Provenance> fmt::Debug for Pointer<Prov>
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:239 fmt (lane mir-interp-b)
export function debug_Pointer<Prov>(self: Pointer<Prov>, f: Fmt, debug_Prov: Debug<Prov>): string {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer as Debug>::fmt");
}

// impl<Prov: Provenance> fmt::Display for Pointer<Prov>
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:245 fmt (lane mir-interp-b)
export function display_Pointer<Prov>(self: Pointer<Prov>, f: Fmt): string {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer as Display>::fmt");
}

// impl<Prov: Provenance> fmt::Debug for Pointer<Option<Prov>>
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:251 fmt (lane mir-interp-b)
export function debug_Pointer_Option<Prov>(self: Pointer<Prov | undefined>, f: Fmt, debug_Prov: Debug<Prov>): string {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer<Option<Prov>> as Debug>::fmt");
}

// impl<Prov: Provenance> fmt::Display for Pointer<Option<Prov>>
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:260 fmt (lane mir-interp-b)
export function display_Pointer_Option<Prov>(self: Pointer<Prov | undefined>, f: Fmt): string {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer<Option<Prov>> as Display>::fmt");
}

/// Produces a `Pointer` that points to the beginning of the `Allocation`.
// impl From<AllocId> for Pointer
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:272 from (lane mir-interp-b)
export function Pointer_from_AllocId(alloc_id: AllocId): Pointer {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer as From<AllocId>>::from");
}

// impl From<CtfeProvenance> for Pointer
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:278 from (lane mir-interp-b)
export function Pointer_from_CtfeProvenance(prov: CtfeProvenance): Pointer {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer as From<CtfeProvenance>>::from");
}

// impl<Prov> From<Pointer<Prov>> for Pointer<Option<Prov>>
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:285 from (lane mir-interp-b)
export function Pointer_Option_from_Pointer<Prov>(ptr: Pointer<Prov>): Pointer<Prov | undefined> {
  return unported("rustc_middle::mir::interpret::pointer::<Pointer<Option<Prov>> as From<Pointer<Prov>>>::from");
}

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:296 into_pointer_or_addr (lane mir-interp-b)
Pointer.prototype.into_pointer_or_addr = function <P>(this: Pointer<P | undefined>): Result<Pointer<P>, Size> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::into_pointer_or_addr");
};

/// The addr of a pointer is only meaningful if the provenance has `OFFSET_IS_ADDR`.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:305 addr (lane mir-interp-b)
Pointer.prototype.addr = function <P>(this: Pointer<P | undefined>): Size {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::addr");
};

/// Creates a pointer to the given address, with invalid provenance (i.e., cannot be used for
/// any memory access).
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:316 without_provenance (lane mir-interp-b)
(Pointer as unknown as { without_provenance: typeof Pointer.without_provenance }).without_provenance = function <P>(addr: bigint): Pointer<P | undefined> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::without_provenance");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:321 null (lane mir-interp-b)
(Pointer as unknown as { null: typeof Pointer.null }).null = function <P>(): Pointer<P | undefined> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::null");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:328 new (lane mir-interp-b)
(Pointer as unknown as { new: typeof Pointer.new }).new = function <P>(provenance: P, offset: Size): Pointer<P> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::new");
};

/// Obtain the constituents of this pointer. Not that the meaning of the offset depends on the type `Prov`!
/// This function must only be used in the implementation of `Machine::ptr_get_alloc`,
/// and when a `Pointer` is taken apart to be stored efficiently in an `Allocation`.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:336 into_raw_parts (lane mir-interp-b)
Pointer.prototype.into_raw_parts = function <Prov>(this: Pointer<Prov>): [Prov, Size] {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::into_raw_parts");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:340 map_provenance (lane mir-interp-b)
Pointer.prototype.map_provenance = function <Prov>(this: Pointer<Prov>, f: (prov: Prov) => Prov): Pointer<Prov> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::map_provenance");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:345 wrapping_offset (lane mir-interp-b)
Pointer.prototype.wrapping_offset = function <Prov>(this: Pointer<Prov>, i: Size, cx: HasDataLayout): Pointer<Prov> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::wrapping_offset");
};

// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:352 wrapping_signed_offset (lane mir-interp-b)
Pointer.prototype.wrapping_signed_offset = function <Prov>(this: Pointer<Prov>, i: bigint, cx: HasDataLayout): Pointer<Prov> {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::wrapping_signed_offset");
};

/// Return the provenance and relative offset stored in this pointer. Safer alternative to
/// `into_raw_parts` since the type ensures that the offset is indeed relative.
// stub: compiler/rustc_middle/src/mir/interpret/pointer.rs:362 prov_and_relative_offset (lane mir-interp-b)
Pointer.prototype.prov_and_relative_offset = function (this: Pointer<CtfeProvenance>): [CtfeProvenance, Size] {
  return unported("rustc_middle::mir::interpret::pointer::Pointer::prov_and_relative_offset");
};

/** (the masks of pointer.rs:114-116, for the lane) */
export const CtfeProvenance_masks = { IMMUTABLE_MASK, SHARED_REF_MASK, ALLOC_ID_MASK };
