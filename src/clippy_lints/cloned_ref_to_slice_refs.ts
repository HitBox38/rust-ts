// Port of src/tools/clippy/clippy_lints/src/cloned_ref_to_slice_refs.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ClonedRefToSliceRefs_impl_lint_pass } from "./cloned_ref_to_slice_refs.lints.gen.ts";
export * from "./cloned_ref_to_slice_refs.lints.gen.ts";

// ---- ClonedRefToSliceRefs (late sub-pass; impl_lint_pass! in cloned_ref_to_slice_refs.rs) ----
export interface ClonedRefToSliceRefs extends LateLintPass {}
/** `struct ClonedRefToSliceRefs { .. }` (cloned_ref_to_slice_refs.rs:56); its `impl_lint_pass!` expansion is `ClonedRefToSliceRefs_impl_lint_pass`. Fields: ported by the fill lane. */
export class ClonedRefToSliceRefs implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/cloned_ref_to_slice_refs.rs:60 new (lane lint-files)
  static new(conf: Conf): ClonedRefToSliceRefs {
    return unported("clippy_lints::cloned_ref_to_slice_refs::ClonedRefToSliceRefs::new");
  }

  name(): string {
    return ClonedRefToSliceRefs_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ClonedRefToSliceRefs_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ClonedRefToSliceRefs_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ClonedRefToSliceRefs (cloned_ref_to_slice_refs.rs:65)
// stub: src/tools/clippy/clippy_lints/src/cloned_ref_to_slice_refs.rs:66 check_expr (lane lint-files)
ClonedRefToSliceRefs.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::cloned_ref_to_slice_refs::ClonedRefToSliceRefs::check_expr");
};
