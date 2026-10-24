// Port of compiler/rustc_const_eval/src/interpret/projection.rs (declared by lane interp-contract, filled by lane interp-ops).
//! This file implements "place projections"; basically a symmetric API for 3 types: MPlaceTy, OpTy, PlaceTy.
//!
//! OpTy and PlaceTy generally work by "let's see if we are actually an MPlaceTy, and do something custom if not".
//! For PlaceTy, the custom thing is basically always to call `force_allocation` and then use the MPlaceTy logic anyway.
//! For OpTy, the custom thing on field projections has to be pretty clever (since `Operand::Immediate` can have fields),
//! but for array/slice operations it only has to worry about `Operand::Uninit`. That makes the value part trivial,
//! but we still need to do bounds checking and adjust the layout. To not duplicate that with MPlaceTy, we actually
//! implement the logic on OpTy, and MPlaceTy calls that.
import { FieldIdx, FieldsShape, Size, type VariantIdx } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { MemPlaceMeta } from "./place.ts";
import { ArrayIterator, OffsetMode } from "./projection.gen.ts";
import { type CtfeProvenance, debug_InterpErrorKind, InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type PlaceElem } from "../../rustc_middle/mir/mod.ts";
import { type TyAndLayout, debug_TyAndLayout_Ty } from "../../rustc_middle/ty/layout.ts";
import { debug_VariantDef, Ty, type VariantDef } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Symbol, type Symbol } from "../../rustc_span/symbol.ts";
import { debug_list, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../std/panic.ts";
import { Err, unwrap_result } from "../../std/result.ts";
import { debug_Size } from "../../rustc_abi/lib.ts";
import { ImmTy, OpTy, OpTy_from_MPlaceTy } from "./operand.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";
import { PlaceTy_from_MPlaceTy } from "./place.ts";

export * from "./projection.gen.ts";

declare module "./projection.gen.ts" {
  interface ArrayIterator<P> {
    // projection.rs:119 (lane interp-ops)
    next(ecx: InterpCx): InterpResult<[bigint, P] | undefined>;
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // projection.rs:150 (lane interp-ops)
    project_field<P extends Projectable<P>>(base: P, field: FieldIdx): InterpResult<P>;
    // projection.rs:204 (lane interp-ops)
    project_fields<P extends Projectable<P>>(base: P, fields: readonly FieldIdx[]): InterpResult<P[]>;
    // projection.rs:213 (lane interp-ops)
    project_downcast<P extends Projectable<P>>(base: P, variant: VariantIdx): InterpResult<P>;
    // projection.rs:232 (lane interp-ops)
    project_downcast_named<P extends Projectable<P>>(base: P, name: Symbol): InterpResult<[VariantIdx, P]>;
    // projection.rs:248 (lane interp-ops)
    project_index<P extends Projectable<P>>(base: P, index: bigint): InterpResult<P>;
    // projection.rs:283 (lane interp-ops)
    project_to_simd<P extends Projectable<P>>(base: P): InterpResult<[P, bigint]>;
    // projection.rs:294 (lane interp-ops)
    project_constant_index<P extends Projectable<P>>(base: P, offset: bigint, min_length: bigint, from_end: boolean): InterpResult<P>;
    // projection.rs:320 (lane interp-ops)
    project_array_fields<P extends Projectable<P>>(base: P): InterpResult<ArrayIterator<P>>;
    // projection.rs:347 (lane interp-ops)
    project_subslice<P extends Projectable<P>>(base: P, from: bigint, to: bigint, from_end: boolean): InterpResult<P>;
    // projection.rs:405 (lane interp-ops)
    project<P extends Projectable<P>>(base: P, proj_elem: PlaceElem): InterpResult<P>;
    // projection.rs:436 (lane interp-ops)
    project_to_ptr_in_box<P extends Projectable<P>>(box_: P): InterpResult<[P, P]>;
  }
}

/// A thing that we can project into, and that has a layout.
// pub trait Projectable<'tcx, Prov: Provenance>: Sized + std::fmt::Debug
// PORT: an interface implemented by the prototypes of `MPlaceTy`, `PlaceTy`, `OpTy` and `ImmTy`; `Self` is the type
// parameter (a generic `P: Projectable` is `P extends Projectable<P>`, an `&impl Projectable` parameter `Projectable`).
// `layout()` is `layout_()` (clash with the implementors' field `layout`). The provided methods are `Projectable_provided`
// (PORTING §8); the implementors' prototypes forward to it (installed below).
export interface Projectable<Self = unknown> {
  /// Get the layout.
  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:37 layout
  layout_(): TyAndLayout;

  /// Get the metadata of a wide value.
  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:40 meta
  meta(): MemPlaceMeta;

  /// Get the length of a slice/string/array stored here.
  len(ecx: InterpCx): InterpResult<bigint>; // (provided)

  /// Offset the value by the given amount, replacing the layout and metadata.
  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:65 offset_with_meta
  offset_with_meta(offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<Self>;

  offset(offset: Size, layout: TyAndLayout, ecx: InterpCx): InterpResult<Self>; // (provided)

  /// This does an offset-by-zero, which is effectively a transmute. Note however that
  /// not all transmutes are supported by all projectables -- specifically, if this is an
  /// `OpTy` or `ImmTy`, the new layout must have almost the same ABI as the old one
  /// (only changing the `valid_range` is allowed and turning integers into pointers).
  transmute(layout: TyAndLayout, ecx: InterpCx): InterpResult<Self>; // (provided)

  /// Convert this to an `OpTy`. This might be an irreversible transformation, but is useful for
  /// reading from this thing. This will never actually do a read from memory!
  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:102 to_op
  to_op(ecx: InterpCx): InterpResult<OpTy>;
}

/** PORT: the provided methods of `Projectable` (PORTING §8). */
export const Projectable_provided = {
  /// Get the length of a slice/string/array stored here.
  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:43 len
  len<Self>(self: Projectable<Self>, ecx: InterpCx): InterpResult<bigint> {
    const layout = self.layout_();
    if (layout.is_unsized()) {
      // We need to consult `meta` metadata
      const kind = layout.ty.kind();
      switch (kind.$) {
        case "Slice":
        case "Str":
          return Scalar.to_target_usize(MemPlaceMeta.unwrap_meta(self.meta()), ecx);
        default:
          return bug(`len not supported on unsized type ${debug_Ty(layout.ty, PLAIN)}`);
      }
    } else {
      // Go through the layout. There are lots of types that support a length,
      // e.g., SIMD types. (But not all repr(simd) types even have FieldsShape::Array!)
      const fields = layout.fields;
      switch (fields.$) {
        case "Array":
          return interp_ok(fields.count);
        default:
          return bug(`len not supported on sized type ${debug_Ty(layout.ty, PLAIN)}`);
      }
    }
  },

  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:74 offset
  offset<Self>(self: Projectable<Self>, offset: Size, layout: TyAndLayout, ecx: InterpCx): InterpResult<Self> {
    assert(layout.is_sized(), "assertion failed: layout.is_sized()");
    // We sometimes do pointer arithmetic with this function, disregarding the source type.
    // So we don't check the sizes here.
    return self.offset_with_meta(offset, OffsetMode.Inbounds, MemPlaceMeta.None, layout, ecx);
  },

  /// This does an offset-by-zero, which is effectively a transmute. Note however that
  /// not all transmutes are supported by all projectables -- specifically, if this is an
  /// `OpTy` or `ImmTy`, the new layout must have almost the same ABI as the old one
  /// (only changing the `valid_range` is allowed and turning integers into pointers).
  // rustc: compiler/rustc_const_eval/src/interpret/projection.rs:90 transmute
  transmute<Self>(self: Projectable<Self>, layout: TyAndLayout, ecx: InterpCx): InterpResult<Self> {
    assert(self.layout_().is_sized() && layout.is_sized(), "assertion failed: self.layout().is_sized() && layout.is_sized()");
    assert_eq(self.layout_().size, layout.size, (v) => debug_Size(v, PLAIN), (a, b) => a.bytes() === b.bytes());
    return self.offset_with_meta(Size.ZERO, OffsetMode.Wrapping, MemPlaceMeta.None, layout, ecx);
  },
};

// PORT: the provided `Projectable` methods on the implementors' prototypes (forwarders, no logic).
declare module "./place.gen.ts" {
  interface MPlaceTy extends Projectable<MPlaceTy> {}
  interface PlaceTy extends Projectable<PlaceTy> {}
}
declare module "./operand.gen.ts" {
  interface ImmTy extends Projectable<ImmTy> {}
  interface OpTy extends Projectable<OpTy> {}
}
for (const C of [MPlaceTy, PlaceTy, ImmTy, OpTy] as { prototype: Projectable<unknown> }[]) {
  C.prototype.len = function (this: Projectable<unknown>, ecx: InterpCx): InterpResult<bigint> {
    return Projectable_provided.len(this, ecx);
  };
  C.prototype.offset = function (this: Projectable<unknown>, offset: Size, layout: TyAndLayout, ecx: InterpCx): InterpResult<unknown> {
    return Projectable_provided.offset(this, offset, layout, ecx);
  };
  C.prototype.transmute = function (this: Projectable<unknown>, layout: TyAndLayout, ecx: InterpCx): InterpResult<unknown> {
    return Projectable_provided.transmute(this, layout, ecx);
  };
}

/** PORT: `<P as From<MPlaceTy>>::from` for `project`'s `Deref`: `P` is resolved on the value's class (the
 * implementors of `From<MPlaceTy>` are `MPlaceTy` (identity), `PlaceTy` and `OpTy`). */
function P_from_MPlaceTy<P>(base: P, mplace: MPlaceTy): P {
  if (base instanceof MPlaceTy) return mplace as P;
  if (base instanceof PlaceTy) return PlaceTy_from_MPlaceTy(mplace) as P;
  if (base instanceof OpTy) return OpTy_from_MPlaceTy(mplace) as P;
  return unreachable_from(base);
}
function unreachable_from(_base: unknown): never {
  return bug("`From<MPlaceTy>` is not implemented for this projectable");
}

/** `throw_ub!(BoundsCheckFailed { len, index })`. PORT: the error's `u64` fields are numbers (error.gen.ts). */
function bounds_check_failed<T>(len: bigint, index: bigint): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "BoundsCheckFailed", len: Number(len), index: Number(index) } }));
}

