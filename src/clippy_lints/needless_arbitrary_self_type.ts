// Port of src/tools/clippy/clippy_lints/src/needless_arbitrary_self_type.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessArbitrarySelfType } from "./needless_arbitrary_self_type.lints.gen.ts";
export * from "./needless_arbitrary_self_type.lints.gen.ts";

declare module "./needless_arbitrary_self_type.lints.gen.ts" {
  interface NeedlessArbitrarySelfType extends EarlyLintPass {}
}

// ---- NeedlessArbitrarySelfType (early sub-pass; declare_lint_pass! in needless_arbitrary_self_type.rs) ----

// impl EarlyLintPass for NeedlessArbitrarySelfType (needless_arbitrary_self_type.rs:66)
// stub: src/tools/clippy/clippy_lints/src/needless_arbitrary_self_type.rs:67 check_param (lane always-running)
NeedlessArbitrarySelfType.prototype.check_param = function (cx, p) {
  unported("clippy_lints::needless_arbitrary_self_type::NeedlessArbitrarySelfType::check_param");
};
