//! Code shared by trait and projection goals for candidate assembly.
//
// Port of compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs (lane nts-assembly; contract by lane
// evalctxt-contract). The `EvalCtxt` methods are declared in ../../decls.ts (`// solve/assembly/mod.rs:<line>`) and
// assigned onto `EvalCtxt.prototype` below, in upstream order. The `ReplaceOpaque` folder is local to
// `try_assemble_bounds_via_registered_opaques` and is ported inside it.
// Extension module (docs/handoff/evalctxt-contract.md "Init order"): its top-level code touches only `EvalCtxt`
// (decls.ts) and other crates; every other rustc_next_trait_solver import is read inside fn bodies only.
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
// PORT (D3): `cx()` is `TyCtxt`; `Interner` methods go through rustc_type_ir predicate.ts's `as_interner` (nts-eval
// precedent). `I::Ty`'s provided `inherent::Ty` methods are `Ty_provided` (inherent.ts header).
// PORT: `#[instrument]` and `debug!` (tracing) produce no output in the oracle: kept as comments.
// PORT: `candidates.extend(result)` with `result: Result<Candidate, _>` pushes the `Ok` value and drops the error
// (`Result: IntoIterator`), exactly as upstream (also a `RerunNonErased` error).
// PORT: `panic!("unexpected self type for `{goal:?}`")` needs `Debug` of `Goal<I, G>`; the `GoalKind<G>` table has no
// `Debug` descriptor for `G` (decls.ts), so those two arms are `unported(..)` (binder.ts `instantiate` precedent).
import { type ControlFlow, ControlFlow as ControlFlowC, type VisitorResult, VisitorResult as VisitorResultC } from "../../../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Clauses, GenericArg, ParamEnv, Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
import { Clause_upcast_from_PolyTraitRef, Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import { Elaboratable_Predicate } from "../../../rustc_middle/ty/elaborate_impl.ts";
import { debug_Ty, fold_Clause, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { Binder as BinderC, EarlyBinder, PlaceholderConst, PlaceholderRegion, PlaceholderType, visit_Binder } from "../../../rustc_type_ir/binder.ts";
import { debug_Canonical } from "../../../rustc_type_ir/canonical.ts";
import type { AliasTy, Binder, ClosureKind, TraitRef, UniverseIndex } from "../../../rustc_type_ir/decls.ts";
import { elaborate, supertraits } from "../../../rustc_type_ir/elaborate.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { Ty_provided } from "../../../rustc_type_ir/inherent.ts";
import { UniverseIndex as UniverseIndexC } from "../../../rustc_type_ir/lib.ts";
import { as_interner, PolyExistentialPredicate, PolyExistentialTraitRef } from "../../../rustc_type_ir/predicate.ts";
import { relate_TraitRef } from "../../../rustc_type_ir/relate.ts";
import { CandidateHeadUsages } from "../../../rustc_type_ir/search_graph/mod.ts";
import { ProbeKind } from "../../../rustc_type_ir/solve/inspect.ts";
import {
  AccessedOpaques,
  AliasBoundKind,
  type CandidateSource,
  type CanonicalResponse,
  Certainty,
  debug_CandidateSource,
  debug_Response,
  Goal,
  GoalSource,
  MaybeInfo,
  type NoSolution,
  NoSolutionOrRerunNonErased,
  type QueryResultOrRerunNonErased,
  type RerunNonErased,
  RerunReason,
  RerunResultExt_for_Result,
  SizedTraitKind,
  fold_with_Goal,
  try_fold_with_Goal,
  visit_with_Goal,
} from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { AliasTy as AliasTyC, ProjectionAliasTy as ProjectionAliasTyImpl } from "../../../rustc_type_ir/ty_kind.ts";
import type { OpaqueAliasTy } from "../../../rustc_type_ir/ty/alias.ts";
import { TypingMode as TypingModeImpl } from "../../../rustc_type_ir/infer_ctxt.ts";
import { fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { upcast_from_self, type UpcastFrom } from "../../../rustc_type_ir/upcast.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { type Debug, debug_struct, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { panic, unported, unreachable } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { EvalCtxt } from "../../decls.ts";
import { has_no_inference_or_external_constraints, has_only_region_constraints } from "../mod.ts";
import type { TraitGoalProvenVia } from "../trait_goals.ts";
import { AmbiguousOrRerunNonErased, predicates_for_object_candidate } from "./structural_traits.ts";

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
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:63 probe_and_consider_implied_clause
  probe_and_consider_implied_clause<G>(
    G: GoalKind<G>,
    ecx: EvalCtxt,
    parent_source: CandidateSource,
    goal: Goal<G>,
    assumption: Clause,
    requirements: Iterable<[GoalSource, Goal<Predicate>]>,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    return G.probe_and_match_goal_against_assumption(ecx, parent_source, goal, assumption, (ecx) => {
      for (const [nested_source, goal] of requirements) {
        const r = ecx.add_goal(nested_source, goal);
        if (r.$ === "Err") return r;
      }
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    });
  },

  /// Consider a clause specifically for a `dyn Trait` self type. This requires
  /// additionally checking all of the supertraits and object bounds to hold,
  /// since they're not implied by the well-formedness of the object type.
  /// `NormalizesTo` overrides this to not check the supertraits for backwards
  /// compatibility with the old solver. cc trait-system-refactor-initiative#245.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:83 probe_and_consider_object_bound_candidate
  probe_and_consider_object_bound_candidate<G>(
    G: GoalKind<G>,
    ecx: EvalCtxt,
    source: CandidateSource,
    goal: Goal<G>,
    assumption: Clause,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    // We inline much of `probe_and_match_goal_against_assumption` and
    // `TraitPredicate::match_assumption` here, as we never encounter
    // `Sized` or `MetaSized` goals here, and we need to equate `goal`
    // and `assumption`'s trait refs directly inside this function in
    // order to prevent unsoundness (see below).

    const rejected = G.fast_reject_assumption(ecx, goal, assumption);
    if (rejected.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(rejected._0));

    return ecx.probe_trait_candidate(source).enter((ecx) => {
      const cx = ecx.cx();
      const self_ty_kind = G.self_ty(goal.predicate).kind();
      if (self_ty_kind.$ !== "Dynamic") {
        return panic("expected object type in `probe_and_consider_object_bound_candidate`");
      }
      const bounds = self_ty_kind._0;

      const trait_ref0 = BinderC.map_bound(assumption.kind(), (clause): TraitRef => {
        switch (clause.$) {
          case "Trait":
            return clause._0.trait_ref;
          case "Projection":
            return AliasTerm.trait_ref(clause._0.projection_term, as_interner(cx));

          case "RegionOutlives":
          case "TypeOutlives":
          case "ConstArgHasType":
          case "WellFormed":
          case "ConstEvaluatable":
          case "HostEffect":
          case "UnstableFeature":
            return unreachable("internal error: entered unreachable code: expected trait or projection predicate as an assumption");
        }
      });

      // If we need to prove `dyn for<'x> Trait<'x> + '?temp: Trait<'static>` with
      //
      // ```rs
      // trait Trait<'a>: 'a {}
      // ```
      //
      // we have the goal's trait ref as `Trait<'static>` and a theoretical impl
      // resembling:
      //
      // ```rs
      // impl<'s, 'hr> Trait<'hr> for dyn for<'x> Trait<'x> + 's
      // where
      //     dyn for<'a> Trait<'a> + 's: 'hr
      // {}
      // ```
      //
      // where 'hr is our bound var. The where-clause elaborates to `'s: 'hr`;
      // in this case we have 's := '?temp. Instantiating the binder gives us
      // 'hr := '?infer, and our goal has 'hr := 'static, so we need to equate
      // the instantiated trait ref to the goal in order to get '?infer := 'static,
      // since what we want is the constraint `'?temp: 'static`.
      //
      // If we instead passed the binder to predicates_for_object_candidate and let
      // it instantiate the binder itself, we would lose '?infer := 'static, since
      // predicates_for_object_candidate has no way of equating the trait ref with
      // the goal. We would simply have 'hr := '?infer, giving us the constraint
      // `?temp: '?infer`, which is satisfiable for any lifetime, leading to
      // unsoundness: trait-system-refactor-initiative#295.
      const trait_ref = ecx.instantiate_binder_with_infer(trait_ref0, relate_TraitRef);
      const eq = ecx.eq(goal.param_env, G.trait_ref(goal.predicate, cx), trait_ref, relate_TraitRef);
      if (eq.$ === "Err") return eq;

      const r = predicates_for_object_candidate(ecx, goal.param_env, trait_ref, bounds);
      if (r.$ === "Ok") {
        const requirements = r._0;
        const added = ecx.add_goals(GoalSource.ImplWhereBound, requirements);
        if (added.$ === "Err") return added;
        return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      }
      switch (r._0.$) {
        case "Ambiguous":
          return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
        case "RerunNonErased":
          return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0._0));
      }
    });
  },

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:176 probe_and_consider_param_env_candidate
  probe_and_consider_param_env_candidate<G>(
    G: GoalKind<G>,
    ecx: EvalCtxt,
    goal: Goal<G>,
    assumption: Clause,
  ): Result<Result<Candidate, CandidateHeadUsages>, RerunNonErased> {
    const rejected = G.fast_reject_assumption(ecx, goal, assumption);
    switch (rejected.$) {
      case "Ok":
        break;
      case "Err":
        return Ok(Err(CandidateHeadUsages.default_()));
    }

    // Dealing with `ParamEnv` candidates is a bit of a mess as we need to lazily
    // check whether the candidate is global while considering normalization.
    //
    // We need to write into `source` inside of `match_assumption`, but need to access it
    // in `probe` even if the candidate does not apply before we get there. We handle this
    // by using a `Cell` here. We only ever write into it inside of `match_assumption`.
    // PORT: the `Cell` is a one-field box read by both closures.
    const source: { value: CandidateSource } = { value: { $: "ParamEnv", _0: "Global" } };
    const [result, head_usages] = ecx
      .probe<CanonicalResponse>((result) => ({ $: "TraitCandidate", source: source.value, result }))
      .enter_single_candidate((ecx) =>
        // PORT: `.map_err(Into::into)` is the identity (`NoSolutionOrRerunNonErased` into itself).
        G.match_assumption(ecx, goal, assumption, (ecx): Result<CanonicalResponse, NoSolutionOrRerunNonErased> => {
          const evaluated = ecx.try_evaluate_added_goals();
          if (evaluated.$ === "Err") return evaluated;
          const characterized = ecx.characterize_param_env_assumption(goal.param_env, assumption);
          if (characterized.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(characterized._0));
          const [src, certainty] = characterized._0;
          source.value = src;
          return ecx.evaluate_added_goals_and_make_canonical_response(certainty);
        }),
      );

    const r = RerunResultExt_for_Result.map_err_to_rerun(result);
    if (r.$ === "Err") return r;
    switch (r._0.$) {
      case "Ok":
        return Ok(Ok({ source: source.value, result: r._0._0, head_usages }));
      case "Err":
        return Ok(Err(head_usages));
    }
  },

  /// Try equating an assumption predicate against a goal's predicate. If it
  /// holds, then execute the `then` callback, which should do any additional
  /// work, then produce a response (typically by executing
  /// [`EvalCtxt::evaluate_added_goals_and_make_canonical_response`]).
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:224 probe_and_match_goal_against_assumption
  probe_and_match_goal_against_assumption<G>(
    G: GoalKind<G>,
    ecx: EvalCtxt,
    source: CandidateSource,
    goal: Goal<G>,
    assumption: Clause,
    then: (ecx: EvalCtxt) => QueryResultOrRerunNonErased,
  ): Result<Candidate, NoSolutionOrRerunNonErased> {
    const rejected = G.fast_reject_assumption(ecx, goal, assumption);
    if (rejected.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(rejected._0));

    return ecx.probe_trait_candidate(source).enter((ecx) => G.match_assumption(ecx, goal, assumption, then));
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

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:452 should_assemble_impl_candidates
  should_assemble_impl_candidates(self: AssembleCandidatesFrom): boolean {
    switch (self) {
      case "All":
        return true;
      case "EnvAndBounds":
        return false;
    }
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

// FIXME(#155443): This function should only ever return an error
// as we want to force a rerun when accessing opaques. We should change
// this file to revert all the newly added places which return `NoSolution`.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:481 assemble_and_evaluate_candidates
EvalCtxt.prototype.assemble_and_evaluate_candidates = function <G>(
  this: EvalCtxt,
  goal0: Goal<G>,
  assemble_from: AssembleCandidatesFrom,
  G: GoalKind<G>,
): Result<[Candidate[], FailedCandidateInfo], RerunNonErased> {
  const candidates: Candidate[] = [];
  const failed_candidate_info: FailedCandidateInfo = { param_env_head_usages: CandidateHeadUsages.default_() };
  const normalized = this.structurally_normalize_ty(goal0.param_env, G.self_ty(goal0.predicate));
  if (normalized.$ !== "Ok") {
    return Ok([candidates, failed_candidate_info]);
  }
  const normalized_self_ty = normalized._0;

  const goal1: Goal<G> = Goal.with(
    goal0,
    as_interner(this.cx()),
    G.with_replaced_self_ty(goal0.predicate, this.cx(), normalized_self_ty),
    upcast_from_self,
  );

  if (Ty_provided.is_ty_var(normalized_self_ty)) {
    // debug!("self type has been normalized to infer");
    const r = this.try_assemble_bounds_via_registered_opaques(goal1, assemble_from, candidates, G);
    if (r.$ === "Err") return r;
    return Ok([candidates, failed_candidate_info]);
  }

  // Vars that show up in the rest of the goal substs may have been constrained by
  // normalizing the self type as well, since type variables are not uniquified.
  const goal = this.deeply_resolve_ignoring_regions(goal1, fold_Goal(G));

  if (TypingModeImpl.is_coherence(this.typing_mode())) {
    const candidate = this.consider_coherence_unknowable_candidate(goal, G);
    if (candidate.$ === "Ok") {
      candidates.push(candidate._0);
      return Ok([candidates, failed_candidate_info]);
    }
  }

  const alias_bounds = this.assemble_alias_bound_candidates(goal, candidates, G);
  if (alias_bounds.$ === "Err") return alias_bounds;
  const param_env = this.assemble_param_env_candidates(goal, candidates, failed_candidate_info, G);
  if (param_env.$ === "Err") return param_env;

  switch (assemble_from) {
    case "All": {
      const builtin = this.assemble_builtin_impl_candidates(goal, candidates, G);
      if (builtin.$ === "Err") return builtin;
      // For performance we only assemble impls if there are no candidates
      // which would shadow them. This is necessary to avoid hangs in rayon,
      // see trait-system-refactor-initiative#109 for more details.
      //
      // We always assemble builtin impls as trivial builtin impls have a higher
      // priority than where-clauses.
      //
      // We only do this if any such candidate applies without any constraints
      // as we may want to weaken inference guidance in the future and don't want
      // to worry about causing major performance regressions when doing so.
      // See trait-system-refactor-initiative#226 for some ideas here.
      let assemble_impls: boolean;
      const typing_mode = this.typing_mode();
      switch (typing_mode.$) {
        case "Coherence":
          assemble_impls = true;
          break;
        case "Typeck":
        case "PostTypeckUntilBorrowck":
        case "Reflection":
        case "PostBorrowck":
        case "PostAnalysis":
        case "Codegen":
        case "ErasedNotCoherence":
          assemble_impls = !candidates.some(
            (c) =>
              ((c.source.$ === "ParamEnv" && c.source._0 === "NonGlobal") || c.source.$ === "AliasBound") &&
              has_no_inference_or_external_constraints(c.result),
          );
          break;
      }
      if (assemble_impls) {
        const impls = this.assemble_impl_candidates(goal, candidates, G);
        if (impls.$ === "Err") return impls;
        this.assemble_object_bound_candidates(goal, candidates, G);
      }
      break;
    }
    case "EnvAndBounds": {
      // This is somewhat inconsistent and may make #57893 slightly easier to exploit.
      // However, it matches the behavior of the old solver. See
      // `tests/ui/traits/next-solver/normalization-shadowing/use_object_if_empty_env.rs`.
      if (normalized_self_ty.kind().$ === "Dynamic" && !candidates.some((c) => c.source.$ === "ParamEnv")) {
        this.assemble_object_bound_candidates(goal, candidates, G);
      }
      break;
    }
  }

  return Ok([candidates, failed_candidate_info]);
};

// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:568 forced_ambiguity
EvalCtxt.prototype.forced_ambiguity = function (this: EvalCtxt, maybe: MaybeInfo): Result<Candidate, NoSolutionOrRerunNonErased> {
  // This may fail if `try_evaluate_added_goals` overflows because it
  // fails to reach a fixpoint but ends up getting an error after
  // running for some additional step.
  //
  // FIXME(@lcnr): While I believe an error here to be possible, we
  // currently don't have any test which actually triggers it. @lqd
  // created a minimization for an ICE in typenum, but that one no
  // longer fails here. cc trait-system-refactor-initiative#105.
  const source: CandidateSource = { $: "BuiltinImpl", _0: { $: "Misc" } };
  const certainty: Certainty = { $: "Maybe", _0: maybe };
  return this.probe_trait_candidate(source).enter((this_) => this_.evaluate_added_goals_and_make_canonical_response(certainty));
};

// #[instrument(level = "trace", skip_all)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:587 assemble_impl_candidates
EvalCtxt.prototype.assemble_impl_candidates = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  candidates: Candidate[],
  G: GoalKind<G>,
): Result<undefined, RerunNonErased> {
  const cx = this.cx();
  const goal_trait_ref = G.trait_ref(goal.predicate, cx);
  const r = as_interner(cx).ir_for_each_relevant_impl(
    goal_trait_ref,
    (impl_def_id): Result<null, RerunNonErased> => {
      const m = RerunResultExt_for_Result.map_err_to_rerun(
        G.consider_impl_candidate(this, goal, goal_trait_ref, impl_def_id, (ecx) =>
          ecx.evaluate_added_goals_and_make_canonical_response(Certainty.Yes),
        ),
      );
      if (m.$ === "Err") return m;
      switch (m._0.$) {
        case "Ok":
          candidates.push(m._0._0);
          break;
        case "Err":
          break;
      }

      return Ok(null);
    },
    VisitorResultC.Result<RerunNonErased>(),
  );
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

// #[instrument(level = "trace", skip_all)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:609 assemble_builtin_impl_candidates
EvalCtxt.prototype.assemble_builtin_impl_candidates = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  candidates: Candidate[],
  G: GoalKind<G>,
): Result<undefined, RerunNonErased> {
  const cx = this.cx();
  const icx = as_interner(cx);
  const trait_def_id = G.trait_def_id(goal.predicate, cx);

  // Builtin impls regularly are not `is_fully_generic_for_reflection`, so instead
  // of trying to handle these manually, we just reject all builtin impls in reflection
  // mode. We can probably lift this restriction for specific cases, but this is safer.
  // See `try_as_dyn_builtin_impl` for how just allowing all builtin impls is unsound.
  if (TypingModeImpl.is_reflection(this.typing_mode())) {
    return Ok(undefined);
  }

  // N.B. When assembling built-in candidates for lang items that are also
  // `auto` traits, then the auto trait candidate that is assembled in
  // `consider_auto_trait_candidate` MUST be disqualified to remain sound.
  //
  // Instead of adding the logic here, it's a better idea to add it in
  // `EvalCtxt::disqualify_auto_trait_candidate_due_to_possible_impl` in
  // `solve::trait_goals` instead.
  let result: Result<Candidate, NoSolutionOrRerunNonErased>;
  const self_ty_kind = G.self_ty(goal.predicate).kind();
  if (self_ty_kind.$ === "Error") {
    result = G.consider_error_guaranteed_candidate(this, goal, self_ty_kind._0);
  } else if (icx.trait_is_auto(trait_def_id)) {
    result = G.consider_auto_trait_candidate(this, goal);
  } else if (icx.trait_is_alias(trait_def_id)) {
    result = G.consider_trait_alias_candidate(this, goal);
  } else {
    switch (icx.as_trait_lang_item(trait_def_id)) {
      case "Sized":
        result = G.consider_builtin_sizedness_candidates(this, goal, SizedTraitKind.Sized);
        break;
      case "MetaSized":
        result = G.consider_builtin_sizedness_candidates(this, goal, SizedTraitKind.MetaSized);
        break;
      case "PointeeSized":
        return unreachable("internal error: entered unreachable code: `PointeeSized` is removed during lowering");
      case "Copy":
      case "Clone":
      case "TrivialClone":
        result = G.consider_builtin_copy_clone_candidate(this, goal);
        break;
      case "Fn":
        result = G.consider_builtin_fn_trait_candidates(this, goal, "Fn" satisfies ClosureKind);
        break;
      case "FnMut":
        result = G.consider_builtin_fn_trait_candidates(this, goal, "FnMut" satisfies ClosureKind);
        break;
      case "FnOnce":
        result = G.consider_builtin_fn_trait_candidates(this, goal, "FnOnce" satisfies ClosureKind);
        break;
      case "AsyncFn":
        result = G.consider_builtin_async_fn_trait_candidates(this, goal, "Fn" satisfies ClosureKind);
        break;
      case "AsyncFnMut":
        result = G.consider_builtin_async_fn_trait_candidates(this, goal, "FnMut" satisfies ClosureKind);
        break;
      case "AsyncFnOnce":
        result = G.consider_builtin_async_fn_trait_candidates(this, goal, "FnOnce" satisfies ClosureKind);
        break;
      case "FnPtrTrait":
        result = G.consider_builtin_fn_ptr_trait_candidate(this, goal);
        break;
      case "AsyncFnKindHelper":
        result = G.consider_builtin_async_fn_kind_helper_candidate(this, goal);
        break;
      case "Tuple":
        result = G.consider_builtin_tuple_candidate(this, goal);
        break;
      case "PointeeTrait":
        result = G.consider_builtin_pointee_candidate(this, goal);
        break;
      case "Future":
        result = G.consider_builtin_future_candidate(this, goal);
        break;
      case "Iterator":
        result = G.consider_builtin_iterator_candidate(this, goal);
        break;
      case "FusedIterator":
        result = G.consider_builtin_fused_iterator_candidate(this, goal);
        break;
      case "AsyncIterator":
        result = G.consider_builtin_async_iterator_candidate(this, goal);
        break;
      case "Coroutine":
        result = G.consider_builtin_coroutine_candidate(this, goal);
        break;
      case "DiscriminantKind":
        result = G.consider_builtin_discriminant_kind_candidate(this, goal);
        break;
      case "Destruct":
        result = G.consider_builtin_destruct_candidate(this, goal);
        break;
      case "TransmuteTrait":
        result = G.consider_builtin_transmute_candidate(this, goal);
        break;
      case "BikeshedGuaranteedNoDrop":
        result = G.consider_builtin_bikeshed_guaranteed_no_drop_candidate(this, goal);
        break;
      case "TryAsDyn":
        result = G.consider_builtin_try_as_dyn_candidate(this, goal);
        break;
      case "Field":
        result = G.consider_builtin_field_candidate(this, goal);
        break;
      default:
        result = Err(NoSolutionOrRerunNonErased.from_NoSolution(NoSolution));
        break;
    }
  }

  if (result.$ === "Ok") candidates.push(result._0);

  // There may be multiple unsize candidates for a trait with several supertraits:
  // `trait Foo: Bar<A> + Bar<B>` and `dyn Foo: Unsize<dyn Bar<_>>`
  if (icx.is_trait_lang_item(trait_def_id, "Unsize")) {
    const unsize = G.consider_structural_builtin_unsize_candidates(this, goal);
    if (unsize.$ === "Err") return unsize;
    candidates.push(...unsize._0);
  }

  return Ok(undefined);
};

// #[instrument(level = "trace", skip_all)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:737 assemble_param_env_candidates
EvalCtxt.prototype.assemble_param_env_candidates = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  candidates: Candidate[],
  failed_candidate_info: FailedCandidateInfo,
  G: GoalKind<G>,
): Result<undefined, RerunNonErased> {
  for (const assumption of goal.param_env.caller_bounds()) {
    const r = G.probe_and_consider_param_env_candidate(this, goal, assumption);
    if (r.$ === "Err") return r;
    switch (r._0.$) {
      case "Ok":
        candidates.push(r._0._0);
        break;
      case "Err":
        failed_candidate_info.param_env_head_usages.merge_usages(r._0._0);
        break;
    }
  }

  return Ok(undefined);
};

// #[instrument(level = "trace", skip_all)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:756 assemble_alias_bound_candidates
EvalCtxt.prototype.assemble_alias_bound_candidates = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  candidates: Candidate[],
  G: GoalKind<G>,
): Result<undefined, RerunNonErased> {
  const res = this.probe<undefined>(() => ProbeKind.NormalizedSelfTyAssembly).enter((ecx) => {
    const r = ecx.assemble_alias_bound_candidates_recur(
      G.self_ty(goal.predicate),
      goal,
      candidates,
      AliasBoundKind.SelfBounds,
      G,
    );
    if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
    return Ok(undefined);
  });

  // always returns Ok
  if (res.$ === "Ok") return Ok(undefined);
  switch (res._0.$) {
    case "RerunNonErased":
      return Err(res._0._0);
    case "NoSolution":
      return unreachable();
  }
};

