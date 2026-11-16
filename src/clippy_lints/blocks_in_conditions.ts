// Port of src/tools/clippy/clippy_lints/src/blocks_in_conditions.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { BlocksInConditions } from "./blocks_in_conditions.lints.gen.ts";
export * from "./blocks_in_conditions.lints.gen.ts";

declare module "./blocks_in_conditions.lints.gen.ts" {
  interface BlocksInConditions extends LateLintPass {}
}

// ---- BlocksInConditions (late sub-pass; declare_lint_pass! in blocks_in_conditions.rs) ----

// impl LateLintPass for BlocksInConditions (blocks_in_conditions.rs:53)
// stub: src/tools/clippy/clippy_lints/src/blocks_in_conditions.rs:54 check_expr (lane lint-files)
BlocksInConditions.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::blocks_in_conditions::BlocksInConditions::check_expr");
};
