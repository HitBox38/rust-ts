// Port of odht =0.3.1 `src/lib.rs` (the version in upstream's Cargo.lock, used by rustc_hir_id's
// `DefPathHashMap` and rustc_metadata's `rmeta/def_path_hash_map.rs`). Built without the `nightly`
// and `no_simd` features, so `likely!` / `unlikely!` are the identity and the group query is the
// target's (see swisstable_group_query/mod.ts).
//
//! This crate implements a hash table that can be used as is in its binary, on-disk format.
//! The goal is to provide a high performance data structure that can be used without any significant up-front decoding.
//! The implementation makes no assumptions about alignment or endianess of the underlying data,
//! so a table encoded on one platform can be used on any other platform and
//! the binary data can be mapped into memory at arbitrary addresses.
//!
//!
//! ## Usage
//!
//! In order to use the hash table one needs to implement the `Config` trait.
//! This trait defines how the table is encoded and what hash function is used.
//! With a `Config` in place the `HashTableOwned` type can be used to build and serialize a hash table.
//! The `HashTable` type can then be used to create an almost zero-cost view of the serialized hash table.
//!
//! ```rust
//!
//! use odht::{HashTable, HashTableOwned, Config, FxHashFn};
//!
//! struct MyConfig;
//!
//! impl Config for MyConfig {
//!
//!     type Key = u64;
//!     type Value = u32;
//!
//!     type EncodedKey = [u8; 8];
//!     type EncodedValue = [u8; 4];
//!
//!     type H = FxHashFn;
//!
//!     #[inline] fn encode_key(k: &Self::Key) -> Self::EncodedKey { k.to_le_bytes() }
//!     #[inline] fn encode_value(v: &Self::Value) -> Self::EncodedValue { v.to_le_bytes() }
//!     #[inline] fn decode_key(k: &Self::EncodedKey) -> Self::Key { u64::from_le_bytes(*k) }
//!     #[inline] fn decode_value(v: &Self::EncodedValue) -> Self::Value { u32::from_le_bytes(*v)}
//! }
//!
//! fn main() {
//!     let mut builder = HashTableOwned::<MyConfig>::with_capacity(3, 95);
//!
//!     builder.insert(&1, &2);
//!     builder.insert(&3, &4);
//!     builder.insert(&5, &6);
//!
//!     let serialized = builder.raw_bytes().to_owned();
//!
//!     let table = HashTable::<MyConfig, &[u8]>::from_raw_bytes(
//!         &serialized[..]
//!     ).unwrap();
//!
//!     assert_eq!(table.get(&1), Some(2));
//!     assert_eq!(table.get(&3), Some(4));
//!     assert_eq!(table.get(&5), Some(6));
//! }
//! ```
//
// PORT: representation.
// - `Config` is a dictionary interface: the associated types `EncodedKey` / `EncodedValue` are
//   `ByteArray` dictionaries (`ByteArray_u8_array(N)` for `[u8; N]`), `H` is a `HashFn` dictionary,
//   and the four required fns are methods. The `C` type parameter of `HashTableOwned::<C>::..` /
//   `HashTable::<C, D>::..` / `bytes_needed::<C>` is passed as the first argument of the static
//   constructors and free fns; tables keep it (`allocation.C`). `Key` / `Value` are the TS type
//   parameters `K` / `V`.
// - Encoded keys and values (`[u8; N]`) are `Uint8Array`s. `D: Borrow<[u8]>` (e.g. rustc's
//   `OwnedSlice`) is a `Uint8Array`; `HashTable` only borrows it, as upstream does.
// - `Box<dyn std::error::Error>` is `Error` (error.ts); `Result` is the `{ $: "Ok" | "Err" }` union.
// - Iterators implement the JS iterator protocol.
// - `usize` is `number`. `Factor::apply` / `apply_inverse` compute in `bigint` (upstream: u128).

