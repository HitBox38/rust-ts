// Stub of compiler/rustc_lint/src/noop_method_call.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (noop_method_call.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { NoopMethodCall } from "./noop_method_call.lints.gen.ts";

export * from "./noop_method_call.lints.gen.ts";

// impl LateLintPass for NoopMethodCall (noop_method_call.rs:69)
unported_methods(NoopMethodCall.prototype, "rustc_lint::noop_method_call::NoopMethodCall", ["check_expr"]);
