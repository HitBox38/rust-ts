// Port of src/tools/clippy/clippy_lints/src/repeat_vec_with_capacity.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { RepeatVecWithCapacity_impl_lint_pass } from "./repeat_vec_with_capacity.lints.gen.ts";
export * from "./repeat_vec_with_capacity.lints.gen.ts";

// ---- RepeatVecWithCapacity (late sub-pass; impl_lint_pass! in repeat_vec_with_capacity.rs) ----
export interface RepeatVecWithCapacity extends LateLintPass {}
/** `struct RepeatVecWithCapacity { .. }` (repeat_vec_with_capacity.rs:14); its `impl_lint_pass!` expansion is `RepeatVecWithCapacity_impl_lint_pass`. Fields: ported by the fill lane. */
export class RepeatVecWithCapacity implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/repeat_vec_with_capacity.rs:19 new (lane lint-files)
  static new(conf: Conf): RepeatVecWithCapacity {
    return unported("clippy_lints::repeat_vec_with_capacity::RepeatVecWithCapacity::new");
  }

  name(): string {
    return RepeatVecWithCapacity_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return RepeatVecWithCapacity_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return RepeatVecWithCapacity_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for RepeatVecWithCapacity (repeat_vec_with_capacity.rs:124)
// stub: src/tools/clippy/clippy_lints/src/repeat_vec_with_capacity.rs:125 check_expr (lane lint-files)
RepeatVecWithCapacity.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::repeat_vec_with_capacity::RepeatVecWithCapacity::check_expr");
};