import type { Debug } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Error } from "./error.ts";
import * as memory_layout from "./memory_layout.ts";
import { type ByteArray, RawIter, RawTable, RawTableMut } from "./raw_table.ts";
import { REFERENCE_GROUP_SIZE } from "./swisstable_group_query/mod.ts";

export { FxHashFn } from "./fxhash.ts";
export { UnHashFn } from "./unhash.ts";
export { type ByteArray, ByteArray_u8_array } from "./raw_table.ts";
export { Error } from "./error.ts";

type Result<T> = { $: "Ok"; _0: T } | { $: "Err"; _0: Error };

// macro_rules! likely { ($x:expr) => { $x }; }    (no `nightly` feature)
// macro_rules! unlikely { ($x:expr) => { $x }; }  (no `nightly` feature)

/// This trait provides a complete "configuration" for a hash table, i.e. it
/// defines the key and value types, how these are encoded and what hash
/// function is being used.
///
/// Implementations of the `encode_key` and `encode_value` methods must encode
/// the given key/value into a fixed size array. The encoding must be
/// deterministic (i.e. no random padding bytes) and must be independent of
/// platform endianess. It is always highly recommended to mark these methods
/// as `#[inline]`.
export interface Config<K, V> {
  // type Key;
  // type Value;

  // The EncodedKey and EncodedValue types must always be a fixed size array of bytes,
  // e.g. [u8; 4].
  readonly EncodedKey: ByteArray;
  readonly EncodedValue: ByteArray;

  readonly H: HashFn;

  /// Implementations of the `encode_key` and `encode_value` methods must encode
  /// the given key/value into a fixed size array. See above for requirements.
  // crate: odht-0.3.1/src/lib.rs:128 encode_key
  encode_key(k: K): Uint8Array;

  /// Implementations of the `encode_key` and `encode_value` methods must encode
  /// the given key/value into a fixed size array. See above for requirements.
  // crate: odht-0.3.1/src/lib.rs:132 encode_value
  encode_value(v: V): Uint8Array;

  // crate: odht-0.3.1/src/lib.rs:134 decode_key
  decode_key(k: Uint8Array): K;
  // crate: odht-0.3.1/src/lib.rs:135 decode_value
  decode_value(v: Uint8Array): V;
}

/// This trait represents hash functions as used by HashTable and
/// HashTableOwned.
export interface HashFn {
  /** PORT: `std::any::type_name::<H>()` (RawTable's Debug impl prints it). */
  readonly type_name: string;
  // crate: odht-0.3.1/src/lib.rs:141 hash
  hash(bytes: Uint8Array): number;
}

/// A [HashTableOwned] keeps the underlying data on the heap and
/// can resize itself on demand.
// #[derive(Clone)]
export class HashTableOwned<K, V> {
  constructor(public allocation: memory_layout.Allocation<K, V>) {}

  // impl<C: Config> Default for HashTableOwned<C>
  // crate: odht-0.3.1/src/lib.rs:152 default
  static default<K, V>(C: Config<K, V>): HashTableOwned<K, V> {
    return HashTableOwned.with_capacity(C, 12, 87);
  }

  /// Creates a new [HashTableOwned] that can hold at least `max_item_count`
  /// items while maintaining the specified load factor.
  // crate: odht-0.3.1/src/lib.rs:160 with_capacity
  static with_capacity<K, V>(C: Config<K, V>, max_item_count: number, max_load_factor_percent: number): HashTableOwned<K, V> {
    if (!(max_load_factor_percent <= 100)) panic("assertion failed: max_load_factor_percent <= 100");
    if (!(max_load_factor_percent > 0)) panic("assertion failed: max_load_factor_percent > 0");

    return HashTableOwned.with_capacity_internal(C, max_item_count, Factor.from_percent(max_load_factor_percent));
  }

