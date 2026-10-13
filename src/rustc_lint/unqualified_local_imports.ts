// Stub of compiler/rustc_lint/src/unqualified_local_imports.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (unqualified_local_imports.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { UnqualifiedLocalImports } from "./unqualified_local_imports.lints.gen.ts";

export * from "./unqualified_local_imports.lints.gen.ts";

// impl LateLintPass for UnqualifiedLocalImports (unqualified_local_imports.rs:46)
unported_methods(UnqualifiedLocalImports.prototype, "rustc_lint::unqualified_local_imports::UnqualifiedLocalImports", ["check_item"]);
