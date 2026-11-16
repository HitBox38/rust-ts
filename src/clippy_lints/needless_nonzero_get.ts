// Port of src/tools/clippy/clippy_lints/src/needless_nonzero_get.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NeedlessNonzeroGet_impl_lint_pass } from "./needless_nonzero_get.lints.gen.ts";
export * from "./needless_nonzero_get.lints.gen.ts";

// ---- NeedlessNonzeroGet (late sub-pass; impl_lint_pass! in needless_nonzero_get.rs) ----
export interface NeedlessNonzeroGet extends LateLintPass {}
/** `struct NeedlessNonzeroGet { .. }` (needless_nonzero_get.rs:55); its `impl_lint_pass!` expansion is `NeedlessNonzeroGet_impl_lint_pass`. Fields: ported by the fill lane. */
export class NeedlessNonzeroGet implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/needless_nonzero_get.rs:60 new (lane lint-files)
  static new(conf: Conf): NeedlessNonzeroGet {
    return unported("clippy_lints::needless_nonzero_get::NeedlessNonzeroGet::new");
  }

  name(): string {
    return NeedlessNonzeroGet_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NeedlessNonzeroGet_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NeedlessNonzeroGet_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NeedlessNonzeroGet (needless_nonzero_get.rs:65)
// stub: src/tools/clippy/clippy_lints/src/needless_nonzero_get.rs:66 check_expr (lane lint-files)
NeedlessNonzeroGet.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_nonzero_get::NeedlessNonzeroGet::check_expr");
};
