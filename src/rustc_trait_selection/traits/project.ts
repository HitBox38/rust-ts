//! Code for projecting associated types out of trait references.
//
// Port of compiler/rustc_trait_selection/src/traits/project.rs (lane old-project, wave 18c; contract stub by lane
// selcx-contract). The types are generated (./project.gen.ts, set `rustc_trait_selection_old_solver`).
//
// PORT (representation):
// - `selcx: &mut SelectionContext` is the `SelectionContext` object (traits/select/mod.ts).
// - `obligations: &mut PredicateObligations` is the array, pushed to in place.
// - `ProjectionCandidateSet` is a `$`-tagged union and its methods assign `*self`: they take `self: MutRef<..>`, and the
//   `assemble_candidates_*` fns take `candidate_set: MutRef<ProjectionCandidateSet>`.
// - `Result<Option<Term>, InProgress>` is `Result<Term | undefined, InProgress>`.
// - `trait ProjectionCacheKeyExt` (one impl, for `ProjectionCacheKey`) is the free fn
//   `ProjectionCacheKey_from_poly_projection_obligation`.
// - `debug!` / `#[instrument]` are dropped (no tracing in the port).
// - `infcx.probe(|_| ..)` / `commit_if_ok(|_| ..)` take a closure that ignores the snapshot argument; a closure's
//   `Result<(), ()>` is `Result<null, null>`.
// - `.into()` of a `Ty` / `Const` to `Term` is `Term.from_Ty` / `Term.from_Const`; to `GenericArg` `GenericArg.from_*`.
//
// Init order: top-level code here touches only ./project.gen.ts and other crates; this crate's other modules
// (normalize.ts, util.ts, specialize/**) are read inside function bodies only.

