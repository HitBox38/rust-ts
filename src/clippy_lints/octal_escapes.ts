// Port of src/tools/clippy/clippy_lints/src/octal_escapes.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { OctalEscapes } from "./octal_escapes.lints.gen.ts";
export * from "./octal_escapes.lints.gen.ts";

declare module "./octal_escapes.lints.gen.ts" {
  interface OctalEscapes extends EarlyLintPass {}
}

// ---- OctalEscapes (early sub-pass; declare_lint_pass! in octal_escapes.rs) ----

// impl EarlyLintPass for OctalEscapes (octal_escapes.rs:51)
// stub: src/tools/clippy/clippy_lints/src/octal_escapes.rs:52 check_expr (lane always-running)
OctalEscapes.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::octal_escapes::OctalEscapes::check_expr");
};
