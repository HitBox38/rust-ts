// Port of src/tools/clippy/clippy_lints/src/borrow_deref_ref.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { BorrowDerefRef } from "./borrow_deref_ref.lints.gen.ts";
export * from "./borrow_deref_ref.lints.gen.ts";

declare module "./borrow_deref_ref.lints.gen.ts" {
  interface BorrowDerefRef extends LateLintPass {}
}

// ---- BorrowDerefRef (late sub-pass; declare_lint_pass! in borrow_deref_ref.rs) ----

// impl LateLintPass for BorrowDerefRef (borrow_deref_ref.rs:52)
// stub: src/tools/clippy/clippy_lints/src/borrow_deref_ref.rs:53 check_expr (lane lint-files)
BorrowDerefRef.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::borrow_deref_ref::BorrowDerefRef::check_expr");
};
