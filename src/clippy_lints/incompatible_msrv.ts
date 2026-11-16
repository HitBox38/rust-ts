// Port of src/tools/clippy/clippy_lints/src/incompatible_msrv.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { IncompatibleMsrv_impl_lint_pass } from "./incompatible_msrv.lints.gen.ts";
export * from "./incompatible_msrv.lints.gen.ts";

// ---- IncompatibleMsrv (late sub-pass; impl_lint_pass! in incompatible_msrv.rs) ----
export interface IncompatibleMsrv extends LateLintPass {}
/** `struct IncompatibleMsrv { .. }` (incompatible_msrv.rs:107); its `impl_lint_pass!` expansion is `IncompatibleMsrv_impl_lint_pass`. Fields: ported by the fill lane. */
export class IncompatibleMsrv implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/incompatible_msrv.rs:119 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): IncompatibleMsrv {
    return unported("clippy_lints::incompatible_msrv::IncompatibleMsrv::new");
  }

  name(): string {
    return IncompatibleMsrv_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return IncompatibleMsrv_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return IncompatibleMsrv_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for IncompatibleMsrv (incompatible_msrv.rs:220)
// stub: src/tools/clippy/clippy_lints/src/incompatible_msrv.rs:221 check_expr (lane lint-files)
IncompatibleMsrv.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::incompatible_msrv::IncompatibleMsrv::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/incompatible_msrv.rs:257 check_ty (lane lint-files)
IncompatibleMsrv.prototype.check_ty = function (cx, hir_ty) {
  unported("clippy_lints::incompatible_msrv::IncompatibleMsrv::check_ty");
};
