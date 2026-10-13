// core::slice / alloc::vec helpers that have no direct JS equivalent.
import { panic } from "./panic.ts";

/**
 * `<[T]>::binary_search_by` (library/core/src/slice/mod.rs:2982 at the pin), with the
 * comparison result as -1 (`Less`), 0 (`Equal`), 1 (`Greater`). Same probe sequence as core,
 * so results on non-sorted input match too. `Ok(i)` → `{ ok: true, i }`, `Err(i)` → `{ ok: false, i }`.
 */
export function binary_search_by<T>(v: readonly T[], f: (x: T) => -1 | 0 | 1): { ok: boolean; i: number } {
  let size = v.length;
  if (size === 0) {
    return { ok: false, i: 0 };
  }
  let base = 0;

  // This loop intentionally doesn't have an early exit if the comparison
  // returns Equal. We want the number of loop iterations to depend *only*
  // on the size of the input slice so that the CPU can reliably predict
  // the loop count.
  while (size > 1) {
    const half = Math.floor(size / 2);
    const mid = base + half;
    const cmp = f(v[mid]!);
    base = cmp === 1 ? base : mid;
    size -= half;
  }

  const cmp = f(v[base]!);
  if (cmp === 0) {
    return { ok: true, i: base };
  } else {
    const result = base + (cmp === -1 ? 1 : 0);
    return { ok: false, i: result };
  }
}

/**
 * `<[T]>::partition_point` (library/core/src/slice/mod.rs:4873 at the pin):
 * `self.binary_search_by(|x| if pred(x) { Less } else { Greater }).unwrap_or_else(|i| i)`.
 */
export function partition_point<T>(v: readonly T[], pred: (x: T) => boolean): number {
  return binary_search_by(v, (x) => (pred(x) ? -1 : 1)).i;
}

/**
 * `Vec::extend` / `Vec::extend_from_slice`: appends every element of `items` to `vec`.
 * A loop instead of `vec.push(...items)`, which throws `RangeError` for very large inputs.
 */
export function extend<T>(vec: T[], items: Iterable<T>): void {
  for (const x of items) vec.push(x);
}

/**
 * `Vec::splice(start..start + len, replacement)` (result dropped): replaces `len` elements at
 * `start` with `replacement`, without spreading `replacement` into call arguments.
 * Range checks and texts: core `slice::range` → `try_into_slice_range` / `RangeError::report`
 * → `slice_index_fail` (library/core/src/slice/index.rs at the pin).
 */
export function splice<T>(vec: T[], start: number, len: number, replacement: readonly T[]): void {
  const end = start + len;
  if (end > vec.length) {
    panic(`range end index ${end} out of range for slice of length ${vec.length}`);
  }
  if (start > end) {
    if (start > vec.length) panic(`range start index ${start} out of range for slice of length ${vec.length}`);
    panic(`slice index starts at ${start} but ends at ${end}`);
  }
  const tail = vec.slice(start + len);
  vec.length = start;
  for (const x of replacement) vec.push(x);
  for (const x of tail) vec.push(x);
}

/** A `usize` held in a JS number that may be negative: a wrapped (mod 2^64) unchecked difference. */
function usize_display(n: number): string {
  return n < 0 ? String(2n ** 64n + BigInt(n)) : String(n);
}

/**
 * `&v[..end]`. `end` may be the negative result of unchecked `usize` subtraction (rustc ships without
 * overflow checks, so `len - depth` wraps); the panic then prints the wrapped value, as core does
 * (`slice_end_index_len_fail`, library/core/src/slice/index.rs at the pin).
 */
export function slice_to<T>(v: readonly T[], end: number): T[] {
  if (end < 0 || end > v.length) panic(`range end index ${usize_display(end)} out of range for slice of length ${v.length}`);
  return v.slice(0, end);
}

/** `&v[start..]`, with core's `slice_start_index_len_fail` panic; `start` as in `slice_to`. */
export function slice_from<T>(v: readonly T[], start: number): T[] {
  if (start < 0 || start > v.length) panic(`range start index ${usize_display(start)} out of range for slice of length ${v.length}`);
  return v.slice(start);
}
