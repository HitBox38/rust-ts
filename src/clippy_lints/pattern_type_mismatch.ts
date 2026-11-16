// Port of src/tools/clippy/clippy_lints/src/pattern_type_mismatch.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PatternTypeMismatch } from "./pattern_type_mismatch.lints.gen.ts";
export * from "./pattern_type_mismatch.lints.gen.ts";

declare module "./pattern_type_mismatch.lints.gen.ts" {
  interface PatternTypeMismatch extends LateLintPass {}
}

// ---- PatternTypeMismatch (late sub-pass; declare_lint_pass! in pattern_type_mismatch.rs) ----

// impl LateLintPass for PatternTypeMismatch (pattern_type_mismatch.rs:82)
// stub: src/tools/clippy/clippy_lints/src/pattern_type_mismatch.rs:83 check_stmt (lane lint-files)
PatternTypeMismatch.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::pattern_type_mismatch::PatternTypeMismatch::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/pattern_type_mismatch.rs:96 check_expr (lane lint-files)
PatternTypeMismatch.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::pattern_type_mismatch::PatternTypeMismatch::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/pattern_type_mismatch.rs:116 check_fn (lane lint-files)
PatternTypeMismatch.prototype.check_fn = function (cx, _0, _1, body, _2, _3) {
  unported("clippy_lints::pattern_type_mismatch::PatternTypeMismatch::check_fn");
};
