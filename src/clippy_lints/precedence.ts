// Port of src/tools/clippy/clippy_lints/src/precedence.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { Precedence } from "./precedence.lints.gen.ts";
export * from "./precedence.lints.gen.ts";

declare module "./precedence.lints.gen.ts" {
  interface Precedence extends EarlyLintPass {}
}

// ---- Precedence (early sub-pass; declare_lint_pass! in precedence.rs) ----

// impl EarlyLintPass for Precedence (precedence.rs:48)
// stub: src/tools/clippy/clippy_lints/src/precedence.rs:49 check_expr (lane always-running)
Precedence.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::precedence::Precedence::check_expr");
};
