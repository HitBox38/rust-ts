// Port of src/tools/clippy/clippy_lints/src/ranges.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { Ranges_impl_lint_pass } from "./ranges.lints.gen.ts";
export * from "./ranges.lints.gen.ts";

// ---- Ranges (late sub-pass; impl_lint_pass! in ranges.rs) ----
export interface Ranges extends LateLintPass {}
/** `struct Ranges { .. }` (ranges.rs:181); its `impl_lint_pass!` expansion is `Ranges_impl_lint_pass`. Fields: ported by the fill lane. */
export class Ranges implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/ranges.rs:186 new (lane lint-files)
  static new(conf: Conf): Ranges {
    return unported("clippy_lints::ranges::Ranges::new");
  }

  name(): string {
    return Ranges_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Ranges_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Ranges_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Ranges (ranges.rs:191)
// stub: src/tools/clippy/clippy_lints/src/ranges.rs:192 check_expr (lane lint-files)
Ranges.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::ranges::Ranges::check_expr");
};
