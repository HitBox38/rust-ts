// Port of src/tools/clippy/clippy_lints/src/bit_width.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualBitWidth_impl_lint_pass } from "./bit_width.lints.gen.ts";
export * from "./bit_width.lints.gen.ts";

// ---- ManualBitWidth (late sub-pass; impl_lint_pass! in bit_width.rs) ----
export interface ManualBitWidth extends LateLintPass {}
/** `struct ManualBitWidth { .. }` (bit_width.rs:89); its `impl_lint_pass!` expansion is `ManualBitWidth_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualBitWidth implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/bit_width.rs:94 new (lane lint-files)
  static new(conf: Conf): ManualBitWidth {
    return unported("clippy_lints::bit_width::ManualBitWidth::new");
  }

  name(): string {
    return ManualBitWidth_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualBitWidth_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualBitWidth_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualBitWidth (bit_width.rs:99)
// stub: src/tools/clippy/clippy_lints/src/bit_width.rs:100 check_expr (lane lint-files)
ManualBitWidth.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::bit_width::ManualBitWidth::check_expr");
};
