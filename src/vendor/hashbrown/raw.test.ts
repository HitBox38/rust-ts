// Port of the `#[cfg(test)] mod test_map` of hashbrown =0.17.1 `src/raw.rs` (the tests that do not
// exercise destructors, panics in `Clone` or custom allocators, which have no JS counterpart).
import { expect, test } from "bun:test";
import { Group } from "./control/mod.ts";
import { prev_pow2, RawTable, TableLayout } from "./raw.ts";

// crate-skip: hashbrown-0.17.1/src/raw.rs:4424 test_drop_uninitialized drop of an uninitialized table (no destructors in JS)
// crate-skip: hashbrown-0.17.1/src/raw.rs:4439 test_drop_zero_items drop with zero items (no destructors in JS)
// crate-skip: hashbrown-0.17.1/src/raw.rs:4485 test_catch_panic_clone_from panicking Clone + custom allocator (no destructors in JS)

// crate: hashbrown-0.17.1/src/raw.rs:4346 test_prev_pow2
test("test_prev_pow2", () => {
  // Skip 0, not defined for that input.
  // PORT: `usize` powers of two up to 2^52 (the exact range of a JS number).
  let pow2 = 1;
  while (pow2 * 2 <= 2 ** 52) {
    const next_pow2 = pow2 * 2;
    expect(prev_pow2(pow2)).toBe(pow2);
    // Need to skip 2, because it's also a power of 2, so it doesn't
    // return the previous power of 2.
    if (next_pow2 > 2) {
      expect(prev_pow2(pow2 + 1)).toBe(pow2);
      expect(prev_pow2(next_pow2 - 1)).toBe(pow2);
    }
    pow2 = next_pow2;
  }
});

// crate: hashbrown-0.17.1/src/raw.rs:4363 test_minimum_capacity_for_small_types
test("test_minimum_capacity_for_small_types", () => {
  // crate: hashbrown-0.17.1/src/raw.rs:4365 test_t
  function test_t(size: number, align: number): void {
    const raw_table = RawTable.with_capacity<number>(TableLayout.new(size, align), 1);
    const actual_buckets = raw_table.num_buckets();
    const min_buckets = Math.floor(Group.WIDTH / size);
    expect(actual_buckets).toBeGreaterThanOrEqual(min_buckets);
  }

  test_t(1, 1); // u8

  // This is only "small" for some platforms, like x86_64 with SSE2, but
  // there's no harm in running it on other platforms.
  test_t(2, 2); // u16
});

// crate: hashbrown-0.17.1/src/raw.rs:4382 rehash_in_place
function rehash_in_place<T>(table: RawTable<T>, hasher: (t: T) => bigint): void {
  table.table.rehash_in_place((t, index) => hasher(t.data[index] as T), table.TABLE_LAYOUT.size, undefined);
}

// crate: hashbrown-0.17.1/src/raw.rs:4397 rehash
test("rehash", () => {
  const table = RawTable.new<bigint>(TableLayout.new(8, 8));
  const hasher = (i: bigint) => i;
  for (let i = 0n; i < 100n; i++) {
    table.insert(i, i, hasher);
  }

  const check = () => {
    for (let i = 0n; i < 100n; i++) {
      const b = table.find(i, (x) => x === i);
      expect(b === undefined ? undefined : table.bucket_as_ref(b)).toBe(i);
      expect(table.find(i + 100n, (x) => x === i + 100n)).toBeUndefined();
    }
  };
  check();

  rehash_in_place(table, hasher);

  check();
});
