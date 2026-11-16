// Port of src/tools/clippy/clippy_lints/src/missing_fields_in_debug.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { MissingFieldsInDebug } from "./missing_fields_in_debug.lints.gen.ts";
export * from "./missing_fields_in_debug.lints.gen.ts";

declare module "./missing_fields_in_debug.lints.gen.ts" {
  interface MissingFieldsInDebug extends LateLintPass {}
}

// ---- MissingFieldsInDebug (late sub-pass; declare_lint_pass! in missing_fields_in_debug.rs) ----

// impl LateLintPass for MissingFieldsInDebug (missing_fields_in_debug.rs:204)
// stub: src/tools/clippy/clippy_lints/src/missing_fields_in_debug.rs:205 check_item (lane lint-files)
MissingFieldsInDebug.prototype.check_item = function (cx, item) {
  unported("clippy_lints::missing_fields_in_debug::MissingFieldsInDebug::check_item");
};
