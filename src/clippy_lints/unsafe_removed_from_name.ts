// Port of src/tools/clippy/clippy_lints/src/unsafe_removed_from_name.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnsafeNameRemoval } from "./unsafe_removed_from_name.lints.gen.ts";
export * from "./unsafe_removed_from_name.lints.gen.ts";

declare module "./unsafe_removed_from_name.lints.gen.ts" {
  interface UnsafeNameRemoval extends EarlyLintPass {}
}

// ---- UnsafeNameRemoval (early sub-pass; declare_lint_pass! in unsafe_removed_from_name.rs) ----

// impl EarlyLintPass for UnsafeNameRemoval (unsafe_removed_from_name.rs:31)
// stub: src/tools/clippy/clippy_lints/src/unsafe_removed_from_name.rs:32 check_item (lane always-running)
UnsafeNameRemoval.prototype.check_item = function (cx, item) {
  unported("clippy_lints::unsafe_removed_from_name::UnsafeNameRemoval::check_item");
};
