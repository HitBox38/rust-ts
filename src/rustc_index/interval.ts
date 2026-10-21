// Port of compiler/rustc_index/src/interval.rs (lane index-ds).
//
// PORT: `I: Idx` is a number-like index (`I::new(i)` / `i.index()` are the identity). The `(u32, u32)` pairs of `map`
// are `[number, number]` tuples owned by one set (`Clone` copies them), so `self.map[right].1 = end` mutates in place.
// `u32` additions that can wrap in release builds (`end + 1`, ...) go through `u32_inc`. `std::ops::Range<I>` (what
// `iter_intervals` yields) is a `{ start, end }` object; `impl RangeBounds<I>` arguments are `RangeBounds<I>`
// (rustc_index/idx.ts). Iterators are generators.
import { debug_list, debug_struct, debug_tuple, type Fmt } from "../std/fmt.ts";
import { assert, assert_eq } from "../std/panic.ts";
import { partition_point } from "../std/slice.ts";
import { range, type RangeBounds } from "./idx.ts";
import { IndexSlice } from "./slice.ts";
import { IndexVec } from "./vec.ts";

/** `std::ops::Range<I>` (`start..end`). */
export interface Range<I extends number> {
  start: I;
  end: I;
}

/** `x + 1` on a `u32` (wraps, as rustc is built without overflow checks). */
function u32_inc(x: number): number {
  return (x + 1) >>> 0;
}

/// Stores a set of intervals on the indices.
///
/// The elements in `map` are sorted and non-adjacent, which means
/// the second value of the previous element is *greater* than the
/// first value of the following element.
// rustc-type: compiler/rustc_index/src/interval.rs:19 IntervalSet
export class IntervalSet<I extends number = number> {
  /** `_data: PhantomData<I>` (erased). */
  declare readonly __i?: I;

  constructor(
    // Start, end (both inclusive)
    public map: [number, number][],
    public domain: number,
  ) {}

  // rustc: compiler/rustc_index/src/interval.rs:46 new
  static new<I extends number>(domain: number): IntervalSet<I> {
    return new IntervalSet<I>([], domain);
  }

  // rustc: compiler/rustc_index/src/interval.rs:50 clear
  clear(): void {
    this.map.length = 0;
  }

  // rustc: compiler/rustc_index/src/interval.rs:54 iter
  *iter(): Generator<I> {
    for (const r of this.iter_intervals()) {
      for (let i = r.start; i < r.end; i++) yield i as I;
    }
  }

  /// Iterates through intervals stored in the set, in order.
  // rustc: compiler/rustc_index/src/interval.rs:62 iter_intervals
  *iter_intervals(): Generator<Range<I>> {
    for (const [start, end] of this.map) {
      yield { start: start as I, end: (end + 1) as I };
    }
  }

  /// Returns true if we increased the number of elements present.
  // rustc: compiler/rustc_index/src/interval.rs:70 insert
  insert(point: I): boolean {
    return this.insert_range({ start_bound: { $: "Included", _0: point }, end_bound: { $: "Included", _0: point } });
  }

  /// Returns true if we increased the number of elements present.
  // rustc: compiler/rustc_index/src/interval.rs:75 insert_range
  insert_range(range: RangeBounds<I>): boolean {
    const start = inclusive_start(range);
    const end = inclusive_end(this.domain, range);
    if (end === undefined) {
      // empty range
      return false;
    }
    if (start > end) {
      return false;
    }

    // This condition looks a bit weird, but actually makes sense.
    //
    // if r.0 == end + 1, then we're actually adjacent, so we want to
    // continue to the next range. We're looking here for the first
    // range which starts *non-adjacently* to our end.
    const next = partition_point(this.map, (r) => r[0] <= u32_inc(end));
    let result: boolean;
    if (next >= 1) {
      const right = next - 1;
      const [prev_start, prev_end] = this.map[right]!;
      if (u32_inc(prev_end) >= start) {
        // If the start for the inserted range is adjacent to the
        // end of the previous, we can extend the previous range.
        if (start < prev_start) {
          // The first range which ends *non-adjacently* to our start.
          // And we can ensure that left <= right.
          const left = partition_point(this.map, (l) => u32_inc(l[1]) < start);
          const min = Math.min(this.map[left]![0], start);
          const max = Math.max(prev_end, end);
          this.map[right] = [min, max];
          if (left !== right) {
            this.map.splice(left, right - left);
          }
          result = true;
        } else {
          // We overlap with the previous range, increase it to
          // include us.
          //
          // Make sure we're actually going to *increase* it though --
          // it may be that end is just inside the previously existing
          // set.
          if (end > prev_end) {
            this.map[right]![1] = end;
            result = true;
          } else {
            result = false;
          }
        }
      } else {
        // Otherwise, we don't overlap, so just insert
        this.map.splice(right + 1, 0, [start, end]);
        result = true;
      }
    } else {
      if (this.map.length === 0) {
        // Quite common in practice, and expensive to call memcpy
        // with length zero.
        this.map.push([start, end]);
      } else {
        this.map.splice(next, 0, [start, end]);
      }
      result = true;
    }
    // debug_assert!(
    //     self.check_invariants(),
    //     "wrong intervals after insert {start:?}..={end:?} to {self:?}"
    // );
    return result;
  }

