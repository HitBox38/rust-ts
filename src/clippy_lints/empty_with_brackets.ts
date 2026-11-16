// Port of src/tools/clippy/clippy_lints/src/empty_with_brackets.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { EmptyWithBrackets_impl_lint_pass } from "./empty_with_brackets.lints.gen.ts";
export * from "./empty_with_brackets.lints.gen.ts";

// ---- EmptyWithBrackets (late sub-pass; impl_lint_pass! in empty_with_brackets.rs) ----
export interface EmptyWithBrackets extends LateLintPass {}
/** `struct EmptyWithBrackets { .. }` (empty_with_brackets.rs:92); its `impl_lint_pass!` expansion is `EmptyWithBrackets_impl_lint_pass`. Fields: ported by the fill lane. */
export class EmptyWithBrackets implements LintPass {
  /** `#[derive(Default)]` */
  static default(): EmptyWithBrackets {
    return unported("clippy_lints::empty_with_brackets::EmptyWithBrackets::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return EmptyWithBrackets_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return EmptyWithBrackets_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return EmptyWithBrackets_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for EmptyWithBrackets (empty_with_brackets.rs:97)
// stub: src/tools/clippy/clippy_lints/src/empty_with_brackets.rs:98 check_item (lane lint-files)
EmptyWithBrackets.prototype.check_item = function (cx, item) {
  unported("clippy_lints::empty_with_brackets::EmptyWithBrackets::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/empty_with_brackets.rs:124 check_variant (lane lint-files)
EmptyWithBrackets.prototype.check_variant = function (cx, variant) {
  unported("clippy_lints::empty_with_brackets::EmptyWithBrackets::check_variant");
};
// stub: src/tools/clippy/clippy_lints/src/empty_with_brackets.rs:146 check_expr (lane lint-files)
EmptyWithBrackets.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::empty_with_brackets::EmptyWithBrackets::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/empty_with_brackets.rs:167 check_pat (lane lint-files)
EmptyWithBrackets.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::empty_with_brackets::EmptyWithBrackets::check_pat");
};
// stub: src/tools/clippy/clippy_lints/src/empty_with_brackets.rs:175 check_crate_post (lane lint-files)
EmptyWithBrackets.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::empty_with_brackets::EmptyWithBrackets::check_crate_post");
};
