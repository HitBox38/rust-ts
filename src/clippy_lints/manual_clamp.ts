// Port of src/tools/clippy/clippy_lints/src/manual_clamp.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualClamp_impl_lint_pass } from "./manual_clamp.lints.gen.ts";
export * from "./manual_clamp.lints.gen.ts";

// ---- ManualClamp (late sub-pass; impl_lint_pass! in manual_clamp.rs) ----
export interface ManualClamp extends LateLintPass {}
/** `struct ManualClamp { .. }` (manual_clamp.rs:93); its `impl_lint_pass!` expansion is `ManualClamp_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualClamp implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_clamp.rs:98 new (lane lint-files)
  static new(conf: Conf): ManualClamp {
    return unported("clippy_lints::manual_clamp::ManualClamp::new");
  }

  name(): string {
    return ManualClamp_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualClamp_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualClamp_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualClamp (manual_clamp.rs:140)
// stub: src/tools/clippy/clippy_lints/src/manual_clamp.rs:141 check_expr (lane lint-files)
ManualClamp.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_clamp::ManualClamp::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/manual_clamp.rs:162 check_block (lane lint-files)
ManualClamp.prototype.check_block = function (cx, block) {
  unported("clippy_lints::manual_clamp::ManualClamp::check_block");
};
