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
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Ident } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { LateResolutionVisitor } from "../decls.ts";
import { type ImportSuggestion, TypoSuggestion } from "../diagnostics/impls.ts";
import { Segment } from "../lib.ts";
import * as gen from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// res-late-diag-a imports
import { type AttributeKind, find_attr } from "../../rustc_attr_ir/lib.ts";
import type { FormatArgs } from "../../rustc_attr_ir/diagnostic.ts";
import { ast, type Expr } from "../../rustc_ast/lib.ts";
import { pprust } from "../../rustc_ast_pretty/lib.ts";
import { type Applicability, type Diag, E0411, E0424, E0425, into_MultiSpan, pluralize } from "../../rustc_errors/lib.ts";
import { index_map_swap_remove } from "../../rustc_errors/decorate_diag.ts";
import { Res as def_Res } from "../../rustc_hir/def.ts";
import { CRATE_DEF_ID, type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { Edition, Edition_discriminant } from "../../rustc_span/edition.ts";
import { BytePos, type Spanned } from "../../rustc_span/lib.ts";
import { FileName_eq } from "../../rustc_span/source_map.ts";
import { display_Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { ch } from "../../std/char.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { PathSource } from "../late.ts";
import { DefId_key, type Module, type PathResult, type Res } from "../lib.ts";
import { path_names_to_string } from "../lib.ts";
import * as diagnostics from "../diagnostics/mod.ts";
import type { Resolver } from "../decls.ts";
import type { BaseError } from "./diagnostics.gen.ts";
// end res-late-diag-a imports

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

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:75 is_self_type
export function is_self_type(path: readonly Segment[], namespace: Namespace): boolean {
  return namespace === "TypeNS" && path.length === 1 && path[0]!.ident.name === kw.SelfUpper;
}
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:79 is_self_value
export function is_self_value(path: readonly Segment[], namespace: Namespace): boolean {
  return namespace === "ValueNS" && path.length === 1 && path[0]!.ident.name === kw.SelfLower;
}
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:83 path_to_string_without_assoc_item_bindings
export function path_to_string_without_assoc_item_bindings(path_: Path): string {
  const path = ast.clone_Path(path_);
  for (const segment of path.segments) {
    let remove_args = false;
    const args = segment.args;
    if (args !== undefined && args.$ === "AngleBracketed") {
      const angle_bracketed = args._0;
      // PORT: `retain` on the clone's own `args` vector.
      angle_bracketed.args = angle_bracketed.args.filter((arg) => arg.$ === "Arg");
      remove_args = angle_bracketed.args.length === 0;
    }
    if (remove_args) {
      segment.args = undefined;
    }
  }
  return pprust.path_to_string(path);
}
/// Gets the stringified path for an enum from an `ImportSuggestion` for an enum variant.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:101 import_candidate_to_enum_paths
export function import_candidate_to_enum_paths(suggestion: ImportSuggestion): [string, string] {
  const variant_path = suggestion.path;
  const variant_path_string = path_names_to_string(variant_path);

  const path_len = suggestion.path.segments.length;
  // PORT: with an empty path, `path_len - 1` wraps (rustc ships without overflow checks) and the
  // slice index panics; JS `slice(0, -1)` would silently give `[]`.
  if (path_len === 0) return panic("range end index 18446744073709551615 out of range for slice of length 0");
  const enum_path = new ast.Path(suggestion.path.span, suggestion.path.segments.slice(0, path_len - 1).map(ast.clone_PathSegment));
  const enum_path_string = path_names_to_string(enum_path);

  return [variant_path_string, enum_path_string];
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
  // rustc: compiler/rustc_resolve/src/late/diagnostics.rs:58 action
  action(self: AssocSuggestion): string {
    if (self.$ === "Field") {
      return "use the available field";
    } else if (self.$ === "MethodWithSelf" && self.called) {
      return "call the method with the fully-qualified path";
    } else if (self.$ === "MethodWithSelf" && !self.called) {
      return "refer to the method with the fully-qualified path";
    } else if (self.$ === "AssocFn" && self.called) {
      return "call the associated function";
    } else if (self.$ === "AssocFn" && !self.called) {
      return "refer to the associated function";
    } else if (self.$ === "AssocConst") {
      return "use the associated `const`";
    } else if (self.$ === "AssocType") {
      return "use the associated type";
    }
    return unreachable();
  },
};
export type TypoCandidate = gen.TypoCandidate;
export const TypoCandidate = {
  ...gen.TypoCandidate,
  // rustc: compiler/rustc_resolve/src/late/diagnostics.rs:179 to_opt_suggestion
  to_opt_suggestion(self: TypoCandidate): TypoSuggestion | undefined {
    switch (self.$) {
      case "Typo":
        return self._0;
      case "Shadowed":
      case "None":
        return undefined;
    }
  },
};
// ---- res-late-diag-a: `impl LateResolutionVisitor` (late/diagnostics.rs:187-2266) ----

// PORT: `#[derive(PartialEq)]` of `ast::TraitBoundModifiers` (and of its three field enums, whose
// payloads are `Span`s compared by value); local because no `_eq` is generated for it yet (same
// helper as rustc_parse/parser/path.ts).
function TraitBoundModifiers_eq(a: ast.TraitBoundModifiers, b: ast.TraitBoundModifiers): boolean {
  const eq = (x: { $: string; _0?: Span }, y: { $: string; _0?: Span }): boolean => x.$ === y.$ && x._0 === y._0;
  return eq(a.constness, b.constness) && eq(a.asyncness, b.asyncness) && eq(a.polarity, b.polarity);
}

/** PORT: `String`'s `Ord` (byte-wise UTF-8 order = code point order; JS `<` compares UTF-16 units). */
function str_cmp(a: string, b: string): number {
  const xs = [...a];
  const ys = [...b];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i]!.codePointAt(0)!;
    const y = ys[i]!.codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return xs.length - ys.length;
}

/** `PathSource::Expr(Some(Expr { kind: ExprKind::<K>(..), .. }))`: the parent expression's kind. */
function expr_parent_kind(source: PathSource): ast.ExprKind | undefined {
  return source.$ === "Expr" && source._0 !== undefined ? source._0.kind : undefined;
}

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:188 trait_assoc_type_def_id_by_name
LateResolutionVisitor.prototype.trait_assoc_type_def_id_by_name = function (this: LateResolutionVisitor, trait_def_id: DefId, assoc_name: Symbol): DefId | undefined {
  const module = this.r.get_module(trait_def_id);
  if (module === undefined) return undefined;
  for (const [key, resolution_] of this.r.resolutions(module)) {
    if (key.ident.name !== assoc_name) {
      continue;
    }
    const resolution = resolution_.borrow(this.r);
    const binding = resolution.best_decl();
    if (binding === undefined) continue;
    const res = binding.res();
    if (res.$ === "Def" && res._0.$ === "AssocTy") {
      return res._1;
    }
  }
  return undefined;
};

/// This does best-effort work to generate suggestions for associated types.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:208 suggest_assoc_type_from_bounds
LateResolutionVisitor.prototype.suggest_assoc_type_from_bounds = function (this: LateResolutionVisitor, err: Diag, source: PathSource, path: readonly Segment[], ident_span: Span): boolean {
  // Filter out cases where we cannot emit meaningful suggestions.
  if (PathSource.namespace(source) !== "TypeNS") {
    return false;
  }
  if (path.length !== 1) return false;
  const segment = path[0]!;
  if (segment.has_generic_args) {
    return false;
  }
  if (!Span.can_be_used_for_suggestions(ident_span)) {
    return false;
  }
  const assoc_name = segment.ident.name;
  if (assoc_name === kw.Underscore) {
    return false;
  }

  // Map: type parameter name -> (trait def id -> (assoc type def id, trait paths as written)).
  // We keep a set of paths per trait so we can detect cases like
  // `T: Trait<i32> + Trait<u32>` where suggesting `T::Assoc` would be ambiguous.
  const matching_bounds: Map<Symbol, Map<DefId, [DefId, Set<string>]>> = new Map();

  const record_bound = (this_: LateResolutionVisitor, ty_param: Symbol, poly_trait_ref: ast.PolyTraitRef): void => {
    // Avoid generating suggestions we can't print in a well-formed way.
    if (poly_trait_ref.bound_generic_params.length !== 0) {
      return;
    }
    if (!TraitBoundModifiers_eq(poly_trait_ref.modifiers, ast.TraitBoundModifiers.NONE)) {
      return;
    }
    const trait_seg = poly_trait_ref.trait_ref.path.segments.at(-1);
    if (trait_seg === undefined) {
      return;
    }
    const partial_res = this_.r.partial_res_map.get(trait_seg.id);
    if (partial_res === undefined) {
      return;
    }
    const full_res = partial_res.full_res();
    const trait_def_id = full_res === undefined ? undefined : def_Res.opt_def_id(full_res);
    if (trait_def_id === undefined) {
      return;
    }
    const assoc_type_def_id = this_.trait_assoc_type_def_id_by_name(trait_def_id, assoc_name);
    if (assoc_type_def_id === undefined) {
      return;
    }

    // Preserve `::` and generic args so we don't generate broken suggestions like
    // `<T as Foo>::Assoc` for bounds written as `T: ::Foo<'a>`, while stripping
    // associated-item bindings that are rejected in qualified paths.
    const trait_path = path_to_string_without_assoc_item_bindings(poly_trait_ref.trait_ref.path);
    let trait_bounds_ = matching_bounds.get(ty_param);
    if (trait_bounds_ === undefined) {
      trait_bounds_ = new KeyedMap<DefId, [DefId, Set<string>]>(DefId_key);
      matching_bounds.set(ty_param, trait_bounds_);
    }
    let trait_bounds = trait_bounds_.get(trait_def_id);
    if (trait_bounds === undefined) {
      trait_bounds = [assoc_type_def_id, new Set()];
      trait_bounds_.set(trait_def_id, trait_bounds);
    }
    // debug_assert_eq!(trait_bounds.0, assoc_type_def_id);
    trait_bounds[1].add(trait_path);
  };

  const record_from_generics = (this_: LateResolutionVisitor, generics: ast.Generics): void => {
    for (const param of generics.params) {
      if (param.kind.$ !== "Type") continue;
      for (const bound of param.bounds) {
        if (bound.$ !== "Trait") continue;
        record_bound(this_, param.ident.name, bound._0);
      }
    }

    for (const predicate of generics.where_clause.predicates) {
      if (predicate.kind.$ !== "BoundPredicate") {
        continue;
      }
      const where_bound = predicate.kind._0;

      const bounded_kind = where_bound.bounded_ty.kind;
      if (!(bounded_kind.$ === "Path" && bounded_kind._0 === undefined)) {
        continue;
      }
      const bounded_path = bounded_kind._1;
      if (!(bounded_path.segments.length === 1 && bounded_path.segments[0]!.args === undefined)) {
        continue;
      }
      const ident = bounded_path.segments[0]!.ident;

      // Only suggest for bounds that are explicitly on an in-scope type parameter.
      const partial_res = this_.r.partial_res_map.get(where_bound.bounded_ty.id);
      if (partial_res === undefined) {
        continue;
      }
      const full_res = partial_res.full_res();
      if (!(full_res !== undefined && full_res.$ === "Def" && full_res._0.$ === "TyParam")) {
        continue;
      }

      for (const bound of where_bound.bounds) {
        if (bound.$ !== "Trait") continue;
        record_bound(this_, ident.name, bound._0);
      }
    }
  };

  {
    const item = this.diag_metadata.current_item;
    const generics = item === undefined ? undefined : ast.ItemKind.generics(item.kind);
    if (item !== undefined && generics !== undefined) {
      record_from_generics(this, generics);
    }
  }

  {
    const item = this.diag_metadata.current_item;
    const assoc = this.diag_metadata.current_impl_item;
    if (item !== undefined && item.kind.$ === "Impl" && assoc !== undefined) {
      let generics: ast.Generics | undefined;
      switch (assoc.kind.$) {
        case "Const":
        case "Fn":
        case "Type":
          generics = assoc.kind._0.generics;
          break;
        case "Delegation":
        case "MacCall":
        case "DelegationMac":
          generics = undefined;
          break;
      }
      if (generics !== undefined) {
        record_from_generics(this, generics);
      }
    }
  }

  const suggestions_: Set<string> = new Set();
  for (const [ty_param_, traits] of matching_bounds) {
    const ty_param = Symbol.to_ident_string(ty_param_);
    let trait_paths_len = 0;
    for (const [, paths] of traits.values()) trait_paths_len += paths.size;
    if (traits.size === 1 && trait_paths_len === 1) {
      const assoc_type_def_id = unwrap(traits.values().next().value)[0];
      const assoc_segment = `${Symbol.as_str(assoc_name)}${this.r.item_required_generic_args_suggestion(assoc_type_def_id)}`;
      suggestions_.add(`${ty_param}::${assoc_segment}`);
    } else {
      for (const [assoc_type_def_id, trait_paths] of traits.values()) {
        const assoc_segment = `${Symbol.as_str(assoc_name)}${this.r.item_required_generic_args_suggestion(assoc_type_def_id)}`;
        for (const trait_path of trait_paths) {
          suggestions_.add(`<${ty_param} as ${trait_path}>::${assoc_segment}`);
        }
      }
    }
  }

  if (suggestions_.size === 0) {
    return false;
  }

  const suggestions: string[] = [...suggestions_];
  suggestions.sort(str_cmp);

  err.span_suggestions_with_style(
    ident_span,
    "you might have meant to use an associated type of the same name",
    suggestions,
    "MaybeIncorrect",
    "ShowAlways",
  );

  return true;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:383 make_base_error
LateResolutionVisitor.prototype.make_base_error = function (this: LateResolutionVisitor, path: readonly Segment[], span: Span, source: PathSource, res: Res | undefined, could_be_expr: boolean): BaseError {
  // Make the base error.
  let expected = PathSource.descr_expected(source);
  const path_str = Segment.names_to_string(path);

  if (res !== undefined) {
    return {
      msg: `expected ${expected}, found ${def_Res.descr(res)} \`${path_str}\``,
      fallback_label: `not a ${expected}`,
      span,
      span_label: res.$ === "Def" && res._0.$ === "TyParam" ? [this.r.def_span(res._1), "found this type parameter"] : undefined,
      could_be_expr,
      suggestion: undefined,
      module: undefined,
      notes: [],
    };
  } else {
    let span_label: [Span, string] | undefined = undefined;
    const item_ident = unwrap(path.at(-1)).ident;
    const item_span = item_ident.span;
    let tick: string;
    let mod_prefix: string;
    let mod_str: string;
    let module: DefId | undefined;
    let suggestion: [Span, string, string] | undefined;
    if (path.length === 1) {
      // debug!(?self.diag_metadata.current_impl_items);
      // debug!(?self.diag_metadata.current_function);
      let found: [ast.FnSig, ast.AssocItem] | undefined;
      const current_function = this.diag_metadata.current_function;
      if (this.current_trait_ref === undefined && current_function !== undefined) {
        const fn_kind = current_function[0];
        const ctxt = visit.FnKind.ctxt(fn_kind);
        if (ctxt !== undefined && ctxt.$ === "Assoc" && fn_kind.$ === "Fn") {
          const sig = fn_kind._2.sig;
          const items = this.diag_metadata.current_impl_items;
          if (items !== undefined) {
            const item = items.find((i) => {
              const ident = ast.AssocItemKind.ident(i.kind);
              // Don't suggest if the item is in Fn signature arguments (#112590).
              return ident !== undefined && ident.name === item_ident.name && !Span.contains(sig.span, item_span);
            });
            if (item !== undefined) found = [sig, item];
          }
        }
      }
      let suggestion_: [Span, string, string] | undefined;
      if (found !== undefined) {
        const [sig, item] = found;
        const sp = Span.shrink_to_lo(item_span);

        // Account for `Foo { field }` when suggesting `self.field` so we result on
        // `Foo { field: self.field }`.
        const parent_kind = expr_parent_kind(source);
        const field = parent_kind !== undefined && parent_kind.$ === "Struct" ? parent_kind._0.fields.find((f) => f.ident.eq(item_ident)) : undefined;
        const pre = field !== undefined && field.is_shorthand ? `${display_Ident(item_ident)}: ` : "";
        // Ensure we provide a structured suggestion for an assoc fn only for
        // expressions that are actually a fn call.
        const is_call = field !== undefined ? field.expr.kind.$ === "Call" : parent_kind !== undefined && parent_kind.$ === "Call";

        const kind = item.kind;
        if (kind.$ === "Fn" && (!sig.decl.has_self() || !is_call) && kind._0.sig.decl.has_self()) {
          // Ensure that we only suggest `self.` if `self` is available,
          // you can't call `fn foo(&self)` from `fn bar()` (#115992).
          // We also want to mention that the method exists.
          span_label = [kind._0.ident.span, "a method by that name is available on `Self` here"];
          suggestion_ = undefined;
        } else if (kind.$ === "Fn" && !kind._0.sig.decl.has_self() && !is_call) {
          span_label = [kind._0.ident.span, "an associated function by that name is available on `Self` here"];
          suggestion_ = undefined;
        } else if (kind.$ === "Fn" && kind._0.sig.decl.has_self()) {
          suggestion_ = [sp, "consider using the method on `Self`", `${pre}self.`];
        } else if (kind.$ === "Fn") {
          suggestion_ = [sp, "consider using the associated function on `Self`", `${pre}Self::`];
        } else if (kind.$ === "Const") {
          suggestion_ = [sp, "consider using the associated constant on `Self`", `${pre}Self::`];
        } else {
          suggestion_ = undefined;
        }
      } else {
        suggestion_ = undefined;
      }
      [tick, mod_prefix, mod_str, module, suggestion] = ["", "", "this scope", undefined, suggestion_];
    } else if (path.length === 2 && path[0]!.ident.name === kw.PathRoot) {
      if (Edition_discriminant[this.r.tcx_.sess.edition()] > Edition_discriminant[Edition.Edition2015]) {
        // In edition 2018 onwards, the `::foo` syntax may only pull from the extern prelude
        // which overrides all other expectations of item type
        expected = "crate";
        [tick, mod_prefix, mod_str, module, suggestion] = ["", "", "the list of imported crates", undefined, undefined];
      } else {
        [tick, mod_prefix, mod_str, module, suggestion] = ["", "", "the crate root", LocalDefId.to_def_id(CRATE_DEF_ID), undefined];
      }
    } else if (path.length === 2 && path[0]!.ident.name === kw.Crate) {
      [tick, mod_prefix, mod_str, module, suggestion] = ["", "", "the crate root", LocalDefId.to_def_id(CRATE_DEF_ID), undefined];
    } else {
      const mod_path = path.slice(0, path.length - 1);
      const mod_res = this.resolve_path(mod_path, "TypeNS", undefined, source);
      const mod_prefix_ = mod_res.$ === "Module" && mod_res._0.$ === "Module" ? mod_res._0._0.res() : undefined;

      const module_did = mod_prefix_ === undefined ? undefined : def_Res.mod_def_id(mod_prefix_);

      const mod_prefix__ = mod_prefix_ === undefined ? "" : `${def_Res.descr(mod_prefix_)} `;
      [tick, mod_prefix, mod_str, module, suggestion] = ["`", mod_prefix__, Segment.names_to_string(mod_path), module_did, undefined];
    }

    const item_ident_str = display_Ident(item_ident);
    // PORT: `str::to_lowercase` -> `String.prototype.toLowerCase` (both full Unicode lowercase mappings).
    if (["true", "false"].includes(item_ident_str.toLowerCase())) {
      // check if we are in situation of typo like `True` instead of `true`.
      const item_typo = item_ident_str.toLowerCase();
      suggestion = [item_span, "you may want to use a bool value instead", item_typo];
      // FIXME(vincenzopalazzo): make the check smarter,
      // and maybe expand with levenshtein distance checks
    } else if (item_ident.as_str() === "printf") {
      suggestion = [item_span, "you may have meant to use the `print` macro", "print!"];
    }
    let msg = `cannot find ${expected} \`${item_ident_str}\` in ${mod_prefix}${tick}${mod_str}${tick}`;
    let fallback_label = path_str === "async" && expected.startsWith("struct") ? "`async` blocks are only allowed in Rust 2018 or later" : `not found in ${tick}${mod_str}${tick}`;
    const notes: string[] = [];
    const directive = module === undefined ? undefined : this.r.on_unknown_data(module);
    if (module !== undefined && directive !== undefined) {
      // PORT: `FormatArgs { unresolved, this, .. }` fills the other fields with their declared
      // defaults (`String::new()`, `""`, `Vec::new()`).
      const args: FormatArgs = {
        this: mod_str,
        this_resolved: "",
        this_path: "",
        found: "",
        expected: "",
        unresolved: item_ident_str,
        item_context: "",
        generic_args: [],
      };
      const { message, label, notes: custom_notes } = directive.eval(undefined, args);
      if (message !== undefined) {
        notes.push(msg);
        msg = message;
      }
      if (label !== undefined) {
        fallback_label = label;
        const taken = span_label;
        span_label = undefined;
        if (taken !== undefined) {
          notes.push(taken[1]);
        }
      }
      notes.push(...custom_notes);
    }

    return {
      msg,
      fallback_label,
      span: item_span,
      span_label,
      could_be_expr,
      suggestion,
      module,
      notes,
    };
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:596 could_be_expr
LateResolutionVisitor.prototype.could_be_expr = function (this: LateResolutionVisitor, res: Res, span: Span): boolean {
  if (res.$ === "Def" && res._0.$ === "Fn") {
    // Verify whether this is a fn call or an Fn used as a type.
    const snippet = this.r.tcx_.sess.source_map().span_to_snippet(span);
    return snippet.$ === "Ok" && snippet._0.toString().endsWith(")");
  } else if (
    (res.$ === "Def" && (res._0.$ === "Ctor" || res._0.$ === "AssocFn" || res._0.$ === "Const" || res._0.$ === "AssocConst")) ||
    res.$ === "SelfCtor" ||
    res.$ === "PrimTy" ||
    res.$ === "Local"
  ) {
    return true;
  } else {
    return false;
  }
};

/// Try to suggest for a module path that cannot be resolved.
/// Such as `fmt::Debug` where `fmt` is not resolved without importing,
/// here we search with `lookup_import_candidates` for a module named `fmt`
/// with `TypeNS` as namespace.
///
/// We need a separate function here because we won't suggest for a path with single segment
/// and we won't change `SourcePath` api `is_expected` to match `Type` with `DefKind::Mod`
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:624 smart_resolve_partial_mod_path_errors
LateResolutionVisitor.prototype.smart_resolve_partial_mod_path_errors = function (this: LateResolutionVisitor, prefix_path: readonly Segment[], following_seg: Segment | undefined): ImportSuggestion[] {
  const segment = prefix_path.at(-1);
  if (segment !== undefined && following_seg !== undefined) {
    const candidates = this.r.lookup_import_candidates(segment.ident, "TypeNS", this.parent_scope, (res: Res) => res.$ === "Def" && res._0.$ === "Mod");
    // double check next seg is valid
    return candidates.filter((candidate) => {
      const def_id = candidate.did;
      const module = def_id === undefined ? undefined : this.r.get_module(def_id);
      if (def_id !== undefined && module !== undefined) {
        const parent_def_id = this.parent_scope.module.opt_def_id();
        return (
          !(parent_def_id !== undefined && DefId_eq(def_id, parent_def_id)) &&
          [...this.r.resolutions(module)].some(([key, _r]) => key.ident.name === following_seg.ident.name)
        );
      } else {
        return false;
      }
    });
  } else {
    return [];
  }
};

/// Handles error reporting for `smart_resolve_path_fragment` function.
/// Creates base error and amends it with one short label and possibly some longer helps/notes.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:664 smart_resolve_report_errors
LateResolutionVisitor.prototype.smart_resolve_report_errors = function (
  this: LateResolutionVisitor,
  path: readonly Segment[],
  following_seg: Segment | undefined,
  span: Span,
  source: PathSource,
  res: Res | undefined,
  qself: ast.QSelf | undefined,
): [Diag, ImportSuggestion[]] {
  const cross_namespace_res = res !== undefined && !def_Res.matches_ns(res, PathSource.namespace(source)) ? res : undefined;
  const could_be_expr = res !== undefined && this.could_be_expr(res, span);
  const base_error = this.make_base_error(path, span, source, cross_namespace_res !== undefined ? undefined : res, could_be_expr);

  const code = PathSource.error_code(source, res !== undefined);
  const err = this.r.dcx().struct_span_err(base_error.span, base_error.msg);
  err.code(code);

  if (this.diag_metadata.currently_processing_generic_args && source.$ === "Type" && path.length === 1 && !path[0]!.has_generic_args) {
    source = PathSource.TypeParam;
  }

  if (cross_namespace_res !== undefined) {
    err.note(`${def_Res.article(cross_namespace_res)} ${def_Res.descr(cross_namespace_res)} named \`${Segment.names_to_string(path)}\` exists in another namespace`);
  }

  // Try to get the span of the identifier within the path's syntax context
  // (if that's different).
  const within_macro_span = Span.within_macro(base_error.span, span, this.r.tcx_.sess.source_map());
  if (within_macro_span !== undefined) {
    err.span_label(within_macro_span, "due to this macro variable");
  }

  this.detect_missing_binding_available_from_pattern(err, path, following_seg);
  this.suggest_at_operator_in_slice_pat_with_range(err, path);
  this.suggest_range_struct_destructuring(err, path, source);
  this.suggest_swapping_misplaced_self_ty_and_trait(err, source, res, base_error.span);
  this.detect_resolution_error_in_derive(err, base_error.span);

  if (base_error.span_label !== undefined) {
    const [span, label] = base_error.span_label;
    err.span_label(span, label);
  }
  for (const note of base_error.notes) {
    err.note(note);
  }

  if (base_error.suggestion !== undefined) {
    const [span, message, replacement] = base_error.suggestion;
    const ident = unwrap(path.at(-1)).ident;
    // An insertion adds a qualifier (`Self::CONST`), whereas a replacement
    // replaces the name itself (`True` -> `true`).
    const expression = Span.is_empty(span) ? `${replacement}${display_Ident(ident)}` : replacement;
    if (!this.suggest_named_format_argument(err, source, ident, expression, "MaybeIncorrect")) {
      err.span_suggestion_verbose(span, message, replacement, "MaybeIncorrect");
    }
  }

  this.suggest_changing_type_to_const_param(err, res, source, path, following_seg, span);
  this.explain_functions_in_pattern(err, res, source);

  if (this.suggest_pattern_match_with_let(err, source, span)) {
    // Fallback label.
    err.span_label(base_error.span, base_error.fallback_label);
    return [err, []];
  }

  this.suggest_self_or_self_ref(err, path, span);
  this.detect_assoc_type_constraint_meant_as_path(err, base_error);
  this.detect_rtn_with_fully_qualified_path(err, path, following_seg, span, source, res, qself);
  if (this.suggest_self_ty(err, source, path, span) || this.suggest_self_value(err, source, path, span)) {
    return [err, []];
  }

  const doc_alias = this.lookup_doc_alias_name(path, PathSource.namespace(source));
  if (doc_alias !== undefined) {
    const [did, item] = doc_alias;
    const item_name = item.name;
    const suggestion_name = this.r.tcx_.item_name(did);
    err.span_suggestion_verbose(
      item.span,
      `\`${Symbol.as_str(suggestion_name)}\` has a name defined in the doc alias attribute as \`${Symbol.as_str(item_name)}\``,
      Symbol.as_str(suggestion_name),
      "MaybeIncorrect",
    );

    return [err, []];
  }

  const [found, suggested_candidates, candidates_] = this.try_lookup_name_relaxed(err, source, path, following_seg, span, res, base_error);
  let candidates = candidates_;
  if (found) {
    return [err, candidates];
  }

  if (this.suggest_shadowed(err, source, path, following_seg, span)) {
    // if there is already a shadowed name, don'suggest candidates for importing
    candidates = [];
  }

  let fallback = this.suggest_trait_and_bounds(err, source, res, span, base_error);
  // PORT: `fallback |= ..` always evaluates the right-hand side.
  const typo_fallback = this.suggest_typo(err, source, path, following_seg, span, base_error, suggested_candidates);
  fallback = fallback || typo_fallback;

  if (fallback) {
    // Fallback label.
    err.span_label(base_error.span, base_error.fallback_label);
  }
  this.err_code_special_cases(err, source, path, span);

  const module = base_error.module ?? LocalDefId.to_def_id(CRATE_DEF_ID);
  this.r.find_cfg_stripped(err, unwrap(path.at(-1)).ident.name, module);

  return [err, candidates];
};

/// Captures only accept identifiers, so put the suggested expression in a named argument.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:831 suggest_named_format_argument
LateResolutionVisitor.prototype.suggest_named_format_argument = function (this: LateResolutionVisitor, err: Diag, source: PathSource, ident: Ident, expression: string, applicability: Applicability): boolean {
  if (!(source.$ === "Expr" && source._0 !== undefined && source._0.kind.$ === "FormatArgs")) {
    return false;
  }
  const args = source._0.kind._0;
  const format_span = source._0.span;
  const argument = `${display_Ident(ident)} = ${expression}`;
  const last_arg = args.arguments.explicit_args().at(-1);
  const insertion = Span.shrink_to_hi(last_arg === undefined ? args.span : last_arg.original_span);
  // A custom wrapper may not accept another named argument.
  const expn = Span.source_callee(format_span);
  const macro_def_id = expn === undefined ? undefined : expn.macro_def_id;
  // Local diagnostic items are not available before HIR lowering.
  const source_macro: Symbol | undefined =
    macro_def_id !== undefined && !macro_def_id.is_local()
      ? unported("rustc_middle::ty::TyCtxt::get_diagnostic_name (diagnostic items of extern crates, wave 11)")
      : undefined;
  if (
    source_macro !== undefined &&
    (source_macro === sym.format_macro ||
      source_macro === sym.format_args_macro ||
      source_macro === sym.print_macro ||
      source_macro === sym.println_macro ||
      source_macro === sym.eprint_macro ||
      source_macro === sym.eprintln_macro ||
      source_macro === sym.write_macro ||
      source_macro === sym.writeln_macro ||
      source_macro === sym.assert_macro ||
      source_macro === sym.assert_eq_macro ||
      source_macro === sym.assert_ne_macro ||
      source_macro === sym.debug_assert_macro ||
      source_macro === sym.debug_assert_eq_macro ||
      source_macro === sym.debug_assert_ne_macro ||
      source_macro === sym.core_panic_macro ||
      source_macro === sym.std_panic_macro ||
      source_macro === sym.unreachable_macro ||
      source_macro === sym.todo_macro ||
      source_macro === sym.unimplemented_macro) &&
    !Span.from_expansion(insertion) &&
    !Span.from_expansion(args.span)
  ) {
    err.span_suggestion_verbose(insertion, "you might have meant to add a named formatting argument", `, ${argument}`, applicability);
  } else {
    err.help(`you might have meant to add a named formatting argument: \`${argument}\``);
  }
  return true;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:901 detect_rtn_with_fully_qualified_path
LateResolutionVisitor.prototype.detect_rtn_with_fully_qualified_path = function (
  this: LateResolutionVisitor,
  err: Diag,
  path: readonly Segment[],
  following_seg: Segment | undefined,
  span: Span,
  source: PathSource,
  res: Res | undefined,
  qself: ast.QSelf | undefined,
): void {
  if (
    res !== undefined &&
    res.$ === "Def" &&
    res._0.$ === "AssocFn" &&
    source.$ === "TraitItem" &&
    source._0 === "TypeNS" &&
    following_seg === undefined &&
    qself !== undefined
  ) {
    const kind = qself.ty.kind;
    if (kind.$ === "Path" && kind._0 === undefined && kind._1.segments.length === 1 && this.diag_metadata.current_where_predicate !== undefined) {
      const ty_path = kind._1;
      err.span_suggestion_verbose(
        span,
        "you might have meant to use the return type notation syntax",
        `${display_Ident(ty_path.segments[0]!.ident)}::${display_Ident(path[path.length - 1]!.ident)}(..)`,
        "MaybeIncorrect",
      );
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:928 detect_assoc_type_constraint_meant_as_path
LateResolutionVisitor.prototype.detect_assoc_type_constraint_meant_as_path = function (this: LateResolutionVisitor, err: Diag, base_error: BaseError): void {
  const ty = this.diag_metadata.current_type_path;
  if (ty === undefined) {
    return;
  }
  if (ty.kind.$ !== "Path") {
    return;
  }
  const path = ty.kind._1;
  for (const segment of path.segments) {
    const params_ = segment.args;
    if (params_ === undefined) {
      continue;
    }
    if (params_.$ !== "AngleBracketed") {
      continue;
    }
    const params = params_._0;
    for (const param of params.args) {
      if (param.$ !== "Constraint") {
        continue;
      }
      const constraint = param._0;
      if (constraint.kind.$ !== "Bound") {
        continue;
      }
      const bounds = constraint.kind.bounds;
      for (const bound of bounds) {
        if (bound.$ !== "Trait") {
          continue;
        }
        const trait_ref = bound._0;
        if (TraitBoundModifiers_eq(trait_ref.modifiers, ast.TraitBoundModifiers.NONE) && base_error.span === trait_ref.span) {
          err.span_suggestion_verbose(
            Span.between(constraint.ident.span, trait_ref.span),
            "you might have meant to write a path instead of an associated type bound",
            "::",
            "MachineApplicable",
          );
        }
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:972 suggest_self_or_self_ref
LateResolutionVisitor.prototype.suggest_self_or_self_ref = function (this: LateResolutionVisitor, err: Diag, path: readonly Segment[], span: Span): void {
  if (!this.self_type_is_available()) {
    return;
  }
  const path_last_segment = path.at(-1);
  if (path_last_segment === undefined) return;
  const item_str = path_last_segment.ident;
  // Emit help message for fake-self from other languages (e.g., `this` in JavaScript).
  if (["this", "my"].includes(item_str.as_str())) {
    err.span_suggestion_short(span, "you might have meant to use `self` here instead", "self", "MaybeIncorrect");
    if (!this.self_value_is_available(path[0]!.ident.span)) {
      const current_function = this.diag_metadata.current_function;
      if (current_function !== undefined && current_function[0].$ === "Fn") {
        const sig = current_function[0]._2.sig;
        const fn_span = current_function[1];
        const param = sig.decl.inputs[0];
        const [span, sugg] =
          param !== undefined
            ? [Span.shrink_to_lo(param.span), "&self, "]
            : [Span.shrink_to_hi(this.r.tcx_.sess.source_map().span_through_char(fn_span, ch("("))), "&self"];
        err.span_suggestion_verbose(span, "if you meant to use `self`, you are also missing a `self` receiver argument", sugg, "MaybeIncorrect");
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1015 try_lookup_name_relaxed
LateResolutionVisitor.prototype.try_lookup_name_relaxed = function (
  this: LateResolutionVisitor,
  err: Diag,
  source: PathSource,
  path: readonly Segment[],
  following_seg: Segment | undefined,
  span_: Span,
  res: Res | undefined,
  base_error: BaseError,
): [boolean, Set<string>, ImportSuggestion[]] {
  const span =
    following_seg !== undefined && Span.eq_ctxt(path[0]!.ident.span, path[path.length - 1]!.ident.span)
      ? // The path `span` that comes in includes any following segments, which we don't
        // want to replace in the suggestions.
        Span.to(path[0]!.ident.span, path[path.length - 1]!.ident.span)
      : span_;
  const suggested_candidates: Set<string> = new Set();
  // Try to lookup name in more relaxed fashion for better error reporting.
  const ident = unwrap(path.at(-1)).ident;
  const is_expected = (res: Res): boolean => PathSource.is_expected(source, res);
  const ns = PathSource.namespace(source);
  const is_enum_variant = (res: Res): boolean => res.$ === "Def" && res._0.$ === "Variant";
  const path_str = Segment.names_to_string(path);
  const last_segment = path.at(-1);
  const ident_span = last_segment === undefined ? span : last_segment.ident.span;
  let candidates = this.r.lookup_import_candidates(ident, ns, this.parent_scope, is_expected).filter(({ did }) => {
    const actual_did = res === undefined ? undefined : def_Res.opt_def_id(res);
    if (did !== undefined && actual_did !== undefined) {
      return !DefId_eq(did, actual_did);
    }
    return true;
  });
  // Try to filter out intrinsics candidates, as long as we have
  // some other candidates to suggest.
  // PORT: `extract_if(.., ..)` -> an order-preserving partition.
  const intrinsic_candidates: ImportSuggestion[] = [];
  candidates = candidates.filter((sugg) => {
    const path = path_names_to_string(sugg.path);
    if (path.startsWith("core::intrinsics::") || path.startsWith("std::intrinsics::")) {
      intrinsic_candidates.push(sugg);
      return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    // Put them back if we have no more candidates to suggest...
    candidates = intrinsic_candidates;
  }
  const crate_def_id = LocalDefId.to_def_id(CRATE_DEF_ID);
  if (candidates.length === 0 && is_expected({ $: "Def", _0: { $: "Enum" }, _1: crate_def_id })) {
    const enum_candidates: [string, string][] = this.r
      .lookup_import_candidates(ident, ns, this.parent_scope, is_enum_variant)
      .map((suggestion) => import_candidate_to_enum_paths(suggestion))
      .filter(([_, enum_ty_path]) => !enum_ty_path.startsWith("std::prelude::"));
    if (enum_candidates.length !== 0) {
      enum_candidates.sort((a, b) => str_cmp(a[0], b[0]) || str_cmp(a[1], b[1]));

      // Contextualize for E0425 "cannot find type", but don't belabor the point
      // (that it's a variant) for E0573 "expected type, found variant".
      let preamble: string;
      if (res === undefined) {
        const n = enum_candidates.length;
        const others = n === 1 ? "" : n === 2 ? " and 1 other" : ` and ${n} others`;
        preamble = `there is an enum variant \`${enum_candidates[0]![0]}\`${others}; `;
      } else {
        preamble = "";
      }
      const msg = `${preamble}try using the variant's enum`;

      for (const [_variant_path, enum_ty_path] of enum_candidates) {
        suggested_candidates.add(enum_ty_path);
      }
      err.span_suggestions(
        span,
        msg,
        enum_candidates.map(([_variant_path, enum_ty_path]) => enum_ty_path),
        "MachineApplicable",
      );
    }
  }

  // Try finding a suitable replacement.
  const typo_sugg_ = TypoCandidate.to_opt_suggestion(this.lookup_typo_candidate(path, following_seg, PathSource.namespace(source), is_expected));
  const typo_sugg = typo_sugg_ !== undefined && !suggested_candidates.has(Symbol.as_str(typo_sugg_.candidate)) ? typo_sugg_ : undefined;
  if (path.length === 1 && source.$ !== "Delegation" && this.self_type_is_available()) {
    const segment = path[0]!;
    const assoc = this.lookup_assoc_candidate(ident, ns, is_expected, PathSource.is_call(source));
    if (assoc !== undefined) {
      const [candidate, def_span] = assoc;
      const self_is_available = this.self_value_is_available(segment.ident.span);
      // Account for `Foo { field }` when suggesting `self.field` so we result on
      // `Foo { field: self.field }`.
      const parent_kind = expr_parent_kind(source);
      const pre =
        parent_kind !== undefined && parent_kind.$ === "Struct" && parent_kind._0.fields.some((f) => f.ident.eq(segment.ident) && f.is_shorthand)
          ? `${path_str}: `
          : "";
      if (candidate.$ === "Field") {
        if (self_is_available) {
          if (!this.suggest_named_format_argument(err, source, segment.ident, `self.${display_Ident(segment.ident)}`, "MaybeIncorrect")) {
            err.span_suggestion_verbose(Span.shrink_to_lo(span), "you might have meant to use the available field", `${pre}self.`, "MaybeIncorrect");
          }
        } else {
          err.span_label(def_span, "a field by that name exists in `Self`");
        }
      } else if (
        (candidate.$ === "MethodWithSelf" || candidate.$ === "AssocFn" || candidate.$ === "AssocType") &&
        parent_kind !== undefined &&
        parent_kind.$ === "FormatArgs"
      ) {
        let kind: string;
        switch (candidate.$) {
          case "MethodWithSelf":
            kind = "a method";
            break;
          case "AssocFn":
            kind = "an associated function";
            break;
          case "AssocType":
            kind = "an associated type";
            break;
          default:
            kind = unreachable();
        }
        err.span_label(def_span, `${kind} by that name is available on \`Self\` here`);
      } else if (candidate.$ === "MethodWithSelf" && self_is_available) {
        const msg = candidate.called ? "you might have meant to call the method" : "you might have meant to refer to the method";
        err.span_suggestion_verbose(Span.shrink_to_lo(span), msg, "self.", "MachineApplicable");
      } else {
        // AssocSuggestion::MethodWithSelf { .. } | AssocFn { .. } | AssocConst | AssocType
        if (
          candidate.$ !== "AssocConst" ||
          !this.suggest_named_format_argument(err, source, segment.ident, `Self::${display_Ident(segment.ident)}`, "MaybeIncorrect")
        ) {
          err.span_suggestion_verbose(Span.shrink_to_lo(span), `you might have meant to ${AssocSuggestion.action(candidate)}`, "Self::", "MachineApplicable");
        }
      }
      this.r.add_typo_suggestion(err, typo_sugg, ident_span, undefined);
      return [true, suggested_candidates, candidates];
    }

    // If the first argument in call is `self` suggest calling a method.
    const self_arg = this.call_has_self_arg(source);
    if (self_arg !== undefined) {
      const [call_span, args_span] = self_arg;
      let args_snippet = "";
      if (args_span !== undefined) {
        const snippet = this.r.tcx_.sess.source_map().span_to_snippet(args_span);
        if (snippet.$ === "Ok") {
          args_snippet = snippet._0.toString();
        }
      }

      if (res !== undefined && res.$ === "Def" && res._0.$ === "Struct") {
        const def_id = res._1;
        const ctor = this.r.struct_ctor(def_id);
        if (ctor !== undefined && ctor.has_private_fields(this.parent_scope.module, this.r)) {
          if (ctor.res.$ === "Def" && ctor.res._0.$ === "Ctor" && ctor.res._0._0 === "Struct" && ctor.res._0._1 === "Fn") {
            this.update_err_for_private_tuple_struct_fields(err, source, def_id);
          }
          err.note("constructor is not visible here due to private fields");
        }
      } else {
        err.span_suggestion_verbose(call_span, `try calling \`${display_Ident(ident)}\` as a method`, `self.${path_str}(${args_snippet})`, "MachineApplicable");
      }

      return [true, suggested_candidates, candidates];
    }
  }

  // Try context-dependent help if relaxed lookup didn't work.
  if (res !== undefined) {
    if (this.smart_resolve_context_dependent_help(err, span, source, path, res, path_str, base_error.fallback_label)) {
      // We do this to avoid losing a secondary span when we override the main error span.
      this.r.add_typo_suggestion(err, typo_sugg, ident_span, undefined);
      return [true, suggested_candidates, candidates];
    }
  }

  // Try to find in last block rib
  const rib = this.last_block_rib;
  if (rib !== undefined) {
    // PORT: `rib.bindings` is an `FxHashMap`; JS insertion order instead of hashbrown order. At most
    // one key can match (same name and same syntax context), so the order is not observable.
    for (const [ident, res] of rib.bindings) {
      if (res.$ === "Local" && path.length === 1 && Span.eq_ctxt(ident.span, path[0]!.ident.span) && ident.name === path[0]!.ident.name) {
        err.span_help(ident.span, `the binding \`${path_str}\` is available in a different scope in the same function`);
        return [true, suggested_candidates, candidates];
      }
    }
  }

  if (candidates.length === 0) {
    candidates = this.smart_resolve_partial_mod_path_errors(path, following_seg);
  }

  return [false, suggested_candidates, candidates];
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1284 lookup_doc_alias_name
LateResolutionVisitor.prototype.lookup_doc_alias_name = function (this: LateResolutionVisitor, path: readonly Segment[], ns: Namespace): [DefId, Ident] | undefined {
  const find_doc_alias_name = (r: Resolver, m: Module, item_name: Symbol): DefId | undefined => {
    for (const resolution of r.resolutions(m).values()) {
      const binding = resolution.borrow(r).best_decl();
      const did = binding === undefined ? undefined : def_Res.opt_def_id(binding.res());
      if (did === undefined) {
        continue;
      }
      if (did.is_local()) {
        // We don't record the doc alias name in the local crate
        // because the people who write doc alias are usually not
        // confused by them.
        continue;
      }
      // PORT: `find_attr!(r.tcx, did, Doc(d) => d)`; `did` is not local here, so `impl HasAttrs for
      // DefId` reads `tcx.attrs_for_def(did)`.
      const d = find_attr(r.tcx_.attrs_for_def(did), (k: AttributeKind) => (k.$ === "Doc" ? k._0 : undefined));
      if (d !== undefined && d.aliases.has(item_name)) {
        return did;
      }
    }
    return undefined;
  };

  if (path.length === 1) {
    const ribs = this.ribs.index(ns);
    for (let i = ribs.length - 1; i >= 0; i--) {
      const rib = ribs[i]!;
      const item = path[0]!.ident;
      const module = rib.kind.$ === "Module" ? rib.kind._0 : rib.kind.$ === "Block" ? rib.kind._0 : undefined;
      if (module !== undefined) {
        const did = find_doc_alias_name(this.r, module.to_module(), item.name);
        if (did !== undefined) {
          return [did, item];
        }
      }
    }
  } else {
    // Finds to the last resolved module item in the path
    // and searches doc aliases within that module.
    //
    // Example: For the path `a::b::last_resolved::not_exist::c::d`,
    // we will try to find any item has doc aliases named `not_exist`
    // in `last_resolved` module.
    //
    // - Use `skip(1)` because the final segment must remain unresolved.
    for (let idx = path.length - 2; idx >= 0; idx--) {
      const seg = path[idx]!;
      const id = seg.id;
      if (id === undefined) {
        continue;
      }
      const res = this.r.partial_res_map.get(id);
      if (res === undefined) {
        continue;
      }
      const full_res = res.expect_full_res();
      if (full_res.$ === "Def" && full_res._0.$ === "Mod") {
        const module = this.r.expect_module(full_res._1);
        const item = path[idx + 1]!.ident;
        const did = find_doc_alias_name(this.r, module, item.name);
        if (did !== undefined) {
          return [did, item];
        }
      }
      break;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1345 suggest_trait_and_bounds
LateResolutionVisitor.prototype.suggest_trait_and_bounds = function (this: LateResolutionVisitor, err: Diag, source: PathSource, res: Res | undefined, span: Span, base_error: BaseError): boolean {
  const is_macro = Span.from_expansion(base_error.span) && Span.desugaring_kind(base_error.span) === undefined;
  let fallback = false;

  const bounds = this.diag_metadata.current_trait_object;
  if (
    source.$ === "Trait" &&
    source._0 === "Maybe" &&
    res !== undefined &&
    res.$ === "Def" &&
    (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union") &&
    !is_macro &&
    bounds !== undefined &&
    bounds.length >= 2
  ) {
    const first_bound = bounds[0]!;
    const last_bound = bounds[bounds.length - 1]!;
    fallback = true;
    const spans: Span[] = bounds.map((bound) => ast.GenericBound.span(bound)).filter((sp) => sp !== base_error.span);

    const start_span = ast.GenericBound.span(first_bound);
    // `end_span` is the end of the poly trait ref (Foo + 'baz + Bar><)
    const end_span = ast.GenericBound.span(last_bound);
    // `last_bound_span` is the last bound of the poly trait ref (Foo + >'baz< + Bar)
    const last_bound_span = unwrap(spans.at(-1));
    const multi_span = into_MultiSpan([...spans]);
    for (const sp of spans) {
      const msg = sp === last_bound_span ? `...because of ${pluralize("this", bounds.length - 1)} bound${pluralize(bounds.length - 1)}` : "";
      multi_span.push_span_label(sp, msg);
    }
    multi_span.push_span_label(base_error.span, "expected this type to be a trait...");
    err.span_help(
      multi_span,
      '`+` is used to constrain a "trait object" type with lifetimes or auto-traits; structs and enums can\'t be bound in that way',
    );
    if (
      bounds.every((bound) => {
        switch (bound.$) {
          case "Outlives":
          case "Use":
            return true;
          case "Trait":
            return bound._0.span === base_error.span;
        }
      })
    ) {
      const sugg: [Span, string][] = [];
      if (base_error.span !== start_span) {
        sugg.push([Span.until(start_span, base_error.span), ""]);
      }
      if (base_error.span !== end_span) {
        sugg.push([Span.to(Span.shrink_to_hi(base_error.span), end_span), ""]);
      }

      err.multipart_suggestion("if you meant to use a type and not a trait here, remove the bounds", sugg, "MaybeIncorrect");
    }
  }

  // PORT: `fallback |= ..` always evaluates the right-hand side.
  const restricted = this.restrict_assoc_type_in_where_clause(span, err);
  fallback = fallback || restricted;
  return fallback;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1420 suggest_typo
LateResolutionVisitor.prototype.suggest_typo = function (
  this: LateResolutionVisitor,
  err: Diag,
  source: PathSource,
  path: readonly Segment[],
  following_seg: Segment | undefined,
  span: Span,
  base_error: BaseError,
  suggested_candidates: Set<string>,
): boolean {
  const is_expected = (res: Res): boolean => PathSource.is_expected(source, res);
  const last_segment = path.at(-1);
  const ident_span = last_segment === undefined ? span : last_segment.ident.span;

  // Prefer suggestions based on associated types from in-scope bounds (e.g. `T::Item`)
  // over purely edit-distance-based identifier suggestions.
  // Otherwise suggestions could be verbose.
  if (this.suggest_assoc_type_from_bounds(err, source, path, ident_span)) {
    return false;
  }

  // Preserve the field name for struct field shorthands to avoid suggesting invalid shorthands.
  let prefix: Ident | undefined = undefined;
  const parent_kind = expr_parent_kind(source);
  if (parent_kind !== undefined && parent_kind.$ === "Struct") {
    const ident = path.at(-1)?.ident;
    if (ident !== undefined && parent_kind._0.fields.some((f) => f.ident.eq(ident) && f.is_shorthand)) {
      prefix = ident;
    }
  }

  const typo_sugg_ = this.lookup_typo_candidate(path, following_seg, PathSource.namespace(source), is_expected);
  let fallback = true;
  const typo_sugg_opt = TypoCandidate.to_opt_suggestion(typo_sugg_);
  const typo_sugg = typo_sugg_opt !== undefined && !suggested_candidates.has(Symbol.as_str(typo_sugg_opt.candidate)) ? typo_sugg_opt : undefined;
  this.r.add_typo_suggestion(err, typo_sugg, ident_span, prefix);

  const let_binding = this.diag_metadata.current_let_binding;
  if (let_binding !== undefined) {
    const [pat_sp, ty_sp, init_sp] = let_binding;
    if (ty_sp !== undefined && init_sp === undefined && Span.contains(ty_sp, base_error.span) && base_error.could_be_expr) {
      err.span_suggestion_verbose(Span.between(pat_sp, ty_sp), "use `=` if you meant to assign", " = ", "MaybeIncorrect");
    }
  }

  // If the trait has a single item (which wasn't matched by the algorithm), suggest it
  const suggestion = this.get_single_associated_item(path, source, is_expected);
  this.r.add_typo_suggestion(err, suggestion, ident_span, prefix);

  if (this.let_binding_suggestion(err, ident_span)) {
    fallback = false;
  }

  return fallback;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1482 suggest_shadowed
LateResolutionVisitor.prototype.suggest_shadowed = function (this: LateResolutionVisitor, err: Diag, source: PathSource, path: readonly Segment[], following_seg: Segment | undefined, span: Span): boolean {
  const is_expected = (res: Res): boolean => PathSource.is_expected(source, res);
  const typo_sugg = this.lookup_typo_candidate(path, following_seg, PathSource.namespace(source), is_expected);
  const is_in_same_file = (sp1: Span, sp2: Span): boolean => {
    const source_map = this.r.tcx_.sess.source_map();
    const file1 = source_map.span_to_filename(sp1);
    const file2 = source_map.span_to_filename(sp2);
    return FileName_eq(file1, file2);
  };
  // print 'you might have meant' if the candidate is (1) is a shadowed name with
  // accessible definition and (2) either defined in the same crate as the typo
  // (could be in a different file) or introduced in the same file as the typo
  // (could belong to a different crate)
  if (typo_sugg.$ === "Shadowed" && typo_sugg._1 !== undefined) {
    const res = typo_sugg._0;
    const sugg_span = typo_sugg._1;
    const id = def_Res.opt_def_id(res);
    if (id !== undefined && (id.is_local() || is_in_same_file(span, sugg_span))) {
      err.span_label(sugg_span, `you might have meant to refer to this ${def_Res.descr(res)}`);
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1515 err_code_special_cases
LateResolutionVisitor.prototype.err_code_special_cases = function (this: LateResolutionVisitor, err: Diag, source: PathSource, path: readonly Segment[], span: Span): void {
  const err_code = err.deref().code;
  if (err_code !== undefined) {
    if (err_code === E0425) {
      for (const label_rib of this.label_ribs) {
        // PORT: `label_rib.bindings` is an `FxHashMap`; JS insertion order instead of hashbrown
        // order. Only the order of the added labels/suggestions could differ.
        for (const [label_ident, node_id] of label_rib.bindings) {
          const ident = unwrap(path.at(-1)).ident;
          if (`'${display_Ident(ident)}` === display_Ident(label_ident)) {
            err.span_label(label_ident.span, "a label with a similar name exists");
            const parent_kind = expr_parent_kind(source);
            if (parent_kind !== undefined && parent_kind.$ === "Break" && parent_kind._0 === undefined && parent_kind._1 !== undefined) {
              err.span_suggestion_verbose(span, "use the similarly named label", Symbol.as_str(label_ident.name), "MaybeIncorrect");
              // Do not lint against unused label when we suggest them.
              index_map_swap_remove(this.diag_metadata.unused_labels, node_id);
            }
          }
        }
      }

      this.suggest_ident_hidden_by_hygiene(err, path, span);
      // cannot find type in this scope
      // PORT(decls): `Self::likely_rust_type` is an associated fn (late/diagnostics.rs:3174, lane
      // res-late-diag-b) that decls.ts does not declare as a static yet; pending root.
      const correct = (LateResolutionVisitor as unknown as { likely_rust_type(path: readonly Segment[]): Symbol | undefined }).likely_rust_type(path);
      if (correct !== undefined) {
        err.span_suggestion_verbose(span, `you might have intended to use the \`${Symbol.as_str(correct)}\` primitive type`, Symbol.as_str(correct), "MaybeIncorrect");
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1561 suggest_ident_hidden_by_hygiene
LateResolutionVisitor.prototype.suggest_ident_hidden_by_hygiene = function (this: LateResolutionVisitor, err: Diag, path: readonly Segment[], span: Span): void {
  if (path.length !== 1) return;
  const segment = path[0]!;

  const ident = segment.ident;
  const callsite_span = Span.source_callsite(span);
  const ribs = this.ribs.index("ValueNS");
  for (let i = ribs.length - 1; i >= 0; i--) {
    const rib = ribs[i]!;
    // PORT: `rib.bindings` is an `FxHashMap`; JS insertion order instead of hashbrown order.
    for (const [binding_ident, _] of rib.bindings) {
      // Case 1: the identifier is defined in the same scope as the macro is called
      if (
        binding_ident.name === ident.name &&
        !Span.eq_ctxt(binding_ident.span, span) &&
        !Span.from_expansion(binding_ident.span) &&
        Span.lo(binding_ident.span) < Span.lo(callsite_span)
      ) {
        err.span_help(binding_ident.span, "an identifier with the same name exists, but is not accessible due to macro hygiene");
        return;
      }

      // Case 2: the identifier is defined in a macro call in the same scope
      if (
        binding_ident.name === ident.name &&
        Span.from_expansion(binding_ident.span) &&
        Span.eq_ctxt(Span.source_callsite(binding_ident.span), callsite_span) &&
        Span.lo(Span.source_callsite(binding_ident.span)) < Span.lo(callsite_span)
      ) {
        err.span_help(binding_ident.span, "an identifier with the same name is defined here, but is not accessible due to macro hygiene");
        return;
      }
    }
  }
};

/// Emit special messages for unresolved `Self` and `self`.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1598 suggest_self_ty
LateResolutionVisitor.prototype.suggest_self_ty = function (this: LateResolutionVisitor, err: Diag, source: PathSource, path: readonly Segment[], span: Span): boolean {
  if (!is_self_type(path, PathSource.namespace(source))) {
    return false;
  }
  err.code(E0411);
  err.span_label(span, "`Self` is only available in impls, traits, and type definitions");
  const item = this.diag_metadata.current_item;
  if (item !== undefined) {
    const ident = ast.ItemKind.ident(item.kind);
    if (ident !== undefined) {
      err.span_label(ident.span, `\`Self\` not allowed in ${ast.ItemKind.article(item.kind)} ${ast.ItemKind.descr(item.kind)}`);
    }
  }
  return true;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1621 suggest_self_value
LateResolutionVisitor.prototype.suggest_self_value = function (this: LateResolutionVisitor, err: Diag, source: PathSource, path: readonly Segment[], span: Span): boolean {
  if (!is_self_value(path, PathSource.namespace(source))) {
    return false;
  }

  // debug!("smart_resolve_path_fragment: E0424, source={:?}", source);
  err.code(E0424);
  err.span_label(
    span,
    source.$ === "Pat"
      ? "`self` value is a keyword and may not be bound to variables or shadowed"
      : "`self` value is a keyword only available in methods with a `self` parameter",
  );

  // using `let self` is wrong even if we're not in an associated method or if we're in a macro expansion.
  // So, we should return early if we're in a pattern, see issue #143134.
  if (source.$ === "Pat") {
    return true;
  }

  const is_assoc_fn = this.self_type_is_available();
  const self_from_macro = "a `self` parameter, but a macro invocation can only access identifiers it receives from parameters";
  const current_function = this.diag_metadata.current_function;
  if (current_function !== undefined) {
    const [fn_kind, fn_span] = current_function;
    // The current function has a `self` parameter, but we were unable to resolve
    // a reference to `self`. This can only happen if the `self` identifier we
    // are resolving came from a different hygiene context or a variable binding.
    // But variable binding error is returned early above.
    const first_input = visit.FnKind.decl(fn_kind).inputs[0];
    if (first_input !== undefined && first_input.is_self()) {
      err.span_label(fn_span, `this function has ${self_from_macro}`);
    } else {
      let doesnt: string;
      if (is_assoc_fn) {
        const p = visit.FnKind.decl(fn_kind).inputs[0];
        let span: Span;
        let sugg: string;
        if (p !== undefined) {
          [span, sugg] = [Span.shrink_to_lo(p.span), "&self, "];
        } else {
          // Try to look for the "(" after the function name, if possible.
          // This avoids placing the suggestion into the visibility specifier.
          const fn_ident = visit.FnKind.ident(fn_kind);
          const span_ = fn_ident === undefined ? fn_span : Span.with_lo(fn_span, Span.hi(fn_ident.span));
          [span, sugg] = [Span.shrink_to_hi(this.r.tcx_.sess.source_map().span_through_char(span_, ch("("))), "&self"];
        }
        err.span_suggestion_verbose(span, "add a `self` receiver parameter to make the associated `fn` a method", sugg, "MaybeIncorrect");
        doesnt = "doesn't";
      } else {
        doesnt = "can't";
      }
      const ident = visit.FnKind.ident(fn_kind);
      if (ident !== undefined) {
        err.span_label(ident.span, `this function ${doesnt} have a \`self\` parameter`);
      }
    }
  } else {
    const item = this.diag_metadata.current_item;
    if (item !== undefined) {
      if (item.kind.$ === "Delegation") {
        err.span_label(item.span, `delegation supports ${self_from_macro}`);
      } else {
        const ident = ast.ItemKind.ident(item.kind);
        const span = ident !== undefined ? ident.span : item.span;
        err.span_label(span, `\`self\` not allowed in ${ast.ItemKind.article(item.kind)} ${ast.ItemKind.descr(item.kind)}`);
      }
    }
  }
  return true;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1714 detect_missing_binding_available_from_pattern
LateResolutionVisitor.prototype.detect_missing_binding_available_from_pattern = function (this: LateResolutionVisitor, err: Diag, path: readonly Segment[], following_seg: Segment | undefined): void {
  if (path.length !== 1) return;
  const segment = path[0]!;
  if (following_seg !== undefined) return;
  const ribs = this.ribs.index("ValueNS");
  for (let i = ribs.length - 1; i >= 0; i--) {
    const rib = ribs[i]!;
    // PORT: `UnordMap::to_sorted(hcx, true)`: sorted by the keys' stable hash key, which for a
    // `DefId` is its `DefPathHash` (a `Fingerprint`, compared as one u128).
    const patterns_with_skipped_bindings = this.r.tcx_.with_stable_hashing_context((_hcx) => {
      const keyed = [...rib.patterns_with_skipped_bindings].map(([def_id, spans]) => [this.r.tcx_.def_path_hash(def_id), def_id, spans] as const);
      keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return keyed.map(([, def_id, spans]) => [def_id, spans] as const);
    });
    for (const [def_id, spans] of patterns_with_skipped_bindings) {
      const def_kind = this.r.tcx_.def_kind(def_id);
      const fields = def_kind.$ === "Struct" || def_kind.$ === "Variant" ? this.r.field_idents(def_id) : undefined;
      if ((def_kind.$ === "Struct" || def_kind.$ === "Variant") && fields !== undefined) {
        for (const field of fields) {
          if (field.name === segment.ident.name) {
            if (spans.every(([, , had_error]) => had_error.$ === "Err")) {
              // This resolution error will likely be fixed by fixing a
              // syntax error in a pattern, so it is irrelevant to the user.
              const multispan = into_MultiSpan(spans.map(([s]) => s));
              err.span_note(multispan, "this pattern had a recovered parse error which likely lost the expected fields");
              err.downgrade_to_delayed_bug();
            }
            const ty = this.r.tcx_.item_name(def_id);
            for (const [span, rest_span, _] of spans) {
              err.span_label(span, `this pattern doesn't include \`${display_Ident(field)}\`, which is available in \`${Symbol.as_str(ty)}\``);
              if (rest_span !== undefined) {
                err.span_suggestion_verbose(rest_span, `include \`${display_Ident(field)}\` in the pattern`, `${display_Ident(field)}, ..`, "MaybeIncorrect");
              }
            }
          }
        }
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1770 suggest_at_operator_in_slice_pat_with_range
LateResolutionVisitor.prototype.suggest_at_operator_in_slice_pat_with_range = function (this: LateResolutionVisitor, err: Diag, path: readonly Segment[]): void {
  // PORT: the fn-local `enum Side { Start, End }` is a string union.
  type Side = "Start" | "End";
  const pat = this.diag_metadata.current_pat;
  if (pat === undefined) return;
  let bound: Expr;
  let side: Side;
  let range: Spanned<ast.RangeEnd>;
  if (pat.kind.$ === "Range" && pat.kind._0 !== undefined && pat.kind._1 === undefined) {
    [bound, side, range] = [pat.kind._0, "Start", pat.kind._2];
  } else if (pat.kind.$ === "Range" && pat.kind._0 === undefined && pat.kind._1 !== undefined) {
    [bound, side, range] = [pat.kind._1, "End", pat.kind._2];
  } else {
    return;
  }
  if (bound.kind.$ === "Path" && bound.kind._0 === undefined && bound.kind._1.segments.length === 1 && path.length === 1) {
    const segment = bound.kind._1.segments[0]!;
    const s = path[0]!;
    if (segment.ident.eq(s.ident) && Span.eq_ctxt(segment.ident.span, range.span)) {
      // We've encountered `[first, rest..]` (#88404) or `[first, ..rest]` (#120591)
      // where the user might have meant `[first, rest @ ..]`.
      const [span, snippet] =
        side === "Start"
          ? [Span.between(segment.ident.span, range.span), " @ "]
          : [Span.to(range.span, segment.ident.span), `${display_Ident(segment.ident)} @ ..`];
      err.subdiagnostic(diagnostics.UnexpectedResUseAtOpInSlicePatWithRangeSugg_subdiagnostic({ span, ident: segment.ident, snippet }));
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1802 suggest_range_struct_destructuring
LateResolutionVisitor.prototype.suggest_range_struct_destructuring = function (this: LateResolutionVisitor, err: Diag, path: readonly Segment[], source: PathSource): void {
  if (!(source.$ === "Pat" || source.$ === "TupleStruct" || source.$ === "Expr")) {
    return;
  }

  const pat = this.diag_metadata.current_pat;
  if (pat === undefined) return;
  if (pat.kind.$ !== "Range") return;
  const start = pat.kind._0;
  const end = pat.kind._1;
  const end_kind = pat.kind._2;

  if (path.length !== 1) return;
  const segment = path[0]!;
  const failing_span = segment.ident.span;

  const in_start = start !== undefined && Span.contains(start.span, failing_span);
  const in_end = end !== undefined && Span.contains(end.span, failing_span);

  if (!in_start && !in_end) {
    return;
  }

  const snippet_of = (e: Expr): string | undefined => {
    const r = this.r.tcx_.sess.source_map().span_to_snippet(e.span);
    return r.$ === "Ok" ? r._0.toString() : undefined;
  };
  const start_snippet = start === undefined ? undefined : snippet_of(start);
  const end_snippet = end === undefined ? undefined : snippet_of(end);

  const field = (name: string, val: string): string => (val === name ? val : `${name}: ${val}`);

  const resolve_short_name = (short: Symbol, full: string): string => {
    const ident = Ident.with_dummy_span(short);
    const path = Segment.from_path(ast.Path.from_ident(ident));

    const r = this.resolve_path(path, "TypeNS", undefined, PathSource.Type);
    return r.$ === "NonModule" ? Symbol.as_str(short) : full;
  };
  // FIXME(new_range): Also account for new range types
  let struct_path: string;
  let fields: string[];
  const end_node = end_kind.node;
  if (start_snippet !== undefined && end_snippet !== undefined && end_node.$ === "Excluded") {
    [struct_path, fields] = [resolve_short_name(sym.Range, "std::ops::Range"), [field("start", start_snippet), field("end", end_snippet)]];
  } else if (start_snippet !== undefined && end_snippet !== undefined && end_node.$ === "Included") {
    [struct_path, fields] = [resolve_short_name(sym.RangeInclusive, "std::ops::RangeInclusive"), [field("start", start_snippet), field("end", end_snippet)]];
  } else if (start_snippet !== undefined && end_snippet === undefined) {
    [struct_path, fields] = [resolve_short_name(sym.RangeFrom, "std::ops::RangeFrom"), [field("start", start_snippet)]];
  } else if (start_snippet === undefined && end_snippet !== undefined && end_node.$ === "Excluded") {
    [struct_path, fields] = [resolve_short_name(sym.RangeTo, "std::ops::RangeTo"), [field("end", end_snippet)]];
  } else if (start_snippet === undefined && end_snippet !== undefined && end_node.$ === "Included") {
    [struct_path, fields] = [resolve_short_name(sym.RangeToInclusive, "std::ops::RangeToInclusive"), [field("end", end_snippet)]];
  } else {
    return;
  }

  err.span_suggestion_verbose(pat.span, "if you meant to destructure a range use a struct pattern", `${struct_path} { ${fields.join(", ")} }`, "MaybeIncorrect");

  err.note("range patterns match against the start and end of a range; to bind the components, use a struct pattern");
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1880 suggest_swapping_misplaced_self_ty_and_trait
LateResolutionVisitor.prototype.suggest_swapping_misplaced_self_ty_and_trait = function (this: LateResolutionVisitor, err: Diag, source: PathSource, res: Res | undefined, span: Span): void {
  // PORT: the `let` chain becomes early returns, in the same order (`resolve_path` runs before the
  // span/source/res checks, as upstream).
  const processing = this.diag_metadata.currently_processing_impl_trait;
  if (processing === undefined) return;
  const [trait_ref, self_ty] = processing;
  if (self_ty.kind.$ !== "Path") return;
  const self_ty_path = self_ty.kind._1;
  const path_res = this.resolve_path(Segment.from_path(self_ty_path), "TypeNS", undefined, source);
  if (!(path_res.$ === "Module" && path_res._0.$ === "Module")) return;
  const module = path_res._0._0;
  if (module.def_kind()?.$ !== "Trait") return;
  if (trait_ref.path.span !== span) return;
  if (source.$ !== "Trait") return;
  if (!(res !== undefined && res.$ === "Def" && (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union"))) return;
  const self_ty_str = this.r.tcx_.sess.source_map().span_to_snippet(self_ty.span);
  if (self_ty_str.$ !== "Ok") return;
  const trait_ref_str = this.r.tcx_.sess.source_map().span_to_snippet(trait_ref.path.span);
  if (trait_ref_str.$ !== "Ok") return;
  err.multipart_suggestion(
    "`impl` items mention the trait being implemented first and the type it is being implemented for second",
    [
      [trait_ref.path.span, self_ty_str._0.toString()],
      [self_ty.span, trait_ref_str._0.toString()],
    ],
    "MaybeIncorrect",
  );
};

/// If the name resolution error occurs in an ident that has no span context, but the enclosing
/// item is within a derive macro, point at the derive, as the error can either be because of an
/// invalid derive macro *or* a non-existing item that will already have been reported through
/// the annotated item.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1912 detect_resolution_error_in_derive
LateResolutionVisitor.prototype.detect_resolution_error_in_derive = function (this: LateResolutionVisitor, err: Diag, span: Span): void {
  const item = this.diag_metadata.current_item;
  if (item !== undefined && !Span.eq_ctxt(item.span, span) && Span.in_derive_expansion(item.span)) {
    // `item` comes from a `#[derive()]`, but the error `span` doesn't, which means that the
    // derive is referencing a name coming from the annotated item. If the item exists, then
    // the derive macro itself is buggy. If the item exists, then an error will have already
    // been emitted while evaluating the annotated item itself, but we can't silence this
    // one because one *can* write a derive macro referencing a non-existing item that is
    // part of the expansion, *not* from the user's code. Because of that, at least for now,
    // we just add context to the current error.
    err.span_label(item.span, "in this derive macro");
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1928 explain_functions_in_pattern
LateResolutionVisitor.prototype.explain_functions_in_pattern = function (this: LateResolutionVisitor, err: Diag, res: Res | undefined, source: PathSource): void {
  if (source.$ !== "TupleStruct") return;
  if (!(res !== undefined && res.$ === "Def" && res._0.$ === "Fn")) return;
  err.primary_message("expected a pattern, found a function call");
  err.note("function calls are not allowed in patterns: <https://doc.rust-lang.org/book/ch19-00-patterns.html>");
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:1940 suggest_changing_type_to_const_param
LateResolutionVisitor.prototype.suggest_changing_type_to_const_param = function (
  this: LateResolutionVisitor,
  err: Diag,
  res: Res | undefined,
  source: PathSource,
  path: readonly Segment[],
  following_seg: Segment | undefined,
  span: Span,
): void {
  if (
    source.$ === "Expr" &&
    source._0 === undefined &&
    res !== undefined &&
    res.$ === "Def" &&
    res._0.$ === "TyParam" &&
    following_seg === undefined &&
    path.length === 1
  ) {
    const segment = path[0]!;
    // We have something like
    // impl<T, N> From<[T; N]> for VecWrapper<T> {
    //     fn from(slice: [T; N]) -> Self {
    //         VecWrapper(slice.to_vec())
    //     }
    // }
    // where `N` is a type param but should likely have been a const param.
    const item = this.diag_metadata.current_item;
    if (item === undefined) return;
    const generics = ast.ItemKind.generics(item.kind);
    if (generics === undefined) return;
    let span: Span | undefined;
    for (const param of generics.params) {
      // Only consider type params with no bounds.
      if (param.bounds.length === 0 && param.ident.name === segment.ident.name) {
        span = param.ident.span;
        break;
      }
    }
    if (span === undefined) {
      return;
    }
    err.subdiagnostic(diagnostics.UnexpectedResChangeTyParamToConstParamSugg_subdiagnostic({ before: Span.shrink_to_lo(span), after: Span.shrink_to_hi(span) }));
    return;
  }
  if (source.$ !== "Trait") return;

  // We don't include `DefKind::Str` and `DefKind::AssocTy` as they can't be reached here anyway.
  let applicability: Applicability;
  if (res !== undefined && res.$ === "PrimTy" && (res._0.$ === "Int" || res._0.$ === "Uint" || res._0.$ === "Bool" || res._0.$ === "Char")) {
    applicability = "MachineApplicable";
  } else if (
    // FIXME(const_generics): Add `DefKind::TyParam` and `SelfTyParam` once we support generic
    // const generics. Of course, `Struct` and `Enum` may contain ty params, too, but the
    // benefits of including them here outweighs the small number of false positives.
    res !== undefined &&
    res.$ === "Def" &&
    (res._0.$ === "Struct" || res._0.$ === "Enum") &&
    (this.r.features.adt_const_params() || this.r.features.min_adt_const_params())
  ) {
    applicability = "MaybeIncorrect";
  } else {
    return;
  }

  const item = this.diag_metadata.current_item;
  if (item === undefined) return;
  const generics = ast.ItemKind.generics(item.kind);
  if (generics === undefined) return;

  let param: Span | undefined;
  for (const p of generics.params) {
    // Only consider type params with exactly one trait bound.
    if (p.bounds.length === 1) {
      const bound = p.bounds[0]!;
      if (bound.$ === "Trait") {
        const tref = bound._0;
        if (TraitBoundModifiers_eq(tref.modifiers, ast.TraitBoundModifiers.NONE) && tref.span === span && Span.eq_ctxt(p.ident.span, span)) {
          param = p.ident.span;
          break;
        }
      }
    }
  }

  if (param !== undefined) {
    err.subdiagnostic(diagnostics.UnexpectedResChangeTyToConstParamSugg_subdiagnostic({ span: Span.shrink_to_lo(param), applicability }));
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2022 suggest_pattern_match_with_let
LateResolutionVisitor.prototype.suggest_pattern_match_with_let = function (this: LateResolutionVisitor, err: Diag, source: PathSource, span: Span): boolean {
  const cond = this.diag_metadata.in_if_condition;
  if (source.$ === "Expr" && cond !== undefined && cond.kind.$ === "Assign") {
    const expr_span = cond.span;
    const lhs = cond.kind._0;
    // Icky heuristic so we don't suggest:
    // `if (i + 2) = 2` => `if let (i + 2) = 2` (approximately pattern)
    // `if 2 = i` => `if let 2 = i` (lhs needs to contain error span)
    if (lhs.is_approximately_pattern() && Span.contains(lhs.span, span)) {
      err.span_suggestion_verbose(Span.shrink_to_lo(expr_span), "you might have meant to use pattern matching", "let ", "MaybeIncorrect");
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2048 get_single_associated_item
LateResolutionVisitor.prototype.get_single_associated_item = function (this: LateResolutionVisitor, path: readonly Segment[], source: PathSource, filter_fn: (_0: Res) => boolean): TypoSuggestion | undefined {
  if (source.$ === "TraitItem") {
    const mod_path = path.slice(0, path.length - 1);
    const path_res = this.resolve_path(mod_path, undefined, undefined, source);
    if (path_res.$ === "Module" && path_res._0.$ === "Module") {
      const module = path_res._0._0;
      const targets: [Symbol, Span, Res][] = [];
      for (const [key, resolution_] of this.r.resolutions(module)) {
        const resolution = resolution_.borrow(this.r);
        const binding = resolution.best_decl();
        const res = binding === undefined ? undefined : binding.res();
        if (res !== undefined && filter_fn(res)) {
          targets.push([key.ident.name, resolution.orig_ident_span, res]);
        }
      }
      if (targets.length === 1) {
        const [name, orig_ident_span, res] = targets[0]!;
        return TypoSuggestion.single_item(name, orig_ident_span, res);
      }
    }
  }
  return undefined;
};

/// Given `where <T as Bar>::Baz: String`, suggest `where T: Bar<Baz = String>`.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2083 restrict_assoc_type_in_where_clause
LateResolutionVisitor.prototype.restrict_assoc_type_in_where_clause = function (this: LateResolutionVisitor, span: Span, err: Diag): boolean {
  // Detect that we are actually in a `where` predicate.
  const predicate = this.diag_metadata.current_where_predicate;
  if (predicate === undefined || predicate.kind.$ !== "BoundPredicate") {
    return false;
  }
  const { bounded_ty, bound_generic_params, bounds } = predicate.kind._0;
  const where_span = predicate.span;
  if (bound_generic_params.length !== 0) {
    return false;
  }

  // Confirm that the target is an associated type.
  if (!(bounded_ty.kind.$ === "Path" && bounded_ty.kind._0 !== undefined)) return false;
  const qself = bounded_ty.kind._0;
  const path = bounded_ty.kind._1;
  // use this to verify that ident is a type param.
  const partial_res = this.r.partial_res_map.get(bounded_ty.id);
  if (partial_res === undefined) return false;
  const full_res = partial_res.full_res();
  if (!(full_res !== undefined && full_res.$ === "Def" && full_res._0.$ === "AssocTy")) {
    return false;
  }

  const peeled_ty = qself.ty.peel_refs();
  if (!(peeled_ty.kind.$ === "Path" && peeled_ty.kind._0 === undefined)) return false;
  const type_param_path = peeled_ty.kind._1;
  // Confirm that the `SelfTy` is a type parameter.
  const partial_res_ = this.r.partial_res_map.get(peeled_ty.id);
  if (partial_res_ === undefined) {
    return false;
  }
  const full_res_ = partial_res_.full_res();
  if (!(full_res_ !== undefined && full_res_.$ === "Def" && full_res_._0.$ === "TyParam")) {
    return false;
  }
  if (!(type_param_path.segments.length === 1 && type_param_path.segments[0]!.args === undefined && bounds.length === 1 && bounds[0]!.$ === "Trait")) {
    return false;
  }
  const poly_trait_ref = bounds[0]._0;
  const trait_segments = poly_trait_ref.trait_ref.path.segments;
  if (!(trait_segments.length === 1 && trait_segments[0]!.args === undefined)) {
    return false;
  }
  const { ident, id } = trait_segments[0]!;
  if (!TraitBoundModifiers_eq(poly_trait_ref.modifiers, ast.TraitBoundModifiers.NONE)) {
    return false;
  }
  if (ident.span === span) {
    const partial_res = this.r.partial_res_map.get(id);
    if (partial_res === undefined) {
      return false;
    }
    if (partial_res.full_res()?.$ !== "Def") {
      return false;
    }

    const new_where_bound_predicate = mk_where_bound_predicate(path, poly_trait_ref, qself.ty);
    if (new_where_bound_predicate === undefined) {
      return false;
    }
    err.span_suggestion_verbose(
      where_span,
      `constrain the associated type to \`${display_Ident(ident)}\``,
      pprust.where_bound_predicate_to_string(new_where_bound_predicate),
      "MaybeIncorrect",
    );
  }
  return true;
};

/// Check if the source is call expression and the first argument is `self`. If true,
/// return the span of whole call and the span for all arguments expect the first one (`self`).
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2157 call_has_self_arg
LateResolutionVisitor.prototype.call_has_self_arg = function (this: LateResolutionVisitor, source: PathSource): [Span, Span | undefined] | undefined {
  let has_self_arg: [Span, Span | undefined] | undefined = undefined;
  if (source.$ === "Expr" && source._0 !== undefined && source._0.kind.$ === "Call" && source._0.kind._1.length !== 0) {
    const parent = source._0;
    const args = source._0.kind._1;
    let expr_kind = args[0]!.kind;
    for (;;) {
      if (expr_kind.$ === "Path" && expr_kind._1.segments.length === 1) {
        const arg_name = expr_kind._1;
        if (arg_name.segments[0]!.ident.name === kw.SelfLower) {
          const call_span = parent.span;
          const tail_args_span =
            args.length > 1 ? Span.new(Span.lo(args[1]!.span), Span.hi(unwrap(args.at(-1)).span), Span.ctxt(call_span), undefined) : undefined;
          has_self_arg = [call_span, tail_args_span];
        }
        break;
      } else if (expr_kind.$ === "AddrOf") {
        expr_kind = expr_kind._2.kind;
      } else {
        break;
      }
    }
  }
  return has_self_arg;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2191 followed_by_brace
LateResolutionVisitor.prototype.followed_by_brace = function (this: LateResolutionVisitor, span: Span): [boolean, Span | undefined] {
  // HACK(estebank): find a better way to figure out that this was a
  // parser issue where a struct literal is being used on an expression
  // where a brace being opened means a block is being started. Look
  // ahead for the next text to see if `span` is followed by a `{`.
  const sm = this.r.tcx_.sess.source_map();
  const open_brace_span = sm.span_followed_by(span, "{");
  if (open_brace_span !== undefined) {
    // In case this could be a struct literal that needs to be surrounded
    // by parentheses, find the appropriate span.
    let close_brace_span: Span | undefined = undefined;
    const next_source_ = sm.span_to_next_source(open_brace_span);
    if (next_source_.$ === "Ok") {
      const next_source = next_source_._0;
      // Find the matching `}` accounting for nested braces.
      // PORT: `char_indices()` over the bytes: `{`/`}` are ASCII and never occur inside a
      // multi-byte UTF-8 sequence, so the byte offsets are the same.
      let depth = 1;
      let offset: number | undefined = undefined;
      for (let i = 0; i < next_source.len(); i++) {
        const c = next_source.byte(i);
        if (c === ch("{")) {
          depth += 1;
        } else if (c === ch("}") && depth === 1) {
          offset = i;
          break;
        } else if (c === ch("}")) {
          depth -= 1;
        }
      }
      if (offset !== undefined) {
        const start = BytePos.add(Span.hi(open_brace_span), BytePos(offset));
        close_brace_span = Span.with_hi(Span.with_lo(open_brace_span, start), BytePos.add(start, BytePos(1)));
      }
    }
    const closing_brace = close_brace_span === undefined ? undefined : Span.to(span, close_brace_span);
    return [true, closing_brace];
  } else {
    return [false, undefined];
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2223 update_err_for_private_tuple_struct_fields
LateResolutionVisitor.prototype.update_err_for_private_tuple_struct_fields = function (this: LateResolutionVisitor, err: Diag, source: PathSource, def_id: DefId): Span[] | undefined {
  if (source.$ === "TupleStruct") {
    // e.g. `if let Enum::TupleVariant(field1, field2) = _`
    err.primary_message("cannot match against a tuple struct which contains private fields");

    // Use spans of the tuple struct pattern.
    return [...source._1];
  } else if (source.$ === "Expr" && source._0 !== undefined && source._0.kind.$ === "Call") {
    // e.g. `let _ = Enum::TupleVariant(field1, field2);`
    const path = source._0.kind._0;
    const args = source._0.kind._1;
    const call_span = source._0.span;
    err.primary_message("cannot initialize a tuple struct which contains private fields");
    this.suggest_alternative_construction_methods(def_id, err, path.span, call_span, args);

    const fields = this.r.field_idents(def_id);
    return fields === undefined ? undefined : fields.map((f) => f.span);
  } else {
    return undefined;
  }
};

// ---- end res-late-diag-a ----

unported_methods(LateResolutionVisitor.prototype, "rustc_resolve::late::diagnostics::LateResolutionVisitor", ["smart_resolve_context_dependent_help", "suggest_alternative_construction_methods", "find_similarly_named_assoc_item", "lookup_assoc_candidate", "lookup_typo_candidate", "let_binding_suggestion", "find_module", "collect_enum_ctors", "suggest_using_enum_variant", "detect_and_suggest_const_parameter_error", "suggest_adding_generic_parameter", "suggestion_for_label_in_rib", "maybe_report_lifetime_uses", "emit_undeclared_lifetime_error", "suggest_introducing_lifetime", "suggest_introducing_lifetime_for_assoc_ty_binding", "suggest_introducing_lifetime_filtered", "emit_non_static_lt_in_const_param_ty_error", "emit_forbidden_non_static_lifetime_error", "report_missing_lifetime_specifiers", "add_missing_lifetime_specifiers_label", "find_ref_prefix_span_for_owned_suggestion"]);
unported_methods(LifetimeFinder.prototype, "rustc_resolve::late::diagnostics::LifetimeFinder", ["visit_ty"]);
unported_methods(RefPrefixSpanFinder.prototype, "rustc_resolve::late::diagnostics::RefPrefixSpanFinder", ["visit_ty"]);
unported_methods(ParentPathVisitor.prototype, "rustc_resolve::late::diagnostics::ParentPathVisitor", ["visit_ty"]);
