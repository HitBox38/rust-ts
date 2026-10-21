// core's stable slice sort (`<[T]>::sort_by` / `sort_by_key`, driftsort) at the pin:
// library/core/src/slice/sort/{stable/{mod,drift,merge,quicksort}.rs, shared/{mod,pivot,smallsort}.rs} and
// library/alloc/src/slice.rs (`stable_sort`, `BufGuard for Vec<T>`).
//
// Any two stable sorts agree when the comparator is a consistent total preorder; then `Array.prototype.sort` (stable) is
// exact. For comparators that are not (e.g. rustc_trait_selection fulfillment_errors.rs `report_similar_impl_candidates`'
// tuple-arity comparator, which says `Equal` for non-tuples), the result depends on driftsort's exact sequence of
// comparisons and moves, so this is a line-by-line port of it.
//
// PORT:
// - Raw pointers are (array, index) pairs; `v: &mut [T]` is `(v, vs, len)` (a window of a JS array), `scratch` is a JS
//   array whose length is the Rust scratch length (it only holds copies of `v`'s elements).
// - The algorithm depends on two properties of the element type `T` (Rust specializes on them): `size_of::<T>()` and
//   whether `T: Freeze`. The caller passes them as a `SortLayout` (the Rust element type's layout at the pin, for the
//   64-bit host targets rustc runs on).
// - `abort_immediate()` (impossible preconditions) is a `panic`; `panic_on_ord_violation` panics like rustc (an ICE).
// - `T::IS_ZST` is `size_of === 0`.
import { panic, unported } from "./panic.ts";

/** `size_of::<T>()` and `T: Freeze` of the Rust element type (see the module comment). */
export interface SortLayout {
  readonly size_of: number;
  readonly freeze: boolean;
}

type IsLess<T> = (a: T, b: T) => boolean;

/** `<[T]>::sort_by(compare)` (alloc slice.rs:192): `stable_sort(self, |a, b| compare(a, b) == Less)`. */
// std: library/alloc/src/slice.rs:192 sort_by
export function slice_sort_by<T>(v: T[], compare: (a: T, b: T) => number, layout: SortLayout): void {
  sort(v, (a, b) => compare(a, b) < 0, layout);
}

/** `<[T]>::sort_by_key(f)` (alloc slice.rs:247): `stable_sort(self, |a, b| f(a).lt(&f(b)))`. */
// std: library/alloc/src/slice.rs:247 sort_by_key
export function slice_sort_by_key<T, K>(v: T[], f: (x: T) => K, cmp_K: (a: K, b: K) => number, layout: SortLayout): void {
  sort(v, (a, b) => cmp_K(f(a), f(b)) < 0, layout);
}

/**
 * `<[T]>::sort_unstable_by(compare)` (core slice/mod.rs:3201): `sort::unstable::sort(self, |a, b| compare(a, b) == Less)`.
 * Only the insertion-sort path (`len <= 20`) is ported; longer slices stop at `unported` (ipnsort).
 */
// std: library/core/src/slice/mod.rs:3201 sort_unstable_by
export function slice_sort_unstable_by<T>(v: T[], compare: (a: T, b: T) => number, layout: SortLayout): void {
  unstable_sort(v, (a, b) => compare(a, b) < 0, layout);
}

// ---- unstable/mod.rs ----

/// Unstable sort called ipnsort by Lukas Bergdoll and Orson Peters.
// std: library/core/src/slice/sort/unstable/mod.rs:22 sort
function unstable_sort<T>(v: T[], is_less: IsLess<T>, L: SortLayout): void {
  // Arrays of zero-sized types are always all-equal, and thus sorted.
  if (L.size_of === 0) {
    return;
  }

  // Instrumenting the standard library showed that 90+% of the calls to sort
  // by rustc are either of size 0 or 1.
  const len = v.length;
  if (len < 2) {
    return;
  }

  // More advanced sorting methods than insertion sort are faster if called in
  // a hot loop for small inputs, but for general-purpose code the small
  // binary size of insertion sort is more important. The instruction cache in
  // modern processors is very valuable, and for a single sort call in general
  // purpose code any gains from an advanced method are cancelled by i-cache
  // misses during the sort, and thrashing the i-cache for surrounding code.
  const MAX_LEN_ALWAYS_INSERTION_SORT = 20;
  if (len <= MAX_LEN_ALWAYS_INSERTION_SORT) {
    insertion_sort_shift_left(v, 0, len, 1, is_less);
    return;
  }

  unported("core::slice::sort::unstable::ipnsort (sort_unstable over more than 20 elements)");
}

// ---- stable/mod.rs ----

