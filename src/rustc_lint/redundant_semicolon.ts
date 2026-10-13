// Stub of compiler/rustc_lint/src/redundant_semicolon.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (redundant_semicolon.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { RedundantSemicolons } from "./redundant_semicolon.lints.gen.ts";

export * from "./redundant_semicolon.lints.gen.ts";

// impl EarlyLintPass for RedundantSemicolons (redundant_semicolon.rs:31)
unported_methods(RedundantSemicolons.prototype, "rustc_lint::redundant_semicolon::RedundantSemicolons", ["check_block"]);
