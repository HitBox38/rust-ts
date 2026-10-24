// Port of compiler/rustc_borrowck/src/dataflow.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Borrowck` and `Borrows` implement `rustc_mir_dataflow::Analysis`: hand classes extending `AnalysisBase`
// (dataflow-contract D5); `type Domain` / `const NAME` are the `Domain` descriptor / `NAME` members.
// PORT: `impl JoinSemiLattice for BorrowckDomain` is the impl table `JoinSemiLattice_BorrowckDomain`; its `eq` is the
// derived `PartialEq` (`BorrowckDomain_eq`). `Clone_BorrowckDomain` is the derived `Clone` (`clone_from` copies each
// field in place: domains are changed in place, dataflow-contract decision 4). `impl<C> DebugWithContext<C> for
// BorrowIndex {}` (only provided methods) is `DebugWithContext_BorrowIndex`.
// PORT: `FxIndexMap<Location, Vec<BorrowIndex>>` (`borrows_out_of_scope_at_location`, `loans_out_of_scope_at_location`)
// is a `KeyedMap` keyed by borrow_set.ts's `Location_key`; `.entry(loc).or_default().push(i)` gets-or-inserts `[]`.
// `state.kill_all(..)` / `state.gen_(..)` on the `MixedBitSet` domain go through `GenKill_MixedBitSet<BorrowIndex>()`.
import { KeyedMap } from "../rust_ts/keyed.ts";
import { DenseBitSet, DenseBitSet_eq, MixedBitSet, MixedBitSet_eq } from "../rustc_index/bit_set.ts";
import { type BasicBlock, type Body, type CallReturnPlaces, debug_Location, Location, type Place, type Statement, type Terminator } from "../rustc_middle/mir/mod.ts";
import { Place_from_Local } from "../rustc_middle/mir/statement.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DebugWithContext_impl } from "../rustc_mir_dataflow/framework/fmt.ts";
import type { JoinSemiLattice } from "../rustc_mir_dataflow/framework/lattice.ts";
import { AnalysisBase, type Clone, type Domain, Domain_MixedBitSet, Domain_of, GenKill_MixedBitSet } from "../rustc_mir_dataflow/framework/mod.ts";
import type { EverInitializedPlaces, MaybeUninitializedPlaces } from "../rustc_mir_dataflow/impls/mod.ts";
import { config } from "../rustc_session/lib.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { assert, panic, unreachable } from "../std/panic.ts";
import { PLAIN } from "../std/fmt.ts";
import type { BorrowSet } from "./borrow_set.gen.ts";
import { Location_key } from "./borrow_set.ts";
import { places_conflict } from "./places_conflict.ts";
import {
  type BorrowckDomain,
  BorrowIndex,
  type BorrowsDomain,
  clone_BorrowckDomain,
  debug_BorrowckDomain,
  debug_BorrowIndex,
  OutOfScopePrecomputer,
  PoloniusOutOfScopePrecomputer,
} from "./dataflow.gen.ts";
import type { RegionInferenceContext } from "./region_infer/region_context.gen.ts";
export * from "./dataflow.gen.ts";

/** `impl<C> DebugWithContext<C> for BorrowIndex {}` (dataflow.rs:571): the provided methods only. */
export const DebugWithContext_BorrowIndex = DebugWithContext_impl<BorrowIndex, unknown>((a, b) => a === b, debug_BorrowIndex);

/** The derived `PartialEq` of `BorrowckDomain`. */
export function BorrowckDomain_eq(a: BorrowckDomain, b: BorrowckDomain): boolean {
  return MixedBitSet_eq(a.borrows, b.borrows) && MixedBitSet_eq(a.uninits, b.uninits) && DenseBitSet_eq(a.ever_inits, b.ever_inits);
}

/** The derived `Clone` of `BorrowckDomain`. */
export const Clone_BorrowckDomain: Clone<BorrowckDomain> = {
  clone: clone_BorrowckDomain,
  clone_from(self: BorrowckDomain, source: BorrowckDomain): void {
    MixedBitSet.clone_from(self.borrows, source.borrows);
    MixedBitSet.clone_from(self.uninits, source.uninits);
    self.ever_inits.clone_from(source.ever_inits);
  },
};