/// Stable sort called driftsort by Orson Peters and Lukas Bergdoll.
// std: library/core/src/slice/sort/stable/mod.rs:29 sort
function sort<T>(v: T[], is_less: IsLess<T>, L: SortLayout): void {
  // Arrays of zero-sized types are always all-equal, and thus sorted.
  if (L.size_of === 0) {
    return;
  }

  // Instrumenting the standard library showed that 90+% of the calls to sort
  // by rustc are either of size 0 or 1.
  const len = v.length;
  if (len < 2) {
    return;
  }

  // (not `optimize_for_size` / 16-bit)
  const MAX_LEN_ALWAYS_INSERTION_SORT = 20;
  if (len <= MAX_LEN_ALWAYS_INSERTION_SORT) {
    insertion_sort_shift_left(v, 0, len, 1, is_less);
    return;
  }

  driftsort_main(v, is_less, L);
}

// std: library/core/src/slice/sort/stable/mod.rs:94 driftsort_main
function driftsort_main<T>(v: T[], is_less: IsLess<T>, L: SortLayout): void {
  const MAX_FULL_ALLOC_BYTES = 8_000_000; // 8MB
  const max_full_alloc = Math.floor(MAX_FULL_ALLOC_BYTES / L.size_of);
  const len = v.length;
  const alloc_len = Math.max(Math.max(len - Math.floor(len / 2), Math.min(len, max_full_alloc)), SMALL_SORT_GENERAL_SCRATCH_LEN);

  // For small inputs 4KiB of stack storage suffices, which allows us to avoid
  // calling the (de-)allocator. Benchmarks showed this was quite beneficial.
  // PORT: `AlignedStorage::<T, 4096>::as_uninit_slice_mut` has `4096 / size_of::<T>()` elements; the heap buffer is
  // `Vec::with_capacity(alloc_len).spare_capacity_mut()` (exactly `alloc_len`).
  const stack_scratch_len = Math.floor(4096 / L.size_of);
  const scratch: T[] = new Array<T>(stack_scratch_len >= alloc_len ? stack_scratch_len : alloc_len);

  // For small inputs using quicksort is not yet beneficial, and a single
  // small-sort or two small-sorts plus a single merge outperforms it, so use
  // eager mode.
  const eager_sort = len <= small_sort_threshold(L) * 2;
  drift_sort(v, 0, len, scratch, eager_sort, is_less, L);
}

// ---- stable/drift.rs ----

/// Sorts `v` based on comparison function `is_less`. If `eager_sort` is true,
/// it will only do small-sorts and physical merges, ensuring O(N * log(N))
/// worst-case complexity.
// std: library/core/src/slice/sort/stable/drift.rs:20 sort
function drift_sort<T>(v: T[], vs: number, len: number, scratch: T[], eager_sort: boolean, is_less: IsLess<T>, L: SortLayout): void {
  if (len < 2) {
    return; // Removing this length check *increases* code size.
  }
  const scale_factor = merge_tree_scale_factor(len);

  // It's important to have a relatively high entry barrier for pre-sorted
  // runs, as the presence of a single such run will force on average several
  // merge operations and shrink the maximum quicksort size a lot. For that
  // reason we use sqrt(len) as our pre-sorted run threshold.
  const MIN_SQRT_RUN_LEN = 64;
  const min_good_run_len =
    len <= MIN_SQRT_RUN_LEN * MIN_SQRT_RUN_LEN
      ? // For small input length `MIN_SQRT_RUN_LEN` would break pattern
        // detection of full or nearly sorted inputs.
        Math.min(len - Math.floor(len / 2), MIN_SQRT_RUN_LEN)
      : sqrt_approx(len);

  // (stack_len, runs, desired_depths) together form a stack maintaining run
  // information for the powersort heuristic. desired_depths[i] is the desired
  // depth of the merge node that merges runs[i] with the run that comes after
  // it.
  let stack_len = 0;
  const runs: DriftsortRun[] = new Array<DriftsortRun>(66);
  const desired_depths: number[] = new Array<number>(66);

  let scan_idx = 0;
  let prev_run = DriftsortRun.new_sorted(0); // Initial dummy run.
  for (;;) {
    // Compute the next run and the desired depth of the merge node between
    // prev_run and next_run. On the last iteration we create a dummy run
    // with root-level desired depth to fully collapse the merge tree.
    let next_run: DriftsortRun;
    let desired_depth: number;
    if (scan_idx < len) {
      next_run = create_run(v, vs + scan_idx, len - scan_idx, scratch, min_good_run_len, eager_sort, is_less, L);
      desired_depth = merge_tree_depth(scan_idx - DriftsortRun.len(prev_run), scan_idx, scan_idx + DriftsortRun.len(next_run), scale_factor);
    } else {
      next_run = DriftsortRun.new_sorted(0);
      desired_depth = 0;
    }

    // Process the merge nodes between earlier runs[i] that have a desire to
    // be deeper in the merge tree than the merge node for the splitpoint
    // between prev_run and next_run.
    while (stack_len > 1 && desired_depths[stack_len - 1]! >= desired_depth) {
      // Desired depth greater than the upcoming desired depth, pop
      // left neighbor run from stack and merge into prev_run.
      const left = runs[stack_len - 1]!;
      const merged_len = DriftsortRun.len(left) + DriftsortRun.len(prev_run);
      const merge_start_idx = scan_idx - merged_len;
      prev_run = logical_merge(v, vs + merge_start_idx, merged_len, scratch, left, prev_run, is_less, L);
      stack_len -= 1;
    }

    // We now know that desired_depths[stack_len - 1] < desired_depth,
    // maintaining our invariant.
    runs[stack_len] = prev_run;
    desired_depths[stack_len] = desired_depth;
    stack_len += 1;

    // Break before overriding the last run with our dummy run.
    if (scan_idx >= len) {
      break;
    }

    scan_idx += DriftsortRun.len(next_run);
    prev_run = next_run;
  }

  if (!DriftsortRun.sorted(prev_run)) {
    stable_quicksort(v, vs, len, scratch, is_less, L);
  }
}

