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

/**
 * `size_of::<T>()`, `T: Freeze` and `T: Copy` of the Rust element type (see the module comment). `copy` is only read by
 * the unstable sort's small-sort choice (smallsort.rs `CopyMarker`); a layout without it stops there at `unported`.
 */
export interface SortLayout {
  readonly size_of: number;
  readonly freeze: boolean;
  readonly copy?: boolean;
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

  ipnsort(v, is_less, L);
}

/// See [`sort`]
///
/// Deliberately don't inline the main sorting routine entrypoint to ensure the
/// inlined insertion sort i-cache footprint remains minimal.
// std: library/core/src/slice/sort/unstable/mod.rs:114 ipnsort
function ipnsort<T>(v: T[], is_less: IsLess<T>, L: SortLayout): void {
  const len = v.length;
  const [run_len, was_reversed] = find_existing_run(v, 0, len, is_less);

  // SAFETY: find_existing_run promises to return a valid run_len.

  if (run_len === len) {
    if (was_reversed) {
      reverse(v, 0, len);
    }

    // It would be possible to a do in-place merging here for a long existing streak. But that
    // makes the implementation a lot bigger, users can use `slice::sort` for that use-case.
    return;
  }

  // Limit the number of imbalanced partitions to `2 * floor(log2(len))`.
  // The binary OR by one is used to eliminate the zero-check in the logarithm.
  const limit = 2 * ilog2(len | 1);
  unstable_quicksort(v, 0, len, undefined, limit, is_less, L);
}

// ---- unstable/quicksort.rs ----

/// Sorts `v` recursively.
///
/// If the slice had a predecessor in the original array, it is specified as `ancestor_pivot`.
///
/// `limit` is the number of allowed imbalanced partitions before switching to `heapsort`. If zero,
/// this function will immediately switch to heapsort.
// PORT: `ancestor_pivot: Option<&T>` is the referenced element, which no later step moves (it sits between the
// sub-slices).
// std: library/core/src/slice/sort/unstable/quicksort.rs:21 quicksort
function unstable_quicksort<T>(v: T[], vs: number, len: number, ancestor_pivot: { v: T } | undefined, limit: number, is_less: IsLess<T>, L: SortLayout): void {
  for (;;) {
    if (len <= unstable_small_sort_threshold(L)) {
      unstable_small_sort(v, vs, len, is_less, L);
      return;
    }

    // If too many bad pivot choices were made, simply fall back to heapsort in order to
    // guarantee `O(N x log(N))` worst-case.
    if (limit === 0) {
      heapsort(v, vs, len, is_less);
      return;
    }

    limit -= 1;

    // Choose a pivot and try guessing whether the slice is already sorted.
    const pivot_pos = choose_pivot(v, vs, len, is_less);

    // If the chosen pivot is equal to the predecessor, then it's the smallest element in the
    // slice. Partition the slice into elements equal to and elements greater than the pivot.
    // This case is usually hit when the slice contains many duplicate elements.
    if (ancestor_pivot !== undefined) {
      const p = ancestor_pivot.v;
      if (!is_less(p, v[vs + pivot_pos]!)) {
        const num_lt = partition(v, vs, len, pivot_pos, (a, b) => !is_less(b, a), L);

        // Continue sorting elements greater than the pivot. We know that `num_lt` contains
        // the pivot. So we can continue after `num_lt`.
        vs += num_lt + 1;
        len -= num_lt + 1;
        ancestor_pivot = undefined;
        continue;
      }
    }

    // Partition the slice.
    const num_lt = partition(v, vs, len, pivot_pos, is_less, L);
    // SAFETY: partition ensures that `num_lt` will be in-bounds.

    // Split the slice into `left`, `pivot`, and `right`.
    const pivot = v[vs + num_lt]!;

    // Recurse into the left side. We have a fixed recursion limit, testing shows no real
    // benefit for recursing into the shorter side.
    unstable_quicksort(v, vs, num_lt, ancestor_pivot, limit, is_less, L);

    // Continue with the right side.
    vs += num_lt + 1;
    len -= num_lt + 1;
    ancestor_pivot = { v: pivot };
  }
}

