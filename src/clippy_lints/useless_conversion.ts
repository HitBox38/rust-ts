// Port of src/tools/clippy/clippy_lints/src/useless_conversion.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UselessConversion_impl_lint_pass } from "./useless_conversion.lints.gen.ts";
export * from "./useless_conversion.lints.gen.ts";

// ---- UselessConversion (late sub-pass; impl_lint_pass! in useless_conversion.rs) ----
export interface UselessConversion extends LateLintPass {}
/** `struct UselessConversion { .. }` (useless_conversion.rs:47); its `impl_lint_pass!` expansion is `UselessConversion_impl_lint_pass`. Fields: ported by the fill lane. */
export class UselessConversion implements LintPass {
  /** `#[derive(Default)]` */
  static default(): UselessConversion {
    return unported("clippy_lints::useless_conversion::UselessConversion::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return UselessConversion_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UselessConversion_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UselessConversion_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UselessConversion (useless_conversion.rs:157)
// stub: src/tools/clippy/clippy_lints/src/useless_conversion.rs:158 check_expr (lane lint-files)
UselessConversion.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::useless_conversion::UselessConversion::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/useless_conversion.rs:462 check_expr_post (lane lint-files)
UselessConversion.prototype.check_expr_post = function (_0, e) {
  unported("clippy_lints::useless_conversion::UselessConversion::check_expr_post");
};
