// Stub of compiler/rustc_lint/src/dangling.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (dangling.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { DanglingPointers_impl_lint_pass } from "./dangling.lints.gen.ts";

export * from "./dangling.lints.gen.ts";

/** `DanglingPointers` (struct defined in dangling.rs; its `impl_lint_pass!` expansion is `DanglingPointers_impl_lint_pass`). PORT: stub. */
export class DanglingPointers implements LintPass {
  name(): string {
    return DanglingPointers_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DanglingPointers_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DanglingPointers_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for DanglingPointers (dangling.rs:91)
unported_methods(DanglingPointers.prototype, "rustc_lint::dangling::DanglingPointers", ["check_fn"]);
