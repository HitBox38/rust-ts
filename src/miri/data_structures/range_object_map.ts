//! Implements a map from allocation ranges to data. This is somewhat similar to RangeMap, but the
//! ranges and data are discrete and non-splittable -- they represent distinct "objects". An
//! allocation in the map will always have the same range until explicitly removed
// Port of src/tools/miri/src/data_structures/range_object_map.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-driver` (plan-m6 wave 36): ported.
// Its types are generated into range_object_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT (lane miri-driver): `impl Index<Position>` / `impl IndexMut<Position>` are the methods `index` / `index_mut`
// (`map[pos]` → `map.index(pos)`); `index_mut` returns the element's `data` (an object mutated in place: weak memory's
// `StoreBuffer`, the only user). `iter` is an eager array (the `map` has no side effects).
import { type AccessType, type Elem, type Position, RangeObjectMap } from "./range_object_map.gen.ts";
import { Size, Size_cmp, Size_eq } from "../../rustc_abi/lib.ts";
import { type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { assert, panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { binary_search_by } from "../../std/slice.ts";
export * from "./range_object_map.gen.ts";

declare module "./range_object_map.gen.ts" {
  interface RangeObjectMap<T> {
    // data_structures/range_object_map.rs:44
    find_offset(offset: Size): Result<Position, Position>;
    // data_structures/range_object_map.rs:62
    access_type(range: AllocRange): AccessType;
    // data_structures/range_object_map.rs:105
    insert_at_pos(pos: Position, range: AllocRange, data: T): void;
    // data_structures/range_object_map.rs:117
    remove_pos_range(pos_range: { start: Position; end: Position }): void;
    // data_structures/range_object_map.rs:121
    remove_from_pos(pos: Position): void;
    // data_structures/range_object_map.rs:125
    iter(): T[];
    // data_structures/range_object_map.rs:133
    index(pos: Position): T;
    // data_structures/range_object_map.rs:139
    index_mut(pos: Position): T;
  }
  namespace RangeObjectMap {
    // data_structures/range_object_map.rs:37
    function new_<T>(): RangeObjectMap<T>;
    export { new_ as new };
  }
}

function elem_at<T>(m: RangeObjectMap<T>, pos: number): Elem<T> {
  const e = m.v[pos];
  if (e === undefined) panic(`index out of bounds: the len is ${m.v.length} but the index is ${pos}`);
  return e;
}

// rustc: src/tools/miri/src/data_structures/range_object_map.rs:37 new
RangeObjectMap.new = function <T>(): RangeObjectMap<T> {
  return new RangeObjectMap<T>([]);
};

/// Finds the position of the allocation containing the given offset. If the offset is not
/// in an existing allocation, then returns Err containing the position
/// where such allocation should be inserted
// rustc: src/tools/miri/src/data_structures/range_object_map.rs:44 find_offset
RangeObjectMap.prototype.find_offset = function <T>(this: RangeObjectMap<T>, offset: Size): Result<Position, Position> {
  const r = binary_search_by(this.v, (elem): -1 | 0 | 1 => {
    if (Size_cmp(offset, elem.range.start) < 0) {
      // We are too far right (offset is further left).
      // (`Greater` means that `elem` is greater than the desired target.)
      return 1;
    } else if (Size_cmp(offset, elem.range.end()) >= 0) {
      // We are too far left (offset is further right).
      return -1;
    } else {
      // This is it!
      return 0;
    }
  });
  return r.ok ? Ok(r.i) : Err(r.i);
};

/// Determines whether a given access on `range` overlaps with
/// an existing allocation
// rustc: src/tools/miri/src/data_structures/range_object_map.rs:62 access_type
RangeObjectMap.prototype.access_type = function <T>(this: RangeObjectMap<T>, range: AllocRange): AccessType {
  const r = this.find_offset(range.start);
  switch (r.$) {
    case "Ok": {
      const pos = r._0;
      // Start of the range belongs to an existing object, now let's check the overlapping situation
      const elem = elem_at(this, pos);
      // FIXME: derive Eq for AllocRange in rustc
      if (Size_eq(elem.range.start, range.start) && Size_eq(elem.range.size, range.size)) {
        // Happy case: perfectly overlapping access
        return { $: "PerfectlyOverlapping", _0: pos };
      } else {
        // FIXME: add a last() method to AllocRange that returns the last inclusive offset (end() is exclusive)
        const e = this.find_offset(range.end().sub(Size.from_bytes(1)));
        let end_pos: number;
        switch (e.$) {
          // If the end lands in an existing object, add one to get the exclusive position
          case "Ok":
            end_pos = e._0 + 1;
            break;
          case "Err":
            end_pos = e._0;
            break;
        }

        return { $: "ImperfectlyOverlapping", _0: { start: pos, end: end_pos } };
      }
    }
    case "Err": {
      const pos = r._0;
      // Start of the range doesn't belong to an existing object
      const e = this.find_offset(range.end().sub(Size.from_bytes(1)));
      switch (e.$) {
        // Neither does the end
        case "Err": {
          const end_pos = e._0;
          if (pos === end_pos) {
            // There's nothing between the start and the end, so the range thing is empty
            return { $: "Empty", _0: pos };
          } else {
            // Otherwise we have entirely covered an existing object
            return { $: "ImperfectlyOverlapping", _0: { start: pos, end: end_pos } };
          }
        }
        // Otherwise at least part of it overlaps with something else
        case "Ok": {
          const end_pos = e._0;
          return { $: "ImperfectlyOverlapping", _0: { start: pos, end: end_pos + 1 } };
        }
      }
    }
  }
};

/// Inserts an object and its occupied range at given position
// The Position can be calculated from AllocRange, but the only user of AllocationMap
// always calls access_type before calling insert/index/index_mut, and we don't
// want to repeat the binary search on each time, so we ask the caller to supply Position
// rustc: src/tools/miri/src/data_structures/range_object_map.rs:105 insert_at_pos
RangeObjectMap.prototype.insert_at_pos = function <T>(this: RangeObjectMap<T>, pos: Position, range: AllocRange, data: T): void {
  // `Vec::insert`: panics if `index > len`.
  if (pos > this.v.length) panic(`insertion index (is ${pos}) should be <= len (is ${this.v.length})`);
  this.v.splice(pos, 0, { range, data });
  // If we aren't the first element, then our start must be greater than the previous element's end
  if (pos > 0) {
    assert(Size_cmp(elem_at(this, pos - 1).range.end(), range.start) <= 0, "assertion failed: self.v[pos - 1].range.end() <= range.start");
  }
  // If we aren't the last element, then our end must be smaller than next element's start
  if (pos < this.v.length - 1) {
    assert(Size_cmp(range.end(), elem_at(this, pos + 1).range.start) <= 0, "assertion failed: range.end() <= self.v[pos + 1].range.start");
  }
};

// rustc: src/tools/miri/src/data_structures/range_object_map.rs:117 remove_pos_range
RangeObjectMap.prototype.remove_pos_range = function <T>(this: RangeObjectMap<T>, pos_range: { start: Position; end: Position }): void {
  // `Vec::drain(range)`: panics on a decreasing or out-of-bounds range.
  if (pos_range.start > pos_range.end) panic(`slice index starts at ${pos_range.start} but ends at ${pos_range.end}`);
  if (pos_range.end > this.v.length) panic(`range end index ${pos_range.end} out of range for slice of length ${this.v.length}`);
  this.v.splice(pos_range.start, pos_range.end - pos_range.start);
};

// rustc: src/tools/miri/src/data_structures/range_object_map.rs:121 remove_from_pos
RangeObjectMap.prototype.remove_from_pos = function <T>(this: RangeObjectMap<T>, pos: Position): void {
  // `Vec::remove`: panics if `index >= len`.
  if (pos >= this.v.length) panic(`removal index (is ${pos}) should be < len (is ${this.v.length})`);
  this.v.splice(pos, 1);
};

// rustc: src/tools/miri/src/data_structures/range_object_map.rs:125 iter
RangeObjectMap.prototype.iter = function <T>(this: RangeObjectMap<T>): T[] {
  return this.v.map((e) => e.data);
};

// impl<T> Index<Position> for RangeObjectMap<T>
// rustc: src/tools/miri/src/data_structures/range_object_map.rs:133 index
RangeObjectMap.prototype.index = function <T>(this: RangeObjectMap<T>, pos: Position): T {
  return elem_at(this, pos).data;
};

// impl<T> IndexMut<Position> for RangeObjectMap<T>
// rustc: src/tools/miri/src/data_structures/range_object_map.rs:139 index_mut
RangeObjectMap.prototype.index_mut = function <T>(this: RangeObjectMap<T>, pos: Position): T {
  return elem_at(this, pos).data;
};