const U64_MAX = (1n << 64n) - 1n;

/// Should be the same `ecx` on each call, and match the one used to create the iterator.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:119 next
ArrayIterator.prototype.next = function <P>(this: ArrayIterator<P>, ecx: InterpCx): InterpResult<[bigint, P] | undefined> {
  // `self.range.next()`
  if (!(this.range.start < this.range.end)) return interp_ok(undefined);
  const idx = this.range.start;
  this.range.start = idx + 1;
  // We use `Wrapping` here since the offset has already been checked when the iterator was created.
  const base = this.base as Projectable<P>;
  const r = base.offset_with_meta(this.stride.mul(idx), OffsetMode.Wrapping, MemPlaceMeta.None, this.field_layout, ecx);
  if (r.$ === "Err") return r;
  return interp_ok<[bigint, P] | undefined>([BigInt(idx), r._0]);
};

/// Offset a pointer to project to a field of a struct/union. Unlike `place_field`, this is
/// always possible without allocating, so it can take `&self`. Also return the field's layout.
/// This supports both struct and array fields, but not slices!
///
/// This also works for arrays, but then the `FieldIdx` index type is restricting.
/// For indexing into arrays, use [`Self::project_index`].
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:150 project_field
InterpCx.prototype.project_field = function <P extends Projectable<P>>(this: InterpCx, base: P, field: FieldIdx): InterpResult<P> {
  // Slices nominally have length 0, so they will panic somewhere in `fields.offset`.
  // debug_assert!(
  //     !matches!(base.layout().ty.kind(), ty::Slice(..)),
  //     "`field` projection called on a slice -- call `index` projection instead"
  // );
  let offset = FieldsShape.offset(base.layout_().fields, FieldIdx.as_usize(field));
  // Computing the layout does normalization, so we get a normalized type out of this
  // even if the field type is non-normalized (possible e.g. via associated types).
  const field_layout = base.layout_().field(this, FieldIdx.as_usize(field));

  // Offset may need adjustment for unsized fields.
  let meta: MemPlaceMeta;
  if (field_layout.is_unsized()) {
    assert(!base.layout_().is_sized(), "assertion failed: !base.layout().is_sized()");
    const base_meta = base.meta();
    // Re-use parent metadata to determine dynamic field layout.
    // With custom DSTS, this *will* execute user-defined code, but the same
    // happens at run-time so that's okay.
    const r = this.size_and_align_from_meta(base_meta, field_layout);
    if (r.$ === "Err") return r;
    if (r._0 !== undefined) {
      let align = r._0[1];
      // For packed types, we need to cap alignment.
      const kind = base.layout_().ty.kind();
      const packed = kind.$ === "Adt" ? kind._0.repr().pack : undefined;
      if (packed !== undefined) {
        // `Ord::min` (the derived `Ord` compares `pow2`; `self` on ties)
        align = align.pow2 <= packed.pow2 ? align : packed;
      }
      meta = base_meta;
      offset = offset.align_to(align);
    } else if (offset.bytes() === 0) {
      // If the offset is 0, then rounding it up to alignment wouldn't change anything,
      // so we can do this even for types where we cannot determine the alignment.
      meta = base_meta;
    } else {
      // We cannot know the alignment of this field, so we cannot adjust.
      // throw_unsup!(ExternTypeField)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "ExternTypeField" } }));
    }
  } else {
    // base_meta could be present; we might be accessing a sized field of an unsized
    // struct.
    meta = MemPlaceMeta.None;
  }

  return base.offset_with_meta(offset, OffsetMode.Inbounds, meta, field_layout, this);
};

