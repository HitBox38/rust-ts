// Port of compiler/rustc_hir_typeck/src/demand.rs (STUB, lane typeck-coerce (demand_* :171..289) / wave 19 (rest)): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// demand.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/demand.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./demand.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { FnCtxt } from "./decls.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::demand::FnCtxt", ["emit_type_mismatch_suggestions", "emit_coerce_suggestions", "adjust_expr_for_assert_eq_macro", "demand_suptype", "demand_suptype_diag", "demand_suptype_with_origin", "demand_eqtype", "demand_eqtype_diag", "demand_eqtype_with_origin", "demand_coerce", "demand_coerce_diag", "note_source_of_type_mismatch_constraint", "annotate_loop_expected_due_to_inference", "annotate_expected_due_to_let_ty", "annotate_mut_binding_to_immutable_binding", "annotate_alternative_method_deref_for_unop", "annotate_alternative_method_deref", "get_conversion_methods_for_diagnostic", "has_only_self_parameter", "maybe_get_block_expr", "is_destruct_assignment_desugaring", "explain_self_literal", "note_wrong_return_ty_due_to_generic_arg"]);
