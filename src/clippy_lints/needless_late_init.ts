// Port of src/tools/clippy/clippy_lints/src/needless_late_init.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NeedlessLateInit_impl_lint_pass } from "./needless_late_init.lints.gen.ts";
export * from "./needless_late_init.lints.gen.ts";

// ---- NeedlessLateInit (late sub-pass; impl_lint_pass! in needless_late_init.rs) ----
export interface NeedlessLateInit extends LateLintPass {}
/** `struct NeedlessLateInit { .. }` (needless_late_init.rs:68); its `impl_lint_pass!` expansion is `NeedlessLateInit_impl_lint_pass`. Fields: ported by the fill lane. */
export class NeedlessLateInit implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/needless_late_init.rs:74 new (lane lint-files)
  static new(conf: Conf): NeedlessLateInit {
    return unported("clippy_lints::needless_late_init::NeedlessLateInit::new");
  }

  name(): string {
    return NeedlessLateInit_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NeedlessLateInit_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NeedlessLateInit_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NeedlessLateInit (needless_late_init.rs:363)
// stub: src/tools/clippy/clippy_lints/src/needless_late_init.rs:364 check_local (lane lint-files)
NeedlessLateInit.prototype.check_local = function (cx, local) {
  unported("clippy_lints::needless_late_init::NeedlessLateInit::check_local");
};
// stub: src/tools/clippy/clippy_lints/src/needless_late_init.rs:446 check_block_post (lane lint-files)
NeedlessLateInit.prototype.check_block_post = function (cx, block) {
  unported("clippy_lints::needless_late_init::NeedlessLateInit::check_block_post");
};
