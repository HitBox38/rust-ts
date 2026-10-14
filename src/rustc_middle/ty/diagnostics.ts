//! Diagnostics related methods for `Ty`.
// Port of compiler/rustc_middle/src/ty/diagnostics.rs (lane ty-results, sub-lane ty-results-b; contract stub by lane
// ty-contract).
//
// The `Ty` methods are declared in ty/decls.ts (`// ty/diagnostics.rs:<line>`) and assigned to `Ty.prototype` here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code touches only `Ty.prototype`.
// PORT: `impl IntoDiagArg for X` is the free fn `X_into_diag_arg(self, path)` (decls.ts comment line).
// PORT: `IsSuggestable` has exactly one impl, the blanket `impl<T: TypeVisitable + TypeFoldable> IsSuggestable for T`,
// so the trait and its impl are one companion object of functions taking `self` first and the D4 descriptor of `T`
// last (precedent: rustc_type_ir `TypeVisitableExt`); each method carries two markers (declaration, blanket impl).
// PORT: the type-system visitors / folders implement `TypeVisitor<R>` / `FallibleTypeFolder<E>` and forward the
// methods they do not override to `TypeVisitor_provided` / `FallibleTypeFolder_provided` (tyir-binder convention).
// `ControlFlow<()>` is `ControlFlow<null>`, `type Error = ()` is `null` (rustc_ast_ir/visit.ts header).
// PORT: print/pretty.ts is imported before print/mod.ts (print/mod.ts header: entering mod.ts first is a TDZ error).
// PORT: ./context.ts is imported first so that this module also loads as an entry point (init order).
import "./context.ts";
import type { TyCtxt } from "./context.ts";
import { display_Ty, print_Binder, print_TraitClause } from "./print/pretty.ts";
import { IrPrint_print, print_Instance, print_Ty } from "./print/mod.ts";
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Stability } from "../../rustc_attr_ir/stability.ts";
import type { DiagArgValue, PathBuf } from "../../rustc_error_messages/lib.ts";
import { Applicability, type Diag, listify, pluralize } from "../../rustc_errors/lib.ts";
import { Namespace } from "../../rustc_hir/def.ts";
import {
  type AmbigArg,
  GenericBound,
  type GenericParam,
  type Generics,
  ParamName,
  PredicateOrigin,
  type Ty as HirTy,
} from "../../rustc_hir/hir.ts";
import { Visitor, walk_ty } from "../../rustc_hir/intravisit.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import {
  type FallibleTypeFolder,
  FallibleTypeFolder_provided,
  type PredicateProxy,
  type TypeFoldable,
} from "../../rustc_type_ir/fold.ts";
import {
  fold_with_TraitClause,
  TraitClause,
  try_fold_with_TraitClause,
  visit_with_TraitClause,
} from "../../rustc_type_ir/predicate.ts";
import { type Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { fold_FnSig, type FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { type BytePos, type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { debug_str, debug_struct, type Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, ok, type Result } from "../../std/result.ts";
import { with_ } from "./context/tls.ts";
import type { Clauses, Instance } from "./decls.ts";
import type { PolyTraitClause } from "../../rustc_type_ir/decls.ts";
import { fold_GenericArgs } from "./generic_args.ts";
import { Ty } from "./mod.ts";
import { fold_Ty } from "./structural_impls.ts";

// impl IntoDiagArg for Ty<'_>
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:22 into_diag_arg
export function Ty_into_diag_arg(self: Ty, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return with_((tcx) => {
    const ty = tcx.short_string(/* tcx.lift */ self, path, print_Ty);
    return { $: "Str", _0: ty };
  });
}

// impl IntoDiagArg for Instance<'_>
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:31 into_diag_arg
export function Instance_into_diag_arg(self: Instance, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return with_((tcx) => {
    const instance = tcx.short_string_namespace(/* tcx.lift */ self, path, Namespace.ValueNS, print_Instance);
    return { $: "Str", _0: instance };
  });
}

/// Similar to `Ty::is_primitive`, but also considers inferred numeric values to be primitive.
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:41 is_primitive_ty
Ty.prototype.is_primitive_ty = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Str":
    case "Int":
    case "Uint":
    case "Float":
      return true;
    case "Infer":
      return k._0.$ === "IntVar" || k._0.$ === "FloatVar" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy";
    default:
      return false;
  }
};

/// Whether the type is succinctly representable as a type instead of just referred to with a
/// description in error messages. This is used in the main error message.
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:60 is_simple_ty
Ty.prototype.is_simple_ty = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Str":
    case "Int":
    case "Uint":
    case "Float":
      return true;
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy") {
        return true;
      }
      return false;
    case "Ref":
      return k._1.peel_refs().is_simple_ty();
    case "Array":
    case "Slice":
      return k._0.peel_refs().is_simple_ty();
    case "Tuple":
      if (k._0.length === 0) {
        return true;
      }
      return false;
    default:
      return false;
  }
};

