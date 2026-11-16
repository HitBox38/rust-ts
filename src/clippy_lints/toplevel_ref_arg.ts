// Port of src/tools/clippy/clippy_lints/src/toplevel_ref_arg.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ToplevelRefArg } from "./toplevel_ref_arg.lints.gen.ts";
export * from "./toplevel_ref_arg.lints.gen.ts";

declare module "./toplevel_ref_arg.lints.gen.ts" {
  interface ToplevelRefArg extends LateLintPass {}
}

// ---- ToplevelRefArg (late sub-pass; declare_lint_pass! in toplevel_ref_arg.rs) ----

// impl LateLintPass for ToplevelRefArg (toplevel_ref_arg.rs:51)
// stub: src/tools/clippy/clippy_lints/src/toplevel_ref_arg.rs:52 check_fn (lane lint-files)
ToplevelRefArg.prototype.check_fn = function (cx, k, decl, body, _0, _1) {
  unported("clippy_lints::toplevel_ref_arg::ToplevelRefArg::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/toplevel_ref_arg.rs:80 check_stmt (lane lint-files)
ToplevelRefArg.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::toplevel_ref_arg::ToplevelRefArg::check_stmt");
};
