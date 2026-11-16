// Port of src/tools/clippy/clippy_lints/src/uninhabited_references.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UninhabitedReferences } from "./uninhabited_references.lints.gen.ts";
export * from "./uninhabited_references.lints.gen.ts";

declare module "./uninhabited_references.lints.gen.ts" {
  interface UninhabitedReferences extends LateLintPass {}
}

// ---- UninhabitedReferences (late sub-pass; declare_lint_pass! in uninhabited_references.rs) ----

// impl LateLintPass for UninhabitedReferences (uninhabited_references.rs:39)
// stub: src/tools/clippy/clippy_lints/src/uninhabited_references.rs:40 check_expr (lane lint-files)
UninhabitedReferences.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::uninhabited_references::UninhabitedReferences::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/uninhabited_references.rs:57 check_fn (lane lint-files)
UninhabitedReferences.prototype.check_fn = function (cx, kind, fndecl, _0, span, def_id) {
  unported("clippy_lints::uninhabited_references::UninhabitedReferences::check_fn");
};