// Nearly-Optimal Mergesorts: Fast, Practical Sorting Methods That Optimally
// Adapt to Existing Runs by J. Ian Munro and Sebastian Wild. (See drift.rs for the full comment.)
// PORT: `u64` arithmetic is `bigint` (`scale_factor * x` stays below 2^64, drift.rs's bound).
// std: library/core/src/slice/sort/stable/drift.rs:156 merge_tree_scale_factor
function merge_tree_scale_factor(n: number): bigint {
  const N = BigInt(n);
  return ((1n << 62n) + N - 1n) / N;
}

// Note: merge_tree_depth output is < 64 when left < right as f*x and f*y must
// differ in some bit, and is <= 64 always.
// std: library/core/src/slice/sort/stable/drift.rs:167 merge_tree_depth
function merge_tree_depth(left: number, mid: number, right: number, scale_factor: bigint): number {
  const x = BigInt(left) + BigInt(mid);
  const y = BigInt(mid) + BigInt(right);
  const z = BigInt.asUintN(64, (scale_factor * x) ^ (scale_factor * y));
  // `u64::leading_zeros`
  return z === 0n ? 64 : 64 - z.toString(2).length;
}

// std: library/core/src/slice/sort/stable/drift.rs:173 sqrt_approx
function sqrt_approx(n: number): number {
  // Note that sqrt(n) = n^(1/2), and that 2^log2(n) = n. We combine these
  // two facts to approximate sqrt(n) as 2^(log2(n) / 2). Because our integer
  // log floors we want to add 0.5 to compensate for this on average, so our
  // initial approximation is 2^((1 + floor(log2(n))) / 2).
  //
  // We then apply an iteration of Newton's method to improve our
  // approximation, which for sqrt(n) is a1 = (a0 + n / a0) / 2.
  //
  // Finally we note that the exponentiation / division can be done directly
  // with shifts. We OR with 1 to avoid zero-checks in the integer log.
  const ilog = ilog2(n | 1);
  const shift = Math.ceil(ilog / 2);
  return Math.floor((2 ** shift + Math.floor(n / 2 ** shift)) / 2);
}

// Lazy logical runs as in Glidesort.
// std: library/core/src/slice/sort/stable/drift.rs:191 logical_merge
function logical_merge<T>(v: T[], vs: number, len: number, scratch: T[], left: DriftsortRun, right: DriftsortRun, is_less: IsLess<T>, L: SortLayout): DriftsortRun {
  // If one or both of the runs are sorted do a physical merge, using
  // quicksort to sort the unsorted run if present. We also *need* to
  // physically merge if the combined runs would not fit in the scratch space
  // anymore (as this would mean we are no longer able to quicksort them).
  const can_fit_in_scratch = len <= scratch.length;
  if (!can_fit_in_scratch || DriftsortRun.sorted(left) || DriftsortRun.sorted(right)) {
    if (!DriftsortRun.sorted(left)) {
      stable_quicksort(v, vs, DriftsortRun.len(left), scratch, is_less, L);
    }
    if (!DriftsortRun.sorted(right)) {
      stable_quicksort(v, vs + DriftsortRun.len(left), len - DriftsortRun.len(left), scratch, is_less, L);
    }
    merge(v, vs, len, scratch, DriftsortRun.len(left), is_less);

    return DriftsortRun.new_sorted(len);
  } else {
    return DriftsortRun.new_unsorted(len);
  }
}

