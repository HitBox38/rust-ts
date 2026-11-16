// Port of src/tools/clippy/clippy_lints/src/macro_metavars_in_unsafe.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ExprMetavarsInUnsafe_impl_lint_pass } from "./macro_metavars_in_unsafe.lints.gen.ts";
export * from "./macro_metavars_in_unsafe.lints.gen.ts";

// ---- ExprMetavarsInUnsafe (late sub-pass; impl_lint_pass! in macro_metavars_in_unsafe.rs) ----
export interface ExprMetavarsInUnsafe extends LateLintPass {}
/** `struct ExprMetavarsInUnsafe { .. }` (macro_metavars_in_unsafe.rs:94); its `impl_lint_pass!` expansion is `ExprMetavarsInUnsafe_impl_lint_pass`. Fields: ported by the fill lane. */
export class ExprMetavarsInUnsafe implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/macro_metavars_in_unsafe.rs:113 new (lane lint-files)
  static new(conf: Conf): ExprMetavarsInUnsafe {
    return unported("clippy_lints::macro_metavars_in_unsafe::ExprMetavarsInUnsafe::new");
  }

  name(): string {
    return ExprMetavarsInUnsafe_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ExprMetavarsInUnsafe_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ExprMetavarsInUnsafe_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ExprMetavarsInUnsafe (macro_metavars_in_unsafe.rs:214)
// stub: src/tools/clippy/clippy_lints/src/macro_metavars_in_unsafe.rs:215 check_body (lane lint-files)
ExprMetavarsInUnsafe.prototype.check_body = function (cx, body) {
  unported("clippy_lints::macro_metavars_in_unsafe::ExprMetavarsInUnsafe::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/macro_metavars_in_unsafe.rs:233 check_crate_post (lane lint-files)
ExprMetavarsInUnsafe.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::macro_metavars_in_unsafe::ExprMetavarsInUnsafe::check_crate_post");
};
