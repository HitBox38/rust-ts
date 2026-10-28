// Port of compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs (lane borrowck-contract: declarations; fill lane
// bck-polonius-legacy, wave 26, plan-m4 D7).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LoanKillsGenerator` is a hand class extending mir/visit.ts's `Visitor`.
import { BasicBlock, type Body, type Local, type Location, type Place, type Rvalue, type Statement, type Terminator } from "../../../rustc_middle/mir/mod.ts";
import { Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { BorrowSet } from "../../borrow_set.gen.ts";
import { PlaceConflictBias, places_conflict } from "../../places_conflict.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import type { PoloniusLocationTable } from "./location.gen.ts";

export * from "./loan_kills.gen.ts";

/// Emit `loan_killed_at` and `cfg_edge` facts at the same time.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:14 emit_loan_kills
export function emit_loan_kills(tcx: TyCtxt, facts: PoloniusFacts, body: Body, location_table: PoloniusLocationTable, borrow_set: BorrowSet): void {
  const visitor = new LoanKillsGenerator(tcx, facts, location_table, borrow_set, body);
  const blocks = body.basic_blocks.deref();
  for (let i = 0; i < blocks.length; i++) {
    visitor.visit_basic_block_data(BasicBlock.new(i), blocks[i]!);
  }
}

// rustc-type: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:27 LoanKillsGenerator
export class LoanKillsGenerator extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public facts: PoloniusFacts,
    public location_table: PoloniusLocationTable,
    public borrow_set: BorrowSet,
    public body: Body,
  ) {
    super();
  }

  // impl Visitor for LoanKillsGenerator
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:36 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    // Also record CFG facts here.
    this.facts.cfg_edge.push([this.location_table.start_index(location), this.location_table.mid_index(location)]);

    this.facts.cfg_edge.push([this.location_table.mid_index(location), this.location_table.start_index(location.successor_within_block())]);

    // If there are borrows on this now dead local, we need to record them as `killed`.
    if (statement.kind.$ === "StorageDead") {
      const local = statement.kind._0;
      this.record_killed_borrows_for_local(local, location);
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:56 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    // When we see `X = ...`, then kill borrows of
    // `(*X).foo` and so forth.
    this.record_killed_borrows_for_place(place, location);
    this.super_assign(place, rvalue, location);
  }

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:63 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // Also record CFG facts here.
    this.facts.cfg_edge.push([this.location_table.start_index(location), this.location_table.mid_index(location)]);

    const successor_blocks = terminator.successors();
    // PORT: `self.facts.cfg_edge.reserve(successor_blocks.size_hint().0)` (capacity only).
    for (const successor_block of successor_blocks) {
      this.facts.cfg_edge.push([this.location_table.mid_index(location), this.location_table.start_index(BasicBlock.start_location(successor_block))]);
    }

    // A `Call` terminator's return value can be a local which has borrows,
    // so we need to record those as `killed` as well.
    if (terminator.kind.$ === "Call") {
      const destination = terminator.kind.destination;
      this.record_killed_borrows_for_place(destination, location);
    }

    this.super_terminator(terminator, location);
  }

  // impl LoanKillsGenerator
  /// Records the borrows on the specified place as `killed`. For example, when assigning to a
  /// local, or on a call's return destination.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:92 record_killed_borrows_for_place
  record_killed_borrows_for_place(place: Place, location: Location): void {
    // Depending on the `Place` we're killing:
    // - if it's a local, or a single deref of a local,
    //   we kill all the borrows on the local.
    // - if it's a deeper projection, we have to filter which
    //   of the borrows are killed: the ones whose `borrowed_place`
    //   conflicts with the `place`.
    const { local, projection } = place.as_ref();
    if (projection.length === 0 || (projection.length === 1 && projection[0]!.$ === "Deref")) {
      // debug!(
      //     "Recording `killed` facts for borrows of local={:?} at location={:?}",
      //     local, location
      // );

      this.record_killed_borrows_for_local(local, location);
    } else {
      // Kill conflicting borrows of the innermost local.
      // debug!(
      //     "Recording `killed` facts for borrows of \
      //             innermost projected local={:?} at location={:?}",
      //     local, location
      // );

      const borrow_indices = this.borrow_set.borrows_on_local(local);
      if (borrow_indices !== undefined) {
        for (const borrow_index of borrow_indices) {
          const places_conflict_ = places_conflict(
            this.tcx,
            this.body,
            this.borrow_set.index(borrow_index).borrowed_place,
            place,
            PlaceConflictBias.NoOverlap,
          );

          if (places_conflict_) {
            const location_index = this.location_table.mid_index(location);
            this.facts.loan_killed_at.push([borrow_index, location_index]);
          }
        }
      }
    }
  }

  /// Records the borrows on the specified local as `killed`.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:139 record_killed_borrows_for_local
  record_killed_borrows_for_local(local: Local, location: Location): void {
    const borrow_indices = this.borrow_set.borrows_on_local(local);
    if (borrow_indices !== undefined) {
      const location_index = this.location_table.mid_index(location);
      // PORT: `self.facts.loan_killed_at.reserve(borrow_indices.len())` (capacity only).
      for (const borrow_index of borrow_indices) {
        this.facts.loan_killed_at.push([borrow_index, location_index]);
      }
    }
  }
}
