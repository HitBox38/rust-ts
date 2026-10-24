// Port of compiler/rustc_borrowck/src/used_muts.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `never_initialized_mut_locals: &'a mut FxIndexSet<Local>` is the shared (mutated) `Set`.
import type { Local, Location, Place, Statement, Terminator } from "../rustc_middle/mir/mod.ts";
import { PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";
export * from "./used_muts.gen.ts";

declare module "./lib.gen.ts" {
  interface MirBorrowckCtxt {
    // used_muts.rs:26
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
// rustc: compiler/rustc_borrowck/src/used_muts.rs:26 gather_used_muts
MirBorrowckCtxt.prototype.gather_used_muts = function (
  this: MirBorrowckCtxt,
  temporary_used_locals: Set<Local>,
  never_initialized_mut_locals: Set<Local>,
): void {
  {
    const visitor = new GatherUsedMutsVisitor(temporary_used_locals, never_initialized_mut_locals, this);
    visitor.visit_body(visitor.mbcx.body);
  }

  // Take the union of the existed `used_mut` set with those variables we've found were
  // never initialized.
  // debug!("gather_used_muts: never_initialized_mut_locals={:?}", never_initialized_mut_locals);
  this.used_mut = new Set([...this.used_mut, ...never_initialized_mut_locals]);
};

/** PORT: `IndexSet::swap_remove` on an insertion-ordered JS `Set`: the last element takes the removed one's position. */
function index_set_swap_remove<T>(set: Set<T>, value: T): boolean {
  if (!set.has(value)) return false;
  const items = [...set];
  const idx = items.indexOf(value);
  const last = items.pop() as T;
  if (idx < items.length) items[idx] = last;
  set.clear();
  for (const x of items) set.add(x);
  return true;
}

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

  // rustc: compiler/rustc_borrowck/src/used_muts.rs:56 remove_never_initialized_mut_locals
  remove_never_initialized_mut_locals(into: Place): void {
    // Remove any locals that we found were initialized from the
    // `never_initialized_mut_locals` set. At the end, the only remaining locals will
    // be those that were never initialized - we will consider those as being used as
    // they will either have been removed by unreachable code optimizations; or linted
    // as unused variables.
    // FIXME(#120456) - is `swap_remove` correct?
    index_set_swap_remove(this.never_initialized_mut_locals, into.local);
  }

  // impl<'tcx> Visitor<'tcx> for GatherUsedMutsVisitor<'_, '_, '_, 'tcx>
  // rustc: compiler/rustc_borrowck/src/used_muts.rs:68 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // debug!("visit_terminator: terminator={:?}", terminator);
    switch (terminator.kind.$) {
      case "Call": {
        this.remove_never_initialized_mut_locals(terminator.kind.destination);
        break;
      }
      default:
        break;
    }

    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_borrowck/src/used_muts.rs:80 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    if (statement.kind.$ === "Assign") {
      const into = statement.kind._0[0];
      // debug!("visit_statement: statement={:?} local={:?} never_initialized_mut_locals={:?}", statement, into.local, self.never_initialized_mut_locals);
      this.remove_never_initialized_mut_locals(into);
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_borrowck/src/used_muts.rs:93 visit_local
  override visit_local(local: Local, place_context: PlaceContext, location: Location): void {
    if (PlaceContext.is_place_assignment(place_context) && this.temporary_used_locals.has(local)) {
      // Propagate the Local assigned at this Location as a used mutable local variable
      for (const moi of this.mbcx.move_data.move_out_loc_map.index(location)) {
        const mpi = this.mbcx.move_data.move_outs[moi]!.path;
        const path = this.mbcx.move_data.move_paths[mpi]!;
        // debug!("assignment of {:?} to {:?}, adding {:?} to used mutable set", path.place, local, path.place);
        const user_local = path.place.as_local();
        if (user_local !== undefined) {
          this.mbcx.used_mut.add(user_local);
        }
      }
    }
  }
}
