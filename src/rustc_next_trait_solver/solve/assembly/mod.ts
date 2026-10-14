//! Code shared by trait and projection goals for candidate assembly.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs (lane evalctxt-contract; the file
// belongs to lane nts-assembly). The types and the `GoalKind` trait are final (the trait's required methods carry their
// markers in the interface). The provided `GoalKind` methods (`GoalKind_provided`), `AssembleCandidatesFrom`'s method
// and `FindParamInClause`'s visitor methods are stubs with final signatures: fill each in place and add the
// `// rustc:` marker. The `EvalCtxt` methods are declared in ../../decls.ts (`// solve/assembly/mod.rs:<line>`); the
// call at the end installs `unported(..)` placeholders: assign `EvalCtxt.prototype.<name> = function (this: EvalCtxt,
// ..) { .. }` with the marker and delete the name from the list. The `ReplaceOpaque` folder is local to
// `try_assemble_bounds_via_registered_opaques`: port it inside that fn.
// Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT (PORTING §5 "pass function tables"): `trait GoalKind<D>: TypeFoldable<I> + Copy + Eq + Display` is the impl
// table interface `GoalKind<G>` over the goal predicate type `G` (rustc_type_ir `Relate<T>` precedent): the
// `TypeFoldable` supertrait is inherited (`visit_with` / `try_fold_with` / `fold_with` of `G`), `Eq` is `eq`, `Display`
// is `display`; `self` methods take the predicate as `self` first; associated fns (`ecx` first) are plain entries. The
// three impls are the tables `GoalKind_TraitClause` (trait_goals.ts), `GoalKind_HostEffectClause` (effect_goals.ts) and
// `GoalKind_NormalizesTo` (normalizes_to.ts). Code generic over `G: GoalKind<D>` takes the table as a value parameter
// named `G`, last (decls.ts header), so `G::consider_impl_candidate(ecx, ..)` is `G.consider_impl_candidate(ecx, ..)`.
// Provided methods live in `GoalKind_provided` (PORTING §8), taking the impl table `G` first for their `Self::` calls;
// each table forwards the provided methods it does not override.
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Clauses, ParamEnv, Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import type { AliasTy, Binder, ClosureKind, TraitRef, UniverseIndex } from "../../../rustc_type_ir/decls.ts";
import type { TypeFoldable, PredicateProxy } from "../../../rustc_type_ir/fold.ts";
import type { CandidateHeadUsages } from "../../../rustc_type_ir/search_graph/mod.ts";
import type {
  CandidateSource,
  Certainty,
  Goal,
  GoalSource,
  NoSolution,
  NoSolutionOrRerunNonErased,
  QueryResultOrRerunNonErased,
  RerunNonErased,
  SizedTraitKind,
} from "../../../rustc_type_ir/solve/mod.ts";
import { debug_CandidateSource, debug_Response } from "../../../rustc_type_ir/solve/mod.ts";
import { debug_Canonical } from "../../../rustc_type_ir/canonical.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { type ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../../../rustc_ast_ir/visit.ts";
import type { CanonicalResponse } from "../../../rustc_type_ir/solve/mod.ts";
import { type Debug, debug_struct, type Fmt } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";

/// A candidate is a possible way to prove a goal.
///
/// It consists of both the `source`, which describes how that goal would be proven,
/// and the `result` when using the given `source`.
// PORT: `#[derive_where(Debug; I: Interner)]` plain struct.
export interface Candidate {
  source: CandidateSource;
  result: CanonicalResponse;
  head_usages: CandidateHeadUsages;
}
export const debug_Candidate: Debug<Candidate> = (v, f) =>
  debug_struct(f, "Candidate", [
    ["source", debug_CandidateSource(v.source, f)],
    ["result", debug_Canonical(v.result, f, debug_Response)],
    ["head_usages", debug_CandidateHeadUsages(v.head_usages, f)],
  ]);

/** PORT: stand-in for the derived `Debug` of `CandidateHeadUsages` (rustc_type_ir search_graph/mod.rs, not ported by
 * tyir-solve). */
function debug_CandidateHeadUsages(_v: CandidateHeadUsages, _f: Fmt): string {
  return unported("rustc_type_ir::search_graph::CandidateHeadUsages: Debug (search_graph/mod.rs, derived)");
}

