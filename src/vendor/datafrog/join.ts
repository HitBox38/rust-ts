// Port of datafrog =2.0.1 `src/join.rs`.
//
// PORT: `impl JoinInput<'me, Tuple>` parameters are `Variable<Tuple> | Relation<Tuple>`; `join_input` picks
// the impl (`JoinInput_for_Variable` / `JoinInput_for_Relation`), as Rust's static dispatch does.
// `&[T]` sub-slices are index ranges `[lo, hi)` of the backing array: `gallop` takes and returns the start.
//
//! Join functionality.

import { cmp, type Ord, Relation, Variable } from "./lib.ts";

/// Implements `join`. Note that `input1` must be a variable, but
/// `input2` can be either a variable or a relation. This is necessary
/// because relations have no "recent" tuples, so the fn would be a
/// guaranteed no-op if both arguments were relations.  See also
/// `join_into_relation`.
// crate: datafrog-2.0.1/src/join.rs:12 join_into
export function join_into<Key extends Ord, Val1 extends Ord, Val2 extends Ord, Result extends Ord>(
  input1: Variable<readonly [Key, Val1]>,
  input2_: Variable<readonly [Key, Val2]> | Relation<readonly [Key, Val2]>,
  output: Variable<Result>,
  logic: (key: Key, val1: Val1, val2: Val2) => Result,
): void {
  const input2 = join_input(input2_);
  const results: Result[] = [];

  const recent1 = JoinInput_for_Variable(input1).recent();
  const recent2 = input2.recent();

  {
    // scoped to let `closure` drop borrow of `results`.

    const closure = (k: Key, v1: Val1, v2: Val2) => results.push(logic(k, v1, v2));

    for (const batch2 of input2.stable()) {
      join_helper(recent1, batch2.elements, closure);
    }

    for (const batch1 of JoinInput_for_Variable(input1).stable()) {
      join_helper(batch1.elements, recent2, closure);
    }

    join_helper(recent1, recent2, closure);
  }

  output.insert(Relation.from_vec(results));
}

/// Join, but for two relations.
// crate: datafrog-2.0.1/src/join.rs:43 join_into_relation
export function join_into_relation<Key extends Ord, Val1 extends Ord, Val2 extends Ord, Result extends Ord>(
  input1: Relation<readonly [Key, Val1]>,
  input2: Relation<readonly [Key, Val2]>,
  logic: (key: Key, val1: Val1, val2: Val2) => Result,
): Relation<Result> {
  const results: Result[] = [];

  join_helper(input1.elements, input2.elements, (k, v1, v2) => {
    results.push(logic(k, v1, v2));
  });

  return Relation.from_vec(results);
}

/// Moves all recent tuples from `input1` that are not present in `input2` into `output`.
// crate: datafrog-2.0.1/src/join.rs:58 antijoin
export function antijoin<Key extends Ord, Val extends Ord, Result extends Ord>(
  input1: Variable<readonly [Key, Val]> | Relation<readonly [Key, Val]>,
  input2: Relation<Key>,
  logic: (key: Key, val: Val) => Result,
): Relation<Result> {
  const tuples2 = input2.elements;
  let lo2 = 0;
  const hi2 = tuples2.length;

  const results = join_input(input1)
    .recent()
    .filter(([key, _]) => {
      lo2 = gallop(tuples2, lo2, hi2, (k) => cmp(k, key) < 0);
      return !(lo2 < hi2 && cmp(tuples2[lo2]!, key) === 0);
    })
    .map(([key, val]) => logic(key, val));

  return Relation.from_vec(results);
}

