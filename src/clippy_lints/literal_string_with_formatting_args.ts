// Port of src/tools/clippy/clippy_lints/src/literal_string_with_formatting_args.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { LiteralStringWithFormattingArg } from "./literal_string_with_formatting_args.lints.gen.ts";
export * from "./literal_string_with_formatting_args.lints.gen.ts";

declare module "./literal_string_with_formatting_args.lints.gen.ts" {
  interface LiteralStringWithFormattingArg extends LateLintPass {}
}

// ---- LiteralStringWithFormattingArg (late sub-pass; declare_lint_pass! in literal_string_with_formatting_args.rs) ----

// impl LateLintPass for LiteralStringWithFormattingArg (literal_string_with_formatting_args.rs:83)
// stub: src/tools/clippy/clippy_lints/src/literal_string_with_formatting_args.rs:84 check_expr (lane lint-files)
LiteralStringWithFormattingArg.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::literal_string_with_formatting_args::LiteralStringWithFormattingArg::check_expr");
};
