// Stub of compiler/rustc_lint/src/if_let_rescope.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (if_let_rescope.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { IfLetRescope_impl_lint_pass } from "./if_let_rescope.lints.gen.ts";

export * from "./if_let_rescope.lints.gen.ts";

/** `IfLetRescope` (struct defined in if_let_rescope.rs; its `impl_lint_pass!` expansion is `IfLetRescope_impl_lint_pass`). PORT: stub. */
export class IfLetRescope implements LintPass {
  name(): string {
    return IfLetRescope_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return IfLetRescope_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return IfLetRescope_impl_lint_pass.lint_vec();
  }
  static default(): IfLetRescope {
    return unported("rustc_lint::if_let_rescope::IfLetRescope::default");
  }
}

// impl LateLintPass for IfLetRescope (if_let_rescope.rs:268)
unported_methods(IfLetRescope.prototype, "rustc_lint::if_let_rescope::IfLetRescope", ["check_expr"]);
