// compiler/rustc_codegen_llvm/src/attributes.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8
// wave 41) owns this file and ports attributes.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns of attributes.rs that other fill lanes call (review F2), as typed stubs. A `&SimpleCx` parameter given
// a `CodegenCx` upstream is deref-coerced: callers pass `cx.scx`.
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { Session } from "../rustc_session/session.ts";
import type { FramePointer } from "../rustc_target/spec/mod.ts";
import { unported } from "../std/panic.ts";
import type { SanitizerIgnoreList, SimpleCx } from "./context.ts";
import type { Attribute, AttributePlace, Value } from "./llvm/mod.ts";

// Stub (cg-contract): apply_to_llfn (attributes.rs:29)
export function apply_to_llfn(_llfn: Value, _idx: AttributePlace, _attrs: readonly Attribute[]): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs apply_to_llfn");
}

// Stub (cg-contract): apply_to_callsite (attributes.rs:35)
export function apply_to_callsite(_callsite: Value, _idx: AttributePlace, _attrs: readonly Attribute[]): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs apply_to_callsite");
}

// Stub (cg-contract): frame_pointer (attributes.rs:217)
export function frame_pointer(_sess: Session): FramePointer {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs frame_pointer");
}

// Stub (cg-contract): frame_pointer_type_attr (attributes.rs:229)
export function frame_pointer_type_attr(_cx: SimpleCx, _sess: Session): Attribute | undefined {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs frame_pointer_type_attr");
}

// Stub (cg-contract): target_cpu_attr (attributes.rs:429)
export function target_cpu_attr(_cx: SimpleCx, _sess: Session): Attribute {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs target_cpu_attr");
}

// Stub (cg-contract): tune_cpu_attr (attributes.rs:434)
export function tune_cpu_attr(_cx: SimpleCx, _sess: Session): Attribute | undefined {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs tune_cpu_attr");
}

// Stub (cg-contract): target_features_attr (attributes.rs:440)
export function target_features_attr(_cx: SimpleCx, _tcx: TyCtxt, _function_features: string[]): Attribute | undefined {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs target_features_attr");
}

// Stub (cg-contract): llfn_attrs_from_instance (attributes.rs:490)
export function llfn_attrs_from_instance(_cx: SimpleCx, _tcx: TyCtxt, _llfn: Value, _codegen_fn_attrs: CodegenFnAttrs, _instance: Instance | undefined, _sanitizer_ignorelist: SanitizerIgnoreList | undefined): void {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/attributes.rs llfn_attrs_from_instance");
}