/// For some deeply nested `<T>::A::B::C::D` rigid associated type,
/// we should explore the item bounds for all levels, since the
/// `associated_type_bounds` feature means that a parent associated
/// type may carry bounds for a nested associated type.
///
/// If we have a projection, check that its self type is a rigid projection.
/// If so, continue searching by recursively calling after normalization.
// FIXME: This may recurse infinitely, but I can't seem to trigger it without
// hitting another overflow error something. Add a depth parameter needed later.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:790 assemble_alias_bound_candidates_recur
EvalCtxt.prototype.assemble_alias_bound_candidates_recur = function <G>(
  this: EvalCtxt,
  self_ty: Ty,
  goal: Goal<G>,
  candidates: Candidate[],
  consider_self_bounds: AliasBoundKind,
  G: GoalKind<G>,
): Result<undefined, RerunNonErased> {
  let alias_ty: AliasTy;
  let def_id: DefId;
  const kind = self_ty.kind();
  switch (kind.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Pat":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "UnsafeBinder":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Param":
    case "Placeholder":
    case "Error":
      return Ok(undefined);
    case "Bound":
      return unported(
        "rustc_next_trait_solver::solve::assembly::EvalCtxt::assemble_alias_bound_candidates_recur: panic message needs `{:?}` of `Goal<I, G>` (header)",
      );
    case "Infer":
      switch (kind._0.$) {
        case "IntVar":
        case "FloatVar":
          return Ok(undefined);
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return unported(
            "rustc_next_trait_solver::solve::assembly::EvalCtxt::assemble_alias_bound_candidates_recur: panic message needs `{:?}` of `Goal<I, G>` (header)",
          );
        case "TyVar": {
          // If we hit infer when normalizing the self type of an alias,
          // then bail with ambiguity. We should never encounter this on
          // the *first* iteration of this recursive function.
          const result = this.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
          if (result.$ === "Ok") {
            candidates.push({
              source: { $: "AliasBound", _0: consider_self_bounds },
              result: result._0,
              head_usages: CandidateHeadUsages.default_(),
            });
          }
          return Ok(undefined);
        }
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Alias": {
      const [is_rigid, alias] = [kind._0, kind._1];
      if (is_rigid === "Yes" && alias.kind.$ === "Projection") {
        [alias_ty, def_id] = [alias, alias.kind.def_id];
        break;
      }

      if (is_rigid === "Yes" && alias.kind.$ === "Opaque") {
        [alias_ty, def_id] = [alias, alias.kind.def_id];
        break;
      }

      if (is_rigid === "No") {
        return unreachable(`internal error: entered unreachable code: non-rigid self type: ${debug_Ty(self_ty, PLAIN)}`);
      }

      // ty::Alias(ty::IsRigid::Yes, AliasTy { kind: ty::Inherent { .. } | ty::Free { .. }, .. })
      as_interner(this.cx()).delay_bug(`could not normalize ${debug_Ty(self_ty, PLAIN)}, it is not WF`);
      return Ok(undefined);
    }
  }

  switch (consider_self_bounds) {
    case "SelfBounds": {
      for (const assumption of iter_bounds(this.cx(), as_interner(this.cx()).item_self_bounds(def_id), alias_ty.args)) {
        const c = G.probe_and_consider_implied_clause(this, { $: "AliasBound", _0: consider_self_bounds }, goal, assumption, []);
        if (c.$ === "Ok") candidates.push(c._0);
      }
      break;
    }
    case "NonSelfBounds": {
      for (const assumption of iter_bounds(this.cx(), as_interner(this.cx()).item_non_self_bounds(def_id), alias_ty.args)) {
        const c = G.probe_and_consider_implied_clause(this, { $: "AliasBound", _0: consider_self_bounds }, goal, assumption, []);
        if (c.$ === "Ok") candidates.push(c._0);
      }
      break;
    }
  }

  candidates.push(...G.consider_additional_alias_assumptions(this, goal, alias_ty));

  const projection_ty = AliasTyC.try_to_projection(alias_ty);
  if (projection_ty === undefined) {
    return Ok(undefined);
  }

  // Recurse on the self type of the projection.
  const next = this.structurally_normalize_ty(goal.param_env, ProjectionAliasTyImpl.projection_self_ty(projection_ty));
  if (next.$ === "Ok") {
    return this.assemble_alias_bound_candidates_recur(next._0, goal, candidates, AliasBoundKind.NonSelfBounds, G);
  }
  switch (next._0.$) {
    case "NoSolution":
      return Ok(undefined);
    case "RerunNonErased":
      return Err(next._0._0);
  }
};

