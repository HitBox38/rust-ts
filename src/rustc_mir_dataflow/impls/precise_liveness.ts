// Port of compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs: DECLARED (lane dataflow-contract). Every fn is a
// stub for lane `dataflow-impls` (plan-m4 §5 wave 22).
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Notes:
// - `VisitAllocatedLocalsWith<F>(pub F)` / `VisitDeallocatedLocalsWith<F>(pub F)` keep the closure as `_0`.
//   PORT(contract): extends mir Visitor (pending mir-contract, D4): they override `visit_place` / `visit_statement` /
//   `visit_operand` of mir-contract's `Visitor` (`self.super_statement(..)` comes from it); `VisitPlacesWith` is
//   mir-contract's too.
// - `KillPoints<'a>.kill_points_map: IndexVec<PointIndex, &'a [(Local, Location)]>` is an array of slices of the
//   caller's `kill_points` vector (`&mut Vec<(Local, Location)>` is the array, mutated in place).
// - `KillPointsVisitor` extends `ResultsVisitorBase<DenseBitSet<Local>, MaybeLiveLocals>`; `PreciseLiveness` extends
//   `AnalysisBase<DenseBitSet<Local>>`.
// - `SplitPointEffect` has explicit discriminants (`Early = 0`, `Late = 1`): `SplitPointEffect_discriminant`.
//   `SplitPointIndex` is a `newtype_index!` (`SplitPointIndex({})`); its inherent fns `new` / `point` / `effect` are on
//   the companion.
// - `SparseIntervalMatrix` (rustc_index interval.rs) is pending lane index-ds; declared locally below.

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unported } from "../../std/panic.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet } from "../framework/mod.ts";
import { ResultsVisitorBase } from "../framework/visitor.ts";
import type { DenseLocationMap, PointIndex } from "../points.ts";
import type { BasicBlock, Body, CallReturnPlaces, Local, Location, Operand, Place, Statement, Terminator } from "../pending.ts";
import type { MaybeLiveLocals } from "./liveness.ts";

// PORT(contract): pending mir-contract (mir/visit.rs `PlaceContext`).
type PlaceContext = { readonly __pending_mir: "PlaceContext" };
// PORT(contract): pending index-ds (rustc_index interval.rs `SparseIntervalMatrix<R, C>`).
type SparseIntervalMatrix<R extends number, C extends number> = {
  readonly __pending_index_ds: "SparseIntervalMatrix";
  readonly __r?: R;
  readonly __c?: C;
};

/// Visits locals that are implicitly allocated by a statement or terminator as
/// part of destination place evaluation.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:50 VisitAllocatedLocalsWith
export class VisitAllocatedLocalsWith<F extends (local: Local, context: PlaceContext) => void> {
  constructor(public _0: F) {}

  // ---- impl Visitor for VisitAllocatedLocalsWith ----

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:56 visit_place (lane dataflow-impls)
  visit_place(_place: Place, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::VisitAllocatedLocalsWith::visit_place");
  }
}

/// Visits locals that are implicitly freed by being evaluated as a bare-local
/// move operand or through a storage statement.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:66 VisitDeallocatedLocalsWith
export class VisitDeallocatedLocalsWith<F extends (local: Local, context: PlaceContext) => void> {
  constructor(public _0: F) {}

  // ---- impl Visitor for VisitDeallocatedLocalsWith ----

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:72 visit_statement (lane dataflow-impls)
  visit_statement(_statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::VisitDeallocatedLocalsWith::visit_statement");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:86 visit_operand (lane dataflow-impls)
  visit_operand(_operand: Operand, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::VisitDeallocatedLocalsWith::visit_operand");
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

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:120 compute (lane dataflow-impls)
  static compute(
    _tcx: TyCtxt,
    _body: Body,
    _pass_name: string | undefined,
    _points: DenseLocationMap,
    _kill_points: [Local, Location][],
  ): KillPoints {
    return unported("rustc_mir_dataflow::impls::precise_liveness::KillPoints::compute");
  }
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

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:173 visit_block_exit (lane dataflow-impls)
  override visit_block_exit(_state: DenseBitSet<Local>, _block: BasicBlock): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::KillPointsVisitor::visit_block_exit");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:180 visit_after_early_statement_effect (lane dataflow-impls)
  override visit_after_early_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::KillPointsVisitor::visit_after_early_statement_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:203 visit_after_early_terminator_effect (lane dataflow-impls)
  override visit_after_early_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::KillPointsVisitor::visit_after_early_terminator_effect");
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

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:249 apply_block_start_effect (lane dataflow-impls)
  apply_block_start_effect(_state: DenseBitSet<Local>, _block: BasicBlock): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::PreciseLiveness::apply_block_start_effect");
  }

  // ---- impl Analysis for PreciseLiveness ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "precise_liveness";

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:262 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::precise_liveness::PreciseLiveness::bottom_value");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:266 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::PreciseLiveness::initialize_start_block");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:273 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::PreciseLiveness::apply_primary_statement_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:295 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::PreciseLiveness::apply_primary_terminator_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:321 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(_state: DenseBitSet<Local>, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::PreciseLiveness::apply_call_return_effect");
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

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:363 new (lane dataflow-impls)
  new(_point: PointIndex, _effect: SplitPointEffect): SplitPointIndex {
    return unported("rustc_mir_dataflow::impls::precise_liveness::SplitPointIndex::new");
  },

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:368 point (lane dataflow-impls)
  point(_self: SplitPointIndex): PointIndex {
    return unported("rustc_mir_dataflow::impls::precise_liveness::SplitPointIndex::point");
  },

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:372 effect (lane dataflow-impls)
  effect(_self: SplitPointIndex): SplitPointEffect {
    return unported("rustc_mir_dataflow::impls::precise_liveness::SplitPointIndex::effect");
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

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:393 gen_ (lane dataflow-impls)
  gen_(_local: Local, _point: PointIndex, _effect: SplitPointEffect): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::MatrixBuilder::gen_");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:403 kill (lane dataflow-impls)
  kill(_local: Local, _point: PointIndex, _effect: SplitPointEffect): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::MatrixBuilder::kill");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:413 kill_all (lane dataflow-impls)
  kill_all(_point: PointIndex, _effect: SplitPointEffect): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::MatrixBuilder::kill_all");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:419 kill_all_except (lane dataflow-impls)
  kill_all_except(_except: Local, _point: PointIndex, _effect: SplitPointEffect): void {
    return unported("rustc_mir_dataflow::impls::precise_liveness::MatrixBuilder::kill_all_except");
  }
}

// stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:429 liveness_matrix (lane dataflow-impls)
export function liveness_matrix(
  _tcx: TyCtxt,
  _body: Body,
  _points: DenseLocationMap,
  _pass_name: string | undefined,
): SparseIntervalMatrix<Local, SplitPointIndex> {
  return unported("rustc_mir_dataflow::impls::precise_liveness::liveness_matrix");
}

// stub: compiler/rustc_mir_dataflow/src/impls/precise_liveness.rs:569 dump_liveness_matrix (lane dataflow-impls)
export function dump_liveness_matrix(
  _tcx: TyCtxt,
  _body: Body,
  _pass_name: string,
  _points: DenseLocationMap,
  _matrix: SparseIntervalMatrix<Local, SplitPointIndex>,
): void {
  return unported("rustc_mir_dataflow::impls::precise_liveness::dump_liveness_matrix");
}

/** Keeps the module-private declarations referenced for the fill lane. */
export const _precise_liveness_decls = { KillPoints, KillPointsVisitor, PreciseLiveness, MatrixBuilder };
