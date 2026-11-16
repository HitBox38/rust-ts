// Port of src/tools/clippy/clippy_lints/src/semicolon_block.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { SemicolonBlock_impl_lint_pass } from "./semicolon_block.lints.gen.ts";
export * from "./semicolon_block.lints.gen.ts";

// ---- SemicolonBlock (late sub-pass; impl_lint_pass! in semicolon_block.rs) ----
export interface SemicolonBlock extends LateLintPass {}
/** `struct SemicolonBlock { .. }` (semicolon_block.rs:70); its `impl_lint_pass!` expansion is `SemicolonBlock_impl_lint_pass`. Fields: ported by the fill lane. */
export class SemicolonBlock implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/semicolon_block.rs:76 new (lane lint-files)
  static new(conf: Conf): SemicolonBlock {
    return unported("clippy_lints::semicolon_block::SemicolonBlock::new");
  }

  name(): string {
    return SemicolonBlock_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return SemicolonBlock_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return SemicolonBlock_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for SemicolonBlock (semicolon_block.rs:155)
// stub: src/tools/clippy/clippy_lints/src/semicolon_block.rs:156 check_stmt (lane lint-files)
SemicolonBlock.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::semicolon_block::SemicolonBlock::check_stmt");
};
