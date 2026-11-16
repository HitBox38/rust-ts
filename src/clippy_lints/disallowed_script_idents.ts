// Port of src/tools/clippy/clippy_lints/src/disallowed_script_idents.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { EarlyLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { DisallowedScriptIdents_impl_lint_pass } from "./disallowed_script_idents.lints.gen.ts";
export * from "./disallowed_script_idents.lints.gen.ts";

// ---- DisallowedScriptIdents (early sub-pass; impl_lint_pass! in disallowed_script_idents.rs) ----
export interface DisallowedScriptIdents extends EarlyLintPass {}
/** `struct DisallowedScriptIdents { .. }` (disallowed_script_idents.rs:49); its `impl_lint_pass!` expansion is `DisallowedScriptIdents_impl_lint_pass`. Fields: ported by the fill lane. */
export class DisallowedScriptIdents implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/disallowed_script_idents.rs:54 new (lane always-running)
  static new(conf: Conf): DisallowedScriptIdents {
    return unported("clippy_lints::disallowed_script_idents::DisallowedScriptIdents::new");
  }

  name(): string {
    return DisallowedScriptIdents_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DisallowedScriptIdents_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DisallowedScriptIdents_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for DisallowedScriptIdents (disallowed_script_idents.rs:66)
// stub: src/tools/clippy/clippy_lints/src/disallowed_script_idents.rs:67 check_crate (lane always-running)
DisallowedScriptIdents.prototype.check_crate = function (cx, _0) {
  unported("clippy_lints::disallowed_script_idents::DisallowedScriptIdents::check_crate");
};
