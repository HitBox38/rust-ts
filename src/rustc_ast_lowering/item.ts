// Port of compiler/rustc_ast_lowering/src/item.rs (STUB, lane lower-item: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import type { Generics, WhereClause } from "../rustc_ast/lib.ts";
import { unported } from "../std/panic.ts";


// item.rs:30 (stub; final signature: decls.ts `FreeFns`)
export function add_ty_alias_where_clause(_generics: Generics, _after_where_clause: WhereClause, _prefer_first: boolean): void {
  return unported("rustc_ast_lowering::item::add_ty_alias_where_clause");
}

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::item::LoweringContext", [
  "lower_mod", "lower_item_ref", "lower_eii_decl", "lower_eii_impl", "generate_extra_attrs_for_item_kind",
  "lower_item", "lower_item_kind", "lower_path_simple_eii", "lower_use_tree", "lower_foreign_item",
  "lower_foreign_item_ref", "lower_variant", "lower_variant_data", "lower_field_def", "lower_trait_item",
  "lower_trait_item_ref", "expr_err", "lower_trait_impl_header", "check_pin_drop_sugar_impl_item",
  "lower_impl_item", "lower_impl_item_ref", "lower_defaultness", "record_body", "lower_body", "lower_param",
  "lower_fn_body", "lower_fn_body_block", "lower_const_body", "lower_maybe_coroutine_body",
  "lower_coroutine_body_with_moved_arguments", "lower_method_sig", "lower_fn_header", "lower_abi",
  "lower_extern", "error_on_invalid_abi", "lower_constness", "lower_safety", "lower_restriction_kind",
  "lower_impl_restriction", "lower_mut_restriction", "lower_generics", "lower_define_opaque",
  "lower_generic_bound_predicate", "lower_where_predicate", "lower_test_binder_body",
  "lower_test_binder_forall", "lower_test_binder_exists", "lower_test_binder_constraints_as_and",
  "lower_test_binder_constraint", "lower_test_binder_bound_type_constraint",
]);
