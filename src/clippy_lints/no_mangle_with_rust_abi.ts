// Port of src/tools/clippy/clippy_lints/src/no_mangle_with_rust_abi.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NoMangleWithRustAbi } from "./no_mangle_with_rust_abi.lints.gen.ts";
export * from "./no_mangle_with_rust_abi.lints.gen.ts";

declare module "./no_mangle_with_rust_abi.lints.gen.ts" {
  interface NoMangleWithRustAbi extends LateLintPass {}
}

// ---- NoMangleWithRustAbi (late sub-pass; declare_lint_pass! in no_mangle_with_rust_abi.rs) ----

// impl LateLintPass for NoMangleWithRustAbi (no_mangle_with_rust_abi.rs:39)
// stub: src/tools/clippy/clippy_lints/src/no_mangle_with_rust_abi.rs:40 check_item (lane lint-files)
NoMangleWithRustAbi.prototype.check_item = function (cx, item) {
  unported("clippy_lints::no_mangle_with_rust_abi::NoMangleWithRustAbi::check_item");
};
