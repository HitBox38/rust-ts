// Port of compiler/rustc_resolve/src/late/diagnostics.rs
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ../decls.ts and
// installed below as `unported(..)` placeholders; free fns and companions have their final
// signatures and `unported` bodies, without markers. The lane that ports late/diagnostics.rs replaces
// each stub in place (adding its `// rustc: ` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { Path, PathSegment, PolyTraitRef, Ty, type WhereBoundPredicate, visit } from "../../rustc_ast/lib.ts";
import type { Namespace } from "../../rustc_hir/def.ts";
import { Session } from "../../rustc_session/session.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Ident } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
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
import { Applicability, type Diag, E0411, E0424, E0425, into_MultiSpan, pluralize } from "../../rustc_errors/lib.ts";
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
import { DefId_get_attrs, DefId_key, type Module, type PathResult, type Res } from "../lib.ts";
import { path_names_to_string } from "../lib.ts";
import * as diagnostics from "../diagnostics/mod.ts";
import type { Resolver } from "../decls.ts";
import type { BaseError } from "./diagnostics.gen.ts";
// end res-late-diag-a imports
// res-late-diag-b imports
import {
  AssocItemKind,
  type AngleBracketedArg,
  clone_Path,
  clone_PathSegment,
  clone_TraitBoundModifiers,
  clone_Ty,
  DUMMY_NODE_ID,
  GenericBound,
  type GenericParam,
  ItemKind,
  type Lifetime,
  type NodeId,
  TraitBoundModifiers,
} from "../../rustc_ast/lib.ts";
import { walk_ty } from "../../rustc_ast/visit.ts";
import { type Attribute as HirAttribute } from "../../rustc_attr_ir/lib.ts";
import type { Stability } from "../../rustc_attr_ir/stability.ts";
import { E0106, E0261, E0401, E0423, E0496, MultiSpan, struct_span_code_err, SuggestionStyle } from "../../rustc_errors/lib.ts";
import { type CtorKind, DefKind, MacroKinds } from "../../rustc_hir/def.ts";
import { SINGLE_USE_LIFETIMES, UNUSED_LIFETIMES } from "../../rustc_lint_defs/builtin.gen.ts";
import type { LifetimeRes } from "../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { type FnSig, PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Visibility } from "../../rustc_middle/ty/mod.ts";
import { edit_distance, find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { is_uppercase } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { Str } from "../../std/str.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import type { LabelSuggestion } from "../diagnostics/impls.ts";
import { LifetimeBinderKind, type MissingLifetimeKind, type NoConstantGenericsReason, RibKind } from "../late.ts";
import { type ElisionFnParameter, type MissingLifetime } from "./diagnostics.gen.ts";
import { type BindingKey, Finalize, Ident_key, ParentScope } from "../lib.ts";
// end res-late-diag-b imports

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

  // rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4840 new
  static new(self_ty: Ty, target: Ident): ParentPathVisitor {
    const v = new ParentPathVisitor(target, undefined, []);

    v.visit_ty(self_ty);
    return v;
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
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4700 mk_where_bound_predicate
export function mk_where_bound_predicate(path: Path, poly_trait_ref: PolyTraitRef, ty: Ty): WhereBoundPredicate | undefined {
  let modified_segments: PathSegment[];
  {
    const segments_ = path.segments.map(clone_PathSegment);
    // `let [preceding @ .., second_last, last] = segments.as_mut_slice() else { return None; };`
    if (segments_.length < 2) {
      return undefined;
    }
    const preceding = segments_.slice(0, segments_.length - 2);
    const second_last = segments_[segments_.length - 2]!;
    const last = segments_[segments_.length - 1]!;
    const segments = preceding.slice();

    const added_constraint: AngleBracketedArg = {
      $: "Constraint",
      _0: {
        id: DUMMY_NODE_ID,
        ident: last.ident,
        gen_args: undefined,
        kind: {
          $: "Equality",
          term: {
            $: "Ty",
            _0: new Ty(DUMMY_NODE_ID, { $: "Path", _0: undefined, _1: clone_Path(poly_trait_ref.trait_ref.path) }, DUMMY_SP),
          },
        },
        span: DUMMY_SP,
      },
    };

    const second_last_args = second_last.args;
    if (second_last_args !== undefined && second_last_args.$ === "AngleBracketed") {
      const { args } = second_last_args._0;
      args.push(added_constraint);
    } else if (second_last_args !== undefined) {
      return undefined;
    } else {
      second_last.args = {
        $: "AngleBracketed",
        _0: {
          args: [added_constraint],
          span: DUMMY_SP,
        },
      };
    }

    segments.push(clone_PathSegment(second_last));
    modified_segments = segments;
  }

  const new_where_bound_predicate: WhereBoundPredicate = {
    bound_generic_params: [],
    bounded_ty: clone_Ty(ty),
    bounds: [
      {
        $: "Trait",
        _0: new PolyTraitRef(
          [],
          clone_TraitBoundModifiers(TraitBoundModifiers.NONE),
          {
            path: new Path(DUMMY_SP, modified_segments),
            ref_id: DUMMY_NODE_ID,
          },
          DUMMY_SP,
          "No",
        ),
      },
    ],
  };

  return new_where_bound_predicate;
}
/// Report lifetime/lifetime shadowing as an error.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4763 signal_lifetime_shadowing
export function signal_lifetime_shadowing(sess: Session, orig: Ident, shadower: Ident): ErrorGuaranteed {
  return struct_span_code_err(
    sess.dcx(),
    shadower.span,
    E0496,
    `lifetime name \`${display_Symbol(orig.name)}\` shadows a lifetime name that is already in scope`,
  )
    .with_span_label(orig.span, "first declared here")
    .with_span_label(shadower.span, `lifetime \`${display_Symbol(orig.name)}\` already in scope`)
    .emit_err();
}
/// Shadowing involving a label is only a warning for historical reasons.
//FIXME: make this a proper lint.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4820 signal_label_shadowing
export function signal_label_shadowing(sess: Session, orig: Span, shadower_: Ident): void {
  const name = shadower_.name;
  const shadower = shadower_.span;
  sess
    .dcx()
    .struct_span_warn(shadower, `label name \`${display_Symbol(name)}\` shadows a label name that is already in scope`)
    .with_span_label(orig, "first declared here")
    .with_span_label(shadower, `label \`${display_Symbol(name)}\` already in scope`)
    .emit();
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
      // `find_attr!(r.tcx, did, Doc(d) => d)` (`impl HasAttrs for DefId`: lib.ts `DefId_get_attrs`).
      const d = find_attr(DefId_get_attrs(did, r.tcx_), (k: AttributeKind) => (k.$ === "Doc" ? k._0 : undefined));
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
      const correct = LateResolutionVisitor.likely_rust_type(path);
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

// ---- lane res-late-diag-b: late/diagnostics.rs:2267..end (`impl LateResolutionVisitor`, second half) ----

/** `Result<Str, _>::ok()` of a `span_to_snippet` as a `String`. */
function snippet_ok(r: Result<Str, unknown>): string | undefined {
  return r.$ === "Ok" ? r._0.toString() : undefined;
}

/// Provides context-dependent help for errors reported by the `smart_resolve_path_fragment`
/// function.
/// Returns `true` if able to provide context-dependent help.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2267 smart_resolve_context_dependent_help
LateResolutionVisitor.prototype.smart_resolve_context_dependent_help = function (
  this: LateResolutionVisitor,
  err: Diag,
  span: Span,
  source: PathSource,
  path: readonly Segment[],
  res: Res,
  path_str: string,
  fallback_label: string,
): boolean {
  const ns = PathSource.namespace(source);
  const is_expected = (res: Res): boolean => PathSource.is_expected(source, res);

  const path_sep = (this_: LateResolutionVisitor, err: Diag, expr: Expr, kind: DefKind): boolean => {
    const MESSAGE = "use the path separator to refer to an item";

    let lhs_span: Span;
    let rhs_span: Span;
    const ek = expr.kind;
    switch (ek.$) {
      case "Field":
        [lhs_span, rhs_span] = [ek._0.span, ek._1.span];
        break;
      case "MethodCall":
        [lhs_span, rhs_span] = [ek._0.receiver.span, ek._0.span];
        break;
      default:
        return false;
    }

    if (Span.eq_ctxt(lhs_span, rhs_span)) {
      err.span_suggestion_verbose(Span.between(lhs_span, rhs_span), MESSAGE, "::", Applicability.MaybeIncorrect);
      return true;
    }
    if (kind.$ === "Struct" || kind.$ === "TyAlias") {
      const lhs_source_span = Span.find_ancestor_inside(lhs_span, expr.span);
      if (lhs_source_span !== undefined) {
        const snippet = this_.r.tcx_.sess.source_map().span_to_snippet(lhs_source_span);
        if (snippet.$ === "Ok") {
          // The LHS is a type that originates from a macro call.
          // We have to add angle brackets around it.

          err.span_suggestion_verbose(Span.until(lhs_source_span, rhs_span), MESSAGE, `<${snippet._0.toString()}>::`, Applicability.MaybeIncorrect);
          return true;
        }
      }
    }
    // Either we were unable to obtain the source span / the snippet or
    // the LHS originates from a macro call and it is not a type and thus
    // there is no way to replace `.` with `::` and still somehow suggest
    // valid Rust code.

    return false;
  };

  const find_span = (source: PathSource, err: Diag): Span => {
    if (source.$ === "Expr" && source._0 !== undefined && source._0.kind.$ === "Call") {
      const span = source._0.span;
      // We want the main underline to cover the suggested code as well for
      // cleaner output.
      err.span(span);
      return span;
    } else if (source.$ === "TupleStruct") {
      const span = source._0;
      err.span(span);
      return span;
    }
    return span;
  };

  const bad_struct_syntax_suggestion = (this_: LateResolutionVisitor, err: Diag, def_id: DefId): void => {
    const [followed_by_brace, closing_brace] = this_.followed_by_brace(span);

    const parent = source.$ === "Expr" ? source._0 : undefined;
    if (parent !== undefined && (parent.kind.$ === "Field" || parent.kind.$ === "MethodCall") && path_sep(this_, err, parent, DefKind.Struct)) {
      // nothing
    } else if (
      source.$ === "Expr" &&
      (source._0 === undefined ||
        source._0.kind.$ === "Path" ||
        source._0.kind.$ === "Binary" ||
        source._0.kind.$ === "Unary" ||
        source._0.kind.$ === "If" ||
        source._0.kind.$ === "While" ||
        source._0.kind.$ === "ForLoop" ||
        source._0.kind.$ === "Match") &&
      followed_by_brace
    ) {
      if (closing_brace !== undefined) {
        const sp = closing_brace;
        err.span_label(span, fallback_label);
        err.multipart_suggestion(
          "surround the struct literal with parentheses",
          [
            [Span.shrink_to_lo(sp), "("],
            [Span.shrink_to_hi(sp), ")"],
          ],
          Applicability.MaybeIncorrect,
        );
      } else {
        err.span_label(
          span, // Note the parentheses surrounding the suggestion below
          `you might want to surround a struct literal with parentheses: \`(${path_str} { /* fields */ })\`?`,
        );
      }
    } else if (source.$ === "Expr" || source.$ === "TupleStruct" || source.$ === "Pat") {
      const span = find_span(source, err);
      err.span_label(this_.r.def_span(def_id), `\`${path_str}\` defined here`);

      let tail: string;
      let descr: string;
      let applicability: Applicability;
      let old_fields: (string | undefined)[] | undefined;
      if (source.$ === "Pat") {
        [tail, descr, applicability, old_fields] = ["", "pattern", Applicability.MachineApplicable, undefined];
      } else if (source.$ === "TupleStruct") {
        const args = source._1;
        [tail, descr, applicability, old_fields] = [
          "",
          "pattern",
          Applicability.MachineApplicable,
          args.map((a) => snippet_ok(this_.r.tcx_.sess.source_map().span_to_snippet(a))),
        ];
      } else {
        [tail, descr, applicability, old_fields] = [": val", "literal", Applicability.HasPlaceholders, undefined];
      }

      // Imprecise for local structs without ctors, we don't keep fields for them.
      let has_private_fields: boolean;
      const local_def_id = def_id.as_local();
      if (local_def_id !== undefined) {
        const ctor = this_.r.struct_ctors.get(local_def_id);
        has_private_fields = ctor !== undefined && ctor.has_private_fields(this_.parent_scope.module, this_.r);
      } else {
        has_private_fields = this_.r.tcx_.associated_item_def_ids(def_id).some((field_id) => {
          const vis = this_.r.tcx_.visibility(field_id);
          return !this_.r.is_accessible_from(vis, this_.parent_scope.module);
        });
      }
      if (!has_private_fields) {
        // If the fields of the type are private, we shouldn't be suggesting using
        // the struct literal syntax at all, as that will cause a subsequent error.
        const fields = this_.r.field_idents(def_id);
        const has_fields = fields !== undefined && fields.length !== 0;

        const call = source.$ === "Expr" && source._0 !== undefined && source._0.kind.$ === "Call" ? source._0 : undefined;
        const call_kind = call?.kind.$ === "Call" ? call.kind : undefined;
        if (
          call !== undefined &&
          call_kind !== undefined &&
          call_kind._1.length !== 0 &&
          fields !== undefined &&
          call_kind._1.length === fields.length
          // Make sure we have same number of args as fields
        ) {
          const [path, args] = [call_kind._0, call_kind._1];
          const span = call.span;
          const path_span = path.span;
          const parts: [Span, string][] = [];

          // Start with the opening brace
          parts.push([Span.until(Span.shrink_to_hi(path_span), args[0]!.span), "{"]);

          for (let i = 0; i < Math.min(fields.length, args.length); i++) {
            const [field, arg] = [fields[i]!, args[i]!];
            // Add the field name before the argument
            parts.push([Span.shrink_to_lo(arg.span), `${display_Ident(field)}: `]);
          }

          // Add the closing brace
          parts.push([Span.until(Span.shrink_to_hi(unwrap(args[args.length - 1]).span), Span.shrink_to_hi(span)), "}"]);

          err.multipart_suggestion(`use struct ${descr} syntax instead of calling`, parts, applicability);
        } else {
          let fields_: string;
          let applicability_: Applicability;
          if (fields !== undefined) {
            let fields_vec: string[];
            if (old_fields !== undefined) {
              const old_fields_ = old_fields;
              fields_vec = fields
                .map((new_, idx): [Ident, { $: "Some"; _0: string | undefined } | undefined] => [
                  new_,
                  // PORT: `old_fields.get(idx)`: `Option<&Option<String>>`.
                  idx < old_fields_.length ? { $: "Some", _0: old_fields_[idx] } : undefined,
                ])
                .map(([new_, old]) => {
                  if (old !== undefined && old._0 !== undefined && new_.as_str() !== old._0) {
                    return `${display_Ident(new_)}: ${old._0}`;
                  } else {
                    return display_Ident(new_);
                  }
                });
            } else {
              fields_vec = fields.map((f) => `${display_Ident(f)}${tail}`);
            }

            [fields_, applicability_] = [fields_vec.join(", "), applicability];
          } else {
            [fields_, applicability_] = ["/* fields */", Applicability.HasPlaceholders];
          }
          const pad = has_fields ? " " : "";
          const expression = `${path_str} {${pad}${fields_}${pad}}`;
          if (!this_.suggest_named_format_argument(err, source, unwrap(path[path.length - 1]).ident, expression, applicability_)) {
            err.span_suggestion(span, `use struct ${descr} syntax instead`, expression, applicability_);
          }
        }
      }
      if (source.$ === "Expr" && source._0 !== undefined && source._0.kind.$ === "Call") {
        const [path, args] = [source._0.kind._0, source._0.kind._1];
        const call_span = source._0.span;
        this_.suggest_alternative_construction_methods(def_id, err, path.span, call_span, args);
      }
    } else {
      err.span_label(span, fallback_label);
    }
  };

  // match (res, source)
  if (
    res.$ === "Def" &&
    res._0.$ === "Macro" &&
    ((source.$ === "Expr" && source._0 !== undefined && (source._0.kind.$ === "Index" || source._0.kind.$ === "Call")) || source.$ === "Struct") &&
    MacroKinds.contains(res._0._0, MacroKinds.BANG)
  ) {
    const def_id = res._1;
    // Don't suggest macro if it's unstable.
    let suggestable: boolean;
    if (def_id.is_local()) {
      suggestable = true;
    } else {
      // PORT: `lookup_stability`'s value is typed `unknown` in the query typemap; it is
      // `Option<rustc_hir::Stability>` (rustc_attr_ir::stability).
      const s = this.r.tcx_.lookup_stability(def_id) as Stability | undefined;
      suggestable = s === undefined || s.is_stable();
    }

    err.span_label(span, fallback_label);

    // Don't suggest `!` for a macro invocation if there are generic args
    const last = path[path.length - 1];
    if (last !== undefined && !last.has_generic_args && !last.has_lifetime_args && suggestable) {
      err.span_suggestion_verbose(Span.shrink_to_hi(span), "use `!` to invoke the macro", "!", Applicability.MaybeIncorrect);
    }

    if (path_str === "try" && Span.is_rust_2015(span)) {
      err.note("if you want the `try` keyword, you need Rust 2018 or later");
    }
  } else if (res.$ === "Def" && res._0.$ === "Macro" && MacroKinds.contains(res._0._0, MacroKinds.BANG)) {
    err.span_label(span, fallback_label);
  } else if (res.$ === "Def" && res._0.$ === "TyAlias" && source.$ === "Trait") {
    const def_id = res._1;
    err.span_label(span, "type aliases cannot be used as traits");
    if (this.r.tcx_.sess.is_nightly_build()) {
      const msg = "you might have meant to use `#![feature(trait_alias)]` instead of a `type` alias";
      const span = this.r.def_span(def_id);
      const snip = this.r.tcx_.sess.source_map().span_to_snippet(span);
      if (snip.$ === "Ok") {
        // The span contains a type alias so we should be able to
        // replace `type` with `trait`.
        const snip_ = snip._0.toString().replace("type", "trait");
        err.span_suggestion_verbose(span, msg, snip_, Applicability.MaybeIncorrect);
      } else {
        err.span_help(span, msg);
      }
    }
  } else if (
    res.$ === "Def" &&
    (res._0.$ === "Mod" || res._0.$ === "Trait" || res._0.$ === "TyAlias") &&
    source.$ === "Expr" &&
    source._0 !== undefined &&
    path_sep(this, err, source._0, res._0)
  ) {
    return true;
  } else if (res.$ === "Def" && res._0.$ === "Enum" && (source.$ === "TupleStruct" || source.$ === "Expr")) {
    this.suggest_using_enum_variant(err, source, res._1, span);
  } else if (res.$ === "Def" && res._0.$ === "Struct" && ns === "ValueNS") {
    const def_id = res._1;
    if (source.$ === "Expr" && source._0 !== undefined && (source._0.kind.$ === "Field" || source._0.kind.$ === "MethodCall")) {
      bad_struct_syntax_suggestion(this, err, def_id);
      return true;
    }
    const ctor = this.r.struct_ctor(def_id);
    if (ctor === undefined) {
      bad_struct_syntax_suggestion(this, err, def_id);
      return true;
    }

    // A type is re-exported and has an inaccessible constructor because it has fields
    // that are inaccessible from the reexport's scope, extend the diagnostic.
    const is_accessible = this.r.is_accessible_from(ctor.vis, this.parent_scope.module);
    if (is_accessible) {
      const mod_path = path.slice(0, path.length - 1);
      const r = this.resolve_path(mod_path, "TypeNS", undefined, PathSource.Module);
      if (r.$ === "Module" && r._0.$ === "Module") {
        const import_mod = r._0._0;
        if (ctor.has_private_fields(import_mod, this.r)) {
          const import_decl = this.r
            .cm()
            .maybe_resolve_ident_in_module({ $: "Module", _0: import_mod }, unwrap(path[path.length - 1]).ident, "TypeNS", this.parent_scope, undefined);
          if (import_decl.$ === "Ok") {
            err.span_note(
              import_decl._0.span,
              "the type is accessed through this re-export, but the type's constructor is not visible in this import's scope due to private fields",
            );
            if (!ctor.has_private_fields(this.parent_scope.module, this.r)) {
              err.span_suggestion_verbose(
                span,
                "the type can be constructed directly, because its fields are available from the current scope",
                // Using `tcx.def_path_str` causes the compiler to hang.
                // We don't need to handle foreign crate types because in that case you
                // can't access the ctor either way.
                `crate${this.r.tcx_.def_path(def_id).to_string_no_crate_verbose()}`, // The method already has leading `::`.
                Applicability.MachineApplicable,
              );
            }
            this.update_err_for_private_tuple_struct_fields(err, source, def_id);
          }
        }
      }
    }
    if (!is_expected(ctor.res) || is_accessible) {
      return true;
    }

    const field_spans = this.update_err_for_private_tuple_struct_fields(err, source, def_id);

    const spans = field_spans !== undefined && field_spans.length > 0 && ctor.field_visibilities.length === field_spans.length ? field_spans : undefined;
    if (spans !== undefined) {
      const non_visible_spans: Span[] = [];
      for (let i = 0; i < Math.min(ctor.field_visibilities.length, spans.length); i++) {
        const vis = ctor.field_visibilities[i]!;
        if (!this.r.is_accessible_from(vis, this.parent_scope.module)) non_visible_spans.push(spans[i]!);
      }

      if (non_visible_spans.length > 0) {
        const fields = this.r.field_visibility_spans.get(def_id);
        if (fields !== undefined) {
          err.multipart_suggestion(
            `consider making the field${pluralize(fields.length)} publicly accessible`,
            fields.map((span): [Span, string] => [span, "pub "]),
            Applicability.MaybeIncorrect,
          );
        }

        const m = MultiSpan.from_spans(non_visible_spans.slice());
        for (const s of non_visible_spans) m.push_span_label(s, "private field");
        err.span_note(m, "constructor is not visible here due to private fields");
      }

      return true;
    }

    err.span_label(span, "constructor is not visible here due to private fields");
  } else if (res.$ === "Def" && (res._0.$ === "Union" || res._0.$ === "Variant") && ns === "ValueNS") {
    bad_struct_syntax_suggestion(this, err, res._1);
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Const" && ns === "ValueNS") {
    const def_id = res._1;
    if (source.$ === "Expr" || source.$ === "TupleStruct" || source.$ === "Pat") {
      const span = find_span(source, err);
      err.span_label(this.r.def_span(def_id), `\`${path_str}\` defined here`);
      err.span_suggestion(span, "use this syntax instead", path_str, Applicability.MaybeIncorrect);
    } else {
      return false;
    }
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Fn" && ns === "ValueNS") {
    const ctor_def_id = res._1;
    const def_id = this.r.tcx_.parent(ctor_def_id);
    err.span_label(this.r.def_span(def_id), `\`${path_str}\` defined here`);
    const field_ids = this.r.field_idents(def_id);
    const fields = field_ids === undefined ? "/* fields */" : new Array<string>(field_ids.length).fill("_").join(", ");
    err.span_suggestion(span, "use the tuple variant pattern syntax instead", `${path_str}(${fields})`, Applicability.HasPlaceholders);
  } else if ((res.$ === "SelfTyParam" || res.$ === "SelfTyAlias") && ns === "ValueNS") {
    err.span_label(span, fallback_label);
    err.note("can't use `Self` as a constructor, you must use the implemented struct");
  } else if (
    res.$ === "Def" &&
    (res._0.$ === "TyAlias" || res._0.$ === "AssocTy") &&
    source.$ === "TraitItem" &&
    source._0 === "ValueNS" &&
    source._1.$ === "TupleStruct"
  ) {
    const [whole, args] = [source._1._0, source._1._1];
    err.note("can't use a type alias as tuple pattern");

    const suggestion: [Span, string][] = [];

    if (args.length >= 1) {
      const first = args[0]!;
      const last = args[args.length - 1]!;
      suggestion.push(
        // "0: " has to be included here so that the fix is machine applicable.
        //
        // If this would only add " { " and then the code below add "0: ",
        // rustfix would crash, because end of this suggestion is the same as start
        // of the suggestion below. Thus, we have to merge these...
        [Span.between(span, first), " { 0: "],
        [Span.between(last, Span.shrink_to_hi(whole)), " }"],
      );

      suggestion.push(
        ...args
          .map((arg, index): [number, Span] => [index, arg])
          .slice(1) // See above
          .map(([index, arg]): [Span, string] => [Span.shrink_to_lo(arg), `${index}: `]),
      );
    } else {
      suggestion.push([Span.between(span, Span.shrink_to_hi(whole)), " {}"]);
    }

    err.multipart_suggestion("use struct pattern instead", suggestion, Applicability.MachineApplicable);
  } else if (
    res.$ === "Def" &&
    (res._0.$ === "TyAlias" || res._0.$ === "AssocTy") &&
    source.$ === "TraitItem" &&
    source._0 === "ValueNS" &&
    source._1.$ === "Expr" &&
    source._1._0 !== undefined &&
    source._1._0.kind.$ === "Call"
  ) {
    const whole = source._1._0.span;
    const args = source._1._0.kind._1;
    err.note("can't use a type alias as a constructor");

    const suggestion: [Span, string][] = [];

    if (args.length >= 1) {
      const first = args[0]!;
      const last = args[args.length - 1]!;
      suggestion.push(
        // "0: " has to be included here so that the fix is machine applicable.
        //
        // If this would only add " { " and then the code below add "0: ",
        // rustfix would crash, because end of this suggestion is the same as start
        // of the suggestion below. Thus, we have to merge these...
        [Span.between(span, first.span), " { 0: "],
        [Span.between(last.span, Span.shrink_to_hi(whole)), " }"],
      );

      suggestion.push(
        ...args
          .map((arg, index): [number, Expr] => [index, arg])
          .slice(1) // See above
          .map(([index, arg]): [Span, string] => [Span.shrink_to_lo(arg.span), `${index}: `]),
      );
    } else {
      suggestion.push([Span.between(span, Span.shrink_to_hi(whole)), " {}"]);
    }

    err.multipart_suggestion("use struct expression instead", suggestion, Applicability.MachineApplicable);
  } else {
    return false;
  }
  return true;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2794 suggest_alternative_construction_methods
LateResolutionVisitor.prototype.suggest_alternative_construction_methods = function (
  this: LateResolutionVisitor,
  def_id: DefId,
  err: Diag,
  path_span: Span,
  call_span: Span,
  args: readonly Expr[],
): void {
  if (def_id.is_local()) {
    // Doing analysis on local `DefId`s would cause infinite recursion.
    return;
  }
  // Look at all the associated functions without receivers in the type's
  // inherent impls to look for builders that return `Self`
  const tcx = this.r.tcx_;
  const items: [boolean, Symbol, number][] = [];
  for (const i of tcx.inherent_impls(def_id)) {
    // PORT: the `associated_items` / `fn_sig` query values are `unknown` in queries.gen.ts (`&AssocItems`,
    // `EarlyBinder<PolyFnSig>`).
    for (const item of AssocItems.in_definition_order(tcx.associated_items(i) as AssocItems)) {
      // Only assoc fn with no receivers.
      if (!(AssocItem.is_fn(item) && !AssocItem.is_method(item))) continue;
      // Only assoc fns that return `Self`
      const fn_sig = EarlyBinder.skip_binder(tcx.fn_sig(item.def_id) as EarlyBinder<Binder<FnSig>>);
      // Don't normalize the return type, because that can cause cycle errors.
      const ret_ty = Binder.skip_binder(PolyFnSig.output(fn_sig));
      const ret_kind = ret_ty.kind();
      if (ret_kind.$ !== "Adt") continue;
      const def = ret_kind._0;
      const input_len = Binder.skip_binder(PolyFnSig.inputs(fn_sig)).length;
      if (!DefId_eq(def.did(), def_id)) continue;
      const name = AssocItem.name(item);
      const order = !Symbol.as_str(name).startsWith("new");
      items.push([order, name, input_len]);
    }
  }
  // `sort_by_key(|(order, _, _)| *order)` (stable; `false < true`).
  items.sort((a, b) => Number(a[0]) - Number(b[0]));
  const suggestion = (name: Symbol, args: number): string => `::${display_Symbol(name)}(${new Array<string>(args).fill("_").join(", ")})`;
  if (items.length === 0) {
    // nothing
  } else if (items.length === 1 && items[0]![2] === args.length) {
    const [, name] = items[0]!;
    err.span_suggestion_verbose(
      Span.shrink_to_hi(path_span),
      `you might have meant to use the \`${display_Symbol(name)}\` associated function`,
      `::${display_Symbol(name)}`,
      Applicability.MaybeIncorrect,
    );
  } else if (items.length === 1) {
    const [, name, len] = items[0]!;
    err.span_suggestion_verbose(
      Span.with_hi(Span.shrink_to_hi(path_span), Span.hi(call_span)),
      `you might have meant to use the \`${display_Symbol(name)}\` associated function`,
      suggestion(name, len),
      Applicability.MaybeIncorrect,
    );
  } else {
    err.span_suggestions_with_style(
      Span.with_hi(Span.shrink_to_hi(path_span), Span.hi(call_span)),
      "you might have meant to use an associated function to build this type",
      items.map(([, name, len]) => suggestion(name, len)),
      Applicability.MaybeIncorrect,
      SuggestionStyle.ShowAlways,
    );
  }
  // We'd ideally use `type_implements_trait` but don't have access to
  // the trait solver here. We can't use `get_diagnostic_item` or
  // `all_traits` in resolve either. So instead we abuse the import
  // suggestion machinery to get `std::default::Default` and perform some
  // checks to confirm that we got *only* that trait. We then see if the
  // Adt we have has a direct implementation of `Default`. If so, we
  // provide a structured suggestion.
  const default_trait = this.r
    .lookup_import_candidates(Ident.with_dummy_span(sym.Default), "TypeNS", this.parent_scope, (res: Res) => res.$ === "Def" && res._0.$ === "Trait")
    .flatMap((candidate) => (candidate.did === undefined ? [] : [candidate.did]))
    .find((did) => find_attr(DefId_get_attrs(did, this.r.tcx_), (k: AttributeKind) => (k.$ === "RustcDiagnosticItem" && k._0 === sym.Default ? true : undefined)) === true);
  if (default_trait === undefined) {
    return;
  }
  if (
    [...this.r.extern_crate_map]
      // FIXME: This doesn't include impls like `impl Default for String`.
      .flatMap(([_, crate_]) => this.r.tcx_.implementations_of_trait([crate_, default_trait]))
      .flatMap(([_, simplified_self_ty]) => (simplified_self_ty === undefined ? [] : [simplified_self_ty]))
      .flatMap((_simplified_self_ty): DefId[] =>
        // PORT: `SimplifiedType::Adt(did)` (rustc_type_ir::fast_reject) is not ported (M3); the query value is `unknown`.
        unported("rustc_type_ir::fast_reject::SimplifiedType (implementations_of_trait value; M3)"),
      )
      .some((did) => DefId_eq(did, def_id))
  ) {
    err.multipart_suggestion(
      "consider using the `Default` trait",
      [
        [Span.shrink_to_lo(path_span), "<"],
        [Span.with_hi(Span.shrink_to_hi(path_span), Span.hi(call_span)), " as std::default::Default>::default()"],
      ],
      Applicability.MaybeIncorrect,
    );
  }
};

/// Given the target `ident` and `kind`, search for the similarly named associated item
/// in `self.current_trait_ref`.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2919 find_similarly_named_assoc_item
LateResolutionVisitor.prototype.find_similarly_named_assoc_item = function (this: LateResolutionVisitor, ident: Symbol, kind: AssocItemKind): Symbol | undefined {
  const current_trait_ref = this.current_trait_ref;
  if (current_trait_ref === undefined) return undefined;
  const [module] = current_trait_ref;
  if (ident === kw.Underscore) {
    // We do nothing for `_`.
    return undefined;
  }

  const targets = [...this.r.resolutions(module)]
    .flatMap(([key, res]): [BindingKey, Res][] => {
      const binding = res.borrow(this.r).best_decl();
      return binding === undefined ? [] : [[key, binding.res()]];
    })
    .filter(([_, res]) => {
      if (kind.$ === "Const" && res.$ === "Def" && res._0.$ === "AssocConst") return true;
      if (kind.$ === "Fn" && res.$ === "Def" && res._0.$ === "AssocFn") return true;
      if (kind.$ === "Type" && res.$ === "Def" && res._0.$ === "AssocTy") return true;
      if (kind.$ === "Delegation" && res.$ === "Def" && res._0.$ === "AssocFn") return true;
      return false;
    })
    .map(([key, _]) => key.ident.name);

  return find_best_match_for_name(targets, ident, undefined);
};

/// Find a field or associated item, retaining its definition span for diagnostics.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2951 lookup_assoc_candidate
LateResolutionVisitor.prototype.lookup_assoc_candidate = function (
  this: LateResolutionVisitor,
  ident: Ident,
  ns: Namespace,
  filter_fn: (_0: Res) => boolean,
  called: boolean,
): [AssocSuggestion, Span] | undefined {
  // rustc: compiler/rustc_resolve/src/late/diagnostics.rs:2961 extract_node_id
  function extract_node_id(t: Ty): NodeId | undefined {
    const k = t.kind;
    switch (k.$) {
      case "Path":
        if (k._0 === undefined) return t.id;
        return undefined;
      case "Ref":
        return extract_node_id(k._1);
      // This doesn't handle the remaining `Ty` variants as they are not
      // that commonly the self_type, it might be interesting to provide
      // support for those in future.
      default:
        return undefined;
    }
  }
  // Fields are generally expected in the same contexts as locals.
  if (filter_fn({ $: "Local", _0: DUMMY_NODE_ID })) {
    found: {
      const self_type = this.diag_metadata.current_self_type;
      const node_id = self_type === undefined ? undefined : extract_node_id(self_type);
      if (node_id === undefined) break found;
      const resolution = this.r.partial_res_map.get(node_id);
      if (resolution === undefined) break found;
      const full_res = resolution.full_res();
      if (full_res === undefined || full_res.$ !== "Def" || (full_res._0.$ !== "Struct" && full_res._0.$ !== "Union")) break found;
      const did = full_res._1;
      const fields = this.r.field_idents(did);
      if (fields === undefined) break found;
      const field = fields.find((id) => ident.name === id.name);
      if (field === undefined) break found;
      // Look for a field with the same name in the current self_type.
      return [AssocSuggestion.Field, field.span];
    }
  }

  const items = this.diag_metadata.current_trait_assoc_items;
  if (items !== undefined) {
    for (const assoc_item of items) {
      const assoc_ident = AssocItemKind.ident(assoc_item.kind);
      if (assoc_ident !== undefined && assoc_ident.eq(ident)) {
        let candidate: AssocSuggestion;
        const k = assoc_item.kind;
        if (k.$ === "Const") {
          candidate = AssocSuggestion.AssocConst;
        } else if (k.$ === "Fn" && k._0.sig.decl.has_self()) {
          candidate = { $: "MethodWithSelf", called };
        } else if (k.$ === "Fn") {
          candidate = { $: "AssocFn", called };
        } else if (k.$ === "Type") {
          candidate = AssocSuggestion.AssocType;
        } else if (
          k.$ === "Delegation" &&
          (() => {
            const o = this.r.owners.get(assoc_item.id);
            const sig = o === undefined ? undefined : this.r.delegation_fn_sigs.get(o.def_id);
            return sig !== undefined && sig.has_self;
          })()
        ) {
          candidate = { $: "MethodWithSelf", called };
        } else if (k.$ === "Delegation") {
          candidate = { $: "AssocFn", called };
        } else {
          // ast::AssocItemKind::MacCall(_) | ast::AssocItemKind::DelegationMac(..)
          continue;
        }
        return [candidate, assoc_ident.span];
      }
    }
  }

  // Look for associated items in the current trait.
  const current_trait_ref = this.current_trait_ref;
  if (current_trait_ref !== undefined) {
    const [module] = current_trait_ref;
    const binding_r = this.r.cm().maybe_resolve_ident_in_module({ $: "Module", _0: module }, ident, ns, this.parent_scope, undefined);
    if (binding_r.$ === "Ok") {
      const binding = binding_r._0;
      const res = binding.res();
      if (filter_fn(res)) {
        if (res.$ === "Def" && (res._0.$ === "Fn" || res._0.$ === "AssocFn")) {
          const def_id = res._1;
          let has_self: boolean;
          const local = def_id.as_local();
          if (local !== undefined) {
            const sig = this.r.delegation_fn_sigs.get(local);
            has_self = sig !== undefined && sig.has_self;
          } else {
            const idents = this.r.tcx_.fn_arg_idents(def_id);
            has_self = idents.length > 0 && idents[0] !== undefined && idents[0].name === kw.SelfLower;
          }
          if (has_self) {
            return [{ $: "MethodWithSelf", called }, binding.span];
          } else {
            return [{ $: "AssocFn", called }, binding.span];
          }
        } else if (res.$ === "Def" && res._0.$ === "AssocConst") {
          return [AssocSuggestion.AssocConst, binding.span];
        } else if (res.$ === "Def" && res._0.$ === "AssocTy") {
          return [AssocSuggestion.AssocType, binding.span];
        }
      }
    }
  }

  return undefined;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3065 lookup_typo_candidate
LateResolutionVisitor.prototype.lookup_typo_candidate = function (
  this: LateResolutionVisitor,
  path: readonly Segment[],
  following_seg: Segment | undefined,
  ns: Namespace,
  filter_fn: (_0: Res) => boolean,
): TypoCandidate {
  let names: TypoSuggestion[] = [];
  if (path.length === 1) {
    const segment = path[0]!;
    const ctxt: MutRef<SyntaxContext> = { value: Span.ctxt(segment.ident.span) };

    // Search in lexical scope.
    // Walk backwards up the ribs in scope and collect candidates.
    const ribs = this.ribs.index(ns);
    for (let i = ribs.length - 1; i >= 0; i--) {
      const rib = ribs[i]!;
      const rib_ctxt = RibKind.contains_params(rib.kind) ? SyntaxContext.normalize_to_macros_2_0(ctxt.value) : SyntaxContext.normalize_to_macro_rules(ctxt.value);

      // Locals and type parameters
      for (const [ident, res] of rib.bindings) {
        if (filter_fn(res) && Span.ctxt(ident.span) === rib_ctxt) {
          names.push(TypoSuggestion.new(ident.name, ident.span, res));
        }
      }

      if (rib.kind.$ === "Block" && rib.kind._0 !== undefined) {
        const module = rib.kind._0;
        this.r.add_module_candidates(module.to_module(), names, filter_fn, ctxt.value);
      } else if (rib.kind.$ === "Module") {
        const module = rib.kind._0;
        // Encountered a module item, abandon ribs and look into that module and preludes.
        const parent_scope = new ParentScope(module.to_module(), this.parent_scope.expansion, this.parent_scope.macro_rules, this.parent_scope.derives);
        this.r.add_scope_set_candidates(names, { $: "All", _0: ns }, parent_scope, Span.with_ctxt(segment.ident.span, ctxt.value), filter_fn);
        break;
      }

      if (rib.kind.$ === "MacroDefinition" && DefId_eq(rib.kind._0, this.r.macro_def(ctxt.value))) {
        // If an invocation of this macro created `ident`, give up on `ident`
        // and switch to `ident`'s source from the macro definition.
        SyntaxContext.remove_mark(ctxt);
      }
    }
  } else {
    // Search in module.
    const mod_path = path.slice(0, path.length - 1);
    const r = this.resolve_path(mod_path, "TypeNS", undefined, PathSource.Type);
    if (r.$ === "Module" && r._0.$ === "Module") {
      const module = r._0._0;
      this.r.add_module_candidates(module, names, filter_fn, undefined);
    }
  }

  // if next_seg is present, let's filter everything that does not continue the path
  if (following_seg !== undefined) {
    names = names.filter((suggestion) => {
      const res = suggestion.res;
      if (res.$ === "Def" && (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union")) {
        // FIXME: this is not totally accurate, but mostly works
        return suggestion.candidate !== following_seg.ident.name;
      } else if (res.$ === "Def" && res._0.$ === "Mod") {
        const module = this.r.expect_module(res._1);
        return [...this.r.resolutions(module).keys()].some((key) => key.ident.name === following_seg.ident.name);
      }
      return true;
    });
  }
  const name = unwrap(path[path.length - 1]).ident.name;
  // Make sure error reporting is deterministic.
  names.sort((a, b) => str_cmp(Symbol.as_str(a.candidate), Symbol.as_str(b.candidate)));

  const found = find_best_match_for_name(
    names.map((suggestion) => suggestion.candidate),
    name,
    undefined,
  );
  if (found !== undefined) {
    const sugg = names.find((suggestion) => suggestion.candidate === found);
    if (sugg === undefined) {
      return TypoCandidate.None;
    }
    if (found === name) {
      return { $: "Shadowed", _0: sugg.res, _1: sugg.span };
    } else {
      return { $: "Typo", _0: sugg };
    }
  }
  return TypoCandidate.None;
};

// Returns the name of the Rust type approximately corresponding to
// a type name in another programming language.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3174 likely_rust_type
LateResolutionVisitor.likely_rust_type = function (path: readonly Segment[]): Symbol | undefined {
  const name = unwrap(path[path.length - 1]).ident.as_str();
  // Common Java types
  switch (name) {
    case "byte":
      return sym.u8; // In Java, bytes are signed, but in practice one almost always wants unsigned bytes.
    case "short":
      return sym.i16;
    case "Bool":
      return sym.bool;
    case "Boolean":
      return sym.bool;
    case "boolean":
      return sym.bool;
    case "int":
      return sym.i32;
    case "long":
      return sym.i64;
    case "float":
      return sym.f32;
    case "double":
      return sym.f64;
    default:
      return undefined;
  }
};

// try to give a suggestion for this pattern: `name = blah`, which is common in other languages
// suggest `let name = blah` to introduce a new binding
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3193 let_binding_suggestion
LateResolutionVisitor.prototype.let_binding_suggestion = function (this: LateResolutionVisitor, err: Diag, ident_span: Span): boolean {
  if (Span.from_expansion(ident_span)) {
    return false;
  }

  // only suggest when the code is a assignment without prefix code
  const in_assignment = this.diag_metadata.in_assignment;
  if (in_assignment !== undefined && in_assignment.kind.$ === "Assign") {
    const lhs = in_assignment.kind._0;
    if (lhs.kind.$ === "Path" && lhs.kind._0 === undefined && this.r.tcx_.sess.source_map().is_line_before_span_empty(ident_span)) {
      const path = lhs.kind._1;
      let span: Span;
      let text: string;
      const seg = path.segments[0];
      const ident_str = seg?.ident.as_str();
      if (seg !== undefined && ident_str!.startsWith("let")) {
        const name_ = ident_str!.slice("let".length);
        // a special case for #117894
        const name = name_.startsWith("_") ? name_.slice(1) : name_;
        [span, text] = [ident_span, `let ${name}`];
      } else {
        [span, text] = [Span.shrink_to_lo(ident_span), "let "];
      }

      err.span_suggestion_verbose(span, "you might have meant to introduce a new binding", text, Applicability.MaybeIncorrect);
      return true;
    }
  }

  // a special case for #133713
  // '=' maybe a typo of `:`, which is a type annotation instead of assignment
  const current_let_binding = this.diag_metadata.current_let_binding;
  if (err.deref().code === E0423 && current_let_binding !== undefined && current_let_binding[1] === undefined && current_let_binding[2] !== undefined) {
    const [let_span, , val_span] = current_let_binding;
    if (Span.contains(val_span, ident_span) && Span.lo(val_span) === Span.lo(ident_span)) {
      err.span_suggestion_verbose(
        Span.to(Span.shrink_to_hi(let_span), Span.shrink_to_lo(val_span)),
        "you might have meant to use `:` for type annotation",
        ": ",
        Applicability.MaybeIncorrect,
      );
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3239 find_module
LateResolutionVisitor.prototype.find_module = function (this: LateResolutionVisitor, def_id: DefId): [Module, ImportSuggestion] | undefined {
  let result: [Module, ImportSuggestion] | undefined = undefined;
  const seen_modules = new KeyedSet<DefId>(DefId_key);
  const worklist: [Module, PathSegment[], boolean][] = [[this.r.graph_root.to_module(), [], true]];

  for (;;) {
    const popped = worklist.pop();
    if (popped === undefined) break;
    const [in_module, path_segments, doc_visible] = popped;
    // abort if the module is already found
    if (result !== undefined) {
      break;
    }

    in_module.for_each_child(this.r, (r, ident, orig_ident_span, _, name_binding) => {
      // abort if the module is already found or if name_binding is private external
      if (result !== undefined || !Visibility.is_visible_locally(name_binding.vis())) {
        return;
      }
      const module_def_id = def_Res.module_like_def_id(name_binding.res());
      if (module_def_id !== undefined) {
        // form the path
        const path_segments_ = path_segments.map(clone_PathSegment);
        path_segments_.push(PathSegment.from_ident(ident.orig(orig_ident_span)));
        const doc_visible_ = doc_visible && (module_def_id.is_local() || !r.tcx_.is_doc_hidden(module_def_id));
        if (DefId_eq(module_def_id, def_id)) {
          const path = new Path(name_binding.span, path_segments_);
          result = [
            r.expect_module(module_def_id),
            {
              did: def_id,
              descr: "module",
              path,
              accessible: true,
              doc_visible: doc_visible_,
              note: undefined,
              via_import: false,
              is_stable: true,
            },
          ];
        } else {
          // add the module to the lookup
          if (!seen_modules.has(module_def_id)) {
            seen_modules.add(module_def_id);
            const module = r.expect_module(module_def_id);
            worklist.push([module, path_segments_, doc_visible_]);
          }
        }
      }
    });
  }

  return result;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3290 collect_enum_ctors
LateResolutionVisitor.prototype.collect_enum_ctors = function (this: LateResolutionVisitor, def_id: DefId): [Path, DefId, CtorKind][] | undefined {
  const found = this.find_module(def_id);
  if (found === undefined) return undefined;
  const [enum_module, enum_import_suggestion] = found;
  const variants: [Path, DefId, CtorKind][] = [];
  enum_module.for_each_child(this.r, (_, ident, orig_ident_span, _ns, name_binding) => {
    const res = name_binding.res();
    if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Variant") {
      const kind = res._0._1;
      const def_id = res._1;
      const segms = enum_import_suggestion.path.segments.map(clone_PathSegment);
      segms.push(PathSegment.from_ident(ident.orig(orig_ident_span)));
      const path = new Path(name_binding.span, segms);
      variants.push([path, def_id, kind]);
    }
  });
  return variants;
};

/// Adds a suggestion for using an enum's variant when an enum is used instead.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3306 suggest_using_enum_variant
LateResolutionVisitor.prototype.suggest_using_enum_variant = function (this: LateResolutionVisitor, err: Diag, source: PathSource, def_id: DefId, span: Span): void {
  const variant_ctors = this.collect_enum_ctors(def_id);
  if (variant_ctors === undefined) {
    err.note("you might have meant to use one of the enum's variants");
    return;
  }

  // If the expression is a field-access or method-call, try to find a variant with the field/method name
  // that could have been intended, and suggest replacing the `.` with `::`.
  // Otherwise, suggest adding `::VariantName` after the enum;
  // and if the expression is call-like, only suggest tuple variants.
  let suggest_path_sep_dot_span: Span | undefined;
  let suggest_only_tuple_variants: boolean;
  if (source.$ === "TupleStruct") {
    // `Type(a, b)` in a pattern, only suggest adding a tuple variant after `Type`.
    [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [undefined, true];
  } else if (source.$ === "Expr" && source._0 !== undefined) {
    const expr = source._0;
    const k = expr.kind;
    if (k.$ === "Call") {
      // `Type(a, b)`, only suggest adding a tuple variant after `Type`.
      [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [undefined, true];
    } else if (k.$ === "MethodCall") {
      // `Type.Foo(a, b)`, suggest replacing `.` -> `::` if variant `Foo` exists and is a tuple variant,
      // otherwise suggest adding a variant after `Type`.
      const { receiver, span, seg } = k._0;
      const ident = seg.ident;
      const dot_span = Span.between(receiver.span, span);
      const found_tuple_variant = variant_ctors.some(([path, _, ctor_kind]) => {
        const last = path.segments[path.segments.length - 1];
        return ctor_kind === "Fn" && last !== undefined && last.ident.eq(ident);
      });
      [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [found_tuple_variant ? dot_span : undefined, false];
    } else if (k.$ === "Field") {
      // `Type.Foo`, suggest replacing `.` -> `::` if variant `Foo` exists and is a unit or tuple variant,
      // otherwise suggest adding a variant after `Type`.
      const [base, ident] = [k._0, k._1];
      const dot_span = Span.between(base.span, ident.span);
      const found_tuple_or_unit_variant = variant_ctors.some(([path]) => {
        const last = path.segments[path.segments.length - 1];
        return last !== undefined && last.ident.eq(ident);
      });
      [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [found_tuple_or_unit_variant ? dot_span : undefined, false];
    } else {
      [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [undefined, false];
    }
  } else {
    [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [undefined, false];
  }

  if (suggest_path_sep_dot_span !== undefined) {
    const dot_span = suggest_path_sep_dot_span;
    err.span_suggestion_verbose(dot_span, "use the path separator to refer to a variant", "::", Applicability.MaybeIncorrect);
  } else if (suggest_only_tuple_variants) {
    // Suggest only tuple variants regardless of whether they have fields and do not
    // suggest path with added parentheses.
    const suggestable_variants = variant_ctors.filter(([, , kind]) => kind === "Fn").map(([variant]) => path_names_to_string(variant));
    suggestable_variants.sort(str_cmp);

    const non_suggestable_variant_count = variant_ctors.length - suggestable_variants.length;

    const source_msg = source.$ === "TupleStruct" ? "to match against" : "to construct";

    if (suggestable_variants.length !== 0) {
      const msg =
        non_suggestable_variant_count === 0 && suggestable_variants.length === 1
          ? `try ${source_msg} the enum's variant`
          : `try ${source_msg} one of the enum's variants`;

      err.span_suggestions(span, msg, suggestable_variants, Applicability.MaybeIncorrect);
    }

    // If the enum has no tuple variants..
    if (non_suggestable_variant_count === variant_ctors.length) {
      err.help(`the enum has no tuple variants ${source_msg}`);
    }

    // If there are also non-tuple variants..
    if (non_suggestable_variant_count === 1) {
      err.help(`you might have meant ${source_msg} the enum's non-tuple variant`);
    } else if (non_suggestable_variant_count >= 1) {
      err.help(`you might have meant ${source_msg} one of the enum's non-tuple variants`);
    }
  } else {
    const needs_placeholder = (ctor_def_id: DefId, kind: CtorKind): boolean => {
      const def_id = this.r.tcx_.parent(ctor_def_id);
      switch (kind) {
        case "Const":
          return false;
        case "Fn": {
          const field_ids = this.r.field_idents(def_id);
          return !(field_ids !== undefined && field_ids.length === 0);
        }
      }
    };

    const suggestable_variants = variant_ctors
      .filter(([_, def_id, kind]) => !needs_placeholder(def_id, kind))
      .map(([variant, _, kind]): [string, CtorKind] => [path_names_to_string(variant), kind])
      .map(([variant, kind]) => {
        switch (kind) {
          case "Const":
            return variant;
          case "Fn":
            return `(${variant}())`;
        }
      });
    suggestable_variants.sort(str_cmp);
    const no_suggestable_variant = suggestable_variants.length === 0;

    if (!no_suggestable_variant) {
      const msg = suggestable_variants.length === 1 ? "you might have meant to use the following enum variant" : "you might have meant to use one of the following enum variants";

      err.span_suggestions(span, msg, suggestable_variants, Applicability.MaybeIncorrect);
    }

    const suggestable_variants_with_placeholders = variant_ctors
      .filter(([_, def_id, kind]) => needs_placeholder(def_id, kind))
      .map(([variant, _, kind]): [string, CtorKind] => [path_names_to_string(variant), kind])
      .flatMap(([variant, kind]) => (kind === "Fn" ? [`(${variant}(/* fields */))`] : []));
    suggestable_variants_with_placeholders.sort(str_cmp);

    if (suggestable_variants_with_placeholders.length !== 0) {
      let msg: string;
      const n = suggestable_variants_with_placeholders.length;
      if (no_suggestable_variant && n === 1) {
        msg = "the following enum variant is available";
      } else if (no_suggestable_variant) {
        msg = "the following enum variants are available";
      } else if (n === 1) {
        msg = "alternatively, the following enum variant is available";
      } else {
        msg = "alternatively, the following enum variants are also available";
      }

      err.span_suggestions(span, msg, suggestable_variants_with_placeholders, Applicability.HasPlaceholders);
    }
  }

  if (def_id.is_local()) {
    err.span_note(this.r.def_span(def_id), "the enum is defined here");
  }
};

/// Detects missing const parameters in `impl` blocks and suggests adding them.
///
/// When a const parameter is used in the self type of an `impl` but not declared
/// in the `impl`'s own generic parameter list, this function emits a targeted
/// diagnostic with a suggestion to add it at the correct position.
///
/// Example:
///
/// ```rust,ignore (suggested field is not completely correct, it should be a single suggestion)
/// struct C<const A: u8, const X: u8, const P: u32>;
///
/// impl Foo for C<A, X, P> {}
/// //           ^ the struct `C` in `C<A, X, P>` is used as the self type
/// //             ^ ^ ^ but A, X and P are not declared on the impl
///
/// Suggested fix:
///
/// impl<const A: u8, const X: u8, const P: u32> Foo for C<A, X, P> {}
///
/// Current behavior (suggestions are emitted one-by-one):
///
/// impl<const A: u8> Foo for C<A, X, P> {}
/// impl<const X: u8> Foo for C<A, X, P> {}
/// impl<const P: u32> Foo for C<A, X, P> {}
///
/// Ideally the suggestion should aggregate them into a single line:
///
/// impl<const A: u8, const X: u8, const P: u32> Foo for C<A, X, P> {}
/// ```
///
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3514 detect_and_suggest_const_parameter_error
LateResolutionVisitor.prototype.detect_and_suggest_const_parameter_error = function (
  this: LateResolutionVisitor,
  path: readonly Segment[],
  source: PathSource,
): Diag | undefined {
  const item = this.diag_metadata.current_item;
  if (item === undefined) return undefined;
  if (item.kind.$ !== "Impl") return undefined;
  const impl_ = item.kind._0;
  const self_ty = impl_.self_ty;

  // Represents parameter to the struct whether `A`, `X` or `P`
  if (path.length !== 1) {
    return undefined;
  }
  const current_parameter = path[0]!;

  const target_ident = current_parameter.ident;

  // Find the parent segment i.e `C` in `C<A, X, C>`
  const visitor = ParentPathVisitor.new(self_ty, target_ident);

  const parent_segment = visitor.parent;
  if (parent_segment === undefined) {
    return undefined;
  }

  const args = parent_segment.args;
  if (args === undefined) {
    return undefined;
  }

  if (args.$ !== "AngleBracketed") {
    return undefined;
  }
  const angle = args._0;

  // Build map: NodeId of each usage in C<A, X, C> -> its position
  // e.g NodeId(A) -> 0, NodeId(X) -> 1, NodeId(C) -> 2
  const usage_to_pos = new Map<NodeId, number>();
  angle.args.forEach((arg, pos) => {
    if (arg.$ === "Arg" && arg._0.$ === "Type") {
      const ty = arg._0._0;
      if (ty.kind.$ === "Path" && ty.kind._1.segments.length === 1) {
        const segment = ty.kind._1.segments[0]!;
        usage_to_pos.set(segment.id, pos);
      }
    }
  });

  // Get the position of the missing param in C<A, X, C>
  // e.g for missing `B` in `C<A, B, C>` this gives idx=1
  const idx = current_parameter.id === undefined ? undefined : usage_to_pos.get(current_parameter.id);
  if (idx === undefined) {
    return undefined;
  }

  // Now resolve the parent struct `C` to get its definition
  const ns = PathSource.namespace(source);
  const segment = Segment.from(parent_segment);
  const segments = [segment];
  const finalize = Finalize.new(parent_segment.id, parent_segment.ident.span);

  found: {
    const r = this.resolve_qpath_anywhere(undefined, segments, ns, PathSource.defer_to_typeck(source), finalize, source);
    if (r.$ !== "Ok" || r._0 === undefined) break found;
    const resolve = r._0.full_res();
    if (resolve === undefined) break found;
    if (resolve.$ !== "Def") break found;
    const def_id = resolve._1;
    if (!def_id.is_local()) break found;
    const local_def_id = def_id.as_local();
    if (local_def_id === undefined) break found;
    const struct_generics = this.r.struct_generics.get(local_def_id);
    if (struct_generics === undefined) break found;
    const target_param = struct_generics.params[idx];
    if (target_param === undefined) break found;
    if (target_param.kind.$ !== "Const") break found;
    const ty = target_param.kind.ty;
    if (ty.kind.$ !== "Path") break found;
    const path = ty.kind._1;

    const full_type = path.segments.map((seg) => display_Ident(seg.ident)).join("::");

    // Find the first impl param whose position in C<A, X, C>
    // is strictly greater than our missing param's index
    // e.g missing B(idx=1), impl has A(pos=0) and C(pos=2)
    // C has pos=2 > 1 so insert before C
    const next_impl_param = impl_.generics.params.find((impl_param) => {
      let pos: number | undefined = undefined;
      for (const arg of angle.args) {
        if (arg.$ === "Arg" && arg._0.$ === "Type") {
          const ty = arg._0._0;
          if (ty.kind.$ === "Path" && ty.kind._1.segments.length === 1) {
            const segment = ty.kind._1.segments[0]!;
            if (segment.ident.eq(impl_param.ident)) {
              pos = usage_to_pos.get(segment.id);
              if (pos !== undefined) break;
            }
          }
        }
      }
      return pos !== undefined && pos > idx;
    });

    let insert_span: Span;
    let snippet: string;
    if (next_impl_param !== undefined) {
      // Insert in the middle before next_param
      // e.g impl<A, C> -> impl<A, const B: u8, C>
      [insert_span, snippet] = [Span.shrink_to_lo(next_impl_param.span()), `const ${display_Ident(target_ident)}: ${full_type}, `];
    } else {
      const last = impl_.generics.params[impl_.generics.params.length - 1];
      if (last !== undefined) {
        // Append after last existing param
        // e.g impl<A, B> -> impl<A, B, const C: u8>
        [insert_span, snippet] = [Span.shrink_to_hi(last.span()), `, const ${display_Ident(target_ident)}: ${full_type}`];
      } else {
        // No generics at all on impl
        // e.g impl Foo for C<A> -> impl<const A: u8> Foo for C<A>
        [insert_span, snippet] = [Span.shrink_to_hi(impl_.generics.span), `<const ${display_Ident(target_ident)}: ${full_type}>`];
      }
    }

    const err = this.r.dcx().struct_span_err(target_ident.span, `cannot find const \`${display_Ident(target_ident)}\` in this scope`);

    err.code(E0425);

    err.span_label(target_ident.span, "not found in this scope");

    err.span_label(target_param.span(), "corresponding const parameter on the type defined here");

    err.subdiagnostic(
      diagnostics.UnexpectedMissingConstParameter_subdiagnostic({
        span: insert_span,
        snippet,
        item_name: display_Ident(target_ident),
        item_location: "impl",
      }),
    );

    return err;
  }

  return undefined;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3676 suggest_adding_generic_parameter
LateResolutionVisitor.prototype.suggest_adding_generic_parameter = function (
  this: LateResolutionVisitor,
  path: readonly Segment[],
  source: PathSource,
): [[Span, string, string, Applicability] | undefined, Diag | undefined] {
  let ident: string;
  let span: Span;
  const segment = path.length === 1 ? path[0]! : undefined;
  if (segment !== undefined && !segment.has_generic_args && segment.ident.name !== kw.SelfUpper && segment.ident.name !== kw.Dyn) {
    [ident, span] = [display_Ident(segment.ident), segment.ident.span];
  } else {
    return [undefined, undefined];
  }
  // `let mut iter = ident.chars().map(|c| c.is_uppercase());`
  const chars = [...ident].map((c) => c.codePointAt(0)!);
  const single_uppercase_char = chars.length >= 1 && is_uppercase(chars[0]!) && chars.length === 1;
  if (!this.diag_metadata.currently_processing_generic_args && !single_uppercase_char) {
    return [undefined, undefined];
  }
  const current_item = this.diag_metadata.current_item;
  const currently_processing_generic_args = this.diag_metadata.currently_processing_generic_args;
  if (current_item !== undefined && current_item.kind.$ === "Fn" && current_item.kind._0.ident.name === sym.main) {
    // Ignore `fn main()` as we don't want to suggest `fn main<T>()`
  } else if (current_item !== undefined && Span.in_derive_expansion(current_item.span)) {
    return [undefined, undefined];
  } else if (
    current_item !== undefined &&
    (((current_item.kind.$ === "Fn" || current_item.kind.$ === "Enum" || current_item.kind.$ === "Struct" || current_item.kind.$ === "Union") &&
      single_uppercase_char) ||
      // Without the 2nd `true`, we'd suggest `impl <T>` for `impl T` when a type `T` isn't found
      (current_item.kind.$ === "Impl" && single_uppercase_char && currently_processing_generic_args) ||
      !single_uppercase_char)
  ) {
    const kind = current_item.kind;
    const generics = ItemKind.generics(kind);
    if (generics !== undefined) {
      if (Span.overlaps(span, generics.span)) {
        // Avoid the following:
        // error[E0405]: cannot find trait `A` in this scope
        //  --> $DIR/typo-suggestion-named-underscore.rs:CC:LL
        //   |
        // L | fn foo<T: A>(x: T) {} // Shouldn't suggest underscore
        //   |           ^- help: you might be missing a type parameter: `, A`
        //   |           |
        //   |           not found in this scope
        return [undefined, undefined];
      }

      let msg: string;
      let sugg: string;
      if (source.$ === "Type" || (source.$ === "PreciseCapturingArg" && source._0 === "TypeNS")) {
        const err = this.detect_and_suggest_const_parameter_error(path, source);
        if (err !== undefined) {
          return [undefined, err];
        }
        [msg, sugg] = ["you might be missing a type parameter", ident];
      } else if (source.$ === "Expr" || (source.$ === "PreciseCapturingArg" && source._0 === "ValueNS")) {
        [msg, sugg] = ["you might be missing a const parameter", `const ${ident}: /* Type */`];
      } else {
        return [undefined, undefined];
      }
      let span_: Span;
      let sugg_: string;
      const param = generics.params[generics.params.length - 1];
      if (param !== undefined) {
        let span: Span;
        const bound = param.bounds[param.bounds.length - 1];
        if (bound !== undefined) {
          span = GenericBound.span(bound);
        } else if (param.kind.$ === "Const") {
          const { ty, default: default_ } = param.kind;
          span = default_ !== undefined ? default_.value.span : ty.span;
        } else {
          span = param.ident.span;
        }
        [span_, sugg_] = [span, `, ${sugg}`];
      } else {
        [span_, sugg_] = [generics.span, `<${sugg}>`];
      }
      // Do not suggest if this is coming from macro expansion.
      if (Span.can_be_used_for_suggestions(span_)) {
        return [[Span.shrink_to_hi(span_), msg, sugg_, Applicability.MaybeIncorrect], undefined];
      }
    }
  } else {
    // _ => {}
  }
  return [undefined, undefined];
};

/// Given the target `label`, search the `rib_index`th label rib for similarly named labels,
/// optionally returning the closest match and whether it is reachable.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3783 suggestion_for_label_in_rib
LateResolutionVisitor.prototype.suggestion_for_label_in_rib = function (this: LateResolutionVisitor, rib_index: number, label: Ident): LabelSuggestion | undefined {
  // Are ribs from this `rib_index` within scope?
  const within_scope = this.is_label_valid_from_rib(rib_index);

  const rib = unwrap(this.label_ribs[rib_index]);
  const names = [...rib.bindings]
    .filter(([id, _]) => Span.eq_ctxt(id.span, label.span))
    .map(([id, _]) => id.name);

  const symbol = find_best_match_for_name(names, label.name, undefined);
  if (symbol === undefined) return undefined;
  // Upon finding a similar name, get the ident that it was from - the span
  // contained within helps make a useful diagnostic. In addition, determine
  // whether this candidate is within scope.
  const [ident, _] = unwrap([...rib.bindings].find(([ident, _]) => ident.name === symbol));
  return [ident, within_scope];
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3808 maybe_report_lifetime_uses
LateResolutionVisitor.prototype.maybe_report_lifetime_uses = function (this: LateResolutionVisitor, generics_span: Span, params: readonly GenericParam[]): void {
  for (let param_index = 0; param_index < params.length; param_index++) {
    const param = params[param_index]!;
    if (param.kind.$ !== "Lifetime") continue;

    const def_id = this.r.local_def_id(param.id);

    const use_set = this.lifetime_uses.get(def_id);
    this.lifetime_uses.delete(def_id);
    // debug!(
    //     "Use set for {:?}({:?} at {:?}) is {:?}",
    //     def_id, param.ident, param.ident.span, use_set
    // );

    const deletion_span = (): Span | undefined => {
      if (params.length === 1) {
        // if sole lifetime, remove the entire `<>` brackets
        return generics_span;
      } else if (param_index === 0) {
        // if removing within `<>` brackets, we also want to
        // delete a leading or trailing comma as appropriate
        const param_span = Span.find_ancestor_inside(param.span(), generics_span);
        const next_param_span = Span.find_ancestor_inside(unwrap(params[param_index + 1]).span(), generics_span);
        if (param_span !== undefined && next_param_span !== undefined) {
          return Span.to(param_span, Span.shrink_to_lo(next_param_span));
        }
        return undefined;
      } else {
        // if removing within `<>` brackets, we also want to
        // delete a leading or trailing comma as appropriate
        const param_span = Span.find_ancestor_inside(param.span(), generics_span);
        const prev_param_span = Span.find_ancestor_inside(unwrap(params[param_index - 1]).span(), generics_span);
        if (param_span !== undefined && prev_param_span !== undefined) {
          return Span.to(Span.shrink_to_hi(prev_param_span), param_span);
        }
        return undefined;
      }
    };
    if (use_set !== undefined && use_set.$ === "Many") {
      // nothing
    } else if (use_set !== undefined && use_set.$ === "One" && param.bounds.length !== 0) {
      // A lifetime bound is a real use of that lifetime parameter, even
      // though visiting a bound like `'b: 'a` only records a use of `'a`.
    } else if (use_set !== undefined && use_set.$ === "One") {
      const { use_span, use_ctxt } = use_set;
      const param_ident = param.ident;
      const deletion_span_ = param.bounds.length === 0 ? deletion_span() : undefined;
      this.r.lint_buffer_.dyn_buffer_lint_any(SINGLE_USE_LIFETIMES, param.id, param_ident.span, (dcx, level, sess) => {
        // debug!(?param_ident, ?param_ident.span, ?use_span);

        const elidable = use_ctxt === "Ref";
        let suggestion: diagnostics.SingleUseLifetimeSugg | undefined;
        if (deletion_span_ !== undefined) {
          let use_span_: Span;
          let replace_lt: string;
          if (elidable) {
            const use_span__ = (sess instanceof Session ? sess : panic("expected a `Session`")).source_map().span_extend_while_whitespace(use_span);
            [use_span_, replace_lt] = [use_span__, ""];
          } else {
            [use_span_, replace_lt] = [use_span, "'_"];
          }
          // debug!(?deletion_span, ?use_span);

          // issue 107998 for the case such as a wrong function pointer type
          // `deletion_span` is empty and there is no need to report lifetime uses here
          const deletion_span__ = Span.is_empty(deletion_span_) ? undefined : deletion_span_;
          suggestion = {
            deletion_span: deletion_span__,
            use_span: use_span_,
            replace_lt,
          };
        } else {
          suggestion = undefined;
        }
        return diagnostics.SingleUseLifetime_into_diag(
          {
            suggestion,
            param_span: param_ident.span,
            use_span,
            ident: param_ident,
          },
          dcx,
          level,
        );
      });
    } else {
      // None
      // debug!(?param.ident, ?param.ident.span);
      const deletion_span_ = deletion_span();

      // if the lifetime originates from expanded code, we won't be able to remove it #104432
      if (deletion_span_ !== undefined && !Span.in_derive_expansion(deletion_span_)) {
        this.r.lint_buffer_.buffer_lint(
          UNUSED_LIFETIMES,
          param.id,
          param.ident.span,
          diagnostics.UnusedLifetime_diagnostic({ deletion_span: deletion_span_, ident: param.ident }),
        );
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3927 emit_undeclared_lifetime_error
LateResolutionVisitor.prototype.emit_undeclared_lifetime_error = function (
  this: LateResolutionVisitor,
  lifetime_ref: Lifetime,
  outer_lifetime_ref: Ident | undefined,
): ErrorGuaranteed {
  // debug_assert_ne!(lifetime_ref.ident.name, kw::UnderscoreLifetime);
  let err: Diag;
  if (outer_lifetime_ref !== undefined) {
    const outer = outer_lifetime_ref;
    err = struct_span_code_err(this.r.dcx(), lifetime_ref.ident.span, E0401, "can't use generic parameters from outer item")
      .with_span_label(lifetime_ref.ident.span, "use of generic parameter from outer item")
      .with_span_label(outer.span, "lifetime parameter from outer item");
  } else {
    err = struct_span_code_err(this.r.dcx(), lifetime_ref.ident.span, E0261, `use of undeclared lifetime name \`${display_Ident(lifetime_ref.ident)}\``).with_span_label(
      lifetime_ref.ident.span,
      "undeclared lifetime",
    );
  }

  // Check if this is a typo of `'static`.
  if (edit_distance(Symbol.as_str(lifetime_ref.ident.name), "'static", 2) !== undefined) {
    err.span_suggestion_verbose(lifetime_ref.ident.span, "you may have misspelled the `'static` lifetime", "'static", Applicability.MachineApplicable);
  } else {
    this.suggest_introducing_lifetime(err, lifetime_ref.ident, (err, _, span, message, suggestion, span_suggs) => {
      err.multipart_suggestion(message, [[span, suggestion] as [Span, string], ...span_suggs], Applicability.MaybeIncorrect);
      return true;
    });
  }

  return err.emit_err();
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3979 suggest_introducing_lifetime
LateResolutionVisitor.prototype.suggest_introducing_lifetime = function (
  this: LateResolutionVisitor,
  err: Diag,
  name: Ident | undefined,
  suggest: (_0: Diag, _1: boolean, _2: Span, _3: string, _4: string, _5: [Span, string][]) => boolean,
): void {
  this.suggest_introducing_lifetime_filtered(err, name, (_) => true, suggest);
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:3995 suggest_introducing_lifetime_for_assoc_ty_binding
LateResolutionVisitor.prototype.suggest_introducing_lifetime_for_assoc_ty_binding = function (this: LateResolutionVisitor, err: Diag, lifetime: Span): void {
  this.suggest_introducing_lifetime_filtered(
    err,
    undefined,
    (kind) => !(kind === "FnPtrType" || kind === "PolyTrait" || kind === "WhereBound"),
    (err, _higher_ranked, span, message, intro_sugg, _) => {
      err.multipart_suggestion(
        message,
        [
          [span, intro_sugg],
          [Span.shrink_to_hi(lifetime), "'a "],
        ],
        Applicability.MaybeIncorrect,
      );
      return false;
    },
  );
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4022 suggest_introducing_lifetime_filtered
LateResolutionVisitor.prototype.suggest_introducing_lifetime_filtered = function (
  this: LateResolutionVisitor,
  err: Diag,
  name: Ident | undefined,
  consider: (_0: LifetimeBinderKind) => boolean,
  suggest: (_0: Diag, _1: boolean, _2: Span, _3: string, _4: string, _5: [Span, string][]) => boolean,
): void {
  let suggest_note = true;
  for (let i = this.lifetime_ribs.length - 1; i >= 0; i--) {
    const rib = this.lifetime_ribs[i]!;
    let should_continue = true;
    const rk = rib.kind;
    if (rk.$ === "Generics") {
      const { binder, span, kind } = rk;
      // Avoid suggesting placing lifetime parameters on constant items unless the relevant
      // feature is enabled. Suggest the parent item as a possible location if applicable.
      if (kind === "ConstItem" && !this.r.tcx().features().generic_const_items()) {
        continue;
      }
      if (kind === "ImplAssocType" || !consider(kind)) {
        continue;
      }

      if (!Span.can_be_used_for_suggestions(span) && suggest_note && name !== undefined) {
        suggest_note = false; // Avoid displaying the same help multiple times.
        err.span_label(span, `lifetime \`${display_Ident(name)}\` is missing in item created through this procedural macro`);
        continue;
      }

      const higher_ranked = kind === "FnPtrType" || kind === "PolyTrait" || kind === "WhereBound";

      const rm_inner_binders: Set<Span> = new Set();
      let span_: Span;
      let sugg: string;
      if (Span.is_empty(span)) {
        const binder_idents: Set<Ident> = new KeyedSet<Ident>(Ident_key);
        binder_idents.add(name ?? Ident.from_str("'a"));

        // We need to special case binders in the following situation:
        // Change `T: for<'a> Trait<T> + 'b` to `for<'a, 'b> T: Trait<T> + 'b`
        // T: for<'a> Trait<T> + 'b
        //    ^^^^^^^  remove existing inner binder `for<'a>`
        // for<'a, 'b> T: Trait<T> + 'b
        // ^^^^^^^^^^^  suggest outer binder `for<'a, 'b>`
        const predicate = this.diag_metadata.current_where_predicate;
        if (kind === "WhereBound" && predicate !== undefined && predicate.kind.$ === "BoundPredicate" && predicate.kind._0.bounded_ty.id === binder) {
          const { bounds } = predicate.kind._0;
          for (const bound of bounds) {
            if (bound.$ === "Trait") {
              const poly_trait_ref = bound._0;
              const span = Span.with_hi(poly_trait_ref.span, Span.lo(poly_trait_ref.trait_ref.path.span));
              if (!Span.is_empty(span)) {
                rm_inner_binders.add(span);
                poly_trait_ref.bound_generic_params.forEach((v) => {
                  binder_idents.add(v.ident);
                });
              }
            }
          }
        }

        const binders_sugg: string = [...binder_idents].map((ident) => display_Ident(ident)).join(", ");
        const sugg_ = `${higher_ranked ? "for" : ""}<${binders_sugg}>${higher_ranked ? " " : ""}`;
        [span_, sugg] = [span, sugg_];
      } else {
        const span__ = Span.shrink_to_hi(this.r.tcx_.sess.source_map().span_through_char(span, ch("<")));
        const sugg_ = `${name !== undefined ? display_Ident(name) : "'a"}, `;
        [span_, sugg] = [span__, sugg_];
      }

      if (higher_ranked) {
        const message = `consider making the ${LifetimeBinderKind.descr(kind)} lifetime-generic with a new \`${name !== undefined ? display_Ident(name) : "'a"}\` lifetime`;
        should_continue = suggest(
          err,
          true,
          span_,
          message,
          sugg,
          rm_inner_binders.size !== 0 ? [...rm_inner_binders].map((v): [Span, string] => [v, ""]) : [],
        );
        err.note_once("for more information on higher-ranked polymorphism, visit https://doc.rust-lang.org/nomicon/hrtb.html");
      } else if (name !== undefined) {
        const message = `consider introducing lifetime \`${display_Ident(name)}\` here`;
        should_continue = suggest(err, false, span_, message, sugg, []);
      } else {
        const message = "consider introducing a named lifetime parameter";
        should_continue = suggest(err, false, span_, message, sugg, []);
      }
    } else if (rk.$ === "Item" || rk.$ === "ConstParamTy") {
      break;
    } else {
      // _ => {}
    }
    if (!should_continue) {
      break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4174 emit_non_static_lt_in_const_param_ty_error
LateResolutionVisitor.prototype.emit_non_static_lt_in_const_param_ty_error = function (this: LateResolutionVisitor, lifetime_ref: Lifetime): ErrorGuaranteed {
  return this.r.dcx().emit_err(
    diagnostics.ParamInTyOfConstParam_diagnostic({
      span: lifetime_ref.ident.span,
      name: lifetime_ref.ident.name,
    }),
  );
};

/// Non-static lifetimes are prohibited in anonymous constants under `min_const_generics`.
/// This function will emit an error if `generic_const_exprs` is not enabled, the body identified by
/// `body_id` is an anonymous constant and `lifetime_ref` is non-static.
// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4187 emit_forbidden_non_static_lifetime_error
LateResolutionVisitor.prototype.emit_forbidden_non_static_lifetime_error = function (
  this: LateResolutionVisitor,
  cause: NoConstantGenericsReason,
  lifetime_ref: Lifetime,
): ErrorGuaranteed {
  switch (cause) {
    case "IsEnumDiscriminant":
      return this.r.dcx().emit_err(
        diagnostics.ParamInEnumDiscriminant_diagnostic({
          span: lifetime_ref.ident.span,
          name: lifetime_ref.ident.name,
          param_kind: diagnostics.ParamKindInEnumDiscriminant.Lifetime,
        }),
      );
    case "NonTrivialConstArg":
      assert(!this.r.features.generic_const_exprs(), "assertion failed: !self.r.features.generic_const_exprs()");
      return this.r.dcx().emit_err(
        diagnostics.ParamInNonTrivialAnonConst_diagnostic({
          span: lifetime_ref.ident.span,
          name: lifetime_ref.ident.name,
          param_kind: diagnostics.ParamKindInNonTrivialAnonConst.Lifetime,
          help: this.r.tcx_.sess.is_nightly_build() && !this.r.features.gca(),
          is_gca_const_items: this.r.features.gca_const_items(),
          help_gca: this.r.features.gca_const_items(),
          help_suggest_gca: this.r.tcx_.sess.is_nightly_build() && !this.r.features.gca_const_items(),
        }),
      );
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4216 report_missing_lifetime_specifiers
LateResolutionVisitor.prototype.report_missing_lifetime_specifiers = function (
  this: LateResolutionVisitor,
  lifetime_refs: Iterable<MissingLifetime>,
  function_param_lifetimes: [MissingLifetime[], ElisionFnParameter[]] | undefined,
): ErrorGuaranteed {
  // PORT: `impl Clone + IntoIterator`: the iterator is materialised once, so every `.clone()` re-reads it.
  const lifetime_refs_ = [...lifetime_refs];
  const num_lifetimes: number = lifetime_refs_.reduce((acc, lt) => acc + lt.count, 0);
  const spans: Span[] = lifetime_refs_.map((lt) => lt.span);

  const err = struct_span_code_err(this.r.dcx(), spans, E0106, `missing lifetime specifier${pluralize(num_lifetimes)}`);
  this.add_missing_lifetime_specifiers_label(err, lifetime_refs_, function_param_lifetimes);
  return err.emit_err();
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4239 add_missing_lifetime_specifiers_label
LateResolutionVisitor.prototype.add_missing_lifetime_specifiers_label = function (
  this: LateResolutionVisitor,
  err: Diag,
  lifetime_refs: Iterable<MissingLifetime>,
  function_param_lifetimes: [MissingLifetime[], ElisionFnParameter[]] | undefined,
): void {
  // PORT: `impl Clone + IntoIterator`: the iterator is materialised once, so every `.clone()` re-reads it.
  const lifetime_refs_ = [...lifetime_refs];
  for (const lt of lifetime_refs_) {
    err.span_label(lt.span, `expected ${lt.count === 1 ? "named" : `${lt.count}`} lifetime parameter${pluralize(lt.count)}`);
  }

  let in_scope_lifetimes: [Ident, [NodeId, LifetimeRes]][] = [];
  for (let i = this.lifetime_ribs.length - 1; i >= 0; i--) {
    const rib = this.lifetime_ribs[i]!;
    if (rib.kind.$ === "Item" || rib.kind.$ === "ConstParamTy") break;
    for (const [ident, res] of rib.bindings) {
      if (ident.name !== kw.UnderscoreLifetime) in_scope_lifetimes.push([ident, res]);
    }
  }
  // debug!(?in_scope_lifetimes);

  let maybe_static = false;
  // debug!(?function_param_lifetimes);
  if (function_param_lifetimes !== undefined) {
    const [param_lifetimes, params] = function_param_lifetimes;
    const elided_len = param_lifetimes.length;
    const num_params = params.length;

    let m = "";

    for (let i = 0; i < params.length; i++) {
      const info = params[i]!;
      const { ident, index, lifetime_count, span } = info;
      // debug_assert_ne!(lifetime_count, 0);

      err.span_label(span, "");

      if (i !== 0) {
        if (i + 1 < num_params) {
          m += ", ";
        } else if (num_params === 2) {
          m += " or ";
        } else {
          m += ", or ";
        }
      }

      const help_name = ident !== undefined ? `\`${display_Ident(ident)}\`` : `argument ${index + 1}`;

      if (lifetime_count === 1) {
        m += help_name;
      } else {
        m += `one of ${help_name}'s ${lifetime_count} lifetimes`;
      }
    }

    if (num_params === 0) {
      err.help("this function's return type contains a borrowed value, but there is no value for it to be borrowed from");
      if (in_scope_lifetimes.length === 0) {
        maybe_static = true;
        in_scope_lifetimes = [[Ident.with_dummy_span(kw.StaticLifetime), [DUMMY_NODE_ID, { $: "Static" }]]];
      }
    } else if (elided_len === 0) {
      err.help(
        "this function's return type contains a borrowed value with an elided lifetime, but the lifetime cannot be derived from the arguments",
      );
      if (in_scope_lifetimes.length === 0) {
        maybe_static = true;
        in_scope_lifetimes = [[Ident.with_dummy_span(kw.StaticLifetime), [DUMMY_NODE_ID, { $: "Static" }]]];
      }
    } else if (num_params === 1) {
      err.help(`this function's return type contains a borrowed value, but the signature does not say which ${m} it is borrowed from`);
    } else {
      err.help(`this function's return type contains a borrowed value, but the signature does not say whether it is borrowed from ${m}`);
    }
  }

  // #[allow(rustc::symbol_intern_string_literal)]
  let existing_name: Symbol;
  if (in_scope_lifetimes.length === 0) {
    existing_name = Symbol.intern("'a");
  } else if (in_scope_lifetimes.length === 1) {
    existing_name = in_scope_lifetimes[0]![0].name;
  } else {
    existing_name = Symbol.intern("'lifetime");
  }

  const spans_suggs: [Span, string][] = [];
  const source_map = this.r.tcx_.sess.source_map();
  const build_sugg = (lt: MissingLifetime): [Span, string] => {
    switch (lt.kind as MissingLifetimeKind) {
      case "Underscore":
        // debug_assert_eq!(lt.count, 1);
        return [lt.span, Symbol.as_str(existing_name)];
      case "Ampersand":
        // debug_assert_eq!(lt.count, 1);
        return [Span.shrink_to_hi(lt.span), `${display_Symbol(existing_name)} `];
      case "Comma": {
        const sugg_: string = new Array<string>(lt.count).fill(Symbol.as_str(existing_name)).join(", ");
        const is_empty_brackets = source_map.span_followed_by(lt.span, ">") !== undefined;
        const sugg = is_empty_brackets ? sugg_ : `${sugg_}, `;
        return [Span.shrink_to_hi(lt.span), sugg];
      }
      case "Brackets": {
        const sugg: string = ["<", new Array<string>(lt.count).fill(Symbol.as_str(existing_name)).join(", "), ">"].join("");
        return [Span.shrink_to_hi(lt.span), sugg];
      }
    }
  };
  for (const lt of lifetime_refs_) {
    spans_suggs.push(build_sugg(lt));
  }
  // debug!(?spans_suggs);
  switch (in_scope_lifetimes.length) {
    case 0: {
      if (function_param_lifetimes !== undefined) {
        const [param_lifetimes, _] = function_param_lifetimes;
        for (const lt of param_lifetimes) {
          spans_suggs.push(build_sugg(lt));
        }
      }
      this.suggest_introducing_lifetime(err, undefined, (err, higher_ranked, span, message, intro_sugg, _) => {
        err.multipart_suggestion(message, [[span, intro_sugg] as [Span, string], ...spans_suggs.slice()], Applicability.MaybeIncorrect);
        return higher_ranked;
      });
      break;
    }
    case 1: {
      let post: string;
      if (maybe_static) {
        const lifetime_refs__ = lifetime_refs_[globalThis.Symbol.iterator]();
        const lt = lifetime_refs__.next();
        const owned =
          !lt.done && lifetime_refs__.next().done === true && (lt.value.kind as MissingLifetimeKind) !== "Ampersand"
            ? ", or if you will only have owned values"
            : "";
        post = `, but this is uncommon unless you're returning a borrowed value from a \`const\` or a \`static\`${owned}`;
      } else {
        post = "";
      }
      err.multipart_suggestion(`consider using the \`${display_Symbol(existing_name)}\` lifetime${post}`, spans_suggs, Applicability.MaybeIncorrect);
      if (maybe_static) {
        // FIXME: what follows are general suggestions, but we'd want to perform some
        // minimal flow analysis to provide more accurate suggestions. For example, if
        // we identified that the return expression references only one argument, we
        // would suggest borrowing only that argument, and we'd skip the prior
        // "use `'static`" suggestion entirely.
        const lifetime_refs__ = lifetime_refs_[globalThis.Symbol.iterator]();
        const lt_ = lifetime_refs__.next();
        if (
          !lt_.done &&
          lifetime_refs__.next().done === true &&
          ((lt_.value.kind as MissingLifetimeKind) === "Ampersand" || (lt_.value.kind as MissingLifetimeKind) === "Underscore")
        ) {
          const lt = lt_.value;
          const lt_kind = lt.kind as MissingLifetimeKind;
          const current_function = this.diag_metadata.current_function;
          let pre: string;
          // `if let Some((kind, _span)) = .. && let FnKind::Fn(_, _, ast::Fn { sig, .. }) = kind
          //  && !sig.decl.inputs.is_empty() && let sugg = .. && !sugg.is_empty()`
          const first_branch = (): string | undefined => {
            if (current_function === undefined) return undefined;
            const [kind, _span] = current_function;
            if (kind.$ !== "Fn") return undefined;
            const sig = kind._2.sig;
            if (sig.decl.inputs.length === 0) return undefined;
            const sugg = sig.decl.inputs.flatMap((param): [Span, string][] => {
              if (Span.contains(param.ty.span, lt.span)) {
                // We don't want to suggest `fn elision(_: &fn() -> &i32)`
                // when we have `fn elision(_: fn() -> &i32)`
                return [];
              } else if (param.ty.kind.$ === "CVarArgs") {
                // Don't suggest `&...` for ffi fn with varargs
                return [];
              } else if (param.ty.kind.$ === "ImplTrait") {
                // We handle these in the next `else if` branch.
                return [];
              } else {
                return [[Span.shrink_to_lo(param.ty.span), "&"]];
              }
            });
            if (sugg.length === 0) return undefined;
            const [the, s] = sig.decl.inputs.length === 1 ? ["the", ""] : ["one of the", "s"];
            const dotdotdot = lt_kind === "Ampersand" ? "..." : "";
            err.multipart_suggestion(`instead, you are more likely to want to change ${the} argument${s} to be borrowed${dotdotdot}`, sugg, Applicability.MaybeIncorrect);
            return "...or alternatively, you might want";
          };
          // `else if (lt.kind == Ampersand || Underscore) && let Some((kind, _span)) = ..
          //  && let FnKind::Fn(_, _, ast::Fn { sig, .. }) = kind && let ast::FnRetTy::Ty(ret_ty) = &sig.decl.output
          //  && !sig.decl.inputs.is_empty() && let arg_refs = .. && !arg_refs.is_empty()`
          const second_branch = (): string | undefined => {
            if (!(lt_kind === "Ampersand" || lt_kind === "Underscore")) return undefined;
            if (current_function === undefined) return undefined;
            const [kind, _span] = current_function;
            if (kind.$ !== "Fn") return undefined;
            const sig = kind._2.sig;
            if (sig.decl.output.$ !== "Ty") return undefined;
            const ret_ty = sig.decl.output._0;
            if (sig.decl.inputs.length === 0) return undefined;
            const arg_refs = sig.decl.inputs
              .flatMap((param) => (param.ty.kind.$ === "ImplTrait" ? [param.ty.kind._1] : []))
              .flatMap((bounds) => bounds);
            if (arg_refs.length === 0) return undefined;
            // We have a situation like
            // fn g(mut x: impl Iterator<Item = &()>) -> Option<&()>
            // So we look at every ref in the trait bound. If there's any, we
            // suggest
            // fn g<'a>(mut x: impl Iterator<Item = &'a ()>) -> Option<&'a ()>
            const lt_finder = new LifetimeFinder(lt.span, undefined, []);
            for (const bound of arg_refs) {
              if (bound.$ === "Trait") {
                const trait_ref = bound._0;
                lt_finder.visit_trait_ref(trait_ref.trait_ref);
              }
            }
            lt_finder.visit_ty(ret_ty);
            const spans_suggs: [Span, string][] = lt_finder.seen.flatMap((ty): [Span, string][] => {
              if (ty.kind.$ === "Ref") {
                const inner_ty = ty.kind._1;
                const span = Span.with_hi(ty.span, Span.lo(inner_ty.span));
                return [[span, "&'a "]];
              }
              return [];
            });
            this.suggest_introducing_lifetime(err, undefined, (err, higher_ranked, span, message, intro_sugg, _) => {
              err.multipart_suggestion(message, [[span, intro_sugg] as [Span, string], ...spans_suggs.slice()], Applicability.MaybeIncorrect);
              return higher_ranked;
            });
            return "alternatively, you might want";
          };
          pre = first_branch() ?? second_branch() ?? "instead, you are more likely to want";
          let owned_sugg = lt_kind === "Ampersand";
          let sugg_slice_to_vec_or_string = false;
          let sugg: [Span, string][] = [[lt.span, ""]];
          if (current_function !== undefined && current_function[0].$ === "Fn") {
            const sig = current_function[0]._2.sig;
            const lt_finder = new LifetimeFinder(lt.span, undefined, []);
            for (const param of sig.decl.inputs) {
              lt_finder.visit_ty(param.ty);
            }
            if (sig.decl.output.$ === "Ty") {
              const ret_ty = sig.decl.output._0;
              lt_finder.visit_ty(ret_ty);
              const ret_lt_finder = new LifetimeFinder(lt.span, undefined, []);
              ret_lt_finder.visit_ty(ret_ty);
              const seen = ret_lt_finder.seen;
              if (seen.length === 1 && seen[0]!.kind.$ === "Ref") {
                const span = seen[0]!.span;
                const inner_ty = seen[0]!.kind._1;
                // We might have a situation like
                // fn g(mut x: impl Iterator<Item = &'_ ()>) -> Option<&'_ ()>
                // but `lt.span` only points at `'_`, so to suggest `-> Option<()>`
                // we need to find a more accurate span to end up with
                // fn g<'a>(mut x: impl Iterator<Item = &'_ ()>) -> Option<()>
                sugg = [[Span.with_hi(span, Span.lo(inner_ty.span)), ""]];
                owned_sugg = true;
              }
            }
            const ty = lt_finder.found;
            if (ty !== undefined) {
              if (ty.kind.$ === "Path" && ty.kind._0 === undefined) {
                // Check if the path being borrowed is likely to be owned.
                const path: Segment[] = Segment.from_path(ty.kind._1);
                const r = this.resolve_path(path, "TypeNS", undefined, PathSource.Type);
                if (r.$ === "Module" && r._0.$ === "Module") {
                  const module = r._0._0;
                  const res = module.res();
                  if (res !== undefined && res.$ === "PrimTy" && res._0.$ === "Str") {
                    // Don't suggest `-> str`, suggest `-> String`.
                    sugg = [[Span.with_hi(lt.span, Span.hi(ty.span)), "String"]];
                    sugg_slice_to_vec_or_string = true;
                  } else if (res !== undefined && res.$ === "PrimTy") {
                    // nothing
                  } else if (
                    res !== undefined &&
                    res.$ === "Def" &&
                    (res._0.$ === "Struct" ||
                      res._0.$ === "Union" ||
                      res._0.$ === "Enum" ||
                      res._0.$ === "ForeignTy" ||
                      res._0.$ === "AssocTy" ||
                      res._0.$ === "OpaqueTy" ||
                      res._0.$ === "TyParam")
                  ) {
                    // nothing
                  } else {
                    // Do not suggest in all other cases.
                    owned_sugg = false;
                  }
                } else if (r.$ === "NonModule") {
                  const res = r._0.base_res();
                  if (res.$ === "PrimTy" && res._0.$ === "Str") {
                    // Don't suggest `-> str`, suggest `-> String`.
                    sugg = [[Span.with_hi(lt.span, Span.hi(ty.span)), "String"]];
                    sugg_slice_to_vec_or_string = true;
                  } else if (res.$ === "PrimTy") {
                    // nothing
                  } else if (
                    res.$ === "Def" &&
                    (res._0.$ === "Struct" ||
                      res._0.$ === "Union" ||
                      res._0.$ === "Enum" ||
                      res._0.$ === "ForeignTy" ||
                      res._0.$ === "AssocTy" ||
                      res._0.$ === "OpaqueTy" ||
                      res._0.$ === "TyParam")
                  ) {
                    // nothing
                  } else {
                    // Do not suggest in all other cases.
                    owned_sugg = false;
                  }
                } else {
                  // Do not suggest in all other cases.
                  owned_sugg = false;
                }
              }
              if (ty.kind.$ === "Slice") {
                const inner_ty = ty.kind._0;
                // Don't suggest `-> [T]`, suggest `-> Vec<T>`.
                sugg = [
                  [Span.with_hi(lt.span, Span.lo(inner_ty.span)), "Vec<"],
                  [Span.with_lo(ty.span, Span.hi(inner_ty.span)), ">"],
                ];
                sugg_slice_to_vec_or_string = true;
              }
            }
          }
          if (owned_sugg) {
            // Suggest to remove the ref prefix (usually an &) from the return type.
            const span = this.find_ref_prefix_span_for_owned_suggestion(lt.span);
            if (span !== undefined && !sugg_slice_to_vec_or_string) {
              sugg = [[span, ""]];
            }
            err.multipart_suggestion(`${pre} to return an owned value`, sugg, Applicability.MaybeIncorrect);
          }
        }
      }
      break;
    }
    default: {
      const lifetime_spans: Span[] = in_scope_lifetimes.map(([ident, _]) => ident.span);
      err.span_note(lifetime_spans, "these named lifetimes are available to use");

      if (spans_suggs.length > 0) {
        // This happens when we have `Foo<T>` where we point at the space before `T`,
        // but this can be confusing so we give a suggestion with placeholders.
        err.multipart_suggestion("consider using one of the available lifetimes here", spans_suggs, Applicability.HasPlaceholders);
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4682 find_ref_prefix_span_for_owned_suggestion
LateResolutionVisitor.prototype.find_ref_prefix_span_for_owned_suggestion = function (this: LateResolutionVisitor, lifetime: Span): Span | undefined {
  const finder = new RefPrefixSpanFinder(lifetime, undefined);
  const item = this.diag_metadata.current_item;
  const current_function = this.diag_metadata.current_function;
  if (item !== undefined) {
    finder.visit_item(item);
  } else if (current_function !== undefined && current_function[0].$ === "Fn") {
    const sig = current_function[0]._2.sig;
    for (const param of sig.decl.inputs) {
      finder.visit_ty(param.ty);
    }
    if (sig.decl.output.$ === "Ty") {
      finder.visit_ty(sig.decl.output._0);
    }
  }
  return finder.span;
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4787 visit_ty
LifetimeFinder.prototype.visit_ty = function (this: LifetimeFinder, t: Ty): undefined {
  const k = t.kind;
  if (k.$ === "Ref" || k.$ === "PinnedRef") {
    const ty = k._1;
    this.seen.push(t);
    if (Span.lo(t.span) === Span.lo(this.lifetime)) {
      this.found = ty;
    }
  }
  return walk_ty(this, t);
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4804 visit_ty
RefPrefixSpanFinder.prototype.visit_ty = function (this: RefPrefixSpanFinder, t: Ty): undefined {
  if (this.span !== undefined) {
    return;
  }
  const k = t.kind;
  if ((k.$ === "Ref" || k.$ === "PinnedRef") && Span.lo(t.span) === Span.lo(this.lifetime)) {
    const inner_ty = k._1;
    this.span = Span.with_hi(t.span, Span.lo(inner_ty.span));
    return;
  }
  walk_ty(this, t);
};

// rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4849 visit_ty
ParentPathVisitor.prototype.visit_ty = function (this: ParentPathVisitor, ty: Ty): undefined {
  if (this.parent !== undefined) {
    return;
  }

  // push current type
  this.stack.push(ty);

  if (ty.kind.$ === "Path") {
    const path = ty.kind._1;
    // is this just `N`?
    if (path.segments.length === 1 && path.segments[0]!.ident.eq(this.target) && this.stack.length >= 2) {
      // parent is previous element in stack
      const parent_ty = this.stack[this.stack.length - 2]!;
      if (parent_ty.kind.$ === "Path") {
        const parent_path = parent_ty.kind._1;
        this.parent = parent_path.segments[0];
      }
    }
  }

  walk_ty(this, ty);

  this.stack.pop();
};
