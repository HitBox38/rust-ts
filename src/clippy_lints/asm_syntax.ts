// Port of src/tools/clippy/clippy_lints/src/asm_syntax.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass types src/clippy_lints/lib.gen.ts names,
// each `check_*` of their `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import { unported } from "../std/panic.ts";
import { InlineAsmX86AttSyntax, InlineAsmX86IntelSyntax } from "./asm_syntax.lints.gen.ts";
export * from "./asm_syntax.lints.gen.ts";

declare module "./asm_syntax.lints.gen.ts" {
  interface InlineAsmX86AttSyntax extends EarlyLintPass {}
  interface InlineAsmX86IntelSyntax extends EarlyLintPass {}
}

// ---- InlineAsmX86AttSyntax (early sub-pass; declare_lint_pass! in asm_syntax.rs) ----

// impl EarlyLintPass for InlineAsmX86AttSyntax (asm_syntax.rs:141)
// stub: src/tools/clippy/clippy_lints/src/asm_syntax.rs:142 check_expr (lane always-running)
InlineAsmX86AttSyntax.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::asm_syntax::InlineAsmX86AttSyntax::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/asm_syntax.rs:148 check_item (lane always-running)
InlineAsmX86AttSyntax.prototype.check_item = function (cx, item) {
  unported("clippy_lints::asm_syntax::InlineAsmX86AttSyntax::check_item");
};

// ---- InlineAsmX86IntelSyntax (early sub-pass; declare_lint_pass! in asm_syntax.rs) ----

// impl EarlyLintPass for InlineAsmX86IntelSyntax (asm_syntax.rs:127)
// stub: src/tools/clippy/clippy_lints/src/asm_syntax.rs:128 check_expr (lane always-running)
InlineAsmX86IntelSyntax.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::asm_syntax::InlineAsmX86IntelSyntax::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/asm_syntax.rs:134 check_item (lane always-running)
InlineAsmX86IntelSyntax.prototype.check_item = function (cx, item) {
  unported("clippy_lints::asm_syntax::InlineAsmX86IntelSyntax::check_item");
};
