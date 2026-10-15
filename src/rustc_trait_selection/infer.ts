// Port of compiler/rustc_trait_selection/src/infer.rs (lane trait-sel-traits-a; the contract stub was lane
// infcx-contract's). `#[extension(pub trait InferCtxtExt)] impl InferCtxt` and `#[extension(pub trait
// InferCtxtBuilderExt)] impl InferCtxtBuilder` put their methods on the prototypes (rustc_trait_selection decls.ts).
//
// PORT: `params: impl IntoIterator<Item: Into<GenericArg>>` is an `Iterable<GenericArg>` (callers convert, decls.ts).
// `R: Debug` and `Canonical<QueryResponse<R>>: ArenaAllocatable` of `enter_canonical_trait_query` are dropped (the
// `TypeFoldable` descriptors `d_K` / `d_R` stay).
//
// Init order: top-level code here may touch only rustc_infer (loaded first by ./lib.ts) and other crates.

import { InferCtxt, InferCtxtBuilder } from "../rustc_infer/decls.ts";
import type { ToTrace } from "../rustc_infer/infer/at.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import type { Canonical, CanonicalQueryInput, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import type { GenericArg, ParamEnv, Predicate, Ty } from "../rustc_middle/ty/decls.ts";
import { GenericArg as GenericArgC } from "../rustc_middle/ty/generic_args.ts";
import { Predicate_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DefId_eq } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import { as_interner, PolyTraitClause, TraitRef } from "../rustc_type_ir/predicate.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import type { Result } from "../std/result.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { ObligationCtxt } from "./traits/engine.ts";
import type { FulfillmentError } from "./traits/mod.gen.ts";
import { type_known_to_meet_bound_modulo_regions } from "./traits/mod.ts";

// `pub use rustc_infer::infer::*;`
export * from "../rustc_infer/infer/mod.ts";

// ---- #[extension(pub trait InferCtxtExt<'tcx>)] impl<'tcx> InferCtxt<'tcx> -------------------------------------------

// rustc: compiler/rustc_trait_selection/src/infer.rs:23 can_eq
InferCtxt.prototype.can_eq = function <T>(this: InferCtxt, param_env: ParamEnv, a: T, b: T, d_T: ToTrace<T>): boolean {
  return this.probe((_) => {
    const ocx = ObligationCtxt.new(this);
    const r = ocx.eq(ObligationCause.dummy(), param_env, a, b, d_T);
    if (r.$ !== "Ok") {
      return false;
    }
    return TraitErrors.no_errors(ocx.try_evaluate_obligations());
  });
};

// rustc: compiler/rustc_trait_selection/src/infer.rs:33 type_is_copy_modulo_regions
InferCtxt.prototype.type_is_copy_modulo_regions = function (this: InferCtxt, param_env: ParamEnv, ty_: Ty): boolean {
  const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
  const copy_def_id = this.tcx.require_lang_item("Copy", DUMMY_SP);
  return type_known_to_meet_bound_modulo_regions(this, param_env, ty, copy_def_id);
};

// rustc: compiler/rustc_trait_selection/src/infer.rs:39 type_is_clone_modulo_regions
InferCtxt.prototype.type_is_clone_modulo_regions = function (this: InferCtxt, param_env: ParamEnv, ty_: Ty): boolean {
  const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
  const clone_def_id = this.tcx.require_lang_item("Clone", DUMMY_SP);
  return type_known_to_meet_bound_modulo_regions(this, param_env, ty, clone_def_id);
};

// rustc: compiler/rustc_trait_selection/src/infer.rs:45 type_is_use_cloned_modulo_regions
InferCtxt.prototype.type_is_use_cloned_modulo_regions = function (this: InferCtxt, param_env: ParamEnv, ty_: Ty): boolean {
  const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
  const use_cloned_def_id = this.tcx.require_lang_item("UseCloned", DUMMY_SP);
  return type_known_to_meet_bound_modulo_regions(this, param_env, ty, use_cloned_def_id);
};

// rustc: compiler/rustc_trait_selection/src/infer.rs:55 type_is_sized_modulo_regions
InferCtxt.prototype.type_is_sized_modulo_regions = function (this: InferCtxt, param_env: ParamEnv, ty: Ty): boolean {
  const lang_item = this.tcx.require_lang_item("Sized", DUMMY_SP);
  return type_known_to_meet_bound_modulo_regions(this, param_env, ty, lang_item);
};

