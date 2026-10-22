// Port of compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-simd; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type Endian, type Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../eval_context.ts";
import { MinMax } from "../intrinsics.ts";
import { type Machine } from "../machine.ts";
import { type CtfeProvenance, type InterpResult, type Pointer, type Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock } from "../../../rustc_middle/mir/mod.ts";
import { type SimdAlign } from "../../../rustc_middle/ty/consts/int.ts";
import { type GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import { type TyAndLayout } from "../../../rustc_middle/ty/layout.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { unported } from "../../../std/panic.ts";
import { ImmTy, OpTy } from "../operand.gen.ts";
import { PlaceTy } from "../place.gen.ts";

declare module "../eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // simd.rs:22 (lane interp-simd)
    eval_simd_intrinsic(intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean>;
    // simd.rs:815 (lane interp-simd)
    fminmax_op(op: MinMax, left: ImmTy, right: ImmTy): InterpResult<Scalar>;
    // simd.rs:835 (lane interp-simd)
    check_simd_ptr_alignment(ptr: Pointer<CtfeProvenance | undefined>, vector_layout: TyAndLayout, alignment: SimdAlign): InterpResult;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:22 eval_simd_intrinsic (lane interp-simd)
InterpCx.prototype.eval_simd_intrinsic = function (this: InterpCx, intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::intrinsics::simd::InterpCx::eval_simd_intrinsic");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:815 fminmax_op (lane interp-simd)
InterpCx.prototype.fminmax_op = function (this: InterpCx, op: MinMax, left: ImmTy, right: ImmTy): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::intrinsics::simd::InterpCx::fminmax_op");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:835 check_simd_ptr_alignment (lane interp-simd)
InterpCx.prototype.check_simd_ptr_alignment = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, vector_layout: TyAndLayout, alignment: SimdAlign): InterpResult {
  return unported("rustc_const_eval::interpret::intrinsics::simd::InterpCx::check_simd_ptr_alignment");
};

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:873 simd_bitmask_index (lane interp-simd)
export function simd_bitmask_index(idx: number, vec_len: number, endianness: Endian): number {
  return unported("rustc_const_eval::interpret::intrinsics::simd::simd_bitmask_index");
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:882 bool_to_simd_element (lane interp-simd)
export function bool_to_simd_element<Prov>(b: boolean, size: Size): Scalar {
  return unported("rustc_const_eval::interpret::intrinsics::simd::bool_to_simd_element");
}

// stub: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:890 simd_element_to_bool (lane interp-simd)
export function simd_element_to_bool<Prov>(elem: ImmTy): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::intrinsics::simd::simd_element_to_bool");
}
