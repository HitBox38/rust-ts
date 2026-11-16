// Port of src/tools/clippy/clippy_lints/src/option_if_let_else.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { OptionIfLetElse } from "./option_if_let_else.lints.gen.ts";
export * from "./option_if_let_else.lints.gen.ts";

declare module "./option_if_let_else.lints.gen.ts" {
  interface OptionIfLetElse extends LateLintPass {}
}

// ---- OptionIfLetElse (late sub-pass; declare_lint_pass! in option_if_let_else.rs) ----

// impl LateLintPass for OptionIfLetElse (option_if_let_else.rs:392)
// stub: src/tools/clippy/clippy_lints/src/option_if_let_else.rs:393 check_expr (lane lint-files)
OptionIfLetElse.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::option_if_let_else::OptionIfLetElse::check_expr");
};
