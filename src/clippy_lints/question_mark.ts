// Port of src/tools/clippy/clippy_lints/src/question_mark.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { QuestionMark_impl_lint_pass } from "./question_mark.lints.gen.ts";
export * from "./question_mark.lints.gen.ts";

// ---- QuestionMark (late sub-pass; impl_lint_pass! in question_mark.rs) ----
export interface QuestionMark extends LateLintPass {}
/** `struct QuestionMark { .. }` (question_mark.rs:56); its `impl_lint_pass!` expansion is `QuestionMark_impl_lint_pass`. Fields: ported by the fill lane. */
export class QuestionMark implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/question_mark.rs:71 new (lane lint-files)
  static new(conf: Conf): QuestionMark {
    return unported("clippy_lints::question_mark::QuestionMark::new");
  }

  name(): string {
    return QuestionMark_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return QuestionMark_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return QuestionMark_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for QuestionMark (question_mark.rs:631)
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:632 check_stmt (lane lint-files)
QuestionMark.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::question_mark::QuestionMark::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:649 check_expr (lane lint-files)
QuestionMark.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::question_mark::QuestionMark::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:671 check_expr_post (lane lint-files)
QuestionMark.prototype.check_expr_post = function (_0, expr) {
  unported("clippy_lints::question_mark::QuestionMark::check_expr_post");
};
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:677 check_block (lane lint-files)
QuestionMark.prototype.check_block = function (cx, block) {
  unported("clippy_lints::question_mark::QuestionMark::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:686 check_body (lane lint-files)
QuestionMark.prototype.check_body = function (_0, _1) {
  unported("clippy_lints::question_mark::QuestionMark::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:690 check_body_post (lane lint-files)
QuestionMark.prototype.check_body_post = function (_0, _1) {
  unported("clippy_lints::question_mark::QuestionMark::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/question_mark.rs:694 check_block_post (lane lint-files)
QuestionMark.prototype.check_block_post = function (cx, block) {
  unported("clippy_lints::question_mark::QuestionMark::check_block_post");
};
