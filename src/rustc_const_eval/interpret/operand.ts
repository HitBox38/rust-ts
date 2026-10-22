// Port of compiler/rustc_const_eval/src/interpret/operand.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-place-operand; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type BackendRepr, type HasDataLayout, Size } from "../../rustc_abi/lib.ts";
import { InterpCx, from_known_layout } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { ImmTy, OpTy, type Operand } from "./operand.gen.ts";
import { MemPlaceMeta } from "./place.ts";
import { OffsetMode, type Projectable } from "./projection.ts";
import { type InterpResult, type Scalar, interp_ok, InterpErrorInfo_from_InterpErrorKind, Pointer, CtfeProvenance, CtfeProvenance_from_AllocId, Pointer_Option_from_Pointer } from "../../rustc_middle/mir/interpret/mod.ts";
import { type ConstValue, type Either, type Local, type Operand as mir_Operand, type Place as mir_Place } from "../../rustc_middle/mir/mod.ts";
import { type ConstInt, type ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type HasTyCtxt, type HasTypingEnv, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type FmtPrinter } from "../../rustc_middle/ty/print/pretty.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { type Result, Err } from "../../std/result.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";
import { Frame } from "./stack.gen.ts";
import * as gen from "./operand.gen.ts";
/** PORT: `std::cmp::Ordering` as its `i8` discriminant (`Less` = -1, `Equal` = 0, `Greater` = 1). */
type Ordering = -1 | 0 | 1;

export * from "./operand.gen.ts";

