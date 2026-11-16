// Port of src/tools/clippy/clippy_lints/src/as_conversions.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { AsConversions } from "./as_conversions.lints.gen.ts";
export * from "./as_conversions.lints.gen.ts";

declare module "./as_conversions.lints.gen.ts" {
  interface AsConversions extends LateLintPass {}
}

// ---- AsConversions (late sub-pass; declare_lint_pass! in as_conversions.rs) ----

// impl LateLintPass for AsConversions (as_conversions.rs:59)
// stub: src/tools/clippy/clippy_lints/src/as_conversions.rs:60 check_expr (lane lint-files)
AsConversions.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::as_conversions::AsConversions::check_expr");
};
