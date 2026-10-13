// Port of compiler/rustc_parse/src/parser/pat.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into pat.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Pat } from "../../rustc_ast/lib.ts";
import * as gen from "./pat.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./pat.gen.ts";

export type Expected = gen.Expected;
export const Expected = {
  ...gen.Expected,
  // fn to_string_or_fallback(expected: Option<Expected>) -> &'static str (pat.rs:43)
  to_string_or_fallback(_expected: Expected | undefined): string {
    return unported("rustc_parse::parser::pat::Expected::to_string_or_fallback");
  },
};

// Parser::make_all_value_bindings_mutable (pat.rs:1271), an associated fn without `self`.
export function make_all_value_bindings_mutable(_pat: Pat): boolean {
  return unported("rustc_parse::parser::pat::Parser::make_all_value_bindings_mutable");
}

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::pat::Parser", [
  "parse_pat_allow_top_guard",
  "parse_pat_no_top_alt",
  "parse_pat_no_top_guard",
  "parse_pat_no_top_guard_inner",
  "parse_pat_before_ty",
  "parse_fn_param_pat_colon",
  "eat_or_separator",
  "recover_trailing_vert",
  "maybe_recover_trailing_expr",
  "maybe_augment_stashed_expr_in_pats_with_suggestions",
  "eat_metavar_pat",
  "parse_pat_with_range_pat",
  "recover_dotdotdot_rest_pat",
  "recover_intersection_pat",
  "ban_pat_range_if_ambiguous",
  "parse_pat_deref",
  "parse_pat_tuple_or_parens",
  "recover_tuple_pat_type_ascription",
  "suggest_tuple_pat_type",
  "parse_pat_ident_mut",
  "ban_mut_general_pat",
  "recover_additional_muts",
  "parse_pat_mac_invoc",
  "fatal_unexpected_non_pat",
  "parse_range_end",
  "parse_pat_range_begin_with",
  "inclusive_range_with_incorrect_end",
  "parse_pat_range_to",
  "is_pat_range_end_start",
  "parse_pat_range_end",
  "is_start_of_pat_with_path",
  "can_be_ident_pat",
  "parse_pat_ident",
  "parse_pat_struct",
  "parse_pat_tuple_struct",
  "isnt_pattern_start",
  "parse_pat_builtin",
  "parse_pat_box",
  "parse_pat_fields",
  "report_misplaced_at_in_struct_pat",
  "recover_misplaced_pattern_modifiers",
  "recover_bad_dot_dot",
  "parse_pat_field",
  "mk_pat_ident",
  "mk_pat",
]);
