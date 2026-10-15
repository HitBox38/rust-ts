// Port of compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs (lane old-candidates-confirm, wave 18c).
//
// The candidate assembly methods of `SelectionContext` (candidate_assembly.rs:29 `impl<'cx, 'tcx> SelectionContext<'cx, 'tcx>`)
// are assigned onto `SelectionContext.prototype` in upstream order; their signatures are declared in ../../decls.ts
// (`declare module "./traits/select/mod.gen.ts"`).
//
// PORT (file-wide):
// - `#[instrument]`, `debug!`, `trace!` (tracing) produce no output in the oracle: dropped / kept as comments.
//   `debug_assert!` is a comment (release oracle).
// - `candidates: &mut SelectionCandidateSet` is the (mutable) object itself; the push order into `candidates.vec` is
//   upstream's exactly (it decides winnowing and diagnostics).
// - `infcx.probe(|_| ..)` takes a closure that ignores the snapshot argument.
// - `FxHashSet<TraitRef>` (a struct, not interned) is a `KeyedSet` on `intern_key`; `FxIndexSet<DefId>` is a `DefIdSet`.
// - `?` on a `Result<_, OverflowError>` inside a fn returning `SelectionError` converts with `SelectionError.from`
//   (`impl From<OverflowError> for SelectionError`).
//
// Init order: top-level code here touches only ./mod.gen.ts and other crates; other rustc_trait_selection modules are
// read inside function bodies only (lazy `require`). ../../lib.ts imports this file after ./mod.ts.

//! Candidate assembly.
//!
//! The selection process begins by examining all in-scope impls,
//! caller obligations, and so forth and assembling a list of
//! candidates. See the [rustc dev guide] for more details.
//!
//! [rustc dev guide]:https://rustc-dev-guide.rust-lang.org/traits/resolution.html#candidate-assembly

import { ControlFlow, type ControlFlow as ControlFlowT, VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../../rust_ts/keyed.ts";
import { type CoroutineKind, Defaultness, Safety } from "../../../rustc_hir/hir.ts";
import { Obligation, type PolyTraitObligation } from "../../../rustc_infer/traits/mod.ts";
import type { CodegenFnAttrs } from "../../../rustc_middle/middle/codegen_fn_attrs.ts";
import { clone_ObligationCause, SelectionError } from "../../../rustc_middle/traits/mod.ts";
import type { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import type { TraitDef } from "../../../rustc_middle/ty/trait_def.ts";
import type { Predicate } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, DefIdSet } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { supertrait_def_ids, supertraits } from "../../../rustc_type_ir/elaborate.ts";
import { DeepRejectCtxt } from "../../../rustc_type_ir/fast_reject.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { ClosureKind } from "../../../rustc_type_ir/lib.ts";
import {
  as_interner,
  fold_with_TraitClause,
  PolyExistentialTraitRef,
  PolyTraitClause,
  PolyTraitRef,
  type TraitClause,
  TraitClause as TraitClauseC,
  TraitRef,
  try_fold_with_TraitClause,
  visit_with_TraitClause,
} from "../../../rustc_type_ir/predicate.ts";
import type { SizedTraitKind } from "../../../rustc_type_ir/solve/mod.ts";
import type { FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { PolyFnSig, PolyFnSigTys } from "../../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { unwrap } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import { EvaluationResult, type OverflowError, type SelectionCandidate, SelectionCandidate as SC } from "../../../rustc_middle/traits/select.ts";
import { type SelectionCandidateSet, SelectionContext, type TraitObligationStack } from "./mod.gen.ts";

/** The derived `TypeFoldable` of `TraitClause` (rustc_type_ir predicate.rs) as a D4 descriptor. */
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};
/** `Binder<TraitClause>` (`PolyTraitClause`). */
const d_PolyTraitClause = (): TypeFoldable<Binder<TraitClause>> => fold_Binder(d_TraitClause);

/** `crate::traits::util` (read lazily: init order). */
function util(): typeof import("../util.ts") {
  return require("../util.ts") as typeof import("../util.ts");
}


// ---- impl<'cx, 'tcx> SelectionContext<'cx, 'tcx> (candidate_assembly.rs:29) -----------------------------------------

// #[instrument(skip(self, stack), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:31 assemble_candidates
SelectionContext.prototype.assemble_candidates = function (
  this: SelectionContext,
  stack: TraitObligationStack,
): Result<SelectionCandidateSet, SelectionError> {
  const obligation_ = stack.obligation;
  const obligation: PolyTraitObligation = new Obligation(
    clone_ObligationCause(obligation_.cause),
    obligation_.param_env,
    this.infcx.deeply_resolve_ignoring_regions(obligation_.predicate, d_PolyTraitClause()),
    obligation_.recursion_depth,
  );

  if (TraitClauseC.self_ty(Binder.skip_binder(obligation.predicate)).is_ty_var()) {
    // debug!(ty = ?obligation.predicate.skip_binder().self_ty(), "ambiguous inference var or opaque type");
    // Self is a type variable (e.g., `_: AsRef<str>`).
    //
    // This is somewhat problematic, as the current scheme can't really
    // handle it turning to be a projection. This does end up as truly
    // ambiguous in most cases anyway.
    //
    // Take the fast path out - this also improves
    // performance by preventing assemble_candidates_from_impls from
    // matching every impl for this trait.
    return Ok({ vec: [], ambiguous: true });
  }

  const candidates: SelectionCandidateSet = { vec: [], ambiguous: false };

  // Negative trait predicates have different rules than positive trait predicates.
  if (obligation.polarity() === "Negative") {
    this.assemble_candidates_for_trait_alias(obligation, candidates);
    this.assemble_candidates_from_impls(obligation, candidates);
    const r = this.assemble_candidates_from_caller_bounds(stack, candidates);
    if (r.$ === "Err") return r;
  } else {
    this.assemble_candidates_for_trait_alias(obligation, candidates);

    // Other bounds. Consider both in-scope bounds from fn decl
    // and applicable impls. There is a certain set of precedence rules here.
    const def_id = PolyTraitClause.def_id(obligation.predicate);
    const tcx = this.tcx();

    const lang_item = tcx.as_lang_item(def_id);
    switch (lang_item) {
      case LangItem.Copy:
      case LangItem.Clone:
      case LangItem.TrivialClone: {
        // debug!(obligation_self_ty = ?obligation.predicate.skip_binder().self_ty());

        // User-defined copy impls are permitted, but only for
        // structs and enums.
        this.assemble_candidates_from_impls(obligation, candidates);

        // For other types, we'll use the builtin rules.
        this.assemble_builtin_copy_clone_candidate(Binder.skip_binder(PolyTraitClause.self_ty(obligation.predicate)), candidates);
        break;
      }
      case LangItem.DiscriminantKind: {
        // `DiscriminantKind` is automatically implemented for every type.
        candidates.vec.push(SC.BuiltinCandidate);
        break;
      }
      case LangItem.PointeeTrait: {
        // `Pointee` is automatically implemented for every type.
        candidates.vec.push(SC.BuiltinCandidate);
        break;
      }
      case LangItem.Sized: {
        this.assemble_builtin_sized_candidate(Binder.skip_binder(PolyTraitClause.self_ty(obligation.predicate)), candidates, "Sized");
        break;
      }
      case LangItem.MetaSized: {
        this.assemble_builtin_sized_candidate(Binder.skip_binder(PolyTraitClause.self_ty(obligation.predicate)), candidates, "MetaSized");
        break;
      }
      case LangItem.PointeeSized: {
        return bug("`PointeeSized` is removed during lowering");
      }
      case LangItem.Unsize: {
        this.assemble_candidates_for_unsizing(obligation, candidates);
        break;
      }
      case LangItem.Destruct: {
        this.assemble_const_destruct_candidates(obligation, candidates);
        break;
      }
      case LangItem.TransmuteTrait: {
        // User-defined transmutability impls are permitted.
        this.assemble_candidates_from_impls(obligation, candidates);
        this.assemble_candidates_for_transmutability(obligation, candidates);
        break;
      }
      case LangItem.Tuple: {
        this.assemble_candidate_for_tuple(obligation, candidates);
        break;
      }
      case LangItem.FnPtrTrait: {
        this.assemble_candidates_for_fn_ptr_trait(obligation, candidates);
        break;
      }
      case LangItem.BikeshedGuaranteedNoDrop: {
        this.assemble_candidates_for_bikeshed_guaranteed_no_drop_trait(obligation, candidates);
        break;
      }
      case LangItem.TryAsDyn: {
        this.assemble_candidates_for_try_as_dyn(obligation, candidates);
        break;
      }
      case LangItem.Field: {
        this.assemble_candidates_for_field_trait(obligation, candidates);
        break;
      }
      default: {
        // We re-match here for traits that can have both builtin impls and user written impls.
        // After the builtin impls we need to also add user written impls, which we do not want to
        // do in general because just checking if there are any is expensive.
        switch (lang_item) {
          case LangItem.Coroutine:
            this.assemble_coroutine_candidates(obligation, candidates);
            break;
          case LangItem.Future:
            this.assemble_future_candidates(obligation, candidates);
            break;
          case LangItem.Iterator:
            this.assemble_iterator_candidates(obligation, candidates);
            break;
          case LangItem.FusedIterator:
            this.assemble_fused_iterator_candidates(obligation, candidates);
            break;
          case LangItem.AsyncIterator:
            this.assemble_async_iterator_candidates(obligation, candidates);
            break;
          case LangItem.AsyncFnKindHelper:
            this.assemble_async_fn_kind_helper_candidates(obligation, candidates);
            break;
          case LangItem.AsyncFn:
          case LangItem.AsyncFnMut:
          case LangItem.AsyncFnOnce:
            this.assemble_async_closure_candidates(obligation, candidates);
            break;
          case LangItem.Fn:
          case LangItem.FnMut:
          case LangItem.FnOnce:
            this.assemble_closure_candidates(obligation, candidates);
            this.assemble_fn_pointer_candidates(obligation, candidates);
            break;
          default:
            break;
        }

        this.assemble_candidates_from_impls(obligation, candidates);
        this.assemble_candidates_from_object_ty(obligation, candidates);
        break;
      }
    }

    this.assemble_candidates_from_projected_tys(obligation, candidates);
    const r = this.assemble_candidates_from_caller_bounds(stack, candidates);
    if (r.$ === "Err") return r;
    this.assemble_candidates_from_auto_impls(obligation, candidates);
  }
  // debug!("candidate list size: {}", candidates.vec.len());
  return Ok(candidates);
};

// #[instrument(level = "debug", skip(self, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:191 assemble_candidates_from_projected_tys
SelectionContext.prototype.assemble_candidates_from_projected_tys = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // Before we go into the whole placeholder thing, just
  // quickly check if the self-type is a projection at all.
  const k = TraitRef.self_ty(Binder.skip_binder(obligation.predicate).trait_ref).kind();
  if (k.$ === "Alias" && (k._1.kind.$ === "Projection" || k._1.kind.$ === "Opaque")) {
    // Excluding IATs and type aliases here as they don't have meaningful item bounds.
  } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
    return span_bug(obligation.cause.span, "Self=_ should have been handled by assemble_candidates");
  } else {
    return;
  }

  this.infcx.probe((_) => {
    const poly_trait_predicate = this.infcx.deeply_resolve_ignoring_regions(obligation.predicate, d_PolyTraitClause());
    const placeholder_trait_predicate = this.infcx.enter_forall_and_leak_universe(poly_trait_predicate, d_TraitClause);

    // The bounds returned by `item_bounds` may contain duplicates after
    // normalization, so try to deduplicate when possible to avoid
    // unnecessary ambiguity.
    const distinct_normalized_bounds = new KeyedSet<TraitRef>(intern_key);
    void this.for_each_item_bound<never>(
      TraitClauseC.self_ty(placeholder_trait_predicate),
      (selcx, bound_, idx, alias_bound_kind): ControlFlowT<never, null> => {
        const bound__ = bound_.as_trait_clause();
        if (bound__ === undefined) {
          return ControlFlow.Continue(null);
        }
        if (PolyTraitClause.polarity(bound__) !== placeholder_trait_predicate.polarity) {
          return ControlFlow.Continue(null);
        }

        selcx.infcx.probe((_) => {
          const bound = util().lazily_elaborate_sizedness_candidate(selcx.infcx, obligation, bound__);

          // We checked the polarity already
          const r = selcx.match_normalize_trait_ref(
            obligation,
            placeholder_trait_predicate.trait_ref,
            Binder.map_bound(bound, (pred) => pred.trait_ref),
          );
          if (r.$ === "Ok" && r._0 === undefined) {
            candidates.vec.push({ $: "ProjectionCandidate", idx, kind: alias_bound_kind });
          } else if (r.$ === "Ok" && r._0 !== undefined && hash_set_insert(distinct_normalized_bounds, r._0)) {
            candidates.vec.push({ $: "ProjectionCandidate", idx, kind: alias_bound_kind });
          } else {
            // _ => {}
          }
        });

        return ControlFlow.Continue(null);
      },
      // On ambiguity.
      () => {
        candidates.ambiguous = true;
      },
    );
  });
};

