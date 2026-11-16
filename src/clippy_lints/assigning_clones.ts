// Port of src/tools/clippy/clippy_lints/src/assigning_clones.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { AssigningClones_impl_lint_pass } from "./assigning_clones.lints.gen.ts";
export * from "./assigning_clones.lints.gen.ts";

// ---- AssigningClones (late sub-pass; impl_lint_pass! in assigning_clones.rs) ----
export interface AssigningClones extends LateLintPass {}
/** `struct AssigningClones { .. }` (assigning_clones.rs:57); its `impl_lint_pass!` expansion is `AssigningClones_impl_lint_pass`. Fields: ported by the fill lane. */
export class AssigningClones implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/assigning_clones.rs:62 new (lane lint-files)
  static new(conf: Conf): AssigningClones {
    return unported("clippy_lints::assigning_clones::AssigningClones::new");
  }

  name(): string {
    return AssigningClones_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return AssigningClones_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return AssigningClones_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for AssigningClones (assigning_clones.rs:67)
// stub: src/tools/clippy/clippy_lints/src/assigning_clones.rs:68 check_expr (lane lint-files)
AssigningClones.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::assigning_clones::AssigningClones::check_expr");
};