// #[instrument(level = "trace", skip_all)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:920 assemble_object_bound_candidates
EvalCtxt.prototype.assemble_object_bound_candidates = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  candidates: Candidate[],
  G: GoalKind<G>,
): void {
  const cx = this.cx();
  const icx = as_interner(cx);
  if (icx.is_sizedness_trait(G.trait_def_id(goal.predicate, cx))) {
    // `dyn MetaSized` is valid, but should get its `MetaSized` impl from
    // being `dyn` (SizedCandidate), not from the object candidate.
    return;
  }

  // Builtin impls regularly are not `is_fully_generic_for_reflection`, so instead
  // of trying to handle these manually, we just reject all builtin impls in reflection
  // mode. We can probably lift this restriction for specific cases, but this is safer.
  // See `try_as_dyn_builtin_impl` for how just allowing all builtin impls is unsound.
  if (TypingModeImpl.is_reflection(this.typing_mode())) {
    return;
  }

  const self_ty = G.self_ty(goal.predicate);
  const kind = self_ty.kind();
  let bounds;
  switch (kind.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Pat":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "UnsafeBinder":
    case "Alias":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Param":
    case "Placeholder":
    case "Error":
      return;
    case "Infer":
      if (kind._0.$ === "IntVar" || kind._0.$ === "FloatVar") return;
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return unported(
        "rustc_next_trait_solver::solve::assembly::EvalCtxt::assemble_object_bound_candidates: panic message needs `{:?}` of `Goal<I, G>` (header)",
      );
    case "Bound":
      return unported(
        "rustc_next_trait_solver::solve::assembly::EvalCtxt::assemble_object_bound_candidates: panic message needs `{:?}` of `Goal<I, G>` (header)",
      );
    case "Dynamic":
      bounds = kind._0;
      break;
  }

  // Do not consider built-in object impls for dyn-incompatible types.
  const principal_def_id = bounds.principal_def_id();
  if (principal_def_id !== undefined && !icx.trait_is_dyn_compatible(principal_def_id)) {
    return;
  }

  // Consider all of the auto-trait and projection bounds, which don't
  // need to be recorded as a `BuiltinImplSource::Object` since they don't
  // really have a vtable base...
  for (const bound of bounds) {
    switch (BinderC.skip_binder(bound).$) {
      case "Trait":
        // Skip principal
        break;
      case "Projection":
      case "AutoTrait": {
        const c = G.probe_and_consider_object_bound_candidate(
          this,
          { $: "BuiltinImpl", _0: { $: "Misc" } },
          goal,
          PolyExistentialPredicate.with_self_ty(bound, cx, self_ty),
        );
        if (c.$ === "Ok") candidates.push(c._0);
        break;
      }
    }
  }

  // FIXME: We only need to do *any* of this if we're considering a trait goal,
  // since we don't need to look at any supertrait or anything if we are doing
  // a projection goal.
  const principal = bounds.principal();
  if (principal !== undefined) {
    const principal_trait_ref = PolyExistentialTraitRef.with_self_ty(principal, icx, self_ty);
    let idx = 0;
    for (const assumption of supertraits(cx, principal_trait_ref)) {
      const c = G.probe_and_consider_object_bound_candidate(
        this,
        { $: "BuiltinImpl", _0: { $: "Object", _0: idx } },
        goal,
        Clause_upcast_from_PolyTraitRef(assumption, cx),
      );
      if (c.$ === "Ok") candidates.push(c._0);
      idx++;
    }
  }
};

