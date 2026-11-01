// Port of rand_core =0.10.1 `tests/block.rs`.
import { expect, test } from "bun:test";
import { BlockRng, clone_BlockRng, type Generator } from "../block.ts";
import { Word_u32, Word_u64 } from "../word.ts";

const RESULTS_LEN = 16;

class DummyRng implements Generator<number> {
  constructor(public counter: number) {}

  // crate: rand_core-0.10.1/tests/block.rs:17 generate
  generate(output: number[]): void {
    for (let i = 0; i < output.length; i++) {
      output[i] = this.counter;
      this.counter = (this.counter + 3511615421) >>> 0;
    }
  }

  // impl SeedableRng for DummyRng (type Seed = [u8; 4])
  // crate: rand_core-0.10.1/tests/block.rs:28 from_seed
  static from_seed(seed: Uint8Array): DummyRng {
    return new DummyRng(Word_u32.from_le_bytes(seed));
  }
}

const clone_dummy = (g: DummyRng) => new DummyRng(g.counter);

// crate: rand_core-0.10.1/tests/block.rs:36 blockrng_next_u32_vs_next_u64
test("blockrng_next_u32_vs_next_u64", () => {
  const rng1 = BlockRng.new(DummyRng.from_seed(Uint8Array.of(1, 2, 3, 4)), Word_u32, RESULTS_LEN);
  const rng2 = clone_BlockRng(rng1, clone_dummy);
  const rng3 = clone_BlockRng(rng1, clone_dummy);

  const a = new Uint8Array(16);
  a.set(Word_u32.to_le_bytes(rng1.next_word()), 0);
  a.set(Word_u64.to_le_bytes(rng1.next_u64_from_u32()), 4);
  a.set(Word_u32.to_le_bytes(rng1.next_word()), 12);

  const b = new Uint8Array(16);
  b.set(Word_u32.to_le_bytes(rng2.next_word()), 0);
  b.set(Word_u32.to_le_bytes(rng2.next_word()), 4);
  b.set(Word_u64.to_le_bytes(rng2.next_u64_from_u32()), 8);
  expect(a).toEqual(b);

  const c = new Uint8Array(16);
  c.set(Word_u64.to_le_bytes(rng3.next_u64_from_u32()), 0);
  c.set(Word_u32.to_le_bytes(rng3.next_word()), 8);
  c.set(Word_u32.to_le_bytes(rng3.next_word()), 12);
  expect(a).toEqual(c);
});

// crate: rand_core-0.10.1/tests/block.rs:60 blockrng_next_u64
test("blockrng_next_u64", () => {
  const rng = BlockRng.new(DummyRng.from_seed(Uint8Array.of(1, 2, 3, 4)), Word_u32, RESULTS_LEN);
  const result_size = RESULTS_LEN;
  for (let i = 0; i < result_size / 2 - 1; i++) {
    rng.next_u64_from_u32();
  }
  rng.next_word();

  rng.next_u64_from_u32();
  expect(rng.word_offset()).toBe(1);
});
