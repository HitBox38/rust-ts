// Port of src/tools/clippy/clippy_lints/src/if_then_some_else_none.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { IfThenSomeElseNone_impl_lint_pass } from "./if_then_some_else_none.lints.gen.ts";
export * from "./if_then_some_else_none.lints.gen.ts";

// ---- IfThenSomeElseNone (late sub-pass; impl_lint_pass! in if_then_some_else_none.rs) ----
export interface IfThenSomeElseNone extends LateLintPass {}
/** `struct IfThenSomeElseNone { .. }` (if_then_some_else_none.rs:54); its `impl_lint_pass!` expansion is `IfThenSomeElseNone_impl_lint_pass`. Fields: ported by the fill lane. */
export class IfThenSomeElseNone implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/if_then_some_else_none.rs:59 new (lane lint-files)
  static new(conf: Conf): IfThenSomeElseNone {
    return unported("clippy_lints::if_then_some_else_none::IfThenSomeElseNone::new");
  }

  name(): string {
    return IfThenSomeElseNone_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return IfThenSomeElseNone_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return IfThenSomeElseNone_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for IfThenSomeElseNone (if_then_some_else_none.rs:64)
// stub: src/tools/clippy/clippy_lints/src/if_then_some_else_none.rs:65 check_expr (lane lint-files)
IfThenSomeElseNone.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::if_then_some_else_none::IfThenSomeElseNone::check_expr");
};
