// Port of src/tools/clippy/clippy_lints/src/non_expressive_names.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NonExpressiveNames_impl_lint_pass } from "./non_expressive_names.lints.gen.ts";
export * from "./non_expressive_names.lints.gen.ts";

// ---- NonExpressiveNames (early sub-pass; impl_lint_pass! in non_expressive_names.rs) ----
export interface NonExpressiveNames extends EarlyLintPass {}
/** `struct NonExpressiveNames { .. }` (non_expressive_names.rs:91); its `impl_lint_pass!` expansion is `NonExpressiveNames_impl_lint_pass`. Fields: ported by the fill lane. */
export class NonExpressiveNames implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/non_expressive_names.rs:96 new (lane always-running)
  static new(conf: Conf): NonExpressiveNames {
    return unported("clippy_lints::non_expressive_names::NonExpressiveNames::new");
  }

  name(): string {
    return NonExpressiveNames_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NonExpressiveNames_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NonExpressiveNames_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for NonExpressiveNames (non_expressive_names.rs:400)
// stub: src/tools/clippy/clippy_lints/src/non_expressive_names.rs:401 check_item (lane always-running)
NonExpressiveNames.prototype.check_item = function (cx, item) {
  unported("clippy_lints::non_expressive_names::NonExpressiveNames::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/non_expressive_names.rs:416 check_impl_item (lane always-running)
NonExpressiveNames.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::non_expressive_names::NonExpressiveNames::check_impl_item");
};
