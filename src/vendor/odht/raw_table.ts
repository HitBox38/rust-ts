// Port of odht =0.3.1 `src/raw_table.rs`.
//
//! This module implements the actual hash table logic. It works solely with
//! byte arrays and does not know anything about the unencoded key and value
//! types.
//!
//! The implementation makes sure that the encoded data contains no padding
//! bytes (which makes it deterministic) and nothing in it requires any specific
//! alignment.
//!
//! Many functions in this module are marked as `#[inline]`. This is allows
//! LLVM to retain the information about byte array sizes, even though they are
//! converted to slices (of unknown size) from time to time.
//
// PORT: memory representation.
// - A `ByteArray` value (`[u8; N]`) is a `Uint8Array` of length N. The `ByteArray` trait is a
//   dictionary (`ByteArray` interface below) that carries `size_of::<Self>()` as `LEN`;
//   `ByteArray_u8_array(LEN)` is `impl<const LEN: usize> ByteArray for [u8; LEN]`.
// - `&[EntryMetadata]` is a `Uint8Array` view of the control bytes.
// - `&[Entry<K, V>]` is an `EntrySlice`: a view of the entry bytes plus the two `ByteArray`
//   dictionaries and the slot count (`data.len()`; entries may be zero-sized). `entry_at` returns an
//   `Entry` whose `key` / `value` are views into those bytes, so writes through `entry_at_mut` land
//   in the table; `*entry = x` is `Entry_assign` (a byte copy).
// - `&mut EntryMetadata` is a `MutRef<number>` view of one control byte.
// - The `H: HashFn` type parameter is the `HashFn` dictionary, passed to `new`.
// - Iterators implement the JS iterator protocol (`next()` returns an `IteratorResult`).

import type { MutRef } from "../../std/mut_ref.ts";
import { Error } from "./error.ts";
import type { HashFn } from "./lib.ts";
import { GroupQuery, GROUP_SIZE, REFERENCE_GROUP_SIZE } from "./swisstable_group_query/mod.ts";

/// Values of this type represent key-value pairs *as they are stored on-disk*.
/// `#[repr(C)]` makes sure we have deterministic field order and the fields
/// being byte arrays makes sure that there are no padding bytes, alignment is
/// not restricted, and the data is endian-independent.
///
/// It is a strict requirement that any `&[Entry<K, V>]` can be transmuted
/// into a `&[u8]` and back, regardless of whether the byte array has been
/// moved in the meantime.
// #[repr(C)]
// #[derive(PartialEq, Eq, Clone, Copy, Debug)]
export interface Entry {
  key: Uint8Array;
  value: Uint8Array;
}

export const Entry = {
  // crate: odht-0.3.1/src/raw_table.rs:35 new
  new(key: Uint8Array, value: Uint8Array): Entry {
    return { key, value };
  },

  // impl<K: ByteArray, V: ByteArray> Default for Entry<K, V>
  // crate: odht-0.3.1/src/raw_table.rs:42 default
  default(K: ByteArray, V: ByteArray): Entry {
    return {
      key: K.zeroed(),
      value: V.zeroed(),
    };
  },
};

/** PORT: `*dst = src` for an `&mut Entry<K, V>` (a byte copy into the table). */
export function Entry_assign(dst: Entry, src: Entry): void {
  dst.key.set(src.key);
  dst.value.set(src.value);
}

/** PORT: `&[Entry<K, V>]` / `&mut [Entry<K, V>]`, a view of `len` consecutive entries. */
export class EntrySlice {
  constructor(
    readonly K: ByteArray,
    readonly V: ByteArray,
    readonly bytes: Uint8Array,
    private readonly len_: number,
  ) {}

  /** `<[Entry<K, V>]>::len` */
  len(): number {
    return this.len_;
  }

  /** `&data[index]` (views of the key and value bytes). */
  get(index: number): Entry {
    const k = this.K.LEN;
    const size_of_entry = k + this.V.LEN;
    const start = index * size_of_entry;
    return { key: this.bytes.subarray(start, start + k), value: this.bytes.subarray(start + k, start + size_of_entry) };
  }

  /** `data.fill(entry)` */
  fill(entry: Entry): void {
    for (let i = 0; i < this.len_; i++) Entry_assign(this.get(i), entry);
  }
}

