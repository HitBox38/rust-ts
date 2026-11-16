// Port of src/tools/clippy/clippy_lints/src/init_numbered_fields.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NumberedFields } from "./init_numbered_fields.lints.gen.ts";
export * from "./init_numbered_fields.lints.gen.ts";

declare module "./init_numbered_fields.lints.gen.ts" {
  interface NumberedFields extends LateLintPass {}
}

// ---- NumberedFields (late sub-pass; declare_lint_pass! in init_numbered_fields.rs) ----

// impl LateLintPass for NumberedFields (init_numbered_fields.rs:43)
// stub: src/tools/clippy/clippy_lints/src/init_numbered_fields.rs:44 check_expr (lane lint-files)
NumberedFields.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::init_numbered_fields::NumberedFields::check_expr");
};
