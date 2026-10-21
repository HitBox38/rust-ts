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
import { debug_Symbol, display_Ident, display_Symbol, Ident, kw, sym, Symbol } from "../../../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_vec } from "../../../std/fmt.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { assert, unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_traits_suggestions } from "../../decls.ts";
// ---- imports of lane errrep-sugg-b (suggestions.rs:2485..5017) ----
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { type Applicability, type Diag, E0631, E0746, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import { UnstableFeatures } from "../../../rustc_feature/lib.ts";
import { DefKind, Res } from "../../../rustc_hir/def.ts";
import { HirId_eq } from "../../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import { pluralize } from "../../../rustc_lint_defs/lib.ts";
import { Level } from "../../../rustc_middle/middle/privacy.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { type DerivedCause, EvaluationResult, ObligationCauseCode, ObligationCauseCodeHandle } from "../../../rustc_middle/traits/mod.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, ParamEnv, Predicate } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type Generics } from "../../../rustc_middle/ty/generics.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { Asyncness, Term, Ty, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_PolyHostEffectClause, Predicate_upcast_from_PolyTraitClause } from "../../../rustc_middle/ty/predicate.ts";
import { PolyTraitClause } from "../../../rustc_type_ir/predicate.ts";
import { IrPrint_print, print_Ty, type PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import {
  display_Predicate,
  display_TraitClausePrintModifiersAndPath,
  display_Ty,
  type PrettyPrinter,
  PolyTraitClause_print_modifiers_and_trait_path,
  PolyTraitRef_print_only_trait_path,
  print_Binder,
  print_TraitClausePrintModifiersAndPath,
  print_TraitRefPrintOnlyTraitPath,
  TraitClause_print_modifiers_and_trait_path,
  type TraitClausePrintModifiersAndPath,
  type TraitRefPrintOnlyTraitPath,
  with_forced_trimmed_paths,
  with_no_trimmed_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { display_AssocKind } from "../../../rustc_middle/ty/assoc.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { UpvarArgs } from "../../../rustc_middle/ty/sty.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/typeck_results.ts";
import { DefId, DefId_eq, DefIdSet, LocalDefId } from "../../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, Span } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import type { Symbol as Symbol_ } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable, TypeSuperFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import {
  display_BoundConstness,
  type HostEffectClause,
  PolyHostEffectClause,
  PolyTraitClause as PolyTraitClause_,
  ProjectionClause,
  TraitClause,
  TraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import { fold_with_TraitClause, fold_with_TraitRef, try_fold_with_TraitClause, try_fold_with_TraitRef, visit_with_TraitClause, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { debug_TyKind, FnSig, fold_FnSig, PolyFnSigTys } from "../../../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { type TypeSuperVisitable, TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../../../std/panic.ts";
import { is_whitespace } from "../../../std/char.ts";
import { Ok } from "../../../std/result.ts";
import { CoroutineData, type CoroutineInteriorOrUpvar } from "./suggestions.gen.ts";
// ---- end imports of lane errrep-sugg-b ----

// ==== lane errrep-sugg-a: suggestions.rs:1..2484 (`CoroutineData`'s impl, `predicate_constraint`, `suggest_restriction`,
// the `impl TypeErrCtxt` methods `note_field_shadowed_by_private_candidate_in_cause` .. `suggest_remove_await`) ====
// PORT: this lane's imports are a separate block (the file is split between three lanes).
// Init order: `FindExprBySpan` (./mod.ts) and `SelectionContext` (traits/select/mod.ts) are read lazily (`sugg_a_mod()`,
// `sugg_a_select()`): this module is evaluated while those close cycles.
import { BINARY_OPERATORS } from "../../../rustc_attr_ir/lang_items.ts";
import type { Stability } from "../../../rustc_attr_ir/lib.ts";
import { BindingMode, BindingMode_eq } from "../../../rustc_ast/lib.ts";
import { into_DiagMessage, into_MultiSpan } from "../../../rustc_errors/lib.ts";
import { HirIdSet } from "../../../rustc_hir_id/lib.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.ts";
import { Obligation } from "../../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { IsSuggestable, suggest_arbitrary_trait_bound, suggest_constraining_type_param } from "../../../rustc_middle/ty/diagnostics.ts";
import type { Clauses, Region, Ty as TyT } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg, fold_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericParamDefKind, type GenericParamDef } from "../../../rustc_middle/ty/generics.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import {
  print_TraitClause,
  print_TraitRefPrintSugared,
  TraitRef_print_trait_sugared,
  with_types_for_suggestion,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { ParamTy } from "../../../rustc_middle/ty/sty.ts";
import { fold_Clauses } from "../../../rustc_middle/ty/structural_impls.ts";
import { FileName } from "../../../rustc_span/lib.ts";
import { Symbol as SymbolC } from "../../../rustc_span/symbol.ts";
import { str_cmp } from "../../../rustc_session/options.ts";
import type { TypeFolder } from "../../../rustc_type_ir/fold.ts";
import type { PolyTraitClause as PolyTraitClauseT } from "../../../rustc_middle/ty/predicate.gen.ts";
import type { ProjectionAliasTy as ProjectionAliasTyT } from "../../../rustc_type_ir/ty/alias.ts";
import {
  as_interner,
  PolyExistentialPredicate,
} from "../../../rustc_type_ir/predicate.ts";
import { ClosureArgs, CoroutineClosureArgs, CoroutineClosureSignature } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { fold_with_FnSig, PolyFnSig as PolyFnSigC, try_fold_with_FnSig, visit_with_FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { AliasTy, ProjectionAliasTy } from "../../../rustc_type_ir/ty_kind.ts";
import { UnnormalizedClause, UnnormalizedPolyTraitClause } from "../../../rustc_type_ir/unnormalized.ts";
import { str_trim_start, Str } from "../../../std/str.ts";
import type { PeeledRef } from "./suggestions.gen.ts";
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
      new ReplaceImplTraitFolder(tcx, param, ParamTy.to_ty(ParamTy.new(generics.count(), SymbolC.intern(type_param_name)), tcx)),
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
      new ReplaceImplTraitVisitor(ty_spans, param.def_id).visit_ty_unambig(input);
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

  const finder = new ParamFinder();
  finder.visit_binder(trait_pred, d_TraitClause());

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
};

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
      const name_ = this.get_closure_name(def_id, err, msg);
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
// ---- imports of lane errrep-sugg-c ----
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { StabilityLevel } from "../../../rustc_attr_ir/stability.ts";
import type { MultiSpan as MultiSpanT } from "../../../rustc_error_messages/lib.ts";
import { ToTrace_GenericArg } from "../../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import type { PredicateObligations } from "../../../rustc_infer/traits/mod.ts";
import { clone_ObligationCause, type ImplDerivedCause } from "../../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../../rustc_middle/ty/adt.ts";
import { AssocItems } from "../../../rustc_middle/ty/assoc.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import {
  Predicate_upcast_from_Binder_PredicateKind,
  Predicate_upcast_from_PolyTraitRef,
} from "../../../rustc_middle/ty/predicate.ts";
import { LocalDefId as LocalDefIdC } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, PathBuf } from "../../../rustc_span/lib.ts";
import type { PolyFnSig as PolyFnSigT, PolyProjectionClause, PredicateKind, TraitClause as TraitClauseT, TraitRef as TraitRefT } from "../../../rustc_type_ir/decls.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { type PredicateProxy, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { display_TraitRef } from "../../../rustc_type_ir/ir_print.ts";
import {
  fold_with_ProjectionClause,
  PolyTraitClause as PolyTraitClauseC,
  try_fold_with_ProjectionClause,
  visit_with_ProjectionClause,
} from "../../../rustc_type_ir/predicate.ts";
import { d_PredicateKind } from "../../../rustc_type_ir/relate/combine.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { FnSig as FnSigC, FnSigTys, type TyKind } from "../../../rustc_type_ir/ty_kind.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { format_debug } from "../../../std/fmt.ts";
import type { Result } from "../../../std/result.ts";
import { to_uppercase } from "../../../std/char.ts";
import type { ImplCandidate } from "./mod.gen.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_FnSigTys, try_fold_with_FnSigTys, visit_with_FnSigTys, type FnSigTys as FnSigTysT } from "../../../rustc_type_ir/ty_kind.ts";

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


// ==== lane errrep-sugg-b: error_reporting/traits/suggestions.rs:2485..5017 ====
// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx> (continued)

/// Check if the trait bound is implemented for a different mutability and note it in the
/// final error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2488 suggest_change_mut
TypeErrCtxt.prototype.suggest_change_mut = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred_: PolyTraitClauseT): void {
  const points_at_arg = obligation.cause.code_().$ === "FunctionArg";

  const span = obligation.cause.span;
  const snippet_r = this.tcx.sess.source_map().span_to_snippet(span);
  if (snippet_r.$ === "Ok") {
    const snippet = snippet_r._0.toString();
    const non_ws = chars(snippet).filter((c) => !is_whitespace(c));
    let refs_number = 0;
    while (refs_number < non_ws.length && non_ws[refs_number] === C_AMP) refs_number++;
    if (non_ws[refs_number] === C_QUOTE) {
      // Do not suggest removal of borrow from type arguments.
      return;
    }
    const trait_pred = this.deeply_resolve_ignoring_regions(trait_pred_, d_PolyTraitClause_b());
    if (TypeVisitableExt.has_non_region_infer(trait_pred, d_PolyTraitClause_b())) {
      // Do not ICE while trying to find if a reborrow would succeed on a trait with
      // unresolved bindings.
      return;
    }

    // Skipping binder here, remapping below
    const self_ty_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
    if (self_ty_kind.$ === "Ref") {
      const region = self_ty_kind._0;
      const t_type = self_ty_kind._1;
      const mutability = self_ty_kind._2;
      let suggested_ty: Ty;
      switch (mutability) {
        case "Mut":
          suggested_ty = Ty.new_imm_ref(this.tcx, region, t_type);
          break;
        case "Not":
          suggested_ty = Ty.new_mut_ref(this.tcx, region, t_type);
          break;
      }

      // Remapping bound vars here
      const trait_pred_and_suggested_ty = Binder.map_bound(trait_pred, (trait_pred): [TraitClause, Ty] => [trait_pred, suggested_ty]);

      const new_obligation = this.mk_trait_obligation_with_new_self_ty(obligation.param_env, trait_pred_and_suggested_ty);
      const suggested_ty_would_satisfy_obligation = EvaluationResult.must_apply_modulo_regions(this.evaluate_obligation_no_overflow(new_obligation));
      if (suggested_ty_would_satisfy_obligation) {
        const sp = this.tcx.sess.source_map().span_take_while(span, (c) => is_whitespace(c) || c === C_AMP);
        if (
          points_at_arg &&
          mutability === "Not" &&
          refs_number > 0 &&
          // The borrow can sit in a macro body, where rewriting it would edit the
          // macro definition and so every one of its call sites, or a crate the user
          // does not own. Fall through to the note in that case.
          Span.can_be_used_for_suggestions(span)
        ) {
          // If we have a call like foo(&mut buf), then don't suggest foo(&mut mut buf)
          if (trim_start_matches(snippet, (c) => is_whitespace(c) || c === C_AMP).startsWith("mut")) {
            return;
          }
          err.span_suggestion_verbose(sp, "consider changing this borrow's mutability", "&mut ", "MachineApplicable");
        } else {
          err.note(
            `\`${display_PolyTraitClausePrintModifiersAndPath_b(PolyTraitClause_print_modifiers_and_trait_path(trait_pred))}\` is implemented for \`${display_Ty(suggested_ty)}\`, but not for \`${display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)))}\``,
          );
        }
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2571 suggest_semicolon_removal
TypeErrCtxt.prototype.suggest_semicolon_removal = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  span: Span,
  trait_pred: PolyTraitClauseT,
): boolean {
  if (!Binder.skip_binder(PolyTraitClause_.self_ty(trait_pred)).is_unit()) {
    return false;
  }
  const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
  let candidate: [hir.Stmt, hir.Expr, Ty] | undefined;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    const sig = node._0.kind.sig;
    const body_id = node._0.kind.body;
    const body_kind = this.tcx.hir_body(body_id).value.kind;
    if (
      body_kind.$ === "Block" &&
      Span.overlaps(hir.FnRetTy.span(sig.decl.output), span) &&
      (candidate = this.removable_trailing_semicolon(body_kind._0, obligation, trait_pred)) !== undefined
    ) {
      // A function body has a single return type, so keeping the value can't break any
      // other use of it.
      this.emit_semicolon_removal_suggestion(err, trait_pred, candidate, "MachineApplicable");
      return true;
    }
  }
  return this.suggest_semicolon_removal_in_closure_arg(obligation, err, trait_pred);
};

/// If the value of `block` is discarded by a trailing semicolon and keeping it would satisfy
/// `trait_pred`, return that statement, its expression and the type of that expression.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2604 removable_trailing_semicolon
TypeErrCtxt.prototype.removable_trailing_semicolon = function (
  this: TypeErrCtxt,
  block: hir.Block,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
): [hir.Stmt, hir.Expr, Ty] | undefined {
  if (block.expr === undefined && block.stmts.length > 0) {
    const stmt = block.stmts[block.stmts.length - 1]!;
    if (stmt.kind.$ === "Semi") {
      const expr = stmt.kind._0;
      if (
        !Span.from_expansion(stmt.span) &&
        expr.kind.$ !== "Err" &&
        // Only suggest this if the expression behind the semicolon implements the predicate
        this.typeck_results !== undefined
      ) {
        const typeck_results = this.typeck_results;
        const ty_ = typeck_results.expr_ty_opt(expr);
        const ty = ty_ === undefined ? undefined : this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
        if (
          ty !== undefined &&
          this.predicate_may_hold(
            this.mk_trait_obligation_with_new_self_ty(
              obligation.param_env,
              Binder.map_bound(trait_pred, (trait_pred): [TraitClause, Ty] => [trait_pred, ty]),
            ),
          )
        ) {
          return [stmt, expr, ty];
        }
      }
    }
  }
  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2629 emit_semicolon_removal_suggestion
TypeErrCtxt.prototype.emit_semicolon_removal_suggestion = function (
  this: TypeErrCtxt,
  err: Diag,
  trait_pred: PolyTraitClauseT,
  [stmt, expr, ty]: [hir.Stmt, hir.Expr, Ty],
  applicability: Applicability,
): void {
  err.span_label(
    expr.span,
    `this expression has type \`${display_Ty(ty)}\`, which implements \`${display_PolyTraitClausePrintModifiersAndPath_b(PolyTraitClause_print_modifiers_and_trait_path(trait_pred))}\``,
  );
  err.span_suggestion(this.tcx.sess.source_map().end_point(stmt.span), "remove this semicolon", "", applicability);
};

/// Detect when a closure argument returns `()` because of a trailing semicolon and that makes
/// a trait bound on the function's generic param fail, and suggest removing the semicolon:
///
/// ```text
/// fn bar<R: Bar>(_: impl Fn() -> R) {}
/// bar(|| { 5u8; })
/// //          - help: remove this semicolon
/// ```
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2660 suggest_semicolon_removal_in_closure_arg
TypeErrCtxt.prototype.suggest_semicolon_removal_in_closure_arg = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClauseT,
): boolean {
  const peeled = ObligationCauseCode.peel_derives(obligation.cause.code_());
  if (peeled.$ !== "WhereClauseInExpr") {
    return false;
  }
  const callee_def_id = peeled._0;
  const hir_id = peeled._2;
  const idx = peeled._3;
  // This cause code is used for the clauses of any item named in an expression, like an
  // associated const or a type alias, and `fn_sig` is only defined for functions.
  const callee_kind = this.tcx.def_kind(callee_def_id);
  if (!(callee_kind.$ === "Fn" || callee_kind.$ === "AssocFn")) {
    return false;
  }
  const node = this.tcx.hir_node(hir_id);
  if (node.$ !== "Expr") {
    return false;
  }
  const expr = node._0;
  const typeck_results_ = this.typeck_results;
  if (typeck_results_ === undefined) {
    return false;
  }
  const typeck_results: TypeckResults = typeck_results_;
  let args: hir.Expr[];
  if (expr.kind.$ === "MethodCall") {
    const receiver = expr.kind._1;
    args = [receiver, ...expr.kind._2];
  } else {
    // For a call like `bar(..)` the obligation is attached to the callee path expression,
    // so the arguments live in its parent.
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "Call" && HirId_eq(parent._0.kind._0.hir_id, expr.hir_id)) {
      args = [...parent._0.kind._1];
    } else {
      return false;
    }
  }
  // Work with the callee's own clauses and signature, where the failing bound is still
  // written in terms of the generic param it was declared on.
  const clauses = GenericClauses.instantiate_identity(this.tcx.clauses_of(callee_def_id) as GenericClauses, this.tcx);
  const failed_clause = clauses.clauses[idx];
  const failed_kind = failed_clause === undefined ? undefined : Binder.skip_binder(Unnormalized.skip_norm_wip(failed_clause).kind());
  if (failed_kind === undefined || failed_kind.$ !== "Trait") {
    return false;
  }
  const failed = failed_kind._0;
  const sig = Binder.skip_binder(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(callee_def_id) as EarlyBinder<PolyFnSig>)));
  // PORT: the lazy `filter_map` iterator; `candidates.next()` twice reads at most the first two candidates.
  const tcx = this.tcx;
  const self = this;
  function* candidates_iter(): Generator<[hir.Stmt, hir.Expr, Ty], void, undefined> {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const r = (() => {
        // The bound has to be on what the closure returns. A bound on an unrelated param that
        // also happened to be inferred as `()` would not be satisfied by removing a semicolon.
        const input = FnSig.inputs(sig)[i];
        if (input === undefined) return undefined;
        const declared = input.peel_refs();
        if (
          !clauses.clauses.some((clause) => {
            const k = Binder.skip_binder(Unnormalized.skip_norm_wip(clause).kind());
            if (k.$ !== "Projection") return false;
            const proj = k._0;
            return (
              tcx.is_lang_item(ProjectionClause.def_id(proj), LangItem.FnOnceOutput) &&
              AliasTerm.self_ty(proj.projection_term) === declared &&
              Term.as_type(proj.term) === TraitClause.self_ty(failed)
            );
          })
        ) {
          return undefined;
        }
        // The error can be reported while the closure argument is still being checked, before
        // its own type is recorded, so identify closures syntactically and only fall back to
        // the argument's type (e.g. for a closure bound to a variable and passed by path).
        let closure_def_id: LocalDefId;
        if (arg.kind.$ === "Closure") {
          closure_def_id = arg.kind._0.def_id;
        } else {
          const adj = typeck_results.expr_ty_adjusted_opt(arg);
          const k = adj === undefined ? undefined : self.deeply_resolve_ignoring_regions(adj, fold_Ty).peel_refs().kind();
          if (k !== undefined && k.$ === "Closure") {
            const local = k._0.as_local();
            if (local === undefined) return undefined;
            closure_def_id = local;
          } else {
            return undefined;
          }
        }
        const cnode = tcx.hir_node_by_def_id(closure_def_id);
        if (!(cnode.$ === "Expr" && cnode._0.kind.$ === "Closure")) {
          return undefined;
        }
        const closure = cnode._0.kind._0;
        const body_kind = tcx.hir_body(closure.body).value.kind;
        if (!(body_kind.$ === "Block" && body_kind._1 === undefined)) {
          return undefined;
        }
        return self.removable_trailing_semicolon(body_kind._0, obligation, trait_pred);
      })();
      if (r !== undefined) yield r;
    }
  }
  const candidates = candidates_iter();
  // Only emit the suggestion when a single closure argument matches, to avoid pointing at
  // an unrelated closure.
  const first = candidates.next();
  if (!first.done && candidates.next().done) {
    const candidate = first.value;
    // The same closure can be passed to somewhere else that expects it to return `()`,
    // where keeping the value would introduce a new error.
    this.emit_semicolon_removal_suggestion(err, trait_pred, candidate, "MaybeIncorrect");
    return true;
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2765 suggest_borrow_for_unsized_closure_return
TypeErrCtxt.prototype.suggest_borrow_for_unsized_closure_return = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  predicate: Predicate,
): void {
  const pred = predicate.as_trait_clause();
  if (pred === undefined) {
    return;
  }
  if (!this.tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized)) {
    return;
  }

  const span = err.deref().span.primary_span();
  if (span === undefined) {
    return;
  }
  const body_id = hir.Node.body_id(this.tcx.hir_node_by_def_id(body_def_id));
  if (body_id === undefined) {
    return;
  }
  const body = this.tcx.hir_body(body_id);
  const expr_finder = traits_er_mod().FindExprBySpan.new(span, this.tcx);
  expr_finder.visit_expr(body.value);
  const expr = expr_finder.result;
  if (expr === undefined) {
    return;
  }

  const find_closure = (args: readonly hir.Expr[]): hir.Closure | undefined => {
    for (const arg of args) {
      if (arg.kind.$ === "Closure") return arg.kind._0;
    }
    return undefined;
  };
  let closure: hir.Closure | undefined;
  switch (expr.kind.$) {
    case "Call":
      closure = find_closure(expr.kind._1);
      break;
    case "MethodCall":
      closure = find_closure(expr.kind._2);
      break;
    default:
      closure = undefined;
  }
  if (closure === undefined) {
    return;
  }
  if (closure.fn_decl.output.$ !== "DefaultReturn") {
    return;
  }

  err.span_suggestion_verbose(Span.shrink_to_lo(this.tcx.hir_body(closure.body).value.span), "consider borrowing the value", "&", "MaybeIncorrect");
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2819 return_type_span
TypeErrCtxt.prototype.return_type_span = function (this: TypeErrCtxt, obligation: PredicateObligation): Span | undefined {
  const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
  if (!(node.$ === "Item" && node._0.kind.$ === "Fn")) {
    return undefined;
  }
  const sig = node._0.kind.sig;

  if (sig.decl.output.$ === "Return") {
    return sig.decl.output._0.span;
  } else {
    return undefined;
  }
};

