// Port of src/tools/clippy/clippy_lints/src/unused_trait_names.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnusedTraitNames_impl_lint_pass } from "./unused_trait_names.lints.gen.ts";
export * from "./unused_trait_names.lints.gen.ts";

// ---- UnusedTraitNames (late sub-pass; impl_lint_pass! in unused_trait_names.rs) ----
export interface UnusedTraitNames extends LateLintPass {}
/** `struct UnusedTraitNames { .. }` (unused_trait_names.rs:49); its `impl_lint_pass!` expansion is `UnusedTraitNames_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnusedTraitNames implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unused_trait_names.rs:54 new (lane lint-files)
  static new(conf: Conf): UnusedTraitNames {
    return unported("clippy_lints::unused_trait_names::UnusedTraitNames::new");
  }

  name(): string {
    return UnusedTraitNames_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnusedTraitNames_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnusedTraitNames_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnusedTraitNames (unused_trait_names.rs:112)
// stub: src/tools/clippy/clippy_lints/src/unused_trait_names.rs:113 check_item (lane lint-files)
UnusedTraitNames.prototype.check_item = function (cx, item) {
  unported("clippy_lints::unused_trait_names::UnusedTraitNames::check_item");
};
