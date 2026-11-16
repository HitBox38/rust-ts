// Port of src/tools/clippy/clippy_lints/src/indexing_slicing.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { IndexingSlicing_impl_lint_pass } from "./indexing_slicing.lints.gen.ts";
export * from "./indexing_slicing.lints.gen.ts";

// ---- IndexingSlicing (late sub-pass; impl_lint_pass! in indexing_slicing.rs) ----
export interface IndexingSlicing extends LateLintPass {}
/** `struct IndexingSlicing { .. }` (indexing_slicing.rs:97); its `impl_lint_pass!` expansion is `IndexingSlicing_impl_lint_pass`. Fields: ported by the fill lane. */
export class IndexingSlicing implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/indexing_slicing.rs:103 new (lane lint-files)
  static new(conf: Conf): IndexingSlicing {
    return unported("clippy_lints::indexing_slicing::IndexingSlicing::new");
  }

  name(): string {
    return IndexingSlicing_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return IndexingSlicing_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return IndexingSlicing_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for IndexingSlicing (indexing_slicing.rs:111)
// stub: src/tools/clippy/clippy_lints/src/indexing_slicing.rs:112 check_expr (lane lint-files)
IndexingSlicing.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::indexing_slicing::IndexingSlicing::check_expr");
};
