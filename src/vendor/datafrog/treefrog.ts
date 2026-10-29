// Port of datafrog =2.0.1 `src/treefrog.rs`.
//
// PORT: traits.
// - `Leaper<'leap, Tuple, Val>` is the `Leaper<Tuple, Val>` interface, implemented by the leaper classes.
// - `Leapers<'leap, Tuple, Val>` has the same method names (`propose`, `intersect`) with other signatures, so
//   its impls are separate objects: `Leapers_for_tuple` (the `tuple_leapers!` impls for 2..7 leapers, given
//   as an array) and `Leapers_for_<Leaper>` (the single-leaper impls of `ExtendWith`, `PrefixFilter`,
//   `FilterWith`, `FilterAnti`). An `impl Leapers` argument is a `LeapersArg` (one leaper, or an array of
//   leapers for a Rust tuple), turned into its impl by `into_leapers` (Rust's static dispatch).
// - `Vec<&'leap Val>` is `Val[]` (values are immutable); `values.push(&())` pushes `undefined` (`()`).
// - `usize::max_value()` is `Number.MAX_SAFE_INTEGER` (only compared with other counts, which are lengths).
// - `PhantomData` fields are erased; the `'leap` lifetime is erased.
//
//! Join functionality.

import { assert, assert_eq, panic } from "../../std/panic.ts";
import { binary_search_by } from "../../std/slice.ts";
import { gallop } from "./join.ts";
import { cmp, type Ord, Relation } from "./lib.ts";

/** PORT: `usize::max_value()` (see the header). */
const usize_max_value = Number.MAX_SAFE_INTEGER;

const debug_usize = (v: number): string => String(v);

/// Performs treefrog leapjoin using a list of leapers.
// crate: datafrog-2.0.1/src/treefrog.rs:6 leapjoin
export function leapjoin<Tuple extends Ord, Val, Result extends Ord>(
  source: readonly Tuple[],
  leapers_: LeapersArg<Tuple, Val>,
  logic: (tuple: Tuple, val: Val) => Result,
): Relation<Result> {
  const leapers = into_leapers(leapers_);
  const result: Result[] = []; // temp output storage.
  const values: Val[] = []; // temp value storage.

  for (const tuple of source) {
    // Determine which leaper would propose the fewest values.
    let min_index = usize_max_value;
    let min_count = usize_max_value;
    leapers.for_each_count(tuple, (index, count) => {
      if (min_count > count) {
        min_count = count;
        min_index = index;
      }
    });

    // We had best have at least one relation restricting values.
    assert(min_count < usize_max_value, "assertion failed: min_count < usize::max_value()");

    // If there are values to propose:
    if (min_count > 0) {
      // Push the values that `min_index` "proposes" into `values`.
      leapers.propose(tuple, min_index, values);

      // Give other leapers a chance to remove values from
      // anti-joins or filters.
      leapers.intersect(tuple, min_index, values);

      // Push remaining items into result.
      for (const val of values) {
        result.push(logic(tuple, val));
      }
      values.length = 0;
    }
  }

  return Relation.from_vec(result);
}

/// Implemented for a tuple of leapers
export interface Leapers<Tuple, Val> {
  /// Internal method:
  // crate: datafrog-2.0.1/src/treefrog.rs:50 for_each_count
  for_each_count(tuple: Tuple, op: (index: number, count: number) => void): void;

  /// Internal method:
  // crate: datafrog-2.0.1/src/treefrog.rs:53 propose
  propose(tuple: Tuple, min_index: number, values: Val[]): void;

  /// Internal method:
  // crate: datafrog-2.0.1/src/treefrog.rs:56 intersect
  intersect(tuple: Tuple, min_index: number, values: Val[]): void;
}

/** PORT: an `impl Leapers<'leap, Tuple, Val>` argument: one leaper, or an array of 2..7 leapers (a Rust tuple). */
export type LeapersArg<Tuple, Val> = readonly Leaper<Tuple, Val>[] | Leaper<Tuple, Val>;

