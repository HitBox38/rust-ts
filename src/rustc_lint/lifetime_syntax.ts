// Stub of compiler/rustc_lint/src/lifetime_syntax.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (lifetime_syntax.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { LifetimeSyntax } from "./lifetime_syntax.lints.gen.ts";

export * from "./lifetime_syntax.lints.gen.ts";

// impl LateLintPass for LifetimeSyntax (lifetime_syntax.rs:77)
unported_methods(LifetimeSyntax.prototype, "rustc_lint::lifetime_syntax::LifetimeSyntax", ["check_fn", "check_trait_item", "check_foreign_item"]);
