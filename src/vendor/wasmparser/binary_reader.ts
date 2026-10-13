// Port of wasmparser 0.247.0 `src/binary_reader.rs` (the reader primitives the module parser and
// object's Wasm reader use).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
// PORT: features as rustc builds wasmparser (via object's `wasm` feature): `component-model` is
// on, `features` / `validate` / `simd` are off (see docs/handoff/object-read.md). Without
// `features` the reader has no `features` field. The operator visitor, signed/float readers and
// block types are not ported (unused on rustc's path).

import { type Debug, debug_list, PRETTY } from "../../std/fmt.ts";
import { Err, Ok, type Result as StdResult } from "../../std/result.ts";
import { MAX_WASM_STRING_SIZE } from "./limits.ts";

export const WASM_MAGIC_NUMBER: Uint8Array = new Uint8Array([0x00, 0x61, 0x73, 0x6d]); // b"\0asm"

/// A binary reader for WebAssembly modules.
export class BinaryReaderError {
  // Wrap the actual error data in a `Box` so that the error is just one
  // word. This means that we can continue returning small `Result`s in
  // registers.
  constructor(readonly inner: BinaryReaderErrorInner) {}

  // crate: wasmparser-0.247.0/src/binary_reader.rs:65 _new
  static _new(kind: BinaryReaderErrorKind, message: string, offset: number): BinaryReaderError {
    return new BinaryReaderError({ kind, message, offset, needed_hint: undefined });
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:77 new
  static new(message: string, offset: number): BinaryReaderError {
    return BinaryReaderError._new("Custom", message, offset);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:82 invalid
  static invalid(msg: string, offset: number): BinaryReaderError {
    return BinaryReaderError._new("Invalid", msg, offset);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:87 fmt
  static fmt(args: string, offset: number): BinaryReaderError {
    return BinaryReaderError.new(args, offset);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:92 eof
  static eof(offset: number, needed_hint: number): BinaryReaderError {
    const err = BinaryReaderError.new("unexpected end-of-file", offset);
    err.inner.needed_hint = needed_hint;
    return err;
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:98 kind
  kind(): BinaryReaderErrorKind {
    return this.inner.kind;
  }

  /// Get this error's message.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:103 message
  message(): string {
    return this.inner.message;
  }

  /// Get the offset within the Wasm binary where the error occurred.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:108 offset
  offset(): number {
    return this.inner.offset;
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:117 set_message
  set_message(message: string): void {
    this.inner.message = message;
  }
}

export interface BinaryReaderErrorInner {
  message: string;
  kind: BinaryReaderErrorKind;
  offset: number;
  needed_hint: number | undefined;
}

export type BinaryReaderErrorKind = "Custom" | "Invalid";

/// The result for `BinaryReader` operations.
export type Result<T> = StdResult<T, BinaryReaderError>;

// crate: wasmparser-0.247.0/src/binary_reader.rs:54 fmt
export function display_BinaryReaderError(self: BinaryReaderError): string {
  return `${self.inner.message} (at offset 0x${self.inner.offset.toString(16)})`;
}

/** `{:#x?}` of a byte slice (pretty `Debug` list of `{:#x}` bytes). */
const debug_bytes_alt_hex: Debug<Uint8Array> = (v) => debug_list(PRETTY, [...v].map((b) => `0x${b.toString(16)}`));

/// A binary reader of the WebAssembly structures and types.
export class BinaryReader {
  constructor(
    public buffer: Uint8Array,
    public position: number,
    public original_offset: number,
  ) {}

  /// Creates a new binary reader which will parse the `data` provided.
  ///
  /// The `original_offset` provided is used for byte offsets in errors that
  /// are generated. That offset is added to the current position in `data`.
  /// This can be helpful when `data` is just a window of a view into a larger
  /// wasm binary perhaps not even entirely stored locally.
  ///
  /// The returned binary reader will have all features known to this crate
  /// enabled. To reject binaries that aren't valid unless a certain feature
  /// is enabled use the [`BinaryReader::new_features`] constructor instead.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:155 new
  static new(data: Uint8Array, original_offset: number): BinaryReader {
    return new BinaryReader(data, 0, original_offset);
  }

  clone(): BinaryReader {
    return new BinaryReader(this.buffer, this.position, this.original_offset);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:219 shrink
  shrink(): BinaryReader {
    return new BinaryReader(this.buffer.subarray(this.position), 0, this.original_offset + this.position);
  }

  /// Gets the original position of the binary reader.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:231 original_position
  original_position(): number {
    return this.original_offset + this.position;
  }

  /// Returns a range from the starting offset to the end of the buffer.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:253 range
  range(): [number, number] {
    return [this.original_offset, this.original_offset + this.buffer.length];
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:257 remaining_buffer
  remaining_buffer(): Uint8Array {
    return this.buffer.subarray(this.position);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:261 ensure_has_byte
  ensure_has_byte(): Result<undefined> {
    if (this.position < this.buffer.length) {
      return Ok(undefined);
    } else {
      return Err(BinaryReaderError.eof(this.original_position(), 1));
    }
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:269 ensure_has_bytes
  ensure_has_bytes(len: number): Result<undefined> {
    if (this.position + len <= this.buffer.length) {
      return Ok(undefined);
    } else {
      const hint = this.position + len - this.buffer.length;
      return Err(BinaryReaderError.eof(this.original_position(), hint));
    }
  }

  /// Reads a value of type `T` from this binary reader, advancing the
  /// internal position in this reader forward as data is read.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:281 read
  read<T>(T: FromReader<T>): Result<T> {
    return T(this);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:288 read_u7
  read_u7(): Result<number> {
    const r = this.read_u8();
    if (r.$ === "Err") return r;
    const b = r._0;
    if ((b & 0x80) !== 0) {
      return Err(BinaryReaderError.new("invalid u7", this.original_position() - 1));
    }
    return Ok(b);
  }

  /// Returns whether the `BinaryReader` has reached the end of the file.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:347 eof
  eof(): boolean {
    return this.position >= this.buffer.length;
  }

  /// Returns the `BinaryReader`'s current position.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:353 current_position
  current_position(): number {
    return this.position;
  }

  /// Returns the number of bytes remaining in the `BinaryReader`.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:359 bytes_remaining
  bytes_remaining(): number {
    return this.buffer.length - this.position;
  }

  /// Advances the `BinaryReader` `size` bytes, and returns a slice from the
  /// current position of `size` length.
  ///
  /// # Errors
  /// If `size` exceeds the remaining length in `BinaryReader`.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:368 read_bytes
  read_bytes(size: number): Result<Uint8Array> {
    const e = this.ensure_has_bytes(size);
    if (e.$ === "Err") return e;
    const start = this.position;
    this.position += size;
    return Ok(this.buffer.subarray(start, this.position));
  }

  /// Reads a length-prefixed list of bytes from this reader and returns a
  /// new `BinaryReader` to read that list of bytes.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:377 read_reader
  read_reader(): Result<BinaryReader> {
    const s = this.read_var_u32();
    if (s.$ === "Err") return s;
    const size = s._0;
    return this.skip((reader) => {
      const r = reader.read_bytes(size);
      if (r.$ === "Err") return r;
      return Ok(undefined);
    });
  }

  /// Advances the `BinaryReader` four bytes and returns a `u32`.
  /// # Errors
  /// If `BinaryReader` has less than four bytes remaining.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:388 read_u32
  read_u32(): Result<number> {
    const e = this.ensure_has_bytes(4);
    if (e.$ === "Err") return e;
    const b = this.buffer;
    const p = this.position;
    const word = (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
    this.position += 4;
    return Ok(word);
  }

  /// Advances the `BinaryReader` a single byte.
  ///
  /// # Errors
  ///
  /// If `BinaryReader` has no bytes remaining.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:419 read_u8
  read_u8(): Result<number> {
    const b = this.buffer[this.position];
    if (b === undefined) return Err(this.eof_err());
    this.position += 1;
    return Ok(b);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:429 eof_err
  eof_err(): BinaryReaderError {
    return BinaryReaderError.eof(this.original_position(), 1);
  }

  /// Advances the `BinaryReader` up to four bytes to parse a variable
  /// length integer as a `u32`.
  ///
  /// # Errors
  ///
  /// If `BinaryReader` has less than one or up to four bytes remaining, or
  /// the integer is larger than 32 bits.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:441 read_var_u32
  read_var_u32(): Result<number> {
    // Optimization for single byte i32.
    const r = this.read_u8();
    if (r.$ === "Err") return r;
    const byte = r._0;
    if ((byte & 0x80) === 0) {
      return Ok(byte);
    } else {
      return this.read_var_u32_big(byte);
    }
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:451 read_var_u32_big
  read_var_u32_big(byte0: number): Result<number> {
    let result = byte0 & 0x7f;
    let shift = 7;
    for (;;) {
      const r = this.read_u8();
      if (r.$ === "Err") return r;
      const byte = r._0;
      result = (result | ((byte & 0x7f) << shift)) >>> 0;
      if (shift >= 25 && byte >> (32 - shift) !== 0) {
        const msg = (byte & 0x80) !== 0 ? "invalid var_u32: integer representation too long" : "invalid var_u32: integer too large";
        // The continuation bit or unused bits are set.
        return Err(BinaryReaderError.new(msg, this.original_position() - 1));
      }
      shift += 7;
      if ((byte & 0x80) === 0) {
        break;
      }
    }
    return Ok(result);
  }

  /// Executes `f` to skip some data in this binary reader and then returns a
  /// reader which will read the skipped data.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:517 skip
  skip(f: (reader: BinaryReader) => Result<undefined>): Result<BinaryReader> {
    const start = this.position;
    const r = f(this);
    if (r.$ === "Err") return r;
    const ret = this.clone();
    ret.buffer = this.buffer.subarray(start, this.position);
    ret.position = 0;
    ret.original_offset = this.original_offset + start;
    return Ok(ret);
  }

  /// (internal) Reads a fixed-size WebAssembly string from the module.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:679 internal_read_string
  internal_read_string(len: number): Result<string> {
    const bytes = this.read_bytes(len);
    if (bytes.$ === "Err") return bytes;
    try {
      return Ok(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes._0));
    } catch {
      return Err(BinaryReaderError.new("malformed UTF-8 encoding", this.original_position() - 1));
    }
  }

  /// Reads a WebAssembly string from the module.
  ///
  /// # Errors
  ///
  /// If `BinaryReader` has less than up to four bytes remaining, the string's
  /// length exceeds the remaining bytes, the string's length exceeds
  /// `limits::MAX_WASM_STRING_SIZE`, or the string contains invalid utf-8.
  // crate: wasmparser-0.247.0/src/binary_reader.rs:693 read_string
  read_string(): Result<string> {
    const l = this.read_var_u32();
    if (l.$ === "Err") return l;
    const len = l._0;
    if (len > MAX_WASM_STRING_SIZE) {
      return Err(BinaryReaderError.new("string size out of bounds", this.original_position() - 1));
    }
    return this.internal_read_string(len);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:731 peek
  peek(): Result<number> {
    const e = this.ensure_has_byte();
    if (e.$ === "Err") return e;
    return Ok(this.buffer[this.position]!);
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:736 peek_bytes
  peek_bytes(len: number): Result<Uint8Array> {
    const e = this.ensure_has_bytes(len);
    if (e.$ === "Err") return e;
    return Ok(this.buffer.subarray(this.position, this.position + len));
  }

  // crate: wasmparser-0.247.0/src/binary_reader.rs:787 read_header_version
  read_header_version(): Result<number> {
    const m = this.read_bytes(4);
    if (m.$ === "Err") return m;
    const magic_number = m._0;
    if (!bytes_eq(magic_number, WASM_MAGIC_NUMBER)) {
      return Err(
        BinaryReaderError.new(
          `magic header not detected: bad magic number - expected=${debug_bytes_alt_hex(WASM_MAGIC_NUMBER, PRETTY)} actual=${debug_bytes_alt_hex(magic_number, PRETTY)}`,
          this.original_position() - 4,
        ),
      );
    }
    return this.read_u32();
  }
}

/** `&[u8] == &[u8]` */
export function bytes_eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/// Types that can be parsed from a [`BinaryReader`] (readers.rs `FromReader`).
/// PORT: the trait is a function value (`T::from_reader`).
export type FromReader<T> = (reader: BinaryReader) => Result<T>;
