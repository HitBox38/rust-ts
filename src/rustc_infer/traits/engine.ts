// Port of compiler/rustc_infer/src/traits/engine.rs (lane infer-opaque-snapshot). The enums `ScrubbedTraitError` and
// `TraitErrors` are generated (engine.gen.ts); their methods are on the companions below (PORTING §8). Init order: other
// rustc_infer modules are read inside function bodies only.

import type { Companions } from "../decls.ts";
import * as gen from "./engine.gen.ts";

export * from "./engine.gen.ts";

import type { DefId } from "../../rustc_span/def_id.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/decls.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyVid } from "../../rustc_type_ir/decls.ts";
import { TraitRef } from "../../rustc_type_ir/predicate.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import type { InferCtxt } from "../decls.ts";
import { Obligation, type PredicateObligation, type PredicateObligations } from "./mod.ts";

// PORT: `dyn TraitEngine<'tcx, E>` is this interface (implemented by rustc_trait_selection's `FulfillmentCtxt`s); its
// provided methods live in `TraitEngine_provided` (PORTING §8): an implementor assigns them.
// rustc-trait: compiler/rustc_infer/src/traits/engine.rs:121 TraitEngine
export interface TraitEngine<E> {
  /// Requires that `ty` must implement the trait with `def_id` in
  /// the given environment. This trait must not have any type
  /// parameters (except for `Self`).
  // (provided) engine.rs:125 register_bound -> TraitEngine_provided.register_bound
  register_bound(infcx: InferCtxt, param_env: ParamEnv, ty: Ty, def_id: DefId, cause: ObligationCause): void;

  // rustc: compiler/rustc_infer/src/traits/engine.rs:145 register_predicate_obligation
  register_predicate_obligation(infcx: InferCtxt, obligation: PredicateObligation): void;

  // (provided) engine.rs:151 register_predicate_obligations -> TraitEngine_provided.register_predicate_obligations
  register_predicate_obligations(infcx: InferCtxt, obligations: PredicateObligations): void;

  /// Go over the list of pending obligations and try to evaluate them.
  ///
  /// For each result:
  /// Ok: remove the obligation from the list
  /// Ambiguous: leave the obligation in the list to be evaluated later
  /// Err: remove the obligation from the list and return an error
  ///
  /// Returns a list of errors from obligations that evaluated to Err.
  // rustc: compiler/rustc_infer/src/traits/engine.rs:170 try_evaluate_obligations
  try_evaluate_obligations(infcx: InferCtxt): TraitErrors<E>;

  // rustc: compiler/rustc_infer/src/traits/engine.rs:172 collect_remaining_errors
  collect_remaining_errors(infcx: InferCtxt): TraitErrors<E>;

  /// Evaluate all pending obligations, return error if they can't be evaluated.
  ///
  /// For each result:
  /// Ok: remove the obligation from the list
  /// Ambiguous: remove the obligation from the list and return an error
  /// Err: remove the obligation from the list and return an error
  ///
  /// Returns a list of errors from obligations that evaluated to Ambiguous or Err.
  // (provided) engine.rs:183 evaluate_obligations_error_on_ambiguity -> TraitEngine_provided.evaluate_obligations_error_on_ambiguity
  evaluate_obligations_error_on_ambiguity(infcx: InferCtxt): TraitErrors<E>;

  // rustc: compiler/rustc_infer/src/traits/engine.rs:195 has_pending_obligations
  has_pending_obligations(): boolean;

  // rustc: compiler/rustc_infer/src/traits/engine.rs:197 pending_obligations
  pending_obligations(): PredicateObligations;

  /// Pending obligations potentially referencing an inference variable whose
  /// sub-unification root is `_sub_root`. May be conservative: implementations
  /// can return obligations that don't actually reference `_sub_root` (the
  /// default just returns everything).
  // (provided) engine.rs:203 pending_obligations_potentially_referencing_sub_root -> TraitEngine_provided
  pending_obligations_potentially_referencing_sub_root(_infcx: InferCtxt, _sub_root: TyVid): PredicateObligations;

