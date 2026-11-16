// Port of src/tools/clippy/clippy_lints/src/enum_clike.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnportableVariant } from "./enum_clike.lints.gen.ts";
export * from "./enum_clike.lints.gen.ts";

declare module "./enum_clike.lints.gen.ts" {
  interface UnportableVariant extends LateLintPass {}
}

// ---- UnportableVariant (late sub-pass; declare_lint_pass! in enum_clike.rs) ----

// impl LateLintPass for UnportableVariant (enum_clike.rs:34)
// stub: src/tools/clippy/clippy_lints/src/enum_clike.rs:36 check_item (lane lint-files)
UnportableVariant.prototype.check_item = function (cx, item) {
  unported("clippy_lints::enum_clike::UnportableVariant::check_item");
};
