// Port of src/tools/clippy/clippy_lints/src/crate_in_macro_def.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { CrateInMacroDef } from "./crate_in_macro_def.lints.gen.ts";
export * from "./crate_in_macro_def.lints.gen.ts";

declare module "./crate_in_macro_def.lints.gen.ts" {
  interface CrateInMacroDef extends EarlyLintPass {}
}

// ---- CrateInMacroDef (early sub-pass; declare_lint_pass! in crate_in_macro_def.rs) ----

// impl EarlyLintPass for CrateInMacroDef (crate_in_macro_def.rs:54)
// stub: src/tools/clippy/clippy_lints/src/crate_in_macro_def.rs:55 check_item (lane always-running)
CrateInMacroDef.prototype.check_item = function (cx, item) {
  unported("clippy_lints::crate_in_macro_def::CrateInMacroDef::check_item");
};
