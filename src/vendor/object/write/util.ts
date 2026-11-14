// Port of object 0.39.1 `src/write/util.rs`: `WritableBuffer`, the `Vec<u8>` impl, `BytesMut`, the LEB128 writers and the
// alignment helpers. `StreamingBuffer` (over `std::io::Write`) and the provided `write_pod`/`write_pod_slice`/`write`/
// `write_slice` are not ported: the writers write their `repr(C)` structs through their own field writers.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `Vec<u8>` as a `WritableBuffer` is `VecBuffer`, a growable `Uint8Array`. `write_pod` of the `repr(C)` ELF structs
// goes through their own field writers in elf/writer.ts (`BytesWriter`): those structs have no padding, so writing their
// fields in order is `bytes_of`.

import { Err, Ok, type Result } from "../../../std/result.ts";

/// Trait for writable buffer.
export interface WritableBuffer {
  /// Returns position/offset for data to be written at.
  ///
  /// Should only be used in debug assertions
  // crate: object-0.39.1/src/write/util.rs:13 len
  len(): number;

  /// Reserves specified number of bytes in the buffer.
  ///
  /// This will be called exactly once before writing anything to the buffer,
  /// and the given size is the exact total number of bytes that will be written.
  /** PORT: `-> Result<(), ()>`; `VecBuffer`'s cannot fail, so it returns nothing. */
  // crate: object-0.39.1/src/write/util.rs:19 reserve
  reserve(size: number): void;

  /// Writes zero bytes at the end of the buffer until the buffer
  /// has the specified length.
  // crate: object-0.39.1/src/write/util.rs:23 resize
  resize(new_len: number): void;

  /// Writes the specified slice of bytes at the end of the buffer.
  // crate: object-0.39.1/src/write/util.rs:26 write_bytes
  write_bytes(val: Uint8Array): void;
}

/** `Vec<u8>`: `data` is the allocation, `length` the `Vec`'s length. */
export class VecBuffer implements WritableBuffer {
  private data = new Uint8Array(0);
  private length = 0;

  /** `Vec::into_boxed_slice`, in effect: the bytes written. */
  finish(): Uint8Array {
    return this.data.subarray(0, this.length);
  }

  private grow(min: number): void {
    if (min <= this.data.length) return;
    const next = new Uint8Array(Math.max(min, this.data.length * 2, 64));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  // impl WritableBuffer for Vec<u8>
  // crate: object-0.39.1/src/write/util.rs:59 len
  len(): number {
    return this.length;
  }

  // crate: object-0.39.1/src/write/util.rs:64 reserve
  reserve(size: number): void {
    // debug_assert!(self.is_empty());
    this.grow(size);
  }

  // crate: object-0.39.1/src/write/util.rs:71 resize
  resize(new_len: number): void {
    // debug_assert!(new_len >= self.len());
    this.grow(new_len);
    this.data.fill(0, this.length, new_len);
    this.length = new_len;
  }

  // crate: object-0.39.1/src/write/util.rs:77 write_bytes
  write_bytes(val: Uint8Array): void {
    // debug_assert!(self.len() + val.len() <= self.capacity());
    this.grow(this.length + val.length);
    this.data.set(val, this.length);
    this.length += val.length;
  }
}

/// A trait for mutable byte slices.
///
/// It provides convenience methods for `Pod` types.
/** PORT: `BytesMut::write_at` on `&mut [u8]`, with the `Pod` value as its bytes (`bytes_of(val)`). */
// crate: object-0.39.1/src/write/util.rs:163 write_at
// crate: object-0.39.1/src/write/util.rs:168 write_at
export function write_at(self: Uint8Array, offset: number, src: Uint8Array): Result<null, null> {
  // `self.get_mut(offset..)` then `.get_mut(..src.len())`
  if (offset > self.length) return Err(null);
  if (src.length > self.length - offset) return Err(null);
  self.set(src, offset);
  return Ok(null);
}

/// Write an unsigned number using the LEB128 encoding to a buffer.
///
/// Returns the number of bytes written.
// crate: object-0.39.1/src/write/util.rs:181 write_uleb128
export function write_uleb128(buf: number[], val: bigint): number {
  // PORT: `val: u64`, as a `bigint` in `0..2^64`.
  let len = 0;
  for (;;) {
    let byte = Number(val & 0x7fn);
    val >>= 7n;
    const done = val === 0n;
    if (!done) {
      byte |= 0x80;
    }

    buf.push(byte);
    len += 1;

    if (done) {
      return len;
    }
  }
}

/// Write a signed number using the LEB128 encoding to a buffer.
///
/// Returns the number of bytes written.
// crate: object-0.39.1/src/write/util.rs:204 write_sleb128
export function write_sleb128(buf: number[], val: bigint): number {
  // PORT: `val: i64`, as a `bigint`; `>>` on a negative `bigint` is arithmetic, as on `i64`.
  let len = 0;
  for (;;) {
    let byte = Number(BigInt.asUintN(8, val));
    // Keep the sign bit for testing
    val >>= 6n;
    const done = val === 0n || val === -1n;
    if (done) {
      byte &= ~0x80 & 0xff;
    } else {
      // Remove the sign bit
      val >>= 1n;
      byte |= 0x80;
    }

    buf.push(byte);
    len += 1;

    if (done) {
      return len;
    }
  }
}

// crate: object-0.39.1/src/write/util.rs:228 align
export function align(offset: number, size: number): number {
  // PORT: `(offset + (size - 1)) & !(size - 1)` on `usize`; a bit `&` here would wrap at 2^31 and these offsets need not
  // fit (`size` is a power of two).
  const n = offset + (size - 1);
  return n - (n % size);
}

// crate: object-0.39.1/src/write/util.rs:233 align_u32
export function align_u32(offset: number, size: number): number {
  return ((offset + (size - 1)) & ~(size - 1)) >>> 0;
}

// crate: object-0.39.1/src/write/util.rs:238 align_u64
export function align_u64(offset: number, size: number): number {
  // PORT: as `align`: remainders, not a bit `&`.
  const n = offset + (size - 1);
  return n - (n % size);
}

// crate: object-0.39.1/src/write/util.rs:242 write_align
export function write_align(buffer: WritableBuffer, size: number): void {
  const new_len = align(buffer.len(), size);
  buffer.resize(new_len);
}
