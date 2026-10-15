// The rustc_trait_selection side of the inference contract (lane infcx-contract, wave 16): the `#[extension]` traits
// that rustc_trait_selection puts on rustc_infer's `InferCtxt`, `InferCtxtBuilder`, `At` and `OutlivesEnvironment`
// (`InferCtxtExt` (three of them), `InferCtxtBuilderExt`, `InferCtxtRegionExt`, `OutlivesEnvironmentBuildExt`,
// `InferCtxtSelectExt`, `InferCtxtProofTreeExt`, `NormalizeExt`, `QueryNormalizeExt`, `StructurallyNormalizeExt`,
// `InferCtxtErrorExt`). Each declaration carries `// <file>:<line>` (paths relative to
// compiler/rustc_trait_selection/src/).
//
// PORT: an `#[extension(pub trait X)] impl Ty` adds its methods to `Ty`'s prototype, under their own names (as rustc_middle's
// `ConstExt` on `Const.prototype`): `infcx.can_eq(..)`, `at.normalize(..)`, `OutlivesEnvironment.new(..)`. None of the names
// collides with an inherent method of the target type or with another extension trait (contract.test.ts checks it). The
// file that ports the trait assigns the methods (it is loaded by ./lib.ts after rustc_infer); until then the stub module
// of the file installs `unported` placeholders.
//
// Contract rules: as ../rustc_infer/decls.ts (ownership, signature mapping, D4 descriptors, "How to fill a stub").
// Types of rustc_trait_selection that are not ported yet are `Pending<"..">` aliases (rustc_type_ir decls.ts); the lane
// that ports a type replaces the alias with a re-export.
//
// Init order: this module imports only types.

