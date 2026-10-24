// Port of compiler/rustc_borrowck/src/polonius/liveness.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the crate trait `LivenessSource` is implemented by data-only structs (`DeferredLivenessSource` in mod.rs,
// `CachedLivenessSource` in dump.rs; generated interfaces), so it is an impl-table interface whose methods take the
// implementing value as `self` (`LivenessSource_DeferredLivenessSource`, `LivenessSource_CachedLivenessSource`); a
// `&mut impl LivenessSource` parameter is the value plus its table, last (`S_`).
// PORT: `RegionLiveness.live_points: Option<&'a IntervalSet<PointIndex>>` is the row of the liveness matrix itself
// (`SparseIntervalMatrix::row`, shared, not a copy).
import type { SparseIntervalMatrix } from "../../rustc_index/interval.ts";
import type { Local } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { IndexVec } from "../../rustc_index/vec.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { LivenessComputation } from "../type_check/liveness/trace.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { ConstraintDirection, LiveRegionVariances } from "./mod.gen.ts";
import { DeferredRegionLiveness, RegionLiveness } from "./liveness.gen.ts";
export * from "./liveness.gen.ts";

declare module "./liveness.gen.ts" {
  interface RegionLiveness {
    // liveness.rs:54
    is_live_at(point: PointIndex): boolean;
  }
  namespace RegionLiveness {
    // liveness.rs:25
    function new_(
      region: RegionVid,
      live_region_variances: LiveRegionVariances,
      universal_regions: UniversalRegions,
      live_points: SparseIntervalMatrix<RegionVid, PointIndex>,
    ): RegionLiveness;
    export { new_ as new };
  }
  interface DeferredRegionLiveness {
    // liveness.rs:77
    defer_local(tcx: TyCtxt, universal_regions: UniversalRegions, local: Local, local_ty: Ty, dropck_kinds: readonly GenericArg[]): void;
    // liveness.rs:112
    ensure_deferred_liveness(
      region: RegionVid,
      universal_regions: UniversalRegions,
      liveness: LivenessValues,
      live_region_variances: LiveRegionVariances,
      comp: LivenessComputation,
    ): void;
  }
}

/// The source of liveness information for a given region.
// rustc-trait: compiler/rustc_borrowck/src/polonius/liveness.rs:13 LivenessSource
export interface LivenessSource<S> {
  // rustc: compiler/rustc_borrowck/src/polonius/liveness.rs:14 liveness_for_region
  liveness_for_region(self: S, region: RegionVid): RegionLiveness;
}

// #[inline]
// rustc: compiler/rustc_borrowck/src/polonius/liveness.rs:25 new
(RegionLiveness as unknown as { new: typeof RegionLiveness.new }).new = function (
  region: RegionVid,
  live_region_variances: LiveRegionVariances,
  universal_regions: UniversalRegions,
  live_points: SparseIntervalMatrix<RegionVid, PointIndex>,
): RegionLiveness {
  // Universal regions propagate loans along the CFG, i.e. forwards only.
  const is_universal_region = universal_regions.is_universal_region(region);

  // Note: there currently are cases related to promoted and const generics, where we don't yet
  // have variance information (possibly about temporary regions created when typeck sanitizes the
  // promoteds). Until that is done, we conservatively fallback to maximizing reachability by
  // adding a bidirectional edge here. This will not limit traversal whatsoever, and thus
  // propagate liveness when needed.
  //
  // FIXME: add the missing variance information and remove this fallback bidirectional edge.
  const direction: ConstraintDirection = is_universal_region ? "Forward" : (live_region_variances[region] ?? "Bidirectional");
  const live_points_ = live_points.row(region);
  return new RegionLiveness(direction, live_points_);
};

// rustc: compiler/rustc_borrowck/src/polonius/liveness.rs:54 is_live_at
RegionLiveness.prototype.is_live_at = function (this: RegionLiveness, point: PointIndex): boolean {
  return this.live_points !== undefined && this.live_points.contains(point);
};

/// We want to defer computing the liveness of the region in the local's type, so we store the
/// necessary inputs to do that later.
// rustc: compiler/rustc_borrowck/src/polonius/liveness.rs:77 defer_local
DeferredRegionLiveness.prototype.defer_local = function (
  this: DeferredRegionLiveness,
  tcx: TyCtxt,
  universal_regions: UniversalRegions,
  local: Local,
  local_ty: Ty,
  dropck_kinds: readonly GenericArg[],
): void {
  // We already have drop data for this local, because we need to register
  // region constraints eagerly. So, we'll store this so we don't need to
  // recompute.
  IndexVec.insert(this.drop_args_by_local, local, [...dropck_kinds]);

  // Then, we want to map all the regions contained within this local to
  // the local itself. Later, when asked for liveness of a given region,
  // we can trace liveness for the local containing it.
  tcx.for_each_free_region(
    local_ty,
    (region) => {
      // See note in `VarianceExtractor::record_variance`.
      if (region.is_bound() || region.is_erased()) {
        return;
      }
      const vid = universal_regions.to_region_vid(region);
      // Because of MIR renumbering, we should always have a 1:1 mapping
      // between a region and a local.
      const _previous = IndexVec.insert(this.by_region, vid, local);
      // debug_assert!(
      //     previous.is_none(),
      //     "{vid:?} is in the type of both {previous:?} and {local:?}, but \
      //     MIR renumbering should ensure that this is impossible.",
      // );
    },
    fold_Ty,
  );
};

/// For a given region, compute the liveness for the local containing it, if it is deferred.
// #[inline]
// rustc: compiler/rustc_borrowck/src/polonius/liveness.rs:112 ensure_deferred_liveness
DeferredRegionLiveness.prototype.ensure_deferred_liveness = function (
  this: DeferredRegionLiveness,
  region: RegionVid,
  universal_regions: UniversalRegions,
  liveness: LivenessValues,
  live_region_variances: LiveRegionVariances,
  comp: LivenessComputation,
): void {
  const local = IndexVec.remove(this.by_region, region);
  if (local === undefined) {
    return;
  }
  const drop_args = IndexVec.remove(this.drop_args_by_local, local);
  if (drop_args === undefined) {
    return;
  }

  comp.compute(local, universal_regions, live_region_variances, liveness, () => drop_args);
};
