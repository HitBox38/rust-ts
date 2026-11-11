// compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs: the SKELETON (lane cg-contract). The debuginfo fill lane (cg-di-a or
// cg-di-b, plan-m7 §8 wave 44; root's split) owns this file and ports metadata.rs here, replacing each `Stub (cg-contract)`.
//
// What is here: the fns of metadata.rs that other fill lanes call (review F2), as typed stubs.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import { unported } from "../../std/panic.ts";
import type { CodegenCx } from "../context.ts";
import type { DIDescriptor, Value } from "../llvm/mod.ts";
import type { CodegenUnitDebugContext } from "./mod.ts";

// Stub (cg-contract): build_compile_unit_di_node (debuginfo/metadata.rs:876)
export function build_compile_unit_di_node(_tcx: TyCtxt, _codegen_unit_name: string, _debug_context: CodegenUnitDebugContext): DIDescriptor {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs build_compile_unit_di_node");
}

// Stub (cg-contract): build_global_var_di_node (debuginfo/metadata.rs:1473)
export function build_global_var_di_node(_cx: CodegenCx, _def_id: DefId, _global: Value): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs build_global_var_di_node");
}

// Stub (cg-contract): apply_vcall_visibility_metadata (debuginfo/metadata.rs:1697)
export function apply_vcall_visibility_metadata(_cx: CodegenCx, _ty: Ty, _trait_ref: ExistentialTraitRef | undefined, _vtable: Value): void {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs apply_vcall_visibility_metadata");
}
