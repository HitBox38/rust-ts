// Port of src/tools/clippy/clippy_lints/src/inherent_to_string.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { InherentToString } from "./inherent_to_string.lints.gen.ts";
export * from "./inherent_to_string.lints.gen.ts";

declare module "./inherent_to_string.lints.gen.ts" {
  interface InherentToString extends LateLintPass {}
}

// ---- InherentToString (late sub-pass; declare_lint_pass! in inherent_to_string.rs) ----

// impl LateLintPass for InherentToString (inherent_to_string.rs:96)
// stub: src/tools/clippy/clippy_lints/src/inherent_to_string.rs:97 check_impl_item (lane lint-files)
InherentToString.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::inherent_to_string::InherentToString::check_impl_item");
};
