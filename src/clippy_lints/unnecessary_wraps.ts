// Port of src/tools/clippy/clippy_lints/src/unnecessary_wraps.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { UnnecessaryWraps_impl_lint_pass } from "./unnecessary_wraps.lints.gen.ts";
export * from "./unnecessary_wraps.lints.gen.ts";

// ---- UnnecessaryWraps (late sub-pass; impl_lint_pass! in unnecessary_wraps.rs) ----
export interface UnnecessaryWraps extends LateLintPass {}
/** `struct UnnecessaryWraps { .. }` (unnecessary_wraps.rs:64); its `impl_lint_pass!` expansion is `UnnecessaryWraps_impl_lint_pass`. Fields: ported by the fill lane. */
export class UnnecessaryWraps implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/unnecessary_wraps.rs:69 new (lane lint-files)
  static new(conf: Conf): UnnecessaryWraps {
    return unported("clippy_lints::unnecessary_wraps::UnnecessaryWraps::new");
  }

  name(): string {
    return UnnecessaryWraps_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnnecessaryWraps_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnnecessaryWraps_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for UnnecessaryWraps (unnecessary_wraps.rs:76)
// stub: src/tools/clippy/clippy_lints/src/unnecessary_wraps.rs:77 check_fn (lane lint-files)
UnnecessaryWraps.prototype.check_fn = function (cx, fn_kind, fn_decl, body, _span, def_id) {
  unported("clippy_lints::unnecessary_wraps::UnnecessaryWraps::check_fn");
};
