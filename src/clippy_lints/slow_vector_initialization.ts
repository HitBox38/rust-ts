// Port of src/tools/clippy/clippy_lints/src/slow_vector_initialization.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SlowVectorInit } from "./slow_vector_initialization.lints.gen.ts";
export * from "./slow_vector_initialization.lints.gen.ts";

declare module "./slow_vector_initialization.lints.gen.ts" {
  interface SlowVectorInit extends LateLintPass {}
}

// ---- SlowVectorInit (late sub-pass; declare_lint_pass! in slow_vector_initialization.rs) ----

// impl LateLintPass for SlowVectorInit (slow_vector_initialization.rs:99)
// stub: src/tools/clippy/clippy_lints/src/slow_vector_initialization.rs:100 check_expr (lane lint-files)
SlowVectorInit.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::slow_vector_initialization::SlowVectorInit::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/slow_vector_initialization.rs:116 check_stmt (lane lint-files)
SlowVectorInit.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::slow_vector_initialization::SlowVectorInit::check_stmt");
};
