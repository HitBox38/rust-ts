//! Polonius analysis and support code:
//! - dedicated constraints
//! - conversion from NLL constraints
//! - debugging utilities
//! - etc.
//!
//! The current implementation models the flow-sensitive borrow-checking concerns as a graph
//! containing both information about regions and information about the control flow.
//!
//! Loan propagation is seen as a reachability problem (with some subtleties) between where the loan
//! is introduced and a given point.
//!
//! Constraints arising from type-checking allow loans to flow from region to region at the same CFG
//! point. Constraints arising from liveness allow loans to flow within from point to point, between
//! live regions at these points.
//!
//! Edges can be bidirectional to encode invariant relationships, and loans can flow "back in time"
//! to traverse these constraints arising earlier in the CFG.
//!
//! When incorporating kills in the traversal, the loans reaching a given point are considered live.
//!
//! After this, the usual NLL process happens. These live loans are fed into a dataflow analysis
//! combining them with the points where loans go out of NLL scope (the frontier where they stop
//! propagating to a live region), to yield the "loans in scope" or "active loans", at a given
//! point.
//!
//! Illegal accesses are still computed by checking whether one of these resulting loans is
//! invalidated.
//!
//! More information on this simple approach can be found in the following links, and in the future
//! in the rustc dev guide:
//! - <https://smallcultfollowing.com/babysteps/blog/2023/09/22/polonius-part-1/>
//! - <https://smallcultfollowing.com/babysteps/blog/2023/09/29/polonius-part-2/>
// Port of compiler/rustc_borrowck/src/polonius/mod.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `mod constraints; mod dump; pub(crate) mod legacy; mod liveness; mod liveness_constraints;` are not
// re-exported wholesale (init order, lib.ts header; `pub(self) use self::constraints::*` included): import from
// constraints.ts / dump.ts / legacy/mod.ts / liveness.ts / liveness_constraints.ts (or their `.gen.ts`). The named
// `pub(crate) use` items are re-exported (a fn and a type; neither module touches this module's classes at load):
// `dump_polonius_mir`, `record_live_region_variance`, `DeferredRegionLiveness` (type).
// PORT: `DeferredLivenessSource` / `LoanLivenessVisitor` are data-only structs (generated interfaces); their trait impls
// are the impl tables `LivenessSource_DeferredLivenessSource` / `LocalizedConstraintGraphVisitor_LoanLivenessVisitor`.
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { MoveData } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import { type DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { unwrap } from "../../std/panic.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import { BorrowIndex } from "../dataflow.gen.ts";
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { LocalizedConstraintGraph, type LocalizedNode } from "./constraints.gen.ts";
import { type LocalizedConstraintGraphVisitor, LocalizedConstraintGraphVisitor_provided } from "./constraints.ts";
import { DeferredRegionLiveness, RegionLiveness } from "./liveness.gen.ts";
import { LivenessComputation } from "../type_check/liveness/trace.gen.ts";
import type { LivenessSource } from "./liveness.ts";
import { type DeferredLivenessSource, LiveLoans, type LoanLivenessVisitor, PoloniusContext } from "./mod.gen.ts";
export * from "./mod.gen.ts";
export { dump_polonius_mir } from "./dump.ts";
export { record_live_region_variance } from "./liveness_constraints.ts";
export type { DeferredRegionLiveness } from "./liveness.gen.ts";

declare module "./mod.gen.ts" {
  interface LiveLoans {
    // mod.rs:77
    insert(row: PointIndex, col: BorrowIndex): void;
    // mod.rs:81
    contains(row: PointIndex, col: BorrowIndex): boolean;
  }
  namespace LiveLoans {
    // mod.rs:74
    function new_(num_points: number, num_borrows: number): LiveLoans;
    export { new_ as new };
  }
  interface PoloniusContext {
    // mod.rs:136
    compute_loan_liveness(
      infcx: BorrowckInferCtxt,
      liveness: LivenessValues,
      outlives_constraints: Iterable<OutlivesConstraint>,
      universal_regions: UniversalRegions,
      body: Body,
      move_data: MoveData,
      location_map: DenseLocationMap,
      borrow_set: BorrowSet,
    ): void;
  }
}

// rustc: compiler/rustc_borrowck/src/polonius/mod.rs:74 new
(LiveLoans as unknown as { new: typeof LiveLoans.new }).new = function (num_points: number, num_borrows: number): LiveLoans {
  return new LiveLoans(num_points, DenseBitSet.new_empty<number>(num_points * num_borrows));
};

// rustc: compiler/rustc_borrowck/src/polonius/mod.rs:77 insert
LiveLoans.prototype.insert = function (this: LiveLoans, row: PointIndex, col: BorrowIndex): void {
  const bit_index = PointIndex.index(row) + this.num_points * BorrowIndex.index(col);
  this.flat_matrix.insert(bit_index);
};

// rustc: compiler/rustc_borrowck/src/polonius/mod.rs:81 contains
LiveLoans.prototype.contains = function (this: LiveLoans, row: PointIndex, col: BorrowIndex): boolean {
  const bit_index = PointIndex.index(row) + this.num_points * BorrowIndex.index(col);
  return this.flat_matrix.contains(bit_index);
};

/// Computes live loans using the set of loans model for `-Zpolonius=next`.
///
/// First, creates a constraint graph combining regions and CFG points, by:
/// - converting NLL typeck constraints to be localized
/// - encoding liveness constraints
///
/// Then, this graph is traversed, reachability is recorded as loan liveness, to be used by the
/// loan scope and active loans computations.
///
/// The constraint data will be used to compute errors and diagnostics.
// rustc: compiler/rustc_borrowck/src/polonius/mod.rs:136 compute_loan_liveness
PoloniusContext.prototype.compute_loan_liveness = function (
  this: PoloniusContext,
  infcx: BorrowckInferCtxt,
  liveness: LivenessValues,
  outlives_constraints: Iterable<OutlivesConstraint>,
  universal_regions: UniversalRegions,
  body: Body,
  move_data: MoveData,
  location_map: DenseLocationMap,
  borrow_set: BorrowSet,
): void {
  // We don't need to prepare the graph (index NLL constraints, etc.) if we have no loans to
  // trace throughout localized constraints.
  if (borrow_set.len() > 0) {
    // From the outlives constraints, liveness, and variances, we can compute reachability
    // on the lazy localized constraint graph to trace the liveness of loans, for the next
    // step in the chain (the NLL loan scope and active loans computations).
    const graph = LocalizedConstraintGraph.new(location_map, outlives_constraints);

    const local_use_map = unwrap(this.local_use_map, "local use map should be computed before loan liveness");
    // `std::mem::take(&mut self.deferred_liveness)`: `DeferredRegionLiveness::default()` left behind.
    const deferred_liveness = this.deferred_liveness;
    this.deferred_liveness = new DeferredRegionLiveness([], []);
    const live_loans = LiveLoans.new(location_map.num_points(), borrow_set.len());
    const comp = LivenessComputation.new(infcx, body, location_map, move_data, local_use_map);
    const liveness_source: DeferredLivenessSource = {
      liveness,
      live_region_variances: this.live_region_variances,
      universal_regions,
      deferred_liveness,
      comp,
    };
    const visitor: LoanLivenessVisitor = { live_loans: live_loans };
    graph.traverse(
      body,
      borrow_set,
      location_map,
      liveness_source,
      visitor,
      LivenessSource_DeferredLivenessSource,
      LocalizedConstraintGraphVisitor_LoanLivenessVisitor,
    );
    liveness.record_live_loans(live_loans);

    // The graph can be traversed again during MIR dumping, so we store it here.
    this.graph = graph;
  }
};

// impl<'a> LivenessSource for DeferredLivenessSource<'a, '_>
export const LivenessSource_DeferredLivenessSource: LivenessSource<DeferredLivenessSource> = {
  // #[inline]
  // rustc: compiler/rustc_borrowck/src/polonius/mod.rs:193 liveness_for_region
  liveness_for_region(self: DeferredLivenessSource, region: RegionVid): RegionLiveness {
    self.deferred_liveness.ensure_deferred_liveness(region, self.universal_regions, self.liveness, self.live_region_variances, self.comp);

    return RegionLiveness.new(region, self.live_region_variances, self.universal_regions, self.liveness.points());
  },
};

// impl LocalizedConstraintGraphVisitor for LoanLivenessVisitor<'_>
export const LocalizedConstraintGraphVisitor_LoanLivenessVisitor: LocalizedConstraintGraphVisitor<LoanLivenessVisitor> = {
  ...LocalizedConstraintGraphVisitor_provided,
  // rustc: compiler/rustc_borrowck/src/polonius/mod.rs:217 on_node_traversed
  on_node_traversed(self: LoanLivenessVisitor, loan: BorrowIndex, node: LocalizedNode, is_live: boolean): void {
    // Record the loan as being live on entry to this point if it reaches a live region
    // there.
    //
    // This is an approximation of liveness (which is the thing we want), in that we're
    // using a single notion of reachability to represent what used to be _two_ different
    // transitive closures. It didn't seem impactful when coming up with the single-graph
    // and reachability through space (regions) + time (CFG) concepts, but in practice the
    // combination of time-traveling with kills is more impactful than initially
    // anticipated.
    //
    // Kills should prevent a loan from reaching its successor points in the CFG, but not
    // while time-traveling: we're not actually at that CFG point, but looking for
    // predecessor regions that contain the loan. One of the two TCs we had pushed the
    // transitive subset edges to each point instead of having backward edges, and the
    // problem didn't exist before. In the abstract, naive reachability is not enough to
    // model this, we'd need a slightly different solution. For example, maybe with a
    // two-step traversal:
    // - at each point we first traverse the subgraph (and possibly time-travel) looking for
    //   exit nodes while ignoring kills,
    // - and then when we're back at the current point, we continue normally.
    //
    // Another (less annoying) subtlety is that kills and the loan use-map are
    // flow-insensitive. Kills can actually appear in places before a loan is introduced, or
    // at a location that is actually unreachable in the CFG from the introduction point,
    // and these can also be encountered during time-traveling.
    //
    // The simplest change that made sense to "fix" the issues above is taking into account
    // kills that are:
    // - reachable from the introduction point
    // - encountered during forward traversal. Note that this is not transitive like the
    //   two-step traversal described above: only kills encountered on exit via a backward
    //   edge are ignored.
    //
    // This version of the analysis, however, is enough in practice to pass the tests that
    // we care about and NLLs reject, without regressions on crater, and is an actionable
    // subset of the full analysis. It also naturally points to areas of improvement that we
    // wish to explore later, namely handling kills appropriately during traversal, instead
    // of continuing traversal to all the reachable nodes.
    //
    // FIXME: analyze potential unsoundness, possibly in concert with a borrowck
    // implementation in a-mir-formality, fuzzing, or manually crafting counter-examples.
    if (is_live) {
      self.live_loans.insert(node.point, loan);
    }
  },
};
