// Port of compiler/rustc_index/src/bit_set.rs (`DenseBitSet`/`BitIter` by lane res-macros, `update_words`/`BitMatrix`
// by lane rds-graph; the rest and the 32-bit word switch by lane index-ds).
//
// PORT (plan-m4 D6): `type Word = u64` is a 32-bit `number` here, stored in `Uint32Array`s (`WORD_BITS = 32`), and
// `CHUNK_WORDS` is doubled (64), so `CHUNK_BITS` (2048) and every bit-level threshold (`MixedBitSet::new_empty`'s
// `CHUNK_BITS`, chunk domain sizes, `ChunkSize`) are upstream's. Element-level behaviour (iteration order, `count`,
// `contains`, `Debug` of elements, the `changed` results) does not depend on the word width. Where upstream exposes the
// u64 words themselves, the result is made identical to u64 words: a u64 word `k` is the pair `(words[2k],
// words[2k+1])` (low half first; a missing high half of an odd final pair is 0, like upstream's excess bits):
//   - `impl Hash for DenseBitSet` / `BitMatrix` (`hash_DenseBitSet`, `hash_BitMatrix`; StableHash goes through them):
//     the length prefix counts u64 words and the bytes are the little-endian bytes of the u64 words (per row for
//     `BitMatrix`, whose rows are padded to whole u64 words);
//   - `ToString for DenseBitSet` (bytes grouped by u64 word);
//   - `#[derive(Debug)]` of `GrowableBitSet` (`words: [..u64..]`) and of `Chunk` (`words: [..32 u64..]`);
//   - `#[derive(PartialEq)]` of `GrowableBitSet` (compares the u64 word vectors);
//   - `Decodable` of `DenseBitSet` (crate metadata holds u64 words: `DenseBitSet::from_u64_words`) and of `BitMatrix`
//     (`BitMatrix::from_u64_words`, for when it is decoded);
//   - `BitMatrix::words()` returns the u32 words (no caller outside this file upstream).
// `Word` values are kept as uint32 in storage; bitwise temporaries are int32 and compared with `>>> 0` where the sign
// matters. `T: Idx` is a number-like index (`usize` or a branded handle); `T::new(i)` / `value.index()` are the
// identity. `Rc<[Word; CHUNK_WORDS]>` is a `Uint32Array` that is copied on write once it may be shared (`rc_clone`
// marks it, `rc_make_mut` copies a marked array), which is `Rc::make_mut`'s observable behaviour.
import { type Debug, debug_int, debug_list, debug_set, debug_struct, debug_tuple, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unreachable } from "../std/panic.ts";
import type { Hasher } from "../vendor/rustc_stable_hash/stable_hasher.ts";
import type { RangeBounds } from "./idx.ts";
import { IndexSlice } from "./slice.ts";
import { IndexVec } from "./vec.ts";

type Word = number;
const WORD_BYTES = 4;
const WORD_BITS = WORD_BYTES * 8;
/** `!0` as a `Word`. */
const WORD_ALL_ONES: Word = 0xffff_ffff;

/** PORT (D6): upstream's word width, for the places where u64 words are observable. */
const U64_WORD_BYTES = 8;

// The choice of chunk size has some trade-offs.
//
// A big chunk size tends to favour cases where many large `ChunkedBitSet`s are
// present, because they require fewer `Chunk`s, reducing the number of
// allocations and reducing peak memory usage. Also, fewer chunk operations are
// required, though more of them might be `Mixed`.
//
// A small chunk size tends to favour cases where many small `ChunkedBitSet`s
// are present, because less space is wasted at the end of the final chunk (if
// it's not full).
// PORT (D6): 64 u32 words = upstream's 32 u64 words.
const CHUNK_WORDS = 64;
export const CHUNK_BITS = CHUNK_WORDS * WORD_BITS; // 2048 bits

/// ChunkSize is small to keep `Chunk` small. The static assertion ensures it's
/// not too small.
// type ChunkSize = u16;
// const _: () = assert!(CHUNK_BITS <= ChunkSize::MAX as usize);

// rustc: compiler/rustc_index/src/bit_set.rs:38 inclusive_start_end
function inclusive_start_end(range: RangeBounds<number>, domain: number): [number, number] | undefined {
  // Both start and end are inclusive.
  const sb = range.start_bound;
  let start: number;
  switch (sb.$) {
    case "Included":
      start = sb._0;
      break;
    case "Excluded":
      start = sb._0 + 1;
      break;
    case "Unbounded":
      start = 0;
      break;
  }
  const eb = range.end_bound;
  let end: number;
  switch (eb.$) {
    case "Included":
      end = eb._0;
      break;
    case "Excluded":
      // `end.index().checked_sub(1)?`
      if (eb._0 === 0) return undefined;
      end = eb._0 - 1;
      break;
    case "Unbounded":
      // PORT: `domain - 1` wraps to `usize::MAX` for an empty domain (overflow checks are off), failing the `assert!`.
      end = domain === 0 ? Number.MAX_SAFE_INTEGER : domain - 1;
      break;
  }
  assert(end < domain, "assertion failed: end < domain");
  if (start > end) {
    return undefined;
  }
  return [start, end];
}

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
export class DenseBitSet<T extends number = number> {
  /** `marker: PhantomData<T>` (erased). */
  declare readonly __t?: T;

  constructor(
    public domain_size_: number,
    public words: Uint32Array,
  ) {}

  /** PORT (D6): `Decodable for DenseBitSet` reads upstream's u64 words; each becomes two u32 words. */
  static from_u64_words<T extends number = number>(domain_size: number, words64: readonly bigint[]): DenseBitSet<T> {
    const words = new Uint32Array(num_words(domain_size));
    words_from_u64(words64, words);
    return new DenseBitSet<T>(domain_size, words);
  }

  /** PORT (D6, lane encode-contract): `Encodable for DenseBitSet` writes upstream's u64 words: the inverse of `from_u64_words`. */
  to_u64_words(): bigint[] {
    return words_to_u64(this.words);
  }

  /// Gets the domain size.
  // rustc: compiler/rustc_index/src/bit_set.rs:87 domain_size
  domain_size(): number {
    return this.domain_size_;
  }

  /// Creates a new, empty bitset with a given `domain_size`.
  // rustc: compiler/rustc_index/src/bit_set.rs:95 new_empty
  static new_empty<T extends number>(domain_size: number): DenseBitSet<T> {
    const num_words_ = num_words(domain_size);
    return new DenseBitSet<T>(domain_size, new Uint32Array(num_words_));
  }

  /// Creates a new, filled bitset with a given `domain_size`.
  // rustc: compiler/rustc_index/src/bit_set.rs:106 new_filled
  static new_filled<T extends number>(domain_size: number): DenseBitSet<T> {
    const num_words_ = num_words(domain_size);
    const result = new DenseBitSet<T>(domain_size, new Uint32Array(num_words_).fill(WORD_ALL_ONES));
    result.clear_excess_bits();
    return result;
  }

