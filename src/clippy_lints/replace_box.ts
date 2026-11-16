// Port of src/tools/clippy/clippy_lints/src/replace_box.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ReplaceBox_impl_lint_pass } from "./replace_box.lints.gen.ts";
export * from "./replace_box.lints.gen.ts";

// ---- ReplaceBox (late sub-pass; impl_lint_pass! in replace_box.rs) ----
export interface ReplaceBox extends LateLintPass {}
/** `struct ReplaceBox { .. }` (replace_box.rs:46); its `impl_lint_pass!` expansion is `ReplaceBox_impl_lint_pass`. Fields: ported by the fill lane. */
export class ReplaceBox implements LintPass {
  /** `#[derive(Default)]` */
  static default(): ReplaceBox {
    return unported("clippy_lints::replace_box::ReplaceBox::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return ReplaceBox_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ReplaceBox_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ReplaceBox_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ReplaceBox (replace_box.rs:72)
// stub: src/tools/clippy/clippy_lints/src/replace_box.rs:73 check_body_post (lane lint-files)
ReplaceBox.prototype.check_body_post = function (_0, body) {
  unported("clippy_lints::replace_box::ReplaceBox::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/replace_box.rs:80 check_expr (lane lint-files)
ReplaceBox.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::replace_box::ReplaceBox::check_expr");
};
