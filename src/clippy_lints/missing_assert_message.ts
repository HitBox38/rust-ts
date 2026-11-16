// Port of src/tools/clippy/clippy_lints/src/missing_assert_message.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { MissingAssertMessage } from "./missing_assert_message.lints.gen.ts";
export * from "./missing_assert_message.lints.gen.ts";

declare module "./missing_assert_message.lints.gen.ts" {
  interface MissingAssertMessage extends LateLintPass {}
}

// ---- MissingAssertMessage (late sub-pass; declare_lint_pass! in missing_assert_message.rs) ----

// impl LateLintPass for MissingAssertMessage (missing_assert_message.rs:50)
// stub: src/tools/clippy/clippy_lints/src/missing_assert_message.rs:51 check_expr (lane lint-files)
MissingAssertMessage.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::missing_assert_message::MissingAssertMessage::check_expr");
};
