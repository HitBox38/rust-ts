// Stub of compiler/rustc_lint/src/shadowed_into_iter.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (shadowed_into_iter.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { ShadowedIntoIter_impl_lint_pass } from "./shadowed_into_iter.lints.gen.ts";

export * from "./shadowed_into_iter.lints.gen.ts";

/** `ShadowedIntoIter` (struct defined in shadowed_into_iter.rs; its `impl_lint_pass!` expansion is `ShadowedIntoIter_impl_lint_pass`). PORT: stub. */
export class ShadowedIntoIter implements LintPass {
  name(): string {
    return ShadowedIntoIter_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ShadowedIntoIter_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ShadowedIntoIter_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for ShadowedIntoIter (shadowed_into_iter.rs:70)
unported_methods(ShadowedIntoIter.prototype, "rustc_lint::shadowed_into_iter::ShadowedIntoIter", ["check_expr"]);
