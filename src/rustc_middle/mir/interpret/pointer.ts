// Port of compiler/rustc_middle/src/mir/interpret/pointer.rs (lanes mir-contract, mir-interp-b; plan-m4 D3 / D8).
// `Pointer<Prov>` is a generated class (pointer.gen.ts, set rustc_middle_mir); `CtfeProvenance` is hand-written below.
//
// PORT (D8): `CtfeProvenance(NonZero<u64>)` packs the `AllocId` with two flag bits (62, 63): a branded `bigint` (PORTING §5
// `u64`); `AllocId` is a branded number. The two `Provenance` impls are the descriptors `Provenance_CtfeProvenance` /
// `Provenance_AllocId`; generic code over `Prov: Provenance` gets its descriptor from the value's representation
// (`provenance_of(prov)`: a bigint is a `CtfeProvenance`, a number an `AllocId`), so the generated `debug_Pointer(v, f,
// debug_Prov)` keeps the generated call shape. Miri's provenance (M6) re-generalises this.
// PORT: `Pointer<Option<Prov>>` is a `Pointer<Prov | undefined>`: a `Some(prov)` pointer has the same representation as a
// `Pointer<Prov>` (and prints the same through either impl), a `None` one has `provenance === undefined`.
// PORT: `u64` / `i64` values that can exceed 2^53 (target `usize` / `isize` bounds, raw addresses) are `bigint`s; `Size`
// stays a number (abi-lib decision: a `Size` past 2^53 stops in `Size::from_bytes`).
// PORT: `PointerArithmetic` (`impl<T: HasDataLayout> PointerArithmetic for T`) is `PointerArithmetic_provided`, its
// provided methods taking the `HasDataLayout` as `self`.
import "../mod.ts";
import { type HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import { type Debug, type Fmt, PLAIN, PRETTY } from "../../../std/fmt.ts";
import { assert, panic } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { type AllocId, debug_AllocId } from "./mod.ts";
import { Pointer } from "./pointer.gen.ts";
export * from "./pointer.gen.ts";

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

/** `<u64 / i64 as TryFrom<u128 / i128>>::try_from(v).unwrap()` (the value stays a `bigint`). */
export function try_from_unwrap(v: bigint, min: bigint, max: bigint): bigint {
  if (v < min || v > max) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return v;
}

/** `NonZero::new(v).unwrap()` */
function non_zero_unwrap<T extends number | bigint>(v: T): T {
  if (v === 0 || v === 0n) return panic("called `Option::unwrap()` on a `None` value");
  return v;
}

/** `format!("{:#x}", v)` */
function lower_hex_alt(v: number | bigint): string {
  return `0x${v.toString(16)}`;
}

////////////////////////////////////////////////////////////////////////////////
// Pointer arithmetic
////////////////////////////////////////////////////////////////////////////////

// rustc-trait: compiler/rustc_middle/src/mir/interpret/pointer.rs:16 PointerArithmetic
/** `PointerArithmetic: HasDataLayout`, implemented for every `HasDataLayout` (the methods are all provided). */
export type PointerArithmetic = HasDataLayout;
export const PointerArithmetic_provided = {
  // These are not supposed to be overridden.

  // #[inline(always)]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:18 pointer_size
  pointer_size(self: HasDataLayout): Size {
    return self.data_layout().pointer_size();
  },

  // #[inline(always)]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:23 max_size_of_val
  max_size_of_val(self: HasDataLayout): Size {
    return Size.from_bytes(PointerArithmetic_provided.target_isize_max(self));
  },

  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:28 target_usize_max
  target_usize_max(self: HasDataLayout): bigint {
    return try_from_unwrap(PointerArithmetic_provided.pointer_size(self).unsigned_int_max(), 0n, U64_MAX);
  },

  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:33 target_isize_min
  target_isize_min(self: HasDataLayout): bigint {
    return try_from_unwrap(PointerArithmetic_provided.pointer_size(self).signed_int_min(), I64_MIN, I64_MAX);
  },

  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:38 target_isize_max
  target_isize_max(self: HasDataLayout): bigint {
    return try_from_unwrap(PointerArithmetic_provided.pointer_size(self).signed_int_max(), I64_MIN, I64_MAX);
  },

  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:43 truncate_to_target_usize
  truncate_to_target_usize(self: HasDataLayout, val: bigint): bigint {
    return try_from_unwrap(PointerArithmetic_provided.pointer_size(self).truncate(val), 0n, U64_MAX);
  },

  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:48 sign_extend_to_target_isize
  sign_extend_to_target_isize(self: HasDataLayout, val: bigint): bigint {
    return try_from_unwrap(PointerArithmetic_provided.pointer_size(self).sign_extend(val), I64_MIN, I64_MAX);
  },
};

// rustc-trait: compiler/rustc_middle/src/mir/interpret/pointer.rs:59 Provenance
/// This trait abstracts over the kind of provenance that is associated with a `Pointer`. It is
/// mostly opaque; the `Machine` trait extends it with some more operations that also have access to
/// some global state.
/// The `Debug` rendering is used to display bare provenance, and for the default impl of `fmt`.
export interface Provenance<P> {
  /// Says whether the `offset` field of `Pointer`s with this provenance is the actual physical address.
  /// - If `false`, the offset *must* be relative. This means the bytes representing a pointer are
  ///   different from what the Abstract Machine prescribes, so the interpreter must prevent any
  ///   operation that would inspect the underlying bytes of a pointer, such as ptr-to-int
  ///   transmutation. A `ReadPointerAsBytes` error will be raised in such situations.
  /// - If `true`, the interpreter will permit operations to inspect the underlying bytes of a
  ///   pointer, and implement ptr-to-int transmutation by stripping provenance.
  readonly OFFSET_IS_ADDR: boolean;
  /// If wildcard provenance is implemented, contains the unique, general wildcard provenance variant.
  readonly WILDCARD: P | undefined;
  /// Determines how a pointer should be printed.
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:73 fmt
  fmt(ptr: Pointer<P>, f: Fmt): string;
  /// If `OFFSET_IS_ADDR == false`, provenance must always be able to
  /// identify the allocation this ptr points to (i.e., this must return `Some`).
  /// Otherwise this function is best-effort (but must agree with `Machine::ptr_get_alloc`).
  /// (Identifying the offset in that allocation, however, is harder -- use `Memory::ptr_get_alloc` for that.)
  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:79 get_alloc_id
  get_alloc_id(self: P): AllocId | undefined;
}

/** PORT: the `Provenance` impl of a provenance value, by its representation (see the header). */
export function provenance_of<P>(prov: P): Provenance<P> {
  return (typeof prov === "bigint" ? Provenance_CtfeProvenance : Provenance_AllocId) as unknown as Provenance<P>;
}

/**
 * PORT: `Prov::OFFSET_IS_ADDR` where the pointer has no provenance value to dispatch on (`Pointer<Option<Prov>>::addr`):
 * every `Provenance` impl of the port (`CtfeProvenance`, `AllocId`; Miri's is M6) has `OFFSET_IS_ADDR == false`.
 */
const OFFSET_IS_ADDR_OF_EVERY_PROVENANCE = false;

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
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:94 from
export function CtfeProvenance_from_AllocId(value: AllocId): CtfeProvenance {
  const prov = BigInt(value) as CtfeProvenance;
  assert(
    CtfeProvenance.alloc_id(prov) === value,
    "`AllocId` with the highest bits set cannot be used in CTFE",
  );
  return prov;
}

// impl fmt::Debug for CtfeProvenance
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:105 fmt
export const debug_CtfeProvenance: Debug<CtfeProvenance> = (self, f) => {
  let out = debug_AllocId(CtfeProvenance.alloc_id(self), f); // propagates `alternate` flag
  if (CtfeProvenance.immutable(self)) {
    out += "<imm>";
  }
  return out;
};

const IMMUTABLE_MASK = 1n << 63n; // the highest bit
const SHARED_REF_MASK = 1n << 62n;
const ALLOC_ID_MASK = U64_MAX & ~IMMUTABLE_MASK & ~SHARED_REF_MASK;

/// Returns the `AllocId` of this provenance.
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:121 alloc_id
CtfeProvenance.alloc_id = function (self: CtfeProvenance): AllocId {
  // PORT: `AllocId` is a number; ids are sequential from 1 (`AllocMap::reserve`), far below 2^53.
  return Number(non_zero_unwrap(self & ALLOC_ID_MASK)) as AllocId;
};

/// Returns whether this provenance is immutable.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:127 immutable
CtfeProvenance.immutable = function (self: CtfeProvenance): boolean {
  return (self & IMMUTABLE_MASK) !== 0n;
};

/// Returns whether this provenance is derived from a shared reference.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:133 shared_ref
CtfeProvenance.shared_ref = function (self: CtfeProvenance): boolean {
  return (self & SHARED_REF_MASK) !== 0n;
};

// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:137 into_parts
CtfeProvenance.into_parts = function (self: CtfeProvenance): [AllocId, boolean, boolean] {
  return [CtfeProvenance.alloc_id(self), CtfeProvenance.immutable(self), CtfeProvenance.shared_ref(self)];
};

// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:141 from_parts
CtfeProvenance.from_parts = function ([alloc_id, immutable, shared_ref]: [AllocId, boolean, boolean]): CtfeProvenance {
  const prov = CtfeProvenance_from_AllocId(alloc_id);
  if (immutable) {
    // This sets both flags, so we don't even have to check `shared_ref`.
    return CtfeProvenance.as_immutable(prov);
  } else if (shared_ref) {
    return CtfeProvenance.as_shared_ref(prov);
  } else {
    return prov;
  }
};

/// Returns an immutable version of this provenance.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:155 as_immutable
CtfeProvenance.as_immutable = function (self: CtfeProvenance): CtfeProvenance {
  return (self | IMMUTABLE_MASK | SHARED_REF_MASK) as CtfeProvenance;
};

/// Returns a "shared reference" (but not necessarily immutable!) version of this provenance.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:161 as_shared_ref
CtfeProvenance.as_shared_ref = function (self: CtfeProvenance): CtfeProvenance {
  return (self | SHARED_REF_MASK) as CtfeProvenance;
};

// impl Provenance for CtfeProvenance
export const Provenance_CtfeProvenance: Provenance<CtfeProvenance> = {
  // With the `CtfeProvenance` as provenance, the `offset` is interpreted *relative to the allocation*,
  // so ptr-to-int casts are not possible (since we do not know the global physical offset).
  OFFSET_IS_ADDR: false,

  // `CtfeProvenance` does not implement wildcard provenance.
  WILDCARD: undefined,

  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:174 fmt
  fmt(ptr: Pointer<CtfeProvenance>, f: Fmt): string {
    // Print AllocId.
    let out = debug_AllocId(CtfeProvenance.alloc_id(ptr.provenance), f); // propagates `alternate` flag
    // Print offset only if it is non-zero.
    if (ptr.offset.bytes() > 0) {
      out += `+${lower_hex_alt(ptr.offset.bytes())}`;
    }
    // Print immutable status.
    if (CtfeProvenance.immutable(ptr.provenance)) {
      out += "<imm>";
    }
    return out;
  },

  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:188 get_alloc_id
  get_alloc_id(self: CtfeProvenance): AllocId | undefined {
    return CtfeProvenance.alloc_id(self);
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

  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:202 fmt
  fmt(ptr: Pointer<AllocId>, f: Fmt): string {
    let out: string;
    // Forward `alternate` flag to `alloc_id` printing.
    if (f.alternate) {
      out = debug_AllocId(ptr.provenance, PRETTY);
    } else {
      out = debug_AllocId(ptr.provenance, PLAIN);
    }
    // Print offset only if it is non-zero.
    if (ptr.offset.bytes() > 0) {
      out += `+${lower_hex_alt(ptr.offset.bytes())}`;
    }
    return out;
  },

  // rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:216 get_alloc_id
  get_alloc_id(self: AllocId): AllocId | undefined {
    return self;
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

// We want the `Debug` output to be readable as it is used by `derive(Debug)` for
// all the Miri types.
// impl<Prov: Provenance> fmt::Debug for Pointer<Prov>
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:239 fmt
export function debug_Pointer<Prov>(self: Pointer<Prov>, f: Fmt, debug_Prov: Debug<Prov>): string {
  // PORT: the generated Debug of a `Pointer<Option<AllocId>>` field (`InvalidVTablePointer`) calls this fn; a `None`
  // provenance is the `Pointer<Option<Prov>>` impl below (a `Some` one prints the same through both impls, header).
  if (self.provenance === undefined) {
    return debug_Pointer_Option(self as Pointer<Prov | undefined>, f, debug_Prov);
  }
  return provenance_of(self.provenance as Prov).fmt(self, f);
}

// impl<Prov: Provenance> fmt::Display for Pointer<Prov>
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:245 fmt
export function display_Pointer<Prov>(self: Pointer<Prov>, f: Fmt): string {
  return provenance_of(self.provenance).fmt(self, f);
}

// impl<Prov: Provenance> fmt::Debug for Pointer<Option<Prov>>
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:251 fmt
export function debug_Pointer_Option<Prov>(self: Pointer<Prov | undefined>, f: Fmt, _debug_Prov: Debug<Prov>): string {
  const prov = self.provenance;
  if (prov !== undefined) {
    return provenance_of(prov).fmt(Pointer.new(prov, self.offset), f);
  } else {
    return `${lower_hex_alt(self.offset.bytes())}[noalloc]`;
  }
}

// impl<Prov: Provenance> fmt::Display for Pointer<Option<Prov>>
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:260 fmt
export function display_Pointer_Option<Prov>(self: Pointer<Prov | undefined>, f: Fmt): string {
  if (self.provenance === undefined && self.offset.bytes() === 0) {
    return "null pointer";
  } else {
    return debug_Pointer_Option(self, f, unused_debug as Debug<Prov>);
  }
}
/** The `debug_Prov` argument nothing reads (`Provenance::fmt` prints the provenance). */
const unused_debug: Debug<never> = () => panic("unused");

/// Produces a `Pointer` that points to the beginning of the `Allocation`.
// impl From<AllocId> for Pointer
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:272 from
export function Pointer_from_AllocId(alloc_id: AllocId): Pointer {
  return Pointer.new(CtfeProvenance_from_AllocId(alloc_id), Size.ZERO);
}

// impl From<CtfeProvenance> for Pointer
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:278 from
export function Pointer_from_CtfeProvenance(prov: CtfeProvenance): Pointer {
  return Pointer.new(prov, Size.ZERO);
}

// impl<Prov> From<Pointer<Prov>> for Pointer<Option<Prov>>
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:285 from
export function Pointer_Option_from_Pointer<Prov>(ptr: Pointer<Prov>): Pointer<Prov | undefined> {
  const [prov, offset] = ptr.into_raw_parts();
  return Pointer.new<Prov | undefined>(prov, offset);
}

/// Convert this pointer that *might* have a provenance into a pointer that *definitely* has a
/// provenance, or an absolute address.
///
/// This is rarely what you want; call `ptr_try_get_alloc_id` instead.
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:296 into_pointer_or_addr
Pointer.prototype.into_pointer_or_addr = function <P>(this: Pointer<P | undefined>): Result<Pointer<P>, Size> {
  const prov = this.provenance;
  if (prov !== undefined) {
    return Ok(Pointer.new(prov, this.offset));
  } else {
    return Err(this.offset);
  }
};

/// Returns the absolute address the pointer points to.
/// Only works if Prov::OFFSET_IS_ADDR is true!
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:305 addr
Pointer.prototype.addr = function <P>(this: Pointer<P | undefined>): Size {
  assert(OFFSET_IS_ADDR_OF_EVERY_PROVENANCE, "assertion failed: Prov::OFFSET_IS_ADDR");
  return this.offset;
};

/// Creates a pointer to the given address, with invalid provenance (i.e., cannot be used for
/// any memory access).
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:316 without_provenance
(Pointer as unknown as { without_provenance: typeof Pointer.without_provenance }).without_provenance = function <P>(addr: bigint): Pointer<P | undefined> {
  return new Pointer<P | undefined>(Size.from_bytes(addr), undefined);
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:321 null
(Pointer as unknown as { null: typeof Pointer.null }).null = function <P>(): Pointer<P | undefined> {
  return Pointer.without_provenance<P>(0n);
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:328 new
(Pointer as unknown as { new: typeof Pointer.new }).new = function <P>(provenance: P, offset: Size): Pointer<P> {
  return new Pointer(offset, provenance);
};

/// Obtain the constituents of this pointer. Note that the meaning of the offset depends on the
/// type `Prov`! This is a low-level function that should only be used when absolutely
/// necessary. Prefer `prov_and_relative_offset` if possible.
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:336 into_raw_parts
Pointer.prototype.into_raw_parts = function <Prov>(this: Pointer<Prov>): [Prov, Size] {
  return [this.provenance, this.offset];
};

// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:340 map_provenance
Pointer.prototype.map_provenance = function <Prov>(this: Pointer<Prov>, f: (prov: Prov) => Prov): Pointer<Prov> {
  return new Pointer(this.offset, f(this.provenance));
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:345 wrapping_offset
Pointer.prototype.wrapping_offset = function <Prov>(this: Pointer<Prov>, i: Size, cx: HasDataLayout): Pointer<Prov> {
  const res = PointerArithmetic_provided.truncate_to_target_usize(
    cx.data_layout(),
    BigInt.asUintN(64, BigInt(this.offset.bytes()) + BigInt(i.bytes())),
  );
  return new Pointer(Size.from_bytes(res), this.provenance);
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:352 wrapping_signed_offset
Pointer.prototype.wrapping_signed_offset = function <Prov>(this: Pointer<Prov>, i: bigint, cx: HasDataLayout): Pointer<Prov> {
  // It's wrapping anyway, so we can just cast to `u64`.
  return this.wrapping_offset(Size.from_bytes(BigInt.asUintN(64, i)), cx);
};

/// Return the provenance and relative offset stored in this pointer. Safer alternative to
/// `into_raw_parts` since the type ensures that the offset is indeed relative.
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/pointer.rs:362 prov_and_relative_offset
Pointer.prototype.prov_and_relative_offset = function (this: Pointer<CtfeProvenance>): [CtfeProvenance, Size] {
  return [this.provenance, this.offset];
};

/** (the masks of pointer.rs:114-116) */
export const CtfeProvenance_masks = { IMMUTABLE_MASK, SHARED_REF_MASK, ALLOC_ID_MASK };