/// Methods used to assemble candidates for either trait or projection goals.
// rustc-trait: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:46 GoalKind
export interface GoalKind<G> extends TypeFoldable<G> {
  /** `Eq` (supertrait). */
  eq(a: G, b: G): boolean;
  /** `std::fmt::Display` (supertrait). */
  display(self: G): string;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:52 self_ty
  self_ty(self: G): Ty;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:54 trait_ref
  trait_ref(self: G, cx: TyCtxt): TraitRef;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:56 with_replaced_self_ty
  with_replaced_self_ty(self: G, cx: TyCtxt, self_ty: Ty): G;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:58 trait_def_id
  trait_def_id(self: G, cx: TyCtxt): DefId;

  /// Consider a clause, which consists of a "assumption" and some "requirements",
  /// to satisfy a goal. If the requirements hold, then attempt to satisfy our
  /// goal by equating it with the assumption.
  // (provided) assembly/mod.rs:63 probe_and_consider_implied_clause -> GoalKind_provided.probe_and_consider_implied_clause
  probe_and_consider_implied_clause(
    ecx: EvalCtxt,
    parent_source: CandidateSource,
    goal: Goal<G>,
    assumption: Clause,
    requirements: Iterable<[GoalSource, Goal<Predicate>]>,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// Consider a clause specifically for a `dyn Trait` self type. This requires
  /// additionally checking all of the supertraits and object bounds to hold,
  /// since they're not implied by the well-formedness of the object type.
  /// `NormalizesTo` overrides this to not check the supertraits for backwards
  /// compatibility with the old solver. cc trait-system-refactor-initiative#245.
  // (provided) assembly/mod.rs:83 probe_and_consider_object_bound_candidate -> GoalKind_provided.probe_and_consider_object_bound_candidate
  probe_and_consider_object_bound_candidate(
    ecx: EvalCtxt,
    source: CandidateSource,
    goal: Goal<G>,
    assumption: Clause,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// Assemble additional assumptions for an alias that are not included
  /// in the item bounds of the alias. For now, this is limited to the
  /// `explicit_implied_const_bounds` for an associated type.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:170 consider_additional_alias_assumptions
  consider_additional_alias_assumptions(ecx: EvalCtxt, goal: Goal<G>, alias_ty: AliasTy): Candidate[];

  // (provided) assembly/mod.rs:176 probe_and_consider_param_env_candidate -> GoalKind_provided.probe_and_consider_param_env_candidate
  probe_and_consider_param_env_candidate(
    ecx: EvalCtxt,
    goal: Goal<G>,
    assumption: Clause,
  ): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased>;

  /// Try equating an assumption predicate against a goal's predicate. If it
  /// holds, then execute the `then` callback, which should do any additional
  /// work, then produce a response (typically by executing
  /// [`EvalCtxt::evaluate_added_goals_and_make_canonical_response`]).
  // (provided) assembly/mod.rs:224 probe_and_match_goal_against_assumption -> GoalKind_provided.probe_and_match_goal_against_assumption
  probe_and_match_goal_against_assumption(
    ecx: EvalCtxt,
    source: CandidateSource,
    goal: Goal<G>,
    assumption: Clause,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// Try to reject the assumption based off of simple heuristics, such as [`ty::ClauseKind`]
  /// and `DefId`.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:239 fast_reject_assumption
  fast_reject_assumption(ecx: EvalCtxt, goal: Goal<G>, assumption: Clause): Result<undefined, NoSolution>;

  /// Relate the goal and assumption.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:246 match_assumption
  match_assumption(
    ecx: EvalCtxt,
    goal: Goal<G>,
    assumption: Clause,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): QueryResultOrRerunNonErased;

  /// Note: `goal_trait_ref` is derived from `goal`. Nonetheless, because
  /// `consider_impl_candidate` is always called in a loop, we precompute `goal_trait_ref` once
  /// and pass it in next to `goal` because the computation is expensive and loop-invariant.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:256 consider_impl_candidate
  consider_impl_candidate(
    ecx: EvalCtxt,
    goal: Goal<G>,
    goal_trait_ref: TraitRef,
    impl_def_id: DefId,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// If the predicate contained an error, we want to avoid emitting unnecessary trait
  /// errors but still want to emit errors for other trait goals. We have some special
  /// handling for this case.
  ///
  /// Trait goals always hold while projection goals never do. This is a bit arbitrary
  /// but prevents incorrect normalization while hiding any trait errors.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:270 consider_error_guaranteed_candidate
  consider_error_guaranteed_candidate(
    ecx: EvalCtxt,
    goal: Goal<G>,
    guar: ErrorGuaranteed,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A type implements an `auto trait` if its components do as well.
  ///
  /// These components are given by built-in rules from
  /// [`structural_traits::instantiate_constituent_tys_for_auto_trait`].
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:280 consider_auto_trait_candidate
  consider_auto_trait_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A trait alias holds if the RHS traits and `where` clauses hold.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:286 consider_trait_alias_candidate
  consider_trait_alias_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A type is `Sized` if its tail component is `Sized` and a type is `MetaSized` if its tail
  /// component is `MetaSized`.
  ///
  /// These components are given by built-in rules from
  /// [`structural_traits::instantiate_constituent_tys_for_sizedness_trait`].
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:296 consider_builtin_sizedness_candidates
  consider_builtin_sizedness_candidates(
    ecx: EvalCtxt,
    goal: Goal<G>,
    sizedness: SizedTraitKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A type is `Copy` or `Clone` if its components are `Copy` or `Clone`.
  ///
  /// These components are given by built-in rules from
  /// [`structural_traits::instantiate_constituent_tys_for_copy_clone_trait`].
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:306 consider_builtin_copy_clone_candidate
  consider_builtin_copy_clone_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A type is a `FnPtr` if it is of `FnPtr` type.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:312 consider_builtin_fn_ptr_trait_candidate
  consider_builtin_fn_ptr_trait_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A callable type (a closure, fn def, or fn ptr) is known to implement the `Fn<A>`
  /// family of traits where `A` is given by the signature of the type.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:319 consider_builtin_fn_trait_candidates
  consider_builtin_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: Goal<G>,
    kind: ClosureKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// An async closure is known to implement the `AsyncFn<A>` family of traits
  /// where `A` is given by the signature of the type.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:327 consider_builtin_async_fn_trait_candidates
  consider_builtin_async_fn_trait_candidates(
    ecx: EvalCtxt,
    goal: Goal<G>,
    kind: ClosureKind,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// Compute the built-in logic of the `AsyncFnKindHelper` helper trait, which
  /// is used internally to delay computation for async closures until after
  /// upvar analysis is performed in HIR typeck.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:336 consider_builtin_async_fn_kind_helper_candidate
  consider_builtin_async_fn_kind_helper_candidate(
    ecx: EvalCtxt,
    goal: Goal<G>,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// `Tuple` is implemented if the `Self` type is a tuple.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:342 consider_builtin_tuple_candidate
  consider_builtin_tuple_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// `Pointee` is always implemented.
  ///
  /// See the projection implementation for the `Metadata` types for all of
  /// the built-in types. For structs, the metadata type is given by the struct
  /// tail.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:352 consider_builtin_pointee_candidate
  consider_builtin_pointee_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A coroutine (that comes from an `async` desugaring) is known to implement
  /// `Future<Output = O>`, where `O` is given by the coroutine's return type
  /// that was computed during type-checking.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:360 consider_builtin_future_candidate
  consider_builtin_future_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A coroutine (that comes from a `gen` desugaring) is known to implement
  /// `Iterator<Item = O>`, where `O` is given by the generator's yield type
  /// that was computed during type-checking.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:368 consider_builtin_iterator_candidate
  consider_builtin_iterator_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A coroutine (that comes from a `gen` desugaring) is known to implement
  /// `FusedIterator`
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:375 consider_builtin_fused_iterator_candidate
  consider_builtin_fused_iterator_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:380 consider_builtin_async_iterator_candidate
  consider_builtin_async_iterator_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// A coroutine (that doesn't come from an `async` or `gen` desugaring) is known to
  /// implement `Coroutine<R, Yield = Y, Return = O>`, given the resume, yield,
  /// and return types of the coroutine computed during type-checking.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:388 consider_builtin_coroutine_candidate
  consider_builtin_coroutine_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:393 consider_builtin_discriminant_kind_candidate
  consider_builtin_discriminant_kind_candidate(
    ecx: EvalCtxt,
    goal: Goal<G>,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:398 consider_builtin_destruct_candidate
  consider_builtin_destruct_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:403 consider_builtin_transmute_candidate
  consider_builtin_transmute_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:408 consider_builtin_bikeshed_guaranteed_no_drop_candidate
  consider_builtin_bikeshed_guaranteed_no_drop_candidate(
    ecx: EvalCtxt,
    goal: Goal<G>,
  ): Result<Candidate, NoSolutionOrRerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:413 consider_builtin_try_as_dyn_candidate
  consider_builtin_try_as_dyn_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;

  /// Consider (possibly several) candidates to upcast or unsize a type to another
  /// type, excluding the coercion of a sized type into a `dyn Trait`.
  ///
  /// We return the `BuiltinImplSource` for each candidate as it is needed
  /// for unsize coercion in hir typeck and because it is difficult to
  /// otherwise recompute this for codegen. This is a bit of a mess but the
  /// easiest way to maintain the existing behavior for now.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:425 consider_structural_builtin_unsize_candidates
  consider_structural_builtin_unsize_candidates(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate[], RerunNonErased>;

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:430 consider_builtin_field_candidate
  consider_builtin_field_candidate(ecx: EvalCtxt, goal: Goal<G>): Result<Candidate, NoSolutionOrRerunNonErased>;
}

/** PORT: the provided methods of `GoalKind` (header); `G` is the impl table whose `Self::` the body calls. */
export const GoalKind_provided = {
  /// Consider a clause, which consists of a "assumption" and some "requirements",
  /// to satisfy a goal. If the requirements hold, then attempt to satisfy our
  /// goal by equating it with the assumption.
  probe_and_consider_implied_clause<G>(
    _G: GoalKind<G>,
    _ecx: EvalCtxt,
    _parent_source: CandidateSource,
    _goal: Goal<G>,
    _assumption: Clause,
    _requirements: Iterable<[GoalSource, Goal<Predicate>]>,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::assembly::GoalKind::probe_and_consider_implied_clause");
  },

  /// Consider a clause specifically for a `dyn Trait` self type. This requires
  /// additionally checking all of the supertraits and object bounds to hold,
  /// since they're not implied by the well-formedness of the object type.
  /// `NormalizesTo` overrides this to not check the supertraits for backwards
  /// compatibility with the old solver. cc trait-system-refactor-initiative#245.
  probe_and_consider_object_bound_candidate<G>(
    _G: GoalKind<G>,
    _ecx: EvalCtxt,
    _source: CandidateSource,
    _goal: Goal<G>,
    _assumption: Clause,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::assembly::GoalKind::probe_and_consider_object_bound_candidate");
  },

  probe_and_consider_param_env_candidate<G>(
    _G: GoalKind<G>,
    _ecx: EvalCtxt,
    _goal: Goal<G>,
    _assumption: Clause,
  ): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased> {
    return unported("rustc_next_trait_solver::solve::assembly::GoalKind::probe_and_consider_param_env_candidate");
  },

  /// Try equating an assumption predicate against a goal's predicate. If it
  /// holds, then execute the `then` callback, which should do any additional
  /// work, then produce a response (typically by executing
  /// [`EvalCtxt::evaluate_added_goals_and_make_canonical_response`]).
  probe_and_match_goal_against_assumption<G>(
    _G: GoalKind<G>,
    _ecx: EvalCtxt,
    _source: CandidateSource,
    _goal: Goal<G>,
    _assumption: Clause,
    _then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::assembly::GoalKind::probe_and_match_goal_against_assumption");
  },
};

/// Allows callers of `assemble_and_evaluate_candidates` to choose whether to limit
/// candidate assembly to param-env and alias-bound candidates.
///
/// On top of being a micro-optimization, as it avoids doing unnecessary work when
/// a param-env trait bound candidate shadows impls for normalization, this is also
/// required to prevent query cycles due to RPITIT inference. See the issue at:
/// <https://github.com/rust-lang/trait-system-refactor-initiative/issues/173>.
export type AssembleCandidatesFrom =
  | "All"
  /// Only assemble candidates from the environment and alias bounds, ignoring
  /// user-written and built-in impls. We only expect `ParamEnv` and `AliasBound`
  /// candidates to be assembled.
  | "EnvAndBounds";
export const AssembleCandidatesFrom = {
  All: "All",
  EnvAndBounds: "EnvAndBounds",

  should_assemble_impl_candidates(_self: AssembleCandidatesFrom): boolean {
    return unported("rustc_next_trait_solver::solve::assembly::AssembleCandidatesFrom::should_assemble_impl_candidates");
  },
} as const;

/// This is currently used to track the [CandidateHeadUsages] of all failed `ParamEnv`
/// candidates. This is then used to ignore their head usages in case there's another
/// always applicable `ParamEnv` candidate. Look at how `param_env_head_usages` is
/// used in the code for more details.
///
/// We could easily extend this to also ignore head usages of other ignored candidates.
/// However, we currently don't have any tests where this matters and the complexity of
/// doing so does not feel worth it for now.
// PORT: `#[derive(Debug)]` plain struct, mutated in place through `&mut FailedCandidateInfo`.
export interface FailedCandidateInfo {
  param_env_head_usages: CandidateHeadUsages;
}
export const debug_FailedCandidateInfo: Debug<FailedCandidateInfo> = (v, f) =>
  debug_struct(f, "FailedCandidateInfo", [["param_env_head_usages", debug_CandidateHeadUsages(v.param_env_head_usages, f)]]);

// PORT: fieldless enum without derives.
export type AllowInferenceConstraints = "Yes" | "No";
export const AllowInferenceConstraints = { Yes: "Yes", No: "No" } as const;

// PORT: `type Result = ControlFlow<Result<Certainty, NoSolution>>`; the comment on it upstream:
// - `Continue(())`: no generic parameter was found, the type is global
// - `Break(Ok(Certainty::Yes))`: a generic parameter was found, the type is non-global
// - `Break(Ok(Certainty::Maybe(_)))`: the recursion limit reached, assume that the type is non-global
// - `Break(Err(NoSolution))`: normalization failed
export class FindParamInClause implements TypeVisitor<ControlFlow<Result<Certainty, NoSolution>>> {
  readonly Result: VisitorResult<ControlFlow<Result<Certainty, NoSolution>>, unknown> =
    VisitorResultC.ControlFlow<Result<Certainty, NoSolution>>();

  constructor(
    public ecx: EvalCtxt,
    public param_env: ParamEnv,
    public universes: (UniverseIndex | undefined)[],
    public recursion_depth: number,
  ) {}

  visit_binder<T>(_t: Binder<T>, _d: TypeVisitable<T>): ControlFlow<Result<Certainty, NoSolution>> {
    return unported("rustc_next_trait_solver::solve::assembly::FindParamInClause::visit_binder");
  }

  visit_ty(_ty: Ty): ControlFlow<Result<Certainty, NoSolution>> {
    return unported("rustc_next_trait_solver::solve::assembly::FindParamInClause::visit_ty");
  }

  visit_const(_ct: Const): ControlFlow<Result<Certainty, NoSolution>> {
    return unported("rustc_next_trait_solver::solve::assembly::FindParamInClause::visit_const");
  }

  visit_region(_r: Region): ControlFlow<Result<Certainty, NoSolution>> {
    return unported("rustc_next_trait_solver::solve::assembly::FindParamInClause::visit_region");
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<Result<Certainty, NoSolution>> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<Result<Certainty, NoSolution>> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<Result<Certainty, NoSolution>> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::assembly::EvalCtxt", [
  "assemble_and_evaluate_candidates",
  "forced_ambiguity",
  "assemble_impl_candidates",
  "assemble_builtin_impl_candidates",
  "assemble_param_env_candidates",
  "assemble_alias_bound_candidates",
  "assemble_alias_bound_candidates_recur",
  "assemble_object_bound_candidates",
  "consider_coherence_unknowable_candidate",
  "filter_specialized_impls",
  "try_assemble_bounds_via_registered_opaques",
  "assemble_and_merge_candidates",
  "characterize_param_env_assumption",
]);
