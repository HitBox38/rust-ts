// compiler/rustc_codegen_llvm/src/consts.rs: the SKELETON (lane cg-contract). The fill lane cg-abi-consts (plan-m7 §8 wave 41) owns this file and ports
// consts.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl StaticCodegenMethods for CodegenCx`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { StaticCodegenMethods } from "../rustc_codegen_ssa/traits/statics.ts";
import type { ConstAllocation } from "../rustc_middle/mir/interpret/allocation.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Value } from "./llvm/mod.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx } from "./context.ts";

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
