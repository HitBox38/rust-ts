// Port of compiler/rustc_abi/src/layout.rs (lane layout-contract: the types with their Debug, `FieldIdx` /
// `VariantIdx`, and a `// stub:` declaration of every fn for lanes abi-layout-a / abi-layout-b,
// docs/handoff/layout-contract.md "How to fill a stub").
//
// PORT (layout-contract):
// - The `FieldIdx: Idx` / `VariantIdx: Idx` parameters of the calculator are erased (rustc instantiates them with
//   `rustc_abi::{FieldIdx, VariantIdx}` only, see lib.ts `LayoutData`); `LocalIdx` (coroutines) stays a type parameter.
// - The field layouts `F: Deref<Target = &LayoutData> + fmt::Debug + Copy` (rustc: `TyAndLayout`) are any `F extends
//   DerefLayoutData` (`f.deref()` is the `LayoutData`, `f.align` is `f.deref().align`); `F: AsRef<LayoutData>` is
//   `F extends AsRefLayoutData`. The `fmt::Debug` bound only feeds `debug!` and is erased.
// - `IndexSlice<I, T>` / `IndexVec<I, T>` are `readonly T[]` / `T[]`; `u64` counts are `bigint`s, `u128` values `bigint`s.
// - `impl Fn(..)` parameters are plain functions; `impl Iterator<Item = T>` is an `Iterable<T>`.
// Init order: lib.ts re-exports this module, so its top-level code must not touch lib.ts's values.
import { newtype_index } from "../rustc_index/newtype_index.ts";
import type { BitMatrix } from "../rustc_index/bit_set.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, type Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { HasDataLayout, Integer, LayoutData, NicheOptimizations, NumScalableVectors, ReprOptions, Scalar, StructKind, TargetDataLayout } from "./lib.ts";

// mod coroutine;
// mod simple;  PORT (layout-contract): its `impl LayoutData` constructors are statics of lib.ts's `LayoutData` (PORTING §8).
// #[cfg(feature = "nightly")]
// mod ty;
// #[cfg(feature = "nightly")]
// pub use ty::{Layout, TyAbiInterface, TyAndLayout};  (re-exported by lib.ts)

// rustc_index::newtype_index! {
/// The *source-order* index of a field in a variant.
///
/// This is how most code after type checking refers to fields, rather than
/// using names (as names have hygiene complications and more complex lookup).
///
/// Particularly for `repr(Rust)` types, this may not be the same as *layout* order.
/// (It is for `repr(C)` `struct`s, however.)
///
/// For example, in the following types,
/// ```rust
/// # enum Never {}
/// # #[repr(u16)]
/// enum Demo1 {
///    Variant0 { a: Never, b: i32 } = 100,
///    Variant1 { c: u8, d: u64 } = 10,
/// }
/// struct Demo2 { e: u8, f: u16, g: u8 }
/// ```
/// `b` is `FieldIdx(1)` in `VariantIdx(0)`,
/// `d` is `FieldIdx(1)` in `VariantIdx(1)`, and
/// `f` is `FieldIdx(1)` in `VariantIdx(0)`.
//     #[stable_hash] #[encodable] #[orderable] #[gate_rustc_only]
//     pub struct FieldIdx {}
// }
// PORT (layout-contract): moved here from rustc_middle ty/decls.ts (which re-exports it); a branded number
// (PORTING §5); `newtype_index!` without `debug_format` prints the number.
export type FieldIdx = number & { readonly __brand: "FieldIdx" };
export const FieldIdx = {
  ...newtype_index<FieldIdx>((n) => `${n}`),
  /// The second field, at index 1.
  ///
  /// For use alongside [`FieldIdx::ZERO`], particularly with scalar pairs.
  ONE: 1 as FieldIdx,
};

