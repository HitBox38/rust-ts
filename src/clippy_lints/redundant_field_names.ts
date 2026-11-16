// Port of src/tools/clippy/clippy_lints/src/redundant_field_names.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { RedundantFieldNames_impl_lint_pass } from "./redundant_field_names.lints.gen.ts";
export * from "./redundant_field_names.lints.gen.ts";

// ---- RedundantFieldNames (early sub-pass; impl_lint_pass! in redundant_field_names.rs) ----
export interface RedundantFieldNames extends EarlyLintPass {}
/** `struct RedundantFieldNames { .. }` (redundant_field_names.rs:39); its `impl_lint_pass!` expansion is `RedundantFieldNames_impl_lint_pass`. Fields: ported by the fill lane. */
export class RedundantFieldNames implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/redundant_field_names.rs:44 new (lane always-running)
  static new(conf: Conf): RedundantFieldNames {
    return unported("clippy_lints::redundant_field_names::RedundantFieldNames::new");
  }

  name(): string {
    return RedundantFieldNames_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return RedundantFieldNames_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return RedundantFieldNames_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for RedundantFieldNames (redundant_field_names.rs:49)
// stub: src/tools/clippy/clippy_lints/src/redundant_field_names.rs:50 check_expr (lane always-running)
RedundantFieldNames.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::redundant_field_names::RedundantFieldNames::check_expr");
};
