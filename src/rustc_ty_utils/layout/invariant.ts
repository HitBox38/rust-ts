// Port of compiler/rustc_ty_utils/src/layout/invariant.rs (lane layout-contract declared the fns; lane ty-utils-layout
// ported them). Everything after `if !cfg!(debug_assertions) { return; }` is dead in rustc (it ships without debug
// assertions) and is ported for fidelity behind `cfg_debug_assertions()`.
// PORT (ty-utils-layout):
// - The three nested fns of `layout_sanity_check` are nested functions in the same place (markers on them).
// - `non_zst_fields`'s `impl Iterator<Item = (Size, TyAndLayout)>` is a generator (lazy like upstream: callers take
//   at most three items with `.next()`; the layout-contract declaration returned an array).
// - `assert_eq!` / `assert_matches!` with a message use core's text with arguments (`assert_failed_inner`), built only
//   on failure.
import {
  type AbiAlign,
  type Align,
  BackendLaneCount,
  BackendRepr,
  debug_Align,
  debug_BackendRepr,
  debug_Size,
  debug_VariantLayout,
  FieldsShape,
  type Scalar,
  Scalar as ScalarC,
  Size,
  TyAndLayout as AbiTyAndLayout,
  type VariantIdx,
} from "../../rustc_abi/lib.ts";
import { debug_TyAndLayout_Ty, type LayoutCx, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug } from "../../rustc_span/macros.ts";
import { UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { debug_int, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";

/** PORT: `cfg!(debug_assertions)`: rustc ships without debug assertions (a function, so the guarded code type-checks). */
function cfg_debug_assertions(): boolean {
  return false;
}

/** PORT: `assert_eq!(left, right, msg..)` (core `assert_failed_inner`, `AssertKind::Eq`, with args). */
function assert_eq_msg<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean, msg: () => string): void {
  if (!eq(left, right)) {
    panic(`assertion \`left == right\` failed: ${msg()}\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

/** PORT: `assert_matches!(left, pattern, msg..)` (core `assert_failed_inner`, `AssertKind::Match`, with args). */
function assert_matches_msg(matches: boolean, left: () => string, pattern: string, msg: () => string): void {
  if (!matches) {
    panic(`assertion \`left matches right\` failed: ${msg()}\n  left: ${left()}\n right: ${pattern}`);
  }
}

/** PORT: the derived `PartialEq` of `Size` / `Align` / `AbiAlign`. */
function size_eq(a: Size, b: Size): boolean {
  return a.raw === b.raw;
}
function align_eq(a: Align, b: Align): boolean {
  return a.pow2 === b.pow2;
}
function abi_align_eq(a: AbiAlign, b: AbiAlign): boolean {
  return a.abi.pow2 === b.abi.pow2;
}
const debug_Align_ = (v: Align): string => debug_Align(v, PLAIN);

/// Enforce some basic invariants on layouts.
// rustc: compiler/rustc_ty_utils/src/layout/invariant.rs:10 layout_sanity_check
export function layout_sanity_check(cx: LayoutCx, layout: TyAndLayout): void {
  const tcx = cx.tcx_();

  // PORT: `u64::is_multiple_of` (the align is never 0); `Size` byte counts are exact `number`s (rustc_abi `Size`).
  if (!(layout.size.bytes() % layout.align.abi.bytes() === 0)) {
    bug(`size is not a multiple of align, in the following layout:\n${debug_TyAndLayout_Ty(layout, PRETTY)}`);
  }
  if (layout.size.bytes() >= tcx.data_layout().obj_size_bound()) {
    bug(`size is too large, in the following layout:\n${debug_TyAndLayout_Ty(layout, PRETTY)}`);
  }
  // FIXME(#124403): Once `repr_c_enums_larger_than_int` is a hard error, we could assert
  // here that a repr(c) enum discriminant is never larger than a c_int.

  if (!cfg_debug_assertions()) {
    // Stop here, the rest is kind of expensive.
    return;
  }

  // Type-level uninhabitedness should always imply ABI uninhabitedness. This can be expensive on
  // big non-exhaustive types, and is [hard to
  // fix](https://github.com/rust-lang/rust/issues/141006#issuecomment-2883415000) in general.
  // Only doing this sanity check when debug assertions are turned on avoids the issue for the
  // very specific case of #140944.
  if (layout.ty.is_privately_uninhabited(tcx, cx.typing_env)) {
    if (!layout.is_uninhabited()) {
      panic(`${debug_Ty(layout.ty, PLAIN)} is type-level uninhabited but not ABI-uninhabited?`);
    }
  }
  // ABI uninhabitedness should imply opsem uninhabitedness. However, we can only check that if
  // the type is really monomorphic (while we can compute a layout for some generic types).
  if (layout.is_uninhabited() && !TypeVisitableExt.has_param(layout.ty, fold_Ty)) {
    if (layout.ty.is_opsem_inhabited(tcx, cx.typing_env)) {
      panic(`${debug_Ty(layout.ty, PLAIN)} is ABI-uninhabited but not opsem-uninhabited?`);
    }
  }

  /// Yields non-ZST fields of the type
  // rustc: compiler/rustc_ty_utils/src/layout/invariant.rs:50 non_zst_fields
  function* non_zst_fields(cx: LayoutCx, layout: TyAndLayout): Generator<[Size, TyAndLayout], void, undefined> {
    const count = FieldsShape.count(layout.layout.fields());
    for (let i = 0; i < count; i++) {
      const field: TyAndLayout = layout.field(cx, i);
      // Also checking `align == 1` here leads to test failures in
      // `layout/zero-sized-array-union.rs`, where a type has a zero-size field with
      // alignment 4 that still gets ignored during layout computation (which is okay
      // since other fields already force alignment 4).
      const zst = field.is_zst();
      if (!zst) yield [FieldsShape.offset(layout.fields, i), field];
    }
  }

  // rustc: compiler/rustc_ty_utils/src/layout/invariant.rs:65 skip_newtypes
  function skip_newtypes(cx: LayoutCx, layout: TyAndLayout): TyAndLayout {
    const k = layout.ty.kind();
    switch (k.$) {
      case "UnsafeBinder": {
        const bound_ty = k._0;
        const ty = cx.tcx_().instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(bound_ty), fold_Ty);
        return skip_newtypes(cx, new AbiTyAndLayout(ty, layout.layout));
      }
      default:
        break;
    }

    if (layout.layout.variants().$ === "Multiple") {
      // Definitely not a newtype of anything.
      return layout;
    }
    const fields = non_zst_fields(cx, layout);
    const first_ = fields.next();
    if (first_.done) {
      // No fields here, so this could be a primitive or enum -- either way it's not a newtype around a thing
      return layout;
    }
    if (fields.next().done) {
      const [offset, first] = first_.value;
      if (size_eq(offset, Size.ZERO) && size_eq(first.layout.size(), layout.size)) {
        // This is a newtype, so keep recursing.
        // FIXME(RalfJung): I don't think it would be correct to do any checks for
        // alignment here, so we don't. Is that correct?
        return skip_newtypes(cx, first);
      }
    }
    // No more newtypes here.
    return layout;
  }

  // rustc: compiler/rustc_ty_utils/src/layout/invariant.rs:96 check_layout_abi
  function check_layout_abi(cx: LayoutCx, layout: TyAndLayout): void {
    // Verify the ABI-mandated alignment and size for scalars.
    const align = BackendRepr.scalar_platform_align(layout.backend_repr, cx);
    const size = BackendRepr.scalar_size(layout.backend_repr, cx);
    if (align !== undefined) {
      assert_eq_msg(layout.layout.align().abi, align, debug_Align_, align_eq, () => `alignment mismatch between ABI and layout in ${debug_TyAndLayout_Ty(layout, PRETTY)}`);
    }
    if (size !== undefined) {
      assert_eq_msg(layout.layout.size(), size, (v) => debug_Size(v, PLAIN), size_eq, () => `size mismatch between ABI and layout in ${debug_TyAndLayout_Ty(layout, PRETTY)}`);
    }

    // Verify per-ABI invariants
    const br = layout.layout.backend_repr();
    switch (br.$) {
      case "Scalar": {
        // These must always be present for `Scalar` types.
        const align_ = unwrap(align);
        const size_ = unwrap(size);
        // Check that this matches the underlying field.
        const inner = skip_newtypes(cx, layout);
        assert(
          inner.layout.backend_repr().$ === "Scalar",
          `\`Scalar\` type ${display_Ty(layout.ty)} is newtype around non-\`Scalar\` type ${display_Ty(inner.ty)}`,
        );
        const fields = inner.layout.fields();
        switch (fields.$) {
          case "Primitive": {
            // Fine.
            break;
          }
          case "Union": {
            // FIXME: I guess we could also check something here? Like, look at all fields?
            return;
          }
          case "Arbitrary": {
            // Should be an enum, the only field is the discriminant.
            assert(inner.ty.is_enum(), `\`Scalar\` layout for non-primitive non-enum type ${display_Ty(inner.ty)}`);
            assert_eq_msg(FieldsShape.count(inner.layout.fields()), 1, (v) => debug_int(v, PLAIN), (a, b) => a === b, () => `\`Scalar\` layout for multiple-field type in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
            const offset = FieldsShape.offset(inner.layout.fields(), 0);
            const field: TyAndLayout = inner.field(cx, 0);
            // The field should be at the right offset, and match the `scalar` layout.
            assert_eq_msg(offset, Size.ZERO, (v) => debug_Size(v, PLAIN), size_eq, () => `\`Scalar\` field at non-0 offset in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
            assert_eq_msg(field.size, size_, (v) => debug_Size(v, PLAIN), size_eq, () => `\`Scalar\` field with bad size in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
            assert_eq_msg(field.align.abi, align_, debug_Align_, align_eq, () => `\`Scalar\` field with bad align in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
            assert(field.backend_repr.$ === "Scalar", `\`Scalar\` field with bad ABI in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
            break;
          }
          default: {
            panic(`\`Scalar\` layout for non-primitive non-enum type ${display_Ty(inner.ty)}`);
          }
        }
        break;
      }
      case "ScalarPair": {
        const { a: scalar1, b: scalar2, b_offset } = br;
        // Check that the underlying pair of fields matches.
        const inner = skip_newtypes(cx, layout);
        assert(
          inner.layout.backend_repr().$ === "ScalarPair",
          `\`ScalarPair\` type ${display_Ty(layout.ty)} is newtype around non-\`ScalarPair\` type ${display_Ty(inner.ty)}`,
        );
        // `a` is at memory offset zero, so to keep them from overlapping the offset
        // to `b` must be at least as much as the size of `a`.
        if (!(b_offset.raw >= ScalarC.size(scalar1, cx).raw)) {
          panic(`\`ScalarPair\` scalars are overlapping in ${debug_TyAndLayout_Ty(layout, PLAIN)}`);
        }
        if (inner.layout.variants().$ === "Multiple") {
          // FIXME: ScalarPair for enums is enormously complicated and it is very hard
          // to check anything about them.
          return;
        }
        switch (inner.layout.fields().$) {
          case "Arbitrary": {
            // Checked below.
            break;
          }
          case "Union": {
            // FIXME: I guess we could also check something here? Like, look at all fields?
            return;
          }
          default: {
            panic(`\`ScalarPair\` layout with unexpected field shape in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
          }
        }
        const fields = non_zst_fields(cx, inner);
        const n1 = fields.next();
        if (n1.done) {
          panic(`\`ScalarPair\` layout for type with not even one non-ZST field: ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        }
        let [offset1, field1] = n1.value;
        const n2 = fields.next();
        if (n2.done) {
          panic(`\`ScalarPair\` layout for type with less than two non-ZST fields: ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        }
        let [offset2, field2] = n2.value;
        const n3 = fields.next();
        assert_matches_msg(
          n3.done === true,
          () => `Some((${debug_Size(n3.value![0], PLAIN)}, ${debug_TyAndLayout_Ty(n3.value![1], PLAIN)}))`,
          "None",
          () => `\`ScalarPair\` layout for type with at least three non-ZST fields: ${debug_TyAndLayout_Ty(inner, PRETTY)}`,
        );
        // The fields might be in opposite order.
        if (!(offset1.raw <= offset2.raw)) {
          [offset1, field1, offset2, field2] = [offset2, field2, offset1, field1];
        }
        // The fields should be at the right offset, and match the `scalar` layout.
        const size1 = ScalarC.size(scalar1, cx);
        const align1 = ScalarC.default_align(scalar1, cx).abi;
        const size2 = ScalarC.size(scalar2, cx);
        const align2 = ScalarC.default_align(scalar2, cx).abi;
        assert_eq_msg(offset1, Size.ZERO, (v) => debug_Size(v, PLAIN), size_eq, () => `\`ScalarPair\` first field at non-0 offset in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_eq_msg(field1.size, size1, (v) => debug_Size(v, PLAIN), size_eq, () => `\`ScalarPair\` first field with bad size in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_eq_msg(field1.align.abi, align1, debug_Align_, align_eq, () => `\`ScalarPair\` first field with bad align in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_matches_msg(
          field1.backend_repr.$ === "Scalar",
          () => debug_BackendRepr(field1.backend_repr, PLAIN),
          "BackendRepr::Scalar(_)",
          () => `\`ScalarPair\` first field with bad ABI in ${debug_TyAndLayout_Ty(inner, PRETTY)}`,
        );
        const field2_offset = size1.align_to(align2);
        assert_eq_msg(offset2, field2_offset, (v) => debug_Size(v, PLAIN), size_eq, () => `\`ScalarPair\` second field at bad offset in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_eq_msg(b_offset, field2_offset, (v) => debug_Size(v, PLAIN), size_eq, () => `\`ScalarPair\` with inconsistent b_offset in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_eq_msg(field2.size, size2, (v) => debug_Size(v, PLAIN), size_eq, () => `\`ScalarPair\` second field with bad size in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_eq_msg(field2.align.abi, align2, debug_Align_, align_eq, () => `\`ScalarPair\` second field with bad align in ${debug_TyAndLayout_Ty(inner, PRETTY)}`);
        assert_matches_msg(
          field2.backend_repr.$ === "Scalar",
          () => debug_BackendRepr(field2.backend_repr, PLAIN),
          "BackendRepr::Scalar(_)",
          () => `\`ScalarPair\` second field with bad ABI in ${debug_TyAndLayout_Ty(inner, PRETTY)}`,
        );
        break;
      }
      case "SimdVector": {
        const { element, count } = br;
        const align_ = layout.align.abi;
        const size_ = layout.size;
        const element_align = ScalarC.default_align(element, cx).abi;
        const element_size = ScalarC.size(element, cx);
        // Currently, vectors must always be aligned to at least their elements:
        assert(align_.pow2 >= element_align.pow2, "assertion failed: align >= element_align");
        // And the size has to be element * count plus alignment padding, of course
        // PORT: the lane count is a `NonZero<u16>`, so `as_u64()` is exact as a `number`.
        assert(size_eq(size_, element_size.mul(Number(BackendLaneCount.as_u64(count))).align_to(align_)), "assertion failed: size == (element_size * count.as_u64()).align_to(align)");
        break;
      }
      case "Memory":
      case "SimdScalableVector":
        break; // Nothing to check.
    }
  }

  check_layout_abi(cx, layout);

  const variants = layout.variants;
  switch (variants.$) {
    case "Empty": {
      assert(layout.is_uninhabited(), "assertion failed: layout.is_uninhabited()");
      break;
    }
    case "Single": {
      const index = variants.index;
      const range = layout.ty.variant_range(tcx);
      if (range !== undefined) {
        assert(range.start <= index && index < range.end, "assertion failed: variants.contains(index)");
      } else {
        // Types without variants use `0` as dummy variant index.
        assert(index === 0, "assertion failed: index.as_u32() == 0");
      }
      break;
    }
    case "Multiple": {
      const { variants: variant_layouts, tag, tag_encoding } = variants;
      if (tag_encoding.$ === "Niche") {
        const { niche_start, untagged_variant, niche_variants } = tag_encoding;
        const niche_size = ScalarC.size(tag, cx);
        assert(niche_start <= niche_size.unsigned_int_max(), "assertion failed: *niche_start <= niche_size.unsigned_int_max()");
        for (let i = 0; i < variant_layouts.length; i++) {
          const idx = i as VariantIdx;
          const variant = variant_layouts[i]!;
          // Ensure all inhabited variants are accounted for.
          if (!variant.is_uninhabited()) {
            assert(
              idx === untagged_variant || (niche_variants.start <= idx && idx <= niche_variants.last),
              "assertion failed: idx == *untagged_variant || niche_variants.contains(&idx)",
            );
          }

          // Ensure that for niche encoded tags the discriminant coincides with the variant index.
          const val = unwrap(layout.ty.discriminant_for_variant(tcx, idx)).val;
          if (val !== BigInt(idx)) {
            const adt_def = unwrap(layout.ty.ty_adt_def());
            cx.tcx_()
              .dcx()
              .span_delayed_bug(cx.tcx_().def_span(adt_def.did()), `variant ${debug_int(idx, PLAIN)} has discriminant ${debug_int(val, PLAIN)} in niche-encoded type`);
          }
        }
      }
      for (const variant of variant_layouts) {
        // Variants should have the same or a smaller size as the full thing.
        if (variant.size.raw > layout.size.raw) {
          bug(`Type with size ${layout.size.bytes()} bytes has variant with size ${variant.size.bytes()} bytes: ${debug_TyAndLayout_Ty(layout, PRETTY)}`);
        }
        // Skip empty variants.
        if (size_eq(variant.size, Size.ZERO) || !variant.has_fields() || variant.is_uninhabited()) {
          // These are never actually accessed anyway, so we can skip the coherence check
          // for them. They also fail that check, since they may have
          // a different ABI even when the main type is
          // `Scalar`/`ScalarPair`. (Note that sometimes, variants with fields have size
          // 0, and sometimes, variants without fields have non-0 size.)
          continue;
        }
        // The top-level ABI and the ABI of the variants should be coherent.
        const scalar_coherent = (s1: Scalar, s2: Scalar): boolean =>
          size_eq(ScalarC.size(s1, cx), ScalarC.size(s2, cx)) && abi_align_eq(ScalarC.default_align(s1, cx), ScalarC.default_align(s2, cx));
        const l = layout.backend_repr;
        const v = variant.backend_repr;
        let abi_coherent: boolean;
        if (l.$ === "Scalar" && v.$ === "Scalar") {
          abi_coherent = scalar_coherent(l._0, v._0);
        } else if (l.$ === "ScalarPair" && v.$ === "ScalarPair") {
          abi_coherent = scalar_coherent(l.a, v.a) && scalar_coherent(l.b, v.b) && size_eq(l.b_offset, v.b_offset);
        } else if (l.$ === "Memory") {
          abi_coherent = true;
        } else {
          abi_coherent = false;
        }
        if (!abi_coherent) {
          bug(`Variant ABI is incompatible with top-level ABI:\nvariant=${debug_VariantLayout(variant, PRETTY)}\nTop-level: ${debug_TyAndLayout_Ty(layout, PRETTY)}`);
        }
      }
      break;
    }
  }
}