// impl<'a, K: ByteArray, V: ByteArray, H: HashFn> fmt::Debug for RawTable<'a, K, V, H>
// crate: odht-0.3.1/src/raw_table.rs:51 fmt
function fmt_RawTable(self: RawTable): string {
  let f = "";
  f += `RawTable (slot_count=${self.data.len()}, hash_fn=${self.H.type_name}) {\n`;
  const n = Math.min(self.metadata.length, self.data.len());
  for (let index = 0; index < n; index++) {
    const metadata = self.metadata[index]!;
    const entry = self.data.get(index);
    if (is_empty_or_deleted(metadata)) {
      f += `slot ${index}: empty\n`;
    } else {
      f += `slot ${index}: key=${self.data.K.debug(entry.key)}, value=${self.data.V.debug(entry.value)}, control_byte=${metadata}\n`;
    }
  }
  f += "}\n";
  return f;
}

// pub(crate) type EntryMetadata = u8;
export type EntryMetadata = number;

// type HashValue = u32;
type HashValue = number;

// crate: odht-0.3.1/src/raw_table.rs:78 h1
function h1(h: HashValue): number {
  return h;
}

// crate: odht-0.3.1/src/raw_table.rs:83 h2
function h2(h: HashValue): number {
  // const SHIFT: usize = size_of::<HashValue>() * 8 - 7;
  const SHIFT = 4 * 8 - 7;
  return (h >>> SHIFT) & 0xff;
}

/// This type implements the sequence in which slots are probed when resolving
/// hash value conflicts. Note that probing is always done as if `GROUP_SIZE`
/// was 16, even though on targets without sse2 `GROUP_SIZE` is going to be
/// smaller. By keeping the probing pattern constant (i.e. always visiting
/// the same slots in the same order, independently of `GROUP_SIZE`) we enable
/// the hash table layout to be target-independent. In other words: A hash
/// table created and persisted on a target with `GROUP_SIZE` x can always
/// be loaded and read on a target with a different `GROUP_SIZE` y.
// PORT: the const generic `GROUP_SIZE` is a field, passed to `new`.
export class ProbeSeq {
  constructor(
    readonly GROUP_SIZE: number,
    public index: number,
    public base: number,
    public chunk_index: number,
    public stride: number,
  ) {}

  // crate: odht-0.3.1/src/raw_table.rs:105 new
  static new(GROUP_SIZE: number, h1: number, mask: number): ProbeSeq {
    const initial_index = usize_and(h1, mask);

    return new ProbeSeq(GROUP_SIZE, initial_index, initial_index, 0, 0);
  }

  // crate: odht-0.3.1/src/raw_table.rs:117 advance
  advance(mask: number): void {
    // debug_assert!(GROUP_SIZE <= REFERENCE_GROUP_SIZE);
    // debug_assert!(REFERENCE_GROUP_SIZE % GROUP_SIZE == 0);

    // The effect of the code in the two branches is
    // identical if GROUP_SIZE==REFERENCE_GROUP_SIZE
    // but the if statement should make it very easy
    // for the compiler to discard the more costly
    // version and only emit the simplified version.

    if (this.GROUP_SIZE === REFERENCE_GROUP_SIZE) {
      this.stride += REFERENCE_GROUP_SIZE;
      this.index += this.stride;
      this.index = usize_and(this.index, mask);
    } else {
      this.chunk_index += this.GROUP_SIZE;

      if (this.chunk_index === REFERENCE_GROUP_SIZE) {
        this.chunk_index = 0;
        this.stride += REFERENCE_GROUP_SIZE;
        this.base += this.stride;
      }

      this.index = usize_and(this.base + this.chunk_index, mask);
    }
  }
}

/**
 * PORT: `a & b` on `usize` values below 2^53. `b` is always a table mask (slot count - 1), so the
 * result is below the slot count; JS `&` is 32-bit, so wider operands go through `bigint`.
 */
function usize_and(a: number, b: number): number {
  if (a <= 0x7fff_ffff && b <= 0x7fff_ffff) return a & b;
  return Number(BigInt(a) & BigInt(b));
}

// crate: odht-0.3.1/src/raw_table.rs:146 group_starting_at
function group_starting_at(control_bytes: Uint8Array, index: number): Uint8Array {
  // debug_assert!(index < control_bytes.len() - GROUP_SIZE);
  // `std::slice::from_raw_parts(control_bytes.as_ptr().offset(index as isize), GROUP_SIZE).try_into().unwrap()`
  return control_bytes.subarray(index, index + GROUP_SIZE);
}

