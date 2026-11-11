// compiler/rustc_codegen_llvm/src/mono_item.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave 41) owns this file and ports
// mono_item.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl PreDefineCodegenMethods for CodegenCx`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { Linkage } from "../rustc_attr_ir/data_structures.gen.ts";
import type { PreDefineCodegenMethods } from "../rustc_codegen_ssa/traits/declare.ts";
import type { Visibility } from "../rustc_middle/mono.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx } from "./context.ts";
import type { Value } from "./llvm/mod.ts";

// ---- impl PreDefineCodegenMethods for CodegenCx (mono_item.rs:26) ----
declare module "./context.ts" {
  interface CodegenCx {
    predefine_static(def_id: DefId, linkage: Linkage, visibility: Visibility, symbol_name: string): void;
    predefine_fn(instance: Instance, linkage: Linkage, visibility: Visibility, symbol_name: string): void;
  }
}

// Stub (cg-contract): PreDefineCodegenMethods::predefine_static
CodegenCx.prototype.predefine_static = function (this: CodegenCx, _def_id: DefId, _linkage: Linkage, _visibility: Visibility, _symbol_name: string): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/mono_item.rs predefine_static");
};

// Stub (cg-contract): PreDefineCodegenMethods::predefine_fn
CodegenCx.prototype.predefine_fn = function (this: CodegenCx, _instance: Instance, _linkage: Linkage, _visibility: Visibility, _symbol_name: string): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/mono_item.rs predefine_fn");
};

// ---- impl CodegenCx (mono_item.rs:78): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface CodegenCx {
    assume_dso_local(llval: Value, is_declaration: boolean): boolean;
  }
}

// Stub (cg-contract): assume_dso_local (mono_item.rs:233)
CodegenCx.prototype.assume_dso_local = function (this: CodegenCx, _llval: Value, _is_declaration: boolean): boolean {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/mono_item.rs assume_dso_local");
};