/** PORT: the static dispatch of a `LeapersArg` to its `Leapers` impl. */
export function into_leapers<Tuple, Val>(leapers: LeapersArg<Tuple, Val>): Leapers<Tuple, Val> {
  if (Array.isArray(leapers)) {
    const ls = leapers as readonly Leaper<Tuple, Val>[];
    if (ls.length < 2 || ls.length > 7) panic(`datafrog: no Leapers impl for a tuple of ${ls.length} leapers`);
    return Leapers_for_tuple(ls);
  }
  if (leapers instanceof ExtendWith) return Leapers_for_ExtendWith(leapers) as Leapers<Tuple, Val>;
  if (leapers instanceof PrefixFilter) return Leapers_for_PrefixFilter(leapers) as Leapers<Tuple, Val>;
  if (leapers instanceof FilterWith) return Leapers_for_FilterWith(leapers) as Leapers<Tuple, Val>;
  if (leapers instanceof FilterAnti) return Leapers_for_FilterAnti(leapers) as Leapers<Tuple, Val>;
  return panic("datafrog: this leaper does not implement `Leapers` on its own");
}

// macro_rules! tuple_leapers { ... }
// tuple_leapers!(A B); tuple_leapers!(A B C); ... tuple_leapers!(A B C D E F G);
/** `impl<'leap, Tuple, Val, A, B, ...> Leapers<'leap, Tuple, Val> for (A, B, ...)` (the `tuple_leapers!` macro). */
export function Leapers_for_tuple<Tuple, Val>(self: readonly Leaper<Tuple, Val>[]): Leapers<Tuple, Val> {
  return {
    // crate: datafrog-2.0.1/src/treefrog.rs:66 for_each_count
    for_each_count(tuple: Tuple, op: (index: number, count: number) => void): void {
      let index = 0;
      for (const Ty of self) {
        const count = Ty.count(tuple);
        op(index, count);
        index += 1;
      }
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:76 propose
    propose(tuple: Tuple, min_index: number, values: Val[]): void {
      let index = 0;
      for (const Ty of self) {
        if (min_index === index) {
          return Ty.propose(tuple, values);
        }
        index += 1;
      }
      panic(`no match found for min_index=${min_index}`);
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:88 intersect
    intersect(tuple: Tuple, min_index: number, values: Val[]): void {
      let index = 0;
      for (const Ty of self) {
        if (min_index !== index) {
          Ty.intersect(tuple, values);
        }
        index += 1;
      }
    },
  };
}

/// Methods to support treefrog leapjoin.
export interface Leaper<Tuple, Val> {
  /// Estimates the number of proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:112 count
  count(prefix: Tuple): number;
  /// Populates `values` with proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:114 propose
  propose(prefix: Tuple, values: Val[]): void;
  /// Restricts `values` to proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:116 intersect
  intersect(prefix: Tuple, values: Val[]): void;
}

// pub(crate) mod filters {

/// A treefrog leaper that tests each of the tuples from the main
/// input (the "prefix"). Use like `PrefixFilter::from(|tuple|
/// ...)`; if the closure returns true, then the tuple is
/// retained, else it will be ignored. This leaper can be used in
/// isolation in which case it just acts like a filter on the
/// input (the "proposed value" will be `()` type).
export class PrefixFilter<Tuple> implements Leaper<Tuple, unknown> {
  constructor(public predicate: (tuple: Tuple) => boolean) {}

  /// Creates a new filter based on the prefix
  // crate: datafrog-2.0.1/src/treefrog.rs:139 from
  static from<Tuple>(predicate: (tuple: Tuple) => boolean): PrefixFilter<Tuple> {
    return new PrefixFilter(predicate);
  }

  // impl<'leap, Tuple, Val, Func> Leaper<'leap, Tuple, Val> for PrefixFilter<Tuple, Func>

  /// Estimates the number of proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:152 count
  count(prefix: Tuple): number {
    if (this.predicate(prefix)) {
      return usize_max_value;
    } else {
      return 0;
    }
  }
  /// Populates `values` with proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:160 propose
  propose(_prefix: Tuple, _values: unknown[]): void {
    panic("PrefixFilter::propose(): variable apparently unbound");
  }
  /// Restricts `values` to proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:164 intersect
  intersect(_prefix: Tuple, _values: unknown[]): void {
    // We can only be here if we returned max_value() above.
  }
}

/** `impl<'leap, Tuple, Func> Leapers<'leap, Tuple, ()> for PrefixFilter<Tuple, Func>` */
export function Leapers_for_PrefixFilter<Tuple>(self: PrefixFilter<Tuple>): Leapers<Tuple, undefined> {
  return {
    // crate: datafrog-2.0.1/src/treefrog.rs:173 for_each_count
    for_each_count(tuple: Tuple, op: (index: number, count: number) => void): void {
      if (self.count(tuple) === 0) {
        op(0, 0);
      } else {
        // we will "propose" the `()` value if the predicate applies
        op(0, 1);
      }
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:182 propose
    propose(_: Tuple, min_index: number, values: undefined[]): void {
      assert_eq(min_index, 0, debug_usize);
      values.push(undefined);
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:187 intersect
    intersect(_: Tuple, min_index: number, values: undefined[]): void {
      assert_eq(min_index, 0, debug_usize);
      assert_eq(values.length, 1, debug_usize);
    },
  };
}

/// A treefrog leaper based on a predicate of prefix and value.
/// Use like `ValueFilter::from(|tuple, value| ...)`. The closure
/// should return true if `value` ought to be retained. The
/// `value` will be a value proposed elsewhere by an `extend_with`
/// leaper.
///
/// This leaper cannot be used in isolation, it must be combined
/// with other leapers.
export class ValueFilter<Tuple, Val> implements Leaper<Tuple, Val> {
  constructor(public predicate: (tuple: Tuple, val: Val) => boolean) {}

  /// Creates a new filter based on the prefix
  // crate: datafrog-2.0.1/src/treefrog.rs:211 from
  static from<Tuple, Val>(predicate: (tuple: Tuple, val: Val) => boolean): ValueFilter<Tuple, Val> {
    return new ValueFilter(predicate);
  }

  // impl<'leap, Tuple, Val, Func> Leaper<'leap, Tuple, Val> for ValueFilter<Tuple, Val, Func>

  /// Estimates the number of proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:224 count
  count(_prefix: Tuple): number {
    return usize_max_value;
  }
  /// Populates `values` with proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:228 propose
  propose(_prefix: Tuple, _values: Val[]): void {
    panic("PrefixFilter::propose(): variable apparently unbound");
  }
  /// Restricts `values` to proposed values.
  // crate: datafrog-2.0.1/src/treefrog.rs:232 intersect
  intersect(prefix: Tuple, values: Val[]): void {
    retain(values, (val) => this.predicate(prefix, val));
  }
}

// } (mod filters)

/// Extension method for relations.
export interface RelationLeaper<Tuple extends Ord> {
  /// Extend with `Val` using the elements of the relation.
  // crate: datafrog-2.0.1/src/treefrog.rs:242 extend_with
  extend_with<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => Key,
  ): ExtendWith<Key, Val, T>;
  /// Extend with `Val` using the complement of the relation.
  // crate: datafrog-2.0.1/src/treefrog.rs:250 extend_anti
  extend_anti<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => Key,
  ): ExtendAnti<Key, Val, T>;
  /// Extend with any value if tuple is present in relation.
  // crate: datafrog-2.0.1/src/treefrog.rs:258 filter_with
  filter_with<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => readonly [Key, Val],
  ): FilterWith<Key, Val, T>;
  /// Extend with any value if tuple is absent from relation.
  // crate: datafrog-2.0.1/src/treefrog.rs:266 filter_anti
  filter_anti<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => readonly [Key, Val],
  ): FilterAnti<Key, Val, T>;
  /** PORT: `Tuple` is only the `Self` type of the impl (`Relation<(Key, Val)>`). */
  readonly elements: Tuple[];
}

