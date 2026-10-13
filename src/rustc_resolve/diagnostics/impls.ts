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
import { unported_methods } from "../../rust_ts/stubs.ts";
import { Resolver } from "../decls.ts";
import * as gen from "./impls.gen.ts";
import type { DiagMode, FoundUse, ImportSuggestion, Instead } from "./impls.gen.ts";
import type { Res, Segment } from "../lib.ts";

// res-diag-a imports
import { ast, CRATE_NODE_ID, DUMMY_NODE_ID, type PathSegment } from "../../rustc_ast/lib.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import { type Attribute as HirAttribute, type AttributeKind, find_attr, type Stability } from "../../rustc_attr_ir/lib.ts";
import { type CustomDiagnostic, default_CustomDiagnostic, type FormatArgs } from "../../rustc_attr_ir/diagnostic.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import {
  type DiagCtxtHandle,
  E0252,
  E0254,
  E0255,
  E0259,
  E0260,
  E0428,
  E0432,
  E0433,
  type ErrCode,
  type ErrorGuaranteed,
  struct_span_code_err,
} from "../../rustc_errors/lib.ts";
import { BUILTIN_ATTRIBUTES } from "../../rustc_feature/lib.ts";
import { DefKind, Namespace, Res as def_Res } from "../../rustc_hir/def.ts";
import {
  ABSOLUTE_PATHS_NOT_STARTING_WITH_CRATE,
  AMBIGUOUS_GLOB_IMPORTS,
  AMBIGUOUS_IMPORT_VISIBILITIES,
  AMBIGUOUS_PANIC_IMPORTS,
  MACRO_EXPANDED_MACRO_EXPORTS_ACCESSED_BY_ABSOLUTE_PATHS,
} from "../../rustc_lint_defs/builtin.ts";
import { type Applicability, type Lint, pluralize } from "../../rustc_lint_defs/lib.ts";
import { CRATE_DEF_ID, CrateNum, type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { type BytePos, DUMMY_SP, OrdSpan } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Ident, Ident, kw } from "../../rustc_span/symbol.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { is_uppercase } from "../../std/char.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { str_trim_end, str_trim_start, utf8_len } from "../../std/str.ts";
import * as diagnostics from "./mod.ts";
import type { Import, UnresolvedImportError } from "../imports.ts";
// PORT (init order): the rustc_resolve bindings below are read inside function bodies only.
import { import_path_to_string } from "../imports.ts";
import { UsePrelude } from "../ident.ts";
import {
  type Decl,
  DeclKind,
  DefId_key,
  type Finalize,
  type IdentKey,
  IdentKey_eq,
  Macros20NormalizedSyntaxContext,
  type Module,
  type ParentScope,
  path_names_to_string,
  PrimTy_ALL,
  PrimTy_name,
  type ResolutionError,
  type ScopeSet,
  type UseError,
  type VisResolutionError,
} from "../lib.ts";

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

/** `str::cmp` (byte-wise = code-point order). */
function str_cmp(a: string, b: string): number {
  const ia = a[globalThis.Symbol.iterator]();
  const ib = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
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

unported_methods(Resolver.prototype, "rustc_resolve::diagnostics::impls::Resolver", ["unresolved_macro_suggestions", "detect_derive_attribute", "add_typo_suggestion", "decl_description", "ambiguity_diagnostic", "ctor_fields_span", "module_path_names", "shorten_candidate_path", "shorten_import_path", "report_privacy_error", "mention_default_field_values", "find_similarly_named_module_or_crate", "report_path_resolution_error", "undeclared_module_suggest_declare", "undeclared_module_exists", "make_path_suggestion", "make_missing_self_suggestion", "make_missing_crate_suggestion", "make_missing_super_suggestion", "make_external_crate_suggestion", "check_for_module_export_macro", "find_cfg_stripped", "struct_ctor", "on_unknown_data"]);
unported_methods(UsePlacementFinder.prototype, "rustc_resolve::diagnostics::impls::UsePlacementFinder", ["visit_crate", "visit_item"]);
unported_methods(BindingVisitor.prototype, "rustc_resolve::diagnostics::impls::BindingVisitor", ["visit_pat"]);