/** `FxHashSet::insert`: `true` if the value was not present. */
function hash_set_insert<T>(set: Set<T>, value: T): boolean {
  if (set.has(value)) return false;
  set.add(value);
  return true;
}

/// Given an obligation like `<SomeTrait for T>`, searches the obligations that the caller
/// supplied to find out whether it is listed among them.
///
/// Never affects the inference environment.
// #[instrument(level = "debug", skip(self, stack, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:272 assemble_candidates_from_caller_bounds
SelectionContext.prototype.assemble_candidates_from_caller_bounds = function (
  this: SelectionContext,
  stack: TraitObligationStack,
  candidates: SelectionCandidateSet,
): Result<null, SelectionError> {
  // debug!(?stack.obligation);

  const obligation_polarity = PolyTraitClause.polarity(stack.obligation.predicate);
  const bounds = (function* () {
    for (const c of stack.obligation.param_env.caller_bounds()) {
      const p = c.as_trait_clause();
      if (p === undefined) continue;
      // Micro-optimization: filter out predicates with different polarities.
      if (PolyTraitClause.polarity(p) !== obligation_polarity) continue;
      yield p;
    }
  })();

  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(this.tcx()));
  const obligation_args = Binder.skip_binder(stack.obligation.predicate).trait_ref.args;
  // Keep only those bounds which may apply, and propagate overflow if it occurs.
  for (const bound_ of bounds) {
    const bound = util().lazily_elaborate_sizedness_candidate(this.infcx, stack.obligation, bound_);

    // Micro-optimization: filter out predicates relating to different traits.
    if (!DefId_eq(PolyTraitClause.def_id(bound), PolyTraitClause.def_id(stack.obligation.predicate))) {
      continue;
    }

    const bound_trait_ref = Binder.map_bound(bound, (t) => t.trait_ref);
    if (!drcx.args_may_unify(obligation_args, Binder.skip_binder(bound_trait_ref).args)) {
      continue;
    }
    const wc = this.where_clause_may_apply(stack, bound_trait_ref);
    if (wc.$ === "Err") return { $: "Err", _0: SelectionError.from(wc._0) };
    if (EvaluationResult.may_apply(wc._0)) {
      candidates.vec.push({ $: "ParamCandidate", _0: bound });
    }
  }

  return Ok(null);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:312 assemble_coroutine_candidates
