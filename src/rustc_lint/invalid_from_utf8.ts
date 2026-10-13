// Stub of compiler/rustc_lint/src/invalid_from_utf8.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (invalid_from_utf8.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { InvalidFromUtf8 } from "./invalid_from_utf8.lints.gen.ts";

export * from "./invalid_from_utf8.lints.gen.ts";

// impl LateLintPass for InvalidFromUtf8 (invalid_from_utf8.rs:61)
unported_methods(InvalidFromUtf8.prototype, "rustc_lint::invalid_from_utf8::InvalidFromUtf8", ["check_expr"]);