/// Projects multiple fields at once. See [`Self::project_field`] for details.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:204 project_fields
InterpCx.prototype.project_fields = function <P extends Projectable<P>>(this: InterpCx, base: P, fields: readonly FieldIdx[]): InterpResult<P[]> {
  // `fields.try_map(|field| self.project_field(base, field))`
  const out: P[] = [];
  for (const field of fields) {
    const r = this.project_field(base, field);
    if (r.$ === "Err") return r;
    out.push(r._0);
  }
  return interp_ok(out);
};

/// Downcasting to an enum variant.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:213 project_downcast
InterpCx.prototype.project_downcast = function <P extends Projectable<P>>(this: InterpCx, base: P, variant: VariantIdx): InterpResult<P> {
  assert(!MemPlaceMeta.has_meta(base.meta()), "assertion failed: !base.meta().has_meta()");
  // Downcasts only change the layout.
  // (In particular, no check about whether this is even the active variant -- that's by design,
  // see https://github.com/rust-lang/rust/issues/93688#issuecomment-1032929496.)
  // So we just "offset" by 0.
  const layout = base.layout_().for_variant(this, variant);
  // This variant may in fact be uninhabited.
  // See <https://github.com/rust-lang/rust/issues/120337>.

  // This cannot be `transmute` as variants *can* have a smaller size than the entire enum.
  return base.offset(Size.ZERO, layout, this);
};

