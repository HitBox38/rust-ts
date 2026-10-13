// Stub of compiler/rustc_lint/src/reference_casting.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (reference_casting.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { InvalidReferenceCasting } from "./reference_casting.lints.gen.ts";

export * from "./reference_casting.lints.gen.ts";

// impl LateLintPass for InvalidReferenceCasting (reference_casting.rs:42)
unported_methods(InvalidReferenceCasting.prototype, "rustc_lint::reference_casting::InvalidReferenceCasting", ["check_expr"]);