/// In coherence we have to not only care about all impls we know about, but
/// also consider impls which may get added in a downstream or sibling crate
/// or which an upstream impl may add in a minor release.
///
/// To do so we return a single ambiguous candidate in case such an unknown
/// impl could apply to the current goal.
// #[instrument(level = "trace", skip_all)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1022 consider_coherence_unknowable_candidate
EvalCtxt.prototype.consider_coherence_unknowable_candidate = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  G: GoalKind<G>,
): Result<Candidate, NoSolutionOrRerunNonErased> {
  return this.probe_trait_candidate({ $: "CoherenceUnknowable" }).enter((ecx) => {
    const cx = ecx.cx();
    const trait_ref = G.trait_ref(goal.predicate, cx);
    const knowable = ecx.trait_ref_is_knowable(goal.param_env, trait_ref);
    if (knowable.$ === "Err") return knowable;
    if (knowable._0) {
      return Err(NoSolutionOrRerunNonErased.from_NoSolution(NoSolution));
    } else {
      // While the trait bound itself may be unknowable, we may be able to
      // prove that a super trait is not implemented. For this, we recursively
      // prove the super trait bounds of the current goal.
      //
      // We skip the goal itself as that one would cycle.
      const predicate: Predicate = Predicate_upcast_from_TraitRef(trait_ref, cx);
      const elaborated = elaborate(cx, [predicate], Elaboratable_Predicate);
      const added = ecx.add_goals(
        GoalSource.Misc,
        (function* (): Generator<Goal<Predicate>> {
          // `.skip(1)`
          if (elaborated.next() === undefined) return;
          for (let p = elaborated.next(); p !== undefined; p = elaborated.next()) {
            yield Goal.with(goal, as_interner(cx), p, upcast_from_self);
          }
        })(),
      );
      if (added.$ === "Err") return added;
      return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
    }
  });
};

