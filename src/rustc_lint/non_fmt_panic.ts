// Stub of compiler/rustc_lint/src/non_fmt_panic.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (non_fmt_panic.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { NonPanicFmt } from "./non_fmt_panic.lints.gen.ts";

export * from "./non_fmt_panic.lints.gen.ts";

// impl LateLintPass for NonPanicFmt (non_fmt_panic.rs:49)
unported_methods(NonPanicFmt.prototype, "rustc_lint::non_fmt_panic::NonPanicFmt", ["check_expr"]);
