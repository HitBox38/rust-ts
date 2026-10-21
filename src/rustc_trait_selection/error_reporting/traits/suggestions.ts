// Port of compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs (lanes errrep-sugg-a, errrep-sugg-b, errrep-sugg-c; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/suggestions.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
//
// Ported here by lane errctxt-contract (small visitors other crates use: rustc_hir_analysis check reads `ReturnsVisitor`):
// the hand classes `SelfVisitor`, `ReturnsVisitor`, `AwaitsVisitor` (intravisit `Visitor`s) with their impls.
export * from "./suggestions.gen.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { debug_Ty as debug_hir_Ty } from "../../../rustc_hir/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { debug_Symbol, type Symbol } from "../../../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_vec } from "../../../std/fmt.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { assert, unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_traits_suggestions } from "../../decls.ts";

// ==== lane errrep-sugg-a: suggestions.rs:1..2484 (`CoroutineData`'s impl, `predicate_constraint`, `suggest_restriction`,
// the `impl TypeErrCtxt` methods `note_field_shadowed_by_private_candidate_in_cause` .. `suggest_remove_await`) ====
// PORT: this lane's imports are a separate block (the file is split between three lanes).
// Init order: `FindExprBySpan` (./mod.ts) and `SelectionContext` (traits/select/mod.ts) are read lazily (`sugg_a_mod()`,
// `sugg_a_select()`): this module is evaluated while those close cycles.
import { BINARY_OPERATORS, LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import type { Stability } from "../../../rustc_attr_ir/lib.ts";
import { BindingMode, BindingMode_eq } from "../../../rustc_ast/lib.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type Diag, into_DiagMessage, into_MultiSpan, pluralize } from "../../../rustc_errors/lib.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/typeck_results.ts";
import { HirId_eq, HirIdSet } from "../../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.ts";
import { Obligation, type PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import { EvaluationResult } from "../../../rustc_middle/traits/select.ts";
import { ObligationCause, ObligationCauseCode, ObligationCauseCodeHandle } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { IsSuggestable, suggest_arbitrary_trait_bound, suggest_constraining_type_param } from "../../../rustc_middle/ty/diagnostics.ts";
import type { Clause, Clauses, ParamEnv, Predicate, Region, Ty as TyT } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg, fold_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericParamDefKind, GenericClauses, type GenericParamDef, type Generics } from "../../../rustc_middle/ty/generics.ts";
import { Term, Ty, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_PolyTraitClause, Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import { print_Ty } from "../../../rustc_middle/ty/print/mod.ts";
import type { PrettyPrinter } from "../../../rustc_middle/ty/print/pretty.ts";
import {
  display_Predicate,
  display_Ty,
  print_Binder,
  print_TraitClause,
  print_TraitClausePrintModifiersAndPath,
  print_TraitRefPrintSugared,
  TraitClause_print_modifiers_and_trait_path,
  TraitRef_print_trait_sugared,
  with_no_trimmed_paths,
  with_types_for_suggestion,
} from "../../../rustc_middle/ty/print/pretty.ts";
import type { PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import { IrPrint_print } from "../../../rustc_middle/ty/print/mod.ts";
import { ParamTy } from "../../../rustc_middle/ty/sty.ts";
import { fold_Clauses, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { PolyFnSig } from "../../../rustc_middle/ty/sty.gen.ts";
import { DefId_eq, type DefId, type LocalDefId } from "../../../rustc_span/def_id.ts";
import { type BytePos, DUMMY_SP, FileName, Span } from "../../../rustc_span/lib.ts";
import { SyntaxContext } from "../../../rustc_span/hygiene.ts";
import { display_Ident, display_Symbol, Symbol as SymbolC, sym, type Ident } from "../../../rustc_span/symbol.ts";
import { str_cmp } from "../../../rustc_session/options.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable, TypeFolder } from "../../../rustc_type_ir/fold.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import type { PolyTraitClause as PolyTraitClauseT } from "../../../rustc_middle/ty/predicate.gen.ts";
import type { ProjectionAliasTy as ProjectionAliasTyT } from "../../../rustc_type_ir/ty/alias.ts";
import {
  as_interner,
  fold_with_TraitClause,
  PolyExistentialPredicate,
  PolyTraitClause,
  ProjectionClause,
  TraitClause,
  TraitRef,
  try_fold_with_TraitClause,
  visit_with_TraitClause,
} from "../../../rustc_type_ir/predicate.ts";
import { ClosureArgs, CoroutineClosureArgs, CoroutineClosureSignature } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { FnSig, fold_with_FnSig, PolyFnSig as PolyFnSigC, PolyFnSigTys, try_fold_with_FnSig, visit_with_FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { AliasTy, ProjectionAliasTy } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized, UnnormalizedClause, UnnormalizedPolyTraitClause } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { str_trim_start, Str } from "../../../std/str.ts";
import { unwrap } from "../../../std/panic.ts";
import type { CoroutineInteriorOrUpvar, PeeledRef } from "./suggestions.gen.ts";
import { CoroutineData } from "./suggestions.gen.ts";
import type { DefIdOrName } from "./mod.gen.ts";

/** `crate::error_reporting::traits` (./mod.ts), read lazily (init order). */
function sugg_a_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}

/** `crate::traits::SelectionContext` (traits/select/mod.ts), read lazily (init order). */
function sugg_a_select(): typeof import("../../traits/select/mod.ts") {
  return require("../../traits/select/mod.ts") as typeof import("../../traits/select/mod.ts");
}

// D4 descriptors of the derived `TypeFoldable` impls this lane folds / visits through (read lazily: init order).
function d_TraitClause(): TypeFoldable<TraitClause> {
  return { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
}
function d_PolyTraitClause(): TypeFoldable<PolyTraitClauseT> {
  return fold_Binder(d_TraitClause());
}
function d_FnSig(): TypeFoldable<FnSig> {
  return { visit_with: visit_with_FnSig, try_fold_with: try_fold_with_FnSig, fold_with: fold_with_FnSig };
}

/** `impl Print for ty::Binder<'tcx, TraitClause<'tcx>>` (pretty.rs:2960). */
function print_PolyTraitClause(self: PolyTraitClauseT, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_TraitClause, d_TraitClause());
}

/**
 * `impl Print for ty::Binder<'tcx, TraitClausePrintModifiersAndPath<'tcx>>` (pretty.rs:2960) of
 * `trait_pred.print_modifiers_and_trait_path()` (pretty.rs:3086).
 * PORT: printed as the `Binder<TraitClause>` with the wrapper's `Print` impl on the bound value:
 * `print_modifiers_and_trait_path` is `map_bound` into the newtype and its derived `TypeFoldable` folds the single field,
 * so this is the same value and the same fold (the newtype's derive is not generated yet).
 */
function print_PolyTraitClausePrintModifiersAndPath(self: PolyTraitClauseT, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, (v: TraitClause, p: PrettyPrinter) => print_TraitClausePrintModifiersAndPath(TraitClause_print_modifiers_and_trait_path(v), p), d_TraitClause());
}

/** `impl Display for ty::Binder<'tcx, TraitClausePrintModifiersAndPath<'tcx>>` (ir_print.rs:89 through `IrPrint`). */
function display_PolyTraitClausePrintModifiersAndPath(self: PolyTraitClauseT): string {
  return IrPrint_print(self, PLAIN, print_PolyTraitClausePrintModifiersAndPath);
}

/** `impl Print for ty::Binder<'tcx, Ty<'tcx>>` (pretty.rs:2960). */
function print_PolyTy(self: Binder<TyT>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_Ty, fold_Ty);
}

/** `impl Display for ty::Binder<'tcx, Ty<'tcx>>` (ir_print.rs:89 through `IrPrint`). */
function display_PolyTy(self: Binder<TyT>): string {
  return IrPrint_print(self, PLAIN, print_PolyTy);
}

/** `impl UpcastFrom<TyCtxt, TraitRef> for Predicate` at the `Interner` type of the `Upcast` parameters. */
const upcast_TraitRef_to_Predicate = Predicate_upcast_from_TraitRef as unknown as (from: TraitRef, tcx: import("../../../rustc_type_ir/interner.ts").Interner) => Predicate;
/** `impl UpcastFrom<TyCtxt, Clause> for Predicate` at the `Interner` type of the `Upcast` parameters. */
const upcast_Clause_to_Predicate = Predicate_upcast_from_Clause as unknown as (from: Clause, tcx: import("../../../rustc_type_ir/interner.ts").Interner) => Predicate;

/** `str::trim_end_matches(pat)` */
function trim_end_matches(s: string, pat: string): string {
  while (pat.length > 0 && s.endsWith(pat)) s = s.slice(0, s.length - pat.length);
  return s;
}

// ---- PORT(merge): stand-ins for lane errrep-sugg-c's hand types of this file (suggestions.rs:6966.., `unknown`
// aliases until that lane lands). Root replaces each with the real item at merge (see docs/handoff/errrep-sugg-a.md). ----

/** `<&[hir::GenericParam] as NextTypeParamName>::next_type_param_name` (suggestions.rs:6970, lane errrep-sugg-c). */
function next_type_param_name(_params: readonly hir.GenericParam[], _name: string | undefined): string {
  return unported("rustc_trait_selection::error_reporting::traits::suggestions::NextTypeParamName::next_type_param_name");
}

/** `ReplaceImplTraitFolder { tcx, param, replace_ty }` (suggestions.rs:7068, lane errrep-sugg-c). */
function new_ReplaceImplTraitFolder(_tcx: TyCtxt, _param: GenericParamDef, _replace_ty: TyT): TypeFolder {
  return unported("rustc_trait_selection::error_reporting::traits::suggestions::ReplaceImplTraitFolder");
}

/** `ReplaceImplTraitVisitor { ty_spans, param_did }.visit_ty_unambig(ty)` (suggestions.rs:6997, lane errrep-sugg-c). */
function ReplaceImplTraitVisitor_visit_ty_unambig(_ty_spans: Span[], _param_did: DefId, _ty: hir.Ty): void {
  unported("rustc_trait_selection::error_reporting::traits::suggestions::ReplaceImplTraitVisitor");
}

/**
 * `ParamFinder { .. }` (suggestions.rs:7348, lane errrep-sugg-c).
 * PORT(merge): `visit_binder` only collects the params that `can_suggest_bound` reads, so the stand-in keeps the visited
 * binder and stops at `can_suggest_bound` (the first point where the collected params are observable).
 */
class ParamFinderStandIn {
  visited: PolyTraitClauseT | undefined = undefined;
  visit_binder(t: PolyTraitClauseT): void {
    this.visited = t;
  }
  can_suggest_bound(_generics: hir.Generics): boolean {
    return unported("rustc_trait_selection::error_reporting::traits::suggestions::ParamFinder::can_suggest_bound");
  }
}

// impl<'a, 'tcx> CoroutineData<'a, 'tcx>
declare module "./suggestions.gen.ts" {
  interface CoroutineData {
    try_get_upvar_span(infer_context: InferCtxt, coroutine_did: DefId, ty_matches: (_0: Binder<TyT>) => boolean): CoroutineInteriorOrUpvar | undefined;
    get_from_await_ty(visitor: AwaitsVisitor, tcx: TyCtxt, ty_matches: (_0: Binder<TyT>) => boolean): Span | undefined;
  }
}

/// Try to get information about variables captured by the coroutine that matches a type we are
/// looking for with `ty_matches` function. We uses it to find upvar which causes a failure to
/// meet an obligation
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:73 try_get_upvar_span
CoroutineData.prototype.try_get_upvar_span = function (
  this: CoroutineData,
  infer_context: InferCtxt,
  coroutine_did: DefId,
  ty_matches: (_0: Binder<TyT>) => boolean,
): CoroutineInteriorOrUpvar | undefined {
  // PORT: the `upvars_mentioned` query value is `unknown` in queries.gen.ts (as rustc_hir_typeck expr_use_visitor.ts).
  const upvars = infer_context.tcx.upvars_mentioned(coroutine_did) as Map<HirId, hir.Upvar> | undefined;
  if (upvars === undefined) return undefined;
  for (const [upvar_id, upvar] of upvars) {
    let upvar_ty = this._0.node_type(upvar_id);
    upvar_ty = infer_context.deeply_resolve_ignoring_regions(upvar_ty, fold_Ty);
    if (ty_matches(Binder.dummy(upvar_ty, fold_Ty))) {
      return { $: "Upvar", _0: upvar.span };
    }
  }
  return undefined;
};

/// Try to get the span of a type being awaited on that matches the type we are looking with the
/// `ty_matches` function. We uses it to find awaited type which causes a failure to meet an
/// obligation
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:95 get_from_await_ty
CoroutineData.prototype.get_from_await_ty = function (
  this: CoroutineData,
  visitor: AwaitsVisitor,
  tcx: TyCtxt,
  ty_matches: (_0: Binder<TyT>) => boolean,
): Span | undefined {
  for (const id of visitor.awaits) {
    const await_expr = tcx.hir_expect_expr(id);
    if (ty_matches(Binder.dummy(this._0.expr_ty_adjusted(await_expr), fold_Ty))) {
      return await_expr.span;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:113 predicate_constraint
export function predicate_constraint(generics: hir.Generics, pred: Predicate): [Span, string] {
  return [
    generics.tail_span_for_predicate_suggestion(),
    with_types_for_suggestion(() => `${generics.add_where_or_trailing_comma()} ${display_Predicate(pred)}`),
  ];
}

/// Type parameter needs more bounds. The trivial case is `T` `where T: Bound`, but
/// it can also be an `impl Trait` param that needs to be decomposed to a type
/// param for cleaner code.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:123 suggest_restriction
export function suggest_restriction(
  tcx: TyCtxt,
  item_id: LocalDefId,
  hir_generics: hir.Generics,
  msg: string,
  err: Diag,
  fn_sig: hir.FnSig | undefined,
  projection: ProjectionAliasTyT | undefined,
  trait_pred: PolyTraitClauseT,
  // When we are dealing with a trait, `super_traits` will be `Some`:
  // Given `trait T: A + B + C {}`
  //              -  ^^^^^^^^^ GenericBounds
  //              |
  //              &Ident
  super_traits: [Ident, hir.GenericBounds] | undefined,
): void {
  if (
    Span.from_expansion(hir_generics.where_clause_span) ||
    Span.desugaring_kind(hir_generics.where_clause_span) !== undefined ||
    (projection !== undefined &&
      ((tcx.is_impl_trait_in_trait(projection.kind) && !tcx.features().return_type_notation()) ||
        ((stab) => stab !== undefined && stab.is_unstable())(tcx.lookup_stability(projection.kind) as Stability | undefined)))
  ) {
    return;
  }
  const generics = tcx.generics_of(item_id) as Generics;
  // Given `fn foo(t: impl Trait)` where `Trait` requires assoc type `A`...
  const found = ((): [GenericParamDef, string, hir.FnSig] | undefined => {
    if (fn_sig === undefined || projection === undefined) return undefined;
    const sig = fn_sig;
    const p = projection;
    const k = ProjectionAliasTy.projection_self_ty(p).kind();
    switch (k.$) {
      // Shenanigans to get the `Trait` from the `impl Trait`.
      case "Param": {
        const param = k._0;
        const param_def = generics.type_param(param, tcx);
        if (GenericParamDefKind.is_synthetic(param_def.kind)) {
          const name = SymbolC.as_str(param_def.name);
          if (!name.startsWith("impl ")) return undefined;
          const bound_str = str_trim_start(Str.from(name.slice("impl ".length))).toString();
          return [param_def, bound_str, sig];
        }
        return undefined;
      }
      default:
        return undefined;
    }
  })();
  if (found !== undefined) {
    const [param, bound_str, fn_sig] = found;
    const type_param_name = next_type_param_name(hir_generics.params, bound_str);
    const trait_pred_ = d_PolyTraitClause().fold_with(
      trait_pred,
      new_ReplaceImplTraitFolder(tcx, param, ParamTy.to_ty(ParamTy.new(generics.count(), SymbolC.intern(type_param_name)), tcx)),
    );
    if (!IsSuggestable.is_suggestable(trait_pred_, tcx, false, d_PolyTraitClause())) {
      return;
    }
    // We know we have an `impl Trait` that doesn't satisfy a required projection.

    // Find all of the occurrences of `impl Trait` for `Trait` in the function arguments'
    // types. There should be at least one, but there might be *more* than one. In that
    // case we could just ignore it and try to identify which one needs the restriction,
    // but instead we choose to suggest replacing all instances of `impl Trait` with `T`
    // where `T: Trait`.
    const ty_spans: Span[] = [];
    for (const input of fn_sig.decl.inputs) {
      ReplaceImplTraitVisitor_visit_ty_unambig(ty_spans, param.def_id, input);
    }
    // The type param `T: Trait` we will suggest to introduce.
    const type_param = `${type_param_name}: ${bound_str}`;

    const span = hir_generics.span_for_param_suggestion();
    const sugg: [Span, string][] = [
      span !== undefined ? [span, `, ${type_param}`] : [hir_generics.span, `<${type_param}>`],
      // `fn foo(t: impl Trait)`
      //                       ^ suggest `where <T as Trait>::A: Bound`
      predicate_constraint(hir_generics, Predicate_upcast_from_PolyTraitClause(trait_pred_, tcx)),
    ];
    for (const s of ty_spans) sugg.push([s, type_param_name]);

    // Suggest `fn foo<T: Trait>(t: T) where <T as Trait>::A: Bound`.
    // FIXME: we should suggest `fn foo(t: impl Trait<A: Bound>)` instead.
    err.multipart_suggestion("introduce a type parameter with a trait bound instead of using `impl Trait`", sugg, "MaybeIncorrect");
  } else {
    if (!IsSuggestable.is_suggestable(trait_pred, tcx, false, d_PolyTraitClause())) {
      return;
    }
    // Trivial case: `T` needs an extra bound: `T: Bound`.
    const first = hir_generics.params.find((p) => !(p.kind.$ === "Type" && p.kind.synthetic));
    let sp: Span;
    let suggestion: string;
    if (super_traits === undefined) {
      [sp, suggestion] = predicate_constraint(hir_generics, Predicate_upcast_from_PolyTraitClause(trait_pred, tcx));
    } else if (first === undefined && super_traits[1].length === 0) {
      const ident = super_traits[0];
      [sp, suggestion] = [Span.shrink_to_hi(ident.span), `: ${display_PolyTraitClausePrintModifiersAndPath(trait_pred)}`];
    } else if (super_traits[1].length > 0) {
      const bounds = super_traits[1][super_traits[1].length - 1]!;
      [sp, suggestion] = [Span.shrink_to_hi(hir.GenericBound.span(bounds)), ` + ${display_PolyTraitClausePrintModifiersAndPath(trait_pred)}`];
    } else {
      // (Some(_), Some((_, [])))
      [sp, suggestion] = [Span.shrink_to_hi(hir_generics.span), `: ${display_PolyTraitClausePrintModifiersAndPath(trait_pred)}`];
    }

    err.span_suggestion_verbose(sp, `consider further restricting ${msg}`, suggestion, "MachineApplicable");
  }
}

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:255 note_field_shadowed_by_private_candidate_in_cause
TypeErrCtxt.prototype.note_field_shadowed_by_private_candidate_in_cause = function (
  this: TypeErrCtxt,
  err: Diag,
  cause: ObligationCause,
  param_env: ParamEnv,
): void {
  const hir_ids = new HirIdSet();
  // Walk the parent chain so we can recover
  // the source expression from whichever layer carries them.
  let next_code: ObligationCauseCode | undefined = cause.code_();
  while (next_code !== undefined) {
    const cause_code: ObligationCauseCode = next_code;
    switch (cause_code.$) {
      case "BinOp":
        hir_ids.add(cause_code.lhs_hir_id);
        hir_ids.add(cause_code.rhs_hir_id);
        break;
      case "FunctionArg":
        hir_ids.add(cause_code.arg_hir_id);
        break;
      case "ReturnValue":
      case "AwaitableExpr":
      case "BlockTailExpression":
        hir_ids.add(cause_code._0);
        break;
      case "UnOp":
        hir_ids.add(cause_code.hir_id);
        break;
      case "OpaqueReturnType":
        if (cause_code._0 !== undefined) {
          const hir_id = cause_code._0[1];
          hir_ids.add(hir_id);
        }
        break;
      default:
        break;
    }
    next_code = ObligationCauseCode.parent(cause_code);
  }

  let body: hir.Body | undefined;
  if (!Span.is_dummy(cause.span) && (body = this.tcx.hir_maybe_body_owned_by(cause.body_def_id)) !== undefined) {
    const expr_finder = sugg_a_mod().FindExprBySpan.new(cause.span, this.tcx);
    expr_finder.visit_body(body);
    if (expr_finder.result !== undefined) {
      const expr = expr_finder.result;
      hir_ids.add(expr.hir_id);
    }
  }

  // we will sort immediately by source order before emitting any diagnostics
  // PORT: `FxHashSet` iteration order is insertion order here; the stable sort below only keeps it for equal keys.
  const hir_ids_: HirId[] = [...hir_ids];
  const source_map = this.tcx.sess.source_map();
  // `sort_by_cached_key`: the key is computed once per element.
  const keyed = hir_ids_.map((hir_id): [[string, number, number], HirId] => {
    const span = this.tcx.hir_span(hir_id);
    const lo = source_map.lookup_byte_offset(Span.lo(span));
    const hi = source_map.lookup_byte_offset(Span.hi(span));
    return [[FileName.prefer_remapped_unconditionally(lo.sf.name).to_string(), lo.pos, hi.pos], hir_id];
  });
  keyed.sort(([a], [b]) => str_cmp(a[0], b[0]) || a[1] - b[1] || a[2] - b[2]);

  for (const [, hir_id] of keyed) {
    this.note_field_shadowed_by_private_candidate(err, hir_id, param_env);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:312 note_field_shadowed_by_private_candidate
TypeErrCtxt.prototype.note_field_shadowed_by_private_candidate = function (this: TypeErrCtxt, err: Diag, hir_id: HirId, param_env: ParamEnv): void {
  const typeck_results = this.typeck_results;
  if (typeck_results === undefined) {
    return;
  }
  const node = this.tcx.hir_node(hir_id);
  if (node.$ !== "Expr") {
    return;
  }
  const expr = node._0;
  if (expr.kind.$ !== "Field") {
    return;
  }
  const base_expr = expr.kind._0;
  const field_ident = expr.kind._1;

  const base_ty_ = typeck_results.expr_ty_opt(base_expr);
  if (base_ty_ === undefined) {
    return;
  }
  const base_ty = this.deeply_resolve_ignoring_regions(base_ty_, fold_Ty);
  if (TypeVisitableExt.references_error(base_ty, fold_Ty)) {
    return;
  }

  let private_candidate: [TyT, TyT, Span] | undefined = undefined;

  for (const [deref_base_ty] of this.autoderef_steps(base_ty)) {
    const k = deref_base_ty.kind();
    if (k.$ !== "Adt") {
      continue;
    }
    const base_def = k._0;
    const args = k._1;

    if (base_def.is_enum()) {
      continue;
    }

    const [adjusted_ident, def_scope] = this.tcx.adjust_ident_and_get_scope(
      field_ident,
      base_def.did(),
      this.tcx.parent_module_from_def_id(typeck_results.hir_owner.def_id),
    );

    const field_def = base_def.non_enum_variant().fields.find((field) => field.ident(this.tcx).normalize_to_macros_2_0().eq(adjusted_ident));
    if (field_def === undefined) {
      continue;
    }
    const field_span = this.tcx.def_ident_span(field_def.did) ?? this.tcx.def_span(field_def.did);

    if (Visibility.is_accessible_from(field_def.vis, def_scope, this.tcx)) {
      const accessible_field_ty = Unnormalized.skip_norm_wip(field_def.ty(this.tcx, args));
      if (private_candidate !== undefined && !this.can_eq(param_env, private_candidate[1], accessible_field_ty, ToTrace_Ty)) {
        const [private_base_ty, private_field_ty, private_field_span] = private_candidate;
        const pk = private_base_ty.kind();
        const private_struct_span = pk.$ === "Adt" ? (this.tcx.def_ident_span(pk._0.did()) ?? this.tcx.def_span(pk._0.did())) : DUMMY_SP;
        const accessible_struct_span = this.tcx.def_ident_span(base_def.did()) ?? this.tcx.def_span(base_def.did());
        const deref_impl_span =
          typeck_results.expr_adjustments(base_expr).filter((adj) => adj.kind.$ === "Deref" && adj.kind._0.$ === "Overloaded").length === 1
            ? this.probe((_) => {
                const deref_trait_did = this.tcx.require_lang_item(LangItem.Deref, DUMMY_SP);
                const trait_ref = TraitRef.new(as_interner(this.tcx), deref_trait_did, [GenericArg.from_Ty(private_base_ty)]);
                const obligation: Obligation<Predicate> = Obligation.new(this.tcx, ObligationCause.dummy(), param_env, trait_ref, upcast_TraitRef_to_Predicate);
                const r = sugg_a_select()
                  .SelectionContext.new(this.infcx)
                  .select(obligation.with(this.tcx, trait_ref, TraitClause.upcast_from_TraitRef));
                if (!(r.$ === "Ok" && r._0 !== undefined && r._0.$ === "UserDefined")) {
                  return undefined;
                }
                const impl_data = r._0._0;
                return this.tcx.def_span(impl_data.impl_def_id);
              })
            : undefined;

        const note_spans = into_MultiSpan(private_struct_span);
        if (private_struct_span !== DUMMY_SP) {
          note_spans.push_span_label(private_struct_span, "in this struct");
        }
        if (private_field_span !== DUMMY_SP) {
          note_spans.push_span_label(private_field_span, "if this field wasn't private, it would be accessible");
        }
        if (accessible_struct_span !== DUMMY_SP) {
          note_spans.push_span_label(accessible_struct_span, "this struct is accessible through auto-deref");
        }
        if (field_span !== DUMMY_SP) {
          note_spans.push_span_label(field_span, "this is the field that was accessed");
        }
        if (deref_impl_span !== undefined && deref_impl_span !== DUMMY_SP) {
          note_spans.push_span_label(deref_impl_span, "the field was accessed through this `Deref`");
        }

        err.span_note(
          note_spans,
          `there is a field \`${display_Ident(field_ident)}\` on \`${display_Ty(private_base_ty)}\` with type \`${display_Ty(private_field_ty)}\` but it is private; \`${display_Ident(field_ident)}\` from \`${display_Ty(deref_base_ty)}\` was accessed through auto-deref instead`,
        );
      }

      // we finally get to the accessible field,
      // so we can return early without checking the rest of the autoderef candidates
      return;
    }

    // `Option::get_or_insert` (the value is built eagerly).
    const candidate: [TyT, TyT, Span] = [deref_base_ty, Unnormalized.skip_norm_wip(field_def.ty(this.tcx, args)), field_span];
    if (private_candidate === undefined) private_candidate = candidate;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:464 suggest_restricting_param_bound
TypeErrCtxt.prototype.suggest_restricting_param_bound = function (
  this: TypeErrCtxt,
  err: Diag,
  trait_pred_: PolyTraitClauseT,
  associated_ty: [string, TyT] | undefined,
  body_def_id: LocalDefId,
): void {
  if (Binder.skip_binder(trait_pred_).polarity !== "Positive") {
    return;
  }

  const trait_pred = this.resolve_numeric_literals_with_default(trait_pred_, d_PolyTraitClause());

  const self_ty = TraitClause.self_ty(Binder.skip_binder(trait_pred));
  let param_ty: boolean;
  let projection: ProjectionAliasTyT | undefined;
  const sk = self_ty.kind();
  switch (sk.$) {
    case "Param":
      [param_ty, projection] = [true, undefined];
      break;
    case "Alias": {
      const alias = sk._1;
      const projection_ = AliasTy.try_to_projection(alias);
      if (projection_ !== undefined) {
        [param_ty, projection] = [false, projection_];
      } else {
        [param_ty, projection] = [false, undefined];
      }
      break;
    }
    default:
      [param_ty, projection] = [false, undefined];
      break;
  }

  // PORT(merge): `ParamFinder { .. }` is lane errrep-sugg-c's (stand-in above).
  const finder = new ParamFinderStandIn();
  finder.visit_binder(trait_pred);

  // FIXME: Add check for trait bound that is already present, particularly `?Sized` so we
  //        don't suggest `T: Sized + ?Sized`.
  for (;;) {
    const node = this.tcx.hir_node_by_def_id(body_def_id);
    arms: {
      if (node.$ === "Item" && node._0.kind.$ === "Trait" && self_ty === this.tcx.types.self_param) {
        const { ident, generics, bounds } = node._0.kind;
        assert(param_ty, "assertion failed: param_ty");
        // Restricting `Self` for a single method.
        suggest_restriction(this.tcx, body_def_id, generics, "`Self`", err, undefined, projection, trait_pred, [ident, bounds]);
        return;
      }

      if (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && self_ty === this.tcx.types.self_param) {
        const generics = node._0.generics;
        assert(param_ty, "assertion failed: param_ty");
        // Restricting `Self` for a single method.
        suggest_restriction(this.tcx, body_def_id, generics, "`Self`", err, undefined, projection, trait_pred, undefined);
        return;
      }

      if (projection !== undefined) {
        let generics_fn_sig: [hir.Generics, hir.FnSig] | undefined;
        if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
          generics_fn_sig = [node._0.generics, node._0.kind._0];
        } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
          generics_fn_sig = [node._0.generics, node._0.kind._0];
        } else if (node.$ === "Item" && node._0.kind.$ === "Fn") {
          generics_fn_sig = [node._0.kind.generics, node._0.kind.sig];
        }
        if (generics_fn_sig !== undefined) {
          const [generics, fn_sig] = generics_fn_sig;
          // Missing restriction on associated type of type parameter (unmet projection).
          suggest_restriction(this.tcx, body_def_id, generics, "the associated type", err, fn_sig, projection, trait_pred, undefined);
          return;
        }
      }
      if (projection !== undefined && node.$ === "Item" && (node._0.kind.$ === "Trait" || node._0.kind.$ === "Impl")) {
        const generics = node._0.kind.$ === "Trait" ? node._0.kind.generics : node._0.kind._0.generics;
        // Missing restriction on associated type of type parameter (unmet projection).
        suggest_restriction(this.tcx, body_def_id, generics, "the associated type", err, undefined, projection, trait_pred, undefined);
        return;
      }

      const item_generics = node.$ === "Item" ? item_kind_generics(node._0.kind) : undefined;
      const any_generics = item_generics ?? (node.$ === "TraitItem" || node.$ === "ImplItem" ? node._0.generics : undefined);
      if (any_generics !== undefined && param_ty) {
        const generics = any_generics;
        // We skip the 0'th arg (self) because we do not want
        // to consider the predicate as not suggestible if the
        // self type is an arg position `impl Trait` -- instead,
        // we handle that by adding ` + Bound` below.
        // FIXME(compiler-errors): It would be nice to do the same
        // this that we do in `suggest_restriction` and pull the
        // `impl Trait` into a new generic if it shows up somewhere
        // else in the predicate.
        if (!Binder.skip_binder(trait_pred).trait_ref.args.slice(1).every((g) => IsSuggestable.is_suggestable(g, this.tcx, false, fold_GenericArg))) {
          return;
        }
        // Missing generic type parameter bound.
        const param_name = display_Ty(self_ty);
        let constraint = with_no_trimmed_paths(() => display_PolyTraitClausePrintModifiersAndPath(trait_pred));

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

        if (suggest_constraining_type_param(this.tcx, generics, err, param_name, constraint, PolyTraitClause.def_id(trait_pred), undefined)) {
          return;
        }
        break arms;
      }

      if (
        ((node.$ === "TraitItem" && node._0.kind.$ === "Fn") ||
          (node.$ === "ImplItem" && node._0.impl_kind.$ === "Inherent" && node._0.kind.$ === "Fn")) &&
        finder.can_suggest_bound(node._0.generics)
      ) {
        const generics = node._0.generics;
        // Missing generic type parameter bound.
        suggest_arbitrary_trait_bound(this.tcx, generics, err, trait_pred, associated_ty);
        break arms;
      }
      if (item_generics !== undefined && finder.can_suggest_bound(item_generics)) {
        const generics = item_generics;
        // Missing generic type parameter bound.
        if (suggest_arbitrary_trait_bound(this.tcx, generics, err, trait_pred, associated_ty)) {
          return;
        }
        break arms;
      }
      if (node.$ === "Crate") {
        return;
      }
    }
    body_def_id = this.tcx.local_parent(body_def_id);
  }
};

/**
 * The `generics` of the `hir::ItemKind` arms `Struct(_, generics, _) | Enum(_, generics, _) | Union(_, generics, _) |
 * Trait { generics, .. } | Impl(hir::Impl { generics, .. }) | Fn { generics, .. } | TyAlias(_, generics, _) |
 * Const(_, generics, _, _) | TraitAlias(_, _, generics, _)` (an or-pattern of `suggest_restricting_param_bound`).
 */
function item_kind_generics(kind: hir.ItemKind): hir.Generics | undefined {
  switch (kind.$) {
    case "Struct":
    case "Enum":
    case "Union":
      return kind._1;
    case "Trait":
      return kind.generics;
    case "Impl":
      return kind._0.generics;
    case "Fn":
      return kind.generics;
    case "TyAlias":
      return kind._1;
    case "Const":
      return kind._1;
    case "TraitAlias":
      return kind._2;
    default:
      return undefined;
  }
}

/// Provide a suggestion to dereference arguments to functions and binary operators, if that
/// would satisfy trait bounds.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:702 suggest_dereferences
TypeErrCtxt.prototype.suggest_dereferences = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClauseT): boolean {
  let code = obligation.cause.code_();
  let typeck_results: TypeckResults | undefined;
  let arg_node: hir.Node;
  let arg_ty: TyT | undefined;
  if (
    code.$ === "FunctionArg" &&
    (typeck_results = this.typeck_results) !== undefined &&
    (arg_node = this.tcx.hir_node(code.arg_hir_id)).$ === "Expr" &&
    (arg_ty = typeck_results.expr_ty_adjusted_opt(arg_node._0)) !== undefined
  ) {
    const arg_hir_id = code.arg_hir_id;
    const call_hir_id = code.call_hir_id;
    const expr = arg_node._0;
    // Suggest dereferencing the argument to a function/method call if possible

    // Get the root obligation, since the leaf obligation we have may be unhelpful (#87437)
    let real_trait_pred = trait_pred;
    let parent: [ObligationCauseCode, PolyTraitClauseT | undefined] | undefined;
    while ((parent = ObligationCauseCode.parent_with_predicate(code)) !== undefined) {
      const [parent_code, parent_trait_pred] = parent;
      code = parent_code;
      if (parent_trait_pred !== undefined) {
        real_trait_pred = parent_trait_pred;
      }
    }

    // We `instantiate_bound_regions_with_erased` here because `make_subregion` does not handle
    // `ReBound`, and we don't particularly care about the regions.
    const real_ty = this.tcx.instantiate_bound_regions_with_erased(PolyTraitClause.self_ty(real_trait_pred), fold_Ty);
    if (!this.can_eq(obligation.param_env, real_ty, arg_ty, ToTrace_Ty)) {
      return false;
    }

    // Potentially, we'll want to place our dereferences under a `&`. We don't try this for
    // `&mut`, since we can't be sure users will get the side-effects they want from it.
    // If this doesn't work, we'll try removing the `&` in `suggest_remove_reference`.
    // FIXME(dianne): this misses the case where users need both to deref and remove `&`s.
    // This method could be combined with `TypeErrCtxt::suggest_remove_reference` to handle
    // that, similar to what `FnCtxt::suggest_deref_or_ref` does.
    let is_under_ref: Region | undefined;
    let base_ty: TyT;
    let span: Span;
    const ek = expr.kind;
    let rk: ReturnType<TyT["kind"]>;
    if (ek.$ === "AddrOf" && ek._0 === "Ref" && ek._1 === "Not" && (rk = real_ty.kind()).$ === "Ref" && rk._2 === "Not") {
      const subexpr = ek._2;
      [is_under_ref, base_ty, span] = [rk._0, rk._1, subexpr.span];
    } else if (ek.$ === "AddrOf") {
      // Don't suggest `*&mut`, etc.
      return false;
    } else {
      [is_under_ref, base_ty, span] = [undefined, real_ty, obligation.cause.span];
    }

    const autoderef = this.autoderef_steps(base_ty);
    let is_boxed = base_ty.is_box();
    let steps: number | undefined;
    for (let i = 0; i < autoderef.length; i++) {
      let [ty, obligations] = autoderef[i]!;
      // Ensure one of the following for dereferencing to be valid: we're passing by
      // reference, `ty` is `Copy`, or we're moving out of a (potentially nested) `Box`.
      const can_deref =
        is_under_ref !== undefined ||
        this.type_is_copy_modulo_regions(obligation.param_env, ty) ||
        ty.is_numeric() || // for inference vars (presumably but not provably `Copy`)
        (is_boxed && this.type_is_sized_modulo_regions(obligation.param_env, ty));
      is_boxed = is_boxed && ty.is_box();

      // Re-add the `&` if necessary
      if (is_under_ref !== undefined) {
        const region = is_under_ref;
        ty = Ty.new_ref(this.tcx, region, ty, "Not");
      }

      // Remapping bound vars here
      const ty_ = ty;
      const real_trait_pred_and_ty = Binder.map_bound(real_trait_pred, (inner_trait_pred): [TraitClause, TyT] => [inner_trait_pred, ty_]);
      const obligation_ = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, real_trait_pred_and_ty);

      if (can_deref && [...obligations, obligation_].every((obligation) => this.predicate_may_hold(obligation))) {
        steps = i;
        break;
      }
    }
    if (steps !== undefined && steps > 0) {
      if (Span.in_external_macro(span, this.tcx.sess.source_map())) {
        return false;
      }

      // For a shared reference, prefer removing the outer `&` over suggesting
      // `&*reference`. Keep the reborrow for `&mut T` and smart pointers.
      let bk: ReturnType<TyT["kind"]>;
      if (
        is_under_ref !== undefined &&
        steps === 1 &&
        (bk = base_ty.kind()).$ === "Ref" &&
        bk._2 === "Not" &&
        !Span.from_expansion(expr.span) &&
        this.suggest_remove_reference(obligation, err, real_trait_pred)
      ) {
        return true;
      }
      const derefs = "*".repeat(steps);
      const msg = "consider dereferencing here";

      const call_node = this.tcx.hir_node(call_hir_id);
      const is_receiver = call_node.$ === "Expr" && call_node._0.kind.$ === "MethodCall" && HirId_eq(call_node._0.kind._1.hir_id, arg_hir_id);
      if (is_receiver) {
        err.multipart_suggestion(
          msg,
          [
            [Span.shrink_to_lo(span), `(${derefs}`],
            [Span.shrink_to_hi(span), ")"],
          ],
          "MachineApplicable",
        );
      } else {
        err.span_suggestion_verbose(Span.shrink_to_lo(span), msg, derefs, "MachineApplicable");
      }
      return true;
    }
  } else {
    const [peeled_code, predicate] = ObligationCauseCode.peel_derives_with_predicate(code);
    let lhs_node: hir.Node;
    let rhs_node: hir.Node;
    let rhs_ty: TyT | undefined;
    let trait_pred_: PolyTraitClauseT;
    if (
      peeled_code.$ === "BinOp" &&
      (typeck_results = this.typeck_results) !== undefined &&
      (lhs_node = this.tcx.hir_node(peeled_code.lhs_hir_id)).$ === "Expr" &&
      (rhs_node = this.tcx.hir_node(peeled_code.rhs_hir_id)).$ === "Expr" &&
      (rhs_ty = typeck_results.expr_ty_opt(rhs_node._0)) !== undefined &&
      ((trait_pred_ = predicate ?? trait_pred), true) &&
      // Only run this code on binary operators
      BINARY_OPERATORS.map((op) => this.tcx.lang_items().get(op))
        .filter((op): op is DefId => op !== undefined)
        .some((op) => DefId_eq(op, Binder.skip_binder(trait_pred_).trait_ref.def_id))
    ) {
      const lhs = lhs_node._0;
      const rhs = rhs_node._0;
      // Suggest dereferencing the LHS, RHS, or both terms of a binop if possible
      const trait_pred = predicate ?? trait_pred_;
      const lhs_ty = this.tcx.instantiate_bound_regions_with_erased(PolyTraitClause.self_ty(trait_pred), fold_Ty);
      const lhs_autoderef = this.autoderef_steps(lhs_ty);
      const rhs_autoderef = this.autoderef_steps(rhs_ty);
      const first_lhs = unwrap(lhs_autoderef[0]);
      const first_rhs = unwrap(rhs_autoderef[0]);
      type Step = [number, [TyT, unknown]];
      // `lhs.enumerate().rev().zip_longest(rhs.enumerate().rev()).map(..).rev()`
      const lhs_rev: Step[] = lhs_autoderef.map((x, i): Step => [i, x]).reverse();
      const rhs_rev: Step[] = rhs_autoderef.map((x, i): Step => [i, x]).reverse();
      const autoderefs: [Step, Step][] = [];
      for (let k = 0; k < Math.max(lhs_rev.length, rhs_rev.length); k++) {
        const a = lhs_rev[k];
        const b = rhs_rev[k];
        if (a !== undefined && b !== undefined) {
          autoderefs.push([a, b]);
        } else if (a !== undefined) {
          autoderefs.push([a, [0, first_rhs]]);
        } else {
          autoderefs.push([[0, first_lhs], b!]);
        }
      }
      autoderefs.reverse();
      let found: [number | undefined, number | undefined] | undefined;
      for (const [[lsteps, [l_ty]], [rsteps, [r_ty]]] of autoderefs) {
        // Create a new predicate with the dereferenced LHS and RHS
        // We simultaneously dereference both sides rather than doing them
        // one at a time to account for cases such as &Box<T> == &&T
        const trait_pred_and_ty = Binder.map_bound(trait_pred, (inner): [TraitClause, TyT] => [
          {
            trait_ref: TraitRef.new_from_args(
              as_interner(this.tcx),
              inner.trait_ref.def_id,
              this.tcx.mk_args([GenericArg.from_Ty(l_ty), GenericArg.from_Ty(r_ty), ...inner.trait_ref.args.slice(2)]),
            ),
            polarity: inner.polarity,
          },
          l_ty,
        ]);
        const obligation_ = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, trait_pred_and_ty);
        if (this.predicate_may_hold(obligation_)) {
          found = rsteps === 0 ? [lsteps, undefined] : lsteps === 0 ? [undefined, rsteps] : [lsteps, rsteps];
          break;
        }
      }
      if (found !== undefined) {
        const [lsteps, rsteps] = found;
        const make_sugg = (expr_: hir.Expr, steps_: number): [string, [Span, string][]] | undefined => {
          let expr = expr_;
          let steps = steps_;
          if (Span.in_external_macro(expr.span, this.tcx.sess.source_map())) {
            return undefined;
          }
          let prefix_span = Span.shrink_to_lo(expr.span);
          let msg = "consider dereferencing here";
          if (expr.kind.$ === "AddrOf") {
            const inner = expr.kind._2;
            msg = "consider removing the borrow and dereferencing instead";
            if (inner.kind.$ === "AddrOf") {
              msg = "consider removing the borrows and dereferencing instead";
            }
          }
          while (expr.kind.$ === "AddrOf" && steps > 0) {
            const inner = expr.kind._2;
            prefix_span = Span.with_hi(prefix_span, Span.lo(inner.span));
            expr = inner;
            steps -= 1;
          }
          // Empty suggestions with empty spans ICE with debug assertions
          if (steps === 0) {
            return [trim_end_matches(msg, " and dereferencing instead"), [[prefix_span, ""]]];
          }
          const derefs = "*".repeat(steps);
          const needs_parens = steps > 0 && hir.expr_needs_parens(expr);
          const suggestion: [Span, string][] = needs_parens
            ? [
                [Span.shrink_to_lo(Span.with_lo(expr.span, Span.hi(prefix_span))), `${derefs}(`],
                [Span.shrink_to_hi(expr.span), ")"],
              ]
            : [[Span.shrink_to_lo(Span.with_lo(expr.span, Span.hi(prefix_span))), `${derefs}`]];
          // Empty suggestions with empty spans ICE with debug assertions
          if (!Span.is_empty(prefix_span)) {
            suggestion.push([prefix_span, ""]);
          }
          return [msg, suggestion];
        };

        if (lsteps !== undefined && rsteps !== undefined && lsteps > 0 && rsteps > 0) {
          const l = make_sugg(lhs, lsteps);
          if (l === undefined) {
            return false;
          }
          const suggestion = l[1];
          const r = make_sugg(rhs, rsteps);
          if (r === undefined) {
            return false;
          }
          const rhs_suggestion = r[1];
          suggestion.push(...rhs_suggestion);
          err.multipart_suggestion("consider dereferencing both sides of the expression", suggestion, "MachineApplicable");
          return true;
        } else if (lsteps !== undefined && lsteps > 0) {
          const l = make_sugg(lhs, lsteps);
          if (l === undefined) {
            return false;
          }
          const [msg, suggestion] = l;
          err.multipart_suggestion(msg, suggestion, "MachineApplicable");
          return true;
        } else if (rsteps !== undefined && rsteps > 0) {
          const r = make_sugg(rhs, rsteps);
          if (r === undefined) {
            return false;
          }
          const [msg, suggestion] = r;
          err.multipart_suggestion(msg, suggestion, "MachineApplicable");
          return true;
        }
      }
    }
  }
  return false;
};

/// Given a closure's `DefId`, return the given name of the closure.
///
/// This doesn't account for reassignments, but it's only used for suggestions.
// PORT(decls): pending root: decls.ts declares `get_closure_name(..): Symbol | undefined` without importing rustc_span's
// `Symbol` (it resolves to the ES `Symbol`); the fn returns rustc_span's `Symbol` and is cast to the declared type.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:984 get_closure_name
TypeErrCtxt.prototype.get_closure_name = function (this: TypeErrCtxt, def_id: DefId, err: Diag, msg: string): Symbol | undefined {
  const get_name = (err: Diag, kind: hir.PatKind): Symbol | undefined => {
    // Get the local name of this closure. This can be inaccurate because
    // of the possibility of reassignment, but this should be good enough.
    if (kind.$ === "Binding" && BindingMode_eq(kind._0, BindingMode.NONE) && kind._3 === undefined) {
      const ident = kind._2;
      return ident.name;
    }
    err.note(msg);
    return undefined;
  };

  const local = def_id.as_local();
  if (local === undefined) return undefined;
  const hir_id = this.tcx.local_def_id_to_hir_id(local);
  const parent = this.tcx.parent_hir_node(hir_id);
  if (parent.$ === "Stmt" && parent._0.kind.$ === "Let") {
    const local = parent._0.kind._0;
    return get_name(err, local.pat.kind);
  }
  // Different to previous arm because one is `&hir::Local` and the other
  // is `Box<hir::Local>`.
  if (parent.$ === "LetStmt") {
    const local = parent._0;
    return get_name(err, local.pat.kind);
  }
  return undefined;
} as unknown as TypeErrCtxt["get_closure_name"];

/// We tried to apply the bound to an `fn` or closure. Check whether calling it would
/// evaluate to a type that *would* satisfy the trait bound. If it would, suggest calling
/// it: `bar(foo)` → `bar(foo())`. This case is *very* likely to be hit if `foo` is `async`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1017 suggest_fn_call
TypeErrCtxt.prototype.suggest_fn_call = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClauseT): boolean {
  // It doesn't make sense to make this suggestion outside of typeck...
  // (also autoderef will ICE...)
  if (this.typeck_results === undefined) {
    return false;
  }

  const pk = Binder.skip_binder(obligation.predicate.kind());
  if (pk.$ === "Clause" && pk._0.$ === "Trait" && this.tcx.is_lang_item(TraitClause.def_id(pk._0._0), LangItem.Sized)) {
    // Don't suggest calling to turn an unsized type into a sized type
    return false;
  }

  const self_ty = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.FnCall, PolyTraitClause.self_ty(trait_pred), fold_Ty);

  const callable = this.extract_callable_info(obligation.cause.body_def_id, obligation.param_env, self_ty);
  if (callable === undefined) {
    return false;
  }
  const [def_id_or_name, output, inputs] = callable;

  // Remapping bound vars here
  const trait_pred_and_self = Binder.map_bound(trait_pred, (trait_pred): [TraitClause, TyT] => [trait_pred, output]);

  const new_obligation = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, trait_pred_and_self);
  if (!this.predicate_must_hold_modulo_regions(new_obligation)) {
    return false;
  }

  // If this is a zero-argument async closure directly passed as an argument
  // and the expected type is `Future`, suggest using `async {}` block instead
  // of `async || {}`
  const sk = self_ty.kind();
  const code = obligation.cause.code_();
  let sig_inputs: ReturnType<TyT["kind"]>;
  let arg_node: hir.Node;
  let local_node: hir.Node | undefined;
  if (
    sk.$ === "CoroutineClosure" &&
    (sig_inputs = Binder.skip_binder(CoroutineClosureArgs.coroutine_closure_sig(sk._1.as_coroutine_closure())).tupled_inputs_ty.kind()).$ === "Tuple" &&
    sig_inputs._0.length === 0 &&
    this.tcx.is_lang_item(PolyTraitClause.def_id(trait_pred), LangItem.Future) &&
    code.$ === "FunctionArg" &&
    (arg_node = this.tcx.hir_node(code.arg_hir_id)).$ === "Expr" &&
    arg_node._0.kind.$ === "Closure" &&
    (local_node = this.tcx.hir_get_if_local(sk._0)) !== undefined &&
    local_node.$ === "Expr" &&
    local_node._0.kind.$ === "Closure" &&
    local_node._0.kind._0.kind.$ === "CoroutineClosure" &&
    local_node._0.kind._0.kind._0 === "Async" &&
    local_node._0.kind._0.fn_arg_span !== undefined &&
    Span.contains(obligation.cause.span, local_node._0.kind._0.fn_arg_span)
  ) {
    const closure = local_node._0.kind._0;
    const arg_span = unwrap(closure.fn_arg_span);
    let body = this.tcx.hir_body(closure.body).value;
    const peeled = body.peel_blocks().peel_drop_temps();
    if (peeled.kind.$ === "Closure") {
      const inner = peeled.kind._0;
      body = this.tcx.hir_body(inner.body).value;
    }
    if (body.peel_blocks().peel_drop_temps().kind.$ !== "Block") {
      return false;
    }

    const sm = this.tcx.sess.source_map();
    const snippet = sm.span_to_snippet(Span.with_hi(arg_span, (Span.hi(arg_span) + 1) as BytePos));
    const removal_span =
      snippet.$ === "Ok" && snippet._0.len() > 0 && snippet._0.byte(snippet._0.len() - 1) === 0x20
        ? // There's a space after `||`, include it in the removal
          Span.with_hi(arg_span, (Span.hi(arg_span) + 1) as BytePos)
        : arg_span;
    err.span_suggestion_verbose(removal_span, "use `async {}` instead of `async || {}` to introduce an async block", "", "MachineApplicable");
    return true;
  }

  // Get the name of the callable and the arguments to be used in the suggestion.
  let msg: string;
  switch (def_id_or_name.$) {
    case "DefId": {
      const def_id = def_id_or_name._0;
      const kind = this.tcx.def_kind(def_id);
      if (kind.$ === "Ctor" && kind._0 === "Struct") {
        msg = "use parentheses to construct this tuple struct";
      } else if (kind.$ === "Ctor" && kind._0 === "Variant") {
        msg = "use parentheses to construct this tuple variant";
      } else {
        msg = `use parentheses to call this ${this.tcx.def_kind_descr(kind, def_id)}`;
      }
      break;
    }
    case "Name": {
      const name = def_id_or_name._0;
      msg = `use parentheses to call this ${name}`;
      break;
    }
  }

  const args = inputs.map((ty) => (IsSuggestable.is_suggestable(ty, this.tcx, false, fold_Ty) ? `/* ${display_Ty(ty)} */` : "/* value */")).join(", ");

  let callee_hir_id: HirId | undefined;
  if (code.$ === "FunctionArg" && Span.can_be_used_for_suggestions(obligation.cause.span)) {
    callee_hir_id = code.arg_hir_id;
  } else {
    // The iterator of a `for` loop is passed to `IntoIterator::into_iter`, so the failing
    // `Iterator` goal is a derived obligation and `cause.span` carries the loop's
    // desugaring context. The expression is still the user's, which its own span attests.
    const peeled = ObligationCauseCode.peel_derives(code);
    if (peeled.$ === "ForLoopIterator" && Span.can_be_used_for_suggestions(this.tcx.hir_span(peeled._0))) {
      callee_hir_id = peeled._0;
    } else {
      callee_hir_id = undefined;
    }
  }

  if (callee_hir_id !== undefined) {
    const span = obligation.cause.span;

    const callee_node = this.tcx.hir_node(callee_hir_id);
    const arg_expr = callee_node.$ === "Expr" ? callee_node._0 : undefined;

    const is_closure_expr = arg_expr !== undefined && arg_expr.kind.$ === "Closure";

    // If the user wrote `|| {}()`, suggesting to call the closure would produce `(|| {}())()`,
    // which doesn't help and is often outright wrong.
    if (args.length === 0 && arg_expr !== undefined && arg_expr.kind.$ === "Closure") {
      const closure = arg_expr.kind._0;
      let body = this.tcx.hir_body(closure.body).value;

      // Async closures desugar to a closure returning a coroutine
      if (closure.kind.$ === "CoroutineClosure" && closure.kind._0 === "Async") {
        const peeled = body.peel_blocks().peel_drop_temps();
        if (peeled.kind.$ === "Closure") {
          const inner = peeled.kind._0;
          body = this.tcx.hir_body(inner.body).value;
        }
      }

      const peeled_body = body.peel_blocks().peel_drop_temps();
      if (peeled_body.kind.$ === "Call" && peeled_body.kind._1.length === 0 && peeled_body.kind._0.peel_blocks().peel_drop_temps().kind.$ === "Block") {
        return false;
      }
    }

    if (is_closure_expr) {
      err.multipart_suggestions(
        msg,
        [
          [
            [Span.shrink_to_lo(span), "("],
            [Span.shrink_to_hi(span), `)(${args})`],
          ],
        ],
        "HasPlaceholders",
      );
    } else {
      err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, `(${args})`, "HasPlaceholders");
    }
  } else if (def_id_or_name.$ === "DefId") {
    const def_id = def_id_or_name._0;
    const node = this.tcx.hir_get_if_local(def_id);
    let name: string;
    if (node !== undefined && node.$ === "Expr" && node._0.kind.$ === "Closure") {
      const fn_decl_span = node._0.kind._0.fn_decl_span;
      err.span_label(fn_decl_span, "consider calling this closure");
      // PORT(decls): pending root (see `get_closure_name`): the declared return type names the ES `Symbol`.
      const name_ = this.get_closure_name(def_id, err, msg) as unknown as Symbol | undefined;
      if (name_ === undefined) {
        return false;
      }
      name = display_Symbol(name_);
    } else if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Fn") {
      const ident = node._0.kind.ident;
      err.span_label(ident.span, "consider calling this function");
      name = display_Ident(ident);
    } else if (node !== undefined && node.$ === "Ctor") {
      const name_ = this.tcx.def_path_str(def_id);
      err.span_label(this.tcx.def_span(def_id), `consider calling the constructor for \`${name_}\``);
      name = name_;
    } else {
      return false;
    }
    err.help(`${msg}: \`${name}(${args})\``);
  }
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1240 suggest_cast_to_fn_pointer
TypeErrCtxt.prototype.suggest_cast_to_fn_pointer = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  leaf_trait_predicate: PolyTraitClauseT,
  main_trait_predicate: PolyTraitClauseT,
  span: Span,
): boolean {
  const candidates = this.find_similar_impl_candidates(PolyTraitClause.def_id(leaf_trait_predicate), Binder.skip_binder(PolyTraitClause.self_ty(leaf_trait_predicate)));
  if (candidates.length !== 1) {
    return false;
  }
  const candidate = candidates[0]!.trait_ref;

  if (!(TraitRef.self_ty(candidate).kind().$ === "FnPtr" && Binder.skip_binder(PolyTraitClause.self_ty(main_trait_predicate)).kind().$ === "FnDef")) {
    return false;
  }

  const parenthesized_cast = (span: Span): [Span, string][] => [
    [Span.shrink_to_lo(span), "("],
    [Span.shrink_to_hi(span), ` as ${display_Ty(TraitRef.self_ty(candidate))})`],
  ];
  // Wrap method receivers and `&`-references in parens.
  let suggestion: [Span, string][];
  let body: hir.Body | undefined;
  if (this.tcx.sess.source_map().span_followed_by(span, ".") !== undefined) {
    suggestion = parenthesized_cast(span);
  } else if ((body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id)) !== undefined) {
    const expr_finder = sugg_a_mod().FindExprBySpan.new(span, this.tcx);
    expr_finder.visit_expr(body.value);
    const expr = expr_finder.result;
    if (expr !== undefined && expr.kind.$ === "AddrOf") {
      const expr_ = expr.kind._2;
      suggestion = parenthesized_cast(expr_.span);
    } else {
      suggestion = [[Span.shrink_to_hi(span), ` as ${display_Ty(TraitRef.self_ty(candidate))}`]];
    }
  } else {
    suggestion = [[Span.shrink_to_hi(span), ` as ${display_Ty(TraitRef.self_ty(candidate))}`]];
  }

  const trait_ = this.tcx.short_string(TraitRef_print_trait_sugared(candidate), err.long_ty_path(), print_TraitRefPrintSugared);
  const self_ty = this.tcx.short_string(TraitRef.self_ty(candidate), err.long_ty_path(), print_Ty);
  err.multipart_suggestion(`the trait \`${trait_}\` is implemented for fn pointer \`${self_ty}\`, try casting using \`as\``, suggestion, "MaybeIncorrect");
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1299 check_for_binding_assigned_block_without_tail_expression
TypeErrCtxt.prototype.check_for_binding_assigned_block_without_tail_expression = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClauseT,
): void {
  const span: MutRef<Span> = { value: obligation.cause.span };
  while (Span.from_expansion(span.value)) {
    // Remove all the desugaring and macro contexts.
    Span.remove_mark(span);
  }
  const expr_finder = sugg_a_mod().FindExprBySpan.new(span.value, this.tcx);
  const body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id);
  if (body === undefined) {
    return;
  }
  expr_finder.visit_expr(body.value);
  const expr = expr_finder.result;
  if (expr === undefined) {
    return;
  }
  const typeck = this.typeck_results;
  if (typeck === undefined) {
    return;
  }
  const ty = typeck.expr_ty_adjusted_opt(expr);
  if (ty === undefined) {
    return;
  }
  if (!ty.is_unit()) {
    return;
  }
  if (!(expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined)) {
    return;
  }
  const path = expr.kind._0._1;
  if (path.res.$ !== "Local") {
    return;
  }
  const hir_id = path.res._0;
  const pat_node = this.tcx.hir_node(hir_id);
  if (pat_node.$ !== "Pat") {
    return;
  }
  const pat = pat_node._0;
  const let_node = this.tcx.parent_hir_node(pat.hir_id);
  if (!(let_node.$ === "LetStmt" && let_node._0.ty === undefined && let_node._0.init !== undefined)) {
    return;
  }
  const init = let_node._0.init;
  if (!(init.kind.$ === "Block" && init.kind._1 === undefined)) {
    return;
  }
  const block = init.kind._0;
  if (block.expr !== undefined) {
    return;
  }
  if (block.stmts.length === 0) {
    err.span_label(block.span, "this empty block is missing a tail expression");
    return;
  }
  const stmt = block.stmts[block.stmts.length - 1]!;
  // FIXME expr and stmt have the same span if expr comes from expansion
  // cc: https://github.com/rust-lang/rust/pull/147416#discussion_r2499407523
  if (Span.from_expansion(stmt.span)) {
    return;
  }
  if (stmt.kind.$ !== "Semi") {
    return;
  }
  const tail_expr = stmt.kind._0;
  const tail_ty = typeck.expr_ty_opt(tail_expr);
  if (tail_ty === undefined) {
    err.span_label(block.span, "this block is missing a tail expression");
    return;
  }
  const ty_ = this.resolve_numeric_literals_with_default(this.deeply_resolve_ignoring_regions(tail_ty, fold_Ty), fold_Ty);
  const trait_pred_and_self = Binder.map_bound(trait_pred, (trait_pred): [TraitClause, TyT] => [trait_pred, ty_]);

  const new_obligation = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, trait_pred_and_self);
  if (tail_expr.kind.$ !== "Err" && this.predicate_must_hold_modulo_regions(new_obligation)) {
    err.span_suggestion_short(Span.with_lo(stmt.span, Span.hi(tail_expr.span)), "remove this semicolon", "", "MachineApplicable");
  } else {
    err.span_label(block.span, "this block is missing a tail expression");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1383 suggest_add_clone_to_arg
TypeErrCtxt.prototype.suggest_add_clone_to_arg = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClauseT): boolean {
  const self_ty = this.deeply_resolve_ignoring_regions(PolyTraitClause.self_ty(trait_pred), fold_Binder(fold_Ty));
  return this.enter_forall(
    self_ty,
    (ty: TyT): boolean => {
      const generics = this.tcx.hir_get_generics(obligation.cause.body_def_id);
      if (generics === undefined) {
        return false;
      }
      const tk = ty.kind();
      if (!(tk.$ === "Ref" && tk._2 === "Not")) return false;
      const inner_ty = tk._1;
      const ik = inner_ty.kind();
      if (ik.$ !== "Param") return false;
      const param = ik._0;
      const code = obligation.cause.code_();
      if (code.$ !== "FunctionArg") {
        return false;
      }
      const arg_hir_id = code.arg_hir_id;

      const clone_trait = this.tcx.require_lang_item(LangItem.Clone, obligation.cause.span);
      const has_clone = (ty: TyT): boolean => EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(clone_trait, [ty], obligation.param_env));

      let existing_clone_call: Span | undefined;
      const node = this.tcx.hir_node(arg_hir_id);
      let mk: hir.ExprKind;
      if (node.$ === "Expr" && node._0.kind.$ === "Path") {
        // It's just a variable. Propose cloning it.
        existing_clone_call = undefined;
      } else if (
        node.$ === "Expr" &&
        (mk = node._0.kind).$ === "MethodCall" &&
        mk._2.length === 0 &&
        mk._0.ident.name === sym.clone &&
        !Span.from_expansion(mk._3) &&
        !has_clone(inner_ty)
      ) {
        // It's already a call to `clone()`. We might be able to suggest
        // adding a `+ Clone` bound, though.
        const ident = mk._0.ident;
        const hir_id = node._0.hir_id;
        // We only care about method calls corresponding to the real `Clone` trait.
        const typeck_results = this.typeck_results;
        if (typeck_results === undefined) return false;
        const dep = typeck_results.type_dependent_def(hir_id);
        if (!(dep !== undefined && dep[0].$ === "AssocFn")) {
          return false;
        }
        const did = dep[1];
        const t = this.tcx.trait_of_assoc(did);
        if (!(t !== undefined && DefId_eq(t, clone_trait))) {
          return false;
        }
        existing_clone_call = ident.span;
      } else {
        return false;
      }

      const new_obligation = this.mk_trait_obligation_with_new_self_ty(
        obligation.param_env,
        Binder.map_bound(trait_pred, (trait_pred): [TraitClause, TyT] => [trait_pred, inner_ty]),
      );

      if (this.predicate_may_hold(new_obligation) && has_clone(ty)) {
        if (!has_clone(ParamTy.to_ty(param, this.tcx))) {
          suggest_constraining_type_param(this.tcx, generics, err, SymbolC.as_str(param.name), "Clone", clone_trait, undefined);
        }
        if (existing_clone_call !== undefined) {
          err.span_note(
            existing_clone_call,
            `this \`clone()\` copies the reference, which does not do anything, because \`${display_Ty(inner_ty)}\` does not implement \`Clone\``,
          );
        } else {
          err.span_suggestion_verbose(Span.shrink_to_hi(obligation.cause.span), "consider using clone here", ".clone()", "MaybeIncorrect");
        }
        return true;
      }
      return false;
    },
    fold_Ty,
  );
};

