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
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../std/panic.ts";
import { Err, Ok, ok, type Result, unwrap_result } from "../std/result.ts";
import type { HasDataLayout, NicheOptimizations, NumScalableVectors, ReprOptions, TargetDataLayout } from "./lib.ts";
// (abi-layout-b: `layout_of_enum` / `layout_of_coroutine`; lib.ts values are read inside function bodies only)
import { Hash64 } from "../rustc_hashes/lib.ts";
import {
  AbiAlign,
  Align,
  Align_eq,
  Align_max,
  Align_min,
  type BackendRepr,
  debug_AlignFromBytesError,
  debug_Integer,
  debug_Size,
  FieldsShape,
  Integer,
  IntegerType,
  LayoutData,
  Niche,
  Primitive,
  Primitive_eq,
  type RangeInclusive,
  Scalar,
  Size,
  StructKind,
  TagEncoding,
  VariantLayout,
} from "./lib.ts";
import * as coroutine from "./layout/coroutine.ts";
import { WrappingRange } from "./wrapping_range.ts";

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
  // rustc: compiler/rustc_abi/src/layout.rs:244 layout_of_coroutine
  layout_of_coroutine<F extends DerefLayoutData, LocalIdx extends number>(
    local_layouts: readonly F[],
    prefix_layouts: F[],
    variant_fields: readonly (readonly LocalIdx[])[],
    storage_conflicts: BitMatrix<LocalIdx, LocalIdx>,
    tag_to_layout: (tag: Scalar) => F,
  ): LayoutCalculatorResult<F> {
    return coroutine.layout(this, local_layouts, prefix_layouts, variant_fields, storage_conflicts, tag_to_layout);
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

  // rustc: compiler/rustc_abi/src/layout.rs:583 layout_of_enum
  layout_of_enum<F extends DerefLayoutData>(
    repr: ReprOptions,
    variants: readonly (readonly F[])[],
    discr_range_of_repr: (min: RangeFrom<bigint>, max: RangeToInclusive<bigint>) => [Integer, boolean],
    discriminants: Iterable<[VariantIdx, bigint]>,
  ): LayoutCalculatorResult<F> {
    const dl = this.cx.data_layout();
    // bail if the enum has an incoherent repr that cannot be computed
    if (repr.packed()) {
      return Err(LayoutCalculatorError.ReprConflict);
    }

    // PORT (abi-layout-b): `Ord` of `Option<Align>` (`None < Some`) and of `Integer` (declaration order), and
    // `Ord::max` (`other` on ties) / `Ord::cmp` of `Size`; lib.ts has no helpers for them.
    const option_align_max = (a: Align | undefined, b: Align | undefined): Align | undefined => (a === undefined ? b : b === undefined ? a : Align_max(a, b));
    const INTEGER_ORDER: readonly Integer[] = ["I8", "I16", "I32", "I64", "I128"];
    const integer_ord = (i: Integer): number => INTEGER_ORDER.indexOf(i);
    const size_max = (a: Size, b: Size): Size => (b.bytes() >= a.bytes() ? b : a);
    const size_cmp = (a: Size, b: Size): number => (a.bytes() < b.bytes() ? -1 : a.bytes() > b.bytes() ? 1 : 0);

    const calculate_niche_filling_layout = (): LayoutData | undefined => {
      interface VariantLayoutInfo {
        align_abi: Align;
      }

      if (repr.inhibit_enum_layout_opt()) {
        return undefined;
      }

      if (variants.length < 2) {
        return undefined;
      }

      let align = dl.aggregate_align;
      let max_repr_align = repr.align;
      let unadjusted_abi_align = align;
      let combined_seed = repr.field_shuffle_seed;

      const variants_info: VariantLayoutInfo[] = [];
      // `.map(..).collect::<Option<IndexVec<VariantIdx, _>>>()?` stops at the first `None`.
      const variant_layouts: VariantLayout[] = [];
      for (const v of variants) {
        const st = ok(this.layout_of_univariant(v, repr, StructKind.AlwaysSized));
        if (st === undefined) return undefined;

        variants_info.push({ align_abi: st.align.abi });

        align = Align_max(align, st.align.abi);
        max_repr_align = option_align_max(max_repr_align, st.max_repr_align);
        unadjusted_abi_align = Align_max(unadjusted_abi_align, st.unadjusted_abi_align);
        combined_seed = Hash64.wrapping_add(combined_seed, st.randomization_seed);

        variant_layouts.push(VariantLayout.from_layout(st));
      }

      // `max_by_key` keeps the last maximal element.
      let largest_variant_index: VariantIdx | undefined = undefined;
      let largest_variant_key = 0;
      for (let i = 0; i < variant_layouts.length; i++) {
        const key = variant_layouts[i]!.size.bytes();
        if (largest_variant_index === undefined || key >= largest_variant_key) {
          largest_variant_index = i as VariantIdx;
          largest_variant_key = key;
        }
      }
      if (largest_variant_index === undefined) return undefined;
      const largest = largest_variant_index;

      const all_indices: VariantIdx[] = variants.map((_, i) => i as VariantIdx);
      const needs_disc = (index: VariantIdx): boolean => index !== largest && !absent(variants[index]!);
      const niche_variants: RangeInclusive<VariantIdx> = {
        start: unwrap(all_indices.find((v) => needs_disc(v))),
        last: unwrap(all_indices.findLast((v) => needs_disc(v))),
      };

      const count = BigInt(VariantIdx.index(niche_variants.last)) - BigInt(VariantIdx.index(niche_variants.start)) + 1n;

      // Use the largest niche in the largest variant.
      const niche = variant_layouts[largest]!.largest_niche;
      if (niche === undefined) return undefined;
      const reserved = niche.reserve(dl, count);
      if (reserved === undefined) return undefined;
      const [niche_start, niche_scalar] = reserved;
      const niche_offset = niche.offset;
      const niche_size = Primitive.size(niche.value, dl);
      const size = variant_layouts[largest]!.size.align_to(align);

      const all_variants_fit = variant_layouts.every((layout, i) => {
        if (i === largest) {
          return true;
        }

        layout.largest_niche = undefined;

        if (layout.size.bytes() <= niche_offset.bytes()) {
          // This variant will fit before the niche.
          return true;
        }

        // Determine if it'll fit after the niche.
        const this_align = variants_info[i]!.align_abi;
        const this_offset = niche_offset.add(niche_size).align_to(this_align);

        if (this_offset.add(layout.size).bytes() > size.bytes()) {
          return false;
        }

        // It'll fit, but we need to make some adjustments.
        for (let k = 0; k < layout.field_offsets.length; k++) {
          layout.field_offsets[k] = layout.field_offsets[k]!.add_assign(this_offset);
        }

        // It can't be a Scalar or ScalarPair because the offset isn't 0.
        if (!layout.is_uninhabited()) {
          layout.backend_repr = { $: "Memory", sized: true };
        }
        layout.size = layout.size.add_assign(this_offset);

        return true;
      });

      if (!all_variants_fit) {
        return undefined;
      }

      const largest_niche = Niche.from_scalar(dl, niche_offset, niche_scalar);

      const others_zst = variant_layouts.every((layout, i) => i === largest || layout.size.bytes() === Size.ZERO.bytes());
      const same_size = size.bytes() === variant_layouts[largest]!.size.bytes();
      const same_align = Align_eq(align, variants_info[largest]!.align_abi);

      const uninhabited = variant_layouts.every((v) => v.is_uninhabited());
      let abi: BackendRepr;
      if (same_size && same_align && others_zst) {
        const largest_repr = variant_layouts[largest]!.backend_repr;
        switch (largest_repr.$) {
          // When the total alignment and size match, we can use the
          // same ABI as the scalar variant with the reserved niche.
          case "Scalar":
            abi = { $: "Scalar", _0: niche_scalar };
            break;
          case "ScalarPair": {
            const { a: first, b: second, b_offset } = largest_repr;
            // Only the niche is guaranteed to be initialised,
            // so use union layouts for the other primitive.
            if (niche_offset.bytes() === Size.ZERO.bytes()) {
              abi = {
                $: "ScalarPair",
                a: niche_scalar,
                b: Scalar.to_union(second),
                b_offset,
              };
            } else {
              abi = {
                $: "ScalarPair",
                a: Scalar.to_union(first),
                b: niche_scalar,
                b_offset,
              };
            }
            break;
          }
          default:
            abi = { $: "Memory", sized: true };
        }
      } else {
        abi = { $: "Memory", sized: true };
      }

      const layout = new LayoutData(
        /* fields */ {
          $: "Arbitrary",
          offsets: [niche_offset],
          in_memory_order: [FieldIdx.new(0)],
        },
        /* variants */ {
          $: "Multiple",
          tag: niche_scalar,
          tag_encoding: {
            $: "Niche",
            untagged_variant: largest,
            niche_variants,
            niche_start,
          },
          tag_field: FieldIdx.new(0),
          variants: variant_layouts,
        },
        /* backend_repr */ abi,
        largest_niche,
        uninhabited,
        /* align */ AbiAlign.new(align),
        size,
        max_repr_align,
        unadjusted_abi_align,
        /* repr_c */ repr.c(),
        /* randomization_seed */ combined_seed,
      );

      return layout;
    };

    const niche_filling_layout = calculate_niche_filling_layout();

    const discr_type = repr.discr_type();
    const discr_size = Integer.size(Integer.from_attr(dl, discr_type));

    const necessary_discriminants: bigint[] = [];
    for (const [i, val] of discriminants) {
      if (repr.c() || variants[i]!.every((f) => !f.deref().is_uninhabited())) necessary_discriminants.push(val);
    }

    // When picking the integer to use, we respect how the discriminants were written
    // in the original rust code, rather than looking only at the bit pattern.
    let min_negative: bigint;
    let max_positive: bigint;
    if (IntegerType.is_signed(discr_type)) {
      let [min, max] = [0n, 0n];
      for (const val0 of necessary_discriminants) {
        const val = discr_size.sign_extend(val0);
        // `u128::try_from(val)` (an `i128`) is `Ok` exactly when `val >= 0`.
        if (val >= 0n) {
          max = max >= val ? max : val;
        } else {
          min = min <= val ? min : val;
        }
      }
      [min_negative, max_positive] = [min, max];
    } else {
      // We might have no inhabited variants, so pretend there's at least one.
      let max: bigint | undefined = undefined;
      for (const val of necessary_discriminants) if (max === undefined || val >= max) max = val;
      [min_negative, max_positive] = [0n, max ?? 0n];
    }
    // trace!(?min_negative, ?max_positive);

    const [min_ity, signed] = discr_range_of_repr({ start: min_negative }, { last: max_positive }); //Integer::discr_range_of_repr(tcx, ty, &repr, min, max);

    let align = dl.aggregate_align;
    let max_repr_align = repr.align;
    let unadjusted_abi_align = align;
    let combined_seed = repr.field_shuffle_seed;

    let size = Size.ZERO;

    // We're interested in the smallest alignment, so start large.
    let start_align = unwrap_result(Align.from_bytes(256), debug_AlignFromBytesError);
    assert_eq(Integer.for_align(dl, start_align), undefined, (v) => debug_option(v, PLAIN, debug_Integer));

    // repr(C) on an enum tells us to make a (tag, union) layout,
    // so we need to grow the prefix alignment to be at least
    // the alignment of the union. (This value is used both for
    // determining the alignment of the overall enum, and the
    // determining the alignment of the payload after the tag.)
    let prefix_align = Integer.align(min_ity, dl).abi;
    if (repr.c()) {
      for (const fields of variants) {
        for (const field of fields) {
          prefix_align = Align_max(prefix_align, field.deref().align.abi);
        }
      }
    }

    // Create the set of structs that represent each variant.
    // `.map(..).collect::<Result<IndexVec<VariantIdx, _>, _>>()?` stops at the first `Err`.
    const layout_variants: VariantLayout[] = [];
    for (const field_layouts of variants) {
      const st_r = this.layout_of_univariant(field_layouts, repr, { $: "Prefixed", _0: Integer.size(min_ity), _1: prefix_align });
      if (st_r.$ === "Err") return st_r;
      const st = st_r._0;
      // Find the first field we can't move later
      // to make room for a larger discriminant.
      for (const field_idx of FieldsShape.index_by_increasing_offset(st.fields)) {
        const field = field_layouts[FieldIdx.new(field_idx)]!;
        if (!field.deref().is_1zst()) {
          start_align = Align_min(start_align, field.deref().align.abi);
          break;
        }
      }
      size = size_max(size, st.size);
      align = Align_max(align, st.align.abi);
      max_repr_align = option_align_max(max_repr_align, st.max_repr_align);
      unadjusted_abi_align = Align_max(unadjusted_abi_align, st.unadjusted_abi_align);
      combined_seed = Hash64.wrapping_add(combined_seed, st.randomization_seed);
      layout_variants.push(VariantLayout.from_layout(st));
    }

    // Align the maximum variant size to the largest alignment.
    size = size.align_to(align);

    // FIXME(oli-obk): deduplicate and harden these checks
    if (size.bytes() >= dl.obj_size_bound()) {
      return Err(LayoutCalculatorError.SizeOverflow);
    }

    const typeck_ity = Integer.from_attr(dl, repr.discr_type());
    if (integer_ord(typeck_ity) < integer_ord(min_ity)) {
      // It is a bug if Layout decided on a greater discriminant size than typeck for
      // some reason at this point (based on values discriminant can take on). Mostly
      // because this discriminant will be loaded, and then stored into variable of
      // type calculated by typeck. Consider such case (a bug): typeck decided on
      // byte-sized discriminant, but layout thinks we need a 16-bit to store all
      // discriminant values. That would be a bug, because then, in codegen, in order
      // to store this 16-bit discriminant into 8-bit sized temporary some of the
      // space necessary to represent would have to be discarded (or layout is wrong
      // on thinking it needs 16 bits)
      panic(`layout decided on a larger discriminant type (${debug_Integer(min_ity, PLAIN)}) than typeck (${debug_Integer(typeck_ity, PLAIN)})`);
      // However, it is fine to make discr type however large (as an optimisation)
      // after this point – we’ll just truncate the value we load in codegen.
    }

    // Check to see if we should use a different type for the
    // discriminant. We can safely use a type with the same size
    // as the alignment of the first field of each variant.
    // We increase the size of the discriminant to avoid LLVM copying
    // padding when it doesn't need to. This normally causes unaligned
    // load/stores and excessive memcpy/memset operations. By using a
    // bigger integer size, LLVM can be sure about its contents and
    // won't be so conservative.

    // Use the initial field alignment
    let ity = repr.c() || repr.int !== undefined ? min_ity : (Integer.for_align(dl, start_align) ?? min_ity);

    // If the alignment is not larger than the chosen discriminant size,
    // don't use the alignment as the final size.
    if (integer_ord(ity) <= integer_ord(min_ity)) {
      ity = min_ity;
    } else {
      // Patch up the variants' first few fields.
      const old_ity_size = Integer.size(min_ity);
      const new_ity_size = Integer.size(ity);
      for (const variant of layout_variants) {
        for (let k = 0; k < variant.field_offsets.length; k++) {
          const i = variant.field_offsets[k]!;
          if (i.bytes() <= old_ity_size.bytes()) {
            assert_eq(i, old_ity_size, (v) => debug_Size(v, PLAIN), (a, b) => a.bytes() === b.bytes());
            variant.field_offsets[k] = new_ity_size;
          }
        }
        // We might be making the struct larger.
        if (variant.size.bytes() <= old_ity_size.bytes()) {
          variant.size = new_ity_size;
        }
      }
    }

    let tag_valid_range: WrappingRange;
    {
      const tag_size = Integer.size(ity);
      const tags = necessary_discriminants.map((d) => tag_size.truncate(d));
      tag_valid_range =
        WrappingRange.smallest_range_containing(tags, tag_size) ??
        // We might have no inhabited variants, so pretend there's at least one.
        new WrappingRange(0n, 0n);
    }
    const tag: Scalar = {
      $: "Initialized",
      value: { $: "Int", _0: ity, _1: signed },
      valid_range: tag_valid_range,
    };
    let abi: BackendRepr = { $: "Memory", sized: true };

    const uninhabited = layout_variants.every((v) => v.is_uninhabited());
    if (Scalar.size(tag, dl).bytes() === size.bytes()) {
      // Make sure we only use scalar layout when the enum is entirely its
      // own tag (i.e. it has no padding nor any non-ZST variant fields).
      abi = { $: "Scalar", _0: tag };
    } else {
      // Try to use a ScalarPair for all tagged enums.
      // That's possible only if we can find a common primitive type for all variants.
      let common_prim: [Primitive, Size] | undefined = undefined;
      let common_prim_initialized_in_all_variants = true;
      // the match guard `p.size(dl) == i.size(dl) && p.default_align(dl) == i.default_align(dl)` below
      const pointer_int_compatible = (p: Primitive, i: Primitive): boolean =>
        Primitive.size(p, dl).bytes() === Primitive.size(i, dl).bytes() && Align_eq(Primitive.default_align(p, dl).abi, Primitive.default_align(i, dl).abi);
      variants_loop: for (let v = 0; v < Math.min(variants.length, layout_variants.length); v++) {
        const [field_layouts, layout_variant] = [variants[v]!, layout_variants[v]!];
        // We skip *all* ZST here and later check if we are good in terms of alignment.
        // This lets us handle some cases involving aligned ZST.
        const fields = (function* (): Generator<[F, Size]> {
          for (let k = 0; k < Math.min(field_layouts.length, layout_variant.field_offsets.length); k++) {
            const p: [F, Size] = [field_layouts[k]!, layout_variant.field_offsets[k]!];
            if (!p[0].deref().is_zst()) yield p;
          }
        })();
        const [n0, n1] = [fields.next(), fields.next()];
        let field: F;
        let offset: Size;
        if (n0.done === true && n1.done === true) {
          common_prim_initialized_in_all_variants = false;
          continue;
        } else if (n0.done !== true && n1.done === true) {
          [field, offset] = n0.value;
        } else {
          common_prim = undefined;
          break;
        }
        let prim: Primitive;
        const field_repr = field.deref().backend_repr;
        switch (field_repr.$) {
          case "Scalar": {
            const scalar = field_repr._0;
            const initialized = scalar.$ === "Initialized";
            common_prim_initialized_in_all_variants = common_prim_initialized_in_all_variants && initialized;
            prim = Scalar.primitive(scalar);
            break;
          }
          default:
            common_prim = undefined;
            break variants_loop;
        }
        if (common_prim !== undefined) {
          const [old_prim, common_offset]: [Primitive, Size] = common_prim;
          // All variants must be at the same offset
          if (offset.bytes() !== common_offset.bytes()) {
            common_prim = undefined;
            break;
          }
          // This is pretty conservative. We could go fancier
          // by realising that (u8, u8) could just cohabit with
          // u16 or even u32.
          let new_prim: Primitive;
          if (Primitive_eq(old_prim, prim)) {
            // Allow all identical primitives.
            new_prim = old_prim;
          } else if (old_prim.$ === "Int" && prim.$ === "Int" && old_prim._0 === prim._0) {
            // Allow integers of the same size with differing signedness.
            // We arbitrarily choose the signedness of the first variant.
            new_prim = old_prim;
          } else if (
            // Allow integers mixed with pointers of the same layout.
            // We must represent this using a pointer, to avoid
            // roundtripping pointers through ptrtoint/inttoptr.
            ((old_prim.$ === "Pointer" && prim.$ === "Int") || (old_prim.$ === "Int" && prim.$ === "Pointer")) &&
            pointer_int_compatible(old_prim.$ === "Pointer" ? old_prim : prim, old_prim.$ === "Pointer" ? prim : old_prim)
          ) {
            new_prim = old_prim.$ === "Pointer" ? old_prim : prim;
          } else {
            common_prim = undefined;
            break;
          }
          // We may be updating the primitive here, for example from int->ptr.
          common_prim = [new_prim, common_offset];
        } else {
          common_prim = [prim, offset];
        }
      }
      if (common_prim !== undefined) {
        const [prim, offset] = common_prim;
        let prim_scalar: Scalar;
        if (common_prim_initialized_in_all_variants) {
          const size = Primitive.size(prim, dl);
          assert(size.bits() <= 128, "assertion failed: size.bits() <= 128");
          prim_scalar = { $: "Initialized", value: prim, valid_range: WrappingRange.full(size) };
        } else {
          // Common prim might be uninit.
          prim_scalar = { $: "Union", value: prim };
        }
        const pair = LayoutData.scalar_pair(this.cx, tag, prim_scalar);
        let pair_offsets: readonly Size[];
        switch (pair.fields.$) {
          case "Arbitrary": {
            const { offsets, in_memory_order } = pair.fields;
            assert_eq(
              in_memory_order,
              [FieldIdx.new(0), FieldIdx.new(1)],
              (v) => debug_vec(v, PLAIN, debug_int),
              (a, b) => a.length === b.length && a.every((x, k) => x === b[k]),
            );
            pair_offsets = offsets;
            break;
          }
          default:
            return panic("encountered a non-arbitrary layout during enum layout");
        }
        if (
          pair_offsets[FieldIdx.new(0)]!.bytes() === Size.ZERO.bytes() &&
          pair_offsets[FieldIdx.new(1)]!.bytes() === offset.bytes() &&
          Align_eq(align, pair.align.abi) &&
          size.bytes() === pair.size.bytes()
        ) {
          // We can use `ScalarPair` only when it matches our
          // already computed layout (including `#[repr(C)]`).
          abi = pair.backend_repr;
        }
      }
    }

    // If we pick a "clever" (by-value) ABI, we might have to adjust the ABI of the
    // variants to ensure they are consistent. This is because a downcast is
    // semantically a NOP, and thus should not affect layout.
    if (abi.$ === "Scalar" || abi.$ === "ScalarPair") {
      for (const variant of layout_variants) {
        // We only do this for variants with fields; the others are not accessed anyway.
        // Also do not overwrite any already existing "clever" ABIs.
        if (variant.backend_repr.$ === "Memory" && variant.has_fields()) {
          variant.backend_repr = abi;
          // Also need to bump up the size, so that the entire value fits in here.
          variant.size = size_max(variant.size, size);
        }
      }
    }

    const largest_niche = Niche.from_scalar(dl, Size.ZERO, tag);

    const tagged_layout = new LayoutData(
      /* fields */ {
        $: "Arbitrary",
        offsets: [Size.ZERO],
        in_memory_order: [FieldIdx.new(0)],
      },
      /* variants */ {
        $: "Multiple",
        tag,
        tag_encoding: TagEncoding.Direct,
        tag_field: FieldIdx.new(0),
        variants: layout_variants,
      },
      /* backend_repr */ abi,
      largest_niche,
      uninhabited,
      /* align */ AbiAlign.new(align),
      size,
      max_repr_align,
      unadjusted_abi_align,
      /* repr_c */ repr.c(),
      /* randomization_seed */ combined_seed,
    );

    let best_layout: LayoutData;
    if (niche_filling_layout !== undefined) {
      const [tl, nl] = [tagged_layout, niche_filling_layout];
      // Pick the smaller layout; otherwise,
      // pick the layout with the larger niche; otherwise,
      // pick tagged as it has simpler codegen.
      // use cmp::Ordering::*;
      const niche_size = (l: LayoutData): bigint => (l.largest_niche === undefined ? 0n : l.largest_niche.available(dl));
      const by_size = size_cmp(tl.size, nl.size);
      const [tl_niche, nl_niche] = [niche_size(tl), niche_size(nl)];
      const by_niche = tl_niche < nl_niche ? -1 : tl_niche > nl_niche ? 1 : 0;
      if (by_size > 0) {
        best_layout = nl;
      } else if (by_size === 0 && by_niche < 0) {
        best_layout = nl;
      } else {
        best_layout = tl;
      }
    } else {
      best_layout = tagged_layout;
    }

    return Ok(best_layout);
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
