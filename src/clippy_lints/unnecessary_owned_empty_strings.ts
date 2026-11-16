// Port of src/tools/clippy/clippy_lints/src/unnecessary_owned_empty_strings.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnnecessaryOwnedEmptyStrings } from "./unnecessary_owned_empty_strings.lints.gen.ts";
export * from "./unnecessary_owned_empty_strings.lints.gen.ts";

declare module "./unnecessary_owned_empty_strings.lints.gen.ts" {
  interface UnnecessaryOwnedEmptyStrings extends LateLintPass {}
}

// ---- UnnecessaryOwnedEmptyStrings (late sub-pass; declare_lint_pass! in unnecessary_owned_empty_strings.rs) ----

// impl LateLintPass for UnnecessaryOwnedEmptyStrings (unnecessary_owned_empty_strings.rs:38)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_owned_empty_strings.rs:39 check_expr (lane lint-files)
UnnecessaryOwnedEmptyStrings.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::unnecessary_owned_empty_strings::UnnecessaryOwnedEmptyStrings::check_expr");
};
