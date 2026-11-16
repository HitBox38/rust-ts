// Port of src/tools/clippy/clippy_lints/src/ineffective_open_options.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { IneffectiveOpenOptions } from "./ineffective_open_options.lints.gen.ts";
export * from "./ineffective_open_options.lints.gen.ts";

declare module "./ineffective_open_options.lints.gen.ts" {
  interface IneffectiveOpenOptions extends LateLintPass {}
}

// ---- IneffectiveOpenOptions (late sub-pass; declare_lint_pass! in ineffective_open_options.rs) ----

// impl LateLintPass for IneffectiveOpenOptions (ineffective_open_options.rs:44)
// stub: src/tools/clippy/clippy_lints/src/ineffective_open_options.rs:45 check_expr (lane lint-files)
IneffectiveOpenOptions.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::ineffective_open_options::IneffectiveOpenOptions::check_expr");
};