SelectionContext.prototype.assemble_coroutine_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // Okay to skip binder because the args on coroutine types never
  // touch bound regions, they just capture the in-scope
  // type/region parameters.
  const self_ty = Binder.skip_binder(obligation.self_ty());
  const k = self_ty.kind();
  // `async`/`gen` constructs get lowered to a special kind of coroutine that
  // should *not* `impl Coroutine`.
  if (k.$ === "Coroutine" && this.tcx().is_general_coroutine(k._0)) {
    // debug!(?self_ty, ?obligation, "assemble_coroutine_candidates");

    candidates.vec.push(SC.CoroutineCandidate);
  } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
    // debug!("assemble_coroutine_candidates: ambiguous self-type");
    candidates.ambiguous = true;
  } else {
    // _ => {}
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:337 assemble_future_candidates
SelectionContext.prototype.assemble_future_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const self_ty = Binder.skip_binder(obligation.self_ty());
  const k = self_ty.kind();
  if (k.$ === "Coroutine") {
    const did = k._0;
    // async constructs get lowered to a special kind of coroutine that
    // should directly `impl Future`.
    if (this.tcx().coroutine_is_async(did)) {
      // debug!(?self_ty, ?obligation, "assemble_future_candidates");

      candidates.vec.push(SC.FutureCandidate);
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:354 assemble_iterator_candidates
SelectionContext.prototype.assemble_iterator_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const self_ty = Binder.skip_binder(obligation.self_ty());
  // gen constructs get lowered to a special kind of coroutine that
  // should directly `impl Iterator`.
  const k = self_ty.kind();
  if (k.$ === "Coroutine" && this.tcx().coroutine_is_gen(k._0)) {
    // debug!(?self_ty, ?obligation, "assemble_iterator_candidates");

    candidates.vec.push(SC.IteratorCandidate);
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:371 assemble_fused_iterator_candidates
SelectionContext.prototype.assemble_fused_iterator_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  if (this.coroutine_is_gen(Binder.skip_binder(obligation.self_ty()))) {
    candidates.vec.push(SC.BuiltinCandidate);
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:381 assemble_async_iterator_candidates
SelectionContext.prototype.assemble_async_iterator_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const self_ty = Binder.skip_binder(obligation.self_ty());
  const k = self_ty.kind();
  if (k.$ === "Coroutine") {
    const did = k._0;
    const args = k._1;
    // gen constructs get lowered to a special kind of coroutine that
    // should directly `impl AsyncIterator`.
    if (this.tcx().coroutine_is_async_gen(did)) {
      // debug!(?self_ty, ?obligation, "assemble_iterator_candidates");

      // Can only confirm this candidate if we have constrained
      // the `Yield` type to at least `Poll<Option<?0>>`..
      const yk = CoroutineArgs.yield_ty(args.as_coroutine()).kind();
      if (yk.$ !== "Adt") {
        candidates.ambiguous = true;
        return;
      }
      const args_ = yk._1;
      if (args_.type_at(0).kind().$ !== "Adt") {
        candidates.ambiguous = true;
        return;
      }

      candidates.vec.push(SC.AsyncIteratorCandidate);
    }
  }
};

/// Checks for the artificial impl that the compiler will create for an obligation like `X :
/// FnMut<..>` where `X` is a closure type.
///
/// Note: the type parameters on a closure candidate are modeled as *output* type
/// parameters and hence do not affect whether this trait is a match or not. They will be
/// unified during the confirmation step.
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:415 assemble_closure_candidates
SelectionContext.prototype.assemble_closure_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const kind = unwrap(this.tcx().fn_trait_kind_from_def_id(PolyTraitClause.def_id(obligation.predicate)));

  // Okay to skip binder because the args on closure types never
  // touch bound regions, they just capture the in-scope
  // type/region parameters
  const self_ty = Binder.skip_binder(obligation.self_ty());
  const k = self_ty.kind();
  switch (k.$) {
    case "Closure": {
      const def_id = k._0;
      const is_const = this.tcx().is_const_fn(def_id);
      // debug!(?kind, ?obligation, "assemble_unboxed_candidates");
      const closure_kind = this.infcx.closure_kind(self_ty);
      if (closure_kind !== undefined) {
        // debug!(?closure_kind, "assemble_unboxed_candidates");
        if (ClosureKind.extends(closure_kind, kind)) {
          candidates.vec.push({ $: "ClosureCandidate", is_const });
        }
      } else {
        if (kind === "FnOnce") {
          candidates.vec.push({ $: "ClosureCandidate", is_const });
        } else {
          candidates.ambiguous = true;
        }
      }
      break;
    }
    case "CoroutineClosure": {
      const def_id = k._0;
      const args = k._1.as_coroutine_closure();
      const is_const = this.tcx().is_const_fn(def_id);
      let closure_kind: ClosureKind | undefined;
      if (
        (closure_kind = this.infcx.closure_kind(self_ty)) !== undefined &&
        // Ambiguity if upvars haven't been constrained yet
        !CoroutineClosureArgs.tupled_upvars_ty(args).is_ty_var()
      ) {
        // A coroutine-closure implements `FnOnce` *always*, since it may
        // always be called once. It additionally implements `Fn`/`FnMut`
        // only if it has no upvars referencing the closure-env lifetime,
        // and if the closure kind permits it.
        if (ClosureKind.extends(closure_kind, kind) && !CoroutineClosureArgs.has_self_borrows(args)) {
          candidates.vec.push({ $: "ClosureCandidate", is_const });
        } else if (kind === "FnOnce") {
          candidates.vec.push({ $: "ClosureCandidate", is_const });
        }
      } else if (kind === "FnOnce") {
        candidates.vec.push({ $: "ClosureCandidate", is_const });
      } else {
        // This stays ambiguous until kind+upvars are determined.
        candidates.ambiguous = true;
      }
      break;
    }
    case "Infer": {
      if (k._0.$ === "TyVar") {
        // debug!("assemble_unboxed_closure_candidates: ambiguous self-type");
        candidates.ambiguous = true;
      }
      break;
    }
    default:
      break;
  }
};

// #[instrument(level = "debug", skip(self, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:478 assemble_async_closure_candidates
SelectionContext.prototype.assemble_async_closure_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const goal_kind = unwrap(this.tcx().async_fn_trait_kind_from_def_id(PolyTraitClause.def_id(obligation.predicate)));

  // debug!("self_ty = {:?}", obligation.self_ty().skip_binder().kind());
  const k = Binder.skip_binder(obligation.self_ty()).kind();
  switch (k.$) {
    case "CoroutineClosure": {
      const def_id = k._0;
      const args = k._1;
      let closure_kind: ClosureKind | undefined;
      if (
        (closure_kind = CoroutineClosureArgs.kind_ty(args.as_coroutine_closure()).to_opt_closure_kind()) !== undefined &&
        !ClosureKind.extends(closure_kind, goal_kind)
      ) {
        return;
      }

      // Make sure this is actually an async closure.
      const coroutine_kind = this.tcx().coroutine_kind(this.tcx().coroutine_for_closure(def_id)) as CoroutineKind | undefined;
      if (coroutine_kind === undefined) {
        return bug("coroutine with no kind");
      }

      // debug!(?coroutine_kind);
      if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
        candidates.vec.push(SC.AsyncClosureCandidate);
      } else {
        // _ => (),
      }
      break;
    }
    // Closures and fn pointers implement `AsyncFn*` if their return types
    // implement `Future`, which is checked later.
    case "Closure": {
      const args = k._1;
      let closure_kind: ClosureKind | undefined;
      if ((closure_kind = ClosureArgs.kind_ty(args.as_closure()).to_opt_closure_kind()) !== undefined && !ClosureKind.extends(closure_kind, goal_kind)) {
        return;
      }
      candidates.vec.push(SC.AsyncClosureCandidate);
      break;
    }
    // Provide an impl, but only for suitable `fn` pointers.
    case "FnPtr": {
      const sig_tys = k._0;
      const hdr = k._1;
      if (PolyFnSig.is_fn_trait_compatible(PolyFnSigTys.with(sig_tys, hdr))) {
        candidates.vec.push(SC.AsyncClosureCandidate);
      }
      break;
    }
    // Provide an impl for suitable functions, rejecting `#[target_feature]` functions (RFC 2396).
    case "FnDef": {
      const def_id = k._0;
      const tcx = this.tcx();
      if (
        PolyFnSig.is_fn_trait_compatible(EarlyBinder.skip_binder(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>)) &&
        (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).target_features.length === 0
      ) {
        candidates.vec.push(SC.AsyncClosureCandidate);
      }
      break;
    }
    default:
      break;
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:540 assemble_async_fn_kind_helper_candidates
SelectionContext.prototype.assemble_async_fn_kind_helper_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const self_ty = Binder.skip_binder(obligation.self_ty());
  const target_kind_ty = Binder.skip_binder(obligation.predicate).trait_ref.args.type_at(1);

  // `to_opt_closure_kind` is kind of ICEy when it sees non-int types.
  if (!(self_ty.is_integral() || self_ty.is_ty_var())) {
    return;
  }
  if (!(target_kind_ty.is_integral() || self_ty.is_ty_var())) {
    return;
  }

  // Check that the self kind extends the goal kind. If it does,
  // then there's nothing else to check.
  let closure_kind: ClosureKind | undefined;
  let goal_kind: ClosureKind | undefined;
  if (
    (closure_kind = self_ty.to_opt_closure_kind()) !== undefined &&
    (goal_kind = target_kind_ty.to_opt_closure_kind()) !== undefined &&
    ClosureKind.extends(closure_kind, goal_kind)
  ) {
    candidates.vec.push(SC.AsyncFnKindHelperCandidate);
  }
};

/// Implements one of the `Fn()` family for a fn pointer.
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:567 assemble_fn_pointer_candidates
SelectionContext.prototype.assemble_fn_pointer_candidates = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // Keep this function in sync with extract_tupled_inputs_and_output_from_callable
  // until the old solver (and thus this function) is removed.

  // Okay to skip binder because what we are inspecting doesn't involve bound regions.
  const self_ty = Binder.skip_binder(obligation.self_ty());
  const k = self_ty.kind();
  switch (k.$) {
    case "Infer": {
      if (k._0.$ === "TyVar") {
        // debug!("assemble_fn_pointer_candidates: ambiguous self-type");
        candidates.ambiguous = true; // Could wind up being a fn() type.
      }
      break;
    }
    // Provide an impl, but only for suitable `fn` pointers.
    case "FnPtr": {
      const sig_tys = k._0;
      const hdr = k._1;
      if (PolyFnSig.is_fn_trait_compatible(PolyFnSigTys.with(sig_tys, hdr))) {
        candidates.vec.push(SC.FnPointerCandidate);
      }
      break;
    }
    // Provide an impl for suitable functions, rejecting `#[target_feature]` functions (RFC 2396).
    case "FnDef": {
      const def_id = k._0;
      const tcx = this.tcx();
      if (
        PolyFnSig.is_fn_trait_compatible(EarlyBinder.skip_binder(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>)) &&
        (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).target_features.length === 0
      ) {
        candidates.vec.push(SC.FnPointerCandidate);
      }
      break;
    }
    default:
      break;
  }
};

/// Searches for impls that might apply to `obligation`.
// #[instrument(level = "debug", skip(self, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:603 assemble_candidates_from_impls
SelectionContext.prototype.assemble_candidates_from_impls = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const drcx = DeepRejectCtxt.relate_rigid_infer(as_interner(this.tcx()));
  const obligation_args = Binder.skip_binder(obligation.predicate).trait_ref.args;
  this.tcx().for_each_relevant_impl(
    PolyTraitClause.def_id(obligation.predicate),
    TraitRef.self_ty(Binder.skip_binder(obligation.predicate).trait_ref),
    (impl_def_id) => {
      // Before we create the generic parameters and everything, first
      // consider a "quick reject". This avoids creating more types
      // and so forth that we need to.
      const impl_trait_header = this.tcx().impl_trait_header(impl_def_id) as import("../../../rustc_middle/ty/mod.ts").ImplTraitHeader;
      if (!drcx.args_may_unify(obligation_args, EarlyBinder.skip_binder(impl_trait_header.trait_ref).args)) {
        return;
      }

      // For every `default impl`, there's always a non-default `impl`
      // that will *also* apply. There's no reason to register a candidate
      // for this impl, since it is *not* proof that the trait goal holds.
      if (Defaultness.is_default(this.tcx().defaultness(impl_def_id) as Defaultness)) {
        return;
      }

      if (this.reject_fn_ptr_impls(impl_def_id, obligation, TraitRef.self_ty(EarlyBinder.skip_binder(impl_trait_header.trait_ref)))) {
        return;
      }

      this.infcx.probe((_) => {
        if (this.match_impl(impl_def_id, impl_trait_header, obligation).$ === "Ok") {
          candidates.vec.push({ $: "ImplCandidate", _0: impl_def_id });
        }
      });
    },
    VisitorResult.unit,
  );
};

