// Port of src/tools/clippy/clippy_lints/src/new_without_default.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NewWithoutDefault_impl_lint_pass } from "./new_without_default.lints.gen.ts";
export * from "./new_without_default.lints.gen.ts";

// ---- NewWithoutDefault (late sub-pass; impl_lint_pass! in new_without_default.rs) ----
export interface NewWithoutDefault extends LateLintPass {}
/** `struct NewWithoutDefault { .. }` (new_without_default.rs:55); its `impl_lint_pass!` expansion is `NewWithoutDefault_impl_lint_pass`. Fields: ported by the fill lane. */
export class NewWithoutDefault implements LintPass {
  /** `#[derive(Default)]` */
  static default(): NewWithoutDefault {
    return unported("clippy_lints::new_without_default::NewWithoutDefault::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return NewWithoutDefault_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NewWithoutDefault_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NewWithoutDefault_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NewWithoutDefault (new_without_default.rs:59)
// stub: src/tools/clippy/clippy_lints/src/new_without_default.rs:61 check_item (lane lint-files)
NewWithoutDefault.prototype.check_item = function (cx, item) {
  unported("clippy_lints::new_without_default::NewWithoutDefault::check_item");
};
