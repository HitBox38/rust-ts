// Port of src/tools/clippy/clippy_lints/src/unused_peekable.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnusedPeekable } from "./unused_peekable.lints.gen.ts";
export * from "./unused_peekable.lints.gen.ts";

declare module "./unused_peekable.lints.gen.ts" {
  interface UnusedPeekable extends LateLintPass {}
}

// ---- UnusedPeekable (late sub-pass; declare_lint_pass! in unused_peekable.rs) ----

// impl LateLintPass for UnusedPeekable (unused_peekable.rs:47)
// stub: src/tools/clippy/clippy_lints/src/unused_peekable.rs:48 check_block (lane lint-files)
UnusedPeekable.prototype.check_block = function (cx, block) {
  unported("clippy_lints::unused_peekable::UnusedPeekable::check_block");
};
