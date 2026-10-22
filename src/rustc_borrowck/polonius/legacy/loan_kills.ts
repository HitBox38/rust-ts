// Port of compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs (lane borrowck-contract: declarations; fill lane
// bck-polonius-legacy, wave 26, plan-m4 D7).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LoanKillsGenerator` is a hand class extending mir/visit.ts's `Visitor`.
import type { Body, Local, Location, Place, Rvalue, Statement, Terminator } from "../../../rustc_middle/mir/mod.ts";
import { Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { unported } from "../../../std/panic.ts";
import type { BorrowSet } from "../../borrow_set.gen.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import type { PoloniusLocationTable } from "./location.gen.ts";

export * from "./loan_kills.gen.ts";

/// Emit `loan_killed_at` and `cfg_edge` facts at the same time.
// stub: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:14 emit_loan_kills (lane bck-polonius-legacy)
export function emit_loan_kills(tcx: TyCtxt, facts: PoloniusFacts, body: Body, location_table: PoloniusLocationTable, borrow_set: BorrowSet): void {
  return unported("rustc_borrowck::polonius::legacy::loan_kills::emit_loan_kills");
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
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:36 visit_statement (lane bck-polonius-legacy)
  override visit_statement(statement: Statement, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_kills::LoanKillsGenerator::visit_statement");
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:56 visit_assign (lane bck-polonius-legacy)
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_kills::LoanKillsGenerator::visit_assign");
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:63 visit_terminator (lane bck-polonius-legacy)
  override visit_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_kills::LoanKillsGenerator::visit_terminator");
  }

  /// Records the borrows on the specified place as `killed`. For example, when assigning to a
  /// local, or on a call's return destination.
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:92 record_killed_borrows_for_place (lane bck-polonius-legacy)
  record_killed_borrows_for_place(place: Place, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_kills::LoanKillsGenerator::record_killed_borrows_for_place");
  }

  /// When we encounter a `StorageDead` statement, we kill all the borrows
  /// of that local.
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_kills.rs:139 record_killed_borrows_for_local (lane bck-polonius-legacy)
  record_killed_borrows_for_local(local: Local, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_kills::LoanKillsGenerator::record_killed_borrows_for_local");
  }
}
