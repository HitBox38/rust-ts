// Port of src/tools/clippy/clippy_lints/src/format_push_string.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { FormatArgsStorage } from "../clippy_utils/macros.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { FormatPushString_impl_lint_pass } from "./format_push_string.lints.gen.ts";
export * from "./format_push_string.lints.gen.ts";

// ---- FormatPushString (late sub-pass; impl_lint_pass! in format_push_string.rs) ----
export interface FormatPushString extends LateLintPass {}
/** `struct FormatPushString { .. }` (format_push_string.rs:47); its `impl_lint_pass!` expansion is `FormatPushString_impl_lint_pass`. Fields: ported by the fill lane. */
export class FormatPushString implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/format_push_string.rs:72 new (lane lint-files)
  static new(format_args: FormatArgsStorage): FormatPushString {
    return unported("clippy_lints::format_push_string::FormatPushString::new");
  }

  name(): string {
    return FormatPushString_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return FormatPushString_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return FormatPushString_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for FormatPushString (format_push_string.rs:122)
// stub: src/tools/clippy/clippy_lints/src/format_push_string.rs:123 check_expr (lane lint-files)
FormatPushString.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::format_push_string::FormatPushString::check_expr");
};
