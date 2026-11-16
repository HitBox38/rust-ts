// Port of src/tools/clippy/clippy_lints/src/if_not_else.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { IfNotElse } from "./if_not_else.lints.gen.ts";
export * from "./if_not_else.lints.gen.ts";

declare module "./if_not_else.lints.gen.ts" {
  interface IfNotElse extends LateLintPass {}
}

// ---- IfNotElse (late sub-pass; declare_lint_pass! in if_not_else.rs) ----

// impl LateLintPass for IfNotElse (if_not_else.rs:50)
// stub: src/tools/clippy/clippy_lints/src/if_not_else.rs:51 check_expr (lane lint-files)
IfNotElse.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::if_not_else::IfNotElse::check_expr");
};
