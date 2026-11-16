// Port of src/tools/clippy/clippy_lints/src/large_stack_arrays.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { LargeStackArrays_impl_lint_pass } from "./large_stack_arrays.lints.gen.ts";
export * from "./large_stack_arrays.lints.gen.ts";

// ---- LargeStackArrays (late sub-pass; impl_lint_pass! in large_stack_arrays.rs) ----
export interface LargeStackArrays extends LateLintPass {}
/** `struct LargeStackArrays { .. }` (large_stack_arrays.rs:34); its `impl_lint_pass!` expansion is `LargeStackArrays_impl_lint_pass`. Fields: ported by the fill lane. */
export class LargeStackArrays implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/large_stack_arrays.rs:41 new (lane lint-files)
  static new(conf: Conf): LargeStackArrays {
    return unported("clippy_lints::large_stack_arrays::LargeStackArrays::new");
  }

  name(): string {
    return LargeStackArrays_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LargeStackArrays_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LargeStackArrays_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for LargeStackArrays (large_stack_arrays.rs:66)
// stub: src/tools/clippy/clippy_lints/src/large_stack_arrays.rs:67 check_item (lane lint-files)
LargeStackArrays.prototype.check_item = function (_0, item) {
  unported("clippy_lints::large_stack_arrays::LargeStackArrays::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/large_stack_arrays.rs:73 check_item_post (lane lint-files)
LargeStackArrays.prototype.check_item_post = function (_0, item) {
  unported("clippy_lints::large_stack_arrays::LargeStackArrays::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/large_stack_arrays.rs:79 check_expr (lane lint-files)
LargeStackArrays.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::large_stack_arrays::LargeStackArrays::check_expr");
};
