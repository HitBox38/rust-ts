// Port of compiler/rustc_infer/src/traits/engine.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Companions } from "../decls.ts";
import * as gen from "./engine.gen.ts";

export * from "./engine.gen.ts";

import type { DefId } from "../../rustc_span/def_id.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/decls.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyVid } from "../../rustc_type_ir/decls.ts";
import { unported } from "../../std/panic.ts";
import type { InferCtxt } from "../decls.ts";
import type { PredicateObligation, PredicateObligations } from "./mod.gen.ts";

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

/** The provided methods of `TraitEngine` (stubs until lane infer-opaque-snapshot ports them; `self` first). */
export const TraitEngine_provided = {
  register_bound<E>(_self: TraitEngine<E>, _infcx: InferCtxt, _param_env: ParamEnv, _ty: Ty, _def_id: DefId, _cause: ObligationCause): void {
    return unported("rustc_infer::traits::engine::TraitEngine::register_bound");
  },
  register_predicate_obligations<E>(_self: TraitEngine<E>, _infcx: InferCtxt, _obligations: PredicateObligations): void {
    return unported("rustc_infer::traits::engine::TraitEngine::register_predicate_obligations");
  },
  evaluate_obligations_error_on_ambiguity<E>(_self: TraitEngine<E>, _infcx: InferCtxt): TraitErrors<E> {
    return unported("rustc_infer::traits::engine::TraitEngine::evaluate_obligations_error_on_ambiguity");
  },
  pending_obligations_potentially_referencing_sub_root<E>(_self: TraitEngine<E>, _infcx: InferCtxt, _sub_root: TyVid): PredicateObligations {
    return unported("rustc_infer::traits::engine::TraitEngine::pending_obligations_potentially_referencing_sub_root");
  },
  pending_obligations_potentially_referencing_float_infer<E>(_self: TraitEngine<E>, _infcx: InferCtxt): PredicateObligations {
    return unported("rustc_infer::traits::engine::TraitEngine::pending_obligations_potentially_referencing_float_infer");
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
export const ScrubbedTraitError = { ...gen.ScrubbedTraitError } as typeof gen.ScrubbedTraitError & Companions["ScrubbedTraitError"];
unported_methods(ScrubbedTraitError, "rustc_infer::traits::engine::ScrubbedTraitError", ["is_true_error"]);

export type TraitErrors<E> = gen.TraitErrors<E>;
export const TraitErrors = { ...gen.TraitErrors } as typeof gen.TraitErrors & Companions["TraitErrors"];
unported_methods(TraitErrors, "rustc_infer::traits::engine::TraitErrors", ["from_iter", "has_errors", "no_errors", "as_slice", "as_mut_slice", "into_thin_vec", "push", "len", "into_iter"]);
