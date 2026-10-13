// Port of object 0.39.1 `src/read/util.rs`.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `Bytes` is `Copy`; methods taking `mut self` by value work on a copy (`new Bytes(this._0)`)
// so the receiver is unchanged, as upstream. `Result<_, ()>` is `Result<_, undefined>`.
// PORT: `read_uleb128` / `read_sleb128` return `u64` / `i64` as `bigint` (all 64 bits matter).
// `ByteString` (only used by unported `Import`/`Export`/`Debug` impls) is not ported.

import { debug_list, type Debug, type Fmt } from "../../../std/fmt.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import { from_bytes, type Pod, pod_u8, type PodSlice, slice_from_bytes } from "../pod.ts";
import { ReadRef } from "./read_ref.ts";

type Result<T> = StdResult<T, undefined>;

/// A newtype for byte slices.
///
/// It has these important features:
/// - no methods that can panic, such as `Index`
/// - convenience methods for `Pod` types
/// - a useful `Debug` implementation
export class Bytes {
  constructor(public _0: Uint8Array) {}

  /// Return the length of the byte slice.
  // crate: object-0.39.1/src/read/util.rs:28 len
  len(): number {
    return this._0.length;
  }

  /// Return true if the byte slice is empty.
  // crate: object-0.39.1/src/read/util.rs:34 is_empty
  is_empty(): boolean {
    return this._0.length === 0;
  }

  /// Skip over the given number of bytes at the start of the byte slice.
  ///
  /// Modifies the byte slice to start after the bytes.
  ///
  /// Returns an error if there are too few bytes.
  // crate: object-0.39.1/src/read/util.rs:44 skip
  skip(offset: number): Result<undefined> {
    if (offset <= this._0.length) {
      this._0 = this._0.subarray(offset);
      return Ok(undefined);
    } else {
      this._0 = new Uint8Array(0);
      return Err(undefined);
    }
  }

  /// Return a reference to the given number of bytes at the start of the byte slice.
  ///
  /// Modifies the byte slice to start after the bytes.
  ///
  /// Returns an error if there are too few bytes.
  // crate: object-0.39.1/src/read/util.rs:63 read_bytes
  read_bytes(count: number): Result<Bytes> {
    if (count <= this._0.length) {
      const head = this._0.subarray(0, count);
      this._0 = this._0.subarray(count);
      return Ok(new Bytes(head));
    } else {
      this._0 = new Uint8Array(0);
      return Err(undefined);
    }
  }

  /// Return a reference to the given number of bytes at the given offset of the byte slice.
  ///
  /// Returns an error if the offset is invalid or there are too few bytes.
  // crate: object-0.39.1/src/read/util.rs:80 read_bytes_at
  read_bytes_at(offset: number, count: number): Result<Bytes> {
    const self = new Bytes(this._0);
    const r = self.skip(offset);
    if (r.$ === "Err") return r;
    return self.read_bytes(count);
  }

  /// Return a reference to a `Pod` struct at the start of the byte slice.
  ///
  /// Modifies the byte slice to start after the bytes.
  ///
  /// Returns an error if there are too few bytes or the slice is incorrectly aligned.
  // crate: object-0.39.1/src/read/util.rs:91 read
  read<T>(pod: Pod<T>): Result<T> {
    const r = from_bytes(pod, this._0);
    if (r.$ === "Ok") {
      const [value, tail] = r._0;
      this._0 = tail;
      return Ok(value);
    } else {
      this._0 = new Uint8Array(0);
      return Err(undefined);
    }
  }

  /// Return a reference to a `Pod` struct at the given offset of the byte slice.
  ///
  /// Returns an error if there are too few bytes or the offset is incorrectly aligned.
  // crate: object-0.39.1/src/read/util.rs:108 read_at
  read_at<T>(pod: Pod<T>, offset: number): Result<T> {
    const self = new Bytes(this._0);
    const r = self.skip(offset);
    if (r.$ === "Err") return r;
    return self.read(pod);
  }

  /// Return a reference to a slice of `Pod` structs at the start of the byte slice.
  ///
  /// Modifies the byte slice to start after the bytes.
  ///
  /// Returns an error if there are too few bytes or the offset is incorrectly aligned.
  // crate: object-0.39.1/src/read/util.rs:119 read_slice
  read_slice<T>(pod: Pod<T>, count: number): Result<PodSlice<T>> {
    const r = slice_from_bytes(pod, this._0, count);
    if (r.$ === "Ok") {
      const [value, tail] = r._0;
      this._0 = tail;
      return Ok(value);
    } else {
      this._0 = new Uint8Array(0);
      return Err(undefined);
    }
  }

  /// Return a reference to a slice of `Pod` structs at the given offset of the byte slice.
  ///
  /// Returns an error if there are too few bytes or the offset is incorrectly aligned.
  // crate: object-0.39.1/src/read/util.rs:136 read_slice_at
  read_slice_at<T>(pod: Pod<T>, offset: number, count: number): Result<PodSlice<T>> {
    const self = new Bytes(this._0);
    const r = self.skip(offset);
    if (r.$ === "Err") return r;
    return self.read_slice(pod, count);
  }