/// Extracts information about a callable type for diagnostics. This is a
/// heuristic -- it doesn't necessarily mean that a type is always callable,
/// because the callable type must also be well-formed to be called.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1483 extract_callable_info
TypeErrCtxt.prototype.extract_callable_info = function (this: TypeErrCtxt, body_def_id: LocalDefId, param_env: ParamEnv, found: TyT): [DefIdOrName, TyT, TyT[]] | undefined {
  // Autoderef is useful here because sometimes we box callables, etc.
  let callable: [DefIdOrName, Binder<TyT>, Binder<readonly TyT[]>] | undefined;
  for (const [found_] of this.autoderef_steps(found)) {
    const found = found_;
    callable = ((): [DefIdOrName, Binder<TyT>, Binder<readonly TyT[]>] | undefined => {
      const k = found.kind();
      switch (k.$) {
        case "FnPtr": {
          const sig_tys = k._0;
          return [{ $: "Name", _0: "function pointer" }, PolyFnSigTys.output(sig_tys), PolyFnSigTys.inputs(sig_tys)];
        }
        case "FnDef": {
          const def_id = k._0;
          const fn_sig = found.fn_sig(this.tcx);
          return [{ $: "DefId", _0: def_id }, PolyFnSigC.output(fn_sig), PolyFnSigC.inputs(fn_sig)];
        }
        case "Closure": {
          const def_id = k._0;
          const args = k._1;
          const fn_sig = ClosureArgs.sig(args.as_closure());
          return [
            { $: "DefId", _0: def_id },
            PolyFnSigC.output(fn_sig),
            Binder.map_bound(PolyFnSigC.inputs(fn_sig), (inputs): readonly TyT[] => unwrap(inputs[0]).tuple_fields()),
          ];
        }
        case "CoroutineClosure": {
          const def_id = k._0;
          const args = k._1;
          const sig_parts = CoroutineClosureArgs.coroutine_closure_sig(args.as_coroutine_closure());
          return [
            { $: "DefId", _0: def_id },
            Binder.map_bound(sig_parts, (sig) =>
              CoroutineClosureSignature.to_coroutine(
                sig,
                this.tcx,
                CoroutineClosureArgs.parent_args(args.as_coroutine_closure()),
                // Just use infer vars here, since we  don't really care
                // what these types are, just that we're returning a coroutine.
                this.next_ty_var(DUMMY_SP),
                this.tcx.coroutine_for_closure(def_id),
                this.next_ty_var(DUMMY_SP),
              ),
            ),
            Binder.map_bound(sig_parts, (sig): readonly TyT[] => sig.tupled_inputs_ty.tuple_fields()),
          ];
        }
        case "Alias": {
          const alias = k._1;
          if (alias.kind.$ !== "Opaque") return undefined;
          const def_id = alias.kind.def_id;
          const args = alias.args;
          for (const pred of Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.item_self_bounds(def_id) as EarlyBinder<Clauses>, this.tcx, args, fold_Clauses))) {
            const pk = Binder.skip_binder(pred.kind());
            let tk: ReturnType<TyT["kind"]>;
            if (
              pk.$ === "Projection" &&
              this.tcx.is_lang_item(ProjectionClause.def_id(pk._0), LangItem.FnOnceOutput) &&
              // args tuple will always be args[1]
              (tk = pk._0.projection_term.args.type_at(1).kind()).$ === "Tuple"
            ) {
              const proj = pk._0;
              const args = tk._0;
              return [{ $: "DefId", _0: def_id }, Binder.rebind(pred.kind(), Term.expect_type(proj.term)), Binder.rebind(pred.kind(), args as readonly TyT[])];
            }
          }
          return undefined;
        }
        case "Dynamic": {
          const data = k._0;
          for (const pred of data) {
            const ep = Binder.skip_binder(pred);
            let tk: ReturnType<TyT["kind"]>;
            if (
              ep.$ === "Projection" &&
              this.tcx.is_lang_item(ep._0.def_id, LangItem.FnOnceOutput) &&
              // for existential projection, args are shifted over by 1
              (tk = ep._0.args.type_at(0).kind()).$ === "Tuple"
            ) {
              const proj = ep._0;
              const args = tk._0;
              return [{ $: "Name", _0: "trait object" }, Binder.rebind(pred, Term.expect_type(proj.term)), Binder.rebind(pred, args as readonly TyT[])];
            }
          }
          return undefined;
        }
        case "Param": {
          const param = k._0;
          const generics = this.tcx.generics_of(body_def_id) as Generics;
          let def: GenericParamDef;
          const name: DefIdOrName =
            generics.count() > param.index &&
            ((def = generics.param_at(param.index, this.tcx)), true) &&
            def.kind.$ === "Type" &&
            def.name === param.name
              ? { $: "DefId", _0: def.def_id }
              : { $: "Name", _0: "type parameter" };
          for (const clause of param_env.caller_bounds()) {
            const ck = Binder.skip_binder(clause.kind());
            let tk: ReturnType<TyT["kind"]>;
            if (
              ck.$ === "Projection" &&
              this.tcx.is_lang_item(ProjectionClause.def_id(ck._0), LangItem.FnOnceOutput) &&
              AliasTerm.self_ty(ck._0.projection_term) === found &&
              // args tuple will always be args[1]
              (tk = ck._0.projection_term.args.type_at(1).kind()).$ === "Tuple"
            ) {
              const proj = ck._0;
              const args = tk._0;
              return [name, Binder.rebind(clause.kind(), Term.expect_type(proj.term)), Binder.rebind(clause.kind(), args as readonly TyT[])];
            }
          }
          return undefined;
        }
        default:
          return undefined;
      }
    })();
    if (callable !== undefined) break;
  }
  if (callable === undefined) {
    return undefined;
  }
  const [def_id_or_name, output_, inputs_] = callable;

  const output = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.FnCall, output_, fold_Ty);
  const inputs = Binder.skip_binder(inputs_).map((ty) =>
    this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.FnCall, Binder.rebind(inputs_, ty), fold_Ty),
  );

  // We don't want to register any extra obligations, which should be
  // implied by wf, but also because that would possibly result in
  // erroneous errors later on.
  const { value: output__ } = this.at(ObligationCause.dummy(), param_env).normalize(Unnormalized.new_wip(output), fold_Ty);

  return output__.is_ty_var() ? undefined : [def_id_or_name, output__, inputs];
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1628 where_clause_expr_matches_failed_self_ty
TypeErrCtxt.prototype.where_clause_expr_matches_failed_self_ty = function (this: TypeErrCtxt, obligation: PredicateObligation, old_self_ty: TyT): boolean {
  if (obligation.cause.code_().$ !== "WhereClauseInExpr") {
    return true;
  }
  const typeck_results = this.typeck_results;
  const body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id);
  if (typeck_results === undefined || body === undefined) {
    return true;
  }

  const expr_finder = sugg_a_mod().FindExprBySpan.new(obligation.cause.span, this.tcx);
  expr_finder.visit_expr(body.value);
  const expr = expr_finder.result;
  if (expr === undefined) {
    return true;
  }

  const ok = old_self_ty.kind();
  const inner_old_self_ty = ok.$ === "Ref" ? ok._1 : undefined;

  const expr_ty = typeck_results.expr_ty_adjusted_opt(expr);
  return (
    expr_ty !== undefined &&
    (this.can_eq(obligation.param_env, expr_ty, old_self_ty, ToTrace_Ty) ||
      (inner_old_self_ty !== undefined && this.can_eq(obligation.param_env, expr_ty, inner_old_self_ty, ToTrace_Ty)))
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:1661 suggest_add_reference_to_arg
TypeErrCtxt.prototype.suggest_add_reference_to_arg = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  poly_trait_pred: PolyTraitClauseT,
  has_custom_message: boolean,
): boolean {
  const span = obligation.cause.span;
  const param_env = obligation.param_env;

  const mk_result = (trait_pred_and_new_ty: Binder<[TraitClause, TyT]>): boolean => {
    const obligation = this.mk_trait_obligation_with_new_self_ty(param_env, trait_pred_and_new_ty);
    return this.predicate_must_hold_modulo_regions(obligation);
  };

  const trait_pred_and_imm_ref = Binder.map_bound(poly_trait_pred, (p): [TraitClause, TyT] => [p, Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_static, TraitClause.self_ty(p))]);
  const trait_pred_and_mut_ref = Binder.map_bound(poly_trait_pred, (p): [TraitClause, TyT] => [p, Ty.new_mut_ref(this.tcx, this.tcx.lifetimes.re_static, TraitClause.self_ty(p))]);

  const imm_ref_self_ty_satisfies_pred = mk_result(trait_pred_and_imm_ref);
  const mut_ref_self_ty_satisfies_pred = mk_result(trait_pred_and_mut_ref);

  const point_at_relevant_args = (pred_ty: TyT, args_and_inputs: [hir.Expr, TyT][]): boolean => {
    const typeck_results = this.typeck_results;
    if (typeck_results === undefined) return false;

    const erased_self_ty = this.tcx.instantiate_bound_regions_with_erased(PolyTraitClause.self_ty(poly_trait_pred), fold_Ty);
    const spans: Span[] = [];
    for (const [arg, input] of args_and_inputs) {
      const arg_ty = typeck_results.expr_ty_adjusted_opt(arg);
      if (arg_ty === undefined) continue;
      const pred_has_arg_type = this.infcx.can_eq(param_env, arg_ty, erased_self_ty, ToTrace_Ty);
      const arg_is_type_param = this.infcx.can_eq(param_env, pred_ty, input, ToTrace_Ty);
      if (pred_has_arg_type && arg_is_type_param) {
        err.span_label(arg.span, `\`${display_Ty(arg_ty)}\` doesn't satisfy the trait bound`);
        spans.push(arg.span);
      }
    }
    const this_ = pluralize("this", spans.length);
    if (spans.length !== 0) {
      if (imm_ref_self_ty_satisfies_pred) {
        err.multipart_suggestion(
          `consider borrowing ${this_} argument`,
          spans.map((sp): [Span, string] => [Span.shrink_to_lo(sp), "&"]),
          "MaybeIncorrect",
        );
      }
      if (mut_ref_self_ty_satisfies_pred) {
        err.multipart_suggestion(
          `consider mutably borrowing ${this_} argument`,
          spans.map((sp): [Span, string] => [Span.shrink_to_lo(sp), "&mut "]),
          "MaybeIncorrect",
        );
      }
    }
    return spans.length !== 0;
  };
  const cause_code = obligation.cause.code_();
  let code: ObligationCauseCode;
  let c_node: hir.Node;
  let c_pred: Unnormalized<PolyTraitClauseT> | undefined;
  if (cause_code.$ === "FunctionArg") {
    code = ObligationCauseCodeHandle.deref(cause_code.parent_code);
  } else if (
    // FIXME(compiler-errors): This is kind of a mess, but required for obligations
    // that come from a path expr to affect the *call* expr.
    cause_code.$ === "WhereClauseInExpr" &&
    Span.lo(this.tcx.hir_span(cause_code._2)) === Span.lo(span)
  ) {
    const c = cause_code;
    const def_id = c._0;
    const hir_id = c._2;
    const idx = c._3;
    // `hir_id` corresponds to the HIR node that introduced a `where`-clause obligation.
    const parent = this.tcx.parent_hir_node(hir_id);
    if (parent.$ === "Expr") {
      const expr = parent._0;
      // If that obligation comes from a type in an associated method call, we need
      // special handling here.
      let base: hir.Expr;
      let outer_node: hir.Node;
      if (
        expr.kind.$ === "Call" &&
        ((base = expr.kind._0), true) &&
        base.kind.$ === "Path" &&
        base.kind._0.$ === "TypeRelative" &&
        (outer_node = this.tcx.parent_hir_node(expr.hir_id)).$ === "Expr" &&
        outer_node._0.kind.$ === "AddrOf" &&
        outer_node._0.kind._0 === "Ref" &&
        base.kind._0._0.span === span
      ) {
        const segment = base.kind._0._1;
        const outer = outer_node._0;
        const mtbl = (outer.kind as Extract<hir.ExprKind, { $: "AddrOf" }>)._1;
        // We've encountered something like `&str::from("")`, where the intended code
        // was likely `<&str>::from("")`. The former is interpreted as "call method
        // `from` on `str` and borrow the result", while the latter means "call method
        // `from` on `&str`".

        const sugg_msg = (pre: string): string => {
          const FN = display_Ident(segment.ident);
          const TY = display_PolyTy(PolyTraitClause.self_ty(poly_trait_pred));
          return `you likely meant to call the associated function \`${FN}\` for type \`&${pre}${TY}\`, but the code as written calls associated function \`${FN}\` on type \`${TY}\``;
        };
        if ((imm_ref_self_ty_satisfies_pred && mtbl === "Not") || (mut_ref_self_ty_satisfies_pred && mtbl === "Mut")) {
          err.multipart_suggestion(
            sugg_msg(Mutability.prefix_str(mtbl)),
            [
              [Span.shrink_to_lo(outer.span), "<"],
              [Span.shrink_to_hi(span), ">"],
            ],
            "MachineApplicable",
          );
        } else if (imm_ref_self_ty_satisfies_pred && mtbl === "Mut") {
          // There's an associated function found on the immutable borrow of the
          err.multipart_suggestion(
            sugg_msg("mut "),
            [
              [Span.until(Span.shrink_to_lo(outer.span), span), "<&"],
              [Span.shrink_to_hi(span), ">"],
            ],
            "MachineApplicable",
          );
        } else if (mut_ref_self_ty_satisfies_pred && mtbl === "Not") {
          err.multipart_suggestion(
            sugg_msg(""),
            [
              [Span.until(Span.shrink_to_lo(outer.span), span), "<&mut "],
              [Span.shrink_to_hi(span), ">"],
            ],
            "MachineApplicable",
          );
        }
        // If we didn't return early here, we would instead suggest `&&str::from("")`.
        return false;
      } else if (expr.kind.$ === "Call") {
        const args = expr.kind._1;
        // The `def_id` can point at a struct, which has no fn sig.
        const dk = this.tcx.def_kind(def_id);
        let pred: Unnormalized<Clause> | undefined;
        let tpred: Unnormalized<PolyTraitClauseT> | undefined;
        if (
          (dk.$ === "AssocFn" || dk.$ === "Fn" || (dk.$ === "Ctor" && dk._1 === "Fn")) &&
          (pred = GenericClauses.instantiate_identity(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx).clauses[idx]) !== undefined &&
          (tpred = UnnormalizedClause.as_trait_clause(pred)) !== undefined &&
          // This feature allows for `for<T> T: Trait`, which fails
          // `instantiate_bound_regions_with_erased`. Avoid suggesting for now.
          !this.tcx.features().non_lifetime_binders()
        ) {
          const pred_ty = this.tcx.instantiate_bound_regions_with_erased(Unnormalized.skip_norm_wip(UnnormalizedPolyTraitClause.self_ty(tpred)), fold_Ty);
          const fn_sig = this.tcx.instantiate_bound_regions_with_erased(
            Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>)),
            d_FnSig(),
          );
          const inputs = FnSig.inputs(fn_sig);
          const zipped: [hir.Expr, TyT][] = [];
          for (let i = 0; i < Math.min(args.length, inputs.length); i++) zipped.push([args[i]!, inputs[i]!]);
          if (point_at_relevant_args(pred_ty, zipped)) {
            return false;
          }
        }
      }
    }
    code = c;
  } else if (
    cause_code.$ === "WhereClauseInExpr" &&
    (c_node = this.tcx.hir_node(cause_code._2)).$ === "Expr" &&
    c_node._0.kind.$ === "MethodCall" &&
    // The `def_id` can also point at the impl, which has no fn sig.
    ((dk) => dk.$ === "AssocFn" || dk.$ === "Fn" || (dk.$ === "Ctor" && dk._1 === "Fn"))(this.tcx.def_kind(cause_code._0)) &&
    ((c_pred = ((pred) => (pred === undefined ? undefined : UnnormalizedClause.as_trait_clause(pred)))(
      GenericClauses.instantiate_identity(this.tcx.clauses_of(cause_code._0) as GenericClauses, this.tcx).clauses[cause_code._3],
    )),
    c_pred !== undefined) &&
    // This feature allows for `for<T> T: Trait`, which fails
    // `instantiate_bound_regions_with_erased`. Avoid suggesting for now.
    !this.tcx.features().non_lifetime_binders()
  ) {
    const c = cause_code;
    const def_id = c._0;
    const rcvr = c_node._0.kind._1;
    const args = c_node._0.kind._2;
    const pred = c_pred;
    const fn_sig = this.tcx.instantiate_bound_regions_with_erased(
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>)),
      d_FnSig(),
    );
    // We've got a method call where likely one of the arguments didn't meet a bound.
    const pred_ty = this.tcx.instantiate_bound_regions_with_erased(Unnormalized.skip_norm_wip(UnnormalizedPolyTraitClause.self_ty(pred)), fold_Ty);
    const exprs = [rcvr, ...args];
    const inputs = FnSig.inputs(fn_sig);
    const zipped: [hir.Expr, TyT][] = [];
    for (let i = 0; i < Math.min(exprs.length, inputs.length); i++) zipped.push([exprs[i]!, inputs[i]!]);
    if (point_at_relevant_args(pred_ty, zipped)) {
      return false;
    }
    code = c;
  } else if (
    ((kind) => kind.$ === "Desugaring" && kind._0.$ === "ForLoop")(SyntaxContext.outer_expn_data(Span.ctxt(span)).kind)
  ) {
    code = cause_code;
  } else {
    return false;
  }

  // List of traits for which it would be nonsensical to suggest borrowing.
  // For instance, immutable references are always Copy, so suggesting to
  // borrow would always succeed, but it's probably not what the user wanted.
  const never_suggest_borrow: DefId[] = [LangItem.Copy, LangItem.Clone, LangItem.Unpin, LangItem.Sized]
    .map((lang_item) => this.tcx.lang_items().get(lang_item))
    .filter((d): d is DefId => d !== undefined);

  const send = this.tcx.get_diagnostic_item(sym.Send);
  if (send !== undefined) {
    const def_id = send;
    never_suggest_borrow.push(def_id);
  }

  // Try to apply the original trait bound by borrowing.
  const try_borrowing = (old_pred: PolyTraitClauseT, blacklist: readonly DefId[]): boolean => {
    if (blacklist.some((d) => DefId_eq(d, PolyTraitClause.def_id(old_pred)))) {
      return false;
    }
    // We map bounds to `&T` and `&mut T`
    const trait_pred_and_imm_ref = Binder.map_bound(old_pred, (trait_pred): [TraitClause, TyT] => [
      trait_pred,
      Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_static, TraitClause.self_ty(trait_pred)),
    ]);
    const trait_pred_and_mut_ref = Binder.map_bound(old_pred, (trait_pred): [TraitClause, TyT] => [
      trait_pred,
      Ty.new_mut_ref(this.tcx, this.tcx.lifetimes.re_static, TraitClause.self_ty(trait_pred)),
    ]);

    const imm_ref_self_ty_satisfies_pred = mk_result(trait_pred_and_imm_ref);
    const mut_ref_self_ty_satisfies_pred = mk_result(trait_pred_and_mut_ref);

    let ref_inner_ty_satisfies_pred: boolean;
    let ref_inner_ty_is_mut: boolean;
    let ok: ReturnType<TyT["kind"]>;
    if (obligation.cause.code_().$ === "WhereClauseInExpr" && (ok = Binder.skip_binder(PolyTraitClause.self_ty(old_pred)).kind()).$ === "Ref") {
      const ty = ok._1;
      const mutability = ok._2;
      [ref_inner_ty_satisfies_pred, ref_inner_ty_is_mut] = [
        mk_result(Binder.map_bound(old_pred, (trait_pred): [TraitClause, TyT] => [trait_pred, ty])),
        Mutability.is_mut(mutability),
      ];
    } else {
      [ref_inner_ty_satisfies_pred, ref_inner_ty_is_mut] = [false, false];
    }

    const is_immut = imm_ref_self_ty_satisfies_pred || (ref_inner_ty_satisfies_pred && !ref_inner_ty_is_mut);
    const is_mut = mut_ref_self_ty_satisfies_pred || ref_inner_ty_is_mut;
    if (!is_immut && !is_mut) {
      return false;
    }
    if (this.tcx.sess.source_map().span_to_snippet(span).$ !== "Ok") {
      return false;
    }
    // We don't want a borrowing suggestion on the fields in structs
    // ```
    // #[derive(Clone)]
    // struct Foo {
    //     the_foos: Vec<Foo>
    // }
    // ```
    const expn_kind = SyntaxContext.outer_expn_data(Span.ctxt(span)).kind;
    if (!(expn_kind.$ === "Root" || (expn_kind.$ === "Desugaring" && expn_kind._0.$ === "ForLoop"))) {
      return false;
    }
    // We have a very specific type of error, where just borrowing this argument
    // might solve the problem. In cases like this, the important part is the
    // original type obligation, not the last one that failed, which is arbitrary.
    // Because of this, we modify the error to refer to the original obligation and
    // return early in the caller.

    const label = (): void => {
      // Special case `Sized` as `old_pred` will be the trait itself instead of
      // `Sized` when the trait bound is the source of the error.
      const pk = Binder.skip_binder(obligation.predicate.kind());
      const is_sized = pk.$ === "Clause" && pk._0.$ === "Trait" ? this.tcx.is_lang_item(TraitClause.def_id(pk._0._0), LangItem.Sized) : false;

      const msg = `the trait bound \`${this.tcx.short_string(old_pred, err.long_ty_path(), print_PolyTraitClause)}\` is not satisfied`;
      const self_ty_str = this.tcx.short_string(PolyTraitClause.self_ty(old_pred), err.long_ty_path(), print_PolyTy);
      const trait_path = this.tcx.short_string(old_pred, err.long_ty_path(), print_PolyTraitClausePrintModifiersAndPath);

      if (has_custom_message) {
        const msg_ = is_sized ? "the trait bound `Sized` is not satisfied" : msg;
        err.note(msg_);
      } else {
        // PORT: field access through `Diag`'s `DerefMut` is `.deref_mut()`.
        err.deref_mut().messages = [[into_DiagMessage(msg), "NoStyle"]];
      }
      if (is_sized) {
        err.span_label(span, `the trait \`Sized\` is not implemented for \`${self_ty_str}\``);
      } else {
        err.span_label(span, `the trait \`${trait_path}\` is not implemented for \`${self_ty_str}\``);
      }
    };

    const sugg_prefixes: string[] = [];
    if (is_immut) {
      sugg_prefixes.push("&");
    }
    if (is_mut) {
      sugg_prefixes.push("&mut ");
    }
    const sugg_msg = `consider${is_mut && !is_immut ? " mutably" : ""} borrowing here`;

    // Issue #104961, we need to add parentheses properly for compound expressions
    // for example, `x.starts_with("hi".to_string() + "you")`
    // should be `x.starts_with(&("hi".to_string() + "you"))`
    const body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id);
    if (body === undefined) {
      return false;
    }
    const expr_finder = sugg_a_mod().FindExprBySpan.new(span, this.tcx);
    expr_finder.visit_expr(body.value);

    if (expr_finder.ty_result !== undefined) {
      const ty = expr_finder.ty_result;
      const parent = this.tcx.parent_hir_node(ty.hir_id);
      if (parent.$ === "Expr" && parent._0.kind.$ === "Path" && parent._0.kind._0.$ === "TypeRelative" && ty.span === span) {
        // We've encountered something like `str::from("")`, where the intended code
        // was likely `<&str>::from("")`. #143393.
        label();
        err.multipart_suggestions(
          sugg_msg,
          sugg_prefixes.map((sugg_prefix): [Span, string][] => [
            [Span.shrink_to_lo(span), `<${sugg_prefix}`],
            [Span.shrink_to_hi(span), ">"],
          ]),
          "MaybeIncorrect",
        );
        return true;
      }
      return false;
    }
    const expr = expr_finder.result;
    if (expr === undefined) {
      return false;
    }
    if (expr.kind.$ === "AddrOf") {
      return false;
    }
    const old_self_ty = TraitClause.self_ty(Binder.skip_binder(old_pred));
    if (
      !TypeVisitableExt.has_escaping_bound_vars(old_self_ty, fold_Ty) &&
      !this.where_clause_expr_matches_failed_self_ty(obligation, this.tcx.instantiate_bound_regions_with_erased(PolyTraitClause.self_ty(old_pred), fold_Ty))
    ) {
      return false;
    }
    const needs_parens_post = hir.expr_needs_parens(expr);
    const pn = this.tcx.parent_hir_node(expr.hir_id);
    const needs_parens_pre = pn.$ === "Expr" && pn._0.kind.$ === "MethodCall" && HirId_eq(pn._0.kind._1.hir_id, expr.hir_id);

    label();
    const suggestions = sugg_prefixes.map((sugg_prefix): [Span, string][] => {
      if (!needs_parens_pre && !needs_parens_post) {
        return [[Span.shrink_to_lo(span), sugg_prefix]];
      } else if (!needs_parens_pre && needs_parens_post) {
        // We have something like `foo.bar()`, where we want to bororw foo, so we need
        // to suggest `(&mut foo).bar()`.
        return [
          [Span.shrink_to_lo(span), `${sugg_prefix}(`],
          [Span.shrink_to_hi(span), ")"],
        ];
      } else if (needs_parens_pre && !needs_parens_post) {
        // Issue #109436, we need to add parentheses properly for method calls
        // for example, `foo.into()` should be `(&foo).into()`
        return [
          [Span.shrink_to_lo(span), `(${sugg_prefix}`],
          [Span.shrink_to_hi(span), ")"],
        ];
      } else {
        return [
          [Span.shrink_to_lo(span), `(${sugg_prefix}(`],
          [Span.shrink_to_hi(span), "))"],
        ];
      }
    });
    err.multipart_suggestions(sugg_msg, suggestions, "MaybeIncorrect");
    return true;
  };

  if (code.$ === "ImplDerived") {
    const cause = code._0;
    return try_borrowing(cause.derived.parent_trait_pred, []);
  } else if (code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") {
    return try_borrowing(poly_trait_pred, never_suggest_borrow);
  } else {
    return false;
  }
};

