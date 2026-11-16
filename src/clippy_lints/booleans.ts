// Port of src/tools/clippy/clippy_lints/src/booleans.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NonminimalBool_impl_lint_pass } from "./booleans.lints.gen.ts";
export * from "./booleans.lints.gen.ts";

// ---- NonminimalBool (late sub-pass; impl_lint_pass! in booleans.rs) ----
export interface NonminimalBool extends LateLintPass {}
/** `struct NonminimalBool { .. }` (booleans.rs:89); its `impl_lint_pass!` expansion is `NonminimalBool_impl_lint_pass`. Fields: ported by the fill lane. */
export class NonminimalBool implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/booleans.rs:94 new (lane lint-files)
  static new(conf: Conf): NonminimalBool {
    return unported("clippy_lints::booleans::NonminimalBool::new");
  }

  name(): string {
    return NonminimalBool_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NonminimalBool_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NonminimalBool_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NonminimalBool (booleans.rs:99)
// stub: src/tools/clippy/clippy_lints/src/booleans.rs:100 check_fn (lane lint-files)
NonminimalBool.prototype.check_fn = function (cx, _0, _1, body, _2, _3) {
  unported("clippy_lints::booleans::NonminimalBool::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/booleans.rs:112 check_expr (lane lint-files)
NonminimalBool.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::booleans::NonminimalBool::check_expr");
};