import { intern_key } from "../../rust_ts/intern_key.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { ToTrace_AliasTerm, ToTrace_Term, ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { DefineOpaqueTypes } from "../../rustc_infer/infer/at.gen.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.gen.ts";
import type { InferOk } from "../../rustc_infer/infer/mod.ts";
import { debug_Obligation, Obligation, type PredicateObligation, type PredicateObligations, type Selection } from "../../rustc_infer/traits/mod.ts";
import { clone_Normalized, type MismatchedProjectionTypes, Normalized, type NormalizedTerm, ProjectionCacheKey } from "../../rustc_infer/traits/project.ts";
import { Defaultness } from "../../rustc_hir/hir.ts";
import { OverflowError } from "../../rustc_middle/traits/select.gen.ts";
import {
  clone_ObligationCause,
  debug_ImplSource,
  type ImplSourceUserDefinedData,
  ObligationCause,
  type SelectionError,
} from "../../rustc_middle/traits/mod.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, GenericArgs, ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { fold_Term, Term, Ty } from "../../rustc_middle/ty/mod.ts";
import {
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_ClauseKind,
  Predicate_upcast_from_PolyTraitRef,
  Predicate_upcast_from_TraitRef,
  Clause_upcast_from_PolyProjectionClause,
  debug_Predicate,
  type PolyProjectionClause,
} from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, debug_DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Span } from "../../rustc_span/span_encoding.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { into_MultiSpan } from "../../rustc_error_messages/lib.ts";
import { Binder, debug_Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { debug_TypeError } from "../../rustc_type_ir/error.gen.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { CantBeErased, TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { debug_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { ClosureKind } from "../../rustc_type_ir/lib.ts";
import {
  as_interner,
  debug_ProjectionClause,
  fold_with_ProjectionClause,
  fold_with_TraitRef,
  PolyExistentialProjection,
  PolyProjectionClause as PolyProjectionClauseC,
  type ProjectionClause,
  TraitClause,
  TraitRef,
  try_fold_with_ProjectionClause,
  try_fold_with_TraitRef,
  visit_with_ProjectionClause,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { AliasTerm as AliasTermC, AliasTermKind, debug_AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import { type AliasTerm, debug_AliasTerm, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../rustc_type_ir/ty/alias.ts";
import { FnSig, type FnSig as FnSigT, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { fold_with_GenSig, type GenSig, try_fold_with_GenSig, visit_with_GenSig } from "../../rustc_type_ir/ty_kind/closure.gen.ts";
import { ClosureArgs, type CoroutineClosureArgs, CoroutineClosureArgs as CoroutineClosureArgsC, CoroutineArgs, CoroutineClosureSignature } from "../../rustc_type_ir/ty_kind/closure.ts";
import { fold_with_Unnormalized, try_fold_with_Unnormalized, Unnormalized, visit_with_Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert_eq, panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type {
  InProgress,
  PolyProjectionObligation,
  ProjectAndUnifyResult,
  ProjectionCandidate,
  ProjectionCandidateSet as ProjectionCandidateSetT,
  ProjectionError,
  ProjectionObligation,
  ProjectionTermObligation,
  Projected,
  Progress as ProgressT,
} from "./project.gen.ts";
import { ProjectAndUnifyResult as ProjectAndUnifyResultC, ProjectionError as ProjectionErrorC, Progress } from "./project.gen.ts";
import type { SelectionContext } from "./select/mod.ts";
import type { ProjectionMatchesProjection } from "./select/mod.ts";
import type { TupleArgumentsFlag } from "./util.gen.ts";
import { report_dyn_incompatibility } from "../error_reporting/traits/mod.ts";

export * from "./project.gen.ts";

// ---- PORT: D4 descriptors / upcasts this file uses -----------------------------------------------------------------

/** The derived `TypeFoldable` of `AliasTerm` (`Alias<AliasTermKind>`). */
const d_AliasTerm: TypeFoldable<AliasTerm> = {
  visit_with: (v, visitor) => visit_with_Alias(v, visitor, visit_with_AliasTermKind),
  try_fold_with: (v, folder) => try_fold_with_Alias(v, folder, try_fold_with_AliasTermKind),
  fold_with: (v, folder) => fold_with_Alias(v, folder, fold_with_AliasTermKind),
};
/** The derived `TypeFoldable` of `ProjectionClause`. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};
/** The derived `TypeFoldable` of `TraitRef`. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
/** `impl TypeFoldable for Unnormalized<T>` at a given `T`. */
function d_Unnormalized<T>(d: TypeFoldable<T>): TypeFoldable<Unnormalized<T>> {
  return {
    visit_with: (v, visitor) => visit_with_Unnormalized(v, visitor, d.visit_with),
    try_fold_with: (v, folder) => try_fold_with_Unnormalized(v, folder, d.try_fold_with),
    fold_with: (v, folder) => fold_with_Unnormalized(v, folder, d.fold_with),
  };
}
const d_Unnormalized_Term: TypeFoldable<Unnormalized<Term>> = d_Unnormalized(fold_Term);
/** The derived `TypeFoldable` of `GenSig` (rustc_type_ir ty_kind/closure.rs). */
const d_GenSig: TypeFoldable<GenSig> = { visit_with: visit_with_GenSig, try_fold_with: try_fold_with_GenSig, fold_with: fold_with_GenSig };
type Region = import("../../rustc_middle/ty/decls.ts").Region;
/** `impl UpcastFrom<TyCtxt, X> for Predicate` at `Obligation::with`'s `Interner` type. */
const upcast_Clause = Predicate_upcast_from_Clause as unknown as (from: Clause, tcx: Interner) => Predicate;
const upcast_ClauseKind = Predicate_upcast_from_ClauseKind as unknown as (from: Parameters<typeof Predicate_upcast_from_ClauseKind>[0], tcx: Interner) => Predicate;
const upcast_TraitRef = Predicate_upcast_from_TraitRef as unknown as (from: TraitRef, tcx: Interner) => Predicate;

/** The crate's `normalize` module (read lazily: init order). */
function normalize_mod(): typeof import("./normalize.ts") {
  return require("./normalize.ts") as typeof import("./normalize.ts");
}

/// PORT: `#[derive(PartialEq)]` of `ProjectionCandidate`. The clause variants compare their `Binder` by value; `Select`
/// compares the `ImplSource`, whose nested `Obligation`s compare by `param_env` and `predicate` only (rustc_infer's
/// manual `PartialEq for Obligation` ignores `cause` and `recursion_depth`).
function ProjectionCandidate_eq(a: ProjectionCandidate, b: ProjectionCandidate): boolean {
  return ProjectionCandidate_key(a) === ProjectionCandidate_key(b);
}
function ProjectionCandidate_key(c: ProjectionCandidate): string {
  switch (c.$) {
    case "ParamEnv":
    case "TraitDef":
    case "Object":
      return intern_key({ $: c.$, _0: c._0 });
    case "Select": {
      const nested_key = (n: PredicateObligation[]): [ParamEnv, Predicate][] => n.map((o) => [o.param_env, o.predicate]);
      const s = c._0;
      switch (s.$) {
        case "UserDefined":
          return intern_key({ $: "Select", _0: { $: s.$, _0: { impl_def_id: s._0.impl_def_id, args: s._0.args, nested: nested_key(s._0.nested) } } });
        case "Param":
          return intern_key({ $: "Select", _0: { $: s.$, _0: nested_key(s._0) } });
        case "Builtin":
          return intern_key({ $: "Select", _0: { $: s.$, _0: s._0, _1: nested_key(s._1) } });
      }
    }
  }
}

/** `{:?}` of a `Selection` (`ImplSource<PredicateObligation>`). */
function debug_Selection(impl_source: Selection): string {
  return debug_ImplSource(impl_source, PLAIN, (o, f) => debug_Obligation(o, f, debug_Predicate));
}

// ---- impl<'tcx> ProjectionCandidateSet<'tcx> (project.rs:73) --------------------------------------------------------

export type ProjectionCandidateSet = ProjectionCandidateSetT;
export const ProjectionCandidateSet = {
  None: Object.freeze({ $: "None" as const }),
  Ambiguous: Object.freeze({ $: "Ambiguous" as const }),

  // rustc: compiler/rustc_trait_selection/src/traits/project.rs:74 mark_ambiguous
  mark_ambiguous(self: MutRef<ProjectionCandidateSet>): void {
    self.value = ProjectionCandidateSet.Ambiguous;
  },

  // rustc: compiler/rustc_trait_selection/src/traits/project.rs:78 mark_error
  mark_error(self: MutRef<ProjectionCandidateSet>, err: SelectionError): void {
    self.value = { $: "Error", _0: err };
  },

  // Returns true if the push was successful, or false if the candidate
  // was discarded -- this could be because of ambiguity, or because
  // a higher-priority candidate is already there.
  // rustc: compiler/rustc_trait_selection/src/traits/project.rs:85 push_candidate
  push_candidate(self: MutRef<ProjectionCandidateSet>, candidate: ProjectionCandidate): boolean {
    // This wacky variable is just used to try and
    // make code readable and avoid confusing paths.
    // It is assigned a "value" of `()` only on those
    // paths in which we wish to convert `*self` to
    // ambiguous (and return false, because the candidate
    // was not used). On other paths, it is not assigned,
    // and hence if those paths *could* reach the code that
    // comes after the match, this fn would not compile.
    // PORT: `let convert_to_ambiguous;` is implicit: every path that falls through assigns it.

    const s = self.value;
    switch (s.$) {
      case "None": {
        self.value = { $: "Single", _0: candidate };
        return true;
      }

      case "Single": {
        const current = s._0;
        // Duplicates can happen inside ParamEnv. In the case, we
        // perform a lazy deduplication.
        if (ProjectionCandidate_eq(current, candidate)) {
          return false;
        }

        // Prefer where-clauses. As in select, if there are multiple
        // candidates, we prefer where-clause candidates over impls. This
        // may seem a bit surprising, since impls are the source of
        // "truth" in some sense, but in fact some of the impls that SEEM
        // applicable are not, because of nested obligations. Where
        // clauses are the safer choice. See the comment on
        // `select::SelectionCandidate` and #21974 for more details.
        if (current.$ === "ParamEnv" && candidate.$ === "ParamEnv") {
          // convert_to_ambiguous = ()
        } else if (current.$ === "ParamEnv") {
          return false;
        } else if (candidate.$ === "ParamEnv") {
          return bug("should never prefer non-param-env candidates over param-env candidates");
        } else {
          // convert_to_ambiguous = ()
        }
        break;
      }

      case "Ambiguous":
      case "Error": {
        return false;
      }
    }

    // We only ever get here when we moved from a single candidate
    // to ambiguous.
    // let () = convert_to_ambiguous;
    self.value = ProjectionCandidateSet.Ambiguous;
    return false;
  },
};

/// Evaluates constraints of the form:
/// ```ignore (not-rust)
/// for<...> <T as Trait>::U == V
/// ```
/// If successful, this may result in additional obligations. Also returns
/// the projection cache key used to track these additional obligations.
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// #[instrument(level = "debug", skip(selcx))]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:174 poly_project_and_unify_term
export function poly_project_and_unify_term(selcx: SelectionContext, obligation: PolyProjectionObligation): ProjectAndUnifyResult {
  const infcx = selcx.infcx;
  const r = infcx.commit_if_ok<ProjectAndUnifyResult, MismatchedProjectionTypes>((_snapshot) => {
    const placeholder_predicate = infcx.enter_forall_and_leak_universe(obligation.predicate, d_ProjectionClause);

    const placeholder_obligation: ProjectionObligation = obligation.with(infcx.tcx, placeholder_predicate, upcast_from_self);
    const r = project_and_unify_term(selcx, placeholder_obligation);
    switch (r.$) {
      case "MismatchedProjectionTypes":
        return Err(r._0);
      default:
        return Ok(r);
    }
  });

  switch (r.$) {
    case "Ok":
      return r._0;
    case "Err":
      return { $: "MismatchedProjectionTypes", _0: r._0 };
  }
}

/// Evaluates constraints of the form:
/// ```ignore (not-rust)
/// <T as Trait>::U == V
/// ```
/// If successful, this may result in additional obligations.
///
/// See [poly_project_and_unify_term] for an explanation of the return value.
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// #[instrument(level = "debug", skip(selcx))]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:204 project_and_unify_term
function project_and_unify_term(selcx: SelectionContext, obligation: ProjectionObligation): ProjectAndUnifyResult {
  const obligations: PredicateObligations = [];

  const infcx = selcx.infcx;
  const r = opt_normalize_projection_term(
    selcx,
    obligation.param_env,
    obligation.predicate.projection_term,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth,
    obligations,
  );
  let normalized: Term;
  if (r.$ === "Ok") {
    if (r._0 !== undefined) {
      normalized = r._0;
    } else {
      return ProjectAndUnifyResultC.FailedNormalization;
    }
  } else {
    return ProjectAndUnifyResultC.Recursive;
  }
  // debug!(?normalized, ?obligations, "project_and_unify_type result");
  const actual_ = obligation.predicate.term;
  // For an example where this is necessary see tests/ui/impl-trait/nested-return-type2.rs
  // This allows users to omit re-mentioning all bounds on an associated type and just use an
  // `impl Trait` for the assoc type to add more bounds.
  const { value: actual, obligations: new_ } = selcx.infcx.replace_opaque_types_with_inference_vars(
    actual_,
    obligation.cause.body_def_id,
    obligation.cause.span,
    obligation.param_env,
    fold_Term,
  );
  obligations.push(...new_);

  // Need to define opaque types to support nested opaque types like `impl Fn() -> impl Trait`
  const eq = infcx.at(obligation.cause, obligation.param_env).eq(DefineOpaqueTypes.Yes, normalized, actual, ToTrace_Term);
  switch (eq.$) {
    case "Ok": {
      const inferred_obligations = (eq._0 as InferOk<null>).obligations;
      obligations.push(...inferred_obligations);
      return { $: "Holds", _0: obligations };
    }
    case "Err": {
      const err = eq._0;
      // debug!("equating types encountered error {:?}", err);
      return { $: "MismatchedProjectionTypes", _0: { err } };
    }
  }
}

/// The guts of `normalize`: normalize a specific projection like `<T
/// as Trait>::Item`. The result is always a type (and possibly
/// additional obligations). If ambiguity arises, which implies that
/// there are unresolved type variables in the projection, we will
/// instantiate it with a fresh type variable `$X` and generate a new
/// obligation `<T as Trait>::Item == $X` for later.
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:261 normalize_projection_term
export function normalize_projection_term(
  selcx: SelectionContext,
  param_env: ParamEnv,
  alias_term: AliasTerm,
  cause: ObligationCause,
  depth: number,
  obligations: PredicateObligations,
): Term {
  const r = opt_normalize_projection_term(selcx, param_env, alias_term, clone_ObligationCause(cause), depth, obligations);
  const t = r.$ === "Ok" ? r._0 : undefined;
  if (t !== undefined) return t;
  // if we bottom out in ambiguity, create a type variable
  // and a deferred predicate to resolve this when more type
  // information is available.

  return selcx.infcx.projection_term_to_infer(param_env, alias_term, cause, depth + 1, obligations);
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
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// #[instrument(level = "debug", skip(selcx, param_env, cause, obligations))]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:299 opt_normalize_projection_term
export function opt_normalize_projection_term(
  selcx: SelectionContext,
  param_env: ParamEnv,
  projection_term_: AliasTerm,
  cause: ObligationCause,
  depth: number,
  obligations: PredicateObligations,
): Result<Term | undefined, InProgress> {
  const infcx = selcx.infcx;
  // debug_assert!(!selcx.infcx.next_trait_solver());
  const projection_term = infcx.deeply_resolve_ignoring_regions(projection_term_, d_AliasTerm);
  const cache_key = ProjectionCacheKey.new(projection_term, param_env);

  // FIXME(#20304) For now, I am caching here, which is good, but it
  // means we don't capture the type variables that are created in
  // the case of ambiguity. Which means we may create a large stream
  // of such variables. OTOH, if we move the caching up a level, we
  // would not benefit from caching when proving `T: Trait<U=Foo>`
  // bounds. It might be the case that we want two distinct caches,
  // or else another kind of cache entry.
  const cache_entry = infcx.inner.projection_cache().try_start(cache_key);
  if (cache_entry.$ === "Ok") {
    // debug!("no cache")
  } else {
    const e = cache_entry._0;
    switch (e.$) {
      case "Ambiguous": {
        // If we found ambiguity the last time, that means we will continue
        // to do so until some type in the key changes (and we know it
        // hasn't, because we just fully resolved it).
        // debug!("found cache entry: ambiguous");
        return Ok(undefined);
      }
      case "InProgress": {
        // Under lazy normalization, this can arise when
        // bootstrapping. That is, imagine an environment with a
        // where-clause like `A::B == u32`. Now, if we are asked
        // to normalize `A::B`, we will want to check the
        // where-clauses in scope. So we will try to unify `A::B`
        // with `A::B`, which can trigger a recursive
        // normalization.

        // debug!("found cache entry: in-progress");

        // Cache that normalizing this projection resulted in a cycle. This
        // should ensure that, unless this happens within a snapshot that's
        // rolled back, fulfillment or evaluation will notice the cycle.
        infcx.inner.projection_cache().recur(cache_key);
        return Err({});
      }
      case "Recur": {
        // debug!("recur cache");
        return Err({});
      }
      case "NormalizedTerm": {
        const ty = e.ty;
        // This is the hottest path in this function.
        //
        // If we find the value in the cache, then return it along
        // with the obligations that went along with it. Note
        // that, when using a fulfillment context, these
        // obligations could in principle be ignored: they have
        // already been registered when the cache entry was
        // created (and hence the new ones will quickly be
        // discarded as duplicated). But when doing trait
        // evaluation this is not the case, and dropping the trait
        // evaluations can causes ICEs (e.g., #43132).
        // debug!(?ty, "found normalized ty");
        obligations.push(...ty.obligations);
        return Ok(ty.value);
      }
      case "Error": {
        // debug!("opt_normalize_projection_type: found error");
        const result = normalize_to_error(selcx, param_env, projection_term, cause, depth);
        obligations.push(...result.obligations);
        return Ok(result.value);
      }
    }
  }

  const obligation: ProjectionTermObligation = Obligation.with_depth(selcx.tcx(), clone_ObligationCause(cause), depth, param_env, projection_term, upcast_from_self);

  const r = project(selcx, obligation);
  if (r.$ === "Ok" && r._0.$ === "Progress") {
    const { term: projected_term_, obligations: projected_obligations } = r._0._0;
    // debug!("opt_normalize_projection_type: progress");
    // if projection succeeded, then what we get out of this
    // is also non-normalized (consider: it was derived from
    // an impl, where-clause etc) and hence we must
    // re-normalize it

    const projected_term = selcx.infcx.deeply_resolve_ignoring_regions(projected_term_, d_Unnormalized_Term);

    let result: NormalizedTerm;
    if (TypeVisitableExt.has_aliases(projected_term, d_Unnormalized_Term)) {
      const normalized_ty = normalize_mod().normalize_with_depth_to(selcx, param_env, cause, depth + 1, projected_term, projected_obligations, fold_Term);

      result = new Normalized(normalized_ty, projected_obligations);
    } else {
      result = new Normalized(Unnormalized.skip_normalization(projected_term), projected_obligations);
    }

    // PORT: `SsoHashSet<PredicateObligation>`: an obligation hashes / compares by `param_env` and `predicate` only.
    const deduped = new Set<string>();
    result.obligations = result.obligations.filter((obligation) => {
      const key = intern_key([obligation.param_env, obligation.predicate]);
      if (deduped.has(key)) return false;
      deduped.add(key);
      return true;
    });

    infcx.inner.projection_cache().insert_term(cache_key, clone_Normalized(result, (t) => t));
    obligations.push(...result.obligations);
    return Ok(result.value);
  } else if (r.$ === "Ok" && r._0.$ === "NoProgress") {
    const projected_ty = r._0._0;
    // debug!("opt_normalize_projection_type: no progress");
    const result = new Normalized(projected_ty, []);
    infcx.inner.projection_cache().insert_term(cache_key, clone_Normalized(result, (t) => t));
    // No need to extend `obligations`.
    return Ok(result.value);
  } else if (r.$ === "Err" && r._0.$ === "TooManyCandidates") {
    // debug!("opt_normalize_projection_type: too many candidates");
    infcx.inner.projection_cache().ambiguous(cache_key);
    return Ok(undefined);
  } else {
    // Err(ProjectionError::TraitSelectionError(_))
    // debug!("opt_normalize_projection_type: ERROR");
    // if we got an error processing the `T as Trait` part,
    // just return `ty::err` but add the obligation `T :
    // Trait`, which when processed will cause the error to be
    // reported later
    infcx.inner.projection_cache().error(cache_key);
    const result = normalize_to_error(selcx, param_env, projection_term, cause, depth);
    obligations.push(...result.obligations);
    return Ok(result.value);
  }
}

/// If we are projecting `<T as Trait>::Item`, but `T: Trait` does not
/// hold. In various error cases, we cannot generate a valid
/// normalized projection. Therefore, we create an inference variable
/// return an associated obligation that, when fulfilled, will lead to
/// an error.
///
/// Note that we used to return `Error` here, but that was quite
/// dubious -- the premise was that an error would *eventually* be
/// reported, when the obligation was processed. But in general once
/// you see an `Error` you are supposed to be able to assume that an
/// error *has been* reported, so that you can take whatever heuristic
/// paths you want to take. To make things worse, it was possible for
/// cycles to arise, where you basically had a setup like `<MyType<$0>
/// as Trait>::Foo == $0`. Here, normalizing `<MyType<$0> as
/// Trait>::Foo>` to `[type error]` would lead to an obligation of
/// `<MyType<[type error]> as Trait>::Foo`. We are supposed to report
/// an error for this obligation, but we legitimately should not,
/// because it contains `[type error]`. Yuck! (See issue #29857 for
/// one case where this arose.)
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:462 normalize_to_error
function normalize_to_error(selcx: SelectionContext, param_env: ParamEnv, projection_term: AliasTerm, cause: ObligationCause, depth: number): NormalizedTerm {
  const trait_ref = Binder.dummy(AliasTermC.trait_ref(projection_term, as_interner(selcx.tcx())), d_TraitRef);
  const new_value = selcx.infcx.next_term_var_of_alias_kind(projection_term, cause.span);
  const obligations: PredicateObligations = [];
  obligations.push(new Obligation(cause, param_env, Predicate_upcast_from_PolyTraitRef(trait_ref, selcx.tcx()), depth));
  return new Normalized(new_value, obligations);
}

/// When normalizing a const alias, register a `ConstArgHasType` obligation
/// to ensure the const value's type matches the declared type.
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:483 push_const_arg_has_type_obligation
function push_const_arg_has_type_obligation(
  tcx: TyCtxt,
  obligations: PredicateObligations,
  cause: ObligationCause,
  depth: number,
  param_env: ParamEnv,
  term: Term,
  def_id: DefId,
  args: GenericArgs,
): void {
  const ct = Term.as_const(term);
  if (ct !== undefined) {
    // PORT: the `type_of` query value is typed `unknown` in queries.gen.ts.
    const expected_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty));
    obligations.push(Obligation.with_depth(tcx, clone_ObligationCause(cause), depth, param_env, { $: "ConstArgHasType", _0: ct, _1: expected_ty }, upcast_ClauseKind));
  }
}

/// The old solver does not support references to non-type-consts.
/// Emit a delayed bug if there is a type system reference to a non type const, as this should have
/// already errored elsewhere.
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:508 const_of_item_or_delayed_bug
export function const_of_item_or_delayed_bug(tcx: TyCtxt, def_id: DefId): EarlyBinder<Const> {
  // PORT: the `const_of_item` query value is typed `unknown | undefined` in queries.gen.ts.
  const c = tcx.const_of_item(def_id) as EarlyBinder<Const> | undefined;
  if (c !== undefined) return c;
  const e = tcx.dcx().span_delayed_bug(tcx.def_span(def_id), "encountered regular consts in the old solver's const normalization");
  return EarlyBinder.bind(tcx, Const.new_error(tcx, e), fold_Const);
}

/// Confirm and normalize the given inherent projection.
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// #[instrument(level = "debug", skip(selcx, param_env, cause, obligations))]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:524 normalize_inherent_projection
export function normalize_inherent_projection(
  selcx: SelectionContext,
  param_env: ParamEnv,
  alias_term: AliasTerm,
  cause: ObligationCause,
  depth: number,
  obligations: PredicateObligations,
): Term {
  const { normalize_with_depth_to } = normalize_mod();
  // debug_assert!(!selcx.infcx.next_trait_solver());
  const tcx = selcx.tcx();

  if (!tcx.recursion_limit().value_within_limit(depth)) {
    // Halt compilation because it is important that overflows never be masked.
    // tcx.dcx().emit_fatal(InherentProjectionNormalizationOverflow { span: cause.span, ty: alias_term.to_string() });
    return unported("rustc_trait_selection::diagnostics::InherentProjectionNormalizationOverflow");
  }

  const args = compute_inherent_assoc_term_args(selcx, param_env, alias_term, clone_ObligationCause(cause), depth, obligations);

  // Register the obligations arising from the impl and from the associated type itself.
  const def_id = AliasTermC.expect_inherent_def_id(alias_term);
  // PORT: the `clauses_of` query value is typed `unknown` in queries.gen.ts.
  const clauses = GenericClauses.instantiate(tcx.clauses_of(def_id) as GenericClauses, tcx, args);
  for (const [clause_, span] of clauses.into_iter()) {
    const clause = normalize_with_depth_to(selcx, param_env, clone_ObligationCause(cause), depth + 1, clause_, obligations, fold_Clause);

    const nested_cause = ObligationCause.new(
      cause.span,
      cause.body_def_id,
      // FIXME(inherent_associated_types): Since we can't pass along the self type to the
      // cause code, inherent projections will be printed with identity instantiation in
      // diagnostics which is not ideal.
      // Consider creating separate cause codes for this specific situation.
      { $: "WhereClause", _0: def_id, _1: span },
    );

    obligations.push(Obligation.with_depth(tcx, nested_cause, depth + 1, param_env, clause, upcast_Clause));
  }

  const term_: Unnormalized<Term> = AliasTermKind.is_type(alias_term.kind)
    ? Unnormalized.map(EarlyBinder.instantiate(tcx.type_of(def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty), (t) => Term.from_Ty(t))
    : Unnormalized.map(EarlyBinder.instantiate(const_of_item_or_delayed_bug(tcx, def_id), tcx, args, fold_Const), (c) => Term.from_Const(c));

  const term1 = selcx.infcx.deeply_resolve_ignoring_regions(term_, d_Unnormalized_Term);
  const term = normalize_with_depth_to(selcx, param_env, clone_ObligationCause(cause), depth + 1, term1, obligations, fold_Term);

  push_const_arg_has_type_obligation(tcx, obligations, cause, depth + 1, param_env, term, def_id, args);

  return term;
}

// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:603 compute_inherent_assoc_term_args
export function compute_inherent_assoc_term_args(
  selcx: SelectionContext,
  param_env: ParamEnv,
  alias_term: AliasTerm,
  cause: ObligationCause,
  depth: number,
  obligations: PredicateObligations,
): GenericArgs {
  const { normalize_with_depth_to } = normalize_mod();
  const tcx = selcx.tcx();

  let alias_def_id: DefId;
  const kind = alias_term.kind;
  switch (kind.$) {
    case "InherentTy":
      alias_def_id = kind.def_id;
      break;
    case "InherentConstSelf":
      alias_def_id = kind.def_id;
      break;
    case "InherentConstImpl":
      return alias_term.args;
    default:
      return panic(`expected inherent alias, found ${debug_AliasTermKind(kind, PLAIN)}`);
  }

  const impl_def_id = tcx.parent(alias_def_id);
  const impl_args = selcx.infcx.fresh_args_for_item(cause.span, impl_def_id);

  const impl_ty_ = EarlyBinder.instantiate(tcx.type_of(impl_def_id) as EarlyBinder<Ty>, tcx, impl_args, fold_Ty);
  const impl_ty = !selcx.infcx.next_trait_solver()
    ? normalize_with_depth_to(selcx, param_env, clone_ObligationCause(cause), depth + 1, impl_ty_, obligations, fold_Ty)
    : Unnormalized.skip_norm_wip(impl_ty_);

  // Infer the generic parameters of the impl by unifying the
  // impl type with the self type of the projection.
  const self_ty_ = Unnormalized.new_wip(AliasTermC.self_ty(alias_term));
  const self_ty = !selcx.infcx.next_trait_solver()
    ? normalize_with_depth_to(selcx, param_env, clone_ObligationCause(cause), depth + 1, self_ty_, obligations, fold_Ty)
    : Unnormalized.skip_normalization(self_ty_);

  const r = selcx.infcx.at(cause, param_env).eq(DefineOpaqueTypes.Yes, impl_ty, self_ty, ToTrace_Ty);
  switch (r.$) {
    case "Ok":
      obligations.push(...(r._0 as InferOk<null>).obligations.splice(0));
      break;
    case "Err":
      tcx.dcx().span_bug(cause.span, `${debug_Ty(self_ty, PLAIN)} was equal to ${debug_Ty(impl_ty, PLAIN)} during selection but now it is not`);
  }

  return AliasTermC.rebase_inherent_args_onto_impl(alias_term, impl_args, tcx);
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
  // rustc: compiler/rustc_trait_selection/src/traits/project.rs:663 error_for_term
  error_for_term(tcx: TyCtxt, alias_term: AliasTerm, guar: ErrorGuaranteed): ProgressT {
    const err_term = AliasTermKind.is_type(alias_term.kind) ? Term.from_Ty(Ty.new_error(tcx, guar)) : Term.from_Const(Const.new_error(tcx, guar));
    return new Progress(Unnormalized.dummy(err_term), []);
  },
});
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:679 with_addl_obligations
Progress.prototype.with_addl_obligations = function (this: ProgressT, obligations: PredicateObligations): ProgressT {
  this.obligations.push(...obligations.splice(0));
  return this;
};

/// Computes the result of a projection type (if we can).
///
/// IMPORTANT:
/// - `obligation` must be fully normalized
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// #[instrument(level = "info", skip(selcx))]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:691 project
function project(selcx: SelectionContext, obligation: ProjectionTermObligation): Result<Projected, ProjectionError> {
  if (!selcx.tcx().recursion_limit().value_within_limit(obligation.recursion_depth)) {
    // This should really be an immediate error, but some existing code
    // relies on being able to recover from this.
    return Err({ $: "TraitSelectionError", _0: { $: "Overflow", _0: OverflowError.Canonical } });
  }

  // We can still compute a projection type when there are only region errors,
  // but type/const errors require early return.
  const reported = TypeVisitableExt.non_region_error_reported(obligation.predicate, d_AliasTerm);
  if (reported.$ === "Err") {
    const guar = reported._0;
    return Ok({ $: "Progress", _0: Progress.error_for_term(selcx.tcx(), obligation.predicate, guar) });
  }

  // `<dyn Trait>::Name` is only valid when `Trait` is dyn-compatible.
  // If it isn't, create an error at the projection site and return a tainted error term.
  const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));
  const sk = self_ty.kind();
  if (sk.$ === "Dynamic") {
    const data = sk._0;
    const def_id = data.principal_def_id();
    if (def_id !== undefined) {
      const tcx = selcx.tcx();
      // Delaying a bug is fine here:
      // - In case of a dymmy span, we are in a canonical query.
      // - `CheckAssociatedTypeBounds` means that the trait object is part of the trait's item bounds
      //   or the impl's associated type; both are checked at their own definition
      //   where the error is already reported with a better span.
      if (!tcx.is_dyn_compatible(def_id)) {
        const span = obligation.cause.span;
        let guar: ErrorGuaranteed;
        if (Span.is_dummy(span) || obligation.cause.code_().$ === "CheckAssociatedTypeBounds") {
          guar = tcx.dcx().span_delayed_bug(span, `projection from non-dyn-compatible trait \`${tcx.def_path_str(def_id)}\``);
        } else {
          const violations = tcx.dyn_compatibility_violations(def_id);
          guar = report_dyn_incompatibility(tcx, span, undefined, def_id, violations).emit_err();
        }
        return Ok({ $: "Progress", _0: Progress.error_for_term(tcx, obligation.predicate, guar) });
      }
    }
  }

  const candidates: MutRef<ProjectionCandidateSet> = { value: ProjectionCandidateSet.None };

  // Make sure that the following procedures are kept in order. ParamEnv
  // needs to be first because it has highest priority, and Select checks
  // the return value of push_candidate which assumes it's ran at last.
  assemble_candidates_from_param_env(selcx, obligation, candidates);

  assemble_candidates_from_trait_def(selcx, obligation, candidates);

  assemble_candidates_from_object_ty(selcx, obligation, candidates);

  if (candidates.value.$ === "Single" && candidates.value._0.$ === "Object") {
    // Avoid normalization cycle from selection (see
    // `assemble_candidates_from_object_ty`).
    // FIXME(lazy_normalization): Lazy normalization should save us from
    // having to special case this.
  } else {
    assemble_candidates_from_impls(selcx, obligation, candidates);
  }

  const c = candidates.value;
  switch (c.$) {
    case "Single": {
      const candidate = c._0;
      return confirm_candidate(selcx, obligation, candidate);
    }
    case "None": {
      const tcx = selcx.tcx();
      const term = AliasTermC.to_term(obligation.predicate, tcx, "No");
      return Ok({ $: "NoProgress", _0: term });
    }
    // Error occurred while trying to processing impls.
    case "Error":
      return Err({ $: "TraitSelectionError", _0: c._0 });
    // Inherent ambiguity that prevents us from even enumerating the
    // candidates.
    case "Ambiguous":
      return Err(ProjectionErrorC.TooManyCandidates);
  }
}

/// The first thing we have to do is scan through the parameter
/// environment to see whether there are any projection predicates
/// there that can answer this question.
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:791 assemble_candidates_from_param_env
function assemble_candidates_from_param_env(selcx: SelectionContext, obligation: ProjectionTermObligation, candidate_set: MutRef<ProjectionCandidateSet>): void {
  assemble_candidates_from_clauses(
    selcx,
    obligation,
    candidate_set,
    (p) => ({ $: "ParamEnv", _0: p }),
    obligation.param_env.caller_bounds(),
    false,
  );
}

/// In the case of a nested projection like `<<A as Foo>::FooT as Bar>::BarT`, we may find
/// that the definition of `Foo` has some clues:
///
/// ```ignore (illustrative)
/// trait Foo {
///     type FooT : Bar<BarT=i32>
/// }
/// ```
///
/// Here, for example, we could conclude that the result is `i32`.
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:816 assemble_candidates_from_trait_def
function assemble_candidates_from_trait_def(selcx: SelectionContext, obligation: ProjectionTermObligation, candidate_set: MutRef<ProjectionCandidateSet>): void {
  // debug!("assemble_candidates_from_trait_def(..)");
  let ambiguous = false;
  void selcx.for_each_item_bound(
    AliasTermC.self_ty(obligation.predicate),
    (selcx, clause_, _, __) => {
      const clause = clause_.as_projection_clause();
      if (clause === undefined) {
        return ControlFlow.CONTINUE;
      }
      if (!DefId_eq(PolyProjectionClauseC.item_def_id(clause), AliasTermC.expect_projection_def_id(obligation.predicate))) {
        return ControlFlow.CONTINUE;
      }

      const is_match: ProjectionMatchesProjection = selcx.infcx.probe((_) => selcx.match_projection_projections(obligation, clause, true));

      switch (is_match) {
        case "Yes": {
          ProjectionCandidateSet.push_candidate(candidate_set, { $: "TraitDef", _0: clause });

          if (!TypeVisitableExt.has_non_region_infer(obligation.predicate, d_AliasTerm)) {
            // HACK: Pick the first trait def candidate for a fully
            // inferred predicate. This is to allow duplicates that
            // differ only in normalization.
            return ControlFlow.Break(null);
          }
          break;
        }
        case "Ambiguous": {
          ProjectionCandidateSet.mark_ambiguous(candidate_set);
          break;
        }
        case "No":
          break;
      }

      return ControlFlow.CONTINUE;
    },
    // `ProjectionCandidateSet` is borrowed in the above closure,
    // so just mark ambiguous outside of the closure.
    () => {
      ambiguous = true;
    },
  );

  if (ambiguous) {
    ProjectionCandidateSet.mark_ambiguous(candidate_set);
  }
}

/// In the case of a trait object like
/// `<dyn Iterator<Item = ()> as Iterator>::Item` we can use the existential
/// predicate in the trait object.
///
/// We don't go through the select candidate for these bounds to avoid cycles:
/// In the above case, `dyn Iterator<Item = ()>: Iterator` would create a
/// nested obligation of `<dyn Iterator<Item = ()> as Iterator>::Item: Sized`,
/// this then has to be normalized without having to prove
/// `dyn Iterator<Item = ()>: Iterator` again.
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:874 assemble_candidates_from_object_ty
function assemble_candidates_from_object_ty(selcx: SelectionContext, obligation: ProjectionTermObligation, candidate_set: MutRef<ProjectionCandidateSet>): void {
  // debug!("assemble_candidates_from_object_ty(..)");

  const tcx = selcx.tcx();

  const self_ty = AliasTermC.self_ty(obligation.predicate);
  const object_ty = selcx.infcx.shallow_resolve(self_ty);
  const k = object_ty.kind();
  let data;
  if (k.$ === "Dynamic") {
    data = k._0;
  } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
    // If the self-type is an inference variable, then it MAY wind up
    // being an object type, so induce an ambiguity.
    ProjectionCandidateSet.mark_ambiguous(candidate_set);
    return;
  } else {
    return;
  }

  // Projecting `dyn Trait` is only valid when `Trait` is dyn-compatible.
  const principal = data.principal_def_id();
  if (principal !== undefined && !tcx.is_dyn_compatible(principal)) {
    return;
  }

  // PORT: the lazy `filter(..).map(..)` iterator is a generator (consumed once, in order, by
  // `assemble_candidates_from_clauses`).
  const env_predicates = (function* (): Generator<Clause> {
    for (const bound of data.projection_bounds()) {
      if (!DefId_eq(PolyExistentialProjection.item_def_id(bound), AliasTermC.expect_projection_def_id(obligation.predicate))) continue;
      yield Clause_upcast_from_PolyProjectionClause(PolyExistentialProjection.with_self_ty(bound, tcx, object_ty), tcx);
    }
  })();

  assemble_candidates_from_clauses(selcx, obligation, candidate_set, (p) => ({ $: "Object", _0: p }), env_predicates, false);
}

// #[instrument(
//     level = "debug",
//     skip(selcx, candidate_set, ctor, env_clauses, potentially_unnormalized_candidates)
// )]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:920 assemble_candidates_from_clauses
function assemble_candidates_from_clauses(
  selcx: SelectionContext,
  obligation: ProjectionTermObligation,
  candidate_set: MutRef<ProjectionCandidateSet>,
  ctor: (p: PolyProjectionClause) => ProjectionCandidate,
  env_clauses: Iterable<Clause>,
  potentially_unnormalized_candidates: boolean,
): void {
  const infcx = selcx.infcx;
  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(selcx.tcx()));
  for (const clause of env_clauses) {
    const bound_clause = clause.kind();
    const k = Binder.skip_binder(clause.kind());
    if (k.$ === "Projection") {
      const data = Binder.rebind(bound_clause, k._0);
      if (!DefId_eq(PolyProjectionClauseC.item_def_id(data), AliasTermC.expect_projection_def_id(obligation.predicate))) {
        continue;
      }

      if (!drcx.args_may_unify(obligation.predicate.args, Binder.skip_binder(data).projection_term.args)) {
        continue;
      }

      const is_match: ProjectionMatchesProjection = infcx.probe((_) => selcx.match_projection_projections(obligation, data, potentially_unnormalized_candidates));

      switch (is_match) {
        case "Yes": {
          ProjectionCandidateSet.push_candidate(candidate_set, ctor(data));

          if (potentially_unnormalized_candidates && !TypeVisitableExt.has_non_region_infer(obligation.predicate, d_AliasTerm)) {
            // HACK: Pick the first trait def candidate for a fully
            // inferred predicate. This is to allow duplicates that
            // differ only in normalization.
            return;
          }
          break;
        }
        case "Ambiguous": {
          ProjectionCandidateSet.mark_ambiguous(candidate_set);
          break;
        }
        case "No":
          break;
      }
    }
  }
}

// #[instrument(level = "debug", skip(selcx, obligation, candidate_set))]
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:975 assemble_candidates_from_impls
function assemble_candidates_from_impls(selcx: SelectionContext, obligation: ProjectionTermObligation, candidate_set: MutRef<ProjectionCandidateSet>): void {
  const { normalize_with_depth } = normalize_mod();
  const specialization_graph = require("./specialize/specialization_graph.ts") as typeof import("./specialize/specialization_graph.ts");
  // If we are resolving `<T as TraitRef<...>>::Item == Type`,
  // start out by selecting the predicate `T as TraitRef<...>`:
  const trait_ref = AliasTermC.trait_ref(obligation.predicate, as_interner(selcx.tcx()));
  const trait_obligation = obligation.with(selcx.tcx(), trait_ref, TraitClause.upcast_from_TraitRef);
  void selcx.infcx.commit_if_ok((_): Result<null, null> => {
    const sr = selcx.select(trait_obligation);
    let impl_source: Selection;
    if (sr.$ === "Ok") {
      if (sr._0 !== undefined) {
        impl_source = sr._0;
      } else {
        ProjectionCandidateSet.mark_ambiguous(candidate_set);
        return Err(null);
      }
    } else {
      const e = sr._0;
      // debug!(error = ?e, "selection error");
      ProjectionCandidateSet.mark_error(candidate_set, e);
      return Err(null);
    }

    let eligible: boolean;
    if (impl_source.$ === "UserDefined") {
      const impl_data = impl_source._0;
      // We have to be careful when projecting out of an
      // impl because of specialization. If we are not in
      // codegen (i.e., `TypingMode` is not `PostAnalysis`), and the
      // impl's type is declared as default, then we disable
      // projection (even if the trait ref is fully
      // monomorphic). In the case where trait ref is not
      // fully monomorphic (i.e., includes type parameters),
      // this is because those type parameters may
      // ultimately be bound to types from other crates that
      // may have specialized impls we can't see. In the
      // case where the trait ref IS fully monomorphic, this
      // is a policy decision that we made in the RFC in
      // order to preserve flexibility for the crate that
      // defined the specializable impl to specialize later
      // for existing types.
      //
      // In either case, we handle this by not adding a
      // candidate for an impl if it contains a `default`
      // type.
      //
      // NOTE: This should be kept in sync with the similar code in
      // `rustc_ty_utils::instance::resolve_associated_item()`.
      const r = specialization_graph.assoc_def(selcx.tcx(), impl_data.impl_def_id, AliasTermC.expect_projection_def_id(obligation.predicate));
      if (r.$ === "Ok") {
        const node_item = r._0;
        if (node_item.is_final()) {
          // Non-specializable items are always projectable.
          eligible = true;
        } else {
          // Only reveal a specializable default if we're past type-checking
          // and the obligation is monomorphic, otherwise passes such as
          // transmute checking and polymorphic MIR optimizations could
          // get a result which isn't correct for all monomorphizations.
          const mode: TypingMode<CantBeErased> = selcx.typing_mode();
          switch (mode.$) {
            case "Typeck":
            case "PostTypeckUntilBorrowck":
            case "Reflection":
            case "PostBorrowck": {
              // debug!(assoc_ty = ?selcx.tcx().def_path_str(node_item.item.def_id), ?obligation.predicate, "not eligible due to default");
              eligible = false;
              break;
            }
            case "PostAnalysis":
            case "Codegen": {
              // NOTE(eddyb) inference variables can resolve to parameters, so
              // assume `poly_trait_ref` isn't monomorphic, if it contains any.
              const poly_trait_ref = selcx.infcx.deeply_resolve_ignoring_regions(trait_ref, d_TraitRef);
              eligible = !TypeVisitableExt.still_further_specializable(poly_trait_ref, d_TraitRef);
              break;
            }
            case "Coherence":
              return unreachable("internal error: entered unreachable code: old solver coherence");
            // PORT: `ErasedNotCoherence(CantBeErased)` is uninhabited (no arm upstream).
            case "ErasedNotCoherence":
              return mode._0;
          }
        }
      } else {
        // Always project `ErrorGuaranteed`, since this will just help
        // us propagate `TyKind::Error` around which suppresses ICEs
        // and spurious, unrelated inference errors.
        eligible = true;
      }
    } else if (impl_source.$ === "Builtin" && (impl_source._0.$ === "Misc" || impl_source._0.$ === "Trivial")) {
      // While a builtin impl may be known to exist, the associated type may not yet
      // be known. Any type with multiple potential associated types is therefore
      // not eligible.
      const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));

      const tcx = selcx.tcx();
      const lang_item = selcx.tcx().as_lang_item(trait_ref.def_id);
      if (
        lang_item === LangItem.Coroutine ||
        lang_item === LangItem.Future ||
        lang_item === LangItem.Iterator ||
        lang_item === LangItem.AsyncIterator ||
        lang_item === LangItem.Field ||
        lang_item === LangItem.Fn ||
        lang_item === LangItem.FnMut ||
        lang_item === LangItem.FnOnce ||
        lang_item === LangItem.AsyncFn ||
        lang_item === LangItem.AsyncFnMut ||
        lang_item === LangItem.AsyncFnOnce
      ) {
        eligible = true;
      } else if (lang_item === LangItem.AsyncFnKindHelper) {
        // FIXME(async_closures): Validity constraints here could be cleaned up.
        if (
          obligation.predicate.args.type_at(0).is_ty_var() ||
          obligation.predicate.args.type_at(4).is_ty_var() ||
          obligation.predicate.args.type_at(5).is_ty_var()
        ) {
          ProjectionCandidateSet.mark_ambiguous(candidate_set);
          eligible = true;
        } else {
          eligible = obligation.predicate.args.type_at(0).to_opt_closure_kind() !== undefined && obligation.predicate.args.type_at(1).to_opt_closure_kind() !== undefined;
        }
      } else if (lang_item === LangItem.DiscriminantKind) {
        const k = self_ty.kind();
        switch (k.$) {
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
          case "Dynamic":
          case "Closure":
          case "CoroutineClosure":
          case "Coroutine":
          case "CoroutineWitness":
          case "Never":
          case "Tuple":
            eligible = true;
            break;
          case "UnsafeBinder":
            return panic("not implemented: FIXME(unsafe_binder)");
          // type parameters, opaques, and unnormalized projections don't have
          // a known discriminant and may need to be normalized further or rely
          // on param env for discriminant projections
          case "Param":
          case "Alias":
          case "Bound":
          case "Placeholder":
          case "Error":
            eligible = false;
            break;
          case "Infer":
            // Integers and floats always have `u8` as their discriminant.
            eligible = k._0.$ === "IntVar" || k._0.$ === "FloatVar";
            break;
        }
      } else if (lang_item === LangItem.PointeeTrait) {
        const tail = selcx.tcx().struct_tail_raw(
          self_ty,
          obligation.cause,
          (ty) => {
            // We throw away any obligations we get from this, since we normalize
            // and confirm these obligations once again during confirmation
            return normalize_with_depth(selcx, obligation.param_env, clone_ObligationCause(obligation.cause), obligation.recursion_depth + 1, ty, fold_Ty).value;
          },
          () => {},
        );

        const k = tail.kind();
        switch (k.$) {
          case "Bool":
          case "Char":
          case "Int":
          case "Uint":
          case "Float":
          case "Str":
          case "Array":
          case "Pat":
          case "Slice":
          case "RawPtr":
          case "Ref":
          case "FnDef":
          case "FnPtr":
          case "Dynamic":
          case "Closure":
          case "CoroutineClosure":
          case "Coroutine":
          case "CoroutineWitness":
          case "Never":
          // Extern types have unit metadata, according to RFC 2850
          case "Foreign":
          // If returned by `struct_tail` this is a unit struct
          // without any fields, or not a struct, and therefore is Sized.
          case "Adt":
          // If returned by `struct_tail` this is the empty tuple.
          case "Tuple":
          // This happens if we reach the recursion limit when finding the struct tail.
          case "Error":
            eligible = true;
            break;
          default: {
            // Integers and floats are always Sized, and so have unit type metadata.
            if (k.$ === "Infer" && (k._0.$ === "IntVar" || k._0.$ === "FloatVar")) {
              eligible = true;
              break;
            }
            // We normalize from `Wrapper<Tail>::Metadata` to `Tail::Metadata` if able.
            // Otherwise, type parameters, opaques, and unnormalized projections have
            // unit metadata if they're known (e.g. by the param_env) to be sized.
            if (
              (k.$ === "Param" || k.$ === "Alias") &&
              (self_ty !== tail ||
                selcx.infcx.predicate_must_hold_modulo_regions(
                  obligation.with(
                    selcx.tcx(),
                    TraitRef.new(as_interner(selcx.tcx()), selcx.tcx().require_lang_item(LangItem.Sized, obligation.cause.span), [GenericArg.from_Ty(self_ty)]),
                    upcast_TraitRef,
                  ),
                ))
            ) {
              eligible = true;
              break;
            }

            if (k.$ === "UnsafeBinder") {
              return panic("not implemented: FIXME(unsafe_binder)");
            }

            // FIXME(compiler-errors): are Bound and Placeholder types ever known sized?
            // ty::Param(_) | ty::Alias(..) | ty::Bound(..) | ty::Placeholder(..) | ty::Infer(..)
            if (TypeVisitableExt.has_infer_types(tail, fold_Ty)) {
              ProjectionCandidateSet.mark_ambiguous(candidate_set);
            }
            eligible = false;
            break;
          }
        }
      } else if (tcx.trait_is_auto(trait_ref.def_id)) {
        tcx.dcx().span_delayed_bug(tcx.def_span(AliasTermC.expect_projection_def_id(obligation.predicate)), "associated types not allowed on auto traits");
        eligible = false;
      } else {
        return bug(`unexpected builtin trait with associated type: ${debug_TraitRef(trait_ref, PLAIN)}`);
      }
    } else if (impl_source.$ === "Param") {
      // This case tell us nothing about the value of an
      // associated type. Consider:
      //
      // ```
      // trait SomeTrait { type Foo; }
      // fn foo<T:SomeTrait>(...) { }
      // ```
      //
      // If the user writes `<T as SomeTrait>::Foo`, then the `T
      // : SomeTrait` binding does not help us decide what the
      // type `Foo` is (at least, not more specifically than
      // what we already knew).
      //
      // But wait, you say! What about an example like this:
      //
      // ```
      // fn bar<T:SomeTrait<Foo=usize>>(...) { ... }
      // ```
      //
      // Doesn't the `T : SomeTrait<Foo=usize>` predicate help
      // resolve `T::Foo`? And of course it does, but in fact
      // that single predicate is desugared into two predicates
      // in the compiler: a trait predicate (`T : SomeTrait`) and a
      // projection. And the projection where clause is handled
      // in `assemble_candidates_from_param_env`.
      eligible = false;
    } else if (impl_source._0.$ === "Object") {
      // Handled by the `Object` projection candidate. See
      // `assemble_candidates_from_object_ty` for an explanation of
      // why we special case object types.
      eligible = false;
    } else {
      // ImplSource::Builtin(BuiltinImplSource::TraitUpcasting { .. }, _)
      // These traits have no associated types.
      selcx.tcx().dcx().span_delayed_bug(obligation.cause.span, `Cannot project an associated type from \`${debug_Selection(impl_source)}\``);
      return Err(null);
    }

    if (eligible) {
      if (ProjectionCandidateSet.push_candidate(candidate_set, { $: "Select", _0: impl_source })) {
        return Ok(null);
      } else {
        return Err(null);
      }
    } else {
      return Err(null);
    }
  });
}

// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1301 confirm_candidate
function confirm_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, candidate: ProjectionCandidate): Result<Projected, ProjectionError> {
  // debug!(?obligation, ?candidate, "confirm_candidate");
  let result: Result<Projected, ProjectionError>;
  switch (candidate.$) {
    case "ParamEnv":
    case "Object": {
      const poly_projection = candidate._0;
      result = Ok({ $: "Progress", _0: confirm_param_env_candidate(selcx, obligation, poly_projection, false) });
      break;
    }
    case "TraitDef": {
      const poly_projection = candidate._0;
      result = Ok({ $: "Progress", _0: confirm_param_env_candidate(selcx, obligation, poly_projection, true) });
      break;
    }
    case "Select": {
      const impl_source = candidate._0;
      result = confirm_select_candidate(selcx, obligation, impl_source);
      break;
    }
  }

  // When checking for cycle during evaluation, we compare predicates with
  // "syntactic" equality. Since normalization generally introduces a type
  // with new region variables, we need to resolve them to existing variables
  // when possible for this to work. See `auto-trait-projection-recursion.rs`
  // for a case where this matters.
  if (result.$ === "Ok" && result._0.$ === "Progress" && TypeVisitableExt.has_infer_regions(result._0._0.term, d_Unnormalized_Term)) {
    const progress = result._0._0;
    progress.term = selcx.infcx.deeply_resolve_via_unification_table(progress.term, d_Unnormalized_Term);
  }

  return result;
}

// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1335 confirm_select_candidate
function confirm_select_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, impl_source: Selection): Result<Projected, ProjectionError> {
  if (impl_source.$ === "UserDefined") {
    const data = impl_source._0;
    return confirm_impl_candidate(selcx, obligation, data);
  } else if (impl_source.$ === "Builtin" && (impl_source._0.$ === "Misc" || impl_source._0.$ === "Trivial")) {
    const data = impl_source._1;
    const tcx = selcx.tcx();
    const trait_def_id = AliasTermC.trait_def_id(obligation.predicate, as_interner(tcx));
    let progress: ProgressT;
    if (tcx.is_lang_item(trait_def_id, LangItem.Coroutine)) {
      progress = confirm_coroutine_candidate(selcx, obligation, data);
    } else if (tcx.is_lang_item(trait_def_id, LangItem.Future)) {
      progress = confirm_future_candidate(selcx, obligation, data);
    } else if (tcx.is_lang_item(trait_def_id, LangItem.Iterator)) {
      progress = confirm_iterator_candidate(selcx, obligation, data);
    } else if (tcx.is_lang_item(trait_def_id, LangItem.AsyncIterator)) {
      progress = confirm_async_iterator_candidate(selcx, obligation, data);
    } else if (selcx.tcx().fn_trait_kind_from_def_id(trait_def_id) !== undefined) {
      if (AliasTermC.self_ty(obligation.predicate).is_closure() || AliasTermC.self_ty(obligation.predicate).is_coroutine_closure()) {
        progress = confirm_closure_candidate(selcx, obligation, data);
      } else {
        progress = confirm_fn_pointer_candidate(selcx, obligation, data);
      }
    } else if (selcx.tcx().async_fn_trait_kind_from_def_id(trait_def_id) !== undefined) {
      progress = confirm_async_closure_candidate(selcx, obligation, data);
    } else if (tcx.is_lang_item(trait_def_id, LangItem.AsyncFnKindHelper)) {
      progress = confirm_async_fn_kind_helper_candidate(selcx, obligation, data);
    } else {
      progress = confirm_builtin_candidate(selcx, obligation, data);
    }
    return Ok({ $: "Progress", _0: progress });
  } else {
    // ImplSource::Builtin(BuiltinImplSource::Object { .. }, _)
    // | ImplSource::Param(..)
    // | ImplSource::Builtin(BuiltinImplSource::TraitUpcasting { .. }, _)
    // we don't create Select candidates with this kind of resolution
    return span_bug(obligation.cause.span, `Cannot project an associated type from \`${debug_Selection(impl_source)}\``);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1383 confirm_coroutine_candidate
function confirm_coroutine_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const { normalize_with_depth } = normalize_mod();
  const util = require("./util.ts") as typeof import("./util.ts");
  const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return unreachable(`internal error: entered unreachable code: expected coroutine self type for built-in coroutine candidate, found ${display_Ty(self_ty)}`);
  }
  const args = k._1;
  const coroutine_sig_ = Unnormalized.new_wip(CoroutineArgs.sig(args.as_coroutine()));
  const { value: coroutine_sig, obligations } = normalize_with_depth(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    coroutine_sig_,
    d_GenSig,
  );

  // debug!(?obligation, ?coroutine_sig, ?obligations, "confirm_coroutine_candidate");

  const tcx = selcx.tcx();

  const coroutine_def_id = tcx.require_lang_item(LangItem.Coroutine, obligation.cause.span);

  const [trait_ref, yield_ty, return_ty] = util.coroutine_trait_ref_and_outputs(tcx, coroutine_def_id, AliasTermC.self_ty(obligation.predicate), coroutine_sig);

  const def_id = AliasTermC.expect_projection_def_id(obligation.predicate);
  let ty: Ty;
  if (tcx.is_lang_item(def_id, LangItem.CoroutineReturn)) {
    ty = return_ty;
  } else if (tcx.is_lang_item(def_id, LangItem.CoroutineYield)) {
    ty = yield_ty;
  } else {
    return span_bug(tcx.def_span(def_id), `unexpected associated type: \`Coroutine::${Symbol.as_str(tcx.item_name(def_id))}\``);
  }

  const predicate: ProjectionClause = {
    projection_term: AliasTermC.with_args(obligation.predicate, tcx, trait_ref.args),
    term: Term.from_Ty(ty),
  };

  return confirm_param_env_candidate(selcx, obligation, Binder.dummy(predicate, d_ProjectionClause), false)
    .with_addl_obligations(nested)
    .with_addl_obligations(obligations);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1439 confirm_future_candidate
function confirm_future_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const { normalize_with_depth } = normalize_mod();
  const util = require("./util.ts") as typeof import("./util.ts");
  const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return unreachable(`internal error: entered unreachable code: expected coroutine self type for built-in async future candidate, found ${display_Ty(self_ty)}`);
  }
  const args = k._1;
  const coroutine_sig_ = Unnormalized.new_wip(CoroutineArgs.sig(args.as_coroutine()));
  const { value: coroutine_sig, obligations } = normalize_with_depth(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    coroutine_sig_,
    d_GenSig,
  );

  // debug!(?obligation, ?coroutine_sig, ?obligations, "confirm_future_candidate");

  const tcx = selcx.tcx();
  const fut_def_id = tcx.require_lang_item(LangItem.Future, obligation.cause.span);

  const [trait_ref, return_ty] = util.future_trait_ref_and_outputs(tcx, fut_def_id, AliasTermC.self_ty(obligation.predicate), coroutine_sig);

  // debug_assert_eq!(tcx.associated_item(obligation.predicate.expect_projection_def_id()).name(), sym::Output);

  const predicate: ProjectionClause = {
    projection_term: AliasTermC.with_args(obligation.predicate, tcx, trait_ref.args),
    term: Term.from_Ty(return_ty),
  };

  return confirm_param_env_candidate(selcx, obligation, Binder.dummy(predicate, d_ProjectionClause), false)
    .with_addl_obligations(nested)
    .with_addl_obligations(obligations);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1486 confirm_iterator_candidate
