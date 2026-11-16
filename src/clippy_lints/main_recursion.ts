// Port of src/tools/clippy/clippy_lints/src/main_recursion.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MainRecursion_impl_lint_pass } from "./main_recursion.lints.gen.ts";
export * from "./main_recursion.lints.gen.ts";

// ---- MainRecursion (late sub-pass; impl_lint_pass! in main_recursion.rs) ----
export interface MainRecursion extends LateLintPass {}
/** `struct MainRecursion { .. }` (main_recursion.rs:32); its `impl_lint_pass!` expansion is `MainRecursion_impl_lint_pass`. Fields: ported by the fill lane. */
export class MainRecursion implements LintPass {
  /** `#[derive(Default)]` */
  static default(): MainRecursion {
    return unported("clippy_lints::main_recursion::MainRecursion::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return MainRecursion_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MainRecursion_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MainRecursion_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MainRecursion (main_recursion.rs:36)
// stub: src/tools/clippy/clippy_lints/src/main_recursion.rs:37 check_crate (lane lint-files)
MainRecursion.prototype.check_crate = function (cx) {
  unported("clippy_lints::main_recursion::MainRecursion::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/main_recursion.rs:41 check_expr_post (lane lint-files)
MainRecursion.prototype.check_expr_post = function (cx, expr) {
  unported("clippy_lints::main_recursion::MainRecursion::check_expr_post");
};
