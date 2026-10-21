// Port of compiler/rustc_index/src/bit_set.rs (subset: `DenseBitSet` and its `BitIter`, the parts
// rustc_resolve uses for `Resolver::unused_macro_rules`; ported by lane res-macros, which owned the
// `DenseBitSet` stand-in of rustc_resolve/lib.ts; plus `update_words` and `BitMatrix`, added by lane
// rds-graph for rustc_data_structures `TransitiveRelation`). The rest of the file (`ChunkedBitSet`,
// `MixedBitSet`, `GrowableBitSet`, `SparseBitMatrix`, ...) is not ported yet.
//
// PORT: `Word = u64` -> `bigint` (every bit is significant, so `number` cannot hold one). `T: Idx` is a
// number-like index (`usize` or a branded handle); `T::new(i)` / `value.index()` are the identity.
import { type Debug, debug_set, debug_tuple, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq } from "../std/panic.ts";

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

  /// Sets all bits to true.
  // rustc: compiler/rustc_index/src/bit_set.rs:210 insert_all
  insert_all(): void {
    this.words.fill(WORD_ALL_ONES);
    this.clear_excess_bits();
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

// rustc: compiler/rustc_index/src/bit_set.rs:1001 update_words
function update_words(lhs: Word[], lhs_start: number, lhs_end: number, rhs: readonly Word[], op: (a: Word, b: Word) => Word): boolean {
  // PORT: `lhs: &mut [Word]` is the subslice `lhs[lhs_start..lhs_end]` of a word vector (a JS array cannot be
  // sub-sliced in place).
  assert_eq(lhs_end - lhs_start, rhs.length, String);
  let changed = 0n;
  for (let k = 0; k < rhs.length; k++) {
    const old_val = lhs[lhs_start + k]!;
    const new_val = op(old_val, rhs[k]!);
    lhs[lhs_start + k] = new_val;
    // This is essentially equivalent to a != with changed being a bool, but
    // in practice this code gets auto-vectorized by the compiler for most
    // operators. Using != here causes us to generate quite poor code as the
    // compiler tries to go back to a boolean on each loop iteration.
    changed |= old_val ^ new_val;
  }
  return changed !== 0n;
}

/// A fixed-size 2D bit matrix type with a dense representation.
///
/// `R` and `C` are index types used to identify rows and columns respectively;
/// typically newtyped `usize` wrappers, but they can also just be `usize`.
///
/// All operations that involve a row and/or column index will panic if the
/// index exceeds the relevant bound.
// rustc-type: compiler/rustc_index/src/bit_set.rs:1310 BitMatrix
export class BitMatrix<R extends number, C extends number> {
  /** `marker: PhantomData<(R, C)>` (erased). */
  declare readonly __rc?: [R, C];

  constructor(
    public num_rows: number,
    public num_columns: number,
    public words: Word[],
  ) {}

  /// Creates a new `rows x columns` matrix, initially empty.
  // rustc: compiler/rustc_index/src/bit_set.rs:1319 new
  static new<R extends number, C extends number>(num_rows: number, num_columns: number): BitMatrix<R, C> {
    // For every element, we need one bit for every other
    // element. Round up to an even number of words.
    const words_per_row = num_words(num_columns);
    return new BitMatrix<R, C>(num_rows, num_columns, new Array<Word>(num_rows * words_per_row).fill(0n));
  }

  /// Creates a new matrix, with `row` used as the value for every row.
  // rustc: compiler/rustc_index/src/bit_set.rs:1332 from_row_n
  static from_row_n<R extends number, C extends number>(row: DenseBitSet<C>, num_rows: number): BitMatrix<R, C> {
    const num_columns = row.domain_size();
    const words_per_row = num_words(num_columns);
    assert_eq(words_per_row, row.words.length, String);
    const words: Word[] = [];
    for (let r = 0; r < num_rows; r++) words.push(...row.words);
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
    const new_word = word | mask;
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
    return (this.words[start + word_index]! & mask) !== 0n;
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
      let v = this.words[i]! & this.words[j]!;
      for (let bit = 0; bit < WORD_BITS; bit++) {
        if (v === 0n) {
          break;
        }
        if ((v & 0x1n) !== 0n) {
          result.push((base * WORD_BITS + bit) as C);
        }
        v >>= 1n;
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
    let changed = 0n;
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
    return changed !== 0n;
  }

  /// Adds the bits from `with` to the bits from row `write`, and
  /// returns `true` if anything changed.
  // rustc: compiler/rustc_index/src/bit_set.rs:1430 union_row_with
  union_row_with(with_: DenseBitSet<C>, write: R): boolean {
    assert(write < this.num_rows, "assertion failed: write.index() < self.num_rows");
    assert_eq(with_.domain_size(), this.num_columns, String);
    const [write_start, write_end] = this.range(write);
    return update_words(this.words, write_start, write_end, with_.words, (a, b) => a | b);
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
    // PORT: `clear_excess_bits_in_final_word(self.num_columns, &mut self.words[..end])`: the final word of
    // `words[..end]` is `words[end - 1]`.
    const num_bits_in_final_word = this.num_columns % WORD_BITS;
    if (num_bits_in_final_word > 0) {
      const mask = (1n << BigInt(num_bits_in_final_word)) - 1n;
      words[end - 1] = words[end - 1]! & mask;
    }
  }

  /// Gets a slice of the underlying words.
  // rustc: compiler/rustc_index/src/bit_set.rs:1449 words
  words_(): readonly Word[] {
    // PORT: named `words_` because the field `words` has the same name.
    return this.words;
  }

  /// Iterates through all the columns set to true in a given row of
  /// the matrix.
  // rustc: compiler/rustc_index/src/bit_set.rs:1455 iter
  iter(row: R): BitIter<C> {
    assert(row < this.num_rows, "assertion failed: row.index() < self.num_rows");
    const [start, end] = this.range(row);
    return BitIter.new<C>(this.words.slice(start, end));
  }

  /// Returns the number of elements in `row`.
  // rustc: compiler/rustc_index/src/bit_set.rs:1462 count
  count(row: R): number {
    const [start, end] = this.range(row);
    return count_ones(this.words.slice(start, end));
  }

  /** `#[derive(Clone)]` */
  clone(): BitMatrix<R, C> {
    return new BitMatrix<R, C>(this.num_rows, this.num_columns, this.words.slice());
  }
}

// impl<R: Idx, C: Idx> fmt::Debug for BitMatrix<R, C>
// rustc: compiler/rustc_index/src/bit_set.rs:1469 fmt
export const debug_BitMatrix: Debug<BitMatrix<number, number>> = (self, fmt) => {
  /// Forces its contents to print in regular mode instead of alternate mode.
  // struct OneLinePrinter<T>(T);
  // rustc: compiler/rustc_index/src/bit_set.rs:1473 fmt
  const OneLinePrinter = ([r, c]: [number, number], _fmt: Fmt): string => debug_tuple(PLAIN, "", [String(r), String(c)]);

  let s = `BitMatrix(${self.num_rows}x${self.num_columns}) `;
  const items: string[] = [];
  for (const r of self.rows()) for (const c of self.iter(r)) items.push(OneLinePrinter([r, c], fmt));
  s += debug_set(fmt, items);
  return s;
};

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