/// The various `impl<T: FnPtr> Trait for T` in libcore are more like builtin impls for all function items
/// and function pointers and less like blanket impls. Rejecting them when they can't possibly apply (because
/// the obligation's self-type does not implement `FnPtr`) avoids reporting that the self type does not implement
/// `FnPtr`, when we wanted to report that it doesn't implement `Trait`.
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:653 reject_fn_ptr_impls
SelectionContext.prototype.reject_fn_ptr_impls = function (
  this: SelectionContext,
  impl_def_id: DefId,
  obligation: PolyTraitObligation,
  impl_self_ty: Ty,
): boolean {
  // Let `impl<T: FnPtr> Trait for Vec<T>` go through the normal rejection path.
  if (!(impl_self_ty.kind().$ === "Param")) {
    return false;
  }
  const fn_ptr_trait = this.tcx().lang_items().fn_ptr_trait();
  if (fn_ptr_trait === undefined) {
    return false;
  }

  for (const [clause] of (this.tcx().clauses_of(impl_def_id) as GenericClauses).clauses) {
    const ck = Binder.skip_binder(clause.kind());
    if (ck.$ !== "Trait") continue;
    const pred = ck._0;
    if (!DefId_eq(fn_ptr_trait, pred.trait_ref.def_id)) {
      continue;
    }
    // trace!(?pred);
    // Not the bound we're looking for
    if (TraitClauseC.self_ty(pred) !== impl_self_ty) {
      continue;
    }

    const self_ty = Binder.skip_binder(obligation.self_ty());
    switch (self_ty.kind().$) {
      // Fast path to avoid evaluating an obligation that trivially holds.
      // There may be more bounds, but these are checked by the regular path.
      case "FnPtr":
        return false;

      // These may potentially implement `FnPtr`
      case "Placeholder":
      case "Dynamic":
      case "Alias":
      case "Infer":
      case "Param":
      case "Bound":
        break;

      // These can't possibly implement `FnPtr` as they are concrete types
      // and not `FnPtr`
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
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "UnsafeBinder":
      case "Never":
      case "Tuple":
      case "Error":
        return true;
      // FIXME: Function definitions could actually implement `FnPtr` by
      // casting the ZST function def to a function pointer.
      case "FnDef":
        return true;
    }

    // Generic params can implement `FnPtr` if the predicate
    // holds within its own environment.
    const tcx = this.tcx();
    const obligation_ = Obligation.new(
      tcx,
      clone_ObligationCause(obligation.cause),
      obligation.param_env,
      tcx.mk_predicate(
        Binder.map_bound(obligation.predicate, (pred_) => {
          const pred: TraitClause = {
            ...pred_,
            trait_ref: TraitRef.new(as_interner(tcx), fn_ptr_trait, [GenericArg.from_Ty(TraitRef.self_ty(pred_.trait_ref))]),
          };
          return { $: "Clause", _0: { $: "Trait", _0: pred } } as import("../../../rustc_middle/ty/predicate.gen.ts").PredicateKind;
        }),
      ),
      upcast_identity_Predicate,
    );
    const r = this.evaluate_root_obligation(obligation_);
    if (r.$ === "Ok") {
      if (!EvaluationResult.may_apply(r._0)) {
        return true;
      }
    }
  }
  return false;
};

