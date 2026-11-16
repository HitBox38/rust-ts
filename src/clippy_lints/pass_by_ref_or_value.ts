// Port of src/tools/clippy/clippy_lints/src/pass_by_ref_or_value.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { PassByRefOrValue_impl_lint_pass } from "./pass_by_ref_or_value.lints.gen.ts";
export * from "./pass_by_ref_or_value.lints.gen.ts";

// ---- PassByRefOrValue (late sub-pass; impl_lint_pass! in pass_by_ref_or_value.rs) ----
export interface PassByRefOrValue extends LateLintPass {}
/** `struct PassByRefOrValue { .. }` (pass_by_ref_or_value.rs:109); its `impl_lint_pass!` expansion is `PassByRefOrValue_impl_lint_pass`. Fields: ported by the fill lane. */
export class PassByRefOrValue implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/pass_by_ref_or_value.rs:116 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): PassByRefOrValue {
    return unported("clippy_lints::pass_by_ref_or_value::PassByRefOrValue::new");
  }

  name(): string {
    return PassByRefOrValue_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return PassByRefOrValue_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return PassByRefOrValue_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for PassByRefOrValue (pass_by_ref_or_value.rs:245)
// stub: src/tools/clippy/clippy_lints/src/pass_by_ref_or_value.rs:246 check_trait_item (lane lint-files)
PassByRefOrValue.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::pass_by_ref_or_value::PassByRefOrValue::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/pass_by_ref_or_value.rs:256 check_fn (lane lint-files)
PassByRefOrValue.prototype.check_fn = function (cx, kind, decl, _body, span, def_id) {
  unported("clippy_lints::pass_by_ref_or_value::PassByRefOrValue::check_fn");
};
