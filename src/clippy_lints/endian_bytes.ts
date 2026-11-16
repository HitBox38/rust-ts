// Port of src/tools/clippy/clippy_lints/src/endian_bytes.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { EndianBytes } from "./endian_bytes.lints.gen.ts";
export * from "./endian_bytes.lints.gen.ts";

declare module "./endian_bytes.lints.gen.ts" {
  interface EndianBytes extends LateLintPass {}
}

// ---- EndianBytes (late sub-pass; declare_lint_pass! in endian_bytes.rs) ----

// impl LateLintPass for EndianBytes (endian_bytes.rs:77)
// stub: src/tools/clippy/clippy_lints/src/endian_bytes.rs:78 check_expr (lane lint-files)
EndianBytes.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::endian_bytes::EndianBytes::check_expr");
};
