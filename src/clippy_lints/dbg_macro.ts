// Port of src/tools/clippy/clippy_lints/src/dbg_macro.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DbgMacro_impl_lint_pass } from "./dbg_macro.lints.gen.ts";
export * from "./dbg_macro.lints.gen.ts";

// ---- DbgMacro (late sub-pass; impl_lint_pass! in dbg_macro.rs) ----
export interface DbgMacro extends LateLintPass {}
/** `struct DbgMacro { .. }` (dbg_macro.rs:37); its `impl_lint_pass!` expansion is `DbgMacro_impl_lint_pass`. Fields: ported by the fill lane. */
export class DbgMacro implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/dbg_macro.rs:46 new (lane lint-files)
  static new(conf: Conf): DbgMacro {
    return unported("clippy_lints::dbg_macro::DbgMacro::new");
  }

  name(): string {
    return DbgMacro_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DbgMacro_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DbgMacro_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DbgMacro (dbg_macro.rs:55)
// stub: src/tools/clippy/clippy_lints/src/dbg_macro.rs:56 check_expr (lane lint-files)
DbgMacro.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::dbg_macro::DbgMacro::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/dbg_macro.rs:134 check_crate_post (lane lint-files)
DbgMacro.prototype.check_crate_post = function (_0) {
  unported("clippy_lints::dbg_macro::DbgMacro::check_crate_post");
};
