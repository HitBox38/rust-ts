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
import type { DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { LocalizedNode } from "./constraints.gen.ts";
import { type LocalizedConstraintGraphVisitor, LocalizedConstraintGraphVisitor_provided } from "./constraints.ts";
import type { RegionLiveness } from "./liveness.gen.ts";
import type { LivenessSource } from "./liveness.ts";
import { type DeferredLivenessSource, LiveLoans, type LoanLivenessVisitor, PoloniusContext } from "./mod.gen.ts";
export * from "./mod.gen.ts";
export { dump_polonius_mir } from "./dump.ts";
export { record_live_region_variance } from "./liveness_constraints.ts";
export type { DeferredRegionLiveness } from "./liveness.gen.ts";

declare module "./mod.gen.ts" {
  interface LiveLoans {
    // mod.rs:77 (lane bck-polonius)
    insert(row: PointIndex, col: BorrowIndex): void;
    // mod.rs:81 (lane bck-polonius)
    contains(row: PointIndex, col: BorrowIndex): boolean;
  }
  namespace LiveLoans {
    // mod.rs:74 (lane bck-polonius)
    function new_(num_points: number, num_borrows: number): LiveLoans;
    export { new_ as new };
  }
  interface PoloniusContext {
    // mod.rs:136 (lane bck-polonius)
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

// stub: compiler/rustc_borrowck/src/polonius/mod.rs:74 new (lane bck-polonius)
(LiveLoans as unknown as { new: typeof LiveLoans.new }).new = function (num_points: number, num_borrows: number): LiveLoans {
  return unported("rustc_borrowck::polonius::LiveLoans::new");
};

// stub: compiler/rustc_borrowck/src/polonius/mod.rs:77 insert (lane bck-polonius)
LiveLoans.prototype.insert = function (this: LiveLoans, row: PointIndex, col: BorrowIndex): void {
  return unported("rustc_borrowck::polonius::LiveLoans::insert");
};

// stub: compiler/rustc_borrowck/src/polonius/mod.rs:81 contains (lane bck-polonius)
LiveLoans.prototype.contains = function (this: LiveLoans, row: PointIndex, col: BorrowIndex): boolean {
  return unported("rustc_borrowck::polonius::LiveLoans::contains");
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
// stub: compiler/rustc_borrowck/src/polonius/mod.rs:136 compute_loan_liveness (lane bck-polonius)
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
  return unported("rustc_borrowck::polonius::PoloniusContext::compute_loan_liveness");
};

// impl<'a> LivenessSource for DeferredLivenessSource<'a, '_>
export const LivenessSource_DeferredLivenessSource: LivenessSource<DeferredLivenessSource> = {
  // stub: compiler/rustc_borrowck/src/polonius/mod.rs:193 liveness_for_region (lane bck-polonius)
  liveness_for_region(self: DeferredLivenessSource, region: RegionVid): RegionLiveness {
    return unported("rustc_borrowck::polonius::DeferredLivenessSource::liveness_for_region");
  },
};

// impl LocalizedConstraintGraphVisitor for LoanLivenessVisitor<'_>
export const LocalizedConstraintGraphVisitor_LoanLivenessVisitor: LocalizedConstraintGraphVisitor<LoanLivenessVisitor> = {
  ...LocalizedConstraintGraphVisitor_provided,
  // stub: compiler/rustc_borrowck/src/polonius/mod.rs:217 on_node_traversed (lane bck-polonius)
  on_node_traversed(self: LoanLivenessVisitor, loan: BorrowIndex, node: LocalizedNode, is_live: boolean): void {
    return unported("rustc_borrowck::polonius::LoanLivenessVisitor::on_node_traversed");
  },
};
