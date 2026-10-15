// Port of compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs (STUB, lane wave 19): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/suggestions.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../../rust_ts/stubs.ts";
import { FnCtxt } from "../decls.ts";
import type { FnSig } from "../../rustc_type_ir/decls.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::suggestions::FnCtxt", ["suggest_semicolon_at_end", "suggest_mismatched_types_on_tail", "suggest_fn_call", "extract_callable_info", "suggest_two_fn_call", "suggest_collect", "suggest_remove_last_method_call", "suggest_deref_ref_or_into", "deconstruct_option_or_result", "suggest_boxing_when_appropriate", "suggest_closure_to_fn_ptr_coercion", "suggest_impl_fn_for_fn_ptr_ret", "suggest_calling_boxed_future_when_appropriate", "suggest_missing_semicolon", "is_next_stmt_expr_continuation", "suggest_missing_return_type", "can_add_return_type", "try_note_caller_chooses_ty_for_ty_param", "try_suggest_return_impl_trait", "suggest_missing_break_or_return_expr", "suggest_missing_parentheses", "suggest_block_to_brackets_peeling_refs", "suggest_clone_for_ref", "suggest_copied_cloned_or_as_ref", "suggest_into", "suggest_option_to_bool", "suggest_deref_unwrap_or", "suggest_block_to_brackets", "suggest_floating_point_literal", "suggest_null_ptr_for_literal_zero_given_to_ptr_arg", "suggest_associated_const", "is_loop", "is_local_statement", "note_type_is_not_clone", "note_type_is_not_clone_inner_expr", "is_field_suggestable", "suggest_missing_unwrap_expect", "suggest_coercing_result_via_try_operator", "suggest_returning_value_after_loop", "suggest_semicolon_in_repeat_expr", "suggest_compatible_variants", "suggest_non_zero_new_unwrap", "can_use_as_ref_or_mut", "suggest_deref_or_ref", "is_else_if_block", "suggest_cast", "suggest_method_call_on_range_literal", "suggest_return_binding_for_missing_tail_expr", "suggest_swapping_lhs_and_rhs"]);

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:43 fn_sig
FnCtxt.prototype.fn_sig = function (this: FnCtxt): FnSig | undefined {
  return this.typeck_results.liberated_fn_sigs().get(this.tcx.local_def_id_to_hir_id(this.body_def_id));
};
