// Port of src/tools/clippy/clippy_lints/src/unwrap_in_result.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnwrapInResult_impl_lint_pass } from "./unwrap_in_result.lints.gen.ts";
export * from "./unwrap_in_result.lints.gen.ts";

// ---- UnwrapInResult (late sub-pass; impl_lint_pass! in unwrap_in_result.rs) ----
export interface UnwrapInResult extends LateLintPass {}
/** `struct UnwrapInResult { .. }` (unwrap_in_result.rs:81); its `impl_lint_pass!` expansion is `UnwrapInResult_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnwrapInResult implements LintPass {
  /** `#[derive(Default)]` */
  static default(): UnwrapInResult {
    return unported("clippy_lints::unwrap_in_result::UnwrapInResult::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return UnwrapInResult_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnwrapInResult_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnwrapInResult_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnwrapInResult (unwrap_in_result.rs:100)
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:101 check_impl_item (lane lint-files)
UnwrapInResult.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:107 check_impl_item_post (lane lint-files)
UnwrapInResult.prototype.check_impl_item_post = function (_0, impl_item) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_impl_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:113 check_item (lane lint-files)
UnwrapInResult.prototype.check_item = function (cx, item) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:122 check_item_post (lane lint-files)
UnwrapInResult.prototype.check_item_post = function (_0, item) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:128 check_expr (lane lint-files)
UnwrapInResult.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:161 check_body (lane lint-files)
UnwrapInResult.prototype.check_body = function (cx, body) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/unwrap_in_result.rs:170 check_body_post (lane lint-files)
UnwrapInResult.prototype.check_body_post = function (cx, body) {
  unported("clippy_lints::unwrap_in_result::UnwrapInResult::check_body_post");
};
