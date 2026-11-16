// Port of src/tools/clippy/clippy_lints/src/time_subtraction.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UncheckedTimeSubtraction_impl_lint_pass } from "./time_subtraction.lints.gen.ts";
export * from "./time_subtraction.lints.gen.ts";

// ---- UncheckedTimeSubtraction (late sub-pass; impl_lint_pass! in time_subtraction.rs) ----
export interface UncheckedTimeSubtraction extends LateLintPass {}
/** `struct UncheckedTimeSubtraction { .. }` (time_subtraction.rs:80); its `impl_lint_pass!` expansion is `UncheckedTimeSubtraction_impl_lint_pass`. Fields: ported by the fill lane. */
export class UncheckedTimeSubtraction implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/time_subtraction.rs:85 new (lane lint-files)
  static new(conf: Conf): UncheckedTimeSubtraction {
    return unported("clippy_lints::time_subtraction::UncheckedTimeSubtraction::new");
  }

  name(): string {
    return UncheckedTimeSubtraction_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UncheckedTimeSubtraction_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UncheckedTimeSubtraction_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UncheckedTimeSubtraction (time_subtraction.rs:90)
// stub: src/tools/clippy/clippy_lints/src/time_subtraction.rs:91 check_expr (lane lint-files)
UncheckedTimeSubtraction.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::time_subtraction::UncheckedTimeSubtraction::check_expr");
};
