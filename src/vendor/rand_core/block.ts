//! The [`Generator`] trait and [`BlockRng`]
//!
//! Trait [`Generator`] may be implemented by block-generators; that is PRNGs
//! whose output is a *block* of words, such as `[u32; 16]`.
//!
//! The struct [`BlockRng`] wraps such a [`Generator`] together with an output
//! buffer and implements several methods (e.g. [`BlockRng::next_word`]) to
//! assist in the implementation of [`TryRng`](crate::TryRng). Note that (unlike
//! in earlier versions of `rand_core`) [`BlockRng`] itself does not implement
//! [`TryRng`] since in practice we found it was always beneficial to use a
//! wrapper type over [`BlockRng`].
//
// Port of rand_core =0.10.1 `src/block.rs`.
// PORT: `G::Output = [W; N]` is a `W[]` of length `N`; `W` (its `Word` table) and `N` are passed to
// `BlockRng.new`/`reconstruct` because TS cannot read them off `G`.
import { debug_struct_non_exhaustive, type Debug, type Fmt } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import type { Word } from "./word.ts";

/// A random (block) generator
export interface Generator<W> {
  /// Generate a new block of `output`.
  ///
  /// This must fill `output` with random data.
  // crate: rand_core-0.10.1/src/block.rs:90 generate
  generate(output: W[]): void;

  // drop (provided)
}

export const Generator_provided = {
  /// Destruct the output buffer
  ///
  /// This method is called on [`Drop`] of the [`Self::Output`] buffer.
  /// The default implementation does nothing.
  // crate: rand_core-0.10.1/src/block.rs:97 drop
  drop<W>(self: Generator<W>, output: W[]): void {
    void self;
    void output;
  },
};

/// RNG functionality for a block [`Generator`]
///
/// This type encompasses a [`Generator`] [`core`](Self::core) and a buffer.
/// It provides optimized implementations of methods required by an [`Rng`].
///
/// All values are consumed in-order of generation. No whole words (e.g. `u32`
/// or `u64`) are discarded, though where a word is partially used (e.g. for a
/// byte-fill whose length is not a multiple of the word size) the rest of the
/// word is discarded.
export class BlockRng<W, G extends Generator<W>> {
  constructor(
    public results: W[],
    /// The *core* part of the RNG, implementing the `generate` function.
    public core: G,
    /** PORT: the word type's table and `N` (`G::Output = [W; N]`). */
    readonly W: Word<W>,
    readonly N: number,
  ) {}

  /// Create a new `BlockRng` from an existing RNG implementing
  /// `Generator`. Results will be generated on first use.
  // crate: rand_core-0.10.1/src/block.rs:142 new
  static new<W, G extends Generator<W>>(core: G, W: Word<W>, N: number): BlockRng<W, G> {
    const results = new Array<W>(N).fill(W.default);
    results[0] = W.from_usize(N);
    return new BlockRng(results, core, W, N);
  }

  /// Reconstruct from a core and a remaining-results buffer.
  ///
  /// This may be used to deserialize using a `core` and the output of
  /// [`Self::remaining_results`].
  ///
  /// Returns `None` if `remaining_results` is too long.
  // crate: rand_core-0.10.1/src/block.rs:154 reconstruct
  static reconstruct<W, G extends Generator<W>>(core: G, remaining_results: readonly W[], W: Word<W>, N: number): BlockRng<W, G> | undefined {
    const results = new Array<W>(N).fill(W.default);
    if (remaining_results.length < N) {
      const index = N - remaining_results.length;
      for (let i = 0; i < remaining_results.length; i++) results[index + i] = remaining_results[i]!;
      results[0] = W.from_usize(index);
      return new BlockRng(results, core, W, N);
    } else {
      return undefined;
    }
  }

  /// Get the index into the result buffer.
  ///
  /// If this is equal to or larger than the size of the result buffer then
  /// the buffer is "empty" and `generate()` must be called to produce new
  /// results.
  // crate: rand_core-0.10.1/src/block.rs:174 index
  private index(): number {
    return this.W.into_usize(this.results[0]!);
  }

  // crate: rand_core-0.10.1/src/block.rs:179 set_index
  private set_index(index: number): void {
    // debug_assert!(0 < index && index <= N);
    this.results[0] = this.W.from_usize(index);
  }

  /// Reset the number of available results.
  ///
  /// This will force a new set of results to be generated on next use.
  /// Re-generate buffer contents, skipping the first `n` results
  ///
  /// This is equivalent to calling [`Self::next_word`] `n` times.
  ///
  /// # Panics
  ///
  /// Panics if `n >= N`.
  // crate: rand_core-0.10.1/src/block.rs:195 reset_and_skip
  reset_and_skip(n: number): void {
    if (n === 0) {
      this.set_index(this.N);
      return;
    }

    assert(n < this.N, "assertion failed: n < N");
    this.core.generate(this.results);
    this.set_index(n);
  }

