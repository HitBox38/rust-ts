// Port of compiler/rustc_abi/src/layout/ty.rs (lane layout-contract: `Layout`, `TyAndLayout`, `TyAbiInterface`, their
// Debug / Deref glue; lane abi-layout-b: the rest of `impl TyAndLayout`; conventions in ../layout.ts's header).
//
// PORT (layout-contract):
// - `Layout(Interned<LayoutData>)` is the frozen class `Layout extends Interned` (PORTING §5 "Hash-consed values"), made
//   only by `TyCtxt::mk_layout` (rustc_middle ty/context.ts); its `LayoutData` is the field `internee` (`layout.0.0`),
//   deep-frozen on construction. `impl Deref for Layout` is `deref_()` (`Interned` owns the name `deref`).
// - `TyAndLayout<'a, Ty>` is a class over `Ty`; `impl Deref for TyAndLayout` (to `&LayoutData`, skipping `Layout`) is
//   `deref()` plus a read-only forwarder per `LayoutData` field and method (`tl.size`, `tl.is_zst()`), written out in
//   the class body (a `Deref` realised as a field, PORTING §8; `register_deref` cannot express the two hops).
//   `TyAndLayout::is_scalable_vector` (the `TyAbiInterface` one) shadows `LayoutData::is_scalable_vector`, as in Rust.
// - `Ty: TyAbiInterface<'a, C>` bounds: rustc has exactly one impl, rustc_middle's `impl TyAbiInterface for Ty<'tcx>`
//   (ty/layout.rs:800), which registers itself at load (`register_ty_abi_interface`, the `IR_PRINT` precedent of
//   rustc_type_ir/ir_print.ts); `Ty::ty_and_layout_field(self, cx, i)` is `ty_abi_interface<Ty, C>().ty_and_layout_field(
//   this, cx, i)`. The generic `C` stays a type parameter.
// - `Ty: fmt::Display` (Debug of `TyAndLayout`) is a `display_Ty` parameter of `debug_TyAndLayout`.
// Init order: lib.ts re-exports this module, so its top-level code must not touch lib.ts's values.
import { INTERNED, Interned } from "../../rustc_data_structures/intern.ts";
import { RangeSet, type RangeSetOps } from "../../rustc_data_structures/range_set.ts";
import { type Debug, debug_struct, type Fmt, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Heterogeneous, HomogeneousAggregate, Reg, RegKind } from "../callconv.ts";
import {
  type AbiAlign,
  type Align,
  type BackendLaneCount,
  BackendRepr,
  debug_LayoutData,
  debug_Size,
  FieldsShape,
  type Float,
  type HasDataLayout,
  type LayoutData,
  type Niche,
  type Numeric,
  type PointeeInfo,
  Scalar,
  Size,
  type Variants,
} from "../lib.ts";
import type { Hash64 } from "../../rustc_hashes/lib.ts";
import { FieldIdx, type VariantIdx } from "../layout.ts";

// Explicitly import `Float` to avoid ambiguity with `Primitive::Float`.

/** `core::ops::Range<Idx>` (PORT (layout-contract): local shape, as rustc_middle ty/decls.ts `Range`). */
export interface Range<Idx> {
  readonly start: Idx;
  readonly end: Idx;
}
/** PORT (abi-layout-b): the `T: Copy + Ord + Default + Add + Sub` table of `RangeSet<Size>` (rustc_data_structures
 * range_set.ts module comment); `Size`'s derived `Ord` compares the byte count. */
const SIZE_RANGE_SET_OPS: RangeSetOps<Size> = {
  default_: () => Size.ZERO,
  cmp: (a, b) => (a.bytes() < b.bytes() ? -1 : a.bytes() > b.bytes() ? 1 : 0),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
};

/** PORT (abi-layout-b): a `u64` element count (`FieldsShape::Array.count`, a `bigint`) used as a `Size` multiplier
 * (`Size` is a `number`, root decision): beyond 2^53 the `number` would be wrong, so that path is unported. */
function array_count_as_number(count: bigint, site: string): number {
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) return unported(`Size beyond 2^53 (${site})`);
  return Number(count);
}

/** PORT (layout-contract): freezes an interned `LayoutData` and every plain object / array inside it (module comment). */
function deep_freeze<T>(v: T): T {
  if (typeof v !== "object" || v === null || Object.isFrozen(v)) return v;
  if ((v as { readonly [INTERNED]?: true })[INTERNED] === true) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deep_freeze((v as Record<string, unknown>)[k]);
  return v;
}

