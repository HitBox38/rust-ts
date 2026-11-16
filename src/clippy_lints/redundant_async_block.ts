// Port of src/tools/clippy/clippy_lints/src/redundant_async_block.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { RedundantAsyncBlock } from "./redundant_async_block.lints.gen.ts";
export * from "./redundant_async_block.lints.gen.ts";

declare module "./redundant_async_block.lints.gen.ts" {
  interface RedundantAsyncBlock extends LateLintPass {}
}

// ---- RedundantAsyncBlock (late sub-pass; declare_lint_pass! in redundant_async_block.rs) ----

// impl LateLintPass for RedundantAsyncBlock (redundant_async_block.rs:41)
// stub: src/tools/clippy/clippy_lints/src/redundant_async_block.rs:42 check_expr (lane lint-files)
RedundantAsyncBlock.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::redundant_async_block::RedundantAsyncBlock::check_expr");
};
