// Port of compiler/rustc_borrowck/src/polonius/legacy/accesses.rs (lane borrowck-contract: declarations; fill lane
// bck-polonius-legacy, wave 26, plan-m4 D7).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `AccessFactsExtractor` is a hand class extending mir/visit.ts's `Visitor`; `facts: &'a mut PoloniusFacts` is the
// shared facts value (vendor polonius-engine's `AllFacts`, changed in place).
import { type Body, Local, type Location, type Place } from "../../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { MoveData } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import { categorize } from "../../def_use.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import { PoloniusRegionVid_from_RegionVid } from "./facts.ts";
import type { LocationIndex, PoloniusLocationTable } from "./location.gen.ts";

export * from "./accesses.gen.ts";

/// Emit polonius facts for variable defs, uses, drops, and path accesses.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:12 emit_access_facts
export function emit_access_facts(
  tcx: TyCtxt,
  facts: PoloniusFacts,
  body: Body,
  location_table: PoloniusLocationTable,
  move_data: MoveData,
  universal_regions: UniversalRegions,
): void {
  const extractor = new AccessFactsExtractor(facts, move_data, location_table);
  extractor.visit_body(body);

  for (let i = 0; i < body.local_decls.length; i++) {
    const local = Local.new(i);
    const local_decl = body.local_decls[i]!;
    // debug!("add use_of_var_derefs_origin facts - local={:?}, type={:?}", local, local_decl.ty);
    tcx.for_each_free_region(
      local_decl.ty,
      (region) => {
        const region_vid = universal_regions.to_region_vid(region);
        facts.use_of_var_derefs_origin.push([local, PoloniusRegionVid_from_RegionVid(region_vid)]);
      },
      fold_Ty,
    );
  }
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

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:40 location_to_index
  location_to_index(location: Location): LocationIndex {
    return this.location_table.mid_index(location);
  }

  // impl Visitor for AccessFactsExtractor
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:46 visit_local
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    const r = categorize(context);
    switch (r) {
      case "Def":
        // debug!("AccessFactsExtractor - emit def");
        this.facts.var_defined_at.push([local, this.location_to_index(location)]);
        break;
      case "Use":
        // debug!("AccessFactsExtractor - emit use");
        this.facts.var_used_at.push([local, this.location_to_index(location)]);
        break;
      case "Drop":
        // debug!("AccessFactsExtractor - emit drop");
        this.facts.var_dropped_at.push([local, this.location_to_index(location)]);
        break;
      default:
        break;
    }
  }

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/accesses.rs:64 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    this.super_place(place, context, location);

    if (context.$ === "NonMutatingUse" || (context.$ === "MutatingUse" && context._0 === "Borrow")) {
      const r = this.move_data.rev_lookup.find(place.as_ref());
      let path;
      if (r.$ === "Exact") {
        path = r._0;
      } else if (r.$ === "Parent" && r._0 !== undefined) {
        path = r._0;
      } else {
        // There's no path access to emit.
        return;
      }
      // debug!("AccessFactsExtractor - emit path access ({path:?}, {location:?})");
      this.facts.path_accessed_at_base.push([path, this.location_to_index(location)]);
    }
  }
}
