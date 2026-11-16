// Port of src/tools/clippy/clippy_lints/src/partialeq_ne_impl.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PartialEqNeImpl } from "./partialeq_ne_impl.lints.gen.ts";
export * from "./partialeq_ne_impl.lints.gen.ts";

declare module "./partialeq_ne_impl.lints.gen.ts" {
  interface PartialEqNeImpl extends LateLintPass {}
}

// ---- PartialEqNeImpl (late sub-pass; declare_lint_pass! in partialeq_ne_impl.rs) ----

// impl LateLintPass for PartialEqNeImpl (partialeq_ne_impl.rs:33)
// stub: src/tools/clippy/clippy_lints/src/partialeq_ne_impl.rs:34 check_item (lane lint-files)
PartialEqNeImpl.prototype.check_item = function (cx, item) {
  unported("clippy_lints::partialeq_ne_impl::PartialEqNeImpl::check_item");
};
