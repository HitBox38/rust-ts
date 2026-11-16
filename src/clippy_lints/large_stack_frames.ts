// Port of src/tools/clippy/clippy_lints/src/large_stack_frames.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { LargeStackFrames_impl_lint_pass } from "./large_stack_frames.lints.gen.ts";
export * from "./large_stack_frames.lints.gen.ts";

// ---- LargeStackFrames (late sub-pass; impl_lint_pass! in large_stack_frames.rs) ----
export interface LargeStackFrames extends LateLintPass {}
/** `struct LargeStackFrames { .. }` (large_stack_frames.rs:86); its `impl_lint_pass!` expansion is `LargeStackFrames_impl_lint_pass`. Fields: ported by the fill lane. */
export class LargeStackFrames implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/large_stack_frames.rs:92 new (lane lint-files)
  static new(conf: Conf): LargeStackFrames {
    return unported("clippy_lints::large_stack_frames::LargeStackFrames::new");
  }

  name(): string {
    return LargeStackFrames_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return LargeStackFrames_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return LargeStackFrames_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for LargeStackFrames (large_stack_frames.rs:138)
// stub: src/tools/clippy/clippy_lints/src/large_stack_frames.rs:139 check_fn (lane lint-files)
LargeStackFrames.prototype.check_fn = function (cx, fn_kind, _0, _1, entire_fn_span, local_def_id) {
  unported("clippy_lints::large_stack_frames::LargeStackFrames::check_fn");
};
