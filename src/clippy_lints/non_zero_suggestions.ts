// Port of src/tools/clippy/clippy_lints/src/non_zero_suggestions.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NonZeroSuggestions } from "./non_zero_suggestions.lints.gen.ts";
export * from "./non_zero_suggestions.lints.gen.ts";

declare module "./non_zero_suggestions.lints.gen.ts" {
  interface NonZeroSuggestions extends LateLintPass {}
}

// ---- NonZeroSuggestions (late sub-pass; declare_lint_pass! in non_zero_suggestions.rs) ----

// impl LateLintPass for NonZeroSuggestions (non_zero_suggestions.rs:49)
// stub: src/tools/clippy/clippy_lints/src/non_zero_suggestions.rs:50 check_expr (lane lint-files)
NonZeroSuggestions.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::non_zero_suggestions::NonZeroSuggestions::check_expr");
};
