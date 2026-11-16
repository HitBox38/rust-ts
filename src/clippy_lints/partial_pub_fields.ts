// Port of src/tools/clippy/clippy_lints/src/partial_pub_fields.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PartialPubFields } from "./partial_pub_fields.lints.gen.ts";
export * from "./partial_pub_fields.lints.gen.ts";

declare module "./partial_pub_fields.lints.gen.ts" {
  interface PartialPubFields extends EarlyLintPass {}
}

// ---- PartialPubFields (early sub-pass; declare_lint_pass! in partial_pub_fields.rs) ----

// impl EarlyLintPass for PartialPubFields (partial_pub_fields.rs:42)
// stub: src/tools/clippy/clippy_lints/src/partial_pub_fields.rs:43 check_item (lane always-running)
PartialPubFields.prototype.check_item = function (cx, item) {
  unported("clippy_lints::partial_pub_fields::PartialPubFields::check_item");
};
