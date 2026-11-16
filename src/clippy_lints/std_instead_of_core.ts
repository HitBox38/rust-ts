// Port of src/tools/clippy/clippy_lints/src/std_instead_of_core.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { StdReexports_impl_lint_pass } from "./std_instead_of_core.lints.gen.ts";
export * from "./std_instead_of_core.lints.gen.ts";

// ---- StdReexports (late sub-pass; impl_lint_pass! in std_instead_of_core.rs) ----
export interface StdReexports extends LateLintPass {}
/** `struct StdReexports { .. }` (std_instead_of_core.rs:96); its `impl_lint_pass!` expansion is `StdReexports_impl_lint_pass`. Fields: ported by the fill lane. */
export class StdReexports implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:106 new (lane lint-files)
  static new(conf: Conf): StdReexports {
    return unported("clippy_lints::std_instead_of_core::StdReexports::new");
  }

  name(): string {
    return StdReexports_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return StdReexports_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return StdReexports_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for StdReexports (std_instead_of_core.rs:206)
// stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:207 check_item (lane lint-files)
StdReexports.prototype.check_item = function (cx, item) {
  unported("clippy_lints::std_instead_of_core::StdReexports::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:218 check_item_post (lane lint-files)
StdReexports.prototype.check_item_post = function (_0, _1) {
  unported("clippy_lints::std_instead_of_core::StdReexports::check_item_post");
};
// stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:222 check_path (lane lint-files)
StdReexports.prototype.check_path = function (cx, path, _0) {
  unported("clippy_lints::std_instead_of_core::StdReexports::check_path");
};
// stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:229 check_block_post (lane lint-files)
StdReexports.prototype.check_block_post = function (cx, _0) {
  unported("clippy_lints::std_instead_of_core::StdReexports::check_block_post");
};
// stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:233 check_body_post (lane lint-files)
StdReexports.prototype.check_body_post = function (cx, _0) {
  unported("clippy_lints::std_instead_of_core::StdReexports::check_body_post");
};
// stub: src/tools/clippy/clippy_lints/src/std_instead_of_core.rs:237 check_crate_post (lane lint-files)
StdReexports.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::std_instead_of_core::StdReexports::check_crate_post");
};