// rustc_index::newtype_index! {
/// The *source-order* index of a variant in a type.
///
/// For enums, these are always `0..variant_count`, regardless of any
/// custom discriminants that may have been defined, and including any
/// variants that may end up uninhabited due to field types.  (Some of the
/// variants may not be present in a monomorphized ABI [`Variants`], but
/// those skipped variants are always counted when determining the *index*.)
///
/// `struct`s, `tuples`, and `unions`s are considered to have a single variant
/// with variant index zero, aka [`FIRST_VARIANT`].
//     #[stable_hash] #[encodable] #[orderable] #[gate_rustc_only]
//     pub struct VariantIdx {
//         /// Equivalent to `VariantIdx(0)`.
//         const FIRST_VARIANT = 0;
//     }
// }
// PORT (layout-contract): moved here from rustc_middle ty/decls.ts (which re-exports it).
export type VariantIdx = number & { readonly __brand: "VariantIdx" };
export const VariantIdx = newtype_index<VariantIdx>((n) => `${n}`);
/// Equivalent to `VariantIdx(0)`.
export const FIRST_VARIANT: VariantIdx = 0 as VariantIdx;

/** `F: Deref<Target = &LayoutData>` (module comment): rustc's `TyAndLayout`. */
export interface DerefLayoutData {
  deref(): LayoutData;
}
/** `F: AsRef<LayoutData>` (module comment): rustc's `TyAndLayout`. */
export interface AsRefLayoutData {
  as_ref(): LayoutData;
}

/** `core::range::RangeFrom<Idx>` (PORT (layout-contract): local shape of the std type, as lib.ts `RangeInclusive`). */
export interface RangeFrom<Idx> {
  readonly start: Idx;
}
/** `core::range::RangeToInclusive<Idx>` (PORT (layout-contract): local shape of the std type). */
export interface RangeToInclusive<Idx> {
  readonly last: Idx;
}

// A variant is absent if it's uninhabited and only has ZST fields.
// Present uninhabited variants only require space for their fields,
// but *not* an encoding of the discriminant (e.g., a tag value).
// See issue #49298 for more details on the need to leave space
// for non-ZST uninhabited data (mostly partial initialization).
// stub: compiler/rustc_abi/src/layout.rs:90 absent (lane abi-layout-a)
export function absent<F extends DerefLayoutData>(_fields: readonly F[]): boolean {
  return unported("rustc_abi::layout::absent");
}

/// Determines towards which end of a struct layout optimizations will try to place the best niches.
export type NicheBias = "Start" | "End";
export const NicheBias = { Start: "Start", End: "End" } as const;

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export type LayoutCalculatorError<F> =
  /// An unsized type was found in a location where a sized type was expected.
  ///
  /// This is not always a compile error, for example if there is a `[T]: Sized`
  /// bound in a where clause.
  ///
  /// Contains the field that was unexpectedly unsized.
  | { readonly $: "UnexpectedUnsized"; readonly _0: F }

  /// A type was too large for the target platform.
  | { readonly $: "SizeOverflow" }

  /// A union had no fields.
  | { readonly $: "EmptyUnion" }

  /// The fields or variants have irreconcilable reprs
  | { readonly $: "ReprConflict" }

  /// The length of an SIMD type is zero
  | { readonly $: "ZeroLengthSimdType" }

  /// The length of an SIMD type exceeds the maximum number of lanes
  | { readonly $: "OversizedSimdType"; readonly max_lanes: number }

  /// An element type of an SIMD type isn't a primitive
  | { readonly $: "NonPrimitiveSimdType"; readonly _0: F };
