//! Computations on places -- field projections, going from mir::Place, and writing
//! into a place.
//! All high-level functions to write to memory work on places as destinations.
// Port of compiler/rustc_const_eval/src/interpret/place.rs (declared by lane interp-contract, filled by lane
// interp-place-operand, plan-m4 wave 23c). Representation notes: interpret/eval_context.ts's header and
// docs/handoff/interp-contract.md.
import { type HasDataLayout, Size, Scalar as abi_Scalar, debug_Size } from "../../rustc_abi/lib.ts";
import { InterpCx, mir_assign_valid_types } from "./eval_context.ts";
import { type CtfeMemoryKind, type Machine } from "./machine.ts";
import { AllocRef, AllocRefMut } from "./memory.ts";
import { MemoryKind } from "./memory.gen.ts";
import { Immediate, assert_matches_none, OpTy_from_MPlaceTy, size_eq } from "./operand.ts";
import { MPlaceTy, MemPlace, PlaceTy, type Place, debug_MemPlace, debug_Place } from "./place.gen.ts";
import { OffsetMode, type Projectable } from "./projection.ts";
import {
  AllocInit,
  CheckAlignMsg,
  type CtfeProvenance,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  type InterpResult,
  InterpResult as InterpResultC,
  Pointer,
  Pointer_from_AllocId,
  Pointer_Option_from_Pointer,
  Provenance_CtfeProvenance,
  Scalar,
  alloc_range,
  debug_InterpErrorKind,
  interp_ok,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type ConstAlloc, type Either, type Local, type Place as mir_Place } from "../../rustc_middle/mir/mod.ts";