/// Takes the input slice `v` and re-arranges elements such that when the call returns normally
/// all elements that compare true for `is_less(elem, pivot)` where `pivot == v[pivot_pos]` are
/// on the left side of `v` followed by the other elements, notionally considered greater or
/// equal to `pivot`.
///
/// Returns the number of elements that are compared true for `is_less(elem, pivot)`.
///
/// If `is_less` does not implement a total order the resulting order and return value are
/// unspecified. All original elements will remain in `v` and any possible modifications via
/// interior mutability will be observable. Same is true if `is_less` panics or `v.len()`
/// exceeds `scratch.len()`.
// std: library/core/src/slice/sort/unstable/quicksort.rs:93 partition
function partition<T>(v: T[], vs: number, len: number, pivot: number, is_less: IsLess<T>, L: SortLayout): number {
  // Allows for panic-free code-gen by proving this property to the compiler.
  if (len === 0) {
    return 0;
  }

  if (pivot >= len) {
    panic("core::intrinsics::abort_immediate (partition)");
  }

  // SAFETY: We checked that `pivot` is in-bounds.
  // Place the pivot at the beginning of slice.
  swap(v, vs, vs + pivot);
  // PORT: `pivot` is `&mut v[0]`, which the partition of `v[1..]` never moves: passed by value.
  const pivot_ = v[vs]!;

  // This construct is used to limit the LLVM IR generated, which saves large amounts of
  // compile-time by only instantiating the code that is needed. Idea by Frank Steffahn.
  const num_lt = inst_partition<T>(L)(v, vs + 1, len - 1, pivot_, is_less, L);

  if (num_lt >= len) {
    panic("core::intrinsics::abort_immediate (partition)");
  }

  // SAFETY: We checked that `num_lt` is in-bounds.
  // Place the pivot between the two partitions.
  swap(v, vs, vs + num_lt);

  return num_lt;
}

type PartitionFn<T> = (v: T[], vs: number, len: number, pivot: T, is_less: IsLess<T>, L: SortLayout) => number;

// std: library/core/src/slice/sort/unstable/quicksort.rs:139 inst_partition
function inst_partition<T>(L: SortLayout): PartitionFn<T> {
  const MAX_BRANCHLESS_PARTITION_SIZE = 96;
  if (L.size_of <= MAX_BRANCHLESS_PARTITION_SIZE) {
    // Specialize for types that are relatively cheap to copy, where branchless optimizations
    // have large leverage e.g. `u64` and `String`.
    // (not `optimize_for_size`)
    return partition_lomuto_branchless_cyclic;
  } else {
    return partition_hoare_branchy_cyclic;
  }
}

/// See [`partition`].
// PORT: the `GapGuard` drop (quicksort.rs:363) runs when `gap_opt` goes out of scope: after computing the result.
// std: library/core/src/slice/sort/unstable/quicksort.rs:154 partition_hoare_branchy_cyclic
function partition_hoare_branchy_cyclic<T>(v: T[], vs: number, len: number, pivot: T, is_less: IsLess<T>, _L: SortLayout): number {
  if (len === 0) {
    return 0;
  }

  // Optimized for large types that are expensive to move. Not optimized for integers. Optimized
  // for small code-gen, assuming that is_less is an expensive operation that generates
  // substantial amounts of code or a call. And that copying elements will likely be a call to
  // memcpy. Using 2 `ptr::copy_nonoverlapping` has the chance to be faster than
  // `ptr::swap_nonoverlapping` because `memcpy` can use wide SIMD based on runtime feature
  // detection. Benchmarks support this analysis.

  let gap_opt: { pos: number; value: T } | undefined = undefined;

  let left = vs;
  let right = vs + len;

  for (;;) {
    // Find the first element greater than the pivot.
    while (left < right && is_less(v[left]!, pivot)) {
      left += 1;
    }

    // Find the last element equal to the pivot.
    for (;;) {
      right -= 1;
      if (left >= right || is_less(v[right]!, pivot)) {
        break;
      }
    }

    if (left >= right) {
      break;
    }

    // Swap the found pair of out-of-order elements via cyclic permutation.
    const is_first_swap_pair = gap_opt === undefined;

    if (is_first_swap_pair) {
      gap_opt = { pos: right, value: v[left]! };
    }

    const gap = gap_opt!;

    // Single place where we instantiate ptr::copy_nonoverlapping in the partition.
    if (!is_first_swap_pair) {
      v[gap.pos] = v[left]!;
    }
    gap.pos = right;
    v[left] = v[right]!;

    left += 1;
  }

  const num_lt = left - vs;

  // `gap_opt` goes out of scope and overwrites the last wrong-side element on the right side
  // with the first wrong-side element of the left side that was initially overwritten by the
  // first wrong-side element on the right side element.
  if (gap_opt !== undefined) {
    v[gap_opt.pos] = gap_opt.value;
  }
  return num_lt;
}

