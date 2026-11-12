// Port of compiler/rustc_codegen_llvm/src/type_of.rs (skeleton: lane cg-contract; bodies: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// PORT (cg-contract): `pub(crate) trait LayoutLlvmExt<'tcx>` (implemented only for `TyAndLayout<'tcx>`) is a `declare module`
// augmentation of rustc_abi's class `TyAndLayout`, plus prototype assignments (the miri decision C2 form for an extension trait
// on a foreign class): `layout.llvm_type(cx)` reads as upstream.
//
// PORT (cg-types-attrs):
// - `tracing::debug!` lines are comments.
// - `defer: &mut Option<(&'a Type, TyAndLayout<'tcx>)>` is a `MutRef` (PORTING §8).
// - `cx.scalar_lltypes` is a `Map<Ty, Type>` (interned `Ty` keys); `cx.type_lowering` is a `KeyedMap` on `(Ty, Option<VariantIdx>)`
//   whose key function `CodegenCx::new` (cg-context) chooses.
import { type Align, Align_min, BackendLaneCount, FieldsShape, Scalar, Size, Size_cmp, Size_eq, type Variants } from "../rustc_abi/lib.ts";
import { TyAndLayout } from "../rustc_abi/layout/ty.ts";
import type { VariantIdx } from "../rustc_abi/layout.ts";
import type { TyAndLayout as TyAndLayout_Ty } from "../rustc_middle/ty/layout.ts";
import { display_Ty, with_no_trimmed_paths, with_no_visible_paths } from "../rustc_middle/ty/print/pretty.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { CoroutineArgsExt } from "../rustc_middle/ty/sty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, assert_eq } from "../std/panic.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { debug_TyAndLayout_Ty } from "../rustc_middle/ty/layout.ts";
import { debug_Size } from "../rustc_abi/lib.ts";
import { CodegenCx } from "./context.ts";
import type { Type } from "./llvm/mod.ts";

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:15 uncached_llvm_type
function uncached_llvm_type(cx: CodegenCx, layout: TyAndLayout_Ty, defer: MutRef<readonly [Type, TyAndLayout_Ty] | undefined>): Type {
  const backend_repr = layout.backend_repr;
  switch (backend_repr.$) {
    case "Scalar":
      return bug("handled elsewhere");
    case "SimdVector": {
      const { element, count } = backend_repr;
      const element_ = layout.scalar_llvm_type_at(cx, element);
      // PORT: `count.as_u64()`, a lane count: a `number` (`type_vector`'s `count`).
      return cx.type_vector(element_, Number(BackendLaneCount.as_u64(count)));
    }
    case "SimdScalableVector": {
      const { element, count, number_of_vectors } = backend_repr;
      const element_ = Scalar.is_bool(element) ? cx.type_i1() : layout.scalar_llvm_type_at(cx, element);

      const vector_type = cx.type_scalable_vector(element_, Number(BackendLaneCount.as_u64(count)));
      // `number_of_vectors.0`: `NumScalableVectors` is a branded number.
      switch (number_of_vectors as number) {
        case 1:
          return vector_type;
        case 2:
          return cx.type_struct([vector_type, vector_type], false);
        case 3:
          return cx.type_struct([vector_type, vector_type, vector_type], false);
        case 4:
          return cx.type_struct([vector_type, vector_type, vector_type, vector_type], false);
        case 5:
          return cx.type_struct([vector_type, vector_type, vector_type, vector_type, vector_type], false);
        case 6:
          return cx.type_struct([vector_type, vector_type, vector_type, vector_type, vector_type, vector_type], false);
        case 7:
          return cx.type_struct([vector_type, vector_type, vector_type, vector_type, vector_type, vector_type, vector_type], false);
        case 8:
          return cx.type_struct(
            [vector_type, vector_type, vector_type, vector_type, vector_type, vector_type, vector_type, vector_type],
            false,
          );
        default:
          return bug("`#[rustc_scalable_vector]` tuple struct with too many fields");
      }
    }
    case "Memory":
    case "ScalarPair":
      break;
  }

  let name: string | undefined;
  const kind = layout.ty.kind();
  switch (kind.$) {
    // FIXME(eddyb) producing readable type names for trait objects can result
    // in problematically distinct types due to HRTB and subtyping (see #47638).
    // ty::Dynamic(..) |
    case "Adt":
    case "Closure":
    case "CoroutineClosure":
    case "Foreign":
    case "Coroutine":
    case "Str":
      // For performance reasons we use names only when emitting LLVM IR.
      if (!cx.sess().fewer_names()) {
        let name_ = with_no_visible_paths(() => with_no_trimmed_paths(() => display_Ty(layout.ty)));
        const variants: Variants = layout.variants;
        if (kind.$ === "Adt" && variants.$ === "Single") {
          const def = kind._0;
          const index = variants.index;
          if (def.is_enum()) {
            name_ += `::${Symbol.as_str(def.variant(index).name)}`;
          }
        }
        if (kind.$ === "Coroutine" && variants.$ === "Single") {
          const index = variants.index;
          name_ += `::${CoroutineArgsExt.variant_name(index)}`;
        }
        name = name_;
        break;
      }
      name = undefined;
      break;
    default:
      name = undefined;
  }

  const fields = layout.fields;
  switch (fields.$) {
    case "Primitive":
    case "Union": {
      const fill = cx.type_padding_filler(layout.size, layout.align.abi);
      const packed = false;
      if (name === undefined) {
        return cx.type_struct([fill], packed);
      } else {
        const llty = cx.type_named_struct(name);
        cx.set_struct_body(llty, [fill], packed);
        return llty;
      }
    }
    case "Array":
      return cx.type_array(layout.field(cx, 0).llvm_type(cx), fields.count);
    case "Arbitrary":
      if (name === undefined) {
        const [llfields, packed] = struct_llfields(cx, layout);
        return cx.type_struct(llfields, packed);
      } else {
        const llty = cx.type_named_struct(name);
        defer.value = [llty, layout];
        return llty;
      }
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:132 struct_llfields
function struct_llfields(cx: CodegenCx, layout: TyAndLayout_Ty): [Type[], boolean] {
  // debug!("struct_llfields: {:#?}", layout);
  const field_count = FieldsShape.count(layout.fields);

  let packed = false;
  let offset = Size.ZERO;
  let prev_effective_align: Align = layout.align.abi;
  const result: Type[] = [];
  for (const i of FieldsShape.index_by_increasing_offset(layout.fields)) {
    const target_offset = FieldsShape.offset(layout.fields, i);
    const field = layout.field(cx, i);
    const effective_field_align = Align_min(layout.align.abi, field.align.abi).restrict_for_offset(target_offset);
    // `effective_field_align < field.align.abi` (`Align`'s derived `Ord`, on `pow2`)
    packed ||= effective_field_align.pow2 < field.align.abi.pow2;

    // debug!(
    //     "struct_llfields: {}: {:?} offset: {:?} target_offset: {:?} \
    //         effective_field_align: {}",
    //     i,
    //     field,
    //     offset,
    //     target_offset,
    //     effective_field_align.bytes()
    // );
    assert(Size_cmp(target_offset, offset) >= 0, "assertion failed: target_offset >= offset");
    const padding = target_offset.sub(offset);
    if (!Size_eq(padding, Size.ZERO)) {
      const padding_align = Align_min(prev_effective_align, effective_field_align);
      assert_eq(offset.align_to(padding_align).add(padding), target_offset, (v) => format_debug(v, debug_Size, PLAIN), Size_eq);
      result.push(cx.type_padding_filler(padding, padding_align));
      // debug!("    padding before: {:?}", padding);
    }
    result.push(field.llvm_type(cx));
    offset = target_offset.add(field.size);
    prev_effective_align = effective_field_align;
  }
  if (layout.is_sized() && field_count > 0) {
    if (Size_cmp(offset, layout.size) > 0) {
      bug(
        `layout: ${format_debug(layout, debug_TyAndLayout_Ty, PRETTY)} stride: ${format_debug(layout.size, debug_Size, PLAIN)} offset: ${format_debug(offset, debug_Size, PLAIN)}`,
      );
    }
    const padding = layout.size.sub(offset);
    if (!Size_eq(padding, Size.ZERO)) {
      const padding_align = prev_effective_align;
      assert_eq(offset.align_to(padding_align).add(padding), layout.size, (v) => format_debug(v, debug_Size, PLAIN), Size_eq);
      // debug!(
      //     "struct_llfields: pad_bytes: {:?} offset: {:?} stride: {:?}",
      //     padding, offset, layout.size
      // );
      result.push(cx.type_padding_filler(padding, padding_align));
    }
  } else {
    // debug!("struct_llfields: offset: {:?} stride: {:?}", offset, layout.size);
  }
  return [result, packed];
}

// ---- impl<'a, 'tcx> CodegenCx<'a, 'tcx> (type_of.rs:191) ----
declare module "./context.ts" {
  interface CodegenCx {
    align_of(ty: Ty): Align;
    size_of(ty: Ty): Size;
    size_and_align_of(ty: Ty): [Size, Align];
    spanned_size_and_align_of(ty: Ty, span: Span): [Size, Align];
  }
}

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:192 align_of
CodegenCx.prototype.align_of = function (this: CodegenCx, ty: Ty): Align {
  return this.layout_of(ty).align.abi;
};

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:196 size_of
CodegenCx.prototype.size_of = function (this: CodegenCx, ty: Ty): Size {
  return this.layout_of(ty).size;
};

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:200 size_and_align_of
CodegenCx.prototype.size_and_align_of = function (this: CodegenCx, ty: Ty): [Size, Align] {
  return this.spanned_size_and_align_of(ty, DUMMY_SP);
};

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:204 spanned_size_and_align_of
CodegenCx.prototype.spanned_size_and_align_of = function (this: CodegenCx, ty: Ty, span: Span): [Size, Align] {
  const layout = this.spanned_layout_of(ty, span);
  return [layout.size, layout.align.abi];
};

// ---- pub(crate) trait LayoutLlvmExt<'tcx> (type_of.rs:210) ----
export interface LayoutLlvmExt {
  // rustc: compiler/rustc_codegen_llvm/src/type_of.rs:211 llvm_type
  llvm_type(cx: CodegenCx): Type;
  // rustc: compiler/rustc_codegen_llvm/src/type_of.rs:212 immediate_llvm_type
  immediate_llvm_type(cx: CodegenCx): Type;
  // rustc: compiler/rustc_codegen_llvm/src/type_of.rs:213 scalar_llvm_type_at
  scalar_llvm_type_at(cx: CodegenCx, scalar: Scalar): Type;
  // rustc: compiler/rustc_codegen_llvm/src/type_of.rs:214 scalar_pair_element_llvm_type
  scalar_pair_element_llvm_type(cx: CodegenCx, index: number, immediate: boolean): Type;
}
declare module "../rustc_abi/layout/ty.ts" {
  interface TyAndLayout<Ty> extends LayoutLlvmExt {}
}

// ---- impl<'tcx> LayoutLlvmExt<'tcx> for TyAndLayout<'tcx> (type_of.rs:222) ----

/// Gets the LLVM type corresponding to a Rust type, i.e., `rustc_middle::ty::Ty`.
/// The pointee type of the pointer in `PlaceRef` is always this type.
/// For sized types, it is also the right LLVM type for an `alloca`
/// containing a value of that type, and most immediates (except `bool`).
/// Unsized types, however, are represented by a "minimal unit", e.g.
/// `[T]` becomes `T`, while `str` and `Trait` turn into `i8` - this
/// is useful for indexing slices, as `&[T]`'s data pointer is `T*`.
/// If the type is an unsized struct, the regular layout is generated,
/// with the innermost trailing unsized field using the "minimal unit"
/// of that field's type - this is useful for taking the address of
/// that field and ensuring the struct has the right alignment.
// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:234 llvm_type
TyAndLayout.prototype.llvm_type = function (this: TyAndLayout_Ty, cx: CodegenCx): Type {
  // This must produce the same result for `repr(transparent)` wrappers as for the inner type!
  // In other words, this should generally not look at the type at all, but only at the
  // layout.
  const backend_repr = this.backend_repr;
  if (backend_repr.$ === "Scalar") {
    const scalar = backend_repr._0;
    // Use a different cache for scalars because pointers to DSTs
    // can be either wide or thin (data pointers of wide pointers).
    const cached = cx.scalar_lltypes.get(this.ty);
    if (cached !== undefined) {
      return cached;
    }
    const llty = this.scalar_llvm_type_at(cx, scalar);
    cx.scalar_lltypes.set(this.ty, llty);
    return llty;
  }

  // Check the cache.
  const variants = this.variants;
  const variant_index: VariantIdx | undefined = variants.$ === "Single" ? variants.index : undefined;
  const cached = cx.type_lowering.get([this.ty, variant_index]);
  if (cached !== undefined) {
    return cached;
  }

  // debug!("llvm_type({:#?})", self);

  assert(!TypeVisitableExt.has_escaping_bound_vars(this.ty, fold_Ty), () => `${format_debug(this.ty, debug_Ty, PLAIN)} has escaping bound vars`);

  // Make sure lifetimes are erased, to avoid generating distinct LLVM
  // types for Rust types that only differ in the choice of lifetimes.
  const normal_ty = cx.tcx.erase_and_anonymize_regions(this.ty, fold_Ty);

  const defer: MutRef<readonly [Type, TyAndLayout_Ty] | undefined> = { value: undefined };
  let llty: Type;
  if (this.ty !== normal_ty) {
    let layout = cx.layout_of(normal_ty);
    if (variant_index !== undefined) {
      layout = layout.for_variant(cx, variant_index);
    }
    llty = layout.llvm_type(cx);
  } else {
    llty = uncached_llvm_type(cx, this, defer);
  }
  // debug!("--> mapped {:#?} to llty={:?}", self, llty);

  cx.type_lowering.set([this.ty, variant_index], llty);

  if (defer.value !== undefined) {
    const [llty, layout] = defer.value;
    const [llfields, packed] = struct_llfields(cx, layout);
    cx.set_struct_body(llty, llfields, packed);
  }
  return llty;
};

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:287 immediate_llvm_type
TyAndLayout.prototype.immediate_llvm_type = function (this: TyAndLayout_Ty, cx: CodegenCx): Type {
  const backend_repr = this.backend_repr;
  switch (backend_repr.$) {
    case "Scalar": {
      const scalar = backend_repr._0;
      if (Scalar.is_bool(scalar)) {
        return cx.type_i1();
      }
      break;
    }
    case "ScalarPair":
      // An immediate pair always contains just the two elements, without any padding
      // filler, as it should never be stored to memory.
      return cx.type_struct([this.scalar_pair_element_llvm_type(cx, 0, true), this.scalar_pair_element_llvm_type(cx, 1, true)], false);
    default:
      break;
  }
  return this.llvm_type(cx);
};

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:310 scalar_llvm_type_at
TyAndLayout.prototype.scalar_llvm_type_at = function (this: TyAndLayout_Ty, cx: CodegenCx, scalar: Scalar): Type {
  const p = Scalar.primitive(scalar);
  switch (p.$) {
    case "Int":
      return cx.type_from_integer(p._0);
    case "Float":
      return cx.type_from_float(p._0);
    case "Pointer":
      return cx.type_ptr_ext(p._0);
  }
};

// rustc: compiler/rustc_codegen_llvm/src/type_of.rs:318 scalar_pair_element_llvm_type
TyAndLayout.prototype.scalar_pair_element_llvm_type = function (this: TyAndLayout_Ty, cx: CodegenCx, index: number, immediate: boolean): Type {
  // This must produce the same result for `repr(transparent)` wrappers as for the inner type!
  // In other words, this should generally not look at the type at all, but only at the
  // layout.
  const backend_repr = this.backend_repr;
  if (backend_repr.$ !== "ScalarPair") {
    return bug(`TyAndLayout::scalar_pair_element_llty(${format_debug(this, debug_TyAndLayout_Ty, PLAIN)}): not applicable`);
  }
  const { a, b } = backend_repr;
  const scalar = [a, b][index]!;

  // Make sure to return the same type `immediate_llvm_type` would when
  // dealing with an immediate pair. This means that `(bool, bool)` is
  // effectively represented as `{i8, i8}` in memory and two `i1`s as an
  // immediate, just like `bool` is typically `i8` in memory and only `i1`
  // when immediate. We need to load/store `bool` as `i8` to avoid
  // crippling LLVM optimizations or triggering other LLVM bugs with `i1`.
  if (immediate && Scalar.is_bool(scalar)) {
    return cx.type_i1();
  }

  return this.scalar_llvm_type_at(cx, scalar);
};
