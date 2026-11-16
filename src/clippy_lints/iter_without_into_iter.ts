// Port of src/tools/clippy/clippy_lints/src/iter_without_into_iter.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { IterWithoutIntoIter } from "./iter_without_into_iter.lints.gen.ts";
export * from "./iter_without_into_iter.lints.gen.ts";

declare module "./iter_without_into_iter.lints.gen.ts" {
  interface IterWithoutIntoIter extends LateLintPass {}
}

// ---- IterWithoutIntoIter (late sub-pass; declare_lint_pass! in iter_without_into_iter.rs) ----

// impl LateLintPass for IterWithoutIntoIter (iter_without_into_iter.rs:126)
// stub: src/tools/clippy/clippy_lints/src/iter_without_into_iter.rs:127 check_item (lane lint-files)
IterWithoutIntoIter.prototype.check_item = function (cx, item) {
  unported("clippy_lints::iter_without_into_iter::IterWithoutIntoIter::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/iter_without_into_iter.rs:199 check_impl_item (lane lint-files)
IterWithoutIntoIter.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::iter_without_into_iter::IterWithoutIntoIter::check_impl_item");
};