/** PORT: `state.right` / `state.gap.pos` pointing at the saved gap value (`&mut *gap_value`) instead of into `v`. */
const GAP_VALUE = -1;

// PORT: `PartitionState` (quicksort.rs:234) is the `state` object; `loop_body` reads `*state.right` through `GAP_VALUE`.
// std: library/core/src/slice/sort/unstable/quicksort.rs:245 partition_lomuto_branchless_cyclic
function partition_lomuto_branchless_cyclic<T>(v: T[], vs: number, len: number, pivot: T, is_less: IsLess<T>, L: SortLayout): number {
  // Novel partition implementation by Lukas Bergdoll and Orson Peters. Branchless Lomuto
  // partition paired with a cyclic permutation.
  // https://github.com/Voultapher/sort-research-rs/blob/main/writeup/lomcyc_partition/text.md

  const v_base = vs;

  if (len === 0) {
    return 0;
  }

  // Ideally we could just use GapGuard in PartitionState, but the reference that is
  // materialized with `&mut state` when calling `loop_body` would create a mutable reference
  // to the parent struct that contains the gap value, invalidating the reference pointer
  // created from a reference to the gap value in the cleanup loop. This is only an issue
  // under Stacked Borrows, Tree Borrows accepts the intuitive code using GapGuard as valid.
  const gap_value = v[v_base]!;

  const state = {
    num_lt: 0,
    right: v_base + 1,

    gap_pos: v_base,
  };

  const loop_body = (): void => {
    const right_val = state.right === GAP_VALUE ? gap_value : v[state.right]!;
    const right_is_lt = is_less(right_val, pivot);
    const left = v_base + state.num_lt;

    // ptr::copy(left, state.gap.pos, 1)
    if (state.gap_pos !== GAP_VALUE) v[state.gap_pos] = v[left]!;
    // ptr::copy_nonoverlapping(state.right, left, 1)
    v[left] = right_val;

    state.gap_pos = state.right;
    state.num_lt += right_is_lt ? 1 : 0;

    state.right = state.right + 1;
  };

  // Manual unrolling that works well on x86, Arm and with opt-level=s without murdering
  // compile-times. Leaving this to the compiler yields ok to bad results.
  const unroll_len = L.size_of <= 16 ? 2 : 1;

  const unroll_end = v_base + (len - (unroll_len - 1));
  while (state.right < unroll_end) {
    if (unroll_len === 2) {
      loop_body();
      loop_body();
    } else {
      loop_body();
    }
  }

  // Single instantiate `loop_body` for both the unroll cleanup and cyclic permutation
  // cleanup. Optimizes binary-size and compile-time.
  const end = v_base + len;
  for (;;) {
    const is_done = state.right === end;
    state.right = is_done ? GAP_VALUE : state.right;

    loop_body();

    if (is_done) {
      // mem::forget(state.gap);
      break;
    }
  }

  return state.num_lt;
}

// ---- unstable/heapsort.rs ----

/// Sorts `v` using heapsort, which guarantees *O*(*n* \* log(*n*)) worst-case.
///
/// Never inline this, it sits the main hot-loop in `recurse` and is meant as unlikely algorithmic
/// fallback.
// std: library/core/src/slice/sort/unstable/heapsort.rs:10 heapsort
function heapsort<T>(v: T[], vs: number, len: number, is_less: IsLess<T>): void {
  for (let i = len + Math.floor(len / 2) - 1; i >= 0; i--) {
    let sift_idx: number;
    if (i >= len) {
      sift_idx = i - len;
    } else {
      swap(v, vs, vs + i);
      sift_idx = 0;
    }

    // SAFETY: The above calculation ensures that `sift_idx` is either 0 or
    // `(len..(len + (len / 2))) - len`, which simplifies to `0..(len / 2)`.
    // This guarantees the required `sift_idx <= len`.
    sift_down(v, vs, Math.min(i, len), sift_idx, is_less);
  }
}

