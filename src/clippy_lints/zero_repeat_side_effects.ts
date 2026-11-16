// Port of src/tools/clippy/clippy_lints/src/zero_repeat_side_effects.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ZeroRepeatSideEffects } from "./zero_repeat_side_effects.lints.gen.ts";
export * from "./zero_repeat_side_effects.lints.gen.ts";

declare module "./zero_repeat_side_effects.lints.gen.ts" {
  interface ZeroRepeatSideEffects extends LateLintPass {}
}

// ---- ZeroRepeatSideEffects (late sub-pass; declare_lint_pass! in zero_repeat_side_effects.rs) ----

// impl LateLintPass for ZeroRepeatSideEffects (zero_repeat_side_effects.rs:46)
// stub: src/tools/clippy/clippy_lints/src/zero_repeat_side_effects.rs:47 check_expr (lane lint-files)
ZeroRepeatSideEffects.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::zero_repeat_side_effects::ZeroRepeatSideEffects::check_expr");
};
