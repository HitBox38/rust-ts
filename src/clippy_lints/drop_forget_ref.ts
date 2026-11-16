// Port of src/tools/clippy/clippy_lints/src/drop_forget_ref.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { DropForgetRef } from "./drop_forget_ref.lints.gen.ts";
export * from "./drop_forget_ref.lints.gen.ts";

declare module "./drop_forget_ref.lints.gen.ts" {
  interface DropForgetRef extends LateLintPass {}
}

// ---- DropForgetRef (late sub-pass; declare_lint_pass! in drop_forget_ref.rs) ----

// impl LateLintPass for DropForgetRef (drop_forget_ref.rs:80)
// stub: src/tools/clippy/clippy_lints/src/drop_forget_ref.rs:81 check_expr (lane lint-files)
DropForgetRef.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::drop_forget_ref::DropForgetRef::check_expr");
};
