// Port of src/tools/clippy/clippy_lints/src/manual_non_exhaustive.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualNonExhaustive_impl_lint_pass } from "./manual_non_exhaustive.lints.gen.ts";
export * from "./manual_non_exhaustive.lints.gen.ts";

// ---- ManualNonExhaustive (late sub-pass; impl_lint_pass! in manual_non_exhaustive.rs) ----
export interface ManualNonExhaustive extends LateLintPass {}
/** `struct ManualNonExhaustive { .. }` (manual_non_exhaustive.rs:66); its `impl_lint_pass!` expansion is `ManualNonExhaustive_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualNonExhaustive implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_non_exhaustive.rs:73 new (lane lint-files)
  static new(conf: Conf): ManualNonExhaustive {
    return unported("clippy_lints::manual_non_exhaustive::ManualNonExhaustive::new");
  }

  name(): string {
    return ManualNonExhaustive_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualNonExhaustive_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualNonExhaustive_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualNonExhaustive (manual_non_exhaustive.rs:82)
// stub: src/tools/clippy/clippy_lints/src/manual_non_exhaustive.rs:83 check_item (lane lint-files)
ManualNonExhaustive.prototype.check_item = function (cx, item) {
  unported("clippy_lints::manual_non_exhaustive::ManualNonExhaustive::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/manual_non_exhaustive.rs:152 check_expr (lane lint-files)
ManualNonExhaustive.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::manual_non_exhaustive::ManualNonExhaustive::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/manual_non_exhaustive.rs:162 check_crate_post (lane lint-files)
ManualNonExhaustive.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::manual_non_exhaustive::ManualNonExhaustive::check_crate_post");
};
