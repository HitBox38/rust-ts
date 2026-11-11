// Port of compiler/rustc_codegen_ssa/src/traits/statics.rs (lane ssa-contract). Conventions: backend.ts's header.
import type { ConstAllocation } from "../../rustc_middle/mir/interpret/allocation.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/statics.rs:6 StaticCodegenMethods
export interface StaticCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/statics.rs:7 static_addr_of
  static_addr_of(alloc: ConstAllocation, kind: string | undefined): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/statics.rs:8 codegen_static
  codegen_static(def_id: DefId): void;
}

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/statics.rs:11 StaticBuilderMethods
export interface StaticBuilderMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/statics.rs:12 get_static
  get_static(def_id: DefId): B["Value"];
}
