// Port of src/tools/clippy/clippy_lints/src/inline_fn_without_body.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { InlineFnWithoutBody } from "./inline_fn_without_body.lints.gen.ts";
export * from "./inline_fn_without_body.lints.gen.ts";

declare module "./inline_fn_without_body.lints.gen.ts" {
  interface InlineFnWithoutBody extends LateLintPass {}
}

// ---- InlineFnWithoutBody (late sub-pass; declare_lint_pass! in inline_fn_without_body.rs) ----

// impl LateLintPass for InlineFnWithoutBody (inline_fn_without_body.rs:31)
// stub: src/tools/clippy/clippy_lints/src/inline_fn_without_body.rs:32 check_trait_item (lane lint-files)
InlineFnWithoutBody.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::inline_fn_without_body::InlineFnWithoutBody::check_trait_item");
};
