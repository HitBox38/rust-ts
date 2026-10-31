//! Utilties to aid trait implementations
//!
//! ## Portability
//!
//! For cross-platform reproducibility, Little-Endian order (least-significant
//! part first) has been chosen as the standard for inter-type conversion.
//! For example, [`next_u64_via_u32`] generates two `u32` values `x, y`,
//! then outputs `(y << 32) | x`.
//!
//! Byte-swapping (like the std `to_le` functions) is only needed to convert
//! to/from byte sequences, and since its purpose is reproducibility,
//! non-reproducible sources (e.g. `OsRng`) need not bother with it.
//
// Port of rand_core =0.10.1 `src/utils.rs`.
// PORT: generic `W: Word` parameters take the word's table (`Word_u32` / `Word_u64`) as their first argument;
// const generic `N` is an argument too.
import { Ok, type Result } from "../../std/result.ts";
import { assert_eq } from "../../std/panic.ts";
import type { TryRng } from "./lib.ts";
import type { Word } from "./word.ts";
export type { Word } from "./word.ts";

/// Generate a `u64` using `next_u32`, little-endian order.
// crate: rand_core-0.10.1/src/utils.rs:96 next_u64_via_u32
export function next_u64_via_u32<E>(rng: TryRng<E>): Result<bigint, E> {
  // Use LE; we explicitly generate one value before the next.
  const rx = rng.try_next_u32();
  if (rx.$ === "Err") return rx;
  const x = BigInt(rx._0);
  const ry = rng.try_next_u32();
  if (ry.$ === "Err") return ry;
  const y = BigInt(ry._0);
  return Ok((y << 32n) | x);
}

/// Fill `dst` with bytes using `next_word`
///
/// This may be used to implement `fill_bytes` over `next_u32` or
/// `next_u64`. Words are used in order of generation. The last word may be
/// partially discarded.
// crate: rand_core-0.10.1/src/utils.rs:109 fill_bytes_via_next_word
export function fill_bytes_via_next_word<E, W>(Wt: Word<W>, dst: Uint8Array, next_word: () => Result<W, E>): Result<void, E> {
  // `dst.chunks_exact_mut(size_of::<W>())`
  const size = Wt.size;
  const full = dst.length - (dst.length % size);
  for (let at = 0; at < full; at += size) {
    const val = next_word();
    if (val.$ === "Err") return val;
    dst.set(Wt.to_le_bytes(val._0), at);
  }
  const rem = dst.subarray(full);
  if (rem.length !== 0) {
    const r = next_word();
    if (r.$ === "Err") return r;
    const val = Wt.to_le_bytes(r._0);
    rem.set(val.subarray(0, rem.length));
  }
  return Ok(undefined);
}

/// Generate a `u32` or `u64` word using `fill_bytes`
// crate: rand_core-0.10.1/src/utils.rs:127 next_word_via_fill
export function next_word_via_fill<W, E>(Wt: Word<W>, rng: TryRng<E>): Result<W, E> {
  const buf = new Uint8Array(Wt.size);
  const r = rng.try_fill_bytes(buf);
  if (r.$ === "Err") return r;
  return Ok(Wt.from_le_bytes(buf));
}

/// Reads an array of words from a byte slice
///
/// Words are read from `src` in order, using LE conversion from bytes.
///
/// # Panics
///
/// Panics if `size_of_val(src) != size_of::<[W; N]>()`.
// crate: rand_core-0.10.1/src/utils.rs:141 read_words
export function read_words<W>(Wt: Word<W>, N: number, src: Uint8Array): W[] {
  assert_eq(src.length, Wt.size * N, String);
  const dst: W[] = new Array<W>(N).fill(Wt.from_usize(0));
  // `dst.iter_mut().zip(src.chunks_exact(size_of::<W>()))`
  for (let i = 0; i < N; i++) {
    const buf = new Uint8Array(Wt.size);
    buf.set(src.subarray(i * Wt.size, (i + 1) * Wt.size));
    dst[i] = Wt.from_le_bytes(buf);
  }
  return dst;
}
