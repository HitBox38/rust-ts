// Port of compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs (lane nts-normalizes; contract by
// evalctxt-contract). `impl<D, I> assembly::GoalKind<D> for NormalizesTo<I>` is the table `GoalKind_NormalizesTo`
// (assembly/mod.ts header): it overrides `probe_and_consider_object_bound_candidate`; the other provided methods
// forward to `GoalKind_provided`. The `EvalCtxt` methods are declared in ../decls.ts (`// solve/normalizes_to.rs:<line>`).
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): the table's entries read other modules of the crate
// only inside their bodies.
// PORT: the generic code's `I::Ty` / `I::Term` / `I::GenericArg` / `I::Clause` methods resolve to rustc_type_ir
// inherent.ts (solve/mod.ts header). TyCtxt methods whose query values are typed `unknown` in queries.gen.ts
// (`type_of`, `impl_trait_ref`, `impl_polarity`, `adt_def`) and the `Interner`-typed rustc_type_ir helpers are reached
// through `as_interner(cx)` (rustc_type_ir predicate.ts precedent).
import { type DefId, DefId_eq, debug_DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, GenericArgs, ParamEnv, Predicate, Term, Ty as TyT } from "../../rustc_middle/ty/decls.ts";
import { Term as MTerm, Ty } from "../../rustc_middle/ty/mod.ts";
import {
  Clause_upcast_from_ProjectionClause,
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_ClauseKind,
  Predicate_upcast_from_PredicateKind,
  Predicate_upcast_from_TraitRef,
} from "../../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { AliasTy, ClosureKind as ClosureKindT, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { NormalizesTo } from "../../rustc_type_ir/decls.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import { fold_tuple2, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { Clause_provided, GenericArg_provided, GenericArgs_provided, Term_provided, Ty_provided } from "../../rustc_type_ir/inherent.ts";
import { display_NormalizesTo } from "../../rustc_type_ir/ir_print.ts";
import { SolverAdtLangItem, SolverProjectionLangItem, SolverTraitLangItem } from "../../rustc_type_ir/lang_items.ts";
import { ClosureKind } from "../../rustc_type_ir/lib.ts";
import {
  as_interner,
  debug_NormalizesTo,
  fold_with_NormalizesTo,
  fold_with_ProjectionClause,
  fold_with_TraitRef,
  NormalizesTo as NormalizesToC,
  PolyProjectionClause,
  type ProjectionClause,
  TraitClause,
  TraitRef as TraitRefC,
  try_fold_with_NormalizesTo,
  try_fold_with_ProjectionClause,
  try_fold_with_TraitRef,
  visit_with_NormalizesTo,
  visit_with_ProjectionClause,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.ts";
import type { ClauseKind, PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import { relate_AliasTerm, relate_Term, relate_TraitRef, relate_Ty } from "../../rustc_type_ir/relate.ts";
import type { CandidateHeadUsages } from "../../rustc_type_ir/search_graph/mod.ts";
import { ProbeKind } from "../../rustc_type_ir/solve/inspect.ts";
import type {
  CandidateSource,
  CanonicalResponse,
  Goal as GoalT,
  GoalSource as GoalSourceT,
  NoSolution,
  QueryResultOrRerunNonErased,
  RerunNonErased,
  SizedTraitKind,
} from "../../rustc_type_ir/solve/mod.ts";
import {
  AccessedOpaques,
  BuiltinImplSource,
  Certainty,
  debug_Goal,
  Goal,
  GoalSource,
  MaybeInfo,
  NoSolutionOrRerunNonErased,
  RerunReason,
  RerunResultExt_for_Result,
} from "../../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import {
  AliasTerm,
  AliasTermKind,
  debug_AliasTermKind,
  fold_with_AliasTermKind,
  try_fold_with_AliasTermKind,
  visit_with_AliasTermKind,
} from "../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../rustc_type_ir/ty/alias.ts";
import { CoroutineArgs, CoroutineClosureSignature } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { EvalCtxt } from "../decls.ts";
import { type Candidate, type GoalKind, GoalKind_provided } from "./assembly/mod.ts";
import {
  type AsyncCallableRelevantTypes,
  extract_tupled_inputs_and_output_from_async_callable,
  extract_tupled_inputs_and_output_from_callable,
  fold_AsyncCallableRelevantTypes,
} from "./assembly/structural_traits.ts";
import { goal_with, iter_instantiated, map_iter, NO_SOLUTION } from "./mod.ts";
import type { TraitGoalProvenVia } from "./trait_goals.ts";

/** PORT: the D4 descriptors of `TraitRef` / `ProjectionClause` (generated derive fns). */
const d_TraitRef: TypeFoldable<TraitRef> = {
  visit_with: visit_with_TraitRef,
  try_fold_with: try_fold_with_TraitRef,
  fold_with: fold_with_TraitRef,
};
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};

/** PORT: `{:?}` of a `NormalizesTo<I>` (the `Alias<I, K>: Debug` bound is `debug_AliasTermKind`). */
function debug_NormalizesTo_(v: NormalizesTo, f: Fmt): string {
  return debug_NormalizesTo(v, f, debug_AliasTermKind);
}

/** PORT: `?` on a `Result<_, NoSolution>` inside a fn returning `Result<_, NoSolutionOrRerunNonErased>` (`From`). */
function from_no_solution<T>(e: NoSolution): Result<T, NoSolutionOrRerunNonErased> {
  return Err(NoSolutionOrRerunNonErased.from_NoSolution(e));
}

// rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:31 compute_normalizes_to_goal
EvalCtxt.prototype.compute_normalizes_to_goal = function (this: EvalCtxt, goal: GoalT<NormalizesTo>): QueryResultOrRerunNonErased {
  // debug_assert!(self.term_is_fully_unconstrained(goal));
  // debug_assert_matches!(
  //     goal.predicate.alias.kind,
  //     ty::AliasTermKind::ProjectionTy { .. } | ty::AliasTermKind::ProjectionConst { .. }
  // );

  const cx = this.cx();

  const trait_ref = AliasTerm.trait_ref(goal.predicate.alias, as_interner(cx));
  const r = this.probe<[CanonicalResponse, TraitGoalProvenVia | undefined]>(() => ProbeKind.ShadowedEnvProbing).enter(
    (ecx) => {
      const trait_goal: GoalT<TraitClause> = Goal.with(goal, as_interner(cx), trait_ref, TraitClause.upcast_from_TraitRef);
      return ecx.compute_trait_goal(trait_goal);
    },
  );
  if (r.$ === "Err") return r;
  const [, proven_via] = r._0;
  return this.assemble_and_merge_candidates(
    proven_via,
    goal,
    (ecx) => {
      // FIXME(generic_associated_types): Addresses aggressive inference in #92917.
      //
      // If this type is a GAT with currently unconstrained arguments, we do not
      // want to normalize it via a candidate which only applies for a specific
      // instantiation. We could otherwise keep the GAT as rigid and succeed this way.
      // See tests/ui/generic-associated-types/no-incomplete-gat-arg-inference.rs.
      //
      // This only avoids normalization if a GAT argument is fully unconstrained.
      // This is quite arbitrary but fixing it causes some ambiguity, see #125196.
      for (const arg of AliasTerm.own_args(goal.predicate.alias, as_interner(cx))) {
        const term = GenericArg_provided.as_term(arg);
        if (term === undefined) {
          continue;
        }
        const r = ecx.structurally_normalize_term(goal.param_env, term);
        if (r.$ === "Ok") {
          if (Term_provided.is_infer(r._0)) {
            return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
          }
        } else {
          // `e @ (NoSolutionOrRerunNonErased::NoSolution(NoSolution) | NoSolutionOrRerunNonErased::RerunNonErased(_))`
          return Err(r._0);
        }
      }

      return undefined;
    },
    (ecx) =>
      ecx.probe<CanonicalResponse>((result) => ({ $: "RigidAlias", result })).enter((this_) => {
        const r = this_.instantiate_normalizes_to_as_rigid(goal);
        if (r.$ === "Err") return r;
        return this_.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      }),
    GoalKind_NormalizesTo,
  );
};

/// When normalizing a const alias, register a `ConstArgHasType` goal
/// to ensure the const value's type matches the declared type.
// rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:95 push_const_arg_has_type_goal
EvalCtxt.prototype.push_const_arg_has_type_goal = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  alias: AliasTermT,
  term: Term,
): Result<undefined, NoSolutionOrRerunNonErased> {
  const ct = Term_provided.as_const(term);
  if (ct !== undefined) {
    const cx = this.cx();
    const expected_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(AliasTerm.expect_ct(alias), cx));
    const r = this.add_goal(GoalSource.Misc, {
      param_env,
      predicate: Predicate_upcast_from_ClauseKind({ $: "ConstArgHasType", _0: ct, _1: expected_ty }, cx),
    });
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
};

