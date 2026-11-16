// Port of src/tools/clippy/clippy_lints/src/module_style.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ModStyle_impl_lint_pass } from "./module_style.lints.gen.ts";
export * from "./module_style.lints.gen.ts";

// ---- ModStyle (early sub-pass; impl_lint_pass! in module_style.rs) ----
export interface ModStyle extends EarlyLintPass {}
/** `struct ModStyle { .. }` (module_style.rs:117); its `impl_lint_pass!` expansion is `ModStyle_impl_lint_pass`. Fields: ported by the fill lane. */
export class ModStyle implements LintPass {
  /** `#[derive(Default)]` */
  static default(): ModStyle {
    return unported("clippy_lints::module_style::ModStyle::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return ModStyle_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ModStyle_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ModStyle_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for ModStyle (module_style.rs:133)
// stub: src/tools/clippy/clippy_lints/src/module_style.rs:134 check_crate (lane always-running)
ModStyle.prototype.check_crate = function (cx, _0) {
  unported("clippy_lints::module_style::ModStyle::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/module_style.rs:138 check_item (lane always-running)
ModStyle.prototype.check_item = function (cx, item) {
  unported("clippy_lints::module_style::ModStyle::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/module_style.rs:193 check_item_post (lane always-running)
ModStyle.prototype.check_item_post = function (cx, item) {
  unported("clippy_lints::module_style::ModStyle::check_item_post");
};
