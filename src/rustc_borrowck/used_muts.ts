// Port of compiler/rustc_borrowck/src/used_muts.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `never_initialized_mut_locals: &'a mut FxIndexSet<Local>` is the shared (mutated) `Set`.
import type { Local, Location, Place, Statement, Terminator } from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import { unported } from "../std/panic.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";
export * from "./used_muts.gen.ts";

declare module "./lib.gen.ts" {
  interface MirBorrowckCtxt {
    // used_muts.rs:26 (lane bck-core)
    gather_used_muts(temporary_used_locals: Set<Local>, never_initialized_mut_locals: Set<Local>): void;
  }
}

/// Walks the MIR adding to the set of `used_mut` locals that will be ignored for the purposes
/// of the `unused_mut` lint.
///
/// `temporary_used_locals` should contain locals that were found to be temporary, mutable and
///  used from borrow checking. This function looks for assignments into these locals from
///  user-declared locals and adds those user-defined locals to the `used_mut` set. This can
///  occur due to a rare case involving upvars in closures.
///
/// `never_initialized_mut_locals` should contain the set of user-declared mutable locals
///  (not arguments) that have not already been marked as being used.
///  This function then looks for assignments from statements or the terminator into the locals
///  from this set and removes them from the set. This leaves only those locals that have not
///  been assigned to - this set is used as a proxy for locals that were not initialized due to
///  unreachable code. These locals are then considered "used" to silence the lint for them.
///  See #55344 for context.
// stub: compiler/rustc_borrowck/src/used_muts.rs:26 gather_used_muts (lane bck-core)
MirBorrowckCtxt.prototype.gather_used_muts = function (
  this: MirBorrowckCtxt,
  temporary_used_locals: Set<Local>,
  never_initialized_mut_locals: Set<Local>,
): void {
  return unported("rustc_borrowck::used_muts::MirBorrowckCtxt::gather_used_muts");
};

/// MIR visitor for collecting used mutable variables.
/// The 'visit lifetime represents the duration of the MIR walk.
// rustc-type: compiler/rustc_borrowck/src/used_muts.rs:49 GatherUsedMutsVisitor
export class GatherUsedMutsVisitor extends Visitor {
  constructor(
    public temporary_used_locals: Set<Local>,
    public never_initialized_mut_locals: Set<Local>,
    public mbcx: MirBorrowckCtxt,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/used_muts.rs:56 remove_never_initialized_mut_locals (lane bck-core)
  remove_never_initialized_mut_locals(into: Place): void {
    return unported("rustc_borrowck::used_muts::GatherUsedMutsVisitor::remove_never_initialized_mut_locals");
  }

  // impl<'tcx> Visitor<'tcx> for GatherUsedMutsVisitor<'_, '_, '_, 'tcx>
  // stub: compiler/rustc_borrowck/src/used_muts.rs:68 visit_terminator (lane bck-core)
  override visit_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_borrowck::used_muts::GatherUsedMutsVisitor::visit_terminator");
  }

  // stub: compiler/rustc_borrowck/src/used_muts.rs:80 visit_statement (lane bck-core)
  override visit_statement(statement: Statement, location: Location): void {
    return unported("rustc_borrowck::used_muts::GatherUsedMutsVisitor::visit_statement");
  }

  // stub: compiler/rustc_borrowck/src/used_muts.rs:93 visit_local (lane bck-core)
  override visit_local(local: Local, place_context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::used_muts::GatherUsedMutsVisitor::visit_local");
  }
}
