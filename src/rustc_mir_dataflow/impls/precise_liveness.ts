// Port of compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs (declared by lane dataflow-contract, filled by lane
// dataflow-impls). Notes:
// - `VisitAllocatedLocalsWith<F>(pub F)` / `VisitDeallocatedLocalsWith<F>(pub F)` keep the closure as `_0` and extend
//   rustc_middle mir/visit.ts's `Visitor` (D4); `VisitPlacesWith` is mir/visit.ts's.
// - `KillPoints<'a>.kill_points_map: IndexVec<PointIndex, &'a [(Local, Location)]>` is an array of slices of the
//   caller's `kill_points` vector (`&mut Vec<(Local, Location)>` is the array, mutated in place; the slices are copies,
//   nobody writes through them).
// - `KillPointsVisitor` extends `ResultsVisitorBase<DenseBitSet<Local>, MaybeLiveLocals>`; `PreciseLiveness` extends
//   `AnalysisBase<DenseBitSet<Local>>`.
// - `SplitPointEffect` has explicit discriminants (`Early = 0`, `Late = 1`): `SplitPointEffect_discriminant`.
//   `SplitPointIndex` is a `newtype_index!` (`SplitPointIndex({})`); its inherent fns `new` / `point` / `effect` are on
//   the companion (`Idx::new` stays `SplitPointIndex.new_`).
// - `trace!` / `debug_assert!` are comments (tracing is not compiled in; rustc ships without debug assertions).
//! Computes the points where each local must have a distinct allocation.
//!
//! The result is a [`SparseIntervalMatrix`] with one row per local. Two locals
//! may share the same address only if their rows are disjoint. To model MIR
//! statements where a source operand and destination place may share an
//! address, each statement and terminator is split into an early point, where
//! operands are read, and a late point, where destinations are written.
//!
//! A local live range starts at the late point of any statement or terminator
//! that writes to it without a `Deref` projection. It ends at `StorageLive` or
//! `StorageDead`, or at the early point of a whole-local move operand or the
//! last use of that local on a control-flow path (only for locals whose address
//! is never observed). This happens at `StorageLive` because it resets a local
//! to an uninitialized state.
//!
//! `Call` terminators are handled specially: move operands are kept live
//! through the late point of the terminator so they conflict with each other
//! and with the destination place. This matches the runtime behavior where the
//! place is donated to the callee for the duration of the call.
//!
//! The analysis consists of three passes:
//!
//! 1. A backward value-liveness analysis which identifies the last point at
//!    which each local is directly used in each control flow path. This is used
//!    to shorten the lifetime of unborrowed locals to their last use.
//! 2. A forward allocation-liveness analysis which uses that information
//!    together with writes, moves, and storage markers to compute which
//!    allocations may be live on entry to each block.
//! 3. A final walk using those entry states which constructs the matrix and
//!    distinguishes whether each effect happens at the early or late point of a
//!    statement or terminator.

import { range_inclusive } from "../../rustc_index/idx.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { PLAIN, debug_vec } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { unreachable } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet, GenKill_DenseBitSet } from "../framework/mod.ts";
import { ResultsVisitorBase, visit_results } from "../framework/visitor.ts";
import { type DenseLocationMap, PointIndex } from "../points.ts";
import {
  type BasicBlock,
  type Body,
  type CallReturnPlaces,
  debug_Local,
  debug_Location,
  type Local,
  Location,
  type Operand,
  type Place,
  RETURN_PLACE,
  type Statement,
  type Terminator,
  traversal,
} from "../../rustc_middle/mir/mod.ts";
import { MirDumper } from "../../rustc_middle/mir/pretty.ts";
import type { PassWhere } from "../../rustc_middle/mir/pretty.gen.ts";
import { NonUseContext, type PlaceContext, VisitPlacesWith, Visitor } from "../../rustc_middle/mir/visit.ts";
import { SparseIntervalMatrix } from "../../rustc_index/interval.ts";
import { borrowed_locals } from "./borrowed_locals.ts";
import { DefUse, MaybeLiveLocals } from "./liveness.ts";

const GK = GenKill_DenseBitSet<Local>();