  /// Pending obligations potentially referencing float inference variables.
  ///
  /// FIXME: use a generic filter for `pending_obligations_potentially_referencing_sub_root`
  /// and this after `TraitEngine` doesn't need to be dyn compatible.
  // (provided) engine.rs:215 pending_obligations_potentially_referencing_float_infer -> TraitEngine_provided
  pending_obligations_potentially_referencing_float_infer(_infcx: InferCtxt): PredicateObligations;

  /// Among all pending obligations, collect those are stalled on a inference variable which has
  /// changed since the last call to `try_evaluate_obligations`. Those obligations are marked as
  /// successful and returned.
  // rustc: compiler/rustc_infer/src/traits/engine.rs:225 drain_stalled_obligations_for_coroutines
  drain_stalled_obligations_for_coroutines(infcx: InferCtxt): PredicateObligations;
}

/** The provided methods of `TraitEngine` (PORTING §8; `self` first). */
export const TraitEngine_provided = {
  /// Requires that `ty` must implement the trait with `def_id` in
  /// the given environment. This trait must not have any type
  /// parameters (except for `Self`).
  // rustc: compiler/rustc_infer/src/traits/engine.rs:125 register_bound
  register_bound<E>(self: TraitEngine<E>, infcx: InferCtxt, param_env: ParamEnv, ty: Ty, def_id: DefId, cause: ObligationCause): void {
    const trait_ref = TraitRef.new(as_interner(infcx.tcx), def_id, [GenericArg.from_Ty(ty)]);
    self.register_predicate_obligation(infcx, new Obligation(cause, param_env, Predicate_upcast_from_TraitRef(trait_ref, infcx.tcx), 0));
  },

  // rustc: compiler/rustc_infer/src/traits/engine.rs:151 register_predicate_obligations
  register_predicate_obligations<E>(self: TraitEngine<E>, infcx: InferCtxt, obligations: PredicateObligations): void {
    for (const obligation of obligations) {
      self.register_predicate_obligation(infcx, obligation);
    }
  },

  /// Evaluate all pending obligations, return error if they can't be evaluated.
  ///
  /// For each result:
  /// Ok: remove the obligation from the list
  /// Ambiguous: remove the obligation from the list and return an error
  /// Err: remove the obligation from the list and return an error
  ///
  /// Returns a list of errors from obligations that evaluated to Ambiguous or Err.
  // rustc: compiler/rustc_infer/src/traits/engine.rs:183 evaluate_obligations_error_on_ambiguity
  evaluate_obligations_error_on_ambiguity<E>(self: TraitEngine<E>, infcx: InferCtxt): TraitErrors<E> {
    const errors = self.try_evaluate_obligations(infcx);
    if (TraitErrors.has_errors(errors)) {
      return errors;
    }

    return self.collect_remaining_errors(infcx);
  },

  /// Pending obligations potentially referencing an inference variable whose
  /// sub-unification root is `_sub_root`. May be conservative: implementations
  /// can return obligations that don't actually reference `_sub_root` (the
  /// default just returns everything).
  // rustc: compiler/rustc_infer/src/traits/engine.rs:203 pending_obligations_potentially_referencing_sub_root
  pending_obligations_potentially_referencing_sub_root<E>(self: TraitEngine<E>, _infcx: InferCtxt, _sub_root: TyVid): PredicateObligations {
    return self.pending_obligations();
  },

  /// Pending obligations potentially referencing float inference variables.
  ///
  /// FIXME: use a generic filter for `pending_obligations_potentially_referencing_sub_root`
  /// and this after `TraitEngine` doesn't need to be dyn compatible.
  // rustc: compiler/rustc_infer/src/traits/engine.rs:215 pending_obligations_potentially_referencing_float_infer
  pending_obligations_potentially_referencing_float_infer<E>(self: TraitEngine<E>, _infcx: InferCtxt): PredicateObligations {
    return self.pending_obligations();
  },
};

