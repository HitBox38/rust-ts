// Port of object 0.39.1 `src/write/util.rs` (the part the ELF writer reaches: `WritableBuffer`, the `Vec<u8>` impl,
// `align`, `write_align`). `StreamingBuffer`, `BytesMut` and the LEB128 writers are not ported: nothing reaches them.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `Vec<u8>` as a `WritableBuffer` is `VecBuffer`, a growable `Uint8Array`. `write_pod` of the `repr(C)` ELF structs
// goes through their own field writers in elf/writer.ts (`BytesWriter`): those structs have no padding, so writing their
// fields in order is `bytes_of`.

/// Trait for writable buffer.
export interface WritableBuffer {
  /// Returns position/offset for data to be written at.
  ///
  /// Should only be used in combination with `write_bytes`.
  len(): number;

  /// Reserves specified number of bytes in the buffer.
  ///
  /// This will be called exactly once before writing anything to the buffer,
  /// and the given size is the exact total number of bytes that will be written.
  reserve(size: number): void;

  /// Writes zero bytes at the end of the buffer until the buffer
  /// has the specified length.
  resize(new_len: number): void;

  /// Writes the specified slice of bytes at the end of the buffer.
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

// crate: object-0.39.1/src/write/util.rs:228 align
export function align(offset: number, size: number): number {
  // PORT: `(offset + (size - 1)) & !(size - 1)` on `usize`; a bit `&` here would wrap at 2^31 and these offsets need not
  // fit (`size` is a power of two).
  const n = offset + (size - 1);
  return n - (n % size);
}

// crate: object-0.39.1/src/write/util.rs:242 write_align
export function write_align(buffer: WritableBuffer, size: number): void {
  const new_len = align(buffer.len(), size);
  buffer.resize(new_len);
}
