// Port of src/tools/clippy/clippy_lints/src/bool_assert_comparison.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { BoolAssertComparison } from "./bool_assert_comparison.lints.gen.ts";
export * from "./bool_assert_comparison.lints.gen.ts";

declare module "./bool_assert_comparison.lints.gen.ts" {
  interface BoolAssertComparison extends LateLintPass {}
}

// ---- BoolAssertComparison (late sub-pass; declare_lint_pass! in bool_assert_comparison.rs) ----

// impl LateLintPass for BoolAssertComparison (bool_assert_comparison.rs:74)
// stub: src/tools/clippy/clippy_lints/src/bool_assert_comparison.rs:75 check_expr (lane lint-files)
BoolAssertComparison.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::bool_assert_comparison::BoolAssertComparison::check_expr");
};
