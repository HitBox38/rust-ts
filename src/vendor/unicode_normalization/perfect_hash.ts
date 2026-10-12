// Port of unicode-normalization =0.1.25 `src/perfect_hash.rs`.
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

//! Support for lookups based on minimal perfect hashing.

// This function is based on multiplication being fast and is "good enough". Also
// it can share some work between the unsalted and salted versions.
// crate: unicode-normalization-0.1.25/src/perfect_hash.rs:16 my_hash
function my_hash(key: number, salt: number, n: number): number {
  // PORT: u32 wrapping arithmetic via `>>> 0` / `Math.imul`.
  let y = Math.imul((key + salt) >>> 0, 2654435769) >>> 0;
  y = (y ^ Math.imul(key, 0x31415926)) >>> 0;
  // PORT: `((y as u64) * (n as u64)) >> 32`: y < 2^32 and n < 2^16 (salt tables are short), so the
  // product is an exact double and the division by 2^32 is exact before flooring.
  return Math.floor((y * n) / 0x100000000);
}

/// Do a lookup using minimal perfect hashing.
///
/// The table is stored as a sequence of "salt" values, then a sequence of
/// values that contain packed key/value pairs. The strategy is to hash twice.
/// The first hash retrieves a salt value that makes the second hash unique.
/// The hash function doesn't have to be very good, just good enough that the
/// resulting map is unique.
// crate: unicode-normalization-0.1.25/src/perfect_hash.rs:30 mph_lookup
export function mph_lookup<KV, V>(
  x: number,
  salt: ArrayLike<number>,
  kv: ArrayLike<KV>,
  fk: (kv: KV) => number,
  fv: (kv: KV) => V,
  default_: V,
): V {
  const s = salt[my_hash(x, 0, salt.length)]!;
  const key_val = kv[my_hash(x, s, salt.length)]!;
  if (x === fk(key_val)) {
    return fv(key_val);
  } else {
    return default_;
  }
}
