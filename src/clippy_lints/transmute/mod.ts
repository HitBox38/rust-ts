// Port of src/tools/clippy/clippy_lints/src/transmute/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Transmute_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Transmute (late sub-pass; impl_lint_pass! in transmute/mod.rs) ----
export interface Transmute extends LateLintPass {}
/** `struct Transmute { .. }` (transmute/mod.rs:490); its `impl_lint_pass!` expansion is `Transmute_impl_lint_pass`. Fields: ported by the fill lane. */
export class Transmute implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/transmute/mod.rs:494 new (lane dispatch)
  static new(conf: Conf): Transmute {
    return unported("clippy_lints::transmute::Transmute::new");
  }

  name(): string {
    return Transmute_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Transmute_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Transmute_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Transmute (transmute/mod.rs:524)
// stub: src/tools/clippy/clippy_lints/src/transmute/mod.rs:525 check_expr (lane dispatch)
Transmute.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::transmute::Transmute::check_expr");
};
