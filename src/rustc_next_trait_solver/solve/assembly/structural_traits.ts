//! Code which is used by built-in goals that match "structurally", such a auto
//! traits, `Copy`/`Clone`.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs (lane evalctxt-contract;
// the file belongs to lane nts-assembly). The types are final; the free fns and the methods of `ReplaceProjectionWith`
// are stubs with final signatures: fill each in place and add the `// rustc:` marker. Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `#[derive(TypeVisitable_Generic, TypeFoldable_Generic)]` on `AsyncCallableRelevantTypes` is codegen's
// (PORTING §5): `fold_AsyncCallableRelevantTypes` below is a stand-in until root adds the type to a tools/codegen set.
// PORT: `impl From<RerunNonErased> for AmbiguousOrRerunNonErased` is `AmbiguousOrRerunNonErased.from_RerunNonErased`
// (tyir-solve decision 7).
// PORT: `ReplaceProjectionWith::mapping: &HashMap<I::TraitAssocTermId, Vec<..>>` is keyed by `DefId`: a `DefIdMap`.
import type { DefIdMap } from "../../../rustc_span/def_id.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { BoundExistentialPredicates, Clauses, GenericArgs, ParamEnv, Predicate, Term, Ty } from "../../../rustc_middle/ty/decls.ts";
import { debug_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type {
  Binder,
  ClosureKind,
  CoroutineClosureArgs,
  FnSig,
  ProjectionClause,
  TraitRef,
} from "../../../rustc_type_ir/decls.ts";
import { type FallibleTypeFolder, FallibleTypeFolder_provided, type PredicateProxy, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { AliasTerm } from "../../../rustc_type_ir/ty/alias.ts";
import type { CoroutineClosureSignature } from "../../../rustc_type_ir/ty_kind/closure.ts";
import type { Goal, NoSolution, RerunNonErased, SizedTraitKind } from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { type Debug, debug_struct } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { EvalCtxt } from "../../decls.ts";

// Calculates the constituent types of a type for `auto trait` purposes.
export function instantiate_constituent_tys_for_auto_trait(_ecx: EvalCtxt, _ty: Ty): Result<Binder<Ty[]>, NoSolution> {
  return unported("rustc_next_trait_solver::solve::assembly::structural_traits::instantiate_constituent_tys_for_auto_trait");
}

export function instantiate_constituent_tys_for_sizedness_trait(
  _ecx: EvalCtxt,
  _sizedness: SizedTraitKind,
  _ty: Ty,
): Result<Binder<Ty[]>, NoSolution> {
  return unported(
    "rustc_next_trait_solver::solve::assembly::structural_traits::instantiate_constituent_tys_for_sizedness_trait",
  );
}

export function instantiate_constituent_tys_for_copy_clone_trait(_ecx: EvalCtxt, _ty: Ty): Result<Binder<Ty[]>, NoSolution> {
  return unported(
    "rustc_next_trait_solver::solve::assembly::structural_traits::instantiate_constituent_tys_for_copy_clone_trait",
  );
}

// Returns a binder of the tupled inputs types and output type from a builtin callable type.
export function extract_tupled_inputs_and_output_from_callable(
  _cx: TyCtxt,
  _self_ty: Ty,
  _goal_kind: ClosureKind,
): Result<Binder<[Ty, Ty]> | undefined, NoSolution> {
  return unported(
    "rustc_next_trait_solver::solve::assembly::structural_traits::extract_tupled_inputs_and_output_from_callable",
  );
}

/// Relevant types for an async callable, including its inputs, output,
/// and the return type you get from awaiting the output.
// PORT: `#[derive_where(Clone, Copy, Debug; I: Interner)]` plain struct (Copy of interned fields: no clone needed).
export interface AsyncCallableRelevantTypes {
  tupled_inputs_ty: Ty;
  /// Type returned by calling the closure
  /// i.e. `f()`.
  output_coroutine_ty: Ty;
  /// Type returned by `await`ing the output
  /// i.e. `f().await`.
  coroutine_return_ty: Ty;
}
export const debug_AsyncCallableRelevantTypes: Debug<AsyncCallableRelevantTypes> = (v, f) =>
  debug_struct(f, "AsyncCallableRelevantTypes", [
    ["tupled_inputs_ty", debug_Ty(v.tupled_inputs_ty, f)],
    ["output_coroutine_ty", debug_Ty(v.output_coroutine_ty, f)],
    ["coroutine_return_ty", debug_Ty(v.coroutine_return_ty, f)],
  ]);
/** PORT: stand-in for the codegen'd `TypeVisitable_Generic` / `TypeFoldable_Generic` derive (header). */
export const fold_AsyncCallableRelevantTypes: TypeFoldable<AsyncCallableRelevantTypes> = {
  visit_with<R>(): R {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::AsyncCallableRelevantTypes: TypeVisitable (derive, codegen)");
  },
  try_fold_with<E>(): Result<AsyncCallableRelevantTypes, E> {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::AsyncCallableRelevantTypes: TypeFoldable (derive, codegen)");
  },
  fold_with(): AsyncCallableRelevantTypes {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::AsyncCallableRelevantTypes: TypeFoldable (derive, codegen)");
  },
};

// Returns a binder of the tupled inputs types, output type, and coroutine type
// from a builtin coroutine-closure type. If we don't yet know the closure kind of
// the coroutine-closure, emit an additional trait predicate for `AsyncFnKindHelper`
// which enforces the closure is actually callable with the given trait. When we
// know the kind already, we can short-circuit this check.
export function extract_tupled_inputs_and_output_from_async_callable(
  _cx: TyCtxt,
  _self_ty: Ty,
  _goal_kind: ClosureKind,
  _env_region: Region,
): Result<[Binder<AsyncCallableRelevantTypes>, Predicate[]], NoSolution> {
  return unported(
    "rustc_next_trait_solver::solve::assembly::structural_traits::extract_tupled_inputs_and_output_from_async_callable",
  );
}

export function fn_item_to_async_callable(
  _cx: TyCtxt,
  _bound_sig: Binder<FnSig>,
): Result<[Binder<AsyncCallableRelevantTypes>, Predicate[]], NoSolution> {
  return unported("rustc_next_trait_solver::solve::assembly::structural_traits::fn_item_to_async_callable");
}

/// Given a coroutine-closure, project to its returned coroutine when we are *certain*
/// that the closure's kind is compatible with the goal.
export function coroutine_closure_to_certain_coroutine(
  _cx: TyCtxt,
  _goal_kind: ClosureKind,
  _goal_region: Region,
  _def_id: DefId,
  _args: CoroutineClosureArgs,
  _sig: CoroutineClosureSignature,
): Ty {
  return unported("rustc_next_trait_solver::solve::assembly::structural_traits::coroutine_closure_to_certain_coroutine");
}

/// Given a coroutine-closure, project to its returned coroutine when we are *not certain*
/// that the closure's kind is compatible with the goal, and therefore also don't know
/// yet what the closure's upvars are.
///
/// Note that we do not also push a `AsyncFnKindHelper` goal here.
export function coroutine_closure_to_ambiguous_coroutine(
  _cx: TyCtxt,
  _goal_kind: ClosureKind,
  _goal_region: Region,
  _def_id: DefId,
  _args: CoroutineClosureArgs,
  _sig: CoroutineClosureSignature,
): Ty {
  return unported(
    "rustc_next_trait_solver::solve::assembly::structural_traits::coroutine_closure_to_ambiguous_coroutine",
  );
}

/// This duplicates `extract_tupled_inputs_and_output_from_callable` but needs
/// to return different information (namely, the def id and args) so that we can
/// create const conditions.
///
/// Doing so on all calls to `extract_tupled_inputs_and_output_from_callable`
/// would be wasteful.
export function extract_fn_def_from_const_callable(
  _cx: TyCtxt,
  _self_ty: Ty,
): Result<[Binder<[Ty, Ty]>, DefId, GenericArgs], NoSolution> {
  return unported("rustc_next_trait_solver::solve::assembly::structural_traits::extract_fn_def_from_const_callable");
}

// NOTE: Keep this in sync with `evaluate_host_effect_for_destruct_goal` in
// the old solver, for as long as that exists.
export function const_conditions_for_destruct(_cx: TyCtxt, _self_ty: Ty): Result<TraitRef[], NoSolution> {
  return unported("rustc_next_trait_solver::solve::assembly::structural_traits::const_conditions_for_destruct");
}

/// Assemble a list of predicates that would be present on a theoretical
/// user impl for an object type. These predicates must be checked any time
/// we assemble a built-in object candidate for an object type, since they
/// are not implied by the well-formedness of the type.
///
/// For example, given the following traits:
///
/// ```rust,ignore (theoretical code)
/// trait Foo: Baz {
///     type Bar: Copy;
/// }
///
/// trait Baz {}
/// ```
///
/// For the dyn type `dyn Foo<Item = Ty>`, we can imagine there being a
/// pair of theoretical impls:
///
/// ```rust,ignore (theoretical code)
/// impl Foo for dyn Foo<Item = Ty>
/// where
///     Self: Baz,
///     <Self as Foo>::Bar: Copy,
/// {
///     type Bar = Ty;
/// }
///
/// impl Baz for dyn Foo<Item = Ty> {}
/// ```
///
/// However, in order to make such impls non-cyclical, we need to do an
/// additional step of eagerly folding the associated types in the where
/// clauses of the impl. In this example, that means replacing
/// `<Self as Foo>::Bar` with `Ty` in the first impl.
export function predicates_for_object_candidate(
  _ecx: EvalCtxt,
  _param_env: ParamEnv,
  _trait_ref: TraitRef,
  _object_bounds: BoundExistentialPredicates,
): Result<Goal<Predicate>[], AmbiguousOrRerunNonErased> {
  return unported("rustc_next_trait_solver::solve::assembly::structural_traits::predicates_for_object_candidate");
}

export class ReplaceProjectionWith implements FallibleTypeFolder<AmbiguousOrRerunNonErased> {
  constructor(
    public ecx: EvalCtxt,
    public param_env: ParamEnv,
    public self_ty: Ty,
    public mapping: DefIdMap<Binder<ProjectionClause>[]>,
    public nested: Goal<Predicate>[],
  ) {}

  projection_may_match(_source_projection: Binder<ProjectionClause>, _target_projection: AliasTerm): Result<boolean, RerunNonErased> {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::ReplaceProjectionWith::projection_may_match");
  }

  /// Try to replace an alias with the term present in the projection bounds of the self type.
  /// Returns `Ok<None>` if this alias is not eligible to be replaced, or bail with
  /// `Err(Ambiguous)` if it's uncertain which projection bound to replace the term with due
  /// to multiple bounds applying, or with `Err(RerunNonErased)` if we have to rerun the
  /// goal in original `TypingMode`.
  try_eagerly_replace_alias(_alias_term: AliasTerm): Result<Term | undefined, AmbiguousOrRerunNonErased> {
    return unported(
      "rustc_next_trait_solver::solve::assembly::structural_traits::ReplaceProjectionWith::try_eagerly_replace_alias",
    );
  }

  // ---- impl FallibleTypeFolder for ReplaceProjectionWith ----
  cx(): TyCtxt {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::ReplaceProjectionWith::cx");
  }

  try_fold_ty(_ty: Ty): Result<Ty, AmbiguousOrRerunNonErased> {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::ReplaceProjectionWith::try_fold_ty");
  }

  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }

  try_fold_region(r: Region): Result<Region, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }

  try_fold_const(c: Const): Result<Const, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_const(this, c);
  }

  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }

  try_fold_clauses(c: Clauses): Result<Clauses, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

// PORT: no derives upstream (no Debug); the companion holds the `From` impl (header).
export type AmbiguousOrRerunNonErased =
  /// Marker for bailing with ambiguity.
  | { readonly $: "Ambiguous" }
  | { readonly $: "RerunNonErased"; readonly _0: RerunNonErased };
export const AmbiguousOrRerunNonErased = {
  Ambiguous: Object.freeze({ $: "Ambiguous" }) as AmbiguousOrRerunNonErased,

  from_RerunNonErased(_rerun: RerunNonErased): AmbiguousOrRerunNonErased {
    return unported(
      "rustc_next_trait_solver::solve::assembly::structural_traits::AmbiguousOrRerunNonErased::from",
    );
  },
} as const;
