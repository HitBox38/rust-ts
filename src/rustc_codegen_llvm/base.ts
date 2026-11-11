// compiler/rustc_codegen_llvm/src/base.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave
// 41) owns this file and ports base.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: typed stubs of `compile_codegen_unit`, which back/llvm_backend.ts's `ExtraBackendMethods` impl calls, and of
// the fns other fill lanes call (review F2).
import type { ModuleCodegen } from "../rustc_codegen_ssa/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import type { ModuleLlvm } from "./back/llvm_backend.ts";
import type { Linkage } from "../rustc_attr_ir/data_structures.gen.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type * as llvm from "./llvm/mod.ts";
import type { Value } from "./llvm/mod.ts";

/** `-> (ModuleCodegen<ModuleLlvm>, u64)`: the `u64` is a cost estimate, a `number` as `ExtraBackendMethods` has it. */
// Stub (cg-contract): compile_codegen_unit (base.rs:63)
export function compile_codegen_unit(_tcx: TyCtxt, _cgu_name: Symbol, _bitcode_needed: boolean): [ModuleCodegen<ModuleLlvm>, number] {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/base.rs compile_codegen_unit");
}

// Cross-lane surface (cg-contract, review F2)
// Stub (cg-contract): set_link_section (base.rs:224)
export function set_link_section(_llval: Value, _attrs: CodegenFnAttrs): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/base.rs set_link_section");
}

// Stub (cg-contract): linkage_to_llvm (base.rs:230)
export function linkage_to_llvm(_linkage: Linkage): llvm.Linkage {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/base.rs linkage_to_llvm");
}

// Stub (cg-contract): set_variable_sanitizer_attrs (base.rs:251)
export function set_variable_sanitizer_attrs(_llval: Value, _attrs: CodegenFnAttrs): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/base.rs set_variable_sanitizer_attrs");
}