  /// Specialized version of `insert` when we know that the inserted point is *after* any
  /// contained.
  // rustc: compiler/rustc_index/src/interval.rs:145 append
  append(point_: I): void {
    const point = point_ >>> 0;

    const last = this.map[this.map.length - 1];
    if (last !== undefined) {
      const last_end = last[1];
      assert(last_end <= point, "assertion failed: *last_end <= point");
      if (point === last_end) {
        // The point is already in the set.
      } else if (point === u32_inc(last_end)) {
        last[1] = point;
      } else {
        this.map.push([point, point]);
      }
    } else {
      this.map.push([point, point]);
    }

    // debug_assert!(
    //     self.check_invariants(),
    //     "wrong intervals after append {point:?} to {self:?}"
    // );
  }

  /// Specialized version of `insert_range` when we know that the inserted point is *after* any
  /// contained.
  // rustc: compiler/rustc_index/src/interval.rs:169 append_range
  append_range(range: RangeBounds<I>): void {
    const start = inclusive_start(range);
    const end = inclusive_end(this.domain, range);
    if (end === undefined) {
      // empty range
      return;
    }
    if (start > end) {
      return;
    }

    const last = this.map[this.map.length - 1];
    if (last !== undefined) {
      const last_end = last[1];
      assert(last_end <= start, "assertion failed: *last_end <= start");
      // The start is already adjacent to the set.
      if (start <= u32_inc(last_end)) {
        last[1] = end;
      } else {
        this.map.push([start, end]);
      }
    } else {
      this.map.push([start, end]);
    }

    // debug_assert!(
    //     self.check_invariants(),
    //     "wrong intervals after append {start:?}..={end:?} to {self:?}"
    // );
  }

  // rustc: compiler/rustc_index/src/interval.rs:197 contains
  contains(needle_: I): boolean {
    const needle = needle_ >>> 0;
    const pp = partition_point(this.map, (r) => r[0] <= needle);
    if (pp === 0) {
      // All ranges in the map start after the new range's end
      return false;
    }
    const last = pp - 1;
    const [, prev_end] = this.map[last]!;
    return needle <= prev_end;
  }

  // rustc: compiler/rustc_index/src/interval.rs:207 superset
  superset(other: IntervalSet<I>): boolean {
    const sup_iter = this.iter_intervals();
    const current: { value: Range<I> | undefined } = { value: undefined };
    const contains = (sup: Range<I>, sub: Range<I>, current: { value: Range<I> | undefined }): boolean | undefined => {
      if (sup.end < sub.start) {
        // if `sup.end == sub.start`, the next sup doesn't contain `sub.start`
        return undefined; // continue to the next sup
      } else if (sup.end >= sub.end && sup.start <= sub.start) {
        current.value = sup; // save the current sup
        return true;
      } else {
        return false;
      }
    };
    for (const sub of other.iter_intervals()) {
      // `current.take().and_then(|sup| contains(sup, sub.clone(), &mut current))`
      const taken = current.value;
      current.value = undefined;
      let r = taken !== undefined ? contains(taken, { ...sub }, current) : undefined;
      // `.or_else(|| sup_iter.find_map(|sup| contains(sup, sub.clone(), &mut current)))`
      if (r === undefined) {
        for (;;) {
          const n = sup_iter.next();
          if (n.done) break;
          const x = contains(n.value, { ...sub }, current);
          if (x !== undefined) {
            r = x;
            break;
          }
        }
      }
      // `.unwrap_or(false)`
      if (!(r ?? false)) return false;
    }
    return true;
  }

