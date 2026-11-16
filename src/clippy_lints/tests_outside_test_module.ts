// Port of src/tools/clippy/clippy_lints/src/tests_outside_test_module.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { TestsOutsideTestModule } from "./tests_outside_test_module.lints.gen.ts";
export * from "./tests_outside_test_module.lints.gen.ts";

declare module "./tests_outside_test_module.lints.gen.ts" {
  interface TestsOutsideTestModule extends LateLintPass {}
}

// ---- TestsOutsideTestModule (late sub-pass; declare_lint_pass! in tests_outside_test_module.rs) ----

// impl LateLintPass for TestsOutsideTestModule (tests_outside_test_module.rs:49)
// stub: src/tools/clippy/clippy_lints/src/tests_outside_test_module.rs:50 check_fn (lane lint-files)
TestsOutsideTestModule.prototype.check_fn = function (cx, kind, _0, body, sp, _1) {
  unported("clippy_lints::tests_outside_test_module::TestsOutsideTestModule::check_fn");
};