  // crate: odht-0.3.1/src/lib.rs:170 with_capacity_internal
  static with_capacity_internal<K, V>(C: Config<K, V>, max_item_count: number, max_load_factor: Factor): HashTableOwned<K, V> {
    const slots_needed_ = slots_needed(max_item_count, max_load_factor);
    if (!(slots_needed_ > 0)) panic("assertion failed: slots_needed > 0");

    const allocation = memory_layout.allocate(C, slots_needed_, 0, max_load_factor);

    return new HashTableOwned(allocation);
  }

  /// Retrieves the value for the given key. Returns `None` if no entry is found.
  // crate: odht-0.3.1/src/lib.rs:181 get
  get(key: K): V | undefined {
    const C = this.allocation.C;
    const encoded_key = C.encode_key(key);
    const encoded_value = this.as_raw().find(encoded_key);
    if (encoded_value !== undefined) {
      return C.decode_value(encoded_value);
    } else {
      return undefined;
    }
  }

  // crate: odht-0.3.1/src/lib.rs:191 contains_key
  contains_key(key: K): boolean {
    const encoded_key = this.allocation.C.encode_key(key);
    return this.as_raw().find(encoded_key) !== undefined;
  }

  /// Inserts the given key-value pair into the table.
  /// Grows the table if necessary.
  // crate: odht-0.3.1/src/lib.rs:199 insert
  insert(key: K, value: V): V | undefined {
    let item_count: number;
    let max_item_count: number;
    {
      const header = this.allocation.header();
      max_item_count = max_item_count_for(header.slot_count(), header.max_load_factor());
      item_count = header.item_count();
    }

    if (item_count === max_item_count) {
      this.grow();
    }

    // debug_assert!(
    //     item_count
    //         < max_item_count_for(
    //             self.allocation.header().slot_count(),
    //             self.allocation.header().max_load_factor()
    //         )
    // );

    const C = this.allocation.C;
    const encoded_key = C.encode_key(key);
    const encoded_value = C.encode_value(value);

    return with_raw_mut(this.allocation, (header, raw_table) => {
      const old_value = raw_table.insert(encoded_key, encoded_value);
      if (old_value !== undefined) {
        return C.decode_value(old_value);
      } else {
        header.set_item_count(item_count + 1);
        return undefined;
      }
    });
  }

  // crate: odht-0.3.1/src/lib.rs:232 iter
  iter(): Iter<K, V> {
    const [entry_metadata, entry_data] = this.allocation.data_slices();
    return new Iter(this.allocation.C, RawIter.new(entry_metadata, entry_data));
  }

  /**
   * PORT: `it.size_hint()` has no JS counterpart: it is `[len, Some(len)]` for an array and
   * `[0, None]` for any other iterable unless the caller passes `size_hint`.
   */
  // crate: odht-0.3.1/src/lib.rs:237 from_iterator
  static from_iterator<K, V>(
    C: Config<K, V>,
    it: Iterable<readonly [K, V]>,
    max_load_factor_percent: number,
    size_hint: readonly [number, number | undefined] = Array.isArray(it) ? [it.length, it.length] : [0, undefined],
  ): HashTableOwned<K, V> {
    let known_size: number | undefined;
    {
      const [min, max] = size_hint;
      if (max !== undefined) {
        if (min === max) {
          known_size = max;
        } else {
          known_size = undefined;
        }
      } else {
        known_size = undefined;
      }
    }

    if (known_size !== undefined) {
      const table = HashTableOwned.with_capacity(C, known_size, max_load_factor_percent);

      const initial_slot_count = table.allocation.header().slot_count();

      for (const [k, v] of it) {
        table.insert(k, v);
      }

      // duplicates
      if (!(table.len() <= known_size)) panic("assertion failed: table.len() <= known_size");
      const slot_count = table.allocation.header().slot_count();
      if (slot_count !== initial_slot_count) panic(`assertion \`left == right\` failed\n  left: ${slot_count}\n right: ${initial_slot_count}`);

      return table;
    } else {
      const items: (readonly [K, V])[] = Array.from(it);
      return HashTableOwned.from_iterator(C, items, max_load_factor_percent);
    }
  }

