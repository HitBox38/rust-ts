// Port of src/tools/clippy/clippy_lints/src/significant_drop_tightening.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { SignificantDropTightening_impl_lint_pass } from "./significant_drop_tightening.lints.gen.ts";
export * from "./significant_drop_tightening.lints.gen.ts";

// ---- SignificantDropTightening (late sub-pass; impl_lint_pass! in significant_drop_tightening.rs) ----
export interface SignificantDropTightening extends LateLintPass {}
/** `struct SignificantDropTightening { .. }` (significant_drop_tightening.rs:59); its `impl_lint_pass!` expansion is `SignificantDropTightening_impl_lint_pass`. Fields: ported by the fill lane. */
export class SignificantDropTightening implements LintPass {
  /** `#[derive(Default)]` */
  static default(): SignificantDropTightening {
    return unported("clippy_lints::significant_drop_tightening::SignificantDropTightening::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return SignificantDropTightening_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return SignificantDropTightening_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return SignificantDropTightening_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for SignificantDropTightening (significant_drop_tightening.rs:65)
// stub: src/tools/clippy/clippy_lints/src/significant_drop_tightening.rs:66 check_fn (lane lint-files)
SignificantDropTightening.prototype.check_fn = function (cx, _0, _1, body, _2, _3) {
  unported("clippy_lints::significant_drop_tightening::SignificantDropTightening::check_fn");
};
