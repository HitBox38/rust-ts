// Port of src/tools/clippy/clippy_lints/src/unused_rounding.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnusedRounding } from "./unused_rounding.lints.gen.ts";
export * from "./unused_rounding.lints.gen.ts";

declare module "./unused_rounding.lints.gen.ts" {
  interface UnusedRounding extends EarlyLintPass {}
}

// ---- UnusedRounding (early sub-pass; declare_lint_pass! in unused_rounding.rs) ----

// impl EarlyLintPass for UnusedRounding (unused_rounding.rs:54)
// stub: src/tools/clippy/clippy_lints/src/unused_rounding.rs:55 check_expr (lane always-running)
UnusedRounding.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::unused_rounding::UnusedRounding::check_expr");
};
