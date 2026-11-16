// Port of src/tools/clippy/clippy_lints/src/strlen_on_c_strings.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { StrlenOnCStrings_impl_lint_pass } from "./strlen_on_c_strings.lints.gen.ts";
export * from "./strlen_on_c_strings.lints.gen.ts";

// ---- StrlenOnCStrings (late sub-pass; impl_lint_pass! in strlen_on_c_strings.rs) ----
export interface StrlenOnCStrings extends LateLintPass {}
/** `struct StrlenOnCStrings { .. }` (strlen_on_c_strings.rs:42); its `impl_lint_pass!` expansion is `StrlenOnCStrings_impl_lint_pass`. Fields: ported by the fill lane. */
export class StrlenOnCStrings implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/strlen_on_c_strings.rs:47 new (lane lint-files)
  static new(conf: Conf): StrlenOnCStrings {
    return unported("clippy_lints::strlen_on_c_strings::StrlenOnCStrings::new");
  }

  name(): string {
    return StrlenOnCStrings_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return StrlenOnCStrings_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return StrlenOnCStrings_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for StrlenOnCStrings (strlen_on_c_strings.rs:52)
// stub: src/tools/clippy/clippy_lints/src/strlen_on_c_strings.rs:53 check_expr (lane lint-files)
StrlenOnCStrings.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::strlen_on_c_strings::StrlenOnCStrings::check_expr");
};
