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
import type { Diag } from "../../../rustc_errors/lib.ts";
import { TypeFreshener } from "../../../rustc_infer/infer/freshen.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import { debug_Obligation } from "../../../rustc_infer/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { display_TraitRefPrintSugared, TraitRef_print_trait_sugared, with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import type { PolyTraitClause } from "../../../rustc_middle/ty/predicate.ts";
import type { EvaluationResult } from "../../../rustc_middle/traits/select.ts";
import { debug_Binder } from "../../../rustc_type_ir/binder.ts";
import { type CantBeErased, TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { debug_TraitClause } from "../../../rustc_type_ir/predicate.ts";
import { type Fmt, PLAIN } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import type { TraitQueryMode } from "../mod.gen.ts";
import {
  type IntercrateAmbiguityCause as IntercrateAmbiguityCauseT,
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

unported_methods(SelectionContext.prototype, "rustc_trait_selection::traits::select::SelectionContext", [
  // mod.rs:223..1709 (lane old-select-a)
  "poly_select",
  "select",
  "select_from_obligation",
  "candidate_from_obligation",
  "candidate_from_obligation_no_cache",
  "evaluate_root_obligation",
  "evaluation_probe",
  "evaluate_predicates_recursively",
  "evaluate_predicate_recursively",
  "evaluate_trait_predicate_recursively",
  "check_evaluation_cycle",
  "evaluate_stack",
  "coinductive_match",
  "evaluate_candidate",
  "check_evaluation_cache",
  "insert_evaluation_cache",
  "check_recursion_depth",
  "check_recursion_limit",
  "in_task",
  "filter_impls",
  "can_use_global_caches",
  "check_candidate_cache",
  "can_cache_candidate",
  "insert_candidate_cache",
  "for_each_item_bound",
  "match_normalize_trait_ref",
  "where_clause_may_apply",
  "match_projection_projections",
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
