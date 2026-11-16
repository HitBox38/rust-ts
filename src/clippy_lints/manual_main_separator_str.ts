// Port of src/tools/clippy/clippy_lints/src/manual_main_separator_str.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualMainSeparatorStr_impl_lint_pass } from "./manual_main_separator_str.lints.gen.ts";
export * from "./manual_main_separator_str.lints.gen.ts";

// ---- ManualMainSeparatorStr (late sub-pass; impl_lint_pass! in manual_main_separator_str.rs) ----
export interface ManualMainSeparatorStr extends LateLintPass {}
/** `struct ManualMainSeparatorStr { .. }` (manual_main_separator_str.rs:37); its `impl_lint_pass!` expansion is `ManualMainSeparatorStr_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualMainSeparatorStr implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_main_separator_str.rs:42 new (lane lint-files)
  static new(conf: Conf): ManualMainSeparatorStr {
    return unported("clippy_lints::manual_main_separator_str::ManualMainSeparatorStr::new");
  }

  name(): string {
    return ManualMainSeparatorStr_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualMainSeparatorStr_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualMainSeparatorStr_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualMainSeparatorStr (manual_main_separator_str.rs:47)
// stub: src/tools/clippy/clippy_lints/src/manual_main_separator_str.rs:48 check_expr (lane lint-files)
ManualMainSeparatorStr.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_main_separator_str::ManualMainSeparatorStr::check_expr");
};
