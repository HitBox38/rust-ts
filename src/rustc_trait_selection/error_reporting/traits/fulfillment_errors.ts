// Port of compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs (lanes errrep-traits-a, errrep-traits-b; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/fulfillment_errors.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { TypeErrCtxt } from "../../decls.ts";

// ==== lane errrep-traits-a: error_reporting/traits/fulfillment_errors.rs ====
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt", [
  "report_selection_error", "apply_do_not_recommend", "report_host_effect_error", "emit_specialized_closure_kind_error", "fn_arg_obligation", "detect_negative_literal", "try_conversion_context", "note_missing_impl_for_question_mark", "report_const_param_not_wf",
]);

// ==== lane errrep-traits-b: error_reporting/traits/fulfillment_errors.rs ====
// Lane errrep-traits-b ports `impl TypeErrCtxt` (fulfillment_errors.rs:1530..4136) here; its imports are kept in this
// region (separate from lane errrep-traits-a's) to keep the two lanes' edits apart.
// - Same-crate modules (traits/engine.ts, traits/select/mod.ts, traits/specialize/specialization_graph.ts,
//   error_reporting/traits/mod.ts, diagnostics.gen.ts) are read lazily (`lazy_*()` at the end): init order.
// - `rustc_transmute` is not ported (no lane yet): `Assume::from_const` / `TransmuteTypeEnv` are `unported(..)` with
//   local structural stand-ins (precedent traits/select/confirmation.ts).
// - `TyCategory::from_ty` (error_reporting/infer/mod.rs:2738, lane errrep-infer-a) is a local stand-in until that lane
//   lands (root points the use at the real port).
// - The `TypeFoldable` derives of rustc_middle's printing wrappers (`TraitClausePrintWithBoundConstness`,
//   `TraitClausePrintModifiersAndPath`), needed to print them inside a `Binder`, are local descriptors (pretty.ts has
//   none yet).
import { Applicability, DiagMessage, E0059, E0271, E0593, MultiSpan, msg, pluralize, StringPart, struct_span_code_err, type Diag } from "../../../rustc_errors/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { expr_needs_parens } from "../../../rustc_hir/hir.ts";
import { debug_Node } from "../../../rustc_hir/hir.gen.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { ToTrace_AliasTerm, ToTrace_GenericArg, ToTrace_Term, ToTrace_TraitRef, ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.gen.ts";
import { TypeTrace, type ValuePairs } from "../../../rustc_infer/infer/mod.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import { clone_Obligation, Obligation, type PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import type { MismatchedProjectionTypes } from "../../../rustc_infer/traits/project.gen.ts";
import type { Place } from "../../../rustc_middle/hir/place.ts";
import { clone_ObligationCause, ObligationCause, ObligationCauseCode, ObligationCauseCodeHandle } from "../../../rustc_middle/traits/mod.ts";
import { place_to_string_for_capture } from "../../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Predicate } from "../../../rustc_middle/ty/decls.ts";
import type { PolyProjectionClause, PolyTraitClause as PolyTraitClauseT } from "../../../rustc_type_ir/decls.ts";
import { Elaboratable_Predicate } from "../../../rustc_middle/ty/elaborate_impl.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { fold_Term, type ImplTraitHeader, type ParamEnv, type Term as TermT, Term, Ty, TypingEnv, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_PolyTraitClause, Predicate_upcast_from_TraitClause } from "../../../rustc_middle/ty/predicate.ts";
import { IrPrint_print, type Print } from "../../../rustc_middle/ty/print/mod.ts";
import {
  display_TraitRefPrintOnlyTraitPath,
  display_TraitRefPrintSugared,
  display_Ty,
  PolyTraitClause_print_modifiers_and_trait_path,
  PolyTraitClause_print_with_bound_constness,
  print_Binder,
  print_Predicate,
  print_Term,
  print_TraitClausePrintModifiersAndPath,
  print_TraitClausePrintWithBoundConstness,
  print_TraitRefPrintOnlyTraitPath,
  print_TraitRefPrintSugared,
  type TraitClausePrintModifiersAndPath,
  type TraitClausePrintWithBoundConstness,
  TraitRef_print_only_trait_path,
  TraitRef_print_trait_sugared,
  with_forced_trimmed_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { display_Const } from "../../../rustc_type_ir/ir_print.ts";
import { print_Ty } from "../../../rustc_middle/ty/print/mod.ts";
import { TraitImpls } from "../../../rustc_middle/ty/trait_def.ts";
import { sym, display_Symbol } from "../../../rustc_span/symbol.ts";
import { type CrateNum, DefId_eq, DefIdSet, type DefId, LOCAL_CRATE, type LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, Span, type ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { str_cmp } from "../../../rustc_session/options.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { AliasConst } from "../../../rustc_type_ir/ty/alias.gen.ts";
import { AliasConstKind } from "../../../rustc_type_ir/const_kind.ts";
import { elaborate } from "../../../rustc_type_ir/elaborate.ts";
import { ExpectedFound, type TypeError } from "../../../rustc_type_ir/error.ts";
import { fold_with_ExpectedFound, try_fold_with_ExpectedFound, visit_with_ExpectedFound } from "../../../rustc_type_ir/error.gen.ts";
import type { TypeFoldable, TypeFolder, PredicateProxy } from "../../../rustc_type_ir/fold.ts";
import { TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { ClosureKind, display_ClosureKind } from "../../../rustc_type_ir/lib.ts";
import {
  as_interner,
  BoundConstness,
  type ClausePolarity,
  fold_with_HostEffectClause,
  fold_with_ProjectionClause,
  fold_with_TraitClause,
  fold_with_TraitRef,
  type HostEffectClause,
  PolyTraitClause,
  ProjectionClause,
  TraitClause,
  TraitRef,
  try_fold_with_HostEffectClause,
  try_fold_with_ProjectionClause,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_HostEffectClause,
  visit_with_ProjectionClause,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import { AliasTerm, AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias, type AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTyKind } from "../../../rustc_type_ir/ty_kind.gen.ts";
import { IsRigid } from "../../../rustc_type_ir/ty_kind.gen.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, unported, unwrap } from "../../../std/panic.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { PathBuf } from "../../../rustc_span/lib.ts";
import type { ArgKind as ArgKindT, CandidateSimilarity, GetSafeTransmuteErrorAndReason, ImplCandidate } from "./mod.gen.ts";
import { clone_ImplCandidate } from "./mod.gen.ts";
import type { FulfillmentError } from "../../traits/mod.gen.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { Clauses, Const, Region } from "../../../rustc_middle/ty/decls.ts";
import type { PrettyPrinter } from "../../../rustc_middle/ty/print/pretty.ts";
import type { PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import { print_TraitRef } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import type { IntoMultiSpan } from "../../../rustc_errors/lib.ts";
import { DefKind } from "../../../rustc_hir/def.ts";
import { AliasConst as AliasConstC } from "../../../rustc_type_ir/const_kind.ts";
import type { ClosureKindMismatch } from "../../diagnostics.gen.ts";
import { unreachable } from "../../../std/panic.ts";

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx> (fulfillment_errors.rs:1530)

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1531 can_match_trait
TypeErrCtxt.prototype.can_match_trait = function (this: TypeErrCtxt, param_env: ParamEnv, goal: TraitClause, assumption: PolyTraitClauseT): boolean {
  // Fast path
  if (goal.polarity !== PolyTraitClause.polarity(assumption)) {
    return false;
  }

  const trait_assumption = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, assumption, d_TraitClause);

  return this.can_eq(param_env, goal.trait_ref, trait_assumption.trait_ref, ToTrace_TraitRef);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1551 can_match_host_effect
TypeErrCtxt.prototype.can_match_host_effect = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  goal: HostEffectClause,
  assumption_: Binder<HostEffectClause>,
): boolean {
  const assumption = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, assumption_, d_HostEffectClause);

  return BoundConstness.satisfies(assumption.constness, goal.constness) && this.can_eq(param_env, goal.trait_ref, assumption.trait_ref, ToTrace_TraitRef);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1567 as_host_effect_clause
TypeErrCtxt.as_host_effect_clause = function (predicate: Predicate): Binder<HostEffectClause> | undefined {
  const clause = predicate.as_clause();
  if (clause === undefined) return undefined;
  const kind = Binder.skip_binder(clause.kind());
  switch (kind.$) {
    case "HostEffect":
      return Binder.rebind(clause.kind(), kind._0);
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1576 can_match_projection
TypeErrCtxt.prototype.can_match_projection = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  goal: ProjectionClause,
  assumption_: PolyProjectionClause,
): boolean {
  const assumption = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, assumption_, d_ProjectionClause);

  return (
    this.can_eq(param_env, goal.projection_term, assumption.projection_term, ToTrace_AliasTerm) &&
    this.can_eq(param_env, goal.term, assumption.term, ToTrace_Term)
  );
};

// returns if `cond` not occurring implies that `error` does not occur - i.e., that
// `error` occurring implies that `cond` occurs.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1595 error_implies
TypeErrCtxt.prototype.error_implies = function (this: TypeErrCtxt, cond: Goal<Predicate>, error: Goal<Predicate>): boolean {
  // PORT: `Goal`'s derived `PartialEq` (interned `ParamEnv` / `Predicate`).
  if (cond.param_env === error.param_env && cond.predicate === error.predicate) {
    return true;
  }

  // FIXME: We could be smarter about this, i.e. if cond's param-env is a
  // subset of error's param-env. This only matters when binders will carry
  // predicates though, and obviously only matters for error reporting.
  if (cond.param_env !== error.param_env) {
    return false;
  }
  const param_env = error.param_env;

  let trait_error: PolyTraitClauseT | undefined;
  let host_error: Binder<HostEffectClause> | undefined;
  let projection_error: PolyProjectionClause | undefined;
  if ((trait_error = error.predicate.as_trait_clause()) !== undefined) {
    return this.enter_forall(
      trait_error,
      (error) => {
        for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
          const implied_ = implied.as_trait_clause();
          if (implied_ === undefined) continue;
          if (this.can_match_trait(param_env, error, implied_)) return true;
        }
        return false;
      },
      d_TraitClause,
    );
  } else if ((host_error = TypeErrCtxt.as_host_effect_clause(error.predicate)) !== undefined) {
    return this.enter_forall(
      host_error,
      (error) => {
        for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
          const implied_ = TypeErrCtxt.as_host_effect_clause(implied);
          if (implied_ === undefined) continue;
          if (this.can_match_host_effect(param_env, error, implied_)) return true;
        }
        return false;
      },
      d_HostEffectClause,
    );
  } else if ((projection_error = error.predicate.as_projection_clause()) !== undefined) {
    return this.enter_forall(
      projection_error,
      (error) => {
        for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
          const implied_ = implied.as_projection_clause();
          if (implied_ === undefined) continue;
          if (this.can_match_projection(param_env, error, implied_)) return true;
        }
        return false;
      },
      d_ProjectionClause,
    );
  } else {
    return false;
  }
};

/// Whether `error`, a projection goal, only failed because the trait goal it rests on
/// did: `<T as Trait>::Assoc == U` cannot hold when `T: Trait` doesn't, so an error on
/// the latter says everything the former would.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1638 trait_error_implies_projection_error
TypeErrCtxt.prototype.trait_error_implies_projection_error = function (this: TypeErrCtxt, cond: Goal<Predicate>, error_: Goal<Predicate>): boolean {
  if (cond.param_env !== error_.param_env) {
    return false;
  }
  const error = error_.predicate.as_projection_clause();
  if (error === undefined) {
    return false;
  }

  return this.enter_forall(
    error,
    (error) => {
      if (!AliasTermKind.is_trait_projection(error.projection_term.kind)) {
        return false;
      }
      const trait_pred: TraitClause = {
        trait_ref: AliasTerm.trait_ref(error.projection_term, as_interner(this.tcx)),
        polarity: "Positive",
      };
      // Elaborating is what pairs a failing `C: FnMut(..)` with the
      // `<C as FnOnce<..>>::Output` projection resting on it. A supertrait can hold
      // while `cond` fails though, so the projection is only covered if its own trait
      // goal is unproven too, otherwise it failed for its own reasons.
      let any = false;
      for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
        const implied_ = implied.as_trait_clause();
        if (implied_ === undefined) continue;
        if (this.can_match_trait(cond.param_env, trait_pred, implied_)) {
          any = true;
          break;
        }
      }
      return (
        any &&
        !this.predicate_must_hold_modulo_regions(Obligation.new(this.tcx, ObligationCause.dummy(), cond.param_env, trait_pred, Predicate_upcast_from_TraitClause_))
      );
    },
    d_ProjectionClause,
  );
};

// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1675 report_projection_error
TypeErrCtxt.prototype.report_projection_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  error: MismatchedProjectionTypes,
): ErrorGuaranteed {
  const predicate = this.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);

  const reported = TypeVisitableExt.error_reported(predicate, fold_Predicate);
  if (reported.$ === "Err") {
    return reported._0;
  }

  return this.probe((_) => {
    // try to find the mismatched types to report the error with.
    //
    // this can fail if the problem was higher-ranked, in which
    // cause I have no idea for a good error message.
    const bound_predicate = predicate.kind();
    let values: [AliasTermT, TermT, TermT] | undefined;
    let err: TypeError;
    const pk = Binder.skip_binder(bound_predicate);
    if (pk.$ === "Clause" && pk._0.$ === "Projection") {
      const data_ = pk._0._0;
      const ocx = lazy_engine().ObligationCtxt.new(this.infcx);

      const data = this.instantiate_binder_with_fresh_vars(
        obligation.cause.span,
        BoundRegionConversionTime.HigherRankedType,
        Binder.rebind(bound_predicate, data_),
        d_ProjectionClause,
      );
      const unnormalized_term = AliasTerm.to_term(data.projection_term, this.tcx, IsRigid.No);
      const normalized_term = ocx.normalize(obligation.cause, obligation.param_env, Unnormalized.new_wip(unnormalized_term), fold_Term);

      // constrain inference variables a bit more to nested obligations from normalize so
      // we can have more helpful errors.
      //
      // we intentionally drop errors from normalization here,
      // since the normalization is just done to improve the error message.
      void ocx.try_evaluate_obligations();

      const new_err = ocx.eq(obligation.cause, obligation.param_env, data.term, normalized_term, ToTrace_Term);
      if (new_err.$ === "Err") {
        values = [data.projection_term, this.deeply_resolve_ignoring_regions(normalized_term, fold_Term), data.term];
        err = new_err._0;
      } else {
        values = undefined;
        err = error.err;
      }
    } else {
      values = undefined;
      err = error.err;
    }

    const file: MutRef<PathBuf | undefined> = { value: undefined };
    let msg_: string;
    let span: Span;
    let closure_span: Span | undefined;
    const detailed =
      values !== undefined ? this.maybe_detailed_projection_msg(obligation.cause.span, values[0], values[1], values[2], file) : undefined;
    if (detailed !== undefined) {
      [msg_, span, closure_span] = detailed;
    } else {
      msg_ = with_forced_trimmed_paths(
        () =>
          `type mismatch resolving \`${this.tcx.short_string(this.deeply_resolve_ignoring_regions(predicate, fold_Predicate), file, print_Predicate)}\``,
      );
      span = obligation.cause.span;
      closure_span = undefined;
    }

    // When the obligation comes from a closure arg and the projection isn't FnOnceOutput
    // (which maybe_detailed_projection_msg handles via self_ty), point at the closure's
    // return expression and label the closure declaration.
    const cause_code = obligation.cause.code_();
    if (closure_span === undefined && cause_code.$ === "FunctionArg") {
      const arg_node = this.tcx.hir_node(cause_code.arg_hir_id);
      if (arg_node.$ === "Expr" && arg_node._0.kind.$ === "Closure" && arg_node._0.kind._0.kind.$ === "Closure") {
        const closure = arg_node._0.kind._0;
        const body = this.tcx.hir_body(closure.body);
        let ret_span: Span;
        const body_kind = body.value.kind;
        if (body_kind.$ === "Block" && body_kind._0.expr !== undefined) {
          ret_span = body_kind._0.expr.span;
        } else if (body_kind.$ === "Block" && body_kind._0.expr === undefined && body_kind._0.stmts.length >= 1) {
          ret_span = body_kind._0.stmts[body_kind._0.stmts.length - 1]!.span;
        } else {
          ret_span = body.value.span;
        }
        if (!Span.overlaps(closure.fn_decl_span, ret_span)) {
          closure_span = closure.fn_decl_span;
          span = ret_span;
        }
      }
    }

    const diag = struct_span_code_err(this.dcx(), span, E0271, msg_);
    diag.long_ty_path().value = file.value;
    let mention_bounds = true;
    if (closure_span !== undefined) {
      const span_ = closure_span;
      // `if let Some((_, _, expected_ty)) = values && let Some(expected_ty) = expected_ty.as_type() && ..`
      let bound_requires_itself: [DefId, Span, HirId] | undefined;
      if (values !== undefined) {
        const expected_ty = Term.as_type(values[2]);
        if (expected_ty !== undefined) {
          const ek = expected_ty.kind();
          if (ek.$ === "Closure" && Span.overlaps(this.tcx.def_span(ek._0), span_)) {
            const code = obligation.cause.code_();
            if (code.$ === "FunctionArg") {
              const parent_code = ObligationCauseCodeHandle.deref(code.parent_code);
              if (parent_code.$ === "WhereClauseInExpr" || parent_code.$ === "WhereClause") {
                bound_requires_itself = [parent_code._0, parent_code._1, code.arg_hir_id];
              }
            }
          }
        }
      }
      if (bound_requires_itself !== undefined) {
        const [def_id, span, arg_hir_id] = bound_requires_itself;
        // We have a trait bound for a closure to return itself, like
        // `T: FnOnce() -> T`. This is nonsensical, but as far as the type system is
        // concerned, valid. This is quite an edge case, but lets produce a reasonable
        // diagnostic even in the face of an unreasonable user :)
        const multispan = MultiSpan.from_span(span);
        multispan.push_span_label(span, "this requires the closure to return itself");
        const arg = this.tcx.hir_node(arg_hir_id);
        if (arg.$ === "Expr") {
          multispan.push_span_label(arg._0.span, "this closure would have to return itself");
        }
        const name = this.tcx.opt_item_name(def_id);
        const in_the_item = name !== undefined ? `in \`${display_Symbol(name)}\`` : "";
        diag.span_note(multispan, `a bound ${in_the_item} requires that a closure return itself, which is not possible`);
        mention_bounds = false;
      } else {
        // Mark the closure decl so that it is seen even if we are pointing at the
        // return type or expression.
        //
        // error[E0271]: expected `{closure@foo.rs:41:16}` to be a closure that returns
        //               `Unit3`, but it returns `Unit4`
        //   --> $DIR/foo.rs:43:17
        //    |
        // LL |     let v = Unit2.m(
        //    |                   - required by a bound introduced by this call
        // ...
        // LL |             f: |x| {
        //    |                --- /* this span */
        // LL |                 drop(x);
        // LL |                 Unit4
        //    |                 ^^^^^ expected `Unit3`, found `Unit4`
        //    |
        diag.span_label(span_, "this closure");
        if (!Span.overlaps(span_, obligation.cause.span)) {
          // Point at the binding corresponding to the closure where it is used.
          diag.span_label(obligation.cause.span, "closure used here");
        }
      }
    }

    const secondary_span = this.probe((_): [Span, string, boolean] | undefined => {
      const pk = Binder.skip_binder(predicate.kind());
      if (!(pk.$ === "Clause" && pk._0.$ === "Projection")) {
        return undefined;
      }
      const proj = pk._0._0;
      if (!AliasTermKind.is_trait_projection(proj.projection_term.kind)) {
        return undefined;
      }

      const trait_ref = this.enter_forall_and_leak_universe(
        Binder.rebind(predicate.kind(), AliasTerm.trait_ref(proj.projection_term, as_interner(this.tcx))),
        d_TraitRef,
      );
      const selection = lazy_select().SelectionContext.new(this.infcx).select(obligation.with(this.tcx, trait_ref, TraitClause_upcast_from_TraitRef));
      if (!(selection.$ === "Ok" && selection._0 !== undefined && selection._0.$ === "UserDefined")) {
        return undefined;
      }
      const impl_data = selection._0._0;

      const node_r = lazy_specialization_graph().assoc_def(this.tcx, impl_data.impl_def_id, ProjectionClause.def_id(proj));
      if (node_r.$ !== "Ok") {
        return undefined;
      }
      const node = node_r._0;

      if (!node.is_final()) {
        return undefined;
      }

      const item = this.tcx.hir_get_if_local(node.item.def_id);
      let ty: hir.Ty | undefined;
      if (item?.$ === "TraitItem" && item._0.kind.$ === "Type" && item._0.kind._1 !== undefined) {
        ty = item._0.kind._1;
      } else if (item?.$ === "ImplItem" && item._0.kind.$ === "Type") {
        ty = item._0.kind._0;
      }
      if (ty === undefined) {
        return undefined;
      }
      return [
        ty.span,
        with_forced_trimmed_paths(
          () =>
            `type mismatch resolving \`${this.tcx.short_string(this.deeply_resolve_ignoring_regions(predicate, fold_Predicate), diag.long_ty_path(), print_Predicate)}\``,
        ),
        true,
      ];
    });

    this.note_type_err(
      diag,
      obligation.cause,
      secondary_span,
      values === undefined
        ? undefined
        : obligation.param_env.and<ValuePairs>({ $: "Terms", _0: ExpectedFound.new(values[2], values[1]) }),
      err,
      false,
      span,
    );
    if (mention_bounds) {
      this.note_obligation_cause(diag, obligation);
    }
    return diag.emit_err();
  });
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1916 maybe_detailed_projection_msg
TypeErrCtxt.prototype.maybe_detailed_projection_msg = function (
  this: TypeErrCtxt,
  span_: Span,
  projection_term: AliasTermT,
  normalized_ty: TermT,
  expected_ty: TermT,
  long_ty_path: MutRef<PathBuf | undefined>,
): [string, Span, Span | undefined] | undefined {
  let span = span_;
  if (!AliasTermKind.is_trait_projection(projection_term.kind)) {
    return undefined;
  }

  const projection_def_id = AliasTerm.expect_projection_def_id(projection_term);
  const trait_def_id = AliasTerm.trait_def_id(projection_term, as_interner(this.tcx));
  const self_ty = AliasTerm.self_ty(projection_term);

  return with_forced_trimmed_paths((): [string, Span, Span | undefined] | undefined => {
    if (this.tcx.is_lang_item(projection_def_id, LangItem.FnOnceOutput)) {
      let closure_span: Span | undefined;
      const sk = self_ty.kind();
      if (sk.$ === "Closure") {
        const def_id = sk._0;
        const def_span = this.tcx.def_span(def_id);
        const local_def_id = def_id.as_local();
        if (local_def_id !== undefined) {
          const node = this.tcx.hir_node_by_def_id(local_def_id);
          const fn_decl = hir.Node.fn_decl(node);
          const id = fn_decl !== undefined ? hir.Node.body_id(node) : undefined;
          if (fn_decl !== undefined && id !== undefined) {
            switch (fn_decl.output.$) {
              case "Return":
                span = fn_decl.output._0.span;
                break;
              case "DefaultReturn": {
                const body = this.tcx.hir_body(id);
                const body_kind = body.value.kind;
                if (body_kind.$ === "Block" && body_kind._0.expr !== undefined) {
                  span = body_kind._0.expr.span;
                } else if (body_kind.$ === "Block" && body_kind._0.expr === undefined && body_kind._0.stmts.length >= 1) {
                  span = body_kind._0.stmts[body_kind._0.stmts.length - 1]!.span;
                } else {
                  span = body.value.span;
                }
                break;
              }
            }
          }
        }
        closure_span = def_span;
      } else {
        closure_span = undefined;
      }
      const sk2 = self_ty.kind();
      const item = sk2.$ === "FnDef" ? display_Symbol(this.tcx.item_name(sk2._0)) : this.tcx.short_string(self_ty, long_ty_path, print_Ty);
      const expected_ty_ = this.tcx.short_string(expected_ty, long_ty_path, print_Term);
      const normalized_ty_ = this.tcx.short_string(normalized_ty, long_ty_path, print_Term);
      return [`expected \`${item}\` to return \`${expected_ty_}\`, but it returns \`${normalized_ty_}\``, span, closure_span];
    } else if (this.tcx.is_lang_item(trait_def_id, LangItem.Future)) {
      const self_ty_ = this.tcx.short_string(self_ty, long_ty_path, print_Ty);
      const expected_ty_ = this.tcx.short_string(expected_ty, long_ty_path, print_Term);
      const normalized_ty_ = this.tcx.short_string(normalized_ty, long_ty_path, print_Term);
      return [
        `expected \`${self_ty_}\` to be a future that resolves to \`${expected_ty_}\`, but it resolves to \`${normalized_ty_}\``,
        span,
        undefined,
      ];
    } else if (opt_def_id_eq(trait_def_id, this.tcx.get_diagnostic_item(sym.Iterator))) {
      const self_ty_ = this.tcx.short_string(self_ty, long_ty_path, print_Ty);
      const expected_ty_ = this.tcx.short_string(expected_ty, long_ty_path, print_Term);
      const normalized_ty_ = this.tcx.short_string(normalized_ty, long_ty_path, print_Term);
      return [`expected \`${self_ty_}\` to be an iterator that yields \`${expected_ty_}\`, but it yields \`${normalized_ty_}\``, span, undefined];
    } else {
      return undefined;
    }
  });
};

