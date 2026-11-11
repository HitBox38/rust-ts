// Port of compiler/rustc_codegen_ssa/src/traits/abi.rs (lane ssa-contract). Conventions: backend.ts's header.
import type { BackendTypes, BackendTypesOf } from "./backend.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/abi.rs:3 AbiBuilderMethods
export interface AbiBuilderMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/abi.rs:4 get_param
  get_param(index: number): B["Value"];
}
