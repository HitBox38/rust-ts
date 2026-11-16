// Port of src/tools/clippy/clippy_lints/src/needless_for_each.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessForEach } from "./needless_for_each.lints.gen.ts";
export * from "./needless_for_each.lints.gen.ts";

declare module "./needless_for_each.lints.gen.ts" {
  interface NeedlessForEach extends LateLintPass {}
}

// ---- NeedlessForEach (late sub-pass; declare_lint_pass! in needless_for_each.rs) ----

// impl LateLintPass for NeedlessForEach (needless_for_each.rs:56)
// stub: src/tools/clippy/clippy_lints/src/needless_for_each.rs:57 check_stmt (lane lint-files)
NeedlessForEach.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::needless_for_each::NeedlessForEach::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/needless_for_each.rs:63 check_block (lane lint-files)
NeedlessForEach.prototype.check_block = function (cx, block) {
  unported("clippy_lints::needless_for_each::NeedlessForEach::check_block");
};
