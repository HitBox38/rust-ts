// Port of src/tools/clippy/clippy_lints/src/unneeded_struct_pattern.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnneededStructPattern } from "./unneeded_struct_pattern.lints.gen.ts";
export * from "./unneeded_struct_pattern.lints.gen.ts";

declare module "./unneeded_struct_pattern.lints.gen.ts" {
  interface UnneededStructPattern extends LateLintPass {}
}

// ---- UnneededStructPattern (late sub-pass; declare_lint_pass! in unneeded_struct_pattern.rs) ----

// impl LateLintPass for UnneededStructPattern (unneeded_struct_pattern.rs:42)
// stub: src/tools/clippy/clippy_lints/src/unneeded_struct_pattern.rs:43 check_pat (lane lint-files)
UnneededStructPattern.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::unneeded_struct_pattern::UnneededStructPattern::check_pat");
};
