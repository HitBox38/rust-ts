// Port of src/tools/clippy/clippy_lints/src/needless_pass_by_ref_mut.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NeedlessPassByRefMut_impl_lint_pass } from "./needless_pass_by_ref_mut.lints.gen.ts";
export * from "./needless_pass_by_ref_mut.lints.gen.ts";

// ---- NeedlessPassByRefMut (late sub-pass; impl_lint_pass! in needless_pass_by_ref_mut.rs) ----
export interface NeedlessPassByRefMut extends LateLintPass {}
/** `struct NeedlessPassByRefMut { .. }` (needless_pass_by_ref_mut.rs:54); its `impl_lint_pass!` expansion is `NeedlessPassByRefMut_impl_lint_pass`. Fields: ported by the fill lane. */
export class NeedlessPassByRefMut implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/needless_pass_by_ref_mut.rs:61 new (lane lint-files)
  static new(conf: Conf): NeedlessPassByRefMut {
    return unported("clippy_lints::needless_pass_by_ref_mut::NeedlessPassByRefMut::new");
  }

  name(): string {
    return NeedlessPassByRefMut_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NeedlessPassByRefMut_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NeedlessPassByRefMut_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NeedlessPassByRefMut (needless_pass_by_ref_mut.rs:123)
// stub: src/tools/clippy/clippy_lints/src/needless_pass_by_ref_mut.rs:124 check_fn (lane lint-files)
NeedlessPassByRefMut.prototype.check_fn = function (cx, kind, decl, body, span, fn_def_id) {
  unported("clippy_lints::needless_pass_by_ref_mut::NeedlessPassByRefMut::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/needless_pass_by_ref_mut.rs:238 check_expr (lane lint-files)
NeedlessPassByRefMut.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_pass_by_ref_mut::NeedlessPassByRefMut::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/needless_pass_by_ref_mut.rs:259 check_crate_post (lane lint-files)
NeedlessPassByRefMut.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::needless_pass_by_ref_mut::NeedlessPassByRefMut::check_crate_post");
};
