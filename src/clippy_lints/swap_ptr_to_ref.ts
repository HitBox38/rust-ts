// Port of src/tools/clippy/clippy_lints/src/swap_ptr_to_ref.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { SwapPtrToRef_impl_lint_pass } from "./swap_ptr_to_ref.lints.gen.ts";
export * from "./swap_ptr_to_ref.lints.gen.ts";

// ---- SwapPtrToRef (late sub-pass; impl_lint_pass! in swap_ptr_to_ref.rs) ----
export interface SwapPtrToRef extends LateLintPass {}
/** `struct SwapPtrToRef { .. }` (swap_ptr_to_ref.rs:44); its `impl_lint_pass!` expansion is `SwapPtrToRef_impl_lint_pass`. Fields: ported by the fill lane. */
export class SwapPtrToRef implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/swap_ptr_to_ref.rs:49 new (lane lint-files)
  static new(conf: Conf): SwapPtrToRef {
    return unported("clippy_lints::swap_ptr_to_ref::SwapPtrToRef::new");
  }

  name(): string {
    return SwapPtrToRef_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return SwapPtrToRef_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return SwapPtrToRef_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for SwapPtrToRef (swap_ptr_to_ref.rs:54)
// stub: src/tools/clippy/clippy_lints/src/swap_ptr_to_ref.rs:55 check_expr (lane lint-files)
SwapPtrToRef.prototype.check_expr = function (cx, e) {
  unported("clippy_lints::swap_ptr_to_ref::SwapPtrToRef::check_expr");
};