/// When normalizing an associated item, constrain the expected term to `value`.
///
/// Additionally, when `value` is a const, this registers a `ConstArgHasType`
/// goal to ensure that the const value's type matches the declared type of
/// the alias it was normalized from.
///
/// You may reasonably wonder: shouldn't `wfcheck::check_type_const` already
/// catch any such type mismatch at the definition site, so that the
/// definition is tainted and we never even attempt to normalize a reference
/// to it? In principle that's exactly what should happen. However, we cannot
/// simply force the defining item's wfcheck to run before all uses are
/// normalized: wfcheck itself may depend on typeck, trait solving, and
/// normalization, so enforcing such a strict ordering would easily create
/// query cycles.
///
/// However, when CTFE runs on a MIR body, normalizing a type const within
/// that body can change the type of the resulting value, causing the MIR
/// to become ill-formed. If `check_type_const` for that alias has not yet
/// reported its error, no prior error has been recorded and MIR validation
/// fires a `span_bug!`. Registering the obligation here ensures the type
/// mismatch is reported during normalization itself, tainting the MIR
/// before validation runs.
// rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:137 instantiate_normalizes_to_term
EvalCtxt.prototype.instantiate_normalizes_to_term = function (
  this: EvalCtxt,
  goal: GoalT<NormalizesTo>,
  value: Term,
): Result<undefined, NoSolutionOrRerunNonErased> {
  const r1 = this.push_const_arg_has_type_goal(goal.param_env, goal.predicate.alias, value);
  if (r1.$ === "Err") return r1;
  // While `goal.predicate.term` should always be a fully unconstrained inference variable,
  // `eq` can still fail if `value` is not fully normalized, due to `eq` eagerly normalizing,
  // and that normalization can fail.
  const r2 = this.eq(goal.param_env, goal.predicate.term, value, relate_Term);
  if (r2.$ === "Err") return r2;
  return Ok(undefined);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:150 instantiate_normalizes_to_as_rigid
EvalCtxt.prototype.instantiate_normalizes_to_as_rigid = function (
  this: EvalCtxt,
  goal: GoalT<NormalizesTo>,
): Result<undefined, NoSolutionOrRerunNonErased> {
  return this.eq(goal.param_env, goal.predicate.term, AliasTerm.to_term(goal.predicate.alias, this.cx(), "Yes"), relate_Term);
};

/** `impl<D, I> assembly::GoalKind<D> for NormalizesTo<I>` (header). */
export const GoalKind_NormalizesTo: GoalKind<NormalizesTo> = {
  visit_with: (self, visitor) => visit_with_NormalizesTo(self, visitor, visit_with_AliasTermKind),
  try_fold_with: (self, folder) => try_fold_with_NormalizesTo(self, folder, try_fold_with_AliasTermKind),
  fold_with: (self, folder) => fold_with_NormalizesTo(self, folder, fold_with_AliasTermKind),
  // PORT: derived `PartialEq` of a plain value over interned children: equal canonical keys (rust_ts/intern_key.ts).
  eq: (a, b) => intern_key(a) === intern_key(b),
  display: display_NormalizesTo,

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:167 self_ty
  self_ty(self: NormalizesTo): TyT {
    return NormalizesToC.self_ty(self);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:171 trait_ref
  trait_ref(self: NormalizesTo, cx: TyCtxt): TraitRef {
    return AliasTerm.trait_ref(self.alias, as_interner(cx));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:175 with_replaced_self_ty
  with_replaced_self_ty(self: NormalizesTo, cx: TyCtxt, self_ty: TyT): NormalizesTo {
    return NormalizesToC.with_replaced_self_ty(self, cx, self_ty);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:179 trait_def_id
  trait_def_id(self: NormalizesTo, cx: TyCtxt): DefId {
    return NormalizesToC.trait_def_id(self, as_interner(cx));
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:183 fast_reject_assumption
  fast_reject_assumption(ecx: EvalCtxt, goal: GoalT<NormalizesTo>, assumption: Clause): Result<undefined, NoSolution> {
    let alias_def_id: DefId;
    const kind = goal.predicate.alias.kind;
    switch (kind.$) {
      case "ProjectionTy":
        alias_def_id = kind.def_id;
        break;
      case "ProjectionConst":
        alias_def_id = kind.def_id;
        break;
      default:
        return Err(NO_SOLUTION);
    }
    const projection_pred = Clause_provided.as_projection_clause(assumption);
    if (
      projection_pred !== undefined &&
      DefId_eq(PolyProjectionClause.item_def_id(projection_pred), alias_def_id) &&
      DeepRejectCtxt.relate_rigid_rigid(as_interner(ecx.cx())).args_may_unify(
        goal.predicate.alias.args,
        Binder.skip_binder(projection_pred).projection_term.args,
      )
    ) {
      return Ok(undefined);
    } else {
      return Err(NO_SOLUTION);
    }
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:206 match_assumption
  match_assumption(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
    assumption: Clause,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): QueryResultOrRerunNonErased {
    const cx = ecx.cx();
    const projection_pred = unwrap(Clause_provided.as_projection_clause(assumption));
    const assumption_projection_pred = ecx.instantiate_binder_with_infer(projection_pred, d_ProjectionClause);
    const r1 = ecx.eq(goal.param_env, goal.predicate.alias, assumption_projection_pred.projection_term, relate_AliasTerm);
    if (r1.$ === "Err") return r1;

    const r2 = ecx.instantiate_normalizes_to_term(goal, assumption_projection_pred.term);
    if (r2.$ === "Err") return r2;

    // Add GAT where clauses from the trait's definition
    // FIXME: We don't need these, since these are the type's own WF obligations.
    const r3 = ecx.add_goals(
      GoalSource.AliasWellFormed,
      map_iter(
        map_iter(
          iter_instantiated(
            cx.own_clauses_of(AliasTerm.expect_projection_def_id(goal.predicate.alias)),
            cx,
            goal.predicate.alias.args,
            fold_Clause,
          ),
          Unnormalized.skip_norm_wip,
        ),
        (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
      ),
    );
    if (r3.$ === "Err") return r3;

    return then(ecx);
  },

  // Hack for trait-system-refactor-initiative#245.
  // FIXME(-Zhigher-ranked-assumptions): this impl differs from trait goals and we should unify
  // them again once we properly support binders.
  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:235 probe_and_consider_object_bound_candidate
  probe_and_consider_object_bound_candidate(
    ecx: EvalCtxt,
    source: CandidateSource,
    goal: GoalT<NormalizesTo>,
    assumption: Clause,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_NormalizesTo.probe_and_match_goal_against_assumption(ecx, source, goal, assumption, (ecx) =>
      ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes),
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:246 consider_additional_alias_assumptions
  consider_additional_alias_assumptions(_ecx: EvalCtxt, _goal: GoalT<NormalizesTo>, _alias_ty: AliasTy): Candidate[] {
    return [];
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:254 consider_impl_candidate
  consider_impl_candidate(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
    goal_trait_ref: TraitRef,
    impl_def_id: DefId,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();

    const alias_def_id = AliasTerm.expect_projection_def_id(goal.predicate.alias);
    const impl_trait_ref = as_interner(cx).impl_trait_ref(impl_def_id);
    if (
      !DeepRejectCtxt.relate_rigid_infer(as_interner(ecx.cx())).args_may_unify(
        goal_trait_ref.args,
        EarlyBinder.skip_binder(impl_trait_ref).args,
      )
    ) {
      return from_no_solution(NO_SOLUTION);
    }

    // For every `default impl`, there's always a non-default `impl` that will *also* apply.
    // There's no reason to register a candidate for this impl, since it is *not* proof that
    // the trait goal holds.
    if (cx.impl_is_default(impl_def_id)) {
      return from_no_solution(NO_SOLUTION);
    }

    // We have to ignore negative impls when projecting.
    const impl_polarity = as_interner(cx).impl_polarity(impl_def_id);
    switch (impl_polarity) {
      case "Negative":
        return from_no_solution(NO_SOLUTION);
      case "Positive":
        break;
    }

    return ecx.probe_trait_candidate({ $: "Impl", _0: impl_def_id }).enter((ecx) => {
      const impl_args = ecx.fresh_args_for_item(impl_def_id);
      const impl_trait_ref_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(impl_trait_ref, cx, impl_args, d_TraitRef));

      const r1 = ecx.eq(goal.param_env, goal_trait_ref, impl_trait_ref_, relate_TraitRef);
      if (r1.$ === "Err") return r1;

      const where_clause_bounds = map_iter(
        map_iter(iter_instantiated(cx.ir_clauses_of(impl_def_id), cx, impl_args, fold_Clause), Unnormalized.skip_norm_wip),
        (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
      );
      const r2 = ecx.add_goals(GoalSource.ImplWhereBound, where_clause_bounds);
      if (r2.$ === "Err") return r2;

      // Bail if the nested goals don't hold here. This is to avoid unnecessarily
      // computing the `type_of` query for associated types that never apply, as
      // this may result in query cycles in the case of RPITITs.
      // See <https://github.com/rust-lang/trait-system-refactor-initiative/issues/185>.
      const r3 = ecx.try_evaluate_added_goals();
      if (r3.$ === "Err") return r3;

      // Add GAT where clauses from the trait's definition. This is necessary
      // for soundness until we properly handle implied bounds on binders,
      // see tests/ui/generic-associated-types/must-prove-where-clauses-on-norm.rs.
      const r4 = ecx.add_goals(
        GoalSource.AliasWellFormed,
        map_iter(
          map_iter(
            iter_instantiated(cx.own_clauses_of(alias_def_id), cx, goal.predicate.alias.args, fold_Clause),
            Unnormalized.skip_norm_wip,
          ),
          (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
        ),
      );
      if (r4.$ === "Err") return r4;

      const error_response = (ecx: EvalCtxt, guar: ErrorGuaranteed): QueryResultOrRerunNonErased => {
        let error_term: Term;
        const kind = goal.predicate.alias.kind;
        switch (kind.$) {
          case "ProjectionTy":
            error_term = MTerm.from_Ty(Ty.new_error(cx, guar));
            break;
          case "ProjectionConst":
            error_term = MTerm.from_Const(Const.new_error(cx, guar));
            break;
          default:
            return panic(`expected projection, found ${debug_AliasTermKind(kind, PLAIN)}`);
        }
        const r = ecx.instantiate_normalizes_to_term(goal, error_term);
        if (r.$ === "Err") return r;
        return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      };

      let target_item_def_id: DefId;
      const resp = ecx.fetch_eligible_assoc_item(goal_trait_ref, alias_def_id, impl_def_id);
      switch (resp.$) {
        case "Found":
          target_item_def_id = resp._0;
          break;
        case "NotFound": {
          const tm = resp._0;
          switch (tm.$) {
            // In case the associated item is hidden due to specialization,
            // normalizing this associated item is always ambiguous. Treating
            // the associated item as rigid would be incomplete and allow for
            // overlapping impls, see #105782.
            //
            // As this ambiguity is unavoidable we emit a nested ambiguous
            // goal instead of using `Certainty::AMBIGUOUS`. This allows us to
            // return the nested goals to the parent `AliasRelate` goal. This
            // would be relevant if any of the nested goals refer to the `term`.
            // This is not the case here and we only prefer adding an ambiguous
            // nested goal for consistency.
            case "Coherence": {
              const r = ecx.add_goal(
                GoalSource.Misc,
                goal_with(goal, cx, { $: "Ambiguous" } as PredicateKind, Predicate_upcast_from_PredicateKind),
              );
              if (r.$ === "Err") return r;
              return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
            }
            // Outside of coherence, we treat the associated item as rigid instead.
            case "Typeck":
            case "PostTypeckUntilBorrowck":
            case "PostBorrowck":
            case "PostAnalysis":
            case "Reflection":
            case "Codegen": {
              const r = ecx.instantiate_normalizes_to_as_rigid(goal);
              if (r.$ === "Err") return r;
              return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
            }
            default:
              // PORT: `TypingMode<CantBeErased>` has no `ErasedNotCoherence` value (`tm._0` is `never`).
              return tm._0;
          }
        }
        case "Err":
          return error_response(ecx, resp._0);
        case "NotFoundBecauseErased": {
          const r = AccessedOpaques.rerun_always(ecx.opaque_accesses, RerunReason.FetchEligibleAssocItem);
          if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
          return r._0;
        }
      }

      if (!cx.has_item_definition(target_item_def_id)) {
        // If the impl is missing an item, it's either because the user forgot to
        // provide it, or the user is not *obligated* to provide it (because it
        // has a trivially false `Sized` predicate). If it's the latter, we cannot
        // delay a bug because we can have trivially false where clauses, so we
        // treat it as rigid.
        if (cx.impl_self_is_guaranteed_unsized(impl_def_id)) {
          if (TypingMode.is_coherence(ecx.typing_mode())) {
            // Trying to normalize such associated items is always ambiguous
            // during coherence to avoid cyclic reasoning. See the example in
            // tests/ui/traits/trivial-unsized-projection-in-coherence.rs.
            //
            // As this ambiguity is unavoidable we emit a nested ambiguous
            // goal instead of using `Certainty::AMBIGUOUS`. This allows us to
            // return the nested goals to the parent `AliasRelate` goal. This
            // would be relevant if any of the nested goals refer to the `term`.
            // This is not the case here and we only prefer adding an ambiguous
            // nested goal for consistency.
            const r = ecx.add_goal(
              GoalSource.Misc,
              goal_with(goal, cx, { $: "Ambiguous" } as PredicateKind, Predicate_upcast_from_PredicateKind),
            );
            if (r.$ === "Err") return r;
            return then(ecx);
          } else {
            const r = ecx.instantiate_normalizes_to_as_rigid(goal);
            if (r.$ === "Err") return r;
            return then(ecx);
          }
        } else {
          return error_response(ecx, cx.delay_bug("missing item"));
        }
      }

      const target_container_def_id = cx.impl_or_trait_assoc_term_parent(target_item_def_id);

      // Getting the right args here is complex, e.g. given:
      // - a goal `<Vec<u32> as Trait<i32>>::Assoc<u64>`
      // - the applicable impl `impl<T> Trait<i32> for Vec<T>`
      // - and the impl which defines `Assoc` being `impl<T, U> Trait<U> for Vec<T>`
      //
      // We first rebase the goal args onto the impl, going from `[Vec<u32>, i32, u64]`
      // to `[u32, u64]`.
      //
      // And then map these args to the args of the defining impl of `Assoc`, going
      // from `[u32, u64]` to `[u32, i32, u64]`.
      const target_args_r = ecx.translate_args(goal, impl_def_id, impl_args, impl_trait_ref_, target_container_def_id);
      if (target_args_r.$ === "Err") return target_args_r;
      const target_args = target_args_r._0;

      // PORT: `let target_item_def_id: I::DefId = target_item_def_id.into();` (every `I::*Id` is `DefId`).

      let target_item_kind: AliasTermKind;
      if (AliasTermKind.is_type(goal.predicate.alias.kind)) {
        target_item_kind = { $: "ProjectionTy", def_id: target_item_def_id };
      } else {
        target_item_kind = { $: "ProjectionConst", def_id: target_item_def_id };
      }

      if (!cx.check_alias_term_args_compatible(target_item_kind, target_args)) {
        return error_response(ecx, cx.delay_bug("associated item has mismatched arguments"));
      }

      // Finally we construct the actual value of the associated type.
      let term: Term;
      let c;
      if (target_item_kind.$ === "ProjectionTy") {
        const t = EarlyBinder.instantiate(as_interner(cx).type_of(target_item_def_id), cx, target_args, fold_Ty);
        const t_ = ecx.normalize(goal.param_env, t, fold_Ty);
        if (t_.$ === "Err") return t_;
        term = MTerm.from_Ty(t_._0);
      } else if (
        target_item_kind.$ === "ProjectionConst" &&
        (c = cx.ir_const_of_item({ $: "Projection", def_id: target_item_kind.def_id })) !== undefined
      ) {
        const c_ = EarlyBinder.instantiate(c, cx, target_args, fold_Const);
        const c__ = ecx.normalize(goal.param_env, c_, fold_Const);
        if (c__.$ === "Err") return c__;
        term = MTerm.from_Const(c__._0);
      } else if (target_item_kind.$ === "ProjectionConst") {
        const alias_const = AliasConst.new(cx, { $: "Projection", def_id: target_item_def_id }, target_args);
        return ecx.evaluate_const_and_instantiate_projection_term(
          goal.param_env,
          goal.predicate.alias,
          goal.predicate.term,
          alias_const,
        );
      } else {
        return panic(`expected projection, found ${debug_AliasTermKind(target_item_kind, PLAIN)}`);
      }

      const r5 = ecx.instantiate_normalizes_to_term(goal, term);
      if (r5.$ === "Err") return r5;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  /// Fail to normalize if the predicate contains an error, alternatively, we could normalize to `ty::Error`
  /// and succeed. Can experiment with this to figure out what results in better error messages.
  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:478 consider_error_guaranteed_candidate
  consider_error_guaranteed_candidate(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
    guar: ErrorGuaranteed,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();
    let error_term: Term;
    const kind = goal.predicate.alias.kind;
    switch (kind.$) {
      case "ProjectionTy":
        error_term = MTerm.from_Ty(Ty.new_error(cx, guar));
        break;
      case "ProjectionConst":
        error_term = MTerm.from_Const(Const.new_error(cx, guar));
        break;
      default:
        return panic(`expected projection, found ${debug_AliasTermKind(kind, PLAIN)}`);
    }

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.instantiate_normalizes_to_term(goal, error_term);
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:496 consider_auto_trait_candidate
  consider_auto_trait_candidate(ecx: EvalCtxt, _goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    ecx.cx().delay_bug("associated types not allowed on auto traits");
    return from_no_solution(NO_SOLUTION);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:504 consider_trait_alias_candidate
  consider_trait_alias_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`trait aliases do not have associated types: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:511 consider_builtin_sizedness_candidates
  consider_builtin_sizedness_candidates(
    _ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
    _sizedness: SizedTraitKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`Sized\`/\`MetaSized\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:519 consider_builtin_copy_clone_candidate
  consider_builtin_copy_clone_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`Copy\`/\`Clone\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:526 consider_builtin_fn_ptr_trait_candidate
  consider_builtin_fn_ptr_trait_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`FnPtr\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:533 consider_builtin_fn_trait_candidates
  consider_builtin_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
    goal_kind: ClosureKindT,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();
    const extracted = extract_tupled_inputs_and_output_from_callable(cx, NormalizesToC.self_ty(goal.predicate), goal_kind);
    if (extracted.$ === "Err") return from_no_solution(extracted._0);
    const tupled_inputs_and_output = extracted._0;
    if (tupled_inputs_and_output === undefined) {
      return ecx.forced_ambiguity(MaybeInfo.AMBIGUOUS);
    }
    const [inputs, output] = ecx.instantiate_binder_with_infer(tupled_inputs_and_output, fold_tuple2(fold_Ty, fold_Ty));

    // A built-in `Fn` impl only holds if the output is sized.
    // (FIXME: technically we only need to check this if the type is a fn ptr...)
    const output_is_sized_pred = TraitRefC.new(as_interner(cx), cx.require_trait_lang_item(SolverTraitLangItem.Sized), [output]);

    const pred = Clause_upcast_from_ProjectionClause(
      {
        projection_term: AliasTerm.new(cx, goal.predicate.alias.kind, [NormalizesToC.self_ty(goal.predicate), inputs]),
        term: MTerm.from_Ty(output),
      },
      cx,
    );

    return GoalKind_NormalizesTo.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource.Misc },
      goal,
      pred,
      [[GoalSource.ImplWhereBound, goal_with(goal, cx, output_is_sized_pred, Predicate_upcast_from_TraitRef)]],
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:574 consider_builtin_async_fn_trait_candidates
  consider_builtin_async_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
    goal_kind: ClosureKindT,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();
    const def_id = AliasTerm.expect_projection_ty_def_id(goal.predicate.alias);

    let env_region: Region;
    switch (goal_kind) {
      case "Fn":
      case "FnMut":
        env_region = goal.predicate.alias.args.region_at(2);
        break;
      // Doesn't matter what this region is
      case "FnOnce":
        env_region = Region.new_static(cx);
        break;
    }
    const extracted = extract_tupled_inputs_and_output_from_async_callable(
      cx,
      NormalizesToC.self_ty(goal.predicate),
      goal_kind,
      env_region,
    );
    if (extracted.$ === "Err") return from_no_solution(extracted._0);
    const [tupled_inputs_and_output_and_coroutine, nested_preds] = extracted._0;
    const { tupled_inputs_ty, output_coroutine_ty, coroutine_return_ty }: AsyncCallableRelevantTypes =
      ecx.instantiate_binder_with_infer(tupled_inputs_and_output_and_coroutine, fold_AsyncCallableRelevantTypes);

    // A built-in `AsyncFn` impl only holds if the output is sized.
    // (FIXME: technically we only need to check this if the type is a fn ptr...)
    const output_is_sized_pred = TraitRefC.new(
      as_interner(cx),
      cx.require_trait_lang_item(SolverTraitLangItem.Sized),
      [output_coroutine_ty],
    );

    let projection_term: AliasTermT;
    let term: Term;
    if (cx.is_projection_lang_item(def_id, SolverProjectionLangItem.CallOnceFuture)) {
      [projection_term, term] = [
        AliasTerm.new(cx, goal.predicate.alias.kind, [NormalizesToC.self_ty(goal.predicate), tupled_inputs_ty]),
        MTerm.from_Ty(output_coroutine_ty),
      ];
    } else if (cx.is_projection_lang_item(def_id, SolverProjectionLangItem.CallRefFuture)) {
      [projection_term, term] = [
        AliasTerm.new(cx, goal.predicate.alias.kind, [NormalizesToC.self_ty(goal.predicate), tupled_inputs_ty, env_region]),
        MTerm.from_Ty(output_coroutine_ty),
      ];
    } else if (cx.is_projection_lang_item(def_id, SolverProjectionLangItem.AsyncFnOnceOutput)) {
      [projection_term, term] = [
        AliasTerm.new(cx, goal.predicate.alias.kind, [NormalizesToC.self_ty(goal.predicate), tupled_inputs_ty]),
        MTerm.from_Ty(coroutine_return_ty),
      ];
    } else {
      return panic(`no such associated type in \`AsyncFn*\`: ${debug_DefId(def_id, PLAIN)}`);
    }
    const pred = Clause_upcast_from_ProjectionClause({ projection_term, term }, cx);

    return GoalKind_NormalizesTo.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource.Misc },
      goal,
      pred,
      map_iter(
        (function* (): Generator<GoalT<Predicate>> {
          yield goal_with(goal, cx, output_is_sized_pred, Predicate_upcast_from_TraitRef);
          yield* map_iter(nested_preds, (pred) => goal_with(goal, cx, pred, (p: Predicate) => p));
        })(),
        (goal): [GoalSourceT, GoalT<Predicate>] => [GoalSource.ImplWhereBound, goal],
      ),
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:658 consider_builtin_async_fn_kind_helper_candidate
  consider_builtin_async_fn_kind_helper_candidate(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const args = goal.predicate.alias.args;
    if (args.length !== 6) {
      return panic();
    }
    const [
      closure_fn_kind_ty,
      goal_kind_ty,
      borrow_region,
      tupled_inputs_ty,
      tupled_upvars_ty,
      coroutine_captures_by_ref_ty,
    ] = args as unknown as readonly [typeof args[0], typeof args[0], typeof args[0], typeof args[0], typeof args[0], typeof args[0]];

    // Bail if the upvars haven't been constrained.
    if (Ty_provided.is_ty_var(GenericArg_provided.expect_ty(tupled_upvars_ty))) {
      return ecx.forced_ambiguity(MaybeInfo.AMBIGUOUS);
    }

    const closure_kind = GenericArg_provided.expect_ty(closure_fn_kind_ty).to_opt_closure_kind();
    if (closure_kind === undefined) {
      // We don't need to worry about the self type being an infer var.
      return from_no_solution(NO_SOLUTION);
    }
    const goal_kind = GenericArg_provided.expect_ty(goal_kind_ty).to_opt_closure_kind();
    if (goal_kind === undefined) {
      return from_no_solution(NO_SOLUTION);
    }
    if (!ClosureKind.extends(closure_kind, goal_kind)) {
      return from_no_solution(NO_SOLUTION);
    }

    const upvars_ty = CoroutineClosureSignature.tupled_upvars_by_closure_kind(
      ecx.cx(),
      goal_kind,
      GenericArg_provided.expect_ty(tupled_inputs_ty),
      GenericArg_provided.expect_ty(tupled_upvars_ty),
      GenericArg_provided.expect_ty(coroutine_captures_by_ref_ty),
      GenericArg_provided.expect_region(borrow_region),
    );

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.instantiate_normalizes_to_term(goal, MTerm.from_Ty(upvars_ty));
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:705 consider_builtin_tuple_candidate
  consider_builtin_tuple_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`Tuple\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:712 consider_builtin_pointee_candidate
  consider_builtin_pointee_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const cx = ecx.cx();
    const metadata_def_id = cx.require_projection_lang_item(SolverProjectionLangItem.Metadata);
    assert_eq<AliasTermKind>(
      { $: "ProjectionTy", def_id: metadata_def_id },
      goal.predicate.alias.kind,
      (v) => debug_AliasTermKind(v, PLAIN),
      (a, b) => intern_key(a) === intern_key(b),
    );
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const unexpected = (): never =>
      panic(
        `unexpected self ty \`${debug_Ty(NormalizesToC.self_ty(goal.predicate), PLAIN)}\` when normalizing \`<T as Pointee>::Metadata\``,
      );
    let metadata_ty: TyT;
    const k = self_ty.kind();
    switch (k.$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Array":
      case "Pat":
      case "RawPtr":
      case "Ref":
      case "FnDef":
      case "FnPtr":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Never":
      case "Foreign":
        metadata_ty = Ty.new_unit(cx);
        break;
      case "Infer":
        if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
          metadata_ty = Ty.new_unit(cx);
          break;
        }
        // `ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))`
        return unexpected();

      case "Error":
        metadata_ty = Ty.new_error(cx, k._0);
        break;

      case "Str":
      case "Slice":
        metadata_ty = Ty.new_usize(cx);
        break;

      case "Dynamic": {
        const dyn_metadata = cx.require_adt_lang_item(SolverAdtLangItem.DynMetadata);
        metadata_ty = Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(as_interner(cx).type_of(dyn_metadata), cx, [NormalizesToC.self_ty(goal.predicate)], fold_Ty),
        );
        break;
      }

      case "Alias":
      case "Param":
      case "Placeholder": {
        if (k.$ === "Alias" && k._0 === "No") {
          // `ty::Alias(ty::IsRigid::No, _)`
          return unexpected();
        }
        // This is the "fallback impl" for type parameters, unnormalizable projections
        // and opaque types: If the `self_ty` is `Sized`, then the metadata is `()`.
        // FIXME(ptr_metadata): This impl overlaps with the other impls and shouldn't
        // exist. Instead, `Pointee<Metadata = ()>` should be a supertrait of `Sized`.
        const alias_bound_result_r = RerunResultExt_for_Result.map_err_to_rerun(
          ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
            const sized_predicate = TraitRefC.new(as_interner(cx), cx.require_trait_lang_item(SolverTraitLangItem.Sized), [
              NormalizesToC.self_ty(goal.predicate),
            ]);
            const r1 = ecx.add_goal(GoalSource.Misc, goal_with(goal, cx, sized_predicate, Predicate_upcast_from_TraitRef));
            if (r1.$ === "Err") return r1;
            const r2 = ecx.instantiate_normalizes_to_term(goal, MTerm.from_Ty(Ty.new_unit(cx)));
            if (r2.$ === "Err") return r2;
            return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
          }),
        );
        if (alias_bound_result_r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(alias_bound_result_r._0));
        const alias_bound_result = alias_bound_result_r._0;

        // In case the dummy alias-bound candidate does not apply, we instead treat this projection
        // as rigid.
        if (alias_bound_result.$ === "Ok") return Ok(alias_bound_result._0);
        return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((this_) => {
          const r = this_.instantiate_normalizes_to_as_rigid(goal);
          if (r.$ === "Err") return r;
          return this_.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
        });
      }

      case "Adt": {
        const def = k._0;
        const args = k._1;
        if (def.is_struct()) {
          const tail_ty = def.struct_tail_ty(cx);
          if (tail_ty === undefined) {
            metadata_ty = Ty.new_unit(cx);
          } else {
            metadata_ty = Ty_provided.new_projection(cx, "No", metadata_def_id, [
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tail_ty, cx, args, fold_Ty)),
            ]);
          }
        } else {
          metadata_ty = Ty.new_unit(cx);
        }
        break;
      }

      case "Tuple": {
        const elements = k._0;
        const tail_ty = elements.length === 0 ? undefined : elements[elements.length - 1];
        if (tail_ty === undefined) {
          metadata_ty = Ty.new_unit(cx);
        } else {
          metadata_ty = Ty_provided.new_projection(cx, "No", metadata_def_id, [tail_ty]);
        }
        break;
      }

      case "UnsafeBinder":
        // FIXME(unsafe_binder): Figure out how to handle pointee for unsafe binders.
        return panic("not implemented");

      case "Bound":
        return unexpected();
    }

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.instantiate_normalizes_to_term(goal, MTerm.from_Ty(metadata_ty));
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:819 consider_builtin_future_candidate
  consider_builtin_future_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const k = self_ty.kind();
    if (k.$ !== "Coroutine") {
      return from_no_solution(NO_SOLUTION);
    }
    const def_id = k._0;
    const args = k._1;

    // Coroutines are not futures unless they come from `async` desugaring
    const cx = ecx.cx();
    if (!cx.coroutine_is_async(def_id)) {
      return from_no_solution(NO_SOLUTION);
    }

    const term = MTerm.from_Ty(CoroutineArgs.return_ty(GenericArgs_provided.as_coroutine(args)));

    return GoalKind_NormalizesTo.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource.Misc },
      goal,
      Clause_upcast_from_ProjectionClause(
        {
          projection_term: AliasTerm.new(ecx.cx(), goal.predicate.alias.kind, [self_ty]),
          term,
        },
        cx,
      ),
      // Technically, we need to check that the future type is Sized,
      // but that's already proven by the coroutine being WF.
      [],
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:851 consider_builtin_iterator_candidate
  consider_builtin_iterator_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const k = self_ty.kind();
    if (k.$ !== "Coroutine") {
      return from_no_solution(NO_SOLUTION);
    }
    const def_id = k._0;
    const args = k._1;

    // Coroutines are not Iterators unless they come from `gen` desugaring
    const cx = ecx.cx();
    if (!cx.coroutine_is_gen(def_id)) {
      return from_no_solution(NO_SOLUTION);
    }

    const term = MTerm.from_Ty(CoroutineArgs.yield_ty(GenericArgs_provided.as_coroutine(args)));

    return GoalKind_NormalizesTo.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource.Misc },
      goal,
      Clause_upcast_from_ProjectionClause(
        {
          projection_term: AliasTerm.new(ecx.cx(), goal.predicate.alias.kind, [self_ty]),
          term,
        },
        cx,
      ),
      // Technically, we need to check that the iterator type is Sized,
      // but that's already proven by the generator being WF.
      [],
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:883 consider_builtin_fused_iterator_candidate
  consider_builtin_fused_iterator_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`FusedIterator\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:890 consider_builtin_async_iterator_candidate
  consider_builtin_async_iterator_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const k = self_ty.kind();
    if (k.$ !== "Coroutine") {
      return from_no_solution(NO_SOLUTION);
    }
    const def_id = k._0;
    const args = k._1;

    // Coroutines are not AsyncIterators unless they come from `gen` desugaring
    const cx = ecx.cx();
    if (!cx.coroutine_is_async_gen(def_id)) {
      return from_no_solution(NO_SOLUTION);
    }

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const expected_ty = ecx.next_ty_infer();
      // Take `AsyncIterator<Item = I>` and turn it into the corresponding
      // coroutine yield ty `Poll<Option<I>>`.
      const wrapped_expected_ty = Ty.new_adt(
        cx,
        as_interner(cx).adt_def(cx.require_adt_lang_item(SolverAdtLangItem.Poll)),
        cx.mk_args([
          Ty.new_adt(
            cx,
            as_interner(cx).adt_def(cx.require_adt_lang_item(SolverAdtLangItem.Option)),
            cx.mk_args([expected_ty]),
          ),
        ]),
      );
      const yield_ty = CoroutineArgs.yield_ty(GenericArgs_provided.as_coroutine(args));
      const r1 = ecx.eq(goal.param_env, wrapped_expected_ty, yield_ty, relate_Ty);
      if (r1.$ === "Err") return r1;
      const r2 = ecx.instantiate_normalizes_to_term(goal, MTerm.from_Ty(expected_ty));
      if (r2.$ === "Err") return r2;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:926 consider_builtin_coroutine_candidate
  consider_builtin_coroutine_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const k = self_ty.kind();
    if (k.$ !== "Coroutine") {
      return from_no_solution(NO_SOLUTION);
    }
    const args = k._1;

    // `async`-desugared coroutines do not implement the coroutine trait
    const cx = ecx.cx();
    if (!cx.is_general_coroutine(k._0)) {
      return from_no_solution(NO_SOLUTION);
    }

    const coroutine = GenericArgs_provided.as_coroutine(args);
    const def_id = AliasTerm.expect_projection_ty_def_id(goal.predicate.alias);

    let term: Term;
    if (cx.is_projection_lang_item(def_id, SolverProjectionLangItem.CoroutineReturn)) {
      term = MTerm.from_Ty(CoroutineArgs.return_ty(coroutine));
    } else if (cx.is_projection_lang_item(def_id, SolverProjectionLangItem.CoroutineYield)) {
      term = MTerm.from_Ty(CoroutineArgs.yield_ty(coroutine));
    } else {
      return panic(`unexpected associated item \`${debug_DefId(def_id, PLAIN)}\` for \`${debug_Ty(self_ty, PLAIN)}\``);
    }

    return GoalKind_NormalizesTo.probe_and_consider_implied_clause(
      ecx,
      { $: "BuiltinImpl", _0: BuiltinImplSource.Misc },
      goal,
      Clause_upcast_from_ProjectionClause(
        {
          projection_term: AliasTerm.new(ecx.cx(), goal.predicate.alias.kind, [self_ty, CoroutineArgs.resume_ty(coroutine)]),
          term,
        },
        cx,
      ),
      // Technically, we need to check that the coroutine type is Sized,
      // but that's already proven by the coroutine being WF.
      [],
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:972 consider_structural_builtin_unsize_candidates
  consider_structural_builtin_unsize_candidates(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate[], RerunNonErased> {
    return panic(`\`Unsize\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:979 consider_builtin_discriminant_kind_candidate
  consider_builtin_discriminant_kind_candidate(
    ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const unexpected = (): never =>
      panic(
        `unexpected self ty \`${debug_Ty(NormalizesToC.self_ty(goal.predicate), PLAIN)}\` when normalizing \`<T as DiscriminantKind>::Discriminant\``,
      );
    let discriminant_ty: TyT;
    const k = self_ty.kind();
    switch (k.$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Array":
      case "Pat":
      case "RawPtr":
      case "Ref":
      case "FnDef":
      case "FnPtr":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Never":
      case "Foreign":
      case "Adt":
      case "Str":
      case "Slice":
      case "Dynamic":
      case "Tuple":
      case "Error":
        discriminant_ty = self_ty.discriminant_ty(ecx.cx());
        break;
      case "Infer":
        if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
          discriminant_ty = self_ty.discriminant_ty(ecx.cx());
          break;
        }
        // `ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))`
        return unexpected();

      case "UnsafeBinder":
        // FIXME(unsafe_binders): instantiate this with placeholders?? i guess??
        return panic("not implemented: discr subgoal...");

      // Given an alias, parameter, or placeholder we add an impl candidate normalizing to a rigid
      // alias. In case there's a where-bound further constraining this alias it is preferred over
      // this impl candidate anyways. It's still a bit scuffed.
      case "Alias":
      case "Param":
      case "Placeholder":
        if (k.$ === "Alias" && k._0 === "No") {
          // `ty::Alias(ty::IsRigid::No, _)`
          return unexpected();
        }
        return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
          const r = ecx.instantiate_normalizes_to_as_rigid(goal);
          if (r.$ === "Err") return r;
          return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
        });

      case "Bound":
        return unexpected();
    }

    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.instantiate_normalizes_to_term(goal, MTerm.from_Ty(discriminant_ty));
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:1039 consider_builtin_destruct_candidate
  consider_builtin_destruct_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`Destruct\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:1046 consider_builtin_transmute_candidate
  consider_builtin_transmute_candidate(_ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return panic(`\`TransmuteFrom\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`);
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:1053 consider_builtin_bikeshed_guaranteed_no_drop_candidate
  consider_builtin_bikeshed_guaranteed_no_drop_candidate(
    _ecx: EvalCtxt,
    goal: GoalT<NormalizesTo>,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unreachable(
      `internal error: entered unreachable code: \`BikeshedGuaranteedNoDrop\` does not have an associated type: ${debug_Goal(goal, PLAIN, debug_NormalizesTo_)}`,
    );
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:1060 consider_builtin_field_candidate
  consider_builtin_field_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    const self_ty = NormalizesToC.self_ty(goal.predicate);
    const k = self_ty.kind();
    if (k.$ !== "Adt") {
      return from_no_solution(NO_SOLUTION);
    }
    const def = k._0;
    const args = k._1;
    const info = def.field_representing_type_info(ecx.cx(), args);
    if (info === undefined) {
      return from_no_solution(NO_SOLUTION);
    }
    const { base, ty: ty_ } = info;
    const def_id = AliasTerm.expect_projection_ty_def_id(goal.predicate.alias);
    let ty: TyT;
    switch (ecx.cx().as_projection_lang_item(def_id)) {
      case SolverProjectionLangItem.FieldBase:
        ty = base;
        break;
      case SolverProjectionLangItem.FieldType:
        ty = ty_;
        break;
      default:
        return panic(`unexpected associated type ${debug_NormalizesTo_(goal.predicate, PLAIN)} in \`Field\``);
    }
    return ecx.probe_builtin_trait_candidate(BuiltinImplSource.Misc).enter((ecx) => {
      const r = ecx.instantiate_normalizes_to_term(goal, MTerm.from_Ty(ty));
      if (r.$ === "Err") return r;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:1084 consider_builtin_try_as_dyn_candidate
  consider_builtin_try_as_dyn_candidate(_ecx: EvalCtxt, _goal: GoalT<NormalizesTo>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unreachable("internal error: entered unreachable code: try_as_dyn helper trait doesn't have assoc types");
  },

  // (provided, not overridden)
  probe_and_consider_implied_clause(ecx: EvalCtxt, parent_source: CandidateSource, goal: GoalT<NormalizesTo>, assumption: Clause, requirements: Iterable<[GoalSourceT, GoalT<Predicate>]>): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_consider_implied_clause(GoalKind_NormalizesTo, ecx, parent_source, goal, assumption, requirements);
  },

  // (provided, not overridden)
  probe_and_consider_param_env_candidate(ecx: EvalCtxt, goal: GoalT<NormalizesTo>, assumption: Clause): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased> {
    return GoalKind_provided.probe_and_consider_param_env_candidate(GoalKind_NormalizesTo, ecx, goal, assumption);
  },

  // (provided, not overridden)
  probe_and_match_goal_against_assumption(ecx: EvalCtxt, source: CandidateSource, goal: GoalT<NormalizesTo>, assumption: Clause, then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased): Result<Candidate, NoSolutionOrRerunNonErased> {
    return GoalKind_provided.probe_and_match_goal_against_assumption(GoalKind_NormalizesTo, ecx, source, goal, assumption, then);
  },

};

// rustc: compiler/rustc_next_trait_solver/src/solve/normalizes_to.rs:1097 translate_args
EvalCtxt.prototype.translate_args = function (
  this: EvalCtxt,
  goal: GoalT<NormalizesTo>,
  impl_def_id: DefId,
  impl_args: GenericArgs,
  impl_trait_ref: TraitRef,
  target_container_def_id: DefId,
): Result<GenericArgs, NoSolutionOrRerunNonErased> {
  const cx = this.cx();
  if (DefId_eq(target_container_def_id, impl_trait_ref.def_id)) {
    // Default value from the trait definition. No need to rebase.
    return Ok(goal.predicate.alias.args);
  } else if (DefId_eq(target_container_def_id, impl_def_id)) {
    // Same impl, no need to fully translate, just a rebase from
    // the trait is sufficient.
    return Ok(goal.predicate.alias.args.rebase_onto(cx, impl_trait_ref.def_id, impl_args));
  } else {
    const target_args = this.fresh_args_for_item(target_container_def_id);
    const target_trait_ref = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(as_interner(cx).impl_trait_ref(target_container_def_id), cx, target_args, d_TraitRef),
    );
    // Relate source impl to target impl by equating trait refs.
    const r1 = this.eq(goal.param_env, impl_trait_ref, target_trait_ref, relate_TraitRef);
    if (r1.$ === "Err") return r1;
    // Also add predicates since they may be needed to constrain the
    // target impl's params.
    const r2 = this.add_goals(
      GoalSource.Misc,
      map_iter(
        map_iter(iter_instantiated(cx.ir_clauses_of(target_container_def_id), cx, target_args, fold_Clause), Unnormalized.skip_norm_wip),
        (clause) => goal_with(goal, cx, clause, Predicate_upcast_from_Clause),
      ),
    );
    if (r2.$ === "Err") return r2;
    return Ok(goal.predicate.alias.args.rebase_onto(cx, impl_trait_ref.def_id, target_args));
  }
};
