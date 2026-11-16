// Port of src/tools/clippy/clippy_lints/src/suspicious_operation_groupings.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { SuspiciousOperationGroupings_impl_lint_pass } from "./suspicious_operation_groupings.lints.gen.ts";
export * from "./suspicious_operation_groupings.lints.gen.ts";

// ---- SuspiciousOperationGroupings (early sub-pass; impl_lint_pass! in suspicious_operation_groupings.rs) ----
export interface SuspiciousOperationGroupings extends EarlyLintPass {}
/** `struct SuspiciousOperationGroupings { .. }` (suspicious_operation_groupings.rs:68); its `impl_lint_pass!` expansion is `SuspiciousOperationGroupings_impl_lint_pass`. Fields: ported by the fill lane. */
export class SuspiciousOperationGroupings implements LintPass {
  /** `#[derive(Default)]` */
  static default(): SuspiciousOperationGroupings {
    return unported("clippy_lints::suspicious_operation_groupings::SuspiciousOperationGroupings::default (#[derive(Default)]: the struct's fields are not ported yet)");
  }

  name(): string {
    return SuspiciousOperationGroupings_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return SuspiciousOperationGroupings_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return SuspiciousOperationGroupings_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for SuspiciousOperationGroupings (suspicious_operation_groupings.rs:73)
// stub: src/tools/clippy/clippy_lints/src/suspicious_operation_groupings.rs:74 check_expr (lane always-running)
SuspiciousOperationGroupings.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::suspicious_operation_groupings::SuspiciousOperationGroupings::check_expr");
};
