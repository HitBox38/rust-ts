// Port of compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs (STUB, lane wave 19): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/adjust_fulfillment_errors.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./adjust_fulfillment_errors.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt } from "../decls.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::adjust_fulfillment_errors::FnCtxt", ["adjust_fulfillment_error_for_expr_obligation", "adjust_binop_index_operand", "binop_for_operands", "binop_accepts_types", "deref_ty_if_possible", "point_at_expr_if_possible", "point_at_path_if_possible", "point_at_generic_if_possible", "find_ambiguous_parameter_in", "closure_span_overlaps_error", "point_at_field_if_possible", "blame_specific_arg_if_possible", "blame_specific_expr_if_possible", "blame_specific_expr_if_possible_for_obligation_cause_code", "blame_specific_expr_if_possible_for_derived_predicate_obligation", "blame_specific_part_of_expr_corresponding_to_generic_param"]);

// fn_ctxt/adjust_fulfillment_errors.rs:1172 (stub; final signature: decls.ts `Fns_fn_ctxt_adjust_fulfillment_errors`)
export function find_param_in_ty(ty: GenericArg, param_to_point_at: GenericArg): boolean {
  return unported("rustc_hir_typeck::fn_ctxt::adjust_fulfillment_errors::find_param_in_ty");
}

// fn_ctxt/adjust_fulfillment_errors.rs:1200 (stub; final signature: decls.ts `Fns_fn_ctxt_adjust_fulfillment_errors`)
export function is_iterator_singleton<T>(iterator: Iterable<T>): T | undefined {
  return unported("rustc_hir_typeck::fn_ctxt::adjust_fulfillment_errors::is_iterator_singleton");
}
