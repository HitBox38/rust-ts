// Port of hashbrown =0.17.1 `src/raw.rs`: the subset that decides where elements live and in which
// order they are visited (allocation sizes, insert / find / erase, growth and in-place rehash,
// clone, and the full-bucket iterators). std's `HashMap` (and so rustc's `FxHashMap`) is this crate
// (library/Cargo.lock: hashbrown 0.17.1, features `rustc-dep-of-std` = `nightly` + `rustc-internal-api`).
//
// PORT: memory layout. Upstream keeps the buckets (`T_n .. T_0`) and the control bytes in one
// allocation and addresses buckets by pointer arithmetic from `ctrl`. Here a `RawTableInner` owns
// `ctrl: Uint8Array` (`bucket_mask + 1 + Group::WIDTH` bytes; `Group::static_empty()` for the empty
// singleton) and `data: unknown[]` (bucket `i` at `data[i]`). A `Bucket<T>` and a `*mut Tag` /
// `*mut u8` into the table are bucket / control-byte indices (`number`). Moving or swapping bucket
// bytes (`ptr::copy_nonoverlapping`, `ptr::swap_nonoverlapping`) moves / swaps `data` slots.
// PORT: integers. Hashes are u64 `bigint`s. `usize` sizes and indices are `number`s; tables stay far
// below 2^31 buckets (asserted in `RawTableInner::new_uninitialized`), so the `&`/`-` masking of
// indices on 32-bit JS integers is exact, and `h1(hash) & bucket_mask` only needs the low 32 bits.
// PORT: allocation. The allocator is always `Global` (std's `HashMap`), whose `allocate` returns a
// block of exactly `layout.size()` bytes, so `new_uninitialized`'s over-sized-allocation branch is
// never taken (it is ported anyway). Allocation failure aborts (`handle_alloc_error`), modeled as a
// panic. `TableLayout` comes from the element type: callers pass `size_of::<T>()` /
// `align_of::<T>()` (only `size <= 1` changes anything on this host: see `capacity_to_buckets`).
// PORT: drops. JS has no destructors: `T::NEEDS_DROP` is false, the `drop` callbacks are `undefined`,
// and scope guards that only run on unwind become `catch` blocks that rethrow.

import { assert, panic } from "../../std/panic.ts";
import { BitMaskIter, Group, Tag, TagSliceExt } from "./control/mod.ts";

/// Whether memory allocation errors should return an error or abort.
export type Fallibility = "Fallible" | "Infallible";
export const Fallibility = {
  Fallible: "Fallible",
  Infallible: "Infallible",

  /// Error to return on capacity overflow.
  // crate: hashbrown-0.17.1/src/raw.rs:33 capacity_overflow
  capacity_overflow(self: Fallibility): TryReserveError {
    switch (self) {
      case "Fallible":
        return { $: "CapacityOverflow" };
      case "Infallible":
        return panic("Hash table capacity overflow");
    }
  },

  /// Error to return on allocation error.
  // crate: hashbrown-0.17.1/src/raw.rs:42 alloc_err
  alloc_err(self: Fallibility, layout: Layout): TryReserveError {
    switch (self) {
      case "Fallible":
        return { $: "AllocError", layout };
      case "Infallible":
        // PORT: `handle_alloc_error(layout)` aborts; JS cannot fail an allocation of this size.
        return panic(`memory allocation of ${layout.size} bytes failed`);
    }
  },
} as const;

/// The error type for `try_reserve` methods (src/lib.rs).
export type TryReserveError = { $: "CapacityOverflow" } | { $: "AllocError"; layout: Layout };

/** `core::alloc::Layout` (size and alignment only). */
export interface Layout {
  size: number;
  align: number;
}

/** `Result<T, TryReserveError>` of the fallible paths. */
type Res<T> = { $: "Ok"; _0: T } | { $: "Err"; _0: TryReserveError };

/// Primary hash function, used to select the initial bucket to probe from.
// PORT: `hash as usize`; only the low 32 bits (`>>> 0`) ever survive `& bucket_mask` (see header).
// crate: hashbrown-0.17.1/src/raw.rs:60 h1
function h1(hash: bigint): number {
  // On 32-bit platforms we simply ignore the higher hash bits.
  return Number(hash & 0xffff_ffffn);
}

/// Probe sequence based on triangular numbers, which is guaranteed (since our
/// table size is a power of two) to visit every group of elements exactly once.
///
/// A triangular probe has us jump by 1 more group every time. So first we
/// jump by 1 group (meaning we just continue our linear scan), then 2 groups
/// (skipping over 1 group), then 3 groups (skipping over 2 groups), and so on.
///
/// Proof that the probe will visit every group in the table:
/// <https://fgiesen.wordpress.com/2015/02/22/triangular-numbers-mod-2n/>
class ProbeSeq {
  constructor(
    public pos: number,
    public stride: number,
  ) {}

  // crate: hashbrown-0.17.1/src/raw.rs:82 move_next
  move_next(bucket_mask: number): void {
    // We should have found an empty bucket by now and ended the probe.
    // debug_assert!(self.stride <= bucket_mask, "Went past end of probe sequence");

    this.stride += Group.WIDTH;
    this.pos += this.stride;
    this.pos &= bucket_mask;
  }
}

