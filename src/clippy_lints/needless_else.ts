// Port of src/tools/clippy/clippy_lints/src/needless_else.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessElse } from "./needless_else.lints.gen.ts";
export * from "./needless_else.lints.gen.ts";

declare module "./needless_else.lints.gen.ts" {
  interface NeedlessElse extends EarlyLintPass {}
}

// ---- NeedlessElse (early sub-pass; declare_lint_pass! in needless_else.rs) ----

// impl EarlyLintPass for NeedlessElse (needless_else.rs:37)
// stub: src/tools/clippy/clippy_lints/src/needless_else.rs:38 check_expr (lane always-running)
NeedlessElse.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_else::NeedlessElse::check_expr");
};
