// Port of src/tools/clippy/clippy_lints/src/tabs_in_doc_comments.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { TabsInDocComments } from "./tabs_in_doc_comments.lints.gen.ts";
export * from "./tabs_in_doc_comments.lints.gen.ts";

declare module "./tabs_in_doc_comments.lints.gen.ts" {
  interface TabsInDocComments extends EarlyLintPass {}
}

// ---- TabsInDocComments (early sub-pass; declare_lint_pass! in tabs_in_doc_comments.rs) ----

// impl EarlyLintPass for TabsInDocComments (tabs_in_doc_comments.rs:89)
// stub: src/tools/clippy/clippy_lints/src/tabs_in_doc_comments.rs:90 check_attribute (lane always-running)
TabsInDocComments.prototype.check_attribute = function (cx, attribute) {
  unported("clippy_lints::tabs_in_doc_comments::TabsInDocComments::check_attribute");
};
