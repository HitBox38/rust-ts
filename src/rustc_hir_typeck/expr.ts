// Port of compiler/rustc_hir_typeck/src/expr.rs (STUB, lane typeck-expr-a|typeck-expr-b): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// expr.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/expr.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../rust_ts/stubs.ts";
import { FnCtxt } from "./decls.ts";

// ==== lane typeck-expr-a: expr.rs:1..1854 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::expr::FnCtxt", ["precedence", "check_expr_has_type_or_error", "check_expr_coercible_to_type", "check_expr_coercible_to_type_or_error", "check_expr_with_hint", "check_expr_with_expectation_and_needs", "check_expr", "check_expr_with_needs", "check_expr_with_expectation", "check_expr_with_expectation_and_args", "check_expr_kind", "check_expr_unop", "check_expr_addr_of", "check_named_place_expr", "check_expr_path", "check_expr_break", "check_expr_continue", "check_expr_return", "check_expr_become", "check_return_or_body_tail", "emit_return_outside_of_fn_body", "point_at_return_for_opaque_ty_error", "check_lhs_assignable", "check_for_missing_semi", "comes_from_while_condition", "check_expr_if", "check_expr_assign", "expr_assign_expected_bool_error", "check_expr_let", "check_expr_loop", "check_expr_method_call", "check_expr_use", "check_expr_cast", "check_expr_unsafe_binder_cast", "check_expr_array", "check_expr_const_block", "check_expr_repeat", "check_expr_tuple", "check_expr_struct"]);
// ==== lane typeck-expr-b: expr.rs:1855..3957 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::expr::FnCtxt", ["check_expr_struct_fields", "check_struct_fields_on_error", "report_missing_fields", "suggest_fru_from_range_and_emit", "report_private_fields", "report_unknown_field", "available_field_names", "name_series_display", "find_adt_field", "check_expr_field", "suggest_await_on_field_access", "ban_nonexisting_field", "ban_private_field_access", "ban_take_value_of_method", "point_at_param_definition", "maybe_suggest_array_indexing", "suggest_first_deref_field", "no_such_field_err", "private_field_err", "get_field_candidates_considering_privacy_for_diag", "check_for_nested_field_satisfying_condition_for_diag", "check_expr_index", "find_and_report_unsatisfied_index_impl", "point_at_index", "check_expr_yield", "check_expr_asm_operand", "check_expr_asm", "check_expr_offset_of"]);
