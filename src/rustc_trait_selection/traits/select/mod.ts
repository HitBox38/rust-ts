//! Candidate selection. See the [rustc dev guide] for more information on how this works.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/resolution.html#selection
//
// Port of compiler/rustc_trait_selection/src/traits/select/mod.rs (lanes old-select-a / old-select-b, wave 18b).
//
// Contract stub (lane selcx-contract): `SelectionContext` (generated class, ./mod.gen.ts) gets every method of the old
// solver's `impl SelectionContext` blocks, declared in ../../decls.ts (`declare module "./traits/select/mod.gen.ts"`,
// grouped by file with `// <file>:<line>`). This file holds the methods of mod.rs; candidate_assembly.ts and
// confirmation.ts hold theirs. Ported here already: `new`, `typing_mode`, `with_query_mode`, `tcx`, the
// `IntercrateAmbiguityCause` impl, and the helper impls at the end of the file (`TraitObligationStack`,
// `ProvisionalEvaluationCache`, `TraitObligationStackList`, the manual `Debug`).
//
// How to fill a stub (docs/handoff/selcx-contract.md): port each fn in upstream order as
// `SelectionContext.prototype.<name> = function (this: SelectionContext, ..) { .. };` with its
// `// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:<line> <name>` marker directly above, then delete
// the name from the `unported_methods(..)` list below (and the call when the list is empty). Do not change a declared
// signature in decls.ts: a wrong one goes in your handoff (or a local `declare module` marked
// `// PORT(decls): pending root`).
//
// PORT (representation):
// - `TraitObligationStack` / `ProvisionalEvaluationCache` are generated classes; `Cell` / `RefCell` fields are the values.
//   `ProvisionalEvaluationCache.map` is an `FxIndexMap` keyed by `PolyTraitClause` (a `Binder` struct, not interned): it
//   is a `KeyedMap` on `intern_key` (`ProvisionalEvaluationCache.default`).
// - `TraitObligationStackList` (`#[derive(Copy, Clone)]`, `Iterator`) is a hand class: its field `head` is `head_`
//   (the method `head()` has the name). `next()` mutates the list in place (`*self = o.previous`), so a copy that is
//   iterated is `clone_TraitObligationStackList(list)` wherever Rust copies the value; it is also a JS iterable.
// - `debug!` / `trace!` / `#[instrument]` are dropped (no tracing in the port).
//
// Init order: top-level code here touches only ./mod.gen.ts and other crates; other rustc_trait_selection modules are
// read inside function bodies only.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { ControlFlow } from "../../../rustc_ast_ir/visit.ts";
import type { Diag } from "../../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { ToTrace_AliasTerm, ToTrace_Const, ToTrace_TraitRef, ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { DefineOpaqueTypes } from "../../../rustc_infer/infer/at.gen.ts";
import { TypeFreshener } from "../../../rustc_infer/infer/freshen.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.gen.ts";
import {
  clone_Obligation,
  debug_Obligation,
  Obligation,
  type PolyTraitObligation,
  type PredicateObligation,
  type PredicateObligations,
  type Selection,
  type TraitObligation,
  visit_with_Obligation,
} from "../../../rustc_infer/traits/mod.ts";
import type { DepNodeIndex } from "../../../rustc_middle/dep_graph/graph.ts";
import { clone_ObligationCause, ImplSource, SelectionError, type SelectionResult } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Clauses, Predicate } from "../../../rustc_middle/ty/decls.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_GenericArg, GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import {
  type ParamEnv,
  ParamEnv as ParamEnvC,
  ParamEnv_eq,
  Term,
  type TypingEnv,
  fold_with_ParamEnv,
  try_fold_with_ParamEnv,
  visit_with_ParamEnv,
} from "../../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { display_TraitRefPrintSugared, TraitRef_print_trait_sugared, with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { type PolyProjectionClause, type PolyTraitClause, Predicate_upcast_from_PolyTraitClause } from "../../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Clauses, fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { ParamConst } from "../../../rustc_middle/ty/sty.ts";
import {
  clone_SelectionCandidate,
  EvaluationResult,
  EvaluationResult_discriminant,
  OverflowError,
  type SelectionCandidate,
  SelectionError_from_OverflowError,
} from "../../../rustc_middle/traits/select.ts";
import { type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Binder, debug_Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../../rustc_type_ir/const_kind.ts";
import type { PolyTraitRef, TraitRef } from "../../../rustc_type_ir/decls.ts";
import { DeepRejectCtxt } from "../../../rustc_type_ir/fast_reject.ts";
import { fold_tuple2, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { type CantBeErased, may_use_unstable_feature, TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import {
  as_interner,
  debug_TraitClause,
  fold_with_HostEffectClause,
  fold_with_ProjectionClause,
  fold_with_TraitClause,
  fold_with_TraitRef,
  type HostEffectClause,
  PolyTraitClause as PolyTraitClauseC,
  PolyTraitRef as PolyTraitRefC,
  TraitClause,
  try_fold_with_HostEffectClause,
  try_fold_with_ProjectionClause,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_HostEffectClause,
  visit_with_ProjectionClause,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import { type AliasBoundKind, CandidatePreferenceMode } from "../../../rustc_type_ir/solve/mod.ts";
import { Const, debug_Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { AliasTerm as AliasTermC, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { type AliasTerm, type AliasTy as AliasTyT, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import { AliasTy } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { type Fmt, PLAIN } from "../../../std/fmt.ts";
import { assert, unreachable } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { EvaluateConstErr, TraitQueryMode } from "../mod.gen.ts";
import type { ProjectionTermObligation } from "../project.gen.ts";
import {
  type EvaluatedCandidate,
  type IntercrateAmbiguityCause as IntercrateAmbiguityCauseT,
  type ProjectionMatchesProjection,
  type ProvisionalEvaluation,
  ProvisionalEvaluationCache,
  SelectionContext,
  TraitObligationStack,
} from "./mod.gen.ts";

export * from "./mod.gen.ts";
// `pub use rustc_middle::traits::select::*;`
export * from "../../../rustc_middle/traits/select.ts";

// ---- impl<'tcx> IntercrateAmbiguityCause<'tcx> (mod.rs:62) ----------------------------------------------------------

export type IntercrateAmbiguityCause = IntercrateAmbiguityCauseT;
export const IntercrateAmbiguityCause = {
  /// Emits notes when the overlap is caused by complex intercrate ambiguities.
  /// See #23980 for details.
  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:65 add_intercrate_ambiguity_hint
  add_intercrate_ambiguity_hint(self: IntercrateAmbiguityCause, err: Diag): void {
    err.note(IntercrateAmbiguityCause.intercrate_ambiguity_hint(self));
  },

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:69 intercrate_ambiguity_hint
  intercrate_ambiguity_hint(self: IntercrateAmbiguityCause): string {
    return with_no_trimmed_paths(() => {
      switch (self.$) {
        case "DownstreamCrate": {
          const { trait_ref, self_ty } = self;
          const trait_desc = display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref));
          const self_desc = self_ty !== undefined ? ` for type \`${display_Ty(self_ty)}\`` : "";
          return `downstream crates may implement trait \`${trait_desc}\`${self_desc}`;
        }
        case "UpstreamCrateUpdate": {
          const { trait_ref, self_ty } = self;
          const trait_desc = display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref));
          const self_desc = self_ty !== undefined ? ` for type \`${display_Ty(self_ty)}\`` : "";
          return `upstream crates may add a new impl of trait \`${trait_desc}\`${self_desc} in future versions`;
        }
      }
    });
  },
};

// ---- impl<'cx, 'tcx> SelectionContext<'cx, 'tcx> (mod.rs:180) ---------------------------------------------------------

Object.assign(SelectionContext, {
  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:181 new
  new(infcx: InferCtxt): SelectionContext {
    return new SelectionContext(infcx, TypeFreshener.new(infcx), "Standard" satisfies TraitQueryMode);
  },

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:193 with_query_mode
  with_query_mode(infcx: InferCtxt, query_mode: TraitQueryMode): SelectionContext {
    // debug!(?query_mode, "with_query_mode");
    const base = SelectionContext.new(infcx);
    return new SelectionContext(base.infcx, base.freshener, query_mode);
  },
});

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:189 typing_mode
SelectionContext.prototype.typing_mode = function (this: SelectionContext): TypingMode<CantBeErased> {
  return TypingMode.assert_not_erased(this.infcx.typing_mode_raw());
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:201 tcx
SelectionContext.prototype.tcx = function (this: SelectionContext): TyCtxt {
  return this.infcx.tcx;
};

///////////////////////////////////////////////////////////////////////////
// Selection
//
// The selection phase tries to identify *how* an obligation will
// be resolved. For example, it will identify which impl or
// parameter bound is to be used. The process can be inconclusive
// if the self type in the obligation is not fully inferred. Selection
// can result in an error in one of two ways:
//
// 1. If no applicable impl or parameter bound can be found.
// 2. If the output type parameters in the obligation do not match
//    those specified by the impl/bound. For example, if the obligation
//    is `Vec<Foo>: Iterable<Bar>`, but the impl specifies
//    `impl<T> Iterable<T> for Vec<T>`, than an error would result.

/// Attempts to satisfy the obligation. If successful, this will affect the surrounding
/// type environment by performing unification.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:223 poly_select
SelectionContext.prototype.poly_select = function (this: SelectionContext, obligation: PolyTraitObligation): SelectionResult<Selection> {
  if (this.infcx.next_trait_solver()) {
    return this.infcx.select_in_new_trait_solver(obligation);
  }

  let candidate: SelectionCandidate;
  {
    const r = this.select_from_obligation(obligation);
    if (r.$ === "Err" && r._0.$ === "Overflow" && r._0._0.$ === "Canonical") {
      // In standard mode, overflow must have been caught and reported
      // earlier.
      assert(this.query_mode === "Canonical", "assertion failed: self.query_mode == TraitQueryMode::Canonical");
      return Err({ $: "Overflow", _0: OverflowError.Canonical });
    } else if (r.$ === "Err") {
      return Err(r._0);
    } else if (r._0 === undefined) {
      return Ok(undefined);
    } else {
      candidate = r._0;
    }
  }

  const r = this.confirm_candidate(obligation, candidate);
  if (r.$ === "Err" && r._0.$ === "Overflow" && r._0._0.$ === "Canonical") {
    assert(this.query_mode === "Canonical", "assertion failed: self.query_mode == TraitQueryMode::Canonical");
    return Err({ $: "Overflow", _0: OverflowError.Canonical });
  } else if (r.$ === "Err") {
    return Err(r._0);
  } else if (r._0.$ === "Builtin" && TypingMode.is_reflection(this.typing_mode())) {
    // Builtin impls regularly don't satisfy the try_as_dyn requirements, so
    // we just reject all of them.
    return Err(SelectionError.Unimplemented);
  } else {
    return Ok(r._0);
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:262 select
SelectionContext.prototype.select = function (this: SelectionContext, obligation: TraitObligation): SelectionResult<Selection> {
  return this.poly_select(
    new Obligation(clone_ObligationCause(obligation.cause), obligation.param_env, Binder.dummy(obligation.predicate, d_TraitClause()), obligation.recursion_depth),
  );
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:274 select_from_obligation
SelectionContext.prototype.select_from_obligation = function (this: SelectionContext, obligation: PolyTraitObligation): SelectionResult<SelectionCandidate> {
  // debug_assert!(!obligation.predicate.has_escaping_bound_vars());

  const pec = ProvisionalEvaluationCache.default();
  const stack = this.push_stack(TraitObligationStackList.empty(pec), obligation);

  return this.candidate_from_obligation(stack);
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:287 candidate_from_obligation
SelectionContext.prototype.candidate_from_obligation = function (this: SelectionContext, stack: TraitObligationStack): SelectionResult<SelectionCandidate> {
  // debug_assert!(!self.infcx.next_trait_solver());
  // Watch out for overflow. This intentionally bypasses (and does
  // not update) the cache.
  const rl = this.check_recursion_limit(stack.obligation, stack.obligation, Predicate_upcast_from_PolyTraitClause_());
  if (rl.$ === "Err") return Err(SelectionError_from_OverflowError(rl._0));

  // Check the cache. Note that we freshen the trait-ref
  // separately rather than using `stack.fresh_trait_pred` --
  // this is because we want the unbound variables to be
  // replaced with fresh types starting from index 0.
  const cache_fresh_trait_pred = d_PolyTraitClause().fold_with(stack.obligation.predicate, TypeFreshener.new(this.infcx));
  // debug!(?cache_fresh_trait_pred);
  // debug_assert!(!stack.obligation.predicate.has_escaping_bound_vars());

  const c = this.check_candidate_cache(stack.obligation.param_env, cache_fresh_trait_pred);
  if (c !== undefined) {
    // debug!("CACHE HIT");
    return c;
  }

  // If no match, compute result and insert into cache.
  //
  // FIXME(nikomatsakis) -- this cache is not taking into
  // account cycles that may have occurred in forming the
  // candidate. I don't know of any specific problems that
  // result but it seems awfully suspicious.
  const [candidate, dep_node] = this.in_task((this_) => this_.candidate_from_obligation_no_cache(stack));

  // debug!("CACHE MISS");
  this.insert_candidate_cache(stack.obligation.param_env, cache_fresh_trait_pred, dep_node, clone_SelectionResult_SelectionCandidate(candidate));
  return candidate;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:331 candidate_from_obligation_no_cache
SelectionContext.prototype.candidate_from_obligation_no_cache = function (
  this: SelectionContext,
  stack: TraitObligationStack,
): SelectionResult<SelectionCandidate> {
  const r = this.assemble_candidates(stack);
  if (r.$ === "Err") return r;
  const candidate_set = r._0;

  if (candidate_set.ambiguous) {
    // debug!("candidate set contains ambig");
    return Ok(undefined);
  }

  const candidates_ = candidate_set.vec;

  // debug!(?stack, ?candidates, "assembled {} candidates", candidates.len());

  // At this point, we know that each of the entries in the
  // candidate set is *individually* applicable. Now we have to
  // figure out if they contain mutual incompatibilities. This
  // frequently arises if we have an unconstrained input type --
  // for example, we are looking for `$0: Eq` where `$0` is some
  // unconstrained type variable. In that case, we'll get a
  // candidate which assumes $0 == int, one that assumes `$0 ==
  // usize`, etc. This spells an ambiguity.

  const candidates__ = this.filter_impls(candidates_, stack.obligation);

  // If there is more than one candidate, first winnow them down
  // by considering extra conditions (nested obligations and so
  // forth). We don't winnow if there is exactly one
  // candidate. This is a relatively minor distinction but it
  // can lead to better inference and error-reporting. An
  // example would be if there was an impl:
  //
  //     impl<T:Clone> Vec<T> { fn push_clone(...) { ... } }
  //
  // and we were to see some code `foo.push_clone()` where `boo`
  // is a `Vec<Bar>` and `Bar` does not implement `Clone`. If
  // we were to winnow, we'd wind up with zero candidates.
  // Instead, we select the right impl now but report "`Bar` does
  // not implement `Clone`".
  if (candidates__.length === 1) {
    return Ok(candidates__.pop());
  }

  // Winnow, but record the exact outcome of evaluation, which
  // is needed for specialization. Propagate overflow if it occurs.
  // PORT: `.map(..).flat_map(Result::transpose).collect::<Result<Vec<_>, _>>()?` stops at the first `Err` (the
  // iterator is lazy), so the later candidates are not evaluated.
  const candidates: EvaluatedCandidate[] = [];
  for (const c of candidates__) {
    const e = this.evaluate_candidate(stack, c);
    if (e.$ === "Ok" && EvaluationResult.may_apply(e._0)) {
      candidates.push({ candidate: c, evaluation: e._0 });
    } else if (e.$ === "Ok") {
      // Ok(None)
    } else if (e._0.$ === "Canonical") {
      return Err({ $: "Overflow", _0: OverflowError.Canonical });
    } else {
      return Err({ $: "Overflow", _0: { $: "Error", _0: e._0._0 } });
    }
  }

  // debug!(?stack, ?candidates, "{} potentially applicable candidates", candidates.len());
  // If there are *NO* candidates, then there are no impls --
  // that we know of, anyway. Note that in the case where there
  // are unbound type variables within the obligation, it might
  // be the case that you could still satisfy the obligation
  // from another crate by instantiating the type variables with
  // a type from another crate that does have an impl. This case
  // is checked for in `evaluate_stack` (and hence users
  // who might care about this case, like coherence, should use
  // that function).
  if (candidates.length === 0) {
    // If there's an error type, 'downgrade' our result from
    // `Err(Unimplemented)` to `Ok(None)`. This helps us avoid
    // emitting additional spurious errors, since we're guaranteed
    // to have emitted at least one.
    if (TypeVisitableExt.references_error(stack.obligation.predicate, d_PolyTraitClause())) {
      // debug!(?stack.obligation.predicate, "found error type in predicate, treating as ambiguous");
      return Ok(undefined);
    } else {
      return Err(SelectionError.Unimplemented);
    }
  } else {
    const has_non_region_infer = TypeVisitableExt.has_non_region_infer(stack.obligation.predicate, d_PolyTraitClause());
    const candidate_preference_mode = CandidatePreferenceMode.compute(as_interner(this.tcx()), PolyTraitClauseC.def_id(stack.obligation.predicate));
    return Ok(this.winnow_candidates(has_non_region_infer, candidate_preference_mode, candidates));
  }
};

///////////////////////////////////////////////////////////////////////////
// EVALUATION
//
// Tests whether an obligation can be selected or whether an impl
// can be applied to particular types. It skips the "confirmation"
// step and hence completely ignores output type parameters.
//
// The result is "true" if the obligation *may* hold and "false" if
// we can be sure it does not.

/// Evaluates whether the obligation `obligation` can be satisfied
/// and returns an `EvaluationResult`. This is meant for the
/// *initial* call.
///
/// Do not use this directly, use `infcx.evaluate_obligation` instead.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:438 evaluate_root_obligation
SelectionContext.prototype.evaluate_root_obligation = function (
  this: SelectionContext,
  obligation: PredicateObligation,
): Result<EvaluationResult, OverflowError> {
  // debug_assert!(!self.infcx.next_trait_solver());
  return this.evaluation_probe((this_) => {
    const d_goal = d_Predicate_ParamEnv();
    const goal = this_.infcx.deeply_resolve_ignoring_regions<[Predicate, ParamEnv]>([obligation.predicate, obligation.param_env], d_goal);
    const r = this_.evaluate_predicate_recursively(
      TraitObligationStackList.empty(ProvisionalEvaluationCache.default()),
      clone_Obligation(obligation, (p) => p),
    );
    if (r.$ === "Err") return r;
    let result = r._0;
    // If the predicate has done any inference, then downgrade the
    // result to ambiguous.
    const resolved = this_.infcx.deeply_resolve_ignoring_regions(goal, d_goal);
    if (!(resolved[0] === goal[0] && ParamEnv_eq(resolved[1], goal[1]))) {
      result = max_EvaluationResult(result, "EvaluatedToAmbig");
    }
    return Ok(result);
  });
};

/// Computes the evaluation result of `op`, discarding any constraints.
///
/// This also runs for leak check to allow higher ranked region errors to impact
/// selection. By default it checks for leaks from all universes created inside of
/// `op`, but this can be overwritten if necessary.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:465 evaluation_probe
SelectionContext.prototype.evaluation_probe = function (
  this: SelectionContext,
  op: (selcx: SelectionContext) => Result<EvaluationResult, OverflowError>,
): Result<EvaluationResult, OverflowError> {
  return this.infcx.probe((snapshot): Result<EvaluationResult, OverflowError> => {
    const outer_universe = this.infcx.universe();
    const r = op(this);
    if (r.$ === "Err") return r;
    const result = r._0;

    const lc = this.infcx.leak_check(outer_universe, snapshot);
    if (lc.$ === "Ok") {
      // {}
    } else {
      return Ok("EvaluatedToErr");
    }

    if (this.infcx.opaque_types_added_in_snapshot(snapshot)) {
      return Ok(max_EvaluationResult(result, "EvaluatedToOkModuloOpaqueTypes"));
    }

    if (this.infcx.region_constraints_added_in_snapshot(snapshot)) {
      return Ok(max_EvaluationResult(result, "EvaluatedToOkModuloRegions"));
    } else {
      return Ok(result);
    }
  });
};

/// Evaluates the predicates in `predicates` recursively. This may
/// guide inference. If this is not desired, run it inside of a
/// is run within an inference probe.
/// `probe`.
// #[instrument(skip(self, stack), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:495 evaluate_predicates_recursively
SelectionContext.prototype.evaluate_predicates_recursively = function (
  this: SelectionContext,
  stack: TraitObligationStackList,
  predicates: Iterable<PredicateObligation>,
): Result<EvaluationResult, OverflowError> {
  let result: EvaluationResult = "EvaluatedToOk";
  for (const obligation of predicates) {
    obligation.set_depth_from_parent(stack.depth());
    const r = this.evaluate_predicate_recursively(stack, obligation);
    if (r.$ === "Err") return r;
    const eval_ = r._0;
    if (eval_ === "EvaluatedToErr") {
      // fast-path - EvaluatedToErr is the top of the lattice,
      // so we don't need to look on the other predicates.
      return Ok("EvaluatedToErr");
    } else {
      result = max_EvaluationResult(result, eval_);
    }
  }
  return Ok(result);
};

// #[instrument(level = "debug", skip(self, previous_stack), fields(previous_stack = ?previous_stack.head()) ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:524 evaluate_predicate_recursively
SelectionContext.prototype.evaluate_predicate_recursively = function (
  this: SelectionContext,
  previous_stack: TraitObligationStackList,
  obligation: PredicateObligation,
): Result<EvaluationResult, OverflowError> {
  // debug_assert!(!self.infcx.next_trait_solver());
  // `previous_stack` stores a `PolyTraitObligation`, while `obligation` is
  // a `PredicateObligation`. These are distinct types, so we can't
  // use any `Option` combinator method that would force them to be
  // the same.
  const h = previous_stack.head();
  if (h !== undefined) {
    const r = this.check_recursion_limit(obligation, h.obligation, Predicate_upcast_from_PolyTraitClause_());
    if (r.$ === "Err") return r;
  } else {
    const r = this.check_recursion_limit(obligation, obligation, (p: Predicate) => p);
    if (r.$ === "Err") return r;
  }

  const traits = traits_mod();
  if (!this.infcx.disable_trait_solver_fast_paths() && traits.sizedness_fast_path(this.tcx(), obligation.predicate, obligation.param_env)) {
    return Ok("EvaluatedToOk");
  }

  const bound_predicate = obligation.predicate.kind();
  const kind = Binder.skip_binder(bound_predicate);
  switch (kind.$) {
    case "Clause": {
      const clause = kind._0;
      switch (clause.$) {
        case "Trait": {
          const t = Binder.rebind(bound_predicate, clause._0);
          // debug_assert!(!t.has_escaping_bound_vars());
          const obligation_ = obligation.with(this.tcx(), t, (p: PolyTraitClause) => p);
          return this.evaluate_trait_predicate_recursively(previous_stack, obligation_);
        }

        case "HostEffect": {
          const effects = traits.effects;
          return this.infcx.enter_forall(
            Binder.rebind(bound_predicate, clause._0),
            (data) => {
              const r = effects.evaluate_host_effect_obligation(this, obligation.with(this.tcx(), data, (p: HostEffectClause) => p));
              if (r.$ === "Ok") {
                return this.evaluate_predicates_recursively(previous_stack, r._0);
              } else if (r._0 === "Ambiguous") {
                return Ok("EvaluatedToAmbig");
              } else {
                return Ok("EvaluatedToErr");
              }
            },
            d_HostEffectClause(),
          );
        }

        case "WellFormed": {
          const term = clause._0;
          if (Term.is_trivially_wf(term, this.tcx())) {
            return Ok("EvaluatedToOk");
          }

          // So, there is a bit going on here. First, `WellFormed` predicates
          // are coinductive, like trait predicates with auto traits.
          // This means that we need to detect if we have recursively
          // evaluated `WellFormed(X)`. Otherwise, we would run into
          // a "natural" overflow error.
          //
          // Now, the next question is whether we need to do anything
          // special with caching. Considering the following tree:
          // - `WF(Foo<T>)`
          //   - `Bar<T>: Send`
          //     - `WF(Foo<T>)`
          //   - `Foo<T>: Trait`
          // In this case, the innermost `WF(Foo<T>)` should return
          // `EvaluatedToOk`, since it's coinductive. Then if
          // `Bar<T>: Send` is resolved to `EvaluatedToOk`, it can be
          // inserted into a cache (because without thinking about `WF`
          // goals, it isn't in a cycle). If `Foo<T>: Trait` later doesn't
          // hold, then `Bar<T>: Send` shouldn't hold. Therefore, we
          // *do* need to keep track of coinductive cycles.

          const cache = previous_stack.cache;
          const dfn = cache.next_dfn();

          const wf_args = previous_stack.cache.wf_args;
          for (let i = wf_args.length - 1; i >= 0; i--) {
            const stack_term = wf_args[i]!;
            if (stack_term[0] !== term) {
              continue;
            }
            // debug!("WellFormed({:?}) on stack", term);
            const stack = previous_stack.head_;
            if (stack !== undefined) {
              // Okay, let's imagine we have two different stacks:
              //   `T: NonAutoTrait -> WF(T) -> T: NonAutoTrait`
              //   `WF(T) -> T: NonAutoTrait -> WF(T)`
              // Because of this, we need to check that all
              // predicates between the WF goals are coinductive.
              // Otherwise, we can say that `T: NonAutoTrait` is
              // true.
              // Let's imagine we have a predicate stack like
              //         `Foo: Bar -> WF(T) -> T: NonAutoTrait -> T: Auto`
              // depth   ^1                    ^2                 ^3
              // and the current predicate is `WF(T)`. `wf_args`
              // would contain `(T, 1)`. We want to check all
              // trait predicates greater than `1`. The previous
              // stack would be `T: Auto`.
              const cycle = take_while(stack.iter(), (s) => s.depth > stack_term[1]);
              const tcx = this.tcx();
              const cycle_ = map_iter(cycle, (stack) => Predicate_upcast_from_PolyTraitClause(stack.obligation.predicate, tcx));
              if (this.coinductive_match(cycle_)) {
                stack.update_reached_depth(stack_term[1]);
                return Ok("EvaluatedToOk");
              } else {
                return Ok("EvaluatedToAmbigStackDependent");
              }
            }
            return Ok("EvaluatedToOk");
          }

          const os = traits.wf.obligations(
            this.infcx,
            obligation.param_env,
            obligation.cause.body_def_id,
            obligation.recursion_depth + 1,
            term,
            obligation.cause.span,
          );
          if (os !== undefined) {
            const obligations = os;
            cache.wf_args.push([term, previous_stack.depth()]);
            const result_ = this.evaluate_predicates_recursively(previous_stack, obligations);
            cache.wf_args.pop();

            if (result_.$ === "Err") return result_;
            const result = result_._0;

            if (!EvaluationResult.must_apply_modulo_regions(result)) {
              cache.on_failure(dfn);
            }

            cache.on_completion(dfn);

            return Ok(result);
          } else {
            return Ok("EvaluatedToAmbig");
          }
        }

        case "TypeOutlives": {
          const pred = clause._0;
          // A global type with no free lifetimes or generic parameters
          // outlives anything.
          if (
            TypeVisitableExt.has_free_regions(pred._0, fold_Ty) ||
            TypeVisitableExt.has_bound_regions(pred._0, fold_Ty) ||
            TypeVisitableExt.has_non_region_infer(pred._0, fold_Ty) ||
            TypeVisitableExt.has_non_region_param(pred._0, fold_Ty)
          ) {
            return Ok("EvaluatedToOkModuloRegions");
          } else {
            return Ok("EvaluatedToOk");
          }
        }

        case "RegionOutlives":
          // We do not consider region relationships when evaluating trait matches.
          return Ok("EvaluatedToOkModuloRegions");

        case "Projection": {
          const data = Binder.rebind(bound_predicate, clause._0);
          const project_obligation = obligation.with(this.tcx(), data, (p: PolyProjectionClause) => p);
          const project = traits.project;
          const r = project.poly_project_and_unify_term(this, project_obligation);
          switch (r.$) {
            case "Holds": {
              const subobligations = r._0;
              // 'compute_res: {
              // If we've previously marked this projection as 'complete', then
              // use the final cached result (either `EvaluatedToOk` or
              // `EvaluatedToOkModuloRegions`), and skip re-evaluating the
              // sub-obligations.
              const key = project.ProjectionCacheKey_from_poly_projection_obligation(this, project_obligation);
              if (key !== undefined) {
                const cached_res = this.infcx.inner.projection_cache().is_complete(key);
                if (cached_res !== undefined) {
                  return Ok(cached_res);
                }
              }

              // Need to explicitly set the depth of nested goals here as
              // projection obligations can cycle by themselves and in
              // `evaluate_predicates_recursively` we only add the depth
              // for parent trait goals because only these get added to the
              // `TraitObligationStackList`.
              for (const subobligation of subobligations) {
                subobligation.set_depth_from_parent(obligation.recursion_depth);
              }
              const res = this.evaluate_predicates_recursively(previous_stack, subobligations);
              if (res.$ === "Ok" && (res._0 === "EvaluatedToOk" || res._0 === "EvaluatedToOkModuloRegions")) {
                const key = project.ProjectionCacheKey_from_poly_projection_obligation(this, project_obligation);
                if (key !== undefined) {
                  // If the result is something that we can cache, then mark this
                  // entry as 'complete'. This will allow us to skip evaluating the
                  // subobligations at all the next time we evaluate the projection
                  // predicate.
                  this.infcx.inner.projection_cache().complete(key, res._0);
                }
              }
              return res;
              // }
            }
            case "FailedNormalization":
              return Ok("EvaluatedToAmbig");
            case "Recursive":
              return Ok("EvaluatedToAmbigStackDependent");
            case "MismatchedProjectionTypes":
              return Ok("EvaluatedToErr");
          }
          break;
        }

        case "UnstableFeature": {
          const symbol = clause._0;
          if (may_use_unstable_feature(this.infcx, obligation.param_env, symbol)) {
            return Ok("EvaluatedToOk");
          } else {
            return Ok("EvaluatedToAmbig");
          }
        }

        case "ConstEvaluatable": {
          const alias_const = clause._0;
          const r = traits.const_evaluatable.is_const_evaluatable(this.infcx, alias_const, obligation.param_env, obligation.cause.span);
          if (r.$ === "Ok") {
            return Ok("EvaluatedToOk");
          } else if (r._0.$ === "MentionsInfer") {
            return Ok("EvaluatedToAmbig");
          } else if (r._0.$ === "MentionsParam") {
            return Ok("EvaluatedToErr");
          } else {
            return Ok("EvaluatedToErr");
          }
        }

        case "ConstArgHasType": {
          let ct = clause._0;
          const ty = clause._1;
          ct = this.infcx.shallow_resolve_const(ct);
          let ct_ty: Ty;
          const ck = ct.kind();
          switch (ck.$) {
            case "Infer": {
              return Ok("EvaluatedToAmbig");
            }
            case "Error":
              return Ok("EvaluatedToOk");
            case "Value":
              ct_ty = ck._0.ty;
              break;
            case "Alias":
              ct_ty = Unnormalized.skip_norm_wip(AliasConst.type_of(ck._1, this.tcx()));
              break;
            // FIXME(generic_const_exprs): See comment in `fulfill.rs`
            case "Expr":
              return Ok("EvaluatedToOk");
            case "Placeholder":
              return bug(`placeholder const ${debug_Const(ct, PLAIN)} in old solver`);
            case "Bound":
              return bug(`escaping bound vars in ${debug_Const(ct, PLAIN)}`);
            case "Param":
              ct_ty = ParamConst.find_const_ty_from_env(ck._0, obligation.param_env);
              break;
          }

          const r = this.infcx.at(obligation.cause, obligation.param_env).eq(
            // Only really exercised by generic_const_exprs
            DefineOpaqueTypes.Yes,
            ct_ty,
            ty,
            ToTrace_Ty,
          );
          if (r.$ === "Ok") {
            return this.evaluate_predicates_recursively(previous_stack, r._0.into_obligations());
          } else {
            return Ok("EvaluatedToErr");
          }
        }
      }
      break;
    }

    case "Subtype": {
      const p = Binder.rebind(bound_predicate, kind._0);
      // Does this code ever run?
      const r = this.infcx.subtype_predicate(obligation.cause, obligation.param_env, p);
      if (r.$ === "Ok" && r._0.$ === "Ok") {
        return this.evaluate_predicates_recursively(previous_stack, r._0._0.obligations);
      } else if (r.$ === "Ok") {
        return Ok("EvaluatedToErr");
      } else {
        return Ok("EvaluatedToAmbig");
      }
    }

    case "Coerce": {
      const p = Binder.rebind(bound_predicate, kind._0);
      // Does this code ever run?
      const r = this.infcx.coerce_predicate(obligation.cause, obligation.param_env, p);
      if (r.$ === "Ok" && r._0.$ === "Ok") {
        return this.evaluate_predicates_recursively(previous_stack, r._0._0.obligations);
      } else if (r.$ === "Ok") {
        return Ok("EvaluatedToErr");
      } else {
        return Ok("EvaluatedToAmbig");
      }
    }

    case "DynCompatible": {
      const trait_def_id = kind._0;
      // `DynCompatible` obligations are only emitted as
      // nested obligations of `WellFormed` goals. It is quite
      // rare, but possible, that we encounter them during
      // evaluation. See #158665 for more details here.
      if (this.tcx().is_dyn_compatible(trait_def_id)) {
        return Ok("EvaluatedToOk");
      } else {
        return Ok("EvaluatedToErr");
      }
    }

    case "ConstEquate": {
      const c1 = kind._0;
      const c2 = kind._1;
      const tcx = this.tcx();
      assert(tcx.features().generic_const_exprs(), `\`ConstEquate\` without a feature gate: ${debug_Const(c1, PLAIN)} ${debug_Const(c2, PLAIN)}`);

      {
        const c1_ = tcx.expand_abstract_consts(c1, fold_Const);
        const c2_ = tcx.expand_abstract_consts(c2, fold_Const);
        // debug!("evaluate_predicate_recursively: equating consts:\nc1= {:?}\nc2= {:?}", c1, c2);

        const k1 = c1_.kind();
        const k2 = c2_.kind();
        if (
          k1.$ === "Alias" &&
          k2.$ === "Alias" &&
          intern_key(k1._1.kind) === intern_key(k2._1.kind) &&
          (k1._1.kind.$ === "Projection" || k1._1.kind.$ === "InherentSelf" || k1._1.kind.$ === "InherentImpl")
        ) {
          const a = k1._1;
          const b = k2._1;
          const r = this.infcx
            .at(obligation.cause, obligation.param_env)
            // Can define opaque types as this is only reachable with
            // `generic_const_exprs`
            .eq(DefineOpaqueTypes.Yes, AliasTermC.from_AliasConst(a), AliasTermC.from_AliasConst(b), ToTrace_AliasTerm);
          if (r.$ === "Ok") {
            return this.evaluate_predicates_recursively(previous_stack, r._0.obligations);
          }
        } else if (k2.$ === "Alias" || k1.$ === "Alias") {
          // ()
        } else {
          const r = this.infcx
            .at(obligation.cause, obligation.param_env)
            // Can define opaque types as this is only reachable with
            // `generic_const_exprs`
            .eq(DefineOpaqueTypes.Yes, c1_, c2_, ToTrace_Const);
          if (r.$ === "Ok") {
            return this.evaluate_predicates_recursively(previous_stack, r._0.obligations);
          }
        }
      }

      const evaluate = (c: Const): Result<Const, EvaluateConstErr<never>> => {
        if (c.kind().$ === "Alias") {
          return traits.try_evaluate_const<never>(this.infcx, c, obligation.param_env, (v) => Ok(Unnormalized.skip_norm_wip(v)));
        } else {
          return Ok(c);
        }
      };

      const r1 = evaluate(c1);
      const r2 = evaluate(c2);
      const e1 = r1.$ === "Err" ? r1._0 : undefined;
      const e2 = r2.$ === "Err" ? r2._0 : undefined;
      if (r1.$ === "Ok" && r2.$ === "Ok") {
        const r = this.infcx.at(obligation.cause, obligation.param_env).eq(
          // Can define opaque types as this is only reachable with
          // `generic_const_exprs`
          DefineOpaqueTypes.Yes,
          r1._0,
          r2._0,
          ToTrace_Const,
        );
        if (r.$ === "Ok") {
          return this.evaluate_predicates_recursively(previous_stack, r._0.into_obligations());
        } else {
          return Ok("EvaluatedToErr");
        }
      } else if (e1?.$ === "InvalidConstParamTy" || e2?.$ === "InvalidConstParamTy") {
        return Ok("EvaluatedToErr");
      } else if (e1?.$ === "EvaluationFailure" || e2?.$ === "EvaluationFailure") {
        return Ok("EvaluatedToErr");
      } else {
        // (Err(EvaluateConstErr::HasGenericsOrInfers), _) | (_, Err(EvaluateConstErr::HasGenericsOrInfers))
        if (TypeVisitableExt.has_non_region_infer(c1, fold_Const) || TypeVisitableExt.has_non_region_infer(c2, fold_Const)) {
          return Ok("EvaluatedToAmbig");
        } else {
          // Two different constants using generic parameters ~> error.
          return Ok("EvaluatedToErr");
        }
      }
    }
    case "NormalizesTo":
      return bug("NormalizesTo is only used by the new solver");
    case "Ambiguous":
      return Ok("EvaluatedToAmbig");
  }
  return unreachable();
};

// #[instrument(skip(self, previous_stack), level = "debug", ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:931 evaluate_trait_predicate_recursively
SelectionContext.prototype.evaluate_trait_predicate_recursively = function (
  this: SelectionContext,
  previous_stack: TraitObligationStackList,
  obligation_: PolyTraitObligation,
): Result<EvaluationResult, OverflowError> {
  // debug_assert!(!self.typing_mode().is_coherence(), "old solver coherence");
  let obligation = obligation_;

  if (
    TypeVisitableExt.is_global(obligation, d_PolyTraitObligation()) &&
    all_iter(obligation.param_env.caller_bounds(), (bound) => TypeVisitableExt.has_param(bound, fold_Clause))
  ) {
    // If a param env has no global bounds, global obligations do not
    // depend on its particular value in order to work, so we can clear
    // out the param env and get better caching.
    // debug!("in global");
    // PORT: `obligation` is owned (`mut obligation`): a new value with the field replaced.
    obligation = new Obligation(obligation.cause, ParamEnvC.empty(), obligation.predicate, obligation.recursion_depth);
  }

  const stack = this.push_stack(previous_stack, obligation);
  const fresh_trait_pred = stack.fresh_trait_pred;
  const param_env = obligation.param_env;

  // debug!(?fresh_trait_pred);

  // If a trait predicate is in the (local or global) evaluation cache,
  // then we know it holds without cycles.
  {
    const result = this.check_evaluation_cache(param_env, fresh_trait_pred);
    if (result !== undefined) {
      // debug!("CACHE HIT");
      return Ok(result);
    }
  }

  {
    const result = stack.cache().get_provisional(fresh_trait_pred);
    if (result !== undefined) {
      // debug!("PROVISIONAL CACHE HIT");
      stack.update_reached_depth(result.reached_depth);
      return Ok(result.result);
    }
  }

  // Check if this is a match for something already on the
  // stack. If so, we don't want to insert the result into the
  // main cache (it is cycle dependent) nor the provisional
  // cache (which is meant for things that have completed but
  // for a "backedge" -- this result *is* the backedge).
  {
    const cycle_result = this.check_evaluation_cycle(stack);
    if (cycle_result !== undefined) {
      return Ok(cycle_result);
    }
  }

  const [result_, dep_node] = this.in_task((this_): Result<EvaluationResult, OverflowError> => {
    const r = this_.evaluate_stack(stack);
    if (r.$ === "Err") return r;
    let result = r._0;

    // fix issue #103563, we don't normalize
    // nested obligations which produced by `TraitDef` candidate
    // (i.e. using bounds on assoc items as assumptions).
    // because we don't have enough information to
    // normalize these obligations before evaluating.
    // so we will try to normalize the obligation and evaluate again.
    // we will replace it with new solver in the future.
    if (
      "EvaluatedToErr" === result &&
      TypeVisitableExt.has_aliases(fresh_trait_pred, d_PolyTraitClause()) &&
      TypeVisitableExt.is_global(fresh_trait_pred, d_PolyTraitClause())
    ) {
      const nested_obligations: PredicateObligations = [];
      const predicate = traits_mod().normalize.normalize_with_depth_to(
        this_,
        param_env,
        clone_ObligationCause(obligation.cause),
        obligation.recursion_depth + 1,
        Unnormalized.new_wip(obligation.predicate),
        nested_obligations,
        d_PolyTraitClause(),
      );
      if (intern_key(predicate) !== intern_key(obligation.predicate)) {
        let nested_result: EvaluationResult = "EvaluatedToOk";
        for (const obligation of nested_obligations) {
          const r = this_.evaluate_predicate_recursively(previous_stack, obligation);
          if (r.$ === "Err") return r;
          nested_result = max_EvaluationResult(r._0, nested_result);
        }

        if (EvaluationResult.must_apply_modulo_regions(nested_result)) {
          const obligation_ = obligation.with(this_.tcx(), predicate, (p: PolyTraitClause) => p);
          const r = this_.evaluate_trait_predicate_recursively(previous_stack, obligation_);
          if (r.$ === "Err") return r;
          result = max_EvaluationResult(nested_result, r._0);
        }
      }
    }

    return Ok(result);
  });

  if (result_.$ === "Err") return result_;
  const result = result_._0;

  if (!EvaluationResult.must_apply_modulo_regions(result)) {
    stack.cache().on_failure(stack.dfn);
  }

  const reached_depth = stack.reached_depth;
  if (reached_depth >= stack.depth) {
    // debug!("CACHE MISS");
    this.insert_evaluation_cache(param_env, fresh_trait_pred, dep_node, result);
    stack.cache().on_completion(stack.dfn);
  } else if (this.infcx.tainted_by_errors() !== undefined) {
    // When an error has occurred, we allow global caching of results even if they
    // appear stack-dependent. This prevents exponential re-evaluation of cycles
    // in the presence of errors, avoiding compiler hangs like #150907.
    // This is safe because compilation will fail anyway.
    // debug!("CACHE MISS (tainted by errors)");
    this.insert_evaluation_cache(param_env, fresh_trait_pred, dep_node, result);
    stack.cache().on_completion(stack.dfn);
  } else {
    // debug!("PROVISIONAL");
    // debug!("caching provisionally because {:?} is a cycle participant (at depth {}, reached depth {})", ..);

    stack.cache().insert_provisional(stack.dfn, reached_depth, fresh_trait_pred, result);
  }

  return Ok(result);
};

/// If there is any previous entry on the stack that precisely
/// matches this obligation, then we can assume that the
/// obligation is satisfied for now (still all other conditions
/// must be met of course). One obvious case this comes up is
/// marker traits like `Send`. Think of a linked list:
///
///     struct List<T> { data: T, next: Option<Box<List<T>>> }
///
/// `Box<List<T>>` will be `Send` if `T` is `Send` and
/// `Option<Box<List<T>>>` is `Send`, and in turn
/// `Option<Box<List<T>>>` is `Send` if `Box<List<T>>` is
/// `Send`.
///
/// Note that we do this comparison using the `fresh_trait_pred`
/// fields. Because these have all been freshened using
/// `self.freshener`, we can be sure that (a) this will not
/// affect the inferencer state and (b) that if we see two
/// fresh regions with the same index, they refer to the same
/// unbound type variable.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1073 check_evaluation_cycle
SelectionContext.prototype.check_evaluation_cycle = function (this: SelectionContext, stack: TraitObligationStack): EvaluationResult | undefined {
  let cycle_depth: number | undefined;
  {
    const fresh_key = intern_key(stack.fresh_trait_pred);
    const it = stack.iter();
    it.next(); // Skip top-most frame.
    for (let prev = it.next(); prev !== undefined; prev = it.next()) {
      if (ParamEnv_eq(stack.obligation.param_env, prev.obligation.param_env) && fresh_key === intern_key(prev.fresh_trait_pred)) {
        cycle_depth = prev.depth;
        break;
      }
    }
  }
  if (cycle_depth !== undefined) {
    // debug!("evaluate_stack --> recursive at depth {}", cycle_depth);

    // If we have a stack like `A B C D E A`, where the top of
    // the stack is the final `A`, then this will iterate over
    // `A, E, D, C, B` -- i.e., all the participants apart
    // from the cycle head. We mark them as participating in a
    // cycle. This suppresses caching for those nodes. See
    // `in_cycle` field for more details.
    stack.update_reached_depth(cycle_depth);

    // Subtle: when checking for a coinductive cycle, we do
    // not compare using the "freshened trait refs" (which
    // have erased regions) but rather the fully explicit
    // trait refs. This is important because it's only a cycle
    // if the regions match exactly.
    const it = stack.iter();
    it.next(); // skip(1)
    const cd = cycle_depth;
    const cycle = take_while(it, (s) => s.depth >= cd);
    const tcx = this.tcx();
    const cycle_ = map_iter(cycle, (stack) => Predicate_upcast_from_PolyTraitClause(stack.obligation.predicate, tcx));
    if (this.coinductive_match(cycle_)) {
      // debug!("evaluate_stack --> recursive, coinductive");
      return "EvaluatedToOk";
    } else {
      // debug!("evaluate_stack --> recursive, inductive");
      return "EvaluatedToAmbigStackDependent";
    }
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1116 evaluate_stack
SelectionContext.prototype.evaluate_stack = function (this: SelectionContext, stack: TraitObligationStack): Result<EvaluationResult, OverflowError> {
  // debug_assert!(!self.infcx.next_trait_solver());
  // In intercrate mode, whenever any of the generics are unbound,
  // there can always be an impl. Even if there are no impls in
  // this crate, perhaps the type would be unified with
  // something from another crate that does provide an impl.
  //
  // In intra mode, we must still be conservative. The reason is
  // that we want to avoid cycles. Imagine an impl like:
  //
  //     impl<T:Eq> Eq for Vec<T>
  //
  // and a trait reference like `$0 : Eq` where `$0` is an
  // unbound variable. When we evaluate this trait-reference, we
  // will unify `$0` with `Vec<$1>` (for some fresh variable
  // `$1`), on the condition that `$1 : Eq`. We will then wind
  // up with many candidates (since that are other `Eq` impls
  // that apply) and try to winnow things down. This results in
  // a recursive evaluation that `$1 : Eq` -- as you can
  // imagine, this is just where we started. To avoid that, we
  // check for unbound variables and return an ambiguous (hence possible)
  // match if we've seen this trait before.
  //
  // This suffices to allow chains like `FnMut` implemented in
  // terms of `Fn` etc, but we could probably make this more
  // precise still.
  //
  // FIXME(gca_min_const_items): Consider consts as well?
  const unbound_input_types = any_iter(Binder.skip_binder(stack.fresh_trait_pred).trait_ref.args.types(), (ty) => ty.is_fresh());

  if (unbound_input_types) {
    const it = stack.iter();
    it.next(); // skip(1)
    let any = false;
    for (let prev = it.next(); prev !== undefined; prev = it.next()) {
      if (ParamEnv_eq(stack.obligation.param_env, prev.obligation.param_env) && this.match_fresh_trait_preds(stack.fresh_trait_pred, prev.fresh_trait_pred)) {
        any = true;
        break;
      }
    }
    if (any) {
      // debug!("evaluate_stack --> unbound argument, recursive --> giving up");
      return Ok("EvaluatedToAmbigStackDependent");
    }
  }

  const r = this.candidate_from_obligation(stack);
  if (r.$ === "Ok" && r._0 !== undefined) {
    return this.evaluate_candidate(stack, r._0);
  } else if (r.$ === "Ok") {
    return Ok("EvaluatedToAmbig");
  } else if (r._0.$ === "Overflow" && r._0._0.$ === "Canonical") {
    return Err(OverflowError.Canonical);
  } else {
    return Ok("EvaluatedToErr");
  }
};

/// For defaulted traits, we use a co-inductive strategy to solve, so
/// that recursion is ok. This routine returns `true` if the top of the
/// stack (`cycle[0]`):
///
/// - is a coinductive trait: an auto-trait or `Sized`,
/// - it also appears in the backtrace at some position `X`,
/// - all the predicates at positions `X..` between `X` and the top are
///   also coinductive traits.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1178 coinductive_match
SelectionContext.prototype.coinductive_match = function (this: SelectionContext, cycle: Iterable<Predicate>): boolean {
  for (const p of cycle) {
    const k = Binder.skip_binder(p.kind());
    let ok: boolean;
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      ok = this.infcx.tcx.trait_is_coinductive(TraitClause.def_id(k._0._0));
    } else if (k.$ === "Clause" && k._0.$ === "WellFormed") {
      // FIXME(generic_const_exprs): GCE needs well-formedness predicates to be
      // coinductive, but GCE is on the way out anyways, so this should eventually
      // be replaced with `false`.
      ok = this.infcx.tcx.features().generic_const_exprs();
    } else {
      ok = false;
    }
    if (!ok) return false;
  }
  return true;
};

/// Further evaluates `candidate` to decide whether all type parameters match and whether nested
/// obligations are met. Returns whether `candidate` remains viable after this further
/// scrutiny.
// #[instrument(level = "debug", skip(self, stack), fields(depth = stack.obligation.recursion_depth), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1205 evaluate_candidate
SelectionContext.prototype.evaluate_candidate = function (
  this: SelectionContext,
  stack: TraitObligationStack,
  candidate: SelectionCandidate,
): Result<EvaluationResult, OverflowError> {
  const r = this.evaluation_probe((this_) => {
    const c = this_.confirm_candidate(stack.obligation, clone_SelectionCandidate(candidate));
    if (c.$ === "Ok") {
      const selection = c._0;
      // debug!(?selection);
      if (selection.$ === "Builtin" && TypingMode.is_reflection(this_.typing_mode())) {
        return Ok("EvaluatedToErr");
      }
      return this_.evaluate_predicates_recursively(stack.list(), ImplSource.nested_obligations(selection));
    } else {
      return Ok("EvaluatedToErr");
    }
  });
  if (r.$ === "Err") return r;
  let result = r._0;

  // If we erased any lifetimes, then we want to use
  // `EvaluatedToOkModuloRegions` instead of `EvaluatedToOk`
  // as your final result. The result will be cached using
  // the freshened trait predicate as a key, so we need
  // our result to be correct by *any* choice of original lifetimes,
  // not just the lifetime choice for this particular (non-erased)
  // predicate.
  // See issue #80691
  if (TypeVisitableExt.has_erased_regions(stack.fresh_trait_pred, d_PolyTraitClause())) {
    result = max_EvaluationResult(result, "EvaluatedToOkModuloRegions");
  }

  return Ok(result);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1243 check_evaluation_cache
SelectionContext.prototype.check_evaluation_cache = function (
  this: SelectionContext,
  param_env: ParamEnv,
  trait_pred: PolyTraitClause,
): EvaluationResult | undefined {
  const infcx = this.infcx;
  const tcx = infcx.tcx;
  if (this.can_use_global_caches(param_env, trait_pred)) {
    const key: [TypingEnv, PolyTraitClause] = [infcx.typing_env(param_env), trait_pred];
    const res = tcx.caches.evaluation_cache.get(key, tcx);
    if (res !== undefined) {
      return res;
    } else {
      // debug_assert_eq!(infcx.evaluation_cache.get(&(param_env, trait_pred), tcx), None);
      return undefined;
    }
  } else {
    return this.infcx.evaluation_cache.get([param_env, trait_pred], tcx);
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1263 insert_evaluation_cache
SelectionContext.prototype.insert_evaluation_cache = function (
  this: SelectionContext,
  param_env: ParamEnv,
  trait_pred: PolyTraitClause,
  dep_node: DepNodeIndex,
  result: EvaluationResult,
): void {
  // Avoid caching results that depend on more than just the trait-ref
  // - the stack can create recursion.
  if (EvaluationResult.is_stack_dependent(result)) {
    return;
  }

  const infcx = this.infcx;
  const tcx = infcx.tcx;
  if (this.can_use_global_caches(param_env, trait_pred)) {
    // debug!(?trait_pred, ?result, "insert_evaluation_cache global");
    // This may overwrite the cache with the same value
    tcx.caches.evaluation_cache.insert([infcx.typing_env(param_env), trait_pred], dep_node, result);
    return;
  } else {
    // debug!(?trait_pred, ?result, "insert_evaluation_cache local");
    this.infcx.evaluation_cache.insert([param_env, trait_pred], dep_node, result);
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1293 check_recursion_depth
SelectionContext.prototype.check_recursion_depth = function <T>(
  this: SelectionContext,
  depth: number,
  error_obligation: Obligation<T>,
  _upcast_from_T: (from: T, tcx: Interner) => Predicate,
): Result<null, OverflowError> {
  if (!this.infcx.tcx.recursion_limit().value_within_limit(depth)) {
    switch (this.query_mode) {
      case "Standard": {
        const e = this.infcx.tainted_by_errors();
        if (e !== undefined) {
          return Err({ $: "Error", _0: e });
        }
        traits_mod().err_ctxt(this.infcx).report_overflow_obligation(error_obligation, true);
        break;
      }
      case "Canonical": {
        return Err(OverflowError.Canonical);
      }
    }
  }
  return Ok(null);
};

/// Checks that the recursion limit has not been exceeded.
///
/// The weird return type of this function allows it to be used with the `try` (`?`)
/// operator within certain functions.
// #[inline(always)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1322 check_recursion_limit
SelectionContext.prototype.check_recursion_limit = function <T, V>(
  this: SelectionContext,
  obligation: Obligation<T>,
  error_obligation: Obligation<V>,
  upcast_from_V: (from: V, tcx: Interner) => Predicate,
): Result<null, OverflowError> {
  return this.check_recursion_depth(obligation.recursion_depth, error_obligation, upcast_from_V);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1333 in_task
SelectionContext.prototype.in_task = function <R>(this: SelectionContext, op: (selcx: SelectionContext) => R): [R, DepNodeIndex] {
  return this.tcx().dep_graph.with_anon_task(this.tcx(), "TraitSelect", () => op(this));
};

/// filter_impls filters candidates that have a positive impl for a negative
/// goal and a negative impl for a positive goal
// #[instrument(level = "debug", skip(self, candidates))]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1343 filter_impls
SelectionContext.prototype.filter_impls = function (
  this: SelectionContext,
  candidates: SelectionCandidate[],
  obligation: PolyTraitObligation,
): SelectionCandidate[] {
  // trace!("{candidates:#?}");
  const tcx = this.tcx();

  // `candidates.retain(..)`
  const retained = candidates.filter((candidate) => {
    if (candidate.$ === "ImplCandidate") {
      const def_id = candidate._0;
      const ip = tcx.impl_polarity(def_id);
      const op = obligation.polarity();
      if ((ip === "Positive" && op === "Positive") || (ip === "Negative" && op === "Negative")) {
        return true;
      } else {
        // remove impl candidates with mismatched polarity to the obligation
        return false;
      }
    } else {
      return true;
    }
  });
  candidates.length = 0;
  candidates.push(...retained);

  // trace!("{candidates:#?}");
  return candidates;
};

/// Returns `true` if the global caches can be used.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1370 can_use_global_caches
SelectionContext.prototype.can_use_global_caches = function (this: SelectionContext, param_env: ParamEnv, pred: PolyTraitClause): boolean {
  // If there are any inference variables in the `ParamEnv`, then we
  // always use a cache local to this particular scope. Otherwise, we
  // switch to a global cache.
  if (TypeVisitableExt.has_infer(param_env, d_ParamEnv()) || TypeVisitableExt.has_infer(pred, d_PolyTraitClause())) {
    return false;
  }

  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    // Avoid using the global cache when we're defining opaque types
    // as their hidden type may impact the result of candidate selection.
    //
    // HACK: This is still theoretically unsound. Goals can indirectly rely
    // on opaques in the defining scope, and it's easier to do so with TAIT.
    // However, if we disqualify *all* goals from being cached, perf suffers.
    // This is likely fixed by better caching in general in the new solver.
    // See: <https://github.com/rust-lang/rust/issues/132064>.
    case "Typeck":
    case "PostTypeckUntilBorrowck": {
      const defining_opaque_types = typing_mode.$ === "Typeck" ? typing_mode.defining_opaque_types_and_generators : typing_mode.defining_opaque_types;
      return (
        defining_opaque_types.length === 0 ||
        (!TypeVisitableExt.has_opaque_types(pred, d_PolyTraitClause()) && !TypeVisitableExt.has_coroutines(pred, d_PolyTraitClause()))
      );
    }
    // Impls that are not fully generic are completely ignored as "nonexistent"
    // in this mode, so the results wildly differ from normal trait solving.
    case "Reflection":
      return false;
    // The hidden types of `defined_opaque_types` is not local to the current
    // inference context, so we can freely move this to the global cache.
    case "PostBorrowck":
      return true;
    // The global cache is only used if there are no opaque types in
    // the defining scope or we're outside of analysis.
    //
    // FIXME(#132279): This is still incorrect as we treat opaque types
    // and default associated items differently between these two modes.
    case "PostAnalysis":
    case "Codegen":
      return true;
    case "Coherence":
      return unreachable("internal error: entered unreachable code: old solver coherence");
    // PORT: `TypingMode<CantBeErased>`: `ErasedNotCoherence(!)` is uninhabited (not a match arm upstream).
    case "ErasedNotCoherence":
      return unreachable();
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1414 check_candidate_cache
SelectionContext.prototype.check_candidate_cache = function (
  this: SelectionContext,
  param_env: ParamEnv,
  cache_fresh_trait_pred: PolyTraitClause,
): SelectionResult<SelectionCandidate> | undefined {
  const infcx = this.infcx;
  const tcx = infcx.tcx;
  const pred = Binder.skip_binder(cache_fresh_trait_pred);

  if (this.can_use_global_caches(param_env, cache_fresh_trait_pred)) {
    const res = tcx.caches.selection_cache.get([infcx.typing_env(param_env), pred], tcx);
    if (res !== undefined) {
      return res;
    } else if (false /* cfg!(debug_assertions) */) {
      // match infcx.selection_cache.get(&(param_env, pred), tcx) {
      //     None | Some(Err(SelectionError::Overflow(OverflowError::Canonical))) => {}
      //     res => bug!("unexpected local cache result: {res:?}"),
      // }
    }
  }

  // Subtle: we need to check the local cache even if we're able to use the
  // global cache as we don't cache overflow in the global cache but need to
  // cache it as otherwise rustdoc hangs when compiling diesel.
  return infcx.selection_cache.get([param_env, pred], tcx);
};

/// Determines whether can we safely cache the result
/// of selecting an obligation. This is almost always `true`,
/// except when dealing with certain `ParamCandidate`s.
///
/// Ordinarily, a `ParamCandidate` will contain no inference variables,
/// since it was usually produced directly from a `DefId`. However,
/// certain cases (currently only librustdoc's blanket impl finder),
/// a `ParamEnv` may be explicitly constructed with inference types.
/// When this is the case, we do *not* want to cache the resulting selection
/// candidate. This is due to the fact that it might not always be possible
/// to equate the obligation's trait ref and the candidate's trait ref,
/// if more constraints end up getting added to an inference variable.
///
/// Because of this, we always want to re-run the full selection
/// process for our obligation the next time we see it, since
/// we might end up picking a different `SelectionCandidate` (or none at all).
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1458 can_cache_candidate
SelectionContext.prototype.can_cache_candidate = function (this: SelectionContext, result: SelectionResult<SelectionCandidate>): boolean {
  if (result.$ === "Ok" && result._0 !== undefined && result._0.$ === "ParamCandidate") {
    const trait_ref = result._0._0;
    return !TypeVisitableExt.has_infer(trait_ref, d_PolyTraitClause());
  } else {
    return true;
  }
};

// #[instrument(skip(self, param_env, cache_fresh_trait_pred, dep_node), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1469 insert_candidate_cache
SelectionContext.prototype.insert_candidate_cache = function (
  this: SelectionContext,
  param_env: ParamEnv,
  cache_fresh_trait_pred: PolyTraitClause,
  dep_node: DepNodeIndex,
  candidate: SelectionResult<SelectionCandidate>,
): void {
  const infcx = this.infcx;
  const tcx = infcx.tcx;
  const pred = Binder.skip_binder(cache_fresh_trait_pred);

  if (!this.can_cache_candidate(candidate)) {
    // debug!(?pred, ?candidate, "insert_candidate_cache - candidate is not cacheable");
    return;
  }

  if (this.can_use_global_caches(param_env, cache_fresh_trait_pred)) {
    if (candidate.$ === "Err" && candidate._0.$ === "Overflow" && candidate._0._0.$ === "Canonical") {
      // Don't cache overflow globally; we only produce this in certain modes.
    } else {
      // debug!(?pred, ?candidate, "insert_candidate_cache global");
      // debug_assert!(!candidate.has_infer());

      // This may overwrite the cache with the same value.
      tcx.caches.selection_cache.insert([infcx.typing_env(param_env), pred], dep_node, candidate);
      return;
    }
  }

  // debug!(?pred, ?candidate, "insert_candidate_cache local");
  this.infcx.selection_cache.insert([param_env, pred], dep_node, candidate);
};

/// Looks at the item bounds of the projection or opaque type.
/// If this is a nested rigid projection, such as
/// `<<T as Tr1>::Assoc as Tr2>::Assoc`, consider the item bounds
/// on both `Tr1::Assoc` and `Tr2::Assoc`, since we may encounter
/// relative bounds on both via the `associated_type_bounds` feature.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1511 for_each_item_bound
SelectionContext.prototype.for_each_item_bound = function <T>(
  this: SelectionContext,
  self_ty_: Ty,
  for_each: (selcx: SelectionContext, clause: Clause, idx: number, kind: AliasBoundKind) => ControlFlow<T, null>,
  on_ambiguity: () => void,
): ControlFlow<T, null> {
  let self_ty = self_ty_;
  let idx = 0;
  let alias_bound_kind: AliasBoundKind = "SelfBounds";

  for (;;) {
    let alias_ty: AliasTyT;
    let def_id: DefId;
    const k = self_ty.kind();
    if (k.$ === "Alias" && (k._1.kind.$ === "Projection" || k._1.kind.$ === "Opaque")) {
      alias_ty = k._1;
      def_id = k._1.kind.def_id;
    } else if (k.$ === "Infer" && k._0.$ === "TyVar") {
      on_ambiguity();
      return ControlFlow.CONTINUE;
    } else {
      return ControlFlow.CONTINUE;
    }

    // HACK: On subsequent recursions, we only care about bounds that don't
    // share the same type as `self_ty`. This is because for truly rigid
    // projections, we will never be able to equate, e.g. `<T as Tr>::A`
    // with `<<T as Tr>::A as Tr>::A`.
    const relevant_bounds = (
      alias_bound_kind === "NonSelfBounds" ? this.tcx().item_non_self_bounds(def_id) : this.tcx().item_self_bounds(def_id)
    ) as EarlyBinder<Clauses>;

    for (const bound of Unnormalized.skip_norm_wip(EarlyBinder.instantiate(relevant_bounds, this.tcx(), alias_ty.args, fold_Clauses))) {
      const r = for_each(this, bound, idx, alias_bound_kind);
      if (r.$ === "Break") return r;
      idx += 1;
    }

    if (alias_ty.kind.$ === "Projection") {
      self_ty = AliasTy.self_ty(alias_ty);
    } else {
      return ControlFlow.CONTINUE;
    }

    alias_bound_kind = "NonSelfBounds";
  }
};

/// Equates the trait in `obligation` with trait bound. If the two traits
/// can be equated and the normalized trait bound doesn't contain inference
/// variables or placeholders, the normalized bound is returned.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1569 match_normalize_trait_ref
SelectionContext.prototype.match_normalize_trait_ref = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  placeholder_trait_ref: TraitRef,
  trait_bound_: PolyTraitRef,
): Result<TraitRef | undefined, null> {
  // debug_assert!(!placeholder_trait_ref.has_escaping_bound_vars());
  if (!DefId_eq(placeholder_trait_ref.def_id, PolyTraitRefC.def_id(trait_bound_))) {
    // Avoid unnecessary normalization
    return Err(null);
  }

  const drcx = DeepRejectCtxt.relate_rigid_rigid(as_interner(this.infcx.tcx));
  const obligation_args = Binder.skip_binder(obligation.predicate).trait_ref.args;
  if (!drcx.args_may_unify(obligation_args, Binder.skip_binder(trait_bound_).args)) {
    return Err(null);
  }

  const trait_bound__ = this.infcx.instantiate_binder_with_fresh_vars(obligation.cause.span, BoundRegionConversionTime.HigherRankedType, trait_bound_, d_TraitRef());
  const { value: trait_bound } = traits_mod().normalize.normalize_with_depth(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    Unnormalized.new_wip(trait_bound__),
    d_TraitRef(),
  );
  const r = this.infcx.at(obligation.cause, obligation.param_env).eq(DefineOpaqueTypes.No, placeholder_trait_ref, trait_bound, ToTrace_TraitRef);
  if (r.$ === "Ok") {
    // This method is called within a probe, so we can't have
    // inference variables and placeholders escape.
    if (!TypeVisitableExt.has_infer(trait_bound, d_TraitRef()) && !TypeVisitableExt.has_placeholders(trait_bound, d_TraitRef())) {
      return Ok(trait_bound);
    } else {
      return Ok(undefined);
    }
  } else {
    return Err(null);
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1614 where_clause_may_apply
SelectionContext.prototype.where_clause_may_apply = function (
  this: SelectionContext,
  stack: TraitObligationStack,
  where_clause_trait_ref: PolyTraitRef,
): Result<EvaluationResult, OverflowError> {
  return this.evaluation_probe((this_) => {
    const r = this_.match_where_clause_trait_ref(stack.obligation, where_clause_trait_ref);
    if (r.$ === "Ok") {
      return this_.evaluate_predicates_recursively(stack.list(), r._0);
    } else {
      return Ok("EvaluatedToErr");
    }
  });
};

/// Return `Yes` if the obligation's predicate type applies to the env_predicate, and
/// `No` if it does not. Return `Ambiguous` in the case that the projection type is a GAT,
/// and applying this env_predicate constrains any of the obligation's GAT parameters.
///
/// This behavior is a somewhat of a hack to prevent over-constraining inference variables
/// in cases like #91762.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1633 match_projection_projections
SelectionContext.prototype.match_projection_projections = function (
  this: SelectionContext,
  obligation: ProjectionTermObligation,
  env_predicate: PolyProjectionClause,
  potentially_unnormalized_candidates: boolean,
): ProjectionMatchesProjection {
  const def_id = AliasTermC.expect_projection_def_id(obligation.predicate);
  // debug_assert_eq!(def_id, env_predicate.item_def_id());

  const nested_obligations: PredicateObligations = [];
  const infer_predicate = this.infcx.instantiate_binder_with_fresh_vars(
    obligation.cause.span,
    BoundRegionConversionTime.HigherRankedType,
    env_predicate,
    d_ProjectionClause(),
  );
  let infer_projection = infer_predicate.projection_term;
  if (potentially_unnormalized_candidates) {
    infer_projection = traits_mod().normalize.normalize_with_depth_to(
      this,
      obligation.param_env,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      Unnormalized.new_wip(infer_projection),
      nested_obligations,
      d_AliasTerm(),
    );
  }

  const eq = this.infcx.at(obligation.cause, obligation.param_env).eq(DefineOpaqueTypes.No, obligation.predicate, infer_projection, ToTrace_AliasTerm);
  let is_match: boolean;
  if (eq.$ === "Ok") {
    const obligations = eq._0.obligations;
    const r = this.evaluate_predicates_recursively(TraitObligationStackList.empty(ProvisionalEvaluationCache.default()), [
      ...nested_obligations,
      ...obligations,
    ]);
    is_match = r.$ === "Ok" && EvaluationResult.may_apply(r._0);
  } else {
    is_match = false;
  }

  if (is_match) {
    const generics = this.tcx().generics_of(def_id) as Generics;
    // FIXME(generic_associated_types): Addresses aggressive inference in #92917.
    // If this type is a GAT, and of the GAT args resolve to something new,
    // that means that we must have newly inferred something about the GAT.
    // We should give up in that case.
    //
    // This only detects one layer of inference, which is probably not what we actually
    // want, but fixing it causes some ambiguity:
    // <https://github.com/rust-lang/rust/issues/125196>.
    if (
      !generics.is_own_empty() &&
      obligation.predicate.args.slice(generics.parent_count).some((p) => {
        if (!TypeVisitableExt.has_non_region_infer(p, fold_GenericArg)) return false;
        const pk = GenericArg.kind(p);
        if (pk.$ === "Const") {
          const ct = pk._0;
          return this.infcx.shallow_resolve_const(ct) !== ct;
        } else if (pk.$ === "Type") {
          const ty = pk._0;
          return this.infcx.shallow_resolve(ty) !== ty;
        } else {
          // ty::GenericArgKind::Lifetime(_)
          return false;
        }
      })
    ) {
      return "Ambiguous";
    } else {
      return "Yes";
    }
  } else {
    return "No";
  }
};

// ==== lane old-select-b: mod.rs:1704..2797 (winnowing, builtin rules and helpers) ===================================
//
// PORT (old-select-b):
// - The imports of this region sit here (ESM hoists them), apart from the other lanes' blocks to ease the merge.
// - Other rustc_trait_selection modules (normalize.rs, util.rs) are read lazily inside the bodies (init order: module
//   comment); `./_match.ts` only imports other crates, so it is a static import.
// - Derived `PartialEq` of `PolyTraitClause` / `TraitRef` is the `eq` of their `Relate` descriptors (rustc_type_ir
//   relate.ts: `Binder` compares the value and the interned `bound_vars`; the structs compare by `intern_key`).
// - `Iterator::try_reduce` with an `Option`-returning closure is `try_reduce` below; its `Option<Option<T>>` is
//   `{ $: "Some", _0: T | undefined } | undefined` (PORTING §5).
// - `bug!` / `unreachable!(..)` texts are verbatim (`unreachable!(msg)` panics with core's
//   "internal error: entered unreachable code: msg").

import { ToTrace_PolyExistentialProjection, ToTrace_PolyExistentialTraitRef } from "../../../rustc_infer/infer/at.ts";
import { Normalized } from "../../../rustc_infer/traits/project.gen.ts";
import { ObligationCause, type ObligationCauseCode } from "../../../rustc_middle/traits/mod.ts";
import { EvaluationResult as EvaluationResultC } from "../../../rustc_middle/traits/select.ts";
import type { GenericArgs, Region as RegionT } from "../../../rustc_middle/ty/decls.ts";
import { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { RawList, type List } from "../../../rustc_middle/ty/list.ts";
import { debug_Ty, type ImplTraitHeader } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_PolyRegionOutlivesClause, Predicate_upcast_from_TraitRef, type PolyExistentialPredicate } from "../../../rustc_middle/ty/predicate.ts";
import { DefIdSet, debug_DefId } from "../../../rustc_span/def_id.ts";
import type { CoroutineWitnessTypes, ExistentialProjection, ExistentialTraitRef as ExistentialTraitRefT, RegionOutlivesClause, TraitRef as TraitRefT } from "../../../rustc_type_ir/decls.ts";
import { supertrait_def_ids } from "../../../rustc_type_ir/elaborate.ts";
import { fold_Vec } from "../../../rustc_type_ir/fold.ts";
import { ExistentialTraitRef, PolyExistentialProjection, TraitRef as TraitRefC, visit_with_OutlivesClause } from "../../../rustc_type_ir/predicate.ts";
import { relate_Binder, relate_ExistentialProjection, relate_ExistentialTraitRef, relate_TraitClause, relate_TraitRef } from "../../../rustc_type_ir/relate.ts";
import type { SizedTraitKind } from "../../../rustc_type_ir/solve/mod.ts";
import { fold_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { fold_with_CoroutineWitnessTypes, try_fold_with_CoroutineWitnessTypes, UnsafeBinderInner, visit_with_CoroutineWitnessTypes } from "../../../rustc_type_ir/ty_kind.ts";
import { format_debug, debug_option } from "../../../std/fmt.ts";
import { assert_eq } from "../../../std/panic.ts";
import { MatchAgainstFreshVars } from "./_match.ts";
import { type AutoImplConstituents, visit_with_AutoImplConstituents } from "./mod.gen.ts";

/** Lazily read modules of this crate (init order: module comment). */
function normalize_mod_b(): typeof import("../normalize.ts") {
  return require("../normalize.ts") as typeof import("../normalize.ts");
}
function util_mod_b(): typeof import("../util.ts") {
  return require("../util.ts") as typeof import("../util.ts");
}

/** D4 descriptor of `ty::PolyTraitClause` (`Binder<TraitClause>`: `TypeFoldable` + `PartialEq` + `Relate`). */
const d_PolyTraitClauseRel = relate_Binder<TraitClause>(relate_TraitClause);
/** D4 descriptor of `ty::PolyTraitRef`. */
const d_PolyTraitRef = relate_Binder<TraitRefT>(relate_TraitRef);
/** `Vec<Ty>: TypeVisitable` (for `Binder::dummy`). */
const d_VecTy: TypeVisitable<Ty[]> = {
  visit_with: (s, v) => fold_Vec(fold_Ty).visit_with(s, v),
};
/** `AutoImplConstituents: TypeVisitable` (generated derive, ./mod.gen.ts). */
const d_AutoImplConstituents: TypeVisitable<AutoImplConstituents> = { visit_with: visit_with_AutoImplConstituents };
/** `RegionOutlivesClause: TypeVisitable` (for `Binder::dummy`). */
const d_RegionOutlivesClause: TypeVisitable<RegionOutlivesClause> = {
  visit_with: (s, v) => visit_with_OutlivesClause(s, v, fold_Region.visit_with),
};
/** `ty::Binder<CoroutineWitnessTypes>: TypeFoldable` (the `coroutine_hidden_types` query value). */
const d_Binder_CoroutineWitnessTypes: TypeFoldable<Binder<CoroutineWitnessTypes>> = fold_Binder<CoroutineWitnessTypes>({
  visit_with: visit_with_CoroutineWitnessTypes,
  try_fold_with: try_fold_with_CoroutineWitnessTypes,
  fold_with: fold_with_CoroutineWitnessTypes,
});

/** PORT: `Iterator::try_reduce` with an `Option`-returning closure (`None` short-circuits). */
function try_reduce<T>(iter: Iterable<T>, f: (a: T, b: T) => T | undefined): { $: "Some"; _0: T | undefined } | undefined {
  let first = true;
  let acc: T | undefined;
  for (const x of iter) {
    if (first) {
      first = false;
      acc = x;
      continue;
    }
    const r = f(acc as T, x);
    if (r === undefined) return undefined;
    acc = r;
  }
  return { $: "Some", _0: acc };
}

/// ## Winnowing
///
/// Winnowing is the process of attempting to resolve ambiguity by
/// probing further. During the winnowing process, we unify all
/// type variables and then we also attempt to evaluate recursive
/// bounds to see if they are satisfied.

/// If there are multiple ways to prove a trait goal, we make some
/// *fairly arbitrary* choices about which candidate is actually used.
///
/// For more details, look at the implementation of this method :)
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1716 winnow_candidates
SelectionContext.prototype.winnow_candidates = function (
  this: SelectionContext,
  has_non_region_infer: boolean,
  candidate_preference_mode: CandidatePreferenceMode,
  candidates: EvaluatedCandidate[],
): SelectionCandidate | undefined {
  if (candidates.length === 1) {
    return candidates.pop()!.candidate;
  }

  // We prefer `Sized` candidates over everything.
  const sized_candidate = candidates.find((c) => c.candidate.$ === "SizedCandidate");
  if (sized_candidate !== undefined) {
    // There should only ever be a single sized candidate
    // as they would otherwise overlap.
    // debug_assert_eq!(sized_candidates.next(), None);
    // Only prefer the built-in `Sized` candidate if its nested goals are certain.
    // Otherwise, we may encounter failure later on if inference causes this candidate
    // to not hold, but a where clause would've applied instead.
    if (EvaluationResultC.must_apply_modulo_regions(sized_candidate.evaluation)) {
      return clone_SelectionCandidate(sized_candidate.candidate);
    } else {
      return undefined;
    }
  }

  // Before we consider where-bounds, we have to deduplicate them here and also
  // drop where-bounds in case the same where-bound exists without bound vars.
  // This is necessary as elaborating super-trait bounds may result in duplicates.
  search_victim: for (;;) {
    for (let i = 0; i < candidates.length; i++) {
      const this_c = candidates[i]!.candidate;
      if (this_c.$ !== "ParamCandidate") continue;
      const this_ = this_c._0;
      for (let j = 0; j < candidates.length; j++) {
        if (i === j) {
          continue;
        }

        const other_c = candidates[j]!.candidate;
        if (other_c.$ !== "ParamCandidate") continue;
        const other = other_c._0;
        if (d_PolyTraitClauseRel.eq(this_, other)) {
          candidates.splice(j, 1);
          continue search_victim;
        }

        if (
          relate_TraitRef.eq(Binder.skip_binder(this_).trait_ref, Binder.skip_binder(other).trait_ref) &&
          Binder.skip_binder(this_).polarity === Binder.skip_binder(other).polarity &&
          !TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(this_).trait_ref, relate_TraitRef)
        ) {
          candidates.splice(j, 1);
          continue search_victim;
        }
      }
    }

    break;
  }

  const alias_bounds: [number, AliasBoundKind][] = [];
  for (const c of candidates) {
    if (c.candidate.$ === "ProjectionCandidate") {
      alias_bounds.push([c.candidate.idx, c.candidate.kind]);
    }
  }
  // Extract non-nested alias bound candidates, will be preferred over where bounds if
  // we're proving an auto-trait, sizedness trait or default trait.
  if (candidate_preference_mode === "Marker") {
    const r = try_reduce(
      alias_bounds.filter(([_idx, kind]) => kind === "SelfBounds").map(([idx, _kind]) => idx),
      (c1, c2) => (has_non_region_infer ? undefined : Math.min(c1, c2)),
    );
    if (r !== undefined && r._0 !== undefined) {
      return { $: "ProjectionCandidate", idx: r._0, kind: "SelfBounds" };
    } else if (r !== undefined) {
      // Some(None) => {}
    } else {
      return undefined;
    }
  }

  // The next highest priority is for non-global where-bounds. However, while we don't
  // prefer global where-clauses here, we do bail with ambiguity when encountering both
  // a global and a non-global where-clause.
  //
  // Our handling of where-bounds is generally fairly messy but necessary for backwards
  // compatibility, see #50825 for why we need to handle global where-bounds like this.
  const is_global = (c: PolyTraitClause): boolean =>
    TypeVisitableExt.is_global(c, d_PolyTraitClauseRel) && !TypeVisitableExt.has_bound_vars(c, d_PolyTraitClauseRel);
  let has_global_bounds = false;
  let param_candidate: PolyTraitClause | undefined = undefined;
  for (const cand of candidates) {
    if (cand.candidate.$ !== "ParamCandidate") continue;
    const c = cand.candidate._0;
    if (is_global(c)) {
      has_global_bounds = true;
    } else {
      const prev = param_candidate;
      param_candidate = c;
      if (prev !== undefined) {
        // Ambiguity, two potentially different where-clauses
        return undefined;
      }
    }
  }
  if (param_candidate !== undefined) {
    const predicate = param_candidate;
    // Ambiguity, a global and a non-global where-bound.
    if (has_global_bounds) {
      return undefined;
    } else {
      return { $: "ParamCandidate", _0: predicate };
    }
  }

  // Prefer alias-bounds over blanket impls for rigid associated types. This is
  // fairly arbitrary but once again necessary for backwards compatibility.
  // If there are multiple applicable candidates which don't affect type inference,
  // choose the one with the lowest index.
  {
    const r = try_reduce<[number, AliasBoundKind]>(alias_bounds, ([c1, k1], [c2, k2]) => {
      if (has_non_region_infer) {
        return undefined;
      } else if (c1 < c2) {
        return [c1, k1];
      } else {
        return [c2, k2];
      }
    });
    if (r !== undefined && r._0 !== undefined) {
      const [idx, kind] = r._0;
      return { $: "ProjectionCandidate", idx, kind };
    } else if (r !== undefined) {
      // Some(None) => {}
    } else {
      return undefined;
    }
  }

  // Need to prioritize builtin trait object impls as `<dyn Any as Any>::type_id`
  // should use the vtable method and not the method provided by the user-defined
  // impl `impl<T: ?Sized> Any for T { .. }`. This really shouldn't exist but is
  // necessary due to #57893. We again arbitrarily prefer the applicable candidate
  // with the lowest index.
  //
  // We do not want to use these impls to guide inference in case a user-written impl
  // may also apply.
  const object_bound = try_reduce(
    candidates.flatMap((c) => (c.candidate.$ === "ObjectCandidate" ? [c.candidate._0] : [])),
    (c1, c2) => (has_non_region_infer ? undefined : Math.min(c1, c2)),
  );
  if (object_bound !== undefined && object_bound._0 !== undefined) {
    const index = object_bound._0;
    return has_non_region_infer && candidates.some((c) => c.candidate.$ === "ImplCandidate")
      ? undefined
      : { $: "ObjectCandidate", _0: index };
  } else if (object_bound !== undefined) {
    // Some(None) => {}
  } else {
    return undefined;
  }
  // Same for upcasting.
  const upcast_bound = try_reduce(
    candidates.flatMap((c) => (c.candidate.$ === "TraitUpcastingUnsizeCandidate" ? [c.candidate._0] : [])),
    (c1, c2) => (has_non_region_infer ? undefined : Math.min(c1, c2)),
  );
  if (upcast_bound !== undefined && upcast_bound._0 !== undefined) {
    return { $: "TraitUpcastingUnsizeCandidate", _0: upcast_bound._0 };
  } else if (upcast_bound !== undefined) {
    // Some(None) => {}
  } else {
    return undefined;
  }

  // Finally, handle overlapping user-written impls.
  let impl_candidate: [DefId, EvaluationResult] | undefined = undefined;
  for (const cand of candidates) {
    if (cand.candidate.$ !== "ImplCandidate") continue;
    const c: [DefId, EvaluationResult] = [cand.candidate._0, cand.evaluation];
    const prev: [DefId, EvaluationResult] | undefined = impl_candidate;
    impl_candidate = c;
    if (prev !== undefined) {
      if (this.prefer_lhs_over_victim(has_non_region_infer, c, prev[0])) {
        // Ok, prefer `c` over the previous entry
      } else if (this.prefer_lhs_over_victim(has_non_region_infer, prev, c[0])) {
        // Ok, keep `prev` instead of the new entry
        impl_candidate = prev;
      } else {
        // Ambiguity, two potentially different where-clauses
        return undefined;
      }
    }
  }
  if (impl_candidate !== undefined) {
    const [def_id, _evaluation] = impl_candidate;
    // Don't use impl candidates which overlap with other candidates.
    // This should pretty much only ever happen with malformed impls.
    if (
      candidates.every((c) => {
        switch (c.candidate.$) {
          case "SizedCandidate":
          case "BuiltinCandidate":
          case "TransmutabilityCandidate":
          case "AutoImplCandidate":
          case "ClosureCandidate":
          case "AsyncClosureCandidate":
          case "AsyncFnKindHelperCandidate":
          case "CoroutineCandidate":
          case "FutureCandidate":
          case "IteratorCandidate":
          case "AsyncIteratorCandidate":
          case "FnPointerCandidate":
          case "TraitAliasCandidate":
          case "TraitUpcastingUnsizeCandidate":
          case "BuiltinObjectCandidate":
          case "BuiltinUnsizeCandidate":
          case "TryAsDynCandidate":
          case "BikeshedGuaranteedNoDropCandidate":
            return false;
          // Non-global param candidates have already been handled, global
          // where-bounds get ignored.
          case "ParamCandidate":
          case "ImplCandidate":
            return true;
          case "ProjectionCandidate":
          case "ObjectCandidate":
            return unreachable();
        }
      })
    ) {
      return { $: "ImplCandidate", _0: def_id };
    } else {
      return undefined;
    }
  }

  if (candidates.length === 1) {
    return candidates.pop()!.candidate;
  } else {
    // Also try ignoring all global where-bounds and check whether we end
    // with a unique candidate in this case.
    const not_a_global_where_bound = candidates.filter((c) => !(c.candidate.$ === "ParamCandidate" && is_global(c.candidate._0)));
    return not_a_global_where_bound.length === 1 ? not_a_global_where_bound[0]!.candidate : undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:1951 prefer_lhs_over_victim
SelectionContext.prototype.prefer_lhs_over_victim = function (
  this: SelectionContext,
  has_non_region_infer: boolean,
  [lhs, lhs_evaluation]: [DefId, EvaluationResult],
  victim: DefId,
): boolean {
  const tcx = this.tcx();
  // See if we can toss out `victim` based on specialization.
  //
  // While this requires us to know *for sure* that the `lhs` impl applies
  // we still use modulo regions here. This is fine as specialization currently
  // assumes that specializing impls have to be always applicable, meaning that
  // the only allowed region constraints may be constraints also present on the default impl.
  if (EvaluationResultC.must_apply_modulo_regions(lhs_evaluation)) {
    if (tcx.specializes([lhs, victim])) {
      return true;
    }
  }

  const overlap = tcx.impls_are_allowed_to_overlap(lhs, victim);
  if (overlap === undefined) {
    return false;
  }
  if (overlap.$ === "Permitted" && overlap.marker === false) {
    // For candidates which already reference errors it doesn't really
    // matter what we do 🤷
    return EvaluationResultC.must_apply_considering_regions(lhs_evaluation);
  } else {
    // Some(ty::ImplOverlapKind::Permitted { marker: true })
    // Subtle: If the predicate we are evaluating has inference
    // variables, do *not* allow discarding candidates due to
    // marker trait impls.
    //
    // Without this restriction, we could end up accidentally
    // constraining inference variables based on an arbitrarily
    // chosen trait impl.
    //
    // Imagine we have the following code:
    //
    // ```rust
    // #[marker] trait MyTrait {}
    // impl MyTrait for u8 {}
    // impl MyTrait for bool {}
    // ```
    //
    // And we are evaluating the predicate `<_#0t as MyTrait>`.
    //
    // During selection, we will end up with one candidate for each
    // impl of `MyTrait`. If we were to discard one impl in favor
    // of the other, we would be left with one candidate, causing
    // us to "successfully" select the predicate, unifying
    // _#0t with (for example) `u8`.
    //
    // However, we have no reason to believe that this unification
    // is correct - we've essentially just picked an arbitrary
    // *possibility* for _#0t, and required that this be the *only*
    // possibility.
    //
    // Eventually, we will either:
    // 1) Unify all inference variables in the predicate through
    // some other means (e.g. type-checking of a function). We will
    // then be in a position to drop marker trait candidates
    // without constraining inference variables (since there are
    // none left to constrain)
    // 2) Be left with some unconstrained inference variables. We
    // will then correctly report an inference error, since the
    // existence of multiple marker trait impls tells us nothing
    // about which one should actually apply.
    return !has_non_region_infer && EvaluationResultC.must_apply_considering_regions(lhs_evaluation);
  }
};

// ---- impl<'tcx> SelectionContext<'_, 'tcx> (mod.rs:2023) ----

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2024 sizedness_conditions
SelectionContext.prototype.sizedness_conditions = function (this: SelectionContext, self_ty: Ty, sizedness: SizedTraitKind): Binder<Ty[]> {
  const k = self_ty.kind();
  switch (k.$) {
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        return Binder.dummy<Ty[]>([], d_VecTy);
      }
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return bug(`asked to assemble \`Sized\` of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "RawPtr":
    case "Char":
    case "Ref":
    case "Coroutine":
    case "CoroutineWitness":
    case "Array":
    case "Closure":
    case "CoroutineClosure":
    case "Never":
    case "Error":
      return Binder.dummy<Ty[]>([], d_VecTy);

    case "Str":
    case "Slice":
    case "Dynamic":
      switch (sizedness) {
        case "Sized":
          return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for unsized type");
        case "MetaSized":
          return Binder.dummy<Ty[]>([], d_VecTy);
      }
      break;

    case "Foreign":
      return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for unsized type");

    case "Tuple": {
      const tys = k._0;
      const last = tys[tys.length - 1];
      return Binder.dummy(last === undefined ? [] : [last], d_VecTy);
    }

    case "Pat":
      return Binder.dummy([k._0], d_VecTy);

    case "Adt": {
      const [def, args] = [k._0, k._1];
      const crit = def.sizedness_constraint(this.tcx(), sizedness);
      if (crit !== undefined) {
        return Binder.dummy([Unnormalized.skip_norm_wip(EarlyBinder.instantiate(crit, this.tcx(), args, fold_Ty))], d_VecTy);
      } else {
        return Binder.dummy<Ty[]>([], d_VecTy);
      }
    }

    case "UnsafeBinder":
      return Binder.map_bound(UnsafeBinderInner.into_Binder(k._0), (ty) => [ty]);

    case "Alias":
    case "Param":
    case "Placeholder":
    case "Bound":
      return bug(`asked to assemble \`Sized\` of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2081 copy_clone_conditions
SelectionContext.prototype.copy_clone_conditions = function (this: SelectionContext, self_ty: Ty): Binder<Ty[]> {
  const k = self_ty.kind();
  switch (k.$) {
    case "FnDef":
    case "FnPtr":
    case "Error":
      return Binder.dummy<Ty[]>([], d_VecTy);

    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Array":
      return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl");
    case "Ref":
      if (k._2 === "Not") {
        return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl");
      }
      // ty::Ref(_, _, ty::Mutability::Mut)
      return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl");
      }
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);

    // FIXME(unsafe_binder): Should we conditionally
    // (i.e. universally) implement copy/clone?
    case "UnsafeBinder":
      return unreachable("internal error: entered unreachable code: tried to assemble `Sized` for unsafe binder");

    case "Tuple": {
      // (*) binder moved here
      return Binder.dummy([...k._0], d_VecTy);
    }

    case "Pat": {
      // (*) binder moved here
      return Binder.dummy([k._0], d_VecTy);
    }

    case "Coroutine": {
      const [def_id, args] = [k._0, k._1];
      switch (this.tcx().coroutine_movability(def_id)) {
        case "Static":
          return unreachable("internal error: entered unreachable code: tried to assemble `Clone` for static coroutine");
        case "Movable":
          if (this.tcx().features().coroutine_clone()) {
            return Binder.dummy(
              [CoroutineArgs.tupled_upvars_ty(args.as_coroutine()), Ty.new_coroutine_witness_for_coroutine(this.tcx(), def_id, args)],
              d_VecTy,
            );
          } else {
            return unreachable("internal error: entered unreachable code: tried to assemble `Clone` for coroutine without enabled feature");
          }
      }
      break;
    }

    case "CoroutineWitness": {
      const [def_id, args] = [k._0, k._1];
      return Binder.map_bound(
        Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(
            this.infcx.tcx.coroutine_hidden_types(def_id) as EarlyBinder<Binder<CoroutineWitnessTypes>>,
            this.infcx.tcx,
            args,
            d_Binder_CoroutineWitnessTypes,
          ),
        ),
        (witness) => [...witness.types],
      );
    }

    case "Closure":
      return Binder.dummy([...ClosureArgs.upvar_tys(k._1.as_closure())], d_VecTy);

    case "CoroutineClosure":
      return Binder.dummy([...CoroutineClosureArgs.upvar_tys(k._1.as_coroutine_closure())], d_VecTy);

    case "Foreign":
    case "Str":
    case "Slice":
    case "Dynamic":
    case "Adt":
    case "Alias":
    case "Param":
    case "Placeholder":
    case "Bound":
      return bug(`asked to assemble builtin bounds of unexpected type: ${debug_Ty(self_ty, PLAIN)}`);
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2160 coroutine_is_gen
SelectionContext.prototype.coroutine_is_gen = function (this: SelectionContext, self_ty: Ty): boolean {
  const k = self_ty.kind();
  return k.$ === "Coroutine" && this.tcx().coroutine_is_gen(k._0);
};

/// For default impls, we need to break apart a type into its
/// "constituent types" -- meaning, the types that it contains.
///
/// Here are some (simple) examples:
///
/// ```ignore (illustrative)
/// (i32, u32) -> [i32, u32]
/// Foo where struct Foo { x: i32, y: u32 } -> [i32, u32]
/// Bar<i32> where struct Bar<T> { x: T, y: u32 } -> [i32, u32]
/// Zed<i32> where enum Zed { A(T), B(u32) } -> [i32, u32]
/// ```
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2177 constituent_types_for_auto_trait
SelectionContext.prototype.constituent_types_for_auto_trait = function (
  this: SelectionContext,
  t: Ty,
): Result<Binder<AutoImplConstituents>, SelectionError> {
  const k = t.kind();
  const empty = (): AutoImplConstituents => ({ types: [], assumptions: [] });
  switch (k.$) {
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "Error":
    case "Never":
    case "Char":
      return Ok(Binder.dummy(empty(), d_AutoImplConstituents));

    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") {
        return Ok(Binder.dummy(empty(), d_AutoImplConstituents));
      }
      // ty::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
      return bug(`asked to assemble constituent types of unexpected type: ${debug_Ty(t, PLAIN)}`);

    // This branch is only for `experimental_default_bounds`.
    // Other foreign types were rejected earlier in
    // `assemble_candidates_from_auto_impls`.
    case "Foreign":
      return Ok(Binder.dummy(empty(), d_AutoImplConstituents));

    case "UnsafeBinder":
      return Ok(Binder.map_bound(UnsafeBinderInner.into_Binder(k._0), (ty): AutoImplConstituents => ({ types: [ty], assumptions: [] })));

    // Treat this like `struct str([u8]);`
    case "Str":
      return Ok(
        Binder.dummy<AutoImplConstituents>(
          {
            types: [Ty.new_slice(this.tcx(), this.tcx().types.u8)],
            assumptions: [],
          },
          d_AutoImplConstituents,
        ),
      );

    case "Placeholder":
    case "Dynamic":
    case "Param":
    case "Bound":
      return bug(`asked to assemble constituent types of unexpected type: ${debug_Ty(t, PLAIN)}`);

    case "RawPtr":
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [k._0], assumptions: [] }, d_AutoImplConstituents));
    case "Ref":
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [k._1], assumptions: [] }, d_AutoImplConstituents));

    case "Pat":
    case "Array":
    case "Slice":
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [k._0], assumptions: [] }, d_AutoImplConstituents));

    case "Tuple":
      // (T1, ..., Tn) -- meets any bound that all of T1...Tn meet
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [...k._0], assumptions: [] }, d_AutoImplConstituents));

    case "Closure": {
      const ty = this.infcx.shallow_resolve(ClosureArgs.tupled_upvars_ty(k._1.as_closure()));
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [ty], assumptions: [] }, d_AutoImplConstituents));
    }

    case "CoroutineClosure": {
      const ty = this.infcx.shallow_resolve(CoroutineClosureArgs.tupled_upvars_ty(k._1.as_coroutine_closure()));
      return Ok(Binder.dummy<AutoImplConstituents>({ types: [ty], assumptions: [] }, d_AutoImplConstituents));
    }

    case "Coroutine": {
      const [def_id, args] = [k._0, k._1];
      const ty = this.infcx.shallow_resolve(CoroutineArgs.tupled_upvars_ty(args.as_coroutine()));
      const tcx = this.tcx();
      const witness = Ty.new_coroutine_witness_for_coroutine(tcx, def_id, args);
      return Ok(
        Binder.dummy<AutoImplConstituents>(
          {
            types: [ty, witness],
            assumptions: [],
          },
          d_AutoImplConstituents,
        ),
      );
    }

    case "CoroutineWitness": {
      const [def_id, args] = [k._0, k._1];
      return Ok(
        Binder.map_bound(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(
              this.infcx.tcx.coroutine_hidden_types(def_id) as EarlyBinder<Binder<CoroutineWitnessTypes>>,
              this.infcx.tcx,
              args,
              d_Binder_CoroutineWitnessTypes,
            ),
          ),
          (witness): AutoImplConstituents => ({
            types: [...witness.types],
            assumptions: [...witness.assumptions],
          }),
        ),
      );
    }

    case "Adt": {
      const [def, args] = [k._0, k._1];
      // For `PhantomData<T>`, we pass `T`.
      if (def.is_phantom_data()) {
        return Ok(
          Binder.dummy<AutoImplConstituents>(
            {
              types: [...args.types()],
              assumptions: [],
            },
            d_AutoImplConstituents,
          ),
        );
      }

      const types: Ty[] = [];
      for (const f of def.all_fields()) types.push(Unnormalized.skip_norm_wip(f.ty(this.tcx(), args)));
      return Ok(Binder.dummy<AutoImplConstituents>({ types, assumptions: [] }, d_AutoImplConstituents));
    }

    case "Alias": {
      const alias = k._1;
      switch (alias.kind.$) {
        case "Projection":
        case "Inherent":
        case "Free":
          return bug(`asked to assemble constituent types of unexpected type: ${debug_Ty(t, PLAIN)}`);
        case "Opaque": {
          const def_id = alias.kind.def_id;
          const args = alias.args;
          if (this.infcx.can_define_opaque_ty(def_id)) {
            return unreachable();
          } else {
            // We can resolve the opaque type to its hidden type,
            // which enforces a DAG between the functions requiring
            // the auto trait bounds in question.
            const ty = this.tcx().type_of_opaque(def_id) as EarlyBinder<Ty>;
            return Ok(
              Binder.dummy<AutoImplConstituents>(
                {
                  types: [Unnormalized.skip_norm_wip(EarlyBinder.instantiate(ty, this.tcx(), args, fold_Ty))],
                  assumptions: [],
                },
                d_AutoImplConstituents,
              ),
            );
          }
        }
      }
      break;
    }
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2307 collect_predicates_for_types
SelectionContext.prototype.collect_predicates_for_types = function (
  this: SelectionContext,
  param_env: ParamEnv,
  cause: ObligationCause,
  recursion_depth: number,
  trait_def_id: DefId,
  types: Ty[],
): PredicateObligations {
  // Because the types were potentially derived from
  // higher-ranked obligations they may reference late-bound
  // regions. For example, `for<'a> Foo<&'a i32> : Copy` would
  // yield a type like `for<'a> &'a i32`. In general, we
  // maintain the invariant that we never manipulate bound
  // regions, so we have to process these bound regions somehow.
  //
  // The strategy is to:
  //
  // 1. Instantiate those regions to placeholder regions (e.g.,
  //    `for<'a> &'a i32` becomes `&0 i32`.
  // 2. Produce something like `&'0 i32 : Copy`
  // 3. Re-bind the regions back to `for<'a> &'a i32 : Copy`

  const out: PredicateObligations = [];
  for (const placeholder_ty of types) {
    const { value: normalized_ty, obligations } = normalize_mod_b().normalize_with_depth(
      this,
      param_env,
      clone_ObligationCause(cause),
      recursion_depth,
      Unnormalized.new_wip(placeholder_ty),
      fold_Ty,
    );

    const tcx = this.tcx();
    let trait_ref: TraitRefT;
    if ((tcx.generics_of(trait_def_id) as Generics).own_params.length === 1) {
      trait_ref = TraitRefC.new(as_interner(tcx), trait_def_id, [GenericArg.from_Ty(normalized_ty)]);
    } else {
      // If this is an ill-formed auto/built-in trait, then synthesize
      // new error args for the missing generics.
      const err_args = RawList.extend_with_error(tcx, trait_def_id, [GenericArg.from_Ty(normalized_ty)]);
      trait_ref = TraitRefC.new_from_args(as_interner(tcx), trait_def_id, err_args);
    }

    const obligation = Obligation.new(this.tcx(), clone_ObligationCause(cause), param_env, trait_ref, (from: TraitRefT, _i) =>
      Predicate_upcast_from_TraitRef(from, tcx),
    );
    obligations.push(obligation);
    out.push(...obligations);
  }
  return out;
};

///////////////////////////////////////////////////////////////////////////
// Matching
//
// Matching is a common path used for both evaluation and
// confirmation. It basically unifies types that appear in impls
// and traits. This does affect the surrounding environment;
// therefore, when used during evaluation, match routines must be
// run inside of a `probe()` so that their side-effects are
// contained.

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2371 rematch_impl
SelectionContext.prototype.rematch_impl = function (this: SelectionContext, impl_def_id: DefId, obligation: PolyTraitObligation): Normalized<GenericArgs> {
  const impl_trait_header = this.tcx().impl_trait_header(impl_def_id) as ImplTraitHeader;
  const r = this.match_impl(impl_def_id, impl_trait_header, obligation);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const predicate = this.infcx.deeply_resolve_ignoring_regions(obligation.predicate, d_PolyTraitClauseRel);
    return bug(
      `impl ${format_debug(impl_def_id, debug_DefId, PLAIN)} was matchable against ${format_debug(predicate, (p, f) => debug_Binder(p, f, debug_TraitClause), PLAIN)} but now is not`,
    );
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2387 match_impl
SelectionContext.prototype.match_impl = function (
  this: SelectionContext,
  impl_def_id: DefId,
  impl_trait_header: ImplTraitHeader,
  obligation: PolyTraitObligation,
): Result<Normalized<GenericArgs>, null> {
  const placeholder_obligation = this.infcx.enter_forall_and_leak_universe(obligation.predicate, relate_TraitClause);
  const placeholder_obligation_trait_ref = placeholder_obligation.trait_ref;

  const impl_args = this.infcx.fresh_args_for_item(obligation.cause.span, impl_def_id);

  const trait_ref = EarlyBinder.instantiate(impl_trait_header.trait_ref, this.tcx(), impl_args, relate_TraitRef);
  // debug!(?impl_trait_header);

  const nested_obligations: PredicateObligations = [];
  const impl_trait_ref = normalize_mod_b().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    trait_ref,
    nested_obligations,
    relate_TraitRef,
  );

  // debug!(?impl_trait_ref, ?placeholder_obligation_trait_ref);

  const cause = ObligationCause.new(obligation.cause.span, obligation.cause.body_def_id, {
    $: "MatchImpl",
    _0: clone_ObligationCause(obligation.cause),
    _1: impl_def_id,
  } satisfies ObligationCauseCode);

  const r = this.infcx.at(cause, obligation.param_env).eq(DefineOpaqueTypes.No, placeholder_obligation_trait_ref, impl_trait_ref, ToTrace_TraitRef);
  // .map_err(|e| debug!("match_impl: failed eq_trait_refs due to `{}`", e.to_string(self.tcx())))?;
  if (r.$ === "Err") return Err(null);
  const { obligations } = r._0;
  nested_obligations.push(...obligations);

  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    case "Reflection":
      if (!this.tcx().impl_is_fully_generic_for_reflection(impl_def_id)) {
        // debug!("reflection mode only allows fully generic impls");
        return Err(null);
      }
      break;
    case "Typeck":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
    case "Codegen":
    case "ErasedNotCoherence":
    case "PostAnalysis":
      break;
    case "Coherence":
      return unreachable("internal error: entered unreachable code: old solver coherence");
  }

  return Ok(new Normalized(impl_args, nested_obligations));
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2452 match_upcast_principal
SelectionContext.prototype.match_upcast_principal = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  unnormalized_upcast_principal: Unnormalized<PolyTraitRef>,
  a_data: List<PolyExistentialPredicate>,
  b_data: List<PolyExistentialPredicate>,
  a_region: RegionT,
  b_region: RegionT,
): SelectionResult<PredicateObligations> {
  const tcx = this.tcx();
  const nested: PredicateObligations = [];

  // We may upcast to auto traits that are either explicitly listed in
  // the object type's bounds, or implied by the principal trait ref's
  // supertraits.
  const a_auto_traits = new DefIdSet();
  for (const def_id of a_data.auto_traits()) a_auto_traits.add(def_id);
  const principal_def_id = a_data.principal_def_id();
  if (principal_def_id !== undefined) {
    for (const def_id of supertrait_def_ids(tcx, principal_def_id)) {
      if (tcx.trait_is_auto(def_id)) a_auto_traits.add(def_id);
    }
  }

  const upcast_principal = normalize_mod_b().normalize_with_depth_to(
    this,
    obligation.param_env,
    clone_ObligationCause(obligation.cause),
    obligation.recursion_depth + 1,
    unnormalized_upcast_principal,
    nested,
    d_PolyTraitRef,
  );

  for (const bound of b_data) {
    const bk = Binder.skip_binder(bound);
    switch (bk.$) {
      // Check that a_ty's supertrait (upcast_principal) is compatible
      // with the target (b_ty).
      case "Trait": {
        const target_principal = bk._0;
        const hr_source_principal = Binder.map_bound(upcast_principal, (trait_ref) => ExistentialTraitRef.erase_self_ty(as_interner(tcx), trait_ref));
        const hr_target_principal = Binder.rebind(bound, target_principal);

        const r = this.infcx.enter_forall(
          hr_target_principal,
          (target_principal) => {
            const source_principal = this.infcx.instantiate_binder_with_fresh_vars(
              obligation.cause.span,
              BoundRegionConversionTime.HigherRankedType,
              hr_source_principal,
              relate_ExistentialTraitRef,
            );
            return this.infcx
              .at(obligation.cause, obligation.param_env)
              .eq_trace(
                DefineOpaqueTypes.Yes,
                ToTrace_PolyExistentialTraitRef.to_trace(obligation.cause, hr_target_principal, hr_source_principal),
                target_principal,
                source_principal,
                relate_ExistentialTraitRef,
              );
          },
          relate_ExistentialTraitRef,
        );
        if (r.$ === "Err") return Err(SelectionError.Unimplemented);
        nested.push(...r._0.into_obligations());
        break;
      }
      // Check that b_ty's projection is satisfied by exactly one of
      // a_ty's projections. First, we look through the list to see if
      // any match. If not, error. Then, if *more* than one matches, we
      // return ambiguity. Otherwise, if exactly one matches, equate
      // it with b_ty's projection.
      case "Projection": {
        const target_projection = bk._0;
        const hr_target_projection = Binder.rebind(bound, target_projection);

        const infcx = this.infcx;
        const matching_projections = (function* (): Generator<Binder<ExistentialProjection>> {
          for (const hr_source_projection of a_data.projection_bounds()) {
            // Eager normalization means that we can just use can_eq
            // here instead of equating and processing obligations.
            if (
              DefId_eq(PolyExistentialProjection.item_def_id(hr_source_projection), PolyExistentialProjection.item_def_id(hr_target_projection)) &&
              infcx.probe((_) => {
                return (
                  infcx.enter_forall(
                    hr_target_projection,
                    (target_projection) => {
                      const source_projection = infcx.instantiate_binder_with_fresh_vars(
                        obligation.cause.span,
                        BoundRegionConversionTime.HigherRankedType,
                        hr_source_projection,
                        relate_ExistentialProjection,
                      );
                      return infcx
                        .at(obligation.cause, obligation.param_env)
                        .eq_trace(
                          DefineOpaqueTypes.Yes,
                          ToTrace_PolyExistentialProjection.to_trace(obligation.cause, hr_target_projection, hr_source_projection),
                          target_projection,
                          source_projection,
                          relate_ExistentialProjection,
                        );
                    },
                    relate_ExistentialProjection,
                  ).$ === "Ok"
                );
              })
            ) {
              yield hr_source_projection;
            }
          }
        })();

        const first = matching_projections.next();
        if (first.done) {
          return Err(SelectionError.Unimplemented);
        }
        const hr_source_projection = first.value;
        if (!matching_projections.next().done) {
          return Ok(undefined);
        }
        const r = this.infcx.enter_forall(
          hr_target_projection,
          (target_projection) => {
            const source_projection = this.infcx.instantiate_binder_with_fresh_vars(
              obligation.cause.span,
              BoundRegionConversionTime.HigherRankedType,
              hr_source_projection,
              relate_ExistentialProjection,
            );
            return this.infcx
              .at(obligation.cause, obligation.param_env)
              .eq_trace(
                DefineOpaqueTypes.Yes,
                ToTrace_PolyExistentialProjection.to_trace(obligation.cause, hr_target_projection, hr_source_projection),
                target_projection,
                source_projection,
                relate_ExistentialProjection,
              );
          },
          relate_ExistentialProjection,
        );
        if (r.$ === "Err") return Err(SelectionError.Unimplemented);
        nested.push(...r._0.into_obligations());
        break;
      }
      // Check that b_ty's auto traits are present in a_ty's bounds.
      case "AutoTrait": {
        const def_id = bk._0;
        if (!a_auto_traits.has(def_id)) {
          return Err(SelectionError.Unimplemented);
        }
        break;
      }
    }
  }

  nested.push(
    Obligation.with_depth(
      tcx,
      clone_ObligationCause(obligation.cause),
      obligation.recursion_depth + 1,
      obligation.param_env,
      Binder.dummy<RegionOutlivesClause>({ _0: a_region, _1: b_region }, d_RegionOutlivesClause),
      (from: Binder<RegionOutlivesClause>, _i) => Predicate_upcast_from_PolyRegionOutlivesClause(from, tcx),
    ),
  );

  return Ok(nested);
};

/// Normalize `where_clause_trait_ref` and try to match it against
/// `obligation`. If successful, return any predicates that
/// result from the normalization.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2615 match_where_clause_trait_ref
SelectionContext.prototype.match_where_clause_trait_ref = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  where_clause_trait_ref: PolyTraitRef,
): Result<PredicateObligations, null> {
  return this.match_poly_trait_ref(obligation, where_clause_trait_ref);
};

/// Returns `Ok` if `poly_trait_ref` being true implies that the
/// obligation is satisfied.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2626 match_poly_trait_ref
SelectionContext.prototype.match_poly_trait_ref = function (
  this: SelectionContext,
  obligation: PolyTraitObligation,
  poly_trait_ref: PolyTraitRef,
): Result<PredicateObligations, null> {
  const predicate = this.infcx.enter_forall_and_leak_universe(obligation.predicate, relate_TraitClause);
  const trait_ref = this.infcx.instantiate_binder_with_fresh_vars(
    obligation.cause.span,
    BoundRegionConversionTime.HigherRankedType,
    poly_trait_ref,
    relate_TraitRef,
  );
  const r = this.infcx.at(obligation.cause, obligation.param_env).eq(DefineOpaqueTypes.No, predicate.trait_ref, trait_ref, ToTrace_TraitRef);
  if (r.$ === "Ok") {
    const { obligations } = r._0;
    return Ok(obligations);
  }
  return Err(null);
};

///////////////////////////////////////////////////////////////////////////
// Miscellany

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2647 match_fresh_trait_preds
SelectionContext.prototype.match_fresh_trait_preds = function (this: SelectionContext, previous: PolyTraitClause, current: PolyTraitClause): boolean {
  const matcher = MatchAgainstFreshVars.new(this.tcx());
  return matcher.relate(previous, current, d_PolyTraitClauseRel).$ === "Ok";
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2656 push_stack
SelectionContext.prototype.push_stack = function (
  this: SelectionContext,
  previous_stack: TraitObligationStackList,
  obligation: PolyTraitObligation,
): TraitObligationStack {
  const fresh_trait_pred = d_PolyTraitClauseRel.fold_with(obligation.predicate, this.freshener);

  const dfn = previous_stack.cache.next_dfn();
  const depth = previous_stack.depth() + 1;
  // PORT: `previous_stack` is a `Copy` value moved into the stack: stored as its own copy (`next()` mutates in place).
  return new TraitObligationStack(obligation, fresh_trait_pred, depth, clone_TraitObligationStackList(previous_stack), depth, dfn);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2676 closure_trait_ref_unnormalized
SelectionContext.prototype.closure_trait_ref_unnormalized = function (this: SelectionContext, self_ty: Ty, fn_trait_def_id: DefId): PolyTraitRef {
  const k = self_ty.kind();
  if (k.$ !== "Closure") {
    return bug(`expected closure, found ${display_Ty(self_ty)}`);
  }
  const args = k._1;
  const closure_sig = ClosureArgs.sig(args.as_closure());

  return Binder.map_bound(
    util_mod_b().closure_trait_ref_and_return_type(this.tcx(), fn_trait_def_id, self_ty, closure_sig, "No"),
    ([trait_ref, _]) => trait_ref,
  );
};

/// Returns the obligations that are implied by instantiating an
/// impl or trait. The obligations are instantiated and fully
/// normalized. This is used when confirming an impl or default
/// impl.
// #[instrument(level = "debug", skip(self, cause, param_env))]
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2701 impl_or_trait_obligations
SelectionContext.prototype.impl_or_trait_obligations = function (
  this: SelectionContext,
  cause: ObligationCause,
  recursion_depth: number,
  param_env: ParamEnv,
  def_id: DefId, // of impl or trait
  args: GenericArgs, // for impl or trait
  parent_trait_pred: Binder<TraitClause>,
): PredicateObligations {
  const tcx = this.tcx();

  // To allow for one-pass evaluation of the nested obligation,
  // each predicate must be preceded by the obligations required
  // to normalize it.
  // for example, if we have:
  //    impl<U: Iterator<Item: Copy>, V: Iterator<Item = U>> Foo for V
  // the impl will have the following predicates:
  //    <V as Iterator>::Item = U,
  //    U: Iterator, U: Sized,
  //    V: Iterator, V: Sized,
  //    <U as Iterator>::Item: Copy
  // When we instantiate, say, `V => IntoIter<u32>, U => $0`, the last
  // obligation will normalize to `<$0 as Iterator>::Item = $1` and
  // `$1: Copy`, so we must ensure the obligations are emitted in
  // that order.
  const clauses_ = tcx.clauses_of(def_id) as GenericClauses;
  assert_eq(clauses_.parent, undefined, (v) => format_debug(v, (x, f) => debug_option(x, f, debug_DefId), PLAIN));
  const clauses = GenericClauses.instantiate_own(clauses_, tcx, args);
  const obligations: PredicateObligations = [];
  let index = 0;
  for (const [clause_, span] of clauses) {
    let cause_: ObligationCause;
    if (tcx.is_lang_item(PolyTraitClauseC.def_id(parent_trait_pred), "CoerceUnsized")) {
      cause_ = clone_ObligationCause(cause);
    } else {
      const index_ = index;
      cause_ = clone_ObligationCause(cause).derived_cause(parent_trait_pred, (derived) => ({
        $: "ImplDerived",
        _0: {
          derived,
          impl_or_alias_def_id: def_id,
          impl_def_clause_index: index_,
          span,
        },
      }));
    }
    const clause = normalize_mod_b().normalize_with_depth_to(
      this,
      param_env,
      clone_ObligationCause(cause_),
      recursion_depth,
      clause_,
      obligations,
      fold_Clause,
    );
    obligations.push(new Obligation(cause_, param_env, clause.as_predicate(), recursion_depth));
    index++;
  }

  // Register any outlives obligations from the trait here, cc #124336.
  const dk = tcx.def_kind(def_id);
  if (dk.$ === "Impl" && dk.of_trait === true) {
    for (const clause_ of EarlyBinder.iter_instantiated(tcx.impl_super_outlives(def_id) as EarlyBinder<readonly Clause[]>, tcx, args, fold_Clause)) {
      const clause = normalize_mod_b().normalize_with_depth_to(
        this,
        param_env,
        clone_ObligationCause(cause),
        recursion_depth,
        clause_,
        obligations,
        fold_Clause,
      );
      obligations.push(new Obligation(clone_ObligationCause(cause), param_env, clause.as_predicate(), recursion_depth));
    }
  }

  return obligations;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2782 should_stall_coroutine
SelectionContext.prototype.should_stall_coroutine = function (this: SelectionContext, def_id: DefId): boolean {
  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    case "Typeck": {
      const stalled_generators = typing_mode.defining_opaque_types_and_generators;
      const local = def_id.as_local();
      return local !== undefined && stalled_generators.includes(local);
    }
    case "PostAnalysis":
    case "Reflection":
    case "Codegen":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
      return false;
    case "Coherence":
      return unreachable("internal error: entered unreachable code: old solver coherence");
    case "ErasedNotCoherence":
      // PORT: uninhabited (`TypingMode<CantBeErased>`); upstream has no arm.
      return typing_mode._0;
  }
};

// ==== end of lane old-select-b ==========================================================================================

// ---- impl<'o, 'tcx> TraitObligationStack<'o, 'tcx> (mod.rs:2799) -------------------------------------------------------

declare module "./mod.gen.ts" {
  interface TraitObligationStack {
    list(): TraitObligationStackList;
    cache(): ProvisionalEvaluationCache;
    iter(): TraitObligationStackList;
    update_reached_depth(reached_depth: number): void;
  }
  interface ProvisionalEvaluationCache {
    next_dfn(): number;
    get_provisional(fresh_trait_pred: PolyTraitClause): ProvisionalEvaluation | undefined;
    insert_provisional(from_dfn: number, reached_depth: number, fresh_trait_pred: PolyTraitClause, result: EvaluationResult): void;
    on_failure(dfn: number): void;
    on_completion(dfn: number): void;
  }
  namespace ProvisionalEvaluationCache {
    function default_(): ProvisionalEvaluationCache;
    export { default_ as default };
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2800 list
TraitObligationStack.prototype.list = function (this: TraitObligationStack): TraitObligationStackList {
  return TraitObligationStackList.with(this);
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2804 cache
TraitObligationStack.prototype.cache = function (this: TraitObligationStack): ProvisionalEvaluationCache {
  return this.previous.cache;
};

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2808 iter
TraitObligationStack.prototype.iter = function (this: TraitObligationStack): TraitObligationStackList {
  return this.list();
};

/// Indicates that attempting to evaluate this stack entry
/// required accessing something from the stack at depth `reached_depth`.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2814 update_reached_depth
TraitObligationStack.prototype.update_reached_depth = function (this: TraitObligationStack, reached_depth: number): void {
  assert(
    this.depth >= reached_depth,
    `invoked \`update_reached_depth\` with something under this stack: self.depth=${this.depth} reached_depth=${reached_depth}`,
  );
  // debug!(reached_depth, "update_reached_depth");
  let p: TraitObligationStack = this;
  while (reached_depth < p.depth) {
    // debug!(?p.fresh_trait_pred, "update_reached_depth: marking as cycle participant");
    p.reached_depth = Math.min(p.reached_depth, reached_depth);
    p = p.previous.head_!;
  }
};

// ---- impl<'tcx> Default for ProvisionalEvaluationCache<'tcx> (mod.rs:2925) -----------------------------------------------

Object.assign(ProvisionalEvaluationCache, {
  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2926 default
  default(): ProvisionalEvaluationCache {
    return new ProvisionalEvaluationCache(0, new KeyedMap<PolyTraitClause, ProvisionalEvaluation>(intern_key), []);
  },
});

// ---- impl<'tcx> ProvisionalEvaluationCache<'tcx> (mod.rs:2931) -------------------------------------------------------

/// Get the next DFN in sequence (basically a counter).
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2933 next_dfn
ProvisionalEvaluationCache.prototype.next_dfn = function (this: ProvisionalEvaluationCache): number {
  const result = this.dfn;
  this.dfn = result + 1;
  return result;
};

/// Check the provisional cache for any result for
/// `fresh_trait_pred`. If there is a hit, then you must consider
/// it an access to the stack slots at depth
/// `reached_depth` (from the returned value).
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2943 get_provisional
ProvisionalEvaluationCache.prototype.get_provisional = function (
  this: ProvisionalEvaluationCache,
  fresh_trait_pred: PolyTraitClause,
): ProvisionalEvaluation | undefined {
  // debug!(?fresh_trait_pred, "get_provisional = {:#?}", self.map.borrow().get(&fresh_trait_pred));
  const v = this.map.get(fresh_trait_pred);
  if (v === undefined) return undefined;
  // `Some(*v)`: `ProvisionalEvaluation` is `Copy`
  return { from_dfn: v.from_dfn, reached_depth: v.reached_depth, result: v.result };
};

/// Insert a provisional result into the cache. The result came
/// from the node with the given DFN. It accessed a minimum depth
/// of `reached_depth` to compute. It evaluated `fresh_trait_pred`
/// and resulted in `result`.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:2959 insert_provisional
ProvisionalEvaluationCache.prototype.insert_provisional = function (
  this: ProvisionalEvaluationCache,
  from_dfn: number,
  reached_depth: number,
  fresh_trait_pred: PolyTraitClause,
  result: EvaluationResult,
): void {
  // debug!(?from_dfn, ?fresh_trait_pred, ?result, "insert_provisional");

  const map = this.map;

  // Subtle: when we complete working on the DFN `from_dfn`, anything
  // that remains in the provisional cache must be dependent on some older
  // stack entry than `from_dfn`. We have to update their depth with our transitive
  // depth in that case or else it would be referring to some popped note.
  //
  // Example:
  // A (reached depth 0)
  //   ...
  //      B // depth 1 -- reached depth = 0
  //          C // depth 2 -- reached depth = 1 (should be 0)
  //              B
  //          A // depth 0
  //   D (reached depth 1)
  //      C (cache -- reached depth = 2)
  for (const [_k, v] of map) {
    if (v.from_dfn >= from_dfn) {
      v.reached_depth = Math.min(reached_depth, v.reached_depth);
    }
  }

  map.set(fresh_trait_pred, { from_dfn, reached_depth, result });
};

/// Invoked when the node with dfn `dfn` does not get a successful
/// result. This will clear out any provisional cache entries
/// originating from nodes visited before this node (`from_dfn < dfn`).
/// This is because the provisional entries are things which must
/// assume that the things on the stack at the time of their creation
/// succeeded -- since the failing node is presently at the top of
/// the stack, these provisional entries must either depend on it or
/// some ancestor of it.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3001 on_failure
ProvisionalEvaluationCache.prototype.on_failure = function (this: ProvisionalEvaluationCache, dfn: number): void {
  // debug!(?dfn, "on_failure");
  for (const [key, evaluation] of [...this.map]) {
    if (evaluation.from_dfn < dfn) {
      // debug!("on_failure: removing {:?}", key);
      this.map.delete(key);
    }
  }
};

/// Invoked when the node at depth `depth` completed without
/// depending on anything higher in the stack (if that completion
/// was a failure, then `on_failure` should have been invoked
/// already).
///
/// Note that we may still have provisional cache items remaining
/// in the cache when this is done. For example, if there is a
/// cycle:
///
/// * A depends on...
///     * B depends on A
///     * C depends on...
///         * D depends on C
///     * ...
///
/// Then as we complete the C node we will have a provisional cache
/// with results for A, B, C, and D. This method would clear out
/// the C and D results, but leave A and B provisional.
///
/// This is determined based on the DFN: we remove any provisional
/// results created since `dfn` started (e.g., in our example, dfn
/// would be 2, representing the C node, and hence we would
/// remove the result for D, which has DFN 3, but not the results for
/// A and B, which have DFNs 0 and 1 respectively).
///
/// Note that we *do not* attempt to cache these cycle participants
/// in the evaluation cache. Doing so would require carefully computing
/// the correct `DepNode` to store in the cache entry:
/// cycle participants may implicitly depend on query results
/// related to other participants in the cycle, due to our logic
/// which examines the evaluation stack.
///
/// We used to try to perform this caching,
/// but it lead to multiple incremental compilation ICEs
/// (see #92987 and #96319), and was very hard to understand.
/// Fortunately, removing the caching didn't seem to
/// have a performance impact in practice.
// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3050 on_completion
ProvisionalEvaluationCache.prototype.on_completion = function (this: ProvisionalEvaluationCache, dfn: number): void {
  // debug!(?dfn, "on_completion");
  for (const [fresh_trait_pred, evaluation] of [...this.map]) {
    if (evaluation.from_dfn >= dfn) {
      // debug!(?fresh_trait_pred, ?eval, "on_completion");
      this.map.delete(fresh_trait_pred);
    }
  }
};

// ---- TraitObligationStackList (mod.rs:3063; hand class) ----------------------------------------------------------------

// rustc-type: compiler/rustc_trait_selection/src/traits/select/mod.rs:3063 TraitObligationStackList
export class TraitObligationStackList implements Iterable<TraitObligationStack> {
  constructor(
    public cache: ProvisionalEvaluationCache,
    /** PORT: the field `head` (the method `head()` has the name). */
    public head_: TraitObligationStack | undefined,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3069 empty
  static empty(cache: ProvisionalEvaluationCache): TraitObligationStackList {
    return new TraitObligationStackList(cache, undefined);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3073 with
  static with(r: TraitObligationStack): TraitObligationStackList {
    return new TraitObligationStackList(r.cache(), r);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3077 head
  head(): TraitObligationStack | undefined {
    return this.head_;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3081 depth
  depth(): number {
    const head = this.head_;
    if (head !== undefined) {
      return head.depth;
    } else {
      return 0;
    }
  }

  // ---- impl<'o, 'tcx> Iterator for TraitObligationStackList<'o, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3089 next
  next(): TraitObligationStack | undefined {
    const o = this.head_;
    if (o === undefined) return undefined;
    // `*self = o.previous`
    this.cache = o.previous.cache;
    this.head_ = o.previous.head_;
    return o;
  }

  /** PORT: iterates a copy (`for x in list` consumes a `Copy` value). */
  *[Symbol.iterator](): Iterator<TraitObligationStack> {
    const it = clone_TraitObligationStackList(this);
    for (let o = it.next(); o !== undefined; o = it.next()) yield o;
  }
}

/** `#[derive(Copy, Clone)]` of `TraitObligationStackList`. */
export function clone_TraitObligationStackList(v: TraitObligationStackList): TraitObligationStackList {
  return new TraitObligationStackList(v.cache, v.head_);
}

// ---- impl<'o, 'tcx> fmt::Debug for TraitObligationStack<'o, 'tcx> (mod.rs:3096) ---------------------------------------

// rustc: compiler/rustc_trait_selection/src/traits/select/mod.rs:3097 fmt
export function debug_TraitObligationStack(self: TraitObligationStack, _f: Fmt): string {
  // PORT: `write!(f, ..)` formats `{:?}` with fresh (plain) flags.
  return `TraitObligationStack(${debug_Obligation(self.obligation, PLAIN, (p, f) => debug_Binder(p, f, debug_TraitClause))})`;
}

// ---- PORT: local helpers ----------------------------------------------------------------------------------------------

/** Lazily read `crate::traits` (init order: module comment). */
function traits_mod(): typeof import("../mod.ts") {
  return require("../mod.ts") as typeof import("../mod.ts");
}

/** `Ord::max` of `EvaluationResult` (derived `Ord` compares the discriminants; `max` returns `other` on ties). */
function max_EvaluationResult(self: EvaluationResult, other: EvaluationResult): EvaluationResult {
  return EvaluationResult_discriminant[other] >= EvaluationResult_discriminant[self] ? other : self;
}

/** `SelectionResult<SelectionCandidate>::clone`. */
function clone_SelectionResult_SelectionCandidate(v: SelectionResult<SelectionCandidate>): SelectionResult<SelectionCandidate> {
  if (v.$ === "Err") return v;
  return Ok(v._0 === undefined ? undefined : clone_SelectionCandidate(v._0));
}

/** `Iterator::take_while`. */
function* take_while<T>(it: Iterable<T>, pred: (x: T) => boolean): Generator<T> {
  for (const x of it) {
    if (!pred(x)) return;
    yield x;
  }
}

/** `Iterator::all`. */
function all_iter<T>(it: Iterable<T>, f: (x: T) => boolean): boolean {
  for (const x of it) if (!f(x)) return false;
  return true;
}

/** `Iterator::any`. */
function any_iter<T>(it: Iterable<T>, f: (x: T) => boolean): boolean {
  for (const x of it) if (f(x)) return true;
  return false;
}

/** `Iterator::map`. */
function* map_iter<T, U>(it: Iterable<T>, f: (x: T) => U): Generator<U> {
  for (const x of it) yield f(x);
}

/** `impl UpcastFrom<TyCtxt, PolyTraitClause> for Predicate` at the `Interner` type of the `Upcast` parameters. */
function Predicate_upcast_from_PolyTraitClause_(): (from: PolyTraitClause, tcx: Interner) => Predicate {
  return Predicate_upcast_from_PolyTraitClause as unknown as (from: PolyTraitClause, tcx: Interner) => Predicate;
}

// D4 descriptors of the derived `TypeFoldable` impls this file folds / visits through (read lazily: init order).
function d_TraitClause(): TypeFoldable<import("../../../rustc_type_ir/predicate.ts").TraitClause> {
  return { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
}
function d_PolyTraitClause(): TypeFoldable<PolyTraitClause> {
  return fold_Binder(d_TraitClause());
}
function d_ProjectionClause(): TypeFoldable<import("../../../rustc_type_ir/predicate.ts").ProjectionClause> {
  return { visit_with: visit_with_ProjectionClause, try_fold_with: try_fold_with_ProjectionClause, fold_with: fold_with_ProjectionClause };
}
function d_HostEffectClause(): TypeFoldable<HostEffectClause> {
  return { visit_with: visit_with_HostEffectClause, try_fold_with: try_fold_with_HostEffectClause, fold_with: fold_with_HostEffectClause };
}
function d_TraitRef(): TypeFoldable<TraitRef> {
  return { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
}
function d_AliasTerm(): TypeFoldable<AliasTerm> {
  return {
    visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTermKind),
    try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasTermKind),
    fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTermKind),
  };
}
function d_ParamEnv(): TypeFoldable<ParamEnv> {
  return { visit_with: visit_with_ParamEnv, try_fold_with: try_fold_with_ParamEnv, fold_with: fold_with_ParamEnv };
}
function d_Predicate_ParamEnv(): TypeFoldable<[Predicate, ParamEnv]> {
  return fold_tuple2(fold_Predicate, d_ParamEnv());
}
/** The derived `TypeVisitable` of `Obligation<PolyTraitClause>` (`obligation.is_global()`). */
function d_PolyTraitObligation(): TypeVisitable<PolyTraitObligation> {
  return { visit_with: (self, visitor) => visit_with_Obligation(self, visitor, (p, v) => d_PolyTraitClause().visit_with(p, v)) };
}

/** PORT: names used in type positions only. */
export type SelectModTypes = [Const, typeof PolyTraitClauseC, typeof fold_Clause];
