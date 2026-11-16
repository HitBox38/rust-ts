// Port of src/tools/clippy/clippy_lints/src/unnecessary_self_imports.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnnecessarySelfImports } from "./unnecessary_self_imports.lints.gen.ts";
export * from "./unnecessary_self_imports.lints.gen.ts";

declare module "./unnecessary_self_imports.lints.gen.ts" {
  interface UnnecessarySelfImports extends EarlyLintPass {}
}

// ---- UnnecessarySelfImports (early sub-pass; declare_lint_pass! in unnecessary_self_imports.rs) ----

// impl EarlyLintPass for UnnecessarySelfImports (unnecessary_self_imports.rs:35)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_self_imports.rs:36 check_item (lane always-running)
UnnecessarySelfImports.prototype.check_item = function (cx, item) {
  unported("clippy_lints::unnecessary_self_imports::UnnecessarySelfImports::check_item");
};
