// Port of src/tools/clippy/clippy_lints/src/len_without_is_empty.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { LenWithoutIsEmpty } from "./len_without_is_empty.lints.gen.ts";
export * from "./len_without_is_empty.lints.gen.ts";

declare module "./len_without_is_empty.lints.gen.ts" {
  interface LenWithoutIsEmpty extends LateLintPass {}
}

// ---- LenWithoutIsEmpty (late sub-pass; declare_lint_pass! in len_without_is_empty.rs) ----

// impl LateLintPass for LenWithoutIsEmpty (len_without_is_empty.rs:45)
// stub: src/tools/clippy/clippy_lints/src/len_without_is_empty.rs:46 check_item (lane lint-files)
LenWithoutIsEmpty.prototype.check_item = function (cx, item) {
  unported("clippy_lints::len_without_is_empty::LenWithoutIsEmpty::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/len_without_is_empty.rs:58 check_impl_item (lane lint-files)
LenWithoutIsEmpty.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::len_without_is_empty::LenWithoutIsEmpty::check_impl_item");
};
