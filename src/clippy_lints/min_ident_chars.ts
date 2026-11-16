// Port of src/tools/clippy/clippy_lints/src/min_ident_chars.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MinIdentChars_impl_lint_pass } from "./min_ident_chars.lints.gen.ts";
export * from "./min_ident_chars.lints.gen.ts";

// ---- MinIdentChars (late sub-pass; impl_lint_pass! in min_ident_chars.rs) ----
export interface MinIdentChars extends LateLintPass {}
/** `struct MinIdentChars { .. }` (min_ident_chars.rs:50); its `impl_lint_pass!` expansion is `MinIdentChars_impl_lint_pass`. Fields: ported by the fill lane. */
export class MinIdentChars implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:64 new (lane lint-files)
  static new(conf: Conf): MinIdentChars {
    return unported("clippy_lints::min_ident_chars::MinIdentChars::new");
  }

  name(): string {
    return MinIdentChars_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MinIdentChars_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MinIdentChars_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MinIdentChars (min_ident_chars.rs:135)
// stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:136 check_item (lane lint-files)
MinIdentChars.prototype.check_item = function (cx, i) {
  unported("clippy_lints::min_ident_chars::MinIdentChars::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:172 check_trait_item (lane lint-files)
MinIdentChars.prototype.check_trait_item = function (cx, i) {
  unported("clippy_lints::min_ident_chars::MinIdentChars::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:193 check_impl_item (lane lint-files)
MinIdentChars.prototype.check_impl_item = function (cx, i) {
  unported("clippy_lints::min_ident_chars::MinIdentChars::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:230 check_field_def (lane lint-files)
MinIdentChars.prototype.check_field_def = function (cx, f) {
  unported("clippy_lints::min_ident_chars::MinIdentChars::check_field_def");
};
// stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:236 check_variant (lane lint-files)
MinIdentChars.prototype.check_variant = function (cx, v) {
  unported("clippy_lints::min_ident_chars::MinIdentChars::check_variant");
};
// stub: src/tools/clippy/clippy_lints/src/min_ident_chars.rs:242 check_pat (lane lint-files)
MinIdentChars.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::min_ident_chars::MinIdentChars::check_pat");
};
