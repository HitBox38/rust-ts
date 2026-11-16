// Port of src/tools/clippy/clippy_lints/src/vec_init_then_push.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { VecInitThenPush_impl_lint_pass } from "./vec_init_then_push.lints.gen.ts";
export * from "./vec_init_then_push.lints.gen.ts";

// ---- VecInitThenPush (late sub-pass; impl_lint_pass! in vec_init_then_push.rs) ----
export interface VecInitThenPush extends LateLintPass {}
/** `struct VecInitThenPush { .. }` (vec_init_then_push.rs:49); its `impl_lint_pass!` expansion is `VecInitThenPush_impl_lint_pass`. Fields: ported by the fill lane. */
export class VecInitThenPush implements LintPass {
  /** `#[derive(Default)]` */
  static default(): VecInitThenPush {
    return unported("clippy_lints::vec_init_then_push::VecInitThenPush::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return VecInitThenPush_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return VecInitThenPush_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return VecInitThenPush_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for VecInitThenPush (vec_init_then_push.rs:152)
// stub: src/tools/clippy/clippy_lints/src/vec_init_then_push.rs:153 check_block (lane lint-files)
VecInitThenPush.prototype.check_block = function (_0, _1) {
  unported("clippy_lints::vec_init_then_push::VecInitThenPush::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/vec_init_then_push.rs:157 check_local (lane lint-files)
VecInitThenPush.prototype.check_local = function (cx, local) {
  unported("clippy_lints::vec_init_then_push::VecInitThenPush::check_local");
};
// stub: src/tools/clippy/clippy_lints/src/vec_init_then_push.rs:177 check_expr (lane lint-files)
VecInitThenPush.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::vec_init_then_push::VecInitThenPush::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/vec_init_then_push.rs:200 check_stmt (lane lint-files)
VecInitThenPush.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::vec_init_then_push::VecInitThenPush::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/vec_init_then_push.rs:220 check_block_post (lane lint-files)
VecInitThenPush.prototype.check_block_post = function (cx, _0) {
  unported("clippy_lints::vec_init_then_push::VecInitThenPush::check_block_post");
};
