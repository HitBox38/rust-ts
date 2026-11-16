// Port of src/tools/clippy/clippy_lints/src/manual_noop_waker.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { ManualNoopWaker_impl_lint_pass } from "./manual_noop_waker.lints.gen.ts";
export * from "./manual_noop_waker.lints.gen.ts";

// ---- ManualNoopWaker (late sub-pass; impl_lint_pass! in manual_noop_waker.rs) ----
export interface ManualNoopWaker extends LateLintPass {}
/** `struct ManualNoopWaker { .. }` (manual_noop_waker.rs:41); its `impl_lint_pass!` expansion is `ManualNoopWaker_impl_lint_pass`. Fields: ported by the fill lane. */
export class ManualNoopWaker implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/manual_noop_waker.rs:46 new (lane lint-files)
  static new(conf: Conf): ManualNoopWaker {
    return unported("clippy_lints::manual_noop_waker::ManualNoopWaker::new");
  }

  name(): string {
    return ManualNoopWaker_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ManualNoopWaker_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ManualNoopWaker_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ManualNoopWaker (manual_noop_waker.rs:51)
// stub: src/tools/clippy/clippy_lints/src/manual_noop_waker.rs:52 check_item (lane lint-files)
ManualNoopWaker.prototype.check_item = function (cx, item) {
  unported("clippy_lints::manual_noop_waker::ManualNoopWaker::check_item");
};
