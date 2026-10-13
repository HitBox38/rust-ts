// Stub of compiler/rustc_lint/src/ptr_nulls.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (ptr_nulls.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { PtrNullChecks } from "./ptr_nulls.lints.gen.ts";

export * from "./ptr_nulls.lints.gen.ts";

// impl LateLintPass for PtrNullChecks (ptr_nulls.rs:133)
unported_methods(PtrNullChecks.prototype, "rustc_lint::ptr_nulls::PtrNullChecks", ["check_expr"]);
