// Port of src/tools/clippy/clippy_lints/src/unused_unit.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyContext } from "../rustc_lint/context.ts";
import type { EarlyLintPass, LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass } from "../rustc_lint_defs/lib.ts";
import { LateContext } from "../rustc_lint/context.ts";
import { unported } from "../std/panic.ts";
import { UnusedUnit } from "./unused_unit.lints.gen.ts";
export * from "./unused_unit.lints.gen.ts";

declare module "./unused_unit.lints.gen.ts" {
  interface UnusedUnit extends UnusedUnit_dual {}
}

// ---- UnusedUnit (early + late sub-passes; declare_lint_pass! in unused_unit.rs) ----
/** PORT: `UnusedUnit` implements both `EarlyLintPass` and `LateLintPass`; a TS class has one method per name, so each `check_*`
 * either trait has is one method that dispatches on the context (`LateContext` or `EarlyContext`), the other trait's
 * provided default (an empty body) where only one trait implements it. */
interface UnusedUnit_dual extends LintPass {
  check_fn(cx: EarlyContext | LateContext, ...args: unknown[]): void;
  check_expr(cx: EarlyContext | LateContext, ...args: unknown[]): void;
  check_poly_trait_ref(cx: EarlyContext | LateContext, ...args: unknown[]): void;
  check_block(cx: EarlyContext | LateContext, ...args: unknown[]): void;
}
// impl LateLintPass for UnusedUnit (unused_unit.rs:43)
UnusedUnit.prototype.check_fn = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // stub: src/tools/clippy/clippy_lints/src/unused_unit.rs:44 check_fn (lane always-running)
    unported("clippy_lints::unused_unit::UnusedUnit::check_fn (LateLintPass)");
  } else {
    // `EarlyLintPass::check_fn`: the provided default (empty)
  }
};
// impl LateLintPass for UnusedUnit (unused_unit.rs:43)
UnusedUnit.prototype.check_expr = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // stub: src/tools/clippy/clippy_lints/src/unused_unit.rs:84 check_expr (lane always-running)
    unported("clippy_lints::unused_unit::UnusedUnit::check_expr (LateLintPass)");
  } else {
    // `EarlyLintPass::check_expr`: the provided default (empty)
  }
};
// impl LateLintPass for UnusedUnit (unused_unit.rs:43)
UnusedUnit.prototype.check_poly_trait_ref = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // stub: src/tools/clippy/clippy_lints/src/unused_unit.rs:101 check_poly_trait_ref (lane always-running)
    unported("clippy_lints::unused_unit::UnusedUnit::check_poly_trait_ref (LateLintPass)");
  } else {
    // `EarlyLintPass::check_poly_trait_ref`: the provided default (empty)
  }
};
// impl EarlyLintPass for UnusedUnit (unused_unit.rs:119)
UnusedUnit.prototype.check_block = function (cx: EarlyContext | LateContext): void {
  if (cx instanceof LateContext) {
    // `LateLintPass::check_block`: the provided default (empty)
  } else {
    // stub: src/tools/clippy/clippy_lints/src/unused_unit.rs:122 check_block (lane always-running)
    unported("clippy_lints::unused_unit::UnusedUnit::check_block (EarlyLintPass)");
  }
};
