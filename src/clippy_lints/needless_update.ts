// Port of src/tools/clippy/clippy_lints/src/needless_update.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessUpdate } from "./needless_update.lints.gen.ts";
export * from "./needless_update.lints.gen.ts";

declare module "./needless_update.lints.gen.ts" {
  interface NeedlessUpdate extends LateLintPass {}
}

// ---- NeedlessUpdate (late sub-pass; declare_lint_pass! in needless_update.rs) ----

// impl LateLintPass for NeedlessUpdate (needless_update.rs:50)
// stub: src/tools/clippy/clippy_lints/src/needless_update.rs:51 check_expr (lane lint-files)
NeedlessUpdate.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_update::NeedlessUpdate::check_expr");
};
