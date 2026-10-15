// Port of compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs (STUB, lane typeck-checks-a|typeck-checks-b): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/checks.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./checks.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt, register_deref } from "../decls.ts";
import { ArgMatchingCtxt, ArgsCtxt, CallCtxt, FnCallDiagCtxt } from "./checks.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";

/** fn_ctxt/checks.rs:2172 `struct FindClosureArg` (`impl Visitor`; hand type, lane typeck-checks-b writes the class). */
export type FindClosureArg = unknown;

// fn_ctxt/checks.rs:3449 `impl Deref for CallCtxt { type Target = FnCtxt }` (`&self.fn_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(CallCtxt, "fn_ctxt", FnCtxt);
// fn_ctxt/checks.rs:3304 `impl Deref for ArgsCtxt { type Target = CallCtxt }` (`&self.call_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ArgsCtxt, "call_ctxt", CallCtxt);
// fn_ctxt/checks.rs:3154 `impl Deref for ArgMatchingCtxt { type Target = ArgsCtxt }` (`&self.args_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ArgMatchingCtxt, "args_ctxt", ArgsCtxt);
// fn_ctxt/checks.rs:2252 `impl Deref for FnCallDiagCtxt { type Target = ArgMatchingCtxt }` (`&self.arg_matching_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(FnCallDiagCtxt, "arg_matching_ctxt", ArgMatchingCtxt);
// ==== lane typeck-checks-a: checks.rs:1..1668 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::checks::FnCtxt", ["check_casts", "check_asms", "check_repeat_exprs", "check_argument_types", "check_tupled_arguments", "check_place_expr_if_unsized", "report_arg_errors", "suggest_mut_addr", "check_expr_lit", "check_struct_path", "check_decl_initializer", "check_decl", "check_decl_local", "check_stmt", "check_block_no_value", "check_expr_block", "parent_item_span", "get_expr_coercion_span", "overwrite_local_ty_if_err", "finish_resolving_struct_path", "adjust_fulfillment_errors_for_expr_obligation"]);
// ==== lane typeck-checks-b: checks.rs:1669..3710 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::checks::FnCtxt", ["label_fn_like", "label_generic_mismatches", "get_hir_param_info"]);
unported_methods(CallCtxt.prototype, "rustc_hir_typeck::fn_ctxt::checks::CallCtxt", ["deref", "call_metadata", "mk_trace", "ty_to_snippet", "first_incompatible_error"]);
unported_methods(CallCtxt, "rustc_hir_typeck::fn_ctxt::checks::CallCtxt", ["new"]);
unported_methods(ArgsCtxt.prototype, "rustc_hir_typeck::fn_ctxt::checks::ArgsCtxt", ["deref", "normalize_span", "provided_arg_tys", "similar_assoc", "call_is_in_macro"]);
unported_methods(ArgsCtxt, "rustc_hir_typeck::fn_ctxt::checks::ArgsCtxt", ["new"]);
unported_methods(ArgMatchingCtxt.prototype, "rustc_hir_typeck::fn_ctxt::checks::ArgMatchingCtxt", ["deref", "suggest_confusable", "check_compatible", "remove_idx_is_perfect"]);
unported_methods(ArgMatchingCtxt, "rustc_hir_typeck::fn_ctxt::checks::ArgMatchingCtxt", ["new"]);
unported_methods(FnCallDiagCtxt.prototype, "rustc_hir_typeck::fn_ctxt::checks::FnCallDiagCtxt", ["deref", "check_wrap_args_in_tuple", "ensure_has_errors", "detect_dotdot", "filter_out_invalid_arguments", "check_single_incompatible", "maybe_optimize_extra_arg_suggestion", "initial_final_diagnostic", "labels_and_suggestion_text", "label_generic_mismatches", "append_arguments_changes", "arguments_formatting", "suggestion_code", "maybe_suggest_expect_for_unwrap"]);
unported_methods(FnCallDiagCtxt, "rustc_hir_typeck::fn_ctxt::checks::FnCallDiagCtxt", ["new", "format_suggestion_text"]);

// fn_ctxt/checks.rs:3615 (stub; final signature: decls.ts `Fns_fn_ctxt_checks`)
export function same_type_modulo_vars(tcx: TyCtxt, a: Ty, b: Ty): boolean {
  return unported("rustc_hir_typeck::fn_ctxt::checks::same_type_modulo_vars");
}
