// compiler/rustc_abi/src/lib.rs (subset). PORT: only what rustc_target's spec and rustc_session's
// `default_configuration` need is ported here: the data layout (`TargetDataLayout` and its parser),
// `Endian`, `Size`, `Align`/`AbiAlign`, `Integer` and `AddressSpace`; lane repr-options added `ReprFlags`,
// `IntegerType`, `ScalableElt`, `ReprOptions` and the `Size` / `Align` / `Integer` / `TargetDataLayout` helpers
// they and their users need. Lane layout-contract added the layout types (`Float`, `Primitive`, `Scalar`,
// `FieldsShape`, `BackendRepr`, `Variants`, `TagEncoding`, `Niche`, `LayoutData`, `VariantLayout`, ...) with their
// Debug impls, and a declaration of every other fn of the file: a `// stub: <path>:<line> <name> (lane <lane>)`
// comment over a body that calls `unported(..)`. A fill lane replaces the body, turns the comment into the
// `// rustc:` marker and keeps the signature (docs/handoff/layout-contract.md "How to fill a stub").
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { is_alphabetic } from "../std/char.ts";
import { debug_Hash64, Hash64 } from "../rustc_hashes/lib.ts";
import { type Debug, debug_bool, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { to_writer } from "../vendor/bitflags/parser.ts";
import { flags_companion } from "../vendor/bitflags/traits.ts";
import { IntoDiagArg, type DiagArgValue, type PathBuf } from "../rustc_error_messages/lib.ts";
import { into_diag_arg_using_display, number_into_diag_arg, str_into_diag_arg, String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Level, msg } from "../rustc_errors/lib.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { RegKind } from "./callconv/reg.ts";
import { FieldIdx, LayoutCalculatorError, VariantIdx } from "./layout.ts";
import { debug_WrappingRange, WrappingRange, WrappingRange_eq } from "./wrapping_range.ts";

export * from "./canon_abi.ts";
// mod callconv; mod layout; mod wrapping_range; (layout-contract)
// PORT (layout-contract): these modules use lib.ts's values only inside function bodies (init order: lib.ts is both the
// defining module of `LayoutData` & co. and the crate root, and the modules below import it).
export { Heterogeneous, HomogeneousAggregate, Reg, RegKind, debug_Heterogeneous, debug_HomogeneousAggregate, debug_Reg, debug_RegKind } from "./callconv.ts";
export { FIRST_VARIANT, FieldIdx, LayoutCalculator, LayoutCalculatorError, VariantIdx, debug_LayoutCalculator, debug_LayoutCalculatorError } from "./layout.ts";
export { Layout, TyAndLayout, debug_Layout, debug_TyAndLayout, register_ty_abi_interface, type TyAbiInterface } from "./layout/ty.ts";
export { WrappingRange, WrappingRange_eq, debug_WrappingRange } from "./wrapping_range.ts";

/**
 * `core::num::ParseIntError` (the `kind` only). PORT: `str::parse::<u32>()`/`parse::<u64>()` below are
 * reimplemented over decimal digit strings (an optional leading `+`, as core accepts).
 */
export type ParseIntError = "Empty" | "InvalidDigit" | "PosOverflow";
/** `impl Display for ParseIntError` */
export function display_ParseIntError(e: ParseIntError): string {
  switch (e) {
    case "Empty":
      return "cannot parse integer from empty string";
    case "InvalidDigit":
      return "invalid digit found in string";
    case "PosOverflow":
      return "number too large to fit in target type";
  }
}
/** PORT: `<uN as FromStr>::from_str` (radix 10) for `u32` (`max` = 2^32-1) and `u64` (`max` = 2^64-1). */
function parse_uint(s: string, max: bigint): Result<bigint, ParseIntError> {
  let digits = s;
  if (digits.startsWith("+") && digits.length > 1) digits = digits.slice(1);
  if (digits.length === 0) return Err("Empty");
  let v = 0n;
  for (const c of digits) {
    if (c < "0" || c > "9") return Err("InvalidDigit");
    v = v * 10n + BigInt(c.charCodeAt(0) - 48);
    if (v > max) return Err("PosOverflow");
  }
  return Ok(v);
}
function parse_u32(s: string): Result<number, ParseIntError> {
  const r = parse_uint(s, 0xffff_ffffn);
  return r.$ === "Ok" ? Ok(Number(r._0)) : r;
}
// PORT: the `u64` values parsed here are bit counts; values above 2^53 lose precision as `number`, which
// only matters for data layouts no target uses.
function parse_u64(s: string): Result<number, ParseIntError> {
  const r = parse_uint(s, 0xffff_ffff_ffff_ffffn);
  return r.$ === "Ok" ? Ok(Number(r._0)) : r;
}

// #[derive(Clone, Copy, PartialEq, Eq, Default)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
// PORT: `bitflags!` (`impl ReprFlags: u8`) -> branded number; flags + `Flags` API on the companion (as
// rustc_middle ty/adt.ts's `AdtFlags`). Equality is `===`.
export type ReprFlags = number & { readonly __brand: "ReprFlags" };
export const ReprFlags = flags_companion<
  ReprFlags,
  {
    IS_C: ReprFlags;
    IS_SIMD: ReprFlags;
    IS_TRANSPARENT: ReprFlags;
    IS_LINEAR: ReprFlags;
    RANDOMIZE_LAYOUT: ReprFlags;
    PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS: ReprFlags;
    IS_SCALABLE: ReprFlags;
    FIELD_ORDER_UNOPTIMIZABLE: ReprFlags;
    ABI_UNOPTIMIZABLE: ReprFlags;
  }
>(
  8,
  {
    IS_C: (1 << 0) as ReprFlags,
    IS_SIMD: (1 << 1) as ReprFlags,
    IS_TRANSPARENT: (1 << 2) as ReprFlags,
    /// Internal only for now. If true, don't reorder fields.
    /// On its own it does not prevent ABI optimizations.
    IS_LINEAR: (1 << 3) as ReprFlags,
    /// If true, the type's crate has opted into layout randomization.
    /// Other flags can still inhibit reordering and thus randomization.
    /// The seed stored in `ReprOptions.field_shuffle_seed`.
    ///
    /// `repr(Rust)` structs with only zero-sized fields, single-variant `repr(Rust)` enums with only
    /// zero-sized fields, and zero-variant `repr(Rust)` enums must remain zero-sized as per
    /// T-lang decisions in https://github.com/rust-lang/reference/pull/2262 and https://github.com/rust-lang/reference/pull/2293
    RANDOMIZE_LAYOUT: (1 << 4) as ReprFlags,
    /// If true, the type is always passed indirectly by non-Rustic ABIs.
    /// See [`TyAndLayout::pass_indirectly_in_non_rustic_abis`] for details.
    PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS: (1 << 5) as ReprFlags,
    IS_SCALABLE: (1 << 6) as ReprFlags,
    // Any of these flags being set prevent field reordering optimisation.
    FIELD_ORDER_UNOPTIMIZABLE: ((1 << 0) | (1 << 1) | (1 << 6) | (1 << 3)) as ReprFlags,
    ABI_UNOPTIMIZABLE: ((1 << 0) | (1 << 1)) as ReprFlags,
  },
  [
    ["IS_C", (1 << 0) as ReprFlags],
    ["IS_SIMD", (1 << 1) as ReprFlags],
    ["IS_TRANSPARENT", (1 << 2) as ReprFlags],
    ["IS_LINEAR", (1 << 3) as ReprFlags],
    ["RANDOMIZE_LAYOUT", (1 << 4) as ReprFlags],
    ["PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS", (1 << 5) as ReprFlags],
    ["IS_SCALABLE", (1 << 6) as ReprFlags],
    ["FIELD_ORDER_UNOPTIMIZABLE", ((1 << 0) | (1 << 1) | (1 << 6) | (1 << 3)) as ReprFlags],
    ["ABI_UNOPTIMIZABLE", ((1 << 0) | (1 << 1)) as ReprFlags],
  ],
);

// This is the same as `rustc_data_structures::external_bitflags_debug` but without the
// `rustc_data_structures` to make it build on stable.
// impl std::fmt::Debug for ReprFlags
// rustc: compiler/rustc_abi/src/lib.rs:116 fmt
export const debug_ReprFlags: Debug<ReprFlags> = (v) => to_writer(ReprFlags.FLAGS_DESC, v);

// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
export type IntegerType =
  /// Pointer-sized integer type, i.e. `isize` and `usize`. The field shows signedness, e.g.
  /// `Pointer(true)` means `isize`.
  | { readonly $: "Pointer"; readonly _0: boolean }
  /// Fixed-sized integer type, e.g. `i8`, `u32`, `i128`. The bool field shows signedness, e.g.
  /// `Fixed(I8, false)` means `u8`.
  | { readonly $: "Fixed"; readonly _0: Integer; readonly _1: boolean };
export const IntegerType = {
  // rustc: compiler/rustc_abi/src/lib.rs:133 is_signed
  is_signed(self: IntegerType): boolean {
    switch (self.$) {
      case "Pointer":
        return self._0;
      case "Fixed":
        return self._1;
    }
  },
};
// derive(Debug)
export const debug_IntegerType: Debug<IntegerType> = (v, f) => {
  switch (v.$) {
    case "Pointer":
      return debug_tuple(f, "Pointer", [debug_bool(v._0, f)]);
    case "Fixed":
      return debug_tuple(f, "Fixed", [debug_Integer(v._0, f), debug_bool(v._1, f)]);
  }
};
// derive(PartialEq)
export function IntegerType_eq(a: IntegerType, b: IntegerType): boolean {
  switch (a.$) {
    case "Pointer":
      return b.$ === "Pointer" && a._0 === b._0;
    case "Fixed":
      return b.$ === "Fixed" && a._0 === b._0 && a._1 === b._1;
  }
}

// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
export type ScalableElt =
  /// `N` in `rustc_scalable_vector(N)` - the element count of the scalable vector
  | { readonly $: "ElementCount"; readonly _0: number }
  /// `rustc_scalable_vector` w/out `N`, used for tuple types of scalable vectors that only
  /// contain other scalable vectors
  | { readonly $: "Container" };
/** Unit variants of `ScalableElt`, shared frozen singletons. */
export const ScalableElt = {
  Container: Object.freeze({ $: "Container" }) as ScalableElt,
};
// derive(Debug)
export const debug_ScalableElt: Debug<ScalableElt> = (v, f) => {
  switch (v.$) {
    case "ElementCount":
      return debug_tuple(f, "ElementCount", [debug_int(v._0, f)]);
    case "Container":
      return "Container";
  }
};
// derive(PartialEq)
export function ScalableElt_eq(a: ScalableElt, b: ScalableElt): boolean {
  switch (a.$) {
    case "ElementCount":
      return b.$ === "ElementCount" && a._0 === b._0;
    case "Container":
      return b.$ === "Container";
  }
}

/// Represents the repr options provided by the user.
// #[derive(Copy, Clone, Debug, Eq, PartialEq, Default)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
export class ReprOptions {
  constructor(
    public int: IntegerType | undefined,
    public align: Align | undefined,
    public pack: Align | undefined,
    public flags: ReprFlags,
    /// `#[rustc_scalable_vector]`
    public scalable: ScalableElt | undefined,
    /// The seed to be used for randomizing a type's layout
    ///
    /// Note: This could technically be a `u128` which would
    /// be the "most accurate" hash as it'd encompass the item and crate
    /// hash without loss, but it does pay the price of being larger.
    /// Everything's a tradeoff, a 64-bit seed should be sufficient for our
    /// purposes (primarily `-Z randomize-layout`)
    public field_shuffle_seed: Hash64,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:173 simd
  simd(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_SIMD);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:178 scalable
  // PORT: the method is `is_scalable` because the field `scalable` takes the name (a TS class cannot have both).
  is_scalable(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_SCALABLE);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:183 c
  c(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_C);
  }

  /// Returns whether this is (implicitly or explicitly) `repr(Rust)`, i.e., its layout
  /// is defined by Rust and we make no stable commitments.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:190 rust
  rust(): boolean {
    // `linear` is currently just an internal flag we set on Box; that's still `repr(Rust)`.
    return !this.c() && !this.simd() && !this.is_scalable() && !this.transparent();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:196 packed
  packed(): boolean {
    return this.pack !== undefined;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:201 transparent
  transparent(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_TRANSPARENT);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:206 linear
  linear(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_LINEAR);
  }

  /// Returns the discriminant type, given these `repr` options.
  /// This must only be called on enums!
  ///
  /// This is the "typeck type" of the discriminant, which is effectively the maximum size:
  /// discriminant values will be wrapped to fit (with a lint). Layout can later decide to use a
  /// smaller type for the tag that stores the discriminant at runtime and that will work just
  /// fine, it just induces casts when getting/setting the discriminant.
  // rustc: compiler/rustc_abi/src/lib.rs:217 discr_type
  discr_type(): IntegerType {
    return this.int ?? { $: "Pointer", _0: true };
  }

  /// Returns `true` if this `#[repr()]` should inhabit "smart enum
  /// layout" optimizations, such as representing `Foo<&T>` as a
  /// single pointer.
  // rustc: compiler/rustc_abi/src/lib.rs:224 inhibit_enum_layout_opt
  inhibit_enum_layout_opt(): boolean {
    return this.c() || this.int !== undefined;
  }

  // rustc: compiler/rustc_abi/src/lib.rs:228 inhibit_newtype_abi_optimization
  inhibit_newtype_abi_optimization(): boolean {
    return ReprFlags.intersects(this.flags, ReprFlags.ABI_UNOPTIMIZABLE);
  }

  /// Returns `true` if this `#[repr()]` guarantees a fixed field order,
  /// e.g. `repr(C)` or `repr(<int>)`.
  // rustc: compiler/rustc_abi/src/lib.rs:234 inhibit_struct_field_reordering
  inhibit_struct_field_reordering(): boolean {
    return ReprFlags.intersects(this.flags, ReprFlags.FIELD_ORDER_UNOPTIMIZABLE) || this.int !== undefined;
  }

  /// Returns `true` if this type is valid for reordering and `-Z randomize-layout`
  /// was enabled for its declaration crate.
  // rustc: compiler/rustc_abi/src/lib.rs:240 can_randomize_type_layout
  can_randomize_type_layout(): boolean {
    return !this.inhibit_struct_field_reordering() && ReprFlags.contains(this.flags, ReprFlags.RANDOMIZE_LAYOUT);
  }

  /// Returns `true` if this `#[repr()]` should inhibit union ABI optimisations.
  // rustc: compiler/rustc_abi/src/lib.rs:245 inhibits_union_abi_opt
  inhibits_union_abi_opt(): boolean {
    return this.c();
  }

  /// Ensures two `repr` are equal up to the seed.
  // rustc: compiler/rustc_abi/src/lib.rs:250 equal_up_to_seed
  equal_up_to_seed(other: ReprOptions): boolean {
    const { int, align, pack, flags, scalable } = this;
    return (
      option_eq(int, other.int, IntegerType_eq) &&
      option_eq(align, other.align, Align_eq) &&
      option_eq(pack, other.pack, Align_eq) &&
      flags === other.flags &&
      option_eq(scalable, other.scalable, ScalableElt_eq)
    );
  }
}
// derive(Debug)
export const debug_ReprOptions: Debug<ReprOptions> = (v, f) =>
  debug_struct(f, "ReprOptions", [
    ["int", debug_option(v.int, f, debug_IntegerType)],
    ["align", debug_option(v.align, f, debug_Align)],
    ["pack", debug_option(v.pack, f, debug_Align)],
    ["flags", debug_ReprFlags(v.flags, f)],
    ["scalable", debug_option(v.scalable, f, debug_ScalableElt)],
    ["field_shuffle_seed", debug_Hash64(v.field_shuffle_seed, f)],
  ]);
// derive(PartialEq)
export function ReprOptions_eq(a: ReprOptions, b: ReprOptions): boolean {
  return a.equal_up_to_seed(b) && a.field_shuffle_seed === b.field_shuffle_seed;
}

/** `PartialEq for Option<T>` with the given `T` equality. */
function option_eq<T>(a: T | undefined, b: T | undefined, eq: (a: T, b: T) => boolean): boolean {
  return a === undefined || b === undefined ? a === b : eq(a, b);
}

/// The maximum supported number of lanes in a SIMD vector.
///
/// This value is selected based on backend support:
/// * LLVM does not appear to have a vector width limit.
/// * Cranelift stores the base-2 log of the lane count in a 4 bit integer.
export const MAX_SIMD_LANES: number = 1 << 0xf;

/// The number of lanes in a [`BackendRepr::SimdVector`], `1..=`[`MAX_SIMD_LANES`].
// #[derive(Debug, Copy, Clone, Hash, Eq, PartialEq, Ord, PartialOrd)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
// PORT (layout-contract): the `NonZero<u16>` newtype is a branded number (equality and order are `===` / `<`).
export type BackendLaneCount = number & { readonly __brand: "BackendLaneCount" };
export const BackendLaneCount = {
  // PORT (layout-contract): `count: u64` is a `bigint` (an array length, layout-contract conventions).
  // rustc: compiler/rustc_abi/src/lib.rs:273 new
  new<N>(count: bigint): Result<BackendLaneCount, LayoutCalculatorError<N>> {
    // PORT: `let Ok(count @ ..=MAX_SIMD_LANES) = u16::try_from(count) else { .. }`: `count` (a `u64`) is in
    // `0..=MAX_SIMD_LANES` (which is within `u16`).
    if (!(count >= 0n && count <= BigInt(MAX_SIMD_LANES))) {
      return Err({
        $: "OversizedSimdType",
        max_lanes: MAX_SIMD_LANES,
      });
    }
    const count_ = Number(count);
    // `NonZero::new(count)`
    if (count_ !== 0) {
      return Ok(count_ as BackendLaneCount);
    } else {
      return Err(LayoutCalculatorError.ZeroLengthSimdType);
    }
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:287 is_power_of_two
  is_power_of_two(self: BackendLaneCount): boolean {
    // `NonZero<u16>::is_power_of_two` (`self` is in `1..=MAX_SIMD_LANES`)
    return (self & (self - 1)) === 0;
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:292 as_u64
  as_u64(self: BackendLaneCount): bigint {
    return BigInt(self);
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:297 as_u32
  as_u32(self: BackendLaneCount): number {
    return self;
  },
} as const;
// derive(Debug)
export const debug_BackendLaneCount: Debug<BackendLaneCount> = (v, f) => debug_tuple(f, "BackendLaneCount", [debug_int(v, f)]);

/// How pointers are represented in a given address space
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export interface PointerSpec {
  /// The size of the bitwise representation of the pointer.
  pointer_size: Size;
  /// The alignment of pointers for this address space
  pointer_align: Align;
  /// The size of the value a pointer can be offset by in this address space.
  pointer_offset: Size;
  /// Pointers into this address space contain extra metadata
  /// FIXME(workingjubilee): Consider adequately reflecting this in the compiler?
  _is_fat: boolean;
}

/// Parsed [Data layout](https://llvm.org/docs/LangRef.html#data-layout)
/// for a target, which contains everything needed to compute layouts.
// #[derive(Debug, PartialEq, Eq)]
export class TargetDataLayout {
  constructor(
    public endian: Endian,
    public i1_align: Align,
    public i8_align: Align,
    public i16_align: Align,
    public i32_align: Align,
    public i64_align: Align,
    public i128_align: Align,
    public f16_align: Align,
    public f32_align: Align,
    public f64_align: Align,
    public f128_align: Align,
    public aggregate_align: Align,

    /// Alignments for vector types.
    public vector_align: [Size, Align][],

    public default_address_space: AddressSpace,
    public default_address_space_pointer_spec: PointerSpec,

    /// Address space information of all known address spaces.
    ///
    /// # Note
    ///
    /// This vector does not contain the [`PointerSpec`] relative to the default address space,
    /// which instead lives in [`Self::default_address_space_pointer_spec`].
    public address_space_info: [AddressSpace, PointerSpec][],

    public instruction_address_space: AddressSpace,

    /// Minimum size of #[repr(C)] enums (default c_int::BITS, usually 32)
    /// Note: This isn't in LLVM's data layout string, it is `short_enum`
    /// so the only valid spec for LLVM is c_int::BITS or 8
    public c_enum_min_size: Integer,
  ) {}

  /// Creates an instance of `TargetDataLayout`.
  // rustc: compiler/rustc_abi/src/lib.rs:357 default
  static default(): TargetDataLayout {
    const align = (bits: number): Align => {
      const r = Align.from_bits(bits);
      if (r.$ === "Err") panic(`called \`Result::unwrap()\` on an \`Err\` value: ${display_AlignFromBytesError(r._0)}`);
      return r._0;
    };
    return new TargetDataLayout(
      /* endian */ "Big",
      /* i1_align */ align(8),
      /* i8_align */ align(8),
      /* i16_align */ align(16),
      /* i32_align */ align(32),
      /* i64_align */ align(32),
      /* i128_align */ align(32),
      /* f16_align */ align(16),
      /* f32_align */ align(32),
      /* f64_align */ align(64),
      /* f128_align */ align(128),
      /* aggregate_align */ align(8),
      /* vector_align */ [
        [Size.from_bits(64), align(64)],
        [Size.from_bits(128), align(128)],
      ],
      /* default_address_space */ AddressSpace.ZERO,
      /* default_address_space_pointer_spec */ {
        pointer_size: Size.from_bits(64),
        pointer_align: align(64),
        pointer_offset: Size.from_bits(64),
        _is_fat: false,
      },
      /* address_space_info */ [],
      /* instruction_address_space */ AddressSpace.ZERO,
      /* c_enum_min_size */ "I32",
    );
  }

  /// Parse data layout from an
  /// [llvm data layout string](https://llvm.org/docs/LangRef.html#data-layout)
  ///
  /// This function doesn't fill `c_enum_min_size` and it will always be `I32` since it can not be
  /// determined from llvm string.
  // rustc: compiler/rustc_abi/src/lib.rs:452 parse_from_llvm_datalayout_string
  static parse_from_llvm_datalayout_string(
    input: string,
    default_address_space: AddressSpace,
  ): Result<TargetDataLayout, TargetDataLayoutError> {
    // Parse an address space index from a string.
    const parse_address_space = (s: string, cause: string): Result<AddressSpace, TargetDataLayoutError> => {
      const r = parse_u32(s);
      return r.$ === "Ok" ? Ok(r._0 as AddressSpace) : Err({ $: "InvalidAddressSpace", addr_space: s, cause, err: r._0 });
    };

    // Parse a bit count from a string.
    const parse_bits = (s: string, kind: string, cause: string): Result<number, TargetDataLayoutError> => {
      const r = parse_u64(s);
      return r.$ === "Ok" ? r : Err({ $: "InvalidBits", kind, bit: s, cause, err: r._0 });
    };

    // Parse a size string.
    const parse_size = (s: string, cause: string): Result<Size, TargetDataLayoutError> => {
      const r = parse_bits(s, "size", cause);
      return r.$ === "Ok" ? Ok(Size.from_bits(r._0)) : r;
    };

    // Parse an alignment string.
    const parse_align_str = (s: string, cause: string): Result<Align, TargetDataLayoutError> => {
      const align_from_bits = (bits: number): Result<Align, TargetDataLayoutError> => {
        const r = Align.from_bits(bits);
        return r.$ === "Ok" ? r : Err({ $: "InvalidAlignment", cause, err: r._0 });
      };
      const abi = parse_bits(s, "alignment", cause);
      if (abi.$ === "Err") return abi;
      const a = align_from_bits(abi._0);
      if (a.$ === "Err") return a;
      return Ok(a._0);
    };

    // Parse an alignment sequence, possibly in the form `<align>[:<preferred_alignment>]`,
    // ignoring the secondary alignment specifications.
    const parse_align_seq = (s: readonly string[], cause: string): Result<Align, TargetDataLayoutError> => {
      if (s.length === 0) {
        return Err({ $: "MissingAlignment", cause });
      }
      return parse_align_str(s[0]!, cause);
    };

    const dl = TargetDataLayout.default();
    dl.default_address_space = default_address_space;

    let i128_align_src = 64;
    for (const spec of input.split("-")) {
      const spec_parts = spec.split(":");

      // PORT: slice patterns, in arm order.
      const [p0, p1, p2, p3, p4] = spec_parts;
      const n = spec_parts.length;
      if (n === 1 && p0 === "e") {
        dl.endian = "Little";
      } else if (n === 1 && p0 === "E") {
        dl.endian = "Big";
      } else if (n === 1 && p0!.startsWith("P")) {
        const r = parse_address_space(p0!.slice(1), "P");
        if (r.$ === "Err") return r;
        dl.instruction_address_space = r._0;
      } else if (n >= 1 && p0 === "a") {
        const r = parse_align_seq(spec_parts.slice(1), "a");
        if (r.$ === "Err") return r;
        dl.aggregate_align = r._0;
      } else if (n >= 1 && p0 === "f16") {
        const r = parse_align_seq(spec_parts.slice(1), "f16");
        if (r.$ === "Err") return r;
        dl.f16_align = r._0;
      } else if (n >= 1 && p0 === "f32") {
        const r = parse_align_seq(spec_parts.slice(1), "f32");
        if (r.$ === "Err") return r;
        dl.f32_align = r._0;
      } else if (n >= 1 && p0 === "f64") {
        const r = parse_align_seq(spec_parts.slice(1), "f64");
        if (r.$ === "Err") return r;
        dl.f64_align = r._0;
      } else if (n >= 1 && p0 === "f128") {
        const r = parse_align_seq(spec_parts.slice(1), "f128");
        if (r.$ === "Err") return r;
        dl.f128_align = r._0;
      } else if (n >= 2 && p0!.startsWith("p")) {
        // `[p, s, a @ ..] if p.starts_with("p")`
        const s = p1!;
        const a = spec_parts.slice(2);
        let p = p0!.slice(1);
        let _is_fat = false;

        // Some targets, such as CHERI, use the 'f' suffix in the p- spec to signal that
        // they use 'fat' pointers. The resulting prefix may look like `pf<addr_space>`.

        if (p.startsWith("f")) {
          p = p.slice(1);
          _is_fat = true;
        }

        // However, we currently don't take into account further specifications:
        // an error is emitted instead.
        if (starts_with_alphabetic(p)) {
          return Err({ $: "UnknownPointerSpecification", err: p });
        }

        let addr_space: AddressSpace;
        if (p.length !== 0) {
          const r = parse_address_space(p, "p-");
          if (r.$ === "Err") return r;
          addr_space = r._0;
        } else {
          addr_space = AddressSpace.ZERO;
        }

        const pointer_size = parse_size(s, "p-");
        if (pointer_size.$ === "Err") return pointer_size;
        const pointer_align = parse_align_seq(a, "p-");
        if (pointer_align.$ === "Err") return pointer_align;
        const info: PointerSpec = {
          pointer_offset: pointer_size._0,
          pointer_size: pointer_size._0,
          pointer_align: pointer_align._0,
          _is_fat,
        };
        if (addr_space === default_address_space) {
          dl.default_address_space_pointer_spec = info;
        } else {
          const e = dl.address_space_info.find(([a]) => a === addr_space);
          if (e !== undefined) {
            e[1] = info;
          } else {
            dl.address_space_info.push([addr_space, info]);
          }
        }
      } else if (n === 5 && p0!.startsWith("p")) {
        // `[p, s, a, _pr, i] if p.starts_with("p")`
        // PORT: unreachable at the pin (the arm above already matches every `p` spec with >= 2
        // parts); kept for fidelity.
        void p3;
        let p = p0!.slice(1);
        let _is_fat = false;

        // Some targets, such as CHERI, use the 'f' suffix in the p- spec to signal that
        // they use 'fat' pointers. The resulting prefix may look like `pf<addr_space>`.

        if (p.startsWith("f")) {
          p = p.slice(1);
          _is_fat = true;
        }

        // However, we currently don't take into account further specifications:
        // an error is emitted instead.
        if (starts_with_alphabetic(p)) {
          return Err({ $: "UnknownPointerSpecification", err: p });
        }

        let addr_space: AddressSpace;
        if (p.length !== 0) {
          const r = parse_address_space(p, "p");
          if (r.$ === "Err") return r;
          addr_space = r._0;
        } else {
          addr_space = AddressSpace.ZERO;
        }

        const pointer_size = parse_size(p1!, "p-");
        if (pointer_size.$ === "Err") return pointer_size;
        const pointer_align = parse_align_str(p2!, "p-");
        if (pointer_align.$ === "Err") return pointer_align;
        const pointer_offset = parse_size(p4!, "p-");
        if (pointer_offset.$ === "Err") return pointer_offset;
        const info: PointerSpec = {
          pointer_size: pointer_size._0,
          pointer_align: pointer_align._0,
          pointer_offset: pointer_offset._0,
          _is_fat,
        };

        if (addr_space === default_address_space) {
          dl.default_address_space_pointer_spec = info;
        } else {
          const e = dl.address_space_info.find(([a]) => a === addr_space);
          if (e !== undefined) {
            e[1] = info;
          } else {
            dl.address_space_info.push([addr_space, info]);
          }
        }
      } else if (n >= 1 && p0!.startsWith("i")) {
        const s = p0!;
        const bits_r = parse_u64(s.slice(1));
        if (bits_r.$ === "Err") {
          const r = parse_size(s.slice(1), "i"); // For the user error.
          if (r.$ === "Err") return r;
          continue;
        }
        const bits = bits_r._0;
        const a_r = parse_align_seq(spec_parts.slice(1), s);
        if (a_r.$ === "Err") return a_r;
        const a = a_r._0;
        switch (bits) {
          case 1:
            dl.i1_align = a;
            break;
          case 8:
            dl.i8_align = a;
            break;
          case 16:
            dl.i16_align = a;
            break;
          case 32:
            dl.i32_align = a;
            break;
          case 64:
            dl.i64_align = a;
            break;
          default:
            break;
        }
        if (bits >= i128_align_src && bits <= 128) {
          // Default alignment for i128 is decided by taking the alignment of
          // largest-sized i{64..=128}.
          i128_align_src = bits;
          dl.i128_align = a;
        }
      } else if (n >= 1 && p0!.startsWith("v")) {
        const s = p0!;
        const v_size = parse_size(s.slice(1), "v");
        if (v_size.$ === "Err") return v_size;
        const a = parse_align_seq(spec_parts.slice(1), s);
        if (a.$ === "Err") return a;
        const v = dl.vector_align.find((v) => v[0].raw === v_size._0.raw);
        if (v !== undefined) {
          v[1] = a._0;
          continue;
        }
        // No existing entry, add a new one.
        dl.vector_align.push([v_size._0, a._0]);
      } else {
        // Ignore everything else.
      }
    }

    // Inherit, if not given, address space information for specific LLVM elements from the
    // default data address space.
    if (
      dl.instruction_address_space !== dl.default_address_space &&
      dl.address_space_info.find(([a]) => a === dl.instruction_address_space) === undefined
    ) {
      dl.address_space_info.push([dl.instruction_address_space, { ...dl.default_address_space_pointer_spec }]);
    }

    return Ok(dl);
  }

  /// Returns **exclusive** upper bound on object size in bytes, in the default data address
  /// space.
  ///
  /// The theoretical maximum object size is defined as the maximum positive `isize` value.
  /// This ensures that the `offset` semantics remain well-defined by allowing it to correctly
  /// index every address within an object along with one byte past the end, along with allowing
  /// `isize` to store the difference between any two pointers into an object.
  ///
  /// LLVM uses a 64-bit integer to represent object size in *bits*, but we care only for bytes,
  /// so we adopt such a more-constrained size bound due to its technical limitations.
  // #[inline]
  // PORT: `u64` -> `number`: the bounds are powers of two (exact as doubles).
  // rustc: compiler/rustc_abi/src/lib.rs:668 obj_size_bound
  obj_size_bound(): number {
    const bits = this.pointer_size().bits();
    switch (bits) {
      case 16:
        return 2 ** 15;
      case 32:
        return 2 ** 31;
      case 64:
        return 2 ** 61;
      default:
        return panic(`obj_size_bound: unknown pointer bit size ${bits}`);
    }
  }

  /// Returns **exclusive** upper bound on object size in bytes.
  ///
  /// The theoretical maximum object size is defined as the maximum positive `isize` value.
  /// This ensures that the `offset` semantics remain well-defined by allowing it to correctly
  /// index every address within an object along with one byte past the end, along with allowing
  /// `isize` to store the difference between any two pointers into an object.
  ///
  /// LLVM uses a 64-bit integer to represent object size in *bits*, but we care only for bytes,
  /// so we adopt such a more-constrained size bound due to its technical limitations.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:687 obj_size_bound_in
  obj_size_bound_in(address_space: AddressSpace): number {
    const bits = this.pointer_size_in(address_space).bits();
    switch (bits) {
      case 16:
        return 2 ** 15;
      case 32:
        return 2 ** 31;
      case 64:
        return 2 ** 61;
      default:
        return panic(`obj_size_bound: unknown pointer bit size ${bits}`);
    }
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:697 ptr_sized_integer
  ptr_sized_integer(): Integer {
    const bits = this.pointer_offset().bits();
    switch (bits) {
      case 16:
        return "I16";
      case 32:
        return "I32";
      case 64:
        return "I64";
      default:
        return panic(`ptr_sized_integer: unknown pointer bit size ${bits}`);
    }
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:708 ptr_sized_integer_in
  ptr_sized_integer_in(address_space: AddressSpace): Integer {
    const bits = this.pointer_offset_in(address_space).bits();
    switch (bits) {
      case 16:
        return "I16";
      case 32:
        return "I32";
      case 64:
        return "I64";
      default:
        return panic(`ptr_sized_integer: unknown pointer bit size ${bits}`);
    }
  }

  /// psABI-mandated alignment for a vector type, if any
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:720 c_vector_align
  private c_vector_align(vec_size: Size): Align | undefined {
    const e = this.vector_align.find(([size, _align]) => size.bytes() === vec_size.bytes());
    return e === undefined ? undefined : e[1];
  }

  /// Rust-assigned alignment of any vector type
  ///
  /// When the shape of a vector matches that in a C psABI, we *must* agree when performing FFI.
  /// This currently answers correctly for C compatibility purposes as it is a useful default.
  /// Otherwise this choice is arbitrary, as vector types do not necessarily match hardware so
  /// this can conjure "imaginary" answers that just happen to be convenient for us.
  ///
  /// Importantly, Rust vector alignment is not required to be monotonic between vector sizes,
  /// even though it currently is.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:737 rust_vector_align
  rust_vector_align(vec_size: Size): Align {
    // PORT: `unwrap_or` evaluates its argument eagerly; so does this.
    const fallback = Align.from_bytes(next_power_of_two(vec_size.bytes()));
    if (fallback.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
    return this.c_vector_align(vec_size) ?? fallback._0;
  }

  /// Get the pointer size in the default data address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:744 pointer_size
  pointer_size(): Size {
    return this.default_address_space_pointer_spec.pointer_size;
  }

  /// Get the pointer size in a specific address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:750 pointer_size_in
  pointer_size_in(c: AddressSpace): Size {
    if (c === this.default_address_space) {
      return this.default_address_space_pointer_spec.pointer_size;
    }

    const e = this.address_space_info.find(([a]) => a === c);
    if (e !== undefined) {
      return e[1].pointer_size;
    } else {
      return panic(`Use of unknown address space AddressSpace(${c})`);
    }
  }

  /// Get the pointer index in the default data address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:764 pointer_offset
  pointer_offset(): Size {
    return this.default_address_space_pointer_spec.pointer_offset;
  }

  /// Get the pointer index in a specific address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:770 pointer_offset_in
  pointer_offset_in(c: AddressSpace): Size {
    if (c === this.default_address_space) {
      return this.default_address_space_pointer_spec.pointer_offset;
    }

    const e = this.address_space_info.find(([a]) => a === c);
    if (e !== undefined) {
      return e[1].pointer_offset;
    } else {
      return panic(`Use of unknown address space AddressSpace(${c})`);
    }
  }

  /// Get the pointer alignment in the default data address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:784 pointer_align
  pointer_align(): AbiAlign {
    return AbiAlign.new(this.default_address_space_pointer_spec.pointer_align);
  }

  /// Get the pointer alignment in a specific address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:790 pointer_align_in
  pointer_align_in(c: AddressSpace): AbiAlign {
    let align: Align;
    if (c === this.default_address_space) {
      align = this.default_address_space_pointer_spec.pointer_align;
    } else {
      const e = this.address_space_info.find(([a]) => a === c);
      if (e !== undefined) {
        align = e[1].pointer_align;
      } else {
        return panic(`Use of unknown address space AddressSpace(${c})`);
      }
    }
    return AbiAlign.new(align);
  }

  // impl HasDataLayout for TargetDataLayout (PORTING §8: a later impl block's method in the class body)
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:807 data_layout
  // impl HasDataLayout for &TargetDataLayout (used by rust-analyzer): PORT (layout-contract): `&TargetDataLayout` is
  // `TargetDataLayout` (PORTING §5), so that impl is this one.
  // rustc: compiler/rustc_abi/src/lib.rs:815 data_layout
  data_layout(): TargetDataLayout {
    return this;
  }
}

// PORT: the trait is an interface; generic `C: HasDataLayout` parameters take any object with `data_layout()`.
export interface HasDataLayout {
  // rustc: compiler/rustc_abi/src/lib.rs:802 data_layout
  data_layout(): TargetDataLayout;
}

/** `u64::next_power_of_two` (the sizes here stay far below 2^53). */
function next_power_of_two(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** `p.starts_with(char::is_alphabetic)` */
function starts_with_alphabetic(p: string): boolean {
  const c = p.codePointAt(0);
  return c !== undefined && is_alphabetic(c);
}

export type TargetDataLayoutError =
  | { readonly $: "InvalidAddressSpace"; readonly addr_space: string; readonly cause: string; readonly err: ParseIntError }
  | { readonly $: "InvalidBits"; readonly kind: string; readonly bit: string; readonly cause: string; readonly err: ParseIntError }
  | { readonly $: "MissingAlignment"; readonly cause: string }
  | { readonly $: "InvalidAlignment"; readonly cause: string; readonly err: AlignFromBytesError }
  | { readonly $: "InconsistentTargetArchitecture"; readonly dl: string; readonly target: string }
  | { readonly $: "InconsistentTargetPointerWidth"; readonly pointer_size: number; readonly target: number }
  | { readonly $: "InvalidBitsSize"; readonly err: string }
  | { readonly $: "UnknownPointerSpecification"; readonly err: string };

// #[cfg(feature = "nightly")]
// impl Diagnostic<'_> for TargetDataLayoutError<'_>
// PORT (abi-lib): the stub's signature (`(e) => never`) became the trait method's `(self, dcx, level) -> Diag`.
// rustc: compiler/rustc_abi/src/lib.rs:403 into_diag
export function TargetDataLayoutError_into_diag(self: TargetDataLayoutError, dcx: DiagCtxtHandle, level: Level): Diag {
  switch (self.$) {
    case "InvalidAddressSpace": {
      const { addr_space, err, cause } = self;
      return Diag.new(dcx, level, msg('invalid address space `{$addr_space}` for `{$cause}` in "data-layout": {$err}'))
        .with_arg("addr_space", IntoDiagArg.of(addr_space, str_into_diag_arg))
        .with_arg("cause", IntoDiagArg.of(cause, str_into_diag_arg))
        .with_arg("err", IntoDiagArg.of(err, into_diag_arg_using_display(display_ParseIntError)));
    }
    case "InvalidBits": {
      const { kind, bit, cause, err } = self;
      return Diag.new(dcx, level, msg('invalid {$kind} `{$bit}` for `{$cause}` in "data-layout": {$err}'))
        .with_arg("kind", IntoDiagArg.of(kind, str_into_diag_arg))
        .with_arg("bit", IntoDiagArg.of(bit, str_into_diag_arg))
        .with_arg("cause", IntoDiagArg.of(cause, str_into_diag_arg))
        .with_arg("err", IntoDiagArg.of(err, into_diag_arg_using_display(display_ParseIntError)));
    }
    case "MissingAlignment": {
      const { cause } = self;
      return Diag.new(dcx, level, msg('missing alignment for `{$cause}` in "data-layout"')).with_arg("cause", IntoDiagArg.of(cause, str_into_diag_arg));
    }
    case "InvalidAlignment": {
      const { cause, err } = self;
      return Diag.new(dcx, level, msg('invalid alignment for `{$cause}` in "data-layout": {$err}'))
        .with_arg("cause", IntoDiagArg.of(cause, str_into_diag_arg))
        .with_arg("err", IntoDiagArg.of(display_AlignFromBytesError(err), String_into_diag_arg));
    }
    case "InconsistentTargetArchitecture": {
      const { dl, target } = self;
      return Diag.new(
        dcx,
        level,
        msg('inconsistent target specification: "data-layout" claims architecture is {$dl}-endian, while "target-endian" is `{$target}`'),
      )
        .with_arg("dl", IntoDiagArg.of(dl, str_into_diag_arg))
        .with_arg("target", IntoDiagArg.of(target, str_into_diag_arg));
    }
    case "InconsistentTargetPointerWidth": {
      const { pointer_size, target } = self;
      return Diag.new(
        dcx,
        level,
        msg('inconsistent target specification: "data-layout" claims pointers are {$pointer_size}-bit, while "target-pointer-width" is `{$target}`'),
      )
        .with_arg("pointer_size", IntoDiagArg.of(pointer_size, number_into_diag_arg))
        .with_arg("target", IntoDiagArg.of(target, number_into_diag_arg));
    }
    case "InvalidBitsSize": {
      const { err } = self;
      return Diag.new(dcx, level, msg("{$err}")).with_arg("err", IntoDiagArg.of(err, String_into_diag_arg));
    }
    case "UnknownPointerSpecification": {
      const { err } = self;
      return Diag.new(dcx, level, msg("unknown pointer specification `{$err}` in datalayout string")).with_arg("err", IntoDiagArg.of(err, String_into_diag_arg));
    }
  }
}

/// Endianness of the target, which must match cfg(target-endian).
// #[derive(Copy, Clone, PartialEq, Eq)]
export type Endian = "Little" | "Big";
export const Endian = {
  Little: "Little",
  Big: "Big",

  // rustc: compiler/rustc_abi/src/lib.rs:828 as_str
  as_str(self: Endian): string {
    switch (self) {
      case "Little":
        return "little";
      case "Big":
        return "big";
    }
  },

  // #[cfg(feature = "nightly")]
  // rustc: compiler/rustc_abi/src/lib.rs:836 desc_symbol
  desc_symbol(self: Endian): Symbol {
    switch (self) {
      case "Little":
        return sym.little;
      case "Big":
        return sym.big;
    }
  },

  // impl FromStr for Endian
  // rustc: compiler/rustc_abi/src/lib.rs:853 from_str
  from_str(s: string): Result<Endian, string> {
    switch (s) {
      case "little":
        return Ok("Little");
      case "big":
        return Ok("Big");
      default:
        return Err(`unknown endian: "${s}"`);
    }
  },
} as const;
// impl fmt::Debug for Endian
// rustc: compiler/rustc_abi/src/lib.rs:845 fmt
export const debug_Endian: Debug<Endian> = (v) => Endian.as_str(v);

/// Size of a type in bytes.
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
// PORT: `raw: u64` is a `number`. PORT (abi-lib, root decision): `Size` stays a plain `number`; every value that enters
// or leaves a `Size` goes through the helpers below (`size_raw`, `u64_arg`), so a byte count (or a bit count from
// `bits()`) beyond `Number.MAX_SAFE_INTEGER` (2^53 - 1) stops with `unported(SIZE_BEYOND_2_53)` instead of being
// rounded. The arithmetic itself is exact (`bigint`): `checked_add` / `checked_mul` keep upstream's `None` for every
// result at or above `obj_size_bound` (a power of two, exact), and the panicking ops keep their `u64` overflow panics.
export class Size {
  constructor(readonly raw: number) {}

  static readonly ZERO: Size = new Size(0);

  /// Rounds `bits` up to the next-higher byte boundary, if `bits` is
  /// not a multiple of 8.
  // PORT (abi-lib): `bits: impl TryInto<u64>` is a `number` or a `bigint` (`u64_arg`).
  // rustc: compiler/rustc_abi/src/lib.rs:890 from_bits
  static from_bits(bits: number | bigint): Size {
    const bits_ = u64_arg(bits);
    // `u64::div_ceil(8)`
    return new Size(size_raw((bits_ + 7n) / 8n));
  }

  // #[inline]
  // PORT (abi-lib): `bytes: impl TryInto<u64>` is a `number` or a `bigint` (`u64_arg`).
  // rustc: compiler/rustc_abi/src/lib.rs:896 from_bytes
  static from_bytes(bytes: number | bigint): Size {
    if (typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0) {
      // PORT (abi-lib): fast path, the common case (a safe non-negative integer is a valid `raw`).
      return new Size(bytes);
    }
    const bytes_: bigint = u64_arg(bytes);
    return new Size(size_raw(bytes_));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:902 bytes
  bytes(): number {
    return this.raw;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:907 bytes_usize
  bytes_usize(): number {
    return this.bytes();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:912 bits
  bits(): number {
    // #[cold]
    // rustc: compiler/rustc_abi/src/lib.rs:914 overflow
    function overflow(bytes: number): never {
      return panic(`Size::bits: ${bytes} bytes in bits doesn't fit in u64`);
    }

    // `self.bytes().checked_mul(8).unwrap_or_else(|| overflow(self.bytes()))`
    const bits = BigInt(this.bytes()) * 8n;
    if (bits > U64_MAX) overflow(this.bytes());
    // PORT (abi-lib): the bit count is a `number` too (`size_raw`'s bound).
    return size_raw(bits);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:922 bits_usize
  bits_usize(): number {
    return this.bits();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:927 align_to
  align_to(align: Align): Size {
    // PORT: the mask arithmetic in `bigint` (JS bitwise operators are 32-bit). `self.bytes() + mask` cannot overflow
    // `u64` (bytes < 2^53, mask < 2^29).
    const mask = BigInt(align.bytes()) - 1n;
    return Size.from_bytes((BigInt(this.bytes()) + mask) & ~mask);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:933 is_aligned
  is_aligned(align: Align): boolean {
    const mask = BigInt(align.bytes()) - 1n;
    return (BigInt(this.bytes()) & mask) === 0n;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:939 checked_add
  checked_add(offset: Size, cx: HasDataLayout): Size | undefined {
    const dl = cx.data_layout();

    // PORT (abi-lib): `u64::checked_add` in `bigint`.
    const bytes = BigInt(this.bytes()) + BigInt(offset.bytes());
    if (bytes > U64_MAX) return undefined;

    // PORT (abi-lib): the comparison is exact (`obj_size_bound` is a power of two); a result below it but beyond 2^53
    // is `unported` in `from_bytes`.
    return bytes < BigInt(dl.obj_size_bound()) ? Size.from_bytes(bytes) : undefined;
  }

  // #[inline]
  // PORT (abi-lib): `count: u64` is a `number` or a `bigint` (`u64_arg`; an array length is a `bigint`).
  // rustc: compiler/rustc_abi/src/lib.rs:948 checked_mul
  checked_mul(count: number | bigint, cx: HasDataLayout): Size | undefined {
    const dl = cx.data_layout();

    // PORT: `u64::checked_mul` in `bigint`; a product of 2^64 or more is `None` as upstream.
    const bytes = BigInt(this.bytes()) * u64_arg(count);
    if (bytes > U64_MAX) return undefined;
    return bytes < BigInt(dl.obj_size_bound()) ? Size.from_bytes(bytes) : undefined;
  }

  /// Truncates `value` to `self` bits and then sign-extends it to 128 bits
  /// (i.e., if it is negative, fill with 1's on the left).
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:958 sign_extend
  sign_extend(value: bigint): bigint {
    const size = this.bits();
    if (size === 0) {
      // Truncated until nothing is left.
      return 0n;
    }
    // Sign-extend it.
    const shift = BigInt(128 - size);
    // Shift the unsigned value to the left, then shift back to the right as signed
    // (essentially fills with sign bit on the left).
    return BigInt.asIntN(128, (value << shift) & U128_MAX) >> shift;
  }

  /// Truncates `value` to `self` bits.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:973 truncate
  truncate(value: bigint): bigint {
    const size = this.bits();
    if (size === 0) {
      // Truncated until nothing is left.
      return 0n;
    }
    const shift = BigInt(128 - size);
    // Truncate (shift left to drop out leftover values, shift right to fill with zeroes).
    return ((value << shift) & U128_MAX) >> shift;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:985 signed_int_min
  signed_int_min(): bigint {
    return this.sign_extend(1n << BigInt(this.bits() - 1));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:990 signed_int_max
  signed_int_max(): bigint {
    return I128_MAX >> BigInt(128 - this.bits());
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:995 unsigned_int_max
  unsigned_int_max(): bigint {
    return U128_MAX >> BigInt(128 - this.bits());
  }

  // Panicking addition, subtraction and multiplication for convenience.
  // Avoid during layout computation, return `LayoutError` instead.

  // impl Add for Size
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1006 add
  add(other: Size): Size {
    // `self.bytes().checked_add(other.bytes())` (in `bigint`)
    const bytes = BigInt(this.bytes()) + BigInt(other.bytes());
    if (bytes > U64_MAX) {
      return panic(`Size::add: ${this.bytes()} + ${other.bytes()} doesn't fit in u64`);
    }
    return Size.from_bytes(bytes);
  }

  // impl Sub for Size
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1016 sub
  sub(other: Size): Size {
    // `self.bytes().checked_sub(other.bytes())` (exact: both are safe integers)
    const bytes = this.bytes() - other.bytes();
    if (bytes < 0) {
      return panic(`Size::sub: ${this.bytes()} - ${other.bytes()} would result in negative size`);
    }
    return Size.from_bytes(bytes);
  }

  // impl Mul<Size> for u64
  // #[inline]
  // PORT (layout-contract): `count * size` is the static `Size.u64_mul(count, size)` (the `u64` side has no class).
  // PORT (abi-lib): `count: u64` is a `number` or a `bigint` (`u64_arg`).
  // rustc: compiler/rustc_abi/src/lib.rs:1026 mul
  static u64_mul(count: number | bigint, size: Size): Size {
    return size.mul(count);
  }

  // impl Mul<u64> for Size
  // #[inline]
  // PORT (abi-lib): `count: u64` is a `number` or a `bigint` (`u64_arg`).
  // rustc: compiler/rustc_abi/src/lib.rs:1034 mul
  mul(count: number | bigint): Size {
    const count_ = u64_arg(count);
    // `self.bytes().checked_mul(count)` (in `bigint`)
    const bytes = BigInt(this.bytes()) * count_;
    if (bytes <= U64_MAX) {
      return Size.from_bytes(bytes);
    } else {
      return panic(`Size::mul: ${this.bytes()} * ${count_} doesn't fit in u64`);
    }
  }

  // impl AddAssign for Size
  // #[inline]
  // PORT (layout-contract): `Size` is immutable (`raw` is readonly), so `a += b` is `a = a.add_assign(b)`, which
  // returns the new value.
  // rustc: compiler/rustc_abi/src/lib.rs:1044 add_assign
  add_assign(other: Size): Size {
    // `*self = *self + other;`
    return this.add(other);
  }
}
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const I128_MAX = (1n << 127n) - 1n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
/** The `unported(..)` path of a `Size` (or `Size::bits`) value beyond 2^53 - 1 (root decision, see `Size`). */
export const SIZE_BEYOND_2_53 = "rustc_abi::Size beyond 2^53 (Size.raw is a JS number)";
/**
 * PORT (abi-lib): a `u64` byte (or bit) count as a `number`, exact: beyond `Number.MAX_SAFE_INTEGER` it stops with
 * `unported(SIZE_BEYOND_2_53)` (rustc would compute it; rust-ts must not round it).
 */
function size_raw(v: bigint): number {
  if (v > MAX_SAFE) return unported(SIZE_BEYOND_2_53);
  return Number(v);
}
/**
 * PORT (abi-lib): an `impl TryInto<u64>` / `u64` argument as an exact `bigint`. Upstream's `try_into().ok().unwrap()`
 * panics for a value outside `u64` (a negative count); a `number` that is not a safe integer may already have been
 * rounded by the caller, so it stops with `unported(SIZE_BEYOND_2_53)` (pass a `bigint` for such values).
 */
function u64_arg(v: number | bigint): bigint {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) return unported(SIZE_BEYOND_2_53);
    v = BigInt(v);
  }
  if (v < 0n || v > U64_MAX) return panic("called `Option::unwrap()` on a `None` value");
  return v;
}
/** PORT (abi-lib): `<u64 as Step>`'s `usize` count (`n as u64` is exact: a safe integer). */
function usize_arg(n: number): bigint {
  if (!Number.isSafeInteger(n) || n < 0) return unported(SIZE_BEYOND_2_53);
  return BigInt(n);
}
// This is debug-printed a lot in larger structs, don't waste too much space there
// impl fmt::Debug for Size
// rustc: compiler/rustc_abi/src/lib.rs:880 fmt
export const debug_Size: Debug<Size> = (v) => `Size(${v.bytes()} bytes)`;

// #[cfg(feature = "nightly")]
// impl Step for Size
// PORT (layout-contract): `core::iter::Step` (ranges of `Size`) is the companion `Step_Size`; `usize` counts are numbers.
// PORT (abi-lib): `<u64 as Step>` (library/core/src/iter/range.rs, `step_integer_impls!` for a type no wider than
// `usize` on a 64-bit host) is inlined in `bigint`; `usize` results are exact (`size_raw`).
export const Step_Size = {
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1052 steps_between
  steps_between(start: Size, end: Size): [number, number | undefined] {
    // `u64::steps_between(&start.bytes(), &end.bytes())`
    if (start.bytes() <= end.bytes()) {
      const steps = end.bytes() - start.bytes();
      return [steps, steps];
    } else {
      return [0, undefined];
    }
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1057 forward_checked
  forward_checked(start: Size, count: number): Size | undefined {
    // `u64::forward_checked(start.bytes(), count)`: `start.checked_add(n)`
    const r = BigInt(start.bytes()) + usize_arg(count);
    return r > U64_MAX ? undefined : Size.from_bytes(r);
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1062 forward_overflowing
  forward_overflowing(start: Size, count: number): [Size, boolean] {
    // `u64::forward_overflowing(start.bytes(), count)`: `start.overflowing_add(n)`
    const r = BigInt(start.bytes()) + usize_arg(count);
    const [s, o] = [r & U64_MAX, r > U64_MAX];
    return [Size.from_bytes(s), o];
  },

  // #[inline]
  // PORT (abi-lib): `u64::forward` wraps (`#[rustc_inherit_overflow_checks]`; rustc is built without overflow checks).
  // rustc: compiler/rustc_abi/src/lib.rs:1068 forward
  forward(start: Size, count: number): Size {
    return Size.from_bytes((BigInt(start.bytes()) + usize_arg(count)) & U64_MAX);
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1073 forward_unchecked
  forward_unchecked(start: Size, count: number): Size {
    // SAFETY (upstream): the caller guarantees that `start + n` doesn't overflow.
    return Size.from_bytes(BigInt(start.bytes()) + usize_arg(count));
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1078 backward_checked
  backward_checked(start: Size, count: number): Size | undefined {
    // `u64::backward_checked(start.bytes(), count)`: `start.checked_sub(n)`
    const r = BigInt(start.bytes()) - usize_arg(count);
    return r < 0n ? undefined : Size.from_bytes(r);
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1083 backward_overflowing
  backward_overflowing(start: Size, count: number): [Size, boolean] {
    // `u64::backward_overflowing(start.bytes(), count)`: `start.overflowing_sub(n)`
    const r = BigInt(start.bytes()) - usize_arg(count);
    const [s, o] = [r & U64_MAX, r < 0n];
    return [Size.from_bytes(s), o];
  },

  // #[inline]
  // PORT (abi-lib): `u64::backward` wraps (as `forward`).
  // rustc: compiler/rustc_abi/src/lib.rs:1089 backward
  backward(start: Size, count: number): Size {
    return Size.from_bytes((BigInt(start.bytes()) - usize_arg(count)) & U64_MAX);
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1094 backward_unchecked
  backward_unchecked(start: Size, count: number): Size {
    // SAFETY (upstream): the caller guarantees that `start - n` doesn't overflow.
    return Size.from_bytes(BigInt(start.bytes()) - usize_arg(count));
  },
} as const;

/// Alignment of a type in bytes (always a power of two).
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
export class Align {
  constructor(readonly pow2: number) {}

  static readonly ONE: Align = new Align(0);
  static readonly EIGHT: Align = new Align(3);
  // LLVM has a maximal supported alignment of 2^29, we inherit that.
  static readonly MAX: Align = new Align(29);

  /// Either `1 << (pointer_bits - 1)` or [`Align::MAX`], whichever is smaller.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1142 max_for_target
  static max_for_target(tdl: TargetDataLayout): Align {
    const pointer_bits = tdl.pointer_size().bits();
    assert(pointer_bits <= 255, "called `Result::unwrap()` on an `Err` value");
    return Align_min(new Align(pointer_bits - 1), Align.MAX);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1148 from_bits
  static from_bits(bits: number): Result<Align, AlignFromBytesError> {
    return Align.from_bytes(Size.from_bits(bits).bytes());
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1153 from_bytes
  static from_bytes(align: number | bigint): Result<Align, AlignFromBytesError> {
    // PORT: `align: u64`; callers pass a `number` or (from `-Z min-function-alignment`) a `bigint`.
    const a = BigInt(align);
    // Treat an alignment of 0 bytes like 1-byte alignment.
    if (a === 0n) {
      return Ok(Align.ONE);
    }

    // #[cold]
    // rustc: compiler/rustc_abi/src/lib.rs:1160 not_power_of_2
    const not_power_of_2 = (align: bigint): AlignFromBytesError => ({ $: "NotPowerOfTwo", _0: align });

    // #[cold]
    // rustc: compiler/rustc_abi/src/lib.rs:1165 too_large
    const too_large = (align: bigint): AlignFromBytesError => ({ $: "TooLarge", _0: align });

    let tz = 0;
    while (((a >> BigInt(tz)) & 1n) === 0n) tz++;
    if (a !== 1n << BigInt(tz)) {
      return Err(not_power_of_2(a));
    }

    const pow2 = tz;
    if (pow2 > Align.MAX.pow2) {
      return Err(too_large(a));
    }

    return Ok(new Align(pow2));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1183 bytes
  bytes(): number {
    return 2 ** this.pow2;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1188 bytes_usize
  bytes_usize(): number {
    return this.bytes();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1193 bits
  bits(): number {
    return this.bytes() * 8;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1198 bits_usize
  bits_usize(): number {
    return this.bits();
  }

  /// Obtain the greatest factor of `size` that is an alignment
  /// (the largest power of two the Size is a multiple of).
  ///
  /// Note that all numbers are factors of 0
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1207 max_aligned_factor
  static max_aligned_factor(size: Size): Align {
    // `size.bytes().trailing_zeros() as u8` (`u64::trailing_zeros(0)` is 64)
    let b = BigInt(size.bytes());
    if (b === 0n) return new Align(64);
    let tz = 0;
    while ((b & 1n) === 0n) {
      b >>= 1n;
      tz++;
    }
    return new Align(tz);
  }

  /// Reduces Align to an aligned factor of `size`.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1213 restrict_for_offset
  restrict_for_offset(size: Size): Align {
    return Align_min(this, Align.max_aligned_factor(size));
  }
}
// derive(PartialEq): `Align { pow2 }` (instances are not unique, so compare the field).
export function Align_eq(a: Align, b: Align): boolean {
  return a.pow2 === b.pow2;
}
// derive(Ord): `Ord::min` / `Ord::max` (`max` returns `other` on ties, `min` returns `self`).
export function Align_min(a: Align, b: Align): Align {
  return b.pow2 < a.pow2 ? b : a;
}
export function Align_max(a: Align, b: Align): Align {
  return b.pow2 >= a.pow2 ? b : a;
}
// This is debug-printed a lot in larger structs, don't waste too much space there
// impl fmt::Debug for Align
// rustc: compiler/rustc_abi/src/lib.rs:1108 fmt
export const debug_Align: Debug<Align> = (v) => `Align(${v.bytes()} bytes)`;

// #[derive(Clone, Copy)]
// PORT: the `u64` payload is a `bigint` (it is the user's value, unbounded).
export type AlignFromBytesError = { readonly $: "NotPowerOfTwo"; readonly _0: bigint } | { readonly $: "TooLarge"; readonly _0: bigint };

// impl fmt::Display for AlignFromBytesError
// rustc: compiler/rustc_abi/src/lib.rs:1126 fmt
export function display_AlignFromBytesError(e: AlignFromBytesError): string {
  switch (e.$) {
    case "NotPowerOfTwo":
      return `${e._0} is not a power of 2`;
    case "TooLarge":
      return `${e._0} is too large`;
  }
}
// impl fmt::Debug for AlignFromBytesError
// rustc: compiler/rustc_abi/src/lib.rs:1120 fmt
export const debug_AlignFromBytesError: Debug<AlignFromBytesError> = (e) => display_AlignFromBytesError(e);

/// A pair of alignments, ABI-mandated and preferred.
///
/// The "preferred" alignment is an LLVM concept that is virtually meaningless to Rust code:
/// it is not exposed semantically to programmers nor can they meaningfully affect it.
/// The only concern for us is that preferred alignment must not be less than the mandated alignment
/// and thus in practice the two values are almost always identical.
///
/// An example of a rare thing actually affected by preferred alignment is aligning of statics.
/// It is of effectively no consequence for layout in structs and on the stack.
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export class AbiAlign {
  constructor(readonly abi: Align) {}

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1235 new
  static new(align: Align): AbiAlign {
    return new AbiAlign(align);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1240 min
  min(other: AbiAlign): AbiAlign {
    return new AbiAlign(Align_min(this.abi, other.abi));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1245 max
  max(other: AbiAlign): AbiAlign {
    return new AbiAlign(Align_max(this.abi, other.abi));
  }

  // impl Deref for AbiAlign (type Target = Align)
  // PORT (layout-contract): the auto-deref `abi_align.bytes()` is written `abi_align.abi.bytes()`; `deref()` is the
  // explicit `*abi_align`.
  // rustc: compiler/rustc_abi/src/lib.rs:1253 deref
  deref(): Align {
    return this.abi;
  }
}
// derive(Debug)
export const debug_AbiAlign: Debug<AbiAlign> = (v, f) => debug_struct(f, "AbiAlign", [["abi", debug_Align(v.abi, f)]]);

/// Integers, also used for enum discriminants.
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
export type Integer = "I8" | "I16" | "I32" | "I64" | "I128";
export const Integer = {
  I8: "I8",
  I16: "I16",
  I32: "I32",
  I64: "I64",
  I128: "I128",

  // rustc: compiler/rustc_abi/src/lib.rs:1270 int_ty_str
  int_ty_str(self: Integer): string {
    switch (self) {
      case "I8":
        return "i8";
      case "I16":
        return "i16";
      case "I32":
        return "i32";
      case "I64":
        return "i64";
      case "I128":
        return "i128";
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1281 uint_ty_str
  uint_ty_str(self: Integer): string {
    switch (self) {
      case "I8":
        return "u8";
      case "I16":
        return "u16";
      case "I32":
        return "u32";
      case "I64":
        return "u64";
      case "I128":
        return "u128";
    }
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1293 size
  size(self: Integer): Size {
    switch (self) {
      case "I8":
        return Size.from_bytes(1);
      case "I16":
        return Size.from_bytes(2);
      case "I32":
        return Size.from_bytes(4);
      case "I64":
        return Size.from_bytes(8);
      case "I128":
        return Size.from_bytes(16);
    }
  },

  /// Gets the Integer type from an IntegerType.
  // rustc: compiler/rustc_abi/src/lib.rs:1305 from_attr
  from_attr(cx: HasDataLayout, ity: IntegerType): Integer {
    const dl = cx.data_layout();

    switch (ity.$) {
      case "Pointer":
        return dl.ptr_sized_integer();
      case "Fixed":
        return ity._0;
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1314 align
  align(self: Integer, cx: HasDataLayout): AbiAlign {
    const dl = cx.data_layout();

    switch (self) {
      case "I8":
        return AbiAlign.new(dl.i8_align);
      case "I16":
        return AbiAlign.new(dl.i16_align);
      case "I32":
        return AbiAlign.new(dl.i32_align);
      case "I64":
        return AbiAlign.new(dl.i64_align);
      case "I128":
        return AbiAlign.new(dl.i128_align);
    }
  },

  /// Returns the largest signed value that can be represented by this Integer.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1329 signed_max
  signed_max(self: Integer): bigint {
    switch (self) {
      case "I8":
        return 0x7fn;
      case "I16":
        return 0x7fffn;
      case "I32":
        return 0x7fff_ffffn;
      case "I64":
        return 0x7fff_ffff_ffff_ffffn;
      case "I128":
        return (1n << 127n) - 1n;
    }
  },

  /// Returns the smallest signed value that can be represented by this Integer.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1342 signed_min
  signed_min(self: Integer): bigint {
    switch (self) {
      case "I8":
        return -0x80n;
      case "I16":
        return -0x8000n;
      case "I32":
        return -0x8000_0000n;
      case "I64":
        return -0x8000_0000_0000_0000n;
      case "I128":
        return -(1n << 127n);
    }
  },

  /// Finds the smallest Integer type which can represent the signed value.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1355 fit_signed
  fit_signed(x: bigint): Integer {
    if (x >= -0x80n && x <= 0x7fn) return "I8";
    if (x >= -0x8000n && x <= 0x7fffn) return "I16";
    if (x >= -0x8000_0000n && x <= 0x7fff_ffffn) return "I32";
    if (x >= -0x8000_0000_0000_0000n && x <= 0x7fff_ffff_ffff_ffffn) return "I64";
    return "I128";
  },

  /// Finds the smallest Integer type which can represent the unsigned value.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1368 fit_unsigned
  fit_unsigned(x: bigint): Integer {
    if (x >= 0n && x <= 0xffn) return "I8";
    if (x >= 0n && x <= 0xffffn) return "I16";
    if (x >= 0n && x <= 0xffff_ffffn) return "I32";
    if (x >= 0n && x <= 0xffff_ffff_ffff_ffffn) return "I64";
    return "I128";
  },

  /// Finds the smallest integer with the given alignment.
  // rustc: compiler/rustc_abi/src/lib.rs:1380 for_align
  for_align(cx: HasDataLayout, wanted: Align): Integer | undefined {
    const dl = cx.data_layout();

    return (["I8", "I16", "I32", "I64", "I128"] as const).find(
      (candidate) => Align_eq(wanted, Integer.align(candidate, dl).abi) && wanted.bytes() === Integer.size(candidate).bytes(),
    );
  },

  /// Find the largest integer with the given alignment or less.
  // rustc: compiler/rustc_abi/src/lib.rs:1390 approximate_align
  approximate_align(cx: HasDataLayout, wanted: Align): Integer {
    const dl = cx.data_layout();

    // FIXME(eddyb) maybe include I128 in the future, when it works everywhere.
    for (const candidate of ["I64", "I32", "I16"] as const) {
      if (wanted.pow2 >= Integer.align(candidate, dl).abi.pow2 && wanted.bytes() >= Integer.size(candidate).bytes()) {
        return candidate;
      }
    }
    return "I8";
  },

  // FIXME(eddyb) consolidate this and other methods that find the appropriate
  // `Integer` given some requirements.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1406 from_size
  from_size(size: Size): Result<Integer, string> {
    switch (size.bits()) {
      case 8:
        return Ok("I8");
      case 16:
        return Ok("I16");
      case 32:
        return Ok("I32");
      case 64:
        return Ok("I64");
      case 128:
        return Ok("I128");
      default:
        return Err(`rust does not support integers with ${size.bits()} bits`);
    }
  },
} as const;
// derive(Debug)
export const debug_Integer: Debug<Integer> = (v) => v;
/// Floating-point types.
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
export type Float =
  | "F16"
  /// `f16b`. This is not a builtin type in Rust (it is exposed as a lang item),
  /// but it is a builtin type in LLVM so needs to be explicitly represented
  /// in the backend.
  | "F16B"
  | "F32"
  | "F64"
  | "F128"
  /// `ppcf128`. This is not a builtin type in Rust (it is exposed as a lang item),
  /// but it is a builtin type in LLVM so needs to be explicitly represented
  /// in the backend.
  | "PpcF128";
export const Float = {
  F16: "F16",
  F16B: "F16B",
  F32: "F32",
  F64: "F64",
  F128: "F128",
  PpcF128: "PpcF128",

  // rustc: compiler/rustc_abi/src/lib.rs:1437 size
  size(self: Float): Size {
    // use Float::*;

    switch (self) {
      case "F16":
        return Size.from_bits(16);
      case "F16B":
        return Size.from_bits(16);
      case "F32":
        return Size.from_bits(32);
      case "F64":
        return Size.from_bits(64);
      case "F128":
        return Size.from_bits(128);
      case "PpcF128":
        return Size.from_bits(128);
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1450 align
  align(self: Float, cx: HasDataLayout): AbiAlign {
    // use Float::*;
    const dl = cx.data_layout();

    let align: Align;
    switch (self) {
      case "F16":
      case "F16B":
        align = dl.f16_align;
        break;
      case "F32":
        align = dl.f32_align;
        break;
      case "F64":
        align = dl.f64_align;
        break;
      case "F128":
        align = dl.f128_align;
        break;
      case "PpcF128":
        align = dl.f128_align;
        break;
    }
    return AbiAlign.new(align);
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1463 ty_str
  ty_str(self: Float): string {
    // use Float::*;

    switch (self) {
      case "F16":
        return "f16";
      case "F16B":
        return "f16b";
      case "F32":
        return "f32";
      case "F64":
        return "f64";
      case "F128":
        return "f128";
      case "PpcF128":
        return "ppcf128";
    }
  },
} as const;
// derive(Debug)
export const debug_Float: Debug<Float> = (v) => v;
/** `<Float as Ord>` (derived: declaration order). */
export const Float_discriminant: Record<Float, number> = { F16: 0, F16B: 1, F32: 2, F64: 3, F128: 4, PpcF128: 5 };

/// Numeric primitives.
// #[derive(Copy, Clone, PartialEq, Eq, Hash)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
export type Numeric =
  /// The `bool` is the signedness of the `Integer` type.
  | { readonly $: "Int"; readonly _0: Integer; readonly _1: boolean }
  | { readonly $: "Float"; readonly _0: Float };
export const Numeric = {
  // rustc: compiler/rustc_abi/src/lib.rs:1487 size
  size(self: Numeric): Size {
    switch (self.$) {
      case "Int":
        return Integer.size(self._0);
      case "Float":
        return Float.size(self._0);
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1494 reg_kind
  reg_kind(self: Numeric): RegKind {
    switch (self.$) {
      case "Int":
        return RegKind.Integer;
      case "Float":
        if (self._0 === "PpcF128") return RegKind.PpcF128;
        // Numeric::Float(Float::F16 | Float::F16B | Float::F32 | Float::F64 | Float::F128)
        return RegKind.Float;
    }
  },
} as const;
/** derive(PartialEq) */
export function Numeric_eq(a: Numeric, b: Numeric): boolean {
  return intern_key(a) === intern_key(b);
}

/// Fundamental unit of memory access and layout.
// #[derive(Copy, Clone, PartialEq, Eq, Hash)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
export type Primitive =
  /// The `bool` is the signedness of the `Integer` type.
  ///
  /// One would think we would not care about such details this low down,
  /// but some ABIs are described in terms of C types and ISAs where the
  /// integer arithmetic is done on {sign,zero}-extended registers, e.g.
  /// a negative integer passed by zero-extension will appear positive in
  /// the callee, and most operations on it will produce the wrong values.
  | { readonly $: "Int"; readonly _0: Integer; readonly _1: boolean }
  | { readonly $: "Float"; readonly _0: Float }
  | { readonly $: "Pointer"; readonly _0: AddressSpace };
export const Primitive = {
  // rustc: compiler/rustc_abi/src/lib.rs:1545 size
  size(self: Primitive, cx: HasDataLayout): Size {
    // use Primitive::*;
    const dl = cx.data_layout();

    switch (self.$) {
      case "Int":
        return Integer.size(self._0);
      case "Float":
        return Float.size(self._0);
      case "Pointer":
        return dl.pointer_size_in(self._0);
    }
  },

  /// The *platform-specific* ABI alignment of this primitive.
  ///
  /// This is the type alignment for the corresponding built-in.
  /// In other contexts it might have different alignment.
  // rustc: compiler/rustc_abi/src/lib.rs:1560 default_align
  default_align(self: Primitive, cx: HasDataLayout): AbiAlign {
    // use Primitive::*;
    const dl = cx.data_layout();

    switch (self.$) {
      case "Int":
        return Integer.align(self._0, dl);
      case "Float":
        return Float.align(self._0, dl);
      case "Pointer":
        return dl.pointer_align_in(self._0);
    }
  },
} as const;
/** derive(PartialEq) */
export function Primitive_eq(a: Primitive, b: Primitive): boolean {
  switch (a.$) {
    case "Int":
      return b.$ === "Int" && a._0 === b._0 && a._1 === b._1;
    case "Float":
      return b.$ === "Float" && a._0 === b._0;
    case "Pointer":
      return b.$ === "Pointer" && a._0 === b._0;
  }
}
// impl fmt::Debug for Primitive
// rustc: compiler/rustc_abi/src/lib.rs:1522 fmt
export const debug_Primitive: Debug<Primitive> = (self, f) => {
  let name: string;
  switch (self.$) {
    case "Int": {
      const [integer, is_signed] = [self._0, self._1];
      if (is_signed) {
        name = Integer.int_ty_str(integer);
      } else {
        name = Integer.uint_ty_str(integer);
      }
      break;
    }
    case "Float":
      name = Float.ty_str(self._0);
      break;
    case "Pointer": {
      const addr_space = self._0;
      if (addr_space === AddressSpace.ZERO) {
        name = "pointer";
      } else {
        return `pointer(${debug_AddressSpace(addr_space, f)})`;
      }
      break;
    }
  }
  return name;
};

/// Information about one scalar component of a Rust type.
// #[derive(Clone, Copy, PartialEq, Eq, Hash)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): `valid_range` of `Initialized` is mutable (`Scalar::valid_range_mut`); a `Scalar` is `Copy`,
// so one that is mutated must be a fresh object (`{ ...scalar }`), never one shared with another layout
// (layout-contract conventions; interned layouts are deep-frozen, so a stray write throws).
export type Scalar =
  | {
      readonly $: "Initialized";
      readonly value: Primitive;

      // FIXME(eddyb) always use the shortest range, e.g., by finding
      // the largest space between two consecutive valid values and
      // taking everything else as the (shortest) valid range.
      valid_range: WrappingRange;
    }
  | {
      readonly $: "Union";
      /// Even for unions, we need to use the correct registers for the kind of
      /// values inside the union, so we keep the `Primitive` type around. We
      /// also use it to compute the size of the scalar.
      /// However, unions never have niches and even allow undef,
      /// so there is no `valid_range`.
      readonly value: Primitive;
    };
export const Scalar = {
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1614 is_bool
  is_bool(self: Scalar): boolean {
    // use Integer::*;
    return (
      self.$ === "Initialized" &&
      self.value.$ === "Int" &&
      self.value._0 === "I8" &&
      self.value._1 === false &&
      self.valid_range.start === 0n &&
      self.valid_range.end === 1n
    );
  },

  /// Get the primitive representation of this type, ignoring the valid range and whether the
  /// value is allowed to be undefined (due to being a union).
  // rustc: compiler/rustc_abi/src/lib.rs:1627 primitive
  primitive(self: Scalar): Primitive {
    // Scalar::Initialized { value, .. } | Scalar::Union { value } => value
    return self.value;
  },

  /// The *platform-specific* ABI alignment of this scalar.
  ///
  /// This is the type alignment for the corresponding built-in.
  /// This is *not* necessarily the correct alignment for a type that has this `BackendRepr::Scalar`!
  // rustc: compiler/rustc_abi/src/lib.rs:1637 default_align
  default_align(self: Scalar, cx: HasDataLayout): AbiAlign {
    return Primitive.default_align(Scalar.primitive(self), cx);
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1641 size
  size(self: Scalar, cx: HasDataLayout): Size {
    return Primitive.size(Scalar.primitive(self), cx);
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1646 to_union
  to_union(self: Scalar): Scalar {
    return { $: "Union", value: Scalar.primitive(self) };
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1651 valid_range
  valid_range(self: Scalar, cx: HasDataLayout): WrappingRange {
    switch (self.$) {
      case "Initialized":
        return self.valid_range;
      case "Union":
        return WrappingRange.full(Primitive.size(self.value, cx));
    }
  },

  // #[inline]
  /// Allows the caller to mutate the valid range. This operation will panic if attempted on a
  /// union.
  // PORT (layout-contract): `&mut WrappingRange` is a `MutRef` over `self.valid_range` (PORTING §8); `WrappingRange`
  // is immutable, so `*scalar.valid_range_mut() = r` / `.start = s` are `r_.value = r` / `r_.value = r_.value.with_start(s)`.
  // rustc: compiler/rustc_abi/src/lib.rs:1661 valid_range_mut
  valid_range_mut(self: Scalar): MutRef<WrappingRange> {
    switch (self.$) {
      case "Initialized":
        return field_mut(self, "valid_range");
      case "Union":
        return panic("cannot change the valid range of a union");
    }
  },

  /// Returns `true` if all possible numbers are valid, i.e `valid_range` covers the whole
  /// layout.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1671 is_always_valid
  is_always_valid(self: Scalar, cx: HasDataLayout): boolean {
    switch (self.$) {
      case "Initialized":
        return self.valid_range.is_full_for(Scalar.size(self, cx));
      case "Union":
        return true;
    }
  },

  /// Returns `true` if this type can be left uninit.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1680 is_uninit_valid
  is_uninit_valid(self: Scalar): boolean {
    switch (self.$) {
      case "Initialized":
        return false;
      case "Union":
        return true;
    }
  },

  /// Returns `true` if this is a signed integer scalar
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1689 is_signed
  is_signed(self: Scalar): boolean {
    const p = Scalar.primitive(self);
    switch (p.$) {
      case "Int":
        return p._1;
      default:
        return false;
    }
  },
} as const;
/** derive(PartialEq) */
export function Scalar_eq(a: Scalar, b: Scalar): boolean {
  switch (a.$) {
    case "Initialized":
      return b.$ === "Initialized" && Primitive_eq(a.value, b.value) && WrappingRange_eq(a.valid_range, b.valid_range);
    case "Union":
      return b.$ === "Union" && Primitive_eq(a.value, b.value);
  }
}
// impl fmt::Debug for Scalar
// rustc: compiler/rustc_abi/src/lib.rs:1595 fmt
export const debug_Scalar: Debug<Scalar> = (self, f) => {
  switch (self.$) {
    case "Initialized": {
      const { value, valid_range } = self;
      let size: Size;
      let is_signed: boolean;
      switch (value.$) {
        case "Int":
          [size, is_signed] = [Integer.size(value._0), value._1];
          break;
        case "Float":
          [size, is_signed] = [Float.size(value._0), false];
          break;
        case "Pointer":
          [size, is_signed] = [Size.from_bits(128), false];
          break;
      }
      return `${debug_Primitive(value, f)} is ${valid_range.debug_as(size, is_signed)(f)}`;
    }
    case "Union": {
      const { value } = self;
      return `union ${debug_Primitive(value, f)}`;
    }
  }
};

// NOTE: This struct is generic over the FieldIdx for rust-analyzer usage.
/// Describes how the fields of a type are located in memory.
// #[derive(PartialEq, Eq, Hash, Clone, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): the `FieldIdx: Idx` parameter is erased (rustc instantiates it with `rustc_abi::FieldIdx`
// only); `NonZero<usize>` is a `number`; `count: u64` is a `bigint` (an array length: `[(); usize::MAX]` has one).
export type FieldsShape =
  /// Scalar primitives and `!`, which never have fields.
  | { readonly $: "Primitive" }

  /// All fields start at no offset. The `usize` is the field count.
  | { readonly $: "Union"; readonly _0: number }

  /// Array/vector-like placement, with all fields of identical types.
  | { readonly $: "Array"; readonly stride: Size; readonly count: bigint }

  /// Struct-like placement, with precomputed offsets.
  ///
  /// Fields are guaranteed to not overlap, but note that gaps
  /// before, between and after all the fields are NOT always
  /// padding, and as such their contents may not be discarded.
  /// For example, enum variants leave a gap at the start,
  /// where the discriminant field in the enum layout goes.
  | {
      readonly $: "Arbitrary";
      /// Offsets for the first byte of each field,
      /// ordered to match the source definition order.
      /// This vector does not go in increasing order.
      // FIXME(eddyb) use small vector optimization for the common case.
      readonly offsets: Size[];

      /// Maps memory order field indices to source order indices,
      /// depending on how the fields were reordered (if at all).
      /// This is a permutation, with both the source order and the
      /// memory order using the same (0..n) index ranges.
      ///
      // FIXME(eddyb) build a better abstraction for permutations, if possible.
      // FIXME(camlorn) also consider small vector optimization here.
      readonly in_memory_order: FieldIdx[];
    };
export const FieldsShape = {
  Primitive: Object.freeze({ $: "Primitive" }) as FieldsShape,

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1738 count
  count(self: FieldsShape): number {
    switch (self.$) {
      case "Primitive":
        return 0;
      case "Union":
        return self._0;
      case "Array":
        // PORT (abi-lib): `count.try_into().unwrap()` (`u64` -> `usize`, infallible on a 64-bit host); the `usize` is a
        // `number`, so a count beyond 2^53 stops as `unported` instead of rounding.
        if (self.count > MAX_SAFE) return unported("rustc_abi::FieldsShape::count (array length beyond 2^53)");
        return Number(self.count);
      case "Arbitrary":
        return self.offsets.length;
    }
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1748 offset
  offset(self: FieldsShape, i: number): Size {
    switch (self.$) {
      case "Primitive":
        return unreachable("internal error: entered unreachable code: FieldsShape::offset: `Primitive`s have no fields");
      case "Union": {
        const count = self._0;
        assert(i < count, `tried to access field ${i} of union with ${count} fields`);
        return Size.ZERO;
      }
      case "Array": {
        const { stride, count } = self;
        const i_ = BigInt(i);
        assert(i_ < count, `tried to access field ${i} of array with ${count} fields`);
        return stride.mul(i_);
      }
      case "Arbitrary": {
        const offsets = self.offsets;
        const idx = FieldIdx.new(i);
        // PORT (abi-lib): `IndexVec` indexing panics out of bounds.
        if (idx >= offsets.length) return panic(`index out of bounds: the len is ${offsets.length} but the index is ${idx}`);
        return offsets[idx]!;
      }
    }
  },

  /// Gets source indices of the fields by increasing offsets.
  // #[inline]
  // PORT (layout-contract): `impl ExactSizeIterator<Item = usize>` is an array.
  // rustc: compiler/rustc_abi/src/lib.rs:1768 index_by_increasing_offset
  index_by_increasing_offset(self: FieldsShape): number[] {
    // Primitives don't really have fields in the way that structs do,
    // but having this return an empty iterator for them is unhelpful
    // since that makes them look kinda like ZSTs, which they're not.
    const pseudofield_count = self.$ === "Primitive" ? 1 : FieldsShape.count(self);

    const out: number[] = [];
    for (let i = 0; i < pseudofield_count; i++) {
      switch (self.$) {
        case "Primitive":
        case "Union":
        case "Array":
          out.push(i);
          break;
        case "Arbitrary": {
          // PORT (abi-lib): `IndexVec` indexing panics out of bounds.
          const f = self.in_memory_order[i];
          if (f === undefined) return panic(`index out of bounds: the len is ${self.in_memory_order.length} but the index is ${i}`);
          out.push(FieldIdx.index(f));
          break;
        }
      }
    }
    return out;
  },
} as const;
/** derive(PartialEq) (PORT (layout-contract): the derived equality is the intern key's, rust_ts/intern_key.ts) */
export function FieldsShape_eq(a: FieldsShape, b: FieldsShape): boolean {
  return intern_key(a) === intern_key(b);
}
// derive(Debug)
export const debug_FieldsShape: Debug<FieldsShape> = (v, f) => {
  switch (v.$) {
    case "Primitive":
      return "Primitive";
    case "Union":
      return debug_tuple(f, "Union", [debug_int(v._0, f)]);
    case "Array":
      return debug_struct(f, "Array", [
        ["stride", debug_Size(v.stride, f)],
        ["count", debug_int(v.count, f)],
      ]);
    case "Arbitrary":
      return debug_struct(f, "Arbitrary", [
        ["offsets", debug_vec(v.offsets, f, debug_Size)],
        ["in_memory_order", debug_vec(v.in_memory_order, f, debug_int)],
      ]);
  }
};

/// An identifier that specifies the address space that some operation
/// should operate on. Special address spaces have an effect on code generation,
/// depending on the target and the address spaces it implements.
// #[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
// PORT: the `u32` newtype is a branded number (equality is `===`).
export type AddressSpace = number & { readonly __brand: "AddressSpace" };
export const AddressSpace = {
  /// LLVM's `0` address space.
  ZERO: 0 as AddressSpace,
  /// The address space for constant memory on nvptx and amdgpu.
  /// This address space is used e.g. for kernel arguments that are constant throughout the
  /// execution.
  GPU_CONSTANT: 4 as AddressSpace,
  /// The address space for workgroup memory on nvptx and amdgpu.
  /// See e.g. the `gpu_launch_sized_workgroup_mem` intrinsic for details.
  GPU_WORKGROUP: 3 as AddressSpace,
} as const;
export const debug_AddressSpace: Debug<AddressSpace> = (v) => `AddressSpace(${v})`;

/// How many scalable vectors are in a `BackendRepr::ScalableVector`?
// #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): the `u8` newtype is a branded number (equality is `===`).
export type NumScalableVectors = number & { readonly __brand: "NumScalableVectors" };
export const NumScalableVectors = {
  /// Returns a `NumScalableVector` for a non-tuple scalable vector (e.g. a single vector).
  // rustc: compiler/rustc_abi/src/lib.rs:1807 for_non_tuple
  for_non_tuple(): NumScalableVectors {
    return 1 as NumScalableVectors;
  },

  // Returns `NumScalableVectors` for values of two through eight, which are a valid number of
  // fields for a tuple of scalable vectors to have. `1` is a valid value of `NumScalableVectors`
  // but not for a tuple which would have a field count.
  // rustc: compiler/rustc_abi/src/lib.rs:1814 from_field_count
  from_field_count(count: number): NumScalableVectors | undefined {
    // `2..8` (exclusive, as upstream)
    if (count >= 2 && count < 8) {
      return count as NumScalableVectors;
    } else {
      return undefined;
    }
  },
} as const;
// derive(Debug)
export const debug_NumScalableVectors: Debug<NumScalableVectors> = (v, f) => debug_tuple(f, "NumScalableVectors", [debug_int(v, f)]);

// #[cfg(feature = "nightly")]
// impl IntoDiagArg for NumScalableVectors
// rustc: compiler/rustc_abi/src/lib.rs:1824 into_diag_arg
export function NumScalableVectors_into_diag_arg(self: NumScalableVectors, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self as number) {
    case 0:
      return panic("`NumScalableVectors(0)` is illformed");
    case 1:
      s = "one";
      break;
    case 2:
      s = "two";
      break;
    case 3:
      s = "three";
      break;
    case 4:
      s = "four";
      break;
    case 5:
      s = "five";
      break;
    case 6:
      s = "six";
      break;
    case 7:
      s = "seven";
      break;
    case 8:
      s = "eight";
      break;
    default:
      return panic("`NumScalableVectors(N)` for N>8 is illformed");
  }
  return { $: "Str", _0: s };
}

/// The way we represent values to the backend
///
/// Previously this was conflated with the "ABI" a type is given, as in the platform-specific ABI.
/// In reality, this implies little about that, but is mostly used to describe the syntactic form
/// emitted for the backend, as most backends handle SSA values and blobs of memory differently.
/// The psABI may need consideration in doing so, but this enum does not constitute a promise for
/// how the value will be lowered to the calling convention, in itself.
///
/// Generally, a codegen backend will prefer to handle smaller values as a scalar or short vector,
/// and larger values will usually prefer to be represented as memory.
// #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
export type BackendRepr =
  | { readonly $: "Scalar"; readonly _0: Scalar }
  /// The data contained in this type can be entirely represented by two scalars.
  /// The two scalars are listed in *memory* order, so `a` is at offset zero
  /// and `b` is at non-zero offset `b_offset`.
  /// These need not be `FieldIdx(0)` and `FieldIdx(1)`.
  ///
  /// As of June 2026 the `b_offset` is always the size of the `a`
  /// scalar rounded up to the platform alignment of the `b` scalar.
  /// That may soon change, however; see MCP#1007.
  | { readonly $: "ScalarPair"; readonly a: Scalar; readonly b: Scalar; readonly b_offset: Size }
  | { readonly $: "SimdScalableVector"; readonly element: Scalar; readonly count: BackendLaneCount; readonly number_of_vectors: NumScalableVectors }
  | { readonly $: "SimdVector"; readonly element: Scalar; readonly count: BackendLaneCount }
  // FIXME: I sometimes use memory, sometimes use an IR aggregate!
  | {
      readonly $: "Memory";
      /// If true, the size is exact, otherwise it's only a lower bound.
      readonly sized: boolean;
    };
export const BackendRepr = {
  /// Returns `true` if the layout corresponds to an unsized type.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1886 is_unsized
  is_unsized(self: BackendRepr): boolean {
    switch (self.$) {
      case "Scalar":
      case "ScalarPair":
      // FIXME(rustc_scalable_vector): Scalable vectors are `Sized` while the
      // `sized_hierarchy` feature is not yet fully implemented. After `sized_hierarchy` is
      // fully implemented, scalable vectors will remain `Sized`, they just won't be
      // `const Sized` - whether `is_unsized` continues to return `false` at that point will
      // need to be revisited and will depend on what `is_unsized` is used for.
      case "SimdScalableVector":
      case "SimdVector":
        return false;
      case "Memory":
        return !self.sized;
    }
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1902 is_sized
  is_sized(self: BackendRepr): boolean {
    return !BackendRepr.is_unsized(self);
  },

  /// Returns `true` if this is a single signed integer scalar.
  /// Sanity check: panics if this is not a scalar type (see PR #70189).
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1909 is_signed
  is_signed(self: BackendRepr): boolean {
    switch (self.$) {
      case "Scalar":
        return Scalar.is_signed(self._0);
      default:
        return panic(`\`is_signed\` on non-scalar ABI ${debug_BackendRepr(self, PLAIN)}`);
    }
  },

  /// Returns `true` if this is specifically a [`Self::Scalar`] type.
  ///
  /// This excludes SIMD types.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1920 is_scalar
  is_scalar(self: BackendRepr): boolean {
    return self.$ === "Scalar";
  },

  /// Returns `true` if this is a scalar type or SIMD type.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1926 is_scalar_or_simd
  is_scalar_or_simd(self: BackendRepr): boolean {
    return self.$ === "Scalar" || self.$ === "SimdVector" || self.$ === "SimdScalableVector";
  },

  /// Returns `true` if this is a bool
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1937 is_bool
  is_bool(self: BackendRepr): boolean {
    return self.$ === "Scalar" && Scalar.is_bool(self._0);
  },

  /// The psABI alignment for a `Scalar` or `ScalarPair`
  ///
  /// `None` for other variants.
  ///
  /// It's unclear whether this is a meaningful operation, and MCP#1007 proposes changes.
  /// You should generally be using the alignment of the place or the type,
  /// not calculating something from the `Scalar`s.
  // rustc: compiler/rustc_abi/src/lib.rs:1948 scalar_platform_align
  scalar_platform_align(self: BackendRepr, cx: HasDataLayout): Align | undefined {
    switch (self.$) {
      case "Scalar":
        return Scalar.default_align(self._0, cx).abi;
      case "ScalarPair": {
        const { a: s1, b: s2 } = self;
        return Scalar.default_align(s1, cx).max(Scalar.default_align(s2, cx)).abi;
      }
      // The align of a Vector can vary in surprising ways
      case "SimdVector":
      case "Memory":
      case "SimdScalableVector":
        return undefined;
    }
  },

  /// The psABI size for a `Scalar` or `ScalarPair`
  ///
  /// `None` for other variants
  // rustc: compiler/rustc_abi/src/lib.rs:1964 scalar_size
  scalar_size(self: BackendRepr, cx: HasDataLayout): Size | undefined {
    switch (self.$) {
      // No padding in scalars.
      case "Scalar":
        return Scalar.size(self._0, cx);
      // May have some padding between the pair.
      case "ScalarPair": {
        const { b: s2, b_offset: field2_offset } = self;
        const align = BackendRepr.scalar_platform_align(self, cx);
        // We absolutely must have an answer here or everything is FUBAR.
        if (align === undefined) return panic("called `Option::unwrap()` on a `None` value");
        const size = field2_offset.add(Scalar.size(s2, cx)).align_to(align);
        return size;
      }
      // The size of a Vector can vary in surprising ways
      case "SimdVector":
      case "Memory":
      case "SimdScalableVector":
        return undefined;
    }
  },

  /// Discard validity range information and allow undef.
  // rustc: compiler/rustc_abi/src/lib.rs:1985 to_union
  to_union(self: BackendRepr): BackendRepr {
    switch (self.$) {
      case "Scalar":
        return { $: "Scalar", _0: Scalar.to_union(self._0) };
      case "ScalarPair": {
        const { a: s1, b: s2, b_offset } = self;
        return { $: "ScalarPair", a: Scalar.to_union(s1), b: Scalar.to_union(s2), b_offset };
      }
      case "SimdVector": {
        const { element, count } = self;
        return { $: "SimdVector", element: Scalar.to_union(element), count };
      }
      case "Memory":
        return { $: "Memory", sized: true };
      case "SimdScalableVector": {
        const { element, count, number_of_vectors } = self;
        return {
          $: "SimdScalableVector",
          element: Scalar.to_union(element),
          count,
          number_of_vectors,
        };
      }
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:2005 eq_up_to_validity
  eq_up_to_validity(self: BackendRepr, other: BackendRepr): boolean {
    // Scalar, Vector, ScalarPair have `Scalar` in them where we ignore validity ranges.
    // We do *not* ignore the sign since it matters for some ABIs (e.g. s390x).
    if (self.$ === "Scalar" && other.$ === "Scalar") {
      const [l, r] = [self._0, other._0];
      return Primitive_eq(Scalar.primitive(l), Scalar.primitive(r));
    } else if (self.$ === "SimdVector" && other.$ === "SimdVector") {
      const { element: element_l, count: count_l } = self;
      const { element: element_r, count: count_r } = other;
      return Primitive_eq(Scalar.primitive(element_l), Scalar.primitive(element_r)) && count_l === count_r;
    } else if (self.$ === "ScalarPair" && other.$ === "ScalarPair") {
      const { a: l1, b: l2, b_offset: l_offset } = self;
      const { a: r1, b: r2, b_offset: r_offset } = other;
      return (
        Primitive_eq(Scalar.primitive(l1), Scalar.primitive(r1)) &&
        Primitive_eq(Scalar.primitive(l2), Scalar.primitive(r2)) &&
        l_offset.raw === r_offset.raw
      );
    }
    // Everything else must be strictly identical.
    else {
      return BackendRepr_eq(self, other);
    }
  },
} as const;
/** derive(PartialEq) (PORT (layout-contract): the derived equality is the intern key's, rust_ts/intern_key.ts) */
export function BackendRepr_eq(a: BackendRepr, b: BackendRepr): boolean {
  return intern_key(a) === intern_key(b);
}
// derive(Debug)
export const debug_BackendRepr: Debug<BackendRepr> = (v, f) => {
  switch (v.$) {
    case "Scalar":
      return debug_tuple(f, "Scalar", [debug_Scalar(v._0, f)]);
    case "ScalarPair":
      return debug_struct(f, "ScalarPair", [
        ["a", debug_Scalar(v.a, f)],
        ["b", debug_Scalar(v.b, f)],
        ["b_offset", debug_Size(v.b_offset, f)],
      ]);
    case "SimdScalableVector":
      return debug_struct(f, "SimdScalableVector", [
        ["element", debug_Scalar(v.element, f)],
        ["count", debug_BackendLaneCount(v.count, f)],
        ["number_of_vectors", debug_NumScalableVectors(v.number_of_vectors, f)],
      ]);
    case "SimdVector":
      return debug_struct(f, "SimdVector", [
        ["element", debug_Scalar(v.element, f)],
        ["count", debug_BackendLaneCount(v.count, f)],
      ]);
    case "Memory":
      return debug_struct(f, "Memory", [["sized", debug_bool(v.sized, f)]]);
  }
};

/// `core::range::RangeInclusive<Idx>` (fields `start`, `last`).
// PORT (layout-contract): local shape of the std type (src/std has no `core::range` yet); its `Debug` is
// `{start:?}..={last:?}` (library/core/src/range.rs:262).
export interface RangeInclusive<Idx> {
  readonly start: Idx;
  readonly last: Idx;
}
export function debug_RangeInclusive<Idx>(v: RangeInclusive<Idx>, f: Fmt, debug_Idx: Debug<Idx>): string {
  return `${debug_Idx(v.start, f)}..=${debug_Idx(v.last, f)}`;
}

/// Describes the variants of a type.
// NOTE: This struct is generic over the FieldIdx and VariantIdx for rust-analyzer usage.
// #[derive(PartialEq, Eq, Hash, Clone, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): `FieldIdx` / `VariantIdx` parameters erased (rustc's `rustc_abi::{FieldIdx, VariantIdx}`).
export type Variants =
  /// The type has no valid variants. Must be uninhabited.
  ///
  /// This is the case for:
  /// 1. enums with no inhabited variants
  /// 2. the never type
  | { readonly $: "Empty" }

  /// The type has a single valid variant. Such types are called "univariant".
  ///
  /// This is the case for:
  /// 1. enums with a single inhabited variant, aka. "univariant enums"
  /// 2. structs, unions, and non-ADTs (except coroutines; see below),
  ///    as those can't have multiple variants
  | {
      readonly $: "Single";
      /// - for case 1, this is the index of the inhabited variant
      /// - for case 2, this is always `0` (a dummy value)
      readonly index: VariantIdx;
    }

  /// The type has multiple valid variants.
  ///
  /// This is the case for:
  /// 1. enums with multiple inhabited variants
  /// 2. coroutines
  ///
  /// Each variant comes with a *discriminant* (usually the same as the
  /// variant index but the user can assign explicit discriminant values).
  /// That discriminant is encoded as a *tag* on the machine. The layout of
  /// each variant is a struct, and they all have space reserved for the tag.
  /// For enums, the tag is the sole field of the layout.
  | {
      readonly $: "Multiple";
      readonly tag: Scalar;
      readonly tag_encoding: TagEncoding;
      readonly tag_field: FieldIdx;
      readonly variants: VariantLayout[];
    };
export const Variants = {
  Empty: Object.freeze({ $: "Empty" }) as Variants,
} as const;
/** derive(PartialEq) (PORT (layout-contract): the derived equality is the intern key's, rust_ts/intern_key.ts) */
export function Variants_eq(a: Variants, b: Variants): boolean {
  return intern_key(a) === intern_key(b);
}
// derive(Debug)
export const debug_Variants: Debug<Variants> = (v, f) => {
  switch (v.$) {
    case "Empty":
      return "Empty";
    case "Single":
      return debug_struct(f, "Single", [["index", debug_int(v.index, f)]]);
    case "Multiple":
      return debug_struct(f, "Multiple", [
        ["tag", debug_Scalar(v.tag, f)],
        ["tag_encoding", debug_TagEncoding(v.tag_encoding, f)],
        ["tag_field", debug_int(v.tag_field, f)],
        ["variants", debug_vec(v.variants, f, debug_VariantLayout)],
      ]);
  }
};

// NOTE: This struct is generic over the VariantIdx for rust-analyzer usage.
// #[derive(PartialEq, Eq, Hash, Copy, Clone, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
export type TagEncoding =
  /// The tag directly stores the discriminant, but possibly with a smaller layout
  /// (so converting the tag to the discriminant can require sign extension).
  | { readonly $: "Direct" }

  /// Niche (values invalid for a type) encoding the discriminant.
  /// Note that for this encoding, the discriminant and variant index of each variant coincide!
  /// This invariant is codified as part of [`layout_sanity_check`](../rustc_ty_utils/layout/invariant/fn.layout_sanity_check.html).
  ///
  /// The variant `untagged_variant` contains a niche at an arbitrary
  /// offset (field [`Variants::Multiple::tag_field`] of the enum).
  /// For a variant with variant index `i`, such that `i != untagged_variant`,
  /// the tag is set to `(i - niche_variants.start).wrapping_add(niche_start)`
  /// (this is wrapping arithmetic using the type of the niche field, cf. the
  /// [`tag_for_variant`](../rustc_const_eval/interpret/struct.InterpCx.html#method.tag_for_variant)
  /// query implementation).
  /// To recover the variant index `i` from a `tag`, the above formula has to be reversed,
  /// i.e. `i = tag.wrapping_sub(niche_start) + niche_variants.start`. If `i` ends up outside
  /// `niche_variants`, the tag must have encoded the `untagged_variant`.
  ///
  /// For example, `Option<(usize, &T)>`  is represented such that the tag for
  /// `None` is the null pointer in the second tuple field, and
  /// `Some` is the identity function (with a non-null reference)
  /// and has no additional tag, i.e. the reference being non-null uniquely identifies this variant.
  ///
  /// Other variants that are not `untagged_variant` and that are outside the `niche_variants`
  /// range cannot be represented; they must be uninhabited.
  /// Nonetheless, uninhabited variants can also fall into the range of `niche_variants`.
  | {
      readonly $: "Niche";
      readonly untagged_variant: VariantIdx;
      /// This range *may* contain `untagged_variant` or uninhabited variants;
      /// these are then just "dead values" and not used to encode anything.
      readonly niche_variants: RangeInclusive<VariantIdx>;
      /// This is inbounds of the type of the niche field
      /// (not sign-extended, i.e., all bits beyond the niche field size are 0).
      readonly niche_start: bigint;
    };
export const TagEncoding = {
  Direct: Object.freeze({ $: "Direct" }) as TagEncoding,
} as const;
// derive(Debug)
export const debug_TagEncoding: Debug<TagEncoding> = (v, f) => {
  switch (v.$) {
    case "Direct":
      return "Direct";
    case "Niche":
      return debug_struct(f, "Niche", [
        ["untagged_variant", debug_int(v.untagged_variant, f)],
        ["niche_variants", debug_RangeInclusive(v.niche_variants, f, debug_int)],
        ["niche_start", debug_int(v.niche_start, f)],
      ]);
  }
};

// #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): a struct with an inherent impl is a class (PORTING §5); its fields are immutable (`Copy`).
export class Niche {
  constructor(
    readonly offset: Size,
    readonly value: Primitive,
    readonly valid_range: WrappingRange,
  ) {}

  // rustc: compiler/rustc_abi/src/lib.rs:2122 from_scalar
  static from_scalar(cx: HasDataLayout, offset: Size, scalar: Scalar): Niche | undefined {
    if (scalar.$ !== "Initialized") return undefined;
    const { value, valid_range } = scalar;
    const niche = new Niche(offset, value, valid_range);
    if (niche.available(cx) > 0n) {
      return niche;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_abi/src/lib.rs:2128 available
  available(cx: HasDataLayout): bigint {
    const { value, valid_range: v } = this;
    const size = Primitive.size(value, cx);
    assert(size.bits() <= 128, "assertion failed: size.bits() <= 128");
    const max_value = size.unsigned_int_max();

    // Find out how many values are outside the valid range.
    const niche = { start: u128_wrapping_add(v.end, 1n), end: v.start };
    return u128_wrapping_sub(niche.end, niche.start) & max_value;
  }

  // rustc: compiler/rustc_abi/src/lib.rs:2139 reserve
  reserve(cx: HasDataLayout, count: bigint): [bigint, Scalar] | undefined {
    assert(count > 0n, "assertion failed: count > 0");

    const { value, valid_range: v } = this;
    const size = Primitive.size(value, cx);
    assert(size.bits() <= 128, "assertion failed: size.bits() <= 128");
    const max_value = size.unsigned_int_max();

    const available = u128_wrapping_sub(u128_wrapping_sub(v.start, v.end), 1n) & max_value;
    if (count > available) {
      return undefined;
    }

    // Extend the range of valid values being reserved by moving either `v.start` or `v.end`
    // bound. Given an eventual `Option<T>`, we try to maximize the chance for `None` to occupy
    // the niche of zero. This is accomplished by preferring enums with 2 variants(`count==1`)
    // and always taking the shortest path to niche zero. Having `None` in niche zero can
    // enable some special optimizations.
    //
    // Bound selection criteria:
    // 1. Select closest to zero given wrapping semantics.
    // 2. Avoid moving past zero if possible.
    //
    // In practice this means that enums with `count > 1` are unlikely to claim niche zero,
    // since they have to fit perfectly. If niche zero is already reserved, the selection of
    // bounds are of little interest.
    const move_start = (v: WrappingRange): [bigint, Scalar] | undefined => {
      const start = u128_wrapping_sub(v.start, count) & max_value;
      return [start, { $: "Initialized", value, valid_range: v.with_start(start) }];
    };
    const move_end = (v: WrappingRange): [bigint, Scalar] | undefined => {
      const start = u128_wrapping_add(v.end, 1n) & max_value;
      const end = u128_wrapping_add(v.end, count) & max_value;
      return [start, { $: "Initialized", value, valid_range: v.with_end(end) }];
    };
    const distance_end_zero = max_value - v.end;
    // FIXME: this ought to work for `bool` too, but that seems to be hitting a miscompilation
    // <https://github.com/rust-lang/rust/pull/155473#issuecomment-4302036343>
    if (count === 1n && !WrappingRange_eq(v, new WrappingRange(0n, 1n))) {
      // We only need one, so just pick the one closest to zero.
      // Not only does that obviously use zero if it's possible, but it also
      // simplifies testing things like `Option<char>`, since looking for `-1`
      // is easier than looking for `1114112` (and matches clang's `WEOF`).
      const next_up = i128_unsigned_abs(size.sign_extend(u128_wrapping_add(v.end, 1n)));
      const next_down = i128_unsigned_abs(size.sign_extend(u128_wrapping_sub(v.start, 1n)));
      if (next_down <= next_up) {
        return move_start(v);
      } else {
        return move_end(v);
      }
    } else if (v.start > v.end) {
      // zero is unavailable because wrapping occurs
      return move_end(v);
    } else if (v.start <= distance_end_zero) {
      if (count <= v.start) {
        return move_start(v);
      } else {
        // moved past zero, use other bound
        return move_end(v);
      }
    } else {
      const end = u128_wrapping_add(v.end, count) & max_value;
      const overshot_zero = 1n <= end && end <= v.end;
      if (overshot_zero) {
        // moved past zero, use other bound
        return move_start(v);
      } else {
        return move_end(v);
      }
    }
  }
}
/** `u128::wrapping_add` */
function u128_wrapping_add(a: bigint, b: bigint): bigint {
  return (a + b) & U128_MAX;
}
/** `u128::wrapping_sub` */
function u128_wrapping_sub(a: bigint, b: bigint): bigint {
  return (a - b) & U128_MAX;
}
/** `i128::unsigned_abs` */
function i128_unsigned_abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}
/** derive(PartialEq) */
export function Niche_eq(a: Niche, b: Niche): boolean {
  return a.offset.raw === b.offset.raw && Primitive_eq(a.value, b.value) && WrappingRange_eq(a.valid_range, b.valid_range);
}
// derive(Debug)
export const debug_Niche: Debug<Niche> = (v, f) =>
  debug_struct(f, "Niche", [
    ["offset", debug_Size(v.offset, f)],
    ["value", debug_Primitive(v.value, f)],
    ["valid_range", debug_WrappingRange(v.valid_range, f)],
  ]);

/// Whether niche optimizations should be performed during layout calculation.
///
/// [`UnsafeCell`] and [`UnsafePinned`] both disable niche optimizations.
///
/// [`UnsafeCell`]: std::cell::UnsafeCell
/// [`UnsafePinned`]: std::pin::UnsafePinned
// #[derive(PartialEq, Eq, Clone, Copy)]
export type NicheOptimizations = "Enabled" | "Disabled";
export const NicheOptimizations = { Enabled: "Enabled", Disabled: "Disabled" } as const;

// NOTE: This struct is generic over the FieldIdx and VariantIdx for rust-analyzer usage.
// #[derive(PartialEq, Eq, Hash, Clone)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): the `FieldIdx` / `VariantIdx` parameters are erased (rustc's `rustc_abi::{FieldIdx,
// VariantIdx}`). The constructor takes every field in declaration order (PORTING §5); upstream struct literals list
// them in another order, so a fill lane writes `new LayoutData(fields, variants, backend_repr, largest_niche,
// uninhabited, align, size, max_repr_align, unadjusted_abi_align, repr_c, randomization_seed)`. Fields are mutable
// (`let mut st = ..; st.size = ..`); a `LayoutData` interned by `TyCtxt::mk_layout` is deep-frozen.
// The fns of layout/simple.rs (`impl LayoutData` constructors) are statics here (PORTING §8): lib.ts is both the
// defining module and the crate root, so no extension module can assign them.
export class LayoutData {
  constructor(
    /// Says where the fields are located within the layout.
    public fields: FieldsShape,

    /// Encodes information about multi-variant layouts.
    /// Even with `Multiple` variants, a layout still has its own fields! Those are then
    /// shared between all variants. One of them will be the discriminant,
    /// but e.g. coroutines can have more.
    ///
    /// To access all fields of this layout, both `fields` and the fields of the active variant
    /// must be taken into account.
    public variants: Variants,

    /// The `backend_repr` defines how this data will be represented to the codegen backend,
    /// and encodes value restrictions via `valid_range`.
    ///
    /// Note that this is entirely orthogonal to the recursive structure defined by
    /// `variants` and `fields`; for example, `ManuallyDrop<Result<isize, isize>>` has
    /// `IrForm::ScalarPair`! So, even with non-`Memory` `backend_repr`, `fields` and `variants`
    /// have to be taken into account to find all fields of this layout.
    public backend_repr: BackendRepr,

    /// The leaf scalar with the largest number of invalid values
    /// (i.e. outside of its `valid_range`), if it exists.
    public largest_niche: Niche | undefined,
    /// Is this type known to be uninhabted?
    ///
    /// This is separate from BackendRepr because uninhabited return types can affect ABI,
    /// especially in the case of by-pointer struct returns, which allocate stack even when unused.
    public uninhabited: boolean,

    public align: AbiAlign,
    public size: Size,

    /// The largest alignment explicitly requested with `repr(align)` on this type or any field.
    /// Only used on i686-windows, where the argument passing ABI is different when alignment is
    /// requested, even if the requested alignment is equal to the natural alignment.
    public max_repr_align: Align | undefined,

    /// The alignment the type would have, ignoring any `repr(align)` but including `repr(packed)`.
    /// Only used on aarch64-linux and arm, where the argument passing ABI ignores the requested
    /// alignment in some cases.
    public unadjusted_abi_align: Align,

    /// Whether this type is `repr(C)`, or a `repr(transparent)` wrapper around such,
    /// or an array of such.
    /// This matters because we must follow the C ABI for these types.
    /// Some C ABIs pass `repr(C)` ZSTs by pointer, but `repr(Rust)` ZSTs should always
    /// be ignored.
    public repr_c: boolean,

    /// The randomization seed based on this type's own repr and its fields.
    ///
    /// Since randomization is toggled on a per-crate basis even crates that do not have randomization
    /// enabled should still calculate a seed so that downstream uses can use it to distinguish different
    /// types.
    ///
    /// For every T and U for which we do not guarantee that a repr(Rust) `Foo<T>` can be coerced or
    /// transmuted to `Foo<U>` we aim to create probalistically distinct seeds so that Foo can choose
    /// to reorder its fields based on that information. The current implementation is a conservative
    /// approximation of this goal.
    public randomization_seed: Hash64,
  ) {}

  // ---- impl LayoutData (lib.rs:2287) ----

  /// Returns `true` if this is an aggregate type (including a ScalarPair!)
  // rustc: compiler/rustc_abi/src/lib.rs:2289 is_aggregate
  is_aggregate(): boolean {
    switch (this.backend_repr.$) {
      case "Scalar":
      case "SimdVector":
      case "SimdScalableVector":
        return false;
      case "ScalarPair":
      case "Memory":
        return true;
    }
  }

  /// Returns `true` if this is an uninhabited type
  // rustc: compiler/rustc_abi/src/lib.rs:2299 is_uninhabited
  is_uninhabited(): boolean {
    return this.uninhabited;
  }

  /// Returns `true` if the given variant is uninhabited.
  // rustc: compiler/rustc_abi/src/lib.rs:2304 is_variant_uninhabited
  is_variant_uninhabited(variant: VariantIdx): boolean {
    const variants = this.variants;
    switch (variants.$) {
      case "Empty":
        return true;
      case "Single":
        return variant !== variants.index || this.uninhabited;
      case "Multiple": {
        // `variants.get(variant).map(|v| v.uninhabited).unwrap_or(true)`
        const v = variants.variants[variant];
        return v !== undefined ? v.uninhabited : true;
      }
    }
  }

  /// Returns `true` if this is a `repr(C)` type,
  /// or an array of such, or a `repr(transparent)` wrapper around such
  // rustc: compiler/rustc_abi/src/lib.rs:2316 is_repr_c
  is_repr_c(): boolean {
    return this.repr_c;
  }

  // ---- impl LayoutData (lib.rs:2393) ----

  /// Returns `true` if the layout corresponds to an unsized type.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:2396 is_unsized
  is_unsized(): boolean {
    return BackendRepr.is_unsized(this.backend_repr);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:2401 is_sized
  is_sized(): boolean {
    return BackendRepr.is_sized(this.backend_repr);
  }

  /// Returns `true` if the type is sized and a 1-ZST (meaning it has size 0 and alignment 1).
  // rustc: compiler/rustc_abi/src/lib.rs:2406 is_1zst
  is_1zst(): boolean {
    return this.is_sized() && this.size.bytes() === 0 && this.align.abi.bytes() === 1;
  }

  /// Returns `true` if the size of the type is only known at runtime.
  // rustc: compiler/rustc_abi/src/lib.rs:2411 is_scalable_vector
  is_scalable_vector(): boolean {
    return this.backend_repr.$ === "SimdScalableVector";
  }

  /// Returns the elements count of a scalable vector.
  // rustc: compiler/rustc_abi/src/lib.rs:2416 scalable_vector_element_count
  scalable_vector_element_count(): BackendLaneCount | undefined {
    switch (this.backend_repr.$) {
      case "SimdScalableVector":
        return this.backend_repr.count;
      default:
        return undefined;
    }
  }

  /// Returns `true` if the type is a ZST and not unsized.
  ///
  /// Note that this does *not* imply that the type is irrelevant for layout! It can still have
  /// non-trivial alignment constraints. You probably want to use `is_1zst` instead.
  // rustc: compiler/rustc_abi/src/lib.rs:2427 is_zst
  is_zst(): boolean {
    switch (this.backend_repr.$) {
      case "Scalar":
      case "ScalarPair":
      case "SimdScalableVector":
      case "SimdVector":
        return false;
      case "Memory":
        return this.backend_repr.sized && this.size.bytes() === 0;
    }
  }

  /// In the backend, a value with this type and layout is fully represented by
  /// its SSA value(s), independent of the contents of memory.
  ///
  /// For example, you can swap by reading both then writing both without using
  /// an alloca because the store of one cannot affect the value of the other.
  ///
  /// Any projection into a standalone type must also yield a standalone type,
  /// since it might not be in memory at all.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:2446 is_ssa_standalone
  is_ssa_standalone(): boolean {
    switch (this.backend_repr.$) {
      case "Memory":
        return this.is_zst();
      case "Scalar":
      case "ScalarPair":
      case "SimdVector":
      case "SimdScalableVector":
        return true;
    }
  }

  /// Checks if these two `Layout` are equal enough to be considered "the same for all function
  /// call ABIs". Note however that real ABIs depend on more details that are not reflected in the
  /// `Layout`; the `PassMode` need to be compared as well. Also note that we assume
  /// aggregates are passed via `PassMode::Indirect`, `PassMode::IndirectUnsized` or
  /// `PassMode::Cast`; more strict checks would otherwise be required.
  // rustc: compiler/rustc_abi/src/lib.rs:2461 eq_abi
  eq_abi(other: LayoutData): boolean {
    // The one thing that we are not capturing here is that for unsized types, the metadata must
    // also have the same ABI, and moreover that the same metadata leads to the same size. The
    // 2nd point is quite hard to check though.
    return (
      this.size.raw === other.size.raw &&
      this.is_sized() === other.is_sized() &&
      BackendRepr.eq_up_to_validity(this.backend_repr, other.backend_repr) &&
      BackendRepr.is_bool(this.backend_repr) === BackendRepr.is_bool(other.backend_repr) &&
      Align_eq(this.align.abi, other.align.abi) &&
      option_eq(this.max_repr_align, other.max_repr_align, Align_eq) &&
      Align_eq(this.unadjusted_abi_align, other.unadjusted_abi_align)
    );
  }

  // ---- layout/simple.rs: impl LayoutData (PORTING §8: statics in the class body) ----
  // "Simple" layout constructors that cannot fail.

  // rustc: compiler/rustc_abi/src/layout/simple.rs:13 unit
  static unit(cx: HasDataLayout, sized: boolean): LayoutData {
    const dl = cx.data_layout();
    return new LayoutData(
      /* fields */ { $: "Arbitrary", offsets: [], in_memory_order: [] },
      /* variants */ { $: "Single", index: VariantIdx.new(0) },
      /* backend_repr */ { $: "Memory", sized },
      /* largest_niche */ undefined,
      /* uninhabited */ false,
      /* align */ AbiAlign.new(dl.i8_align),
      /* size */ Size.ZERO,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ dl.i8_align,
      /* repr_c */ false,
      /* randomization_seed */ Hash64.new(0n),
    );
  }

  // rustc: compiler/rustc_abi/src/layout/simple.rs:33 never_type
  static never_type(cx: HasDataLayout): LayoutData {
    const dl = cx.data_layout();
    // This is also used for uninhabited enums, so we use `Variants::Empty`.
    return new LayoutData(
      /* fields */ FieldsShape.Primitive,
      /* variants */ Variants.Empty,
      /* backend_repr */ { $: "Memory", sized: true },
      /* largest_niche */ undefined,
      /* uninhabited */ true,
      /* align */ AbiAlign.new(dl.i8_align),
      /* size */ Size.ZERO,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ dl.i8_align,
      /* repr_c */ false,
      /* randomization_seed */ Hash64.ZERO,
    );
  }

  // rustc: compiler/rustc_abi/src/layout/simple.rs:51 scalar
  static scalar(cx: HasDataLayout, scalar: Scalar): LayoutData {
    const largest_niche = Niche.from_scalar(cx, Size.ZERO, scalar);
    const size = Scalar.size(scalar, cx);
    const align = Scalar.default_align(scalar, cx);

    const range = Scalar.valid_range(scalar, cx);

    // All primitive types for which we don't have subtype coercions should get a distinct seed,
    // so that types wrapping them can use randomization to arrive at distinct layouts.
    //
    // Some type information is already lost at this point, so as an approximation we derive
    // the seed from what remains. For example on 64-bit targets usize and u64 can no longer
    // be distinguished.
    // PORT: the `u64` wrapping arithmetic is done in `bigint` (`u64_wrapping_add`, `u64_rotate_right`).
    const primitive = Scalar.primitive(scalar);
    let tag: bigint;
    switch (primitive.$) {
      case "Int":
        tag = primitive._1 ? 1n : 2n;
        break;
      case "Float":
        tag = 3n;
        break;
      case "Pointer":
        tag = 4n;
        break;
    }
    const randomization_seed = u64_wrapping_add(
      u64_wrapping_add(
        u64_wrapping_add(BigInt(size.bytes()), tag << 32n),
        // distinguishes references from pointers
        u64_rotate_right(range.start & U64_MAX, 16n),
      ),
      // distinguishes char from u32 and bool from u8
      u64_rotate_right(range.end & U64_MAX, 16n),
    );

    return new LayoutData(
      /* fields */ FieldsShape.Primitive,
      /* variants */ { $: "Single", index: VariantIdx.new(0) },
      /* backend_repr */ { $: "Scalar", _0: scalar },
      largest_niche,
      /* uninhabited */ false,
      align,
      size,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ align.abi,
      /* repr_c */ false,
      /* randomization_seed */ Hash64.new(randomization_seed),
    );
  }

  // rustc: compiler/rustc_abi/src/layout/simple.rs:94 scalar_pair
  static scalar_pair(cx: HasDataLayout, a: Scalar, b: Scalar): LayoutData {
    const dl = cx.data_layout();
    const b_align = Scalar.default_align(b, dl).abi;
    const align = Align_max(Align_max(Scalar.default_align(a, dl).abi, b_align), dl.aggregate_align);
    const b_offset = Scalar.size(a, dl).align_to(b_align);
    const size = b_offset.add(Scalar.size(b, dl)).align_to(align);

    // HACK(nox): We iter on `b` and then `a` because `max_by_key`
    // returns the last maximum.
    // PORT: `Option::into_iter().chain(..).max_by_key(..)`: both `from_scalar` calls are evaluated first (the
    // `chain` argument), then the keys in iteration order; ties keep the later element.
    const niche_b = Niche.from_scalar(dl, b_offset, b);
    const niche_a = Niche.from_scalar(dl, Size.ZERO, a);
    let largest_niche: Niche | undefined = undefined;
    let largest_key = 0n;
    for (const niche of [niche_b, niche_a]) {
      if (niche === undefined) continue;
      const key = niche.available(dl);
      if (largest_niche === undefined || key >= largest_key) {
        largest_niche = niche;
        largest_key = key;
      }
    }

    const combined_seed = u64_wrapping_add(BigInt(Scalar.size(a, dl).bytes()), BigInt(Scalar.size(b, dl).bytes()));

    return new LayoutData(
      /* fields */ { $: "Arbitrary", offsets: [Size.ZERO, b_offset], in_memory_order: [FieldIdx.new(0), FieldIdx.new(1)] },
      /* variants */ { $: "Single", index: VariantIdx.new(0) },
      /* backend_repr */ { $: "ScalarPair", a, b, b_offset },
      largest_niche,
      /* uninhabited */ false,
      /* align */ AbiAlign.new(align),
      size,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ align,
      /* repr_c */ false,
      /* randomization_seed */ Hash64.new(combined_seed),
    );
  }

  /// Returns a dummy layout for an uninhabited variant.
  ///
  /// Uninhabited variants get pruned as part of the layout calculation,
  /// so this can be used after the fact to reconstitute a layout.
  // rustc: compiler/rustc_abi/src/layout/simple.rs:132 uninhabited_variant
  static uninhabited_variant(cx: HasDataLayout, index: VariantIdx, fields: number): LayoutData {
    const dl = cx.data_layout();
    return new LayoutData(
      // `match NonZero::new(fields)`
      /* fields */ fields !== 0 ? { $: "Union", _0: fields } : { $: "Arbitrary", offsets: [], in_memory_order: [] },
      /* variants */ { $: "Single", index },
      /* backend_repr */ { $: "Memory", sized: true },
      /* largest_niche */ undefined,
      /* uninhabited */ true,
      /* align */ AbiAlign.new(dl.i8_align),
      /* size */ Size.ZERO,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ dl.i8_align,
      /* repr_c */ false,
      // Variant layouts never flow back into actual layout computations,
      // so dummy values are fine here.
      /* randomization_seed */ Hash64.ZERO,
    );
  }

  /// Returns a layout for an inhabited variant.
  // rustc: compiler/rustc_abi/src/layout/simple.rs:158 for_variant
  static for_variant(parent: LayoutData, index: VariantIdx): LayoutData {
    let layout: VariantLayout;
    switch (parent.variants.$) {
      case "Multiple":
        layout = parent.variants.variants[index];
        break;
      default:
        return panic("Expected multi-variant layout in `Layout::for_variant`");
    }

    return new LayoutData(
      /* fields */ { $: "Arbitrary", offsets: layout.field_offsets.slice(), in_memory_order: layout.fields_in_memory_order.slice() },
      /* variants */ { $: "Single", index },
      /* backend_repr */ layout.backend_repr,
      /* largest_niche */ layout.largest_niche,
      /* uninhabited */ layout.uninhabited,
      /* align */ parent.align,
      /* size */ layout.size,
      /* max_repr_align */ parent.max_repr_align,
      /* unadjusted_abi_align */ parent.unadjusted_abi_align,
      /* repr_c */ parent.repr_c,
      // Variant layouts never flow back into actual layout computations,
      // so dummy values are fine here.
      /* randomization_seed */ Hash64.ZERO,
    );
  }
}
// PORT (abi-layout-a): `u64::wrapping_add` / `u64::rotate_right` for layout/simple.rs's seeds, in `bigint`.
function u64_wrapping_add(a: bigint, b: bigint): bigint {
  return (a + b) & U64_MAX;
}
function u64_rotate_right(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & U64_MAX;
}
/** derive(PartialEq) (PORT (layout-contract): the derived equality is the intern key's, rust_ts/intern_key.ts) */
export function LayoutData_eq(a: LayoutData, b: LayoutData): boolean {
  return intern_key(a) === intern_key(b);
}
// impl<FieldIdx: Idx, VariantIdx: Idx> fmt::Debug for LayoutData<FieldIdx, VariantIdx>
// rustc: compiler/rustc_abi/src/lib.rs:2326 fmt
export const debug_LayoutData: Debug<LayoutData> = (self, f) => {
  // This is how `Layout` used to print before it become
  // `Interned<LayoutData>`. We print it like this to avoid having to update
  // expected output in a lot of tests.
  const {
    size,
    align,
    backend_repr,
    fields,
    largest_niche,
    uninhabited,
    variants,
    max_repr_align,
    unadjusted_abi_align,
    repr_c,
    randomization_seed,
  } = self;
  return debug_struct(f, "Layout", [
    ["size", debug_Size(size, f)],
    ["align", debug_AbiAlign(align, f)],
    ["backend_repr", debug_BackendRepr(backend_repr, f)],
    ["fields", debug_FieldsShape(fields, f)],
    ["largest_niche", debug_option(largest_niche, f, debug_Niche)],
    ["uninhabited", debug_bool(uninhabited, f)],
    ["variants", debug_Variants(variants, f)],
    ["max_repr_align", debug_option(max_repr_align, f, debug_Align)],
    ["unadjusted_abi_align", debug_Align(unadjusted_abi_align, f)],
    ["repr_c", debug_bool(repr_c, f)],
    ["randomization_seed", debug_Hash64(randomization_seed, f)],
  ]);
};

// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type PointerKind =
  /// Shared reference. `frozen` indicates the absence of any `UnsafeCell`.
  | { readonly $: "SharedRef"; readonly frozen: boolean }
  /// Mutable reference. `unpin` indicates the absence of any pinned data.
  | { readonly $: "MutableRef"; readonly unpin: boolean }
  /// Box. `unpin` indicates the absence of any pinned data. `global` indicates whether this box
  /// uses the global allocator or a custom one.
  | { readonly $: "Box"; readonly unpin: boolean; readonly global: boolean };
// derive(Debug)
export const debug_PointerKind: Debug<PointerKind> = (v, f) => {
  switch (v.$) {
    case "SharedRef":
      return debug_struct(f, "SharedRef", [["frozen", debug_bool(v.frozen, f)]]);
    case "MutableRef":
      return debug_struct(f, "MutableRef", [["unpin", debug_bool(v.unpin, f)]]);
    case "Box":
      return debug_struct(f, "Box", [
        ["unpin", debug_bool(v.unpin, f)],
        ["global", debug_bool(v.global, f)],
      ]);
  }
};

/// Encodes extra information we have about a pointer.
///
/// Note that this information is advisory only, and backends are free to ignore it:
/// if the information is wrong, that can cause UB, but if the information is absent,
/// that must always be okay.
// #[derive(Copy, Clone, Debug)]
export interface PointeeInfo {
  /// If this is `None`, then this is a raw pointer.
  readonly safe: PointerKind | undefined;
  /// If `size` is not zero, then the pointer is either null or dereferenceable for this many bytes
  /// (independent of `safe`).
  ///
  /// "Dereferenceable" means that it's sound to add a speculative (spurious) read of the pointer.
  /// The backend is free to add such reads at will. (This is useful to hoist pointer reads out of
  /// loops without proving that the loop executes at least once, for example.)
  ///
  /// This can be used in both argument and return position, in both cases it means
  /// "dereferenceable right now" (function entry/return) (but could be freed any time later).
  readonly size: Size;
  /// The pointer is guaranteed to be aligned this much (independent of `safe`).
  readonly align: Align;
}
// derive(Debug)
export const debug_PointeeInfo: Debug<PointeeInfo> = (v, f) =>
  debug_struct(f, "PointeeInfo", [
    ["safe", debug_option(v.safe, f, debug_PointerKind)],
    ["size", debug_Size(v.size, f)],
    ["align", debug_Align(v.align, f)],
  ]);

// #[derive(Copy, Clone, Debug)]
export type StructKind =
  /// A tuple, closure, or univariant which cannot be coerced to unsized.
  | { readonly $: "AlwaysSized" }
  /// A univariant, the last field of which may be coerced to unsized.
  | { readonly $: "MaybeUnsized" }
  /// A univariant, but with a prefix of an arbitrary size & alignment (e.g., enum tag).
  | { readonly $: "Prefixed"; readonly _0: Size; readonly _1: Align };
export const StructKind = {
  AlwaysSized: Object.freeze({ $: "AlwaysSized" }) as StructKind,
  MaybeUnsized: Object.freeze({ $: "MaybeUnsized" }) as StructKind,
} as const;
// derive(Debug)
export const debug_StructKind: Debug<StructKind> = (v, f) => {
  switch (v.$) {
    case "AlwaysSized":
      return "AlwaysSized";
    case "MaybeUnsized":
      return "MaybeUnsized";
    case "Prefixed":
      return debug_tuple(f, "Prefixed", [debug_Size(v._0, f), debug_Align(v._1, f)]);
  }
};

// #[derive(Clone, Debug)]
export type AbiFromStrErr =
  /// not a known ABI
  | "Unknown"
  /// no "-unwind" variant can be used here
  | "NoExplicitUnwind";
// derive(Debug)
export const debug_AbiFromStrErr: Debug<AbiFromStrErr> = (v) => v;

/// The layout information for a variant.
///
/// For items with multiple variants ([`Variants::Multiple`]), the layout information of each
/// variant largely matches that of the overall item. So, instead of giving each one a new [`LayoutData`],
/// we use this struct, which stores only the information that differs between the variants.
///
/// See <https://github.com/rust-lang/rust/issues/113988> for more context.
// NOTE: This struct is generic over the FieldIdx for rust-analyzer usage.
// #[derive(PartialEq, Eq, Hash, Clone, Debug)]
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// PORT (layout-contract): the `FieldIdx` parameter is erased; the private fields are public (TS has no module privacy).
export class VariantLayout {
  constructor(
    // FIXME: ideally we'd remove these as variants should not have their own
    // size or backend_repr.
    public size: Size,
    public backend_repr: BackendRepr,

    public field_offsets: Size[],
    public fields_in_memory_order: FieldIdx[],
    public largest_niche: Niche | undefined,
    public uninhabited: boolean,
  ) {}

  // PORT (layout-contract): `layout: LayoutData<FieldIdx, impl Idx>` is a `LayoutData`.
  // rustc: compiler/rustc_abi/src/lib.rs:2516 from_layout
  static from_layout(layout: LayoutData): VariantLayout {
    if (layout.fields.$ !== "Arbitrary") {
      return panic("Layout of fields should be Arbitrary for variants");
    }
    const { offsets, in_memory_order } = layout.fields;

    return new VariantLayout(layout.size, layout.backend_repr, offsets, in_memory_order, layout.largest_niche, layout.uninhabited);
  }

  // rustc: compiler/rustc_abi/src/lib.rs:2531 is_uninhabited
  is_uninhabited(): boolean {
    return this.uninhabited;
  }

  // rustc: compiler/rustc_abi/src/lib.rs:2535 has_fields
  has_fields(): boolean {
    return this.field_offsets.length > 0;
  }
}
// derive(Debug)
export const debug_VariantLayout: Debug<VariantLayout> = (v, f) =>
  debug_struct(f, "VariantLayout", [
    ["size", debug_Size(v.size, f)],
    ["backend_repr", debug_BackendRepr(v.backend_repr, f)],
    ["field_offsets", debug_vec(v.field_offsets, f, debug_Size)],
    ["fields_in_memory_order", debug_vec(v.fields_in_memory_order, f, debug_int)],
    ["largest_niche", debug_option(v.largest_niche, f, debug_Niche)],
    ["uninhabited", debug_bool(v.uninhabited, f)],
  ]);

// compiler/rustc_abi/src/extern_abi.rs (subset)

// #[cfg(feature = "nightly")]
// #[derive(Debug)]
export type CVariadicStatus = { readonly $: "NotSupported" } | { readonly $: "Stable" } | { readonly $: "Unstable"; readonly feature: Symbol };
