// Port of src/tools/clippy/clippy_lints/src/disallowed_methods.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { DisallowedMethods_impl_lint_pass } from "./disallowed_methods.lints.gen.ts";
export * from "./disallowed_methods.lints.gen.ts";

// ---- DisallowedMethods (late sub-pass; impl_lint_pass! in disallowed_methods.rs) ----
export interface DisallowedMethods extends LateLintPass {}
/** `struct DisallowedMethods { .. }` (disallowed_methods.rs:65); its `impl_lint_pass!` expansion is `DisallowedMethods_impl_lint_pass`. Fields: ported by the fill lane. */
export class DisallowedMethods implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/disallowed_methods.rs:70 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): DisallowedMethods {
    return unported("clippy_lints::disallowed_methods::DisallowedMethods::new");
  }

  name(): string {
    return DisallowedMethods_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DisallowedMethods_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DisallowedMethods_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DisallowedMethods (disallowed_methods.rs:88)
// stub: src/tools/clippy/clippy_lints/src/disallowed_methods.rs:89 check_expr (lane lint-files)
DisallowedMethods.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::disallowed_methods::DisallowedMethods::check_expr");
};
