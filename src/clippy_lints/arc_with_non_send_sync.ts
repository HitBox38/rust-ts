// Port of src/tools/clippy/clippy_lints/src/arc_with_non_send_sync.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ArcWithNonSendSync } from "./arc_with_non_send_sync.lints.gen.ts";
export * from "./arc_with_non_send_sync.lints.gen.ts";

declare module "./arc_with_non_send_sync.lints.gen.ts" {
  interface ArcWithNonSendSync extends LateLintPass {}
}

// ---- ArcWithNonSendSync (late sub-pass; declare_lint_pass! in arc_with_non_send_sync.rs) ----

// impl LateLintPass for ArcWithNonSendSync (arc_with_non_send_sync.rs:44)
// stub: src/tools/clippy/clippy_lints/src/arc_with_non_send_sync.rs:45 check_expr (lane lint-files)
ArcWithNonSendSync.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::arc_with_non_send_sync::ArcWithNonSendSync::check_expr");
};
