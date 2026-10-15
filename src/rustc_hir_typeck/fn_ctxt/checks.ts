// Port of compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs (lanes typeck-checks-a: :1..1668, typeck-checks-b: :1669..).
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/checks.rs:<line>` (FnCtxt and the contract classes
// `CallCtxt` / `ArgsCtxt` / `ArgMatchingCtxt` / `FnCallDiagCtxt`; comment-only declarations for helper types, trait
// impls and nested fns).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./checks.gen.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt, register_deref } from "../decls.ts";
import { ArgMatchingCtxt, ArgsCtxt, CallCtxt, FnCallDiagCtxt } from "./checks.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";

// fn_ctxt/checks.rs:3449 `impl Deref for CallCtxt { type Target = FnCtxt }` (`&self.fn_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(CallCtxt, "fn_ctxt", FnCtxt);
// fn_ctxt/checks.rs:3304 `impl Deref for ArgsCtxt { type Target = CallCtxt }` (`&self.call_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ArgsCtxt, "call_ctxt", CallCtxt);
// fn_ctxt/checks.rs:3154 `impl Deref for ArgMatchingCtxt { type Target = ArgsCtxt }` (`&self.args_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ArgMatchingCtxt, "args_ctxt", ArgsCtxt);
// fn_ctxt/checks.rs:2252 `impl Deref for FnCallDiagCtxt { type Target = ArgMatchingCtxt }` (`&self.arg_matching_ctxt`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(FnCallDiagCtxt, "arg_matching_ctxt", ArgMatchingCtxt);
// ==== lane typeck-checks-a: checks.rs:1..1668 ====
// - `RefCell` / `Cell` fields are the values (decls.ts): `self.diverges.get()` is `this.diverges`,
//   `self.deferred_cast_checks.borrow_mut().drain(..)` empties the array.
// - Closures stay closures; `debug!` stays a comment.
// - `GenericIdx` / `TupledArgCheckOutcome` are generated (checks.gen.ts).
// PORT: this lane's imports sit here with an `A` suffix (`TyA`, `hirA`, ...) so that they cannot collide with the
// imports lane typeck-checks-b adds for checks.rs:1669.. when both lanes merge into this one file.
import { Applicability as ApplicabilityA } from "../../rustc_errors/lib.ts";
import type { Diag as DiagA } from "../../rustc_errors/lib.ts";
import { struct_span_code_err as struct_span_code_errA } from "../../rustc_errors/diagnostic.ts";
import { E0057, E0059, E0060, E0061, E0071, E0277, E0617 } from "../../rustc_errors/error_codes.gen.ts";
import type { ErrCode as ErrCodeA } from "../../rustc_errors/lib.ts";
import * as hirA from "../../rustc_hir/lib.ts";
import { Res as ResA, debug_Res as debug_ResA, type DefKind as DefKindA } from "../../rustc_hir/def.ts";
import { debug_HirId as debug_HirIdA, type HirId as HirIdA } from "../../rustc_hir_id/lib.ts";
import { DefineOpaqueTypes as DefineOpaqueTypesA, ToTrace_Ty as ToTrace_TyA } from "../../rustc_infer/infer/at.ts";
import { Obligation as ObligationA } from "../../rustc_infer/traits/mod.ts";
import { TraitErrors as TraitErrorsA, debug_TraitErrors as debug_TraitErrorsA, debug_ScrubbedTraitError as debug_ScrubbedTraitErrorA } from "../../rustc_infer/traits/engine.ts";
import { clone_ObligationCause as clone_ObligationCauseA, type ObligationCause as ObligationCauseA } from "../../rustc_middle/traits/mod.ts";
import type { FulfillmentError as FulfillmentErrorA } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { Value as ValueA } from "../../rustc_middle/ty/consts/valtree.ts";
import type { GenericArgs as GenericArgsA } from "../../rustc_middle/ty/generic_args.ts";
import { Ty as TyA, debug_Ty as debug_TyA, type VariantDef as VariantDefA } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind as Predicate_upcast_from_ClauseKindA, type Predicate as PredicateA } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty as fold_TyA } from "../../rustc_middle/ty/structural_impls.ts";
import { display_Ty as display_TyA } from "../../rustc_middle/ty/print/pretty.ts";
import { LocalDefId as LocalDefIdA, type DefId as DefIdA, DefId_eq as DefId_eqA } from "../../rustc_span/def_id.ts";
import { Span as SpanA, type ErrorGuaranteed as ErrorGuaranteedA } from "../../rustc_span/lib.ts";
import { bug as bugA, span_bug as span_bugA } from "../../rustc_span/macros.ts";
import { sym as symA } from "../../rustc_span/symbol.ts";
import type { Session as SessionA } from "../../rustc_session/session.ts";
import { ObligationCtxt as ObligationCtxtA } from "../../rustc_trait_selection/traits/engine.ts";
import { EarlyBinder as EarlyBinderA } from "../../rustc_type_ir/binder.ts";
import { fold_Option as fold_OptionA, fold_tuple2 as fold_tuple2A, fold_Vec as fold_VecA, type TypeFoldable as TypeFoldableA } from "../../rustc_type_ir/fold.ts";
import { fold_Const as fold_ConstA, type Const as ConstA } from "../../rustc_type_ir/sty/consts.ts";
import { debug_TyKind as debug_TyKindA } from "../../rustc_type_ir/ty_kind.ts";
import { debug_TypeError as debug_TypeErrorA, type TypeError as TypeErrorA } from "../../rustc_type_ir/error.ts";
import { Unnormalized as UnnormalizedA } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt as TypeVisitableExtA } from "../../rustc_type_ir/visit.ts";
import { LangItem as LangItemA } from "../../rustc_attr_ir/lang_items.ts";
import { ByteSymbol as ByteSymbolA } from "../../rustc_span/symbol.ts";
import { KeyedSet as KeyedSetA } from "../../rust_ts/keyed.ts";
import { intern_key as intern_keyA } from "../../rust_ts/intern_key.ts";
import { format_debug as format_debugA, PLAIN as PLAINA } from "../../std/fmt.ts";
import { assert as assertA, panic as panicA, unreachable as unreachableA, unwrap as unwrapA } from "../../std/panic.ts";
import { Err as ErrA, Ok as OkA, type Result as ResultA } from "../../std/result.ts";
import type { SplatLoweringInfo as SplatLoweringInfoA } from "../callee.gen.ts";
import { CoerceMany as CoerceManyA } from "../coercion.ts";
import {
  ExprParenthesesNeeded_subdiagnostic,
  PassFnItemToVariadicFunction_diagnostic,
  PassToVariadicFunction_diagnostic,
  SuggestPtrNullMut_subdiagnostic,
  SuggestRawMut_subdiagnostic,
  SuggestRefMut_subdiagnostic,
} from "../diagnostics.gen.ts";
import { ExprParenthesesNeeded_surrounding } from "../diagnostics.ts";
import { Diverges as DivergesA } from "../diverges.ts";
import { Expectation as ExpectationA, type Expectation as ExpectationT } from "../expectation.ts";
import { Declaration_from_LetStmt, GatherLocalsVisitor, type Declaration as DeclarationA } from "../gather_locals.ts";
import { InlineAsmCtxt } from "../inline_asm.gen.ts";
import { Needs as NeedsA, TupleArgumentsFlag as TupleArgumentsFlagA, type BreakableCtxt as BreakableCtxtA } from "../lib.ts";
import { debug_TupleArgumentsFlag as debug_TupleArgumentsFlagA } from "../lib.gen.ts";
import { EvaluationResult as EvaluationResultA } from "../../rustc_middle/traits/select.ts";
import { DeclOrigin as DeclOriginA } from "../gather_locals.ts";
import { type Compatibility as CompatibilityA } from "./arg_matrix.ts";
import { LoweredTy as LoweredTyA } from "./mod.ts";
import type { TupledArgCheckOutcome } from "./checks.gen.ts";
import { Binder as BinderR } from "../../rustc_type_ir/binder.ts";
import type { Variance as VarianceR } from "../../rustc_type_ir/decls.ts";
import { ExpectedFound as ExpectedFoundR, TypeError as TypeErrorR } from "../../rustc_type_ir/error.ts";
import {
  type Relate as RelateR,
  relate_args_invariantly as relate_args_invariantlyR,
  relate_Ty as relate_TyR,
  type RelateResult as RelateResultR,
  structurally_relate_consts as structurally_relate_constsR,
  structurally_relate_tys as structurally_relate_tysR,
  type TypeRelation as TypeRelationR,
  TypeRelation_provided as TypeRelation_providedR,
  type VarianceDiagInfo as VarianceDiagInfoR,
} from "../../rustc_type_ir/relate.ts";
import type { Region as RegionR } from "../../rustc_type_ir/sty/mod.ts";
// ---- lane typeck-checks-b: checks.rs:1669.. ----
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { a_or_an, Applicability, listify, MultiSpan, pluralize, type Diag, type ErrCode } from "../../rustc_errors/lib.ts";
import { struct_span_code_err } from "../../rustc_errors/diagnostic.ts";
import { E0308 } from "../../rustc_errors/error_codes.gen.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import { OwnerId_eq } from "../../rustc_hir_id/lib.ts";
import { potentially_plural_count } from "../../rustc_hir_analysis/check/mod.ts";
import { DefineOpaqueTypes, ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { TypeTrace } from "../../rustc_infer/infer/mod.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.gen.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, GenericParamDefKind, type Generics } from "../../rustc_middle/ty/generics.ts";
import { display_Ty, with_forced_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DefId_eq, LocalDefId, type DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, Span, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import { kw, sym, Symbol, type Ident, type Symbol as SymbolT } from "../../rustc_span/symbol.ts";
import { SelectionContext } from "../../rustc_trait_selection/traits/select/mod.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { ClosureKind, PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { ExpectedFound, type TypeError } from "../../rustc_type_ir/error.ts";
import { as_interner, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_FnSig, FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { format_debug } from "../../std/fmt.ts";
import { assert, unreachable, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { Str } from "../../std/str.ts";
import type { SplatLoweringInfo } from "../callee.gen.ts";
import { ArgMismatchIndeterminate_diagnostic } from "../diagnostics.gen.ts";
import { Expectation } from "../expectation.ts";
import { TupleArgumentsFlag } from "../lib.ts";
import type { MethodError } from "../method/mod.gen.ts";
import { Mode, ProbeScope } from "../method/probe.gen.ts";
import { ArgMatrix, clone_Compatibility, Compatibility, ExpectedIdx, ProvidedIdx, type Error as ArgError } from "./arg_matrix.ts";
import { ArgumentsFormatting, GenericIdx, SuggestionText, type CallMetadata, type FnParam as FnParamG } from "./checks.gen.ts";

/** `Option<DefId> == Some(def_id)`. */
function DefId_eqA_opt(a: DefIdA | undefined, b: DefIdA): boolean {
  return a !== undefined && DefId_eqA(a, b);
}


// impl<'a, 'tcx> FnCtxt<'a, 'tcx>

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:72 check_casts
FnCtxt.prototype.check_casts = function (this: FnCtxt): void {
  const deferred_cast_checks = this.root_ctxt.deferred_cast_checks;
  // debug!("FnCtxt::check_casts: {} deferred checks", deferred_cast_checks.len());
  for (const cast of deferred_cast_checks.splice(0)) {
    const body_def_id = this.body_def_id;
    this.body_def_id = cast.body_def_id;
    cast.check(this);
    this.body_def_id = body_def_id;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:82 check_asms
FnCtxt.prototype.check_asms = function (this: FnCtxt): void {
  const deferred_asm_checks = this.deferred_asm_checks;
  // debug!("FnCtxt::check_asm: {} deferred checks", deferred_asm_checks.len());
  for (const [asm, hir_id] of deferred_asm_checks.splice(0)) {
    const enclosing_id = this.tcx.hir_enclosing_body_owner(hir_id);
    InlineAsmCtxt.new(this, enclosing_id).check_asm(asm);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:91 check_repeat_exprs
FnCtxt.prototype.check_repeat_exprs = function (this: FnCtxt): void {
  const deferred_repeat_expr_checks_ = this.deferred_repeat_expr_checks;
  // debug!("FnCtxt::check_repeat_exprs: {} deferred checks", deferred_repeat_expr_checks.len());

  const deferred_repeat_expr_checks: [hirA.Expr, TyA, ConstA][] = [];
  for (const [element, element_ty, count_] of deferred_repeat_expr_checks_.splice(0)) {
    const r = ((): [hirA.Expr, TyA, ConstA] | undefined => {
      // Actual constants as the repeat element are inserted repeatedly instead
      // of being copied via `Copy`, so we don't need to attempt to structurally
      // resolve the repeat count which may unnecessarily error.
      switch (element.kind.$) {
        case "ConstBlock":
          return undefined;
        case "Path": {
          const qpath = element.kind._0;
          const res = this.typeck_results.qpath_res(qpath, element.hir_id);
          if (res.$ === "Def" && (res._0.$ === "Const" || res._0.$ === "AssocConst")) {
            return undefined;
          }
          break;
        }
        default:
          break;
      }

      // We want to emit an error if the const is not structurally resolvable
      // as otherwise we can wind up conservatively proving `Copy` which may
      // infer the repeat expr count to something that never required `Copy` in
      // the first place.
      const count = this.structurally_resolve_const(element.span, this.normalize(element.span, UnnormalizedA.new_wip(count_), fold_ConstA));

      // Avoid run on "`NotCopy: Copy` is not implemented" errors when the
      // repeat expr count is erroneous/unknown. The user might wind up
      // specifying a repeat count of 0/1.
      if (TypeVisitableExtA.references_error(count, fold_ConstA)) {
        return undefined;
      }

      return [element, element_ty, count];
    })();
    if (r !== undefined) deferred_repeat_expr_checks.push(r);
  }
  // We collect to force the side effects of structurally resolving the repeat
  // count to happen in one go, to avoid side effects from proving `Copy`
  // affecting whether repeat counts are known or not. If we did not do this we
  // would get results that depend on the order that we evaluate each repeat
  // expr's `Copy` check.

  const enforce_copy_bound = (element: hirA.Expr, element_ty: TyA): void => {
    // If someone calls a const fn or constructs a const value, they can extract that
    // out into a separate constant (or a const block in the future), so we check that
    // to tell them that in the diagnostic. Does not affect typeck.
    let is_constable: "No" | "Fn" | "Ctor";
    switch (element.kind.$) {
      case "Call": {
        const func = element.kind._0;
        const k = this.node_ty(func.hir_id).kind();
        if (k.$ === "FnDef" && this.tcx.is_stable_const_fn(k._0)) {
          is_constable = "Fn";
        } else {
          is_constable = "No";
        }
        break;
      }
      case "Path": {
        const qpath = element.kind._0;
        const res = this.typeck_results.qpath_res(qpath, element.hir_id);
        if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Const") {
          is_constable = "Ctor";
        } else {
          is_constable = "No";
        }
        break;
      }
      default:
        is_constable = "No";
    }

    const lang_item = this.tcx.require_lang_item(LangItemA.Copy, element.span);
    const code = { $: "RepeatElementCopy" as const, is_constable, elt_span: element.span };
    this.require_type_meets(element_ty, element.span, code, lang_item);
  };

  for (const [element, element_ty, count] of deferred_repeat_expr_checks) {
    const kind = count.kind();
    switch (kind.$) {
      case "Value": {
        const val = kind._0;
        const n = ValueA.try_to_target_usize(val, this.tcx);
        if (n === undefined || n > 1n) {
          enforce_copy_bound(element, element_ty);
        } else {
          // If the length is 0 or 1 we don't actually copy the element, we either don't create it
          // or we just use the one value.
        }
        break;
      }

      // If the length is a generic parameter or some rigid alias then conservatively
      // require `element_ty: Copy` as it may wind up being `>1` after monomorphization.
      case "Param":
      case "Expr":
      case "Placeholder":
      case "Alias":
        enforce_copy_bound(element, element_ty);
        break;

      case "Bound":
      case "Infer":
      case "Error":
        unreachableA();
    }
  }
};

/// Generic function that factors out common logic from function calls,
/// method calls and overloaded operators.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:192 check_argument_types
FnCtxt.prototype.check_argument_types = function (
  this: FnCtxt,
  // Span enclosing the call site
  call_span: SpanA,
  // Expression of the call site
  call_expr: hirA.Expr,
  // Types (as defined in the *signature* of the target function)
  formal_input_tys_: readonly TyA[],
  formal_output: TyA,
  // Expected output from the parent expression or statement
  expectation: ExpectationT,
  // The expressions for each provided argument
  provided_args: readonly hirA.Expr[],
  // Whether the function is variadic (e.g. from C)
  c_variadic: boolean,
  // Whether all the arguments have been bundled in a tuple (ex: closures), or one has been splatted
  tuple_arguments: TupleArgumentsFlagA,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfoA,
  // The generics of the function being called. Only used for splatting
  callee_generic_args: GenericArgsA | undefined,
): void {
  const tcx = this.tcx;

  // Conceptually, we've got some number of expected inputs, and some number of provided arguments
  // and we can form a grid of whether each argument could satisfy a given input:
  //      in1 | in2 | in3 | ...
  // arg1  ?  |     |     |
  // arg2     |  ?  |     |
  // arg3     |     |  ?  |
  // ...
  // Initially, we just check the diagonal, because in the case of correct code
  // these are the only checks that matter
  // However, in the unhappy path, we'll fill in this whole grid to attempt to provide
  // better error messages about invalid method calls.

  // All the input types from the fn signature must outlive the call
  // so as to validate implied bounds.
  for (let i = 0; i < Math.min(formal_input_tys_.length, provided_args.length); i++) {
    const fn_input_ty = formal_input_tys_[i]!;
    const arg_expr = provided_args[i]!;
    this.register_wf_obligation(fn_input_ty, arg_expr.span, { $: "WellFormed", _0: { $: "HirId", _0: arg_expr.hir_id } });

    this.check_place_expr_if_unsized(fn_input_ty, arg_expr);
  }

  // First, let's unify the formal method signature with the expectation eagerly.
  // We use this to guide coercion inference; its output is "fudged" which means
  // any remaining type variables are assigned to new, unrelated variables. This
  // is because the inference guidance here is only speculative.
  // FIXME(splat): do we need to splat arguments before this type inference?
  // PORT: `Option<Option<Vec<_>>>::unwrap_or_default()` flattens to `Ty[] | undefined`.
  let expected_input_tys: TyA[] | undefined = ((): TyA[] | undefined => {
    const expected_output = ExpectationA.only_has_type(expectation, this);
    if (expected_output === undefined) return undefined;
    const formal_output_ = this.deeply_resolve_ignoring_regions_with_obligations(formal_output, fold_TyA);
    // FIXME(#149379): This operation results in expected input
    // types which are potentially not well-formed or for whom the
    // function where-bounds don't actually hold. This results
    // in weird bugs when later treating these expectations as if
    // they were actually correct.
    const r = this.fudge_inference_if_ok<TyA[] | undefined, TypeErrorA>(() => {
      const ocx = ObligationCtxtA.new(this.infcx);

      // Attempt to apply a subtyping relationship between the formal
      // return type (likely containing type variables if the function
      // is polymorphic) and the expected return type.
      // No argument expectations are produced if unification fails.
      const origin = this.misc(call_span);
      const sup = ocx.sup(origin, this.param_env, expected_output, formal_output_, ToTrace_TyA);
      if (sup.$ === "Err") return sup;

      // Check the well-formedness of expected input tys, as using ill-formed
      // expectation may cause type inference errors, see #150316.
      for (const ty of formal_input_tys_) {
        ocx.register_obligation(
          ObligationA.new(this.tcx, this.misc(call_span), this.param_env, { $: "WellFormed" as const, _0: ty }, (from, interner) =>
            Predicate_upcast_from_ClauseKindA(from, interner as unknown as typeof tcx),
          ),
        );
      }

      if (!TraitErrorsA.no_errors(ocx.try_evaluate_obligations())) {
        return ErrA({ $: "Mismatch" });
      }

      // Record all the argument types, with the args
      // produced from the above subtyping unification.
      return OkA(formal_input_tys_.map((ty) => this.deeply_resolve_ignoring_regions(ty, fold_TyA)));
    }, fold_OptionA(fold_VecA(fold_TyA)) as TypeFoldableA<TyA[] | undefined>);
    if (r.$ === "Err") return undefined;
    const expected_input_tys = r._0;

    return expected_input_tys === undefined
      ? undefined
      : expected_input_tys
          .slice(0, formal_input_tys_.length)
          // if the expected input type is structurally equal to the formal input type,
          // i.e. we've only changed some inference variables around, keep the formal
          // input ty as the expected input ty. Usually fudging helps because it gains
          // information from a callsite of a function. However, Fudging also sometimes
          // loses information, when the original, formal, input type had constraints on it,
          // and fudging replaces all inference variables with fresh ones, those constraints
          // are discarded. This check makes sure we only keep fudging output if structural
          // changes were made to the type. If all that was changed were some typevars,
          // we go back to the unfudged formal input type.
          .map((expected_input_ty, i) => {
            const formal_input_ty = formal_input_tys_[i]!;
            if (same_type_modulo_vars(tcx, expected_input_ty, formal_input_ty)) {
              // if they're the same, fall back to the formal input type
              return formal_input_ty;
            } else {
              return expected_input_ty;
            }
          });
  })();

  let err_code: ErrCodeA = E0061;

  let formal_input_tys = formal_input_tys_.slice();

  // If the arguments should be wrapped in a tuple (ex: closures, splats), unwrap them here
  if (TupleArgumentsFlagA.is_tupled(tuple_arguments)) {
    // Caller arguments are tupled before typechecking, starting at the given index.
    // Tupling makes the callee and caller argument counts match.
    const outcome = this.check_tupled_arguments(call_span, call_expr, formal_input_tys, provided_args, expected_input_tys, tuple_arguments, fn_id, callee_generic_args);
    const { new_err_code, untupled_formal_input_tys, untupled_expected_input_tys } = outcome;
    if (new_err_code !== undefined) {
      err_code = new_err_code;
    }
    formal_input_tys = untupled_formal_input_tys;
    expected_input_tys = untupled_expected_input_tys;
  }

  // If there are no external expectations at the call site, just use the types from the function defn
  let expected_input_tys_: TyA[];
  if (expected_input_tys !== undefined) {
    assertA(expected_input_tys.length === formal_input_tys.length, `assertion \`left == right\` failed\n  left: ${expected_input_tys.length}\n right: ${formal_input_tys.length}`);
    expected_input_tys_ = expected_input_tys;
  } else {
    expected_input_tys_ = formal_input_tys.slice();
  }

  const minimum_input_count = expected_input_tys_.length;
  const provided_arg_count = provided_args.length;

  // We introduce a helper function to demand that a given argument satisfy a given input
  // This is more complicated than just checking type equality, as arguments could be coerced
  // This version writes those types back so further type checking uses the narrowed types
  const demand_compatible = (idx: number): CompatibilityA => {
    const formal_input_ty: TyA = formal_input_tys[idx]!;
    const expected_input_ty: TyA = expected_input_tys_[idx]!;
    const provided_arg: hirA.Expr = provided_args[idx]!;

    // debug!("checking argument {}: {:?} = {:?}", idx, provided_arg, formal_input_ty);

    // We're on the happy path here, so we'll do a more involved check and write back types
    // To check compatibility, we'll do 3 things:
    // 1. Unify the provided argument with the expected type
    const expectation = ExpectationA.rvalue_hint(this, expected_input_ty);

    // If we are processing first arg of delegation then we could have adjusted it
    // in `execute_delegation_aware_arguments_check`.
    const checked_ty =
      (this.tcx.hir_opt_delegation_info(this.body_def_id) !== undefined ? this.typeck_results.node_type_opt(provided_arg.hir_id) : undefined) ??
      this.check_expr_with_expectation(provided_arg, expectation);

    // 2. Coerce to the most detailed type that could be coerced
    //    to, which is `expected_ty` if `rvalue_hint` returns an
    //    `ExpectHasType(expected_ty)`, or the `formal_ty` otherwise.
    let coerced_ty = ExpectationA.only_has_type(expectation, this) ?? formal_input_ty;

    // Cause selection errors caused by resolving a single argument to point at the
    // argument and not the call. This lets us customize the span pointed to in the
    // fulfillment error to be more accurate.
    coerced_ty = this.deeply_resolve_ignoring_regions_with_obligations(coerced_ty, fold_TyA);

    const coerce_result = this.coerce(provided_arg, checked_ty, coerced_ty, "Yes", undefined);
    const coerce_error = coerce_result.$ === "Err" ? coerce_result._0 : undefined;
    if (coerce_result.$ === "Err") {
      return { $: "Incompatible", _0: coerce_error };
    }

    // 3. Check if the formal type is actually equal to the checked one
    //    and register any such obligations for future type checks.
    const formal_ty_error = this.at(this.misc(provided_arg.span), this.param_env).eq(DefineOpaqueTypesA.Yes, formal_input_ty, coerced_ty, ToTrace_TyA);

    // If neither check failed, the types are compatible
    switch (formal_ty_error.$) {
      case "Ok": {
        const { obligations } = formal_ty_error._0;
        this.register_predicates(obligations);
        return { $: "Compatible" };
      }
      case "Err":
        return { $: "Incompatible", _0: formal_ty_error._0 };
    }
  };

  // To start, we only care "along the diagonal", where we expect every
  // provided arg to be in the right spot
  const compatibility_diagonal: CompatibilityA[] = Array.from({ length: provided_args.length }, () => ({ $: "Incompatible", _0: undefined }));

  // Keep track of whether we *could possibly* be satisfied, i.e. whether we're on the happy path
  // if the wrong number of arguments were supplied, we CAN'T be satisfied,
  // and if we're c_variadic, the supplied arguments must be >= the minimum count from the function
  // otherwise, they need to be identical, because rust doesn't currently support variadic functions
  let call_appears_satisfied = c_variadic ? provided_arg_count >= minimum_input_count : provided_arg_count === minimum_input_count;

  // Check the arguments.
  // We do this in a pretty awful way: first we type-check any arguments
  // that are not closures, then we type-check the closures. This is so
  // that we have more information about the types of arguments when we
  // type-check the functions. This isn't really the right way to do this.
  for (const check_closures of [false, true]) {
    // More awful hacks: before we check argument types, try to do
    // an "opportunistic" trait resolution of any trait bounds on
    // the call. This helps coercions.
    if (check_closures) {
      this.select_obligations_where_possible((_) => {});
    }

    // Check each argument, to satisfy the input it was provided for
    // Visually, we're traveling down the diagonal of the compatibility matrix
    for (let idx = 0; idx < provided_args.length; idx++) {
      const arg = provided_args[idx]!;
      // Warn only for the first loop (the "no closures" one).
      // Closure arguments themselves can't be diverging, but
      // a previous argument can, e.g., `foo(panic!(), || {})`.
      if (!check_closures) {
        this.warn_if_unreachable(arg.hir_id, arg.span, "expression");
      }

      // For C-variadic functions, we don't have a declared type for all of
      // the arguments hence we only do our usual type checking with
      // the arguments who's types we do know. However, we *can* check
      // for unreachable expressions (see above).
      // FIXME: unreachable warning current isn't emitted
      if (idx >= minimum_input_count) {
        continue;
      }

      // For this check, we do *not* want to treat async coroutine closures (async blocks)
      // as proper closures. Doing so would regress type inference when feeding
      // the return value of an argument-position async block to an argument-position
      // closure wrapped in a block.
      // See <https://github.com/rust-lang/rust/issues/112225>.
      const is_closure = arg.kind.$ === "Closure" ? !tcx.coroutine_is_async(LocalDefIdA.to_def_id(arg.kind._0.def_id)) : false;
      if (is_closure !== check_closures) {
        continue;
      }

      const compatible = demand_compatible(idx);
      const is_compatible = compatible.$ === "Compatible";
      compatibility_diagonal[idx] = compatible;

      if (!is_compatible) {
        call_appears_satisfied = false;
      }
    }
  }

  if (c_variadic && provided_arg_count < minimum_input_count) {
    err_code = E0060;
  }

  for (const arg of provided_args.slice(minimum_input_count)) {
    // Make sure we've checked this expr at least once.
    let arg_ty = this.check_expr(arg);

    // If the function is c-style variadic, we skipped a bunch of arguments
    // so we need to check those, and write out the types
    // Ideally this would be folded into the above, for uniform style
    // but c-variadic is already a corner case
    if (c_variadic) {
      // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:500 variadic_error
      const variadic_error = (sess: SessionA, span: SpanA, ty: TyA, cast_ty: string): void => {
        sess.dcx().emit_err(
          PassToVariadicFunction_diagnostic({
            span,
            ty,
            cast_ty,
            sugg_span: SpanA.shrink_to_hi(span),
            teach: sess.teach(E0617),
          }),
        );
      };

      // There are a few types which get autopromoted when passed via varargs
      // in C but we just error out instead and require explicit casts.
      //
      // We use implementations of VaArgSafe as the source of truth. On some embedded
      // targets, c_double is f32 and c_int/c_uing are i16/u16, and these types implement
      // VaArgSafe there. On all other targets, these types do not implement VaArgSafe.
      //
      // cfg(bootstrap): change the if let to an unwrap.
      arg_ty = this.structurally_resolve_type(arg.span, arg_ty);
      const trait_def_id = tcx.lang_items().va_arg_safe();
      if (trait_def_id !== undefined && EvaluationResultA.must_apply_modulo_regions(this.type_implements_trait(trait_def_id, [arg_ty], this.param_env))) {
        continue;
      }

      const k = arg_ty.kind();
      if (k.$ === "Float" && k._0 === "F32") {
        variadic_error(tcx.sess, arg.span, arg_ty, "c_double");
      } else if ((k.$ === "Int" && (k._0 === "I8" || k._0 === "I16")) || k.$ === "Bool") {
        variadic_error(tcx.sess, arg.span, arg_ty, "c_int");
      } else if (k.$ === "Uint" && (k._0 === "U8" || k._0 === "U16")) {
        variadic_error(tcx.sess, arg.span, arg_ty, "c_uint");
      } else if (k.$ === "FnDef") {
        let fn_ptr_ty = TyA.new_fn_ptr(this.tcx, arg_ty.fn_sig(this.tcx));
        const fn_ptr = display_TyA(this.deeply_resolve_ignoring_regions(fn_ptr_ty, fold_TyA));

        const fn_item_spa = arg.span;
        tcx.sess.dcx().emit_err(
          PassFnItemToVariadicFunction_diagnostic({
            span: fn_item_spa,
            sugg_span: SpanA.shrink_to_hi(fn_item_spa),
            replace: fn_ptr,
          }),
        );
      }
    }
  }

  if (!call_appears_satisfied) {
    const provided_args_ = provided_args.slice(0, c_variadic ? minimum_input_count : provided_arg_count);
    // debug_assert_eq!(
    //     formal_input_tys.len(),
    //     expected_input_tys.len(),
    //     "expected formal_input_tys to be the same size as expected_input_tys"
    // );
    // PORT: `Itertools::zip_eq` panics when the lengths differ.
    if (formal_input_tys.length !== expected_input_tys_.length) panicA("itertools: .zip_eq() reached the end of one iterator before the other");
    const formal_and_expected_inputs: [TyA, TyA][] = formal_input_tys.map((f, i) =>
      this.deeply_resolve_ignoring_regions<[TyA, TyA]>([f, expected_input_tys_[i]!], fold_tuple2A(fold_TyA, fold_TyA)),
    );

    this.report_arg_errors(compatibility_diagonal, formal_and_expected_inputs, provided_args_, c_variadic, err_code, fn_id, call_span, call_expr, tuple_arguments);
  }
};

/// Check arguments that are tupled by "rust-call" or `#[rustc_splat]`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:593 check_tupled_arguments
FnCtxt.prototype.check_tupled_arguments = function (
  this: FnCtxt,
  // Span enclosing the call site
  call_span: SpanA,
  // Expression of the call site
  call_expr: hirA.Expr,
  // Types (as defined in the *signature* of the target function)
  formal_input_tys: TyA[],
  // The expressions for each provided argument
  provided_args: readonly hirA.Expr[],
  // The expected input types from the context of the call site
  expected_input_tys: TyA[] | undefined,
  // Whether all the arguments have been bundled in a tuple (ex: closures), or one has been splatted
  tuple_arguments: TupleArgumentsFlagA,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfoA,
  // The generics of the function being called. Only used for splatting
  callee_generic_args: GenericArgsA | undefined,
): TupledArgCheckOutcome {
  const [first_tupled_arg_index, is_self_splatted] = TupleArgumentsFlagA.tupled_arg_index(tuple_arguments);
  if (first_tupled_arg_index === undefined) {
    // If we're not tupling any of the current arguments, we're done.
    return {
      new_err_code: undefined,
      untupled_formal_input_tys: formal_input_tys,
      untupled_expected_input_tys: expected_input_tys,
    };
  }
  const first_tupled_arg_index_usz = first_tupled_arg_index;

  // The argument difference can range from -1 to u16::MAX - 1, so we count the number
  // of tupled arguments instead.
  // (An empty argument list becomes a unit tuple in the callee.)
  // 0: f() -> f(#[rustc_splat] _: ())
  // 1: f(a) -> f(#[rustc_splat] _: (A,))
  // 2: f(a, b) -> f(#[rustc_splat] _: (A, B))
  // The Fn* traits ensure this by construction, and `#[rustc_splat]` can only be applied to
  // an actual argument.
  const tupled_args_count = 1 + provided_args.length >= formal_input_tys.length ? 1 + provided_args.length - formal_input_tys.length : undefined;
  // debug!(
  //     ?first_tupled_arg_index, ?is_self_splatted,
  //     ?tupled_args_count, ?tuple_arguments,
  //     provided_args_len = ?provided_args.len(), formal_input_tys_len = ?formal_input_tys.len()
  // );

  // If earlier code has modified the FnSig argument list without adjusting the splatted
  // argument, indexing into the formal input types will panic.
  if (first_tupled_arg_index_usz >= formal_input_tys.length) {
    span_bugA(
      call_span,
      `splatted argument index is out of bounds: ${first_tupled_arg_index} >= ${formal_input_tys.length}, ` +
        `is_self_splatted = ${is_self_splatted}, ` +
        `tupled_args_count = ${tupled_args_count === undefined ? "None" : `Some(${tupled_args_count})`}, ${format_debugA(tuple_arguments, debug_TupleArgumentsFlagA, PLAINA)}, ` +
        `provided_args: ${provided_args.length}`,
    );
  }

  const formal_input_tupled_ty = formal_input_tys[first_tupled_arg_index_usz]!;
  // Keep the type variable if the argument is splatted, so we can force it to be a tuple later.
  let tuple_type: TyA;
  if (TupleArgumentsFlagA.is_splatted(tuple_arguments)) {
    const callee_tuple_type = this.deeply_resolve_ignoring_regions_with_obligations(formal_input_tupled_ty, fold_TyA);
    if (callee_tuple_type.is_ty_var() && tupled_args_count !== undefined) {
      // Make the original type variable resolve to a tuple containing new type variables
      const ocx = ObligationCtxtA.new(this.infcx);
      const origin = this.misc(call_span);

      const new_vars: TyA[] = [];
      for (let i = 0; i < tupled_args_count; i++) new_vars.push(this.next_ty_var(call_span));
      const new_tupled_type = TyA.new_tup_from_iter(this.tcx, new_vars);

      // FIXME(splat): should this be a sub/super type relationship?
      const ocx_error = ocx.eq(origin, this.param_env, callee_tuple_type, new_tupled_type, ToTrace_TyA);
      if (ocx_error.$ === "Err") {
        // FIXME(splat): add a test for this error and the one below, if they are reachable
        struct_span_code_errA(
          this.dcx(),
          call_span,
          // FIXME(splat): add a new error code before stabilization (and below as well)
          E0277,
          `cannot resolve splatted arguments; splatted type parameters must be a tuple or unit type: ${format_debugA(ocx_error._0, debug_TypeErrorA, PLAINA)}`,
        ).emit();
      }

      const type_errors = ocx.try_evaluate_obligations();
      if (TraitErrorsA.no_errors(type_errors)) {
        tuple_type = new_tupled_type;
      } else {
        const guar = struct_span_code_errA(
          this.dcx(),
          call_span,
          E0277,
          `cannot resolve splatted arguments; splatted type parameters must be a tuple or unit type: ${debug_TraitErrorsA(type_errors, PLAINA, debug_ScrubbedTraitErrorA)}`,
        ).emit_err();
        tuple_type = TyA.new_error(this.tcx, guar);
      }
    } else {
      // Otherwise, just let the argument type checker make a suggestion
      tuple_type = callee_tuple_type;
    }
  } else {
    tuple_type = this.structurally_resolve_type(call_span, formal_input_tupled_ty);
  }

  // We expected a tuple and got a tuple (or made one ourselves).
  // If it's not a tuple, we error out in the next block.
  let err_code: ErrCodeA | undefined = undefined;
  const tuple_kind = tuple_type.kind();
  if (tuple_kind.$ === "Tuple") {
    const detup_formal_arg_tys = tuple_kind._0;
    // Argument length differs
    // FIXME(splat): update the error code E0057 docs when splat is stabilized
    if (detup_formal_arg_tys.length !== tupled_args_count) {
      err_code = E0057;
    }
    const ty = expected_input_tys !== undefined ? expected_input_tys[first_tupled_arg_index_usz] : undefined;
    const ty_kind = ty !== undefined ? ty.kind() : undefined;
    if (expected_input_tys !== undefined && ty_kind !== undefined && ty_kind.$ === "Tuple") {
      const detup_expected_arg_tys = ty_kind._0;
      let substitute_tys: readonly TyA[];
      if (detup_expected_arg_tys.length === tupled_args_count) {
        substitute_tys = detup_expected_arg_tys;
      } else {
        // Just fall back to the formal argument types
        substitute_tys = detup_formal_arg_tys;
      }

      expected_input_tys.splice(first_tupled_arg_index_usz, 1, ...substitute_tys);
    } else {
      expected_input_tys = undefined;
    }
    formal_input_tys.splice(first_tupled_arg_index_usz, 1, ...detup_formal_arg_tys);
    if (expected_input_tys !== undefined) {
      assertA(
        formal_input_tys.length === expected_input_tys.length,
        `incorrectly constructed input type tuples, argument counts must match: ` +
          `tuple_arguments: ${format_debugA(tuple_arguments, debug_TupleArgumentsFlagA, PLAINA)}, ` +
          `first_tupled_arg_index: ${first_tupled_arg_index}`,
      );
    }
  }

  // Otherwise, there's a mismatch during splatting or a rust-call.
  // So clear out what we're expecting, and set our input types to err_args so we don't
  // blow up the error messages.
  let guar: ErrorGuaranteedA | undefined;
  if (tuple_arguments.$ === "TupleAllCallArgs" && tuple_type.kind().$ !== "Tuple") {
    guar = struct_span_code_errA(
      this.dcx(),
      call_span,
      E0059,
      "cannot use call notation; the first type parameter for the function trait is neither a tuple nor unit",
    ).emit_err();
  } else if (TupleArgumentsFlagA.is_splatted(tuple_arguments)) {
    // If we don't check argument counts here, and there's a subtle bug in the code above,
    // later compilation stages can fail in unrelated places with confusing errors.
    if (tuple_type.kind().$ !== "Tuple") {
      let spans: SpanA[];
      const hir_node = fn_id.$ === "FnDef" ? this.tcx.hir_get_if_local(fn_id._0) : undefined;
      const fn_decl = hir_node !== undefined ? hirA.Node.fn_decl(hir_node) : undefined;
      const arg_ty = fn_decl !== undefined ? fn_decl.inputs[first_tupled_arg_index_usz] : undefined;
      if (arg_ty !== undefined) {
        const arg_def_span = arg_ty.span;
        spans = [call_span, arg_def_span];
      } else {
        spans = [call_span];
      }
      guar = struct_span_code_errA(
        this.dcx(),
        spans,
        // FIXME(splat): add a new error code before stabilization
        E0277,
        `cannot use \`rustc_splat\` attribute; the splatted argument type must be a tuple or unit, not a ${format_debugA(tuple_type.kind(), debug_TyKindA, PLAINA)} (${format_debugA(
          this.structurally_resolve_type(call_span, formal_input_tys[first_tupled_arg_index_usz]!).kind(),
          debug_TyKindA,
          PLAINA,
        )})`,
      ).emit_err();
    } else if (formal_input_tys.length !== provided_args.length) {
      // FIXME(splat): suggest alternative argument counts, if there are any
      guar = struct_span_code_errA(
        this.dcx(),
        call_span,
        E0057,
        `this splatted function takes ${formal_input_tys.length} arguments, but ${provided_args.length} ${provided_args.length === 1 ? "was" : "were"} provided`,
      ).emit_err();
    } else {
      guar = undefined;
    }
  } else {
    guar = undefined;
  }

  if (guar !== undefined) {
    return {
      new_err_code: err_code,
      untupled_formal_input_tys: this.err_args(provided_args.length, guar),
      untupled_expected_input_tys: undefined,
    };
  } else {
    // If splatting, record this call in a side-table, so MIR lowering can tuple the caller's arguments
    if (TupleArgumentsFlagA.is_splatted(tuple_arguments)) {
      // FIXME(const_trait_impl): does not enforce constness yet
      const count = unwrapA(tupled_args_count);
      // PORT: `usize -> u16` `try_into().unwrap()`.
      if (count > 0xffff) panicA("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
      this.write_splatted_call(call_expr.hir_id, fn_id, callee_generic_args, first_tupled_arg_index, count);
    }

    return {
      new_err_code: err_code,
      untupled_formal_input_tys: formal_input_tys,
      untupled_expected_input_tys: expected_input_tys,
    };
  }
};

/// If `unsized_fn_params` is active, check that unsized values are place expressions. Since
/// the removal of `unsized_locals` in <https://github.com/rust-lang/rust/pull/142911> we can't
/// store them in MIR locals as temporaries.
///
/// If `unsized_fn_params` is inactive, this will be checked in borrowck instead.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:849 check_place_expr_if_unsized
FnCtxt.prototype.check_place_expr_if_unsized = function (this: FnCtxt, ty: TyA, expr: hirA.Expr): void {
  if (this.tcx.features().unsized_fn_params() && !expr.is_syntactic_place_expr()) {
    this.require_type_is_sized(ty, expr.span, { $: "UnsizedNonPlaceExpr", _0: expr.span });
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:859 report_arg_errors
FnCtxt.prototype.report_arg_errors = function (
  this: FnCtxt,
  compatibility_diagonal: CompatibilityA[],
  formal_and_expected_inputs: [TyA, TyA][],
  provided_args: hirA.Expr[],
  c_variadic: boolean,
  err_code: ErrCodeA,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfoA,
  call_span: SpanA,
  call_expr: hirA.Expr,
  // FIXME(splat): when the feature design is settled, improve the errors here
  tuple_arguments: TupleArgumentsFlagA,
): ErrorGuaranteedA {
  // Next, let's construct the error

  const fn_call_diag_ctxt = FnCallDiagCtxt.new(
    this,
    compatibility_diagonal,
    formal_and_expected_inputs,
    provided_args,
    c_variadic,
    err_code,
    fn_id,
    call_span,
    call_expr,
    tuple_arguments,
  );

  // First, check if we just need to wrap some arguments in a tuple.
  {
    const err = fn_call_diag_ctxt.check_wrap_args_in_tuple();
    if (err !== undefined) {
      return err;
    }
  }

  {
    const fallback_error = fn_call_diag_ctxt.ensure_has_errors();
    if (fallback_error !== undefined) {
      return fallback_error;
    }
  }

  // Okay, so here's where it gets complicated in regards to what errors
  // we emit and how.
  // There are 3 different "types" of errors we might encounter.
  //   1) Missing/extra/swapped arguments
  //   2) Valid but incorrect arguments
  //   3) Invalid arguments
  //      - Currently I think this only comes up with `CyclicTy`

  // We first need to go through, remove those from (3) and emit those
  // as their own error, particularly since they're error code and
  // message is special. From what I can tell, we *must* emit these
  // here (vs somewhere prior to this function) since the arguments
  // become invalid *because* of how they get used in the function.
  // It is what it is.
  {
    const err = fn_call_diag_ctxt.filter_out_invalid_arguments();
    if (err !== undefined && fn_call_diag_ctxt.errors.length === 0) {
      // We're done if we found errors, but we already emitted them.
      return err;
    }
  }

  assertA(fn_call_diag_ctxt.errors.length !== 0, "assertion failed: !fn_call_diag_ctxt.errors.is_empty()");

  // Last special case: if there is only one "Incompatible" error, just emit that
  {
    const err = fn_call_diag_ctxt.check_single_incompatible();
    if (err !== undefined) {
      return err;
    }
  }

  // Okay, now that we've emitted the special errors separately, we
  // are only left missing/extra/swapped and mismatched arguments, both
  // can be collated pretty easily if needed.

  // Special case, we found an extra argument is provided, which is very common in practice.
  // but there is a obviously better removing suggestion compared to the current one,
  // try to find the argument with Error type, if we removed it all the types will become good,
  // then we will replace the current suggestion.
  fn_call_diag_ctxt.maybe_optimize_extra_arg_suggestion();

  const err = fn_call_diag_ctxt.initial_final_diagnostic();
  fn_call_diag_ctxt.suggest_confusable(err);

  // As we encounter issues, keep track of what we want to provide for the suggestion.

  const [suggestions, labels, suggestion_text] = fn_call_diag_ctxt.labels_and_suggestion_text(err);

  fn_call_diag_ctxt.label_generic_mismatches(err);
  fn_call_diag_ctxt.append_arguments_changes(suggestions);

  // If we have less than 5 things to say, it would be useful to call out exactly what's wrong
  if (labels.length <= 5) {
    for (const [span, label] of labels) {
      err.span_label(span, label);
    }
  }

  // Call out where the function is defined
  fn_call_diag_ctxt.label_fn_like(
    err,
    fn_id,
    fn_call_diag_ctxt.callee_ty,
    call_expr,
    undefined,
    undefined,
    fn_call_diag_ctxt.matched_inputs,
    fn_call_diag_ctxt.formal_and_expected_inputs,
    fn_call_diag_ctxt.call_metadata.is_method,
    tuple_arguments,
  );

  // And add a suggestion block for all of the parameters
  const suggestion_message = FnCallDiagCtxt.format_suggestion_text(err, suggestions, suggestion_text);
  if (suggestion_message !== undefined && !fn_call_diag_ctxt.call_is_in_macro()) {
    const [suggestion_span, suggestion_code] = fn_call_diag_ctxt.suggestion_code();

    err.span_suggestion_verbose(suggestion_span, suggestion_message, suggestion_code, ApplicabilityA.HasPlaceholders);
  }

  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:985 suggest_mut_addr
FnCtxt.prototype.suggest_mut_addr = function (this: FnCtxt, expected_ty: TyA, provided_ty: TyA, arg: hirA.Expr, err: DiagA): void {
  const ek = expected_ty.kind();
  const pk = provided_ty.kind();
  const ak = arg.kind;
  // The user provided `ptr::null()`, but the function expects
  // `ptr::null_mut()`.
  if (ek.$ === "RawPtr" && ek._1 === "Mut" && pk.$ === "RawPtr" && pk._1 === "Not" && ak.$ === "Call") {
    const callee = ak._0;
    if (callee.kind.$ === "Path" && callee.kind._0.$ === "Resolved") {
      const path = callee.kind._0._1;
      if (path.res.$ === "Def" && DefId_eqA_opt(this.tcx.get_diagnostic_item(symA.ptr_null), path.res._1)) {
        err.subdiagnostic(SuggestPtrNullMut_subdiagnostic({ span: arg.span }));
        return;
      }
    }
  }
  // &mut T expected, &T or *const/mut T found
  // suggestion: replace `&` or `&raw const/mut` with `&mut`
  if (ek.$ === "Ref" && ek._2 === "Mut") {
    const expected_ty = ek._1;
    let provided: [TyA, hirA.Expr] | undefined;
    if (pk.$ === "Ref" && pk._2 === "Not" && ak.$ === "AddrOf" && ak._0 === "Ref" && ak._1 === "Not") {
      provided = [pk._1, ak._2];
    } else if (pk.$ === "RawPtr" && ak.$ === "AddrOf" && ak._0 === "Raw") {
      provided = [pk._0, ak._2];
    }
    if (provided !== undefined && expected_ty === provided[0]) {
      const expr = provided[1];
      const span = SpanA.until(arg.span, expr.span);
      err.subdiagnostic(SuggestRefMut_subdiagnostic({ span }));
      return;
    }
  }
  // *mut T expected, *const T found
  // suggestion: replace `&raw const` with `&raw mut`
  if (ek.$ === "RawPtr" && ek._1 === "Mut" && pk.$ === "RawPtr" && pk._1 === "Not" && ak.$ === "AddrOf" && ak._0 === "Raw" && ak._1 === "Not") {
    const [expected_ty, provided_ty, expr] = [ek._0, pk._0, ak._2];
    if (expected_ty === provided_ty) {
      const span = SpanA.until(arg.span, expr.span);
      err.subdiagnostic(SuggestRawMut_subdiagnostic({ span }));
      return;
    }
  }
  // *mut T expected, &T found
  // suggestion: replace `&` `&mut`
  if (ek.$ === "RawPtr" && ek._1 === "Mut" && pk.$ === "Ref" && pk._2 === "Not" && ak.$ === "AddrOf" && ak._0 === "Ref" && ak._1 === "Not") {
    const [expected_ty, provided_ty, expr] = [ek._0, pk._1, ak._2];
    if (expected_ty === provided_ty) {
      const span = SpanA.until(arg.span, expr.span);
      err.subdiagnostic(SuggestRefMut_subdiagnostic({ span }));
      return;
    }
  }
};

// AST fragment checking
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1045 check_expr_lit
FnCtxt.prototype.check_expr_lit = function (this: FnCtxt, lit: hirA.Lit, lint_id: HirIdA, expected: ExpectationT): TyA {
  const tcx = this.tcx;

  const node = lit.node;
  switch (node.$) {
    case "Str":
      return TyA.new_static_str(tcx);
    case "ByteStr": {
      const v = node._0;
      return TyA.new_imm_ref(tcx, tcx.lifetimes.re_static, TyA.new_array(tcx, tcx.types.u8, ByteSymbolA.as_byte_str(v).length));
    }
    case "Byte":
      return tcx.types.u8;
    case "Char":
      return tcx.types.char;
    case "Int": {
      const lit_ty = node._1;
      switch (lit_ty.$) {
        case "Signed":
          return TyA.new_int(tcx, lit_ty._0);
        case "Unsigned":
          return TyA.new_uint(tcx, lit_ty._0);
        case "Unsuffixed": {
          const ty = ExpectationA.to_option(expected, this);
          let opt_ty: TyA | undefined;
          if (ty !== undefined) {
            const k = ty.kind();
            switch (k.$) {
              case "Int":
              case "Uint":
                opt_ty = ty;
                break;
              // These exist to direct casts like `0x61 as char` to use
              // the right integer type to cast from, instead of falling back to
              // i32 due to no further constraints.
              case "Char":
                opt_ty = tcx.types.u8;
                break;
              case "RawPtr":
                opt_ty = tcx.types.usize;
                break;
              case "FnDef":
              case "FnPtr":
                opt_ty = tcx.types.usize;
                break;
              case "Pat":
                if (k._0.is_integral()) {
                  // let layout = tcx
                  //     .layout_of(self.typing_env(self.param_env).as_query_input(ty))
                  //     .ok()?;
                  // assert!(!layout.uninhabited);
                  // match layout.backend_repr {
                  //     rustc_abi::BackendRepr::Scalar(scalar) => {
                  //         scalar.valid_range(&tcx).contains(u128::from(i.get())).then_some(ty)
                  //     }
                  //     _ => unreachable!(),
                  // }
                  return unported("rustc_hir_typeck::fn_ctxt::checks::FnCtxt::check_expr_lit: tcx.layout_of (rustc_middle ty/layout.rs, M4) for an integer literal expected to be a pattern type");
                }
                opt_ty = undefined;
                break;
              default:
                opt_ty = undefined;
            }
          }
          return opt_ty ?? this.next_int_var();
        }
      }
      break;
    }
    case "Float": {
      const lit_ty = node._1;
      if (lit_ty.$ === "Suffixed") {
        return TyA.new_float(tcx, lit_ty._0);
      } else {
        const ty = ExpectationA.to_option(expected, this);
        const opt_ty = ty !== undefined && ty.kind().$ === "Float" ? ty : undefined;
        return opt_ty ?? this.next_float_var(lit.span, lint_id);
      }
    }
    case "Bool":
      return tcx.types.bool;
    case "CStr":
      return TyA.new_imm_ref(tcx, tcx.lifetimes.re_static, EarlyBinderA.skip_binder(tcx.type_of(tcx.require_lang_item(LangItemA.CStr, lit.span)) as EarlyBinderA<TyA>));
    case "Err":
      return TyA.new_error(tcx, node._0);
  }
  return node satisfies never;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1108 check_struct_path
FnCtxt.prototype.check_struct_path = function (this: FnCtxt, qpath: hirA.QPath, hir_id: HirIdA): ResultA<[VariantDefA, TyA], ErrorGuaranteedA> {
  const path_span = hirA.QPath.span(qpath);
  const [def, ty] = this.finish_resolving_struct_path(qpath, path_span, hir_id);
  let variant: [VariantDefA, DefIdA, ReturnType<typeof FnCtxt.user_args_for_adt>] | undefined;
  if (def.$ === "Err") {
    const guar = this.dcx().span_delayed_bug(path_span, "`Res::Err` but no error emitted");
    this.set_tainted_by_errors(guar);
    return ErrA(guar);
  } else if (def.$ === "Def" && def._0.$ === "Variant") {
    const adt = ty.normalized.ty_adt_def();
    if (adt !== undefined) {
      variant = [adt.variant_of_res(def), adt.did(), FnCtxt.user_args_for_adt(ty)];
    } else {
      bugA(`unexpected type: ${format_debugA(ty.normalized, debug_TyA, PLAINA)}`);
    }
  } else if (
    (def.$ === "Def" && (def._0.$ === "Struct" || def._0.$ === "Union" || def._0.$ === "TyAlias" || def._0.$ === "AssocTy")) ||
    def.$ === "SelfTyParam" ||
    def.$ === "SelfTyAlias"
  ) {
    const adt = ty.normalized.ty_adt_def();
    if (adt !== undefined && !adt.is_enum()) {
      variant = [adt.non_enum_variant(), adt.did(), FnCtxt.user_args_for_adt(ty)];
    } else {
      variant = undefined;
    }
  } else {
    bugA(`unexpected definition: ${debug_ResA(def, PLAINA, debug_HirIdA)}`);
  }

  if (variant !== undefined) {
    const [variant_, did, { args, user_self_ty }] = variant;
    // debug!("check_struct_path: did={:?} args={:?}", did, args);

    // Register type annotation.
    this.write_user_type_annotation_from_args(hir_id, did, args, user_self_ty);

    // Check bounds on type arguments used in the path.
    this.add_required_obligations_for_hir(path_span, did, args, hir_id);

    return OkA([variant_, ty.normalized]);
  } else {
    const k = ty.normalized.kind();
    if (k.$ === "Error") {
      // E0071 might be caused by a spelling error, which will have
      // already caused an error message and probably a suggestion
      // elsewhere. Refrain from emitting more unhelpful errors here
      // (issue #88844).
      return ErrA(k._0);
    } else {
      return ErrA(
        struct_span_code_errA(this.dcx(), path_span, E0071, `expected struct, variant or union type, found ${ty.normalized.sort_string(this.tcx)}`)
          .with_span_label(path_span, "not a struct")
          .emit_err(),
      );
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1171 check_decl_initializer
FnCtxt.prototype.check_decl_initializer = function (this: FnCtxt, hir_id: HirIdA, pat: hirA.Pat, init: hirA.Expr): TyA {
  // FIXME(tschottdorf): `contains_explicit_ref_binding()` must be removed
  // for #42640 (default match binding modes).
  //
  // See #44848.
  const ref_bindings = pat.contains_explicit_ref_binding();

  const local_ty = this.local_ty(init.span, hir_id);
  if (ref_bindings !== undefined) {
    const m = ref_bindings;
    // Somewhat subtle: if we have a `ref` binding in the pattern,
    // we want to avoid introducing coercions for the RHS. This is
    // both because it helps preserve sanity and, in the case of
    // ref mut, for soundness (issue #23116). In particular, in
    // the latter case, we need to be clear that the type of the
    // referent for the reference that results is *equal to* the
    // type of the place it is referencing, and not some
    // supertype thereof.
    const init_ty = this.check_expr_with_needs(init, NeedsA.maybe_mut_place(m));
    const r = this.demand_eqtype_diag(init.span, local_ty, init_ty);
    if (r.$ === "Err") {
      const diag = r._0;
      this.emit_type_mismatch_suggestions(diag, init.peel_drop_temps(), init_ty, local_ty, undefined, undefined);
      diag.emit();
    }
    return init_ty;
  } else {
    return this.check_expr_coercible_to_type(init, local_ty, undefined);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1211 check_decl
FnCtxt.prototype.check_decl = function (this: FnCtxt, decl: DeclarationA): TyA {
  // Determine and write the type which we'll check the pattern against.
  const decl_ty = this.local_ty(decl.span, decl.hir_id);

  // Type check the initializer.
  if (decl.init !== undefined) {
    const init = decl.init;
    const init_ty = this.check_decl_initializer(decl.hir_id, decl.pat, init);
    this.overwrite_local_ty_if_err(decl.hir_id, decl.pat, init_ty);
  }

  // Does the expected pattern type originate from an expression and what is the span?
  let origin_expr: hirA.Expr | undefined;
  let ty_span: SpanA | undefined;
  if (decl.ty !== undefined) {
    [origin_expr, ty_span] = [undefined, decl.ty.span]; // Bias towards the explicit user type.
  } else if (decl.init !== undefined) {
    const init = decl.init;
    [origin_expr, ty_span] = [init, SpanA.find_ancestor_inside(init.span, decl.span) ?? init.span];
    // No explicit type; so use the scrutinee.
  } else {
    [origin_expr, ty_span] = [undefined, undefined]; // We have `let $pat;`, so the expected type is unconstrained.
  }

  // Type check the pattern. Override if necessary to avoid knock-on errors.
  this.check_pat_top(decl.pat, decl_ty, ty_span, origin_expr, decl.origin);
  const pat_ty = this.node_ty(decl.pat.hir_id);
  const pk = decl.pat.kind;
  if (decl.ty === undefined && decl.init === undefined && !((pk.$ === "Binding" && pk._3 === undefined) || pk.$ === "Wild")) {
    this.register_wf_obligation(decl_ty, decl.pat.span, { $: "WellFormed", _0: { $: "HirId", _0: decl.pat.hir_id } });
  }
  this.overwrite_local_ty_if_err(decl.hir_id, decl.pat, pat_ty);

  const blk = DeclOriginA.try_get_else(decl.origin);
  if (blk !== undefined) {
    const previous_diverges = this.diverges;
    const else_ty = this.check_expr_block(blk, ExpectationA.NoExpectation);
    const cause = this.cause(blk.span, { $: "LetElse" });
    const r = this.demand_eqtype_with_origin(cause, this.tcx.types.never, else_ty);
    if (r.$ === "Err") {
      r._0.emit();
    }
    this.diverges = previous_diverges;
  }
  return decl_ty;
};

/// Type check a `let` statement.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1259 check_decl_local
FnCtxt.prototype.check_decl_local = function (this: FnCtxt, local: hirA.LetStmt): void {
  GatherLocalsVisitor.gather_from_local(this, local);

  const ty = this.check_decl(Declaration_from_LetStmt(local));
  this.write_ty(local.hir_id, ty);
  if (local.pat.is_never_pattern()) {
    this.diverges = {
      $: "Always",
      span: local.pat.span,
      custom_note: "any code following a never pattern is unreachable",
    };
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1272 check_stmt
FnCtxt.prototype.check_stmt = function (this: FnCtxt, stmt: hirA.Stmt): void {
  // Don't do all the complex logic below for `DeclItem`.
  switch (stmt.kind.$) {
    case "Item":
      return;
    case "Let":
    case "Expr":
    case "Semi":
      break;
  }

  this.warn_if_unreachable(stmt.hir_id, stmt.span, "statement");

  // Hide the outer diverging flags.
  const old_diverges = this.diverges;
  this.diverges = DivergesA.Maybe;

  // PORT: re-read without the narrowing of the first `match` (upstream matches `stmt.kind` twice).
  const kind = stmt.kind as hirA.StmtKind;
  switch (kind.$) {
    case "Let": {
      const l = kind._0;
      this.check_decl_local(l);
      break;
    }
    // Ignore for now.
    case "Item":
      break;
    case "Expr": {
      const expr = kind._0;
      // Check with expected type of `()`.
      this.check_expr_has_type_or_error(expr, this.tcx.types.unit, (err) => {
        if (this.is_next_stmt_expr_continuation(stmt.hir_id) && (expr.kind.$ === "Match" || expr.kind.$ === "If")) {
          // We have something like `match () { _ => true } && true`. Suggest
          // wrapping in parentheses. We find the statement or expression
          // following the `match` (`&& true`) and see if it is something that
          // can reasonably be interpreted as a binop following an expression.
          err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded_surrounding(expr.span)));
        } else if (expr.can_have_side_effects()) {
          this.suggest_semicolon_at_end(expr.span, err);
        }
      });
      break;
    }
    case "Semi": {
      const expr = kind._0;
      const ty = this.check_expr(expr);
      this.check_place_expr_if_unsized(ty, expr);
      break;
    }
  }

  // Combine the diverging and `has_error` flags.
  this.diverges = DivergesA.bitor(this.diverges, old_diverges);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1316 check_block_no_value
FnCtxt.prototype.check_block_no_value = function (this: FnCtxt, blk: hirA.Block): void {
  const unit = this.tcx.types.unit;
  const ty = this.check_expr_block(blk, { $: "ExpectHasType", _0: unit });

  // if the block produces a `!` value, that can always be
  // (effectively) coerced to unit.
  if (!ty.is_never()) {
    this.demand_suptype(blk.span, unit, ty);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1327 check_expr_block
FnCtxt.prototype.check_expr_block = function (this: FnCtxt, blk: hirA.Block, expected: ExpectationT): TyA {
  // In some cases, blocks have just one exit, but other blocks
  // can be targeted by multiple breaks. This can happen both
  // with labeled blocks as well as when we desugar
  // a `try { ... }` expression.
  //
  // Example 1:
  //
  //    'a: { if true { break 'a Err(()); } Ok(()) }
  //
  // Here we would wind up with two coercions, one from
  // `Err(())` and the other from the tail expression
  // `Ok(())`. If the tail expression is omitted, that's a
  // "forced unit" -- unless the block diverges, in which
  // case we can ignore the tail expression (e.g., `'a: {
  // break 'a 22; }` would not force the type of the block
  // to be `()`).
  const coerce_to_ty = ExpectationA.coercion_target_type(expected, this, blk.span);
  const coerce = CoerceManyA.new(coerce_to_ty);

  const prev_diverges = this.diverges;
  const ctxt_: BreakableCtxtA = { coerce, may_break: false };

  const [ctxt] = this.with_breakable_ctxt(blk.hir_id, ctxt_, () => {
    for (const s of blk.stmts) {
      this.check_stmt(s);
    }

    // check the tail expression **without** holding the
    // `enclosing_breakables` lock below.
    const tail_expr_ty: [hirA.Expr, TyA] | undefined = blk.expr !== undefined ? [blk.expr, this.check_expr_with_expectation(blk.expr, expected)] : undefined;

    const enclosing_breakables = this.enclosing_breakables;
    const ctxt = enclosing_breakables.find_breakable(blk.hir_id);
    const coerce = unwrapA(ctxt.coerce);
    if (tail_expr_ty !== undefined) {
      const [tail_expr, tail_expr_ty_] = tail_expr_ty;
      const span = this.get_expr_coercion_span(tail_expr);
      const cause = this.cause(span, { $: "BlockTailExpression", _0: blk.hir_id, _1: hirA.MatchSource.Normal });
      const ty_for_diagnostic = coerce.merged_ty();
      // We use coerce_inner here because we want to augment the error
      // suggesting to wrap the block in square brackets if it might've
      // been mistaken array syntax
      coerce.coerce_inner(
        this,
        cause,
        tail_expr,
        tail_expr_ty_,
        (diag) => {
          this.suggest_block_to_brackets(diag, blk, tail_expr_ty_, ty_for_diagnostic);
        },
        false,
      );
    } else {
      // Subtle: if there is no explicit tail expression,
      // that is typically equivalent to a tail expression
      // of `()` -- except if the block diverges. In that
      // case, there is no value supplied from the tail
      // expression (assuming there are no other breaks,
      // this implies that the type of the block will be
      // `!`).
      //
      // #41425 -- label the implicit `()` as being the
      // "found type" here, rather than the "expected type".
      if (!DivergesA.is_always(this.diverges)) {
        // #50009 -- Do not point at the entire fn block span, point at the return type
        // span, as it is the cause of the requirement, and
        // `consider_hint_about_removing_semicolon` will point at the last expression
        // if it were a relevant part of the error. This improves usability in editors
        // that highlight errors inline.
        let sp = blk.span;
        let fn_span: SpanA | undefined = undefined;
        const fn_decl = this.get_fn_decl(blk.hir_id);
        if (fn_decl !== undefined) {
          const [fn_def_id, decl] = fn_decl;
          const ret_sp = hirA.FnRetTy.span(decl.output);
          const block_sp = this.parent_item_span(blk.hir_id);
          if (block_sp !== undefined) {
            // HACK: on some cases (`ui/liveness/liveness-issue-2163.rs`) the
            // output would otherwise be incorrect and even misleading. Make sure
            // the span we're aiming at correspond to a `fn` body.
            if (block_sp === blk.span) {
              sp = ret_sp;
              fn_span = this.tcx.def_ident_span(fn_def_id);
            }
          }
        }
        coerce.coerce_forced_unit(
          this,
          this.misc(sp),
          (err) => {
            const expected_ty = ExpectationA.only_has_type(expected, this);
            if (expected_ty !== undefined) {
              if (blk.stmts.length === 0 && blk.expr === undefined) {
                this.suggest_boxing_when_appropriate(err, blk.span, blk.hir_id, expected_ty, this.tcx.types.unit);
              }
              if (!this.err_ctxt().consider_removing_semicolon(blk, expected_ty, err)) {
                this.err_ctxt().consider_returning_binding(blk, expected_ty, err);
              }
              if (expected_ty === this.tcx.types.bool) {
                // If this is caused by a missing `let` in a `while let`,
                // silence this redundant error, as we already emit E0070.

                // Our block must be a `assign desugar local; assignment`
                const stmts = blk.stmts;
                if (
                  stmts.length === 2 &&
                  stmts[0]!.kind.$ === "Let" &&
                  stmts[0]!.kind._0.source === "AssignDesugar" &&
                  stmts[1]!.kind.$ === "Expr" &&
                  stmts[1]!.kind._0.kind.$ === "Assign"
                ) {
                  const lhs = stmts[1]!.kind._0.kind._0;
                  this.comes_from_while_condition(blk.hir_id, (_) => {
                    // We cannot suppress the error if the LHS of assignment
                    // is a syntactic place expression because E0070 would
                    // not be emitted by `check_lhs_assignable`.
                    const res = this.typeck_results.expr_ty_opt(lhs);

                    if (!lhs.is_syntactic_place_expr() || (res !== undefined && TypeVisitableExtA.references_error(res, fold_TyA))) {
                      err.downgrade_to_delayed_bug();
                    }
                  });
                }
              }
            }
            if (fn_span !== undefined) {
              err.span_label(fn_span, "implicitly returns `()` as its body has no tail or `return` expression");
            }
          },
          false,
        );
      }
    }
  });

  if (ctxt.may_break) {
    // If we can break from the block, then the block's exit is always reachable
    // (... as long as the entry is reachable) - regardless of the tail of the block.
    this.diverges = prev_diverges;
  }

  const ty = unwrapA(ctxt.coerce).complete(this);

  this.write_ty(blk.hir_id, ty);

  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1513 parent_item_span
FnCtxt.prototype.parent_item_span = function (this: FnCtxt, id: HirIdA): SpanA | undefined {
  const node = this.tcx.hir_node_by_def_id(this.tcx.hir_get_parent_item(id).def_id);
  let body_id: hirA.BodyId | undefined;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    body_id = node._0.kind.body;
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    body_id = node._0.kind._1;
  }
  if (body_id !== undefined) {
    const body = this.tcx.hir_body(body_id);
    if (body.value.kind.$ === "Block") {
      const block = body.value.kind._0;
      return block.span;
    }
  }
  return undefined;
};

/// If `expr` is a `match` expression that has only one non-`!` arm, use that arm's tail
/// expression's `Span`, otherwise return `expr.span`. This is done to give better errors
/// when given code like the following:
/// ```text
/// if false { return 0i32; } else { 1u32 }
/// //                               ^^^^ point at this instead of the whole `if` expression
/// ```
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1535 get_expr_coercion_span
FnCtxt.prototype.get_expr_coercion_span = function (this: FnCtxt, expr: hirA.Expr): SpanA {
  const check_in_progress = (elem: hirA.Expr): SpanA | undefined => {
    const ty = this.typeck_results.node_type_opt(elem.hir_id);
    if (ty === undefined || ty.is_never()) return undefined;
    switch (elem.kind.$) {
      // Point at the tail expression when possible.
      case "Block": {
        const block = elem.kind._0;
        return block.expr !== undefined ? block.expr.span : block.span;
      }
      default:
        return elem.span;
    }
  };

  if (expr.kind.$ === "If" && expr.kind._2 !== undefined) {
    const rslt = check_in_progress(expr.kind._2);
    if (rslt !== undefined) {
      return rslt;
    }
  }

  if (expr.kind.$ === "Match") {
    const arms = expr.kind._1;
    // PORT: the lazy `filter_map` iterator is advanced at most twice.
    let found: SpanA | undefined;
    let i = 0;
    const next = (): SpanA | undefined => {
      while (i < arms.length) {
        const r = check_in_progress(arms[i++]!.body);
        if (r !== undefined) return r;
      }
      return undefined;
    };
    found = next();
    if (found !== undefined) {
      if (next() === undefined) {
        return found;
      }
    }
  }

  return expr.span;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1564 overwrite_local_ty_if_err
FnCtxt.prototype.overwrite_local_ty_if_err = function (this: FnCtxt, hir_id: HirIdA, pat: hirA.Pat, ty: TyA): void {
  const reported = TypeVisitableExtA.error_reported(ty, fold_TyA);
  if (reported.$ === "Err") {
    const guar = reported._0;
    class OverwritePatternsWithError extends hirA.intravisit.Visitor {
      constructor(public pat_hir_ids: HirIdA[]) {
        super();
      }
      // impl<'tcx> Visitor<'tcx> for OverwritePatternsWithError
      // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1570 visit_pat
      override visit_pat(p: hirA.Pat): undefined {
        this.pat_hir_ids.push(p.hir_id);
        return hirA.intravisit.walk_pat(this, p);
      }
    }
    // Override the types everywhere with `err()` to avoid knock on errors.
    const err = TyA.new_error(this.tcx, guar);
    this.write_ty(hir_id, err);
    this.write_ty(pat.hir_id, err);
    const visitor = new OverwritePatternsWithError([]);
    hirA.intravisit.walk_pat(visitor, pat);
    // Mark all the subpatterns as `{type error}` as well. This allows errors for specific
    // subpatterns to be silenced.
    for (const hir_id of visitor.pat_hir_ids) {
      this.write_ty(hir_id, err);
    }
    this.locals.set(hir_id, err);
    this.locals.set(pat.hir_id, err);
  }
};

// Finish resolving a path in a struct expression or pattern `S::A { .. }` if necessary.
// The newly resolved definition is written into `type_dependent_defs`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1593 finish_resolving_struct_path
FnCtxt.prototype.finish_resolving_struct_path = function (this: FnCtxt, qpath: hirA.QPath, path_span: SpanA, hir_id: HirIdA): [ResA, LoweredTyA] {
  const { res: result, ty } = this.lowerer().lower_path_for_struct_expr(qpath, path_span, hir_id);
  switch (qpath.$) {
    case "Resolved": {
      const path = qpath._1;
      return [path.res, LoweredTyA.from_raw(this, path_span, ty)];
    }
    case "TypeRelative": {
      const ty_ = LoweredTyA.from_raw(this, path_span, ty);
      const resolution: ResultA<[DefKindA, DefIdA], ErrorGuaranteedA> =
        result.$ === "Ok" ? OkA([this.tcx.def_kind(ResA.def_id(result._0, debug_HirIdA)), ResA.def_id(result._0, debug_HirIdA)]) : result;

      // Write back the new resolution.
      this.write_resolution(hir_id, resolution);

      return [result.$ === "Ok" ? result._0 : ResA.Err, ty_];
    }
  }
};

/// Given a vector of fulfillment errors, try to adjust the spans of the
/// errors to more accurately point at the cause of the failure.
///
/// This applies to calls, methods, and struct expressions. This will also
/// try to deduplicate errors that are due to the same cause but might
/// have been created with different [`ObligationCause`][traits::ObligationCause]s.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1622 adjust_fulfillment_errors_for_expr_obligation
FnCtxt.prototype.adjust_fulfillment_errors_for_expr_obligation = function (this: FnCtxt, errors: FulfillmentErrorA[]): void {
  // Store a mapping from `(Span, Predicate) -> ObligationCause`, so that
  // other errors that have the same span and predicate can also get fixed,
  // even if their `ObligationCauseCode` isn't an `Expr*Obligation` kind.
  // This is important since if we adjust one span but not the other, then
  // we will have "duplicated" the error on the UI side.
  // PORT: `FxIndexSet<(Span, Predicate, ObligationCause)>`: a `KeyedSet` over the derived `Eq` (`intern_key`),
  // insertion-ordered like the `IndexSet`.
  const remap_cause = new KeyedSetA<[SpanA, PredicateA, ObligationCauseA]>(intern_keyA);
  const not_adjusted: FulfillmentErrorA[] = [];

  for (const error of errors) {
    const before_span = error.obligation.cause.span;
    if (this.adjust_fulfillment_error_for_expr_obligation(error) || before_span !== error.obligation.cause.span) {
      remap_cause.add([before_span, error.obligation.predicate, clone_ObligationCauseA(error.obligation.cause)]);
    } else {
      // If it failed to be adjusted once around, it may be adjusted
      // via the "remap cause" mapping the second time...
      not_adjusted.push(error);
    }
  }

  // Adjust any other errors that come from other cause codes, when these
  // errors are of the same predicate as one we successfully adjusted, and
  // when their spans overlap (suggesting they're due to the same root cause).
  //
  // This is because due to normalization, we often register duplicate
  // obligations with misc obligations that are basically impossible to
  // line back up with a useful WhereClauseInExpr.
  for (const error of not_adjusted) {
    for (const [span, predicate, cause] of remap_cause) {
      if (predicate === error.obligation.predicate && SpanA.contains(span, error.obligation.cause.span)) {
        error.obligation.cause = clone_ObligationCauseA(cause);
        continue;
      }
    }
  }
};

// ==== lane typeck-checks-b: checks.rs:1669..3710 ====
// - `IndexVec<ExpectedIdx | ProvidedIdx | GenericIdx, T>` are arrays indexed by the handle number; `.get(i)` is
//   `i < a.length ? a[i] : None`.
// - `impl Deref` of the four contexts: the field + `deref()` + the forwarders (`register_deref` above); a field of an
//   inner context reads through them (`this.formal_and_expected_inputs`, `this.tcx`, ...).
// - `FnParam`'s methods are on its companion (PORTING §8); `FnParam::display`'s `impl Display` is the string the
//   fn-local `D`'s `fmt` writes.

/** `struct MismatchedParam<'a>` (fn-local in `label_fn_like`). */
interface MismatchedParam {
  idx: ExpectedIdx;
  generic: GenericIdx;
  param: FnParamG;
  deps: ExpectedIdx[];
}

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:1670 label_fn_like
FnCtxt.prototype.label_fn_like = function (
  this: FnCtxt,
  err: Diag,
  // Lowering info if a splatted function is being called.
  callable_id: SplatLoweringInfo,
  callee_ty: Ty | undefined,
  call_expr: hir.Expr,
  expected_ty: Ty | undefined,
  // A specific argument should be labeled, instead of all of them
  expected_idx: number | undefined,
  matched_inputs: (ProvidedIdx | undefined)[],
  formal_and_expected_inputs: [Ty, Ty][],
  is_method: boolean,
  tuple_arguments: TupleArgumentsFlag,
): void {
  if (callable_id.$ !== "FnDef") {
    // FIXME(FnPtr, splat): Handle FnPtr types and splatting here
    return;
  }
  let def_id: DefId = callable_id._0;

  // If we're calling a method of a Fn/FnMut/FnOnce trait object implicitly
  // (eg invoking a closure) we want to point at the underlying callable,
  // not the method implicitly invoked (eg call_once).
  // TupleAllCallArgs is set only when this is an implicit call `my_closure(...)` rather
  // than explicit `my_closure.call(...)`.
  let assoc_item: AssocItem | undefined;
  let maybe_trait_item_def_id: Result<DefId, ErrorGuaranteed>;
  let call_kind: ClosureKind | undefined;
  if (
    tuple_arguments.$ === "TupleAllCallArgs" &&
    (assoc_item = this.tcx.opt_associated_item(def_id)) !== undefined &&
    // Since this is an associated item, it might point at either an impl or a trait item.
    // We want it to always point to the trait item.
    // If we're pointing at an inherent function, we don't need to do anything,
    // so we fetch the parent and verify if it's a trait item.
    (maybe_trait_item_def_id = AssocItem.trait_item_or_self(assoc_item)).$ === "Ok" &&
    // Just an easy way to check "trait_def_id == Fn/FnMut/FnOnce"
    (call_kind = this.tcx.fn_trait_kind_from_def_id(this.tcx.parent(maybe_trait_item_def_id._0))) !== undefined &&
    callee_ty !== undefined
  ) {
    const call_kind_ = call_kind;
    const callee_ty_ = callee_ty.peel_refs();
    const k = callee_ty_.kind();
    if (k.$ === "Param") {
      const param = (this.tcx.generics_of(this.body_def_id) as Generics).type_param(k._0, this.tcx);
      if (GenericParamDefKind.is_synthetic(param.kind)) {
        // if it's `impl Fn() -> ..` then just fall down to the def-id based logic
        def_id = param.def_id;
      } else {
        // Otherwise, find the predicate that makes this generic callable,
        // and point at that.
        const instantiated = GenericClauses.instantiate_identity(this.tcx.explicit_clauses_of(this.body_def_id) as GenericClauses, this.tcx);
        // FIXME(compiler-errors): This could be problematic if something has two
        // fn-like predicates with different args, but callable types really never
        // do that, so it's OK.
        for (const [clause, span] of instantiated) {
          const ck = Binder.skip_binder(Unnormalized.skip_norm_wip(clause).kind());
          if (ck.$ === "Trait" && TraitClause.self_ty(ck._0).peel_refs() === callee_ty_ && this.tcx.is_fn_trait(TraitClause.def_id(ck._0))) {
            err.span_note(span, "callable defined here");
            return;
          }
        }
      }
    } else if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      def_id = k._1.kind.def_id;
    } else if (k.$ === "Closure" || k.$ === "FnDef") {
      def_id = k._0;
    } else {
      // Look for a user-provided impl of a `Fn` trait, and point to it.
      const new_def_id = this.probe((_): DefId | undefined => {
        const fn_trait = this.tcx.fn_trait_kind_to_def_id(call_kind_);
        if (fn_trait === undefined) return undefined;
        const trait_ref = TraitRef.new(as_interner(this.tcx), fn_trait, [GenericArg.from_Ty(callee_ty_), GenericArg.from_Ty(this.next_ty_var(DUMMY_SP))]);
        const obligation = Obligation.new(this.tcx, ObligationCause.dummy(), this.param_env, trait_ref, TraitClause.upcast_from_TraitRef);
        // PORT: `SelectionContext::new(self)`: `&InferCtxt` is the deref coercion of `self`.
        const sel = SelectionContext.new(this.infcx).select(obligation);
        if (sel.$ === "Ok" && sel._0 !== undefined && sel._0.$ === "UserDefined") {
          return sel._0._0.impl_def_id;
        }
        return undefined;
      });
      if (new_def_id === undefined) return;
      def_id = new_def_id;
    }
  }

  let def_span: Span | undefined;
  let e: hir.Node | undefined;
  if ((def_span = this.tcx.def_ident_span(def_id)) !== undefined && !Span.is_dummy(def_span)) {
    const spans: MultiSpan = MultiSpan.from_span(def_span);
    const info = this.get_hir_param_info(def_id, is_method);
    if (info !== undefined) {
      const [params_with_generics, hir_generics] = info;

      // FIXME(splat): fix the generic mismatch earlier, so it doesn't reach here
      if (!TupleArgumentsFlag.is_splatted(tuple_arguments)) {
        // debug_assert_eq!(params_with_generics.len(), matched_inputs.len());
      }
      // Gather all mismatched parameters with generics.
      const mismatched_params: MismatchedParam[] = [];
      let use_splat_fallback = false;
      if (expected_idx !== undefined) {
        const expected_idx_ = ExpectedIdx.from_usize(expected_idx);
        const entry = expected_idx_ < params_with_generics.length ? params_with_generics[expected_idx_]! : undefined;
        if (entry !== undefined && entry[0] !== undefined) {
          mismatched_params.push({ idx: expected_idx_, generic: entry[0], param: entry[1], deps: [] });
        } else if (entry !== undefined) {
          // Still mark the mismatched parameter
          spans.push_span_label(FnParam.span(entry[1]), "");
        } else {
          if (TupleArgumentsFlag.is_splatted(tuple_arguments)) {
            // FIXME(splat): when the arg is splatted, adjust its index, to handle the type mismatch properly
            use_splat_fallback = true;
          } else {
            span_bug(this.tcx.def_span(def_id), `arg index ${ExpectedIdx.as_usize(expected_idx_)} out of bounds for method with ${params_with_generics.length} inputs`);
          }
        }
      }

      if (expected_idx === undefined || use_splat_fallback) {
        const n = Math.min(params_with_generics.length, matched_inputs.length);
        for (let i = 0; i < n; i++) {
          const idx = ExpectedIdx.from_usize(i);
          const [generic, param] = params_with_generics[i]!;
          const matched_idx = matched_inputs[i];
          if (matched_idx !== undefined) {
            continue;
          } else if (generic !== undefined) {
            mismatched_params.push({ idx, generic, param, deps: [] });
          } else {
            // Still mark mismatched parameters
            spans.push_span_label(FnParam.span(param), "");
          }
        }
      }

      if (mismatched_params.length !== 0) {
        // For each mismatched parameter, create a two-way link to each matched parameter
        // of the same type.
        const dependants: number[][] = Array.from({ length: params_with_generics.length }, (): number[] => []);
        const generic_uses: ExpectedIdx[][] = Array.from({ length: hir_generics.params.length }, (): ExpectedIdx[] => []);
        for (let idx = 0; idx < mismatched_params.length; idx++) {
          const param = mismatched_params[idx]!;
          const n = Math.min(params_with_generics.length, matched_inputs.length);
          for (let o = 0; o < n; o++) {
            const other_idx = ExpectedIdx.from_usize(o);
            const other_generic = params_with_generics[o]![0];
            const other_matched_idx = matched_inputs[o];
            if (other_generic !== undefined && other_generic === param.generic && other_matched_idx !== undefined) {
              generic_uses[param.generic]!.push(param.idx, other_idx);
              dependants[other_idx]!.push(idx);
              param.deps.push(other_idx);
            }
          }
        }

        // Highlight each mismatched type along with a note about which other parameters
        // the type depends on (if any).
        for (const param of mismatched_params) {
          const deps_list = listify(param.deps, (dep) => FnParam.display(params_with_generics[dep]![1], ExpectedIdx.as_usize(dep)));
          if (deps_list !== undefined) {
            spans.push_span_label(
              FnParam.span(param.param),
              `this parameter needs to match the ${this.deeply_resolve_ignoring_regions(formal_and_expected_inputs[param.deps[0]!]![1], fold_Ty).sort_string(this.tcx)} type of ${deps_list}`,
            );
          } else {
            // Still mark mismatched parameters
            spans.push_span_label(FnParam.span(param.param), "");
          }
        }
        // Highlight each parameter being depended on for a generic type.
        const n = Math.min(params_with_generics.length, dependants.length, formal_and_expected_inputs.length);
        for (let i = 0; i < n; i++) {
          const param = params_with_generics[i]![1];
          const deps = dependants[i]!;
          const expected_ty = formal_and_expected_inputs[i]![1];
          const deps_list = listify(deps, (dep) => {
            const param = mismatched_params[dep]!;
            return FnParam.display(param.param, ExpectedIdx.as_usize(param.idx));
          });
          if (deps_list !== undefined) {
            spans.push_span_label(
              FnParam.span(param),
              `${deps_list} need${pluralize(deps.length !== 1 ? 1 : 0)} to match the ${this.deeply_resolve_ignoring_regions(expected_ty, fold_Ty).sort_string(this.tcx)} type of this parameter`,
            );
          }
        }
        // Highlight each generic parameter in use.
        const m = Math.min(hir_generics.params.length, generic_uses.length);
        for (let i = 0; i < m; i++) {
          const param = hir_generics.params[i]!;
          // `uses.sort(); uses.dedup();`
          const uses = [...new Set(generic_uses[i]!.sort((a, b) => a - b))];
          generic_uses[i] = uses;
          const param_list = listify(uses, (idx) => FnParam.display(params_with_generics[idx]![1], ExpectedIdx.as_usize(idx)));
          if (param_list !== undefined) {
            spans.push_span_label(
              param.span,
              `${param_list} ${uses.length === 2 ? "both" : "all"} reference this parameter \`${Symbol.as_str(hir.ParamName.ident(param.name).name)}\``,
            );
          }
        }
      }
    }
    err.span_note(spans, `${this.tcx.def_descr(def_id)} defined here`);
    const dk = this.tcx.def_kind(def_id);
    if (
      (dk.$ === "Fn" || dk.$ === "AssocFn") &&
      FnSig.output(Unnormalized.skip_binder(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>))).kind().$ === "Param"
    ) {
      const parent = this.tcx.hir_get_parent_item(call_expr.hir_id).def_id;
      const node = this.tcx.hir_node_by_def_id(parent);
      let found: [hir.FnRetTy, hir.BodyId] | undefined;
      if (node.$ === "Item" && node._0.kind.$ === "Fn") {
        found = [node._0.kind.sig.decl.output, node._0.kind.body];
      } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && node._0.kind._1.$ === "Provided") {
        found = [node._0.kind._0.decl.output, node._0.kind._1._0];
      } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
        found = [node._0.kind._0.decl.output, node._0.kind._1];
      } else {
        found = undefined;
      }
      if (found !== undefined) {
        const [output, body_id] = found;
        const expr = this.tcx.hir_body(body_id).value;
        let ret: hir.Node;
        if (
          expr.peel_blocks().span === call_expr.span ||
          ((ret = this.tcx.parent_hir_node(call_expr.hir_id)).$ === "Expr" && ret._0.kind.$ === "Ret")
        ) {
          err.span_label(
            hir.FnRetTy.span(output),
            output.$ === "DefaultReturn"
              ? `this implicit \`()\` return type influences the call expression's return type`
              : "this return type influences the call expression's return type",
          );
        }
      }
    }
  } else if ((e = this.tcx.hir_get_if_local(def_id)) !== undefined && e.$ === "Expr" && e._0.kind.$ === "Closure") {
    const body = e._0.kind._0.body;
    let param: hir.Param | undefined;
    if (expected_idx !== undefined) {
      const params = this.tcx.hir_body(body).params;
      param = expected_idx < params.length ? params[expected_idx] : undefined;
    }
    let kind: string;
    let span: Span;
    if (param !== undefined) {
      // Try to find earlier invocations of this closure to find if the type mismatch
      // is because of inference. If we find one, point at them.
      const call_finder = new FindClosureArg(this.tcx, []);
      const parent_def_id = this.tcx.hir_get_parent_item(call_expr.hir_id).def_id;
      const node = this.tcx.hir_node_by_def_id(parent_def_id);
      switch (node.$) {
        case "Item":
          call_finder.visit_item(node._0);
          break;
        case "TraitItem":
          call_finder.visit_trait_item(node._0);
          break;
        case "ImplItem":
          call_finder.visit_impl_item(node._0);
          break;
        default:
          break;
      }
      const typeck = this.typeck_results;
      for (const [rcvr, args] of call_finder.calls) {
        let rcvr_ty: Ty | undefined;
        let rk: ReturnType<Ty["kind"]>;
        let arg: hir.Expr | undefined;
        let arg_ty: Ty | undefined;
        if (
          OwnerId_eq(rcvr.hir_id.owner, typeck.hir_owner) &&
          (rcvr_ty = typeck.node_type_opt(rcvr.hir_id)) !== undefined &&
          (rk = rcvr_ty.kind()).$ === "Closure" &&
          DefId_eq(def_id, rk._0) &&
          expected_idx !== undefined &&
          (arg = expected_idx < args.length ? args[expected_idx] : undefined) !== undefined &&
          (arg_ty = typeck.node_type_opt(arg.hir_id)) !== undefined &&
          expected_ty !== undefined &&
          this.can_eq(this.param_env, arg_ty, expected_ty, ToTrace_Ty)
        ) {
          const sp: MultiSpan = MultiSpan.from_spans([arg.span]);
          sp.push_span_label(arg.span, `expected because this argument is of type \`${display_Ty(arg_ty)}\``);
          sp.push_span_label(rcvr.span, "in this closure call");
          err.span_note(sp, `expected because the closure was earlier called with an argument of type \`${display_Ty(arg_ty)}\``);
          break;
        }
      }

      [kind, span] = ["closure parameter", param.span];
    } else {
      [kind, span] = ["closure", this.tcx.def_span(def_id)];
    }
    err.span_note(span, `${kind} defined here`);
  } else {
    err.span_note(this.tcx.def_span(def_id), `${this.tcx.def_descr(def_id)} defined here`);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2022 label_generic_mismatches
FnCtxt.prototype.label_generic_mismatches = function (
  this: FnCtxt,
  err: Diag,
  // Lowering info if a splatted function is being called.
  callable_id: SplatLoweringInfo,
  matched_inputs: (ProvidedIdx | undefined)[],
  provided_arg_tys: [Ty, Span][],
  formal_and_expected_inputs: [Ty, Ty][],
  is_method: boolean,
  is_splat: boolean,
): void {
  if (callable_id.$ !== "FnDef") {
    // FIXME(FnPtr, splat): Handle FnPtr types and splatting here
    return;
  }
  const def_id = callable_id._0;

  const info = this.get_hir_param_info(def_id, is_method);
  if (info !== undefined) {
    const [params_with_generics] = info;
    // FIXME(splat): fix the generic mismatch earlier, so it doesn't reach here
    if (!is_splat) {
      // debug_assert_eq!(params_with_generics.len(), matched_inputs.len());
    }
    for (let i = 0; i < params_with_generics.length; i++) {
      const idx = ExpectedIdx.from_usize(i);
      const generic_param = params_with_generics[i]![0];
      if (matched_inputs[idx] === undefined) {
        continue;
      }

      const provided_idx = ExpectedIdx.to_provided_idx(idx);
      if (!(provided_idx < provided_arg_tys.length)) {
        continue;
      }
      const [, matched_arg_span] = provided_arg_tys[provided_idx]!;

      if (generic_param === undefined) {
        continue;
      }

      let idxs_matched = 0;
      for (let o = 0; o < params_with_generics.length; o++) {
        const other_idx = ExpectedIdx.from_usize(o);
        const other_generic_param = params_with_generics[o]![0];
        const keep = ((): boolean => {
          if (other_idx === idx) {
            return false;
          }
          if (other_generic_param === undefined) {
            return false;
          }
          if (matched_inputs[other_idx] !== undefined) {
            return false;
          }
          return other_generic_param === generic_param;
        })();
        if (keep) idxs_matched++;
      }

      if (idxs_matched === 0) {
        continue;
      }

      const expected_display_type = this.deeply_resolve_ignoring_regions(formal_and_expected_inputs[idx]![1], fold_Ty).sort_string(this.tcx);
      const label =
        idxs_matched === params_with_generics.length - 1
          ? `expected all arguments to be this ${expected_display_type} type because they need to match the type of this parameter`
          : `expected some other arguments to be ${a_or_an(expected_display_type)} ${expected_display_type} type to match the type of this parameter`;

      err.span_label(matched_arg_span, label);
    }
  }
};

/// Returns the parameters of a function, with their generic parameters if those are the full
/// type of that parameter.
///
/// Returns `None` if the body is not a named function (e.g. a closure).
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2102 get_hir_param_info
FnCtxt.prototype.get_hir_param_info = function (this: FnCtxt, def_id: DefId, is_method: boolean): [[GenericIdx | undefined, FnParamG][], hir.Generics] | undefined {
  const node = this.tcx.hir_get_if_local(def_id);
  if (node === undefined) return undefined;
  let sig: hir.FnSig;
  let generics: hir.Generics;
  let body_id: hir.BodyId | undefined;
  let params: readonly (Ident | undefined)[] | undefined;
  if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    const trait_fn = node._0.kind._1;
    switch (trait_fn.$) {
      case "Required":
        [sig, generics, body_id, params] = [node._0.kind._0, node._0.generics, undefined, trait_fn._0];
        break;
      case "Provided":
        [sig, generics, body_id, params] = [node._0.kind._0, node._0.generics, trait_fn._0, undefined];
        break;
    }
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    [sig, generics, body_id, params] = [node._0.kind._0, node._0.generics, node._0.kind._1, undefined];
  } else if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    [sig, generics, body_id, params] = [node._0.kind.sig, node._0.kind.generics, node._0.kind.body, undefined];
  } else if (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") {
    [sig, generics, body_id, params] = [node._0.kind._0, node._0.kind._2, undefined, node._0.kind._1];
  } else {
    return undefined;
  }

  // Make sure to remove both the receiver and variadic argument. Both are removed
  // when matching parameter types.
  const start = is_method ? 1 : 0;
  if (start > sig.decl.inputs.length) return undefined;
  const fn_inputs: (GenericIdx | undefined)[] = sig.decl.inputs.slice(start).map((param): GenericIdx | undefined => {
    if (param.kind.$ === "Path" && param.kind._0.$ === "Resolved" && param.kind._0._1.res.$ === "Def") {
      const res_def_id = param.kind._0._1.res._1;
      const pos = generics.params.findIndex((param) => DefId_eq(LocalDefId.to_def_id(param.def_id), res_def_id));
      return pos === -1 ? undefined : GenericIdx.from_usize(pos);
    } else {
      return undefined;
    }
  });
  /** `params.get(is_method as usize..params.len() - sig.decl.c_variadic() as usize)` */
  const get_range = <T>(params: readonly T[]): readonly T[] | undefined => {
    const lo = is_method ? 1 : 0;
    const hi = params.length - (sig.decl.c_variadic() ? 1 : 0);
    // PORT: `params.len() - 1` on an empty slice wraps in release builds, and `get` returns `None`.
    if (hi < 0 || lo > hi || hi > params.length) return undefined;
    return params.slice(lo, hi);
  };
  if ((body_id !== undefined && params !== undefined) || (body_id === undefined && params === undefined)) {
    return unreachable();
  } else if (body_id !== undefined) {
    const params_ = get_range(this.tcx.hir_body(body_id).params);
    if (params_ === undefined) return undefined;
    // debug_assert_eq!(params.len(), fn_inputs.len());
    const n = Math.min(fn_inputs.length, params_.length);
    const out: [GenericIdx | undefined, FnParamG][] = [];
    for (let i = 0; i < n; i++) out.push([fn_inputs[i], { $: "Param", _0: params_[i]! }]);
    return [out, generics];
  } else {
    const params_ = get_range(params!);
    if (params_ === undefined) return undefined;
    // debug_assert_eq!(params.len(), fn_inputs.len());
    const n = Math.min(fn_inputs.length, params_.length);
    const out: [GenericIdx | undefined, FnParamG][] = [];
    for (let i = 0; i < n; i++) out.push([fn_inputs[i], { $: "Ident", _0: params_[i] }]);
    return [out, generics];
  }
};

// `struct FindClosureArg<'tcx>`
export class FindClosureArg extends hir.intravisit.Visitor {
  // impl<'tcx> Visitor<'tcx> for FindClosureArg<'tcx>
  // type NestedFilter = rustc_middle::hir::nested_filter::All;
  override NestedFilter = All;

  constructor(
    public tcx: TyCtxt,
    public calls: [hir.Expr, readonly hir.Expr[]][],
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2180 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2184 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (ex.kind.$ === "Call") {
      this.calls.push([ex.kind._0, ex.kind._1]);
    }
    hir.intravisit.walk_expr(this, ex);
  }
}

// impl FnParam<'_>
export type FnParam = FnParamG;
export const FnParam = {
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2199 span
  span(self: FnParamG): Span {
    switch (self.$) {
      case "Param":
        return self._0.span;
      case "Ident": {
        const ident = self._0;
        if (ident !== undefined) {
          return ident.span;
        } else {
          return DUMMY_SP;
        }
      }
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2212 display
  display(self: FnParamG, idx: number): string {
    // `struct D<'a>(FnParam<'a>, usize);` + `impl fmt::Display for D<'_>`
    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2215 fmt
    const fmt = (d0: FnParamG, d1: number): string => {
      // A "unique" param name is one that (a) exists, and (b) is guaranteed to be unique
      // among the parameters, i.e. `_` does not count.
      let unique_name: SymbolT | undefined;
      if (d0.$ === "Param" && d0._0.pat.kind.$ === "Binding") {
        unique_name = d0._0.pat.kind._2.name;
      } else if (d0.$ === "Ident" && d0._0 !== undefined && d0._0.name !== kw.Underscore) {
        unique_name = d0._0.name;
      } else {
        unique_name = undefined;
      }
      if (unique_name !== undefined) {
        return `\`${Symbol.as_str(unique_name)}\``;
      } else {
        return `parameter #${d1 + 1}`;
      }
    };
    return fmt(self, idx);
  },
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2252 deref
FnCallDiagCtxt.prototype.deref = function (this: FnCallDiagCtxt): ArgMatchingCtxt {
  return this.arg_matching_ctxt;
};

// impl<'a, 'tcx> FnCallDiagCtxt<'a, 'tcx>

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2264 new
(FnCallDiagCtxt as unknown as { new: typeof FnCallDiagCtxt.new }).new = function (
  arg: FnCtxt,
  compatibility_diagonal: Compatibility[],
  formal_and_expected_inputs: [Ty, Ty][],
  provided_args: hir.Expr[],
  c_variadic: boolean,
  err_code: ErrCode,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfo,
  call_span: Span,
  call_expr: hir.Expr,
  tuple_arguments: TupleArgumentsFlag,
): FnCallDiagCtxt {
  const arg_matching_ctxt = ArgMatchingCtxt.new(arg, compatibility_diagonal, formal_and_expected_inputs, provided_args, c_variadic, err_code, fn_id, call_span, call_expr, tuple_arguments);

  // The algorithm here is inspired by levenshtein distance and longest common subsequence.
  // We'll try to detect 4 different types of mistakes:
  // - An extra parameter has been provided that doesn't satisfy *any* of the other inputs
  // - An input is missing, which isn't satisfied by *any* of the other arguments
  // - Some number of arguments have been provided in the wrong order
  // - A type is straight up invalid
  const [errors, matched_inputs] = ArgMatrix.new(arg_matching_ctxt.provided_args.length, arg_matching_ctxt.formal_and_expected_inputs.length, (provided, expected) =>
    arg_matching_ctxt.check_compatible(provided, expected),
  ).find_errors();

  return new FnCallDiagCtxt(arg_matching_ctxt, errors, matched_inputs);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2306 check_wrap_args_in_tuple
FnCallDiagCtxt.prototype.check_wrap_args_in_tuple = function (this: FnCallDiagCtxt): ErrorGuaranteed | undefined {
  const first = this.first_incompatible_error();
  if (first !== undefined) {
    const [mismatch_idx, terr] = first;
    // Is the first bad expected argument a tuple?
    // Do we have as many extra provided arguments as the tuple's length?
    // If so, we might have just forgotten to wrap some args in a tuple.
    const mismatch_expected_idx = ProvidedIdx.to_expected_idx(mismatch_idx);
    const k = mismatch_expected_idx < this.formal_and_expected_inputs.length ? this.formal_and_expected_inputs[mismatch_expected_idx]![1].kind() : undefined;
    if (
      k !== undefined &&
      k.$ === "Tuple" &&
      // If the tuple is unit, we're not actually wrapping any arguments.
      k._0.length !== 0 &&
      this.provided_arg_tys.length === this.formal_and_expected_inputs.length - 1 + k._0.length
    ) {
      const tys = k._0;
      // Wrap up the N provided arguments starting at this position in a tuple.
      const provided_args_to_tuple_ = this.provided_arg_tys.slice(mismatch_idx);
      assert(tys.length <= provided_args_to_tuple_.length, "mid > len");
      const provided_args_to_tuple = provided_args_to_tuple_.slice(0, tys.length);
      const provided_args_after_tuple = provided_args_to_tuple_.slice(tys.length);
      const provided_as_tuple = Ty.new_tup_from_iter(
        this.tcx,
        provided_args_to_tuple.map(([ty]) => ty),
      );

      let satisfied = true;
      // Check if the newly wrapped tuple + rest of the arguments are compatible.
      const expected_rest = this.formal_and_expected_inputs.slice(mismatch_expected_idx);
      const provided_rest = [provided_as_tuple, ...provided_args_after_tuple.map(([ty]) => ty)];
      const n = Math.min(expected_rest.length, provided_rest.length);
      for (let i = 0; i < n; i++) {
        const [, expected_ty] = expected_rest[i]!;
        const provided_ty = provided_rest[i]!;
        if (!this.may_coerce(provided_ty, expected_ty)) {
          satisfied = false;
          break;
        }
      }

      // If they're compatible, suggest wrapping in an arg, and we're done!
      // Take some care with spans, so we don't suggest wrapping a macro's
      // innards in parenthesis, for example.
      if (satisfied && provided_args_to_tuple.length >= 1) {
        // `&[(_, hi @ lo)] | &[(_, lo), .., (_, hi)]`
        const lo = provided_args_to_tuple[0]![1];
        const hi = provided_args_to_tuple[provided_args_to_tuple.length - 1]![1];
        let err: Diag;
        if (tys.length === 1) {
          // A tuple wrap suggestion actually occurs within,
          // so don't do anything special here.
          err = this.err_ctxt().report_and_explain_type_error(
            this.arg_matching_ctxt.args_ctxt.call_ctxt.mk_trace(lo, this.formal_and_expected_inputs[mismatch_expected_idx]!, this.provided_arg_tys[mismatch_idx]![0]),
            this.param_env,
            terr,
          );
          const call_name = this.call_metadata.call_name;
          err.span_label(this.call_metadata.full_call_span, `arguments to this ${call_name} are incorrect`);
        } else {
          const call_name = this.call_metadata.call_name;
          err = this.dcx().struct_span_err(
            this.arg_matching_ctxt.args_ctxt.call_metadata.full_call_span,
            `${call_name} takes ${this.arg_matching_ctxt.args_ctxt.c_variadic ? "at least " : ""}${potentially_plural_count(this.formal_and_expected_inputs.length, "argument")} but ${potentially_plural_count(this.provided_args.length, "argument")} ${pluralize("was", this.provided_args.length)} supplied`,
          );
          err.code(this.err_code);
          err.multipart_suggestion(
            "wrap these arguments in parentheses to construct a tuple",
            [
              [Span.shrink_to_lo(lo), "("],
              [Span.shrink_to_hi(hi), ")"],
            ],
            Applicability.MachineApplicable,
          );
        }
        this.arg_matching_ctxt.args_ctxt.call_ctxt.fn_ctxt.label_fn_like(
          err,
          this.fn_id,
          this.callee_ty,
          this.call_expr,
          undefined,
          ProvidedIdx.as_usize(mismatch_idx),
          this.matched_inputs,
          this.formal_and_expected_inputs,
          this.call_metadata.is_method,
          this.tuple_arguments,
        );
        this.suggest_confusable(err);
        return err.emit_err();
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2418 ensure_has_errors
FnCallDiagCtxt.prototype.ensure_has_errors = function (this: FnCallDiagCtxt): ErrorGuaranteed | undefined {
  if (this.errors.length === 0) {
    // `if cfg!(debug_assertions) { span_bug!(self.call_metadata.error_span, "expected errors from argument matrix"); }
    // else { .. }`: rustc ships without debug assertions.
    {
      const err = this.dcx().create_err(ArgMismatchIndeterminate_diagnostic({ span: this.call_metadata.error_span }));
      this.arg_matching_ctxt.suggest_confusable(err);
      return err.emit_err();
    }
  }

  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2434 detect_dotdot
FnCallDiagCtxt.prototype.detect_dotdot = function (this: FnCallDiagCtxt, err: Diag, ty: Ty, expr: hir.Expr): void {
  const k = ty.kind();
  if (
    k.$ === "Adt" &&
    this.tcx.is_lang_item(k._0.did(), LangItem.RangeFull) &&
    hir.is_range_literal(expr) &&
    expr.kind.$ === "Struct" &&
    expr.kind._1.length === 0 &&
    this.tcx.qpath_is_lang_item(expr.kind._0, LangItem.RangeFull)
  ) {
    // We have `Foo(a, .., c)`, where the user might be trying to use the "rest" syntax
    // from default field values, which is not supported on tuples.
    const explanation = this.tcx.features().default_field_values()
      ? "this is only supported on non-tuple struct literals"
      : this.tcx.sess.is_nightly_build()
        ? "this is only supported on non-tuple struct literals when `#![feature(default_field_values)]` is enabled"
        : "this is not supported";
    const msg = `you might have meant to use \`..\` to skip providing a value for expected fields, but ${explanation}; it is instead interpreted as a \`std::ops::RangeFull\` literal`;
    err.span_help(expr.span, msg);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2460 filter_out_invalid_arguments
FnCallDiagCtxt.prototype.filter_out_invalid_arguments = function (this: FnCallDiagCtxt): ErrorGuaranteed | undefined {
  let reported: ErrorGuaranteed | undefined = undefined;

  // `self.errors.retain(|error| ..)`
  const kept: ArgError[] = [];
  for (const error of this.errors) {
    const keep = ((): boolean => {
      if (!(error.$ === "Invalid" && error._2.$ === "Incompatible" && error._2._0 !== undefined)) {
        return true;
      }
      const [provided_idx, expected_idx, e] = [error._0, error._1, error._2._0];
      const [provided_ty, provided_span] = this.arg_matching_ctxt.provided_arg_tys[provided_idx]!;
      const trace = this.arg_matching_ctxt.mk_trace(provided_span, this.arg_matching_ctxt.formal_and_expected_inputs[expected_idx]!, provided_ty);
      if (trace.cause.as_failure_code(e) !== "Error0308") {
        const err = this.arg_matching_ctxt.err_ctxt().report_and_explain_type_error(trace, this.arg_matching_ctxt.param_env, e);
        this.arg_matching_ctxt.suggest_confusable(err);
        reported = err.emit_err();
        return false;
      }
      return true;
    })();
    if (keep) kept.push(error);
  }
  this.errors = kept;

  return reported;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2492 check_single_incompatible
FnCallDiagCtxt.prototype.check_single_incompatible = function (this: FnCallDiagCtxt): ErrorGuaranteed | undefined {
  const only = this.errors.length === 1 ? this.errors[0]! : undefined;
  if (only !== undefined && only.$ === "Invalid" && only._2.$ === "Incompatible" && only._2._0 !== undefined) {
    const [provided_idx, expected_idx, err_] = [only._0, only._1, only._2._0];
    const [formal_ty, expected_ty] = this.formal_and_expected_inputs[expected_idx]!;
    const [provided_ty, provided_arg_span] = this.provided_arg_tys[provided_idx]!;
    const trace = this.mk_trace(provided_arg_span, [formal_ty, expected_ty], provided_ty);
    const err = this.err_ctxt().report_and_explain_type_error(trace, this.param_env, err_);
    this.emit_coerce_suggestions(
      err,
      this.provided_args[provided_idx]!,
      provided_ty,
      Expectation.only_has_type(Expectation.rvalue_hint(this.fn_ctxt, expected_ty), this.fn_ctxt) ?? formal_ty,
      undefined,
      undefined,
    );
    const call_name = this.call_metadata.call_name;
    err.span_label(this.call_metadata.full_call_span, `arguments to this ${call_name} are incorrect`);

    this.label_generic_mismatches(err);

    const ck = this.arg_matching_ctxt.args_ctxt.call_ctxt.call_expr.kind;
    if (ck.$ === "MethodCall" && ProvidedIdx.as_usize(provided_idx) === ExpectedIdx.as_usize(expected_idx)) {
      const rcvr = ck._1;
      this.note_source_of_type_mismatch_constraint(err, rcvr, {
        $: "Arg",
        call_expr: this.call_expr,
        incompatible_arg: ProvidedIdx.as_usize(provided_idx),
      });
    }

    this.suggest_mut_addr(expected_ty, provided_ty, this.provided_args[provided_idx]!, err);

    this.suggest_deref_unwrap_or(err, this.callee_ty, this.call_metadata.call_ident, expected_ty, provided_ty, this.provided_args[provided_idx]!, this.call_metadata.is_method);

    // Call out where the function is defined
    this.label_fn_like(
      err,
      this.fn_id,
      this.callee_ty,
      this.call_expr,
      expected_ty,
      ExpectedIdx.as_usize(expected_idx),
      this.matched_inputs,
      this.formal_and_expected_inputs,
      this.call_metadata.is_method,
      this.tuple_arguments,
    );
    this.arg_matching_ctxt.suggest_confusable(err);
    this.detect_dotdot(err, provided_ty, this.provided_args[provided_idx]!);
    return err.emit_err();
  }

  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2571 maybe_optimize_extra_arg_suggestion
FnCallDiagCtxt.prototype.maybe_optimize_extra_arg_suggestion = function (this: FnCallDiagCtxt): void {
  const only = this.errors.length === 1 ? this.errors[0]! : undefined;
  if (only !== undefined && only.$ === "Extra") {
    const provided_idx = only._0;
    if (!this.remove_idx_is_perfect(ProvidedIdx.as_usize(provided_idx))) {
      let found: number | undefined;
      for (let i = 0; i < this.args_ctxt.call_ctxt.provided_args.length; i++) {
        if (this.remove_idx_is_perfect(i)) {
          found = i;
          break;
        }
      }
      if (found !== undefined) {
        this.errors = [{ $: "Extra", _0: ProvidedIdx.from_usize(found) }];
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2583 initial_final_diagnostic
FnCallDiagCtxt.prototype.initial_final_diagnostic = function (this: FnCallDiagCtxt): Diag {
  if (this.formal_and_expected_inputs.length === this.provided_args.length) {
    return struct_span_code_err(this.dcx(), this.call_metadata.full_call_span, E0308, `arguments to this ${this.call_metadata.call_name} are incorrect`);
  } else {
    return this.arg_matching_ctxt
      .dcx()
      .struct_span_err(
        this.call_metadata.full_call_span,
        `this ${this.call_metadata.call_name} takes ${this.arg_matching_ctxt.args_ctxt.c_variadic ? "at least " : ""}${potentially_plural_count(this.formal_and_expected_inputs.length, "argument")} but ${potentially_plural_count(this.provided_args.length, "argument")} ${pluralize("was", this.provided_args.length)} supplied`,
      )
      .with_code(this.err_code);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2610 labels_and_suggestion_text
FnCallDiagCtxt.prototype.labels_and_suggestion_text = function (this: FnCallDiagCtxt, err: Diag): [[Span, string][], [Span, string][], SuggestionText] {
  // Don't print if it has error types or is just plain `_`
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2615 has_error_or_infer
  function has_error_or_infer(tys: Iterable<Ty>): boolean {
    for (const ty of tys) {
      if (TypeVisitableExt.references_error(ty, fold_Ty) || ty.is_ty_var()) return true;
    }
    return false;
  }

  const labels: [Span, string][] = [];
  let suggestion_text: SuggestionText = SuggestionText.None;

  // `self.errors.iter().peekable()`
  const all_errors = this.errors;
  let pos = 0;
  const peek = (): ArgError | undefined => all_errors[pos];
  let only_extras_so_far = ((first) => first !== undefined && first.$ === "Extra" && ProvidedIdx.index(first._0) === 0)(peek());
  let prev_extra_idx: number | undefined = undefined;
  const suggestions: [Span, string][] = [];
  let error: ArgError | undefined;
  while ((error = all_errors[pos]) !== undefined) {
    pos++;
    only_extras_so_far &&= error.$ === "Extra";

    switch (error.$) {
      case "Invalid": {
        const [provided_idx, expected_idx, compatibility] = [error._0, error._1, error._2];
        const [formal_ty, expected_ty] = this.arg_matching_ctxt.args_ctxt.call_ctxt.formal_and_expected_inputs[expected_idx]!;
        const [provided_ty, provided_span] = this.arg_matching_ctxt.provided_arg_tys[provided_idx]!;
        if (compatibility.$ === "Incompatible") {
          const error = compatibility._0;
          const trace = this.arg_matching_ctxt.args_ctxt.call_ctxt.mk_trace(provided_span, [formal_ty, expected_ty], provided_ty);
          if (error !== undefined) {
            const e = error;
            this.err_ctxt().note_type_err(err, trace.cause, undefined, this.param_env.and(trace.values), e, true, undefined);
          }
        }

        this.emit_coerce_suggestions(
          err,
          this.provided_args[provided_idx]!,
          provided_ty,
          Expectation.only_has_type(Expectation.rvalue_hint(this.fn_ctxt, expected_ty), this.fn_ctxt) ?? formal_ty,
          undefined,
          undefined,
        );
        this.detect_dotdot(err, provided_ty, this.provided_args[provided_idx]!);
        break;
      }
      case "Extra": {
        const arg_idx = error._0;
        const [provided_ty, provided_span] = this.provided_arg_tys[arg_idx]!;
        const provided_ty_name = !has_error_or_infer([provided_ty])
          ? // FIXME: not suggestable, use something else
            ` of type \`${display_Ty(provided_ty)}\``
          : "";
        const idx = this.provided_arg_tys.length === 1 ? "" : ` #${ProvidedIdx.as_usize(arg_idx) + 1}`;
        labels.push([provided_span, `unexpected argument${idx}${provided_ty_name}`]);
        let span_: Span | undefined;
        if (this.provided_arg_tys.length === 1 && (span_ = this.maybe_suggest_expect_for_unwrap(provided_ty)) !== undefined) {
          err.span_suggestion_verbose(span_, "did you mean to use `expect`?", "expect", Applicability.MaybeIncorrect);
          continue;
        }
        let span = provided_span;
        if (Span.can_be_used_for_suggestions(span) && Span.can_be_used_for_suggestions(this.call_metadata.error_span)) {
          const prev_i = ProvidedIdx.index(arg_idx) - 1;
          if (ProvidedIdx.index(arg_idx) > 0 && prev_i < this.provided_arg_tys.length) {
            const [, prev] = this.provided_arg_tys[ProvidedIdx.from_usize(prev_i)]!;
            // Include previous comma
            span = Span.to(Span.shrink_to_hi(prev), span);
          }

          // Is last argument for deletion in a row starting from the 0-th argument?
          // Then delete the next comma, so we are not left with `f(, ...)`
          //
          //     fn f() {}
          //   - f(0, 1,)
          //   + f()
          const next_error = peek();
          let trim_next_comma: boolean;
          if (next_error !== undefined && next_error.$ === "Extra" && only_extras_so_far && ProvidedIdx.index(next_error._0) > ProvidedIdx.index(arg_idx) + 1) {
            // If the next Error::Extra ("next") doesn't next to current ("current"),
            // fn foo(_: (), _: u32) {}
            // - foo("current", (), 1u32, "next")
            // + foo((), 1u32)
            // If the previous error is not a `Error::Extra`, then do not trim the next comma
            // - foo((), "current", 42u32, "next")
            // + foo((), 42u32)
            trim_next_comma = prev_extra_idx === undefined || prev_extra_idx + 1 === ProvidedIdx.index(arg_idx);
          } else if (next_error === undefined && only_extras_so_far) {
            // If no error left, we need to delete the next comma
            trim_next_comma = true;
          } else {
            // Not sure if other error type need to be handled as well
            trim_next_comma = false;
          }

          if (trim_next_comma) {
            const next_i = arg_idx + 1;
            const next =
              next_i < this.provided_arg_tys.length
                ? this.provided_arg_tys[next_i]![1]
                : // Try to move before `)`. Note that `)` here is not necessarily
                  // the latin right paren, it could be a Unicode-confusable that
                  // looks like a `)`, so we must not use `- BytePos(1)`
                  // manipulations here.
                  this.arg_matching_ctxt.tcx.sess.source_map().end_point(this.call_expr.span);

            // Include next comma
            span = Span.until(span, next);
          }

          suggestions.push([span, ""]);

          switch (suggestion_text.$) {
            case "None":
              suggestion_text = { $: "Remove", _0: false };
              break;
            case "Remove":
              suggestion_text = { $: "Remove", _0: true };
              break;
            default:
              suggestion_text = SuggestionText.DidYouMean;
          }
          prev_extra_idx = ProvidedIdx.index(arg_idx);
        }
        this.detect_dotdot(err, provided_ty, this.provided_args[arg_idx]!);
        break;
      }
      case "Missing": {
        // If there are multiple missing arguments adjacent to each other,
        // then we can provide a single error.

        const missing_idxs: ExpectedIdx[] = [error._0];
        let e: ArgError | undefined;
        while ((e = peek()) !== undefined && e.$ === "Missing" && e._0 === missing_idxs[missing_idxs.length - 1]! + 1) {
          pos++;
          switch (e.$) {
            case "Missing":
              missing_idxs.push(e._0);
              break;
            default:
              unreachable("control flow ensures that we should always get an `Error::Missing`");
          }
        }

        // NOTE: Because we might be re-arranging arguments, might have extra
        // arguments, etc. it's hard to *really* know where we should provide
        // this error label, so as a heuristic, we point to the provided arg, or
        // to the call if the missing inputs pass the provided args.
        const provided_span_of = (idx: ExpectedIdx): Span | undefined => {
          const p = ExpectedIdx.to_provided_idx(idx);
          return p < this.provided_arg_tys.length ? this.provided_arg_tys[p]![1] : undefined;
        };
        if (missing_idxs.length === 1) {
          const expected_idx = missing_idxs[0]!;
          const [, input_ty] = this.formal_and_expected_inputs[expected_idx]!;
          const arg_span = provided_span_of(expected_idx);
          const span = arg_span !== undefined ? arg_span : this.args_span;
          const rendered = !has_error_or_infer([input_ty]) ? ` of type \`${display_Ty(input_ty)}\`` : "";
          labels.push([span, `argument #${ExpectedIdx.as_usize(expected_idx) + 1}${rendered} is missing`]);

          switch (suggestion_text.$) {
            case "None":
              suggestion_text = { $: "Provide", _0: false };
              break;
            case "Provide":
              suggestion_text = { $: "Provide", _0: true };
              break;
            default:
              suggestion_text = SuggestionText.DidYouMean;
          }
        } else if (missing_idxs.length === 2) {
          const [first_idx, second_idx] = [missing_idxs[0]!, missing_idxs[1]!];
          const [, first_expected_ty] = this.formal_and_expected_inputs[first_idx]!;
          const [, second_expected_ty] = this.formal_and_expected_inputs[second_idx]!;
          const first_span = provided_span_of(first_idx);
          const second_span = provided_span_of(second_idx);
          const span = first_span !== undefined && second_span !== undefined ? Span.to(first_span, second_span) : this.args_span;
          const rendered = !has_error_or_infer([first_expected_ty, second_expected_ty])
            ? ` of type \`${display_Ty(first_expected_ty)}\` and \`${display_Ty(second_expected_ty)}\``
            : "";
          labels.push([span, `two arguments${rendered} are missing`]);
          switch (suggestion_text.$) {
            case "None":
            case "Provide":
              suggestion_text = { $: "Provide", _0: true };
              break;
            default:
              suggestion_text = SuggestionText.DidYouMean;
          }
        } else if (missing_idxs.length === 3) {
          const [first_idx, second_idx, third_idx] = [missing_idxs[0]!, missing_idxs[1]!, missing_idxs[2]!];
          const [, first_expected_ty] = this.formal_and_expected_inputs[first_idx]!;
          const [, second_expected_ty] = this.formal_and_expected_inputs[second_idx]!;
          const [, third_expected_ty] = this.formal_and_expected_inputs[third_idx]!;
          const first_span = provided_span_of(first_idx);
          const third_span = provided_span_of(third_idx);
          const span = first_span !== undefined && third_span !== undefined ? Span.to(first_span, third_span) : this.args_span;
          const rendered = !has_error_or_infer([first_expected_ty, second_expected_ty, third_expected_ty])
            ? ` of type \`${display_Ty(first_expected_ty)}\`, \`${display_Ty(second_expected_ty)}\`, and \`${display_Ty(third_expected_ty)}\``
            : "";
          labels.push([span, `three arguments${rendered} are missing`]);
          switch (suggestion_text.$) {
            case "None":
            case "Provide":
              suggestion_text = { $: "Provide", _0: true };
              break;
            default:
              suggestion_text = SuggestionText.DidYouMean;
          }
        } else {
          const first_idx = missing_idxs[0]!;
          const last_idx = missing_idxs[missing_idxs.length - 1]!;
          // NOTE: Because we might be re-arranging arguments, might have extra arguments, etc.
          // It's hard to *really* know where we should provide this error label, so this is a
          // decent heuristic
          const first_span = provided_span_of(first_idx);
          const last_span = provided_span_of(last_idx);
          const span = first_span !== undefined && last_span !== undefined ? Span.to(first_span, last_span) : this.args_span;
          labels.push([span, "multiple arguments are missing"]);
          switch (suggestion_text.$) {
            case "None":
            case "Provide":
              suggestion_text = { $: "Provide", _0: true };
              break;
            default:
              suggestion_text = SuggestionText.DidYouMean;
          }
        }
        break;
      }
      case "Swap": {
        const [first_provided_idx, second_provided_idx, first_expected_idx, second_expected_idx] = [error._0, error._1, error._2, error._3];
        const [first_provided_ty, first_span] = this.provided_arg_tys[first_provided_idx]!;
        const [, first_expected_ty] = this.formal_and_expected_inputs[first_expected_idx]!;
        const first_provided_ty_name = !has_error_or_infer([first_provided_ty]) ? `, found \`${display_Ty(first_provided_ty)}\`` : "";
        labels.push([first_span, `expected \`${display_Ty(first_expected_ty)}\`${first_provided_ty_name}`]);

        const [second_provided_ty, second_span] = this.provided_arg_tys[second_provided_idx]!;
        const [, second_expected_ty] = this.formal_and_expected_inputs[second_expected_idx]!;
        const second_provided_ty_name = !has_error_or_infer([second_provided_ty]) ? `, found \`${display_Ty(second_provided_ty)}\`` : "";
        labels.push([second_span, `expected \`${display_Ty(second_expected_ty)}\`${second_provided_ty_name}`]);

        switch (suggestion_text.$) {
          case "None":
            suggestion_text = SuggestionText.Swap;
            break;
          default:
            suggestion_text = SuggestionText.DidYouMean;
        }
        break;
      }
      case "Permutation": {
        const args = error._0;
        for (const [dst_arg, dest_input] of args) {
          const [, expected_ty] = this.formal_and_expected_inputs[dst_arg]!;
          const [provided_ty, provided_span] = this.provided_arg_tys[dest_input]!;
          const provided_ty_name = !has_error_or_infer([provided_ty]) ? `, found \`${display_Ty(provided_ty)}\`` : "";
          labels.push([provided_span, `expected \`${display_Ty(expected_ty)}\`${provided_ty_name}`]);
        }

        switch (suggestion_text.$) {
          case "None":
            suggestion_text = SuggestionText.Reorder;
            break;
          default:
            suggestion_text = SuggestionText.DidYouMean;
        }
        break;
      }
    }
  }

  return [suggestions, labels, suggestion_text];
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2969 label_generic_mismatches
FnCallDiagCtxt.prototype.label_generic_mismatches = function (this: FnCallDiagCtxt, err: Diag): void {
  this.fn_ctxt.label_generic_mismatches(
    err,
    this.fn_id,
    this.matched_inputs,
    this.provided_arg_tys,
    this.formal_and_expected_inputs,
    this.call_metadata.is_method,
    TupleArgumentsFlag.is_splatted(this.arg_matching_ctxt.tuple_arguments),
  );
};

/// Incorporate the argument changes in the removal suggestion.
///
/// When a type is *missing*, and the rest are additional, we want to suggest these with a
/// multipart suggestion, but in order to do so we need to figure out *where* the arg that
/// was provided but had the wrong type should go, because when looking at `expected_idx`
/// that is the position in the argument list in the definition, while `provided_idx` will
/// not be present. So we have to look at what the *last* provided position was, and point
/// one after to suggest the replacement.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:2989 append_arguments_changes
FnCallDiagCtxt.prototype.append_arguments_changes = function (this: FnCallDiagCtxt, suggestions: [Span, string][]): void {
  // FIXME(estebank): This is hacky, and there's
  // probably a better more involved change we can make to make this work.
  // For example, if we have
  // ```
  // fn foo(i32, &'static str) {}
  // foo((), (), ());
  // ```
  // what should be suggested is
  // ```
  // foo(/* i32 */, /* &str */);
  // ```
  // which includes the replacement of the first two `()` for the correct type, and the
  // removal of the last `()`.

  let prev = -1;
  for (let i = 0; i < this.matched_inputs.length; i++) {
    const expected_idx = ExpectedIdx.from_usize(i);
    const provided_idx = this.matched_inputs[i];
    // We want to point not at the *current* argument expression index, but rather at the
    // index position where it *should have been*, which is *after* the previous one.
    if (provided_idx !== undefined) {
      prev = ProvidedIdx.index(provided_idx);
      continue;
    }
    const idx = ProvidedIdx.from_usize(prev + 1);
    if (idx < this.provided_arg_tys.length) {
      const [, arg_span] = this.provided_arg_tys[idx]!;
      prev += 1;
      // There is a type that was *not* found anywhere, so it isn't a move, but a
      // replacement and we look at what type it should have been. This will allow us
      // To suggest a multipart suggestion when encountering `foo(1, "")` where the def
      // was `fn foo(())`.
      const [, expected_ty] = this.formal_and_expected_inputs[expected_idx]!;
      // Check if the new suggestion would overlap with any existing suggestion.
      // This can happen when we have both removal suggestions (which may include
      // adjacent commas) and type replacement suggestions for the same span.
      const dominated = suggestions.some(([span]) => Span.contains(span, arg_span) || Span.overlaps(arg_span, span));
      if (!dominated) {
        suggestions.push([arg_span, this.ty_to_snippet(expected_ty, expected_idx)]);
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3033 format_suggestion_text
(FnCallDiagCtxt as unknown as { format_suggestion_text: typeof FnCallDiagCtxt.format_suggestion_text }).format_suggestion_text = function (
  err: Diag,
  suggestions: [Span, string][],
  suggestion_text: SuggestionText,
): string | undefined {
  switch (suggestion_text.$) {
    case "None":
      return undefined;
    case "Provide": {
      const plural = suggestion_text._0;
      return `provide the argument${plural ? "s" : ""}`;
    }
    case "Remove": {
      const plural = suggestion_text._0;
      err.multipart_suggestion(`remove the extra argument${plural ? "s" : ""}`, suggestions, Applicability.HasPlaceholders);
      return undefined;
    }
    case "Swap":
      return "swap these arguments";
    case "Reorder":
      return "reorder these arguments";
    case "DidYouMean":
      return "did you mean";
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3057 arguments_formatting
FnCallDiagCtxt.prototype.arguments_formatting = function (this: FnCallDiagCtxt, suggestion_span: Span): ArgumentsFormatting {
  const source_map = this.sess().source_map();
  // `self.matched_inputs.iter().filter_map(|a| *a)`
  const provided_inputs = this.matched_inputs.filter((a): a is ProvidedIdx => a !== undefined);
  let brace_indent: Str | undefined;
  let first_idx: ProvidedIdx | undefined;
  let last_idx: ProvidedIdx | undefined;
  let first_span: Span;
  let fallback_indent: Str | undefined;
  if (
    (brace_indent = source_map.indentation_before(suggestion_span)) !== undefined &&
    (first_idx = provided_inputs[0]) !== undefined &&
    (last_idx = provided_inputs[1]) !== undefined &&
    ((first_span = this.provided_arg_tys[first_idx]![1]), true) &&
    source_map.is_multiline(Span.to(first_span, this.provided_arg_tys[last_idx]![1])) &&
    (fallback_indent = source_map.indentation_before(first_span)) !== undefined
  ) {
    return { $: "Multiline", fallback_indent: fallback_indent.toString(), brace_indent: brace_indent.toString() };
  } else {
    return ArgumentsFormatting.SingleLine;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3074 suggestion_code
FnCallDiagCtxt.prototype.suggestion_code = function (this: FnCallDiagCtxt): [Span, string] {
  const source_map = this.sess().source_map();
  const args_span = Span.trim_start(this.call_metadata.error_span, this.call_metadata.full_call_span);
  const suggestion_span =
    args_span !== undefined
      ? // Span of the braces, e.g. `(a, b, c)`.
        args_span
      : // The arg span of a function call that wasn't even given braces
        // like what might happen with delegation reuse.
        // e.g. `reuse HasSelf::method;` should suggest `reuse HasSelf::method($args);`.
        Span.shrink_to_hi(this.call_metadata.full_call_span);

  const arguments_formatting = this.arguments_formatting(suggestion_span);

  let suggestion = "(";
  let needs_comma = false;
  for (let i = 0; i < this.matched_inputs.length; i++) {
    const expected_idx = ExpectedIdx.from_usize(i);
    const provided_idx = this.matched_inputs[i];
    if (needs_comma) {
      suggestion += ",";
    }
    switch (arguments_formatting.$) {
      case "SingleLine":
        if (needs_comma) suggestion += " ";
        break;
      case "Multiline":
        suggestion += "\n";
        break;
    }
    needs_comma = true;
    let suggestion_span: Span | undefined;
    let suggestion_text: string;
    let arg_text: ReturnType<SourceMap["span_to_snippet"]> | undefined;
    let provided_span: Span;
    if (
      provided_idx !== undefined &&
      ((provided_span = this.provided_arg_tys[provided_idx]![1]), true) &&
      (arg_text = source_map.span_to_snippet(provided_span)).$ === "Ok"
    ) {
      [suggestion_span, suggestion_text] = [provided_span, arg_text._0.toString()];
    } else {
      // Propose a placeholder of the correct type
      const [, expected_ty] = this.formal_and_expected_inputs[expected_idx]!;
      [suggestion_span, suggestion_text] = [undefined, this.ty_to_snippet(expected_ty, expected_idx)];
    }
    if (arguments_formatting.$ === "Multiline") {
      const fallback_indent = arguments_formatting.fallback_indent;
      const indent = (suggestion_span !== undefined ? source_map.indentation_before(suggestion_span)?.toString() : undefined) ?? fallback_indent;
      suggestion += indent;
    }
    suggestion += suggestion_text;
  }
  if (arguments_formatting.$ === "Multiline") {
    const brace_indent = arguments_formatting.brace_indent;
    suggestion += ",\n";
    suggestion += brace_indent;
  }
  suggestion += ")";

  return [suggestion_span, suggestion];
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3129 maybe_suggest_expect_for_unwrap
FnCallDiagCtxt.prototype.maybe_suggest_expect_for_unwrap = function (this: FnCallDiagCtxt, provided_ty: Ty): Span | undefined {
  const tcx = this.tcx;
  const call_ident = this.call_metadata.call_ident;
  const callee_ty = this.callee_ty;
  let k: ReturnType<Ty["kind"]>;
  if (
    call_ident !== undefined &&
    call_ident.name === sym.unwrap &&
    callee_ty !== undefined &&
    (k = callee_ty.peel_refs().kind()).$ === "Adt" &&
    (tcx.is_diagnostic_item(sym.Option, k._0.did()) || tcx.is_diagnostic_item(sym.Result, k._0.did())) &&
    this.may_coerce(provided_ty, Ty.new_static_str(tcx))
  ) {
    return call_ident.span;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3154 deref
ArgMatchingCtxt.prototype.deref = function (this: ArgMatchingCtxt): ArgsCtxt {
  return this.args_ctxt;
};

// impl<'a, 'tcx> ArgMatchingCtxt<'a, 'tcx>

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3160 new
(ArgMatchingCtxt as unknown as { new: typeof ArgMatchingCtxt.new }).new = function (
  arg: FnCtxt,
  compatibility_diagonal: Compatibility[],
  formal_and_expected_inputs: [Ty, Ty][],
  provided_args: hir.Expr[],
  c_variadic: boolean,
  err_code: ErrCode,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfo,
  call_span: Span,
  call_expr: hir.Expr,
  tuple_arguments: TupleArgumentsFlag,
): ArgMatchingCtxt {
  const args_ctxt = ArgsCtxt.new(arg, compatibility_diagonal, formal_and_expected_inputs, provided_args, c_variadic, err_code, fn_id, call_span, call_expr, tuple_arguments);
  const provided_arg_tys = args_ctxt.provided_arg_tys();

  return new ArgMatchingCtxt(args_ctxt, provided_arg_tys);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3190 suggest_confusable
ArgMatchingCtxt.prototype.suggest_confusable = function (this: ArgMatchingCtxt, err: Diag): void {
  const call_name = this.call_metadata.call_ident;
  if (call_name === undefined) {
    return;
  }
  const callee_ty = this.callee_ty;
  if (callee_ty === undefined) {
    return;
  }
  const input_types: Ty[] = this.provided_arg_tys.map(([ty]) => ty);

  // Check for other methods in the following order
  //  - methods marked as `rustc_confusables` with the provided arguments
  //  - methods with the same argument type/count and short levenshtein distance
  //  - methods marked as `rustc_confusables` (done)
  //  - methods with short levenshtein distance

  // Look for commonly confusable method names considering arguments.
  if (this.confusable_method_name(err, callee_ty.peel_refs(), call_name, input_types.slice()) !== undefined) {
    return;
  }
  // Look for method names with short levenshtein distance, considering arguments.
  const similar = this.similar_assoc(call_name);
  if (similar !== undefined) {
    const [assoc, fn_sig] = similar;
    // `fn_sig.inputs()[1..].iter().eq_by(input_types, |expected, found| self.may_coerce(*expected, found))`
    const inputs = FnSig.inputs(fn_sig);
    assert(inputs.length >= 1, "range start index 1 out of range for slice");
    const expected_inputs = inputs.slice(1);
    let eq = true;
    for (let i = 0; ; i++) {
      if (i >= expected_inputs.length || i >= input_types.length) {
        eq = i >= expected_inputs.length && i >= input_types.length;
        break;
      }
      if (!this.may_coerce(expected_inputs[i]!, input_types[i]!)) {
        eq = false;
        break;
      }
    }
    if (eq) {
      const assoc_name = Symbol.as_str(AssocItem.name(assoc));
      err.span_suggestion_verbose(call_name.span, `you might have meant to use \`${assoc_name}\``, assoc_name, Applicability.MaybeIncorrect);
      return;
    }
  }

  this.annotate_alternative_method_deref(err, this.call_expr, undefined);
};

/// A "softer" version of the `demand_compatible`, which checks types without persisting them,
/// and treats error types differently
/// This will allow us to "probe" for other argument orders that would likely have been correct
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3236 check_compatible
ArgMatchingCtxt.prototype.check_compatible = function (this: ArgMatchingCtxt, provided_idx: ProvidedIdx, expected_idx: ExpectedIdx): Compatibility {
  if (ProvidedIdx.as_usize(provided_idx) === ExpectedIdx.as_usize(expected_idx)) {
    return clone_Compatibility(this.compatibility_diagonal[provided_idx]!);
  }

  const [formal_input_ty, expected_input_ty] = this.formal_and_expected_inputs[expected_idx]!;
  // If either is an error type, we defy the usual convention and consider them to *not* be
  // coercible. This prevents our error message heuristic from trying to pass errors into
  // every argument.
  if (TypeVisitableExt.references_error(formal_input_ty, fold_Ty) || TypeVisitableExt.references_error(expected_input_ty, fold_Ty)) {
    return { $: "Incompatible", _0: undefined };
  }

  const [arg_ty, arg_span] = this.provided_arg_tys[provided_idx]!;

  const expectation = Expectation.rvalue_hint(this.fn_ctxt, expected_input_ty);
  const coerced_ty = Expectation.only_has_type(expectation, this.fn_ctxt) ?? formal_input_ty;
  const can_coerce = this.may_coerce(arg_ty, coerced_ty);
  if (!can_coerce) {
    return { $: "Incompatible", _0: { $: "Sorts", _0: ExpectedFound.new(coerced_ty, arg_ty) } };
  }

  // Using probe here, since we don't want this subtyping to affect inference.
  const subtyping_error = this.probe((_): TypeError | undefined => {
    const r = this.at(this.misc(arg_span), this.param_env).sup(DefineOpaqueTypes.Yes, formal_input_ty, coerced_ty, ToTrace_Ty);
    return r.$ === "Err" ? r._0 : undefined;
  });

  // Same as above: if either the coerce type or the checked type is an error type,
  // consider them *not* compatible.
  const references_error = TypeVisitableExt.references_error(coerced_ty, fold_Ty) || TypeVisitableExt.references_error(arg_ty, fold_Ty);
  if (!references_error && subtyping_error === undefined) {
    return Compatibility.Compatible;
  } else {
    return { $: "Incompatible", _0: subtyping_error };
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3280 remove_idx_is_perfect
ArgMatchingCtxt.prototype.remove_idx_is_perfect = function (this: ArgMatchingCtxt, idx: number): boolean {
  const removed_arg_tys = this.provided_arg_tys.filter((_arg, j) => idx !== j);
  const n = Math.min(this.formal_and_expected_inputs.length, removed_arg_tys.length);
  for (let i = 0; i < n; i++) {
    const [expected_ty] = this.formal_and_expected_inputs[i]!;
    const [provided_ty] = removed_arg_tys[i]!;
    if (!(!TypeVisitableExt.references_error(provided_ty, fold_Ty) && this.may_coerce(provided_ty, expected_ty))) {
      return false;
    }
  }
  return true;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3304 deref
ArgsCtxt.prototype.deref = function (this: ArgsCtxt): CallCtxt {
  return this.call_ctxt;
};

// impl<'a, 'tcx> ArgsCtxt<'a, 'tcx>

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3310 new
(ArgsCtxt as unknown as { new: typeof ArgsCtxt.new }).new = function (
  arg: FnCtxt,
  compatibility_diagonal: Compatibility[],
  formal_and_expected_inputs: [Ty, Ty][],
  provided_args: hir.Expr[],
  c_variadic: boolean,
  err_code: ErrCode,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfo,
  call_span: Span,
  call_expr: hir.Expr,
  tuple_arguments: TupleArgumentsFlag,
): ArgsCtxt {
  const call_ctxt: CallCtxt = CallCtxt.new(arg, compatibility_diagonal, formal_and_expected_inputs, provided_args, c_variadic, err_code, fn_id, call_span, call_expr, tuple_arguments);

  const call_metadata = call_ctxt.call_metadata();
  const args_span = Span.trim_start(call_metadata.error_span, call_metadata.full_call_span) ?? call_metadata.error_span;

  return new ArgsCtxt(call_ctxt, call_metadata, args_span);
};

/// Get the argument span in the context of the call span so that
/// suggestions and labels are (more) correct when an arg is a
/// macro invocation.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3348 normalize_span
ArgsCtxt.prototype.normalize_span = function (this: ArgsCtxt, span: Span): Span {
  const normalized_span = Span.find_ancestor_inside_same_ctxt(span, this.call_metadata.error_span) ?? span;
  // Sometimes macros mess up the spans, so do not normalize the
  // arg span to equal the error span, because that's less useful
  // than pointing out the arg expr in the wrong context.
  const [nlo, nhi] = Span.lo_hi(normalized_span);
  const [elo, ehi] = Span.lo_hi(this.call_metadata.error_span);
  if (nlo === elo && nhi === ehi) {
    return span;
  } else {
    return normalized_span;
  }
};

/// Computes the provided types and spans.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3362 provided_arg_tys
ArgsCtxt.prototype.provided_arg_tys = function (this: ArgsCtxt): [Ty, Span][] {
  return this.call_ctxt.provided_args.map((expr): [Ty, Span] => {
    const ty = this.call_ctxt.fn_ctxt.typeck_results.expr_ty_adjusted_opt(expr) ?? Ty.new_misc_error(this.call_ctxt.fn_ctxt.tcx);
    return [this.call_ctxt.fn_ctxt.deeply_resolve_ignoring_regions(ty, fold_Ty), this.normalize_span(expr.span)];
  });
};

// Obtain another method on `Self` that have similar name.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3383 similar_assoc
ArgsCtxt.prototype.similar_assoc = function (this: ArgsCtxt, call_name: Ident): [AssocItem, FnSig] | undefined {
  const callee_ty = this.call_ctxt.callee_ty;
  let r: Result<AssocItem | undefined, MethodError>;
  if (
    callee_ty !== undefined &&
    (r = this.call_ctxt.fn_ctxt.probe_op(
      call_name.span,
      Mode.MethodCall,
      call_name,
      undefined,
      { _0: true },
      callee_ty.peel_refs(),
      unwrap(this.call_ctxt.callee_expr).hir_id,
      ProbeScope.TraitsInScope,
      (ctxt) => ctxt.probe_for_similar_candidate(),
    )).$ === "Ok" &&
    r._0 !== undefined &&
    AssocItem.is_method(r._0)
  ) {
    const assoc = r._0;
    const args = this.call_ctxt.fn_ctxt.infcx.fresh_args_for_item(call_name.span, assoc.def_id);
    const fn_sig = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(this.call_ctxt.fn_ctxt.tcx.fn_sig(assoc.def_id) as EarlyBinder<PolyFnSig>, this.call_ctxt.fn_ctxt.tcx, args, fold_Binder(fold_FnSig)),
    );

    this.call_ctxt.fn_ctxt.instantiate_binder_with_fresh_vars(call_name.span, BoundRegionConversionTime.FnCall, fn_sig, fold_FnSig);
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3417 call_is_in_macro
ArgsCtxt.prototype.call_is_in_macro = function (this: ArgsCtxt): boolean {
  return Span.in_external_macro(this.call_metadata.full_call_span, this.sess().source_map());
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3449 deref
CallCtxt.prototype.deref = function (this: CallCtxt): FnCtxt {
  return this.fn_ctxt;
};

// impl<'a, 'tcx> CallCtxt<'a, 'tcx>

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3455 new
(CallCtxt as unknown as { new: typeof CallCtxt.new }).new = function (
  fn_ctxt: FnCtxt,
  compatibility_diagonal: Compatibility[],
  formal_and_expected_inputs: [Ty, Ty][],
  provided_args: hir.Expr[],
  c_variadic: boolean,
  err_code: ErrCode,
  // Lowering info if a splatted function is being called.
  fn_id: SplatLoweringInfo,
  call_span: Span,
  call_expr: hir.Expr,
  tuple_arguments: TupleArgumentsFlag,
): CallCtxt {
  let callee_expr: hir.Expr | undefined;
  const ck = call_expr.peel_blocks().kind;
  switch (ck.$) {
    case "Call":
      callee_expr = ck._0;
      break;
    case "MethodCall": {
      const receiver = ck._1;
      let tdd: [DefKind, DefId] | undefined;
      let assoc: AssocItem | undefined;
      if (
        (tdd = fn_ctxt.typeck_results.type_dependent_def(call_expr.hir_id)) !== undefined &&
        tdd[0].$ === "AssocFn" &&
        (assoc = fn_ctxt.tcx.opt_associated_item(tdd[1])) !== undefined &&
        AssocItem.is_method(assoc)
      ) {
        callee_expr = receiver;
      } else {
        callee_expr = undefined;
      }
      break;
    }
    default:
      callee_expr = undefined;
  }

  const callee_ty = callee_expr !== undefined ? fn_ctxt.typeck_results.expr_ty_adjusted_opt(callee_expr) : undefined;

  return new CallCtxt(
    fn_ctxt,
    compatibility_diagonal,
    formal_and_expected_inputs,
    provided_args,
    c_variadic,
    err_code,
    fn_id,
    call_span,
    call_expr,
    tuple_arguments,
    callee_expr,
    callee_ty,
  );
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3504 call_metadata
CallCtxt.prototype.call_metadata = function (this: CallCtxt): CallMetadata {
  const k = this.call_expr.kind;
  if (k.$ === "Call" && k._0.kind.$ === "Path") {
    const { hir_id, span } = k._0;
    const qpath = k._0.kind._0;
    const res = this.typeck_results.qpath_res(qpath, hir_id);
    if (res.$ === "Def" && res._0.$ === "Ctor") {
      const of = res._0._0;
      let name: string;
      switch (of) {
        case "Struct":
          name = "struct";
          break;
        case "Variant":
          name = "enum variant";
          break;
      }
      return { error_span: this.call_span, call_ident: undefined, full_call_span: span, call_name: name, is_method: false };
    } else {
      return { error_span: this.call_span, call_ident: undefined, full_call_span: span, call_name: "function", is_method: false };
    }
  } else if (k.$ === "Call") {
    const { span } = k._0;
    return { error_span: this.call_span, call_ident: undefined, full_call_span: span, call_name: "function", is_method: false };
  } else if (k.$ === "MethodCall") {
    const [path_segment, span] = [k._0, k._3];
    let ident_span = path_segment.ident.span;
    const args = path_segment.args;
    if (args !== undefined) {
      ident_span = Span.with_hi(ident_span, Span.hi(args.span_ext));
    }
    return { error_span: span, call_ident: path_segment.ident, full_call_span: ident_span, call_name: "method", is_method: true };
  } else {
    return span_bug(this.call_span, `checking argument types on a non-call: \`${format_debug(k, hir.debug_ExprKind, PLAINA)}\``);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3560 mk_trace
CallCtxt.prototype.mk_trace = function (this: CallCtxt, span: Span, [formal_ty, expected_ty]: [Ty, Ty], provided_ty: Ty): TypeTrace {
  const mismatched_ty =
    expected_ty === provided_ty
      ? // If expected == provided, then we must have failed to sup
        // the formal type. Avoid printing out "expected Ty, found Ty"
        // in that case.
        formal_ty
      : expected_ty;
  return TypeTrace.types(this.misc(span), mismatched_ty, provided_ty);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3577 ty_to_snippet
CallCtxt.prototype.ty_to_snippet = function (this: CallCtxt, ty: Ty, expected_idx: ExpectedIdx): string {
  let fn_def_id: DefId;
  let arg: Ident | undefined;
  if (ty.is_unit()) {
    return "()";
  } else if (IsSuggestable.is_suggestable(ty, this.tcx, false, fold_Ty)) {
    return with_forced_trimmed_paths(() => `/* ${display_Ty(ty)} */`);
  } else if (
    this.fn_id.$ === "FnDef" &&
    ((fn_def_id = this.fn_id._0), true) &&
    DefKind.is_fn_like(this.tcx.def_kind(fn_def_id)) &&
    ((arg = ((idents, i) => (i < idents.length ? idents[i] : undefined))(this.tcx.fn_arg_idents(fn_def_id), ExpectedIdx.as_usize(expected_idx) + (this.call_expr.kind.$ === "MethodCall" ? 1 : 0))) !== undefined) &&
    arg.name !== kw.SelfLower
  ) {
    return `/* ${Symbol.as_str(arg.name)} */`;
  } else {
    // FIXME(FnPtr, splat): What suggestions are needed for FnPtrs?
    // SplatLoweringInfo::FnPtr(Ty) and SplatLoweringInfo::Error currently fall through to
    // this placeholder
    return "/* value */";
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3599 first_incompatible_error
CallCtxt.prototype.first_incompatible_error = function (this: CallCtxt): [ProvidedIdx, TypeError] | undefined {
  for (let i = 0; i < this.compatibility_diagonal.length; i++) {
    const c = this.compatibility_diagonal[i]!;
    if (c.$ === "Incompatible" && c._0 !== undefined) {
      return [ProvidedIdx.from_usize(i), c._0];
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3615 same_type_modulo_vars
export function same_type_modulo_vars(tcx: TyCtxt, a: Ty, b: Ty): boolean {
  // PORT: the fn-local `struct SameModuloVars` and its `TypeRelation` impl are a module-level class (below).
  return new SameModuloVars(tcx).relate(a, b, relate_TyR).$ === "Ok";
}

// `struct SameModuloVars<'tcx> { tcx: TyCtxt<'tcx> }` (fn-local in `same_type_modulo_vars`)
class SameModuloVars implements TypeRelationR {
  constructor(public tcx: TyCtxt) {}

  // ---- impl<'tcx> TypeRelation<TyCtxt<'tcx>> for SameModuloVars<'tcx> ----

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3620 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // (provided) `TypeRelation::relate`.
  relate<T>(a: T, b: T, d: RelateR<T>): RelateResultR<T> {
    return TypeRelation_providedR.relate(this, a, b, d);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3624 relate_ty_args
  relate_ty_args(a_ty: Ty, _b_ty: Ty, _ty_def_id: DefIdA, a_args: GenericArgsA, b_args: GenericArgsA, _mk: (args: GenericArgsA) => Ty): RelateResultR<Ty> {
    const r = relate_args_invariantlyR(this, a_args, b_args);
    if (r.$ === "Err") return r;
    return OkA(a_ty);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3637 relate_with_variance
  relate_with_variance<T>(_variance: VarianceR, _info: VarianceDiagInfoR, a: T, b: T, d: RelateR<T>): RelateResultR<T> {
    return this.relate(a, b, d);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3647 tys
  tys(a: Ty, b: Ty): RelateResultR<Ty> {
    if (a === b) {
      return OkA(a);
    }

    const ak = a.kind();
    const bk = b.kind();
    if (
      (ak.$ === "Infer" && ak._0.$ === "TyVar" && bk.$ === "Infer" && bk._0.$ === "TyVar") ||
      (ak.$ === "Infer" && ak._0.$ === "FloatVar" && bk.$ === "Infer" && bk._0.$ === "FloatVar") ||
      (ak.$ === "Infer" && ak._0.$ === "IntVar" && bk.$ === "Infer" && bk._0.$ === "IntVar")
    ) {
      return OkA(a);
    } else if (ak.$ === "Infer" || bk.$ === "Infer") {
      return ErrA(TypeErrorR.Mismatch);
    } else if (ak.$ === "Error") {
      return OkA(TyA.new_error(this.cx(), ak._0));
    } else if (bk.$ === "Error") {
      return OkA(TyA.new_error(this.cx(), bk._0));
    } else {
      return structurally_relate_tysR(this, a, b);
    }
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3662 regions
  regions(a: RegionR, _b: RegionR): RelateResultR<RegionR> {
    return OkA(a);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3670 consts
  consts(a: ConstA, b: ConstA): RelateResultR<ConstA> {
    if (a === b) {
      return OkA(a);
    }

    // Avoid ICEs when in gce, and `structurally_relate_consts`
    // turns a non-infer const into an infer const
    if (this.tcx.features().generic_const_exprs()) {
      a = this.tcx.expand_abstract_consts(a, fold_ConstA);
      b = this.tcx.expand_abstract_consts(b, fold_ConstA);
    }

    const ak = a.kind();
    const bk = b.kind();
    if (ak.$ === "Infer" && bk.$ === "Infer") {
      return OkA(a);
    } else if (ak.$ === "Infer" || bk.$ === "Infer") {
      return ErrA({ $: "ConstMismatch", _0: ExpectedFoundR.new(a, b) });
    }

    return structurally_relate_constsR(this, a, b);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs:3697 binders
  binders<T>(a: BinderR<T>, b: BinderR<T>, d: RelateR<T>): RelateResultR<BinderR<T>> {
    const r = this.relate(BinderR.skip_binder(a), BinderR.skip_binder(b), d);
    if (r.$ === "Err") return r;
    return OkA(BinderR.rebind(a, r._0));
  }
}
