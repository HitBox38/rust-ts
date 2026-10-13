// Stub of compiler/rustc_lint/src/non_local_def.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (non_local_def.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { NonLocalDefinitions_impl_lint_pass } from "./non_local_def.lints.gen.ts";

export * from "./non_local_def.lints.gen.ts";

/** `NonLocalDefinitions` (struct defined in non_local_def.rs; its `impl_lint_pass!` expansion is `NonLocalDefinitions_impl_lint_pass`). PORT: stub. */
export class NonLocalDefinitions implements LintPass {
  name(): string {
    return NonLocalDefinitions_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NonLocalDefinitions_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NonLocalDefinitions_impl_lint_pass.lint_vec();
  }
  static default(): NonLocalDefinitions {
    return unported("rustc_lint::non_local_def::NonLocalDefinitions::default");
  }
}

// impl LateLintPass for NonLocalDefinitions (non_local_def.rs:61)
unported_methods(NonLocalDefinitions.prototype, "rustc_lint::non_local_def::NonLocalDefinitions", ["check_body", "check_body_post", "check_item"]);
