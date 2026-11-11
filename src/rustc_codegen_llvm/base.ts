// compiler/rustc_codegen_llvm/src/base.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave
// 41) owns this file and ports base.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: a typed stub of `compile_codegen_unit`, which back/llvm_backend.ts's `ExtraBackendMethods` impl calls.
import type { ModuleCodegen } from "../rustc_codegen_ssa/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import type { ModuleLlvm } from "./back/llvm_backend.ts";

/** `-> (ModuleCodegen<ModuleLlvm>, u64)`: the `u64` is a cost estimate, a `number` as `ExtraBackendMethods` has it. */
// Stub (cg-contract): compile_codegen_unit (base.rs:63)
export function compile_codegen_unit(_tcx: TyCtxt, _cgu_name: Symbol, _bitcode_needed: boolean): [ModuleCodegen<ModuleLlvm>, number] {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/base.rs compile_codegen_unit");
}
