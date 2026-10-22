// Port of compiler/rustc_borrowck/src/region_infer/values.rs (lane borrowck-contract: declarations; fill lane bck-regions-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Rc<DenseLocationMap>` is the shared `DenseLocationMap`. `N: Idx` of `RegionValues<N>` is a branded number
// (`N extends number`; the generated class carries `N & number` in its field types).
// PORT: `LivenessValues::location_map()` is `location_map_()`: the field `location_map` has the same name.
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { LiveLoans } from "../polonius/mod.gen.ts";
import type { IntervalSet } from "../../rustc_index/interval.ts";
import type { BasicBlock, Location } from "../../rustc_middle/mir/mod.ts";
import type { DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { SparseIntervalMatrix } from "../../rustc_index/interval.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import { LivenessValues, type PlaceholderIndex, PlaceholderIndices, type RegionElement, RegionValues } from "./values.gen.ts";

export * from "./values.gen.ts";

declare module "./values.gen.ts" {
  interface LivenessValues {
    // values.rs:91 (lane bck-regions-a)
    points(): SparseIntervalMatrix<RegionVid, PointIndex>;
    // values.rs:101 (lane bck-regions-a)
    point_liveness(region: RegionVid): IntervalSet<PointIndex> | undefined;
    // values.rs:109 (lane bck-regions-a)
    live_regions_unordered(): Iterable<RegionVid>;
    // values.rs:118 (lane bck-regions-a)
    add_location(region: RegionVid, location: Location): void;
    // values.rs:139 (lane bck-regions-a)
    add_points(region: RegionVid, points: IntervalSet<PointIndex>): void;
    // values.rs:157 (lane bck-regions-a)
    add_all_points(region: RegionVid): void;
    // values.rs:168 (lane bck-regions-a)
    is_live_at(region: RegionVid, location: Location): boolean;
    // values.rs:176 (lane bck-regions-a)
    is_live_at_point(region: RegionVid, point: PointIndex): boolean;
    // values.rs:181 (lane bck-regions-a)
    live_points(region: RegionVid): Iterable<PointIndex>;
    // values.rs:187 (lane bck-regions-a)
    pretty_print_live_points(region: RegionVid): string;
    // values.rs:196 (lane bck-regions-a)
    record_live_loans(live_loans: LiveLoans): void;
    // values.rs:201 (lane bck-regions-a)
    is_loan_live_at(loan_idx: BorrowIndex, point: PointIndex): boolean;
    // values.rs:209 (lane bck-regions-a); `location_map_`: the field `location_map` has the same name
    location_map_(): DenseLocationMap;
  }
  namespace LivenessValues {
    // values.rs:66 (lane bck-regions-a)
    function with_specific_points(location_map: DenseLocationMap): LivenessValues;
    // values.rs:80 (lane bck-regions-a)
    function without_specific_points(location_map: DenseLocationMap): LivenessValues;
  }
  interface PlaceholderIndices {
    // values.rs:225 (lane bck-regions-a)
    insert(placeholder: PlaceholderRegion): PlaceholderIndex;
    // values.rs:230 (lane bck-regions-a)
    lookup_index(placeholder: PlaceholderRegion): PlaceholderIndex;
    // values.rs:237 (lane bck-regions-a)
    lookup_placeholder(placeholder: PlaceholderIndex): PlaceholderRegion;
    // values.rs:244 (lane bck-regions-a)
    len(): number;
  }
  interface RegionValues<N> {
    // values.rs:300 (lane bck-regions-a)
    add_region(r_to: N, r_from: N): boolean;
    // values.rs:307 (lane bck-regions-a)
    first_non_contained_inclusive(r: N, block: BasicBlock, start: number, end: number): number | undefined;
    // values.rs:323 (lane bck-regions-a)
    merge_liveness(to: N, liveness: IntervalSet<PointIndex>): void;
    // values.rs:329 (lane bck-regions-a)
    contains_points(sup_region: N, sub_region: N): boolean;
    // values.rs:344 (lane bck-regions-a)
    locations_outlived_by(r: N): Iterable<Location>;
    // values.rs:352 (lane bck-regions-a)
    universal_regions_outlived_by(r: N): Iterable<RegionVid>;
    // values.rs:357 (lane bck-regions-a)
    placeholders_contained_in(r: N): Iterable<PlaceholderRegion>;
    // values.rs:369 (lane bck-regions-a)
    elements_contained_in(r: N): Iterable<RegionElement>;
    // values.rs:382 (lane bck-regions-a)
    region_value_str(r: N): string;
    // values.rs:387 (lane bck-regions-a)
    add_free_region(scc: N, region: RegionVid): void;
    // values.rs:391 (lane bck-regions-a)
    add_placeholder(scc: N, placeholder: PlaceholderRegion): void;
    // values.rs:397 (lane bck-regions-a)
    contains_point(scc: N, p: Location): boolean;
    // values.rs:403 (lane bck-regions-a)
    contains_free_region(scc: N, free_region: RegionVid): boolean;
  }
  namespace RegionValues {
    // values.rs:282 (lane bck-regions-a)
    function new_<N extends number>(location_map: DenseLocationMap, num_universal_regions: number, placeholder_indices: PlaceholderIndices): RegionValues<N>;
    export { new_ as new };
  }
}

// ---- impl LivenessValues ----

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:66 with_specific_points (lane bck-regions-a)
(LivenessValues as unknown as { with_specific_points: typeof LivenessValues.with_specific_points }).with_specific_points = function (
  location_map: DenseLocationMap,
): LivenessValues {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::with_specific_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:80 without_specific_points (lane bck-regions-a)
(LivenessValues as unknown as { without_specific_points: typeof LivenessValues.without_specific_points }).without_specific_points = function (
  location_map: DenseLocationMap,
): LivenessValues {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::without_specific_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:91 points (lane bck-regions-a)
LivenessValues.prototype.points = function (this: LivenessValues): SparseIntervalMatrix<RegionVid, PointIndex> {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:101 point_liveness (lane bck-regions-a)
LivenessValues.prototype.point_liveness = function (this: LivenessValues, region: RegionVid): IntervalSet<PointIndex> | undefined {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::point_liveness");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:109 live_regions_unordered (lane bck-regions-a)
LivenessValues.prototype.live_regions_unordered = function (this: LivenessValues): Iterable<RegionVid> {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::live_regions_unordered");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:118 add_location (lane bck-regions-a)
LivenessValues.prototype.add_location = function (this: LivenessValues, region: RegionVid, location: Location): void {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::add_location");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:139 add_points (lane bck-regions-a)
LivenessValues.prototype.add_points = function (this: LivenessValues, region: RegionVid, points: IntervalSet<PointIndex>): void {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::add_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:157 add_all_points (lane bck-regions-a)
LivenessValues.prototype.add_all_points = function (this: LivenessValues, region: RegionVid): void {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::add_all_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:168 is_live_at (lane bck-regions-a)
LivenessValues.prototype.is_live_at = function (this: LivenessValues, region: RegionVid, location: Location): boolean {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::is_live_at");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:176 is_live_at_point (lane bck-regions-a)
LivenessValues.prototype.is_live_at_point = function (this: LivenessValues, region: RegionVid, point: PointIndex): boolean {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::is_live_at_point");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:181 live_points (lane bck-regions-a)
LivenessValues.prototype.live_points = function (this: LivenessValues, region: RegionVid): Iterable<PointIndex> {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::live_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:187 pretty_print_live_points (lane bck-regions-a)
LivenessValues.prototype.pretty_print_live_points = function (this: LivenessValues, region: RegionVid): string {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::pretty_print_live_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:196 record_live_loans (lane bck-regions-a)
LivenessValues.prototype.record_live_loans = function (this: LivenessValues, live_loans: LiveLoans): void {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::record_live_loans");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:201 is_loan_live_at (lane bck-regions-a)
LivenessValues.prototype.is_loan_live_at = function (this: LivenessValues, loan_idx: BorrowIndex, point: PointIndex): boolean {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::is_loan_live_at");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:209 location_map (lane bck-regions-a)
LivenessValues.prototype.location_map_ = function (this: LivenessValues): DenseLocationMap {
  return unported("rustc_borrowck::region_infer::values::LivenessValues::location_map");
};

// ---- impl PlaceholderIndices ----

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:225 insert (lane bck-regions-a)
PlaceholderIndices.prototype.insert = function (this: PlaceholderIndices, placeholder: PlaceholderRegion): PlaceholderIndex {
  return unported("rustc_borrowck::region_infer::values::PlaceholderIndices::insert");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:230 lookup_index (lane bck-regions-a)
PlaceholderIndices.prototype.lookup_index = function (this: PlaceholderIndices, placeholder: PlaceholderRegion): PlaceholderIndex {
  return unported("rustc_borrowck::region_infer::values::PlaceholderIndices::lookup_index");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:237 lookup_placeholder (lane bck-regions-a)
PlaceholderIndices.prototype.lookup_placeholder = function (this: PlaceholderIndices, placeholder: PlaceholderIndex): PlaceholderRegion {
  return unported("rustc_borrowck::region_infer::values::PlaceholderIndices::lookup_placeholder");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:244 len (lane bck-regions-a)
PlaceholderIndices.prototype.len = function (this: PlaceholderIndices): number {
  return unported("rustc_borrowck::region_infer::values::PlaceholderIndices::len");
};

// ---- impl<N: Idx> RegionValues<N> ----

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:282 new (lane bck-regions-a)
(RegionValues as unknown as { new: typeof RegionValues.new }).new = function <N extends number>(
  location_map: DenseLocationMap,
  num_universal_regions: number,
  placeholder_indices: PlaceholderIndices,
): RegionValues<N> {
  return unported("rustc_borrowck::region_infer::values::RegionValues::new");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:300 add_region (lane bck-regions-a)
RegionValues.prototype.add_region = function <N>(this: RegionValues<N>, r_to: N, r_from: N): boolean {
  return unported("rustc_borrowck::region_infer::values::RegionValues::add_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:307 first_non_contained_inclusive (lane bck-regions-a)
RegionValues.prototype.first_non_contained_inclusive = function <N>(
  this: RegionValues<N>,
  r: N,
  block: BasicBlock,
  start: number,
  end: number,
): number | undefined {
  return unported("rustc_borrowck::region_infer::values::RegionValues::first_non_contained_inclusive");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:323 merge_liveness (lane bck-regions-a)
RegionValues.prototype.merge_liveness = function <N>(this: RegionValues<N>, to: N, liveness: IntervalSet<PointIndex>): void {
  return unported("rustc_borrowck::region_infer::values::RegionValues::merge_liveness");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:329 contains_points (lane bck-regions-a)
RegionValues.prototype.contains_points = function <N>(this: RegionValues<N>, sup_region: N, sub_region: N): boolean {
  return unported("rustc_borrowck::region_infer::values::RegionValues::contains_points");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:344 locations_outlived_by (lane bck-regions-a)
RegionValues.prototype.locations_outlived_by = function <N>(this: RegionValues<N>, r: N): Iterable<Location> {
  return unported("rustc_borrowck::region_infer::values::RegionValues::locations_outlived_by");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:352 universal_regions_outlived_by (lane bck-regions-a)
RegionValues.prototype.universal_regions_outlived_by = function <N>(this: RegionValues<N>, r: N): Iterable<RegionVid> {
  return unported("rustc_borrowck::region_infer::values::RegionValues::universal_regions_outlived_by");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:357 placeholders_contained_in (lane bck-regions-a)
RegionValues.prototype.placeholders_contained_in = function <N>(this: RegionValues<N>, r: N): Iterable<PlaceholderRegion> {
  return unported("rustc_borrowck::region_infer::values::RegionValues::placeholders_contained_in");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:369 elements_contained_in (lane bck-regions-a)
RegionValues.prototype.elements_contained_in = function <N>(this: RegionValues<N>, r: N): Iterable<RegionElement> {
  return unported("rustc_borrowck::region_infer::values::RegionValues::elements_contained_in");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:382 region_value_str (lane bck-regions-a)
RegionValues.prototype.region_value_str = function <N>(this: RegionValues<N>, r: N): string {
  return unported("rustc_borrowck::region_infer::values::RegionValues::region_value_str");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:387 add_free_region (lane bck-regions-a)
RegionValues.prototype.add_free_region = function <N>(this: RegionValues<N>, scc: N, region: RegionVid): void {
  return unported("rustc_borrowck::region_infer::values::RegionValues::add_free_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:391 add_placeholder (lane bck-regions-a)
RegionValues.prototype.add_placeholder = function <N>(this: RegionValues<N>, scc: N, placeholder: PlaceholderRegion): void {
  return unported("rustc_borrowck::region_infer::values::RegionValues::add_placeholder");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:397 contains_point (lane bck-regions-a)
RegionValues.prototype.contains_point = function <N>(this: RegionValues<N>, scc: N, p: Location): boolean {
  return unported("rustc_borrowck::region_infer::values::RegionValues::contains_point");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:403 contains_free_region (lane bck-regions-a)
RegionValues.prototype.contains_free_region = function <N>(this: RegionValues<N>, scc: N, free_region: RegionVid): boolean {
  return unported("rustc_borrowck::region_infer::values::RegionValues::contains_free_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/values.rs:409 pretty_print_region_elements (lane bck-regions-a)
export function pretty_print_region_elements(elements: Iterable<RegionElement>): string {
  return unported("rustc_borrowck::region_infer::values::pretty_print_region_elements");
}

// PORT: fn-local to `pretty_print_region_elements` (module level until filled); `s: &mut String` is a `MutRef<string>`.
// stub: compiler/rustc_borrowck/src/region_infer/values.rs:478 push_location_range (lane bck-regions-a)
function push_location_range(s: MutRef<string>, location1: Location, location2: Location): void {
  return unported("rustc_borrowck::region_infer::values::pretty_print_region_elements::push_location_range");
}
void push_location_range;