  /// Read a null terminated string.
  ///
  /// Does not assume any encoding.
  /// Reads past the null byte, but doesn't return it.
  // crate: object-0.39.1/src/read/util.rs:146 read_string
  read_string(): Result<Uint8Array> {
    const nul = this._0.indexOf(0);
    if (nul !== -1) {
      // These will never fail.
      const bytes = this.read_bytes(nul);
      if (bytes.$ === "Err") return bytes;
      const s = this.skip(1);
      if (s.$ === "Err") return s;
      return Ok(bytes._0._0);
    } else {
      this._0 = new Uint8Array(0);
      return Err(undefined);
    }
  }

  /// Read a null terminated string at an offset.
  ///
  /// Does not assume any encoding. Does not return the null byte.
  // crate: object-0.39.1/src/read/util.rs:165 read_string_at
  read_string_at(offset: number): Result<Uint8Array> {
    const self = new Bytes(this._0);
    const r = self.skip(offset);
    if (r.$ === "Err") return r;
    return self.read_string();
  }

  /// Read an unsigned LEB128 number.
  // crate: object-0.39.1/src/read/util.rs:171 read_uleb128
  read_uleb128(): Result<bigint> {
    let result = 0n;
    let shift = 0n;

    for (;;) {
      const b = this.read(pod_u8);
      if (b.$ === "Err") return b;
      const byte = b._0;
      if (shift === 63n && byte !== 0x00 && byte !== 0x01) {
        return Err(undefined);
      }
      result = (result | (BigInt(byte & 0x7f) << shift)) & 0xffff_ffff_ffff_ffffn;
      shift += 7n;

      if ((byte & 0x80) === 0) {
        return Ok(result);
      }
    }
  }

  /// Read a signed LEB128 number.
  // crate: object-0.39.1/src/read/util.rs:190 read_sleb128
  read_sleb128(): Result<bigint> {
    let result = 0n;
    let shift = 0n;

    for (;;) {
      const b = this.read(pod_u8);
      if (b.$ === "Err") return b;
      const byte = b._0;
      if (shift === 63n && byte !== 0x00 && byte !== 0x7f) {
        return Err(undefined);
      }
      result = BigInt.asIntN(64, result | (BigInt(byte & 0x7f) << shift));
      shift += 7n;

      if ((byte & 0x80) === 0) {
        if (shift < 64n && (byte & 0x40) !== 0) {
          // Sign extend the result.
          result = BigInt.asIntN(64, result | (-1n << shift));
        }
        return Ok(result);
      }
    }
  }
}

// crate: object-0.39.1/src/read/util.rs:20 fmt
export const debug_Bytes: Debug<Bytes> = (self, fmt) => debug_list_bytes(self._0, fmt);

/** `#[derive(PartialEq)]` on `Bytes`: slice equality. */
export function Bytes_eq(a: Bytes, b: Bytes): boolean {
  return bytes_eq(a._0, b._0);
}

/** `&[u8] == &[u8]` */
export function bytes_eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Only for Debug impl of `Bytes`.
// crate: object-0.39.1/src/read/util.rs:214 debug_list_bytes
function debug_list_bytes(bytes: Uint8Array, fmt: Fmt): string {
  const entries: string[] = [];
  for (const b of bytes.subarray(0, 8)) entries.push(debug_DebugByte(b));
  if (bytes.length > 8) {
    entries.push(debug_DebugLen(bytes.length));
  }
  return debug_list(fmt, entries);
}

// struct DebugByte(u8);
// crate: object-0.39.1/src/read/util.rs:226 fmt
function debug_DebugByte(self: number): string {
  return `0x${self.toString(16).padStart(2, "0")}`;
}

// struct DebugLen(usize);
// crate: object-0.39.1/src/read/util.rs:234 fmt
function debug_DebugLen(self: number): string {
  return `...; ${self}`;
}

// crate: object-0.39.1/src/read/util.rs:255 align
export function align(offset: number, size: number): number {
  // PORT: `(offset + (size - 1)) & !(size - 1)` on usize: `size` is a power of two and values stay < 2^53,
  // so clearing the low bits is subtracting the remainder.
  const v = offset + (size - 1);
  return v - (v % size);
}

// crate: object-0.39.1/src/read/util.rs:260 data_range
export function data_range(data: Uint8Array, data_address: number, range_address: number, size: number): Uint8Array | undefined {
  const offset = range_address - data_address;
  if (offset < 0) return undefined;
  if (offset > data.length) return undefined;
  const tail = data.subarray(offset);
  if (size > tail.length) return undefined;
  return tail.subarray(0, size);
}

/// A table of zero-terminated strings.
///
/// This is used by most file formats for strings such as section names and symbol names.
export class StringTable {
  constructor(
    // PORT: `Option<SkipDebugList<R>>`
    readonly data: Uint8Array | undefined,
    readonly start: number,
    readonly end: number,
  ) {}

  /// Interpret the given data as a string table.
  // crate: object-0.39.1/src/read/util.rs:287 new
  static new(data: Uint8Array, start: number, end: number): StringTable {
    return new StringTable(data, start, end);
  }

  /// Return the string at the given offset.
  // crate: object-0.39.1/src/read/util.rs:297 get
  get(offset: number): Result<Uint8Array> {
    const data = this.data;
    if (data !== undefined) {
      // PORT: `start.checked_add(offset)`: start < 2^53 and offset is a u32.
      const r_start = this.start + offset;
      return ReadRef.read_bytes_at_until(data, [r_start, this.end], 0);
    } else {
      return Err(undefined);
    }
  }

  // crate: object-0.39.1/src/read/util.rs:309 default
  static default(): StringTable {
    return new StringTable(undefined, 0, 0);
  }
}
