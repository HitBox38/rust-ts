// Port of src/tools/clippy/clippy_lints/src/ifs/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unported } from "../../std/panic.ts";
import { CopyAndPaste_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- CopyAndPaste (late sub-pass; impl_lint_pass! in ifs/mod.rs) ----
export interface CopyAndPaste extends LateLintPass {}
/** `struct CopyAndPaste { .. }` (ifs/mod.rs:174); its `impl_lint_pass!` expansion is `CopyAndPaste_impl_lint_pass`. Fields: ported by the fill lane. */
export class CopyAndPaste implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/ifs/mod.rs:179 new (lane dispatch)
  static new(tcx: TyCtxt, conf: Conf): CopyAndPaste {
    return unported("clippy_lints::ifs::CopyAndPaste::new");
  }

  name(): string {
    return CopyAndPaste_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return CopyAndPaste_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return CopyAndPaste_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for CopyAndPaste (ifs/mod.rs:186)
// stub: src/tools/clippy/clippy_lints/src/ifs/mod.rs:187 check_expr (lane dispatch)
CopyAndPaste.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::ifs::CopyAndPaste::check_expr");
};
