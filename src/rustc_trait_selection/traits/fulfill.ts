// Port of compiler/rustc_trait_selection/src/traits/fulfill.rs (lane selcx-contract): the old solver's
// `FulfillmentContext`, the `TraitEngine` that drives an `ObligationForest` of `PendingPredicateObligation`s through
// `SelectionContext` / `project`.
//
// PORT (representation):
// - `impl ForestObligation for PendingPredicateObligation` is the descriptor `ForestObligation_PendingPredicateObligation`
//   (obligation_forest/mod.ts: `as_cache_key` returns the canonical key of the `ParamEnvAnd<Predicate>` cache key,
//   `intern_key`).
// - `FulfillmentContext<'tcx, E>` (codegen `hand`) implements rustc_infer's `TraitEngine<E>`; the bound
//   `E: FromSolverError<'tcx, OldSolverError<'tcx>>` is the D4 descriptor held in place of `_errors: PhantomData<E>` (as the
//   next solver's `FulfillmentCtxt`), so `FulfillmentContext::new(infcx)` takes it too.
// - `FulfillProcessor` (generated class) and the local `DrainProcessor` implement obligation_forest's
//   `ObligationProcessor`; `type OUT = Outcome<..>` is `OUT_new() = Outcome.new()`.
// - `&mut pending_obligation.stalled_on` is the array itself (cleared / pushed in place); `stalled_on = vec![..]` replaces
//   the field.
// - `impl FromSolverError<OldSolverError> for FulfillmentError / ScrubbedTraitError` are the descriptors
//   `FromSolverError_FulfillmentError` / `FromSolverError_ScrubbedTraitError` (engine.ts's `FulfillmentErrorKinds_*.from_old`).
// - Structural `==` on `Predicate`s is `===` (interned); on `Binder<AliasTerm>` / `AliasConstKind` it is the derived
//   `PartialEq`, compared through `intern_key`.
// - `debug!` / `debug_span!` / `#[instrument]` are dropped (no tracing in the port).
//
// Init order: top-level code here touches only ./fulfill.gen.ts and other crates; the other rustc_trait_selection modules
// are read inside function bodies only.

