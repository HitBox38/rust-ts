// Port of compiler/rustc_serialize/src/leb128.rs.
//
// This code is very hot and uses lots of arithmetic, avoid overflow checks for performance.
// See https://github.com/rust-lang/rust/pull/119440#issuecomment-1874255727
//
// PORT: integer widths (PORTING §5): `u16`/`u32`/`usize`/`i16`/`i32`/`isize` are `number`,
// `u64`/`u128`/`i64`/`i128` are `bigint`. The `impl_*_leb128!` macros expand to one fn per integer
// type; each expansion is a TS fn with a `// rustc-macro:` marker naming the macro's `fn` line.
// - `out: &mut [u8; max_leb128_len::<T>()]` is a `Uint8Array` of at least that length, written from 0.
// - `usize`/`isize` are exact up to 2^53: the reads accumulate a `number` for the first 7 bytes
//   (49 bits) and continue in `bigint` for longer encodings; a value outside the safe-integer range
//   is `unported` (it has no exact TS `number`), never a rounded guess.
// - The `u16`/`i16` reads compute in int32 and wrap to 16 bits at the end, which is what
//   `<u16>::from(byte) << shift` / `<i16>::from(byte) << shift` do for every well-formed encoding.
import { unported } from "../std/panic.ts";
import { debug_strict_add } from "./int_overflow.ts";
import type { MemDecoder } from "./opaque.ts";

/// Returns the length of the longest LEB128 encoding for `T`, assuming `T` is an integer type
// PORT: `max_leb128_len::<T>()` takes `size_of::<T>()`.
// rustc: compiler/rustc_serialize/src/leb128.rs:8 max_leb128_len
export function max_leb128_len(size_of_T: number): number {
  // The longest LEB128 encoding for an integer uses 7 bits per byte.
  return Math.ceil((size_of_T * 8) / 7);
}

/// Returns the length of the longest LEB128 encoding of all supported integer types.
// rustc: compiler/rustc_serialize/src/leb128.rs:14 largest_max_leb128_len
export function largest_max_leb128_len(): number {
  return max_leb128_len(16);
}

// ---- impl_write_unsigned_leb128! ----

/** `impl_write_unsigned_leb128!` body for the `number` widths (`value` is a non-negative integer < 2^53). */
function write_unsigned_leb128_number(out: Uint8Array, value: number): number {
  let i = 0;

  for (;;) {
    if (value < 0x80) {
      out[i] = value;

      i = debug_strict_add(i, 1);
      break;
    } else {
      out[i] = (value & 0x7f) | 0x80;

      // `value >>= 7` (exact for every integer < 2^53)
      value = Math.floor(value / 128);
      i = debug_strict_add(i, 1);
    }
  }

  return i;
}

