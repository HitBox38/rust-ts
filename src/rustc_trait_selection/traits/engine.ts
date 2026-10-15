// Port of compiler/rustc_trait_selection/src/traits/engine.rs (lane trait-sel-traits-a): `FulfillmentEngine` and
// `ObligationCtxt`, the API trait solving is used through outside hir/mir typeck.
//
// PORT (representation):
// - `enum FulfillmentEngine<'tcx, E> { Old(FulfillmentContext), Next(NextFulfillmentCtxt) }` is a class with the enum's
//   `$` tag and `_0` payload (PORTING §5 shape) that implements `TraitEngine<E>`, because `&mut *self.engine.borrow_mut()`
//   is passed where upstream takes a `&mut dyn TraitEngine<'tcx, E>`. Both payloads are `dyn TraitEngine` objects.
// - The bound `E: FromSolverError<'tcx, NextSolverError<'tcx>> + FromSolverError<'tcx, OldSolverError<'tcx>>` is the D4
//   descriptor pair `FulfillmentErrorKinds<E>` (`from_next` / `from_old`), passed to the engines' constructors.
// - `ObligationCtxt<'a, 'tcx, E>` is a class; `engine: RefCell<FulfillmentEngine>` is the engine itself (PORTING §5),
//   followed by the descriptor pair `d_E` of `E`'s bound (the methods that need it take no descriptor).
//   The impl blocks restricted to `E = FulfillmentError` / `E = ScrubbedTraitError` are methods of the class too (the
//   TS type parameter carries the restriction).
// - `FxIndexSet<Ty>` is a `Set<Ty>` (interned keys, insertion-ordered); `ThinVec<E>` is `E[]`.
//
// PORT(merge): the engines are other lanes' types: `solve::FulfillmentCtxt` (solve/fulfill.rs, lane trait-sel-solve)
// and the old solver's `FulfillmentContext` (traits/fulfill.rs, wave 20, plan-m3 D9), as are the `FromSolverError`
// impls of `ScrubbedTraitError` / `FulfillmentError` (solve/fulfill.rs and traits/fulfill.rs). Their stand-ins are the
// `pending_*` values at the end of this file; each stops as UNPORTED. Root repoints them at merge.

