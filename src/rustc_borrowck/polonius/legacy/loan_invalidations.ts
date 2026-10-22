// Port of compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs (lane borrowck-contract: declarations; fill
// lane bck-polonius-legacy, wave 26, plan-m4 D7).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LoanInvalidationsGenerator` is a hand class extending mir/visit.ts's `Visitor`.
import type { Dominators } from "../../../rustc_data_structures/graph/dominators/mod.ts";
import type { BasicBlock, Body, Location, Operand, Place, Rvalue, Statement, Terminator } from "../../../rustc_middle/mir/mod.ts";
import { Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { unported } from "../../../std/panic.ts";
import type { BorrowSet } from "../../borrow_set.gen.ts";
import type { BorrowIndex } from "../../dataflow.gen.ts";
import type { AccessDepth, LocalMutationIsAllowed, ReadOrWrite } from "../../lib.gen.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import type { PoloniusLocationTable } from "./location.gen.ts";

export * from "./loan_invalidations.gen.ts";

/// Emit `loan_invalidated_at` facts.
// stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:19 emit_loan_invalidations (lane bck-polonius-legacy)
export function emit_loan_invalidations(tcx: TyCtxt, facts: PoloniusFacts, body: Body, location_table: PoloniusLocationTable, borrow_set: BorrowSet): void {
  return unported("rustc_borrowck::polonius::legacy::loan_invalidations::emit_loan_invalidations");
}

// rustc-type: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:32 LoanInvalidationsGenerator
export class LoanInvalidationsGenerator extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public facts: PoloniusFacts,
    public body: Body,
    public location_table: PoloniusLocationTable,
    public dominators: Dominators<BasicBlock>,
    public borrow_set: BorrowSet,
  ) {
    super();
  }

  /// Visits the whole MIR and generates `invalidates()` facts.
  /// Most of the code implementing this was stolen from `borrow_check/mod.rs`.
  // impl Visitor for LoanInvalidationsGenerator
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:44 visit_statement (lane bck-polonius-legacy)
  override visit_statement(statement: Statement, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::visit_statement");
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:94 visit_terminator (lane bck-polonius-legacy)
  override visit_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::visit_terminator");
  }

  /// Simulates mutation of a place.
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:213 mutate_place (lane bck-polonius-legacy)
  mutate_place(location: Location, place: Place, kind: AccessDepth): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::mutate_place");
  }

  /// Simulates consumption of an operand.
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:223 consume_operand (lane bck-polonius-legacy)
  consume_operand(location: Location, operand: Operand): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::consume_operand");
  }

  // Simulates consumption of an rvalue
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:246 consume_rvalue (lane bck-polonius-legacy)
  consume_rvalue(location: Location, rvalue: Rvalue): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::consume_rvalue");
  }

  /// Simulates an access to a place.
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:339 access_place (lane bck-polonius-legacy)
  access_place(location: Location, place: Place, kind: [AccessDepth, ReadOrWrite], _is_local_mutation_allowed: LocalMutationIsAllowed): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::access_place");
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:351 check_access_for_conflict (lane bck-polonius-legacy)
  check_access_for_conflict(location: Location, place: Place, sd: AccessDepth, rw: ReadOrWrite): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::check_access_for_conflict");
  }

  /// Generates a new `loan_invalidated_at(L, B)` fact.
  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:417 emit_loan_invalidated_at (lane bck-polonius-legacy)
  emit_loan_invalidated_at(b: BorrowIndex, l: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::emit_loan_invalidated_at");
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:422 check_activations (lane bck-polonius-legacy)
  check_activations(location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::loan_invalidations::LoanInvalidationsGenerator::check_activations");
  }
}
