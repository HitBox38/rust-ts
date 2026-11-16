// Port of src/tools/clippy/clippy_lints/src/formatting.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { Formatting } from "./formatting.lints.gen.ts";
export * from "./formatting.lints.gen.ts";

declare module "./formatting.lints.gen.ts" {
  interface Formatting extends EarlyLintPass {}
}

// ---- Formatting (early sub-pass; declare_lint_pass! in formatting.rs) ----

// impl EarlyLintPass for Formatting (formatting.rs:147)
// stub: src/tools/clippy/clippy_lints/src/formatting.rs:148 check_block (lane always-running)
Formatting.prototype.check_block = function (cx, block) {
  unported("clippy_lints::formatting::Formatting::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/formatting.rs:156 check_expr (lane always-running)
Formatting.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::formatting::Formatting::check_expr");
};
