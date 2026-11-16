// Port of src/tools/clippy/clippy_lints/src/strings.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass types src/clippy_lints/lib.gen.ts names,
// each `check_*` of their `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { LateLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { StrToString, StringAdd, StringLitAsBytes } from "./strings.lints.gen.ts";
export * from "./strings.lints.gen.ts";

declare module "./strings.lints.gen.ts" {
  interface StringAdd extends LateLintPass {}
  interface StringLitAsBytes extends LateLintPass {}
  interface StrToString extends LateLintPass {}
}

// ---- StringAdd (late sub-pass; declare_lint_pass! in strings.rs) ----

// impl LateLintPass for StringAdd (strings.rs:169)
// stub: src/tools/clippy/clippy_lints/src/strings.rs:170 check_expr (lane lint-files)
StringAdd.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::strings::StringAdd::check_expr");
};

// ---- StringLitAsBytes (late sub-pass; declare_lint_pass! in strings.rs) ----

// impl LateLintPass for StringLitAsBytes (strings.rs:236)
// stub: src/tools/clippy/clippy_lints/src/strings.rs:237 check_expr (lane lint-files)
StringLitAsBytes.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::strings::StringLitAsBytes::check_expr");
};

// ---- StrToString (late sub-pass; declare_lint_pass! in strings.rs) ----

// impl LateLintPass for StrToString (strings.rs:315)
// stub: src/tools/clippy/clippy_lints/src/strings.rs:316 check_expr (lane lint-files)
StrToString.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::strings::StrToString::check_expr");
};
