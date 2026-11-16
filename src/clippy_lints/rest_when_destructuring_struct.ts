// Port of src/tools/clippy/clippy_lints/src/rest_when_destructuring_struct.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { RestWhenDestructuringStruct } from "./rest_when_destructuring_struct.lints.gen.ts";
export * from "./rest_when_destructuring_struct.lints.gen.ts";

declare module "./rest_when_destructuring_struct.lints.gen.ts" {
  interface RestWhenDestructuringStruct extends LateLintPass {}
}

// ---- RestWhenDestructuringStruct (late sub-pass; declare_lint_pass! in rest_when_destructuring_struct.rs) ----

// impl LateLintPass for RestWhenDestructuringStruct (rest_when_destructuring_struct.rs:88)
// stub: src/tools/clippy/clippy_lints/src/rest_when_destructuring_struct.rs:89 check_pat (lane lint-files)
RestWhenDestructuringStruct.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::rest_when_destructuring_struct::RestWhenDestructuringStruct::check_pat");
};
