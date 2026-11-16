// Port of src/tools/clippy/clippy_lints/src/let_underscore.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { LetUnderscore } from "./let_underscore.lints.gen.ts";
export * from "./let_underscore.lints.gen.ts";

declare module "./let_underscore.lints.gen.ts" {
  interface LetUnderscore extends LateLintPass {}
}

// ---- LetUnderscore (late sub-pass; declare_lint_pass! in let_underscore.rs) ----

// impl LateLintPass for LetUnderscore (let_underscore.rs:136)
// stub: src/tools/clippy/clippy_lints/src/let_underscore.rs:137 check_local (lane lint-files)
LetUnderscore.prototype.check_local = function (cx, local) {
  unported("clippy_lints::let_underscore::LetUnderscore::check_local");
};
