// Port of src/tools/clippy/clippy_lints/src/unnecessary_literal_bound.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnnecessaryLiteralBound } from "./unnecessary_literal_bound.lints.gen.ts";
export * from "./unnecessary_literal_bound.lints.gen.ts";

declare module "./unnecessary_literal_bound.lints.gen.ts" {
  interface UnnecessaryLiteralBound extends LateLintPass {}
}

// ---- UnnecessaryLiteralBound (late sub-pass; declare_lint_pass! in unnecessary_literal_bound.rs) ----

// impl LateLintPass for UnnecessaryLiteralBound (unnecessary_literal_bound.rs:112)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_literal_bound.rs:113 check_fn (lane lint-files)
UnnecessaryLiteralBound.prototype.check_fn = function (cx, kind, decl, body, span, _0) {
  unported("clippy_lints::unnecessary_literal_bound::UnnecessaryLiteralBound::check_fn");
};
