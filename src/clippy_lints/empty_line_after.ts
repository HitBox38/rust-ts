// Port of src/tools/clippy/clippy_lints/src/empty_line_after.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { EmptyLineAfter_impl_lint_pass } from "./empty_line_after.lints.gen.ts";
export * from "./empty_line_after.lints.gen.ts";

// ---- EmptyLineAfter (early sub-pass; impl_lint_pass! in empty_line_after.rs) ----
export interface EmptyLineAfter extends EarlyLintPass {}
/** `struct EmptyLineAfter { .. }` (empty_line_after.rs:137); its `impl_lint_pass!` expansion is `EmptyLineAfter_impl_lint_pass`. Fields: ported by the fill lane. */
export class EmptyLineAfter implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:142 new (lane always-running)
  static new(): EmptyLineAfter {
    return unported("clippy_lints::empty_line_after::EmptyLineAfter::new");
  }

  name(): string {
    return EmptyLineAfter_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return EmptyLineAfter_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return EmptyLineAfter_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for EmptyLineAfter (empty_line_after.rs:519)
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:520 check_crate (lane always-running)
EmptyLineAfter.prototype.check_crate = function (_0, krate) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:534 check_item_post (lane always-running)
EmptyLineAfter.prototype.check_item_post = function (_0, _1) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:537 check_impl_item_post (lane always-running)
EmptyLineAfter.prototype.check_impl_item_post = function (_0, _1) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_impl_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:540 check_trait_item_post (lane always-running)
EmptyLineAfter.prototype.check_trait_item_post = function (_0, _1) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_trait_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:544 check_impl_item (lane always-running)
EmptyLineAfter.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:550 check_trait_item (lane always-running)
EmptyLineAfter.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/empty_line_after.rs:556 check_item (lane always-running)
EmptyLineAfter.prototype.check_item = function (cx, item) {
  unported("clippy_lints::empty_line_after::EmptyLineAfter::check_item");
};
