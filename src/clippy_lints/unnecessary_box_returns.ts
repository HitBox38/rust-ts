// Port of src/tools/clippy/clippy_lints/src/unnecessary_box_returns.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnnecessaryBoxReturns_impl_lint_pass } from "./unnecessary_box_returns.lints.gen.ts";
export * from "./unnecessary_box_returns.lints.gen.ts";

// ---- UnnecessaryBoxReturns (late sub-pass; impl_lint_pass! in unnecessary_box_returns.rs) ----
export interface UnnecessaryBoxReturns extends LateLintPass {}
/** `struct UnnecessaryBoxReturns { .. }` (unnecessary_box_returns.rs:44); its `impl_lint_pass!` expansion is `UnnecessaryBoxReturns_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnnecessaryBoxReturns implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unnecessary_box_returns.rs:50 new (lane lint-files)
  static new(conf: Conf): UnnecessaryBoxReturns {
    return unported("clippy_lints::unnecessary_box_returns::UnnecessaryBoxReturns::new");
  }

  name(): string {
    return UnnecessaryBoxReturns_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnnecessaryBoxReturns_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnnecessaryBoxReturns_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnnecessaryBoxReturns (unnecessary_box_returns.rs:111)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_box_returns.rs:112 check_trait_item (lane lint-files)
UnnecessaryBoxReturns.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::unnecessary_box_returns::UnnecessaryBoxReturns::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/unnecessary_box_returns.rs:119 check_impl_item (lane lint-files)
UnnecessaryBoxReturns.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::unnecessary_box_returns::UnnecessaryBoxReturns::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/unnecessary_box_returns.rs:136 check_item (lane lint-files)
UnnecessaryBoxReturns.prototype.check_item = function (cx, item) {
  unported("clippy_lints::unnecessary_box_returns::UnnecessaryBoxReturns::check_item");
};