export const LayoutCalculatorError = {
  SizeOverflow: Object.freeze({ $: "SizeOverflow" }) as LayoutCalculatorError<never>,
  EmptyUnion: Object.freeze({ $: "EmptyUnion" }) as LayoutCalculatorError<never>,
  ReprConflict: Object.freeze({ $: "ReprConflict" }) as LayoutCalculatorError<never>,
  ZeroLengthSimdType: Object.freeze({ $: "ZeroLengthSimdType" }) as LayoutCalculatorError<never>,

  // PORT (layout-contract): `LayoutCalculatorError<()>`'s payload `()` is `null`.
  // stub: compiler/rustc_abi/src/layout.rs:139 without_payload (lane abi-layout-a)
  without_payload<F>(_self: LayoutCalculatorError<F>): LayoutCalculatorError<null> {
    return unported("rustc_abi::layout::LayoutCalculatorError::without_payload");
  },

  /// Format an untranslated diagnostic for this type
  ///
  /// Intended for use by rust-analyzer, as neither it nor `rustc_abi` depend on fluent infra.
  // PORT (layout-contract): `fmt::Formatter` output is the returned string.
  // stub: compiler/rustc_abi/src/layout.rs:155 fallback_fmt (lane abi-layout-a)
  fallback_fmt<F>(_self: LayoutCalculatorError<F>, _f: Fmt): string {
    return unported("rustc_abi::layout::LayoutCalculatorError::fallback_fmt");
  },
} as const;
// derive(Debug)
export function debug_LayoutCalculatorError<F>(v: LayoutCalculatorError<F>, f: Fmt, debug_F: Debug<F>): string {
  switch (v.$) {
    case "UnexpectedUnsized":
      return debug_tuple(f, "UnexpectedUnsized", [debug_F(v._0, f)]);
    case "SizeOverflow":
      return "SizeOverflow";
    case "EmptyUnion":
      return "EmptyUnion";
    case "ReprConflict":
      return "ReprConflict";
    case "ZeroLengthSimdType":
      return "ZeroLengthSimdType";
    case "OversizedSimdType":
      return debug_struct(f, "OversizedSimdType", [["max_lanes", debug_int(v.max_lanes, f)]]);
    case "NonPrimitiveSimdType":
      return debug_tuple(f, "NonPrimitiveSimdType", [debug_F(v._0, f)]);
  }
}

export type LayoutCalculatorResult<F> = Result<LayoutData, LayoutCalculatorError<F>>;

// #[derive(Clone, Copy, Debug)]
export class LayoutCalculator<Cx extends HasDataLayout> {
  constructor(public cx: Cx) {}

  // rustc: compiler/rustc_abi/src/layout.rs:178 new
  static new<Cx extends HasDataLayout>(cx: Cx): LayoutCalculator<Cx> {
    return new LayoutCalculator(cx);
  }