/// Check whether a `ty` implements given trait(trait_def_id) without side-effects.
///
/// The inputs are:
///
/// - the def-id of the trait
/// - the type parameters of the trait, including the self-type
/// - the parameter environment
///
/// Invokes `evaluate_obligation`, so in the event that evaluating
/// `Ty: Trait` causes overflow, EvaluatedToAmbigStackDependent will be returned.
///
/// `type_implements_trait` is a convenience function for simple cases like
///
/// ```ignore (illustrative)
/// let copy_trait = infcx.tcx.require_lang_item(LangItem::Copy, span);
/// let implements_copy = infcx.type_implements_trait(copy_trait, [ty], param_env)
/// .must_apply_modulo_regions();
/// ```
///
/// In most cases you should instead create an [Obligation] and check whether
///  it holds via [`evaluate_obligation`] or one of its helper functions like
/// [`predicate_must_hold_modulo_regions`], because it properly handles higher ranked traits
/// and it is more convenient and safer when your `params` are inside a [`Binder`].
///
/// [Obligation]: traits::Obligation
/// [`evaluate_obligation`]: crate::traits::query::evaluate_obligation::InferCtxtExt::evaluate_obligation
/// [`predicate_must_hold_modulo_regions`]: crate::traits::query::evaluate_obligation::InferCtxtExt::predicate_must_hold_modulo_regions
/// [`Binder`]: ty::Binder
// #[instrument(level = "debug", skip(self, params), ret)]
// rustc: compiler/rustc_trait_selection/src/infer.rs:89 type_implements_trait
InferCtxt.prototype.type_implements_trait = function (this: InferCtxt, trait_def_id: DefId, params: Iterable<GenericArg>, param_env: ParamEnv): EvaluationResult {
  const trait_ref = TraitRef.new(as_interner(this.tcx), trait_def_id, params);

  const obligation = new Obligation(ObligationCause.dummy(), param_env, Predicate_upcast_from_TraitRef(trait_ref, this.tcx), 0);
  const r = this.evaluate_obligation(obligation);
  return r.$ === "Ok" ? r._0 : EvaluationResult.EvaluatedToErr;
};

/// Returns `Some` if a type implements a trait shallowly, without side-effects,
/// along with any errors that would have been reported upon further obligation
/// processing.
///
/// - If this returns `Some([])`, then the trait holds modulo regions.
/// - If this returns `Some([errors..])`, then the trait has an impl for
/// the self type, but some nested obligations do not hold.
/// - If this returns `None`, no implementation that applies could be found.
// rustc: compiler/rustc_trait_selection/src/infer.rs:114 type_implements_trait_shallow
InferCtxt.prototype.type_implements_trait_shallow = function (
  this: InferCtxt,
  trait_def_id: DefId,
  ty: Ty,
  param_env: ParamEnv,
): TraitErrors<FulfillmentError> | undefined {
  return this.probe((_snapshot) => {
    const ocx = ObligationCtxt.new_with_diagnostics(this);
    ocx.register_obligation(
      Obligation.new(
        this.tcx,
        ObligationCause.dummy(),
        param_env,
        TraitRef.new(as_interner(this.tcx), trait_def_id, [GenericArgC.from_Ty(ty)]),
        Predicate_upcast_from_TraitRef as (from: TraitRef, tcx: Interner) => Predicate,
      ),
    );
    const errors = ocx.try_evaluate_obligations();
    // Find the original predicate in the list of predicates that could definitely not be fulfilled.
    // If it is in that list, then we know this doesn't even shallowly implement the trait.
    // If it is not in that list, it was fulfilled, but there may be nested obligations, which we don't care about here.
    for (const error of TraitErrors.into_iter_ref(errors)) {
      const trait_clause = error.obligation.predicate.as_trait_clause();
      if (trait_clause === undefined) {
        continue;
      }
      const bound_ty = Binder.no_bound_vars(PolyTraitClause.self_ty(trait_clause), fold_Ty);
      if (bound_ty === undefined) {
        continue;
      }
      if (DefId_eq(PolyTraitClause.def_id(trait_clause), trait_def_id) && ocx.eq(ObligationCause.dummy(), param_env, bound_ty, ty, ToTrace_Ty).$ === "Ok") {
        return undefined;
      }
    }
    return errors;
  });
};

// ---- #[extension(pub trait InferCtxtBuilderExt<'tcx>)] impl<'tcx> InferCtxtBuilder<'tcx> -----------------------------

/// The "main method" for a canonicalized trait query. Given the
/// canonical key `canonical_key`, this method will create a new
/// inference context, instantiate the key, and run your operation
/// `op`. The operation should yield up a result (of type `R`) as
/// well as a set of trait obligations that must be fully
/// satisfied. These obligations will be processed and the
/// canonical result created.
///
/// Returns `NoSolution` in the event of any error.
///
/// (It might be mildly nicer to implement this on `TyCtxt`, and
/// not `InferCtxtBuilder`, but that is a bit tricky right now.
/// In part because we would need a `for<'tcx>` sort of
/// bound for the closure and in part because it is convenient to
/// have `'tcx` be free on this function so that we can talk about
/// `K: TypeFoldable<TyCtxt<'tcx>>`.)
// rustc: compiler/rustc_trait_selection/src/infer.rs:166 enter_canonical_trait_query
InferCtxtBuilder.prototype.enter_canonical_trait_query = function <K, R>(
  this: InferCtxtBuilder,
  canonical_key: CanonicalQueryInput<K>,
  operation: (ocx: ObligationCtxt, key: K) => Result<R, NoSolution>,
  d_K: TypeFoldable<K>,
  d_R: TypeFoldable<R>,
): Result<Canonical<QueryResponse<R>>, NoSolution> {
  const [infcx, key, var_values] = this.build_with_canonical(DUMMY_SP, canonical_key, d_K);
  const ocx = ObligationCtxt.new(infcx);
  const value = operation(ocx, key);
  if (value.$ === "Err") return value;
  return ocx.make_canonicalized_query_response(var_values, value._0, d_R);
};