/// Whether the type is succinctly representable as a type instead of just referred to with a
/// description in error messages. This is used in the primary span label. Beyond what
/// `is_simple_ty` includes, it also accepts ADTs with no type arguments and references to
/// ADTs with no type arguments.
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:84 is_simple_text
Ty.prototype.is_simple_text = function (this: Ty): boolean {
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      return k._1.non_erasable_generics()[globalThis.Symbol.iterator]().next().done === true;
    case "Ref":
      return k._1.is_simple_text();
    default:
      return this.is_simple_ty();
  }
};

// rustc-trait: compiler/rustc_middle/src/ty/diagnostics.rs:93 IsSuggestable
export const IsSuggestable = {
  /// Whether this makes sense to suggest in a diagnostic.
  ///
  /// We filter out certain types and constants since they don't provide
  /// meaningful rendered suggestions when pretty-printed. We leave some
  /// nonsense, such as region vars, since those render as `'_` and are
  /// usually okay to reinterpret as elided lifetimes.
  ///
  /// Only if `infer_suggestable` is true, we consider type and const
  /// inference variables to be suggestable.
  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:103 is_suggestable
  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:118 is_suggestable
  is_suggestable<T>(self: T, tcx: TyCtxt, infer_suggestable: boolean, d: TypeFoldable<T>): boolean {
    return d.visit_with(self, new IsSuggestableVisitor(tcx, infer_suggestable)).$ === "Continue";
  },

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:105 make_suggestable
  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:122 make_suggestable
  make_suggestable<T>(self: T, tcx: TyCtxt, infer_suggestable: boolean, placeholder: Ty | undefined, d: TypeFoldable<T>): T | undefined {
    return ok(d.try_fold_with(self, new MakeSuggestableFolder(tcx, infer_suggestable, placeholder)));
  },
};

/** PORT: the generated `TypeFoldable` impl fns of `TraitClause` as a D4 descriptor (no `fold_TraitClause` yet). */
const fold_TraitClause_: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};

/** `impl Display for ty::Binder<'tcx, TraitClause>` (rustc_type_ir ir_print.rs:89 through `IrPrint` for `TyCtxt`). */
function display_PolyTraitClause(self: PolyTraitClause): string {
  return IrPrint_print(self, { alternate: false }, (v, p) => print_Binder(v, p, print_TraitClause, fold_TraitClause_));
}

// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:132 suggest_arbitrary_trait_bound
export function suggest_arbitrary_trait_bound(
  tcx: TyCtxt,
  generics: Generics,
  err: Diag,
  trait_pred: PolyTraitClause,
  associated_ty: [string, Ty] | undefined,
): boolean {
  if (!IsSuggestable.is_suggestable(trait_pred, tcx, false, fold_Binder(fold_TraitClause_))) {
    return false;
  }

  const param_name = display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)));
  let constraint = display_PolyTraitClause(trait_pred);

  if (associated_ty !== undefined) {
    const [name, term] = associated_ty;
    // FIXME: this case overlaps with code in TyCtxt::note_and_explain_type_err.
    // That should be extracted into a helper function.
    if (constraint.endsWith(">")) {
      const stripped = constraint.slice(0, -1);
      constraint = `${stripped}, ${name} = ${display_Ty(term)}>`;
    } else {
      constraint += `<${name} = ${display_Ty(term)}>`;
    }
  }

  const param = generics.params.find((p) => ParamName.ident(p.name).as_str() === param_name);

  // Skip, there is a param named Self
  if (param !== undefined && param_name === "Self") {
    return false;
  }

  // Suggest a where clause bound for a non-type parameter.
  err.span_suggestion_verbose(
    generics.tail_span_for_predicate_suggestion(),
    `consider ${Span.is_empty(generics.where_clause_span) ? "introducing a" : "extending the"} \`where\` clause, but there might be an alternative better way to express this requirement`,
    `${generics.add_where_or_trailing_comma()} ${constraint}`,
    Applicability.MaybeIncorrect,
  );
  return true;
}

