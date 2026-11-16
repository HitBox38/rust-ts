// Port of src/tools/clippy/clippy_lints/src/option_env_unwrap.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { OptionEnvUnwrap } from "./option_env_unwrap.lints.gen.ts";
export * from "./option_env_unwrap.lints.gen.ts";

declare module "./option_env_unwrap.lints.gen.ts" {
  interface OptionEnvUnwrap extends EarlyLintPass {}
}

// ---- OptionEnvUnwrap (early sub-pass; declare_lint_pass! in option_env_unwrap.rs) ----

// impl EarlyLintPass for OptionEnvUnwrap (option_env_unwrap.rs:35)
// stub: src/tools/clippy/clippy_lints/src/option_env_unwrap.rs:36 check_expr (lane always-running)
OptionEnvUnwrap.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::option_env_unwrap::OptionEnvUnwrap::check_expr");
};