// impl<Key: Ord, Val: Ord> RelationLeaper<Key, Val> for Relation<(Key, Val)>: the methods of `Relation`
// (lib.ts; markers treefrog.rs:276, 286, 296, 306).

// pub(crate) mod extend_with {

/// Wraps a Relation<Tuple> as a leaper.
export class ExtendWith<Key extends Ord, Val extends Ord, Tuple extends Ord> implements Leaper<Tuple, Val> {
  constructor(
    public relation: Relation<readonly [Key, Val]>,
    public start: number,
    public end: number,
    public key_func: (tuple: Tuple) => Key,
  ) {}

  /// Constructs a ExtendWith from a relation and key and value function.
  // crate: datafrog-2.0.1/src/treefrog.rs:345 from
  static from<Key extends Ord, Val extends Ord, Tuple extends Ord>(
    relation: Relation<readonly [Key, Val]>,
    key_func: (tuple: Tuple) => Key,
  ): ExtendWith<Key, Val, Tuple> {
    return new ExtendWith(relation, 0, 0, key_func);
  }

  // impl<'leap, Key, Val, Tuple, Func> Leaper<'leap, Tuple, Val> for ExtendWith<'leap, Key, Val, Tuple, Func>

  // crate: datafrog-2.0.1/src/treefrog.rs:364 count
  count(prefix: Tuple): number {
    const key = this.key_func(prefix);
    const rel = this.relation.elements;
    this.start = binary_search(rel, 0, rel.length, (x) => cmp(x[0], key) < 0);
    // `slice1` is `rel[start..]`, `slice2` is `rel[slice2_lo..]`.
    const slice2_lo = gallop(rel, this.start, rel.length, (x) => cmp(x[0], key) <= 0);
    this.end = rel.length - (rel.length - slice2_lo);
    return rel.length - this.start - (rel.length - slice2_lo);
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:372 propose
  propose(_prefix: Tuple, values: Val[]): void {
    const rel = this.relation.elements;
    for (let i = this.start; i < this.end; i++) values.push(rel[i]![1]);
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:376 intersect
  intersect(_prefix: Tuple, values: Val[]): void {
    const rel = this.relation.elements;
    let lo = this.start;
    const hi = this.end;
    retain(values, (v) => {
      lo = gallop(rel, lo, hi, (kv) => cmp(kv[1], v) < 0);
      return lo < hi && cmp(rel[lo]![1], v) === 0;
    });
  }
}

/** `impl<'leap, Key, Val, Tuple, Func> Leapers<'leap, Tuple, Val> for ExtendWith<'leap, Key, Val, Tuple, Func>` */
export function Leapers_for_ExtendWith<Key extends Ord, Val extends Ord, Tuple extends Ord>(
  self: ExtendWith<Key, Val, Tuple>,
): Leapers<Tuple, Val> {
  return {
    // crate: datafrog-2.0.1/src/treefrog.rs:393 for_each_count
    for_each_count(tuple: Tuple, op: (index: number, count: number) => void): void {
      op(0, self.count(tuple));
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:397 propose
    propose(tuple: Tuple, min_index: number, values: Val[]): void {
      assert_eq(min_index, 0, debug_usize);
      self.propose(tuple, values);
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:402 intersect
    intersect(_: Tuple, min_index: number, _values: Val[]): void {
      assert_eq(min_index, 0, debug_usize);
    },
  };
}

// } (mod extend_with)

// pub(crate) mod extend_anti {

/// Wraps a Relation<Tuple> as a leaper.
export class ExtendAnti<Key extends Ord, Val extends Ord, Tuple extends Ord> implements Leaper<Tuple, Val> {
  constructor(
    public relation: Relation<readonly [Key, Val]>,
    public key_func: (tuple: Tuple) => Key,
  ) {}

  /// Constructs a ExtendAnti from a relation and key and value function.
  // crate: datafrog-2.0.1/src/treefrog.rs:433 from
  static from<Key extends Ord, Val extends Ord, Tuple extends Ord>(
    relation: Relation<readonly [Key, Val]>,
    key_func: (tuple: Tuple) => Key,
  ): ExtendAnti<Key, Val, Tuple> {
    return new ExtendAnti(relation, key_func);
  }

  // impl<'leap, Key: Ord, Val: Ord + 'leap, Tuple: Ord, Func> Leaper<'leap, Tuple, Val> for ExtendAnti<...>

  // crate: datafrog-2.0.1/src/treefrog.rs:450 count
  count(_prefix: Tuple): number {
    return usize_max_value;
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:453 propose
  propose(_prefix: Tuple, _values: Val[]): void {
    panic("ExtendAnti::propose(): variable apparently unbound.");
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:456 intersect
  intersect(prefix: Tuple, values: Val[]): void {
    const key = this.key_func(prefix);
    const rel = this.relation.elements;
    const start = binary_search(rel, 0, rel.length, (x) => cmp(x[0], key) < 0);
    // `slice1` is `rel[start..]`, `slice2` is `rel[slice2_lo..]`; `slice` is `slice1[..(slice1.len() - slice2.len())]`.
    const slice2_lo = gallop(rel, start, rel.length, (x) => cmp(x[0], key) <= 0);
    let lo = start;
    const hi = start + (rel.length - start - (rel.length - slice2_lo));
    if (lo !== hi) {
      retain(values, (v) => {
        lo = gallop(rel, lo, hi, (kv) => cmp(kv[1], v) < 0);
        return !(lo < hi && cmp(rel[lo]![1], v) === 0);
      });
    }
  }
}

// } (mod extend_anti)

// pub(crate) mod filter_with {

/// Wraps a Relation<Tuple> as a leaper.
export class FilterWith<Key extends Ord, Val extends Ord, Tuple extends Ord> implements Leaper<Tuple, unknown> {
  constructor(
    public relation: Relation<readonly [Key, Val]>,
    public key_func: (tuple: Tuple) => readonly [Key, Val],
  ) {}

  /// Constructs a FilterWith from a relation and key and value function.
  // crate: datafrog-2.0.1/src/treefrog.rs:497 from
  static from<Key extends Ord, Val extends Ord, Tuple extends Ord>(
    relation: Relation<readonly [Key, Val]>,
    key_func: (tuple: Tuple) => readonly [Key, Val],
  ): FilterWith<Key, Val, Tuple> {
    return new FilterWith(relation, key_func);
  }

  // impl<'leap, Key, Val, Val2, Tuple, Func> Leaper<'leap, Tuple, Val2> for FilterWith<'leap, Key, Val, Tuple, Func>

  // crate: datafrog-2.0.1/src/treefrog.rs:514 count
  count(prefix: Tuple): number {
    const key_val = this.key_func(prefix);
    if (relation_binary_search(this.relation, key_val)) {
      return usize_max_value;
    } else {
      return 0;
    }
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:522 propose
  propose(_prefix: Tuple, _values: unknown[]): void {
    panic("FilterWith::propose(): variable apparently unbound.");
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:525 intersect
  intersect(_prefix: Tuple, _values: unknown[]): void {
    // Only here because we didn't return zero above, right?
  }
}

/** `impl<'leap, Key, Val, Tuple, Func> Leapers<'leap, Tuple, ()> for FilterWith<'leap, Key, Val, Tuple, Func>` */
export function Leapers_for_FilterWith<Key extends Ord, Val extends Ord, Tuple extends Ord>(
  self: FilterWith<Key, Val, Tuple>,
): Leapers<Tuple, undefined> {
  return {
    // crate: datafrog-2.0.1/src/treefrog.rs:538 for_each_count
    for_each_count(tuple: Tuple, op: (index: number, count: number) => void): void {
      if (self.count(tuple) === 0) {
        op(0, 0);
      } else {
        op(0, 1);
      }
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:546 propose
    propose(_: Tuple, min_index: number, values: undefined[]): void {
      assert_eq(min_index, 0, debug_usize);
      values.push(undefined);
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:551 intersect
    intersect(_: Tuple, min_index: number, values: undefined[]): void {
      assert_eq(min_index, 0, debug_usize);
      assert_eq(values.length, 1, debug_usize);
    },
  };
}

// } (mod filter_with)

// pub(crate) mod filter_anti {

/// Wraps a Relation<Tuple> as a leaper.
export class FilterAnti<Key extends Ord, Val extends Ord, Tuple extends Ord> implements Leaper<Tuple, unknown> {
  constructor(
    public relation: Relation<readonly [Key, Val]>,
    public key_func: (tuple: Tuple) => readonly [Key, Val],
  ) {}

  /// Constructs a FilterAnti from a relation and key and value function.
  // crate: datafrog-2.0.1/src/treefrog.rs:583 from
  static from<Key extends Ord, Val extends Ord, Tuple extends Ord>(
    relation: Relation<readonly [Key, Val]>,
    key_func: (tuple: Tuple) => readonly [Key, Val],
  ): FilterAnti<Key, Val, Tuple> {
    return new FilterAnti(relation, key_func);
  }

  // impl<'leap, Key: Ord, Val: Ord + 'leap, Val2, Tuple: Ord, Func> Leaper<'leap, Tuple, Val2> for FilterAnti<...>

  // crate: datafrog-2.0.1/src/treefrog.rs:600 count
  count(prefix: Tuple): number {
    const key_val = this.key_func(prefix);
    if (relation_binary_search(this.relation, key_val)) {
      return 0;
    } else {
      return usize_max_value;
    }
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:608 propose
  propose(_prefix: Tuple, _values: unknown[]): void {
    panic("FilterAnti::propose(): variable apparently unbound.");
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:611 intersect
  intersect(_prefix: Tuple, _values: unknown[]): void {
    // Only here because we didn't return zero above, right?
  }
}

/** `impl<'leap, Key, Val, Tuple, Func> Leapers<'leap, Tuple, ()> for FilterAnti<'leap, Key, Val, Tuple, Func>` */
export function Leapers_for_FilterAnti<Key extends Ord, Val extends Ord, Tuple extends Ord>(
  self: FilterAnti<Key, Val, Tuple>,
): Leapers<Tuple, undefined> {
  return {
    // crate: datafrog-2.0.1/src/treefrog.rs:624 for_each_count
    for_each_count(tuple: Tuple, op: (index: number, count: number) => void): void {
      if (self.count(tuple) === 0) {
        op(0, 0);
      } else {
        op(0, 1);
      }
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:632 propose
    propose(_: Tuple, min_index: number, values: undefined[]): void {
      // We only get here if `tuple` is *not* a member of `self.relation`
      assert_eq(min_index, 0, debug_usize);
      values.push(undefined);
    },

    // crate: datafrog-2.0.1/src/treefrog.rs:638 intersect
    intersect(_: Tuple, min_index: number, values: undefined[]): void {
      // We only get here if `tuple` is not a member of `self.relation`
      assert_eq(min_index, 0, debug_usize);
      assert_eq(values.length, 1, debug_usize);
    },
  };
}

// } (mod filter_anti)

/** PORT: `binary_search(&slice[lo..hi], cmp)` as an index into the whole array (`lo + result`). */
// crate: datafrog-2.0.1/src/treefrog.rs:646 binary_search
function binary_search<T>(slice: readonly T[], lo_: number, hi_: number, cmp: (x: T) => boolean): number {
  // we maintain the invariant that `lo` many elements of `slice` satisfy `cmp`.
  // `hi` is maintained at the first element we know does not satisfy `cmp`.

  let hi = hi_;
  let lo = lo_;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (cmp(slice[mid]!)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** `self.relation.binary_search(&key_val).is_ok()` (`<[T]>::binary_search` through `Deref`). */
function relation_binary_search<T extends Ord>(relation: Relation<T>, x: T): boolean {
  return binary_search_by(relation.elements, (e) => Math.sign(cmp(e, x)) as -1 | 0 | 1).ok;
}

/** `Vec::retain`: keeps the elements for which `f` holds, visiting them in order. */
function retain<T>(v: T[], f: (x: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    const x = v[r]!;
    if (f(x)) v[w++] = x;
  }
  v.length = w;
}
