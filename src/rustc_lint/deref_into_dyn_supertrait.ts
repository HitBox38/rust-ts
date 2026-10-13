// Stub of compiler/rustc_lint/src/deref_into_dyn_supertrait.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (deref_into_dyn_supertrait.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DerefIntoDynSupertrait } from "./deref_into_dyn_supertrait.lints.gen.ts";

export * from "./deref_into_dyn_supertrait.lints.gen.ts";

// impl LateLintPass for DerefIntoDynSupertrait (deref_into_dyn_supertrait.rs:59)
unported_methods(DerefIntoDynSupertrait.prototype, "rustc_lint::deref_into_dyn_supertrait::DerefIntoDynSupertrait", ["check_item"]);
