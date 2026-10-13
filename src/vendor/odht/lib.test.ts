// Port of the `#[cfg(test)] mod tests` of odht =0.3.1 `src/lib.rs`.
//
// PORT: the `quickchecks` module uses quickcheck 1 (random inputs + shrinking). Here each property runs
// on 100 inputs (quickcheck's default test count) from a fixed-seed PRNG, with collection sizes up to
// 100 (quickcheck's default `Gen` size); shrinking is not ported. `FxHashMap<Key, Value>` inputs are a
// JS `Map` keyed by the key's bytes (the properties do not depend on the map's iteration order).
import { describe, expect, test } from "bun:test";
import { bytes_needed, type Config, Factor, Factor_eq, FxHashFn, HashTable, HashTableOwned, max_item_count_for, slots_needed } from "./lib.ts";
import { ByteArray_provided, ByteArray_u8_array, type ByteArray } from "./raw_table.ts";
import { REFERENCE_GROUP_SIZE } from "./swisstable_group_query/mod.ts";

const U32_MAX = 0xffff_ffff;

function u32_to_le_bytes(x: number): Uint8Array {
  return Uint8Array.of(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, x >>> 24);
}
function u32_from_le_bytes(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}

// enum TestConfig {}
const TestConfig: Config<number, number> = {
  EncodedKey: ByteArray_u8_array(4),
  EncodedValue: ByteArray_u8_array(4),

  H: FxHashFn,

  // crate: odht-0.3.1/src/lib.rs:598 encode_key
  encode_key(k: number): Uint8Array {
    return u32_to_le_bytes(k);
  },

  // crate: odht-0.3.1/src/lib.rs:602 encode_value
  encode_value(v: number): Uint8Array {
    return u32_to_le_bytes(v);
  },

  // crate: odht-0.3.1/src/lib.rs:606 decode_key
  decode_key(k: Uint8Array): number {
    return u32_from_le_bytes(k);
  },

  // crate: odht-0.3.1/src/lib.rs:610 decode_value
  decode_value(v: Uint8Array): number {
    return u32_from_le_bytes(v);
  },
};

