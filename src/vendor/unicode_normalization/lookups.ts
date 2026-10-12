// Port of unicode-normalization =0.1.25 `src/lookups.rs`.
//
// Copyright 2019 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

//! Lookups of unicode properties using minimal perfect hashing.

import { mph_lookup } from "./perfect_hash.ts";
import {
  CANONICAL_COMBINING_CLASS_KV,
  CANONICAL_COMBINING_CLASS_SALT,
  CANONICAL_DECOMPOSED_CHARS,
  CANONICAL_DECOMPOSED_KV,
  CANONICAL_DECOMPOSED_SALT,
  CJK_COMPAT_VARIANTS_DECOMPOSED_CHARS,
  CJK_COMPAT_VARIANTS_DECOMPOSED_KV,
  CJK_COMPAT_VARIANTS_DECOMPOSED_SALT,
  COMBINING_MARK_KV,
  COMBINING_MARK_SALT,
  COMPATIBILITY_DECOMPOSED_CHARS,
  COMPATIBILITY_DECOMPOSED_KV,
  COMPATIBILITY_DECOMPOSED_SALT,
  COMPOSITION_TABLE_KV,
  COMPOSITION_TABLE_SALT,
  TRAILING_NONSTARTERS_KV,
  TRAILING_NONSTARTERS_SALT,
  composition_table_astral,
} from "./tables.ts";

/// Look up the canonical combining class for a codepoint.
///
/// The value returned is as defined in the Unicode Character Database.
// crate: unicode-normalization-0.1.25/src/lookups.rs:19 canonical_combining_class
export function canonical_combining_class(c: number): number {
  return mph_lookup(c, CANONICAL_COMBINING_CLASS_SALT, CANONICAL_COMBINING_CLASS_KV, u8_lookup_fk, u8_lookup_fv, 0);
}

// crate: unicode-normalization-0.1.25/src/lookups.rs:30 composition_table
export function composition_table(c1: number, c2: number): number | undefined {
  if (c1 < 0x10000 && c2 < 0x10000) {
    return mph_lookup<readonly [number, number], number | undefined>(
      ((c1 << 16) | c2) >>> 0,
      COMPOSITION_TABLE_SALT,
      COMPOSITION_TABLE_KV,
      pair_lookup_fk,
      pair_lookup_fv_opt,
      undefined,
    );
  } else {
    return composition_table_astral(c1, c2);
  }
}

/** `(start, len)` of a `*_DECOMPOSED_KV` entry -> `&CHARS[start as usize..][..len as usize]`. */
function decomposed_slice(chars: Uint32Array, sl: readonly [number, number] | undefined): Uint32Array | undefined {
  if (sl === undefined) return undefined;
  const [start, len] = sl;
  return chars.subarray(start, start + len);
}

// crate: unicode-normalization-0.1.25/src/lookups.rs:45 canonical_fully_decomposed
export function canonical_fully_decomposed(c: number): Uint32Array | undefined {
  return decomposed_slice(
    CANONICAL_DECOMPOSED_CHARS,
    mph_lookup<readonly [number, readonly [number, number]], readonly [number, number] | undefined>(
      c,
      CANONICAL_DECOMPOSED_SALT,
      CANONICAL_DECOMPOSED_KV,
      pair_lookup_fk,
      pair_lookup_fv_opt,
      undefined,
    ),
  );
}

// crate: unicode-normalization-0.1.25/src/lookups.rs:57 compatibility_fully_decomposed
export function compatibility_fully_decomposed(c: number): Uint32Array | undefined {
  return decomposed_slice(
    COMPATIBILITY_DECOMPOSED_CHARS,
    mph_lookup<readonly [number, readonly [number, number]], readonly [number, number] | undefined>(
      c,
      COMPATIBILITY_DECOMPOSED_SALT,
      COMPATIBILITY_DECOMPOSED_KV,
      pair_lookup_fk,
      pair_lookup_fv_opt,
      undefined,
    ),
  );
}

// crate: unicode-normalization-0.1.25/src/lookups.rs:69 cjk_compat_variants_fully_decomposed
export function cjk_compat_variants_fully_decomposed(c: number): Uint32Array | undefined {
  return decomposed_slice(
    CJK_COMPAT_VARIANTS_DECOMPOSED_CHARS,
    mph_lookup<readonly [number, readonly [number, number]], readonly [number, number] | undefined>(
      c,
      CJK_COMPAT_VARIANTS_DECOMPOSED_SALT,
      CJK_COMPAT_VARIANTS_DECOMPOSED_KV,
      pair_lookup_fk,
      pair_lookup_fv_opt,
      undefined,
    ),
  );
}

/// Return whether the given character is a combining mark (`General_Category=Mark`)
// crate: unicode-normalization-0.1.25/src/lookups.rs:82 is_combining_mark
export function is_combining_mark(c: number): boolean {
  return mph_lookup(c, COMBINING_MARK_SALT, COMBINING_MARK_KV, bool_lookup_fk, bool_lookup_fv, false);
}

// crate: unicode-normalization-0.1.25/src/lookups.rs:93 stream_safe_trailing_nonstarters
export function stream_safe_trailing_nonstarters(c: number): number {
  return mph_lookup(c, TRAILING_NONSTARTERS_SALT, TRAILING_NONSTARTERS_KV, u8_lookup_fk, u8_lookup_fv, 0);
}

/// Extract the key in a 24 bit key and 8 bit value packed in a u32.
// crate: unicode-normalization-0.1.25/src/lookups.rs:106 u8_lookup_fk
function u8_lookup_fk(kv: number): number {
  return kv >>> 8;
}

/// Extract the value in a 24 bit key and 8 bit value packed in a u32.
// crate: unicode-normalization-0.1.25/src/lookups.rs:112 u8_lookup_fv
function u8_lookup_fv(kv: number): number {
  return kv & 0xff;
}

/// Extract the key for a boolean lookup.
// crate: unicode-normalization-0.1.25/src/lookups.rs:118 bool_lookup_fk
function bool_lookup_fk(kv: number): number {
  return kv;
}

/// Extract the value for a boolean lookup.
// crate: unicode-normalization-0.1.25/src/lookups.rs:124 bool_lookup_fv
function bool_lookup_fv(_kv: number): boolean {
  return true;
}

/// Extract the key in a pair.
// crate: unicode-normalization-0.1.25/src/lookups.rs:130 pair_lookup_fk
function pair_lookup_fk<T>(kv: readonly [number, T]): number {
  return kv[0];
}

/// Extract the value in a pair, returning an option.
// crate: unicode-normalization-0.1.25/src/lookups.rs:136 pair_lookup_fv_opt
function pair_lookup_fv_opt<T>(kv: readonly [number, T]): T | undefined {
  return kv[1];
}