/** `impl<T> Upcast<I, T> for T` at `Predicate`. */
function upcast_identity_Predicate(from: Predicate, _tcx: Interner): Predicate {
  return from;
}

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:741 assemble_candidates_from_auto_impls
SelectionContext.prototype.assemble_candidates_from_auto_impls = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // Okay to skip binder here because the tests we do below do not involve bound regions.
  const self_ty = Binder.skip_binder(obligation.self_ty());
  // debug!(?self_ty, "assemble_candidates_from_auto_impls");

  const def_id = PolyTraitClause.def_id(obligation.predicate);

  const check_impls = (): void => {
    // Only consider auto impls if there are no manual impls for the root of `self_ty`.
    //
    // For example, we only consider auto candidates for `&i32: Auto` if no explicit impl
    // for `&SomeType: Auto` exists. Due to E0321 the only crate where impls
    // for `&SomeType: Auto` can be defined is the crate where `Auto` has been defined.
    //
    // Generally, we have to guarantee that for all `SimplifiedType`s the only crate
    // which may define impls for that type is either the crate defining the type
    // or the trait. This should be guaranteed by the orphan check.
    let has_impl = false;
    this.tcx().for_each_relevant_impl(
      def_id,
      self_ty,
      (_) => {
        has_impl = true;
      },
      VisitorResult.unit,
    );
    if (!has_impl) {
      candidates.vec.push(SC.AutoImplCandidate);
    }
  };

  if (this.tcx().trait_is_auto(def_id)) {
    const k = self_ty.kind();
    switch (k.$) {
      case "Dynamic":
        // For object types, we don't know what the closed
        // over types are. This means we conservatively
        // say nothing; a candidate may be added by
        // `assemble_candidates_from_object_ty`.
        break;
      case "Foreign":
        // Since the contents of foreign types is unknown,
        // we don't add any `..` impl. Default traits could
        // still be provided by a manual implementation for
        // this trait and type.

        // Backward compatibility for default auto traits.
        // Test: ui/traits/default_auto_traits/extern-types.rs
        if (this.tcx().is_default_trait(def_id)) {
          check_impls();
        }
        break;
      case "Param":
      case "Placeholder":
      case "Bound":
        // In these cases, we don't know what the actual
        // type is. Therefore, we cannot break it down
        // into its constituent types. So we don't
        // consider the `..` impl but instead just add no
        // candidates: this means that typeck will only
        // succeed if there is another reason to believe
        // that this obligation holds. That could be a
        // where-clause or, in the case of an object type,
        // it could be that the object type lists the
        // trait (e.g., `Foo+Send : Send`). See
        // `ui/typeck/typeck-default-trait-impl-send-param.rs`
        // for an example of a test case that exercises
        // this path.
        break;
      case "Alias": {
        const ak = k._1.kind;
        if (ak.$ === "Projection" || ak.$ === "Inherent" || ak.$ === "Free") {
          // (same as the `ty::Param(..) | ...` arm above)
        } else {
          // ty::Alias(_, ty::AliasTy { kind: ty::Opaque { def_id }, .. })
          const def_id_ = ak.def_id;
          // debug_assert!(!self.typing_mode().is_coherence(), "old solver coherence");

          if (candidates.vec.some((c) => c.$ === "ProjectionCandidate")) {
            // We do not generate an auto impl candidate for `impl Trait`s which already
            // reference our auto trait.
            //
            // For example during candidate assembly for `impl Send: Send`, we don't have
            // to look at the constituent types for this opaque types to figure out that this
            // trivially holds.
            //
            // Note that this is only sound as projection candidates of opaque types
            // are always applicable for auto traits.
          } else if (this.infcx.can_define_opaque_ty(def_id_)) {
            // We do not emit auto trait candidates for opaque types in their defining scope, as
            // we need to know the hidden type first, which we can't reliably know within the defining
            // scope.
            candidates.ambiguous = true;
          } else {
            candidates.vec.push(SC.AutoImplCandidate);
          }
        }
        break;
      }
      case "Infer": {
        const ik = k._0;
        if (ik.$ === "TyVar" || ik.$ === "IntVar" || ik.$ === "FloatVar") {
          // The auto impl might apply; we don't know.
          candidates.ambiguous = true;
        } else {
          // ty::Infer(ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
          return bug(`asked to assemble auto trait candidates of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
        }
        break;
      }
      case "Coroutine": {
        const coroutine_def_id = k._0;
        if (this.tcx().is_lang_item(def_id, LangItem.Unpin)) {
          switch (this.tcx().coroutine_movability(coroutine_def_id)) {
            case "Static":
              // Immovable coroutines are never `Unpin`, so
              // suppress the normal auto-impl candidate for it.
              break;
            case "Movable":
              // Movable coroutines are always `Unpin`, so add an
              // unconditional builtin candidate with no sub-obligations.
              candidates.vec.push(SC.BuiltinCandidate);
              break;
          }
        } else {
          if (this.should_stall_coroutine(coroutine_def_id)) {
            candidates.ambiguous = true;
          } else {
            // Coroutines implement all other auto traits normally.
            candidates.vec.push(SC.AutoImplCandidate);
          }
        }
        break;
      }

      case "CoroutineWitness":
        candidates.vec.push(SC.AutoImplCandidate);
        break;

      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Array":
      case "Pat":
      case "Slice":
      case "Adt":
      case "RawPtr":
      case "Ref":
      case "FnDef":
      case "FnPtr":
      case "Closure":
      case "CoroutineClosure":
      case "Never":
      case "Tuple":
      case "UnsafeBinder": {
        // Only consider auto impls of unsafe traits when there are
        // no unsafe fields.
        if (Safety.is_unsafe((this.tcx().trait_def(def_id) as TraitDef).safety) && self_ty.has_unsafe_fields()) {
          return;
        }

        check_impls();
        break;
      }
      case "Error":
        candidates.vec.push(SC.AutoImplCandidate);
        break;
    }
  }
};

/// Searches for impls that might apply to `obligation`.
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:911 assemble_candidates_from_object_ty
SelectionContext.prototype.assemble_candidates_from_object_ty = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // debug!(self_ty = ?obligation.self_ty().skip_binder(), "assemble_candidates_from_object_ty");

  if (this.tcx().is_sizedness_trait(PolyTraitClause.def_id(obligation.predicate))) {
    // `dyn MetaSized` is valid, but should get its `MetaSized` impl from
    // being `dyn` (SizedCandidate), not from the object candidate.
    return;
  }

  this.infcx.probe((_snapshot) => {
    const poly_trait_predicate = this.infcx.deeply_resolve_ignoring_regions(obligation.predicate, d_PolyTraitClause());
    this.infcx.enter_forall(
      poly_trait_predicate,
      (placeholder_trait_predicate) => {
        const self_ty = TraitClauseC.self_ty(placeholder_trait_predicate);
        let principal_trait_ref: Binder<TraitRef>;
        const k = self_ty.kind();
        if (k.$ === "Dynamic") {
          const data = k._0;
          for (const did of data.auto_traits()) {
            if (DefId_eq(did, PolyTraitClause.def_id(obligation.predicate))) {
              // debug!("assemble_candidates_from_object_ty: matched builtin bound, pushing candidate");
              candidates.vec.push(SC.BuiltinObjectCandidate);
              return;
            }
          }

          const principal = data.principal();
          if (principal !== undefined) {
            principal_trait_ref = PolyExistentialTraitRef.with_self_ty(principal, as_interner(this.tcx()), self_ty);
          } else {
            // Only auto trait bounds exist.
            return;
          }
        } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
          // debug!("assemble_candidates_from_object_ty: ambiguous");
          candidates.ambiguous = true; // could wind up being an object type
          return;
        } else {
          return;
        }

        // debug!(?principal_trait_ref, "assemble_candidates_from_object_ty");

        // Count only those upcast versions that match the trait-ref
        // we are looking for. Specifically, do not only check for the
        // correct trait, but also the correct type parameters.
        // For example, we may be trying to upcast `Foo` to `Bar<i32>`,
        // but `Foo` is declared as `trait Foo: Bar<u32>`.
        let idx = 0;
        for (const upcast_trait_ref of supertraits(this.tcx(), principal_trait_ref)) {
          const i = idx++;
          if (
            this.infcx.probe((_) => this.match_normalize_trait_ref(obligation, placeholder_trait_predicate.trait_ref, upcast_trait_ref).$ === "Ok")
          ) {
            candidates.vec.push({ $: "ObjectCandidate", _0: i });
          }
        }
      },
      d_TraitClause,
    );
  });
};

/// Searches for unsizing that might apply to `obligation`.
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:985 assemble_candidates_for_unsizing
SelectionContext.prototype.assemble_candidates_for_unsizing = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // We currently never consider higher-ranked obligations e.g.
  // `for<'a> &'a T: Unsize<Trait+'a>` to be implemented. This is not
  // because they are a priori invalid, and we could potentially add support
  // for them later, it's just that there isn't really a strong need for it.
  // A `T: Unsize<U>` obligation is always used as part of a `T: CoerceUnsize<U>`
  // impl, and those are generally applied to concrete types.
  //
  // That said, one might try to write a fn with a where clause like
  //     for<'a> Foo<'a, T>: Unsize<Foo<'a, Trait>>
  // where the `'a` is kind of orthogonal to the relevant part of the `Unsize`.
  // Still, you'd be more likely to write that where clause as
  //     T: Trait
  // so it seems ok if we (conservatively) fail to accept that `Unsize`
  // obligation above. Should be possible to extend this in the future.
  const trait_pred = Binder.no_bound_vars(obligation.predicate, d_TraitClause);
  if (trait_pred === undefined) {
    // Don't add any candidates if there are bound regions.
    return;
  }
  const source = TraitClauseC.self_ty(trait_pred);
  const target = trait_pred.trait_ref.args.type_at(1);

  // debug!(?source, ?target, "assemble_candidates_for_unsizing");

  const sk = source.kind();
  const tk = target.kind();
  if (sk.$ === "Dynamic" && tk.$ === "Dynamic") {
    // Trait+Kx+'a -> Trait+Ky+'b (upcasts).
    const a_data = sk._0;
    const a_region = sk._1;
    const b_data = tk._0;
    const b_region = tk._1;
    // Upcast coercions permit several things:
    //
    // 1. Dropping auto traits, e.g., `Foo + Send` to `Foo`
    // 2. Tightening the region bound, e.g., `Foo + 'a` to `Foo + 'b` if `'a: 'b`
    // 3. Tightening trait to its super traits, eg. `Foo` to `Bar` if `Foo: Bar`
    //
    // Note that neither of the first two of these changes requires any
    // change at runtime. The third needs to change pointer metadata at runtime.
    //
    // We always perform upcasting coercions when we can because of reason
    // #2 (region bounds).
    const principal_def_id_a = a_data.principal_def_id();
    const principal_def_id_b = b_data.principal_def_id();
    if (option_DefId_eq(principal_def_id_a, principal_def_id_b) || principal_def_id_b === undefined) {
      // We may upcast to auto traits that are either explicitly listed in
      // the object type's bounds, or implied by the principal trait ref's
      // supertraits.
      const a_auto_traits = new DefIdSet();
      for (const did of a_data.auto_traits()) a_auto_traits.add(did);
      if (principal_def_id_a !== undefined) {
        for (const did of supertrait_def_ids(this.tcx(), principal_def_id_a)) {
          if (this.tcx().trait_is_auto(did)) a_auto_traits.add(did);
        }
      }
      let auto_traits_compatible = true;
      // All of a's auto traits need to be in b's auto traits.
      for (const b of b_data.auto_traits()) {
        if (!a_auto_traits.has(b)) {
          auto_traits_compatible = false;
          break;
        }
      }
      if (auto_traits_compatible) {
        candidates.vec.push(SC.BuiltinUnsizeCandidate);
      }
    } else if (principal_def_id_a !== undefined && principal_def_id_b !== undefined) {
      // not casual unsizing, now check whether this is trait upcasting coercion.
      const principal_a = unwrap(a_data.principal());
      const target_trait_did = principal_def_id_b;
      const source_trait_ref = PolyExistentialTraitRef.with_self_ty(principal_a, as_interner(this.tcx()), source);

      let idx = 0;
      for (const upcast_trait_ref of supertraits(this.tcx(), source_trait_ref)) {
        const i = idx++;
        this.infcx.probe((_) => {
          let nested: ReturnType<SelectionContext["match_upcast_principal"]>;
          if (
            DefId_eq(PolyTraitRef.def_id(upcast_trait_ref), target_trait_did) &&
            (nested = this.match_upcast_principal(obligation, Unnormalized.new_wip(upcast_trait_ref), a_data, b_data, a_region, b_region)).$ === "Ok"
          ) {
            if (nested._0 === undefined) {
              candidates.ambiguous = true;
            }
            candidates.vec.push({ $: "TraitUpcastingUnsizeCandidate", _0: i });
          }
        });
      }
    }
  } else if (tk.$ === "Dynamic") {
    // `T` -> `Trait`
    candidates.vec.push(SC.BuiltinUnsizeCandidate);
  } else if ((sk.$ === "Infer" && sk._0.$ === "TyVar") || (tk.$ === "Infer" && tk._0.$ === "TyVar")) {
    // Ambiguous handling is below `T` -> `Trait`, because inference
    // variables can still implement `Unsize<Trait>` and nested
    // obligations will have the final say (likely deferred).
    // debug!("assemble_candidates_for_unsizing: ambiguous");
    candidates.ambiguous = true;
  } else if (sk.$ === "Array" && tk.$ === "Slice") {
    // `[T; n]` -> `[T]`
    candidates.vec.push(SC.BuiltinUnsizeCandidate);
  } else if (sk.$ === "Adt" && tk.$ === "Adt" && sk._0.is_struct()) {
    // `Struct<T>` -> `Struct<U>`
    const def_id_a = sk._0;
    const def_id_b = tk._0;
    if (def_id_a === def_id_b) {
      candidates.vec.push(SC.BuiltinUnsizeCandidate);
    }
  } else {
    // _ => {}
  }
};

/** `Option<DefId> == Option<DefId>`. */
function option_DefId_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return DefId_eq(a, b);
}

// #[instrument(level = "debug", skip(self, obligation, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1111 assemble_candidates_for_transmutability
SelectionContext.prototype.assemble_candidates_for_transmutability = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  if (TypeVisitableExt.has_non_region_param(obligation.predicate, d_PolyTraitClause())) {
    return;
  }

  if (TypeVisitableExt.has_non_region_infer(obligation, visit_PolyTraitObligation())) {
    candidates.ambiguous = true;
    return;
  }

  candidates.vec.push(SC.TransmutabilityCandidate);
};

/** `Obligation<PolyTraitClause>: TypeVisitable` (the derive of `Obligation`, rustc_infer traits/mod.gen.ts). */
function visit_PolyTraitObligation(): import("../../../rustc_type_ir/visit.ts").TypeVisitable<PolyTraitObligation> {
  const m = require("../../../rustc_infer/traits/mod.gen.ts") as typeof import("../../../rustc_infer/traits/mod.gen.ts");
  const d = d_PolyTraitClause();
  return { visit_with: (self, v) => m.visit_with_Obligation(self, v, d.visit_with) };
}

// #[instrument(level = "debug", skip(self, obligation, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1129 assemble_candidates_for_trait_alias
SelectionContext.prototype.assemble_candidates_for_trait_alias = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // Okay to skip binder here because the tests we do below do not involve bound regions.
  const _self_ty = Binder.skip_binder(obligation.self_ty());
  // debug!(?self_ty);

  const def_id = PolyTraitClause.def_id(obligation.predicate);

  if (this.tcx().is_trait_alias(def_id)) {
    candidates.vec.push(SC.TraitAliasCandidate);
  }
};

/// Assembles `Copy` and `Clone` candidates for built-in types with no libcore-defined
/// `Copy` or `Clone` impls.
// #[instrument(level = "debug", skip(self, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1148 assemble_builtin_copy_clone_candidate
SelectionContext.prototype.assemble_builtin_copy_clone_candidate = function (
  this: SelectionContext,
  self_ty: Ty,
  candidates: SelectionCandidateSet,
): void {
  const k = self_ty.kind();
  switch (k.$) {
    // These impls are built-in because we cannot express sufficiently
    // generic impls in libcore.
    case "FnDef":
    case "FnPtr":
    case "Error":
    case "Tuple":
    case "Pat":
      candidates.vec.push(SC.BuiltinCandidate);
      break;

    // Implementations provided in libcore.
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Array":
      break;

    // FIXME(unsafe_binder): Should we conditionally
    // (i.e. universally) implement copy/clone?
    case "UnsafeBinder":
      break;

    // Not `Sized`, which is a supertrait of `Copy`/`Clone`.
    case "Dynamic":
    case "Str":
    case "Slice":
    case "Foreign":
      break;

    case "Ref":
      // `ty::Ref(_, _, hir::Mutability::Not)`: implementations provided in libcore.
      // `ty::Ref(_, _, hir::Mutability::Mut)`: not `Copy` or `Clone` by design.
      break;

    case "Coroutine": {
      const coroutine_def_id = k._0;
      const args = k._1;
      if (this.should_stall_coroutine(coroutine_def_id)) {
        candidates.ambiguous = true;
        return;
      }

      switch (this.tcx().coroutine_movability(coroutine_def_id)) {
        case "Static":
          break;
        case "Movable":
          if (this.tcx().features().coroutine_clone()) {
            const resolved_upvars = this.infcx.shallow_resolve(CoroutineArgs.tupled_upvars_ty(args.as_coroutine()));
            if (resolved_upvars.is_ty_var()) {
              // Not yet resolved.
              candidates.ambiguous = true;
            } else {
              candidates.vec.push(SC.BuiltinCandidate);
            }
          }
          break;
      }
      break;
    }

    case "Closure": {
      const args = k._1;
      const resolved_upvars = this.infcx.shallow_resolve(ClosureArgs.tupled_upvars_ty(args.as_closure()));
      if (resolved_upvars.is_ty_var()) {
        // Not yet resolved.
        candidates.ambiguous = true;
      } else {
        candidates.vec.push(SC.BuiltinCandidate);
      }
      break;
    }

    case "CoroutineClosure": {
      const args = k._1;
      const resolved_upvars = this.infcx.shallow_resolve(CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure()));
      if (resolved_upvars.is_ty_var()) {
        // Not yet resolved.
        candidates.ambiguous = true;
      } else {
        candidates.vec.push(SC.BuiltinCandidate);
      }
      break;
    }

    case "CoroutineWitness":
      candidates.vec.push(SC.SizedCandidate);
      break;

    // Fallback to whatever user-defined impls or param-env clauses exist in this case.
    case "Adt":
    case "Alias":
    case "Param":
    case "Placeholder":
      break;

    case "Infer": {
      const ik = k._0;
      if (ik.$ === "IntVar" || ik.$ === "FloatVar") {
        // Implementations provided in libcore.
      } else if (ik.$ === "TyVar") {
        candidates.ambiguous = true;
      } else {
        // ty::Infer(ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
        return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
      }
      break;
    }

    // Only appears when assembling higher-ranked `for<T> T: Clone`.
    case "Bound":
      break;
  }
};

