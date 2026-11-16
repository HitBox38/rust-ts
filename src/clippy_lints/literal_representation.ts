// Port of src/tools/clippy/clippy_lints/src/literal_representation.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass types src/clippy_lints/lib.gen.ts names,
// each `check_*` of their `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DecimalLiteralRepresentation_impl_lint_pass, LiteralDigitGrouping_impl_lint_pass } from "./literal_representation.lints.gen.ts";
export * from "./literal_representation.lints.gen.ts";

// ---- LiteralDigitGrouping (early sub-pass; impl_lint_pass! in literal_representation.rs) ----
export interface LiteralDigitGrouping extends EarlyLintPass {}
/** `struct LiteralDigitGrouping { .. }` (literal_representation.rs:203); its `impl_lint_pass!` expansion is `LiteralDigitGrouping_impl_lint_pass`. Fields: ported by the fill lane. */
export class LiteralDigitGrouping implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/literal_representation.rs:223 new (lane always-running)
  static new(conf: Conf): LiteralDigitGrouping {
    return unported("clippy_lints::literal_representation::LiteralDigitGrouping::new");
  }

  name(): string {
    return LiteralDigitGrouping_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LiteralDigitGrouping_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LiteralDigitGrouping_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for LiteralDigitGrouping (literal_representation.rs:207)
// stub: src/tools/clippy/clippy_lints/src/literal_representation.rs:208 check_expr (lane always-running)
LiteralDigitGrouping.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::literal_representation::LiteralDigitGrouping::check_expr");
};

// ---- DecimalLiteralRepresentation (early sub-pass; impl_lint_pass! in literal_representation.rs) ----
export interface DecimalLiteralRepresentation extends EarlyLintPass {}
/** `struct DecimalLiteralRepresentation { .. }` (literal_representation.rs:416); its `impl_lint_pass!` expansion is `DecimalLiteralRepresentation_impl_lint_pass`. Fields: ported by the fill lane. */
export class DecimalLiteralRepresentation implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/literal_representation.rs:433 new (lane always-running)
  static new(conf: Conf): DecimalLiteralRepresentation {
    return unported("clippy_lints::literal_representation::DecimalLiteralRepresentation::new");
  }

  name(): string {
    return DecimalLiteralRepresentation_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DecimalLiteralRepresentation_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DecimalLiteralRepresentation_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for DecimalLiteralRepresentation (literal_representation.rs:420)
// stub: src/tools/clippy/clippy_lints/src/literal_representation.rs:421 check_expr (lane always-running)
DecimalLiteralRepresentation.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::literal_representation::DecimalLiteralRepresentation::check_expr");
};
