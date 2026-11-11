// compiler/rustc_codegen_llvm/src/allocator.rs: the SKELETON (lane cg-contract). The fill lane cg-builder (plan-m7 §8 wave
// 41) owns this file and ports allocator.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: a typed stub of `codegen`, which back/llvm_backend.ts's `codegen_allocator` calls.
import type { AllocatorMethod } from "../rustc_ast/expand/allocator.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import type { SimpleCx } from "./context.ts";

// Stub (cg-contract): codegen (allocator.rs:20)
export function codegen(_tcx: TyCtxt, _cx: SimpleCx, _module_name: string, _methods: readonly AllocatorMethod[]): void {
  return unported("cg-builder: compiler/rustc_codegen_llvm/src/allocator.rs codegen");
}
