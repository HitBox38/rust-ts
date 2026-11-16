// Port of src/tools/clippy/clippy_lints/src/manual_option_as_slice.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualOptionAsSlice_impl_lint_pass } from "./manual_option_as_slice.lints.gen.ts";
export * from "./manual_option_as_slice.lints.gen.ts";

// ---- ManualOptionAsSlice (late sub-pass; impl_lint_pass! in manual_option_as_slice.rs) ----
export interface ManualOptionAsSlice extends LateLintPass {}
/** `struct ManualOptionAsSlice { .. }` (manual_option_as_slice.rs:44); its `impl_lint_pass!` expansion is `ManualOptionAsSlice_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualOptionAsSlice implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_option_as_slice.rs:49 new (lane lint-files)
  static new(conf: Conf): ManualOptionAsSlice {
    return unported("clippy_lints::manual_option_as_slice::ManualOptionAsSlice::new");
  }

  name(): string {
    return ManualOptionAsSlice_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualOptionAsSlice_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualOptionAsSlice_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualOptionAsSlice (manual_option_as_slice.rs:54)
// stub: src/tools/clippy/clippy_lints/src/manual_option_as_slice.rs:55 check_expr (lane lint-files)
ManualOptionAsSlice.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_option_as_slice::ManualOptionAsSlice::check_expr");
};
