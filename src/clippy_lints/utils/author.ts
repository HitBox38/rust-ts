// Port of src/tools/clippy/clippy_lints/src/utils/author.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import { unported } from "../../std/panic.ts";
import { Author } from "./author.lints.gen.ts";
export * from "./author.lints.gen.ts";

declare module "./author.lints.gen.ts" {
  interface Author extends LateLintPass {}
}

// ---- Author (late sub-pass; declare_lint_pass! in utils/author.rs) ----

// impl LateLintPass for Author (utils/author.rs:101)
// stub: src/tools/clippy/clippy_lints/src/utils/author.rs:102 check_item (lane always-running)
Author.prototype.check_item = function (cx, item) {
  unported("clippy_lints::utils::author::Author::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/utils/author.rs:106 check_impl_item (lane always-running)
Author.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::utils::author::Author::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/utils/author.rs:110 check_trait_item (lane always-running)
Author.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::utils::author::Author::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/utils/author.rs:114 check_arm (lane always-running)
Author.prototype.check_arm = function (cx, arm) {
  unported("clippy_lints::utils::author::Author::check_arm");
};
// stub: src/tools/clippy/clippy_lints/src/utils/author.rs:120 check_expr (lane always-running)
Author.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::utils::author::Author::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/utils/author.rs:126 check_stmt (lane always-running)
Author.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::utils::author::Author::check_stmt");
};
