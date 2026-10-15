// Port of compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs (lanes errrep-traits-a, errrep-traits-b; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/fulfillment_errors.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { TypeErrCtxt } from "../../decls.ts";

// ==== lane errrep-traits-a: error_reporting/traits/fulfillment_errors.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt", [
  "report_selection_error", "apply_do_not_recommend", "report_host_effect_error", "emit_specialized_closure_kind_error", "fn_arg_obligation", "detect_negative_literal", "try_conversion_context", "note_missing_impl_for_question_mark", "report_const_param_not_wf",
]);

// ==== lane errrep-traits-b: error_reporting/traits/fulfillment_errors.rs ====
unported_methods(TypeErrCtxt, "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt", ["as_host_effect_clause"]);
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt", [
  "can_match_trait", "can_match_host_effect", "can_match_projection", "error_implies", "trait_error_implies_projection_error", "report_projection_error", "maybe_detailed_projection_msg", "fuzzy_match_tys", "describe_closure", "find_similar_impl_candidates", "report_similar_impl_candidates", "report_similar_impl_candidates_for_root_obligation", "get_parent_trait_ref", "check_same_trait_different_version", "note_two_crate_versions", "note_adt_version_mismatch", "check_same_name_different_path", "note_different_trait_with_same_name", "comparable_path", "mk_trait_obligation_with_new_self_ty", "predicate_can_apply", "suggest_change_mut_ref_for_closure", "silence_redundant_cause", "note_obligation_cause", "is_recursive_obligation", "get_standard_error_message", "select_transmute_obligation_for_reporting", "get_safe_transmute_error_and_reason", "find_explicit_cast_type", "has_impl_for_type", "add_tuple_trait_message", "try_to_add_help_message", "add_help_message_for_fn_trait", "report_closure_error", "report_cyclic_signature_error", "report_signature_mismatch_error", "get_fn_like_arguments", "report_arg_count_mismatch", "type_implements_fn_trait", "report_not_const_evaluatable_error",
]);
