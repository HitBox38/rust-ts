// Port of src/tools/clippy/clippy_lints/src/inherent_impl.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { MultipleInherentImpl_impl_lint_pass } from "./inherent_impl.lints.gen.ts";
export * from "./inherent_impl.lints.gen.ts";

// ---- MultipleInherentImpl (late sub-pass; impl_lint_pass! in inherent_impl.rs) ----
export interface MultipleInherentImpl extends LateLintPass {}
/** `struct MultipleInherentImpl { .. }` (inherent_impl.rs:51); its `impl_lint_pass!` expansion is `MultipleInherentImpl_impl_lint_pass`. Fields: ported by the fill lane. */
export class MultipleInherentImpl implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/inherent_impl.rs:56 new (lane lint-files)
  static new(conf: Conf): MultipleInherentImpl {
    return unported("clippy_lints::inherent_impl::MultipleInherentImpl::new");
  }

  name(): string {
    return MultipleInherentImpl_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MultipleInherentImpl_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MultipleInherentImpl_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for MultipleInherentImpl (inherent_impl.rs:70)
// stub: src/tools/clippy/clippy_lints/src/inherent_impl.rs:71 check_crate_post (lane lint-files)
MultipleInherentImpl.prototype.check_crate_post = function (cx) {
  unported("clippy_lints::inherent_impl::MultipleInherentImpl::check_crate_post");
};