/// Assembles the `Sized` and `MetaSized` traits which are built-in to the language itself.
// #[instrument(level = "debug", skip(self, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1249 assemble_builtin_sized_candidate
SelectionContext.prototype.assemble_builtin_sized_candidate = function (
  this: SelectionContext,
  self_ty: Ty,
  candidates: SelectionCandidateSet,
  sizedness: SizedTraitKind,
): void {
  const k = self_ty.kind();
  switch (k.$) {
    // Always sized.
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "RawPtr":
    case "Char":
    case "Ref":
    case "Array":
    case "Closure":
    case "CoroutineClosure":
    case "Never":
    case "Error":
      candidates.vec.push(SC.SizedCandidate);
      break;

    case "Coroutine": {
      const coroutine_def_id = k._0;
      if (this.should_stall_coroutine(coroutine_def_id)) {
        candidates.ambiguous = true;
      } else {
        candidates.vec.push(SC.SizedCandidate);
      }
      break;
    }

    case "CoroutineWitness":
      candidates.vec.push(SC.SizedCandidate);
      break;

    // Conditionally `Sized`.
    case "Tuple":
    case "Pat":
    case "Adt":
    case "UnsafeBinder":
      candidates.vec.push(SC.SizedCandidate);
      break;

    // `MetaSized` but not `Sized`.
    case "Str":
    case "Slice":
    case "Dynamic":
      switch (sizedness) {
        case "Sized":
          break;
        case "MetaSized":
          candidates.vec.push(SC.SizedCandidate);
          break;
      }
      break;

    // Not `MetaSized` or `Sized`.
    case "Foreign":
      break;

    case "Alias":
    case "Param":
    case "Placeholder":
      break;

    case "Infer": {
      const ik = k._0;
      if (ik.$ === "IntVar" || ik.$ === "FloatVar") {
        // Always sized.
        candidates.vec.push(SC.SizedCandidate);
      } else if (ik.$ === "TyVar") {
        candidates.ambiguous = true;
      } else {
        // ty::Infer(ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
        return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
      }
      break;
    }

    // Only appears when assembling higher-ranked `for<T> T: Sized`.
    case "Bound":
      break;
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1318 assemble_const_destruct_candidates
SelectionContext.prototype.assemble_const_destruct_candidates = function (
  this: SelectionContext,
  _obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  candidates.vec.push(SC.BuiltinCandidate);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1326 assemble_candidate_for_tuple
SelectionContext.prototype.assemble_candidate_for_tuple = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const self_ty = this.infcx.shallow_resolve(Binder.skip_binder(obligation.self_ty()));
  const k = self_ty.kind();
  switch (k.$) {
    case "Tuple":
      candidates.vec.push(SC.BuiltinCandidate);
      break;
    case "Infer":
      if (k._0.$ === "TyVar") {
        candidates.ambiguous = true;
      }
      // ty::Infer(_) => {}
      break;
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "Pat":
    case "FnPtr":
    case "UnsafeBinder":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Alias":
    case "Param":
    case "Bound":
    case "Error":
    case "Placeholder":
      break;
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1370 assemble_candidates_for_fn_ptr_trait
SelectionContext.prototype.assemble_candidates_for_fn_ptr_trait = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const self_ty = this.infcx.deeply_resolve_ignoring_regions(obligation.self_ty(), fold_Binder(fold_Ty));

  const k = Binder.skip_binder(self_ty).kind();
  switch (k.$) {
    case "FnPtr":
      candidates.vec.push(SC.BuiltinCandidate);
      break;
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
    case "Placeholder":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "UnsafeBinder":
    case "Never":
    case "Tuple":
    case "Alias":
    case "Param":
    case "Bound":
    case "Error":
      break;
    case "Infer": {
      const ik = k._0;
      if (ik.$ === "IntVar" || ik.$ === "FloatVar" || ik.$ === "FreshIntTy" || ik.$ === "FreshFloatTy") {
        // {}
      } else {
        // ty::Infer(ty::InferTy::TyVar(_) | ty::InferTy::FreshTy(_))
        candidates.ambiguous = true;
      }
      break;
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1418 assemble_candidates_for_bikeshed_guaranteed_no_drop_trait
SelectionContext.prototype.assemble_candidates_for_bikeshed_guaranteed_no_drop_trait = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const k = Binder.skip_binder(PolyTraitClause.self_ty(obligation.predicate)).kind();
  switch (k.$) {
    case "Ref":
    case "Adt":
    case "Tuple":
    case "Array":
    case "FnDef":
    case "FnPtr":
    case "Error":
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Pat":
    case "Dynamic":
    case "Str":
    case "Slice":
    case "Foreign":
    case "Alias":
    case "Param":
    case "Placeholder":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "UnsafeBinder":
    case "CoroutineWitness":
    case "Bound":
      candidates.vec.push(SC.BikeshedGuaranteedNoDropCandidate);
      break;

    case "Infer": {
      const ik = k._0;
      if (ik.$ === "IntVar" || ik.$ === "FloatVar") {
        candidates.vec.push(SC.BikeshedGuaranteedNoDropCandidate);
      } else {
        // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
        candidates.ambiguous = true;
      }
      break;
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1462 assemble_candidates_for_try_as_dyn
SelectionContext.prototype.assemble_candidates_for_try_as_dyn = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  const k = Binder.skip_binder(PolyTraitClause.self_ty(obligation.predicate)).kind();
  if (k.$ === "Dynamic") {
    const bounds = k._0;
    for (const bound of bounds) {
      const b = Binder.skip_binder(bound);
      switch (b.$) {
        case "Trait":
          break;
        // FIXME(try_as_dyn): check what kind of projections we can allow
        case "Projection":
          return;
        // Auto traits do not affect lifetimes outside of specialization,
        // which is disabled in reflection.
        case "AutoTrait":
          break;
      }
    }
    candidates.vec.push(SC.TryAsDynCandidate);
  } else if (k.$ === "Infer" && (k._0.$ === "TyVar" || k._0.$ === "FreshTy" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy")) {
    candidates.ambiguous = true;
  } else {
    // _ => {}
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/candidate_assembly.rs:1490 assemble_candidates_for_field_trait
SelectionContext.prototype.assemble_candidates_for_field_trait = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  candidates: SelectionCandidateSet,
): void {
  // `use crate::traits::query::evaluate_obligation::InferCtxtExt;` (installed on `InferCtxt` by ../../lib.ts)
  const tcx = this.tcx();
  // FIXME(field_projections): We should not use `evaluate_obligation` in
  // the trait solver. Doing so means we don't track overflow and cycles properly
  // encountering query cycles instead.
  const k = Binder.skip_binder(PolyTraitClause.self_ty(obligation.predicate)).kind();
  let info: import("../../../rustc_type_ir/lib.gen.ts").FieldInfo | undefined;
  if (
    k.$ === "Adt" &&
    (info = k._0.field_representing_type_info(tcx, k._1)) !== undefined &&
    // NOTE: these bounds have to be kept in sync with the definition of the `Field` trait
    // in `library/core/src/field.rs` as well as the new trait solver `fn
    // consider_builtin_field_candidate` in
    // `compiler/rustc_next_trait_solver/src/solve/trait_goals.rs`.
    must_apply_modulo_regions_ok(
      this.infcx.evaluate_obligation(
        Obligation.new(
          tcx,
          clone_ObligationCause(obligation.cause),
          obligation.param_env,
          TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Sized, DUMMY_SP), [GenericArg.from_Ty(info.base)]),
          upcast_TraitRef,
        ),
      ),
    ) &&
    must_apply_modulo_regions_ok(
      this.infcx.evaluate_obligation(
        Obligation.new(
          tcx,
          clone_ObligationCause(obligation.cause),
          obligation.param_env,
          TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Sized, DUMMY_SP), [GenericArg.from_Ty(info.ty)]),
          upcast_TraitRef,
        ),
      ),
    ) &&
    base_is_struct_or_tuple(info.base)
  ) {
    candidates.vec.push(SC.BuiltinCandidate);
  }
};

/** `match base.kind() { ty::Adt(def, _) => def.is_struct() && !def.repr().packed(), ty::Tuple(..) => true, _ => false }` */
function base_is_struct_or_tuple(base: Ty): boolean {
  const bk = base.kind();
  switch (bk.$) {
    case "Adt":
      return bk._0.is_struct() && !bk._0.repr().packed();
    case "Tuple":
      return true;
    default:
      return false;
  }
}

/** `match r { Ok(res) if res.must_apply_modulo_regions() => true, _ => false }` */
function must_apply_modulo_regions_ok(r: Result<EvaluationResult, OverflowError>): boolean {
  return r.$ === "Ok" && EvaluationResult.must_apply_modulo_regions(r._0);
}

/** `impl UpcastFrom<TyCtxt, TraitRef> for Predicate` at `Obligation::new`'s `Interner` type. */
const upcast_TraitRef = Predicate_upcast_from_TraitRef as unknown as (from: TraitRef, tcx: Interner) => Predicate;

/** PORT: names used only in type positions. */
export type CandidateAssemblyUnused = SelectionCandidate;
