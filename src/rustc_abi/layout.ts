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
import { Hash64 } from "../rustc_hashes/lib.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../std/panic.ts";
import { Err, Ok, ok, type Result, unwrap_result } from "../std/result.ts";
// (abi-layout-b: `layout_of_enum` / `layout_of_coroutine`; lib.ts values are read inside function bodies only)
import {
  AbiAlign,
  Align,
  Align_eq,
  Align_max,
  Align_min,
  BackendLaneCount,
  BackendRepr,
  BackendRepr_eq,
  debug_Align,
  debug_AlignFromBytesError,
  debug_Integer,
  debug_Size,
  FieldsShape,
  type HasDataLayout,
  Integer,
  Integer_discriminant,
  IntegerType,
  LayoutData,
  Niche,
  NicheOptimizations,
  type NumScalableVectors,
  Primitive,
  Primitive_eq,
  type RangeInclusive,
  type ReprOptions,
  Scalar,
  Size,
  StructKind,
  TagEncoding,
  type TargetDataLayout,
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
// rustc: compiler/rustc_abi/src/layout.rs:90 absent
export function absent<F extends DerefLayoutData>(fields: readonly F[]): boolean {
  const uninhabited = fields.some((f) => f.deref().is_uninhabited());
  // We cannot ignore alignment; that might lead us to entirely discard a variant and
  // produce an enum that is less aligned than it should be!
  const is_1zst = fields.every((f) => f.deref().is_1zst());
  return uninhabited && is_1zst;
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
  // rustc: compiler/rustc_abi/src/layout.rs:139 without_payload
  without_payload<F>(self: LayoutCalculatorError<F>): LayoutCalculatorError<null> {
    switch (self.$) {
      case "UnexpectedUnsized":
        return { $: "UnexpectedUnsized", _0: null };
      case "SizeOverflow":
        return LayoutCalculatorError.SizeOverflow;
      case "EmptyUnion":
        return LayoutCalculatorError.EmptyUnion;
      case "ReprConflict":
        return LayoutCalculatorError.ReprConflict;
      case "ZeroLengthSimdType":
        return LayoutCalculatorError.ZeroLengthSimdType;
      case "OversizedSimdType":
        return { $: "OversizedSimdType", max_lanes: self.max_lanes };
      case "NonPrimitiveSimdType":
        return { $: "NonPrimitiveSimdType", _0: null };
    }
  },

  /// Format an untranslated diagnostic for this type
  ///
  /// Intended for use by rust-analyzer, as neither it nor `rustc_abi` depend on fluent infra.
  // PORT (layout-contract): `fmt::Formatter` output is the returned string.
  // rustc: compiler/rustc_abi/src/layout.rs:155 fallback_fmt
  fallback_fmt<F>(self: LayoutCalculatorError<F>, _f: Fmt): string {
    switch (self.$) {
      case "UnexpectedUnsized":
        return "an unsized type was found where a sized type was expected";
      case "SizeOverflow":
        return "size overflow";
      case "EmptyUnion":
        return "type is a union with no fields";
      case "ReprConflict":
        return "type has an invalid repr";
      case "ZeroLengthSimdType":
      case "OversizedSimdType":
      case "NonPrimitiveSimdType":
        return "invalid simd type definition";
    }
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
  // rustc: compiler/rustc_abi/src/layout.rs:182 layout_of_array_like
  layout_of_array_like<F>(
    element: LayoutData,
    count_if_sized: bigint | undefined, // None for slices
  ): LayoutCalculatorResult<F> {
    const count = count_if_sized ?? 0n;
    // (merge-layout) the `u64` count goes to `Size::checked_mul` as a `bigint`: its result is exact (`None` for every
    // product at least `obj_size_bound`, `0 * count` is `0`), and a size below the bound but past 2^53 is
    // `unported(SIZE_BEYOND_2_53)` there (abi-lib).
    const size = element.size.checked_mul(count, this.cx);
    if (size === undefined) return Err(LayoutCalculatorError.SizeOverflow);

    return Ok(
      new LayoutData(
        /* fields */ { $: "Array", stride: element.size, count },
        /* variants */ { $: "Single", index: VariantIdx.new(0) },
        /* backend_repr */ { $: "Memory", sized: count_if_sized !== undefined },
        /* largest_niche */ count !== 0n ? element.largest_niche : undefined,
        /* uninhabited */ element.uninhabited && count !== 0n,
        /* align */ element.align,
        size,
        /* max_repr_align */ undefined,
        /* unadjusted_abi_align */ element.align.abi,
        /* repr_c */ element.repr_c,
        /* randomization_seed */ Hash64.wrapping_add(element.randomization_seed, Hash64.new(count)),
      ),
    );
  }

  // rustc: compiler/rustc_abi/src/layout.rs:206 layout_of_scalable_vector_type
  layout_of_scalable_vector_type<F extends AsRefLayoutData>(element: F, count: bigint, number_of_vectors: NumScalableVectors): LayoutCalculatorResult<F> {
    return vector_type_layout({ $: "Scalable", _0: number_of_vectors }, this.cx.data_layout(), element, count);
  }

  // rustc: compiler/rustc_abi/src/layout.rs:225 layout_of_simd_type
  layout_of_simd_type<F extends AsRefLayoutData>(element: F, count: bigint, repr_packed: boolean): LayoutCalculatorResult<F> {
    const kind = repr_packed ? SimdVectorKind.PackedFixed : SimdVectorKind.Fixed;
    return vector_type_layout(kind, this.cx.data_layout(), element, count);
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
  // rustc: compiler/rustc_abi/src/layout.rs:273 layout_of_univariant
  layout_of_univariant<F extends DerefLayoutData>(fields: readonly F[], repr: ReprOptions, kind: StructKind): LayoutCalculatorResult<F> {
    const dl = this.cx.data_layout();
    const layout = this.layout_of_univariant_biased(fields, repr, kind, NicheBias.Start);
    // Enums prefer niches close to the beginning or the end of the variants so that other
    // (smaller) data-carrying variants can be packed into the space after/before the niche.
    // If the default field ordering does not give us a niche at the front then we do a second
    // run and bias niches to the right and then check which one is closer to one of the
    // struct's edges.
    if (layout.$ === "Ok") {
      const layout_ = layout._0;
      // Don't try to calculate an end-biased layout for unsizable structs,
      // otherwise we could end up with different layouts for
      // Foo<Type> and Foo<dyn Trait> which would break unsizing.
      if (kind.$ !== "MaybeUnsized" && layout_.largest_niche !== undefined) {
        const niche = layout_.largest_niche;
        const head_space = niche.offset.bytes();
        const niche_len = Primitive.size(niche.value, dl).bytes();
        const tail_space = layout_.size.bytes() - head_space - niche_len;
        // This may end up doing redundant work if the niche is already in the last
        // field (e.g. a trailing bool) and there is tail padding. But it's non-trivial
        // to get the unpadded size so we try anyway.
        if (fields.length > 1 && head_space !== 0 && tail_space > 0) {
          const alt = this.layout_of_univariant_biased(fields, repr, kind, NicheBias.End);
          // PORT (abi-layout-a): `.expect("alt layout should always work")` formats the error's `F: Debug` payload, which
          // has no generic Debug here; the end-biased run fails only where the start-biased one did, so it is unreachable.
          if (alt.$ === "Err") return unported("rustc_abi::layout::LayoutCalculator::layout_of_univariant: Debug of F in `alt layout should always work`");
          const alt_layout = alt._0;
          const alt_niche = unwrap(alt_layout.largest_niche, "alt layout should have a niche like the regular one");
          const alt_head_space = alt_niche.offset.bytes();
          const alt_niche_len = Primitive.size(alt_niche.value, dl).bytes();
          const alt_tail_space = alt_layout.size.bytes() - alt_head_space - alt_niche_len;

          // debug_assert_eq!(layout.size.bytes(), alt_layout.size.bytes());

          const prefer_alt_layout = alt_head_space > head_space && alt_head_space > tail_space;

          // debug!(
          //     "sz: {}, default_niche_at: {}+{}, default_tail_space: {}, alt_niche_at/head_space: {}+{}, alt_tail: {}, num_fields: {}, better: {}\n\
          //     layout: {}\n\
          //     alt_layout: {}\n",
          //     layout.size.bytes(), head_space, niche_len, tail_space, alt_head_space, alt_niche_len, alt_tail_space,
          //     layout.fields.count(), prefer_alt_layout,
          //     self.format_field_niches(layout, fields),
          //     self.format_field_niches(&alt_layout, fields),
          // );

          if (prefer_alt_layout) {
            return Ok(alt_layout);
          }
        }
      }
    }
    return layout;
  }

  // PORT (layout-contract): `discriminants: impl Iterator<Item = (VariantIdx, u128)>` is an `Iterable`.
  // rustc: compiler/rustc_abi/src/layout.rs:343 layout_of_struct_or_enum
  layout_of_struct_or_enum<F extends DerefLayoutData>(
    repr: ReprOptions,
    variants: readonly (readonly F[])[],
    is_enum: boolean,
    niche_optimizations: NicheOptimizations,
    discr_range_of_repr: (min: RangeFrom<bigint>, max: RangeToInclusive<bigint>) => [Integer, boolean],
    discriminants: Iterable<[VariantIdx, bigint]>,
    always_sized: boolean,
  ): LayoutCalculatorResult<F> {
    // PORT: the lazy `filter_map(..)` iterator pulled twice: `absent` runs only until two present variants are found.
    let present_first: VariantIdx | undefined = undefined;
    let present_second: VariantIdx | undefined = undefined;
    {
      let found = 0;
      for (let i = 0; i < variants.length && found < 2; i++) {
        const v = variants[i];
        if (!repr.inhibit_enum_layout_opt() && absent(v)) continue;
        if (found === 0) present_first = VariantIdx.new(i);
        else present_second = VariantIdx.new(i);
        found++;
      }
    }
    let present_first_: VariantIdx;
    if (present_first !== undefined) {
      present_first_ = present_first;
    } else if (is_enum) {
      // Uninhabited because it has no variants, or only absent ones.
      return Ok(LayoutData.never_type(this.cx));
    } else {
      // If it's a struct, still compute a layout so that we can still compute the
      // field offsets.
      present_first_ = VariantIdx.new(0);
    }

    // take the struct path if it is an actual struct
    if (
      !is_enum ||
      // or for optimizing univariant enums
      (present_second === undefined && !repr.inhibit_enum_layout_opt())
    ) {
      return this.layout_of_struct(repr, variants, present_first_, is_enum, niche_optimizations, always_sized);
    } else {
      // At this point, we have handled all unions and
      // structs. (We have also handled univariant enums
      // that allow representation optimization.)
      assert(is_enum, "assertion failed: is_enum");
      return this.layout_of_enum(repr, variants, discr_range_of_repr, discriminants);
    }
  }

  // rustc: compiler/rustc_abi/src/layout.rs:397 layout_of_union
  layout_of_union<F extends DerefLayoutData>(repr: ReprOptions, variants: readonly (readonly F[])[]): LayoutCalculatorResult<F> {
    const dl = this.cx.data_layout();
    let align = repr.pack !== undefined ? dl.i8_align : dl.aggregate_align;
    let max_repr_align = repr.align;

    // If all the non-ZST fields have the same repr and union repr optimizations aren't
    // disabled, we can use that common repr for the union as a whole.
    // struct AbiMismatch;
    // PORT: `Result<Option<(BackendRepr, Align)>, AbiMismatch>`; the unit struct `AbiMismatch` is `null`.
    let common_non_zst_repr_and_align: Result<[BackendRepr, Align] | undefined, null> = repr.inhibits_union_abi_opt()
      ? // Can't optimize
        Err(null)
      : Ok(undefined);

    let size = Size.ZERO;
    const only_variant_idx = VariantIdx.new(0);
    const only_variant = variants[only_variant_idx];
    for (const field of only_variant) {
      if (field.deref().is_unsized()) {
        return Err({ $: "UnexpectedUnsized", _0: field });
      }

      align = Align_max(align, field.deref().align.abi);
      max_repr_align = Option_Align_max(max_repr_align, field.deref().max_repr_align);
      size = Size_max(size, field.deref().size);

      if (field.deref().is_zst()) {
        // Nothing more to do for ZST fields
        continue;
      }

      if (common_non_zst_repr_and_align.$ === "Ok") {
        const common = common_non_zst_repr_and_align._0;
        // Discard valid range information and allow undef
        const field_abi = BackendRepr.to_union(field.deref().backend_repr);

        if (common !== undefined) {
          const [common_abi, common_align] = common;
          if (!BackendRepr_eq(common_abi, field_abi)) {
            // Different fields have different ABI: disable opt
            common_non_zst_repr_and_align = Err(null);
          } else {
            // Fields with the same non-Aggregate ABI should also
            // have the same alignment
            if (!(common_abi.$ === "Memory")) {
              if (!Align_eq(common_align, field.deref().align.abi)) {
                panic(
                  `assertion \`left == right\` failed: non-Aggregate field with matching ABI but differing alignment\n  left: ${debug_Align(common_align, PLAIN)}\n right: ${debug_Align(field.deref().align.abi, PLAIN)}`,
                );
              }
            }
          }
        } else {
          // First non-ZST field: record its ABI and alignment
          common_non_zst_repr_and_align = Ok([field_abi, field.deref().align.abi]);
        }
      }
    }

    if (repr.pack !== undefined) {
      align = Align_min(align, repr.pack);
    }
    // The unadjusted ABI alignment does not include repr(align), but does include repr(pack).
    // See documentation on `LayoutData::unadjusted_abi_align`.
    const unadjusted_abi_align = align;
    if (repr.align !== undefined) {
      align = Align_max(align, repr.align);
    }
    // `align` must not be modified after this, or `unadjusted_abi_align` could be inaccurate.
    const align_ = align;

    // If all non-ZST fields have the same ABI, we may forward that ABI
    // for the union as a whole, unless otherwise inhibited.
    let backend_repr: BackendRepr;
    if (common_non_zst_repr_and_align.$ === "Err" || common_non_zst_repr_and_align._0 === undefined) {
      backend_repr = { $: "Memory", sized: true };
    } else {
      const [repr_] = common_non_zst_repr_and_align._0;
      if ((repr_.$ === "Scalar" || repr_.$ === "ScalarPair") && !Align_eq(unwrap(BackendRepr.scalar_platform_align(repr_, dl)), align_)) {
        // Mismatched alignment (e.g. union is #[repr(packed)]): disable opt
        backend_repr = { $: "Memory", sized: true };
      } else if (repr_.$ === "SimdVector" && Scalar.default_align(repr_.element, dl).abi.pow2 > align_.pow2) {
        // Vectors require at least element alignment, else disable the opt
        backend_repr = { $: "Memory", sized: true };
      } else {
        // the alignment tests passed and we can use this
        backend_repr = repr_;
      }
    }

    // `let Some(union_field_count) = NonZero::new(only_variant.len()) else { .. }`
    const union_field_count = only_variant.length;
    if (union_field_count === 0) {
      return Err(LayoutCalculatorError.EmptyUnion);
    }

    // We also need to check for a `repr(transparent)` wrapper around `repr(C)`
    const repr_c = repr.c() || (repr.transparent() && only_variant.some((field) => field.deref().repr_c));

    const combined_seed = only_variant.map((v) => v.deref().randomization_seed).reduce((acc, seed) => Hash64.wrapping_add(acc, seed), repr.field_shuffle_seed);

    return Ok(
      new LayoutData(
        /* fields */ { $: "Union", _0: union_field_count },
        /* variants */ { $: "Single", index: only_variant_idx },
        backend_repr,
        /* largest_niche */ undefined,
        /* uninhabited */ false,
        /* align */ AbiAlign.new(align_),
        /* size */ size.align_to(align_),
        max_repr_align,
        unadjusted_abi_align,
        repr_c,
        /* randomization_seed */ combined_seed,
      ),
    );
  }

  /// Calculate the layout for a struct, or a single-variant enum.
  ///
  /// They are the same thing, if you think about it
  /// (Typechecking will reject discriminant-sizing attrs.)
  // rustc: compiler/rustc_abi/src/layout.rs:533 layout_of_struct
  layout_of_struct<F extends DerefLayoutData>(
    repr: ReprOptions,
    variants: readonly (readonly F[])[],
    variant_idx: VariantIdx,
    is_enum: boolean,
    niche_optimizations: NicheOptimizations,
    always_sized: boolean,
  ): LayoutCalculatorResult<F> {
    const dl = this.cx.data_layout();
    const v = variant_idx;
    const kind = is_enum || variants[v].length === 0 || always_sized ? StructKind.AlwaysSized : StructKind.MaybeUnsized;

    const r = this.layout_of_univariant(variants[v], repr, kind);
    if (r.$ === "Err") return r;
    const st = r._0;
    st.variants = { $: "Single", index: v };

    if (niche_optimizations === NicheOptimizations.Disabled) {
      // PORT (abi-layout-a): `&mut Scalar` is a `MutRef<Scalar>`; a `Scalar` of `st.backend_repr` may be shared with a
      // field's (interned, frozen) layout (a Rust copy), so the new valid range goes into a fresh `Scalar` that is
      // written back into a fresh `BackendRepr`.
      const hide_niches = (scalar: MutRef<Scalar>): void => {
        const s = scalar.value;
        switch (s.$) {
          case "Initialized":
            scalar.value = { $: "Initialized", value: s.value, valid_range: WrappingRange.full(Primitive.size(s.value, dl)) };
            break;
          // Already doesn't have any niches
          case "Union":
            break;
        }
      };
      const br = st.backend_repr;
      switch (br.$) {
        case "Scalar": {
          const scalar = { value: br._0 };
          hide_niches(scalar);
          st.backend_repr = { $: "Scalar", _0: scalar.value };
          break;
        }
        case "ScalarPair": {
          const a = { value: br.a };
          const b = { value: br.b };
          hide_niches(a);
          hide_niches(b);
          st.backend_repr = { $: "ScalarPair", a: a.value, b: b.value, b_offset: br.b_offset };
          break;
        }
        case "SimdVector": {
          const element = { value: br.element };
          hide_niches(element);
          st.backend_repr = { $: "SimdVector", element: element.value, count: br.count };
          break;
        }
        case "SimdScalableVector": {
          const element = { value: br.element };
          hide_niches(element);
          st.backend_repr = { $: "SimdScalableVector", element: element.value, count: br.count, number_of_vectors: br.number_of_vectors };
          break;
        }
        case "Memory":
          break;
      }
      st.largest_niche = undefined;
      return Ok(st);
    }

    return Ok(st);
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

    // PORT (abi-layout-b): `Ord` of `Option<Align>` (`None < Some`) and `Ord::max` (`other` on ties) / `Ord::cmp` of
    // `Size`; lib.ts has no helpers for them. `Ord` of `Integer` is lib.ts's `Integer_discriminant`.
    const option_align_max = (a: Align | undefined, b: Align | undefined): Align | undefined => (a === undefined ? b : b === undefined ? a : Align_max(a, b));
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
    if (Integer_discriminant[typeck_ity] < Integer_discriminant[min_ity]) {
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
    if (Integer_discriminant[ity] <= Integer_discriminant[min_ity]) {
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

  // rustc: compiler/rustc_abi/src/layout.rs:1090 layout_of_univariant_biased
  layout_of_univariant_biased<F extends DerefLayoutData>(fields: readonly F[], repr: ReprOptions, kind: StructKind, niche_bias: NicheBias): LayoutCalculatorResult<F> {
    const dl = this.cx.data_layout();
    const pack = repr.pack;
    let align = pack !== undefined ? dl.i8_align : dl.aggregate_align;
    let max_repr_align = repr.align;
    const in_memory_order: FieldIdx[] = fields.map((_, i) => FieldIdx.new(i));
    const optimize_field_order = !repr.inhibit_struct_field_reordering();
    const end = kind.$ === "MaybeUnsized" ? fields.length - 1 : fields.length;
    // PORT (abi-layout-a): `fields.len() - 1` wraps to `usize::MAX` for no fields (no overflow checks), and the slices
    // below then panic as upstream's do.
    if (end < 0) panic(`range end index 18446744073709551615 out of range for slice of length ${fields.length}`);
    // PORT: `optimizing` is `&mut in_memory_order.raw[..end]`: a copy that is sorted and written back.
    const optimizing = in_memory_order.slice(0, end);
    const fields_excluding_tail = fields.slice(0, end);
    // unsizable tail fields are excluded so that we use the same seed for the sized and unsized layouts.
    const field_seed = fields_excluding_tail.reduce((acc, f) => Hash64.wrapping_add(acc, f.deref().randomization_seed), Hash64.ZERO);

    if (optimize_field_order && fields.length > 1) {
      // If `-Z randomize-layout` was enabled for the type definition we can shuffle
      // the field ordering to try and catch some code making assumptions about layouts
      // we don't guarantee.
      // In the future, we might do more than shuffle field order (e.g. introduce extra padding),
      // but never for `repr(Rust)` structs with only zero-sized fields, single-variant
      // `repr(Rust)` enums with only zero-sized fields, or zero-variant `repr(Rust)` enums,
      // which must remain zero-sized as per T-lang decisions in
      // https://github.com/rust-lang/reference/pull/2262 and https://github.com/rust-lang/reference/pull/2293
      // PORT: `cfg!(feature = "randomize")` is true (a default feature of rustc_abi).
      if (repr.can_randomize_type_layout() && true) {
        // #[cfg(feature = "randomize")]
        // `ReprOptions.field_shuffle_seed` is a deterministic seed we can use to randomize field
        // ordering.
        // let mut rng = rand_xoshiro::Xoshiro128StarStar::seed_from_u64(
        //     field_seed.wrapping_add(repr.field_shuffle_seed).as_u64(),
        // );
        // Shuffle the ordering of the fields.
        // optimizing.shuffle(&mut rng);
        return unported("rustc_abi::layout::LayoutCalculator::layout_of_univariant_biased: -Zrandomize-layout shuffle (rand_xoshiro::Xoshiro128StarStar, rand::seq::SliceRandom::shuffle)");
        // Otherwise we just leave things alone and actually optimize the type's fields
      } else {
        // To allow unsizing `&Foo<Type>` -> `&Foo<dyn Trait>`, the layout of the struct must
        // not depend on the layout of the tail.
        const max_field_align = fields_excluding_tail.map((f) => f.deref().align.abi.bytes()).reduce((a, b) => Math.max(a, b), 1);
        let largest_niche_size = 0n;
        for (const f of fields_excluding_tail) {
          const n = f.deref().largest_niche;
          if (n === undefined) continue;
          const available = n.available(dl);
          if (available > largest_niche_size) largest_niche_size = available;
        }

        // Calculates a sort key to group fields by their alignment or possibly some
        // size-derived pseudo-alignment.
        const alignment_group_key = (layout: F): number => {
          // The two branches here return values that cannot be meaningfully compared with
          // each other. However, we know that consistently for all executions of
          // `alignment_group_key`, one or the other branch will be taken, so this is okay.
          if (pack !== undefined) {
            // Return the packed alignment in bytes.
            return Align_min(layout.deref().align.abi, pack).bytes();
          } else {
            // Returns `log2(effective-align)`. The calculation assumes that size is an
            // integer multiple of align, except for ZSTs.
            const align = layout.deref().align.abi.bytes();
            const size = layout.deref().size.bytes();
            const largest_niche = layout.deref().largest_niche;
            const niche_size = largest_niche !== undefined ? largest_niche.available(dl) : 0n;
            // Group [u8; 4] with align-4 or [u8; 6] with align-2 fields.
            const size_as_align0 = u64_trailing_zeros(Math.max(align, size));
            let size_as_align: number;
            if (largest_niche_size > 0n) {
              if (niche_bias === "Start") {
                // Given `A(u8, [u8; 16])` and `B(bool, [u8; 16])` we want to bump the
                // array to the front in the first case (for aligned loads) but keep
                // the bool in front in the second case for its niches.
                size_as_align = Math.min(u64_trailing_zeros(max_field_align), size_as_align0);
              } else if (niche_bias === "End" && niche_size === largest_niche_size) {
                // When moving niches towards the end of the struct then for
                // A((u8, u8, u8, bool), (u8, bool, u8)) we want to keep the first tuple
                // in the align-1 group because its bool can be moved closer to the end.
                size_as_align = u64_trailing_zeros(align);
              } else {
                // NicheBias::End
                size_as_align = size_as_align0;
              }
            } else {
              size_as_align = size_as_align0;
            }
            return size_as_align;
          }
        };

        // PORT: `slice::sort_by_key` is a stable sort, as `Array.prototype.sort`; the key tuples compare
        // lexicographically (`u128` / `u64` parts as `bigint`s).
        switch (kind.$) {
          case "AlwaysSized":
          case "MaybeUnsized": {
            // Currently `LayoutData` only exposes a single niche so sorting is usually
            // sufficient to get one niche into the preferred position. If it ever
            // supported multiple niches then a more advanced pick-and-pack approach could
            // provide better results. But even for the single-niche cache it's not
            // optimal. E.g. for A(u32, (bool, u8), u16) it would be possible to move the
            // bool to the front but it would require packing the tuple together with the
            // u16 to build a 4-byte group so that the u32 can be placed after it without
            // padding. This kind of packing can't be achieved by sorting.
            const key = (x: FieldIdx): [number, bigint, bigint] => {
              const f = fields[x];
              const field_size = f.deref().size.bytes();
              const n = f.deref().largest_niche;
              const niche_size = n !== undefined ? n.available(dl) : 0n;
              let niche_size_key: bigint;
              switch (niche_bias) {
                // large niche first
                case "Start":
                  niche_size_key = U128_MAX ^ niche_size;
                  break;
                // large niche last
                case "End":
                  niche_size_key = niche_size;
                  break;
              }
              let inner_niche_offset_key: bigint;
              switch (niche_bias) {
                case "Start":
                  inner_niche_offset_key = n !== undefined ? n.offset.bytes_u64() : 0n;
                  break;
                case "End":
                  inner_niche_offset_key = n !== undefined ? U64_MAX ^ BigInt(field_size - Primitive.size(n.value, dl).bytes() - n.offset.bytes()) : 0n;
                  break;
              }

              return [
                // Then place largest alignments first.
                // (`cmp::Reverse(alignment_group_key(f))`: compared reversed below)
                alignment_group_key(f),
                // Then prioritize niche placement within alignment group according to
                // `niche_bias_start`.
                niche_size_key,
                // Then among fields with equally-sized niches prefer the ones
                // closer to the start/end of the field.
                inner_niche_offset_key,
              ];
            };
            optimizing.sort((x, y) => {
              const kx = key(x);
              const ky = key(y);
              return cmp_num(ky[0], kx[0]) || cmp_big(kx[1], ky[1]) || cmp_big(kx[2], ky[2]);
            });
            break;
          }

          case "Prefixed": {
            // Sort in ascending alignment so that the layout stays optimal
            // regardless of the prefix.
            // And put the largest niche in an alignment group at the end
            // so it can be used as discriminant in jagged enums
            const key = (x: FieldIdx): [number, bigint] => {
              const f = fields[x];
              const n = f.deref().largest_niche;
              const niche_size = n !== undefined ? n.available(dl) : 0n;
              return [alignment_group_key(f), niche_size];
            };
            optimizing.sort((x, y) => {
              const kx = key(x);
              const ky = key(y);
              return cmp_num(kx[0], ky[0]) || cmp_big(kx[1], ky[1]);
            });
            break;
          }
        }
        for (let k = 0; k < end; k++) in_memory_order[k] = optimizing[k];

        // FIXME(Kixiron): We can always shuffle fields within a given alignment class
        //                 regardless of the status of `-Z randomize-layout`
      }
    }
    // in_memory_order holds field indices by increasing memory offset.
    // That is, if field 5 has offset 0, the first element of in_memory_order is 5.
    // We now write field offsets to the corresponding offset slot;
    // field 5 with offset 0 puts 0 in offsets[5].
    let unsized_field: F | undefined = undefined;
    const offsets: Size[] = fields.map(() => Size.ZERO);
    let offset = Size.ZERO;
    let largest_niche: Niche | undefined = undefined;
    let largest_niche_available = 0n;
    if (kind.$ === "Prefixed") {
      const prefix_size = kind._0;
      const prefix_align = pack !== undefined ? Align_min(kind._1, pack) : kind._1;
      align = Align_max(align, prefix_align);
      offset = prefix_size.align_to(prefix_align);
    }
    for (const i of in_memory_order) {
      const field = fields[i];
      if (unsized_field !== undefined) {
        return Err({ $: "UnexpectedUnsized", _0: unsized_field });
      }

      if (field.deref().is_unsized()) {
        if (kind.$ === "MaybeUnsized") {
          unsized_field = field;
        } else {
          return Err({ $: "UnexpectedUnsized", _0: field });
        }
      }

      // Invariant: offset < dl.obj_size_bound() <= 1<<61
      const field_align = pack !== undefined ? field.deref().align.min(AbiAlign.new(pack)) : field.deref().align;
      offset = offset.align_to(field_align.abi);
      align = Align_max(align, field_align.abi);
      max_repr_align = Option_Align_max(max_repr_align, field.deref().max_repr_align);

      // debug!("univariant offset: {:?} field: {:#?}", offset, field);
      offsets[i] = offset;

      const field_niche = field.deref().largest_niche;
      if (field_niche !== undefined) {
        let niche = field_niche;
        const available = niche.available(dl);
        // Pick up larger niches.
        let prefer_new_niche: boolean;
        switch (niche_bias) {
          case "Start":
            prefer_new_niche = available > largest_niche_available;
            break;
          // if there are several niches of the same size then pick the last one
          case "End":
            prefer_new_niche = available >= largest_niche_available;
            break;
        }
        if (prefer_new_niche) {
          largest_niche_available = available;
          // PORT: `niche.offset += offset` on the `Copy` (immutable) `Niche`: a new `Niche`.
          niche = new Niche(niche.offset.add_assign(offset), niche.value, niche.valid_range);
          largest_niche = niche;
        }
      }

      const next = offset.checked_add(field.deref().size, dl);
      if (next === undefined) return Err(LayoutCalculatorError.SizeOverflow);
      offset = next;
    }

    // The unadjusted ABI alignment does not include repr(align), but does include repr(pack).
    // See documentation on `LayoutData::unadjusted_abi_align`.
    const unadjusted_abi_align_ = align;
    if (repr.align !== undefined) {
      align = Align_max(align, repr.align);
    }
    // `align` must not be modified after this point, or `unadjusted_abi_align` could be inaccurate.
    const align_ = align;

    // debug!("univariant min_size: {:?}", offset);
    const min_size = offset;
    const size = min_size.align_to(align_);
    // FIXME(oli-obk): deduplicate and harden these checks
    if (size.bytes() >= dl.obj_size_bound()) {
      return Err(LayoutCalculatorError.SizeOverflow);
    }
    let layout_of_single_non_zst_field: F | undefined = undefined;
    const sized = unsized_field === undefined;
    let abi: BackendRepr = { $: "Memory", sized };

    const optimize_abi = !repr.inhibit_newtype_abi_optimization();

    // Try to make this a Scalar/ScalarPair.
    if (sized && size.bytes() > 0) {
      // We skip *all* ZST here and later check if we are good in terms of alignment.
      // This lets us handle some cases involving aligned ZST.
      // PORT: the lazy `filter` iterator pulled three times: `is_zst` runs until a third non-ZST field is found.
      const non_zst_fields: [FieldIdx, F][] = [];
      for (let k = 0; k < fields.length && non_zst_fields.length < 3; k++) {
        if (!fields[k].deref().is_zst()) non_zst_fields.push([FieldIdx.new(k), fields[k]]);
      }

      if (non_zst_fields.length === 1) {
        // We have exactly one non-ZST field.
        const [i, field] = non_zst_fields[0];
        layout_of_single_non_zst_field = field;

        // Field fills the struct and it has a scalar or scalar pair ABI.
        if (offsets[i].bytes() === 0 && Align_eq(align_, field.deref().align.abi) && size.raw === field.deref().size.raw) {
          const field_repr = field.deref().backend_repr;
          if ((field_repr.$ === "Scalar" || field_repr.$ === "SimdVector") && optimize_abi) {
            // For plain scalars, or vectors of them, we can't unpack
            // newtypes for `#[repr(C)]`, as that affects C ABIs.
            abi = field_repr;
          } else if (field_repr.$ === "ScalarPair") {
            // But scalar pairs are Rust-specific and get
            // treated as aggregates by C ABIs anyway.
            abi = field_repr;
          }
        }
      } else if (non_zst_fields.length === 2) {
        // Two non-ZST fields, and they're both scalars.
        const [i0, a0] = non_zst_fields[0];
        const [j0, b0] = non_zst_fields[1];
        const a_repr = a0.deref().backend_repr;
        const b_repr = b0.deref().backend_repr;
        if (a_repr.$ === "Scalar" && b_repr.$ === "Scalar") {
          // Order by the memory placement, not source order.
          const [[i, a], [j, b]]: [[FieldIdx, Scalar], [FieldIdx, Scalar]] =
            offsets[i0].raw < offsets[j0].raw
              ? [
                  [i0, a_repr._0],
                  [j0, b_repr._0],
                ]
              : [
                  [j0, b_repr._0],
                  [i0, a_repr._0],
                ];
          const pair = LayoutData.scalar_pair(this.cx, a, b);
          let pair_offsets: Size[];
          switch (pair.fields.$) {
            case "Arbitrary":
              assert_eq(pair.fields.in_memory_order, [FieldIdx.new(0), FieldIdx.new(1)], (v) => `[${v.join(", ")}]`, (x, y) => x.length === y.length && x.every((e, k) => e === y[k]));
              pair_offsets = pair.fields.offsets;
              break;
            case "Primitive":
            case "Array":
            case "Union":
              return panic("encountered a non-arbitrary layout during enum layout");
          }
          if (
            offsets[i].raw === pair_offsets[FieldIdx.new(0)].raw &&
            offsets[j].raw === pair_offsets[FieldIdx.new(1)].raw &&
            Align_eq(align_, pair.align.abi) &&
            size.raw === pair.size.raw
          ) {
            // We can use `ScalarPair` only when it matches our
            // already computed layout (including `#[repr(C)]`).
            abi = pair.backend_repr;
          }
        }
      }
    }
    const uninhabited = fields.some((f) => f.deref().is_uninhabited());

    let unadjusted_abi_align: Align;
    if (repr.transparent()) {
      if (layout_of_single_non_zst_field !== undefined) {
        unadjusted_abi_align = layout_of_single_non_zst_field.deref().unadjusted_abi_align;
      } else {
        // `repr(transparent)` with all ZST fields.
        unadjusted_abi_align = align_;
      }
    } else {
      unadjusted_abi_align = unadjusted_abi_align_;
    }

    // We also need to check for a `repr(transparent)` wrapper around `repr(C)`
    const repr_c = repr.c() || (repr.transparent() && fields.some((field) => field.deref().repr_c));

    const seed = Hash64.wrapping_add(field_seed, repr.field_shuffle_seed);

    return Ok(
      new LayoutData(
        /* fields */ { $: "Arbitrary", offsets, in_memory_order },
        /* variants */ { $: "Single", index: VariantIdx.new(0) },
        /* backend_repr */ abi,
        largest_niche,
        uninhabited,
        /* align */ AbiAlign.new(align_),
        size,
        max_repr_align,
        unadjusted_abi_align,
        repr_c,
        /* randomization_seed */ seed,
      ),
    );
  }

  // rustc: compiler/rustc_abi/src/layout.rs:1440 format_field_niches
  format_field_niches<F extends DerefLayoutData>(layout: LayoutData, fields: readonly F[]): string {
    const dl = this.cx.data_layout();
    let s = "";
    for (const i of FieldsShape.index_by_increasing_offset(layout.fields)) {
      const offset = FieldsShape.offset(layout.fields, i);
      const f = fields[FieldIdx.new(i)];
      s += `[o${offset.bytes()}a${f.deref().align.abi.bytes()}s${f.deref().size.bytes()}`;
      const n = f.deref().largest_niche;
      if (n !== undefined) {
        s += ` n${n.offset.bytes()}b${u128_ilog2(n.available(dl))}s${Primitive.size(n.value, dl).bytes()}`;
      }
      s += "] ";
    }
    return s;
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

// rustc: compiler/rustc_abi/src/layout.rs:1481 vector_type_layout
export function vector_type_layout<F extends AsRefLayoutData>(kind: SimdVectorKind, dl: TargetDataLayout, element: F, count_: bigint): LayoutCalculatorResult<F> {
  const elt = element.as_ref();
  const c = BackendLaneCount.new<F>(count_);
  if (c.$ === "Err") return c;
  const count = c._0;

  if (elt.backend_repr.$ !== "Scalar") {
    return Err({ $: "NonPrimitiveSimdType", _0: element });
  }
  const element_ = elt.backend_repr._0;

  // Compute the size and alignment of the vector
  const size0 = elt.size.checked_mul(BackendLaneCount.as_u64(count), dl);
  if (size0 === undefined) return Err(LayoutCalculatorError.SizeOverflow);
  let repr: BackendRepr;
  let size: Size;
  let align: Align;
  if (kind.$ === "Scalable") {
    const number_of_vectors = kind._0;
    repr = { $: "SimdScalableVector", element: element_, count, number_of_vectors };
    const s = size0.checked_mul(number_of_vectors, dl);
    if (s === undefined) return Err(LayoutCalculatorError.SizeOverflow);
    size = s;
    align = dl.rust_vector_align(size0);
  } else if (kind.$ === "PackedFixed" && !BackendLaneCount.is_power_of_two(count)) {
    // Non-power-of-two vectors have padding up to the next power-of-two.
    // If we're a packed repr, remove the padding while keeping the alignment as close
    // to a vector as possible.
    repr = { $: "Memory", sized: true };
    size = size0;
    align = Align.max_aligned_factor(size0);
  } else {
    repr = { $: "SimdVector", element: element_, count };
    size = size0;
    align = dl.rust_vector_align(size0);
  }
  const size_ = size.align_to(align);

  return Ok(
    new LayoutData(
      /* fields */ { $: "Arbitrary", offsets: [Size.ZERO], in_memory_order: [FieldIdx.new(0)] },
      /* variants */ { $: "Single", index: VariantIdx.new(0) },
      /* backend_repr */ repr,
      /* largest_niche */ elt.largest_niche,
      /* uninhabited */ false,
      /* align */ AbiAlign.new(align),
      /* size */ size_,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ elt.align.abi,
      /* repr_c */ false,
      /* randomization_seed */ Hash64.wrapping_add(elt.randomization_seed, Hash64.new(BackendLaneCount.as_u64(count))),
    ),
  );
}

// PORT (abi-layout-a): local helpers for the integer ops of the fns above.
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
/** `u64::trailing_zeros` of a value below 2^53 (64 for 0). */
function u64_trailing_zeros(x: number): number {
  if (x === 0) return 64;
  let n = 0;
  while (x % 2 === 0) {
    x /= 2;
    n++;
  }
  return n;
}
/** `u128::ilog2` (panics on 0 as core's `int_log10::panic_for_nonpositive_argument`). */
function u128_ilog2(x: bigint): number {
  if (x <= 0n) panic("argument of integer logarithm must be positive");
  return x.toString(2).length - 1;
}
function cmp_num(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmp_big(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** `Ord::max` of `Option<Align>` (`None < Some`; ties return the second). */
function Option_Align_max(a: Align | undefined, b: Align | undefined): Align | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Align_max(a, b);
}
/** `cmp::max` of `Size` (ties return the second). */
function Size_max(a: Size, b: Size): Size {
  return b.raw >= a.raw ? b : a;
}
