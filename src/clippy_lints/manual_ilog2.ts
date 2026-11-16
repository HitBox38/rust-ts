// Port of src/tools/clippy/clippy_lints/src/manual_ilog2.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualIlog2_impl_lint_pass } from "./manual_ilog2.lints.gen.ts";
export * from "./manual_ilog2.lints.gen.ts";

// ---- ManualIlog2 (late sub-pass; impl_lint_pass! in manual_ilog2.rs) ----
export interface ManualIlog2 extends LateLintPass {}
/** `struct ManualIlog2 { .. }` (manual_ilog2.rs:41); its `impl_lint_pass!` expansion is `ManualIlog2_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualIlog2 implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_ilog2.rs:46 new (lane lint-files)
  static new(conf: Conf): ManualIlog2 {
    return unported("clippy_lints::manual_ilog2::ManualIlog2::new");
  }

  name(): string {
    return ManualIlog2_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualIlog2_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualIlog2_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualIlog2 (manual_ilog2.rs:51)
// stub: src/tools/clippy/clippy_lints/src/manual_ilog2.rs:52 check_expr (lane lint-files)
ManualIlog2.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_ilog2::ManualIlog2::check_expr");
};
