// Port of compiler/rustc_serialize/src/opaque/mem_encoder.rs.
//
// PORT: `data: Vec<u8>` is a growable byte buffer: `data` is the allocation (its length is the
// `Vec`'s capacity) and `len` the `Vec`'s length; `finish()` returns the `len` bytes written.
import { panic } from "../../std/panic.ts";
import * as leb128 from "../leb128.ts";
import { type IntEncodedWithFixedSize, u16_to_le_bytes, u64_to_le_bytes } from "../opaque.ts";
import { type Encoder, Encoder_provided } from "../serialize.ts";

export class MemEncoder implements Encoder {
  constructor(
    public data: Uint8Array,
    public len: number,
  ) {}

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:9 new
  static new(): MemEncoder {
    return new MemEncoder(new Uint8Array(0), 0);
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:14 position
  position(): number {
    return this.len;
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:18 finish
  finish(): Uint8Array {
    return this.data.slice(0, this.len);
  }

  /** `Vec::reserve(additional)` */
  private reserve(additional: number): void {
    const need = this.len + additional;
    if (need <= this.data.length) return;
    const grown = new Uint8Array(Math.max(need, this.data.length * 2, 8));
    grown.set(this.data.subarray(0, this.len));
    this.data = grown;
  }

  /// Write up to `N` bytes to this encoder.
  ///
  /// This function can be used to avoid the overhead of calling memcpy for writes that
  /// have runtime-variable length, but are small and have a small fixed upper bound.
  ///
  /// This can be used to do in-place encoding as is done for leb128 (without this function
  /// we would need to write to a temporary buffer then memcpy into the encoder), and it can
  /// also be used to implement the varint scheme we use for rmeta and dep graph encoding,
  /// where we only want to encode the first few bytes of an integer. Note that common
  /// architectures support fixed-size writes up to 8 bytes with one instruction, so while this
  /// does in some sense do wasted work, we come out ahead.
  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:34 write_with
  write_with(N: number, visitor: (buf: Uint8Array) => number): void {
    this.reserve(N);

    const old_len = this.len;

    // SAFETY: The above `reserve` ensures that there is enough
    // room to write the encoded value to the vector's internal buffer.
    // The memory is also initialized as 0.
    const buf = this.data.subarray(old_len, old_len + N);
    buf.fill(0);
    const written = visitor(buf);
    if (written > N) {
      MemEncoder.panic_invalid_write(N, written);
    }
    this.len = old_len + written;
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:56 panic_invalid_write
  static panic_invalid_write(N: number, written: number): void {
    panic(`MemEncoder::write_with::<${N}> cannot be used to write ${written} bytes`);
  }

  /// Helper for calls where [`MemEncoder::write_with`] always writes the whole array.
  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:62 write_array
  write_array(buf: Uint8Array): void {
    const N = buf.length;
    this.write_with(N, (dest) => {
      dest.set(buf);
      return N;
    });
  }

  // `write_leb128!(emit_usize, usize, write_usize_leb128)` ...
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_usize (write_leb128!)
  emit_usize(v: number): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_usize_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_u128 (write_leb128!)
  emit_u128(v: bigint): void {
    this.write_with(leb128.max_leb128_len(16), (buf) => leb128.write_u128_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_u64 (write_leb128!)
  emit_u64(v: bigint): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_u64_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_u32 (write_leb128!)
  emit_u32(v: number): void {
    this.write_with(leb128.max_leb128_len(4), (buf) => leb128.write_u32_leb128(buf, v));
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:86 emit_u16
  emit_u16(v: number): void {
    this.write_array(u16_to_le_bytes(v));
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:91 emit_u8
  emit_u8(v: number): void {
    this.write_array(new Uint8Array([v]));
  }

  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_isize (write_leb128!)
  emit_isize(v: number): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_isize_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_i128 (write_leb128!)
  emit_i128(v: bigint): void {
    this.write_with(leb128.max_leb128_len(16), (buf) => leb128.write_i128_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_i64 (write_leb128!)
  emit_i64(v: bigint): void {
    this.write_with(leb128.max_leb128_len(8), (buf) => leb128.write_i64_leb128(buf, v));
  }
  // rustc-macro: compiler/rustc_serialize/src/opaque/mem_encoder.rs:73 emit_i32 (write_leb128!)
  emit_i32(v: number): void {
    this.write_with(leb128.max_leb128_len(4), (buf) => leb128.write_i32_leb128(buf, v));
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:101 emit_i16
  emit_i16(v: number): void {
    this.write_array(u16_to_le_bytes(v & 0xffff));
  }

  // rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:106 emit_raw_bytes
  emit_raw_bytes(s: Uint8Array): void {
    // `self.data.extend_from_slice(s)`
    this.reserve(s.length);
    this.data.set(s, this.len);
    this.len += s.length;
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

// Specialize encoding byte slices. This specialization also applies to encoding `Vec<u8>`s, etc.,
// since the default implementations call `encode` on their slices internally.
/** `impl Encodable<MemEncoder> for [u8]` */
// rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:114 encode
export function MemEncoder_encode_slice_u8(v: Uint8Array, e: MemEncoder): void {
  e.emit_usize(v.length);
  e.emit_raw_bytes(v);
}

/** `impl Encodable<MemEncoder> for IntEncodedWithFixedSize` */
// rustc: compiler/rustc_serialize/src/opaque/mem_encoder.rs:122 encode
export function MemEncoder_encode_IntEncodedWithFixedSize(v: IntEncodedWithFixedSize, e: MemEncoder): void {
  const _start_pos = e.position();
  e.write_array(u64_to_le_bytes(v._0));
  const _end_pos = e.position();
  // debug_assert_eq!((end_pos - start_pos), IntEncodedWithFixedSize::ENCODED_SIZE);
}
