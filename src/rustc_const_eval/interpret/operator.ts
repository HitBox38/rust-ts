// Port of compiler/rustc_const_eval/src/interpret/operator.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { AtomicRmwOp } from "./operator.gen.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BinOp, type UnOp } from "../../rustc_middle/mir/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { unported } from "../../std/panic.ts";
import { ImmTy } from "./operand.gen.ts";

export * from "./operator.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // operator.rs:27 (lane interp-ops)
    three_way_compare<T>(lhs: T, rhs: T): ImmTy;
    // operator.rs:32 (lane interp-ops)
    binary_char_op(bin_op: BinOp, l: number, r: number): ImmTy;
    // operator.rs:51 (lane interp-ops)
    binary_bool_op(bin_op: BinOp, l: boolean, r: boolean): ImmTy;
    // operator.rs:69 (lane interp-ops)
    binary_float_op<F>(bin_op: BinOp, layout: TyAndLayout, l: F, r: F): ImmTy;
    // operator.rs:97 (lane interp-ops)
    binary_int_op(bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:304 (lane interp-ops)
    compute_size_in_bytes(elem_size: Size, count: bigint): Size | undefined;
    // operator.rs:316 (lane interp-ops)
    binary_ptr_op(bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:367 (lane interp-ops)
    binary_op(bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:445 (lane interp-ops)
    unary_op(un_op: UnOp, val: ImmTy): InterpResult<ImmTy>;
    // operator.rs:521 (lane interp-ops)
    atomic_rmw_op(op: AtomicRmwOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:27 three_way_compare (lane interp-ops)
InterpCx.prototype.three_way_compare = function <T>(this: InterpCx, lhs: T, rhs: T): ImmTy {
  return unported("rustc_const_eval::interpret::operator::InterpCx::three_way_compare");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:32 binary_char_op (lane interp-ops)
InterpCx.prototype.binary_char_op = function (this: InterpCx, bin_op: BinOp, l: number, r: number): ImmTy {
  return unported("rustc_const_eval::interpret::operator::InterpCx::binary_char_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:51 binary_bool_op (lane interp-ops)
InterpCx.prototype.binary_bool_op = function (this: InterpCx, bin_op: BinOp, l: boolean, r: boolean): ImmTy {
  return unported("rustc_const_eval::interpret::operator::InterpCx::binary_bool_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:69 binary_float_op (lane interp-ops)
InterpCx.prototype.binary_float_op = function <F>(this: InterpCx, bin_op: BinOp, layout: TyAndLayout, l: F, r: F): ImmTy {
  return unported("rustc_const_eval::interpret::operator::InterpCx::binary_float_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:97 binary_int_op (lane interp-ops)
InterpCx.prototype.binary_int_op = function (this: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operator::InterpCx::binary_int_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:304 compute_size_in_bytes (lane interp-ops)
InterpCx.prototype.compute_size_in_bytes = function (this: InterpCx, elem_size: Size, count: bigint): Size | undefined {
  return unported("rustc_const_eval::interpret::operator::InterpCx::compute_size_in_bytes");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:316 binary_ptr_op (lane interp-ops)
InterpCx.prototype.binary_ptr_op = function (this: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operator::InterpCx::binary_ptr_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:367 binary_op (lane interp-ops)
InterpCx.prototype.binary_op = function (this: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operator::InterpCx::binary_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:445 unary_op (lane interp-ops)
InterpCx.prototype.unary_op = function (this: InterpCx, un_op: UnOp, val: ImmTy): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operator::InterpCx::unary_op");
};

// stub: compiler/rustc_const_eval/src/interpret/operator.rs:521 atomic_rmw_op (lane interp-ops)
InterpCx.prototype.atomic_rmw_op = function (this: InterpCx, op: AtomicRmwOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::operator::InterpCx::atomic_rmw_op");
};
