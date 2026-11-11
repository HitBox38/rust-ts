// compiler/rustc_codegen_llvm/src/callee.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave
// 41) owns this file and ports callee.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns of callee.rs that other fill lanes call (review F2), as typed stubs.
import type { Instance } from "../rustc_middle/ty/instance.ts";
import { unported } from "../std/panic.ts";
import type { CodegenCx } from "./context.ts";
import type { Value } from "./llvm/mod.ts";

// Stub (cg-contract): get_fn (callee.rs:19)
export function get_fn(_cx: CodegenCx, _instance: Instance): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/callee.rs get_fn");
}
