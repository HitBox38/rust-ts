// Port of object 0.39.1 `src/write/string.rs`.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `IndexSet<&[u8]>` is a list of the strings plus a `Map` from their latin-1 spelling (byte-injective) to the index.
import { assert, panic } from "../../../std/panic.ts";

/** A unique id for a string in a string table. */
export type StringId = number & { readonly __brand: "StringId" };

const key = (s: Uint8Array): string => {
  let k = "";
  for (let i = 0; i < s.length; i++) k += String.fromCharCode(s[i]!);
  return k;
};

/** `previous.ends_with(string)` */
function ends_with(previous: Uint8Array, string: Uint8Array): boolean {
  if (string.length > previous.length) return false;
  const off = previous.length - string.length;
  for (let i = 0; i < string.length; i++) if (previous[off + i] !== string[i]) return false;
  return true;
}

/// A table for building strings.
export class StringTable {
  strings: Uint8Array[] = [];
  private index = new Map<string, number>();
  offsets: number[] = [];

  /// Add a string to the string table.
  ///
  /// Panics if the string table has already been written, or
  /// if the string contains a null byte.
  // crate: object-0.39.1/src/write/string.rs:23 add
  add(string: Uint8Array): StringId {
    assert(this.offsets.length === 0, "assertion failed: self.offsets.is_empty()");
    assert(!string.includes(0), "assertion failed: !string.contains(&0)");
    const k = key(string);
    let id = this.index.get(k);
    if (id === undefined) {
      id = this.strings.length;
      this.strings.push(string);
      this.index.set(k, id);
    }
    return id as StringId;
  }

  /// Return the id of the given string.
  ///
  /// Panics if the string is not in the string table.
  // crate: object-0.39.1/src/write/string.rs:34 get_id
  get_id(string: Uint8Array): StringId {
    const id = this.index.get(key(string));
    if (id === undefined) return panic("called `Option::unwrap()` on a `None` value");
    return id as StringId;
  }

  /// Return the string for the given id.
  ///
  /// Panics if the string is not in the string table.
  // crate: object-0.39.1/src/write/string.rs:43 get_string
  get_string(id: StringId): Uint8Array {
    const s = this.strings[id];
    if (s === undefined) return panic("called `Option::unwrap()` on a `None` value");
    return s;
  }

  /// Return the offset of the given string.
  ///
  /// Panics if the string table has not been written, or
  /// if the string is not in the string table.
  // crate: object-0.39.1/src/write/string.rs:51 get_offset
  get_offset(id: StringId): number {
    const o = this.offsets[id];
    if (o === undefined) return panic(`index out of bounds: the len is ${this.offsets.length} but the index is ${id}`);
    return o;
  }

  /// Append the string table to the given `Vec`, and
  /// calculate the list of string offsets.
  ///
  /// `base` is the initial string table offset. For example,
  /// this should be 1 for ELF, to account for the initial
  /// null byte (which must have been written by the caller).
  ///
  /// Panics if the string table has already been written.
  // crate: object-0.39.1/src/write/string.rs:63 write
  write(base: number, w: number[]): void {
    assert(this.offsets.length === 0, "assertion failed: self.offsets.is_empty()");

    const ids: number[] = this.strings.map((_, i) => i);
    sort(ids, 0, ids.length, 1, this.strings);

    this.offsets = new Array<number>(ids.length).fill(0);
    let offset = base;
    let previous: Uint8Array = new Uint8Array(0);
    for (const id of ids) {
      const string = this.strings[id]!;
      if (ends_with(previous, string)) {
        this.offsets[id] = offset - string.length - 1;
      } else {
        this.offsets[id] = offset;
        for (let i = 0; i < string.length; i++) w.push(string[i]!);
        w.push(0);
        offset += string.length + 1;
        previous = string;
      }
    }
  }

  /// Calculate the size in bytes of the string table.
  ///
  /// `base` is the initial string table offset. For example,
  /// this should be 1 for ELF, to account for the initial
  /// null byte.
  // crate: object-0.39.1/src/write/string.rs:92 size
  size(base: number): number {
    // TODO: cache this result?
    const ids: number[] = this.strings.map((_, i) => i);
    sort(ids, 0, ids.length, 1, this.strings);

    let size = base;
    let previous: Uint8Array = new Uint8Array(0);
    for (const id of ids) {
      const string = this.strings[id]!;
      if (!ends_with(previous, string)) {
        size += string.length + 1;
        previous = string;
      }
    }
    return size;
  }
}

// Multi-key quicksort.
//
// Ordering is such that if a string is a suffix of at least one other string,
// then it is placed immediately after one of those strings. That is:
// - comparison starts at the end of the string
// - shorter strings come later
//
// Based on the implementation in LLVM.
// PORT: `ids: &mut [usize]` is the range `[start, end)` of `all`; `ids = &mut ids[lower..upper]` moves the range.
// crate: object-0.39.1/src/write/string.rs:118 sort
function sort(all: number[], start: number, end: number, pos: number, strings: readonly Uint8Array[]): void {
  for (;;) {
    if (end - start <= 1) {
      return;
    }

    const pivot = byte(all[start]!, pos, strings);
    let lower = 0;
    let upper = end - start;
    let i = 1;
    const swap = (a: number, b: number): void => {
      const t = all[start + a]!;
      all[start + a] = all[start + b]!;
      all[start + b] = t;
    };
    while (i < upper) {
      const b = byte(all[start + i]!, pos, strings);
      if (b > pivot) {
        swap(lower, i);
        lower += 1;
        i += 1;
      } else if (b < pivot) {
        upper -= 1;
        swap(upper, i);
      } else {
        i += 1;
      }
    }

    sort(all, start, start + lower, pos, strings);
    sort(all, start + upper, end, pos, strings);

    if (pivot === 0) {
      return;
    }
    end = start + upper;
    start = start + lower;
    pos += 1;
  }
}

// crate: object-0.39.1/src/write/string.rs:153 byte
function byte(id: number, pos: number, strings: readonly Uint8Array[]): number {
  const string = strings[id]!;
  const len = string.length;
  if (len >= pos) {
    return string[len - pos]!;
  } else {
    // We know the strings don't contain null bytes.
    return 0;
  }
}