function confirm_iterator_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const { normalize_with_depth } = normalize_mod();
  const util = require("./util.ts") as typeof import("./util.ts");
  const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));
  const k = self_ty.kind();
  if (k.$ !== "Coroutine") {
    return unreachable(`internal error: entered unreachable code: expected coroutine self type for built-in gen candidate, found ${display_Ty(self_ty)}`);
  }
  const args = k._1;
  const gen_sig_ = Unnormalized.new_wip(CoroutineArgs.sig(args.as_coroutine()));
  const { value: gen_sig, obligations } = normalize_with_depth(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    gen_sig_,
    d_GenSig,
  );

  // debug!(?obligation, ?gen_sig, ?obligations, "confirm_iterator_candidate");

  const tcx = selcx.tcx();
  const iter_def_id = tcx.require_lang_item(LangItem.Iterator, obligation.cause.span);

  const [trait_ref, yield_ty] = util.iterator_trait_ref_and_outputs(tcx, iter_def_id, AliasTermC.self_ty(obligation.predicate), gen_sig);

  // debug_assert_eq!(tcx.associated_item(obligation.predicate.expect_projection_def_id()).name(), sym::Item);

  const predicate: ProjectionClause = {
    projection_term: AliasTermC.with_args(obligation.predicate, tcx, trait_ref.args),
    term: Term.from_Ty(yield_ty),
  };

  return confirm_param_env_candidate(selcx, obligation, Binder.dummy(predicate, d_ProjectionClause), false)
    .with_addl_obligations(nested)
    .with_addl_obligations(obligations);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1531 confirm_async_iterator_candidate
