// Port of src/tools/clippy/clippy_lints/src/approx_const.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ApproxConstant_impl_lint_pass } from "./approx_const.lints.gen.ts";
export * from "./approx_const.lints.gen.ts";

// ---- ApproxConstant (late sub-pass; impl_lint_pass! in approx_const.rs) ----
export interface ApproxConstant extends LateLintPass {}
/** `struct ApproxConstant { .. }` (approx_const.rs:69); its `impl_lint_pass!` expansion is `ApproxConstant_impl_lint_pass`. Fields: ported by the fill lane. */
export class ApproxConstant implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/approx_const.rs:74 new (lane lint-files)
  static new(conf: Conf): ApproxConstant {
    return unported("clippy_lints::approx_const::ApproxConstant::new");
  }

  name(): string {
    return ApproxConstant_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ApproxConstant_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ApproxConstant_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ApproxConstant (approx_const.rs:79)
// stub: src/tools/clippy/clippy_lints/src/approx_const.rs:80 check_lit (lane lint-files)
ApproxConstant.prototype.check_lit = function (cx, _hir_id, lit, _is_negated_pat) {
  unported("clippy_lints::approx_const::ApproxConstant::check_lit");
};
