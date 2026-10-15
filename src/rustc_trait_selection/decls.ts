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
/** `error_reporting::TypeErrCtxt<'_, 'tcx>` (error_reporting/mod.rs, wave 19 errctxt-contract). */
export type TypeErrCtxt = Pending<"rustc_trait_selection::error_reporting::TypeErrCtxt">;

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
// traits/select/{mod,candidate_assembly,confirmation}.rs, so every method is declared here (grouped by file, upstream
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
    // select/mod.rs:181 (ported)
    function new_(infcx: InferCtxt): SelectionContext;
    export { new_ as new };
    // select/mod.rs:193 (ported)
    export let with_query_mode: (infcx: InferCtxt, query_mode: TraitQueryMode) => SelectionContext;
  }

  interface SelectionContext {
    // ---- select/mod.rs: `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>` (mod.rs:180) ----
    // select/mod.rs:189 (ported)
    typing_mode(): TypingMode<CantBeErased>;
    // select/mod.rs:201 (ported)
    tcx(): TyCtxt;
    // select/mod.rs:223 (lane old-select-a)
    poly_select(obligation: PolyTraitObligation): SelectionResult<Selection>;
    // select/mod.rs:262
    select(obligation: TraitObligation): SelectionResult<Selection>;
    // select/mod.rs:274
    select_from_obligation(obligation: PolyTraitObligation): SelectionResult<SelectionCandidate>;
    // select/mod.rs:287
    candidate_from_obligation(stack: TraitObligationStack): SelectionResult<SelectionCandidate>;
    // select/mod.rs:331
    candidate_from_obligation_no_cache(stack: TraitObligationStack): SelectionResult<SelectionCandidate>;
    // select/mod.rs:438
    evaluate_root_obligation(obligation: PredicateObligation): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:465
    evaluation_probe(op: (selcx: SelectionContext) => Result<EvaluationResult, OverflowError>): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:495
    evaluate_predicates_recursively(stack: TraitObligationStackList, predicates: Iterable<PredicateObligation>): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:524
    evaluate_predicate_recursively(previous_stack: TraitObligationStackList, obligation: PredicateObligation): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:931
    evaluate_trait_predicate_recursively(previous_stack: TraitObligationStackList, obligation: PolyTraitObligation): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:1073
    check_evaluation_cycle(stack: TraitObligationStack): EvaluationResult | undefined;
    // select/mod.rs:1116
    evaluate_stack(stack: TraitObligationStack): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:1178 (`I: Iterator<Item = Predicate>`)
    coinductive_match(cycle: Iterable<Predicate>): boolean;
    // select/mod.rs:1205
    evaluate_candidate(stack: TraitObligationStack, candidate: SelectionCandidate): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:1243
    check_evaluation_cache(param_env: ParamEnv, trait_pred: PolyTraitClause): EvaluationResult | undefined;
    // select/mod.rs:1263
    insert_evaluation_cache(param_env: ParamEnv, trait_pred: PolyTraitClause, dep_node: DepNodeIndex, result: EvaluationResult): void;
    // select/mod.rs:1293 (`T: Upcast<TyCtxt, Predicate> + Clone`: the D4 `upcast_from_T`)
    check_recursion_depth<T>(depth: number, error_obligation: Obligation<T>, upcast_from_T: (from: T, tcx: Interner) => Predicate): Result<null, OverflowError>;
    // select/mod.rs:1322 (`T: Display + TypeFoldable`, `V: Upcast<TyCtxt, Predicate> + Clone`)
    check_recursion_limit<T, V>(obligation: Obligation<T>, error_obligation: Obligation<V>, upcast_from_V: (from: V, tcx: Interner) => Predicate): Result<null, OverflowError>;
    // select/mod.rs:1333
    in_task<R>(op: (selcx: SelectionContext) => R): [R, DepNodeIndex];
    // select/mod.rs:1343
    filter_impls(candidates: SelectionCandidate[], obligation: PolyTraitObligation): SelectionCandidate[];
    // select/mod.rs:1370
    can_use_global_caches(param_env: ParamEnv, pred: PolyTraitClause): boolean;
    // select/mod.rs:1414
    check_candidate_cache(param_env: ParamEnv, cache_fresh_trait_pred: PolyTraitClause): SelectionResult<SelectionCandidate> | undefined;
    // select/mod.rs:1458
    can_cache_candidate(result: SelectionResult<SelectionCandidate>): boolean;
    // select/mod.rs:1469
    insert_candidate_cache(
      param_env: ParamEnv,
      cache_fresh_trait_pred: PolyTraitClause,
      dep_node: DepNodeIndex,
      candidate: SelectionResult<SelectionCandidate>,
    ): void;
    // select/mod.rs:1511 (`ControlFlow<T, ()>`)
    for_each_item_bound<T>(
      self_ty: Ty,
      for_each: (selcx: SelectionContext, clause: Clause, idx: number, kind: AliasBoundKind) => ControlFlow<T, null>,
      on_ambiguity: () => void,
    ): ControlFlow<T, null>;
    // select/mod.rs:1569
    match_normalize_trait_ref(obligation: PolyTraitObligation, placeholder_trait_ref: TraitRef, trait_bound: PolyTraitRef): Result<TraitRef | undefined, null>;
    // select/mod.rs:1614
    where_clause_may_apply(stack: TraitObligationStack, where_clause_trait_ref: PolyTraitRef): Result<EvaluationResult, OverflowError>;
    // select/mod.rs:1633
    match_projection_projections(
      obligation: ProjectionTermObligation,
      env_predicate: PolyProjectionClause,
      potentially_unnormalized_candidates: boolean,
    ): ProjectionMatchesProjection;

    // ---- select/mod.rs: `impl<'tcx> SelectionContext<'_, 'tcx>` (mod.rs:1710, winnowing; lane old-select-b) ----
    // select/mod.rs:1716
    winnow_candidates(
      has_non_region_infer: boolean,
      candidate_preference_mode: CandidatePreferenceMode,
      candidates: EvaluatedCandidate[],
    ): SelectionCandidate | undefined;
    // select/mod.rs:1951 (the destructured `(lhs, lhs_evaluation)` is one tuple parameter)
    prefer_lhs_over_victim(has_non_region_infer: boolean, lhs_and_evaluation: [DefId, EvaluationResult], victim: DefId): boolean;

    // ---- select/mod.rs: `impl<'tcx> SelectionContext<'_, 'tcx>` (mod.rs:2023, builtin rules and helpers) ----
    // select/mod.rs:2024
    sizedness_conditions(self_ty: Ty, sizedness: SizedTraitKind): Binder<Ty[]>;
    // select/mod.rs:2081
    copy_clone_conditions(self_ty: Ty): Binder<Ty[]>;
    // select/mod.rs:2160
    coroutine_is_gen(self_ty: Ty): boolean;
    // select/mod.rs:2177
    constituent_types_for_auto_trait(t: Ty): Result<Binder<AutoImplConstituents>, SelectionError>;
    // select/mod.rs:2307
    collect_predicates_for_types(param_env: ParamEnv, cause: ObligationCause, recursion_depth: number, trait_def_id: DefId, types: Ty[]): PredicateObligations;
    // select/mod.rs:2371
    rematch_impl(impl_def_id: DefId, obligation: PolyTraitObligation): Normalized<GenericArgs>;
    // select/mod.rs:2387
    match_impl(impl_def_id: DefId, impl_trait_header: ImplTraitHeader, obligation: PolyTraitObligation): Result<Normalized<GenericArgs>, null>;
    // select/mod.rs:2452
    match_upcast_principal(
      obligation: PolyTraitObligation,
      unnormalized_upcast_principal: Unnormalized<PolyTraitRef>,
      a_data: List<PolyExistentialPredicate>,
      b_data: List<PolyExistentialPredicate>,
      a_region: Region,
      b_region: Region,
    ): SelectionResult<PredicateObligations>;
    // select/mod.rs:2615
    match_where_clause_trait_ref(obligation: PolyTraitObligation, where_clause_trait_ref: PolyTraitRef): Result<PredicateObligations, null>;
    // select/mod.rs:2626
    match_poly_trait_ref(obligation: PolyTraitObligation, poly_trait_ref: PolyTraitRef): Result<PredicateObligations, null>;
    // select/mod.rs:2647
    match_fresh_trait_preds(previous: PolyTraitClause, current: PolyTraitClause): boolean;
    // select/mod.rs:2656
    push_stack(previous_stack: TraitObligationStackList, obligation: PolyTraitObligation): TraitObligationStack;
    // select/mod.rs:2676
    closure_trait_ref_unnormalized(self_ty: Ty, fn_trait_def_id: DefId): PolyTraitRef;
    // select/mod.rs:2701
    impl_or_trait_obligations(
      cause: ObligationCause,
      recursion_depth: number,
      param_env: ParamEnv,
      def_id: DefId,
      args: GenericArgs,
      parent_trait_pred: Binder<TraitClause>,
    ): PredicateObligations;
    // select/mod.rs:2782
    should_stall_coroutine(def_id: DefId): boolean;

    // ---- select/candidate_assembly.rs: `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>` (lane old-candidates-confirm) ----
    // select/candidate_assembly.rs:31
    assemble_candidates(stack: TraitObligationStack): Result<SelectionCandidateSet, SelectionError>;
    // select/candidate_assembly.rs:191
    assemble_candidates_from_projected_tys(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:272
    assemble_candidates_from_caller_bounds(stack: TraitObligationStack, candidates: SelectionCandidateSet): Result<null, SelectionError>;
    // select/candidate_assembly.rs:312
    assemble_coroutine_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:337
    assemble_future_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:354
    assemble_iterator_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:371
    assemble_fused_iterator_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:381
    assemble_async_iterator_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:415
    assemble_closure_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:478
    assemble_async_closure_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:540
    assemble_async_fn_kind_helper_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:567
    assemble_fn_pointer_candidates(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:603
    assemble_candidates_from_impls(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:653
    reject_fn_ptr_impls(impl_def_id: DefId, obligation: PolyTraitObligation, impl_self_ty: Ty): boolean;
    // select/candidate_assembly.rs:741
    assemble_candidates_from_auto_impls(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:911
    assemble_candidates_from_object_ty(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:985
    assemble_candidates_for_unsizing(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1111
    assemble_candidates_for_transmutability(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1129
    assemble_candidates_for_trait_alias(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1148
    assemble_builtin_copy_clone_candidate(self_ty: Ty, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1249
    assemble_builtin_sized_candidate(self_ty: Ty, candidates: SelectionCandidateSet, sizedness: SizedTraitKind): void;
    // select/candidate_assembly.rs:1318
    assemble_const_destruct_candidates(_obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1326
    assemble_candidate_for_tuple(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1370
    assemble_candidates_for_fn_ptr_trait(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1418
    assemble_candidates_for_bikeshed_guaranteed_no_drop_trait(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1462
    assemble_candidates_for_try_as_dyn(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;
    // select/candidate_assembly.rs:1490
    assemble_candidates_for_field_trait(obligation: PolyTraitObligation, candidates: SelectionCandidateSet): void;

    // ---- select/confirmation.rs: `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>` (lane old-candidates-confirm) ----
    // select/confirmation.rs:35
    confirm_candidate(obligation: PolyTraitObligation, candidate: SelectionCandidate): Result<Selection, SelectionError>;
    // select/confirmation.rs:145
    confirm_projection_candidate(obligation: PolyTraitObligation, idx: number): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:201
    confirm_param_candidate(obligation: PolyTraitObligation, param: PolyTraitRef): PredicateObligations;
    // select/confirmation.rs:232
    confirm_builtin_candidate(obligation: PolyTraitObligation): PredicateObligations;
    // select/confirmation.rs:284 (with the nested `fn flatten_answer_tree` at :292, a local function)
    confirm_transmutability_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:384
    confirm_auto_impl_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:428
    confirm_impl_candidate(obligation: PolyTraitObligation, impl_def_id: DefId): ImplSourceUserDefinedData<PredicateObligation>;
    // select/confirmation.rs:450
    vtable_impl(
      impl_def_id: DefId,
      args: Normalized<GenericArgs>,
      cause: ObligationCause,
      recursion_depth: number,
      param_env: ParamEnv,
      parent_trait_pred: Binder<TraitClause>,
    ): ImplSourceUserDefinedData<PredicateObligation>;
    // select/confirmation.rs:482
    confirm_object_candidate(obligation: PolyTraitObligation, index: number): Result<ImplSource<PredicateObligation>, SelectionError>;
    // select/confirmation.rs:593
    confirm_fn_pointer_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:637
    confirm_trait_alias_candidate(obligation: PolyTraitObligation): PredicateObligations;
    // select/confirmation.rs:662
    confirm_coroutine_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:692
    confirm_future_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:722
    confirm_iterator_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:752
    confirm_async_iterator_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:783
    confirm_closure_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:812
    confirm_async_closure_candidate(obligation: PolyTraitObligation): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:958
    equate_trait_refs(obligation: TraitObligation, found_trait_ref: PolyTraitRef): Result<PredicateObligations, SelectionError>;
    // select/confirmation.rs:995
    confirm_trait_upcasting_unsize_candidate(obligation: PolyTraitObligation, idx: number): Result<ImplSource<PredicateObligation>, SelectionError>;
    // select/confirmation.rs:1033
    confirm_builtin_unsize_candidate(obligation: PolyTraitObligation): Result<ImplSource<PredicateObligation>, SelectionError>;
    // select/confirmation.rs:1227
    confirm_bikeshed_guaranteed_no_drop_candidate(obligation: PolyTraitObligation): ImplSource<PredicateObligation>;
    // select/confirmation.rs:1314
    confirm_try_as_dyn_candidate(obligation: PolyTraitObligation): ImplSource<PredicateObligation>;
  }
}
