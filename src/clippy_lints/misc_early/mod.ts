// Port of src/tools/clippy/clippy_lints/src/misc_early/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../../rustc_lint/passes.ts";
import { unported } from "../../std/panic.ts";
import { MiscEarlyLints } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

declare module "./mod.lints.gen.ts" {
  interface MiscEarlyLints extends EarlyLintPass {}
}

// ---- MiscEarlyLints (early sub-pass; declare_lint_pass! in misc_early/mod.rs) ----

// impl EarlyLintPass for MiscEarlyLints (misc_early/mod.rs:310)
// stub: src/tools/clippy/clippy_lints/src/misc_early/mod.rs:311 check_generics (lane dispatch)
MiscEarlyLints.prototype.check_generics = function (cx, generics) {
  unported("clippy_lints::misc_early::MiscEarlyLints::check_generics");
};
// stub: src/tools/clippy/clippy_lints/src/misc_early/mod.rs:317 check_pat (lane dispatch)
MiscEarlyLints.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::misc_early::MiscEarlyLints::check_pat");
};
// stub: src/tools/clippy/clippy_lints/src/misc_early/mod.rs:324 check_expr (lane dispatch)
MiscEarlyLints.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::misc_early::MiscEarlyLints::check_expr");
};
