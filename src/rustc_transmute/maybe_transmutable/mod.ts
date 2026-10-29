// Port of compiler/rustc_transmute/src/maybe_transmutable/mod.rs (lane transmute, wave 30).
//
// PORT:
// - The three `answer` methods of `MaybeTransmutableQuery<L, C>` (for `L = Ty`, `L = Tree`, `L = Dfa`; every call site
//   knows `L` statically) are `answer_ty` / `answer_tree` / `answer_dfa`. `answer_tree` takes the `QueryContext` table of
//   `C` (`C: QueryContext`; query_context.ts).
// - `impl<R, T> Answer<R, T>` (`and` / `or`, crate-private, in this file) is the object `AnswerExt`: the companion
//   `Answer` is defined in lib.ts, which this module imports (init order).
// - `Answer::and` / `or` take their arguments by value and append to their `Vec`s in place, as upstream; the memo
//   cache stores and hands out clones (`answer.clone()`), so no two answers share a vector.
// - Iterators are lazy as upstream (generators), so `Quantifier::apply` short-circuits the same work.
// - `tracing` (`#[instrument]`, `debug!`, `trace!`) is dropped (no output in the oracle).

import { LayoutCx } from "../../rustc_middle/ty/layout.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { panic } from "../../std/panic.ts";
import { Answer, type Assume, clone_Answer, type Condition, type Reason } from "../lib.ts";
import { Dfa, type State, state_pair_key, union } from "../layout/dfa.ts";
import type { Reference } from "../layout/mod.ts";
import { Tree } from "../layout/tree.ts";
import type { rustc as tree_rustc } from "../layout/tree.ts";
import { type QueryContext, QueryContext_TyCtxt } from "./query_context.ts";

// pub(crate) mod query_context;
// #[cfg(test)]
// mod tests;

/** `Answer::No(reason)` */
function No<R, T>(reason: Reason<T>): Answer<R, T> {
  return { $: "No", _0: reason };
}

/** The memo cache of `answer_memo`: `Map<(dfa::State, dfa::State), Answer<R, T>>`. */
type Cache<R, T> = Map<[State, State], Answer<R, T>>;

export class MaybeTransmutableQuery<L, C> {
  constructor(
    public src: L,
    public dst: L,
    public assume: Assume,
    public context: C,
  ) {}

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:25 new
  static new<L, C>(src: L, dst: L, assume: Assume, context: C): MaybeTransmutableQuery<L, C> {
    return new MaybeTransmutableQuery(src, dst, assume, context);
  }

  // ---- #[cfg(feature = "rustc")] mod rustc: impl<'tcx> MaybeTransmutableQuery<Ty<'tcx>, TyCtxt<'tcx>> ----
  // use crate::layout::tree::rustc::Err;

  /// This method begins by converting `src` and `dst` from `Ty`s to `Tree`s,
  /// then computes an answer using those trees.
  // #[instrument(level = "debug", skip(self), fields(src = ?self.src, dst = ?self.dst))]
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:42 answer
  answer_ty(this: MaybeTransmutableQuery<Ty, TyCtxt>): Answer<Region, Ty> {
    const { src: src_, dst: dst_, assume, context } = this;

    const layout_cx = LayoutCx.new(context, TypingEnv.fully_monomorphized());

    // Convert `src` and `dst` from their rustc representations, to `Tree`-based
    // representations.
    const src = Tree.from_ty(src_, layout_cx);
    const dst = Tree.from_ty(dst_, layout_cx);

    const is = (r: typeof src, e: tree_rustc.Err["$"]): boolean => r.$ === "Err" && r._0.$ === e;
    if (is(src, "TypeError") || is(dst, "TypeError")) {
      return No({ $: "TypeError" });
    } else if (is(src, "UnknownLayout")) {
      return No({ $: "SrcLayoutUnknown" });
    } else if (is(dst, "UnknownLayout")) {
      return No({ $: "DstLayoutUnknown" });
    } else if (is(src, "NotYetSupported")) {
      return No({ $: "SrcIsNotYetSupported" });
    } else if (is(dst, "NotYetSupported")) {
      return No({ $: "DstIsNotYetSupported" });
    } else if (is(src, "SizeOverflow")) {
      return No({ $: "SrcSizeOverflow" });
    } else if (is(dst, "SizeOverflow")) {
      return No({ $: "DstSizeOverflow" });
    } else if (src.$ === "Ok" && dst.$ === "Ok") {
      return new MaybeTransmutableQuery(src._0, dst._0, assume, context).answer_tree(QueryContext_TyCtxt);
    } else {
      // Every `Err` variant is matched above.
      return panic("internal error: entered unreachable code");
    }
  }