/// Equivalent to `project_downcast`, but identifies the variant by name instead of index.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:232 project_downcast_named
InterpCx.prototype.project_downcast_named = function <P extends Projectable<P>>(this: InterpCx, base: P, name: Symbol): InterpResult<[VariantIdx, P]> {
  const variants = unwrap(base.layout_().ty.ty_adt_def()).variants();
  const found = variants.findIndex((var_) => var_.name === name);
  if (found === -1) {
    const dbg = format_debug(variants, (vs: readonly VariantDef[], f) => debug_list(f, vs.map((v) => debug_VariantDef(v, f))), PRETTY);
    return panic(`got ${display_Symbol(name)} but expected one of ${dbg}`);
  }
  const variant_idx = found as VariantIdx;

  const r = this.project_downcast(base, variant_idx);
  if (r.$ === "Err") return r;
  return interp_ok<[VariantIdx, P]>([variant_idx, r._0]);
};

/// Compute the offset and field layout for accessing the given index.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:248 project_index
InterpCx.prototype.project_index = function <P extends Projectable<P>>(this: InterpCx, base: P, index: bigint): InterpResult<P> {
  // Not using the layout method because we want to compute on u64
  let offset: Size;
  let field_layout: TyAndLayout;
  const fields = base.layout_().fields;
  if (fields.$ === "Array") {
    const stride = fields.stride;
    // `count` is nonsense for slices, use the dynamic length instead.
    const len_r = base.len(this);
    if (len_r.$ === "Err") return len_r;
    const len = len_r._0;
    if (index >= len) {
      // This can only be reached in ConstProp and non-rustc-MIR.
      // throw_ub!(BoundsCheckFailed { len, index })
      return bounds_check_failed(len, index);
    }
    // With raw slices, `len` can be so big that this *can* overflow.
    const o = this.compute_size_in_bytes(stride, index);
    if (o === undefined) {
      // err_ub!(PointerArithOverflow)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "PointerArithOverflow" } }));
    }
    offset = o;

    // All fields have the same layout.
    field_layout = base.layout_().field(this, 0);
  } else {
    return span_bug(this.cur_span(), `\`project_index\` called on non-array type ${debug_Ty(base.layout_().ty, PLAIN)}`);
  }

  return base.offset(offset, field_layout, this);
};

