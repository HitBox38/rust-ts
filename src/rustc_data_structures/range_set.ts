// Port of compiler/rustc_data_structures/src/range_set.rs (lane abi-layout-b).
//
// PORT (abi-layout-b): the bounds `T: Copy + Ord + Default + Add<Output = T> + Sub<Output = T>` are a function table
// (`RangeSetOps<T>`, PORTING §5 "Generic trait bounds"), held by the set: `RangeSet::new()` is `RangeSet.new(ops)`.
// The only instantiation is rustc_abi's `RangeSet<Size>` (layout/ty.ts `SIZE_RANGE_SET_OPS`).
import { type Debug, debug_tuple, debug_vec, type Fmt } from "../std/fmt.ts";

/** The `T: Copy + Ord + Default + Add + Sub` bounds of `impl RangeSet<T>` (module comment). */
export interface RangeSetOps<T> {
  /** `T::default()` */
  default_(): T;
  /** `Ord::cmp` (negative / zero / positive) */
  cmp(a: T, b: T): number;
  /** `Add::add` */
  add(a: T, b: T): T;
  /** `Sub::sub` */
  sub(a: T, b: T): T;
}

/// Represents a set of `Size` values as a sorted list of ranges.
///
/// These are (offset, length) pairs, and they are sorted and mutually disjoint,
/// and never adjacent (i.e. there's always a gap between two of them).
// #[derive(Debug, Clone)]
export class RangeSet<T> {
  constructor(
    public _0: [T, T][],
    /** PORT: the bounds' function table (module comment). */
    readonly ops: RangeSetOps<T>,
  ) {}

  // rustc: compiler/rustc_data_structures/src/range_set.rs:14 new
  static new<T>(ops: RangeSetOps<T>): RangeSet<T> {
    return new RangeSet<T>([], ops);
  }

  // rustc: compiler/rustc_data_structures/src/range_set.rs:18 add_range
  add_range(offset: T, size: T): void {
    const o = this.ops;
    if (o.cmp(size, o.default_()) === 0) {
      // No need to track empty ranges.
      return;
    }
    const v = this._0;
    // We scan for a partition point where the left partition is all the elements that end
    // strictly before we start. Those are elements that are too "low" to merge with us.
    const idx = partition_point(v, ([other_offset, other_size]) => o.cmp(o.add(other_offset, other_size), offset) < 0);
    // Now we want to either merge with the first element of the second partition, or insert ourselves before that.
    const at = v[idx];
    if (at !== undefined && o.cmp(o.add(offset, size), at[0]) >= 0) {
      const [other_offset, other_size] = at;
      // Their end is >= our start (otherwise it would not be in the 2nd partition) and
      // our end is >= their start. This means we can merge the ranges.
      const new_start = ord_min(o, other_offset, offset);
      let new_end = ord_max(o, o.add(other_offset, other_size), o.add(offset, size));
      // We grew to the right, so merge with overlapping/adjacent elements.
      // (We also may have grown to the left, but that can never make us adjacent with
      // anything there since we selected the first such candidate via `partition_point`.)
      let scan_right = 1;
      for (;;) {
        const next = v[idx + scan_right];
        if (next === undefined || !(o.cmp(new_end, next[0]) >= 0)) break;
        const [next_offset, next_size] = next;
        // Increase our size to absorb the next element.
        new_end = ord_max(o, new_end, o.add(next_offset, next_size));
        // Look at the next element.
        scan_right += 1;
      }
      // Update the element we grew.
      v[idx] = [new_start, o.sub(new_end, new_start)];
      // Remove the elements we absorbed (if any).
      if (scan_right > 1) {
        v.splice(idx + 1, scan_right - 1);
      }
    } else {
      // Insert new element.
      v.splice(idx, 0, [offset, size]);
    }
  }

  /// The ranges from `self` with any intersection with `other` removed.
  // rustc: compiler/rustc_data_structures/src/range_set.rs:61 difference
  difference(other: RangeSet<T>): RangeSet<T> {
    const o = this.ops;
    const [a, b] = [this, other];
    const out: [T, T][] = [];

    let j = 0;
    for (const [a_offset, a_size] of a._0) {
      let cursor = a_offset;
      const a_end = o.add(a_offset, a_size);

      // Skip ranges of `b` that end before this range of `a` begins.
      // both sequences are sorted they cannot overlap any later range of `a` either.
      for (;;) {
        const bj = b._0[j];
        if (bj === undefined || !(o.cmp(o.add(bj[0], bj[1]), cursor) <= 0)) break;
        j += 1;
      }

      // Carve out each range of `b` that overlaps this range of `a`. A range of `b` may extend
      // past `a_end` and overlap the next range of `a`, so leave `j` pointing at it.
      let k = j;
      for (;;) {
        const bk = b._0[k];
        if (bk === undefined || !(o.cmp(bk[0], a_end) < 0)) break;
        const [b_offset, b_size] = bk;
        if (o.cmp(b_offset, cursor) > 0) {
          // PORT: upstream pushes `(cursor, b_offset)` (an end, not a length) here and `(cursor, a_end)` below; kept as is.
          out.push([cursor, b_offset]);
        }
        cursor = ord_max(o, cursor, o.add(b_offset, b_size));
        k += 1;
      }

      // Keep the remainder of the `a`'s range.
      if (o.cmp(cursor, a_end) < 0) {
        out.push([cursor, a_end]);
      }
    }

    return new RangeSet(out, o);
  }
}
// derive(Debug)
export function debug_RangeSet<T>(v: RangeSet<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_tuple(f, "RangeSet", [debug_vec(v._0, f, (p, f) => debug_tuple(f, "", [debug_T(p[0], f), debug_T(p[1], f)]))]);
}

/** `<[T]>::partition_point` (core slice): the binary search of core (`binary_search_by`), returning the first index
 * whose element does not satisfy `pred`. */
function partition_point<E>(v: readonly E[], pred: (e: E) => boolean): number {
  // PORT: the result of `partition_point` is unique for a partitioned slice, so the search strategy is not observable.
  let lo = 0;
  let hi = v.length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (pred(v[mid]!)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `Ord::min` (`self` on ties). */
function ord_min<T>(o: RangeSetOps<T>, a: T, b: T): T {
  return o.cmp(b, a) < 0 ? b : a;
}
/** `Ord::max` (`other` on ties). */
function ord_max<T>(o: RangeSetOps<T>, a: T, b: T): T {
  return o.cmp(b, a) >= 0 ? b : a;
}
