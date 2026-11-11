// compiler/rustc_codegen_llvm/src/intrinsic.rs: the SKELETON (lane cg-contract). The fill lane cg-intrinsic-a (plan-m7 §8 wave 41; the SIMD half, :2047-end, is cg-intrinsic-b's) owns this file and ports
// intrinsic.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl IntrinsicCallBuilderMethods for Builder`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { RetagInfo } from "../rustc_codegen_ssa/lib.ts";
import type { IntrinsicResult } from "../rustc_codegen_ssa/mir/mod.ts";
import type { OperandRef } from "../rustc_codegen_ssa/mir/operand.ts";
import type { PlaceValue } from "../rustc_codegen_ssa/mir/place.ts";
import type { IntrinsicCallBuilderMethods } from "../rustc_codegen_ssa/traits/intrinsic.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Value } from "./llvm/mod.ts";
import { unported } from "../std/panic.ts";
import { Builder } from "./builder.ts";

// ---- impl IntrinsicCallBuilderMethods for Builder (intrinsic.rs:177) ----
declare module "./builder.ts" {
  interface Builder {
    codegen_intrinsic_call(instance: Instance, args: readonly OperandRef<Value>[], result_layout: TyAndLayout, result_place: PlaceValue<Value> | undefined, span: Span): IntrinsicResult<Value>;
    codegen_llvm_intrinsic_call(instance: Instance, args: readonly OperandRef<Value>[], is_cleanup: boolean): Value;
    abort_immediate(): void;
    assume(val: Value): void;
    expect(cond: Value, expected: boolean): Value;
    ctpop(val: Value): Value;
    type_checked_load(llvtable: Value, vtable_byte_offset: number, typeid: Uint8Array): Value;
    va_start(val: Value): void;
    retag_mem(place: Value, info: RetagInfo<Value>): void;
    retag_reg(ptr: Value, info: RetagInfo<Value>): Value;
  }
}

// Stub (cg-contract): IntrinsicCallBuilderMethods::codegen_intrinsic_call
Builder.prototype.codegen_intrinsic_call = function (this: Builder, _instance: Instance, _args: readonly OperandRef<Value>[], _result_layout: TyAndLayout, _result_place: PlaceValue<Value> | undefined, _span: Span): IntrinsicResult<Value> {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs codegen_intrinsic_call");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::codegen_llvm_intrinsic_call
Builder.prototype.codegen_llvm_intrinsic_call = function (this: Builder, _instance: Instance, _args: readonly OperandRef<Value>[], _is_cleanup: boolean): Value {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs codegen_llvm_intrinsic_call");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::abort_immediate
Builder.prototype.abort_immediate = function (this: Builder): void {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs abort_immediate");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::assume
Builder.prototype.assume = function (this: Builder, _val: Value): void {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs assume");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::expect
Builder.prototype.expect = function (this: Builder, _cond: Value, _expected: boolean): Value {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs expect");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::ctpop
Builder.prototype.ctpop = function (this: Builder, _val: Value): Value {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs ctpop");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::type_checked_load
Builder.prototype.type_checked_load = function (this: Builder, _llvtable: Value, _vtable_byte_offset: number, _typeid: Uint8Array): Value {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs type_checked_load");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::va_start
Builder.prototype.va_start = function (this: Builder, _val: Value): void {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs va_start");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::retag_mem
Builder.prototype.retag_mem = function (this: Builder, _place: Value, _info: RetagInfo<Value>): void {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs retag_mem");
};

// Stub (cg-contract): IntrinsicCallBuilderMethods::retag_reg
Builder.prototype.retag_reg = function (this: Builder, _ptr: Value, _info: RetagInfo<Value>): Value {
  return unported("cg-intrinsic-a: compiler/rustc_codegen_llvm/src/intrinsic.rs retag_reg");
};