  /// Constructs a [HashTableOwned] from its raw byte representation.
  /// The provided data must have the exact right number of bytes.
  ///
  /// This method has linear time complexity as it needs to make its own
  /// copy of the given data.
  ///
  /// The method will verify the header of the given data and return an
  /// error if the verification fails.
  // crate: odht-0.3.1/src/lib.rs:282 from_raw_bytes
  static from_raw_bytes<K, V>(C: Config<K, V>, data: Uint8Array): Result<HashTableOwned<K, V>> {
    const data_ = data.slice();
    const allocation = memory_layout.Allocation.from_raw_bytes(C, data_);
    if (allocation.$ === "Err") return allocation;

    return { $: "Ok", _0: new HashTableOwned(allocation._0) };
  }

  // crate: odht-0.3.1/src/lib.rs:290 from_raw_bytes_unchecked
  static from_raw_bytes_unchecked<K, V>(C: Config<K, V>, data: Uint8Array): HashTableOwned<K, V> {
    const data_ = data.slice();
    const allocation = memory_layout.Allocation.from_raw_bytes_unchecked(C, data_);

    return new HashTableOwned(allocation);
  }

  /// Returns the number of items stored in the hash table.
  // crate: odht-0.3.1/src/lib.rs:299 len
  len(): number {
    return this.allocation.header().item_count();
  }

  // crate: odht-0.3.1/src/lib.rs:304 raw_bytes
  raw_bytes(): Uint8Array {
    return this.allocation.raw_bytes();
  }

  // crate: odht-0.3.1/src/lib.rs:309 as_raw
  as_raw(): RawTable {
    const [entry_metadata, entry_data] = this.allocation.data_slices();
    return RawTable.new(this.allocation.C.H, entry_metadata, entry_data);
  }

  // #[inline(never)]
  // #[cold]
  // crate: odht-0.3.1/src/lib.rs:316 grow
  grow(): void {
    const initial_slot_count = this.allocation.header().slot_count();
    const initial_item_count = this.allocation.header().item_count();
    const initial_max_load_factor = this.allocation.header().max_load_factor();

    const new_table = HashTableOwned.with_capacity_internal(this.allocation.C, initial_item_count * 2, initial_max_load_factor);

    // Copy the entries over with the internal `insert_entry()` method,
    // which allows us to do insertions without hashing everything again.
    {
      with_raw_mut(new_table.allocation, (header, raw_table) => {
        for (const [, entry_data] of this.as_raw().iter()) {
          raw_table.insert(entry_data.key, entry_data.value);
        }

        header.set_item_count(initial_item_count);
      });
    }

    // `*self = new_table;`
    this.allocation = new_table.allocation;

    if (!(this.allocation.header().slot_count() >= 2 * initial_slot_count)) {
      panic(
        `Allocation did not grow properly. Slot count is ${this.allocation.header().slot_count()} but was expected to be ` +
          `at least ${2 * initial_slot_count}`,
      );
    }
    assert_eq_number(this.allocation.header().item_count(), initial_item_count);
    const mlf = this.allocation.header().max_load_factor();
    if (!Factor_eq(mlf, initial_max_load_factor)) {
      panic(`assertion \`left == right\` failed\n  left: ${debug_Factor(mlf)}\n right: ${debug_Factor(initial_max_load_factor)}`);
    }
  }

  // impl<C: Config> std::fmt::Debug for HashTableOwned<C>
  // crate: odht-0.3.1/src/lib.rs:354 fmt
  fmt(): string {
    const header = this.allocation.header();

    let f = "";
    f +=
      `(item_count=${header.item_count()}, max_item_count=${max_item_count_for(header.slot_count(), header.max_load_factor())}, ` +
      `max_load_factor=${header.max_load_factor().to_percent()}%)\n`;

    f += `${this.as_raw().fmt()}\n`;
    return f;
  }
}

