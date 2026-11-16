// Port of src/tools/clippy/clippy_lints/src/multiple_bound_locations.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { MultipleBoundLocations } from "./multiple_bound_locations.lints.gen.ts";
export * from "./multiple_bound_locations.lints.gen.ts";

declare module "./multiple_bound_locations.lints.gen.ts" {
  interface MultipleBoundLocations extends EarlyLintPass {}
}

// ---- MultipleBoundLocations (early sub-pass; declare_lint_pass! in multiple_bound_locations.rs) ----

// impl EarlyLintPass for MultipleBoundLocations (multiple_bound_locations.rs:39)
// stub: src/tools/clippy/clippy_lints/src/multiple_bound_locations.rs:40 check_fn (lane always-running)
MultipleBoundLocations.prototype.check_fn = function (cx, kind, _0, _1) {
  unported("clippy_lints::multiple_bound_locations::MultipleBoundLocations::check_fn");
};
