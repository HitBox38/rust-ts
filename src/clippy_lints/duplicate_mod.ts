// Port of src/tools/clippy/clippy_lints/src/duplicate_mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DuplicateMod_impl_lint_pass } from "./duplicate_mod.lints.gen.ts";
export * from "./duplicate_mod.lints.gen.ts";

// ---- DuplicateMod (early sub-pass; impl_lint_pass! in duplicate_mod.rs) ----
export interface DuplicateMod extends EarlyLintPass {}
/** `struct DuplicateMod { .. }` (duplicate_mod.rs:57); its `impl_lint_pass!` expansion is `DuplicateMod_impl_lint_pass`. Fields: ported by the fill lane. */
export class DuplicateMod implements LintPass {
  /** `#[derive(Default)]` */
  static default(): DuplicateMod {
    return unported("clippy_lints::duplicate_mod::DuplicateMod::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return DuplicateMod_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DuplicateMod_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DuplicateMod_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for DuplicateMod (duplicate_mod.rs:63)
// stub: src/tools/clippy/clippy_lints/src/duplicate_mod.rs:64 check_item (lane always-running)
DuplicateMod.prototype.check_item = function (cx, item) {
  unported("clippy_lints::duplicate_mod::DuplicateMod::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/duplicate_mod.rs:80 check_crate_post (lane always-running)
DuplicateMod.prototype.check_crate_post = function (cx, _0) {
  unported("clippy_lints::duplicate_mod::DuplicateMod::check_crate_post");
};
