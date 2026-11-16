// Port of src/tools/clippy/clippy_lints/src/explicit_write.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { FormatArgsStorage } from "../clippy_utils/macros.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ExplicitWrite_impl_lint_pass } from "./explicit_write.lints.gen.ts";
export * from "./explicit_write.lints.gen.ts";

// ---- ExplicitWrite (late sub-pass; impl_lint_pass! in explicit_write.rs) ----
export interface ExplicitWrite extends LateLintPass {}
/** `struct ExplicitWrite { .. }` (explicit_write.rs:43); its `impl_lint_pass!` expansion is `ExplicitWrite_impl_lint_pass`. Fields: ported by the fill lane. */
export class ExplicitWrite implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/explicit_write.rs:48 new (lane lint-files)
  static new(format_args: FormatArgsStorage): ExplicitWrite {
    return unported("clippy_lints::explicit_write::ExplicitWrite::new");
  }

  name(): string {
    return ExplicitWrite_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ExplicitWrite_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ExplicitWrite_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ExplicitWrite (explicit_write.rs:53)
// stub: src/tools/clippy/clippy_lints/src/explicit_write.rs:54 check_expr (lane lint-files)
ExplicitWrite.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::explicit_write::ExplicitWrite::check_expr");
};
