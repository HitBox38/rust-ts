// Port of compiler/rustc_mir_transform/src/dest_prop.rs (lane mt-opt2-c).
//
// PORT: `RelevantLocal` / `TwoStepIndex` are `newtype_index!`es (branded numbers with the companion helpers);
// `IndexVec<RelevantLocal, Local>` / `IndexVec<Local, Option<RelevantLocal>>` are arrays. `TwoStepIndex::new(..)` is the
// inherent fn on the companion (`Idx::new` stays `TwoStepIndex.new_`); `current + 1` (`Add<usize>`) is
// `TwoStepIndex.from_u32(current + 1)` (both assert `<= MAX`). `GenKillIntervalMatrix` is a class plus its `GenKill`
// impl table (`GenKill_GenKillIntervalMatrix`, PORTING §5 trait tables), hoisted out of `save_as_intervals`; the
// `VisitPlacesWith` closures capture `state` / `relevant` as upstream. The derived `Debug` of `RelevantLocals` /
// `Candidates` is only reached from `trace!` and is not ported. `*local = ..` in `Merger::visit_local` writes the
// `MutRef`; `dest == place` compares `local` and the interned `projection` list.
//! Propagates assignment destinations backwards in the CFG to eliminate redundant assignments.
//!
//! # Motivation
//!
//! MIR building can insert a lot of redundant copies, and Rust code in general often tends to move
//! values around a lot. The result is a lot of assignments of the form `dest = {move} src;` in MIR.
//! MIR building for constants in particular tends to create additional locals that are only used
//! inside a single block to shuffle a value around unnecessarily.
//!
//! LLVM by itself is not good enough at eliminating these redundant copies (eg. see
//! <https://github.com/rust-lang/rust/issues/32966>), so this leaves some performance on the table
//! that we can regain by implementing an optimization for removing these assign statements in rustc
//! itself. When this optimization runs fast enough, it can also speed up the constant evaluation
//! and code generation phases of rustc due to the reduced number of statements and locals.
//!
//! # The Optimization
//!
//! Conceptually, this optimization is "destination propagation". It is similar to the Named Return
//! Value Optimization, or NRVO, known from the C++ world, except that it isn't limited to return
//! values or the return place `_0`. On a very high level, independent of the actual implementation
//! details, it does the following:
//!
//! 1) Identify `dest = src;` statements with values for `dest` and `src` whose storage can soundly
//!    be merged.
//! 2) Replace all mentions of `src` with `dest` ("unifying" them and propagating the destination
//!    backwards).
//! 3) Delete the `dest = src;` statement (by making it a `nop`).
//!
//! Step 1) is by far the hardest, so it is explained in more detail below.
//!
//! ## Soundness
//!
//! We have a pair of places `p` and `q`, whose memory we would like to merge. In order for this to
//! be sound, we need to check a number of conditions:
//!
//! * `p` and `q` must both be *constant* - it does not make much sense to talk about merging them
//!   if they do not consistently refer to the same place in memory. This is satisfied if they do
//!   not contain any indirection through a pointer or any indexing projections.
//!
//! * `p` and `q` must have the **same type**. If we replace a local with a subtype or supertype,
//!   we may end up with a different vtable for that local. See the `subtyping-impacts-selection`
//!   tests for an example where that causes issues.
//!
//! * We need to make sure that the goal of "merging the memory" is actually structurally possible
//!   in MIR. For example, even if all the other conditions are satisfied, there is no way to
//!   "merge" `_5.foo` and `_6.bar`. For now, we ensure this by requiring that both `p` and `q` are
//!   locals with no further projections. Future iterations of this pass should improve on this.
//!
//! * Finally, we want `p` and `q` to use the same memory - however, we still need to make sure that
//!   each of them has enough "ownership" of that memory to continue "doing its job." More
//!   precisely, what we will check is that whenever the program performs a write to `p`, then it
//!   does not currently care about what the value in `q` is (and vice versa). We formalize the
//!   notion of "does not care what the value in `q` is" by checking the *liveness* of `q`.
//!
//!   Because of the difficulty of computing liveness of places that have their address taken, we do
//!   not even attempt to do it. Any places that are in a local that has its address taken is
//!   excluded from the optimization.
//!
//! The first two conditions are simple structural requirements on the `Assign` statements that can
//! be trivially checked. The third requirement however is more difficult and costly to check.
//!
//! ## Current implementation
//!
//! The current implementation relies on live range computation to check for conflicts. We only
//! allow to merge locals that have disjoint live ranges. The live range are defined with
//! half-statement granularity, so as to make all writes be live for at least a half statement.
//!
//! ## Future Improvements
//!
//! There are a number of ways in which this pass could be improved in the future:
//!
//! * Merging storage liveness ranges instead of removing storage statements completely. This may
//!   improve stack usage.
//!
//! * Allow merging locals into places with projections, eg `_5` into `_6.foo`.
//!
//! * Liveness analysis with more precision than whole locals at a time. The smaller benefit of this
//!   is that it would allow us to dest prop at "sub-local" levels in some cases. The bigger benefit
//!   of this is that such liveness analysis can report more accurate results about whole locals at
//!   a time. For example, consider:
//!
//!   ```ignore (syntax-highlighting-only)
//!   _1 = u;
//!   // unrelated code
//!   _1.f1 = v;
//!   _2 = _1.f1;
//!   ```
//!
//!   Because the current analysis only thinks in terms of locals, it does not have enough
//!   information to report that `_1` is dead in the "unrelated code" section.
//!
//! * Liveness analysis enabled by alias analysis. This would allow us to not just bail on locals
//!   that ever have their address taken. Of course that requires actually having alias analysis
//!   (and a model to build it on), so this might be a bit of a ways off.
//!
//! * Various perf improvements. There are a bunch of comments in here marked `PERF` with ideas for
//!   how to do things more efficiently. However, the complexity of the pass as a whole should be
//!   kept in mind.
//!
//! ## Previous Work
//!
//! A [previous attempt][attempt 1] at implementing an optimization like this turned out to be a
//! significant regression in compiler performance. Fixing the regressions introduced a lot of
//! undesirable complexity to the implementation.
//!
//! A [subsequent approach][attempt 2] tried to avoid the costly computation by limiting itself to
//! acyclic CFGs, but still turned out to be far too costly to run due to suboptimal performance
//! within individual basic blocks, requiring a walk across the entire block for every assignment
//! found within the block. For the `tuple-stress` benchmark, which has 458745 statements in a
//! single block, this proved to be far too costly.
//!
//! [Another approach after that][attempt 3] was much closer to correct, but had some soundness
//! issues - it was failing to consider stores outside live ranges, and failed to uphold some of the
//! requirements that MIR has for non-overlapping places within statements. However, it also had
//! performance issues caused by `O(l² * s)` runtime, where `l` is the number of locals and `s` is
//! the number of statements and terminators.
//!
//! Since the first attempt at this, the compiler has improved dramatically, and new analysis
//! frameworks have been added that should make this approach viable without requiring a limited
//! approach that only works for some classes of CFGs:
//! - rustc now has a powerful dataflow analysis framework that can handle forwards and backwards
//!   analyses efficiently.
//! - Layout optimizations for coroutines have been added to improve code generation for
//!   async/await, which are very similar in spirit to what this optimization does.
//!
//! [The next approach][attempt 4] computes a conflict matrix between locals by forbidding merging
//! locals with competing writes or with one write while the other is live.
//!
//! ## Pre/Post Optimization
//!
//! It is recommended to run `SimplifyCfg` and then `SimplifyLocals` some time after this pass, as
//! it replaces the eliminated assign statements with `nop`s and leaves unused locals behind.
//!
//! [liveness]: https://en.wikipedia.org/wiki/Live_variable_analysis
//! [attempt 1]: https://github.com/rust-lang/rust/pull/47954
//! [attempt 2]: https://github.com/rust-lang/rust/pull/71003
//! [attempt 3]: https://github.com/rust-lang/rust/pull/72632
//! [attempt 4]: https://github.com/rust-lang/rust/pull/96451
import { UnionFind } from "../rustc_data_structures/union_find.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { range, range_inclusive } from "../rustc_index/idx.ts";
import { SparseIntervalMatrix } from "../rustc_index/interval.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { type BasicBlock, type Body, debug_Local, type Local, type Location, type Place, type Statement, traversal } from "../rustc_middle/mir/mod.ts";
import { MirDumper } from "../rustc_middle/mir/pretty.ts";
import type { PassWhere } from "../rustc_middle/mir/pretty.gen.ts";
import { MutVisitor, type PlaceContext, VisitPlacesWith, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { borrowed_locals } from "../rustc_mir_dataflow/impls/borrowed_locals.ts";
import { DefUse, LivenessTransferFunction, MaybeLiveLocals } from "../rustc_mir_dataflow/impls/liveness.ts";
import { type GenKill, GenKill_provided } from "../rustc_mir_dataflow/framework/mod.ts";
import type { EntryStates } from "../rustc_mir_dataflow/framework/results.ts";
import { DenseLocationMap, PointIndex } from "../rustc_mir_dataflow/points.ts";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import type { IoResult } from "../std/io.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unreachable } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import type { Write } from "../vendor/anstream/stream.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/** PORT: derived `PartialEq` of `mir::Place` (header). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:154 DestinationPropagation
export class DestinationPropagation extends MirPass {
  readonly type_name = "rustc_mir_transform::dest_prop::DestinationPropagation";

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:157 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // #[tracing::instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:162 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // let def_id = body.source.def_id();
    // trace!(?def_id);

    const borrowed = borrowed_locals(body);

    const candidates = Candidates.find(body, borrowed);
    // trace!(?candidates);
    if (candidates.c.length === 0) {
      return;
    }

    const live_ = new MaybeLiveLocals().iterate_to_fixpoint(tcx, body, "MaybeLiveLocals-DestProp");

    const points = DenseLocationMap.new(body);
    const relevant = RelevantLocals.compute(candidates, body.local_decls.length);
    const live = save_as_intervals(points, body, relevant, live_.entry_states);

    dest_prop_mir_dump(tcx, body, points, live, relevant);

    const merged_locals = DenseBitSet.new_empty<Local>(body.local_decls.length);

    for (const [src0, dst0] of candidates.c) {
      // trace!(?src, ?dst);

      let src = relevant.find(src0);
      if (src === undefined) continue;
      let dst = relevant.find(dst0);
      if (dst === undefined) continue;
      if (src === dst) {
        continue;
      }

      const src_live_ranges = live.row(src);
      if (src_live_ranges === undefined) continue;
      const dst_live_ranges = live.row(dst);
      if (dst_live_ranges === undefined) continue;
      // trace!(?src, ?src_live_ranges);
      // trace!(?dst, ?dst_live_ranges);

      if (src_live_ranges.disjoint(dst_live_ranges)) {
        // We want to replace `src` by `dst`.
        let orig_src = relevant.original[src]!;
        let orig_dst = relevant.original[dst]!;

        // The return place and function arguments are required and cannot be renamed.
        // This check cannot be made during candidate collection, as we may want to
        // unify the same non-required local with several required locals.
        const src_required = is_local_required(orig_src, body);
        const dst_required = is_local_required(orig_dst, body);
        if (!src_required) {
          // Renaming `src` is ok.
        } else if (!dst_required) {
          // Renaming `src` is wrong, but renaming `dst` is ok.
          [src, dst] = [dst, src];
          [orig_src, orig_dst] = [orig_dst, orig_src];
        } else {
          // Neither local can be renamed, so skip this case.
          continue;
        }

        // trace!(?src, ?dst, "merge");
        merged_locals.insert(orig_src);
        merged_locals.insert(orig_dst);

        // Replace `src` by `dst`.
        const head = relevant.union(src, dst);
        live.union_rows(/* read */ src, /* write */ head);
        live.union_rows(/* read */ dst, /* write */ head);
      }
    }
    // trace!(?merged_locals);
    // trace!(?relevant.renames);

    if (merged_locals.is_empty()) {
      return;
    }

    apply_merges(body, tcx, relevant, merged_locals);
  }
}

