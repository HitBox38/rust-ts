// Port of src/tools/clippy/clippy_lints/src/implicit_hasher.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ImplicitHasher } from "./implicit_hasher.lints.gen.ts";
export * from "./implicit_hasher.lints.gen.ts";

declare module "./implicit_hasher.lints.gen.ts" {
  interface ImplicitHasher extends LateLintPass {}
}

// ---- ImplicitHasher (late sub-pass; declare_lint_pass! in implicit_hasher.rs) ----

// impl LateLintPass for ImplicitHasher (implicit_hasher.rs:59)
// stub: src/tools/clippy/clippy_lints/src/implicit_hasher.rs:61 check_item (lane lint-files)
ImplicitHasher.prototype.check_item = function (cx, item) {
  unported("clippy_lints::implicit_hasher::ImplicitHasher::check_item");
};