function confirm_async_iterator_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const { normalize_with_depth } = normalize_mod();
  const util = require("./util.ts") as typeof import("./util.ts");
  const k = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate)).kind();
  if (k.$ !== "Coroutine") {
    return unreachable();
  }
  const args = k._1;
  const gen_sig_ = Unnormalized.new_wip(CoroutineArgs.sig(args.as_coroutine()));
  const { value: gen_sig, obligations } = normalize_with_depth(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    gen_sig_,
    d_GenSig,
  );

  // debug!(?obligation, ?gen_sig, ?obligations, "confirm_async_iterator_candidate");

  const tcx = selcx.tcx();
  const iter_def_id = tcx.require_lang_item(LangItem.AsyncIterator, obligation.cause.span);

  const [trait_ref, yield_ty] = util.async_iterator_trait_ref_and_outputs(tcx, iter_def_id, AliasTermC.self_ty(obligation.predicate), gen_sig);

  // debug_assert_eq!(tcx.associated_item(obligation.predicate.expect_projection_def_id()).name(), sym::Item);

  const yk = yield_ty.kind();
  if (yk.$ !== "Adt") {
    return bug();
  }
  const ak = yk._1.type_at(0).kind();
  if (ak.$ !== "Adt") {
    return bug();
  }
  const item_ty = ak._1.type_at(0);

  const predicate: ProjectionClause = {
    projection_term: AliasTermC.with_args(obligation.predicate, tcx, trait_ref.args),
    term: Term.from_Ty(item_ty),
  };

  return confirm_param_env_candidate(selcx, obligation, Binder.dummy(predicate, d_ProjectionClause), false)
    .with_addl_obligations(nested)
    .with_addl_obligations(obligations);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1584 confirm_builtin_candidate
function confirm_builtin_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, data: PredicateObligations): ProgressT {
  const { normalize_with_depth_to } = normalize_mod();
  const tcx = selcx.tcx();
  const self_ty = AliasTermC.self_ty(obligation.predicate);
  const item_def_id = AliasTermC.expect_projection_def_id(obligation.predicate);
  const trait_def_id = tcx.parent(item_def_id);
  const args = tcx.mk_args([GenericArg.from_Ty(self_ty)]);
  let term: Term;
  let obligations: PredicateObligations;
  if (tcx.is_lang_item(trait_def_id, LangItem.DiscriminantKind)) {
    const discriminant_def_id = tcx.require_lang_item(LangItem.Discriminant, obligation.cause.span);
    assert_eq(discriminant_def_id, item_def_id, (d) => debug_DefId(d, PLAIN), DefId_eq);

    [term, obligations] = [Term.from_Ty(self_ty.discriminant_ty(tcx)), []];
  } else if (tcx.is_lang_item(trait_def_id, LangItem.PointeeTrait)) {
    const metadata_def_id = tcx.require_lang_item(LangItem.Metadata, obligation.cause.span);
    assert_eq(metadata_def_id, item_def_id, (d) => debug_DefId(d, PLAIN), DefId_eq);

    const obligations_: PredicateObligations = [];
    const normalize = (ty: Unnormalized<Ty>): Ty =>
      normalize_with_depth_to(selcx, obligation.param_env, clone_ObligationCause(obligation.cause), obligation.recursion_depth + 1, ty, obligations_, fold_Ty);
    const r = self_ty.ptr_metadata_ty_or_tail(tcx, normalize);
    let metadata_ty: Ty;
    if (r.$ === "Ok") {
      metadata_ty = r._0;
    } else {
      const tail = r._0;
      if (tail === self_ty) {
        // This is the "fallback impl" for type parameters, unnormalizable projections
        // and opaque types: If the `self_ty` is `Sized`, then the metadata is `()`.
        // FIXME(ptr_metadata): This impl overlaps with the other impls and shouldn't
        // exist. Instead, `Pointee<Metadata = ()>` should be a supertrait of `Sized`.
        const sized_predicate = TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Sized, obligation.cause.span), [GenericArg.from_Ty(self_ty)]);
        obligations_.push(obligation.with(tcx, sized_predicate, upcast_TraitRef));
        metadata_ty = tcx.types.unit;
      } else {
        // We know that `self_ty` has the same metadata as `tail`. This allows us
        // to prove predicates like `Wrapper<Tail>::Metadata == Tail::Metadata`.
        metadata_ty = Ty.new_projection(tcx, "No", metadata_def_id, [GenericArg.from_Ty(tail)]);
      }
    }
    [term, obligations] = [Term.from_Ty(metadata_ty), obligations_];
  } else if (tcx.is_lang_item(trait_def_id, LangItem.Field)) {
    const k = self_ty.kind();
    if (k.$ !== "Adt") {
      return bug("only field representing types can implement `Field`");
    }
    const def = k._0;
    const args_ = k._1;
    const info = def.field_representing_type_info(tcx, args_);
    if (info === undefined) {
      return bug("only field representing types can implement `Field`");
    }
    const { base, ty } = info;
    if (tcx.is_lang_item(item_def_id, LangItem.FieldBase)) {
      [term, obligations] = [Term.from_Ty(base), []];
    } else if (tcx.is_lang_item(item_def_id, LangItem.FieldType)) {
      [term, obligations] = [Term.from_Ty(ty), []];
    } else {
      return bug(`unexpected associated type ${debug_AliasTerm(obligation.predicate, PLAIN)} in \`Field\``);
    }
  } else {
    return bug(`unexpected builtin trait with associated type: ${debug_AliasTerm(obligation.predicate, PLAIN)}`);
  }

  const predicate: ProjectionClause = {
    projection_term: AliasTermC.new_from_args(tcx, { $: "ProjectionTy", def_id: item_def_id }, args),
    term,
  };

  return confirm_param_env_candidate(selcx, obligation, Binder.dummy(predicate, d_ProjectionClause), false)
    .with_addl_obligations(obligations)
    .with_addl_obligations(data);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1667 confirm_fn_pointer_candidate
