//! Code for projecting associated types out of trait references.
//
// Port of compiler/rustc_trait_selection/src/traits/project.rs (lane old-project, wave 18b).
//
// Contract stub (lane selcx-contract). The types are generated (./project.gen.ts, set
// `rustc_trait_selection_old_solver`). Every fn of the file is either
//   - a signature-typed stub below (`pub` / `pub(super)` / `pub(crate)` fns and the methods other files call): replace
//     the body with the port and put the `// rustc: compiler/rustc_trait_selection/src/traits/project.rs:<line> <name>`
//     marker directly above it (do not change the signature; a wrong one goes in your handoff), or
//   - a private fn listed in the comment block at the end: port it as a module-local `function` in upstream order.
// `bun scripts/coverage.ts --missing compiler/rustc_trait_selection/src/traits/project.rs` lists what is left.
//
// PORT (representation):
// - `selcx: &mut SelectionContext` is the `SelectionContext` object (traits/select/mod.ts).
// - `obligations: &mut PredicateObligations` is the array, pushed to in place.
// - `ProjectionCandidateSet` is a `$`-tagged union and its methods assign `*self`: they take `self: MutRef<..>`, and the
//   `assemble_candidates_*` fns take `candidate_set: MutRef<ProjectionCandidateSet>`.
// - `Result<Option<Term>, InProgress>` is `Result<Term | undefined, InProgress>`.
// - `trait ProjectionCacheKeyExt` (one impl, for `ProjectionCacheKey`) is the free fn
//   `ProjectionCacheKey_from_poly_projection_obligation`.
//
// Init order: top-level code here touches only ./project.gen.ts and other crates.

import type { PredicateObligation, PredicateObligations, Selection } from "../../rustc_infer/traits/mod.ts";
import type { ProjectionCacheKey } from "../../rustc_infer/traits/project.ts";
import type { ImplSourceUserDefinedData, ObligationCause, SelectionError } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArgs, ParamEnv, Term } from "../../rustc_middle/ty/decls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { AliasTerm } from "../../rustc_type_ir/ty/alias.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type {
  InProgress,
  PolyProjectionObligation,
  ProjectAndUnifyResult,
  ProjectionCandidate,
  ProjectionCandidateSet as ProjectionCandidateSetT,
  Progress as ProgressT,
} from "./project.gen.ts";
import { Progress } from "./project.gen.ts";
import type { SelectionContext } from "./select/mod.ts";

export * from "./project.gen.ts";

function stub(name: string): never {
  return unported(`rustc_trait_selection::traits::project::${name}`);
}

// ---- impl<'tcx> ProjectionCandidateSet<'tcx> (project.rs:73) --------------------------------------------------------

export type ProjectionCandidateSet = ProjectionCandidateSetT;
export const ProjectionCandidateSet = {
  None: Object.freeze({ $: "None" as const }),
  Ambiguous: Object.freeze({ $: "Ambiguous" as const }),
  // project.rs:74 (stub)
  mark_ambiguous(_self: MutRef<ProjectionCandidateSet>): void {
    stub("ProjectionCandidateSet::mark_ambiguous");
  },
  // project.rs:78 (stub)
  mark_error(_self: MutRef<ProjectionCandidateSet>, _err: SelectionError): void {
    stub("ProjectionCandidateSet::mark_error");
  },
  // project.rs:85 (stub)
  push_candidate(_self: MutRef<ProjectionCandidateSet>, _candidate: ProjectionCandidate): boolean {
    return stub("ProjectionCandidateSet::push_candidate");
  },
};

/// Evaluates constraints of the form:
/// ```ignore (not-rust)
/// for<...> <T as Trait>::U == V
/// ```
/// If successful, this may result in additional obligations. Also returns
/// the projection cache key used to track these additional obligations.
// project.rs:174 (stub)
export function poly_project_and_unify_term(_selcx: SelectionContext, _obligation: PolyProjectionObligation): ProjectAndUnifyResult {
  return stub("poly_project_and_unify_term");
}

/// The guts of `normalize`: normalize a specific projection like `<T
/// as Trait>::Item`. The result is always a type (and possibly
/// additional obligations). If ambiguity arises, which implies that
/// there are unresolved type variables in the projection, we will
/// instantiate it with a fresh type variable `$X` and generate a new
/// obligation `<T as Trait>::Item == $X` for later.
// project.rs:261 (stub)
export function normalize_projection_term(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _alias_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): Term {
  return stub("normalize_projection_term");
}

/// The guts of `normalize`: normalize a specific projection like `<T
/// as Trait>::Item`. The result is always a type (and possibly
/// additional obligations). Returns `None` in the case of ambiguity,
/// which indicates that there are unbound type variables.
///
/// This function used to return `Option<NormalizedTy<'tcx>>`, which contains a
/// `Ty<'tcx>` and an obligations vector. But that obligation vector was very
/// often immediately appended to another obligations vector. So now this
/// function takes an obligations vector and appends to it directly, which is
/// slightly uglier but avoids the need for an extra short-lived allocation.
// project.rs:299 (stub)
export function opt_normalize_projection_term(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _projection_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): Result<Term | undefined, InProgress> {
  return stub("opt_normalize_projection_term");
}

