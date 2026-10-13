// Port of compiler/rustc_index/src/bit_set.rs (subset: `DenseBitSet` and its `BitIter`, the parts
// rustc_resolve uses for `Resolver::unused_macro_rules`; ported by lane res-macros, which owned the
// `DenseBitSet` stand-in of rustc_resolve/lib.ts). The rest of the file (`ChunkedBitSet`,
// `MixedBitSet`, `GrowableBitSet`, `BitMatrix`, ...) is not ported yet.
//
// PORT: `Word = u64` -> `bigint` (every bit is significant, so `number` cannot hold one). `T: Idx` is a
// number-like index (`usize` or a branded handle); `T::new(i)` / `value.index()` are the identity.
import { assert } from "../std/panic.ts";

type Word = bigint;
const WORD_BYTES = 8;
const WORD_BITS = WORD_BYTES * 8;
/** `!0` as a `u64`. */
const WORD_ALL_ONES: Word = (1n << 64n) - 1n;

/// A fixed-size bitset type with a dense representation.
///
/// Note 1: Since this bitset is dense, if your domain is big, and/or relatively
/// homogeneous (for example, with long runs of bits set or unset), then it may
/// be preferable to instead use a [MixedBitSet], or an
/// [IntervalSet](crate::interval::IntervalSet). They should be more suited to
/// sparse, or highly-compressible, domains.
///
/// Note 2: Use [`GrowableBitSet`] if you need support for resizing after creation.
///
/// `T` is an index type, typically a newtyped `usize` wrapper, but it can also
/// just be `usize`.
///
/// All operations that involve an element will panic if the element is equal
/// to or greater than the domain size. All operations that involve two bitsets
/// will panic if the bitsets have differing domain sizes.
///
// rustc-type: compiler/rustc_index/src/bit_set.rs:79 DenseBitSet
export class DenseBitSet<T extends number> {
  /** `marker: PhantomData<T>` (erased). */
  declare readonly __t?: T;

  constructor(
    public domain_size_: number,
    public words: Word[],
  ) {}

  /// Gets the domain size.
  // rustc: compiler/rustc_index/src/bit_set.rs:87 domain_size
  domain_size(): number {
    return this.domain_size_;
  }

  /// Creates a new, empty bitset with a given `domain_size`.
  // rustc: compiler/rustc_index/src/bit_set.rs:95 new_empty
  static new_empty<T extends number>(domain_size: number): DenseBitSet<T> {
    const num_words_ = num_words(domain_size);
    return new DenseBitSet<T>(domain_size, new Array<Word>(num_words_).fill(0n));
  }

  /// Creates a new, filled bitset with a given `domain_size`.
  // rustc: compiler/rustc_index/src/bit_set.rs:106 new_filled
  static new_filled<T extends number>(domain_size: number): DenseBitSet<T> {
    const num_words_ = num_words(domain_size);
    const result = new DenseBitSet<T>(domain_size, new Array<Word>(num_words_).fill(WORD_ALL_ONES));
    result.clear_excess_bits();
    return result;
  }

  /// Clear excess bits in the final word.
  // rustc: compiler/rustc_index/src/bit_set.rs:124 clear_excess_bits
  clear_excess_bits(): void {
    clear_excess_bits_in_final_word(this.domain_size_, this.words);
  }

  /// Count the number of set bits in the set.
  // rustc: compiler/rustc_index/src/bit_set.rs:129 count
  count(): number {
    return count_ones(this.words);
  }

  /// Returns `true` if this bitset contains `value`.
  ///
  /// # Panics
  /// If `value` is outside this bitset's domain.
  ///
  /// # See also
  /// To allow out-of-domain values without panicking, use [`DenseBitSet::contains_loose`]
  /// instead.
  // rustc: compiler/rustc_index/src/bit_set.rs:151 contains
  contains(value: T): boolean {
    assert(value < this.domain_size_, "assertion failed: value.index() < self.domain_size");
    const [word_index, mask] = word_index_and_mask(value);
    return (this.words[word_index]! & mask) !== 0n;
  }

  /// Is the set empty?
  // rustc: compiler/rustc_index/src/bit_set.rs:166 is_empty
  is_empty(): boolean {
    return this.words.every((a) => a === 0n);
  }

  /// Insert `elem`. Returns whether the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:172 insert
  insert(value: T): boolean {
    assert(value < this.domain_size_, `inserting element at index ${value} but domain size is ${this.domain_size_}`);
    return insert(this.words, value);
  }

