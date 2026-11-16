// Port of src/tools/clippy/clippy_lints/src/manual_hash_one.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualHashOne_impl_lint_pass } from "./manual_hash_one.lints.gen.ts";
export * from "./manual_hash_one.lints.gen.ts";

// ---- ManualHashOne (late sub-pass; impl_lint_pass! in manual_hash_one.rs) ----
export interface ManualHashOne extends LateLintPass {}
/** `struct ManualHashOne { .. }` (manual_hash_one.rs:51); its `impl_lint_pass!` expansion is `ManualHashOne_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualHashOne implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_hash_one.rs:56 new (lane lint-files)
  static new(conf: Conf): ManualHashOne {
    return unported("clippy_lints::manual_hash_one::ManualHashOne::new");
  }

  name(): string {
    return ManualHashOne_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualHashOne_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualHashOne_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualHashOne (manual_hash_one.rs:61)
// stub: src/tools/clippy/clippy_lints/src/manual_hash_one.rs:62 check_local (lane lint-files)
ManualHashOne.prototype.check_local = function (cx, local) {
  unported("clippy_lints::manual_hash_one::ManualHashOne::check_local");
};