/// Converts a repr(simd) value into an array of the right size, such that `project_index`
/// accesses the SIMD elements. Also returns the number of elements.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:283 project_to_simd
InterpCx.prototype.project_to_simd = function <P extends Projectable<P>>(this: InterpCx, base: P): InterpResult<[P, bigint]> {
  assert(unwrap(base.layout_().ty.ty_adt_def()).repr().simd(), "assertion failed: base.layout().ty.ty_adt_def().unwrap().repr().simd()");
  // SIMD types must be newtypes around arrays, so all we have to do is project to their only field.
  const array = this.project_field(base, FieldIdx.ZERO);
  if (array.$ === "Err") return array;
  const len = array._0.len(this);
  if (len.$ === "Err") return len;
  return interp_ok<[P, bigint]>([array._0, len._0]);
};

// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:294 project_constant_index
InterpCx.prototype.project_constant_index = function <P extends Projectable<P>>(this: InterpCx, base: P, offset: bigint, min_length: bigint, from_end: boolean): InterpResult<P> {
  const n_r = base.len(this);
  if (n_r.$ === "Err") return n_r;
  const n = n_r._0;
  if (n < min_length) {
    // This can only be reached in ConstProp and non-rustc-MIR.
    // throw_ub!(BoundsCheckFailed { len: min_length, index: n })
    return bounds_check_failed(min_length, n);
  }

  let index: bigint;
  if (from_end) {
    assert(0n < offset && offset <= min_length, "assertion failed: 0 < offset && offset <= min_length");
    // `n.checked_sub(offset).unwrap()`
    index = unwrap(n >= offset ? n - offset : undefined);
  } else {
    assert(offset < min_length, "assertion failed: offset < min_length");
    index = offset;
  }

  return this.project_index(base, index);
};

