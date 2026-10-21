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
import { debug_Hash64, type Hash64 } from "../rustc_hashes/lib.ts";
import { type Debug, debug_bool, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { to_writer } from "../vendor/bitflags/parser.ts";
import { flags_companion } from "../vendor/bitflags/traits.ts";
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import type { RegKind } from "./callconv/reg.ts";
import type { FieldIdx, LayoutCalculatorError, VariantIdx } from "./layout.ts";
import { debug_WrappingRange, type WrappingRange, WrappingRange_eq } from "./wrapping_range.ts";

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
  // stub: compiler/rustc_abi/src/lib.rs:273 new (lane abi-lib)
  new<N>(_count: bigint): Result<BackendLaneCount, LayoutCalculatorError<N>> {
    return unported("rustc_abi::BackendLaneCount::new");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:287 is_power_of_two (lane abi-lib)
  is_power_of_two(_self: BackendLaneCount): boolean {
    return unported("rustc_abi::BackendLaneCount::is_power_of_two");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:292 as_u64 (lane abi-lib)
  as_u64(_self: BackendLaneCount): bigint {
    return unported("rustc_abi::BackendLaneCount::as_u64");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:297 as_u32 (lane abi-lib)
  as_u32(_self: BackendLaneCount): number {
    return unported("rustc_abi::BackendLaneCount::as_u32");
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
// PORT: not ported (no marker): every built-in target's data layout parses; a target JSON (unported)
// is the only way to reach these errors.
// stub: compiler/rustc_abi/src/lib.rs:403 into_diag (lane abi-lib)
export function TargetDataLayoutError_into_diag(_e: TargetDataLayoutError): never {
  return unported("rustc_abi::TargetDataLayoutError::into_diag");
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
// PORT: `raw: u64` is a `number` (byte sizes stay far below 2^53).
export class Size {
  constructor(readonly raw: number) {}

  static readonly ZERO: Size = new Size(0);

  /// Rounds `bits` up to the next-higher byte boundary, if `bits` is
  /// not a multiple of 8.
  // rustc: compiler/rustc_abi/src/lib.rs:890 from_bits
  static from_bits(bits: number): Size {
    return new Size(Math.ceil(bits / 8));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:896 from_bytes
  static from_bytes(bytes: number): Size {
    return new Size(bytes);
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
    // PORT: `checked_mul(8)` cannot overflow for the sizes rust-ts handles (< 2^53 / 8), so the nested
    // `#[cold] fn overflow` (lib.rs:914) is never called and not ported.
    // stub: compiler/rustc_abi/src/lib.rs:914 overflow (nested in `bits`; unreachable for sizes < 2^53, lane abi-lib)
    return this.bytes() * 8;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:922 bits_usize
  bits_usize(): number {
    return this.bits();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:927 align_to
  align_to(align: Align): Size {
    // PORT: the mask arithmetic in `bigint` (JS bitwise operators are 32-bit).
    const mask = BigInt(align.bytes()) - 1n;
    return Size.from_bytes(Number((BigInt(this.bytes()) + mask) & ~mask));
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

    // PORT: `u64::checked_add` cannot overflow for byte counts below 2^53.
    const bytes = this.bytes() + offset.bytes();

    return bytes < dl.obj_size_bound() ? Size.from_bytes(bytes) : undefined;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:948 checked_mul
  checked_mul(count: number, cx: HasDataLayout): Size | undefined {
    const dl = cx.data_layout();

    // PORT: `u64::checked_mul` in `bigint`; a product of 2^64 or more is `None` as upstream.
    const bytes = BigInt(this.bytes()) * BigInt(count);
    if (bytes > U64_MAX) return undefined;
    return bytes < BigInt(dl.obj_size_bound()) ? Size.from_bytes(Number(bytes)) : undefined;
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
  // stub: compiler/rustc_abi/src/lib.rs:1006 add (lane abi-lib)
  add(_other: Size): Size {
    return unported("rustc_abi::Size::add");
  }

  // impl Sub for Size
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1016 sub (lane abi-lib)
  sub(_other: Size): Size {
    return unported("rustc_abi::Size::sub");
  }

  // impl Mul<Size> for u64
  // #[inline]
  // PORT (layout-contract): `count * size` is the static `Size.u64_mul(count, size)` (the `u64` side has no class).
  // stub: compiler/rustc_abi/src/lib.rs:1026 mul (lane abi-lib)
  static u64_mul(_count: number, _size: Size): Size {
    return unported("rustc_abi::Size::mul (Mul<Size> for u64)");
  }

  // impl Mul<u64> for Size
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1034 mul (lane abi-lib)
  mul(_count: number): Size {
    return unported("rustc_abi::Size::mul");
  }

  // impl AddAssign for Size
  // #[inline]
  // PORT (layout-contract): `Size` is immutable (`raw` is readonly), so `a += b` is `a = a.add_assign(b)`, which
  // returns the new value.
  // stub: compiler/rustc_abi/src/lib.rs:1044 add_assign (lane abi-lib)
  add_assign(_other: Size): Size {
    return unported("rustc_abi::Size::add_assign");
  }
}
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const I128_MAX = (1n << 127n) - 1n;
// This is debug-printed a lot in larger structs, don't waste too much space there
// impl fmt::Debug for Size
// rustc: compiler/rustc_abi/src/lib.rs:880 fmt
export const debug_Size: Debug<Size> = (v) => `Size(${v.bytes()} bytes)`;

// #[cfg(feature = "nightly")]
// impl Step for Size
// PORT (layout-contract): `core::iter::Step` (ranges of `Size`) is the companion `Step_Size`; `usize` counts are numbers.
export const Step_Size = {
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1052 steps_between (lane abi-lib)
  steps_between(_start: Size, _end: Size): [number, number | undefined] {
    return unported("rustc_abi::Size::steps_between");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1057 forward_checked (lane abi-lib)
  forward_checked(_start: Size, _count: number): Size | undefined {
    return unported("rustc_abi::Size::forward_checked");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1062 forward_overflowing (lane abi-lib)
  forward_overflowing(_start: Size, _count: number): [Size, boolean] {
    return unported("rustc_abi::Size::forward_overflowing");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1068 forward (lane abi-lib)
  forward(_start: Size, _count: number): Size {
    return unported("rustc_abi::Size::forward");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1073 forward_unchecked (lane abi-lib)
  forward_unchecked(_start: Size, _count: number): Size {
    return unported("rustc_abi::Size::forward_unchecked");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1078 backward_checked (lane abi-lib)
  backward_checked(_start: Size, _count: number): Size | undefined {
    return unported("rustc_abi::Size::backward_checked");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1083 backward_overflowing (lane abi-lib)
  backward_overflowing(_start: Size, _count: number): [Size, boolean] {
    return unported("rustc_abi::Size::backward_overflowing");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1089 backward (lane abi-lib)
  backward(_start: Size, _count: number): Size {
    return unported("rustc_abi::Size::backward");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1094 backward_unchecked (lane abi-lib)
  backward_unchecked(_start: Size, _count: number): Size {
    return unported("rustc_abi::Size::backward_unchecked");
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

  // stub: compiler/rustc_abi/src/lib.rs:1450 align (lane abi-lib)
  align(_self: Float, _cx: HasDataLayout): AbiAlign {
    return unported("rustc_abi::Float::align");
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
  // stub: compiler/rustc_abi/src/lib.rs:1487 size (lane abi-lib)
  size(_self: Numeric): Size {
    return unported("rustc_abi::Numeric::size");
  },

  // stub: compiler/rustc_abi/src/lib.rs:1494 reg_kind (lane abi-lib)
  reg_kind(_self: Numeric): RegKind {
    return unported("rustc_abi::Numeric::reg_kind");
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
  // stub: compiler/rustc_abi/src/lib.rs:1545 size (lane abi-lib)
  size(_self: Primitive, _cx: HasDataLayout): Size {
    return unported("rustc_abi::Primitive::size");
  },

  /// The *platform-specific* ABI alignment of this primitive.
  ///
  /// This is the type alignment for the corresponding built-in.
  /// In other contexts it might have different alignment.
  // stub: compiler/rustc_abi/src/lib.rs:1560 default_align (lane abi-lib)
  default_align(_self: Primitive, _cx: HasDataLayout): AbiAlign {
    return unported("rustc_abi::Primitive::default_align");
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
  // stub: compiler/rustc_abi/src/lib.rs:1614 is_bool (lane abi-lib)
  is_bool(_self: Scalar): boolean {
    return unported("rustc_abi::Scalar::is_bool");
  },

  /// Get the primitive representation of this type, ignoring the valid range and whether the
  /// value is allowed to be undefined (due to being a union).
  // stub: compiler/rustc_abi/src/lib.rs:1627 primitive (lane abi-lib)
  primitive(_self: Scalar): Primitive {
    return unported("rustc_abi::Scalar::primitive");
  },

  /// The *platform-specific* ABI alignment of this scalar.
  ///
  /// This is the type alignment for the corresponding built-in.
  /// This is *not* necessarily the correct alignment for a type that has this `BackendRepr::Scalar`!
  // stub: compiler/rustc_abi/src/lib.rs:1637 default_align (lane abi-lib)
  default_align(_self: Scalar, _cx: HasDataLayout): AbiAlign {
    return unported("rustc_abi::Scalar::default_align");
  },

  // stub: compiler/rustc_abi/src/lib.rs:1641 size (lane abi-lib)
  size(_self: Scalar, _cx: HasDataLayout): Size {
    return unported("rustc_abi::Scalar::size");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1646 to_union (lane abi-lib)
  to_union(_self: Scalar): Scalar {
    return unported("rustc_abi::Scalar::to_union");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1651 valid_range (lane abi-lib)
  valid_range(_self: Scalar, _cx: HasDataLayout): WrappingRange {
    return unported("rustc_abi::Scalar::valid_range");
  },

  // #[inline]
  /// Allows the caller to mutate the valid range. This operation will panic if attempted on a
  /// union.
  // PORT (layout-contract): `&mut WrappingRange` is a `MutRef` over `self.valid_range` (PORTING §8); `WrappingRange`
  // is immutable, so `*scalar.valid_range_mut() = r` / `.start = s` are `r_.value = r` / `r_.value = r_.value.with_start(s)`.
  // stub: compiler/rustc_abi/src/lib.rs:1661 valid_range_mut (lane abi-lib)
  valid_range_mut(_self: Scalar): MutRef<WrappingRange> {
    return unported("rustc_abi::Scalar::valid_range_mut");
  },

  /// Returns `true` if all possible numbers are valid, i.e `valid_range` covers the whole
  /// layout.
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1671 is_always_valid (lane abi-lib)
  is_always_valid(_self: Scalar, _cx: HasDataLayout): boolean {
    return unported("rustc_abi::Scalar::is_always_valid");
  },

  /// Returns `true` if this type can be left uninit.
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1680 is_uninit_valid (lane abi-lib)
  is_uninit_valid(_self: Scalar): boolean {
    return unported("rustc_abi::Scalar::is_uninit_valid");
  },

  /// Returns `true` if this is a signed integer scalar
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1689 is_signed (lane abi-lib)
  is_signed(_self: Scalar): boolean {
    return unported("rustc_abi::Scalar::is_signed");
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
  // stub: compiler/rustc_abi/src/lib.rs:1738 count (lane abi-lib)
  count(_self: FieldsShape): number {
    return unported("rustc_abi::FieldsShape::count");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1748 offset (lane abi-lib)
  offset(_self: FieldsShape, _i: number): Size {
    return unported("rustc_abi::FieldsShape::offset");
  },

  /// Gets source indices of the fields by increasing offsets.
  // #[inline]
  // PORT (layout-contract): `impl ExactSizeIterator<Item = usize>` is an array.
  // stub: compiler/rustc_abi/src/lib.rs:1768 index_by_increasing_offset (lane abi-lib)
  index_by_increasing_offset(_self: FieldsShape): number[] {
    return unported("rustc_abi::FieldsShape::index_by_increasing_offset");
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
  // stub: compiler/rustc_abi/src/lib.rs:1807 for_non_tuple (lane abi-lib)
  for_non_tuple(): NumScalableVectors {
    return unported("rustc_abi::NumScalableVectors::for_non_tuple");
  },

  // Returns `NumScalableVectors` for values of two through eight, which are a valid number of
  // fields for a tuple of scalable vectors to have. `1` is a valid value of `NumScalableVectors`
  // but not for a tuple which would have a field count.
  // stub: compiler/rustc_abi/src/lib.rs:1814 from_field_count (lane abi-lib)
  from_field_count(_count: number): NumScalableVectors | undefined {
    return unported("rustc_abi::NumScalableVectors::from_field_count");
  },
} as const;
// derive(Debug)
export const debug_NumScalableVectors: Debug<NumScalableVectors> = (v, f) => debug_tuple(f, "NumScalableVectors", [debug_int(v, f)]);

// #[cfg(feature = "nightly")]
// impl IntoDiagArg for NumScalableVectors
// stub: compiler/rustc_abi/src/lib.rs:1824 into_diag_arg (lane abi-lib)
export function NumScalableVectors_into_diag_arg(_self: NumScalableVectors, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_abi::NumScalableVectors::into_diag_arg");
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
  // stub: compiler/rustc_abi/src/lib.rs:1886 is_unsized (lane abi-lib)
  is_unsized(_self: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::is_unsized");
  },

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1902 is_sized (lane abi-lib)
  is_sized(_self: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::is_sized");
  },

  /// Returns `true` if this is a single signed integer scalar.
  /// Sanity check: panics if this is not a scalar type (see PR #70189).
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1909 is_signed (lane abi-lib)
  is_signed(_self: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::is_signed");
  },

  /// Returns `true` if this is specifically a [`Self::Scalar`] type.
  ///
  /// This excludes SIMD types.
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1920 is_scalar (lane abi-lib)
  is_scalar(_self: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::is_scalar");
  },

  /// Returns `true` if this is a scalar type or SIMD type.
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1926 is_scalar_or_simd (lane abi-lib)
  is_scalar_or_simd(_self: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::is_scalar_or_simd");
  },

  /// Returns `true` if this is a bool
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:1937 is_bool (lane abi-lib)
  is_bool(_self: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::is_bool");
  },

  /// The psABI alignment for a `Scalar` or `ScalarPair`
  ///
  /// `None` for other variants.
  ///
  /// It's unclear whether this is a meaningful operation, and MCP#1007 proposes changes.
  /// You should generally be using the alignment of the place or the type,
  /// not calculating something from the `Scalar`s.
  // stub: compiler/rustc_abi/src/lib.rs:1948 scalar_platform_align (lane abi-lib)
  scalar_platform_align(_self: BackendRepr, _cx: HasDataLayout): Align | undefined {
    return unported("rustc_abi::BackendRepr::scalar_platform_align");
  },

  /// The psABI size for a `Scalar` or `ScalarPair`
  ///
  /// `None` for other variants
  // stub: compiler/rustc_abi/src/lib.rs:1964 scalar_size (lane abi-lib)
  scalar_size(_self: BackendRepr, _cx: HasDataLayout): Size | undefined {
    return unported("rustc_abi::BackendRepr::scalar_size");
  },

  /// Discard validity range information and allow undef.
  // stub: compiler/rustc_abi/src/lib.rs:1985 to_union (lane abi-lib)
  to_union(_self: BackendRepr): BackendRepr {
    return unported("rustc_abi::BackendRepr::to_union");
  },

  // stub: compiler/rustc_abi/src/lib.rs:2005 eq_up_to_validity (lane abi-lib)
  eq_up_to_validity(_self: BackendRepr, _other: BackendRepr): boolean {
    return unported("rustc_abi::BackendRepr::eq_up_to_validity");
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

  // stub: compiler/rustc_abi/src/lib.rs:2122 from_scalar (lane abi-lib)
  static from_scalar(_cx: HasDataLayout, _offset: Size, _scalar: Scalar): Niche | undefined {
    return unported("rustc_abi::Niche::from_scalar");
  }

  // stub: compiler/rustc_abi/src/lib.rs:2128 available (lane abi-lib)
  available(_cx: HasDataLayout): bigint {
    return unported("rustc_abi::Niche::available");
  }

  // stub: compiler/rustc_abi/src/lib.rs:2139 reserve (lane abi-lib)
  reserve(_cx: HasDataLayout, _count: bigint): [bigint, Scalar] | undefined {
    return unported("rustc_abi::Niche::reserve");
  }
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
  // stub: compiler/rustc_abi/src/lib.rs:2289 is_aggregate (lane abi-lib)
  is_aggregate(): boolean {
    return unported("rustc_abi::LayoutData::is_aggregate");
  }

  /// Returns `true` if this is an uninhabited type
  // stub: compiler/rustc_abi/src/lib.rs:2299 is_uninhabited (lane abi-lib)
  is_uninhabited(): boolean {
    return unported("rustc_abi::LayoutData::is_uninhabited");
  }

  /// Returns `true` if the given variant is uninhabited.
  // stub: compiler/rustc_abi/src/lib.rs:2304 is_variant_uninhabited (lane abi-lib)
  is_variant_uninhabited(_variant: VariantIdx): boolean {
    return unported("rustc_abi::LayoutData::is_variant_uninhabited");
  }

  /// Returns `true` if this is a `repr(C)` type,
  /// or an array of such, or a `repr(transparent)` wrapper around such
  // stub: compiler/rustc_abi/src/lib.rs:2316 is_repr_c (lane abi-lib)
  is_repr_c(): boolean {
    return unported("rustc_abi::LayoutData::is_repr_c");
  }

  // ---- impl LayoutData (lib.rs:2393) ----

  /// Returns `true` if the layout corresponds to an unsized type.
  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:2396 is_unsized (lane abi-lib)
  is_unsized(): boolean {
    return unported("rustc_abi::LayoutData::is_unsized");
  }

  // #[inline]
  // stub: compiler/rustc_abi/src/lib.rs:2401 is_sized (lane abi-lib)
  is_sized(): boolean {
    return unported("rustc_abi::LayoutData::is_sized");
  }

  /// Returns `true` if the type is sized and a 1-ZST (meaning it has size 0 and alignment 1).
  // stub: compiler/rustc_abi/src/lib.rs:2406 is_1zst (lane abi-lib)
  is_1zst(): boolean {
    return unported("rustc_abi::LayoutData::is_1zst");
  }

  /// Returns `true` if the size of the type is only known at runtime.
  // stub: compiler/rustc_abi/src/lib.rs:2411 is_scalable_vector (lane abi-lib)
  is_scalable_vector(): boolean {
    return unported("rustc_abi::LayoutData::is_scalable_vector");
  }

  /// Returns the elements count of a scalable vector.
  // stub: compiler/rustc_abi/src/lib.rs:2416 scalable_vector_element_count (lane abi-lib)
  scalable_vector_element_count(): BackendLaneCount | undefined {
    return unported("rustc_abi::LayoutData::scalable_vector_element_count");
  }

  /// Returns `true` if the type is a ZST and not unsized.
  ///
  /// Note that this does *not* imply that the type is irrelevant for layout! It can still have
  /// non-trivial alignment constraints. You probably want to use `is_1zst` instead.
  // stub: compiler/rustc_abi/src/lib.rs:2427 is_zst (lane abi-lib)
  is_zst(): boolean {
    return unported("rustc_abi::LayoutData::is_zst");
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
  // stub: compiler/rustc_abi/src/lib.rs:2446 is_ssa_standalone (lane abi-lib)
  is_ssa_standalone(): boolean {
    return unported("rustc_abi::LayoutData::is_ssa_standalone");
  }

  /// Checks if these two `Layout` are equal enough to be considered "the same for all function
  /// call ABIs". Note however that real ABIs depend on more details that are not reflected in the
  /// `Layout`; the `PassMode` need to be compared as well. Also note that we assume
  /// aggregates are passed via `PassMode::Indirect`, `PassMode::IndirectUnsized` or
  /// `PassMode::Cast`; more strict checks would otherwise be required.
  // stub: compiler/rustc_abi/src/lib.rs:2461 eq_abi (lane abi-lib)
  eq_abi(_other: LayoutData): boolean {
    return unported("rustc_abi::LayoutData::eq_abi");
  }

  // ---- layout/simple.rs: impl LayoutData (PORTING §8: statics in the class body) ----

  // stub: compiler/rustc_abi/src/layout/simple.rs:13 unit (lane abi-layout-b)
  static unit(_cx: HasDataLayout, _sized: boolean): LayoutData {
    return unported("rustc_abi::layout::simple::LayoutData::unit");
  }

  // stub: compiler/rustc_abi/src/layout/simple.rs:33 never_type (lane abi-layout-b)
  static never_type(_cx: HasDataLayout): LayoutData {
    return unported("rustc_abi::layout::simple::LayoutData::never_type");
  }

  // stub: compiler/rustc_abi/src/layout/simple.rs:51 scalar (lane abi-layout-b)
  static scalar(_cx: HasDataLayout, _scalar: Scalar): LayoutData {
    return unported("rustc_abi::layout::simple::LayoutData::scalar");
  }

  // stub: compiler/rustc_abi/src/layout/simple.rs:94 scalar_pair (lane abi-layout-b)
  static scalar_pair(_cx: HasDataLayout, _a: Scalar, _b: Scalar): LayoutData {
    return unported("rustc_abi::layout::simple::LayoutData::scalar_pair");
  }

  // stub: compiler/rustc_abi/src/layout/simple.rs:132 uninhabited_variant (lane abi-layout-b)
  static uninhabited_variant(_cx: HasDataLayout, _index: VariantIdx, _fields: number): LayoutData {
    return unported("rustc_abi::layout::simple::LayoutData::uninhabited_variant");
  }

  // stub: compiler/rustc_abi/src/layout/simple.rs:158 for_variant (lane abi-layout-b)
  static for_variant(_parent: LayoutData, _index: VariantIdx): LayoutData {
    return unported("rustc_abi::layout::simple::LayoutData::for_variant");
  }
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
  // stub: compiler/rustc_abi/src/lib.rs:2516 from_layout (lane abi-lib)
  static from_layout(_layout: LayoutData): VariantLayout {
    return unported("rustc_abi::VariantLayout::from_layout");
  }

  // stub: compiler/rustc_abi/src/lib.rs:2531 is_uninhabited (lane abi-lib)
  is_uninhabited(): boolean {
    return unported("rustc_abi::VariantLayout::is_uninhabited");
  }

  // stub: compiler/rustc_abi/src/lib.rs:2535 has_fields (lane abi-lib)
  has_fields(): boolean {
    return unported("rustc_abi::VariantLayout::has_fields");
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