// rustc-type: compiler/rustc_borrowck/src/dataflow.rs:19 Borrowck
/// The results of the dataflow analyses used by the borrow checker.
export class Borrowck extends AnalysisBase<BorrowckDomain> {
  constructor(
    public borrows: Borrows,
    public uninits: MaybeUninitializedPlaces,
    public ever_inits: EverInitializedPlaces,
  ) {
    super();
  }

  // impl<'a, 'tcx> Analysis<'tcx> for Borrowck<'a, 'tcx>
  // type Domain = BorrowckDomain;
  readonly Domain: Domain<BorrowckDomain> = Domain_of(
    Clone_BorrowckDomain,
    JoinSemiLattice_BorrowckDomain,
    DebugWithContext_impl<BorrowckDomain, unknown>(BorrowckDomain_eq, debug_BorrowckDomain),
  );

  readonly NAME = "borrowck";

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:30 bottom_value
  bottom_value(body: Body): BorrowckDomain {
    return {
      borrows: this.borrows.bottom_value(body),
      uninits: this.uninits.bottom_value(body),
      ever_inits: this.ever_inits.bottom_value(body),
    };
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:38 initialize_start_block
  initialize_start_block(_body: Body, _state: BorrowckDomain): void {
    // This is only reachable from `iterate_to_fixpoint`, which this analysis doesn't use.
    return unreachable();
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:43 apply_early_statement_effect
  override apply_early_statement_effect(state: BorrowckDomain, stmt: Statement, loc: Location): void {
    this.borrows.apply_early_statement_effect(state.borrows, stmt, loc);
    this.uninits.apply_early_statement_effect(state.uninits, stmt, loc);
    this.ever_inits.apply_early_statement_effect(state.ever_inits, stmt, loc);
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:54 apply_primary_statement_effect
  apply_primary_statement_effect(state: BorrowckDomain, stmt: Statement, loc: Location): void {
    this.borrows.apply_primary_statement_effect(state.borrows, stmt, loc);
    this.uninits.apply_primary_statement_effect(state.uninits, stmt, loc);
    this.ever_inits.apply_primary_statement_effect(state.ever_inits, stmt, loc);
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:65 apply_early_terminator_effect
  override apply_early_terminator_effect(state: BorrowckDomain, term: Terminator, loc: Location): void {
    this.borrows.apply_early_terminator_effect(state.borrows, term, loc);
    this.uninits.apply_early_terminator_effect(state.uninits, term, loc);
    this.ever_inits.apply_early_terminator_effect(state.ever_inits, term, loc);
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:76 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: BorrowckDomain, term: Terminator, loc: Location): void {
    this.borrows.apply_primary_terminator_effect(state.borrows, term, loc);
    this.uninits.apply_primary_terminator_effect(state.uninits, term, loc);
    this.ever_inits.apply_primary_terminator_effect(state.ever_inits, term, loc);
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:87 apply_call_return_effect
  override apply_call_return_effect(_state: BorrowckDomain, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    // This is only reachable from `iterate_to_fixpoint`, which this analysis doesn't use.
    return unreachable();
  }
}

// impl JoinSemiLattice for BorrowckDomain
export const JoinSemiLattice_BorrowckDomain: JoinSemiLattice<BorrowckDomain> = {
  eq: BorrowckDomain_eq,
  // rustc: compiler/rustc_borrowck/src/dataflow.rs:99 join
  join(self: BorrowckDomain, _other: BorrowckDomain): boolean {
    // This is only reachable from `iterate_to_fixpoint`, which this analysis doesn't use.
    return unreachable();
  },
};

declare module "./dataflow.gen.ts" {
  interface OutOfScopePrecomputer {
    // dataflow.rs:163
    precompute_borrows_out_of_scope(borrow_index: BorrowIndex, borrow_region: RegionVid, first_location: Location): void;
  }
  namespace OutOfScopePrecomputer {
    // dataflow.rs:142
    function compute(body: Body, regioncx: RegionInferenceContext, borrow_set: BorrowSet): Map<Location, BorrowIndex[]>;
  }
  interface PoloniusOutOfScopePrecomputer {
    // dataflow.rs:281
    precompute_loans_out_of_scope(loan_idx: BorrowIndex, loan_issued_at: Location): void;
    // dataflow.rs:341
    loan_kill_location(loan_idx: BorrowIndex, loan_issued_at: Location, block: BasicBlock, start: number, end: number): Location | undefined;
  }
  namespace PoloniusOutOfScopePrecomputer {
    // dataflow.rs:256
    function compute(body: Body, regioncx: RegionInferenceContext, borrow_set: BorrowSet): Map<Location, BorrowIndex[]>;
  }
}

// rustc: compiler/rustc_borrowck/src/dataflow.rs:142 compute
(OutOfScopePrecomputer as unknown as { compute: typeof OutOfScopePrecomputer.compute }).compute = function (
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
): Map<Location, BorrowIndex[]> {
  const prec = new OutOfScopePrecomputer(
    DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length),
    [],
    body,
    regioncx,
    new KeyedMap<Location, BorrowIndex[]>(Location_key),
  );
  for (const [borrow_index, borrow_data] of borrow_set.iter_enumerated()) {
    const borrow_region = borrow_data.region;
    const location = borrow_data.reserve_location;
    prec.precompute_borrows_out_of_scope(borrow_index, borrow_region, location);
  }

  return prec.borrows_out_of_scope_at_location;
};

// rustc: compiler/rustc_borrowck/src/dataflow.rs:163 precompute_borrows_out_of_scope
OutOfScopePrecomputer.prototype.precompute_borrows_out_of_scope = function (
  this: OutOfScopePrecomputer,
  borrow_index: BorrowIndex,
  borrow_region: RegionVid,
  first_location: Location,
): void {
  const first_block = first_location.block;
  const first_bb_data = this.body.basic_blocks.deref()[first_block]!;

  // This is the first block, we only want to visit it from the creation of the borrow at
  // `first_location`.
  const first_lo = first_location.statement_index;
  const first_hi = first_bb_data.statements.length;

  const kill_stmt = this.regioncx.first_non_contained_inclusive(borrow_region, first_block, first_lo, first_hi);
  if (kill_stmt !== undefined) {
    const kill_location = new Location(first_block, kill_stmt);
    // If region does not contain a point at the location, then add to list and skip
    // successor locations.
    // debug!("borrow {:?} gets killed at {:?}", borrow_index, kill_location);
    entry_or_default(this.borrows_out_of_scope_at_location, kill_location).push(borrow_index);

    // The borrow is already dead, there is no need to visit other blocks.
    return;
  }

  // The borrow is not dead. Add successor BBs to the work list, if necessary.
  for (const succ_bb of first_bb_data.terminator_().successors()) {
    if (this.visited.insert(succ_bb)) {
      this.visit_stack.push(succ_bb);
    }
  }

  // We may end up visiting `first_block` again. This is not an issue: we know at this point
  // that it does not kill the borrow in the `first_lo..=first_hi` range, so checking the
  // `0..first_lo` range and the `0..first_hi` range give the same result.
  let block: BasicBlock | undefined;
  while ((block = this.visit_stack.pop()) !== undefined) {
    const bb_data = this.body.index(block);
    const num_stmts = bb_data.statements.length;
    const kill_stmt = this.regioncx.first_non_contained_inclusive(borrow_region, block, 0, num_stmts);
    if (kill_stmt !== undefined) {
      const kill_location = new Location(block, kill_stmt);
      // If region does not contain a point at the location, then add to list and skip
      // successor locations.
      // debug!("borrow {:?} gets killed at {:?}", borrow_index, kill_location);
      entry_or_default(this.borrows_out_of_scope_at_location, kill_location).push(borrow_index);

      // We killed the borrow, so we do not visit this block's successors.
      continue;
    }

    // Add successor BBs to the work list, if necessary.
    for (const succ_bb of bb_data.terminator_().successors()) {
      if (this.visited.insert(succ_bb)) {
        this.visit_stack.push(succ_bb);
      }
    }
  }

  this.visited.clear();
};

// This is `pub` because it's used by unstable external borrowck data users, see `consumers.rs`.
// rustc: compiler/rustc_borrowck/src/dataflow.rs:238 calculate_borrows_out_of_scope_at_location
export function calculate_borrows_out_of_scope_at_location(
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
): Map<Location, BorrowIndex[]> {
  return OutOfScopePrecomputer.compute(body, regioncx, borrow_set);
}

// rustc: compiler/rustc_borrowck/src/dataflow.rs:256 compute
(PoloniusOutOfScopePrecomputer as unknown as { compute: typeof PoloniusOutOfScopePrecomputer.compute }).compute = function (
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
): Map<Location, BorrowIndex[]> {
  // The in-tree polonius analysis computes loans going out of scope using the
  // set-of-loans model.
  const prec = new PoloniusOutOfScopePrecomputer(
    DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length),
    [],
    body,
    regioncx,
    new KeyedMap<Location, BorrowIndex[]>(Location_key),
  );
  for (const [loan_idx, loan_data] of borrow_set.iter_enumerated()) {
    const loan_issued_at = loan_data.reserve_location;
    prec.precompute_loans_out_of_scope(loan_idx, loan_issued_at);
  }

  return prec.loans_out_of_scope_at_location;
};

/// Loans are in scope while they are live: whether they are contained within any live region.
/// In the location-insensitive analysis, a loan will be contained in a region if the issuing
/// region can reach it in the subset graph. So this is a reachability problem.
// rustc: compiler/rustc_borrowck/src/dataflow.rs:281 precompute_loans_out_of_scope
PoloniusOutOfScopePrecomputer.prototype.precompute_loans_out_of_scope = function (
  this: PoloniusOutOfScopePrecomputer,
  loan_idx: BorrowIndex,
  loan_issued_at: Location,
): void {
  const first_block = loan_issued_at.block;
  const first_bb_data = this.body.basic_blocks.deref()[first_block]!;

  // The first block we visit is the one where the loan is issued, starting from the statement
  // where the loan is issued: at `loan_issued_at`.
  const first_lo = loan_issued_at.statement_index;
  const first_hi = first_bb_data.statements.length;

  const kill_location = this.loan_kill_location(loan_idx, loan_issued_at, first_block, first_lo, first_hi);
  if (kill_location !== undefined) {
    // debug!("loan {:?} gets killed at {:?}", loan_idx, kill_location);
    entry_or_default(this.loans_out_of_scope_at_location, kill_location).push(loan_idx);

    // The loan dies within the first block, we're done and can early return.
    return;
  }

  // The loan is not dead. Add successor BBs to the work list, if necessary.
  for (const succ_bb of first_bb_data.terminator_().successors()) {
    if (this.visited.insert(succ_bb)) {
      this.visit_stack.push(succ_bb);
    }
  }

  // We may end up visiting `first_block` again. This is not an issue: we know at this point
  // that the loan is not killed in the `first_lo..=first_hi` range, so checking the
  // `0..first_lo` range and the `0..first_hi` range gives the same result.
  let block: BasicBlock | undefined;
  while ((block = this.visit_stack.pop()) !== undefined) {
    const bb_data = this.body.index(block);
    const num_stmts = bb_data.statements.length;
    const kill_location = this.loan_kill_location(loan_idx, loan_issued_at, block, 0, num_stmts);
    if (kill_location !== undefined) {
      // debug!("loan {:?} gets killed at {:?}", loan_idx, kill_location);
      entry_or_default(this.loans_out_of_scope_at_location, kill_location).push(loan_idx);

      // The loan dies within this block, so we don't need to visit its successors.
      continue;
    }

    // Add successor BBs to the work list, if necessary.
    for (const succ_bb of bb_data.terminator_().successors()) {
      if (this.visited.insert(succ_bb)) {
        this.visit_stack.push(succ_bb);
      }
    }
  }

  this.visited.clear();
  assert(this.visit_stack.length === 0, "visit stack should be empty");
};

/// Returns the lowest statement in `start..=end`, where the loan goes out of scope, if any.
/// This is the statement where the issuing region can't reach any of the regions that are live
/// at this point.
// rustc: compiler/rustc_borrowck/src/dataflow.rs:341 loan_kill_location
PoloniusOutOfScopePrecomputer.prototype.loan_kill_location = function (
  this: PoloniusOutOfScopePrecomputer,
  loan_idx: BorrowIndex,
  loan_issued_at: Location,
  block: BasicBlock,
  start: number,
  end: number,
): Location | undefined {
  for (let statement_index = start; statement_index <= end; statement_index++) {
    const location = new Location(block, statement_index);

    // Check whether the issuing region can reach local regions that are live at this point:
    // - a loan is always live at its issuing location because it can reach the issuing
    // region, which is always live at this location.
    if (location.block === loan_issued_at.block && location.statement_index === loan_issued_at.statement_index) {
      continue;
    }

    // - the loan goes out of scope at `location` if it's not contained within any regions
    // live at this point.
    //
    // FIXME: if the issuing region `i` can reach a live region `r` at point `p`, and `r` is
    // live at point `q`, then it's guaranteed that `i` would reach `r` at point `q`.
    // Reachability is location-insensitive, and we could take advantage of that, by jumping
    // to a further point than just the next statement: we can jump to the furthest point
    // within the block where `r` is live.
    if (this.regioncx.is_loan_live_at(loan_idx, location)) {
      continue;
    }

    // No live region is reachable from the issuing region: the loan is killed at this
    // point.
    return location;
  }

  return undefined;
};

// rustc-type: compiler/rustc_borrowck/src/dataflow.rs:126 Borrows
/// `Borrows` stores the data used in the analyses that track the flow
/// of borrows.
///
/// It uniquely identifies every borrow (`Rvalue::Ref`) by a
/// `BorrowIndex`, and maps each such index to a `BorrowData`
/// describing the borrow. These indexes are used for representing the
/// borrows in compact bitvectors.
export class Borrows extends AnalysisBase<BorrowsDomain> {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public borrow_set: BorrowSet,
    public borrows_out_of_scope_at_location: Map<Location, BorrowIndex[]>,
  ) {
    super();
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:381 new
  static new(tcx: TyCtxt, body: Body, regioncx: RegionInferenceContext, borrow_set: BorrowSet): Borrows {
    const borrows_out_of_scope_at_location = !config.Polonius.is_next_enabled(tcx.sess.opts.unstable_opts.polonius)
      ? calculate_borrows_out_of_scope_at_location(body, regioncx, borrow_set)
      : PoloniusOutOfScopePrecomputer.compute(body, regioncx, borrow_set);
    return new Borrows(tcx, body, borrow_set, borrows_out_of_scope_at_location);
  }

  /// Add all borrows to the kill set, if those borrows are out of scope at `location`.
  /// That means they went out of a nonlexical scope
  // rustc: compiler/rustc_borrowck/src/dataflow.rs:398 kill_loans_out_of_scope_at_location
  kill_loans_out_of_scope_at_location(state: BorrowsDomain, location: Location): void {
    // NOTE: The state associated with a given `location`
    // reflects the dataflow on entry to the statement.
    // Iterate over each of the borrows that we've precomputed
    // to have went out of scope at this location and kill them.
    //
    // We are careful always to call this function *before* we
    // set up the gen-bits for the statement or
    // terminator. That way, if the effect of the statement or
    // terminator *does* introduce a new loan of the same
    // region, then setting that gen-bit will override any
    // potential kill introduced here.
    const indices = this.borrows_out_of_scope_at_location.get(location);
    if (indices !== undefined) {
      GenKill_MixedBitSet<BorrowIndex>().kill_all(state, indices);
    }
  }

  /// Kill any borrows that conflict with `place`.
  // rustc: compiler/rustc_borrowck/src/dataflow.rs:420 kill_borrows_on_place
  kill_borrows_on_place(state: BorrowsDomain, place: Place): void {
    // debug!("kill_borrows_on_place: place={:?}", place);

    const other_borrows_of_local: Iterable<BorrowIndex> = this.borrow_set.borrows_on_local(place.local) ?? [];

    // If the borrowed place is a local with no projections, all other borrows of this
    // local must conflict. This is purely an optimization so we don't have to call
    // `places_conflict` for every borrow.
    if (place.projection.length === 0) {
      if (!this.body.local_decls[place.local]!.is_ref_to_static()) {
        GenKill_MixedBitSet<BorrowIndex>().kill_all(state, other_borrows_of_local);
      }
      return;
    }

    // By passing `PlaceConflictBias::NoOverlap`, we conservatively assume that any given
    // pair of array indices are not equal, so that when `places_conflict` returns true, we
    // will be assured that two places being compared definitely denotes the same sets of
    // locations.
    const definitely_conflicting_borrows = filter_iter(other_borrows_of_local, (i) =>
      places_conflict(this.tcx, this.body, this.borrow_set.index(i).borrowed_place, place, "NoOverlap"),
    );

    GenKill_MixedBitSet<BorrowIndex>().kill_all(state, definitely_conflicting_borrows);
  }

  // impl<'tcx> rustc_mir_dataflow::Analysis<'tcx> for Borrows<'_, 'tcx>
  // type Domain = BorrowsDomain;
  readonly Domain: Domain<BorrowsDomain> = Domain_MixedBitSet(DebugWithContext_BorrowIndex);

  readonly NAME = "borrows";

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:475 bottom_value
  bottom_value(_0: Body): BorrowsDomain {
    // bottom = nothing is reserved or activated yet;
    return MixedBitSet.new_empty<BorrowIndex>(this.borrow_set.len());
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:480 initialize_start_block
  initialize_start_block(_0: Body, _1: BorrowsDomain): void {
    // no borrows of code region_scopes have been taken prior to
    // function execution, so this method has no effect.
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:485 apply_early_statement_effect
  override apply_early_statement_effect(state: BorrowsDomain, _statement: Statement, location: Location): void {
    this.kill_loans_out_of_scope_at_location(state, location);
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:494 apply_primary_statement_effect
  apply_primary_statement_effect(state: BorrowsDomain, stmt: Statement, location: Location): void {
    const kind = stmt.kind;
    switch (kind.$) {
      case "Assign": {
        const [lhs, rhs] = kind._0;
        if (rhs.$ === "Ref" || rhs.$ === "Reborrow") {
          const place = rhs._2;
          if (place.ignore_borrow(this.tcx, this.body, this.borrow_set.locals_state_at_exit_())) {
            return;
          }
          const idxs = this.borrow_set.borrows_at_location(location) ?? panic(`could not find BorrowIndex for location ${debug_Location(location, PLAIN)}`);

          for (const index of idxs) {
            GenKill_MixedBitSet<BorrowIndex>().gen_(state, index);
          }
        }

        // Make sure there are no remaining borrows for variables
        // that are assigned over.
        this.kill_borrows_on_place(state, lhs);
        break;
      }

      case "StorageDead": {
        const local = kind._0;
        // Make sure there are no remaining borrows for locals that
        // are gone out of scope.
        this.kill_borrows_on_place(state, Place_from_Local(local));
        break;
      }

      case "FakeRead":
      case "SetDiscriminant":
      case "StorageLive":
      case "PlaceMention":
      case "AscribeUserType":
      case "Coverage":
      case "Intrinsic":
      case "ConstEvalCounter":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:544 apply_early_terminator_effect
  override apply_early_terminator_effect(state: BorrowsDomain, _terminator: Terminator, location: Location): void {
    this.kill_loans_out_of_scope_at_location(state, location);
  }

  // rustc: compiler/rustc_borrowck/src/dataflow.rs:553 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: BorrowsDomain, terminator: Terminator, _location: Location): void {
    if (terminator.kind.$ === "InlineAsm") {
      const operands = terminator.kind.operands;
      for (const op of operands) {
        if (op.$ === "Out" && op.place !== undefined) {
          this.kill_borrows_on_place(state, op.place);
        } else if (op.$ === "InOut" && op.out_place !== undefined) {
          this.kill_borrows_on_place(state, op.out_place);
        }
      }
    }
  }
}

/** PORT: `map.entry(loc).or_default()` of a `FxIndexMap<Location, Vec<BorrowIndex>>`. */
function entry_or_default(map: Map<Location, BorrowIndex[]>, loc: Location): BorrowIndex[] {
  let v = map.get(loc);
  if (v === undefined) map.set(loc, (v = []));
  return v;
}

/** PORT: `iter.filter(f)` (lazy, as upstream's iterator adapter). */
function* filter_iter<T>(it: Iterable<T>, f: (x: T) => boolean): Generator<T> {
  for (const x of it) if (f(x)) yield x;
}
