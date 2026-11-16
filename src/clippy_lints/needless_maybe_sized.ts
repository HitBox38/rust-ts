// Port of src/tools/clippy/clippy_lints/src/needless_maybe_sized.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessMaybeSized } from "./needless_maybe_sized.lints.gen.ts";
export * from "./needless_maybe_sized.lints.gen.ts";

declare module "./needless_maybe_sized.lints.gen.ts" {
  interface NeedlessMaybeSized extends LateLintPass {}
}

// ---- NeedlessMaybeSized (late sub-pass; declare_lint_pass! in needless_maybe_sized.rs) ----

// impl LateLintPass for NeedlessMaybeSized (needless_maybe_sized.rs:119)
// stub: src/tools/clippy/clippy_lints/src/needless_maybe_sized.rs:120 check_generics (lane lint-files)
NeedlessMaybeSized.prototype.check_generics = function (cx, generics) {
  unported("clippy_lints::needless_maybe_sized::NeedlessMaybeSized::check_generics");
};
