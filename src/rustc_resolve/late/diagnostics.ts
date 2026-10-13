// Port of compiler/rustc_resolve/src/late/diagnostics.rs
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ../decls.ts and
// installed below as `unported(..)` placeholders; free fns and companions have their final
// signatures and `unported` bodies, without markers. The lane that ports late/diagnostics.rs replaces
// each stub in place (adding its `// rustc: ` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { type Path, type PathSegment, type PolyTraitRef, type Ty, type WhereBoundPredicate, visit } from "../../rustc_ast/lib.ts";
import type { Namespace } from "../../rustc_hir/def.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { LateResolutionVisitor } from "../decls.ts";
import type { ImportSuggestion, TypoSuggestion } from "../diagnostics/impls.ts";
import type { Segment } from "../lib.ts";
import * as gen from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// rustc-type: compiler/rustc_resolve/src/late/diagnostics.rs:4780 LifetimeFinder
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class LifetimeFinder extends visit.Visitor {
  constructor(
    public lifetime: Span,
    public found: Ty | undefined,
    public seen: Ty[],
  ) {
    super();
  }
}

// rustc-type: compiler/rustc_resolve/src/late/diagnostics.rs:4798 RefPrefixSpanFinder
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class RefPrefixSpanFinder extends visit.Visitor {
  constructor(
    public lifetime: Span,
    public span: Span | undefined,
  ) {
    super();
  }
}

// rustc-type: compiler/rustc_resolve/src/late/diagnostics.rs:4833 ParentPathVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class ParentPathVisitor extends visit.Visitor {
  constructor(
    public target: Ident,
    public parent: PathSegment | undefined,
    public stack: Ty[],
  ) {
    super();
  }

  /** Stub: `late/diagnostics.rs:4840` `ParentPathVisitor::new` (unported). */
  static new(self_ty: Ty, target: Ident): ParentPathVisitor {
    return unported("rustc_resolve::late::diagnostics::ParentPathVisitor::new");
  }
}

/** Stub (lane res-lib): `late/diagnostics.rs:75` `is_self_type` (unported). */
export function is_self_type(path: readonly Segment[], namespace: Namespace): boolean {
  return unported("rustc_resolve::late::diagnostics::is_self_type");
}
/** Stub (lane res-lib): `late/diagnostics.rs:79` `is_self_value` (unported). */
export function is_self_value(path: readonly Segment[], namespace: Namespace): boolean {
  return unported("rustc_resolve::late::diagnostics::is_self_value");
}
/** Stub (lane res-lib): `late/diagnostics.rs:83` `path_to_string_without_assoc_item_bindings` (unported). */
export function path_to_string_without_assoc_item_bindings(path: Path): string {
  return unported("rustc_resolve::late::diagnostics::path_to_string_without_assoc_item_bindings");
}
/** Stub (lane res-lib): `late/diagnostics.rs:101` `import_candidate_to_enum_paths` (unported). */
export function import_candidate_to_enum_paths(suggestion: ImportSuggestion): [string, string] {
  return unported("rustc_resolve::late::diagnostics::import_candidate_to_enum_paths");
}
/** Stub (lane res-lib): `late/diagnostics.rs:4700` `mk_where_bound_predicate` (unported). */
export function mk_where_bound_predicate(path: Path, poly_trait_ref: PolyTraitRef, ty: Ty): WhereBoundPredicate | undefined {
  return unported("rustc_resolve::late::diagnostics::mk_where_bound_predicate");
}
/** Stub (lane res-lib): `late/diagnostics.rs:4763` `signal_lifetime_shadowing` (unported). */
export function signal_lifetime_shadowing(sess: Session, orig: Ident, shadower: Ident): ErrorGuaranteed {
  return unported("rustc_resolve::late::diagnostics::signal_lifetime_shadowing");
}
/** Stub (lane res-lib): `late/diagnostics.rs:4820` `signal_label_shadowing` (unported). */
export function signal_label_shadowing(sess: Session, orig: Span, shadower: Ident): void {
  return unported("rustc_resolve::late::diagnostics::signal_label_shadowing");
}
export type AssocSuggestion = gen.AssocSuggestion;
export const AssocSuggestion = {
  ...gen.AssocSuggestion,
  /** Stub: `late/diagnostics.rs:58` `AssocSuggestion::action` (unported). */
  action(self: AssocSuggestion): string {
    return unported("rustc_resolve::late::diagnostics::AssocSuggestion::action");
  },
};
export type TypoCandidate = gen.TypoCandidate;
export const TypoCandidate = {
  ...gen.TypoCandidate,
  /** Stub: `late/diagnostics.rs:179` `TypoCandidate::to_opt_suggestion` (unported). */
  to_opt_suggestion(self: TypoCandidate): TypoSuggestion | undefined {
    return unported("rustc_resolve::late::diagnostics::TypoCandidate::to_opt_suggestion");
  },
};
unported_methods(LateResolutionVisitor.prototype, "rustc_resolve::late::diagnostics::LateResolutionVisitor", ["trait_assoc_type_def_id_by_name", "suggest_assoc_type_from_bounds", "make_base_error", "could_be_expr", "smart_resolve_partial_mod_path_errors", "smart_resolve_report_errors", "suggest_named_format_argument", "detect_rtn_with_fully_qualified_path", "detect_assoc_type_constraint_meant_as_path", "suggest_self_or_self_ref", "try_lookup_name_relaxed", "lookup_doc_alias_name", "suggest_trait_and_bounds", "suggest_typo", "suggest_shadowed", "err_code_special_cases", "suggest_ident_hidden_by_hygiene", "suggest_self_ty", "suggest_self_value", "detect_missing_binding_available_from_pattern", "suggest_at_operator_in_slice_pat_with_range", "suggest_range_struct_destructuring", "suggest_swapping_misplaced_self_ty_and_trait", "detect_resolution_error_in_derive", "explain_functions_in_pattern", "suggest_changing_type_to_const_param", "suggest_pattern_match_with_let", "get_single_associated_item", "restrict_assoc_type_in_where_clause", "call_has_self_arg", "followed_by_brace", "update_err_for_private_tuple_struct_fields", "smart_resolve_context_dependent_help", "suggest_alternative_construction_methods", "find_similarly_named_assoc_item", "lookup_assoc_candidate", "lookup_typo_candidate", "let_binding_suggestion", "find_module", "collect_enum_ctors", "suggest_using_enum_variant", "detect_and_suggest_const_parameter_error", "suggest_adding_generic_parameter", "suggestion_for_label_in_rib", "maybe_report_lifetime_uses", "emit_undeclared_lifetime_error", "suggest_introducing_lifetime", "suggest_introducing_lifetime_for_assoc_ty_binding", "suggest_introducing_lifetime_filtered", "emit_non_static_lt_in_const_param_ty_error", "emit_forbidden_non_static_lifetime_error", "report_missing_lifetime_specifiers", "add_missing_lifetime_specifiers_label", "find_ref_prefix_span_for_owned_suggestion"]);
unported_methods(LifetimeFinder.prototype, "rustc_resolve::late::diagnostics::LifetimeFinder", ["visit_ty"]);
unported_methods(RefPrefixSpanFinder.prototype, "rustc_resolve::late::diagnostics::RefPrefixSpanFinder", ["visit_ty"]);
unported_methods(ParentPathVisitor.prototype, "rustc_resolve::late::diagnostics::ParentPathVisitor", ["visit_ty"]);
