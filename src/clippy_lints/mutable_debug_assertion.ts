// Port of src/tools/clippy/clippy_lints/src/mutable_debug_assertion.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { DebugAssertWithMutCall } from "./mutable_debug_assertion.lints.gen.ts";
export * from "./mutable_debug_assertion.lints.gen.ts";

declare module "./mutable_debug_assertion.lints.gen.ts" {
  interface DebugAssertWithMutCall extends LateLintPass {}
}

// ---- DebugAssertWithMutCall (late sub-pass; declare_lint_pass! in mutable_debug_assertion.rs) ----

// impl LateLintPass for DebugAssertWithMutCall (mutable_debug_assertion.rs:40)
// stub: src/tools/clippy/clippy_lints/src/mutable_debug_assertion.rs:41 check_expr (lane lint-files)
DebugAssertWithMutCall.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::mutable_debug_assertion::DebugAssertWithMutCall::check_expr");
};