declare module "./operand.gen.ts" {
  interface ImmTy {
    // operand.rs:252 (lane interp-place-operand)
    deref(): Immediate;
    // operand.rs:342 (lane interp-place-operand)
    to_scalar_int(): InterpResult<ScalarInt>;
    // operand.rs:349 (lane interp-place-operand)
    to_const_int(): ConstInt;
    // operand.rs:358 (lane interp-place-operand)
    to_pair(cx: [HasTyCtxt]): [ImmTy, ImmTy];
    // operand.rs:370 (lane interp-place-operand)
    offset_(offset: Size, layout: TyAndLayout, cx: HasDataLayout): ImmTy;
    // operand.rs:445 (lane interp-place-operand)
    layout_(): TyAndLayout;
    // operand.rs:450 (lane interp-place-operand)
    meta(): MemPlaceMeta;
    // operand.rs:455 (lane interp-place-operand)
    offset_with_meta(offset: Size, _mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<ImmTy>;
    // operand.rs:468 (lane interp-place-operand)
    to_op(_ecx: InterpCx): InterpResult<OpTy>;
  }
}

declare module "./operand.gen.ts" {
  namespace ImmTy {
    // operand.rs:259 (lane interp-place-operand)
    function from_scalar(val: Scalar, layout: TyAndLayout): ImmTy;
    // operand.rs:266 (lane interp-place-operand)
    function from_scalar_pair(a: Scalar, b: Scalar, layout: TyAndLayout): ImmTy;
    // operand.rs:276 (lane interp-place-operand)
    function from_immediate(imm: Immediate, layout: TyAndLayout): ImmTy;
    // operand.rs:291 (lane interp-place-operand)
    function uninit(layout: TyAndLayout): ImmTy;
    // operand.rs:297 (lane interp-place-operand)
    function from_scalar_int(s: ScalarInt, layout: TyAndLayout): ImmTy;
    // operand.rs:302 (lane interp-place-operand)
    function from_uint(i: bigint, layout: TyAndLayout): ImmTy;
    // operand.rs:307 (lane interp-place-operand)
    function from_int(i: bigint, layout: TyAndLayout): ImmTy;
    // operand.rs:312 (lane interp-place-operand)
    function from_bool(b: boolean, tcx: TyCtxt): ImmTy;
    // operand.rs:321 (lane interp-place-operand)
    function from_ordering(c: Ordering, tcx: TyCtxt): ImmTy;
    // operand.rs:329 (lane interp-place-operand)
    function from_pair(a: ImmTy, b: ImmTy, cx: [HasTypingEnv]): ImmTy;
  }
}

declare module "./operand.gen.ts" {
  interface OpTy {
    // operand.rs:517 (lane interp-place-operand)
    op_(): Operand;
    // operand.rs:521 (lane interp-place-operand)
    is_immediate_uninit(): boolean;
    // operand.rs:528 (lane interp-place-operand)
    layout_(): TyAndLayout;
    // operand.rs:533 (lane interp-place-operand)
    meta(): MemPlaceMeta;
    // operand.rs:543 (lane interp-place-operand)
    offset_with_meta(offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<OpTy>;
    // operand.rs:564 (lane interp-place-operand)
    to_op(_ecx: InterpCx): InterpResult<OpTy>;
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // operand.rs:577 (lane interp-place-operand)
    read_immediate_from_mplace_raw(mplace: MPlaceTy): InterpResult<ImmTy | undefined>;
    // operand.rs:642 (lane interp-place-operand)
    read_immediate_raw(src: Projectable): InterpResult<Either<MPlaceTy, ImmTy>>;
    // operand.rs:662 (lane interp-place-operand)
    read_immediate(op: Projectable): InterpResult<ImmTy>;
    // operand.rs:685 (lane interp-place-operand)
    read_scalar(op: Projectable): InterpResult<Scalar>;
    // operand.rs:696 (lane interp-place-operand)
    read_pointer(op: Projectable): InterpResult<Pointer<CtfeProvenance | undefined>>;
    // operand.rs:703 (lane interp-place-operand)
    read_target_usize(op: Projectable): InterpResult<bigint>;
    // operand.rs:710 (lane interp-place-operand)
    read_target_isize(op: Projectable): InterpResult<bigint>;
    // operand.rs:718 (lane interp-place-operand)
    read_str(mplace: MPlaceTy): InterpResult<string>;
    // operand.rs:727 (lane interp-place-operand)
    local_to_op(local: Local, layout: TyAndLayout | undefined): InterpResult<OpTy>;
    // operand.rs:750 (lane interp-place-operand)
    ghost_local_in_frame_to_op(frame: Frame, local: Local): InterpResult<OpTy>;
    // operand.rs:763 (lane interp-place-operand)
    place_to_op(place: PlaceTy): InterpResult<OpTy>;
    // operand.rs:787 (lane interp-place-operand)
    eval_place_to_op(mir_place: mir_Place, layout: TyAndLayout | undefined): InterpResult<OpTy>;
    // operand.rs:837 (lane interp-place-operand)
    eval_operand(mir_op: mir_Operand, layout: TyAndLayout | undefined): InterpResult<OpTy>;
    // operand.rs:871 (lane interp-place-operand)
    const_val_to_op(val_val: ConstValue, ty: Ty, layout: TyAndLayout | undefined): InterpResult<OpTy>;
  }
}

export interface Immediate_methods {
  // operand.rs:51 (lane interp-place-operand)
  new_pointer_with_meta(ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, cx: HasDataLayout): Immediate;
  // operand.rs:63 (lane interp-place-operand)
  new_slice(ptr: Pointer<CtfeProvenance | undefined>, len: bigint, cx: HasDataLayout): Immediate;
  // operand.rs:70 (lane interp-place-operand)
  new_dyn_trait(val: Pointer<CtfeProvenance | undefined>, vtable: Pointer<CtfeProvenance | undefined>, cx: HasDataLayout): Immediate;
  // operand.rs:83 (lane interp-place-operand)
  to_scalar(self: Immediate): Scalar;
  // operand.rs:93 (lane interp-place-operand)
  to_scalar_int(self: Immediate): ScalarInt;
  // operand.rs:99 (lane interp-place-operand)
  to_scalar_pair(self: Immediate): [Scalar, Scalar];
  // operand.rs:110 (lane interp-place-operand)
  to_scalar_and_meta(self: Immediate): [Scalar, MemPlaceMeta];
  // operand.rs:119 (lane interp-place-operand)
  assert_matches_abi(self: Immediate, abi: BackendRepr, msg: string, cx: HasDataLayout): void;
  // operand.rs:167 (lane interp-place-operand)
  clear_provenance(self: Immediate): InterpResult;
  // operand.rs:181 (lane interp-place-operand)
  has_provenance(self: Immediate): boolean;
}
export type Immediate = gen.Immediate;
export const Immediate = gen.Immediate as typeof gen.Immediate & Immediate_methods;

// impl From<Scalar<Prov>> for Immediate
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:45 from
export function Immediate_from_Scalar(val: Scalar): Immediate {
  return { $: "Scalar", _0: val };
}

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:51 new_pointer_with_meta (lane interp-place-operand)
Immediate.new_pointer_with_meta = function (ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, cx: HasDataLayout): Immediate {
  return unported("rustc_const_eval::interpret::operand::Immediate::new_pointer_with_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:63 new_slice (lane interp-place-operand)
Immediate.new_slice = function (ptr: Pointer<CtfeProvenance | undefined>, len: bigint, cx: HasDataLayout): Immediate {
  return unported("rustc_const_eval::interpret::operand::Immediate::new_slice");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:70 new_dyn_trait (lane interp-place-operand)
Immediate.new_dyn_trait = function (val: Pointer<CtfeProvenance | undefined>, vtable: Pointer<CtfeProvenance | undefined>, cx: HasDataLayout): Immediate {
  return unported("rustc_const_eval::interpret::operand::Immediate::new_dyn_trait");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:83 to_scalar (lane interp-place-operand)
Immediate.to_scalar = function (self: Immediate): Scalar {
  return unported("rustc_const_eval::interpret::operand::Immediate::to_scalar");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:93 to_scalar_int (lane interp-place-operand)
Immediate.to_scalar_int = function (self: Immediate): ScalarInt {
  return unported("rustc_const_eval::interpret::operand::Immediate::to_scalar_int");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:99 to_scalar_pair (lane interp-place-operand)
Immediate.to_scalar_pair = function (self: Immediate): [Scalar, Scalar] {
  return unported("rustc_const_eval::interpret::operand::Immediate::to_scalar_pair");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:110 to_scalar_and_meta (lane interp-place-operand)
Immediate.to_scalar_and_meta = function (self: Immediate): [Scalar, MemPlaceMeta] {
  return unported("rustc_const_eval::interpret::operand::Immediate::to_scalar_and_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:119 assert_matches_abi (lane interp-place-operand)
Immediate.assert_matches_abi = function (self: Immediate, abi: BackendRepr, msg: string, cx: HasDataLayout): void {
  return unported("rustc_const_eval::interpret::operand::Immediate::assert_matches_abi");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:167 clear_provenance (lane interp-place-operand)
Immediate.clear_provenance = function (self: Immediate): InterpResult {
  return unported("rustc_const_eval::interpret::operand::Immediate::clear_provenance");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:181 has_provenance (lane interp-place-operand)
Immediate.has_provenance = function (self: Immediate): boolean {
  return unported("rustc_const_eval::interpret::operand::Immediate::has_provenance");
};

// impl Display for ImmTy
// stub: compiler/rustc_const_eval/src/interpret/operand.rs:201 fmt (lane interp-place-operand)
export function display_ImmTy(self: ImmTy, f: Fmt): string {
  return unported("rustc_const_eval::interpret::operand::ImmTy::fmt");
}

// PORT: nested in `fmt` upstream; moves inside its parent when ported.
// stub: compiler/rustc_const_eval/src/interpret/operand.rs:203 print_scalar (lane interp-place-operand)
function print_scalar<Prov>(p: FmtPrinter, s: Scalar, ty: Ty): Result<undefined, Error> {
  return unported("rustc_const_eval::interpret::operand::fmt::print_scalar");
}

// impl Debug for ImmTy
// stub: compiler/rustc_const_eval/src/interpret/operand.rs:240 fmt (lane interp-place-operand)
export function debug_ImmTy(self: ImmTy, f: Fmt): string {
  return unported("rustc_const_eval::interpret::operand::ImmTy::fmt");
}

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:252 deref (lane interp-place-operand)
ImmTy.prototype.deref = function (this: ImmTy): Immediate {
  return unported("rustc_const_eval::interpret::operand::ImmTy::deref");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:259 from_scalar (lane interp-place-operand)
(ImmTy as { from_scalar: typeof ImmTy.from_scalar }).from_scalar = function (val: Scalar, layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_scalar");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:266 from_scalar_pair (lane interp-place-operand)
(ImmTy as { from_scalar_pair: typeof ImmTy.from_scalar_pair }).from_scalar_pair = function (a: Scalar, b: Scalar, layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_scalar_pair");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:276 from_immediate (lane interp-place-operand)
(ImmTy as { from_immediate: typeof ImmTy.from_immediate }).from_immediate = function (imm: Immediate, layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_immediate");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:291 uninit (lane interp-place-operand)
(ImmTy as { uninit: typeof ImmTy.uninit }).uninit = function (layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::uninit");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:297 from_scalar_int (lane interp-place-operand)
(ImmTy as { from_scalar_int: typeof ImmTy.from_scalar_int }).from_scalar_int = function (s: ScalarInt, layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_scalar_int");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:302 from_uint (lane interp-place-operand)
(ImmTy as { from_uint: typeof ImmTy.from_uint }).from_uint = function (i: bigint, layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_uint");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:307 from_int (lane interp-place-operand)
(ImmTy as { from_int: typeof ImmTy.from_int }).from_int = function (i: bigint, layout: TyAndLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_int");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:312 from_bool (lane interp-place-operand)
(ImmTy as { from_bool: typeof ImmTy.from_bool }).from_bool = function (b: boolean, tcx: TyCtxt): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_bool");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:321 from_ordering (lane interp-place-operand)
(ImmTy as { from_ordering: typeof ImmTy.from_ordering }).from_ordering = function (c: Ordering, tcx: TyCtxt): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_ordering");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:329 from_pair (lane interp-place-operand)
(ImmTy as { from_pair: typeof ImmTy.from_pair }).from_pair = function (a: ImmTy, b: ImmTy, cx: [HasTypingEnv]): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::from_pair");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:342 to_scalar_int (lane interp-place-operand)
ImmTy.prototype.to_scalar_int = function (this: ImmTy): InterpResult<ScalarInt> {
  return unported("rustc_const_eval::interpret::operand::ImmTy::to_scalar_int");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:349 to_const_int (lane interp-place-operand)
ImmTy.prototype.to_const_int = function (this: ImmTy): ConstInt {
  return unported("rustc_const_eval::interpret::operand::ImmTy::to_const_int");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:358 to_pair (lane interp-place-operand)
ImmTy.prototype.to_pair = function (this: ImmTy, cx: [HasTyCtxt]): [ImmTy, ImmTy] {
  return unported("rustc_const_eval::interpret::operand::ImmTy::to_pair");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:370 offset_ (lane interp-place-operand)
ImmTy.prototype.offset_ = function (this: ImmTy, offset: Size, layout: TyAndLayout, cx: HasDataLayout): ImmTy {
  return unported("rustc_const_eval::interpret::operand::ImmTy::offset_");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:445 layout (lane interp-place-operand)
ImmTy.prototype.layout_ = function (this: ImmTy): TyAndLayout {
  return unported("rustc_const_eval::interpret::operand::ImmTy::layout");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:450 meta (lane interp-place-operand)
ImmTy.prototype.meta = function (this: ImmTy): MemPlaceMeta {
  return unported("rustc_const_eval::interpret::operand::ImmTy::meta");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:455 offset_with_meta (lane interp-place-operand)
ImmTy.prototype.offset_with_meta = function (this: ImmTy, offset: Size, _mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operand::ImmTy::offset_with_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:468 to_op (lane interp-place-operand)
ImmTy.prototype.to_op = function (this: ImmTy, _ecx: InterpCx): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::ImmTy::to_op");
};

// impl Debug for OpTy
// stub: compiler/rustc_const_eval/src/interpret/operand.rs:492 fmt (lane interp-place-operand)
export function debug_OpTy(self: OpTy, f: Fmt): string {
  return unported("rustc_const_eval::interpret::operand::OpTy::fmt");
}

// impl From<ImmTy<'tcx, Prov>> for OpTy
// stub: compiler/rustc_const_eval/src/interpret/operand.rs:503 from (lane interp-place-operand)
export function OpTy_from_ImmTy(val: ImmTy): OpTy {
  return unported("rustc_const_eval::interpret::operand::OpTy::from");
}

// impl From<MPlaceTy<'tcx, Prov>> for OpTy
// stub: compiler/rustc_const_eval/src/interpret/operand.rs:510 from (lane interp-place-operand)
export function OpTy_from_MPlaceTy(mplace: MPlaceTy): OpTy {
  return unported("rustc_const_eval::interpret::operand::OpTy::from");
}

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:517 op (lane interp-place-operand)
OpTy.prototype.op_ = function (this: OpTy): Operand {
  return unported("rustc_const_eval::interpret::operand::OpTy::op");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:521 is_immediate_uninit (lane interp-place-operand)
OpTy.prototype.is_immediate_uninit = function (this: OpTy): boolean {
  return unported("rustc_const_eval::interpret::operand::OpTy::is_immediate_uninit");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:528 layout (lane interp-place-operand)
OpTy.prototype.layout_ = function (this: OpTy): TyAndLayout {
  return unported("rustc_const_eval::interpret::operand::OpTy::layout");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:533 meta (lane interp-place-operand)
OpTy.prototype.meta = function (this: OpTy): MemPlaceMeta {
  return unported("rustc_const_eval::interpret::operand::OpTy::meta");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:543 offset_with_meta (lane interp-place-operand)
OpTy.prototype.offset_with_meta = function (this: OpTy, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::OpTy::offset_with_meta");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:564 to_op (lane interp-place-operand)
OpTy.prototype.to_op = function (this: OpTy, _ecx: InterpCx): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::OpTy::to_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:577 read_immediate_from_mplace_raw (lane interp-place-operand)
InterpCx.prototype.read_immediate_from_mplace_raw = function (this: InterpCx, mplace: MPlaceTy): InterpResult<ImmTy | undefined> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_immediate_from_mplace_raw");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:642 read_immediate_raw (lane interp-place-operand)
InterpCx.prototype.read_immediate_raw = function (this: InterpCx, src: Projectable): InterpResult<Either<MPlaceTy, ImmTy>> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_immediate_raw");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:662 read_immediate (lane interp-place-operand)
InterpCx.prototype.read_immediate = function (this: InterpCx, op: Projectable): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_immediate");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:685 read_scalar (lane interp-place-operand)
InterpCx.prototype.read_scalar = function (this: InterpCx, op: Projectable): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_scalar");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:696 read_pointer (lane interp-place-operand)
InterpCx.prototype.read_pointer = function (this: InterpCx, op: Projectable): InterpResult<Pointer<CtfeProvenance | undefined>> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_pointer");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:703 read_target_usize (lane interp-place-operand)
InterpCx.prototype.read_target_usize = function (this: InterpCx, op: Projectable): InterpResult<bigint> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_target_usize");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:710 read_target_isize (lane interp-place-operand)
InterpCx.prototype.read_target_isize = function (this: InterpCx, op: Projectable): InterpResult<bigint> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_target_isize");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:718 read_str (lane interp-place-operand)
InterpCx.prototype.read_str = function (this: InterpCx, mplace: MPlaceTy): InterpResult<string> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::read_str");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:727 local_to_op (lane interp-place-operand)
InterpCx.prototype.local_to_op = function (this: InterpCx, local: Local, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::local_to_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:750 ghost_local_in_frame_to_op (lane interp-place-operand)
InterpCx.prototype.ghost_local_in_frame_to_op = function (this: InterpCx, frame: Frame, local: Local): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::ghost_local_in_frame_to_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:763 place_to_op (lane interp-place-operand)
InterpCx.prototype.place_to_op = function (this: InterpCx, place: PlaceTy): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::place_to_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:787 eval_place_to_op (lane interp-place-operand)
InterpCx.prototype.eval_place_to_op = function (this: InterpCx, mir_place: mir_Place, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::eval_place_to_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operand.rs:837 eval_operand (lane interp-place-operand)
InterpCx.prototype.eval_operand = function (this: InterpCx, mir_op: mir_Operand, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  return unported("rustc_const_eval::interpret::operand::InterpCx::eval_operand");
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:871 const_val_to_op
InterpCx.prototype.const_val_to_op = function (this: InterpCx, val_val: ConstValue, ty: Ty, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  // Other cases need layout.
  const adjust_scalar = (scalar: Scalar): InterpResult<Scalar> => {
    switch (scalar.$) {
      case "Ptr": {
        const r = this.global_root_pointer(scalar._0);
        if (r.$ === "Err") return r;
        return interp_ok<Scalar>({ $: "Ptr", _0: r._0, _1: scalar._1 });
      }
      case "Int":
        return interp_ok<Scalar>({ $: "Int", _0: scalar._0 });
    }
  };
  const layout_r = from_known_layout(this.tcx, this.typing_env_(), layout, () => {
    const r = this.layout_of(ty);
    return r.$ === "Err" ? Err(InterpErrorInfo_from_InterpErrorKind(r._0)) : r;
  });
  if (layout_r.$ === "Err") return layout_r;
  const layout_ = layout_r._0;
  let imm: Immediate;
  switch (val_val.$) {
    case "Indirect": {
      const { alloc_id, offset } = val_val;
      // This is const data, no mutation allowed.
      const ptr_r = this.global_root_pointer(Pointer.new(CtfeProvenance.as_immutable(CtfeProvenance_from_AllocId(alloc_id)), offset));
      if (ptr_r.$ === "Err") return ptr_r;
      return interp_ok(OpTy_from_MPlaceTy(this.ptr_to_mplace(Pointer_Option_from_Pointer(ptr_r._0), layout_)));
    }
    case "Scalar": {
      const r = adjust_scalar(val_val._0);
      if (r.$ === "Err") return r;
      imm = Immediate_from_Scalar(r._0);
      break;
    }
    case "ZeroSized":
      imm = Immediate.Uninit;
      break;
    case "Slice": {
      const { alloc_id, meta } = val_val;
      // This is const data, no mutation allowed.
      const ptr = Pointer.new(CtfeProvenance.as_immutable(CtfeProvenance_from_AllocId(alloc_id)), Size.ZERO);
      const r = this.global_root_pointer(ptr);
      if (r.$ === "Err") return r;
      imm = Immediate.new_slice(Pointer_Option_from_Pointer(r._0), BigInt(meta), this);
      break;
    }
  }
  return interp_ok(new OpTy({ $: "Immediate", _0: imm }, layout_));
};
