// Stub of compiler/rustc_lint/src/transmute.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (transmute.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { CheckTransmutes_impl_lint_pass } from "./transmute.lints.gen.ts";

export * from "./transmute.lints.gen.ts";

/** `CheckTransmutes` (struct defined in transmute.rs; its `impl_lint_pass!` expansion is `CheckTransmutes_impl_lint_pass`). PORT: stub. */
export class CheckTransmutes implements LintPass {
  name(): string {
    return CheckTransmutes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return CheckTransmutes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return CheckTransmutes_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for CheckTransmutes (transmute.rs:114)
unported_methods(CheckTransmutes.prototype, "rustc_lint::transmute::CheckTransmutes", ["check_expr"]);
