// Port of compiler/rustc_borrowck/src/type_check/liveness/trace.rs (lane borrowck-contract: declarations; fill lane bck-tc-live, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `get_drop_args: impl FnOnce() -> &'drop_data [GenericArg]` is `() => readonly GenericArg[]`;
// `live_region_variances: Option<&mut LiveRegionVariances>` is the shared array or `undefined`.
// PORT: `FxIndexSet<Local>` parameters are `Set<Local>` (insertion-ordered JS sets); `FxIndexMap<Ty, DropData>` is a
// `Map<Ty, DropData>` (interned `Ty` keys).
import { DenseBitSet, MixedBitSet } from "../../../rustc_index/bit_set.ts";
import { range_inclusive } from "../../../rustc_index/idx.ts";
import { IntervalSet } from "../../../rustc_index/interval.ts";
import { IndexVec } from "../../../rustc_index/vec.ts";
import type { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import type { BasicBlock, Body, Local, Location } from "../../../rustc_middle/mir/mod.ts";
import { ConstraintCategory } from "../../../rustc_middle/mir/query.gen.ts";
import { DropckOutlivesResult } from "../../../rustc_middle/traits/query.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArg, type GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { ResultsCursor } from "../../../rustc_mir_dataflow/framework/cursor.ts";
import { Clone_MaybeReachable, MaybeReachable } from "../../../rustc_mir_dataflow/framework/lattice.ts";
import { type BitSetExt, BitSetExt_MixedBitSet, type Clone, Clone_MixedBitSet } from "../../../rustc_mir_dataflow/framework/mod.ts";
import { MaybeInitializedPlaces } from "../../../rustc_mir_dataflow/impls/initialized.ts";
import type { MoveData, MovePathIndex } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap, PointIndex } from "../../../rustc_mir_dataflow/points.ts";
import { DUMMY_SP, type Span } from "../../../rustc_span/lib.ts";
import { ObligationCtxt } from "../../../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../../../rustc_trait_selection/traits/mod.gen.ts";
import * as dropck_outlives from "../../../rustc_trait_selection/traits/query/dropck_outlives.ts";
import type { DropckOutlives } from "../../../rustc_trait_selection/traits/query/type_op/mod.ts";
import { QueryTypeOp_DropckOutlives } from "../../../rustc_trait_selection/traits/query/type_op/outlives.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { relate_Ty } from "../../../rustc_type_ir/relate.ts";
import { assert } from "../../../std/panic.ts";
import type { BorrowckInferCtxt } from "../../lib.gen.ts";
import * as polonius_legacy from "../../polonius/legacy/mod.ts";
import { DeferredRegionLiveness } from "../../polonius/liveness.gen.ts";
import { record_live_region_variance } from "../../polonius/liveness_constraints.ts";
import type { LiveRegionVariances } from "../../polonius/mod.gen.ts";
import type { LivenessValues } from "../../region_infer/values.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import { NormalizeLocation_Location, type TypeChecker } from "../mod.ts";
import { LocalUseMap } from "./local_use_map.gen.ts";
import { make_all_regions_live } from "./mod.ts";
import { type DropData, InitAtLocation, LivenessComputation, LivenessResults } from "./trace.gen.ts";
export * from "./trace.gen.ts";

