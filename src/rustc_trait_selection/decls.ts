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
    visit_proof_tree(goal: Goal<Predicate>, visitor: ProofTreeVisitor): unknown;
    // solve/inspect/analyse.rs:403
    visit_proof_tree_at_depth(goal: Goal<Predicate>, depth: number, visitor: ProofTreeVisitor): unknown;

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
