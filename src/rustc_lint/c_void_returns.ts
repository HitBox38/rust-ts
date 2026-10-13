// Stub of compiler/rustc_lint/src/c_void_returns.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (c_void_returns.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { CVoidReturns } from "./c_void_returns.lints.gen.ts";

export * from "./c_void_returns.lints.gen.ts";

// impl LateLintPass for CVoidReturns (c_void_returns.rs:45)
unported_methods(CVoidReturns.prototype, "rustc_lint::c_void_returns::CVoidReturns", ["check_fn", "check_foreign_item", "check_ty"]);
