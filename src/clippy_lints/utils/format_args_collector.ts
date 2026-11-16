// Port of src/tools/clippy/clippy_lints/src/utils/format_args_collector.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names,
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { FormatArgsStorage } from "../../clippy_utils/macros.ts";
import type { EarlyLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { FormatArgsCollector_impl_lint_pass } from "./format_args_collector.lints.gen.ts";
export * from "./format_args_collector.lints.gen.ts";

// ---- FormatArgsCollector (early sub-pass; impl_lint_pass! in utils/format_args_collector.rs) ----
export interface FormatArgsCollector extends EarlyLintPass {}
/** `struct FormatArgsCollector { .. }` (utils/format_args_collector.rs:12); its `impl_lint_pass!` expansion is `FormatArgsCollector_impl_lint_pass`. Fields: ported by the fill lane. */
export class FormatArgsCollector implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/utils/format_args_collector.rs:19 new (lane always-running)
  static new(storage: FormatArgsStorage): FormatArgsCollector {
    return unported("clippy_lints::utils::format_args_collector::FormatArgsCollector::new");
  }

  name(): string {
    return FormatArgsCollector_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return FormatArgsCollector_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return FormatArgsCollector_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for FormatArgsCollector (utils/format_args_collector.rs:30)
// stub: src/tools/clippy/clippy_lints/src/utils/format_args_collector.rs:31 check_expr (lane always-running)
FormatArgsCollector.prototype.check_expr = function (cx, expr) {
  unported("clippy_lints::utils::format_args_collector::FormatArgsCollector::check_expr");
};
// stub: src/tools/clippy/clippy_lints/src/utils/format_args_collector.rs:41 check_crate_post (lane always-running)
FormatArgsCollector.prototype.check_crate_post = function (_0, _1) {
  unported("clippy_lints::utils::format_args_collector::FormatArgsCollector::check_crate_post");
};