// Suggest borrowing the type
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2109 suggest_borrowing_for_object_cast
TypeErrCtxt.prototype.suggest_borrowing_for_object_cast = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation, self_ty: TyT, target_ty: TyT): void {
  const tk = target_ty.kind();
  if (!(tk.$ === "Ref" && tk._2 === "Not")) {
    return;
  }
  const object_ty = tk._1;
  const ok = object_ty.kind();
  if (ok.$ !== "Dynamic") {
    return;
  }
  const predicates = ok._0;
  const self_ref_ty = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, self_ty);

  for (const predicate of predicates) {
    if (!this.predicate_must_hold_modulo_regions(obligation.with(this.tcx, PolyExistentialPredicate.with_self_ty(predicate, this.tcx, self_ref_ty), upcast_Clause_to_Predicate))) {
      return;
    }
  }

  err.span_suggestion_verbose(
    Span.shrink_to_lo(obligation.cause.span),
    `consider borrowing the value, since \`&${display_Ty(self_ty)}\` can be coerced into \`${display_Ty(target_ty)}\``,
    "&",
    "MaybeIncorrect",
  );
};

/// Peel `&`-borrows from an expression, following through untyped let-bindings.
/// Returns a list of removable `&` layers (each with the span to remove and the
/// resulting type), plus an optional terminal [`hir::Param`] when the chain ends
/// at a function parameter (including async-fn desugared parameters).
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2146 peel_expr_refs
TypeErrCtxt.prototype.peel_expr_refs = function (this: TypeErrCtxt, expr_: hir.Expr, ty_: TyT): [PeeledRef[], hir.Param | undefined] {
  let expr = expr_;
  let ty = ty_;
  const refs: PeeledRef[] = [];
  outer: for (;;) {
    while (expr.kind.$ === "AddrOf") {
      const borrowed = expr.kind._2;
      const borrowed_span = Span.find_ancestor_inside(borrowed.span, expr.span);
      let span: Span;
      if (borrowed_span !== undefined) {
        span = Span.until(expr.span, borrowed_span);
      } else {
        break outer;
      }

      // Double check that the span actually corresponds to a borrow,
      // rather than some macro garbage.
      // The span may include leading parens from parenthesized expressions
      // (e.g., `(&expr)` where HIR removes the Paren but keeps the span).
      // In that case, trim the span to start at the `&`.
      const snippet = this.tcx.sess.source_map().span_to_snippet(span);
      let amp: number | undefined;
      if (snippet.$ === "Ok" && snippet._0.starts_with("&")) {
        // span
      } else if (snippet.$ === "Ok" && (amp = snippet._0.find("&")) !== undefined) {
        span = Span.with_lo(span, (Span.lo(span) + amp) as BytePos);
      } else {
        break outer;
      }

      const tk = ty.kind();
      if (tk.$ !== "Ref") {
        break outer;
      }
      ty = tk._1;
      refs.push({ span, peeled_ty: ty });
      expr = borrowed;
    }
    let binding_node: hir.Node;
    if (
      expr.kind.$ === "Path" &&
      expr.kind._0.$ === "Resolved" &&
      expr.kind._0._0 === undefined &&
      expr.kind._0._1.res.$ === "Local" &&
      (binding_node = this.tcx.hir_node(expr.kind._0._1.res._0)).$ === "Pat"
    ) {
      const binding = binding_node._0;
      const parent = this.tcx.parent_hir_node(binding.hir_id);
      // Untyped let-binding: follow to its initializer.
      if (parent.$ === "LetStmt" && parent._0.ty === undefined && parent._0.init !== undefined) {
        const init = parent._0.init;
        expr = init;
        continue;
      }
      // Async fn desugared parameter: `let x = __arg0;` with AsyncFn source.
      // Follow to the original parameter.
      let arg_binding_node: hir.Node;
      let param_node: hir.Node;
      if (
        parent.$ === "LetStmt" &&
        parent._0.source === "AsyncFn" &&
        parent._0.init !== undefined &&
        parent._0.init.kind.$ === "Path" &&
        parent._0.init.kind._0.$ === "Resolved" &&
        parent._0.init.kind._0._0 === undefined &&
        parent._0.init.kind._0._1.res.$ === "Local" &&
        (arg_binding_node = this.tcx.hir_node(parent._0.init.kind._0._1.res._0)).$ === "Pat" &&
        (param_node = this.tcx.parent_hir_node(arg_binding_node._0.hir_id)).$ === "Param"
      ) {
        return [refs, param_node._0];
      }
      // Direct parameter reference.
      if (parent.$ === "Param") {
        const param = parent._0;
        return [refs, param];
      }
      break outer;
    } else {
      break outer;
    }
  }
  return [refs, undefined];
};

