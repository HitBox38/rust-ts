// Port of src/tools/clippy/clippy_lints/src/manual_float_methods.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualFloatMethods_impl_lint_pass } from "./manual_float_methods.lints.gen.ts";
export * from "./manual_float_methods.lints.gen.ts";

// ---- ManualFloatMethods (late sub-pass; impl_lint_pass! in manual_float_methods.rs) ----
export interface ManualFloatMethods extends LateLintPass {}
/** `struct ManualFloatMethods { .. }` (manual_float_methods.rs:89); its `impl_lint_pass!` expansion is `ManualFloatMethods_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualFloatMethods implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_float_methods.rs:94 new (lane lint-files)
  static new(conf: Conf): ManualFloatMethods {
    return unported("clippy_lints::manual_float_methods::ManualFloatMethods::new");
  }

  name(): string {
    return ManualFloatMethods_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualFloatMethods_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualFloatMethods_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualFloatMethods (manual_float_methods.rs:135)
// stub: src/tools/clippy/clippy_lints/src/manual_float_methods.rs:136 check_expr (lane lint-files)
ManualFloatMethods.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_float_methods::ManualFloatMethods::check_expr");
};
