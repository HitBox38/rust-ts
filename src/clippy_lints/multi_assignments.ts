// Port of src/tools/clippy/clippy_lints/src/multi_assignments.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { MultiAssignments } from "./multi_assignments.lints.gen.ts";
export * from "./multi_assignments.lints.gen.ts";

declare module "./multi_assignments.lints.gen.ts" {
  interface MultiAssignments extends EarlyLintPass {}
}

// ---- MultiAssignments (early sub-pass; declare_lint_pass! in multi_assignments.rs) ----

// impl EarlyLintPass for MultiAssignments (multi_assignments.rs:53)
// stub: src/tools/clippy/clippy_lints/src/multi_assignments.rs:54 check_expr (lane always-running)
MultiAssignments.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::multi_assignments::MultiAssignments::check_expr");
};
