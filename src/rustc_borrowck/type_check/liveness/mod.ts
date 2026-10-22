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
import { BasicBlock, type Body, type Local, type Location } from "../../../rustc_middle/mir/mod.ts";
import { debug_TyContext } from "../../../rustc_middle/mir/visit.gen.ts";
import { type TyContext, Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Region, Ty } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { MoveData } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap, PointIndex } from "../../../rustc_mir_dataflow/points.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { FreeRegionsVisitor } from "../../../rustc_trait_selection/traits/outlives_for_liveness.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { type Relate, relate_GenericArgs, relate_Region, relate_Ty } from "../../../rustc_type_ir/relate.ts";
import type { TypeVisitable } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Iterator_Successors } from "../../constraints/graph.ts";
import type { OutlivesConstraintSet } from "../../constraints/mod.gen.ts";
import type { BorrowckInferCtxt } from "../../lib.gen.ts";
import { record_live_region_variance } from "../../polonius/liveness_constraints.ts";
import type { PoloniusContext } from "../../polonius/mod.gen.ts";
import type { LivenessValues } from "../../region_infer/values.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { TypeChecker } from "../mod.ts";
import * as trace from "./trace.ts";
export * from "./mod.gen.ts";

/// Combines liveness analysis with initialization analysis to
/// determine which variables are live at which points, both due to
/// ordinary uses and drops. Returns a set of (ty, location) pairs
/// that indicate which types must be live at which point in the CFG.
/// This vector is consumed by `constraint_generation`.
///
/// N.B., this computation requires normalization; therefore, it must be
/// performed before
// rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:35 generate
export function generate(typeck: TypeChecker, location_map: DenseLocationMap, move_data: MoveData): void {
  // debug!("liveness::generate");
  // PORT: `tcx.prof.generic_activity("borrowck_liveness")` timer dropped (driver-m2 decision 8).

  // Universal regions are live at every point.
  for (const region of typeck.universal_regions.universal_regions_iter()) {
    typeck.constraints.liveness_constraints.add_all_points(region);
  }

  const free_regions = regions_that_outlive_free_regions(
    typeck.infcx.num_region_vars(),
    typeck.universal_regions,
    typeck.constraints.outlives_constraints,
  );

  const [relevant_live_locals, boring_locals] = compute_relevant_live_locals(typeck.tcx(), free_regions, typeck.body);

  // Under Polonius Alpha, a larger set of locals are considered relevant: specifically,
  // locals containing regions *outliving* universal regions are relevant and only
  // locals containing solely universal regions are considered boring.
  //
  // However, we don't actually need liveness information for *all* these locals,
  // only when actually computing loans. So, we can defer computing the liveness
  // until we try to propagate the loan, which is gated on `LocalizedConstraintGraph`
  // traversal.
  //
  // Potentially in theory, we could defer computing liveness for *all* locals,
  // but that's a much bigger refactor (many things rely on liveness of
  // NLL-relevant locals). So, we only defer NLL-boring/Polonius-relevant locals
  // for now.
  // FIXME: this NLL optimization idea, to reduce work to relevant locals only, still makes sense
  // for polonius, and should be investigated to improve liveness performance.
  let deferred_locals: Set<Local>;
  if (typeck.polonius_context === undefined || typeck.borrow_set.len() === 0) {
    // If we aren't going to be using the additional liveness information,
    // don't even bother computing the larger relevant set.
    // Similarly, since this liveness information is ultimately used for *loan*
    // liveness, we don't need to compute it when there are no loans.
    deferred_locals = new Set();
  } else {
    // As described above, we can defer computing liveness for the regions that are
    // NLL-boring-and-polonius-relevant. Let's find these.
    //
    // Note that this is basically a simplified version of `compute_relevant_live_locals`
    // avoiding the allocations that are unnecessary in our more limited use-case.
    const tcx = typeck.tcx();
    const universal_regions = typeck.universal_regions;
    const boring_nll_locals = new Set<Local>(boring_locals);
    const deferred_polonius_locals = new Set<Local>();
    const local_decls = typeck.body.local_decls;
    for (let i = 0; i < local_decls.length; i++) {
      const local = i as Local;
      const decl = local_decls[i]!;
      // The polonius-relevant locals are the ones whose types do not only contain
      // universal regions.
      if (boring_nll_locals.has(local) && !tcx.all_free_regions_meet(decl.ty, (r) => universal_regions.is_universal_region(r.as_var()), fold_Ty)) {
        deferred_polonius_locals.add(local);
      }
    }

    typeck.polonius_context!.boring_nll_locals = boring_nll_locals;
    deferred_locals = deferred_polonius_locals;
  }

  trace.trace(typeck, location_map, move_data, relevant_live_locals, boring_locals, deferred_locals);

  // Mark regions that should be live where they appear within rvalues or within a call: like
  // args, regions, and types.
  record_regular_live_regions(
    typeck.tcx(),
    typeck.constraints.liveness_constraints,
    typeck.universal_regions,
    typeck.polonius_context,
    typeck.body,
  );
}

