// Port of src/tools/clippy/clippy_lints/src/copy_iterator.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { CopyIterator } from "./copy_iterator.lints.gen.ts";
export * from "./copy_iterator.lints.gen.ts";

declare module "./copy_iterator.lints.gen.ts" {
  interface CopyIterator extends LateLintPass {}
}

// ---- CopyIterator (late sub-pass; declare_lint_pass! in copy_iterator.rs) ----

// impl LateLintPass for CopyIterator (copy_iterator.rs:36)
// stub: src/tools/clippy/clippy_lints/src/copy_iterator.rs:37 check_item (lane lint-files)
CopyIterator.prototype.check_item = function (cx, item) {
  unported("clippy_lints::copy_iterator::CopyIterator::check_item");
};
