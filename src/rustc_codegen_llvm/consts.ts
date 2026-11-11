// compiler/rustc_codegen_llvm/src/consts.rs: the SKELETON (lane cg-contract). The fill lane cg-abi-consts (plan-m7 §8 wave 41) owns this file and ports
// consts.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns and enums other fill lanes use (review F2; `IsStatic`, `IsInitOrFini` ported), and `impl
// StaticCodegenMethods for CodegenCx`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { StaticCodegenMethods } from "../rustc_codegen_ssa/traits/statics.ts";
import type { ConstAllocation } from "../rustc_middle/mir/interpret/allocation.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Type, Value } from "./llvm/mod.ts";
import type { Align } from "../rustc_abi/lib.ts";
import type { Allocation } from "../rustc_middle/mir/interpret/allocation.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx } from "./context.ts";

// ---- Cross-lane surface (cg-contract, review F2) ----
/// Indicates whether a symbol is a `static` (consts.rs:28).
export type IsStatic = "Yes" | "No";
export const IsStatic = { Yes: "Yes", No: "No" } as const;
/// Indicates whether a symbol is part of `.init_array` or `.fini_array`.
export type IsInitOrFini = "Yes" | "No";
export const IsInitOrFini = { Yes: "Yes", No: "No" } as const;

// Stub (cg-contract): const_alloc_to_llvm (consts.rs:39)
export function const_alloc_to_llvm(_cx: CodegenCx, _alloc: Allocation, _is_static: IsStatic, _is_init_fini: IsInitOrFini): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs const_alloc_to_llvm");
}

// ---- impl CodegenCx (consts.rs:283) ----
declare module "./context.ts" {
  interface CodegenCx {
    const_bitcast(val: Value, ty: Type): Value;
    const_pointercast(val: Value, ty: Type): Value;
    static_addr_of_mut(cv: Value, align: Align, kind: string | undefined): Value;
    static_addr_of_impl(cv: Value, align: Align, kind: string | undefined): Value;
    get_static(def_id: DefId): Value;
    define_objc_module_info(): void;
  }
}

// Stub (cg-contract): const_bitcast (consts.rs:284)
CodegenCx.prototype.const_bitcast = function (this: CodegenCx, _val: Value, _ty: Type): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs const_bitcast");
};

// Stub (cg-contract): const_pointercast (consts.rs:288)
CodegenCx.prototype.const_pointercast = function (this: CodegenCx, _val: Value, _ty: Type): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs const_pointercast");
};

// Stub (cg-contract): static_addr_of_mut (consts.rs:296)
CodegenCx.prototype.static_addr_of_mut = function (this: CodegenCx, _cv: Value, _align: Align, _kind: string | undefined): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs static_addr_of_mut");
};

// Stub (cg-contract): static_addr_of_impl (consts.rs:324)
CodegenCx.prototype.static_addr_of_impl = function (this: CodegenCx, _cv: Value, _align: Align, _kind: string | undefined): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs static_addr_of_impl");
};

// Stub (cg-contract): get_static (consts.rs:349)
CodegenCx.prototype.get_static = function (this: CodegenCx, _def_id: DefId): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs get_static");
};

// Stub (cg-contract): define_objc_module_info (consts.rs:874)
CodegenCx.prototype.define_objc_module_info = function (this: CodegenCx): void {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs define_objc_module_info");
};

// ---- impl StaticCodegenMethods for CodegenCx (consts.rs:909) ----
declare module "./context.ts" {
  interface CodegenCx {
    static_addr_of(alloc: ConstAllocation, kind: string | undefined): Value;
    codegen_static(def_id: DefId): void;
  }
}

// Stub (cg-contract): StaticCodegenMethods::static_addr_of
CodegenCx.prototype.static_addr_of = function (this: CodegenCx, _alloc: ConstAllocation, _kind: string | undefined): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs static_addr_of");
};

// Stub (cg-contract): StaticCodegenMethods::codegen_static
CodegenCx.prototype.codegen_static = function (this: CodegenCx, _def_id: DefId): void {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/consts.rs codegen_static");
};
