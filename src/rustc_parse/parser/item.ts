// Port of compiler/rustc_parse/src/parser/item.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into item.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { AnonConst, FieldDefExtras, MutRestriction, Safety } from "../../rustc_ast/lib.ts";
import { unported } from "../../std/panic.ts";

export * from "./item.gen.ts";

// Parser::field_def_extras (item.rs:2288), an associated fn without `self`.
export function field_def_extras(_safety: Safety, _mut_restriction: MutRestriction, _default_: AnonConst | undefined): FieldDefExtras | undefined {
  return unported("rustc_parse::parser::item::Parser::field_def_extras");
}

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::item::Parser", [
  "parse_crate_mod",
  "parse_item_mod",
  "parse_mod",
  "parse_item",
  "parse_item_",
  "parse_item_common",
  "error_on_unconsumed_default",
  "parse_item_kind",
  "recover_import_as_use",
  "recover_field_in_trait",
  "parse_use_item",
  "is_path_start_item",
  "is_reuse_item",
  "isnt_macro_invocation",
  "recover_missing_kw_before_item",
  "parse_item_builtin",
  "parse_item_macro",
  "recover_attrs_no_item",
  "is_async_fn",
  "parse_polarity",
  "parse_item_impl",
  "parse_item_delegation",
  "parse_delegation_body",
  "parse_impl_delegation",
  "parse_path_like_delegation",
  "parse_item_list",
  "recover_doc_comment_before_brace",
  "parse_defaultness",
  "check_trait_front_matter",
  "parse_item_trait",
  "parse_impl_item",
  "parse_trait_item",
  "parse_assoc_item",
  "parse_type_alias",
  "parse_use_tree",
  "parse_use_tree_glob_or_nested",
  "parse_use_tree_list",
  "emit_error_attr_in_use_tree",
  "parse_rename",
  "parse_ident_or_underscore",
  "parse_item_extern_crate",
  "parse_crate_name_with_dashes",
  "parse_item_foreign_mod",
  "parse_foreign_item",
  "error_bad_item_kind",
  "is_use_closure",
  "is_unsafe_foreign_mod",
  "parse_global_static_front_matter",
  "recover_const_mut",
  "parse_const_block_item",
  "parse_static_item",
  "parse_const_item",
  "recover_missing_global_item_type",
  "parse_item_enum",
  "parse_enum_variant",
  "parse_item_struct",
  "parse_item_union",
  "parse_record_struct_body",
  "parse_unsafe_field",
  "parse_tuple_struct_body",
  "parse_field_def",
  "parse_single_struct_field",
  "expect_field_ty_separator",
  "parse_name_and_ty",
  "parse_field_ident",
  "parse_item_decl_macro",
  "is_macro_rules_item",
  "parse_item_macro_rules",
  "complain_if_pub_macro",
  "eat_semi_for_macro_if_needed",
  "parse_test_binder_constraints",
  "parse_test_binder_body",
  "parse_test_binder_forall",
  "parse_test_binder_exists",
  "parse_test_binder_constraint",
  "parse_test_binder_bound_type_constraint",
  "report_invalid_macro_expansion_item",
  "recover_nested_adt_item",
  "check_impl_frontmatter",
  "try_recover_const_missing_semi",
]);