/// If all conditions are met to identify a returned `dyn Trait`, suggest using `impl Trait` if
/// applicable and signal that the error has been expanded appropriately and needs to be
/// emitted.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2832 suggest_impl_trait
TypeErrCtxt.prototype.suggest_impl_trait = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClauseT): boolean {
  if (obligation.cause.code_().$ !== "SizedReturnType") {
    return false;
  }
  if (Binder.skip_binder(PolyTraitClause_.self_ty(trait_pred)).kind().$ !== "Dynamic") {
    return false;
  }
  {
    const fn_sig = fn_sig_of_node(this.tcx.hir_node_by_def_id(obligation.cause.body_def_id));
    if (fn_sig !== undefined && fn_sig.decl.output.$ === "Return") {
      const ty = fn_sig.decl.output._0;
      if (ty.kind.$ === "Path") {
        const qpath = ty.kind._0;
        if (qpath.$ === "Resolved" && qpath._0 === undefined) {
          const path = qpath._1;
          if (path.res.$ === "Def" && path.res._0.$ === "TyAlias") {
            const def_id = path.res._1;
            // Do not suggest
            // type T = dyn Trait;
            // fn foo() -> impl T { .. }
            err.span_note(this.tcx.def_span(def_id), "this type alias is unsized");
            err.multipart_suggestion(
              "consider boxing the return type, and wrapping all of the returned values in `Box::new`",
              [
                [Span.shrink_to_lo(ty.span), "Box<"],
                [Span.shrink_to_hi(ty.span), ">"],
              ],
              "MaybeIncorrect",
            );
            return false;
          }
        }
      }
    }
  }

  err.code(E0746);
  err.primary_message("return type cannot be a trait object without pointer indirection");
  err.deref_mut().children.length = 0;

  let span = obligation.cause.span;
  let is_async_fn_return = false;
  if (this.tcx.def_kind(obligation.cause.body_def_id).$ === "Closure") {
    const parent = this.tcx.local_parent(obligation.cause.body_def_id);
    const parent_kind = this.tcx.def_kind(parent);
    if ((parent_kind.$ === "Fn" || parent_kind.$ === "AssocFn") && Asyncness.is_async(this.tcx.asyncness(parent) as Asyncness)) {
      const fn_sig = fn_sig_of_node(this.tcx.hir_node_by_def_id(parent));
      if (fn_sig !== undefined) {
        // Do not suggest (#147894)
        // async fn foo() -> dyn Display impl { .. }
        // and
        // async fn foo() -> dyn Display Box<dyn { .. }>
        span = hir.FnRetTy.span(fn_sig.decl.output);
        is_async_fn_return = true;
        err.span(span);
      }
    }
  }
  const body = this.tcx.hir_body_owned_by(obligation.cause.body_def_id);

  if (!is_async_fn_return) {
    const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
    if (node.$ === "Expr" && node._0.kind.$ === "Closure" && node._0.kind._0.fn_decl.output.$ === "DefaultReturn") {
      return true;
    }
  }

  const visitor = ReturnsVisitor.default();
  visitor.visit_body(body);

  let pre: string;
  let impl_span: Span;
  const snip = this.tcx.sess.source_map().span_to_snippet(span);
  if (snip.$ === "Ok" && snip._0.toString().startsWith("dyn ")) {
    pre = "";
    impl_span = Span.with_hi(span, BytePos(Span.lo(span) + 4));
  } else {
    pre = "dyn ";
    impl_span = Span.shrink_to_lo(span);
  }

  err.span_suggestion_verbose(impl_span, "consider returning an `impl Trait` instead of a `dyn Trait`", "impl ", "MaybeIncorrect");

  const sugg: [Span, string][] = [
    [Span.shrink_to_lo(span), `Box<${pre}`],
    [Span.shrink_to_hi(span), ">"],
  ];
  for (const expr of visitor.returns) {
    const span = Span.find_ancestor_in_same_ctxt(expr.span, obligation.cause.span) ?? expr.span;
    if (!Span.can_be_used_for_suggestions(span)) {
      // vec![]
    } else if (
      expr.kind.$ === "Call" &&
      expr.kind._0.kind.$ === "Path" &&
      expr.kind._0.kind._0.$ === "TypeRelative" &&
      expr.kind._0.kind._0._1.ident.name === sym.new &&
      expr.kind._0.kind._0._0.kind.$ === "Path" &&
      expr.kind._0.kind._0._0.kind._0.$ === "Resolved" &&
      is_some_and(Res.opt_def_id(expr.kind._0.kind._0._0.kind._0._1.res), (def_id) => this.tcx.is_lang_item(def_id, LangItem.OwnedBox))
    ) {
      // Don't box `Box::new`
      // vec![]
    } else {
      sugg.push([Span.shrink_to_lo(span), "Box::new("], [Span.shrink_to_hi(span), ")"]);
    }
  }

  err.multipart_suggestion("alternatively, box the return type, and wrap all of the returned values in `Box::new`", sugg, "MaybeIncorrect");

  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2963 report_closure_arg_mismatch
TypeErrCtxt.prototype.report_closure_arg_mismatch = function (
  this: TypeErrCtxt,
  span: Span,
  found_span_: Span | undefined,
  found_: TraitRef,
  expected_: TraitRef,
  cause: ObligationCauseCode,
  found_node: hir.Node | undefined,
  param_env: ParamEnv,
): Diag {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:2973 build_fn_sig_ty
  function build_fn_sig_ty(infcx: InferCtxt, trait_ref: TraitRef): Ty {
    const inputs = trait_ref.args.type_at(1);
    const inputs_kind = inputs.kind();
    let sig: FnSig;
    if (inputs_kind.$ === "Tuple" && infcx.tcx.is_callable_trait(trait_ref.def_id)) {
      sig = infcx.tcx.mk_fn_sig_safe_rust_abi(inputs_kind._0, infcx.next_ty_var(DUMMY_SP));
    } else {
      sig = infcx.tcx.mk_fn_sig_safe_rust_abi([inputs], infcx.next_ty_var(DUMMY_SP));
    }

    return Ty.new_fn_ptr(infcx.tcx, Binder.dummy(sig, fold_FnSig));
  }

  const expected_self_kind = TraitRef.self_ty(expected_).kind();
  const argument_kind = expected_self_kind.$ === "Closure" ? "closure" : expected_self_kind.$ === "Coroutine" ? "coroutine" : "function";
  const err = struct_span_code_err(this.dcx(), span, E0631, `type mismatch in ${argument_kind} arguments`);

  err.span_label(span, "expected due to this");

  const found_span = found_span_ ?? span;
  err.span_label(found_span, "found signature defined here");

  const expected = build_fn_sig_ty(this.infcx, expected_);
  const found = build_fn_sig_ty(this.infcx, found_);

  const [expected_str, found_str] = this.cmp(expected, found);

  const signature_kind = `${argument_kind} signature`;
  err.note_expected_found(signature_kind, expected_str, signature_kind, found_str);

  this.note_conflicting_fn_args(err, cause, expected, found, param_env);
  this.note_conflicting_closure_bounds(cause, err);

  if (found_node !== undefined) {
    hint_missing_borrow(this.infcx, param_env, span, found, expected, found_node, err);
  }

  return err;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3023 note_conflicting_fn_args
TypeErrCtxt.prototype.note_conflicting_fn_args = function (
  this: TypeErrCtxt,
  err: Diag,
  cause: ObligationCauseCode,
  expected_: Ty,
  found_: Ty,
  param_env: ParamEnv,
): void {
  if (cause.$ !== "FunctionArg") {
    return;
  }
  const arg_hir_id = cause.arg_hir_id;
  const expected_kind = expected_.kind();
  if (expected_kind.$ !== "FnPtr") {
    return;
  }
  const expected = PolyFnSigTys.with(expected_kind._0, expected_kind._1);
  const found_kind = found_.kind();
  if (found_kind.$ !== "FnPtr") {
    return;
  }
  const found = PolyFnSigTys.with(found_kind._0, found_kind._1);
  const node = this.tcx.hir_node(arg_hir_id);
  if (node.$ !== "Expr") {
    return;
  }
  const arg = node._0;
  if (arg.kind.$ !== "Path") {
    return;
  }
  const path = arg.kind._0;
  const expected_inputs = FnSig.inputs(this.tcx.instantiate_bound_regions_with_erased(expected, fold_FnSig));
  const found_inputs = FnSig.inputs(this.tcx.instantiate_bound_regions_with_erased(found, fold_FnSig));
  // `expected_inputs.iter().copied().zip(found_inputs.iter().copied())`
  const both_tys = (): [Ty, Ty][] => {
    const out: [Ty, Ty][] = [];
    for (let i = 0; i < Math.min(expected_inputs.length, found_inputs.length); i++) out.push([expected_inputs[i]!, found_inputs[i]!]);
    return out;
  };

  const arg_expr = (infcx: InferCtxt, name: string, expected: Ty, found: Ty): string => {
    const [expected_ty, expected_refs] = get_deref_type_and_refs(expected);
    const [found_ty, found_refs] = get_deref_type_and_refs(found);

    if (infcx.can_eq(param_env, found_ty, expected_ty, ToTrace_Ty)) {
      if (found_refs.length === expected_refs.length && slice_eq(found_refs, expected_refs)) {
        return name;
      } else if (found_refs.length > expected_refs.length) {
        const refs = found_refs.slice(0, found_refs.length - expected_refs.length);
        if (slice_eq(found_refs.slice(0, expected_refs.length), expected_refs)) {
          return `${refs.map((mutbl) => `&${Mutability.prefix_str(mutbl)}`).join("")}${name}`;
        } else {
          // The refs have different mutability.
          return `${refs.map((mutbl) => `&${Mutability.prefix_str(mutbl)}`).join("")}*${name}`;
        }
      } else if (expected_refs.length > found_refs.length) {
        return `${"*".repeat(expected_refs.length - found_refs.length)}${name}`;
      } else {
        return `${[...found_refs.map((mutbl) => `&${Mutability.prefix_str(mutbl)}`), ...found_refs.map(() => "*")].join("")}${name}`;
      }
    } else {
      return `/* ${display_Ty(found)} */`;
    }
  };
  const args_have_same_underlying_type = both_tys().every(([expected, found]) => {
    const [expected_ty] = get_deref_type_and_refs(expected);
    const [found_ty] = get_deref_type_and_refs(found);
    return this.can_eq(param_env, found_ty, expected_ty, ToTrace_Ty);
  });
  let closure_names_: string[];
  let call_names: string[];
  let fn_res: Res | undefined;
  if (
    args_have_same_underlying_type &&
    expected_inputs.length !== 0 &&
    expected_inputs.length === found_inputs.length &&
    this.typeck_results !== undefined &&
    (fn_res = this.typeck_results.qpath_res(path, arg_hir_id)).$ === "Def" &&
    DefKind.is_fn_like(fn_res._0)
  ) {
    const fn_def_id = fn_res._1;
    const closure: string[] = (this.tcx.fn_arg_idents(fn_def_id) as readonly (Ident | undefined)[]).map((ident, i) => {
      if (ident !== undefined && !(ident.name === kw.Underscore || ident.name === kw.SelfLower)) {
        return display_Ident(ident);
      } else {
        return `arg${i}`;
      }
    });
    const tys = both_tys();
    const args: string[] = [];
    for (let i = 0; i < Math.min(closure.length, tys.length); i++) {
      const name = closure[i]!;
      const [expected, found] = tys[i]!;
      args.push(arg_expr(this.infcx, name, expected, found));
    }
    closure_names_ = closure;
    call_names = args;
  } else {
    const closure_args = expected_inputs.map((_, i) => `arg${i}`);
    const call_args = both_tys().map(([expected, found], i) => arg_expr(this.infcx, `arg${i}`, expected, found));
    closure_names_ = closure_args;
    call_names = call_args;
  }
  const closure_names: string[] = [];
  for (let i = 0; i < Math.min(closure_names_.length, expected_inputs.length); i++) {
    const name = closure_names_[i]!;
    const ty = expected_inputs[i]!;
    closure_names.push(
      `${name}${
        TypeVisitableExt.has_infer_types(ty, fold_Ty) ? "" : TypeVisitableExt.references_error(ty, fold_Ty) ? ": /* type */" : `: ${display_Ty(ty)}`
      }`,
    );
  }
  err.multipart_suggestion(
    "consider wrapping the function in a closure",
    [
      [Span.shrink_to_lo(arg.span), `|${closure_names.join(", ")}| `],
      [Span.shrink_to_hi(arg.span), `(${call_names.join(", ")})`],
    ],
    "MaybeIncorrect",
  );
};

// Add a note if there are two `Fn`-family bounds that have conflicting argument
// requirements, which will always cause a closure to have a type error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3181 note_conflicting_closure_bounds
TypeErrCtxt.prototype.note_conflicting_closure_bounds = function (this: TypeErrCtxt, cause: ObligationCauseCode, err: Diag): void {
  // First, look for a `WhereClauseInExpr`, which means we can get
  // the uninstantiated predicate list of the called function. And check
  // that the predicate that we failed to satisfy is a `Fn`-like trait.
  if (cause.$ !== "WhereClauseInExpr") return;
  const def_id = cause._0;
  const idx = cause._3;
  const gen_clauses = GenericClauses.instantiate_identity(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx);
  const clause_ = gen_clauses.clauses[idx];
  if (clause_ === undefined) return;
  const clause = Unnormalized.skip_norm_wip(clause_);
  const kind = Binder.skip_binder(clause.kind());
  if (kind.$ !== "Trait") return;
  const trait_pred = kind._0;
  if (!this.tcx.is_fn_trait(TraitClause.def_id(trait_pred))) return;

  const expected_self = this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), TraitClause.self_ty(trait_pred)), fold_Ty);
  const expected_args = this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), trait_pred.trait_ref.args), fold_GenericArgs);

  // Find another clause whose self-type is equal to the expected self type,
  // but whose args don't match.
  let other_clause: [number, [Unnormalized<Clause>, Span]] | undefined;
  let other_idx = 0;
  for (const [clause_u, span] of gen_clauses) {
    const clause = Unnormalized.skip_norm_wip(clause_u);
    const k = Binder.skip_binder(clause.kind());
    if (
      k.$ === "Trait" &&
      this.tcx.is_fn_trait(TraitClause.def_id(k._0)) &&
      other_idx !== idx &&
      // Make sure that the self type matches
      // (i.e. constraining this closure)
      Binder_eq(expected_self, this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), TraitClause.self_ty(k._0)), fold_Ty)) &&
      // But the args don't match (i.e. incompatible args)
      !Binder_eq(expected_args, this.tcx.anonymize_bound_vars(Binder.rebind(clause.kind(), k._0.trait_ref.args), fold_GenericArgs))
    ) {
      other_clause = [other_idx, [clause_u, span]];
      break;
    }
    other_idx++;
  }
  // If we found one, then it's very likely the cause of the error.
  if (other_clause !== undefined) {
    const other_clause_span = other_clause[1][1];
    err.span_note(other_clause_span, "closure inferred to have a different signature due to this bound");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3236 suggest_fully_qualified_path
TypeErrCtxt.prototype.suggest_fully_qualified_path = function (this: TypeErrCtxt, err: Diag, item_def_id: DefId, span: Span, trait_ref: DefId): void {
  const assoc_item = this.tcx.opt_associated_item(item_def_id);
  if (assoc_item !== undefined && (assoc_item.kind.$ === "Const" || assoc_item.kind.$ === "Type")) {
    err.note(
      `${this.tcx.def_kind_descr(AssocItem.as_def_kind(assoc_item), item_def_id)}s cannot be accessed directly on a \`trait\`, they can only be accessed through a specific \`impl\``,
    );

    if (!AssocItem.is_impl_trait_in_trait(assoc_item)) {
      err.span_suggestion_verbose(
        span,
        "use the fully qualified path to an implementation",
        `<Type as ${this.tcx.def_path_str(trait_ref)}>::${display_Symbol(AssocItem.name(assoc_item))}`,
        "HasPlaceholders",
      );
    }
  }
};

/// Adds an async-await specific note to the diagnostic when the future does not implement
/// an auto trait because of a captured type.
///
/// ```text
/// note: future does not implement `Qux` as this value is used across an await
///   --> $DIR/issue-64130-3-other.rs:17:5
///    |
/// LL |     let x = Foo;
///    |         - has type `Foo`
/// LL |     baz().await;
///    |     ^^^^^^^^^^^ await occurs here, with `x` maybe used later
/// LL | }
///    | - `x` is later dropped here
/// ```
///
/// When the diagnostic does not implement `Send` or `Sync` specifically, then the diagnostic
/// is "replaced" with a different message and a more specific error.
///
/// ```text
/// error: future cannot be sent between threads safely
///   --> $DIR/issue-64130-2-send.rs:21:5
///    |
/// LL | fn is_send<T: Send>(t: T) { }
///    |               ---- required by this bound in `is_send`
/// ...
/// LL |     is_send(bar());
///    |     ^^^^^^^ future returned by `bar` is not send
///    |
///    = help: within `impl std::future::Future`, the trait `std::marker::Send` is not
///            implemented for `Foo`
/// note: future is not send as this value is used across an await
///   --> $DIR/issue-64130-2-send.rs:15:5
///    |
/// LL |     let x = Foo;
///    |         - has type `Foo`
/// LL |     baz().await;
///    |     ^^^^^^^^^^^ await occurs here, with `x` maybe used later
/// LL | }
///    | - `x` is later dropped here
/// ```
///
/// Returns `true` if an async-await specific note was added to the diagnostic.
// #[instrument(level = "debug", skip_all, fields(?obligation.predicate, ?obligation.cause.span))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3310 maybe_note_obligation_cause_for_async_await
TypeErrCtxt.prototype.maybe_note_obligation_cause_for_async_await = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation): boolean {
  // Attempt to detect an async-await error by looking at the obligation causes, looking
  // for a coroutine to be present.
  //
  // When a future does not implement a trait because of a captured type in one of the
  // coroutines somewhere in the call stack, then the result is a chain of obligations.
  //
  // Given an `async fn` A that calls an `async fn` B which captures a non-send type and that
  // future is passed as an argument to a function C which requires a `Send` type, then the
  // chain looks something like this:
  //
  // - `BuiltinDerivedObligation` with a coroutine witness (B)
  // - `BuiltinDerivedObligation` with a coroutine (B)
  // - `BuiltinDerivedObligation` with `impl std::future::Future` (B)
  // - `BuiltinDerivedObligation` with a coroutine witness (A)
  // - `BuiltinDerivedObligation` with a coroutine (A)
  // - `BuiltinDerivedObligation` with `impl std::future::Future` (A)
  // - `BindingObligation` with `impl_send` (Send requirement)
  //
  // The first obligation in the chain is the most useful and has the coroutine that captured
  // the type. The last coroutine (`outer_coroutine` below) has information about where the
  // bound was introduced. At least one coroutine should be present for this diagnostic to be
  // modified.
  let trait_ref: TraitClause | undefined;
  let target_ty: Ty | undefined;
  {
    const k = Binder.skip_binder(obligation.predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const p = k._0._0;
      trait_ref = p;
      target_ty = TraitClause.self_ty(p);
    } else {
      trait_ref = undefined;
      target_ty = undefined;
    }
  }
  let coroutine: DefId | undefined = undefined;
  let outer_coroutine: DefId | undefined = undefined;
  let next_code: ObligationCauseCode | undefined = obligation.cause.code_();

  let seen_upvar_tys_infer_tuple = false;

  loop: while (next_code !== undefined) {
    const code: ObligationCauseCode = next_code;
    // debug!(?code);
    switch (code.$) {
      case "FunctionArg": {
        next_code = ObligationCauseCodeHandle.deref(code.parent_code);
        break;
      }
      case "ImplDerived": {
        const cause = code._0;
        const ty = TraitClause.self_ty(Binder.skip_binder(cause.derived.parent_trait_pred));
        // debug!(parent_trait_ref = ?cause.derived.parent_trait_pred, self_ty.kind = ?ty.kind(), "ImplDerived");

        const k = ty.kind();
        if (k.$ === "Coroutine" || k.$ === "CoroutineWitness") {
          const did = k._0;
          coroutine = coroutine ?? did;
          outer_coroutine = did;
        } else if (k.$ === "Tuple" && !seen_upvar_tys_infer_tuple) {
          // By introducing a tuple of upvar types into the chain of obligations
          // of a coroutine, the first non-coroutine item is now the tuple itself,
          // we shall ignore this.

          seen_upvar_tys_infer_tuple = true;
        } else if (coroutine === undefined) {
          trait_ref = Binder.skip_binder(cause.derived.parent_trait_pred);
          target_ty = ty;
        }

        next_code = ObligationCauseCodeHandle.deref(cause.derived.parent_code);
        break;
      }
      case "WellFormedDerived":
      case "BuiltinDerived": {
        const derived_obligation = code._0;
        const ty = TraitClause.self_ty(Binder.skip_binder(derived_obligation.parent_trait_pred));
        // debug!(parent_trait_ref = ?derived_obligation.parent_trait_pred, self_ty.kind = ?ty.kind());

        const k = ty.kind();
        if (k.$ === "Coroutine" || k.$ === "CoroutineWitness") {
          const did = k._0;
          coroutine = coroutine ?? did;
          outer_coroutine = did;
        } else if (k.$ === "Tuple" && !seen_upvar_tys_infer_tuple) {
          // By introducing a tuple of upvar types into the chain of obligations
          // of a coroutine, the first non-coroutine item is now the tuple itself,
          // we shall ignore this.

          seen_upvar_tys_infer_tuple = true;
        } else if (coroutine === undefined) {
          trait_ref = Binder.skip_binder(derived_obligation.parent_trait_pred);
          target_ty = ty;
        }

        next_code = ObligationCauseCodeHandle.deref(derived_obligation.parent_code);
        break;
      }
      default:
        break loop;
    }
  }

  // Only continue if a coroutine was found.
  // debug!(?coroutine, ?trait_ref, ?target_ty);
  if (coroutine === undefined || trait_ref === undefined || target_ty === undefined) {
    return false;
  }
  const coroutine_did = coroutine;
  const trait_ref_ = trait_ref;
  const target_ty_ = target_ty;

  const span = this.tcx.def_span(coroutine_did);

  const coroutine_did_root = this.tcx.typeck_root_def_id(coroutine_did);
  // debug!(?coroutine_did, ?coroutine_did_root, typeck_results.hir_owner = ?self.typeck_results.as_ref().map(|t| t.hir_owner), ?span);

  const coroutine_did_local = coroutine_did.as_local();
  const coroutine_body = coroutine_did_local === undefined ? undefined : this.tcx.hir_maybe_body_owned_by(coroutine_did_local);
  const visitor = AwaitsVisitor.default();
  if (coroutine_body !== undefined) {
    const body = coroutine_body;
    visitor.visit_body(body);
  }
  // debug!(awaits = ?visitor.awaits);

  // Look for a type inside the coroutine interior that matches the target type to get
  // a span.
  const target_ty_erased = this.tcx.erase_and_anonymize_regions(target_ty_, fold_Ty);
  const ty_matches = (ty: Binder<Ty>): boolean => {
    // Careful: the regions for types that appear in the
    // coroutine interior are not generally known, so we
    // want to erase them when comparing (and anyway,
    // `Send` and other bounds are generally unaffected by
    // the choice of region). When erasing regions, we
    // also have to erase late-bound regions. This is
    // because the types that appear in the coroutine
    // interior generally contain "bound regions" to
    // represent regions that are part of the suspended
    // coroutine frame. Bound regions are preserved by
    // `erase_and_anonymize_regions` and so we must also call
    // `instantiate_bound_regions_with_erased`.
    const ty_erased_ = this.tcx.instantiate_bound_regions_with_erased(ty, fold_Ty);
    const ty_erased = this.tcx.erase_and_anonymize_regions(ty_erased_, fold_Ty);
    const eq = ty_erased === target_ty_erased;
    // debug!(?ty_erased, ?target_ty_erased, ?eq);
    return eq;
  };

  // Get the typeck results from the infcx if the coroutine is the function we are currently
  // type-checking; otherwise, get them by performing a query. This is needed to avoid
  // cycles. If we can't use resolved types because the coroutine comes from another crate,
  // we still provide a targeted error but without all the relevant spans.
  let coroutine_data: CoroutineData;
  const t = this.typeck_results;
  if (t !== undefined && DefId_eq(LocalDefId.to_def_id(t.hir_owner.def_id), coroutine_did_root)) {
    coroutine_data = new CoroutineData(t);
  } else if (coroutine_did.is_local()) {
    // PORT: the `typeck` query's value is typed `unknown` in queries.gen.ts; it is `&TypeckResults`.
    coroutine_data = new CoroutineData(this.tcx.typeck(coroutine_did.expect_local()) as TypeckResults);
  } else {
    return false;
  }

  const coroutine_within_in_progress_typeck =
    this.typeck_results !== undefined ? DefId_eq(LocalDefId.to_def_id(this.typeck_results.hir_owner.def_id), coroutine_did_root) : false;

  let interior_or_upvar_span: CoroutineInteriorOrUpvar | undefined = undefined;

  const from_awaited_ty = coroutine_data.get_from_await_ty(visitor, this.tcx, ty_matches);
  // debug!(?from_awaited_ty);

  // Avoid disclosing internal information to downstream crates.
  if (
    coroutine_did.is_local() &&
    // Try to avoid cycles.
    !coroutine_within_in_progress_typeck
  ) {
    // PORT: the `mir_coroutine_witnesses` query's value is typed `unknown` in queries.gen.ts (MIR, M4); it is
    // `Option<&CoroutineLayout>`; `CoroutineLayoutView` is the view of the fields read here.
    const coroutine_info = this.tcx.mir_coroutine_witnesses(coroutine_did) as CoroutineLayoutView | undefined;
    if (coroutine_info !== undefined) {
      // debug!(?coroutine_info);
      find_source: for (let v = 0; v < Math.min(coroutine_info.variant_fields.length, coroutine_info.variant_source_info.length); v++) {
        const variant = coroutine_info.variant_fields[v]!;
        const source_info = coroutine_info.variant_source_info[v]!;
        // debug!(?variant);
        for (const local of variant) {
          const decl = coroutine_info.field_tys[local]!;
          // debug!(?decl);
          if (ty_matches(Binder.dummy(decl.ty, fold_Ty)) && !decl.ignore_for_traits) {
            interior_or_upvar_span = { $: "Interior", _0: decl.source_info.span, _1: [source_info.span, from_awaited_ty] };
            break find_source;
          }
        }
      }
    }
  }

  if (interior_or_upvar_span === undefined) {
    interior_or_upvar_span = coroutine_data.try_get_upvar_span(this.infcx, coroutine_did, ty_matches);
  }

  if (interior_or_upvar_span === undefined && !coroutine_did.is_local()) {
    interior_or_upvar_span = { $: "Interior", _0: span, _1: undefined };
  }

  // debug!(?interior_or_upvar_span);
  if (interior_or_upvar_span !== undefined) {
    const is_async = this.tcx.coroutine_is_async(coroutine_did);
    this.note_obligation_cause_for_async_await(err, interior_or_upvar_span, is_async, outer_coroutine, trait_ref_, target_ty_, obligation, next_code);
    return true;
  } else {
    return false;
  }
};