  // ---- impl<C> MaybeTransmutableQuery<Tree<C::Def, C::Region, C::Type>, C> ----

  /// Answers whether a `Tree` is transmutable into another `Tree`.
  ///
  /// Removes definition markers from both trees and, unless safety is assumed,
  /// prunes destination paths that may carry safety invariants. It then converts
  /// the remaining layouts to `Dfa`s and compares them.
  // #[inline(always)]
  // #[instrument(level = "debug", skip(self), fields(src = ?self.src, dst = ?self.dst))]
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:86 answer
  answer_tree<D, R, T>(this: MaybeTransmutableQuery<Tree<D, R, T>, C>, c: QueryContext<D, R, T>): Answer<R, T> {
    const { src: src_, dst: dst_, assume, context } = this;

    // Keep every source representation while removing its definition markers.
    // Reference nodes remain intact; mutable destination references also generate
    // a reverse transmutability obligation for their referents.
    const src = Tree.prune(src_, (_def) => false);

    if (Tree.is_inhabited(src) && !Tree.is_inhabited(dst_)) {
      return No({ $: "DstUninhabited" });
    }

    // trace!(?src, "pruned src");

    // Remove destination definition markers. Unless the caller assumes safety,
    // prune paths whose definitions may carry safety invariants.
    let dst: Tree<never, R, T>;
    if (assume.safety) {
      dst = Tree.prune(dst_, (_def) => false);
    } else {
      dst = Tree.prune(dst_, (def) => c.Def.has_safety_invariants(def));
    }

    // trace!(?dst, "pruned dst");

    // Convert `src` from a tree-based representation to a DFA-based
    // representation. If the conversion fails because `src` is uninhabited,
    // conclude that the transmutation is acceptable, because instances of
    // the `src` type do not exist.
    const src_dfa = Dfa.from_tree(src);
    if (src_dfa.$ === "Err") return Answer.Yes;

    // An inhabited source and an originally uninhabited destination were
    // rejected above. If the pruned destination is now uninhabited, no path
    // remains whose definitions are known to be free of safety invariants.
    const dst_dfa = Dfa.from_tree(dst);
    if (dst_dfa.$ === "Err") return No({ $: "DstMayHaveSafetyInvariants" });

    return new MaybeTransmutableQuery(src_dfa._0, dst_dfa._0, assume, context).answer_dfa();
  }

  // ---- impl<C> MaybeTransmutableQuery<Dfa<C::Region, C::Type>, C> ----

  /// Answers whether a `Dfa` is transmutable into another `Dfa`.
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:136 answer
  answer_dfa<R, T>(this: MaybeTransmutableQuery<Dfa<R, T>, C>): Answer<R, T> {
    // debug!(src = ?self.src);
    // debug!(dst = ?self.dst);
    // debug!(src_transitions_len = self.src.transitions.len(), dst_transitions_len = self.dst.transitions.len());
    return this.answer_memo(new KeyedMap<[State, State], Answer<R, T>>(state_pair_key), this.src.start, this.dst.start);
  }