function confirm_fn_pointer_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const { normalize_with_depth } = normalize_mod();
  const tcx = selcx.tcx();
  const fn_type = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));
  const sig_ = fn_type.unnormalized_fn_sig(tcx);
  const { value: sig, obligations } = normalize_with_depth(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    sig_,
    fold_Binder(fold_FnSig),
  );

  return confirm_callable_candidate(selcx, obligation, sig, "Yes").with_addl_obligations(nested).with_addl_obligations(obligations);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1688 confirm_closure_candidate
function confirm_closure_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const { normalize_with_depth } = normalize_mod();
  const tcx = selcx.tcx();
  const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));
  const k = self_ty.kind();
  let closure_sig_: Unnormalized<Binder<FnSigT>>;
  switch (k.$) {
    case "Closure": {
      const args = k._1;
      closure_sig_ = Unnormalized.new_wip(ClosureArgs.sig(args.as_closure()));
      break;
    }

    // Construct a "normal" `FnOnce` signature for coroutine-closure. This is
    // basically duplicated with the `AsyncFnOnce::CallOnce` confirmation, but
    // I didn't see a good way to unify those.
    case "CoroutineClosure": {
      const def_id = k._0;
      const args = k._1.as_coroutine_closure();
      closure_sig_ = Unnormalized.new_wip(
        Binder.map_bound(CoroutineClosureArgsC.coroutine_closure_sig(args), (sig) => {
          const output_ty = coroutine_closure_output_coroutine(tcx, obligation, ClosureKind.FnOnce, tcx.lifetimes.re_static, def_id, args);
          return tcx.mk_fn_sig([sig.tupled_inputs_ty], output_ty, sig.fn_sig_kind);
        }),
      );
      break;
    }

    default: {
      return unreachable(`internal error: entered unreachable code: expected closure self type for closure candidate, found ${display_Ty(self_ty)}`);
    }
  }

  const { value: closure_sig, obligations } = normalize_with_depth(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    closure_sig_,
    fold_Binder(fold_FnSig),
  );

  // debug!(?obligation, ?closure_sig, ?obligations, "confirm_closure_candidate");

  return confirm_callable_candidate(selcx, obligation, closure_sig, "No").with_addl_obligations(nested).with_addl_obligations(obligations);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1736 confirm_callable_candidate
function confirm_callable_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, fn_sig: Binder<FnSigT>, flag: TupleArgumentsFlag): ProgressT {
  const util = require("./util.ts") as typeof import("./util.ts");
  const tcx = selcx.tcx();

  // debug!(?obligation, ?fn_sig, "confirm_callable_candidate");

  const fn_once_def_id = tcx.require_lang_item(LangItem.FnOnce, obligation.cause.span);
  const fn_once_output_def_id = tcx.require_lang_item(LangItem.FnOnceOutput, obligation.cause.span);

  const predicate = Binder.map_bound(
    util.closure_trait_ref_and_return_type(tcx, fn_once_def_id, AliasTermC.self_ty(obligation.predicate), fn_sig, flag),
    ([trait_ref, ret_type]): ProjectionClause => ({
      projection_term: AliasTermC.new_from_args(tcx, { $: "ProjectionTy", def_id: fn_once_output_def_id }, trait_ref.args),
      term: Term.from_Ty(ret_type),
    }),
  );

  return confirm_param_env_candidate(selcx, obligation, predicate, true);
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1769 confirm_async_closure_candidate
function confirm_async_closure_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const tcx = selcx.tcx();
  const self_ty = selcx.infcx.shallow_resolve(AliasTermC.self_ty(obligation.predicate));

  const goal_kind_ = tcx.async_fn_trait_kind_from_def_id(AliasTermC.trait_def_id(obligation.predicate, as_interner(tcx)));
  if (goal_kind_ === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const goal_kind = goal_kind_;
  let env_region;
  switch (goal_kind) {
    case "Fn":
    case "FnMut":
      env_region = obligation.predicate.args.region_at(2);
      break;
    case "FnOnce":
      env_region = tcx.lifetimes.re_static;
      break;
  }
  const item_name = tcx.item_name(AliasTermC.expect_projection_def_id(obligation.predicate));

  let poly_cache_entry: PolyProjectionClause;
  const k = self_ty.kind();
  switch (k.$) {
    case "CoroutineClosure": {
      const def_id = k._0;
      const args = k._1.as_coroutine_closure();
      const sig = Binder.skip_binder(CoroutineClosureArgsC.coroutine_closure_sig(args));

      let term: Ty;
      if (item_name === sym.CallOnceFuture || item_name === sym.CallRefFuture) {
        term = coroutine_closure_output_coroutine(tcx, obligation, goal_kind, env_region, def_id, args);
      } else if (item_name === sym.Output) {
        term = sig.return_ty;
      } else {
        return bug(`no such associated type: ${Symbol.as_str(item_name)}`);
      }
      let projection_term: AliasTerm;
      if (item_name === sym.CallOnceFuture || item_name === sym.Output) {
        projection_term = AliasTermC.new(tcx, obligation.predicate.kind, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(sig.tupled_inputs_ty)]);
      } else if (item_name === sym.CallRefFuture) {
        projection_term = AliasTermC.new(tcx, obligation.predicate.kind, [
          GenericArg.from_Ty(self_ty),
          GenericArg.from_Ty(sig.tupled_inputs_ty),
          GenericArg.from_Region(env_region),
        ]);
      } else {
        return bug(`no such associated type: ${Symbol.as_str(item_name)}`);
      }

      poly_cache_entry = Binder.rebind(CoroutineClosureArgsC.coroutine_closure_sig(args), { projection_term, term: Term.from_Ty(term) });
      break;
    }
    case "FnDef":
    case "FnPtr": {
      const bound_sig = self_ty.fn_sig(tcx);
      const sig = Binder.skip_binder(bound_sig);

      let term: Ty;
      if (item_name === sym.CallOnceFuture || item_name === sym.CallRefFuture) {
        term = FnSig.output(sig);
      } else if (item_name === sym.Output) {
        const future_output_def_id = tcx.require_lang_item(LangItem.FutureOutput, obligation.cause.span);
        term = Ty.new_projection(tcx, "No", future_output_def_id, [GenericArg.from_Ty(FnSig.output(sig))]);
      } else {
        return bug(`no such associated type: ${Symbol.as_str(item_name)}`);
      }
      let projection_term: AliasTerm;
      if (item_name === sym.CallOnceFuture || item_name === sym.Output) {
        projection_term = AliasTermC.new(tcx, obligation.predicate.kind, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(Ty.new_tup(tcx, [...FnSig.inputs(sig)]))]);
      } else if (item_name === sym.CallRefFuture) {
        projection_term = AliasTermC.new(tcx, obligation.predicate.kind, [
          GenericArg.from_Ty(self_ty),
          GenericArg.from_Ty(Ty.new_tup(tcx, [...FnSig.inputs(sig)])),
          GenericArg.from_Region(env_region),
        ]);
      } else {
        return bug(`no such associated type: ${Symbol.as_str(item_name)}`);
      }

      poly_cache_entry = Binder.rebind(bound_sig, { projection_term, term: Term.from_Ty(term) });
      break;
    }
    case "Closure": {
      const args = k._1.as_closure();
      const bound_sig = ClosureArgs.sig(args);
      const sig = Binder.skip_binder(bound_sig);

      let term: Ty;
      if (item_name === sym.CallOnceFuture || item_name === sym.CallRefFuture) {
        term = FnSig.output(sig);
      } else if (item_name === sym.Output) {
        const future_output_def_id = tcx.require_lang_item(LangItem.FutureOutput, obligation.cause.span);
        term = Ty.new_projection(tcx, "No", future_output_def_id, [GenericArg.from_Ty(FnSig.output(sig))]);
      } else {
        return bug(`no such associated type: ${Symbol.as_str(item_name)}`);
      }
      let projection_term: AliasTerm;
      if (item_name === sym.CallOnceFuture || item_name === sym.Output) {
        projection_term = AliasTermC.new(tcx, obligation.predicate.kind, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty([...FnSig.inputs(sig)][0]!)]);
      } else if (item_name === sym.CallRefFuture) {
        projection_term = AliasTermC.new(tcx, obligation.predicate.kind, [
          GenericArg.from_Ty(self_ty),
          GenericArg.from_Ty([...FnSig.inputs(sig)][0]!),
          GenericArg.from_Region(env_region),
        ]);
      } else {
        return bug(`no such associated type: ${Symbol.as_str(item_name)}`);
      }

      poly_cache_entry = Binder.rebind(bound_sig, { projection_term, term: Term.from_Ty(term) });
      break;
    }
    default:
      return bug("expected callable type for AsyncFn candidate");
  }

  return confirm_param_env_candidate(selcx, obligation, poly_cache_entry, true).with_addl_obligations(nested);
}

