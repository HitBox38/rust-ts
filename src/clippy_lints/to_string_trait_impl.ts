// Port of src/tools/clippy/clippy_lints/src/to_string_trait_impl.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ToStringTraitImpl } from "./to_string_trait_impl.lints.gen.ts";
export * from "./to_string_trait_impl.lints.gen.ts";

declare module "./to_string_trait_impl.lints.gen.ts" {
  interface ToStringTraitImpl extends LateLintPass {}
}

// ---- ToStringTraitImpl (late sub-pass; declare_lint_pass! in to_string_trait_impl.rs) ----

// impl LateLintPass for ToStringTraitImpl (to_string_trait_impl.rs:47)
// stub: src/tools/clippy/clippy_lints/src/to_string_trait_impl.rs:48 check_item (lane lint-files)
ToStringTraitImpl.prototype.check_item = function (cx, it) {
  unported("clippy_lints::to_string_trait_impl::ToStringTraitImpl::check_item");
};
