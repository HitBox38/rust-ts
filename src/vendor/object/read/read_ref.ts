// Port of object 0.39.1 `src/read/read_ref.rs`.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the only `ReadRef` implementor rustc uses is `&'a [u8]` (a `Uint8Array`); the trait's
// provided methods and that impl are the functions of the `ReadRef` const (markers on each).
// `ReadCache` is not ported. `offset: &mut u64` is a `MutRef<number>`; u64 offsets/sizes are
// `number`s (see endian.ts). `Range<u64>` is `[start, end]`.

import type { MutRef } from "../../../std/mut_ref.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import { from_bytes, type Pod, type PodSlice, slice_from_bytes } from "../pod.ts";

type Result<T> = StdResult<T, undefined>;

/// A trait for reading references to [`Pod`] types from a block of data.
///
/// This allows parsers to handle both of these cases:
/// - the block of data exists in memory, and it is desirable
///   to use references to this block instead of copying it,
/// - the block of data exists in storage, and it is desirable
///   to read on demand to minimize I/O and memory usage.
///
/// A block of data typically exists in memory as a result of using a memory
/// mapped file, and the crate was written with this use case in mind.
/// Reading the entire file into a `Vec` is also possible, but it often uses
/// more I/O and memory.
/// Both of these are handled by the `ReadRef` implementation for `&[u8]`.
///
/// Object file parsers typically use offsets to locate the structures
/// in the block, and will most commonly use the `*_at` methods to
/// read a structure at a known offset.
///
/// Occasionally file parsers will need to treat the block as a stream,
/// and so convenience methods are provided that update an offset with
/// the size that was read.
export const ReadRef = {
  /// Get a reference to a `u8` slice at the given offset, and update the offset.
  ///
  /// Returns an error if offset or size are out of bounds.
  // crate: object-0.39.1/src/read/read_ref.rs:69 read_bytes
  read_bytes(self: Uint8Array, offset: MutRef<number>, size: number): Result<Uint8Array> {
    const r = ReadRef.read_bytes_at(self, offset.value, size);
    if (r.$ === "Err") return r;
    // PORT: `offset.wrapping_add(size)`: both are within the data after a successful read.
    offset.value = offset.value + size;
    return Ok(r._0);
  },

  /// Get a reference to a `Pod` type at the given offset, and update the offset.
  ///
  /// Returns an error if offset or size are out of bounds.
  ///
  /// The default implementation uses `read_bytes`, and returns an error if
  /// `read_bytes` does not return bytes with the correct alignment for `T`.
  /// Implementors may want to provide their own implementation that ensures
  /// the alignment can be satisfied. Alternatively, only use this method with
  /// types that do not need alignment. The types provided by this crate do not
  /// need alignment.
  // crate: object-0.39.1/src/read/read_ref.rs:85 read
  read<T>(self: Uint8Array, pod: Pod<T>, offset: MutRef<number>): Result<T> {
    const size = pod.size;
    const r = ReadRef.read_bytes(self, offset, size);
    if (r.$ === "Err") return r;
    const t = from_bytes(pod, r._0);
    if (t.$ === "Err") return t;
    return Ok(t._0[0]);
  },

  /// Get a reference to a `Pod` type at the given offset.
  ///
  /// Returns an error if offset or size are out of bounds.
  ///
  /// Also see the `read` method for information regarding alignment of `T`.
  // crate: object-0.39.1/src/read/read_ref.rs:97 read_at
  read_at<T>(self: Uint8Array, pod: Pod<T>, offset: number): Result<T> {
    return ReadRef.read(self, pod, { value: offset });
  },

  /// Get a reference to a slice of a `Pod` type at the given offset, and update the offset.
  ///
  /// Returns an error if offset or size are out of bounds.
  ///
  /// Also see the `read` method for information regarding alignment of `T`.
  // crate: object-0.39.1/src/read/read_ref.rs:106 read_slice
  read_slice<T>(self: Uint8Array, pod: Pod<T>, offset: MutRef<number>, count: number): Result<PodSlice<T>> {
    const size = count * pod.size;
    // PORT: `count.checked_mul(size_of::<T>())`; see pod.ts slice_from_bytes.
    if (!Number.isSafeInteger(size)) return Err(undefined);
    const r = ReadRef.read_bytes(self, offset, size);
    if (r.$ === "Err") return r;
    const t = slice_from_bytes(pod, r._0, count);
    if (t.$ === "Err") return t;
    return Ok(t._0[0]);
  },

  /// Get a reference to a slice of a `Pod` type at the given offset.
  ///
  /// Returns an error if offset or size are out of bounds.
  ///
  /// Also see the `read` method for information regarding alignment of `T`.
  // crate: object-0.39.1/src/read/read_ref.rs:122 read_slice_at
  read_slice_at<T>(self: Uint8Array, pod: Pod<T>, offset: number, count: number): Result<PodSlice<T>> {
    return ReadRef.read_slice(self, pod, { value: offset }, count);
  },

  // impl<'a> ReadRef<'a> for &'a [u8]

  /// The total size of the block of data.
  // crate: object-0.39.1/src/read/read_ref.rs:128 len
  len(self: Uint8Array): Result<number> {
    return Ok(self.length);
  },

  /// Get a reference to a `u8` slice at the given offset.
  ///
  /// Returns an error if offset or size are out of bounds.
  // crate: object-0.39.1/src/read/read_ref.rs:132 read_bytes_at
  read_bytes_at(self: Uint8Array, offset: number, size: number): Result<Uint8Array> {
    if (size === 0) {
      return Ok(new Uint8Array(0));
    }

    // `self.get(offset..)?.get(..size)`
    if (offset > self.length) return Err(undefined);
    const tail = self.length - offset;
    if (size > tail) return Err(undefined);
    return Ok(self.subarray(offset, offset + size));
  },

  /// Get a reference to a delimited `u8` slice which starts at range.start.
  ///
  /// Does not include the delimiter.
  ///
  /// Returns an error if the range is out of bounds or the delimiter is
  /// not found in the range.
  // crate: object-0.39.1/src/read/read_ref.rs:142 read_bytes_at_until
  read_bytes_at_until(self: Uint8Array, range: readonly [number, number], delimiter: number): Result<Uint8Array> {
    const [start, end] = range;
    // `self.get(start..end)`
    if (!(start <= end && end <= self.length)) return Err(undefined);
    const bytes = self.subarray(start, end);
    const len = bytes.indexOf(delimiter);
    if (len !== -1) {
      // This will never fail.
      return Ok(bytes.subarray(0, len));
    } else {
      return Err(undefined);
    }
  },
};
