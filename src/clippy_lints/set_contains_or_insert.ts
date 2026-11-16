// Port of src/tools/clippy/clippy_lints/src/set_contains_or_insert.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SetContainsOrInsert } from "./set_contains_or_insert.lints.gen.ts";
export * from "./set_contains_or_insert.lints.gen.ts";

declare module "./set_contains_or_insert.lints.gen.ts" {
  interface SetContainsOrInsert extends LateLintPass {}
}

// ---- SetContainsOrInsert (late sub-pass; declare_lint_pass! in set_contains_or_insert.rs) ----

// impl LateLintPass for SetContainsOrInsert (set_contains_or_insert.rs:52)
// stub: src/tools/clippy/clippy_lints/src/set_contains_or_insert.rs:53 check_expr (lane lint-files)
SetContainsOrInsert.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::set_contains_or_insert::SetContainsOrInsert::check_expr");
};
