// Port of compiler/rustc_resolve/src/diagnostics/impls.rs
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ../decls.ts and
// installed below as `unported(..)` placeholders; free fns and statics have their final signatures
// and `unported` bodies, without markers. The lane that ports diagnostics/impls.rs replaces each stub
// in place (adding its `// rustc: ` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Ported by res-lib (needed by `Resolver::new`): `OnUnknownData::from_attrs`.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { type Attribute, type Crate, type Item, type NodeId, visit } from "../../rustc_ast/lib.ts";
import { AttributeParser } from "../../rustc_attr_parsing/interface.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { Resolver } from "../decls.ts";
import * as gen from "./impls.gen.ts";
import type { DiagMode, FoundUse, ImportSuggestion, Instead } from "./impls.gen.ts";
import type { Res, Segment } from "../lib.ts";

export * from "./impls.gen.ts";

export type TypoSuggestion = gen.TypoSuggestion;
export type OnUnknownData = gen.OnUnknownData;
const StructCtor = gen.StructCtor;

// rustc-type: compiler/rustc_resolve/src/diagnostics/impls.rs:4305 UsePlacementFinder
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class UsePlacementFinder extends visit.Visitor {
  constructor(
    public target_module: NodeId,
    public first_legal_span: Span | undefined,
    public first_use_span: Span | undefined,
  ) {
    super();
  }

  /** Stub: `diagnostics/impls.rs:4312` `UsePlacementFinder::check` (unported). */
  static check(krate: Crate, target_module: NodeId): [Span | undefined, FoundUse] {
    return unported("rustc_resolve::diagnostics::impls::UsePlacementFinder::check");
  }
}

// rustc-type: compiler/rustc_resolve/src/diagnostics/impls.rs:4353 BindingVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class BindingVisitor extends visit.Visitor {
  constructor(
    public identifiers: Symbol[],
    public spans: Map<Symbol, Span[]>,
  ) {
    super();
  }
}

export const OnUnknownData = gen.OnUnknownData as typeof gen.OnUnknownData & {
  from_attrs: (r: Resolver, attrs: readonly Attribute[]) => OnUnknownData | undefined;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4397 from_attrs
OnUnknownData.from_attrs = function (r: Resolver, attrs: readonly Attribute[]): OnUnknownData | undefined {
  if (r.features.diagnostic_on_unknown()) {
    const parsed = AttributeParser.parse_limited_sym(r.tcx_.sess, attrs, [sym.diagnostic, sym.on_unknown]);
    if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "OnUnknown") {
      // `directive?`
      const directive = parsed._0.directive;
      if (directive === undefined) return undefined;
      return new gen.OnUnknownData(directive);
    }
  }
  return undefined;
};

