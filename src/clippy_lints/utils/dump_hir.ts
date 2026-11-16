// Port of src/tools/clippy/clippy_lints/src/utils/dump_hir.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import { unported } from "../../std/panic.ts";
import { DumpHir } from "./dump_hir.lints.gen.ts";
export * from "./dump_hir.lints.gen.ts";

declare module "./dump_hir.lints.gen.ts" {
  interface DumpHir extends LateLintPass {}
}

// ---- DumpHir (late sub-pass; declare_lint_pass! in utils/dump_hir.rs) ----

// impl LateLintPass for DumpHir (utils/dump_hir.rs:24)
// stub: src/tools/clippy/clippy_lints/src/utils/dump_hir.rs:25 check_item (lane always-running)
DumpHir.prototype.check_item = function (cx, item) {
  unported("clippy_lints::utils::dump_hir::DumpHir::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/utils/dump_hir.rs:31 check_expr (lane always-running)
DumpHir.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::utils::dump_hir::DumpHir::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/utils/dump_hir.rs:37 check_stmt (lane always-running)
DumpHir.prototype.check_stmt = function (cx, stmt) {
  unported("clippy_lints::utils::dump_hir::DumpHir::check_stmt");
};
// stub: src/tools/clippy/clippy_lints/src/utils/dump_hir.rs:47 check_trait_item (lane always-running)
DumpHir.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::utils::dump_hir::DumpHir::check_trait_item");
};
// stub: src/tools/clippy/clippy_lints/src/utils/dump_hir.rs:53 check_impl_item (lane always-running)
DumpHir.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::utils::dump_hir::DumpHir::check_impl_item");
};