/// returns the fuzzy category of a given type, or None
/// if the type can be equated to any type.
// PORT: the nested `fn type_category` of `fuzzy_match_tys` (no captures), at module level.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2004 type_category
function type_category(tcx: TyCtxt, t: Ty): number | undefined {
  const k = t.kind();
  switch (k.$) {
    case "Bool":
      return 0;
    case "Char":
      return 1;
    case "Str":
      return 2;
    case "Adt":
      if (tcx.is_lang_item(k._0.did(), LangItem.String)) return 2;
      return 17;
    case "Int":
    case "Uint":
    case "Float":
      return 4;
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") return 4;
      return undefined;
    case "Ref":
    case "RawPtr":
      return 5;
    case "Array":
    case "Slice":
      return 6;
    case "FnDef":
    case "FnPtr":
      return 7;
    case "Dynamic":
      return 8;
    case "Closure":
      return 9;
    case "Tuple":
      return 10;
    case "Param":
      return 11;
    case "Alias":
      switch (k._1.kind.$) {
        case "Projection":
          return 12;
        case "Inherent":
          return 13;
        case "Opaque":
          return 14;
        case "Free":
          return 15;
      }
      break;
    case "Never":
      return 16;
    case "Coroutine":
      return 18;
    case "Foreign":
      return 19;
    case "CoroutineWitness":
      return 20;
    case "CoroutineClosure":
      return 21;
    case "Pat":
      return 22;
    case "UnsafeBinder":
      return 23;
    case "Placeholder":
    case "Bound":
    case "Error":
      return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1996 fuzzy_match_tys
TypeErrCtxt.prototype.fuzzy_match_tys = function (this: TypeErrCtxt, a_: Ty, b_: Ty, ignoring_lifetimes: boolean): CandidateSimilarity | undefined {
  let a = a_;
  let b = b_;
  // fn type_category: see `type_category` above.

  const strip_references = (t_: Ty): Ty => {
    let t = t_;
    for (;;) {
      const k = t.kind();
      if (k.$ === "Ref") {
        t = k._1;
      } else if (k.$ === "RawPtr") {
        t = k._0;
      } else {
        return t;
      }
    }
  };

  if (!ignoring_lifetimes) {
    a = strip_references(a);
    b = strip_references(b);
  }

  const cat_a = type_category(this.tcx, a);
  if (cat_a === undefined) return undefined;
  const cat_b = type_category(this.tcx, b);
  if (cat_b === undefined) return undefined;
  if (a === b) {
    return { $: "Exact", ignoring_lifetimes };
  } else if (cat_a === cat_b) {
    const ak = a.kind();
    const bk = b.kind();
    let matches: boolean;
    if (ak.$ === "Adt" && bk.$ === "Adt") {
      matches = ak._0 === bk._0;
    } else if (ak.$ === "Foreign" && bk.$ === "Foreign") {
      matches = DefId_eq(ak._0, bk._0);
    } else if ((ak.$ === "Ref" || ak.$ === "RawPtr") && (bk.$ === "Ref" || bk.$ === "RawPtr")) {
      // Matching on references results in a lot of unhelpful
      // suggestions, so let's just not do that for now.
      //
      // We still upgrade successful matches to `ignoring_lifetimes: true`
      // to prioritize that impl.
      matches = this.fuzzy_match_tys(a, b, true) !== undefined;
    } else {
      matches = true;
    }
    return matches ? { $: "Fuzzy", ignoring_lifetimes } : undefined;
  } else if (ignoring_lifetimes) {
    return undefined;
  } else {
    return this.fuzzy_match_tys(a, b, true);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2077 describe_closure
TypeErrCtxt.prototype.describe_closure = function (this: TypeErrCtxt, kind: hir.ClosureKind): string {
  switch (kind.$) {
    case "Closure":
      return "a closure";
    case "Coroutine": {
      const ck = kind._0;
      if (ck.$ === "Coroutine") return "a coroutine";
      switch (ck._0) {
        case "Async":
          switch (ck._1) {
            case "Block":
              return "an async block";
            case "Fn":
              return "an async function";
            case "Closure":
              return "an async closure";
          }
          break;
        case "AsyncGen":
          switch (ck._1) {
            case "Block":
              return "an async gen block";
            case "Fn":
              return "an async gen function";
            case "Closure":
              return "an async gen closure";
          }
          break;
        case "Gen":
          switch (ck._1) {
            case "Block":
              return "a gen block";
            case "Fn":
              return "a gen function";
            case "Closure":
              return "a gen closure";
          }
          break;
      }
      break;
    }
    case "CoroutineClosure":
      switch (kind._0) {
        case "Async":
          return "an async closure";
        case "AsyncGen":
          return "an async gen closure";
        case "Gen":
          return "a gen closure";
      }
      break;
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2127 find_similar_impl_candidates
TypeErrCtxt.prototype.find_similar_impl_candidates = function (this: TypeErrCtxt, trait_def_id: DefId, self_ty: Ty): ImplCandidate[] {
  let candidates: ImplCandidate[] = [];
  for (const def_id of this.tcx.all_impls(trait_def_id)) {
    const imp_ = this.tcx.impl_trait_header(def_id) as ImplTraitHeader;
    if (imp_.polarity !== "Positive" || !this.tcx.is_user_visible_dep(def_id.krate)) {
      continue;
    }
    const imp = EarlyBinder.skip_binder(imp_.trait_ref);

    const similarity = this.fuzzy_match_tys(self_ty, TraitRef.self_ty(imp), false);
    if (similarity !== undefined) {
      candidates.push({ trait_ref: imp, similarity, impl_def_id: def_id });
    }
  }
  if (candidates.some((c) => c.similarity.$ === "Exact")) {
    // If any of the candidates is a perfect match, we don't want to show all of them.
    // This is particularly relevant for the case of numeric types (as they all have the
    // same category).
    candidates = candidates.filter((c) => c.similarity.$ === "Exact");
  }
  return candidates;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2158 report_similar_impl_candidates
TypeErrCtxt.prototype.report_similar_impl_candidates = function (
  this: TypeErrCtxt,
  impl_candidates_: readonly ImplCandidate[],
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
  body_def_id: LocalDefId,
  err: Diag,
  other_: boolean,
  param_env: ParamEnv,
): boolean {
  const parent_map = this.tcx.visible_parent_map(null);
  const alternative_candidates = (def_id: DefId): [TraitRef, DefId][] => {
    // PORT: the lazy `filter` / `map` / `filter_map` / `filter` chain, one element at a time.
    const impl_candidates: [TraitRef, DefId][] = [];
    for (const def_id_ of this.tcx.all_impls(def_id)) {
      // ignore `do_not_recommend` items
      if (this.tcx.do_not_recommend_impl(def_id_)) continue;
      // Ignore automatically derived impls and `!Trait` impls.
      const header = this.tcx.impl_trait_header(def_id_) as ImplTraitHeader;
      if (!(header.polarity === "Positive" || this.tcx.is_automatically_derived(def_id_))) continue;
      const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(header.trait_ref));
      const keep = ((): boolean => {
        const self_ty = TraitRef.self_ty(trait_ref);
        const peeled = self_ty.peel_refs().kind();
        // Avoid mentioning type parameters.
        if (self_ty.kind().$ === "Param") {
          return false;
        }
        // Avoid mentioning types that are private to another crate
        else if (peeled.$ === "Adt") {
          // FIXME(compiler-errors): This could be generalized, both to
          // be more granular, and probably look past other `#[fundamental]`
          // types, too.
          let did = peeled._0.did();
          if (Visibility.is_accessible_from(this.tcx.visibility(did), body_def_id, this.tcx)) {
            // don't suggest foreign `#[doc(hidden)]` types
            if (!did.is_local()) {
              const previously_seen_dids = new DefIdSet();
              previously_seen_dids.add(did);
              for (;;) {
                const parent = parent_map.get(did);
                if (parent === undefined || previously_seen_dids.has(parent)) break;
                if (this.tcx.is_doc_hidden(did)) {
                  return false;
                }
                previously_seen_dids.add(parent);
                did = parent;
              }
            }
            return true;
          } else {
            return false;
          }
        } else {
          return true;
        }
      })();
      if (!keep) continue;
      impl_candidates.push([trait_ref, def_id_]);
    }

    sort_by_key_stable(impl_candidates, ([tr]) => display_TraitRef(tr), str_cmp);
    dedup_by(impl_candidates, TraitRef_DefId_eq);
    return impl_candidates;
  };

  if (impl_candidates_.length === 1 && !this.tcx.do_not_recommend_impl(impl_candidates_[0]!.impl_def_id)) {
    const single = impl_candidates_[0]!;
    const self_ty_ = TraitClause.self_ty(Binder.skip_binder(trait_pred));
    if (!TypeVisitableExt.has_escaping_bound_vars(self_ty_, fold_Ty)) {
      const self_ty = this.tcx.instantiate_bound_regions_with_erased(PolyTraitClause.self_ty(trait_pred), fold_Ty);
      const sk = self_ty.kind();
      if (
        sk.$ === "Ref" &&
        this.can_eq(param_env, TraitRef.self_ty(single.trait_ref), sk._1, ToTrace_Ty) &&
        !this.where_clause_expr_matches_failed_self_ty(obligation, self_ty)
      ) {
        // Avoid pointing at a nearby impl like `String: Borrow<str>` when the
        // failing obligation comes from something nested inside an enclosing call
        // expression such as `foo(&[String::from("a")])`.
        return true;
      }
    }

    // If we have a single implementation, try to unify it with the trait ref
    // that failed. This should uncover a better hint for what *is* implemented.
    if (
      this.probe((_) => {
        const ocx = lazy_engine().ObligationCtxt.new(this.infcx);

        return this.enter_forall(
          trait_pred,
          (obligation_trait_ref) => {
            const impl_args = this.fresh_args_for_item(DUMMY_SP, single.impl_def_id);
            const impl_trait_ref_ = ocx.normalize(
              ObligationCause.dummy(),
              param_env,
              EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, single.trait_ref, d_TraitRef), this.tcx, impl_args, d_TraitRef),
              d_TraitRef,
            );

            ocx.register_obligations(
              Array.from(GenericClauses.instantiate(this.tcx.clauses_of(single.impl_def_id) as GenericClauses, this.tcx, impl_args), ([clause, _]) =>
                Obligation.new(this.tcx, ObligationCause.dummy(), param_env, Unnormalized.skip_norm_wip(clause), Predicate_upcast_from_Clause_),
              ),
            );
            if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
              return false;
            }

            const terrs: TypeError[] = [];
            const obligation_args = obligation_trait_ref.trait_ref.args;
            const impl_args_ = impl_trait_ref_.args;
            for (let i = 0; i < Math.min(obligation_args.length, impl_args_.length); i++) {
              const obligation_arg = obligation_args[i]!;
              const impl_arg = impl_args_[i]!;
              // PORT: `(obligation_arg, impl_arg).references_error()`: the tuple's visit is both elements'.
              if (TypeVisitableExt.references_error(obligation_arg, fold_GenericArg_) || TypeVisitableExt.references_error(impl_arg, fold_GenericArg_)) {
                return false;
              }
              const r = ocx.eq(ObligationCause.dummy(), param_env, impl_arg, obligation_arg, ToTrace_GenericArg);
              if (r.$ === "Err") {
                terrs.push(r._0);
              }
              if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
                return false;
              }
            }

            // Literally nothing unified, just give up.
            if (terrs.length === impl_trait_ref_.args.length) {
              return false;
            }

            const impl_trait_ref = this.deeply_resolve_ignoring_regions(impl_trait_ref_, d_TraitRef);
            if (TypeVisitableExt.references_error(impl_trait_ref, d_TraitRef)) {
              return false;
            }

            const children = err.deref().children;
            const child = children[0];
            if (child !== undefined && child.level === "Help") {
              const line_ = child.messages[0];
              const line = line_ !== undefined ? DiagMessage.as_str(line_[0]) : undefined;
              if (line !== undefined && line.startsWith("the trait") && line.includes("is not implemented for")) {
                // HACK(estebank): we remove the pre-existing
                // "the trait `X` is not implemented for" note, which only happens if there
                // was a custom label. We do this because we want that note to always be the
                // first, and making this logic run earlier will get tricky. For now, we
                // instead keep the logic the same and modify the already constructed error
                // to avoid the wording duplication.
                children.splice(0, 1);
              }
            }

            const traits = this.cmp_traits(
              TraitClause.def_id(obligation_trait_ref),
              obligation_trait_ref.trait_ref.args.slice(1),
              impl_trait_ref.def_id,
              impl_trait_ref.args.slice(1),
            );
            const traits_content = [traits[0].content(), traits[1].content()];
            const types = this.cmp(TraitClause.self_ty(obligation_trait_ref), TraitRef.self_ty(impl_trait_ref));
            const types_content = [types[0].content(), types[1].content()];
            const msg_: StringPart[] = [StringPart.normal("the trait `")];
            if (traits_content[0] === traits_content[1]) {
              msg_.push(StringPart.normal(display_TraitRefPrintSugared(TraitRef_print_trait_sugared(impl_trait_ref))));
            } else {
              msg_.push(...traits[0]._0);
            }
            msg_.push(StringPart.normal("` "), StringPart.highlighted("is not"), StringPart.normal(" implemented for `"));
            if (types_content[0] === types_content[1]) {
              const ty = this.tcx.short_string(TraitClause.self_ty(obligation_trait_ref), err.long_ty_path(), print_Ty);
              msg_.push(StringPart.normal(ty));
            } else {
              msg_.push(...types[0]._0);
            }
            msg_.push(StringPart.normal("`"));
            if (types_content[0] === types_content[1]) {
              msg_.push(StringPart.normal("\nbut trait `"));
              msg_.push(...traits[1]._0);
              msg_.push(StringPart.normal("` "), StringPart.highlighted("is"), StringPart.normal(" implemented for it"));
            } else if (traits_content[0] === traits_content[1]) {
              msg_.push(StringPart.normal("\nbut it "), StringPart.highlighted("is"), StringPart.normal(" implemented for `"));
              msg_.push(...types[1]._0);
              msg_.push(StringPart.normal("`"));
            } else {
              msg_.push(StringPart.normal("\nbut trait `"));
              msg_.push(...traits[1]._0);
              msg_.push(StringPart.normal("` "), StringPart.highlighted("is"), StringPart.normal(" implemented for `"));
              msg_.push(...types[1]._0);
              msg_.push(StringPart.normal("`"));
            }
            err.highlighted_span_help(this.tcx.def_span(single.impl_def_id), msg_);

            if (terrs.length === 1 && terrs[0]!.$ === "Sorts") {
              const exp_found = this.deeply_resolve_ignoring_regions(terrs[0]!._0, d_ExpectedFound_Ty);
              const expected = this.tcx.short_string(exp_found.expected, err.long_ty_path(), print_Ty);
              const found = this.tcx.short_string(exp_found.found, err.long_ty_path(), print_Ty);
              err.highlighted_help([
                StringPart.normal("for that trait implementation, "),
                StringPart.normal("expected `"),
                StringPart.highlighted(expected),
                StringPart.normal("`, found `"),
                StringPart.highlighted(found),
                StringPart.normal("`"),
              ]);
              this.suggest_function_pointers_impl(undefined, exp_found, err);
            }

            const pk = Binder.skip_binder(PolyTraitClause.self_ty(trait_pred)).peel_refs().kind();
            if (pk.$ === "Adt") {
              const crates = this.tcx.duplicate_crate_names(pk._0.did().krate);
              if (crates.length !== 0) {
                this.note_two_crate_versions(pk._0.did().krate, MultiSpan.new(), err);
                err.help("you can use `cargo tree` to explore your dependency tree");
              }
            }
            return true;
          },
          d_TraitClause,
        );
      })
    ) {
      return true;
    }
  }

  const other = other_ ? "other " : "";
  const report = (candidates_: [TraitRef, DefId][], err: Diag): boolean => {
    let candidates = candidates_.filter(([tr]) => !TypeVisitableExt.references_error(tr, d_TraitRef));
    if (candidates.length === 0) {
      return false;
    }
    let specific_candidates = candidates.slice();
    specific_candidates = specific_candidates.filter(([tr]) =>
      TraitRef_eq(
        TraitRef.with_replaced_self_ty(tr, as_interner(this.tcx), TraitClause.self_ty(Binder.skip_binder(trait_pred))),
        Binder.skip_binder(trait_pred).trait_ref,
      ),
    );
    if (specific_candidates.length !== 0) {
      // We have found a subset of impls that fully satisfy the expected trait, only
      // mention those types.
      candidates = specific_candidates;
    }
    if (candidates.length === 1) {
      const [cand, def_id] = candidates[0]!;
      if (this.tcx.is_diagnostic_item(sym.FromResidual, cand.def_id) && !this.tcx.features().enabled(sym.try_trait_v2)) {
        return false;
      }
      const multi_span = MultiSpan.from_span(this.tcx.def_span(def_id));
      let desc: string;
      let mention_castable: string;
      const ck = TraitRef.self_ty(cand).kind();
      const tk = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
      if (ck.$ === "FnPtr" && tk.$ === "FnDef") {
        [desc, mention_castable] = [" implemented for fn pointer `", ", cast using `as`"];
      } else if (ck.$ === "FnPtr") {
        [desc, mention_castable] = [" implemented for fn pointer `", ""];
      } else {
        const evaluate_obligations = (): TraitErrors<FulfillmentError> => {
          const ocx = lazy_engine().ObligationCtxt.new_with_diagnostics(this.infcx);
          return this.enter_forall(
            trait_pred,
            (obligation_trait_ref) => {
              const impl_args = this.fresh_args_for_item(DUMMY_SP, def_id);
              const impl_trait_ref = ocx.normalize(
                ObligationCause.dummy(),
                param_env,
                EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, cand, d_TraitRef), this.tcx, impl_args, d_TraitRef),
                d_TraitRef,
              );
              if (ocx.eq(ObligationCause.dummy(), param_env, obligation_trait_ref.trait_ref, impl_trait_ref, ToTrace_TraitRef).$ === "Err") {
                return TraitErrors.NoErrors;
              }
              ocx.register_obligations(
                Array.from(GenericClauses.instantiate(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx, impl_args), ([clause, span]) =>
                  Obligation.new(
                    this.tcx,
                    ObligationCause.dummy_with_span(span),
                    param_env,
                    Unnormalized.skip_normalization(clause),
                    Predicate_upcast_from_Clause_,
                  ),
                ),
              );
              return ocx.try_evaluate_obligations();
            },
            d_TraitClause,
          );
        };
        const failing_obligations: TraitErrors<FulfillmentError> =
          (this.tcx.clauses_of(def_id) as GenericClauses).clauses.length !== 0 ? this.probe((_) => evaluate_obligations()) : TraitErrors.NoErrors;

        if (TraitErrors.no_errors(failing_obligations)) {
          [desc, mention_castable] = [" implemented for `", ""];
        } else {
          for (const error of TraitErrors.into_iter_ref(failing_obligations)) {
            multi_span.push_span_label(
              error.root_obligation.cause.span,
              `unsatisfied requirement introduced here: \`${this.tcx.short_string(error.root_obligation.predicate, err.long_ty_path(), print_Predicate)}\``,
            );
          }

          [desc, mention_castable] = [" conditionally implemented for `", ""];
        }
      }
      const trait_ = this.tcx.short_string(TraitRef_print_trait_sugared(cand), err.long_ty_path(), print_TraitRefPrintSugared);
      const self_ty = this.tcx.short_string(TraitRef.self_ty(cand), err.long_ty_path(), print_Ty);
      err.highlighted_span_help(multi_span, [
        StringPart.normal(`the trait \`${trait_}\` `),
        StringPart.highlighted("is"),
        StringPart.normal(desc),
        StringPart.highlighted(self_ty),
        StringPart.normal("`"),
        StringPart.normal(mention_castable),
      ]);
      return true;
    }
    const trait_ref = TraitRef.identity(this.tcx, candidates[0]![0].def_id);
    // Check if the trait is the same in all cases. If so, we'll only show the type.
    const traits = candidates.map(([c]) => display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(c)));
    traits.sort(str_cmp);
    dedup_by(traits, (a, b) => a === b);
    // FIXME: this could use a better heuristic, like just checking
    // that args[1..] is the same.
    const all_traits_equal = traits.length === 1;
    const types = candidates.map(([c]) => display_Ty(TraitRef.self_ty(c)));
    types.sort(str_cmp);
    dedup_by(types, (a, b) => a === b);
    const all_types_equal = types.length === 1;

    let end = candidates.length <= 9 || this.tcx.sess.opts.verbose ? candidates.length : 8;
    if (candidates.length < 5) {
      const spans = candidates.map(([_, def_id]) => this.tcx.def_span(def_id));
      const span = MultiSpan.from_Vec(spans);
      for (const [c, def_id] of candidates) {
        let msg_: string;
        if (all_traits_equal) {
          msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}\``;
        } else if (all_types_equal) {
          msg_ = `\`${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}\``;
        } else {
          msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}\` implements \`${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}\``;
        }
        span.push_span_label(this.tcx.def_span(def_id), msg_);
      }
      let msg_: string;
      if (all_types_equal) {
        msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(candidates[0]![0]), err.long_ty_path(), print_Ty)}\` implements trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      } else {
        msg_ = `the following ${other}types implement trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      }
      err.span_help(span, msg_);
    } else {
      // When more than 5 tuples implement the same trait, the output might be very verbose
      // Instead of displaying each of these, we sort the candidates by arity in ascending
      // order, then we compute the min and the max arity, ensuring that the arities are
      // consecutive (by step of one). If these conditions are met, then the output is shown
      // as a range of tuples [tuple_min_arity:tuple_max_arity]
      let tuple_min_arity = Number.MAX_SAFE_INTEGER; // PORT: `usize::MAX` (only compared and then overwritten)
      let tuple_max_arity = 0;
      let last_arity: number | undefined = undefined;
      let all_types_tuples_cont_arity = true;
      sort_by_stable(candidates, ([c1], [c2]) => {
        const k1 = TraitRef.self_ty(c1).kind();
        const k2 = TraitRef.self_ty(c2).kind();
        if (k1.$ === "Tuple" && k2.$ === "Tuple") {
          return k1._0.length < k2._0.length ? -1 : k1._0.length > k2._0.length ? 1 : 0;
        } else {
          return 0;
        }
      });
      let candidate_names: string[] = candidates.map(([c]) => {
        if (all_traits_equal) {
          const k = TraitRef.self_ty(c).kind();
          if (all_types_tuples_cont_arity && k.$ === "Tuple" && (last_arity === undefined ? 1 : Math.abs(last_arity - k._0.length)) === 1) {
            last_arity = k._0.length;
            if (k._0.length > tuple_max_arity) {
              tuple_max_arity = k._0.length;
            }
            if (k._0.length < tuple_min_arity) {
              tuple_min_arity = k._0.length;
            }
          } else {
            all_types_tuples_cont_arity = false;
          }
          return `\n  ${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}`;
        } else if (all_types_equal) {
          return `\n  ${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}`;
        } else {
          return `\n  \`${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}\` implements \`${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}\``;
        }
      });

      let details: string;
      if (all_traits_equal && all_types_tuples_cont_arity) {
        if (tuple_min_arity === 0) {
          details = `up to tuples of arity ${tuple_max_arity}`;
        } else {
          details = `for tuples of arity ${tuple_min_arity} up to and including ${tuple_max_arity}`;
        }
      } else {
        details = "";
      }
      if (all_traits_equal && all_types_tuples_cont_arity) {
        [candidate_names, end] = [
          [
            // (T₁, T₂, …, Tₙ)
            `\n  (T\u{2081}, T\u{2082}, …, T\u{2099}) ${details}`,
          ],
          1,
        ];
      }
      let msg_: string;
      if (all_types_equal) {
        msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(candidates[0]![0]), err.long_ty_path(), print_Ty)}\` implements trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      } else {
        msg_ = `the following ${other}types implement trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      }

      err.help(
        `${msg_}:${candidate_names.slice(0, end).join("")}${candidates.length > 9 && !this.tcx.sess.opts.verbose ? `\nand ${candidates.length - 8} others` : ""}`,
      );
    }

    const pk = Binder.skip_binder(PolyTraitClause.self_ty(trait_pred)).peel_refs().kind();
    if (pk.$ === "Adt") {
      const crates = this.tcx.duplicate_crate_names(pk._0.did().krate);
      if (crates.length !== 0) {
        this.note_two_crate_versions(pk._0.did().krate, MultiSpan.new(), err);
        err.help("you can use `cargo tree` to explore your dependency tree");
      }
    }
    return true;
  };

  // we filter before checking if `impl_candidates` is empty
  // to get the fallback solution if we filtered out any impls
  const impl_candidates = impl_candidates_.map(clone_ImplCandidate).filter((cand) => !this.tcx.do_not_recommend_impl(cand.impl_def_id));

  const def_id = PolyTraitClause.def_id(trait_pred);
  if (impl_candidates.length === 0) {
    let is_lang_item = false;
    if (!this.tcx.trait_is_auto(def_id)) {
      for (const [_, id] of this.tcx.lang_items().iter()) {
        if (DefId_eq(id, def_id)) {
          is_lang_item = true;
          break;
        }
      }
    }
    if (this.tcx.trait_is_auto(def_id) || is_lang_item || this.tcx.get_diagnostic_name(def_id) !== undefined) {
      // Mentioning implementers of `Copy`, `Debug` and friends is not useful.
      return false;
    }
    return report(alternative_candidates(def_id), err);
  }

  // Sort impl candidates so that ordering is consistent for UI tests.
  // because the ordering of `impl_candidates` may not be deterministic:
  // https://github.com/rust-lang/rust/pull/57475#issuecomment-455519507
  //
  // Prefer more similar candidates first, then sort lexicographically
  // by their normalized string representation.
  const impl_candidates2: ImplCandidate[] = impl_candidates
    .map(clone_ImplCandidate)
    .filter((cand) => !TypeVisitableExt.references_error(cand.trait_ref, d_TraitRef))
    .map((cand) => {
      // Normalize the trait ref in its *own* param-env so
      // that consts are folded and any trivial projections
      // are normalized.
      const r = this.tcx.try_normalize_erasing_regions(
        TypingEnv.non_body_analysis(this.tcx, cand.impl_def_id),
        Unnormalized.new_wip(cand.trait_ref),
        d_TraitRef,
      );
      cand.trait_ref = r.$ === "Ok" ? r._0 : cand.trait_ref;
      return cand;
    });
  // PORT: `sort_by_key` with the key `(cand.similarity, len, cand.trait_ref.to_string())` (tuple `Ord`); the keys are
  // computed once per candidate (they are pure).
  sort_by_key_stable(
    impl_candidates2,
    (cand): [CandidateSimilarity, number, string] => {
      // When suggesting array types, sort them by the length of the array, not lexicographically (#135098)
      let len: number;
      const arg0 = GenericArg.kind(cand.trait_ref.args[0]!);
      const ak = arg0.$ === "Type" ? arg0._0.kind() : undefined;
      if (ak !== undefined && ak.$ === "Array") {
        // Deprioritize suggestions for parameterized arrays.
        // PORT: `u64::MAX` is `Infinity` (only compared).
        len = ak._1.try_to_target_usize(this.tcx) ?? Infinity;
      } else {
        len = 0;
      }

      return [cand.similarity, len, display_TraitRef(cand.trait_ref)];
    },
    ([s1, l1, t1], [s2, l2, t2]) => {
      const c = CandidateSimilarity_cmp(s1, s2);
      if (c !== 0) return c;
      if (l1 !== l2) return l1 < l2 ? -1 : 1;
      return str_cmp(t1, t2);
    },
  );
  const impl_candidates3: [TraitRef, DefId][] = impl_candidates2.map((cand) => [cand.trait_ref, cand.impl_def_id]);
  dedup_by(impl_candidates3, TraitRef_DefId_eq);

  return report(impl_candidates3, err);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2749 report_similar_impl_candidates_for_root_obligation