  // #[inline(always)]
  // #[instrument(level = "debug", skip(self, cache))]
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:148 answer_memo
  answer_memo<R, T>(this: MaybeTransmutableQuery<Dfa<R, T>, C>, cache: Cache<R, T>, src_state: State, dst_state: State): Answer<R, T> {
    const cached = cache.get([src_state, dst_state]);
    if (cached !== undefined) {
      return clone_Answer(cached);
    } else {
      const answer = this.answer_impl(cache, src_state, dst_state);
      // `if let Some(..) = cache.insert((src_state, dst_state), answer.clone())`
      const had = cache.has([src_state, dst_state]);
      cache.set([src_state, dst_state], clone_Answer(answer));
      if (had) {
        return panic("failed to correctly cache transmutability");
      }
      return answer;
    }
  }

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:168 answer_impl
  answer_impl<R, T>(this: MaybeTransmutableQuery<Dfa<R, T>, C>, cache: Cache<R, T>, src_state: State, dst_state: State): Answer<R, T> {
    // debug!(?src_state, ?dst_state);
    if (dst_state === this.dst.accept) {
      // The destination needs no more input. Union transmutation permits
      // truncating the remaining source bytes: for example, `u8` to `()`.
      // Compatibility of the consumed prefix is checked by the preceding
      // transitions, including any conditions they generate for references.
      return Answer.Yes;
    } else if (src_state === this.src.accept) {
      // extension: `size_of(Src) <= size_of(Dst)`
      const dst_state_prime = this.dst.get_uninit_edge_dst(dst_state);
      if (dst_state_prime !== undefined) {
        return this.answer_memo(cache, src_state, dst_state_prime);
      } else {
        return No({ $: "DstIsTooBig" });
      }
    } else {
      let src_quantifier: Quantifier;
      if (this.assume.validity) {
        // The caller checks validity (for example, `src <= 1u8` for a
        // `u8`-to-`bool` transmutation), so at least one source transition
        // must admit a compatible continuation.
        src_quantifier = "ThereExists";
      } else {
        // Every source transition must admit a compatible continuation
        // in the destination when the caller does not assume validity.
        src_quantifier = "ForAll";
      }

      const self = this;
      const bytes_answer = Quantifier.apply<R, T>(
        src_quantifier,
        (function* (): Generator<Answer<R, T>> {
          for (const [_range, [src_state_prime, dst_state_prime]] of union(self.src.bytes_from(src_state), self.dst.bytes_from(dst_state))) {
            if (src_state_prime === undefined) {
              // No matching transitions in `src`. Skip.
              continue;
            } else if (dst_state_prime === undefined) {
              // No matching transitions in `dst`. Fail.
              yield No({ $: "DstIsBitIncompatible" });
            } else {
              // Matching transitions. Continue with successor states.
              yield self.answer_memo(cache, src_state_prime, dst_state_prime);
            }
          }
        })(),
      );

      // The below early returns reflect how this code would behave:
      //   if self.assume.validity {
      //       or(bytes_answer, refs_answer)
      //   } else {
      //       and(bytes_answer, refs_answer)
      //   }
      // ...if `refs_answer` was computed lazily. The below early
      // returns can be deleted without impacting the correctness of
      // the algorithm; only its performance.
      // debug!(?bytes_answer);
      if (bytes_answer.$ === "No" && !this.assume.validity) {
        return bytes_answer;
      } else if (bytes_answer.$ === "Yes" && this.assume.validity) {
        return bytes_answer;
      }

      const refs_answer = Quantifier.apply<R, T>(
        src_quantifier,
        // for each reference transition out of `src_state`...
        map(self.src.refs_from(src_state), ([src_ref, src_state_prime]) =>
          // ...there exists a reference transition out of `dst_state`...
          Quantifier.apply<R, T>(
            "ThereExists",
            map(self.dst.refs_from(dst_state), ([dst_ref, dst_state_prime]): Answer<R, T> => {
              if (!src_ref.is_mut && dst_ref.is_mut) {
                return No({ $: "DstIsMoreUnique" });
              } else if (!self.assume.alignment && src_ref.referent_align < dst_ref.referent_align) {
                return No({
                  $: "DstHasStricterAlignment",
                  src_min_align: src_ref.referent_align,
                  dst_min_align: dst_ref.referent_align,
                });
              } else if (dst_ref.referent_size > src_ref.referent_size) {
                return No({
                  $: "DstRefIsTooBig",
                  src: src_ref.referent,
                  src_size: src_ref.referent_size,
                  dst: dst_ref.referent,
                  dst_size: dst_ref.referent_size,
                });
              } else {
                const conditions: Condition<R, T>[] = [];
                const is_transmutable = (src: Reference<R, T>, dst: Reference<R, T>): void => {
                  conditions.push({
                    $: "Transmutable",
                    src: src.referent,
                    dst: dst.referent,
                  });
                  if (!self.assume.lifetimes) {
                    conditions.push({
                      $: "Outlives",
                      long: src.region,
                      short: dst.region,
                    });
                  }
                };

                is_transmutable(src_ref, dst_ref);

                if (dst_ref.is_mut) {
                  is_transmutable(dst_ref, src_ref);
                } else {
                  conditions.push({ $: "Immutable", ty: dst_ref.referent });
                }

                return AnswerExt.and<R, T>({ $: "If", _0: { $: "IfAll", _0: conditions } }, self.answer_memo(cache, src_state_prime, dst_state_prime));
              }
            }),
          ),
        ),
      );

      if (this.assume.validity) {
        return AnswerExt.or(bytes_answer, refs_answer);
      } else {
        return AnswerExt.and(bytes_answer, refs_answer);
      }
    }
  }
}