/// Whenever references are used by mistake, like `for (i, e) in &vec.iter().enumerate()`,
/// suggest removing these references until we reach a type that implements the trait.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2223 suggest_remove_reference
TypeErrCtxt.prototype.suggest_remove_reference = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred_: PolyTraitClauseT): boolean {
  const span: MutRef<Span> = { value: obligation.cause.span };
  let trait_pred = trait_pred_;
  let code = obligation.cause.code_();
  let parent: [ObligationCauseCode, PolyTraitClauseT | undefined] | undefined;
  while ((parent = ObligationCauseCode.parent_with_predicate(code)) !== undefined && parent[1] !== undefined) {
    const [c, parent_trait_pred] = parent;
    // We want the root obligation, in order to detect properly handle
    // `for _ in &mut &mut vec![] {}`.
    code = c;
    trait_pred = parent_trait_pred;
  }
  while (Span.desugaring_kind(span.value) !== undefined) {
    // Remove all the hir desugaring contexts while maintaining the macro contexts.
    Span.remove_mark(span);
  }
  const expr_finder = sugg_a_mod().FindExprBySpan.new(span.value, this.tcx);
  const body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id);
  if (body === undefined) {
    return false;
  }
  expr_finder.visit_expr(body.value);
  const trait_pred_final = trait_pred;
  const maybe_suggest = (suggested_ty: TyT, count: number, suggestions: [Span, string][]): boolean => {
    // Remapping bound vars here
    const trait_pred_and_suggested_ty = Binder.map_bound(trait_pred_final, (trait_pred): [TraitClause, TyT] => [trait_pred, suggested_ty]);

    const new_obligation = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, trait_pred_and_suggested_ty);

    if (this.predicate_may_hold(new_obligation)) {
      const msg = count === 1 ? "consider removing the leading `&`-reference" : `consider removing ${count} leading \`&\`-references`;

      err.multipart_suggestion(msg, suggestions, "MachineApplicable");
      return true;
    } else {
      return false;
    }
  };

  // Maybe suggest removal of borrows from types in type parameters, like in
  // `src/test/ui/not-panic/not-panic-safe.rs`.
  let count = 0;
  const suggestions: [Span, string][] = [];
  // Skipping binder here, remapping below
  let suggested_ty = Binder.skip_binder(PolyTraitClause.self_ty(trait_pred));
  if (expr_finder.ty_result !== undefined) {
    let hir_ty: hir.Ty = expr_finder.ty_result;
    while (hir_ty.kind.$ === "Ref") {
      const ref_ty = hir_ty.kind._1;
      count += 1;
      const span = Span.until(hir_ty.span, ref_ty.span);
      suggestions.push([span, ""]);

      const sk = suggested_ty.kind();
      if (sk.$ !== "Ref") {
        break;
      }
      suggested_ty = sk._1;

      hir_ty = ref_ty;

      if (maybe_suggest(suggested_ty, count, suggestions.slice())) {
        return true;
      }
    }
  }

  // Maybe suggest removal of borrows from expressions, like in `for i in &&&foo {}`.
  const expr = expr_finder.result;
  if (expr === undefined) {
    return false;
  }
  // Skipping binder here, remapping below
  const suggested_ty_ = Binder.skip_binder(PolyTraitClause.self_ty(trait_pred));
  const [peeled_refs] = this.peel_expr_refs(expr, suggested_ty_);
  for (let i = 0; i < peeled_refs.length; i++) {
    const peeled = peeled_refs[i]!;
    const suggestions = peeled_refs.slice(0, i + 1).map((r): [Span, string] => [r.span, ""]);
    if (maybe_suggest(peeled.peeled_ty, i + 1, suggestions)) {
      return true;
    }
  }
  return false;
};

