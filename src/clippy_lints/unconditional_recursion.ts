// Port of src/tools/clippy/clippy_lints/src/unconditional_recursion.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnconditionalRecursion_impl_lint_pass } from "./unconditional_recursion.lints.gen.ts";
export * from "./unconditional_recursion.lints.gen.ts";

// ---- UnconditionalRecursion (late sub-pass; impl_lint_pass! in unconditional_recursion.rs) ----
export interface UnconditionalRecursion extends LateLintPass {}
/** `struct UnconditionalRecursion { .. }` (unconditional_recursion.rs:76); its `impl_lint_pass!` expansion is `UnconditionalRecursion_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnconditionalRecursion implements LintPass {
  /** `#[derive(Default)]` */
  static default(): UnconditionalRecursion {
    return unported("clippy_lints::unconditional_recursion::UnconditionalRecursion::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return UnconditionalRecursion_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnconditionalRecursion_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnconditionalRecursion_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnconditionalRecursion (unconditional_recursion.rs:441)
// stub: src/tools/clippy/clippy_lints/src/unconditional_recursion.rs:442 check_fn (lane lint-files)
UnconditionalRecursion.prototype.check_fn = function (cx, kind, decl, body, method_span, method_def_id) {
  unported("clippy_lints::unconditional_recursion::UnconditionalRecursion::check_fn");
};
