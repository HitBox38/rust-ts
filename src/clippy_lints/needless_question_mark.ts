// Port of src/tools/clippy/clippy_lints/src/needless_question_mark.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessQuestionMark } from "./needless_question_mark.lints.gen.ts";
export * from "./needless_question_mark.lints.gen.ts";

declare module "./needless_question_mark.lints.gen.ts" {
  interface NeedlessQuestionMark extends LateLintPass {}
}

// ---- NeedlessQuestionMark (late sub-pass; declare_lint_pass! in needless_question_mark.rs) ----

// impl LateLintPass for NeedlessQuestionMark (needless_question_mark.rs:47)
// stub: src/tools/clippy/clippy_lints/src/needless_question_mark.rs:67 check_expr (lane lint-files)
NeedlessQuestionMark.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_question_mark::NeedlessQuestionMark::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/needless_question_mark.rs:73 check_body (lane lint-files)
NeedlessQuestionMark.prototype.check_body = function (cx, body) {
  unported("clippy_lints::needless_question_mark::NeedlessQuestionMark::check_body");
};
