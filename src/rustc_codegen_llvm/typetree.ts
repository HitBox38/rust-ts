// compiler/rustc_codegen_llvm/src/typetree.rs: out of M7 (harness/scope.json; plan-m7 D18, `-Zautodiff`). Lane cg-contract placed
// here the fn another fill lane calls (review F2), as a stub.
import type { FncTree } from "../rustc_ast/expand/typetree.gen.ts";
import { unported } from "../std/panic.ts";
import type { FullCx } from "./context.ts";
import type { Value } from "./llvm/mod.ts";

// Stub (cg-contract): add_tt (typetree.rs:78)
export function add_tt(_cx: FullCx, _fn_def: Value, _tt: FncTree): void {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/typetree.rs add_tt");
}
