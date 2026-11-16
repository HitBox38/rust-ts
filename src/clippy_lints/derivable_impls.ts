// Port of src/tools/clippy/clippy_lints/src/derivable_impls.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DerivableImpls_impl_lint_pass } from "./derivable_impls.lints.gen.ts";
export * from "./derivable_impls.lints.gen.ts";

// ---- DerivableImpls (late sub-pass; impl_lint_pass! in derivable_impls.rs) ----
export interface DerivableImpls extends LateLintPass {}
/** `struct DerivableImpls { .. }` (derivable_impls.rs:60); its `impl_lint_pass!` expansion is `DerivableImpls_impl_lint_pass`. Fields: ported by the fill lane. */
export class DerivableImpls implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/derivable_impls.rs:65 new (lane lint-files)
  static new(conf: Conf): DerivableImpls {
    return unported("clippy_lints::derivable_impls::DerivableImpls::new");
  }

  name(): string {
    return DerivableImpls_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DerivableImpls_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DerivableImpls_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DerivableImpls (derivable_impls.rs:228)
// stub: src/tools/clippy/clippy_lints/src/derivable_impls.rs:229 check_item (lane lint-files)
DerivableImpls.prototype.check_item = function (cx, item) {
  unported("clippy_lints::derivable_impls::DerivableImpls::check_item");
};
