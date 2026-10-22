// Unit tests of region_infer/values.ts (lane bck-regions-a): `RegionValues`, `LivenessValues`, `PlaceholderIndices` and
// `pretty_print_region_elements` on a hand-built `DenseLocationMap` (the borrowck runtime path does not reach region
// inference yet). Expected values follow upstream's semantics (interval rows, `IndexSet` indices, the `{bbN[a..=b], ..}`
// debug rendering).
import { expect, test } from "bun:test";
import "../lib.ts";
import { IntervalSet } from "../../rustc_index/interval.ts";
import { BasicBlock, Location } from "../../rustc_middle/mir/mod.ts";
import { DenseLocationMap, type PointIndex } from "../../rustc_mir_dataflow/points.ts";
import type { PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { default_PlaceholderIndices, type RegionElement, LivenessValues, pretty_print_region_elements, RegionValues } from "./values.ts";

const bb0 = BasicBlock.new(0);
const bb1 = BasicBlock.new(1);
/** bb0: 2 statements (points 0..=2), bb1: 1 statement (points 3..=4). */
const location_map = () => new DenseLocationMap([0, 3], [bb0, bb0, bb0, bb1, bb1], 5);
const loc = (block: BasicBlock, statement_index: number) => new Location(block, statement_index);
const vid = (n: number) => n as RegionVid;
const placeholder = (u: number, v: number): PlaceholderRegion => ({
  universe: u as UniverseIndex,
  bound: { var: v as PlaceholderRegion["bound"]["var"], kind: { $: "Anon" } },
  _tcx: undefined,
});

test("PlaceholderIndices: insert / lookup by value, in insertion order", () => {
  const p = default_PlaceholderIndices();
  expect(p.insert(placeholder(1, 0))).toBe(0 as never);
  expect(p.insert(placeholder(1, 1))).toBe(1 as never);
  expect(p.insert(placeholder(1, 0))).toBe(0 as never);
  expect(p.len()).toBe(2);
  expect(p.lookup_index(placeholder(1, 1))).toBe(1 as never);
  expect(p.lookup_placeholder(1 as never)).toEqual(placeholder(1, 1));
});

test("RegionValues: liveness rows, free regions, propagation", () => {
  const values = RegionValues.new<number>(location_map(), 3, default_PlaceholderIndices());
  const live = IntervalSet.new<PointIndex>(5);
  live.insert(0 as PointIndex);
  live.insert(1 as PointIndex);
  live.insert(3 as PointIndex);
  values.merge_liveness(0, live);
  values.add_free_region(0, vid(2));
  expect(values.region_value_str(0)).toBe("{bb0[0..=1], bb1[0], '?2}");
  expect(values.region_value_str(1)).toBe("{}");

  expect(values.add_region(1, 0)).toBe(true);
  expect(values.add_region(1, 0)).toBe(false);
  expect(values.region_value_str(1)).toBe("{bb0[0..=1], bb1[0], '?2}");
  expect(values.contains_points(1, 0)).toBe(true);
  expect(values.contains_points(2, 0)).toBe(false);
  expect(values.contains_points(0, 2)).toBe(true);
  expect(values.contains_free_region(1, vid(2))).toBe(true);
  expect(values.contains_point(0, loc(bb1, 0))).toBe(true);
  expect(values.contains_point(0, loc(bb1, 1))).toBe(false);

  expect(values.first_non_contained_inclusive(0, bb0, 0, 2)).toBe(2);
  expect(values.first_non_contained_inclusive(0, bb1, 0, 1)).toBe(1);
  expect(values.first_non_contained_inclusive(2, bb0, 0, 2)).toBeUndefined();
});

test("LivenessValues: with / without specific points", () => {
  const with_points = LivenessValues.with_specific_points(location_map());
  with_points.add_location(vid(1), loc(bb0, 2));
  with_points.add_location(vid(1), loc(bb1, 0));
  expect(with_points.is_live_at(vid(1), loc(bb1, 0))).toBe(true);
  expect(with_points.is_live_at(vid(0), loc(bb1, 0))).toBe(false);
  expect(with_points.pretty_print_live_points(vid(1))).toBe("{bb0[2], bb1[0]}");
  expect(() => with_points.live_regions_unordered()).toThrow();

  const in_body = LivenessValues.without_specific_points(location_map());
  in_body.add_all_points(vid(3));
  in_body.add_location(vid(1), loc(bb0, 0));
  expect([...in_body.live_regions_unordered()]).toEqual([vid(3), vid(1)]);
  expect(() => in_body.points()).toThrow();
});

test("pretty_print_region_elements: ranges are closed by other elements", () => {
  expect(
    pretty_print_region_elements(<RegionElement[]>[
      { $: "Location", _0: loc(bb0, 0) },
      { $: "Location", _0: loc(bb0, 1) },
      { $: "RootUniversalRegion", _0: vid(0) },
      { $: "Location", _0: loc(bb1, 1) },
    ]),
  ).toBe("{bb0[0..=1], '?0, bb1[1]}");
});
