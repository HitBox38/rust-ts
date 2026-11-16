// Port of src/tools/clippy/clippy_lints/src/excessive_nesting.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ExcessiveNesting_impl_lint_pass } from "./excessive_nesting.lints.gen.ts";
export * from "./excessive_nesting.lints.gen.ts";

// ---- ExcessiveNesting (early sub-pass; impl_lint_pass! in excessive_nesting.rs) ----
export interface ExcessiveNesting extends EarlyLintPass {}
/** `struct ExcessiveNesting { .. }` (excessive_nesting.rs:66); its `impl_lint_pass!` expansion is `ExcessiveNesting_impl_lint_pass`. Fields: ported by the fill lane. */
export class ExcessiveNesting implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/excessive_nesting.rs:72 new (lane always-running)
  static new(conf: Conf): ExcessiveNesting {
    return unported("clippy_lints::excessive_nesting::ExcessiveNesting::new");
  }

  name(): string {
    return ExcessiveNesting_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ExcessiveNesting_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ExcessiveNesting_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for ExcessiveNesting (excessive_nesting.rs:93)
// stub: src/tools/clippy/clippy_lints/src/excessive_nesting.rs:94 check_crate (lane always-running)
ExcessiveNesting.prototype.check_crate = function (cx, krate) {
  unported("clippy_lints::excessive_nesting::ExcessiveNesting::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/excessive_nesting.rs:110 check_block (lane always-running)
ExcessiveNesting.prototype.check_block = function (cx, block) {
  unported("clippy_lints::excessive_nesting::ExcessiveNesting::check_block");
};
// stub: src/tools/clippy/clippy_lints/src/excessive_nesting.rs:114 check_item (lane always-running)
ExcessiveNesting.prototype.check_item = function (cx, item) {
  unported("clippy_lints::excessive_nesting::ExcessiveNesting::check_item");
};
