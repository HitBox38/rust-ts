// Port of src/tools/clippy/clippy_lints/src/implied_bounds_in_impls.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ImpliedBoundsInImpls } from "./implied_bounds_in_impls.lints.gen.ts";
export * from "./implied_bounds_in_impls.lints.gen.ts";

declare module "./implied_bounds_in_impls.lints.gen.ts" {
  interface ImpliedBoundsInImpls extends LateLintPass {}
}

// ---- ImpliedBoundsInImpls (late sub-pass; declare_lint_pass! in implied_bounds_in_impls.rs) ----

// impl LateLintPass for ImpliedBoundsInImpls (implied_bounds_in_impls.rs:330)
// stub: src/tools/clippy/clippy_lints/src/implied_bounds_in_impls.rs:331 check_generics (lane lint-files)
ImpliedBoundsInImpls.prototype.check_generics = function (cx, generics) {
  unported("clippy_lints::implied_bounds_in_impls::ImpliedBoundsInImpls::check_generics");
};
// stub: src/tools/clippy/clippy_lints/src/implied_bounds_in_impls.rs:344 check_ty (lane lint-files)
ImpliedBoundsInImpls.prototype.check_ty = function (cx, ty) {
  unported("clippy_lints::implied_bounds_in_impls::ImpliedBoundsInImpls::check_ty");
};
