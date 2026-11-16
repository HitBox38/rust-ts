// Port of src/tools/clippy/clippy_lints/src/non_send_fields_in_send_ty.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { NonSendFieldInSendTy_impl_lint_pass } from "./non_send_fields_in_send_ty.lints.gen.ts";
export * from "./non_send_fields_in_send_ty.lints.gen.ts";

// ---- NonSendFieldInSendTy (late sub-pass; impl_lint_pass! in non_send_fields_in_send_ty.rs) ----
export interface NonSendFieldInSendTy extends LateLintPass {}
/** `struct NonSendFieldInSendTy { .. }` (non_send_fields_in_send_ty.rs:59); its `impl_lint_pass!` expansion is `NonSendFieldInSendTy_impl_lint_pass`. Fields: ported by the fill lane. */
export class NonSendFieldInSendTy implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/non_send_fields_in_send_ty.rs:64 new (lane lint-files)
  static new(conf: Conf): NonSendFieldInSendTy {
    return unported("clippy_lints::non_send_fields_in_send_ty::NonSendFieldInSendTy::new");
  }

  name(): string {
    return NonSendFieldInSendTy_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NonSendFieldInSendTy_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NonSendFieldInSendTy_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for NonSendFieldInSendTy (non_send_fields_in_send_ty.rs:71)
// stub: src/tools/clippy/clippy_lints/src/non_send_fields_in_send_ty.rs:72 check_item (lane lint-files)
NonSendFieldInSendTy.prototype.check_item = function (cx, item) {
  unported("clippy_lints::non_send_fields_in_send_ty::NonSendFieldInSendTy::check_item");
};
