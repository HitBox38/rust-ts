// Port of src/tools/clippy/clippy_lints/src/unwrap.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { Unwrap_impl_lint_pass } from "./unwrap.lints.gen.ts";
export * from "./unwrap.lints.gen.ts";

// ---- Unwrap (late sub-pass; impl_lint_pass! in unwrap.rs) ----
export interface Unwrap extends LateLintPass {}
/** `struct Unwrap { .. }` (unwrap.rs:84); its `impl_lint_pass!` expansion is `Unwrap_impl_lint_pass`. Fields: ported by the fill lane. */
export class Unwrap implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unwrap.rs:89 new (lane lint-files)
  static new(conf: Conf): Unwrap {
    return unported("clippy_lints::unwrap::Unwrap::new");
  }

  name(): string {
    return Unwrap_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Unwrap_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Unwrap_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Unwrap (unwrap.rs:521)
// stub: src/tools/clippy/clippy_lints/src/unwrap.rs:522 check_fn (lane lint-files)
Unwrap.prototype.check_fn = function (cx, kind, decl, body, span, fn_id) {
  unported("clippy_lints::unwrap::Unwrap::check_fn");
};
