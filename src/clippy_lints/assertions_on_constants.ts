// Port of src/tools/clippy/clippy_lints/src/assertions_on_constants.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { AssertionsOnConstants_impl_lint_pass } from "./assertions_on_constants.lints.gen.ts";
export * from "./assertions_on_constants.lints.gen.ts";

// ---- AssertionsOnConstants (late sub-pass; impl_lint_pass! in assertions_on_constants.rs) ----
export interface AssertionsOnConstants extends LateLintPass {}
/** `struct AssertionsOnConstants { .. }` (assertions_on_constants.rs:36); its `impl_lint_pass!` expansion is `AssertionsOnConstants_impl_lint_pass`. Fields: ported by the fill lane. */
export class AssertionsOnConstants implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/assertions_on_constants.rs:40 new (lane lint-files)
  static new(conf: Conf): AssertionsOnConstants {
    return unported("clippy_lints::assertions_on_constants::AssertionsOnConstants::new");
  }

  name(): string {
    return AssertionsOnConstants_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return AssertionsOnConstants_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return AssertionsOnConstants_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for AssertionsOnConstants (assertions_on_constants.rs:45)
// stub: src/tools/clippy/clippy_lints/src/assertions_on_constants.rs:46 check_expr (lane lint-files)
AssertionsOnConstants.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::assertions_on_constants::AssertionsOnConstants::check_expr");
};
