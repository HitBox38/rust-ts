// Port of compiler/rustc_parse/src/parser/expr/diagnostics.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into diagnostics.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "../mod.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import type { Token } from "../../../rustc_ast/token.ts";
import { unported } from "../../../std/panic.ts";

export * from "./diagnostics.gen.ts";

// pub(crate::parser) fn op_can_continue_stmt_expr_unambiguously(token: &Token) -> bool (expr/diagnostics.rs:301)
export function op_can_continue_stmt_expr_unambiguously(_token: Token): boolean {
  return unported("rustc_parse::parser::expr::diagnostics::op_can_continue_stmt_expr_unambiguously");
}

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::expr::diagnostics::Parser", [
  "recover_from_bin_op_after_complete_stmt_expr",
  "recover_from_alpha_logic_op",
  "reject_dotdotdot_expr_op",
  "reject_larrow_expr_op",
  "recover_from_strict_eq_op",
  "recover_from_diamond_ne_op",
  "recover_from_spaceship_cmp_op",
  "recover_from_postfix_inc_op",
  "recover_from_postfix_dec_op",
  "report_inc_dec_op",
  "recover_from_c_array",
]);