//////////////////////////////////////////////////////////
// Merging
//
// Applies the actual optimization

// rustc: compiler/rustc_mir_transform/src/dest_prop.rs:244 apply_merges
function apply_merges(body: Body, tcx: TyCtxt, relevant: RelevantLocals, merged_locals: DenseBitSet<Local>): void {
  const merger = new Merger(tcx, relevant, merged_locals);
  merger.visit_body_preserves_cfg(body);
}

// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:254 Merger
class Merger extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public relevant: RelevantLocals,
    public merged_locals: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:261 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:265 visit_local
  override visit_local(local: MutRef<Local>, _: PlaceContext, _location: Location): void {
    const relevant = this.relevant.find(local.value);
    if (relevant !== undefined) {
      local.value = this.relevant.original[relevant]!;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:271 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const k = statement.kind;
    // FIXME: Don't delete storage statements, but "merge" the storage ranges instead.
    if ((k.$ === "StorageDead" || k.$ === "StorageLive") && this.merged_locals.contains(k._0)) {
      statement.make_nop(true);
    }
    this.super_statement(statement, location);
    const k2 = statement.kind;
    if (k2.$ === "Assign") {
      const [dest, rvalue] = k2._0;
      if (rvalue.$ === "Use" && (rvalue._0.$ === "Copy" || rvalue._0.$ === "Move")) {
        const place = rvalue._0._0;
        // These might've been turned into self-assignments by the replacement
        // (this includes the original statement we wanted to eliminate).
        if (place_eq(dest, place)) {
          // debug!("{:?} turned into self-assignment, deleting", location);
          statement.make_nop(true);
        }
      }
    }
  }
}