  // rustc: compiler/rustc_index/src/interval.rs:233 disjoint
  disjoint(other: IntervalSet<I>): boolean {
    const helper = (): boolean | undefined => {
      const self_iter = this.iter_intervals();
      const other_iter = other.iter_intervals();

      let s = self_iter.next();
      if (s.done) return undefined;
      let self_current = s.value;
      let o = other_iter.next();
      if (o.done) return undefined;
      let other_current = o.value;

      for (;;) {
        if (self_current.end <= other_current.start) {
          s = self_iter.next();
          if (s.done) return undefined;
          self_current = s.value;
          continue;
        }
        if (other_current.end <= self_current.start) {
          o = other_iter.next();
          if (o.done) return undefined;
          other_current = o.value;
          continue;
        }
        return false;
      }
    };
    return helper() ?? true;
  }

  // rustc: compiler/rustc_index/src/interval.rs:259 is_empty
  is_empty(): boolean {
    return this.map.length === 0;
  }

  /// Equivalent to `range.iter().find(|i| !self.contains(i))`.
  // rustc: compiler/rustc_index/src/interval.rs:264 first_unset_in
  first_unset_in(range: RangeBounds<I>): I | undefined {
    const start = inclusive_start(range);
    const end = inclusive_end(this.domain, range);
    if (end === undefined) {
      // empty range
      return undefined;
    }
    if (start > end) {
      return undefined;
    }
    const pp = partition_point(this.map, (r) => r[0] <= start);
    if (pp === 0) {
      // All ranges in the map start after the new range's end
      return start as I;
    }
    const last = pp - 1;
    const [, prev_end] = this.map[last]!;
    if (start > prev_end) {
      return start as I;
    } else if (prev_end < end) {
      return (prev_end + 1) as I;
    } else {
      return undefined;
    }
  }

