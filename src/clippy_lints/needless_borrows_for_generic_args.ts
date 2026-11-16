// Port of src/tools/clippy/clippy_lints/src/needless_borrows_for_generic_args.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NeedlessBorrowsForGenericArgs_impl_lint_pass } from "./needless_borrows_for_generic_args.lints.gen.ts";
export * from "./needless_borrows_for_generic_args.lints.gen.ts";

// ---- NeedlessBorrowsForGenericArgs (late sub-pass; impl_lint_pass! in needless_borrows_for_generic_args.rs) ----
export interface NeedlessBorrowsForGenericArgs extends LateLintPass {}
/** `struct NeedlessBorrowsForGenericArgs { .. }` (needless_borrows_for_generic_args.rs:63); its `impl_lint_pass!` expansion is `NeedlessBorrowsForGenericArgs_impl_lint_pass`. Fields: ported by the fill lane. */
export class NeedlessBorrowsForGenericArgs implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/needless_borrows_for_generic_args.rs:73 new (lane lint-files)
  static new(conf: Conf): NeedlessBorrowsForGenericArgs {
    return unported("clippy_lints::needless_borrows_for_generic_args::NeedlessBorrowsForGenericArgs::new");
  }

  name(): string {
    return NeedlessBorrowsForGenericArgs_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NeedlessBorrowsForGenericArgs_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NeedlessBorrowsForGenericArgs_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NeedlessBorrowsForGenericArgs (needless_borrows_for_generic_args.rs:81)
// stub: src/tools/clippy/clippy_lints/src/needless_borrows_for_generic_args.rs:82 check_expr (lane lint-files)
NeedlessBorrowsForGenericArgs.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::needless_borrows_for_generic_args::NeedlessBorrowsForGenericArgs::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/needless_borrows_for_generic_args.rs:137 check_body_post (lane lint-files)
NeedlessBorrowsForGenericArgs.prototype.check_body_post = function (cx, body) {
  unported("clippy_lints::needless_borrows_for_generic_args::NeedlessBorrowsForGenericArgs::check_body_post");
};