TypeErrCtxt.prototype.report_similar_impl_candidates_for_root_obligation = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_predicate: Binder<TraitClause>,
  body_def_id: LocalDefId,
  err: Diag,
): void {
  // This is *almost* equivalent to
  // `obligation.cause.code().peel_derives()`, but it gives us the
  // trait predicate for that corresponding root obligation. This
  // lets us get a derived obligation from a type parameter, like
  // when calling `string.strip_suffix(p)` where `p` is *not* an
  // implementer of `Pattern<'_>`.
  let code = obligation.cause.code_();
  let trait_pred = trait_predicate;
  let peeled = false;
  let next: [ObligationCauseCode, PolyTraitClauseT | undefined] | undefined;
  while ((next = ObligationCauseCode.parent_with_predicate(code)) !== undefined) {
    const [parent_code, parent_trait_pred] = next;
    code = parent_code;
    if (parent_trait_pred !== undefined) {
      trait_pred = parent_trait_pred;
      peeled = true;
    }
  }
  const def_id = PolyTraitClause.def_id(trait_pred);
  // Mention *all* the `impl`s for the *top most* obligation, the
  // user might have meant to use one of them, if any found. We skip
  // auto-traits or fundamental traits that might not be exactly what
  // the user might expect to be presented with. Instead this is
  // useful for less general traits.
  if (peeled && !this.tcx.trait_is_auto(def_id) && this.tcx.as_lang_item(def_id) === undefined) {
    const impl_candidates = this.find_similar_impl_candidates(PolyTraitClause.def_id(trait_pred), Binder.skip_binder(PolyTraitClause.self_ty(trait_pred)));
    this.report_similar_impl_candidates(impl_candidates, obligation, trait_pred, body_def_id, err, true, obligation.param_env);
  }
};