// project.rs:508 (stub)
export function const_of_item_or_delayed_bug(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Const> {
  return stub("const_of_item_or_delayed_bug");
}

/// Confirm and normalize the given inherent projection.
// project.rs:524 (stub)
export function normalize_inherent_projection(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _alias_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): Term {
  return stub("normalize_inherent_projection");
}

// project.rs:603 (stub)
export function compute_inherent_assoc_term_args(
  _selcx: SelectionContext,
  _param_env: ParamEnv,
  _alias_term: AliasTerm,
  _cause: ObligationCause,
  _depth: number,
  _obligations: PredicateObligations,
): GenericArgs {
  return stub("compute_inherent_assoc_term_args");
}

// ---- impl<'tcx> Progress<'tcx> (project.rs:662) -------------------------------------------------------------------

declare module "./project.gen.ts" {
  interface Progress {
    // project.rs:679 (consumes `self`)
    with_addl_obligations(obligations: PredicateObligations): Progress;
  }
  namespace Progress {
    // project.rs:663
    export let error_for_term: (tcx: TyCtxt, alias_term: AliasTerm, guar: ErrorGuaranteed) => ProgressT;
  }
}

Object.assign(Progress, {
  // project.rs:663 (stub)
  error_for_term(_tcx: TyCtxt, _alias_term: AliasTerm, _guar: ErrorGuaranteed): ProgressT {
    return stub("Progress::error_for_term");
  },
});
Progress.prototype.with_addl_obligations = function (this: ProgressT, _obligations: PredicateObligations): ProgressT {
  return stub("Progress::with_addl_obligations");
};

// ---- pub(crate) trait ProjectionCacheKeyExt (project.rs:2202), impl for ProjectionCacheKey (project.rs:2209) ------------

// project.rs:2210 (stub; `ProjectionCacheKey::from_poly_projection_obligation`)
export function ProjectionCacheKey_from_poly_projection_obligation(
  _selcx: SelectionContext,
  _obligation: PolyProjectionObligation,
): ProjectionCacheKey | undefined {
  return stub("ProjectionCacheKeyExt::from_poly_projection_obligation");
}

// ---- private fns (port as module-local functions, upstream order) ---------------------------------------------------
// project.rs:204 project_and_unify_term(selcx, obligation: &ProjectionObligation) -> ProjectAndUnifyResult
// project.rs:462 normalize_to_error(selcx, param_env, projection_term, cause, depth) -> NormalizedTerm
// project.rs:483 push_const_arg_has_type_obligation(tcx, obligations, cause, depth, param_env, term, def_id, args)
// project.rs:691 project(selcx, obligation: &ProjectionTermObligation) -> Result<Projected, ProjectionError>
// project.rs:791 assemble_candidates_from_param_env(selcx, obligation, candidate_set: MutRef<ProjectionCandidateSet>)
// project.rs:816 assemble_candidates_from_trait_def(selcx, obligation, candidate_set)
// project.rs:874 assemble_candidates_from_object_ty(selcx, obligation, candidate_set)
// project.rs:920 assemble_candidates_from_clauses(selcx, obligation, candidate_set, ctor, env_clauses, potentially_unnormalized_candidates)
// project.rs:975 assemble_candidates_from_impls(selcx, obligation, candidate_set)
// project.rs:1301 confirm_candidate(selcx, obligation, candidate: ProjectionCandidate) -> Result<Projected, ProjectionError>
// project.rs:1335 confirm_select_candidate(selcx, obligation, impl_source: Selection) -> Result<Projected, ProjectionError>
// project.rs:1383 confirm_coroutine_candidate / :1439 confirm_future_candidate / :1486 confirm_iterator_candidate /
//   :1531 confirm_async_iterator_candidate / :1584 confirm_builtin_candidate / :1667 confirm_fn_pointer_candidate /
//   :1688 confirm_closure_candidate / :1769 confirm_async_closure_candidate / :1948 confirm_async_fn_kind_helper_candidate
//   (selcx, obligation, nested: PredicateObligations) -> Progress
// project.rs:1736 confirm_callable_candidate(selcx, obligation, fn_sig: PolyFnSig, flag: TupleArgumentsFlag) -> Progress
// project.rs:1884 coroutine_closure_output_coroutine(tcx, obligation, goal_kind, env_region, def_id, args) -> Ty
// project.rs:1984 confirm_param_env_candidate(selcx, obligation, poly_cache_entry, potentially_unnormalized_candidate) -> Progress
// project.rs:2052 confirm_impl_candidate(selcx, obligation, impl_impl_source: ImplSourceUserDefinedData<PredicateObligation>)
//   -> Result<Projected, ProjectionError>
// project.rs:2160 assoc_term_own_obligations(selcx, obligation, nested: PredicateObligations)

/** PORT: names the comment block above refers to (type positions only). */
export type ProjectPrivateFnTypes = [PredicateObligation, Selection, ImplSourceUserDefinedData<PredicateObligation>];
