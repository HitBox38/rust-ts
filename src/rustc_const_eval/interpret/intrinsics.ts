// Port of compiler/rustc_const_eval/src/interpret/intrinsics.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-intrinsics; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { InterpCx } from "./eval_context.ts";
import { MinMax, MulAddType, VarArgCompatible } from "./intrinsics.gen.ts";
import { type Machine } from "./machine.ts";
import { type Writeable } from "./place.ts";
import { type AllocId, type CtfeProvenance, type InterpResult, type Pointer, type Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type BinOp, type NonDivergingIntrinsic } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { type Round } from "../../vendor/rustc_apfloat/lib.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";
import type { Status } from "../../vendor/rustc_apfloat/lib.ts";

export * from "./intrinsics.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // intrinsics.rs:87 (lane interp-intrinsics)
    write_type_id(ty: Ty, dest: Writeable): InterpResult<undefined>;
    // intrinsics.rs:124 (lane interp-intrinsics)
    read_type_id(op: OpTy): InterpResult<Ty>;
    // intrinsics.rs:172 (lane interp-intrinsics)
    eval_intrinsic(instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean>;
    // intrinsics.rs:820 (lane interp-intrinsics)
    validate_c_variadic_argument(arg_mplace: MPlaceTy, callee_type: TyAndLayout): InterpResult;
    // intrinsics.rs:868 (lane interp-intrinsics)
    validate_c_variadic_compatible_ty(caller_type: Ty, callee_type: Ty): InterpResult<VarArgCompatible>;
    // intrinsics.rs:945 (lane interp-intrinsics)
    eval_nondiverging_intrinsic(intrinsic: NonDivergingIntrinsic): InterpResult;
    // intrinsics.rs:971 (lane interp-intrinsics)
    numeric_intrinsic(name: Symbol, val: Scalar, layout: TyAndLayout, ret_layout: TyAndLayout): InterpResult<Scalar>;
    // intrinsics.rs:1001 (lane interp-intrinsics)
    exact_div(a: ImmTy, b: ImmTy, dest: PlaceTy): InterpResult;
    // intrinsics.rs:1023 (lane interp-intrinsics)
    saturating_arith(mir_op: BinOp, l: ImmTy, r: ImmTy): InterpResult<Scalar>;
    // intrinsics.rs:1069 (lane interp-intrinsics)
    ptr_offset_inbounds(ptr: Pointer<CtfeProvenance | undefined>, offset_bytes: bigint): InterpResult<Pointer<CtfeProvenance | undefined>>;
    // intrinsics.rs:1085 (lane interp-intrinsics)
    copy_intrinsic(src: OpTy, dst: OpTy, count: OpTy, nonoverlapping: boolean): InterpResult;
    // intrinsics.rs:1113 (lane interp-intrinsics)
    typed_swap_nonoverlapping_intrinsic(left: OpTy, right: OpTy): InterpResult;
    // intrinsics.rs:1146 (lane interp-intrinsics)
    write_bytes_intrinsic(dst: OpTy, byte: OpTy, count: OpTy, name: string): InterpResult;
    // intrinsics.rs:1169 (lane interp-intrinsics)
    compare_bytes_intrinsic(left: OpTy, right: OpTy, byte_count: OpTy): InterpResult<Scalar>;
    // intrinsics.rs:1187 (lane interp-intrinsics)
    raw_eq_intrinsic(lhs: OpTy, rhs: OpTy): InterpResult<Scalar>;
    // intrinsics.rs:1212 (lane interp-intrinsics)
    unop_float_intrinsic<F>(name: Symbol, arg: ImmTy): InterpResult<Scalar>;
    // intrinsics.rs:1228 (lane interp-intrinsics)
    float_minmax<F>(a: Scalar, b: Scalar, op: MinMax): InterpResult<Scalar>;
    // intrinsics.rs:1256 (lane interp-intrinsics)
    float_minmax_intrinsic<F>(args: readonly OpTy[], op: MinMax, dest: PlaceTy): InterpResult<undefined>;
    // intrinsics.rs:1271 (lane interp-intrinsics)
    float_copysign_intrinsic<F>(args: readonly OpTy[], dest: PlaceTy): InterpResult<undefined>;
    // intrinsics.rs:1286 (lane interp-intrinsics)
    float_round<F>(x: Scalar, mode: Round): InterpResult<Scalar>;
    // intrinsics.rs:1300 (lane interp-intrinsics)
    float_round_intrinsic<F>(args: readonly OpTy[], dest: PlaceTy, mode: Round): InterpResult<undefined>;
    // intrinsics.rs:1314 (lane interp-intrinsics)
    float_muladd<F>(a: Scalar, b: Scalar, c: Scalar, typ: MulAddType): InterpResult<Scalar>;
    // intrinsics.rs:1335 (lane interp-intrinsics)
    float_muladd_intrinsic<F>(args: readonly OpTy[], dest: PlaceTy, typ: MulAddType): InterpResult<undefined>;
    // intrinsics.rs:1356 (lane interp-intrinsics)
    float_to_int_checked(src: ImmTy, cast_to: TyAndLayout, round: Round): InterpResult<ImmTy | undefined>;
    // intrinsics.rs:1416 (lane interp-intrinsics)
    va_list_key_field<P>(va_list: unknown): InterpResult<unknown>;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:79 alloc_type_name (lane interp-intrinsics)
export function alloc_type_name(tcx: TyCtxt, ty: Ty): [AllocId, bigint] {
  return unported("rustc_const_eval::interpret::intrinsics::alloc_type_name");
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:87 write_type_id (lane interp-intrinsics)
InterpCx.prototype.write_type_id = function (this: InterpCx, ty: Ty, dest: Writeable): InterpResult<undefined> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::write_type_id");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:124 read_type_id (lane interp-intrinsics)
InterpCx.prototype.read_type_id = function (this: InterpCx, op: OpTy): InterpResult<Ty> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::read_type_id");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:172 eval_intrinsic (lane interp-intrinsics)
InterpCx.prototype.eval_intrinsic = function (this: InterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::eval_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:820 validate_c_variadic_argument (lane interp-intrinsics)
InterpCx.prototype.validate_c_variadic_argument = function (this: InterpCx, arg_mplace: MPlaceTy, callee_type: TyAndLayout): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::validate_c_variadic_argument");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:868 validate_c_variadic_compatible_ty (lane interp-intrinsics)
InterpCx.prototype.validate_c_variadic_compatible_ty = function (this: InterpCx, caller_type: Ty, callee_type: Ty): InterpResult<VarArgCompatible> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::validate_c_variadic_compatible_ty");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:945 eval_nondiverging_intrinsic (lane interp-intrinsics)
InterpCx.prototype.eval_nondiverging_intrinsic = function (this: InterpCx, intrinsic: NonDivergingIntrinsic): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::eval_nondiverging_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:971 numeric_intrinsic (lane interp-intrinsics)
InterpCx.prototype.numeric_intrinsic = function (this: InterpCx, name: Symbol, val: Scalar, layout: TyAndLayout, ret_layout: TyAndLayout): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::numeric_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1001 exact_div (lane interp-intrinsics)
InterpCx.prototype.exact_div = function (this: InterpCx, a: ImmTy, b: ImmTy, dest: PlaceTy): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::exact_div");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1023 saturating_arith (lane interp-intrinsics)
InterpCx.prototype.saturating_arith = function (this: InterpCx, mir_op: BinOp, l: ImmTy, r: ImmTy): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::saturating_arith");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1069 ptr_offset_inbounds (lane interp-intrinsics)
InterpCx.prototype.ptr_offset_inbounds = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, offset_bytes: bigint): InterpResult<Pointer<CtfeProvenance | undefined>> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::ptr_offset_inbounds");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1085 copy_intrinsic (lane interp-intrinsics)
InterpCx.prototype.copy_intrinsic = function (this: InterpCx, src: OpTy, dst: OpTy, count: OpTy, nonoverlapping: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::copy_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1113 typed_swap_nonoverlapping_intrinsic (lane interp-intrinsics)
InterpCx.prototype.typed_swap_nonoverlapping_intrinsic = function (this: InterpCx, left: OpTy, right: OpTy): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::typed_swap_nonoverlapping_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1146 write_bytes_intrinsic (lane interp-intrinsics)
InterpCx.prototype.write_bytes_intrinsic = function (this: InterpCx, dst: OpTy, byte: OpTy, count: OpTy, name: string): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::write_bytes_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1169 compare_bytes_intrinsic (lane interp-intrinsics)
InterpCx.prototype.compare_bytes_intrinsic = function (this: InterpCx, left: OpTy, right: OpTy, byte_count: OpTy): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::compare_bytes_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1187 raw_eq_intrinsic (lane interp-intrinsics)
InterpCx.prototype.raw_eq_intrinsic = function (this: InterpCx, lhs: OpTy, rhs: OpTy): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::raw_eq_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1212 unop_float_intrinsic (lane interp-intrinsics)
InterpCx.prototype.unop_float_intrinsic = function <F>(this: InterpCx, name: Symbol, arg: ImmTy): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::unop_float_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1228 float_minmax (lane interp-intrinsics)
InterpCx.prototype.float_minmax = function <F>(this: InterpCx, a: Scalar, b: Scalar, op: MinMax): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_minmax");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1256 float_minmax_intrinsic (lane interp-intrinsics)
InterpCx.prototype.float_minmax_intrinsic = function <F>(this: InterpCx, args: readonly OpTy[], op: MinMax, dest: PlaceTy): InterpResult<undefined> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_minmax_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1271 float_copysign_intrinsic (lane interp-intrinsics)
InterpCx.prototype.float_copysign_intrinsic = function <F>(this: InterpCx, args: readonly OpTy[], dest: PlaceTy): InterpResult<undefined> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_copysign_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1286 float_round (lane interp-intrinsics)
InterpCx.prototype.float_round = function <F>(this: InterpCx, x: Scalar, mode: Round): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_round");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1300 float_round_intrinsic (lane interp-intrinsics)
InterpCx.prototype.float_round_intrinsic = function <F>(this: InterpCx, args: readonly OpTy[], dest: PlaceTy, mode: Round): InterpResult<undefined> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_round_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1314 float_muladd (lane interp-intrinsics)
InterpCx.prototype.float_muladd = function <F>(this: InterpCx, a: Scalar, b: Scalar, c: Scalar, typ: MulAddType): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_muladd");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1335 float_muladd_intrinsic (lane interp-intrinsics)
InterpCx.prototype.float_muladd_intrinsic = function <F>(this: InterpCx, args: readonly OpTy[], dest: PlaceTy, typ: MulAddType): InterpResult<undefined> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_muladd_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1356 float_to_int_checked (lane interp-intrinsics)
InterpCx.prototype.float_to_int_checked = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout, round: Round): InterpResult<ImmTy | undefined> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::float_to_int_checked");
};

// PORT: nested in `float_to_int_checked` upstream; moves inside its parent when ported.
// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1362 float_to_int_inner (lane interp-intrinsics)
function float_to_int_inner<F>(ecx: InterpCx, src: F, cast_to: TyAndLayout, round: Round): [Scalar, Status] {
  return unported("rustc_const_eval::interpret::intrinsics::float_to_int_checked::float_to_int_inner");
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1416 va_list_key_field (lane interp-intrinsics)
InterpCx.prototype.va_list_key_field = function <P>(this: InterpCx, va_list: unknown): InterpResult<unknown> {
  return unported("rustc_const_eval::interpret::intrinsics::InterpCx::va_list_key_field");
};