/// Unconditionally adds the diagnostic note described in
/// `maybe_note_obligation_cause_for_async_await`'s documentation comment.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3542 note_obligation_cause_for_async_await
TypeErrCtxt.prototype.note_obligation_cause_for_async_await = function (
  this: TypeErrCtxt,
  err: Diag,
  interior_or_upvar_span: CoroutineInteriorOrUpvar,
  is_async: boolean,
  outer_coroutine: DefId | undefined,
  trait_pred: TraitClause,
  target_ty: Ty,
  obligation: PredicateObligation,
  next_code: ObligationCauseCode | undefined,
): void {
  const source_map = this.tcx.sess.source_map();

  const [await_or_yield, an_await_or_yield] = is_async ? ["await", "an await"] : ["yield", "a yield"];
  const future_or_coroutine = is_async ? "future" : "coroutine";

  // Special case the primary error message when send or sync is the trait that was
  // not implemented.
  let trait_explanation: string;
  const name = this.tcx.get_diagnostic_name(TraitClause.def_id(trait_pred));
  if (name !== undefined && (name === sym.Send || name === sym.Sync)) {
    const [trait_name, trait_verb] = name === sym.Send ? ["`Send`", "sent"] : ["`Sync`", "shared"];

    err.deref_mut().code = undefined;
    err.primary_message(`${future_or_coroutine} cannot be ${trait_verb} between threads safely`);

    const original_span = unwrap(err.deref().span.primary_span());
    const span = MultiSpan.from_span(original_span);

    // `self.tcx.parent(coroutine_did).as_local().map(..).and_then(|parent_hir_id| self.tcx.hir_opt_name(parent_hir_id))`
    const parent_name = (coroutine_did: DefId): Symbol | undefined => {
      const parent_did = this.tcx.parent(coroutine_did).as_local();
      if (parent_did === undefined) return undefined;
      const parent_hir_id = this.tcx.local_def_id_to_hir_id(parent_did);
      return this.tcx.hir_opt_name(parent_hir_id);
    };
    const message_ = (coroutine_did: DefId): string | undefined => {
      // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
      const kind = unwrap(this.tcx.coroutine_kind(coroutine_did) as hir.CoroutineKind | undefined);
      if (kind.$ === "Coroutine") {
        return `coroutine is not ${trait_name}`;
      }
      switch (kind._0) {
        case "Async":
          switch (kind._1) {
            case "Fn": {
              const name = parent_name(coroutine_did);
              if (name === undefined) return undefined;
              return `future returned by \`${display_Symbol(name)}\` is not ${trait_name}`;
            }
            case "Block":
              return `future created by async block is not ${trait_name}`;
            case "Closure":
              return `future created by async closure is not ${trait_name}`;
          }
          break;
        case "AsyncGen":
          switch (kind._1) {
            case "Fn": {
              const name = parent_name(coroutine_did);
              if (name === undefined) return undefined;
              return `async iterator returned by \`${display_Symbol(name)}\` is not ${trait_name}`;
            }
            case "Block":
              return `async iterator created by async gen block is not ${trait_name}`;
            case "Closure":
              return `async iterator created by async gen closure is not ${trait_name}`;
          }
          break;
        case "Gen":
          switch (kind._1) {
            case "Fn": {
              const name = parent_name(coroutine_did);
              if (name === undefined) return undefined;
              return `iterator returned by \`${display_Symbol(name)}\` is not ${trait_name}`;
            }
            case "Block":
              return `iterator created by gen block is not ${trait_name}`;
            case "Closure":
              return `iterator created by gen closure is not ${trait_name}`;
          }
          break;
      }
      return unreachable();
    };
    const message = (outer_coroutine === undefined ? undefined : message_(outer_coroutine)) ?? `${future_or_coroutine} is not ${trait_name}`;

    span.push_span_label(original_span, message);
    err.span(span);

    trait_explanation = `is not ${trait_name}`;
  } else {
    trait_explanation = `does not implement \`${display_TraitClausePrintModifiersAndPath(TraitClause_print_modifiers_and_trait_path(trait_pred))}\``;
  }

  const explain_yield = (interior_span: Span, yield_span: Span): void => {
    const span = MultiSpan.from_span(yield_span);
    const snippet_r = source_map.span_to_snippet(interior_span);
    let snippet: string;
    // #70935: If snippet contains newlines, display "the value" instead
    // so that we do not emit complex diagnostics.
    if (snippet_r.$ === "Ok" && !snippet_r._0.toString().includes("\n")) {
      snippet = `\`${snippet_r._0.toString()}\``;
    } else {
      snippet = "the value";
    }
    // note: future is not `Send` as this value is used across an await
    //   --> $DIR/issue-70935-complex-spans.rs:13:9
    //    |
    // LL |            baz(|| async {
    //    |  ______________-
    //    | |
    //    | |
    // LL | |              foo(tx.clone());
    // LL | |          }).await;
    //    | |          - ^^^^^^ await occurs here, with value maybe used later
    //    | |__________|
    //    |            has type `closure` which is not `Send`
    // note: value is later dropped here
    // LL | |          }).await;
    //    | |                  ^
    //
    span.push_span_label(yield_span, `${await_or_yield} occurs here, with ${snippet} maybe used later`);
    span.push_span_label(interior_span, `has type \`${display_Ty(target_ty)}\` which ${trait_explanation}`);
    err.span_note(span, `${future_or_coroutine} ${trait_explanation} as this value is used across ${an_await_or_yield}`);
  };
  switch (interior_or_upvar_span.$) {
    case "Interior": {
      const interior_span = interior_or_upvar_span._0;
      const interior_extra_info = interior_or_upvar_span._1;
      if (interior_extra_info !== undefined) {
        const [yield_span, from_awaited_ty] = interior_extra_info;
        if (from_awaited_ty !== undefined) {
          const await_span = from_awaited_ty;
          // The type causing this obligation is one being awaited at await_span.
          const span = MultiSpan.from_span(await_span);
          span.push_span_label(await_span, `await occurs here on type \`${display_Ty(target_ty)}\`, which ${trait_explanation}`);
          err.span_note(span, `future ${trait_explanation} as it awaits another future which ${trait_explanation}`);
        } else {
          // Look at the last interior type to get a span for the `.await`.
          explain_yield(interior_span, yield_span);
        }
      }
      break;
    }
    case "Upvar": {
      const upvar_span = interior_or_upvar_span._0;
      // `Some((ref_ty, is_mut))` if `target_ty` is `&T` or `&mut T` and fails to impl `Send`
      let non_send: [Ty, boolean] | undefined;
      const k = target_ty.kind();
      if (k.$ === "Ref") {
        const ref_ty = k._1;
        const mutability = k._2;
        const eval_ = this.evaluate_obligation(obligation);
        if (eval_.$ === "Ok" && !EvaluationResult.may_apply(eval_._0)) {
          non_send = [ref_ty, mutability === "Mut"];
        } else {
          non_send = undefined;
        }
      } else {
        non_send = undefined;
      }

      let span_label: string;
      let span_note: string;
      if (non_send !== undefined) {
        // if `target_ty` is `&T` or `&mut T` and fails to impl `Send`,
        // include suggestions to make `T: Sync` so that `&T: Send`,
        // or to make `T: Send` so that `&mut T: Send`
        const [ref_ty, is_mut] = non_send;
        const ref_ty_trait = is_mut ? "Send" : "Sync";
        const ref_kind = is_mut ? "&mut" : "&";
        span_label = `has type \`${display_Ty(target_ty)}\` which ${trait_explanation}, because \`${display_Ty(ref_ty)}\` is not \`${ref_ty_trait}\``;
        span_note = `captured value ${trait_explanation} because \`${ref_kind}\` references cannot be sent unless their referent is \`${ref_ty_trait}\``;
      } else {
        span_label = `has type \`${display_Ty(target_ty)}\` which ${trait_explanation}`;
        span_note = `captured value ${trait_explanation}`;
      }

      const span = MultiSpan.from_span(upvar_span);
      span.push_span_label(upvar_span, span_label);
      err.span_note(span, span_note);
      break;
    }
  }

  // Add a note for the item obligation that remains - normally a note pointing to the
  // bound that introduced the obligation (e.g. `T: Send`).
  // debug!(?next_code);
  this.note_obligation_cause_code(
    obligation.cause.body_def_id,
    err,
    obligation.predicate,
    obligation.param_env,
    unwrap(next_code),
    [],
    new DefIdSet(),
    upcast_from_Predicate,
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3776 note_closure_capture
TypeErrCtxt.prototype.note_closure_capture = function (
  this: TypeErrCtxt,
  err: Diag,
  closure_def_id_: DefId,
  upvar_args: UpvarArgs,
  capture_ty_: Ty | undefined,
): boolean {
  const closure_def_id = closure_def_id_.as_local();
  if (closure_def_id === undefined) {
    return false;
  }
  if (capture_ty_ === undefined) {
    return false;
  }

  // This can run while `typeck` for the closure's root is still on the query stack, for
  // example when reporting an overflow from inside trait selection, so only the in-progress
  // results are safe to look at. Asking for the captures through `tcx.closure_captures`
  // would call `typeck` again and replace the error being reported with a cycle error.
  const typeck_results = this.typeck_results;
  if (typeck_results === undefined) {
    return false;
  }
  const typeck_root = this.tcx.typeck_root_def_id(LocalDefId.to_def_id(closure_def_id));
  if (!DefId_eq(LocalDefId.to_def_id(typeck_results.hir_owner.def_id), typeck_root)) {
    return false;
  }

  // Error reporting can run before closure capture analysis has inferred the
  // tuple of upvar types. avoid accessing upvar types until they are available.
  let upvar_tys: readonly Ty[];
  const tupled = UpvarArgs.tupled_upvars_ty(upvar_args).kind();
  switch (tupled.$) {
    case "Tuple":
      upvar_tys = tupled._0;
      break;
    case "Error":
      upvar_tys = RawList.empty<Ty>();
      break;
    case "Infer":
      return false;
    default:
      return unreachable(`internal error: entered unreachable code: unexpected upvar types tuple: ${debug_TyKind(tupled, PLAIN)}`);
  }

  const captures = [...typeck_results.closure_min_captures_flattened(closure_def_id)];
  if (captures.length !== upvar_tys.length) {
    return false;
  }

  const capture_ty = this.tcx.erase_and_anonymize_regions(this.deeply_resolve_ignoring_regions(capture_ty_, fold_Ty), fold_Ty);
  let capture: (typeof captures)[number] | undefined;
  for (let i = 0; i < Math.min(captures.length, upvar_tys.length); i++) {
    const c = captures[i]!;
    const upvar_ty = this.tcx.erase_and_anonymize_regions(this.deeply_resolve_ignoring_regions(upvar_tys[i]!, fold_Ty), fold_Ty);
    if (upvar_ty === capture_ty) {
      capture = c;
      break;
    }
  }
  if (capture === undefined) {
    return false;
  }

  err.span_note(capture.get_path_span(this.tcx), `required because \`${capture.to_string(this.tcx)}\` is used within this closure`);
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3838 note_obligation_cause_code
TypeErrCtxt.prototype.note_obligation_cause_code = function <T>(
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  predicate_: T,
  param_env: ParamEnv,
  cause_code: ObligationCauseCode,
  obligated_types: Ty[],
  seen_requirements: DefIdSet,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): void {
  const predicate = upcast_from_T(predicate_, this.tcx as unknown as Interner);
  // Built-in closure obligations pass through a synthetic tuple of upvar types. Remember
  // the last constituent before that tuple so it can be matched to a captured place.
  const as_trait = predicate.as_trait_clause();
  const closure_capture_ty: MutRef<Ty | undefined> = {
    value: as_trait === undefined ? undefined : TraitClause.self_ty(Binder.skip_binder(as_trait)),
  };
  this.note_obligation_cause_code_inner(
    body_def_id,
    err,
    predicate,
    param_env,
    cause_code,
    obligated_types,
    seen_requirements,
    closure_capture_ty,
    upcast_from_Predicate,
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:3867 note_obligation_cause_code_inner
TypeErrCtxt.prototype.note_obligation_cause_code_inner = function <T>(
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  predicate_: T,
  param_env: ParamEnv,
  cause_code: ObligationCauseCode,
  obligated_types: Ty[],
  seen_requirements: DefIdSet,
  closure_capture_ty: MutRef<Ty | undefined>,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): void {
  const tcx = this.tcx;
  const predicate = upcast_from_T(predicate_, tcx as unknown as Interner);
  const suggest_remove_deref = (err: Diag, expr: hir.Expr): void => {
    const pred = predicate.as_trait_clause();
    if (pred !== undefined && tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized) && expr.kind.$ === "Unary" && expr.kind._0 === "Deref") {
      const inner = expr.kind._1;
      err.span_suggestion_verbose(
        Span.until(expr.span, inner.span),
        "references are always `Sized`, even if they point to unsized data; consider not dereferencing the expression",
        "",
        "MaybeIncorrect",
      );
    }
  };
  switch (cause_code.$) {
    case "ExprAssignable":
    case "MatchExpressionArm":
    case "Pattern":
    case "IfExpression":
    case "IfExpressionWithNoElse":
    case "MainFunctionType":
    case "LangFunctionType":
    case "IntrinsicType":
    case "MethodReceiver":
    case "ReturnNoExpression":
    case "Misc":
    case "WellFormed":
    case "ReturnValue":
    case "BlockTailExpression":
    case "AwaitableExpr":
    case "ForLoopIterator":
    case "QuestionMark":
    case "CheckAssociatedTypeBounds":
    case "LetElse":
    case "UnOp":
    case "AscribeUserTypeProvePredicate":
    case "AlwaysApplicableImpl":
    case "ConstParam":
    case "ReferenceOutlivesReferent":
    case "ObjectTypeBound":
      break;
    case "BinOp": {
      const lhs_node = tcx.hir_node(cause_code.lhs_hir_id);
      const rhs_node = tcx.hir_node(cause_code.rhs_hir_id);
      if (
        lhs_node.$ === "Expr" &&
        rhs_node.$ === "Expr" &&
        tcx.sess.source_map().lookup_char_pos(Span.lo(lhs_node._0.span)).line !== tcx.sess.source_map().lookup_char_pos(Span.hi(rhs_node._0.span)).line
      ) {
        const lhs = lhs_node._0;
        const rhs = rhs_node._0;
        err.span_label(lhs.span, "");
        err.span_label(rhs.span, "");
      }
      break;
    }
    case "RustCall": {
      const pred = predicate.as_trait_clause();
      if (pred !== undefined && tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized)) {
        err.note('argument required to be sized due to `extern "rust-call"` ABI');
      }
      break;
    }
    case "SliceOrArrayElem": {
      err.note("slice and array elements must have `Sized` type");
      break;
    }
    case "ArrayLen": {
      const array_ty = cause_code._0;
      err.note(`the length of array \`${display_Ty(array_ty)}\` must be type \`usize\``);
      break;
    }
    case "TupleElem": {
      err.note("only the last element of a tuple may have a dynamically sized type");
      break;
    }
    case "DynCompatible": {
      const span = cause_code._0;
      err.multipart_suggestion("you might have meant to use `Self` to refer to the implementing type", [[span, "Self"]], "MachineApplicable");
      break;
    }
    case "WhereClause":
    case "WhereClauseInExpr":
    case "HostEffectInExpr": {
      const item_def_id = cause_code._0;
      const span = cause_code._1;
      if (Span.is_dummy(span)) {
        // ObligationCauseCode::WhereClause(..) | WhereClauseInExpr(..) | HostEffectInExpr(..):
        // We hold the `DefId` of the item introducing the obligation, but displaying it
        // doesn't add user usable information. It always point at an associated item.
        break;
      }
      if (cause_code.$ === "WhereClauseInExpr") {
        const hir_id = cause_code._2;
        const pos = cause_code._3;
        const parent = tcx.parent_hir_node(hir_id);
        let node: hir.Node;
        if (parent.$ === "Expr" && parent._0.kind.$ === "Call" && parent._0.kind._1[pos] !== undefined) {
          const expr = parent._0.kind._1[pos]!;
          suggest_remove_deref(err, expr);
        } else if (
          (node = this.tcx.hir_node(hir_id)).$ === "Expr" &&
          node._0.kind.$ === "MethodCall" &&
          node._0.kind._2[pos] !== undefined
        ) {
          const expr = node._0.kind._2[pos]!;
          suggest_remove_deref(err, expr);
        }
      }
      const item_name = tcx.def_path_str(item_def_id);
      const short_item_name = with_forced_trimmed_paths(() => tcx.def_path_str(item_def_id));
      const multispan = MultiSpan.from_Span(span);
      const sm = tcx.sess.source_map();
      const item_kind = tcx.def_kind(item_def_id);
      if (item_kind.$ === "AssocConst" || item_kind.$ === "AssocFn" || item_kind.$ === "AssocTy") {
        const span = Span.shrink_to_lo(tcx.def_span(tcx.parent(item_def_id)));
        multispan.push_span_context(span);
      }
      const ident = tcx.opt_item_ident(item_def_id);
      if (ident !== undefined) {
        multispan.push_span_context(ident.span);
      }
      let a = "a";
      let this_ = "this bound";
      let note: string | undefined = undefined;
      let help: string | undefined = undefined;
      const pk = Binder.skip_binder(predicate.kind());
      if (pk.$ === "Clause") {
        const clause = pk._0;
        switch (clause.$) {
          case "Trait": {
            const trait_pred = clause._0;
            const def_id = TraitClause.def_id(trait_pred);
            let visible_item: boolean;
            const local = def_id.as_local();
            if (local !== undefined) {
              const ty = TraitClause.self_ty(trait_pred);
              // when `TraitA: TraitB` and `S` only impl TraitA,
              // we check if `TraitB` can be reachable from `S`
              // to determine whether to note `TraitA` is sealed trait.
              const ty_kind = ty.kind();
              if (ty_kind.$ === "Adt") {
                const adt = ty_kind._0;
                const visibilities = tcx.resolutions(null).effective_visibilities;
                const v = visibilities.effective_vis(local);
                visible_item = v === undefined || Visibility.is_accessible_from(v.at_level(Level.Reexported), adt.did(), tcx);
              } else {
                // FIXME(xizheyin): if the type is not ADT, we should not suggest it
                visible_item = true;
              }
            } else {
              // Check for foreign traits being reachable.
              visible_item = tcx.visible_parent_map(null).get(def_id) !== undefined;
            }
            if (tcx.is_lang_item(def_id, LangItem.Sized)) {
              // Check if this is an implicit bound, even in foreign crates.
              // PORT: the `generics_of` query's value is typed `unknown` in queries.gen.ts; it is `&Generics`.
              if ((tcx.generics_of(item_def_id) as Generics).own_params.some((param) => tcx.def_span(param.def_id) === span)) {
                a = "an implicit `Sized`";
                this_ = "the implicit `Sized` requirement on this type parameter";
              }
              const node = tcx.hir_get_if_local(item_def_id);
              if (
                node !== undefined &&
                node.$ === "TraitItem" &&
                node._0.kind.$ === "Type" &&
                node._0.kind._1 === undefined &&
                // Do not suggest relaxing if there is an explicit `Sized` obligation.
                !node._0.kind._0.some((bound) => {
                  const tr = hir.GenericBound.trait_ref(bound);
                  if (tr === undefined) return false;
                  return is_some_and(tr.trait_def_id(), (def_id) => tcx.is_lang_item(def_id, LangItem.Sized));
                })
              ) {
                const generics = node._0.generics;
                const bounds = node._0.kind._0;
                let span: Span;
                let separator: string;
                if (bounds.length >= 1) {
                  const last = bounds[bounds.length - 1]!;
                  span = Span.shrink_to_hi(hir.GenericBound.span(last));
                  separator = " +";
                } else {
                  span = Span.shrink_to_hi(generics.span);
                  separator = ":";
                }
                err.span_suggestion_verbose(span, "consider relaxing the implicit `Sized` restriction", `${separator} ?Sized`, "MachineApplicable");
              }
            }
            if (tcx.def_kind(item_def_id).$ === "Trait" && !visible_item) {
              note = `\`${short_item_name}\` is a "sealed trait", because to implement it you also need to implement \`${with_no_trimmed_paths(() => tcx.def_path_str(def_id))}\`, which is not accessible; this is usually done to force you to use one of the provided types that already implement it`;
              const types = [...tcx.all_impls(def_id)].map((t) =>
                with_no_trimmed_paths(
                  // PORT: the `type_of` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<Ty>`.
                  () => `  ${display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(t) as EarlyBinder<Ty>)))}`,
                ),
              );
              if (types.length !== 0) {
                const len = types.length;
                let post: string;
                if (len > 9) {
                  types.length = 8;
                  post = `\nand ${len - 8} others`;
                } else {
                  post = "";
                }
                help = `the following type${pluralize(len)} implement${len === 1 ? "s" : ""} the trait:\n${types.join("\n")}${post}`;
              }
            }
            break;
          }
          case "ConstArgHasType": {
            const descr = `required by a const generic parameter in \`${item_name}\``;
            if (Span.is_visible(span, sm)) {
              const msg = `required by this const generic parameter in \`${short_item_name}\``;
              multispan.push_span_label(span, msg);
              err.span_note(multispan, descr);
            } else {
              err.span_note(tcx.def_span(item_def_id), descr);
            }
            return;
          }
          default:
            break;
        }
      }

      // If this is from a format string literal desugaring,
      // we've already said "required by this formatting parameter"
      let is_in_fmt_lit: boolean;
      const s = err.deref().span.primary_span();
      if (s !== undefined) {
        const dk = Span.desugaring_kind(s);
        is_in_fmt_lit = dk !== undefined && dk.$ === "FormatLiteral";
      } else {
        is_in_fmt_lit = false;
      }
      if (!is_in_fmt_lit) {
        const descr = `required by ${a} bound in \`${item_name}\``;
        if (Span.is_visible(span, sm)) {
          const msg = `required by ${this_} in \`${short_item_name}\``;
          multispan.push_span_label(span, msg);
          err.span_note(multispan, descr);
        } else {
          err.span_note(tcx.def_span(item_def_id), descr);
        }
      }
      if (note !== undefined) {
        err.note(note);
      }
      if (help !== undefined) {
        err.help(help);
      }
      break;
    }
    case "OpaqueTypeBound": {
      const span = cause_code._0;
      const definition_def_id = cause_code._1;
      err.span_note(span, "required by a bound in an opaque type");
      if (
        definition_def_id !== undefined &&
        // If there are any stalled coroutine obligations, then this
        // error may be due to that, and not because the body has more
        // where-clauses.
        // PORT: the `typeck` query's value is typed `unknown` in queries.gen.ts; it is `&TypeckResults`.
        (this.tcx.typeck(definition_def_id) as TypeckResults).coroutine_stalled_predicates.size === 0
      ) {
        // FIXME(compiler-errors): We could probably point to something
        // specific here if we tried hard enough...
        err.span_note(tcx.def_span(LocalDefId.to_def_id(definition_def_id)), "this definition site has more where clauses than the opaque type");
      }
      break;
    }
    case "Coercion": {
      const source = tcx.short_string(this.deeply_resolve_ignoring_regions(cause_code.source, fold_Ty), err.long_ty_path(), print_Ty_);
      const target = tcx.short_string(this.deeply_resolve_ignoring_regions(cause_code.target, fold_Ty), err.long_ty_path(), print_Ty_);
      err.note(with_forced_trimmed_paths(() => `required for the cast from \`${source}\` to \`${target}\``));
      break;
    }
    case "RepeatElementCopy": {
      const is_constable = cause_code.is_constable;
      const elt_span = cause_code.elt_span;
      err.note("the `Copy` trait is required because this value will be copied for each element of the array");
      const sm = tcx.sess.source_map();
      if ((is_constable === "Fn" || is_constable === "Ctor") && sm.span_to_snippet(elt_span).$ === "Ok") {
        err.multipart_suggestion(
          "create an inline `const` block",
          [
            [Span.shrink_to_lo(elt_span), "const { "],
            [Span.shrink_to_hi(elt_span), " }"],
          ],
          "MachineApplicable",
        );
      } else {
        // FIXME: we may suggest array::repeat instead
        err.help("consider using `core::array::from_fn` to initialize the array");
        err.help("see https://doc.rust-lang.org/stable/std/array/fn.from_fn.html for more information");
      }
      break;
    }
    case "VariableType": {
      const hir_id = cause_code._0;
      if (this.typeck_results !== undefined) {
        const ty = this.typeck_results.node_type_opt(hir_id);
        if (ty !== undefined && ty.kind().$ === "Error") {
          err.note(`\`${display_Predicate(predicate)}\` isn't satisfied, but the type of this pattern is \`{type error}\``);
          err.downgrade_to_delayed_bug();
        }
      }
      let local = true;
      const parent = tcx.parent_hir_node(hir_id);
      if (parent.$ === "LetStmt" && parent._0.ty !== undefined) {
        const ty = parent._0.ty;
        err.span_suggestion_verbose(Span.shrink_to_lo(ty.span), "consider borrowing here", "&", "MachineApplicable");
      } else if (parent.$ === "LetStmt" && parent._0.init !== undefined && parent._0.init.kind.$ === "Index") {
        const span = parent._0.init.span;
        // When encountering an assignment of an unsized trait, like
        // `let x = ""[..];`, provide a suggestion to borrow the initializer in
        // order to use have a slice instead.
        err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider borrowing here", "&", "MachineApplicable");
      } else if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
        const expr = parent._0.init;
        // When encountering an assignment of an unsized trait, like `let x = *"";`,
        // we check if the RHS is a deref operation, to suggest removing it.
        suggest_remove_deref(err, expr);
      } else if (parent.$ === "Param") {
        const param = parent._0;
        err.span_suggestion_verbose(
          Span.shrink_to_lo(param.ty_span),
          "function arguments must have a statically known size, borrowed types always have a known size",
          "&",
          "MachineApplicable",
        );
        local = false;
      }
      if (local) {
        err.note("all local variables must have a statically known size");
      }
      break;
    }
    case "SizedArgumentType": {
      const hir_id = cause_code._0;
      let ty: hir.Ty | undefined = undefined;
      const borrowed_msg = "function arguments must have a statically known size, borrowed types always have a known size";
      let param_node: hir.Node | undefined;
      let decl: hir.FnDecl | undefined;
      let t: hir.Ty | undefined;
      let ty_node: hir.Node | undefined;
      if (
        hir_id !== undefined &&
        (param_node = this.tcx.hir_node(hir_id)).$ === "Param" &&
        (decl = hir.Node.fn_decl(this.tcx.parent_hir_node(hir_id))) !== undefined &&
        (t = decl.inputs.find((t) => Span.contains((param_node as { _0: hir.Param })._0.ty_span, t.span))) !== undefined
      ) {
        // We use `contains` because the type might be surrounded by parentheses,
        // which makes `ty_span` and `t.span` disagree with each other, but one
        // fully contains the other: `foo: (dyn Foo + Bar)`
        //                                 ^-------------^
        //                                 ||
        //                                 |t.span
        //                                 param._ty_span
        ty = t;
      } else if (hir_id !== undefined && (ty_node = this.tcx.hir_node(hir_id)).$ === "Ty") {
        ty = ty_node._0;
      }
      if (ty !== undefined) {
        switch (ty.kind.$) {
          case "TraitObject": {
            const traits = ty.kind._0;
            let span: Span;
            let kw_: string;
            if (traits.length >= 1 && Span.lo(traits[0]!.span) === Span.lo(ty.span)) {
              // Missing `dyn` in front of trait object.
              span = Span.shrink_to_lo(ty.span);
              kw_ = "dyn ";
            } else if (traits.length >= 1) {
              span = Span.until(ty.span, traits[0]!.span);
              kw_ = "";
            } else {
              return span_bug(ty.span, `trait object with no traits: ${hir.debug_Ty(ty, PLAIN, (_x, _f) => "()")}`);
            }
            const needs_parens = traits.length !== 1;
            // Don't recommend impl Trait as a closure argument
            if (hir_id !== undefined) {
              const parent = this.tcx.parent_hir_node(hir_id);
              if (parent.$ === "Item" && parent._0.kind.$ === "Fn") {
                err.span_suggestion_verbose(span, "you can use `impl Trait` as the argument type", "impl ", "MaybeIncorrect");
              }
            }
            let sugg: [Span, string][];
            if (!needs_parens) {
              sugg = [[Span.shrink_to_lo(span), `&${kw_}`]];
            } else {
              sugg = [
                [Span.shrink_to_lo(span), `&(${kw_}`],
                [Span.shrink_to_hi(ty.span), ")"],
              ];
            }
            err.multipart_suggestion(borrowed_msg, sugg, "MachineApplicable");
            break;
          }
          case "Slice": {
            err.span_suggestion_verbose(
              Span.shrink_to_lo(ty.span),
              "function arguments must have a statically known size, borrowed slices always have a known size",
              "&",
              "MachineApplicable",
            );
            break;
          }
          case "Path": {
            err.span_suggestion_verbose(Span.shrink_to_lo(ty.span), borrowed_msg, "&", "MachineApplicable");
            break;
          }
          default:
            break;
        }
      } else {
        err.note("all function arguments must have a statically known size");
      }
      if (UnstableFeatures.is_nightly_build(tcx.sess.opts.unstable_features) && !tcx.features().unsized_fn_params()) {
        err.help("unsized fn params are gated as an unstable feature");
      }
      break;
    }
    case "SizedReturnType":
    case "SizedCallReturnType": {
      err.note("the return type of a function must have a statically known size");
      break;
    }
    case "SizedYieldType": {
      err.note("the yield type of a coroutine must have a statically known size");
      break;
    }
    case "AssignmentLhsSized": {
      err.note("the left-hand-side of an assignment must have a statically known size");
      break;
    }
    case "TupleInitializerSized": {
      err.note("tuples must have a statically known size to be initialized");
      break;
    }
    case "StructInitializerSized": {
      err.note("structs must have a statically known size to be initialized");
      break;
    }
    case "FieldSized": {
      const item = cause_code.adt_kind;
      const last = cause_code.last;
      const span = cause_code.span;
      switch (item) {
        case "Struct": {
          if (last) {
            err.note("the last field of a packed struct may only have a dynamically sized type if it does not need drop to be run");
          } else {
            err.note("only the last field of a struct may have a dynamically sized type");
          }
          break;
        }
        case "Union": {
          err.note("no field of a union may have a dynamically sized type");
          break;
        }
        case "Enum": {
          err.note("no field of an enum variant may have a dynamically sized type");
          break;
        }
      }
      err.help("change the field's type to have a statically known size");
      err.span_suggestion_verbose(Span.shrink_to_lo(span), "borrowed types always have a statically known size", "&", "MachineApplicable");
      err.multipart_suggestion(
        "the `Box` type always has a statically known size and allocates its contents in the heap",
        [
          [Span.shrink_to_lo(span), "Box<"],
          [Span.shrink_to_hi(span), ">"],
        ],
        "MachineApplicable",
      );
      break;
    }
    case "SizedConstOrStatic": {
      err.note("statics and constants must have a statically known size");
      break;
    }
    case "InlineAsmSized": {
      err.note("all inline asm arguments must have a statically known size");
      break;
    }
    case "SizedClosureCapture": {
      const closure_def_id = cause_code._0;
      err.note("all values captured by value by a closure must have a statically known size");
      const kind = hir.Node.expect_expr(tcx.hir_node_by_def_id(closure_def_id)).kind;
      if (kind.$ !== "Closure") {
        return bug("expected closure in SizedClosureCapture obligation");
      }
      const closure = kind._0;
      if (closure.capture_clause.$ === "Value" && closure.fn_arg_span !== undefined) {
        const span = closure.fn_arg_span;
        err.span_label(span, "this closure captures all values by move");
      }
      break;
    }
    case "SizedCoroutineInterior": {
      const coroutine_def_id = cause_code._0;
      // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
      const ck = tcx.coroutine_kind(LocalDefId.to_def_id(coroutine_def_id)) as hir.CoroutineKind | undefined;
      let what: string;
      if (ck === undefined || ck.$ === "Coroutine" || (ck.$ === "Desugared" && ck._0 === "Gen")) {
        what = "yield";
      } else if (ck._0 === "Async") {
        what = "await";
      } else {
        // Some(hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::AsyncGen, _))
        what = "yield`/`await";
      }
      err.note(`all values live across \`${what}\` must have a statically known size`);
      break;
    }
    case "SharedStatic": {
      err.note("shared static variables must have a type that implements `Sync`");
      break;
    }
    case "MatchImpl": {
      const cause = cause_code._0;
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        predicate,
        param_env,
        cause.code_(),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_Predicate,
      );
      break;
    }
    case "BuiltinDerived": {
      const data = cause_code._0;
      const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause_b());
      const ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
      if (TypeVisitableExt.references_error(parent_trait_ref, d_PolyTraitClause_b())) {
        // NOTE(eddyb) this was `.cancel()`, but `err`
        // is borrowed, so we can't fully defuse it.
        err.downgrade_to_delayed_bug();
        return;
      }

      // If the obligation for a tuple is set directly by a Coroutine or Closure,
      // then the tuple must be the one containing capture types.
      let is_upvar_tys_infer_tuple: boolean;
      const parent_code = ObligationCauseCodeHandle.deref(data.parent_code);
      if (ty.kind().$ !== "Tuple") {
        is_upvar_tys_infer_tuple = false;
      } else if (parent_code.$ === "BuiltinDerived") {
        const data = parent_code._0;
        const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause_b());
        const nested_ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
        const nk = nested_ty.kind().$;
        is_upvar_tys_infer_tuple = nk === "Coroutine" || nk === "Closure" || nk === "CoroutineClosure";
      } else {
        is_upvar_tys_infer_tuple = false;
      }

      const is_builtin_async_fn_trait = tcx.async_fn_trait_kind_from_def_id(PolyTraitClause_.def_id(data.parent_trait_pred)) !== undefined;

      if (!is_upvar_tys_infer_tuple && !is_builtin_async_fn_trait) {
        const msg = (): string => {
          const ty_str = tcx.short_string(ty, err.long_ty_path(), print_Ty_);
          return `required because it appears within the type \`${ty_str}\``;
        };
        const k = ty.kind();
        switch (k.$) {
          case "Adt": {
            const def = k._0;
            const args = k._1;
            const msg_ = msg();
            const ident = tcx.opt_item_ident(def.did());
            if (ident !== undefined) {
              const spans = MultiSpan.new();
              const pred = predicate.as_trait_clause();
              if (def.did().is_local() && pred !== undefined) {
                const field_ty = this.deeply_resolve_ignoring_regions(TraitClause.self_ty(Binder.skip_binder(pred)), fold_Ty);
                for (const field of def.all_fields()) {
                  if (Unnormalized.skip_norm_wip(field.ty(tcx, args)) === field_ty) {
                    const sp = tcx.def_span(field.did);
                    spans.push_primary_span(sp);
                    spans.push_span_label(sp, "required by this field");
                  }
                }
              }
              if (spans.has_primary_spans()) {
                spans.push_span_context(ident.span);
              } else {
                spans.push_primary_span(ident.span);
                spans.push_span_label(ident.span, "");
              }
              err.span_note(spans, msg_);
            } else {
              err.note(msg_);
            }
            break;
          }
          case "Alias": {
            if (k._1.kind.$ === "Opaque") {
              const def_id = k._1.kind.def_id;
              // If the previous type is async fn, this is the future generated by the body of an async function.
              // Avoid printing it twice (it was already printed in the `ty::Coroutine` arm below).
              const is_future = tcx.ty_is_opaque_future(ty);
              // debug!(?obligated_types, ?is_future, "note_obligation_cause_code: check for async fn");
              const last = obligated_types[obligated_types.length - 1];
              let last_is_async_coroutine = false;
              if (last !== undefined) {
                const lk = last.kind();
                last_is_async_coroutine = lk.$ === "Coroutine" ? tcx.coroutine_is_async(lk._0) : false;
              }
              if (is_future && last_is_async_coroutine) {
                // See comment above; skip printing twice.
              } else {
                const msg_ = msg();
                err.span_note(tcx.def_span(def_id), msg_);
              }
            } else {
              const msg_ = msg();
              err.note(msg_);
            }
            break;
          }
          case "Coroutine": {
            const def_id = k._0;
            const sp = tcx.def_span(def_id);

            // Special-case this to say "async block" instead of `[static coroutine]`.
            // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
            const kind = unwrap(tcx.coroutine_kind(def_id) as hir.CoroutineKind | undefined);
            err.span_note(sp, with_forced_trimmed_paths(() => `required because it's used within this ${hir.display_CoroutineKind(kind, true)}`));
            break;
          }
          case "CoroutineWitness": {
            // Skip printing coroutine-witnesses, since we'll drill into
            // the bad field in another derived obligation cause.
            break;
          }
          case "Closure": {
            const def_id = k._0;
            const args = k._1;
            if (!this.note_closure_capture(err, def_id, { $: "Closure", _0: args }, closure_capture_ty.value)) {
              err.span_note(tcx.def_span(def_id), "required because it's used within this closure");
            }
            break;
          }
          case "CoroutineClosure": {
            const def_id = k._0;
            const args = k._1;
            if (!this.note_closure_capture(err, def_id, { $: "CoroutineClosure", _0: args }, closure_capture_ty.value)) {
              err.span_note(tcx.def_span(def_id), "required because it's used within this closure");
            }
            break;
          }
          case "Str": {
            err.note("`str` is considered to contain a `[u8]` slice for auto trait purposes");
            break;
          }
          default: {
            const msg_ = msg();
            err.note(msg_);
            break;
          }
        }
      }

      if (!is_upvar_tys_infer_tuple) {
        closure_capture_ty.value = ty;
      }

      obligated_types.push(ty);

      const parent_predicate = parent_trait_ref;
      if (!this.is_recursive_obligation(obligated_types, parent_code)) {
        this.note_obligation_cause_code_inner(
          body_def_id,
          err,
          parent_predicate,
          param_env,
          parent_code,
          obligated_types,
          seen_requirements,
          closure_capture_ty,
          upcast_from_PolyTraitClause,
        );
      } else {
        this.note_obligation_cause_code_inner(
          body_def_id,
          err,
          parent_predicate,
          param_env,
          ObligationCauseCode.peel_derives(cause_code),
          obligated_types,
          seen_requirements,
          closure_capture_ty,
          upcast_from_PolyTraitClause,
        );
      }
      break;
    }
    case "ImplDerived": {
      const data_ = cause_code._0;
      let parent_trait_pred = this.deeply_resolve_ignoring_regions(data_.derived.parent_trait_pred, d_PolyTraitClause_b());
      const parent_def_id = PolyTraitClause_.def_id(parent_trait_pred);
      if (tcx.is_diagnostic_item(sym.FromResidual, parent_def_id) && !tcx.features().enabled(sym.try_trait_v2)) {
        // If `#![feature(try_trait_v2)]` is not enabled, then there's no point on
        // talking about `FromResidual<Result<A, B>>`, as the end user has nothing they
        // can do about it. As far as they are concerned, `?` is compiler magic.
        return;
      }
      if (tcx.is_diagnostic_item(sym.PinDerefMutHelper, parent_def_id)) {
        const parent_predicate = this.deeply_resolve_ignoring_regions(data_.derived.parent_trait_pred, d_PolyTraitClause_b());

        // Skip PinDerefMutHelper in suggestions, but still show downstream suggestions.

        closure_capture_ty.value = TraitClause.self_ty(Binder.skip_binder(parent_trait_pred));
        this.note_obligation_cause_code_inner(
          body_def_id,
          err,
          parent_predicate,
          param_env,
          ObligationCauseCodeHandle.deref(data_.derived.parent_code),
          obligated_types,
          seen_requirements,
          closure_capture_ty,
          upcast_from_PolyTraitClause,
        );
        return;
      }
      const self_ty_str = tcx.short_string(TraitClause.self_ty(Binder.skip_binder(parent_trait_pred)), err.long_ty_path(), print_Ty_);
      const trait_name = tcx.short_string(
        PolyTraitClause_print_modifiers_and_trait_path(parent_trait_pred),
        err.long_ty_path(),
        print_PolyTraitClausePrintModifiersAndPath_b,
      );
      const msg = `required for \`${self_ty_str}\` to implement \`${trait_name}\``;
      let is_auto_trait = false;
      const node = tcx.hir_get_if_local(data_.impl_or_alias_def_id);
      if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Trait") {
        const is_auto = node._0.kind.is_auto;
        const ident = node._0.kind.ident;
        // FIXME: we should do something else so that it works even on crate foreign
        // auto traits.
        is_auto_trait = is_auto === "Yes";
        err.span_note(ident.span, msg);
      } else if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Impl") {
        const { of_trait, self_ty, generics } = node._0.kind._0;
        const spans_: Span[] = [];
        if (of_trait !== undefined && !Span.in_derive_expansion(of_trait.trait_ref.path.span)) {
          spans_.push(of_trait.trait_ref.path.span);
        }
        spans_.push(self_ty.span);
        const spans: MultiSpan = MultiSpan.from_Vec(spans_);
        let derived = false;
        const self_ty_expn_kind = SyntaxContext.outer_expn_data(Span.ctxt(self_ty.span)).kind;
        const of_trait_expn_kind = of_trait === undefined ? undefined : SyntaxContext.outer_expn_data(Span.ctxt(of_trait.trait_ref.path.span)).kind;
        if (
          (self_ty_expn_kind.$ === "Macro" && self_ty_expn_kind._0 === "Derive") ||
          (of_trait_expn_kind !== undefined && of_trait_expn_kind.$ === "Macro" && of_trait_expn_kind._0 === "Derive")
        ) {
          derived = true;
          spans.push_span_label(
            data_.span,
            Span.in_derive_expansion(data_.span) ? `type parameter would need to implement \`${trait_name}\`` : "unsatisfied trait bound",
          );
        } else if (!Span.is_dummy(data_.span) && !Span.overlaps(data_.span, self_ty.span)) {
          // `Sized` may be an explicit or implicit trait bound. If it is
          // implicit, mention it as such.
          const pred = predicate.as_trait_clause();
          if (
            pred !== undefined &&
            this.tcx.is_lang_item(PolyTraitClause_.def_id(pred), LangItem.Sized) &&
            // PORT: the `generics_of` query's value is typed `unknown` in queries.gen.ts; it is `&Generics`.
            (this.tcx.generics_of(data_.impl_or_alias_def_id) as Generics).own_params.some((param) => this.tcx.def_span(param.def_id) === data_.span)
          ) {
            spans.push_span_label(data_.span, "unsatisfied trait bound implicitly introduced here");
          } else {
            spans.push_span_label(data_.span, "unsatisfied trait bound introduced here");
          }
        }
        err.span_note(spans, msg);
        if (derived && this.is_truly_imperfect_derive(parent_trait_pred, predicate, param_env)) {
          err.help(`consider manually implementing \`${trait_name}\` to avoid undesired bounds caused by "imperfect derives"`);
          err.note("to learn more, visit <https://github.com/rust-lang/rust/issues/26925>");
        }
        point_at_assoc_type_restriction(tcx, err, self_ty_str, trait_name, predicate, generics, data_);
      } else {
        err.note(msg);
      }

      // PORT: `parent_predicate` is inferred as `ty::PolyTraitClauseT` (its initializer), so the `.upcast(tcx)`s below
      // are the reflexive upcast.
      let parent_predicate: PolyTraitClauseT = parent_trait_pred;
      let data: DerivedCause = data_.derived;
      let count = 0;
      set_insert(seen_requirements, parent_def_id);
      if (is_auto_trait) {
        // We don't want to point at the ADT saying "required because it appears within
        // the type `X`", like we would otherwise do in test `supertrait-auto-trait.rs`.
        let pc: ObligationCauseCode;
        while ((pc = ObligationCauseCodeHandle.deref(data.parent_code)).$ === "BuiltinDerived") {
          const derived = pc._0;
          const child_trait_ref = this.deeply_resolve_ignoring_regions(derived.parent_trait_pred, d_PolyTraitClause_b());
          const child_def_id = PolyTraitClause_.def_id(child_trait_ref);
          if (set_insert(seen_requirements, child_def_id)) {
            break;
          }
          data = derived;
          parent_predicate = child_trait_ref;
          parent_trait_pred = child_trait_ref;
        }
      }
      let pc: ObligationCauseCode;
      while ((pc = ObligationCauseCodeHandle.deref(data.parent_code)).$ === "ImplDerived") {
        const child = pc._0;
        // Skip redundant recursive obligation notes. See `ui/issue-20413.rs`.
        const child_trait_pred = this.deeply_resolve_ignoring_regions(child.derived.parent_trait_pred, d_PolyTraitClause_b());
        const child_def_id = PolyTraitClause_.def_id(child_trait_pred);
        if (set_insert(seen_requirements, child_def_id)) {
          break;
        }
        count += 1;
        data = child.derived;
        parent_predicate = child_trait_pred;
        parent_trait_pred = child_trait_pred;
      }
      if (count > 0) {
        err.note(`${count} redundant requirement${pluralize(count)} hidden`);
        const self_ty = tcx.short_string(TraitClause.self_ty(Binder.skip_binder(parent_trait_pred)), err.long_ty_path(), print_Ty_);
        const trait_path = tcx.short_string(
          PolyTraitClause_print_modifiers_and_trait_path(parent_trait_pred),
          err.long_ty_path(),
          print_PolyTraitClausePrintModifiersAndPath_b,
        );
        err.note(`required for \`${self_ty}\` to implement \`${trait_path}\``);
      }
      closure_capture_ty.value = TraitClause.self_ty(Binder.skip_binder(parent_trait_pred));
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        parent_predicate,
        param_env,
        ObligationCauseCodeHandle.deref(data.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyTraitClause,
      );
      break;
    }
    case "ImplDerivedHost": {
      const data = cause_code._0;
      const self_ty = tcx.short_string(
        this.deeply_resolve_ignoring_regions(PolyHostEffectClause.self_ty(data.derived.parent_host_clause), d_Binder_Ty()),
        err.long_ty_path(),
        print_Binder_Ty,
      );
      const trait_path = tcx.short_string(
        PolyTraitRef_print_only_trait_path(Binder.map_bound(data.derived.parent_host_clause, (clause) => clause.trait_ref)),
        err.long_ty_path(),
        print_PolyTraitRefPrintOnlyTraitPath,
      );
      const msg = `required for \`${self_ty}\` to implement \`${display_BoundConstness(Binder.skip_binder(data.derived.parent_host_clause).constness)} ${trait_path}\``;
      const node = tcx.hir_get_if_local(data.impl_def_id);
      if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Impl") {
        const { of_trait, self_ty } = node._0.kind._0;
        const spans_: Span[] = [self_ty.span];
        if (of_trait !== undefined) spans_.push(of_trait.trait_ref.path.span);
        const spans: MultiSpan = MultiSpan.from_Vec(spans_);
        spans.push_span_label(data.span, "unsatisfied trait bound introduced here");
        err.span_note(spans, msg);
      } else {
        err.note(msg);
      }

      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        data.derived.parent_host_clause,
        param_env,
        ObligationCauseCodeHandle.deref(data.derived.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyHostEffectClause,
      );
      break;
    }
    case "BuiltinDerivedHost": {
      const data = cause_code._0;
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        data.parent_host_clause,
        param_env,
        ObligationCauseCodeHandle.deref(data.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyHostEffectClause,
      );
      break;
    }
    case "WellFormedDerived": {
      const data = cause_code._0;
      const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause_b());
      const parent_predicate = parent_trait_ref;

      closure_capture_ty.value = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        parent_predicate,
        param_env,
        ObligationCauseCodeHandle.deref(data.parent_code),
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_PolyTraitClause,
      );
      break;
    }
    case "TypeAlias": {
      const nested = ObligationCauseCodeHandle.deref(cause_code._0);
      const span = cause_code._1;
      const def_id = cause_code._2;
      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        predicate,
        param_env,
        nested,
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_Predicate,
      );
      const multispan = MultiSpan.from_Span(span);
      multispan.push_span_label(span, "required by this bound");
      err.span_note(multispan, `required by a bound on the type alias \`${display_Symbol(tcx.item_name(def_id))}\``);
      break;
    }
    case "FunctionArg": {
      const arg_hir_id = cause_code.arg_hir_id;
      const call_hir_id = cause_code.call_hir_id;
      const parent_code = ObligationCauseCodeHandle.deref(cause_code.parent_code);
      this.note_function_argument_obligation(body_def_id, err, arg_hir_id, parent_code, param_env, predicate, call_hir_id);

      this.note_obligation_cause_code_inner(
        body_def_id,
        err,
        predicate,
        param_env,
        parent_code,
        obligated_types,
        seen_requirements,
        closure_capture_ty,
        upcast_from_Predicate,
      );
      break;
    }
    case "CompareImplItem": {
      const trait_item_def_id = cause_code.trait_item_def_id;
      // Suppress `compare_type_clause_entailment` errors for RPITITs, since they
      // should be implied by the parent method.
      if (tcx.is_impl_trait_in_trait(trait_item_def_id)) {
        break;
      }
      const kind = cause_code.kind;
      const item_name = tcx.item_name(trait_item_def_id);
      const msg = `the requirement \`${display_Predicate(predicate)}\` appears on the \`impl\`'s ${display_AssocKind(kind)} \`${display_Symbol(item_name)}\` but not on the corresponding trait's ${display_AssocKind(kind)}`;
      const sp = tcx.opt_item_ident(trait_item_def_id)?.span ?? tcx.def_span(trait_item_def_id);
      const assoc_span: MultiSpan = MultiSpan.from_Span(sp);
      assoc_span.push_span_label(sp, `this trait's ${display_AssocKind(kind)} doesn't have the requirement \`${display_Predicate(predicate)}\``);
      const item = tcx.opt_associated_item(trait_item_def_id);
      const ident = item === undefined ? undefined : tcx.opt_item_ident(AssocItem.container_id(item, tcx));
      if (ident !== undefined) {
        assoc_span.push_span_label(ident.span, "in this trait");
      }
      err.span_note(assoc_span, msg);
      break;
    }
    case "TrivialBound": {
      tcx.disabled_nightly_features(err, [["", sym.trivial_bounds]]);
      break;
    }
    case "OpaqueReturnType": {
      const expr_info = cause_code._0;
      // Point at the method call in the returned expression's chain where an
      // associated type diverged from what the signature's opaque type expects,
      // regardless of how the failed predicate was derived from that expectation.
      if (this.typeck_results !== undefined) {
        const typeck_results = this.typeck_results;
        let chain_expr: hir.Expr | undefined;
        if (expr_info !== undefined) {
          const [, hir_id] = expr_info;
          chain_expr = tcx.hir_expect_expr(hir_id);
        } else {
          const body_id = hir.Node.body_id(tcx.hir_node_by_def_id(body_def_id));
          if (body_id === undefined) {
            chain_expr = undefined;
          } else {
            const k = tcx.hir_body(body_id).value.kind;
            chain_expr = k.$ === "Block" ? k._0.expr : undefined;
          }
        }
        if (chain_expr !== undefined) {
          this.point_at_chain_in_return_position(body_def_id, chain_expr, typeck_results, param_env, err);
        }
      }
      let expr_ty: Ty;
      let expr: hir.Expr;
      if (expr_info !== undefined) {
        const [expr_ty_, hir_id] = expr_info;
        const expr_ = tcx.hir_expect_expr(hir_id);
        expr_ty = expr_ty_;
        expr = expr_;
      } else {
        const found = ((): [Ty, hir.Expr] | undefined => {
          const body_id = hir.Node.body_id(tcx.hir_node_by_def_id(body_def_id));
          if (body_id === undefined) return undefined;
          const body = tcx.hir_body(body_id);
          if (body.value.kind.$ !== "Block") return undefined;
          const block = body.value.kind._0;
          if (block.expr === undefined) return undefined;
          const expr = block.expr;
          const expr_ty = this.typeck_results === undefined ? undefined : this.typeck_results.node_type_opt(expr.hir_id);
          if (expr_ty === undefined) return undefined;
          const pred_ = predicate.as_clause();
          if (pred_ === undefined) return undefined;
          const pred = pred_.as_trait_clause();
          if (pred === undefined) return undefined;
          if (!this.infcx.enter_forall(pred, (pred) => this.can_eq(param_env, TraitClause.self_ty(pred), expr_ty, ToTrace_Ty), d_TraitClause_b)) {
            return undefined;
          }
          return [expr_ty, expr];
        })();
        if (found === undefined) {
          return;
        }
        [expr_ty, expr] = found;
      }
      const expr_ty_string = tcx.short_string(expr_ty, err.long_ty_path(), print_Ty_);
      if (expr_ty.is_never()) {
        const span = Span.source_callsite(expr.span);
        const snippet = tcx.sess.source_map().span_to_snippet(span);
        if (snippet.$ === "Ok" && span !== expr.span) {
          err.span_suggestion(
            span,
            "`!` can be coerced to any type; consider casting it to a concrete type that implements the trait",
            `${snippet._0.toString()} as /* Type */`,
            "HasPlaceholders",
          );
        }
      }
      err.span_label(expr.span, with_forced_trimmed_paths(() => `return type was inferred to be \`${expr_ty_string}\` here`));
      suggest_remove_deref(err, expr);
      break;
    }
    case "UnsizedNonPlaceExpr": {
      const span = cause_code._0;
      err.span_note(span, "unsized values must be place expressions and cannot be put in temporaries");
      break;
    }
    case "CompareEii": {
      return panic("trait bounds on EII not yet supported ");
    }
  }
};

