//! Implements a map from integer indices to data.
//! Rather than storing data for every index, internally, this maps entire ranges to the data.
//! To this end, the APIs all work on ranges, not on individual integers. Ranges are split as
//! necessary (e.g., when [0,5) is first associated with X, and then [1,2) is mutated).
//! Users must not depend on whether a range is coalesced or not, even though this is observable
//! via the iteration APIs.
// Port of src/tools/miri/src/data_structures/dedup_range_map.rs (crate `miri`, plan-m6 D2; lane miri-driver, wave 36).
// Its types are generated into dedup_range_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT (decision miri-contract C5 amendment, lane interp-miri-reconcile): `Elem.range: ops::Range<u64>` is
// `{ start: number; end: number }` (typemap `fields`): the ranges are byte offsets into one allocation, whose size is a
// `Size` (a number), and every Stacked Borrows / data-race / weak-memory range lookup goes through them.
// PORT (lane miri-driver): range objects are values: the map never mutates one in place (a split or a merge stores a new
// `{ start, end }`), so the iterators yield the element's own range object where upstream yields `elem.range.clone()`.
// PORT (lane miri-driver): the `T: Clone` / `T: PartialEq` bounds of `split_index`, `iter_mut` and
// `merge_adjacent_thorough` are function parameters (`clone_T`, `eq_T`; PORTING §5 "generic code over the trait takes the
// needed functions as parameters"). The iterators are eager arrays: upstream's iterator construction (the `find_offset`,
// the bounds assert, and `iter_mut`'s splitting/merging) runs when the fn is called, and the lazy `take_while`/`map` part
// has no side effects. The `&mut T` the mutable iterators yield is the element's `data` (mutated in place by the caller);
// for a caller that assigns the whole value (`*loc = state`), the third tuple element is the element itself
// (`elem.data = state`).
import { DedupRangeMap, type Elem } from "./dedup_range_map.gen.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { assert, assert_eq, panic } from "../../std/panic.ts";
import { binary_search_by } from "../../std/slice.ts";
export * from "./dedup_range_map.gen.ts";

/** `ops::Range<u64>` of an element (PORT: numbers, C5 amendment; never mutated in place). */
export type DedupRange = { readonly start: number; readonly end: number };

declare module "./dedup_range_map.gen.ts" {
  interface DedupRangeMap<T> {
    // data_structures/dedup_range_map.rs:34
    size(): Size;
    // data_structures/dedup_range_map.rs:40
    find_offset(offset: number): number;
    // data_structures/dedup_range_map.rs:65
    iter(offset: Size, len: Size): [DedupRange, T][];
    // data_structures/dedup_range_map.rs:90
    iter_mut_all(): [DedupRange, T, Elem<T>][];
    // data_structures/dedup_range_map.rs:98
    iter_all(): [DedupRange, T][];
    // data_structures/dedup_range_map.rs:105
    split_index(index: number, split_offset: number, clone_T: (v: T) => T): boolean;
    // data_structures/dedup_range_map.rs:137
    iter_mut(offset: Size, len: Size, clone_T: (v: T) => T, eq_T: (a: T, b: T) => boolean): [DedupRange, T, Elem<T>][];
    // data_structures/dedup_range_map.rs:226
    merge_adjacent_thorough(eq_T: (a: T, b: T) => boolean): void;
  }
  namespace DedupRangeMap {
    // data_structures/dedup_range_map.rs:28
    function new_<T>(size: Size, init: T): DedupRangeMap<T>;
    export { new_ as new };
  }
}

/** `self.v[index]` (panics like a slice index out of bounds). */
function elem_at<T>(m: DedupRangeMap<T>, index: number): Elem<T> {
  const e = m.v[index];
  if (e === undefined) panic(`index out of bounds: the len is ${m.v.length} but the index is ${index}`);
  return e;
}

/// Creates a new `RangeMap` for the given size, and with the given initial value used for
/// the entire range.
// #[inline(always)]
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:28 new
DedupRangeMap.new = function <T>(size_: Size, init: T): DedupRangeMap<T> {
  const size = size_.bytes();
  const v: Elem<T>[] = size > 0 ? [{ range: { start: 0, end: size }, data: init }] : [];
  return new DedupRangeMap(v);
};

// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:34 size
DedupRangeMap.prototype.size = function <T>(this: DedupRangeMap<T>): Size {
  const last = this.v[this.v.length - 1];
  const size = last !== undefined ? last.range.end : 0;
  return Size.from_bytes(size);
};

