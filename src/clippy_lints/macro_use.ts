// Port of src/tools/clippy/clippy_lints/src/macro_use.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MacroUseImports_impl_lint_pass } from "./macro_use.lints.gen.ts";
export * from "./macro_use.lints.gen.ts";

// ---- MacroUseImports (late sub-pass; impl_lint_pass! in macro_use.rs) ----
export interface MacroUseImports extends LateLintPass {}
/** `struct MacroUseImports { .. }` (macro_use.rs:61); its `impl_lint_pass!` expansion is `MacroUseImports_impl_lint_pass`. Fields: ported by the fill lane. */
export class MacroUseImports implements LintPass {
  /** `#[derive(Default)]` */
  static default(): MacroUseImports {
    return unported("clippy_lints::macro_use::MacroUseImports::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return MacroUseImports_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MacroUseImports_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MacroUseImports_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MacroUseImports (macro_use.rs:96)
// stub: src/tools/clippy/clippy_lints/src/macro_use.rs:97 check_item (lane lint-files)
MacroUseImports.prototype.check_item = function (cx, item) {
  unported("clippy_lints::macro_use::MacroUseImports::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/macro_use.rs:116 check_expr (lane lint-files)
MacroUseImports.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::macro_use::MacroUseImports::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/macro_use.rs:121 check_stmt (lane lint-files)
MacroUseImports.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::macro_use::MacroUseImports::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/macro_use.rs:126 check_pat (lane lint-files)
MacroUseImports.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::macro_use::MacroUseImports::check_pat");
};
// stub: src/tools/clippy/clippy_lints/src/macro_use.rs:131 check_ty (lane lint-files)
MacroUseImports.prototype.check_ty = function (cx, ty) {
  unported("clippy_lints::macro_use::MacroUseImports::check_ty");
};
// stub: src/tools/clippy/clippy_lints/src/macro_use.rs:136 check_crate_post (lane lint-files)
MacroUseImports.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::macro_use::MacroUseImports::check_crate_post");
};
