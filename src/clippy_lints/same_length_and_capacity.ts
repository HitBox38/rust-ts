// Port of src/tools/clippy/clippy_lints/src/same_length_and_capacity.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SameLengthAndCapacity } from "./same_length_and_capacity.lints.gen.ts";
export * from "./same_length_and_capacity.lints.gen.ts";

declare module "./same_length_and_capacity.lints.gen.ts" {
  interface SameLengthAndCapacity extends LateLintPass {}
}

// ---- SameLengthAndCapacity (late sub-pass; declare_lint_pass! in same_length_and_capacity.rs) ----

// impl LateLintPass for SameLengthAndCapacity (same_length_and_capacity.rs:76)
// stub: src/tools/clippy/clippy_lints/src/same_length_and_capacity.rs:77 check_expr (lane lint-files)
SameLengthAndCapacity.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::same_length_and_capacity::SameLengthAndCapacity::check_expr");
};