/// Visits locals that are implicitly allocated by a statement or terminator as
/// part of destination place evaluation.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:50 VisitAllocatedLocalsWith
export class VisitAllocatedLocalsWith<F extends (local: Local, context: PlaceContext) => void> extends Visitor {
  constructor(public _0: F) {
    super();
  }

  // ---- impl Visitor for VisitAllocatedLocalsWith ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:56 visit_place
  override visit_place(place: Place, context: PlaceContext, _2: Location): void {
    switch (DefUse.for_place(place, context)) {
      case "Def":
      case "PartialWrite":
        this._0(place.local, context);
        break;
      case "Use":
      case "NonUse":
        break;
    }
  }
}

/// Visits locals that are implicitly freed by being evaluated as a bare-local
/// move operand or through a storage statement.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:66 VisitDeallocatedLocalsWith
export class VisitDeallocatedLocalsWith<F extends (local: Local, context: PlaceContext) => void> extends Visitor {
  constructor(public _0: F) {
    super();
  }

  // ---- impl Visitor for VisitDeallocatedLocalsWith ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:72 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    switch (statement.kind.$) {
      // StorageLive resets a local to the live-but-unallocated state,
      // which also has the effect of freeing its allocation.
      case "StorageLive": {
        const local = statement.kind._0;
        this._0(local, { $: "NonUse", _0: NonUseContext.StorageLive });
        break;
      }
      case "StorageDead": {
        const local = statement.kind._0;
        this._0(local, { $: "NonUse", _0: NonUseContext.StorageDead });
        break;
      }
      default:
        this.super_statement(statement, location);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:86 visit_operand
  override visit_operand(operand: Operand, _1: Location): void {
    let local: Local | undefined;
    if (operand.$ === "Move" && (local = operand._0.as_local()) !== undefined) {
      this._0(local, { $: "NonMutatingUse", _0: "Move" });
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// Backward dataflow pass
//
// This pass computes "kill points" for each local, indicating the location of
// their last use in a particular control flow branch. These are later used in
// the forward pass to end the live range of locals that are never borrowed at
// their last direct use.
//
// This pass ignores borrowed locals: we can't determine their last use from
// syntactic uses of the base local, so we conservatively treat them as always
// live in the backwards pass and don't emit kill points for them. The main
// forward pass still kills at `StorageDead` and whole-local moves, which is
// when their allocation is freed.
//
// This pass has 2 outputs: a set of kill points that mark the last use
// locations of locals and a per-block bitset indicating which locals are live
// on entry to that block. The latter acts as a set of kill points at block
// entry for all locals not in the bit set.

// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:114 KillPoints
class KillPoints {
  constructor(
    public live_on_entry: DenseBitSet<Local>[],
    public kill_points_map: (readonly [Local, Location])[][],
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:120 compute
  static compute(
    tcx: TyCtxt,
    body: Body,
    pass_name: string | undefined,
    points: DenseLocationMap,
    kill_points: [Local, Location][],
  ): KillPoints {
    const maybe_live_locals = new MaybeLiveLocals().iterate_to_fixpoint(tcx, body, pass_name);
    const borrowed_locals_ = borrowed_locals(body);

    // Initialize all borrowed locals as live on entry. We never try to kill
    // those.
    const live_on_entry: DenseBitSet<Local>[] = [];
    for (let i = 0; i < body.basic_blocks.deref().length; i++) live_on_entry.push(borrowed_locals_.clone());

    // Collect kill points and live-on-entry states from the results of
    // MaybeLiveLocals.
    kill_points.length = 0;
    const visitor = new KillPointsVisitor(kill_points, live_on_entry, borrowed_locals_);
    visit_results(
      body,
      [...traversal.reachable(body)].map(([block, _]) => block),
      maybe_live_locals,
      visitor,
    );
    // trace!(?kill_points);
    // trace!(?live_on_entry);

    // Create a mapping of `PointIndex` to the set of killed locals at that
    // location.
    const kill_points_map: (readonly [Local, Location])[][] = [];
    for (let i = 0; i < points.num_points(); i++) kill_points_map.push([]);
    for (const chunk of chunk_by(kill_points, (a, b) => Location_eq(a[1], b[1]))) {
      const point = points.point_from_location(chunk[0]![1]);
      // trace!("Kill points at {:?}: {:?}", chunk[0].1, chunk);
      // debug_assert!(kill_points_map[point].is_empty());
      kill_points_map[point] = chunk;
    }

    return new KillPoints(live_on_entry, kill_points_map);
  }
}

/** PORT: `slice::chunk_by(pred)`: the runs of consecutive elements for which `pred(a, b)` holds. */
function chunk_by<T>(v: readonly T[], pred: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = [];
  let i = 0;
  while (i < v.length) {
    let j = i + 1;
    while (j < v.length && pred(v[j - 1]!, v[j]!)) j++;
    out.push(v.slice(i, j));
    i = j;
  }
  return out;
}

/** `Location == Location` (derived `PartialEq`). */
function Location_eq(a: Location, b: Location): boolean {
  return a.block === b.block && a.statement_index === b.statement_index;
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:166 KillPointsVisitor
class KillPointsVisitor extends ResultsVisitorBase<DenseBitSet<Local>, MaybeLiveLocals> {
  constructor(
    public kill_points: [Local, Location][],
    public live_on_entry: DenseBitSet<Local>[],
    public borrowed_locals: DenseBitSet<Local>,
  ) {
    super();
  }

  // ---- impl ResultsVisitor<MaybeLiveLocals> for KillPointsVisitor ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:173 visit_block_exit
  override visit_block_exit(state: DenseBitSet<Local>, block: BasicBlock): void {
    // Borrowed locals are already marked as live when live_on_entry was
    // initialized. This adds the non-borrowed locals that we have
    // determined are live on entry to this block.
    this.live_on_entry[block]!.union(state);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:180 visit_after_early_statement_effect
  override visit_after_early_statement_effect(state: DenseBitSet<Local>, statement: Statement, location: Location): void {
    new VisitPlacesWith((place: Place, ctxt: PlaceContext) => {
      // Ignore non-uses.
      switch (ctxt.$) {
        case "NonMutatingUse":
        case "MutatingUse":
          break;
        case "NonUse":
          return;
      }

      // If a local is used in a statement but is dead after it then this
      // location is a kill point. Don't emit a kill point for borrowed
      // locals.
      if (!state.contains(place.local) && !this.borrowed_locals.contains(place.local)) {
        this.kill_points.push([place.local, location]);
      }
    }).visit_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:203 visit_after_early_terminator_effect
  override visit_after_early_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, location: Location): void {
    new VisitPlacesWith((place: Place, ctxt: PlaceContext) => {
      // Ignore non-uses (they don't do anything) and edge uses
      // (implicitly killed though live_on_entry at the start of the
      // corresponding successor).
      if (
        (ctxt.$ === "MutatingUse" && (ctxt._0 === "AsmOutput" || ctxt._0 === "Call" || ctxt._0 === "Yield")) ||
        ctxt.$ === "NonUse"
      ) {
        return;
      }

      // If a local is used in a terminator but is dead after it then this
      // location is a kill point. Don't emit a kill point for borrowed
      // locals.
      if (!state.contains(place.local) && !this.borrowed_locals.contains(place.local)) {
        this.kill_points.push([place.local, location]);
      }
    }).visit_terminator(terminator, location);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Forward dataflow pass
//
// This is a simpler version of the main pass in `liveness_matrix`. It only
// needs to determine local liveness at block edges and doesn't distinguish
// between "early" and "late" effects. However it must still preserve the
// ordering of effects: moved operands are killed before destinations are
// generated.

// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:243 PreciseLiveness
class PreciseLiveness extends AnalysisBase<DenseBitSet<Local>> {
  constructor(
    public kill_points: KillPoints,
    public points: DenseLocationMap,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:249 apply_block_start_effect
  apply_block_start_effect(state: DenseBitSet<Local>, block: BasicBlock): void {
    // Kill any unborrowed locals that are dead at the start of this block.
    // Notably this kills any dead results produced by a predecessor's
    // terminator. Borrowed locals are always included in live_on_entry.
    state.intersect(this.kill_points.live_on_entry[block]!);
  }

  // ---- impl Analysis for PreciseLiveness ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "precise_liveness";

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:262 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:266 initialize_start_block
  initialize_start_block(body: Body, state: DenseBitSet<Local>): void {
    // Function arguments start out as live.
    for (const arg of body.args_iter()) {
      GK.gen_(state, arg);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:273 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, statement: Statement, location: Location): void {
    if (location.statement_index === 0) {
      this.apply_block_start_effect(state, location.block);
    }

    new VisitDeallocatedLocalsWith((local, _) => GK.kill(state, local)).visit_statement(statement, location);
    new VisitAllocatedLocalsWith((local, _) => GK.gen_(state, local)).visit_statement(statement, location);

    // Apply kill points at this statement: if a variable is dead then it
    // doesn't need storage.
    const point = this.points.point_from_location(location);
    for (const [local, _] of this.kill_points.kill_points_map[point]!) {
      GK.kill(state, local);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:295 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, location: Location): void {
    if (location.statement_index === 0) {
      this.apply_block_start_effect(state, location.block);
    }

    new VisitDeallocatedLocalsWith((local, _) => GK.kill(state, local)).visit_terminator(terminator, location);

    // Gen destination places.
    new VisitAllocatedLocalsWith((local, ctxt) => {
      // The resume place of a Yield is only evaluated after the coroutine
      // is resumed. This is in contrast to call destinations and inline
      // asm outputs which are evaluated before the call and therefore
      // remain allocated on both normal and unwind edges.
      if (!(ctxt.$ === "MutatingUse" && ctxt._0 === "Yield")) {
        GK.gen_(state, local);
      }
    }).visit_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:321 apply_call_return_effect
  override apply_call_return_effect(state: DenseBitSet<Local>, _block: BasicBlock, return_places: CallReturnPlaces): void {
    if (return_places.$ === "Yield" && !return_places._0.is_indirect()) {
      const place = return_places._0;
      GK.gen_(state, place.local);
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// Matrix construction

/// Different "phases" of a single MIR statement, used to describe how
/// overlapping operands are handled.
///
/// As a general rule, source operands are read in the `Early` phase and
/// destination places are written in the `Late` phase.
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:344 SplitPointEffect
export type SplitPointEffect = "Early" | "Late";
export const SplitPointEffect = { Early: "Early", Late: "Late" } as const;
/** The explicit discriminants (`Early = 0`, `Late = 1`; `effect as u32`). */
export function SplitPointEffect_discriminant(e: SplitPointEffect): number {
  return e === "Early" ? 0 : 1;
}

// rustc_index::newtype_index! {
//     #[orderable]
//     #[debug_format = "SplitPointIndex({})"]
//     pub struct SplitPointIndex {}
// }
/// A `PointIndex` with the lower bit encoding early/late inside a
/// statement.
///
/// This is used to model overlap constraints within a MIR statement: if a
/// source/destination are allowed to overlap then the source is read in
/// `SplitPointEffect::Early` and the write is done in
/// `SplitPointEffect::Late`.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:359 SplitPointIndex
export type SplitPointIndex = number & { readonly __brand: "SplitPointIndex" };
const SplitPointIndex_newtype = newtype_index<SplitPointIndex>((n) => `SplitPointIndex(${n})`);
export const SplitPointIndex = {
  ...SplitPointIndex_newtype,

  /** The inherent `SplitPointIndex::new(point, effect)` (shadows `Idx::new`, which stays `SplitPointIndex.new_`). */
  new_: SplitPointIndex_newtype.new,

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:363 new
  new(point: PointIndex, effect: SplitPointEffect): SplitPointIndex {
    // PORT: `<<` on a u32: the result is masked to 32 bits (`>>> 0`) as upstream's (no overflow check on shifts).
    const index = ((PointIndex.as_u32(point) << 1) | SplitPointEffect_discriminant(effect)) >>> 0;
    return SplitPointIndex_newtype.from_u32(index);
  },

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:368 point
  point(self: SplitPointIndex): PointIndex {
    return PointIndex.from_u32(SplitPointIndex_newtype.as_u32(self) >>> 1);
  },

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:372 effect
  effect(self: SplitPointIndex): SplitPointEffect {
    switch (SplitPointIndex_newtype.as_u32(self) & 1) {
      case 0:
        return "Early";
      case 1:
        return "Late";
      default:
        return unreachable();
    }
  },
};

/// Helper type to construct a `SparseIntervalMatrix`.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:382 MatrixBuilder
class MatrixBuilder {
  constructor(
    public matrix: SparseIntervalMatrix<Local, SplitPointIndex>,
    public range_start: (SplitPointIndex | undefined)[],

    // Track locals that have been live at any point in a block so that at the
    // end of a block we don't need to iterate over all locals. This
    // significantly speeds up matrix building.
    public maybe_live_locals: Local[],
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:393 gen_
  gen_(local: Local, point: PointIndex, effect: SplitPointEffect): void {
    const split_point = SplitPointIndex.new(point, effect);

    // No-op if the local is already live.
    if (this.range_start[local] === undefined) {
      this.range_start[local] = split_point;
      this.maybe_live_locals.push(local);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:403 kill
  kill(local: Local, point: PointIndex, effect: SplitPointEffect): void {
    const end = SplitPointIndex.new(point, effect);

    // No-op if the local is already dead.
    const start = this.range_start[local];
    this.range_start[local] = undefined;
    if (start !== undefined) {
      // debug_assert!(end >= start);
      this.matrix.append_range(local, range_inclusive(start, end));
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:413 kill_all
  kill_all(point: PointIndex, effect: SplitPointEffect): void {
    let local: Local | undefined;
    while ((local = this.maybe_live_locals.pop()) !== undefined) {
      this.kill(local, point, effect);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:419 kill_all_except
  kill_all_except(except: Local, point: PointIndex, effect: SplitPointEffect): void {
    let local: Local | undefined;
    while ((local = this.maybe_live_locals.pop()) !== undefined) {
      if (local !== except) {
        this.kill(local, point, effect);
      }
    }
    this.maybe_live_locals.push(except);
  }
}

// rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:429 liveness_matrix
export function liveness_matrix(
  tcx: TyCtxt,
  body: Body,
  points: DenseLocationMap,
  pass_name: string | undefined,
): SparseIntervalMatrix<Local, SplitPointIndex> {
  const kill_points_vec: [Local, Location][] = [];
  const kill_points = KillPoints.compute(tcx, body, pass_name, points, kill_points_vec);
  const results = new PreciseLiveness(kill_points, points).iterate_to_fixpoint(tcx, body, pass_name);

  const range_start: (SplitPointIndex | undefined)[] = [];
  for (let i = 0; i < body.local_decls.length; i++) range_start.push(undefined);
  const builder = new MatrixBuilder(SparseIntervalMatrix.new<Local, SplitPointIndex>(points.num_points() * 2), range_start, []);
  const blocks = body.basic_blocks.deref();
  for (let block_ = 0; block_ < blocks.length; block_++) {
    const block = block_ as BasicBlock;
    const block_data = blocks[block_]!;
    // We can mutate the state in-place since we're not using it any more
    // after this point.
    const state = results.entry_states[block]!;

    // Notably this kills any dead results produced by a predecessor's
    // terminator.
    state.intersect(kill_points.live_on_entry[block]!);

    // Gen any locals that are live at the start of the block. If this block
    // only consists of a return terminator then only gen the return place
    // instead. This ensures that StorageDead for all other locals are
    // inserted before the return terminator.
    const terminator = block_data.terminator_();
    if (terminator.kind.$ === "Return" && block_data.statements.length === 0) {
      if (state.contains(RETURN_PLACE)) {
        builder.gen_(RETURN_PLACE, points.entry_point(block), "Early");
      }
    } else {
      for (const local of state.iter()) {
        builder.gen_(local, points.entry_point(block), "Early");
      }
    }

    for (let statement_index = 0; statement_index < block_data.statements.length; statement_index++) {
      const statement = block_data.statements[statement_index]!;
      const location = new Location(block, statement_index);
      const point = points.point_from_location(location);

      // Kill moved locals at the early point.
      new VisitDeallocatedLocalsWith((local, _) => {
        builder.kill(local, point, "Early");
      }).visit_statement(statement, location);

      // Kill any locals which are no longer used after this statement.
      for (const [local, _] of kill_points.kill_points_map[point]!) {
        builder.kill(local, point, "Early");
      }

      // Gen destination places at the late point.
      new VisitAllocatedLocalsWith((local, _) => {
        builder.gen_(local, point, "Late");
      }).visit_statement(statement, location);

      // Kill any dead destination places: they will only appear at the
      // late point of the statement they are generated in, which is
      // sufficient for determining overlap.
      for (const [local, _] of kill_points.kill_points_map[point]!) {
        builder.kill(local, point, "Late");
      }
    }

    // If this block ends in a return terminator, end all live ranges before
    // the terminator so that StorageDead statements are inserted before it.
    //
    // This is useful after inlining so that the lifetime of locals in the
    // inlined callee don't extend past the call in the caller.
    if (terminator.kind.$ === "Return" && block_data.statements.length !== 0) {
      // Blocks with only a return terminator are handled above.
      const location = new Location(block, block_data.statements.length - 1);
      const point = points.point_from_location(location);
      builder.kill_all_except(RETURN_PLACE, point, "Late");
    }

    const location = new Location(block, block_data.statements.length);
    const point = points.point_from_location(location);

    // Kill moved locals at the early point.
    new VisitDeallocatedLocalsWith((local, _) => {
      builder.kill(local, point, "Early");
    }).visit_terminator(terminator, location);

    // Kill any locals which are no longer used after this terminator.
    for (const [local, _] of kill_points.kill_points_map[point]!) {
      builder.kill(local, point, "Early");
    }

    // Gen destination places at the late point.
    new VisitAllocatedLocalsWith((local, _) => {
      builder.gen_(local, point, "Late");
    }).visit_terminator(terminator, location);

    // Move arguments to a call are treated specially: the place that they
    // represent is passed directly to the callee, which means that they are
    // not allowed to alias any other move operand or the destination place.
    // This is represented here by extending their live range to the late
    // part, making it overlap with that of the destination place.
    //
    // Notably, this *doesn't* apply to TailCall.
    if (terminator.kind.$ === "Call") {
      const args = terminator.kind.args;
      for (const arg of args) {
        if (arg.node.$ === "Move" && !arg.node._0.is_indirect()) {
          const place = arg.node._0;
          builder.gen_(place.local, point, "Late");
        }
      }
    }

    // End the lifetimes of all locals at the end of the block. Successor
    // blocks (which may not be contiguous in the index space!) will
    // initialize the lifetimes again from their entry state.
    builder.kill_all(point, "Late");
  }

  return builder.matrix;
}

// rustc: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:569 dump_liveness_matrix
export function dump_liveness_matrix(
  tcx: TyCtxt,
  body: Body,
  pass_name: string,
  points: DenseLocationMap,
  matrix: SparseIntervalMatrix<Local, SplitPointIndex>,
): void {
  const locals_live_at = (split_point: SplitPointIndex): Local[] => {
    return [...matrix.rows()].filter((r) => matrix.contains(r, split_point));
  };

  const dumper = MirDumper.new(tcx, pass_name, body);
  if (dumper !== undefined) {
    const extra_data = (pass_where: PassWhere, w: Write): IoResult<void> => {
      if (pass_where.$ === "BeforeLocation") {
        const loc = pass_where._0;
        let r: IoResult<void>;
        const point = points.point_from_location(loc);
        let split_point = SplitPointIndex.new(point, "Early");
        let live = locals_live_at(split_point);
        if ((r = w.write_fmt([`        // ${debug_Location(loc, PLAIN)}-early => ${debug_vec(live, PLAIN, debug_Local)}\n`])).$ === "Err") return r;
        split_point = SplitPointIndex.new(point, "Late");
        live = locals_live_at(split_point);
        if ((r = w.write_fmt([`        // ${debug_Location(loc, PLAIN)}-late => ${debug_vec(live, PLAIN, debug_Local)}\n`])).$ === "Err") return r;
      }
      return Ok(undefined);
    };

    dumper.set_extra_data(extra_data).dump_mir(body);
  }
}
