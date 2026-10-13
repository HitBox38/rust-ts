// Stub of compiler/rustc_lint/src/precedence.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (precedence.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { Precedence } from "./precedence.lints.gen.ts";

export * from "./precedence.lints.gen.ts";

// impl EarlyLintPass for Precedence (precedence.rs:38)
unported_methods(Precedence.prototype, "rustc_lint::precedence::Precedence", ["check_expr"]);