/// Gets the parent trait chain start
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2796 get_parent_trait_ref
TypeErrCtxt.prototype.get_parent_trait_ref = function (this: TypeErrCtxt, code: ObligationCauseCode): [Ty, Span | undefined] | undefined {
  switch (code.$) {
    case "BuiltinDerived": {
      const data = code._0;
      const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause);
      const t = this.get_parent_trait_ref(ObligationCauseCodeHandle.deref(data.parent_code));
      if (t !== undefined) {
        return t;
      } else {
        const ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
        const r = TyCategory_from_ty(this.tcx, ty);
        const span = r !== undefined ? this.tcx.def_span(r[1]) : undefined;
        return [ty, span];
      }
    }
    case "FunctionArg":
      return this.get_parent_trait_ref(ObligationCauseCodeHandle.deref(code.parent_code));
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2820 check_same_trait_different_version
TypeErrCtxt.prototype.check_same_trait_different_version = function (this: TypeErrCtxt, err: Diag, trait_pred: PolyTraitClauseT): boolean {
  const get_trait_impls = (trait_def_id: DefId): Span[] => {
    const trait_impls: Span[] = [];
    this.tcx.for_each_relevant_impl(
      trait_def_id,
      TraitClause.self_ty(Binder.skip_binder(trait_pred)),
      (impl_def_id) => {
        const impl_trait_header = this.tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
        trait_impls.push(this.tcx.def_span(EarlyBinder.skip_binder(impl_trait_header.trait_ref).def_id));
      },
      VisitorResult.unit,
    );
    return trait_impls;
  };
  return this.check_same_definition_different_crate(err, PolyTraitClause.def_id(trait_pred), this.tcx.visible_traits(), get_trait_impls, "trait");
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2847 note_two_crate_versions
TypeErrCtxt.prototype.note_two_crate_versions = function (this: TypeErrCtxt, krate: CrateNum, sp: IntoMultiSpan, err: Diag): void {
  const crate_name = this.tcx.crate_name(krate);
  const crate_msg = `there are multiple different versions of crate \`${display_Symbol(crate_name)}\` in the dependency graph`;
  err.span_note(sp, crate_msg);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2860 note_adt_version_mismatch
TypeErrCtxt.prototype.note_adt_version_mismatch = function (this: TypeErrCtxt, err: Diag, trait_pred: PolyTraitClauseT): void {
  const pk = Binder.skip_binder(PolyTraitClause.self_ty(trait_pred)).peel_refs().kind();
  if (pk.$ !== "Adt") {
    return;
  }
  const impl_self_def = pk._0;

  const impl_self_did = impl_self_def.did();

  // We only want to warn about different versions of a dependency.
  // If no dependency is involved, bail.
  if (impl_self_did.krate === LOCAL_CRATE) {
    return;
  }

  const impl_self_path = this.comparable_path(impl_self_did);
  const impl_self_crate_name = this.tcx.crate_name(impl_self_did.krate);
  // PORT: the `UnordSet<(DefId, String)>` is an array of the distinct pairs (the items are distinct map keys).
  const similar_items_: [DefId, string][] = [];
  for (const [item, _] of this.tcx.visible_parent_map(null)) {
    // If we found ourselves, ignore.
    if (DefId_eq(impl_self_did, item)) {
      continue;
    }
    // We only want to warn about different versions of a dependency.
    // Ignore items from our own crate.
    if (item.krate === LOCAL_CRATE) {
      continue;
    }
    // We want to warn about different versions of a dependency.
    // So make sure the crate names are the same.
    if (impl_self_crate_name !== this.tcx.crate_name(item.krate)) {
      continue;
    }
    // Filter out e.g. constructors that often have the same path
    // str as the relevant ADT.
    if (!DefKind.is_adt(this.tcx.def_kind(item))) {
      continue;
    }
    const path = this.comparable_path(item);
    // We don't know if our item or the one we found is the re-exported one.
    // Check both cases.
    const is_similar = path.endsWith(impl_self_path) || impl_self_path.endsWith(path);
    if (is_similar) {
      similar_items_.push([item, path]);
    }
  }

  const similar_items = similar_items_;
  sort_by_key_stable(similar_items, ([_, path]) => path, str_cmp);
  dedup_by(similar_items, ([a1, a2], [b1, b2]) => DefId_eq(a1, b1) && a2 === b2);

  for (const [similar_item, _] of similar_items) {
    err.span_help(this.tcx.def_span(similar_item), "item with same name found");
    this.note_two_crate_versions(similar_item.krate, MultiSpan.new(), err);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2918 check_same_name_different_path
TypeErrCtxt.prototype.check_same_name_different_path = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
): boolean {
  let suggested = false;
  const trait_def_id = PolyTraitClause.def_id(trait_pred);
  const trait_has_same_params = (other_trait_def_id: DefId): boolean => {
    const trait_generics = this.tcx.generics_of(trait_def_id) as Generics;
    const other_trait_generics = this.tcx.generics_of(other_trait_def_id) as Generics;

    if (trait_generics.count() !== other_trait_generics.count()) {
      return false;
    }
    const n = Math.min(trait_generics.own_params.length, other_trait_generics.own_params.length);
    for (let i = 0; i < n; i++) {
      const a = trait_generics.own_params[i]!;
      const b = other_trait_generics.own_params[i]!;
      const same =
        (a.kind.$ === "Lifetime" && b.kind.$ === "Lifetime") ||
        (a.kind.$ === "Type" && b.kind.$ === "Type") ||
        (a.kind.$ === "Const" && b.kind.$ === "Const");
      if (!same) return false;
    }
    return true;
  };
  const trait_name = this.tcx.item_name(trait_def_id);
  let other_trait_def_id: DefId | undefined;
  for (const def_id of this.tcx.all_traits_including_private()) {
    if (
      !DefId_eq(trait_def_id, def_id) &&
      trait_name === this.tcx.item_name(def_id) &&
      trait_has_same_params(def_id) &&
      // `PointeeSized` is removed during lowering.
      !this.tcx.is_lang_item(def_id, LangItem.PointeeSized) &&
      this.predicate_must_hold_modulo_regions(
        Obligation.new(
          this.tcx,
          clone_ObligationCause(obligation.cause),
          obligation.param_env,
          Binder.map_bound(trait_pred, (tr): TraitClause => ({ trait_ref: TraitRef.new(as_interner(this.tcx), def_id, tr.trait_ref.args), polarity: tr.polarity })),
          Predicate_upcast_from_PolyTraitClause_,
        ),
      )
    ) {
      other_trait_def_id = def_id;
      break;
    }
  }
  if (other_trait_def_id !== undefined) {
    err.note(
      `\`${display_PolyTy(PolyTraitClause.self_ty(trait_pred))}\` implements similarly named trait \`${this.tcx.def_path_str(other_trait_def_id)}\`, but not \`${display_Poly_TraitClausePrintModifiersAndPath(PolyTraitClause_print_modifiers_and_trait_path(trait_pred))}\``,
    );
    suggested = true;
  }
  return suggested;
};

/// If the `Self` type of the unsatisfied trait `trait_ref` implements a trait
/// with the same path as `trait_ref`, a help message about a multiple different
/// versions of the same crate is added to `err`. Otherwise if it implements another
/// trait with the same name, a note message about a similarly named trait is added to `err`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2980 note_different_trait_with_same_name
TypeErrCtxt.prototype.note_different_trait_with_same_name = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
): boolean {
  if (this.check_same_trait_different_version(err, trait_pred)) {
    return true;
  }
  return this.check_same_name_different_path(err, obligation, trait_pred);
};

/// Add a `::` prefix when comparing paths so that paths with just one item
/// like "Foo" does not equal the end of "OtherFoo".
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2994 comparable_path
TypeErrCtxt.prototype.comparable_path = function (this: TypeErrCtxt, did: DefId): string {
  return `::${this.tcx.def_path_str(did)}`;
};

/// Creates a `PredicateObligation` with `new_self_ty` replacing the existing type in the
/// `trait_ref`.
///
/// For this to work, `new_self_ty` must have no escaping bound variables.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3002 mk_trait_obligation_with_new_self_ty
TypeErrCtxt.prototype.mk_trait_obligation_with_new_self_ty = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  trait_ref_and_ty: Binder<[TraitClause, Ty]>,
): PredicateObligation {
  const trait_pred = Binder.map_bound(trait_ref_and_ty, ([tr, new_self_ty]) => TraitClause.with_replaced_self_ty(tr, as_interner(this.tcx), new_self_ty));

  return Obligation.new(this.tcx, ObligationCause.dummy(), param_env, trait_pred, Predicate_upcast_from_PolyTraitClause_);
};

// PORT: `struct ParamToVarFolder` (local to `predicate_can_apply`, fulfillment_errors.rs:3020), at module level.
class ParamToVarFolder implements TypeFolder {
  constructor(
    public infcx: InferCtxt,
    public var_map: Map<Ty, Ty>,
  ) {}

  // impl<'a, 'tcx> TypeFolder<TyCtxt<'tcx>> for ParamToVarFolder<'a, 'tcx>
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3026 cx
  cx(): TyCtxt {
    return this.infcx.tcx;
  }

  // FIXME: why don't we also instantiate const and region params with infer vars
  // here? Because diagnostics isn't soundness critical and no one bothers to be
  // pedantic yet.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3033 fold_ty
  fold_ty(ty: Ty): Ty {
    const k = ty.kind();
    if (k.$ === "Param") {
      const infcx = this.infcx;
      let v = this.var_map.get(ty);
      if (v === undefined) {
        v = infcx.next_ty_var(DUMMY_SP);
        this.var_map.set(ty, v);
      }
      return v;
    }
    // FIXME(#155345): This should automatically
    // handled by type folders instead of needing to do it
    // manually here.
    else if (k.$ === "Alias" && k._0 === IsRigid.Yes && TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_TY_PARAM, fold_Ty)) {
      const alias = fold_with_Alias(k._1, this, fold_with_AliasTyKind);
      return Ty.new_alias(this.cx(), IsRigid.No, alias);
    } else {
      return fold_Ty.super_fold_with(ty, this);
    }
  }

  // (provided) the `TypeFolder` methods `ParamToVarFolder` does not override.
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

/// Returns `true` if the trait predicate may apply for *some* assignment
/// to the type parameters.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3015 predicate_can_apply
TypeErrCtxt.prototype.predicate_can_apply = function <T>(
  this: TypeErrCtxt,
  param_env: ParamEnv,
  pred: T,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
  d_T: TypeFoldable<T>,
): boolean {
  // struct ParamToVarFolder / impl TypeFolder for ParamToVarFolder: see `ParamToVarFolder` above.

  return this.probe((_) => {
    const cleaned_pred_ = d_T.fold_with(pred, new ParamToVarFolder(this.infcx, new Map()));

    const { value: cleaned_pred } = this.infcx.at(ObligationCause.dummy(), param_env).normalize(Unnormalized.new_wip(cleaned_pred_), d_T);

    const obligation = Obligation.new(this.tcx, ObligationCause.dummy(), param_env, cleaned_pred, upcast_from_T);

    return this.predicate_may_hold(obligation);
  });
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3070 suggest_change_mut_ref_for_closure
TypeErrCtxt.prototype.suggest_change_mut_ref_for_closure = function (this: TypeErrCtxt, err: Diag, obligation_: PredicateObligation): void {
  const code = obligation_.cause.code_();
  if (code.$ !== "FunctionArg") return;
  const [, root_trait_pred] = ObligationCauseCode.peel_derives_with_predicate(obligation_.cause.code_());
  if (root_trait_pred === undefined) return;
  const arg = this.tcx.hir_node(code.arg_hir_id);
  if (arg.$ !== "Expr") return;
  if (arg._0.kind.$ === "AddrOf" && arg._0.kind._0 === "Ref" && arg._0.kind._1 === "Not") {
    const obligation = clone_Obligation(obligation_, (p) => p);
    // Error reporting may narrow the cause span to the borrow's operand.
    // Use the whole argument so `suggest_change_mut` can replace the shared borrow.
    obligation.cause.span = arg._0.span;
    this.suggest_change_mut(obligation, err, root_trait_pred);
  }
};

/// Register when multiple obligations come from the same statement and only emit one.
///
/// This can significantly reduce the number of `_: Sized` failures on method chains.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3092 silence_redundant_cause
TypeErrCtxt.prototype.silence_redundant_cause = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  root_obligation: PredicateObligation,
): void {
  const code = root_obligation.cause.code_();
  let hir_id: HirId;
  if (code.$ === "WellFormed" && code._0.$ === "HirId") {
    hir_id = code._0._0;
  } else if (code.$ === "VariableType" || code.$ === "SizedCallReturnType") {
    hir_id = code._0;
  } else if (code.$ === "WhereClauseInExpr") {
    hir_id = code._2;
  } else if (code.$ === "WellFormed" && code._0.$ === "Param") {
    hir_id = this.tcx.local_def_id_to_hir_id(code._0.function);
  } else {
    return;
  }

  // The lifetimes for different sub-expressions would be different inference variables.
  const pred = this.tcx.erase_and_anonymize_regions(obligation.predicate, fold_Predicate);

  // Registering the expression itself is necessary to catch tail expressions and literals.
  const preds = this.reported_hir_errors.get(hir_id);
  if (preds !== undefined && preds.has(pred)) {
    err.downgrade_to_delayed_bug();
  } else {
    hir_id_map_entry_or_default(this.reported_hir_errors, hir_id).add(pred);
  }

  // Look for the expression's parent statement, bail otherwise. We'll register the predicate
  // against the statement's HirId.
  for (const [_, node] of this.tcx.hir_parent_iter(hir_id)) {
    let hir_id: HirId;
    switch (node.$) {
      case "LetStmt":
        hir_id = node._0.hir_id;
        break;
      case "Stmt":
        hir_id = node._0.hir_id;
        break;
      case "Crate":
      case "Item":
      case "ImplItem":
      case "TraitItem":
        return;
      default:
        continue;
    }
    const preds = this.reported_hir_errors.get(hir_id);
    if (preds !== undefined && preds.has(pred)) {
      err.downgrade_to_delayed_bug();
    } else {
      hir_id_map_entry_or_default(this.reported_hir_errors, hir_id).add(pred);
    }
    break;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3144 note_obligation_cause
TypeErrCtxt.prototype.note_obligation_cause = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation): void {
  // First, attempt to add note to this error with an async-await-specific
  // message, and fall back to regular note otherwise.
  if (!this.maybe_note_obligation_cause_for_async_await(err, obligation)) {
    this.note_obligation_cause_code(
      obligation.cause.body_def_id,
      err,
      obligation.predicate,
      obligation.param_env,
      obligation.cause.code_(),
      [],
      new DefIdSet(),
      upcast_from_self,
    );
    this.suggest_swapping_lhs_and_rhs(err, obligation.predicate, obligation.param_env, obligation.cause.code_(), upcast_from_self);
    this.suggest_borrow_for_unsized_closure_return(obligation.cause.body_def_id, err, obligation.predicate);
    this.suggest_unsized_bound_if_applicable(err, obligation);
    const span = err.deref().span.primary_span();
    if (span !== undefined && this.tcx.resolutions(null).paths_matching_assoc_types.has(Span.with_parent(span, undefined))) {
      err.subdiagnostic(lazy_diagnostics().AssocTypeWithSameName_subdiagnostic({ span: Span.shrink_to_lo(span) }));
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3185 is_recursive_obligation
TypeErrCtxt.prototype.is_recursive_obligation = function (this: TypeErrCtxt, obligated_types: Ty[], cause_code: ObligationCauseCode): boolean {
  if (cause_code.$ === "BuiltinDerived") {
    const data = cause_code._0;
    const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause);
    const self_ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
    if (obligated_types.some((ot) => ot === self_ty)) {
      return true;
    }
    const sk = self_ty.kind();
    if (sk.$ === "Adt" && sk._1.length === 1) {
      const arg = GenericArg.kind(sk._1[0]!);
      if (arg.$ === "Type") {
        const ik = arg._0.kind();
        if (ik.$ === "Adt" && ik._0 === sk._0) {
          return true;
        }
      }
    }
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3208 get_standard_error_message
TypeErrCtxt.prototype.get_standard_error_message = function (
  this: TypeErrCtxt,
  trait_predicate: PolyTraitClauseT,
  predicate_constness: BoundConstness | undefined,
  post_message: string,
  long_ty_path: MutRef<PathBuf | undefined>,
): string {
  return `the trait bound \`${this.tcx.short_string(
    PolyTraitClause_print_with_bound_constness(trait_predicate, predicate_constness),
    long_ty_path,
    print_Poly_TraitClausePrintWithBoundConstness,
  )}\` is not satisfied${post_message}`;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3224 select_transmute_obligation_for_reporting
TypeErrCtxt.prototype.select_transmute_obligation_for_reporting = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClauseT,
  root_obligation: PredicateObligation,
): [PredicateObligation, PolyTraitClauseT] {
  if (TypeVisitableExt.has_non_region_param(obligation.predicate, fold_Predicate) || TypeVisitableExt.has_non_region_infer(obligation, d_PredicateObligation())) {
    return [clone_Obligation(obligation, (p) => p), trait_predicate];
  }

  const ocx = lazy_engine().ObligationCtxt.new(this.infcx);
  const normalized_predicate = this.tcx.erase_and_anonymize_regions(this.tcx.instantiate_bound_regions_with_erased(trait_predicate, d_TraitClause), d_TraitClause);
  const trait_ref = normalized_predicate.trait_ref;

  const assume_ct = ocx.normalize(obligation.cause, obligation.param_env, Unnormalized.new_wip(trait_ref.args.const_at(2)), fold_Const);

  // PORT: rustc_transmute is not ported (no lane yet).
  void assume_ct;
  const assume = unported("rustc_transmute::Assume::from_const") as TransmuteAssume | undefined;
  if (assume === undefined) {
    return [clone_Obligation(obligation, (p) => p), trait_predicate];
  }

  // let is_normalized_yes = matches!(rustc_transmute::TransmuteTypeEnv::new(self.tcx).is_transmutable(
  //     trait_ref.args.type_at(1), trait_ref.args.type_at(0), assume), rustc_transmute::Answer::Yes);
  void [trait_ref.args.type_at(1), trait_ref.args.type_at(0)];
  const is_normalized_yes = (unported("rustc_transmute::TransmuteTypeEnv::is_transmutable") as TransmuteAnswer).$ === "Yes";

  // If the normalized check unexpectedly passes, fall back to root obligation for reporting.
  if (is_normalized_yes) {
    const rk = Binder.skip_binder(root_obligation.predicate.kind());
    if (rk.$ === "Clause" && rk._0.$ === "Trait") {
      const root_pred = rk._0._0;
      if (DefId_eq(TraitClause.def_id(root_pred), PolyTraitClause.def_id(trait_predicate))) {
        return [clone_Obligation(root_obligation, (p) => p), Binder.rebind(root_obligation.predicate.kind(), root_pred)];
      }
    }
  }

  return [clone_Obligation(obligation, (p) => p), trait_predicate];
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3271 get_safe_transmute_error_and_reason
TypeErrCtxt.prototype.get_safe_transmute_error_and_reason = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_pred_: PolyTraitClauseT,
  span: Span,
): GetSafeTransmuteErrorAndReason {
  // use rustc_transmute::Answer;
  return this.probe((_): GetSafeTransmuteErrorAndReason => {
    // We don't assemble a transmutability candidate for types that are generic
    // and we should have ambiguity for types that still have non-region infer.
    if (TypeVisitableExt.has_non_region_param(obligation.predicate, fold_Predicate) || TypeVisitableExt.has_non_region_infer(obligation, d_PredicateObligation())) {
      return { $: "Default" };
    }

    // Erase regions because layout code doesn't particularly care about regions.
    const trait_pred = this.tcx.erase_and_anonymize_regions(this.tcx.instantiate_bound_regions_with_erased(trait_pred_, d_TraitClause), d_TraitClause);

    const ocx = lazy_engine().ObligationCtxt.new(this.infcx);
    const assume_ct = ocx.normalize(obligation.cause, obligation.param_env, Unnormalized.new_wip(trait_pred.trait_ref.args.const_at(2)), fold_Const);

    // PORT: rustc_transmute is not ported (no lane yet).
    void assume_ct;
    const assume = unported("rustc_transmute::Assume::from_const") as TransmuteAssume | undefined;
    if (assume === undefined) {
      this.dcx().span_delayed_bug(span, "Unable to construct rustc_transmute::Assume where it was previously possible");
      return { $: "Silent" };
    }

    const dst = trait_pred.trait_ref.args.type_at(0);
    const src = trait_pred.trait_ref.args.type_at(1);
    const err_msg = `\`${display_Ty(src)}\` cannot be safely transmuted into \`${display_Ty(dst)}\``;

    const answer = unported("rustc_transmute::TransmuteTypeEnv::is_transmutable") as TransmuteAnswer;
    switch (answer.$) {
      case "No": {
        const reason = answer._0;
        let safe_transmute_explanation: string;
        switch (reason.$) {
          case "SrcIsNotYetSupported":
            safe_transmute_explanation = `analyzing the transmutability of \`${display_Ty(src)}\` is not yet supported`;
            break;
          case "DstIsNotYetSupported":
            safe_transmute_explanation = `analyzing the transmutability of \`${display_Ty(dst)}\` is not yet supported`;
            break;
          case "DstIsBitIncompatible":
            safe_transmute_explanation = `at least one value of \`${display_Ty(src)}\` isn't a bit-valid value of \`${display_Ty(dst)}\``;
            break;
          case "DstUninhabited":
            safe_transmute_explanation = `\`${display_Ty(dst)}\` is uninhabited`;
            break;
          case "DstMayHaveSafetyInvariants":
            safe_transmute_explanation = `\`${display_Ty(dst)}\` may carry safety invariants`;
            break;
          case "DstIsTooBig":
            safe_transmute_explanation = `the size of \`${display_Ty(src)}\` is smaller than the size of \`${display_Ty(dst)}\``;
            break;
          case "DstRefIsTooBig": {
            const { src, src_size, dst, dst_size } = reason;
            safe_transmute_explanation = `the size of \`${display_Ty(src)}\` (${src_size} bytes) is smaller than that of \`${display_Ty(dst)}\` (${dst_size} bytes)`;
            break;
          }
          case "SrcSizeOverflow":
            safe_transmute_explanation = `values of the type \`${display_Ty(src)}\` are too big for the target architecture`;
            break;
          case "DstSizeOverflow":
            safe_transmute_explanation = `values of the type \`${display_Ty(dst)}\` are too big for the target architecture`;
            break;
          case "DstHasStricterAlignment": {
            const { src_min_align, dst_min_align } = reason;
            safe_transmute_explanation = `the minimum alignment of \`${display_Ty(src)}\` (${src_min_align}) should be greater than that of \`${display_Ty(dst)}\` (${dst_min_align})`;
            break;
          }
          case "DstIsMoreUnique":
            safe_transmute_explanation = `\`${display_Ty(src)}\` is a shared reference, but \`${display_Ty(dst)}\` is a unique reference`;
            break;
          // Already reported by rustc
          case "TypeError":
            return { $: "Silent" };
          case "SrcLayoutUnknown":
            safe_transmute_explanation = `\`${display_Ty(src)}\` has an unknown layout`;
            break;
          case "DstLayoutUnknown":
            safe_transmute_explanation = `\`${display_Ty(dst)}\` has an unknown layout`;
            break;
        }
        return { $: "Error", err_msg, safe_transmute_explanation };
      }
      // Should never get a Yes at this point! We already ran it before, and did not get a Yes.
      case "Yes":
        return span_bug(span, "Inconsistent rustc_transmute::is_transmutable(...) result, got Yes");
      // Reached when a different obligation (namely `Freeze`) causes the
      // transmutability analysis to fail. In this case, silence the
      // transmutability error message in favor of that more specific
      // error.
      case "If":
        return { $: "Error", err_msg, safe_transmute_explanation: undefined };
    }
  });
};

/// If `found_ty` is a reference that can be explicitly cast to another reference type for which
/// a `From` / `TryFrom` impl exists for `self_ty`, return that type.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3404 find_explicit_cast_type
TypeErrCtxt.prototype.find_explicit_cast_type = function (this: TypeErrCtxt, param_env: ParamEnv, found_ty: Ty, self_ty: Ty): Ty | undefined {
  const fk = found_ty.kind();
  if (fk.$ !== "Ref") {
    return undefined;
  }
  const [region, inner_ty, mutbl] = [fk._0, fk._1, fk._2];

  const derefs = this.autoderef_steps(inner_ty)[Symbol.iterator]();
  derefs.next(); // skip the first one, which is inner_ty itself
  const next = derefs.next();
  if (next.done) return undefined;
  const deref_target = next.value[0];

  const cast_ty = Ty.new_ref(this.tcx, region, deref_target, mutbl);

  const from_def_id = this.tcx.get_diagnostic_item(sym.From);
  if (from_def_id === undefined) {
    return undefined;
  }
  const try_from_def_id = this.tcx.get_diagnostic_item(sym.TryFrom);
  if (try_from_def_id === undefined) {
    return undefined;
  }

  if (this.has_impl_for_type(param_env, TraitRef.new(as_interner(this.tcx), from_def_id, this.tcx.mk_args([self_ty, cast_ty])))) {
    return cast_ty;
  } else if (this.has_impl_for_type(param_env, TraitRef.new(as_interner(this.tcx), try_from_def_id, this.tcx.mk_args([self_ty, cast_ty])))) {
    return cast_ty;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3450 has_impl_for_type
TypeErrCtxt.prototype.has_impl_for_type = function (this: TypeErrCtxt, param_env: ParamEnv, trait_ref: TraitRef): boolean {
  const obligation = Obligation.new(this.tcx, ObligationCause.dummy(), param_env, { trait_ref, polarity: "Positive" } satisfies TraitClause, Predicate_upcast_from_TraitClause_);

  return this.predicate_must_hold_modulo_regions(obligation);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3465 add_tuple_trait_message
TypeErrCtxt.prototype.add_tuple_trait_message = function (this: TypeErrCtxt, obligation_cause_code: ObligationCauseCode, err: Diag): void {
  if (obligation_cause_code.$ === "RustCall") {
    err.primary_message('functions with the "rust-call" ABI must take a single non-self tuple argument');
  } else if (obligation_cause_code.$ === "WhereClause" && this.tcx.is_fn_trait(obligation_cause_code._0)) {
    err.code(E0059);
    err.primary_message(`type parameter to bare \`${this.tcx.def_path_str(obligation_cause_code._0)}\` trait must be a tuple`);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3485 try_to_add_help_message
TypeErrCtxt.prototype.try_to_add_help_message = function (
  this: TypeErrCtxt,
  root_obligation: PredicateObligation,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClauseT,
  err: Diag,
  span_: Span,
  is_fn_trait: boolean,
  suggested: boolean,
): void {
  const body_def_id = obligation.cause.body_def_id;
  const code = obligation.cause.code_();
  const span = code.$ === "BinOp" ? code.rhs_span : span_;

  // Try to report a help message
  const trait_def_id = PolyTraitClause.def_id(trait_predicate);
  let fn_trait: Result<[ClosureKind, Binder<Ty>], undefined> | undefined;
  if (
    is_fn_trait &&
    (fn_trait = this.type_implements_fn_trait(obligation.param_env, PolyTraitClause.self_ty(trait_predicate), Binder.skip_binder(trait_predicate).polarity))
      .$ === "Ok"
  ) {
    const [implemented_kind, params] = fn_trait._0;
    this.add_help_message_for_fn_trait(trait_predicate, err, implemented_kind, params);
  } else if (
    !TypeVisitableExt.has_non_region_infer(trait_predicate, d_PolyTraitClause) &&
    this.predicate_can_apply(obligation.param_env, trait_predicate, Predicate_upcast_from_PolyTraitClause_, d_PolyTraitClause)
  ) {
    // If a where-clause may be useful, remind the
    // user that they can add it.
    //
    // don't display an on-unimplemented note, as
    // these notes will often be of the form
    //     "the type `T` can't be frobnicated"
    // which is somewhat confusing.
    this.suggest_restricting_param_bound(err, trait_predicate, undefined, obligation.cause.body_def_id);
  } else if (
    trait_def_id.is_local() &&
    TraitImpls.is_empty(this.tcx.trait_impls_of(trait_def_id) as TraitImpls) &&
    !this.tcx.trait_is_auto(trait_def_id) &&
    !this.tcx.trait_is_alias(trait_def_id) &&
    PolyTraitClause.polarity(trait_predicate) === "Positive"
  ) {
    err.span_help(this.tcx.def_span(trait_def_id), msg("this trait has no implementations, consider adding one"));
  } else if (!suggested && PolyTraitClause.polarity(trait_predicate) === "Positive") {
    // Can't show anything else useful, try to find similar impls.
    const impl_candidates = this.find_similar_impl_candidates(PolyTraitClause.def_id(trait_predicate), Binder.skip_binder(PolyTraitClause.self_ty(trait_predicate)));
    if (!this.report_similar_impl_candidates(impl_candidates, obligation, trait_predicate, body_def_id, err, true, obligation.param_env)) {
      this.report_similar_impl_candidates_for_root_obligation(obligation, trait_predicate, body_def_id, err);
    }

    this.suggest_convert_to_slice(err, obligation, trait_predicate, impl_candidates, span);

    this.suggest_tuple_wrapping(err, root_obligation, obligation);
  }
  this.suggest_shadowed_inherent_method(err, obligation, trait_predicate);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3574 add_help_message_for_fn_trait
TypeErrCtxt.prototype.add_help_message_for_fn_trait = function (
  this: TypeErrCtxt,
  trait_pred: PolyTraitClauseT,
  err: Diag,
  implemented_kind: ClosureKind,
  params: Binder<Ty>,
): void {
  // If the type implements `Fn`, `FnMut`, or `FnOnce`, suppress the following
  // suggestion to add trait bounds for the type, since we only typically implement
  // these traits once.

  // Note if the `FnMut` or `FnOnce` is less general than the trait we're trying
  // to implement.
  const selected_kind = unwrap(this.tcx.fn_trait_kind_from_def_id(PolyTraitClause.def_id(trait_pred)), "expected to map DefId to ClosureKind");
  if (!ClosureKind.extends(implemented_kind, selected_kind)) {
    err.note(
      `\`${display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)))}\` implements \`${display_ClosureKind(implemented_kind)}\`, but it must implement \`${display_ClosureKind(selected_kind)}\`, which is more general`,
    );
  }

  // Note any argument mismatches
  const gk = Binder.skip_binder(params).kind();
  if (gk.$ !== "Tuple") {
    return;
  }
  const given = gk._0;

  const expected_ty_ = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1);
  const ek = expected_ty_.kind();
  if (ek.$ !== "Tuple") {
    return;
  }
  const expected = ek._0;

  if (expected.length !== given.length) {
    // Note number of types that were expected and given
    err.note(
      `expected a closure taking ${given.length} argument${pluralize(given.length)}, but one taking ${expected.length} argument${pluralize(expected.length)} was given`,
    );
    return;
  }

  const given_ty = Ty.new_fn_ptr(this.tcx, Binder.rebind(params, this.tcx.mk_fn_sig_safe_rust_abi(given, this.tcx.types.unit)));
  const expected_ty = Ty.new_fn_ptr(this.tcx, Binder.rebind(trait_pred, this.tcx.mk_fn_sig_safe_rust_abi(expected, this.tcx.types.unit)));

  if (!this.same_type_modulo_infer(given_ty, expected_ty, ToTrace_Ty)) {
    // Print type mismatch
    const [expected_args, given_args] = this.cmp(expected_ty, given_ty);
    err.note_expected_found("a closure with signature", expected_args, "a closure with signature", given_args);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3643 report_closure_error
TypeErrCtxt.prototype.report_closure_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  closure_def_id: DefId,
  found_kind: ClosureKind,
  kind: ClosureKind,
  trait_prefix: string,
  kind_origin: [Span, Place] | undefined,
): Diag {
  const closure_span = this.tcx.def_span(closure_def_id);

  const err: ClosureKindMismatch = {
    closure_span,
    expected: kind,
    found: found_kind,
    cause_span: obligation.cause.span,
    trait_prefix,
    fn_once_label: undefined,
    fn_mut_label: undefined,
  };

  // Additional context information explaining why the closure only implements
  // a particular trait.
  const origin =
    kind_origin ??
    ((): [Span, Place] | undefined => {
      const typeck_results = this.typeck_results;
      if (typeck_results === undefined) return undefined;
      const local_def_id = closure_def_id.as_local();
      if (local_def_id === undefined) return undefined;
      const hir_id = this.tcx.local_def_id_to_hir_id(local_def_id);
      return typeck_results.closure_kind_origins().get(hir_id);
    })();

  if (found_kind === "FnOnce" && origin !== undefined) {
    const [span, place] = origin;
    err.fn_once_label = {
      span,
      place: place_to_string_for_capture(this.tcx, place),
      trait_prefix,
    };
  } else if (found_kind === "FnMut" && origin !== undefined) {
    const [span, place] = origin;
    err.fn_mut_label = {
      span,
      place: place_to_string_for_capture(this.tcx, place),
      trait_prefix,
    };
  }
  return this.dcx().create_err(lazy_diagnostics().ClosureKindMismatch_diagnostic(err));
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3693 report_cyclic_signature_error
TypeErrCtxt.prototype.report_cyclic_signature_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  found_trait_ref: TraitRef,
  expected_trait_ref: TraitRef,
  terr_: TypeError,
): Diag {
  const self_ty = TraitRef.self_ty(found_trait_ref);
  const sk = self_ty.kind();
  let cause: ObligationCause;
  let terr: TypeError;
  if (sk.$ === "Closure") {
    [cause, terr] = [ObligationCause.dummy_with_span(this.tcx.def_span(sk._0)), { $: "CyclicTy", _0: self_ty }];
  } else {
    [cause, terr] = [clone_ObligationCause(obligation.cause), terr_];
  }
  return this.report_and_explain_type_error(TypeTrace.trait_refs(cause, expected_trait_ref, found_trait_ref), obligation.param_env, terr);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3716 report_signature_mismatch_error
TypeErrCtxt.prototype.report_signature_mismatch_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  span: Span,
  found_trait_ref_: TraitRef,
  expected_trait_ref_: TraitRef,
): Result<Diag, ErrorGuaranteed> {
  const found_trait_ref = this.deeply_resolve_ignoring_regions(found_trait_ref_, d_TraitRef);
  const expected_trait_ref = this.deeply_resolve_ignoring_regions(expected_trait_ref_, d_TraitRef);

  const reported = TypeVisitableExt.error_reported(TraitRef.self_ty(expected_trait_ref), fold_Ty);
  if (reported.$ === "Err") return reported;
  const found_trait_ty = TraitRef.self_ty(found_trait_ref);

  const fk = found_trait_ty.kind();
  const found_did = fk.$ === "Closure" || fk.$ === "FnDef" || fk.$ === "Coroutine" ? fk._0 : undefined;

  const found_node = found_did !== undefined ? this.tcx.hir_get_if_local(found_did) : undefined;
  const found_span = found_did !== undefined ? this.tcx.hir_span_if_local(found_did) : undefined;

  if (!keyed_set_insert(this.reported_signature_mismatch, [span, found_span])) {
    // We check closures twice, with obligations flowing in different directions,
    // but we want to complain about them only once.
    return Err(this.dcx().span_delayed_bug(span, "already_reported"));
  }

  let not_tupled = false;

  const ArgKind = lazy_traits_mod().ArgKind;
  let found: ArgKindT[];
  const found_k = found_trait_ref.args.type_at(1).kind();
  if (found_k.$ === "Tuple") {
    found = Array.from({ length: found_k._0.length }, () => ArgKind.empty());
  } else {
    not_tupled = true;
    found = [ArgKind.empty()];
  }

  const expected_ty = expected_trait_ref.args.type_at(1);
  let expected: ArgKindT[];
  const expected_k = expected_ty.kind();
  if (expected_k.$ === "Tuple") {
    expected = expected_k._0.map((t) => ArgKind.from_expected_ty(t, span));
  } else {
    not_tupled = true;
    expected = [{ $: "Arg", _0: "_", _1: display_Ty(expected_ty) }];
  }

  // If this is a `Fn` family trait and either the expected or found
  // is not tupled, then fall back to just a regular mismatch error.
  // This shouldn't be common unless manually implementing one of the
  // traits manually, but don't make it more confusing when it does
  // happen.
  if (!this.tcx.is_lang_item(expected_trait_ref.def_id, LangItem.Coroutine) && not_tupled) {
    return Ok(
      this.report_and_explain_type_error(TypeTrace.trait_refs(obligation.cause, expected_trait_ref, found_trait_ref), obligation.param_env, {
        $: "Mismatch",
      }),
    );
  }
  if (found.length !== expected.length) {
    const r = ((): [Span | undefined, Span | undefined, ArgKindT[]] | undefined => {
      if (found_did === undefined) return undefined;
      const node = this.tcx.hir_get_if_local(found_did);
      if (node === undefined) return undefined;
      const args = this.get_fn_like_arguments(node);
      if (args === undefined) return undefined;
      const [found_span, closure_arg_span, found] = args;
      return [found_span, closure_arg_span, found];
    })();
    const [closure_span, closure_arg_span, found_] = r ?? [found_span, undefined, found];

    // If the coroutine take a single () as its argument,
    // the trait argument would found the coroutine take 0 arguments,
    // but get_fn_like_arguments would give 1 argument.
    // This would result in "Expected to take 1 argument, but it takes 1 argument".
    // Check again to avoid this.
    if (found_.length !== expected.length) {
      return Ok(this.report_arg_count_mismatch(span, closure_span, expected, found_, found_trait_ty.is_closure(), closure_arg_span));
    }
  }
  return Ok(
    this.report_closure_arg_mismatch(span, found_span, found_trait_ref, expected_trait_ref, obligation.cause.code_(), found_node, obligation.param_env),
  );
};

/// Given some node representing a fn-like thing in the HIR map,
/// returns a span and `ArgKind` information that describes the
/// arguments it expects. This can be supplied to
/// `report_arg_count_mismatch`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3816 get_fn_like_arguments
TypeErrCtxt.prototype.get_fn_like_arguments = function (this: TypeErrCtxt, node: hir.Node): [Span, Span | undefined, ArgKindT[]] | undefined {
  const ArgKind = lazy_traits_mod().ArgKind;
  const sm = this.tcx.sess.source_map();
  if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const { body, fn_decl_span, fn_arg_span } = node._0.kind._0;
    const args: ArgKindT[] = [];
    for (const arg of this.tcx.hir_body(body).params) {
      const pat = arg.pat;
      let kind: ArgKindT | undefined;
      if (pat.kind.$ === "Tuple") {
        const span = pat.span;
        const fields: [string, string][] = [];
        let all = true;
        for (const p of pat.kind._0) {
          const snippet = sm.span_to_snippet(p.span);
          if (snippet.$ !== "Ok") {
            all = false;
            break;
          }
          fields.push([snippet._0.toString(), "_"]);
        }
        kind = all ? { $: "Tuple", _0: span, _1: fields } : undefined;
      } else {
        const name = sm.span_to_snippet(pat.span);
        kind = name.$ === "Ok" ? { $: "Arg", _0: name._0.toString(), _1: "_" } : undefined;
      }
      if (kind === undefined) return undefined;
      args.push(kind);
    }
    return [fn_decl_span, fn_arg_span, args];
  }
  let sig: hir.FnSig | undefined;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    sig = node._0.kind.sig;
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
  } else if (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
  }
  if (sig !== undefined) {
    return [
      sig.span,
      undefined,
      sig.decl.inputs.map((arg): ArgKindT => {
        if (arg.kind.$ === "Tup") {
          return { $: "Tuple", _0: arg.span, _1: Array.from({ length: arg.kind._0.length }, (): [string, string] => ["_", "_"]) };
        } else {
          return ArgKind.empty();
        }
      }),
    ];
  }
  if (node.$ === "Ctor") {
    const variant_data = node._0;
    const id = hir.VariantData.ctor_hir_id(variant_data);
    const span = id === undefined ? DUMMY_SP : this.tcx.hir_span(id);
    return [span, undefined, Array.from({ length: hir.VariantData.fields(variant_data).length }, () => ArgKind.empty())];
  }
  return panic(`non-FnLike node found: ${debug_Node(node, PLAIN)}`);
};

/// Reports an error when the number of arguments needed by a
/// trait match doesn't match the number that the expression
/// provides.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3886 report_arg_count_mismatch
TypeErrCtxt.prototype.report_arg_count_mismatch = function (
  this: TypeErrCtxt,
  span: Span,
  found_span: Span | undefined,
  expected_args: ArgKindT[],
  found_args: ArgKindT[],
  is_closure: boolean,
  closure_arg_span: Span | undefined,
): Diag {
  const kind = is_closure ? "closure" : "function";

  const args_str = (arguments_: readonly ArgKindT[], other: readonly ArgKindT[]): string => {
    const arg_length = arguments_.length;
    const distinct = other.length === 1 && other[0]!.$ === "Tuple";
    const first = arguments_[0];
    if (arg_length === 1 && first !== undefined && first.$ === "Tuple") {
      return `a single ${first._1.length}-tuple as argument`;
    } else {
      return `${arg_length} ${distinct && arg_length > 1 ? "distinct " : ""}argument${pluralize(arg_length)}`;
    }
  };

  const expected_str = args_str(expected_args, found_args);
  const found_str = args_str(found_args, expected_args);

  const err = struct_span_code_err(this.dcx(), span, E0593, `${kind} is expected to take ${expected_str}, but it takes ${found_str}`);

  err.span_label(span, `expected ${kind} that takes ${expected_str}`);

  if (found_span !== undefined) {
    err.span_label(found_span, `takes ${found_str}`);

    // Suggest to take and ignore the arguments with expected_args_length `_`s if
    // found arguments is empty (assume the user just wants to ignore args in this case).
    // For example, if `expected_args_length` is 2, suggest `|_, _|`.
    if (found_args.length === 0 && is_closure) {
      const underscores = Array.from({ length: expected_args.length }, () => "_").join(", ");
      err.span_suggestion_verbose(
        closure_arg_span ?? found_span,
        `consider changing the closure to take and ignore the expected argument${pluralize(expected_args.length)}`,
        `|${underscores}|`,
        "MachineApplicable",
      );
    }

    if (found_args.length === 1 && found_args[0]!.$ === "Tuple") {
      const fields = found_args[0]!._1;
      if (fields.length === expected_args.length) {
        const sugg = fields.map(([name, _]) => name).join(", ");
        err.span_suggestion_verbose(found_span, "change the closure to take multiple arguments instead of a single tuple", `|${sugg}|`, "MachineApplicable");
      }
    }
    if (expected_args.length === 1 && expected_args[0]!.$ === "Tuple" && expected_args[0]!._1.length === found_args.length && is_closure) {
      const fields = expected_args[0]!._1;
      const sugg = `|(${found_args
        .map((arg) => {
          switch (arg.$) {
            case "Arg":
              return arg._0;
            default:
              return "_";
          }
        })
        .join(", ")})${
        // add type annotations if available
        found_args.some((arg) => {
          switch (arg.$) {
            case "Arg":
              return arg._1 !== "_";
            default:
              return false;
          }
        })
          ? `: (${fields.map(([_, ty]) => ty).join(", ")})`
          : ""
      }|`;
      err.span_suggestion_verbose(found_span, "change the closure to accept a tuple instead of individual arguments", sugg, "MachineApplicable");
    }
  }

  return err;
};

/// Checks if the type implements one of `Fn`, `FnMut`, or `FnOnce`
/// in that order, and returns the generic type corresponding to the
/// argument of that trait (corresponding to the closure arguments).
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:4008 type_implements_fn_trait
TypeErrCtxt.prototype.type_implements_fn_trait = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  ty: Binder<Ty>,
  polarity: ClausePolarity,
): Result<[ClosureKind, Binder<Ty>], undefined> {
  return this.commit_if_ok((_): Result<[ClosureKind, Binder<Ty>], undefined> => {
    for (const trait_def_id_ of [this.tcx.lang_items().fn_trait(), this.tcx.lang_items().fn_mut_trait(), this.tcx.lang_items().fn_once_trait()]) {
      if (trait_def_id_ === undefined) continue;
      const trait_def_id = trait_def_id_;
      // Make a fresh inference variable so we can determine what the generic parameters
      // of the trait are.
      const var_ = this.next_ty_var(DUMMY_SP);
      // FIXME(const_trait_impl)
      const trait_ref = TraitRef.new(as_interner(this.tcx), trait_def_id, [Binder.skip_binder(ty), var_]);
      const obligation = Obligation.new(
        this.tcx,
        ObligationCause.dummy(),
        param_env,
        Binder.rebind(ty, { trait_ref, polarity } satisfies TraitClause),
        Predicate_upcast_from_PolyTraitClause_,
      );
      const ocx = lazy_engine().ObligationCtxt.new(this.infcx);
      ocx.register_obligation(obligation);
      if (TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
        return Ok([
          unwrap(this.tcx.fn_trait_kind_from_def_id(trait_def_id), "expected to map DefId to ClosureKind"),
          Binder.rebind(ty, this.deeply_resolve_ignoring_regions(var_, fold_Ty)),
        ]);
      }
    }

    return Err(undefined);
  });
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:4048 report_not_const_evaluatable_error
TypeErrCtxt.prototype.report_not_const_evaluatable_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  span: Span,
): Result<Diag, ErrorGuaranteed> {
  if (!this.tcx.features().generic_const_exprs() && !this.tcx.features().gca()) {
    const guar = this.dcx()
      .struct_span_err(span, "constant expression depends on a generic parameter")
      // FIXME(const_generics): we should suggest to the user how they can resolve this
      // issue. However, this is currently not actually possible
      // (see https://github.com/rust-lang/rust/issues/66962#issuecomment-575907083).
      //
      // Note that with `feature(generic_const_exprs)` this case should not
      // be reachable.
      .with_note("this may fail depending on what value the parameter takes")
      .emit_err();
    return Err(guar);
  }

  const pk = Binder.skip_binder(obligation.predicate.kind());
  if (pk.$ === "Clause" && pk._0.$ === "ConstEvaluatable") {
    const ct = pk._0._0;
    const ck = ct.kind();
    switch (ck.$) {
      case "Alias": {
        const alias_const: AliasConst = ck._1;
        const err = this.dcx().struct_span_err(span, "unconstrained generic constant");

        const const_span = AliasConstKind.def_span(alias_const.kind, as_interner(this.tcx));
        const const_ty = Unnormalized.skip_norm_wip(AliasConstC.type_of(alias_const, this.tcx));

        const msg_ = "try adding a `where` bound";
        const snippet_ = this.tcx.sess.source_map().span_to_snippet(const_span);
        if (snippet_.$ === "Ok") {
          const snippet = snippet_._0.toString();
          let code: string;
          let local_body: hir.Body | undefined;
          const local_def_id = alias_const.kind.$ === "Anon" ? alias_const.kind.def_id.as_local() : undefined;
          if (const_ty === this.tcx.types.usize) {
            code = `[(); ${snippet}]:`;
          } else if (
            local_def_id !== undefined &&
            (local_body = this.tcx.hir_maybe_body_owned_by(local_def_id)) !== undefined &&
            expr_needs_parens(local_body.value)
          ) {
            code = `[(); (${snippet}) as usize]:`;
          } else {
            code = `[(); ${snippet} as usize]:`;
          }

          const cause_code = obligation.cause.code_();
          const suggestion_def_id = cause_code.$ === "CompareImplItem" ? cause_code.trait_item_def_id.as_local() : obligation.cause.body_def_id;

          let generics: hir.Generics | undefined;
          if (suggestion_def_id !== undefined && (generics = this.tcx.hir_get_generics(suggestion_def_id)) !== undefined) {
            err.span_suggestion_verbose(
              generics.tail_span_for_predicate_suggestion(),
              msg_,
              `${generics.add_where_or_trailing_comma()} ${code}`,
              "MaybeIncorrect",
            );
          } else {
            err.help(`${msg_}: where ${code}`);
          }
        } else {
          err.help(msg_);
        }
        return Ok(err);
      }
      case "Expr": {
        const err = this.dcx().struct_span_err(span, `unconstrained generic constant \`${display_Const(ct)}\``);
        return Ok(err);
      }
      default:
        return bug(`const evaluatable failed for non-alias const \`${debug_Const(ct, PLAIN)}\``);
    }
  } else {
    return span_bug(span, "unexpected non-ConstEvaluatable predicate, this should not be reachable");
  }
};

// ---- helpers (lane errrep-traits-b) -----------------------------------------------------------------------------------

/** The generated `TypeFoldable` impl fns of `TraitClause` as a D4 descriptor. */
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};
/** `Binder<TraitClause>`'s `TypeFoldable`. */
const d_PolyTraitClause: TypeFoldable<PolyTraitClauseT> = fold_Binder(d_TraitClause);
/** The generated `TypeFoldable` impl fns of `ProjectionClause` as a D4 descriptor. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};
/** The generated `TypeFoldable` impl fns of `HostEffectClause` as a D4 descriptor. */
const d_HostEffectClause: TypeFoldable<HostEffectClause> = {
  visit_with: visit_with_HostEffectClause,
  try_fold_with: try_fold_with_HostEffectClause,
  fold_with: fold_with_HostEffectClause,
};
/** The generated `TypeFoldable` impl fns of `TraitRef` as a D4 descriptor. */
const d_TraitRef: TypeFoldable<TraitRef> = {
  visit_with: visit_with_TraitRef,
  try_fold_with: try_fold_with_TraitRef,
  fold_with: fold_with_TraitRef,
};
/** `ExpectedFound<Ty>`'s derived `TypeFoldable` (rustc_type_ir error.rs). */
const d_ExpectedFound_Ty: TypeFoldable<ExpectedFound<Ty>> = {
  visit_with: (v, visitor) => visit_with_ExpectedFound(v, visitor, fold_Ty.visit_with),
  try_fold_with: (v, folder) => try_fold_with_ExpectedFound(v, folder, fold_Ty.try_fold_with),
  fold_with: (v, folder) => fold_with_ExpectedFound(v, folder, fold_Ty.fold_with),
};
/** `GenericArg`'s `TypeFoldable` (`TypeVisitable` part used for `references_error`). */
const fold_GenericArg_: TypeFoldable<GenericArg> = fold_GenericArg;

/**
 * PORT: `#[derive(TypeFoldable, TypeVisitable)]` of rustc_middle's `TraitClausePrintWithBoundConstness` (pretty.rs:3073),
 * needed to print it inside a `Binder` (`Print for Binder<T>` requires `T: TypeFoldable`); pretty.ts has no descriptor
 * yet (root: move next to the type).
 */
const d_TraitClausePrintWithBoundConstness: TypeFoldable<TraitClausePrintWithBoundConstness> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Ok" ? Ok({ _0: r._0, _1: v._1 }) : r;
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder), _1: v._1 }),
};
/** PORT: as above, `TraitClausePrintModifiersAndPath` (pretty.rs:3057). */
const d_TraitClausePrintModifiersAndPath: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Ok" ? Ok({ _0: r._0 }) : r;
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder) }),
};

/** `impl Print for Binder<TraitClausePrintWithBoundConstness>` (pretty.rs:2960, `Print for Binder<T>`). */
function print_Poly_TraitClausePrintWithBoundConstness(v: Binder<TraitClausePrintWithBoundConstness>, p: PrettyPrinter): PrintResult {
  return print_Binder(v, p, print_TraitClausePrintWithBoundConstness, d_TraitClausePrintWithBoundConstness);
}

/** `impl Display for Binder<TraitClausePrintModifiersAndPath>` (rustc_type_ir ir_print.rs `Display for Binder<I, T>`). */
function display_Poly_TraitClausePrintModifiersAndPath(v: Binder<TraitClausePrintModifiersAndPath>): string {
  return IrPrint_print(v, PLAIN, (v, p) => print_Binder(v, p, print_TraitClausePrintModifiersAndPath, d_TraitClausePrintModifiersAndPath));
}

/** `impl Display for Binder<Ty>` (rustc_type_ir ir_print.rs `Display for Binder<I, T>`). */
function display_PolyTy(v: Binder<Ty>): string {
  return IrPrint_print(v, PLAIN, (v, p) => print_Binder(v, p, print_Ty, fold_Ty));
}

/** `impl Display for TraitRef` (`ToString` of a `TraitRef`). */
function display_TraitRef(v: TraitRef): string {
  return IrPrint_print(v, PLAIN, print_TraitRef);
}

/** The reflexive `impl<I, T> UpcastFrom<I, T> for T` at `Predicate`. */
const upcast_from_self: (from: Predicate, tcx: Interner) => Predicate = (from) => from;
/** `impl UpcastFrom<TyCtxt, TraitClause> for Predicate` (rustc_middle predicate.rs). */
const Predicate_upcast_from_TraitClause_ = (from: TraitClause, tcx: Interner): Predicate => Predicate_upcast_from_TraitClause(from, tcx as unknown as TyCtxt);
/** `impl UpcastFrom<TyCtxt, PolyTraitClause> for Predicate` (rustc_middle predicate.rs). */
const Predicate_upcast_from_PolyTraitClause_ = (from: PolyTraitClauseT, tcx: Interner): Predicate =>
  Predicate_upcast_from_PolyTraitClause(from, tcx as unknown as TyCtxt);
/** `impl UpcastFrom<TyCtxt, Clause> for Predicate` (rustc_middle predicate.rs). */
const Predicate_upcast_from_Clause_ = (from: Clause, tcx: Interner): Predicate => Predicate_upcast_from_Clause(from, tcx as unknown as TyCtxt);
/** `impl UpcastFrom<I, TraitRef<I>> for TraitClause<I>` (rustc_type_ir predicate.rs:243). */
const TraitClause_upcast_from_TraitRef = (from: TraitRef, tcx: Interner): TraitClause => TraitClause.upcast_from_TraitRef(from, tcx);

/** `PredicateObligation`'s `TypeFoldable` (../../traits/mod.ts), read lazily (init order). */
function d_PredicateObligation(): TypeFoldable<PredicateObligation> {
  const m = lazy_traits();
  return { visit_with: m.visit_with_PredicateObligation, try_fold_with: m.try_fold_with_PredicateObligation, fold_with: m.fold_with_PredicateObligation };
}

/** `TraitRef`'s derived `PartialEq` (interned `GenericArgs`). */
function TraitRef_eq(a: TraitRef, b: TraitRef): boolean {
  return DefId_eq(a.def_id, b.def_id) && a.args === b.args;
}
/** `(TraitRef, DefId)`'s derived `PartialEq`. */
function TraitRef_DefId_eq(a: readonly [TraitRef, DefId], b: readonly [TraitRef, DefId]): boolean {
  return TraitRef_eq(a[0], b[0]) && DefId_eq(a[1], b[1]);
}
/** `Some(a) == b` for a `DefId` and an `Option<DefId>`. */
function opt_def_id_eq(a: DefId, b: DefId | undefined): boolean {
  return b !== undefined && DefId_eq(a, b);
}
/** `CandidateSimilarity`'s derived `Ord` (variant order `Exact < Fuzzy`, then `ignoring_lifetimes`). */
function CandidateSimilarity_cmp(a: CandidateSimilarity, b: CandidateSimilarity): number {
  const da = a.$ === "Exact" ? 0 : 1;
  const db = b.$ === "Exact" ? 0 : 1;
  if (da !== db) return da < db ? -1 : 1;
  if (a.ignoring_lifetimes !== b.ignoring_lifetimes) return a.ignoring_lifetimes ? 1 : -1;
  return 0;
}

/**
 * `<[T]>::sort_by` (stable). PORT: for `len <= 20` Rust's stable sort is the insertion sort below (core
 * slice/sort/stable/mod.rs `sort`: `insertion_sort_shift_left`), which also matches upstream for comparators that are not
 * a total order (report_similar_impl_candidates' tuple-arity comparator); longer slices use JS's stable sort.
 */
function sort_by_stable<T>(v: T[], cmp: (a: T, b: T) => number): void {
  if (v.length <= 20) {
    for (let i = 1; i < v.length; i++) {
      const tmp = v[i]!;
      let j = i;
      while (j > 0 && cmp(tmp, v[j - 1]!) < 0) {
        v[j] = v[j - 1]!;
        j--;
      }
      v[j] = tmp;
    }
  } else {
    v.sort(cmp);
  }
}
/** `<[T]>::sort_by_key` (stable). */
function sort_by_key_stable<T, K>(v: T[], key: (x: T) => K, cmp: (a: K, b: K) => number): void {
  const keyed = v.map((x): [K, T] => [key(x), x]);
  sort_by_stable(keyed, (a, b) => cmp(a[0], b[0]));
  for (let i = 0; i < v.length; i++) v[i] = keyed[i]![1];
}
/** `Vec::dedup_by` with `PartialEq` (removes consecutive equal elements, keeps the first). */
function dedup_by<T>(v: T[], eq: (a: T, b: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w === 0 || !eq(v[r]!, v[w - 1]!)) {
      v[w++] = v[r]!;
    }
  }
  v.length = w;
}

