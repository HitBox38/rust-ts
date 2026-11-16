// Port of src/tools/clippy/clippy_lints/src/ptr/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import { unported } from "../../std/panic.ts";
import { Ptr } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

declare module "./mod.lints.gen.ts" {
  interface Ptr extends LateLintPass {}
}

// ---- Ptr (late sub-pass; declare_lint_pass! in ptr/mod.rs) ----

// impl LateLintPass for Ptr (ptr/mod.rs:139)
// stub: src/tools/clippy/clippy_lints/src/ptr/mod.rs:140 check_trait_item (lane dispatch)
Ptr.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::ptr::Ptr::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/ptr/mod.rs:152 check_body (lane dispatch)
Ptr.prototype.check_body = function (cx, body) {
  unported("clippy_lints::ptr::Ptr::check_body");
};
// stub: src/tools/clippy/clippy_lints/src/ptr/mod.rs:188 check_expr (lane dispatch)
Ptr.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::ptr::Ptr::check_expr");
};
