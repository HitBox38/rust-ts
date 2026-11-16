// Port of src/tools/clippy/clippy_lints/src/matches/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Matches_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- Matches (late sub-pass; impl_lint_pass! in matches/mod.rs) ----
export interface Matches extends LateLintPass {}
/** `struct Matches { .. }` (matches/mod.rs:1039); its `impl_lint_pass!` expansion is `Matches_impl_lint_pass`. Fields: ported by the fill lane. */
export class Matches implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/matches/mod.rs:1045 new (lane dispatch)
  static new(conf: Conf): Matches {
    return unported("clippy_lints::matches::Matches::new");
  }

  name(): string {
    return Matches_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Matches_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Matches_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Matches (matches/mod.rs:1053)
// stub: src/tools/clippy/clippy_lints/src/matches/mod.rs:1055 check_expr (lane dispatch)
Matches.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::matches::Matches::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/matches/mod.rs:1229 check_local (lane dispatch)
Matches.prototype.check_local = function (cx, local) {
  unported("clippy_lints::matches::Matches::check_local");
};
// stub: src/tools/clippy/clippy_lints/src/matches/mod.rs:1234 check_pat (lane dispatch)
Matches.prototype.check_pat = function (cx, pat) {
  unported("clippy_lints::matches::Matches::check_pat");
};