/// Finds the index containing the given offset.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:40 find_offset
DedupRangeMap.prototype.find_offset = function <T>(this: DedupRangeMap<T>, offset: number): number {
  const r = binary_search_by(this.v, (elem): -1 | 0 | 1 => {
    if (offset < elem.range.start) {
      // We are too far right (offset is further left).
      // (`Greater` means that `elem` is greater than the desired target.)
      return 1;
    } else if (offset >= elem.range.end) {
      // We are too far left (offset is further right).
      return -1;
    } else {
      // This is it!
      return 0;
    }
  });
  // `.unwrap()`
  if (!r.ok) panic(`called \`Result::unwrap()\` on an \`Err\` value: ${r.i}`);
  return r.i;
};

/// Provides read-only iteration over everything in the given range. This does
/// *not* split items if they overlap with the edges. Do not use this to mutate
/// through interior mutability.
///
/// The iterator also provides the range of the given element.
/// How exactly the ranges are split can differ even for otherwise identical
/// maps, so user-visible behavior should never depend on the exact range.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:65 iter
DedupRangeMap.prototype.iter = function <T>(this: DedupRangeMap<T>, offset_: Size, len_: Size): [DedupRange, T][] {
  const offset = offset_.bytes();
  const len = len_.bytes();
  // Compute a slice starting with the elements we care about.
  let first_idx: number;
  if (len === 0) {
    // We just need any empty iterator. We don't even want to
    // yield the element that surrounds this position.
    first_idx = this.v.length;
  } else {
    first_idx = this.find_offset(offset);
  }
  // The first offset that is not included any more.
  const end = offset + len;
  assert(end <= this.size().bytes(), "iterating beyond the bounds of this RangeMap");
  const out: [DedupRange, T][] = [];
  for (let i = first_idx; i < this.v.length; i++) {
    const elem = this.v[i]!;
    if (!(elem.range.start < end)) break;
    out.push([elem.range, elem.data]);
  }
  return out;
};

/// Provides mutable iteration over all elements.
/// The iterator also provides the range of the given element.
/// How exactly the ranges are split can differ even for otherwise identical
/// maps, so user-visible behavior should never depend on the exact range.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:90 iter_mut_all
DedupRangeMap.prototype.iter_mut_all = function <T>(this: DedupRangeMap<T>): [DedupRange, T, Elem<T>][] {
  return this.v.map((elem): [DedupRange, T, Elem<T>] => [elem.range, elem.data, elem]);
};

/// Provides iteration over all elements.
/// The iterator also provides the range of the given element.
/// How exactly the ranges are split can differ even for otherwise identical
/// maps, so user-visible behavior should never depend on the exact range.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:98 iter_all
DedupRangeMap.prototype.iter_all = function <T>(this: DedupRangeMap<T>): [DedupRange, T][] {
  return this.v.map((elem): [DedupRange, T] => [elem.range, elem.data]);
};

// Splits the element situated at the given `index`, such that the 2nd one starts at offset
// `split_offset`. Do nothing if the element already starts there.
// Returns whether a split was necessary.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:105 split_index
DedupRangeMap.prototype.split_index = function <T>(
  this: DedupRangeMap<T>,
  index: number,
  split_offset: number,
  clone_T: (v: T) => T,
): boolean {
  const elem = elem_at(this, index);
  if (split_offset === elem.range.start || split_offset === elem.range.end) {
    // Nothing to do.
    return false;
  }
  // debug_assert!(
  //     elem.range.contains(&split_offset),
  //     "the `split_offset` is not in the element to be split"
  // );

  // Now we really have to split. Reduce length of first element.
  const second_range = { start: split_offset, end: elem.range.end };
  elem.range = { start: elem.range.start, end: split_offset };
  // Copy the data, and insert second element.
  const second: Elem<T> = { range: second_range, data: clone_T(elem.data) };
  this.v.splice(index + 1, 0, second);
  return true;
};

