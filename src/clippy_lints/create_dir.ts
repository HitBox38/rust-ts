// Port of src/tools/clippy/clippy_lints/src/create_dir.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { CreateDir } from "./create_dir.lints.gen.ts";
export * from "./create_dir.lints.gen.ts";

declare module "./create_dir.lints.gen.ts" {
  interface CreateDir extends LateLintPass {}
}

// ---- CreateDir (late sub-pass; declare_lint_pass! in create_dir.rs) ----

// impl LateLintPass for CreateDir (create_dir.rs:33)
// stub: src/tools/clippy/clippy_lints/src/create_dir.rs:34 check_expr (lane lint-files)
CreateDir.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::create_dir::CreateDir::check_expr");
};
