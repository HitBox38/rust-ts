// Port of src/tools/clippy/clippy_lints/src/implicit_saturating_sub.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ImplicitSaturatingSub_impl_lint_pass } from "./implicit_saturating_sub.lints.gen.ts";
export * from "./implicit_saturating_sub.lints.gen.ts";

// ---- ImplicitSaturatingSub (late sub-pass; impl_lint_pass! in implicit_saturating_sub.rs) ----
export interface ImplicitSaturatingSub extends LateLintPass {}
/** `struct ImplicitSaturatingSub { .. }` (implicit_saturating_sub.rs:86); its `impl_lint_pass!` expansion is `ImplicitSaturatingSub_impl_lint_pass`. Fields: ported by the fill lane. */
export class ImplicitSaturatingSub implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/implicit_saturating_sub.rs:91 new (lane lint-files)
  static new(conf: Conf): ImplicitSaturatingSub {
    return unported("clippy_lints::implicit_saturating_sub::ImplicitSaturatingSub::new");
  }

  name(): string {
    return ImplicitSaturatingSub_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ImplicitSaturatingSub_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ImplicitSaturatingSub_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ImplicitSaturatingSub (implicit_saturating_sub.rs:96)
// stub: src/tools/clippy/clippy_lints/src/implicit_saturating_sub.rs:97 check_expr (lane lint-files)
ImplicitSaturatingSub.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::implicit_saturating_sub::ImplicitSaturatingSub::check_expr");
};
