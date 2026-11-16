// Port of src/tools/clippy/clippy_lints/src/large_const_arrays.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { LargeConstArrays_impl_lint_pass } from "./large_const_arrays.lints.gen.ts";
export * from "./large_const_arrays.lints.gen.ts";

// ---- LargeConstArrays (late sub-pass; impl_lint_pass! in large_const_arrays.rs) ----
export interface LargeConstArrays extends LateLintPass {}
/** `struct LargeConstArrays { .. }` (large_const_arrays.rs:37); its `impl_lint_pass!` expansion is `LargeConstArrays_impl_lint_pass`. Fields: ported by the fill lane. */
export class LargeConstArrays implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/large_const_arrays.rs:42 new (lane lint-files)
  static new(conf: Conf): LargeConstArrays {
    return unported("clippy_lints::large_const_arrays::LargeConstArrays::new");
  }

  name(): string {
    return LargeConstArrays_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LargeConstArrays_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LargeConstArrays_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for LargeConstArrays (large_const_arrays.rs:74)
// stub: src/tools/clippy/clippy_lints/src/large_const_arrays.rs:75 check_item (lane lint-files)
LargeConstArrays.prototype.check_item = function (cx, item) {
  unported("clippy_lints::large_const_arrays::LargeConstArrays::check_item");
};
