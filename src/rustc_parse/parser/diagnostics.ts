// Port of compiler/rustc_parse/src/parser/diagnostics.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into diagnostics.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Expr, Pat, Path, QSelf, Ty } from "../../rustc_ast/lib.ts";
import type { Param } from "../../rustc_ast/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { PathStyle } from "./path.gen.ts";
import * as gen from "./diagnostics.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./diagnostics.gen.ts";

// pub(super) fn dummy_arg(ident: Ident, guar: ErrorGuaranteed) -> Param
export function dummy_arg(_ident: Ident, _guar: unknown): Param {
  return unported("rustc_parse::parser::diagnostics::dummy_arg");
}

/// PORT: `pub(crate) trait RecoverQPath: Sized + 'static` -> an impl table per type (ast-visit
/// convention): generic fns bounded by it take `T_RecoverQPath: RecoverQPath<T>` (see decls.ts).
export interface RecoverQPath<T> {
  readonly PATH_STYLE: PathStyle;
  to_ty(self: T): Ty | undefined;
  recovered(qself: QSelf | undefined, path: Path): T;
}
const unported_recover_qpath = <T>(what: string): RecoverQPath<T> => ({
  get PATH_STYLE(): PathStyle {
    return unported(`rustc_parse::parser::diagnostics::${what}::PATH_STYLE`);
  },
  to_ty: () => unported(`rustc_parse::parser::diagnostics::${what}::to_ty`),
  recovered: () => unported(`rustc_parse::parser::diagnostics::${what}::recovered`),
});
export const RecoverQPath = {
  /** `impl<T: RecoverQPath> RecoverQPath for Box<T>` */
  Box<T>(_T_: RecoverQPath<T>): RecoverQPath<T> {
    return unported_recover_qpath<T>("RecoverQPath for Box<T>");
  },
  Ty: unported_recover_qpath<Ty>("RecoverQPath for Ty"),
  Pat: unported_recover_qpath<Pat>("RecoverQPath for Pat"),
  Expr: unported_recover_qpath<Expr>("RecoverQPath for Expr"),
};

export type AttemptLocalParseRecovery = gen.AttemptLocalParseRecovery;
export const AttemptLocalParseRecovery = {
  ...gen.AttemptLocalParseRecovery,
  yes(_self: AttemptLocalParseRecovery): boolean {
    return unported("rustc_parse::parser::diagnostics::AttemptLocalParseRecovery::yes");
  },
  no(_self: AttemptLocalParseRecovery): boolean {
    return unported("rustc_parse::parser::diagnostics::AttemptLocalParseRecovery::no");
  },
};

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::diagnostics::Parser", [
  "dcx",
  "restore_snapshot",
  "create_snapshot_for_diagnostic",
  "span_to_snippet",
  "expected_ident_found",
  "expected_ident_found_err",
  "is_lit_bad_ident",
  "expected_one_of_not_found",
  "is_expected_raw_ref_mut",
  "label_expected_raw_ref",
  "check_for_misspelled_kw",
  "attr_on_non_tail_expr",
  "check_too_many_raw_str_terminators",
  "maybe_suggest_struct_literal",
  "recover_closure_body",
  "eat_to_tokens",
  "check_trailing_angle_brackets",
  "check_turbofish_missing_angle_brackets",
  "check_mistyped_turbofish_with_multiple_type_params",
  "suggest_add_missing_let_for_stmt",
  "attempt_chained_comparison_suggestion",
  "check_no_chained_comparison",
  "consume_fn_args",
  "maybe_report_ambiguous_plus",
  "maybe_recover_from_question_mark",
  "maybe_recover_from_ternary_operator",
  "maybe_recover_from_bad_type_plus",
  "maybe_recover_from_bad_qpath",
  "recover_from_bad_qpath",
  "maybe_recover_from_bad_qpath_stage_2",
  "maybe_consume_incorrect_semicolon",
  "unexpected_err",
  "expect_semi",
  "recover_colon_as_semi",
  "recover_incorrect_await_syntax",
  "recover_await_macro",
  "recover_await_prefix",
  "error_on_incorrect_await",
  "recover_from_await_method_call",
  "recover_from_use",
  "try_macro_suggestion",
  "expect_gt_or_maybe_suggest_closing_generics",
  "recover_seq_parse_error",
  "recover_stmt",
  "recover_stmt_",
  "check_for_for_in_in_typo",
  "parameter_without_type",
  "recover_arg_parse",
  "recover_bad_self_param",
  "consume_block",
  "expected_expression_found",
  "consume_tts",
  "deduplicate_recovered_params_names",
  "handle_lifetime_arg_preceding_type",
  "handle_ambiguous_unbraced_const_arg",
  "recover_const_param_decl",
  "recover_const_param_declaration",
  "recover_const_arg",
  "recover_unbraced_const_arg_that_can_begin_ty",
  "dummy_const_arg_needs_braces",
  "recover_colon_colon_in_pat_typo",
  "maybe_recover_unexpected_block_label",
  "maybe_recover_unexpected_comma",
  "recover_unexpected_comma",
  "maybe_recover_bounds_doubled_colon",
  "maybe_err_dotdotlt_syntax",
  "is_vcs_conflict_marker",
  "conflict_marker",
  "recover_vcs_conflict_marker",
  "skip_pat_list",
  "maybe_type_in_generic_parameter",
]);
