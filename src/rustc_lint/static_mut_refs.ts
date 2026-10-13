// Stub of compiler/rustc_lint/src/static_mut_refs.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (static_mut_refs.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { StaticMutRefs } from "./static_mut_refs.lints.gen.ts";

export * from "./static_mut_refs.lints.gen.ts";

// impl LateLintPass for StaticMutRefs (static_mut_refs.rs:63)
unported_methods(StaticMutRefs.prototype, "rustc_lint::static_mut_refs::StaticMutRefs", ["check_expr", "check_stmt"]);
