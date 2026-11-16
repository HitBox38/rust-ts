// Port of src/tools/clippy/clippy_lints/src/items_after_test_module.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { ItemsAfterTestModule } from "./items_after_test_module.lints.gen.ts";
export * from "./items_after_test_module.lints.gen.ts";

declare module "./items_after_test_module.lints.gen.ts" {
  interface ItemsAfterTestModule extends LateLintPass {}
}

// ---- ItemsAfterTestModule (late sub-pass; declare_lint_pass! in items_after_test_module.rs) ----

// impl LateLintPass for ItemsAfterTestModule (items_after_test_module.rs:59)
// stub: src/tools/clippy/clippy_lints/src/items_after_test_module.rs:60 check_mod (lane lint-files)
ItemsAfterTestModule.prototype.check_mod = function (cx, module, _0) {
  unported("clippy_lints::items_after_test_module::ItemsAfterTestModule::check_mod");
};
