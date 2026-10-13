// Stub of compiler/rustc_lint/src/unit_bindings.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (unit_bindings.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { UnitBindings } from "./unit_bindings.lints.gen.ts";

export * from "./unit_bindings.lints.gen.ts";

// impl LateLintPass for UnitBindings (unit_bindings.rs:49)
unported_methods(UnitBindings.prototype, "rustc_lint::unit_bindings::UnitBindings", ["check_local"]);
