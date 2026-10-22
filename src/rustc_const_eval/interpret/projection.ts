// Port of compiler/rustc_const_eval/src/interpret/projection.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type FieldIdx, type Size, type VariantIdx } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { MemPlaceMeta } from "./place.ts";
import { ArrayIterator, OffsetMode } from "./projection.gen.ts";
import { type CtfeProvenance, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type PlaceElem } from "../../rustc_middle/mir/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";

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
  // stub: compiler/rustc_const_eval/src/interpret/projection.rs:43 len (lane interp-ops)
  len<Self>(self: Projectable<Self>, ecx: InterpCx): InterpResult<bigint> {
    return unported("rustc_const_eval::interpret::projection::Projectable::len");
  },

  // stub: compiler/rustc_const_eval/src/interpret/projection.rs:74 offset (lane interp-ops)
  offset<Self>(self: Projectable<Self>, offset: Size, layout: TyAndLayout, ecx: InterpCx): InterpResult<Self> {
    return unported("rustc_const_eval::interpret::projection::Projectable::offset");
  },

  /// This does an offset-by-zero, which is effectively a transmute. Note however that
  /// not all transmutes are supported by all projectables -- specifically, if this is an
  /// `OpTy` or `ImmTy`, the new layout must have almost the same ABI as the old one
  /// (only changing the `valid_range` is allowed and turning integers into pointers).
  // stub: compiler/rustc_const_eval/src/interpret/projection.rs:90 transmute (lane interp-ops)
  transmute<Self>(self: Projectable<Self>, layout: TyAndLayout, ecx: InterpCx): InterpResult<Self> {
    return unported("rustc_const_eval::interpret::projection::Projectable::transmute");
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

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:119 next (lane interp-ops)
ArrayIterator.prototype.next = function <P>(this: ArrayIterator<P>, ecx: InterpCx): InterpResult<[bigint, P] | undefined> {
  return unported("rustc_const_eval::interpret::projection::ArrayIterator::next");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:150 project_field (lane interp-ops)
InterpCx.prototype.project_field = function <P extends Projectable<P>>(this: InterpCx, base: P, field: FieldIdx): InterpResult<P> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_field");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:204 project_fields (lane interp-ops)
InterpCx.prototype.project_fields = function <P extends Projectable<P>>(this: InterpCx, base: P, fields: readonly FieldIdx[]): InterpResult<P[]> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_fields");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:213 project_downcast (lane interp-ops)
InterpCx.prototype.project_downcast = function <P extends Projectable<P>>(this: InterpCx, base: P, variant: VariantIdx): InterpResult<P> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_downcast");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:232 project_downcast_named (lane interp-ops)
InterpCx.prototype.project_downcast_named = function <P extends Projectable<P>>(this: InterpCx, base: P, name: Symbol): InterpResult<[VariantIdx, P]> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_downcast_named");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:248 project_index (lane interp-ops)
InterpCx.prototype.project_index = function <P extends Projectable<P>>(this: InterpCx, base: P, index: bigint): InterpResult<P> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_index");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:283 project_to_simd (lane interp-ops)
InterpCx.prototype.project_to_simd = function <P extends Projectable<P>>(this: InterpCx, base: P): InterpResult<[P, bigint]> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_to_simd");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:294 project_constant_index (lane interp-ops)
InterpCx.prototype.project_constant_index = function <P extends Projectable<P>>(this: InterpCx, base: P, offset: bigint, min_length: bigint, from_end: boolean): InterpResult<P> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_constant_index");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:320 project_array_fields (lane interp-ops)
InterpCx.prototype.project_array_fields = function <P extends Projectable<P>>(this: InterpCx, base: P): InterpResult<ArrayIterator<P>> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_array_fields");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:347 project_subslice (lane interp-ops)
InterpCx.prototype.project_subslice = function <P extends Projectable<P>>(this: InterpCx, base: P, from: bigint, to: bigint, from_end: boolean): InterpResult<P> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_subslice");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:405 project (lane interp-ops)
InterpCx.prototype.project = function <P extends Projectable<P>>(this: InterpCx, base: P, proj_elem: PlaceElem): InterpResult<P> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project");
};

// stub: compiler/rustc_const_eval/src/interpret/projection.rs:436 project_to_ptr_in_box (lane interp-ops)
InterpCx.prototype.project_to_ptr_in_box = function <P extends Projectable<P>>(this: InterpCx, box_: P): InterpResult<[P, P]> {
  return unported("rustc_const_eval::interpret::projection::InterpCx::project_to_ptr_in_box");
};
