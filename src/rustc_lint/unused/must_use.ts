// Stub of compiler/rustc_lint/src/unused/must_use.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (must_use.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../../rust_ts/stubs.ts";
import { UnusedResults } from "./must_use.lints.gen.ts";

export * from "./must_use.lints.gen.ts";

// impl LateLintPass for UnusedResults (unused/must_use.rs:284)
unported_methods(UnusedResults.prototype, "rustc_lint::unused::must_use::UnusedResults", ["check_stmt"]);
