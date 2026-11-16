// Port of src/tools/clippy/clippy_lints/src/default_instead_of_iter_empty.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { DefaultIterEmpty } from "./default_instead_of_iter_empty.lints.gen.ts";
export * from "./default_instead_of_iter_empty.lints.gen.ts";

declare module "./default_instead_of_iter_empty.lints.gen.ts" {
  interface DefaultIterEmpty extends LateLintPass {}
}

// ---- DefaultIterEmpty (late sub-pass; declare_lint_pass! in default_instead_of_iter_empty.rs) ----

// impl LateLintPass for DefaultIterEmpty (default_instead_of_iter_empty.rs:33)
// stub: src/tools/clippy/clippy_lints/src/default_instead_of_iter_empty.rs:34 check_expr (lane lint-files)
DefaultIterEmpty.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::default_instead_of_iter_empty::DefaultIterEmpty::check_expr");
};
