// Stub of compiler/rustc_lint/src/drop_forget_useless.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (drop_forget_useless.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DropForgetUseless } from "./drop_forget_useless.lints.gen.ts";

export * from "./drop_forget_useless.lints.gen.ts";

// impl LateLintPass for DropForgetUseless (drop_forget_useless.rs:144)
unported_methods(DropForgetUseless.prototype, "rustc_lint::drop_forget_useless::DropForgetUseless", ["check_expr"]);
