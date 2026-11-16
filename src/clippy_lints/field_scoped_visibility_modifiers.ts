// Port of src/tools/clippy/clippy_lints/src/field_scoped_visibility_modifiers.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { FieldScopedVisibilityModifiers } from "./field_scoped_visibility_modifiers.lints.gen.ts";
export * from "./field_scoped_visibility_modifiers.lints.gen.ts";

declare module "./field_scoped_visibility_modifiers.lints.gen.ts" {
  interface FieldScopedVisibilityModifiers extends EarlyLintPass {}
}

// ---- FieldScopedVisibilityModifiers (early sub-pass; declare_lint_pass! in field_scoped_visibility_modifiers.rs) ----

// impl EarlyLintPass for FieldScopedVisibilityModifiers (field_scoped_visibility_modifiers.rs:53)
// stub: src/tools/clippy/clippy_lints/src/field_scoped_visibility_modifiers.rs:54 check_item (lane always-running)
FieldScopedVisibilityModifiers.prototype.check_item = function (cx, item) {
  unported("clippy_lints::field_scoped_visibility_modifiers::FieldScopedVisibilityModifiers::check_item");
};
