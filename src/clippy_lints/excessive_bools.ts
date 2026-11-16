// Port of src/tools/clippy/clippy_lints/src/excessive_bools.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ExcessiveBools_impl_lint_pass } from "./excessive_bools.lints.gen.ts";
export * from "./excessive_bools.lints.gen.ts";

// ---- ExcessiveBools (late sub-pass; impl_lint_pass! in excessive_bools.rs) ----
export interface ExcessiveBools extends LateLintPass {}
/** `struct ExcessiveBools { .. }` (excessive_bools.rs:111); its `impl_lint_pass!` expansion is `ExcessiveBools_impl_lint_pass`. Fields: ported by the fill lane. */
export class ExcessiveBools implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/excessive_bools.rs:117 new (lane lint-files)
  static new(conf: Conf): ExcessiveBools {
    return unported("clippy_lints::excessive_bools::ExcessiveBools::new");
  }

  name(): string {
    return ExcessiveBools_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ExcessiveBools_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ExcessiveBools_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ExcessiveBools (excessive_bools.rs:146)
// stub: src/tools/clippy/clippy_lints/src/excessive_bools.rs:147 check_item (lane lint-files)
ExcessiveBools.prototype.check_item = function (cx, item) {
  unported("clippy_lints::excessive_bools::ExcessiveBools::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/excessive_bools.rs:168 check_trait_item (lane lint-files)
ExcessiveBools.prototype.check_trait_item = function (cx, trait_item) {
  unported("clippy_lints::excessive_bools::ExcessiveBools::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/excessive_bools.rs:178 check_fn (lane lint-files)
ExcessiveBools.prototype.check_fn = function (cx, fn_kind, fn_decl, _0, span, def_id) {
  unported("clippy_lints::excessive_bools::ExcessiveBools::check_fn");
};
