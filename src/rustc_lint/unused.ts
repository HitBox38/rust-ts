// Stub of compiler/rustc_lint/src/unused.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (unused.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { NodeId } from "../rustc_ast/lib.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { PathStatements, UnusedBraces, UnusedImportBraces, UnusedAllocation, UnusedParens_impl_lint_pass } from "./unused.lints.gen.ts";

export * from "./unused.lints.gen.ts";

/** `UnusedParens` (unused.rs:650; its `impl_lint_pass!` expansion is `UnusedParens_impl_lint_pass`). */
// #[derive(Default)]
export class UnusedParens implements LintPass {
  constructor(
    public with_self_ty_parens: boolean,
    /// `1 as (i32) < 2` parses to ExprKind::Lt
    /// `1 as i32 < 2` parses to i32::<2[missing angle bracket]
    public parens_in_cast_in_lt: NodeId[],
    /// Ty nodes in this map are in TypeNoBounds position. Any bounds they
    /// contain may be ambiguous w/r/t trailing `+` operators.
    // PORT: `NoBoundsException` (unused.rs) is not ported yet (lane lint-early-b).
    public in_no_bounds_pos: Map<NodeId, unknown>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): UnusedParens {
    return new UnusedParens(false, [], new Map());
  }

  name(): string {
    return UnusedParens_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnusedParens_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnusedParens_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for PathStatements (unused.rs:42)
unported_methods(PathStatements.prototype, "rustc_lint::unused::PathStatements", ["check_stmt"]);
// impl EarlyLintPass for UnusedParens (unused.rs:813)
unported_methods(UnusedParens.prototype, "rustc_lint::unused::UnusedParens", ["check_expr", "check_expr_post", "check_pat", "check_stmt", "check_param", "check_arm", "check_ty", "check_item", "check_item_post", "check_where_predicate", "check_where_predicate_post"]);
// impl EarlyLintPass for UnusedBraces (unused.rs:1224)
unported_methods(UnusedBraces.prototype, "rustc_lint::unused::UnusedBraces", ["check_stmt", "check_expr", "check_generic_arg", "check_variant", "check_ty", "check_item"]);
// impl EarlyLintPass for UnusedImportBraces (unused.rs:1362)
unported_methods(UnusedImportBraces.prototype, "rustc_lint::unused::UnusedImportBraces", ["check_item"]);
// impl LateLintPass for UnusedAllocation (unused.rs:1396)
unported_methods(UnusedAllocation.prototype, "rustc_lint::unused::UnusedAllocation", ["check_expr"]);