// rustc-type: compiler/rustc_middle/src/ty/diagnostics.rs:178 SuggestChangingConstraintsMessage
type SuggestChangingConstraintsMessage =
  | { readonly $: "RestrictBoundFurther" }
  | { readonly $: "RestrictType"; ty: string }
  | { readonly $: "RestrictTypeFurther"; ty: string }
  | { readonly $: "RemoveMaybeUnsized" }
  | { readonly $: "ReplaceMaybeUnsizedWithSized" };
/** Unit variants of `SuggestChangingConstraintsMessage`, shared frozen singletons. */
const SuggestChangingConstraintsMessage = {
  RestrictBoundFurther: Object.freeze({ $: "RestrictBoundFurther" as const }),
  RemoveMaybeUnsized: Object.freeze({ $: "RemoveMaybeUnsized" as const }),
  ReplaceMaybeUnsizedWithSized: Object.freeze({ $: "ReplaceMaybeUnsizedWithSized" as const }),
};
/** `#[derive(Debug)]` */
export const debug_SuggestChangingConstraintsMessage: Debug<SuggestChangingConstraintsMessage> = (v, f) => {
  switch (v.$) {
    case "RestrictType":
    case "RestrictTypeFurther":
      return debug_struct(f, v.$, [["ty", debug_str(v.ty)]]);
    default:
      return v.$;
  }
};

/** `(Span, String, String, SuggestChangingConstraintsMessage)` */
type Suggestion = [Span, string, string, SuggestChangingConstraintsMessage];

// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:186 suggest_changing_unsized_bound
function suggest_changing_unsized_bound(
  generics: Generics,
  suggestions: Suggestion[],
  param: GenericParam,
  def_id: DefId | undefined,
): void {
  // See if there's a `?Sized` bound that can be removed to suggest that.
  // First look at the `where` clause because we can have `where T: ?Sized`,
  // then look at params.
  for (let where_pos = 0; where_pos < generics.predicates.length; where_pos++) {
    const predicate_ = generics.predicates[where_pos]!;
    if (predicate_.kind.$ !== "BoundPredicate") {
      continue;
    }
    const predicate = predicate_.kind._0;
    if (!predicate.is_param_bound(LocalDefId.to_def_id(param.def_id))) {
      continue;
    }

    const unsized_bounds = predicate.bounds
      .map((bound, i): [number, GenericBound] => [i, bound])
      .filter(([_, bound]) => {
        if (
          bound.$ === "Trait" &&
          bound._0.modifiers.polarity.$ === "Maybe" &&
          opt_def_id_eq(bound._0.trait_ref.trait_def_id(), def_id)
        ) {
          return true;
        } else {
          return false;
        }
      });

    if (unsized_bounds.length === 0) {
      continue;
    }

    const push_suggestion = (sp: Span, msg: SuggestChangingConstraintsMessage) =>
      suggestions.push([sp, "Sized", "", msg]);

    if (predicate.bounds.length === unsized_bounds.length) {
      // All the bounds are unsized bounds, e.g.
      // `T: ?Sized + ?Sized` or `_: impl ?Sized + ?Sized`,
      // so in this case:
      // - if it's an impl trait predicate suggest changing the
      //   the first bound to sized and removing the rest
      // - Otherwise simply suggest removing the entire predicate
      if (predicate.origin === PredicateOrigin.ImplTrait) {
        const first_bound = unsized_bounds[0]![1];
        const first_bound_span = GenericBound.span(first_bound);
        if (Span.can_be_used_for_suggestions(first_bound_span)) {
          const question_span = Span.with_hi(first_bound_span, (Span.lo(first_bound_span) + 1) as BytePos);
          push_suggestion(question_span, SuggestChangingConstraintsMessage.ReplaceMaybeUnsizedWithSized);

          for (const [pos, _] of unsized_bounds.slice(1)) {
            const sp = generics.span_for_bound_removal(where_pos, pos);
            push_suggestion(sp, SuggestChangingConstraintsMessage.RemoveMaybeUnsized);
          }
        }
      } else {
        const sp = generics.span_for_predicate_removal(where_pos);
        push_suggestion(sp, SuggestChangingConstraintsMessage.RemoveMaybeUnsized);
      }
    } else {
      // Some of the bounds are other than unsized.
      // So push separate removal suggestion for each unsized bound
      for (const [pos, _] of unsized_bounds) {
        const sp = generics.span_for_bound_removal(where_pos, pos);
        push_suggestion(sp, SuggestChangingConstraintsMessage.RemoveMaybeUnsized);
      }
    }
  }
}

