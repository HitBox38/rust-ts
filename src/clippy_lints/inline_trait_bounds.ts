// Port of src/tools/clippy/clippy_lints/src/inline_trait_bounds.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { InlineTraitBounds_impl_lint_pass } from "./inline_trait_bounds.lints.gen.ts";
export * from "./inline_trait_bounds.lints.gen.ts";

// ---- InlineTraitBounds (early sub-pass; impl_lint_pass! in inline_trait_bounds.rs) ----
export interface InlineTraitBounds extends EarlyLintPass {}
/** `struct InlineTraitBounds { .. }` (inline_trait_bounds.rs:43); its `impl_lint_pass!` expansion is `InlineTraitBounds_impl_lint_pass`. Fields: ported by the fill lane. */
export class InlineTraitBounds implements LintPass {
  /** `#[derive(Default)]` */
  static default(): InlineTraitBounds {
    return unported("clippy_lints::inline_trait_bounds::InlineTraitBounds::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return InlineTraitBounds_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return InlineTraitBounds_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return InlineTraitBounds_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for InlineTraitBounds (inline_trait_bounds.rs:48)
// stub: src/tools/clippy/clippy_lints/src/inline_trait_bounds.rs:49 check_item (lane always-running)
InlineTraitBounds.prototype.check_item = function (_0, item) {
  unported("clippy_lints::inline_trait_bounds::InlineTraitBounds::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/inline_trait_bounds.rs:60 check_item_post (lane always-running)
InlineTraitBounds.prototype.check_item_post = function (_0, item) {
  unported("clippy_lints::inline_trait_bounds::InlineTraitBounds::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/inline_trait_bounds.rs:64 check_fn (lane always-running)
InlineTraitBounds.prototype.check_fn = function (cx, kind, _0, _1) {
  unported("clippy_lints::inline_trait_bounds::InlineTraitBounds::check_fn");
};
