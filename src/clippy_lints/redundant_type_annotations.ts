// Port of src/tools/clippy/clippy_lints/src/redundant_type_annotations.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { RedundantTypeAnnotations } from "./redundant_type_annotations.lints.gen.ts";
export * from "./redundant_type_annotations.lints.gen.ts";

declare module "./redundant_type_annotations.lints.gen.ts" {
  interface RedundantTypeAnnotations extends LateLintPass {}
}

// ---- RedundantTypeAnnotations (late sub-pass; declare_lint_pass! in redundant_type_annotations.rs) ----

// impl LateLintPass for RedundantTypeAnnotations (redundant_type_annotations.rs:132)
// stub: src/tools/clippy/clippy_lints/src/redundant_type_annotations.rs:133 check_local (lane lint-files)
RedundantTypeAnnotations.prototype.check_local = function (cx, local) {
  unported("clippy_lints::redundant_type_annotations::RedundantTypeAnnotations::check_local");
};
