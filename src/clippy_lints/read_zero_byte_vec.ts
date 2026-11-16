// Port of src/tools/clippy/clippy_lints/src/read_zero_byte_vec.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ReadZeroByteVec } from "./read_zero_byte_vec.lints.gen.ts";
export * from "./read_zero_byte_vec.lints.gen.ts";

declare module "./read_zero_byte_vec.lints.gen.ts" {
  interface ReadZeroByteVec extends LateLintPass {}
}

// ---- ReadZeroByteVec (late sub-pass; declare_lint_pass! in read_zero_byte_vec.rs) ----

// impl LateLintPass for ReadZeroByteVec (read_zero_byte_vec.rs:51)
// stub: src/tools/clippy/clippy_lints/src/read_zero_byte_vec.rs:52 check_block (lane lint-files)
ReadZeroByteVec.prototype.check_block = function (cx, block) {
  unported("clippy_lints::read_zero_byte_vec::ReadZeroByteVec::check_block");
};