/// Iterates over all fields of an array. Much more efficient than doing the
/// same by repeatedly calling `project_index`.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:320 project_array_fields
InterpCx.prototype.project_array_fields = function <P extends Projectable<P>>(this: InterpCx, base: P): InterpResult<ArrayIterator<P>> {
  const fields = base.layout_().fields;
  if (fields.$ !== "Array") {
    return span_bug(this.cur_span(), `project_array_fields: expected an array layout, got ${format_debug(base.layout_(), debug_TyAndLayout_Ty, PRETTY)}`);
  }
  const stride = fields.stride;
  const len_r = base.len(this);
  if (len_r.$ === "Err") return len_r;
  const len = len_r._0;
  const field_layout = base.layout_().field(this, 0);
  // Ensure that all the offsets are in-bounds once, up-front.
  // debug!("project_array_fields: {base:?} {len}");
  const unit_layout = unwrap_result(this.layout_of(this.tcx.deref().types.unit), debug_InterpErrorKind);
  const r = base.offset(Size.u64_mul(len, stride), unit_layout, this);
  if (r.$ === "Err") return r;
  // Create the iterator.
  // PORT: `Range<u64>` is `ArrayIterator.range` (numbers, codegen); `len` passed the in-bounds check above.
  return interp_ok(new ArrayIterator<P>(base, { start: 0, end: Number(len) }, stride, field_layout, undefined));
};

/// Subslicing
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:347 project_subslice
InterpCx.prototype.project_subslice = function <P extends Projectable<P>>(this: InterpCx, base: P, from: bigint, to: bigint, from_end: boolean): InterpResult<P> {
  const len_r = base.len(this); // also asserts that we have a type where this makes sense
  if (len_r.$ === "Err") return len_r;
  const len = len_r._0;
  let actual_to: bigint;
  if (from_end) {
    // `from.checked_add(to).is_none_or(|to| to > len)`
    if (from + to > U64_MAX || from + to > len) {
      // This can only be reached in ConstProp and non-rustc-MIR.
      // throw_ub!(BoundsCheckFailed { len, index: from.saturating_add(to) })
      return bounds_check_failed(len, from + to > U64_MAX ? U64_MAX : from + to);
    }
    // `len.checked_sub(to).unwrap()`
    actual_to = unwrap(len >= to ? len - to : undefined);
  } else {
    actual_to = to;
  }

  // Not using layout method because that works with usize, and does not work with slices
  // (that have count 0 in their layout).
  const fields = base.layout_().fields;
  let from_offset: Size;
  if (fields.$ === "Array") {
    from_offset = fields.stride.mul(from); // `Size` multiplication is checked
  } else {
    return span_bug(this.cur_span(), `unexpected layout of index access: ${format_debug(base.layout_(), debug_TyAndLayout_Ty, PRETTY)}`);
  }

  // Compute meta and new layout
  // `actual_to.checked_sub(from).unwrap()`
  const inner_len = unwrap(actual_to >= from ? actual_to - from : undefined);
  let meta: MemPlaceMeta;
  let ty: Ty;
  const kind = base.layout_().ty.kind();
  switch (kind.$) {
    // It is not nice to match on the type, but that seems to be the only way to
    // implement this.
    case "Array": {
      // PORT: `Ty::new_array` takes the length as a number (ty/decls.ts).
      meta = MemPlaceMeta.None;
      ty = Ty.new_array(this.tcx.tcx, kind._0, Number(inner_len));
      break;
    }
    case "Slice": {
      const len = Scalar.from_target_usize<CtfeProvenance>(inner_len, this);
      meta = { $: "Meta", _0: len };
      ty = base.layout_().ty;
      break;
    }
    default:
      return span_bug(this.cur_span(), `cannot subslice non-array type: \`${debug_Ty(base.layout_().ty, PLAIN)}\``);
  }
  const layout = this.layout_of(ty);
  if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));

  return base.offset_with_meta(from_offset, OffsetMode.Inbounds, meta, layout._0, this);
};