/** `{:?}` / `{:#?}` of a `HashTableOwned` (the impl writes with `writeln!`, so the flags do not matter). */
export const debug_HashTableOwned: Debug<HashTableOwned<unknown, unknown>> = (v) => v.fmt();

/// The [HashTable] type provides a cheap way to construct a non-resizable view
/// of a persisted hash table. If the underlying data storage `D` implements
/// `BorrowMut<[u8]>` then the table can be modified in place.
// #[derive(Clone, Copy)]
export class HashTable<K, V> {
  constructor(readonly allocation: memory_layout.Allocation<K, V>) {}

  /// Constructs a [HashTable] from its raw byte representation.
  /// The provided data must have the exact right number of bytes.
  ///
  /// This method has constant time complexity and will only verify the header
  /// data of the hash table. It will not copy any data.
  // crate: odht-0.3.1/src/lib.rs:383 from_raw_bytes
  static from_raw_bytes<K, V>(C: Config<K, V>, data: Uint8Array): Result<HashTable<K, V>> {
    const allocation = memory_layout.Allocation.from_raw_bytes(C, data);
    if (allocation.$ === "Err") return allocation;
    return { $: "Ok", _0: new HashTable(allocation._0) };
  }

  /// Constructs a [HashTable] from its raw byte representation without doing
  /// any verification of the underlying data. It is the user's responsibility
  /// to make sure that the underlying data is actually a valid hash table.
  ///
  /// The [HashTable::from_raw_bytes] method provides a safe alternative to this
  /// method.
  // crate: odht-0.3.1/src/lib.rs:395 from_raw_bytes_unchecked
  static from_raw_bytes_unchecked<K, V>(C: Config<K, V>, data: Uint8Array): HashTable<K, V> {
    return new HashTable(memory_layout.Allocation.from_raw_bytes_unchecked(C, data));
  }

  // crate: odht-0.3.1/src/lib.rs:402 get
  get(key: K): V | undefined {
    const C = this.allocation.C;
    const encoded_key = C.encode_key(key);
    const v = this.as_raw().find(encoded_key);
    return v === undefined ? undefined : C.decode_value(v);
  }

  // crate: odht-0.3.1/src/lib.rs:408 contains_key
  contains_key(key: K): boolean {
    const encoded_key = this.allocation.C.encode_key(key);
    return this.as_raw().find(encoded_key) !== undefined;
  }

  // crate: odht-0.3.1/src/lib.rs:414 iter
  iter(): Iter<K, V> {
    const [entry_metadata, entry_data] = this.allocation.data_slices();
    return new Iter(this.allocation.C, RawIter.new(entry_metadata, entry_data));
  }

  /// Returns the number of items stored in the hash table.
  // crate: odht-0.3.1/src/lib.rs:421 len
  len(): number {
    return this.allocation.header().item_count();
  }

  // crate: odht-0.3.1/src/lib.rs:426 raw_bytes
  raw_bytes(): Uint8Array {
    return this.allocation.raw_bytes();
  }

  // crate: odht-0.3.1/src/lib.rs:431 as_raw
  as_raw(): RawTable {
    const [entry_metadata, entry_data] = this.allocation.data_slices();
    return RawTable.new(this.allocation.C.H, entry_metadata, entry_data);
  }

  // impl<C: Config, D: Borrow<[u8]> + BorrowMut<[u8]>> HashTable<C, D>

