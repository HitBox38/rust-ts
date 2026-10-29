// Port of compiler/rustc_trait_selection/src/solve/delegate.rs (lane trait-sel-solve): the `SolverDelegate` impl for
// rustc's `InferCtxt`, the bridge from the generic next solver (rustc_next_trait_solver) to the real `InferCtxt`.
//
// PORT: `#[repr(transparent)] struct SolverDelegate<'tcx>(InferCtxt<'tcx>)` is a class with the field `_0`. It implements
// rustc_next_trait_solver's `SolverDelegate` interface (delegate.ts there): `Deref<Target = InferCtxt>` is `deref()`,
// the associated fns (`build_with_canonical`, the `OpaqueTypeStorageEntries` default) are the static table
// `SolverDelegate_static_impl`, reached through `Self`. `impl From<&InferCtxt> for &SolverDelegate` (a transmute) is
// `SolverDelegate.from(infcx)`: a fresh wrapper over the same `InferCtxt` (the wrapper has no state of its own).
// PORT: an auto-deref `self.tcx` / `self.shallow_resolve(..)` is `this._0.tcx` / `this._0.shallow_resolve(..)`.
// `ObligationCause` is rustc_middle's (`crate::traits::ObligationCause` re-exports it).

import { ControlFlow, type ControlFlow as ControlFlowT, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { DiagDecorator, type Diag } from "../../rustc_errors/lib.ts";
import type { Namespace } from "../../rustc_hir/def.ts";
import { CRATE_HIR_ID } from "../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { default_OpaqueTypeStorageEntries, type OpaqueTypeStorageEntries } from "../../rustc_infer/infer/opaque_types/table.ts";
import { Canonical_instantiate } from "../../rustc_infer/infer/canonical/instantiate.ts";
import { make_query_region_constraints } from "../../rustc_infer/infer/canonical/query_response.ts";
import { RECURSION_DEPTH_EXCEEDING_LIMIT } from "../../rustc_lint_defs/builtin.gen.ts";
import type { LeafDef } from "../../rustc_middle/traits/specialization_graph.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ParamEnv } from "../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { fold_Term, Term, type Ty } from "../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { utf8_len } from "../../std/str.ts";
import type { Predicate } from "../../rustc_middle/ty/predicate.ts";
import { display_Predicate, FmtPrinter, print_Predicate } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { SolverDelegate as SolverDelegateTrait, SolverDelegate_static } from "../../rustc_next_trait_solver/delegate.ts";
import { type DefId, LOCAL_CRATE, CRATE_DEF_ID } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { Limit, Limit_mul, display_Limit } from "../../rustc_structures/limit.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { type Canonical, type CanonicalQueryInput, type CanonicalVarValues, CanonicalizerState } from "../../rustc_type_ir/canonical.ts";
import type { AliasConst, CanonicalVarKind, TraitRef, TyVid, UniverseIndex } from "../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { type FallibleTypeFolder, fold_tuple2, type TypeFoldable, type TypeFolder } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { PolyTraitClause, type RegionConstraint } from "../../rustc_type_ir/predicate.ts";
import { fold_with_TraitRef, type OutlivesClause, try_fold_with_TraitRef, visit_with_OutlivesClause, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import {
  type Certainty,
  Certainty as CertaintyC,
  ComputeGoalFastPathOutcome,
  FetchEligibleAssocItemResponse,
  type Goal,
  type GoalStalledOn,
  GoalStalledOnOpaques,
  MaybeInfo,
  type NoSolution,
  SucceededInErased,
  TyOrConstInferVar,
  VisibleForLeakCheck,
} from "../../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { fold_Region, type Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { solve } from "../../rustc_next_trait_solver/lib.ts";
import * as rustc_transmute from "../../rustc_transmute/lib.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { panic, unwrap, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { fold_Goal_Predicate, type InspectConfig, type InspectGoal, type ProofTreeVisitor } from "./inspect/analyse.ts";
import { sizedness_fast_path } from "../traits/util.ts";
import { try_evaluate_const } from "../traits/mod.ts";
import { unnormalized_obligations as wf_unnormalized_obligations } from "../traits/wf.ts";
import { assoc_def as specialization_graph_assoc_def } from "../traits/specialize/specialization_graph.ts";

// rustc-type: compiler/rustc_trait_selection/src/solve/delegate.rs:38 SolverDelegate
export class SolverDelegate implements SolverDelegateTrait {
  constructor(public _0: InferCtxt) {}

  /** `<&SolverDelegate<'tcx>>::from(infcx)` (module comment). */
  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:41 from
  static from(infcx: InferCtxt): SolverDelegate {
    // SAFETY: `repr(transparent)`
    return new SolverDelegate(infcx);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:50 deref
  deref(): InferCtxt {
    return this._0;
  }

  /** The impl's associated fns (rustc_next_trait_solver delegate.ts header). */
  get Self(): SolverDelegate_static {
    return SolverDelegate_static_impl;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:56 known_no_opaque_types_in_storage
  known_no_opaque_types_in_storage(): boolean {
    return (
      this._0.inner.opaque_types().deref().is_empty() &&
      // in erased mode, observing that opaques are empty aren't enough to give a result
      // here, so let's try the slow path instead.
      !TypingMode.is_erased_not_coherence(this._0.typing_mode_raw())
    );
  }

  // ---- impl rustc_next_trait_solver::delegate::SolverDelegate for SolverDelegate ----

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:132 cx
  cx(): TyCtxt {
    return this._0.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:150 compute_goal_fast_path
  compute_goal_fast_path(goal: Goal<Predicate>, span: Span): ComputeGoalFastPathOutcome {
    const Outcome = ComputeGoalFastPathOutcome;
    const tcx = this._0.tcx;

    // FIXME(-Zassumptions-on-binders): actually handle fast path
    if (tcx.assumptions_on_binders()) {
      return Outcome.NoFastPath;
    }

    const pred = goal.predicate.kind();
    const kind = Binder.skip_binder(pred);
    if (kind.$ === "Clause" && kind._0.$ === "Trait") {
      const trait_pred = Binder.rebind(pred, kind._0._0);

      const self_ty = this._0.shallow_resolve(Binder.skip_binder(PolyTraitClause.self_ty(trait_pred)));
      let vid: TyVid | undefined;
      if (
        (vid = self_ty.ty_vid()) !== undefined &&
        // We don't do this fast path when opaques are defined since we may
        // eventually use opaques to incompletely guide inference via ty var
        // self types.
        // FIXME: Properly consider opaques here.
        this.known_no_opaque_types_in_storage()
      ) {
        return goal_stalled_on_args_or_nonempty_opaques([{ $: "Ty", _0: vid }]);
      } else if (PolyTraitClause.polarity(trait_pred) === "Positive") {
        const lang = this._0.tcx.as_lang_item(PolyTraitClause.def_id(trait_pred));
        if (lang === "Sized" || lang === "MetaSized") {
          const predicate = this._0.deeply_resolve_ignoring_regions(goal.predicate, fold_Predicate);
          if (sizedness_fast_path(tcx, predicate, goal.param_env)) {
            return Outcome.TriviallyHolds;
          } else {
            return Outcome.NoFastPath;
          }
        } else if (lang === "Copy" || lang === "Clone") {
          const self_ty = this._0.deeply_resolve_ignoring_regions(Binder.skip_binder(PolyTraitClause.self_ty(trait_pred)), fold_Ty);
          // Unlike `Sized` traits, which always prefer the built-in impl,
          // `Copy`/`Clone` may be shadowed by a param-env candidate which
          // could force a lifetime error or guide inference. While that's
          // not generally desirable, it is observable, so for now let's
          // ignore this fast path for types that have regions or infer.
          if (
            !TypeVisitableExt.has_type_flags(self_ty, (TypeFlags.HAS_FREE_REGIONS | TypeFlags.HAS_INFER) as TypeFlags, fold_Ty) &&
            self_ty.is_trivially_pure_clone_copy()
          ) {
            return Outcome.TriviallyHolds;
          } else {
            return Outcome.NoFastPath;
          }
        } else {
          return Outcome.NoFastPath;
        }
      } else {
        return Outcome.NoFastPath;
      }
    } else if (kind.$ === "DynCompatible" && this._0.tcx.is_dyn_compatible(kind._0)) {
      return Outcome.TriviallyHolds;
    } else if (kind.$ === "Clause" && kind._0.$ === "RegionOutlives") {
      const outlives = kind._0._0;
      if (TypeVisitableExt.has_escaping_bound_vars(outlives, visit_OutlivesClause_Region)) {
        return Outcome.NoFastPath;
      }

      // We use `VisibleForLeakCheck::Yes` for `RegionOutlives` goals without
      // the fast path. However, we always change region constraints from nested
      // goals to `VisibleForLeakCheck::No`, so to be consistent with this
      // behavior as we avoid the nested goal boundary, we have to manually
      // set the flag.
      this._0.sub_regions({ $: "RelateRegionParamBound", _0: span, _1: undefined }, outlives._1, outlives._0, VisibleForLeakCheck.No);
      return Outcome.TriviallyHolds;
    } else if (kind.$ === "Clause" && kind._0.$ === "TypeOutlives") {
      const outlives = kind._0._0;
      if (TypeVisitableExt.has_escaping_bound_vars(outlives, visit_OutlivesClause_Ty)) {
        return Outcome.NoFastPath;
      }

      const ty = this._0.deeply_resolve_ignoring_regions(outlives._0, fold_Ty);
      if (TypeVisitableExt.has_non_rigid_aliases(ty, fold_Ty)) {
        return Outcome.NoFastPath;
      }

      const infer_collector = new CollectNonRegionInfer([], new Set());
      fold_Ty.visit_with(ty, infer_collector);
      const infers = infer_collector.infers;
      if (infers.length !== 0) {
        return goal_stalled_on_args(infers.map((i) => unwrap(TyOrConstInferVar.maybe_from_generic_arg(i))));
      }

      this._0.register_type_outlives_constraint(outlives._0, outlives._1, ObligationCause.dummy_with_span(span));

      return Outcome.TriviallyHolds;
    } else if (kind.$ === "Subtype" || kind.$ === "Coerce") {
      const { a, b } = kind._0;
      if (TypeVisitableExt.has_escaping_bound_vars(a, fold_Ty) || TypeVisitableExt.has_escaping_bound_vars(b, fold_Ty)) {
        return Outcome.NoFastPath;
      }

      const ak = this._0.shallow_resolve(a).kind();
      const bk = this._0.shallow_resolve(b).kind();
      if (ak.$ === "Infer" && ak._0.$ === "TyVar" && bk.$ === "Infer" && bk._0.$ === "TyVar") {
        const a_vid = ak._0._0;
        const b_vid = bk._0._0;
        this._0.sub_unify_ty_vids_raw(a_vid, b_vid);
        return goal_stalled_on_args([
          { $: "Ty", _0: a_vid },
          { $: "Ty", _0: b_vid },
        ]);
      } else {
        return Outcome.NoFastPath;
      }
    } else if (kind.$ === "Clause" && kind._0.$ === "ConstArgHasType") {
      const ct = kind._0._0;
      if (TypeVisitableExt.has_escaping_bound_vars(ct, fold_Const)) {
        return Outcome.NoFastPath;
      }

      const arg = this._0.shallow_resolve_const(ct);
      const vid = arg.ct_vid();
      if (vid !== undefined) {
        return goal_stalled_on_args([{ $: "Const", _0: vid }]);
      } else {
        return Outcome.NoFastPath;
      }
    } else if (kind.$ === "Clause" && kind._0.$ === "WellFormed") {
      const arg0 = kind._0._0;
      if (TypeVisitableExt.has_escaping_bound_vars(arg0, fold_Term)) {
        return Outcome.NoFastPath;
      }

      const arg = this._0.shallow_resolve_term(arg0);
      if (Term.is_trivially_wf(arg, this._0.tcx)) {
        return Outcome.TriviallyHolds;
      } else if (Term.is_infer(arg)) {
        return goal_stalled_on_args([unwrap(TyOrConstInferVar.maybe_from_term(arg), "its an infer var")]);
      } else {
        return Outcome.NoFastPath;
      }
    } else {
      return Outcome.NoFastPath;
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:317 fresh_var_for_kind
  fresh_var_for_kind(arg: GenericArg, span: Span, universe: UniverseIndex): GenericArg {
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime":
        return GenericArg.from_Region(this._0.next_region_var_in_universe({ $: "Misc", _0: span }, universe));
      case "Type":
        return GenericArg.from_Ty(this._0.next_ty_var_in_universe(span, universe));
      case "Const":
        return GenericArg.from_Const(this._0.next_const_var_in_universe(span, universe));
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:332 leak_check
  leak_check(max_input_universe: UniverseIndex): Result<undefined, NoSolution> {
    const r = this._0.leak_check(max_input_universe, undefined);
    return r.$ === "Ok" ? Ok(undefined) : Err(solve.NO_SOLUTION);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:336 evaluate_const
  evaluate_const<E>(param_env: ParamEnv, alias_const: AliasConst, normalize_ty: (ty: Unnormalized<Ty>) => Result<Ty, E>): Result<Const | undefined, E> {
    const ct = Const.new_alias(this._0.tcx, "No", alias_const);

    const r = try_evaluate_const(this._0, ct, param_env, normalize_ty);
    if (r.$ === "Ok") {
      return Ok(r._0);
    }
    const e = r._0;
    switch (e.$) {
      case "EvaluationFailure":
        return Ok(Const.new_error(this._0.tcx, e._0));
      case "InvalidConstParamTy":
      case "HasGenericsOrInfers":
        return Ok(undefined);
      case "FailedNormalization":
        return Err(e._0);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:356 well_formed_goals
  well_formed_goals(param_env: ParamEnv, term: Term): Goal<Predicate>[] | undefined {
    const obligations = wf_unnormalized_obligations(this._0, param_env, term, DUMMY_SP, CRATE_DEF_ID);
    return obligations === undefined ? undefined : obligations.map((obligation) => obligation.as_goal());
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:371 make_deduplicated_region_constraints
  make_deduplicated_region_constraints(): [RegionConstraint, VisibleForLeakCheck][] {
    // Cannot use `take_registered_region_obligations` as we may compute the response
    // inside of a `probe` whenever we have multiple choices inside of the solver.
    const region_obligations = this._0.inner.region_obligations().slice();
    const region_assumptions = this._0.inner.region_assumptions().slice();
    const region_constraints = this._0.with_region_constraints((region_constraints) =>
      make_query_region_constraints(region_obligations, region_constraints, region_assumptions),
    );

    // PORT: `FxHashMap<ty::RegionConstraint, usize>`: keyed by the value's intern key (derived `Hash`/`Eq`).
    const seen = new Map<string, number>();
    const constraints: [RegionConstraint, VisibleForLeakCheck][] = [];
    for (const { constraint: outlives, visible_for_leak_check: vis } of region_constraints.constraints) {
      const key = intern_key(outlives);
      const idx = seen.get(key);
      if (idx !== undefined) {
        const entry = unwrap(constraints[idx]);
        entry[1] = VisibleForLeakCheck.or(entry[1], vis);
      } else {
        seen.set(key, constraints.length);
        constraints.push([outlives as RegionConstraint, vis]);
      }
    }
    return constraints;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:407 instantiate_canonical
  instantiate_canonical<V>(canonical: Canonical<V>, values: CanonicalVarValues, d_V: TypeFoldable<V>): V {
    return Canonical_instantiate(canonical, this._0.tcx, values, d_V);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:418 instantiate_canonical_var
  instantiate_canonical_var(
    kind: CanonicalVarKind,
    span: Span,
    var_values: readonly GenericArg[],
    universe_map: (u: UniverseIndex) => UniverseIndex,
  ): GenericArg {
    return this._0.instantiate_canonical_var(span, kind, var_values, universe_map);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:428 add_item_bounds_for_hidden_type
  add_item_bounds_for_hidden_type(def_id: DefId, args: GenericArgs, param_env: ParamEnv, hidden_ty: Ty, goals: Goal<Predicate>[]): void {
    this._0.add_item_bounds_for_hidden_type(def_id, args, param_env, hidden_ty, goals);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:439 fetch_eligible_assoc_item
  fetch_eligible_assoc_item(goal_trait_ref: TraitRef, trait_assoc_def_id: DefId, impl_def_id: DefId): FetchEligibleAssocItemResponse {
    const r = specialization_graph_assoc_def(this._0.tcx, impl_def_id, trait_assoc_def_id);
    if (r.$ === "Err") {
      return { $: "Err", _0: r._0 };
    }
    const node_item = r._0;

    const typing_mode = this._0.typing_mode_raw();

    let eligible: boolean;
    if (node_item.is_final()) {
      // Non-specializable items are always projectable.
      eligible = true;
    } else {
      // Only reveal a specializable default if we're past type-checking
      // and the obligation is monomorphic, otherwise passes such as
      // transmute checking and polymorphic MIR optimizations could
      // get a result which isn't correct for all monomorphizations.
      switch (typing_mode.$) {
        case "Coherence":
        case "Typeck":
        case "PostTypeckUntilBorrowck":
        case "Reflection":
        case "PostBorrowck":
          eligible = false;
          break;
        case "PostAnalysis":
        case "Codegen": {
          const poly_trait_ref = this._0.deeply_resolve_ignoring_regions(goal_trait_ref, fold_TraitRef_);
          eligible = !TypeVisitableExt.still_further_specializable(poly_trait_ref, fold_TraitRef_);
          break;
        }
        case "ErasedNotCoherence":
          return FetchEligibleAssocItemResponse.NotFoundBecauseErased;
      }
    }

    // FIXME: Check for defaultness here may cause diagnostics problems.
    if (eligible) {
      return { $: "Found", _0: node_item.item.def_id };
    } else {
      // We know it's not erased since then we'd have returned in the match above,
      // or node_item.final() was true and eligible is always true.
      return { $: "NotFound", _0: TypingMode.assert_not_erased(typing_mode) };
    }
  }

  // FIXME: This actually should destructure the `Result` we get from transmutability and
  // register candidates. We probably need to register >1 since we may have an OR of ANDs.
  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:489 is_transmutable
  is_transmutable(src_: Ty, dst_: Ty, assume_: Const): Result<Certainty, NoSolution> {
    // Erase regions because we compute layouts in `rustc_transmute`,
    // which will ICE for region vars.
    const [dst, src] = this._0.tcx.erase_and_anonymize_regions<[Ty, Ty]>([dst_, src_], fold_Ty_Ty());

    const assume = rustc_transmute.Assume.from_const(this._0.tcx, assume_);
    if (assume === undefined) {
      return Err(solve.NO_SOLUTION);
    }

    // FIXME(transmutability): This really should be returning nested goals for `Answer::If*`
    switch (rustc_transmute.TransmuteTypeEnv.new(this._0.tcx).is_transmutable(src, dst, assume).$) {
      case "Yes":
        return Ok(CertaintyC.Yes);
      case "No":
      case "If":
        return Err(solve.NO_SOLUTION);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:510 obtain_canonicalizer_state
  obtain_canonicalizer_state(): CanonicalizerState {
    // We temporarily take the canonicalizer state.
    const state = this._0.canonicalizer_state;
    this._0.canonicalizer_state = CanonicalizerState.default_();
    return state;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:515 release_canonicalizer_state
  release_canonicalizer_state(state: CanonicalizerState): void {
    // Clear (don't deallocate) the state for later reuse.
    state.clear();
    this._0.canonicalizer_state = state;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:521 emit_next_solver_overflow_fcw
  emit_next_solver_overflow_fcw(goal0: Goal<Predicate>, span: Span): void {
    const tcx = this._0.tcx;
    tcx.emit_node_span_lint(
      RECURSION_DEPTH_EXCEEDING_LIMIT,
      CRATE_HIR_ID,
      span,
      DiagDecorator((diag: Diag) => {
        // We do this in the decorator as that avoids the work
        // if we don't actually emit the lint.
        const goal = this._0.deeply_resolve_ignoring_regions(goal0, fold_Goal_Predicate);
        const visitor = new OverflowedGoalChain(span, [], Math.min(16, tcx.recursion_limit()._0));

        this._0.with_disabled_next_solver_overflow_fcw(() => this._0.visit_proof_tree(goal, visitor));

        // FIXME: share this with overflow error in fulfillment instead of duplicating.
        const pred_str = (pred: Predicate): string => {
          const s = display_Predicate(pred);
          if (utf8_len(s) > 80) {
            const p = FmtPrinter.new_with_limit(tcx, "TypeNS" as Namespace, Limit.new(10));
            const r = print_Predicate(pred, p);
            if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value: Error");
            return p.into_buffer();
          } else {
            return s;
          }
        };
        diag.primary_message(`overflow evaluating the requirement \`${pred_str(goal.predicate)}\``);
        for (const p of visitor.predicates.slice(1)) {
          diag.note(`which requires \`${pred_str(p)}\``);
        }
        diag.note("and so on...");
        diag.help(
          "consider adding a manual `impl` of auto traits like `Send` for intermediate types, if auto traits are involved",
        );
        diag.help(
          `or consider increasing the recursion limit by adding a \`#![recursion_limit = "${display_Limit(Limit_mul(tcx.recursion_limit(), 2))}"]\` attribute to your crate (\`${Symbol.as_str(tcx.crate_name(LOCAL_CRATE))}\`)`,
        );
        diag.note("this lint is attached to the whole crate and can't be disabled on a per-function basis");
      }),
    );
  }
}

/** The associated fns of `impl SolverDelegate for SolverDelegate` (module comment). */
export const SolverDelegate_static_impl: SolverDelegate_static = {
  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:136 build_with_canonical
  build_with_canonical<V>(interner: TyCtxt, canonical: CanonicalQueryInput<V>, d_V: TypeFoldable<V>): [SolverDelegate, V, CanonicalVarValues] {
    const [infcx, value, vars] = interner.infer_ctxt().with_next_trait_solver(true).build_with_canonical(DUMMY_SP, canonical, d_V);
    return [new SolverDelegate(infcx), value, vars];
  },

  /** `<InferCtxt as InferCtxtLike>::OpaqueTypeStorageEntries::default()` */
  OpaqueTypeStorageEntries_default(): OpaqueTypeStorageEntries {
    return default_OpaqueTypeStorageEntries();
  },
};

/// Create a [`ComputeGoalFastPathOutcome`] signalling the goal is stalled
/// on a list of [`ty::GenericArg`]
// rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:66 goal_stalled_on_args
function goal_stalled_on_args(stalled_vars: TyOrConstInferVar[]): ComputeGoalFastPathOutcome {
  const stalled_on: GoalStalledOn = {
    stalled_vars,
    sub_roots: [],
    stalled_maybe_info: MaybeInfo.AMBIGUOUS,
    opaques: GoalStalledOnOpaques.No,
  };
  return { $: "TriviallyStalled", stalled_on };
}

/// Create a [`ComputeGoalFastPathOutcome`] signalling the  goal is stalled
/// on a list of [`ty::GenericArg`] *or* the opaque type storage being nonempty.
///
// rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:82 goal_stalled_on_args_or_nonempty_opaques
function goal_stalled_on_args_or_nonempty_opaques(stalled_vars: TyOrConstInferVar[]): ComputeGoalFastPathOutcome {
  const stalled_on: GoalStalledOn = {
    stalled_vars,
    sub_roots: [],
    stalled_maybe_info: MaybeInfo.AMBIGUOUS,
    opaques: {
      $: "Yes",
      num_opaques_in_storage: 0,
      // This function should only be called when not in erased mode,
      // otherwise this is wrong. The `compute_goal_fast_path` does this
      // through `known_no_opaque_types_in_storage`
      previously_succeeded_in_erased: SucceededInErased.No,
    },
  };
  return { $: "TriviallyStalled", stalled_on };
}

class CollectNonRegionInfer implements TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result = VisitorResult.unit;

  constructor(
    public infers: GenericArg[],
    // PORT: `FxHashSet<Ty>`: interned `Ty`s compare by identity.
    public visited: Set<Ty>,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:107 visit_ty
  visit_ty(ty: Ty): undefined {
    if (this.visited.has(ty)) {
      return;
    }

    const k = ty.kind();
    if (k.$ === "Infer") {
      this.infers.push(GenericArg.from_Ty(ty));
    } else {
      fold_Ty.super_visit_with(ty, this);
    }

    this.visited.add(ty);
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:120 visit_const
  visit_const(ct: Const): undefined {
    const k = ct.kind();
    if (k.$ === "Infer") {
      this.infers.push(GenericArg.from_Const(ct));
    } else {
      fold_Const.super_visit_with(ct, this);
    }
  }

  // (provided) TypeVisitor methods this impl does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
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
}

class OverflowedGoalChain implements ProofTreeVisitor<ControlFlowT<null>> {
  /** `type Result = ControlFlow<()>;` */
  readonly Result = VisitorResult.ControlFlow<null>();

  constructor(
    public span_: Span,
    public predicates: Predicate[],
    public recursion_limit: number,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:585 span
  span(): Span {
    return this.span_;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:589 config
  config(): InspectConfig {
    return { max_depth: this.recursion_limit };
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:593 visit_goal
  visit_goal(goal: InspectGoal): ControlFlowT<null> {
    this.predicates.push(goal.goal().predicate);
    const cand = goal.unique_applicable_candidate();
    if (cand !== undefined) {
      const r = goal.infcx().probe((_) => {
        // `.into_iter().max_by_key(|g| g.required_depth())`: the last maximum wins.
        let nested_goal_with_largest_required_depth: InspectGoal | undefined;
        for (const g of cand.instantiate_nested_goals(this.span_)) {
          if (nested_goal_with_largest_required_depth === undefined || g.required_depth() >= nested_goal_with_largest_required_depth.required_depth()) {
            nested_goal_with_largest_required_depth = g;
          }
        }
        if (nested_goal_with_largest_required_depth !== undefined) {
          return nested_goal_with_largest_required_depth.visit_with(this);
        } else {
          return ControlFlow.CONTINUE;
        }
      });
      if (r.$ === "Break") return r;
    }
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_trait_selection/src/solve/delegate.rs:611 on_recursion_limit
  on_recursion_limit(): ControlFlowT<null> {
    return ControlFlow.Break(null);
  }
}

// ---- D4 descriptors -------------------------------------------------------------------------------------------------

const visit_OutlivesClause_Region: TypeVisitable<OutlivesClause<Region>> = {
  visit_with: <R>(s: OutlivesClause<Region>, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, fold_Region.visit_with),
};
const visit_OutlivesClause_Ty: TypeVisitable<OutlivesClause<Ty>> = {
  visit_with: <R>(s: OutlivesClause<Ty>, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, fold_Ty.visit_with),
};

// PORT: descriptors used above.
const fold_TraitRef_: TypeFoldable<TraitRef> = {
  visit_with: <R>(s: TraitRef, v: TypeVisitor<R>): R => visit_with_TraitRef(s, v),
  try_fold_with: <E>(s: TraitRef, f: FallibleTypeFolder<E>): Result<TraitRef, E> => try_fold_with_TraitRef(s, f),
  fold_with: (s: TraitRef, f: TypeFolder): TraitRef => fold_with_TraitRef(s, f),
};
// PORT: read lazily (`fold_tuple2` builds a descriptor from `fold_Ty`, which may not be initialized at load).
function fold_Ty_Ty(): TypeFoldable<[Ty, Ty]> {
  return fold_tuple2(fold_Ty, fold_Ty);
}

