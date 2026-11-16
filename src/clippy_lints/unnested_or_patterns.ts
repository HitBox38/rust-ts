// Port of src/tools/clippy/clippy_lints/src/unnested_or_patterns.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnnestedOrPatterns_impl_lint_pass } from "./unnested_or_patterns.lints.gen.ts";
export * from "./unnested_or_patterns.lints.gen.ts";

// ---- UnnestedOrPatterns (early sub-pass; impl_lint_pass! in unnested_or_patterns.rs) ----
export interface UnnestedOrPatterns extends EarlyLintPass {}
/** `struct UnnestedOrPatterns { .. }` (unnested_or_patterns.rs:52); its `impl_lint_pass!` expansion is `UnnestedOrPatterns_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnnestedOrPatterns implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unnested_or_patterns.rs:57 new (lane always-running)
  static new(conf: Conf): UnnestedOrPatterns {
    return unported("clippy_lints::unnested_or_patterns::UnnestedOrPatterns::new");
  }

  name(): string {
    return UnnestedOrPatterns_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnnestedOrPatterns_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnnestedOrPatterns_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for UnnestedOrPatterns (unnested_or_patterns.rs:62)
// stub: src/tools/clippy/clippy_lints/src/unnested_or_patterns.rs:63 check_arm (lane always-running)
UnnestedOrPatterns.prototype.check_arm = function (cx, a) {
  unported("clippy_lints::unnested_or_patterns::UnnestedOrPatterns::check_arm");
};
// stub: src/tools/clippy/clippy_lints/src/unnested_or_patterns.rs:69 check_expr (lane always-running)
UnnestedOrPatterns.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::unnested_or_patterns::UnnestedOrPatterns::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/unnested_or_patterns.rs:77 check_param (lane always-running)
UnnestedOrPatterns.prototype.check_param = function (cx, p) {
  unported("clippy_lints::unnested_or_patterns::UnnestedOrPatterns::check_param");
};
// stub: src/tools/clippy/clippy_lints/src/unnested_or_patterns.rs:83 check_local (lane always-running)
UnnestedOrPatterns.prototype.check_local = function (cx, l) {
  unported("clippy_lints::unnested_or_patterns::UnnestedOrPatterns::check_local");
};
