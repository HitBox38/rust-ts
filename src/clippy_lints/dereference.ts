// Port of src/tools/clippy/clippy_lints/src/dereference.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { Dereferencing_impl_lint_pass } from "./dereference.lints.gen.ts";
export * from "./dereference.lints.gen.ts";

// ---- Dereferencing (late sub-pass; impl_lint_pass! in dereference.rs) ----
export interface Dereferencing extends LateLintPass {}
/** `struct Dereferencing { .. }` (dereference.rs:154); its `impl_lint_pass!` expansion is `Dereferencing_impl_lint_pass`. Fields: ported by the fill lane. */
export class Dereferencing implements LintPass {
  /** `#[derive(Default)]` */
  static default(): Dereferencing {
    return unported("clippy_lints::dereference::Dereferencing::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return Dereferencing_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Dereferencing_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Dereferencing_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Dereferencing (dereference.rs:240)
// stub: src/tools/clippy/clippy_lints/src/dereference.rs:242 check_expr (lane lint-files)
Dereferencing.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::dereference::Dereferencing::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/dereference.rs:650 check_pat (lane lint-files)
Dereferencing.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::dereference::Dereferencing::check_pat");
};
// stub: src/tools/clippy/clippy_lints/src/dereference.rs:693 check_body_post (lane lint-files)
Dereferencing.prototype.check_body_post = function (cx, body) {
  unported("clippy_lints::dereference::Dereferencing::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/dereference.rs:718 check_item (lane lint-files)
Dereferencing.prototype.check_item = function (cx, item) {
  unported("clippy_lints::dereference::Dereferencing::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/dereference.rs:725 check_item_post (lane lint-files)
Dereferencing.prototype.check_item_post = function (_cx, item) {
  unported("clippy_lints::dereference::Dereferencing::check_item_post");
};
