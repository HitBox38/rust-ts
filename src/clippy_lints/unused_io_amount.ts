// Port of src/tools/clippy/clippy_lints/src/unused_io_amount.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnusedIoAmount } from "./unused_io_amount.lints.gen.ts";
export * from "./unused_io_amount.lints.gen.ts";

declare module "./unused_io_amount.lints.gen.ts" {
  interface UnusedIoAmount extends LateLintPass {}
}

// ---- UnusedIoAmount (late sub-pass; declare_lint_pass! in unused_io_amount.rs) ----

// impl LateLintPass for UnusedIoAmount (unused_io_amount.rs:66)
// stub: src/tools/clippy/clippy_lints/src/unused_io_amount.rs:86 check_block (lane lint-files)
UnusedIoAmount.prototype.check_block = function (cx, block) {
  unported("clippy_lints::unused_io_amount::UnusedIoAmount::check_block");
};
