// Port of src/tools/clippy/clippy_lints/src/uninit_vec.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UninitVec } from "./uninit_vec.lints.gen.ts";
export * from "./uninit_vec.lints.gen.ts";

declare module "./uninit_vec.lints.gen.ts" {
  interface UninitVec extends LateLintPass {}
}

// ---- UninitVec (late sub-pass; declare_lint_pass! in uninit_vec.rs) ----

// impl LateLintPass for UninitVec (uninit_vec.rs:64)
// stub: src/tools/clippy/clippy_lints/src/uninit_vec.rs:65 check_block (lane lint-files)
UninitVec.prototype.check_block = function (cx, block) {
  unported("clippy_lints::uninit_vec::UninitVec::check_block");
};
