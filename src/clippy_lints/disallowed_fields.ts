// Port of src/tools/clippy/clippy_lints/src/disallowed_fields.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { DisallowedFields_impl_lint_pass } from "./disallowed_fields.lints.gen.ts";
export * from "./disallowed_fields.lints.gen.ts";

// ---- DisallowedFields (late sub-pass; impl_lint_pass! in disallowed_fields.rs) ----
export interface DisallowedFields extends LateLintPass {}
/** `struct DisallowedFields { .. }` (disallowed_fields.rs:60); its `impl_lint_pass!` expansion is `DisallowedFields_impl_lint_pass`. Fields: ported by the fill lane. */
export class DisallowedFields implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/disallowed_fields.rs:65 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): DisallowedFields {
    return unported("clippy_lints::disallowed_fields::DisallowedFields::new");
  }

  name(): string {
    return DisallowedFields_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DisallowedFields_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DisallowedFields_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DisallowedFields (disallowed_fields.rs:78)
// stub: src/tools/clippy/clippy_lints/src/disallowed_fields.rs:79 check_expr (lane lint-files)
DisallowedFields.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::disallowed_fields::DisallowedFields::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_fields.rs:107 check_pat (lane lint-files)
DisallowedFields.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::disallowed_fields::DisallowedFields::check_pat");
};