/// Creates a new logical run.
///
/// A logical run can either be sorted or unsorted. If there is a pre-existing
/// run that clears the `min_good_run_len` threshold it is returned as a sorted
/// run. If not, the result depends on the value of `eager_sort`. If it is true,
/// then a sorted run of length `T::SMALL_SORT_THRESHOLD` is returned, and if it
/// is false an unsorted run of length `min_good_run_len` is returned.
// std: library/core/src/slice/sort/stable/drift.rs:226 create_run
function create_run<T>(v: T[], vs: number, len: number, scratch: T[], min_good_run_len: number, eager_sort: boolean, is_less: IsLess<T>, L: SortLayout): DriftsortRun {
  if (len >= min_good_run_len) {
    const [run_len, was_reversed] = find_existing_run(v, vs, len, is_less);

    if (run_len >= min_good_run_len) {
      if (was_reversed) {
        reverse(v, vs, run_len);
      }

      return DriftsortRun.new_sorted(run_len);
    }
  }

  if (eager_sort) {
    // We call quicksort with a len that will immediately call small-sort.
    const eager_run_len = Math.min(small_sort_threshold(L), len);
    quicksort(v, vs, eager_run_len, scratch, 0, undefined, is_less, L);
    return DriftsortRun.new_sorted(eager_run_len);
  } else {
    return DriftsortRun.new_unsorted(Math.min(min_good_run_len, len));
  }
}

// std: library/core/src/slice/sort/stable/drift.rs:262 stable_quicksort
function stable_quicksort<T>(v: T[], vs: number, len: number, scratch: T[], is_less: IsLess<T>, L: SortLayout): void {
  // Limit the number of imbalanced partitions to `2 * floor(log2(len))`.
  // The binary OR by one is used to eliminate the zero-check in the logarithm.
  const limit = 2 * ilog2(len | 1);
  quicksort(v, vs, len, scratch, limit, undefined, is_less, L);
}

/// Compactly stores the length of a run, and whether or not it is sorted.
type DriftsortRun = number & { readonly __brand: "DriftsortRun" };
const DriftsortRun = {
  // std: library/core/src/slice/sort/stable/drift.rs:280 new_sorted
  new_sorted(length: number): DriftsortRun {
    return (length * 2 + 1) as DriftsortRun;
  },
  // std: library/core/src/slice/sort/stable/drift.rs:285 new_unsorted
  new_unsorted(length: number): DriftsortRun {
    return (length * 2) as DriftsortRun;
  },
  // std: library/core/src/slice/sort/stable/drift.rs:290 sorted
  sorted(self: DriftsortRun): boolean {
    return self % 2 === 1;
  },
  // std: library/core/src/slice/sort/stable/drift.rs:295 len
  len(self: DriftsortRun): number {
    return Math.floor(self / 2);
  },
};

// ---- stable/merge.rs ----

/// Merges non-decreasing runs `v[..mid]` and `v[mid..]` using `scratch` as
/// temporary storage, and stores the result into `v[..]`.
// PORT: `MergeState { start, end, dst }` is three locals (`start`/`end` index `scratch`, `dst` indexes `v`); its `Drop`
// (copy `start..end` to `dst..`) runs at the end.
// std: library/core/src/slice/sort/stable/merge.rs:8 merge
function merge<T>(v: T[], vs: number, len: number, scratch: T[], mid: number, is_less: IsLess<T>): void {
  if (mid === 0 || mid >= len || scratch.length < Math.min(mid, len - mid)) {
    return;
  }

  const v_mid = vs + mid;
  const v_end = vs + len;

  const left_len = mid;
  const right_len = len - mid;

  const left_is_shorter = left_len <= right_len;
  const save_base = left_is_shorter ? vs : v_mid;
  const save_len = left_is_shorter ? left_len : right_len;

  for (let i = 0; i < save_len; i++) scratch[i] = v[save_base + i]!;

  let start = 0;
  let end = save_len;
  let dst = save_base;

  if (left_is_shorter) {
    // std: library/core/src/slice/sort/stable/merge.rs:78 merge_up
    let right = v_mid;
    const right_end = v_end;
    while (start !== end && right !== right_end) {
      const consume_left = !is_less(v[right]!, scratch[start]!);

      v[dst] = consume_left ? scratch[start]! : v[right]!;

      start += consume_left ? 1 : 0;
      right += consume_left ? 0 : 1;

      dst += 1;
    }
  } else {
    // std: library/core/src/slice/sort/stable/merge.rs:108 merge_down
    const left_end = vs;
    const right_end = 0;
    let out = v_end;
    for (;;) {
      const left = dst - 1;
      const right = end - 1;
      out -= 1;

      const consume_left = is_less(scratch[right]!, v[left]!);

      v[out] = consume_left ? v[left]! : scratch[right]!;

      dst = left + (consume_left ? 0 : 1);
      end = right + (consume_left ? 1 : 0);

      if (dst === left_end || end === right_end) {
        break;
      }
    }
  }
  // Finally, `merge_state` gets dropped. If the shorter run was not fully
  // consumed, whatever remains of it will now be copied into the hole in `v`.
  // std: library/core/src/slice/sort/stable/merge.rs:139 drop
  for (let i = 0; i < end - start; i++) v[dst + i] = scratch[start + i]!;
}

