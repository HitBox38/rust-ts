// Port of src/tools/clippy/clippy_lints/src/legacy_numeric_constants.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { LegacyNumericConstants_impl_lint_pass } from "./legacy_numeric_constants.lints.gen.ts";
export * from "./legacy_numeric_constants.lints.gen.ts";

// ---- LegacyNumericConstants (late sub-pass; impl_lint_pass! in legacy_numeric_constants.rs) ----
export interface LegacyNumericConstants extends LateLintPass {}
/** `struct LegacyNumericConstants { .. }` (legacy_numeric_constants.rs:38); its `impl_lint_pass!` expansion is `LegacyNumericConstants_impl_lint_pass`. Fields: ported by the fill lane. */
export class LegacyNumericConstants implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/legacy_numeric_constants.rs:43 new (lane lint-files)
  static new(conf: Conf): LegacyNumericConstants {
    return unported("clippy_lints::legacy_numeric_constants::LegacyNumericConstants::new");
  }

  name(): string {
    return LegacyNumericConstants_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LegacyNumericConstants_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LegacyNumericConstants_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for LegacyNumericConstants (legacy_numeric_constants.rs:113)
// stub: src/tools/clippy/clippy_lints/src/legacy_numeric_constants.rs:114 check_item (lane lint-files)
LegacyNumericConstants.prototype.check_item = function (cx, item) {
  unported("clippy_lints::legacy_numeric_constants::LegacyNumericConstants::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/legacy_numeric_constants.rs:120 check_expr (lane lint-files)
LegacyNumericConstants.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::legacy_numeric_constants::LegacyNumericConstants::check_expr");
};
