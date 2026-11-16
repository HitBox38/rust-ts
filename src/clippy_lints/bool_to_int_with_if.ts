// Port of src/tools/clippy/clippy_lints/src/bool_to_int_with_if.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { BoolToIntWithIf } from "./bool_to_int_with_if.lints.gen.ts";
export * from "./bool_to_int_with_if.lints.gen.ts";

declare module "./bool_to_int_with_if.lints.gen.ts" {
  interface BoolToIntWithIf extends LateLintPass {}
}

// ---- BoolToIntWithIf (late sub-pass; declare_lint_pass! in bool_to_int_with_if.rs) ----

// impl LateLintPass for BoolToIntWithIf (bool_to_int_with_if.rs:47)
// stub: src/tools/clippy/clippy_lints/src/bool_to_int_with_if.rs:48 check_expr (lane lint-files)
BoolToIntWithIf.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::bool_to_int_with_if::BoolToIntWithIf::check_expr");
};
