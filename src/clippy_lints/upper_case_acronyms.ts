// Port of src/tools/clippy/clippy_lints/src/upper_case_acronyms.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UpperCaseAcronyms_impl_lint_pass } from "./upper_case_acronyms.lints.gen.ts";
export * from "./upper_case_acronyms.lints.gen.ts";

// ---- UpperCaseAcronyms (late sub-pass; impl_lint_pass! in upper_case_acronyms.rs) ----
export interface UpperCaseAcronyms extends LateLintPass {}
/** `struct UpperCaseAcronyms { .. }` (upper_case_acronyms.rs:43); its `impl_lint_pass!` expansion is `UpperCaseAcronyms_impl_lint_pass`. Fields: ported by the fill lane. */
export class UpperCaseAcronyms implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/upper_case_acronyms.rs:49 new (lane lint-files)
  static new(conf: Conf): UpperCaseAcronyms {
    return unported("clippy_lints::upper_case_acronyms::UpperCaseAcronyms::new");
  }

  name(): string {
    return UpperCaseAcronyms_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UpperCaseAcronyms_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UpperCaseAcronyms_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UpperCaseAcronyms (upper_case_acronyms.rs:124)
// stub: src/tools/clippy/clippy_lints/src/upper_case_acronyms.rs:125 check_item (lane lint-files)
UpperCaseAcronyms.prototype.check_item = function (cx, it) {
  unported("clippy_lints::upper_case_acronyms::UpperCaseAcronyms::check_item");
};
