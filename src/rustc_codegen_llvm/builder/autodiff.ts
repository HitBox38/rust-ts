// compiler/rustc_codegen_llvm/src/builder/autodiff.rs: out of M7 (harness/scope.json; plan-m7 D18, `-Zautodiff`). Lane cg-contract
// placed here the fns another fill lane calls (review F2), as stubs.
import type { DiffActivity } from "../../rustc_ast/expand/autodiff_attrs.ts";
import type { FncTree } from "../../rustc_ast/expand/typetree.gen.ts";
import type { RustcAutodiff } from "../../rustc_attr_ir/data_structures.ts";
import type { IntrinsicResult } from "../../rustc_codegen_ssa/mir/mod.ts";
import type { PlaceValue } from "../../rustc_codegen_ssa/mir/place.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Builder } from "../builder.ts";
import type { Type, Value } from "../llvm/mod.ts";

/** `da: &mut ThinVec<DiffActivity>` */
// Stub (cg-contract): adjust_activity_to_abi (builder/autodiff.rs:23)
export function adjust_activity_to_abi(_tcx: TyCtxt, _fn_ptr_ty: Ty, _typing_env: TypingEnv, _da: DiffActivity[]): void {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/autodiff.rs adjust_activity_to_abi");
}

// Stub (cg-contract): generate_enzyme_call (builder/autodiff.rs:286)
export function generate_enzyme_call(_bx: Builder, _fn_to_diff: Value, _outer_name: string, _ret_ty: Type, _fn_args: readonly Value[], _attrs: RustcAutodiff, _dest_layout: TyAndLayout, _dest_place: PlaceValue<Value> | undefined, _fnc_tree: FncTree): IntrinsicResult<Value> {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/autodiff.rs generate_enzyme_call");
}
