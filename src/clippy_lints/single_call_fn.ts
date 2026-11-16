// Port of src/tools/clippy/clippy_lints/src/single_call_fn.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { SingleCallFn_impl_lint_pass } from "./single_call_fn.lints.gen.ts";
export * from "./single_call_fn.lints.gen.ts";

// ---- SingleCallFn (late sub-pass; impl_lint_pass! in single_call_fn.rs) ----
export interface SingleCallFn extends LateLintPass {}
/** `struct SingleCallFn { .. }` (single_call_fn.rs:69); its `impl_lint_pass!` expansion is `SingleCallFn_impl_lint_pass`. Fields: ported by the fill lane. */
export class SingleCallFn implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/single_call_fn.rs:75 new (lane lint-files)
  static new(conf: Conf): SingleCallFn {
    return unported("clippy_lints::single_call_fn::SingleCallFn::new");
  }

  name(): string {
    return SingleCallFn_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return SingleCallFn_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return SingleCallFn_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for SingleCallFn (single_call_fn.rs:114)
// stub: src/tools/clippy/clippy_lints/src/single_call_fn.rs:115 check_expr (lane lint-files)
SingleCallFn.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::single_call_fn::SingleCallFn::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/single_call_fn.rs:136 check_crate_post (lane lint-files)
SingleCallFn.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::single_call_fn::SingleCallFn::check_crate_post");
};