// PORT (D4): `trait FromSolverError<'tcx, E>` (an associated fn constructing `Self`) is a descriptor over `Self`, one
// object per impl (`FromSolverError_<Self>`), passed where upstream has the bound.
// rustc-trait: compiler/rustc_infer/src/traits/engine.rs:231 FromSolverError
export interface FromSolverError<Self, E> {
  // rustc: compiler/rustc_infer/src/traits/engine.rs:232 from_solver_error
  from_solver_error(infcx: InferCtxt, error: E): Self;
}


export type ScrubbedTraitError = gen.ScrubbedTraitError;
export const ScrubbedTraitError: typeof gen.ScrubbedTraitError & Companions["ScrubbedTraitError"] = {
  ...gen.ScrubbedTraitError,

  // rustc: compiler/rustc_infer/src/traits/engine.rs:29 is_true_error
  is_true_error(self: ScrubbedTraitError): boolean {
    switch (self.$) {
      case "TrueError":
        return true;
      case "Ambiguity":
      case "Cycle":
        return false;
    }
  },
};

export type TraitErrors<E> = gen.TraitErrors<E>;
export const TraitErrors: typeof gen.TraitErrors &
  Companions["TraitErrors"] & {
    /** `impl IntoIterator for &TraitErrors` (engine.rs:111). */
    into_iter_ref<E>(self: TraitErrors<E>): Iterable<E>;
  } = {
  ...gen.TraitErrors,

  // PORT: `impl ExactSizeIterator<Item = E>` is an array (decls.ts).
  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:46 from_iter
  from_iter<E>(iter: readonly E[]): TraitErrors<E> {
    if (iter.length === 0) {
      return TraitErrors.NoErrors;
    } else {
      return { $: "HasErrors", _0: [...iter] };
    }
  },

  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:51 has_errors
  has_errors<E>(self: TraitErrors<E>): boolean {
    return self.$ === "HasErrors";
  },

  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:56 no_errors
  no_errors<E>(self: TraitErrors<E>): boolean {
    return self.$ === "NoErrors";
  },

  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:61 as_slice
  as_slice<E>(self: TraitErrors<E>): readonly E[] {
    switch (self.$) {
      case "HasErrors":
        return self._0;
      case "NoErrors":
        return [];
    }
  },

  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:69 as_mut_slice
  as_mut_slice<E>(self: TraitErrors<E>): E[] {
    switch (self.$) {
      case "HasErrors":
        return self._0;
      case "NoErrors":
        return [];
    }
  },

  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:77 into_thin_vec
  into_thin_vec<E>(self: TraitErrors<E>): E[] {
    switch (self.$) {
      case "HasErrors":
        return self._0;
      case "NoErrors":
        return [];
    }
  },

  // PORT: `&mut self`: the new value is returned and the caller stores it (decls.ts).
  // #[cold]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:85 push
  push<E>(self: TraitErrors<E>, err: E): TraitErrors<E> {
    switch (self.$) {
      case "HasErrors":
        self._0.push(err);
        return self;
      case "NoErrors":
        return { $: "HasErrors", _0: [err] };
    }
  },

  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:93 len
  len<E>(self: TraitErrors<E>): number {
    switch (self.$) {
      case "HasErrors":
        return self._0.length;
      case "NoErrors":
        return 0;
    }
  },

  /** `impl IntoIterator for TraitErrors` */
  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:106 into_iter
  into_iter<E>(self: TraitErrors<E>): Iterable<E> {
    return TraitErrors.into_thin_vec(self);
  },

  /** `impl<'a, E> IntoIterator for &'a TraitErrors<E>` */
  // #[inline]
  // rustc: compiler/rustc_infer/src/traits/engine.rs:116 into_iter
  into_iter_ref<E>(self: TraitErrors<E>): Iterable<E> {
    return TraitErrors.as_slice(self);
  },
};
