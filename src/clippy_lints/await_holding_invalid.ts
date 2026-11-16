// Port of src/tools/clippy/clippy_lints/src/await_holding_invalid.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../clippy_config/lib.ts";
import type { LateLintPass } from "../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import { AwaitHolding_impl_lint_pass } from "./await_holding_invalid.lints.gen.ts";
export * from "./await_holding_invalid.lints.gen.ts";

// ---- AwaitHolding (late sub-pass; impl_lint_pass! in await_holding_invalid.rs) ----
export interface AwaitHolding extends LateLintPass {}
/** `struct AwaitHolding { .. }` (await_holding_invalid.rs:180); its `impl_lint_pass!` expansion is `AwaitHolding_impl_lint_pass`. Fields: ported by the fill lane. */
export class AwaitHolding implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/await_holding_invalid.rs:185 new (lane lint-files)
  static new(tcx: TyCtxt, conf: Conf): AwaitHolding {
    return unported("clippy_lints::await_holding_invalid::AwaitHolding::new");
  }

  name(): string {
    return AwaitHolding_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return AwaitHolding_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return AwaitHolding_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for AwaitHolding (await_holding_invalid.rs:198)
// stub: src/tools/clippy/clippy_lints/src/await_holding_invalid.rs:199 check_expr (lane lint-files)
AwaitHolding.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::await_holding_invalid::AwaitHolding::check_expr");
};
