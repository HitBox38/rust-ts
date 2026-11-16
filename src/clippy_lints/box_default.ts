// Port of src/tools/clippy/clippy_lints/src/box_default.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { BoxDefault } from "./box_default.lints.gen.ts";
export * from "./box_default.lints.gen.ts";

declare module "./box_default.lints.gen.ts" {
  interface BoxDefault extends LateLintPass {}
}

// ---- BoxDefault (late sub-pass; declare_lint_pass! in box_default.rs) ----

// impl LateLintPass for BoxDefault (box_default.rs:38)
// stub: src/tools/clippy/clippy_lints/src/box_default.rs:39 check_expr (lane lint-files)
BoxDefault.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::box_default::BoxDefault::check_expr");
};