/// Suggest removing `&` from a function parameter type like `&impl Future`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2314 suggest_remove_ref_from_param
TypeErrCtxt.prototype.suggest_remove_ref_from_param = function (this: TypeErrCtxt, param: hir.Param, err: Diag): boolean {
  const decl = hir.Node.fn_decl(this.tcx.parent_hir_node(param.hir_id));
  let input_ty: hir.Ty | undefined;
  if (
    decl !== undefined &&
    (input_ty = decl.inputs.find((t) => Span.contains(param.ty_span, t.span))) !== undefined &&
    input_ty.kind.$ === "Ref"
  ) {
    const ty = input_ty.kind._1;
    const ref_span = Span.until(input_ty.span, ty.span);
    const snippet = this.tcx.sess.source_map().span_to_snippet(ref_span);
    if (snippet.$ === "Ok" && snippet._0.starts_with("&")) {
      err.span_suggestion_verbose(ref_span, "consider removing the `&` from the parameter type", "", "MaybeIncorrect");
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2336 suggest_remove_await
TypeErrCtxt.prototype.suggest_remove_await = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag): void {
  const peeled = ObligationCauseCode.peel_derives(obligation.cause.code_());
  let expr_node: hir.Node;
  if (peeled.$ === "AwaitableExpr" && (expr_node = this.tcx.hir_node(peeled._0)).$ === "Expr") {
    const hir_id = peeled._0;
    const expr = expr_node._0;
    // FIXME: use `obligation.predicate.kind()...trait_ref.self_ty()` to see if we have `()`
    // and if not maybe suggest doing something else? If we kept the expression around we
    // could also check if it is an fn call (very likely) and suggest changing *that*, if
    // it is from the local crate.

    // If the type is `&..&T` where `T: Future`, suggest removing `&`
    // instead of removing `.await`.
    const pk = Binder.skip_binder(obligation.predicate.kind());
    if (pk.$ === "Clause" && pk._0.$ === "Trait") {
      const pred = pk._0._0;
      const self_ty = TraitClause.self_ty(pred);
      const future_trait = this.tcx.require_lang_item(LangItem.Future, obligation.cause.span);

      // Peel through references to check if there's a Future underneath.
      let has_future: boolean;
      {
        let ty = self_ty;
        for (;;) {
          const k = ty.kind();
          if (k.$ === "Ref" && k._1.kind().$ !== "Dynamic") {
            const inner_ty = k._1;
            if (EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(future_trait, [inner_ty], obligation.param_env))) {
              has_future = true;
              break;
            }
            ty = inner_ty;
          } else {
            has_future = false;
            break;
          }
        }
      }

      if (has_future) {
        const [peeled_refs, terminal_param] = this.peel_expr_refs(expr, self_ty);

        // Try removing `&`s from the expression.
        for (let i = 0; i < peeled_refs.length; i++) {
          const peeled = peeled_refs[i]!;
          if (EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(future_trait, [peeled.peeled_ty], obligation.param_env))) {
            const count = i + 1;
            const msg = count === 1 ? "consider removing the leading `&`-reference" : `consider removing ${count} leading \`&\`-references`;
            const suggestions = peeled_refs.slice(0, i + 1).map((r): [Span, string] => [r.span, ""]);
            err.multipart_suggestion(msg, suggestions, "MachineApplicable");
            return;
          }
        }

        // Try removing `&` from the parameter type, but only when there's
        // no `&` in the expression itself (otherwise removing from the param
        // alone wouldn't fix the error).
        if (peeled_refs.length === 0 && terminal_param !== undefined && this.suggest_remove_ref_from_param(terminal_param, err)) {
          return;
        }

        // Fallback: emit a help message when we can't provide a specific span.
        err.help("a reference to a future is not a future; consider removing the leading `&`-reference");
        return;
      }
    }

    // use nth(1) to skip one layer of desugaring from `IntoIter::into_iter`
    let nth1: [HirId, hir.Node] | undefined;
    {
      let n = 0;
      for (const item of this.tcx.hir_parent_iter(hir_id)) {
        if (n === 1) {
          nth1 = item;
          break;
        }
        n += 1;
      }
    }
    let expr_span: Span | undefined;
    if (nth1 !== undefined && nth1[1].$ === "Expr" && (expr_span = Span.find_ancestor_inside_same_ctxt(expr.span, nth1[1]._0.span)) !== undefined) {
      const await_expr = nth1[1]._0;
      const removal_span = Span.to(Span.shrink_to_hi(this.tcx.sess.source_map().span_extend_while_whitespace(expr_span)), Span.shrink_to_hi(await_expr.span));
      err.span_suggestion_verbose(removal_span, "remove the `.await`", "", "MachineApplicable");
    } else {
      err.span_label(obligation.cause.span, "remove the `.await`");
    }
    // FIXME: account for associated `async fn`s.
    if (expr.kind.$ === "Call") {
      const span = expr.span;
      const base = expr.kind._0;
      const pk = Binder.skip_binder(obligation.predicate.kind());
      if (pk.$ === "Clause" && pk._0.$ === "Trait") {
        const pred = pk._0._0;
        err.span_label(span, `this call returns \`${display_Ty(TraitClause.self_ty(pred))}\``);
      }
      const typeck_results = this.typeck_results;
      let ty: TyT;
      let tk: ReturnType<TyT["kind"]>;
      let item_node: hir.Node | undefined;
      if (
        typeck_results !== undefined &&
        ((ty = typeck_results.expr_ty_adjusted(base)), true) &&
        (tk = ty.kind()).$ === "FnDef" &&
        (item_node = this.tcx.hir_get_if_local(tk._0)) !== undefined &&
        item_node.$ === "Item"
      ) {
        const item = item_node._0;
        const [ident] = item.expect_fn();
        const msg = `alternatively, consider making \`fn ${display_Ident(ident)}\` asynchronous`;
        if (Span.is_empty(item.vis_span)) {
          err.span_suggestion_verbose(Span.shrink_to_lo(item.span), msg, "async ", "MaybeIncorrect");
        } else {
          err.span_suggestion_verbose(Span.shrink_to_hi(item.vis_span), msg, " async", "MaybeIncorrect");
        }
      }
    }
  }
};

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6875 SelfVisitor
// PORT: hand-written with its derived Debug (types.sets.json `skip`); `paths: Vec<&hir::Ty> = Vec::new()` (default field
// value) is the constructor's default.
export class SelfVisitor extends hir.intravisit.Visitor {
  constructor(
    public paths: hir.Ty[] = [],
    public name: Symbol | undefined,
  ) {
    super();
  }