  /// Get the number of words consumed since the start of the block
  ///
  /// The result is in the range `0..N`.
  // crate: rand_core-0.10.1/src/block.rs:211 word_offset
  word_offset(): number {
    const index = this.index();
    return index >= this.N ? 0 : index;
  }

  /// Access the unused part of the results buffer
  ///
  /// The length of the returned slice is guaranteed to be less than the
  /// length of `<Self as Generator>::Output` (i.e. less than `N` where
  /// `Output = [W; N]`).
  ///
  /// This is a low-level interface intended for serialization.
  /// Results are not marked as consumed.
  // crate: rand_core-0.10.1/src/block.rs:225 remaining_results
  remaining_results(): readonly W[] {
    const index = this.index();
    return this.results.slice(index);
  }

  /// Generate the next word (e.g. `u32`)
  // crate: rand_core-0.10.1/src/block.rs:232 next_word
  next_word(): W {
    let index = this.index();
    if (index >= this.N) {
      this.core.generate(this.results);
      index = 0;
    }

    const value = this.results[index]!;
    this.set_index(index + 1);
    return value;
  }

  // impl<const N: usize, G: Generator<Output = [u32; N]>> BlockRng<G>
  /// Generate a `u64` from two `u32` words
  // crate: rand_core-0.10.1/src/block.rs:248 next_u64_from_u32
  next_u64_from_u32(this: BlockRng<number, Generator<number>>): bigint {
    const N = this.N;
    const index = this.index();
    let new_index;
    let lo, hi;
    if (index < N - 1) {
      lo = this.results[index]!;
      hi = this.results[index + 1]!;
      new_index = index + 2;
    } else {
      lo = this.results[N - 1]!;
      this.core.generate(this.results);
      hi = this.results[0]!;
      new_index = 1;
      if (index >= N) {
        lo = hi;
        hi = this.results[1]!;
        new_index = 2;
      }
    }
    this.set_index(new_index);
    return (BigInt(hi) << 32n) | BigInt(lo);
  }

  /// Fill `dest`
  // crate: rand_core-0.10.1/src/block.rs:275 fill_bytes
  fill_bytes(dest: Uint8Array): void {
    const N = this.N;
    let read_len = 0;
    let index = this.index();
    while (read_len < dest.length) {
      if (index >= N) {
        this.core.generate(this.results);
        index = 0;
      }

      const size = this.W.size;
      // `dest[read_len..].chunks_exact_mut(size)` zipped with `self.results[index..].iter()`
      const chunks = Math.floor((dest.length - read_len) / size);
      const num_chunks = Math.min(chunks, N - index);
      for (let i = 0; i < num_chunks; i++) {
        dest.set(this.W.to_le_bytes(this.results[index + i]!), read_len + i * size);
      }
      index += num_chunks;
      read_len += num_chunks * size;

      // `if let Some(src) = src.next()`: `zip` takes the next `src` item only when there was one more
      // chunk, so after a short `chunks` the source still has its item at `index`.
      if (index < N) {
        const src = this.results[index]!;
        // We have consumed all full chunks of dest, but not src.
        const dest_rem = dest.subarray(read_len);
        const n = dest_rem.length;
        if (n > 0) {
          dest_rem.set(this.W.to_le_bytes(src).subarray(0, n));
          index += 1;
          // debug_assert_eq!(read_len + n, dest.len());
        }
        break;
      }
    }
    this.set_index(index);
  }
}

// impl<G> fmt::Debug for BlockRng<G>
// Custom Debug implementation that does not expose the contents of `results`.
// crate: rand_core-0.10.1/src/block.rs:125 fmt
export function debug_BlockRng<W, G extends Generator<W>>(debug_core: Debug<G>): Debug<BlockRng<W, G>> {
  return (v: BlockRng<W, G>, f: Fmt) => debug_struct_non_exhaustive(f, "BlockRng", [["core", debug_core(v.core, f)]]);
}

// impl<G: Generator> Drop for BlockRng<G>
// PORT: TS has no destructors, so this never runs implicitly; the only `Generator::drop` override in this
// dependency tree (chacha20's zeroize) is behind the disabled `zeroize` feature.
// crate: rand_core-0.10.1/src/block.rs:133 drop
export function drop_BlockRng<W>(self: BlockRng<W, Generator<W>>, drop: (output: W[]) => void): void {
  drop(self.results);
}

/** `#[derive(Clone)]`: `G: Clone` is `clone_core`. */
export function clone_BlockRng<W, G extends Generator<W>>(v: BlockRng<W, G>, clone_core: (g: G) => G): BlockRng<W, G> {
  return new BlockRng(v.results.slice(), clone_core(v.core), v.W, v.N);
}