function cmp_pair(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

// crate: odht-0.3.1/src/lib.rs:615 make_test_items
function make_test_items(count: number): [number, number][] {
  if (count === 0) {
    return [];
  }

  let items: [number, number][] = [];

  if (count > 1) {
    const steps = count - 1;
    const step = Math.floor(U32_MAX / steps);

    for (let i = 0; i < steps; i++) {
      const x = i * step;
      items.push([x, U32_MAX - x]);
    }
  }

  items.push([U32_MAX, 0]);

  items.sort(cmp_pair);
  items = items.filter((p, i) => i === 0 || cmp_pair(items[i - 1]!, p) !== 0);
  expect(items.length).toBe(count);

  return items;
}

// crate: odht-0.3.1/src/lib.rs:642 from_iterator
test("from_iterator", () => {
  for (let count = 0; count < 33; count++) {
    const items = make_test_items(count);
    const table = HashTableOwned.from_iterator(TestConfig, items.slice(), 95);
    expect(table.len()).toBe(items.length);

    const actual_items = [...table.iter()];
    actual_items.sort(cmp_pair);

    expect(actual_items).toEqual(items);
  }
});

// crate: odht-0.3.1/src/lib.rs:656 init_in_place
test("init_in_place", () => {
  for (let count = 0; count < 33; count++) {
    const items = make_test_items(count);
    const byte_count = bytes_needed(TestConfig, items.length, 87);
    const data = new Uint8Array(byte_count);

    const r = HashTable.init_in_place(TestConfig, data, items.length, 87);
    if (r.$ !== "Ok") throw new Error(`unwrap: ${r._0}`);
    const table = r._0;

    items.forEach(([k, v], i) => {
      expect(table.len()).toBe(i);
      expect(table.insert(k, v)).toBeUndefined();
      expect(table.len()).toBe(i + 1);

      // Make sure we still can find all items previously inserted.
      for (const [k, v] of items.slice(0, i)) {
        expect(table.get(k)).toBe(v);
      }
    });

    const actual_items = [...table.iter()];
    actual_items.sort(cmp_pair);

    expect(actual_items).toEqual(items);
  }
});

// crate: odht-0.3.1/src/lib.rs:684 hash_table_at_different_alignments
test("hash_table_at_different_alignments", () => {
  const items = make_test_items(33);

  let serialized: number[] = (() => {
    const table = HashTableOwned.from_iterator(TestConfig, items.slice(), 95);

    expect(table.len()).toBe(items.length);

    return Array.from(table.raw_bytes());
  })();

  for (let alignment_shift = 0; alignment_shift < 4; alignment_shift++) {
    // PORT: a fresh buffer with `alignment_shift` leading bytes, viewed from that offset, so the
    // table really starts at an unaligned byte offset of its ArrayBuffer.
    const data = Uint8Array.from(serialized).subarray(alignment_shift);

    const r = HashTable.from_raw_bytes(TestConfig, data);
    if (r.$ !== "Ok") throw new Error(`unwrap: ${r._0}`);
    const table = r._0;

    expect(table.len()).toBe(items.length);

    for (const [key, value] of items) {
      expect(table.get(key)).toBe(value);
    }

    serialized = [0xff, ...serialized];
  }
});

// crate: odht-0.3.1/src/lib.rs:712 load_factor_and_item_count
test("load_factor_and_item_count", () => {
  expect(slots_needed(0, Factor.from_percent(100))).toBe(REFERENCE_GROUP_SIZE);
  expect(slots_needed(6, Factor.from_percent(60))).toBe(16);
  expect(slots_needed(5, Factor.from_percent(50))).toBe(16);
  expect(slots_needed(5, Factor.from_percent(49))).toBe(16);
  expect(slots_needed(1000, Factor.from_percent(100))).toBe(1024);

  // Factor cannot never be a full 100% because of the rounding involved.
  expect(max_item_count_for(10, Factor.from_percent(100))).toBe(9);
  expect(max_item_count_for(10, Factor.from_percent(50))).toBe(4);
  expect(max_item_count_for(11, Factor.from_percent(50))).toBe(5);
  expect(max_item_count_for(12, Factor.from_percent(50))).toBe(5);
});

// crate: odht-0.3.1/src/lib.rs:730 grow
test("grow", () => {
  const items = make_test_items(100);
  const table = HashTableOwned.with_capacity(TestConfig, 10, 87);

  for (const [key, value] of items) {
    expect(table.insert(key, value)).toBeUndefined();
  }
});

// crate: odht-0.3.1/src/lib.rs:740 factor_from_percent
test("factor_from_percent", () => {
  expect(Factor_eq(Factor.from_percent(100), new Factor(0xffff))).toBe(true);
  expect(Factor_eq(Factor.from_percent(0), new Factor(0))).toBe(true);
  expect(Factor_eq(Factor.from_percent(50), new Factor(Math.floor(0xffff / 2)))).toBe(true);
});

// PORT: `usize::MAX` (2^64 - 1) has no exact `number`; the nearest one, 2^64, stands in for it. The
// assertions only require the results to be within 0.01% of it.
const USIZE_MAX = 2 ** 64;

// crate: odht-0.3.1/src/lib.rs:747 factor_apply
test("factor_apply", () => {
  expect(Factor.from_percent(100).apply(12345)).toBe(12344);
  expect(Factor.from_percent(0).apply(12345)).toBe(0);
  expect(Factor.from_percent(50).apply(66)).toBe(32);

  // Make sure we can handle large numbers without overflow
  assert_basically_equal(Factor.from_percent(100).apply(USIZE_MAX), USIZE_MAX);
});

// crate: odht-0.3.1/src/lib.rs:757 factor_apply_inverse
test("factor_apply_inverse", () => {
  expect(Factor.from_percent(100).apply_inverse(12345)).toBe(12345);
  expect(Factor.from_percent(10).apply_inverse(100)).toBe(1001);
  expect(Factor.from_percent(50).apply_inverse(33)).toBe(67);

  // // Make sure we can handle large numbers without overflow
  assert_basically_equal(Factor.from_percent(100).apply_inverse(USIZE_MAX), USIZE_MAX);
});

// crate: odht-0.3.1/src/lib.rs:769 assert_basically_equal
function assert_basically_equal(x: number, y: number): void {
  const larger_number = Math.max(x, y);
  const abs_difference = Math.abs(x - y);
  const difference_in_percent = (abs_difference / larger_number) * 100.0;

  const MAX_ALLOWED_DIFFERENCE_IN_PERCENT = 0.01;

  expect(difference_in_percent).toBeLessThan(MAX_ALLOWED_DIFFERENCE_IN_PERCENT);
}

// mod quickchecks
describe("quickchecks", () => {
  /** PORT: quickcheck's `Gen` (see the file header): xorshift64* with a fixed seed. */
  class Gen {
    private s: bigint;
    constructor(
      seed: bigint,
      readonly size: number,
    ) {
      this.s = seed;
    }
    next_u32(): number {
      let x = this.s;
      x ^= x >> 12n;
      x ^= (x << 25n) & 0xffff_ffff_ffff_ffffn;
      x ^= x >> 27n;
      this.s = x;
      return Number(((x * 0x2545f4914f6cdd1dn) & 0xffff_ffff_ffff_ffffn) >> 32n);
    }
    /** `u8::arbitrary`: mostly small values or a uniform byte, as quickcheck biases towards edge cases. */
    u8(): number {
      const r = this.next_u32();
      return r % 4 === 0 ? r % 3 : (r >>> 8) & 0xff;
    }
    below(n: number): number {
      return this.next_u32() % n;
    }
  }

  // #[derive(Copy, Clone, Hash, Eq, PartialEq, Debug)]
  // struct Bytes<const BYTE_COUNT: usize>([u8; BYTE_COUNT]);
  // PORT: a `Bytes<L>` value is its `Uint8Array`; `Bytes(L)` is its `ByteArray` dictionary.
  function Bytes(L: number): ByteArray & { arbitrary(gen: Gen): Uint8Array; default(): Uint8Array } {
    const self_ = {
      LEN: L,
      debug: (v: Uint8Array) => `Bytes([${Array.from(v).join(", ")}])`,

      // impl<const L: usize> Arbitrary for Bytes<L>
      // crate: odht-0.3.1/src/lib.rs:797 arbitrary
      arbitrary(gen: Gen): Uint8Array {
        const xs = new Uint8Array(L);
        for (let i = 0; i < xs.length; i++) {
          xs[i] = gen.u8();
        }
        return xs;
      },

      // impl<const L: usize> Default for Bytes<L>
      // crate: odht-0.3.1/src/lib.rs:807 default
      default(): Uint8Array {
        return new Uint8Array(L);
      },

      // impl<const L: usize> ByteArray for Bytes<L>
      // crate: odht-0.3.1/src/lib.rs:814 zeroed
      zeroed(): Uint8Array {
        return new Uint8Array(L);
      },

      // crate: odht-0.3.1/src/lib.rs:819 as_slice
      as_slice(self: Uint8Array): Uint8Array {
        return self;
      },

      // crate: odht-0.3.1/src/lib.rs:824 equals
      equals(self: Uint8Array, other: Uint8Array): boolean {
        const a = self_.as_slice(self);
        const b = self_.as_slice(other);
        return a.length === b.length && a.every((x, i) => x === b[i]);
      },

      is_all_zeros(self: Uint8Array): boolean {
        return ByteArray_provided.is_all_zeros(self_, self);
      },
    };
    return self_;
  }

  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const QUICKCHECK_TESTS = 100;
  const QUICKCHECK_SIZE = 100;

  // macro_rules! mk_quick_tests
  function mk_quick_tests(name: string, key_len: number, value_len: number): void {
    describe(name, () => {
      const Key = Bytes(key_len);
      const Value = Bytes(value_len);

      // struct Cfg;
      const Cfg: Config<Uint8Array, Uint8Array> = {
        EncodedKey: Key,
        EncodedValue: Value,

        H: FxHashFn,

        // crate: odht-0.3.1/src/lib.rs:849 encode_key
        encode_key(k: Uint8Array): Uint8Array {
          return k.slice();
        },

        // crate: odht-0.3.1/src/lib.rs:853 encode_value
        encode_value(v: Uint8Array): Uint8Array {
          return v.slice();
        },

        // crate: odht-0.3.1/src/lib.rs:857 decode_key
        decode_key(k: Uint8Array): Uint8Array {
          return k.slice();
        },

        // crate: odht-0.3.1/src/lib.rs:861 decode_value
        decode_value(v: Uint8Array): Uint8Array {
          return v.slice();
        },
      };

      type FxHashMap = Map<string, [Uint8Array, Uint8Array]>;

      // crate: odht-0.3.1/src/lib.rs:866 from_std_hashmap
      function from_std_hashmap(m: FxHashMap): HashTableOwned<Uint8Array, Uint8Array> {
        return HashTableOwned.from_iterator(Cfg, [...m.values()].map(([x, y]) => [x, y] as const), 87);
      }

      /** `Vec<(Key, Value)>::arbitrary` */
      function arbitrary_vec(gen: Gen): [Uint8Array, Uint8Array][] {
        const n = gen.below(gen.size + 1);
        const xs: [Uint8Array, Uint8Array][] = [];
        for (let i = 0; i < n; i++) xs.push([Key.arbitrary(gen), Value.arbitrary(gen)]);
        return xs;
      }
      /** `FxHashMap<Key, Value>::arbitrary` (collected from an arbitrary `Vec`) */
      function arbitrary_map(gen: Gen): FxHashMap {
        const m: FxHashMap = new Map();
        for (const [k, v] of arbitrary_vec(gen)) m.set(hex(k), [k, v]);
        return m;
      }

      /** `quickcheck! { fn name(xs: T) -> bool { .. } }` */
      function quickcheck<T>(prop: string, arbitrary: (gen: Gen) => T, f: (xs: T) => boolean): void {
        test(prop, () => {
          const gen = new Gen(0x9e3779b97f4a7c15n ^ BigInt(key_len * 131 + value_len), QUICKCHECK_SIZE);
          for (let i = 0; i < QUICKCHECK_TESTS; i++) {
            expect(f(arbitrary(gen))).toBe(true);
          }
        });
      }

      // crate: odht-0.3.1/src/lib.rs:871 len
      quickcheck("len", arbitrary_map, (xs) => {
        const table = from_std_hashmap(xs);

        return xs.size === table.len();
      });

      // crate: odht-0.3.1/src/lib.rs:879 lookup
      quickcheck("lookup", arbitrary_map, (xs) => {
        const table = from_std_hashmap(xs);
        return [...xs.values()].every(([k, v]) => {
          const got = table.get(k);
          return got !== undefined && Value.equals(got, v);
        });
      });

      // crate: odht-0.3.1/src/lib.rs:886 insert_with_duplicates
      quickcheck("insert_with_duplicates", arbitrary_vec, (xs) => {
        const reference: FxHashMap = new Map();
        const table = HashTableOwned.default(Cfg);

        for (const [k, v] of xs) {
          const expected = reference.get(hex(k))?.[1];
          reference.set(hex(k), [k, v]);
          const actual = table.insert(k, v);

          const same = expected === undefined ? actual === undefined : actual !== undefined && Value.equals(expected, actual);
          if (!same) {
            return false;
          }
        }

        return true;
      });

      // crate: odht-0.3.1/src/lib.rs:904 bytes_deterministic
      quickcheck("bytes_deterministic", arbitrary_map, (xs) => {
        // NOTE: We only guarantee this given the exact same
        //       insertion order.
        const table0 = from_std_hashmap(xs);
        const table1 = from_std_hashmap(xs);

        return hex(table0.raw_bytes()) === hex(table1.raw_bytes());
      });

      // crate: odht-0.3.1/src/lib.rs:915 from_iterator_vs_manual_insertion
      quickcheck("from_iterator_vs_manual_insertion", arbitrary_vec, (xs) => {
        const table0 = HashTableOwned.with_capacity(Cfg, xs.length, 87);

        for (const [k, v] of xs) {
          table0.insert(k, v);
        }

        const table1 = HashTableOwned.from_iterator(Cfg, xs, 87);

        // Requiring bit for bit equality might be a bit too much in this case,
        // as long as it works ...
        return hex(table0.raw_bytes()) === hex(table1.raw_bytes());
      });
    });
  }

  // Test zero sized key and values
  mk_quick_tests("k0_v0", 0, 0);
  mk_quick_tests("k1_v0", 1, 0);
  mk_quick_tests("k2_v0", 2, 0);
  mk_quick_tests("k3_v0", 3, 0);
  mk_quick_tests("k4_v0", 4, 0);
  mk_quick_tests("k8_v0", 8, 0);
  mk_quick_tests("k15_v0", 15, 0);
  mk_quick_tests("k16_v0", 16, 0);
  mk_quick_tests("k17_v0", 17, 0);
  mk_quick_tests("k63_v0", 63, 0);
  mk_quick_tests("k64_v0", 64, 0);

  // Test a few different key sizes
  mk_quick_tests("k2_v4", 2, 4);
  mk_quick_tests("k4_v4", 4, 4);
  mk_quick_tests("k8_v4", 8, 4);
  mk_quick_tests("k17_v4", 17, 4);
  mk_quick_tests("k20_v4", 20, 4);
  mk_quick_tests("k64_v4", 64, 4);

  // Test a few different value sizes
  mk_quick_tests("k16_v1", 16, 1);
  mk_quick_tests("k16_v2", 16, 2);
  mk_quick_tests("k16_v3", 16, 3);
  mk_quick_tests("k16_v4", 16, 4);
  mk_quick_tests("k16_v8", 16, 8);
  mk_quick_tests("k16_v16", 16, 16);
  mk_quick_tests("k16_v17", 16, 17);
});
