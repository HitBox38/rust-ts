// Port of src/tools/clippy/clippy_lints/src/comparison_chain.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ComparisonChain } from "./comparison_chain.lints.gen.ts";
export * from "./comparison_chain.lints.gen.ts";

declare module "./comparison_chain.lints.gen.ts" {
  interface ComparisonChain extends LateLintPass {}
}

// ---- ComparisonChain (late sub-pass; declare_lint_pass! in comparison_chain.rs) ----

// impl LateLintPass for ComparisonChain (comparison_chain.rs:57)
// stub: src/tools/clippy/clippy_lints/src/comparison_chain.rs:58 check_expr (lane lint-files)
ComparisonChain.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::comparison_chain::ComparisonChain::check_expr");
};