/** `HashSet::insert` on a `KeyedSet`: `false` when the value was present. */
function keyed_set_insert<K>(set: Set<K>, k: K): boolean {
  if (set.has(k)) return false;
  set.add(k);
  return true;
}
/** `map.entry(hir_id).or_default()` on the `HirIdMap<FxIndexSet<Predicate>>`. */
function hir_id_map_entry_or_default(map: Map<HirId, Set<Predicate>>, hir_id: HirId): Set<Predicate> {
  let v = map.get(hir_id);
  if (v === undefined) {
    v = new Set();
    map.set(hir_id, v);
  }
  return v;
}

/**
 * PORT: stand-in for `TyCategory::from_ty` (error_reporting/infer/mod.rs:2738, lane errrep-infer-a). Root points the use
 * at the real port when that lane lands.
 */
function TyCategory_from_ty(_tcx: TyCtxt, _ty: Ty): [unknown, DefId] | undefined {
  return unported("rustc_trait_selection::error_reporting::infer::TyCategory::from_ty");
}

/** PORT: stand-in for `rustc_transmute::Assume` (crate not ported; as traits/select/confirmation.ts). */
interface TransmuteAssume {
  alignment: boolean;
  lifetimes: boolean;
  safety: boolean;
  validity: boolean;
}
/** PORT: stand-in for `rustc_transmute::Reason<Ty>` (crate not ported), in PORTING's enum representation. */
type TransmuteReason =
  | { readonly $: "SrcIsNotYetSupported" }
  | { readonly $: "DstIsNotYetSupported" }
  | { readonly $: "DstIsBitIncompatible" }
  | { readonly $: "DstUninhabited" }
  | { readonly $: "DstMayHaveSafetyInvariants" }
  | { readonly $: "DstIsTooBig" }
  | { readonly $: "DstRefIsTooBig"; src: Ty; src_size: number; dst: Ty; dst_size: number }
  | { readonly $: "SrcSizeOverflow" }
  | { readonly $: "DstSizeOverflow" }
  | { readonly $: "DstHasStricterAlignment"; src_min_align: number; dst_min_align: number }
  | { readonly $: "DstIsMoreUnique" }
  | { readonly $: "TypeError" }
  | { readonly $: "SrcLayoutUnknown" }
  | { readonly $: "DstLayoutUnknown" };
