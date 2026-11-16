// Port of src/tools/clippy/clippy_lints/src/single_char_lifetime_names.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SingleCharLifetimeNames } from "./single_char_lifetime_names.lints.gen.ts";
export * from "./single_char_lifetime_names.lints.gen.ts";

declare module "./single_char_lifetime_names.lints.gen.ts" {
  interface SingleCharLifetimeNames extends EarlyLintPass {}
}

// ---- SingleCharLifetimeNames (early sub-pass; declare_lint_pass! in single_char_lifetime_names.rs) ----

// impl EarlyLintPass for SingleCharLifetimeNames (single_char_lifetime_names.rs:41)
// stub: src/tools/clippy/clippy_lints/src/single_char_lifetime_names.rs:42 check_generic_param (lane always-running)
SingleCharLifetimeNames.prototype.check_generic_param = function (cx, param) {
  unported("clippy_lints::single_char_lifetime_names::SingleCharLifetimeNames::check_generic_param");
};