// ---- helpers (lane errrep-sugg-b) ----------------------------------------------------------------------------------

/** The reflexive `impl<I, T> UpcastFrom<I, T> for T` (rustc_type_ir upcast.rs) at `Predicate`. */
const upcast_from_Predicate: (from: Predicate, tcx: Interner) => Predicate = upcast_from_self;

/** `impl<'tcx> rustc_type_ir::visit::TypeVisitable/TypeFoldable for TraitClause` (generated fns) as a descriptor. */
const d_TraitClause_b: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};

/** `ty::PolyTraitClauseT`'s `TypeFoldable` (`Binder<TraitClause>`). */
function d_PolyTraitClause_b(): TypeSuperFoldable<PolyTraitClauseT> & TypeSuperVisitable<PolyTraitClauseT> {
  return fold_Binder(d_TraitClause_b);
}

/** `ty::Binder<Ty>`'s `TypeFoldable`. */
function d_Binder_Ty(): TypeSuperFoldable<Binder<Ty>> & TypeSuperVisitable<Binder<Ty>> {
  return fold_Binder(fold_Ty);
}

/**
 * pretty.rs:3057 `#[derive(TypeFoldable, TypeVisitable)]` of `TraitClausePrintModifiersAndPath(ty::TraitClause)`.
 * PORT: codegen pending (no generated folds for the print wrappers; precedent hir_ty_lowering/errors.ts): the derive of a
 * one-field tuple struct visits / folds its field.
 */
