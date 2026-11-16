// Port of src/tools/clippy/clippy_lints/src/impl_hash_with_borrow_str_and_bytes.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ImplHashWithBorrowStrBytes } from "./impl_hash_with_borrow_str_and_bytes.lints.gen.ts";
export * from "./impl_hash_with_borrow_str_and_bytes.lints.gen.ts";

declare module "./impl_hash_with_borrow_str_and_bytes.lints.gen.ts" {
  interface ImplHashWithBorrowStrBytes extends LateLintPass {}
}

// ---- ImplHashWithBorrowStrBytes (late sub-pass; declare_lint_pass! in impl_hash_with_borrow_str_and_bytes.rs) ----

// impl LateLintPass for ImplHashWithBorrowStrBytes (impl_hash_with_borrow_str_and_bytes.rs:75)
// stub: src/tools/clippy/clippy_lints/src/impl_hash_with_borrow_str_and_bytes.rs:78 check_item (lane lint-files)
ImplHashWithBorrowStrBytes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::impl_hash_with_borrow_str_and_bytes::ImplHashWithBorrowStrBytes::check_item");
};