/** `Option<DefId> == Option<DefId>` */
function opt_def_id_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : DefId_eq(a, b);
}

/// Suggest restricting a type param with a new bound.
///
/// If `span_to_replace` is provided, then that span will be replaced with the
/// `constraint`. If one wasn't provided, then the full bound will be suggested.
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:268 suggest_constraining_type_param
export function suggest_constraining_type_param(
  tcx: TyCtxt,
  generics: Generics,
  err: Diag,
  param_name: string,
  constraint: string,
  def_id: DefId | undefined,
  span_to_replace: Span | undefined,
): boolean {
  return suggest_constraining_type_params(tcx, generics, err, [[param_name, constraint, def_id]], span_to_replace);
}

/// Suggest restricting a type param with a new bound.
// rustc: compiler/rustc_middle/src/ty/diagnostics.rs:287 suggest_constraining_type_params
export function suggest_constraining_type_params(
  tcx: TyCtxt,
  generics: Generics,
  err: Diag,
  param_names_and_constraints: Iterable<readonly [string, string, DefId | undefined]>,
  span_to_replace: Span | undefined,
): boolean {
  // PORT: `FxIndexMap<&str, Vec<(&str, Option<DefId>, &str)>>` keyed by the string: a `Map` (insertion order).
  const grouped = new Map<string, [string, DefId | undefined, string][]>();
  let unstable_suggestion = false;
  for (const [param_name, constraint, def_id] of param_names_and_constraints) {
    let stable: boolean;
    if (def_id !== undefined) {
      // PORT: the `lookup_stability` query's value is typed `unknown` in queries.gen.ts; it is
      // `Option<hir::Stability>`.
      const s = tcx.lookup_stability(def_id) as Stability | undefined;
      if (s !== undefined) {
        stable = s.is_stable();
      } else {
        stable = true;
      }
    } else {
      stable = true;
    }
    if (stable || tcx.sess.is_nightly_build()) {
      let entry = grouped.get(param_name);
      if (entry === undefined) {
        entry = [];
        grouped.set(param_name, entry);
      }
      entry.push([constraint, def_id, stable ? "" : "unstable "]);
      if (!stable) {
        unstable_suggestion = true;
      }
    }
  }

  let applicability: Applicability = Applicability.MachineApplicable;
  let suggestions: Suggestion[] = [];

  for (const [param_name, constraints_] of grouped) {
    let constraints = constraints_;
    const param = generics.params.find((p) => ParamName.ident(p.name).as_str() === param_name);
    if (param === undefined) {
      return false;
    }

    {
      // PORT: `extract_if(..)` is lazy and only its first item is taken (`next()` once, then the iterator is
      // dropped), so only the first matching constraint is removed.
      const sized_index = constraints.findIndex(
        ([_, def_id, __]) => def_id !== undefined && tcx.is_lang_item(def_id, "Sized" satisfies LangItem),
      );
      if (sized_index !== -1) {
        const [[_, def_id, __]] = constraints.splice(sized_index, 1) as [[string, DefId | undefined, string]];
        applicability = Applicability.MaybeIncorrect;

        err.span_label(param.span, "this type parameter needs to be `Sized`");
        suggest_changing_unsized_bound(generics, suggestions, param, def_id);
      }
    }
    const bound_message: SuggestChangingConstraintsMessage = constraints.some(([_, def_id, __]) => def_id === undefined)
      ? SuggestChangingConstraintsMessage.RestrictBoundFurther
      : { $: "RestrictTypeFurther", ty: param_name };

    // in the scenario like impl has stricter requirements than trait,
    // we should not suggest restrict bound on the impl, here we double check
    // the whether the param already has the constraint by checking `def_id`
    const bound_trait_defs: DefId[] = generics.bounds_for_param(param.def_id).flatMap((bound) =>
      bound.bounds.flatMap((b) => {
        const t = GenericBound.trait_ref(b);
        const d = t === undefined ? undefined : t.trait_def_id();
        return d === undefined ? [] : [d];
      }),
    );

    constraints = constraints.filter(
      ([_, def_id, __]) => def_id === undefined || !bound_trait_defs.some((d) => DefId_eq(d, def_id)),
    );

    if (constraints.length === 0) {
      continue;
    }

    let constraint_ = constraints.map(([c, _, __]) => c);
    constraint_.sort(str_cmp);
    constraint_ = dedup(constraint_);
    const all_known = constraints.every(([_, def_id, __]) => def_id !== undefined);
    const all_stable = constraints.every(([_, __, stable]) => stable.length === 0);
    const all_unstable = constraints.every(([_, __, stable]) => !(stable.length === 0));
    let post: string;
    if (all_stable || all_unstable) {
      // Don't redundantly say "trait `X`, trait `Y`", instead "traits `X` and `Y`"
      let trait_names = constraints.map(([c, def_id, _]) => {
        if (def_id === undefined) {
          return `\`${c}\``;
        } else {
          return `\`${Symbol.as_str(tcx.item_name(def_id))}\``;
        }
      });
      trait_names.sort(str_cmp);
      trait_names = dedup(trait_names);
      const n = trait_names.length;
      const stable = all_stable ? "" : "unstable ";
      const trait_ = all_known ? `trait${pluralize(n)}` : "";
      const trait_names_ = listify(trait_names, (n) => n);
      if (trait_names_ === undefined) {
        return false;
      }
      post = `${stable}${trait_} ${trait_names_}`;
    } else {
      // We're more explicit when there's a mix of stable and unstable traits.
      let trait_names = constraints.map(([c, def_id, stable]) => {
        if (def_id === undefined) {
          return `\`${c}\``;
        } else {
          return `${stable}trait \`${Symbol.as_str(tcx.item_name(def_id))}\``;
        }
      });
      trait_names.sort(str_cmp);
      trait_names = dedup(trait_names);
      const names = listify(trait_names, (t) => t);
      if (names !== undefined) {
        post = names;
      } else {
        return false;
      }
    }
    const constraint = constraint_.join(" + ");
    const suggest_restrict = (span: Span, bound_list_non_empty: boolean, open_paren_sp: Span | undefined): void => {
      let suggestion: string;
      if (span_to_replace !== undefined) {
        suggestion = constraint;
      } else if (constraint.startsWith("<")) {
        suggestion = constraint;
      } else if (bound_list_non_empty) {
        suggestion = ` + ${constraint}`;
      } else {
        suggestion = ` ${constraint}`;
      }

      if (open_paren_sp !== undefined) {
        suggestions.push([open_paren_sp, post, "(", bound_message]);
        suggestions.push([span, post, `)${suggestion}`, bound_message]);
      } else {
        suggestions.push([span, post, suggestion, bound_message]);
      }
    };

    if (span_to_replace !== undefined) {
      suggest_restrict(span_to_replace, true, undefined);
      continue;
    }

    // When the type parameter has been provided bounds
    //
    //    Message:
    //      fn foo<T>(t: T) where T: Foo { ... }
    //                            ^^^^^^
    //                            |
    //                            help: consider further restricting this bound with `+ Bar`
    //
    //    Suggestion:
    //      fn foo<T>(t: T) where T: Foo { ... }
    //                                  ^
    //                                  |
    //                                  replace with: ` + Bar`
    //
    // Or, if user has provided some bounds, suggest restricting them:
    //
    //   fn foo<T: Foo>(t: T) { ... }
    //             ---
    //             |
    //             help: consider further restricting this bound with `+ Bar`
    //
    // Suggestion for tools in this case is:
    //
    //   fn foo<T: Foo>(t: T) { ... }
    //          --
    //          |
    //          replace with: `T: Bar +`

    const bounds_span = generics.bounds_span_for_suggestions(param.def_id);
    if (bounds_span !== undefined) {
      const [span, open_paren_sp] = bounds_span;
      suggest_restrict(span, true, open_paren_sp);
      continue;
    }

    if (generics.has_where_clause_predicates) {
      // This part is a bit tricky, because using the `where` clause user can
      // provide zero, one or many bounds for the same type parameter, so we
      // have following cases to consider:
      //
      // When the type parameter has been provided zero bounds
      //
      //    Message:
      //      fn foo<X, Y>(x: X, y: Y) where Y: Foo { ... }
      //             - help: consider restricting this type parameter with `where X: Bar`
      //
      //    Suggestion:
      //      fn foo<X, Y>(x: X, y: Y) where Y: Foo { ... }
      //                                           - insert: `, X: Bar`
      suggestions.push([
        generics.tail_span_for_predicate_suggestion(),
        post,
        constraints.reduce((string, [constraint, _, __]) => string + `, ${param_name}: ${constraint}`, ""),
        { $: "RestrictTypeFurther", ty: param_name },
      ]);
      continue;
    }

    // Additionally, there may be no `where` clause but the generic parameter has a default:
    //
    //    Message:
    //      trait Foo<T=()> {... }
    //                - help: consider further restricting this type parameter with `where T: Zar`
    //
    //    Suggestion:
    //      trait Foo<T=()> {... }
    //                     - insert: `where T: Zar`
    if (param.kind.$ === "Type" && param.kind.default !== undefined) {
      // If we are here and the where clause span is of non-zero length
      // it means we're dealing with an empty where clause like this:
      //      fn foo<X>(x: X) where { ... }
      // In that case we don't want to add another "where" (Fixes #120838)
      const where_prefix = Span.is_empty(generics.where_clause_span) ? " where" : "";

      // Suggest a bound, but there is no existing `where` clause *and* the type param has a
      // default (`<T=Foo>`), so we suggest adding `where T: Bar`.
      suggestions.push([
        generics.tail_span_for_predicate_suggestion(),
        post,
        `${where_prefix} ${param_name}: ${constraint}`,
        { $: "RestrictTypeFurther", ty: param_name },
      ]);
      continue;
    }

    // If user has provided a colon, don't suggest adding another:
    //
    //   fn foo<T:>(t: T) { ... }
    //            - insert: consider restricting this type parameter with `T: Foo`
    if (param.colon_span !== undefined) {
      const colon_span = param.colon_span;
      suggestions.push([
        Span.shrink_to_hi(colon_span),
        post,
        ` ${constraint}`,
        { $: "RestrictType", ty: param_name },
      ]);
      continue;
    }

    // If user hasn't provided any bounds, suggest adding a new one:
    //
    //   fn foo<T>(t: T) { ... }
    //          - help: consider restricting this type parameter with `T: Foo`
    const span = Span.shrink_to_hi(param.span);
    if (Span.can_be_used_for_suggestions(span)) {
      suggestions.push([span, post, `: ${constraint}`, { $: "RestrictType", ty: param_name }]);
    }
  }

  // FIXME: remove the suggestions that are from derive, as the span is not correct
  suggestions = suggestions.filter(([span, _, __, ___]) => !Span.in_derive_expansion(span));
  const suggested = !(suggestions.length === 0);
  if (suggestions.length === 1) {
    const [span, post, suggestion, msg_] = unwrap(suggestions.pop());
    let msg: string;
    if (msg_.$ === "RestrictBoundFurther") {
      msg = `consider further restricting this bound`;
    } else if ((msg_.$ === "RestrictTypeFurther" || msg_.$ === "RestrictType") && msg_.ty.startsWith("impl ")) {
      msg = `consider restricting opaque type \`${msg_.ty}\` with ${post}`;
    } else if (msg_.$ === "RestrictType") {
      msg = `consider restricting type parameter \`${msg_.ty}\` with ${post}`;
    } else if (msg_.$ === "RestrictTypeFurther") {
      msg = `consider further restricting type parameter \`${msg_.ty}\` with ${post}`;
    } else if (msg_.$ === "RemoveMaybeUnsized") {
      msg = `consider removing the \`?Sized\` bound to make the type parameter \`Sized\``;
    } else {
      msg = `consider replacing \`?Sized\` with \`Sized\``;
    }

    err.span_suggestion_verbose(span, msg, suggestion, applicability);
  } else if (suggestions.length > 1) {
    const post = unstable_suggestion ? " (some of them are unstable traits)" : "";
    err.multipart_suggestion(
      `consider restricting type parameters${post}`,
      suggestions.map(([span, _, suggestion, __]): [Span, string] => [span, suggestion]),
      applicability,
    );
  }

  return suggested;
}

