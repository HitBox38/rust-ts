// Port of src/tools/clippy/clippy_lints/src/needless_ifs.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { NeedlessIfs } from "./needless_ifs.lints.gen.ts";
export * from "./needless_ifs.lints.gen.ts";

declare module "./needless_ifs.lints.gen.ts" {
  interface NeedlessIfs extends LateLintPass {}
}

// ---- NeedlessIfs (late sub-pass; declare_lint_pass! in needless_ifs.rs) ----

// impl LateLintPass for NeedlessIfs (needless_ifs.rs:38)
// stub: src/tools/clippy/clippy_lints/src/needless_ifs.rs:39 check_stmt (lane lint-files)
NeedlessIfs.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::needless_ifs::NeedlessIfs::check_stmt");
};
