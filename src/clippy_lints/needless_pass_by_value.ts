// Port of src/tools/clippy/clippy_lints/src/needless_pass_by_value.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessPassByValue } from "./needless_pass_by_value.lints.gen.ts";
export * from "./needless_pass_by_value.lints.gen.ts";

declare module "./needless_pass_by_value.lints.gen.ts" {
  interface NeedlessPassByValue extends LateLintPass {}
}

// ---- NeedlessPassByValue (late sub-pass; declare_lint_pass! in needless_pass_by_value.rs) ----

// impl LateLintPass for NeedlessPassByValue (needless_pass_by_value.rs:75)
// stub: src/tools/clippy/clippy_lints/src/needless_pass_by_value.rs:77 check_fn (lane lint-files)
NeedlessPassByValue.prototype.check_fn = function (cx, kind, decl, body, span, fn_def_id) {
  unported("clippy_lints::needless_pass_by_value::NeedlessPassByValue::check_fn");
};