import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import {
  type Error,
  type ForestObligation,
  ObligationForest,
  type ObligationProcessor,
  ObligationProcessor_provided,
  Outcome,
  type ProcessResult,
  ProcessResult as ProcessResultC,
} from "../../rustc_data_structures/obligation_forest/mod.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { ToTrace_AliasTerm, ToTrace_Const, ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { DefineOpaqueTypes } from "../../rustc_infer/infer/at.gen.ts";
import { type FromSolverError, type TraitEngine, TraitEngine_provided, ScrubbedTraitError, TraitErrors } from "../../rustc_infer/traits/engine.ts";
import type { PolyTraitObligation, PredicateObligation, PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import { clone_Obligation } from "../../rustc_infer/traits/mod.ts";
import { ImplSource, type ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { Clauses, GenericArgs, ParamEnv, Predicate, Region, Ty } from "../../rustc_middle/ty/decls.ts";
import { GenericArg, fold_GenericArg, fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { ParamConst } from "../../rustc_middle/ty/sty.ts";
import { Term } from "../../rustc_middle/ty/mod.ts";
import type { PolyTraitClause } from "../../rustc_middle/ty/predicate.ts";
import { Predicate_upcast_from_Binder_PredicateKind, Predicate_upcast_from_PolyHostEffectClause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { Binder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import type { TyVid } from "../../rustc_type_ir/decls.ts";
import { ExpectedFound } from "../../rustc_type_ir/error.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { may_use_unstable_feature } from "../../rustc_type_ir/infer_ctxt.ts";
import type { List } from "../../rustc_middle/ty/list.ts";
import { fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import { DelayedSet } from "../../rustc_type_ir/data_structures/delayed_map.ts";
import { TyOrConstInferVar } from "../../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { AliasTerm as AliasTermC } from "../../rustc_type_ir/term_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { assert, assert_eq, panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import type { FulfillmentError, FulfillmentErrorCode } from "./mod.gen.ts";
import { clone_PendingPredicateObligation, debug_PendingPredicateObligation, FulfillProcessor, type PendingPredicateObligation, type PendingPredicateObligations } from "./fulfill.gen.ts";
import type { SelectionContext } from "./select/mod.ts";
import type { HostEffectObligation } from "./effects.ts";
import type { PolyProjectionObligation } from "./project.gen.ts";

export * from "./fulfill.gen.ts";

/** `TypeFoldable` of `PredicateKind` (generated impls) as a D4 descriptor. */
const fold_PredicateKind = {
  visit_with: visit_with_PredicateKind,
  try_fold_with: try_fold_with_PredicateKind,
  fold_with: fold_with_PredicateKind,
};

/** Lazily read modules of this crate (init order: module comment). */
function select_mod(): typeof import("./select/mod.ts") {
  return (select_mod__m ??= require("./select/mod.ts") as typeof import("./select/mod.ts"));
}
var select_mod__m: typeof import("./select/mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function traits_mod(): typeof import("./mod.ts") {
  return (traits_mod__m ??= require("./mod.ts") as typeof import("./mod.ts"));
}
var traits_mod__m: typeof import("./mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

// ---- impl<'tcx> ForestObligation for PendingPredicateObligation<'tcx> (fulfill.rs:41) -----------------------------------

export const ForestObligation_PendingPredicateObligation: ForestObligation<PendingPredicateObligation> = {
  clone: clone_PendingPredicateObligation,
  debug: debug_PendingPredicateObligation,
  /// Note that we include both the `ParamEnv` and the `Predicate`,
  /// as the `ParamEnv` can influence whether fulfillment succeeds
  /// or fails.
  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:47 as_cache_key
  as_cache_key(self: PendingPredicateObligation): string {
    return intern_key(self.obligation.param_env.and(self.obligation.predicate));
  },
};

/// The fulfillment context is used to drive trait resolution. It
/// consists of a list of obligations that must be (eventually)
/// satisfied. The job is to track which are satisfied, which yielded
/// errors, and which are still pending. At any point, users can call
/// `try_evaluate_obligations`, and the fulfillment context will try to do
/// selection, retaining only those obligations that remain
/// ambiguous. This may be helpful in pushing type inference
/// along. Once all type inference constraints have been generated, the
/// method `evaluate_obligations_error_on_ambiguity` can be used to report any remaining
/// ambiguous cases as errors.
// rustc-type: compiler/rustc_trait_selection/src/traits/fulfill.rs:62 FulfillmentContext
export class FulfillmentContext<E> implements TraitEngine<E> {
  constructor(
    /// A list of all obligations that have been registered with this
    /// fulfillment context.
    public predicates: ObligationForest<PendingPredicateObligation>,

    /// The snapshot in which this context was created. Using the context
    /// outside of this snapshot leads to subtle bugs if the snapshot
    /// gets rolled back. Because of this we explicitly check that we only
    /// use the context in exactly this snapshot.
    public usable_in_snapshot: number,

    /** PORT: `_errors: PhantomData<E>` carries `E`'s `FromSolverError<OldSolverError>` descriptor (module comment). */
    public _errors: FromSolverError<E, OldSolverError>,
  ) {}

  // ---- impl<'tcx, E> FulfillmentContext<'tcx, E> where E: FromSolverError<'tcx, OldSolverError<'tcx>> ----

  /// Creates a new fulfillment context.
  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:95 new
  static new<E>(infcx: InferCtxt, from_solver_error_E: FromSolverError<E, OldSolverError>): FulfillmentContext<E> {
    assert(!infcx.next_trait_solver(), "old trait solver fulfillment context created when infcx is set up for new trait solver");
    return new FulfillmentContext<E>(ObligationForest.new(ForestObligation_PendingPredicateObligation), infcx.num_open_snapshots(), from_solver_error_E);
  }

  /// Attempts to select obligations using `selcx`.
  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:109 select
  select(selcx: SelectionContext): TraitErrors<E> {
    // let span = debug_span!("select", obligation_forest_size = ?self.predicates.len());
    const infcx = selcx.infcx;

    // Process pending obligations.
    const outcome: Outcome<PendingPredicateObligation, FulfillmentErrorCode> = this.predicates.process_obligations(new FulfillProcessor(selcx));

    // FIXME: if we kept the original cache key, we could mark projection
    // obligations as complete for the projection cache here.

    const errors = TraitErrors.from_iter(outcome.errors.map((err) => this._errors.from_solver_error(infcx, new OldSolverError(err))));

    // debug!("select({} predicates remaining, {} errors) done", self.predicates.len(), errors.len());

    return errors;
  }

  // ---- impl<'tcx, E> TraitEngine<'tcx, E> for FulfillmentContext<'tcx, E> ----

  // #[inline]
  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:140 register_predicate_obligation
  register_predicate_obligation(infcx: InferCtxt, obligation: PredicateObligation): void {
    assert_eq(this.usable_in_snapshot, infcx.num_open_snapshots(), String);
    // this helps to reduce duplicate errors, as well as making
    // debug output much nicer to read and so on.
    // debug_assert!(!obligation.param_env.has_non_region_infer());
    obligation.predicate = infcx.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);

    // debug!(?obligation, "register_predicate_obligation");

    this.predicates.register_obligation({ obligation, stalled_on: [] });
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:157 collect_remaining_errors
  collect_remaining_errors(infcx: InferCtxt): TraitErrors<E> {
    const ambiguity: FulfillmentErrorCode = { $: "Ambiguity", overflow: undefined };
    return TraitErrors.from_iter(
      this.predicates
        .to_errors(ambiguity, (e) => ({ ...e }))
        .map((err) => this._errors.from_solver_error(infcx, new OldSolverError(err))),
    );
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:166 try_evaluate_obligations
  try_evaluate_obligations(infcx: InferCtxt): TraitErrors<E> {
    const selcx = select_mod().SelectionContext.new(infcx);
    return this.select(selcx);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:171 drain_stalled_obligations_for_coroutines
  drain_stalled_obligations_for_coroutines(infcx: InferCtxt): PredicateObligations {
    const mode = TypingMode.assert_not_erased(infcx.typing_mode_raw());
    let stalled_coroutines: List<LocalDefId>;
    switch (mode.$) {
      case "Typeck":
        stalled_coroutines = mode.defining_opaque_types_and_generators;
        break;
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
      case "Reflection":
      case "PostAnalysis":
      case "Codegen":
        return [];
      case "Coherence":
        return unreachable("internal error: entered unreachable code: old solver coherence");
      case "ErasedNotCoherence":
        // PORT: `TypingMode<CantBeErased>` has no such value (its payload is `!`); the arm only satisfies the TS switch.
        return mode._0;
    }

    if (stalled_coroutines.length === 0) {
      return [];
    }

    const processor = new DrainProcessor(infcx, [], stalled_coroutines);
    const outcome: Outcome<PendingPredicateObligation, never> = this.predicates.process_obligations(processor);
    assert(outcome.errors.length === 0, "assertion failed: outcome.errors.is_empty()");
    return processor.removed_predicates;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:273 has_pending_obligations
  has_pending_obligations(): boolean {
    return this.predicates.has_pending_obligations();
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:277 pending_obligations
  pending_obligations(): PredicateObligations {
    return this.predicates.map_pending_obligations((o) => clone_Obligation(o.obligation, (p) => p));
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
  pending_obligations_potentially_referencing_sub_root(infcx: InferCtxt, sub_root: TyVid): PredicateObligations {
    return TraitEngine_provided.pending_obligations_potentially_referencing_sub_root(this, infcx, sub_root);
  }
  pending_obligations_potentially_referencing_float_infer(infcx: InferCtxt): PredicateObligations {
    return TraitEngine_provided.pending_obligations_potentially_referencing_float_infer(this, infcx);
  }
}

// ---- fn drain_stalled_obligations_for_coroutines: local items (fulfill.rs:202..270) --------------------------------------

class DrainProcessor implements ObligationProcessor<PendingPredicateObligation, never, Outcome<PendingPredicateObligation, never>> {
  constructor(
    public infcx: InferCtxt,
    public removed_predicates: PredicateObligations,
    public stalled_coroutines: List<LocalDefId>,
  ) {}

  OUT_new(): Outcome<PendingPredicateObligation, never> {
    return Outcome.new();
  }

  skippable_obligations(it: Iterable<PendingPredicateObligation>): number {
    return ObligationProcessor_provided.skippable_obligations(it);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:213 needs_process_obligation
  needs_process_obligation(pending_obligation: PendingPredicateObligation): boolean {
    return ControlFlow_is_break(
      fold_Predicate.visit_with(
        this.infcx.deeply_resolve_ignoring_regions(pending_obligation.obligation.predicate, fold_Predicate),
        new StalledOnCoroutines(this.stalled_coroutines, DelayedSet.default_<Ty>()),
      ),
    );
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:250 process_obligation
  process_obligation(pending_obligation: PendingPredicateObligation): ProcessResult<PendingPredicateObligation, never> {
    assert(this.needs_process_obligation(pending_obligation), "assertion failed: self.needs_process_obligation(pending_obligation)");
    this.removed_predicates.push(clone_Obligation(pending_obligation.obligation, (p) => p));
    return { $: "Changed", _0: [] };
  }

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:259 process_backedge
  process_backedge(cycle: Iterable<PendingPredicateObligation>): Result<null, never> {
    for (const c of cycle) this.removed_predicates.push(clone_Obligation(c.obligation, (p) => p));
    return Ok(null);
  }
}

class StalledOnCoroutines implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    public stalled_coroutines: List<LocalDefId>,
    public cache: DelayedSet<Ty>,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:222 visit_ty
  visit_ty(ty: Ty): ControlFlow<null> {
    if (!this.cache.insert(ty)) {
      return ControlFlow.CONTINUE;
    }

    const k = ty.kind();
    let stalled = false;
    if (k.$ === "Coroutine") {
      const def_id = k._0.as_local();
      stalled = def_id !== undefined && this.stalled_coroutines.includes(def_id);
    }
    if (stalled) {
      return ControlFlow.Break(null);
    } else if (TypeVisitableExt.has_coroutines(ty, fold_Ty)) {
      return fold_Ty.super_visit_with(ty, this);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // (provided) TypeVisitor methods this impl does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: import("../../rustc_span/lib.ts").ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `ControlFlow::is_break`. */
function ControlFlow_is_break<B, C>(cf: ControlFlow<B, C>): boolean {
  return cf.$ === "Break";
}

// ---- FulfillProcessor (fulfill.rs:282; generated class) -------------------------------------------------------------

declare module "./fulfill.gen.ts" {
  interface FulfillProcessor extends ObligationProcessor<PendingPredicateObligation, FulfillmentErrorCode, Outcome<PendingPredicateObligation, FulfillmentErrorCode>> {
    process_trait_obligation(obligation: PredicateObligation, trait_obligation: PolyTraitObligation, stalled_on: TyOrConstInferVar[]): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode>;
    process_projection_obligation(
      obligation: PredicateObligation,
      project_obligation: PolyProjectionObligation,
      stalled_on: TyOrConstInferVar[],
    ): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode>;
    process_host_obligation(
      obligation: PredicateObligation,
      host_obligation: HostEffectObligation,
      stalled_on: TyOrConstInferVar[],
    ): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode>;
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:286 mk_pending
function mk_pending(parent: PredicateObligation, os: PredicateObligations): PendingPredicateObligations {
  return os.map((o) => {
    o.set_depth_from_parent(parent.recursion_depth);
    return { obligation: o, stalled_on: [] };
  });
}

// ---- impl<'a, 'tcx> ObligationProcessor for FulfillProcessor<'a, 'tcx> (fulfill.rs:298) ---------------------------------

FulfillProcessor.prototype.OUT_new = function (this: FulfillProcessor): Outcome<PendingPredicateObligation, FulfillmentErrorCode> {
  return Outcome.new();
};

/// Compared to `needs_process_obligation` this and its callees
/// contain some optimizations that come at the price of false negatives.
///
/// They
/// - reduce branching by covering only the most common case
/// - take a read-only view of the unification tables which allows skipping undo_log
///   construction.
/// - bail out on value-cache misses in ena to avoid pointer chasing
/// - hoist RefCell locking out of the loop
// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:313 skippable_obligations
FulfillProcessor.prototype.skippable_obligations = function (this: FulfillProcessor, it: Iterable<PendingPredicateObligation>): number {
  const is_unchanged = this.selcx.infcx.is_ty_infer_var_definitely_unchanged();

  let count = 0;
  for (const o of it) {
    const unchanged = o.stalled_on.length === 1 ? is_unchanged(o.stalled_on[0]!) : false;
    if (!unchanged) break;
    count++;
  }
  return count;
};

/// Identifies whether a predicate obligation needs processing.
///
/// This is always inlined because it has a single callsite and it is
/// called *very* frequently. Be careful modifying this code! Several
/// compile-time benchmarks are very sensitive to even small changes.
// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:332 needs_process_obligation
FulfillProcessor.prototype.needs_process_obligation = function (this: FulfillProcessor, pending_obligation: PendingPredicateObligation): boolean {
  if (this.selcx.infcx.disable_trait_solver_fast_paths()) {
    return true;
  }

  // If we were stalled on some unresolved variables, first check whether
  // any of them have been resolved; if not, don't bother doing more work
  // yet.
  const stalled_on = pending_obligation.stalled_on;
  switch (stalled_on.length) {
    // This case is the hottest most of the time, being hit up to 99%
    // of the time. `keccak` and `cranelift-codegen-0.82.1` are
    // benchmarks that particularly stress this path.
    case 1:
      return this.selcx.infcx.ty_or_const_infer_var_changed(stalled_on[0]!);

    // In this case we haven't changed, but wish to make a change. Note
    // that this is a special case, and is not equivalent to the `_`
    // case below, which would return `false` for an empty `stalled_on`
    // vector.
    //
    // This case is usually hit only 1% of the time or less, though it
    // reaches 20% in `wasmparser-0.101.0`.
    case 0:
      return true;

    // This case is usually hit only 1% of the time or less, though it
    // reaches 95% in `mime-0.3.16`, 64% in `wast-54.0.0`, and 12% in
    // `inflate-0.4.5`.
    //
    // The obvious way of writing this, with a call to `any()` and no
    // closure, is currently slower than this version.
    default:
      return (() => {
        for (const infer_var of stalled_on) {
          if (this.selcx.infcx.ty_or_const_infer_var_changed(infer_var)) {
            return true;
          }
        }
        return false;
      })();
  }
};

/// Processes a predicate obligation and returns either:
/// - `Changed(v)` if the predicate is true, presuming that `v` are also true
/// - `Unchanged` if we don't have enough info to be sure
/// - `Error(e)` if the predicate does not hold
///
/// This is called much less often than `needs_process_obligation`, so we
/// never inline it.
// #[instrument(level = "debug", skip(self, pending_obligation))]
// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:382 process_obligation
FulfillProcessor.prototype.process_obligation = function (
  this: FulfillProcessor,
  pending_obligation: PendingPredicateObligation,
): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode> {
  pending_obligation.stalled_on.length = 0;

  {
    const obligation = pending_obligation.obligation;

    // debug!(?obligation, "pre-resolve");

    if (TypeVisitableExt.has_non_region_infer(obligation.predicate, fold_Predicate)) {
      obligation.predicate = this.selcx.infcx.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);
    }
  }

  const obligation = pending_obligation.obligation;

  const infcx = this.selcx.infcx;

  const traits = traits_mod();
  if (!infcx.disable_trait_solver_fast_paths() && traits.sizedness_fast_path(infcx.tcx, obligation.predicate, obligation.param_env)) {
    return { $: "Changed", _0: [] };
  }

  if (TypeVisitableExt.has_aliases(obligation.predicate, fold_Predicate)) {
    const obligations: PredicateObligations = [];
    const predicate = traits.normalize.normalize_with_depth_to(
      this.selcx,
      obligation.param_env,
      obligation.cause,
      obligation.recursion_depth + 1,
      Unnormalized.new_wip(obligation.predicate),
      obligations,
      fold_Predicate,
    );
    if (predicate !== obligation.predicate) {
      obligations.push(obligation.with(infcx.tcx, predicate, (p) => p));
      return { $: "Changed", _0: mk_pending(obligation, obligations) };
    }
  }
  const binder = obligation.predicate.kind();
  const pred = Binder.no_bound_vars(binder, fold_PredicateKind);
  if (pred === undefined) {
    const k = Binder.skip_binder(binder);
    switch (k.$) {
      case "Clause":
        switch (k._0.$) {
          // Evaluation will discard candidates using the leak check.
          // This means we need to pass it the bound version of our
          // predicate.
          case "Trait": {
            const trait_ref = k._0._0;
            const trait_obligation = obligation.with(infcx.tcx, Binder.rebind(binder, trait_ref), (p: PolyTraitClause) => p);

            return this.process_trait_obligation(obligation, trait_obligation, pending_obligation.stalled_on);
          }
          case "Projection": {
            const data = k._0._0;
            const project_obligation = obligation.with(infcx.tcx, Binder.rebind(binder, data), (p) => p);

            return this.process_projection_obligation(obligation, project_obligation, pending_obligation.stalled_on);
          }
          case "RegionOutlives":
          case "TypeOutlives":
          case "ConstArgHasType":
          case "WellFormed":
          case "ConstEvaluatable":
          // FIXME(const_trait_impl): We may need to do this using the higher-ranked
          // pred instead of just instantiating it with placeholders b/c of
          // higher-ranked implied bound issues in the old solver.
          case "HostEffect": {
            const pred = Binder.dummy(infcx.enter_forall_and_leak_universe(binder, fold_PredicateKind), fold_PredicateKind);
            const obligations: PredicateObligations = [];
            obligations.push(obligation.with(infcx.tcx, pred, upcast_Binder_PredicateKind));

            return { $: "Changed", _0: mk_pending(obligation, obligations) };
          }
          case "UnstableFeature":
            return unreachable("internal error: entered unreachable code: unexpected higher ranked `UnstableFeature` goal");
        }
        break;
      case "DynCompatible":
      case "Subtype":
      case "Coerce":
      case "ConstEquate": {
        const pred = Binder.dummy(infcx.enter_forall_and_leak_universe(binder, fold_PredicateKind), fold_PredicateKind);
        const obligations: PredicateObligations = [];
        obligations.push(obligation.with(infcx.tcx, pred, upcast_Binder_PredicateKind));

        return { $: "Changed", _0: mk_pending(obligation, obligations) };
      }
      case "Ambiguous":
        return ProcessResultC.Unchanged;
      case "NormalizesTo":
        return panic("NormalizesTo is only used by the new solver");
    }
    return unreachable();
  } else {
    if (pred.$ === "Clause") {
      const c = pred._0;
      switch (c.$) {
        case "Trait": {
          const data = c._0;
          const trait_obligation = obligation.with(infcx.tcx, Binder.dummy(data, d_TraitClause()), (p: PolyTraitClause) => p);

          return this.process_trait_obligation(obligation, trait_obligation, pending_obligation.stalled_on);
        }

        case "HostEffect": {
          const data = c._0;
          const host_obligation = obligation.with(infcx.tcx, data, (p) => p);

          return this.process_host_obligation(obligation, host_obligation, pending_obligation.stalled_on);
        }

        case "RegionOutlives": {
          const data = c._0;
          if (infcx.considering_regions) {
            infcx.register_region_outlives_constraint(data, "Yes", obligation.cause);
          }

          return { $: "Changed", _0: [] };
        }

        case "TypeOutlives": {
          const { _0: t_a, _1: r_b } = c._0;
          if (infcx.considering_regions) {
            infcx.register_type_outlives_constraint(t_a, r_b, obligation.cause);
          }
          return { $: "Changed", _0: [] };
        }

        case "Projection": {
          const data = c._0;
          const project_obligation = obligation.with(infcx.tcx, Binder.dummy(data, d_ProjectionClause()), (p) => p);

          return this.process_projection_obligation(obligation, project_obligation, pending_obligation.stalled_on);
        }

        default:
          break;
      }
    } else if (pred.$ === "DynCompatible") {
      const trait_def_id = pred._0;
      if (!this.selcx.tcx().is_dyn_compatible(trait_def_id)) {
        return { $: "Error", _0: { $: "Select", _0: { $: "Unimplemented" } } };
      } else {
        return { $: "Changed", _0: [] };
      }
    } else if (pred.$ === "Ambiguous") {
      return ProcessResultC.Unchanged;
    } else if (pred.$ === "NormalizesTo") {
      return panic("NormalizesTo is only used by the new solver");
    }

    // Compute `ConstArgHasType` above the overflow check below.
    // This is because this is not ever a useful obligation to report
    // as the cause of an overflow.
    if (pred.$ === "Clause" && pred._0.$ === "ConstArgHasType") {
      let ct = pred._0._0;
      const ty = pred._0._1;
      ct = infcx.shallow_resolve_const(ct);
      let ct_ty: Ty;
      const ck = ct.kind();
      switch (ck.$) {
        case "Infer": {
          const var_ = ck._0;
          let var__: TyOrConstInferVar;
          switch (var_.$) {
            case "Var":
              var__ = { $: "Const", _0: var_._0 };
              break;
            case "Fresh":
              return panic("encountered fresh const in fulfill");
          }
          pending_obligation.stalled_on.length = 0;
          pending_obligation.stalled_on.push(var__);
          return ProcessResultC.Unchanged;
        }
        case "Error":
          return { $: "Changed", _0: [] };
        case "Value":
          ct_ty = ck._0.ty;
          break;
        case "Alias":
          ct_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(ck._1, infcx.tcx));
          break;
        // FIXME(generic_const_exprs): we should construct an alias like
        // `<lhs_ty as Add<rhs_ty>>::Output` when this is an `Expr` representing
        // `lhs + rhs`.
        case "Expr":
          return { $: "Changed", _0: mk_pending(obligation, []) };
        case "Placeholder":
          return panic(`placeholder const ${debug_Const_plain(ct)} in old solver`);
        case "Bound":
          return panic(`escaping bound vars in ${debug_Const_plain(ct)}`);
        case "Param":
          ct_ty = ParamConst.find_const_ty_from_env(ck._0, obligation.param_env);
          break;
      }

      const r = infcx
        .at(obligation.cause, obligation.param_env)
        .eq(
          // Only really exercised by generic_const_exprs
          DefineOpaqueTypes.Yes,
          ct_ty,
          ty,
          ToTrace_Ty,
        );
      if (r.$ === "Ok") {
        return { $: "Changed", _0: mk_pending(obligation, r._0.into_obligations()) };
      } else {
        return { $: "Error", _0: { $: "Select", _0: { $: "ConstArgHasWrongType", ct, ct_ty, expected_ty: ty } } };
      }
    }

    // General case overflow check. Allow `process_trait_obligation`
    // and `process_projection_obligation` to handle checking for
    // the recursion limit themselves. Also don't check some
    // predicate kinds that don't give further obligations.
    if (!this.selcx.tcx().recursion_limit().value_within_limit(obligation.recursion_depth)) {
      return this.selcx.infcx.err_ctxt().report_overflow_obligation(obligation, false, upcast_from_self);
    }

    if (pred.$ === "Clause") {
      const c = pred._0;
      switch (c.$) {
        case "WellFormed": {
          const term = c._0;
          if (Term.is_trivially_wf(term, this.selcx.tcx())) {
            return { $: "Changed", _0: [] };
          }

          const os = traits.wf.obligations(
            this.selcx.infcx,
            obligation.param_env,
            obligation.cause.body_def_id,
            obligation.recursion_depth + 1,
            term,
            obligation.cause.span,
          );
          if (os === undefined) {
            pending_obligation.stalled_on = [TyOrConstInferVar.maybe_from_term(term)!];
            return ProcessResultC.Unchanged;
          } else {
            return { $: "Changed", _0: mk_pending(obligation, os) };
          }
        }

        case "ConstEvaluatable": {
          const alias_const = c._0;
          const r = traits.const_evaluatable.is_const_evaluatable(this.selcx.infcx, alias_const, obligation.param_env, obligation.cause.span);
          if (r.$ === "Ok") {
            return { $: "Changed", _0: [] };
          }
          const e = r._0;
          if (e.$ === "MentionsInfer") {
            pending_obligation.stalled_on.length = 0;
            for (const arg of alias_const.walk()) {
              const v = TyOrConstInferVar.maybe_from_generic_arg(arg);
              if (v !== undefined) pending_obligation.stalled_on.push(v);
            }
            return ProcessResultC.Unchanged;
          } else {
            // e @ NotConstEvaluatable::MentionsParam | e @ NotConstEvaluatable::Error(_)
            return { $: "Error", _0: { $: "Select", _0: { $: "NotConstEvaluatable", _0: e } } };
          }
        }

        case "UnstableFeature": {
          const symbol = c._0;
          if (may_use_unstable_feature(this.selcx.infcx, obligation.param_env, symbol)) {
            return { $: "Changed", _0: [] };
          } else {
            return ProcessResultC.Unchanged;
          }
        }

        default:
          // Trait / HostEffect / RegionOutlives / TypeOutlives / Projection / ConstArgHasType: handled above.
          return unreachable();
      }
    }

    switch (pred.$) {
      case "Subtype": {
        const subtype = pred._0;
        const r = this.selcx.infcx.subtype_predicate(obligation.cause, obligation.param_env, Binder.dummy(subtype, d_SubtypePredicate()));
        if (r.$ === "Err") {
          const [a, b] = r._0;
          // None means that both are unresolved.
          pending_obligation.stalled_on = [
            { $: "Ty", _0: a },
            { $: "Ty", _0: b },
          ];
          return ProcessResultC.Unchanged;
        }
        const inner = r._0;
        if (inner.$ === "Ok") {
          const ok = inner._0;
          return { $: "Changed", _0: mk_pending(obligation, ok.obligations) };
        } else {
          const err = inner._0;
          const expected_found = subtype.a_is_expected ? ExpectedFound.new(subtype.a, subtype.b) : ExpectedFound.new(subtype.b, subtype.a);
          return { $: "Error", _0: { $: "Subtype", _0: expected_found, _1: err } };
        }
      }

      case "Coerce": {
        const coerce = pred._0;
        const r = this.selcx.infcx.coerce_predicate(obligation.cause, obligation.param_env, Binder.dummy(coerce, d_CoercePredicate()));
        if (r.$ === "Err") {
          const [a, b] = r._0;
          // None means that both are unresolved.
          pending_obligation.stalled_on = [
            { $: "Ty", _0: a },
            { $: "Ty", _0: b },
          ];
          return ProcessResultC.Unchanged;
        }
        const inner = r._0;
        if (inner.$ === "Ok") {
          const ok = inner._0;
          return { $: "Changed", _0: mk_pending(obligation, ok.obligations) };
        } else {
          const err = inner._0;
          const expected_found = ExpectedFound.new(coerce.b, coerce.a);
          return { $: "Error", _0: { $: "Subtype", _0: expected_found, _1: err } };
        }
      }

      case "ConstEquate": {
        const c1 = pred._0;
        const c2 = pred._1;
        const tcx = this.selcx.tcx();
        assert(tcx.features().generic_const_exprs(), `\`ConstEquate\` without a feature gate: ${debug_Const_plain(c1)} ${debug_Const_plain(c2)}`);
        // FIXME: we probably should only try to unify abstract constants
        // if the constants depend on generic parameters.
        //
        // Let's just see where this breaks :shrug:
        {
          const c1_ = tcx.expand_abstract_consts(c1, fold_Const);
          const c2_ = tcx.expand_abstract_consts(c2, fold_Const);
          // debug!("equating consts:\nc1= {:?}\nc2= {:?}", c1, c2);

          const k1 = c1_.kind();
          const k2 = c2_.kind();
          if (
            k1.$ === "Alias" &&
            k2.$ === "Alias" &&
            intern_key(k1._1.kind) === intern_key(k2._1.kind) &&
            (k1._1.kind.$ === "Projection" || k1._1.kind.$ === "InherentSelf" || k1._1.kind.$ === "InherentImpl")
          ) {
            const a = k1._1;
            const b = k2._1;
            const new_obligations = infcx
              .at(obligation.cause, obligation.param_env)
              // Can define opaque types as this is only reachable with
              // `generic_const_exprs`
              .eq(DefineOpaqueTypes.Yes, AliasTermC.from_AliasConst(a), AliasTermC.from_AliasConst(b), ToTrace_AliasTerm);
            if (new_obligations.$ === "Ok") {
              return { $: "Changed", _0: mk_pending(obligation, new_obligations._0.into_obligations()) };
            }
          } else if (k2.$ === "Alias" || k1.$ === "Alias") {
            // ()
          } else {
            const new_obligations = infcx
              .at(obligation.cause, obligation.param_env)
              // Can define opaque types as this is only reachable with
              // `generic_const_exprs`
              .eq(DefineOpaqueTypes.Yes, c1_, c2_, ToTrace_Const);
            if (new_obligations.$ === "Ok") {
              return { $: "Changed", _0: mk_pending(obligation, new_obligations._0.into_obligations()) };
            }
          }
        }

        const stalled_on = pending_obligation.stalled_on;

        const evaluate = (c: Const): Result<Const, import("./mod.gen.ts").EvaluateConstErr<never>> => {
          const ck = c.kind();
          if (ck.$ === "Alias") {
            const alias_const = ck._1;
            const e = traits.try_evaluate_const<never>(this.selcx.infcx, c, obligation.param_env, (ty) => Ok(Unnormalized.skip_norm_wip(ty)));
            if (e.$ === "Ok") {
              return Ok(e._0);
            } else if (e._0.$ === "HasGenericsOrInfers") {
              for (const arg of alias_const.args) {
                const v = TyOrConstInferVar.maybe_from_generic_arg(arg);
                if (v !== undefined) stalled_on.push(v);
              }
              return e;
            } else {
              // e @ Err(EvaluateConstErr::EvaluationFailure(_) | EvaluateConstErr::InvalidConstParamTy(_))
              return e;
            }
          } else {
            return Ok(c);
          }
        };

        const r1 = evaluate(c1);
        const r2 = evaluate(c2);
        if (r1.$ === "Ok" && r2.$ === "Ok") {
          const c1 = r1._0;
          const c2 = r2._0;
          const r = this.selcx.infcx
            .at(obligation.cause, obligation.param_env)
            .eq(
              // Can define opaque types as this is only reachable with
              // `generic_const_exprs`
              DefineOpaqueTypes.Yes,
              c1,
              c2,
              ToTrace_Const,
            );
          if (r.$ === "Ok") {
            return { $: "Changed", _0: mk_pending(obligation, r._0.into_obligations()) };
          } else {
            return { $: "Error", _0: { $: "ConstEquate", _0: ExpectedFound.new(c1, c2), _1: r._0 } };
          }
        }
        const e1 = r1.$ === "Err" ? r1._0 : undefined;
        const e2 = r2.$ === "Err" ? r2._0 : undefined;
        if (e1?.$ === "InvalidConstParamTy" || e2?.$ === "InvalidConstParamTy") {
          const e = (e1?.$ === "InvalidConstParamTy" ? e1 : e2) as { $: "InvalidConstParamTy"; _0: import("../../rustc_span/lib.ts").ErrorGuaranteed };
          return { $: "Error", _0: { $: "Select", _0: { $: "NotConstEvaluatable", _0: { $: "Error", _0: e._0 } } } };
        }
        if (e1?.$ === "EvaluationFailure" || e2?.$ === "EvaluationFailure") {
          const e = (e1?.$ === "EvaluationFailure" ? e1 : e2) as { $: "EvaluationFailure"; _0: import("../../rustc_span/lib.ts").ErrorGuaranteed };
          return { $: "Error", _0: { $: "Select", _0: { $: "NotConstEvaluatable", _0: { $: "Error", _0: e._0 } } } };
        }
        // (Err(EvaluateConstErr::HasGenericsOrInfers), _) | (_, Err(EvaluateConstErr::HasGenericsOrInfers))
        if (TypeVisitableExt.has_non_region_infer(c1, fold_Const) || TypeVisitableExt.has_non_region_infer(c2, fold_Const)) {
          return ProcessResultC.Unchanged;
        } else {
          // Two different constants using generic parameters ~> error.
          const expected_found = ExpectedFound.new(c1, c2);
          return { $: "Error", _0: { $: "ConstEquate", _0: expected_found, _1: { $: "ConstMismatch", _0: expected_found } } };
        }
      }

      default:
        return unreachable();
    }
  }
};

// #[inline(never)]
// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:851 process_backedge
FulfillProcessor.prototype.process_backedge = function (this: FulfillProcessor, cycle_: Iterable<PendingPredicateObligation>): Result<null, FulfillmentErrorCode> {
  // PORT: `cycle.clone()`: the iterator is walked twice, so it is collected first.
  const cycle = [...cycle_];
  if (this.selcx.coinductive_match(cycle.map((s) => s.obligation.predicate))) {
    // debug!("process_child_obligations: coinductive match");
    return Ok(null);
  } else {
    const cycle_obligations = cycle.map((c) => clone_Obligation(c.obligation, (p) => p));
    return Err({ $: "Cycle", _0: cycle_obligations });
  }
};

// ---- impl<'a, 'tcx> FulfillProcessor<'a, 'tcx> (fulfill.rs:869) -----------------------------------------------------

// #[instrument(level = "debug", skip(self, obligation, stalled_on))]
// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:871 process_trait_obligation
FulfillProcessor.prototype.process_trait_obligation = function (
  this: FulfillProcessor,
  obligation: PredicateObligation,
  trait_obligation: PolyTraitObligation,
  stalled_on: TyOrConstInferVar[],
): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode> {
  // debug_assert!(!self.selcx.typing_mode().is_coherence(), "old solver coherence");
  const infcx = this.selcx.infcx;
  if (TypeVisitableExt.is_global(obligation.predicate, fold_Predicate)) {
    // no type variables present, can use evaluation for better caching.
    // FIXME: consider caching errors too.
    if (infcx.predicate_must_hold_considering_regions(obligation)) {
      // debug!("selecting trait at depth {} evaluated to holds", obligation.recursion_depth);
      return { $: "Changed", _0: [] };
    }
  }

  const r = this.selcx.poly_select(trait_obligation);
  if (r.$ === "Ok") {
    const impl_source = r._0;
    if (impl_source !== undefined) {
      // debug!("selecting trait at depth {} yielded Ok(Some)", obligation.recursion_depth);
      return { $: "Changed", _0: mk_pending(obligation, ImplSource.nested_obligations(impl_source)) };
    } else {
      // debug!("selecting trait at depth {} yielded Ok(None)", obligation.recursion_depth);

      // This is a bit subtle: for the most part, the
      // only reason we can fail to make progress on
      // trait selection is because we don't have enough
      // information about the types in the trait.
      stalled_on.length = 0;
      stalled_on.push(...args_infer_vars(this.selcx, Binder.map_bound(trait_obligation.predicate, (pred) => pred.trait_ref.args)));

      // debug!("process_predicate: pending obligation {:?} now stalled on {:?}", infcx.deeply_resolve_ignoring_regions(obligation.clone()), stalled_on);

      return ProcessResultC.Unchanged;
    }
  } else {
    const selection_err = r._0;
    // debug!("selecting trait at depth {} yielded Err", obligation.recursion_depth);

    return { $: "Error", _0: { $: "Select", _0: selection_err } };
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:925 process_projection_obligation
FulfillProcessor.prototype.process_projection_obligation = function (
  this: FulfillProcessor,
  obligation: PredicateObligation,
  project_obligation: PolyProjectionObligation,
  stalled_on: TyOrConstInferVar[],
): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode> {
  // debug_assert!(!self.selcx.typing_mode().is_coherence(), "old solver coherence");

  const tcx = this.selcx.tcx();
  const infcx = this.selcx.infcx;
  const project = require("./project.ts") as typeof import("./project.ts");
  if (TypeVisitableExt.is_global(obligation.predicate, fold_Predicate)) {
    // no type variables present, can use evaluation for better caching.
    // FIXME: consider caching errors too.
    if (infcx.predicate_must_hold_considering_regions(obligation)) {
      const key = project.ProjectionCacheKey_from_poly_projection_obligation(this.selcx, project_obligation);
      if (key !== undefined) {
        // If `predicate_must_hold_considering_regions` succeeds, then we've
        // evaluated all sub-obligations. We can therefore mark the 'root'
        // obligation as complete, and skip evaluating sub-obligations.
        infcx.inner.projection_cache().complete(key, "EvaluatedToOk");
      }
      return { $: "Changed", _0: [] };
    } else {
      // debug!("Does NOT hold: {:?}", obligation);
    }
  }

  const r = project.poly_project_and_unify_term(this.selcx, project_obligation);
  switch (r.$) {
    case "Holds": {
      const os = r._0;
      if (os.length === 0) {
        return { $: "Changed", _0: mk_pending(obligation, os) };
      }
      const input_projection_term = Binder.map_bound(
        infcx.deeply_resolve_ignoring_regions(project_obligation.predicate, d_PolyProjectionClause()),
        (p) => p.projection_term,
      );
      const all_same_projection_term = os.every((o) => {
        const proj_clause = o.predicate.as_projection_clause();
        if (proj_clause === undefined) {
          return false;
        }
        // PORT: `Binder<AliasTerm>` `==` is the derived `PartialEq` (module comment).
        return (
          intern_key(Binder.map_bound(infcx.deeply_resolve_ignoring_regions(proj_clause, d_PolyProjectionClause()), (p) => p.projection_term)) ===
          intern_key(input_projection_term)
        );
      });
      if (all_same_projection_term) {
        // Every nested obligation has the same projection term as the obligation
        // we are processing, so registering would make fulfillment process the same
        // obligation forever. This happens when unifying the projection with the
        // predicate's term spawns a delayed copy of the predicate itself, see
        // `InferCtxt::instantiate_var`. E.g. in Issue #159750, processing
        // `<_ as Queryable>::Output == ?0` returns `Holds` with the single nested
        // obligation `<_ as Queryable>::Output == ?1` where `?1` is merely unioned
        // with `?0`.
        // Since at this point the code will not compile, error immediately.
        return { $: "Error", _0: { $: "Ambiguity", overflow: undefined } };
      } else {
        return { $: "Changed", _0: mk_pending(obligation, os) };
      }
    }
    case "FailedNormalization":
      stalled_on.length = 0;
      stalled_on.push(...args_infer_vars(this.selcx, Binder.map_bound(project_obligation.predicate, (pred) => pred.projection_term.args)));
      return ProcessResultC.Unchanged;
    // Let the caller handle the recursion
    case "Recursive": {
      const obligations: PredicateObligations = [];
      obligations.push(project_obligation.with(tcx, project_obligation.predicate, Predicate_upcast_from_PolyProjectionClause()));

      return { $: "Changed", _0: mk_pending(obligation, obligations) };
    }
    case "MismatchedProjectionTypes": {
      const e = r._0;
      return { $: "Error", _0: { $: "Project", _0: e } };
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:1011 process_host_obligation
FulfillProcessor.prototype.process_host_obligation = function (
  this: FulfillProcessor,
  obligation: PredicateObligation,
  host_obligation: HostEffectObligation,
  stalled_on: TyOrConstInferVar[],
): ProcessResult<PendingPredicateObligation, FulfillmentErrorCode> {
  const effects = require("./effects.ts") as typeof import("./effects.ts");
  const r = effects.evaluate_host_effect_obligation(this.selcx, host_obligation);
  if (r.$ === "Ok") {
    const nested = r._0;
    return { $: "Changed", _0: mk_pending(obligation, nested) };
  }
  switch (r._0) {
    case "Ambiguous":
      stalled_on.length = 0;
      stalled_on.push(...args_infer_vars(this.selcx, Binder.dummy(host_obligation.predicate.trait_ref.args, fold_GenericArgs)));
      return ProcessResultC.Unchanged;
    case "NoSolution":
      return { $: "Error", _0: { $: "Select", _0: { $: "Unimplemented" } } };
  }
};

/// Returns the set of inference variables contained in `args`.
// rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:1035 args_infer_vars
function args_infer_vars(selcx: SelectionContext, args: Binder<GenericArgs>): TyOrConstInferVar[] {
  const out: TyOrConstInferVar[] = [];
  const resolved = Binder.skip_binder(selcx.infcx.deeply_resolve_ignoring_regions(args, fold_Binder(fold_GenericArgs))); // ok because this check doesn't care about regions
  for (const arg of resolved) {
    if (!TypeVisitableExt.has_non_region_infer(arg, GenericArg_visitable)) continue;
    const walker = GenericArg.walk(arg);
    for (let c = walker.next(); c !== undefined; c = walker.next()) {
      if (!TypeVisitableExt.has_non_region_infer(c, GenericArg_visitable)) {
        walker.visited.delete(c);
        walker.skip_current_subtree();
      }
    }
    for (const c of walker.visited) {
      const v = TyOrConstInferVar.maybe_from_generic_arg(c);
      if (v !== undefined) out.push(v);
    }
  }
  return out;
}

// rustc-type: compiler/rustc_trait_selection/src/traits/fulfill.rs:1059 OldSolverError
export class OldSolverError {
  constructor(public _0: Error<PendingPredicateObligation, FulfillmentErrorCode>) {}
}

// ---- impl<'tcx> FromSolverError<'tcx, OldSolverError<'tcx>> for FulfillmentError<'tcx> (fulfill.rs:1063) ---------------

export const FromSolverError_FulfillmentError: FromSolverError<FulfillmentError, OldSolverError> = {
  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:1064 from_solver_error
  from_solver_error(_infcx: InferCtxt, error: OldSolverError): FulfillmentError {
    const backtrace = error._0.backtrace;
    const obligation = backtrace[0]!.obligation;
    // The root obligation is the last item in the backtrace - if there's only
    // one item, then it's the same as the main obligation
    const root_obligation = backtrace.length > 1 ? backtrace[backtrace.length - 1]!.obligation : clone_Obligation(obligation, (p) => p);
    return traits_mod().FulfillmentError.new(obligation, error._0.error, root_obligation);
  },
};

// ---- impl<'tcx> FromSolverError<'tcx, OldSolverError<'tcx>> for ScrubbedTraitError<'tcx> (fulfill.rs:1074) -------------

export const FromSolverError_ScrubbedTraitError: FromSolverError<ScrubbedTraitError, OldSolverError> = {
  // rustc: compiler/rustc_trait_selection/src/traits/fulfill.rs:1075 from_solver_error
  from_solver_error(_infcx: InferCtxt, error: OldSolverError): ScrubbedTraitError {
    const code = error._0.error;
    switch (code.$) {
      case "Select":
      case "Project":
      case "Outlives":
      case "Subtype":
      case "ConstEquate":
        return ScrubbedTraitError.TrueError;
      case "Ambiguity":
        return ScrubbedTraitError.Ambiguity;
      case "Cycle":
        return { $: "Cycle", _0: code._0 };
    }
  },
};

// ---- PORT: D4 descriptors of the types this file folds / visits (read lazily: init order) ---------------------------

function d_TraitClause(): TypeVisitable<import("../../rustc_type_ir/predicate.ts").TraitClause> {
  const m = require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
  return { visit_with: m.visit_with_TraitClause };
}
function d_ProjectionClause(): TypeVisitable<import("../../rustc_type_ir/predicate.ts").ProjectionClause> {
  const m = require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
  return { visit_with: m.visit_with_ProjectionClause };
}
function d_SubtypePredicate(): TypeVisitable<import("../../rustc_type_ir/predicate.ts").SubtypePredicate> {
  const m = require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
  return { visit_with: m.visit_with_SubtypePredicate };
}
function d_CoercePredicate(): TypeVisitable<import("../../rustc_type_ir/predicate.ts").CoercePredicate> {
  const m = require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
  return { visit_with: m.visit_with_CoercePredicate };
}
function d_PolyProjectionClause(): import("../../rustc_type_ir/fold.ts").TypeFoldable<import("../../rustc_middle/ty/predicate.ts").PolyProjectionClause> {
  const m = require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
  return fold_Binder({ visit_with: m.visit_with_ProjectionClause, try_fold_with: m.try_fold_with_ProjectionClause, fold_with: m.fold_with_ProjectionClause });
}
function Predicate_upcast_from_PolyProjectionClause(): (from: import("../../rustc_middle/ty/predicate.ts").PolyProjectionClause, tcx: import("../../rustc_type_ir/interner.ts").Interner) => Predicate {
  const m = require("../../rustc_middle/ty/predicate.ts") as typeof import("../../rustc_middle/ty/predicate.ts");
  return m.Predicate_upcast_from_PolyProjectionClause as never;
}
/** `GenericArg: TypeVisitable` (rustc_middle generic_args.ts). */
const GenericArg_visitable: TypeVisitable<import("../../rustc_middle/ty/generic_args.ts").GenericArg> = fold_GenericArg;
/** `impl UpcastFrom<TyCtxt, Binder<PredicateKind>> for Predicate` at `Obligation::with`'s `Interner` type. */
const upcast_Binder_PredicateKind = Predicate_upcast_from_Binder_PredicateKind as unknown as (
  from: Binder<PredicateKind>,
  tcx: import("../../rustc_type_ir/interner.ts").Interner,
) => Predicate;
/** `{:?}` of a `Const` with plain flags (panic messages). */
function debug_Const_plain(ct: Const): string {
  const m = require("../../rustc_type_ir/sty/consts.ts") as typeof import("../../rustc_type_ir/sty/consts.ts");
  return m.debug_Const(ct, { alternate: false });
}

/** PORT: names used in type positions only. */
export type FulfillTypes = [ObligationCause, PendingPredicateObligations, typeof Predicate_upcast_from_PolyHostEffectClause, typeof span_bug, typeof Const];
