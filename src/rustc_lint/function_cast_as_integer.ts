// Stub of compiler/rustc_lint/src/function_cast_as_integer.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (function_cast_as_integer.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { FunctionCastsAsInteger } from "./function_cast_as_integer.lints.gen.ts";

export * from "./function_cast_as_integer.lints.gen.ts";

// impl LateLintPass for FunctionCastsAsInteger (function_cast_as_integer.rs:37)
unported_methods(FunctionCastsAsInteger.prototype, "rustc_lint::function_cast_as_integer::FunctionCastsAsInteger", ["check_expr"]);
