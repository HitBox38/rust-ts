// Port of src/tools/clippy/clippy_lints/src/suspicious_trait_impl.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SuspiciousImpl } from "./suspicious_trait_impl.lints.gen.ts";
export * from "./suspicious_trait_impl.lints.gen.ts";

declare module "./suspicious_trait_impl.lints.gen.ts" {
  interface SuspiciousImpl extends LateLintPass {}
}

// ---- SuspiciousImpl (late sub-pass; declare_lint_pass! in suspicious_trait_impl.rs) ----

// impl LateLintPass for SuspiciousImpl (suspicious_trait_impl.rs:60)
// stub: src/tools/clippy/clippy_lints/src/suspicious_trait_impl.rs:61 check_expr (lane lint-files)
SuspiciousImpl.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::suspicious_trait_impl::SuspiciousImpl::check_expr");
};
