// Port of src/tools/clippy/clippy_lints/src/from_str_radix_10.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { FromStrRadix10 } from "./from_str_radix_10.lints.gen.ts";
export * from "./from_str_radix_10.lints.gen.ts";

declare module "./from_str_radix_10.lints.gen.ts" {
  interface FromStrRadix10 extends LateLintPass {}
}

// ---- FromStrRadix10 (late sub-pass; declare_lint_pass! in from_str_radix_10.rs) ----

// impl LateLintPass for FromStrRadix10 (from_str_radix_10.rs:45)
// stub: src/tools/clippy/clippy_lints/src/from_str_radix_10.rs:46 check_expr (lane lint-files)
FromStrRadix10.prototype.check_expr = function (cx, exp) {
  unported("clippy_lints::from_str_radix_10::FromStrRadix10::check_expr");
};
