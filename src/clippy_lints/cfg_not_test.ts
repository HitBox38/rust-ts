// Port of src/tools/clippy/clippy_lints/src/cfg_not_test.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { CfgNotTest } from "./cfg_not_test.lints.gen.ts";
export * from "./cfg_not_test.lints.gen.ts";

declare module "./cfg_not_test.lints.gen.ts" {
  interface CfgNotTest extends EarlyLintPass {}
}

// ---- CfgNotTest (early sub-pass; declare_lint_pass! in cfg_not_test.rs) ----

// impl EarlyLintPass for CfgNotTest (cfg_not_test.rs:34)
// stub: src/tools/clippy/clippy_lints/src/cfg_not_test.rs:35 check_attribute (lane always-running)
CfgNotTest.prototype.check_attribute = function (cx, attr) {
  unported("clippy_lints::cfg_not_test::CfgNotTest::check_attribute");
};
