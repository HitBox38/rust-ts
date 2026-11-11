// compiler/rustc_codegen_llvm/src/va_arg.rs: the SKELETON (lane cg-contract). The fill lane cg-intrinsic-b (plan-m7 §8 wave 43)
// owns this file and ports va_arg.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns of va_arg.rs that other fill lanes call (review F2), as typed stubs.
import type { OperandRef } from "../rustc_codegen_ssa/mir/operand.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { unported } from "../std/panic.ts";
import type { Builder } from "./builder.ts";
import type { Value } from "./llvm/mod.ts";

// Stub (cg-contract): emit_va_arg (va_arg.rs:1053)
export function emit_va_arg(_bx: Builder, _addr: OperandRef<Value>, _layout: TyAndLayout): Value {
  return unported("cg-intrinsic-b: compiler/rustc_codegen_llvm/src/va_arg.rs emit_va_arg");
}
