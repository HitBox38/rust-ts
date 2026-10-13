// Port of the `#[cfg(test)] mod tests` of odht =0.3.1 `src/raw_table.rs`.
import { expect, test } from "bun:test";
import { FxHashFn } from "./fxhash.ts";
import type { HashFn } from "./lib.ts";
import { ByteArray_u8_array, Entry, EntrySlice, ProbeSeq, RawTable, RawTableMut, type ByteArray } from "./raw_table.ts";
import { REFERENCE_GROUP_SIZE } from "./swisstable_group_query/mod.ts";

/** `usize::next_power_of_two` */
function next_power_of_two(x: number): number {
  let p = 1;
  while (p < x) p *= 2;
  return p;
}

// crate: odht-0.3.1/src/raw_table.rs:522 make_table
function make_table(K: ByteArray, V: ByteArray, H: HashFn, xs: readonly (readonly [Uint8Array, Uint8Array])[]): [Uint8Array, EntrySlice] {
  const size = next_power_of_two(xs.length);
  const data = new EntrySlice(K, V, new Uint8Array(size * (K.LEN + V.LEN)), size);
  data.fill(Entry.default(K, V));
  const metadata = new Uint8Array(size + REFERENCE_GROUP_SIZE).fill(255);

  expect(metadata.every((b) => (b & 0x80) !== 0)).toBe(true);

  {
    const table = new RawTableMut(metadata, data, H);

    for (const [k, v] of xs) {
      table.insert(k, v);
    }
  }

  return [metadata, data];
}

// crate: odht-0.3.1/src/raw_table.rs:552 stress
test("stress", () => {
  const xs: Uint8Array[] = [];
  for (let x = 0; x <= 0xffff; x++) xs.push(Uint8Array.of(x & 0xff, x >>> 8));

  const K = ByteArray_u8_array(2);
  const [metadata, data] = make_table(
    K,
    K,
    FxHashFn,
    xs.map((x) => [x, x] as const),
  );

  {
    const table = new RawTable(metadata, data, FxHashFn);

    for (const x of xs) {
      expect(table.find(x)).toEqual(x);
    }
  }

  // overwrite all values
  {
    const table = new RawTableMut(metadata, data, FxHashFn);

    xs.forEach((x, i) => {
      expect(table.insert(x, Uint8Array.of(i & 0xff, (i + 1) & 0xff))).toEqual(x);
    });
  }

  // Check if we find the new expected values
  {
    const table = new RawTable(metadata, data, FxHashFn);

    xs.forEach((x, i) => {
      expect(table.find(x)).toEqual(Uint8Array.of(i & 0xff, (i + 1) & 0xff));
    });
  }
});

// This test makes sure that ProbeSeq will always visit the same slots
// in the same order, regardless of the actual GROUP_SIZE.
// crate: odht-0.3.1/src/raw_table.rs:599 probe_seq
test("probe_seq", () => {
  class ReferenceProbeSeq {
    constructor(
      public index: number,
      public stride: number,
    ) {}

    // crate: odht-0.3.1/src/raw_table.rs:606 new
    static new(h1: number, mask: number): ReferenceProbeSeq {
      return new ReferenceProbeSeq(h1 & mask, 0);
    }

    // crate: odht-0.3.1/src/raw_table.rs:613 advance
    advance(mask: number): void {
      this.stride += REFERENCE_GROUP_SIZE;
      this.index += this.stride;
      this.index &= mask;
    }
  }

  // crate: odht-0.3.1/src/raw_table.rs:620 test_with_group_size
  function test_with_group_size(GROUP_SIZE: number): void {
    expect(REFERENCE_GROUP_SIZE % GROUP_SIZE === 0).toBe(true);
    expect(REFERENCE_GROUP_SIZE >= GROUP_SIZE).toBe(true);

    for (let i = 4; i < 17; i++) {
      const item_count = 1 << i;
      expect(item_count % REFERENCE_GROUP_SIZE === 0).toBe(true);
      expect(item_count % GROUP_SIZE === 0).toBe(true);

      const mask = item_count - 1;

      const expected: number[] = [];

      const refseq = ReferenceProbeSeq.new(0, mask);
      for (let n = 0; n < item_count / REFERENCE_GROUP_SIZE; n++) {
        for (let index = refseq.index; index < refseq.index + REFERENCE_GROUP_SIZE; index++) {
          expected.push(index & mask);
        }
        refseq.advance(mask);
      }

      const actual: number[] = [];

      const seq = ProbeSeq.new(GROUP_SIZE, 0, mask);
      for (let n = 0; n < item_count / GROUP_SIZE; n++) {
        for (let index = seq.index; index < seq.index + GROUP_SIZE; index++) {
          actual.push(index & mask);
        }
        seq.advance(mask);
      }

      expect(actual).toEqual(expected);
    }
  }

  test_with_group_size(4);
  test_with_group_size(8);
  test_with_group_size(16);
});
