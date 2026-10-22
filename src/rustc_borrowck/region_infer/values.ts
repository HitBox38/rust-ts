// Port of compiler/rustc_borrowck/src/region_infer/values.rs (lane borrowck-contract: declarations; filled by lane bck-regions-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Rc<DenseLocationMap>` is the shared `DenseLocationMap`. `N: Idx` of `RegionValues<N>` is a branded number
// (`N extends number`; the generated class carries `N & number` in its field types).
// PORT: `LivenessValues::location_map()` is `location_map_()`: the field `location_map` has the same name.
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { LiveLoans } from "../polonius/mod.gen.ts";
import { intern_key, intern_key_eq } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { SparseBitMatrix } from "../../rustc_index/bit_set.ts";
import { Idx_provided, range_inclusive } from "../../rustc_index/idx.ts";
import { type IntervalSet, SparseIntervalMatrix } from "../../rustc_index/interval.ts";
import { type BasicBlock, debug_BasicBlock, debug_Location, type Location } from "../../rustc_middle/mir/mod.ts";
import { type DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_BoundRegion, debug_Placeholder, type PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import { debug_RegionVid, type RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert_eq, panic, unwrap } from "../../std/panic.ts";
import { LivenessValues, PlaceholderIndex, PlaceholderIndices, type RegionElement, RegionValues } from "./values.gen.ts";

export * from "./values.gen.ts";

declare module "./values.gen.ts" {
  interface LivenessValues {
    // values.rs:91
    points(): SparseIntervalMatrix<RegionVid, PointIndex>;
    // values.rs:101
    point_liveness(region: RegionVid): IntervalSet<PointIndex> | undefined;
    // values.rs:109
    live_regions_unordered(): Iterable<RegionVid>;
    // values.rs:118
    add_location(region: RegionVid, location: Location): void;
    // values.rs:139
    add_points(region: RegionVid, points: IntervalSet<PointIndex>): void;
    // values.rs:157
    add_all_points(region: RegionVid): void;
    // values.rs:168
    is_live_at(region: RegionVid, location: Location): boolean;
    // values.rs:176
    is_live_at_point(region: RegionVid, point: PointIndex): boolean;
    // values.rs:181
    live_points(region: RegionVid): Iterable<PointIndex>;
    // values.rs:187
    pretty_print_live_points(region: RegionVid): string;
    // values.rs:196
    record_live_loans(live_loans: LiveLoans): void;
    // values.rs:201
    is_loan_live_at(loan_idx: BorrowIndex, point: PointIndex): boolean;
    // values.rs:209; `location_map_`: the field `location_map` has the same name
    location_map_(): DenseLocationMap;
  }
  namespace LivenessValues {
    // values.rs:66
    function with_specific_points(location_map: DenseLocationMap): LivenessValues;
    // values.rs:80
    function without_specific_points(location_map: DenseLocationMap): LivenessValues;
  }
  interface PlaceholderIndices {
    // values.rs:225
    insert(placeholder: PlaceholderRegion): PlaceholderIndex;
    // values.rs:230
    lookup_index(placeholder: PlaceholderRegion): PlaceholderIndex;
    // values.rs:237
    lookup_placeholder(placeholder: PlaceholderIndex): PlaceholderRegion;
    // values.rs:244
    len(): number;
  }
  interface RegionValues<N> {
    // values.rs:300
    add_region(r_to: N, r_from: N): boolean;
    // values.rs:307
    first_non_contained_inclusive(r: N, block: BasicBlock, start: number, end: number): number | undefined;
    // values.rs:323
    merge_liveness(to: N, liveness: IntervalSet<PointIndex>): void;
    // values.rs:329
    contains_points(sup_region: N, sub_region: N): boolean;
    // values.rs:344
    locations_outlived_by(r: N): Iterable<Location>;
    // values.rs:352
    universal_regions_outlived_by(r: N): Iterable<RegionVid>;
    // values.rs:357
    placeholders_contained_in(r: N): Iterable<PlaceholderRegion>;
    // values.rs:369
    elements_contained_in(r: N): Iterable<RegionElement>;
    // values.rs:382
    region_value_str(r: N): string;
    // values.rs:387
    add_free_region(scc: N, region: RegionVid): void;
    // values.rs:391
    add_placeholder(scc: N, placeholder: PlaceholderRegion): void;
    // values.rs:397
    contains_point(scc: N, p: Location): boolean;
    // values.rs:403
    contains_free_region(scc: N, free_region: RegionVid): boolean;
  }
  namespace RegionValues {
    // values.rs:282
    function new_<N extends number>(location_map: DenseLocationMap, num_universal_regions: number, placeholder_indices: PlaceholderIndices): RegionValues<N>;
    export { new_ as new };
  }
}

// ---- impl LivenessValues ----

/// Create an empty map of regions to locations where they're live.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:66 with_specific_points
(LivenessValues as unknown as { with_specific_points: typeof LivenessValues.with_specific_points }).with_specific_points = function (
  location_map: DenseLocationMap,
): LivenessValues {
  return new LivenessValues(
    location_map,
    { $: "AtPoints", _0: SparseIntervalMatrix.new<RegionVid, PointIndex>(location_map.num_points()) },
    undefined,
  );
};

/// Create an empty map of regions to locations where they're live.
///
/// Unlike `with_specific_points`, does not track exact locations where something is live, only
/// which regions are live.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:80 without_specific_points
(LivenessValues as unknown as { without_specific_points: typeof LivenessValues.without_specific_points }).without_specific_points = function (
  location_map: DenseLocationMap,
): LivenessValues {
  return new LivenessValues(location_map, { $: "InBody", _0: new Set<RegionVid>() }, undefined);
};

/// Returns the liveness matrix of points where each region is live. Panics if the liveness
/// values have been created without any per-point data (that is, for promoteds).
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:91 points
LivenessValues.prototype.points = function (this: LivenessValues): SparseIntervalMatrix<RegionVid, PointIndex> {
  if (this.live_regions.$ === "AtPoints") {
    const points = this.live_regions._0;
    return points;
  } else {
    return bug("this `LivenessValues` wasn't created using `with_specific_points`");
  }
};

/// Get the liveness status of a region `r`, if any.
/// Panics if liveness data is not tracked for any region.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:101 point_liveness
LivenessValues.prototype.point_liveness = function (this: LivenessValues, region: RegionVid): IntervalSet<PointIndex> | undefined {
  return this.points().row(region);
};

/// Iterate through each region that has a value in this set.
// We are passing query instability implications to the caller.
// PORT: the `FxHashSet` is a JS `Set`: this iterates in insertion order, not in hash order (the callers are
// marked `potential_query_instability` upstream and must not depend on the order).
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:109 live_regions_unordered
LivenessValues.prototype.live_regions_unordered = function (this: LivenessValues): Iterable<RegionVid> {
  if (this.live_regions.$ === "InBody") {
    const live_regions = this.live_regions._0;
    return live_regions.values();
  } else {
    return bug("this `LivenessValues` wasn't created using `without_specific_points`");
  }
};

/// Records `region` as being live at the given `location`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:118 add_location
LivenessValues.prototype.add_location = function (this: LivenessValues, region: RegionVid, location: Location): void {
  const point = this.location_map.point_from_location(location);
  // This is a debug assert despite being cheap because it drops
  // the current `point_in_range()` uses to 0 when debugging is off.
  // debug_assert!(
  //     self.location_map.point_in_range(point),
  //     "Tried inserting region {region:?} whose location {location:?} does not belong to this body!"
  // );
  // debug!("LivenessValues::add_location(region={:?}, location={:?})", region, location);
  const live_regions = this.live_regions;
  switch (live_regions.$) {
    case "AtPoints": {
      const points = live_regions._0;
      points.insert(region, point);
      break;
    }

    case "InBody": {
      const live_regions_ = live_regions._0;
      live_regions_.add(region);
      break;
    }
  }
};

/// Records `region` as being live at all the given `points`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:139 add_points
LivenessValues.prototype.add_points = function (this: LivenessValues, region: RegionVid, points: IntervalSet<PointIndex>): void {
  // debug_assert!(
  //     points.iter().all(|point| self.location_map.point_in_range(point)),
  //     "Tried inserting region {region:?} with some points not belonging to this body!"
  // );
  // debug!("LivenessValues::add_points(region={:?}, points={:?})", region, points);
  const live_regions = this.live_regions;
  switch (live_regions.$) {
    case "AtPoints": {
      const these_points = live_regions._0;
      these_points.union_row(region, points);
      break;
    }
    case "InBody": {
      const live_regions_ = live_regions._0;
      live_regions_.add(region);
      break;
    }
  }
};

/// Records `region` as being live at all the control-flow points.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:157 add_all_points
LivenessValues.prototype.add_all_points = function (this: LivenessValues, region: RegionVid): void {
  const live_regions = this.live_regions;
  switch (live_regions.$) {
    case "AtPoints": {
      const points = live_regions._0;
      points.insert_all_into_row(region);
      break;
    }
    case "InBody": {
      const live_regions_ = live_regions._0;
      live_regions_.add(region);
      break;
    }
  }
};

/// Returns whether `region` is marked live at the given
/// [`location`][rustc_middle::mir::Location].
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:168 is_live_at
LivenessValues.prototype.is_live_at = function (this: LivenessValues, region: RegionVid, location: Location): boolean {
  const point = this.location_map.point_from_location(location);
  return this.is_live_at_point(region, point);
};

/// Returns whether `region` is marked live at the given
/// [`point`][rustc_mir_dataflow::points::PointIndex].
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:176 is_live_at_point
LivenessValues.prototype.is_live_at_point = function (this: LivenessValues, region: RegionVid, point: PointIndex): boolean {
  const r = this.point_liveness(region);
  return r !== undefined && r.contains(point);
};

/// Returns an iterator of all the points where `region` is live.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:181 live_points
LivenessValues.prototype.live_points = function* (this: LivenessValues, region: RegionVid): Generator<PointIndex> {
  const set = this.point_liveness(region);
  if (set !== undefined) yield* set.iter();
};

/// For debugging purposes, returns a pretty-printed string of the points where the `region` is
/// live.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:187 pretty_print_live_points
LivenessValues.prototype.pretty_print_live_points = function (this: LivenessValues, region: RegionVid): string {
  const location_map = this.location_map;
  return pretty_print_region_elements(
    map_iter(this.live_points(region), (p): RegionElement => ({ $: "Location", _0: location_map.to_location(p) })),
  );
};

/// When using `-Zpolonius=next`, records the given live loans for the loan scopes and active
/// loans dataflow computations.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:196 record_live_loans
LivenessValues.prototype.record_live_loans = function (this: LivenessValues, live_loans: LiveLoans): void {
  this.live_loans = live_loans;
};

/// When using `-Zpolonius=next`, returns whether the `loan_idx` is live at the given `point`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:201 is_loan_live_at
LivenessValues.prototype.is_loan_live_at = function (this: LivenessValues, loan_idx: BorrowIndex, point: PointIndex): boolean {
  return unwrap(this.live_loans, "Accessing live loans requires `-Zpolonius=next`").contains(point, loan_idx);
};

// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:209 location_map
LivenessValues.prototype.location_map_ = function (this: LivenessValues): DenseLocationMap {
  return this.location_map;
};

// ---- impl PlaceholderIndices ----

// PORT: `FxIndexSet<ty::PlaceholderRegion>` is the generated `Set` field; a `PlaceholderRegion` is a plain object, so
// lookups compare by value (`intern_key_eq`, the derived `PartialEq`/`Hash`) in insertion order (the `IndexSet` index),
// whatever kind of `Set` the constructor stored. `default_PlaceholderIndices()` (the `#[derive(Default)]`) stores a
// `KeyedSet` so that `has` / `add` by value also hold for other users of the field.
/** `#[derive(Default)]` of `PlaceholderIndices`. */
export function default_PlaceholderIndices(): PlaceholderIndices {
  return new PlaceholderIndices(new KeyedSet<PlaceholderRegion>(intern_key));
}

/** `IndexSet::get_index_of` on the `indices` field (by value, see above). */
function placeholder_index_of(indices: Set<PlaceholderRegion>, placeholder: PlaceholderRegion): number | undefined {
  let i = 0;
  for (const p of indices) {
    if (intern_key_eq(p, placeholder)) return i;
    i++;
  }
  return undefined;
}

/// Returns the `PlaceholderIndex` for the inserted `PlaceholderRegion`
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:225 insert
PlaceholderIndices.prototype.insert = function (this: PlaceholderIndices, placeholder: PlaceholderRegion): PlaceholderIndex {
  // `IndexSet::insert_full`
  let index = placeholder_index_of(this.indices, placeholder);
  if (index === undefined) {
    index = this.indices.size;
    this.indices.add(placeholder);
  }
  return PlaceholderIndex.from_usize(index);
};

// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:230 lookup_index
PlaceholderIndices.prototype.lookup_index = function (this: PlaceholderIndices, placeholder: PlaceholderRegion): PlaceholderIndex {
  return PlaceholderIndex.from_usize(unwrap(placeholder_index_of(this.indices, placeholder)));
};

// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:237 lookup_placeholder
PlaceholderIndices.prototype.lookup_placeholder = function (this: PlaceholderIndices, placeholder: PlaceholderIndex): PlaceholderRegion {
  const i = PlaceholderIndex.index(placeholder);
  if (i < this.indices.size) {
    let j = 0;
    for (const p of this.indices) {
      if (j === i) return p;
      j++;
    }
  }
  return panic(`IndexSet: index out of bounds`);
};

// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:244 len
PlaceholderIndices.prototype.len = function (this: PlaceholderIndices): number {
  return this.indices.size;
};

// ---- impl<N: Idx> RegionValues<N> ----

/// Creates a new set of "region values" that tracks causal information.
/// Each of the regions in num_region_variables will be initialized with an
/// empty set of points and no causal information.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:282 new
(RegionValues as unknown as { new: typeof RegionValues.new }).new = function <N extends number>(
  location_map: DenseLocationMap,
  num_universal_regions: number,
  placeholder_indices: PlaceholderIndices,
): RegionValues<N> {
  const num_points = location_map.num_points();
  const num_placeholders = placeholder_indices.len();
  return new RegionValues<N>(
    location_map,
    placeholder_indices,
    SparseIntervalMatrix.new<N, PointIndex>(num_points),
    SparseBitMatrix.new<N, RegionVid>(num_universal_regions),
    SparseBitMatrix.new<N, PlaceholderIndex>(num_placeholders),
  );
};

/// Adds all elements in `r_from` to `r_to` (because e.g., `r_to:
/// r_from`).
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:300 add_region
RegionValues.prototype.add_region = function <N>(this: RegionValues<N>, r_to: N, r_from: N): boolean {
  // PORT: `|` (not `||`): every union runs.
  const a = this.points.union_rows(r_from as N & number, r_to as N & number);
  const b = this.free_regions.union_rows(r_from as N & number, r_to as N & number);
  const c = this.placeholders.union_rows(r_from as N & number, r_to as N & number);
  return a || b || c;
};

/// Returns the lowest statement index in `start..=end` which is not contained by `r`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:307 first_non_contained_inclusive
RegionValues.prototype.first_non_contained_inclusive = function <N>(
  this: RegionValues<N>,
  r: N,
  block: BasicBlock,
  start: number,
  end: number,
): number | undefined {
  const row = this.points.row(r as N & number);
  if (row === undefined) return undefined;
  const block_ = this.location_map.entry_point(block);
  const start_ = Idx_provided.plus(PointIndex, block_, start);
  const end_ = Idx_provided.plus(PointIndex, block_, end);
  const first_unset = row.first_unset_in(range_inclusive(start_, end_));
  if (first_unset === undefined) return undefined;
  return PointIndex.index(first_unset) - PointIndex.index(block_);
};

/// Merge a row of liveness into our points.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:323 merge_liveness
RegionValues.prototype.merge_liveness = function <N>(this: RegionValues<N>, to: N, liveness: IntervalSet<PointIndex>): void {
  this.points.union_row(to as N & number, liveness);
};

/// Returns `true` if `sup_region` contains all the CFG points that
/// `sub_region` contains. Ignores universal regions.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:329 contains_points
RegionValues.prototype.contains_points = function <N>(this: RegionValues<N>, sup_region: N, sub_region: N): boolean {
  const sub_row = this.points.row(sub_region as N & number);
  if (sub_row !== undefined) {
    const sup_row = this.points.row(sup_region as N & number);
    if (sup_row !== undefined) {
      return sup_row.superset(sub_row);
    } else {
      // sup row is empty, so sub row must be empty
      return sub_row.is_empty();
    }
  } else {
    // sub row is empty, always true
    return true;
  }
};

/// Returns the locations contained within a given region `r`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:344 locations_outlived_by
RegionValues.prototype.locations_outlived_by = function* <N>(this: RegionValues<N>, r: N): Generator<Location> {
  const set = this.points.row(r as N & number);
  if (set !== undefined) {
    for (const p of set.iter()) yield this.location_map.to_location(p);
  }
};

/// Returns just the universal regions that are contained in a given region's value.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:352 universal_regions_outlived_by
RegionValues.prototype.universal_regions_outlived_by = function* <N>(this: RegionValues<N>, r: N): Generator<RegionVid> {
  const set = this.free_regions.row(r as N & number);
  if (set !== undefined) yield* set.iter();
};

/// Returns all the elements contained in a given region's value.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:357 placeholders_contained_in
RegionValues.prototype.placeholders_contained_in = function* <N>(this: RegionValues<N>, r: N): Generator<PlaceholderRegion> {
  const set = this.placeholders.row(r as N & number);
  if (set !== undefined) {
    for (const p of set.iter()) yield this.placeholder_indices.lookup_placeholder(p);
  }
};

/// Returns all the elements contained in a given region's value.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:369 elements_contained_in
RegionValues.prototype.elements_contained_in = function* <N>(this: RegionValues<N>, r: N): Generator<RegionElement> {
  const points_iter = map_iter(this.locations_outlived_by(r), (l): RegionElement => ({ $: "Location", _0: l }));

  const free_regions_iter = map_iter(this.universal_regions_outlived_by(r), (fr): RegionElement => ({ $: "RootUniversalRegion", _0: fr }));

  const placeholder_universes_iter = map_iter(this.placeholders_contained_in(r), (p): RegionElement => ({ $: "PlaceholderRegion", _0: p }));

  yield* points_iter;
  yield* free_regions_iter;
  yield* placeholder_universes_iter;
};

/// Returns a "pretty" string value of the region. Meant for debugging.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:382 region_value_str
RegionValues.prototype.region_value_str = function <N>(this: RegionValues<N>, r: N): string {
  return pretty_print_region_elements(this.elements_contained_in(r));
};

/// Add a the free region with rvid `region` to SCC `scc`
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:387 add_free_region
RegionValues.prototype.add_free_region = function <N>(this: RegionValues<N>, scc: N, region: RegionVid): void {
  this.free_regions.insert(scc as N & number, region);
};

// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:391 add_placeholder
RegionValues.prototype.add_placeholder = function <N>(this: RegionValues<N>, scc: N, placeholder: PlaceholderRegion): void {
  const index = this.placeholder_indices.lookup_index(placeholder);
  this.placeholders.insert(scc as N & number, index);
};

/// Determine if `scc` contains the CFG point `p`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:397 contains_point
RegionValues.prototype.contains_point = function <N>(this: RegionValues<N>, scc: N, p: Location): boolean {
  const index = this.location_map.point_from_location(p);
  return this.points.contains(scc as N & number, index);
};

/// Determine if `scc` contains the free region `free_region`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:403 contains_free_region
RegionValues.prototype.contains_free_region = function <N>(this: RegionValues<N>, scc: N, free_region: RegionVid): boolean {
  return this.free_regions.contains(scc as N & number, free_region);
};

/** `Iterator::map` over a lazily evaluated iterable. */
function* map_iter<T, U>(it: Iterable<T>, f: (x: T) => U): Generator<U> {
  for (const x of it) yield f(x);
}

/// For debugging purposes, returns a pretty-printed string of the given region elements.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:409 pretty_print_region_elements
export function pretty_print_region_elements(elements: Iterable<RegionElement>): string {
  const result: MutRef<string> = { value: "" };
  result.value += "{";

  // Set to Some(l1, l2) when we have observed all the locations
  // from l1..=l2 (inclusive) but not yet printed them. This
  // gets extended if we then see l3 where l3 is the successor
  // to l2.
  let open_location: [Location, Location] | undefined = undefined;

  let sep = "";
  const push_sep = (s: MutRef<string>) => {
    s.value += sep;
    sep = ", ";
  };

  for (const element of elements) {
    switch (element.$) {
      case "Location": {
        const l = element._0;
        if (open_location !== undefined) {
          const [location1, location2]: [Location, Location] = open_location;
          if (location2.block === l.block && location2.statement_index === l.statement_index - 1) {
            open_location = [location1, l];
            continue;
          }

          push_sep(result);
          push_location_range(result, location1, location2);
        }

        open_location = [l, l];
        break;
      }

      case "RootUniversalRegion": {
        const fr = element._0;
        if (open_location !== undefined) {
          const [location1, location2]: [Location, Location] = open_location;
          push_sep(result);
          push_location_range(result, location1, location2);
          open_location = undefined;
        }

        push_sep(result);
        result.value += debug_RegionVid(fr, PLAIN);
        break;
      }

      case "PlaceholderRegion": {
        const placeholder = element._0;
        if (open_location !== undefined) {
          const [location1, location2]: [Location, Location] = open_location;
          push_sep(result);
          push_location_range(result, location1, location2);
          open_location = undefined;
        }

        push_sep(result);
        result.value += debug_Placeholder(placeholder, PLAIN, debug_BoundRegion);
        break;
      }
    }
  }

  if (open_location !== undefined) {
    const [location1, location2]: [Location, Location] = open_location;
    push_sep(result);
    push_location_range(result, location1, location2);
  }

  result.value += "}";

  return result.value;
}

// PORT: fn-local to `pretty_print_region_elements` (hoisted: a nested `fn` item); `s: &mut String` is a `MutRef<string>`.
// rustc: compiler/rustc_borrowck/src/region_infer/values.rs:478 push_location_range
function push_location_range(s: MutRef<string>, location1: Location, location2: Location): void {
  if (location1.block === location2.block && location1.statement_index === location2.statement_index) {
    s.value += debug_Location(location1, PLAIN);
  } else {
    assert_eq(location1.block, location2.block, (b) => debug_BasicBlock(b, PLAIN));
    s.value += `${debug_BasicBlock(location1.block, PLAIN)}[${location1.statement_index}..=${location2.statement_index}]`;
  }
}
