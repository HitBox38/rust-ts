// Port of src/tools/clippy/clippy_lints/src/regex.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { Regex_impl_lint_pass } from "./regex.lints.gen.ts";
export * from "./regex.lints.gen.ts";

// ---- Regex (late sub-pass; impl_lint_pass! in regex.rs) ----
export interface Regex extends LateLintPass {}
/** `struct Regex { .. }` (regex.rs:119); its `impl_lint_pass!` expansion is `Regex_impl_lint_pass`. Fields: ported by the fill lane. */
export class Regex implements LintPass {
  /** `#[derive(Default)]` */
  static default(): Regex {
    return unported("clippy_lints::regex::Regex::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return Regex_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Regex_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Regex_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Regex (regex.rs:124)
// stub: src/tools/clippy/clippy_lints/src/regex.rs:125 check_crate (lane lint-files)
Regex.prototype.check_crate = function (cx) {
  unported("clippy_lints::regex::Regex::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/regex.rs:140 check_expr (lane lint-files)
Regex.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::regex::Regex::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/regex.rs:173 check_expr_post (lane lint-files)
Regex.prototype.check_expr_post = function (_0, expr) {
  unported("clippy_lints::regex::Regex::check_expr_post");
};
