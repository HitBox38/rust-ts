// Port of compiler/rustc_borrowck/src/polonius/legacy/location.rs (lane borrowck-contract: declarations; fill lane bck-nll
// (main path: `PoloniusLocationTable::new` runs for every body), plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LocationIndex::is_start` (a `newtype_index!` method) lives on the companion (`LocationIndex_methods`);
// `impl Iterator<Item = LocationIndex>` is `Iterable<LocationIndex>`.
import { BasicBlock, type Body, Location } from "../../../rustc_middle/mir/mod.ts";
import { panic } from "../../../std/panic.ts";
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

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:34 new
(PoloniusLocationTable as unknown as { new: typeof PoloniusLocationTable.new }).new = function (body: Body): PoloniusLocationTable {
  let num_points = 0;
  const statements_before_block: number[] = body.basic_blocks.deref().map((block_data) => {
    const v = num_points;
    num_points += (block_data.statements.length + 1) * 2;
    return v;
  });

  // debug!("PoloniusLocationTable(statements_before_block={:#?})", statements_before_block);
  // debug!("PoloniusLocationTable: num_points={:#?}", num_points);

  return new PoloniusLocationTable(num_points, statements_before_block);
};

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:52 all_points
PoloniusLocationTable.prototype.all_points = function* (this: PoloniusLocationTable): Iterable<LocationIndex> {
  for (let i = 0; i < this.num_points; i++) yield LocationIndex.from_usize(i);
};

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:56 start_index
PoloniusLocationTable.prototype.start_index = function (this: PoloniusLocationTable, location: Location): LocationIndex {
  const { block, statement_index } = location;
  const start_index = this.statements_before_block[block]!;
  return LocationIndex.from_usize(start_index + statement_index * 2);
};

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:62 mid_index
PoloniusLocationTable.prototype.mid_index = function (this: PoloniusLocationTable, location: Location): LocationIndex {
  const { block, statement_index } = location;
  const start_index = this.statements_before_block[block]!;
  return LocationIndex.from_usize(start_index + statement_index * 2 + 1);
};

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:68 to_rich_location
PoloniusLocationTable.prototype.to_rich_location = function (this: PoloniusLocationTable, index: LocationIndex): RichLocation {
  const point_index = LocationIndex.index(index);

  // Find the basic block. We have a vector with the
  // starting index of the statement in each block. Imagine
  // we have statement #22, and we have a vector like:
  //
  // [0, 10, 20]
  //
  // In that case, this represents point_index 2 of
  // basic block BB2. We know this because BB0 accounts for
  // 0..10, BB1 accounts for 11..20, and BB2 accounts for
  // 20...
  //
  // To compute this, we could do a binary search, but
  // because I am lazy we instead iterate through to find
  // the last point where the "first index" (0, 10, or 20)
  // was less than the statement index (22). In our case, this will
  // be (BB2, 20).
  let found: [BasicBlock, number] | undefined;
  for (let i = this.statements_before_block.length - 1; i >= 0; i--) {
    const first_index = this.statements_before_block[i]!;
    if (first_index <= point_index) {
      found = [BasicBlock.from_usize(i), first_index];
      break;
    }
  }
  if (found === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const [block, first_index] = found;

  const statement_index = Math.floor((point_index - first_index) / 2);
  if (LocationIndex.is_start(index)) {
    return { $: "Start", _0: new Location(block, statement_index) };
  } else {
    return { $: "Mid", _0: new Location(block, statement_index) };
  }
};

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:101 to_location
PoloniusLocationTable.prototype.to_location = function (this: PoloniusLocationTable, index: LocationIndex): Location {
  const r = this.to_rich_location(index);
  switch (r.$) {
    case "Start":
      return r._0;
    case "Mid":
      return r._0;
  }
};

// rustc: compiler/rustc_borrowck/src/polonius/legacy/location.rs:110 is_start
LocationIndex.is_start = function (self: LocationIndex): boolean {
  // even indices are start points; odd indices are mid points
  return LocationIndex.index(self) % 2 === 0;
};
