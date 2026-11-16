// Port of src/tools/clippy/clippy_lints/src/needless_parens_on_range_literals.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessParensOnRangeLiterals } from "./needless_parens_on_range_literals.lints.gen.ts";
export * from "./needless_parens_on_range_literals.lints.gen.ts";

declare module "./needless_parens_on_range_literals.lints.gen.ts" {
  interface NeedlessParensOnRangeLiterals extends LateLintPass {}
}

// ---- NeedlessParensOnRangeLiterals (late sub-pass; declare_lint_pass! in needless_parens_on_range_literals.rs) ----

// impl LateLintPass for NeedlessParensOnRangeLiterals (needless_parens_on_range_literals.rs:76)
// stub: src/tools/clippy/clippy_lints/src/needless_parens_on_range_literals.rs:77 check_expr (lane lint-files)
NeedlessParensOnRangeLiterals.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_parens_on_range_literals::NeedlessParensOnRangeLiterals::check_expr");
};
