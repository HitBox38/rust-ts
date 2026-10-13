// Stub of compiler/rustc_lint/src/for_loops_over_fallibles.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (for_loops_over_fallibles.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { ForLoopsOverFallibles } from "./for_loops_over_fallibles.lints.gen.ts";

export * from "./for_loops_over_fallibles.lints.gen.ts";

// impl LateLintPass for ForLoopsOverFallibles (for_loops_over_fallibles.rs:49)
unported_methods(ForLoopsOverFallibles.prototype, "rustc_lint::for_loops_over_fallibles::ForLoopsOverFallibles", ["check_expr"]);
