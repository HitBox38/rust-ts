// Port of src/tools/clippy/clippy_lints/src/manual_string_new.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ManualStringNew } from "./manual_string_new.lints.gen.ts";
export * from "./manual_string_new.lints.gen.ts";

declare module "./manual_string_new.lints.gen.ts" {
  interface ManualStringNew extends LateLintPass {}
}

// ---- ManualStringNew (late sub-pass; declare_lint_pass! in manual_string_new.rs) ----

// impl LateLintPass for ManualStringNew (manual_string_new.rs:39)
// stub: src/tools/clippy/clippy_lints/src/manual_string_new.rs:40 check_expr (lane lint-files)
ManualStringNew.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_string_new::ManualStringNew::check_expr");
};
