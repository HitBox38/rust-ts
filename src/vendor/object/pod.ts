// Port of object 0.39.1 `src/pod.rs` (the read half).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Tools for converting file format structures to and from bytes.
//!
//! This module should be replaced once rust provides safe transmutes.
//
// PORT: a `Pod` type is described by a `Pod<T>` value: its `size_of`, `align_of` and a reader
// that decodes a `T` from the bytes at an offset. `&'data T` is the decoded `T` (a plain object
// whose byte-array fields stay views into the data). `&'data [T]` is a `PodSlice<T>`: a view over
// the bytes that decodes elements on access, so slicing a large table (symbols, sections) costs
// nothing until it is read, as upstream's zero-copy cast.
// PORT: `ptr as usize % align_of::<T>()` is `byteOffset % align` of the view. Every type the
// ported code reads has alignment 1 (`unaligned` feature), so the check never fails; it is kept.
// The `_mut` functions and `bytes_of*` (write side) are not ported.

import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";

/// A trait for types that can safely be converted from and to byte slices.
///
/// Note: `Pod` is implemented for `[T; 0]`, but this isn't useful in practice
/// and may be removed or become a compile-time error in future.
export interface Pod<T> {
  /** `mem::size_of::<T>()` */
  readonly size: number;
  /** `mem::align_of::<T>()` */
  readonly align: number;
  /** Decode the `T` stored at `data[offset..offset + size]` (the caller checks the bounds). */
  read(data: Uint8Array, offset: number): T;
}

/** A `Pod` scalar of `size` bytes and alignment 1. */
export function pod_scalar<T>(size: number, read: (data: Uint8Array, offset: number) => T): Pod<T> {
  return { size, align: 1, read };
}

/** `u8` */
export const pod_u8: Pod<number> = pod_scalar(1, (d, o) => d[o]!);

/** `[u8; N]`: a view of the N bytes. */
export function pod_bytes(n: number): Pod<Uint8Array> {
  return pod_scalar(n, (d, o) => d.subarray(o, o + n));
}

/** `[T; N]` of a `Pod` element type. */
export function pod_array<T>(elem: Pod<T>, n: number): Pod<T[]> {
  return {
    size: elem.size * n,
    align: elem.align,
    read(d, o) {
      const out: T[] = [];
      for (let i = 0; i < n; i++) out.push(elem.read(d, o + i * elem.size));
      return out;
    },
  };
}

/**
 * A `#[repr(C)]` struct whose fields all have alignment 1 (so no padding): the fields' `Pod`s in
 * declaration order, and the constructor taking the decoded fields in that order.
 */
export function pod_struct<T>(fields: readonly Pod<unknown>[], make: (...vals: never[]) => T): Pod<T> {
  let size = 0;
  for (const f of fields) {
    // PORT: every field type here has alignment 1 (`unaligned` feature), so offsets are cumulative.
    if (f.align !== 1) panic("pod_struct: field with alignment > 1");
    size += f.size;
  }
  return {
    size,
    align: 1,
    read(d, o) {
      const vals: unknown[] = [];
      let at = o;
      for (const f of fields) {
        vals.push(f.read(d, at));
        at += f.size;
      }
      return (make as (...v: unknown[]) => T)(...vals);
    },
  };
}

/** `&'data [T]` for a `Pod` `T`: a view over `len * size_of::<T>()` bytes. */
export class PodSlice<T> {
  constructor(
    /** The bytes of the whole slice. */
    readonly data: Uint8Array,
    readonly pod: Pod<T>,
    readonly length: number,
  ) {}

  static empty<T>(pod: Pod<T>): PodSlice<T> {
    return new PodSlice(new Uint8Array(0), pod, 0);
  }

  len(): number {
    return this.length;
  }

  is_empty(): boolean {
    return this.length === 0;
  }

  /** `slice.get(index)` */
  get(index: number): T | undefined {
    if (!(index >= 0 && index < this.length)) return undefined;
    return this.pod.read(this.data, index * this.pod.size);
  }

  /** `slice[index]` (panics when out of bounds, like indexing). */
  at(index: number): T {
    const v = this.get(index);
    if (v === undefined) panic(`index out of bounds: the len is ${this.length} but the index is ${index}`);
    return v;
  }

  /** `&slice[start..]` */
  slice_from(start: number): PodSlice<T> {
    return new PodSlice(this.data.subarray(start * this.pod.size), this.pod, this.length - start);
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.length; i++) yield this.pod.read(this.data, i * this.pod.size);
  }
}

/// Cast the head of a byte slice to a `Pod` type.
///
/// Returns the type and the tail of the byte slice.
///
/// Returns an error if the byte slice is too short or the alignment is invalid.
// crate: object-0.39.1/src/pod.rs:33 from_bytes
export function from_bytes<T>(pod: Pod<T>, data: Uint8Array): Result<[T, Uint8Array], undefined> {
  const size = pod.size;
  if (size > data.length) return Err(undefined);
  const tail = data.subarray(size);
  if (data.byteOffset % pod.align !== 0) {
    return Err(undefined);
  }
  // Safety:
  // The alignment and size are checked by this function.
  // The Pod trait ensures the type is valid to cast from bytes.
  const val = pod.read(data, 0);
  return Ok([val, tail]);
}

/// Cast the head of a byte slice to a slice of a `Pod` type.
///
/// Returns the type slice and the tail of the byte slice.
///
/// Returns an error if the byte slice is too short or the alignment is invalid.
// crate: object-0.39.1/src/pod.rs:76 slice_from_bytes
export function slice_from_bytes<T>(pod: Pod<T>, data: Uint8Array, count: number): Result<[PodSlice<T>, Uint8Array], undefined> {
  const size = count * pod.size;
  // PORT: `count.checked_mul(size_of)`: counts come from u32/u64 fields; a product beyond 2^53
  // exceeds any buffer, as an overflowing one fails `get(size..)` upstream.
  if (!Number.isSafeInteger(size)) return Err(undefined);
  if (size > data.length) return Err(undefined);
  const tail = data.subarray(size);
  if (data.byteOffset % pod.align !== 0) {
    return Err(undefined);
  }
  // Safety:
  // The alignment and size are checked by this function.
  // The Pod trait ensures the type is valid to cast from bytes.
  const slice = new PodSlice(data.subarray(0, size), pod, count);
  return Ok([slice, tail]);
}

/// Cast all of a byte slice to a slice of a `Pod` type.
///
/// Returns the type slice.
///
/// Returns an error if the size of the byte slice is not an exact multiple
/// of the type size, or the alignment is invalid.
// crate: object-0.39.1/src/pod.rs:123 slice_from_all_bytes
export function slice_from_all_bytes<T>(pod: Pod<T>, data: Uint8Array): Result<PodSlice<T>, undefined> {
  // TODO: change to compile time assert when MSRV allows.
  const size = pod.size;
  if (size === 0) {
    return Err(undefined);
  }
  const count = Math.floor(data.length / size);
  const r = slice_from_bytes(pod, data, count);
  if (r.$ === "Err") return r;
  const [slice, tail] = r._0;
  if (tail.length !== 0) {
    return Err(undefined);
  }
  return Ok(slice);
}
