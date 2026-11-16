// Port of src/tools/clippy/clippy_lints/src/neg_cmp_op_on_partial_ord.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NoNegCompOpForPartialOrd } from "./neg_cmp_op_on_partial_ord.lints.gen.ts";
export * from "./neg_cmp_op_on_partial_ord.lints.gen.ts";

declare module "./neg_cmp_op_on_partial_ord.lints.gen.ts" {
  interface NoNegCompOpForPartialOrd extends LateLintPass {}
}

// ---- NoNegCompOpForPartialOrd (late sub-pass; declare_lint_pass! in neg_cmp_op_on_partial_ord.rs) ----

// impl LateLintPass for NoNegCompOpForPartialOrd (neg_cmp_op_on_partial_ord.rs:44)
// stub: src/tools/clippy/clippy_lints/src/neg_cmp_op_on_partial_ord.rs:45 check_expr (lane lint-files)
NoNegCompOpForPartialOrd.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::neg_cmp_op_on_partial_ord::NoNegCompOpForPartialOrd::check_expr");
};
