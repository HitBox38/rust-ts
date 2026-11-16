// Port of src/tools/clippy/clippy_lints/src/operators/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Operators_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Operators (late sub-pass; impl_lint_pass! in operators/mod.rs) ----
export interface Operators extends LateLintPass {}
/** `struct Operators { .. }` (operators/mod.rs:1029); its `impl_lint_pass!` expansion is `Operators_impl_lint_pass`. Fields: ported by the fill lane. */
export class Operators implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/operators/mod.rs:1037 new (lane dispatch)
  static new(conf: Conf): Operators {
    return unported("clippy_lints::operators::Operators::new");
  }

  name(): string {
    return Operators_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Operators_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Operators_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Operators (operators/mod.rs:1047)
// stub: src/tools/clippy/clippy_lints/src/operators/mod.rs:1048 check_expr (lane dispatch)
Operators.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::operators::Operators::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/operators/mod.rs:1114 check_expr_post (lane dispatch)
Operators.prototype.check_expr_post = function (_0, e) {
  unported("clippy_lints::operators::Operators::check_expr_post");
};
// stub: src/tools/clippy/clippy_lints/src/operators/mod.rs:1118 check_body (lane dispatch)
Operators.prototype.check_body = function (cx, b) {
  unported("clippy_lints::operators::Operators::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/operators/mod.rs:1122 check_body_post (lane dispatch)
Operators.prototype.check_body_post = function (cx, b) {
  unported("clippy_lints::operators::Operators::check_body_post");
};
