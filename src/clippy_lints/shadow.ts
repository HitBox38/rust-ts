// Port of src/tools/clippy/clippy_lints/src/shadow.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { Shadow_impl_lint_pass } from "./shadow.lints.gen.ts";
export * from "./shadow.lints.gen.ts";

// ---- Shadow (late sub-pass; impl_lint_pass! in shadow.rs) ----
export interface Shadow extends LateLintPass {}
/** `struct Shadow { .. }` (shadow.rs:111); its `impl_lint_pass!` expansion is `Shadow_impl_lint_pass`. Fields: ported by the fill lane. */
export class Shadow implements LintPass {
  /** `#[derive(Default)]` */
  static default(): Shadow {
    return unported("clippy_lints::shadow::Shadow::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return Shadow_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Shadow_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Shadow_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Shadow (shadow.rs:115)
// stub: src/tools/clippy/clippy_lints/src/shadow.rs:116 check_pat (lane lint-files)
Shadow.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::shadow::Shadow::check_pat");
};
// stub: src/tools/clippy/clippy_lints/src/shadow.rs:163 check_body (lane lint-files)
Shadow.prototype.check_body = function (cx, body) {
  unported("clippy_lints::shadow::Shadow::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/shadow.rs:170 check_body_post (lane lint-files)
Shadow.prototype.check_body_post = function (cx, body) {
  unported("clippy_lints::shadow::Shadow::check_body_post");
};