/// Given a `CoroutineClosure(def_id, args)`, interpret it as a closure,
/// and return its output type for the given `goal_kind` and `env_region`.
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1884 coroutine_closure_output_coroutine
function coroutine_closure_output_coroutine(
  tcx: TyCtxt,
  obligation: ProjectionTermObligation,
  goal_kind: ClosureKind,
  env_region: Region,
  def_id: DefId,
  args: CoroutineClosureArgs,
): Ty {
  const kind_ty = CoroutineClosureArgsC.kind_ty(args);
  const sig = Binder.skip_binder(CoroutineClosureArgsC.coroutine_closure_sig(args));

  // If we know the kind and upvars, use that directly.
  // Otherwise, defer to `AsyncFnKindHelper::Upvars` to delay
  // the projection, like the `AsyncFn*` traits do.
  const closure_kind = kind_ty.to_opt_closure_kind();
  if (
    closure_kind !== undefined &&
    // Fall back to projection if upvars aren't constrained
    !CoroutineClosureArgsC.tupled_upvars_ty(args).is_ty_var()
  ) {
    if (!ClosureKind.extends(closure_kind, goal_kind)) {
      return bug("we should not be confirming if the closure kind is not met");
    }
    return CoroutineClosureSignature.to_coroutine_given_kind_and_upvars(
      sig,
      tcx,
      CoroutineClosureArgsC.parent_args(args),
      tcx.coroutine_for_closure(def_id),
      goal_kind,
      env_region,
      CoroutineClosureArgsC.tupled_upvars_ty(args),
      CoroutineClosureArgsC.coroutine_captures_by_ref_ty(args),
    );
  } else {
    const upvars_projection_def_id = tcx.require_lang_item(LangItem.AsyncFnKindUpvars, obligation.cause.span);
    // When we don't know the closure kind (and therefore also the closure's upvars,
    // which are computed at the same time), we must delay the computation of the
    // generator's upvars. We do this using the `AsyncFnKindHelper`, which as a trait
    // goal functions similarly to the old `ClosureKind` predicate, and ensures that
    // the goal kind <= the closure kind. As a projection `AsyncFnKindHelper::Upvars`
    // will project to the right upvars for the generator, appending the inputs and
    // coroutine upvars respecting the closure kind.
    // N.B. No need to register a `AsyncFnKindHelper` goal here, it's already in `nested`.
    const tupled_upvars_ty = Ty.new_projection(tcx, "No", upvars_projection_def_id, [
      GenericArg.from_Ty(kind_ty),
      GenericArg.from_Ty(Ty.from_closure_kind(tcx, goal_kind)),
      GenericArg.from_Region(env_region),
      GenericArg.from_Ty(sig.tupled_inputs_ty),
      GenericArg.from_Ty(CoroutineClosureArgsC.tupled_upvars_ty(args)),
      GenericArg.from_Ty(CoroutineClosureArgsC.coroutine_captures_by_ref_ty(args)),
    ]);
    return CoroutineClosureSignature.to_coroutine(
      sig,
      tcx,
      CoroutineClosureArgsC.parent_args(args),
      Ty.from_closure_kind(tcx, goal_kind),
      tcx.coroutine_for_closure(def_id),
      tupled_upvars_ty,
    );
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1948 confirm_async_fn_kind_helper_candidate
function confirm_async_fn_kind_helper_candidate(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): ProgressT {
  const pargs = obligation.predicate.args;
  if (pargs.length !== 6) {
    return bug();
  }
  const [
    // We already checked that the goal_kind >= closure_kind
    _closure_kind_ty,
    goal_kind_ty,
    borrow_region,
    tupled_inputs_ty,
    tupled_upvars_ty,
    coroutine_captures_by_ref_ty,
  ] = pargs;

  const goal_kind = GenericArg.expect_ty(goal_kind_ty!).to_opt_closure_kind();
  if (goal_kind === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const predicate: ProjectionClause = {
    projection_term: AliasTermC.with_args(obligation.predicate, selcx.tcx(), obligation.predicate.args),
    term: Term.from_Ty(
      CoroutineClosureSignature.tupled_upvars_by_closure_kind(
        selcx.tcx(),
        goal_kind,
        GenericArg.expect_ty(tupled_inputs_ty!),
        GenericArg.expect_ty(tupled_upvars_ty!),
        GenericArg.expect_ty(coroutine_captures_by_ref_ty!),
        GenericArg.expect_region(borrow_region!),
      ),
    ),
  };

  return confirm_param_env_candidate(selcx, obligation, Binder.dummy(predicate, d_ProjectionClause), false).with_addl_obligations(nested);
}

// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:1984 confirm_param_env_candidate
function confirm_param_env_candidate(
  selcx: SelectionContext,
  obligation: ProjectionTermObligation,
  poly_cache_entry: PolyProjectionClause,
  potentially_unnormalized_candidate: boolean,
): ProgressT {
  const { normalize_with_depth_to } = normalize_mod();
  const infcx = selcx.infcx;
  const cause = obligation.cause;
  const param_env = obligation.param_env;

  const cache_entry = infcx.instantiate_binder_with_fresh_vars(cause.span, BoundRegionConversionTime.HigherRankedType, poly_cache_entry, d_ProjectionClause);

  let cache_projection = cache_entry.projection_term;
  const nested_obligations: PredicateObligations = [];
  const obligation_projection_ = obligation.predicate;
  const obligation_projection = normalize_with_depth_to(
    selcx,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    Unnormalized.new_wip(obligation_projection_),
    nested_obligations,
    d_AliasTerm,
  );
  if (potentially_unnormalized_candidate) {
    cache_projection = normalize_with_depth_to(
      selcx,
      obligation.param_env,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      Unnormalized.new_wip(cache_projection),
      nested_obligations,
      d_AliasTerm,
    );
  }

  // debug!(?cache_projection, ?obligation_projection);

  const r = infcx.at(cause, param_env).eq(DefineOpaqueTypes.Yes, cache_projection, obligation_projection, ToTrace_AliasTerm);
  switch (r.$) {
    case "Ok": {
      const obligations = (r._0 as InferOk<null>).obligations;
      nested_obligations.push(...obligations);
      assoc_term_own_obligations(selcx, obligation, nested_obligations);
      return new Progress(Unnormalized.new(cache_entry.term), nested_obligations);
    }
    case "Err": {
      const e = r._0;
      const msg = `Failed to unify obligation \`${debug_Obligation(obligation, PLAIN, debug_AliasTerm)}\` with poly_projection \`${debug_Binder(poly_cache_entry, PLAIN, debug_ProjectionClause)}\`: ${debug_TypeError(e, PLAIN)}`;
      // debug!("confirm_param_env_candidate: {}", msg);
      const err = Ty.new_error_with_message(infcx.tcx, into_MultiSpan(obligation.cause.span), msg);
      return new Progress(Unnormalized.dummy(Term.from_Ty(err)), []);
    }
  }
}

// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:2052 confirm_impl_candidate
function confirm_impl_candidate(
  selcx: SelectionContext,
  obligation: ProjectionTermObligation,
  impl_impl_source: ImplSourceUserDefinedData<PredicateObligation>,
): Result<Projected, ProjectionError> {
  const specialization_graph = require("./specialize/specialization_graph.ts") as typeof import("./specialize/specialization_graph.ts");
  const { translate_args } = require("./specialize/mod.ts") as typeof import("./specialize/mod.ts");
  const tcx = selcx.tcx();

  const { impl_def_id, args: args_, nested } = impl_impl_source;

  const assoc_item_id = AliasTermC.expect_projection_def_id(obligation.predicate);
  const trait_def_id = tcx.impl_trait_id(impl_def_id);

  const param_env = obligation.param_env;
  const ad = specialization_graph.assoc_def(tcx, impl_def_id, assoc_item_id);
  if (ad.$ === "Err") {
    const guar = ad._0;
    return Ok({ $: "Progress", _0: Progress.error_for_term(tcx, obligation.predicate, guar) });
  }
  const assoc_term = ad._0;

  // This means that the impl is missing a definition for the
  // associated type. This is either because the associate item
  // has impossible-to-satisfy clauses (since those were
  // allowed in <https://github.com/rust-lang/rust/pull/135480>),
  // or because the impl is literally missing the definition.
  if (!Defaultness.has_value(AssocItem.defaultness(assoc_term.item, tcx))) {
    // debug!("confirm_impl_candidate: no associated type {:?} for {:?}", assoc_term.item.name(), obligation.predicate);
    if (tcx.impl_self_is_guaranteed_unsized(impl_def_id)) {
      // We treat this projection as rigid here, which is represented via
      // `Projected::NoProgress`. This will ensure that the projection is
      // checked for well-formedness, and it's either satisfied by a trivial
      // where clause in its env or it results in an error.
      return Ok({ $: "NoProgress", _0: AliasTermC.to_term(obligation.predicate, tcx, "No") });
    } else {
      return Ok({
        $: "Progress",
        _0: new Progress(
          Unnormalized.dummy(AliasTermKind.is_type(obligation.predicate.kind) ? Term.from_Ty(Ty.new_misc_error(tcx)) : Term.from_Const(Const.new_misc_error(tcx))),
          nested,
        ),
      });
    }
  }

  // If we're trying to normalize `<Vec<u32> as X>::A<S>` using
  //`impl<T> X for Vec<T> { type A<Y> = Box<Y>; }`, then:
  //
  // * `obligation.predicate.args` is `[Vec<u32>, S]`
  // * `args` is `[u32]`
  // * `args` ends up as `[u32, S]`
  const args1 = obligation.predicate.args.rebase_onto(tcx, trait_def_id, args_);
  const args = translate_args(selcx.infcx, param_env, impl_def_id, args1, assoc_term.defining_node);

  const term_kind: AliasTermKind = AliasTermKind.is_type(obligation.predicate.kind)
    ? { $: "ProjectionTy", def_id: assoc_term.item.def_id }
    : { $: "ProjectionConst", def_id: assoc_term.item.def_id };

  let progress: ProgressT;
  if (!tcx.check_alias_term_args_compatible(term_kind, args)) {
    const msg = "impl item and trait item have different parameters";
    const span = obligation.cause.span;
    const err = AliasTermKind.is_type(obligation.predicate.kind)
      ? Term.from_Ty(Ty.new_error_with_message(tcx, into_MultiSpan(span), msg))
      : Term.from_Const(Const.new_error_with_message(tcx, span, msg));
    progress = new Progress(Unnormalized.dummy(err), nested);
  } else {
    const term: EarlyBinder<Term> = AliasTermKind.is_type(obligation.predicate.kind)
      ? EarlyBinder.map_bound(tcx.type_of(assoc_term.item.def_id) as EarlyBinder<Ty>, (ty) => Term.from_Ty(ty))
      : EarlyBinder.map_bound(const_of_item_or_delayed_bug(tcx, assoc_term.item.def_id), (ct) => Term.from_Const(ct));

    assoc_term_own_obligations(selcx, obligation, nested);
    const instantiated_term = EarlyBinder.instantiate(term, tcx, args, fold_Term);
    const term_for_obligation = Unnormalized.skip_norm_wip(instantiated_term);
    push_const_arg_has_type_obligation(
      tcx,
      nested,
      obligation.cause,
      obligation.recursion_depth + 1,
      obligation.param_env,
      term_for_obligation,
      assoc_term.item.def_id,
      args,
    );
    progress = new Progress(instantiated_term, nested);
  }
  return Ok({ $: "Progress", _0: progress });
}

// Get obligations corresponding to the predicates from the where-clause of the
// associated type itself.
//
// This is necessary for soundness until we properly handle implied bounds on binders.
// see tests/ui/generic-associated-types/must-prove-where-clauses-on-norm.rs.
// FIXME(mgca): While this supports constants, it is only used for types by default right now
// rustc: compiler/rustc_trait_selection/src/traits/project.rs:2160 assoc_term_own_obligations
function assoc_term_own_obligations(selcx: SelectionContext, obligation: ProjectionTermObligation, nested: PredicateObligations): void {
  const { normalize_with_depth_to } = normalize_mod();
  const tcx = selcx.tcx();
  const def_id = AliasTermC.expect_projection_def_id(obligation.predicate);
  const clauses = GenericClauses.instantiate_own(tcx.clauses_of(def_id) as GenericClauses, tcx, obligation.predicate.args);
  for (const [clause, span] of clauses) {
    const normalized = normalize_with_depth_to(selcx, obligation.param_env, clone_ObligationCause(obligation.cause), obligation.recursion_depth + 1, clause, nested, fold_Clause);

    const code = obligation.cause.code_();
    const nested_cause =
      code.$ === "CompareImplItem" || code.$ === "CheckAssociatedTypeBounds" || code.$ === "AscribeUserTypeProvePredicate"
        ? clone_ObligationCause(obligation.cause)
        : ObligationCause.new(obligation.cause.span, obligation.cause.body_def_id, { $: "WhereClause", _0: def_id, _1: span });
    nested.push(Obligation.with_depth(tcx, nested_cause, obligation.recursion_depth + 1, obligation.param_env, normalized, upcast_Clause));
  }
}

// ---- pub(crate) trait ProjectionCacheKeyExt (project.rs:2202), impl for ProjectionCacheKey (project.rs:2209) ------------

/** `pub(crate) trait ProjectionCacheKeyExt<'cx, 'tcx>: Sized` (its one impl is the free fn below). */
export interface ProjectionCacheKeyExt {
  // rustc: compiler/rustc_trait_selection/src/traits/project.rs:2203 from_poly_projection_obligation
  from_poly_projection_obligation(selcx: SelectionContext, obligation: PolyProjectionObligation): ProjectionCacheKey | undefined;
}

// rustc: compiler/rustc_trait_selection/src/traits/project.rs:2210 from_poly_projection_obligation
export function ProjectionCacheKey_from_poly_projection_obligation(
  selcx: SelectionContext,
  obligation: PolyProjectionObligation,
): ProjectionCacheKey | undefined {
  const infcx = selcx.infcx;
  // We don't do cross-snapshot caching of obligations with escaping regions,
  // so there's no cache key to use
  const predicate = Binder.no_bound_vars(obligation.predicate, d_ProjectionClause);
  if (predicate === undefined) return undefined;
  return ProjectionCacheKey.new(
    // We don't attempt to match up with a specific type-variable state
    // from a specific call to `opt_normalize_projection_type` - if
    // there's no precise match, the original cache entry is "stranded"
    // anyway.
    infcx.deeply_resolve_ignoring_regions(predicate.projection_term, d_AliasTerm),
    obligation.param_env,
  );
}

