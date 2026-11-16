// Port of src/tools/clippy/clippy_lints/src/panicking_overflow_checks.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PanickingOverflowChecks } from "./panicking_overflow_checks.lints.gen.ts";
export * from "./panicking_overflow_checks.lints.gen.ts";

declare module "./panicking_overflow_checks.lints.gen.ts" {
  interface PanickingOverflowChecks extends LateLintPass {}
}

// ---- PanickingOverflowChecks (late sub-pass; declare_lint_pass! in panicking_overflow_checks.rs) ----

// impl LateLintPass for PanickingOverflowChecks (panicking_overflow_checks.rs:49)
// stub: src/tools/clippy/clippy_lints/src/panicking_overflow_checks.rs:51 check_expr (lane lint-files)
PanickingOverflowChecks.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::panicking_overflow_checks::PanickingOverflowChecks::check_expr");
};