/** `impl_write_unsigned_leb128!` body for the `bigint` widths. */
function write_unsigned_leb128_bigint(out: Uint8Array, value: bigint): number {
  let i = 0;

  for (;;) {
    if (value < 0x80n) {
      out[i] = Number(value);

      i = debug_strict_add(i, 1);
      break;
    } else {
      out[i] = Number(value & 0x7fn) | 0x80;

      value >>= 7n;
      i = debug_strict_add(i, 1);
    }
  }

  return i;
}

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:21 write_u16_leb128 (impl_write_unsigned_leb128!)
export function write_u16_leb128(out: Uint8Array, value: number): number {
  return write_unsigned_leb128_number(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:21 write_u32_leb128 (impl_write_unsigned_leb128!)
export function write_u32_leb128(out: Uint8Array, value: number): number {
  return write_unsigned_leb128_number(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:21 write_u64_leb128 (impl_write_unsigned_leb128!)
export function write_u64_leb128(out: Uint8Array, value: bigint): number {
  return write_unsigned_leb128_bigint(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:21 write_u128_leb128 (impl_write_unsigned_leb128!)
export function write_u128_leb128(out: Uint8Array, value: bigint): number {
  return write_unsigned_leb128_bigint(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:21 write_usize_leb128 (impl_write_unsigned_leb128!)
export function write_usize_leb128(out: Uint8Array, value: number): number {
  return write_unsigned_leb128_number(out, value);
}

// ---- impl_read_unsigned_leb128! ----

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:56 read_u16_leb128 (impl_read_unsigned_leb128!)
export function read_u16_leb128(decoder: MemDecoder): number {
  // The first iteration of this loop is unpeeled. This is a
  // performance win because this code is hot and integer values less
  // than 128 are very common, typically occurring 50-80% or more of
  // the time, even for u64 and u128.
  let byte = decoder.read_u8();
  if ((byte & 0x80) === 0) {
    return byte;
  }
  let result = byte & 0x7f;
  let shift = 7;
  for (;;) {
    byte = decoder.read_u8();
    if ((byte & 0x80) === 0) {
      result |= byte << shift;
      return result & 0xffff;
    } else {
      result |= (byte & 0x7f) << shift;
    }
    shift = debug_strict_add(shift, 7);
  }
}

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:56 read_u32_leb128 (impl_read_unsigned_leb128!)
export function read_u32_leb128(decoder: MemDecoder): number {
  // The first iteration of this loop is unpeeled. This is a
  // performance win because this code is hot and integer values less
  // than 128 are very common, typically occurring 50-80% or more of
  // the time, even for u64 and u128.
  let byte = decoder.read_u8();
  if ((byte & 0x80) === 0) {
    return byte;
  }
  let result = byte & 0x7f;
  let shift = 7;
  for (;;) {
    byte = decoder.read_u8();
    if ((byte & 0x80) === 0) {
      result |= byte << shift;
      return result >>> 0;
    } else {
      result |= (byte & 0x7f) << shift;
    }
    shift = debug_strict_add(shift, 7);
  }
}

/** The bigint tail of `impl_read_unsigned_leb128!`: `result` so far, the next `shift`. */
function read_unsigned_leb128_bigint(decoder: MemDecoder, result: bigint, shift: number): bigint {
  for (;;) {
    const byte = decoder.read_u8();
    if ((byte & 0x80) === 0) {
      result |= BigInt(byte) << BigInt(shift);
      return result;
    } else {
      result |= BigInt(byte & 0x7f) << BigInt(shift);
    }
    shift = debug_strict_add(shift, 7);
  }
}

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:56 read_u64_leb128 (impl_read_unsigned_leb128!)
export function read_u64_leb128(decoder: MemDecoder): bigint {
  // The first iteration of this loop is unpeeled. This is a
  // performance win because this code is hot and integer values less
  // than 128 are very common, typically occurring 50-80% or more of
  // the time, even for u64 and u128.
  const byte = decoder.read_u8();
  if ((byte & 0x80) === 0) {
    return BigInt(byte);
  }
  return BigInt.asUintN(64, read_unsigned_leb128_bigint(decoder, BigInt(byte & 0x7f), 7));
}

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:56 read_u128_leb128 (impl_read_unsigned_leb128!)
export function read_u128_leb128(decoder: MemDecoder): bigint {
  // The first iteration of this loop is unpeeled. This is a
  // performance win because this code is hot and integer values less
  // than 128 are very common, typically occurring 50-80% or more of
  // the time, even for u64 and u128.
  const byte = decoder.read_u8();
  if ((byte & 0x80) === 0) {
    return BigInt(byte);
  }
  return BigInt.asUintN(128, read_unsigned_leb128_bigint(decoder, BigInt(byte & 0x7f), 7));
}

/** 2^shift for the shifts `read_usize_leb128` / `read_isize_leb128` take in `number` arithmetic (0..=42). */
const POW2_7 = [1, 2 ** 7, 2 ** 14, 2 ** 21, 2 ** 28, 2 ** 35, 2 ** 42];

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:56 read_usize_leb128 (impl_read_unsigned_leb128!)
export function read_usize_leb128(decoder: MemDecoder): number {
  // The first iteration of this loop is unpeeled. This is a
  // performance win because this code is hot and integer values less
  // than 128 are very common, typically occurring 50-80% or more of
  // the time, even for u64 and u128.
  let byte = decoder.read_u8();
  if ((byte & 0x80) === 0) {
    return byte;
  }
  let result = byte & 0x7f;
  let shift = 7;
  for (;;) {
    if (shift === 49) {
      // PORT: past 49 bits the value may leave the safe-integer range: finish in bigint.
      const big = BigInt.asUintN(64, read_unsigned_leb128_bigint(decoder, BigInt(result), shift));
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) unported(`rustc_serialize::leb128::read_usize_leb128 (usize ${big} >= 2^53 has no exact TS number)`);
      return Number(big);
    }
    byte = decoder.read_u8();
    if ((byte & 0x80) === 0) {
      result += byte * POW2_7[shift / 7]!;
      return result;
    } else {
      result += (byte & 0x7f) * POW2_7[shift / 7]!;
    }
    shift = debug_strict_add(shift, 7);
  }
}

// ---- impl_write_signed_leb128! ----

/** `impl_write_signed_leb128!` body for the `number` widths (`value` is an integer within ±2^53). */
function write_signed_leb128_number(out: Uint8Array, value: number): number {
  let i = 0;

  for (;;) {
    let byte = value & 0x7f;
    // `value >>= 7` (arithmetic: floor division, exact for every integer within ±2^53)
    value = Math.floor(value / 128);
    const more = !((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0));

    if (more) {
      byte |= 0x80; // Mark this byte to show that more bytes will follow.
    }

    out[i] = byte;

    i = debug_strict_add(i, 1);

    if (!more) {
      break;
    }
  }

  return i;
}

/** `impl_write_signed_leb128!` body for the `bigint` widths. */
function write_signed_leb128_bigint(out: Uint8Array, value: bigint): number {
  let i = 0;

  for (;;) {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    const more = !((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0));

    if (more) {
      byte |= 0x80; // Mark this byte to show that more bytes will follow.
    }

    out[i] = byte;

    i = debug_strict_add(i, 1);

    if (!more) {
      break;
    }
  }

  return i;
}

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:90 write_i16_leb128 (impl_write_signed_leb128!)
export function write_i16_leb128(out: Uint8Array, value: number): number {
  return write_signed_leb128_number(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:90 write_i32_leb128 (impl_write_signed_leb128!)
export function write_i32_leb128(out: Uint8Array, value: number): number {
  return write_signed_leb128_number(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:90 write_i64_leb128 (impl_write_signed_leb128!)
export function write_i64_leb128(out: Uint8Array, value: bigint): number {
  return write_signed_leb128_bigint(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:90 write_i128_leb128 (impl_write_signed_leb128!)
export function write_i128_leb128(out: Uint8Array, value: bigint): number {
  return write_signed_leb128_bigint(out, value);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:90 write_isize_leb128 (impl_write_signed_leb128!)
export function write_isize_leb128(out: Uint8Array, value: number): number {
  return write_signed_leb128_number(out, value);
}

// ---- impl_read_signed_leb128! ----

/** `impl_read_signed_leb128!` for `i16`/`i32` in int32 arithmetic; `bits` = `<$int_ty>::BITS`. */
function read_signed_leb128_int32(decoder: MemDecoder, bits: number): number {
  let result = 0;
  let shift = 0;
  let byte;

  for (;;) {
    byte = decoder.read_u8();
    result |= (byte & 0x7f) << shift;
    shift = debug_strict_add(shift, 7);

    if ((byte & 0x80) === 0) {
      break;
    }
  }

  if (shift < bits && (byte & 0x40) !== 0) {
    // sign extend
    result |= ~0 << shift;
  }

  // the `$int_ty` width
  return bits === 16 ? (result << 16) >> 16 : result | 0;
}

/** `impl_read_signed_leb128!` for the `bigint` widths, from `result`/`shift` so far; `bits` = `<$int_ty>::BITS`. */
function read_signed_leb128_bigint(decoder: MemDecoder, bits: number, result: bigint, shift: number): bigint {
  let byte;

  for (;;) {
    byte = decoder.read_u8();
    result |= BigInt(byte & 0x7f) << BigInt(shift);
    shift = debug_strict_add(shift, 7);

    if ((byte & 0x80) === 0) {
      break;
    }
  }

  if (shift < bits && (byte & 0x40) !== 0) {
    // sign extend
    result |= -1n << BigInt(shift);
  }

  return BigInt.asIntN(bits, result);
}

// rustc-macro: compiler/rustc_serialize/src/leb128.rs:128 read_i16_leb128 (impl_read_signed_leb128!)
export function read_i16_leb128(decoder: MemDecoder): number {
  return read_signed_leb128_int32(decoder, 16);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:128 read_i32_leb128 (impl_read_signed_leb128!)
export function read_i32_leb128(decoder: MemDecoder): number {
  return read_signed_leb128_int32(decoder, 32);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:128 read_i64_leb128 (impl_read_signed_leb128!)
export function read_i64_leb128(decoder: MemDecoder): bigint {
  return read_signed_leb128_bigint(decoder, 64, 0n, 0);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:128 read_i128_leb128 (impl_read_signed_leb128!)
export function read_i128_leb128(decoder: MemDecoder): bigint {
  return read_signed_leb128_bigint(decoder, 128, 0n, 0);
}
// rustc-macro: compiler/rustc_serialize/src/leb128.rs:128 read_isize_leb128 (impl_read_signed_leb128!)
export function read_isize_leb128(decoder: MemDecoder): number {
  let result = 0;
  let shift = 0;
  let byte;

  for (;;) {
    if (shift === 49) {
      // PORT: past 49 bits the value may leave the safe-integer range: finish in bigint.
      const big = read_signed_leb128_bigint(decoder, 64, BigInt(result), shift);
      if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER))
        unported(`rustc_serialize::leb128::read_isize_leb128 (isize ${big} outside ±2^53 has no exact TS number)`);
      return Number(big);
    }
    byte = decoder.read_u8();
    result += (byte & 0x7f) * POW2_7[shift / 7]!;
    shift = debug_strict_add(shift, 7);

    if ((byte & 0x80) === 0) {
      break;
    }
  }

  if (shift < 64 && (byte & 0x40) !== 0) {
    // sign extend: `result |= !0 << shift` on the bits read so far (< 2^shift)
    result -= 2 ** shift;
  }

  return result;
}
