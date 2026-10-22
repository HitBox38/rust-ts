// Port of compiler/rustc_const_eval/src/interpret/place.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-place-operand; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type HasDataLayout, type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type CtfeMemoryKind, type Machine } from "./machine.ts";
import { AllocRef, AllocRefMut, MemoryKind } from "./memory.ts";
import { Immediate } from "./operand.ts";
import { MPlaceTy, MemPlace, PlaceTy, type Place } from "./place.gen.ts";
import { OffsetMode, type Projectable } from "./projection.ts";
import { type CtfeProvenance, type InterpResult, type Pointer, type Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type ConstAlloc, type Either, type Local, type Place as mir_Place } from "../../rustc_middle/mir/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import * as gen from "./place.gen.ts";

export * from "./place.gen.ts";

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
    as_mplace_or_mutable_local(place: PlaceTy): InterpResult<Either<MPlaceTy, [Immediate, TyAndLayout, Local]>>;
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

// stub: compiler/rustc_const_eval/src/interpret/place.rs:35 unwrap_meta (lane interp-place-operand)
MemPlaceMeta.unwrap_meta = function (self: MemPlaceMeta): Scalar {
  return unported("rustc_const_eval::interpret::place::MemPlaceMeta::unwrap_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:45 has_meta (lane interp-place-operand)
MemPlaceMeta.has_meta = function (self: MemPlaceMeta): boolean {
  return unported("rustc_const_eval::interpret::place::MemPlaceMeta::has_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:67 map_provenance (lane interp-place-operand)
MemPlace.prototype.map_provenance = function (this: MemPlace, f: (a0: CtfeProvenance) => CtfeProvenance): MemPlace {
  return unported("rustc_const_eval::interpret::place::MemPlace::map_provenance");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:73 to_ref (lane interp-place-operand)
MemPlace.prototype.to_ref = function (this: MemPlace, cx: HasDataLayout): Immediate {
  return unported("rustc_const_eval::interpret::place::MemPlace::to_ref");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:79 offset_with_meta_ (lane interp-place-operand)
MemPlace.prototype.offset_with_meta_ = function (this: MemPlace, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, ecx: InterpCx): InterpResult<MemPlace> {
  return unported("rustc_const_eval::interpret::place::MemPlace::offset_with_meta_");
};

// impl Debug for MPlaceTy
// stub: compiler/rustc_const_eval/src/interpret/place.rs:108 fmt (lane interp-place-operand)
export function debug_MPlaceTy(self: MPlaceTy, f: Fmt): string {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::fmt");
}

// stub: compiler/rustc_const_eval/src/interpret/place.rs:122 fake_alloc_zst (lane interp-place-operand)
(MPlaceTy as { fake_alloc_zst: typeof MPlaceTy.fake_alloc_zst }).fake_alloc_zst = function (layout: TyAndLayout): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::fake_alloc_zst");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:130 map_provenance (lane interp-place-operand)
MPlaceTy.prototype.map_provenance = function (this: MPlaceTy, f: (a0: CtfeProvenance) => CtfeProvenance): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::map_provenance");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:135 mplace (lane interp-place-operand)
MPlaceTy.prototype.mplace_ = function (this: MPlaceTy): MemPlace {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::mplace");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:140 ptr (lane interp-place-operand)
MPlaceTy.prototype.ptr = function (this: MPlaceTy): Pointer<CtfeProvenance | undefined> {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:145 to_ref (lane interp-place-operand)
MPlaceTy.prototype.to_ref = function (this: MPlaceTy, cx: HasDataLayout): Immediate {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::to_ref");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:152 layout (lane interp-place-operand)
MPlaceTy.prototype.layout_ = function (this: MPlaceTy): TyAndLayout {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::layout");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:157 meta (lane interp-place-operand)
MPlaceTy.prototype.meta = function (this: MPlaceTy): MemPlaceMeta {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::meta");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:161 offset_with_meta (lane interp-place-operand)
MPlaceTy.prototype.offset_with_meta = function (this: MPlaceTy, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::offset_with_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:176 to_op (lane interp-place-operand)
MPlaceTy.prototype.to_op = function (this: MPlaceTy, _ecx: InterpCx): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::to_op");
};

// impl Debug for PlaceTy
// stub: compiler/rustc_const_eval/src/interpret/place.rs:216 fmt (lane interp-place-operand)
export function debug_PlaceTy(self: PlaceTy, f: Fmt): string {
  return unported("rustc_const_eval::interpret::place::PlaceTy::fmt");
}

// impl From<MPlaceTy<'tcx, Prov>> for PlaceTy
// stub: compiler/rustc_const_eval/src/interpret/place.rs:227 from (lane interp-place-operand)
export function PlaceTy_from_MPlaceTy(mplace: MPlaceTy): PlaceTy {
  return unported("rustc_const_eval::interpret::place::PlaceTy::from");
}

// stub: compiler/rustc_const_eval/src/interpret/place.rs:234 place (lane interp-place-operand)
PlaceTy.prototype.place_ = function (this: PlaceTy): Place {
  return unported("rustc_const_eval::interpret::place::PlaceTy::place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:246 as_mplace_or_local (lane interp-place-operand)
PlaceTy.prototype.as_mplace_or_local = function (this: PlaceTy): Either<MPlaceTy, [Local, Size | undefined, number, TyAndLayout]> {
  return unported("rustc_const_eval::interpret::place::PlaceTy::as_mplace_or_local");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:259 assert_mem_place (lane interp-place-operand)
PlaceTy.prototype.assert_mem_place = function (this: PlaceTy): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::PlaceTy::assert_mem_place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:271 layout (lane interp-place-operand)
PlaceTy.prototype.layout_ = function (this: PlaceTy): TyAndLayout {
  return unported("rustc_const_eval::interpret::place::PlaceTy::layout");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:276 meta (lane interp-place-operand)
PlaceTy.prototype.meta = function (this: PlaceTy): MemPlaceMeta {
  return unported("rustc_const_eval::interpret::place::PlaceTy::meta");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:286 offset_with_meta (lane interp-place-operand)
PlaceTy.prototype.offset_with_meta = function (this: PlaceTy, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<PlaceTy> {
  return unported("rustc_const_eval::interpret::place::PlaceTy::offset_with_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:316 to_op (lane interp-place-operand)
PlaceTy.prototype.to_op = function (this: PlaceTy, ecx: InterpCx): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::place::PlaceTy::to_op");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:327 as_mplace_or_imm (lane interp-place-operand)
OpTy.prototype.as_mplace_or_imm = function (this: OpTy): Either<MPlaceTy, ImmTy> {
  return unported("rustc_const_eval::interpret::place::OpTy::as_mplace_or_imm");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:336 assert_mem_place (lane interp-place-operand)
OpTy.prototype.assert_mem_place = function (this: OpTy): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::OpTy::assert_mem_place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:358 to_place (lane interp-place-operand)
PlaceTy.prototype.to_place = function (this: PlaceTy): PlaceTy {
  return unported("rustc_const_eval::interpret::place::PlaceTy::to_place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:363 force_mplace (lane interp-place-operand)
PlaceTy.prototype.force_mplace = function (this: PlaceTy, ecx: InterpCx): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::PlaceTy::force_mplace");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:373 to_place (lane interp-place-operand)
MPlaceTy.prototype.to_place = function (this: MPlaceTy): PlaceTy {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::to_place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:378 force_mplace (lane interp-place-operand)
MPlaceTy.prototype.force_mplace = function (this: MPlaceTy, _ecx: InterpCx): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::MPlaceTy::force_mplace");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:392 ptr_with_meta_to_mplace (lane interp-place-operand)
InterpCx.prototype.ptr_with_meta_to_mplace = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, layout: TyAndLayout, unaligned: boolean): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::InterpCx::ptr_with_meta_to_mplace");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:404 ptr_to_mplace (lane interp-place-operand)
InterpCx.prototype.ptr_to_mplace = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, layout: TyAndLayout): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::InterpCx::ptr_to_mplace");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:413 ptr_to_mplace_unaligned (lane interp-place-operand)
InterpCx.prototype.ptr_to_mplace_unaligned = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, layout: TyAndLayout): MPlaceTy {
  return unported("rustc_const_eval::interpret::place::InterpCx::ptr_to_mplace_unaligned");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:428 imm_ptr_to_mplace (lane interp-place-operand)
InterpCx.prototype.imm_ptr_to_mplace = function (this: InterpCx, val: ImmTy): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::imm_ptr_to_mplace");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:450 mplace_to_imm_ptr (lane interp-place-operand)
InterpCx.prototype.mplace_to_imm_ptr = function (this: InterpCx, mplace: MPlaceTy, ptr_ty: Ty | undefined): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::mplace_to_imm_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:469 deref_pointer (lane interp-place-operand)
InterpCx.prototype.deref_pointer = function (this: InterpCx, src: Projectable): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::deref_pointer");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:542 get_place_alloc (lane interp-place-operand)
InterpCx.prototype.get_place_alloc = function (this: InterpCx, mplace: MPlaceTy): InterpResult<AllocRef | undefined> {
  return unported("rustc_const_eval::interpret::place::InterpCx::get_place_alloc");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:558 get_place_alloc_mut (lane interp-place-operand)
InterpCx.prototype.get_place_alloc_mut = function (this: InterpCx, mplace: MPlaceTy): InterpResult<AllocRefMut | undefined> {
  return unported("rustc_const_eval::interpret::place::InterpCx::get_place_alloc_mut");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:576 local_to_place (lane interp-place-operand)
InterpCx.prototype.local_to_place = function (this: InterpCx, local: Local): InterpResult<PlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::local_to_place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:601 eval_place (lane interp-place-operand)
InterpCx.prototype.eval_place = function (this: InterpCx, mir_place: mir_Place, skip_validity_for_simple_deref: boolean): InterpResult<PlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::eval_place");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:650 as_mplace_or_mutable_local (lane interp-place-operand)
InterpCx.prototype.as_mplace_or_mutable_local = function (this: InterpCx, place: PlaceTy): InterpResult<Either<MPlaceTy, [Immediate, TyAndLayout, Local]>> {
  return unported("rustc_const_eval::interpret::place::InterpCx::as_mplace_or_mutable_local");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:688 write_immediate (lane interp-place-operand)
InterpCx.prototype.write_immediate = function (this: InterpCx, src: Immediate, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::write_immediate");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:710 write_scalar (lane interp-place-operand)
InterpCx.prototype.write_scalar = function (this: InterpCx, val: Scalar, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::write_scalar");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:720 write_pointer (lane interp-place-operand)
InterpCx.prototype.write_pointer = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::write_pointer");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:731 write_immediate_no_validate (lane interp-place-operand)
InterpCx.prototype.write_immediate_no_validate = function (this: InterpCx, src: Immediate, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::write_immediate_no_validate");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:767 write_immediate_to_mplace_no_validate (lane interp-place-operand)
InterpCx.prototype.write_immediate_to_mplace_no_validate = function (this: InterpCx, value: Immediate, layout: TyAndLayout, dest: MemPlace): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::write_immediate_to_mplace_no_validate");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:827 write_uninit (lane interp-place-operand)
InterpCx.prototype.write_uninit = function (this: InterpCx, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::write_uninit");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:851 clear_provenance (lane interp-place-operand)
InterpCx.prototype.clear_provenance = function (this: InterpCx, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::clear_provenance");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:884 copy_op_allow_transmute (lane interp-place-operand)
InterpCx.prototype.copy_op_allow_transmute = function (this: InterpCx, src: Projectable, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::copy_op_allow_transmute");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:895 copy_op (lane interp-place-operand)
InterpCx.prototype.copy_op = function (this: InterpCx, src: Projectable, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::copy_op");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:912 copy_op_inner (lane interp-place-operand)
InterpCx.prototype.copy_op_inner = function (this: InterpCx, src: Projectable, dest: Writeable, allow_transmute: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::copy_op_inner");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:951 copy_op_no_validate (lane interp-place-operand)
InterpCx.prototype.copy_op_no_validate = function (this: InterpCx, src: Projectable, dest: Writeable, allow_transmute: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::place::InterpCx::copy_op_no_validate");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:1058 force_allocation (lane interp-place-operand)
InterpCx.prototype.force_allocation = function (this: InterpCx, place: PlaceTy): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::force_allocation");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:1115 allocate_dyn (lane interp-place-operand)
InterpCx.prototype.allocate_dyn = function (this: InterpCx, layout: TyAndLayout, kind: MemoryKind<CtfeMemoryKind>, meta: MemPlaceMeta): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::allocate_dyn");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:1128 allocate (lane interp-place-operand)
InterpCx.prototype.allocate = function (this: InterpCx, layout: TyAndLayout, kind: MemoryKind<CtfeMemoryKind>): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::allocate");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:1139 allocate_bytes_dedup (lane interp-place-operand)
InterpCx.prototype.allocate_bytes_dedup = function (this: InterpCx, bytes: Uint8Array): InterpResult<Pointer> {
  return unported("rustc_const_eval::interpret::place::InterpCx::allocate_bytes_dedup");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:1156 allocate_str_dedup (lane interp-place-operand)
InterpCx.prototype.allocate_str_dedup = function (this: InterpCx, s: string): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::allocate_str_dedup");
};

// stub: compiler/rustc_const_eval/src/interpret/place.rs:1178 raw_const_to_mplace (lane interp-place-operand)
InterpCx.prototype.raw_const_to_mplace = function (this: InterpCx, raw: ConstAlloc): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::place::InterpCx::raw_const_to_mplace");
};
