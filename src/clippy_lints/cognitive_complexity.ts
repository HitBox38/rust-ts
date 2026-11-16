// Port of src/tools/clippy/clippy_lints/src/cognitive_complexity.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { CognitiveComplexity_impl_lint_pass } from "./cognitive_complexity.lints.gen.ts";
export * from "./cognitive_complexity.lints.gen.ts";

// ---- CognitiveComplexity (late sub-pass; impl_lint_pass! in cognitive_complexity.rs) ----
export interface CognitiveComplexity extends LateLintPass {}
/** `struct CognitiveComplexity { .. }` (cognitive_complexity.rs:45); its `impl_lint_pass!` expansion is `CognitiveComplexity_impl_lint_pass`. Fields: ported by the fill lane. */
export class CognitiveComplexity implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/cognitive_complexity.rs:50 new (lane always-running)
  static new(conf: Conf): CognitiveComplexity {
    return unported("clippy_lints::cognitive_complexity::CognitiveComplexity::new");
  }

  name(): string {
    return CognitiveComplexity_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return CognitiveComplexity_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return CognitiveComplexity_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for CognitiveComplexity (cognitive_complexity.rs:137)
// stub: src/tools/clippy/clippy_lints/src/cognitive_complexity.rs:138 check_fn (lane always-running)
CognitiveComplexity.prototype.check_fn = function (cx, kind, decl, body, span, def_id) {
  unported("clippy_lints::cognitive_complexity::CognitiveComplexity::check_fn");
};
// stub: src/tools/clippy/clippy_lints/src/cognitive_complexity.rs:164 check_attributes (lane always-running)
CognitiveComplexity.prototype.check_attributes = function (cx, attrs) {
  unported("clippy_lints::cognitive_complexity::CognitiveComplexity::check_attributes");
};
// stub: src/tools/clippy/clippy_lints/src/cognitive_complexity.rs:167 check_attributes_post (lane always-running)
CognitiveComplexity.prototype.check_attributes_post = function (cx, attrs) {
  unported("clippy_lints::cognitive_complexity::CognitiveComplexity::check_attributes_post");
};