// crate: datafrog-2.0.1/src/join.rs:78 join_helper
function join_helper<K extends Ord, V1, V2>(
  slice1: readonly (readonly [K, V1])[],
  slice2: readonly (readonly [K, V2])[],
  result: (k: K, v1: V1, v2: V2) => void,
): void {
  // PORT: `slice1` / `slice2` are `[lo1, hi1)` / `[lo2, hi2)` of the given arrays.
  let lo1 = 0;
  const hi1 = slice1.length;
  let lo2 = 0;
  const hi2 = slice2.length;
  while (lo1 < hi1 && lo2 < hi2) {
    // If the keys match produce tuples, else advance the smaller key until they might.
    const c = cmp(slice1[lo1]![0], slice2[lo2]![0]);
    if (c < 0) {
      const k2 = slice2[lo2]![0];
      lo1 = gallop(slice1, lo1, hi1, (x) => cmp(x[0], k2) < 0);
    } else if (c === 0) {
      // Determine the number of matching keys in each slice.
      const k1 = slice1[lo1]![0];
      let count1 = 0;
      while (lo1 + count1 < hi1 && cmp(slice1[lo1 + count1]![0], k1) === 0) count1++;
      const k2 = slice2[lo2]![0];
      let count2 = 0;
      while (lo2 + count2 < hi2 && cmp(slice2[lo2 + count2]![0], k2) === 0) count2++;

      // Produce results from the cross-product of matches.
      for (let index1 = 0; index1 < count1; index1++) {
        for (let i2 = lo2; i2 < lo2 + count2; i2++) {
          result(k1, slice1[lo1 + index1]![1], slice2[i2]![1]);
        }
      }

      // Advance slices past this key.
      lo1 += count1;
      lo2 += count2;
    } else {
      const k1 = slice1[lo1]![0];
      lo2 = gallop(slice2, lo2, hi2, (x) => cmp(x[0], k1) < 0);
    }
  }
}

/** PORT: `gallop(&slice[lo..hi], cmp)`, returning the start index of the returned sub-slice (its end is `hi`). */
// crate: datafrog-2.0.1/src/join.rs:114 gallop
export function gallop<T>(slice: readonly T[], lo: number, hi: number, cmp: (x: T) => boolean): number {
  // if empty slice, or already >= element, return
  if (lo < hi && cmp(slice[lo]!)) {
    let step = 1;
    while (step < hi - lo && cmp(slice[lo + step]!)) {
      lo += step;
      step *= 2;
    }

    step = Math.floor(step / 2);
    while (step > 0) {
      if (step < hi - lo && cmp(slice[lo + step]!)) {
        lo += step;
      }
      step = Math.floor(step / 2);
    }

    lo += 1; // advance one, as we always stayed < value
  }

  return lo;
}

/// An input that can be used with `from_join`; either a `Variable` or a `Relation`.
export interface JoinInput<Tuple extends Ord> {
  /// If we are on iteration N of the loop, these are the tuples
  /// added on iteration N-1. (For a `Relation`, this is always an
  /// empty slice.)
  // crate: datafrog-2.0.1/src/join.rs:150 recent
  recent(): readonly Tuple[];

  /// If we are on iteration N of the loop, these are the tuples
  /// added on iteration N - 2 or before. (For a `Relation`, this is
  /// just `self`.)
  // crate: datafrog-2.0.1/src/join.rs:153 stable
  stable(): readonly Relation<Tuple>[];
}

/** `impl<'me, Tuple: Ord> JoinInput<'me, Tuple> for &'me Variable<Tuple>` */
export function JoinInput_for_Variable<Tuple extends Ord>(self: Variable<Tuple>): JoinInput<Tuple> {
  return {
    // crate: datafrog-2.0.1/src/join.rs:160 recent
    recent(): readonly Tuple[] {
      return self.recent.value.elements;
    },

    // crate: datafrog-2.0.1/src/join.rs:164 stable
    stable(): readonly Relation<Tuple>[] {
      return self.stable;
    },
  };
}

/** `impl<'me, Tuple: Ord> JoinInput<'me, Tuple> for &'me Relation<Tuple>` */
export function JoinInput_for_Relation<Tuple extends Ord>(self: Relation<Tuple>): JoinInput<Tuple> {
  return {
    // crate: datafrog-2.0.1/src/join.rs:173 recent
    recent(): readonly Tuple[] {
      return [];
    },

    // crate: datafrog-2.0.1/src/join.rs:177 stable
    stable(): readonly Relation<Tuple>[] {
      return [self];
    },
  };
}

/** PORT: the static dispatch of an `impl JoinInput` argument. */
export function join_input<Tuple extends Ord>(x: Variable<Tuple> | Relation<Tuple>): JoinInput<Tuple> {
  return x instanceof Variable ? JoinInput_for_Variable(x) : JoinInput_for_Relation(x);
}