  /// Returns `true` if the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:243 remove
  remove(elem: T): boolean {
    assert(elem < this.domain_size_, "assertion failed: elem.index() < self.domain_size");
    const [word_index, mask] = word_index_and_mask(elem);
    const word = this.words[word_index]!;
    const new_word = word & ~mask & WORD_ALL_ONES;
    this.words[word_index] = new_word;
    return new_word !== word;
  }

  /// Iterates over the indices of set bits in a sorted order.
  // rustc: compiler/rustc_index/src/bit_set.rs:255 iter
  iter(): BitIter<T> {
    return BitIter.new<T>(this.words);
  }
}

// rustc-type: compiler/rustc_index/src/bit_set.rs:395 BitIter
export class BitIter<T extends number> implements IterableIterator<T> {
  constructor(
    /// A copy of the current word, but with any already-visited bits cleared.
    /// (This lets us use `trailing_zeros()` to find the next set bit.) When it
    /// is reduced to 0, we move onto the next word.
    public word: Word,
    /// The offset (measured in bits) of the current word.
    public offset: number,
    /// Underlying iterator over the words.
    public iter_: Iterator<Word>,
  ) {}

  // rustc: compiler/rustc_index/src/bit_set.rs:412 new
  static new<T extends number>(words: readonly Word[]): BitIter<T> {
    // We initialize `word` and `offset` to degenerate values. On the first
    // call to `next()` we will fall through to getting the first word from
    // `iter`, which sets `word` to the first word (if there is one) and
    // `offset` to 0. Doing it this way saves us from having to maintain
    // additional state about whether we have started.
    // PORT: `usize::MAX - (WORD_BITS - 1)` wraps to 0 on the first `wrapping_add(WORD_BITS)`;
    // `-WORD_BITS` gives the same sequence of offsets.
    return new BitIter<T>(0n, -WORD_BITS, words[Symbol.iterator]());
  }

  // impl<'a, T: Idx> Iterator for BitIter<'a, T>
  // rustc: compiler/rustc_index/src/bit_set.rs:429 next
  next(): IteratorResult<T> {
    for (;;) {
      if (this.word !== 0n) {
        // Get the position of the next set bit in the current word,
        // then clear the bit.
        const bit_pos = trailing_zeros(this.word);
        this.word ^= 1n << BigInt(bit_pos);
        return { done: false, value: (bit_pos + this.offset) as T };
      }

      // Move onto the next word. `wrapping_add()` is needed to handle
      // the degenerate initial value given to `offset` in `new()`.
      const n = this.iter_.next();
      if (n.done) return { done: true, value: undefined };
      this.word = n.value;
      this.offset = this.offset + WORD_BITS;
    }
  }

  [Symbol.iterator](): BitIter<T> {
    return this;
  }
}

/** `u64::trailing_zeros` of a nonzero word. */
function trailing_zeros(word: Word): number {
  let n = 0;
  while ((word & 1n) === 0n) {
    word >>= 1n;
    n += 1;
  }
  return n;
}

/** `u64::count_ones`. */
function word_count_ones(word: Word): number {
  let n = 0;
  while (word !== 0n) {
    word &= word - 1n;
    n += 1;
  }
  return n;
}

// rustc: compiler/rustc_index/src/bit_set.rs:1594 num_words
function num_words(domain_size: number): number {
  return Math.ceil(domain_size / WORD_BITS);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1599 word_index_and_mask
function word_index_and_mask(elem: number): [number, Word] {
  const word_index = Math.floor(elem / WORD_BITS);
  const mask = 1n << BigInt(elem % WORD_BITS);
  return [word_index, mask];
}

// rustc: compiler/rustc_index/src/bit_set.rs:1617 clear_excess_bits_in_final_word
function clear_excess_bits_in_final_word(domain_size: number, words: Word[]): void {
  const num_bits_in_final_word = domain_size % WORD_BITS;
  if (num_bits_in_final_word > 0) {
    const mask = (1n << BigInt(num_bits_in_final_word)) - 1n;
    words[words.length - 1] = words[words.length - 1]! & mask;
  }
}

// rustc: compiler/rustc_index/src/bit_set.rs:1631 count_ones
function count_ones(words: readonly Word[]): number {
  return words.reduce((sum, word) => sum + word_count_ones(word), 0);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1636 insert
function insert(words: Word[], value: number): boolean {
  const [word_index, mask] = word_index_and_mask(value);
  const word = words[word_index]!;
  const new_word = word | mask;
  words[word_index] = new_word;
  return new_word !== word;
}
