// Port of src/tools/clippy/clippy_lints/src/disallowed_macros.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AttrStorage } from "./utils/attr_collector.ts";
import { unported } from "../std/panic.ts";
import { DisallowedMacros_impl_lint_pass } from "./disallowed_macros.lints.gen.ts";
export * from "./disallowed_macros.lints.gen.ts";

// ---- DisallowedMacros (late sub-pass; impl_lint_pass! in disallowed_macros.rs) ----
export interface DisallowedMacros extends LateLintPass {}
/** `struct DisallowedMacros { .. }` (disallowed_macros.rs:67); its `impl_lint_pass!` expansion is `DisallowedMacros_impl_lint_pass`. Fields: ported by the fill lane. */
export class DisallowedMacros implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:80 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf, early_macro_cache: AttrStorage): DisallowedMacros {
    return unported("clippy_lints::disallowed_macros::DisallowedMacros::new");
  }

  name(): string {
    return DisallowedMacros_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DisallowedMacros_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DisallowedMacros_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DisallowedMacros (disallowed_macros.rs:129)
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:130 check_crate (lane lint-files)
DisallowedMacros.prototype.check_crate = function (cx) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:139 check_expr (lane lint-files)
DisallowedMacros.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:147 check_stmt (lane lint-files)
DisallowedMacros.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:151 check_ty (lane lint-files)
DisallowedMacros.prototype.check_ty = function (cx, ty) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_ty");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:155 check_pat (lane lint-files)
DisallowedMacros.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_pat");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:159 check_item (lane lint-files)
DisallowedMacros.prototype.check_item = function (cx, item) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:172 check_foreign_item (lane lint-files)
DisallowedMacros.prototype.check_foreign_item = function (cx, item) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_foreign_item");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:177 check_impl_item (lane lint-files)
DisallowedMacros.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:184 check_trait_item (lane lint-files)
DisallowedMacros.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_macros.rs:188 check_path (lane lint-files)
DisallowedMacros.prototype.check_path = function (cx, path, _0) {
  unported("clippy_lints::disallowed_macros::DisallowedMacros::check_path");
};