  /// Returns the maximum (last) element present in the set from `range`.
  // rustc: compiler/rustc_index/src/interval.rs:288 last_set_in
  last_set_in(range: RangeBounds<I>): I | undefined {
    const start = inclusive_start(range);
    const end = inclusive_end(this.domain, range);
    if (end === undefined) {
      // empty range
      return undefined;
    }
    if (start > end) {
      return undefined;
    }
    const pp = partition_point(this.map, (r) => r[0] <= end);
    if (pp === 0) {
      // All ranges in the map start after the new range's end
      return undefined;
    }
    const last = pp - 1;
    const [, prev_end] = this.map[last]!;
    if (start <= prev_end) {
      return Math.min(prev_end, end) as I;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_index/src/interval.rs:305 insert_all
  insert_all(): void {
    this.clear();
    if (this.domain >= 1) {
      const end = this.domain - 1;
      // `end.try_into().unwrap()`
      assert(end <= 0xffff_ffff, "called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
      this.map.push([0, end]);
    }
    // debug_assert!(self.check_invariants());
  }

  // rustc: compiler/rustc_index/src/interval.rs:313 union
  union(other: IntervalSet<I>): boolean {
    assert_eq(this.domain, other.domain, String);
    if (this.map.length < other.map.length) {
      const backup = this.clone();
      // `self.map.clone_from(&other.map)`
      this.map = other.map.map(([a, b]) => [a, b]);
      return this.union(backup);
    }

    let did_insert = false;
    for (const r of other.iter_intervals()) {
      if (this.insert_range(range(r.start, r.end))) did_insert = true;
    }
    // debug_assert!(self.check_invariants());
    return did_insert;
  }

  // Check the intervals are valid, sorted and non-adjacent
  // rustc: compiler/rustc_index/src/interval.rs:333 check_invariants
  check_invariants(): boolean {
    let current: number | undefined = undefined;
    for (const [start, end] of this.map) {
      if (start > end || (current !== undefined && u32_inc(current) >= start)) {
        return false;
      }
      current = end;
    }
    return current === undefined || current < this.domain >>> 0;
  }

  /** `#[derive(Clone)]` */
  clone(): IntervalSet<I> {
    return new IntervalSet<I>(
      this.map.map(([a, b]) => [a, b]),
      this.domain,
    );
  }
}

/**
 * `#[derive(Debug)]` of `IntervalSet`: `IntervalSet { map: [(s, e), ..], domain: N, _data: PhantomData<I> }`.
 * `type_name_I` is `std::any::type_name::<I>()` (erased here).
 */
export function debug_IntervalSet<I extends number>(self: IntervalSet<I>, f: Fmt, type_name_I: string): string {
  return debug_struct(f, "IntervalSet", [
    [
      "map",
      debug_list(
        f,
        self.map.map(([a, b]) => debug_tuple(f, "", [String(a), String(b)])),
      ),
    ],
    ["domain", String(self.domain)],
    ["_data", `PhantomData<${type_name_I}>`],
  ]);
}

// rustc: compiler/rustc_index/src/interval.rs:27 inclusive_start
function inclusive_start<T extends number>(range: RangeBounds<T>): number {
  const b = range.start_bound;
  switch (b.$) {
    case "Included":
      return b._0 >>> 0;
    case "Excluded":
      return ((b._0 >>> 0) + 1) >>> 0;
    case "Unbounded":
      return 0;
  }
}

// rustc: compiler/rustc_index/src/interval.rs:36 inclusive_end
function inclusive_end<T extends number>(domain: number, range: RangeBounds<T>): number | undefined {
  const b = range.end_bound;
  let end: number;
  switch (b.$) {
    case "Included":
      end = b._0 >>> 0;
      break;
    case "Excluded":
      // `end.index().checked_sub(1)? as u32`
      if (b._0 === 0) return undefined;
      end = (b._0 - 1) >>> 0;
      break;
    case "Unbounded":
      // `domain.checked_sub(1)? as u32`
      if (domain === 0) return undefined;
      end = (domain - 1) >>> 0;
      break;
  }
  return end;
}

/// This data structure optimizes for cases where the stored bits in each row
/// are expected to be highly contiguous (long ranges of 1s or 0s), in contrast
/// to BitMatrix and SparseBitMatrix which are optimized for
/// "random"/non-contiguous bits and cheap(er) point queries at the expense of
/// memory usage.
// rustc-type: compiler/rustc_index/src/interval.rs:351 SparseIntervalMatrix
export class SparseIntervalMatrix<R extends number, C extends number> {
  constructor(
    public rows_: IntervalSet<C>[],
    public column_size: number,
  ) {}

  // rustc: compiler/rustc_index/src/interval.rs:361 new
  static new<R extends number, C extends number>(column_size: number): SparseIntervalMatrix<R, C> {
    return new SparseIntervalMatrix<R, C>(IndexVec.new(), column_size);
  }

  // rustc: compiler/rustc_index/src/interval.rs:365 rows
  rows(): Generator<R> {
    return IndexSlice.indices<R, IntervalSet<C>>(this.rows_);
  }

  // rustc: compiler/rustc_index/src/interval.rs:369 row
  row(row: R): IntervalSet<C> | undefined {
    return row < this.rows_.length ? this.rows_[row] : undefined;
  }

  // rustc: compiler/rustc_index/src/interval.rs:373 iter_enumerated
  iter_enumerated(): Generator<[R, IntervalSet<C>]> {
    return IndexSlice.iter_enumerated<R, IntervalSet<C>>(this.rows_);
  }

  // rustc: compiler/rustc_index/src/interval.rs:377 ensure_row
  ensure_row(row: R): IntervalSet<C> {
    return IndexVec.ensure_contains_elem(this.rows_, row, () => IntervalSet.new<C>(this.column_size));
  }

  // rustc: compiler/rustc_index/src/interval.rs:381 union_row
  union_row(row: R, from: IntervalSet<C>): boolean {
    return this.ensure_row(row).union(from);
  }

  // rustc: compiler/rustc_index/src/interval.rs:388 union_rows
  union_rows(read: R, write: R): boolean {
    if (read === write || this.row(read) === undefined) {
      return false;
    }
    this.ensure_row(write);
    const [read_row, write_row] = IndexSlice.pick2_mut(this.rows_, read, write);
    return write_row.union(read_row);
  }

  // rustc: compiler/rustc_index/src/interval.rs:400 insert_all_into_row
  insert_all_into_row(row: R): void {
    this.ensure_row(row).insert_all();
  }

  // rustc: compiler/rustc_index/src/interval.rs:404 insert_range
  insert_range(row: R, range: RangeBounds<C>): void {
    this.ensure_row(row).insert_range(range);
  }

  // rustc: compiler/rustc_index/src/interval.rs:408 insert
  insert(row: R, point: C): boolean {
    return this.ensure_row(row).insert(point);
  }

  // rustc: compiler/rustc_index/src/interval.rs:412 append
  append(row: R, point: C): void {
    this.ensure_row(row).append(point);
  }

  // rustc: compiler/rustc_index/src/interval.rs:416 append_range
  append_range(row: R, point: RangeBounds<C>): void {
    this.ensure_row(row).append_range(point);
  }

  // rustc: compiler/rustc_index/src/interval.rs:420 contains
  contains(row: R, point: C): boolean {
    const r = this.row(row);
    return r !== undefined && r.contains(point);
  }

  /** `#[derive(Clone)]` */
  clone(): SparseIntervalMatrix<R, C> {
    return new SparseIntervalMatrix<R, C>(
      this.rows_.map((r) => r.clone()),
      this.column_size,
    );
  }
}