// This binary heap respects the invariant `parent >= child`.
//
// SAFETY: The caller has to guarantee that `node <= v.len()`.
// std: library/core/src/slice/sort/unstable/heapsort.rs:37 sift_down
function sift_down<T>(v: T[], vs: number, len: number, node: number, is_less: IsLess<T>): void {
  for (;;) {
    // Children of `node`.
    let child = 2 * node + 1;
    if (child >= len) {
      break;
    }

    // Choose the greater child.
    if (child + 1 < len) {
      // We need a branch to be sure not to out-of-bounds index,
      // but it's highly predictable.  The comparison, however,
      // is better done branchless, especially for primitives.
      child += is_less(v[vs + child]!, v[vs + child + 1]!) ? 1 : 0;
    }

    // Stop if the invariant holds at `node`.
    if (!is_less(v[vs + node]!, v[vs + child]!)) {
      break;
    }

    swap(v, vs + node, vs + child);

    node = child;
  }
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

/** `<T as UnstableSmallSortTypeImpl>::small_sort_threshold`: the `T: FreezeMarker` specialization or the default. */
// std: library/core/src/slice/sort/shared/smallsort.rs:92 small_sort_threshold
function unstable_small_sort_threshold(L: SortLayout): number {
  if (!L.freeze) {
    // (smallsort.rs:77, the default impl)
    return SMALL_SORT_FALLBACK_THRESHOLD;
  }
  if (unstable_freeze_copy(L)) {
    // (smallsort.rs:144, `T: FreezeMarker + CopyMarker`)
    if (has_efficient_in_place_swap(L) && L.size_of * SMALL_SORT_NETWORK_SCRATCH_LEN <= MAX_STACK_ARRAY_SIZE) {
      return SMALL_SORT_NETWORK_THRESHOLD;
    } else if (L.size_of * SMALL_SORT_GENERAL_SCRATCH_LEN <= MAX_STACK_ARRAY_SIZE) {
      return SMALL_SORT_GENERAL_THRESHOLD;
    } else {
      return SMALL_SORT_FALLBACK_THRESHOLD;
    }
  }
  // (smallsort.rs:115, the `UnstableSmallSortFreezeTypeImpl` default)
  if (L.size_of * SMALL_SORT_GENERAL_SCRATCH_LEN <= MAX_STACK_ARRAY_SIZE) {
    return SMALL_SORT_GENERAL_THRESHOLD;
  } else {
    return SMALL_SORT_FALLBACK_THRESHOLD;
  }
}

/** `<T as UnstableSmallSortTypeImpl>::small_sort`: the `T: FreezeMarker` specialization or the default. */
// std: library/core/src/slice/sort/shared/smallsort.rs:97 small_sort
function unstable_small_sort<T>(v: T[], vs: number, len: number, is_less: IsLess<T>, L: SortLayout): void {
  if (!L.freeze) {
    // (smallsort.rs:82, the default impl)
    small_sort_fallback(v, vs, len, is_less);
    return;
  }
  if (unstable_freeze_copy(L)) {
    // (smallsort.rs:157, `T: FreezeMarker + CopyMarker`)
    if (has_efficient_in_place_swap(L) && L.size_of * SMALL_SORT_NETWORK_SCRATCH_LEN <= MAX_STACK_ARRAY_SIZE) {
      small_sort_network(v, vs, len, is_less);
    } else if (L.size_of * SMALL_SORT_GENERAL_SCRATCH_LEN <= MAX_STACK_ARRAY_SIZE) {
      small_sort_general(v, vs, len, is_less, L);
    } else {
      small_sort_fallback(v, vs, len, is_less);
    }
    return;
  }
  // (smallsort.rs:124, the `UnstableSmallSortFreezeTypeImpl` default)
  if (L.size_of * SMALL_SORT_GENERAL_SCRATCH_LEN <= MAX_STACK_ARRAY_SIZE) {
    small_sort_general(v, vs, len, is_less, L);
  } else {
    small_sort_fallback(v, vs, len, is_less);
  }
}

/** Whether the `T: FreezeMarker + CopyMarker` specialization applies (`SortLayout.copy`). */
function unstable_freeze_copy(L: SortLayout): boolean {
  if (L.copy === undefined) {
    return unported("core::slice::sort::shared::smallsort: `T: Copy` of the element type (SortLayout.copy) for sort_unstable");
  }
  return L.copy;
}

const SMALL_SORT_NETWORK_THRESHOLD = 32;
const SMALL_SORT_NETWORK_SCRATCH_LEN = SMALL_SORT_NETWORK_THRESHOLD;

/// Using a stack array, could cause a stack overflow if the type `T` is very large. To be
/// conservative we limit the usage of small-sorts that require a stack array to types that fit
/// within this limit.
const MAX_STACK_ARRAY_SIZE = 4096;

// std: library/core/src/slice/sort/shared/smallsort.rs:199 small_sort_fallback
function small_sort_fallback<T>(v: T[], vs: number, len: number, is_less: IsLess<T>): void {
  if (len >= 2) {
    insertion_sort_shift_left(v, vs, len, 1, is_less);
  }
}

// std: library/core/src/slice/sort/shared/smallsort.rs:205 small_sort_general
function small_sort_general<T>(v: T[], vs: number, len: number, is_less: IsLess<T>, L: SortLayout): void {
  const stack_array: T[] = new Array<T>(SMALL_SORT_GENERAL_SCRATCH_LEN);

  small_sort_general_with_scratch(v, vs, len, stack_array, is_less, L);
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

// PORT: the `CopyOnDrop` guard only restores `v` when `is_less` panics (rustc then ICEs); not modelled.
// std: library/core/src/slice/sort/shared/smallsort.rs:311 small_sort_network
function small_sort_network<T>(v: T[], vs: number, len: number, is_less: IsLess<T>): void {
  // This implementation is tuned to be efficient for integer types.

  if (len < 2) {
    return;
  }

  if (len > SMALL_SORT_NETWORK_SCRATCH_LEN) {
    panic("core::intrinsics::abort_immediate (small_sort_network)");
  }

  const stack_array: T[] = new Array<T>(SMALL_SORT_NETWORK_SCRATCH_LEN);

  const len_div_2 = Math.floor(len / 2);
  const no_merge = len < 18;

  const v_base = vs;
  const initial_region_len = no_merge ? len : len_div_2;
  // SAFETY: Both possible values of `initial_region_len` are in-bounds.
  let region = v_base;
  let region_len = initial_region_len;

  // Avoid compiler unrolling, we *really* don't want that to happen here for binary-size reasons.
  for (;;) {
    let presorted_len: number;
    if (region_len >= 13) {
      sort13_optimal(v, region, region_len, is_less);
      presorted_len = 13;
    } else if (region_len >= 9) {
      sort9_optimal(v, region, region_len, is_less);
      presorted_len = 9;
    } else {
      presorted_len = 1;
    }

    insertion_sort_shift_left(v, region, region_len, presorted_len, is_less);

    if (no_merge) {
      return;
    }

    if (region !== v_base) {
      break;
    }

    // SAFETY: The right side of `v` based on `len_div_2` is guaranteed in-bounds.
    region = v_base + len_div_2;
    region_len = len - len_div_2;
  }

  // SAFETY: We checked that T is Freeze and thus observation safe.
  // Should is_less panic v was not modified in parity_merge and retains it's original input.
  // scratch and v must not alias and scratch has v.len() space.
  const scratch_base = stack_array;
  bidirectional_merge(v, v_base, len, scratch_base, 0, is_less);
  for (let i = 0; i < len; i++) {
    v[v_base + i] = scratch_base[i]!;
  }
}

/// Swap two values in the slice pointed to by `v_base` at the position `a_pos` and `b_pos` if the
/// value at position `b_pos` is less than the one at position `a_pos`.
///
/// Purposefully not marked `#[inline]`, despite us wanting it to be inlined for integers like
/// types. `is_less` could be a huge function and we want to give the compiler an option to
/// not inline this function. For the same reasons that this function is very perf critical
/// it should be in the same module as the functions that use it.
// std: library/core/src/slice/sort/shared/smallsort.rs:380 swap_if_less
function swap_if_less<T>(v: T[], v_base: number, a_pos: number, b_pos: number, is_less: IsLess<T>): void {
  const v_a = v_base + a_pos;
  const v_b = v_base + b_pos;

  // PANIC SAFETY: if is_less panics, no scratch memory was created and the slice should still be
  // in a well defined state, without duplicates.

  // Important to only swap if it is more and not if it is equal. is_less should return false for
  // equal, so we don't swap.
  const should_swap = is_less(v[v_b]!, v[v_a]!);

  // This is a branchless version of swap if.
  // The equivalent code with a branch would be:
  //
  // if should_swap {
  //     ptr::swap(v_a, v_b, 1);
  // }

  // The goal is to generate cmov instructions here.
  const v_a_swap = should_swap ? v_b : v_a;
  const v_b_swap = should_swap ? v_a : v_b;

  const v_b_swap_tmp = v[v_b_swap]!;
  v[v_a] = v[v_a_swap]!;
  v[v_b] = v_b_swap_tmp;
}

/// Sorts the first 9 elements of `v` with a fast fixed function.
///
/// Should `is_less` generate substantial amounts of code the compiler can choose to not inline
/// `swap_if_less`. If the code of a sort impl changes so as to call this function in multiple
/// places, `#[inline(never)]` is recommended to keep binary-size in check. The current design of
/// `small_sort_network` makes sure to only call this once.
// std: library/core/src/slice/sort/shared/smallsort.rs:420 sort9_optimal
function sort9_optimal<T>(v: T[], v_base: number, len: number, is_less: IsLess<T>): void {
  if (len < 9) {
    panic("core::intrinsics::abort_immediate (sort9_optimal)");
  }

  // Optimal sorting network see:
  // https://bertdobbelaere.github.io/sorting_networks.html.

  // SAFETY: We checked the len.
  for (const [a, b] of SORT9_NETWORK) {
    swap_if_less(v, v_base, a, b, is_less);
  }
}
/** PORT: sort9_optimal's 25 `swap_if_less(v_base, a, b, is_less)` calls, in order. */
const SORT9_NETWORK: readonly (readonly [number, number])[] = [
  [0, 3], [1, 7], [2, 5], [4, 8], [0, 7], [2, 4], [3, 8], [5, 6], [0, 2], [1, 3], [4, 5], [7, 8], [1, 4],
  [3, 6], [5, 7], [0, 1], [2, 4], [3, 5], [6, 8], [2, 3], [4, 5], [6, 7], [1, 2], [3, 4], [5, 6],
];

/// Sorts the first 13 elements of `v` with a fast fixed function.
///
/// Should `is_less` generate substantial amounts of code the compiler can choose to not inline
/// `swap_if_less`. If the code of a sort impl changes so as to call this function in multiple
/// places, `#[inline(never)]` is recommended to keep binary-size in check. The current design of
/// `small_sort_network` makes sure to only call this once.
// std: library/core/src/slice/sort/shared/smallsort.rs:469 sort13_optimal
function sort13_optimal<T>(v: T[], v_base: number, len: number, is_less: IsLess<T>): void {
  if (len < 13) {
    panic("core::intrinsics::abort_immediate (sort13_optimal)");
  }

  // Optimal sorting network see:
  // https://bertdobbelaere.github.io/sorting_networks.html.

  // SAFETY: We checked the len.
  for (const [a, b] of SORT13_NETWORK) {
    swap_if_less(v, v_base, a, b, is_less);
  }
}
/** PORT: sort13_optimal's 45 `swap_if_less(v_base, a, b, is_less)` calls, in order. */
const SORT13_NETWORK: readonly (readonly [number, number])[] = [
  [0, 12], [1, 10], [2, 9], [3, 7], [5, 11], [6, 8], [1, 6], [2, 3], [4, 11], [7, 9], [8, 10], [0, 4], [1, 2],
  [3, 6], [7, 8], [9, 10], [11, 12], [4, 6], [5, 9], [8, 11], [10, 12], [0, 5], [3, 8], [4, 7], [6, 11], [9, 10],
  [0, 1], [2, 5], [6, 9], [7, 8], [10, 11], [1, 3], [2, 4], [5, 6], [9, 10], [1, 2], [3, 4], [5, 7], [6, 8],
  [2, 3], [4, 5], [6, 7], [8, 9], [3, 4], [5, 6],
];

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

// std: library/core/src/slice/sort/shared/smallsort.rs:858 has_efficient_in_place_swap
function has_efficient_in_place_swap(L: SortLayout): boolean {
  // Heuristic that holds true on all tested 64-bit capable architectures.
  return L.size_of <= 8; // size_of::<u64>()
}

/** `v.swap(a, b)` */
function swap<T>(v: T[], a: number, b: number): void {
  const t = v[a]!;
  v[a] = v[b]!;
  v[b] = t;
}

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
