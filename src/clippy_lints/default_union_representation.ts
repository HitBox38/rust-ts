// Port of src/tools/clippy/clippy_lints/src/default_union_representation.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { DefaultUnionRepresentation } from "./default_union_representation.lints.gen.ts";
export * from "./default_union_representation.lints.gen.ts";

declare module "./default_union_representation.lints.gen.ts" {
  interface DefaultUnionRepresentation extends LateLintPass {}
}

// ---- DefaultUnionRepresentation (late sub-pass; declare_lint_pass! in default_union_representation.rs) ----

// impl LateLintPass for DefaultUnionRepresentation (default_union_representation.rs:53)
// stub: src/tools/clippy/clippy_lints/src/default_union_representation.rs:54 check_item (lane lint-files)
DefaultUnionRepresentation.prototype.check_item = function (cx, item) {
  unported("clippy_lints::default_union_representation::DefaultUnionRepresentation::check_item");
};
