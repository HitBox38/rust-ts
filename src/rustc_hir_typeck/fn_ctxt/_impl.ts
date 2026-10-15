// Port of compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs (STUB, lane typeck-impl): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/_impl.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../../rust_ts/stubs.ts";
import { FnCtxt } from "../decls.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::_impl::FnCtxt", ["warn_if_unreachable", "deeply_resolve_ignoring_regions_with_obligations", "record_deferred_call_resolution", "remove_deferred_call_resolutions", "tag", "local_ty", "write_ty", "write_field_index", "write_resolution", "write_splatted_resolution", "write_method_call_and_enforce_effects", "write_splatted_call", "write_args", "write_user_type_annotation_from_args", "write_user_type_annotation", "apply_adjustments", "normalize", "require_type_meets", "require_type_is_sized", "require_type_is_sized_deferred", "require_type_has_static_alignment", "register_bound", "lower_ty", "collect_impl_trait_clauses_from_hir_ty", "lower_ty_saving_user_provided_ty", "lower_const_arg", "node_ty", "node_ty_opt", "register_wf_obligation", "add_wf_bounds", "field_ty", "drain_stalled_coroutine_obligations", "report_ambiguity_errors", "select_obligations_where_possible", "make_overloaded_place_return_type", "type_var_is_sized", "err_args", "resolve_ty_and_res_fully_qualified_call", "get_fn_decl", "note_internal_mutation_in_method", "instantiate_value_path", "add_required_obligations_for_hir", "add_required_obligations_with_code", "try_structurally_resolve_const", "structurally_resolve_type", "type_must_be_known_at_this_point", "structurally_resolve_const", "with_breakable_ctxt", "probe_instantiate_query_response", "expr_in_place"]);
unported_methods(FnCtxt, "rustc_hir_typeck::fn_ctxt::_impl::FnCtxt", ["user_args_for_adt", "can_contain_user_lifetime_bounds"]);
