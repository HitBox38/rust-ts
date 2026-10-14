//! The next-generation trait solver, currently still WIP.
//!
//! As a user of rust, you can use `-Znext-solver` to enable the new trait solver.
//!
//! As a developer of rustc, you shouldn't be using the new trait
//! solver without asking the trait-system-refactor-initiative, but it can
//! be enabled with `InferCtxtBuilder::with_next_trait_solver`. This will
//! ensure that trait solving using that inference context will be routed
//! to the new trait solver.
//!
//! For a high-level overview of how this solver works, check out the relevant
//! section of the rustc-dev-guide.
//
// Port of compiler/rustc_next_trait_solver/src/solve/mod.rs (lane nts-normalizes; contract by evalctxt-contract). The
// `EvalCtxt` methods are declared in ../decls.ts (`// solve/mod.rs:<line>`) and assigned onto `EvalCtxt.prototype` here.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): lib.ts loads it after decls.ts; its top-level
// code may touch only `EvalCtxt` (decls.ts) and other crates, never another rustc_next_trait_solver module's exports.
// PORT: the solver is generic over `I: Interner`, so methods of `I::Term` / `I::GenericArg` / ... resolve to the
// `rustc_type_ir::inherent` traits: their provided methods are the `<Trait>_provided` helpers of rustc_type_ir
// inherent.ts, their required methods the rustc_middle impls.
//
// PORT: `pub use rustc_type_ir::solve::*` is the `export *` below; `pub mod inspect` is solve/inspect/mod.ts and the
// `pub use self::eval_ctxt::{..}` re-exports are at the end of this file.
import { debug_Predicate } from "../../rustc_middle/ty/structural_impls.ts";
import type { Predicate } from "../../rustc_middle/ty/predicate.ts";
import { Predicate_upcast_from_ProjectionClause } from "../../rustc_middle/ty/predicate.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ParamEnv, Term, Ty } from "../../rustc_middle/ty/decls.ts";
import { Term as MTerm } from "../../rustc_middle/ty/mod.ts";
import { fold_Term } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { Value } from "../../rustc_middle/ty/consts/valtree.ts";
import { ExternalConstraints_deref } from "../../rustc_middle/traits/solve.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type {
  CanonicalResponse,
  GoalStalledOn,
  NoSolution,
  QueryResult,
  QueryResultOrRerunNonErased,
  UpcastFn,
} from "../../rustc_type_ir/solve/mod.ts";
import {
  Certainty,
  debug_Certainty,
  debug_Goal,
  debug_GoalStalledOn,
  ExternalRegionConstraints,
  Goal,
  GoalSource,
  MaybeInfo,
  NestedNormalizationGoals,
  NoSolutionOrRerunNonErased,
  Response,
  VisibleForLeakCheck,
} from "../../rustc_type_ir/solve/mod.ts";
import type { Canonical } from "../../rustc_type_ir/canonical.ts";
import { PlaceholderConst } from "../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import { Term_provided } from "../../rustc_type_ir/inherent.ts";
import type { CoercePredicate, OutlivesClause, ProjectionClause, SubtypePredicate } from "../../rustc_type_ir/predicate.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import { relate_Ty } from "../../rustc_type_ir/relate.ts";
import { type Const, debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { EvalCtxt } from "../decls.ts";
import type { Candidate } from "./assembly/mod.ts";

export * from "../../rustc_type_ir/solve/mod.ts";

/// How many fixpoint iterations we should attempt inside of the solver before bailing
/// with overflow.
///
/// We previously used  `cx.recursion_limit().0.checked_ilog2().unwrap_or(0)` for this.
/// However, it feels unlikely that uncreasing the recursion limit by a power of two
/// to get one more iteration is ever useful or desirable. We now instead used a constant
/// here. If there ever ends up some use-cases where a bigger number of fixpoint iterations
/// is required, we can add a new attribute for that or revert this to be dependent on the
/// recursion limit again. However, this feels very unlikely.
export const FIXPOINT_STEP_LIMIT: number = 8;

/// Whether evaluating this goal ended up changing the
/// inference state.
// PORT: `#[derive(PartialEq, Eq, Debug, Hash, Clone, Copy)]` fieldless enum: `===`, Debug is the name.
export type HasChanged = "Yes" | "No";
export const HasChanged = { Yes: "Yes", No: "No" } as const;
export const debug_HasChanged: Debug<HasChanged> = (v) => v;

// FIXME(trait-system-refactor-initiative#117): we don't detect whether a response
// ended up pulling down any universes.
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:57 has_no_inference_or_external_constraints
export function has_no_inference_or_external_constraints(response: Canonical<Response>): boolean {
  const { region_constraints, opaque_types, normalization_nested_goals } = ExternalConstraints_deref(
    response.value.external_constraints,
  );
  return (
    Response.is_identity(response.value) &&
    ExternalRegionConstraints.is_empty(region_constraints) &&
    opaque_types.length === 0 &&
    NestedNormalizationGoals.is_empty(normalization_nested_goals)
  );
}

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:71 has_only_region_constraints
export function has_only_region_constraints(response: Canonical<Response>): boolean {
  const { opaque_types, normalization_nested_goals } = ExternalConstraints_deref(response.value.external_constraints);
  return (
    Response.is_identity_modulo_regions(response.value) &&
    opaque_types.length === 0 &&
    NestedNormalizationGoals.is_empty(normalization_nested_goals)
  );
}

/// Whether two canonical responses are exactly equal except for their
/// region constraints.
// PORT: `==` of interned handles (`UniverseIndex`, `CanonicalVarKinds`, `GenericArgs`) is `===`; the derived
// `PartialEq` of the plain values (`Certainty`, the opaque-type `Vec`, `NestedNormalizationGoals`) compares
// `intern_key`s (evalctxt-contract "Representation").
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:84 equal_response_modulo_region_constraints
export function equal_response_modulo_region_constraints(a: CanonicalResponse, b: CanonicalResponse): boolean {
  const {
    max_universe: a_max_universe,
    var_kinds: a_var_kinds,
    value: { var_values: a_var_values, certainty: a_certainty, external_constraints: a_external_constraints },
  } = a;

  const { opaque_types, normalization_nested_goals } = ExternalConstraints_deref(a_external_constraints);

  const b_external_constraints = ExternalConstraints_deref(b.value.external_constraints);
  return (
    a_max_universe === b.max_universe &&
    a_var_kinds === b.var_kinds &&
    a_var_values === b.value.var_values &&
    intern_key(a_certainty) === intern_key(b.value.certainty) &&
    intern_key(opaque_types) === intern_key(b_external_constraints.opaque_types) &&
    intern_key(normalization_nested_goals) === intern_key(b_external_constraints.normalization_nested_goals)
  );
}

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:116 compute_type_outlives_goal
EvalCtxt.prototype.compute_type_outlives_goal = function (
  this: EvalCtxt,
  goal: Goal<OutlivesClause<Ty>>,
): QueryResultOrRerunNonErased {
  const { _0: ty0, _1: lt } = goal.predicate;
  const ty_r = this.normalize(goal.param_env, Unnormalized.new_wip(ty0), fold_Ty);
  if (ty_r.$ === "Err") return ty_r;
  const ty = ty_r._0;

  // The normalized type can still contain non-rigid higher ranked aliases if their
  // normalization ends up with ambiguity. Or we have non-rigid aliases inside rigid ones.
  // Infer vars may be resolved to types/consts containing non-rigid aliases later.
  // Thus we should stall this goal to avoid registering non-rigid type outlives into
  // the outer infcx.
  if (TypeVisitableExt.has_non_region_infer(ty, fold_Ty) || TypeVisitableExt.has_non_rigid_aliases(ty, fold_Ty)) {
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
  } else {
    // We drop region constraints in ambiguous response so there's no need to add them in
    // the ambiguous branch. Also this guarantees we don't have ty vars when destructuring
    // type outlives.
    if (this.cx().assumptions_on_binders()) {
      const constraint = this.destructure_type_outlives(ty, lt);
      this.register_solver_region_constraint(RegionConstraint.new_from_or(constraint));
    } else {
      this.register_ty_outlives(ty, lt);
    }

    return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:148 compute_region_outlives_goal
EvalCtxt.prototype.compute_region_outlives_goal = function (
  this: EvalCtxt,
  goal: Goal<OutlivesClause<Region>>,
): QueryResultOrRerunNonErased {
  const { _0: a, _1: b } = goal.predicate;

  if (this.cx().assumptions_on_binders()) {
    const constraint = RegionConstraint.new_leaf<null>({ $: "RegionOutlives", _0: a, _1: b, _2: null });
    this.register_solver_region_constraint(constraint);
  } else {
    this.register_region_outlives(a, b, VisibleForLeakCheck.Yes);
  }

  return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:168 compute_coerce_goal
EvalCtxt.prototype.compute_coerce_goal = function (this: EvalCtxt, goal: Goal<CoercePredicate>): QueryResultOrRerunNonErased {
  return this.compute_subtype_goal({
    param_env: goal.param_env,
    predicate: {
      a_is_expected: false,
      a: goal.predicate.a,
      b: goal.predicate.b,
    },
  });
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:183 compute_subtype_goal
EvalCtxt.prototype.compute_subtype_goal = function (this: EvalCtxt, goal: Goal<SubtypePredicate>): QueryResultOrRerunNonErased {
  const a_kind = goal.predicate.a.kind();
  const b_kind = goal.predicate.b.kind();
  if (a_kind.$ === "Infer" && a_kind._0.$ === "TyVar" && b_kind.$ === "Infer" && b_kind._0.$ === "TyVar") {
    const a_vid = a_kind._0._0;
    const b_vid = b_kind._0._0;
    this.sub_unify_ty_vids_raw(a_vid, b_vid);
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
  } else {
    const r = this.sub(goal.param_env, goal.predicate.a, goal.predicate.b, relate_Ty);
    if (r.$ === "Err") return r;
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:199 compute_dyn_compatible_goal
EvalCtxt.prototype.compute_dyn_compatible_goal = function (this: EvalCtxt, trait_def_id: DefId): QueryResultOrRerunNonErased {
  if (this.cx().trait_is_dyn_compatible(trait_def_id)) {
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  } else {
    return Err(NoSolutionOrRerunNonErased.from_NoSolution(NO_SOLUTION));
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:211 compute_well_formed_goal
EvalCtxt.prototype.compute_well_formed_goal = function (this: EvalCtxt, goal: Goal<Term>): QueryResultOrRerunNonErased {
  const goals = this.well_formed_goals(goal.param_env, goal.predicate);
  if (goals !== undefined) {
    const r = this.add_goals(GoalSource.Misc, goals);
    if (r.$ === "Err") return r;
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  } else {
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:224 compute_unstable_feature_goal
EvalCtxt.prototype.compute_unstable_feature_goal = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  symbol: Symbol,
): QueryResultOrRerunNonErased {
  const r = this.may_use_unstable_feature(param_env, symbol);
  if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
  if (r._0) {
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
  } else {
    return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:237 compute_const_evaluatable_goal
EvalCtxt.prototype.compute_const_evaluatable_goal = function (this: EvalCtxt, _0: Goal<Const>): QueryResultOrRerunNonErased {
  const { param_env, predicate: ct } = _0;
  const k = ct.kind();
  switch (k.$) {
    case "Alias":
      if (k._0 === "Yes") {
        return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      } else {
        const alias_const = k._1;
        // We never return `NoSolution` here as `evaluate_const` emits an
        // error itself when failing to evaluate, so emitting an additional fulfillment
        // error in that case is unnecessary noise. This may change in the future once
        // evaluation failures are allowed to impact selection, e.g. generic const
        // expressions in impl headers or `where`-clauses.

        // FIXME(generic_const_exprs): Implement handling for generic
        // const expressions here.
        const r = this.evaluate_const(param_env, alias_const);
        if (r.$ === "Err") return r;
        if (r._0 !== undefined) {
          return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
        } else {
          return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
        }
      }
    case "Placeholder":
    case "Value":
    case "Error":
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);

    case "Infer":
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);

    // We can freely ICE here as:
    // - `Param` gets replaced with a placeholder during canonicalization
    // - `Bound` cannot exist as we don't have a binder around the self Type
    // - `Expr` is part of `feature(generic_const_exprs)` and is not implemented yet
    case "Param":
    case "Bound":
    case "Expr":
      return panic(`unexpected const kind: ${debug_Const(ct, PLAIN)}`);
  }
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:280 compute_const_arg_has_type_goal
EvalCtxt.prototype.compute_const_arg_has_type_goal = function (
  this: EvalCtxt,
  goal: Goal<[Const, Ty]>,
): QueryResultOrRerunNonErased {
  const [ct0, ty] = goal.predicate;
  const ct_r = this.structurally_normalize_const(goal.param_env, ct0);
  if (ct_r.$ === "Err") return ct_r;
  const ct = ct_r._0;

  let ct_ty: Ty;
  const k = ct.kind();
  switch (k.$) {
    case "Infer":
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
    case "Error":
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    case "Alias":
      if (k._0 === "Yes") {
        ct_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(k._1, this.cx()));
        break;
      } else {
        return panic(
          `not implemented: non-rigid unevaluated constant for compute_const_arg_has_type_goal: ${debug_Const(ct, PLAIN)}`,
        );
      }
    case "Expr":
      return panic("not implemented: `feature(generic_const_exprs)` is not supported in the new trait solver");
    case "Param":
      return unreachable(
        "internal error: entered unreachable code: `ConstKind::Param` should have been canonicalized to `Placeholder`",
      );
    case "Bound":
      return panic(`escaping bound vars in ${debug_Const(ct, PLAIN)}`);
    case "Value":
      ct_ty = Value.ty(k._0);
      break;
    case "Placeholder":
      ct_ty = PlaceholderConst.find_const_ty_from_env(k._0, goal.param_env);
      break;
  }

  const r = this.eq(goal.param_env, ct_ty, ty, relate_Ty);
  if (r.$ === "Err") return r;
  return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
};

// PORT: `#[derive(Debug)] enum MergeCandidateInfo { AlwaysApplicable(usize), EqualResponse }`.
export type MergeCandidateInfo = { readonly $: "AlwaysApplicable"; readonly _0: number } | { readonly $: "EqualResponse" };
export const MergeCandidateInfo = {
  EqualResponse: Object.freeze({ $: "EqualResponse" }) as MergeCandidateInfo,
} as const;
export const debug_MergeCandidateInfo: Debug<MergeCandidateInfo> = (v, f) => {
  switch (v.$) {
    case "AlwaysApplicable":
      return debug_tuple(f, "AlwaysApplicable", [debug_int(v._0, f)]);
    case "EqualResponse":
      return "EqualResponse";
  }
};

/// Try to merge multiple possible ways to prove a goal, if that is not possible returns `None`.
///
/// In this case we tend to flounder and return ambiguity by calling `[EvalCtxt::flounder]`.
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:337 try_merge_candidates
EvalCtxt.prototype.try_merge_candidates = function (
  this: EvalCtxt,
  candidates: readonly Candidate[],
): [CanonicalResponse, MergeCandidateInfo] | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const always_applicable = candidates.findIndex(
    (candidate) =>
      candidate.result.value.certainty.$ === "Yes" && has_no_inference_or_external_constraints(candidate.result),
  );

  if (always_applicable !== -1) {
    const i = always_applicable;
    const candidate = candidates[i]!;
    return [candidate.result, { $: "AlwaysApplicable", _0: i }];
  }

  const one: CanonicalResponse = candidates[0]!.result;

  if (candidates.slice(1).every((candidate) => equal_response_modulo_region_constraints(one, candidate.result))) {
    const region_constraints = ExternalConstraints_deref(one.value.external_constraints).region_constraints;
    // PORT: derived `PartialEq` of `ExternalRegionConstraints` (plain data): `intern_key` equality.
    const region_constraints_key = intern_key(region_constraints);
    if (
      candidates.slice(1).every(
        (candidate) =>
          intern_key(ExternalConstraints_deref(candidate.result.value.external_constraints).region_constraints) ===
          region_constraints_key,
      )
    ) {
      return [one, MergeCandidateInfo.EqualResponse];
    }

    // If candidates differ only in region constraints, their merged region
    // constraints are an `Or` of their respective constraints. If one of them
    // has no region constraints, the `Or` constraint evaluates to `true`.
    //
    // This is a special case of `-Zassumptions-on-binders` and should be
    // replaced eventually.
    const candidate = candidates.find((candidate) =>
      ExternalRegionConstraints.is_empty(ExternalConstraints_deref(candidate.result.value.external_constraints).region_constraints),
    );
    if (candidate !== undefined) {
      return [candidate.result, MergeCandidateInfo.EqualResponse];
    }
  }

  return undefined;
};

// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:384 bail_with_ambiguity
EvalCtxt.prototype.bail_with_ambiguity = function (this: EvalCtxt, candidates: readonly Candidate[]): CanonicalResponse {
  // debug_assert!(candidates.len() > 1);
  const maybe = candidates.reduce((maybe: MaybeInfo, candidate): MaybeInfo => {
    // We pull down the certainty of `Certainty::Yes` to ambiguity when combining
    // these responses, b/c we're combining more than one response and this we
    // don't know which one applies.
    const certainty = candidate.result.value.certainty;
    switch (certainty.$) {
      case "Yes":
        return maybe;
      case "Maybe":
        return MaybeInfo.or(maybe, certainty._0);
    }
  }, MaybeInfo.AMBIGUOUS);
  return this.make_ambiguous_response_no_constraints(maybe);
};

/// If we fail to merge responses we flounder and return overflow or ambiguity.
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:400 flounder
EvalCtxt.prototype.flounder = function (this: EvalCtxt, candidates: readonly Candidate[]): QueryResult {
  if (candidates.length === 0) {
    return Err(NO_SOLUTION);
  } else {
    return Ok(this.bail_with_ambiguity(candidates));
  }
};

/// Normalize a type for when it is structurally matched on.
///
/// This function is necessary in nearly all cases before matching on a type.
/// Not doing so is likely to be incomplete and therefore unsound during
/// coherence.
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:414 structurally_normalize_ty
EvalCtxt.prototype.structurally_normalize_ty = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  ty: Ty,
): Result<Ty, NoSolutionOrRerunNonErased> {
  const r = this.structurally_normalize_term(param_env, MTerm.from_Ty(ty));
  if (r.$ === "Err") return r;
  return Ok(Term_provided.expect_ty(r._0));
};

/// Normalize a const for when it is structurally matched on, or more likely
/// when it needs `.try_to_*` called on it (e.g. to turn it into a usize).
///
/// This function is necessary in nearly all cases before matching on a const.
/// Not doing so is likely to be incomplete and therefore unsound during
/// coherence.
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:429 structurally_normalize_const
EvalCtxt.prototype.structurally_normalize_const = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  ct: Const,
): Result<Const, NoSolutionOrRerunNonErased> {
  const r = this.structurally_normalize_term(param_env, MTerm.from_Const(ct));
  if (r.$ === "Err") return r;
  return Ok(Term_provided.expect_const(r._0));
};

/// Normalize a term for when it is structurally matched on.
///
/// This function is necessary in nearly all cases before matching on a ty/const.
/// Not doing so is likely to be incomplete and therefore unsound during coherence.
// rustc: compiler/rustc_next_trait_solver/src/solve/mod.rs:441 structurally_normalize_term
EvalCtxt.prototype.structurally_normalize_term = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  term: Term,
): Result<Term, NoSolutionOrRerunNonErased> {
  if (!this.cx().renormalize_rigid_aliases() && !Term_provided.is_non_rigid_alias(term)) {
    return Ok(term);
  }

  const alias = Term_provided.to_alias_term(term);
  if (alias !== undefined) {
    const normalized_term = this.next_term_infer_of_alias_kind(alias);
    const projection_goal = Goal.new(
      as_interner(this.cx()),
      param_env,
      { projection_term: alias, term: normalized_term } satisfies ProjectionClause,
      upcast_fn(Predicate_upcast_from_ProjectionClause),
    );
    // We normalize the self type to be able to relate it with
    // types from candidates.
    const r1 = this.add_goal(GoalSource.Normalization, projection_goal);
    if (r1.$ === "Err") return r1;
    const r2 = this.try_evaluate_added_goals();
    if (r2.$ === "Err") return r2;
    return Ok(this.deeply_resolve_ignoring_regions(normalized_term, fold_Term));
  } else {
    return Ok(term);
  }
};

// ---- PORT helpers (not upstream fns) --------------------------------------------------------------------------------

/** PORT: `NoSolution` is a unit struct; its value. */
const NO_SOLUTION: NoSolution = {};

/** PORT: rustc_middle's `UpcastFrom` impls take `TyCtxt` (`I = TyCtxt`); `Goal::new` / `Goal::with` take the
 *  `Interner`-typed upcast (`as_interner` precedent, rustc_type_ir predicate.ts). */
function upcast_fn<T, P>(f: (from: T, tcx: TyCtxt) => P): UpcastFn<T, P> {
  return f as unknown as UpcastFn<T, P>;
}

/// The result of evaluating a goal.
// PORT: `#[derive_where(Debug; I: Interner)]` plain struct.
export interface GoalEvaluation {
  /// The goal we've evaluated. This is the input goal, but potentially with its
  /// inference variables resolved. This never applies any inference constraints
  /// from evaluating the goal.
  ///
  /// We rely on this to check whether root goals in HIR typeck had an unresolved
  /// type inference variable in the input. We must not resolve this after evaluating
  /// the goal as even if the inference variable has been resolved by evaluating the
  /// goal itself, this goal may still end up failing due to region uniquification
  /// later on.
  ///
  /// This is used as a minor optimization to avoid re-resolving inference variables
  /// when reevaluating ambiguous goals. E.g. if we've got a goal `?x: Trait` with `?x`
  /// already being constrained to `Vec<?y>`, then the first evaluation resolves it to
  /// `Vec<?y>: Trait`. If this goal is still ambiguous and we later resolve `?y` to `u32`,
  /// then reevaluating this goal now only needs to resolve `?y` while it would otherwise
  /// have to resolve both `?x` and `?y`,
  goal: Goal<Predicate>;
  certainty: Certainty;
  has_changed: HasChanged;
  /// If the [`Certainty`] was `Maybe`, then keep track of whether the goal has changed
  /// before rerunning it.
  stalled_on: GoalStalledOn | undefined;
}
export const debug_GoalEvaluation: Debug<GoalEvaluation> = (v, f) =>
  debug_struct(f, "GoalEvaluation", [
    ["goal", debug_Goal(v.goal, f, debug_Predicate)],
    ["certainty", debug_Certainty(v.certainty, f)],
    ["has_changed", debug_HasChanged(v.has_changed, f)],
    ["stalled_on", debug_option(v.stalled_on, f, debug_GoalStalledOn)],
  ]);

// `pub use self::eval_ctxt::{EvalCtxt, GenerateProofTree, SolverDelegateEvalExt,
// evaluate_root_goal_for_proof_tree_raw_provider, fast_path};`
export { EvalCtxt } from "../decls.ts";
export {
  GenerateProofTree,
  SolverDelegateEvalExt_for_D,
  evaluate_root_goal_for_proof_tree_raw_provider,
} from "./eval_ctxt/mod.ts";
export type { SolverDelegateEvalExt } from "./eval_ctxt/mod.ts";
export * as fast_path from "./eval_ctxt/fast_path.ts";
export * as inspect from "./inspect/mod.ts";
