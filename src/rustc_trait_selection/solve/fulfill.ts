// Port of compiler/rustc_trait_selection/src/solve/fulfill.rs (lane trait-sel-solve).
//
// PORT: `FulfillmentCtxt<'tcx, E>` implements rustc_infer's `TraitEngine<E>` interface (traits/engine.ts); the provided
// methods it does not override forward to `TraitEngine_provided`. The bound `E: FromSolverError<'tcx, NextSolverError>`
// of the `TraitEngine` impl is the D4 descriptor `from_solver_error_E`, held in place of the `_errors: PhantomData<E>`
// field (so `FulfillmentCtxt::new(infcx)` takes it too).
// PORT: `ThinVec::retain_mut` keeps the elements in order and mutates them in place; it is a loop that rebuilds
// `pending` from the kept entries.
// PORT: `PendingObligations` entries are `[obligation, stalled_on]` pairs; `obligation.predicate = ..` /
// `obligation.recursion_depth += 1` write to the `Obligation` object (the pair owns it).
// `FulfillmentError` is traits/mod.gen.ts's generated type (re-exported by decls.ts).

import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { clone_Obligation, visit_with_Obligation, type PredicateObligation, type PredicateObligations, ScrubbedTraitError, TraitEngine_provided, TraitErrors } from "../../rustc_infer/traits/mod.ts";
import type { FromSolverError, TraitEngine } from "../../rustc_infer/traits/engine.ts";
import { debug_Obligation } from "../../rustc_infer/traits/structural_impls.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/decls.ts";
import type { Predicate } from "../../rustc_middle/ty/predicate.ts";
import { debug_Predicate, fold_Predicate } from "../../rustc_middle/ty/structural_impls.ts";
import { solve } from "../../rustc_next_trait_solver/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { TyVid } from "../../rustc_type_ir/decls.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { debug_GoalStalledOn, type GoalStalledOn, type NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { TyOrConstInferVar } from "../../rustc_type_ir/solve/mod.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { debug_option, debug_struct, debug_tuple, debug_vec, type Debug } from "../../std/fmt.ts";
import { assert, assert_eq } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { FulfillmentError } from "../decls.ts";
import { SolverDelegate } from "./delegate.ts";
import { fulfillment_error_for_no_solution, fulfillment_error_for_stalled } from "./fulfill/derive_errors.ts";

// `ThinVec` is important for performance, but not for the usual memory layout reasons.
// `try_evaluate_obligations` is extremely hot and uses `retain_mut`. `ThinVec::retain_mut` is
// simple and sub-optimal in terms of how it moves elements, but it can be inlined.
// `Vec::retain_mut` is more sophisticated and minimizes element moves, but also contains more code
// and doesn't get inlined in `try_evaluate_obligations`, giving worse performance overall.
type PendingObligations = [PredicateObligation, GoalStalledOn | undefined][];

/// A trait engine using the new trait solver.
///
/// This is mostly identical to how `evaluate_all` works inside of the
/// solver, except that the requirements are slightly different.
///
/// Unlike `evaluate_all` it is possible to add new obligations later on
/// and we also have to track diagnostics information by using `Obligation`
/// instead of `Goal`.
///
/// It is also likely that we want to use slightly different datastructures
/// here as this will have to deal with far more root goals than `evaluate_all`.
export class FulfillmentCtxt<E> implements TraitEngine<E> {
  constructor(
    public obligations: ObligationStorage,

    /// The snapshot in which this context was created. Using the context
    /// outside of this snapshot leads to subtle bugs if the snapshot
    /// gets rolled back. Because of this we explicitly check that we only
    /// use the context in exactly this snapshot.
    public usable_in_snapshot: number,
    /** PORT: `_errors: PhantomData<E>` carries `E`'s `FromSolverError` descriptor (module comment). */
    public _errors: FromSolverError<E, NextSolverError>,
  ) {}

  // ---- impl<'tcx, E: 'tcx> FulfillmentCtxt<'tcx, E> ----

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:96 new
  static new<E>(infcx: InferCtxt, from_solver_error_E: FromSolverError<E, NextSolverError>): FulfillmentCtxt<E> {
    assert(infcx.next_trait_solver(), "new trait solver fulfillment context created when infcx is set up for old trait solver");
    return new FulfillmentCtxt<E>(ObligationStorage.default_(), infcx.num_open_snapshots(), from_solver_error_E);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:109 inspect_evaluated_obligation
  static inspect_evaluated_obligation(infcx: InferCtxt, obligation: PredicateObligation, result: Result<solve.GoalEvaluation, NoSolution>): void {
    const inspector = infcx.obligation_inspector;
    if (inspector !== undefined) {
      const result_ = result.$ === "Ok" ? Ok(result._0.certainty) : Err(solve.NO_SOLUTION);
      inspector(infcx, obligation, result_);
    }
  }

  // ---- impl<'tcx, E> TraitEngine<'tcx, E> for FulfillmentCtxt<'tcx, E> where E: FromSolverError<'tcx, NextSolverError<'tcx>> ----

  // #[instrument(level = "trace", skip(self, infcx))]
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:129 register_predicate_obligation
  register_predicate_obligation(infcx: InferCtxt, obligation: PredicateObligation): void {
    assert_eq(this.usable_in_snapshot, infcx.num_open_snapshots(), String);

    const delegate = SolverDelegate.from(infcx);
    const r = solve.fast_path.compute_goal_fast_path(delegate, obligation.as_goal(), obligation.cause.span);
    if (r !== undefined) {
      const { certainty, stalled_on } = r;
      // If we can take the fast path, don't even bother adding the goal to obligations,
      // or if `Certainty::Maybe`, add it with precise stalled_on information.
      switch (certainty.$) {
        case "Yes":
          break;
        case "Maybe":
          this.obligations.register(obligation, stalled_on);
          break;
      }
    } else {
      this.obligations.register(obligation, undefined);
    }
  }

  // #[inline]
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:154 collect_remaining_errors
  collect_remaining_errors(infcx: InferCtxt): TraitErrors<E> {
    if (this.obligations.pending.length === 0) {
      // Typically in more than 99.9% of cases this condition is true, therefore we outline
      // the other case.
      return TraitErrors.NoErrors;
    } else {
      return { $: "HasErrors", _0: collect_remaining_errors_impl(this, infcx) };
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:164 try_evaluate_obligations
  try_evaluate_obligations(infcx: InferCtxt): TraitErrors<E> {
    assert_eq(this.usable_in_snapshot, infcx.num_open_snapshots(), String);
    // PORT: `let mut errors = TraitErrors::NoErrors;` (pushed to by the closure): a local cell.
    const errors_cell: { value: TraitErrors<E> } = { value: TraitErrors.NoErrors };
    const delegate = SolverDelegate.from(infcx);
    for (;;) {
      let any_changed = false;

      // `self.obligations.pending.retain_mut(|(obligation, opt_stalled_on)| { .. })`
      const kept: PendingObligations = [];
      for (const entry of this.obligations.pending) {
        if (this.retain_pending(infcx, delegate, entry, errors_cell, () => (any_changed = true))) {
          kept.push(entry);
        }
      }
      this.obligations.pending = kept;

      if (!any_changed) {
        break;
      }
    }

    return errors_cell.value;
  }

  /** PORT: the `retain_mut` closure of `try_evaluate_obligations` (fulfill.rs:171-255); `true` keeps the entry. */
  private retain_pending(
    infcx: InferCtxt,
    delegate: SolverDelegate,
    entry: [PredicateObligation, GoalStalledOn | undefined],
    errors: { value: TraitErrors<E> },
    set_any_changed: () => void,
  ): boolean {
    const obligation = entry[0];
    const opt_stalled_on = entry[1];
    // Common case: still stalled; keep the obligation. This path is extremely hot in
    // some cases; there can be thousands of pending obligations.
    if (opt_stalled_on !== undefined && solve.SolverDelegateEvalExt_for_D.goal_remains_stalled(delegate, opt_stalled_on)) {
      return true;
    }

    // `opt_stalled_on.take()`
    entry[1] = undefined;
    const result = solve.SolverDelegateEvalExt_for_D.evaluate_root_goal(delegate, obligation.as_goal(), obligation.cause.span, opt_stalled_on);
    FulfillmentCtxt.inspect_evaluated_obligation(infcx, obligation, result);
    if (result.$ === "Err") {
      TraitErrors_push(errors, this._errors.from_solver_error(infcx, { $: "TrueError", _0: clone_PredicateObligation(obligation) }));
      return false;
    }
    const { goal, certainty, has_changed, stalled_on } = result._0;

    // We've resolved the goal in `evaluate_root_goal`, avoid redoing this work
    // in the next iteration. This does not resolve the inference variables
    // constrained by evaluating the goal.
    obligation.predicate = goal.predicate;
    if (has_changed === "Yes") {
      if (!infcx.tcx.recursion_limit().value_within_limit(obligation.recursion_depth)) {
        // We limit the total count of inference progress to avoid hang so we don't
        // try to recover from this.
        // It's more complicated to collect all overflows thus we stopped doing that.
        // Eager aborting is also what the old solver does.
        //
        // Note: it's incredibly rare to actually encounter fulfillment overflow
        // as a single obligation would have to result in different inference progress
        // a `recursion_depth` number of times. This mostly happens in bugs or with
        // `Subtype` obligations because we no longer use the `sub_unification_table`
        // in generalization.
        // PORT(merge): `TypeErrCtxt::report_overflow_obligation` (error_reporting, wave 19 errctxt-contract):
        // `TypeErrCtxt` is a `Pending` alias in decls.ts until then.
        (infcx.err_ctxt() as unknown as { report_overflow_obligation(o: PredicateObligation, suggest_increasing_limit: boolean): never }).report_overflow_obligation(
          obligation,
          true,
        );
      } else {
        // We increment the recursion depth here to track the number of times
        // this goal has resulted in inference progress. This doesn't precisely
        // model the way that we track recursion depth in the old solver due
        // to the fact that we only process root obligations, but it is a good
        // approximation and should only result in fulfillment overflow in
        // pathological cases.
        obligation.recursion_depth += 1;
        set_any_changed();
      }
    }

    switch (certainty.$) {
      case "Yes":
        // Goals may depend on structural identity. Region uniquification at the
        // start of MIR borrowck may cause things to no longer be so, potentially
        // causing an ICE.
        //
        // While we uniquify root goals in HIR this does not handle cases where
        // regions are hidden inside of a type or const inference variable.
        //
        // FIXME(-Znext-solver): This does not handle inference variables hidden
        // inside of an opaque type, e.g. if there's `Opaque = (?x, ?x)` in the
        // storage, we can also rely on structural identity of `?x` even if we
        // later uniquify it in MIR borrowck.
        if (
          infcx.in_hir_typeck &&
          (TypeVisitableExt.has_non_region_infer(obligation, visit_PredicateObligation) ||
            TypeVisitableExt.has_free_regions(obligation, visit_PredicateObligation))
        ) {
          infcx.push_hir_typeck_potentially_region_dependent_goal(clone_PredicateObligation(obligation));
        }
        return false;
      case "Maybe":
        // Update `opt_stalled_on` goal, for the next retain_mut, because we are
        // running until a fixpoint.
        entry[1] = stalled_on;
        return true;
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:265 has_pending_obligations
  has_pending_obligations(): boolean {
    return this.obligations.has_pending_obligations();
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:269 pending_obligations
  pending_obligations(): PredicateObligations {
    return this.obligations.clone_pending();
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:273 pending_obligations_potentially_referencing_sub_root
  pending_obligations_potentially_referencing_sub_root(infcx: InferCtxt, vid: TyVid): PredicateObligations {
    // `-Zdisable-fast-paths`: same gate as the other new-solver fast paths.
    if (infcx.tcx.disable_trait_solver_fast_paths()) {
      return this.obligations.clone_pending();
    }
    return this.obligations.clone_pending_filtered(([, stalled_on]) => {
      if (stalled_on === undefined) return true;
      // Don't reuse the sub-unification roots cached on `stalled_on`:
      // a later sub-unification merge can have changed which root
      // each stalled var belongs to, so the cached info can be stale.
      // Walk `stalled_vars` and recompute the current root instead.
      //
      // Conservative here: if a stalled var no longer resolves to an
      // infer var, some unification happened, so the goal is no longer
      // stalled. Include it to be re-evaluated downstream.
      for (const arg of stalled_on.stalled_vars) {
        const ty = TyOrConstInferVar.as_type(arg, infcx.tcx);
        if (ty === undefined) continue;
        const k = infcx.shallow_resolve(ty).kind();
        if (k.$ === "Infer" && k._0.$ === "TyVar") {
          if (infcx.sub_unification_table_root_var(k._0._0) === vid) return true;
        } else {
          return true;
        }
      }
      return false;
    });
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:301 pending_obligations_potentially_referencing_float_infer
  pending_obligations_potentially_referencing_float_infer(infcx: InferCtxt): PredicateObligations {
    // `-Zdisable-fast-paths`: same gate as the other new-solver fast paths.
    if (infcx.tcx.disable_trait_solver_fast_paths()) {
      return this.obligations.clone_pending();
    }

    return this.obligations.clone_pending_filtered(([, stalled_on]) => {
      if (stalled_on === undefined) return true;
      // If the stalled vars don't have float infers, the nested goals won't
      // have them either. We only create float infers for user written literals.
      return stalled_on.stalled_vars.some((arg) => {
        const ty = TyOrConstInferVar.as_type(arg, infcx.tcx);
        if (ty === undefined) return false;
        const k = infcx.shallow_resolve(ty).kind();
        return k.$ === "Infer" && k._0.$ === "FloatVar";
      });
    });
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:322 drain_stalled_obligations_for_coroutines
  drain_stalled_obligations_for_coroutines(infcx: InferCtxt): PredicateObligations {
    const mode = TypingMode.assert_not_erased(infcx.typing_mode_raw());
    let stalled_coroutines;
    switch (mode.$) {
      case "Typeck":
        stalled_coroutines = mode.defining_opaque_types_and_generators;
        break;
      case "Coherence":
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
      case "Reflection":
      case "PostAnalysis":
      case "Codegen":
        return [];
      case "ErasedNotCoherence":
        // PORT: `TypingMode<CantBeErased>` has no such value (its payload is `!`); the arm only satisfies the TS switch.
        return mode._0;
    }

    if (stalled_coroutines.length === 0) {
      return [];
    }

    return this.obligations
      .drain_pending((_, stalled_on) => {
        if (stalled_on === undefined) return false;
        switch (stalled_on.stalled_maybe_info.stalled_on_coroutines) {
          case "Yes":
            return true;
          case "No":
            return false;
        }
      })
      .map(([o]) => o);
  }

  // (provided) TraitEngine methods this impl does not override.
  register_bound(infcx: InferCtxt, param_env: ParamEnv, ty: Ty, def_id: DefId, cause: ObligationCause): void {
    TraitEngine_provided.register_bound(this, infcx, param_env, ty, def_id, cause);
  }
  register_predicate_obligations(infcx: InferCtxt, obligations: PredicateObligations): void {
    TraitEngine_provided.register_predicate_obligations(this, infcx, obligations);
  }
  evaluate_obligations_error_on_ambiguity(infcx: InferCtxt): TraitErrors<E> {
    return TraitEngine_provided.evaluate_obligations_error_on_ambiguity(this, infcx);
  }
}

// #[derive(Default, Debug)]
class ObligationStorage {
  constructor(public pending: PendingObligations) {}

  /** `#[derive(Default)]` */
  static default_(): ObligationStorage {
    return new ObligationStorage([]);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:61 register
  register(obligation: PredicateObligation, stalled_on: GoalStalledOn | undefined): void {
    this.pending.push([obligation, stalled_on]);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:69 has_pending_obligations
  has_pending_obligations(): boolean {
    return this.pending.length !== 0;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:73 clone_pending
  clone_pending(): PredicateObligations {
    return this.pending.map(([o]) => clone_PredicateObligation(o));
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:77 clone_pending_filtered
  clone_pending_filtered(f: (entry: readonly [PredicateObligation, GoalStalledOn | undefined]) => boolean): PredicateObligations {
    return this.pending.filter(f).map(([o]) => clone_PredicateObligation(o));
  }

  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:84 drain_pending
  drain_pending(cond: (o: PredicateObligation, s: GoalStalledOn | undefined) => boolean): PendingObligations {
    // `mem::take(&mut self.pending).into_iter().partition(|(o, s)| cond(o, s))`
    const taken = this.pending;
    this.pending = [];
    const unstalled: PendingObligations = [];
    const pending: PendingObligations = [];
    for (const entry of taken) {
      if (cond(entry[0], entry[1])) unstalled.push(entry);
      else pending.push(entry);
    }
    this.pending = pending;
    return unstalled;
  }
}

/** `#[derive(Debug)]` of `ObligationStorage`. */
export const debug_ObligationStorage: Debug<ObligationStorage> = (v, f) =>
  debug_struct(f, "ObligationStorage", [
    [
      "pending",
      debug_vec(v.pending, f, (e, f) =>
        debug_tuple(f, "", [debug_Obligation(e[0], f, debug_Predicate), debug_option(e[1], f, debug_GoalStalledOn)]),
      ),
    ],
  ]);

// #[cold]
// #[inline(never)]
// rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:359 collect_remaining_errors_impl
function collect_remaining_errors_impl<E>(cx: FulfillmentCtxt<E>, infcx: InferCtxt): E[] {
  // `cx.obligations.pending.drain(..)`
  const drained = cx.obligations.pending;
  cx.obligations.pending = [];
  return drained
    .map(([obligation]): NextSolverError => ({ $: "Ambiguity", _0: obligation }))
    .map((e) => cx._errors.from_solver_error(infcx, e));
}

export type NextSolverError = { readonly $: "TrueError"; _0: PredicateObligation } | { readonly $: "Ambiguity"; _0: PredicateObligation };

/** `impl<'tcx> FromSolverError<'tcx, NextSolverError<'tcx>> for FulfillmentError<'tcx>` */
export const FromSolverError_FulfillmentError: FromSolverError<FulfillmentError, NextSolverError> = {
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:380 from_solver_error
  from_solver_error(infcx: InferCtxt, error: NextSolverError): FulfillmentError {
    switch (error.$) {
      case "TrueError":
        return fulfillment_error_for_no_solution(infcx, error._0);
      case "Ambiguity":
        return fulfillment_error_for_stalled(infcx, error._0);
    }
  },
};

/** `impl<'tcx> FromSolverError<'tcx, NextSolverError<'tcx>> for ScrubbedTraitError<'tcx>` */
export const FromSolverError_ScrubbedTraitError: FromSolverError<ScrubbedTraitError, NextSolverError> = {
  // rustc: compiler/rustc_trait_selection/src/solve/fulfill.rs:393 from_solver_error
  from_solver_error(_infcx: InferCtxt, error: NextSolverError): ScrubbedTraitError {
    switch (error.$) {
      case "TrueError":
        return ScrubbedTraitError.TrueError;
      case "Ambiguity":
        return ScrubbedTraitError.Ambiguity;
    }
  },
};

// Some types are used a lot. Make sure they don't unintentionally get bigger.
// #[cfg(target_pointer_width = "64")]
// mod size_asserts { static_assert_size!((PredicateObligation<'_>, Option<GoalStalledOn<TyCtxt<'_>>>), 104); }

// ---- helpers ----------------------------------------------------------------------------------------------------------

/** `TraitErrors::push` (rustc_infer traits/engine.rs) on a local `errors` cell. */
function TraitErrors_push<E>(errors: { value: TraitErrors<E> }, e: E): void {
  errors.value = TraitErrors.push(errors.value, e);
}

/** `obligation.clone()` (`PredicateObligation: Clone`). */
export function clone_PredicateObligation(o: PredicateObligation): PredicateObligation {
  return clone_Obligation(o, (p: Predicate) => p);
}

/** D4: `PredicateObligation: TypeVisitable` (rustc_infer traits/mod.rs's derive). */
export const visit_PredicateObligation: TypeVisitable<PredicateObligation> = {
  visit_with: <R>(s: PredicateObligation, v: TypeVisitor<R>): R => Obligation_visit(s, v),
};
function Obligation_visit<R>(s: PredicateObligation, v: TypeVisitor<R>): R {
  return visit_with_Obligation(s, v, fold_Predicate.visit_with);
}

