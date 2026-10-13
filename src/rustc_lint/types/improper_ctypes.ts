// Stub of compiler/rustc_lint/src/types/improper_ctypes.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (improper_ctypes.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { ImproperCTypesLint_impl_lint_pass } from "./improper_ctypes.lints.gen.ts";

export * from "./improper_ctypes.lints.gen.ts";

/** `ImproperCTypesLint` (struct defined in types/improper_ctypes.rs; its `impl_lint_pass!` expansion is `ImproperCTypesLint_impl_lint_pass`). PORT: stub. */
export class ImproperCTypesLint implements LintPass {
  name(): string {
    return ImproperCTypesLint_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ImproperCTypesLint_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ImproperCTypesLint_impl_lint_pass.lint_vec();
  }
  static default(): ImproperCTypesLint {
    return unported("rustc_lint::types::improper_ctypes::ImproperCTypesLint::default");
  }
}

// impl LateLintPass for ImproperCTypesLint (types/improper_ctypes.rs:1245)
unported_methods(ImproperCTypesLint.prototype, "rustc_lint::types::improper_ctypes::ImproperCTypesLint", ["check_foreign_item", "check_item", "check_field_def", "check_fn"]);
