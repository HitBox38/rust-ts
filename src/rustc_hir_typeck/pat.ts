// Port of compiler/rustc_hir_typeck/src/pat.rs (STUB, lane typeck-pat-a|typeck-pat-b): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// pat.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/pat.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./pat.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";

// ==== lane typeck-pat-a: pat.rs:1..1779 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::pat::FnCtxt", ["pattern_cause", "demand_eqtype_pat_diag", "demand_eqtype_pat", "downgrade_mut_inside_shared", "ref_pat_matches_inherited_ref", "ref_pat_matches_mut_ref", "check_pat_top", "check_pat", "check_pat_inner", "adjust_pat_info", "check_deref_pattern", "calc_adjust_mode", "should_peel_ref", "should_peel_smart_pointer", "check_pat_expr_unadjusted", "check_pat_lit", "check_pat_range", "endpoint_has_type", "emit_err_pat_range", "check_pat_ident", "check_binding_alt_eq_ty", "suggest_adding_missing_ref_or_removing_ref", "borrow_pat_suggestion", "check_dereferenceable", "resolve_pat_struct", "check_pin_projection", "check_pat_struct", "resolve_pat_path", "check_pat_path", "maybe_suggest_range_literal", "emit_bad_pat_path"]);
// ==== lane typeck-pat-b: pat.rs:1780..3388 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::pat::FnCtxt", ["resolve_pat_tuple_struct", "check_pat_tuple_struct", "emit_err_pat_wrong_number_of_fields", "check_pat_tuple", "check_struct_pat_fields", "error_tuple_variant_index_shorthand", "error_foreign_non_exhaustive_spat", "error_field_already_bound", "error_inexistent_fields", "error_tuple_variant_as_struct_pat", "get_suggested_tuple_struct_pattern", "error_no_accessible_fields", "lint_non_exhaustive_omitted_patterns", "error_unmentioned_fields", "check_pat_deref", "deref_pat_target", "register_deref_mut_bounds_if_needed", "check_pat_ref", "new_ref_ty", "new_pinned_ty", "error_inherited_ref_mutability_mismatch", "try_resolve_slice_ty_to_array_ty", "pat_is_irrefutable", "check_pat_slice", "check_array_pat_len", "error_scrutinee_inconsistent_length", "error_scrutinee_with_rest_inconsistent_length", "error_scrutinee_unfixed_length", "error_expected_array_or_slice", "is_slice_or_array_or_vector", "add_rust_2024_migration_desugared_pat"]);

// pat.rs:49 (stub; final signature: decls.ts `Fns_pat`)
export function is_number(text: string): boolean {
  return unported("rustc_hir_typeck::pat::is_number");
}