import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { ToTrace } from "../../rustc_infer/infer/at.ts";
import type { RegionResolutionError } from "../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import type { InferOk, TypeTrace } from "../../rustc_infer/infer/mod.ts";
import { type FromSolverError, type TraitEngine, TraitEngine_provided, type ScrubbedTraitError, type TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { Obligation, type PredicateObligation, type PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import type { Canonical, CanonicalVarValues, QueryResponse } from "../../rustc_middle/infer/canonical.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { Const, ParamEnv, Term, Ty } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { Pending, TyVid } from "../../rustc_type_ir/decls.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { Relate } from "../../rustc_type_ir/relate.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { assert, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { NextSolverError } from "../decls.ts";
import type { FulfillmentError } from "./mod.gen.ts";
import { err_ctxt } from "./mod.ts";

/** `traits::fulfill::OldSolverError<'tcx>` (traits/fulfill.rs, old solver: wave 20). */
export type OldSolverError = Pending<"rustc_trait_selection::traits::fulfill::OldSolverError">;

/**
 * PORT (D4): the bound `E: FromSolverError<'tcx, NextSolverError<'tcx>> + FromSolverError<'tcx, OldSolverError<'tcx>>`
 * of `FulfillmentEngine` / `ObligationCtxt`: one descriptor per impl.
 */
export interface FulfillmentErrorKinds<E> {
  readonly from_next: FromSolverError<E, NextSolverError>;
  readonly from_old: FromSolverError<E, OldSolverError>;
}

/// A fulfillment engine, stored inline rather than boxed as a
/// `dyn TraitEngine` because some of its holders (e.g. [`ObligationCtxt`])
/// are created very often (once per candidate probe during method
/// resolution), so the heap allocation would be expensive.
// rustc-type: compiler/rustc_trait_selection/src/traits/engine.rs:34 FulfillmentEngine
export class FulfillmentEngine<E> implements TraitEngine<E> {
  constructor(
    /** The variant: `Old(FulfillmentContext<'tcx, E>)` or `Next(NextFulfillmentCtxt<'tcx, E>)`. */
    readonly $: "Old" | "Next",
    readonly _0: TraitEngine<E>,
  ) {}

  // ---- impl<'tcx, E> FulfillmentEngine<'tcx, E> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:43 new
  static new<E>(infcx: InferCtxt, d_E: FulfillmentErrorKinds<E>): FulfillmentEngine<E> {
    if (infcx.next_trait_solver()) {
      return new FulfillmentEngine<E>("Next", pending_NextFulfillmentCtxt_new(infcx, d_E.from_next));
    } else {
      assert(!infcx.tcx.next_trait_solver_globally(), "using old solver even though new solver is enabled globally");
      return new FulfillmentEngine<E>("Old", pending_FulfillmentContext_new(infcx, d_E.from_old));
    }
  }

  // ---- impl<'tcx, E> TraitEngine<'tcx, E> for FulfillmentEngine<'tcx, E> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:60 register_predicate_obligation
  register_predicate_obligation(infcx: InferCtxt, obligation: PredicateObligation): void {
    switch (this.$) {
      case "Old": {
        const engine = this._0;
        return engine.register_predicate_obligation(infcx, obligation);
      }
      case "Next": {
        const engine = this._0;
        return engine.register_predicate_obligation(infcx, obligation);
      }
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:75 register_predicate_obligations
  register_predicate_obligations(infcx: InferCtxt, obligations: PredicateObligations): void {
    switch (this.$) {
      case "Old": {
        const engine = this._0;
        return engine.register_predicate_obligations(infcx, obligations);
      }
      case "Next": {
        const engine = this._0;
        return engine.register_predicate_obligations(infcx, obligations);
      }
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:90 try_evaluate_obligations
  try_evaluate_obligations(infcx: InferCtxt): TraitErrors<E> {
    switch (this.$) {
      case "Old":
        return this._0.try_evaluate_obligations(infcx);
      case "Next":
        return this._0.try_evaluate_obligations(infcx);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:97 collect_remaining_errors
  collect_remaining_errors(infcx: InferCtxt): TraitErrors<E> {
    switch (this.$) {
      case "Old":
        return this._0.collect_remaining_errors(infcx);
      case "Next":
        return this._0.collect_remaining_errors(infcx);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:104 has_pending_obligations
  has_pending_obligations(): boolean {
    switch (this.$) {
      case "Old":
        return this._0.has_pending_obligations();
      case "Next":
        return this._0.has_pending_obligations();
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:111 pending_obligations
  pending_obligations(): PredicateObligations {
    switch (this.$) {
      case "Old":
        return this._0.pending_obligations();
      case "Next":
        return this._0.pending_obligations();
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:118 pending_obligations_potentially_referencing_sub_root
  pending_obligations_potentially_referencing_sub_root(infcx: InferCtxt, sub_root: TyVid): PredicateObligations {
    switch (this.$) {
      case "Old": {
        const engine = this._0;
        return engine.pending_obligations_potentially_referencing_sub_root(infcx, sub_root);
      }
      case "Next": {
        const engine = this._0;
        return engine.pending_obligations_potentially_referencing_sub_root(infcx, sub_root);
      }
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:133 drain_stalled_obligations_for_coroutines
  drain_stalled_obligations_for_coroutines(infcx: InferCtxt): PredicateObligations {
    switch (this.$) {
      case "Old": {
        const engine = this._0;
        return engine.drain_stalled_obligations_for_coroutines(infcx);
      }
      case "Next": {
        const engine = this._0;
        return engine.drain_stalled_obligations_for_coroutines(infcx);
      }
    }
  }

  // The provided `TraitEngine` methods `FulfillmentEngine` does not override (rustc_infer traits/engine.rs).
  register_bound(infcx: InferCtxt, param_env: ParamEnv, ty: Ty, def_id: DefId, cause: ObligationCause): void {
    return TraitEngine_provided.register_bound(this, infcx, param_env, ty, def_id, cause);
  }
  evaluate_obligations_error_on_ambiguity(infcx: InferCtxt): TraitErrors<E> {
    return TraitEngine_provided.evaluate_obligations_error_on_ambiguity(this, infcx);
  }
  pending_obligations_potentially_referencing_float_infer(infcx: InferCtxt): PredicateObligations {
    return TraitEngine_provided.pending_obligations_potentially_referencing_float_infer(this, infcx);
  }
}

/// Used if you want to have pleasant experience when dealing
/// with obligations outside of hir or mir typeck.
// rustc-type: compiler/rustc_trait_selection/src/traits/engine.rs:150 ObligationCtxt
export class ObligationCtxt<E = ScrubbedTraitError> {
  constructor(
    public infcx: InferCtxt,
    /** `RefCell<FulfillmentEngine<'tcx, E>>` (private upstream). */
    public engine: FulfillmentEngine<E>,
    /**
     * PORT (D4): the bound `E: FromSolverError<NextSolverError> + FromSolverError<OldSolverError>` of the impl blocks,
     * carried by the value: `assumed_wf_types` / `deeply_normalize` pass `from_next` to `At::deeply_normalize`.
     */
    readonly d_E: FulfillmentErrorKinds<E>,
  ) {}

  // ---- impl<'a, 'tcx> ObligationCtxt<'a, 'tcx, FulfillmentError<'tcx>> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:156 new_with_diagnostics
  static new_with_diagnostics(infcx: InferCtxt): ObligationCtxt<FulfillmentError> {
    return new ObligationCtxt<FulfillmentError>(infcx, FulfillmentEngine.new(infcx, FulfillmentErrorKinds_FulfillmentError), FulfillmentErrorKinds_FulfillmentError);
  }

  // ---- impl<'a, 'tcx> ObligationCtxt<'a, 'tcx, ScrubbedTraitError<'tcx>> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:162 new
  static new(infcx: InferCtxt): ObligationCtxt<ScrubbedTraitError> {
    return new ObligationCtxt<ScrubbedTraitError>(infcx, FulfillmentEngine.new(infcx, FulfillmentErrorKinds_ScrubbedTraitError), FulfillmentErrorKinds_ScrubbedTraitError);
  }

  // ---- impl<'a, 'tcx, E> ObligationCtxt<'a, 'tcx, E> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:171 register_obligation
  register_obligation(obligation: PredicateObligation): void {
    this.engine.register_predicate_obligation(this.infcx, obligation);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:175 register_obligations
  register_obligations(obligations: Iterable<PredicateObligation>): void {
    // Can't use `register_predicate_obligations` because the iterator
    // may also use this `ObligationCtxt`.
    for (const obligation of obligations) {
      this.engine.register_predicate_obligation(this.infcx, obligation);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:186 register_infer_ok_obligations
  register_infer_ok_obligations<T>(infer_ok: InferOk<T>): T {
    const { value, obligations } = infer_ok;
    this.engine.register_predicate_obligations(this.infcx, obligations);
    return value;
  }

  /// Requires that `ty` must implement the trait with `def_id` in
  /// the given environment. This trait must not have any type
  /// parameters (except for `Self`).
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:195 register_bound
  register_bound(cause: ObligationCause, param_env: ParamEnv, ty: Ty, def_id: DefId): void {
    const tcx = this.infcx.tcx;
    const trait_ref = TraitRef.new(as_interner(tcx), def_id, [GenericArg.from_Ty(ty)]);
    this.register_obligation(new Obligation(cause, param_env, Predicate_upcast_from_TraitRef(trait_ref, tcx), 0));
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:212 normalize
  normalize<T>(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): T {
    const infer_ok = this.infcx.at(cause, param_env).normalize(value, d_T);
    return this.register_infer_ok_obligations(infer_ok);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:222 eq
  eq<T>(cause: ObligationCause, param_env: ParamEnv, expected: T, actual: T, d_T: ToTrace<T>): Result<null, TypeError> {
    const r = this.infcx.at(cause, param_env).eq("Yes", expected, actual, d_T);
    return r.$ === "Ok" ? Ok(this.register_infer_ok_obligations(r._0)) : r;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:235 eq_trace
  eq_trace<T>(cause: ObligationCause, param_env: ParamEnv, trace: TypeTrace, expected: T, actual: T, d_T: Relate<T>): Result<null, TypeError> {
    const r = this.infcx.at(cause, param_env).eq_trace("Yes", trace, expected, actual, d_T);
    return r.$ === "Ok" ? Ok(this.register_infer_ok_obligations(r._0)) : r;
  }

  /// Checks whether `expected` is a subtype of `actual`: `expected <: actual`.
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:250 sub
  sub<T>(cause: ObligationCause, param_env: ParamEnv, expected: T, actual: T, d_T: ToTrace<T>): Result<null, TypeError> {
    const r = this.infcx.at(cause, param_env).sub("Yes", expected, actual, d_T);
    return r.$ === "Ok" ? Ok(this.register_infer_ok_obligations(r._0)) : r;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:263 relate
  relate<T>(cause: ObligationCause, param_env: ParamEnv, variance: Variance, expected: T, actual: T, d_T: ToTrace<T>): Result<null, TypeError> {
    const r = this.infcx.at(cause, param_env).relate("Yes", expected, variance, actual, d_T);
    return r.$ === "Ok" ? Ok(this.register_infer_ok_obligations(r._0)) : r;
  }

  /// Checks whether `expected` is a supertype of `actual`: `expected :> actual`.
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:278 sup
  sup<T>(cause: ObligationCause, param_env: ParamEnv, expected: T, actual: T, d_T: ToTrace<T>): Result<null, TypeError> {
    const r = this.infcx.at(cause, param_env).sup("Yes", expected, actual, d_T);
    return r.$ === "Ok" ? Ok(this.register_infer_ok_obligations(r._0)) : r;
  }

  /// Computes the least-upper-bound, or mutual supertype, of two values.
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:292 lub
  lub<T>(cause: ObligationCause, param_env: ParamEnv, expected: T, actual: T, d_T: ToTrace<T>): Result<T, TypeError> {
    const r = this.infcx.at(cause, param_env).lub(expected, actual, d_T);
    return r.$ === "Ok" ? Ok(this.register_infer_ok_obligations(r._0)) : r;
  }

  /// Go over the list of pending obligations and try to evaluate them.
  ///
  /// For each result:
  /// Ok: remove the obligation from the list
  /// Ambiguous: leave the obligation in the list to be evaluated later
  /// Err: remove the obligation from the list and return an error
  ///
  /// Returns a list of errors from obligations that evaluated to Err.
  // #[must_use]
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:314 try_evaluate_obligations
  try_evaluate_obligations(): TraitErrors<E> {
    return this.engine.try_evaluate_obligations(this.infcx);
  }

  /// Evaluate all pending obligations, return error if they can't be evaluated.
  ///
  /// For each result:
  /// Ok: remove the obligation from the list
  /// Ambiguous: remove the obligation from the list and return an error
  /// Err: remove the obligation from the list and return an error
  ///
  /// Returns a list of errors from obligations that evaluated to Ambiguous or Err.
  // #[must_use]
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:327 evaluate_obligations_error_on_ambiguity
  evaluate_obligations_error_on_ambiguity(): TraitErrors<E> {
    return this.engine.evaluate_obligations_error_on_ambiguity(this.infcx);
  }

  /// Returns the not-yet-processed and stalled obligations from the
  /// `ObligationCtxt`.
  ///
  /// Takes ownership of the context as doing operations such as
  /// [`ObligationCtxt::eq`] afterwards will result in other obligations
  /// getting ignored. You can make a new `ObligationCtxt` if this
  /// needs to be done in a loop, for example.
  // #[must_use]
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:339 into_pending_obligations
  into_pending_obligations(): PredicateObligations {
    return this.engine.pending_obligations();
  }

  /// Resolves regions and reports errors.
  ///
  /// Takes ownership of the context as doing trait solving afterwards
  /// will result in region constraints getting ignored.
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:347 resolve_regions_and_report_errors
  resolve_regions_and_report_errors(body_def_id: LocalDefId, param_env: ParamEnv, assumed_wf_tys: Iterable<Ty>): Result<null, ErrorGuaranteed> {
    const errors = this.infcx.resolve_regions(body_def_id, param_env, assumed_wf_tys);
    if (errors.length === 0) {
      return Ok(null);
    } else {
      return Err(err_ctxt(this.infcx).report_region_errors(body_def_id, errors));
    }
  }

  /// Resolves regions and reports errors.
  ///
  /// Takes ownership of the context as doing trait solving afterwards
  /// will result in region constraints getting ignored.
  // #[must_use]
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:366 resolve_regions
  resolve_regions(body_def_id: LocalDefId, param_env: ParamEnv, assumed_wf_tys: Iterable<Ty>): RegionResolutionError[] {
    return this.infcx.resolve_regions(body_def_id, param_env, assumed_wf_tys);
  }

  // ---- impl<'tcx> ObligationCtxt<'_, 'tcx, FulfillmentError<'tcx>> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:377 assumed_wf_types_and_report_errors
  assumed_wf_types_and_report_errors(this: ObligationCtxt<FulfillmentError>, param_env: ParamEnv, def_id: LocalDefId): Result<Set<Ty>, ErrorGuaranteed> {
    const r = this.assumed_wf_types(param_env, def_id);
    return r.$ === "Ok" ? r : Err(err_ctxt(this.infcx).report_fulfillment_errors(r._0));
  }

  // ---- impl<'tcx> ObligationCtxt<'_, 'tcx, ScrubbedTraitError<'tcx>> ----

  // PORT: `T: Debug + TypeFoldable` is the D4 descriptor `d_T`; `Canonical<QueryResponse<T>>: ArenaAllocatable` is
  // dropped (no arenas).
  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:388 make_canonicalized_query_response
  make_canonicalized_query_response<T>(
    this: ObligationCtxt<ScrubbedTraitError>,
    inference_vars: CanonicalVarValues,
    answer: T,
    d_T: TypeFoldable<T>,
  ): Result<Canonical<QueryResponse<T>>, NoSolution> {
    return this.infcx.make_canonicalized_query_response(inference_vars, answer, this.engine, d_T);
  }

  // ---- impl<'tcx, E> ObligationCtxt<'_, 'tcx, E> ----

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:409 assumed_wf_types
  assumed_wf_types(param_env: ParamEnv, def_id: LocalDefId): Result<Set<Ty>, E[]> {
    const tcx = this.infcx.tcx;
    const implied_bounds = new Set<Ty>();
    const errors: E[] = [];
    for (const [ty, span] of tcx.assumed_wf_types(def_id)) {
      // FIXME(@lcnr): rustc currently does not check wf for types
      // pre-normalization, meaning that implied bounds are sometimes
      // incorrect. See #100910 for more details.
      //
      // Not adding the unnormalized types here mostly fixes that, except
      // that there are projections which are still ambiguous in the item definition
      // but do normalize successfully when using the item, see #98543.
      //
      // Anyways, I will hopefully soon change implied bounds to make all of this
      // sound and then uncomment this line again.

      // implied_bounds.insert(ty);
      const cause = ObligationCause.misc(span, def_id);
      const r = this.infcx.at(cause, param_env).deeply_normalize(Unnormalized.new_wip(ty), this.engine, fold_Ty, this.d_E.from_next);
      if (r.$ === "Ok") {
        // Insert well-formed types, ignoring duplicates.
        implied_bounds.add(r._0);
      } else {
        errors.push(...r._0);
      }
    }

    if (errors.length === 0) {
      return Ok(implied_bounds);
    } else {
      return Err(errors);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:445 deeply_normalize
  deeply_normalize<T>(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): Result<T, E[]> {
    return this.infcx.at(cause, param_env).deeply_normalize(value, this.engine, d_T, this.d_E.from_next);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:454 structurally_normalize_ty
  structurally_normalize_ty(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<Ty>): Result<Ty, E[]> {
    return this.infcx.at(cause, param_env).structurally_normalize_ty(value, this.engine);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:465 structurally_normalize_const
  structurally_normalize_const(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<Const>): Result<Const, E[]> {
    return this.infcx.at(cause, param_env).structurally_normalize_const(value, this.engine);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/engine.rs:476 structurally_normalize_term
  structurally_normalize_term(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<Term>): Result<Term, E[]> {
    return this.infcx.at(cause, param_env).structurally_normalize_term(value, this.engine);
  }

}

// ---- PORT(merge): stand-ins for other lanes' items (each stops as UNPORTED; root repoints them) ------------------------

/** `solve::FulfillmentCtxt::new(infcx)` (solve/fulfill.rs, lane trait-sel-solve). */
function pending_NextFulfillmentCtxt_new<E>(_infcx: InferCtxt, _from_next: FromSolverError<E, NextSolverError>): TraitEngine<E> {
  return unported("rustc_trait_selection::solve::FulfillmentCtxt::new (solve/fulfill.rs, lane trait-sel-solve)");
}

/** `traits::fulfill::FulfillmentContext::new(infcx)` (traits/fulfill.rs; the old solver, wave 20). */
function pending_FulfillmentContext_new<E>(_infcx: InferCtxt, _from_old: FromSolverError<E, OldSolverError>): TraitEngine<E> {
  return unported("rustc_trait_selection::traits::fulfill::FulfillmentContext::new (old solver, wave 20)");
}

/**
 * `impl FromSolverError<'tcx, NextSolverError<'tcx>> for ScrubbedTraitError<'tcx>` (solve/fulfill.rs, lane
 * trait-sel-solve) and `impl FromSolverError<'tcx, OldSolverError<'tcx>> for ScrubbedTraitError<'tcx>`
 * (traits/fulfill.rs, wave 20).
 */
export const FulfillmentErrorKinds_ScrubbedTraitError: FulfillmentErrorKinds<ScrubbedTraitError> = {
  from_next: {
    from_solver_error: () => unported("rustc_trait_selection::solve::fulfill::<ScrubbedTraitError as FromSolverError<NextSolverError>>::from_solver_error (lane trait-sel-solve)"),
  },
  from_old: {
    from_solver_error: () => unported("rustc_trait_selection::traits::fulfill::<ScrubbedTraitError as FromSolverError<OldSolverError>>::from_solver_error (wave 20)"),
  },
};

/**
 * `impl FromSolverError<'tcx, NextSolverError<'tcx>> for FulfillmentError<'tcx>` (solve/fulfill.rs, lane
 * trait-sel-solve) and `impl FromSolverError<'tcx, OldSolverError<'tcx>> for FulfillmentError<'tcx>`
 * (traits/fulfill.rs, wave 20).
 */
export const FulfillmentErrorKinds_FulfillmentError: FulfillmentErrorKinds<FulfillmentError> = {
  from_next: {
    from_solver_error: () => unported("rustc_trait_selection::solve::fulfill::<FulfillmentError as FromSolverError<NextSolverError>>::from_solver_error (lane trait-sel-solve)"),
  },
  from_old: {
    from_solver_error: () => unported("rustc_trait_selection::traits::fulfill::<FulfillmentError as FromSolverError<OldSolverError>>::from_solver_error (wave 20)"),
  },
};
