// Port of src/tools/clippy/clippy_lints/src/assertions_on_result_states.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { AssertionsOnResultStates } from "./assertions_on_result_states.lints.gen.ts";
export * from "./assertions_on_result_states.lints.gen.ts";

declare module "./assertions_on_result_states.lints.gen.ts" {
  interface AssertionsOnResultStates extends LateLintPass {}
}

// ---- AssertionsOnResultStates (late sub-pass; declare_lint_pass! in assertions_on_result_states.rs) ----

// impl LateLintPass for AssertionsOnResultStates (assertions_on_result_states.rs:49)
// stub: src/tools/clippy/clippy_lints/src/assertions_on_result_states.rs:50 check_expr (lane lint-files)
AssertionsOnResultStates.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::assertions_on_result_states::AssertionsOnResultStates::check_expr");
};
