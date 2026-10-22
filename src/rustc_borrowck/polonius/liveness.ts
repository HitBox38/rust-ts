// Port of compiler/rustc_borrowck/src/polonius/liveness.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the crate trait `LivenessSource` is implemented by data-only structs (`DeferredLivenessSource` in mod.rs,
// `CachedLivenessSource` in dump.rs; generated interfaces), so it is an impl-table interface whose methods take the
// implementing value as `self` (`LivenessSource_DeferredLivenessSource`, `LivenessSource_CachedLivenessSource`); a
// `&mut impl LivenessSource` parameter is the value plus its table, last (`S_`).
// PORT: `RegionLiveness.live_points: Option<&'a IntervalSet<PointIndex>>` is generated as `Set<PointIndex> | undefined`
// (global type-map entry of `IntervalSet`, typemap.parse.json); upstream's type is rustc_index's `IntervalSet` (root:
// borrowck.typemap.json entry pending, see the handoff).
import type { SparseIntervalMatrix } from "../../rustc_index/interval.ts";
import type { Local } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { LivenessComputation } from "../type_check/liveness/trace.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import type { LiveRegionVariances } from "./mod.gen.ts";
import { DeferredRegionLiveness, RegionLiveness } from "./liveness.gen.ts";
export * from "./liveness.gen.ts";

declare module "./liveness.gen.ts" {
  interface RegionLiveness {
    // liveness.rs:54 (lane bck-polonius)
    is_live_at(point: PointIndex): boolean;
  }
  namespace RegionLiveness {
    // liveness.rs:25 (lane bck-polonius)
    function new_(
      region: RegionVid,
      live_region_variances: LiveRegionVariances,
      universal_regions: UniversalRegions,
      live_points: SparseIntervalMatrix<RegionVid, PointIndex>,
    ): RegionLiveness;
    export { new_ as new };
  }
  interface DeferredRegionLiveness {
    // liveness.rs:77 (lane bck-polonius)
    defer_local(tcx: TyCtxt, universal_regions: UniversalRegions, local: Local, local_ty: Ty, dropck_kinds: readonly GenericArg[]): void;
    // liveness.rs:112 (lane bck-polonius)
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

// stub: compiler/rustc_borrowck/src/polonius/liveness.rs:25 new (lane bck-polonius)
(RegionLiveness as unknown as { new: typeof RegionLiveness.new }).new = function (
  region: RegionVid,
  live_region_variances: LiveRegionVariances,
  universal_regions: UniversalRegions,
  live_points: SparseIntervalMatrix<RegionVid, PointIndex>,
): RegionLiveness {
  return unported("rustc_borrowck::polonius::liveness::RegionLiveness::new");
};

// stub: compiler/rustc_borrowck/src/polonius/liveness.rs:54 is_live_at (lane bck-polonius)
RegionLiveness.prototype.is_live_at = function (this: RegionLiveness, point: PointIndex): boolean {
  return unported("rustc_borrowck::polonius::liveness::RegionLiveness::is_live_at");
};

/// We want to defer computing the liveness of the region in the local's type, so we store the
/// necessary inputs to do that later.
// stub: compiler/rustc_borrowck/src/polonius/liveness.rs:77 defer_local (lane bck-polonius)
DeferredRegionLiveness.prototype.defer_local = function (
  this: DeferredRegionLiveness,
  tcx: TyCtxt,
  universal_regions: UniversalRegions,
  local: Local,
  local_ty: Ty,
  dropck_kinds: readonly GenericArg[],
): void {
  return unported("rustc_borrowck::polonius::liveness::DeferredRegionLiveness::defer_local");
};

/// For a given region, compute the liveness for the local containing it, if it is deferred.
// stub: compiler/rustc_borrowck/src/polonius/liveness.rs:112 ensure_deferred_liveness (lane bck-polonius)
DeferredRegionLiveness.prototype.ensure_deferred_liveness = function (
  this: DeferredRegionLiveness,
  region: RegionVid,
  universal_regions: UniversalRegions,
  liveness: LivenessValues,
  live_region_variances: LiveRegionVariances,
  comp: LivenessComputation,
): void {
  return unported("rustc_borrowck::polonius::liveness::DeferredRegionLiveness::ensure_deferred_liveness");
};
