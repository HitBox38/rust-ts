// Port of src/tools/clippy/clippy_lints/src/operators/arithmetic_side_effects.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { ArithmeticSideEffects_impl_lint_pass } from "./arithmetic_side_effects.lints.gen.ts";
export * from "./arithmetic_side_effects.lints.gen.ts";

// ---- ArithmeticSideEffects (late sub-pass; impl_lint_pass! in operators/arithmetic_side_effects.rs) ----
export interface ArithmeticSideEffects extends LateLintPass {}
/** `struct ArithmeticSideEffects { .. }` (operators/arithmetic_side_effects.rs:15); its `impl_lint_pass!` expansion is `ArithmeticSideEffects_impl_lint_pass`. Fields: ported by the fill lane. */
export class ArithmeticSideEffects implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/operators/arithmetic_side_effects.rs:27 new (lane lint-files)
  static new(conf: Conf): ArithmeticSideEffects {
    return unported("clippy_lints::operators::arithmetic_side_effects::ArithmeticSideEffects::new");
  }

  name(): string {
    return ArithmeticSideEffects_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ArithmeticSideEffects_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ArithmeticSideEffects_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ArithmeticSideEffects (operators/arithmetic_side_effects.rs:273)
// stub: src/tools/clippy/clippy_lints/src/operators/arithmetic_side_effects.rs:274 check_expr (lane lint-files)
ArithmeticSideEffects.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::operators::arithmetic_side_effects::ArithmeticSideEffects::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/operators/arithmetic_side_effects.rs:295 check_body (lane lint-files)
ArithmeticSideEffects.prototype.check_body = function (cx, body) {
  unported("clippy_lints::operators::arithmetic_side_effects::ArithmeticSideEffects::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/operators/arithmetic_side_effects.rs:311 check_body_post (lane lint-files)
ArithmeticSideEffects.prototype.check_body_post = function (cx, body) {
  unported("clippy_lints::operators::arithmetic_side_effects::ArithmeticSideEffects::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/operators/arithmetic_side_effects.rs:322 check_expr_post (lane lint-files)
ArithmeticSideEffects.prototype.check_expr_post = function (_0, expr) {
  unported("clippy_lints::operators::arithmetic_side_effects::ArithmeticSideEffects::check_expr_post");
};
