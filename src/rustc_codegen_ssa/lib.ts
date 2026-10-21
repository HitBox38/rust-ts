// Port of compiler/rustc_codegen_ssa/src/lib.rs: only `provide` (lane codegen-fn-attrs). The rest of lib.rs
// (`CompiledModules`, `CrateInfo`, rlink (de)serialization, ...) is backend territory (M4+) and not ported.
import type { Providers } from "../rustc_middle/util/mod.ts";
import * as codegen_attrs from "./codegen_attrs.ts";
import * as target_features from "./target_features.ts";

export * as codegen_attrs from "./codegen_attrs.ts";
export * as target_features from "./target_features.ts";

// rustc: compiler/rustc_codegen_ssa/src/lib.rs:339 provide
export function provide(providers: Providers): void {
  // PORT: `crate::back::symbol_export::provide(providers)` (back/symbol_export.rs, M4+) and
  // `crate::base::provide(&mut providers.queries)` (base.rs, `backend_optimization_level`) are not ported; their
  // queries keep the `unported("<query> provider (not ported)")` placeholders of rustc_interface passes.ts.
  target_features.provide(providers.queries);
  codegen_attrs.provide(providers.queries);
}
