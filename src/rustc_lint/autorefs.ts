// Stub of compiler/rustc_lint/src/autorefs.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (autorefs.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { ImplicitAutorefs } from "./autorefs.lints.gen.ts";

export * from "./autorefs.lints.gen.ts";

// impl LateLintPass for ImplicitAutorefs (autorefs.rs:63)
unported_methods(ImplicitAutorefs.prototype, "rustc_lint::autorefs::ImplicitAutorefs", ["check_expr"]);
