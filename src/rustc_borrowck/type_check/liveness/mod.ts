// Port of compiler/rustc_borrowck/src/type_check/liveness/mod.rs (lane borrowck-contract: declarations; fill lane bck-tc-live, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `mod local_use_map; mod trace;` and `pub(crate) use local_use_map::LocalUseMap; pub(crate) use
// trace::LivenessComputation;` are not re-exported (init order, lib.ts header): import from local_use_map.ts /
// trace.ts (or their `.gen.ts`).
// PORT: `LiveVariablesVisitor` (impl mir `Visitor`) is a hand class extending rustc_middle mir/visit.ts's `Visitor`.
// PORT: `&'a mut Option<PoloniusContext>` (only read through `if let Some(..)`, the context mutated in place) is
// `PoloniusContext | undefined`.
// PORT: `T: TypeVisitable<TyCtxt> (+ Relate<TyCtxt>)` parameters take their descriptor last (`d_T`, errctxt-contract
// decision 5); `Relate<T>` extends `TypeFoldable<T>`, which extends `TypeVisitable<T>`.
import type { IntervalSet } from "../../../rustc_index/interval.ts";
import type { Body, Local, Location } from "../../../rustc_middle/mir/mod.ts";
import { type TyContext, Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Region, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import type { MoveData } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap, PointIndex } from "../../../rustc_mir_dataflow/points.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { Relate } from "../../../rustc_type_ir/relate.ts";
import type { TypeVisitable } from "../../../rustc_type_ir/visit.ts";
import { unported } from "../../../std/panic.ts";
import type { OutlivesConstraintSet } from "../../constraints/mod.gen.ts";
import type { BorrowckInferCtxt } from "../../lib.gen.ts";
import type { PoloniusContext } from "../../polonius/mod.gen.ts";
import type { LivenessValues } from "../../region_infer/values.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { TypeChecker } from "../mod.ts";
export * from "./mod.gen.ts";

/// Combines liveness analysis with initialization analysis to
/// determine which variables are live at which points, both due to
/// ordinary uses and drops. Returns a set of (ty, location) pairs
/// that indicate which types must be live at which point in the CFG.
/// This vector is consumed by `constraint_generation`.
///
/// N.B., this computation requires normalization; therefore, it must be
/// performed before
// stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:35 generate (lane bck-tc-live)
export function generate(typeck: TypeChecker, location_map: DenseLocationMap, move_data: MoveData): void {
  return unported("rustc_borrowck::type_check::liveness::generate");
}

// The purpose of `compute_relevant_live_locals` is to define the subset of `Local`
// variables for which we need to do a liveness computation. We only need
// to compute whether a variable `X` is live if that variable contains
// some region `R` in its type where `R` is not known to outlive a free
// region (i.e., where `R` may be valid for just a subset of the fn body).
// stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:135 compute_relevant_live_locals (lane bck-tc-live)
function compute_relevant_live_locals(tcx: TyCtxt, free_regions: Set<RegionVid>, body: Body): [Local[], Local[]] {
  return unported("rustc_borrowck::type_check::liveness::compute_relevant_live_locals");
}

/// Computes all regions that are (currently) known to outlive free
/// regions. For these regions, we do not need to compute
/// liveness, since the outlives constraints will ensure that they
/// are live over the whole fn body anyhow.
// stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:160 regions_that_outlive_free_regions (lane bck-tc-live)
function regions_that_outlive_free_regions(
  num_region_vars: number,
  universal_regions: UniversalRegions,
  constraint_set: OutlivesConstraintSet,
): Set<RegionVid> {
  return unported("rustc_borrowck::type_check::liveness::regions_that_outlive_free_regions");
}

/// Some variables are "regular live" at `location` -- i.e., they may be used later. This means that
/// all regions appearing in their type must be live at `location`.
// stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:198 record_regular_live_regions (lane bck-tc-live)
function record_regular_live_regions(
  tcx: TyCtxt,
  liveness_constraints: LivenessValues,
  universal_regions: UniversalRegions,
  polonius_context: PoloniusContext | undefined,
  body: Body,
): void {
  return unported("rustc_borrowck::type_check::liveness::record_regular_live_regions");
}

/// Visitor looking for regions that should be live within rvalues or calls.
// rustc-type: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:213 LiveVariablesVisitor
export class LiveVariablesVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public liveness_constraints: LivenessValues,
    public universal_regions: UniversalRegions,
    public polonius_context: PoloniusContext | undefined,
  ) {
    super();
  }

  // impl<'a, 'tcx> Visitor<'tcx> for LiveVariablesVisitor<'a, 'tcx>

  /// We sometimes have `args` within an rvalue, or within a
  /// call. Make them live at the location where they appear.
  // stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:223 visit_args (lane bck-tc-live)
  override visit_args(args: GenericArgsRef, location: Location): void {
    return unported("rustc_borrowck::type_check::liveness::LiveVariablesVisitor::visit_args");
  }

  /// We sometimes have `region`s within an rvalue, or within a
  /// call. Make them live at the location where they appear.
  // stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:230 visit_region (lane bck-tc-live)
  override visit_region(region: Region, location: Location): void {
    return unported("rustc_borrowck::type_check::liveness::LiveVariablesVisitor::visit_region");
  }

  /// We sometimes have `ty`s within an rvalue, or within a
  /// call. Make them live at the location where they appear.
  // stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:237 visit_ty (lane bck-tc-live)
  override visit_ty(ty: Ty, ty_context: TyContext): void {
    return unported("rustc_borrowck::type_check::liveness::LiveVariablesVisitor::visit_ty");
  }

  // impl<'a, 'tcx> LiveVariablesVisitor<'a, 'tcx>

  /// Some variable is "regular live" at `location` -- i.e., it may be used later. This means that
  /// all regions appearing in the type of `value` must be live at `location`.
  // stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:258 record_regions_live_at (lane bck-tc-live)
  record_regions_live_at<T>(value: T, location: Location, d_T: Relate<T>): void {
    return unported("rustc_borrowck::type_check::liveness::LiveVariablesVisitor::record_regions_live_at");
  }
}

// stub: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:280 make_all_regions_live (lane bck-tc-live)
export function make_all_regions_live<T>(
  infcx: BorrowckInferCtxt,
  universal_regions: UniversalRegions,
  liveness: LivenessValues,
  value: T,
  live_at: IntervalSet<PointIndex>,
  d_T: TypeVisitable<T>,
): void {
  return unported("rustc_borrowck::type_check::liveness::make_all_regions_live");
}
