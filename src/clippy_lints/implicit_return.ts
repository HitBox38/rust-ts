// Port of src/tools/clippy/clippy_lints/src/implicit_return.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ImplicitReturn } from "./implicit_return.lints.gen.ts";
export * from "./implicit_return.lints.gen.ts";

declare module "./implicit_return.lints.gen.ts" {
  interface ImplicitReturn extends LateLintPass {}
}

// ---- ImplicitReturn (late sub-pass; declare_lint_pass! in implicit_return.rs) ----

// impl LateLintPass for ImplicitReturn (implicit_return.rs:220)
// stub: src/tools/clippy/clippy_lints/src/implicit_return.rs:221 check_fn (lane lint-files)
ImplicitReturn.prototype.check_fn = function (cx, kind, decl, body, span, _0) {
  unported("clippy_lints::implicit_return::ImplicitReturn::check_fn");
};
