// Port of src/tools/clippy/clippy_lints/src/future_not_send.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { FutureNotSend } from "./future_not_send.lints.gen.ts";
export * from "./future_not_send.lints.gen.ts";

declare module "./future_not_send.lints.gen.ts" {
  interface FutureNotSend extends LateLintPass {}
}

// ---- FutureNotSend (late sub-pass; declare_lint_pass! in future_not_send.rs) ----

// impl LateLintPass for FutureNotSend (future_not_send.rs:64)
// stub: src/tools/clippy/clippy_lints/src/future_not_send.rs:65 check_fn (lane lint-files)
FutureNotSend.prototype.check_fn = function (cx, kind, decl, _0, _1, fn_def_id) {
  unported("clippy_lints::future_not_send::FutureNotSend::check_fn");
};
