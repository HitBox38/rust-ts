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
// res-late-diag-b imports
import {
  AssocItemKind,
  type AngleBracketedArg,
  clone_Path,
  clone_PathSegment,
  clone_TraitBoundModifiers,
  clone_Ty,
  DUMMY_NODE_ID,
  type Expr,
  GenericBound,
  type GenericParam,
  ItemKind,
  type Lifetime,
  type NodeId,
  Path as AstPath,
  PathSegment as AstPathSegment,
  PolyTraitRef as AstPolyTraitRef,
  TraitBoundModifiers,
  Ty as AstTy,
} from "../../rustc_ast/lib.ts";
import { walk_ty } from "../../rustc_ast/visit.ts";
import { type Attribute as HirAttribute, type AttributeKind, find_attr } from "../../rustc_attr_ir/lib.ts";
import type { Stability } from "../../rustc_attr_ir/stability.ts";
import { Applicability, type Diag, E0106, E0261, E0401, E0423, E0425, E0496, MultiSpan, pluralize, struct_span_code_err, SuggestionStyle } from "../../rustc_errors/lib.ts";
import { type CtorKind, DefKind, MacroKinds, Res as def_Res } from "../../rustc_hir/def.ts";
import { SINGLE_USE_LIFETIMES, UNUSED_LIFETIMES } from "../../rustc_lint_defs/builtin.gen.ts";
import type { LifetimeRes } from "../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Visibility } from "../../rustc_middle/ty/mod.ts";
import { Session as SessionC } from "../../rustc_session/session.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { edit_distance, find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP, Span as SpanC } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, Ident as IdentC, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { ch, is_uppercase } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { Str } from "../../std/str.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import * as diagnostics from "../diagnostics/mod.ts";
import type { LabelSuggestion } from "../diagnostics/impls.ts";
import { TypoSuggestion as TypoSuggestionC } from "../diagnostics/impls.ts";
import { LifetimeBinderKind, type NoConstantGenericsReason, PathSource, RibKind } from "../late.ts";
import { type ElisionFnParameter, type MissingLifetime } from "./diagnostics.gen.ts";
import { type BindingKey, DefId_key, Finalize, Ident_key, type Module, ParentScope, path_names_to_string, type Res, Segment as SegmentC } from "../lib.ts";

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

  // rustc: compiler/rustc_resolve/src/late/diagnostics.rs:4840 new
  static new(self_ty: Ty, target: Ident): ParentPathVisitor {
    const v = new ParentPathVisitor(target, undefined, []);

    v.visit_ty(self_ty);
    return v;
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
            _0: new AstTy(DUMMY_NODE_ID, { $: "Path", _0: undefined, _1: clone_Path(poly_trait_ref.trait_ref.path) }, DUMMY_SP),
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
        _0: new AstPolyTraitRef(
          [],
          clone_TraitBoundModifiers(TraitBoundModifiers.NONE),
          {
            path: new AstPath(DUMMY_SP, modified_segments),
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
unported_methods(LateResolutionVisitor.prototype, "rustc_resolve::late::diagnostics::LateResolutionVisitor", ["trait_assoc_type_def_id_by_name", "suggest_assoc_type_from_bounds", "make_base_error", "could_be_expr", "smart_resolve_partial_mod_path_errors", "smart_resolve_report_errors", "suggest_named_format_argument", "detect_rtn_with_fully_qualified_path", "detect_assoc_type_constraint_meant_as_path", "suggest_self_or_self_ref", "try_lookup_name_relaxed", "lookup_doc_alias_name", "suggest_trait_and_bounds", "suggest_typo", "suggest_shadowed", "err_code_special_cases", "suggest_ident_hidden_by_hygiene", "suggest_self_ty", "suggest_self_value", "detect_missing_binding_available_from_pattern", "suggest_at_operator_in_slice_pat_with_range", "suggest_range_struct_destructuring", "suggest_swapping_misplaced_self_ty_and_trait", "detect_resolution_error_in_derive", "explain_functions_in_pattern", "suggest_changing_type_to_const_param", "suggest_pattern_match_with_let", "get_single_associated_item", "restrict_assoc_type_in_where_clause", "call_has_self_arg", "followed_by_brace", "update_err_for_private_tuple_struct_fields"]);

// ---- lane res-late-diag-b: late/diagnostics.rs:2267..end (`impl LateResolutionVisitor`, second half) ----

// PORT(decls): pending root. `LateResolutionVisitor::likely_rust_type` (diagnostics.rs:3174) is an associated fn
// without `self`; decls.ts lists it as a comment only, so its static is declared here.
declare module "../decls.ts" {
  namespace LateResolutionVisitor {
    let likely_rust_type: (path: readonly Segment[]) => Symbol | undefined;
  }
}

/**
 * PORT: `rustc_hir::MissingLifetimeKind` (hir.rs:812) is not ported (M3): `MissingLifetime::kind` is typed
 * `unknown` (decls.ts, typemap.middle). The fieldless enum is a string-literal union (PORTING §5); its values
 * are read through this type.
 */
type MissingLifetimeKind = "Underscore" | "Ampersand" | "Comma" | "Brackets";

/** PORT: `String`'s `Ord` (byte-wise; code-point order equals UTF-8 byte order), for `sort` / `cmp`. */
function str_cmp(a: string, b: string): number {
  const ai = a[globalThis.Symbol.iterator]();
  const bi = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** `Result<Str, _>::ok()` of a `span_to_snippet` as a `String`. */
function snippet_ok(r: Result<Str, unknown>): string | undefined {
  return r.$ === "Ok" ? r._0.toString() : undefined;
}

/**
 * PORT: `impl HasAttrs for DefId` (rustc_middle/src/ty/mod.rs:2349, not ported), the attribute list that
 * `find_attr!(tcx, def_id, ..)` searches. Same stand-in as lib.ts's (not exported there).
 */
function DefId_get_attrs(self: DefId, tcx: TyCtxt): readonly HirAttribute[] {
  if (self.as_local() !== undefined) return unported("tcx.hir_attrs(tcx.local_def_id_to_hir_id(did)) (HIR, M3)");
  return tcx.attrs_for_def(self) as readonly HirAttribute[];
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

    if (SpanC.eq_ctxt(lhs_span, rhs_span)) {
      err.span_suggestion_verbose(SpanC.between(lhs_span, rhs_span), MESSAGE, "::", Applicability.MaybeIncorrect);
      return true;
    }
    if (kind.$ === "Struct" || kind.$ === "TyAlias") {
      const lhs_source_span = SpanC.find_ancestor_inside(lhs_span, expr.span);
      if (lhs_source_span !== undefined) {
        const snippet = this_.r.tcx_.sess.source_map().span_to_snippet(lhs_source_span);
        if (snippet.$ === "Ok") {
          // The LHS is a type that originates from a macro call.
          // We have to add angle brackets around it.

          err.span_suggestion_verbose(SpanC.until(lhs_source_span, rhs_span), MESSAGE, `<${snippet._0.toString()}>::`, Applicability.MaybeIncorrect);
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
            [SpanC.shrink_to_lo(sp), "("],
            [SpanC.shrink_to_hi(sp), ")"],
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
          parts.push([SpanC.until(SpanC.shrink_to_hi(path_span), args[0]!.span), "{"]);

          for (let i = 0; i < Math.min(fields.length, args.length); i++) {
            const [field, arg] = [fields[i]!, args[i]!];
            // Add the field name before the argument
            parts.push([SpanC.shrink_to_lo(arg.span), `${display_Ident(field)}: `]);
          }

          // Add the closing brace
          parts.push([SpanC.until(SpanC.shrink_to_hi(unwrap(args[args.length - 1]).span), SpanC.shrink_to_hi(span)), "}"]);

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
      err.span_suggestion_verbose(SpanC.shrink_to_hi(span), "use `!` to invoke the macro", "!", Applicability.MaybeIncorrect);
    }

    if (path_str === "try" && SpanC.is_rust_2015(span)) {
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
        [SpanC.between(span, first), " { 0: "],
        [SpanC.between(last, SpanC.shrink_to_hi(whole)), " }"],
      );

      suggestion.push(
        ...args
          .map((arg, index): [number, Span] => [index, arg])
          .slice(1) // See above
          .map(([index, arg]): [Span, string] => [SpanC.shrink_to_lo(arg), `${index}: `]),
      );
    } else {
      suggestion.push([SpanC.between(span, SpanC.shrink_to_hi(whole)), " {}"]);
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
        [SpanC.between(span, first.span), " { 0: "],
        [SpanC.between(last.span, SpanC.shrink_to_hi(whole)), " }"],
      );

      suggestion.push(
        ...args
          .map((arg, index): [number, Expr] => [index, arg])
          .slice(1) // See above
          .map(([index, arg]): [Span, string] => [SpanC.shrink_to_lo(arg.span), `${index}: `]),
      );
    } else {
      suggestion.push([SpanC.between(span, SpanC.shrink_to_hi(whole)), " {}"]);
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
  const items: [boolean, Symbol, number][] = this.r.tcx_.inherent_impls(def_id).flatMap((_i): [boolean, Symbol, number][] =>
    // PORT: `tcx.associated_items(i).in_definition_order()`, `item.is_fn()` / `is_method()`, `tcx.fn_sig(..)` and
    // `ty::Adt` belong to rustc_middle's type system (M3), not ported: the queries' values are `unknown`.
    unported("rustc_middle::ty::AssocItems::in_definition_order (inherent impl items; fn_sig / ty::Adt, M3)"),
  );
  // `sort_by_key(|(order, _, _)| *order)` (stable; `false < true`).
  items.sort((a, b) => Number(a[0]) - Number(b[0]));
  const suggestion = (name: Symbol, args: number): string => `::${display_Symbol(name)}(${new Array<string>(args).fill("_").join(", ")})`;
  if (items.length === 0) {
    // nothing
  } else if (items.length === 1 && items[0]![2] === args.length) {
    const [, name] = items[0]!;
    err.span_suggestion_verbose(
      SpanC.shrink_to_hi(path_span),
      `you might have meant to use the \`${display_Symbol(name)}\` associated function`,
      `::${display_Symbol(name)}`,
      Applicability.MaybeIncorrect,
    );
  } else if (items.length === 1) {
    const [, name, len] = items[0]!;
    err.span_suggestion_verbose(
      SpanC.with_hi(SpanC.shrink_to_hi(path_span), SpanC.hi(call_span)),
      `you might have meant to use the \`${display_Symbol(name)}\` associated function`,
      suggestion(name, len),
      Applicability.MaybeIncorrect,
    );
  } else {
    err.span_suggestions_with_style(
      SpanC.with_hi(SpanC.shrink_to_hi(path_span), SpanC.hi(call_span)),
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
    .lookup_import_candidates(IdentC.with_dummy_span(sym.Default), "TypeNS", this.parent_scope, (res: Res) => res.$ === "Def" && res._0.$ === "Trait")
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
        [SpanC.shrink_to_lo(path_span), "<"],
        [SpanC.with_hi(SpanC.shrink_to_hi(path_span), SpanC.hi(call_span)), " as std::default::Default>::default()"],
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
    const ctxt: MutRef<SyntaxContext> = { value: SpanC.ctxt(segment.ident.span) };

    // Search in lexical scope.
    // Walk backwards up the ribs in scope and collect candidates.
    const ribs = this.ribs.index(ns);
    for (let i = ribs.length - 1; i >= 0; i--) {
      const rib = ribs[i]!;
      const rib_ctxt = RibKind.contains_params(rib.kind) ? SyntaxContext.normalize_to_macros_2_0(ctxt.value) : SyntaxContext.normalize_to_macro_rules(ctxt.value);

      // Locals and type parameters
      for (const [ident, res] of rib.bindings) {
        if (filter_fn(res) && SpanC.ctxt(ident.span) === rib_ctxt) {
          names.push(TypoSuggestionC.new(ident.name, ident.span, res));
        }
      }

      if (rib.kind.$ === "Block" && rib.kind._0 !== undefined) {
        const module = rib.kind._0;
        this.r.add_module_candidates(module.to_module(), names, filter_fn, ctxt.value);
      } else if (rib.kind.$ === "Module") {
        const module = rib.kind._0;
        // Encountered a module item, abandon ribs and look into that module and preludes.
        const parent_scope = new ParentScope(module.to_module(), this.parent_scope.expansion, this.parent_scope.macro_rules, this.parent_scope.derives);
        this.r.add_scope_set_candidates(names, { $: "All", _0: ns }, parent_scope, SpanC.with_ctxt(segment.ident.span, ctxt.value), filter_fn);
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
  if (SpanC.from_expansion(ident_span)) {
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
        [span, text] = [SpanC.shrink_to_lo(ident_span), "let "];
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
    if (SpanC.contains(val_span, ident_span) && SpanC.lo(val_span) === SpanC.lo(ident_span)) {
      err.span_suggestion_verbose(
        SpanC.to(SpanC.shrink_to_hi(let_span), SpanC.shrink_to_lo(val_span)),
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
        path_segments_.push(AstPathSegment.from_ident(ident.orig(orig_ident_span)));
        const doc_visible_ = doc_visible && (module_def_id.is_local() || !r.tcx_.is_doc_hidden(module_def_id));
        if (DefId_eq(module_def_id, def_id)) {
          const path = new AstPath(name_binding.span, path_segments_);
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
      segms.push(AstPathSegment.from_ident(ident.orig(orig_ident_span)));
      const path = new AstPath(name_binding.span, segms);
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
      const dot_span = SpanC.between(receiver.span, span);
      const found_tuple_variant = variant_ctors.some(([path, _, ctor_kind]) => {
        const last = path.segments[path.segments.length - 1];
        return ctor_kind === "Fn" && last !== undefined && last.ident.eq(ident);
      });
      [suggest_path_sep_dot_span, suggest_only_tuple_variants] = [found_tuple_variant ? dot_span : undefined, false];
    } else if (k.$ === "Field") {
      // `Type.Foo`, suggest replacing `.` -> `::` if variant `Foo` exists and is a unit or tuple variant,
      // otherwise suggest adding a variant after `Type`.
      const [base, ident] = [k._0, k._1];
      const dot_span = SpanC.between(base.span, ident.span);
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
  const segment = SegmentC.from(parent_segment);
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
      [insert_span, snippet] = [SpanC.shrink_to_lo(next_impl_param.span()), `const ${display_Ident(target_ident)}: ${full_type}, `];
    } else {
      const last = impl_.generics.params[impl_.generics.params.length - 1];
      if (last !== undefined) {
        // Append after last existing param
        // e.g impl<A, B> -> impl<A, B, const C: u8>
        [insert_span, snippet] = [SpanC.shrink_to_hi(last.span()), `, const ${display_Ident(target_ident)}: ${full_type}`];
      } else {
        // No generics at all on impl
        // e.g impl Foo for C<A> -> impl<const A: u8> Foo for C<A>
        [insert_span, snippet] = [SpanC.shrink_to_hi(impl_.generics.span), `<const ${display_Ident(target_ident)}: ${full_type}>`];
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
  } else if (current_item !== undefined && SpanC.in_derive_expansion(current_item.span)) {
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
      if (SpanC.overlaps(span, generics.span)) {
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
      if (SpanC.can_be_used_for_suggestions(span_)) {
        return [[SpanC.shrink_to_hi(span_), msg, sugg_, Applicability.MaybeIncorrect], undefined];
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
    .filter(([id, _]) => SpanC.eq_ctxt(id.span, label.span))
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
        const param_span = SpanC.find_ancestor_inside(param.span(), generics_span);
        const next_param_span = SpanC.find_ancestor_inside(unwrap(params[param_index + 1]).span(), generics_span);
        if (param_span !== undefined && next_param_span !== undefined) {
          return SpanC.to(param_span, SpanC.shrink_to_lo(next_param_span));
        }
        return undefined;
      } else {
        // if removing within `<>` brackets, we also want to
        // delete a leading or trailing comma as appropriate
        const param_span = SpanC.find_ancestor_inside(param.span(), generics_span);
        const prev_param_span = SpanC.find_ancestor_inside(unwrap(params[param_index - 1]).span(), generics_span);
        if (param_span !== undefined && prev_param_span !== undefined) {
          return SpanC.to(SpanC.shrink_to_hi(prev_param_span), param_span);
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
            const use_span__ = (sess instanceof SessionC ? sess : panic("expected a `Session`")).source_map().span_extend_while_whitespace(use_span);
            [use_span_, replace_lt] = [use_span__, ""];
          } else {
            [use_span_, replace_lt] = [use_span, "'_"];
          }
          // debug!(?deletion_span, ?use_span);

          // issue 107998 for the case such as a wrong function pointer type
          // `deletion_span` is empty and there is no need to report lifetime uses here
          const deletion_span__ = SpanC.is_empty(deletion_span_) ? undefined : deletion_span_;
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
      if (deletion_span_ !== undefined && !SpanC.in_derive_expansion(deletion_span_)) {
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
          [SpanC.shrink_to_hi(lifetime), "'a "],
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

      if (!SpanC.can_be_used_for_suggestions(span) && suggest_note && name !== undefined) {
        suggest_note = false; // Avoid displaying the same help multiple times.
        err.span_label(span, `lifetime \`${display_Ident(name)}\` is missing in item created through this procedural macro`);
        continue;
      }

      const higher_ranked = kind === "FnPtrType" || kind === "PolyTrait" || kind === "WhereBound";

      const rm_inner_binders: Set<Span> = new Set();
      let span_: Span;
      let sugg: string;
      if (SpanC.is_empty(span)) {
        const binder_idents: Set<Ident> = new KeyedSet<Ident>(Ident_key);
        binder_idents.add(name ?? IdentC.from_str("'a"));

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
              const span = SpanC.with_hi(poly_trait_ref.span, SpanC.lo(poly_trait_ref.trait_ref.path.span));
              if (!SpanC.is_empty(span)) {
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
        const span__ = SpanC.shrink_to_hi(this.r.tcx_.sess.source_map().span_through_char(span, ch("<")));
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
        in_scope_lifetimes = [[IdentC.with_dummy_span(kw.StaticLifetime), [DUMMY_NODE_ID, { $: "Static" }]]];
      }
    } else if (elided_len === 0) {
      err.help(
        "this function's return type contains a borrowed value with an elided lifetime, but the lifetime cannot be derived from the arguments",
      );
      if (in_scope_lifetimes.length === 0) {
        maybe_static = true;
        in_scope_lifetimes = [[IdentC.with_dummy_span(kw.StaticLifetime), [DUMMY_NODE_ID, { $: "Static" }]]];
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
        return [SpanC.shrink_to_hi(lt.span), `${display_Symbol(existing_name)} `];
      case "Comma": {
        const sugg_: string = new Array<string>(lt.count).fill(Symbol.as_str(existing_name)).join(", ");
        const is_empty_brackets = source_map.span_followed_by(lt.span, ">") !== undefined;
        const sugg = is_empty_brackets ? sugg_ : `${sugg_}, `;
        return [SpanC.shrink_to_hi(lt.span), sugg];
      }
      case "Brackets": {
        const sugg: string = ["<", new Array<string>(lt.count).fill(Symbol.as_str(existing_name)).join(", "), ">"].join("");
        return [SpanC.shrink_to_hi(lt.span), sugg];
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
              if (SpanC.contains(param.ty.span, lt.span)) {
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
                return [[SpanC.shrink_to_lo(param.ty.span), "&"]];
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
                const span = SpanC.with_hi(ty.span, SpanC.lo(inner_ty.span));
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
                sugg = [[SpanC.with_hi(span, SpanC.lo(inner_ty.span)), ""]];
                owned_sugg = true;
              }
            }
            const ty = lt_finder.found;
            if (ty !== undefined) {
              if (ty.kind.$ === "Path" && ty.kind._0 === undefined) {
                // Check if the path being borrowed is likely to be owned.
                const path: Segment[] = SegmentC.from_path(ty.kind._1);
                const r = this.resolve_path(path, "TypeNS", undefined, PathSource.Type);
                if (r.$ === "Module" && r._0.$ === "Module") {
                  const module = r._0._0;
                  const res = module.res();
                  if (res !== undefined && res.$ === "PrimTy" && res._0.$ === "Str") {
                    // Don't suggest `-> str`, suggest `-> String`.
                    sugg = [[SpanC.with_hi(lt.span, SpanC.hi(ty.span)), "String"]];
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
                    sugg = [[SpanC.with_hi(lt.span, SpanC.hi(ty.span)), "String"]];
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
                  [SpanC.with_hi(lt.span, SpanC.lo(inner_ty.span)), "Vec<"],
                  [SpanC.with_lo(ty.span, SpanC.hi(inner_ty.span)), ">"],
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
    if (SpanC.lo(t.span) === SpanC.lo(this.lifetime)) {
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
  if ((k.$ === "Ref" || k.$ === "PinnedRef") && SpanC.lo(t.span) === SpanC.lo(this.lifetime)) {
    const inner_ty = k._1;
    this.span = SpanC.with_hi(t.span, SpanC.lo(inner_ty.span));
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
