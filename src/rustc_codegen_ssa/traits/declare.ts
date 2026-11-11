// Port of compiler/rustc_codegen_ssa/src/traits/declare.rs (lane ssa-contract).
import type { Linkage } from "../../rustc_attr_ir/data_structures.gen.ts";
import type { Visibility } from "../../rustc_middle/mono.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { DefId } from "../../rustc_span/def_id.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/declare.rs:6 PreDefineCodegenMethods
export interface PreDefineCodegenMethods {
  // rustc: compiler/rustc_codegen_ssa/src/traits/declare.rs:7 predefine_static
  predefine_static(def_id: DefId, linkage: Linkage, visibility: Visibility, symbol_name: string): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/declare.rs:14 predefine_fn
  predefine_fn(instance: Instance, linkage: Linkage, visibility: Visibility, symbol_name: string): void;
}