  // impl<'v> Visitor<'v> for SelfVisitor<'v>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6881 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    let path: hir.QPath, inner_ty: hir.Ty, segment: hir.PathSegment, inner_path_: hir.QPath, inner_path: hir.Path;
    if (
      ty.kind.$ === "Path" &&
      ((path = ty.kind._0), true) &&
      path.$ === "TypeRelative" &&
      ((inner_ty = path._0), (segment = path._1), true) &&
      (segment.ident.name === this.name || this.name === undefined) &&
      inner_ty.kind.$ === "Path" &&
      ((inner_path_ = inner_ty.kind._0), true) &&
      inner_path_.$ === "Resolved" &&
      inner_path_._0 === undefined &&
      ((inner_path = inner_path_._1), true) &&
      inner_path.res.$ === "SelfTyAlias"
    ) {
      this.paths.push(ty.as_unambig_ty());
    }
    hir.intravisit.walk_ty(this, ty);
    return undefined;
  }
}

/** `#[derive(Debug)]` on `SelfVisitor`. */
export const debug_SelfVisitor: Debug<SelfVisitor> = (v, f) =>
  debug_struct(f, "SelfVisitor", [
    ["paths", debug_vec(v.paths, f, (x, f) => debug_hir_Ty(x, f, (_x, _f) => "()"))],
    ["name", debug_option(v.name, f, debug_Symbol)],
  ]);

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6898 ReturnsVisitor
/// Collect all the returned expressions within the input expression.
/// Used to point at the return spans when we want to suggest some change to them.
// PORT: `#[derive(Default)]` is the constructor's defaults (`ReturnsVisitor.default()` = `new ReturnsVisitor()`).
export class ReturnsVisitor extends hir.intravisit.Visitor {
  constructor(
    public returns: hir.Expr[] = [],
    public in_block_tail: boolean = false,
  ) {
    super();
  }

