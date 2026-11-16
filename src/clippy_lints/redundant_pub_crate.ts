// Port of src/tools/clippy/clippy_lints/src/redundant_pub_crate.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { RedundantPubCrate_impl_lint_pass } from "./redundant_pub_crate.lints.gen.ts";
export * from "./redundant_pub_crate.lints.gen.ts";

// ---- RedundantPubCrate (late sub-pass; impl_lint_pass! in redundant_pub_crate.rs) ----
export interface RedundantPubCrate extends LateLintPass {}
/** `struct RedundantPubCrate { .. }` (redundant_pub_crate.rs:40); its `impl_lint_pass!` expansion is `RedundantPubCrate_impl_lint_pass`. Fields: ported by the fill lane. */
export class RedundantPubCrate implements LintPass {
  /** `#[derive(Default)]` */
  static default(): RedundantPubCrate {
    return unported("clippy_lints::redundant_pub_crate::RedundantPubCrate::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return RedundantPubCrate_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return RedundantPubCrate_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return RedundantPubCrate_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for RedundantPubCrate (redundant_pub_crate.rs:44)
// stub: src/tools/clippy/clippy_lints/src/redundant_pub_crate.rs:45 check_item (lane lint-files)
RedundantPubCrate.prototype.check_item = function (cx, item) {
  unported("clippy_lints::redundant_pub_crate::RedundantPubCrate::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/redundant_pub_crate.rs:79 check_item_post (lane lint-files)
RedundantPubCrate.prototype.check_item_post = function (_cx, item) {
  unported("clippy_lints::redundant_pub_crate::RedundantPubCrate::check_item_post");
};