/// Applying a general projection
// #[instrument(skip(self), level = "trace")]
// PORT: `P: From<MPlaceTy>` (for `Deref`) is `P_from_MPlaceTy` above; the `u64` fields of `ConstantIndex` /
// `Subslice` are numbers in mir (syntax.gen.ts) and widen to bigint here.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:405 project
InterpCx.prototype.project = function <P extends Projectable<P>>(this: InterpCx, base: P, proj_elem: PlaceElem): InterpResult<P> {
  // use rustc_middle::mir::ProjectionElem::*;
  let r: InterpResult<P>;
  switch (proj_elem.$) {
    case "OpaqueCast":
      return span_bug(this.cur_span(), `OpaqueCast(${display_Ty(proj_elem._0)}) encountered after borrowck`);
    case "PhantomDeref":
      return span_bug(this.cur_span(), "PhantomDeref encountered after borrowck");
    case "UnwrapUnsafeBinder": {
      const layout = this.layout_of(proj_elem._0);
      if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
      r = base.transmute(layout._0, this);
      break;
    }
    case "Field":
      r = this.project_field(base, proj_elem._0);
      break;
    case "Downcast":
      r = this.project_downcast(base, proj_elem._1);
      break;
    case "Deref": {
      const d = this.deref_pointer(base);
      if (d.$ === "Err") return d;
      r = interp_ok(P_from_MPlaceTy(base, d._0));
      break;
    }
    case "Index": {
      const local = proj_elem._0;
      const layout = this.layout_of(this.tcx.deref().types.usize);
      if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
      const n_op = this.local_to_op(local, layout._0);
      if (n_op.$ === "Err") return n_op;
      const n = this.read_target_usize(n_op._0);
      if (n.$ === "Err") return n;
      r = this.project_index(base, n._0);
      break;
    }
    case "ConstantIndex":
      r = this.project_constant_index(base, BigInt(proj_elem.offset), BigInt(proj_elem.min_length), proj_elem.from_end);
      break;
    case "Subslice":
      r = this.project_subslice(base, BigInt(proj_elem.from), BigInt(proj_elem.to), proj_elem.from_end);
      break;
  }
  if (r.$ === "Err") return r;
  return interp_ok(r._0);
};

/// Given a value of type `Box`, returns the inner value of raw pointer type, as well as
/// the allocator.
// rustc: compiler/rustc_const_eval/src/interpret/projection.rs:436 project_to_ptr_in_box
InterpCx.prototype.project_to_ptr_in_box = function <P extends Projectable<P>>(this: InterpCx, box_: P): InterpResult<[P, P]> {
  // `Box` has two fields: the pointer we care about, and the allocator.
  // `assert_eq!(box_.layout().fields.count(), 2, "`Box` must have exactly 2 fields")`
  const count = FieldsShape.count(box_.layout_().fields);
  if (count !== 2) {
    panic(`assertion \`left == right\` failed: \`Box\` must have exactly 2 fields\n  left: ${count}\n right: 2`);
  }
  const fields = this.project_fields(box_, [FieldIdx.ZERO, FieldIdx.ONE]);
  if (fields.$ === "Err") return fields;
  const [ptr, alloc] = fields._0 as [P, P];

  // We simply transmute the pointer we care about to the underlying raw pointer.
  // (We could project a bit but that would end up at a pattern type that needs a transmute.)
  const pointee_ty = unwrap(box_.layout_().ty.boxed_ty());
  const raw_ptr_ty = Ty.new_ptr(this.tcx.deref(), pointee_ty, "Mut");
  const layout = this.layout_of(raw_ptr_ty);
  if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
  const raw_ptr = ptr.transmute(layout._0, this); // The actual raw pointer
  if (raw_ptr.$ === "Err") return raw_ptr;
  return interp_ok<[P, P]>([raw_ptr._0, alloc]);
};
