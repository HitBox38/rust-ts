// Port of src/tools/clippy/clippy_lints/src/len_zero.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { LenZero_impl_lint_pass } from "./len_zero.lints.gen.ts";
export * from "./len_zero.lints.gen.ts";

// ---- LenZero (late sub-pass; impl_lint_pass! in len_zero.rs) ----
export interface LenZero extends LateLintPass {}
/** `struct LenZero { .. }` (len_zero.rs:92); its `impl_lint_pass!` expansion is `LenZero_impl_lint_pass`. Fields: ported by the fill lane. */
export class LenZero implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/len_zero.rs:97 new (lane lint-files)
  static new(conf: Conf): LenZero {
    return unported("clippy_lints::len_zero::LenZero::new");
  }

  name(): string {
    return LenZero_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LenZero_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LenZero_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for LenZero (len_zero.rs:102)
// stub: src/tools/clippy/clippy_lints/src/len_zero.rs:103 check_expr (lane lint-files)
LenZero.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::len_zero::LenZero::check_expr");
};