/** PORT: stand-in for `rustc_transmute::Answer<Region, Ty>` (crate not ported). */
type TransmuteAnswer = { readonly $: "Yes" } | { readonly $: "No"; _0: TransmuteReason } | { readonly $: "If"; _0: unknown };

/** The crate's traits/engine.ts (`ObligationCtxt`), read lazily (init order). */
function lazy_engine(): typeof import("../../traits/engine.ts") {
  return require("../../traits/engine.ts") as typeof import("../../traits/engine.ts");
}
/** The crate's traits/select/mod.ts (`SelectionContext`), read lazily (init order). */
function lazy_select(): typeof import("../../traits/select/mod.ts") {
  return require("../../traits/select/mod.ts") as typeof import("../../traits/select/mod.ts");
}
/** The crate's traits/specialize/specialization_graph.ts (`assoc_def`), read lazily (init order). */
function lazy_specialization_graph(): typeof import("../../traits/specialize/specialization_graph.ts") {
  return require("../../traits/specialize/specialization_graph.ts") as typeof import("../../traits/specialize/specialization_graph.ts");
}
/** The crate's traits/mod.ts, read lazily (init order). */
function lazy_traits(): typeof import("../../traits/mod.ts") {
  return require("../../traits/mod.ts") as typeof import("../../traits/mod.ts");
}
/** This module's parent error_reporting/traits/mod.ts (`ArgKind`), read lazily (init order). */
function lazy_traits_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
/** The crate's diagnostics.gen.ts (`ClosureKindMismatch`, `AssocTypeWithSameName`), read lazily (init order). */
function lazy_diagnostics(): typeof import("../../diagnostics.gen.ts") {
  return require("../../diagnostics.gen.ts") as typeof import("../../diagnostics.gen.ts");
}
