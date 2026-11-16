// Port of src/tools/clippy/clippy_lints/src/mutex_atomic.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { Mutex } from "./mutex_atomic.lints.gen.ts";
export * from "./mutex_atomic.lints.gen.ts";

declare module "./mutex_atomic.lints.gen.ts" {
  interface Mutex extends LateLintPass {}
}

// ---- Mutex (late sub-pass; declare_lint_pass! in mutex_atomic.rs) ----

// impl LateLintPass for Mutex (mutex_atomic.rs:97)
// stub: src/tools/clippy/clippy_lints/src/mutex_atomic.rs:98 check_item (lane lint-files)
Mutex.prototype.check_item = function (cx, item) {
  unported("clippy_lints::mutex_atomic::Mutex::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/mutex_atomic.rs:107 check_local (lane lint-files)
Mutex.prototype.check_local = function (cx, stmt) {
  unported("clippy_lints::mutex_atomic::Mutex::check_local");
};