// PORT: fieldless enum without derives.
export type AllowInferenceConstraints = "Yes" | "No";
export const AllowInferenceConstraints = { Yes: "Yes", No: "No" } as const;

/// Check whether we can ignore impl candidates due to specialization.
///
/// This is only necessary for `feature(specialization)` and seems quite ugly.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1063 filter_specialized_impls
EvalCtxt.prototype.filter_specialized_impls = function (
  this: EvalCtxt,
  allow_inference_constraints: AllowInferenceConstraints,
  candidates: Candidate[],
): void {
  if (TypingModeImpl.is_coherence(this.typing_mode())) {
    return;
  }

  let i = 0;
  outer: while (i < candidates.length) {
    const victim = candidates[i]!.source;
    if (victim.$ !== "Impl") {
      i += 1;
      continue;
    }
    const victim_def_id = victim._0;

    for (let j = 0; j < candidates.length; j++) {
      const c = candidates[j]!;
      if (i === j) {
        continue;
      }

      if (c.source.$ !== "Impl") {
        continue;
      }
      const other_def_id = c.source._0;

      // See if we can toss out `victim` based on specialization.
      //
      // While this requires us to know *for sure* that the `lhs` impl applies
      // we still use modulo regions here. This is fine as specialization currently
      // assumes that specializing impls have to be always applicable, meaning that
      // the only allowed region constraints may be constraints also present on the default impl.
      //
      // If both impls have the same response, dropping victim doesn't change the
      // result. We need to do so here as we don't merge distinct impl candidates.
      if (
        allow_inference_constraints === "Yes" ||
        has_only_region_constraints(c.result) ||
        // PORT: derived `PartialEq` of `Canonical<Response>` (contract rule 4).
        intern_key(c.result) === intern_key(candidates[i]!.result)
      ) {
        if (as_interner(this.cx()).impl_specializes(other_def_id, victim_def_id)) {
          candidates.splice(i, 1);
          continue outer;
        }
      }
    }

    i += 1;
  }
};

