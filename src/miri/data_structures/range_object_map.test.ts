// Port of the `#[cfg(test)] mod tests` of src/tools/miri/src/data_structures/range_object_map.rs:145 (lane miri-driver).
import { expect, test } from "bun:test";
import { Size } from "../../rustc_abi/lib.ts";
import { alloc_range } from "../../rustc_middle/mir/interpret/allocation.ts";
import { Panic } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import "../lib.ts";
import { RangeObjectMap } from "./range_object_map.ts";

test("empty_map", () => {
  // FIXME: make Size::from_bytes const
  const four = Size.from_bytes(4);
  const map = RangeObjectMap.new<null>();

  // Correctly tells where we should insert the first element (at position 0)
  expect(map.find_offset(Size.from_bytes(3))).toEqual(Err(0));

  // Correctly tells the access type along with the supposed position
  expect(map.access_type(alloc_range(Size.ZERO, four))).toEqual({ $: "Empty", _0: 0 });
});

// #[should_panic]
test("no_overlapping_inserts", () => {
  const four = Size.from_bytes(4);

  const map = RangeObjectMap.new<string>();

  // |_|_|_|_|#|#|#|#|_|_|_|_|...
  //  0 1 2 3 4 5 6 7 8 9 a b c d
  map.insert_at_pos(0, alloc_range(four, four), "#");
  // |_|_|_|_|#|#|#|#|_|_|_|_|...
  //  0 ^ ^ ^ ^ 5 6 7 8 9 a b c d
  expect(() => map.insert_at_pos(0, alloc_range(Size.from_bytes(1), four), "@")).toThrow(Panic);
});

test("boundaries", () => {
  const four = Size.from_bytes(4);

  const map = RangeObjectMap.new<string>();

  // |#|#|#|#|_|_|...
  //  0 1 2 3 4 5
  map.insert_at_pos(0, alloc_range(Size.ZERO, four), "#");
  // |#|#|#|#|_|_|...
  //  0 1 2 3 ^ 5
  expect(map.find_offset(four)).toEqual(Err(1));
  // |#|#|#|#|_|_|_|_|_|...
  //  0 1 2 3 ^ ^ ^ ^ 8
  expect(map.access_type(alloc_range(four, four))).toEqual({ $: "Empty", _0: 1 });

  const eight = Size.from_bytes(8);
  // |#|#|#|#|_|_|_|_|@|@|@|@|_|_|...
  //  0 1 2 3 4 5 6 7 8 9 a b c d
  map.insert_at_pos(1, alloc_range(eight, four), "@");
  // |#|#|#|#|_|_|_|_|@|@|@|@|_|_|...
  //  0 1 2 3 4 5 6 ^ 8 9 a b c d
  expect(map.find_offset(Size.from_bytes(7))).toEqual(Err(1));
  // |#|#|#|#|_|_|_|_|@|@|@|@|_|_|...
  //  0 1 2 3 ^ ^ ^ ^ 8 9 a b c d
  expect(map.access_type(alloc_range(four, four))).toEqual({ $: "Empty", _0: 1 });
});

test("perfectly_overlapping", () => {
  const four = Size.from_bytes(4);

  const map = RangeObjectMap.new<string>();

  // |#|#|#|#|_|_|...
  //  0 1 2 3 4 5
  map.insert_at_pos(0, alloc_range(Size.ZERO, four), "#");
  // |#|#|#|#|_|_|...
  //  ^ ^ ^ ^ 4 5
  expect(map.find_offset(Size.ZERO)).toEqual(Ok(0));
  expect(map.access_type(alloc_range(Size.ZERO, four))).toEqual({ $: "PerfectlyOverlapping", _0: 0 });

  // |#|#|#|#|@|@|@|@|_|...
  //  0 1 2 3 4 5 6 7 8
  map.insert_at_pos(1, alloc_range(four, four), "@");
  // |#|#|#|#|@|@|@|@|_|...
  //  0 1 2 3 ^ ^ ^ ^ 8
  expect(map.find_offset(four)).toEqual(Ok(1));
  expect(map.access_type(alloc_range(four, four))).toEqual({ $: "PerfectlyOverlapping", _0: 1 });
});

test("straddling", () => {
  const four = Size.from_bytes(4);

  const map = RangeObjectMap.new<string>();

  // |_|_|_|_|#|#|#|#|_|_|_|_|...
  //  0 1 2 3 4 5 6 7 8 9 a b c d
  map.insert_at_pos(0, alloc_range(four, four), "#");
  // |_|_|_|_|#|#|#|#|_|_|_|_|...
  //  0 1 ^ ^ ^ ^ 6 7 8 9 a b c d
  expect(map.access_type(alloc_range(Size.from_bytes(2), four))).toEqual({ $: "ImperfectlyOverlapping", _0: { start: 0, end: 1 } });
  // |_|_|_|_|#|#|#|#|_|_|_|_|...
  //  0 1 2 3 4 5 ^ ^ ^ ^ a b c d
  expect(map.access_type(alloc_range(Size.from_bytes(6), four))).toEqual({ $: "ImperfectlyOverlapping", _0: { start: 0, end: 1 } });
  // |_|_|_|_|#|#|#|#|_|_|_|_|...
  //  0 1 ^ ^ ^ ^ ^ ^ ^ ^ a b c d
  expect(map.access_type(alloc_range(Size.from_bytes(2), Size.from_bytes(8)))).toEqual({
    $: "ImperfectlyOverlapping",
    _0: { start: 0, end: 1 },
  });

  // |_|_|_|_|#|#|#|#|_|_|@|@|_|_|...
  //  0 1 2 3 4 5 6 7 8 9 a b c d
  map.insert_at_pos(1, alloc_range(Size.from_bytes(10), Size.from_bytes(2)), "@");
  // |_|_|_|_|#|#|#|#|_|_|@|@|_|_|...
  //  0 1 2 3 4 5 ^ ^ ^ ^ ^ ^ ^ ^
  expect(map.access_type(alloc_range(Size.from_bytes(6), Size.from_bytes(8)))).toEqual({
    $: "ImperfectlyOverlapping",
    _0: { start: 0, end: 2 },
  });
});
