// Port of src/tools/clippy/clippy_lints/src/panic_in_result_fn.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { PanicInResultFn } from "./panic_in_result_fn.lints.gen.ts";
export * from "./panic_in_result_fn.lints.gen.ts";

declare module "./panic_in_result_fn.lints.gen.ts" {
  interface PanicInResultFn extends LateLintPass {}
}

// ---- PanicInResultFn (late sub-pass; declare_lint_pass! in panic_in_result_fn.rs) ----

// impl LateLintPass for PanicInResultFn (panic_in_result_fn.rs:44)
// stub: src/tools/clippy/clippy_lints/src/panic_in_result_fn.rs:45 check_fn (lane lint-files)
PanicInResultFn.prototype.check_fn = function (cx, fn_kind, _0, body, span, def_id) {
  unported("clippy_lints::panic_in_result_fn::PanicInResultFn::check_fn");
};
