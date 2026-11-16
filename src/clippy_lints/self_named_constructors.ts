// Port of src/tools/clippy/clippy_lints/src/self_named_constructors.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SelfNamedConstructors } from "./self_named_constructors.lints.gen.ts";
export * from "./self_named_constructors.lints.gen.ts";

declare module "./self_named_constructors.lints.gen.ts" {
  interface SelfNamedConstructors extends LateLintPass {}
}

// ---- SelfNamedConstructors (late sub-pass; declare_lint_pass! in self_named_constructors.rs) ----

// impl LateLintPass for SelfNamedConstructors (self_named_constructors.rs:42)
// stub: src/tools/clippy/clippy_lints/src/self_named_constructors.rs:43 check_impl_item (lane lint-files)
SelfNamedConstructors.prototype.check_impl_item = function (cx, impl_item) {
  unported("clippy_lints::self_named_constructors::SelfNamedConstructors::check_impl_item");
};
