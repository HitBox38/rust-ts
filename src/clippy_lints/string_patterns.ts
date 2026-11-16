// Port of src/tools/clippy/clippy_lints/src/string_patterns.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { StringPatterns_impl_lint_pass } from "./string_patterns.lints.gen.ts";
export * from "./string_patterns.lints.gen.ts";

// ---- StringPatterns (late sub-pass; impl_lint_pass! in string_patterns.rs) ----
export interface StringPatterns extends LateLintPass {}
/** `struct StringPatterns { .. }` (string_patterns.rs:79); its `impl_lint_pass!` expansion is `StringPatterns_impl_lint_pass`. Fields: ported by the fill lane. */
export class StringPatterns implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/string_patterns.rs:84 new (lane lint-files)
  static new(conf: Conf): StringPatterns {
    return unported("clippy_lints::string_patterns::StringPatterns::new");
  }

  name(): string {
    return StringPatterns_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return StringPatterns_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return StringPatterns_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for StringPatterns (string_patterns.rs:228)
// stub: src/tools/clippy/clippy_lints/src/string_patterns.rs:229 check_expr (lane lint-files)
StringPatterns.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::string_patterns::StringPatterns::check_expr");
};