/** Lazy `Iterator::map` (module comment). */
function* map<A, B>(iter: Iterable<A>, f: (a: A) => B): Generator<B> {
  for (const a of iter) yield f(a);
}

// impl<R, T> Answer<R, T>
export const AnswerExt = {
  /// Requires both answers, combining their conditions into a conjunction.
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:304 and
  and<R, T>(self: Answer<R, T>, rhs: Answer<R, T>): Answer<R, T> {
    const lhs = self;
    // Prefer a specific reason over generic bit incompatibility;
    // otherwise, retain the left-hand reason.
    // (Answer::No(Reason::DstIsBitIncompatible), Answer::No(reason))
    // | (Answer::No(reason), Answer::No(_))
    // If either is an error, return it
    // | (Answer::No(reason), _) | (_, Answer::No(reason)) => Answer::No(reason),
    if (lhs.$ === "No" && lhs._0.$ === "DstIsBitIncompatible" && rhs.$ === "No") return No(rhs._0);
    if (lhs.$ === "No") return No(lhs._0);
    if (rhs.$ === "No") return No(rhs._0);
    // If only one side has a condition, pass it along
    if (lhs.$ === "Yes") return rhs;
    if (rhs.$ === "Yes") return lhs;
    const [l, r] = [lhs._0, rhs._0];
    // If both sides have IfAll conditions, merge them
    if (l.$ === "IfAll" && r.$ === "IfAll") {
      const lhs = l._0;
      for (const c of r._0) lhs.push(c);
      return { $: "If", _0: { $: "IfAll", _0: lhs } };
    }
    // If only one side is an IfAll, add the other Condition to it
    if (r.$ === "IfAll") {
      const conds = r._0;
      conds.push(l);
      return { $: "If", _0: { $: "IfAll", _0: conds } };
    }
    if (l.$ === "IfAll") {
      const conds = l._0;
      conds.push(r);
      return { $: "If", _0: { $: "IfAll", _0: conds } };
    }
    // Otherwise, both lhs and rhs conditions can be combined in a parent IfAll
    return { $: "If", _0: { $: "IfAll", _0: [l, r] } };
  },

  /// Combines alternative answers and collects their conditions in an `IfAny`.
  ///
  /// Currently, combining `Yes` with `If` retains the condition. This differs
  /// from Boolean disjunction, where unconditional success would suffice.
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:335 or
  or<R, T>(self: Answer<R, T>, rhs: Answer<R, T>): Answer<R, T> {
    const lhs = self;
    // Prefer a specific reason over generic bit incompatibility;
    // otherwise, retain the left-hand reason.
    // (Answer::No(Reason::DstIsBitIncompatible), Answer::No(reason))
    // | (Answer::No(reason), Answer::No(_)) => Answer::No(reason),
    if (lhs.$ === "No" && lhs._0.$ === "DstIsBitIncompatible" && rhs.$ === "No") return No(rhs._0);
    if (lhs.$ === "No" && rhs.$ === "No") return No(lhs._0);
    // Otherwise, errors can be ignored for the rest of the pattern matching
    // (Answer::No(_), other) | (other, Answer::No(_)) => other.or(Answer::Yes),
    if (lhs.$ === "No") return AnswerExt.or(rhs, Answer.Yes);
    if (rhs.$ === "No") return AnswerExt.or(lhs, Answer.Yes);
    // If only one side has a condition, pass it along
    if (lhs.$ === "Yes") return rhs;
    if (rhs.$ === "Yes") return lhs;
    const [l, r] = [lhs._0, rhs._0];
    // If both sides have IfAny conditions, merge them
    if (l.$ === "IfAny" && r.$ === "IfAny") {
      const lhs = l._0;
      for (const c of r._0) lhs.push(c);
      return { $: "If", _0: { $: "IfAny", _0: lhs } };
    }
    // If only one side is an IfAny, add the other Condition to it
    if (r.$ === "IfAny") {
      const conds = r._0;
      conds.push(l);
      return { $: "If", _0: { $: "IfAny", _0: conds } };
    }
    if (l.$ === "IfAny") {
      const conds = l._0;
      conds.push(r);
      return { $: "If", _0: { $: "IfAny", _0: conds } };
    }
    // Otherwise, both lhs and rhs conditions can be combined in a parent IfAny
    return { $: "If", _0: { $: "IfAny", _0: [l, r] } };
  },
};

