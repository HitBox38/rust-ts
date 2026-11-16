// Port of src/tools/clippy/clippy_lints/src/misc.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { LintPass } from "./misc.lints.gen.ts";
export * from "./misc.lints.gen.ts";

declare module "./misc.lints.gen.ts" {
  interface LintPass extends LateLintPass {}
}

// ---- LintPass (late sub-pass; declare_lint_pass! in misc.rs) ----

// impl LateLintPass for LintPass (misc.rs:104)
// stub: src/tools/clippy/clippy_lints/src/misc.rs:105 check_stmt (lane lint-files)
LintPass.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::misc::LintPass::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/misc.rs:129 check_expr (lane lint-files)
LintPass.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::misc::LintPass::check_expr");
};
