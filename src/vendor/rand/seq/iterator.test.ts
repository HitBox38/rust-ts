// Port of rand =0.10.1 `src/seq/iterator.rs` `#[cfg(test)] mod test`: the `choose` tests (the `choose_stable`
// and `sample*` tests exercise methods that are not ported).
import { expect, test } from "bun:test";
import type { Rng } from "../../rand_core/lib.ts";
import { rng } from "../test_util.ts";
import { IteratorRandom, type RustIterator } from "./iterator.ts";

/** `core::ops::Range<usize>` / `slice::Iter().cloned()` as an `ExactSizeIterator` with core's O(1) `nth`. */
class RangeIter implements RustIterator<number> {
  constructor(
    public start: number,
    public end: number,
  ) {}
  next(): number | undefined {
    return this.start < this.end ? this.start++ : undefined;
  }
  size_hint(): [number, number | undefined] {
    const n = Math.max(this.end - this.start, 0);
    return [n, n];
  }
  len(): number {
    return this.size_hint()[0];
  }
  nth(n: number): number | undefined {
    const plus_n = this.start + n;
    if (plus_n < this.end) {
      this.start = plus_n + 1;
      return plus_n;
    }
    this.start = this.end;
    return undefined;
  }
  clone(): RangeIter {
    return new RangeIter(this.start, this.end);
  }
}

class UnhintedIterator implements RustIterator<number> {
  constructor(public iter: RangeIter) {}
  // crate: rand-0.10.1/src/seq/iterator.rs:300 next
  next(): number | undefined {
    return this.iter.next();
  }
  size_hint(): [number, number | undefined] {
    return [0, undefined];
  }
  clone(): UnhintedIterator {
    return new UnhintedIterator(this.iter.clone());
  }
}

class ChunkHintedIterator implements RustIterator<number> {
  constructor(
    public iter: RangeIter,
    public chunk_remaining: number,
    public chunk_size: number,
    public hint_total_size: boolean,
  ) {}
  // crate: rand-0.10.1/src/seq/iterator.rs:315 next
  next(): number | undefined {
    if (this.chunk_remaining === 0) {
      this.chunk_remaining = Math.min(this.chunk_size, this.iter.len());
    }
    this.chunk_remaining = Math.max(this.chunk_remaining - 1, 0);

    return this.iter.next();
  }
  // crate: rand-0.10.1/src/seq/iterator.rs:324 size_hint
  size_hint(): [number, number | undefined] {
    return [this.chunk_remaining, this.hint_total_size ? this.iter.len() : undefined];
  }
  clone(): ChunkHintedIterator {
    return new ChunkHintedIterator(this.iter.clone(), this.chunk_remaining, this.chunk_size, this.hint_total_size);
  }
}

class WindowHintedIterator implements RustIterator<number> {
  constructor(
    public iter: RangeIter,
    public window_size: number,
    public hint_total_size: boolean,
  ) {}
  // crate: rand-0.10.1/src/seq/iterator.rs:345 next
  next(): number | undefined {
    return this.iter.next();
  }
  // crate: rand-0.10.1/src/seq/iterator.rs:349 size_hint
  size_hint(): [number, number | undefined] {
    return [Math.min(this.iter.len(), this.window_size), this.hint_total_size ? this.iter.len() : undefined];
  }
  clone(): WindowHintedIterator {
    return new WindowHintedIterator(this.iter.clone(), this.window_size, this.hint_total_size);
  }
}

type Cloneable = RustIterator<number> & { clone(): Cloneable };

// crate: rand-0.10.1/src/seq/iterator.rs:363 test_iterator_choose
test("test_iterator_choose", () => {
  const r = rng(109n);
  // crate: rand-0.10.1/src/seq/iterator.rs:365 test_iter
  function test_iter(r: Rng, iter: Cloneable): void {
    const chosen = new Array<number>(9).fill(0);
    for (let i = 0; i < 1000; i++) {
      const picked = IteratorRandom.choose(iter.clone(), r)!;
      chosen[picked]! += 1;
    }
    for (const count of chosen) {
      // Samples should follow Binomial(1000, 1/9)
      // Octave: binopdf(x, 1000, 1/9) gives the prob of *count == x
      // Note: have seen 153, which is unlikely but not impossible.
      expect(72 < count && count < 154).toBe(true);
    }
  }

  test_iter(r, new RangeIter(0, 9));
  test_iter(r, new RangeIter(0, 9)); // [0, 1, 2, 3, 4, 5, 6, 7, 8].iter().cloned()
  test_iter(r, new RangeIter(0, 9)); // (0..9).collect::<Vec<_>>().into_iter()
  test_iter(r, new UnhintedIterator(new RangeIter(0, 9)));
  test_iter(r, new ChunkHintedIterator(new RangeIter(0, 9), 4, 4, false));
  test_iter(r, new ChunkHintedIterator(new RangeIter(0, 9), 4, 4, true));
  test_iter(r, new WindowHintedIterator(new RangeIter(0, 9), 2, false));
  test_iter(r, new WindowHintedIterator(new RangeIter(0, 9), 2, true));

  expect(IteratorRandom.choose(new RangeIter(0, 0), r)).toBe(undefined);
  expect(IteratorRandom.choose(new UnhintedIterator(new RangeIter(0, 0)), r)).toBe(undefined);
});

// crate: rand-0.10.1/src/seq/iterator.rs:575 value_stability_choose
test("value_stability_choose", () => {
  // crate: rand-0.10.1/src/seq/iterator.rs:576 choose
  function choose(iter: RustIterator<number>): number | undefined {
    const r = rng(411n);
    return IteratorRandom.choose(iter, r);
  }

  expect(choose(new RangeIter(0, 0))).toBe(undefined);
  expect(choose(new RangeIter(0, 100))).toBe(33);
  expect(choose(new UnhintedIterator(new RangeIter(0, 100)))).toBe(27);
  expect(choose(new ChunkHintedIterator(new RangeIter(0, 100), 32, 32, false))).toBe(91);
  expect(choose(new ChunkHintedIterator(new RangeIter(0, 100), 32, 32, true))).toBe(91);
  expect(choose(new WindowHintedIterator(new RangeIter(0, 100), 32, false))).toBe(34);
  expect(choose(new WindowHintedIterator(new RangeIter(0, 100), 32, true))).toBe(34);
});