// crate: odht-0.3.1/src/raw_table.rs:156 is_empty_or_deleted
function is_empty_or_deleted(control_byte: number): boolean {
  return (control_byte & EMPTY_CONTROL_BYTE) !== 0;
}

const EMPTY_CONTROL_BYTE = 0b1000_0000;

/// This type provides a readonly view of the given table data.
// #[derive(PartialEq, Eq)]
export class RawTable {
  constructor(
    readonly metadata: Uint8Array,
    readonly data: EntrySlice,
    readonly H: HashFn,
  ) {}

  // crate: odht-0.3.1/src/raw_table.rs:182 new
  static new(H: HashFn, metadata: Uint8Array, data: EntrySlice): RawTable {
    // Make sure Entry<K, V> does not contain any padding bytes and can be
    // stored at arbitrary adresses.
    // PORT: `size_of::<Entry<K, V>>() == size_of::<K>() + size_of::<V>()` and `align_of == 1` hold by
    // construction of `EntrySlice` (packed byte views).

    // debug_assert!(data.len().is_power_of_two());
    // debug_assert!(metadata.len() == data.len() + REFERENCE_GROUP_SIZE);

    return new RawTable(metadata, data, H);
  }

  // crate: odht-0.3.1/src/raw_table.rs:199 find
  find(key: Uint8Array): Uint8Array | undefined {
    // debug_assert!(self.data.len().is_power_of_two());
    // debug_assert!(self.metadata.len() == self.data.len() + REFERENCE_GROUP_SIZE);

    const mask = this.data.len() - 1;
    const hash = this.H.hash(this.data.K.as_slice(key));
    const ps = ProbeSeq.new(GROUP_SIZE, h1(hash), mask);
    const h2_ = h2(hash);

    for (;;) {
      const group_query = GroupQuery.from(group_starting_at(this.metadata, ps.index), h2_);

      for (const m of group_query) {
        const index = usize_and(ps.index + m, mask);

        const entry = entry_at(this.data, index);

        if (this.data.K.equals(entry.key, key)) {
          return entry.value;
        }
      }

      if (group_query.any_empty()) {
        return undefined;
      }

      ps.advance(mask);
    }
  }

  // crate: odht-0.3.1/src/raw_table.rs:230 iter
  iter(): RawIter {
    return RawIter.new(this.metadata, this.data);
  }

  /// Check (for the first `entries_to_check` entries) if the computed and
  /// the stored hash value match.
  ///
  /// A mismatch is an indication that the table has been deserialized with
  /// the wrong hash function.
  // crate: odht-0.3.1/src/raw_table.rs:239 sanity_check_hashes
  sanity_check_hashes(slots_to_check: number): { $: "Ok"; _0: undefined } | { $: "Err"; _0: Error } {
    slots_to_check = Math.min(slots_to_check, this.data.len());

    for (let i = 0; i < slots_to_check; i++) {
      const metadata = this.metadata[i]!;
      const entry = this.data.get(i);

      if (is_empty_or_deleted(metadata)) {
        if (!this.data.K.is_all_zeros(entry.key) || !this.data.V.is_all_zeros(entry.value)) {
          const message = `Found empty entry with non-zero contents at ${i}`;

          return { $: "Err", _0: new Error(message) };
        }
      } else {
        const hash = this.H.hash(this.data.K.as_slice(entry.key));
        const h2_ = h2(hash);

        if (metadata !== h2_) {
          const message = `Control byte does not match hash value for entry ${i}. Expected ${h2_}, found ${metadata}.`;

          return { $: "Err", _0: new Error(message) };
        }
      }
    }

    return { $: "Ok", _0: undefined };
  }

  /** `{:?}` */
  fmt(): string {
    return fmt_RawTable(this);
  }
}

// crate: odht-0.3.1/src/raw_table.rs:272 entry_at
function entry_at(data: EntrySlice, index: number): Entry {
  // debug_assert!(index < data.len());
  return data.get(index);
}

// crate: odht-0.3.1/src/raw_table.rs:278 metadata_at
function metadata_at(metadata: Uint8Array, index: number): EntryMetadata {
  // debug_assert!(index < metadata.len());
  return metadata[index]!;
}

/// This type provides a mutable view of the given table data. It allows for
/// inserting new entries but does *not* allow for growing the table.
// #[derive(PartialEq, Eq)]
export class RawTableMut {
  constructor(
    readonly metadata: Uint8Array,
    readonly data: EntrySlice,
    readonly H: HashFn,
  ) {}

