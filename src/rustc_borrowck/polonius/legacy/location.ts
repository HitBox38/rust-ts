// Port of compiler/rustc_borrowck/src/polonius/legacy/location.rs (lane borrowck-contract: declarations; fill lane bck-nll
// (main path: `PoloniusLocationTable::new` runs for every body), plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LocationIndex::is_start` (a `newtype_index!` method) lives on the companion (`LocationIndex_methods`);
// `impl Iterator<Item = LocationIndex>` is `Iterable<LocationIndex>`.
import type { Body, Location } from "../../../rustc_middle/mir/mod.ts";
import { unported } from "../../../std/panic.ts";
import * as gen from "./location.gen.ts";
import { PoloniusLocationTable, type RichLocation } from "./location.gen.ts";

export * from "./location.gen.ts";

declare module "./location.gen.ts" {
  interface PoloniusLocationTable {
    // location.rs:52 (lane bck-nll)
    all_points(): Iterable<LocationIndex>;
    // location.rs:56 (lane bck-nll)
    start_index(location: Location): LocationIndex;
    // location.rs:62 (lane bck-nll)
    mid_index(location: Location): LocationIndex;
    // location.rs:68 (lane bck-nll)
    to_rich_location(index: LocationIndex): RichLocation;
    // location.rs:101 (lane bck-nll)
    to_location(index: LocationIndex): Location;
  }
  namespace PoloniusLocationTable {
    // location.rs:34 (lane bck-nll)
    function new_(body: Body): PoloniusLocationTable;
    export { new_ as new };
  }
}

export interface LocationIndex_methods {
  // location.rs:110 (lane bck-nll)
  is_start(self: LocationIndex): boolean;
}
export type LocationIndex = gen.LocationIndex;
export const LocationIndex = gen.LocationIndex as typeof gen.LocationIndex & LocationIndex_methods;

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:34 new (lane bck-nll)
(PoloniusLocationTable as unknown as { new: typeof PoloniusLocationTable.new }).new = function (body: Body): PoloniusLocationTable {
  return unported("rustc_borrowck::polonius::legacy::location::PoloniusLocationTable::new");
};

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:52 all_points (lane bck-nll)
PoloniusLocationTable.prototype.all_points = function (this: PoloniusLocationTable): Iterable<LocationIndex> {
  return unported("rustc_borrowck::polonius::legacy::location::PoloniusLocationTable::all_points");
};

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:56 start_index (lane bck-nll)
PoloniusLocationTable.prototype.start_index = function (this: PoloniusLocationTable, location: Location): LocationIndex {
  return unported("rustc_borrowck::polonius::legacy::location::PoloniusLocationTable::start_index");
};

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:62 mid_index (lane bck-nll)
PoloniusLocationTable.prototype.mid_index = function (this: PoloniusLocationTable, location: Location): LocationIndex {
  return unported("rustc_borrowck::polonius::legacy::location::PoloniusLocationTable::mid_index");
};

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:68 to_rich_location (lane bck-nll)
PoloniusLocationTable.prototype.to_rich_location = function (this: PoloniusLocationTable, index: LocationIndex): RichLocation {
  return unported("rustc_borrowck::polonius::legacy::location::PoloniusLocationTable::to_rich_location");
};

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:101 to_location (lane bck-nll)
PoloniusLocationTable.prototype.to_location = function (this: PoloniusLocationTable, index: LocationIndex): Location {
  return unported("rustc_borrowck::polonius::legacy::location::PoloniusLocationTable::to_location");
};

// stub: compiler/rustc_borrowck/src/polonius/legacy/location.rs:110 is_start (lane bck-nll)
LocationIndex.is_start = function (self: LocationIndex): boolean {
  return unported("rustc_borrowck::polonius::legacy::location::LocationIndex::is_start");
};
