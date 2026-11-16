// Port of src/tools/clippy/clippy_lints/src/fallible_impl_from.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { FallibleImplFrom } from "./fallible_impl_from.lints.gen.ts";
export * from "./fallible_impl_from.lints.gen.ts";

declare module "./fallible_impl_from.lints.gen.ts" {
  interface FallibleImplFrom extends LateLintPass {}
}

// ---- FallibleImplFrom (late sub-pass; declare_lint_pass! in fallible_impl_from.rs) ----

// impl LateLintPass for FallibleImplFrom (fallible_impl_from.rs:51)
// stub: src/tools/clippy/clippy_lints/src/fallible_impl_from.rs:52 check_item (lane lint-files)
FallibleImplFrom.prototype.check_item = function (cx, item) {
  unported("clippy_lints::fallible_impl_from::FallibleImplFrom::check_item");
};