  /// Clear all elements.
  // rustc: compiler/rustc_index/src/bit_set.rs:119 clear
  clear(): void {
    this.words.fill(0);
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
  /// Unlike [`DenseBitSet::contains`], this method does not panic if the value
  /// is outside this bitset's domain, and simply returns `false` instead.
  // rustc: compiler/rustc_index/src/bit_set.rs:138 contains_loose
  contains_loose(value: T): boolean {
    return value < this.domain_size_ && this.contains(value);
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
    return (this.words[word_index]! & mask) !== 0;
  }

  /// Is `self` is a (non-strict) superset of `other`?
  // rustc: compiler/rustc_index/src/bit_set.rs:159 superset
  superset(other: DenseBitSet<T>): boolean {
    assert_eq(this.domain_size_, other.domain_size_, String);
    const n = Math.min(this.words.length, other.words.length);
    for (let i = 0; i < n; i++) {
      const a = this.words[i]!;
      const b = other.words[i]!;
      if ((a & b) >>> 0 !== b) return false;
    }
    return true;
  }

  /// Is the set empty?
  // rustc: compiler/rustc_index/src/bit_set.rs:166 is_empty
  is_empty(): boolean {
    return this.words.every((a) => a === 0);
  }

  /// Insert `elem`. Returns whether the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:172 insert
  insert(value: T): boolean {
    assert(value < this.domain_size_, `inserting element at index ${value} but domain size is ${this.domain_size_}`);
    return insert(this.words, value);
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:183 insert_range
  insert_range(elems: RangeBounds<T>): void {
    const r = inclusive_start_end(elems, this.domain_size_);
    if (r === undefined) {
      return;
    }
    const [start, end] = r;

    const [start_word_index, start_mask] = word_index_and_mask(start);
    const [end_word_index, end_mask] = word_index_and_mask(end);

    // Set all words in between start and end (exclusively of both).
    for (let word_index = start_word_index + 1; word_index < end_word_index; word_index++) {
      this.words[word_index] = WORD_ALL_ONES;
    }

    if (start_word_index !== end_word_index) {
      // Start and end are in different words, so we handle each in turn.
      //
      // We set all leading bits. This includes the start_mask bit.
      this.words[start_word_index] |= ~(start_mask - 1);
      // And all trailing bits (i.e. from 0..=end) in the end word,
      // including the end.
      this.words[end_word_index] |= end_mask | (end_mask - 1);
    } else {
      this.words[start_word_index] |= end_mask | (end_mask - start_mask);
    }
  }

  /// Sets all bits to true.
  // rustc: compiler/rustc_index/src/bit_set.rs:210 insert_all
  insert_all(): void {
    this.words.fill(WORD_ALL_ONES);
    this.clear_excess_bits();
  }

  /// Checks whether any bit in the given range is a 1.
  // rustc: compiler/rustc_index/src/bit_set.rs:217 contains_any
  contains_any(elems: RangeBounds<T>): boolean {
    const r = inclusive_start_end(elems, this.domain_size_);
    if (r === undefined) {
      return false;
    }
    const [start, end] = r;
    const [start_word_index, start_mask] = word_index_and_mask(start);
    const [end_word_index, end_mask] = word_index_and_mask(end);

    if (start_word_index === end_word_index) {
      return (this.words[start_word_index]! & (end_mask | (end_mask - start_mask))) !== 0;
    } else {
      if ((this.words[start_word_index]! & ~(start_mask - 1)) !== 0) {
        return true;
      }

      const remaining_start = start_word_index + 1;
      const remaining_end = end_word_index;
      if (remaining_start <= remaining_end) {
        for (let i = remaining_start; i < remaining_end; i++) {
          if (this.words[i] !== 0) return true;
        }
        return (this.words[end_word_index]! & (end_mask | (end_mask - 1))) !== 0;
      } else {
        return false;
      }
    }
  }

  /// Returns `true` if the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:243 remove
  remove(elem: T): boolean {
    assert(elem < this.domain_size_, "assertion failed: elem.index() < self.domain_size");
    const [word_index, mask] = word_index_and_mask(elem);
    const word = this.words[word_index]!;
    const new_word = (word & ~mask) >>> 0;
    this.words[word_index] = new_word;
    return new_word !== word;
  }

  /// Iterates over the indices of set bits in a sorted order.
  // rustc: compiler/rustc_index/src/bit_set.rs:255 iter
  iter(): BitIter<T> {
    return BitIter.new<T>(this.words);
  }

  /// Finds the first set bit at or after `elem`, if there is one.
  // rustc: compiler/rustc_index/src/bit_set.rs:260 first_set_at_or_after
  first_set_at_or_after(elem: T): T | undefined {
    assert(elem < this.domain_size_, "assertion failed: elem.index() < self.domain_size");
    let [word_index, mask] = word_index_and_mask(elem);
    // Mask out all bits below `elem`.
    let word = this.words[word_index]! & ~(mask - 1);
    for (;;) {
      if (word !== 0) {
        return (WORD_BITS * word_index + trailing_zeros(word)) as T;
      }
      word_index += 1;
      if (word_index >= this.words.length) return undefined;
      word = this.words[word_index]!;
    }
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:274 last_set_in
  last_set_in(range: RangeBounds<T>): T | undefined {
    const r = inclusive_start_end(range, this.domain_size_);
    if (r === undefined) return undefined;
    const [start, end] = r;
    const [start_word_index] = word_index_and_mask(start);
    const [end_word_index, end_mask] = word_index_and_mask(end);

    const end_word = this.words[end_word_index]! & (end_mask | (end_mask - 1));
    if (end_word !== 0) {
      const pos = max_bit(end_word) + WORD_BITS * end_word_index;
      if (start <= pos) {
        return pos as T;
      }
    }

    // We exclude end_word_index from the range here, because we don't want
    // to limit ourselves to *just* the last word: the bits set it in may be
    // after `end`, so it may not work out.
    // `self.words[start_word_index..end_word_index].iter().rposition(|&w| w != 0)`
    for (let word_idx = end_word_index - 1; word_idx >= start_word_index; word_idx--) {
      if (this.words[word_idx] !== 0) {
        const start_word = this.words[word_idx]!;
        const pos = max_bit(start_word) + WORD_BITS * word_idx;
        if (start <= pos) {
          return pos as T;
        }
        break;
      }
    }

    return undefined;
  }

  /// Sets `self = self | !other`.
  // rustc: compiler/rustc_index/src/bit_set.rs:305 union_not
  union_not(other: DenseBitSet<T>): void {
    assert_eq(this.domain_size_, other.domain_size_, String);

    // FIXME(Zalathar): If we were to forcibly _set_ all excess bits before
    // the bitwise update, and then clear them again afterwards, we could
    // quickly and accurately detect whether the update changed anything.
    // But that's only worth doing if there's an actual use-case.

    update_words(this.words, other.words, (a, b) => a | ~b);
    // The bitwise update `a | !b` can result in the last word containing
    // out-of-domain bits, so we need to clear them.
    this.clear_excess_bits();
  }

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:320 union
  union(other: DenseBitSet<T>): boolean {
    assert_eq(this.domain_size_, other.domain_size_, String);
    return update_words(this.words, other.words, (a, b) => a | b);
  }

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:326 subtract
  subtract(other: DenseBitSet<T>): boolean {
    assert_eq(this.domain_size_, other.domain_size_, String);
    return update_words(this.words, other.words, (a, b) => a & ~b);
  }

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:332 intersect
  intersect(other: DenseBitSet<T>): boolean {
    assert_eq(this.domain_size_, other.domain_size_, String);
    return update_words(this.words, other.words, (a, b) => a & b);
  }

  // impl<T> Clone for DenseBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:339 clone
  clone(): DenseBitSet<T> {
    return new DenseBitSet<T>(this.domain_size_, this.words.slice());
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:347 clone_from
  clone_from(from: DenseBitSet<T>): void {
    this.domain_size_ = from.domain_size_;
    // `Box<[Word]>::clone_from`: copies in place when the lengths agree.
    if (this.words.length === from.words.length) {
      this.words.set(from.words);
    } else {
      this.words = from.words.slice();
    }
  }

  // impl<T: Idx> ToString for DenseBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:360 to_string
  to_string(): string {
    let result = "";
    let sep = "[";

    // Note: this is a little endian printout of bytes.

    // PORT (D6): upstream walks its u64 words; u64 word `k` is the u32 pair `(words[2k], words[2k+1])`.
    const num_u64_words = Math.ceil(this.words.length / 2);

    // i tracks how many bits we have printed so far.
    let i = 0;
    for (let k = 0; k < num_u64_words; k++) {
      for (let b = 0; b < U64_WORD_BYTES; b++) {
        // for each byte in `word`:
        const remain = this.domain_size_ - i;
        // If less than a byte remains, then mask just that many bits.
        const mask = remain <= 8 ? (1 << remain) - 1 : 0xff;
        assert(mask <= 0xff, "assertion failed: mask <= 0xFF");
        // `word >>= 8` after each byte: byte `b` of the u64 word.
        const word_byte = ((this.words[2 * k + (b >> 2)] ?? 0) >>> (8 * (b & 3))) & 0xff;
        const byte = word_byte & mask;

        result += `${sep}${byte.toString(16).padStart(2, "0")}`;

        if (remain <= 8) {
          break;
        }
        i += 8;
        sep = "-";
      }
      sep = "|";
    }
    result += "]";

    return result;
  }
}

// `#[derive(PartialEq)]`: equal domain sizes and words (equal domain sizes give equal word counts in either width).
export function DenseBitSet_eq<T extends number>(a: DenseBitSet<T>, b: DenseBitSet<T>): boolean {
  return a.domain_size_ === b.domain_size_ && words_eq(a.words, b.words);
}

// impl<T: Idx> fmt::Debug for DenseBitSet<T>
// rustc: compiler/rustc_index/src/bit_set.rs:354 fmt
export function debug_DenseBitSet<T extends number>(self: DenseBitSet<T>, w: Fmt, debug_T: Debug<T> = debug_int): string {
  const items: string[] = [];
  for (const v of self.iter()) items.push(debug_T(v, w));
  return debug_list(w, items);
}

/**
 * `#[derive(Hash)]` of `DenseBitSet` (`domain_size`, then `words: Box<[u64]>`, `marker: PhantomData` hashes nothing).
 * PORT (D6): hashes upstream's u64 words (see the file header).
 */
export function hash_DenseBitSet<T extends number>(self: DenseBitSet<T>, state: Hasher): void {
  state.write_usize(self.domain_size_);
  hash_u64_word_slice(self.words, state);
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
    /// Underlying iterator over the words. PORT: `slice::Iter<Word>` is the slice and the position of the next word.
    public iter_: Uint32Array,
    public iter_pos: number,
  ) {}

  // rustc: compiler/rustc_index/src/bit_set.rs:412 new
  static new<T extends number>(words: Uint32Array): BitIter<T> {
    // We initialize `word` and `offset` to degenerate values. On the first
    // call to `next()` we will fall through to getting the first word from
    // `iter`, which sets `word` to the first word (if there is one) and
    // `offset` to 0. Doing it this way saves us from having to maintain
    // additional state about whether we have started.
    // PORT: `usize::MAX - (WORD_BITS - 1)` wraps to 0 on the first `wrapping_add(WORD_BITS)`;
    // `-WORD_BITS` gives the same sequence of offsets.
    return new BitIter<T>(0, -WORD_BITS, words, 0);
  }

  // impl<'a, T: Idx> Iterator for BitIter<'a, T>
  // rustc: compiler/rustc_index/src/bit_set.rs:429 next
  next(): IteratorResult<T> {
    for (;;) {
      if (this.word !== 0) {
        // Get the position of the next set bit in the current word,
        // then clear the bit.
        const bit_pos = trailing_zeros(this.word);
        this.word ^= 1 << bit_pos;
        return { done: false, value: (bit_pos + this.offset) as T };
      }

      // Move onto the next word. `wrapping_add()` is needed to handle
      // the degenerate initial value given to `offset` in `new()`.
      if (this.iter_pos >= this.iter_.length) return { done: true, value: undefined };
      this.word = this.iter_[this.iter_pos++]!;
      this.offset = this.offset + WORD_BITS;
    }
  }

  [Symbol.iterator](): BitIter<T> {
    return this;
  }
}

/// A fixed-size bitset type with a partially dense, partially sparse
/// representation. The bitset is broken into chunks, and chunks that are all
/// zeros or all ones are represented and handled very efficiently.
///
/// This type is especially efficient for sets that typically have a large
/// `domain_size` with significant stretches of all zeros or all ones, and also
/// some stretches with lots of 0s and 1s mixed in a way that causes trouble
/// for `IntervalSet`.
///
/// Best used via `MixedBitSet`, rather than directly, because `MixedBitSet`
/// has better performance for small bitsets.
///
/// `T` is an index type, typically a newtyped `usize` wrapper, but it can also
/// just be `usize`.
///
/// All operations that involve an element will panic if the element is equal
/// to or greater than the domain size. All operations that involve two bitsets
/// will panic if the bitsets have differing domain sizes.
// rustc-type: compiler/rustc_index/src/bit_set.rs:466 ChunkedBitSet
export class ChunkedBitSet<T extends number = number> {
  /** `marker: PhantomData<T>` (erased). */
  declare readonly __t?: T;

  constructor(
    public domain_size_: number,
    /// The chunks. Each one contains exactly CHUNK_BITS values, except the
    /// last one which contains 1..=CHUNK_BITS values.
    public chunks_: Chunk[],
  ) {}

  // rustc: compiler/rustc_index/src/bit_set.rs:519 domain_size
  domain_size(): number {
    return this.domain_size_;
  }

  // #[cfg(test)]
  // rustc: compiler/rustc_index/src/bit_set.rs:524 assert_valid
  assert_valid(): void {
    if (this.domain_size_ === 0) {
      assert(this.chunks_.length === 0, "assertion failed: self.chunks.is_empty()");
      return;
    }

    assert((this.chunks_.length - 1) * CHUNK_BITS <= this.domain_size_, "assertion failed: (self.chunks.len() - 1) * CHUNK_BITS <= self.domain_size");
    assert(this.chunks_.length * CHUNK_BITS >= this.domain_size_, "assertion failed: self.chunks.len() * CHUNK_BITS >= self.domain_size");
    for (const chunk of this.chunks_) {
      Chunk.assert_valid(chunk);
    }
  }

  /// Creates a new bitset with a given `domain_size` and chunk kind.
  // rustc: compiler/rustc_index/src/bit_set.rs:540 new
  static new<T extends number>(domain_size: number, is_empty: boolean): ChunkedBitSet<T> {
    let chunks: Chunk[];
    if (domain_size === 0) {
      chunks = [];
    } else {
      const num_chunks = Math.ceil(domain_size / CHUNK_BITS);
      let last_chunk_domain_size = domain_size % CHUNK_BITS;
      if (last_chunk_domain_size === 0) {
        last_chunk_domain_size = CHUNK_BITS;
      }

      // All the chunks are the same except the last one which might have a different
      // `chunk_domain_size`.
      const kind = is_empty ? "Zeros" : "Ones";
      chunks = new Array<Chunk>(num_chunks);
      for (let i = 0; i < num_chunks - 1; i++) chunks[i] = { $: kind, chunk_domain_size: CHUNK_BITS };
      chunks[num_chunks - 1] = { $: kind, chunk_domain_size: last_chunk_domain_size };
    }
    return new ChunkedBitSet<T>(domain_size, chunks);
  }

  /// Creates a new, empty bitset with a given `domain_size`.
  // rustc: compiler/rustc_index/src/bit_set.rs:572 new_empty
  static new_empty<T extends number>(domain_size: number): ChunkedBitSet<T> {
    return ChunkedBitSet.new<T>(domain_size, /* is_empty */ true);
  }

  /// Creates a new, filled bitset with a given `domain_size`.
  // rustc: compiler/rustc_index/src/bit_set.rs:578 new_filled
  static new_filled<T extends number>(domain_size: number): ChunkedBitSet<T> {
    return ChunkedBitSet.new<T>(domain_size, /* is_empty */ false);
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:582 clear
  clear(): void {
    // Not the most efficient implementation, but this function isn't hot.
    const fresh = ChunkedBitSet.new_empty<T>(this.domain_size_);
    this.domain_size_ = fresh.domain_size_;
    this.chunks_ = fresh.chunks_;
  }

  // #[cfg(test)]
  // rustc: compiler/rustc_index/src/bit_set.rs:588 chunks
  chunks(): readonly Chunk[] {
    return this.chunks_;
  }

  /// Count the number of bits in the set.
  // rustc: compiler/rustc_index/src/bit_set.rs:593 count
  count(): number {
    let sum = 0;
    for (const chunk of this.chunks_) sum += Chunk.count(chunk);
    return sum;
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:597 is_empty
  is_empty(): boolean {
    return this.chunks_.every((chunk) => chunk.$ === "Zeros");
  }

  /// Returns `true` if `self` contains `elem`.
  // rustc: compiler/rustc_index/src/bit_set.rs:603 contains
  contains(elem: T): boolean {
    assert(elem < this.domain_size_, "assertion failed: elem.index() < self.domain_size");
    const chunk = this.chunks_[chunk_index(elem)]!;
    switch (chunk.$) {
      case "Zeros":
        return false;
      case "Ones":
        return true;
      case "Mixed": {
        const [word_index, mask] = chunk_word_index_and_mask(elem);
        return (chunk.words[word_index]! & mask) !== 0;
      }
    }
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:617 iter
  iter(): ChunkedBitIter<T> {
    return ChunkedBitIter.new(this);
  }

  /// Insert `elem`. Returns whether the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:622 insert
  insert(elem: T): boolean {
    assert(elem < this.domain_size_, "assertion failed: elem.index() < self.domain_size");
    const chunk_index_ = chunk_index(elem);
    const chunk = this.chunks_[chunk_index_]!;
    switch (chunk.$) {
      case "Zeros": {
        const chunk_domain_size = chunk.chunk_domain_size;
        if (chunk_domain_size > 1) {
          // We take some effort to avoid copying the words.
          const words = new Uint32Array(CHUNK_WORDS);

          const [word_index, mask] = chunk_word_index_and_mask(elem);
          words[word_index] |= mask;
          this.chunks_[chunk_index_] = { $: "Mixed", chunk_domain_size, ones_count: 1, words };
        } else {
          this.chunks_[chunk_index_] = { $: "Ones", chunk_domain_size };
        }
        return true;
      }
      case "Ones":
        return false;
      case "Mixed": {
        const chunk_domain_size = chunk.chunk_domain_size;
        // We skip all the work if the bit is already set.
        const [word_index, mask] = chunk_word_index_and_mask(elem);
        if ((chunk.words[word_index]! & mask) === 0) {
          chunk.ones_count += 1;
          if (chunk.ones_count < chunk_domain_size) {
            const words = rc_make_mut(chunk);
            words[word_index] |= mask;
          } else {
            this.chunks_[chunk_index_] = { $: "Ones", chunk_domain_size };
          }
          return true;
        } else {
          return false;
        }
      }
    }
  }

  /// Sets all bits to true.
  // rustc: compiler/rustc_index/src/bit_set.rs:666 insert_all
  insert_all(): void {
    // Not the most efficient implementation, but this function isn't hot.
    const fresh = ChunkedBitSet.new_filled<T>(this.domain_size_);
    this.domain_size_ = fresh.domain_size_;
    this.chunks_ = fresh.chunks_;
  }

  /// Returns `true` if the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:672 remove
  remove(elem: T): boolean {
    assert(elem < this.domain_size_, "assertion failed: elem.index() < self.domain_size");
    const chunk_index_ = chunk_index(elem);
    const chunk = this.chunks_[chunk_index_]!;
    switch (chunk.$) {
      case "Zeros":
        return false;
      case "Ones": {
        const chunk_domain_size = chunk.chunk_domain_size;
        if (chunk_domain_size > 1) {
          // We take some effort to avoid copying the words.
          const words = new Uint32Array(CHUNK_WORDS);

          // Set only the bits in use.
          const num_words_ = num_words(chunk_domain_size);
          words.fill(WORD_ALL_ONES, 0, num_words_);
          clear_excess_bits_in_final_word(chunk_domain_size, words.subarray(0, num_words_));
          const [word_index, mask] = chunk_word_index_and_mask(elem);
          words[word_index] &= ~mask;
          this.chunks_[chunk_index_] = { $: "Mixed", chunk_domain_size, ones_count: chunk_domain_size - 1, words };
        } else {
          this.chunks_[chunk_index_] = { $: "Zeros", chunk_domain_size };
        }
        return true;
      }
      case "Mixed": {
        const chunk_domain_size = chunk.chunk_domain_size;
        // We skip all the work if the bit is already clear.
        const [word_index, mask] = chunk_word_index_and_mask(elem);
        if ((chunk.words[word_index]! & mask) !== 0) {
          chunk.ones_count -= 1;
          if (chunk.ones_count > 0) {
            const words = rc_make_mut(chunk);
            words[word_index] &= ~mask;
          } else {
            this.chunks_[chunk_index_] = { $: "Zeros", chunk_domain_size };
          }
          return true;
        } else {
          return false;
        }
      }
    }
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:722 chunk_iter
  chunk_iter(chunk_index: number): ChunkIter {
    const chunk = this.chunks_[chunk_index];
    if (chunk === undefined) return ChunkIter.Finished;
    switch (chunk.$) {
      case "Zeros":
        return ChunkIter.Zeros;
      case "Ones":
        return { $: "Ones", _0: { start: 0, end: chunk.chunk_domain_size } };
      case "Mixed": {
        const num_words_ = num_words(chunk.chunk_domain_size);
        return { $: "Mixed", _0: BitIter.new<number>(chunk.words.subarray(0, num_words_)) };
      }
    }
  }

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:735 union
  union(other: ChunkedBitSet<T>): boolean {
    assert_eq(this.domain_size_, other.domain_size_, String);

    let changed = false;
    const n = Math.min(this.chunks_.length, other.chunks_.length);
    for (let i = 0; i < n; i++) {
      const self_chunk = this.chunks_[i]!;
      const other_chunk = other.chunks_[i]!;
      if (other_chunk.$ === "Zeros" || self_chunk.$ === "Ones") {
        // (_, Zeros { .. }) | (Ones { .. }, _) => {}
      } else if (self_chunk.$ === "Zeros" || (self_chunk.$ === "Mixed" && other_chunk.$ === "Ones")) {
        // `other_chunk` fully overwrites `self_chunk`
        this.chunks_[i] = Chunk.clone(other_chunk);
        changed = true;
      } else if (self_chunk.$ === "Mixed" && other_chunk.$ === "Mixed") {
        const chunk_domain_size = self_chunk.chunk_domain_size;
        // First check if the operation would change
        // `self_chunk.words`. If not, we can avoid allocating some
        // words, and this happens often enough that it's a
        // performance win. Also, we only need to operate on the
        // in-use words, hence the slicing.
        const num_words_ = num_words(chunk_domain_size);

        // If both sides are the same, nothing will change. This
        // case is very common and it's a pretty fast check, so
        // it's a performance win to do it.
        if (words_eq(self_chunk.words.subarray(0, num_words_), other_chunk.words.subarray(0, num_words_))) {
          continue;
        }

        // Do a more precise "will anything change?" test. Also a
        // performance win.
        const op = (a: Word, b: Word): Word => a | b;
        if (!would_modify_words(self_chunk.words.subarray(0, num_words_), other_chunk.words.subarray(0, num_words_), op)) {
          continue;
        }

        // If we reach here, `self_chunk_words` is definitely changing.
        const self_chunk_words = rc_make_mut(self_chunk);
        const has_changed = update_words(self_chunk_words.subarray(0, num_words_), other_chunk.words.subarray(0, num_words_), op);
        // debug_assert!(has_changed);
        void has_changed;
        self_chunk.ones_count = count_ones(self_chunk_words.subarray(0, num_words_));
        if (self_chunk.ones_count === chunk_domain_size) {
          this.chunks_[i] = { $: "Ones", chunk_domain_size };
        }
        changed = true;
      } else {
        unreachable();
      }
    }
    return changed;
  }

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:801 subtract
  subtract(other: ChunkedBitSet<T>): boolean {
    assert_eq(this.domain_size_, other.domain_size_, String);

    let changed = false;
    const n = Math.min(this.chunks_.length, other.chunks_.length);
    for (let i = 0; i < n; i++) {
      const self_chunk = this.chunks_[i]!;
      const other_chunk = other.chunks_[i]!;
      if (self_chunk.$ === "Zeros" || other_chunk.$ === "Zeros") {
        // (Zeros { .. }, _) | (_, Zeros { .. }) => {}
      } else if (other_chunk.$ === "Ones") {
        // (Ones { chunk_domain_size } | Mixed { chunk_domain_size, .. }, Ones { .. })
        changed = true;
        this.chunks_[i] = { $: "Zeros", chunk_domain_size: self_chunk.chunk_domain_size };
      } else if (self_chunk.$ === "Ones" && other_chunk.$ === "Mixed") {
        const chunk_domain_size = self_chunk.chunk_domain_size;
        changed = true;
        const num_words_ = num_words(chunk_domain_size);
        // debug_assert!(num_words > 0 && num_words <= CHUNK_WORDS);
        // Set `self_chunk_words` to `other_chunk_words`, then invert all bits and
        // clear any excess bits in the final word.
        const self_chunk_words = other_chunk.words.slice();
        for (let k = 0; k < num_words_; k++) {
          self_chunk_words[k] = ~self_chunk_words[k]!;
        }
        clear_excess_bits_in_final_word(chunk_domain_size, self_chunk_words.subarray(0, num_words_));
        const self_chunk_ones_count = chunk_domain_size - other_chunk.ones_count;
        // debug_assert_eq!(
        //     self_chunk_ones_count,
        //     count_ones(&self_chunk_words[0..num_words]) as ChunkSize
        // );
        this.chunks_[i] = {
          $: "Mixed",
          chunk_domain_size,
          ones_count: self_chunk_ones_count,
          words: self_chunk_words,
        };
      } else if (self_chunk.$ === "Mixed" && other_chunk.$ === "Mixed") {
        const chunk_domain_size = self_chunk.chunk_domain_size;
        // See `ChunkedBitSet::union` for details on what is happening here.
        const num_words_ = num_words(chunk_domain_size);
        const op = (a: Word, b: Word): Word => a & ~b;
        if (!would_modify_words(self_chunk.words.subarray(0, num_words_), other_chunk.words.subarray(0, num_words_), op)) {
          continue;
        }

        const self_chunk_words = rc_make_mut(self_chunk);
        const has_changed = update_words(self_chunk_words.subarray(0, num_words_), other_chunk.words.subarray(0, num_words_), op);
        // debug_assert!(has_changed);
        void has_changed;
        self_chunk.ones_count = count_ones(self_chunk_words.subarray(0, num_words_));
        if (self_chunk.ones_count === 0) {
          this.chunks_[i] = { $: "Zeros", chunk_domain_size };
        }
        changed = true;
      } else {
        unreachable();
      }
    }
    return changed;
  }

  // impl<T> Clone for ChunkedBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:880 clone
  clone(): ChunkedBitSet<T> {
    return new ChunkedBitSet<T>(this.domain_size_, this.chunks_.map(Chunk.clone));
  }

  /// WARNING: this implementation of clone_from will panic if the two
  /// bitsets have different domain sizes. This constraint is not inherent to
  /// `clone_from`, but it works with the existing call sites and allows a
  /// faster implementation, which is important because this function is hot.
  // rustc: compiler/rustc_index/src/bit_set.rs:892 clone_from
  clone_from(from: ChunkedBitSet<T>): void {
    assert_eq(this.domain_size_, from.domain_size_, String);
    // debug_assert_eq!(self.chunks.len(), from.chunks.len());

    // `Box<[Chunk]>::clone_from`: element-wise `clone_from` (`*self = source.clone()`) when the lengths agree.
    if (this.chunks_.length === from.chunks_.length) {
      for (let i = 0; i < from.chunks_.length; i++) this.chunks_[i] = Chunk.clone(from.chunks_[i]!);
    } else {
      this.chunks_ = from.chunks_.map(Chunk.clone);
    }
  }
}

// `#[derive(PartialEq)]` (`marker` compares equal).
export function ChunkedBitSet_eq<T extends number>(a: ChunkedBitSet<T>, b: ChunkedBitSet<T>): boolean {
  if (a.domain_size_ !== b.domain_size_ || a.chunks_.length !== b.chunks_.length) return false;
  for (let i = 0; i < a.chunks_.length; i++) {
    if (!Chunk_eq(a.chunks_[i]!, b.chunks_[i]!)) return false;
  }
  return true;
}

// rustc-type: compiler/rustc_index/src/bit_set.rs:900 ChunkedBitIter
export class ChunkedBitIter<T extends number> implements IterableIterator<T> {
  constructor(
    public bit_set: ChunkedBitSet<T>,
    // The index of the current chunk.
    public chunk_index: number,
    // The sub-iterator for the current chunk.
    public chunk_iter: ChunkIter,
  ) {}

  // rustc: compiler/rustc_index/src/bit_set.rs:912 new
  static new<T extends number>(bit_set: ChunkedBitSet<T>): ChunkedBitIter<T> {
    return new ChunkedBitIter<T>(bit_set, 0, bit_set.chunk_iter(0));
  }

  // impl<'a, T: Idx> Iterator for ChunkedBitIter<'a, T>
  // rustc: compiler/rustc_index/src/bit_set.rs:920 next
  next(): IteratorResult<T> {
    for (;;) {
      const chunk_iter = this.chunk_iter;
      switch (chunk_iter.$) {
        case "Zeros":
          break;
        case "Ones": {
          const iter = chunk_iter._0;
          if (iter.start < iter.end) {
            const next = iter.start++;
            return { done: false, value: (next + this.chunk_index * CHUNK_BITS) as T };
          }
          break;
        }
        case "Mixed": {
          const n = chunk_iter._0.next();
          if (!n.done) {
            return { done: false, value: (n.value + this.chunk_index * CHUNK_BITS) as T };
          }
          break;
        }
        case "Finished":
          return { done: true, value: undefined };
      }
      this.chunk_index += 1;
      this.chunk_iter = this.bit_set.chunk_iter(this.chunk_index);
    }
  }

  [Symbol.iterator](): ChunkedBitIter<T> {
    return this;
  }
}

// rustc-type: compiler/rustc_index/src/bit_set.rs:481 Chunk
export type Chunk =
  /// A chunk that is all zeros; we don't represent the zeros explicitly.
  | { readonly $: "Zeros"; readonly chunk_domain_size: number }
  /// A chunk that is all ones; we don't represent the ones explicitly.
  | { readonly $: "Ones"; readonly chunk_domain_size: number }
  /// A chunk that has a mix of zeros and ones, which are represented
  /// explicitly and densely. It never has all zeros or all ones.
  ///
  /// If this is the final chunk there may be excess, unused words. This
  /// turns out to be both simpler and have better performance than
  /// allocating the minimum number of words, largely because we avoid having
  /// to store the length, which would make this type larger. These excess
  /// words are always zero, as are any excess bits in the final in-use word.
  ///
  /// The words are within an `Rc` because it's surprisingly common to
  /// duplicate an entire chunk, e.g. in `ChunkedBitSet::clone_from()`, or
  /// when a `Mixed` chunk is union'd into a `Zeros` chunk. When we do need
  /// to modify a chunk we use `Rc::make_mut`.
  | {
      readonly $: "Mixed";
      readonly chunk_domain_size: number;
      /// Count of set bits (1s) in this chunk's words.
      ///
      /// Invariant: `0 < ones_count < chunk_domain_size`.
      ///
      /// Tracking this separately allows individual insert/remove calls to
      /// know that the chunk has become all-zeroes or all-ones, in O(1) time.
      ones_count: number;
      words: Uint32Array;
    };

/** `Mixed` words that may be shared by more than one chunk (an `Rc` with a strong count > 1). */
const SHARED_WORDS = new WeakSet<Uint32Array>();

/** `Rc::clone` of chunk words. */
function rc_clone(words: Uint32Array): Uint32Array {
  SHARED_WORDS.add(words);
  return words;
}

/** `Rc::make_mut(&mut chunk.words)`: copies the words first if they may be shared. */
function rc_make_mut(chunk: { words: Uint32Array }): Uint32Array {
  if (SHARED_WORDS.has(chunk.words)) {
    chunk.words = chunk.words.slice();
  }
  return chunk.words;
}

export const Chunk = {
  // #[cfg(test)]
  // rustc: compiler/rustc_index/src/bit_set.rs:944 assert_valid
  assert_valid(self: Chunk): void {
    switch (self.$) {
      case "Zeros":
      case "Ones":
        assert(self.chunk_domain_size <= CHUNK_BITS, "assertion failed: chunk_domain_size as usize <= CHUNK_BITS");
        break;
      case "Mixed": {
        const { chunk_domain_size, ones_count, words } = self;
        assert(chunk_domain_size <= CHUNK_BITS, "assertion failed: chunk_domain_size as usize <= CHUNK_BITS");
        assert(0 < ones_count && ones_count < chunk_domain_size, "assertion failed: 0 < ones_count && ones_count < chunk_domain_size");

        // Check the number of set bits matches `count`.
        assert_eq(count_ones(words), ones_count, String);

        // Check the not-in-use words are all zeroed.
        const num_words_ = num_words(chunk_domain_size);
        if (num_words_ < CHUNK_WORDS) {
          assert_eq(count_ones(words.subarray(num_words_)), 0, String);
        }
        break;
      }
    }
  },

  /// Count the number of 1s in the chunk.
  // rustc: compiler/rustc_index/src/bit_set.rs:966 count
  count(self: Chunk): number {
    switch (self.$) {
      case "Zeros":
        return 0;
      case "Ones":
        return self.chunk_domain_size;
      case "Mixed":
        return self.ones_count;
    }
  },

  /** `#[derive(Clone)]`: `Mixed` shares its `Rc` words. */
  clone(self: Chunk): Chunk {
    switch (self.$) {
      case "Zeros":
      case "Ones":
        return { $: self.$, chunk_domain_size: self.chunk_domain_size };
      case "Mixed":
        return { $: "Mixed", chunk_domain_size: self.chunk_domain_size, ones_count: self.ones_count, words: rc_clone(self.words) };
    }
  },
};

/** `#[derive(PartialEq)]` of `Chunk`. */
export function Chunk_eq(a: Chunk, b: Chunk): boolean {
  if (a.$ !== b.$ || a.chunk_domain_size !== b.chunk_domain_size) return false;
  if (a.$ === "Mixed" && b.$ === "Mixed") {
    return a.ones_count === b.ones_count && words_eq(a.words, b.words);
  }
  return true;
}

/**
 * `#[derive(Debug)]` of `Chunk`: `Zeros { chunk_domain_size: N }`, ..., `Mixed { chunk_domain_size, ones_count, words }`.
 * PORT (D6): `words` prints upstream's 32 u64 words.
 */
export const debug_Chunk: Debug<Chunk> = (v, f) => {
  switch (v.$) {
    case "Zeros":
    case "Ones":
      return debug_struct(f, v.$, [["chunk_domain_size", String(v.chunk_domain_size)]]);
    case "Mixed":
      return debug_struct(f, "Mixed", [
        ["chunk_domain_size", String(v.chunk_domain_size)],
        ["ones_count", String(v.ones_count)],
        [
          "words",
          debug_list(
            f,
            words_to_u64(v.words).map((w) => String(w)),
          ),
        ],
      ]);
  }
};

// rustc-type: compiler/rustc_index/src/bit_set.rs:975 ChunkIter
export type ChunkIter =
  | { readonly $: "Zeros" }
  /** `Ones(Range<usize>)`: the range is advanced in place. */
  | { readonly $: "Ones"; readonly _0: { start: number; end: number } }
  | { readonly $: "Mixed"; readonly _0: BitIter<number> }
  | { readonly $: "Finished" };
export const ChunkIter = {
  Zeros: Object.freeze({ $: "Zeros" }) as ChunkIter,
  Finished: Object.freeze({ $: "Finished" }) as ChunkIter,
};

// impl<T: Idx> fmt::Debug for ChunkedBitSet<T>
// rustc: compiler/rustc_index/src/bit_set.rs:983 fmt
export function debug_ChunkedBitSet<T extends number>(self: ChunkedBitSet<T>, w: Fmt, debug_T: Debug<T> = debug_int): string {
  const items: string[] = [];
  for (const v of self.iter()) items.push(debug_T(v, w));
  return debug_list(w, items);
}

/// Sets `lhs[i] = op(lhs[i], rhs[i])` for each index `i` in both
/// slices. The slices must have the same length.
///
/// Returns true if at least one bit in `lhs` was changed.
///
/// ## Warning
/// Some bitwise operations (e.g. union-not, xor) can set output bits that were
/// unset in in both inputs. If this happens in the last word/chunk of a bitset,
/// it can cause the bitset to contain out-of-domain values, which need to
/// be cleared with `clear_excess_bits_in_final_word`. This also makes the
/// "changed" return value unreliable, because the change might have only
/// affected excess bits.
// PORT: `lhs: &mut [Word]` sub-slices are `Uint32Array.subarray` views (writes go to the underlying words).
// rustc: compiler/rustc_index/src/bit_set.rs:1001 update_words
function update_words(lhs: Uint32Array, rhs: Uint32Array, op: (a: Word, b: Word) => Word): boolean {
  assert_eq(lhs.length, rhs.length, String);
  let changed = 0;
  for (let k = 0; k < lhs.length; k++) {
    const old_val = lhs[k]!;
    const new_val = op(old_val, rhs[k]!);
    lhs[k] = new_val;
    // This is essentially equivalent to a != with changed being a bool, but
    // in practice this code gets auto-vectorized by the compiler for most
    // operators. Using != here causes us to generate quite poor code as the
    // compiler tries to go back to a boolean on each loop iteration.
    changed |= old_val ^ new_val;
  }
  return changed !== 0;
}

/// Returns true if a call to [`update_words`] would modify `lhs`, i.e.
/// `lhs[i] != op(lhs[i], rhs[i])` for some `i`.
// rustc: compiler/rustc_index/src/bit_set.rs:1023 would_modify_words
function would_modify_words(lhs: Uint32Array, rhs: Uint32Array, op: (a: Word, b: Word) => Word): boolean {
  assert_eq(lhs.length, rhs.length, String);

  // To make codegen more vectorizer-friendly, we traverse each slice in larger
  // "subchunks", and only consider an early return at subchunk boundaries.
  // These subchunks are smaller than full `ChunkedBitSet` chunks, so that
  // we still have some chance of stopping early.
  // PORT (D6): 16 u32 words = upstream's 8 u64 words (64 bytes); only the early-return points depend on it.
  const SUBCHUNK_LEN = 64 / WORD_BYTES;
  const num_subchunks = Math.floor(lhs.length / SUBCHUNK_LEN);

  const would_modify_subchunk = (start: number, end: number): boolean => {
    let changed = 0;
    for (let k = start; k < end; k++) {
      const old_val = lhs[k]!;
      const new_val = op(old_val, rhs[k]!);
      // Set `changed` to a non-zero value if any bits changed.
      // This gives better SIMD codegen than using an actual boolean.
      changed |= old_val ^ new_val;
    }
    return changed !== 0;
  };

  for (let c = 0; c < num_subchunks; c++) {
    if (would_modify_subchunk(c * SUBCHUNK_LEN, (c + 1) * SUBCHUNK_LEN)) {
      return true;
    }
  }
  return would_modify_subchunk(num_subchunks * SUBCHUNK_LEN, lhs.length);
}

/// A bitset with a mixed representation, using `DenseBitSet` for small and
/// medium bitsets, and `ChunkedBitSet` for large bitsets, i.e. those with
/// enough bits for at least two chunks. This is a good choice for many bitsets
/// that can have large domain sizes (e.g. 5000+).
///
/// `T` is an index type, typically a newtyped `usize` wrapper, but it can also
/// just be `usize`.
///
/// All operations that involve an element will panic if the element is equal
/// to or greater than the domain size. All operations that involve two bitsets
/// will panic if the bitsets have differing domain sizes.
// rustc-type: compiler/rustc_index/src/bit_set.rs:1068 MixedBitSet
export type MixedBitSet<T extends number = number> =
  | { readonly $: "Small"; readonly _0: DenseBitSet<T> }
  | { readonly $: "Large"; readonly _0: ChunkedBitSet<T> };

export const MixedBitSet = {
  // rustc: compiler/rustc_index/src/bit_set.rs:1074 domain_size
  domain_size<T extends number>(self: MixedBitSet<T>): number {
    switch (self.$) {
      case "Small":
        return self._0.domain_size();
      case "Large":
        return self._0.domain_size();
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1084 new_empty
  new_empty<T extends number>(domain_size: number): MixedBitSet<T> {
    if (domain_size <= CHUNK_BITS) {
      return { $: "Small", _0: DenseBitSet.new_empty<T>(domain_size) };
    } else {
      return { $: "Large", _0: ChunkedBitSet.new_empty<T>(domain_size) };
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1093 is_empty
  is_empty<T extends number>(self: MixedBitSet<T>): boolean {
    switch (self.$) {
      case "Small":
        return self._0.is_empty();
      case "Large":
        return self._0.is_empty();
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1101 contains
  contains<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    switch (self.$) {
      case "Small":
        return self._0.contains(elem);
      case "Large":
        return self._0.contains(elem);
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1109 insert
  insert<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    switch (self.$) {
      case "Small":
        return self._0.insert(elem);
      case "Large":
        return self._0.insert(elem);
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1116 insert_all
  insert_all<T extends number>(self: MixedBitSet<T>): void {
    switch (self.$) {
      case "Small":
        return self._0.insert_all();
      case "Large":
        return self._0.insert_all();
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1124 remove
  remove<T extends number>(self: MixedBitSet<T>, elem: T): boolean {
    switch (self.$) {
      case "Small":
        return self._0.remove(elem);
      case "Large":
        return self._0.remove(elem);
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1131 iter
  iter<T extends number>(self: MixedBitSet<T>): MixedBitIter<T> {
    switch (self.$) {
      case "Small":
        return new MixedBitIter<T>({ $: "Small", _0: self._0.iter() });
      case "Large":
        return new MixedBitIter<T>({ $: "Large", _0: self._0.iter() });
    }
  },

  // rustc: compiler/rustc_index/src/bit_set.rs:1139 clear
  clear<T extends number>(self: MixedBitSet<T>): void {
    switch (self.$) {
      case "Small":
        return self._0.clear();
      case "Large":
        return self._0.clear();
    }
  },

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:1147 union
  union<T extends number>(self: MixedBitSet<T>, other: MixedBitSet<T>): boolean {
    if (self.$ === "Small" && other.$ === "Small") return self._0.union(other._0);
    if (self.$ === "Large" && other.$ === "Large") return self._0.union(other._0);
    panic("MixedBitSet size mismatch");
  },

  /// Returns true if `self` was modified.
  // rustc: compiler/rustc_index/src/bit_set.rs:1156 subtract
  subtract<T extends number>(self: MixedBitSet<T>, other: MixedBitSet<T>): boolean {
    if (self.$ === "Small" && other.$ === "Small") return self._0.subtract(other._0);
    if (self.$ === "Large" && other.$ === "Large") return self._0.subtract(other._0);
    panic("MixedBitSet size mismatch");
  },

  // impl<T> Clone for MixedBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:1166 clone
  clone<T extends number>(self: MixedBitSet<T>): MixedBitSet<T> {
    switch (self.$) {
      case "Small":
        return { $: "Small", _0: self._0.clone() };
      case "Large":
        return { $: "Large", _0: self._0.clone() };
    }
  },

  /// WARNING: this implementation of clone_from may panic if the two
  /// bitsets have different domain sizes. This constraint is not inherent to
  /// `clone_from`, but it works with the existing call sites and allows a
  /// faster implementation, which is important because this function is hot.
  // rustc: compiler/rustc_index/src/bit_set.rs:1177 clone_from
  clone_from<T extends number>(self: MixedBitSet<T>, from: MixedBitSet<T>): void {
    if (self.$ === "Small" && from.$ === "Small") return self._0.clone_from(from._0);
    if (self.$ === "Large" && from.$ === "Large") return self._0.clone_from(from._0);
    panic("MixedBitSet size mismatch");
  },

  // impl<T: Idx> fmt::Debug for MixedBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:1187 fmt
  fmt<T extends number>(self: MixedBitSet<T>, w: Fmt, debug_T: Debug<T> = debug_int): string {
    switch (self.$) {
      case "Small":
        return debug_DenseBitSet(self._0, w, debug_T);
      case "Large":
        return debug_ChunkedBitSet(self._0, w, debug_T);
    }
  },
};

/** `#[derive(PartialEq)]` of `MixedBitSet`. */
export function MixedBitSet_eq<T extends number>(a: MixedBitSet<T>, b: MixedBitSet<T>): boolean {
  if (a.$ === "Small" && b.$ === "Small") return DenseBitSet_eq(a._0, b._0);
  if (a.$ === "Large" && b.$ === "Large") return ChunkedBitSet_eq(a._0, b._0);
  return false;
}

/** PORT: the enum `MixedBitIter` is a class holding the variant, so it can be a JS iterator. */
// rustc-type: compiler/rustc_index/src/bit_set.rs:1195 MixedBitIter
export class MixedBitIter<T extends number> implements IterableIterator<T> {
  constructor(public readonly kind: { readonly $: "Small"; readonly _0: BitIter<T> } | { readonly $: "Large"; readonly _0: ChunkedBitIter<T> }) {}

  // impl<'a, T: Idx> Iterator for MixedBitIter<'a, T>
  // rustc: compiler/rustc_index/src/bit_set.rs:1202 next
  next(): IteratorResult<T> {
    switch (this.kind.$) {
      case "Small":
        return this.kind._0.next();
      case "Large":
        return this.kind._0.next();
    }
  }

  [Symbol.iterator](): MixedBitIter<T> {
    return this;
  }
}

/// A resizable bitset type with a dense representation.
///
/// `T` is an index type, typically a newtyped `usize` wrapper, but it can also
/// just be `usize`.
// rustc-type: compiler/rustc_index/src/bit_set.rs:1215 GrowableBitSet
export class GrowableBitSet<T extends number = number> {
  /** `marker: PhantomData<T>` (erased). */
  declare readonly __t?: T;

  /** PORT: `words: Vec<Word>`; the `Uint32Array` is reallocated when it grows. */
  constructor(public words: Uint32Array) {}

  // Manually implemented to provide `clone_from`.
  // impl<T: Idx> Clone for GrowableBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:1222 clone
  clone(): GrowableBitSet<T> {
    return new GrowableBitSet<T>(this.words.slice());
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1227 clone_from
  clone_from(source: GrowableBitSet<T>): void {
    // `Vec::clone_from`
    this.words = source.words.slice();
  }

  // impl<T: Idx> Default for GrowableBitSet<T>
  // rustc: compiler/rustc_index/src/bit_set.rs:1235 default
  static default<T extends number>(): GrowableBitSet<T> {
    return GrowableBitSet.new_empty<T>();
  }

  /// Ensure that the set has allocated and initialized at least `min_num_bits` bits.
  // rustc: compiler/rustc_index/src/bit_set.rs:1242 ensure
  ensure(min_num_bits: number): void {
    const min_num_words = num_words(min_num_bits);
    this.ensure_words(min_num_words);
  }

  /// Ensures that the set has allocated and initialized at least `min_num_words` words.
  // rustc: compiler/rustc_index/src/bit_set.rs:1248 ensure_words
  ensure_words(min_num_words: number): void {
    if (this.words.length < min_num_words) {
      // `self.words.resize(min_num_words, 0)`
      const words = new Uint32Array(min_num_words);
      words.set(this.words);
      this.words = words;
    }
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1254 new_empty
  static new_empty<T extends number>(): GrowableBitSet<T> {
    return new GrowableBitSet<T>(new Uint32Array(0));
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1258 with_capacity
  static with_capacity<T extends number>(_capacity: number): GrowableBitSet<T> {
    // `Vec::with_capacity(num_words(capacity))`: an empty vector.
    return new GrowableBitSet<T>(new Uint32Array(0));
  }

  /// Returns `true` if the set has changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:1264 insert
  insert(value: T): boolean {
    this.ensure(value + 1);
    return insert(this.words, value);
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1270 count
  count(): number {
    return count_ones(this.words);
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1275 is_empty
  is_empty(): boolean {
    return this.words.every((w) => w === 0);
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1280 contains
  contains(elem: T): boolean {
    const [word_index, mask] = word_index_and_mask(elem);
    return word_index < this.words.length && (this.words[word_index]! & mask) !== 0;
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1286 iter
  iter(): BitIter<T> {
    return BitIter.new<T>(this.words);
  }

  /// Mutates `self = self | other`.
  // rustc: compiler/rustc_index/src/bit_set.rs:1292 union
  union(other: GrowableBitSet<T>): void {
    // Eagerly grow `self` to be at least as large as `other`.
    // This is simpler than trying to check whether `other` has any nonzero
    // bits beyond our current size.
    this.ensure_words(other.words.length);
    update_words(this.words.subarray(0, other.words.length), other.words, (a, b) => a | b);
  }
}

/**
 * `#[derive(PartialEq)]` of `GrowableBitSet`: compares the word vectors. PORT (D6): upstream's u64 word vectors (a
 * u32 vector of odd length has a zero high half in its last u64 word).
 */
export function GrowableBitSet_eq<T extends number>(a: GrowableBitSet<T>, b: GrowableBitSet<T>): boolean {
  const n64 = Math.ceil(a.words.length / 2);
  if (n64 !== Math.ceil(b.words.length / 2)) return false;
  for (let i = 0; i < 2 * n64; i++) {
    if ((a.words[i] ?? 0) !== (b.words[i] ?? 0)) return false;
  }
  return true;
}

/**
 * `#[derive(Debug)]` of `GrowableBitSet`: `GrowableBitSet { words: [..], marker: PhantomData<T> }`.
 * PORT (D6): `words` prints upstream's u64 words. `type_name_T` is `std::any::type_name::<T>()` (erased here).
 */
export function debug_GrowableBitSet<T extends number>(self: GrowableBitSet<T>, f: Fmt, type_name_T: string): string {
  return debug_struct(f, "GrowableBitSet", [
    [
      "words",
      debug_list(
        f,
        words_to_u64(self.words).map((w) => String(w)),
      ),
    ],
    ["marker", `PhantomData<${type_name_T}>`],
  ]);
}

/// A fixed-size 2D bit matrix type with a dense representation.
///
/// `R` and `C` are index types used to identify rows and columns respectively;
/// typically newtyped `usize` wrappers, but they can also just be `usize`.
///
/// All operations that involve a row and/or column index will panic if the
/// index exceeds the relevant bound.
// rustc-type: compiler/rustc_index/src/bit_set.rs:1310 BitMatrix
export class BitMatrix<R extends number = number, C extends number = number> {
  /** `marker: PhantomData<(R, C)>` (erased). */
  declare readonly __rc?: [R, C];

  constructor(
    public num_rows: number,
    public num_columns: number,
    public words: Uint32Array,
  ) {}

  /**
   * PORT (D6): `Decodable for BitMatrix` reads upstream's u64 words (`num_rows * num_words64(num_columns)` of them,
   * row by row); each row becomes `num_words(num_columns)` u32 words.
   */
  static from_u64_words<R extends number, C extends number>(num_rows: number, num_columns: number, words64: readonly bigint[]): BitMatrix<R, C> {
    const m = BitMatrix.new<R, C>(num_rows, num_columns);
    const wpr = num_words(num_columns);
    const wpr64 = Math.ceil(wpr / 2);
    assert_eq(words64.length, num_rows * wpr64, String);
    for (let r = 0; r < num_rows; r++) {
      words_from_u64(words64.slice(r * wpr64, (r + 1) * wpr64), m.words.subarray(r * wpr, (r + 1) * wpr));
    }
    return m;
  }

  /** PORT (D6, lane encode-contract): `Encodable for BitMatrix` writes upstream's u64 words, row by row: the inverse of `from_u64_words`. */
  to_u64_words(): bigint[] {
    const wpr = num_words(this.num_columns);
    const out: bigint[] = [];
    for (let r = 0; r < this.num_rows; r++) out.push(...words_to_u64(this.words.subarray(r * wpr, (r + 1) * wpr)));
    return out;
  }

  /// Creates a new `rows x columns` matrix, initially empty.
  // rustc: compiler/rustc_index/src/bit_set.rs:1319 new
  static new<R extends number, C extends number>(num_rows: number, num_columns: number): BitMatrix<R, C> {
    // For every element, we need one bit for every other
    // element. Round up to an even number of words.
    const words_per_row = num_words(num_columns);
    return new BitMatrix<R, C>(num_rows, num_columns, new Uint32Array(num_rows * words_per_row));
  }

  /// Creates a new matrix, with `row` used as the value for every row.
  // rustc: compiler/rustc_index/src/bit_set.rs:1332 from_row_n
  static from_row_n<R extends number, C extends number>(row: DenseBitSet<C>, num_rows: number): BitMatrix<R, C> {
    const num_columns = row.domain_size();
    const words_per_row = num_words(num_columns);
    assert_eq(words_per_row, row.words.length, String);
    const words = new Uint32Array(num_rows * words_per_row);
    for (let r = 0; r < num_rows; r++) words.set(row.words, r * words_per_row);
    return new BitMatrix<R, C>(num_rows, num_columns, words);
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1344 rows
  *rows(): Generator<R> {
    for (let r = 0; r < this.num_rows; r++) yield r as R;
  }

  /// The range of bits for a given row.
  // rustc: compiler/rustc_index/src/bit_set.rs:1349 range
  range(row: R): [number, number] {
    const words_per_row = num_words(this.num_columns);
    const start = row * words_per_row;
    return [start, start + words_per_row];
  }

  /// Sets the cell at `(row, column)` to true. Put another way, insert
  /// `column` to the bitset for `row`.
  ///
  /// Returns `true` if this changed the matrix.
  // rustc: compiler/rustc_index/src/bit_set.rs:1359 insert
  insert(row: R, column: C): boolean {
    assert(row < this.num_rows && column < this.num_columns, "assertion failed: row.index() < self.num_rows && column.index() < self.num_columns");
    const [start] = this.range(row);
    const [word_index, mask] = word_index_and_mask(column);
    const words = this.words;
    const word = words[start + word_index]!;
    const new_word = (word | mask) >>> 0;
    words[start + word_index] = new_word;
    return word !== new_word;
  }

  /// Do the bits from `row` contain `column`? Put another way, is
  /// the matrix cell at `(row, column)` true?  Put yet another way,
  /// if the matrix represents (transitive) reachability, can
  /// `row` reach `column`?
  // rustc: compiler/rustc_index/src/bit_set.rs:1374 contains
  contains(row: R, column: C): boolean {
    assert(row < this.num_rows && column < this.num_columns, "assertion failed: row.index() < self.num_rows && column.index() < self.num_columns");
    const [start] = this.range(row);
    const [word_index, mask] = word_index_and_mask(column);
    return (this.words[start + word_index]! & mask) !== 0;
  }

  /// Returns those indices that are true in rows `a` and `b`. This
  /// is an *O*(*n*) operation where *n* is the number of elements
  /// (somewhat independent from the actual size of the
  /// intersection, in particular).
  // rustc: compiler/rustc_index/src/bit_set.rs:1385 intersect_rows
  intersect_rows(row1: R, row2: R): C[] {
    assert(row1 < this.num_rows && row2 < this.num_rows, "assertion failed: row1.index() < self.num_rows && row2.index() < self.num_rows");
    const [row1_start, row1_end] = this.range(row1);
    const [row2_start, row2_end] = this.range(row2);
    const result: C[] = [];
    const n = Math.min(row1_end - row1_start, row2_end - row2_start);
    for (let base = 0; base < n; base++) {
      const i = row1_start + base;
      const j = row2_start + base;
      let v = (this.words[i]! & this.words[j]!) >>> 0;
      for (let bit = 0; bit < WORD_BITS; bit++) {
        if (v === 0) {
          break;
        }
        if ((v & 0x1) !== 0) {
          result.push((base * WORD_BITS + bit) as C);
        }
        v >>>= 1;
      }
    }
    return result;
  }

  /// Adds the bits from row `read` to the bits from row `write`, and
  /// returns `true` if anything changed.
  ///
  /// This is used when computing transitive reachability because if
  /// you have an edge `write -> read`, because in that case
  /// `write` can reach everything that `read` can (and
  /// potentially more).
  // rustc: compiler/rustc_index/src/bit_set.rs:1412 union_rows
  union_rows(read: R, write: R): boolean {
    assert(read < this.num_rows && write < this.num_rows, "assertion failed: read.index() < self.num_rows && write.index() < self.num_rows");
    const [read_start, read_end] = this.range(read);
    const [write_start, write_end] = this.range(write);
    const words = this.words;
    let changed = 0;
    const n = Math.min(read_end - read_start, write_end - write_start);
    for (let k = 0; k < n; k++) {
      const read_index = read_start + k;
      const write_index = write_start + k;
      const word = words[write_index]!;
      const new_word = word | words[read_index]!;
      words[write_index] = new_word;
      // See `bitwise` for the rationale.
      changed |= word ^ new_word;
    }
    return changed !== 0;
  }

  /// Adds the bits from `with` to the bits from row `write`, and
  /// returns `true` if anything changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:1430 union_row_with
  union_row_with(with_: DenseBitSet<C>, write: R): boolean {
    assert(write < this.num_rows, "assertion failed: write.index() < self.num_rows");
    assert_eq(with_.domain_size(), this.num_columns, String);
    const [write_start, write_end] = this.range(write);
    return update_words(this.words.subarray(write_start, write_end), with_.words, (a, b) => a | b);
  }

  /// Sets every cell in `row` to true.
  // rustc: compiler/rustc_index/src/bit_set.rs:1438 insert_all_into_row
  insert_all_into_row(row: R): void {
    assert(row < this.num_rows, "assertion failed: row.index() < self.num_rows");
    const [start, end] = this.range(row);
    const words = this.words;
    for (let index = start; index < end; index++) {
      words[index] = WORD_ALL_ONES;
    }
    clear_excess_bits_in_final_word(this.num_columns, this.words.subarray(0, end));
  }

  /// Gets a slice of the underlying words.
  /// PORT (D6): the u32 words (upstream's u64 words have no caller outside bit_set.rs).
  // rustc: compiler/rustc_index/src/bit_set.rs:1449 words
  words_(): Uint32Array {
    // PORT: named `words_` because the field `words` has the same name.
    return this.words;
  }

  /// Iterates through all the columns set to true in a given row of
  /// the matrix.
  // rustc: compiler/rustc_index/src/bit_set.rs:1455 iter
  iter(row: R): BitIter<C> {
    assert(row < this.num_rows, "assertion failed: row.index() < self.num_rows");
    const [start, end] = this.range(row);
    return BitIter.new<C>(this.words.subarray(start, end));
  }

  /// Returns the number of elements in `row`.
  // rustc: compiler/rustc_index/src/bit_set.rs:1462 count
  count(row: R): number {
    const [start, end] = this.range(row);
    return count_ones(this.words.subarray(start, end));
  }

  /** `#[derive(Clone)]` */
  clone(): BitMatrix<R, C> {
    return new BitMatrix<R, C>(this.num_rows, this.num_columns, this.words.slice());
  }
}

/** `#[derive(PartialEq)]` of `BitMatrix` (equal dimensions give equal word counts in either width). */
export function BitMatrix_eq<R extends number, C extends number>(a: BitMatrix<R, C>, b: BitMatrix<R, C>): boolean {
  return a.num_rows === b.num_rows && a.num_columns === b.num_columns && words_eq(a.words, b.words);
}

/**
 * `#[derive(Hash)]` of `BitMatrix` (`num_rows`, `num_columns`, then `words: Vec<u64>`).
 * PORT (D6): hashes upstream's u64 words, row by row (see the file header).
 */
export function hash_BitMatrix<R extends number, C extends number>(self: BitMatrix<R, C>, state: Hasher): void {
  state.write_usize(self.num_rows);
  state.write_usize(self.num_columns);
  const wpr = num_words(self.num_columns);
  const wpr64 = Math.ceil(wpr / 2);
  state.write_length_prefix(self.num_rows * wpr64);
  const bytes = new Uint8Array(self.num_rows * wpr64 * U64_WORD_BYTES);
  for (let r = 0; r < self.num_rows; r++) {
    put_le_words(self.words.subarray(r * wpr, (r + 1) * wpr), bytes, r * wpr64 * U64_WORD_BYTES);
  }
  state.write(bytes);
}

// impl<R: Idx, C: Idx> fmt::Debug for BitMatrix<R, C>
// PORT: generic over `R` / `C`: their `Debug` impls are passed in (`debug_R`, `debug_C`); `debug_BitMatrix` is the
// `R = C = usize` instance (indices print as plain numbers).
// rustc: compiler/rustc_index/src/bit_set.rs:1469 fmt
export function debug_BitMatrix_with<R extends number, C extends number>(debug_R: Debug<R>, debug_C: Debug<C>): Debug<BitMatrix<R, C>> {
  return (self, fmt) => {
    /// Forces its contents to print in regular mode instead of alternate mode.
    // struct OneLinePrinter<T>(T);
    // rustc: compiler/rustc_index/src/bit_set.rs:1473 fmt
    const OneLinePrinter = ([r, c]: [R, C], _fmt: Fmt): string => debug_tuple(PLAIN, "", [debug_R(r, PLAIN), debug_C(c, PLAIN)]);

    let s = `BitMatrix(${self.num_rows}x${self.num_columns}) `;
    const items: string[] = [];
    for (const r of self.rows()) for (const c of self.iter(r)) items.push(OneLinePrinter([r as R, c as C], fmt));
    s += debug_set(fmt, items);
    return s;
  };
}

/** `BitMatrix<usize, usize>`'s Debug. */
export const debug_BitMatrix: Debug<BitMatrix<number, number>> = debug_BitMatrix_with<number, number>(
  (v) => String(v),
  (v) => String(v),
);

/// A fixed-column-size, variable-row-size 2D bit matrix with a moderately
/// sparse representation.
///
/// Initially, every row has no explicit representation. If any bit within a row
/// is set, the entire row is instantiated as `Some(<DenseBitSet>)`.
/// Furthermore, any previously uninstantiated rows prior to it will be
/// instantiated as `None`. Those prior rows may themselves become fully
/// instantiated later on if any of their bits are set.
///
/// `R` and `C` are index types used to identify rows and columns respectively;
/// typically newtyped `usize` wrappers, but they can also just be `usize`.
// rustc-type: compiler/rustc_index/src/bit_set.rs:1496 SparseBitMatrix
export class SparseBitMatrix<R extends number, C extends number> {
  constructor(
    public num_columns: number,
    public rows_: (DenseBitSet<C> | undefined)[],
  ) {}

  /// Creates a new empty sparse bit matrix with no rows or columns.
  // rustc: compiler/rustc_index/src/bit_set.rs:1507 new
  static new<R extends number, C extends number>(num_columns: number): SparseBitMatrix<R, C> {
    return new SparseBitMatrix<R, C>(num_columns, IndexVec.new());
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1511 ensure_row
  ensure_row(row: R): DenseBitSet<C> {
    // Instantiate any missing rows up to and including row `row` with an empty `DenseBitSet`.
    // Then replace row `row` with a full `DenseBitSet` if necessary.
    return IndexVec.get_or_insert_with(this.rows_, row, () => DenseBitSet.new_empty<C>(this.num_columns));
  }

  /// Sets the cell at `(row, column)` to true. Put another way, insert
  /// `column` to the bitset for `row`.
  ///
  /// Returns `true` if this changed the matrix.
  // rustc: compiler/rustc_index/src/bit_set.rs:1521 insert
  insert(row: R, column: C): boolean {
    return this.ensure_row(row).insert(column);
  }

  /// Sets the cell at `(row, column)` to false. Put another way, delete
  /// `column` from the bitset for `row`. Has no effect if `row` does not
  /// exist.
  ///
  /// Returns `true` if this changed the matrix.
  // rustc: compiler/rustc_index/src/bit_set.rs:1530 remove
  remove(row: R, column: C): boolean {
    const r = row < this.rows_.length ? this.rows_[row] : undefined;
    if (r !== undefined) {
      return r.remove(column);
    } else {
      return false;
    }
  }

  /// Sets all columns at `row` to false. Has no effect if `row` does
  /// not exist.
  // rustc: compiler/rustc_index/src/bit_set.rs:1539 clear
  clear(row: R): void {
    const r = row < this.rows_.length ? this.rows_[row] : undefined;
    if (r !== undefined) {
      r.clear();
    }
  }

  /// Do the bits from `row` contain `column`? Put another way, is
  /// the matrix cell at `(row, column)` true?  Put yet another way,
  /// if the matrix represents (transitive) reachability, can
  /// `row` reach `column`?
  // rustc: compiler/rustc_index/src/bit_set.rs:1549 contains
  contains(row: R, column: C): boolean {
    const r = this.row(row);
    return r !== undefined && r.contains(column);
  }

  /// Adds the bits from row `read` to the bits from row `write`, and
  /// returns `true` if anything changed.
  ///
  /// This is used when computing transitive reachability because if
  /// you have an edge `write -> read`, because in that case
  /// `write` can reach everything that `read` can (and
  /// potentially more).
  // rustc: compiler/rustc_index/src/bit_set.rs:1560 union_rows
  union_rows(read: R, write: R): boolean {
    if (read === write || this.row(read) === undefined) {
      return false;
    }

    this.ensure_row(write);
    const [read_row, write_row] = IndexSlice.pick2_mut(this.rows_, read, write);
    if (read_row !== undefined && write_row !== undefined) {
      return write_row.union(read_row);
    } else {
      unreachable();
    }
  }

  /// Insert all bits in the given row.
  // rustc: compiler/rustc_index/src/bit_set.rs:1574 insert_all_into_row
  insert_all_into_row(row: R): void {
    this.ensure_row(row).insert_all();
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1578 rows
  rows(): Generator<R> {
    return IndexSlice.indices<R, DenseBitSet<C> | undefined>(this.rows_);
  }

  /// Iterates through all the columns set to true in a given row of
  /// the matrix.
  // rustc: compiler/rustc_index/src/bit_set.rs:1584 iter
  iter(row: R): IterableIterator<C> {
    const r = this.row(row);
    return r === undefined ? ([] as C[]).values() : r.iter();
  }

  // rustc: compiler/rustc_index/src/bit_set.rs:1588 row
  row(row: R): DenseBitSet<C> | undefined {
    return row < this.rows_.length ? this.rows_[row] : undefined;
  }

  /** `#[derive(Clone)]` */
  clone(): SparseBitMatrix<R, C> {
    return new SparseBitMatrix<R, C>(
      this.num_columns,
      this.rows_.map((r) => r?.clone()),
    );
  }
}

/** `#[derive(Debug)]` of `SparseBitMatrix`: `SparseBitMatrix { num_columns: N, rows: [Some([..]), None, ..] }`. */
export function debug_SparseBitMatrix<R extends number, C extends number>(self: SparseBitMatrix<R, C>, f: Fmt, debug_C: Debug<C> = debug_int): string {
  return debug_struct(f, "SparseBitMatrix", [
    ["num_columns", String(self.num_columns)],
    [
      "rows",
      debug_list(
        f,
        self.rows_.map((r) => (r === undefined ? "None" : debug_tuple(f, "Some", [debug_DenseBitSet(r, f, debug_C)]))),
      ),
    ],
  ]);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1594 num_words
function num_words(domain_size: number): number {
  return Math.ceil(domain_size / WORD_BITS);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1599 word_index_and_mask
function word_index_and_mask(elem: number): [number, Word] {
  const word_index = Math.floor(elem / WORD_BITS);
  const mask = (1 << elem % WORD_BITS) >>> 0;
  return [word_index, mask];
}

// rustc: compiler/rustc_index/src/bit_set.rs:1607 chunk_index
function chunk_index(elem: number): number {
  return Math.floor(elem / CHUNK_BITS);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1612 chunk_word_index_and_mask
function chunk_word_index_and_mask(elem: number): [number, Word] {
  const chunk_elem = elem % CHUNK_BITS;
  return word_index_and_mask(chunk_elem);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1617 clear_excess_bits_in_final_word
function clear_excess_bits_in_final_word(domain_size: number, words: Uint32Array): void {
  const num_bits_in_final_word = domain_size % WORD_BITS;
  if (num_bits_in_final_word > 0) {
    const mask = (1 << num_bits_in_final_word) - 1;
    words[words.length - 1] &= mask;
  }
}

// rustc: compiler/rustc_index/src/bit_set.rs:1626 max_bit
function max_bit(word: Word): number {
  return WORD_BITS - 1 - Math.clz32(word);
}

// rustc: compiler/rustc_index/src/bit_set.rs:1631 count_ones
function count_ones(words: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < words.length; i++) sum += word_count_ones(words[i]!);
  return sum;
}

// rustc: compiler/rustc_index/src/bit_set.rs:1636 insert
function insert(words: Uint32Array, value: number): boolean {
  const [word_index, mask] = word_index_and_mask(value);
  const word = words[word_index]!;
  const new_word = (word | mask) >>> 0;
  words[word_index] = new_word;
  return new_word !== word;
}

// ---- word helpers (`u32::trailing_zeros` / `count_ones`, and the D6 u64 views) ----

/** `Word::trailing_zeros` of a nonzero word. */
function trailing_zeros(word: Word): number {
  return 31 - Math.clz32(word & -word);
}

/** `Word::count_ones`. */
function word_count_ones(word: Word): number {
  let v = word >>> 0;
  v = v - ((v >>> 1) & 0x5555_5555);
  v = (v & 0x3333_3333) + ((v >>> 2) & 0x3333_3333);
  return (((v + (v >>> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >>> 24;
}

/** Slice equality of two word slices. */
function words_eq(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** PORT (D6): upstream's u64 words of a u32 word slice (pairs, low half first; an odd tail has a zero high half). */
export function words_to_u64(words: Uint32Array): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i < words.length; i += 2) {
    out.push(BigInt(words[i]!) | (BigInt(words[i + 1] ?? 0) << 32n));
  }
  return out;
}

/** PORT (D6): splits upstream's u64 words into `out` (u32 pairs); a high half past `out`'s end must be 0. */
function words_from_u64(words64: readonly bigint[], out: Uint32Array): void {
  assert_eq(words64.length, Math.ceil(out.length / 2), String);
  for (let k = 0; k < words64.length; k++) {
    const w = BigInt.asUintN(64, words64[k]!);
    out[2 * k] = Number(w & 0xffff_ffffn);
    const hi = Number(w >> 32n);
    if (2 * k + 1 < out.length) {
      out[2 * k + 1] = hi;
    } else {
      assert(hi === 0, "DenseBitSet: nonzero bits past the final word");
    }
  }
}

/** Writes the little-endian bytes of `words` (as u64 words) into `bytes` at `offset`. */
function put_le_words(words: Uint32Array, bytes: Uint8Array, offset: number): void {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const o = offset + 4 * i;
    bytes[o] = w & 0xff;
    bytes[o + 1] = (w >>> 8) & 0xff;
    bytes[o + 2] = (w >>> 16) & 0xff;
    bytes[o + 3] = (w >>> 24) & 0xff;
  }
}

/** `<[u64] as Hash>::hash` of upstream's u64 words: `write_length_prefix(len)` then the raw (little-endian) bytes. */
function hash_u64_word_slice(words: Uint32Array, state: Hasher): void {
  const n64 = Math.ceil(words.length / 2);
  state.write_length_prefix(n64);
  const bytes = new Uint8Array(n64 * U64_WORD_BYTES);
  put_le_words(words, bytes, 0);
  state.write(bytes);
}