  /** `#[derive(Default)]` */
  static default(): ReturnsVisitor {
    return new ReturnsVisitor();
  }

  // impl<'v> Visitor<'v> for ReturnsVisitor<'v>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6904 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    const kind = ex.kind;
    if (kind.$ === "Ret" && kind._0 !== undefined) {
      const ex = kind._0;
      this.returns.push(ex);
    } else if (kind.$ === "Block" && this.in_block_tail) {
      const block = kind._0;
      this.in_block_tail = false;
      for (const stmt of block.stmts) {
        hir.intravisit.walk_stmt(this, stmt);
      }
      this.in_block_tail = true;
      if (block.expr !== undefined) {
        const expr = block.expr;
        this.visit_expr(expr);
      }
    } else if (kind.$ === "If" && this.in_block_tail) {
      const then = kind._1;
      const else_opt = kind._2;
      this.visit_expr(then);
      if (else_opt !== undefined) {
        const el = else_opt;
        this.visit_expr(el);
      }
    } else if (kind.$ === "Match" && this.in_block_tail) {
      const arms = kind._1;
      for (const arm of arms) {
        this.visit_expr(arm.body);
      }
    } else if (!this.in_block_tail) {
      hir.intravisit.walk_expr(this, ex);
    } else {
      this.returns.push(ex);
    }
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6940 visit_body
  override visit_body(body: hir.Body): undefined {
    assert(!this.in_block_tail, "assertion failed: !self.in_block_tail");
    this.in_block_tail = true;
    hir.intravisit.walk_body(this, body);
    return undefined;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6949 AwaitsVisitor
/// Collect all the awaited expressions within the input expression.
// PORT: `#[derive(Default)]` is the constructor's default.
export class AwaitsVisitor extends hir.intravisit.Visitor {
  constructor(public awaits: HirId[] = []) {
    super();
  }

  /** `#[derive(Default)]` */
  static default(): AwaitsVisitor {
    return new AwaitsVisitor();
  }

  // impl<'v> Visitor<'v> for AwaitsVisitor

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6954 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (ex.kind.$ === "Yield" && ex.kind._1.$ === "Await" && ex.kind._1.expr !== undefined) {
      const id = ex.kind._1.expr;
      this.awaits.push(id);
    }
    return hir.intravisit.walk_expr(this, ex);
  }
}

/** PORT(hand type): suggestions.rs:6997, an intravisit `Visitor`: lane errrep-sugg-c. */
export type ReplaceImplTraitVisitor = unknown;

/** PORT(hand type): suggestions.rs:7068, a `TypeFolder`: lane errrep-sugg-c. */
export type ReplaceImplTraitFolder = unknown;

/** PORT(hand type): suggestions.rs:7304, an intravisit `Visitor`: lane errrep-sugg-c. */
export type FindTypeParam = unknown;

/** PORT(hand type): suggestions.rs:7348, a `TypeVisitor` with `can_suggest_bound`: lane errrep-sugg-c. */
export type ParamFinder = unknown;

// error_reporting/traits/suggestions.rs:6792 (stub; lane errrep-sugg-c)
export const hint_missing_borrow = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::hint_missing_borrow")) as Fns_error_reporting_traits_suggestions["hint_missing_borrow"];
// error_reporting/traits/suggestions.rs:7023 (stub; lane errrep-sugg-c)
export const get_explanation_based_on_obligation = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::get_explanation_based_on_obligation")) as Fns_error_reporting_traits_suggestions["get_explanation_based_on_obligation"];
// error_reporting/traits/suggestions.rs:7089 (stub; lane errrep-sugg-c)
export const suggest_desugaring_async_fn_to_impl_future_in_trait = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::suggest_desugaring_async_fn_to_impl_future_in_trait")) as Fns_error_reporting_traits_suggestions["suggest_desugaring_async_fn_to_impl_future_in_trait"];
// error_reporting/traits/suggestions.rs:7154 (stub; lane errrep-sugg-c)
export const point_at_assoc_type_restriction = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::point_at_assoc_type_restriction")) as Fns_error_reporting_traits_suggestions["point_at_assoc_type_restriction"];
// error_reporting/traits/suggestions.rs:7291 (stub; lane errrep-sugg-c)
export const get_deref_type_and_refs = ((): never => unported("rustc_trait_selection::error_reporting::traits::suggestions::get_deref_type_and_refs")) as Fns_error_reporting_traits_suggestions["get_deref_type_and_refs"];

// ==== lane errrep-sugg-b: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "suggest_change_mut", "suggest_semicolon_removal", "removable_trailing_semicolon", "emit_semicolon_removal_suggestion", "suggest_semicolon_removal_in_closure_arg", "suggest_borrow_for_unsized_closure_return", "return_type_span", "suggest_impl_trait", "report_closure_arg_mismatch", "note_conflicting_fn_args", "note_conflicting_closure_bounds", "suggest_fully_qualified_path", "maybe_note_obligation_cause_for_async_await", "note_obligation_cause_for_async_await", "note_closure_capture", "note_obligation_cause_code", "note_obligation_cause_code_inner",
]);

// ==== lane errrep-sugg-c: error_reporting/traits/suggestions.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt", [
  "suggest_await_before_try", "suggest_floating_point_literal", "can_suggest_derive", "suggest_derive", "suggest_dereferencing_index", "note_function_argument_obligation", "suggest_option_method_if_applicable", "look_for_iterator_item_mistakes", "point_at_chain", "probe_assoc_types_at_expr", "point_at_chain_in_return_position", "suggest_convert_to_slice", "suggest_tuple_wrapping", "suggest_shadowed_inherent_method", "explain_hrtb_projection", "suggest_desugaring_async_fn_in_trait", "ty_kind_suggestion", "suggest_add_result_as_return_type", "suggest_unsized_bound_if_applicable", "suggest_indirection_for_unsized", "suggest_swapping_lhs_and_rhs", "is_truly_imperfect_derive",
]);
