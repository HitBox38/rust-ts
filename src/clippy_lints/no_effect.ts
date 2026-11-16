// Port of src/tools/clippy/clippy_lints/src/no_effect.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NoEffect_impl_lint_pass } from "./no_effect.lints.gen.ts";
export * from "./no_effect.lints.gen.ts";

// ---- NoEffect (late sub-pass; impl_lint_pass! in no_effect.rs) ----
export interface NoEffect extends LateLintPass {}
/** `struct NoEffect { .. }` (no_effect.rs:82); its `impl_lint_pass!` expansion is `NoEffect_impl_lint_pass`. Fields: ported by the fill lane. */
export class NoEffect implements LintPass {
  /** `#[derive(Default)]` */
  static default(): NoEffect {
    return unported("clippy_lints::no_effect::NoEffect::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return NoEffect_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NoEffect_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NoEffect_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NoEffect (no_effect.rs:87)
// stub: src/tools/clippy/clippy_lints/src/no_effect.rs:88 check_stmt (lane lint-files)
NoEffect.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::no_effect::NoEffect::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/no_effect.rs:95 check_block (lane lint-files)
NoEffect.prototype.check_block = function (_0, _1) {
  unported("clippy_lints::no_effect::NoEffect::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/no_effect.rs:99 check_block_post (lane lint-files)
NoEffect.prototype.check_block_post = function (cx, _0) {
  unported("clippy_lints::no_effect::NoEffect::check_block_post");
};
// stub: src/tools/clippy/clippy_lints/src/no_effect.rs:113 check_expr (lane lint-files)
NoEffect.prototype.check_expr = function (_0, expr) {
  unported("clippy_lints::no_effect::NoEffect::check_expr");
};
