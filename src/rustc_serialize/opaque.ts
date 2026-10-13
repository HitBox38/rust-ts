// Port of compiler/rustc_serialize/src/opaque.rs.
//
// PORT: representation.
// - `FileEncoder::file: File` is a Node file descriptor (`openSync`); `File::write_all` is a
//   `writeSync` loop. The fields `file`/`path` clash with their accessor methods `file()`/`path()`:
//   they are `file_`/`path_`. `Drop` (closing the file) is the explicit `drop()` (not upstream code;
//   Rust's `File` closes itself when the encoder is dropped).
// - `MemDecoder`'s three pointers are indices into the bytes it was built from: `start <= current <= end`.
// - `write_with::<N>(visitor)` / `read_array::<N>()` take `N` as their first argument; the visitor's
//   `&mut [u8; N]` is a `Uint8Array` view of `N` bytes.
// - The `[u8]` / `Vec<u8>` / `IntEncodedWithFixedSize` specializations are separate fns
//   (`FileEncoder_encode_slice_u8`, `MemDecoder_decode_Vec_u8`, ...): TS has no specialization, and
//   they produce the same bytes as the generic impls in serialize.ts.
import { closeSync, openSync, writeSync } from "node:fs";
import { type IoError, type IoResult, io_error_from_node } from "../std/io.ts";
import { assert, panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { debug_strict_add } from "./int_overflow.ts";
import * as leb128 from "./leb128.ts";
import { type Decoder, Decoder_provided, type Encoder, Encoder_provided } from "./serialize.ts";

export * from "./opaque/mem_encoder.ts";

// -----------------------------------------------------------------------------
// Encoder
// -----------------------------------------------------------------------------

export type FileEncodeResult = Result<number, readonly [string, IoError]>;

export const MAGIC_END_BYTES: Uint8Array = new TextEncoder().encode("rust-end-file");

/// The size of the buffer in `FileEncoder`.
const BUF_SIZE = 64 * 1024;

/** `File::write_all(buf)`: write the whole buffer, retrying short writes. */
function file_write_all(fd: number, buf: Uint8Array): Result<null, IoError> {
  let off = 0;
  try {
    while (off < buf.length) {
      const n = writeSync(fd, buf, off, buf.length - off);
      if (n === 0) return Err({ $: "SimpleMessage", kind: "WriteZero", message: "failed to write whole buffer" });
      off += n;
    }
  } catch (e) {
    return Err(io_error_from_node(e));
  }
  return Ok(null);
}

/// `FileEncoder` encodes data to file via fixed-size buffer.
///
/// There used to be a `MemEncoder` type that encoded all the data into a
/// `Vec`. `FileEncoder` is better because its memory use is determined by the
/// size of the buffer, rather than the full length of the encoded data, and
/// because it doesn't need to reallocate memory along the way.
///
/// The `'a` lifetime is the borrow of the optional flush strategy (see
/// `flush_strategy`); it is unused (`'static`) for encoders created without one.
export class FileEncoder implements Encoder {
  constructor(
    // The input buffer. For adequate performance, we need to be able to write
    // directly to the unwritten region of the buffer, without calling copy_from_slice.
    // Note that our buffer is always initialized so that we can do that direct access
    // without unsafe code. Users of this type write many more than BUF_SIZE bytes, so the
    // initialization is approximately free.
    public buf: Uint8Array,
    public buffered: number,
    public flushed: number,
    public file_: number,
    // This is used to implement delayed error handling, as described in the
    // comment on `trait Encoder`.
    public res: Result<null, IoError>,
    public path_: string,
    public flush_strategy: ((buf: Uint8Array) => void) | undefined,
    // `#[cfg(debug_assertions)] finished: bool` is compiled out of rustc.
  ) {}

  // rustc: compiler/rustc_serialize/src/opaque.rs:55 new
  static new(path: string): IoResult<FileEncoder> {
    // File::create opens the file for writing only. When -Zmeta-stats is enabled, the metadata
    // encoder rewinds the file to inspect what was written. So we need to always open the file
    // for reading and writing.
    let file: number;
    try {
      // `File::options().read(true).write(true).create(true).truncate(true).open(&path)?`
      file = openSync(path, "w+");
    } catch (e) {
      return Err(io_error_from_node(e));
    }

    return Ok(new FileEncoder(new Uint8Array(BUF_SIZE), 0, 0, file, Ok(null), path, undefined));
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:75 with_flush_strategy
  static with_flush_strategy(path: string, strategy: (buf: Uint8Array) => void): IoResult<FileEncoder> {
    const r = FileEncoder.new(path);
    if (r.$ === "Err") return r;
    const encoder = r._0;
    encoder.flush_strategy = strategy;
    return Ok(encoder);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:85 position
  position(): number {
    // Tracking position this way instead of having a `self.position` field
    // means that we only need to update `self.buffered` on a write call,
    // as opposed to updating `self.position` and `self.buffered`.
    return debug_strict_add(this.flushed, this.buffered);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:94 flush
  flush(): void {
    if (this.res.$ === "Ok") {
      this.res = file_write_all(this.file_, this.buf.subarray(0, this.buffered));
    }
    this.flushed += this.buffered;
    const f = this.flush_strategy;
    if (f !== undefined) {
      f(this.buf.subarray(0, this.buffered));
    }
    this.buffered = 0;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:110 file
  file(): number {
    return this.file_;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:115 path
  path(): string {
    return this.path_;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:120 buffer_empty
  buffer_empty(): Uint8Array {
    // SAFETY: self.buffered is inbounds as an invariant of the type
    return this.buf.subarray(this.buffered);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:127 write_all_cold_path
  write_all_cold_path(buf: Uint8Array): void {
    this.flush();
    if (buf.length <= this.buf.length) {
      // `if let Some(dest) = self.buf.get_mut(..buf.len())`
      this.buf.set(buf, 0);
      this.buffered += buf.length;
    } else {
      if (this.res.$ === "Ok") {
        this.res = file_write_all(this.file_, buf);
        const f = this.flush_strategy;
        if (f !== undefined) {
          f(buf);
        }
      }
      this.flushed += buf.length;
    }
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:144 write_all
  write_all(buf: Uint8Array): void {
    // `if let Some(dest) = self.buffer_empty().get_mut(..buf.len())`
    if (buf.length <= this.buf.length - this.buffered) {
      this.buf.set(buf, this.buffered);
      this.buffered = debug_strict_add(this.buffered, buf.length);
    } else {
      this.write_all_cold_path(buf);
    }
  }

  /// Write up to `N` bytes to this encoder.
  ///
  /// This function can be used to avoid the overhead of calling memcpy for writes that
  /// have runtime-variable length, but are small and have a small fixed upper bound.
  ///
  /// This can be used to do in-place encoding as is done for leb128 (without this function
  /// we would need to write to a temporary buffer then memcpy into the encoder), and it can
  /// also be used to implement the varint scheme we use for rmeta and dep graph encoding,
  /// where we only want to encode the first few bytes of an integer. Copying in the whole
  /// integer then only advancing the encoder state for the few bytes we care about is more
  /// efficient than calling [`FileEncoder::write_all`], because variable-size copies are
  /// always lowered to `memcpy`, which has overhead and contains a lot of logic we can bypass
  /// with this function. Note that common architectures support fixed-size writes up to 8 bytes
  /// with one instruction, so while this does in some sense do wasted work, we come out ahead.
  // rustc: compiler/rustc_serialize/src/opaque.rs:172 write_with
  write_with(N: number, visitor: (buf: Uint8Array) => number): void {
    // `const { BUF_SIZE.checked_sub(N).unwrap() }`
    assert(N <= BUF_SIZE, "called `Option::unwrap()` on a `None` value");
    const flush_threshold = BUF_SIZE - N;
    if (this.buffered > flush_threshold) {
      this.flush();
    }
    // SAFETY: We checked above that N < self.buffer_empty().len(),
    // and if isn't, flush ensures that our empty buffer is now BUF_SIZE.
    // We produce a post-mono error if N > BUF_SIZE.
    const buf = this.buf.subarray(this.buffered, this.buffered + N);
    const written = visitor(buf);
    // We have to ensure that an errant visitor cannot cause self.buffered to exceed BUF_SIZE.
    if (written > N) {
      FileEncoder.panic_invalid_write(N, written);
    }
    this.buffered = debug_strict_add(this.buffered, written);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:195 panic_invalid_write
  static panic_invalid_write(N: number, written: number): void {
    panic(`FileEncoder::write_with::<${N}> cannot be used to write ${written} bytes`);
  }

  /// Helper for calls where [`FileEncoder::write_with`] always writes the whole array.
  // rustc: compiler/rustc_serialize/src/opaque.rs:201 write_array
  write_array(buf: Uint8Array): void {
    const N = buf.length;
    this.write_with(N, (dest) => {
      dest.set(buf);
      return N;
    });
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:208 finish
  finish(): FileEncodeResult {
    this.write_all(MAGIC_END_BYTES);
    this.flush();
    // `match std::mem::replace(&mut self.res, Ok(()))`
    const res = this.res;
    this.res = Ok(null);
    switch (res.$) {
      case "Ok":
        return Ok(this.position());
      case "Err":
        return Err([this.path_, res._0]);
    }
  }

  /** PORT: dropping the encoder drops (closes) its `File`; TS has no destructors, so callers call this. */
  drop(): void {
    closeSync(this.file_);
  }

  // `write_leb128!(emit_usize, usize, write_usize_leb128)` ...
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_usize (write_leb128!)
  emit_usize(v: number): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_usize_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_u128 (write_leb128!)
  emit_u128(v: bigint): void {
    this.write_with(leb128.max_leb128_len(16), (buf) => leb128.write_u128_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_u64 (write_leb128!)
  emit_u64(v: bigint): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_u64_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_u32 (write_leb128!)
  emit_u32(v: number): void {
    this.write_with(leb128.max_leb128_len(4), (buf) => leb128.write_u32_leb128(buf, v));
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:247 emit_u16
  emit_u16(v: number): void {
    this.write_array(u16_to_le_bytes(v));
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:252 emit_u8
  emit_u8(v: number): void {
    this.write_array(new Uint8Array([v]));
  }

  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_isize (write_leb128!)
  emit_isize(v: number): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_isize_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_i128 (write_leb128!)
  emit_i128(v: bigint): void {
    this.write_with(leb128.max_leb128_len(16), (buf) => leb128.write_i128_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_i64 (write_leb128!)
  emit_i64(v: bigint): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_i64_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:234 emit_i32 (write_leb128!)
  emit_i32(v: number): void {
    this.write_with(leb128.max_leb128_len(4), (buf) => leb128.write_i32_leb128(buf, v));
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:262 emit_i16
  emit_i16(v: number): void {
    this.write_array(u16_to_le_bytes(v & 0xffff));
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:267 emit_raw_bytes
  emit_raw_bytes(s: Uint8Array): void {
    this.write_all(s);
  }

  // (provided methods of `Encoder`)
  emit_i8(v: number): void {
    Encoder_provided.emit_i8(this, v);
  }
  emit_bool(v: boolean): void {
    Encoder_provided.emit_bool(this, v);
  }
  emit_char(v: number): void {
    Encoder_provided.emit_char(this, v);
  }
  emit_str(v: string): void {
    Encoder_provided.emit_str(this, v);
  }
  emit_byte_str(v: Uint8Array): void {
    Encoder_provided.emit_byte_str(this, v);
  }
}

// rustc-skip: compiler/rustc_serialize/src/opaque.rs:224 drop `#[cfg(debug_assertions)] impl Drop for FileEncoder` (asserts `finished`): compiled out of rustc

/** `v.to_le_bytes()` of a `u16` (or the bits of an `i16`). */
export function u16_to_le_bytes(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}

// -----------------------------------------------------------------------------
// Decoder
// -----------------------------------------------------------------------------

// Conceptually, `MemDecoder` wraps a `&[u8]` with a cursor into it that is always valid.
// This is implemented with three pointers, two which represent the original slice and a
// third that is our cursor.
// It is an invariant of this type that start <= current <= end.
// Additionally, the implementation of this type never modifies start and end.
export class MemDecoder implements Decoder {
  constructor(
    /** PORT: the memory `start`/`current`/`end` point into. */
    readonly bytes: Uint8Array,
    readonly start: number,
    public current: number,
    readonly end: number,
  ) {}

  // rustc: compiler/rustc_serialize/src/opaque.rs:290 new
  static new(data: Uint8Array, position: number): Result<MemDecoder, null> {
    // `let data = data.strip_suffix(MAGIC_END_BYTES).ok_or(())?;`
    const m = MAGIC_END_BYTES.length;
    if (data.length < m) return Err(null);
    for (let i = 0; i < m; i++) if (data[data.length - m + i] !== MAGIC_END_BYTES[i]) return Err(null);
    const len = data.length - m;
    // `data[position..]`
    if (position > len) panic(`range start index ${position} out of range for slice of length ${len}`);
    return Ok(new MemDecoder(data, 0, position, len));
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:297 split_at
  split_at(position: number): MemDecoder {
    assert(position <= this.len(), "assertion failed: position <= self.len()");
    // SAFETY: We checked above that this offset is within the original slice
    const current = this.start + position;
    return new MemDecoder(this.bytes, this.start, current, this.end);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:305 len
  len(): number {
    // SAFETY: This recovers the length of the original slice, only using members we never modify.
    return this.end - this.start;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:311 remaining
  remaining(): number {
    // SAFETY: This type guarantees current <= end.
    return this.end - this.current;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:318 decoder_exhausted
  static decoder_exhausted(): never {
    panic("MemDecoder exhausted");
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:323 read_array
  read_array(N: number): Uint8Array {
    return this.read_raw_bytes(N);
  }

  /// While we could manually expose manipulation of the decoder position,
  /// all current users of that method would need to reset the position later,
  /// incurring the bounds check of set_position twice.
  // rustc: compiler/rustc_serialize/src/opaque.rs:331 with_position
  with_position<T>(pos: number, func: (d: MemDecoder) => T): T {
    if (pos >= this.len()) {
      MemDecoder.decoder_exhausted();
    }
    const previous = this.current;
    // SAFETY: We just checked if this add is in-bounds above.
    this.current = this.start + pos;
    const guard = new SetOnDrop(this, previous);
    try {
      return func(guard.decoder);
    } finally {
      guard.drop();
    }
  }

  // `read_leb128!(read_usize, usize, read_usize_leb128)` ...
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_usize (read_leb128!)
  read_usize(): number {
    return leb128.read_usize_leb128(this);
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_u128 (read_leb128!)
  read_u128(): bigint {
    return leb128.read_u128_leb128(this);
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_u64 (read_leb128!)
  read_u64(): bigint {
    return leb128.read_u64_leb128(this);
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_u32 (read_leb128!)
  read_u32(): number {
    return leb128.read_u32_leb128(this);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:374 read_u16
  read_u16(): number {
    const b = this.read_array(2);
    return b[0]! | (b[1]! << 8);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:379 read_u8
  read_u8(): number {
    if (this.current === this.end) {
      MemDecoder.decoder_exhausted();
    }
    // SAFETY: This type guarantees current <= end, and we just checked current == end.
    const byte = this.bytes[this.current]!;
    this.current = this.current + 1;
    return byte;
  }

  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_isize (read_leb128!)
  read_isize(): number {
    return leb128.read_isize_leb128(this);
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_i128 (read_leb128!)
  read_i128(): bigint {
    return leb128.read_i128_leb128(this);
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_i64 (read_leb128!)
  read_i64(): bigint {
    return leb128.read_i64_leb128(this);
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque.rs:361 read_i32 (read_leb128!)
  read_i32(): number {
    return leb128.read_i32_leb128(this);
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:397 read_i16
  read_i16(): number {
    const b = this.read_array(2);
    return ((b[0]! | (b[1]! << 8)) << 16) >> 16;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:402 read_raw_bytes
  read_raw_bytes(bytes: number): Uint8Array {
    if (bytes > this.remaining()) {
      MemDecoder.decoder_exhausted();
    }
    // SAFETY: We just checked if this range is in-bounds above.
    const slice = this.bytes.subarray(this.current, this.current + bytes);
    this.current = this.current + bytes;
    return slice;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:415 peek_byte
  peek_byte(): number {
    if (this.current === this.end) {
      MemDecoder.decoder_exhausted();
    }
    // SAFETY: This type guarantees current is inbounds or one-past-the-end, which is end.
    // Since we just checked current == end, the current pointer must be inbounds.
    return this.bytes[this.current]!;
  }

  // rustc: compiler/rustc_serialize/src/opaque.rs:425 position
  position(): number {
    // SAFETY: This type guarantees start <= current
    return this.current - this.start;
  }

  // (provided methods of `Decoder`)
  read_i8(): number {
    return Decoder_provided.read_i8(this);
  }
  read_bool(): boolean {
    return Decoder_provided.read_bool(this);
  }
  read_char(): number {
    return Decoder_provided.read_char(this);
  }
  read_str(): string {
    return Decoder_provided.read_str(this);
  }
  read_byte_str(): Uint8Array {
    return Decoder_provided.read_byte_str(this);
  }
}

/** `struct SetOnDrop<'a, 'guarded>` local to `MemDecoder::with_position`. */
class SetOnDrop {
  constructor(
    readonly decoder: MemDecoder,
    readonly current: number,
  ) {}

  // rustc: compiler/rustc_serialize/src/opaque.rs:340 drop
  drop(): void {
    this.decoder.current = this.current;
  }
}

// Specializations for contiguous byte sequences follow. The default implementations for slices
// encode and decode each element individually. This isn't necessary for `u8` slices when using
// opaque encoders and decoders, because each `u8` is unchanged by encoding and decoding.
// Therefore, we can use more efficient implementations that process the entire sequence at once.

// Specialize encoding byte slices. This specialization also applies to encoding `Vec<u8>`s, etc.,
// since the default implementations call `encode` on their slices internally.
/** `impl Encodable<FileEncoder<'_>> for [u8]` */
// rustc: compiler/rustc_serialize/src/opaque.rs:439 encode
export function FileEncoder_encode_slice_u8(v: Uint8Array, e: FileEncoder): void {
  e.emit_usize(v.length);
  e.emit_raw_bytes(v);
}

// Specialize decoding `Vec<u8>`. This specialization also applies to decoding `Box<[u8]>`s, etc.,
// since the default implementations call `decode` to produce a `Vec<u8>` internally.
/** `impl<'a> Decodable<MemDecoder<'a>> for Vec<u8>` (a `Vec<u8>` is a `number[]`, as in generated types) */
// rustc: compiler/rustc_serialize/src/opaque.rs:448 decode
export function MemDecoder_decode_Vec_u8(d: MemDecoder): number[] {
  const len = d.read_usize();
  return Array.from(d.read_raw_bytes(len));
}

/// An integer that will always encode to 8 bytes.
export class IntEncodedWithFixedSize {
  constructor(public _0: bigint) {}

  static readonly ENCODED_SIZE = 8;
}

/** `x.to_le_bytes()` of a `u64` */
export function u64_to_le_bytes(x: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** `impl Encodable<FileEncoder<'_>> for IntEncodedWithFixedSize` */
// rustc: compiler/rustc_serialize/src/opaque.rs:463 encode
export function FileEncoder_encode_IntEncodedWithFixedSize(v: IntEncodedWithFixedSize, e: FileEncoder): void {
  const _start_pos = e.position();
  e.write_array(u64_to_le_bytes(v._0));
  const _end_pos = e.position();
  // debug_assert_eq!((end_pos - start_pos), IntEncodedWithFixedSize::ENCODED_SIZE);
}

/** `impl<'a> Decodable<MemDecoder<'a>> for IntEncodedWithFixedSize` */
// rustc: compiler/rustc_serialize/src/opaque.rs:473 decode
export function MemDecoder_decode_IntEncodedWithFixedSize(decoder: MemDecoder): IntEncodedWithFixedSize {
  const bytes = decoder.read_array(IntEncodedWithFixedSize.ENCODED_SIZE);
  // `u64::from_le_bytes(bytes)`
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]!);
  return new IntEncodedWithFixedSize(x);
}