import { type TyAndLayout, debug_TyAndLayout_Ty } from "../../rustc_middle/ty/layout.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { type Fmt, PLAIN, PRETTY, debug_option, debug_struct } from "../../std/fmt.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { assert, assert_eq, panic } from "../../std/panic.ts";
import { Err, unwrap_result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import * as gen from "./place.gen.ts";

export * from "./place.gen.ts";

const debug_size = (v: Size): string => debug_Size(v, PLAIN);

/** PORT: the key of `MPlaceTy`'s derived `Hash` + `Eq` (struct-keyed maps and sets of places, e.g. valtrees.rs's
 * `visited` / `settled` and `RefTracking::seen`): every field by value, interned children (`Ty`, `Layout`) by identity
 * (rust_ts/intern_key.ts). */
export function key_MPlaceTy(p: MPlaceTy): string {
  return intern_key(p);
}

declare module "./place.gen.ts" {
  interface MemPlace {
    // place.rs:67 (lane interp-place-operand)
    map_provenance(f: (a0: CtfeProvenance) => CtfeProvenance): MemPlace;
    // place.rs:73 (lane interp-place-operand)
    to_ref(cx: HasDataLayout): Immediate;
    // place.rs:79 (lane interp-place-operand)
    offset_with_meta_(offset: Size, mode: OffsetMode, meta: MemPlaceMeta, ecx: InterpCx): InterpResult<MemPlace>;
  }
}

declare module "./place.gen.ts" {
  namespace MPlaceTy {
    // place.rs:122 (lane interp-place-operand)
    function fake_alloc_zst(layout: TyAndLayout): MPlaceTy;
  }
}

declare module "./place.gen.ts" {
  interface MPlaceTy {
    // place.rs:130 (lane interp-place-operand)
    map_provenance(f: (a0: CtfeProvenance) => CtfeProvenance): MPlaceTy;
    // place.rs:135 (lane interp-place-operand)
    mplace_(): MemPlace;
    // place.rs:140 (lane interp-place-operand)
    ptr(): Pointer<CtfeProvenance | undefined>;
    // place.rs:145 (lane interp-place-operand)
    to_ref(cx: HasDataLayout): Immediate;
    // place.rs:152 (lane interp-place-operand)
    layout_(): TyAndLayout;
    // place.rs:157 (lane interp-place-operand)
    meta(): MemPlaceMeta;
    // place.rs:161 (lane interp-place-operand)
    offset_with_meta(offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<MPlaceTy>;
    // place.rs:176 (lane interp-place-operand)
    to_op(_ecx: InterpCx): InterpResult<OpTy>;
    // place.rs:373 (lane interp-place-operand)
    to_place(): PlaceTy;
    // place.rs:378 (lane interp-place-operand)
    force_mplace(_ecx: InterpCx): InterpResult<MPlaceTy>;
  }
}

declare module "./place.gen.ts" {
  interface PlaceTy extends Writeable<PlaceTy> {
    // place.rs:234 (lane interp-place-operand)
    place_(): Place;
    // place.rs:246 (lane interp-place-operand)
    as_mplace_or_local(): Either<MPlaceTy, [Local, Size | undefined, number, TyAndLayout]>;
    // place.rs:259 (lane interp-place-operand)
    assert_mem_place(): MPlaceTy;
    // place.rs:271 (lane interp-place-operand)
    layout_(): TyAndLayout;
    // place.rs:276 (lane interp-place-operand)
    meta(): MemPlaceMeta;
    // place.rs:286 (lane interp-place-operand)
    offset_with_meta(offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<PlaceTy>;
    // place.rs:316 (lane interp-place-operand)
    to_op(ecx: InterpCx): InterpResult<OpTy>;
    // place.rs:358 (lane interp-place-operand)
    to_place(): PlaceTy;
    // place.rs:363 (lane interp-place-operand)
    force_mplace(ecx: InterpCx): InterpResult<MPlaceTy>;
  }
}

declare module "./operand.gen.ts" {
  interface OpTy {
    // place.rs:327 (lane interp-place-operand)
    as_mplace_or_imm(): Either<MPlaceTy, ImmTy>;
    // place.rs:336 (lane interp-place-operand)
    assert_mem_place(): MPlaceTy;
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // place.rs:392 (lane interp-place-operand)
    ptr_with_meta_to_mplace(ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, layout: TyAndLayout, unaligned: boolean): MPlaceTy;
    // place.rs:404 (lane interp-place-operand)
    ptr_to_mplace(ptr: Pointer<CtfeProvenance | undefined>, layout: TyAndLayout): MPlaceTy;
    // place.rs:413 (lane interp-place-operand)
    ptr_to_mplace_unaligned(ptr: Pointer<CtfeProvenance | undefined>, layout: TyAndLayout): MPlaceTy;
    // place.rs:428 (lane interp-place-operand)
    imm_ptr_to_mplace(val: ImmTy): InterpResult<MPlaceTy>;
    // place.rs:450 (lane interp-place-operand)
    mplace_to_imm_ptr(mplace: MPlaceTy, ptr_ty: Ty | undefined): InterpResult<ImmTy>;
    // place.rs:469 (lane interp-place-operand)
    deref_pointer(src: Projectable): InterpResult<MPlaceTy>;
    // place.rs:542 (lane interp-place-operand)
    get_place_alloc(mplace: MPlaceTy): InterpResult<AllocRef | undefined>;
    // place.rs:558 (lane interp-place-operand)
    get_place_alloc_mut(mplace: MPlaceTy): InterpResult<AllocRefMut | undefined>;
    // place.rs:576 (lane interp-place-operand)
    local_to_place(local: Local): InterpResult<PlaceTy>;
    // place.rs:601 (lane interp-place-operand)
    eval_place(mir_place: mir_Place, skip_validity_for_simple_deref: boolean): InterpResult<PlaceTy>;
    // place.rs:650 (lane interp-place-operand)
    as_mplace_or_mutable_local(place: PlaceTy): InterpResult<Either<MPlaceTy, [MutRef<Immediate>, TyAndLayout, Local]>>;
    // place.rs:688 (lane interp-place-operand)
    write_immediate(src: Immediate, dest: Writeable): InterpResult;
    // place.rs:710 (lane interp-place-operand)
    write_scalar(val: Scalar, dest: Writeable): InterpResult;
    // place.rs:720 (lane interp-place-operand)
    write_pointer(ptr: Pointer<CtfeProvenance | undefined>, dest: Writeable): InterpResult;
    // place.rs:731 (lane interp-place-operand)
    write_immediate_no_validate(src: Immediate, dest: Writeable): InterpResult;
    // place.rs:767 (lane interp-place-operand)
    write_immediate_to_mplace_no_validate(value: Immediate, layout: TyAndLayout, dest: MemPlace): InterpResult;
    // place.rs:827 (lane interp-place-operand)
    write_uninit(dest: Writeable): InterpResult;
    // place.rs:851 (lane interp-place-operand)
    clear_provenance(dest: Writeable): InterpResult;
    // place.rs:884 (lane interp-place-operand)
    copy_op_allow_transmute(src: Projectable, dest: Writeable): InterpResult;
    // place.rs:895 (lane interp-place-operand)
    copy_op(src: Projectable, dest: Writeable): InterpResult;
    // place.rs:912 (lane interp-place-operand)
    copy_op_inner(src: Projectable, dest: Writeable, allow_transmute: boolean): InterpResult;
    // place.rs:951 (lane interp-place-operand)
    copy_op_no_validate(src: Projectable, dest: Writeable, allow_transmute: boolean): InterpResult;
    // place.rs:1058 (lane interp-place-operand)
    force_allocation(place: PlaceTy): InterpResult<MPlaceTy>;
    // place.rs:1115 (lane interp-place-operand)
    allocate_dyn(layout: TyAndLayout, kind: MemoryKind<CtfeMemoryKind>, meta: MemPlaceMeta): InterpResult<MPlaceTy>;
    // place.rs:1128 (lane interp-place-operand)
    allocate(layout: TyAndLayout, kind: MemoryKind<CtfeMemoryKind>): InterpResult<MPlaceTy>;
    // place.rs:1139 (lane interp-place-operand)
    allocate_bytes_dedup(bytes: Uint8Array): InterpResult<Pointer>;
    // place.rs:1156 (lane interp-place-operand)
    allocate_str_dedup(s: string): InterpResult<MPlaceTy>;
    // place.rs:1178 (lane interp-place-operand)
    raw_const_to_mplace(raw: ConstAlloc): InterpResult<MPlaceTy>;
  }
}

export interface MemPlaceMeta_methods {
  // place.rs:35 (lane interp-place-operand)
  unwrap_meta(self: MemPlaceMeta): Scalar;
  // place.rs:45 (lane interp-place-operand)
  has_meta(self: MemPlaceMeta): boolean;
}
export type MemPlaceMeta = gen.MemPlaceMeta;
export const MemPlaceMeta = gen.MemPlaceMeta as typeof gen.MemPlaceMeta & MemPlaceMeta_methods;

/// A place that can be written to.
// pub trait Writeable<'tcx, Prov: Provenance>: Projectable<'tcx, Prov>
// PORT: an interface implemented by the prototypes of `PlaceTy` and `MPlaceTy` (projection.ts's `Projectable` notes).
export interface Writeable<Self = unknown> extends Projectable<Self> {
  // rustc: compiler/rustc_const_eval/src/interpret/place.rs:348 to_place
  to_place(): PlaceTy;
  // rustc: compiler/rustc_const_eval/src/interpret/place.rs:350 force_mplace
  force_mplace(ecx: InterpCx): InterpResult<MPlaceTy>;
}


// rustc: compiler/rustc_const_eval/src/interpret/place.rs:35 unwrap_meta
MemPlaceMeta.unwrap_meta = function (self: MemPlaceMeta): Scalar {
  switch (self.$) {
    case "Meta":
      return self._0;
    case "None":
      return bug("expected wide pointer extra data (e.g. slice length or trait object vtable)");
  }
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:45 has_meta
MemPlaceMeta.has_meta = function (self: MemPlaceMeta): boolean {
  switch (self.$) {
    case "Meta":
      return true;
    case "None":
      return false;
  }
};

/// Adjust the provenance of the main pointer (metadata is unaffected).
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:67 map_provenance
MemPlace.prototype.map_provenance = function (this: MemPlace, f: (a0: CtfeProvenance) => CtfeProvenance): MemPlace {
  return new MemPlace(
    this.ptr.map_provenance((p) => (p === undefined ? undefined : f(p))),
    this.meta,
    this.misaligned,
  );
};

/// Turn a mplace into a (thin or wide) pointer, as a reference, pointing to the same space.
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:73 to_ref
MemPlace.prototype.to_ref = function (this: MemPlace, cx: HasDataLayout): Immediate {
  return Immediate.new_pointer_with_meta(this.ptr, this.meta, cx);
};

// #[inline]
// Not called `offset_with_meta` to avoid confusion with the trait method.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:79 offset_with_meta_
MemPlace.prototype.offset_with_meta_ = function (this: MemPlace, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, ecx: InterpCx): InterpResult<MemPlace> {
  // debug_assert!(
  //     !meta.has_meta() || self.meta.has_meta(),
  //     "cannot use `offset_with_meta` to add metadata to a place"
  // );
  let ptr: Pointer<CtfeProvenance | undefined>;
  switch (mode) {
    case "Inbounds": {
      // `offset.bytes().try_into().unwrap()`: a `Size` (< 2^53) always fits an `i64`.
      const r = ecx.ptr_offset_inbounds(this.ptr, BigInt(offset.bytes()));
      if (r.$ === "Err") return r;
      ptr = r._0;
      break;
    }
    case "Wrapping":
      ptr = this.ptr.wrapping_offset(offset, ecx);
      break;
  }
  return interp_ok(new MemPlace(ptr, meta, this.misaligned));
};

// impl Debug for MPlaceTy
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:108 fmt
export function debug_MPlaceTy(self: MPlaceTy, f: Fmt): string {
  // Printing `layout` results in too much noise; just print a nice version of the type.
  return debug_struct(f, "MPlaceTy", [
    ["mplace", debug_MemPlace(self.mplace, f)],
    ["ty", display_Ty(self.layout.ty)],
  ]);
}

/// Produces a MemPlace that works for ZST but nothing else.
/// Conceptually this is a new allocation, but it doesn't actually create an allocation so you
/// don't need to worry about memory leaks.
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:122 fake_alloc_zst
(MPlaceTy as { fake_alloc_zst: typeof MPlaceTy.fake_alloc_zst }).fake_alloc_zst = function (layout: TyAndLayout): MPlaceTy {
  assert(layout.is_zst(), "assertion failed: layout.is_zst()");
  const align = layout.align.abi;
  const ptr = Pointer.without_provenance<CtfeProvenance>(BigInt(align.bytes())); // no provenance, absolute address
  return new MPlaceTy(new MemPlace(ptr, MemPlaceMeta.None, undefined), layout);
};

/// Adjust the provenance of the main pointer (metadata is unaffected).
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:130 map_provenance
MPlaceTy.prototype.map_provenance = function (this: MPlaceTy, f: (a0: CtfeProvenance) => CtfeProvenance): MPlaceTy {
  return new MPlaceTy(this.mplace.map_provenance(f), this.layout);
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:135 mplace
MPlaceTy.prototype.mplace_ = function (this: MPlaceTy): MemPlace {
  return this.mplace;
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:140 ptr
MPlaceTy.prototype.ptr = function (this: MPlaceTy): Pointer<CtfeProvenance | undefined> {
  return this.mplace.ptr;
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:145 to_ref
MPlaceTy.prototype.to_ref = function (this: MPlaceTy, cx: HasDataLayout): Immediate {
  return this.mplace.to_ref(cx);
};

// impl Projectable for MPlaceTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:152 layout
MPlaceTy.prototype.layout_ = function (this: MPlaceTy): TyAndLayout {
  return this.layout;
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:157 meta
MPlaceTy.prototype.meta = function (this: MPlaceTy): MemPlaceMeta {
  return this.mplace.meta;
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:161 offset_with_meta
MPlaceTy.prototype.offset_with_meta = function (this: MPlaceTy, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<MPlaceTy> {
  const r = this.mplace.offset_with_meta_(offset, mode, meta, ecx);
  if (r.$ === "Err") return r;
  return interp_ok(new MPlaceTy(r._0, layout));
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:176 to_op
MPlaceTy.prototype.to_op = function (this: MPlaceTy, _ecx: InterpCx): InterpResult<OpTy> {
  return interp_ok(OpTy_from_MPlaceTy(this));
};

// impl Debug for PlaceTy
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:216 fmt
export function debug_PlaceTy(self: PlaceTy, f: Fmt): string {
  // Printing `layout` results in too much noise; just print a nice version of the type.
  return debug_struct(f, "PlaceTy", [
    ["place", debug_Place(self.place, f)],
    ["ty", display_Ty(self.layout.ty)],
  ]);
}

// impl From<MPlaceTy<'tcx, Prov>> for PlaceTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:227 from
export function PlaceTy_from_MPlaceTy(mplace: MPlaceTy): PlaceTy {
  return new PlaceTy({ $: "Ptr", _0: mplace.mplace }, mplace.layout);
}

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:234 place
PlaceTy.prototype.place_ = function (this: PlaceTy): Place {
  return this.place;
};

/// A place is either an mplace or some local.
///
/// Note that the return value can be different even for logically identical places!
/// Specifically, if a local is stored in-memory, this may return `Local` or `MPlaceTy`
/// depending on how the place was constructed. In other words, seeing `Local` here does *not*
/// imply that this place does not point to memory. Every caller must therefore always handle
/// both cases.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:246 as_mplace_or_local
PlaceTy.prototype.as_mplace_or_local = function (this: PlaceTy): Either<MPlaceTy, [Local, Size | undefined, number, TyAndLayout]> {
  const place = this.place;
  switch (place.$) {
    case "Ptr":
      return { $: "Left", _0: new MPlaceTy(place._0, this.layout) };
    case "Local": {
      const { local, offset, locals_addr } = place;
      return { $: "Right", _0: [local, offset, locals_addr, this.layout] };
    }
  }
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:259 assert_mem_place
PlaceTy.prototype.assert_mem_place = function (this: PlaceTy): MPlaceTy {
  const e = this.as_mplace_or_local();
  if (e.$ === "Left") return e._0;
  return bug(`PlaceTy of type ${display_Ty(this.layout.ty)} was a local when it was expected to be an MPlace`);
};

// impl Projectable for PlaceTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:271 layout
PlaceTy.prototype.layout_ = function (this: PlaceTy): TyAndLayout {
  return this.layout;
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:276 meta
PlaceTy.prototype.meta = function (this: PlaceTy): MemPlaceMeta {
  const e = this.as_mplace_or_local();
  switch (e.$) {
    case "Left":
      return e._0.meta();
    case "Right":
      // debug_assert!(self.layout.is_sized(), "unsized locals should live in memory");
      return MemPlaceMeta.None;
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:286 offset_with_meta
PlaceTy.prototype.offset_with_meta = function (this: PlaceTy, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<PlaceTy> {
  const e = this.as_mplace_or_local();
  switch (e.$) {
    case "Left": {
      const r = e._0.offset_with_meta(offset, mode, meta, layout, ecx);
      if (r.$ === "Err") return r;
      return interp_ok(PlaceTy_from_MPlaceTy(r._0));
    }
    case "Right": {
      const [local, old_offset, locals_addr] = e._0;
      // debug_assert!(layout.is_sized(), "unsized locals should live in memory");
      assert_matches_none(meta); // we couldn't store it anyway...
      // `Place::Local` are always in-bounds of their surrounding local, so we can just
      // check directly if this remains in-bounds. This cannot actually be violated since
      // projections are type-checked and bounds-checked.
      assert(offset.add(layout.size).bytes() <= this.layout.size.bytes(), "assertion failed: offset + layout.size <= self.layout.size");

      // Size `+`, ensures no overflow.
      const new_offset = (old_offset ?? Size.ZERO).add(offset);

      return interp_ok(new PlaceTy({ $: "Local", local, offset: new_offset, locals_addr }, layout));
    }
  }
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:316 to_op
PlaceTy.prototype.to_op = function (this: PlaceTy, ecx: InterpCx): InterpResult<OpTy> {
  return ecx.place_to_op(this);
};

// These are defined here because they produce a place.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:327 as_mplace_or_imm
OpTy.prototype.as_mplace_or_imm = function (this: OpTy): Either<MPlaceTy, ImmTy> {
  const op = this.op_();
  switch (op.$) {
    case "Indirect":
      return { $: "Left", _0: new MPlaceTy(op._0, this.layout) };
    case "Immediate":
      return { $: "Right", _0: ImmTy.from_immediate(op._0, this.layout) };
  }
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:336 assert_mem_place
OpTy.prototype.assert_mem_place = function (this: OpTy): MPlaceTy {
  const e = this.as_mplace_or_imm();
  if (e.$ === "Left") return e._0;
  return bug(`OpTy of type ${display_Ty(this.layout.ty)} was immediate when it was expected to be an MPlace`);
};

// impl Writeable for PlaceTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:358 to_place
PlaceTy.prototype.to_place = function (this: PlaceTy): PlaceTy {
  // PORT: `self.clone()`: `PlaceTy` values are never mutated in place (eval_context.ts header), so the value is shared.
  return this;
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:363 force_mplace
PlaceTy.prototype.force_mplace = function (this: PlaceTy, ecx: InterpCx): InterpResult<MPlaceTy> {
  return ecx.force_allocation(this);
};

// impl Writeable for MPlaceTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:373 to_place
MPlaceTy.prototype.to_place = function (this: MPlaceTy): PlaceTy {
  return PlaceTy_from_MPlaceTy(this);
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:378 force_mplace
MPlaceTy.prototype.force_mplace = function (this: MPlaceTy, _ecx: InterpCx): InterpResult<MPlaceTy> {
  // PORT: `self.clone()` (shared, as `to_place` above).
  return interp_ok(this);
};

// FIXME: Working around https://github.com/rust-lang/rust/issues/54385
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:392 ptr_with_meta_to_mplace
InterpCx.prototype.ptr_with_meta_to_mplace = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, layout: TyAndLayout, unaligned: boolean): MPlaceTy {
  const misaligned = unaligned ? undefined : this.is_ptr_misaligned(ptr, layout.align.abi);
  return new MPlaceTy(new MemPlace(ptr, meta, misaligned), layout);
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:404 ptr_to_mplace
InterpCx.prototype.ptr_to_mplace = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, layout: TyAndLayout): MPlaceTy {
  assert(layout.is_sized(), "assertion failed: layout.is_sized()");
  return this.ptr_with_meta_to_mplace(ptr, MemPlaceMeta.None, layout, /*unaligned*/ false);
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:413 ptr_to_mplace_unaligned
InterpCx.prototype.ptr_to_mplace_unaligned = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, layout: TyAndLayout): MPlaceTy {
  assert(layout.is_sized(), "assertion failed: layout.is_sized()");
  return this.ptr_with_meta_to_mplace(ptr, MemPlaceMeta.None, layout, /*unaligned*/ true);
};

/// Take a value, which represents a (thin or wide) pointer, and make it a place.
/// Alignment is just based on the type. This is the inverse of `mplace_to_imm_ptr()`.
///
/// Only call this if you are sure the place is "valid" (aligned and inbounds), or do not
/// want to ever use the place for memory access!
/// Generally prefer `deref_pointer`.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:428 imm_ptr_to_mplace
InterpCx.prototype.imm_ptr_to_mplace = function (this: InterpCx, val: ImmTy): InterpResult<MPlaceTy> {
  const pointee_type = val.layout.ty.builtin_deref(true);
  if (pointee_type === undefined) return panic("`imm_ptr_to_mplace` called on non-ptr type");
  const lr = this.layout_of(pointee_type);
  if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
  const layout = lr._0;
  const [ptr, meta] = Immediate.to_scalar_and_meta(val.deref());

  // `imm_ptr_to_mplace` is called on raw pointers even if they don't actually get dereferenced;
  // we hence can't call `size_and_align_of` since that asserts more validity than we want.
  const ptr_ = Scalar.to_pointer(ptr, this);
  return interp_ok(this.ptr_with_meta_to_mplace(ptr_, meta, layout, /*unaligned*/ false));
};

/// Turn a mplace into a (thin or wide) mutable raw pointer, pointing to the same space.
///
/// `align` information is lost!
/// This is the inverse of `imm_ptr_to_mplace`.
///
/// If `ptr_ty` is provided, the resulting pointer will be of that type. Otherwise, it defaults to `*mut _`.
/// `ptr_ty` must be a type with builtin deref which derefs to the type of `mplace` (`mplace.layout.ty`).
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:450 mplace_to_imm_ptr
InterpCx.prototype.mplace_to_imm_ptr = function (this: InterpCx, mplace: MPlaceTy, ptr_ty: Ty | undefined): InterpResult<ImmTy> {
  const imm = mplace.mplace.to_ref(this);

  if (ptr_ty !== undefined) {
    assert_eq(ptr_ty.builtin_deref(true), mplace.layout.ty as Ty | undefined, (v) => debug_option(v, PLAIN, debug_Ty));
  }
  const ptr_ty_ = ptr_ty ?? Ty.new_mut_ptr(this.tcx.tcx, mplace.layout.ty);

  const lr = this.layout_of(ptr_ty_);
  if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
  return interp_ok(ImmTy.from_immediate(imm, lr._0));
};

/// Take an operand, representing a pointer, and dereference it to a place.
/// Corresponds to the `*` operator in Rust.
/// Unlike `imm_ptr_to_mplace`, this checks that the pointer is valid for its type.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:469 deref_pointer
InterpCx.prototype.deref_pointer = function (this: InterpCx, src: Projectable): InterpResult<MPlaceTy> {
  const ptr_ty = src.layout_().ty;
  if (!(ptr_ty.is_ref() || ptr_ty.is_raw_ptr() || ptr_ty.is_box_global(this.tcx.deref()))) {
    bug(`dereferencing ${display_Ty(src.layout_().ty)}`);
  }

  const vr = this.read_immediate(src);
  if (vr.$ === "Err") return vr;
  const val = vr._0;
  // Construct a place for that pointer.
  // trace!("deref to {} on {:?}", val.layout.ty, *val);
  const mr = this.imm_ptr_to_mplace(val);
  if (mr.$ === "Err") return mr;
  const mplace = mr._0;

  if (this.machine.enforce_validity(this, val.layout)) {
    // This is conceptually a typed load from `src` to get the pointer. Most of the time when
    // we do typed loads for primitive operations, all relevant invariants are checked
    // implicitly, e.g. when we call `to_bool()` on a Boolean.
    // But here, we do need to specifically check for metadata validity, null, alignment, and
    // dereferenceability, or they will not be checked anywhere at all.
    // This duplicates some of the logic in the validity check, but so far we found no
    // good way to share that logic.
    if (ptr_ty.is_ref() || ptr_ty.is_box()) {
      const kind = ptr_ty.is_ref() ? "reference" : "box";

      // Null check.
      const scalar_ptr = Scalar.from_maybe_pointer(mplace.ptr(), this);
      const nr = this.scalar_may_be_null(scalar_ptr);
      if (nr.$ === "Err") return nr;
      if (nr._0) {
        const maybe = !Provenance_CtfeProvenance.OFFSET_IS_ADDR && scalar_ptr.$ === "Ptr";
        // throw_ub_format!("dereferencing a {maybe}null {kind}", maybe = if maybe { "maybe-" } else { "" })
        return Err(
          InterpErrorInfo_from_InterpErrorKind({
            $: "UndefinedBehavior",
            _0: { $: "Ub", _0: `dereferencing a ${maybe ? "maybe-" : ""}null ${kind}` },
          }),
        );
      }

      // Dereferencability and alignment check. This also implicitly checks metadata validity.
      const sr = this.size_and_align_of_val(mplace);
      if (sr.$ === "Err") return sr;
      const [size, align] = sr._0 ?? [mplace.layout.size, mplace.layout.align.abi];
      const ar = this.check_ptr_access(mplace.ptr(), size, { $: "Dereferenceable", _0: kind });
      if (ar.$ === "Err") return ar;
      const lr = InterpResultC.map_err_kind(this.check_ptr_align(mplace.ptr(), align), (err): InterpErrorKind => {
        if (!(err.$ === "UndefinedBehavior" && err._0.$ === "AlignmentCheckFailed")) return bug();
        const { required, has } = err._0._0;
        // err_ub_format!(..)
        return {
          $: "UndefinedBehavior",
          _0: {
            $: "Ub",
            _0: `encountered an unaligned ${kind} (required ${required.bytes()} byte alignment but found ${has.bytes()})`,
          },
        };
      });
      if (lr.$ === "Err") return lr;
    } else {
      assert(ptr_ty.is_raw_ptr(), "assertion failed: ptr_ty.is_raw_ptr()");
      // For raw pointers, the validity invariant is pretty weak, but we do require the vtable
      // to make sense, so we do have to check that if there is one.
      if (mplace.layout.is_unsized()) {
        const tail = this.tcx.deref().struct_tail_for_codegen(mplace.layout.ty, this.typing_env);
        const tk = tail.kind();
        switch (tk.$) {
          case "Dynamic": {
            const data = tk._0;
            const vtable = Scalar.to_pointer(MemPlaceMeta.unwrap_meta(mplace.meta()), this);
            const r = this.get_ptr_vtable_ty(vtable, data);
            if (r.$ === "Err") return r;
            break;
          }
          case "Slice":
          case "Str":
          case "Foreign":
            // Nothing to check (`read_immediate` already ensured initialization).
            break;
          default:
            bug(`Unexpected unsized type tail: ${debug_Ty(tail, PLAIN)}`);
        }
      }
    }
  }

  return interp_ok(mplace);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:542 get_place_alloc
InterpCx.prototype.get_place_alloc = function (this: InterpCx, mplace: MPlaceTy): InterpResult<AllocRef | undefined> {
  const sr = this.size_and_align_of_val(mplace);
  if (sr.$ === "Err") return sr;
  const [size, _align] = sr._0 ?? [mplace.layout.size, mplace.layout.align.abi];
  // We check alignment separately, and *after* checking everything else.
  // If an access is both OOB and misaligned, we want to see the bounds error.
  const a = this.get_ptr_alloc(mplace.ptr(), size);
  if (a.$ === "Err") return a;
  const m = this.check_misalign(mplace.mplace.misaligned, CheckAlignMsg.BasedOn);
  if (m.$ === "Err") return m;
  return interp_ok(a._0);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:558 get_place_alloc_mut
InterpCx.prototype.get_place_alloc_mut = function (this: InterpCx, mplace: MPlaceTy): InterpResult<AllocRefMut | undefined> {
  const sr = this.size_and_align_of_val(mplace);
  if (sr.$ === "Err") return sr;
  const [size, _align] = sr._0 ?? [mplace.layout.size, mplace.layout.align.abi];
  // We check alignment separately, and raise that error *after* checking everything else.
  // If an access is both OOB and misaligned, we want to see the bounds error.
  // However we have to call `check_misalign` first to make the borrow checker happy.
  const misalign_res = this.check_misalign(mplace.mplace.misaligned, CheckAlignMsg.BasedOn);
  // An error from get_ptr_alloc_mut takes precedence.
  const r = InterpResultC.and(this.get_ptr_alloc_mut(mplace.ptr(), size), misalign_res);
  if (r.$ === "Err") return r;
  const [a] = r._0;
  return interp_ok(a);
};

/// Turn a local in the current frame into a place.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:576 local_to_place
InterpCx.prototype.local_to_place = function (this: InterpCx, local: Local): InterpResult<PlaceTy> {
  const frame = this.frame();
  const lr = this.layout_of_local(frame, local, undefined);
  if (lr.$ === "Err") return lr;
  const layout = lr._0;
  let place: Place;
  if (layout.is_sized()) {
    // We can just always use the `Local` for sized values.
    place = { $: "Local", local, offset: undefined, locals_addr: frame.locals_addr() };
  } else {
    // Other parts of the system rely on `Place::Local` never being unsized.
    const ar = frame.locals[local]!.access();
    if (ar.$ === "Err") return ar;
    const op = ar._0;
    switch (op.$) {
      case "Immediate":
        return bug();
      case "Indirect":
        place = { $: "Ptr", _0: op._0 };
        break;
    }
  }
  return interp_ok(new PlaceTy(place, layout));
};

/// Computes a place. You should only use this if you intend to write into this
/// place; for reading, a more efficient alternative is `eval_place_to_op`.
///
/// If `skip_validity_for_simple_deref` is true, then we do not check validity of the inner
/// pointer for places of the form `*ptr`. The caller must justify why that is okay.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:601 eval_place
InterpCx.prototype.eval_place = function (this: InterpCx, mir_place: mir_Place, skip_validity_for_simple_deref: boolean): InterpResult<PlaceTy> {
  // let _trace = enter_trace_span!(M, step::eval_place, ?mir_place, tracing_separate_thread = Empty);

  const pr = this.local_to_place(mir_place.local);
  if (pr.$ === "Err") return pr;
  let place = pr._0;
  if (skip_validity_for_simple_deref && mir_place.projection.length === 1 && mir_place.projection[0]!.$ === "Deref") {
    // We want to skip the checks in `deref_pointer`.
    const vr = this.read_immediate(place);
    if (vr.$ === "Err") return vr;
    const mr = this.imm_ptr_to_mplace(vr._0);
    if (mr.$ === "Err") return mr;
    return interp_ok(PlaceTy_from_MPlaceTy(mr._0));
  }
  // Using `try_fold` turned out to be bad for performance, hence the loop.
  for (const elem of mir_place.projection) {
    const r = this.project(place, elem);
    if (r.$ === "Err") return r;
    place = r._0;
  }

  // trace!("{:?}", self.dump_place(&place));
  // Sanity-check the type we ended up with.
  // PORT: the `if cfg!(debug_assertions) { .. mir_assign_valid_types .. }` check is skipped (rustc ships without
  // debug assertions).
  return interp_ok(place);
};

/// Given a place, returns either the underlying mplace or a reference to where the value of
/// this place is stored.
// PORT: `&mut Immediate` (the local's value) is a `MutRef<Immediate>` whose writes store
// `LocalValue::Live(Operand::Immediate(v))` into the frame's `LocalState` (`LocalState.value` is the mutable field).
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:650 as_mplace_or_mutable_local
InterpCx.prototype.as_mplace_or_mutable_local = function (this: InterpCx, place: PlaceTy): InterpResult<Either<MPlaceTy, [MutRef<Immediate>, TyAndLayout, Local]>> {
  type R = Either<MPlaceTy, [MutRef<Immediate>, TyAndLayout, Local]>;
  const e = place.to_place().as_mplace_or_local();
  switch (e.$) {
    case "Left":
      return interp_ok<R>({ $: "Left", _0: e._0 });
    case "Right": {
      const [local, offset, _locals_addr, layout] = e._0;
      if (offset !== undefined) {
        // This has been projected to a part of this local, or had the type changed.
        // FIXME: there are cases where we could still avoid allocating an mplace.
        const r = place.force_mplace(this);
        if (r.$ === "Err") return r;
        return interp_ok<R>({ $: "Left", _0: r._0 });
      } else {
        // debug_assert_eq!(locals_addr, self.frame().locals_addr());
        // debug_assert_eq!(self.layout_of_local(self.frame(), local, None)?, layout);
        const state = this.frame_mut().locals[local]!;
        const ar = state.access_mut();
        if (ar.$ === "Err") return ar;
        const op = ar._0;
        switch (op.$) {
          case "Indirect":
            // The local is in memory.
            return interp_ok<R>({ $: "Left", _0: new MPlaceTy(op._0, layout) });
          case "Immediate": {
            // The local still has the optimized representation.
            let cur = op._0;
            const local_val: MutRef<Immediate> = {
              get value(): Immediate {
                return cur;
              },
              set value(v: Immediate) {
                cur = v;
                state.value = { $: "Live", _0: { $: "Immediate", _0: v } };
              },
            };
            return interp_ok<R>({ $: "Right", _0: [local_val, layout, local] });
          }
        }
      }
    }
  }
};

/// Write an immediate to a place
// #[inline(always)]
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:688 write_immediate
InterpCx.prototype.write_immediate = function (this: InterpCx, src: Immediate, dest: Writeable): InterpResult {
  const r = this.write_immediate_no_validate(src, dest);
  if (r.$ === "Err") return r;

  if (this.machine.enforce_validity(this, dest.layout_())) {
    // Data got changed, better make sure it matches the type!
    // Also needed to reset padding.
    const v = this.validate_place(dest.to_place(), this.machine.enforce_validity_recursively(this, dest.layout_()), /*reset_provenance_and_padding*/ true);
    if (v.$ === "Err") return v;
  }

  return interp_ok(undefined);
};

/// Write a scalar to a place
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:710 write_scalar
InterpCx.prototype.write_scalar = function (this: InterpCx, val: Scalar, dest: Writeable): InterpResult {
  return this.write_immediate({ $: "Scalar", _0: val }, dest);
};

/// Write a pointer to a place
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:720 write_pointer
InterpCx.prototype.write_pointer = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, dest: Writeable): InterpResult {
  return this.write_scalar(Scalar.from_maybe_pointer(ptr, this), dest);
};

/// Write an immediate to a place.
/// If you use this you are responsible for validating that things got copied at the
/// right type.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:731 write_immediate_no_validate
InterpCx.prototype.write_immediate_no_validate = function (this: InterpCx, src: Immediate, dest: Writeable): InterpResult {
  assert(dest.layout_().is_sized(), "Cannot write unsized immediate data");

  const mr = this.as_mplace_or_mutable_local(dest.to_place());
  if (mr.$ === "Err") return mr;
  const m = mr._0;
  switch (m.$) {
    case "Right": {
      const [local_val, _local_layout, local] = m._0;
      // Local can be updated in-place.
      local_val.value = src;
      // Call the machine hook (the data race detector needs to know about this write).
      if (!this.validation_in_progress()) {
        const r = this.machine.after_local_write(this, local, /*storage_live*/ false);
        if (r.$ === "Err") return r;
      }
      // Double-check that the value we are storing and the local fit to each other.
      // Things can ge wrong in quite weird ways when this is violated.
      // Unfortunately this is too expensive to do in release builds.
      // PORT: the `if cfg!(debug_assertions) { src.assert_matches_abi(..) }` check is skipped.
      break;
    }
    case "Left": {
      const mplace = m._0;
      const r = this.write_immediate_to_mplace_no_validate(src, mplace.layout, mplace.mplace);
      if (r.$ === "Err") return r;
      break;
    }
  }
  return interp_ok(undefined);
};

/// Write an immediate to memory.
/// If you use this you are responsible for validating that things got copied at the
/// right layout.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:767 write_immediate_to_mplace_no_validate
InterpCx.prototype.write_immediate_to_mplace_no_validate = function (this: InterpCx, value: Immediate, layout: TyAndLayout, dest: MemPlace): InterpResult {
  // We use the sizes from `value` below.
  // Ensure that matches the type of the place it is written to.
  Immediate.assert_matches_abi(value, layout.backend_repr, "invalid immediate for given destination place", this);
  // Note that it is really important that the type here is the right one, and matches the
  // type things are read at. In case `value` is a `ScalarPair`, we don't do any magic here
  // to handle padding properly, which is only correct if we never look at this data with the
  // wrong type.

  const will_later_validate = this.machine.enforce_validity(this, layout);
  const ar = this.get_place_alloc_mut(new MPlaceTy(dest, layout));
  if (ar.$ === "Err") return ar;
  const alloc = ar._0;
  if (alloc === undefined) {
    // zero-sized access
    return interp_ok(undefined);
  }

  switch (value.$) {
    case "Scalar": {
      const scalar = value._0;
      const r = alloc.write_scalar(alloc_range(Size.ZERO, Scalar.size(scalar)), scalar);
      if (r.$ === "Err") return r;
      break;
    }
    case "ScalarPair": {
      const a_val = value._0;
      const b_val = value._1;
      const repr = layout.backend_repr;
      if (repr.$ !== "ScalarPair") {
        return span_bug(this.cur_span(), `write_immediate_to_mplace: invalid ScalarPair layout: ${debug_TyAndLayout_Ty(layout, PRETTY)}`);
      }
      const b_offset = repr.b_offset;
      const a_size = Scalar.size(a_val);
      const b_size = Scalar.size(b_val);
      assert(b_offset.bytes() > 0, "assertion failed: b_offset.bytes() > 0"); // in `operand_field` we use the offset to tell apart the fields

      // It is tempting to verify `b_offset` against `layout.fields.offset(1)`,
      // but that does not work: We could be a newtype around a pair, then the
      // fields do not match the `ScalarPair` components.

      // In preparation, if we do *not* later reset the padding, we clear the entire
      // destination now to ensure that no stray pointer fragments are being
      // preserved (see <https://github.com/rust-lang/rust/issues/148470>).
      // We can skip this if there is no padding (e.g. for wide pointers).
      if (!will_later_validate && a_size.add(b_size).bytes() !== layout.size.bytes()) {
        alloc.write_uninit_full();
      }

      let r = alloc.write_scalar(alloc_range(Size.ZERO, a_size), a_val);
      if (r.$ === "Err") return r;
      r = alloc.write_scalar(alloc_range(b_offset, b_size), b_val);
      if (r.$ === "Err") return r;
      break;
    }
    case "Uninit":
      alloc.write_uninit_full();
      break;
  }
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:827 write_uninit
InterpCx.prototype.write_uninit = function (this: InterpCx, dest: Writeable): InterpResult {
  const mr = this.as_mplace_or_mutable_local(dest.to_place());
  if (mr.$ === "Err") return mr;
  const m = mr._0;
  switch (m.$) {
    case "Right": {
      const [local_val, _local_layout, local] = m._0;
      local_val.value = Immediate.Uninit;
      // Call the machine hook (the data race detector needs to know about this write).
      if (!this.validation_in_progress()) {
        const r = this.machine.after_local_write(this, local, /*storage_live*/ false);
        if (r.$ === "Err") return r;
      }
      break;
    }
    case "Left": {
      const mplace = m._0;
      const ar = this.get_place_alloc_mut(mplace);
      if (ar.$ === "Err") return ar;
      const alloc = ar._0;
      if (alloc === undefined) {
        // Zero-sized access
        return interp_ok(undefined);
      }
      alloc.write_uninit_full();
      break;
    }
  }
  return interp_ok(undefined);
};

/// Remove all provenance in the given place.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:851 clear_provenance
InterpCx.prototype.clear_provenance = function (this: InterpCx, dest: Writeable): InterpResult {
  // If this is an efficiently represented local variable without provenance, skip the
  // `as_mplace_or_mutable_local` that would otherwise force this local into memory.
  const opr = dest.to_op(this);
  if (opr.$ === "Err") return opr;
  const e = opr._0.as_mplace_or_imm();
  if (e.$ === "Right") {
    const imm = e._0;
    if (!Immediate.has_provenance(imm.deref())) {
      return interp_ok(undefined);
    }
  }
  const mr = this.as_mplace_or_mutable_local(dest.to_place());
  if (mr.$ === "Err") return mr;
  const m = mr._0;
  switch (m.$) {
    case "Right": {
      const [local_val, _local_layout, local] = m._0;
      const r = Immediate.clear_provenance(local_val);
      if (r.$ === "Err") return r;
      // Call the machine hook (the data race detector needs to know about this write).
      if (!this.validation_in_progress()) {
        const r = this.machine.after_local_write(this, local, /*storage_live*/ false);
        if (r.$ === "Err") return r;
      }
      break;
    }
    case "Left": {
      const mplace = m._0;
      const ar = this.get_place_alloc_mut(mplace);
      if (ar.$ === "Err") return ar;
      const alloc = ar._0;
      if (alloc === undefined) {
        // Zero-sized access
        return interp_ok(undefined);
      }
      alloc.clear_provenance();
      break;
    }
  }
  return interp_ok(undefined);
};

/// Copies the data from an operand to a place.
/// The layouts of the `src` and `dest` may disagree.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:884 copy_op_allow_transmute
InterpCx.prototype.copy_op_allow_transmute = function (this: InterpCx, src: Projectable, dest: Writeable): InterpResult {
  return this.copy_op_inner(src, dest, /* allow_transmute */ true);
};

/// Copies the data from an operand to a place.
/// `src` and `dest` must have the same layout and the copied value will be validated.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:895 copy_op
InterpCx.prototype.copy_op = function (this: InterpCx, src: Projectable, dest: Writeable): InterpResult {
  return this.copy_op_inner(src, dest, /* allow_transmute */ false);
};

/// Perform a typed copy of the data from an operand to a place.
///
/// `allow_transmute` indicates whether the layouts may disagree. In that case there are
/// technically *two* typed copies: `src` is a not-yet-loaded value, so we're doing a typed copy
/// at `src` type from there to some intermediate storage. And then we're doing a second typed
/// copy at `dest` type from that intermediate storage to `dest`. As an optimization, we only
/// make a single direct copy here, but we still have to ensure the data is valid at both types.
// #[inline(always)]
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:912 copy_op_inner
InterpCx.prototype.copy_op_inner = function (this: InterpCx, src: Projectable, dest: Writeable, allow_transmute: boolean): InterpResult {
  // Do the actual copy.
  const r = this.copy_op_no_validate(src, dest, allow_transmute);
  if (r.$ === "Err") return r;

  if (this.machine.enforce_validity(this, dest.layout_())) {
    const dest_ = dest.to_place();
    // Given that there were two typed copies, we have to ensure this is valid at both
    // types, and we have to ensure this loses provenance and padding according to both
    // types. We also transmute both ways: when transmuting `*ptr` from `&T` to `*const T`,
    // it seems nice to ensure that the resulting pointer value indeed is derived from a
    // shared reference.
    // But if the types are identical, that is strictly redundant so we only do one pass.
    if (src.layout_().ty !== dest_.layout_().ty) {
      const t = dest_.transmute(src.layout_(), this);
      if (t.$ === "Err") return t;
      const v = this.validate_place(t._0, this.machine.enforce_validity_recursively(this, src.layout_()), /*reset_provenance_and_padding*/ true);
      if (v.$ === "Err") return v;
    }
    const v = this.validate_place(dest_, this.machine.enforce_validity_recursively(this, dest_.layout_()), /*reset_provenance_and_padding*/ true);
    if (v.$ === "Err") return v;
  }

  return interp_ok(undefined);
};

/// Perform an untyped copy of the data from an operand to a place.
/// You are responsible for validating that things get copied at the right type.
///
/// `allow_transmute` indicates whether the layouts may disagree.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:951 copy_op_no_validate
InterpCx.prototype.copy_op_no_validate = function (this: InterpCx, src: Projectable, dest: Writeable, allow_transmute: boolean): InterpResult {
  // We do NOT compare the types for equality, because well-typed code can
  // actually "transmute" `&mut T` to `&T` in an assignment without a cast.
  const layout_compat = mir_assign_valid_types(this.tcx.deref(), this.typing_env, src.layout_(), dest.layout_());
  if (!allow_transmute && !layout_compat) {
    span_bug(this.cur_span(), `type mismatch when copying!\nsrc: ${display_Ty(src.layout_().ty)},\ndest: ${display_Ty(dest.layout_().ty)}`);
  }
  // If the source has padding, we want to always do a mem-to-mem copy to ensure consistent
  // padding in the target independent of layout choices.
  let src_has_padding: boolean;
  const repr = src.layout_().backend_repr;
  const src_kind = src.layout_().ty.kind();
  if (repr.$ === "Scalar") {
    src_has_padding = false;
  } else if (repr.$ === "ScalarPair" && (src_kind.$ === "Ref" || src_kind.$ === "RawPtr")) {
    // Wide pointers never have padding, so we can avoid calling `size()`.
    // debug_assert_eq!(left.size(self) + right.size(self), src.layout().size);
    src_has_padding = false;
  } else if (repr.$ === "ScalarPair") {
    const left_size = abi_Scalar.size(repr.a, this);
    const right_size = abi_Scalar.size(repr.b, this);
    // We have padding if the sizes don't add up to the total.
    // (Why don't we need to check the offset?  The scalars don't overlap so no padding
    // implies `b_offset == left_size`, which would be superfluous to check explicitly.)
    src_has_padding = left_size.add(right_size).bytes() !== src.layout_().size.bytes();
  } else {
    // Everything else can only exist in memory anyway, so it doesn't matter.
    // BackendRepr::SimdVector { .. } | BackendRepr::SimdScalableVector { .. } | BackendRepr::Memory { .. }
    src_has_padding = true;
  }

  let src_val: Either<MPlaceTy, ImmTy>;
  if (src_has_padding) {
    // Do our best to get an mplace. If there's no mplace, then this is stored as an
    // "optimized" local, so its padding is definitely uninitialized and we are fine.
    const r = src.to_op(this);
    if (r.$ === "Err") return r;
    src_val = r._0.as_mplace_or_imm();
  } else {
    // Do our best to get an immediate, to avoid having to force_allocate the destination.
    const r = this.read_immediate_raw(src);
    if (r.$ === "Err") return r;
    src_val = r._0;
  }
  let src_: MPlaceTy;
  switch (src_val.$) {
    case "Right": {
      const imm = src_val._0;
      assert(!src.layout_().is_unsized(), "assertion failed: !src.layout().is_unsized()");
      assert(!dest.layout_().is_unsized(), "assertion failed: !dest.layout().is_unsized()");
      assert_eq(src.layout_().size, dest.layout_().size, debug_size, size_eq);
      // Yay, we got a value that we can write directly.
      if (layout_compat) {
        return this.write_immediate_no_validate(imm.deref(), dest);
      } else {
        // This is tricky. The problematic case is `ScalarPair`: the `src_val` was
        // loaded using the offsets defined by `src.layout`. When we put this back into
        // the destination, we have to use the same offsets! So (a) we make sure we
        // write back to memory, and (b) we use `dest` *with the source layout*.
        const dr = dest.force_mplace(this);
        if (dr.$ === "Err") return dr;
        const dest_mem = dr._0;
        return this.write_immediate_to_mplace_no_validate(imm.deref(), src.layout_(), dest_mem.mplace);
      }
    }
    case "Left":
      src_ = src_val._0;
      break;
  }
  // Slow path, this does not fit into an immediate. Just memcpy.
  // trace!("copy_op: {:?} <- {:?}: {}", *dest, src, dest.layout().ty);

  const dr = dest.force_mplace(this);
  if (dr.$ === "Err") return dr;
  const dest_ = dr._0;
  const sr = this.size_and_align_of_val(dest_);
  if (sr.$ === "Err") return sr;
  if (sr._0 === undefined) {
    return span_bug(this.cur_span(), "copy_op needs (dynamically) sized values");
  }
  const [dest_size] = sr._0;
  // PORT: `if cfg!(debug_assertions) { .. }` takes its `else` branch (rustc ships without debug assertions).
  // As a cheap approximation, we compare the fixed parts of the size.
  assert_eq(src_.layout.size, dest_.layout.size, debug_size, size_eq);

  // Setting `nonoverlapping` here only has an effect when we don't hit the fast-path above,
  // but that should at least match what LLVM does where `memcpy` is also only used when the
  // type does not have Scalar/ScalarPair layout.
  // (Or as the `Assign` docs put it, assignments "not producing primitives" must be
  // non-overlapping.)
  // We check alignment separately, and *after* checking everything else.
  // If an access is both OOB and misaligned, we want to see the bounds error.
  let r = this.mem_copy(src_.ptr(), dest_.ptr(), dest_size, /*nonoverlapping*/ true);
  if (r.$ === "Err") return r;
  r = this.check_misalign(src_.mplace.misaligned, CheckAlignMsg.BasedOn);
  if (r.$ === "Err") return r;
  r = this.check_misalign(dest_.mplace.misaligned, CheckAlignMsg.BasedOn);
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

/// Ensures that a place is in memory, and returns where it is.
/// If the place currently refers to a local that doesn't yet have a matching allocation,
/// create such an allocation.
/// This is essentially `force_to_memplace`.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:1058 force_allocation
InterpCx.prototype.force_allocation = function (this: InterpCx, place: PlaceTy): InterpResult<MPlaceTy> {
  let mplace: MemPlace;
  const p = place.place;
  switch (p.$) {
    case "Local": {
      const { local, offset } = p;
      // debug_assert_eq!(locals_addr, self.frame().locals_addr());
      const ar = this.frame_mut().locals[local]!.access_mut();
      if (ar.$ === "Err") return ar;
      const op = ar._0;
      let whole_local: MemPlace;
      switch (op.$) {
        case "Immediate": {
          const local_val = op._0;
          // We need to make an allocation.

          // We need the layout of the local. We can NOT use the layout we got,
          // that might e.g., be an inner field of a struct with `Scalar` layout,
          // that has different alignment than the outer field.
          const lr = this.layout_of_local(this.frame(), local, undefined);
          if (lr.$ === "Err") return lr;
          const local_layout = lr._0;
          assert(local_layout.is_sized(), "unsized locals cannot be immediate");
          const mr = this.allocate(local_layout, MemoryKind.Stack);
          if (mr.$ === "Err") return mr;
          const mplace_ = mr._0;
          // Preserve old value. (As an optimization, we can skip this if it was uninit.)
          if (!(local_val.$ === "Uninit")) {
            // We don't have to validate as we can assume the local was already
            // valid for its type. We must not use any part of `place` here, that
            // could be a projection to a part of the local!
            const r = this.write_immediate_to_mplace_no_validate(local_val, local_layout, mplace_.mplace);
            if (r.$ === "Err") return r;
          }
          const r = this.machine.after_local_moved_to_memory(this, local, mplace_);
          if (r.$ === "Err") return r;
          // Now we can call `access_mut` again, asserting it goes well, and actually
          // overwrite things. This points to the entire allocation, not just the part
          // the place refers to, i.e. we do this before we apply `offset`.
          // PORT: `*access_mut().unwrap() = ..` stores the new `LocalValue::Live` into the mutable `LocalState.value`.
          const state = this.frame_mut().locals[local]!;
          InterpResultC.unwrap(state.access_mut());
          state.value = { $: "Live", _0: { $: "Indirect", _0: mplace_.mplace } };
          whole_local = mplace_.mplace;
          break;
        }
        case "Indirect":
          whole_local = op._0; // this already was an indirect local
          break;
      }
      if (offset !== undefined) {
        // This offset is always inbounds, no need to check it again.
        const r = whole_local.offset_with_meta_(offset, OffsetMode.Wrapping, MemPlaceMeta.None, this);
        if (r.$ === "Err") return r;
        mplace = r._0;
      } else {
        // Preserve wide place metadata, do not call `offset`.
        mplace = whole_local;
      }
      break;
    }
    case "Ptr":
      mplace = p._0;
      break;
  }
  // Return with the original layout and align, so that the caller can go on
  return interp_ok(new MPlaceTy(mplace, place.layout));
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:1115 allocate_dyn
InterpCx.prototype.allocate_dyn = function (this: InterpCx, layout: TyAndLayout, kind: MemoryKind<CtfeMemoryKind>, meta: MemPlaceMeta): InterpResult<MPlaceTy> {
  const sr = this.size_and_align_from_meta(meta, layout);
  if (sr.$ === "Err") return sr;
  if (sr._0 === undefined) {
    return span_bug(this.cur_span(), "cannot allocate space for `extern` type, size is not known");
  }
  const [size, align] = sr._0;
  const pr = this.allocate_ptr(size, align, kind, AllocInit.Uninit);
  if (pr.$ === "Err") return pr;
  return interp_ok(this.ptr_with_meta_to_mplace(Pointer_Option_from_Pointer(pr._0), meta, layout, /*unaligned*/ false));
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:1128 allocate
InterpCx.prototype.allocate = function (this: InterpCx, layout: TyAndLayout, kind: MemoryKind<CtfeMemoryKind>): InterpResult<MPlaceTy> {
  assert(layout.is_sized(), "assertion failed: layout.is_sized()");
  return this.allocate_dyn(layout, kind, MemPlaceMeta.None);
};

/// Allocates a sequence of bytes in the interpreter's memory with alignment 1.
/// This is allocated in immutable global memory and deduplicated.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:1139 allocate_bytes_dedup
InterpCx.prototype.allocate_bytes_dedup = function (this: InterpCx, bytes: Uint8Array): InterpResult<Pointer> {
  const salt = this.machine.get_global_alloc_salt(this, undefined);
  const id = this.tcx.deref().allocate_bytes_dedup(bytes, salt);

  // Turn untagged "global" pointers (obtained via `tcx`) into the machine pointer to the allocation.
  const global_kind = this.machine.GLOBAL_KIND;
  return this.machine.adjust_alloc_root_pointer(this, Pointer_from_AllocId(id), global_kind === undefined ? undefined : { $: "Machine", _0: global_kind });
};

/// Allocates a string in the interpreter's memory, returning it as a (wide) place.
/// This is allocated in immutable global memory and deduplicated.
// rustc: compiler/rustc_const_eval/src/interpret/place.rs:1156 allocate_str_dedup
InterpCx.prototype.allocate_str_dedup = function (this: InterpCx, s: string): InterpResult<MPlaceTy> {
  const bytes = utf8(s);
  const pr = this.allocate_bytes_dedup(bytes);
  if (pr.$ === "Err") return pr;
  const ptr = pr._0;

  // Create length metadata for the string.
  const meta = Scalar.from_target_usize<CtfeProvenance>(BigInt(bytes.length), this);

  // Get layout for Rust's str type.
  const layout = unwrap_result(this.layout_of(this.tcx.deref().types.str_), debug_InterpErrorKind);

  // Combine pointer and metadata into a wide pointer.
  return interp_ok(this.ptr_with_meta_to_mplace(Pointer_Option_from_Pointer(ptr), { $: "Meta", _0: meta }, layout, /*unaligned*/ false));
};

// rustc: compiler/rustc_const_eval/src/interpret/place.rs:1178 raw_const_to_mplace
InterpCx.prototype.raw_const_to_mplace = function (this: InterpCx, raw: ConstAlloc): InterpResult<MPlaceTy> {
  // This must be an allocation in `tcx`
  this.tcx.deref().global_alloc(raw.alloc_id);
  const pr = this.global_root_pointer(Pointer_from_AllocId(raw.alloc_id));
  if (pr.$ === "Err") return pr;
  const lr = this.layout_of(raw.ty);
  if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
  return interp_ok(this.ptr_to_mplace(Pointer_Option_from_Pointer(pr._0), lr._0));
};