export type Quantifier = "ThereExists" | "ForAll";
export const Quantifier = {
  ThereExists: "ThereExists",
  ForAll: "ForAll",

  /// Folds answers with `or` or `and`, stopping on `Yes` or `No`, respectively.
  /// An empty iterator yields bit incompatibility for `ThereExists` and `Yes`
  /// for `ForAll`.
  // PORT: `I: IntoIterator`: an iterable (an iterator passed by `&mut` keeps its remaining items, as `try_fold`).
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/mod.rs:372 apply
  apply<R, T>(self: Quantifier, iter: Iterable<Answer<R, T>>): Answer<R, T> {
    // use std::ops::ControlFlow::{Break, Continue};

    let init: Answer<R, T>;
    let try_fold_f: (accum: Answer<R, T>, next: Answer<R, T>) => { $: "Break" | "Continue"; _0: Answer<R, T> };
    switch (self) {
      case "ThereExists": {
        init = No({ $: "DstIsBitIncompatible" });
        try_fold_f = (accum, next) => {
          const r = AnswerExt.or(accum, next);
          if (r.$ === "Yes") {
            return { $: "Break", _0: Answer.Yes };
          } else {
            const maybe = r;
            return { $: "Continue", _0: maybe };
          }
        };
        break;
      }
      case "ForAll": {
        init = Answer.Yes;
        try_fold_f = (accum, next) => {
          const answer = AnswerExt.and(accum, next);
          if (answer.$ === "No") {
            return { $: "Break", _0: answer };
          } else {
            const maybe = answer;
            return { $: "Continue", _0: maybe };
          }
        };
        break;
      }
    }

    // `let (Continue(result) | Break(result)) = iter.into_iter().try_fold(init, try_fold_f);`
    const it = iter[Symbol.iterator]();
    let accum = init;
    for (;;) {
      const n = it.next();
      if (n.done) break;
      const cf = try_fold_f(accum, n.value);
      if (cf.$ === "Break") return cf._0;
      accum = cf._0;
    }
    const result = accum;
    return result;
  },
} as const;
