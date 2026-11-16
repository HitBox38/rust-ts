// Port of src/tools/clippy/clippy_lints/src/exhaustive_items.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ExhaustiveItems } from "./exhaustive_items.lints.gen.ts";
export * from "./exhaustive_items.lints.gen.ts";

declare module "./exhaustive_items.lints.gen.ts" {
  interface ExhaustiveItems extends LateLintPass {}
}

// ---- ExhaustiveItems (late sub-pass; declare_lint_pass! in exhaustive_items.rs) ----

// impl LateLintPass for ExhaustiveItems (exhaustive_items.rs:70)
// stub: src/tools/clippy/clippy_lints/src/exhaustive_items.rs:71 check_item (lane lint-files)
ExhaustiveItems.prototype.check_item = function (cx, item) {
  unported("clippy_lints::exhaustive_items::ExhaustiveItems::check_item");
};
