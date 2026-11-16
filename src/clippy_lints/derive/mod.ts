// Port of src/tools/clippy/clippy_lints/src/derive/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import { unported } from "../../std/panic.ts";
import { Derive } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

declare module "./mod.lints.gen.ts" {
  interface Derive extends LateLintPass {}
}

// ---- Derive (late sub-pass; declare_lint_pass! in derive/mod.rs) ----

// impl LateLintPass for Derive (derive/mod.rs:194)
// stub: src/tools/clippy/clippy_lints/src/derive/mod.rs:195 check_item (lane dispatch)
Derive.prototype.check_item = function (cx, item) {
  unported("clippy_lints::derive::Derive::check_item");
};