/** `usize::next_power_of_two` */
function next_power_of_two(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/// Returns the number of buckets needed to hold the given number of items,
/// taking the maximum load factor into account.
///
/// Returns `None` if an overflow occurs.
///
/// This ensures that `buckets * table_layout.size >= table_layout.ctrl_align`.
// Workaround for emscripten bug emscripten-core/emscripten-fastcomp#258
// crate: hashbrown-0.17.1/src/raw.rs:104 capacity_to_buckets
export function capacity_to_buckets(cap: number, table_layout: TableLayout): number | undefined {
  // debug_assert_ne!(cap, 0);

  // For small tables we require at least 1 empty bucket so that lookups are
  // guaranteed to terminate if an element doesn't exist in the table.
  if (cap < 15) {
    // Consider a small TableLayout like { size: 1, ctrl_align: 16 } on a
    // platform with Group::WIDTH of 16 (like x86_64 with SSE2). For small
    // bucket sizes, this ends up wasting quite a few bytes just to pad to
    // the relatively larger ctrl_align:
    //
    // | capacity | buckets | bytes allocated | bytes per item |
    // | -------- | ------- | --------------- | -------------- |
    // |        3 |       4 |              36 | (Yikes!)  12.0 |
    // |        7 |       8 |              40 | (Poor)     5.7 |
    // |       14 |      16 |              48 |            3.4 |
    // |       28 |      32 |              80 |            3.3 |
    //
    // In general, buckets * table_layout.size >= table_layout.ctrl_align
    // must be true to avoid these edges. This is implemented by adjusting
    // the minimum capacity upwards for small items. This code only needs
    // to handle ctrl_align which are less than or equal to Group::WIDTH,
    // because valid layout sizes are always a multiple of the alignment,
    // so anything with alignment over the Group::WIDTH won't hit this edge
    // case.

    // This is brittle, e.g. if we ever add 32 byte groups, it will select
    // 3 regardless of the table_layout.size.
    let min_cap: number;
    if (Group.WIDTH === 16 && table_layout.size <= 1) {
      min_cap = 14;
    } else if ((Group.WIDTH === 16 && table_layout.size >= 2 && table_layout.size <= 3) || (Group.WIDTH === 8 && table_layout.size <= 1)) {
      min_cap = 7;
    } else {
      min_cap = 3;
    }
    const cap_ = Math.max(min_cap, cap);
    // We don't bother with a table size of 2 buckets since that can only
    // hold a single element. Instead, we skip directly to a 4 bucket table
    // which can hold 3 elements.
    const buckets = cap_ < 4 ? 4 : cap_ < 8 ? 8 : 16;
    ensure_bucket_bytes_at_least_ctrl_align(table_layout, buckets);
    return buckets;
  }

  // Otherwise require 1/8 buckets to be empty (87.5% load)
  //
  // Be careful when modifying this, calculate_layout relies on the
  // overflow check here.
  // PORT: `cap.checked_mul(8)?`: `cap` is a `number` far below 2^50, so the product is exact.
  if (cap * 8 > Number.MAX_SAFE_INTEGER) return undefined;
  const adjusted_cap = Math.floor((cap * 8) / 7);

  // Any overflows will have been caught by the checked_mul. Also, any
  // rounding errors from the division above will be cleaned up by
  // next_power_of_two (which can't overflow because of the previous division).
  const buckets = next_power_of_two(adjusted_cap);
  ensure_bucket_bytes_at_least_ctrl_align(table_layout, buckets);
  return buckets;
}

// `maximum_buckets_in` relies on the property that for non-ZST `T`, any
// chosen `buckets` will satisfy `buckets * table_layout.size >=
// table_layout.ctrl_align`, so `calculate_layout_for` does not need to add
// extra padding beyond `table_layout.size * buckets`. If small-table bucket
// selection or growth policy changes, revisit `maximum_buckets_in`.
// crate: hashbrown-0.17.1/src/raw.rs:172 ensure_bucket_bytes_at_least_ctrl_align
function ensure_bucket_bytes_at_least_ctrl_align(table_layout: TableLayout, buckets: number): void {
  if (table_layout.size !== 0) {
    const prod = table_layout.size * buckets;
    // debug_assert!(prod >= table_layout.ctrl_align);
    void prod;
  }
}

/// Returns the maximum effective capacity for the given bucket mask, taking
/// the maximum load factor into account.
// crate: hashbrown-0.17.1/src/raw.rs:182 bucket_mask_to_capacity
export function bucket_mask_to_capacity(bucket_mask: number): number {
  if (bucket_mask < 8) {
    // For tables with 1/2/4/8 buckets, we always reserve one empty slot.
    // Keep in mind that the bucket mask is one less than the bucket count.
    return bucket_mask;
  } else {
    // For larger tables we reserve 12.5% of the slots as empty.
    return Math.floor((bucket_mask + 1) / 8) * 7;
  }
}

/// Helper which allows the max calculation for `ctrl_align` to be statically computed for each `T`
/// while keeping the rest of `calculate_layout_for` independent of `T`
// PORT: `#[derive(Copy, Clone)]`: never mutated.
export class TableLayout {
  constructor(
    readonly size: number,
    readonly ctrl_align: number,
  ) {}

  // PORT: `Layout::new::<T>()` is passed as `size_of::<T>()` / `align_of::<T>()`.
  // crate: hashbrown-0.17.1/src/raw.rs:203 new
  static new(size: number, align: number): TableLayout {
    return new TableLayout(size, align > Group.WIDTH ? align : Group.WIDTH);
  }

  // crate: hashbrown-0.17.1/src/raw.rs:216 calculate_layout_for
  calculate_layout_for(buckets: number): [Layout, number] | undefined {
    // debug_assert!(buckets.is_power_of_two());

    const { size, ctrl_align } = this;
    // Manual layout calculation since Layout methods are not yet stable.
    // PORT: the `checked_*` overflows of 64-bit `usize` cannot happen below 2^53.
    const ctrl_offset = Math.ceil((size * buckets) / ctrl_align) * ctrl_align;
    const len = ctrl_offset + buckets + Group.WIDTH;

    // We need an additional check to ensure that the allocation doesn't
    // exceed `isize::MAX` (https://github.com/rust-lang/rust/pull/95295).
    if (len > Number.MAX_SAFE_INTEGER - (ctrl_align - 1)) {
      return undefined;
    }

    return [{ size: len, align: ctrl_align }, ctrl_offset];
  }
}

/// A raw hash table with an unsafe API.
// PORT: `Bucket<T>` is the bucket index; `RawTable<T, Global>` has no allocator field.
export class RawTable<T> {
  constructor(
    public table: RawTableInner,
    /** `Self::TABLE_LAYOUT` (`TableLayout::new::<T>()`) */
    readonly TABLE_LAYOUT: TableLayout,
  ) {}

  /// Creates a new empty hash table without allocating any memory.
  ///
  /// In effect this returns a table with exactly 1 bucket. However we can
  /// leave the data pointer dangling since that bucket is never accessed
  /// due to our load factor forcing us to always have at least 1 free bucket.
  // crate: hashbrown-0.17.1/src/raw.rs:590 new
  // crate: hashbrown-0.17.1/src/raw.rs:616 new_in
  static new<T>(layout: TableLayout): RawTable<T> {
    return new RawTable<T>(RawTableInner.NEW(), layout);
  }

  /// Allocates a new hash table with the given number of buckets.
  ///
  /// The control bytes are left uninitialized.
  // crate: hashbrown-0.17.1/src/raw.rs:628 new_uninitialized
  static new_uninitialized<T>(layout: TableLayout, buckets: number, fallibility: Fallibility): Res<RawTable<T>> {
    // debug_assert!(buckets.is_power_of_two());

    const table = RawTableInner.new_uninitialized(layout, buckets, fallibility);
    if (table.$ === "Err") return table;
    return { $: "Ok", _0: new RawTable<T>(table._0, layout) };
  }

  /// Allocates a new hash table with at least enough capacity for inserting
  /// the given number of elements without reallocating.
  // crate: hashbrown-0.17.1/src/raw.rs:600 with_capacity
  // crate: hashbrown-0.17.1/src/raw.rs:646 with_capacity_in
  static with_capacity<T>(layout: TableLayout, capacity: number): RawTable<T> {
    return new RawTable<T>(RawTableInner.with_capacity(layout, capacity), layout);
  }

  /// Returns the index of a bucket from a `Bucket`.
  // crate: hashbrown-0.17.1/src/raw.rs:710 bucket_index
  bucket_index(bucket: number): number {
    return bucket;
  }

  /// Returns a pointer to an element in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:738 bucket
  bucket(index: number): number {
    // debug_assert_ne!(self.table.bucket_mask, 0);
    // debug_assert!(index < self.num_buckets());
    return index;
  }

  /** `bucket.as_ref()` / `bucket.read()` */
  bucket_as_ref(bucket: number): T {
    return this.table.data[bucket] as T;
  }

  /** `bucket.write(val)` */
  bucket_write(bucket: number, val: T): void {
    this.table.data[bucket] = val;
  }

  /// Erases an element from the table without dropping it.
  // crate: hashbrown-0.17.1/src/raw.rs:770 erase_no_drop
  erase_no_drop(item: number): void {
    const index = this.bucket_index(item);
    this.table.erase(index);
  }

  /// Erases an element from the table, dropping it in place.
  // crate: hashbrown-0.17.1/src/raw.rs:780 erase
  erase(item: number): void {
    // Erase the element from the table first since drop might panic.
    this.erase_no_drop(item);
    // item.drop();
    this.table.data[item] = undefined;
  }

  /// Removes an element from the table, returning it.
  ///
  /// This also returns an index to the newly free bucket.
  // crate: hashbrown-0.17.1/src/raw.rs:793 remove
  remove(item: number): [T, number] {
    this.erase_no_drop(item);
    const v = this.bucket_as_ref(item);
    this.table.data[item] = undefined;
    return [v, this.bucket_index(item)];
  }

  /// Finds and removes an element from the table, returning it.
  // crate: hashbrown-0.17.1/src/raw.rs:817 remove_entry
  remove_entry(hash: bigint, eq: (t: T) => boolean): T | undefined {
    // Avoid `Option::map` because it bloats LLVM IR.
    const bucket = this.find(hash, eq);
    if (bucket !== undefined) {
      return this.remove(bucket)[0];
    } else {
      return undefined;
    }
  }

  /// Marks all table buckets as empty without dropping their contents.
  // crate: hashbrown-0.17.1/src/raw.rs:827 clear_no_drop
  clear_no_drop(): void {
    this.table.clear_no_drop();
  }

  /// Removes all elements from the table without freeing the backing memory.
  // crate: hashbrown-0.17.1/src/raw.rs:833 clear
  clear(): void {
    if (this.is_empty()) {
      // Special case empty table to avoid surprising O(capacity) time.
      return;
    }
    // Ensure that the table is reset even if one of the drops panic
    // (`self_.table.drop_elements::<T>()`: no destructors in JS.)
    this.table.data.fill(undefined);
    this.clear_no_drop();
  }

  /// Shrinks the table to fit `max(self.items, min_size)` elements.
  // crate: hashbrown-0.17.1/src/raw.rs:850 shrink_to
  shrink_to(min_size: number, hasher: (t: T) => bigint): void {
    // Calculate the minimal number of elements that we need to reserve
    // space for.
    min_size = Math.max(this.table.items, min_size);
    if (min_size === 0) {
      this.table = RawTableInner.NEW();
      return;
    }

    // Calculate the number of buckets that we need for this number of
    // elements. If the calculation overflows then the requested bucket
    // count must be larger than what we have right and nothing needs to be
    // done.
    const min_buckets = capacity_to_buckets(min_size, this.TABLE_LAYOUT);
    if (min_buckets === undefined) return;

    // If we have more buckets than we need, shrink the table.
    if (min_buckets < this.num_buckets()) {
      // Fast path if the table is empty
      if (this.table.items === 0) {
        this.table = RawTableInner.with_capacity(this.TABLE_LAYOUT, min_size);
      } else {
        // SAFETY:
        // 1. We know for sure that `min_size >= self.table.items`.
        // 2. The [`RawTableInner`] must already have properly initialized control bytes since
        //    we will never expose RawTable::new_uninitialized in a public API.
        // (The result cannot be an error because `fallibility == Fallibility::Infallible`.)
        this.resize(min_size, hasher, "Infallible");
      }
    }
  }

  /// Ensures that at least `additional` items can be inserted into the table
  /// without reallocation.
  // crate: hashbrown-0.17.1/src/raw.rs:909 reserve
  reserve(additional: number, hasher: (t: T) => bigint): void {
    if (additional > this.table.growth_left) {
      // (All allocation errors will be caught inside `RawTableInner::reserve_rehash`.)
      this.reserve_rehash(additional, hasher, "Infallible");
    }
  }

  /// Out-of-line slow path for `reserve` and `try_reserve`.
  // crate: hashbrown-0.17.1/src/raw.rs:948 reserve_rehash
  reserve_rehash(additional: number, hasher: (t: T) => bigint, fallibility: Fallibility): Res<undefined> {
    return this.table.reserve_rehash_inner(
      additional,
      (table, index) => hasher(table.data[index] as T),
      fallibility,
      this.TABLE_LAYOUT,
      undefined,
    );
  }

  /// Allocates a new table of a different size and moves the contents of the
  /// current table into it.
  // crate: hashbrown-0.17.1/src/raw.rs:997 resize
  resize(capacity: number, hasher: (t: T) => bigint, fallibility: Fallibility): Res<undefined> {
    return this.table.resize_inner(capacity, (table, index) => hasher(table.data[index] as T), fallibility, this.TABLE_LAYOUT);
  }

  /// Inserts a new element into the table, and returns its raw bucket.
  ///
  /// This does not check if the given element already exists in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:1024 insert
  insert(hash: bigint, value: T, hasher: (t: T) => bigint): number {
    // 1. The [`RawTableInner`] must already have properly initialized control bytes since
    //    we will never expose `RawTable::new_uninitialized` in a public API.
    //
    // 2. We reserve additional space (if necessary) right after calling this function.
    let index = this.table.find_insert_index(hash);

    // We can avoid growing the table once we have reached our load factor if we are replacing
    // a tombstone. This works since the number of EMPTY slots does not change in this case.
    //
    // SAFETY: The function is guaranteed to return an index in the range `0..=self.num_buckets()`.
    const old_ctrl = this.table.ctrl[index]!;
    if (this.table.growth_left === 0 && Tag.special_is_empty(old_ctrl)) {
      this.reserve(1, hasher);
      // SAFETY: We know for sure that `RawTableInner` has control bytes
      // initialized and that there is extra space in the table.
      index = this.table.find_insert_index(hash);
    }

    return this.insert_at_index(hash, index, value);
  }

  /// Searches for an element in the table. If the element is not found,
  /// returns `Err` with the position of a slot where an element with the
  /// same hash could be inserted.
  ///
  /// This function may resize the table if additional space is required for
  /// inserting an element.
  // crate: hashbrown-0.17.1/src/raw.rs:1120 find_or_find_insert_index
  find_or_find_insert_index(hash: bigint, eq: (t: T) => boolean, hasher: (t: T) => bigint): { $: "Ok"; _0: number } | { $: "Err"; _0: number } {
    this.reserve(1, hasher);

    // 1. We know for sure that there is at least one empty `bucket` in the table.
    // 2. The [`RawTableInner`] must already have properly initialized control bytes since we will
    //    never expose `RawTable::new_uninitialized` in a public API.
    // 3. The `find_or_find_insert_index_inner` function returns the `index` of only the full bucket,
    //    which is in the range `0..self.num_buckets()` (since there is at least one empty `bucket` in
    //    the table), so calling `self.bucket(index)` and `Bucket::as_ref` is safe.
    const r = this.table.find_or_find_insert_index_inner(hash, (index) => eq(this.bucket_as_ref(this.bucket(index))));
    switch (r.$) {
      // SAFETY: See explanation above.
      case "Ok":
        return { $: "Ok", _0: this.bucket(r._0) };
      case "Err":
        return { $: "Err", _0: r._0 };
    }
  }

  /// Inserts a new element into the table at the given index with the given hash,
  /// and returns its raw bucket.
  // crate: hashbrown-0.17.1/src/raw.rs:1156 insert_at_index
  insert_at_index(hash: bigint, index: number, value: T): number {
    return this.insert_tagged_at_index(Tag.full(hash), index, value);
  }

  /// Inserts a new element into the table at the given index with the given tag,
  /// and returns its raw bucket.
  // crate: hashbrown-0.17.1/src/raw.rs:1174 insert_tagged_at_index
  insert_tagged_at_index(tag: Tag, index: number, value: T): number {
    const old_ctrl = this.table.ctrl[index]!;
    this.table.record_item_insert_at(index, old_ctrl, tag);

    const bucket = this.bucket(index);
    this.bucket_write(bucket, value);
    return bucket;
  }

  /// Searches for an element in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:1192 find
  find(hash: bigint, eq: (t: T) => boolean): number | undefined {
    // 1. The [`RawTableInner`] must already have properly initialized control bytes since we
    //    will never expose `RawTable::new_uninitialized` in a public API.
    // 1. The `find_inner` function returns the `index` of only the full bucket, which is in
    //    the range `0..self.num_buckets()`, so calling `self.bucket(index)` and `Bucket::as_ref`
    //    is safe.
    const result = this.table.find_inner(hash, (index) => eq(this.bucket_as_ref(this.bucket(index))));

    if (result !== undefined) {
      return this.bucket(result);
    } else {
      return undefined;
    }
  }

  /// Gets a reference to an element in the table.
  // PORT: `Option<&T>` of a `T` that may itself be `undefined`-free: callers' `T` are tuples.
  // crate: hashbrown-0.17.1/src/raw.rs:1215 get
  // crate: hashbrown-0.17.1/src/raw.rs:1225 get_mut
  get(hash: bigint, eq: (t: T) => boolean): T | undefined {
    const bucket = this.find(hash, eq);
    if (bucket !== undefined) {
      return this.bucket_as_ref(bucket);
    } else {
      return undefined;
    }
  }

  /// Returns the number of elements the map can hold without reallocating.
  ///
  /// This number is a lower bound; the table might be able to hold
  /// more, but is guaranteed to be able to hold at least this many.
  // crate: hashbrown-0.17.1/src/raw.rs:1324 capacity
  capacity(): number {
    return this.table.items + this.table.growth_left;
  }

  /// Returns the number of elements in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:1330 len
  len(): number {
    return this.table.items;
  }

  /// Returns `true` if the table contains no elements.
  // crate: hashbrown-0.17.1/src/raw.rs:1336 is_empty
  is_empty(): boolean {
    return this.len() === 0;
  }

  /// Returns the number of buckets in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:1342 num_buckets
  num_buckets(): number {
    return this.table.bucket_mask + 1;
  }

  /// Checks whether the bucket at `index` is full.
  // crate: hashbrown-0.17.1/src/raw.rs:1352 is_bucket_full
  is_bucket_full(index: number): boolean {
    return this.table.is_bucket_full(index);
  }

  /// Returns an iterator over every element in the table. It is up to
  /// the caller to ensure that the `RawTable` outlives the `RawIter`.
  /// Because we cannot make the `next` method unsafe on the `RawIter`
  /// struct, we have to make the `iter` method unsafe.
  // crate: hashbrown-0.17.1/src/raw.rs:1361 iter
  iter(): RawIter<T> {
    return this.table.iter<T>();
  }

  // ---- impl<T: Clone, A: Allocator + Clone> Clone for RawTable<T, A> ----

  // PORT: `clone_T` is `T::clone`.
  // crate: hashbrown-0.17.1/src/raw.rs:3293 clone
  clone(clone_T: (t: T) => T): RawTable<T> {
    if (this.table.is_empty_singleton()) {
      return RawTable.new<T>(this.TABLE_LAYOUT);
    } else {
      // SAFETY: This is safe as we are taking the size of an already allocated table
      // and therefore capacity overflow cannot occur, `self.table.num_buckets()` is power
      // of two and all allocator errors will be caught inside `RawTableInner::new_uninitialized`.
      const result = RawTable.new_uninitialized<T>(this.TABLE_LAYOUT, this.table.num_buckets(), "Infallible");

      // SAFETY: The result of calling the `new_uninitialized` function cannot be an error
      // because `fallibility == Fallibility::Infallible.
      const new_table = (result as { $: "Ok"; _0: RawTable<T> })._0;

      // Cloning elements may fail (the clone function may panic). But we don't
      // need to worry about uninitialized control bits, since:
      // 1. The number of items (elements) in the table is zero, which means that
      //    the control bits will not be read by Drop function.
      // 2. The `clone_from_spec` method will first copy all control bits from
      //    `self` (thus initializing them). But this will not affect the `Drop`
      //    function, since the `clone_from_spec` function sets `items` only after
      //    successfully cloning all elements.
      new_table.clone_from_spec(this, clone_T);
      return new_table;
    }
  }

  // PORT: the `T: TrivialClone` specialization (line 3410, nightly) copies the same control bytes
  // and bucket slots; both arms leave the table identical, so the generic one stands for both.
  // crate: hashbrown-0.17.1/src/raw.rs:3400 clone_from_spec
  // crate: hashbrown-0.17.1/src/raw.rs:3410 clone_from_spec
  clone_from_spec(source: RawTable<T>, clone_T: (t: T) => T): void {
    this.clone_from_impl(source, clone_T);
  }

  /// Common code for `clone` and `clone_from`. Assumes:
  /// - `self.buckets() == source.buckets()`.
  /// - Any existing elements have been dropped.
  /// - The control bytes are not initialized yet.
  // crate: hashbrown-0.17.1/src/raw.rs:3433 clone_from_impl
  clone_from_impl(source: RawTable<T>, clone_T: (t: T) => T): void {
    // Copy the control bytes unchanged. We do this in a single pass
    this.table.ctrl.set(source.table.ctrl.subarray(0, this.table.num_ctrl_bytes()), 0);

    const iter = source.iter();
    for (let from = iter.next(); from !== undefined; from = iter.next()) {
      const index = source.bucket_index(from);
      const to = this.bucket(index);
      this.bucket_write(to, clone_T(source.bucket_as_ref(from)));
    }

    this.table.items = source.table.items;
    this.table.growth_left = source.table.growth_left;
  }

  // crate: hashbrown-0.17.1/src/raw.rs:3478 default
  static default<T>(layout: TableLayout): RawTable<T> {
    return RawTable.new<T>(layout);
  }
}

/// Non-generic part of `RawTable` which allows functions to be instantiated only once regardless
/// of how many different key-value types are used.
export class RawTableInner {
  constructor(
    // Mask to get an index from a hash value. The value is one less than the
    // number of buckets in the table.
    public bucket_mask: number,
    // [Padding], T_n, ..., T1, T0, C0, C1, ...
    //                              ^ points here
    public ctrl: Uint8Array,
    // Number of elements that can be inserted before we need to grow the table
    public growth_left: number,
    // Number of elements in the table, only really used by len()
    public items: number,
    /** PORT: the buckets (`T_0 .. T_n`), see the file header. */
    public data: unknown[],
  ) {}

  /** `const NEW: Self = RawTableInner::new();` */
  static NEW(): RawTableInner {
    return RawTableInner.new();
  }

  /// Creates a new empty hash table without allocating any memory.
  ///
  /// In effect this returns a table with exactly 1 bucket. However we can
  /// leave the data pointer dangling since that bucket is never accessed
  /// due to our load factor forcing us to always have at least 1 free bucket.
  // crate: hashbrown-0.17.1/src/raw.rs:1494 new
  static new(): RawTableInner {
    return new RawTableInner(0, Group.static_empty(), 0, 0, []);
  }

  /// Allocates a new [`RawTableInner`] with the given number of buckets.
  /// The control bytes and buckets are left uninitialized.
  // crate: hashbrown-0.17.1/src/raw.rs:1560 new_uninitialized
  static new_uninitialized(table_layout: TableLayout, buckets: number, fallibility: Fallibility): Res<RawTableInner> {
    // debug_assert!(buckets.is_power_of_two());

    // Avoid `Option::ok_or_else` because it bloats LLVM IR.
    const l = table_layout.calculate_layout_for(buckets);
    if (l === undefined) {
      return { $: "Err", _0: Fallibility.capacity_overflow(fallibility) };
    }
    const [layout, ctrl_offset] = l;
    void ctrl_offset;
    assert(buckets <= 2 ** 30, "rust-ts: hashbrown table larger than 2^30 buckets");

    // PORT: `do_alloc(alloc, layout)` with `Global`: the block is exactly `layout.size()` bytes,
    // so the over-sized branch (`maximum_buckets_in`) is not taken.
    const block_len = layout.size;
    if (block_len !== layout.size) {
      // Utilize over-sized allocations.
      const x = maximum_buckets_in(block_len, table_layout, Group.WIDTH);
      // debug_assert!(x >= buckets);
      buckets = x;
    }

    return {
      $: "Ok",
      _0: new RawTableInner(buckets - 1, new Uint8Array(buckets + Group.WIDTH), bucket_mask_to_capacity(buckets - 1), 0, new Array<unknown>(buckets).fill(undefined)),
    };
  }

  /// Attempts to allocate a new [`RawTableInner`] with at least enough
  /// capacity for inserting the given number of elements without reallocating.
  ///
  /// All the control bytes are initialized with the [`Tag::EMPTY`] bytes.
  // crate: hashbrown-0.17.1/src/raw.rs:1615 fallible_with_capacity
  static fallible_with_capacity(table_layout: TableLayout, capacity: number, fallibility: Fallibility): Res<RawTableInner> {
    if (capacity === 0) {
      return { $: "Ok", _0: RawTableInner.NEW() };
    } else {
      // SAFETY: We checked that we could successfully allocate the new table, and then
      // initialized all control bytes with the constant `Tag::EMPTY` byte.
      const buckets = capacity_to_buckets(capacity, table_layout);
      if (buckets === undefined) return { $: "Err", _0: Fallibility.capacity_overflow(fallibility) };

      const result = RawTableInner.new_uninitialized(table_layout, buckets, fallibility);
      if (result.$ === "Err") return result;
      // SAFETY: We checked that the table is allocated and therefore the table already has
      // `self.bucket_mask + 1 + Group::WIDTH` number of control bytes (see TableLayout::calculate_layout_for)
      // so writing `self.num_ctrl_bytes() == bucket_mask + 1 + Group::WIDTH` bytes is safe.
      TagSliceExt.fill_empty(result._0.ctrl_slice());

      return result;
    }
  }

  /// Allocates a new [`RawTableInner`] with at least enough capacity for inserting
  /// the given number of elements without reallocating.
  ///
  /// Panics if the new capacity exceeds [`isize::MAX`] bytes and [`abort`] the program
  /// in case of allocation error. Use [`fallible_with_capacity`] instead if you want to
  /// handle memory allocation failure.
  ///
  /// All the control bytes are initialized with the [`Tag::EMPTY`] bytes.
  // crate: hashbrown-0.17.1/src/raw.rs:1656 with_capacity
  static with_capacity(table_layout: TableLayout, capacity: number): RawTableInner {
    const result = RawTableInner.fallible_with_capacity(table_layout, capacity, "Infallible");

    // SAFETY: All allocation errors will be caught inside `RawTableInner::new_uninitialized`.
    return (result as { $: "Ok"; _0: RawTableInner })._0;
  }

  /// Fixes up an insertion index returned by the [`RawTableInner::find_insert_index_in_group`] method.
  ///
  /// In tables smaller than the group width (`self.num_buckets() < Group::WIDTH`), trailing control
  /// bytes outside the range of the table are filled with [`Tag::EMPTY`] entries. These will unfortunately
  /// trigger a match of [`RawTableInner::find_insert_index_in_group`] function. This is because
  /// the `Some(bit)` returned by `group.match_empty_or_deleted().lowest_set_bit()` after masking
  /// (`(probe_seq.pos + bit) & self.bucket_mask`) may point to a full bucket that is already occupied.
  /// We detect this situation here and perform a second scan starting at the beginning of the table.
  /// This second scan is guaranteed to find an empty slot (due to the load factor) before hitting the
  /// trailing control bytes (containing [`Tag::EMPTY`] bytes).
  // crate: hashbrown-0.17.1/src/raw.rs:1709 fix_insert_index
  fix_insert_index(index: number): number {
    // SAFETY: The caller of this function ensures that `index` is in the range `0..=self.bucket_mask`.
    if (this.is_bucket_full(index)) {
      // debug_assert!(self.bucket_mask < Group::WIDTH);
      // SAFETY:
      //
      // * Since the caller of this function ensures that the control bytes are properly
      //   initialized and `ptr = self.ctrl(0)` points to the start of the array of control
      //   bytes, therefore: `ctrl` is valid for reads, properly aligned to `Group::WIDTH`
      //   and points to the properly initialized control bytes (see also
      //   `TableLayout::calculate_layout_for` and `ptr::read`);
      //
      // * Because the caller of this function ensures that the index was provided by the
      //   `self.find_insert_index_in_group()` function, so for for tables larger than the
      //   group width (self.num_buckets() >= Group::WIDTH), we will never end up in the given
      //   branch, since `(probe_seq.pos + bit) & self.bucket_mask` in `find_insert_index_in_group`
      //   cannot return a full bucket index. For tables smaller than the group width, calling
      //   the `unwrap_unchecked` function is also safe, as the trailing control bytes outside
      //   the range of the table are filled with EMPTY bytes (and we know for sure that there
      //   is at least one FULL bucket), so this second scan either finds an empty slot (due to
      //   the load factor) or hits the trailing control bytes (containing EMPTY).
      index = Group.load_aligned(this.ctrl, this.ctrl_ptr(0)).match_empty_or_deleted().lowest_set_bit()!;
    }
    return index;
  }

  /// Finds the position to insert something in a group.
  ///
  /// **This may have false positives and must be fixed up with `fix_insert_index`
  /// before it's used.**
  ///
  /// The function is guaranteed to return the index of an empty or deleted [`Bucket`]
  /// in the range `0..self.num_buckets()` (`0..=self.bucket_mask`).
  // crate: hashbrown-0.17.1/src/raw.rs:1748 find_insert_index_in_group
  find_insert_index_in_group(group: Group, probe_seq: ProbeSeq): number | undefined {
    const bit = group.match_empty_or_deleted().lowest_set_bit();

    if (bit !== undefined) {
      // This is the same as `(probe_seq.pos + bit) % self.num_buckets()` because the number
      // of buckets is a power of two, and `self.bucket_mask = self.num_buckets() - 1`.
      return (probe_seq.pos + bit) & this.bucket_mask;
    } else {
      return undefined;
    }
  }

  /// Searches for an element in the table, or a potential slot where that element could
  /// be inserted (an empty or deleted [`Bucket`] index).
  ///
  /// This uses dynamic dispatch to reduce the amount of code generated, but that is
  /// eliminated by LLVM optimizations.
  ///
  /// This function does not make any changes to the `data` part of the table, or any
  /// changes to the `items` or `growth_left` field of the table.
  // crate: hashbrown-0.17.1/src/raw.rs:1795 find_or_find_insert_index_inner
  find_or_find_insert_index_inner(hash: bigint, eq: (index: number) => boolean): { $: "Ok"; _0: number } | { $: "Err"; _0: number } {
    let insert_index: number | undefined = undefined;

    const tag_hash = Tag.full(hash);
    const probe_seq = this.probe_seq(hash);

    for (;;) {
      // SAFETY: `probe_seq.pos` is in `0..self.num_buckets()` and the control bytes have
      //  `self.bucket_mask + 1 + Group::WIDTH` (in fact, this means that the last control
      //  byte will never be read for the allocated table);
      const group = Group.load(this.ctrl, this.ctrl_ptr(probe_seq.pos));

      const it = group.match_tag(tag_hash).into_iter();
      for (let bit = it.next(); bit !== undefined; bit = it.next()) {
        const index = (probe_seq.pos + bit) & this.bucket_mask;

        if (eq(index)) {
          return { $: "Ok", _0: index };
        }
      }

      // We didn't find the element we were looking for in the group, try to get an
      // insertion slot from the group if we don't have one yet.
      if (insert_index === undefined) {
        insert_index = this.find_insert_index_in_group(group, probe_seq);
      }

      if (insert_index !== undefined) {
        // Only stop the search if the group contains at least one empty element.
        // Otherwise, the element that we are looking for might be in a following group.
        if (group.match_empty().any_bit_set()) {
          // We must have found a insert slot by now, since the current group contains at
          // least one. For tables smaller than the group width, there will still be an
          // empty element in the current (and only) group due to the load factor.
          return { $: "Err", _0: this.fix_insert_index(insert_index) };
        }
      }

      probe_seq.move_next(this.bucket_mask);
    }
  }

  /// Searches for an empty or deleted bucket which is suitable for inserting a new
  /// element and sets the hash for that slot. Returns an index of that slot and the
  /// old control byte stored in the found index.
  // crate: hashbrown-0.17.1/src/raw.rs:1907 prepare_insert_index
  prepare_insert_index(hash: bigint): [number, Tag] {
    const index = this.find_insert_index(hash);
    // SAFETY:
    // 1. The `find_insert_index` function either returns an `index` less than or
    //    equal to `self.num_buckets() = self.bucket_mask + 1` of the table, or never
    //    returns if it cannot find an empty or deleted slot.
    // 2. The caller of this function guarantees that the table has already been
    //    allocated
    const old_ctrl = this.ctrl[index]!;
    this.set_ctrl_hash(index, hash);
    return [index, old_ctrl];
  }

  /// Searches for an empty or deleted bucket which is suitable for inserting
  /// a new element, returning the `index` for the new [`Bucket`].
  // crate: hashbrown-0.17.1/src/raw.rs:1951 find_insert_index
  find_insert_index(hash: bigint): number {
    const probe_seq = this.probe_seq(hash);
    for (;;) {
      // SAFETY:
      // * Caller of this fn ensures that the control bytes are properly initialized.
      //
      // * `ProbeSeq.pos` cannot be greater than `self.bucket_mask = self.num_buckets() - 1`
      //   of the table due to masking with `self.bucket_mask` and also because the number
      //   of buckets is a power of two (see `self.probe_seq` function).
      //
      // * Even if `ProbeSeq.pos` returns `position == self.bucket_mask`, it is safe to
      //   call `Group::load` due to the extended control bytes range, which is
      //  `self.bucket_mask + 1 + Group::WIDTH` (in fact, this means that the last control
      //   byte will never be read for the allocated table);
      //
      // * Also, even if `RawTableInner` is not already allocated, `ProbeSeq.pos` will
      //   always return "0" (zero), so Group::load will read unaligned `Group::static_empty()`
      //   bytes, which is safe (see RawTableInner::new).
      const group = Group.load(this.ctrl, this.ctrl_ptr(probe_seq.pos));

      const index = this.find_insert_index_in_group(group, probe_seq);
      if (index !== undefined) {
        return this.fix_insert_index(index);
      }
      probe_seq.move_next(this.bucket_mask);
    }
  }

  /// Searches for an element in a table, returning the `index` of the found element.
  /// This uses dynamic dispatch to reduce the amount of code generated, but it is
  /// eliminated by LLVM optimizations.
  ///
  /// This function does not make any changes to the `data` part of the table, or any
  /// changes to the `items` or `growth_left` field of the table.
  // crate: hashbrown-0.17.1/src/raw.rs:2008 find_inner
  find_inner(hash: bigint, eq: (index: number) => boolean): number | undefined {
    const tag_hash = Tag.full(hash);
    const probe_seq = this.probe_seq(hash);

    for (;;) {
      // SAFETY: see `find_insert_index`.
      const group = Group.load(this.ctrl, this.ctrl_ptr(probe_seq.pos));

      const it = group.match_tag(tag_hash).into_iter();
      for (let bit = it.next(); bit !== undefined; bit = it.next()) {
        // This is the same as `(probe_seq.pos + bit) % self.num_buckets()` because the number
        // of buckets is a power of two, and `self.bucket_mask = self.num_buckets() - 1`.
        const index = (probe_seq.pos + bit) & this.bucket_mask;

        if (eq(index)) {
          return index;
        }
      }

      if (group.match_empty().any_bit_set()) {
        return undefined;
      }

      probe_seq.move_next(this.bucket_mask);
    }
  }

  /// Prepares for rehashing data in place (that is, without allocating new memory).
  /// Converts all full index `control bytes` to `Tag::DELETED` and all `Tag::DELETED` control
  /// bytes to `Tag::EMPTY`, i.e. performs the following conversion:
  ///
  /// - `Tag::EMPTY` control bytes   -> `Tag::EMPTY`;
  /// - `Tag::DELETED` control bytes -> `Tag::EMPTY`;
  /// - `FULL` control bytes    -> `Tag::DELETED`.
  ///
  /// This function does not make any changes to the `data` parts of the table,
  /// or any changes to the `items` or `growth_left` field of the table.
  // crate: hashbrown-0.17.1/src/raw.rs:2080 prepare_rehash_in_place
  prepare_rehash_in_place(): void {
    // Bulk convert all full control bytes to DELETED, and all DELETED control bytes to EMPTY.
    // This effectively frees up all buckets containing a DELETED entry.
    for (let i = 0; i < this.num_buckets(); i += Group.WIDTH) {
      const group = Group.load_aligned(this.ctrl, this.ctrl_ptr(i));
      const group_ = group.convert_special_to_empty_and_full_to_deleted();
      group_.store_aligned(this.ctrl, this.ctrl_ptr(i));
    }

    // Fix up the trailing control bytes. See the comments in set_ctrl
    // for the handling of tables smaller than the group width.
    if (this.num_buckets() < Group.WIDTH) {
      // SAFETY: We have `self.bucket_mask + 1 + Group::WIDTH` number of control bytes,
      // so copying `self.num_buckets() == self.bucket_mask + 1` bytes with offset equal to
      // `Group::WIDTH` is safe
      this.ctrl.copyWithin(this.ctrl_ptr(Group.WIDTH), this.ctrl_ptr(0), this.ctrl_ptr(0) + this.num_buckets());
    } else {
      // SAFETY: We have `self.bucket_mask + 1 + Group::WIDTH` number of
      // control bytes,so copying `Group::WIDTH` bytes with offset equal
      // to `self.num_buckets() == self.bucket_mask + 1` is safe
      this.ctrl.copyWithin(this.ctrl_ptr(this.num_buckets()), this.ctrl_ptr(0), this.ctrl_ptr(0) + Group.WIDTH);
    }
  }

  /// Returns an iterator over every element in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:2138 iter
  iter<T>(): RawIter<T> {
    // 1. Since the caller of this function ensures that the control bytes
    //    are properly initialized and `self.data_end()` points to the start
    //    of the array of control bytes, therefore: `ctrl` is valid for reads,
    //    properly aligned to `Group::WIDTH` and points to the properly initialized
    //    control bytes.
    // 2. `data` bucket index in the table is equal to the `ctrl` index (i.e.
    //    equal to zero).
    // 3. We pass the exact value of buckets of the table to the function.
    return new RawIter<T>(RawIterRange.new<T>(this, this.ctrl_ptr(0), 0, this.num_buckets()), this.items);
  }

  /// Returns a pointer to an element in the table (convenience for
  /// `Bucket::from_base_index(self.data_end::<u8>(), index).as_ptr()`).
  // crate: hashbrown-0.17.1/src/raw.rs:2393 bucket_ptr
  bucket_ptr(index: number, size_of: number): number {
    void size_of;
    // debug_assert_ne!(self.bucket_mask, 0);
    // debug_assert!(index < self.num_buckets());
    return index;
  }

  /// Returns an iterator-like object for a probe sequence on the table.
  ///
  /// This iterator never terminates, but is guaranteed to visit each bucket
  /// group exactly once. The loop using `probe_seq` must terminate upon
  /// reaching a group containing an empty bucket.
  // crate: hashbrown-0.17.1/src/raw.rs:2448 probe_seq
  probe_seq(hash: bigint): ProbeSeq {
    // This is the same as `hash as usize % self.num_buckets()` because the number
    // of buckets is a power of two, and `self.bucket_mask = self.num_buckets() - 1`.
    return new ProbeSeq(h1(hash) & this.bucket_mask, 0);
  }

  // crate: hashbrown-0.17.1/src/raw.rs:2458 record_item_insert_at
  record_item_insert_at(index: number, old_ctrl: Tag, new_ctrl: Tag): void {
    this.growth_left -= Tag.special_is_empty(old_ctrl) ? 1 : 0;
    this.set_ctrl(index, new_ctrl);
    this.items += 1;
  }

  // crate: hashbrown-0.17.1/src/raw.rs:2467 is_in_same_group
  is_in_same_group(i: number, new_i: number, hash: bigint): boolean {
    const probe_seq_pos = this.probe_seq(hash).pos;
    const probe_index = (pos: number) => Math.floor(((pos - probe_seq_pos) & this.bucket_mask) / Group.WIDTH);
    return probe_index(i) === probe_index(new_i);
  }

  /// Sets a control byte to the hash, and possibly also the replicated control byte at
  /// the end of the array.
  // crate: hashbrown-0.17.1/src/raw.rs:2499 set_ctrl_hash
  set_ctrl_hash(index: number, hash: bigint): void {
    this.set_ctrl(index, Tag.full(hash));
  }

  /// Replaces the hash in the control byte at the given index with the provided one,
  /// and possibly also the replicated control byte at the end of the array.
  // crate: hashbrown-0.17.1/src/raw.rs:2532 replace_ctrl_hash
  replace_ctrl_hash(index: number, hash: bigint): Tag {
    const prev_ctrl = this.ctrl[index]!;
    this.set_ctrl_hash(index, hash);
    return prev_ctrl;
  }

  /// Sets a control byte, and possibly also the replicated control byte at
  /// the end of the array.
  // crate: hashbrown-0.17.1/src/raw.rs:2564 set_ctrl
  set_ctrl(index: number, ctrl: Tag): void {
    // Replicate the first Group::WIDTH control bytes at the end of
    // the array without using a branch. If the tables smaller than
    // the group width (self.num_buckets() < Group::WIDTH),
    // `index2 = Group::WIDTH + index`, otherwise `index2` is:
    //
    // - If index >= Group::WIDTH then index == index2.
    // - Otherwise index2 == self.bucket_mask + 1 + index.
    //
    // The very last replicated control byte is never actually read because
    // we mask the initial index for unaligned loads, but we write it
    // anyways because it makes the set_ctrl implementation simpler.
    //
    // If there are fewer buckets than Group::WIDTH then this code will
    // replicate the buckets at the end of the trailing group. For example
    // with 2 buckets and a group size of 4, the control bytes will look
    // like this:
    //
    //     Real    |             Replicated
    // ---------------------------------------------
    // | [A] | [B] | [Tag::EMPTY] | [EMPTY] | [A] | [B] |
    // ---------------------------------------------

    // This is the same as `(index.wrapping_sub(Group::WIDTH)) % self.num_buckets() + Group::WIDTH`
    // because the number of buckets is a power of two, and `self.bucket_mask = self.num_buckets() - 1`.
    const index2 = ((index - Group.WIDTH) & this.bucket_mask) + Group.WIDTH;

    this.ctrl[this.ctrl_ptr(index)] = ctrl;
    this.ctrl[this.ctrl_ptr(index2)] = ctrl;
  }

  /// Returns a pointer to a control byte.
  // PORT: named `ctrl_ptr` (the control bytes themselves are the `ctrl` field).
  // crate: hashbrown-0.17.1/src/raw.rs:2621 ctrl
  ctrl_ptr(index: number): number {
    // debug_assert!(index < self.num_ctrl_bytes());
    return index;
  }

  /// Gets the slice of all control bytes.
  // crate: hashbrown-0.17.1/src/raw.rs:2628 ctrl_slice
  ctrl_slice(): Uint8Array {
    return this.ctrl.subarray(0, this.num_ctrl_bytes());
  }

  // crate: hashbrown-0.17.1/src/raw.rs:2634 num_buckets
  num_buckets(): number {
    return this.bucket_mask + 1;
  }

  /// Checks whether the bucket at `index` is full.
  // crate: hashbrown-0.17.1/src/raw.rs:2644 is_bucket_full
  is_bucket_full(index: number): boolean {
    // debug_assert!(index < self.num_buckets());
    return Tag.is_full(this.ctrl[this.ctrl_ptr(index)]!);
  }

  // crate: hashbrown-0.17.1/src/raw.rs:2650 num_ctrl_bytes
  num_ctrl_bytes(): number {
    return this.bucket_mask + 1 + Group.WIDTH;
  }

  // crate: hashbrown-0.17.1/src/raw.rs:2655 is_empty_singleton
  is_empty_singleton(): boolean {
    return this.bucket_mask === 0;
  }

  /// Attempts to allocate a new hash table with at least enough capacity
  /// for inserting the given number of elements without reallocating,
  /// and return it inside `ScopeGuard` to protect against panic in the hash
  /// function.
  // PORT: the guard only frees the new table's memory; the table itself is returned.
  // crate: hashbrown-0.17.1/src/raw.rs:2682 prepare_resize
  prepare_resize(table_layout: TableLayout, capacity: number, fallibility: Fallibility): Res<RawTableInner> {
    // debug_assert!(self.items <= capacity);

    // Allocate and initialize the new table.
    return RawTableInner.fallible_with_capacity(table_layout, capacity, fallibility);
  }

  /// Reserves or rehashes to make room for `additional` more elements.
  ///
  /// This uses dynamic dispatch to reduce the amount of
  /// code generated, but it is eliminated by LLVM optimizations when inlined.
  // crate: hashbrown-0.17.1/src/raw.rs:2739 reserve_rehash_inner
  reserve_rehash_inner(
    additional: number,
    hasher: (table: RawTableInner, index: number) => bigint,
    fallibility: Fallibility,
    layout: TableLayout,
    drop: undefined,
  ): Res<undefined> {
    // Avoid `Option::ok_or_else` because it bloats LLVM IR.
    const new_items = this.items + additional;
    if (!Number.isSafeInteger(new_items)) {
      return { $: "Err", _0: Fallibility.capacity_overflow(fallibility) };
    }
    const full_capacity = bucket_mask_to_capacity(this.bucket_mask);
    if (new_items <= Math.floor(full_capacity / 2)) {
      // Rehash in-place without re-allocating if we have plenty of spare
      // capacity that is locked up due to DELETED entries.

      // SAFETY:
      // 1. We know for sure that `[`RawTableInner`]` has already been allocated
      //    (since new_items <= full_capacity / 2);
      // 2. The caller ensures that `drop` function is the actual drop function of
      //    the elements stored in the table.
      // 3. The caller ensures that `layout` matches the [`TableLayout`] that was
      //    used to allocate this table.
      // 4. The caller ensures that the control bytes of the `RawTableInner`
      //    are already initialized.
      this.rehash_in_place(hasher, layout.size, drop);
      return { $: "Ok", _0: undefined };
    } else {
      // Otherwise, conservatively resize to at least the next size up
      // to avoid churning deletes into frequent rehashes.
      //
      // SAFETY:
      // 1. We know for sure that `capacity >= self.items`.
      // 2. The caller ensures that `alloc` and `layout` matches the [`Allocator`] and
      //    [`TableLayout`] that were used to allocate this table.
      // 3. The caller ensures that the control bytes of the `RawTableInner`
      //    are already initialized.
      return this.resize_inner(Math.max(new_items, full_capacity + 1), hasher, fallibility, layout);
    }
  }

  /// Returns an iterator over full buckets indices in the table.
  // crate: hashbrown-0.17.1/src/raw.rs:2808 full_buckets_indices
  full_buckets_indices(): FullBucketsIndices {
    // SAFETY:
    // 1. Since the caller of this function ensures that the control bytes
    //    are properly initialized and `self.ctrl(0)` points to the start
    //    of the array of control bytes, therefore: `ctrl` is valid for reads,
    //    properly aligned to `Group::WIDTH` and points to the properly initialized
    //    control bytes.
    // 2. The value of `items` is equal to the amount of data (values) added
    //    to the table.
    //
    //                         `ctrl` points here (to the start
    //                         of the first control byte `CT0`)
    //                          ∨
    // [Pad], T_n, ..., T1, T0, |CT0, CT1, ..., CT_n|, Group::WIDTH
    //                           \________  ________/
    //                                    \/
    //       `n = buckets - 1`, i.e. `RawTableInner::num_buckets() - 1`
    //
    // where: T0...T_n  - our stored data;
    //        CT0...CT_n - control bytes or metadata for `data`.
    const ctrl = this.ctrl_ptr(0);

    return new FullBucketsIndices(
      // Load the first group
      Group.load_aligned(this.ctrl, ctrl).match_full().into_iter(),
      0,
      this.ctrl,
      ctrl,
      this.items,
    );
  }

  /// Allocates a new table of a different size and moves the contents of the
  /// current table into it.
  ///
  /// This uses dynamic dispatch to reduce the amount of
  /// code generated, but it is eliminated by LLVM optimizations when inlined.
  // crate: hashbrown-0.17.1/src/raw.rs:2885 resize_inner
  resize_inner(capacity: number, hasher: (table: RawTableInner, index: number) => bigint, fallibility: Fallibility, layout: TableLayout): Res<undefined> {
    // SAFETY: We know for sure that `alloc` and `layout` matches the [`Allocator`] and [`TableLayout`]
    // that were used to allocate this table.
    const r = this.prepare_resize(layout, capacity, fallibility);
    if (r.$ === "Err") return r;
    const new_table = r._0;

    // SAFETY: We know for sure that RawTableInner will outlive the
    // returned `FullBucketsIndices` iterator, and the caller of this
    // function ensures that the control bytes are properly initialized.
    const it = this.full_buckets_indices();
    for (let full_byte_index = it.next(); full_byte_index !== undefined; full_byte_index = it.next()) {
      // This may panic.
      const hash = hasher(this, full_byte_index);

      // SAFETY:
      // We can use a simpler version of insert() here since:
      // 1. There are no DELETED entries.
      // 2. We know there is enough space in the table.
      // 3. All elements are unique.
      // 4. The caller of this function guarantees that `capacity > 0`
      //    so `new_table` must already have some allocated memory.
      // 5. We set `growth_left` and `items` fields of the new table
      //    after the loop.
      // 6. We insert into the table, at the returned index, the data
      //    matching the given hash immediately after calling this function.
      const [new_index] = new_table.prepare_insert_index(hash);

      // SAFETY: We know for sure that `items` and `new_index` are in the range of the table
      // (`0..num_buckets()`), and `layout.size` is the size of `T`.
      new_table.data[new_table.bucket_ptr(new_index, layout.size)] = this.data[this.bucket_ptr(full_byte_index, layout.size)];
    }

    // The hash function didn't panic, so we can safely set the
    // `growth_left` and `items` fields of the new table.
    new_table.growth_left -= this.items;
    new_table.items = this.items;

    // We successfully copied all elements without panicking. Now replace
    // self with the new table. The old table will have its memory freed but
    // the items will not be dropped (since they have been moved into the
    // new table).
    // SAFETY: The caller ensures that `table_layout` matches the [`TableLayout`]
    // that was used to allocate this table.
    this.swap(new_table);

    return { $: "Ok", _0: undefined };
  }

  /** `mem::swap(self, other)` */
  swap(other: RawTableInner): void {
    const { bucket_mask, ctrl, growth_left, items, data } = this;
    this.bucket_mask = other.bucket_mask;
    this.ctrl = other.ctrl;
    this.growth_left = other.growth_left;
    this.items = other.items;
    this.data = other.data;
    other.bucket_mask = bucket_mask;
    other.ctrl = ctrl;
    other.growth_left = growth_left;
    other.items = items;
    other.data = data;
  }

  /// Rehashes the contents of the table in place (i.e. without changing the
  /// allocation).
  ///
  /// If `hasher` panics then some the table's contents may be lost.
  ///
  /// This uses dynamic dispatch to reduce the amount of
  /// code generated, but it is eliminated by LLVM optimizations when inlined.
  // crate: hashbrown-0.17.1/src/raw.rs:2984 rehash_in_place
  rehash_in_place(hasher: (table: RawTableInner, index: number) => bigint, size_of: number, drop: undefined): void {
    // If the hash function panics then properly clean up any elements
    // that we haven't rehashed yet. We unfortunately can't preserve the
    // element since we lost their hash and have no way of recovering it
    // without risking another panic.
    this.prepare_rehash_in_place();

    // PORT: the scope guard runs only on unwind: the `catch` below.
    const guard = this;
    try {
      // At this point, DELETED elements are elements that we haven't
      // rehashed yet. Find them and re-insert them at their ideal
      // position.
      outer: for (let i = 0; i < guard.num_buckets(); i++) {
        if (guard.ctrl[guard.ctrl_ptr(i)] !== Tag.DELETED) {
          continue;
        }

        const i_p = guard.bucket_ptr(i, size_of);

        for (;;) {
          // Hash the current item
          const hash = hasher(guard, i);

          // Search for a suitable place to put it
          //
          // SAFETY: Caller of this function ensures that the control bytes
          // are properly initialized.
          const new_i = guard.find_insert_index(hash);

          // Probing works by scanning through all of the control
          // bytes in groups, which may not be aligned to the group
          // size. If both the new and old position fall within the
          // same unaligned group, then there is no benefit in moving
          // it and we can just continue to the next item.
          if (guard.is_in_same_group(i, new_i, hash)) {
            guard.set_ctrl_hash(i, hash);
            continue outer;
          }

          const new_i_p = guard.bucket_ptr(new_i, size_of);

          // We are moving the current item to a new position. Write
          // our H2 to the control byte of the new position.
          const prev_ctrl = guard.replace_ctrl_hash(new_i, hash);
          if (prev_ctrl === Tag.EMPTY) {
            guard.set_ctrl(i, Tag.EMPTY);
            // If the target slot is empty, simply move the current
            // element into the new slot and clear the old control
            // byte.
            guard.data[new_i_p] = guard.data[i_p];
            guard.data[i_p] = undefined;
            continue outer;
          }

          // If the target slot is occupied, swap the two elements
          // and then continue processing the element that we just
          // swapped into the old slot.
          // debug_assert_eq!(prev_ctrl, Tag::DELETED);
          const t = guard.data[i_p];
          guard.data[i_p] = guard.data[new_i_p];
          guard.data[new_i_p] = t;
        }
      }
    } catch (e) {
      for (let i = 0; i < guard.num_buckets(); i++) {
        // Any elements that haven't been rehashed yet have a
        // DELETED tag. These need to be dropped and have their tag
        // reset to EMPTY.
        if (guard.ctrl[guard.ctrl_ptr(i)] === Tag.DELETED) {
          guard.set_ctrl(i, Tag.EMPTY);
          if (drop !== undefined) {
            // drop(self_.bucket_ptr(i, size_of));
          }
          guard.data[i] = undefined;
          guard.items -= 1;
        }
      }
      guard.growth_left = bucket_mask_to_capacity(guard.bucket_mask) - guard.items;
      throw e;
    }

    guard.growth_left = bucket_mask_to_capacity(guard.bucket_mask) - guard.items;
  }

  /// Marks all table buckets as empty without dropping their contents.
  // crate: hashbrown-0.17.1/src/raw.rs:3184 clear_no_drop
  clear_no_drop(): void {
    if (!this.is_empty_singleton()) {
      TagSliceExt.fill_empty(this.ctrl_slice());
    }
    this.items = 0;
    this.growth_left = bucket_mask_to_capacity(this.bucket_mask);
  }

  /// Erases the [`Bucket`]'s control byte at the given index so that it does not
  /// triggered as full, decreases the `items` of the table and, if it can be done,
  /// increases `self.growth_left`.
  // crate: hashbrown-0.17.1/src/raw.rs:3224 erase
  erase(index: number): void {
    // debug_assert!(self.is_bucket_full(index));

    // This is the same as `index.wrapping_sub(Group::WIDTH) % self.num_buckets()` because
    // the number of buckets is a power of two, and `self.bucket_mask = self.num_buckets() - 1`.
    const index_before = (index - Group.WIDTH) & this.bucket_mask;
    // SAFETY:
    // - The caller must uphold the safety contract for `erase` method;
    // - `index_before` is guaranteed to be in range due to masking with `self.bucket_mask`
    const empty_before = Group.load(this.ctrl, this.ctrl_ptr(index_before)).match_empty();
    const empty_after = Group.load(this.ctrl, this.ctrl_ptr(index)).match_empty();

    // Inserting and searching in the map is performed by two key functions:
    //
    // - The `find_insert_index` function that looks up the index of any `Tag::EMPTY` or `Tag::DELETED`
    //   slot in a group to be able to insert. If it doesn't find an `Tag::EMPTY` or `Tag::DELETED`
    //   slot immediately in the first group, it jumps to the next `Group` looking for it,
    //   and so on until it has gone through all the groups in the control bytes.
    //
    // - The `find_inner` function that looks for the index of the desired element by looking
    //   at all the `FULL` bytes in the group. If it did not find the element right away, and
    //   there is no `Tag::EMPTY` byte in the group, then this means that the `find_insert_index`
    //   function may have found a suitable slot in the next group. Therefore, `find_inner`
    //   jumps further, and if it does not find the desired element and again there is no `Tag::EMPTY`
    //   byte, then it jumps further, and so on. The search stops only if `find_inner` function
    //   finds the desired element or hits an `Tag::EMPTY` slot/byte.
    //
    // Accordingly, this leads to two consequences:
    //
    // - The map must have `Tag::EMPTY` slots (bytes);
    //
    // - You can't just mark the byte to be erased as `Tag::EMPTY`, because otherwise the `find_inner`
    //   function may stumble upon an `Tag::EMPTY` byte before finding the desired element and stop
    //   searching.
    //
    // Thus it is necessary to check all bytes after and before the erased element. If we are in
    // a contiguous `Group` of `FULL` or `Tag::DELETED` bytes (the number of `FULL` or `Tag::DELETED` bytes
    // before and after is greater than or equal to `Group::WIDTH`), then we must mark our byte as
    // `Tag::DELETED` in order for the `find_inner` function to go further. On the other hand, if there
    // is at least one `Tag::EMPTY` slot in the `Group`, then the `find_inner` function will still stumble
    // upon an `Tag::EMPTY` byte, so we can safely mark our erased byte as `Tag::EMPTY` as well.
    //
    // For example, if `Group::WIDTH` is 8, and we have the following control bytes, then we
    // don't need to mark the byte as `Tag::DELETED`:
    //
    // Note that in this context `leading_zeros` refers to the bytes at the end of a group, while
    // `trailing_zeros` refers to the bytes at the beginning of a group.
    let ctrl: Tag;
    if (empty_before.leading_zeros() + empty_after.trailing_zeros() >= Group.WIDTH) {
      ctrl = Tag.DELETED;
    } else {
      this.growth_left += 1;
      ctrl = Tag.EMPTY;
    }
    // SAFETY: the caller must uphold the safety contract for `erase` method.
    this.set_ctrl(index, ctrl);
    this.items -= 1;
  }
}

/// Find the previous power of 2. If it's already a power of 2, it's unchanged.
/// Passing zero is undefined behavior.
// crate: hashbrown-0.17.1/src/raw.rs:1509 prev_pow2
export function prev_pow2(z: number): number {
  // PORT: `1 << (63 - z.leading_zeros())` on a 64-bit `usize`: the highest power of two <= z.
  let p = 1;
  while (p * 2 <= z) p *= 2;
  return p;
}

/// Finds the largest number of buckets that can fit in `allocation_size`
/// provided the given TableLayout.
///
/// This relies on some invariants of `capacity_to_buckets`, so only feed in
/// an `allocation_size` calculated from `capacity_to_buckets`.
// crate: hashbrown-0.17.1/src/raw.rs:1519 maximum_buckets_in
function maximum_buckets_in(allocation_size: number, table_layout: TableLayout, group_width: number): number {
  // Given an equation like:
  //   z >= x * y + x + g
  // x can be maximized by doing:
  //   x = (z - g) / (y + 1)
  // If you squint:
  //   x is the number of buckets
  //   y is the table_layout.size
  //   z is the size of the allocation
  //   g is the group width
  // But this is ignoring the padding needed for ctrl_align.
  // If we remember these restrictions:
  //   x is always a power of 2
  //   Layout size for T must always be a multiple of T
  // Then the alignment can be ignored if we add the constraint:
  //   x * y >= table_layout.ctrl_align
  // This is taken care of by `capacity_to_buckets`.
  // It may be helpful to understand this if you remember that:
  //   ctrl_offset = align(x * y, ctrl_align)
  const x = Math.floor((allocation_size - group_width) / (table_layout.size + 1));
  return prev_pow2(x);
}

/// Iterator over a sub-range of a table. Unlike `RawIter` this iterator does
/// not track an item count.
// PORT: `data: Bucket<T>` is the bucket index of the current group's first bucket; `next_ctrl` and
// `end` are control-byte indices into `ctrl` (the table's array).
export class RawIterRange<T> {
  constructor(
    // Mask of full buckets in the current group. Bits are cleared from this
    // mask as each element is processed.
    public current_group: BitMaskIter,
    // Pointer to the buckets for the current group.
    public data: number,
    // Pointer to the next group of control bytes,
    // Must be aligned to the group size.
    public next_ctrl: number,
    // Pointer one past the last control byte of this range.
    public end: number,
    /** PORT: the array `next_ctrl` / `end` point into. */
    readonly ctrl: Uint8Array,
  ) {}

  /// Returns a `RawIterRange` covering a subset of a table.
  // crate: hashbrown-0.17.1/src/raw.rs:3576 new
  static new<T>(table: RawTableInner, ctrl: number, data: number, len: number): RawIterRange<T> {
    // debug_assert_ne!(len, 0);
    // debug_assert_eq!(ctrl as usize % Group::WIDTH, 0);
    // SAFETY: The caller must uphold the safety rules for the [`RawIterRange::new`]
    const end = ctrl + len;

    // Load the first group and advance ctrl to point to the next group
    // SAFETY: The caller must uphold the safety rules for the [`RawIterRange::new`]
    const current_group = Group.load_aligned(table.ctrl, ctrl).match_full();
    const next_ctrl = ctrl + Group.WIDTH;

    return new RawIterRange<T>(current_group.into_iter(), data, next_ctrl, end, table.ctrl);
  }

  /// # Safety
  /// If `DO_CHECK_PTR_RANGE` is false, caller must ensure that we never try to iterate
  /// after yielding all elements.
  // crate: hashbrown-0.17.1/src/raw.rs:3647 next_impl
  next_impl(DO_CHECK_PTR_RANGE: boolean): number | undefined {
    for (;;) {
      const index = this.current_group.next();
      if (index !== undefined) {
        return this.data + index; // self.data.next_n(index)
      }

      if (DO_CHECK_PTR_RANGE && this.next_ctrl >= this.end) {
        return undefined;
      }

      // We might read past self.end up to the next group boundary,
      // but this is fine because it only occurs on tables smaller
      // than the group size where the trailing control bytes are all
      // EMPTY. On larger tables self.end is guaranteed to be aligned
      // to the group size (since tables are power-of-two sized).
      this.current_group = Group.load_aligned(this.ctrl, this.next_ctrl).match_full().into_iter();
      this.data = this.data + Group.WIDTH;
      this.next_ctrl = this.next_ctrl + Group.WIDTH;
    }
  }

  // ---- impl Iterator for RawIterRange<T> ----

  // crate: hashbrown-0.17.1/src/raw.rs:3777 next
  next(): number | undefined {
    // SAFETY: We set checker flag to true.
    return this.next_impl(true);
  }
}

/// Iterator which returns a raw pointer to every full bucket in the table.
///
/// For maximum flexibility this iterator is not bound by a lifetime, but you
/// must observe several rules when using it:
/// - You must not free the hash table while iterating (including via growing/shrinking).
/// - It is fine to erase a bucket that has been yielded by the iterator.
/// - Erasing a bucket that has not yet been yielded by the iterator may still
///   result in the iterator yielding that bucket (unless `reflect_remove` is called).
/// - It is unspecified whether an element inserted after the iterator was
///   created will be yielded by that iterator (unless `reflect_insert` is called).
/// - The order in which the iterator yields bucket is unspecified and may
///   change in the future.
export class RawIter<T> {
  constructor(
    public iter: RawIterRange<T>,
    public items: number,
  ) {}

  // ---- impl Iterator for RawIter<T> ----

  // crate: hashbrown-0.17.1/src/raw.rs:3850 next
  next(): number | undefined {
    // Inner iterator iterates over buckets
    // so it can do unnecessary work if we already yielded all items.
    if (this.items === 0) {
      return undefined;
    }

    // SAFETY: We check number of items to yield using `items` field.
    const nxt = this.iter.next_impl(false);

    // debug_assert!(nxt.is_some());
    this.items -= 1;

    return nxt;
  }

  // crate: hashbrown-0.17.1/src/raw.rs:3869 size_hint
  size_hint(): [number, number | undefined] {
    return [this.items, this.items];
  }
}

/// Iterator which returns an index of every full bucket in the table.
///
/// For maximum flexibility this iterator is not bound by a lifetime, but you
/// must observe several rules when using it:
/// - You must not free the hash table while iterating (including via growing/shrinking).
/// - It is fine to erase a bucket that has been yielded by the iterator.
/// - Erasing a bucket that has not yet been yielded by the iterator may still
///   result in the iterator yielding index of that bucket.
/// - It is unspecified whether an element inserted after the iterator was
///   created will be yielded by that iterator.
/// - The order in which the iterator yields indices of the buckets is unspecified
///   and may change in the future.
export class FullBucketsIndices {
  constructor(
    // Mask of full buckets in the current group. Bits are cleared from this
    // mask as each element is processed.
    public current_group: BitMaskIter,
    // Initial value of the bytes' indices of the current group (relative
    // to the start of the control bytes).
    public group_first_index: number,
    /** PORT: the control-byte array `ctrl` points into. */
    readonly ctrl_bytes: Uint8Array,
    // Pointer to the current group of control bytes,
    // Must be aligned to the group size (Group::WIDTH).
    public ctrl: number,
    // Number of elements in the table.
    public items: number,
  ) {}

  /// Advances the iterator and returns the next value.
  // crate: hashbrown-0.17.1/src/raw.rs:3939 next_impl
  next_impl(): number | undefined {
    for (;;) {
      const index = this.current_group.next();
      if (index !== undefined) {
        return this.group_first_index + index;
      }

      // SAFETY: The caller of this function ensures that:
      //
      // 1. It never tries to iterate after getting all the elements;
      // 2. The table is alive and did not moved;
      // 3. The first `self.ctrl` pointed to the start of the array of control bytes.
      //
      // Taking the above into account, we always stay within the bounds, because:
      //
      // 1. For tables smaller than the group width (self.num_buckets() <= Group::WIDTH),
      //    we will never end up in the given branch, since we should have already
      //    yielded all the elements of the table.
      //
      // 2. For tables larger than the group width. The number of buckets is a
      //    power of two (2 ^ n), Group::WIDTH is also power of two (2 ^ k). Since
      //    `(2 ^ n) > (2 ^ k)`, than `(2 ^ n) % (2 ^ k) = 0`. As we start from the
      //    start of the array of control bytes, and never try to iterate after
      //    getting all the elements, the last `self.ctrl` will be equal to
      //    the `self.num_buckets() - Group::WIDTH`, so `self.current_group.next()`
      //    will always contains indices within the range `0..Group::WIDTH`,
      //    and subsequent `self.group_first_index + index` will always return a
      //    number less than `self.num_buckets()`.
      this.ctrl = this.ctrl + Group.WIDTH;

      // SAFETY: See explanation above.
      this.current_group = Group.load_aligned(this.ctrl_bytes, this.ctrl).match_full().into_iter();
      this.group_first_index += Group.WIDTH;
    }
  }

  // ---- impl Iterator for FullBucketsIndices ----

  // crate: hashbrown-0.17.1/src/raw.rs:3990 next
  next(): number | undefined {
    // Return if we already yielded all items.
    if (this.items === 0) {
      return undefined;
    }

    // SAFETY:
    // 1. We check number of items to yield using `items` field.
    // 2. The caller ensures that the table is alive and has not moved.
    const nxt = this.next_impl();

    // debug_assert!(nxt.is_some());
    this.items -= 1;

    return nxt;
  }
}