// #[derive(Copy, Clone, PartialEq, Eq, Hash, StableHash)]
// #[rustc_pass_by_value]
export class Layout extends Interned {
  /** PORT: the interned `LayoutData` (`self.0.0`; module comment). */
  readonly internee: LayoutData;

  /** PORT: only `tcx.mk_layout` constructs (D2); the `LayoutData` is deep-frozen with it. */
  constructor(internee: LayoutData) {
    super();
    this.internee = deep_freeze(internee);
    Object.freeze(this);
  }

  // impl Deref for Layout (type Target = &'a LayoutData)
  // rustc: compiler/rustc_abi/src/layout/ty.rs:29 deref
  deref_(): LayoutData {
    return this.internee;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:35 fields
  fields(): FieldsShape {
    return this.internee.fields;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:39 variants
  variants(): Variants {
    return this.internee.variants;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:43 backend_repr
  backend_repr(): BackendRepr {
    return this.internee.backend_repr;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:47 largest_niche
  largest_niche(): Niche | undefined {
    return this.internee.largest_niche;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:51 align
  align(): AbiAlign {
    return this.internee.align;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:55 size
  size(): Size {
    return this.internee.size;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:59 max_repr_align
  max_repr_align(): Align | undefined {
    return this.internee.max_repr_align;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:63 unadjusted_abi_align
  unadjusted_abi_align(): Align {
    return this.internee.unadjusted_abi_align;
  }
}
// impl<'a> fmt::Debug for Layout<'a>
// rustc: compiler/rustc_abi/src/layout/ty.rs:21 fmt
export const debug_Layout: Debug<Layout> = (self, f) => {
  // See comment on `<LayoutData as Debug>::fmt` above.
  return debug_LayoutData(self.internee, f);
};

/// Trait that needs to be implemented by the higher-level type representation
/// (e.g. `rustc_middle::ty::Ty`), to provide `rustc_target::abi` functionality.
// pub trait TyAbiInterface<'a, C>: Sized + std::fmt::Debug + std::fmt::Display
// PORT (layout-contract): the impl table of the one implementor (module comment); `this` is `this_`.
export interface TyAbiInterface<Ty, C> {
  // rustc: compiler/rustc_abi/src/layout/ty.rs:107 ty_and_layout_for_variant
  ty_and_layout_for_variant(this_: TyAndLayout<Ty>, cx: C, variant_index: VariantIdx): TyAndLayout<Ty>;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:112 ty_and_layout_field
  ty_and_layout_field(this_: TyAndLayout<Ty>, cx: C, i: number): TyAndLayout<Ty>;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:113 ty_and_layout_pointee_info_at
  ty_and_layout_pointee_info_at(this_: TyAndLayout<Ty>, cx: C, offset: Size): PointeeInfo | undefined;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:118 is_adt
  is_adt(this_: TyAndLayout<Ty>): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:119 is_enum
  is_enum(this_: TyAndLayout<Ty>): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:120 is_never
  is_never(this_: TyAndLayout<Ty>): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:121 is_tuple
  is_tuple(this_: TyAndLayout<Ty>): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:122 is_unit
  is_unit(this_: TyAndLayout<Ty>): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:123 is_transparent
  is_transparent(this_: TyAndLayout<Ty>): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:124 is_complex_number_lang_item
  is_complex_number_lang_item(this_: TyAndLayout<Ty>, cx: C): boolean;
  // rustc: compiler/rustc_abi/src/layout/ty.rs:125 is_scalable_vector
  is_scalable_vector(this_: TyAndLayout<Ty>): boolean;
  /// See [`TyAndLayout::pass_indirectly_in_non_rustic_abis`] for details.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:127 is_pass_indirectly_in_non_rustic_abis_flag_set
  is_pass_indirectly_in_non_rustic_abis_flag_set(this_: TyAndLayout<Ty>): boolean;
}

// PORT (layout-contract): the registered `impl TyAbiInterface for Ty` (module comment).
let TY_ABI_INTERFACE: TyAbiInterface<unknown, unknown> | undefined = undefined;

/** Registers rustc_middle's `impl TyAbiInterface for Ty<'tcx>` (called once by rustc_middle ty/layout.ts at load). */
export function register_ty_abi_interface<Ty, C>(impl: TyAbiInterface<Ty, C>): void {
  TY_ABI_INTERFACE = impl as unknown as TyAbiInterface<unknown, unknown>;
}

/** The `Ty: TyAbiInterface<'a, C>` impl (module comment). */
export function ty_abi_interface<Ty, C>(): TyAbiInterface<Ty, C> {
  if (TY_ABI_INTERFACE === undefined) return unported("rustc_middle::ty::layout: impl TyAbiInterface for Ty (rustc_middle not loaded)");
  return TY_ABI_INTERFACE as unknown as TyAbiInterface<Ty, C>;
}

/// The layout of a type, alongside the type itself.
/// Provides various type traversal APIs (e.g., recursing into fields).
///
/// Note that the layout is NOT guaranteed to always be identical
/// to that obtained from `layout_of(ty)`, as we need to produce
/// layouts for which Rust types do not exist, such as enum variants
/// or synthetic fields of enums (i.e., discriminants) and wide pointers.
// #[derive(Copy, Clone, PartialEq, Eq, Hash, StableHash)]
export class TyAndLayout<Ty> {
  constructor(
    readonly ty: Ty,
    readonly layout: Layout,
  ) {}

  // ---- impl Deref for TyAndLayout (type Target = &'a LayoutData) ----
  // rustc: compiler/rustc_abi/src/layout/ty.rs:93 deref
  deref(): LayoutData {
    return this.layout.internee;
  }

  // PORT (layout-contract): the auto-deref forwarders of `deref` (module comment).
  get fields(): FieldsShape {
    return this.layout.internee.fields;
  }
  get variants(): Variants {
    return this.layout.internee.variants;
  }
  get backend_repr(): BackendRepr {
    return this.layout.internee.backend_repr;
  }
  get largest_niche(): Niche | undefined {
    return this.layout.internee.largest_niche;
  }
  get uninhabited(): boolean {
    return this.layout.internee.uninhabited;
  }
  get align(): AbiAlign {
    return this.layout.internee.align;
  }
  get size(): Size {
    return this.layout.internee.size;
  }
  get max_repr_align(): Align | undefined {
    return this.layout.internee.max_repr_align;
  }
  get unadjusted_abi_align(): Align {
    return this.layout.internee.unadjusted_abi_align;
  }
  get repr_c(): boolean {
    return this.layout.internee.repr_c;
  }
  get randomization_seed(): Hash64 {
    return this.layout.internee.randomization_seed;
  }
  is_aggregate(): boolean {
    return this.layout.internee.is_aggregate();
  }
  is_uninhabited(): boolean {
    return this.layout.internee.is_uninhabited();
  }
  is_variant_uninhabited(variant: VariantIdx): boolean {
    return this.layout.internee.is_variant_uninhabited(variant);
  }
  is_repr_c(): boolean {
    return this.layout.internee.is_repr_c();
  }
  is_unsized(): boolean {
    return this.layout.internee.is_unsized();
  }
  is_sized(): boolean {
    return this.layout.internee.is_sized();
  }
  is_1zst(): boolean {
    return this.layout.internee.is_1zst();
  }
  scalable_vector_element_count(): BackendLaneCount | undefined {
    return this.layout.internee.scalable_vector_element_count();
  }
  is_zst(): boolean {
    return this.layout.internee.is_zst();
  }
  is_ssa_standalone(): boolean {
    return this.layout.internee.is_ssa_standalone();
  }
  eq_abi(other: LayoutData): boolean {
    return this.layout.internee.eq_abi(other);
  }

  // impl AsRef<LayoutData> for TyAndLayout
  // rustc: compiler/rustc_abi/src/layout/ty.rs:99 as_ref
  as_ref(): LayoutData {
    return this.layout.internee;
  }

  // ---- impl TyAndLayout (ty.rs:130) ----

  /// Synthetize a layout representing the variant-specific fields of an enum-like layout.
  ///
  /// Note that the resulting layout *does not* fully describes `self.ty` at that specific
  /// variant: prefix fields (e.g. in coroutines) and tag information are lost.
  ///
  /// If you don't need type information about the variant's fields, prefer using
  /// `self.layout.variants` directly.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:138 for_variant
  for_variant<C>(cx: C, variant_index: VariantIdx): TyAndLayout<Ty> {
    return ty_abi_interface<Ty, C>().ty_and_layout_for_variant(this, cx, variant_index);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:145 field
  field<C>(cx: C, i: number): TyAndLayout<Ty> {
    return ty_abi_interface<Ty, C>().ty_and_layout_field(this, cx, i);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:152 pointee_info_at
  pointee_info_at<C>(cx: C, offset: Size): PointeeInfo | undefined {
    return ty_abi_interface<Ty, C>().ty_and_layout_pointee_info_at(this, cx, offset);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:159 is_single_vector_element
  is_single_vector_element<C extends HasDataLayout>(cx: C, expected_size: Size): boolean {
    switch (this.backend_repr.$) {
      case "SimdVector":
        return this.size.bytes() === expected_size.bytes();
      case "Memory": {
        if (FieldsShape.count(this.fields) === 1 && FieldsShape.offset(this.fields, 0).bytes() === 0) {
          return this.field(cx, 0).is_single_vector_element(cx, expected_size);
        } else {
          return false;
        }
      }
      default:
        return false;
    }
  }

  // PORT (layout-contract): `is_adt::<C>(self)` .. `is_scalable_vector::<C>(self)` take no `cx`; the table does not
  // depend on `C` (module comment).
  // rustc: compiler/rustc_abi/src/layout/ty.rs:177 is_adt
  is_adt(): boolean {
    return ty_abi_interface<Ty, unknown>().is_adt(this);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:184 is_enum
  is_enum(): boolean {
    return ty_abi_interface<Ty, unknown>().is_enum(this);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:191 is_never
  is_never(): boolean {
    return ty_abi_interface<Ty, unknown>().is_never(this);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:198 is_tuple
  is_tuple(): boolean {
    return ty_abi_interface<Ty, unknown>().is_tuple(this);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:205 is_unit
  is_unit(): boolean {
    return ty_abi_interface<Ty, unknown>().is_unit(this);
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:212 is_transparent
  is_transparent(): boolean {
    return ty_abi_interface<Ty, unknown>().is_transparent(this);
  }

  /// Returns `true` if this type needs to match the ABI of the C `_Complex` type. See
  /// [`TyAndLayout::complex_number`] for details.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:221 is_complex_number
  is_complex_number<C>(cx: C): boolean {
    return this.complex_number(cx) !== undefined;
  }

  // rustc: compiler/rustc_abi/src/layout/ty.rs:228 is_scalable_vector
  is_scalable_vector(): boolean {
    return ty_abi_interface<Ty, unknown>().is_scalable_vector(this);
  }

  /// If this method returns `true`, then this type should always have a `PassMode` of
  /// `Indirect { mode: IndirectMode::Pointer, .. }` when being used as the argument type of a
  /// function with a non-Rustic ABI (this is true for structs annotated with the
  /// `#[rustc_pass_indirectly_in_non_rustic_abis]` attribute).
  ///
  /// This is used to replicate some of the behaviour of C array-to-pointer decay; however unlike
  /// C any changes the caller makes to the passed value will not be reflected in the callee, so
  /// the attribute is only useful for types where observing the value in the caller after the
  /// function call isn't allowed (a.k.a. `va_list`).
  ///
  /// This function handles transparent types automatically.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:246 pass_indirectly_in_non_rustic_abis
  pass_indirectly_in_non_rustic_abis<C>(cx: C): boolean {
    // FIXME: Peeling the wrappers above would not work correctly if we are a 1-ZST. So we make
    // `#[rustc_pass_indirectly_in_non_rustic_abis]` a NOP on 1-ZST. In the future,
    // `non_1zst_field` should become `non_trivial_abi_field` and
    // `#[rustc_pass_indirectly_in_non_rustic_abis]` should make a type have non-trivial ABI.
    if (this.is_1zst()) {
      return false;
    }

    const base = this.peel_transparent_wrappers_from_non_1zst(cx);
    return ty_abi_interface<Ty, C>().is_pass_indirectly_in_non_rustic_abis_flag_set(base);
  }

  /// Recursively peel away transparent wrappers, returning the inner value.
  /// Will not peel anything if `self` is a 1-ZST! Callers need to either check
  /// that the result is not a 1-ZST, or have separate logic for that.
  ///
  /// The return value is not `repr(transparent)` and/or does
  /// not have a non-1zst field.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:268 peel_transparent_wrappers_from_non_1zst
  peel_transparent_wrappers_from_non_1zst<C>(cx: C): TyAndLayout<Ty> {
    // PORT: `mut self` is the local `self_`.
    let self_: TyAndLayout<Ty> = this;
    for (;;) {
      if (!self_.is_transparent()) break;
      const found = self_.non_1zst_field(cx);
      if (found === undefined) break;
      const [, field] = found;
      self_ = field;
    }

    return self_;
  }

  /// Finds the one field that is not a 1-ZST.
  /// Returns `None` if there are multiple non-1-ZST fields or only 1-ZST-fields.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:283 non_1zst_field
  non_1zst_field<C>(cx: C): [FieldIdx, TyAndLayout<Ty>] | undefined {
    let found: [FieldIdx, TyAndLayout<Ty>] | undefined = undefined;
    for (let field_idx = 0; field_idx < FieldsShape.count(this.fields); field_idx++) {
      const field = this.field(cx, field_idx);
      if (field.is_1zst()) {
        continue;
      }
      if (found !== undefined) {
        // More than one non-1-ZST field.
        return undefined;
      }
      found = [FieldIdx.from_usize(field_idx), field];
    }
    return found;
  }

  /// Finds the one field that is not a ZST.
  /// Returns `None` if there are multiple non-ZST fields or only ZST-fields.
  ///
  /// Note that this function checks for ZSTs, not just 1-ZSTs.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:306 non_zst_field_ignore_alignment
  non_zst_field_ignore_alignment<C>(cx: C): [FieldIdx, TyAndLayout<Ty>] | undefined {
    let found: [FieldIdx, TyAndLayout<Ty>] | undefined = undefined;
    for (let field_idx = 0; field_idx < FieldsShape.count(this.fields); field_idx++) {
      const field = this.field(cx, field_idx);
      if (field.is_zst()) {
        continue;
      }
      if (found !== undefined) {
        // More than one non-ZST field.
        return undefined;
      }
      found = [FieldIdx.from_usize(field_idx), field];
    }
    return found;
  }

  /// If this type should match the ABI of the C `_Complex` type, returns the primitive that is
  /// used for its components.
  ///
  /// This function only returns `Some(T)` for `core::num::Complex<T>` where `T` is
  /// either a float or an integer. `repr(transparent)` wrapper types are automatically handled.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:330 complex_number
  complex_number<C>(cx: C): Numeric | undefined {
    // We're checking for scalar repr below which excludes 1-ZST.
    const complex = this.peel_transparent_wrappers_from_non_1zst(cx);
    if (!ty_abi_interface<Ty, C>().is_complex_number_lang_item(complex, cx)) {
      return undefined;
    }

    const component = complex.field(cx, 0).peel_transparent_wrappers_from_non_1zst(cx);

    const component_repr = component.backend_repr;
    if (component_repr.$ !== "Scalar") {
      return undefined;
    }
    const scalar = component_repr._0;

    // Only Complex<{ float }> and Complex<{ integer }> have special layout.
    //
    // Explicitly spell out all the float types so that any new ones have to be added to
    // one of the match branches.
    const primitive = Scalar.primitive(scalar);
    switch (primitive.$) {
      case "Int":
        return { $: "Int", _0: primitive._0, _1: primitive._1 };
      case "Float": {
        const float = primitive._0;
        switch (float) {
          case "F16":
          case "F32":
          case "F64":
          case "F128":
          case "PpcF128":
            return { $: "Float", _0: float };
          case "F16B":
            return undefined;
        }
        break;
      }
      case "Pointer":
        return undefined;
    }
  }

  /// Returns `Some` if this type has the ABI of the C `_Complex` type with float components.
  /// See [`TyAndLayout::complex_number`] for details.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:362 complex_float
  complex_float<C>(cx: C): Float | undefined {
    const n = this.complex_number(cx);
    if (n !== undefined && n.$ === "Float") return n._0;
    return undefined;
  }

  /// Whether this type/layout has any padding that is dependent on a variant, i.e. has bytes that
  /// are padding for some, but not all, valid values of this type.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:374 has_variant_dependent_padding
  has_variant_dependent_padding<C>(cx: C): boolean {
    switch (this.variants.$) {
      case "Multiple":
        return true;
      case "Empty":
        return false;
      case "Single": {
        const fields = this.fields;
        switch (fields.$) {
          case "Primitive":
          case "Union":
            return false;
          case "Array":
            return fields.count > 0n && this.field(cx, 0).has_variant_dependent_padding(cx);
          case "Arbitrary":
            return fields.offsets.some((_, i) => this.field(cx, i).has_variant_dependent_padding(cx));
        }
      }
    }
  }

  /// The ranges of bytes that are always ignored by the representation relation of this type.
  ///
  /// In other words, for any sequence of bytes, if we reset the these padding bytes to uninit,
  /// then these two sequences of bytes represent the same value (or they are both invalid).
  /// This is the "guaranteed" padding. There may be more bytes that are padding for some
  /// but not all variants of this type; those are not included.
  /// (E.g. `Option<i8>` has no guaranteed padding so the empty range set is returned, but its `None` value still has padding).
  // rustc: compiler/rustc_abi/src/layout/ty.rs:400 variant_independent_padding_ranges
  variant_independent_padding_ranges<C>(cx: C): Range<Size>[] {
    const data = RangeSet.new(SIZE_RANGE_SET_OPS);
    this.add_data_ranges(cx, Size.ZERO, data);

    // Find gaps between the data ranges.
    const uninit_ranges: Range<Size>[] = [];
    let covered_until = Size.ZERO;
    for (const [offset, size] of data._0) {
      if (offset.bytes() > covered_until.bytes()) {
        uninit_ranges.push({ start: covered_until, end: offset });
      }
      // `Ord::max` returns `other` on ties
      const end = offset.add(size);
      covered_until = end.bytes() >= covered_until.bytes() ? end : covered_until;
    }

    // Add trailing padding.
    if (this.size.bytes() > covered_until.bytes()) {
      uninit_ranges.push({ start: covered_until, end: this.size });
    }

    return uninit_ranges;
  }

  /// The ranges of bytes that are ignored by the representation relation of this variant.
  ///
  /// The result does not include variant-independent padding.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:428 variant_dependent_padding_ranges
  variant_dependent_padding_ranges<C>(cx: C, variant_index: VariantIdx): Range<Size>[] {
    if (this.variants.$ !== "Multiple") {
      return [];
    }

    // Bytes that are data in some variant.
    const any = RangeSet.new(SIZE_RANGE_SET_OPS);
    this.add_data_ranges(cx, Size.ZERO, any);

    // Bytes that are data in this variant.
    const this_ = RangeSet.new(SIZE_RANGE_SET_OPS);

    // The variants do not contain e.g. the discriminant or coroutine upvars.
    const fields = this.fields;
    if (fields.$ !== "Arbitrary") {
      return unreachable("internal error: entered unreachable code: a multi-variant layout should have `Arbitrary` fields");
    }
    const { offsets } = fields;

    // So add them explicitly.
    for (let field = 0; field < offsets.length; field++) {
      const offset = offsets[field]!;
      const field_ = this.field(cx, field);
      field_.add_data_ranges(cx, offset, this_);
    }

    this.for_variant(cx, variant_index).add_data_ranges(cx, Size.ZERO, this_);

    // Padding specific to this variant: data in some variant, but not in this one.
    return any.difference(this_)._0.map(([offset, size]) => ({ start: offset, end: offset.add(size) }));
  }

  /// Extend `out` with all ranges of bytes that *may* carry relevant data for values of this type.
  /// For enums and unions there are offsets that are initialized for some
  /// variants but not for others; those offset *will* get added to `out`.
  // rustc: compiler/rustc_abi/src/layout/ty.rs:467 add_data_ranges
  add_data_ranges<C>(cx: C, base_offset: Size, out: RangeSet<Size>): void {
    if (this.is_zst()) {
      return;
    }

    // Visit the fields of this value. For enum values the fields include the discriminant.
    const fields = this.fields;
    switch (fields.$) {
      case "Primitive": {
        out.add_range(base_offset, this.size);
        break;
      }
      case "Union": {
        const field_count = fields._0;
        for (let field = 0; field < field_count; field++) {
          const field_ = this.field(cx, field);
          field_.add_data_ranges(cx, base_offset, out);
        }
        break;
      }
      case "Array": {
        const { stride, count } = fields;
        const elem = this.field(cx, 0);

        // For scalars we know there is no padding between the elements,
        // so the entire array is a single big data range.
        if (BackendRepr.is_scalar(elem.backend_repr)) {
          out.add_range(base_offset, elem.size.mul(array_count_as_number(count, "TyAndLayout::add_data_ranges `elem.size * count`")));
        } else {
          // FIXME: this is really inefficient for large arrays.
          const n = array_count_as_number(count, "TyAndLayout::add_data_ranges `0..count`");
          for (let idx = 0; idx < n; idx++) {
            elem.add_data_ranges(cx, base_offset.add(Size.u64_mul(idx, stride)), out);
          }
        }
        break;
      }
      case "Arbitrary": {
        const { offsets } = fields;
        for (let field = 0; field < offsets.length; field++) {
          const offset = offsets[field]!;
          const field_ = this.field(cx, field);
          field_.add_data_ranges(cx, base_offset.add(offset), out);
        }
        break;
      }
    }

    // Visit the fields of each variant.
    const variants = this.variants;
    switch (variants.$) {
      case "Empty":
      case "Single":
        /* done */
        break;
      case "Multiple": {
        for (let variant = 0; variant < variants.variants.length; variant++) {
          const variant_ = this.for_variant(cx, variant as VariantIdx);
          variant_.add_data_ranges(cx, base_offset, out);
        }
        break;
      }
    }
  }

  // ---- callconv.rs: impl TyAndLayout (PORTING §8: in the class body) ----

  /// Returns `Homogeneous` if this layout is an aggregate containing fields of
  /// only a single type (e.g., `(u32, u32)`). Such aggregates are often
  /// special-cased in ABIs.
  ///
  /// Note: We generally ignore 1-ZST fields when computing this value (see #56877).
  ///
  /// Note: The fields of a union are merged as if it were a struct, so the result does not
  /// distinguish the two. `powerpc64::is_or_contains_union` in `rustc_target` walks the layout
  /// again to do that, mirroring the array handling here.
  ///
  /// This is public so that it can be used in unit tests, but
  /// should generally only be relevant to the ABI details of
  /// specific targets.
  // #[tracing::instrument(skip(cx), level = "debug")]
  // rustc: compiler/rustc_abi/src/callconv.rs:69 homogeneous_aggregate
  homogeneous_aggregate<C>(cx: C): Result<HomogeneousAggregate, Heterogeneous> {
    const backend_repr = this.backend_repr;
    switch (backend_repr.$) {
      // The primitive for this algorithm.
      case "Scalar": {
        const scalar = backend_repr._0;
        const kind = RegKind.from_primitive(Scalar.primitive(scalar));
        return Ok({ $: "Homogeneous", _0: new Reg(kind, this.size) });
      }

      case "SimdVector": {
        const element = backend_repr.element;
        assert(!this.is_zst(), "assertion failed: !self.is_zst()");

        return Ok({
          $: "Homogeneous",
          _0: new Reg({ $: "Vector", hint_vector_elem: Scalar.primitive(element) }, this.size),
        });
      }

      case "SimdScalableVector": {
        return unreachable("internal error: entered unreachable code: `homogeneous_aggregate` should not be called for scalable vectors");
      }

      case "ScalarPair":
      case "Memory": {
        if (backend_repr.$ === "Memory" && !backend_repr.sized) {
          // BackendRepr::Memory { sized: false } => Err(Heterogeneous),
          return Err(Heterogeneous);
        }
        // Helper for computing `homogeneous_aggregate`, allowing a custom
        // starting offset (used below for handling variants).
        const from_fields_at = (layout: TyAndLayout<Ty>, start: Size): Result<[HomogeneousAggregate, Size], Heterogeneous> => {
          let is_union: boolean;
          const fields = layout.fields;
          switch (fields.$) {
            case "Primitive": {
              return unreachable("internal error: entered unreachable code: aggregates can't have `FieldsShape::Primitive`");
            }
            case "Array": {
              const count = fields.count;
              assert_eq(start, Size.ZERO, (v) => debug_Size(v, PLAIN), (a, b) => a.raw === b.raw);

              let result: HomogeneousAggregate;
              if (count > 0n) {
                const r = layout.field(cx, 0).homogeneous_aggregate(cx);
                if (r.$ === "Err") return r;
                result = r._0;
              } else {
                result = HomogeneousAggregate.NoData;
              }
              return Ok([result, layout.size]);
            }
            case "Union":
              is_union = true;
              break;
            case "Arbitrary":
              is_union = false;
              break;
          }

          let result: HomogeneousAggregate = HomogeneousAggregate.NoData;
          let total = start;

          for (let i = 0; i < FieldsShape.count(layout.fields); i++) {
            const field = layout.field(cx, i);
            if (field.is_1zst()) {
              // No data here and no impact on layout, can be ignored.
              // (We might be able to also ignore all aligned ZST but that's less clear.)
              continue;
            }

            if (!is_union && total.raw !== FieldsShape.offset(layout.fields, i).raw) {
              // This field isn't just after the previous one we considered, abort.
              return Err(Heterogeneous);
            }

            const fr = field.homogeneous_aggregate(cx);
            if (fr.$ === "Err") return fr;
            const mr = HomogeneousAggregate.merge(result, fr._0);
            if (mr.$ === "Err") return mr;
            result = mr._0;

            // Keep track of the offset (without padding).
            const size = field.size;
            if (is_union) {
              total = size_max(total, size);
            } else {
              total = total.add_assign(size);
            }
          }

          return Ok([result, total]);
        };

        const r0 = from_fields_at(this, Size.ZERO);
        if (r0.$ === "Err") return r0;
        let [result, total] = r0._0;

        const variants = this.variants;
        switch (variants.$) {
          case "Single":
          case "Empty":
            break;
          case "Multiple": {
            // Treat enum variants like union members.
            // HACK(eddyb) pretend the `enum` field (discriminant)
            // is at the start of every variant (otherwise the gap
            // at the start of all variants would disqualify them).
            //
            // NB: for all tagged `enum`s (which include all non-C-like
            // `enum`s with defined FFI representation), this will
            // match the homogeneous computation on the equivalent
            // `struct { tag; union { variant1; ... } }` and/or
            // `union { struct { tag; variant1; } ... }`
            // (the offsets of variant fields should be identical
            // between the two for either to be a homogeneous aggregate).
            const variant_start = total;
            for (let variant_idx = 0 as VariantIdx; variant_idx < variants.variants.length; variant_idx++) {
              const vr = from_fields_at(this.for_variant(cx, variant_idx), variant_start);
              if (vr.$ === "Err") return vr;
              const [variant_result, variant_total] = vr._0;

              const mr = HomogeneousAggregate.merge(result, variant_result);
              if (mr.$ === "Err") return mr;
              result = mr._0;
              total = size_max(total, variant_total);
            }
            break;
          }
        }

        // There needs to be no padding.
        if (total.raw !== this.size.raw) {
          return Err(Heterogeneous);
        } else {
          switch (result.$) {
            case "Homogeneous":
              if (total.raw === Size.ZERO.raw) {
                return panic(`assertion \`left != right\` failed\n  left: ${debug_Size(total, PLAIN)}\n right: ${debug_Size(Size.ZERO, PLAIN)}`);
              }
              break;
            case "NoData":
              assert_eq(total, Size.ZERO, (v) => debug_Size(v, PLAIN), (a, b) => a.raw === b.raw);
              break;
          }
          return Ok(result);
        }
      }
    }
  }
}

/** derive(PartialEq): `ty` and `layout` are interned (identity). */
export function TyAndLayout_eq<Ty>(a: TyAndLayout<Ty>, b: TyAndLayout<Ty>): boolean {
  return a.ty === b.ty && a.layout === b.layout;
}

/** PORT (abi-lib): `Ord::max` of two `Size`s (callconv.rs `homogeneous_aggregate`); the second on a tie, as `Ord::max`. */
function size_max(a: Size, b: Size): Size {
  return a.raw > b.raw ? a : b;
}

// impl<'a, Ty: fmt::Display> fmt::Debug for TyAndLayout<'a, Ty>
// rustc: compiler/rustc_abi/src/layout/ty.rs:82 fmt
export function debug_TyAndLayout<Ty>(self: TyAndLayout<Ty>, f: Fmt, display_Ty: (ty: Ty) => string): string {
  // Print the type in a readable way, not its debug representation.
  return debug_struct(f, "TyAndLayout", [
    ["ty", display_Ty(self.ty)],
    ["layout", debug_Layout(self.layout, f)],
  ]);
}