// ---- stable/quicksort.rs ----

/// Sorts `v` recursively using quicksort.
// PORT: `left_ancestor_pivot: Option<&T>` is `{ v: T } | undefined` (a copy of the pivot value; elements are not
// mutated in place).
// std: library/core/src/slice/sort/stable/quicksort.rs:16 quicksort
function quicksort<T>(v: T[], vs: number, len: number, scratch: T[], limit: number, left_ancestor_pivot: { v: T } | undefined, is_less: IsLess<T>, L: SortLayout): void {
  for (;;) {
    if (len <= small_sort_threshold(L)) {
      small_sort(v, vs, len, scratch, is_less, L);
      return;
    }

    if (limit === 0) {
      // We have had too many bad pivots, switch to O(n log n) fallback
      // algorithm. In our case that is driftsort in eager mode.
      drift_sort(v, vs, len, scratch, true, is_less, L);
      return;
    }
    limit -= 1;

    const pivot_pos = choose_pivot(v, vs, len, is_less);

    const pivot_ref = !has_direct_interior_mutability(L) ? { v: v[vs + pivot_pos]! } : undefined;

    // We choose a pivot, and check if this pivot is equal to our left
    // ancestor. If true, we do a partition putting equal elements on the
    // left and do not recurse on it.
    let perform_equal_partition = false;
    if (left_ancestor_pivot !== undefined) {
      perform_equal_partition = !is_less(left_ancestor_pivot.v, v[vs + pivot_pos]!);
    }

    let left_partition_len = 0;
    if (!perform_equal_partition) {
      left_partition_len = stable_partition(v, vs, len, scratch, pivot_pos, false, is_less, L);
      perform_equal_partition = left_partition_len === 0;
    }

    if (perform_equal_partition) {
      const mid_eq = stable_partition(v, vs, len, scratch, pivot_pos, true, (a, b) => !is_less(b, a), L);
      vs += mid_eq;
      len -= mid_eq;
      left_ancestor_pivot = undefined;
      continue;
    }

    // Process left side with the next loop iter, right side with recursion.
    quicksort(v, vs + left_partition_len, len - left_partition_len, scratch, limit, pivot_ref, is_less, L);
    len = left_partition_len;
  }
}

/// Partitions `v` using pivot `p = v[pivot_pos]` and returns the number of
/// elements less than `p`. The relative order of elements that compare < p and
/// those that compare >= p is preserved - it is a stable partition.
// PORT: `PartitionState { scratch_base, scan, num_left, scratch_rev }` is locals (`scan` indexes `v`, `scratch_rev`
// indexes `scratch`); the `size_of::<T>() <= 16` unrolled loop makes the same calls in the same order as the plain one.
// std: library/core/src/slice/sort/stable/quicksort.rs:89 stable_partition
function stable_partition<T>(v: T[], vs: number, len: number, scratch: T[], pivot_pos: number, pivot_goes_left: boolean, is_less: IsLess<T>, L: SortLayout): number {
  if (scratch.length < len || pivot_pos >= len) {
    return panic("core::intrinsics::abort_immediate (stable_partition)");
  }

  const pivot = v[vs + pivot_pos]!;
  // std: library/core/src/slice/sort/stable/quicksort.rs:201 new
  let scan = vs;
  let num_left = 0;
  let scratch_rev = len;
  // std: library/core/src/slice/sort/stable/quicksort.rs:215 partition_one
  const partition_one = (towards_left: boolean): number => {
    scratch_rev -= 1;
    const dst = (towards_left ? 0 : scratch_rev) + num_left;
    scratch[dst] = v[scan]!;
    num_left += towards_left ? 1 : 0;
    scan += 1;
    return dst;
  };

  let pivot_in_scratch = -1;
  let loop_end_pos = pivot_pos;

  for (;;) {
    const loop_end = vs + loop_end_pos;
    while (scan < loop_end) {
      partition_one(is_less(v[scan]!, pivot));
    }

    if (loop_end_pos === len) {
      break;
    }

    // We avoid comparing pivot with itself, as this could create deadlocks for
    // certain comparison operators. We also store its location later for later.
    pivot_in_scratch = partition_one(pivot_goes_left);

    loop_end_pos = len;
  }

  // `pivot` must be copied into its correct position again, because a
  // comparison operator might have modified it.
  if (has_direct_interior_mutability(L)) {
    scratch[pivot_in_scratch] = pivot;
  }

  // Copy all the elements < p directly from swap to v.
  for (let i = 0; i < num_left; i++) v[vs + i] = scratch[i]!;

  // Copy the elements >= p in reverse order.
  for (let i = 0; i < len - num_left; i++) {
    v[vs + num_left + i] = scratch[len - 1 - i]!;
  }

  return num_left;
}

