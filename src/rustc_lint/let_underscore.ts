// Stub of compiler/rustc_lint/src/let_underscore.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (let_underscore.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { LetUnderscore } from "./let_underscore.lints.gen.ts";

export * from "./let_underscore.lints.gen.ts";

// impl LateLintPass for LetUnderscore (let_underscore.rs:106)
unported_methods(LetUnderscore.prototype, "rustc_lint::let_underscore::LetUnderscore", ["check_local"]);
