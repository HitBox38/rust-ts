// Port of src/tools/clippy/clippy_lints/src/extra_unused_type_parameters.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ExtraUnusedTypeParameters_impl_lint_pass } from "./extra_unused_type_parameters.lints.gen.ts";
export * from "./extra_unused_type_parameters.lints.gen.ts";

// ---- ExtraUnusedTypeParameters (late sub-pass; impl_lint_pass! in extra_unused_type_parameters.rs) ----
export interface ExtraUnusedTypeParameters extends LateLintPass {}
/** `struct ExtraUnusedTypeParameters { .. }` (extra_unused_type_parameters.rs:44); its `impl_lint_pass!` expansion is `ExtraUnusedTypeParameters_impl_lint_pass`. Fields: ported by the fill lane. */
export class ExtraUnusedTypeParameters implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/extra_unused_type_parameters.rs:49 new (lane lint-files)
  static new(conf: Conf): ExtraUnusedTypeParameters {
    return unported("clippy_lints::extra_unused_type_parameters::ExtraUnusedTypeParameters::new");
  }

  name(): string {
    return ExtraUnusedTypeParameters_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ExtraUnusedTypeParameters_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ExtraUnusedTypeParameters_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ExtraUnusedTypeParameters (extra_unused_type_parameters.rs:257)
// stub: src/tools/clippy/clippy_lints/src/extra_unused_type_parameters.rs:258 check_item (lane lint-files)
ExtraUnusedTypeParameters.prototype.check_item = function (cx, item) {
  unported("clippy_lints::extra_unused_type_parameters::ExtraUnusedTypeParameters::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/extra_unused_type_parameters.rs:276 check_impl_item (lane lint-files)
ExtraUnusedTypeParameters.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::extra_unused_type_parameters::ExtraUnusedTypeParameters::check_impl_item");
};
