// Port of src/tools/clippy/clippy_lints/src/casts/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Casts_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Casts (late sub-pass; impl_lint_pass! in casts/mod.rs) ----
export interface Casts extends LateLintPass {}
/** `struct Casts { .. }` (casts/mod.rs:879); its `impl_lint_pass!` expansion is `Casts_impl_lint_pass`. Fields: ported by the fill lane. */
export class Casts implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/casts/mod.rs:884 new (lane dispatch)
  static new(conf: Conf): Casts {
    return unported("clippy_lints::casts::Casts::new");
  }

  name(): string {
    return Casts_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Casts_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Casts_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Casts (casts/mod.rs:889)
// stub: src/tools/clippy/clippy_lints/src/casts/mod.rs:890 check_expr (lane dispatch)
Casts.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::casts::Casts::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/casts/mod.rs:956 check_body (lane dispatch)
Casts.prototype.check_body = function (cx, body) {
  unported("clippy_lints::casts::Casts::check_body");
};