  // crate: odht-0.3.1/src/raw_table.rs:304 new
  static new(H: HashFn, metadata: Uint8Array, data: EntrySlice): RawTableMut {
    // Make sure Entry<K, V> does not contain any padding bytes and can be
    // stored at arbitrary adresses.
    // PORT: the two `assert!`s hold by construction of `EntrySlice` (see RawTable::new).

    // debug_assert!(data.len().is_power_of_two());
    // debug_assert_eq!(metadata.len(), data.len() + REFERENCE_GROUP_SIZE);

    return new RawTableMut(metadata, data, H);
  }

  /// Inserts the given key value pair into the hash table.
  ///
  /// WARNING: This method assumes that there is free space in the hash table
  ///          somewhere. If there isn't it will end up in an infinite loop.
  // crate: odht-0.3.1/src/raw_table.rs:325 insert
  insert(key: Uint8Array, value: Uint8Array): Uint8Array | undefined {
    // debug_assert!(self.data.len().is_power_of_two());
    // debug_assert!(self.metadata.len() == self.data.len() + REFERENCE_GROUP_SIZE);

    const mask = this.data.len() - 1;
    const hash = this.H.hash(this.data.K.as_slice(key));

    const ps = ProbeSeq.new(GROUP_SIZE, h1(hash), mask);
    const h2_ = h2(hash);

    for (;;) {
      const group_query = GroupQuery.from(group_starting_at(this.metadata, ps.index), h2_);

      for (const m of group_query) {
        const index = usize_and(ps.index + m, mask);

        const entry = entry_at_mut(this.data, index);

        if (this.data.K.equals(entry.key, key)) {
          // `Some(entry.value)` copies the value out before it is overwritten.
          const ret = entry.value.slice();
          entry.value.set(value);
          return ret;
        }
      }

      const first_empty = group_query.first_empty();
      if (first_empty !== undefined) {
        const index = usize_and(ps.index + first_empty, mask);
        Entry_assign(entry_at_mut(this.data, index), Entry.new(key, value));
        metadata_at_mut(this.metadata, index).value = h2_;

        if (index < REFERENCE_GROUP_SIZE) {
          const first_mirror = this.data.len();
          metadata_at_mut(this.metadata, first_mirror + index).value = h2_;
          // debug_assert_eq!(
          //     self.metadata[..REFERENCE_GROUP_SIZE],
          //     self.metadata[self.data.len()..]
          // );
        }

        return undefined;
      }

      ps.advance(mask);
    }
  }

  // impl<'a, K: ByteArray, V: ByteArray, H: HashFn> fmt::Debug for RawTableMut<'a, K, V, H>
  // crate: odht-0.3.1/src/raw_table.rs:388 fmt
  fmt(): string {
    const readonly = RawTable.new(this.H, this.metadata, this.data);
    return `${readonly.fmt()}`;
  }
}

// crate: odht-0.3.1/src/raw_table.rs:373 entry_at_mut
function entry_at_mut(data: EntrySlice, index: number): Entry {
  // debug_assert!(index < data.len());
  return data.get(index);
}

// crate: odht-0.3.1/src/raw_table.rs:382 metadata_at_mut
function metadata_at_mut(metadata: Uint8Array, index: number): MutRef<EntryMetadata> {
  // debug_assert!(index < metadata.len());
  return {
    get value(): EntryMetadata {
      return metadata[index]!;
    },
    set value(v: EntryMetadata) {
      metadata[index] = v;
    },
  };
}

export class RawIter implements IterableIterator<[EntryMetadata, Entry]> {
  constructor(
    readonly metadata: Uint8Array,
    readonly data: EntrySlice,
    public current_index: number,
  ) {}

  // crate: odht-0.3.1/src/raw_table.rs:409 new
  static new(metadata: Uint8Array, data: EntrySlice): RawIter {
    // debug_assert!(data.len().is_power_of_two());
    // debug_assert!(metadata.len() == data.len() + REFERENCE_GROUP_SIZE);

    return new RawIter(metadata, data, 0);
  }

  // impl<'a, K, V> Iterator for RawIter<'a, K, V>
  // crate: odht-0.3.1/src/raw_table.rs:428 next
  next(): IteratorResult<[EntryMetadata, Entry], undefined> {
    for (;;) {
      if (this.current_index >= this.data.len()) {
        return { done: true, value: undefined };
      }

      const index = this.current_index;

      this.current_index += 1;

      const entry_metadata = metadata_at(this.metadata, index);
      if (!is_empty_or_deleted(entry_metadata)) {
        return { done: false, value: [entry_metadata, entry_at(this.data, index)] };
      }
    }
  }

