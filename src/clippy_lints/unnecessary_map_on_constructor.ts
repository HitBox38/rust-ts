// Port of src/tools/clippy/clippy_lints/src/unnecessary_map_on_constructor.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { UnnecessaryMapOnConstructor } from "./unnecessary_map_on_constructor.lints.gen.ts";
export * from "./unnecessary_map_on_constructor.lints.gen.ts";

declare module "./unnecessary_map_on_constructor.lints.gen.ts" {
  interface UnnecessaryMapOnConstructor extends LateLintPass {}
}

// ---- UnnecessaryMapOnConstructor (late sub-pass; declare_lint_pass! in unnecessary_map_on_constructor.rs) ----

// impl LateLintPass for UnnecessaryMapOnConstructor (unnecessary_map_on_constructor.rs:38)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_map_on_constructor.rs:39 check_expr (lane lint-files)
UnnecessaryMapOnConstructor.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::unnecessary_map_on_constructor::UnnecessaryMapOnConstructor::check_expr");
};
