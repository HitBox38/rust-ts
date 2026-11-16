// Port of src/tools/clippy/clippy_lints/src/missing_asserts_for_indexing.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { MissingAssertsForIndexing } from "./missing_asserts_for_indexing.lints.gen.ts";
export * from "./missing_asserts_for_indexing.lints.gen.ts";

declare module "./missing_asserts_for_indexing.lints.gen.ts" {
  interface MissingAssertsForIndexing extends LateLintPass {}
}

// ---- MissingAssertsForIndexing (late sub-pass; declare_lint_pass! in missing_asserts_for_indexing.rs) ----

// impl LateLintPass for MissingAssertsForIndexing (missing_asserts_for_indexing.rs:435)
// stub: src/tools/clippy/clippy_lints/src/missing_asserts_for_indexing.rs:436 check_body (lane lint-files)
MissingAssertsForIndexing.prototype.check_body = function (cx, body) {
  unported("clippy_lints::missing_asserts_for_indexing::MissingAssertsForIndexing::check_body");
};
