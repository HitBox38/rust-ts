// Port of compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `BTreeSet<Location>` is a `KeyedSet<Location>` (keyed by the derived `Eq`); `find` returns it in `Location`'s
// derived `Ord` order (block, then statement index), since `visit_body` reaches some places (var debug info) after the
// blocks.
import type { Body, Local, Location } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { Location_key } from "../borrow_set.ts";

export * from "./find_all_local_uses.gen.ts";

/// Find all uses of (including assignments to) a [`Local`].
///
/// Uses `BTreeSet` so output is deterministic.
// rustc: compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs:9 find
export function find(body: Body, local: Local): Set<Location> {
  const visitor = new AllLocalUsesVisitor(local, new KeyedSet<Location>(Location_key));
  visitor.visit_body(body);
  // PORT: `BTreeSet` iteration order.
  return new KeyedSet<Location>(
    Location_key,
    [...visitor.uses].sort((a, b) => Location_key(a) - Location_key(b)),
  );
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
  // rustc: compiler/rustc_borrowck/src/diagnostics/find_all_local_uses.rs:21 visit_local
  override visit_local(local: Local, _context: PlaceContext, location: Location): void {
    if (local === this.for_local) {
      this.uses.add(location);
    }
  }
}
