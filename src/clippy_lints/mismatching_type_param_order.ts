// Port of src/tools/clippy/clippy_lints/src/mismatching_type_param_order.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { TypeParamMismatch } from "./mismatching_type_param_order.lints.gen.ts";
export * from "./mismatching_type_param_order.lints.gen.ts";

declare module "./mismatching_type_param_order.lints.gen.ts" {
  interface TypeParamMismatch extends LateLintPass {}
}

// ---- TypeParamMismatch (late sub-pass; declare_lint_pass! in mismatching_type_param_order.rs) ----

// impl LateLintPass for TypeParamMismatch (mismatching_type_param_order.rs:50)
// stub: src/tools/clippy/clippy_lints/src/mismatching_type_param_order.rs:51 check_item (lane lint-files)
TypeParamMismatch.prototype.check_item = function (cx, item) {
  unported("clippy_lints::mismatching_type_param_order::TypeParamMismatch::check_item");
};
