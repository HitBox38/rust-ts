// Port of src/tools/clippy/clippy_lints/src/redundant_clone.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { RedundantClone } from "./redundant_clone.lints.gen.ts";
export * from "./redundant_clone.lints.gen.ts";

declare module "./redundant_clone.lints.gen.ts" {
  interface RedundantClone extends LateLintPass {}
}

// ---- RedundantClone (late sub-pass; declare_lint_pass! in redundant_clone.rs) ----

// impl LateLintPass for RedundantClone (redundant_clone.rs:58)
// stub: src/tools/clippy/clippy_lints/src/redundant_clone.rs:60 check_fn (lane lint-files)
RedundantClone.prototype.check_fn = function (cx, _0, _1, body, _2, def_id) {
  unported("clippy_lints::redundant_clone::RedundantClone::check_fn");
};
