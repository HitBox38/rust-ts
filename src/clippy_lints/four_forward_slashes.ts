// Port of src/tools/clippy/clippy_lints/src/four_forward_slashes.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { FourForwardSlashes } from "./four_forward_slashes.lints.gen.ts";
export * from "./four_forward_slashes.lints.gen.ts";

declare module "./four_forward_slashes.lints.gen.ts" {
  interface FourForwardSlashes extends LateLintPass {}
}

// ---- FourForwardSlashes (late sub-pass; declare_lint_pass! in four_forward_slashes.rs) ----

// impl LateLintPass for FourForwardSlashes (four_forward_slashes.rs:42)
// stub: src/tools/clippy/clippy_lints/src/four_forward_slashes.rs:43 check_item (lane lint-files)
FourForwardSlashes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::four_forward_slashes::FourForwardSlashes::check_item");
};
