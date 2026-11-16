// Port of src/tools/clippy/clippy_lints/src/return_self_not_must_use.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ReturnSelfNotMustUse } from "./return_self_not_must_use.lints.gen.ts";
export * from "./return_self_not_must_use.lints.gen.ts";

declare module "./return_self_not_must_use.lints.gen.ts" {
  interface ReturnSelfNotMustUse extends LateLintPass {}
}

// ---- ReturnSelfNotMustUse (late sub-pass; declare_lint_pass! in return_self_not_must_use.rs) ----

// impl LateLintPass for ReturnSelfNotMustUse (return_self_not_must_use.rs:102)
// stub: src/tools/clippy/clippy_lints/src/return_self_not_must_use.rs:103 check_fn (lane lint-files)
ReturnSelfNotMustUse.prototype.check_fn = function (cx, kind, decl, _0, span, fn_def) {
  unported("clippy_lints::return_self_not_must_use::ReturnSelfNotMustUse::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/return_self_not_must_use.rs:123 check_trait_item (lane lint-files)
ReturnSelfNotMustUse.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::return_self_not_must_use::ReturnSelfNotMustUse::check_trait_item");
};