  [Symbol.iterator](): RawIter {
    return this;
  }
}

/// A trait that lets us abstract over different lengths of fixed size byte
/// arrays. Don't implement it for anything other than fixed size byte arrays!
// pub trait ByteArray: Sized + Copy + Eq + Clone + PartialEq + fmt::Debug + 'static
export interface ByteArray {
  /** PORT: `size_of::<Self>()` */
  readonly LEN: number;
  /** PORT: the `fmt::Debug` supertrait (`{:?}`). */
  debug(v: Uint8Array): string;
  // crate: odht-0.3.1/src/raw_table.rs:449 zeroed
  zeroed(): Uint8Array;
  // crate: odht-0.3.1/src/raw_table.rs:450 as_slice
  as_slice(self: Uint8Array): Uint8Array;
  // crate: odht-0.3.1/src/raw_table.rs:451 equals
  equals(self: Uint8Array, other: Uint8Array): boolean;
  is_all_zeros(self: Uint8Array): boolean; // (provided)
}

/** The provided methods of `ByteArray`. */
export const ByteArray_provided = {
  // crate: odht-0.3.1/src/raw_table.rs:452 is_all_zeros
  is_all_zeros(B: ByteArray, self: Uint8Array): boolean {
    return B.as_slice(self).every((b) => b === 0);
  },
};

const U8_ARRAYS = new Map<number, ByteArray>();

/** `impl<const LEN: usize> ByteArray for [u8; LEN]` */
export function ByteArray_u8_array(LEN: number): ByteArray {
  let b = U8_ARRAYS.get(LEN);
  if (b === undefined) {
    b = u8_array(LEN);
    U8_ARRAYS.set(LEN, b);
  }
  return b;
}

function u8_array(LEN: number): ByteArray {
  const self_: ByteArray = {
    LEN,

    debug(v: Uint8Array): string {
      return `[${Array.from(v).join(", ")}]`;
    },

    // crate: odht-0.3.1/src/raw_table.rs:459 zeroed
    zeroed(): Uint8Array {
      return new Uint8Array(LEN);
    },

    // crate: odht-0.3.1/src/raw_table.rs:464 as_slice
    as_slice(self: Uint8Array): Uint8Array {
      return self;
    },

    // This custom implementation of comparing the fixed size arrays
    // seems make a big difference for performance (at least for
    // 16+ byte keys)
    // crate: odht-0.3.1/src/raw_table.rs:472 equals
    equals(self: Uint8Array, other: Uint8Array): boolean {
      // Most branches here are optimized away at compile time
      // because they depend on values known at compile time.

      // PORT: `size_of::<usize>()` of the 64-bit oracle host.
      const USIZE = 8;

      // Special case a few cases we care about
      if (LEN === USIZE) {
        return read_usize(self, 0) === read_usize(other, 0);
      }

      if (LEN === USIZE * 2) {
        return read_usize(self, 0) === read_usize(other, 0) && read_usize(self, 1) === read_usize(other, 1);
      }

      if (LEN === USIZE * 3) {
        return (
          read_usize(self, 0) === read_usize(other, 0) &&
          read_usize(self, 1) === read_usize(other, 1) &&
          read_usize(self, 2) === read_usize(other, 2)
        );
      }

      if (LEN === USIZE * 4) {
        return (
          read_usize(self, 0) === read_usize(other, 0) &&
          read_usize(self, 1) === read_usize(other, 1) &&
          read_usize(self, 2) === read_usize(other, 2) &&
          read_usize(self, 3) === read_usize(other, 3)
        );
      }

      // fallback
      return slice_eq(self, other);

      // crate: odht-0.3.1/src/raw_table.rs:505 read_usize
      function read_usize(bytes: Uint8Array, index: number): bigint {
        const STRIDE = 8;
        // `usize::from_le_bytes(bytes[STRIDE * index..STRIDE * (index + 1)].try_into().unwrap())`
        return new DataView(bytes.buffer, bytes.byteOffset + STRIDE * index, STRIDE).getBigUint64(0, true);
      }
    },

    is_all_zeros(self: Uint8Array): boolean {
      return ByteArray_provided.is_all_zeros(self_, self);
    },
  };
  return self_;
}

/** `&self[..] == &other[..]` */
function slice_eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

