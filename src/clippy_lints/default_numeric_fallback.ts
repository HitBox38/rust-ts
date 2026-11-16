// Port of src/tools/clippy/clippy_lints/src/default_numeric_fallback.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { DefaultNumericFallback } from "./default_numeric_fallback.lints.gen.ts";
export * from "./default_numeric_fallback.lints.gen.ts";

declare module "./default_numeric_fallback.lints.gen.ts" {
  interface DefaultNumericFallback extends LateLintPass {}
}

// ---- DefaultNumericFallback (late sub-pass; declare_lint_pass! in default_numeric_fallback.rs) ----

// impl LateLintPass for DefaultNumericFallback (default_numeric_fallback.rs:52)
// stub: src/tools/clippy/clippy_lints/src/default_numeric_fallback.rs:53 check_body (lane lint-files)
DefaultNumericFallback.prototype.check_body = function (cx, body) {
  unported("clippy_lints::default_numeric_fallback::DefaultNumericFallback::check_body");
};
