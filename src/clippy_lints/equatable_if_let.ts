// Port of src/tools/clippy/clippy_lints/src/equatable_if_let.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PatternEquality } from "./equatable_if_let.lints.gen.ts";
export * from "./equatable_if_let.lints.gen.ts";

declare module "./equatable_if_let.lints.gen.ts" {
  interface PatternEquality extends LateLintPass {}
}

// ---- PatternEquality (late sub-pass; declare_lint_pass! in equatable_if_let.rs) ----

// impl LateLintPass for PatternEquality (equatable_if_let.rs:103)
// stub: src/tools/clippy/clippy_lints/src/equatable_if_let.rs:104 check_expr (lane lint-files)
PatternEquality.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::equatable_if_let::PatternEquality::check_expr");
};