// The purpose of `compute_relevant_live_locals` is to define the subset of `Local`
// variables for which we need to do a liveness computation. We only need
// to compute whether a variable `X` is live if that variable contains
// some region `R` in its type where `R` is not known to outlive a free
// region (i.e., where `R` may be valid for just a subset of the fn body).
// rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:135 compute_relevant_live_locals
function compute_relevant_live_locals(tcx: TyCtxt, free_regions: Set<RegionVid>, body: Body): [Local[], Local[]] {
  // PORT: `partition_map` into `Either::Left` (boring) / `Either::Right` (relevant).
  const boring_locals: Local[] = [];
  const relevant_live_locals: Local[] = [];
  const local_decls = body.local_decls;
  for (let i = 0; i < local_decls.length; i++) {
    const local = i as Local;
    const local_decl = local_decls[i]!;
    if (tcx.all_free_regions_meet(local_decl.ty, (r) => free_regions.has(r.as_var()), fold_Ty)) {
      boring_locals.push(local);
    } else {
      relevant_live_locals.push(local);
    }
  }

  // debug!("{} total variables", body.local_decls.len());
  // debug!("{} variables need liveness", relevant_live_locals.len());
  // debug!("{} regions outlive free regions", free_regions.len());

  return [relevant_live_locals, boring_locals];
}

/// Computes all regions that are (currently) known to outlive free
/// regions. For these regions, we do not need to compute
/// liveness, since the outlives constraints will ensure that they
/// are live over the whole fn body anyhow.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:160 regions_that_outlive_free_regions
function regions_that_outlive_free_regions(
  num_region_vars: number,
  universal_regions: UniversalRegions,
  constraint_set: OutlivesConstraintSet,
): Set<RegionVid> {
  // Build a graph of the outlives constraints thus far. This is
  // a reverse graph, so for each constraint `R1: R2` we have an
  // edge `R2 -> R1`. Therefore, if we find all regions
  // reachable from each free region, we will have all the
  // regions that are forced to outlive some free region.
  const rev_constraint_graph = constraint_set.reverse_graph(num_region_vars);
  const fr_static = universal_regions.fr_static;
  const rev_region_graph = rev_constraint_graph.region_graph(constraint_set, fr_static);

  // Stack for the depth-first search. Start out with all the free regions.
  const stack: RegionVid[] = [...universal_regions.universal_regions_iter()];

  // Set of all free regions, plus anything that outlives them. Initially
  // just contains the free regions.
  const outlives_free_region = new Set<RegionVid>(stack);

  // Do the DFS -- for each thing in the stack, find all things
  // that outlive it and add them to the set. If they are not,
  // push them onto the stack for later.
  for (let sub_region = stack.pop(); sub_region !== undefined; sub_region = stack.pop()) {
    const successors = rev_region_graph.outgoing_regions(sub_region);
    for (let r = Iterator_Successors.next(successors); !r.done; r = Iterator_Successors.next(successors)) {
      // `.filter(|&r| outlives_free_region.insert(r))`
      if (!outlives_free_region.has(r.value)) {
        outlives_free_region.add(r.value);
        stack.push(r.value);
      }
    }
  }

  // Return the final set of things we visited.
  return outlives_free_region;
}

