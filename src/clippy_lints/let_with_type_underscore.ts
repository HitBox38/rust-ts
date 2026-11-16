// Port of src/tools/clippy/clippy_lints/src/let_with_type_underscore.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnderscoreTyped } from "./let_with_type_underscore.lints.gen.ts";
export * from "./let_with_type_underscore.lints.gen.ts";

declare module "./let_with_type_underscore.lints.gen.ts" {
  interface UnderscoreTyped extends EarlyLintPass {}
}

// ---- UnderscoreTyped (early sub-pass; declare_lint_pass! in let_with_type_underscore.rs) ----

// impl EarlyLintPass for UnderscoreTyped (let_with_type_underscore.rs:29)
// stub: src/tools/clippy/clippy_lints/src/let_with_type_underscore.rs:30 check_local (lane always-running)
UnderscoreTyped.prototype.check_local = function (cx, local) {
  unported("clippy_lints::let_with_type_underscore::UnderscoreTyped::check_local");
};
