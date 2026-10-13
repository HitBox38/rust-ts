// Stub of compiler/rustc_lint/src/macro_expr_fragment_specifier_2024_migration.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (macro_expr_fragment_specifier_2024_migration.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { Expr2024 } from "./macro_expr_fragment_specifier_2024_migration.lints.gen.ts";

export * from "./macro_expr_fragment_specifier_2024_migration.lints.gen.ts";

// impl EarlyLintPass for Expr2024 (macro_expr_fragment_specifier_2024_migration.rs:143)
unported_methods(Expr2024.prototype, "rustc_lint::macro_expr_fragment_specifier_2024_migration::Expr2024", ["check_mac_def"]);