/// Some variables are "regular live" at `location` -- i.e., they may be used later. This means that
/// all regions appearing in their type must be live at `location`.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:198 record_regular_live_regions
function record_regular_live_regions(
  tcx: TyCtxt,
  liveness_constraints: LivenessValues,
  universal_regions: UniversalRegions,
  polonius_context: PoloniusContext | undefined,
  body: Body,
): void {
  const visitor = new LiveVariablesVisitor(tcx, liveness_constraints, universal_regions, polonius_context);
  const basic_blocks = body.basic_blocks.deref();
  for (let i = 0; i < basic_blocks.length; i++) {
    visitor.visit_basic_block_data(BasicBlock.new(i), basic_blocks[i]!);
  }
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
  // rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:223 visit_args
  override visit_args(args: GenericArgsRef, location: Location): void {
    this.record_regions_live_at(args, location, relate_GenericArgs);
    this.super_args(args);
  }

  /// We sometimes have `region`s within an rvalue, or within a
  /// call. Make them live at the location where they appear.
  // rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:230 visit_region
  override visit_region(region: Region, location: Location): void {
    this.record_regions_live_at(region, location, relate_Region);
    this.super_region(region);
  }

  /// We sometimes have `ty`s within an rvalue, or within a
  /// call. Make them live at the location where they appear.
  // rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:237 visit_ty
  override visit_ty(ty: Ty, ty_context: TyContext): void {
    switch (ty_context.$) {
      case "ReturnTy":
      case "YieldTy":
      case "ResumeTy":
      case "UserTy":
      case "LocalDecl": {
        const span = ty_context.$ === "UserTy" ? ty_context._0 : ty_context.$ === "LocalDecl" ? ty_context.source_info.span : ty_context._0.span;
        return span_bug(span, `should not be visiting outside of the CFG: ${debug_TyContext(ty_context, PLAIN)}`);
      }
      case "Location": {
        const location = ty_context._0;
        this.record_regions_live_at(ty, location, relate_Ty);
        break;
      }
    }

    this.super_ty(ty);
  }

  // impl<'a, 'tcx> LiveVariablesVisitor<'a, 'tcx>

  /// Some variable is "regular live" at `location` -- i.e., it may be used later. This means that
  /// all regions appearing in the type of `value` must be live at `location`.
  // rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:258 record_regions_live_at
  record_regions_live_at<T>(value: T, location: Location, d_T: Relate<T>): void {
    // debug!("record_regions_live_at(value={:?}, location={:?})", value, location);
    this.tcx.for_each_free_region(
      value,
      (live_region) => {
        const live_region_vid = live_region.as_var();
        this.liveness_constraints.add_location(live_region_vid, location);
      },
      d_T,
    );

    // When using `-Zpolonius=next`, we record the variance of each live region.
    const polonius_context = this.polonius_context;
    if (polonius_context !== undefined) {
      record_live_region_variance(this.tcx, polonius_context.live_region_variances, this.universal_regions, value, d_T);
    }
  }
}

// rustc: compiler/rustc_borrowck/src/type_check/liveness/mod.rs:280 make_all_regions_live
export function make_all_regions_live<T>(
  infcx: BorrowckInferCtxt,
  universal_regions: UniversalRegions,
  liveness: LivenessValues,
  value: T,
  live_at: IntervalSet<PointIndex>,
  d_T: TypeVisitable<T>,
): void {
  // debug!("make_all_regions_live(value={value:?})");
  d_T.visit_with(
    value,
    new FreeRegionsVisitor(infcx.tcx, infcx.param_env, (r: Region) => liveness.add_points(universal_regions.to_region_vid(r), live_at)),
  );
}