// std: library/core/src/slice/sort/stable/quicksort.rs:253 has_direct_interior_mutability
function has_direct_interior_mutability(L: SortLayout): boolean {
  // If a type has interior mutability it may alter itself during comparison
  // in a way that must be preserved after the sort operation concludes.
  return !L.freeze;
}

// ---- shared/mod.rs ----

/// Finds a run of sorted elements starting at the beginning of the slice.
///
/// Returns the length of the run, and a bool that is false when the run
/// is ascending, and true if the run strictly descending.
// std: library/core/src/slice/sort/shared/mod.rs:20 find_existing_run
function find_existing_run<T>(v: T[], vs: number, len: number, is_less: IsLess<T>): [number, boolean] {
  if (len < 2) {
    return [len, false];
  }

  let run_len = 2;
  const strictly_descending = is_less(v[vs + 1]!, v[vs]!);
  if (strictly_descending) {
    while (run_len < len && is_less(v[vs + run_len]!, v[vs + run_len - 1]!)) {
      run_len += 1;
    }
  } else {
    while (run_len < len && !is_less(v[vs + run_len]!, v[vs + run_len - 1]!)) {
      run_len += 1;
    }
  }
  return [run_len, strictly_descending];
}

// ---- shared/pivot.rs ----

// Recursively select a pseudomedian if above this threshold.
const PSEUDO_MEDIAN_REC_THRESHOLD = 64;

/// Selects a pivot from `v`. Algorithm taken from glidesort by Orson Peters.
// std: library/core/src/slice/sort/shared/pivot.rs:13 choose_pivot
function choose_pivot<T>(v: T[], vs: number, len: number, is_less: IsLess<T>): number {
  if (len < 8) {
    return panic("core::intrinsics::abort_immediate (choose_pivot)");
  }

  const len_div_8 = Math.floor(len / 8);

  const a = vs; // [0, floor(n/8))
  const b = vs + len_div_8 * 4; // [4*floor(n/8), 5*floor(n/8))
  const c = vs + len_div_8 * 7; // [7*floor(n/8), 8*floor(n/8))

  if (len < PSEUDO_MEDIAN_REC_THRESHOLD) {
    return median3(v, a, b, c, is_less) - vs;
  } else {
    return median3_rec(v, a, b, c, len_div_8, is_less) - vs;
  }
}

/// Calculates an approximate median of 3 elements from sections a, b, c, or
/// recursively from an approximation of each, if they're large enough.
// std: library/core/src/slice/sort/shared/pivot.rs:55 median3_rec
function median3_rec<T>(v: T[], a: number, b: number, c: number, n: number, is_less: IsLess<T>): number {
  if (n * 8 >= PSEUDO_MEDIAN_REC_THRESHOLD) {
    const n8 = Math.floor(n / 8);
    a = median3_rec(v, a, a + n8 * 4, a + n8 * 7, n8, is_less);
    b = median3_rec(v, b, b + n8 * 4, b + n8 * 7, n8, is_less);
    c = median3_rec(v, c, c + n8 * 4, c + n8 * 7, n8, is_less);
  }
  return median3(v, a, b, c, is_less);
}

/// Calculates the median of 3 elements.
// std: library/core/src/slice/sort/shared/pivot.rs:79 median3
function median3<T>(v: T[], a: number, b: number, c: number, is_less: IsLess<T>): number {
  const x = is_less(v[a]!, v[b]!);
  const y = is_less(v[a]!, v[c]!);
  if (x === y) {
    // If x=y=0 then b, c <= a. In this case we want to return max(b, c).
    // If x=y=1 then a < b, c. In this case we want to return min(b, c).
    // By toggling the outcome of b < c using XOR x we get this behavior.
    const z = is_less(v[b]!, v[c]!);
    return z !== x ? c : b;
  } else {
    // Either c <= a < b or b <= a < c, thus a is our median.
    return a;
  }
}

// ---- shared/smallsort.rs (the stable small-sort) ----

/// Optimal number of comparisons, and good perf.
const SMALL_SORT_FALLBACK_THRESHOLD = 16;

/// From a comparison perspective 20 was ~2% more efficient for fully random input, but for
/// wall-clock performance choosing 32 yielded better performance overall.
const SMALL_SORT_GENERAL_THRESHOLD = 32;

/// [`small_sort_general`] uses [`sort8_stable`] as primitive and does a kind of ping-pong merge.
const SMALL_SORT_GENERAL_SCRATCH_LEN = SMALL_SORT_GENERAL_THRESHOLD + 16;