const d_TraitClausePrintModifiersAndPath: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Err" ? r : Ok({ _0: r._0 });
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder) }),
};

/**
 * pretty.rs:2981 `#[derive(TypeFoldable, TypeVisitable)]` of `TraitRefPrintOnlyTraitPath(ty::TraitRef)`.
 * PORT: codegen pending, as `d_TraitClausePrintModifiersAndPath`.
 */
const d_TraitRefPrintOnlyTraitPath: TypeFoldable<TraitRefPrintOnlyTraitPath> = {
  visit_with: (v, visitor) => visit_with_TraitRef(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitRef(v._0, folder);
    return r.$ === "Err" ? r : Ok({ _0: r._0 });
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitRef(v._0, folder) }),
};

/** `Print for ty::Binder<'tcx, TraitClausePrintModifiersAndPath>` (pretty.rs:2960). */
function print_PolyTraitClausePrintModifiersAndPath_b(self: Binder<TraitClausePrintModifiersAndPath>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_TraitClausePrintModifiersAndPath, d_TraitClausePrintModifiersAndPath);
}

/** `Display for ty::Binder<'tcx, TraitClausePrintModifiersAndPath>` (rustc_type_ir ir_print.rs through `IrPrint` for `TyCtxt`). */
function display_PolyTraitClausePrintModifiersAndPath_b(self: Binder<TraitClausePrintModifiersAndPath>): string {
  return IrPrint_print(self, PLAIN, print_PolyTraitClausePrintModifiersAndPath_b);
}

/** `Print for ty::Binder<'tcx, TraitRefPrintOnlyTraitPath>` (pretty.rs:2960). */
function print_PolyTraitRefPrintOnlyTraitPath(self: Binder<TraitRefPrintOnlyTraitPath>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_TraitRefPrintOnlyTraitPath, d_TraitRefPrintOnlyTraitPath);
}

/** `Print for ty::Binder<'tcx, Ty>` (pretty.rs:2960). */
function print_Binder_Ty(self: Binder<Ty>, p: PrettyPrinter): PrintResult {
  return print_Binder(self, p, print_Ty, fold_Ty);
}

/** `Print for Ty` as the printer-generic fn `TyCtxt::short_string` takes. */
function print_Ty_(self: Ty, p: PrettyPrinter): PrintResult {
  return print_Ty(self, p);
}

/** `impl UpcastFrom<TyCtxt, PolyTraitClauseT> for Predicate` (rustc_middle ty/predicate.rs). */
function upcast_from_PolyTraitClause(from: PolyTraitClauseT, tcx: Interner): Predicate {
  return Predicate_upcast_from_PolyTraitClause(from, tcx as unknown as TyCtxt);
}

/** `impl UpcastFrom<TyCtxt, ty::Binder<HostEffectClause>> for Predicate` (rustc_middle ty/predicate.rs). */
function upcast_from_PolyHostEffectClause(from: Binder<HostEffectClause>, tcx: Interner): Predicate {
  return Predicate_upcast_from_PolyHostEffectClause(from, tcx as unknown as TyCtxt);
}

/** `#[derive(PartialEq)]` of `ty::Binder<T>` for interned `T` (`value` and `bound_vars` are interned). */
function Binder_eq<T>(a: Binder<T>, b: Binder<T>): boolean {
  return Binder.skip_binder(a) === Binder.skip_binder(b) && Binder.bound_vars(a) === Binder.bound_vars(b);
}

/**
 * The or-pattern `Node::Item(hir::Item { kind: hir::ItemKind::Fn { sig: fn_sig, .. }, .. })
 * | Node::ImplItem(hir::ImplItem { kind: hir::ImplItemKind::Fn(fn_sig, _), .. })
 * | Node::TraitItem(hir::TraitItem { kind: hir::TraitItemKind::Fn(fn_sig, _), .. })` binding `fn_sig`.
 */
function fn_sig_of_node(node: hir.Node): hir.FnSig | undefined {
  if (node.$ === "Item" && node._0.kind.$ === "Fn") return node._0.kind.sig;
  if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") return node._0.kind._0;
  if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") return node._0.kind._0;
  return undefined;
}

/**
 * `mir::CoroutineLayout` (rustc_middle mir/query.rs): the fields `maybe_note_obligation_cause_for_async_await` reads.
 * PORT: the `mir_coroutine_witnesses` query's value is `unknown` until MIR lands (M4; precedent rustc_traits
 * coroutine_witnesses.ts `CoroutineLayoutFieldTys`).
 */
interface CoroutineLayoutView {
  /// The type of every local stored inside the coroutine.
  field_tys: readonly { ty: Ty; source_info: { span: Span }; ignore_for_traits: boolean }[];
  /// Which of the above fields are in each variant. Note that one field may
  /// be stored in multiple variants.
  variant_fields: readonly (readonly number[])[];
  /// The source that led to each variant being created (usually, a yield or
  /// await).
  variant_source_info: readonly { span: Span }[];
}

/** `FxHashSet::insert`: `true` if the value was not present. */
function set_insert(set: DefIdSet, v: DefId): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** `str::chars()` as Unicode scalar values. */
function chars(s: string): number[] {
  const out: number[] = [];
  for (const c of s) out.push(c.codePointAt(0)!);
  return out;
}

/** `str::trim_start_matches(pred)` */
function trim_start_matches(s: string, pred: (c: number) => boolean): string {
  let i = 0;
  for (const c of s) {
    if (!pred(c.codePointAt(0)!)) break;
    i += c.length;
  }
  return s.slice(i);
}

/** `slice == slice` / `iter().eq(iter())` for `===`-comparable elements. */
function slice_eq<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** `Option::is_some_and` */
function is_some_and<T>(v: T | undefined, f: (v: T) => boolean): boolean {
  return v !== undefined && f(v);
}

const C_AMP = 0x26; // '&'
const C_QUOTE = 0x27; // '\''

/** The crate's error_reporting/traits/mod.ts (read inside function bodies: init order). */
function traits_er_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
// ==== end lane errrep-sugg-b ====

// =====================================================================================================================
// lane errrep-sugg-c: error_reporting/traits/suggestions.rs:5018..7379 (`impl TypeErrCtxt` from `suggest_await_before_try`
// to `is_truly_imperfect_derive`, then the free fns and helper types after the impl; `SelfVisitor`, `ReturnsVisitor` and
// `AwaitsVisitor` are above, ported by errctxt-contract).
// =====================================================================================================================

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx> (continued)

