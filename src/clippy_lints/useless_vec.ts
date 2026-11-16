// Port of src/tools/clippy/clippy_lints/src/useless_vec.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UselessVec_impl_lint_pass } from "./useless_vec.lints.gen.ts";
export * from "./useless_vec.lints.gen.ts";

// ---- UselessVec (late sub-pass; impl_lint_pass! in useless_vec.rs) ----
export interface UselessVec extends LateLintPass {}
/** `struct UselessVec { .. }` (useless_vec.rs:21); its `impl_lint_pass!` expansion is `UselessVec_impl_lint_pass`. Fields: ported by the fill lane. */
export class UselessVec implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/useless_vec.rs:49 new (lane lint-files)
  static new(conf: Conf): UselessVec {
    return unported("clippy_lints::useless_vec::UselessVec::new");
  }

  name(): string {
    return UselessVec_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UselessVec_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UselessVec_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UselessVec (useless_vec.rs:172)
// stub: src/tools/clippy/clippy_lints/src/useless_vec.rs:173 check_expr (lane lint-files)
UselessVec.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::useless_vec::UselessVec::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/useless_vec.rs:241 check_crate_post (lane lint-files)
UselessVec.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::useless_vec::UselessVec::check_crate_post");
};
