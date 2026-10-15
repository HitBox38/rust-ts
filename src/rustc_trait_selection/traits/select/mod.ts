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
import type { Clause, Clauses, Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
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

unported_methods(SelectionContext.prototype, "rustc_trait_selection::traits::select::SelectionContext", [
  // mod.rs:1716..2797 (lane old-select-b)
  "winnow_candidates",
  "prefer_lhs_over_victim",
  "sizedness_conditions",
  "copy_clone_conditions",
  "coroutine_is_gen",
  "constituent_types_for_auto_trait",
  "collect_predicates_for_types",
  "rematch_impl",
  "match_impl",
  "match_upcast_principal",
  "match_where_clause_trait_ref",
  "match_poly_trait_ref",
  "match_fresh_trait_preds",
  "push_stack",
  "closure_trait_ref_unnormalized",
  "impl_or_trait_obligations",
  "should_stall_coroutine",
]);

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