// #[instrument(level = "debug", skip(self, err), fields(trait_pred.self_ty = ?trait_pred.self_ty()))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5022 suggest_await_before_try
TypeErrCtxt.prototype.suggest_await_before_try = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
  span: Span,
): void {
  const future_trait = this.tcx.require_lang_item("Future", span);

  const self_ty = this.deeply_resolve_ignoring_regions(PolyTraitClauseC.self_ty(trait_pred), d_Binder_Ty_c());
  const impls_future = this.type_implements_trait(
    future_trait,
    [this.tcx.instantiate_bound_regions_with_erased(self_ty, fold_Ty)],
    obligation.param_env,
  );
  if (!EvaluationResult.must_apply_modulo_regions(impls_future)) {
    return;
  }

  const item_def_id = this.tcx.associated_item_def_ids(future_trait)[0];
  // `<T as Future>::Output`
  const projection_ty_ = Binder.map_bound(trait_pred, (trait_pred) =>
    Ty.new_projection(
      this.tcx,
      "No",
      item_def_id,
      // Future::Output has no args
      [TraitClause.self_ty(trait_pred)],
    ),
  );
  const projection_ty = this.at(obligation.cause, obligation.param_env).normalize(Unnormalized.new_wip(projection_ty_), d_Binder_Ty_c()).value;

  // debug!(normalized_projection_type = ?self.deeply_resolve_ignoring_regions(projection_ty));
  const try_obligation = this.mk_trait_obligation_with_new_self_ty(
    obligation.param_env,
    Binder.map_bound(trait_pred, (trait_pred): [TraitClause, Ty] => [trait_pred, Binder.skip_binder(projection_ty)]),
  );
  // debug!(try_trait_obligation = ?try_obligation);
  let snippet: Result<Str, unknown>;
  if (
    this.predicate_may_hold(try_obligation) &&
    (snippet = this.tcx.sess.source_map().span_to_snippet(span)).$ === "Ok" &&
    snippet._0.toString().endsWith("?")
  ) {
    const k = this.tcx.coroutine_kind(obligation.cause.body_def_id) as hir.CoroutineKind | undefined;
    if (k !== undefined && k.$ === "Desugared" && k._0 === "Async") {
      err.span_suggestion_verbose(
        Span.shrink_to_hi(Span.with_hi(span, (Span.hi(span) - 1) as BytePos)),
        "consider `await`ing on the `Future`",
        ".await",
        "MaybeIncorrect",
      );
    } else {
      const span_: MultiSpan = MultiSpan.from_Span(Span.with_lo(span, (Span.hi(span) - 1) as BytePos));
      span_.push_span_label(this.tcx.def_span(obligation.cause.body_def_id), "this is not `async`");
      err.span_note(
        span_,
        "this implements `Future` and its output type supports `?`, but the future cannot be awaited in a synchronous function",
      );
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5093 suggest_floating_point_literal
TypeErrCtxt.prototype.suggest_floating_point_literal = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClauseT,
): void {
  const code = obligation.cause.code_();
  let rhs_span: Span;
  if (code.$ === "BinOp" && code.rhs_is_lit) {
    rhs_span = code.rhs_span;
  } else {
    return;
  }
  let k: TyKind;
  if (
    TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind().$ === "Float" &&
    (k = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind()).$ === "Infer" &&
    k._0.$ === "IntVar"
  ) {
    err.span_suggestion_verbose(
      Span.shrink_to_hi(rhs_span),
      "consider using a floating-point literal by writing it with `.0`",
      ".0",
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5116 can_suggest_derive
TypeErrCtxt.prototype.can_suggest_derive = function (this: TypeErrCtxt, obligation: PredicateObligation, trait_pred: PolyTraitClauseT): boolean {
  if (PolyTraitClauseC.polarity(trait_pred) === "Negative") {
    return false;
  }
  const diagnostic_name = this.tcx.get_diagnostic_name(PolyTraitClauseC.def_id(trait_pred));
  if (diagnostic_name === undefined) {
    return false;
  }
  const self_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
  let adt: AdtDef, args: GenericArgs;
  if (self_kind.$ === "Adt" && self_kind._0.did().is_local()) {
    [adt, args] = [self_kind._0, self_kind._1];
  } else {
    return false;
  }
  if (!Span.can_be_used_for_suggestions(this.tcx.def_span(adt.did()))) {
    return false;
  }
  let is_derivable_trait: boolean;
  if (diagnostic_name === sym.Copy || diagnostic_name === sym.Clone) {
    is_derivable_trait = true;
  } else if (adt.is_union()) {
    is_derivable_trait = false;
  } else if (diagnostic_name === sym.PartialEq || diagnostic_name === sym.PartialOrd) {
    const rhs_ty = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1);
    is_derivable_trait = TraitClause.self_ty(Binder.skip_binder(trait_pred)) === rhs_ty;
  } else if (
    diagnostic_name === sym.Eq ||
    diagnostic_name === sym.Ord ||
    diagnostic_name === sym.Hash ||
    diagnostic_name === sym.Debug ||
    diagnostic_name === sym.Default
  ) {
    is_derivable_trait = true;
  } else {
    is_derivable_trait = false;
  }
  if (!is_derivable_trait) {
    return false;
  }
  // Ensure all fields impl the trait.
  for (const field of adt.all_fields()) {
    const field_ty: GenericArg = Unnormalized.skip_norm_wip(field.ty(this.tcx, args));
    let trait_args: GenericArg | undefined;
    if (diagnostic_name === sym.PartialEq || diagnostic_name === sym.PartialOrd) {
      trait_args = field_ty;
    } else {
      trait_args = undefined;
    }
    const trait_pred_ = Binder.map_bound_ref(trait_pred, (tr): TraitClause => ({
      ...tr,
      trait_ref: TraitRef.new(as_interner(this.tcx), PolyTraitClauseC.def_id(trait_pred), trait_args === undefined ? [field_ty] : [field_ty, trait_args]),
    }));
    const field_obl = Obligation.new(this.tcx, clone_ObligationCause(obligation.cause), obligation.param_env, trait_pred_, upcast_PolyTraitClause);
    if (!this.predicate_must_hold_modulo_regions(field_obl)) {
      return false;
    }
  }
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5171 suggest_derive
TypeErrCtxt.prototype.suggest_derive = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClauseT): void {
  const diagnostic_name = this.tcx.get_diagnostic_name(PolyTraitClauseC.def_id(trait_pred));
  if (diagnostic_name === undefined) {
    return;
  }
  const self_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
  let adt: AdtDef;
  if (self_kind.$ === "Adt" && self_kind._0.did().is_local()) {
    adt = self_kind._0;
  } else {
    return;
  }
  if (this.can_suggest_derive(obligation, trait_pred)) {
    err.span_suggestion_verbose(
      Span.shrink_to_lo(this.tcx.def_span(adt.did())),
      `consider annotating \`${display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)))}\` with \`#[derive(${display_Symbol(diagnostic_name)})]\``,
      // FIXME(const_trait_impl) derive_const as suggestion?
      `#[derive(${display_Symbol(diagnostic_name)})]\n`,
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5199 suggest_dereferencing_index
TypeErrCtxt.prototype.suggest_dereferencing_index = function (this: TypeErrCtxt, obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClauseT): void {
  let inner_kind: TyKind;
  if (
    obligation.cause.code_().$ === "ImplDerived" &&
    this.tcx.is_diagnostic_item(sym.SliceIndex, Binder.skip_binder(trait_pred).trait_ref.def_id) &&
    Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind().$ === "Slice" &&
    (inner_kind = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind()).$ === "Ref" &&
    ((k) => k.$ === "Uint" && k._0 === "Usize")(inner_kind._1.kind())
  ) {
    // If the index is written as `&i`, suggest removing the borrow instead of
    // dereferencing it, i.e. `v[&i]` -> `v[i]` rather than `v[*&i]`.
    const span = obligation.cause.span;
    let body: hir.Body | undefined, expr: hir.Expr | undefined, amp_span: Span | undefined;
    if (
      !Span.from_expansion(span) &&
      (body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id)) !== undefined &&
      (expr = (() => {
        const finder = traits_mod().FindExprBySpan.new(span, this.tcx);
        finder.visit_expr(body.value);
        return finder.result;
      })()) !== undefined &&
      expr.kind.$ === "AddrOf" &&
      expr.kind._0 === "Ref" &&
      expr.kind._1 === "Not" &&
      (amp_span = ((borrowed: hir.Expr, expr: hir.Expr) => {
        const borrowed_span = Span.find_ancestor_inside_same_ctxt(borrowed.span, expr.span);
        return borrowed_span === undefined ? undefined : Span.until(expr.span, borrowed_span);
      })(expr.kind._2, expr)) !== undefined &&
      ((r) => r.$ === "Ok" && r._0.starts_with("&"))(this.tcx.sess.source_map().span_to_snippet(amp_span))
    ) {
      err.span_suggestion_verbose(amp_span, "remove this reference", "", "MachineApplicable");
      return;
    }

    err.span_suggestion_verbose(Span.shrink_to_lo(obligation.cause.span), "dereference this index", "*", "MachineApplicable");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5254 note_function_argument_obligation
TypeErrCtxt.prototype.note_function_argument_obligation = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  err: Diag,
  arg_hir_id: HirId,
  parent_code: ObligationCauseCode,
  param_env: ParamEnv,
  failed_pred: Predicate,
  call_hir_id: HirId,
): void {
  const tcx = this.tcx;
  const arg_node = tcx.hir_node(arg_hir_id);
  if (arg_node.$ === "Expr" && this.typeck_results !== undefined) {
    const expr = arg_node._0;
    const typeck_results = this.typeck_results;
    let rcvr: hir.Expr, ty: Ty | undefined, failed_pred_: PolyTraitClauseT | undefined, pred: PolyTraitClauseT;
    if (
      expr.kind.$ === "MethodCall" &&
      ((rcvr = expr.kind._1), true) &&
      (ty = typeck_results.node_type_opt(rcvr.hir_id)) !== undefined &&
      (failed_pred_ = failed_pred.as_trait_clause()) !== undefined &&
      ((pred = Binder.map_bound(failed_pred_, (pred) => TraitClause.with_replaced_self_ty(pred, as_interner(tcx), ty!))), true) &&
      this.predicate_must_hold_modulo_regions(Obligation.misc(tcx, expr.span, body_def_id, param_env, pred, upcast_PolyTraitClause)) &&
      Span.hi(expr.span) !== Span.hi(rcvr.span)
    ) {
      const ty_ = ty;
      let should_sugg: boolean;
      const call_node = tcx.hir_node(call_hir_id);
      let tdd: [DefKind, DefId] | undefined;
      if (
        call_node.$ === "Expr" &&
        call_node._0.kind.$ === "MethodCall" &&
        (tdd = typeck_results.type_dependent_def(call_hir_id)) !== undefined &&
        tdd[0].$ === "AssocFn" &&
        HirId_eq(call_node._0.kind._1.hir_id, arg_hir_id)
      ) {
        const did = tdd[1];
        // Avoid suggesting removing a method call if the argument is the receiver of the parent call and
        // removing the receiver would make the method inaccessible. i.e. `x.a().b()`, suggesting removing
        // `.a()` could change the type and make `.b()` unavailable.
        if (tcx.inherent_impl_of_assoc(did) !== undefined) {
          // if we're calling an inherent impl method, just try to make sure that the receiver type stays the same.
          should_sugg = ty_ === typeck_results.node_type_opt(arg_hir_id);
        } else {
          // we're calling a trait method, so we just check removing the method call still satisfies the trait.
          const trait_id = tcx.trait_of_assoc(did) ?? tcx.impl_trait_id(tcx.parent(did));
          const args = typeck_results.node_args(call_hir_id);
          const tr = TraitRef.with_replaced_self_ty(TraitRef.from_assoc(as_interner(tcx), trait_id, args), as_interner(tcx), ty_);
          should_sugg = EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(tr.def_id, tr.args, param_env));
        }
      } else {
        should_sugg = true;
      }

      if (should_sugg) {
        err.span_suggestion_verbose(
          Span.with_lo(expr.span, Span.hi(rcvr!.span)),
          `consider removing this method call, as the receiver has type \`${display_Ty(ty_)}\` and \`${display_PolyTraitClause(pred!)}\` trivially holds`,
          "",
          "MaybeIncorrect",
        );
      }
    }
    if (expr.kind.$ === "Block") {
      const block = expr.kind._0;
      const inner_expr = expr.peel_blocks();
      const ty = typeck_results.expr_ty_adjusted_opt(inner_expr) ?? Ty.new_misc_error(tcx);
      const span = inner_expr.span;
      if (span !== err.deref().span.primary_span() && !Span.in_external_macro(span, tcx.sess.source_map())) {
        err.span_label(
          span,
          TypeVisitableExt.references_error(ty, fold_Ty)
            ? ""
            : (() => {
                const ty_ = with_forced_trimmed_paths(() => this.ty_to_string(ty));
                return `this tail expression is of type \`${ty_}\``;
              })(),
        );
        const pk = Binder.skip_binder(failed_pred.kind());
        let stmt: hir.Stmt | undefined, value: hir.Expr, closure: hir.Closure, body: hir.Body;
        if (
          pk.$ === "Clause" &&
          pk._0.$ === "Trait" &&
          tcx.fn_trait_kind_from_def_id(TraitClause.def_id(pk._0._0)) !== undefined
        ) {
          const pred = pk._0._0;
          if (
            (stmt = block.stmts[0]) !== undefined &&
            stmt.kind.$ === "Semi" &&
            ((value = stmt.kind._0), true) &&
            value.kind.$ === "Closure" &&
            ((closure = value.kind._0), true) &&
            ((body = tcx.hir_body(closure.body)), true) &&
            !(body.value.kind.$ === "Block")
          ) {
            // Check if the failed predicate was an expectation of a closure type
            // and if there might have been a `{ |args|` typo instead of `|args| {`.
            err.multipart_suggestion(
              "you might have meant to open the closure body instead of placing a closure within a block",
              [
                [Span.with_hi(expr.span, Span.lo(value!.span)), ""],
                [Span.shrink_to_hi(closure!.fn_decl_span), " {"],
              ],
              "MaybeIncorrect",
            );
          } else {
            // Maybe the bare block was meant to be a closure.
            err.span_suggestion_verbose(
              Span.shrink_to_lo(expr.span),
              "you might have meant to create the closure instead of a block",
              `|${Array.from({ length: pred.trait_ref.args.length - 1 }, () => "_").join(", ")}| `,
              "MaybeIncorrect",
            );
          }
        }
      }
    }

    // FIXME: visit the ty to see if there's any closure involved, and if there is,
    // check whether its evaluated return type is the same as the one corresponding
    // to an associated type (as seen from `trait_pred`) in the predicate. Like in
    // trait_pred `S: Sum<<Self as Iterator>::Item>` and predicate `i32: Sum<&()>`
    let type_diffs: TypeError[] = [];
    let node_args: GenericArgs | undefined, where_pred_u: Unnormalized<Clause> | undefined;
    if (
      parent_code.$ === "WhereClauseInExpr" &&
      (node_args = typeck_results.node_args_opt(call_hir_id)) !== undefined &&
      (where_pred_u = GenericClauses.instantiate(this.tcx.clauses_of(parent_code._0) as GenericClauses, this.tcx, node_args).clauses[parent_code._3]) !== undefined
    ) {
      const where_pred = Unnormalized.skip_norm_wip(where_pred_u);
      let where_pred_t: PolyTraitClauseT | undefined, failed_pred_t: PolyTraitClauseT | undefined;
      let where_pred_p: PolyProjectionClause | undefined, failed_pred_p: PolyProjectionClause | undefined, found: Ty | undefined;
      if (
        (where_pred_t = where_pred.as_trait_clause()) !== undefined &&
        (failed_pred_t = failed_pred.as_trait_clause()) !== undefined &&
        DefId_eq(PolyTraitClauseC.def_id(where_pred_t), PolyTraitClauseC.def_id(failed_pred_t))
      ) {
        const failed_pred_t_ = failed_pred_t;
        this.enter_forall(
          where_pred_t,
          (where_pred) => {
            const failed_pred = this.instantiate_binder_with_fresh_vars(expr.span, BoundRegionConversionTime.FnCall, failed_pred_t_, d_TraitClause_c);

            const zipped_a = where_pred.trait_ref.args;
            const zipped_b = failed_pred.trait_ref.args;
            for (let i = 0; i < Math.min(zipped_a.length, zipped_b.length); i++) {
              const [expected, actual] = [zipped_a[i], zipped_b[i]];
              this.probe((_) => {
                const r = this.at(ObligationCause.misc(expr.span, body_def_id), param_env)
                  // Doesn't actually matter if we define opaque types here, this is just used for
                  // diagnostics, and the result is never kept around.
                  .eq("Yes", expected, actual, ToTrace_GenericArg);
                if (r.$ === "Ok") {
                  // We ignore nested obligations here for now.
                } else {
                  type_diffs.push(r._0);
                }
              });
            }
          },
          d_TraitClause_c,
        );
      } else if (
        (where_pred_p = where_pred.as_projection_clause()) !== undefined &&
        (failed_pred_p = failed_pred.as_projection_clause()) !== undefined &&
        (found = ((t: Binder<Ty> | undefined) =>
          t === undefined ? undefined : this.instantiate_binder_with_fresh_vars(expr.span, BoundRegionConversionTime.FnCall, t, fold_Ty))(
          Binder.transpose(Binder.map_bound(failed_pred_p, (pred) => Term.as_type(pred.term))),
        )) !== undefined
      ) {
        type_diffs = [
          {
            $: "Sorts",
            _0: {
              expected: AliasTy.to_ty(
                AliasTerm.expect_ty(
                  this.instantiate_binder_with_fresh_vars(
                    expr.span,
                    BoundRegionConversionTime.FnCall,
                    Binder.map_bound(where_pred_p, (pred) => pred.projection_term),
                    d_AliasTerm,
                  ),
                ),
                this.tcx,
                "No",
              ),
              found,
            },
          },
        ];
      }
    }
    let path: hir.Path, binding_node: hir.Node, local_node: hir.Node;
    if (
      expr.kind.$ === "Path" &&
      expr.kind._0.$ === "Resolved" &&
      expr.kind._0._0 === undefined &&
      ((path = expr.kind._0._1), true) &&
      path.res.$ === "Local" &&
      (binding_node = this.tcx.hir_node(path.res._0)).$ === "Pat" &&
      (local_node = this.tcx.parent_hir_node(binding_node._0.hir_id)).$ === "LetStmt" &&
      local_node._0.init !== undefined
    ) {
      const binding_expr = local_node._0.init;
      // If the expression we're calling on is a binding, we want to point at the
      // `let` when talking about the type. Otherwise we'll point at every part
      // of the method chain with the type.
      this.point_at_chain(binding_expr, typeck_results, type_diffs, param_env, err);
    } else {
      this.point_at_chain(expr, typeck_results, type_diffs, param_env, err);
    }
  }
  const call_node = tcx.hir_node(call_hir_id);
  if (call_node.$ === "Expr" && call_node._0.kind.$ === "MethodCall") {
    const path = call_node._0.kind._0;
    const rcvr = call_node._0.kind._1;
    if (rcvr.span === err.deref().span.primary_span()) {
      err.replace_span_with(path.ident.span, true);
    }
  }

  if (call_node.$ === "Expr") {
    const expr = call_node._0;
    let span: Span | undefined;
    if (expr.kind.$ === "Call") {
      span = expr.kind._0.span;
    } else if (expr.kind.$ === "MethodCall") {
      span = expr.kind._0.ident.span;
    }
    if (span !== undefined) {
      if (span !== err.deref().span.primary_span()) {
        let msg: string;
        if (Span.is_desugaring(span, { $: "FormatLiteral", source: true })) {
          msg = "required by this formatting parameter";
        } else if (Span.is_desugaring(span, { $: "FormatLiteral", source: false })) {
          msg = "required by a formatting parameter in this expression";
        } else {
          msg = "required by a bound introduced by this call";
        }
        err.span_label(span, msg);
      }
    }

    if (expr.kind.$ === "MethodCall") {
      const expr_ = expr.kind._1;
      this.suggest_option_method_if_applicable(failed_pred, param_env, err, expr_);
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5493 suggest_option_method_if_applicable
TypeErrCtxt.prototype.suggest_option_method_if_applicable = function (
  this: TypeErrCtxt,
  failed_pred: Predicate,
  param_env: ParamEnv,
  err: Diag,
  expr: hir.Expr,
): void {
  const tcx = this.tcx;
  const infcx = this.infcx;
  const typeck_results = this.typeck_results;
  if (typeck_results === undefined) return;

  // Make sure we're dealing with the `Option` type.
  const option_ty_adt = typeck_results.expr_ty_adjusted(expr).ty_adt_def();
  if (option_ty_adt === undefined) {
    return;
  }
  if (!tcx.is_diagnostic_item(sym.Option, option_ty_adt.did())) {
    return;
  }

  // Given the predicate `fn(&T): FnOnce<(U,)>`, extract `fn(&T)` and `(U,)`,
  // then suggest `Option::as_deref(_mut)` if `U` can deref to `T`
  const pk = Binder.skip_binder(failed_pred.kind());
  let trait_ref: TraitRef, self_ty: GenericArg, found_ty_arg: GenericArg, fn_ty: Ty | undefined, fn_sig: FnSig;
  let first_input: TyKind | undefined, target_ty: Ty, needs_mut: Mutability, tup: TyKind | undefined, found_ty: Ty;
  let deref_target_did: DefId | undefined, projection: Ty, deref_target: Ty, obligations: PredicateObligations;
  if (
    pk.$ === "Clause" &&
    pk._0.$ === "Trait" &&
    ((trait_ref = pk._0._0.trait_ref), true) &&
    tcx.is_fn_trait(trait_ref.def_id) &&
    trait_ref.args.length === 2 &&
    (([self_ty, found_ty_arg] = [trait_ref.args[0], trait_ref.args[1]]), true) &&
    (fn_ty = ((ty: Ty | undefined) => (ty !== undefined && ty.is_fn() ? ty : undefined))(GenericArg.as_type(self_ty))) !== undefined &&
    ((fn_sig = Binder.skip_binder(fn_ty.fn_sig(tcx))), true) &&
    // FIXME(splat): this might need to change if the Fn* traits start using/supporting splat
    FnSigC.abi(fn_sig).$ === "Rust" &&
    !FnSigC.c_variadic(fn_sig) &&
    FnSigC.safety(fn_sig) === "Safe" &&
    // Extract first param of fn sig with peeled refs, e.g. `fn(&T)` -> `T`
    (first_input = FnSigC.inputs(fn_sig)[0]?.kind()) !== undefined &&
    first_input.$ === "Ref" &&
    ((target_ty = first_input._1), (needs_mut = first_input._2), true) &&
    !TypeVisitableExt.has_escaping_bound_vars(target_ty, fold_Ty) &&
    // Extract first tuple element out of fn trait, e.g. `FnOnce<(U,)>` -> `U`
    (tup = GenericArg.as_type(found_ty_arg)?.kind()) !== undefined &&
    tup.$ === "Tuple" &&
    tup._0.length === 1 &&
    ((found_ty = tup._0[0]), true) &&
    !TypeVisitableExt.has_escaping_bound_vars(found_ty, fold_Ty) &&
    // Extract `<U as Deref>::Target` assoc type and check that it is `T`
    (deref_target_did = tcx.lang_items().deref_target()) !== undefined &&
    ((projection = Ty.new_projection_from_args(tcx, "No", deref_target_did, tcx.mk_args([found_ty]))), true) &&
    ((({ value: deref_target, obligations } = infcx.at(ObligationCause.dummy(), param_env).normalize(Unnormalized.new_wip(projection), fold_Ty))), true) &&
    obligations.every((obligation) => infcx.predicate_must_hold_modulo_regions(obligation)) &&
    infcx.can_eq(param_env, deref_target, target_ty, ToTrace_Ty)
  ) {
    let help: [string, string] | undefined;
    let deref_mut_did: DefId | undefined;
    if (
      needs_mut! === "Mut" &&
      (deref_mut_did = tcx.lang_items().deref_mut_trait()) !== undefined &&
      EvaluationResult.must_apply_modulo_regions(infcx.type_implements_trait(deref_mut_did, [found_ty!], param_env))
    ) {
      help = ["call `Option::as_deref_mut()` first", ".as_deref_mut()"];
    } else if (needs_mut! === "Not") {
      help = ["call `Option::as_deref()` first", ".as_deref()"];
    } else {
      help = undefined;
    }

    if (help !== undefined) {
      const [msg, sugg] = help;
      err.span_suggestion_with_style(Span.shrink_to_hi(expr.span), msg, sugg, "MaybeIncorrect", "ShowAlways");
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5568 look_for_iterator_item_mistakes
TypeErrCtxt.prototype.look_for_iterator_item_mistakes = function (
  this: TypeErrCtxt,
  assocs_in_this_method: readonly ([Span, [DefId, Ty]] | undefined)[],
  typeck_results: TypeckResults,
  type_diffs: readonly TypeError[],
  param_env: ParamEnv,
  path_segment: hir.PathSegment,
  args: readonly hir.Expr[],
  prev_ty: Ty,
  err: Diag,
): void {
  const tcx = this.tcx;
  // Special case for iterator chains, we look at potential failures of `Iterator::Item`
  // not being `: Clone` and `Iterator::map` calls with spurious trailing `;`.
  for (const entry of assocs_in_this_method) {
    if (entry === undefined) {
      continue;
    }
    const [_span, [def_id, ty]] = entry;
    for (const diff of type_diffs) {
      if (diff.$ !== "Sorts") {
        continue;
      }
      const expected_found = diff._0;
      if (
        tcx.is_diagnostic_item(sym.IntoIteratorItem, def_id) &&
        path_segment.ident.name === sym.iter &&
        this.can_eq(param_env, Ty.new_ref(tcx, tcx.lifetimes.re_erased, expected_found.found, "Not"), ty, ToTrace_Ty) &&
        args.length === 0
      ) {
        // Used `.iter()` when `.into_iter()` was likely meant.
        err.span_suggestion_verbose(
          path_segment.ident.span,
          `consider consuming the \`${display_Ty(prev_ty)}\` to construct the \`Iterator\``,
          "into_iter",
          "MachineApplicable",
        );
      }
      if (
        tcx.is_diagnostic_item(sym.IntoIteratorItem, def_id) &&
        path_segment.ident.name === sym.into_iter &&
        this.can_eq(param_env, expected_found.found, Ty.new_ref(tcx, tcx.lifetimes.re_erased, ty, "Not"), ToTrace_Ty) &&
        args.length === 0
      ) {
        // Used `.into_iter()` when `.iter()` was likely meant.
        err.span_suggestion_verbose(
          path_segment.ident.span,
          `consider not consuming the \`${display_Ty(prev_ty)}\` to construct the \`Iterator\``,
          "iter",
          "MachineApplicable",
        );
      }
      let arg: hir.Expr;
      if (
        tcx.is_diagnostic_item(sym.IteratorItem, def_id) &&
        path_segment.ident.name === sym.map &&
        this.can_eq(param_env, expected_found.found, ty, ToTrace_Ty) &&
        args.length === 1 &&
        ((arg = args[0]), true) &&
        arg.kind.$ === "Closure"
      ) {
        const closure = arg.kind._0;
        const body = tcx.hir_body(closure.body);
        let block: hir.Block, stmt: hir.Stmt, expr: hir.Expr;
        if (
          body.value.kind.$ === "Block" &&
          body.value.kind._1 === undefined &&
          ((block = body.value.kind._0), true) &&
          block.expr === undefined &&
          block.stmts.length >= 1 &&
          ((stmt = block.stmts[block.stmts.length - 1]), true) &&
          stmt.kind.$ === "Semi" &&
          ((expr = stmt.kind._0), true) &&
          // FIXME: actually check the expected vs found types, but right now
          // the expected is a projection that we need to resolve.
          // && let Some(tail_ty) = typeck_results.expr_ty_opt(expr)
          expected_found.found.is_unit() &&
          // FIXME: this happens with macro calls. Need to figure out why the stmt
          // `println!();` doesn't include the `;` in its `Span`. (#133845)
          // We filter these out to avoid ICEs with debug assertions on caused by
          // empty suggestions.
          Span.hi(expr.span) !== Span.hi(stmt.span)
        ) {
          err.span_suggestion_verbose(
            Span.with_hi(Span.shrink_to_hi(expr!.span), Span.hi(stmt!.span)),
            "consider removing this semicolon",
            "",
            "MachineApplicable",
          );
        }
        let expr_: hir.Expr;
        if (body.value.kind.$ === "Block" && body.value.kind._1 === undefined && body.value.kind._0.expr !== undefined) {
          expr_ = body.value.kind._0.expr;
        } else {
          expr_ = body.value;
        }
        const expr2 = expr_;
        let path_segment_: hir.PathSegment, rcvr: hir.Expr, span: Span, expr_ty: Ty | undefined, rcvr_ty: Ty | undefined, ref_kind: TyKind;
        if (
          expr2.kind.$ === "MethodCall" &&
          expr2.kind._2.length === 0 &&
          (([path_segment_, rcvr, span] = [expr2.kind._0, expr2.kind._1, expr2.kind._3]), true) &&
          path_segment_.ident.name === sym.clone &&
          (expr_ty = typeck_results.expr_ty_opt(expr2)) !== undefined &&
          (rcvr_ty = typeck_results.expr_ty_opt(rcvr)) !== undefined &&
          this.can_eq(param_env, expr_ty, rcvr_ty, ToTrace_Ty) &&
          (ref_kind = expr_ty.kind()).$ === "Ref"
        ) {
          const ty = ref_kind._1;
          err.span_label(
            span!,
            `this method call is cloning the reference \`${display_Ty(expr_ty)}\`, not \`${display_Ty(ty)}\` which doesn't implement \`Clone\``,
          );
          if (ty.kind().$ !== "Param") {
            continue;
          }
          const node = tcx.hir_node_by_def_id(tcx.hir_get_parent_item(expr2.hir_id).def_id);

          const pred: PolyTraitClauseT = Binder.dummy(
            {
              trait_ref: TraitRef.new(as_interner(tcx), tcx.require_lang_item("Clone", span!), [ty]),
              polarity: "Positive",
            },
            d_TraitClause_c,
          );
          const generics = hir.Node.generics(node);
          if (generics === undefined) {
            continue;
          }
          const body_id = hir.Node.body_id(node);
          if (body_id === undefined) {
            continue;
          }
          suggest_restriction(
            tcx,
            tcx.hir_body_owner_def_id(body_id),
            generics,
            `type parameter \`${display_Ty(ty)}\``,
            err,
            hir.Node.fn_sig(node),
            undefined,
            pred,
            undefined,
          );
        }
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5717 point_at_chain
TypeErrCtxt.prototype.point_at_chain = function (
  this: TypeErrCtxt,
  expr_: hir.Expr,
  typeck_results: TypeckResults,
  type_diffs: TypeError[],
  param_env: ParamEnv,
  err: Diag,
): void {
  const primary_spans: Span[] = [];
  const span_labels: [Span, string][] = [];

  const tcx = this.tcx;

  let print_root_expr = true;
  const assocs: ([Span, [DefId, Ty]] | undefined)[][] = [];
  let expr = expr_;
  let prev_ty = this.deeply_resolve_ignoring_regions(typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(tcx), fold_Ty);
  while (expr.kind.$ === "MethodCall") {
    const [path_segment, rcvr_expr, args, span] = [expr.kind._0, expr.kind._1, expr.kind._2, expr.kind._3];
    // Point at every method call in the chain with the resulting type.
    // vec![1, 2, 3].iter().map(mapper).sum<i32>()
    //               ^^^^^^ ^^^^^^^^^^^
    expr = rcvr_expr;
    const assocs_in_this_method = this.probe_assoc_types_at_expr(type_diffs, span, prev_ty, expr.hir_id, param_env);
    prev_ty = this.deeply_resolve_ignoring_regions(typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(tcx), fold_Ty);
    this.look_for_iterator_item_mistakes(assocs_in_this_method, typeck_results, type_diffs, param_env, path_segment, args, prev_ty, err);
    assocs.push(assocs_in_this_method);

    let path: hir.Path, binding_node: hir.Node;
    if (
      expr.kind.$ === "Path" &&
      expr.kind._0.$ === "Resolved" &&
      expr.kind._0._0 === undefined &&
      ((path = expr.kind._0._1), true) &&
      path.res.$ === "Local" &&
      (binding_node = this.tcx.hir_node(path.res._0)).$ === "Pat"
    ) {
      const parent = this.tcx.parent_hir_node(binding_node._0.hir_id);
      // We've reached the root of the method call chain...
      if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
        // ...and it is a binding. Get the binding creation and continue the chain.
        expr = parent._0.init;
      }
      if (parent.$ === "Param") {
        const param = parent._0;
        // ...and it is an fn argument.
        const prev_ty = this.deeply_resolve_ignoring_regions(typeck_results.node_type_opt(param.hir_id) ?? Ty.new_misc_error(tcx), fold_Ty);
        const assocs_in_this_method = this.probe_assoc_types_at_expr(type_diffs, param.ty_span, prev_ty, param.hir_id, param_env);
        if (assocs_in_this_method.some((a) => a !== undefined)) {
          assocs.push(assocs_in_this_method);
          print_root_expr = false;
        }
        break;
      }
    }
  }
  // We want the type before deref coercions, otherwise we talk about `&[_]`
  // instead of `Vec<_>`.
  const root_ty = typeck_results.expr_ty_opt(expr);
  if (root_ty !== undefined && print_root_expr) {
    const ty = with_forced_trimmed_paths(() => this.ty_to_string(root_ty));
    // Point at the root expression
    // vec![1, 2, 3].iter().map(mapper).sum<i32>()
    // ^^^^^^^^^^^^^
    span_labels.push([expr.span, `this expression has type \`${ty}\``]);
  }
  // Only show this if it is not a "trivial" expression (not a method
  // chain) and there are associated types to talk about.
  for (let ai = 0; ai < assocs.length; ai++) {
    const assocs_in_method = assocs[ai];
    if (ai + 1 >= assocs.length) {
      for (const entry of assocs_in_method) {
        if (entry === undefined) {
          continue;
        }
        const [span, [assoc, ty]] = entry;
        if (
          primary_spans.length === 0 ||
          type_diffs.some((diff) => {
            if (diff.$ !== "Sorts") {
              return false;
            }
            const expected_found = diff._0;
            return this.can_eq(param_env, expected_found.found, ty, ToTrace_Ty);
          })
        ) {
          // FIXME: this doesn't quite work for `Iterator::collect`
          // because we have `Vec<i32>` and `()`, but we'd want `i32`
          // to point at the `.into_iter()` call, but as long as we
          // still point at the other method calls that might have
          // introduced the issue, this is fine for now.
          primary_spans.push(span);
        }
        span_labels.push([span, with_forced_trimmed_paths(() => `\`${this.tcx.def_path_str(assoc)}\` is \`${display_Ty(ty)}\` here`)]);
      }
      break;
    }
    const prev_assoc_in_method = assocs[ai + 1];
    for (let i = 0; i < Math.min(assocs_in_method.length, prev_assoc_in_method.length); i++) {
      const entry = assocs_in_method[i];
      const prev_entry = prev_assoc_in_method[i];
      if (entry !== undefined && prev_entry !== undefined) {
        const [span, [assoc, ty]] = entry;
        const prev_ty = prev_entry[1][1];
        const ty_str = with_forced_trimmed_paths(() => this.ty_to_string(ty));

        const assoc_ = with_forced_trimmed_paths(() => this.tcx.def_path_str(assoc));
        if (!this.can_eq(param_env, ty, prev_ty, ToTrace_Ty)) {
          if (
            type_diffs.some((diff) => {
              if (diff.$ !== "Sorts") {
                return false;
              }
              const expected_found = diff._0;
              return this.can_eq(param_env, expected_found.found, ty, ToTrace_Ty);
            })
          ) {
            primary_spans.push(span);
          }
          span_labels.push([span, `\`${assoc_}\` changed to \`${ty_str}\` here`]);
        } else {
          span_labels.push([span, `\`${assoc_}\` remains \`${ty_str}\` here`]);
        }
      } else if (entry !== undefined && prev_entry === undefined) {
        const [span, [assoc, ty]] = entry;
        span_labels.push([
          span,
          with_forced_trimmed_paths(() => `\`${this.tcx.def_path_str(assoc)}\` is \`${this.ty_to_string(ty)}\` here`),
        ]);
      } else {
        // (None, Some(_)) | (None, None) => {}
      }
    }
  }
  if (primary_spans.length !== 0) {
    const multi_span: MultiSpan = MultiSpan.from_Vec(primary_spans);
    for (const [span, label] of span_labels) {
      multi_span.push_span_label(span, label);
    }
    err.span_note(multi_span, "the method call chain might not have had the expected associated types");
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5886 probe_assoc_types_at_expr
TypeErrCtxt.prototype.probe_assoc_types_at_expr = function (
  this: TypeErrCtxt,
  type_diffs: readonly TypeError[],
  span: Span,
  prev_ty: Ty,
  body_id: HirId,
  param_env: ParamEnv,
): ([Span, [DefId, Ty]] | undefined)[] {
  const ocx = engine_mod().ObligationCtxt.new(this.infcx);
  const assocs_in_this_method: ([Span, [DefId, Ty]] | undefined)[] = [];
  for (const diff of type_diffs) {
    if (diff.$ !== "Sorts") {
      continue;
    }
    const expected_found = diff._0;
    const ek = expected_found.expected.kind();
    if (!(ek.$ === "Alias" && ek._1.kind.$ === "Projection")) {
      continue;
    }
    const kind = ek._1.kind;
    const def_id = kind.def_id;

    // Make `Self` be equivalent to the type of the call chain
    // expression we're looking at now, so that we can tell what
    // for example `Iterator::Item` is at this point in the chain.
    const args = RawList.for_item(this.tcx, def_id, (param, _) => {
      if (param.index === 0) {
        // debug_assert_matches!(param.kind, ty::GenericParamDefKind::Type { .. });
        return prev_ty;
      }
      return this.var_for_def(span, param);
    });
    // This will hold the resolved type of the associated type, if the
    // current expression implements the trait that associated type is
    // in. For example, this would be what `Iterator::Item` is here.
    const ty = this.infcx.next_ty_var(span);
    // This corresponds to `<ExprTy as Iterator>::Item = _`.
    const projection = Binder.dummy<PredicateKind>(
      {
        $: "Clause",
        _0: {
          $: "Projection",
          _0: {
            projection_term: AliasTerm.new_from_args(this.tcx, AliasTermKind.from_AliasTyKind(kind), args),
            term: ty,
          },
        },
      },
      d_PredicateKind,
    );
    const body_def_id = this.tcx.hir_enclosing_body_owner(body_id);
    // Add `<ExprTy as Iterator>::Item = _` obligation.
    ocx.register_obligation(Obligation.misc(this.tcx, span, body_def_id, param_env, projection, upcast_Binder_PredicateKind));
    let ty_: Ty;
    if (
      TraitErrors.no_errors(ocx.try_evaluate_obligations()) &&
      ((ty_ = this.deeply_resolve_ignoring_regions(ty, fold_Ty)), true) &&
      !ty_.is_ty_var()
    ) {
      assocs_in_this_method.push([span, [def_id, ty_]]);
    } else {
      // `<ExprTy as Iterator>` didn't select, so likely we've
      // reached the end of the iterator chain, like the originating
      // `Vec<_>` or the `ty` couldn't be determined.
      // Keep the space consistent for later zipping.
      assocs_in_this_method.push(undefined);
    }
  }
  return assocs_in_this_method;
};

/// When a `-> impl Trait<Assoc = Ty>` return type obligation fails, walk the method call
/// chain in the returned expression to point at where the associated type diverged from
/// what the signature expects.
///
/// ```text
/// note: the method call chain might not have had the expected associated types
///   --> $DIR/invalid-iterator-chain-in-return-position.rs:16:18
///    |
/// LL |     x.iter_mut().map(foo)
///    |     - ---------- ^^^^^^^^ `Iterator::Item` changed to `()` here
///    |     | |
///    |     | `Iterator::Item` is `&mut Vec<u8>` here
///    |     this expression has type `Vec<Vec<u8>>`
/// ```
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5966 point_at_chain_in_return_position
TypeErrCtxt.prototype.point_at_chain_in_return_position = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  expr_: hir.Expr,
  typeck_results: TypeckResults,
  param_env: ParamEnv,
  err: Diag,
): void {
  const tcx = this.tcx;
  const dk = tcx.def_kind(body_def_id) as DefKind;
  if (!(dk.$ === "Fn" || dk.$ === "AssocFn")) {
    return;
  }

  const binder = PolyFnSigC.output(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(body_def_id) as EarlyBinder<PolyFnSigT>)));
  this.enter_forall(
    binder,
    (output) => {
      const ok = output.kind();
      if (!(ok.$ === "Alias" && ok._1.kind.$ === "Opaque")) {
        return;
      }
      const opaque_def_id = ok._1.kind.def_id;
      const args = ok._1.args;

      // The predicate that reaches here has been rewritten through the impls it was
      // derived from (e.g. `Iterator for Map<I, F>` turns `Iterator::Item` requirements
      // into requirements on `F`'s return type), so the associated types the user wrote
      // in the signature are recovered from the opaque's bounds instead.
      const probe_diffs: TypeError[] = [];
      for (const clause of Unnormalized.skip_norm_wip(
        EarlyBinder.instantiate(tcx.item_bounds(opaque_def_id) as EarlyBinder<Clauses>, tcx, args, fold_Clauses),
      )) {
        const proj_ = clause.as_projection_clause();
        if (proj_ === undefined) continue;
        const proj = this.instantiate_binder_with_fresh_vars(expr_.span, BoundRegionConversionTime.FnCall, proj_, d_ProjectionClause);
        const expected_term = Term.as_type(proj.term);
        if (expected_term === undefined) continue;
        // Only the projection (for its `DefId`) is used when probing the chain; the
        // bound's own term is carried in `found` for the divergence check below and
        // is replaced with the probed type afterwards.
        probe_diffs.push({
          $: "Sorts",
          _0: {
            expected: AliasTy.to_ty(AliasTerm.expect_ty(proj.projection_term), tcx, "No"),
            found: expected_term,
          },
        });
      }
      if (probe_diffs.length === 0) {
        return;
      }

      // If the returned expression is a binding, walk the chain that created it instead.
      let path: hir.Path, binding_node: hir.Node, local_node: hir.Node;
      let expr: hir.Expr;
      if (
        expr_.kind.$ === "Path" &&
        expr_.kind._0.$ === "Resolved" &&
        expr_.kind._0._0 === undefined &&
        ((path = expr_.kind._0._1), true) &&
        path.res.$ === "Local" &&
        (binding_node = tcx.hir_node(path.res._0)).$ === "Pat" &&
        (local_node = tcx.parent_hir_node(binding_node._0.hir_id)).$ === "LetStmt" &&
        local_node._0.init !== undefined
      ) {
        expr = local_node._0.init;
      } else {
        expr = expr_;
      }

      // Resolve what each bound associated type actually is for the returned expression,
      // and keep only the ones that diverged from the signature.
      const expr_ty = this.deeply_resolve_ignoring_regions(typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(tcx), fold_Ty);
      const assocs = this.probe_assoc_types_at_expr(probe_diffs, expr.span, expr_ty, expr.hir_id, param_env);
      const type_diffs: TypeError[] = [];
      for (let i = 0; i < Math.min(probe_diffs.length, assocs.length); i++) {
        const probe_diff = probe_diffs[i];
        const assoc = assocs[i];
        if (probe_diff.$ !== "Sorts") {
          continue;
        }
        const { expected, found: expected_term } = probe_diff._0;
        if (assoc === undefined) continue;
        const actual_ty = assoc[1][1];
        if (!this.can_eq(param_env, expected_term, actual_ty, ToTrace_Ty)) {
          type_diffs.push({ $: "Sorts", _0: { expected, found: actual_ty } });
        }
      }
      if (type_diffs.length !== 0) {
        this.point_at_chain(expr, typeck_results, type_diffs, param_env, err);
      }
    },
    fold_Ty,
  );
};

/// If the type that failed selection is an array or a reference to an array,
/// but the trait is implemented for slices, suggest that the user converts
/// the array into a slice.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6060 suggest_convert_to_slice
TypeErrCtxt.prototype.suggest_convert_to_slice = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
  candidate_impls: readonly ImplCandidate[],
  span: Span,
): void {
  if (Span.in_external_macro(span, this.tcx.sess.source_map())) {
    return;
  }
  // We can only suggest the slice coercion for function and binary operation arguments,
  // since the suggestion would make no sense in turbofish or call
  const code = obligation.cause.code_();
  if (!(code.$ === "BinOp" || code.$ === "FunctionArg")) {
    return;
  }

  // Three cases where we can make a suggestion:
  // 1. `[T; _]` (array of T)
  // 2. `&[T; _]` (reference to array of T)
  // 3. `&mut [T; _]` (mutable reference to array of T)
  let element_ty: Ty, mutability: Mutability | undefined;
  const sk = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
  if (sk.$ === "Array") {
    [element_ty, mutability] = [sk._0, undefined];
  } else if (sk.$ === "Ref") {
    const pk = sk._1.kind();
    if (pk.$ === "Array") {
      [element_ty, mutability] = [pk._0, sk._2];
    } else {
      return;
    }
  } else {
    return;
  }

  // Go through all the candidate impls to see if any of them is for
  // slices of `element_ty` with `mutability`.
  const is_slice = (candidate: Ty): boolean => {
    const ck = candidate.kind();
    if (ck.$ === "RawPtr" || ck.$ === "Ref") {
      const [t, m] = ck.$ === "RawPtr" ? [ck._0, ck._1] : [ck._1, ck._2];
      const tk = t.kind();
      if (tk.$ === "Slice" && tk._0 === element_ty && m === (mutability ?? m)) {
        // Use the candidate's mutability going forward.
        mutability = m;
        return true;
      } else {
        return false;
      }
    }
    return false;
  };

  // Grab the first candidate that matches, if any, and make a suggestion.
  let slice_ty: Ty | undefined;
  for (const trait_ref of candidate_impls) {
    const t = TraitRef.self_ty(trait_ref.trait_ref);
    if (is_slice(t)) {
      slice_ty = t;
      break;
    }
  }
  if (slice_ty !== undefined) {
    const msg = `convert the array to a \`${display_Ty(slice_ty)}\` slice instead`;

    const r = this.tcx.sess.source_map().span_to_snippet(span);
    if (r.$ === "Ok") {
      const snippet = r._0;
      const suggestions: [Span, string][] = [];
      if (snippet.starts_with("&")) {
        // (nothing)
      } else if (mutability === "Mut") {
        suggestions.push([Span.shrink_to_lo(span), "&mut "]);
      } else {
        suggestions.push([Span.shrink_to_lo(span), "&"]);
      }
      suggestions.push([Span.shrink_to_hi(span), "[..]"]);
      err.multipart_suggestion(msg, suggestions, "MaybeIncorrect");
    } else {
      err.span_help(span, msg);
    }
  }
};

/// If the type failed selection but the trait is implemented for `(T,)`, suggest that the user
/// creates a unary tuple
///
/// This is a common gotcha when using libraries that emulate variadic functions with traits for tuples.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6140 suggest_tuple_wrapping
TypeErrCtxt.prototype.suggest_tuple_wrapping = function (
  this: TypeErrCtxt,
  err: Diag,
  root_obligation: PredicateObligation,
  obligation: PredicateObligation,
): void {
  const code = obligation.cause.code_();
  if (code.$ !== "FunctionArg") {
    return;
  }
  const arg_hir_id = code.arg_hir_id;

  const root_pred = root_obligation.predicate.as_trait_clause();
  if (root_pred === undefined) return;

  const trait_ref = Binder.map_bound(root_pred, (root_pred) =>
    TraitRef.with_replaced_self_ty(root_pred.trait_ref, as_interner(this.tcx), Ty.new_tup(this.tcx, [TraitRef.self_ty(root_pred.trait_ref)])),
  );

  const obligation_ = Obligation.new(this.tcx, clone_ObligationCause(obligation.cause), obligation.param_env, trait_ref, upcast_PolyTraitRef);

  if (this.predicate_must_hold_modulo_regions(obligation_)) {
    const arg_span = this.tcx.hir_span(arg_hir_id);
    err.multipart_suggestion(
      "use a unary tuple instead",
      [
        [Span.shrink_to_lo(arg_span), "("],
        [Span.shrink_to_hi(arg_span), ",)"],
      ],
      "MaybeIncorrect",
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6172 suggest_shadowed_inherent_method
TypeErrCtxt.prototype.suggest_shadowed_inherent_method = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClauseT,
): void {
  const code = obligation.cause.code_();
  if (code.$ !== "FunctionArg") {
    return;
  }
  const call_hir_id = code.call_hir_id;
  const call_node = this.tcx.hir_node(call_hir_id);
  if (call_node.$ !== "Expr") return;
  const call = call_node._0;
  if (call.kind.$ !== "MethodCall") return;
  const [segment, rcvr, args] = [call.kind._0, call.kind._1, call.kind._2];
  const typeck = this.typeck_results;
  if (typeck === undefined) return;
  const rcvr_ty_ = typeck.expr_ty_adjusted_opt(rcvr);
  if (rcvr_ty_ === undefined) return;
  const rcvr_ty = this.deeply_resolve_ignoring_regions(rcvr_ty_, fold_Ty);
  const autoderef = this.autoderef_steps(rcvr_ty);
  // PORT: the lazy `autoderef.iter().filter_map(..)` is a generator, so the filter runs interleaved with the body.
  const steps = function* (this: TypeErrCtxt): Generator<[Ty, DefId]> {
    for (const [ty, obligations] of autoderef) {
      const tk = ty.kind();
      if (tk.$ === "Adt" && ty !== rcvr_ty.peel_refs() && obligations.every((obligation) => this.predicate_may_hold(obligation))) {
        yield [ty, tk._0.did()];
      }
    }
  }.call(this);
  for (const [ty, def_id] of steps) {
    for (const impl_def_id of this.tcx.inherent_impls(def_id) as readonly DefId[]) {
      if (DefId_eq(impl_def_id, PolyTraitClauseC.def_id(trait_predicate))) {
        continue;
      }
      for (const m of this.tcx.provided_trait_methods(impl_def_id)) {
        if (AssocItem.name(m) !== segment.ident.name) continue;
        const fn_sig = this.tcx.fn_sig(m.def_id) as EarlyBinder<PolyFnSigT>;
        if (Binder.skip_binder(PolyFnSigC.inputs(EarlyBinder.skip_binder(fn_sig))).length !== args.length + 1) {
          continue;
        }
        const rcvr_ty = Binder.skip_binder(PolyFnSigC.input(EarlyBinder.skip_binder(fn_sig), 0));
        const rk = rcvr_ty.kind();
        let mutability: string, _ty: Ty;
        if (rk.$ === "Ref" && rk._2 === "Mut") {
          [mutability, _ty] = ["&mut ", rk._1];
        } else if (rk.$ === "Ref") {
          [mutability, _ty] = ["&", rk._1];
        } else {
          [mutability, _ty] = ["", rcvr_ty];
        }
        const path = this.tcx.def_path_str(def_id);
        err.note(
          `there's an inherent method on \`${display_Ty(ty)}\` of the same name, which can be auto-dereferenced from \`${display_Ty(rcvr_ty)}\``,
        );
        err.multipart_suggestion(
          `to access the inherent method on \`${display_Ty(ty)}\`, use the fully-qualified path`,
          [
            [Span.until(call.span, rcvr.span), `${path}::${display_Symbol(AssocItem.name(m))}(${mutability}`],
            args.length === 0
              ? [Span.with_hi(Span.shrink_to_hi(rcvr.span), Span.hi(call.span)), ")"]
              : [Span.between(rcvr.span, args[0].span), ", "],
          ],
          "MaybeIncorrect",
        );
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6245 explain_hrtb_projection
TypeErrCtxt.prototype.explain_hrtb_projection = function (
  this: TypeErrCtxt,
  diag: Diag,
  pred: PolyTraitClauseT,
  param_env: ParamEnv,
  cause: ObligationCause,
): void {
  if (
    TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(pred), d_TraitClause_c) &&
    TypeVisitableExt.has_non_region_infer(Binder.skip_binder(pred), d_TraitClause_c)
  ) {
    this.probe((_) => {
      const ocx = engine_mod().ObligationCtxt.new(this.infcx);
      ocx.register_obligation(Obligation.new(this.tcx, ObligationCause.dummy(), param_env, pred, upcast_PolyTraitClause));
      if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
        // encountered errors.
        return;
      }

      const code = cause.code_();
      if (code.$ === "FunctionArg") {
        const { call_hir_id, arg_hir_id } = code;
        const arg_span = this.tcx.hir_span(arg_hir_id);
        const sp: MultiSpan = MultiSpan.from_Span(arg_span);

        sp.push_span_label(arg_span, "the trait solver is unable to infer the generic types that should be inferred from this argument");
        sp.push_span_label(this.tcx.hir_span(call_hir_id), "add turbofish arguments to this call to specify the types manually, even if it's redundant");
        diag.span_note(sp, "this is a known limitation of the trait solver that will be lifted in the future");
      } else {
        const sp: MultiSpan = MultiSpan.from_Span(cause.span);
        sp.push_span_label(cause.span, "try adding turbofish arguments to this expression to specify the types manually, even if it's redundant");
        diag.span_note(sp, "this is a known limitation of the trait solver that will be lifted in the future");
      }
    });
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6308 suggest_desugaring_async_fn_in_trait
TypeErrCtxt.prototype.suggest_desugaring_async_fn_in_trait = function (this: TypeErrCtxt, err: Diag, trait_pred: PolyTraitClauseT): void {
  // Don't suggest if RTN is active -- we should prefer a where-clause bound instead.
  if (this.tcx.features().return_type_notation()) {
    return;
  }

  const trait_def_id = PolyTraitClauseC.def_id(trait_pred);

  // Only suggest specifying auto traits
  if (!this.tcx.trait_is_auto(trait_def_id)) {
    return;
  }

  // Look for an RPITIT
  const sk = Binder.skip_binder(PolyTraitClauseC.self_ty(trait_pred)).kind();
  if (!(sk.$ === "Alias" && sk._1.kind.$ === "Projection")) {
    return;
  }
  const alias_ty = sk._1;
  const def_id = sk._1.kind.def_id;
  const rpitit = this.tcx.opt_rpitit_info(def_id);
  if (rpitit === undefined || rpitit.$ !== "Trait") {
    return;
  }
  const { fn_def_id: fn_def_id_, opaque_def_id } = rpitit;

  const auto_trait = this.tcx.def_path_str(trait_def_id);
  // ... which is a local function
  const fn_def_id = fn_def_id_.as_local();
  if (fn_def_id === undefined) {
    // If it's not local, we can at least mention that the method is async, if it is.
    if (Asyncness.is_async(this.tcx.asyncness(fn_def_id_) as Asyncness)) {
      err.span_note(
        this.tcx.def_span(fn_def_id_),
        `\`${display_TraitRef(AliasTy.trait_ref(alias_ty, as_interner(this.tcx)))}::${display_Symbol(this.tcx.item_name(fn_def_id_))}\` is an \`async fn\` in trait, which does not automatically imply that its future is \`${auto_trait}\``,
      );
    }
    return;
  }
  const item_node = this.tcx.hir_node_by_def_id(fn_def_id);
  if (item_node.$ !== "TraitItem") {
    return;
  }
  const item = item_node._0;

  // ... whose signature is `async` (i.e. this is an AFIT)
  const [sig, body] = item.expect_fn();
  const output = sig.decl.output;
  if (!(output.$ === "Return" && output._0.kind.$ === "OpaqueDef")) {
    // This should never happen, but let's not ICE.
    return;
  }
  const opaq_def = output._0.kind._0;

  // Check that this is *not* a nested `impl Future` RPIT in an async fn
  // (i.e. `async fn foo() -> impl Future`)
  if (!DefId_eq(LocalDefIdC.to_def_id(opaq_def.def_id), opaque_def_id)) {
    return;
  }

  const sugg = suggest_desugaring_async_fn_to_impl_future_in_trait(this.tcx, sig, body, opaque_def_id.expect_local(), ` + ${auto_trait}`);
  if (sugg === undefined) {
    return;
  }

  const function_name = this.tcx.def_path_str(fn_def_id);
  err.multipart_suggestion(
    `\`${auto_trait}\` can be made part of the associated future's guarantees for all implementations of \`${function_name}\``,
    sugg,
    "MachineApplicable",
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6394 ty_kind_suggestion
TypeErrCtxt.prototype.ty_kind_suggestion = function (this: TypeErrCtxt, param_env: ParamEnv, ty: Ty): string | undefined {
  const tcx = this.infcx.tcx;
  const implements_default = (ty: Ty): boolean => {
    const default_trait = tcx.get_diagnostic_item(sym.Default);
    if (default_trait === undefined) {
      return false;
    }
    return EvaluationResult.must_apply_modulo_regions(this.type_implements_trait(default_trait, [ty], param_env));
  };

  const k = ty.kind();
  const is_item = (def: AdtDef, name: Symbol): boolean => {
    const item = tcx.get_diagnostic_item(name);
    return item !== undefined && DefId_eq(def.did(), item);
  };
  let len: number | undefined;
  switch (k.$) {
    case "Never":
    case "Error":
      return undefined;
    case "Bool":
      return "false";
    case "Char":
      return "'x'";
    case "Int":
    case "Uint":
      return "42";
    case "Float":
      return "3.14159";
    case "Slice":
      return "[]";
    case "Adt": {
      const [def, args] = [k._0, k._1];
      if (is_item(def, sym.Vec)) {
        return "vec![]";
      }
      if (is_item(def, sym.String)) {
        return "String::new()";
      }
      if (def.is_box()) {
        const inner = this.ty_kind_suggestion(param_env, GenericArg.expect_ty(args[0]));
        if (inner === undefined) return undefined;
        return `Box::new(${inner})`;
      }
      if (is_item(def, sym.Option)) {
        return "None";
      }
      if (is_item(def, sym.Result)) {
        const inner = this.ty_kind_suggestion(param_env, GenericArg.expect_ty(args[0]));
        if (inner === undefined) return undefined;
        return `Ok(${inner})`;
      }
      if (implements_default(ty)) {
        return "Default::default()";
      }
      return "/* value */";
    }
    case "Ref": {
      const [ty_, mutability] = [k._1, k._2];
      if (ty_.kind().$ === "Str" && mutability === "Not") {
        return '""';
      } else {
        const ty = this.ty_kind_suggestion(param_env, ty_);
        if (ty === undefined) return undefined;
        return `&${Mutability.prefix_str(mutability)}${ty}`;
      }
    }
    case "Array":
      if ((len = k._1.try_to_target_usize(tcx)) !== undefined) {
        const ty_ = k._0;
        if (len === 0) {
          return "[]";
        } else if (this.type_is_copy_modulo_regions(param_env, ty_) || len === 1) {
          // Can only suggest `[ty; 0]` if sz == 1 or copy
          const inner = this.ty_kind_suggestion(param_env, ty_);
          if (inner === undefined) return undefined;
          return `[${inner}; ${len}]`;
        } else {
          return "/* value */";
        }
      }
      return "/* value */";
    case "Tuple": {
      const tys = k._0;
      const parts: string[] = [];
      for (const ty of tys) {
        const s = this.ty_kind_suggestion(param_env, ty);
        if (s === undefined) return undefined;
        parts.push(s);
      }
      return `(${parts.join(", ")}${tys.length === 1 ? "," : ""})`;
    }
    default:
      return "/* value */";
  }
};

// For E0277 when use `?` operator, suggest adding
// a suitable return type in `FnSig`, and a default
// return value at the end of the function's body.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6463 suggest_add_result_as_return_type
TypeErrCtxt.prototype.suggest_add_result_as_return_type = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  err: Diag,
  trait_pred: PolyTraitClauseT,
): void {
  if (ObligationCauseCode.peel_derives(obligation.cause.code_()).$ !== "QuestionMark") {
    return;
  }

  // Only suggest for local function and associated method,
  // because this suggest adding both return type in
  // the `FnSig` and a default return value in the body, so it
  // is not suitable for foreign function without a local body,
  // and neither for trait method which may be also implemented
  // in other place, so shouldn't change it's FnSig.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6479 choose_suggest_items
  function choose_suggest_items(tcx: TyCtxt, node: hir.Node): [hir.FnDecl, hir.BodyId] | undefined {
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      const { sig, body: body_id } = node._0.kind;
      return [sig.decl, body_id];
    } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
      const item = node._0;
      const [sig, body_id] = [node._0.kind._0, node._0.kind._1];
      const parent = tcx.parent_hir_node(item.hir_id());
      if (parent.$ === "Item" && parent._0.kind.$ === "Impl" && parent._0.kind._0.of_trait === undefined) {
        return [sig.decl, body_id];
      }
      return undefined;
    } else {
      return undefined;
    }
  }

  const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
  const items = choose_suggest_items(this.tcx, node);
  let def_kind: TyKind;
  if (
    items !== undefined &&
    items[0].output.$ === "DefaultReturn" &&
    this.tcx.is_diagnostic_item(sym.FromResidual, PolyTraitClauseC.def_id(trait_pred)) &&
    Binder.skip_binder(trait_pred).trait_ref.args.type_at(0).is_unit() &&
    (def_kind = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind()).$ === "Adt" &&
    this.tcx.is_diagnostic_item(sym.Result, def_kind._0.did())
  ) {
    const [fn_decl, body_id] = items;
    const ret_span = (fn_decl.output as { $: "DefaultReturn"; _0: Span })._0;
    const sugg_spans: [Span, string][] = [[ret_span, " -> Result<(), Box<dyn std::error::Error>>"]];
    const body = this.tcx.hir_body(body_id);
    if (body.value.kind.$ === "Block" && body.value.kind._0.expr === undefined) {
      const b = body.value.kind._0;
      // The span of '}' in the end of block.
      const span = this.tcx.sess.source_map().end_point(b.span);
      sugg_spans.push([
        Span.shrink_to_lo(span),
        `${"    Ok(())\n"}${this.tcx.sess.source_map().indentation_before(span)?.toString() ?? ""}`,
      ]);
    }
    err.multipart_suggestion("consider adding return type", sugg_spans, "MaybeIncorrect");
  }
};

// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6539 suggest_unsized_bound_if_applicable
TypeErrCtxt.prototype.suggest_unsized_bound_if_applicable = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation): void {
  const pk = Binder.skip_binder(obligation.predicate.kind());
  if (!(pk.$ === "Clause" && pk._0.$ === "Trait")) {
    return;
  }
  const pred = pk._0._0;
  const code = ObligationCauseCode.peel_derives(obligation.cause.code_());
  let item_def_id: DefId, span: Span;
  if (code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") {
    [item_def_id, span] = [code._0, code._1];
  } else {
    return;
  }
  if (Span.is_dummy(span)) {
    return;
  }
  // debug!(?pred, ?item_def_id, ?span);

  const node = this.tcx.hir_get_if_local(item_def_id);
  if (!(node !== undefined && this.tcx.is_lang_item(TraitClause.def_id(pred), "Sized"))) {
    return;
  }

  const generics = hir.Node.generics(node);
  if (generics === undefined) {
    return;
  }
  const sized_trait = this.tcx.lang_items().sized_trait();
  // debug!(?generics.params);
  // debug!(?generics.predicates);
  const param = generics.params.find((param) => param.span === span);
  if (param === undefined) {
    return;
  }
  // Check that none of the explicit trait bounds is `Sized`. Assume that an explicit
  // `Sized` bound is there intentionally and we don't need to suggest relaxing it.
  let explicitly_sized = false;
  outer: for (const bp of generics.bounds_for_param(param.def_id)) {
    for (const bound of bp.bounds) {
      const tr = hir.GenericBound.trait_ref(bound);
      const tr_did = tr === undefined ? undefined : tr.trait_def_id();
      if (tr_did === sized_trait || (tr_did !== undefined && sized_trait !== undefined && DefId_eq(tr_did, sized_trait))) {
        explicitly_sized = true;
        break outer;
      }
    }
  }
  if (explicitly_sized) {
    return;
  }
  // debug!(?param);
  if (node.$ === "Item" && (node._0.kind.$ === "Enum" || node._0.kind.$ === "Struct" || node._0.kind.$ === "Union")) {
    // Only suggest indirection for uses of type parameters in ADTs.
    const item = node._0;
    if (this.suggest_indirection_for_unsized(err, item, param)) {
      return;
    }
  }

  // Didn't add an indirection suggestion, so add a general suggestion to relax `Sized`.
  let span_: Span, separator: string, open_paren_sp: Span | undefined;
  const bs = generics.bounds_span_for_suggestions(param.def_id);
  if (bs !== undefined) {
    const [s, open_paren_sp_] = bs;
    [span_, separator, open_paren_sp] = [s, " +", open_paren_sp_];
  } else {
    [span_, separator, open_paren_sp] = [Span.shrink_to_hi(hir.ParamName.ident(param.name).span), ":", undefined];
  }

  const suggs: [Span, string][] = [];
  const suggestion = `${separator} ?Sized`;

  if (open_paren_sp !== undefined) {
    suggs.push([open_paren_sp, "("]);
    suggs.push([span_, `)${suggestion}`]);
  } else {
    suggs.push([span_, suggestion]);
  }

  err.multipart_suggestion("consider relaxing the implicit `Sized` restriction", suggs, "MachineApplicable");
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6627 suggest_indirection_for_unsized
TypeErrCtxt.prototype.suggest_indirection_for_unsized = function (this: TypeErrCtxt, err: Diag, item: hir.Item, param: hir.GenericParam): boolean {
  // Suggesting `T: ?Sized` is only valid in an ADT if `T` is only used in a
  // borrow. `struct S<'a, T: ?Sized>(&'a T);` is valid, `struct S<T: ?Sized>(T);`
  // is not. Look for invalid "bare" parameter uses, and suggest using indirection.
  const visitor = new FindTypeParam(hir.ParamName.ident(param.name).name);
  visitor.visit_item(item);
  if (visitor.invalid_spans.length === 0) {
    return false;
  }
  const multispan: MultiSpan = MultiSpan.from_Span(param.span);
  multispan.push_span_label(param.span, `this could be changed to \`${display_Ident(hir.ParamName.ident(param.name))}: ?Sized\`...`);
  for (const sp of visitor.invalid_spans) {
    multispan.push_span_label(sp, `...if indirection were used here: \`Box<${display_Ident(hir.ParamName.ident(param.name))}>\``);
  }
  const T = display_Ident(hir.ParamName.ident(param.name));
  err.span_help(
    multispan,
    `you could relax the implicit \`Sized\` bound on \`${T}\` if it were used through indirection like \`&${T}\` or \`Box<${T}>\``,
  );
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6662 suggest_swapping_lhs_and_rhs
TypeErrCtxt.prototype.suggest_swapping_lhs_and_rhs = function <T>(
  this: TypeErrCtxt,
  err: Diag,
  predicate_: T,
  param_env: ParamEnv,
  cause_code: ObligationCauseCode,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
): void {
  const tcx = this.tcx;
  const predicate = upcast_from_T(predicate_, as_interner(tcx));
  let typeck_results: TypeckResults | undefined, lhs_node: hir.Node, rhs_node: hir.Node, lhs_ty: Ty | undefined, rhs_ty: Ty | undefined;
  if (
    cause_code.$ === "BinOp" &&
    (typeck_results = this.typeck_results) !== undefined &&
    (lhs_node = tcx.hir_node(cause_code.lhs_hir_id)).$ === "Expr" &&
    (rhs_node = tcx.hir_node(cause_code.rhs_hir_id)).$ === "Expr" &&
    (lhs_ty = typeck_results.expr_ty_opt(lhs_node._0)) !== undefined &&
    (rhs_ty = typeck_results.expr_ty_opt(rhs_node._0)) !== undefined
  ) {
    const { lhs_hir_id, rhs_span } = cause_code;
    const pred = predicate.as_trait_clause();
    if (
      pred !== undefined &&
      tcx.is_lang_item(PolyTraitClauseC.def_id(pred), "PartialEq") &&
      EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(PolyTraitClauseC.def_id(pred), [rhs_ty, lhs_ty], param_env))
    ) {
      const lhs_span = tcx.hir_span(lhs_hir_id);
      const sm = tcx.sess.source_map();
      const rhs_snippet = sm.span_to_snippet(rhs_span);
      let lhs_snippet: ReturnType<typeof sm.span_to_snippet>;
      if (rhs_snippet.$ === "Ok" && (lhs_snippet = sm.span_to_snippet(lhs_span)).$ === "Ok") {
        err.note(`\`${display_Ty(rhs_ty)}\` implements \`PartialEq<${display_Ty(lhs_ty)}>\``);
        err.multipart_suggestion(
          "consider swapping the equality",
          [
            [lhs_span, rhs_snippet._0.toString()],
            [rhs_span, lhs_snippet._0.toString()],
          ],
          "MaybeIncorrect",
        );
      }
    }
  }
};

/// Checks whether the field independently satisfies the trait bound, ignoring
/// the specific generic parameter that caused the original E0277 error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6708 is_truly_imperfect_derive
TypeErrCtxt.prototype.is_truly_imperfect_derive = function (
  this: TypeErrCtxt,
  parent_trait_pred: PolyTraitClauseT,
  predicate: Predicate,
  param_env: ParamEnv,
): boolean {
  const tcx = this.tcx;
  const sk = TraitClause.self_ty(Binder.skip_binder(parent_trait_pred)).kind();
  if (sk.$ !== "Adt") {
    return false;
  }
  const [adt_def, parent_args] = [sk._0, sk._1];
  const trait_clause = predicate.as_trait_clause();
  if (trait_clause === undefined) {
    return false;
  }
  const failing_ty = TraitClause.self_ty(Binder.skip_binder(trait_clause));
  const trait_def_id = PolyTraitClauseC.def_id(parent_trait_pred);

  const failing_adt_param_indices = new Set<number>();
  parent_args.forEach((arg, idx) => {
    const t = GenericArg.as_type(arg);
    if (t !== undefined && t === failing_ty) {
      failing_adt_param_indices.add(idx);
    }
  });

  if (failing_adt_param_indices.size === 0) {
    return false;
  }

  for (const field of adt_def.all_fields()) {
    const ok = ((): boolean => {
      const raw_field_ty = EarlyBinder.skip_binder(tcx.type_of(field.did) as EarlyBinder<Ty>);
      // If the field type is exactly one of the failing parameters, it is not an imperfect derive.
      const rk = raw_field_ty.kind();
      if (rk.$ === "Param" && failing_adt_param_indices.has(rk._0.index)) {
        return false;
      }
      // If the field type doesn't mention the parameter at all, it's independent.
      let mentions = false;
      for (const arg of raw_field_ty.walk()) {
        const t = GenericArg.as_type(arg);
        const tk = t === undefined ? undefined : t.kind();
        if (tk !== undefined && tk.$ === "Param" && failing_adt_param_indices.has(tk._0.index)) {
          mentions = true;
          break;
        }
      }
      if (!mentions) {
        return true;
      }

      return this.probe((_) => {
        // We keep the generic parameters that didn't fail as-is from the parent args,
        // but replace the ones that did fail with fresh inference variable placeholders.
        const fresh_args = RawList.for_item(tcx, adt_def.did(), (param, _) => {
          if (failing_adt_param_indices.has(param.index)) {
            return this.var_for_def(DUMMY_SP, param);
          } else {
            return parent_args[param.index];
          }
        });

        const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, fresh_args));
        // Substitute the field's type for the bound's `Self` type to check whether
        // the field alone would satisfy the trait, independent of other generics.
        const parent_trait_args = Binder.skip_binder(parent_trait_pred).trait_ref.args;
        const trait_args = parent_trait_args.map((arg): GenericArg => {
          if (GenericArg.as_type(arg) === TraitClause.self_ty(Binder.skip_binder(parent_trait_pred))) {
            return field_ty;
          } else {
            return arg;
          }
        });
        const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, TraitRef.new(as_interner(tcx), trait_def_id, trait_args), upcast_TraitRef);
        return this.predicate_may_hold(obligation);
      });
    })();
    if (!ok) {
      return false;
    }
  }
  return true;
};

/// Add a hint to add a missing borrow or remove an unnecessary one.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6792 hint_missing_borrow
export function hint_missing_borrow(
  infcx: InferCtxt,
  param_env: ParamEnv,
  span: Span,
  found: Ty,
  expected: Ty,
  found_node: hir.Node,
  err: Diag,
): void {
  if (found_node.$ === "TraitItem") {
    return;
  }

  const fk = found.kind();
  let found_args: readonly Ty[];
  if (fk.$ === "FnPtr") {
    found_args = infcx.enter_forall(fk._0, (sig_tys) => FnSigTys.inputs(sig_tys), d_FnSigTys);
  } else {
    return span_bug(span, `found was converted to a FnPtr above but is now ${format_debug(fk, debug_TyKind, PLAIN)}`);
  }
  const ek = expected.kind();
  let expected_args: readonly Ty[];
  if (ek.$ === "FnPtr") {
    expected_args = infcx.enter_forall(ek._0, (sig_tys) => FnSigTys.inputs(sig_tys), d_FnSigTys);
  } else {
    return span_bug(span, `expected was converted to a FnPtr above but is now ${format_debug(ek, debug_TyKind, PLAIN)}`);
  }

  // This could be a variant constructor, for example.
  const fn_decl = hir.Node.fn_decl(found_node);
  if (fn_decl === undefined) {
    return;
  }

  const args = fn_decl.inputs;

  const to_borrow: [Span, string][] = [];
  const remove_borrow: [Span, string][] = [];

  const n = Math.min(found_args.length, expected_args.length, args.length);
  for (let i = 0; i < n; i++) {
    const [found_arg, expected_arg, arg] = [found_args[i], expected_args[i], args[i]];
    const [found_ty, found_refs] = get_deref_type_and_refs(found_arg);
    const [expected_ty, expected_refs] = get_deref_type_and_refs(expected_arg);

    if (infcx.can_eq(param_env, found_ty, expected_ty, ToTrace_Ty)) {
      // FIXME: This could handle more exotic cases like mutability mismatches too!
      if (
        found_refs.length < expected_refs.length &&
        found_refs.every((m, j) => m === expected_refs[expected_refs.length - found_refs.length + j])
      ) {
        to_borrow.push([
          Span.shrink_to_lo(arg.span),
          expected_refs
            .slice(0, expected_refs.length - found_refs.length)
            .map((mutbl) => `&${Mutability.prefix_str(mutbl)}`)
            .join(""),
        ]);
      } else if (found_refs.length > expected_refs.length) {
        let span = Span.shrink_to_lo(arg.span);
        let left = found_refs.length - expected_refs.length;
        let ty = arg;
        while (ty.kind.$ === "Ref" && left > 0) {
          const inner_ty = ty.kind._1;
          span = Span.with_hi(span, Span.lo(inner_ty.span));
          ty = inner_ty;
          left -= 1;
        }
        if (left === 0) {
          remove_borrow.push([span, ""]);
        }
      }
    }
  }

  if (to_borrow.length !== 0) {
    err.subdiagnostic(diagnostics_mod().AdjustSignatureBorrow_subdiagnostic({ $: "Borrow", to_borrow }));
  }

  if (remove_borrow.length !== 0) {
    err.subdiagnostic(diagnostics_mod().AdjustSignatureBorrow_subdiagnostic({ $: "RemoveBorrow", remove_borrow }));
  }
}

/// Suggest a new type parameter name for diagnostic purposes.
///
/// `name` is the preferred name you'd like to suggest if it's not in use already.
// PORT: the trait's only impl is for `&[hir::GenericParam]`; `NextTypeParamName` is an interface over that slice and the
// impl's method is the free fn `next_type_param_name(self_, name)` (also on the companion `NextTypeParamName`).
export interface NextTypeParamName {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6966 next_type_param_name
  next_type_param_name(name: string | undefined): string;
}

// impl NextTypeParamName for &[hir::GenericParam<'_>]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6970 next_type_param_name
export function next_type_param_name(self_: readonly hir.GenericParam[], name_: string | undefined): string {
  // Type names are usually single letters in uppercase. So convert the first letter of input string to uppercase.
  const first = name_ === undefined ? undefined : name_.codePointAt(0);
  const name = first === undefined ? undefined : String.fromCodePoint(...to_uppercase(first));

  // This is the list of possible parameter names that we might suggest.
  const possible_names = [name ?? "T", "T", "U", "V", "X", "Y", "Z", "A", "B", "C"];

  // Filter out used names based on `filter_fn`.
  const used_names: Symbol[] = [];
  for (const param of self_) {
    if (param.name.$ === "Plain") {
      used_names.push(param.name._0.name);
    }
  }

  // Find a name from `possible_names` that is not in `used_names`.
  return possible_names.find((n) => !used_names.includes(Symbol.intern(n))) ?? "ParamName";
}
/** `impl NextTypeParamName for &[hir::GenericParam]` as a companion. */
export const NextTypeParamName = { next_type_param_name };


// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:6997 ReplaceImplTraitVisitor
/// Collect the spans that we see the generic param `param_did`
// PORT: `ty_spans: &'a mut Vec<Span>` is the caller's array (mutated in place).
export class ReplaceImplTraitVisitor extends hir.intravisit.Visitor {
  constructor(
    public ty_spans: Span[],
    public param_did: DefId,
  ) {
    super();
  }

  // impl<'a, 'hir> hir::intravisit::Visitor<'hir> for ReplaceImplTraitVisitor<'a>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7003 visit_ty
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    if (t.kind.$ === "Path" && t.kind._0.$ === "Resolved" && t.kind._0._0 === undefined && t.kind._0._1.res.$ === "Def") {
      const segment_did = t.kind._0._1.res._1;
      if (DefId_eq(this.param_did, segment_did)) {
        // `fn foo(t: impl Trait)`
        //            ^^^^^^^^^^ get this to suggest `T` instead

        // There might be more than one `impl Trait`.
        this.ty_spans.push(t.span);
        return undefined;
      }
    }

    hir.intravisit.walk_ty(this, t);
    return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7023 get_explanation_based_on_obligation
export function get_explanation_based_on_obligation(
  tcx: TyCtxt,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClauseT,
  pre_message: string,
  long_ty_path: MutRef<PathBuf | undefined>,
): string {
  if (obligation.cause.code_().$ === "MainFunctionType") {
    return "consider using `()`, or a `Result`";
  } else {
    let ty_desc: string | undefined;
    const sk = Binder.skip_binder(PolyTraitClauseC.self_ty(trait_predicate)).kind();
    if (sk.$ === "FnDef") {
      ty_desc = "fn item";
    } else if (sk.$ === "Closure") {
      ty_desc = "closure";
    } else {
      ty_desc = undefined;
    }

    const desc = ty_desc !== undefined ? ` ${ty_desc}` : "";
    if (PolyTraitClauseC.polarity(trait_predicate) === "Positive") {
      // If the trait in question is unstable, mention that fact in the diagnostic.
      // But if we're building with `-Zforce-unstable-if-unmarked` then _any_ trait
      // not explicitly marked stable is considered unstable, so the extra text is
      // unhelpful noise. See <https://github.com/rust-lang/rust/issues/152692>.
      const mention_unstable =
        !tcx.sess.opts.unstable_opts.force_unstable_if_unmarked &&
        ((): boolean | undefined => {
          const stab = tcx.lookup_stability(PolyTraitClauseC.def_id(trait_predicate)) as Stability | undefined;
          return stab === undefined ? undefined : StabilityLevel.is_stable(stab.level);
        })() === false;
      const unstable = mention_unstable ? "nightly-only, unstable " : "";

      return `${pre_message}the ${unstable}trait \`${display_Binder_TraitClausePrintModifiersAndPath(
        PolyTraitClause_print_modifiers_and_trait_path(trait_predicate),
      )}\` is not implemented for${desc} \`${tcx.short_string(Binder.skip_binder(PolyTraitClauseC.self_ty(trait_predicate)), long_ty_path, print_Ty)}\``;
    } else {
      // "the trait bound `T: !Send` is not satisfied" reads better than "`!Send` is
      // not implemented for `T`".
      // FIXME: add note explaining explicit negative trait bounds.
      return `${pre_message}the trait bound \`${display_PolyTraitClause(trait_predicate)}\` is not satisfied`;
    }
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7068 ReplaceImplTraitFolder
// Replace `param` with `replace_ty`
export class ReplaceImplTraitFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public param: GenericParamDef,
    public replace_ty: Ty,
  ) {}

  // impl<'tcx> TypeFolder<TyCtxt<'tcx>> for ReplaceImplTraitFolder<'tcx>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7075 fold_ty
  fold_ty(t: Ty): Ty {
    const k = t.kind();
    if (k.$ === "Param") {
      const index = k._0.index;
      if (this.param.index === index) {
        return this.replace_ty;
      }
    }
    return fold_Ty.super_fold_with(t, this);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7084 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // (provided)
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7089 suggest_desugaring_async_fn_to_impl_future_in_trait
export function suggest_desugaring_async_fn_to_impl_future_in_trait(
  tcx: TyCtxt,
  sig: hir.FnSig,
  body: hir.TraitFn,
  opaque_def_id: LocalDefId,
  add_bounds: string,
): [Span, string][] | undefined {
  const asyncness = sig.header.asyncness;
  if (asyncness.$ !== "Async") {
    return undefined;
  }
  const async_span = tcx.sess.source_map().span_extend_while_whitespace(asyncness._0);

  const future = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(opaque_def_id));
  if (!(future.bounds.length === 1 && future.bounds[0].$ === "Trait")) {
    // `async fn` should always lower to a single bound... but don't ICE.
    return undefined;
  }
  const trait_ref = future.bounds[0]._0;
  const last = trait_ref.trait_ref.path.segments[trait_ref.trait_ref.path.segments.length - 1];
  if (last === undefined || last.args === undefined) {
    // desugaring to a single path segment for `Future<...>`.
    return undefined;
  }
  const args = last.args;
  const first_constraint = args.constraints[0];
  const future_output_ty = first_constraint === undefined ? undefined : first_constraint.ty();
  if (future_output_ty === undefined) {
    // Also should never happen.
    return undefined;
  }

  let sugg: [Span, string][];
  if (Span.is_empty(future_output_ty.span)) {
    sugg = [
      [async_span, ""],
      [future_output_ty.span, ` -> impl std::future::Future<Output = ()>${add_bounds}`],
    ];
  } else {
    sugg = [
      [Span.shrink_to_lo(future_output_ty.span), "impl std::future::Future<Output = "],
      [Span.shrink_to_hi(future_output_ty.span), `>${add_bounds}`],
      [async_span, ""],
    ];
  }

  // If there's a body, we also need to wrap it in `async {}`
  if (body.$ === "Provided") {
    const body_ = tcx.hir_body(body._0);
    const body_span = body_.value.span;
    const body_span_without_braces = Span.with_hi(
      Span.with_lo(body_span, (Span.lo(body_span) + 1) as BytePos),
      (Span.hi(body_span) - 1) as BytePos,
    );
    if (Span.is_empty(body_span_without_braces)) {
      sugg.push([body_span_without_braces, " async {} "]);
    } else {
      sugg.push([Span.shrink_to_lo(body_span_without_braces), "async {"], [Span.shrink_to_hi(body_span_without_braces), "} "]);
    }
  }

  return sugg;
}

/// On `impl` evaluation cycles, look for `Self::AssocTy` restrictions in `where` clauses, explain
/// they are not allowed and if possible suggest alternatives.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7154 point_at_assoc_type_restriction
export function point_at_assoc_type_restriction(
  tcx: TyCtxt,
  err: Diag,
  self_ty_str: string,
  trait_name: string,
  predicate: Predicate,
  generics: hir.Generics,
  data: ImplDerivedCause,
): void {
  const pk = Binder.skip_binder(predicate.kind());
  if (pk.$ !== "Clause") {
    return;
  }
  const clause = pk._0;
  if (clause.$ !== "Projection") {
    return;
  }
  const proj = clause._0;
  const rpitit = tcx.opt_rpitit_info(ProjectionClause.def_id(proj));
  let name: Symbol | undefined;
  if (rpitit !== undefined) {
    if (rpitit.$ === "Trait") {
      name = tcx.item_name(rpitit.fn_def_id);
    } else {
      name = undefined;
    }
  }
  if (name === undefined) {
    name = tcx.opt_item_name(ProjectionClause.def_id(proj));
  }
  if (name === undefined) {
    return;
  }
  const name_ = name;
  const predicates = generics.predicates;
  let prev: [hir.WhereBoundPredicate, Span] | undefined;
  for (let pi = 0; pi < predicates.length; pi++) {
    const pred_ = predicates[pi];
    const curr_span = pred_.span;
    if (pred_.kind.$ !== "BoundPredicate") {
      continue;
    }
    const pred = pred_.kind._0;
    for (const bound of pred.bounds) {
      const trait_ref = hir.GenericBound.trait_ref(bound);
      if (trait_ref === undefined) {
        continue;
      }
      if (hir.GenericBound.span(bound) !== data.span) {
        continue;
      }
      let path: hir.QPath, ty: hir.Ty, segment: hir.PathSegment, inner_path_: hir.QPath, inner_path: hir.Path;
      if (
        pred.bounded_ty.kind.$ === "Path" &&
        ((path = pred.bounded_ty.kind._0), true) &&
        path.$ === "TypeRelative" &&
        (([ty, segment] = [path._0, path._1]), true) &&
        segment.ident.name === name_ &&
        ty.kind.$ === "Path" &&
        ((inner_path_ = ty.kind._0), true) &&
        inner_path_.$ === "Resolved" &&
        inner_path_._0 === undefined &&
        ((inner_path = inner_path_._1), true) &&
        inner_path.res.$ === "SelfTyAlias"
      ) {
        // The following block is to determine the right span to delete for this bound
        // that will leave valid code after the suggestion is applied.
        let span: Span;
        let next_pred: hir.WherePredicate | undefined;
        if (
          pred.origin === "WhereClause" &&
          generics.predicates.filter((p) => p.kind.$ === "BoundPredicate" && "WhereClause" === p.kind._0.origin).length === 1
        ) {
          // There's only one `where` bound, that needs to be removed. Remove the whole
          // `where` clause.
          span = generics.where_clause_span;
        } else if (
          (next_pred = predicates[pi + 1]) !== undefined &&
          next_pred.kind.$ === "BoundPredicate" &&
          pred.origin === next_pred.kind._0.origin
        ) {
          // There's another bound, include the comma for the current one.
          span = Span.until(curr_span, next_pred.span);
        } else if (prev !== undefined && pred.origin === prev[0].origin) {
          const prev_span = prev[1];
          // Last bound, try to remove the previous comma.
          span = Span.to(Span.shrink_to_hi(prev_span), curr_span);
        } else if (pred.origin === "WhereClause") {
          span = Span.with_hi(curr_span, Span.hi(generics.where_clause_span));
        } else {
          span = curr_span;
        }

        err.span_suggestion_verbose(
          span,
          "associated type for the current `impl` cannot be restricted in `where` clauses, remove this bound",
          "",
          "MaybeIncorrect",
        );
      }
      const new_ = AssocItems.find_by_ident_and_kind(
        tcx.associated_items(data.impl_or_alias_def_id) as AssocItems,
        tcx,
        Ident.with_dummy_span(name_),
        "Type",
        data.impl_or_alias_def_id,
      );
      if (new_ !== undefined) {
        // The associated type is specified in the `impl` we're
        // looking at. Point at it.
        const span = tcx.def_span(new_.def_id);
        err.span_label(span, `associated type \`<${self_ty_str} as ${trait_name}>::${display_Symbol(name_)}\` is specified here`);
        // Search for the associated type `Self::{name}`, get
        // its type and suggest replacing the bound with it.
        const visitor = new SelfVisitor(undefined, name_);
        visitor.visit_trait_ref(trait_ref);
        for (const path of visitor.paths) {
          err.span_suggestion_verbose(
            path.span,
            "replace the associated type with the type specified in this `impl`",
            display_Ty(EarlyBinder.skip_binder(tcx.type_of(new_.def_id) as EarlyBinder<Ty>)),
            "MachineApplicable",
          );
        }
      } else {
        const visitor = new SelfVisitor(undefined, undefined);
        visitor.visit_trait_ref(trait_ref);
        const span: MultiSpan = MultiSpan.from_Vec(visitor.paths.map((p) => p.span));
        err.span_note(span, "associated types for the current `impl` cannot be restricted in `where` clauses");
      }
    }
    prev = [pred, curr_span];
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7291 get_deref_type_and_refs
export function get_deref_type_and_refs(ty_: Ty): [Ty, Mutability[]] {
  let ty = ty_;
  const refs: Mutability[] = [];

  let k: TyKind;
  while ((k = ty.kind()).$ === "Ref") {
    ty = k._1;
    refs.push(k._2);
  }

  return [ty, refs];
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7304 FindTypeParam
/// Look for type `param` in an ADT being used only through a reference to confirm that suggesting
/// `param: ?Sized` would be a valid constraint.
// PORT: the default field values (`= Vec::new()`, `= false`) are the constructor's defaults.
export class FindTypeParam extends hir.intravisit.Visitor {
  constructor(
    public param: Symbol,
    public invalid_spans: Span[] = [],
    public nested: boolean = false,
  ) {
    super();
  }

  // impl<'v> Visitor<'v> for FindTypeParam

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7311 visit_where_predicate
  override visit_where_predicate(_: hir.WherePredicate): undefined {
    // Skip where-clauses, to avoid suggesting indirection for type parameters found there.
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7315 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    // We collect the spans of all uses of the "bare" type param, like in `field: T` or
    // `field: (T, T)` where we could make `T: ?Sized` while skipping cases that are known to be
    // valid like `field: &'a T` or `field: *mut T` and cases that *might* have further `Sized`
    // obligations like `Box<T>` and `Vec<T>`, but we perform no extra analysis for those cases
    // and suggest `T: ?Sized` regardless of their obligations. This is fine because the errors
    // in that case should make what happened clear enough.
    const k = ty.kind;
    if (k.$ === "Ptr" || k.$ === "Ref" || k.$ === "TraitObject") {
      // (nothing)
    } else if (
      k.$ === "Path" &&
      k._0.$ === "Resolved" &&
      k._0._0 === undefined &&
      k._0._1.segments.length === 1 &&
      k._0._1.segments[0].ident.name === this.param
    ) {
      if (!this.nested) {
        // debug!(?ty, "FindTypeParam::visit_ty");
        this.invalid_spans.push(ty.span);
      }
    } else if (k.$ === "Path") {
      const prev = this.nested;
      this.nested = true;
      hir.intravisit.walk_ty(this, ty);
      this.nested = prev;
    } else {
      hir.intravisit.walk_ty(this, ty);
    }
    return undefined;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7348 ParamFinder
/// Look for type parameters in predicates. We use this to identify whether a bound is suitable in
/// on a given item.
// PORT: the default field value (`= Vec::new()`) is the constructor's default.
export class ParamFinder implements TypeVisitor<undefined> {
  constructor(public params: Symbol[] = []) {}

  readonly Result = VisitorResult.unit;

  // impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for ParamFinder

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7353 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Param") {
      this.params.push(k._0.name);
    }
    return fold_Ty.super_visit_with(t, this);
  }

  // (provided)
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }

  // impl ParamFinder

  /// Whether the `hir::Generics` of the current item can suggest the evaluated bound because its
  /// references to type parameters are present in the generics.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:7365 can_suggest_bound
  can_suggest_bound(generics: hir.Generics): boolean {
    if (this.params.length === 0) {
      // There are no references to type parameters at all, so suggesting the bound
      // would be reasonable.
      return true;
    }
    return generics.params.some((p) => {
      if (p.name.$ === "Plain") {
        const p_name = p.name._0;
        // All of the parameters in the bound can be referenced in the current item.
        return this.params.some((p) => p === p_name.name || p === kw.SelfUpper);
      }
      return true;
    });
  }
}

// ---- lane errrep-sugg-c helpers ----

/** `impl Display for ty::Binder<'tcx, TraitClause>` (rustc_type_ir ir_print.rs:89 through `IrPrint` for `TyCtxt`). */
function display_PolyTraitClause(self: PolyTraitClauseT): string {
  return IrPrint_print(self, { alternate: false }, (v, p) => print_Binder(v, p, print_TraitClause, d_TraitClause_c));
}

/** `impl Display for ty::Binder<'tcx, TraitClausePrintModifiersAndPath>` (ir_print.rs:89 through `IrPrint` for `TyCtxt`). */
function display_Binder_TraitClausePrintModifiersAndPath(self: Binder<TraitClausePrintModifiersAndPath>): string {
  return IrPrint_print(self, { alternate: false }, (v, p) =>
    print_Binder(v, p, print_TraitClausePrintModifiersAndPath, d_TraitClausePrintModifiersAndPath_c),
  );
}

/** The generated `TypeFoldable` impl fns of `TraitClause` as a descriptor. */
const d_TraitClause_c: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};
const d_Binder_Ty_c = (): TypeFoldable<Binder<Ty>> => fold_Binder(fold_Ty);
/** The derived `TypeFoldable` of `ProjectionClause`. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};
/** The derived `TypeFoldable` of `AliasTerm` (`Alias<AliasTermKind>`). */
const d_AliasTerm: TypeFoldable<AliasTermT> = {
  visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
  try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
  fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
};
/** The derived `TypeFoldable` of `FnSigTys`. */
const d_FnSigTys: TypeFoldable<FnSigTysT> = {
  visit_with: visit_with_FnSigTys,
  try_fold_with: try_fold_with_FnSigTys,
  fold_with: fold_with_FnSigTys,
};
/**
 * pretty.rs:3057 `#[derive(TypeFoldable, TypeVisitable, Lift)] struct TraitClausePrintModifiersAndPath(ty::TraitClause)`:
 * the derive forwards to the single field.
 */
// PORT: hand-written derive (the struct is hand-written in pretty.ts; no generated impls yet).
const d_TraitClausePrintModifiersAndPath_c: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Ok" ? Ok({ _0: r._0 }) : r;
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder) }),
};
/** `T: Upcast<TyCtxt, Predicate>` descriptors (the `Interner` parameter is the `TyCtxt`). */
const upcast_PolyTraitClause = Predicate_upcast_from_PolyTraitClause as unknown as (from: PolyTraitClauseT, tcx: Interner) => Predicate;
const upcast_PolyTraitRef = Predicate_upcast_from_PolyTraitRef as unknown as (from: Binder<TraitRefT>, tcx: Interner) => Predicate;
const upcast_TraitRef = Predicate_upcast_from_TraitRef as unknown as (from: TraitRefT, tcx: Interner) => Predicate;
const upcast_Binder_PredicateKind = Predicate_upcast_from_Binder_PredicateKind as unknown as (from: Binder<PredicateKind>, tcx: Interner) => Predicate;

/** Same-crate modules, read lazily (init order: see the header). */
function traits_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
function engine_mod(): typeof import("../../traits/engine.ts") {
  return require("../../traits/engine.ts") as typeof import("../../traits/engine.ts");
}
function diagnostics_mod(): typeof import("../../diagnostics.ts") {
  return require("../../diagnostics.ts") as typeof import("../../diagnostics.ts");
}
