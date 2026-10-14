// The rustc_next_trait_solver contract (lane evalctxt-contract): `EvalCtxt`, whose `impl` blocks are spread over 12
// upstream files, and one declaration of every `EvalCtxt` method. Grouped by upstream file in module order
// (eval_ctxt/mod.rs, eval_ctxt/probe.rs, eval_ctxt/solver_region_constraints.rs, solve/mod.rs, assembly/mod.rs,
// effect_goals.rs, normalizes_to.rs, project_goals/*.rs, trait_goals.rs), each in upstream order; each declaration
// carries `// <file>:<line>` (relative to compiler/rustc_next_trait_solver/src/, the line of its `fn` keyword at the
// pin). Method bodies are assigned onto `EvalCtxt.prototype` by the file that ports them (PORTING §5 "Methods defined
// in another file"); until then the per-file stub module installs an `unported(..)` placeholder
// (rust_ts/stubs.ts `unported_methods`).
//
// Everything else of the crate (its other types, traits, free fns, folders/visitors, the `GoalKind` impls) is declared
// with its final signature in the stub module of the file that defines it; docs/handoff/evalctxt-contract.md lists
// them per file ("Contract").
//
// Contract rules (see docs/handoff/evalctxt-contract.md):
// - Ownership: lane evalctxt-contract wrote this file; afterwards root owns it. A lane that needs a missing or changed
//   declaration writes it in its handoff (signature + reason); if it cannot type-check without it, it may add a local
//   `declare module "<path>/decls.ts"` augmentation in its own file marked `// PORT(decls): pending root`.
// - Signatures (PORTING §5): `I: Interner` is erased (rustc_type_ir/interner.ts header: `I::Ty` = `Ty`, every `I::*Id`
//   = `DefId`, `cx: I` = `TyCtxt`); `D: SolverDelegate` is erased to the `SolverDelegate` interface (delegate.ts);
//   `&self`/`&mut self` -> `this`; `&T`/`&mut T` -> `T` (a `&mut Vec<T>` / `&mut` struct is mutated in place);
//   `&[T]` -> `readonly T[]`; `Vec`/`ThinVec` -> `T[]`; `Option<T>` -> `T | undefined`; `()` -> `undefined`
//   (`Result<(), E>` is `Result<undefined, E>`); tuples -> arrays; `impl IntoIterator<Item = T>` -> `Iterable<T>`;
//   `impl Into<I::GenericArg>` -> `GenericArg`; closures `impl FnOnce(&mut EvalCtxt<'_, D>, A) -> R` ->
//   `(ecx: EvalCtxt, a: A) => R`.
// - Trait-generic parameters (PORTING §5 "pass function tables", D4): `T: TypeFoldable<I>` / `TypeVisitable<I>` /
//   `Relate<I>` take the descriptor `d_T` last; `G: GoalKind<D>` takes the `GoalKind<G>` impl table `G` last (a value
//   parameter named like the type parameter, so `G::consider_impl_candidate(ecx, ..)` reads
//   `G.consider_impl_candidate(ecx, ..)`).
// - Associated fns without `self` are `declare static` members of the class (`EvalCtxt.enter_root`,
//   `EvalCtxt.enter_canonical`), assigned by eval_ctxt/mod.ts. `enter_canonical` is generic over `D` without a `D`
//   value, so it takes the `SolverDelegate_static` table first (tyir-solve's `SearchGraph.new(D, ..)`).
//
// Init order (a TDZ ReferenceError at load otherwise): this module imports only types (`import type`, never
// `import { type X }`, which `verbatimModuleSyntax` keeps as a side-effect import). It must never import a
// rustc_next_trait_solver module at runtime. lib.ts (the crate root) imports this file first, then every extension
// file.
import type { Span } from "../rustc_span/lib.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type {
  AdtDef,
  BoundExistentialPredicates,
  CanonicalInput,
  CanonicalVarKinds,
  Clause,
  GenericArg,
  GenericArgs,
  ParamEnv,
  Predicate,
  Term,
  Ty,
} from "../rustc_middle/ty/decls.ts";
import type {
  AliasConst,
  AliasTermKind,
  AliasTy,
  Binder,
  ExistentialTraitRef,
  HostEffectClause,
  NormalizesTo,
  OpaqueTypeKey,
  OutlivesClause,
  ProjectionClause,
  TraitClause,
  TraitRef,
  TyVid,
  UniverseIndex,
  Variance,
} from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike_OpaqueTypeStorageEntries } from "../rustc_type_ir/infer_ctxt.ts";
import type { Component } from "../rustc_type_ir/outlives.gen.ts";
import type { CoercePredicate, SubtypePredicate } from "../rustc_type_ir/predicate.ts";
import type { Assumptions, Or, RegionConstraint } from "../rustc_type_ir/region_constraint.ts";
import type { Relate } from "../rustc_type_ir/relate.ts";
import type { CandidateHeadUsages, PathKind } from "../rustc_type_ir/search_graph/mod.ts";
import type { ProbeKind } from "../rustc_type_ir/solve/inspect.ts";
import type {
  AccessedOpaques,
  AliasBoundKind,
  BuiltinImplSource,
  CandidateSource,
  CanonicalResponse,
  Certainty,
  ExternalConstraintsData,
  FetchEligibleAssocItemResponse,
  Goal,
  GoalSource,
  GoalStalledOn,
  MaybeInfo,
  NestedNormalizationGoals,
  NoSolution,
  NoSolutionOrRerunNonErased,
  QueryResult,
  QueryResultOrRerunNonErased,
  RerunNonErased,
  SucceededInErased,
  VisibleForLeakCheck,
} from "../rustc_type_ir/solve/mod.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import type { AliasTerm, OpaqueAliasTy } from "../rustc_type_ir/ty/alias.ts";
import type { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { TypeVisitable } from "../rustc_type_ir/visit.ts";
import type { Result } from "../std/result.ts";
import type { SolverDelegate, SolverDelegate_static } from "./delegate.ts";
import type { AllowInferenceConstraints, AssembleCandidatesFrom, Candidate, FailedCandidateInfo, GoalKind } from "./solve/assembly/mod.ts";
import type { CurrentGoalKind } from "./solve/eval_ctxt/mod.ts";
import type { ProbeCtxt, TraitProbeCtxt } from "./solve/eval_ctxt/probe.ts";
import type { EvaluationStepBuilder, ProofTreeBuilder } from "./solve/inspect/build.ts";
import type { GoalEvaluation, MergeCandidateInfo } from "./solve/mod.ts";
import type { SearchGraph } from "./solve/search_graph.ts";
import type { TraitGoalProvenVia } from "./solve/trait_goals.ts";

// ---- solve/eval_ctxt/mod.rs:103 `struct EvalCtxt` ------------------------------------------------------------------

// PORT: `EvalCtxt<'a, D, I = <D as SolverDelegate>::Interner>`: `D` and `I` are erased (header). The constructor
// takes all fields in declaration order (PORTING §5): `EvalCtxt { .. }` literals (`enter_root`, `enter_canonical`,
// `ProbeCtxt::enter_inner`) are `new EvalCtxt(..)`.
export class EvalCtxt {
  constructor(
    /// The inference context that backs (mostly) inference and placeholder terms
    /// instantiated while solving goals.
    ///
    /// NOTE: The `InferCtxt` that backs the `EvalCtxt` is intentionally private,
    /// because the `InferCtxt` is much more general than `EvalCtxt`. Methods such
    /// as  `take_registered_region_obligations` can mess up query responses,
    /// using `At::normalize` is totally wrong, calling `evaluate_root_goal` can
    /// cause coinductive unsoundness, etc.
    ///
    /// Methods that are generally of use for trait solving are *intentionally*
    /// re-declared through the `EvalCtxt` below, often with cleaner signatures
    /// since we don't care about things like `ObligationCause`s and `Span`s here.
    /// If some `InferCtxt` method is missing, please first think defensively about
    /// the method's compatibility with this solver, or if an existing one does
    /// the job already.
    public delegate: SolverDelegate,

    /// The variable info for the `var_values`, only used to make an ambiguous response
    /// with no constraints.
    public var_kinds: CanonicalVarKinds,

    /// What kind of goal we're currently computing, see the enum definition
    /// for more info.
    public current_goal_kind: CurrentGoalKind,
    public var_values: GenericArgs,

    /// The highest universe index nameable by the caller.
    ///
    /// When we enter a new binder inside of the query we create new universes
    /// which the caller cannot name. We have to be careful with variables from
    /// these new universes when creating the query response.
    ///
    /// Both because these new universes can prevent us from reaching a fixpoint
    /// if we have a coinductive cycle and because that's the only way we can return
    /// new placeholders to the caller.
    public max_input_universe: UniverseIndex,
    /// The opaque types from the canonical input. We only need to return opaque types
    /// which have been added to the storage while evaluating this goal.
    public initial_opaque_types_storage_num_entries: InferCtxtLike_OpaqueTypeStorageEntries,

    public search_graph: SearchGraph,

    public nested_goals: [GoalSource, Goal<Predicate>, GoalStalledOn | undefined][],

    public origin_span: Span,

    // Has this `EvalCtxt` errored out with `NoSolution` in `try_evaluate_added_goals`?
    //
    // If so, then it can no longer be used to make a canonical query response,
    // since subsequent calls to `try_evaluate_added_goals` have possibly dropped
    // ambiguous goals. Instead, a probe needs to be introduced somewhere in the
    // evaluation code.
    public tainted: Result<undefined, NoSolution>,

    /// Tracks accesses of opaque types while in [`TypingMode::ErasedNotCoherence`].
    public opaque_accesses: AccessedOpaques,

    public inspect: EvaluationStepBuilder,
  ) {}

  // solve/eval_ctxt/mod.rs:463
  declare static enter_root: <R>(delegate: SolverDelegate, root_depth: number, origin_span: Span, f: (ecx: EvalCtxt) => R) => R;
  // solve/eval_ctxt/mod.rs:505
  declare static enter_canonical: <T>(
    D: SolverDelegate_static,
    cx: TyCtxt,
    search_graph: SearchGraph,
    canonical_input: CanonicalInput,
    proof_tree_builder: ProofTreeBuilder,
    f: (ecx: EvalCtxt, goal: Goal<Predicate>) => Result<T, NoSolutionOrRerunNonErased>,
  ) => [Result<T, NoSolution>, AccessedOpaques];
}

export interface EvalCtxt {
  // ---- solve/eval_ctxt/mod.rs ----
  // solve/eval_ctxt/mod.rs:429
  typing_mode(): TypingMode;
  // solve/eval_ctxt/mod.rs:443
  step_kind_to_nested(_source: GoalSource): PathKind;
  // solve/eval_ctxt/mod.rs:463 enter_root (static, in the class)
  // solve/eval_ctxt/mod.rs:505 enter_canonical (static, in the class)
  // solve/eval_ctxt/mod.rs:585
  ignore_candidate_head_usages(usages: CandidateHeadUsages): void;
  // solve/eval_ctxt/mod.rs:591
  evaluate_goal(source: GoalSource, goal: Goal<Predicate>, stalled_on: GoalStalledOn | undefined): Result<GoalEvaluation, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:623
  evaluate_goal_no_fast_paths(source: GoalSource, goal: Goal<Predicate>): Result<GoalEvaluation, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:633
  evaluate_in_search_graph(canonical_goal: CanonicalInput, step_kind: PathKind): [Result<CanonicalResponse, NoSolution>, AccessedOpaques];
  // solve/eval_ctxt/mod.rs:748
  evaluate_goal_raw(source: GoalSource, goal: Goal<Predicate>): Result<[NestedNormalizationGoals, GoalEvaluation], NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:921
  build_stalled_on(canonical_goal: CanonicalInput, maybe_info: MaybeInfo, stalled_vars: GenericArg[], previously_succeeded_in_erased: SucceededInErased): GoalStalledOn;
  // solve/eval_ctxt/mod.rs:970
  compute_goal(goal: Goal<Predicate>): QueryResultOrRerunNonErased;
  // solve/eval_ctxt/mod.rs:1030
  try_evaluate_added_goals(): Result<Certainty, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1051
  evaluate_added_goals_step(): Result<Certainty | undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1085
  record_impl_args(impl_args: GenericArgs): void;
  // solve/eval_ctxt/mod.rs:1089
  cx(): TyCtxt;
  // solve/eval_ctxt/mod.rs:1094
  add_goal(source: GoalSource, goal: Goal<Predicate>): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1120
  add_goals(source: GoalSource, goals: Iterable<Goal<Predicate>>): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1131
  next_region_var(): Region;
  // solve/eval_ctxt/mod.rs:1137
  next_ty_infer(): Ty;
  // solve/eval_ctxt/mod.rs:1143
  next_const_infer(): Const;
  // solve/eval_ctxt/mod.rs:1151
  next_term_infer_of_alias_kind(alias_term: AliasTerm): Term;
  // solve/eval_ctxt/mod.rs:1173
  term_is_fully_unconstrained(goal: Goal<NormalizesTo>): boolean;
  // solve/eval_ctxt/mod.rs:1199 ContainsTermOrNotNameable::check_nameable (struct local to `term_is_fully_unconstrained`)
  // solve/eval_ctxt/mod.rs:1212 ContainsTermOrNotNameable::visit_ty (TypeVisitor impl, same)
  // solve/eval_ctxt/mod.rs:1240 ContainsTermOrNotNameable::visit_const (same)
  // solve/eval_ctxt/mod.rs:1264 ContainsTermOrNotNameable::visit_predicate (same)
  // solve/eval_ctxt/mod.rs:1272 ContainsTermOrNotNameable::visit_clauses (same)
  // solve/eval_ctxt/mod.rs:1291
  sub_unify_ty_vids_raw(a: TyVid, b: TyVid): void;
  // solve/eval_ctxt/mod.rs:1296
  eq<T>(param_env: ParamEnv, lhs: T, rhs: T, d_T: Relate<T>): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1306
  sub<T>(param_env: ParamEnv, sub: T, sup: T, d_T: Relate<T>): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1316
  relate<T>(param_env: ParamEnv, lhs: T, variance: Variance, rhs: T, d_T: Relate<T>): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1347
  eq_and_get_goals<T>(param_env: ParamEnv, lhs: T, rhs: T, d_T: Relate<T>): Result<Goal<Predicate>[], NoSolution>;
  // solve/eval_ctxt/mod.rs:1356
  instantiate_binder_with_infer<T>(value: Binder<T>, d_T: TypeFoldable<T>): T;
  // solve/eval_ctxt/mod.rs:1370
  enter_forall_with_assumptions<T, U>(value: Binder<T>, param_env: ParamEnv, f: (ecx: EvalCtxt, value: T) => U, d_T: TypeFoldable<T>): U;
  // solve/eval_ctxt/mod.rs:1394
  deeply_resolve_ignoring_regions<T>(value: T, d_T: TypeFoldable<T>): T;
  // solve/eval_ctxt/mod.rs:1401
  shallow_resolve(ty: Ty): Ty;
  // solve/eval_ctxt/mod.rs:1405
  eager_resolve_region(r: Region): Region;
  // solve/eval_ctxt/mod.rs:1413
  fresh_args_for_item(def_id: DefId): GenericArgs;
  // solve/eval_ctxt/mod.rs:1421
  register_solver_region_constraint(c: RegionConstraint): void;
  // solve/eval_ctxt/mod.rs:1425
  register_ty_outlives(ty: Ty, lt: Region): void;
  // solve/eval_ctxt/mod.rs:1429
  register_region_outlives(a: Region, b: Region, vis: VisibleForLeakCheck): void;
  // solve/eval_ctxt/mod.rs:1440
  well_formed_goals(param_env: ParamEnv, term: Term): Goal<Predicate>[] | undefined;
  // solve/eval_ctxt/mod.rs:1448
  trait_ref_is_knowable(param_env: ParamEnv, trait_ref: TraitRef): Result<boolean, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1459
  fetch_eligible_assoc_item(goal_trait_ref: TraitRef, trait_assoc_def_id: DefId, impl_def_id: DefId): FetchEligibleAssocItemResponse;
  // solve/eval_ctxt/mod.rs:1469
  register_hidden_type_in_storage(opaque_type_key: OpaqueTypeKey, hidden_ty: Ty): Ty | undefined;
  // solve/eval_ctxt/mod.rs:1477
  add_item_bounds_for_hidden_type(opaque_def_id: DefId, opaque_args: GenericArgs, param_env: ParamEnv, hidden_ty: Ty): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1499
  evaluate_const(param_env: ParamEnv, alias_const: AliasConst): Result<Const | undefined, NoSolutionOrRerunNonErased>;
  // solve/eval_ctxt/mod.rs:1516
  evaluate_const_and_instantiate_projection_term(param_env: ParamEnv, projection_term: AliasTerm, expected_term: Term, alias_const: AliasConst): QueryResultOrRerunNonErased;
  // solve/eval_ctxt/mod.rs:1563
  is_transmutable(src: Ty, dst: Ty, assume: Const): Result<Certainty, NoSolution>;
  // solve/eval_ctxt/mod.rs:1572
  replace_bound_vars<T>(t: T, universes: (UniverseIndex | undefined)[], d_T: TypeFoldable<T>): T;
  // solve/eval_ctxt/mod.rs:1580
  may_use_unstable_feature(param_env: ParamEnv, symbol: Symbol): Result<boolean, RerunNonErased>;
  // solve/eval_ctxt/mod.rs:1592
  opaques_with_sub_unified_hidden_type(self_ty: Ty): OpaqueAliasTy[];
  // solve/eval_ctxt/mod.rs:1617
  evaluate_added_goals_and_make_canonical_response(shallow_certainty: Certainty): QueryResultOrRerunNonErased;
  // solve/eval_ctxt/mod.rs:1730
  make_ambiguous_response_no_constraints(maybe: MaybeInfo): CanonicalResponse;
  // solve/eval_ctxt/mod.rs:1750
  compute_external_query_constraints(certainty: Certainty, normalization_nested_goals: NestedNormalizationGoals): ExternalConstraintsData;
  // solve/eval_ctxt/mod.rs:1793
  normalize<T>(param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): Result<T, NoSolutionOrRerunNonErased>;

  // ---- solve/eval_ctxt/probe.rs ----
  /// `probe_kind` is only called when proof tree building is enabled so it can be
  /// as expensive as necessary to output the desired information.
  // solve/eval_ctxt/probe.rs:146
  probe<T>(probe_kind: (result: Result<T, NoSolution>) => ProbeKind): ProbeCtxt<T>;
  // solve/eval_ctxt/probe.rs:153
  probe_builtin_trait_candidate(source: BuiltinImplSource): TraitProbeCtxt;
  // solve/eval_ctxt/probe.rs:160
  probe_trait_candidate(source: CandidateSource): TraitProbeCtxt;

  // ---- solve/eval_ctxt/solver_region_constraints.rs ----
  // solve/eval_ctxt/solver_region_constraints.rs:31
  region_assumptions_for_placeholders_in_universe<T>(t: T, u: UniverseIndex, param_env: ParamEnv, d_T: TypeVisitable<T>): Assumptions | undefined;
  // solve/eval_ctxt/solver_region_constraints.rs:52 RawAssumptions::visit_ty (struct local to the fn above)
  // solve/eval_ctxt/solver_region_constraints.rs:65 RawAssumptions::visit_const (same)
  // solve/eval_ctxt/solver_region_constraints.rs:114
  eagerly_handle_placeholders(): Result<Certainty, NoSolution>;
  // solve/eval_ctxt/solver_region_constraints.rs:155
  destructure_type_outlives(ty: Ty, r: Region): Or;
  // solve/eval_ctxt/solver_region_constraints.rs:161
  destructure_components(components: readonly Component[], r: Region): Or;
  // solve/eval_ctxt/solver_region_constraints.rs:167
  destructure_component(c: Component, r: Region): Or;
  // solve/eval_ctxt/solver_region_constraints.rs:192
  destructure_alias_outlives(alias: AliasTy, r: Region): Or;

  // ---- solve/mod.rs ----
  // solve/mod.rs:116
  compute_type_outlives_goal(goal: Goal<OutlivesClause<Ty>>): QueryResultOrRerunNonErased;
  // solve/mod.rs:148
  compute_region_outlives_goal(goal: Goal<OutlivesClause<Region>>): QueryResultOrRerunNonErased;
  // solve/mod.rs:168
  compute_coerce_goal(goal: Goal<CoercePredicate>): QueryResultOrRerunNonErased;
  // solve/mod.rs:183
  compute_subtype_goal(goal: Goal<SubtypePredicate>): QueryResultOrRerunNonErased;
  // solve/mod.rs:199
  compute_dyn_compatible_goal(trait_def_id: DefId): QueryResultOrRerunNonErased;
  // solve/mod.rs:211
  compute_well_formed_goal(goal: Goal<Term>): QueryResultOrRerunNonErased;
  // solve/mod.rs:224
  compute_unstable_feature_goal(param_env: ParamEnv, symbol: Symbol): QueryResultOrRerunNonErased;
  // PORT: the destructuring parameter `Goal { param_env, predicate: ct }: Goal<I, Const<I>>` is `_0`.
  // solve/mod.rs:237
  compute_const_evaluatable_goal(_0: Goal<Const>): QueryResultOrRerunNonErased;
  // solve/mod.rs:280
  compute_const_arg_has_type_goal(goal: Goal<[Const, Ty]>): QueryResultOrRerunNonErased;
  // solve/mod.rs:337
  try_merge_candidates(candidates: readonly Candidate[]): [CanonicalResponse, MergeCandidateInfo] | undefined;
  // solve/mod.rs:384
  bail_with_ambiguity(candidates: readonly Candidate[]): CanonicalResponse;
  // solve/mod.rs:400
  flounder(candidates: readonly Candidate[]): QueryResult;
  // solve/mod.rs:414
  structurally_normalize_ty(param_env: ParamEnv, ty: Ty): Result<Ty, NoSolutionOrRerunNonErased>;
  // solve/mod.rs:429
  structurally_normalize_const(param_env: ParamEnv, ct: Const): Result<Const, NoSolutionOrRerunNonErased>;
  // solve/mod.rs:441
  structurally_normalize_term(param_env: ParamEnv, term: Term): Result<Term, NoSolutionOrRerunNonErased>;

  // ---- solve/assembly/mod.rs ----
  // solve/assembly/mod.rs:481
  assemble_and_evaluate_candidates<G>(goal: Goal<G>, assemble_from: AssembleCandidatesFrom, G: GoalKind<G>): Result<[Candidate[], FailedCandidateInfo], RerunNonErased>;
  // solve/assembly/mod.rs:568
  forced_ambiguity(maybe: MaybeInfo): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/assembly/mod.rs:587
  assemble_impl_candidates<G>(goal: Goal<G>, candidates: Candidate[], G: GoalKind<G>): Result<undefined, RerunNonErased>;
  // solve/assembly/mod.rs:609
  assemble_builtin_impl_candidates<G>(goal: Goal<G>, candidates: Candidate[], G: GoalKind<G>): Result<undefined, RerunNonErased>;
  // solve/assembly/mod.rs:737
  assemble_param_env_candidates<G>(goal: Goal<G>, candidates: Candidate[], failed_candidate_info: FailedCandidateInfo, G: GoalKind<G>): Result<undefined, RerunNonErased>;
  // solve/assembly/mod.rs:756
  assemble_alias_bound_candidates<G>(goal: Goal<G>, candidates: Candidate[], G: GoalKind<G>): Result<undefined, RerunNonErased>;
  // solve/assembly/mod.rs:790
  assemble_alias_bound_candidates_recur<G>(self_ty: Ty, goal: Goal<G>, candidates: Candidate[], consider_self_bounds: AliasBoundKind, G: GoalKind<G>): Result<undefined, RerunNonErased>;
  // solve/assembly/mod.rs:920
  assemble_object_bound_candidates<G>(goal: Goal<G>, candidates: Candidate[], G: GoalKind<G>): void;
  // solve/assembly/mod.rs:1022
  consider_coherence_unknowable_candidate<G>(goal: Goal<G>, G: GoalKind<G>): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/assembly/mod.rs:1063
  filter_specialized_impls(allow_inference_constraints: AllowInferenceConstraints, candidates: Candidate[]): void;
  // solve/assembly/mod.rs:1124
  try_assemble_bounds_via_registered_opaques<G>(goal: Goal<G>, assemble_from: AssembleCandidatesFrom, candidates: Candidate[], G: GoalKind<G>): Result<undefined, RerunNonErased>;
  // solve/assembly/mod.rs:1161 ReplaceOpaque::cx (struct local to the fn above; TypeFolder impl)
  // solve/assembly/mod.rs:1164 ReplaceOpaque::fold_ty (same)
  // solve/assembly/mod.rs:1285
  assemble_and_merge_candidates<G>(
    proven_via: TraitGoalProvenVia | undefined,
    goal: Goal<G>,
    inject_forced_ambiguity_candidate: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased> | undefined,
    inject_normalize_to_rigid_candidate: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased>,
    G: GoalKind<G>,
  ): QueryResultOrRerunNonErased;
  // solve/assembly/mod.rs:1382
  characterize_param_env_assumption(param_env: ParamEnv, assumption: Clause): Result<[CandidateSource, Certainty], NoSolution>;

  // ---- solve/effect_goals.rs ----
  // solve/effect_goals.rs:482
  compute_host_effect_goal(goal: Goal<HostEffectClause>): QueryResultOrRerunNonErased;

  // ---- solve/normalizes_to.rs ----
  // solve/normalizes_to.rs:31
  compute_normalizes_to_goal(goal: Goal<NormalizesTo>): QueryResultOrRerunNonErased;
  // solve/normalizes_to.rs:95
  push_const_arg_has_type_goal(param_env: ParamEnv, alias: AliasTerm, term: Term): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/normalizes_to.rs:137
  instantiate_normalizes_to_term(goal: Goal<NormalizesTo>, value: Term): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/normalizes_to.rs:150
  instantiate_normalizes_to_as_rigid(goal: Goal<NormalizesTo>): Result<undefined, NoSolutionOrRerunNonErased>;
  // solve/normalizes_to.rs:1097
  translate_args(goal: Goal<NormalizesTo>, impl_def_id: DefId, impl_args: GenericArgs, impl_trait_ref: TraitRef, target_container_def_id: DefId): Result<GenericArgs, NoSolutionOrRerunNonErased>;

  // ---- solve/project_goals/mod.rs ----
  // solve/project_goals/mod.rs:21
  compute_projection_goal(goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased;
  // solve/project_goals/mod.rs:44
  normalize_associated_term(goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased;

  // ---- solve/project_goals/anon_const.rs ----
  // solve/project_goals/anon_const.rs:14
  normalize_anon_const(goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased;

  // ---- solve/project_goals/free_alias.rs ----
  // solve/project_goals/free_alias.rs:18
  normalize_free_alias(goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased;

  // ---- solve/project_goals/inherent.rs ----
  // solve/project_goals/inherent.rs:19
  normalize_inherent_associated_term(goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased;
  // solve/project_goals/inherent.rs:81
  convert_inherent_self_to_impl(param_env: ParamEnv, term: AliasTerm): Result<[AliasTermKind, GenericArgs], NoSolutionOrRerunNonErased>;

  // ---- solve/project_goals/opaque_types.rs ----
  // solve/project_goals/opaque_types.rs:17
  normalize_opaque_type(goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased;

  // ---- solve/trait_goals.rs ----
  // solve/trait_goals.rs:986
  consider_builtin_dyn_upcast_candidates(goal: Goal<[Ty, Ty]>, a_data: BoundExistentialPredicates, a_region: Region, b_data: BoundExistentialPredicates, b_region: Region): Candidate[];
  // solve/trait_goals.rs:1034
  consider_builtin_unsize_to_dyn_candidate(goal: Goal<[Ty, Ty]>, b_data: BoundExistentialPredicates, b_region: Region): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1075
  consider_builtin_upcast_to_principal(
    goal: Goal<[Ty, Ty]>,
    source: CandidateSource,
    a_data: BoundExistentialPredicates,
    a_region: Region,
    b_data: BoundExistentialPredicates,
    b_region: Region,
    upcast_principal: Binder<ExistentialTraitRef> | undefined,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1215
  consider_builtin_array_unsize(goal: Goal<[Ty, Ty]>, a_elem_ty: Ty, b_elem_ty: Ty): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1239
  consider_builtin_struct_unsize(goal: Goal<[Ty, Ty]>, def: AdtDef, a_args: GenericArgs, b_args: GenericArgs): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1287
  consider_auto_trait_candidate_for_opaque_ty(goal: Goal<TraitClause>, def_id: DefId, args: GenericArgs): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1362
  disqualify_auto_trait_candidate_due_to_possible_impl(goal: Goal<TraitClause>): Result<Candidate, NoSolutionOrRerunNonErased> | undefined;
  // solve/trait_goals.rs:1473
  probe_and_evaluate_goal_for_constituent_tys(
    source: CandidateSource,
    goal: Goal<TraitClause>,
    constituent_tys: (ecx: EvalCtxt, ty: Ty) => Result<Binder<Ty[]>, NoSolution>,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1539
  unsound_prefer_builtin_dyn_impl(candidates: Candidate[]): void;
  // solve/trait_goals.rs:1570
  try_merge_impl_candidates(trait_def_id: DefId, candidates: readonly Candidate[]): CanonicalResponse | undefined;
  // solve/trait_goals.rs:1589
  merge_candidates_or_bail_with_ambiguity(candidates: readonly Candidate[], proven_via: TraitGoalProvenVia): [CanonicalResponse, TraitGoalProvenVia | undefined];
  // solve/trait_goals.rs:1601
  merge_impl_candidates_or_bail_with_ambiguity(trait_def_id: DefId, candidates: readonly Candidate[]): [CanonicalResponse, TraitGoalProvenVia | undefined];
  // solve/trait_goals.rs:1617
  merge_trait_candidates(trait_def_id: DefId, candidates: Candidate[], failed_candidate_info: FailedCandidateInfo): Result<[CanonicalResponse, TraitGoalProvenVia | undefined], NoSolution>;
  // solve/trait_goals.rs:1741
  compute_trait_goal(goal: Goal<TraitClause>): Result<[CanonicalResponse, TraitGoalProvenVia | undefined], NoSolutionOrRerunNonErased>;
  // solve/trait_goals.rs:1752
  try_stall_coroutine(self_ty: Ty): Result<Candidate, NoSolutionOrRerunNonErased> | undefined;
}
