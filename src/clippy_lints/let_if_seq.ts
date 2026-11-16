// Port of src/tools/clippy/clippy_lints/src/let_if_seq.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { LetIfSeq } from "./let_if_seq.lints.gen.ts";
export * from "./let_if_seq.lints.gen.ts";

declare module "./let_if_seq.lints.gen.ts" {
  interface LetIfSeq extends LateLintPass {}
}

// ---- LetIfSeq (late sub-pass; declare_lint_pass! in let_if_seq.rs) ----

// impl LateLintPass for LetIfSeq (let_if_seq.rs:58)
// stub: src/tools/clippy/clippy_lints/src/let_if_seq.rs:59 check_block (lane lint-files)
LetIfSeq.prototype.check_block = function (cx, block) {
  unported("clippy_lints::let_if_seq::LetIfSeq::check_block");
};
