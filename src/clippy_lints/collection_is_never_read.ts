// Port of src/tools/clippy/clippy_lints/src/collection_is_never_read.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { CollectionIsNeverRead } from "./collection_is_never_read.lints.gen.ts";
export * from "./collection_is_never_read.lints.gen.ts";

declare module "./collection_is_never_read.lints.gen.ts" {
  interface CollectionIsNeverRead extends LateLintPass {}
}

// ---- CollectionIsNeverRead (late sub-pass; declare_lint_pass! in collection_is_never_read.rs) ----

// impl LateLintPass for CollectionIsNeverRead (collection_is_never_read.rs:46)
// stub: src/tools/clippy/clippy_lints/src/collection_is_never_read.rs:47 check_local (lane lint-files)
CollectionIsNeverRead.prototype.check_local = function (cx, local) {
  unported("clippy_lints::collection_is_never_read::CollectionIsNeverRead::check_local");
};
