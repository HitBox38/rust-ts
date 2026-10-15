// Port of compiler/rustc_hir_typeck/src/method/suggest.rs (STUB, lane wave 19): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// method/suggest.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./suggest.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt } from "../decls.ts";
import { debug_Expr, debug_Ty as debug_hir_Ty } from "../../rustc_hir/lib.ts";
import { type Debug, debug_tuple } from "../../std/fmt.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { TraitRef } from "../../rustc_type_ir/decls.ts";
import type { TraitInfo } from "./suggest.gen.ts";

// rustc-type: compiler/rustc_hir_typeck/src/method/suggest.rs:4950 SelfSource
// PORT: hand-written (types.sets.json `skip`): the generated Debug would import `hir::Ty`'s and `ty::Ty`'s `debug_Ty` under
// one name. `#[derive(Copy, Clone, Debug)]`: an immutable value, so Clone is the identity.
export type SelfSource =
  | { readonly $: "QPath"; _0: hir.Ty }
  | { readonly $: "MethodCall"; _0: hir.Expr /* rcvr */ };
export const debug_SelfSource: Debug<SelfSource> = (v, f) => {
  switch (v.$) {
    case "QPath":
      return debug_tuple(f, "QPath", [debug_hir_Ty(v._0, f)]);
    case "MethodCall":
      return debug_tuple(f, "MethodCall", [debug_Expr(v._0, f)]);
  }
};

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::method::suggest::FnCtxt", ["is_slice_ty", "impl_into_iterator_should_be_iterator", "preferred_iterator_method", "report_method_error", "create_missing_writer_err", "create_no_assoc_err", "suggest_use_shadowed_binding_with_method", "suggest_method_call_annotation", "suggest_static_method_candidates", "suggest_unsatisfied_ty_or_trait", "suggest_surround_method_call", "find_possible_candidates_for_method", "suggest_confusable_or_similarly_named_method", "suggest_method_not_found_because_of_unsatisfied_bounds", "report_no_match_method_error", "set_not_found_span_label", "suggest_enum_variant_for_method_call", "handle_unsatisfied_predicates", "lookup_segments_chain_for_no_match_method", "find_likely_intended_associated_item", "confusable_method_name", "note_candidates_on_method_error", "find_builder_fn", "suggest_associated_call_syntax", "suggest_calling_field_as_fn", "report_failed_method_call_on_range_end", "report_failed_method_call_on_numerical_infer_var", "suggest_assoc_method_call", "suggest_calling_method_on_field", "suggest_unwrapping_inner_self", "note_unmet_impls_on_type", "consider_suggesting_derives_for_ty", "note_predicate_source_and_get_derives", "suggest_derive", "note_derefed_ty_has_method", "suggest_bounds_for_range_to_method", "ty_to_value_string", "suggest_await_before_method", "set_label_for_method_error", "suggest_on_pointer_type", "suggest_use_candidates", "suggest_valid_traits", "suggest_traits_to_import", "detect_and_explain_multiple_crate_versions_of_trait_item", "suggest_else_fn_with_closure", "type_derefs_to_local", "suggest_hashmap_on_unsatisfied_hashset_buildhasher"]);

// method/suggest.rs:4962 (stub; final signature: decls.ts `Fns_method_suggest`)
export function all_traits(tcx: TyCtxt): TraitInfo[] {
  return unported("rustc_hir_typeck::method::suggest::all_traits");
}

// method/suggest.rs:4966 (stub; final signature: decls.ts `Fns_method_suggest`)
export function print_disambiguation_help(tcx: TyCtxt, err: Diag, source: SelfSource, args: readonly hir.Expr[] | undefined, trait_ref: TraitRef, candidate_idx: number | undefined, span: Span, item: AssocItem): string | undefined {
  return unported("rustc_hir_typeck::method::suggest::print_disambiguation_help");
}
