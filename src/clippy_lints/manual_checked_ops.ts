// Port of src/tools/clippy/clippy_lints/src/manual_checked_ops.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ManualCheckedOps } from "./manual_checked_ops.lints.gen.ts";
export * from "./manual_checked_ops.lints.gen.ts";

declare module "./manual_checked_ops.lints.gen.ts" {
  interface ManualCheckedOps extends LateLintPass {}
}

// ---- ManualCheckedOps (late sub-pass; declare_lint_pass! in manual_checked_ops.rs) ----

// impl LateLintPass for ManualCheckedOps (manual_checked_ops.rs:47)
// stub: src/tools/clippy/clippy_lints/src/manual_checked_ops.rs:48 check_expr (lane lint-files)
ManualCheckedOps.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_checked_ops::ManualCheckedOps::check_expr");
};
