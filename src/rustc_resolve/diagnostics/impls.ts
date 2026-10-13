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
import { Session } from "../../rustc_session/session.ts";
import { Span } from "../../rustc_span/lib.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { Resolver } from "../decls.ts";
import * as gen from "./impls.gen.ts";
import type { DiagMode, FoundUse, ImportSuggestion, Instead } from "./impls.gen.ts";
import type { Res, Segment } from "../lib.ts";

// res-diag-a imports
import { ast, CRATE_NODE_ID, DUMMY_NODE_ID, PathSegment, clone_PathSegment, type Expr, join_path_idents, Path, type Pat } from "../../rustc_ast/lib.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import { type Attribute as HirAttribute, type AttributeKind, find_attr, type Stability, StrippedCfgItem } from "../../rustc_attr_ir/lib.ts";
import { type CustomDiagnostic, default_CustomDiagnostic, type FormatArgs, type Directive } from "../../rustc_attr_ir/diagnostic.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { type DiagCtxtHandle, E0252, E0254, E0255, E0259, E0260, E0428, E0432, E0433, type ErrCode, type ErrorGuaranteed, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { BUILTIN_ATTRIBUTES } from "../../rustc_feature/lib.ts";
import { DefKind, Namespace, Res as def_Res, type CtorKind, MacroKinds, type PerNS, Res as hir_Res, Res_eq } from "../../rustc_hir/def.ts";
import { ABSOLUTE_PATHS_NOT_STARTING_WITH_CRATE, AMBIGUOUS_GLOB_IMPORTS, AMBIGUOUS_IMPORT_VISIBILITIES, AMBIGUOUS_PANIC_IMPORTS, MACRO_EXPANDED_MACRO_EXPORTS_ACCESSED_BY_ABSOLUTE_PATHS } from "../../rustc_lint_defs/builtin.ts";
import { type Applicability, type Lint, pluralize } from "../../rustc_lint_defs/lib.ts";
import { CRATE_DEF_ID, CrateNum, type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { SyntaxContext, MacroKind } from "../../rustc_span/hygiene.ts";
import { type BytePos, DUMMY_SP, OrdSpan, FileName, type PathBuf, RemapPathScopeComponents, Span as SpanC, type Spanned } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Ident, Ident, kw, display_Symbol, Symbol as SymbolC } from "../../rustc_span/symbol.ts";
import { KeyedSet, KeyedMap } from "../../rust_ts/keyed.ts";
import { is_uppercase, ch, is_whitespace } from "../../std/char.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { str_trim_end, str_trim_start, utf8_len } from "../../std/str.ts";
import * as diagnostics from "./mod.ts";
import { type Import, type UnresolvedImportError, import_path_to_string } from "../imports.ts";
// PORT (init order): the rustc_resolve bindings below are read inside function bodies only.
import { UsePrelude } from "../ident.ts";
import { type Decl, DeclKind, DefId_key, type Finalize, IdentKey, IdentKey_eq, Macros20NormalizedSyntaxContext, type Module, type ParentScope, path_names_to_string, PrimTy_ALL, PrimTy_name, type ResolutionError, type ScopeSet, type UseError, type VisResolutionError, AmbiguityKind, BindingKey, clone_Segment, Segment as SegmentC } from "../lib.ts";
// res-diag-b imports
import { existsSync } from "node:fs";
import { type CfgEntry, clone_CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import { type SyntaxExtension } from "../../rustc_expand/base.ts";
import { Visibility } from "../../rustc_middle/ty/mod.ts";
import { path_set_extension } from "../../rustc_session/config.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { was_invoked_from_cargo } from "../../rustc_session/utils.ts";
import { Edition_discriminant } from "../../rustc_span/edition.ts";
import { path_file_stem, path_join, path_parent } from "../../std/path.ts";
import { type PathString, type Suggestion } from "./impls.gen.ts";
import { type DiagMetadata, type Rib } from "../late.gen.ts";
import { type AmbiguityError, type LateDecl, type ModuleOrUniformRoot, type PrivacyError, type Scope } from "../lib.gen.ts";
// PORT (init order): the bindings below are read inside function bodies only (ESM live bindings).

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

  // rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4312 check
  static check(krate: Crate, target_module: NodeId): [Span | undefined, FoundUse] {
    const finder = new UsePlacementFinder(target_module, undefined, undefined);
    finder.visit_crate(krate);
    if (finder.first_use_span !== undefined) {
      const use_span = finder.first_use_span;
      return [use_span, "Yes"];
    } else {
      return [finder.first_legal_span, "No"];
    }
  }
}

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4325 visit_crate
UsePlacementFinder.prototype.visit_crate = function (this: UsePlacementFinder, c: Crate): undefined {
  if (this.target_module === CRATE_NODE_ID) {
    const inject = c.spans.inject_use_span;
    if (is_span_suitable_for_use_injection(inject)) {
      this.first_legal_span = inject;
    }
    this.first_use_span = search_for_any_use_in_items(c.items);
  } else {
    visit.walk_crate(this, c);
  }
  return undefined;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4337 visit_item
UsePlacementFinder.prototype.visit_item = function (this: UsePlacementFinder, item: Item): undefined {
  if (this.target_module === item.id) {
    const kind = item.kind;
    if (kind.$ === "Mod" && kind._2.$ === "Loaded") {
      const items = kind._2._0;
      const mod_spans = kind._2._2;
      const inject = mod_spans.inject_use_span;
      if (is_span_suitable_for_use_injection(inject)) {
        this.first_legal_span = inject;
      }
      this.first_use_span = search_for_any_use_in_items(items);
    }
  } else {
    visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
  }
  return undefined;
};

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

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4359 visit_pat
BindingVisitor.prototype.visit_pat = function (this: BindingVisitor, pat: Pat): undefined {
  if (pat.kind.$ === "Ident") {
    const ident = pat.kind._1;
    this.identifiers.push(ident.name);
    let entry = this.spans.get(ident.name);
    if (entry === undefined) {
      entry = [];
      this.spans.set(ident.name, entry);
    }
    entry.push(ident.span);
  }
  visit.walk_pat(this, pat);
  return undefined;
};

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

/// Adjust the impl span so that just the `impl` keyword is taken by removing
/// everything after `<` (`"impl<T> Iterator for A<T> {}" -> "impl"`) and
/// everything after the first whitespace (`"impl Iterator for A" -> "impl"`).
///
/// *Attention*: the method used is very fragile since it essentially duplicates the work of the
/// parser. If you need to use this function or something similar, please consider updating the
/// `source_map` functions and this function to something more robust.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:135 reduce_impl_span_to_impl_keyword
export function reduce_impl_span_to_impl_keyword(sm: SourceMap, impl_span_: Span): Span {
  const impl_span = sm.span_until_char(impl_span_, 0x3c /* '<' */);
  return sm.span_until_whitespace(impl_span);
}
// ---- lane res-diag-b: `impl Resolver` methods, diagnostics/impls.rs:1978..3870 ----------------------

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1978 unresolved_macro_suggestions
Resolver.prototype.unresolved_macro_suggestions = function (
  this: Resolver,
  err: Diag,
  macro_kind: MacroKind,
  parent_scope: ParentScope,
  ident: Ident,
  krate: Crate,
  sugg_span: Span | undefined,
): void {
  // Bring all unused `derive` macros into `macro_map` so we ensure they can be used for
  // suggestions.
  this.register_macros_for_all_crates();

  const is_expected = (res: Res): boolean => {
    const k = hir_Res.macro_kinds(res);
    return k !== undefined && MacroKinds.contains(k, MacroKinds.from_MacroKind(macro_kind));
  };
  const suggestion = this.early_lookup_typo_candidate({ $: "Macro", _0: macro_kind }, parent_scope, ident, is_expected, (_) => true);
  this.add_typo_suggestion(err, suggestion, ident.span, undefined);
  this.detect_derive_attribute(err, ident, parent_scope, sugg_span);

  const import_suggestions = this.lookup_import_candidates(ident, "MacroNS", parent_scope, is_expected);
  let span: Span | undefined;
  let found_use: FoundUse;
  {
    const node_id = parent_scope.module.nearest_parent_mod_node_id();
    if (node_id === DUMMY_NODE_ID) {
      [span, found_use] = [undefined, "No"];
    } else {
      [span, found_use] = UsePlacementFinder.check(krate, node_id);
    }
  }
  show_candidates(this.tcx_, err, span, import_suggestions, "No", found_use, gen.DiagMode.Normal, [], "");

  if (macro_kind === MacroKind.Bang && ident.name === sym.macro_rules) {
    const label_span = SpanC.shrink_to_hi(ident.span);
    const spans = MultiSpan.from_span(label_span);
    spans.push_span_label(label_span, "put a macro name here");
    err.subdiagnostic(diagnostics.MaybeMissingMacroRulesName_subdiagnostic({ spans }));
    return;
  }

  if (macro_kind === MacroKind.Derive && (ident.name === sym.Send || ident.name === sym.Sync)) {
    err.subdiagnostic(diagnostics.ExplicitUnsafeTraits_subdiagnostic({ span: ident.span, ident }));
    return;
  }

  let unused_macro: [LocalDefId, Ident] | undefined;
  for (const [def_id, [, unused_ident]] of this.unused_macros) {
    if (unused_ident.name === ident.name) {
      unused_macro = [def_id, unused_ident];
      break;
    }
  }

  if (unused_macro !== undefined) {
    const [def_id, unused_ident] = unused_macro;
    const scope = unwrap(this.local_macro_def_scopes.get(def_id));
    const parent_nearest = parent_scope.module.nearest_parent_mod();
    const unused_macro_kinds = unwrap(this.local_macro_map.get(def_id)).macro_kinds();
    if (!MacroKinds.contains(unused_macro_kinds, MacroKinds.from_MacroKind(macro_kind))) {
      switch (macro_kind) {
        case "Bang":
          err.subdiagnostic(diagnostics.MacroRulesNot_subdiagnostic({ $: "Func", span: unused_ident.span, ident }));
          break;
        case "Attr":
          err.subdiagnostic(diagnostics.MacroRulesNot_subdiagnostic({ $: "Attr", span: unused_ident.span, ident }));
          break;
        case "Derive":
          err.subdiagnostic(diagnostics.MacroRulesNot_subdiagnostic({ $: "Derive", span: unused_ident.span, ident }));
          break;
      }
      return;
    }
    const scope_def_id = scope.opt_def_id();
    if (scope_def_id !== undefined && DefId_eq(parent_nearest.to_def_id(), scope_def_id)) {
      err.subdiagnostic(diagnostics.MacroDefinedLater_subdiagnostic({ span: unused_ident.span }));
      err.subdiagnostic(diagnostics.MacroSuggMovePosition_subdiagnostic({ span: ident.span, ident }));
      return;
    }
  }

  if (ident.name === kw.Default) {
    const kind = parent_scope.module.kind;
    if (kind.$ === "Def" && kind._0.$ === "Enum") {
      const def_id = kind._1;
      const span = this.def_span(def_id);
      const source_map = this.tcx_.sess.source_map();
      const head_span = source_map.guess_head_span(span);
      err.subdiagnostic(
        diagnostics.ConsiderAddingADerive_subdiagnostic({
          span: SpanC.shrink_to_lo(head_span),
          suggestion: "#[derive(Default)]\n",
        }),
      );
    }
  }
  for (const ns of ["MacroNS", "TypeNS", "ValueNS"] as const) {
    const r = this.cm().resolve_ident_in_scope_set(ident, { $: "All", _0: ns }, parent_scope, undefined, undefined, undefined);
    if (r.$ !== "Ok") {
      continue;
    }
    const binding = r._0;

    let desc: string;
    const res = binding.res();
    if (res.$ === "Def" && res._0.$ === "Macro" && res._0._0 === MacroKinds.BANG) {
      desc = "a function-like macro";
    } else if ((res.$ === "Def" && res._0.$ === "Macro" && res._0._0 === MacroKinds.ATTR) || res.$ === "NonMacroAttr") {
      desc = `an attribute: \`#[${display_Ident(ident)}]\``;
    } else if (res.$ === "Def" && res._0.$ === "Macro" && res._0._0 === MacroKinds.DERIVE) {
      desc = `a derive macro: \`#[derive(${display_Ident(ident)})]\``;
    } else if (res.$ === "Def" && res._0.$ === "Macro") {
      const kinds = res._0._0;
      desc = `${MacroKinds.article(kinds)} ${MacroKinds.descr(kinds)}`;
    } else if (res.$ === "ToolMod" || res.$ === "OpenMod") {
      // Don't confuse the user with tool modules or open modules.
      continue;
    } else if (res.$ === "Def" && res._0.$ === "Trait" && macro_kind === MacroKind.Derive) {
      const trait_def_id = res._1;
      if (binding.kind.$ === "Import" && !SpanC.is_dummy(binding.kind.import.span)) {
        this.record_use(ident, binding, "Other");
      }
      const trait_span = this.def_span(trait_def_id);
      err.span_note(trait_span, `\`${display_Ident(ident)}\` is a trait, not a derive macro`);
      err.help(`consider implementing \`${display_Ident(ident)}\` for your type manually`);
      return;
    } else {
      desc = `${hir_Res.article(res)} ${hir_Res.descr(res)}, not ${MacroKind.article(macro_kind)} ${MacroKind.descr_expected(macro_kind)}`;
    }
    if (binding.kind.$ === "Import" && !SpanC.is_dummy(binding.kind.import.span)) {
      const import_ = binding.kind.import;
      const note: diagnostics.IdentImporterHereButItIsDesc = {
        span: import_.span,
        imported_ident: ident,
        imported_ident_desc: desc,
      };
      err.subdiagnostic(diagnostics.IdentImporterHereButItIsDesc_subdiagnostic(note));
      // Silence the 'unused import' warning we might get,
      // since this diagnostic already covers that import.
      this.record_use(ident, binding, "Other");
      return;
    }
    const note: diagnostics.IdentInScopeButItIsDesc = {
      imported_ident: ident,
      imported_ident_desc: desc,
    };
    err.subdiagnostic(diagnostics.IdentInScopeButItIsDesc_subdiagnostic(note));
    return;
  }

  // Not in scope: check if the name refers to a trait importable from elsewhere.
  // An exact derive macro candidate is much more likely to be intended than any
  // same-named traits, so we only consider them if there are no import suggestions for the derive macro.
  if (macro_kind === MacroKind.Derive && import_suggestions.length === 0) {
    const trait_candidates = this.lookup_import_candidates(ident, "TypeNS", parent_scope, (res) => res.$ === "Def" && res._0.$ === "Trait");
    const seen: Set<DefId> = new KeyedSet(DefId_key);
    for (const candidate of trait_candidates) {
      const def_id = candidate.did;
      if (def_id !== undefined && !seen.has(def_id)) {
        seen.add(def_id);
        err.span_note(this.def_span(def_id), `\`${display_Ident(ident)}\` is a trait, not a derive macro`);
      }
    }
    if (seen.size !== 0) {
      err.help(`consider implementing \`${display_Ident(ident)}\` for your type manually`);
      return;
    }
  }

  if (this.macro_names.has(IdentKey.new(ident))) {
    err.subdiagnostic(diagnostics.AddedMacroUse_subdiagnostic({}));
    return;
  }
};

/// Given an attribute macro that failed to be resolved, look for `derive` macros that could
/// provide it, either as-is or with small typos.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2177 detect_derive_attribute
Resolver.prototype.detect_derive_attribute = function (
  this: Resolver,
  err: Diag,
  ident: Ident,
  parent_scope: ParentScope,
  sugg_span: Span | undefined,
): void {
  // Find all of the `derive`s in scope and collect their corresponding declared
  // attributes.
  // FIXME: this only works if the crate that owns the macro that has the helper_attr
  // has already been imported.
  const derives_syms: Symbol[] = [];
  const all_attrs: Map<Symbol, Symbol[]> = new Map();
  // We're collecting these in a hashmap, and handle ordering the output further down.
  // PORT: the hash-map iteration order does not reach the output: `derives` and each `all_attrs` entry are
  // sorted and deduplicated below, and `all_attrs`' keys are taken in stable (string) order.
  const macros_iter: [DefId, SyntaxExtension][] = [];
  for (const [local_id, ext] of this.local_macro_map) macros_iter.push([LocalDefId.to_def_id(local_id), ext]);
  for (const [id, d] of this.extern_macro_map) macros_iter.push([id, d]);
  for (const [def_id, ext] of macros_iter) {
    for (const helper_attr of ext.helper_attrs) {
      const item_name = this.tcx_.item_name(def_id);
      let entry = all_attrs.get(helper_attr);
      if (entry === undefined) {
        entry = [];
        all_attrs.set(helper_attr, entry);
      }
      entry.push(item_name);
      if (helper_attr === ident.name) {
        derives_syms.push(item_name);
      }
    }
  }
  const kind = MacroKind.descr(MacroKind.Derive);
  if (derives_syms.length !== 0) {
    // We found an exact match for the missing attribute in a `derive` macro. Suggest it.
    let derives: string[] = derives_syms.map((d) => display_Symbol(d));
    derives.sort(str_cmp);
    derives = vec_dedup(derives);
    let msg: string;
    if (derives.length === 1) {
      msg = ` \`${derives[0]!}\``;
    } else if (derives.length >= 1) {
      const start = derives.slice(0, -1);
      const last = derives[derives.length - 1]!;
      msg = `s ${start.map((d) => `\`${d}\``).join(", ")} and \`${last}\``;
    } else {
      return unreachable("internal error: entered unreachable code: we checked for this to be non-empty 10 lines above!?");
    }
    msg = `\`${display_Symbol(ident.name)}\` is an attribute that can be used by the ${kind}${msg}, you might be missing a \`derive\` attribute`;
    let sugg_span_: Span | undefined;
    const mkind = parent_scope.module.kind;
    if (mkind.$ === "Def" && mkind._0.$ === "Enum") {
      const id = mkind._1;
      const span = this.def_span(id);
      if (SpanC.from_expansion(span)) {
        sugg_span_ = undefined;
      } else {
        // For enum variants sugg_span is empty but we can get the enum's Span.
        sugg_span_ = SpanC.shrink_to_lo(span);
      }
    } else {
      // For items this `Span` will be populated, everything else it'll be None.
      sugg_span_ = sugg_span;
    }
    if (sugg_span_ !== undefined) {
      err.span_suggestion_verbose(sugg_span_, msg, `#[derive(${derives.join(", ")})]\n`, "MaybeIncorrect");
    } else {
      err.note(msg);
    }
  } else {
    // We didn't find an exact match. Look for close matches. If any, suggest fixing typo.
    const all_attr_names = [...all_attrs.keys()].sort((a, b) => str_cmp(SymbolC.as_str(a), SymbolC.as_str(b)));
    const best_match = find_best_match_for_name(all_attr_names, ident.name, undefined);
    const macros_syms = best_match !== undefined ? all_attrs.get(best_match) : undefined;
    if (best_match !== undefined && macros_syms !== undefined) {
      let macros: string[] = macros_syms.map((d) => display_Symbol(d));
      macros.sort(str_cmp);
      macros = vec_dedup(macros);
      let msg: string;
      if (macros.length === 0) {
        return;
      } else if (macros.length === 1) {
        msg = ` \`${macros[0]!}\` accepts`;
      } else {
        const start = macros.slice(0, -1);
        const end = macros[macros.length - 1]!;
        msg = `s ${start.map((m) => `\`${m}\``).join(", ")} and \`${end}\` accept`;
      }
      msg = `the ${kind}${msg} the similarly named \`${display_Symbol(best_match)}\` attribute`;
      err.span_suggestion_verbose(ident.span, msg, display_Symbol(best_match), "MaybeIncorrect");
    }
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2279 add_typo_suggestion
Resolver.prototype.add_typo_suggestion = function (
  this: Resolver,
  err: Diag,
  suggestion_: TypoSuggestion | undefined,
  span: Span,
  prefix: Ident | undefined,
): void {
  if (suggestion_ === undefined) return;
  // We shouldn't suggest underscore.
  if (suggestion_.candidate === kw.Underscore) return;
  const suggestion = suggestion_;

  let did_label_def_span = false;

  const sugg_def_id = hir_Res.opt_def_id(suggestion.res);
  const def_span = sugg_def_id === undefined ? undefined : this.def_span(sugg_def_id);
  if (def_span !== undefined) {
    if (SpanC.overlaps(span, def_span)) {
      // Don't suggest typo suggestion for itself like in the following:
      // error[E0423]: expected function, tuple struct or tuple variant, found struct `X`
      //   --> $DIR/unicode-string-literal-syntax-error-64792.rs:4:14
      //    |
      // LL | struct X {}
      //    | ----------- `X` defined here
      // LL |
      // LL | const Y: X = X("ö");
      //    | -------------^^^^^^- similarly named constant `Y` defined here
      //    |
      // help: use struct literal syntax instead
      //    |
      // LL | const Y: X = X {};
      //    |              ^^^^
      // help: a constant with a similar name exists
      //    |
      // LL | const Y: X = Y("ö");
      //    |              ^
      return;
    }
    if (SpanC.in_derive_expansion(span)) {
      return;
    }
    const span_ = this.tcx_.sess.source_map().guess_head_span(def_span);
    const candidate_descr = hir_Res.descr(suggestion.res);
    const candidate = suggestion.candidate;
    let label: diagnostics.DefinedHere;
    switch (suggestion.target) {
      case "SimilarlyNamed":
        label = { $: "SimilarlyNamed", span: span_, candidate_descr, candidate };
        break;
      case "SingleItem":
        label = { $: "SingleItem", span: span_, candidate_descr, candidate };
        break;
    }
    did_label_def_span = true;
    err.subdiagnostic(diagnostics.DefinedHere_subdiagnostic(label));
  }

  let sugg_span: Span;
  let msg: string;
  let sugg: string;
  const snippet_r = suggestion.target === "SimilarlyNamed" ? this.tcx_.sess.source_map().span_to_snippet(span) : undefined;
  const snippet = snippet_r !== undefined && snippet_r.$ === "Ok" ? snippet_r._0.toString() : undefined;
  const cand_str = SymbolC.as_str(suggestion.candidate);
  const stripped = cand_str.startsWith("_") ? cand_str.slice(1) : undefined;
  if (snippet !== undefined && suggestion.span !== undefined && stripped !== undefined && snippet === stripped) {
    const span_ = suggestion.span;
    const candidate = suggestion.candidate;
    // When the suggested binding change would be from `x` to `_x`, suggest changing the
    // original binding definition instead. (#60164)
    const msg_ = `the leading underscore in \`${display_Symbol(candidate)}\` marks it as unused, consider renaming it to \`${snippet}\``;
    if (!did_label_def_span) {
      err.span_note(span_, `\`${display_Symbol(candidate)}\` defined here`);
    }
    [sugg_span, msg, sugg] = [span_, msg_, snippet];
  } else {
    let msg_: string;
    switch (suggestion.target) {
      case "SimilarlyNamed":
        msg_ = `${hir_Res.article(suggestion.res)} ${hir_Res.descr(suggestion.res)} with a similar name exists`;
        break;
      case "SingleItem":
        msg_ = `maybe you meant this ${hir_Res.descr(suggestion.res)}`;
        break;
    }
    const candidate_str = SymbolC.to_ident_string(suggestion.candidate);
    const sugg_ = prefix !== undefined ? `${display_Ident(prefix)}: ${candidate_str}` : candidate_str;
    [sugg_span, msg, sugg] = [span, msg_, sugg_];
  }
  err.span_suggestion_verbose(sugg_span, msg, sugg, "MaybeIncorrect");
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2370 decl_description
Resolver.prototype.decl_description = function (this: Resolver, b: Decl, ident: Ident, scope: Scope): string {
  const res = b.res();
  if (SpanC.is_dummy(b.span) || !this.tcx_.sess.source_map().is_span_accessible(b.span)) {
    let built_in: string;
    let from: string;
    if (scope.$ === "StdLibPrelude" || scope.$ === "MacroUsePrelude") {
      [built_in, from] = ["", " from prelude"];
    } else if (scope.$ === "ExternPreludeFlags" && (this.tcx_.sess.opts.externs.get(ident.as_str()) !== undefined || res.$ === "OpenMod")) {
      [built_in, from] = ["", " passed with `--extern`"];
    } else {
      if (res.$ === "NonMacroAttr" || res.$ === "PrimTy" || res.$ === "ToolMod") {
        // These already contain the "built-in" prefix or look bad with it.
        [built_in, from] = ["", ""];
      } else {
        [built_in, from] = [" built-in", ""];
      }
    }

    const a = built_in === "" ? hir_Res.article(res) : "a";
    return `${a}${built_in} ${hir_Res.descr(res)}${from}`;
  } else {
    const introduced = b.is_import_user_facing() ? "imported" : "defined";
    return `the ${hir_Res.descr(res)} ${introduced} here`;
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2399 ambiguity_diagnostic
Resolver.prototype.ambiguity_diagnostic = function (this: Resolver, ambiguity_error: AmbiguityError): diagnostics.Ambiguity {
  const { kind, ambig_vis, ident } = ambiguity_error;
  let { b1, b2, scope1, scope2 } = ambiguity_error;
  // PORT: the closure captures the bindings of the destructuring (before the swap below shadows them).
  const orig_b1 = b1;
  const orig_scope2 = scope2;
  const extern_prelude_ambiguity = (): boolean => {
    // Note: b1 may come from a module scope, as an extern crate item in module.
    if (orig_scope2.$ !== "ExternPreludeFlags") return false;
    const entry = this.extern_prelude.get(IdentKey.new(ident));
    return entry !== undefined && entry.item_decl !== undefined && entry.item_decl[0] === orig_b1;
  };
  let swapped: boolean;
  if (SpanC.is_dummy(b2.span) && !SpanC.is_dummy(b1.span)) {
    // We have to print the span-less alternative first, otherwise formatting looks bad.
    [b1, b2, scope1, scope2, swapped] = [b2, b1, scope2, scope1, true];
  } else {
    [b1, b2, scope1, scope2, swapped] = [b1, b2, scope1, scope2, false];
  }

  const could_refer_to = (b: Decl, scope: Scope, also: string): [Spanned<string>, string[]] => {
    const what = this.decl_description(b, ident, scope);
    const note_msg = `\`${display_Ident(ident)}\` could${also} refer to ${what}`;

    const thing = hir_Res.descr(b.res());
    const help_msgs: string[] = [];
    if (
      b.is_glob_import() &&
      (kind === "GlobVsGlob" || kind === "GlobVsExpanded" || (kind === "GlobVsOuter" && swapped !== (also === "")))
    ) {
      help_msgs.push(`consider adding an explicit import of \`${display_Ident(ident)}\` to disambiguate`);
    }
    if (b.is_extern_crate() && SpanC.at_least_rust_2018(ident.span) && !extern_prelude_ambiguity()) {
      help_msgs.push(`use \`::${display_Ident(ident)}\` to refer to this ${thing} unambiguously`);
    }

    if (kind !== "GlobVsGlob") {
      if (scope.$ === "ModuleNonGlobs" || scope.$ === "ModuleGlobs") {
        const module = scope._0;
        if (module === this.graph_root.to_module()) {
          help_msgs.push(`use \`crate::${display_Ident(ident)}\` to refer to this ${thing} unambiguously`);
        } else if (module.is_normal()) {
          help_msgs.push(`use \`self::${display_Ident(ident)}\` to refer to this ${thing} unambiguously`);
        }
      }
    }

    return [
      { node: note_msg, span: b.span },
      help_msgs.map((help_msg, i) => {
        const or = i === 0 ? "" : "or ";
        return `${or}${help_msg}`;
      }),
    ];
  };
  const [b1_note, b1_help_msgs] = could_refer_to(b1, scope1, "");
  const [b2_note, b2_help_msgs] = could_refer_to(b2, scope2, " also");
  const b1_parent_def_id = b1.parent_module?.opt_def_id();
  const help =
    kind === "GlobVsGlob" && (b1_parent_def_id !== undefined ? !b1_parent_def_id.is_local() : false)
      ? [
          "consider updating this dependency to resolve this error",
          "if updating the dependency does not resolve the problem report the problem to the author of the relevant crate",
        ]
      : undefined;

  const ambig_vis_ =
    ambig_vis === undefined
      ? undefined
      : `${Visibility.to_string(ambig_vis[0], CRATE_DEF_ID, this.tcx_)} or ${Visibility.to_string(ambig_vis[1], CRATE_DEF_ID, this.tcx_)}`;

  return {
    ident,
    help,
    ambig_vis: ambig_vis_,
    kind: AmbiguityKind.descr(kind),
    b1_note,
    b1_help_msgs,
    b2_note,
    b2_help_msgs,
    is_error: false,
  };
};

/// If the binding refers to a tuple struct constructor with fields,
/// returns the span of its fields.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2506 ctor_fields_span
Resolver.prototype.ctor_fields_span = function (this: Resolver, decl: Decl): Span | undefined {
  const k = decl.kind;
  if (!(k.$ === "Def" && k._0.$ === "Def" && k._0._0.$ === "Ctor" && k._0._0._0 === "Struct" && k._0._0._1 === "Fn")) {
    return undefined;
  }
  const ctor_def_id = k._0._1;

  const def_id = this.tcx_.parent(ctor_def_id);
  const fields = this.field_idents(def_id);
  if (fields === undefined) return undefined;
  // `.reduce(Span::to)`: `None` for `struct Foo()`
  let acc: Span | undefined;
  for (const f of fields) acc = acc === undefined ? f.span : SpanC.to(acc, f.span);
  return acc;
};

/// Returns the path segments (as symbols) of a module, including `kw::Crate` at the start.
/// For example, for `crate::foo::bar`, returns `[Crate, foo, bar]`.
/// Returns `None` for block modules that don't have a `DefId`.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2520 module_path_names
Resolver.prototype.module_path_names = function (this: Resolver, module: Module): Symbol[] | undefined {
  const path: Symbol[] = [];
  let def_id = module.opt_def_id();
  if (def_id === undefined) return undefined;
  for (;;) {
    const parent = this.tcx_.opt_parent(def_id);
    if (parent === undefined) break;
    const name = this.tcx_.opt_item_name(def_id);
    if (name !== undefined) {
      path.push(name);
    }
    if (parent.is_top_level_module()) {
      break;
    }
    def_id = parent;
  }
  path.reverse();
  path.unshift(kw.Crate);
  return path;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2537 shorten_candidate_path
Resolver.prototype.shorten_candidate_path = function (this: Resolver, suggestion: ImportSuggestion, current_module: Module): void {
  this.shorten_import_path(suggestion.did, suggestion.path, current_module);
};

/// Shortens an import path to use `super::` (up to 1 level) or `self::` (same module)
/// relative to the current scope, if possible. Only applies to crate-local items and
/// only when the resulting path is actually shorter than the original.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2548 shorten_import_path
Resolver.prototype.shorten_import_path = function (this: Resolver, did: DefId | undefined, path: Path, current_module: Module): void {
  const MAX_SUPER_PATH_ITEMS_IN_SUGGESTION = 1;

  // Only shorten local items.
  if (did === undefined || !did.is_local()) {
    return;
  }

  // Build current module path: [Crate, foo, bar, ...].
  const current_mod_path = this.module_path_names(current_module);
  if (current_mod_path === undefined) {
    return;
  }

  // Normalise candidate path: filter out `PathRoot` (`::`), and if the path
  // doesn't start with `Crate`, prepend it (edition 2015 paths are relative
  // to the crate root without an explicit `crate::` prefix).
  let candidate_names: Symbol[];
  {
    const filtered_segments = path.segments.filter((segment) => segment.ident.name !== kw.PathRoot);

    const names: Symbol[] = filtered_segments.map((segment) => segment.ident.name);
    if (names[0] !== kw.Crate) {
      names.unshift(kw.Crate);
    }
    if (names.length < 2) {
      return;
    }
    candidate_names = names;
  }

  // The candidate's module path is everything except the last segment (the item name).
  const candidate_mod_names = candidate_names.slice(0, candidate_names.length - 1);

  // Find the longest common prefix between the current module and candidate module paths.
  let common_prefix_length = 0;
  while (
    common_prefix_length < current_mod_path.length &&
    common_prefix_length < candidate_mod_names.length &&
    current_mod_path[common_prefix_length] === candidate_mod_names[common_prefix_length]
  ) {
    common_prefix_length++;
  }

  // Non-crate-local item; keep the full absolute path.
  if (common_prefix_length === 0) {
    return;
  }

  const super_count = current_mod_path.length - common_prefix_length;

  // At the crate root, `use` paths resolve from the crate root anyway, so we can
  // drop the `crate::` prefix entirely instead of replacing it with `self::`.
  const at_crate_root = current_mod_path.length === 1;

  let new_segments: PathSegment[];
  if (super_count === 0 && at_crate_root) {
    new_segments = [];
  } else {
    let prefix_keyword: Symbol;
    if (super_count === 0) {
      prefix_keyword = kw.SelfLower;
    } else if (super_count >= 1 && super_count <= MAX_SUPER_PATH_ITEMS_IN_SUGGESTION) {
      prefix_keyword = kw.Super;
    } else {
      return; // Too many `super` levels; keep the full absolute path.
    }
    new_segments = [PathSegment.from_ident(Ident.with_dummy_span(prefix_keyword))];
  }
  for (const name of candidate_names.slice(common_prefix_length)) {
    new_segments.push(PathSegment.from_ident(Ident.with_dummy_span(name)));
  }

  // Only apply if the result is strictly shorter than the original path.
  if (new_segments.length >= path.segments.length) {
    return;
  }

  // `*path = Path { span: path.span, segments: new_segments }`
  path.segments = new_segments;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2627 report_privacy_error
Resolver.prototype.report_privacy_error = function (this: Resolver, privacy_error: PrivacyError): void {
  const { ident, decl, outermost_res, parent_scope, single_nested, dedup_span, source } = privacy_error;

  const res = decl.res();
  const ctor_fields_span = this.ctor_fields_span(decl);
  const plain_descr = hir_Res.descr(res);
  const nonimport_descr = ctor_fields_span !== undefined ? plain_descr + " constructor" : plain_descr;
  const import_descr = nonimport_descr + " import";
  const get_descr = (b: Decl): string => (b.is_import() ? import_descr : nonimport_descr);

  // Print the primary message.
  const ident_descr = get_descr(decl);
  const err = this.dcx().create_err(diagnostics.IsPrivate_diagnostic({ span: ident.span, ident_descr, ident }));

  this.mention_default_field_values(source, ident, err);

  let shown_candidates: boolean;
  if (outermost_res !== undefined) {
    const [this_res, outer_ident] = outermost_res;
    const import_suggestions = this.lookup_import_candidates(outer_ident, hir_Res.ns(this_res) ?? "TypeNS", parent_scope, (res: Res) => Res_eq(res, this_res));
    // Shorten candidate paths using `super::` or `self::` when possible.
    for (const suggestion of import_suggestions) {
      this.shorten_candidate_path(suggestion, parent_scope.module);
    }
    const point_to_def = !show_candidates(
      this.tcx_,
      err,
      SpanC.until(dedup_span, SpanC.shrink_to_hi(outer_ident.span)),
      import_suggestions,
      "Yes",
      "Yes",
      { $: "Import", append: single_nested, unresolved_import: false },
      [],
      "",
    );
    // If we suggest importing a public re-export, don't point at the definition.
    if (point_to_def && ident.span !== outer_ident.span) {
      const label: diagnostics.OuterIdentIsNotPubliclyReexported = {
        span: outer_ident.span,
        outer_ident_descr: hir_Res.descr(this_res),
        outer_ident,
      };
      err.subdiagnostic(diagnostics.OuterIdentIsNotPubliclyReexported_subdiagnostic(label));
    }
    shown_candidates = !point_to_def;
  } else {
    shown_candidates = false;
  }

  let non_exhaustive: Span | undefined = undefined;
  // If an ADT is foreign and marked as `non_exhaustive`, then that's
  // probably why we have the privacy error.
  // Otherwise, point out if the struct has any private fields.
  const res_def_id = hir_Res.opt_def_id(res);
  // PORT: `find_attr!(self.tcx, def_id, ..)` on a non-local `DefId` is `find_attr(tcx.attrs_for_def(def_id), ..)`
  // (`impl HasAttrs for DefId`, ty/mod.rs:2349; the local branch needs HIR and is never reached here).
  const attr_span =
    res_def_id !== undefined && !res_def_id.is_local()
      ? find_attr(this.tcx_.attrs_for_def(res_def_id) as readonly HirAttribute[], (k) => (k.$ === "NonExhaustive" ? k._0 : undefined))
      : undefined;
  if (attr_span !== undefined) {
    non_exhaustive = attr_span;
  } else if (ctor_fields_span !== undefined) {
    const span = ctor_fields_span;
    const label: diagnostics.ConstructorPrivateIfAnyFieldPrivate = { span };
    err.subdiagnostic(diagnostics.ConstructorPrivateIfAnyFieldPrivate_subdiagnostic(label));
    const fields = res.$ === "Def" ? this.field_visibility_spans.get(res._1) : undefined;
    if (fields !== undefined) {
      const spans = fields.slice();
      const sugg: diagnostics.ConsiderMakingTheFieldPublic = {
        spans,
        number_of_fields: fields.length,
      };
      err.subdiagnostic(diagnostics.ConsiderMakingTheFieldPublic_subdiagnostic(sugg));
    }
  }

  const sugg_paths: [Ident[], boolean][] = [];
  if (res_def_id !== undefined) {
    let def_id = res_def_id;
    // We can't use `def_path_str` in resolve.
    const path = [def_id];
    for (;;) {
      const parent = this.tcx_.opt_parent(def_id);
      if (parent === undefined) break;
      def_id = parent;
      if (!def_id.is_top_level_module()) {
        path.push(def_id);
      } else {
        break;
      }
    }
    // We will only suggest importing directly if it is accessible through that path.
    let path_names: Ident[] | undefined = [];
    for (const def_id of path.slice().reverse()) {
      const name = this.tcx_.opt_item_name(def_id);
      if (name === undefined) {
        path_names = undefined;
        break;
      }
      path_names.push(Ident.with_dummy_span(def_id.is_top_level_module() ? kw.Crate : name));
    }
    const def_id0 = path[0];
    if (def_id0 !== undefined && path_names !== undefined) {
      const path = path_names;
      const local = def_id0.as_local();
      if (local !== undefined) {
        if (this.effective_visibilities.is_directly_public(local)) {
          sugg_paths.push([path, false]);
        }
      } else if (this.is_accessible_from(this.tcx_.visibility(def_id0), parent_scope.module)) {
        sugg_paths.push([path, false]);
      }
    }
  }

  // Print the whole import chain to make it easier to see what happens.
  const first_binding = decl;
  let next_binding: Decl | undefined = decl;
  let next_ident = ident;
  while (next_binding !== undefined) {
    const binding: Decl = next_binding;
    const name = next_ident;
    const bk = binding.kind;
    if (res.$ === "Err") {
      next_binding = undefined;
    } else if (bk.$ === "Import") {
      const { source_decl, import: import_ } = bk;
      const ik = import_.kind;
      if (SpanC.is_dummy(source_decl.span)) {
        next_binding = undefined;
      } else if (ik.$ === "Single") {
        next_ident = ik.source;
        next_binding = source_decl;
      } else if (ik.$ === "Glob" || ik.$ === "MacroUse" || ik.$ === "MacroExport") {
        next_binding = source_decl;
      } else {
        // `ImportKind::ExternCrate { .. }`
        next_binding = undefined;
      }
    } else {
      next_binding = undefined;
    }

    switch (bk.$) {
      case "Import": {
        const { source_decl, import: import_ } = bk;
        const through_reexport = source_decl.kind.$ !== "Def";
        const first_seg = import_.module_path[0];
        const uses_relative_path = first_seg !== undefined && (first_seg.ident.name === kw.SelfLower || first_seg.ident.name === kw.Super);
        const res_def_id = hir_Res.opt_def_id(res);
        let path: Ident[] | undefined;
        if (uses_relative_path) {
          // A path recovered from `self`/`super` is only useful if both the
          // target and every module segment can be named from the failing use site.
          let module_path: Symbol[] | undefined;
          const imported_module = import_.imported_module.get();
          let module_path_: Symbol[] | undefined;
          let mod_def_id: DefId | undefined;
          if (
            imported_module !== undefined &&
            imported_module.$ === "Module" &&
            imported_module._0.is_local() &&
            (module_path_ = this.module_path_names(imported_module._0)) !== undefined &&
            (mod_def_id = imported_module._0.opt_def_id()) !== undefined &&
            (res_def_id === undefined || this.is_accessible_from(this.tcx_.visibility(res_def_id), parent_scope.module))
          ) {
            let def_id = mod_def_id;
            // `module_path_names` tells us the resolved module's canonical path.
            // Before suggesting that path from the failing use site, make sure
            // every segment in it can actually be named from there.
            let visible_from_use_site = true;
            for (;;) {
              const parent = this.tcx_.opt_parent(def_id);
              if (parent === undefined) break;
              if (!this.is_accessible_from(this.tcx_.visibility(def_id), parent_scope.module)) {
                visible_from_use_site = false;
                break;
              }
              if (parent.is_top_level_module()) {
                break;
              }
              def_id = parent;
            }
            module_path = visible_from_use_site ? module_path_ : undefined;
          } else {
            module_path = undefined;
          }

          if (module_path !== undefined) {
            // `import.module_path` is relative to the import's module, not to the
            // failing use site.
            const path_ = new Path(
              ident.span,
              [...module_path, ident.name].map((name) => PathSegment.from_ident(Ident.with_dummy_span(name))),
            );
            this.shorten_import_path(res_def_id, path_, parent_scope.module);
            path = path_.segments.map((seg) => seg.ident);
          } else {
            path = undefined;
          }
        } else {
          // Don't include `{{root}}` in suggestions - it's an internal symbol
          // that should never be shown to users.
          path = [...import_.module_path.filter((seg) => seg.ident.name !== kw.PathRoot).map((seg) => seg.ident), ident];
        }
        if (path !== undefined) {
          sugg_paths.push([path, through_reexport]);
        }
        break;
      }
      case "Def":
        break;
    }
    const first = binding === first_binding;
    const def_span = this.tcx_.sess.source_map().guess_head_span(binding.span);
    const note_span = MultiSpan.from_span(def_span);
    if (!first && Visibility.is_public(binding.vis())) {
      const desc = bk.$ === "Import" ? "re-export" : "directly";
      note_span.push_span_label(def_span, `you could import this ${desc}`);
    }
    // Final step in the import chain, point out if the ADT is `non_exhaustive`
    // which is probably why this privacy violation occurred.
    if (next_binding === undefined && non_exhaustive !== undefined) {
      const span = non_exhaustive;
      note_span.push_span_label(span, "cannot be constructed because it is `#[non_exhaustive]`");
    }
    const note: diagnostics.NoteAndRefersToTheItemDefinedHere = {
      span: note_span,
      binding_descr: get_descr(binding),
      binding_name: name,
      first,
      dots: next_binding !== undefined,
    };
    err.subdiagnostic(diagnostics.NoteAndRefersToTheItemDefinedHere_subdiagnostic(note));
  }
  // The suggestion replaces `dedup_span` with a path reaching the failing ident.
  // That's valid only when
  // 1) the failing ident is the imported leaf, otherwise `as` renames and trailing segments
  //    get dropped, and
  // 2) the use isn't nested, otherwise `dedup_span` is one ident in `{...}`.
  //
  // See issue #156060.
  const can_replace_use = !shown_candidates && !single_nested && !(outermost_res !== undefined && outermost_res[1].span !== ident.span);
  if (can_replace_use) {
    // We prioritize shorter paths, non-core imports and direct imports over the
    // alternatives.
    sort_by_key_stable(sugg_paths, ([p, reexport]) => [p.length, p[0]!.name === sym.core, reexport] as const, cmp_key3);
    for (const [sugg, reexport] of sugg_paths) {
      if (sugg.length <= 1) {
        // A single path segment suggestion is wrong. This happens on circular
        // imports. `tests/ui/imports/issue-55884-2.rs`
        continue;
      }
      const path = join_path_idents(sugg);
      const sugg_: diagnostics.ImportIdent = reexport
        ? { $: "ThroughReExport", span: dedup_span, ident, path }
        : { $: "Directly", span: dedup_span, ident, path };
      err.subdiagnostic(diagnostics.ImportIdent_subdiagnostic(sugg_));
      break;
    }
  }
  err.emit();
};

/// When a private field is being set that has a default field value, we suggest using `..` and
/// setting the value of that field implicitly with its default.
///
/// If we encounter code like
/// ```text
/// struct Priv;
/// pub struct S {
///     pub field: Priv = Priv,
/// }
/// ```
/// which is used from a place where `Priv` isn't accessible
/// ```text
/// let _ = S { field: m::Priv1 {} };
/// //                    ^^^^^ private struct
/// ```
/// we will suggest instead using the `default_field_values` syntax instead:
/// ```text
/// let _ = S { .. };
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2935 mention_default_field_values
Resolver.prototype.mention_default_field_values = function (this: Resolver, source: Expr | undefined, ident: Ident, err: Diag): void {
  const expr = source;
  if (expr === undefined) return;
  if (expr.kind.$ !== "Struct") return;
  const struct_expr = expr.kind._0;
  // We don't have to handle type-relative paths because they're forbidden in ADT
  // expressions, but that would change with `#[feature(more_qualified_paths)]`.
  const segment = struct_expr.path.segments[struct_expr.path.segments.length - 1];
  if (segment === undefined) return;
  const partial_res = this.partial_res_map.get(segment.id);
  if (partial_res === undefined) return;
  const full_res = partial_res.full_res();
  if (full_res === undefined || full_res.$ !== "Def") {
    return;
  }
  const def_id = full_res._1;
  const default_fields = this.field_defaults(def_id);
  if (default_fields === undefined) return;
  if (struct_expr.fields.length === 0) {
    return;
  }
  const last_span = struct_expr.fields[struct_expr.fields.length - 1]!.span;
  const fields = struct_expr.fields;
  let prev: Span | undefined = undefined;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (SpanC.overlaps(field.expr.span, ident.span)) {
      err.span_label(field.ident.span, "while setting this field");
      if (default_fields.includes(field.ident.name)) {
        let sugg: [Span, string][];
        if (last_span === field.span) {
          sugg = [[field.span, ".."]];
        } else {
          // Account for trailing commas and ensure we remove them.
          const next = fields[i + 1];
          let span: Span;
          if (next !== undefined) {
            span = SpanC.with_hi(field.span, SpanC.lo(next.span));
          } else if (prev !== undefined) {
            span = SpanC.with_lo(field.span, SpanC.hi(prev));
          } else {
            span = field.span;
          }
          sugg = [
            [span, ""],
            [SpanC.shrink_to_hi(last_span), ", .."],
          ];
        }
        err.multipart_suggestion(
          `the type \`${display_Ident(ident)}\` of field \`${display_Ident(field.ident)}\` is private, but you can construct the default value defined for it in \`${display_Symbol(this.tcx_.item_name(def_id))}\` using \`..\` in the struct initializer expression`,
          sugg,
          "MachineApplicable",
        );
        break;
      }
    }
    prev = field.span;
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:2995 find_similarly_named_module_or_crate
Resolver.prototype.find_similarly_named_module_or_crate = function (this: Resolver, ident: Symbol, current_module: Module): Symbol | undefined {
  const candidates: Symbol[] = [];
  for (const k of this.extern_prelude.keys()) candidates.push(k.name);
  for (const [, m] of this.local_module_map) {
    const module = m.to_module();
    if (current_module.is_ancestor_of(module) && current_module !== module) {
      const name = module.name();
      if (name !== undefined) candidates.push(name);
    }
  }
  for (const [, m] of this.extern_module_map) {
    const module = m.to_module();
    if (current_module.is_ancestor_of(module) && current_module !== module) {
      const name = module.name();
      if (name !== undefined) candidates.push(name);
    }
  }
  let filtered = candidates.filter((c) => display_Symbol(c) !== "");
  // `Symbol`'s `Ord` is its index order.
  filtered.sort((a, b) => a - b);
  filtered = vec_dedup(filtered);
  const sugg = find_best_match_for_name(filtered, ident, undefined);
  return sugg !== undefined && sugg !== ident ? sugg : undefined;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3030 report_path_resolution_error
Resolver.prototype.report_path_resolution_error = function (
  this: Resolver,
  path: readonly Segment[],
  opt_ns: Namespace | undefined, // `None` indicates a module path in import
  parent_scope: ParentScope,
  ribs: PerNS<Rib[]> | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
  module: ModuleOrUniformRoot | undefined,
  failed_segment_idx: number,
  ident: Ident,
  diag_metadata: DiagMetadata | undefined,
): [string, string, Suggestion | undefined, string | undefined] {
  const is_last = failed_segment_idx === path.length - 1;
  const ns: Namespace = is_last ? (opt_ns ?? "TypeNS") : "TypeNS";
  const module_def_id = module !== undefined && module.$ === "Module" ? module._0.opt_def_id() : undefined;
  let scope: string;
  if (failed_segment_idx >= 1) {
    const prev = path[failed_segment_idx - 1]!;
    if (prev.ident.name === kw.PathRoot && Edition_discriminant[this.tcx_.sess.edition()] > Edition_discriminant.Edition2015) {
      scope = "the list of imported crates";
    } else if (prev.ident.name === kw.PathRoot || prev.ident.name === kw.Crate) {
      scope = "the crate root";
    } else {
      scope = `\`${display_Ident(prev.ident)}\``;
    }
  } else {
    scope = "this scope";
  }
  const message = `cannot find \`${display_Ident(ident)}\` in ${scope}`;

  // we may have typo in the middle part of path, try find a candidate with a similar name
  // and then check whether it contains a candidate that is accessible from the current scope
  let typo_suggestion: Suggestion | undefined = undefined;
  if (opt_ns === undefined && ignore_import !== undefined && module !== undefined && module.$ === "Module") {
    const module_ = module._0;
    const candidate = this.early_lookup_typo_candidate(
      { $: "Module", _0: "TypeNS", _1: module_ },
      parent_scope,
      ident,
      (res) => res.$ === "Def" && (res._0.$ === "Mod" || res._0.$ === "Enum"),
      (candidate) => {
        const r = this.cm().resolve_ident_in_module(
          { $: "Module", _0: module_ },
          Ident.new(candidate.candidate, ident.span),
          "TypeNS",
          parent_scope,
          undefined,
          ignore_decl,
          ignore_import,
        );
        return r.$ === "Ok" && this.is_accessible_from(r._0.vis(), parent_scope.module);
      },
    );
    if (candidate !== undefined) {
      typo_suggestion = [
        [[ident.span, display_Ident(Ident.new(candidate.candidate, ident.span))]],
        `${hir_Res.article(candidate.res)} ${hir_Res.descr(candidate.res)} with a similar name exists`,
        "MaybeIncorrect",
      ];
    }
  }

  if (module_def_id !== undefined && DefId_eq(module_def_id, LocalDefId.to_def_id(CRATE_DEF_ID))) {
    const is_mod = (res: Res): boolean => res.$ === "Def" && res._0.$ === "Mod";
    const candidates = this.lookup_import_candidates(ident, "TypeNS", parent_scope, is_mod);
    sort_by_cached_key_stable(candidates, (c) => [c.path.segments.length, pprust.path_to_string(c.path)] as const, (a, b) => a[0] - b[0] || str_cmp(a[1], b[1]));
    const candidate = candidates[0];
    if (candidate !== undefined) {
      let path_: Path;
      {
        // remove the possible common prefix of the path
        const len = candidate.path.segments.length;
        let start_index = 0;
        for (let i = 0; i <= Math.min(failed_segment_idx, len - 1); i++) {
          if (path[i]!.ident.name !== candidate.path.segments[i]!.ident.name) {
            start_index = i;
            break;
          }
        }
        const segments: PathSegment[] = [];
        for (let s = start_index; s < len; s++) segments.push(clone_PathSegment(candidate.path.segments[s]!));
        path_ = new Path(DUMMY_SP, segments);
      }
      return [message, "unresolved import", [[[ident.span, pprust.path_to_string(path_)]], "a similar path exists", "MaybeIncorrect"], undefined];
    } else if (typo_suggestion !== undefined) {
      const suggestion = typo_suggestion;
      return [message, `could not find \`${display_Ident(ident)}\` in the crate root`, suggestion, undefined];
    } else if (ident.name === sym.core) {
      return [
        message,
        `you might be missing crate \`${display_Ident(ident)}\``,
        [[[ident.span, "std"]], "try using `std` instead of `core`", "MaybeIncorrect"],
        undefined,
      ];
    } else if (ident.name === kw.Underscore) {
      return ["invalid crate or module name `_`", "`_` is not a valid crate or module name", undefined, undefined];
    } else if (this.tcx_.sess.is_rust_2015()) {
      const crate_is_available = this.tcx_.sess.opts.externs.get(ident.as_str()) !== undefined;
      let suggestion_message: string;
      let help: string | undefined;
      if (crate_is_available) {
        const edition_help = `if you're trying to use a dependency named \`${display_Ident(ident)}\`, upgrade your edition to be able to reference it with a \`use\` declaration`;
        [suggestion_message, help] = ["on Rust 2015, `extern crate` is required to specify a dependency on an external crate", edition_help];
      } else if (was_invoked_from_cargo()) {
        [suggestion_message, help] = [
          `if you wanted to use a crate named \`${display_Ident(ident)}\`, use \`cargo add ${display_Ident(ident)}\` to add it to your \`Cargo.toml\` and import it in your code`,
          undefined,
        ];
      } else {
        [suggestion_message, help] = [
          `you might be missing a crate named \`${display_Ident(ident)}\`, add it to your project and import it in your code`,
          undefined,
        ];
      }
      return [
        `cannot find module or crate \`${display_Ident(ident)}\` in ${scope}`,
        `use of unresolved module or unlinked crate \`${display_Ident(ident)}\``,
        [
          [[this.current_crate_outer_attr_insert_span, `extern crate ${display_Ident(ident)};\n`]],
          suggestion_message,
          crate_is_available ? "MachineApplicable" : "MaybeIncorrect",
        ],
        help,
      ];
    } else {
      return [message, `could not find \`${display_Ident(ident)}\` in the crate root`, undefined, undefined];
    }
  } else if (failed_segment_idx > 0) {
    const parent_sym = path[failed_segment_idx - 1]!.ident.name;
    let parent: string;
    // ::foo is mounted at the crate root for 2015, and is the extern
    // prelude for 2018+
    if (parent_sym === kw.PathRoot && Edition_discriminant[this.tcx_.sess.edition()] > Edition_discriminant.Edition2015) {
      parent = "the list of imported crates";
    } else if (parent_sym === kw.PathRoot || parent_sym === kw.Crate) {
      parent = "the crate root";
    } else {
      parent = `\`${display_Symbol(parent_sym)}\``;
    }

    let msg = `could not find \`${display_Ident(ident)}\` in ${parent}`;
    if (ns === "TypeNS" || ns === "ValueNS") {
      const ns_to_try: Namespace = ns === "TypeNS" ? "ValueNS" : "TypeNS";
      let binding: Decl | undefined;
      if (module !== undefined) {
        const r = this.cm().resolve_ident_in_module(module, ident, ns_to_try, parent_scope, undefined, ignore_decl, ignore_import);
        binding = r.$ === "Ok" ? r._0 : undefined;
      } else if (ribs !== undefined && (opt_ns === "TypeNS" || opt_ns === "ValueNS")) {
        assert(ignore_import === undefined, "assertion failed: ignore_import.is_none()");
        const r = this.resolve_ident_in_lexical_scope(ident, ns_to_try, parent_scope, undefined, ribs.index(ns_to_try), ignore_decl, diag_metadata);
        // we found a locally-imported or available item/module
        binding = r !== undefined && r.$ === "Decl" ? r._0 : undefined;
      } else {
        const r = this.cm().resolve_ident_in_scope_set(ident, { $: "All", _0: ns_to_try }, parent_scope, undefined, ignore_decl, ignore_import);
        binding = r.$ === "Ok" ? r._0 : undefined;
      }
      if (binding !== undefined) {
        msg = `expected ${Namespace.descr(ns)}, found ${hir_Res.descr(binding.res())} \`${display_Ident(ident)}\` in ${parent}`;
      }
    }
    return [message, msg, typo_suggestion, undefined];
  } else if (ident.name === kw.SelfUpper) {
    // As mentioned above, `opt_ns` being `None` indicates a module path in import.
    // We can use this to improve a confusing error for, e.g. `use Self::Variant` in an
    // impl
    if (opt_ns === undefined) {
      return [message, "`Self` cannot be used in imports", undefined, undefined];
    } else {
      return [message, "`Self` is only available in impls, traits, and type definitions", undefined, undefined];
    }
  } else if (is_ascii_uppercase_first(ident.as_str())) {
    // Check whether the name refers to an item in the value namespace.
    let binding: LateDecl | undefined;
    if (ribs !== undefined) {
      assert(ignore_import === undefined, "assertion failed: ignore_import.is_none()");
      binding = this.resolve_ident_in_lexical_scope(ident, "ValueNS", parent_scope, undefined, ribs.index("ValueNS"), ignore_decl, diag_metadata);
    } else {
      binding = undefined;
    }
    let match_span: [Span, string, string] | undefined;
    if (binding !== undefined && binding.$ === "RibDef" && binding._0.$ === "Local") {
      // Name matches a local variable. For example:
      // ```
      // fn f() {
      //     let Foo: &str = "";
      //     println!("{}", Foo::Bar); // Name refers to local
      //                               // variable `Foo`.
      // }
      // ```
      match_span = [unwrap(this.pat_span_map.get(binding._0._0)), "a", "local binding"];
    } else if (binding !== undefined && binding.$ === "Decl") {
      // Name matches item from a local name binding
      // created by `use` declaration. For example:
      // ```
      // pub const Foo: &str = "";
      //
      // mod submod {
      //     use super::Foo;
      //     println!("{}", Foo::Bar); // Name refers to local
      //                               // binding `Foo`.
      // }
      // ```
      const name_binding = binding._0;
      match_span = [name_binding.span, hir_Res.article(name_binding.res()), hir_Res.descr(name_binding.res())];
    } else {
      match_span = undefined;
    }

    const message = `cannot find type \`${display_Ident(ident)}\` in ${scope}`;
    let label: string;
    if (match_span !== undefined) {
      const [span, article, descr] = match_span;
      label = `\`${display_Ident(ident)}\` is declared as ${article} ${descr} at \`${this.tcx_.sess.source_map().span_to_short_string(span, RemapPathScopeComponents.DIAGNOSTICS)}\`, not a type`;
    } else {
      label = `use of undeclared type \`${display_Ident(ident)}\``;
    }
    return [message, label, undefined, undefined];
  } else {
    let suggestion: Suggestion | undefined = undefined;
    if (ident.name === sym.alloc) {
      suggestion = [[], "add `extern crate alloc` to use the `alloc` crate", "MaybeIncorrect"];
    }

    if (suggestion === undefined) {
      const sugg = this.find_similarly_named_module_or_crate(ident.name, parent_scope.module);
      suggestion = sugg === undefined ? undefined : [[[ident.span, display_Symbol(sugg)]], "there is a crate or module with a similar name", "MaybeIncorrect"];
    }
    const r = this.cm().resolve_ident_in_scope_set(ident, { $: "All", _0: "ValueNS" }, parent_scope, undefined, ignore_decl, ignore_import);
    if (r.$ === "Ok") {
      const binding = r._0;
      const descr = hir_Res.descr(binding.res());
      const message = `cannot find module or crate \`${display_Ident(ident)}\` in ${scope}`;
      return [message, `${descr} \`${display_Ident(ident)}\` is not a crate or module`, suggestion, undefined];
    } else {
      let suggestion_: Suggestion | undefined;
      let m: PathBuf | undefined;
      if (suggestion !== undefined) {
        suggestion_ = suggestion;
      } else if ((m = this.undeclared_module_exists(ident)) !== undefined) {
        suggestion_ = this.undeclared_module_suggest_declare(ident, m);
      } else if (was_invoked_from_cargo()) {
        suggestion_ = [
          [],
          `if you wanted to use a crate named \`${display_Ident(ident)}\`, use \`cargo add ${display_Ident(ident)}\` to add it to your \`Cargo.toml\``,
          "MaybeIncorrect",
        ];
      } else {
        suggestion_ = [[], `you might be missing a crate named \`${display_Ident(ident)}\``, "MaybeIncorrect"];
      }
      const message = `cannot find module or crate \`${display_Ident(ident)}\` in ${scope}`;
      return [message, `use of unresolved module or unlinked crate \`${display_Ident(ident)}\``, suggestion_, undefined];
    }
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3407 undeclared_module_suggest_declare
Resolver.prototype.undeclared_module_suggest_declare = function (this: Resolver, ident: Ident, path: PathBuf): Suggestion | undefined {
  return [
    [[this.current_crate_outer_attr_insert_span, `mod ${display_Ident(ident)};\n`]],
    // PORT: `path.display()`: paths are JS strings.
    `to make use of source file ${path}, use \`mod ${display_Ident(ident)}\` in this file to declare the module`,
    "MaybeIncorrect",
  ];
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3423 undeclared_module_exists
Resolver.prototype.undeclared_module_exists = function (this: Resolver, ident: Ident): PathBuf | undefined {
  const map = this.tcx_.sess.source_map();

  const src_path = FileName.into_local_path(map.span_to_filename(ident.span));
  if (src_path === undefined) return undefined;
  const i = ident.as_str();
  // FIXME: add case where non parent using undeclared module (hard?)
  const dir = path_parent(src_path);
  if (dir === undefined) return undefined;
  // PORT: `file_stem()?.to_str()?`: paths are JS strings, so `to_str` always succeeds.
  const src = path_file_stem(src_path);
  if (src === undefined) return undefined;
  for (const file of [
    // …/x.rs
    path_set_extension(path_join(dir, i), "rs")[0],
    // …/x/mod.rs
    path_join(path_join(dir, i), "mod.rs"),
  ]) {
    if (existsSync(file)) {
      return file;
    }
  }
  if (!(src === "main" || src === "lib" || src === "mod")) {
    for (const file of [
      // …/x/y.rs
      path_set_extension(path_join(path_join(dir, src), i), "rs")[0],
      // …/x/y/mod.rs
      path_join(path_join(path_join(dir, src), i), "mod.rs"),
    ]) {
      if (existsSync(file)) {
        return file;
      }
    }
  }
  return undefined;
};

/// Adds suggestions for a path that cannot be resolved.
// PORT: `#[instrument(level = "debug", ..)]` and the `debug!` events of this group are tracing only.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3458 make_path_suggestion
Resolver.prototype.make_path_suggestion = function (this: Resolver, path_: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined {
  // PORT: `mut path: Vec<Segment>` is owned by the callee (`Segment: Copy`).
  const path = path_.map(clone_Segment);
  const first = path[0];
  const second = path[1];
  if (first !== undefined && second !== undefined && first.ident.name === kw.PathRoot && !second.ident.is_path_segment_keyword()) {
    // `{{root}}::ident::...` on both editions.
    // On 2015 `{{root}}` is usually added implicitly.
  } else if (first !== undefined && SpanC.at_least_rust_2018(first.ident.span) && !first.ident.is_path_segment_keyword()) {
    // `ident::...` on 2018.
    // Insert a placeholder that's later replaced by `self`/`super`/etc.
    path.unshift(SegmentC.from_ident(Ident.dummy()));
  } else {
    return undefined;
  }

  return (
    this.make_missing_self_suggestion(path.map(clone_Segment), parent_scope) ??
    this.make_missing_crate_suggestion(path.map(clone_Segment), parent_scope) ??
    this.make_missing_super_suggestion(path.map(clone_Segment), parent_scope) ??
    this.make_external_crate_suggestion(path, parent_scope)
  );
};

/// Suggest a missing `self::` if that resolves to an correct module.
///
/// ```text
///    |
/// LL | use foo::Bar;
///    |     ^^^ did you mean `self::foo`?
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3493 make_missing_self_suggestion
Resolver.prototype.make_missing_self_suggestion = function (this: Resolver, path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined {
  // Replace first ident with `self` and check if that is valid.
  set_first_segment_name(path, kw.SelfLower);
  const result = this.cm().maybe_resolve_path(path, undefined, parent_scope, undefined);
  // debug!(?path, ?result);
  if (result.$ === "Module") {
    return [path, undefined];
  } else {
    return undefined;
  }
};

/// Suggests a missing `crate::` if that resolves to an correct module.
///
/// ```text
///    |
/// LL | use foo::Bar;
///    |     ^^^ did you mean `crate::foo`?
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3513 make_missing_crate_suggestion
Resolver.prototype.make_missing_crate_suggestion = function (this: Resolver, path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined {
  // Replace first ident with `crate` and check if that is valid.
  set_first_segment_name(path, kw.Crate);
  const result = this.cm().maybe_resolve_path(path, undefined, parent_scope, undefined);
  // debug!(?path, ?result);
  if (result.$ === "Module") {
    return [
      path,
      "`use` statements changed in Rust 2018; read more at <https://doc.rust-lang.org/edition-guide/rust-2018/module-system/path-clarity.html>",
    ];
  } else {
    return undefined;
  }
};

/// Suggests a missing `super::` if that resolves to an correct module.
///
/// ```text
///    |
/// LL | use foo::Bar;
///    |     ^^^ did you mean `super::foo`?
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3545 make_missing_super_suggestion
Resolver.prototype.make_missing_super_suggestion = function (this: Resolver, path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined {
  // Replace first ident with `crate` and check if that is valid.
  set_first_segment_name(path, kw.Super);
  const result = this.cm().maybe_resolve_path(path, undefined, parent_scope, undefined);
  // debug!(?path, ?result);
  if (result.$ === "Module") {
    return [path, undefined];
  } else {
    return undefined;
  }
};

/// Suggests a missing external crate name if that resolves to an correct module.
///
/// ```text
///    |
/// LL | use foobar::Baz;
///    |     ^^^^^^ did you mean `baz::foobar`?
/// ```
///
/// Used when importing a submodule of an external crate but missing that crate's
/// name as the first part of path.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3568 make_external_crate_suggestion
Resolver.prototype.make_external_crate_suggestion = function (this: Resolver, path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined {
  if (SpanC.is_rust_2015(path[1]!.ident.span)) {
    return undefined;
  }

  // Sort extern crate names in *reverse* order to get
  // 1) some consistent ordering for emitted diagnostics, and
  // 2) `std` suggestions before `core` suggestions.
  const extern_crate_names: Symbol[] = [...this.extern_prelude.keys()].map((ident) => ident.name);
  extern_crate_names.sort((a, b) => str_cmp(SymbolC.as_str(b), SymbolC.as_str(a)));

  for (const name of extern_crate_names) {
    // Replace first ident with a crate name and check if that is valid.
    set_first_segment_name(path, name);
    const result = this.cm().maybe_resolve_path(path, undefined, parent_scope, undefined);
    // debug!(?path, ?name, ?result);
    if (result.$ === "Module") {
      return [path, undefined];
    }
  }

  return undefined;
};

/// Suggests importing a macro from the root of the crate rather than a module within
/// the crate.
///
/// ```text
/// help: a macro with this name exists at the root of the crate
///    |
/// LL | use issue_59764::makro;
///    |     ^^^^^^^^^^^^^^^^^^
///    |
///    = note: this could be because a macro annotated with `#[macro_export]` will be exported
///            at the root of the crate instead of the module where it is defined
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3609 check_for_module_export_macro
Resolver.prototype.check_for_module_export_macro = function (
  this: Resolver,
  import_: Import,
  module: ModuleOrUniformRoot,
  ident: Ident,
): [Suggestion | undefined, string | undefined] | undefined {
  if (module.$ !== "Module") {
    return undefined;
  }
  let crate_module = module._0;

  while (crate_module.parent !== undefined) {
    crate_module = crate_module.parent;
  }

  if (module._0 === crate_module) {
    // Don't make a suggestion if the import was already from the root of the crate.
    return undefined;
  }

  const binding_key = BindingKey.new(IdentKey.new(ident), "MacroNS");
  const resolution = this.resolution(crate_module, binding_key);
  if (resolution === undefined) return undefined;
  const binding = resolution.best_decl();
  if (binding === undefined) return undefined;
  const bres = binding.res();
  if (!(bres.$ === "Def" && bres._0.$ === "Macro")) {
    return undefined;
  }
  const kinds = bres._0._0;
  if (!MacroKinds.contains(kinds, MacroKinds.BANG)) {
    return undefined;
  }
  const module_name = crate_module.name() ?? kw.Crate;
  let import_snippet: string;
  const ik = import_.kind;
  if (ik.$ === "Single" && !ik.source.eq(ik.target)) {
    import_snippet = `${display_Ident(ik.source)} as ${display_Ident(ik.target)}`;
  } else {
    import_snippet = display_Ident(ident);
  }

  const corrections: [Span, string][] = [];
  if (!import_.is_nested()) {
    // Assume this is the easy case of `use issue_59764::foo::makro;` and just remove
    // intermediate segments.
    corrections.push([import_.span, `${display_Symbol(module_name)}::${import_snippet}`]);
  } else {
    // Find the binding span (and any trailing commas and spaces).
    //   i.e. `use a::b::{c, d, e};`
    //                      ^^^
    const [found_closing_brace, binding_span] = find_span_of_binding_until_next_binding(this.tcx_.sess, import_.span, import_.use_span);
    // debug!(found_closing_brace, ?binding_span);

    let removal_span = binding_span;

    // If the binding span ended with a closing brace, as in the below example:
    //   i.e. `use a::b::{c, d};`
    //                      ^
    // Then expand the span of characters to remove to include the previous
    // binding's trailing comma.
    //   i.e. `use a::b::{c, d};`
    //                    ^^^
    if (found_closing_brace) {
      const previous_span = extend_span_to_previous_binding(this.tcx_.sess, binding_span);
      if (previous_span !== undefined) {
        // debug!(?previous_span);
        removal_span = SpanC.with_lo(removal_span, SpanC.lo(previous_span));
      }
    }
    // debug!(?removal_span);

    // Remove the `removal_span`.
    corrections.push([removal_span, ""]);

    // Find the span after the crate name and if it has nested imports immediately
    // after the crate name already.
    //   i.e. `use a::b::{c, d};`
    //               ^^^^^^^^^
    //   or  `use a::{b, c, d}};`
    //               ^^^^^^^^^^^
    const [has_nested, after_crate_name] = find_span_immediately_after_crate_name(this.tcx_.sess, import_.use_span);
    // debug!(has_nested, ?after_crate_name);

    const source_map = this.tcx_.sess.source_map();

    // Make sure this is actually crate-relative.
    const f = import_.module_path[0];
    const is_definitely_crate = f !== undefined && f.ident.name !== kw.SelfLower && f.ident.name !== kw.Super;

    // Add the import to the start, with a `{` if required.
    const start_point = source_map.start_point(after_crate_name);
    const start_snippet_r = is_definitely_crate ? source_map.span_to_snippet(start_point) : undefined;
    if (is_definitely_crate && start_snippet_r !== undefined && start_snippet_r.$ === "Ok") {
      const start_snippet = start_snippet_r._0.toString();
      corrections.push([
        start_point,
        has_nested
          ? // In this case, `start_snippet` must equal '{'.
            `${start_snippet}${import_snippet}, `
          : // In this case, add a `{`, then the moved import, then whatever
            // was there before.
            `{${import_snippet}, ${start_snippet}`,
      ]);

      // Add a `};` to the end if nested, matching the `{` added at the start.
      if (!has_nested) {
        corrections.push([source_map.end_point(after_crate_name), "};"]);
      }
    } else {
      // If the root import is module-relative, add the import separately
      const vis_r = source_map.span_to_snippet(import_.vis_span);
      const indentation = vis_r.$ === "Ok" ? source_map.indentation_before(import_.use_span) : undefined;
      if (vis_r.$ === "Ok" && indentation !== undefined) {
        const vis = str_trim_end(str_trim_start(vis_r._0)).is_empty() ? "" : `${vis_r._0.toString()} `;
        corrections.push([
          SpanC.shrink_to_lo(import_.use_span),
          `${vis}use ${display_Symbol(module_name)}::${import_snippet};\n${indentation.toString()}`,
        ]);
      }
    }
  }

  const suggestion: Suggestion = [corrections, "a macro with this name exists at the root of the crate", "MaybeIncorrect"];
  return [
    suggestion,
    "this could be because a macro annotated with `#[macro_export]` will be exported at the root of the crate instead of the module where it is defined",
  ];
};

/// Finds a cfg-ed out item inside `module` with the matching name.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3750 find_cfg_stripped
Resolver.prototype.find_cfg_stripped = function (this: Resolver, err: Diag, segment: Symbol, module: DefId): void {
  let symbols: readonly StrippedCfgItem<DefId>[];
  if (module.is_local()) {
    const local_items: StrippedCfgItem<DefId>[] = [];
    for (const item of this.stripped_cfg_items) {
      let parent_scope: DefId | undefined;
      for (const m of this.local_modules) {
        const k = m.kind;
        if (k.$ === "Def" && k._2 === item.parent_scope) {
          parent_scope = k._1;
          break;
        }
      }
      if (parent_scope === undefined) continue;
      local_items.push(new StrippedCfgItem<DefId>(parent_scope, item.ident, clone_cfg(item.cfg)));
    }
    symbols = local_items;
  } else {
    symbols = this.tcx_.stripped_cfg_items(module.krate) as readonly StrippedCfgItem<DefId>[];
  }

  for (const { parent_scope, ident, cfg } of symbols) {
    if (ident.name !== segment) {
      continue;
    }

    const parent_module = this.get_nearest_non_block_module(parent_scope).def_id();

    // rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3778 comes_from_same_module_for_glob
    function comes_from_same_module_for_glob(r: Resolver, parent_module: DefId, module: DefId, visited: Map<DefId, boolean>): boolean {
      const cached = visited.get(parent_module);
      if (cached !== undefined) {
        // this branch is prevent from being called recursively infinity,
        // because there has some cycles in globs imports,
        // see more spec case at `tests/ui/cfg/diagnostics-reexport-2.rs#reexport32`
        return cached;
      }
      visited.set(parent_module, false);
      let res = false;
      const m = r.expect_module(parent_module);
      if (m.is_local()) {
        for (const importer of m.glob_importers.borrow_checked(r)) {
          const next_parent_module = importer.parent_scope.module.opt_def_id();
          if (next_parent_module !== undefined) {
            if (DefId_eq(next_parent_module, module) || comes_from_same_module_for_glob(r, next_parent_module, module, visited)) {
              res = true;
              break;
            }
          }
        }
      }
      visited.set(parent_module, res);
      return res;
    }

    const comes_from_same_module = DefId_eq(parent_module, module) || comes_from_same_module_for_glob(this, parent_module, module, new KeyedMap(DefId_key));
    if (!comes_from_same_module) {
      continue;
    }

    const c0 = cfg[0];
    const item_was: diagnostics.ItemWas =
      c0.$ === "NameValue" && c0.value !== undefined ? { $: "BehindFeature", feature: c0.value, span: cfg[1] } : { $: "CfgOut", span: cfg[1] };
    const note: diagnostics.FoundItemConfigureOut = { span: ident.span, item_was };
    err.subdiagnostic(diagnostics.FoundItemConfigureOut_subdiagnostic(note));
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3836 struct_ctor
Resolver.prototype.struct_ctor = function (this: Resolver, def_id: DefId): gen.StructCtor | undefined {
  const local = def_id.as_local();
  if (local !== undefined) {
    const c = this.struct_ctors.get(local);
    return c === undefined ? undefined : gen.clone_StructCtor(c);
  } else {
    const r = this.cstore().ctor_untracked(this.tcx_, def_id);
    if (r === undefined) return undefined;
    const [ctor_kind, ctor_def_id] = r as [CtorKind, DefId];
    const res: Res = { $: "Def", _0: { $: "Ctor", _0: "Struct", _1: ctor_kind }, _1: ctor_def_id };
    const vis = this.tcx_.visibility(ctor_def_id);
    const field_visibilities = this.tcx_.associated_item_def_ids(def_id).map((field_id) => this.tcx_.visibility(field_id));
    return new gen.StructCtor(res, vis, field_visibilities);
  }
};

/// Gets the `#[diagnostic::on_unknown]` attribute data associated with this `DefId`.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3856 on_unknown_data
Resolver.prototype.on_unknown_data = function (this: Resolver, def_id: DefId): Directive | undefined {
  const local = def_id.as_local();
  if (local !== undefined) {
    const data = this.on_unknown_data_.get(local);
    if (data === undefined) return undefined;
    return data.directive;
  } else {
    // PORT: `find_attr!(self.tcx, def_id, ..)` on a non-local `DefId` (see `report_privacy_error`); the
    // matched `Option<Box<Directive>>` is boxed so that a `None` directive still ends the search.
    const found = find_attr(this.tcx_.attrs_for_def(def_id) as readonly HirAttribute[], (k) => (k.$ === "OnUnknown" ? { directive: k.directive } : undefined));
    if (found === undefined) return undefined;
    return found.directive;
  }
};

// ---- res-diag-b helpers (not upstream fns) ----------------------------------------------------------

/** `Vec::dedup` (consecutive equal elements, `==`). */
function vec_dedup<T>(v: readonly T[]): T[] {
  const out: T[] = [];
  for (const x of v) if (out.length === 0 || out[out.length - 1] !== x) out.push(x);
  return out;
}

/** `[T]::sort_by_key` (stable) with an explicit key comparison. */
function sort_by_key_stable<T, K>(v: T[], key: (x: T) => K, cmp: (a: K, b: K) => number): void {
  const keyed = v.map((x, i) => [key(x), x, i] as const);
  keyed.sort((a, b) => cmp(a[0], b[0]) || a[2] - b[2]);
  for (let i = 0; i < v.length; i++) v[i] = keyed[i]![1];
}
/** `[T]::sort_by_cached_key` (stable; the key is computed once per element). */
const sort_by_cached_key_stable = sort_by_key_stable;

/** `Ord` of `(usize, bool, bool)` (`false < true`). */
function cmp_key3(a: readonly [number, boolean, boolean], b: readonly [number, boolean, boolean]): number {
  return a[0] - b[0] || Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2]);
}

/** `path[0].ident.name = name` on a by-value `Vec<Segment>` (PORT: `Ident` objects may be shared, so the ident is replaced). */
function set_first_segment_name(path: Segment[], name: Symbol): void {
  const seg = path[0]!;
  seg.ident = Ident.new(name, seg.ident.span);
}

/** `name.as_str().chars().next().is_some_and(|c| c.is_ascii_uppercase())` */
function is_ascii_uppercase_first(s: string): boolean {
  const c = s.charCodeAt(0);
  return c >= 0x41 && c <= 0x5a;
}

/** `item.cfg.clone()` of a `(CfgEntry, Span)`. */
function clone_cfg(cfg: [CfgEntry, Span]): [CfgEntry, Span] {
  return [clone_CfgEntry(cfg[0]), cfg[1]];
}

/// Given a `binding_span` of a binding within a use statement:
///
/// ```ignore (illustrative)
/// use foo::{a, b, c};
/// //           ^
/// ```
///
/// then return the span until the next binding or the end of the statement:
///
/// ```ignore (illustrative)
/// use foo::{a, b, c};
/// //           ^^^
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3877 find_span_of_binding_until_next_binding
export function find_span_of_binding_until_next_binding(sess: Session, binding_span: Span, use_span: Span): [boolean, Span] {
  const source_map = sess.source_map();

  // Find the span of everything after the binding.
  //   i.e. `a, e};` or `a};`
  const binding_until_end = SpanC.with_hi(binding_span, SpanC.hi(use_span));

  // Find everything after the binding but not including the binding.
  //   i.e. `, e};` or `};`
  const after_binding_until_end = SpanC.with_lo(binding_until_end, SpanC.hi(binding_span));

  // Keep characters in the span until we encounter something that isn't a comma or
  // whitespace.
  //   i.e. `, ` or ``.
  //
  // Also note whether a closing brace character was encountered. If there
  // was, then later go backwards to remove any trailing commas that are left.
  let found_closing_brace = false;
  const after_binding_until_next_binding = source_map.span_take_while(after_binding_until_end, (ch_) => {
    if (ch_ === C_RBRACE) {
      found_closing_brace = true;
    }
    return ch_ === C_SPACE || ch_ === C_COMMA;
  });

  // Combine the two spans.
  //   i.e. `a, ` or `a`.
  //
  // Removing these would leave `issue_52891::{d, e};` or `issue_52891::{d, e, };`
  const span = SpanC.with_hi(binding_span, SpanC.hi(after_binding_until_next_binding));

  return [found_closing_brace, span];
}

/// Given a `binding_span`, return the span through to the comma or opening brace of the previous
/// binding.
///
/// ```ignore (illustrative)
/// use foo::a::{a, b, c};
/// //            ^^--- binding span
/// //            |
/// //            returned span
///
/// use foo::{a, b, c};
/// //        --- binding span
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3928 extend_span_to_previous_binding
export function extend_span_to_previous_binding(sess: Session, binding_span: Span): Span | undefined {
  const source_map = sess.source_map();

  // `prev_source` will contain all of the source that came before the span.
  // Then split based on a command and take the first (i.e. closest to our span)
  // snippet. In the example, this is a space.
  const prev_source_r = source_map.span_to_prev_source(binding_span);
  if (prev_source_r.$ !== "Ok") return undefined;
  const prev_source = prev_source_r._0.toString();

  // PORT: `rsplit(c).collect::<Vec<_>>()`: `split(c).reverse()` yields the same pieces in the same order.
  const prev_comma = prev_source.split(",").reverse();
  const prev_starting_brace = prev_source.split("{").reverse();
  if (prev_comma.length <= 1 || prev_starting_brace.length <= 1) {
    return undefined;
  }

  const prev_comma_ = prev_comma[0]!;
  const prev_starting_brace_ = prev_starting_brace[0]!;

  // If the amount of source code before the comma is greater than
  // the amount of source code before the starting brace then we've only
  // got one item in the nested item (eg. `issue_52891::{self}`).
  if (utf8_len(prev_comma_) > utf8_len(prev_starting_brace_)) {
    return undefined;
  }

  return SpanC.with_lo(
    binding_span,
    // Take away the number of bytes for the characters we've found and an
    // extra for the comma.
    (SpanC.lo(binding_span) - utf8_len(prev_comma_) - 1) as BytePos,
  );
}

/// Given a `use_span` of a binding within a use statement, returns the highlighted span and if
/// it is a nested use tree.
///
/// ```ignore (illustrative)
/// use foo::a::{b, c};
/// //       ^^^^^^^^^^ -- false
///
/// use foo::{a, b, c};
/// //       ^^^^^^^^^^ -- true
///
/// use foo::{a, b::{c, d}};
/// //       ^^^^^^^^^^^^^^^ -- true
/// ```
// PORT: `#[instrument(level = "debug", skip(sess))]` is tracing only.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:3973 find_span_immediately_after_crate_name
export function find_span_immediately_after_crate_name(sess: Session, use_span: Span): [boolean, Span] {
  const source_map = sess.source_map();

  // Using `use issue_59764::foo::{baz, makro};` as an example throughout..
  let num_colons = 0;
  // Find second colon.. `use issue_59764:`
  const until_second_colon = source_map.span_take_while(use_span, (c) => {
    if (c === C_COLON) {
      num_colons += 1;
    }
    return !(c === C_COLON && num_colons === 2);
  });
  // Find everything after the second colon.. `foo::{baz, makro};`
  const from_second_colon = SpanC.with_lo(use_span, (SpanC.hi(until_second_colon) + 1) as BytePos);

  let found_a_non_whitespace_character = false;
  // Find the first non-whitespace character in `from_second_colon`.. `f`
  const after_second_colon = source_map.span_take_while(from_second_colon, (c) => {
    if (found_a_non_whitespace_character) {
      return false;
    }
    if (!is_whitespace(c)) {
      found_a_non_whitespace_character = true;
    }
    return true;
  });

  // Find the first `{` in from_second_colon.. `foo::{`
  const next_left_bracket = source_map.span_through_char(from_second_colon, C_LBRACE);

  return [next_left_bracket === after_second_colon, from_second_colon];
}

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4034 import_candidates
export function import_candidates(
  tcx: TyCtxt,
  err: Diag,
  // This is `None` if all placement locations are inside expansions
  use_placement_span: Span | undefined,
  candidates: readonly ImportSuggestion[],
  mode: DiagMode,
  append: string,
): void {
  show_candidates(tcx, err, use_placement_span, candidates, "Yes", "Yes", mode, [], append);
}

/// When an entity with a given name is not available in scope, we search for
/// entities with that name in all crates. This method allows outputting the
/// results of this search in a programmer-friendly way. If any entities are
/// found and suggested, returns `true`, otherwise returns `false`.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4062 show_candidates
export function show_candidates(
  tcx: TyCtxt,
  err: Diag,
  // This is `None` if all placement locations are inside expansions
  use_placement_span: Span | undefined,
  candidates: readonly ImportSuggestion[],
  instead: Instead,
  found_use: FoundUse,
  mode: DiagMode,
  path: Segment[],
  append: string,
): boolean {
  if (candidates.length === 0) {
    return false;
  }

  let showed = false;
  let accessible_path_strings: PathString[] = [];
  let inaccessible_path_strings: PathString[] = [];

  const source_span_of = (c: ImportSuggestion): Span | undefined => {
    if (c.did === undefined) return undefined;
    const local = c.did.as_local();
    return local === undefined ? undefined : tcx.source_span(local);
  };
  for (const c of candidates) {
    if (c.accessible) {
      // Don't suggest `#[doc(hidden)]` items from other crates
      if (c.doc_visible) {
        accessible_path_strings.push([pprust.path_to_string(c.path), c.descr, source_span_of(c), c.note, c.via_import]);
      }
    } else {
      inaccessible_path_strings.push([pprust.path_to_string(c.path), c.descr, source_span_of(c), c.note, c.via_import]);
    }
  }

  // we want consistent results across executions, but candidates are produced
  // by iterating through a hash map, so make sure they are ordered:
  const order = (path_strings: PathString[]): PathString[] => {
    // `sort_by` is stable.
    const sorted = path_strings.slice().sort((a, b) => str_cmp(a[0], b[0]));
    // `dedup_by(|a, b| a.0 == b.0)`
    path_strings = sorted.filter((p, i) => i === 0 || sorted[i - 1]![0] !== p[0]);
    const core_path_strings = extract_if(path_strings, (p) => p[0].startsWith("core::"));
    const std_path_strings = extract_if(path_strings, (p) => p[0].startsWith("std::"));
    const foreign_crate_path_strings = extract_if(path_strings, (p) => !p[0].startsWith("crate::"));

    // We list the `crate` local paths first.
    // Then we list the `std`/`core` paths.
    if (std_path_strings.length === core_path_strings.length) {
      // Do not list `core::` paths if we are already listing the `std::` ones.
      path_strings.push(...std_path_strings);
    } else {
      path_strings.push(...std_path_strings);
      path_strings.push(...core_path_strings);
    }
    // List all paths from foreign crates last.
    path_strings.push(...foreign_crate_path_strings);
    return path_strings;
  };
  accessible_path_strings = order(accessible_path_strings);
  inaccessible_path_strings = order(inaccessible_path_strings);

  if (accessible_path_strings.length !== 0) {
    let determiner: string;
    let kind: string;
    let s: string;
    let name: string;
    let through: string;
    if (accessible_path_strings.length === 1) {
      const [name_, descr, , , via_import] = accessible_path_strings[0]!;
      [determiner, kind, s, name, through] = ["this", descr, "", ` \`${name_}\``, via_import ? " through its public re-export" : ""];
    } else {
      // Get the unique item kinds and if there's only one, we use the right kind name
      // instead of the more generic "items".
      const kinds = new Set(accessible_path_strings.map(([, descr]) => descr));
      const kind_ = kinds.size === 1 ? [...kinds][0]! : "item";
      const s_ = kind_.endsWith("s") ? "es" : "s";

      [determiner, kind, s, name, through] = ["one of these", kind_, s_, "", ""];
    }

    const instead_ = instead === "Yes" ? " instead" : "";
    let msg: string;
    if (mode.$ === "Pattern") {
      msg = `if you meant to match on ${kind}${s}${instead_}${name}, use the full path in the pattern`;
    } else {
      msg = `consider importing ${determiner} ${kind}${s}${through}${instead_}`;
    }

    for (const cand of accessible_path_strings) {
      const note = cand[3];
      if (note !== undefined) err.note(note);
    }

    const append_candidates = (msg: string, accessible_path_strings: PathString[]): string => {
      msg += ":";

      for (const candidate of accessible_path_strings) {
        msg += "\n";
        msg += candidate[0];
      }
      return msg;
    };

    if (use_placement_span !== undefined) {
      const span = use_placement_span;
      let add_use: string;
      let trailing: string;
      switch (mode.$) {
        case "Pattern": {
          err.span_suggestions(
            span,
            msg,
            accessible_path_strings.map((a) => a[0]),
            "MaybeIncorrect",
          );
          return true;
        }
        case "Import":
          [add_use, trailing] = ["", ""];
          break;
        case "Normal":
          [add_use, trailing] = ["use ", ";\n"];
          break;
      }
      for (const candidate of accessible_path_strings) {
        // produce an additional newline to separate the new use statement
        // from the directly following item.
        const additional_newline = found_use === "No" && mode.$ === "Normal" ? "\n" : "";
        candidate[0] = `${add_use}${candidate[0]}${append}${trailing}${additional_newline}`;
      }

      if (mode.$ === "Import" && mode.append) {
        msg = append_candidates(msg, accessible_path_strings);
        err.span_help(span, msg);
      } else {
        err.span_suggestions_with_style(
          span,
          msg,
          accessible_path_strings.map((a) => a[0]),
          "MaybeIncorrect",
          "ShowAlways",
        );
      }

      if (path.length >= 2) {
        const first = path[0]!;
        const last = path[path.length - 1]!;
        const sp = SpanC.until(first.ident.span, last.ident.span);
        // Our suggestion is empty, so make sure the span is not empty (or we'd ICE).
        // Can happen for derive-generated spans.
        if (SpanC.can_be_used_for_suggestions(sp) && !SpanC.is_empty(sp)) {
          err.span_suggestion_verbose(sp, `if you import \`${display_Ident(last.ident)}\`, refer to it directly`, "", "Unspecified");
        }
      }
    } else {
      msg = append_candidates(msg, accessible_path_strings);
      err.help(msg);
    }
    showed = true;
  }
  if (inaccessible_path_strings.length !== 0 && !(mode.$ === "Import" && mode.unresolved_import === false)) {
    const prefix = mode.$ === "Pattern" ? "you might have meant to match on " : "";
    if (inaccessible_path_strings.length === 1) {
      const [name, descr, source_span, note] = inaccessible_path_strings[0]!;
      const msg = `${prefix}${descr} \`${name}\`${mode.$ === "Pattern" ? ", which" : ""} exists but is inaccessible`;

      if (source_span !== undefined) {
        const span = tcx.sess.source_map().guess_head_span(source_span);
        const multi_span = MultiSpan.from_span(span);
        multi_span.push_span_label(span, "not accessible");
        err.span_note(multi_span, msg);
      } else {
        err.note(msg);
      }
      if (note !== undefined) {
        err.note(note);
      }
    } else {
      // `.all_equal_value().unwrap_or("item")`
      const first_descr = inaccessible_path_strings[0]![1];
      const descr = inaccessible_path_strings.every(([, d]) => d === first_descr) ? first_descr : "item";
      const plural_descr = descr.endsWith("s") ? `${descr}es` : `${descr}s`;

      let msg = `${prefix}these ${plural_descr} exist but are inaccessible`;
      let has_colon = false;

      const spans: [string, Span][] = [];
      for (const [name, , source_span] of inaccessible_path_strings) {
        if (source_span !== undefined) {
          const span = tcx.sess.source_map().guess_head_span(source_span);
          spans.push([name, span]);
        } else {
          if (!has_colon) {
            msg += ":";
            has_colon = true;
          }
          msg += "\n";
          msg += name;
        }
      }

      const multi_span = MultiSpan.from_spans(spans.map(([, sp]) => sp));
      for (const [name, span] of spans) {
        multi_span.push_span_label(span, `\`${name}\`: not accessible`);
      }

      for (const cand of inaccessible_path_strings) {
        const note = cand[3];
        if (note !== undefined) err.note(note);
      }

      err.span_note(multi_span, msg);
    }
    showed = true;
  }
  return showed;
}

const C_RBRACE = ch("}");
const C_LBRACE = ch("{");
const C_SPACE = ch(" ");
const C_COMMA = ch(",");
const C_COLON = ch(":");

/** `Vec::extract_if(.., pred).collect()`: removes the matching elements (in order) and returns them. */
function extract_if<T>(v: T[], pred: (x: T) => boolean): T[] {
  const out: T[] = [];
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    const x = v[r]!;
    if (pred(x)) out.push(x);
    else v[w++] = x;
  }
  v.length = w;
  return out;
}
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4368 search_for_any_use_in_items
export function search_for_any_use_in_items(items: readonly Item[]): Span | undefined {
  for (const item of items) {
    if (item.kind.$ === "Use" && is_span_suitable_for_use_injection(item.span)) {
      let lo = SpanC.lo(item.span);
      for (const attr of item.attrs) {
        if (SpanC.eq_ctxt(attr.span, item.span)) {
          lo = Math.min(lo, SpanC.lo(attr.span)) as BytePos;
        }
      }
      return SpanC.new(lo, lo, SpanC.ctxt(item.span), SpanC.parent(item.span));
    }
  }
  return undefined;
}

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:4385 is_span_suitable_for_use_injection
export function is_span_suitable_for_use_injection(s: Span): boolean {
  // don't suggest placing a use before the prelude
  // import or other generated ones
  return !SpanC.from_expansion(s);
}
export const TypoSuggestion = gen.TypoSuggestion as typeof gen.TypoSuggestion & {
  "new": (candidate: Symbol, span: Span, res: Res) => TypoSuggestion;
  typo_from_name: (candidate: Symbol, res: Res) => TypoSuggestion;
  single_item: (candidate: Symbol, span: Span, res: Res) => TypoSuggestion;
};
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:102 new
TypoSuggestion.new = function (candidate: Symbol, span: Span, res: Res): TypoSuggestion {
  return new gen.TypoSuggestion(candidate, span, res, "SimilarlyNamed");
};
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:105 typo_from_name
TypoSuggestion.typo_from_name = function (candidate: Symbol, res: Res): TypoSuggestion {
  return new gen.TypoSuggestion(candidate, undefined, res, "SimilarlyNamed");
};
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:108 single_item
TypoSuggestion.single_item = function (candidate: Symbol, span: Span, res: Res): TypoSuggestion {
  return new gen.TypoSuggestion(candidate, span, res, "SingleItem");
};

// ---- res-diag-a: `impl StructCtor`, `impl Resolver` (diagnostics/impls.rs:78, 145..1977) ----
// PORT: placed after the `TypoSuggestion` statics (upstream :102..108) so the res-diag-b stubs above stay
// untouched; the markers keep the upstream lines.

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:78 has_private_fields
StructCtor.prototype.has_private_fields = function (this: gen.StructCtor, m: Module, r: Resolver): boolean {
  return this.field_visibilities.some((vis) => !r.is_accessible_from(vis, m));
};

/// Reports unresolved imports.
///
/// Multiple unresolved import errors within the same use tree are combined into a single
/// diagnostic.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:145 throw_unresolved_import_error
Resolver.prototype.throw_unresolved_import_error = function (
  this: Resolver,
  errors_: [Import, UnresolvedImportError][],
  glob_error: boolean,
): void {
  // `errors.retain(..)`
  const errors = errors_.filter(([_import, err]) => {
    const def_id = err.module;
    // Skip `use` errors for `use foo::Bar;` if `foo.rs` has unrecovered parse errors.
    if (def_id !== undefined && this.mods_with_parse_errors.has(def_id)) return false;
    // If we've encountered something like `use _;`, we've already emitted an error stating
    // that `_` is not a valid identifier, so we ignore that resolve error.
    return err.segment?.name !== kw.Underscore;
  });
  if (errors.length === 0) {
    this.tcx_.dcx().delayed_bug('expected a parse or "`_` can\'t be an identifier" error');
    return;
  }

  const span = MultiSpan.from_spans(errors.map(([_, err]) => err.span));

  const paths = errors.map(([import_, err]) => {
    const path = import_path_to_string(
      import_.module_path.map((seg) => seg.ident),
      import_.kind,
      err.span,
    );
    return `\`${path}\``;
  });
  const default_message = `unresolved import${pluralize(paths.length)} ${paths.join(", ")}`;

  // Process `import` use of  the `#[diagnostic::on_unknown]` attribute.
  //
  // We don't need to check feature gates here; that happens on initialization of the
  // `on_unknown_attr` fields.
  let message: string | undefined;
  let label: string | undefined;
  let notes: string[];
  const directive0 = errors[0]![1].on_unknown_attr?.directive;
  if (directive0 !== undefined) {
    const this_ = errors
      .map(([_import, err]) => {
        // Is this unwrap_or reachable?
        return Symbol.as_str(err.segment?.name ?? kw.Underscore);
      })
      .join(", ");

    const args: FormatArgs = { ...FormatArgs_default(this_), unresolved: this_ };

    const { message: m, label: l, notes: n, parent_label: _dead } = directive0.eval(undefined, args);

    [message, label, notes] = [m, l, n];
  } else {
    [message, label, notes] = [undefined, undefined, []];
  }

  // `module` use of the `#[diagnostic::on_unknown]` attribute.
  // We assume that someone who put the attribute on the import has more information than
  // the person who put it on the module, so we choose to prioritize the import attribute.
  const mod_diagnostics: CustomDiagnostic[] = errors.map(([import_, import_error]) => {
    const imported = import_.imported_module.get();
    if (imported !== undefined && imported.$ === "Module" && imported._0.kind.$ === "Def" && imported._0.kind._0.$ === "Mod") {
      const { _1: def_id, _3: name } = imported._0.kind;
      const directive = this.on_unknown_data(def_id);
      if (directive === undefined) {
        return default_CustomDiagnostic();
      }

      let this_: string;
      if (name !== undefined) {
        this_ = Symbol.as_str(name);
      } else if (this.tcx_.sess.opts.crate_name !== undefined) {
        this_ = this.tcx_.sess.opts.crate_name;
      } else {
        this_ = "<unnamed crate>";
      }
      const unresolved = import_error.segment?.name ?? kw.Underscore;
      const args: FormatArgs = { ...FormatArgs_default(this_), unresolved: Symbol.as_str(unresolved) };

      return directive.eval(undefined, args);
    } else {
      return default_CustomDiagnostic();
    }
  });

  // If there is no import attribute with a message,
  // but all mod messages are the same, use that.
  // PORT: `iter_mut().flat_map(|d| d.message.take()).all_equal_value()`: the `take()`s run lazily up to
  // the first differing message, as itertools' `all_equal_value` (`next()`, then `find(|x| x != first)`).
  let mod_message: { $: "Ok"; _0: string } | { $: "Err" } = { $: "Err" };
  {
    let first: string | undefined;
    let differs = false;
    for (const d of mod_diagnostics) {
      const m = d.message;
      d.message = undefined;
      if (m === undefined) continue;
      if (first === undefined) {
        first = m;
      } else if (m !== first) {
        differs = true;
        break;
      }
    }
    if (first !== undefined && !differs) mod_message = { $: "Ok", _0: first };
  }
  if (message === undefined && mod_message.$ === "Ok") {
    const mod_msg = mod_message._0;
    message = mod_msg;
  }

  let diag: Diag;
  if (message !== undefined) {
    diag = struct_span_code_err(this.dcx(), span, E0432, message).with_note(default_message);
  } else {
    diag = struct_span_code_err(this.dcx(), span, E0432, default_message);
  }

  for (const mod_diag of mod_diagnostics) {
    for (const mod_note of mod_diag.notes.splice(0)) {
      if (!notes.includes(mod_note)) {
        notes.push(mod_note);
      }
    }
  }

  if (notes.length !== 0) {
    for (const note of notes) {
      diag.note(note);
    }
  } else {
    const last = errors[errors.length - 1];
    if (last !== undefined && last[1].note !== undefined) {
      diag.note(last[1].note);
    }
  }

  /// Upper limit on the number of `span_label` messages.
  const MAX_LABEL_COUNT = 10;
  const mod_labels = mod_diagnostics.map((cd) => cd.label);

  // `errors.into_iter().zip(mod_labels).take(MAX_LABEL_COUNT)`
  for (let i = 0; i < Math.min(errors.length, mod_labels.length, MAX_LABEL_COUNT); i++) {
    const [import_, err] = errors[i]!;
    const mod_label = mod_labels[i];
    const label_span = err.segment !== undefined ? err.segment.span : err.span;
    if (label !== undefined) {
      diag.span_label(label_span, label);
    } else if (mod_label !== undefined) {
      diag.span_label(label_span, mod_label);
    } else if (err.label !== undefined) {
      diag.span_label(label_span, err.label);
    }

    if (err.suggestion !== undefined) {
      const [suggestions, msg, applicability] = err.suggestion;
      if (suggestions.length === 0) {
        diag.help(msg);
        continue;
      }
      diag.multipart_suggestion(msg, suggestions, applicability);
    }

    if (err.help !== undefined) {
      diag.help(err.help);
    }

    if (err.candidates !== undefined) {
      const candidates = err.candidates;
      const kind = import_.kind;
      if (kind.$ === "Single" && !kind.nested) {
        const { source, target } = kind;
        import_candidates(
          this.tcx_,
          diag,
          err.span,
          candidates,
          { $: "Import", append: false, unresolved_import: true },
          !source.eq(target) ? ` as ${display_Ident(target)}` : "",
        );
      } else if (kind.$ === "Single" && kind.nested) {
        const { source, target } = kind;
        import_candidates(
          this.tcx_,
          diag,
          undefined,
          candidates,
          gen.DiagMode.Normal,
          !source.eq(target) ? ` as ${display_Ident(target)}` : "",
        );
      }
    }

    if (import_.kind.$ === "Single" && err.segment !== undefined && err.module !== undefined) {
      const segment = err.segment;
      const module = err.module;
      this.find_cfg_stripped(diag, segment.name, module);
    }
  }

  const guar = diag.emit_err();
  if (glob_error) {
    this.glob_error = guar;
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:337 dcx
Resolver.prototype.dcx = function (this: Resolver): DiagCtxtHandle {
  return this.tcx_.dcx();
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:341 report_errors
Resolver.prototype.report_errors = function (this: Resolver, krate: Crate, use_injections: UseError[]): void {
  this.report_delayed_vis_resolution_errors();
  this.report_with_use_injections(krate, use_injections);

  // PORT: `BTreeSet<(OrdSpan, OrdSpan)>` iterates in `(OrdSpan, OrdSpan)` order.
  const macro_export_errors = [...this.macro_expanded_macro_export_errors].sort(
    (a, b) => new OrdSpan(a[0]).cmp(new OrdSpan(b[0])) || new OrdSpan(a[1]).cmp(new OrdSpan(b[1])),
  );
  for (const [span_use, span_def] of macro_export_errors) {
    this.lint_buffer_.buffer_lint(
      MACRO_EXPANDED_MACRO_EXPORTS_ACCESSED_BY_ABSOLUTE_PATHS,
      CRATE_NODE_ID,
      span_use,
      diagnostics.MacroExpandedMacroExportsAccessedByAbsolutePaths_diagnostic({
        definition: span_def,
      }),
    );
  }

  for (const ambiguity_error of this.ambiguity_errors) {
    const diag = this.ambiguity_diagnostic(ambiguity_error);

    if (ambiguity_error.warning !== undefined) {
      const ambiguity_warning = ambiguity_error.warning;
      const b1_kind = ambiguity_error.b1.kind;
      let node_id: NodeId;
      switch (b1_kind.$) {
        case "Import":
          node_id = b1_kind.import.root_id;
          break;
        case "Def":
          node_id = CRATE_NODE_ID;
          break;
      }

      let lint: Lint;
      if (ambiguity_error.ambig_vis !== undefined) {
        lint = AMBIGUOUS_IMPORT_VISIBILITIES;
      } else if (ambiguity_warning === "GlobImport") {
        lint = AMBIGUOUS_GLOB_IMPORTS;
      } else {
        lint = AMBIGUOUS_PANIC_IMPORTS;
      }

      this.lint_buffer_.buffer_lint(lint, node_id, diag.ident.span, diagnostics.Ambiguity_diagnostic(diag));
    } else {
      diag.is_error = true;
      this.dcx().emit_err(diagnostics.Ambiguity_diagnostic(diag));
    }
  }

  // PORT: `FxHashSet<Span>` only queried (`insert` result), so a `Set` of the interned span.
  const reported_spans = new Set<Span>();
  const privacy_errors = this.privacy_errors;
  this.privacy_errors = []; // `mem::take`
  for (const error of privacy_errors) {
    if (!reported_spans.has(error.dedup_span)) {
      reported_spans.add(error.dedup_span);
      this.report_privacy_error(error);
    }
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:386 report_delayed_vis_resolution_errors
Resolver.prototype.report_delayed_vis_resolution_errors = function (this: Resolver): void {
  const delayed = this.delayed_vis_resolution_errors;
  this.delayed_vis_resolution_errors = []; // `mem::take`
  for (const { vis, parent_scope, error } of delayed) {
    const r = this.try_resolve_visibility(parent_scope, vis, true);
    switch (r.$) {
      case "Ok":
        this.report_vis_error(error);
        break;
      case "Err":
        this.report_vis_error(r._0);
        break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:397 report_with_use_injections
Resolver.prototype.report_with_use_injections = function (this: Resolver, krate: Crate, use_injections: UseError[]): void {
  for (const { err, candidates, node_id, instead, suggestion, path, is_call } of use_injections) {
    const [span, found_use]: [Span | undefined, FoundUse] =
      node_id !== DUMMY_NODE_ID ? UsePlacementFinder.check(krate, node_id) : [undefined, gen.FoundUse.No];

    if (candidates.length !== 0) {
      show_candidates(
        this.tcx_,
        err,
        span,
        candidates,
        instead ? gen.Instead.Yes : gen.Instead.No,
        found_use,
        gen.DiagMode.Normal,
        path,
        "",
      );
      err.emit();
    } else if (suggestion !== undefined) {
      const [span, msg, sugg, appl] = suggestion;
      err.span_suggestion_verbose(span, msg, sugg, appl);
      err.emit();
    } else if (path.length === 1 && is_call) {
      const segment = path[0]!;
      err.stash(segment.ident.span, "CallIntoMethod");
    } else {
      err.emit();
    }
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:433 report_conflict
Resolver.prototype.report_conflict = function (
  this: Resolver,
  ident: IdentKey,
  ns: Namespace,
  old_binding: Decl,
  new_binding: Decl,
): void {
  // Error on the second of two conflicting names
  if (Span.lo(old_binding.span) > Span.lo(new_binding.span)) {
    return this.report_conflict(ident, ns, new_binding, old_binding);
  }

  let container: string;
  const old_kind_ = unwrap(old_binding.parent_module).expect_local().kind;
  switch (old_kind_.$) {
    // Avoid using TyCtxt::def_kind_descr in the resolver, because it
    // indirectly *calls* the resolver, and would cause a query cycle.
    case "Def":
      container = DefKind.descr(old_kind_._0, old_kind_._1);
      break;
    case "Block":
      container = "block";
      break;
  }

  const [name, span] = [ident.name, this.tcx_.sess.source_map().guess_head_span(new_binding.span)];

  if (this.name_already_seen.get(name) === span) {
    return;
  }

  let old_kind: string;
  const old_res = old_binding.res();
  if (ns === "ValueNS") {
    old_kind = "value";
  } else if (ns === "MacroNS") {
    old_kind = "macro";
  } else if (ns === "TypeNS" && old_binding.is_extern_crate()) {
    old_kind = "extern crate";
  } else if (ns === "TypeNS" && old_res.$ === "Def" && old_res._0.$ === "Mod") {
    old_kind = "module";
  } else if (ns === "TypeNS" && old_res.$ === "Def" && old_res._0.$ === "Trait") {
    old_kind = "trait";
  } else {
    old_kind = "type";
  }

  let code: ErrCode;
  const old_ec = old_binding.is_extern_crate();
  const new_ec = new_binding.is_extern_crate();
  if (old_ec && new_ec) {
    code = E0259;
  } else if (old_ec || new_ec) {
    code = new_binding.is_import() && old_binding.is_import() ? E0254 : E0260;
  } else {
    const o = old_binding.is_import_user_facing();
    const n = new_binding.is_import_user_facing();
    if (!o && !n) {
      code = E0428;
    } else if (o && n) {
      code = E0252;
    } else {
      code = E0255;
    }
  }

  const label: diagnostics.NameDefinedMultipleTimeLabel = new_binding.is_import_user_facing()
    ? { $: "Reimported", span, name }
    : { $: "Redefined", span, name };

  let old_binding_label: diagnostics.NameDefinedMultipleTimeOldBindingLabel | undefined;
  if (!Span.is_dummy(old_binding.span) && old_binding.span !== span) {
    const span = this.tcx_.sess.source_map().guess_head_span(old_binding.span);
    old_binding_label = old_binding.is_import_user_facing()
      ? { $: "Import", span, old_kind, name }
      : { $: "Definition", span, old_kind, name };
  }

  const err = this.dcx()
    .create_err(
      diagnostics.NameDefinedMultipleTime_diagnostic({
        span,
        name,
        descr: Namespace.descr(ns),
        container,
        label,
        old_binding_label,
      }),
    )
    .with_code(code);

  // See https://github.com/rust-lang/rust/issues/32354
  const can_suggest = (binding: Decl, import_: Import): boolean => {
    return !Span.is_dummy(binding.span) && !(import_.kind.$ === "MacroUse" || import_.kind.$ === "MacroExport");
  };
  let import_: [Import, Span, boolean] | undefined;
  const nk = new_binding.kind;
  const ok = old_binding.kind;
  if (
    // If there are two imports where one or both have attributes then prefer removing the
    // import without attributes.
    nk.$ === "Import" &&
    ok.$ === "Import" &&
    (nk.import.has_attributes || ok.import.has_attributes) &&
    can_suggest(old_binding, ok.import) &&
    can_suggest(new_binding, nk.import)
  ) {
    const new_ = nk.import;
    const old = ok.import;
    if (old.has_attributes) {
      import_ = [new_, new_binding.span, true];
    } else {
      import_ = [old, old_binding.span, true];
    }
  } else if (nk.$ === "Import" && can_suggest(new_binding, nk.import)) {
    // Otherwise prioritize the new binding.
    import_ = [nk.import, new_binding.span, DeclKind.is_import(ok)];
  } else if (ok.$ === "Import" && can_suggest(old_binding, ok.import)) {
    import_ = [ok.import, old_binding.span, DeclKind.is_import(nk)];
  } else {
    import_ = undefined;
  }

  // Check if the target of the use for both bindings is the same.
  const duplicate = opt_DefId_eq(def_Res.opt_def_id(new_binding.res()), def_Res.opt_def_id(old_binding.res()));
  const has_dummy_span = Span.is_dummy(new_binding.span) || Span.is_dummy(old_binding.span);
  const entry = this.extern_prelude.get(ident);
  const from_item = entry === undefined || entry.introduced_by_item();
  // Only suggest removing an import if both bindings are to the same def, if both spans
  // aren't dummy spans. Further, if both bindings are imports, then the ident must have
  // been introduced by an item.
  const should_remove_import =
    duplicate && !has_dummy_span && (new_binding.is_extern_crate() || old_binding.is_extern_crate() || from_item);

  if (import_ !== undefined && import_[2] && should_remove_import && import_[0].is_nested()) {
    const [import__, span] = import_;
    this.add_suggestion_for_duplicate_nested_use(err, import__, span);
  } else if (import_ !== undefined && import_[2] && should_remove_import && !import_[0].is_glob()) {
    const import__ = import_[0];
    // Simple case - remove the entire import. Due to the above match arm, this can
    // only be a single use so just remove it entirely.
    err.subdiagnostic(
      diagnostics.ToolOnlyRemoveUnnecessaryImport_subdiagnostic({
        span: import__.use_span_with_attributes,
      }),
    );
  } else if (import_ !== undefined) {
    const [import__, span] = import_;
    this.add_suggestion_for_rename_of_use(err, name, import__, span);
  }

  err.emit();

  if (ns === "TypeNS") {
    // Duplicated types wreak havoc on other errors, like impls selecting the wrong
    // type causing wrong number of generic params and other assorted number of
    // irrelevant nonsense, so avoid advancing to the next compiler stage.
    this.raise_fatal_after_resolve = true;
  }
  this.name_already_seen.set(name, span);
};

/// This function adds a suggestion to change the binding name of a new import that conflicts
/// with an existing import.
///
/// ```text,ignore (diagnostic)
/// help: you can use `as` to change the binding name of the import
///    |
/// LL | use foo::bar as other_bar;
///    |     ^^^^^^^^^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:596 add_suggestion_for_rename_of_use
Resolver.prototype.add_suggestion_for_rename_of_use = function (
  this: Resolver,
  err: Diag,
  name: Symbol,
  import_: Import,
  binding_span: Span,
): void {
  const suggested_name = is_uppercase(unwrap(Symbol.as_str(name).codePointAt(0)))
    ? `Other${Symbol.as_str(name)}`
    : `other_${Symbol.as_str(name)}`;

  let suggestion: string | undefined = undefined;
  let span = binding_span;
  const kind = import_.kind;
  switch (kind.$) {
    case "Single": {
      const { source } = kind;
      // `source.span.hi().0.checked_sub(binding_span.lo().0)` (u32)
      const hi = Span.hi(source.span);
      const lo = Span.lo(binding_span);
      const pos = hi >= lo ? hi - lo : undefined;
      if (pos !== undefined) {
        const snippet = this.tcx_.sess.source_map().span_to_snippet(binding_span);
        if (snippet.$ === "Ok" && pos <= snippet._0.len()) {
          const s = snippet._0;
          const ends_with_semi = s.len() > 0 && s.byte(s.len() - 1) === 0x3b; /* ';' */
          span = Span.with_hi(
            Span.with_lo(binding_span, (Span.lo(binding_span) + pos) as BytePos),
            (Span.hi(binding_span) - (ends_with_semi ? 1 : 0)) as BytePos,
          );
          suggestion = ` as ${suggested_name}`;
        }
      }
      break;
    }
    case "ExternCrate": {
      const { source, target } = kind;
      suggestion = `extern crate ${Symbol.as_str(source ?? target.name)} as ${suggested_name};`;
      break;
    }
    default:
      unreachable();
  }

  if (suggestion !== undefined) {
    err.subdiagnostic(diagnostics.ChangeImportBindingSuggestion_subdiagnostic({ span, suggestion }));
  } else {
    err.subdiagnostic(diagnostics.ChangeImportBinding_subdiagnostic({ span }));
  }
};

/// This function adds a suggestion to remove an unnecessary binding from an import that is
/// nested. In the following example, this function will be invoked to remove the `a` binding
/// in the second use statement:
///
/// ```ignore (diagnostic)
/// use issue_52891::a;
/// use issue_52891::{d, a, e};
/// ```
///
/// The following suggestion will be added:
///
/// ```ignore (diagnostic)
/// use issue_52891::{d, a, e};
///                      ^-- help: remove unnecessary import
/// ```
///
/// If the nested use contains only one import then the suggestion will remove the entire
/// line.
///
/// It is expected that the provided import is nested - this isn't checked by the
/// function. If this invariant is not upheld, this function's behaviour will be unexpected
/// as characters expected by span manipulations won't be present.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:662 add_suggestion_for_duplicate_nested_use
Resolver.prototype.add_suggestion_for_duplicate_nested_use = function (
  this: Resolver,
  err: Diag,
  import_: Import,
  binding_span: Span,
): void {
  assert(import_.is_nested(), "assertion failed: import.is_nested()");

  // Two examples will be used to illustrate the span manipulations we're doing:
  //
  // - Given `use issue_52891::{d, a, e};` where `a` is a duplicate then `binding_span` is
  //   `a` and `import.use_span` is `issue_52891::{d, a, e};`.
  // - Given `use issue_52891::{d, e, a};` where `a` is a duplicate then `binding_span` is
  //   `a` and `import.use_span` is `issue_52891::{d, e, a};`.

  const [found_closing_brace, span] = find_span_of_binding_until_next_binding(this.tcx_.sess, binding_span, import_.use_span);

  // If there was a closing brace then identify the span to remove any trailing commas from
  // previous imports.
  if (found_closing_brace) {
    const span_ = extend_span_to_previous_binding(this.tcx_.sess, span);
    if (span_ !== undefined) {
      err.subdiagnostic(diagnostics.ToolOnlyRemoveUnnecessaryImport_subdiagnostic({ span: span_ }));
    } else {
      // Remove the entire line if we cannot extend the span back, this indicates an
      // `issue_52891::{self}` case.
      err.subdiagnostic(
        diagnostics.RemoveUnnecessaryImport_subdiagnostic({
          span: import_.use_span_with_attributes,
        }),
      );
    }

    return;
  }

  err.subdiagnostic(diagnostics.RemoveUnnecessaryImport_subdiagnostic({ span }));
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:699 lint_if_path_starts_with_module
Resolver.prototype.lint_if_path_starts_with_module = function (
  this: Resolver,
  finalize: Finalize,
  path: readonly Segment[],
  second_binding: Decl | undefined,
): void {
  const { node_id, root_span } = finalize;

  let first_name: Symbol;
  const seg = path[0];
  // In the 2018 edition this lint is a hard error, so nothing to do
  if (seg !== undefined && Span.is_rust_2015(seg.ident.span) && this.tcx_.sess.is_rust_2015()) {
    first_name = seg.ident.name;
  } else {
    return;
  }

  // We're only interested in `use` paths which should start with
  // `{{root}}` currently.
  if (first_name !== kw.PathRoot) {
    return;
  }

  const seg1 = path[1];
  if (seg1 !== undefined && seg1.ident.name === kw.Crate) {
    // If this import looks like `crate::...` it's already good
    return;
  } else if (seg1 !== undefined) {
    // Otherwise go below to see if it's an extern crate
  } else {
    // If the path has length one (and it's `PathRoot` most likely)
    // then we don't know whether we're gonna be importing a crate or an
    // item in our crate. Defer this lint to elsewhere
    return;
  }

  // If the first element of our path was actually resolved to an
  // `ExternCrate` (also used for `crate::...`) then no need to issue a
  // warning, this looks all good!
  if (
    second_binding !== undefined &&
    second_binding.kind.$ === "Import" &&
    // Careful: we still want to rewrite paths from renamed extern crates.
    second_binding.kind.import.kind.$ === "ExternCrate" &&
    second_binding.kind.import.kind.source === undefined
  ) {
    return;
  }

  this.lint_buffer_.dyn_buffer_lint_any(ABSOLUTE_PATHS_NOT_STARTING_WITH_CRATE, node_id, root_span, (dcx, level, sess) => {
    if (!(sess instanceof Session)) return panic("expected a `Session`");
    let replacement: string;
    let applicability: Applicability;
    const r = sess.source_map().span_to_snippet(root_span);
    switch (r.$) {
      case "Ok": {
        const s = r._0;
        // FIXME(Manishearth) ideally the emitting code
        // can tell us whether or not this is global
        const opt_colon = str_trim_start(s).starts_with("::") ? "" : "::";

        [replacement, applicability] = [`crate${opt_colon}${s.toString()}`, "MachineApplicable"];
        break;
      }
      case "Err":
        [replacement, applicability] = ["crate::<path>", "HasPlaceholders"];
        break;
    }
    return diagnostics.AbsPathWithModule_into_diag(
      {
        sugg: {
          span: root_span,
          applicability,
          replacement,
        },
      },
      dcx,
      level,
    );
  });
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:775 add_module_candidates
Resolver.prototype.add_module_candidates = function (
  this: Resolver,
  module: Module,
  names: TypoSuggestion[],
  filter_fn: (_0: Res) => boolean,
  ctxt: SyntaxContext | undefined,
): void {
  module.for_each_child(this, (_this, ident, orig_ident_span, _ns, binding) => {
    const res = binding.res();
    if (filter_fn(res) && (ctxt === undefined || ctxt === ident.ctxt)) {
      names.push(TypoSuggestion.new(ident.name, orig_ident_span, res));
    }
  });
};

/// Combines an error with provided span and emits it.
///
/// This takes the error provided, combines it with the span and any additional spans inside the
/// error and emits it.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:794 report_error
Resolver.prototype.report_error = function (this: Resolver, span: Span, resolution_error: ResolutionError): ErrorGuaranteed {
  return this.into_struct_error(span, resolution_error).emit_err();
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:802 into_struct_error
Resolver.prototype.into_struct_error = function (this: Resolver, span: Span, resolution_error: ResolutionError): Diag {
  switch (resolution_error.$) {
    case "GenericParamsFromOuterItem": {
      const { outer_res, has_generic_params, def_kind, inner_item, current_self_ty } = resolution_error;
      // `use diagnostics::GenericParamsFromOuterItemLabel as Label;`
      let static_or_const: diagnostics.GenericParamsFromOuterItemStaticOrConst | undefined;
      switch (def_kind.$) {
        case "Static":
          static_or_const = "Static";
          break;
        case "Const":
          static_or_const = "Const";
          break;
        default:
          static_or_const = undefined;
      }
      const is_self = outer_res.$ === "SelfTyParam" || outer_res.$ === "SelfTyAlias";
      const err: diagnostics.GenericParamsFromOuterItem = {
        span,
        label: undefined,
        refer_to_type_directly: undefined,
        use_let: undefined,
        sugg: undefined,
        static_or_const,
        is_self,
        item:
          inner_item === undefined
            ? undefined
            : {
                span: inner_item[0],
                descr: ast.ItemKind.descr(inner_item[2]),
                is_self,
              },
      };

      const sm = this.tcx_.sess.source_map();
      // Note: do not early return for missing def_id here,
      // we still want to provide suggestions for `Res::SelfTyParam` and `Res::SelfTyAlias`.
      let def_id: DefId | undefined;
      if (outer_res.$ === "SelfTyParam") {
        err.label = { $: "SelfTyParam", _0: span };
        def_id = undefined;
      } else if (outer_res.$ === "SelfTyAlias") {
        const def_id_ = outer_res.alias_to;
        err.label = { $: "SelfTyAlias", _0: reduce_impl_span_to_impl_keyword(sm, this.def_span(def_id_)) };
        err.refer_to_type_directly = current_self_ty === undefined ? undefined : { span, snippet: current_self_ty };
        def_id = undefined;
      } else if (outer_res.$ === "Def" && outer_res._0.$ === "TyParam") {
        const def_id_ = outer_res._1;
        err.label = { $: "TyParam", _0: this.def_span(def_id_) };
        def_id = def_id_;
      } else if (outer_res.$ === "Def" && outer_res._0.$ === "ConstParam") {
        const def_id_ = outer_res._1;
        err.label = { $: "ConstParam", _0: this.def_span(def_id_) };
        def_id = def_id_;
      } else {
        return bug(
          "GenericParamsFromOuterItem should only be used with " +
            "Res::SelfTyParam, Res::SelfTyAlias, DefKind::TyParam or " +
            "DefKind::ConstParam",
        );
      }

      if (inner_item !== undefined && inner_item[2].$ === "Const") {
        const item_span = inner_item[1];
        err.use_let = {
          span: sm.span_until_whitespace(item_span),
        };
      }

      if (
        def_id !== undefined &&
        has_generic_params.$ === "Yes" &&
        !(inner_item !== undefined && inner_item[2].$ === "Delegation")
      ) {
        const span = has_generic_params._0;
        const name = this.tcx_.item_name(def_id);
        let sugg_span: Span;
        let snippet: string;
        if (Span.is_empty(span)) {
          const snippet_ = `<${Symbol.as_str(name)}>`;
          [sugg_span, snippet] = [span, snippet_];
        } else {
          const span_ = Span.shrink_to_hi(sm.span_through_char(span, 0x3c /* '<' */));
          const snippet_ = `${Symbol.as_str(name)}, `;
          [sugg_span, snippet] = [span_, snippet_];
        }
        err.sugg = { span: sugg_span, snippet };
      }

      return this.dcx().create_err(diagnostics.GenericParamsFromOuterItem_diagnostic(err));
    }
    case "NameAlreadyUsedInParameterList": {
      const { _0: name, _1: first_use_span } = resolution_error;
      return this.dcx().create_err(
        diagnostics.NameAlreadyUsedInParameterList_diagnostic({
          span,
          first_use_span,
          name,
        }),
      );
    }
    case "MethodNotMemberOfTrait": {
      const { _0: method, _1: trait_, _2: candidate } = resolution_error;
      return this.dcx().create_err(
        diagnostics.MethodNotMemberOfTrait_diagnostic({
          span,
          method,
          trait_,
          sub: candidate === undefined ? undefined : { span: method.span, candidate },
        }),
      );
    }
    case "TypeNotMemberOfTrait": {
      const { _0: type_, _1: trait_, _2: candidate } = resolution_error;
      return this.dcx().create_err(
        diagnostics.TypeNotMemberOfTrait_diagnostic({
          span,
          type_,
          trait_,
          sub: candidate === undefined ? undefined : { span: type_.span, candidate },
        }),
      );
    }
    case "ConstNotMemberOfTrait": {
      const { _0: const_, _1: trait_, _2: candidate } = resolution_error;
      return this.dcx().create_err(
        diagnostics.ConstNotMemberOfTrait_diagnostic({
          span,
          const_,
          trait_,
          sub: candidate === undefined ? undefined : { span: const_.span, candidate },
        }),
      );
    }
    case "VariableNotBoundInPattern": {
      const { _0: binding_error, _1: parent_scope } = resolution_error;
      const { name, target, origin, could_be_path } = binding_error;

      const target_sp = target.map((pat) => pat.span);
      sort_dedup_by_lo_hi(target_sp);
      const origin_sp = origin.map(([span, _]) => span);
      sort_dedup_by_lo_hi(origin_sp);

      const msp = MultiSpan.from_spans(target_sp.slice());
      const err = this.dcx().create_err(
        diagnostics.VariableIsNotBoundInAllPatterns_diagnostic({
          multispan: msp,
          name,
        }),
      );
      for (const sp of target_sp) {
        err.subdiagnostic(diagnostics.PatternDoesntBindName_subdiagnostic({ span: sp, name }));
      }
      for (const sp of origin_sp) {
        err.subdiagnostic(diagnostics.VariableNotInAllPatterns_subdiagnostic({ span: sp }));
      }
      let suggested_typo = false;
      if (!target.every((pat) => pat.kind.$ === "Ident") && !origin.every(([_, pat]) => pat.kind.$ === "Ident")) {
        // The check above is so that when we encounter `match foo { (a | b) => {} }`,
        // we don't suggest `(a | a) => {}`, which would never be what the user wants.
        // PORT: `BindingVisitor::default()` (`#[derive(Default)]`).
        const target_visitor = new BindingVisitor([], new Map());
        for (const pat of target) {
          target_visitor.visit_pat(pat);
        }
        sort_dedup_symbols(target_visitor.identifiers);
        const origin_visitor = new BindingVisitor([], new Map());
        for (const [_, pat] of origin) {
          origin_visitor.visit_pat(pat);
        }
        sort_dedup_symbols(origin_visitor.identifiers);
        // Find if the binding could have been a typo
        const typo = find_best_match_for_name(target_visitor.identifiers, name.name, undefined);
        if (typo !== undefined && !origin_visitor.identifiers.includes(typo)) {
          err.subdiagnostic(
            diagnostics.PatternBindingTypo_subdiagnostic({
              spans: origin_sp,
              typo,
            }),
          );
          suggested_typo = true;
        }
      }
      if (could_be_path) {
        const import_suggestions = this.lookup_import_candidates(name, "ValueNS", parent_scope, (res: Res) => {
          if (res.$ !== "Def") return false;
          const k = res._0;
          return (
            (k.$ === "Ctor" && k._0 === "Variant" && k._1 === "Const") ||
            (k.$ === "Ctor" && k._0 === "Struct" && k._1 === "Const") ||
            k.$ === "Const" ||
            k.$ === "AssocConst"
          );
        });

        if (import_suggestions.length === 0 && !suggested_typo) {
          const kind_matches: ((kind: DefKind) => boolean)[] = [
            (kind) => kind.$ === "Ctor" && kind._0 === "Variant" && kind._1 === "Const",
            (kind) => kind.$ === "Ctor" && kind._0 === "Struct" && kind._1 === "Const",
            (kind) => kind.$ === "Const",
            (kind) => kind.$ === "AssocConst",
          ];
          const local_names_: TypoSuggestion[] = [];
          this.add_module_candidates(parent_scope.module, local_names_, (res) => res.$ === "Def", undefined);
          // PORT: `FxHashSet<DefId>` only queried (`contains`).
          const local_names = new KeyedSet<DefId>(DefId_key);
          for (const s of local_names_) {
            if (s.res.$ === "Def") local_names.add(s.res._1);
          }

          const local_suggestions: [Symbol, string, string][] = [];
          const suggestions_: [Symbol, string, string][] = [];
          for (const matches_kind of kind_matches) {
            const suggestion = this.early_lookup_typo_candidate(
              { $: "All", _0: "ValueNS" },
              parent_scope,
              name,
              (res: Res) => {
                if (res.$ === "Def") return matches_kind(res._0);
                return false;
              },
              (_) => true,
            );
            if (suggestion !== undefined && suggestion.res.$ === "Def") {
              const kind_ = suggestion.res._0;
              let def_id = suggestion.res._1;
              if (kind_.$ === "Ctor") {
                def_id = this.tcx_.parent(def_id);
              }
              const kind = DefKind.descr(kind_, def_id);
              if (local_names.has(def_id)) {
                // The item is available in the current scope. Very likely to
                // be a typo. Don't use the full path.
                local_suggestions.push([suggestion.candidate, Symbol.as_str(suggestion.candidate), kind]);
              } else {
                suggestions_.push([suggestion.candidate, this.def_path_str(def_id), kind]);
              }
            }
          }
          const suggestions =
            local_suggestions.length !== 0
              ? // There is at least one item available in the current scope that is a
                // likely typo. We only show those.
                local_suggestions
              : suggestions_;
          for (const [name, sugg, kind] of suggestions) {
            err.span_suggestion_verbose(
              span,
              `you might have meant to use the similarly named ${kind} \`${Symbol.as_str(name)}\``,
              sugg,
              "MaybeIncorrect",
            );
            suggested_typo = true;
          }
        }
        if (import_suggestions.length === 0 && !suggested_typo) {
          const help_msg =
            "if you meant to match on a unit struct, unit variant or a `const` " +
            "item, consider making the path in the pattern qualified: " +
            `\`path::to::ModOrType::${display_Ident(name)}\``;
          err.span_help(span, help_msg);
        }
        show_candidates(this.tcx_, err, span, import_suggestions, gen.Instead.No, gen.FoundUse.Yes, gen.DiagMode.Pattern, [], "");
      }
      return err;
    }
    case "VariableBoundWithDifferentMode": {
      const { _0: variable_name, _1: first_binding_span } = resolution_error;
      return this.dcx().create_err(
        diagnostics.VariableBoundWithDifferentMode_diagnostic({
          span,
          first_binding_span,
          variable_name,
        }),
      );
    }
    case "IdentifierBoundMoreThanOnceInParameterList": {
      const { _0: identifier } = resolution_error;
      return this.dcx().create_err(
        diagnostics.IdentifierBoundMoreThanOnceInParameterList_diagnostic({
          span,
          identifier,
        }),
      );
    }
    case "IdentifierBoundMoreThanOnceInSamePattern": {
      const { _0: identifier } = resolution_error;
      return this.dcx().create_err(
        diagnostics.IdentifierBoundMoreThanOnceInSamePattern_diagnostic({
          span,
          identifier,
        }),
      );
    }
    case "UndeclaredLabel": {
      const { name, suggestion } = resolution_error;
      let sub_reachable: diagnostics.LabelWithSimilarNameReachable | undefined;
      let sub_reachable_suggestion: diagnostics.TryUsingSimilarlyNamedLabel | undefined;
      let sub_unreachable: diagnostics.UnreachableLabelWithSimilarNameExists | undefined;
      if (suggestion !== undefined && suggestion[1]) {
        // A reachable label with a similar name exists.
        const ident = suggestion[0];
        [[sub_reachable, sub_reachable_suggestion], sub_unreachable] = [
          [
            { _0: ident.span },
            {
              span,
              ident_name: ident.name,
            },
          ],
          undefined,
        ];
      } else if (suggestion !== undefined) {
        // An unreachable label with a similar name exists.
        const ident = suggestion[0];
        [[sub_reachable, sub_reachable_suggestion], sub_unreachable] = [
          [undefined, undefined],
          {
            ident_span: ident.span,
          },
        ];
      } else {
        // No similarly-named labels exist.
        [[sub_reachable, sub_reachable_suggestion], sub_unreachable] = [[undefined, undefined], undefined];
      }
      return this.dcx().create_err(
        diagnostics.UndeclaredLabel_diagnostic({
          span,
          name,
          sub_reachable,
          sub_reachable_suggestion,
          sub_unreachable,
        }),
      );
    }
    case "FailedToResolve": {
      const { segment, label, suggestion, help, module: module_, message } = resolution_error;
      const err = struct_span_code_err(this.dcx(), span, E0433, message);
      err.span_label(span, label);

      if (suggestion !== undefined) {
        const [suggestions, msg, applicability] = suggestion;
        if (suggestions.length === 0) {
          err.help(msg);
          return err;
        }
        err.multipart_suggestion(msg, suggestions, applicability);
      }

      if (help !== undefined) {
        err.help(help);
      }

      let module: DefId;
      const id = module_ !== undefined && module_.$ === "Module" ? module_._0.opt_def_id() : undefined;
      if (id !== undefined) {
        module = id;
      } else {
        module = LocalDefId.to_def_id(CRATE_DEF_ID);
      }
      this.find_cfg_stripped(err, segment, module);

      return err;
    }
    case "CannotCaptureDynamicEnvironmentInFnItem": {
      const { suggest_closure } = resolution_error;
      return this.dcx().create_err(
        diagnostics.CannotCaptureDynamicEnvironmentInFnItem_diagnostic({
          span,
          suggest_closure,
        }),
      );
    }
    case "AttemptToUseNonConstantValueInConstant": {
      const { ident, suggestion, current, type_span, requires_type } = resolution_error;
      // let foo =...
      //     ^^^ given this Span
      // ------- get this Span to have an applicable suggestion

      // edit:
      // only do this if the const and usage of the non-constant value are on the same line
      // the further the two are apart, the higher the chance of the suggestion being wrong

      const sp = this.tcx_.sess.source_map().span_extend_to_prev_str(ident.span, current, true, false);

      let with_: diagnostics.AttemptToUseNonConstantValueInConstantWithSuggestion | undefined;
      let with_label: diagnostics.AttemptToUseNonConstantValueInConstantLabelWithSuggestion | undefined;
      let without: diagnostics.AttemptToUseNonConstantValueInConstantWithoutSuggestion | undefined;
      if (sp !== undefined && !this.tcx_.sess.source_map().is_multiline(sp)) {
        const sp_ = Span.until(Span.with_lo(sp, (Span.lo(sp) - utf8_len(current)) as BytePos), ident.span);

        // Only suggest replacing the binding keyword if this is a simple
        // binding.
        //
        // Note: this approach still incorrectly suggests for irrefutable
        // patterns like `if let x = 1 { const { x } }`, since the text
        // between `let` and the identifier is just whitespace.
        // See tests/ui/consts/non-const-value-in-const-irrefutable-pat-binding.rs
        const snippet_r = this.tcx_.sess.source_map().span_to_snippet(sp_);
        let is_simple_binding: boolean;
        if (snippet_r.$ === "Ok") {
          const snippet = snippet_r._0;
          const after_keyword = str_trim_end(str_trim_start(snippet.slice(utf8_len(current))));
          is_simple_binding = after_keyword.is_empty() || after_keyword.toString() === "mut";
        } else {
          is_simple_binding = false;
        }

        if (is_simple_binding) {
          [with_, with_label, without] = [
            requires_type === "Usize"
              ? {
                  $: "Usize",
                  span: sp_,
                  suggestion,
                  current,
                  type_span,
                }
              : {
                  $: "Placeholder",
                  span: sp_,
                  suggestion,
                  current,
                  type_span,
                },
            { span },
            undefined,
          ];
        } else {
          [with_, with_label, without] = [undefined, { span }, undefined];
        }
      } else {
        [with_, with_label, without] = [
          undefined,
          undefined,
          {
            ident_span: ident.span,
            suggestion,
          },
        ];
      }

      return this.dcx().create_err(
        diagnostics.AttemptToUseNonConstantValueInConstant_diagnostic({
          span,
          with: with_,
          with_label,
          without,
        }),
      );
    }
    case "BindingShadowsSomethingUnacceptable": {
      const { shadowing_binding, name, participle, article, shadowed_binding, shadowed_binding_span } = resolution_error;
      return this.dcx().create_err(
        diagnostics.BindingShadowsSomethingUnacceptable_diagnostic({
          span,
          shadowing_binding,
          shadowed_binding,
          article,
          sub_suggestion:
            shadowing_binding === "Match" &&
            shadowed_binding.$ === "Def" &&
            shadowed_binding._0.$ === "Ctor" &&
            (shadowed_binding._0._0 === "Variant" || shadowed_binding._0._0 === "Struct") &&
            shadowed_binding._0._1 === "Fn"
              ? {
                  span,
                  name,
                }
              : undefined,
          shadowed_binding_span,
          participle,
          name,
        }),
      );
    }
    case "ForwardDeclaredGenericParam": {
      const { _0: param, _1: reason } = resolution_error;
      if (reason === "Default") {
        return this.dcx().create_err(diagnostics.ForwardDeclaredGenericParam_diagnostic({ param, span }));
      } else {
        // `ForwardGenericParamBanReason::ConstParamTy`
        return this.dcx().create_err(diagnostics.ForwardDeclaredGenericInConstParamTy_diagnostic({ param, span }));
      }
    }
    case "ParamInTyOfConstParam": {
      const { name } = resolution_error;
      return this.dcx().create_err(diagnostics.ParamInTyOfConstParam_diagnostic({ span, name }));
    }
    case "SelfInConstParam":
      return this.dcx().create_err(
        diagnostics.SelfInConstGenericTy_diagnostic({
          span,
          enable_feature: this.tcx().sess.is_nightly_build(),
        }),
      );
    case "ParamInNonTrivialAnonConst": {
      const { is_gca_const_items, name, param_kind } = resolution_error;
      return this.dcx().create_err(
        diagnostics.ParamInNonTrivialAnonConst_diagnostic({
          span,
          name,
          param_kind,
          help: this.tcx_.sess.is_nightly_build() && !this.tcx_.features().gca(),
          is_gca_const_items,
          help_gca: is_gca_const_items,
          help_suggest_gca: this.tcx_.sess.is_nightly_build() && !is_gca_const_items,
        }),
      );
    }
    case "ParamInEnumDiscriminant": {
      const { name, param_kind: is_type } = resolution_error;
      return this.dcx().create_err(
        diagnostics.ParamInEnumDiscriminant_diagnostic({
          span,
          name,
          param_kind: is_type,
        }),
      );
    }
    case "ForwardDeclaredSelf": {
      const { _0: reason } = resolution_error;
      if (reason === "Default") {
        return this.dcx().create_err(diagnostics.SelfInGenericParamDefault_diagnostic({ span }));
      } else {
        // `ForwardGenericParamBanReason::ConstParamTy`
        return this.dcx().create_err(diagnostics.SelfInConstGenericTy_diagnostic({ span, enable_feature: false }));
      }
    }
    case "UnreachableLabel": {
      const { name, definition_span, suggestion } = resolution_error;
      let sub_suggestion_label: diagnostics.UnreachableLabelSubLabel | undefined;
      let sub_suggestion: diagnostics.UnreachableLabelSubSuggestion | undefined;
      let sub_unreachable_label: diagnostics.UnreachableLabelSubLabelUnreachable | undefined;
      if (suggestion !== undefined && suggestion[1]) {
        // A reachable label with a similar name exists.
        const ident = suggestion[0];
        [[sub_suggestion_label, sub_suggestion], sub_unreachable_label] = [
          [
            {
              ident_span: ident.span,
            },
            {
              span,
              // intentionally taking 'ident.name' instead of 'ident' itself, as this
              // could be used in suggestion context
              ident_name: ident.name,
            },
          ],
          undefined,
        ];
      } else if (suggestion !== undefined) {
        // An unreachable label with a similar name exists.
        const ident = suggestion[0];
        [[sub_suggestion_label, sub_suggestion], sub_unreachable_label] = [
          [undefined, undefined],
          {
            ident_span: ident.span,
          },
        ];
      } else {
        // No similarly-named labels exist.
        [[sub_suggestion_label, sub_suggestion], sub_unreachable_label] = [[undefined, undefined], undefined];
      }
      return this.dcx().create_err(
        diagnostics.UnreachableLabel_diagnostic({
          span,
          name,
          definition_span,
          sub_suggestion,
          sub_suggestion_label,
          sub_unreachable_label,
        }),
      );
    }
    case "TraitImplMismatch": {
      const { name, kind, code, trait_item_span, trait_path, trait_span, impl_span } = resolution_error;
      return this.dcx()
        .create_err(
          diagnostics.TraitImplMismatch_diagnostic({
            span,
            name,
            kind,
            trait_path,
            trait_item_span,
            trait_span,
            impl_span,
          }),
        )
        .with_code(code);
    }
    case "TraitImplDuplicate": {
      const { name, trait_item_span, old_span, trait_span, impl_span } = resolution_error;
      return this.dcx().create_err(
        diagnostics.TraitImplDuplicate_diagnostic({
          span,
          name,
          trait_item_span,
          trait_span,
          impl_span,
          old_span,
        }),
      );
    }
    case "InvalidAsmSym":
      return this.dcx().create_err(diagnostics.InvalidAsmSym_diagnostic({ span }));
    case "LowercaseSelf":
      return this.dcx().create_err(diagnostics.LowercaseSelf_diagnostic({ span }));
    case "BindingInNeverPattern":
      return this.dcx().create_err(diagnostics.BindingInNeverPattern_diagnostic({ span }));
  }
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1442 report_vis_error
Resolver.prototype.report_vis_error = function (this: Resolver, vis_resolution_error: VisResolutionError): ErrorGuaranteed {
  let diag: Diag;
  switch (vis_resolution_error.$) {
    case "Relative2018": {
      const { _0: span, _1: path } = vis_resolution_error;
      diag = this.dcx().create_err(
        diagnostics.Relative2018_diagnostic({
          span,
          path_span: path.span,
          // intentionally converting to String, as the text would also be used as
          // in suggestion context
          path_str: pprust.path_to_string(path),
        }),
      );
      break;
    }
    case "AncestorOnly": {
      const { _0: span } = vis_resolution_error;
      diag = this.dcx().create_err(diagnostics.AncestorOnly_diagnostic({ _0: span }));
      break;
    }
    case "FailedToResolve": {
      const { span, segment, label, suggestion, help, message } = vis_resolution_error;
      diag = this.into_struct_error(span, {
        $: "FailedToResolve",
        segment,
        label,
        suggestion,
        help,
        module: undefined,
        message,
      });
      break;
    }
    case "ExpectedFound": {
      const { _0: span, _1: path_str, _2: res } = vis_resolution_error;
      diag = this.dcx().create_err(diagnostics.ExpectedModuleFound_diagnostic({ span, res, path_str }));
      break;
    }
    case "Indeterminate": {
      const { _0: span } = vis_resolution_error;
      diag = this.dcx().create_err(diagnostics.Indeterminate_diagnostic({ _0: span }));
      break;
    }
    case "ModuleOnly": {
      const { _0: span } = vis_resolution_error;
      diag = this.dcx().create_err(diagnostics.ModuleOnly_diagnostic({ _0: span }));
      break;
    }
  }
  return diag.emit_err();
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1490 def_path_str
Resolver.prototype.def_path_str = function (this: Resolver, def_id_: DefId): string {
  let def_id = def_id_;
  // We can't use `def_path_str` in resolve.
  const path = [def_id];
  for (let parent = this.tcx_.opt_parent(def_id); parent !== undefined; parent = this.tcx_.opt_parent(def_id)) {
    def_id = parent;
    path.push(def_id);
    if (def_id.is_top_level_module()) {
      break;
    }
  }
  // We will only suggest importing directly if it is accessible through that path.
  return path
    .reverse()
    .map((def_id) => {
      const name = this.tcx_.opt_item_name(def_id);
      if (name === undefined) return "_";
      const top = def_id.is_top_level_module();
      const local = def_id.is_local();
      if (top && local && this.tcx_.sess.edition() === "Edition2015") {
        return "";
      } else if (top && local) {
        return Symbol.as_str(kw.Crate);
      } else {
        return Symbol.as_str(name);
      }
    })
    .join("::");
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1523 add_scope_set_candidates
Resolver.prototype.add_scope_set_candidates = function (
  this: Resolver,
  suggestions: TypoSuggestion[],
  scope_set: ScopeSet,
  ps: ParentScope,
  sp: Span,
  filter_fn: (_0: Res) => boolean,
): void {
  const ctxt = Macros20NormalizedSyntaxContext.new(Span.ctxt(sp));
  this.cm().visit_scopes(scope_set, ps, ctxt, sp, undefined, (this_, scope, use_prelude, _) => {
    switch (scope.$) {
      case "DeriveHelpers": {
        const expn_id = scope._0;
        const res: Res = { $: "NonMacroAttr", _0: { $: "DeriveHelper" } };
        if (filter_fn(res)) {
          for (const [ident, orig_ident_span, _] of this_.helper_attrs.get(expn_id) ?? []) {
            suggestions.push(TypoSuggestion.new(ident.name, orig_ident_span, res));
          }
        }
        break;
      }
      case "DeriveHelpersCompat":
        // Never recommend deprecated helper attributes.
        break;
      case "MacroRules": {
        const macro_rules_scope = scope._0;
        const s = macro_rules_scope.value;
        if (s.$ === "Def") {
          const macro_rules_def = s._0;
          const res = macro_rules_def.decl.res();
          if (filter_fn(res)) {
            suggestions.push(TypoSuggestion.new(macro_rules_def.ident.name, macro_rules_def.orig_ident_span, res));
          }
        }
        break;
      }
      case "ModuleNonGlobs": {
        const module = scope._0;
        this_.add_module_candidates(module, suggestions, filter_fn, undefined);
        break;
      }
      case "ModuleGlobs":
        // Already handled in `ModuleNonGlobs`.
        break;
      case "MacroUsePrelude":
        for (const [name, binding] of this_.macro_use_prelude) {
          const res = binding.res();
          if (filter_fn(res)) suggestions.push(TypoSuggestion.typo_from_name(name, res));
        }
        break;
      case "BuiltinAttrs": {
        const res: Res = { $: "NonMacroAttr", _0: { $: "Builtin", _0: sym.dummy } };
        if (filter_fn(res)) {
          for (const attr of BUILTIN_ATTRIBUTES) {
            suggestions.push(TypoSuggestion.typo_from_name(attr, res));
          }
        }
        break;
      }
      case "ExternPreludeItems":
        // Add idents from both item and flag scopes.
        for (const [ident, entry] of this_.extern_prelude) {
          const res: Res = { $: "Def", _0: DefKind.Mod, _1: LocalDefId.to_def_id(CRATE_DEF_ID) };
          if (filter_fn(res)) suggestions.push(TypoSuggestion.new(ident.name, entry.span(), res));
        }
        break;
      case "ExternPreludeFlags":
        break;
      case "ToolAttributePrelude": {
        const res: Res = { $: "NonMacroAttr", _0: { $: "Tool" } };
        for (const ident of this_.registered_attr_tools_) {
          suggestions.push(TypoSuggestion.new(ident.name, ident.span, res));
        }
        break;
      }
      case "StdLibPrelude": {
        const prelude = this_.prelude;
        if (prelude !== undefined) {
          const tmp_suggestions: TypoSuggestion[] = [];
          this_.add_module_candidates(prelude, tmp_suggestions, filter_fn, undefined);
          for (const s of tmp_suggestions) {
            if (UsePrelude.bool_from(use_prelude) || this_.is_builtin_macro(s.res)) suggestions.push(s);
          }
        }
        break;
      }
      case "BuiltinTypes":
        for (const prim_ty of PrimTy_ALL) {
          const res: Res = { $: "PrimTy", _0: prim_ty };
          if (filter_fn(res)) suggestions.push(TypoSuggestion.typo_from_name(PrimTy_name(prim_ty), res));
        }
        break;
    }

    return ControlFlow.CONTINUE as ControlFlow<null>;
  });
};

/// Lookup typo candidate in scope for a macro or import.
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1624 early_lookup_typo_candidate
Resolver.prototype.early_lookup_typo_candidate = function (
  this: Resolver,
  scope_set: ScopeSet,
  parent_scope: ParentScope,
  ident: Ident,
  filter_fn: (_0: Res) => boolean,
  suggestion_filter: (_0: TypoSuggestion) => boolean,
): TypoSuggestion | undefined {
  let suggestions: TypoSuggestion[] = [];
  this.add_scope_set_candidates(suggestions, scope_set, parent_scope, ident.span, filter_fn);

  // Some candidates cannot be decided from the `Res` alone (e.g. they need
  // re-resolution or visibility checks), filter them out before picking the
  // best name match.
  suggestions = suggestions.filter(suggestion_filter);

  // Make sure error reporting is deterministic.
  // PORT: `str::cmp` is byte-wise, i.e. code-point order (a stable sort, as `sort_by`).
  suggestions.sort((a, b) => str_cmp(Symbol.as_str(a.candidate), Symbol.as_str(b.candidate)));

  const found = find_best_match_for_name(
    suggestions.map((suggestion) => suggestion.candidate),
    ident.name,
    undefined,
  );
  if (found !== undefined && found !== ident.name) {
    return suggestions.find((suggestion) => suggestion.candidate === found);
  }
  return undefined;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1661 lookup_import_candidates_from_module
Resolver.prototype.lookup_import_candidates_from_module = function (
  this: Resolver,
  lookup_ident: Ident,
  namespace: Namespace,
  parent_scope: ParentScope,
  start_module: Module,
  crate_path: PathSegment[],
  filter_fn: (_0: Res) => boolean,
): ImportSuggestion[] {
  const candidates: ImportSuggestion[] = [];
  // PORT: `FxHashSet<DefId>` only queried (`insert` result).
  const seen_modules = new KeyedSet<DefId>(DefId_key);
  const start_did = start_module.def_id();
  const worklist: [Module, PathSegment[], boolean, boolean, boolean][] = [
    [start_module, [], true, start_did.is_local() || !this.tcx_.is_doc_hidden(start_did), true],
  ];
  const worklist_via_import: [Module, PathSegment[], boolean, boolean, boolean][] = [];

  for (;;) {
    const next = worklist.pop() ?? worklist_via_import.pop();
    if (next === undefined) break;
    const [in_module, path_segments, accessible, doc_visible, is_stable] = next;
    const in_module_is_extern = !in_module.def_id().is_local();
    in_module.for_each_child(this, (this_, ident, orig_ident_span, ns, name_binding) => {
      // Avoid non-importable candidates.
      if (name_binding.is_assoc_item() && !this_.features.import_trait_associated_functions()) {
        return;
      }

      if (ident.name === kw.Underscore) {
        return;
      }

      const child_accessible = accessible && this_.is_accessible_from(name_binding.vis(), parent_scope.module);

      // do not venture inside inaccessible items of other crates
      if (in_module_is_extern && !child_accessible) {
        return;
      }

      const via_import = name_binding.is_import() && !name_binding.is_extern_crate();

      // There is an assumption elsewhere that paths of variants are in the enum's
      // declaration and not imported. With this assumption, the variant component is
      // chopped and the rest of the path is assumed to be the enum's own path. For
      // errors where a variant is used as the type instead of the enum, this causes
      // funny looking invalid suggestions, i.e `foo` instead of `foo::MyEnum`.
      if (via_import && name_binding.is_possibly_imported_variant()) {
        return;
      }

      // #90113: Do not count an inaccessible reexported item as a candidate.
      if (
        name_binding.kind.$ === "Import" &&
        this_.is_accessible_from(name_binding.kind.source_decl.vis(), parent_scope.module) &&
        !this_.is_accessible_from(name_binding.vis(), parent_scope.module)
      ) {
        return;
      }

      const res = name_binding.res();
      const did = res.$ === "Def" && res._0.$ === "Ctor" ? this_.tcx_.opt_parent(res._1) : def_Res.opt_def_id(res);
      const child_doc_visible = doc_visible && (did === undefined || did.is_local() || !this_.tcx_.is_doc_hidden(did));

      // collect results based on the filter function
      // avoid suggesting anything from the same module in which we are resolving
      // avoid suggesting anything with a hygienic name
      if (
        ident.name === lookup_ident.name &&
        ns === namespace &&
        in_module !== parent_scope.module &&
        SyntaxContext.is_root(ident.ctxt) &&
        filter_fn(res)
      ) {
        // create the path
        const segms: PathSegment[] = Span.at_least_rust_2018(lookup_ident.span)
          ? // crate-local absolute paths start with `crate::` in edition 2018
            // FIXME: may also be stabilized for Rust 2015 (Issues #45477, #44660)
            crate_path.map(ast.clone_PathSegment)
          : [];
        segms.push(...path_segments.map(ast.clone_PathSegment));

        segms.push(ast.PathSegment.from_ident(ident.orig(orig_ident_span)));
        const path = new ast.Path(name_binding.span, segms);

        if (child_accessible) {
          // Remove invisible match if exists
          const idx = candidates.findIndex((v: ImportSuggestion) => opt_DefId_eq(v.did, did) && !v.accessible);
          if (idx !== -1) {
            candidates.splice(idx, 1);
          }
        }

        let is_stable_: boolean;
        if (is_stable && did !== undefined && this_.is_stable(did, path.span)) {
          is_stable_ = true;
        } else {
          is_stable_ = false;
        }

        // Rreplace unstable suggestions if we meet a new stable one,
        // and do nothing if any other situation. For example, if we
        // meet `std::ops::Range` after `std::range::legacy::Range`,
        // we will remove the latter and then insert the former.
        if (is_stable_) {
          const idx = candidates.findIndex((v: ImportSuggestion) => opt_DefId_eq(v.did, did) && !v.is_stable);
          if (idx !== -1) {
            candidates.splice(idx, 1);
          }
        }

        if (candidates.every((v: ImportSuggestion) => !opt_DefId_eq(v.did, did))) {
          // See if we're recommending TryFrom, TryInto, or FromIterator and add
          // a note about editions
          let note: string | undefined;
          if (did !== undefined) {
            const requires_note =
              !did.is_local() &&
              find_attr(DefId_get_attrs_extern(did, this_.tcx_), (k: AttributeKind) =>
                k.$ === "RustcDiagnosticItem" && (k._0 === sym.TryInto || k._0 === sym.TryFrom || k._0 === sym.FromIterator)
                  ? true
                  : undefined,
              ) !== undefined;
            note = requires_note
              ? `'${path_names_to_string(path)}' is included in the prelude starting in Edition 2021`
              : undefined;
          } else {
            note = undefined;
          }

          candidates.push({
            did,
            descr: def_Res.descr(res),
            path,
            accessible: child_accessible,
            doc_visible: child_doc_visible,
            note,
            via_import,
            is_stable: is_stable_,
          });
        }
      }

      // collect submodules to explore
      const def_id = def_Res.module_like_def_id(name_binding.res());
      if (def_id !== undefined) {
        // form the path
        const path_segments_ = path_segments.map(ast.clone_PathSegment);
        path_segments_.push(ast.PathSegment.from_ident(ident.orig(orig_ident_span)));

        let alias_import: boolean;
        if (
          name_binding.kind.$ === "Import" &&
          name_binding.kind.import.kind.$ === "ExternCrate" &&
          name_binding.kind.import.kind.source !== undefined &&
          name_binding.kind.import.parent_scope.expansion === parent_scope.expansion
        ) {
          alias_import = true;
        } else {
          alias_import = false;
        }

        const is_extern_crate_that_also_appears_in_prelude =
          name_binding.is_extern_crate() && Span.at_least_rust_2018(lookup_ident.span);

        if (!is_extern_crate_that_also_appears_in_prelude || alias_import) {
          // add the module to the lookup
          if (!seen_modules.has(def_id)) {
            seen_modules.add(def_id);
            (via_import ? worklist_via_import : worklist).push([
              this_.expect_module(def_id),
              path_segments_,
              child_accessible,
              child_doc_visible,
              is_stable && this_.is_stable(def_id, name_binding.span),
            ]);
          }
        }
      }
    });
  }

  return candidates;
};

// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1865 is_stable
Resolver.prototype.is_stable = function (this: Resolver, did: DefId, span: Span): boolean {
  if (did.is_local()) {
    return true;
  }

  // PORT: the `lookup_stability` query value is typed `unknown` in queries.gen.ts (no typemap entry for
  // `rustc_attr_ir::Stability`); it is the `Option<Stability>` of rustc_attr_ir.
  const stab = this.tcx_.lookup_stability(did) as Stability | undefined;
  if (stab !== undefined && stab.level.$ === "Unstable") {
    const { implied_by } = stab.level;
    const feature = stab.feature;
    if (Span.allows_unstable(span, feature)) {
      return true;
    } else if (this.features.enabled(feature)) {
      return true;
    } else if (implied_by !== undefined && this.features.enabled(implied_by)) {
      return true;
    } else {
      return false;
    }
  } else if (stab !== undefined) {
    return true;
  } else {
    return false;
  }
};

/// When name resolution fails, this method can be used to look up candidate
/// entities with the expected name. It allows filtering them using the
/// supplied predicate (which should be used to only accept the types of
/// definitions expected, e.g., traits). The lookup spans across all crates.
///
/// N.B., the method does not look into imports, but this is not a problem,
/// since we report the definitions (thus, the de-aliased imports).
// rustc: compiler/rustc_resolve/src/diagnostics/impls.rs:1898 lookup_import_candidates
Resolver.prototype.lookup_import_candidates = function (
  this: Resolver,
  lookup_ident: Ident,
  namespace: Namespace,
  parent_scope: ParentScope,
  filter_fn: (_0: Res) => boolean,
): ImportSuggestion[] {
  const crate_path = [ast.PathSegment.from_ident(Ident.with_dummy_span(kw.Crate))];
  let suggestions = this.lookup_import_candidates_from_module(
    lookup_ident,
    namespace,
    parent_scope,
    this.graph_root.to_module(),
    crate_path,
    filter_fn,
  );

  if (Span.at_least_rust_2018(lookup_ident.span)) {
    for (const [ident, entry] of this.extern_prelude) {
      if (Span.from_expansion(entry.span())) {
        // Idents are adjusted to the root context before being
        // resolved in the extern prelude, so reporting this to the
        // user is no help. This skips the injected
        // `extern crate std` in the 2018 edition, which would
        // otherwise cause duplicate suggestions.
        continue;
      }
      const crate_id = this.cstore_mut().maybe_process_path_extern(this.tcx_, ident.name);
      if (crate_id === undefined) {
        continue;
      }

      const crate_def_id = CrateNum.as_def_id(crate_id);
      const crate_root = this.expect_module(crate_def_id);

      // Check if there's already an item in scope with the same name as the crate.
      // If so, we have to disambiguate the potential import suggestions by making
      // the paths *global* (i.e., by prefixing them with `::`).
      let needs_disambiguation = false;
      for (const [key, name_resolution] of this.resolutions(parent_scope.module)) {
        let r: boolean;
        const decl = key.ns === "TypeNS" && IdentKey_eq(key.ident, ident) ? name_resolution.borrow_checked(this).best_decl() : undefined;
        if (decl !== undefined) {
          const res = decl.res();
          switch (res.$) {
            // No disambiguation needed if the identically named item we
            // found in scope actually refers to the crate in question.
            case "Def":
              r = !DefId_eq(res._1, crate_def_id);
              break;
            case "PrimTy":
              r = true;
              break;
            default:
              r = false;
          }
        } else {
          r = false;
        }
        if (r) {
          needs_disambiguation = true;
          break;
        }
      }
      const crate_path: PathSegment[] = [];
      if (needs_disambiguation) {
        crate_path.push(ast.PathSegment.path_root(DUMMY_SP));
      }
      crate_path.push(ast.PathSegment.from_ident(ident.orig(entry.span())));

      suggestions.push(
        ...this.lookup_import_candidates_from_module(lookup_ident, namespace, parent_scope, crate_root, crate_path, filter_fn),
      );
    }
  }

  suggestions = suggestions.filter((suggestion) => suggestion.is_stable || this.tcx_.sess.is_nightly_build());
  return suggestions;
};

// ---- res-diag-a: local helpers (no upstream counterpart) ----

/** PORT: `FormatArgs { this, .. }` (the struct's default field values, rustc_attr_ir diagnostic.rs:213). */
function FormatArgs_default(this_: string): FormatArgs {
  return {
    this: this_,
    this_resolved: "",
    this_path: "",
    found: "",
    expected: "",
    unresolved: "",
    item_context: "",
    generic_args: [],
  };
}

/** `Option<DefId> == Option<DefId>` */
function opt_DefId_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : DefId_eq(a, b);
}

/** `v.sort_by_key(|sp| sp.lo_hi()); v.dedup_by_key(|sp| sp.lo_hi());` (stable sort). */
function sort_dedup_by_lo_hi(v: Span[]): void {
  v.sort((a, b) => new OrdSpan(a).cmp(new OrdSpan(b)));
  for (let i = v.length - 1; i > 0; i--) {
    if (new OrdSpan(v[i - 1]!).eq(new OrdSpan(v[i]!))) v.splice(i, 1);
  }
}

/** `v.sort(); v.dedup();` on `Vec<Symbol>` (`Symbol: Ord` compares the interned index). */
function sort_dedup_symbols(v: Symbol[]): void {
  v.sort((a, b) => a - b);
  for (let i = v.length - 1; i > 0; i--) {
    if (v[i - 1] === v[i]) v.splice(i, 1);
  }
}


/**
 * PORT: `find_attr!(tcx, did, ..)` for an extern `did` (callers check `!did.is_local()` first): the
 * attributes are `tcx.attrs_for_def(did)` (`impl HasAttrs for DefId`, rustc_middle ty/mod.rs, not
 * ported; same stand-in as lib.ts's `DefId_get_attrs`).
 */
function DefId_get_attrs_extern(did: DefId, tcx: TyCtxt): readonly HirAttribute[] {
  if (did.is_local()) return unported("tcx.hir_attrs(tcx.local_def_id_to_hir_id(did)) (HIR, M3)");
  return tcx.attrs_for_def(did) as readonly HirAttribute[];
}

