// Port of compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `BTreeSet<Location>` is a `Set<Location>` whose users iterate it in key order (lib.ts header).
import type { Body, Local, Location } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import { unported } from "../../std/panic.ts";

export * from "./find_all_local_uses.gen.ts";

/// Find all uses of (including assignments to) a [`Local`].
///
/// Uses `BTreeSet` so output is deterministic.
// stub: compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs:9 find (lane bck-diag-c)
export function find(body: Body, local: Local): Set<Location> {
  return unported("rustc_borrowck::diagnostics::find_all_local_uses::find");
}

// rustc-type: compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs:15 AllLocalUsesVisitor
export class AllLocalUsesVisitor extends Visitor {
  constructor(
    public for_local: Local,
    public uses: Set<Location>,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for AllLocalUsesVisitor
  // stub: compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs:21 visit_local (lane bck-diag-c)
  override visit_local(local: Local, _context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::diagnostics::find_all_local_uses::AllLocalUsesVisitor::visit_local");
  }
}