/// If the self type is the hidden type of an opaque, try to assemble
/// candidates for it by consider its item bounds and by using blanket
/// impls. This is used to incompletely guide type inference when handling
/// non-defining uses in the defining scope.
///
/// We otherwise just fail fail with ambiguity. Even if we're using an
/// opaque type item bound or a blank impls, we still force its certainty
/// to be `Maybe` so that we properly prove this goal later.
///
/// See <https://github.com/rust-lang/trait-system-refactor-initiative/issues/182>
/// for why this is necessary.
// #[tracing::instrument(skip(self, assemble_from))]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1124 try_assemble_bounds_via_registered_opaques
EvalCtxt.prototype.try_assemble_bounds_via_registered_opaques = function <G>(
  this: EvalCtxt,
  goal: Goal<G>,
  assemble_from: AssembleCandidatesFrom,
  candidates: Candidate[],
  G: GoalKind<G>,
): Result<undefined, RerunNonErased> {
  const self_ty = G.self_ty(goal.predicate);
  // We only use this hack during HIR typeck.
  let opaque_types: OpaqueAliasTy[];
  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    case "Typeck":
      opaque_types = this.opaques_with_sub_unified_hidden_type(self_ty);
      break;
    case "Coherence":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
    case "PostAnalysis":
    case "Reflection":
    case "Codegen":
      opaque_types = [];
      break;
    case "ErasedNotCoherence": {
      const r = AccessedOpaques.rerun_if_any_opaque_has_infer_as_hidden_type(this.opaque_accesses, RerunReason.SelfTyInfer);
      if (r.$ === "Err") return r;
      opaque_types = [];
      break;
    }
  }

  if (opaque_types.length === 0) {
    const c = this.forced_ambiguity(MaybeInfo.AMBIGUOUS);
    if (c.$ === "Ok") candidates.push(c._0);
    return Ok(undefined);
  }

  for (const opaque_ty of opaque_types) {
    // debug!("self ty is sub unified with {opaque_ty:?}");

    class ReplaceOpaque implements TypeFolder {
      constructor(
        public cx_: TyCtxt,
        public opaque_ty: OpaqueAliasTy,
        public self_ty: Ty,
      ) {}

      // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1161 cx
      cx(): TyCtxt {
        return this.cx_;
      }

      // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1164 fold_ty
      fold_ty(ty: Ty): Ty {
        const k = ty.kind();
        if (k.$ === "Alias") {
          const opaque_ty = AliasTyC.try_to_opaque(k._1);
          if (opaque_ty !== undefined) {
            // PORT: derived `PartialEq` of `OpaqueAliasTy` (contract rule 4).
            if (intern_key(opaque_ty) === intern_key(this.opaque_ty)) {
              // debug_assert_eq!(is_rigid, ty::IsRigid::No);
              return this.self_ty;
            }
          }
        }
        return fold_Ty.super_fold_with(ty, this);
      }

      // PORT: the provided `TypeFolder` methods it does not override.
      fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
        return TypeFolder_provided.fold_binder(this, t, d);
      }
      fold_region(r: Region): Region {
        return TypeFolder_provided.fold_region(this, r);
      }
      fold_const(c: Const): Const {
        return TypeFolder_provided.fold_const(this, c);
      }
      fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
        return TypeFolder_provided.fold_predicate(this, p, d);
      }
      fold_clauses(c: Clauses): Clauses {
        return TypeFolder_provided.fold_clauses(this, c);
      }
    }

    // We look at all item-bounds of the opaque, replacing the
    // opaque with the current self type before considering
    // them as a candidate. Imagine we've got `?x: Trait<?y>`
    // and `?x` has been sub-unified with the hidden type of
    // `impl Trait<u32>`, We take the item bound `opaque: Trait<u32>`
    // and replace all occurrences of `opaque` with `?x`. This results
    // in a `?x: Trait<u32>` alias-bound candidate.
    for (const item_bound of iter_bounds(this.cx(), as_interner(this.cx()).item_self_bounds(opaque_ty.kind), opaque_ty.args)) {
      const assumption = fold_Clause.fold_with(item_bound, new ReplaceOpaque(this.cx(), opaque_ty, self_ty));
      const c = G.probe_and_match_goal_against_assumption(
        this,
        { $: "AliasBound", _0: AliasBoundKind.SelfBounds },
        goal,
        assumption,
        (ecx) =>
          // We want to reprove this goal once we've inferred the
          // hidden type, so we force the certainty to `Maybe`.
          ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS),
      );
      if (c.$ === "Ok") candidates.push(c._0);
    }
  }

  // If the self type is sub unified with any opaque type, we also look at blanket
  // impls for it.
  //
  // See tests/ui/impl-trait/non-defining-uses/use-blanket-impl.rs for an example.
  if (AssembleCandidatesFrom.should_assemble_impl_candidates(assemble_from)) {
    const cx = this.cx();
    const goal_trait_ref = G.trait_ref(goal.predicate, cx);

    const r = as_interner(cx).for_each_blanket_impl(
      G.trait_def_id(goal.predicate, cx),
      (impl_def_id): Result<null, RerunNonErased> => {
        const m = RerunResultExt_for_Result.map_err_to_rerun(
          G.consider_impl_candidate(this, goal, goal_trait_ref, impl_def_id, (ecx) => {
            if (Ty_provided.is_ty_var(ecx.shallow_resolve(self_ty))) {
              // We force the certainty of impl candidates to be `Maybe`.
              return ecx.evaluate_added_goals_and_make_canonical_response(Certainty.AMBIGUOUS);
            } else {
              // We don't want to use impls if they constrain the opaque.
              //
              // FIXME(trait-system-refactor-initiative#229): This isn't
              // perfect yet as it still allows us to incorrectly constrain
              // other inference variables.
              return Err(NoSolutionOrRerunNonErased.from_NoSolution(NoSolution));
            }
          }),
        );
        if (m.$ === "Err") return m;
        switch (m._0.$) {
          case "Ok":
            candidates.push(m._0._0);
            break;
          case "Err":
            break;
        }

        return Ok(null);
      },
      VisitorResultC.Result<RerunNonErased>(),
    );
    if (r.$ === "Err") return r;
  }

  if (candidates.length === 0) {
    const source: CandidateSource = { $: "BuiltinImpl", _0: { $: "Misc" } };
    const certainty: Certainty = {
      $: "Maybe",
      _0: {
        cause: { $: "Ambiguity" },
        opaque_types_jank: "ErrorIfRigidSelfTy",
        stalled_on_coroutines: "No",
      },
    };
    const c = this.probe_trait_candidate(source).enter((this_) => this_.evaluate_added_goals_and_make_canonical_response(certainty));
    if (c.$ === "Ok") candidates.push(c._0);
  }

  return Ok(undefined);
};

