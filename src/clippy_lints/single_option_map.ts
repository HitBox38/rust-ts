// Port of src/tools/clippy/clippy_lints/src/single_option_map.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { SingleOptionMap } from "./single_option_map.lints.gen.ts";
export * from "./single_option_map.lints.gen.ts";

declare module "./single_option_map.lints.gen.ts" {
  interface SingleOptionMap extends LateLintPass {}
}

// ---- SingleOptionMap (late sub-pass; declare_lint_pass! in single_option_map.rs) ----

// impl LateLintPass for SingleOptionMap (single_option_map.rs:40)
// stub: src/tools/clippy/clippy_lints/src/single_option_map.rs:41 check_fn (lane lint-files)
SingleOptionMap.prototype.check_fn = function (cx, kind, decl, body, span, _fn_def) {
  unported("clippy_lints::single_option_map::SingleOptionMap::check_fn");
};
