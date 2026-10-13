// Port of compiler/rustc_parse/src/parser/stmt.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - (this file defines no types);
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";


// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::stmt::Parser", [
  "parse_stmt_nonterminal",
  "parse_stmt_without_recovery",
  "parse_stmt_path_start",
  "parse_stmt_mac",
  "error_outer_attrs",
  "recover_stmt_local_after_let",
  "parse_local",
  "check_let_else_init_bool_expr",
  "check_let_else_init_trailing_brace",
  "parse_initializer",
  "parse_block",
  "error_block_no_opening_brace_msg",
  "suggest_fixes_misparsed_for_loop_head",
  "error_block_no_opening_brace",
  "parse_inner_attrs_and_block",
  "parse_block_common",
  "parse_block_tail",
  "recover_missing_let_else",
  "recover_missing_dot",
  "try_recover_let_missing_semi",
  "parse_full_stmt",
  "mk_block",
  "mk_stmt",
  "mk_stmt_err",
  "mk_block_err",
]);
