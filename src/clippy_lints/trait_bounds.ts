// Port of src/tools/clippy/clippy_lints/src/trait_bounds.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { TraitBounds_impl_lint_pass } from "./trait_bounds.lints.gen.ts";
export * from "./trait_bounds.lints.gen.ts";

// ---- TraitBounds (late sub-pass; impl_lint_pass! in trait_bounds.rs) ----
export interface TraitBounds extends LateLintPass {}
/** `struct TraitBounds { .. }` (trait_bounds.rs:94); its `impl_lint_pass!` expansion is `TraitBounds_impl_lint_pass`. Fields: ported by the fill lane. */
export class TraitBounds implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/trait_bounds.rs:100 new (lane lint-files)
  static new(conf: Conf): TraitBounds {
    return unported("clippy_lints::trait_bounds::TraitBounds::new");
  }

  name(): string {
    return TraitBounds_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return TraitBounds_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return TraitBounds_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for TraitBounds (trait_bounds.rs:108)
// stub: src/tools/clippy/clippy_lints/src/trait_bounds.rs:109 check_generics (lane lint-files)
TraitBounds.prototype.check_generics = function (cx, generics) {
  unported("clippy_lints::trait_bounds::TraitBounds::check_generics");
};
// stub: src/tools/clippy/clippy_lints/src/trait_bounds.rs:114 check_item (lane lint-files)
TraitBounds.prototype.check_item = function (cx, item) {
  unported("clippy_lints::trait_bounds::TraitBounds::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/trait_bounds.rs:126 check_trait_item (lane lint-files)
TraitBounds.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::trait_bounds::TraitBounds::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/trait_bounds.rs:180 check_ty (lane lint-files)
TraitBounds.prototype.check_ty = function (cx, ty) {
  unported("clippy_lints::trait_bounds::TraitBounds::check_ty");
};