/** `<T as StableSmallSortTypeImpl>::small_sort_threshold` (the `T: FreezeMarker` specialization or the default). */
// std: library/core/src/slice/sort/shared/smallsort.rs:51 small_sort_threshold
function small_sort_threshold(L: SortLayout): number {
  // (smallsort.rs:32, the default impl: `SMALL_SORT_FALLBACK_THRESHOLD`)
  return L.freeze ? SMALL_SORT_GENERAL_THRESHOLD : SMALL_SORT_FALLBACK_THRESHOLD;
}

/** `<T as StableSmallSortTypeImpl>::small_sort` (the `T: FreezeMarker` specialization or the default). */
// std: library/core/src/slice/sort/shared/smallsort.rs:56 small_sort
function small_sort<T>(v: T[], vs: number, len: number, scratch: T[], is_less: IsLess<T>, L: SortLayout): void {
  if (L.freeze) {
    small_sort_general_with_scratch(v, vs, len, scratch, is_less, L);
  } else {
    // (smallsort.rs:38, the default impl)
    if (len >= 2) {
      insertion_sort_shift_left(v, vs, len, 1, is_less);
    }
  }
}

// std: library/core/src/slice/sort/shared/smallsort.rs:220 small_sort_general_with_scratch
function small_sort_general_with_scratch<T>(v: T[], vs: number, len: number, scratch: T[], is_less: IsLess<T>, L: SortLayout): void {
  if (len < 2) {
    return;
  }

  if (scratch.length < len + 16) {
    panic("core::intrinsics::abort_immediate (small_sort_general_with_scratch)");
  }

  const len_div_2 = Math.floor(len / 2);

  let presorted_len: number;
  if (L.size_of <= 16 && len >= 16) {
    sort8_stable(v, vs, scratch, 0, scratch, len, is_less);
    sort8_stable(v, vs + len_div_2, scratch, len_div_2, scratch, len + 8, is_less);

    presorted_len = 8;
  } else if (len >= 8) {
    sort4_stable(v, vs, scratch, 0, is_less);
    sort4_stable(v, vs + len_div_2, scratch, len_div_2, is_less);

    presorted_len = 4;
  } else {
    scratch[0] = v[vs]!;
    scratch[len_div_2] = v[vs + len_div_2]!;

    presorted_len = 1;
  }

  for (const offset of [0, len_div_2]) {
    // at this point dst is initialized with presorted_len elements.
    // We extend this to desired_len, src is valid for desired_len elements.
    const src = vs + offset;
    const dst = offset;
    const desired_len = offset === 0 ? len_div_2 : len - len_div_2;

    for (let i = presorted_len; i < desired_len; i++) {
      scratch[dst + i] = v[src + i]!;
      insert_tail(scratch, dst, dst + i, is_less);
    }
  }

  // at this point scratch_base is fully initialized, allowing us
  // to use it as the source of our merge back into the original array.
  // PORT: the `CopyOnDrop` guard only restores `v` when `is_less` panics (rustc then ICEs); not modelled.
  bidirectional_merge(scratch, 0, len, v, vs, is_less);
}

/// Sorts range [begin, tail] assuming [begin, tail) is already sorted.
// std: library/core/src/slice/sort/shared/smallsort.rs:536 insert_tail
function insert_tail<T>(a: T[], begin: number, tail: number, is_less: IsLess<T>): void {
  let sift = tail - 1;
  if (!is_less(a[tail]!, a[sift]!)) {
    return;
  }

  const tmp = a[tail]!;
  let gap = tail;

  for (;;) {
    a[gap] = a[sift]!;
    gap = sift;

    if (sift === begin) {
      break;
    }

    sift -= 1;
    if (!is_less(tmp, a[sift]!)) {
      break;
    }
  }
  // (`gap_guard` drops: the element moves into the gap)
  a[gap] = tmp;
}

/// Sort `v` assuming `v[..offset]` is already sorted.
// std: library/core/src/slice/sort/shared/smallsort.rs:574 insertion_sort_shift_left
function insertion_sort_shift_left<T>(v: T[], vs: number, len: number, offset: number, is_less: IsLess<T>): void {
  if (offset === 0 || offset > len) {
    panic("core::intrinsics::abort_immediate (insertion_sort_shift_left)");
  }

  const v_end = vs + len;
  for (let tail = vs + offset; tail !== v_end; tail++) {
    insert_tail(v, vs, tail, is_less);
  }
}