import type { At, InferCtxt, InferCtxtBuilder } from "../rustc_infer/decls.ts";
import type { ToTrace } from "../rustc_infer/infer/at.ts";
import type { InferOk } from "../rustc_infer/infer/mod.gen.ts";
import type { OutlivesEnvironment } from "../rustc_infer/infer/outlives/env.ts";
import type { RegionResolutionError } from "../rustc_infer/infer/lexical_region_resolve/mod.ts";
import type { TraitEngine, TraitErrors } from "../rustc_infer/traits/engine.ts";
import type { PolyTraitObligation, PredicateObligation, Selection } from "../rustc_infer/traits/mod.ts";
import type { Normalized } from "../rustc_infer/traits/project.ts";
import type { Canonical, CanonicalQueryInput, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { EvaluationResult, OverflowError, SelectionResult } from "../rustc_middle/traits/mod.ts";
import type { OutlivesBound } from "../rustc_middle/traits/query.gen.ts";
import type { Const, GenericArg, ParamEnv, Predicate, Term, Ty } from "../rustc_middle/ty/decls.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { Pending } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { Goal, NoSolution } from "../rustc_type_ir/solve/mod.ts";
import type { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { Result } from "../std/result.ts";

/** `traits::ObligationCtxt<'a, 'tcx, E>` (traits/engine.rs, lane trait-sel-traits-a). */
export type { ObligationCtxt } from "./traits/engine.ts";
/** `traits::FulfillmentError<'tcx>` (traits/mod.rs, lane trait-sel-traits-a). */
export type { FulfillmentError } from "./traits/mod.gen.ts";
/** `solve::NextSolverError<'tcx>` (solve/fulfill.rs, lane trait-sel-solve). */
export type { NextSolverError } from "./solve/fulfill.ts";
/** `solve::inspect::ProofTreeVisitor<'tcx>` (solve/inspect/analyse.rs, lane trait-sel-solve): `V: ProofTreeVisitor` with its `V::Result`. */
export type { ProofTreeVisitor } from "./solve/inspect/analyse.ts";
import type { FulfillmentError } from "./traits/mod.gen.ts";
import type { ObligationCtxt } from "./traits/engine.ts";
import type { NextSolverError } from "./solve/fulfill.ts";
import type { ProofTreeVisitor } from "./solve/inspect/analyse.ts";

declare module "../rustc_infer/decls.ts" {
  interface InferCtxt {
    // ---- infer.rs: `#[extension(pub trait InferCtxtExt)] impl InferCtxt` (lane trait-sel-traits-a) ----
    // infer.rs:23
    can_eq<T>(param_env: ParamEnv, a: T, b: T, d_T: ToTrace<T>): boolean;
    // infer.rs:33
    type_is_copy_modulo_regions(param_env: ParamEnv, ty: Ty): boolean;
    // infer.rs:39
    type_is_clone_modulo_regions(param_env: ParamEnv, ty: Ty): boolean;
    // infer.rs:45
    type_is_use_cloned_modulo_regions(param_env: ParamEnv, ty: Ty): boolean;
    // infer.rs:55
    type_is_sized_modulo_regions(param_env: ParamEnv, ty: Ty): boolean;
    // infer.rs:89 (`params: impl IntoIterator<Item: Into<GenericArg>>`: callers convert)
    type_implements_trait(trait_def_id: DefId, params: Iterable<GenericArg>, param_env: ParamEnv): EvaluationResult;
    // infer.rs:114
    type_implements_trait_shallow(trait_def_id: DefId, ty: Ty, param_env: ParamEnv): TraitErrors<FulfillmentError> | undefined;

    // ---- regions.rs: `#[extension(pub trait InferCtxtRegionExt)] impl InferCtxt` (lane trait-sel-traits-a) ----
    // regions.rs:73
    resolve_regions(body_def_id: LocalDefId, param_env: ParamEnv, assumed_wf_tys: Iterable<Ty>): RegionResolutionError[];

    // ---- solve/select.rs: `#[extension(pub trait InferCtxtSelectExt)] impl InferCtxt` (lane trait-sel-solve) ----
    // solve/select.rs:19
    select_in_new_trait_solver(obligation: PolyTraitObligation): SelectionResult<Selection>;

    // ---- solve/inspect/analyse.rs: `#[extension(pub trait InferCtxtProofTreeExt)] impl InferCtxt` (lane trait-sel-solve) ----
    // solve/inspect/analyse.rs:395 (`V: ProofTreeVisitor`, returns `V::Result`)
    visit_proof_tree<R>(goal: Goal<Predicate>, visitor: ProofTreeVisitor<R>): R;
    // solve/inspect/analyse.rs:403
    visit_proof_tree_at_depth<R>(goal: Goal<Predicate>, depth: number, visitor: ProofTreeVisitor<R>): R;

    // ---- traits/outlives_bounds.rs: `#[extension(pub trait InferCtxtExt)] impl InferCtxt` (lane trait-sel-traits-b) ----
    // traits/outlives_bounds.rs:104
    implied_bounds_tys(body_def_id: LocalDefId, param_env: ParamEnv, tys: Iterable<Ty>, disable_implied_bounds_hack: boolean): Iterable<OutlivesBound>;

    // ---- traits/query/evaluate_obligation.rs: `#[extension(pub trait InferCtxtExt)] impl InferCtxt` (wave 20 old-query-typeops) ----
    // traits/query/evaluate_obligation.rs:18
    predicate_may_hold(obligation: PredicateObligation): boolean;
    // traits/query/evaluate_obligation.rs:24
    predicate_may_hold_opaque_types_jank(obligation: PredicateObligation): boolean;
    // traits/query/evaluate_obligation.rs:38
    goal_may_hold_opaque_types_jank(goal: Goal<Predicate>): boolean;
    // traits/query/evaluate_obligation.rs:70
    predicate_must_hold_considering_regions(obligation: PredicateObligation): boolean;
    // traits/query/evaluate_obligation.rs:82
    predicate_must_hold_modulo_regions(obligation: PredicateObligation): boolean;
    // traits/query/evaluate_obligation.rs:87
    evaluate_obligation(obligation: PredicateObligation): Result<EvaluationResult, OverflowError>;
    // traits/query/evaluate_obligation.rs:124
    evaluate_obligation_no_overflow(obligation: PredicateObligation): EvaluationResult;

    // ---- error_reporting/mod.rs: `#[extension(pub trait InferCtxtErrorExt)] impl InferCtxt` (wave 19 errctxt-contract) ----
    // error_reporting/mod.rs:42
    err_ctxt(): TypeErrCtxt;
  }

  interface InferCtxtBuilder {
    // ---- infer.rs: `#[extension(pub trait InferCtxtBuilderExt)] impl InferCtxtBuilder` (lane trait-sel-traits-a) ----
    // infer.rs:166 (`K: TypeFoldable`, `R: TypeFoldable`)
    enter_canonical_trait_query<K, R>(
      canonical_key: CanonicalQueryInput<K>,
      operation: (ocx: ObligationCtxt, key: K) => Result<R, NoSolution>,
      d_K: TypeFoldable<K>,
      d_R: TypeFoldable<R>,
    ): Result<Canonical<QueryResponse<R>>, NoSolution>;
  }

  interface At {
    // ---- traits/normalize.rs: `#[extension(pub trait NormalizeExt)] impl At` (lane trait-sel-traits-a) ----
    // traits/normalize.rs:30
    normalize<T>(value: Unnormalized<T>, d_T: TypeFoldable<T>): InferOk<T>;
    // traits/normalize.rs:57 (`E: FromSolverError<NextSolverError>`: the descriptor `from_solver_error_E`)
    deeply_normalize<T, E>(
      value: Unnormalized<T>,
      fulfill_cx: TraitEngine<E>,
      d_T: TypeFoldable<T>,
      from_solver_error_E: import("../rustc_infer/traits/engine.ts").FromSolverError<E, NextSolverError>,
    ): Result<T, E[]>;

    // ---- traits/query/normalize.rs: `#[extension(pub trait QueryNormalizeExt)] impl At` (wave 20 old-query-typeops) ----
    // traits/query/normalize.rs:48
    query_normalize<T>(value: T, d_T: TypeFoldable<T>): Result<Normalized<T>, NoSolution>;

    // ---- traits/structural_normalize.rs: `#[extension(pub trait StructurallyNormalizeExt)] impl At` (lane trait-sel-traits-a) ----
    // traits/structural_normalize.rs:11
    structurally_normalize_ty<E>(ty: Unnormalized<Ty>, fulfill_cx: TraitEngine<E>): Result<Ty, E[]>;
    // traits/structural_normalize.rs:20
    structurally_normalize_const<E>(ct: Unnormalized<Const>, fulfill_cx: TraitEngine<E>): Result<Const, E[]>;
    // traits/structural_normalize.rs:33
    structurally_normalize_term<E>(term: Unnormalized<Term>, fulfill_cx: TraitEngine<E>): Result<Term, E[]>;
  }
}

declare module "../rustc_infer/infer/outlives/env.ts" {
  // ---- regions.rs: `#[extension(pub trait OutlivesEnvironmentBuildExt)] impl OutlivesEnvironment` (lane trait-sel-traits-a) ----
  namespace OutlivesEnvironment {
    // regions.rs:17
    function new_(infcx: InferCtxt, body_def_id: LocalDefId, param_env: ParamEnv, assumed_wf_tys: Iterable<Ty>): OutlivesEnvironment;
    export { new_ as new };
    // regions.rs:26
    export let new_with_implied_bounds_compat: (
      infcx: InferCtxt,
      body_def_id: LocalDefId,
      param_env: ParamEnv,
      assumed_wf_tys: Iterable<Ty>,
      disable_implied_bounds_hack: boolean,
    ) => OutlivesEnvironment;
  }
}

/** PORT: names the declarations above use only in type positions of other modules. */
export type TraitSelectionDeclsUnused = At | InferCtxt | InferCtxtBuilder;

// =====================================================================================================================
// The old trait solver (lane selcx-contract, M3 wave 18; plan-m3 D9: compiletest's `-Znext-solver=coherence` runs typeck
// on it). `SelectionContext` is the generated class of traits/select/mod.gen.ts; its `impl` blocks are spread over
// traits/traits/select/{mod,candidate_assembly,confirmation}.rs, so every method is declared here (grouped by file, upstream
// order, `// <file>:<line>`). The other old-solver files declare their own pub fns as signature-typed stubs in their
// modules (traits/project.ts, traits/query/**, traits/implied_outlives_bounds.ts, traits/vtable.ts, ...); see
// docs/handoff/selcx-contract.md "How to fill a stub" and its split table.
// =====================================================================================================================

import type { SelectionContext, TraitObligationStack, TraitObligationStackList, SelectionCandidateSet, EvaluatedCandidate, ProjectionMatchesProjection, AutoImplConstituents } from "./traits/select/mod.ts";
import type { TraitQueryMode } from "./traits/mod.gen.ts";
import type { ProjectionTermObligation } from "./traits/project.gen.ts";
import type { TraitObligation, PredicateObligations, Obligation } from "../rustc_infer/traits/mod.ts";
import type { ImplSource, ImplSourceUserDefinedData, ObligationCause, SelectionError } from "../rustc_middle/traits/mod.ts";
import type { SelectionCandidate } from "../rustc_middle/traits/select.ts";
import type { DepNodeIndex } from "../rustc_middle/dep_graph/graph.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause, GenericArgs, Region } from "../rustc_middle/ty/decls.ts";
import type { ImplTraitHeader } from "../rustc_middle/ty/mod.ts";
import type { PolyProjectionClause, PolyTraitClause, TraitClause, PolyExistentialPredicate } from "../rustc_middle/ty/predicate.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { Binder } from "../rustc_type_ir/binder.ts";
import type { CantBeErased, TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import type { PolyTraitRef, TraitRef } from "../rustc_type_ir/decls.ts";
import type { AliasBoundKind, CandidatePreferenceMode, SizedTraitKind } from "../rustc_type_ir/solve/mod.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";

declare module "./traits/select/mod.gen.ts" {
  namespace SelectionContext {
    // traits/select/mod.rs:181 (ported)
    function new_(infcx: InferCtxt): SelectionContext;
    export { new_ as new };
    // traits/select/mod.rs:193 (ported)
    export let with_query_mode: (infcx: InferCtxt, query_mode: TraitQueryMode) => SelectionContext;
  }

  interface SelectionContext {
    // ---- select/mod.rs: `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>` (mod.rs:180) ----
    // traits/select/mod.rs:189 (ported)
    typing_mode(): TypingMode<CantBeErased>;
    // traits/select/mod.rs:201 (ported)
    tcx(): TyCtxt;
    // traits/select/mod.rs:223 (lane old-select-a)
    poly_select(obligation: PolyTraitObligation): SelectionResult<Selection>;
    // traits/select/mod.rs:262
    select(obligation: TraitObligation): SelectionResult<Selection>;
    // traits/select/mod.rs:274
    select_from_obligation(obligation: PolyTraitObligation): SelectionResult<SelectionCandidate>;
    // traits/select/mod.rs:287
    candidate_from_obligation(stack: TraitObligationStack): SelectionResult<SelectionCandidate>;
    // traits/select/mod.rs:331
    candidate_from_obligation_no_cache(stack: TraitObligationStack): SelectionResult<SelectionCandidate>;
    // traits/select/mod.rs:438
    evaluate_root_obligation(obligation: PredicateObligation): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:465
    evaluation_probe(op: (selcx: SelectionContext) => Result<EvaluationResult, OverflowError>): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:495
    evaluate_predicates_recursively(stack: TraitObligationStackList, predicates: Iterable<PredicateObligation>): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:524
    evaluate_predicate_recursively(previous_stack: TraitObligationStackList, obligation: PredicateObligation): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:931
    evaluate_trait_predicate_recursively(previous_stack: TraitObligationStackList, obligation: PolyTraitObligation): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:1073
    check_evaluation_cycle(stack: TraitObligationStack): EvaluationResult | undefined;
    // traits/select/mod.rs:1116
    evaluate_stack(stack: TraitObligationStack): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:1178 (`I: Iterator<Item = Predicate>`)
    coinductive_match(cycle: Iterable<Predicate>): boolean;
    // traits/select/mod.rs:1205
    evaluate_candidate(stack: TraitObligationStack, candidate: SelectionCandidate): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:1243
    check_evaluation_cache(param_env: ParamEnv, trait_pred: PolyTraitClause): EvaluationResult | undefined;
    // traits/select/mod.rs:1263
    insert_evaluation_cache(param_env: ParamEnv, trait_pred: PolyTraitClause, dep_node: DepNodeIndex, result: EvaluationResult): void;
    // traits/select/mod.rs:1293 (`T: Upcast<TyCtxt, Predicate> + Clone`: the D4 `upcast_from_T`)
    check_recursion_depth<T>(depth: number, error_obligation: Obligation<T>, upcast_from_T: (from: T, tcx: Interner) => Predicate): Result<null, OverflowError>;
    // traits/select/mod.rs:1322 (`T: Display + TypeFoldable`, `V: Upcast<TyCtxt, Predicate> + Clone`)
    check_recursion_limit<T, V>(obligation: Obligation<T>, error_obligation: Obligation<V>, upcast_from_V: (from: V, tcx: Interner) => Predicate): Result<null, OverflowError>;
    // traits/select/mod.rs:1333
    in_task<R>(op: (selcx: SelectionContext) => R): [R, DepNodeIndex];
    // traits/select/mod.rs:1343
    filter_impls(candidates: SelectionCandidate[], obligation: PolyTraitObligation): SelectionCandidate[];
    // traits/select/mod.rs:1370
    can_use_global_caches(param_env: ParamEnv, pred: PolyTraitClause): boolean;
    // traits/select/mod.rs:1414
    check_candidate_cache(param_env: ParamEnv, cache_fresh_trait_pred: PolyTraitClause): SelectionResult<SelectionCandidate> | undefined;
    // traits/select/mod.rs:1458
    can_cache_candidate(result: SelectionResult<SelectionCandidate>): boolean;
    // traits/select/mod.rs:1469
    insert_candidate_cache(
      param_env: ParamEnv,
      cache_fresh_trait_pred: PolyTraitClause,
      dep_node: DepNodeIndex,
      candidate: SelectionResult<SelectionCandidate>,
    ): void;
    // traits/select/mod.rs:1511 (`ControlFlow<T, ()>`)
    for_each_item_bound<T>(
      self_ty: Ty,
      for_each: (selcx: SelectionContext, clause: Clause, idx: number, kind: AliasBoundKind) => ControlFlow<T, null>,
      on_ambiguity: () => void,
    ): ControlFlow<T, null>;
    // traits/select/mod.rs:1569
    match_normalize_trait_ref(obligation: PolyTraitObligation, placeholder_trait_ref: TraitRef, trait_bound: PolyTraitRef): Result<TraitRef | undefined, null>;
    // traits/select/mod.rs:1614
    where_clause_may_apply(stack: TraitObligationStack, where_clause_trait_ref: PolyTraitRef): Result<EvaluationResult, OverflowError>;
    // traits/select/mod.rs:1633
    match_projection_projections(
      obligation: ProjectionTermObligation,
      env_predicate: PolyProjectionClause,
      potentially_unnormalized_candidates: boolean,
    ): ProjectionMatchesProjection;

    // ---- select/mod.rs: `impl<'tcx> SelectionContext<'_, 'tcx>` (mod.rs:1710, winnowing; lane old-select-b) ----
    // traits/select/mod.rs:1716
    winnow_candidates(
      has_non_region_infer: boolean,
      candidate_preference_mode: CandidatePreferenceMode,
      candidates: EvaluatedCandidate[],
    ): SelectionCandidate | undefined;
    // traits/select/mod.rs:1951 (the destructured `(lhs, lhs_evaluation)` is one tuple parameter)
    prefer_lhs_over_victim(has_non_region_infer: boolean, lhs_and_evaluation: [DefId, EvaluationResult], victim: DefId): boolean;

    // ---- select/mod.rs: `impl<'tcx> SelectionContext<'_, 'tcx>` (mod.rs:2023, builtin rules and helpers) ----
    // traits/select/mod.rs:2024
    sizedness_conditions(self_ty: Ty, sizedness: SizedTraitKind): Binder<Ty[]>;
    // traits/select/mod.rs:2081
    copy_clone_conditions(self_ty: Ty): Binder<Ty[]>;
    // traits/select/mod.rs:2160
    coroutine_is_gen(self_ty: Ty): boolean;
    // traits/select/mod.rs:2177
    constituent_types_for_auto_trait(t: Ty): Result<Binder<AutoImplConstituents>, SelectionError>;
    // traits/select/mod.rs:2307
    collect_predicates_for_types(param_env: ParamEnv, cause: ObligationCause, recursion_depth: number, trait_def_id: DefId, types: Ty[]): PredicateObligations;
    // traits/select/mod.rs:2371
    rematch_impl(impl_def_id: DefId, obligation: PolyTraitObligation): Normalized<GenericArgs>;
    // traits/select/mod.rs:2387
    match_impl(impl_def_id: DefId, impl_trait_header: ImplTraitHeader, obligation: PolyTraitObligation): Result<Normalized<GenericArgs>, null>;
    // traits/select/mod.rs:2452
    match_upcast_principal(
      obligation: PolyTraitObligation,
      unnormalized_upcast_principal: Unnormalized<PolyTraitRef>,
      a_data: List<PolyExistentialPredicate>,
      b_data: List<PolyExistentialPredicate>,
      a_region: Region,
      b_region: Region,
    ): SelectionResult<PredicateObligations>;
    // traits/select/mod.rs:2615
    match_where_clause_trait_ref(obligation: PolyTraitObligation, where_clause_trait_ref: PolyTraitRef): Result<PredicateObligations, null>;
    // traits/select/mod.rs:2626
    match_poly_trait_ref(obligation: PolyTraitObligation, poly_trait_ref: PolyTraitRef): Result<PredicateObligations, null>;
    // traits/select/mod.rs:2647
    match_fresh_trait_preds(previous: PolyTraitClause, current: PolyTraitClause): boolean;
    // traits/select/mod.rs:2656
    push_stack(previous_stack: TraitObligationStackList, obligation: PolyTraitObligation): TraitObligationStack;
    // traits/select/mod.rs:2676
    closure_trait_ref_unnormalized(self_ty: Ty, fn_trait_def_id: DefId): PolyTraitRef;
    // traits/select/mod.rs:2701
    impl_or_trait_obligations(
      cause: ObligationCause,
      recursion_depth: number,
      param_env: ParamEnv,
      def_id: DefId,
      args: GenericArgs,
      parent_trait_pred: Binder<TraitClause>,
    ): PredicateObligations;
    // traits/select/mod.rs:2782
    should_stall_coroutine(def_id: DefId): boolean;

    // ---- select/candidate_assembly.rs: `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>` (lane old-candidates-confirm) ----
    // traits/select/candidate_assembly.rs:31
    assemble_candidates(stack: TraitObligationStack): Result<SelectionCandidateSet, SelectionError>;
    // traits/select/candidate_assembly.rs:191
    assemble_candidates_from_projected_tys(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:272
    assemble_candidates_from_caller_bounds(stack: TraitObligationStack, candidates: SelectionCandidateSet): Result<null, SelectionError>;
    // traits/select/candidate_assembly.rs:312
    assemble_coroutine_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:337
    assemble_future_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:354
    assemble_iterator_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:371
    assemble_fused_iterator_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:381
    assemble_async_iterator_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:415
    assemble_closure_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:478
    assemble_async_closure_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:540
    assemble_async_fn_kind_helper_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:567
    assemble_fn_pointer_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:603
    assemble_candidates_from_impls(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:653
    reject_fn_ptr_impls(impl_def_id: DefId, obligation: PolyTraitObligation, impl_self_ty: Ty): boolean;
    // traits/select/candidate_assembly.rs:741
    assemble_candidates_from_auto_impls(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:911
    assemble_candidates_from_object_ty(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:985
    assemble_candidates_for_unsizing(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1111
    assemble_candidates_for_transmutability(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1129
    assemble_candidates_for_trait_alias(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1148
    assemble_builtin_copy_clone_candidate(self_ty: Ty, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1249
    assemble_builtin_sized_candidate(self_ty: Ty, candidates: SelectionCandidateSet, sizedness: SizedTraitKind): void;
    // traits/select/candidate_assembly.rs:1318
    assemble_const_destruct_candidates(_obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1326
    assemble_candidate_for_tuple(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1370
    assemble_candidates_for_fn_ptr_trait(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1418
    assemble_candidates_for_bikeshed_guaranteed_no_drop_trait(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1462
    assemble_candidates_for_try_as_dyn(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // traits/select/candidate_assembly.rs:1490
    assemble_candidates_for_field_trait(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;

    // ---- select/confirmation.rs: `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>` (lane old-candidates-confirm) ----
    // traits/select/confirmation.rs:35
    confirm_candidate(obligation: PolyTraitObligation, candidate: SelectionCandidate): Result<Selection, SelectionError>;
    // traits/select/confirmation.rs:145
    confirm_projection_candidate(obligation: PolyTraitObligation, idx: number): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:201
    confirm_param_candidate(obligation: PolyTraitObligation, param: PolyTraitRef): PredicateObligations;
    // traits/select/confirmation.rs:232
    confirm_builtin_candidate(obligation: PolyTraitObligation): PredicateObligations;
    // traits/select/confirmation.rs:284 (with the nested `fn flatten_answer_tree` at :292, a local function)
    confirm_transmutability_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:384
    confirm_auto_impl_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:428
    confirm_impl_candidate(obligation: PolyTraitObligation, impl_def_id: DefId): ImplSourceUserDefinedData<PredicateObligation>;
    // traits/select/confirmation.rs:450
    vtable_impl(
      impl_def_id: DefId,
      args: Normalized<GenericArgs>,
      cause: ObligationCause,
      recursion_depth: number,
      param_env: ParamEnv,
      parent_trait_pred: Binder<TraitClause>,
    ): ImplSourceUserDefinedData<PredicateObligation>;
    // traits/select/confirmation.rs:482
    confirm_object_candidate(obligation: PolyTraitObligation, index: number): Result<ImplSource<PredicateObligation>, SelectionError>;
    // traits/select/confirmation.rs:593
    confirm_fn_pointer_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:637
    confirm_trait_alias_candidate(obligation: PolyTraitObligation): PredicateObligations;
    // traits/select/confirmation.rs:662
    confirm_coroutine_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:692
    confirm_future_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:722
    confirm_iterator_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:752
    confirm_async_iterator_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:783
    confirm_closure_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:812
    confirm_async_closure_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:958
    equate_trait_refs(obligation: TraitObligation, found_trait_ref: PolyTraitRef): Result<PredicateObligations, SelectionError>;
    // traits/select/confirmation.rs:995
    confirm_trait_upcasting_unsize_candidate(obligation: PolyTraitObligation, idx: number): Result<ImplSource<PredicateObligation>, SelectionError>;
    // traits/select/confirmation.rs:1033
    confirm_builtin_unsize_candidate(obligation: PolyTraitObligation): Result<ImplSource<PredicateObligation>, SelectionError>;
    // traits/select/confirmation.rs:1227
    confirm_bikeshed_guaranteed_no_drop_candidate(obligation: PolyTraitObligation): ImplSource<PredicateObligation>;
    // traits/select/confirmation.rs:1314
    confirm_try_as_dyn_candidate(obligation: PolyTraitObligation): ImplSource<PredicateObligation>;
  }
}

// =====================================================================================================================
// Error reporting (lane errctxt-contract, plan-m3 wave 19): `error_reporting::TypeErrCtxt` (error_reporting/mod.rs:20) and
// one declaration of every fn of error_reporting/** and diagnostics{.rs,/note_and_explain.rs} (377), each under
// `// <file>:<line>` (the line of its `fn` keyword at the pin), grouped by file in upstream order with the lane that ports it
// (docs/handoff/errctxt-contract.md "Split table"; fulfillment_errors.rs and suggestions.rs are split at a line).
// - `class TypeErrCtxt` (all fields in declaration order) + `interface TypeErrCtxt`: every `impl TypeErrCtxt` method of the
//   crate (the `#[extension]`-free inherent impls of 13 files) and `Deref<Target = InferCtxt>`. The methods are assigned
//   onto `TypeErrCtxt.prototype` by the file that ports them; until then that file's stub module installs `unported`
//   placeholders (`rustc_trait_selection::error_reporting::<module>::TypeErrCtxt::<name>`).
// - Deref (PORTING §8, as rustc_hir_typeck's `FnCtxt -> TypeckRootCtxt -> InferCtxt`): the field `infcx` plus forwarders
//   (rust_ts/deref.ts `register_deref(TypeErrCtxt, "infcx", InferCtxt)`, installed by ../lib.ts): inside a `TypeErrCtxt`
//   method `self.tcx`, `self.next_ty_var(..)`, `self.resolve_vars_if_possible(..)`, `self.probe(..)`, `self.can_eq(..)`
//   read through them (`this.tcx`, ...). A deref *coercion* (`&TypeErrCtxt` passed where `&InferCtxt` is expected, e.g.
//   `fmt_printer(self, ns)`) is written `this.infcx`: `TypeErrCtxt` omits `TypeErrCtxt_shadowed`, so it is not
//   structurally an `InferCtxt`.
// - `NiceRegionError` (hand class, nice_region_error/mod.ts; field `regions` is `regions_`: the method `regions()` has the
//   same name) and the `ObligationCauseExt` extension trait on rustc_middle's `ObligationCause` (error_reporting/infer/mod.rs).
// - `interface Fns_<module>`: the free fns of each module (the stub module exports them with these signatures).
// - Comment-only declarations: trait impls (visitors, folders, `IntoDiagArg`, `Subdiagnostic`, ...), nested fns and the
//   methods of single-file helper types; informative, the owning lane picks the TS form (PORTING §5; precedent
//   rustc_hir_typeck decls.ts).
// Signature rules: as ../rustc_hir_typeck/decls.ts (`&mut Option<PathBuf>` `long_ty_path` -> `MutRef<PathBuf | undefined>`;
// `T: Upcast<TyCtxt, Predicate>` adds `upcast_from_T` last, `T: TypeFoldable` / `Relate` / `Display` add `d_T` / `display_T`;
// `&mut Diag` is `Diag`; `TypeAnnotationNeeded` is need_type_info.ts's string union).
// =====================================================================================================================

import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type { CustomDiagnostic, Directive, FilterOptions, FormatArgs } from "../rustc_attr_ir/diagnostic.ts";
import type { Applicability, Diag, DiagCtxtHandle, DiagStyledString, IntoMultiSpan } from "../rustc_errors/lib.ts";
import type { Namespace } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { RegionVariableOrigin, SubregionOrigin, TypeTrace, ValuePairs } from "../rustc_infer/infer/mod.ts";
import type { GenericKind } from "../rustc_infer/infer/region_constraints/mod.ts";
import type { MismatchedProjectionTypes } from "../rustc_infer/traits/project.gen.ts";
import type { Place } from "../rustc_middle/hir/place.ts";
import type { DynCompatibilityViolation, ImplDerivedCause, ObligationCauseCode, PatternOriginExpr } from "../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { ParamEnvAnd, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { FmtPrinter, RegionHighlightMode } from "../rustc_middle/ty/print/pretty.ts";
import type { UpvarArgs } from "../rustc_middle/ty/sty.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { CrateNum, DefIdSet } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, PathBuf, Span } from "../rustc_span/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import type { OpaqueTypeKey, PolyFnSig } from "../rustc_type_ir/decls.ts";
import type { ExpectedFound, TypeError } from "../rustc_type_ir/error.ts";
import type { ClosureKind } from "../rustc_type_ir/lib.ts";
import type { BoundConstness, ClausePolarity, HostEffectClause, ProjectionClause } from "../rustc_type_ir/predicate.ts";
import type { Relate } from "../rustc_type_ir/relate.ts";
import type { AliasTerm, AliasTy, ProjectionAliasTy } from "../rustc_type_ir/ty/alias.ts";
import type { TypeVisitable } from "../rustc_type_ir/visit.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type {
  ActualImplExplNotes,
  AddPreciseCapturingForOvercapture,
  ObligationCauseFailureCode,
  SuggestRemoveSemiOrReturnBinding,
  TypeErrorAdditionalDiags,
} from "./diagnostics.gen.ts";
import type { FailureCode } from "./error_reporting/infer/mod.gen.ts";
import type { InferenceDiagnosticsData, TypeAnnotationNeeded } from "./error_reporting/infer/need_type_info.ts";
import type { NiceRegionError } from "./error_reporting/infer/nice_region_error/mod.ts";
import type { AnonymousParamInfo } from "./error_reporting/infer/nice_region_error/util.gen.ts";
import type { StatementAsExpression, SuggestAsRefKind } from "./error_reporting/infer/suggest.gen.ts";
import type { CandidateSource } from "./error_reporting/traits/ambiguity.gen.ts";
import type { CallKind } from "./error_reporting/traits/call_kind.gen.ts";
import type { ArgKind, CandidateSimilarity, DefIdOrName, GetSafeTransmuteErrorAndReason, ImplCandidate } from "./error_reporting/traits/mod.gen.ts";
import type { OverflowCause } from "./error_reporting/traits/overflow.gen.ts";
import type { CoroutineInteriorOrUpvar, PeeledRef } from "./error_reporting/traits/suggestions.gen.ts";

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/mod.rs:20 TypeErrCtxt
/// A helper for building type related errors. The `typeck_results`
/// field is only populated during an in-progress typeck.
/// Get an instance by calling `InferCtxt::err_ctxt` or `FnCtxt::err_ctxt`.
///
/// You must only create this if you intend to actually emit an error (or
/// perhaps a warning, though preferably not.) It provides a lot of utility
/// methods which should not be used during the happy path.
// PORT: `typeck_results: Option<Ref<TypeckResults>>` is the `TypeckResults` itself (PORTING §5, `RefCell`). The boxed
// closures are plain functions.
export class TypeErrCtxt {
  constructor(
    public infcx: InferCtxt,
    public param_env: ParamEnv | undefined,

    public typeck_results: TypeckResults | undefined,
    public diverging_fallback_has_occurred: boolean,

    public autoderef_steps: (ty: Ty) => [Ty, PredicateObligations][],
    public infer_closure_kind: (def_id: LocalDefId) => [ClosureKind, [Span, Place] | undefined] | undefined,
  ) {}

  // error_reporting/traits/fulfillment_errors.rs:1567 (lane errrep-traits-b)
  declare static as_host_effect_clause: (predicate: Predicate) => Binder<HostEffectClause> | undefined;
}

/**
 * `TypeErrCtxt`'s own members that shadow `InferCtxt`'s (`dcx`, the deprecated `err_ctxt`), plus `drop`, so that a
 * `TypeErrCtxt` is not structurally an `InferCtxt` (a deref coercion is written `this.infcx`).
 */
export type TypeErrCtxt_shadowed = "dcx" | "err_ctxt" | "drop";

export interface TypeErrCtxt extends Omit<InferCtxt, TypeErrCtxt_shadowed> {
  // ---- error_reporting/mod.rs (lane errctxt-contract) ----
  // error_reporting/mod.rs:58
  dcx(): DiagCtxtHandle;
  // error_reporting/mod.rs:66 (`#[deprecated]`, `-> !`)
  err_ctxt(): never;
  // error_reporting/mod.rs:73
  deref(): InferCtxt;
  // ---- error_reporting/mod.rs (lane errctxt-contract) ----
  // error_reporting/mod.rs:58
  dcx(): DiagCtxtHandle;
  // error_reporting/mod.rs:66
  err_ctxt(): never;
  // ---- error_reporting/infer/mod.rs (lane errrep-infer-a) ----
  // error_reporting/infer/mod.rs:118
  normalize_fn_sig(fn_sig: Unnormalized<PolyFnSig>): PolyFnSig;
  // error_reporting/infer/mod.rs:153 (PORT: generic bounds are descriptor parameters, last)
  type_error_struct_with_diag(sp: Span, mk_diag: (_0: string) => Diag, actual_ty: Ty): Diag;
  // error_reporting/infer/mod.rs:175
  report_mismatched_types(cause: ObligationCause, param_env: ParamEnv, expected: Ty, actual: Ty, err: TypeError): Diag;
  // error_reporting/infer/mod.rs:194
  report_mismatched_consts(cause: ObligationCause, param_env: ParamEnv, expected: Const, actual: Const, err: TypeError): Diag;
  // error_reporting/infer/mod.rs:210
  check_and_note_conflicting_crates(err: Diag, terr: TypeError): boolean;
  // error_reporting/infer/mod.rs:241
  suggest_param_env_shadowing(diag: Diag, expected: Ty, found: Ty, param_env: ParamEnv): void;
  // error_reporting/infer/mod.rs:326
  note_error_origin(err: Diag, cause: ObligationCause, exp_found: ExpectedFound<Ty> | undefined, terr: TypeError, param_env: ParamEnv | undefined): void;
  // error_reporting/infer/mod.rs:594
  should_deref_suggestion_on_mismatch(param_env: ParamEnv, deref_to: Ty, deref_from: Ty, origin_expr: PatternOriginExpr): string | undefined;
  // error_reporting/infer/mod.rs:644
  highlight_outer(value: DiagStyledString, other_value: DiagStyledString, name: string, args: readonly GenericArg[], pos: number, other_ty: Ty): void;
  // error_reporting/infer/mod.rs:712
  cmp_type_arg(t1_out: DiagStyledString, t2_out: DiagStyledString, path: string, args: readonly GenericArg[], other_path: string, other_ty: Ty): boolean;
  // error_reporting/infer/mod.rs:740
  push_comma(value: DiagStyledString, other_value: DiagStyledString, pos: number): void;
  // error_reporting/infer/mod.rs:753
  cmp_fn_sig(sig1: PolyFnSig, fn_def1: [DefId, readonly GenericArg[] | undefined] | undefined, sig2: PolyFnSig, fn_def2: [DefId, readonly GenericArg[] | undefined] | undefined): [DiagStyledString, DiagStyledString];
  // error_reporting/infer/mod.rs:913
  cmp_traits(def_id1: DefId, args1: readonly GenericArg[], def_id2: DefId, args2: readonly GenericArg[]): [DiagStyledString, DiagStyledString];
  // error_reporting/infer/mod.rs:974
  lifetime_display(lifetime: Region): string;
  // error_reporting/infer/mod.rs:979
  compare_generics(values: [DiagStyledString, DiagStyledString], sub1: readonly GenericArg[], sub2: readonly GenericArg[]): void;
  // error_reporting/infer/mod.rs:1097
  recurse(t1: Ty, t2: Ty, values: [DiagStyledString, DiagStyledString]): void;
  // error_reporting/infer/mod.rs:1108 (PORT: generic bounds are descriptor parameters, last)
  maybe_highlight<T>(t1: T, t2: T, _2: [DiagStyledString, DiagStyledString], tcx: TyCtxt, to_string_T: (t: T) => string): void;
  // error_reporting/infer/mod.rs:1128
  cmp(t1: Ty, t2: Ty): [DiagStyledString, DiagStyledString];
  // error_reporting/infer/mod.rs:1462
  note_type_err(diag: Diag, cause: ObligationCause, secondary_span: [Span, string, boolean] | undefined, values: ParamEnvAnd<ValuePairs> | undefined, terr: TypeError, prefer_label: boolean, override_span: Span | undefined): void;
  // error_reporting/infer/mod.rs:1984
  type_error_additional_suggestions(trace: TypeTrace, terr: TypeError, long_ty_path: MutRef<PathBuf | undefined>): TypeErrorAdditionalDiags[];
  // error_reporting/infer/mod.rs:2076
  suggest_specify_actual_length(terr: TypeError, trace: TypeTrace, span: Span): TypeErrorAdditionalDiags | undefined;
  // error_reporting/infer/mod.rs:2135
  check_on_type_error_attribute(expected_ty: Ty, found_ty: Ty): string[];
  // error_reporting/infer/mod.rs:2188
  format_on_type_error_notes(directive: Directive, args: GenericArgs, item_def: AdtDef, expected_ty: Ty, found_ty: Ty): string[];
  // error_reporting/infer/mod.rs:2217
  report_and_explain_type_error(trace: TypeTrace, param_env: ParamEnv, terr: TypeError): Diag;
  // error_reporting/infer/mod.rs:2265
  simplify_pin_macro_arg_ty_mismatch(trace: TypeTrace): void;
  // error_reporting/infer/mod.rs:2295
  suggest_wrap_to_build_a_tuple(span: Span, found: Ty, expected_fields: List<Ty>): TypeErrorAdditionalDiags | undefined;
  // error_reporting/infer/mod.rs:2323
  values_str(values: ValuePairs, cause: ObligationCause, long_ty_path: MutRef<PathBuf | undefined>): [DiagStyledString, DiagStyledString] | undefined;
  // error_reporting/infer/mod.rs:2368
  expected_found_str_term(exp_found: ExpectedFound<Term>, long_ty_path: MutRef<PathBuf | undefined>): [DiagStyledString, DiagStyledString] | undefined;
  // error_reporting/infer/mod.rs:2441 (PORT: generic bounds are descriptor parameters, last)
  expected_found_str<T>(exp_found: ExpectedFound<T>, display_T: (t: T) => string, d_T: TypeFoldable<T>): [DiagStyledString, DiagStyledString] | undefined;
  // error_reporting/infer/mod.rs:2459
  is_try_conversion(span: Span, trait_def_id: DefId): boolean;
  // error_reporting/infer/mod.rs:2470 (PORT: generic bounds are descriptor parameters, last)
  same_type_modulo_infer<T>(a: T, b: T, d_T: Relate<T>): boolean;
  // ---- error_reporting/infer/need_type_info.rs (lane errrep-need-type-info) ----
  // error_reporting/infer/need_type_info.rs:368
  extract_inference_diagnostics_data(term: Term, highlight: RegionHighlightMode): InferenceDiagnosticsData;
  // error_reporting/infer/need_type_info.rs:442
  bad_inference_failure_err(span: Span, arg_data: InferenceDiagnosticsData, error_code: TypeAnnotationNeeded): Diag;
  // error_reporting/infer/need_type_info.rs:482
  emit_inference_failure_err(body_def_id: LocalDefId, failure_span: Span, term: Term, error_code: TypeAnnotationNeeded, should_label_span: boolean): Diag;
  // error_reporting/infer/need_type_info.rs:500
  emit_inference_failure_err_with_type_hint(body_def_id: LocalDefId, failure_span: Span, term: Term, error_code: TypeAnnotationNeeded, should_label_span: boolean, ty: Ty | undefined): Diag;
  // ---- error_reporting/infer/note_and_explain.rs (lane errrep-infer-b) ----
  // error_reporting/infer/note_and_explain.rs:20
  note_and_explain_type_err(diag: Diag, err: TypeError, cause: ObligationCause, sp: Span, body_owner_def_id: DefId | undefined): void;
  // error_reporting/infer/note_and_explain.rs:633
  suggest_constraint(diag: Diag, msg: () => string, body_owner_def_id: DefId | undefined, alias_ty: AliasTy, ty: Ty): boolean;
  // error_reporting/infer/note_and_explain.rs:711
  expected_projection(diag: Diag, proj_ty: AliasTy, values: ExpectedFound<Ty>, body_owner_def_id: DefId | undefined, cause_code: ObligationCauseCode): void;
  // error_reporting/infer/note_and_explain.rs:827
  suggest_constraining_opaque_associated_type(diag: Diag, msg: () => string, proj_ty: AliasTy, ty: Ty): boolean;
  // error_reporting/infer/note_and_explain.rs:868
  point_at_methods_that_satisfy_associated_type(diag: Diag, assoc_container_id: DefId, current_method_ident: Symbol | undefined, proj_ty_item_def_id: DefId, expected: Ty): boolean;
  // error_reporting/infer/note_and_explain.rs:925
  point_at_associated_type(diag: Diag, body_owner_def_id: DefId | undefined, found: Ty): boolean;
  // error_reporting/infer/note_and_explain.rs:983
  constrain_generic_bound_associated_type_structured_suggestion(diag: Diag, trait_ref: TraitRef, bounds: hir.GenericBounds, assoc: AssocItem, assoc_args: readonly GenericArg[], ty: Ty, msg: () => string, is_bound_surely_present: boolean): boolean;
  // error_reporting/infer/note_and_explain.rs:1022
  constrain_associated_type_structured_suggestion(diag: Diag, span: Span, assoc: AssocItem, assoc_args: readonly GenericArg[], ty: Ty, msg: () => string): boolean;
  // error_reporting/infer/note_and_explain.rs:1050
  format_generic_args(args: readonly GenericArg[]): string;
  // ---- error_reporting/infer/region.rs (lane errrep-region) ----
  // error_reporting/infer/region.rs:36
  report_region_errors(generic_param_scope: LocalDefId, errors: readonly RegionResolutionError[]): ErrorGuaranteed;
  // error_reporting/infer/region.rs:180
  process_errors(errors: readonly RegionResolutionError[]): RegionResolutionError[];
  // error_reporting/infer/region.rs:228
  note_region_origin(err: Diag, origin: SubregionOrigin): void;
  // error_reporting/infer/region.rs:311
  report_concrete_failure(generic_param_scope: LocalDefId, origin: SubregionOrigin, sub: Region, sup: Region): Diag;
  // error_reporting/infer/region.rs:586
  suggest_copy_trait_method_bounds(trait_item_def_id: DefId, impl_item_def_id: LocalDefId, err: Diag): void;
  // error_reporting/infer/region.rs:644
  report_placeholder_failure(generic_param_scope: LocalDefId, placeholder_origin: SubregionOrigin, sub: Region, sup: Region): Diag;
  // error_reporting/infer/region.rs:703
  report_generic_bound_failure(generic_param_scope: LocalDefId, span: Span, origin: SubregionOrigin | undefined, bound_kind: GenericKind, sub: Region): ErrorGuaranteed;
  // error_reporting/infer/region.rs:715
  construct_generic_bound_failure(generic_param_scope: LocalDefId, span: Span, origin: SubregionOrigin | undefined, bound_kind: GenericKind, sub: Region): Diag;
  // error_reporting/infer/region.rs:931
  suggest_name_region(generic_param_scope: LocalDefId, lifetime: Region, add_lt_suggs: [Span, string][]): string;
  // error_reporting/infer/region.rs:1005
  report_sub_sup_conflict(generic_param_scope: LocalDefId, var_origin: RegionVariableOrigin, sub_origin: SubregionOrigin, sub_region: Region, sup_origin: SubregionOrigin, sup_region: Region): ErrorGuaranteed;
  // error_reporting/infer/region.rs:1083
  report_inference_failure(var_origin: RegionVariableOrigin): Diag;
  // ---- error_reporting/infer/suggest.rs (lane errrep-infer-b) ----
  // error_reporting/infer/suggest.rs:41
  suggest_remove_semi_or_return_binding(first_id: HirId | undefined, first_ty: Ty, first_span: Span, second_id: HirId | undefined, second_ty: Ty, second_span: Span): SuggestRemoveSemiOrReturnBinding | undefined;
  // error_reporting/infer/suggest.rs:88
  suggest_tuple_pattern(cause: ObligationCause, exp_found: ExpectedFound<Ty>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:165
  suggest_await_on_expect_found(cause: ObligationCause, exp_span: Span, exp_found: ExpectedFound<Ty>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:275
  suggest_add_async_for_tail_return_expr(cause: ObligationCause, exp_span: Span, exp_found: ExpectedFound<Ty>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:333
  suggest_accessing_field_where_appropriate(cause: ObligationCause, exp_found: ExpectedFound<Ty>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:370
  suggest_turning_stmt_into_expr(cause: ObligationCause, exp_found: ExpectedFound<Ty>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:434
  consider_removing_semicolon(blk: hir.Block, expected_ty: Ty, diag: Diag): boolean;
  // error_reporting/infer/suggest.rs:462
  suggest_function_pointers_impl(span: Span | undefined, exp_found: ExpectedFound<Ty>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:590
  suggest_function_pointers(cause: ObligationCause, span: Span, exp_found: ExpectedFound<Ty>, terr: TypeError, diag: Diag): void;
  // error_reporting/infer/suggest.rs:607
  should_suggest_as_ref_kind(expected: Ty, found: Ty): SuggestAsRefKind | undefined;
  // error_reporting/infer/suggest.rs:651
  should_suggest_as_ref(expected: Ty, found: Ty): string | undefined;
  // error_reporting/infer/suggest.rs:667
  suggest_let_for_letchains(cause: ObligationCause, span: Span): TypeErrorAdditionalDiags | undefined;
  // error_reporting/infer/suggest.rs:720
  suggest_for_all_lifetime_closure(span: Span, hir: hir.Node, exp_found: ExpectedFound<TraitRef>, diag: Diag): void;
  // error_reporting/infer/suggest.rs:822
  could_remove_semicolon(blk: hir.Block, expected_ty: Ty): [Span, StatementAsExpression] | undefined;
  // error_reporting/infer/suggest.rs:912
  consider_returning_binding_diag(blk: hir.Block, expected_ty: Ty): SuggestRemoveSemiOrReturnBinding | undefined;
  // error_reporting/infer/suggest.rs:1020
  consider_returning_binding(blk: hir.Block, expected_ty: Ty, err: Diag): boolean;
  // ---- error_reporting/infer/nice_region_error/mod.rs (lane errrep-region) ----
  // error_reporting/infer/nice_region_error/mod.rs:25
  try_report_nice_region_error(generic_param_scope: LocalDefId, error: RegionResolutionError): ErrorGuaranteed | undefined;
  // ---- error_reporting/traits/mod.rs (lane errrep-traits-a) ----
  // error_reporting/traits/mod.rs:141
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
  // error_reporting/traits/mod.rs:394
  report_fulfillment_error(error: FulfillmentError, related: readonly FulfillmentError[]): ErrorGuaranteed;
  // error_reporting/traits/mod.rs:475
  extern_crates_with_the_same_name(expected_def_id: DefId, trait_def_id: DefId): boolean;
  // error_reporting/traits/mod.rs:506 (PORT: generic bounds are descriptor parameters, last)
  check_same_definition_different_crate(err: Diag, expected_did: DefId, found_dids: Iterable<DefId>, get_impls: (_0: DefId) => Span[], ty: string): boolean;
  // error_reporting/traits/mod.rs:657
  report_extra_impl_obligation(error_span: Span, impl_item_def_id: LocalDefId, trait_item_def_id: DefId, requirement: string): Diag;
  // ---- error_reporting/traits/ambiguity.rs (lane errrep-need-type-info) ----
  // error_reporting/traits/ambiguity.rs:184
  ambiguity_term(predicate: Predicate): Term | undefined;
  // error_reporting/traits/ambiguity.rs:207
  maybe_report_ambiguity(obligation: PredicateObligation, related: readonly FulfillmentError[]): ErrorGuaranteed;
  // error_reporting/traits/ambiguity.rs:791
  applicable_impls_to_mention(obligation: PredicateObligation, trait_pred: PolyTraitClause): CandidateSource[] | undefined;
  // error_reporting/traits/ambiguity.rs:823
  annotate_source_of_ambiguity(err: Diag, ambiguities: readonly CandidateSource[], predicate: Predicate): void;
  // ---- error_reporting/traits/fulfillment_errors.rs (lane errrep-traits-a) ----
  // error_reporting/traits/fulfillment_errors.rs:63
  report_selection_error(obligation: PredicateObligation, root_obligation: PredicateObligation, error: SelectionError): ErrorGuaranteed;
  // error_reporting/traits/fulfillment_errors.rs:842
  apply_do_not_recommend(obligation: PredicateObligation, root_obligation: PredicateObligation): boolean;
  // error_reporting/traits/fulfillment_errors.rs:876
  report_host_effect_error(clause: Binder<HostEffectClause>, main_obligation: PredicateObligation, span: Span): Diag;
  // error_reporting/traits/fulfillment_errors.rs:995
  emit_specialized_closure_kind_error(obligation: PredicateObligation, trait_pred: PolyTraitClause): ErrorGuaranteed | undefined;
  // error_reporting/traits/fulfillment_errors.rs:1114
  fn_arg_obligation(obligation: PredicateObligation): Result<undefined, ErrorGuaranteed>;
  // error_reporting/traits/fulfillment_errors.rs:1134
  detect_negative_literal(obligation: PredicateObligation, trait_pred: PolyTraitClause, err: Diag): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1169
  try_conversion_context(obligation: PredicateObligation, trait_pred: PolyTraitClause, err: Diag): [boolean, boolean];
  // error_reporting/traits/fulfillment_errors.rs:1379
  note_missing_impl_for_question_mark(err: Diag, self_ty: Ty, found_ty: Ty | undefined, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1427
  report_const_param_not_wf(ty: Ty, obligation: PredicateObligation): Diag;
  // ---- error_reporting/traits/fulfillment_errors.rs (lane errrep-traits-b) ----
  // error_reporting/traits/fulfillment_errors.rs:1531
  can_match_trait(param_env: ParamEnv, goal: TraitClause, assumption: PolyTraitClause): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1551
  can_match_host_effect(param_env: ParamEnv, goal: HostEffectClause, assumption: Binder<HostEffectClause>): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1576
  can_match_projection(param_env: ParamEnv, goal: ProjectionClause, assumption: PolyProjectionClause): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1595
  error_implies(cond: Goal<Predicate>, error: Goal<Predicate>): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1638
  trait_error_implies_projection_error(cond: Goal<Predicate>, error: Goal<Predicate>): boolean;
  // error_reporting/traits/fulfillment_errors.rs:1675
  report_projection_error(obligation: PredicateObligation, error: MismatchedProjectionTypes): ErrorGuaranteed;
  // error_reporting/traits/fulfillment_errors.rs:1916
  maybe_detailed_projection_msg(span: Span, projection_term: AliasTerm, normalized_ty: Term, expected_ty: Term, long_ty_path: MutRef<PathBuf | undefined>): [string, Span, Span | undefined] | undefined;
  // error_reporting/traits/fulfillment_errors.rs:1996
  fuzzy_match_tys(a: Ty, b: Ty, ignoring_lifetimes: boolean): CandidateSimilarity | undefined;
  // error_reporting/traits/fulfillment_errors.rs:2077
  describe_closure(kind: hir.ClosureKind): string;
  // error_reporting/traits/fulfillment_errors.rs:2127
  find_similar_impl_candidates(trait_def_id: DefId, self_ty: Ty): ImplCandidate[];
  // error_reporting/traits/fulfillment_errors.rs:2158
  report_similar_impl_candidates(impl_candidates: readonly ImplCandidate[], obligation: PredicateObligation, trait_pred: PolyTraitClause, body_def_id: LocalDefId, err: Diag, other: boolean, param_env: ParamEnv): boolean;
  // error_reporting/traits/fulfillment_errors.rs:2749
  report_similar_impl_candidates_for_root_obligation(obligation: PredicateObligation, trait_predicate: Binder<TraitClause>, body_def_id: LocalDefId, err: Diag): void;
  // error_reporting/traits/fulfillment_errors.rs:2796
  get_parent_trait_ref(code: ObligationCauseCode): [Ty, Span | undefined] | undefined;
  // error_reporting/traits/fulfillment_errors.rs:2820
  check_same_trait_different_version(err: Diag, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/fulfillment_errors.rs:2847
  note_two_crate_versions(krate: CrateNum, sp: IntoMultiSpan, err: Diag): void;
  // error_reporting/traits/fulfillment_errors.rs:2860
  note_adt_version_mismatch(err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/fulfillment_errors.rs:2918
  check_same_name_different_path(err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/fulfillment_errors.rs:2980
  note_different_trait_with_same_name(err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/fulfillment_errors.rs:2994
  comparable_path(did: DefId): string;
  // error_reporting/traits/fulfillment_errors.rs:3002
  mk_trait_obligation_with_new_self_ty(param_env: ParamEnv, trait_ref_and_ty: Binder<[TraitClause, Ty]>): PredicateObligation;
  // error_reporting/traits/fulfillment_errors.rs:3015
  predicate_can_apply<T>(param_env: ParamEnv, pred: T, upcast_from_T: (from: T, tcx: Interner) => Predicate, d_T: TypeFoldable<T>): boolean;
  // error_reporting/traits/fulfillment_errors.rs:3070
  suggest_change_mut_ref_for_closure(err: Diag, obligation: PredicateObligation): void;
  // error_reporting/traits/fulfillment_errors.rs:3092
  silence_redundant_cause(err: Diag, obligation: PredicateObligation, root_obligation: PredicateObligation): void;
  // error_reporting/traits/fulfillment_errors.rs:3144
  note_obligation_cause(err: Diag, obligation: PredicateObligation): void;
  // error_reporting/traits/fulfillment_errors.rs:3185
  is_recursive_obligation(obligated_types: Ty[], cause_code: ObligationCauseCode): boolean;
  // error_reporting/traits/fulfillment_errors.rs:3208
  get_standard_error_message(trait_predicate: PolyTraitClause, predicate_constness: BoundConstness | undefined, post_message: string, long_ty_path: MutRef<PathBuf | undefined>): string;
  // error_reporting/traits/fulfillment_errors.rs:3224
  select_transmute_obligation_for_reporting(obligation: PredicateObligation, trait_predicate: PolyTraitClause, root_obligation: PredicateObligation): [PredicateObligation, PolyTraitClause];
  // error_reporting/traits/fulfillment_errors.rs:3271
  get_safe_transmute_error_and_reason(obligation: PredicateObligation, trait_pred: PolyTraitClause, span: Span): GetSafeTransmuteErrorAndReason;
  // error_reporting/traits/fulfillment_errors.rs:3404
  find_explicit_cast_type(param_env: ParamEnv, found_ty: Ty, self_ty: Ty): Ty | undefined;
  // error_reporting/traits/fulfillment_errors.rs:3450
  has_impl_for_type(param_env: ParamEnv, trait_ref: TraitRef): boolean;
  // error_reporting/traits/fulfillment_errors.rs:3465
  add_tuple_trait_message(obligation_cause_code: ObligationCauseCode, err: Diag): void;
  // error_reporting/traits/fulfillment_errors.rs:3485
  try_to_add_help_message(root_obligation: PredicateObligation, obligation: PredicateObligation, trait_predicate: PolyTraitClause, err: Diag, span: Span, is_fn_trait: boolean, suggested: boolean): void;
  // error_reporting/traits/fulfillment_errors.rs:3574
  add_help_message_for_fn_trait(trait_pred: PolyTraitClause, err: Diag, implemented_kind: ClosureKind, params: Binder<Ty>): void;
  // error_reporting/traits/fulfillment_errors.rs:3643
  report_closure_error(obligation: PredicateObligation, closure_def_id: DefId, found_kind: ClosureKind, kind: ClosureKind, trait_prefix: string, kind_origin: [Span, Place] | undefined): Diag;
  // error_reporting/traits/fulfillment_errors.rs:3693
  report_cyclic_signature_error(obligation: PredicateObligation, found_trait_ref: TraitRef, expected_trait_ref: TraitRef, terr: TypeError): Diag;
  // error_reporting/traits/fulfillment_errors.rs:3716
  report_signature_mismatch_error(obligation: PredicateObligation, span: Span, found_trait_ref: TraitRef, expected_trait_ref: TraitRef): Result<Diag, ErrorGuaranteed>;
  // error_reporting/traits/fulfillment_errors.rs:3816
  get_fn_like_arguments(node: hir.Node): [Span, Span | undefined, ArgKind[]] | undefined;
  // error_reporting/traits/fulfillment_errors.rs:3886
  report_arg_count_mismatch(span: Span, found_span: Span | undefined, expected_args: ArgKind[], found_args: ArgKind[], is_closure: boolean, closure_arg_span: Span | undefined): Diag;
  // error_reporting/traits/fulfillment_errors.rs:4008
  type_implements_fn_trait(param_env: ParamEnv, ty: Binder<Ty>, polarity: ClausePolarity): Result<[ClosureKind, Binder<Ty>], undefined>;
  // error_reporting/traits/fulfillment_errors.rs:4048
  report_not_const_evaluatable_error(obligation: PredicateObligation, span: Span): Result<Diag, ErrorGuaranteed>;
  // ---- error_reporting/traits/on_unimplemented.rs (lane errrep-traits-a) ----
  // error_reporting/traits/on_unimplemented.rs:18
  describe_enclosure(def_id: LocalDefId): string | undefined;
  // error_reporting/traits/on_unimplemented.rs:35
  on_unimplemented_note(trait_pred: PolyTraitClause, obligation: PredicateObligation, long_ty_path: MutRef<PathBuf | undefined>): CustomDiagnostic;
  // error_reporting/traits/on_unimplemented.rs:61
  on_unimplemented_components(trait_pred: PolyTraitClause, obligation: PredicateObligation, long_ty_path: MutRef<PathBuf | undefined>, print_infer_ty_var: boolean): [FilterOptions, FormatArgs];
  // ---- error_reporting/traits/overflow.rs (lane errctxt-contract) ----
  // error_reporting/traits/overflow.rs:40
  report_overflow_error(cause: OverflowCause, span: Span, suggest_increasing_limit: boolean, mutate: (_0: Diag) => void): never;
  // error_reporting/traits/overflow.rs:52
  build_overflow_error(cause: OverflowCause, span: Span, suggest_increasing_limit: boolean): Diag;
  // error_reporting/traits/overflow.rs:134 (PORT: generic bounds are descriptor parameters, last)
  report_overflow_obligation<T>(obligation: Obligation<T>, suggest_increasing_limit: boolean, upcast_from_T: (from: T, tcx: Interner) => Predicate): never;
  // error_reporting/traits/overflow.rs:167
  report_overflow_obligation_cycle(cycle: readonly PredicateObligation[]): never;
  // error_reporting/traits/overflow.rs:181
  report_overflow_no_abort(obligation: PredicateObligation, suggest_increasing_limit: boolean): ErrorGuaranteed;
  // ---- error_reporting/traits/suggestions.rs (lane errrep-sugg-a) ----
  // error_reporting/traits/suggestions.rs:255
  note_field_shadowed_by_private_candidate_in_cause(err: Diag, cause: ObligationCause, param_env: ParamEnv): void;
  // error_reporting/traits/suggestions.rs:312
  note_field_shadowed_by_private_candidate(err: Diag, hir_id: HirId, param_env: ParamEnv): void;
  // error_reporting/traits/suggestions.rs:464
  suggest_restricting_param_bound(err: Diag, trait_pred: PolyTraitClause, associated_ty: [string, Ty] | undefined, body_def_id: LocalDefId): void;
  // error_reporting/traits/suggestions.rs:702
  suggest_dereferences(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:984
  get_closure_name(def_id: DefId, err: Diag, msg: string): Symbol | undefined;
  // error_reporting/traits/suggestions.rs:1017
  suggest_fn_call(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:1240
  suggest_cast_to_fn_pointer(obligation: PredicateObligation, err: Diag, leaf_trait_predicate: PolyTraitClause, main_trait_predicate: PolyTraitClause, span: Span): boolean;
  // error_reporting/traits/suggestions.rs:1299
  check_for_binding_assigned_block_without_tail_expression(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:1383
  suggest_add_clone_to_arg(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:1483
  extract_callable_info(body_def_id: LocalDefId, param_env: ParamEnv, found: Ty): [DefIdOrName, Ty, Ty[]] | undefined;
  // error_reporting/traits/suggestions.rs:1628
  where_clause_expr_matches_failed_self_ty(obligation: PredicateObligation, old_self_ty: Ty): boolean;
  // error_reporting/traits/suggestions.rs:1661
  suggest_add_reference_to_arg(obligation: PredicateObligation, err: Diag, poly_trait_pred: PolyTraitClause, has_custom_message: boolean): boolean;
  // error_reporting/traits/suggestions.rs:2109
  suggest_borrowing_for_object_cast(err: Diag, obligation: PredicateObligation, self_ty: Ty, target_ty: Ty): void;
  // error_reporting/traits/suggestions.rs:2146
  peel_expr_refs(expr: hir.Expr, ty: Ty): [PeeledRef[], hir.Param | undefined];
  // error_reporting/traits/suggestions.rs:2223
  suggest_remove_reference(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:2314
  suggest_remove_ref_from_param(param: hir.Param, err: Diag): boolean;
  // error_reporting/traits/suggestions.rs:2336
  suggest_remove_await(obligation: PredicateObligation, err: Diag): void;
  // ---- error_reporting/traits/suggestions.rs (lane errrep-sugg-b) ----
  // error_reporting/traits/suggestions.rs:2488
  suggest_change_mut(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:2571
  suggest_semicolon_removal(obligation: PredicateObligation, err: Diag, span: Span, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:2604
  removable_trailing_semicolon(block: hir.Block, obligation: PredicateObligation, trait_pred: PolyTraitClause): [hir.Stmt, hir.Expr, Ty] | undefined;
  // error_reporting/traits/suggestions.rs:2629
  emit_semicolon_removal_suggestion(err: Diag, trait_pred: PolyTraitClause, _2: [hir.Stmt, hir.Expr, Ty], applicability: Applicability): void;
  // error_reporting/traits/suggestions.rs:2660
  suggest_semicolon_removal_in_closure_arg(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:2765
  suggest_borrow_for_unsized_closure_return(body_def_id: LocalDefId, err: Diag, predicate: Predicate): void;
  // error_reporting/traits/suggestions.rs:2819
  return_type_span(obligation: PredicateObligation): Span | undefined;
  // error_reporting/traits/suggestions.rs:2832
  suggest_impl_trait(err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:2963
  report_closure_arg_mismatch(span: Span, found_span: Span | undefined, found: TraitRef, expected: TraitRef, cause: ObligationCauseCode, found_node: hir.Node | undefined, param_env: ParamEnv): Diag;
  // error_reporting/traits/suggestions.rs:3023
  note_conflicting_fn_args(err: Diag, cause: ObligationCauseCode, expected: Ty, found: Ty, param_env: ParamEnv): void;
  // error_reporting/traits/suggestions.rs:3181
  note_conflicting_closure_bounds(cause: ObligationCauseCode, err: Diag): void;
  // error_reporting/traits/suggestions.rs:3236
  suggest_fully_qualified_path(err: Diag, item_def_id: DefId, span: Span, trait_ref: DefId): void;
  // error_reporting/traits/suggestions.rs:3310
  maybe_note_obligation_cause_for_async_await(err: Diag, obligation: PredicateObligation): boolean;
  // error_reporting/traits/suggestions.rs:3542
  note_obligation_cause_for_async_await(err: Diag, interior_or_upvar_span: CoroutineInteriorOrUpvar, is_async: boolean, outer_coroutine: DefId | undefined, trait_pred: TraitClause, target_ty: Ty, obligation: PredicateObligation, next_code: ObligationCauseCode | undefined): void;
  // error_reporting/traits/suggestions.rs:3776
  note_closure_capture(err: Diag, closure_def_id: DefId, upvar_args: UpvarArgs, capture_ty: Ty | undefined): boolean;
  // error_reporting/traits/suggestions.rs:3838 (PORT: generic bounds are descriptor parameters, last)
  note_obligation_cause_code<T>(body_def_id: LocalDefId, err: Diag, predicate: T, param_env: ParamEnv, cause_code: ObligationCauseCode, obligated_types: Ty[], seen_requirements: DefIdSet, upcast_from_T: (from: T, tcx: Interner) => Predicate): void;
  // error_reporting/traits/suggestions.rs:3867 (PORT: generic bounds are descriptor parameters, last)
  note_obligation_cause_code_inner<T>(body_def_id: LocalDefId, err: Diag, predicate: T, param_env: ParamEnv, cause_code: ObligationCauseCode, obligated_types: Ty[], seen_requirements: DefIdSet, closure_capture_ty: MutRef<Ty | undefined>, upcast_from_T: (from: T, tcx: Interner) => Predicate): void;
  // ---- error_reporting/traits/suggestions.rs (lane errrep-sugg-c) ----
  // error_reporting/traits/suggestions.rs:5022
  suggest_await_before_try(err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClause, span: Span): void;
  // error_reporting/traits/suggestions.rs:5093
  suggest_floating_point_literal(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:5116
  can_suggest_derive(obligation: PredicateObligation, trait_pred: PolyTraitClause): boolean;
  // error_reporting/traits/suggestions.rs:5171
  suggest_derive(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:5199
  suggest_dereferencing_index(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:5254
  note_function_argument_obligation(body_def_id: LocalDefId, err: Diag, arg_hir_id: HirId, parent_code: ObligationCauseCode, param_env: ParamEnv, failed_pred: Predicate, call_hir_id: HirId): void;
  // error_reporting/traits/suggestions.rs:5493
  suggest_option_method_if_applicable(failed_pred: Predicate, param_env: ParamEnv, err: Diag, expr: hir.Expr): void;
  // error_reporting/traits/suggestions.rs:5568
  look_for_iterator_item_mistakes(assocs_in_this_method: readonly ([Span, [DefId, Ty]] | undefined)[], typeck_results: TypeckResults, type_diffs: readonly TypeError[], param_env: ParamEnv, path_segment: hir.PathSegment, args: readonly hir.Expr[], prev_ty: Ty, err: Diag): void;
  // error_reporting/traits/suggestions.rs:5717
  point_at_chain(expr: hir.Expr, typeck_results: TypeckResults, type_diffs: TypeError[], param_env: ParamEnv, err: Diag): void;
  // error_reporting/traits/suggestions.rs:5886
  probe_assoc_types_at_expr(type_diffs: readonly TypeError[], span: Span, prev_ty: Ty, body_id: HirId, param_env: ParamEnv): ([Span, [DefId, Ty]] | undefined)[];
  // error_reporting/traits/suggestions.rs:5966
  point_at_chain_in_return_position(body_def_id: LocalDefId, expr: hir.Expr, typeck_results: TypeckResults, param_env: ParamEnv, err: Diag): void;
  // error_reporting/traits/suggestions.rs:6060
  suggest_convert_to_slice(err: Diag, obligation: PredicateObligation, trait_pred: PolyTraitClause, candidate_impls: readonly ImplCandidate[], span: Span): void;
  // error_reporting/traits/suggestions.rs:6140
  suggest_tuple_wrapping(err: Diag, root_obligation: PredicateObligation, obligation: PredicateObligation): void;
  // error_reporting/traits/suggestions.rs:6172
  suggest_shadowed_inherent_method(err: Diag, obligation: PredicateObligation, trait_predicate: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:6245
  explain_hrtb_projection(diag: Diag, pred: PolyTraitClause, param_env: ParamEnv, cause: ObligationCause): void;
  // error_reporting/traits/suggestions.rs:6308
  suggest_desugaring_async_fn_in_trait(err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:6394
  ty_kind_suggestion(param_env: ParamEnv, ty: Ty): string | undefined;
  // error_reporting/traits/suggestions.rs:6463
  suggest_add_result_as_return_type(obligation: PredicateObligation, err: Diag, trait_pred: PolyTraitClause): void;
  // error_reporting/traits/suggestions.rs:6539
  suggest_unsized_bound_if_applicable(err: Diag, obligation: PredicateObligation): void;
  // error_reporting/traits/suggestions.rs:6627
  suggest_indirection_for_unsized(err: Diag, item: hir.Item, param: hir.GenericParam): boolean;
  // error_reporting/traits/suggestions.rs:6662 (PORT: generic bounds are descriptor parameters, last)
  suggest_swapping_lhs_and_rhs<T>(err: Diag, predicate: T, param_env: ParamEnv, cause_code: ObligationCauseCode, upcast_from_T: (from: T, tcx: Interner) => Predicate): void;
  // error_reporting/traits/suggestions.rs:6708
  is_truly_imperfect_derive(parent_trait_pred: PolyTraitClause, predicate: Predicate, param_env: ParamEnv): boolean;
}

declare module "./error_reporting/infer/nice_region_error/mod.ts" {
  interface NiceRegionError {
    // error_reporting/infer/nice_region_error/mod.rs:62 (lane errrep-region)
    tcx(): TyCtxt;
    // error_reporting/infer/nice_region_error/mod.rs:66 (lane errrep-region)
    try_report_from_nll(): Diag | undefined;
    // error_reporting/infer/nice_region_error/mod.rs:74 (lane errrep-region)
    try_report(): ErrorGuaranteed | undefined;
    // error_reporting/infer/nice_region_error/mod.rs:83 (lane errrep-region)
    regions(): [Span, Region, Region] | undefined;
    // error_reporting/infer/nice_region_error/different_lifetimes.rs:53 (lane errrep-region)
    try_report_anon_anon_conflict(): ErrorGuaranteed | undefined;
    // error_reporting/infer/nice_region_error/mismatched_static_lifetime.rs:21 (lane errrep-nice-region)
    try_report_mismatched_static_lifetime(): ErrorGuaranteed | undefined;
    // error_reporting/infer/nice_region_error/named_anon_conflict.rs:15 (lane errrep-region)
    try_report_named_anon_conflict(): Diag | undefined;
    // error_reporting/infer/nice_region_error/placeholder_error.rs:76 (lane errrep-nice-region)
    try_report_placeholder_conflict(): Diag | undefined;
    // error_reporting/infer/nice_region_error/placeholder_error.rs:205 (lane errrep-nice-region)
    try_report_trait_placeholder_mismatch(vid: Region | undefined, cause: ObligationCause, sub_placeholder: Region | undefined, sup_placeholder: Region | undefined, value_pairs: ValuePairs): Diag | undefined;
    // error_reporting/infer/nice_region_error/placeholder_error.rs:246 (lane errrep-nice-region)
    report_trait_placeholder_mismatch(vid: Region | undefined, cause: ObligationCause, sub_placeholder: Region | undefined, sup_placeholder: Region | undefined, trait_def_id: DefId, expected_args: GenericArgs, actual_args: GenericArgs): Diag;
    // error_reporting/infer/nice_region_error/placeholder_error.rs:506 (lane errrep-nice-region)
    explain_actual_impl_that_was_found(sub_placeholder: Region | undefined, sup_placeholder: Region | undefined, has_sub: number | undefined, has_sup: number | undefined, expected_trait_ref: TraitRef, actual_trait_ref: TraitRef, vid: Region | undefined, expected_has_vid: number | undefined, actual_has_vid: number | undefined, any_self_ty_has_vid: boolean, satisfy_span: Span | undefined, item_span: Span | undefined, outer_span: Span | undefined, item_name: string): ActualImplExplNotes[];
    // error_reporting/infer/nice_region_error/placeholder_relation.rs:12 (lane errrep-nice-region)
    try_report_placeholder_relation(): Diag | undefined;
    // error_reporting/infer/nice_region_error/static_impl_trait.rs:23 (lane errrep-nice-region)
    try_report_static_impl_trait(): ErrorGuaranteed | undefined;
    // error_reporting/infer/nice_region_error/trait_impl_difference.rs:24 (lane errrep-nice-region)
    try_report_impl_not_conforming_to_trait(): ErrorGuaranteed | undefined;
    // error_reporting/infer/nice_region_error/trait_impl_difference.rs:58 (lane errrep-nice-region)
    emit_err(sp: Span, expected: PolyFnSig, found: PolyFnSig, trait_item_def_id: DefId, impl_item_def_id: DefId): ErrorGuaranteed;
    // error_reporting/infer/nice_region_error/util.rs:112 (lane errrep-region)
    find_param_with_region(anon_region: Region, replace_region: Region): AnonymousParamInfo | undefined;
    // error_reporting/infer/nice_region_error/util.rs:123 (lane errrep-region)
    is_return_type_anon(scope_def_id: LocalDefId, region_def_id: DefId, hir_sig: hir.FnSig): Span | undefined;
    // error_reporting/infer/nice_region_error/util.rs:148 (lane errrep-region)
    includes_region<T>(ty: Binder<T>, region_def_id: DefId, d_T: TypeFoldable<T>): boolean;
    // error_reporting/infer/nice_region_error/util.rs:166 (lane errrep-region)
    is_self_anon(is_first: boolean, scope_def_id: LocalDefId): boolean;
  }
  namespace NiceRegionError {
    // error_reporting/infer/nice_region_error/mod.rs:44 (lane errrep-region)
    function new_(cx: TypeErrCtxt, generic_param_scope: LocalDefId, error: RegionResolutionError): NiceRegionError;
    export { new_ as new };
    // error_reporting/infer/nice_region_error/mod.rs:52 (lane errrep-region)
    function new_from_span(cx: TypeErrCtxt, generic_param_scope: LocalDefId, span: Span, sub: Region, sup: Region): NiceRegionError;
    // error_reporting/infer/nice_region_error/static_impl_trait.rs:350 (lane errrep-nice-region)
    function get_impl_ident_and_self_ty_from_trait(tcx: TyCtxt, def_id: DefId, trait_objects: DefIdSet): [Ident, hir.Ty] | undefined;
  }
}

declare module "../rustc_middle/traits/mod.gen.ts" {
  interface ObligationCause {
    // ---- error_reporting/infer/mod.rs: `#[extension(pub trait ObligationCauseExt)] impl ObligationCause` (lane errrep-infer-a) ----
    // error_reporting/infer/mod.rs:2572
    as_failure_code(terr: TypeError): FailureCode;
    // error_reporting/infer/mod.rs:2599
    as_failure_code_diag(terr: TypeError, span: Span, subdiags: TypeErrorAdditionalDiags[]): ObligationCauseFailureCode;
    // error_reporting/infer/mod.rs:2668
    as_requirement_str(): string;
  }
}

/** The free fns of error_reporting/infer/mod.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_mod {
  // error_reporting/infer/mod.rs:97 (lane errrep-infer-a)
  escape_literal(s: string): string;
}
/** The free fns of error_reporting/infer/need_type_info.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_need_type_info {
  // error_reporting/infer/need_type_info.rs:270 (lane errrep-need-type-info)
  fmt_printer(infcx: InferCtxt, ns: Namespace): FmtPrinter;
  // error_reporting/infer/need_type_info.rs:304 (lane errrep-need-type-info)
  ty_to_string(infcx: InferCtxt, ty: Ty, called_method_def_id: DefId | undefined): string;
  // error_reporting/infer/need_type_info.rs:339 (lane errrep-need-type-info)
  closure_as_fn_str(infcx: InferCtxt, ty: Ty): string;
}
/** The free fns of error_reporting/infer/region.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_region {
  // error_reporting/infer/region.rs:1145 (lane errrep-region)
  note_and_explain_region(tcx: TyCtxt, err: Diag, generic_param_scope: LocalDefId, prefix: string, region: Region, suffix: string, alt_span: Span | undefined): void;
  // error_reporting/infer/region.rs:1172 (lane errrep-region)
  explain_free_region(tcx: TyCtxt, err: Diag, generic_param_scope: LocalDefId, prefix: string, region: Region, suffix: string): void;
  // error_reporting/infer/region.rs:1185 (lane errrep-region)
  msg_span_from_named_region(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region, alt_span: Span | undefined): [string, Span | undefined];
  // error_reporting/infer/region.rs:1246 (lane errrep-region)
  emit_msg_span(err: Diag, prefix: string, description: string, span: Span | undefined, suffix: string): void;
  // error_reporting/infer/region.rs:1262 (lane errrep-region)
  label_msg_span(err: Diag, prefix: string, description: string, span: Span | undefined, suffix: string): void;
  // error_reporting/infer/region.rs:1279 (lane errrep-region)
  unexpected_hidden_region_diagnostic(infcx: InferCtxt, generic_param_scope: LocalDefId, span: Span, hidden_ty: Ty, hidden_region: Region, opaque_ty_key: OpaqueTypeKey): Diag;
  // error_reporting/infer/region.rs:1369 (lane errrep-region)
  suggest_precise_capturing(tcx: TyCtxt, opaque_def_id: LocalDefId, captured_lifetime: Region, diag: Diag): void;
}
/** The free fns of error_reporting/infer/nice_region_error/different_lifetimes.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_nice_region_error_different_lifetimes {
  // error_reporting/infer/nice_region_error/different_lifetimes.rs:133 (lane errrep-region)
  suggest_adding_lifetime_params(tcx: TyCtxt, err: Diag, generic_param_scope: LocalDefId, sub: Region, ty_sup: hir.Ty, ty_sub: hir.Ty): void;
}
/** The free fns of error_reporting/infer/nice_region_error/find_anon_type.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_nice_region_error_find_anon_type {
  // error_reporting/infer/nice_region_error/find_anon_type.rs:26 (lane errrep-region)
  find_anon_type(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region): [hir.Ty, hir.FnSig] | undefined;
  // error_reporting/infer/nice_region_error/find_anon_type.rs:44 (lane errrep-region)
  find_component_for_bound_region(tcx: TyCtxt, arg: hir.Ty, region_def_id: DefId): hir.Ty | undefined;
}
/** The free fns of error_reporting/infer/nice_region_error/static_impl_trait.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_nice_region_error_static_impl_trait {
  // error_reporting/infer/nice_region_error/static_impl_trait.rs:137 (lane errrep-nice-region)
  suggest_new_region_bound(tcx: TyCtxt, err: Diag, fn_returns: hir.Ty[], lifetime_name: string, arg: string | undefined, captures: string, param: [Span, string] | undefined, scope_def_id: LocalDefId | undefined): void;
  // error_reporting/infer/nice_region_error/static_impl_trait.rs:298 (lane errrep-nice-region)
  make_elided_region_spans_suggs(name: string, generic_params: Iterable<hir.GenericParam>): [Span, string][];
}
/** The free fns of error_reporting/infer/nice_region_error/util.rs (exported by its stub module). */
export interface Fns_error_reporting_infer_nice_region_error_util {
  // error_reporting/infer/nice_region_error/util.rs:41 (lane errrep-region)
  find_param_with_region(tcx: TyCtxt, generic_param_scope: LocalDefId, anon_region: Region, replace_region: Region): AnonymousParamInfo | undefined;
}
/** The free fns of error_reporting/traits/mod.rs (exported by its stub module). */
export interface Fns_error_reporting_traits_mod {
  // error_reporting/traits/mod.rs:569 (lane errrep-traits-a)
  to_pretty_impl_header(tcx: TyCtxt, impl_def_id: DefId): string | undefined;
  // error_reporting/traits/mod.rs:684 (lane errrep-traits-a)
  report_dyn_incompatibility(tcx: TyCtxt, span: Span, hir_id: HirId | undefined, trait_def_id: DefId, violations: readonly DynCompatibilityViolation[]): Diag;
  // error_reporting/traits/mod.rs:775 (lane errrep-traits-a)
  attempt_dyn_to_enum_suggestion(tcx: TyCtxt, trait_def_id: DefId, trait_str: string, err: Diag): void;
  // error_reporting/traits/mod.rs:856 (lane errrep-traits-a)
  attempt_dyn_to_impl_suggestion(tcx: TyCtxt, hir_id: HirId | undefined, err: Diag): void;
}
/** The free fns of error_reporting/traits/ambiguity.rs (exported by its stub module). */
export interface Fns_error_reporting_traits_ambiguity {
  // error_reporting/traits/ambiguity.rs:33 (lane errrep-need-type-info)
  compute_applicable_impls_for_diagnostics(infcx: InferCtxt, obligation: PolyTraitObligation, ignore_predicates_of_impls: boolean): CandidateSource[];
}
/** The free fns of error_reporting/traits/call_kind.rs (exported by its stub module). */
export interface Fns_error_reporting_traits_call_kind {
  // error_reporting/traits/call_kind.rs:84 (lane errctxt-contract)
  call_kind(tcx: TyCtxt, typing_env: TypingEnv, method_did: DefId, method_args: GenericArgs, fn_call_span: Span, from_hir_call: boolean, self_arg: Ident | undefined): CallKind;
}
/** The free fns of error_reporting/traits/overflow.rs (exported by its stub module). */
export interface Fns_error_reporting_traits_overflow {
  // error_reporting/traits/overflow.rs:20 (lane errctxt-contract)
  suggest_new_overflow_limit(tcx: TyCtxt, err: Diag): void;
}
/** The free fns of error_reporting/traits/suggestions.rs (exported by its stub module). */
export interface Fns_error_reporting_traits_suggestions {
  // error_reporting/traits/suggestions.rs:113 (lane errrep-sugg-a)
  predicate_constraint(generics: hir.Generics, pred: Predicate): [Span, string];
  // error_reporting/traits/suggestions.rs:123 (lane errrep-sugg-a)
  suggest_restriction(tcx: TyCtxt, item_id: LocalDefId, hir_generics: hir.Generics, msg: string, err: Diag, fn_sig: hir.FnSig | undefined, projection: ProjectionAliasTy | undefined, trait_pred: PolyTraitClause, super_traits: [Ident, hir.GenericBounds] | undefined): void;
  // error_reporting/traits/suggestions.rs:6792 (lane errrep-sugg-c)
  hint_missing_borrow(infcx: InferCtxt, param_env: ParamEnv, span: Span, found: Ty, expected: Ty, found_node: hir.Node, err: Diag): void;
  // error_reporting/traits/suggestions.rs:7023 (lane errrep-sugg-c)
  get_explanation_based_on_obligation(tcx: TyCtxt, obligation: PredicateObligation, trait_predicate: PolyTraitClause, pre_message: string, long_ty_path: MutRef<PathBuf | undefined>): string;
  // error_reporting/traits/suggestions.rs:7089 (lane errrep-sugg-c)
  suggest_desugaring_async_fn_to_impl_future_in_trait(tcx: TyCtxt, sig: hir.FnSig, body: hir.TraitFn, opaque_def_id: LocalDefId, add_bounds: string): [Span, string][] | undefined;
  // error_reporting/traits/suggestions.rs:7154 (lane errrep-sugg-c)
  point_at_assoc_type_restriction(tcx: TyCtxt, err: Diag, self_ty_str: string, trait_name: string, predicate: Predicate, generics: hir.Generics, data: ImplDerivedCause): void;
  // error_reporting/traits/suggestions.rs:7291 (lane errrep-sugg-c)
  get_deref_type_and_refs(ty: Ty): [Ty, Mutability[]];
}
/** The free fns of diagnostics.rs (exported by its stub module). */
export interface Fns_diagnostics {
  // diagnostics.rs:1928 (lane errrep-infer-b)
  impl_trait_overcapture_suggestion(tcx: TyCtxt, opaque_def_id: LocalDefId, fn_def_id: LocalDefId, captured_args: DefIdSet): AddPreciseCapturingForOvercapture | undefined;
}

// ---- comment-only declarations (trait impls, nested fns, single-file helper types; the owning lane picks the TS form) ----
// ---- error_reporting/infer/mod.rs ----
// error_reporting/infer/mod.rs:1132 nested fn in `cmp` (lane errrep-infer-a)
// static fmt_region(region: Region): string;
// error_reporting/infer/mod.rs:1142 nested fn in `cmp` (lane errrep-infer-a)
// static push_ref(region: Region, mutbl: Mutability, s: DiagStyledString): void;
// error_reporting/infer/mod.rs:1151 nested fn in `cmp` (lane errrep-infer-a)
// static cmp_ty_refs(r1: Region, mut1: Mutability, r2: Region, mut2: Mutability, ss: [DiagStyledString, DiagStyledString]): void;
// error_reporting/infer/mod.rs:1491 `impl OpaqueTypesVisitor` (lane errrep-infer-a)
// static visit_expected_found<E, F>(tcx: TyCtxt, expected: E, found: F, ignore_span: Span, d_E: TypeVisitable<E>, d_F: TypeVisitable<F>): OpaqueTypesVisitor;
// error_reporting/infer/mod.rs:1514 `impl OpaqueTypesVisitor` (lane errrep-infer-a)
// report(err: Diag): void;
// error_reporting/infer/mod.rs:1519 `impl OpaqueTypesVisitor` (lane errrep-infer-a)
// add_labels_for_types(err: Diag, target: string, types: Map<TyCategory, Set<Span>>): void;
// error_reporting/infer/mod.rs:1544 `impl ty::TypeVisitor for OpaqueTypesVisitor` (lane errrep-infer-a)
// visit_ty(t: Ty): void;
// error_reporting/infer/mod.rs:2095 `impl Visitor for LetVisitor` (lane errrep-infer-a)
// visit_stmt(s: hir.Stmt): Result;
// error_reporting/infer/mod.rs:2479 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// cx(): TyCtxt;
// error_reporting/infer/mod.rs:2483 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// relate_ty_args(a_ty: Ty, _1: Ty, _2: DefId, a_args: GenericArgs, b_args: GenericArgs, _5: (_0: GenericArgs) => Ty): RelateResult<Ty>;
// error_reporting/infer/mod.rs:2496 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// relate_with_variance<T>(_variance: Variance, _info: VarianceDiagInfo, a: T, b: T): RelateResult<T>;
// error_reporting/infer/mod.rs:2506 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// tys(a: Ty, b: Ty): RelateResult<Ty>;
// error_reporting/infer/mod.rs:2525 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// regions(a: Region, b: Region): RelateResult<Region>;
// error_reporting/infer/mod.rs:2541 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// binders<T>(a: Binder<T>, b: Binder<T>): RelateResult<Binder<T>>;
// error_reporting/infer/mod.rs:2552 `impl TypeRelation for SameTypeModuloInfer` (lane errrep-infer-a)
// consts(a: Const, _b: Const): RelateResult<Const>;
// error_reporting/infer/mod.rs:2692 `impl IntoDiagArg for ObligationCauseAsDiagArg` (lane errrep-infer-a)
// into_diag_arg(_0: MutRef<PathBuf | undefined>): DiagArgValue;
// error_reporting/infer/mod.rs:2726 `impl fmt::Display for TyCategory` (lane errrep-infer-a)
// fmt(f: Fmt): Result;
// error_reporting/infer/mod.rs:2738 `impl TyCategory` (lane errrep-infer-a)
// static from_ty(tcx: TyCtxt, ty: Ty): [Self, DefId] | undefined;
// ---- error_reporting/infer/need_type_info.rs ----
// error_reporting/infer/need_type_info.rs:51 `impl From for ErrCode` (lane errrep-need-type-info)
// static from(val: TypeAnnotationNeeded): Self;
// error_reporting/infer/need_type_info.rs:81 `impl InferenceDiagnosticsData` (lane errrep-need-type-info)
// can_add_more_info(): boolean;
// error_reporting/infer/need_type_info.rs:85 `impl InferenceDiagnosticsData` (lane errrep-need-type-info)
// where_x_is_kind(infcx: InferCtxt, in_type: Ty): string;
// error_reporting/infer/need_type_info.rs:114 `impl InferenceDiagnosticsData` (lane errrep-need-type-info)
// make_bad_error(span: Span): InferenceBadError;
// error_reporting/infer/need_type_info.rs:136 `impl InferenceDiagnosticsParentData` (lane errrep-need-type-info)
// static for_parent_def_id(tcx: TyCtxt, parent_def_id: DefId): InferenceDiagnosticsParentData | undefined;
// error_reporting/infer/need_type_info.rs:149 `impl InferenceDiagnosticsParentData` (lane errrep-need-type-info)
// static for_def_id(tcx: TyCtxt, def_id: DefId): InferenceDiagnosticsParentData | undefined;
// error_reporting/infer/need_type_info.rs:155 `impl IntoDiagArg for UnderspecifiedArgKind` (lane errrep-need-type-info)
// into_diag_arg(_0: MutRef<PathBuf | undefined>): DiagArgValue;
// error_reporting/infer/need_type_info.rs:166 `impl UnderspecifiedArgKind` (lane errrep-need-type-info)
// try_get_prefix(): string | undefined;
// error_reporting/infer/need_type_info.rs:180 `impl ClosureEraser` (lane errrep-need-type-info)
// new_infer(): Ty;
// error_reporting/infer/need_type_info.rs:186 `impl TypeFolder for ClosureEraser` (lane errrep-need-type-info)
// cx(): TyCtxt;
// error_reporting/infer/need_type_info.rs:190 `impl TypeFolder for ClosureEraser` (lane errrep-need-type-info)
// fold_ty(ty: Ty): Ty;
// error_reporting/infer/need_type_info.rs:264 `impl TypeFolder for ClosureEraser` (lane errrep-need-type-info)
// fold_const(c: Const): Const;
// error_reporting/infer/need_type_info.rs:670 `impl InferSource` (lane errrep-need-type-info)
// from_expansion(): boolean;
// error_reporting/infer/need_type_info.rs:687 `impl InferSourceKind` (lane errrep-need-type-info)
// ty_localized_msg(infcx: InferCtxt): [string, string, PathBuf | undefined];
// error_reporting/infer/need_type_info.rs:719 `impl InferSourceKind` (lane errrep-need-type-info)
// suggestion(tcx: TyCtxt, infcx: InferCtxt, body_def_id: LocalDefId, term: Term, arg_data: InferenceDiagnosticsData, typeck_results: TypeckResults, body_from_expansion: boolean, span: Span): SourceKindSubdiag | undefined;
// error_reporting/infer/need_type_info.rs:933 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// static new(tecx: TypeErrCtxt, typeck_results: TypeckResults, target: Term, ty: Ty | undefined): Self;
// error_reporting/infer/need_type_info.rs:956 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// source_cost(source: InferSource): number;
// error_reporting/infer/need_type_info.rs:962 `impl CostCtxt` (lane errrep-need-type-info)
// arg_cost(arg: GenericArg): number;
// error_reporting/infer/need_type_info.rs:969 `impl CostCtxt` (lane errrep-need-type-info)
// ty_cost(ty: Ty): number;
// error_reporting/infer/need_type_info.rs:1017 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// update_infer_source(new_source: InferSource): void;
// error_reporting/infer/need_type_info.rs:1041 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// node_args_opt(hir_id: HirId): GenericArgs | undefined;
// error_reporting/infer/need_type_info.rs:1046 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// opt_node_type(hir_id: HirId): Ty | undefined;
// error_reporting/infer/need_type_info.rs:1053 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// generic_arg_is_target(arg: GenericArg): boolean;
// error_reporting/infer/need_type_info.rs:1084 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// generic_arg_contains_target(arg: GenericArg): boolean;
// error_reporting/infer/need_type_info.rs:1125 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// expr_inferred_arg_iter(expr: hir.Expr): Iterable<InsertableGenericArgs>;
// error_reporting/infer/need_type_info.rs:1191 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// resolved_path_inferred_arg_iter(path: hir.Path, args: GenericArgs): Iterable<InsertableGenericArgs>;
// error_reporting/infer/need_type_info.rs:1246 `impl FindInferSourceVisitor` (lane errrep-need-type-info)
// path_inferred_arg_iter(hir_id: HirId, args: GenericArgs, qpath: hir.QPath): Iterable<InsertableGenericArgs>;
// error_reporting/infer/need_type_info.rs:1324 `impl Visitor for FindInferSourceVisitor` (lane errrep-need-type-info)
// maybe_tcx(): MaybeTyCtxt;
// error_reporting/infer/need_type_info.rs:1328 `impl Visitor for FindInferSourceVisitor` (lane errrep-need-type-info)
// visit_local(local: hir.LetStmt): void;
// error_reporting/infer/need_type_info.rs:1333 nested fn in `visit_local` (lane errrep-need-type-info)
// static get_did(typeck_results: TypeckResults, expr: hir.Expr): DefId | undefined;
// error_reporting/infer/need_type_info.rs:1383 `impl Visitor for FindInferSourceVisitor` (lane errrep-need-type-info)
// visit_body(body: hir.Body): void;
// error_reporting/infer/need_type_info.rs:1411 `impl Visitor for FindInferSourceVisitor` (lane errrep-need-type-info)
// visit_expr(expr: hir.Expr): void;
// ---- error_reporting/infer/region.rs ----
// error_reporting/infer/region.rs:944 `impl hir::intravisit::Visitor for LifetimeReplaceVisitor` (lane errrep-region)
// visit_lifetime(lt: hir.Lifetime): void;
// ---- error_reporting/infer/suggest.rs ----
// error_reporting/infer/suggest.rs:395 nested fn in `suggest_turning_stmt_into_expr` (lane errrep-infer-b)
// static collect_blocks(expr: hir.Expr, blocks: hir.Block[]): void;
// error_reporting/infer/suggest.rs:680 `impl Visitor for IfVisitor` (lane errrep-infer-b)
// visit_expr(ex: hir.Expr): Result;
// error_reporting/infer/suggest.rs:692 `impl Visitor for IfVisitor` (lane errrep-infer-b)
// visit_stmt(ex: hir.Stmt): Result;
// ---- error_reporting/infer/nice_region_error/find_anon_type.rs ----
// error_reporting/infer/nice_region_error/find_anon_type.rs:72 `impl Visitor for FindNestedTypeVisitor` (lane errrep-region)
// maybe_tcx(): MaybeTyCtxt;
// error_reporting/infer/nice_region_error/find_anon_type.rs:76 `impl Visitor for FindNestedTypeVisitor` (lane errrep-region)
// visit_ty(arg: hir.Ty<hir.AmbigArg>): Result;
// error_reporting/infer/nice_region_error/find_anon_type.rs:178 `impl Visitor for TyPathVisitor` (lane errrep-region)
// maybe_tcx(): MaybeTyCtxt;
// error_reporting/infer/nice_region_error/find_anon_type.rs:182 `impl Visitor for TyPathVisitor` (lane errrep-region)
// visit_lifetime(lifetime: hir.Lifetime): Result;
// error_reporting/infer/nice_region_error/find_anon_type.rs:212 `impl Visitor for TyPathVisitor` (lane errrep-region)
// visit_ty(arg: hir.Ty<hir.AmbigArg>): Result;
// ---- error_reporting/infer/nice_region_error/placeholder_error.rs ----
// error_reporting/infer/nice_region_error/placeholder_error.rs:35 `impl IntoDiagArg for Highlighted` (lane errrep-nice-region)
// into_diag_arg(_0: MutRef<PathBuf | undefined>): DiagArgValue;
// error_reporting/infer/nice_region_error/placeholder_error.rs:41 `impl Highlighted` (lane errrep-nice-region)
// map<U>(f: (_0: T) => U): Highlighted<U>;
// error_reporting/infer/nice_region_error/placeholder_error.rs:50 `impl fmt::Display for Highlighted` (lane errrep-nice-region)
// fmt(f: Fmt): Result;
// ---- error_reporting/infer/nice_region_error/static_impl_trait.rs ----
// error_reporting/infer/nice_region_error/static_impl_trait.rs:406 `impl TypeVisitor for TraitObjectVisitor` (lane errrep-nice-region)
// visit_ty(t: Ty): void;
// error_reporting/infer/nice_region_error/static_impl_trait.rs:422 `impl Visitor for HirTraitObjectVisitor` (lane errrep-nice-region)
// visit_ty(t: hir.Ty<hir.AmbigArg>): void;
// ---- error_reporting/infer/nice_region_error/trait_impl_difference.rs ----
// error_reporting/infer/nice_region_error/trait_impl_difference.rs:77 `impl HighlightBuilder` (lane errrep-nice-region)
// static build(tcx: TyCtxt, sig: PolyFnSig): RegionHighlightMode;
// error_reporting/infer/nice_region_error/trait_impl_difference.rs:86 `impl ty::TypeVisitor for HighlightBuilder` (lane errrep-nice-region)
// visit_region(r: Region): void;
// error_reporting/infer/nice_region_error/trait_impl_difference.rs:198 `impl Visitor for TypeParamSpanVisitor` (lane errrep-nice-region)
// maybe_tcx(): MaybeTyCtxt;
// error_reporting/infer/nice_region_error/trait_impl_difference.rs:202 `impl Visitor for TypeParamSpanVisitor` (lane errrep-nice-region)
// visit_qpath(qpath: hir.QPath, id: HirId, _span: Span): void;
// error_reporting/infer/nice_region_error/trait_impl_difference.rs:203 nested fn in `visit_qpath` (lane errrep-nice-region)
// static record_elided_lifetimes(tcx: TyCtxt, elided_lifetime_paths: ElidedLifetimeInPath[], segment: hir.PathSegment): void;
// error_reporting/infer/nice_region_error/trait_impl_difference.rs:279 `impl Visitor for TypeParamSpanVisitor` (lane errrep-nice-region)
// visit_ty(arg: hir.Ty<hir.AmbigArg>): void;
// ---- error_reporting/traits/mod.rs ----
// error_reporting/traits/mod.rs:67 `impl FindExprBySpan` (lane errrep-traits-a)
// static new(span: Span, tcx: TyCtxt): Self;
// error_reporting/traits/mod.rs:75 `impl Visitor for FindExprBySpan` (lane errrep-traits-a)
// maybe_tcx(): MaybeTyCtxt;
// error_reporting/traits/mod.rs:79 `impl Visitor for FindExprBySpan` (lane errrep-traits-a)
// visit_expr(ex: hir.Expr): void;
// error_reporting/traits/mod.rs:94 `impl Visitor for FindExprBySpan` (lane errrep-traits-a)
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// error_reporting/traits/mod.rs:117 `impl ArgKind` (lane errrep-traits-a)
// static empty(): ArgKind;
// error_reporting/traits/mod.rs:123 `impl ArgKind` (lane errrep-traits-a)
// static from_expected_ty(t: Ty, span: Span | undefined): ArgKind;
// ---- error_reporting/traits/ambiguity.rs ----
// error_reporting/traits/ambiguity.rs:926 `impl ty::TypeVisitor for HasNumericInferVisitor` (lane errrep-need-type-info)
// visit_ty(ty: Ty): Result;
// ---- error_reporting/traits/call_kind.rs ----
// error_reporting/traits/call_kind.rs:35 `impl CallDesugaringKind` (lane errctxt-contract)
// name(): string;
// error_reporting/traits/call_kind.rs:47 `impl CallDesugaringKind` (lane errctxt-contract)
// trait_def_id(tcx: TyCtxt): DefId;
// ---- error_reporting/traits/fulfillment_errors.rs ----
// error_reporting/traits/fulfillment_errors.rs:1182 `impl Visitor for FindMethodSubexprOfTry` (lane errrep-traits-a)
// visit_expr(ex: hir.Expr): Result;
// error_reporting/traits/fulfillment_errors.rs:2004 nested fn in `fuzzy_match_tys` (lane errrep-traits-b)
// static type_category(tcx: TyCtxt, t: Ty): number | undefined;
// error_reporting/traits/fulfillment_errors.rs:3026 `impl TypeFolder for ParamToVarFolder` (lane errrep-traits-b)
// cx(): TyCtxt;
// error_reporting/traits/fulfillment_errors.rs:3033 `impl TypeFolder for ParamToVarFolder` (lane errrep-traits-b)
// fold_ty(ty: Ty): Ty;
// ---- error_reporting/traits/overflow.rs ----
// error_reporting/traits/overflow.rs:58 nested fn in `build_overflow_error` (lane errctxt-contract)
// static with_short_path<T>(tcx: TyCtxt, value: T, display_T: (t: T) => string): string;
// ---- error_reporting/traits/suggestions.rs ----
// error_reporting/traits/suggestions.rs:73 `impl CoroutineData` (lane errrep-sugg-a)
// try_get_upvar_span(infer_context: InferCtxt, coroutine_did: DefId, ty_matches: (_0: Binder<Ty>) => boolean): CoroutineInteriorOrUpvar | undefined;
// error_reporting/traits/suggestions.rs:95 `impl CoroutineData` (lane errrep-sugg-a)
// get_from_await_ty(visitor: AwaitsVisitor, tcx: TyCtxt, ty_matches: (_0: Binder<Ty>) => boolean): Span | undefined;
// error_reporting/traits/suggestions.rs:2973 nested fn in `report_closure_arg_mismatch` (lane errrep-sugg-b)
// static build_fn_sig_ty(infcx: InferCtxt, trait_ref: TraitRef): Ty;
// error_reporting/traits/suggestions.rs:6479 nested fn in `suggest_add_result_as_return_type` (lane errrep-sugg-c)
// static choose_suggest_items(tcx: TyCtxt, node: hir.Node): [hir.FnDecl, hir.BodyId] | undefined;
// error_reporting/traits/suggestions.rs:6881 `impl Visitor for SelfVisitor` (lane errrep-sugg-c)
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// error_reporting/traits/suggestions.rs:6904 `impl Visitor for ReturnsVisitor` (lane errrep-sugg-c)
// visit_expr(ex: hir.Expr): void;
// error_reporting/traits/suggestions.rs:6940 `impl Visitor for ReturnsVisitor` (lane errrep-sugg-c)
// visit_body(body: hir.Body): void;
// error_reporting/traits/suggestions.rs:6954 `impl Visitor for AwaitsVisitor` (lane errrep-sugg-c)
// visit_expr(ex: hir.Expr): void;
// error_reporting/traits/suggestions.rs:6966 `trait NextTypeParamName` (lane errrep-sugg-c)
// next_type_param_name(name: string | undefined): string;
// error_reporting/traits/suggestions.rs:6970 `impl NextTypeParamName for & [ hir::GenericParam ]` (lane errrep-sugg-c)
// next_type_param_name(name: string | undefined): string;
// error_reporting/traits/suggestions.rs:7003 `impl hir::intravisit::Visitor for ReplaceImplTraitVisitor` (lane errrep-sugg-c)
// visit_ty(t: hir.Ty<hir.AmbigArg>): void;
// error_reporting/traits/suggestions.rs:7075 `impl TypeFolder for ReplaceImplTraitFolder` (lane errrep-sugg-c)
// fold_ty(t: Ty): Ty;
// error_reporting/traits/suggestions.rs:7084 `impl TypeFolder for ReplaceImplTraitFolder` (lane errrep-sugg-c)
// cx(): TyCtxt;
// error_reporting/traits/suggestions.rs:7311 `impl Visitor for FindTypeParam` (lane errrep-sugg-c)
// visit_where_predicate(_0: hir.WherePredicate): void;
// error_reporting/traits/suggestions.rs:7315 `impl Visitor for FindTypeParam` (lane errrep-sugg-c)
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// error_reporting/traits/suggestions.rs:7353 `impl TypeVisitor for ParamFinder` (lane errrep-sugg-c)
// visit_ty(t: Ty): Result;
// error_reporting/traits/suggestions.rs:7365 `impl ParamFinder` (lane errrep-sugg-c)
// can_suggest_bound(generics: hir.Generics): boolean;
// ---- diagnostics.rs ----
// diagnostics.rs:41 `impl Diagnostic for NegativePositiveConflict` (lane errrep-infer-b)
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// diagnostics.rs:92 `impl Subdiagnostic for AdjustSignatureBorrow` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:345 `impl SourceKindSubdiag` (lane errrep-infer-b)
// static new_fully_qualified(span: Span, def_path: string, adjustment: string, successor: [string, BytePos]): Self;
// diagnostics.rs:360 `impl SourceKindSubdiag` (lane errrep-infer-b)
// static new_closure_return(ty_info: string, data: hir.FnRetTy, should_wrap_expr: Span | undefined): Self;
// diagnostics.rs:440 `impl Subdiagnostic for RegionOriginNote` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:535 `impl Subdiagnostic for LifetimeMismatchLabels` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:608 `impl Subdiagnostic for AddLifetimeParamsSuggestion` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:675 `impl Visitor for ImplicitLifetimeFinder` (lane errrep-infer-b)
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// diagnostics.rs:792 `impl Subdiagnostic for IntroducesStaticBecauseUnmetLifetimeReq` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:905 `impl IntoDiagArg for TyOrSig` (lane errrep-infer-b)
// into_diag_arg(path: MutRef<PathBuf | undefined>): DiagArgValue;
// diagnostics.rs:1088 `impl ActualImplExplNotes` (lane errrep-infer-b)
// static new_expected(kind: ActualImplExpectedKind, lt_kind: ActualImplExpectedLifetimeKind, ty_or_sig: TyOrSig, trait_path: Highlighted<TraitRefPrintOnlyTraitPath>, lifetime_1: number, lifetime_2: number, satisfy_span: Span | undefined, item_span: Span | undefined, outer_span: Span | undefined, item_name: string): Self;
// diagnostics.rs:1183 `impl Subdiagnostic for ConsiderBorrowingParamHelp` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:1664 `impl Subdiagnostic for SuggestTuplePatternMany` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:1910 `impl Subdiagnostic for AddPreciseCapturingAndParams` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// diagnostics.rs:2060 `impl Subdiagnostic for AddPreciseCapturingForOvercapture` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
// ---- diagnostics/note_and_explain.rs ----
// diagnostics/note_and_explain.rs:16 `impl DescriptionCtx` (lane errrep-infer-b)
// static new(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region, alt_span: Span | undefined): Self | undefined;
// diagnostics/note_and_explain.rs:108 `impl IntoDiagArg for PrefixKind` (lane errrep-infer-b)
// into_diag_arg(_0: MutRef<PathBuf | undefined>): DiagArgValue;
// diagnostics/note_and_explain.rs:130 `impl IntoDiagArg for SuffixKind` (lane errrep-infer-b)
// into_diag_arg(_0: MutRef<PathBuf | undefined>): DiagArgValue;
// diagnostics/note_and_explain.rs:148 `impl RegionExplanation` (lane errrep-infer-b)
// static new(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region, alt_span: Span | undefined, prefix: PrefixKind, suffix: SuffixKind): Self | undefined;
// diagnostics/note_and_explain.rs:165 `impl Subdiagnostic for RegionExplanation` (lane errrep-infer-b)
// add_to_diag(diag: Diag): void;
