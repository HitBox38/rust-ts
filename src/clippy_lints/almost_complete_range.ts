// Port of src/tools/clippy/clippy_lints/src/almost_complete_range.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { AlmostCompleteRange_impl_lint_pass } from "./almost_complete_range.lints.gen.ts";
export * from "./almost_complete_range.lints.gen.ts";

// ---- AlmostCompleteRange (early sub-pass; impl_lint_pass! in almost_complete_range.rs) ----
export interface AlmostCompleteRange extends EarlyLintPass {}
/** `struct AlmostCompleteRange { .. }` (almost_complete_range.rs:33); its `impl_lint_pass!` expansion is `AlmostCompleteRange_impl_lint_pass`. Fields: ported by the fill lane. */
export class AlmostCompleteRange implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/almost_complete_range.rs:37 new (lane always-running)
  static new(conf: Conf): AlmostCompleteRange {
    return unported("clippy_lints::almost_complete_range::AlmostCompleteRange::new");
  }

  name(): string {
    return AlmostCompleteRange_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return AlmostCompleteRange_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return AlmostCompleteRange_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for AlmostCompleteRange (almost_complete_range.rs:41)
// stub: src/tools/clippy/clippy_lints/src/almost_complete_range.rs:42 check_expr (lane always-running)
AlmostCompleteRange.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::almost_complete_range::AlmostCompleteRange::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/almost_complete_range.rs:70 check_pat (lane always-running)
AlmostCompleteRange.prototype.check_pat = function (cx, p) {
  unported("clippy_lints::almost_complete_range::AlmostCompleteRange::check_pat");
};