/// Assemble and merge candidates for goals which are related to an underlying trait
/// goal. Right now, this is normalizes-to and host effect goals.
///
/// We sadly can't simply take all possible candidates for normalization goals
/// and check whether they result in the same constraints. We want to make sure
/// that trying to normalize an alias doesn't result in constraints which aren't
/// otherwise required.
///
/// Most notably, when proving a trait goal by via a where-bound, we should not
/// normalize via impls which have stricter region constraints than the where-bound:
///
/// ```rust
/// trait Trait<'a> {
///     type Assoc;
/// }
///
/// impl<'a, T: 'a> Trait<'a> for T {
///     type Assoc = u32;
/// }
///
/// fn with_bound<'a, T: Trait<'a>>(_value: T::Assoc) {}
/// ```
///
/// The where-bound of `with_bound` doesn't specify the associated type, so we would
/// only be able to normalize `<T as Trait<'a>>::Assoc` by using the impl. This impl
/// adds a `T: 'a` bound however, which would result in a region error. Given that the
/// user explicitly wrote that `T: Trait<'a>` holds, this is undesirable and we instead
/// treat the alias as rigid.
///
/// See trait-system-refactor-initiative#124 for more details.
// #[instrument(level = "debug", skip_all, fields(proven_via, goal), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1285 assemble_and_merge_candidates
EvalCtxt.prototype.assemble_and_merge_candidates = function <G>(
  this: EvalCtxt,
  proven_via: TraitGoalProvenVia | undefined,
  goal: Goal<G>,
  inject_forced_ambiguity_candidate: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased> | undefined,
  inject_normalize_to_rigid_candidate: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased>,
  G: GoalKind<G>,
): QueryResultOrRerunNonErased {
  if (proven_via === undefined) {
    // We don't care about overflow. If proving the trait goal overflowed, then
    // it's enough to report an overflow error for that, we don't also have to
    // overflow during normalization.
    //
    // We use `forced_ambiguity` here over `make_ambiguous_response_no_constraints`
    // because the former will also record a built-in candidate in the inspector.
    const c = this.forced_ambiguity(MaybeInfo.AMBIGUOUS);
    if (c.$ === "Err") return c;
    return Ok(c._0.result);
  }

  switch (proven_via) {
    case "ParamEnv":
    case "AliasBound": {
      // Even when a trait bound has been proven using a where-bound, we
      // still need to consider alias-bounds for normalization, see
      // `tests/ui/next-solver/alias-bound-shadowed-by-env.rs`.
      const assembled = this.assemble_and_evaluate_candidates(goal, AssembleCandidatesFrom.EnvAndBounds, G);
      if (assembled.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(assembled._0));
      let [candidates] = assembled._0;
      // debug!(?candidates);

      // If the trait goal has been proven by using the environment, we want to treat
      // aliases as rigid if there are no applicable projection bounds in the environment.
      if (candidates.length === 0) {
        return inject_normalize_to_rigid_candidate(this);
      }

      // If we're normalizing an GAT, we bail if using a where-bound would constrain
      // its generic arguments.
      const result = inject_forced_ambiguity_candidate(this);
      if (result !== undefined) {
        return result;
      }

      // We still need to prefer where-bounds over alias-bounds however.
      // See `tests/ui/winnowing/norm-where-bound-gt-alias-bound.rs`.
      if (candidates.some((c) => c.source.$ === "ParamEnv")) {
        candidates = candidates.filter((c) => c.source.$ === "ParamEnv");
      }

      const merged = this.try_merge_candidates(candidates);
      if (merged !== undefined) {
        const [response] = merged;
        return Ok(response);
      } else {
        return map_err_into(this.flounder(candidates));
      }
    }
    case "Misc": {
      const assembled = this.assemble_and_evaluate_candidates(goal, AssembleCandidatesFrom.All, G);
      if (assembled.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(assembled._0));
      let [candidates] = assembled._0;

      // Prefer "orphaned" param-env normalization predicates, which are used
      // (for example, and ideally only) when proving item bounds for an impl.
      if (candidates.some((c) => c.source.$ === "ParamEnv")) {
        candidates = candidates.filter((c) => c.source.$ === "ParamEnv");
      }

      // We drop specialized impls to allow normalization via a final impl here. In case
      // the specializing impl has different inference constraints from the specialized
      // impl, proving the trait goal is already ambiguous, so we never get here. This
      // means we can just ignore inference constraints and don't have to special-case
      // constraining the normalized-to `term`.
      this.filter_specialized_impls(AllowInferenceConstraints.Yes, candidates);
      const merged = this.try_merge_candidates(candidates);
      if (merged !== undefined) {
        const [response] = merged;
        return Ok(response);
      } else {
        return map_err_into(this.flounder(candidates));
      }
    }
  }
};

