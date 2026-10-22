// Port of compiler/rustc_borrowck/src/polonius/legacy/accesses.rs (lane borrowck-contract: declarations; fill lane
// bck-polonius-legacy, wave 26, plan-m4 D7).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `AccessFactsExtractor` is a hand class extending mir/visit.ts's `Visitor`; `facts: &'a mut PoloniusFacts` is the
// shared facts value (`unknown` until vendor polonius-engine is ported).
import type { Body, Local, Location, Place } from "../../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { MoveData } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import { unported } from "../../../std/panic.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import type { LocationIndex, PoloniusLocationTable } from "./location.gen.ts";

export * from "./accesses.gen.ts";

/// Emit polonius facts for variable defs, uses, drops, and path accesses.
// stub: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:12 emit_access_facts (lane bck-polonius-legacy)
export function emit_access_facts(
  tcx: TyCtxt,
  facts: PoloniusFacts,
  body: Body,
  location_table: PoloniusLocationTable,
  move_data: MoveData,
  universal_regions: UniversalRegions,
): void {
  return unported("rustc_borrowck::polonius::legacy::accesses::emit_access_facts");
}

/// MIR visitor extracting point-wise facts about accesses.
// rustc-type: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:33 AccessFactsExtractor
export class AccessFactsExtractor extends Visitor {
  constructor(
    public facts: PoloniusFacts,
    public move_data: MoveData,
    public location_table: PoloniusLocationTable,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:40 location_to_index (lane bck-polonius-legacy)
  location_to_index(location: Location): LocationIndex {
    return unported("rustc_borrowck::polonius::legacy::accesses::AccessFactsExtractor::location_to_index");
  }

  // impl Visitor for AccessFactsExtractor
  // stub: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:46 visit_local (lane bck-polonius-legacy)
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::accesses::AccessFactsExtractor::visit_local");
  }

  // stub: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:64 visit_place (lane bck-polonius-legacy)
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::polonius::legacy::accesses::AccessFactsExtractor::visit_place");
  }
}
