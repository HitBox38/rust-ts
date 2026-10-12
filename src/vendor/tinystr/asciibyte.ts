// Port of tinystr 0.8.4 `src/asciibyte.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

// PORT: `#[repr(u8)] enum AsciiByte { B0 = 0, ..., B127 = 127 }` exists only to give the compiler a
// niche; every variant's discriminant equals its byte value. It is represented by that `u8`
// value (0..=127). `AsciiByte::Bn` is written `n`; `x as u8` is `x`. Only `B0` is named.
export type AsciiByte = number;

export const AsciiByte = {
  B0: 0 as AsciiByte,

  // Converts from a u8 array to an AsciiByte array.
  // You MUST ensure that the bytes are ASCII.
  // crate: tinystr-0.8.4/src/asciibyte.rs:146 to_ascii_byte_array
  to_ascii_byte_array(bytes: Uint8Array): Uint8Array {
    // PORT: the pointer cast copies the `[u8; N]` value.
    return bytes.slice();
  },

  // crate-skip: tinystr-0.8.4/src/asciibyte.rs:151 from_decimal_digit only used by `new_unsigned_decimal` (not ported)

  // crate: tinystr-0.8.4/src/asciibyte.rs:172 to_ascii_uppercase
  to_ascii_uppercase(self: AsciiByte): AsciiByte {
    // SAFETY: AsciiByte is repr(u8) and has same size as u8
    return u8_to_ascii_uppercase(self);
  },

  // crate: tinystr-0.8.4/src/asciibyte.rs:177 to_ascii_lowercase
  to_ascii_lowercase(self: AsciiByte): AsciiByte {
    // SAFETY: AsciiByte is repr(u8) and has same size as u8
    return u8_to_ascii_lowercase(self);
  },
} as const;

// PORT: core `u8` ASCII helpers (library/core/src/num/mod.rs) used by tinystr; src/std/char.ts has
// only some of them. `is_ascii_alphabetic`/`is_ascii_alphanumeric`/`is_ascii_digit` come from there.

/** `u8::to_ascii_uppercase` */
export function u8_to_ascii_uppercase(b: number): number {
  return b ^ (u8_is_ascii_lowercase(b) ? 0x20 : 0);
}

/** `u8::to_ascii_lowercase` */
export function u8_to_ascii_lowercase(b: number): number {
  return b | (u8_is_ascii_uppercase(b) ? 0x20 : 0);
}

/** `u8::is_ascii_uppercase` */
export function u8_is_ascii_uppercase(b: number): boolean {
  return b >= 0x41 && b <= 0x5a;
}

/** `u8::is_ascii_lowercase` */
export function u8_is_ascii_lowercase(b: number): boolean {
  return b >= 0x61 && b <= 0x7a;
}