  // PORT (layout-contract): `count_if_sized: Option<u64>` is `bigint | undefined`.
  // stub: compiler/rustc_abi/src/layout.rs:182 layout_of_array_like (lane abi-layout-a)
  layout_of_array_like<F>(_element: LayoutData, _count_if_sized: bigint | undefined): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_array_like");
  }

  // stub: compiler/rustc_abi/src/layout.rs:206 layout_of_scalable_vector_type (lane abi-layout-a)
  layout_of_scalable_vector_type<F extends AsRefLayoutData>(_element: F, _count: bigint, _number_of_vectors: NumScalableVectors): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_scalable_vector_type");
  }

  // stub: compiler/rustc_abi/src/layout.rs:225 layout_of_simd_type (lane abi-layout-a)
  layout_of_simd_type<F extends AsRefLayoutData>(_element: F, _count: bigint, _repr_packed: boolean): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_simd_type");
  }

  /// Compute the layout for a coroutine.
  ///
  /// This uses dedicated code instead of [`Self::layout_of_struct_or_enum`], as coroutine
  /// fields may be shared between multiple variants (see the [`coroutine`] module for details).
  // stub: compiler/rustc_abi/src/layout.rs:244 layout_of_coroutine (lane abi-layout-b)
  layout_of_coroutine<F extends DerefLayoutData, LocalIdx extends number>(
    _local_layouts: readonly F[],
    _prefix_layouts: F[],
    _variant_fields: readonly (readonly LocalIdx[])[],
    _storage_conflicts: BitMatrix<LocalIdx, LocalIdx>,
    _tag_to_layout: (tag: Scalar) => F,
  ): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_coroutine");
  }

  /// Compute the layout for a univariant (see [`Variants::Single`]).
  ///
  /// As a consumer of `rustc_abi`, you should only use this method for non-ADTs.
  /// For structs and univariant enums, use [`Self::layout_of_struct`] instead
  /// (it uses this function internally).
  // stub: compiler/rustc_abi/src/layout.rs:273 layout_of_univariant (lane abi-layout-a)
  layout_of_univariant<F extends DerefLayoutData>(_fields: readonly F[], _repr: ReprOptions, _kind: StructKind): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_univariant");
  }

  // PORT (layout-contract): `discriminants: impl Iterator<Item = (VariantIdx, u128)>` is an `Iterable`.
  // stub: compiler/rustc_abi/src/layout.rs:343 layout_of_struct_or_enum (lane abi-layout-a)
  layout_of_struct_or_enum<F extends DerefLayoutData>(
    _repr: ReprOptions,
    _variants: readonly (readonly F[])[],
    _is_enum: boolean,
    _niche_optimizations: NicheOptimizations,
    _discr_range_of_repr: (min: RangeFrom<bigint>, max: RangeToInclusive<bigint>) => [Integer, boolean],
    _discriminants: Iterable<[VariantIdx, bigint]>,
    _always_sized: boolean,
  ): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_struct_or_enum");
  }

  // stub: compiler/rustc_abi/src/layout.rs:397 layout_of_union (lane abi-layout-a)
  layout_of_union<F extends DerefLayoutData>(_repr: ReprOptions, _variants: readonly (readonly F[])[]): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_union");
  }

  // stub: compiler/rustc_abi/src/layout.rs:533 layout_of_struct (lane abi-layout-a)
  layout_of_struct<F extends DerefLayoutData>(
    _repr: ReprOptions,
    _variants: readonly (readonly F[])[],
    _variant_idx: VariantIdx,
    _is_enum: boolean,
    _niche_optimizations: NicheOptimizations,
    _always_sized: boolean,
  ): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_struct");
  }

  // stub: compiler/rustc_abi/src/layout.rs:583 layout_of_enum (lane abi-layout-b)
  layout_of_enum<F extends DerefLayoutData>(
    _repr: ReprOptions,
    _variants: readonly (readonly F[])[],
    _discr_range_of_repr: (min: RangeFrom<bigint>, max: RangeToInclusive<bigint>) => [Integer, boolean],
    _discriminants: Iterable<[VariantIdx, bigint]>,
  ): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_enum");
  }

  // stub: compiler/rustc_abi/src/layout.rs:1090 layout_of_univariant_biased (lane abi-layout-a)
  layout_of_univariant_biased<F extends DerefLayoutData>(_fields: readonly F[], _repr: ReprOptions, _kind: StructKind, _niche_bias: NicheBias): LayoutCalculatorResult<F> {
    return unported("rustc_abi::layout::LayoutCalculator::layout_of_univariant_biased");
  }

  // stub: compiler/rustc_abi/src/layout.rs:1440 format_field_niches (lane abi-layout-a)
  format_field_niches<F extends DerefLayoutData>(_layout: LayoutData, _fields: readonly F[]): string {
    return unported("rustc_abi::layout::LayoutCalculator::format_field_niches");
  }
}
// derive(Debug)
export function debug_LayoutCalculator<Cx extends HasDataLayout>(v: LayoutCalculator<Cx>, f: Fmt, debug_Cx: Debug<Cx>): string {
  return debug_struct(f, "LayoutCalculator", [["cx", debug_Cx(v.cx, f)]]);
}

export type SimdVectorKind =
  /// `#[rustc_scalable_vector]`
  | { readonly $: "Scalable"; readonly _0: NumScalableVectors }
  /// `#[repr(simd, packed)]`
  | { readonly $: "PackedFixed" }
  /// `#[repr(simd)]`
  | { readonly $: "Fixed" };
export const SimdVectorKind = {
  PackedFixed: Object.freeze({ $: "PackedFixed" }) as SimdVectorKind,
  Fixed: Object.freeze({ $: "Fixed" }) as SimdVectorKind,
} as const;

// stub: compiler/rustc_abi/src/layout.rs:1481 vector_type_layout (lane abi-layout-a)
export function vector_type_layout<F extends AsRefLayoutData>(_kind: SimdVectorKind, _dl: TargetDataLayout, _element: F, _count: bigint): LayoutCalculatorResult<F> {
  return unported("rustc_abi::layout::vector_type_layout");
}
