// Port of src/tools/clippy/clippy_lints/src/useless_concat.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UselessConcat } from "./useless_concat.lints.gen.ts";
export * from "./useless_concat.lints.gen.ts";

declare module "./useless_concat.lints.gen.ts" {
  interface UselessConcat extends LateLintPass {}
}

// ---- UselessConcat (late sub-pass; declare_lint_pass! in useless_concat.rs) ----

// impl LateLintPass for UselessConcat (useless_concat.rs:34)
// stub: src/tools/clippy/clippy_lints/src/useless_concat.rs:35 check_expr (lane lint-files)
UselessConcat.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::useless_concat::UselessConcat::check_expr");
};
