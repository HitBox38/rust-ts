// Port of src/tools/clippy/clippy_lints/src/missing_trait_methods.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MissingTraitMethods_impl_lint_pass } from "./missing_trait_methods.lints.gen.ts";
export * from "./missing_trait_methods.lints.gen.ts";

// ---- MissingTraitMethods (late sub-pass; impl_lint_pass! in missing_trait_methods.rs) ----
export interface MissingTraitMethods extends LateLintPass {}
/** `struct MissingTraitMethods { .. }` (missing_trait_methods.rs:62); its `impl_lint_pass!` expansion is `MissingTraitMethods_impl_lint_pass`. Fields: ported by the fill lane. */
export class MissingTraitMethods implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/missing_trait_methods.rs:67 new (lane lint-files)
  static new(conf: Conf): MissingTraitMethods {
    return unported("clippy_lints::missing_trait_methods::MissingTraitMethods::new");
  }

  name(): string {
    return MissingTraitMethods_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MissingTraitMethods_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MissingTraitMethods_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MissingTraitMethods (missing_trait_methods.rs:72)
// stub: src/tools/clippy/clippy_lints/src/missing_trait_methods.rs:73 check_item (lane lint-files)
MissingTraitMethods.prototype.check_item = function (cx, item) {
  unported("clippy_lints::missing_trait_methods::MissingTraitMethods::check_item");
};
