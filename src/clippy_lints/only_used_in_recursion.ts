// Port of src/tools/clippy/clippy_lints/src/only_used_in_recursion.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { OnlyUsedInRecursion_impl_lint_pass } from "./only_used_in_recursion.lints.gen.ts";
export * from "./only_used_in_recursion.lints.gen.ts";

// ---- OnlyUsedInRecursion (late sub-pass; impl_lint_pass! in only_used_in_recursion.rs) ----
export interface OnlyUsedInRecursion extends LateLintPass {}
/** `struct OnlyUsedInRecursion { .. }` (only_used_in_recursion.rs:301); its `impl_lint_pass!` expansion is `OnlyUsedInRecursion_impl_lint_pass`. Fields: ported by the fill lane. */
export class OnlyUsedInRecursion implements LintPass {
  /** `#[derive(Default)]` */
  static default(): OnlyUsedInRecursion {
    return unported("clippy_lints::only_used_in_recursion::OnlyUsedInRecursion::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return OnlyUsedInRecursion_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return OnlyUsedInRecursion_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return OnlyUsedInRecursion_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for OnlyUsedInRecursion (only_used_in_recursion.rs:307)
// stub: src/tools/clippy/clippy_lints/src/only_used_in_recursion.rs:308 check_body (lane lint-files)
OnlyUsedInRecursion.prototype.check_body = function (cx, body) {
  unported("clippy_lints::only_used_in_recursion::OnlyUsedInRecursion::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/only_used_in_recursion.rs:365 check_expr (lane lint-files)
OnlyUsedInRecursion.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::only_used_in_recursion::OnlyUsedInRecursion::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/only_used_in_recursion.rs:437 check_body_post (lane lint-files)
OnlyUsedInRecursion.prototype.check_body_post = function (cx, body) {
  unported("clippy_lints::only_used_in_recursion::OnlyUsedInRecursion::check_body_post");
};
