// Port of src/tools/clippy/clippy_lints/src/pub_underscore_fields.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { PubUnderscoreFields_impl_lint_pass } from "./pub_underscore_fields.lints.gen.ts";
export * from "./pub_underscore_fields.lints.gen.ts";

// ---- PubUnderscoreFields (late sub-pass; impl_lint_pass! in pub_underscore_fields.rs) ----
export interface PubUnderscoreFields extends LateLintPass {}
/** `struct PubUnderscoreFields { .. }` (pub_underscore_fields.rs:48); its `impl_lint_pass!` expansion is `PubUnderscoreFields_impl_lint_pass`. Fields: ported by the fill lane. */
export class PubUnderscoreFields implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/pub_underscore_fields.rs:52 new (lane lint-files)
  static new(conf: Conf): PubUnderscoreFields {
    return unported("clippy_lints::pub_underscore_fields::PubUnderscoreFields::new");
  }

  name(): string {
    return PubUnderscoreFields_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return PubUnderscoreFields_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return PubUnderscoreFields_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for PubUnderscoreFields (pub_underscore_fields.rs:59)
// stub: src/tools/clippy/clippy_lints/src/pub_underscore_fields.rs:60 check_item (lane lint-files)
PubUnderscoreFields.prototype.check_item = function (cx, item) {
  unported("clippy_lints::pub_underscore_fields::PubUnderscoreFields::check_item");
};
