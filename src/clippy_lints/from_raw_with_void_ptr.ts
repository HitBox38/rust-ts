// Port of src/tools/clippy/clippy_lints/src/from_raw_with_void_ptr.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { FromRawWithVoidPtr } from "./from_raw_with_void_ptr.lints.gen.ts";
export * from "./from_raw_with_void_ptr.lints.gen.ts";

declare module "./from_raw_with_void_ptr.lints.gen.ts" {
  interface FromRawWithVoidPtr extends LateLintPass {}
}

// ---- FromRawWithVoidPtr (late sub-pass; declare_lint_pass! in from_raw_with_void_ptr.rs) ----

// impl LateLintPass for FromRawWithVoidPtr (from_raw_with_void_ptr.rs:40)
// stub: src/tools/clippy/clippy_lints/src/from_raw_with_void_ptr.rs:41 check_expr (lane lint-files)
FromRawWithVoidPtr.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::from_raw_with_void_ptr::FromRawWithVoidPtr::check_expr");
};
