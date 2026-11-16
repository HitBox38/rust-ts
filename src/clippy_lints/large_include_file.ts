// Port of src/tools/clippy/clippy_lints/src/large_include_file.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyContext } from "../rustc_lint/context.ts";
import type { EarlyLintPass, LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { LateContext } from "../rustc_lint/context.ts";
import { unported } from "../std/panic.ts";
import { LargeIncludeFile_impl_lint_pass } from "./large_include_file.lints.gen.ts";
export * from "./large_include_file.lints.gen.ts";

// ---- LargeIncludeFile (early + late sub-passes; impl_lint_pass! in large_include_file.rs) ----
export interface LargeIncludeFile extends LargeIncludeFile_dual {}
/** `struct LargeIncludeFile { .. }` (large_include_file.rs:42); its `impl_lint_pass!` expansion is `LargeIncludeFile_impl_lint_pass`. Fields: ported by the fill lane. */
export class LargeIncludeFile implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/large_include_file.rs:47 new (lane always-running)
  static new(conf: Conf): LargeIncludeFile {
    return unported("clippy_lints::large_include_file::LargeIncludeFile::new");
  }

  name(): string {
    return LargeIncludeFile_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LargeIncludeFile_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LargeIncludeFile_impl_lint_pass.lint_vec();
  }
}
/** PORT: `LargeIncludeFile` implements both `EarlyLintPass` and `LateLintPass`; a TS class has one method per name, so each `check_*`
 * either trait has is one method that dispatches on the context (`LateContext` or `EarlyContext`), the other trait's
 * provided default (an empty body) where only one trait implements it. */
export interface LargeIncludeFile_dual extends LintPass {
  check_expr(cx: EarlyContext | LateContext, ...args: unknown[]): void;
  check_attribute(cx: EarlyContext | LateContext, ...args: unknown[]): void;
}
// impl LateLintPass for LargeIncludeFile (large_include_file.rs:54)
LargeIncludeFile.prototype.check_expr = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // stub: src/tools/clippy/clippy_lints/src/large_include_file.rs:55 check_expr (lane always-running)
    unported("clippy_lints::large_include_file::LargeIncludeFile::check_expr (LateLintPass)");
  } else {
    // `EarlyLintPass::check_expr`: the provided default (empty)
  }
};
// impl EarlyLintPass for LargeIncludeFile (large_include_file.rs:86)
LargeIncludeFile.prototype.check_attribute = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // `LateLintPass::check_attribute`: the provided default (empty)
  } else {
    // stub: src/tools/clippy/clippy_lints/src/large_include_file.rs:87 check_attribute (lane always-running)
    unported("clippy_lints::large_include_file::LargeIncludeFile::check_attribute (EarlyLintPass)");
  }
};
