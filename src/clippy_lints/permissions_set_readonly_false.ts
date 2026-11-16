// Port of src/tools/clippy/clippy_lints/src/permissions_set_readonly_false.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PermissionsSetReadonlyFalse } from "./permissions_set_readonly_false.lints.gen.ts";
export * from "./permissions_set_readonly_false.lints.gen.ts";

declare module "./permissions_set_readonly_false.lints.gen.ts" {
  interface PermissionsSetReadonlyFalse extends LateLintPass {}
}

// ---- PermissionsSetReadonlyFalse (late sub-pass; declare_lint_pass! in permissions_set_readonly_false.rs) ----

// impl LateLintPass for PermissionsSetReadonlyFalse (permissions_set_readonly_false.rs:33)
// stub: src/tools/clippy/clippy_lints/src/permissions_set_readonly_false.rs:34 check_expr (lane lint-files)
PermissionsSetReadonlyFalse.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::permissions_set_readonly_false::PermissionsSetReadonlyFalse::check_expr");
};