/// Provides mutable iteration over everything in the given range. As a side-effect,
/// this will split entries in the map that are only partially hit by the given range,
/// to make sure that when they are mutated, the effect is constrained to the given range.
/// Moreover, this will opportunistically merge neighbouring equal blocks.
///
/// The iterator also provides the range of the given element.
/// How exactly the ranges are split (both prior to and resulting from the execution of this
/// function) can differ even for otherwise identical maps,
/// so user-visible behavior should never depend on the exact range.
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:137 iter_mut
DedupRangeMap.prototype.iter_mut = function <T>(
  this: DedupRangeMap<T>,
  offset_: Size,
  len_: Size,
  clone_T: (v: T) => T,
  eq_T: (a: T, b: T) => boolean,
): [DedupRange, T, Elem<T>][] {
  const offset = offset_.bytes();
  const len = len_.bytes();
  // Compute a slice containing exactly the elements we care about
  if (len === 0) {
    // We just need any empty iterator. We don't even want to
    // yield the element that surrounds this position, nor do
    // any splitting.
    return [];
  }
  // Make sure we got a clear beginning
  let first_idx_ = this.find_offset(offset);
  if (this.split_index(first_idx_, offset, clone_T)) {
    // The newly created 2nd element is ours
    first_idx_ += 1;
  }
  // No more mutation.
  const first_idx = first_idx_;
  // Find our end. Linear scan, but that's ok because the iteration
  // is doing the same linear scan anyway -- no increase in complexity.
  // We combine this scan with a scan for duplicates that we can merge, to reduce
  // the number of elements.
  // We stop searching after the first "block" of size 1, to avoid spending excessive
  // amounts of time on the merging.
  let equal_since_idx = first_idx;
  // Once we see too many non-mergeable blocks, we stop.
  // The initial value is chosen via... magic. Benchmarking and magic.
  let successful_merge_count = 3;
  // When the loop is done, this is the first excluded element.
  let end_idx_ = first_idx;
  for (;;) {
    // Compute if `end` is the last element we need to look at.
    const done = elem_at(this, end_idx_).range.end >= offset + len;
    // We definitely need to include `end`, so move the index.
    end_idx_ += 1;
    // debug_assert!(
    //     done || end_idx < self.v.len(),
    //     "iter_mut: end-offset {} is out-of-bounds",
    //     offset + len
    // );
    // see if we want to merge everything in `equal_since..end` (exclusive at the end!)
    if (successful_merge_count > 0) {
      if (done || !eq_T(elem_at(this, end_idx_).data, elem_at(this, equal_since_idx).data)) {
        // Everything in `equal_since..end` was equal. Make them just one element covering
        // the entire range.
        const removed_elems = end_idx_ - equal_since_idx - 1; // number of elements that we would remove
        if (removed_elems > 0) {
          // Adjust the range of the first element to cover all of them.
          const equal_until = this.v[end_idx_ - 1]!.range.end; // end of range of last of the equal elements
          const first = this.v[equal_since_idx]!;
          first.range = { start: first.range.start, end: equal_until };
          // Delete the rest of them.
          this.v.splice(equal_since_idx + 1, end_idx_ - (equal_since_idx + 1));
          // Adjust `end_idx` because we made the list shorter.
          end_idx_ -= removed_elems;
          // Adjust the count for the cutoff.
          successful_merge_count += removed_elems;
        } else {
          // Adjust the count for the cutoff.
          successful_merge_count -= 1;
        }
        // Go on scanning for the next block starting here.
        equal_since_idx = end_idx_;
      }
    }
    // Leave loop if this is the last element.
    if (done) {
      break;
    }
  }
  // Move to last included instead of first excluded index.
  const end_idx = end_idx_ - 1;
  // We need to split the end as well. Even if this performs a
  // split, we don't have to adjust our index as we only care about
  // the first part of the split.
  this.split_index(end_idx, offset + len, clone_T);
  // Now we yield the slice. `end` is inclusive.
  const out: [DedupRange, T, Elem<T>][] = [];
  for (let i = first_idx; i <= end_idx; i++) {
    const elem = this.v[i]!;
    out.push([elem.range, elem.data, elem]);
  }
  return out;
};

/// Remove all adjacent duplicates
// rustc: src/tools/miri/src/data_structures/dedup_range_map.rs:226 merge_adjacent_thorough
DedupRangeMap.prototype.merge_adjacent_thorough = function <T>(this: DedupRangeMap<T>, eq_T: (a: T, b: T) => boolean): void {
  const clean: Elem<T>[] = [];
  const old = this.v;
  this.v = clean;
  for (const elem of old) {
    const prev = this.v[this.v.length - 1];
    if (prev !== undefined) {
      if (eq_T(prev.data, elem.data)) {
        assert_eq(prev.range.end, elem.range.start, String);
        prev.range = { start: prev.range.start, end: elem.range.end };
        continue;
      }
    }
    this.v.push(elem);
  }
};