/** PORT: `String`'s `Ord` (byte-wise; code-point order equals UTF-8 byte order). Candidate for src/std. */
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

/** PORT: `Vec::dedup` (removes consecutive repeated elements). */
function dedup(v: string[]): string[] {
  return v.filter((x, i) => i === 0 || v[i - 1] !== x);
}

/// Collect al types that have an implicit `'static` obligation that we could suggest `'_` for.
// rustc-type: compiler/rustc_middle/src/ty/diagnostics.rs:581 TraitObjectVisitor
export class TraitObjectVisitor extends Visitor {
  constructor(public _0: HirTy[]) {
    super();
  }

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:584 visit_ty
  override visit_ty(ty: HirTy<AmbigArg>): undefined {
    const kind = ty.kind;
    if (
      kind.$ === "TraitObject" &&
      (kind._1.pointer().kind.$ === "ImplicitObjectLifetimeDefault" || kind._1.pointer().kind.$ === "Static")
    ) {
      this._0.push(ty.as_unambig_ty());
    } else if (kind.$ === "OpaqueDef") {
      this._0.push(ty.as_unambig_ty());
    }
    walk_ty(this, ty);
    return undefined;
  }
}

// rustc-type: compiler/rustc_middle/src/ty/diagnostics.rs:602 IsSuggestableVisitor
export class IsSuggestableVisitor implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    private tcx: TyCtxt,
    private infer_suggestable: boolean,
  ) {}

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:610 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    const k = t.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar" && this.infer_suggestable) {
      // ok
    } else if (
      k.$ === "FnDef" ||
      k.$ === "Closure" ||
      k.$ === "Infer" ||
      k.$ === "Coroutine" ||
      k.$ === "CoroutineWitness" ||
      k.$ === "Bound" ||
      k.$ === "Placeholder" ||
      k.$ === "Error"
    ) {
      return ControlFlow.Break(null);
    } else if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const def_id = k._1.kind.def_id;
      const parent = this.tcx.parent(def_id);
      // PORT: the `type_of` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<Ty>`.
      const parent_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(parent) as EarlyBinder<Ty>));
      const parent_def_kind = this.tcx.def_kind(parent);
      const parent_kind = parent_ty.kind();
      if (
        (parent_def_kind.$ === "TyAlias" || parent_def_kind.$ === "AssocTy") &&
        parent_kind.$ === "Alias" &&
        parent_kind._1.kind.$ === "Opaque" &&
        DefId_eq(parent_kind._1.kind.def_id, def_id)
      ) {
        // Okay
      } else {
        return ControlFlow.Break(null);
      }
    } else if (k.$ === "Alias" && k._1.kind.$ === "Projection" && this.tcx.def_kind(k._1.kind.def_id).$ !== "AssocTy") {
      return ControlFlow.Break(null);
    } else if (k.$ === "Param" && Symbol.as_str(k._0.name).startsWith("impl ")) {
      // FIXME: It would be nice to make this not use string manipulation,
      // but it's pretty hard to do this, since `ty::ParamTy` is missing
      // sufficient info to determine if it is synthetic, and we don't
      // always have a convenient way of getting `ty::Generics` at the call
      // sites we invoke `IsSuggestable::is_suggestable`.
      return ControlFlow.Break(null);
    } else {
      // _ => {}
    }

    return fold_Ty.super_visit_with(t, this);
  }

  visit_region(r: Region): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:660 visit_const
  visit_const(c: Const): ControlFlow<null> {
    const k = c.kind();
    if (k.$ === "Infer" && k._0.$ === "Var" && this.infer_suggestable) {
      // ok
    } else if (k.$ === "Infer" || k.$ === "Bound" || k.$ === "Placeholder" || k.$ === "Error") {
      return ControlFlow.Break(null);
    } else {
      // _ => {}
    }

    return fold_Const.super_visit_with(c, this);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc-type: compiler/rustc_middle/src/ty/diagnostics.rs:677 MakeSuggestableFolder
export class MakeSuggestableFolder implements FallibleTypeFolder<null> {
  constructor(
    private tcx: TyCtxt,
    private infer_suggestable: boolean,
    private placeholder: Ty | undefined,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:686 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, null> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:690 try_fold_ty
  try_fold_ty(t_: Ty): Result<Ty, null> {
    let t: Ty;
    const k = t_.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar" && this.infer_suggestable) {
      t = t_;
    } else if (k.$ === "FnDef" && this.placeholder === undefined) {
      const def_id = k._0;
      const args = k._1;
      // PORT: the `fn_sig` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<Binder<FnSig>>`.
      t = Ty.new_fn_ptr(
        this.tcx,
        Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(
            this.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>,
            this.tcx,
            unwrap(Binder.no_bound_vars(args, fold_GenericArgs)),
            fold_Binder(fold_FnSig),
          ),
        ),
      );
    } else if (
      k.$ === "Closure" ||
      k.$ === "CoroutineClosure" ||
      k.$ === "FnDef" ||
      k.$ === "Infer" ||
      k.$ === "Coroutine" ||
      k.$ === "CoroutineWitness" ||
      k.$ === "Bound" ||
      k.$ === "Placeholder" ||
      k.$ === "Error"
    ) {
      const placeholder = this.placeholder;
      if (placeholder === undefined) {
        return Err(null);
      }
      // We replace these with infer (which is passed in from an infcx).
      t = placeholder;
    } else if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const def_id = k._1.kind.def_id;
      const parent = this.tcx.parent(def_id);
      // PORT: the `type_of` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<Ty>`.
      const parent_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(parent) as EarlyBinder<Ty>));
      const parent_def_kind = this.tcx.def_kind(parent);
      const parent_kind = parent_ty.kind();
      if (
        (parent_def_kind.$ === "TyAlias" || parent_def_kind.$ === "AssocTy") &&
        parent_kind.$ === "Alias" &&
        parent_kind._1.kind.$ === "Opaque" &&
        DefId_eq(parent_kind._1.kind.def_id, def_id)
      ) {
        t = t_;
      } else {
        return Err(null);
      }
    } else if (k.$ === "Param" && Symbol.as_str(k._0.name).startsWith("impl ")) {
      // FIXME: It would be nice to make this not use string manipulation,
      // but it's pretty hard to do this, since `ty::ParamTy` is missing
      // sufficient info to determine if it is synthetic, and we don't
      // always have a convenient way of getting `ty::Generics` at the call
      // sites we invoke `IsSuggestable::is_suggestable`.
      return Err(null);
    } else {
      t = t_;
    }

    return fold_Ty.try_super_fold_with(t, this);
  }

  try_fold_region(r: Region): Result<Region, null> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }

  // rustc: compiler/rustc_middle/src/ty/diagnostics.rs:746 try_fold_const
  try_fold_const(c_: Const): Result<Const, null> {
    let c: Const;
    const k = c_.kind();
    if (k.$ === "Infer" && k._0.$ === "Var" && this.infer_suggestable) {
      c = c_;
    } else if (k.$ === "Infer" || k.$ === "Bound" || k.$ === "Placeholder" || k.$ === "Error") {
      return Err(null);
    } else {
      c = c_;
    }

    return fold_Const.try_super_fold_with(c, this);
  }

  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, null> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }

  try_fold_clauses(c: Clauses): Result<Clauses, null> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