/** Stub (lane res-lib): `diagnostics/impls.rs:135` `reduce_impl_span_to_impl_keyword` (unported). */
export function reduce_impl_span_to_impl_keyword(sm: SourceMap, impl_span: Span): Span {
  return unported("rustc_resolve::diagnostics::impls::reduce_impl_span_to_impl_keyword");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:3877` `find_span_of_binding_until_next_binding` (unported). */
export function find_span_of_binding_until_next_binding(sess: Session, binding_span: Span, use_span: Span): [boolean, Span] {
  return unported("rustc_resolve::diagnostics::impls::find_span_of_binding_until_next_binding");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:3928` `extend_span_to_previous_binding` (unported). */
export function extend_span_to_previous_binding(sess: Session, binding_span: Span): Span | undefined {
  return unported("rustc_resolve::diagnostics::impls::extend_span_to_previous_binding");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:3973` `find_span_immediately_after_crate_name` (unported). */
export function find_span_immediately_after_crate_name(sess: Session, use_span: Span): [boolean, Span] {
  return unported("rustc_resolve::diagnostics::impls::find_span_immediately_after_crate_name");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:4034` `import_candidates` (unported). */
export function import_candidates(tcx: TyCtxt, err: Diag, use_placement_span: Span | undefined, candidates: readonly ImportSuggestion[], mode: DiagMode, append: string): void {
  return unported("rustc_resolve::diagnostics::impls::import_candidates");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:4062` `show_candidates` (unported). */
export function show_candidates(tcx: TyCtxt, err: Diag, use_placement_span: Span | undefined, candidates: readonly ImportSuggestion[], instead: Instead, found_use: FoundUse, mode: DiagMode, path: Segment[], append: string): boolean {
  return unported("rustc_resolve::diagnostics::impls::show_candidates");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:4368` `search_for_any_use_in_items` (unported). */
export function search_for_any_use_in_items(items: readonly Item[]): Span | undefined {
  return unported("rustc_resolve::diagnostics::impls::search_for_any_use_in_items");
}
/** Stub (lane res-lib): `diagnostics/impls.rs:4385` `is_span_suitable_for_use_injection` (unported). */
export function is_span_suitable_for_use_injection(s: Span): boolean {
  return unported("rustc_resolve::diagnostics::impls::is_span_suitable_for_use_injection");
}
export const TypoSuggestion = gen.TypoSuggestion as typeof gen.TypoSuggestion & {
  "new": (candidate: Symbol, span: Span, res: Res) => TypoSuggestion;
  typo_from_name: (candidate: Symbol, res: Res) => TypoSuggestion;
  single_item: (candidate: Symbol, span: Span, res: Res) => TypoSuggestion;
};
/** Stub: `diagnostics/impls.rs:102` `TypoSuggestion::new` (unported). */
TypoSuggestion.new = function (candidate: Symbol, span: Span, res: Res): TypoSuggestion {
  return unported("rustc_resolve::diagnostics::impls::TypoSuggestion::new");
};
/** Stub: `diagnostics/impls.rs:105` `TypoSuggestion::typo_from_name` (unported). */
TypoSuggestion.typo_from_name = function (candidate: Symbol, res: Res): TypoSuggestion {
  return unported("rustc_resolve::diagnostics::impls::TypoSuggestion::typo_from_name");
};
/** Stub: `diagnostics/impls.rs:108` `TypoSuggestion::single_item` (unported). */
TypoSuggestion.single_item = function (candidate: Symbol, span: Span, res: Res): TypoSuggestion {
  return unported("rustc_resolve::diagnostics::impls::TypoSuggestion::single_item");
};
unported_methods(StructCtor.prototype, "rustc_resolve::diagnostics::impls::StructCtor", ["has_private_fields"]);
unported_methods(Resolver.prototype, "rustc_resolve::diagnostics::impls::Resolver", ["throw_unresolved_import_error", "dcx", "report_errors", "report_delayed_vis_resolution_errors", "report_with_use_injections", "report_conflict", "add_suggestion_for_rename_of_use", "add_suggestion_for_duplicate_nested_use", "lint_if_path_starts_with_module", "add_module_candidates", "report_error", "into_struct_error", "report_vis_error", "def_path_str", "add_scope_set_candidates", "early_lookup_typo_candidate", "lookup_import_candidates_from_module", "is_stable", "lookup_import_candidates", "unresolved_macro_suggestions", "detect_derive_attribute", "add_typo_suggestion", "decl_description", "ambiguity_diagnostic", "ctor_fields_span", "module_path_names", "shorten_candidate_path", "shorten_import_path", "report_privacy_error", "mention_default_field_values", "find_similarly_named_module_or_crate", "report_path_resolution_error", "undeclared_module_suggest_declare", "undeclared_module_exists", "make_path_suggestion", "make_missing_self_suggestion", "make_missing_crate_suggestion", "make_missing_super_suggestion", "make_external_crate_suggestion", "check_for_module_export_macro", "find_cfg_stripped", "struct_ctor", "on_unknown_data"]);
unported_methods(UsePlacementFinder.prototype, "rustc_resolve::diagnostics::impls::UsePlacementFinder", ["visit_crate", "visit_item"]);
unported_methods(BindingVisitor.prototype, "rustc_resolve::diagnostics::impls::BindingVisitor", ["visit_pat"]);
