// Port of tinystr 0.8.4 `src/int_ops.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: the target is little-endian (the oracle hosts, aarch64 and x86_64, are), so the
// `cfg(target_endian = "little")` branches are taken and `from_ne_bytes`/`to_ne_bytes`/`to_le`/
// `from_le` are little-endian. `Aligned4`'s `u32` is a `number` kept in 0..2^32 with `>>> 0`;
// `Aligned8`'s `u64` is a `bigint` (values use all 64 bits) kept in 0..2^64 with `& U64_MAX`.
// None of the additions can overflow because every byte is ASCII (<= 0x7f).
import { AsciiByte as AsciiByteC } from "./asciibyte.ts";

const U64_MAX = 0xffff_ffff_ffff_ffffn;

/** `u64::leading_zeros` */
function u64_leading_zeros(x: bigint): number {
  const hi = Number(x >> 32n);
  return hi !== 0 ? Math.clz32(hi) : 32 + Math.clz32(Number(x & 0xffff_ffffn));
}

/** `!x` on a `u64` */
function not64(x: bigint): bigint {
  return ~x & U64_MAX;
}

/// Internal helper struct that performs operations on aligned integers.
/// Supports strings up to 4 bytes long.
export class Aligned4 {
  constructor(public _0: number) {}

  /// # Panics
  /// Panics if N is greater than 4
  // crate: tinystr-0.8.4/src/int_ops.rs:16 from_ascii_bytes
  static from_ascii_bytes(src: Uint8Array /* [AsciiByte; N] */): Aligned4 {
    const bytes = new Uint8Array(4);
    let i = 0;
    const N = src.length;
    // The function documentation defines when panics may occur
    while (i < N) {
      if (i >= 4) throw new RangeError("index out of bounds"); // PORT: `bytes[i]` bounds check
      bytes[i] = src[i]!;
      i += 1;
    }
    return new Aligned4((bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0);
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:28 len
  len(): number {
    const word = this._0;
    const len = 4 - Math.floor(Math.clz32(word) / 8);
    return len;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:37 is_ascii_alphabetic
  is_ascii_alphabetic(): boolean {
    const word = this._0;
    // Each of the following bitmasks set *the high bit* (0x8) to 0 for valid and 1 for invalid.
    // `mask` sets all NUL bytes to 0.
    const mask = ((word + 0x7f7f_7f7f) & 0x8080_8080) >>> 0;
    // `lower` converts the string to lowercase. It may also change the value of non-alpha
    // characters, but this does not matter for the alphabetic test that follows.
    const lower = (word | 0x2020_2020) >>> 0;
    // `alpha` sets all alphabetic bytes to 0. We only need check for lowercase characters.
    const alpha = (~(lower + 0x1f1f_1f1f) | (lower + 0x0505_0505)) >>> 0;
    // The overall string is valid if every character passes at least one test.
    // We performed two tests here: non-NUL (`mask`) and alphabetic (`alpha`).
    return (alpha & mask) >>> 0 === 0;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:52 is_ascii_alphanumeric
  is_ascii_alphanumeric(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_alphabetic
    const mask = ((word + 0x7f7f_7f7f) & 0x8080_8080) >>> 0;
    const numeric = (~(word + 0x5050_5050) | (word + 0x4646_4646)) >>> 0;
    const lower = (word | 0x2020_2020) >>> 0;
    const alpha = (~(lower + 0x1f1f_1f1f) | (lower + 0x0505_0505)) >>> 0;
    return (alpha & numeric & mask) >>> 0 === 0;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:62 is_ascii_numeric
  is_ascii_numeric(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_alphabetic
    const mask = ((word + 0x7f7f_7f7f) & 0x8080_8080) >>> 0;
    const numeric = (~(word + 0x5050_5050) | (word + 0x4646_4646)) >>> 0;
    return (numeric & mask) >>> 0 === 0;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:70 is_ascii_lowercase
  is_ascii_lowercase(): boolean {
    const word = this._0;
    // For efficiency, this function tests for an invalid string rather than a valid string.
    // A string is ASCII lowercase iff it contains no uppercase ASCII characters.
    // `invalid_case` sets all uppercase ASCII characters to 0 and all others to 1.
    const invalid_case = (~(word + 0x3f3f_3f3f) | (word + 0x2525_2525)) >>> 0;
    // The string is valid if it contains no invalid characters (if all high bits are 1).
    return (invalid_case & 0x8080_8080) >>> 0 === 0x8080_8080;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:80 is_ascii_titlecase
  is_ascii_titlecase(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_lowercase
    const invalid_case = (~(word + 0x3f3f_3f1f) | (word + 0x2525_2505)) >>> 0;
    return (invalid_case & 0x8080_8080) >>> 0 === 0x8080_8080;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:91 is_ascii_uppercase
  is_ascii_uppercase(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_lowercase
    const invalid_case = (~(word + 0x1f1f_1f1f) | (word + 0x0505_0505)) >>> 0;
    return (invalid_case & 0x8080_8080) >>> 0 === 0x8080_8080;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:98 is_ascii_alphabetic_lowercase
  is_ascii_alphabetic_lowercase(): boolean {
    const word = this._0;
    // `mask` sets all NUL bytes to 0.
    const mask = ((word + 0x7f7f_7f7f) & 0x8080_8080) >>> 0;
    // `lower_alpha` sets all lowercase ASCII characters to 0 and all others to 1.
    const lower_alpha = (~(word + 0x1f1f_1f1f) | (word + 0x0505_0505)) >>> 0;
    // The overall string is valid if every character passes at least one test.
    // We performed two tests here: non-NUL (`mask`) and lowercase ASCII character (`alpha`).
    return (lower_alpha & mask) >>> 0 === 0;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:109 is_ascii_alphabetic_titlecase
  is_ascii_alphabetic_titlecase(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_alphabetic_lowercase
    const mask = ((word + 0x7f7f_7f7f) & 0x8080_8080) >>> 0;
    const title_case = (~(word + 0x1f1f_1f3f) | (word + 0x0505_0525)) >>> 0;
    return (title_case & mask) >>> 0 === 0;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:121 is_ascii_alphabetic_uppercase
  is_ascii_alphabetic_uppercase(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_alphabetic_lowercase
    const mask = ((word + 0x7f7f_7f7f) & 0x8080_8080) >>> 0;
    const upper_alpha = (~(word + 0x3f3f_3f3f) | (word + 0x2525_2525)) >>> 0;
    return (upper_alpha & mask) >>> 0 === 0;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:129 to_ascii_lowercase
  to_ascii_lowercase(): Uint8Array /* [AsciiByte; 4] */ {
    const word = this._0;
    const mask = (((word + 0x3f3f_3f3f) & ~(word + 0x2525_2525) & 0x8080_8080) >>> 0) >>> 2;
    const result = (word | mask) >>> 0;
    // SAFETY: The existing word is ASCII, and it is bitwise-ORed with `mask`,
    // a subset of 0x20_20_20_... (0x80_... >> 2), which keeps the word
    // in the ASCII range (all bytes <= 127).
    return AsciiByteC.to_ascii_byte_array(u32_to_le_bytes(result));
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:139 to_ascii_titlecase
  to_ascii_titlecase(): Uint8Array /* [AsciiByte; 4] */ {
    const word = this._0; // `.to_le()`: identity on little-endian
    const mask = (((word + 0x3f3f_3f1f) & ~(word + 0x2525_2505) & 0x8080_8080) >>> 0) >>> 2;
    const result = ((word | mask) & ~(0x20 & mask)) >>> 0;
    // SAFETY: The existing word is ASCII, and it is bitwise-ORed with `mask`, a subset of 0x20_20_20_...
    // (0x80_... >> 2), which keeps the word in the ASCII range (all bytes <= 127). It is then ANDed
    // which cannot introduce new bits.
    return AsciiByteC.to_ascii_byte_array(u32_to_le_bytes(result));
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:149 to_ascii_uppercase
  to_ascii_uppercase(): Uint8Array /* [AsciiByte; 4] */ {
    const word = this._0;
    const mask = ~((((word + 0x1f1f_1f1f) & ~(word + 0x0505_0505) & 0x8080_8080) >>> 0) >>> 2) >>> 0;
    const result = (word & mask) >>> 0;
    // SAFETY: The existing word is ASCII, and it is bitwise-ANDed with `mask`,
    // which cannot introduce new bits, so it stays ASCII.
    return AsciiByteC.to_ascii_byte_array(u32_to_le_bytes(result));
  }
}

/// Internal helper struct that performs operations on aligned integers.
/// Supports strings up to 8 bytes long.
export class Aligned8 {
  constructor(public _0: bigint) {}

  /// # Panics
  /// Panics if N is greater than 8
  // crate: tinystr-0.8.4/src/int_ops.rs:168 from_ascii_bytes
  static from_ascii_bytes(src: Uint8Array /* [AsciiByte; N] */): Aligned8 {
    const bytes = new Uint8Array(8);
    let i = 0;
    const N = src.length;
    // The function documentation defines when panics may occur
    while (i < N) {
      if (i >= 8) throw new RangeError("index out of bounds"); // PORT: `bytes[i]` bounds check
      bytes[i] = src[i]!;
      i += 1;
    }
    return new Aligned8(u64_from_le_bytes(bytes));
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:180 len
  len(): number {
    const word = this._0;
    const len = 8 - Math.floor(u64_leading_zeros(word) / 8);
    return len;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:189 is_ascii_alphabetic
  is_ascii_alphabetic(): boolean {
    const word = this._0;
    const mask = (word + 0x7f7f_7f7f_7f7f_7f7fn) & 0x8080_8080_8080_8080n;
    const lower = word | 0x2020_2020_2020_2020n;
    const alpha = not64(lower + 0x1f1f_1f1f_1f1f_1f1fn) | (lower + 0x0505_0505_0505_0505n);
    return (alpha & mask) === 0n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:197 is_ascii_alphanumeric
  is_ascii_alphanumeric(): boolean {
    const word = this._0;
    const mask = (word + 0x7f7f_7f7f_7f7f_7f7fn) & 0x8080_8080_8080_8080n;
    const numeric = not64(word + 0x5050_5050_5050_5050n) | (word + 0x4646_4646_4646_4646n);
    const lower = word | 0x2020_2020_2020_2020n;
    const alpha = not64(lower + 0x1f1f_1f1f_1f1f_1f1fn) | (lower + 0x0505_0505_0505_0505n);
    return (alpha & numeric & mask) === 0n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:206 is_ascii_numeric
  is_ascii_numeric(): boolean {
    const word = this._0;
    const mask = (word + 0x7f7f_7f7f_7f7f_7f7fn) & 0x8080_8080_8080_8080n;
    const numeric = not64(word + 0x5050_5050_5050_5050n) | (word + 0x4646_4646_4646_4646n);
    return (numeric & mask) === 0n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:213 is_ascii_lowercase
  is_ascii_lowercase(): boolean {
    const word = this._0;
    const invalid_case = not64(word + 0x3f3f_3f3f_3f3f_3f3fn) | (word + 0x2525_2525_2525_2525n);
    return (invalid_case & 0x8080_8080_8080_8080n) === 0x8080_8080_8080_8080n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:219 is_ascii_titlecase
  is_ascii_titlecase(): boolean {
    const word = this._0;
    const invalid_case = not64(word + 0x3f3f_3f3f_3f3f_3f1fn) | (word + 0x2525_2525_2525_2505n);
    return (invalid_case & 0x8080_8080_8080_8080n) === 0x8080_8080_8080_8080n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:229 is_ascii_uppercase
  is_ascii_uppercase(): boolean {
    const word = this._0;
    const invalid_case = not64(word + 0x1f1f_1f1f_1f1f_1f1fn) | (word + 0x0505_0505_0505_0505n);
    return (invalid_case & 0x8080_8080_8080_8080n) === 0x8080_8080_8080_8080n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:235 is_ascii_alphabetic_lowercase
  is_ascii_alphabetic_lowercase(): boolean {
    const word = this._0;
    // `mask` sets all NUL bytes to 0.
    const mask = (word + 0x7f7f_7f7f_7f7f_7f7fn) & 0x8080_8080_8080_8080n;
    // `lower_alpha` sets all lowercase ASCII characters to 0 and all others to 1.
    const lower_alpha = not64(word + 0x1f1f_1f1f_1f1f_1f1fn) | (word + 0x0505_0505_0505_0505n);
    // The overall string is valid if every character passes at least one test.
    // We performed two tests here: non-NUL (`mask`) and lowercase ASCII character (`alpha`).
    return (lower_alpha & mask) === 0n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:246 is_ascii_alphabetic_titlecase
  is_ascii_alphabetic_titlecase(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_alphabetic_lowercase
    const mask = (word + 0x7f7f_7f7f_7f7f_7f7fn) & 0x8080_8080_8080_8080n;
    const title_case = not64(word + 0x1f1f_1f1f_1f1f_1f3fn) | (word + 0x0505_0505_0505_0525n);
    return (title_case & mask) === 0n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:258 is_ascii_alphabetic_uppercase
  is_ascii_alphabetic_uppercase(): boolean {
    const word = this._0;
    // See explanatory comments in is_ascii_alphabetic_lowercase
    const mask = (word + 0x7f7f_7f7f_7f7f_7f7fn) & 0x8080_8080_8080_8080n;
    const upper_alpha = not64(word + 0x3f3f_3f3f_3f3f_3f3fn) | (word + 0x2525_2525_2525_2525n);
    return (upper_alpha & mask) === 0n;
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:266 to_ascii_lowercase
  to_ascii_lowercase(): Uint8Array /* [AsciiByte; 8] */ {
    const word = this._0;
    const mask = ((word + 0x3f3f_3f3f_3f3f_3f3fn) & not64(word + 0x2525_2525_2525_2525n) & 0x8080_8080_8080_8080n) >> 2n;
    const result = word | mask;
    // SAFETY: The existing word is ASCII, and it is bitwise-ORed with `mask`,
    // a subset of 0x20_20_20_... (0x80_... >> 2), which keeps the word
    // in the ASCII range (all bytes <= 127).
    return AsciiByteC.to_ascii_byte_array(u64_to_le_bytes(result));
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:279 to_ascii_titlecase
  to_ascii_titlecase(): Uint8Array /* [AsciiByte; 8] */ {
    const word = this._0; // `.to_le()`: identity on little-endian
    const mask = ((word + 0x3f3f_3f3f_3f3f_3f1fn) & not64(word + 0x2525_2525_2525_2505n) & 0x8080_8080_8080_8080n) >> 2n;
    const result = (word | mask) & not64(0x20n & mask);
    // SAFETY: The existing word is ASCII, and it is bitwise-ORed with `mask`, a subset of 0x20_20_20_...
    // (0x80_... >> 2), which keeps the word in the ASCII range (all bytes <= 127). It is then ANDed
    // which cannot introduce new bits.
    return AsciiByteC.to_ascii_byte_array(u64_to_le_bytes(result));
  }

  // crate: tinystr-0.8.4/src/int_ops.rs:292 to_ascii_uppercase
  to_ascii_uppercase(): Uint8Array /* [AsciiByte; 8] */ {
    const word = this._0;
    const mask = not64(((word + 0x1f1f_1f1f_1f1f_1f1fn) & not64(word + 0x0505_0505_0505_0505n) & 0x8080_8080_8080_8080n) >> 2n);
    const result = word & mask;
    // SAFETY: The existing word is ASCII, and it is bitwise-ANDed with `mask`,
    // which cannot introduce new bits, so it stays ASCII.
    return AsciiByteC.to_ascii_byte_array(u64_to_le_bytes(result));
  }
}

/** `u32::to_le_bytes` */
function u32_to_le_bytes(x: number): Uint8Array {
  return new Uint8Array([x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff]);
}

/** `u64::from_le_bytes` */
export function u64_from_le_bytes(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[i]!);
  return x;
}

/** `u64::to_le_bytes` */
export function u64_to_le_bytes(x: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number((x >> BigInt(8 * i)) & 0xffn);
  return out;
}

/** `u32::from_le_bytes` */
export function u32_from_le_bytes(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}

/** `u32::to_le_bytes` (exported for subtag raw values) */
export { u32_to_le_bytes };

