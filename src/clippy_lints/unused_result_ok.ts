// Port of src/tools/clippy/clippy_lints/src/unused_result_ok.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnusedResultOk } from "./unused_result_ok.lints.gen.ts";
export * from "./unused_result_ok.lints.gen.ts";

declare module "./unused_result_ok.lints.gen.ts" {
  interface UnusedResultOk extends LateLintPass {}
}

// ---- UnusedResultOk (late sub-pass; declare_lint_pass! in unused_result_ok.rs) ----

// impl LateLintPass for UnusedResultOk (unused_result_ok.rs:35)
// stub: src/tools/clippy/clippy_lints/src/unused_result_ok.rs:36 check_stmt (lane lint-files)
UnusedResultOk.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::unused_result_ok::UnusedResultOk::check_stmt");
};
