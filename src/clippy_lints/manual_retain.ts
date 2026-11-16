// Port of src/tools/clippy/clippy_lints/src/manual_retain.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualRetain_impl_lint_pass } from "./manual_retain.lints.gen.ts";
export * from "./manual_retain.lints.gen.ts";

// ---- ManualRetain (late sub-pass; impl_lint_pass! in manual_retain.rs) ----
export interface ManualRetain extends LateLintPass {}
/** `struct ManualRetain { .. }` (manual_retain.rs:49); its `impl_lint_pass!` expansion is `ManualRetain_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualRetain implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_retain.rs:54 new (lane lint-files)
  static new(conf: Conf): ManualRetain {
    return unported("clippy_lints::manual_retain::ManualRetain::new");
  }

  name(): string {
    return ManualRetain_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualRetain_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualRetain_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualRetain (manual_retain.rs:59)
// stub: src/tools/clippy/clippy_lints/src/manual_retain.rs:60 check_expr (lane lint-files)
ManualRetain.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::manual_retain::ManualRetain::check_expr");
};
