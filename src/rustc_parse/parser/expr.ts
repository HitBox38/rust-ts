// Port of compiler/rustc_parse/src/parser/expr.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into expr.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { MetaItemLit } from "../../rustc_ast/lib.ts";
import type { Lit } from "../../rustc_ast/token.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";

export * from "./expr.gen.ts";

/// PORT: `std::ops::Bound<T>` (used by `parse_expr_assoc_with`); belongs in src/std (root).
export type Bound<T> = { readonly $: "Included"; _0: T } | { readonly $: "Excluded"; _0: T } | { readonly $: "Unbounded" };

// Parser::mk_token_lit_char (expr.rs:1957), an associated fn without `self`.
export function mk_token_lit_char(_name: Symbol, _span: Span): [Lit, Span] {
  return unported("rustc_parse::parser::expr::Parser::mk_token_lit_char");
}

// Parser::mk_meta_item_lit_char (expr.rs:1961), an associated fn without `self`.
export function mk_meta_item_lit_char(_name: Symbol, _span: Span): MetaItemLit {
  return unported("rustc_parse::parser::expr::Parser::mk_meta_item_lit_char");
}

// pub(crate) fn could_be_unclosed_char_literal(ident: Ident) -> bool (expr.rs:4080)
export function could_be_unclosed_char_literal(_ident: import("../../rustc_span/symbol.ts").Ident): boolean {
  return unported("rustc_parse::parser::expr::could_be_unclosed_char_literal");
}

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::expr::Parser", [
  "parse_expr",
  "parse_expr_in_let",
  "parse_expr_force_collect",
  "parse_expr_anon_const",
  "parse_expr_paren_seq",
  "parse_expr_res",
  "parse_expr_res_after_attrs",
  "parse_expr_assoc",
  "parse_expr_assoc_after_attrs",
  "parse_expr_assoc_rest",
  "check_assoc_op",
  "expr_is_complete",
  "parse_expr_range",
  "is_at_start_of_range_notation_rhs",
  "parse_expr_prefix_range",
  "parse_expr_prefix",
  "parse_expr_prefix_common",
  "parse_expr_unary",
  "recover_tilde_expr",
  "parse_expr_move",
  "is_mistaken_not_ident_negation",
  "recover_not_expr",
  "interpolated_or_expr_span",
  "parse_assoc_op_cast",
  "parse_expr_borrow",
  "error_remove_borrow_lifetime",
  "parse_borrow_modifiers",
  "parse_expr_dot_or_call",
  "parse_expr_dot_or_call_with",
  "parse_dot_suffix_expr",
  "error_unexpected_after_dot",
  "break_up_float",
  "parse_floating_field_access",
  "mk_expr_tuple_field_access",
  "parse_expr_fn_call",
  "recover_raw_ref_call_args",
  "maybe_recover_struct_lit_bad_delims",
  "parse_expr_index",
  "parse_dot_suffix",
  "parse_expr_bottom",
  "parse_expr_lit",
  "parse_expr_tuple_parens",
  "parse_expr_array_or_repeat",
  "parse_expr_path_start",
  "parse_expr_labeled",
  "recover_unclosed_char",
  "recover_do_catch",
  "parse_expr_opt",
  "parse_expr_return",
  "parse_expr_yeet",
  "parse_expr_become",
  "parse_expr_break",
  "parse_expr_continue",
  "parse_expr_yield",
  "parse_expr_builtin",
  "parse_builtin",
  "parse_expr_offset_of",
  "parse_expr_type_ascribe",
  "parse_expr_unsafe_binder_cast",
  "parse_str_lit",
  "handle_missing_lit",
  "parse_token_lit",
  "parse_meta_item_lit",
  "recover_after_dot",
  "eat_token_lit",
  "parse_opt_token_lit",
  "parse_opt_meta_item_lit",
  "parse_literal_maybe_minus",
  "suggest_missing_semicolon_before_array",
  "parse_expr_block",
  "parse_simple_block",
  "parse_expr_closure",
  "parse_closure_block_body",
  "parse_capture_clause",
  "parse_fn_block_decl",
  "parse_fn_block_param",
  "parse_expr_if",
  "parse_if_after_cond",
  "parse_expr_cond",
  "parse_expr_let",
  "parse_expr_else",
  "error_on_if_block_attrs",
  "error_on_extra_if",
  "parse_for_head",
  "parse_expr_for",
  "recover_loop_else",
  "error_missing_in_for_loop",
  "for_loop_head_has_in",
  "parse_expr_while",
  "parse_expr_loop",
  "eat_label",
  "parse_expr_match",
  "parse_match_block",
  "parse_arm_body_missing_braces",
  "parse_arm",
  "eat_metavar_guard",
  "parse_match_arm_guard",
  "expect_match_arm_guard",
  "expect_match_arm_guard_cond",
  "parse_match_arm_pat_and_guard",
  "parse_match_guard_condition",
  "is_builtin",
  "parse_try_block",
  "is_do_catch_block",
  "is_do_yeet",
  "is_try_block",
  "parse_gen_block",
  "is_gen_block",
  "is_async_gen_block",
  "is_likely_struct_lit",
  "maybe_parse_struct_expr",
  "maybe_recover_bad_struct_literal_path",
  "parse_struct_fields",
  "parse_expr_struct",
  "recover_struct_comma_after_dotdot",
  "recover_struct_field_dots",
  "recover_ident_into_label",
  "parse_expr_field",
  "error_on_eq_field_init",
  "mk_assign_op",
  "mk_range",
  "mk_unary",
  "mk_binary",
  "mk_index",
  "mk_call",
  "mk_await_expr",
  "mk_use_expr",
  "mk_expr_with_attrs",
  "mk_expr",
  "mk_expr_err",
  "mk_unit_expr",
  "mk_closure_expr",
  "mk_expr_sp",
  "collect_tokens_for_expr",
]);
