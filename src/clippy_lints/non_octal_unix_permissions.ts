// Port of src/tools/clippy/clippy_lints/src/non_octal_unix_permissions.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NonOctalUnixPermissions } from "./non_octal_unix_permissions.lints.gen.ts";
export * from "./non_octal_unix_permissions.lints.gen.ts";

declare module "./non_octal_unix_permissions.lints.gen.ts" {
  interface NonOctalUnixPermissions extends LateLintPass {}
}

// ---- NonOctalUnixPermissions (late sub-pass; declare_lint_pass! in non_octal_unix_permissions.rs) ----

// impl LateLintPass for NonOctalUnixPermissions (non_octal_unix_permissions.rs:40)
// stub: src/tools/clippy/clippy_lints/src/non_octal_unix_permissions.rs:41 check_expr (lane lint-files)
NonOctalUnixPermissions.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::non_octal_unix_permissions::NonOctalUnixPermissions::check_expr");
};
