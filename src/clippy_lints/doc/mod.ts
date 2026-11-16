// Port of src/tools/clippy/clippy_lints/src/doc/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { EarlyContext } from "../../rustc_lint/context.ts";
import type { EarlyLintPass, LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { LateContext } from "../../rustc_lint/context.ts";
import { unported } from "../../std/panic.ts";
import { Documentation_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Documentation (early + late sub-passes; impl_lint_pass! in doc/mod.rs) ----
export interface Documentation extends Documentation_dual {}
/** `struct Documentation { .. }` (doc/mod.rs:732); its `impl_lint_pass!` expansion is `Documentation_impl_lint_pass`. Fields: ported by the fill lane. */
export class Documentation implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/doc/mod.rs:738 new (lane dispatch)
  static new(conf: Conf): Documentation {
    return unported("clippy_lints::doc::Documentation::new");
  }

  name(): string {
    return Documentation_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Documentation_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Documentation_impl_lint_pass.lint_vec();
  }
}
/** PORT: `Documentation` implements both `EarlyLintPass` and `LateLintPass`; a TS class has one method per name, so each `check_*`
 * either trait has is one method that dispatches on the context (`LateContext` or `EarlyContext`), the other trait's
 * provided default (an empty body) where only one trait implements it. */
export interface Documentation_dual extends LintPass {
  check_attributes(cx: EarlyContext | LateContext, ...args: unknown[]): void;
}
// impl EarlyLintPass for Documentation (doc/mod.rs:746)
// impl LateLintPass for Documentation (doc/mod.rs:752)
Documentation.prototype.check_attributes = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // stub: src/tools/clippy/clippy_lints/src/doc/mod.rs:753 check_attributes (lane dispatch)
    unported("clippy_lints::doc::Documentation::check_attributes (LateLintPass)");
  } else {
    // stub: src/tools/clippy/clippy_lints/src/doc/mod.rs:747 check_attributes (lane dispatch)
    unported("clippy_lints::doc::Documentation::check_attributes (EarlyLintPass)");
  }
};