//////////////////////////////////////////////////////////
// Relevant locals
//
// Small utility to reduce size of the conflict matrix by only considering locals that appear in
// the candidates

// newtype_index! {
//     /// Represent a subset of locals which appear in candidates.
//     struct RelevantLocal {}
// }
/// Represent a subset of locals which appear in candidates.
// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:310 RelevantLocal
type RelevantLocal = number & { readonly __brand: "RelevantLocal" };
const RelevantLocal = newtype_index<RelevantLocal>((n) => `${n}`);

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:314 RelevantLocals
class RelevantLocals {
  constructor(
    public original: Local[],
    public shrink: (RelevantLocal | undefined)[],
    public renames: UnionFind<RelevantLocal>,
  ) {}

  // #[tracing::instrument(level = "trace", skip(candidates, num_locals), ret)]
  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:322 compute
  static compute(candidates: Candidates, num_locals: number): RelevantLocals {
    const original: Local[] = [];
    const shrink: (RelevantLocal | undefined)[] = new Array<RelevantLocal | undefined>(num_locals).fill(undefined);

    // Mark a local as relevant and record it into the maps.
    const declare = (local: Local): void => {
      if (shrink[local] === undefined) {
        shrink[local] = RelevantLocal.from_usize(original.push(local) - 1);
      }
    };

    for (const [src, dest] of candidates.c) {
      declare(src);
      declare(dest);
    }

    const renames = UnionFind.new<RelevantLocal>(original.length);
    return new RelevantLocals(original, shrink, renames);
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:340 find
  find(src_: Local): RelevantLocal | undefined {
    const src = this.shrink[src_];
    if (src === undefined) return undefined;
    return this.renames.find(src);
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:346 union
  union(lhs: RelevantLocal, rhs: RelevantLocal): RelevantLocal {
    const head = this.renames.unify(lhs, rhs);
    // We need to ensure we keep the original local of the RHS, as it may be a required local.
    this.original[head] = this.original[rhs]!;
    return head;
  }
}

/////////////////////////////////////////////////////
// Candidate accumulation

// #[derive(Debug, Default)]
// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:358 Candidates
class Candidates {
  constructor(
    /// The set of candidates we are considering in this optimization.
    ///
    /// Whether a place ends up in the key or the value does not correspond to whether it appears as
    /// the lhs or rhs of any assignment. As a matter of fact, the places in here might never appear
    /// in an assignment at all. This happens because if we see an assignment like this:
    ///
    /// ```ignore (syntax-highlighting-only)
    /// _1.0 = _2.0
    /// ```
    ///
    /// We will still report that we would like to merge `_1` and `_2` in an attempt to allow us to
    /// remove that assignment.
    public c: [Local, Local][],
  ) {}

  // We first implement some utility functions which we will expose removing candidates according to
  // different needs. Throughout the liveness filtering, the `candidates` are only ever accessed
  // through these methods, and not directly.

  /// Collects the candidates for merging.
  ///
  /// This is responsible for enforcing the first and third bullet point.
  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:381 find
  static find(body: Body, borrowed: DenseBitSet<Local>): Candidates {
    const visitor = new FindAssignments(body, [], borrowed);
    visitor.visit_body(body);

    return new Candidates(visitor.candidates);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:389 FindAssignments
class FindAssignments extends Visitor {
  constructor(
    public body: Body,
    public candidates: [Local, Local][],
    public borrowed: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:396 visit_statement
  override visit_statement(statement: Statement, _: Location): void {
    const k = statement.kind;
    if (k.$ !== "Assign") return;
    const [lhs, rv] = k._0;
    if (!(rv.$ === "Use" && (rv._0.$ === "Copy" || rv._0.$ === "Move"))) return;
    const rhs = rv._0._0;
    const src = lhs.as_local();
    if (src === undefined) return;
    const dest = rhs.as_local();
    if (dest === undefined) return;
    // As described at the top of the file, we do not go near things that have
    // their address taken.
    if (this.borrowed.contains(src) || this.borrowed.contains(dest)) {
      return;
    }

    // As described at the top of this file, we do not touch locals which have
    // different types.
    const src_ty = this.body.local_decls_()[src]!.ty;
    const dest_ty = this.body.local_decls_()[dest]!.ty;
    if (src_ty !== dest_ty) {
      // FIXME(#112651): This can be removed afterwards. Also update the module description.
      // trace!("skipped `{src:?} = {dest:?}` due to subtyping: {src_ty} != {dest_ty}");
      return;
    }

    // We may insert duplicates here, but that's fine
    this.candidates.push([src, dest]);
  }
}

/// Some locals are part of the function's interface and can not be removed.
///
/// Note that these locals *can* still be merged with non-required locals by removing that other
/// local.
// rustc: compiler/rustc_mir_transform/src/dest_prop.rs:428 is_local_required
function is_local_required(local: Local, body: Body): boolean {
  switch (body.local_kind(local)) {
    case "Arg":
    case "ReturnPointer":
      return true;
    case "Temp":
      return false;
  }
}

/////////////////////////////////////////////////////////
// MIR Dump

// rustc: compiler/rustc_mir_transform/src/dest_prop.rs:438 dest_prop_mir_dump
function dest_prop_mir_dump(
  tcx: TyCtxt,
  body: Body,
  points: DenseLocationMap,
  live: SparseIntervalMatrix<RelevantLocal, TwoStepIndex>,
  relevant: RelevantLocals,
): void {
  const locals_live_at = (location: TwoStepIndex): Local[] => {
    return [...live.rows()].filter((r) => live.contains(r, location)).map((rl) => relevant.original[rl]!);
  };

  const dumper = MirDumper.new(tcx, "DestinationPropagation-dataflow", body);
  if (dumper !== undefined) {
    const extra_data = (pass_where: PassWhere, w: Write): IoResult<void> => {
      let r: IoResult<void>;
      if (pass_where.$ === "BeforeLocation") {
        const loc = pass_where._0;
        const location = TwoStepIndex.new(points, loc, "Before");
        const live = locals_live_at(location);
        if ((r = w.write_fmt([`        // before: ${TwoStepIndex_debug(location)} => ${debug_vec(live, PLAIN, debug_Local)}\n`])).$ === "Err") return r;
      }
      if (pass_where.$ === "AfterLocation") {
        const loc = pass_where._0;
        const location = TwoStepIndex.new(points, loc, "After");
        const live = locals_live_at(location);
        if ((r = w.write_fmt([`        // after: ${TwoStepIndex_debug(location)} => ${debug_vec(live, PLAIN, debug_Local)}\n`])).$ === "Err") return r;
      }
      return Ok(undefined);
    };

    dumper.set_extra_data(extra_data).dump_mir(body);
  }
}

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:472 Effect
type Effect = "Before" | "After";

// rustc_index::newtype_index! {
//     /// A reversed `PointIndex` but with the lower bit encoding early/late inside the statement.
//     /// The reversed order allows to use the more efficient `IntervalSet::append` method while we
//     /// iterate on the statements in reverse order.
//     #[orderable]
//     #[debug_format = "TwoStepIndex({})"]
//     struct TwoStepIndex {}
// }
/// A reversed `PointIndex` but with the lower bit encoding early/late inside the statement.
/// The reversed order allows to use the more efficient `IntervalSet::append` method while we
/// iterate on the statements in reverse order.
// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:483 TwoStepIndex
type TwoStepIndex = number & { readonly __brand: "TwoStepIndex" };
const TwoStepIndex_newtype = newtype_index<TwoStepIndex>((n) => `TwoStepIndex(${n})`);
/** `#[debug_format = "TwoStepIndex({})"]`. */
function TwoStepIndex_debug(v: TwoStepIndex): string {
  return `TwoStepIndex(${v})`;
}
const TwoStepIndex = {
  ...TwoStepIndex_newtype,

  /** The inherent `TwoStepIndex::new(..)` (shadows `Idx::new`, which stays `TwoStepIndex.new_`). */
  new_: TwoStepIndex_newtype.new,

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:487 new
  new(elements: DenseLocationMap, location: Location, effect: Effect): TwoStepIndex {
    const point = elements.point_from_location(location);
    let effect_: number;
    switch (effect) {
      case "Before":
        effect_ = 0;
        break;
      case "After":
        effect_ = 1;
        break;
    }
    const max_index = 2 * elements.num_points() - 1;
    const index = 2 * PointIndex.as_u32(point) + effect_;
    // Reverse the indexing to use more efficient `IntervalSet::append`.
    return TwoStepIndex_newtype.from_u32(max_index - index);
  },

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:499 effect
  effect(self: TwoStepIndex): Effect {
    return (TwoStepIndex_newtype.as_u32(self) & 1) === 0 ? "After" : "Before";
  },
};

/// Add points depending on the result of the given dataflow analysis.
// #[tracing::instrument(level = "trace", skip(elements, body))]
// rustc: compiler/rustc_mir_transform/src/dest_prop.rs:506 save_as_intervals
function save_as_intervals(
  elements: DenseLocationMap,
  body: Body,
  relevant: RelevantLocals,
  entry_states: EntryStates<DenseBitSet<Local>>,
): SparseIntervalMatrix<RelevantLocal, TwoStepIndex> {
  const reachable_blocks = traversal.reachable_as_bitset(body);
  const two_step_loc = (location: Location, effect: Effect): TwoStepIndex => TwoStepIndex.new(elements, location, effect);

  const state = new GenKillIntervalMatrix(
    SparseIntervalMatrix.new<RelevantLocal, TwoStepIndex>(2 * elements.num_points()),
    relevant,
    new Array<TwoStepIndex | undefined>(relevant.original.length).fill(undefined),
    // Dummy value.
    TwoStepIndex.from_u32(0),
  );

  // Iterate blocks in decreasing order, to visit locations in decreasing order. This
  // allows to use the more efficient `append` method to interval sets.
  const blocks = body.basic_blocks.deref();
  for (let block = blocks.length - 1; block >= 0; block--) {
    if (!reachable_blocks.contains(block as BasicBlock)) {
      continue;
    }

    const block_data = blocks[block]!;
    const loc = { block, statement_index: block_data.statements.length } as Location;
    state.current = two_step_loc(loc, "After");

    // Setup the new block.
    state.start_block(entry_states[block]!);

    const term = block_data.terminator_();

    // Ensure we have a non-zero live range even for dead stores. This is done by marking all
    // the written-to locals as live in the second half of the statement.
    // We also ensure that operands read by terminators conflict with writes by that terminator.
    // For instance a function call may read args after having written to the destination.
    new VisitPlacesWith((place: Place, ctxt: PlaceContext) => {
      const relevant_ = relevant.shrink[place.local];
      if (relevant_ !== undefined) {
        switch (DefUse.for_place(place, ctxt)) {
          case "Def":
          case "Use":
          case "PartialWrite":
            state.insert_single(relevant_);
            break;
          case "NonUse":
            break;
        }
      }
    }).visit_terminator(term, loc);

    state.current = TwoStepIndex.from_u32(state.current + 1);
    // debug_assert_eq!(state.current, two_step_loc(loc, Effect::Before));
    new LivenessTransferFunction(state, GenKill_GenKillIntervalMatrix).visit_terminator(term, loc);

    for (let statement_index = block_data.statements.length - 1; statement_index >= 0; statement_index--) {
      const stmt = block_data.statements[statement_index]!;
      const loc = { block, statement_index } as Location;
      state.current = TwoStepIndex.from_u32(state.current + 1);
      // debug_assert_eq!(state.current, two_step_loc(loc, Effect::After));

      // Like terminators, ensure we have a non-zero live range even for dead stores.
      // Some rvalues interleave reads and writes, for instance `Rvalue::Aggregate`, see
      // https://github.com/rust-lang/rust/issues/146383. By precaution, treat statements
      // as behaving so by default.
      // We make an exception for simple assignments `_a.stuff = {copy|move} _b.stuff`,
      // as marking `_b` live here would prevent unification.
      let is_simple_assignment = false;
      if (stmt.kind.$ === "Assign") {
        const [lhs, rv] = stmt.kind._0;
        if (rv.$ === "CopyForDeref") {
          is_simple_assignment = lhs.projection === rv._0.projection;
        } else if (rv.$ === "Use" && (rv._0.$ === "Copy" || rv._0.$ === "Move")) {
          is_simple_assignment = lhs.projection === rv._0._0.projection;
        }
      }
      new VisitPlacesWith((place: Place, ctxt: PlaceContext) => {
        const relevant_ = relevant.shrink[place.local];
        if (relevant_ !== undefined) {
          const du = DefUse.for_place(place, ctxt);
          if (du === "Def" || du === "PartialWrite") {
            state.insert_single(relevant_);
          } else if (du === "Use" && !is_simple_assignment) {
            state.insert_single(relevant_);
          } else if (du === "Use" || du === "NonUse") {
            // nothing
          } else {
            unreachable();
          }
        }
      }).visit_statement(stmt, loc);

      // ... but reads from operands are marked as live here so they do not conflict with
      // the all the writes we manually marked as live in the second half of the statement.
      state.current = TwoStepIndex.from_u32(TwoStepIndex.as_u32(state.current) + 1);
      // debug_assert_eq!(state.current, two_step_loc(loc, Effect::Before));
      new LivenessTransferFunction(state, GenKill_GenKillIntervalMatrix).visit_statement(stmt, loc);
    }

    // Cleanup the current block for the next one.
    state.end_block();
  }

  return state.values;
}

// PORT: the items below are declared inside `save_as_intervals` upstream.
/// Generalized dataflow state for use inside a given block.
// rustc-type: compiler/rustc_mir_transform/src/dest_prop.rs:513 GenKillIntervalMatrix
class GenKillIntervalMatrix {
  constructor(
    public values: SparseIntervalMatrix<RelevantLocal, TwoStepIndex>,
    public relevant: RelevantLocals,
    /// If a local is live, this stores the start of the live range.
    /// If a local is dead, this stores `None`.
    public pending: (TwoStepIndex | undefined)[],
    /// The current position of the cursor inside the MIR body.
    public current: TwoStepIndex,
  ) {}

  /// Insert a singleton range. This can be used for dead locals to mark conflicts, for
  /// instance `move` operands in function calls or partial writes.
  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:546 insert_single
  insert_single(elem: RelevantLocal): void {
    // If we have a set pending, we will insert it when killing it, so nothing more to do.
    // Kills only happen for `Effect::Before`, so we don't risk `kill` to insert
    // a range excluding `self.current`.
    // debug_assert_eq!(self.current.effect(), Effect::After);
    if (this.pending[elem] === undefined) {
      this.values.append(elem, this.current);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:556 start_block
  start_block(entry_state: DenseBitSet<Local>): void {
    // debug_assert!(self.pending.iter().all(Option::is_none));
    for (const local of entry_state.iter()) {
      const elem = this.relevant.shrink[local];
      if (elem !== undefined) {
        this.pending[elem] = this.current;
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:565 end_block
  end_block(): void {
    for (let elem = 0 as RelevantLocal; elem < this.pending.length; elem = (elem + 1) as RelevantLocal) {
      const start = this.pending[elem];
      this.pending[elem] = undefined;
      if (start !== undefined) {
        // debug_assert!(start <= self.current);
        // We are ending a block, mark all live locals as live up to `current`,
        // including that position (which is still inside the block).
        this.values.append_range(elem, range_inclusive(start, this.current));
      }
    }
  }
}

/** `impl GenKill<Local> for GenKillIntervalMatrix<'_>` (PORTING §5 trait tables). */
const GenKill_GenKillIntervalMatrix: GenKill<GenKillIntervalMatrix, Local> = {
  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:524 gen_
  gen_(self: GenKillIntervalMatrix, elem_: Local): void {
    const elem = self.relevant.shrink[elem_];
    if (elem === undefined) return;
    // If the local was already live, do not overwrite the start position.
    self.pending[elem] ??= self.current;
  },

  // rustc: compiler/rustc_mir_transform/src/dest_prop.rs:530 kill
  kill(self: GenKillIntervalMatrix, elem_: Local): void {
    // Ensure we only kill for `Effect::Before`, so `insert_single` is well-behaved.
    // debug_assert_eq!(self.current.effect(), Effect::Before);
    const elem = self.relevant.shrink[elem_];
    if (elem === undefined) return;
    const start = self.pending[elem];
    self.pending[elem] = undefined;
    if (start !== undefined) {
      // debug_assert!(start <= self.current);
      // The local is live since `start`.
      // We are killing it, so it won't be after `current`, hence an exclusive range.
      self.values.append_range(elem, range(start, self.current));
    }
  },

  gen_all(self: GenKillIntervalMatrix, elems: Iterable<Local>): void {
    GenKill_provided.gen_all(GenKill_GenKillIntervalMatrix, self, elems);
  },

  kill_all(self: GenKillIntervalMatrix, elems: Iterable<Local>): void {
    GenKill_provided.kill_all(GenKill_GenKillIntervalMatrix, self, elems);
  },
};
