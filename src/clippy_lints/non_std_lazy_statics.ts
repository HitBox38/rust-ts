// Port of src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NonStdLazyStatic_impl_lint_pass } from "./non_std_lazy_statics.lints.gen.ts";
export * from "./non_std_lazy_statics.lints.gen.ts";

// ---- NonStdLazyStatic (late sub-pass; impl_lint_pass! in non_std_lazy_statics.rs) ----
export interface NonStdLazyStatic extends LateLintPass {}
/** `struct NonStdLazyStatic { .. }` (non_std_lazy_statics.rs:66); its `impl_lint_pass!` expansion is `NonStdLazyStatic_impl_lint_pass`. Fields: ported by the fill lane. */
export class NonStdLazyStatic implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs:76 new (lane lint-files)
  static new(conf: Conf): NonStdLazyStatic {
    return unported("clippy_lints::non_std_lazy_statics::NonStdLazyStatic::new");
  }

  name(): string {
    return NonStdLazyStatic_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NonStdLazyStatic_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NonStdLazyStatic_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NonStdLazyStatic (non_std_lazy_statics.rs:91)
// stub: src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs:92 check_crate (lane lint-files)
NonStdLazyStatic.prototype.check_crate = function (cx) {
  unported("clippy_lints::non_std_lazy_statics::NonStdLazyStatic::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs:107 check_item (lane lint-files)
NonStdLazyStatic.prototype.check_item = function (cx, item) {
  unported("clippy_lints::non_std_lazy_statics::NonStdLazyStatic::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs:133 check_expr (lane lint-files)
NonStdLazyStatic.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::non_std_lazy_statics::NonStdLazyStatic::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs:146 check_ty (lane lint-files)
NonStdLazyStatic.prototype.check_ty = function (cx, ty) {
  unported("clippy_lints::non_std_lazy_statics::NonStdLazyStatic::check_ty");
};
// stub: src/tools/clippy/clippy_lints/src/non_std_lazy_statics.rs:159 check_crate_post (lane lint-files)
NonStdLazyStatic.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::non_std_lazy_statics::NonStdLazyStatic::check_crate_post");
};
