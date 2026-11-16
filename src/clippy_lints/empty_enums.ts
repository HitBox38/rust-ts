// Port of src/tools/clippy/clippy_lints/src/empty_enums.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { EmptyEnums } from "./empty_enums.lints.gen.ts";
export * from "./empty_enums.lints.gen.ts";

declare module "./empty_enums.lints.gen.ts" {
  interface EmptyEnums extends LateLintPass {}
}

// ---- EmptyEnums (late sub-pass; declare_lint_pass! in empty_enums.rs) ----

// impl LateLintPass for EmptyEnums (empty_enums.rs:54)
// stub: src/tools/clippy/clippy_lints/src/empty_enums.rs:55 check_item (lane lint-files)
EmptyEnums.prototype.check_item = function (cx, item) {
  unported("clippy_lints::empty_enums::EmptyEnums::check_item");
};
