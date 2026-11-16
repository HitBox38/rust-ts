// Port of src/tools/clippy/clippy_lints/src/missing_const_for_fn.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MissingConstForFn_impl_lint_pass } from "./missing_const_for_fn.lints.gen.ts";
export * from "./missing_const_for_fn.lints.gen.ts";

// ---- MissingConstForFn (late sub-pass; impl_lint_pass! in missing_const_for_fn.rs) ----
export interface MissingConstForFn extends LateLintPass {}
/** `struct MissingConstForFn { .. }` (missing_const_for_fn.rs:78); its `impl_lint_pass!` expansion is `MissingConstForFn_impl_lint_pass`. Fields: ported by the fill lane. */
export class MissingConstForFn implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/missing_const_for_fn.rs:83 new (lane lint-files)
  static new(conf: Conf): MissingConstForFn {
    return unported("clippy_lints::missing_const_for_fn::MissingConstForFn::new");
  }

  name(): string {
    return MissingConstForFn_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MissingConstForFn_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MissingConstForFn_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MissingConstForFn (missing_const_for_fn.rs:88)
// stub: src/tools/clippy/clippy_lints/src/missing_const_for_fn.rs:89 check_fn (lane lint-files)
MissingConstForFn.prototype.check_fn = function (cx, kind, _0, body, span, def_id) {
  unported("clippy_lints::missing_const_for_fn::MissingConstForFn::check_fn");
};