declare module "./trace.gen.ts" {
  interface LivenessResults {
    // trace.rs:140 (lane bck-tc-live)
    compute_for_all_locals(relevant_live_locals: readonly Local[]): void;
    // trace.rs:146 (lane bck-tc-live)
    compute_for_local(local: Local): void;
    // trace.rs:196 (lane bck-tc-live)
    dropck_boring_locals(boring_locals: readonly Local[], deferred_locals: Set<Local>, deferred_liveness: DeferredRegionLiveness): void;
    // trace.rs:208 (lane bck-tc-live)
    dropck_boring_local(local: Local, is_local_deferred: boolean, deferred_liveness: DeferredRegionLiveness): void;
    // trace.rs:280 (lane bck-tc-live)
    record_legacy_polonius_drop_facts(nll_relevant_locals: readonly Local[], deferred_polonius_relevant_locals: Set<Local>): void;
  }
  namespace LivenessResults {
    // trace.rs:133 (lane bck-tc-live)
    function new_(typeck: TypeChecker, comp: LivenessComputation): LivenessResults;
    export { new_ as new };
  }
  interface LivenessComputation {
    // trace.rs:390 (lane bck-tc-live)
    compute(
      local: Local,
      universal_regions: UniversalRegions,
      live_region_variances: LiveRegionVariances | undefined,
      liveness_constraints: LivenessValues,
      get_drop_args: () => readonly GenericArg[],
    ): void;
    // trace.rs:458 (lane bck-tc-live)
    reset_local_state(): void;
    // trace.rs:467 (lane bck-tc-live)
    add_defs_for(local: Local): void;
    // trace.rs:480 (lane bck-tc-live)
    compute_use_live_points_for(local: Local): void;
    // trace.rs:534 (lane bck-tc-live)
    compute_drop_live_points_for(local: Local): void;
    // trace.rs:576 (lane bck-tc-live)
    compute_drop_live_points_for_block(mpi: MovePathIndex, term_point: PointIndex): void;
    // trace.rs:703 (lane bck-tc-live)
    initialized_at(block: BasicBlock, mpi: MovePathIndex, init_at_location: InitAtLocation): boolean;
    // trace.rs:762 (lane bck-tc-live)
    initialized_at_terminator(block: BasicBlock, mpi: MovePathIndex): boolean;
    // trace.rs:771 (lane bck-tc-live)
    initialized_at_exit(block: BasicBlock, mpi: MovePathIndex): boolean;
  }
  namespace LivenessComputation {
    // trace.rs:364 (lane bck-tc-live)
    function new_(
      infcx: BorrowckInferCtxt,
      body: Body,
      location_map: DenseLocationMap,
      move_data: MoveData,
      local_use_map: LocalUseMap,
    ): LivenessComputation;
    export { new_ as new };
  }
}

/// This is the heart of the liveness computation. For each variable X
/// that requires a liveness computation, it walks over all the uses
/// of X and does a reverse depth-first search ("trace") through the
/// MIR. This search stops when we find a definition of that variable.
/// The points visited in this search is the USE-LIVE set for the variable;
/// of those points is added to all the regions that appear in the variable's
/// type.
///
/// We then also walks through each *drop* of those variables and does
/// another search, stopping when we reach a use or definition. This
/// is the DROP-LIVE set of points. Each of the points in the
/// DROP-LIVE set are to the liveness sets for regions found in the
/// `dropck_outlives` result of the variable's type (in particular,
/// this respects `#[may_dangle]` annotations).
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:43 trace
export function trace(
  typeck: TypeChecker,
  location_map: DenseLocationMap,
  move_data: MoveData,
  relevant_live_locals: readonly Local[],
  boring_locals: readonly Local[],
  deferred_locals: Set<Local>,
): void {
  // PORT: `tcx.prof.generic_activity("borrowck_liveness_trace")` timer dropped (driver-m2 decision 8).

  // The use map must also cover the deferred locals: their liveness is computed later, from
  // this same map, when the loan liveness traversal first reaches one of their regions.
  const use_map_locals = [...relevant_live_locals, ...deferred_locals][Symbol.iterator]();
  const local_use_map = LocalUseMap.build(use_map_locals, location_map, typeck.body);
  const comp = LivenessComputation.new(typeck.infcx, typeck.body, location_map, move_data, local_use_map);

  const results = LivenessResults.new(typeck, comp);

  results.record_legacy_polonius_drop_facts(relevant_live_locals, deferred_locals);

  results.compute_for_all_locals(relevant_live_locals);

  // PORT: `DeferredRegionLiveness::default()` (`#[derive(Default)]`: both index vecs empty).
  const deferred_liveness = new DeferredRegionLiveness([], []);
  results.dropck_boring_locals(boring_locals, deferred_locals, deferred_liveness);

  const polonius_context = typeck.polonius_context;
  if (polonius_context !== undefined) {
    polonius_context.deferred_liveness = deferred_liveness;
    polonius_context.local_use_map = local_use_map;
  }
}

// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:133 new
(LivenessResults as unknown as { new: typeof LivenessResults.new }).new = function (
  typeck: TypeChecker,
  comp: LivenessComputation,
): LivenessResults {
  return new LivenessResults(typeck, new Map(), comp);
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:140 compute_for_all_locals
LivenessResults.prototype.compute_for_all_locals = function (this: LivenessResults, relevant_live_locals: readonly Local[]): void {
  for (const local of relevant_live_locals) {
    this.compute_for_local(local);
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:146 compute_for_local
LivenessResults.prototype.compute_for_local = function (this: LivenessResults, local: Local): void {
  // If we end up needing to compute the drop data (because there are
  // drop-live points), then we need to register region constraints and
  // emit drop facts.
  let computed_drop_data: DropData | undefined = undefined;

  this.comp.compute(
    local,
    this.typeck.universal_regions,
    this.typeck.polonius_context?.live_region_variances,
    this.typeck.constraints.liveness_constraints,
    () => {
      const local_ty = this.comp.body.local_decls[local]!.ty;
      const local_span = this.comp.body.local_decls[local]!.source_info.span;
      const drop_data = dropck_local(this.typeck.infcx, this.drop_data, local_ty, local_span);
      computed_drop_data = drop_data;
      return drop_data.dropck_result.kinds;
    },
  );

  const drop_data = computed_drop_data as DropData | undefined;
  if (drop_data !== undefined) {
    const data = drop_data.region_constraint_data;
    if (data !== undefined) {
      for (const drop_location of this.comp.drop_locations) {
        this.typeck.push_region_constraints(NormalizeLocation_Location.to_locations(drop_location), ConstraintCategory.Boring, data);
      }
    }

    for (const kind of drop_data.dropck_result.kinds) {
      polonius_legacy.emit_drop_facts(this.typeck.tcx(), local, kind, this.typeck.universal_regions, this.typeck.polonius_facts.value);
    }
  }
};

/// Runs dropck for locals whose liveness isn't relevant. This is
/// necessary to eagerly detect unbound recursion during drop glue computation.
///
/// These are all the locals which do not potentially reference a region local
/// to this body. Locals which only reference free regions are always drop-live
/// and can therefore safely be dropped.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:196 dropck_boring_locals
LivenessResults.prototype.dropck_boring_locals = function (
  this: LivenessResults,
  boring_locals: readonly Local[],
  deferred_locals: Set<Local>,
  deferred_liveness: DeferredRegionLiveness,
): void {
  for (const local of boring_locals) {
    const is_local_deferred = deferred_locals.has(local);
    this.dropck_boring_local(local, is_local_deferred, deferred_liveness);
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:208 dropck_boring_local
LivenessResults.prototype.dropck_boring_local = function (
  this: LivenessResults,
  local: Local,
  is_local_deferred: boolean,
  deferred_liveness: DeferredRegionLiveness,
): void {
  const typeck = this.typeck;
  const local_ty = this.comp.body.local_decls[local]!.ty;
  const local_span = this.comp.body.local_decls[local]!.source_info.span;

  // If we had treated this as "relevant", we would have run `compute_for_local`. This
  // in turn would have skipped calculating dropck *at all* for locals without drop-liveness.
  // Calculating drop-liveness is expensive, but we can skip it when we know that there
  // are *no* drops (which is relatively cheap).
  if (is_local_deferred && this.comp.local_use_map.drops(local)[Symbol.iterator]().next().done) {
    deferred_liveness.defer_local(typeck.infcx.tcx, typeck.universal_regions, local, local_ty, []);
    return;
  }

  // We need to compute dropck for *all* boring locals because we report overflows.
  //
  // FIXME: there is an argument to be made that we don't need to do this for boring locals
  // without drop-liveness, because we skip it for *relevant* locals without drop-liveness.
  // But, this is preexisting even on NLL, so leaving it for now.
  const drop_data = dropck_local(typeck.infcx, this.drop_data, local_ty, local_span);

  // We are done with *truly* boring locals.
  if (!is_local_deferred) {
    return;
  }

  // If this local is deferred and has drop region constraints, we need to register
  // them, but *only if the local is drop-live*.
  // It doesn't really make sense to only check drop-liveness but defer use-liveness,
  // so we just treat this as eager.
  if (drop_data.region_constraint_data !== undefined) {
    this.compute_for_local(local);
    return;
  }

  // The only other thing we need to do *eagerly* for deferred locals is to register
  // legacy drop facts (because these facts are on `typeck`).
  for (const kind of drop_data.dropck_result.kinds) {
    polonius_legacy.emit_drop_facts(typeck.tcx(), local, kind, typeck.universal_regions, typeck.polonius_facts.value);
  }

  // Finally, we mark that this local is deferred, including the drop kinds.
  deferred_liveness.defer_local(typeck.infcx.tcx, typeck.universal_regions, local, local_ty, drop_data.dropck_result.kinds);
};

/// Add extra drop facts needed for Polonius Legacy.
///
/// Add facts for all locals with free regions, since regions may outlive
/// the function body only at certain nodes in the CFG.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:280 record_legacy_polonius_drop_facts
LivenessResults.prototype.record_legacy_polonius_drop_facts = function (
  this: LivenessResults,
  nll_relevant_locals: readonly Local[],
  deferred_polonius_relevant_locals: Set<Local>,
): void {
  // This is *all wonky* because this used to call a shared
  // `add_drop_live_facts_for` function that was also used for regular
  // relevant locals. Presumably, this can be cleaned up quite a bit.
  // FIXME for future hackers: investigate whether this is
  // actually necessary; these facts come from Polonius
  // and probably maybe plausibly does not need to go back in.
  // It may be necessary to just pick out the parts of
  // `add_drop_live_facts_for()` that make sense.
  const facts = this.typeck.polonius_facts.value;
  if (facts === undefined) return;
  const facts_to_add: [Local, Ty, Location][] = [];
  {
    const nll_relevant_locals_ = new Set<Local>(nll_relevant_locals);

    for (const [local, location_index] of facts.var_dropped_at) {
      const local_ty = this.comp.body.local_decls[local]!.ty;
      if (nll_relevant_locals_.has(local) || deferred_polonius_relevant_locals.has(local) || !TypeVisitableExt.has_free_regions(local_ty, fold_Ty)) {
        continue;
      }

      const location = this.typeck.location_table.to_location(location_index);
      facts_to_add.push([local, local_ty, location]);
    }
  }

  const live_at = IntervalSet.new<PointIndex>(this.comp.location_map.num_points());
  for (const [local, local_ty, location] of facts_to_add) {
    const local_span = this.comp.body.local_decls[local]!.source_info.span;
    const drop_data = dropck_local(this.typeck.infcx, this.drop_data, local_ty, local_span);

    const data = drop_data.region_constraint_data;
    if (data !== undefined) {
      this.typeck.push_region_constraints(NormalizeLocation_Location.to_locations(location), ConstraintCategory.Boring, data);
    }

    for (const kind of drop_data.dropck_result.kinds) {
      make_all_regions_live(this.typeck.infcx, this.typeck.universal_regions, this.typeck.constraints.liveness_constraints, kind, live_at, fold_GenericArg);
      polonius_legacy.emit_drop_facts(this.typeck.tcx(), local, kind, this.typeck.universal_regions, this.typeck.polonius_facts.value);
    }

    const polonius_context = this.typeck.polonius_context;
    if (polonius_context !== undefined) {
      record_live_region_variance(this.typeck.infcx.tcx, polonius_context.live_region_variances, this.typeck.universal_regions, local_ty, relate_Ty);
    }
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:364 new
(LivenessComputation as unknown as { new: typeof LivenessComputation.new }).new = function (
  infcx: BorrowckInferCtxt,
  body: Body,
  location_map: DenseLocationMap,
  move_data: MoveData,
  local_use_map: LocalUseMap,
): LivenessComputation {
  const num_points = location_map.num_points();
  return new LivenessComputation(
    infcx,
    body,
    location_map,
    move_data,
    undefined,
    local_use_map,
    IndexVec.new(),
    IndexVec.new(),
    DenseBitSet.new_empty(num_points),
    IntervalSet.new(num_points),
    DenseBitSet.new_empty(num_points),
    [],
    [],
  );
};

/// Compute for a given local the use- and drop-live points
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:390 compute
LivenessComputation.prototype.compute = function (
  this: LivenessComputation,
  local: Local,
  universal_regions: UniversalRegions,
  live_region_variances: LiveRegionVariances | undefined,
  liveness_constraints: LivenessValues,
  get_drop_args: () => readonly GenericArg[],
): void {
  // PORT: `tcx.prof.generic_activity("borrowck_liveness_compute")` timer dropped (driver-m2 decision 8).

  this.reset_local_state();
  this.add_defs_for(local);
  this.compute_use_live_points_for(local);
  this.compute_drop_live_points_for(local);

  const local_ty = this.body.local_decls[local]!.ty;

  // When using `-Zpolonius=next`, we also record the variance of regions in this live type.
  // For dropck in particular, note that we walk the type and not its live components seen in
  // the dropck results. See issue #160670.
  const is_live_anywhere = !this.use_live_at.is_empty() || !this.drop_live_at.is_empty();
  if (is_live_anywhere && live_region_variances !== undefined) {
    record_live_region_variance(this.infcx.tcx, live_region_variances, universal_regions, local_ty, relate_Ty);
  }
  if (!this.use_live_at.is_empty()) {
    make_all_regions_live(this.infcx, universal_regions, liveness_constraints, local_ty, this.use_live_at, fold_Ty);
  }
  if (!this.drop_live_at.is_empty()) {
    const drop_data = get_drop_args();

    // `compute_drop_live_points_for` computes `drop_live_at` as a `DenseBitSet`, but
    // `make_all_regions_live` expects an `IntervalSet`. We thus convert between those two
    // here. Using a `DenseBitSet` has better performance, but storing liveness as a dense
    // matrix has worse performance. There's probably room here for some cleanup, but this
    // works for now.
    const drop_live_at = IntervalSet.new<PointIndex>(this.drop_live_at.domain_size());
    for (const point of this.drop_live_at.iter()) {
      // We iterate the `drop_live_at` set from smallest to largest values, so
      // we can use append to add things to the interval set at the end.
      drop_live_at.append(point);
    }

    for (const kind of drop_data) {
      make_all_regions_live(this.infcx, universal_regions, liveness_constraints, kind, drop_live_at, fold_GenericArg);
    }
  }
};

/// Clear the value of fields that are "per local variable".
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:458 reset_local_state
LivenessComputation.prototype.reset_local_state = function (this: LivenessComputation): void {
  this.defs.clear();
  this.use_live_at.clear();
  this.drop_live_at.clear();
  this.drop_locations.length = 0;
  assert(this.stack.length === 0, "assertion failed: self.stack.is_empty()");
};

/// Adds the definitions of `local` into `self.defs`.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:467 add_defs_for
LivenessComputation.prototype.add_defs_for = function (this: LivenessComputation, local: Local): void {
  for (const def of this.local_use_map.defs(local)) {
    // debug!("- defined at {:?}", def);
    this.defs.insert(def);
  }
};

/// Computes all points where local is "use live" -- meaning its
/// current value may be used later (except by a drop). This is
/// done by walking backwards from each use of `local` until we
/// find a `def` of local.
///
/// Requires `add_defs_for(local)` to have been executed.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:480 compute_use_live_points_for
LivenessComputation.prototype.compute_use_live_points_for = function (this: LivenessComputation, local: Local): void {
  // debug!("compute_use_live_points_for(local={:?})", local);

  this.stack.push(...this.local_use_map.uses(local));
  for (let p = this.stack.pop(); p !== undefined; p = this.stack.pop()) {
    // We are live in this block from the closest to us of:
    //
    //  * Inclusively, the block start
    //  * Exclusively, the previous definition (if it's in this block)
    //  * Exclusively, the previous live_at setting (an optimization)
    const block_start = this.location_map.to_block_start(p);
    const previous_defs = this.defs.last_set_in(range_inclusive(block_start, p));
    const previous_live_at = this.use_live_at.last_set_in(range_inclusive(block_start, p));

    let exclusive_start: PointIndex | undefined;
    if (previous_defs !== undefined && previous_live_at !== undefined) {
      exclusive_start = Math.max(previous_defs, previous_live_at) as PointIndex;
    } else if (previous_defs !== undefined) {
      exclusive_start = previous_defs;
    } else if (previous_live_at !== undefined) {
      exclusive_start = previous_live_at;
    } else {
      exclusive_start = undefined;
    }

    if (exclusive_start !== undefined) {
      const exclusive = exclusive_start;
      this.use_live_at.insert_range(range_inclusive((exclusive + 1) as PointIndex, p));

      // If we have a bound after the start of the block, we should
      // not add the predecessors for this block.
      continue;
    } else {
      // Add all the elements of this block.
      this.use_live_at.insert_range(range_inclusive(block_start, p));

      // Then add the predecessors for this block, which are the
      // terminators of predecessor basic blocks. Push those onto the
      // stack so that the next iteration(s) will process them.

      const block = this.location_map.to_location(block_start).block;
      for (const pred_bb of this.body.basic_blocks.predecessors()[block]!) {
        const pred_loc = this.body.terminator_loc(pred_bb);
        this.stack.push(this.location_map.point_from_location(pred_loc));
      }
    }
  }
};

/// Computes all points where local is "drop live" -- meaning its
/// current value may be dropped later (but not used). This is
/// done by iterating over the drops of `local` where `local` (or
/// some subpart of `local`) is initialized. For each such drop,
/// we walk backwards until we find a point where `local` is
/// either defined or use-live.
///
/// Requires `compute_use_live_points_for` and `add_defs_for` to
/// have been executed.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:534 compute_drop_live_points_for
LivenessComputation.prototype.compute_drop_live_points_for = function (this: LivenessComputation, local: Local): void {
  // debug!("compute_drop_live_points_for(local={:?})", local);

  const mpi = this.move_data.rev_lookup.find_local(local);
  if (mpi === undefined) return;
  // debug!("compute_drop_live_points_for: mpi = {:?}", mpi);

  // Find the drops where `local` is initialized.
  for (const drop_point of this.local_use_map.drops(local)) {
    const location = this.location_map.to_location(drop_point);
    // debug_assert_eq!(self.body.terminator_loc(location.block), location,);

    if (this.initialized_at_terminator(location.block, mpi)) {
      const _inserted = this.drop_live_at.insert(drop_point);
      // Right now, we should not visit a drop_point twice.
      // If we do, this will trigger a debug assert so we know we can optimize.
      // debug_assert!(inserted, "drop point should not have been visited yet");
      this.drop_locations.push(location);
      this.stack.push(drop_point);
    }
  }

  // debug!("compute_drop_live_points_for: drop_locations={:?}", self.drop_locations);

  // Reverse DFS. But for drops, we do it a bit differently.
  // The stack only ever stores *terminators of blocks*. Within
  // a block, we walk back the statements in an inner loop.
  for (let term_point = this.stack.pop(); term_point !== undefined; term_point = this.stack.pop()) {
    this.compute_drop_live_points_for_block(mpi, term_point);
  }
};

/// Executes one iteration of the drop-live analysis loop.
///
/// The parameter `mpi` is the `MovePathIndex` of the local variable
/// we are currently analyzing.
///
/// The point `term_point` represents some terminator in the MIR,
/// where the local `mpi` is drop-live on entry to that terminator.
///
/// This method adds all drop-live points within the block and --
/// where applicable -- pushes the terminators of preceding blocks
/// onto `self.stack`.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:576 compute_drop_live_points_for_block
LivenessComputation.prototype.compute_drop_live_points_for_block = function (
  this: LivenessComputation,
  mpi: MovePathIndex,
  term_point: PointIndex,
): void {
  // debug!(
  //     "compute_drop_live_points_for_block(mpi={:?}, term_point={:?})",
  //     self.move_data.move_paths[mpi].place,
  //     self.location_map.to_location(term_point),
  // );

  // We are only invoked with terminators where `mpi` is
  // drop-live on entry.
  // debug_assert!(self.drop_live_at.contains(term_point));

  // Otherwise, scan backwards through the statements in the
  // block. One of them may be either a definition or use
  // live point.
  const term_location = this.location_map.to_location(term_point);
  // debug_assert_eq!(self.body.terminator_loc(term_location.block), term_location,);
  const block = term_location.block;
  const entry_point = this.location_map.entry_point(term_location.block);
  for (let p = (term_point - 1) as PointIndex; p >= entry_point; p = (p - 1) as PointIndex) {
    // debug!(
    //     "compute_drop_live_points_for_block: p = {:?}",
    //     self.location_map.to_location(p)
    // );

    if (this.defs.contains(p)) {
      // debug!("compute_drop_live_points_for_block: def site");
      return;
    }

    if (this.use_live_at.contains(p)) {
      // debug!("compute_drop_live_points_for_block: use-live at {:?}", p);
      return;
    }

    if (!this.drop_live_at.insert(p)) {
      // debug!("compute_drop_live_points_for_block: already drop-live");
      return;
    }
  }

  const body = this.body;
  for (const pred_block of body.basic_blocks.predecessors()[block]!) {
    // debug!("compute_drop_live_points_for_block: pred_block = {:?}", pred_block,);

    // Check whether the variable is (at least partially)
    // initialized at the exit of this predecessor. If so, we
    // want to enqueue it on our list. If not, go check the
    // next block.
    //
    // Note that we only need to check whether `live_local`
    // became de-initialized at basic block boundaries. If it
    // were to become de-initialized within the block, that
    // would have been a "use-live" transition in the earlier
    // loop, and we'd have returned already.
    //
    // NB. It's possible that the pred-block ends in a call
    // which stores to the variable; in that case, the
    // variable may be uninitialized "at exit" because this
    // call only considers the *unconditional effects* of the
    // terminator. *But*, in that case, the terminator is also
    // a *definition* of the variable, in which case we want
    // to stop the search anyhow. (But see Note 1 below.)
    if (!this.initialized_at_exit(pred_block, mpi)) {
      // debug!("compute_drop_live_points_for_block: not initialized");
      continue;
    }

    const pred_term_loc = this.body.terminator_loc(pred_block);
    const pred_term_point = this.location_map.point_from_location(pred_term_loc);

    // If the terminator of this predecessor either *assigns*
    // our value or is a "normal use", then stop.
    if (this.defs.contains(pred_term_point)) {
      // debug!("compute_drop_live_points_for_block: defined at {:?}", pred_term_loc);
      continue;
    }

    if (this.use_live_at.contains(pred_term_point)) {
      // debug!("compute_drop_live_points_for_block: use-live at {:?}", pred_term_loc);
      continue;
    }

    // Otherwise, we are drop-live on entry to the terminator,
    // so walk it.
    if (this.drop_live_at.insert(pred_term_point)) {
      // debug!("compute_drop_live_points_for_block: pushed to stack");
      this.stack.push(pred_term_point);
    }
  }

  // Note 1. There is a weird scenario that you might imagine
  // being problematic here, but which actually cannot happen.
  // The problem would be if we had a variable that *is* initialized
  // (but dead) on entry to the terminator, and where the current value
  // will be dropped in the case of unwind. In that case, we ought to
  // consider `X` to be drop-live in between the last use and call.
  // Here is the example:
  //
  // ```
  // BB0 {
  //   X = ...
  //   use(X); // last use
  //   ...     // <-- X ought to be drop-live here
  //   X = call() goto BB1 unwind BB2
  // }
  //
  // BB1 {
  //   DROP(X)
  // }
  //
  // BB2 {
  //   DROP(X)
  // }
  // ```
  //
  // However, the current code would, when walking back from BB2,
  // simply stop and never explore BB0. This seems bad! But it turns
  // out this code is flawed anyway -- note that the existing value of
  // `X` would leak in the case where unwinding did *not* occur.
  //
  // What we *actually* generate is a store to a temporary
  // for the call (`TMP = call()...`) and then a
  // `Drop(X)` followed by `X = TMP`  to swap that with `X`.
};

/// Returns `true` if the local variable (or some part of it) is initialized
/// at the location defined by `init_at_location`.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:703 initialized_at
LivenessComputation.prototype.initialized_at = function (
  this: LivenessComputation,
  block: BasicBlock,
  mpi: MovePathIndex,
  init_at_location: InitAtLocation,
): boolean {
  // Computes the `MaybeInitializedPlaces` dataflow analysis if it hasn't been done already.
  //
  // In practice, the results of this dataflow analysis are rarely needed but can be expensive to
  // compute on big functions, so we compute them lazily as a fast path when:
  // - there are relevant live locals
  // - there are drop points for these relevant live locals.
  const flow_inits = (this.flow_inits ??= (() => {
    const tcx = this.infcx.tcx;
    const body = this.body;
    // FIXME: reduce the `MaybeInitializedPlaces` domain to the useful `MovePath`s.
    //
    // This dataflow analysis computes maybe-initializedness of all move paths, which
    // explains why it can be expensive on big functions. But this data is only used in
    // drop-liveness. Therefore, most of the move paths computed here are ultimately unused,
    // even if the results are computed lazily and "no relevant live locals with drop
    // points" is the common case.
    //
    // So we only need the ones for 1) relevant live locals 2) that have drop points. That's
    // a much, much smaller domain: in our benchmarks, when it's not zero (the most likely
    // case), there are a few dozens compared to e.g. thousands or tens of thousands of
    // locals and move paths.
    // PORT: `tcx.prof.generic_activity("borrowck_dataflow_maybe_inits")` timer dropped (driver-m2 decision 8).
    const flow_inits = MaybeInitializedPlaces.new(tcx, body, this.move_data).iterate_to_fixpoint(tcx, body, "borrowck").into_results_cursor(body);
    return flow_inits;
  })()) as MaybeInitCursor;
  let states: (MaybeInitState | undefined)[];
  switch (init_at_location) {
    case "Terminator":
      states = this.term_states;
      break;
    case "Exit":
      states = this.exit_states;
      break;
  }
  const state = IndexVec.get_or_insert_with(states, block, () => {
    const terminator_location = this.body.terminator_loc(block);
    switch (init_at_location) {
      case "Terminator":
        flow_inits.seek_before_primary_effect(terminator_location);
        break;
      case "Exit":
        flow_inits.seek_after_primary_effect(terminator_location);
        break;
    }
    return Clone_MaybeReachable(Clone_MixedBitSet as Clone<MixedBitSet<MovePathIndex>>).clone(flow_inits.get());
  });
  if (MaybeReachable_contains(state, mpi)) {
    return true;
  }

  const move_paths = flow_inits.analysis().move_data().move_paths;
  return move_paths[mpi]!.find_descendant(move_paths, (mpi) => MaybeReachable_contains(state, mpi)) !== undefined;
};

/// Returns `true` if the local variable (or some part of it) is initialized in
/// the terminator of `block`. We need to check this to determine if a
/// DROP of some local variable will have an effect -- note that
/// drops, as they may unwind, are always terminators.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:762 initialized_at_terminator
LivenessComputation.prototype.initialized_at_terminator = function (this: LivenessComputation, block: BasicBlock, mpi: MovePathIndex): boolean {
  return this.initialized_at(block, mpi, InitAtLocation.Terminator);
};

/// Returns `true` if the path `mpi` (or some part of it) is initialized at
/// the exit of `block`.
///
/// **Warning:** Does not account for the result of `Call`
/// instructions.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:771 initialized_at_exit
LivenessComputation.prototype.initialized_at_exit = function (this: LivenessComputation, block: BasicBlock, mpi: MovePathIndex): boolean {
  return this.initialized_at(block, mpi, InitAtLocation.Exit);
};

/// Computes the `DropData` for a given type, caching the result.
/// This also reports the overflow errors from the computation, if any.
// rustc: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:786 dropck_local
function dropck_local(infcx: BorrowckInferCtxt, drop_data: Map<Ty, DropData>, local_ty: Ty, local_span: Span): DropData {
  const compute_drop_data = (): DropData => {
    const goal: DropckOutlives = { dropped_ty: local_ty };
    const r = infcx.fully_perform(goal, DUMMY_SP, QueryTypeOp_DropckOutlives);
    switch (r.$) {
      case "Ok": {
        const { output, constraints } = r._0;
        return { dropck_result: output, region_constraint_data: constraints };
      }
      case "Err": {
        // We don't run dropck on HIR, and dropck looks inside fields of
        // types, so there's no guarantee that it succeeds. We also
        // can't rely on the `ErrorGuaranteed` from `fully_perform` here
        // because it comes from delay_span_bug.
        //
        // Do this inside of a probe because we don't particularly care (or want)
        // any region side-effects of this operation in our infcx.
        infcx.probe((_) => {
          const ocx = ObligationCtxt.new_with_diagnostics(infcx.infcx);
          const res = dropck_outlives.compute_dropck_outlives_with_errors(ocx, infcx.param_env.and(goal), local_span);
          let errors: TraitErrors<FulfillmentError>;
          switch (res.$) {
            case "Ok":
              errors = ocx.evaluate_obligations_error_on_ambiguity();
              break;
            case "Err":
              errors = { $: "HasErrors", _0: res._0 };
              break;
          }

          // Could have no errors if a type lowering error, say, caused the query
          // to fail.
          if (errors.$ === "HasErrors") {
            infcx.err_ctxt().report_fulfillment_errors(errors._0);
          }
        });
        // PORT: `Default::default()` of `DropckOutlivesResult` (`#[derive(Default)]`: both vecs empty).
        return { dropck_result: new DropckOutlivesResult([], []), region_constraint_data: undefined };
      }
    }
  };

  let drop_data_ = drop_data.get(local_ty);
  if (drop_data_ === undefined) {
    drop_data_ = compute_drop_data();
    drop_data.set(local_ty, drop_data_);
  }
  drop_data_.dropck_result.report_overflows(infcx.tcx, local_span, local_ty);
  return drop_data_;
}

/** `MaybeReachable<MixedBitSet<MovePathIndex>>`, the `MaybeInitializedPlaces` domain. */
type MaybeInitState = MaybeReachable<MixedBitSet<MovePathIndex>>;
/** PORT: the generated `flow_inits` field is a `ResultsCursor<unknown, MaybeInitializedPlaces>`; this is its domain. */
type MaybeInitCursor = ResultsCursor<MaybeInitState, MaybeInitializedPlaces>;

/** `state.contains(elem)` on a `MaybeReachable<MixedBitSet<_>>` (`MaybeReachable::contains`). */
function MaybeReachable_contains(state: MaybeInitState, elem: MovePathIndex): boolean {
  return MaybeReachable.contains(state, elem, BitSetExt_MixedBitSet as BitSetExt<MixedBitSet<MovePathIndex>, MovePathIndex>);
}
