// Port of compiler/rustc_parse/src/parser/ty.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into ty.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import * as gen from "./ty.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./ty.gen.ts";

export type RecoverReturnSign = gen.RecoverReturnSign;
export const RecoverReturnSign = {
  ...gen.RecoverReturnSign,
  // fn can_recover(self, token: &TokenKind) -> bool (ty.rs)
  can_recover(_self: RecoverReturnSign, _token: import("../../rustc_ast/token.ts").TokenKind): boolean {
    return unported("rustc_parse::parser::ty::RecoverReturnSign::can_recover");
  },
};

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::ty::Parser", [
  "parse_ty",
  "parse_ty_with_generics_recovery",
  "parse_ty_for_param",
  "parse_ty_no_plus",
  "parse_as_cast_ty",
  "parse_ty_no_question_mark_recover",
  "parse_ty_for_where_clause",
  "parse_ret_ty",
  "parse_ty_common",
  "parse_unsafe_binder_ty",
  "parse_paren_start_ty",
  "parse_bare_trait_object_ty",
  "parse_ref_ty_no_leading_ampersand",
  "maybe_recover_ref_ty_no_leading_ampersand",
  "finish_parsing_bare_trait_object_ty",
  "parse_ty_c_style_pointer",
  "parse_ty_ptr",
  "parse_array_or_slice_ty",
  "maybe_recover_array_ty_without_semi",
  "parse_borrowed_pointee",
  "parse_pin_and_mut",
  "parse_typeof_ty",
  "parse_builtin_ty",
  "parse_ty_field_of",
  "parse_ty_fn_ptr",
  "recover_fn_ptr_with_generics",
  "parse_impl_ty",
  "parse_use_bound",
  "can_begin_dyn_ty",
  "parse_dyn_ty",
  "parse_path_start_ty",
  "parse_generic_bounds",
  "parse_generic_bounds_common",
  "can_begin_bound",
  "can_begin_maybe_const_bound",
  "parse_generic_bound",
  "parse_lifetime_bound",
  "report_parenthesized_bound",
  "error_lt_bound_with_modifiers",
  "parse_trait_bound_modifiers",
  "parse_bound_constness",
  "parse_trait_bound",
  "recover_path_from_fn",
  "parse_higher_ranked_binder",
  "recover_fn_trait_with_lifetime_params",
  "check_lifetime",
  "expect_lifetime",
  "mk_ty",
]);
