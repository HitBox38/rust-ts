// Port of src/tools/clippy/clippy_lints/src/float_literal.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { FloatLiteral_impl_lint_pass } from "./float_literal.lints.gen.ts";
export * from "./float_literal.lints.gen.ts";

// ---- FloatLiteral (late sub-pass; impl_lint_pass! in float_literal.rs) ----
export interface FloatLiteral extends LateLintPass {}
/** `struct FloatLiteral { .. }` (float_literal.rs:65); its `impl_lint_pass!` expansion is `FloatLiteral_impl_lint_pass`. Fields: ported by the fill lane. */
export class FloatLiteral implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/float_literal.rs:70 new (lane lint-files)
  static new(conf: Conf): FloatLiteral {
    return unported("clippy_lints::float_literal::FloatLiteral::new");
  }

  name(): string {
    return FloatLiteral_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return FloatLiteral_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return FloatLiteral_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for FloatLiteral (float_literal.rs:77)
// stub: src/tools/clippy/clippy_lints/src/float_literal.rs:78 check_expr (lane lint-files)
FloatLiteral.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::float_literal::FloatLiteral::check_expr");
};
