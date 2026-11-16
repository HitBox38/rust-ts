// Port of src/tools/clippy/clippy_lints/src/disallowed_names.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DisallowedNames_impl_lint_pass } from "./disallowed_names.lints.gen.ts";
export * from "./disallowed_names.lints.gen.ts";

// ---- DisallowedNames (late sub-pass; impl_lint_pass! in disallowed_names.rs) ----
export interface DisallowedNames extends LateLintPass {}
/** `struct DisallowedNames { .. }` (disallowed_names.rs:30); its `impl_lint_pass!` expansion is `DisallowedNames_impl_lint_pass`. Fields: ported by the fill lane. */
export class DisallowedNames implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/disallowed_names.rs:35 new (lane lint-files)
  static new(conf: Conf): DisallowedNames {
    return unported("clippy_lints::disallowed_names::DisallowedNames::new");
  }

  name(): string {
    return DisallowedNames_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DisallowedNames_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DisallowedNames_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DisallowedNames (disallowed_names.rs:42)
// stub: src/tools/clippy/clippy_lints/src/disallowed_names.rs:43 check_pat (lane lint-files)
DisallowedNames.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::disallowed_names::DisallowedNames::check_pat");
};