  // crate: odht-0.3.1/src/lib.rs:438 init_in_place
  static init_in_place<K, V>(C: Config<K, V>, data: Uint8Array, max_item_count: number, max_load_factor_percent: number): Result<HashTable<K, V>> {
    const max_load_factor = Factor.from_percent(max_load_factor_percent);
    const byte_count = bytes_needed_internal(C, max_item_count, max_load_factor);
    if (data.length !== byte_count) {
      return {
        $: "Err",
        _0: new Error(`byte slice to initialize has wrong length (${data.length} instead of ${byte_count})`),
      };
    }

    const slot_count = slots_needed(max_item_count, max_load_factor);
    const allocation = memory_layout.init_in_place(C, data, slot_count, 0, max_load_factor);
    return { $: "Ok", _0: new HashTable(allocation) };
  }

  /// Inserts the given key-value pair into the table.
  /// Unlike [HashTableOwned::insert] this method cannot grow the underlying table
  /// if there is not enough space for the new item. Instead the call will panic.
  // crate: odht-0.3.1/src/lib.rs:462 insert
  insert(key: K, value: V): V | undefined {
    const item_count = this.allocation.header().item_count();
    const max_load_factor = this.allocation.header().max_load_factor();
    const slot_count = this.allocation.header().slot_count();
    // FIXME: This is actually a bit to conservative because it does not account for
    //        cases where an entry is overwritten and thus the item count does not
    //        change.
    if (!(item_count < max_item_count_for(slot_count, max_load_factor))) {
      panic("assertion failed: item_count < max_item_count_for(slot_count, max_load_factor)");
    }

    const C = this.allocation.C;
    const encoded_key = C.encode_key(key);
    const encoded_value = C.encode_value(value);

    return with_raw_mut(this.allocation, (header, raw_table) => {
      const old_value = raw_table.insert(encoded_key, encoded_value);
      if (old_value !== undefined) {
        return C.decode_value(old_value);
      } else {
        header.set_item_count(item_count + 1);
        return undefined;
      }
    });
  }
}

/// Computes the exact number of bytes needed for storing a HashTable with the
/// given max item count and load factor. The result can be used for allocating
/// storage to be passed into [HashTable::init_in_place].
// crate: odht-0.3.1/src/lib.rs:488 bytes_needed
export function bytes_needed<K, V>(C: Config<K, V>, max_item_count: number, max_load_factor_percent: number): number {
  const max_load_factor = Factor.from_percent(max_load_factor_percent);
  return bytes_needed_internal(C, max_item_count, max_load_factor);
}

// crate: odht-0.3.1/src/lib.rs:493 bytes_needed_internal
function bytes_needed_internal<K, V>(C: Config<K, V>, max_item_count: number, max_load_factor: Factor): number {
  const slot_count = slots_needed(max_item_count, max_load_factor);
  return memory_layout.bytes_needed(C, slot_count);
}

export class Iter<K, V> implements IterableIterator<[K, V]> {
  constructor(
    readonly C: Config<K, V>,
    readonly _0: RawIter,
  ) {}

  // impl<'a, C: Config> Iterator for Iter<'a, C>
  // crate: odht-0.3.1/src/lib.rs:503 next
  next(): IteratorResult<[K, V], undefined> {
    const r = this._0.next();
    if (r.done) return r;
    const [, entry] = r.value;
    const key = this.C.decode_key(entry.key);
    const value = this.C.decode_value(entry.value);

    return { done: false, value: [key, value] };
  }

  [Symbol.iterator](): Iter<K, V> {
    return this;
  }
}

// We use integer math here as not to run into any issues with
// platform-specific floating point math implementation.
// crate: odht-0.3.1/src/lib.rs:515 slots_needed
export function slots_needed(item_count: number, max_load_factor: Factor): number {
  // Note: we round up here
  const slots_needed = max_load_factor.apply_inverse(item_count);
  return Math.max(unwrap_usize(checked_next_power_of_two(slots_needed)), REFERENCE_GROUP_SIZE);
}

// crate: odht-0.3.1/src/lib.rs:524 max_item_count_for
export function max_item_count_for(slot_count: number, max_load_factor: Factor): number {
  // Note: we round down here
  return max_load_factor.apply(slot_count);
}

