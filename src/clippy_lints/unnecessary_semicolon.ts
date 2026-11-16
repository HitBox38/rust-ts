// Port of src/tools/clippy/clippy_lints/src/unnecessary_semicolon.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnnecessarySemicolon_impl_lint_pass } from "./unnecessary_semicolon.lints.gen.ts";
export * from "./unnecessary_semicolon.lints.gen.ts";

// ---- UnnecessarySemicolon (late sub-pass; impl_lint_pass! in unnecessary_semicolon.rs) ----
export interface UnnecessarySemicolon extends LateLintPass {}
/** `struct UnnecessarySemicolon { .. }` (unnecessary_semicolon.rs:40); its `impl_lint_pass!` expansion is `UnnecessarySemicolon_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnnecessarySemicolon implements LintPass {
  /** `#[derive(Default)]` */
  static default(): UnnecessarySemicolon {
    return unported("clippy_lints::unnecessary_semicolon::UnnecessarySemicolon::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return UnnecessarySemicolon_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnnecessarySemicolon_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnnecessarySemicolon_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnnecessarySemicolon (unnecessary_semicolon.rs:69)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_semicolon.rs:70 check_block (lane lint-files)
UnnecessarySemicolon.prototype.check_block = function (cx, block) {
  unported("clippy_lints::unnecessary_semicolon::UnnecessarySemicolon::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/unnecessary_semicolon.rs:74 check_block_post (lane lint-files)
UnnecessarySemicolon.prototype.check_block_post = function (cx, block) {
  unported("clippy_lints::unnecessary_semicolon::UnnecessarySemicolon::check_block_post");
};
// stub: src/tools/clippy/clippy_lints/src/unnecessary_semicolon.rs:78 check_stmt (lane lint-files)
UnnecessarySemicolon.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::unnecessary_semicolon::UnnecessarySemicolon::check_stmt");
};
