// Port of src/tools/clippy/clippy_lints/src/manual_range_patterns.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ManualRangePatterns } from "./manual_range_patterns.lints.gen.ts";
export * from "./manual_range_patterns.lints.gen.ts";

declare module "./manual_range_patterns.lints.gen.ts" {
  interface ManualRangePatterns extends LateLintPass {}
}

// ---- ManualRangePatterns (late sub-pass; declare_lint_pass! in manual_range_patterns.rs) ----

// impl LateLintPass for ManualRangePatterns (manual_range_patterns.rs:75)
// stub: src/tools/clippy/clippy_lints/src/manual_range_patterns.rs:76 check_pat (lane lint-files)
ManualRangePatterns.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::manual_range_patterns::ManualRangePatterns::check_pat");
};
