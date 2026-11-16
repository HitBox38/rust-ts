// Port of src/tools/clippy/clippy_lints/src/manual_is_ascii_check.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualIsAsciiCheck_impl_lint_pass } from "./manual_is_ascii_check.lints.gen.ts";
export * from "./manual_is_ascii_check.lints.gen.ts";

// ---- ManualIsAsciiCheck (late sub-pass; impl_lint_pass! in manual_is_ascii_check.rs) ----
export interface ManualIsAsciiCheck extends LateLintPass {}
/** `struct ManualIsAsciiCheck { .. }` (manual_is_ascii_check.rs:62); its `impl_lint_pass!` expansion is `ManualIsAsciiCheck_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualIsAsciiCheck implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_is_ascii_check.rs:67 new (lane lint-files)
  static new(conf: Conf): ManualIsAsciiCheck {
    return unported("clippy_lints::manual_is_ascii_check::ManualIsAsciiCheck::new");
  }

  name(): string {
    return ManualIsAsciiCheck_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualIsAsciiCheck_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualIsAsciiCheck_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualIsAsciiCheck (manual_is_ascii_check.rs:91)
// stub: src/tools/clippy/clippy_lints/src/manual_is_ascii_check.rs:92 check_expr (lane lint-files)
ManualIsAsciiCheck.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_is_ascii_check::ManualIsAsciiCheck::check_expr");
};