/// Compute whether a param-env assumption is global or non-global after normalizing it.
///
/// This is necessary because, for example, given:
///
/// ```ignore,rust
/// where
///     T: Trait<Assoc = u32>,
///     i32: From<T::Assoc>,
/// ```
///
/// The `i32: From<T::Assoc>` bound is non-global before normalization, but is global after.
/// Since the old trait solver normalized param-envs eagerly, we want to emulate this
/// behavior lazily.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1382 characterize_param_env_assumption
EvalCtxt.prototype.characterize_param_env_assumption = function (
  this: EvalCtxt,
  param_env: ParamEnv,
  assumption: Clause,
): Result<[CandidateSource, Certainty], NoSolution> {
  // FIXME: This should be fixed, but it also requires changing the behavior
  // in the old solver which is currently relied on.
  if (TypeVisitableExt.has_bound_vars(assumption, fold_Clause)) {
    return Ok<[CandidateSource, Certainty]>([{ $: "ParamEnv", _0: "NonGlobal" }, Certainty.Yes]);
  }

  const r = fold_Clause.visit_with(assumption, new FindParamInClause(this, param_env, [], 0));
  switch (r.$) {
    case "Break":
      switch (r._0.$) {
        case "Err":
          return Err(NoSolution);
        case "Ok":
          return Ok<[CandidateSource, Certainty]>([{ $: "ParamEnv", _0: "NonGlobal" }, r._0._0]);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Continue":
      return Ok<[CandidateSource, Certainty]>([{ $: "ParamEnv", _0: "Global" }, Certainty.Yes]);
  }
};

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

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1428 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<Result<Certainty, NoSolution>> {
    this.universes.push(undefined);
    const r = visit_Binder(d).super_visit_with(t, this);
    if (r.$ === "Break") return r;
    this.universes.pop();
    return ControlFlowC.CONTINUE;
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1435 visit_ty
  visit_ty(ty0: Ty): ControlFlow<Result<Certainty, NoSolution>> {
    const ty1 = this.ecx.replace_bound_vars(ty0, this.universes, fold_Ty);
    const normalized = this.ecx.structurally_normalize_ty(this.param_env, ty1);
    if (normalized.$ !== "Ok") {
      return ControlFlowC.Break(Err(NoSolution));
    }
    const ty = normalized._0;

    const kind = ty.kind();
    if (kind.$ === "Placeholder") {
      if (PlaceholderType.universe(kind._0) === UniverseIndexC.ROOT) {
        return ControlFlowC.Break(Ok(Certainty.Yes));
      } else {
        return ControlFlowC.CONTINUE;
      }
    } else if (kind.$ === "Infer") {
      return ControlFlowC.Break(Ok(Certainty.AMBIGUOUS));
    } else if (
      TypeVisitableExt.has_type_flags(
        ty,
        TypeFlags.union(TypeFlags.union(TypeFlags.HAS_PLACEHOLDER, TypeFlags.HAS_INFER), TypeFlags.HAS_ALIAS),
        fold_Ty,
      )
    ) {
      this.recursion_depth += 1;
      if (this.recursion_depth > as_interner(this.ecx.cx()).ir_recursion_limit()) {
        return ControlFlowC.Break(
          Ok({
            $: "Maybe",
            _0: {
              cause: { $: "Overflow", suggest_increasing_limit: true, keep_constraints: false },
              opaque_types_jank: "AllGood",
              stalled_on_coroutines: "No",
            },
          }),
        );
      }
      const result = fold_Ty.super_visit_with(ty, this);
      this.recursion_depth -= 1;
      return result;
    } else {
      return ControlFlowC.CONTINUE;
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1473 visit_const
  visit_const(ct0: Const): ControlFlow<Result<Certainty, NoSolution>> {
    const ct1 = this.ecx.replace_bound_vars(ct0, this.universes, fold_Const);
    const normalized = this.ecx.structurally_normalize_const(this.param_env, ct1);
    if (normalized.$ !== "Ok") {
      return ControlFlowC.Break(Err(NoSolution));
    }
    const ct = normalized._0;

    const kind = ct.kind();
    if (kind.$ === "Placeholder") {
      if (PlaceholderConst.universe(kind._0) === UniverseIndexC.ROOT) {
        return ControlFlowC.Break(Ok(Certainty.Yes));
      } else {
        return ControlFlowC.CONTINUE;
      }
    } else if (kind.$ === "Infer") {
      return ControlFlowC.Break(Ok(Certainty.AMBIGUOUS));
    } else if (
      TypeVisitableExt.has_type_flags(
        ct,
        TypeFlags.union(TypeFlags.union(TypeFlags.HAS_PLACEHOLDER, TypeFlags.HAS_INFER), TypeFlags.HAS_ALIAS),
        fold_Const,
      )
    ) {
      // FIXME(mgca): we should also check the recursion limit here
      return fold_Const.super_visit_with(ct, this);
    } else {
      return ControlFlowC.CONTINUE;
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/mod.rs:1499 visit_region
  visit_region(r: Region): ControlFlow<Result<Certainty, NoSolution>> {
    const kind = this.ecx.eager_resolve_region(r).kind();
    switch (kind.$) {
      case "ReStatic":
      case "ReError":
      case "ReBound":
        return ControlFlowC.CONTINUE;
      case "RePlaceholder":
        if (PlaceholderRegion.universe(kind._0) === UniverseIndexC.ROOT) {
          return ControlFlowC.Break(Ok(Certainty.Yes));
        } else {
          return ControlFlowC.CONTINUE;
        }
      case "ReVar":
        return ControlFlowC.Break(Ok(Certainty.Yes));
      case "ReErased":
      case "ReEarlyParam":
      case "ReLateParam":
        return unreachable("internal error: entered unreachable code: unexpected region in param-env clause");
    }
  }

  // PORT: the provided `TypeVisitor` methods it does not override.
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

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** `NoSolution` (unit struct value). */
const NoSolution: NoSolution = Object.freeze({});

/** `.map_err(Into::into)` from `QueryResult` (`NoSolution`) into `QueryResultOrRerunNonErased`. */
function map_err_into(r: Result<CanonicalResponse, NoSolution>): QueryResultOrRerunNonErased {
  if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_NoSolution(r._0));
  return r;
}

/**
 * `cx.item_self_bounds(def_id).iter_instantiated(cx, args).map(Unnormalized::skip_norm_wip)` (and
 * `item_non_self_bounds`).
 * PORT: `Interner::item_*bounds` is declared `impl IntoIterator`; rustc_type_ir binder.ts's `iter_instantiated` takes
 * the slice its double-ended iterator needs, so the items are collected first. Instantiation is per element and pure:
 * the items are those of upstream's lazy iterator.
 */
function* iter_bounds(cx: TyCtxt, bounds: EarlyBinder<Iterable<Clause>>, args: readonly GenericArg[]): Generator<Clause> {
  for (const u of EarlyBinder.iter_instantiated<Clause>(EarlyBinder.map_bound(bounds, (it) => Array.from(it)), cx, args, fold_Clause)) {
    yield Unnormalized.skip_norm_wip(u);
  }
}


/** D4 descriptor of `Goal<I, G>` from the `GoalKind<G>` table (whose `TypeFoldable` supertrait is `G`'s). */
function fold_Goal<G>(G: GoalKind<G>): TypeFoldable<Goal<G>> {
  return {
    visit_with: (s, v) => visit_with_Goal(s, v, G.visit_with),
    try_fold_with: (s, f) => try_fold_with_Goal(s, f, G.try_fold_with),
    fold_with: (s, f) => fold_with_Goal(s, f, G.fold_with),
  };
}

/** PORT: stand-in for the derived `Debug` of `CandidateHeadUsages` (rustc_type_ir search_graph/mod.rs, not ported by
 * tyir-solve). */
function debug_CandidateHeadUsages(_v: CandidateHeadUsages, _f: Fmt): string {
  return unported("rustc_type_ir::search_graph::CandidateHeadUsages: Debug (search_graph/mod.rs, derived)");
}