/// The result will be stored in `dst[0..4]`.
// std: library/core/src/slice/sort/shared/smallsort.rs:606 sort4_stable
function sort4_stable<T>(src: T[], v_base: number, dst: T[], d: number, is_less: IsLess<T>): void {
  // Stably create two pairs a <= b and c <= d.
  const c1 = is_less(src[v_base + 1]!, src[v_base]!);
  const c2 = is_less(src[v_base + 3]!, src[v_base + 2]!);
  const a = v_base + (c1 ? 1 : 0);
  const b = v_base + (c1 ? 0 : 1);
  const c = v_base + 2 + (c2 ? 1 : 0);
  const dd = v_base + 2 + (c2 ? 0 : 1);

  // Compare (a, c) and (b, d) to identify max/min. We're left with two
  // unknown elements, but because we are a stable sort we must know which
  // one is leftmost and which one is rightmost.
  const c3 = is_less(src[c]!, src[a]!);
  const c4 = is_less(src[dd]!, src[b]!);
  const min = c3 ? c : a;
  const max = c4 ? b : dd;
  const unknown_left = c3 ? a : c4 ? c : b;
  const unknown_right = c4 ? dd : c3 ? b : c;

  // Sort the last two unknown elements.
  const c5 = is_less(src[unknown_right]!, src[unknown_left]!);
  const lo = c5 ? unknown_right : unknown_left;
  const hi = c5 ? unknown_left : unknown_right;

  dst[d] = src[min]!;
  dst[d + 1] = src[lo]!;
  dst[d + 2] = src[hi]!;
  dst[d + 3] = src[max]!;
}

/// The result will be stored in `dst[0..8]`.
// std: library/core/src/slice/sort/shared/smallsort.rs:657 sort8_stable
function sort8_stable<T>(v: T[], v_base: number, dst: T[], d: number, scratch: T[], scratch_base: number, is_less: IsLess<T>): void {
  sort4_stable(v, v_base, scratch, scratch_base, is_less);
  sort4_stable(v, v_base + 4, scratch, scratch_base + 4, is_less);

  // scratch_base[0..8] is now initialized, allowing us to merge back into dst.
  bidirectional_merge(scratch, scratch_base, 8, dst, d, is_less);
}

/// Merge v assuming v[..len / 2] and v[len / 2..] are sorted.
// PORT: `merge_up` / `merge_down` (smallsort.rs:677 / :710) are inlined (they return the three advanced pointers).
// std: library/core/src/slice/sort/shared/smallsort.rs:754 bidirectional_merge
function bidirectional_merge<T>(src: T[], s: number, len: number, out: T[], d: number, is_less: IsLess<T>): void {
  const len_div_2 = Math.floor(len / 2);

  let left = s;
  let right = s + len_div_2;
  let dst = d;

  let left_rev = s + len_div_2 - 1;
  let right_rev = s + len - 1;
  let dst_rev = d + len - 1;

  for (let k = 0; k < len_div_2; k++) {
    // std: library/core/src/slice/sort/shared/smallsort.rs:677 merge_up
    {
      const is_l = !is_less(src[right]!, src[left]!);
      out[dst] = is_l ? src[left]! : src[right]!;
      right += is_l ? 0 : 1;
      left += is_l ? 1 : 0;
      dst += 1;
    }
    // std: library/core/src/slice/sort/shared/smallsort.rs:710 merge_down
    {
      const is_l = !is_less(src[right_rev]!, src[left_rev]!);
      out[dst_rev] = is_l ? src[right_rev]! : src[left_rev]!;
      right_rev -= is_l ? 1 : 0;
      left_rev -= is_l ? 0 : 1;
      dst_rev -= 1;
    }
  }

  const left_end = left_rev + 1;
  const right_end = right_rev + 1;

  // Odd length, so one element is left unconsumed in the input.
  if (len % 2 !== 0) {
    const left_nonempty = left < left_end;
    const last_src = left_nonempty ? left : right;
    out[dst] = src[last_src]!;
    left += left_nonempty ? 1 : 0;
    right += left_nonempty ? 0 : 1;
  }

  // We now should have consumed the full input exactly once. This can only fail if the
  // user-provided comparison function fails to implement a strict weak ordering. In that case
  // we panic and never access the inconsistent state in dst.
  if (left !== left_end || right !== right_end) {
    panic_on_ord_violation();
  }
}

// std: library/core/src/slice/sort/shared/smallsort.rs:839 panic_on_ord_violation
function panic_on_ord_violation(): never {
  return panic("user-provided comparison function does not correctly implement a total order");
}

// ---- helpers ----

/** `usize::ilog2` (n >= 1, n < 2^32). */
function ilog2(n: number): number {
  return 31 - Math.clz32(n);
}

/** `v[vs..vs + len].reverse()` */
function reverse<T>(v: T[], vs: number, len: number): void {
  for (let i = 0, j = vs + len - 1, k = vs; i < Math.floor(len / 2); i++, j--, k++) {
    const t = v[k]!;
    v[k] = v[j]!;
    v[j] = t;
  }
}
