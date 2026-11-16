// Port of src/tools/clippy/clippy_lints/src/coerce_container_to_any.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { CoerceContainerToAny } from "./coerce_container_to_any.lints.gen.ts";
export * from "./coerce_container_to_any.lints.gen.ts";

declare module "./coerce_container_to_any.lints.gen.ts" {
  interface CoerceContainerToAny extends LateLintPass {}
}

// ---- CoerceContainerToAny (late sub-pass; declare_lint_pass! in coerce_container_to_any.rs) ----

// impl LateLintPass for CoerceContainerToAny (coerce_container_to_any.rs:51)
// stub: src/tools/clippy/clippy_lints/src/coerce_container_to_any.rs:52 check_expr (lane lint-files)
CoerceContainerToAny.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::coerce_container_to_any::CoerceContainerToAny::check_expr");
};
