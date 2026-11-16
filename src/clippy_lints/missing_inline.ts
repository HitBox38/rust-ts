// Port of src/tools/clippy/clippy_lints/src/missing_inline.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { MissingInline } from "./missing_inline.lints.gen.ts";
export * from "./missing_inline.lints.gen.ts";

declare module "./missing_inline.lints.gen.ts" {
  interface MissingInline extends LateLintPass {}
}

// ---- MissingInline (late sub-pass; declare_lint_pass! in missing_inline.rs) ----

// impl LateLintPass for MissingInline (missing_inline.rs:84)
// stub: src/tools/clippy/clippy_lints/src/missing_inline.rs:85 check_item (lane lint-files)
MissingInline.prototype.check_item = function (cx, it) {
  unported("clippy_lints::missing_inline::MissingInline::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/missing_inline.rs:91 check_trait_item (lane lint-files)
MissingInline.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::missing_inline::MissingInline::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/missing_inline.rs:99 check_impl_item (lane lint-files)
MissingInline.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::missing_inline::MissingInline::check_impl_item");
};
