// Port of compiler/rustc_borrowck/src/type_check/liveness/trace.rs (lane borrowck-contract: declarations; fill lane bck-tc-live, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `get_drop_args: impl FnOnce() -> &'drop_data [GenericArg]` is `() => readonly GenericArg[]`;
// `live_region_variances: Option<&mut LiveRegionVariances>` is the shared array or `undefined`.
// PORT: `FxIndexSet<Local>` parameters are `Set<Local>` (insertion-ordered JS sets); `FxIndexMap<Ty, DropData>` is a
// `Map<Ty, DropData>` (interned `Ty` keys).
import type { BasicBlock, Body, Local } from "../../../rustc_middle/mir/mod.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { MoveData, MovePathIndex } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap, PointIndex } from "../../../rustc_mir_dataflow/points.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";
import type { BorrowckInferCtxt } from "../../lib.gen.ts";
import type { DeferredRegionLiveness } from "../../polonius/liveness.gen.ts";
import type { LiveRegionVariances } from "../../polonius/mod.gen.ts";
import type { LivenessValues } from "../../region_infer/values.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { TypeChecker } from "../mod.ts";
import type { LocalUseMap } from "./local_use_map.gen.ts";
import { type DropData, type InitAtLocation, LivenessComputation, LivenessResults } from "./trace.gen.ts";
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
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:43 trace (lane bck-tc-live)
export function trace(
  typeck: TypeChecker,
  location_map: DenseLocationMap,
  move_data: MoveData,
  relevant_live_locals: readonly Local[],
  boring_locals: readonly Local[],
  deferred_locals: Set<Local>,
): void {
  return unported("rustc_borrowck::type_check::liveness::trace::trace");
}

// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:133 new (lane bck-tc-live)
(LivenessResults as unknown as { new: typeof LivenessResults.new }).new = function (
  typeck: TypeChecker,
  comp: LivenessComputation,
): LivenessResults {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessResults::new");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:140 compute_for_all_locals (lane bck-tc-live)
LivenessResults.prototype.compute_for_all_locals = function (this: LivenessResults, relevant_live_locals: readonly Local[]): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessResults::compute_for_all_locals");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:146 compute_for_local (lane bck-tc-live)
LivenessResults.prototype.compute_for_local = function (this: LivenessResults, local: Local): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessResults::compute_for_local");
};

/// Runs dropck for locals whose liveness isn't relevant. This is
/// necessary to eagerly detect unbound recursion during drop glue computation.
///
/// These are all the locals which do not potentially reference a region local
/// to this body. Locals which only reference free regions are always drop-live
/// and can therefore safely be dropped.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:196 dropck_boring_locals (lane bck-tc-live)
LivenessResults.prototype.dropck_boring_locals = function (
  this: LivenessResults,
  boring_locals: readonly Local[],
  deferred_locals: Set<Local>,
  deferred_liveness: DeferredRegionLiveness,
): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessResults::dropck_boring_locals");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:208 dropck_boring_local (lane bck-tc-live)
LivenessResults.prototype.dropck_boring_local = function (
  this: LivenessResults,
  local: Local,
  is_local_deferred: boolean,
  deferred_liveness: DeferredRegionLiveness,
): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessResults::dropck_boring_local");
};

/// Add extra drop facts needed for Polonius Legacy.
///
/// Add facts for all locals with free regions, since regions may outlive
/// the function body only at certain nodes in the CFG.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:280 record_legacy_polonius_drop_facts (lane bck-tc-live)
LivenessResults.prototype.record_legacy_polonius_drop_facts = function (
  this: LivenessResults,
  nll_relevant_locals: readonly Local[],
  deferred_polonius_relevant_locals: Set<Local>,
): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessResults::record_legacy_polonius_drop_facts");
};

// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:364 new (lane bck-tc-live)
(LivenessComputation as unknown as { new: typeof LivenessComputation.new }).new = function (
  infcx: BorrowckInferCtxt,
  body: Body,
  location_map: DenseLocationMap,
  move_data: MoveData,
  local_use_map: LocalUseMap,
): LivenessComputation {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::new");
};

/// Compute for a given local the use- and drop-live points
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:390 compute (lane bck-tc-live)
LivenessComputation.prototype.compute = function (
  this: LivenessComputation,
  local: Local,
  universal_regions: UniversalRegions,
  live_region_variances: LiveRegionVariances | undefined,
  liveness_constraints: LivenessValues,
  get_drop_args: () => readonly GenericArg[],
): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::compute");
};

/// Clear the value of fields that are "per local variable".
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:458 reset_local_state (lane bck-tc-live)
LivenessComputation.prototype.reset_local_state = function (this: LivenessComputation): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::reset_local_state");
};

/// Adds the definitions of `local` into `self.defs`.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:467 add_defs_for (lane bck-tc-live)
LivenessComputation.prototype.add_defs_for = function (this: LivenessComputation, local: Local): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::add_defs_for");
};

/// Computes all points where local is "use live" -- meaning its
/// current value may be used later (except by a drop). This is
/// done by walking backwards from each use of `local` until we
/// find a `def` of local.
///
/// Requires `add_defs_for(local)` to have been executed.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:480 compute_use_live_points_for (lane bck-tc-live)
LivenessComputation.prototype.compute_use_live_points_for = function (this: LivenessComputation, local: Local): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::compute_use_live_points_for");
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
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:534 compute_drop_live_points_for (lane bck-tc-live)
LivenessComputation.prototype.compute_drop_live_points_for = function (this: LivenessComputation, local: Local): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::compute_drop_live_points_for");
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
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:576 compute_drop_live_points_for_block (lane bck-tc-live)
LivenessComputation.prototype.compute_drop_live_points_for_block = function (
  this: LivenessComputation,
  mpi: MovePathIndex,
  term_point: PointIndex,
): void {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::compute_drop_live_points_for_block");
};

/// Returns `true` if the local variable (or some part of it) is initialized
/// at the location defined by `init_at_location`.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:703 initialized_at (lane bck-tc-live)
LivenessComputation.prototype.initialized_at = function (
  this: LivenessComputation,
  block: BasicBlock,
  mpi: MovePathIndex,
  init_at_location: InitAtLocation,
): boolean {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::initialized_at");
};

/// Returns `true` if the local variable (or some part of it) is initialized in
/// the terminator of `block`. We need to check this to determine if a
/// DROP of some local variable will have an effect -- note that
/// drops, as they may unwind, are always terminators.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:762 initialized_at_terminator (lane bck-tc-live)
LivenessComputation.prototype.initialized_at_terminator = function (this: LivenessComputation, block: BasicBlock, mpi: MovePathIndex): boolean {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::initialized_at_terminator");
};

/// Returns `true` if the path `mpi` (or some part of it) is initialized at
/// the exit of `block`.
///
/// **Warning:** Does not account for the result of `Call`
/// instructions.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:771 initialized_at_exit (lane bck-tc-live)
LivenessComputation.prototype.initialized_at_exit = function (this: LivenessComputation, block: BasicBlock, mpi: MovePathIndex): boolean {
  return unported("rustc_borrowck::type_check::liveness::trace::LivenessComputation::initialized_at_exit");
};

/// Computes the `DropData` for a given type, caching the result.
/// This also reports the overflow errors from the computation, if any.
// stub: compiler/rustc_borrowck/src/type_check/liveness/trace.rs:786 dropck_local (lane bck-tc-live)
function dropck_local(infcx: BorrowckInferCtxt, drop_data: Map<Ty, DropData>, local_ty: Ty, local_span: Span): DropData {
  return unported("rustc_borrowck::type_check::liveness::trace::dropck_local");
}
