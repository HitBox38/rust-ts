// Port of src/tools/clippy/clippy_lints/src/disallowed_types.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { DisallowedTypes_impl_lint_pass } from "./disallowed_types.lints.gen.ts";
export * from "./disallowed_types.lints.gen.ts";

// ---- DisallowedTypes (late sub-pass; impl_lint_pass! in disallowed_types.rs) ----
export interface DisallowedTypes extends LateLintPass {}
/** `struct DisallowedTypes { .. }` (disallowed_types.rs:61); its `impl_lint_pass!` expansion is `DisallowedTypes_impl_lint_pass`. Fields: ported by the fill lane. */
export class DisallowedTypes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/disallowed_types.rs:67 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): DisallowedTypes {
    return unported("clippy_lints::disallowed_types::DisallowedTypes::new");
  }

  name(): string {
    return DisallowedTypes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DisallowedTypes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DisallowedTypes_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DisallowedTypes (disallowed_types.rs:108)
// stub: src/tools/clippy/clippy_lints/src/disallowed_types.rs:109 check_item (lane lint-files)
DisallowedTypes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::disallowed_types::DisallowedTypes::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_types.rs:120 check_ty (lane lint-files)
DisallowedTypes.prototype.check_ty = function (cx, ty) {
  unported("clippy_lints::disallowed_types::DisallowedTypes::check_ty");
};
// stub: src/tools/clippy/clippy_lints/src/disallowed_types.rs:126 check_poly_trait_ref (lane lint-files)
DisallowedTypes.prototype.check_poly_trait_ref = function (cx, poly) {
  unported("clippy_lints::disallowed_types::DisallowedTypes::check_poly_trait_ref");
};
