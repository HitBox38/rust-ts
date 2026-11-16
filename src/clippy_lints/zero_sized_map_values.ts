// Port of src/tools/clippy/clippy_lints/src/zero_sized_map_values.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ZeroSizedMapValues } from "./zero_sized_map_values.lints.gen.ts";
export * from "./zero_sized_map_values.lints.gen.ts";

declare module "./zero_sized_map_values.lints.gen.ts" {
  interface ZeroSizedMapValues extends LateLintPass {}
}

// ---- ZeroSizedMapValues (late sub-pass; declare_lint_pass! in zero_sized_map_values.rs) ----

// impl LateLintPass for ZeroSizedMapValues (zero_sized_map_values.rs:45)
// stub: src/tools/clippy/clippy_lints/src/zero_sized_map_values.rs:46 check_ty (lane lint-files)
ZeroSizedMapValues.prototype.check_ty = function (cx, hir_ty) {
  unported("clippy_lints::zero_sized_map_values::ZeroSizedMapValues::check_ty");
};