// crate: odht-0.3.1/src/lib.rs:530 with_raw_mut
function with_raw_mut<K, V, R>(allocation: memory_layout.Allocation<K, V>, f: (header: memory_layout.Header, raw_table: RawTableMut) => R): R {
  return allocation.with_mut_parts((header, entry_metadata, entry_data) => f(header, RawTableMut.new(allocation.C.H, entry_metadata, entry_data)));
}

/// This type is used for computing max item counts for a given load factor
/// efficiently. We use integer math here so that things are the same on
/// all platforms and with all compiler settings.
// #[derive(Debug, Clone, Copy, PartialEq, Eq)]
// struct Factor(pub u16);
export class Factor {
  constructor(readonly _0: number) {}

  // const BASE: usize = u16::MAX as usize;
  static readonly BASE = 0xffff;

  // crate: odht-0.3.1/src/lib.rs:551 from_percent
  static from_percent(percent: number): Factor {
    // `((percent * Self::BASE) / 100) as u16`
    return new Factor(Math.floor((percent * Factor.BASE) / 100) & 0xffff);
  }

  // crate: odht-0.3.1/src/lib.rs:556 to_percent
  to_percent(): number {
    return Math.floor((this._0 * 100) / Factor.BASE);
  }

  // Note: we round down here
  // crate: odht-0.3.1/src/lib.rs:562 apply
  apply(x: number): number {
    // Let's make sure there's no overflow during the
    // calculation below by doing everything with 128 bits.
    const x_ = BigInt(x);
    const factor = BigInt(this._0);
    return Number((x_ * factor) >> 16n);
  }

  // Note: we round up here
  // crate: odht-0.3.1/src/lib.rs:572 apply_inverse
  apply_inverse(x: number): number {
    // Let's make sure there's no overflow during the
    // calculation below by doing everything with 128 bits.
    const x_ = BigInt(x);
    const factor = BigInt(this._0);
    const base = BigInt(Factor.BASE);
    // PORT: a zero factor (`from_percent(0)`) divides by zero, a panic upstream too.
    if (factor === 0n) panic("attempt to divide by zero");
    return Number((base * x_ + factor - 1n) / factor);
  }
}

/** `#[derive(PartialEq)]` */
export function Factor_eq(a: Factor, b: Factor): boolean {
  return a._0 === b._0;
}

/** `#[derive(Debug)]`: `Factor(n)` */
export function debug_Factor(v: Factor): string {
  return `Factor(${v._0})`;
}

// ---- helpers (std) ----

/** `usize::checked_next_power_of_two` (`None` above 2^63; `number`s are exact up to there for powers of two) */
function checked_next_power_of_two(x: number): number | undefined {
  let p = 1;
  while (p < x) p *= 2;
  return p > 2 ** 63 ? undefined : p;
}

function unwrap_usize(v: number | undefined): number {
  if (v === undefined) return panic("called `Option::unwrap()` on a `None` value");
  return v;
}

function assert_eq_number(left: number, right: number): void {
  if (left !== right) panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
}

// benches/bench.rs (benchmarks only, `#![feature(test)]`):
// crate-skip: odht-0.3.1/benches/bench.rs:24 encode_key benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:34 encode_value benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:39 decode_key benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:44 decode_value benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:49 index_contained benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:56 get_value benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:61 insert_value benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:69 generate_hash_table benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:89 generate_std_hash_table benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:106 generate_test_data benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:117 bench_odht_fx_lookup benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:144 bench_odht_fx_insert benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:160 bench_std_fx_lookup benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:179 bench_std_fx_insert benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:199 lookup_odht_fx_load_87 benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:204 insert_odht_fx_load_87 benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:209 lookup_std_fx benchmark (benches/, nightly #[bench])
// crate-skip: odht-0.3.1/benches/bench.rs:214 insert_std_fx benchmark (benches/, nightly #[bench])
