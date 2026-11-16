// Port of src/tools/clippy/clippy_lints/src/redundant_else.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { RedundantElse } from "./redundant_else.lints.gen.ts";
export * from "./redundant_else.lints.gen.ts";

declare module "./redundant_else.lints.gen.ts" {
  interface RedundantElse extends LateLintPass {}
}

// ---- RedundantElse (late sub-pass; declare_lint_pass! in redundant_else.rs) ----

// impl LateLintPass for RedundantElse (redundant_else.rs:49)
// stub: src/tools/clippy/clippy_lints/src/redundant_else.rs:50 check_block_post (lane lint-files)
RedundantElse.prototype.check_block_post = function (cx, b) {
  unported("clippy_lints::redundant_else::RedundantElse::check_block_post");
};
// stub: src/tools/clippy/clippy_lints/src/redundant_else.rs:56 check_stmt (lane lint-files)
RedundantElse.prototype.check_stmt = function (cx, s) {
  unported("clippy_lints::redundant_else::RedundantElse::check_stmt");
};
