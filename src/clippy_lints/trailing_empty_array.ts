// Port of src/tools/clippy/clippy_lints/src/trailing_empty_array.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { TrailingEmptyArray } from "./trailing_empty_array.lints.gen.ts";
export * from "./trailing_empty_array.lints.gen.ts";

declare module "./trailing_empty_array.lints.gen.ts" {
  interface TrailingEmptyArray extends LateLintPass {}
}

// ---- TrailingEmptyArray (late sub-pass; declare_lint_pass! in trailing_empty_array.rs) ----

// impl LateLintPass for TrailingEmptyArray (trailing_empty_array.rs:39)
// stub: src/tools/clippy/clippy_lints/src/trailing_empty_array.rs:40 check_item (lane lint-files)
TrailingEmptyArray.prototype.check_item = function (cx, item) {
  unported("clippy_lints::trailing_empty_array::TrailingEmptyArray::check_item");
};
