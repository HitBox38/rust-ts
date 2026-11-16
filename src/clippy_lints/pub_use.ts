// Port of src/tools/clippy/clippy_lints/src/pub_use.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PubUse } from "./pub_use.lints.gen.ts";
export * from "./pub_use.lints.gen.ts";

declare module "./pub_use.lints.gen.ts" {
  interface PubUse extends EarlyLintPass {}
}

// ---- PubUse (early sub-pass; declare_lint_pass! in pub_use.rs) ----

// impl EarlyLintPass for PubUse (pub_use.rs:40)
// stub: src/tools/clippy/clippy_lints/src/pub_use.rs:41 check_item (lane always-running)
PubUse.prototype.check_item = function (cx, item) {
  unported("clippy_lints::pub_use::PubUse::check_item");
};
