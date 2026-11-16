// Port of src/tools/clippy/clippy_lints/src/collapsible_if.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { CollapsibleIf_impl_lint_pass } from "./collapsible_if.lints.gen.ts";
export * from "./collapsible_if.lints.gen.ts";

// ---- CollapsibleIf (late sub-pass; impl_lint_pass! in collapsible_if.rs) ----
export interface CollapsibleIf extends LateLintPass {}
/** `struct CollapsibleIf { .. }` (collapsible_if.rs:83); its `impl_lint_pass!` expansion is `CollapsibleIf_impl_lint_pass`. Fields: ported by the fill lane. */
export class CollapsibleIf implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/collapsible_if.rs:89 new (lane lint-files)
  static new(conf: Conf): CollapsibleIf {
    return unported("clippy_lints::collapsible_if::CollapsibleIf::new");
  }

  name(): string {
    return CollapsibleIf_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return CollapsibleIf_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return CollapsibleIf_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for CollapsibleIf (collapsible_if.rs:262)
// stub: src/tools/clippy/clippy_lints/src/collapsible_if.rs:263 check_expr (lane lint-files)
CollapsibleIf.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::collapsible_if::CollapsibleIf::check_expr");
};
