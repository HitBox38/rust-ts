// Not a port of an upstream file. std helpers (`core::ops::Range`, `str` methods, `usize`/`isize`
// arithmetic) that annotate-snippets needs and `src/std/` does not provide yet. Each helper names
// the std item it models.
// PORT: kept here because the annotate-a lane owns only src/vendor/annotate_snippets/** and
// src/vendor/anstyle/**; root may move them into src/std/ (str.ts, a new ops.ts).
//
// PORT: usize arithmetic follows a release build of rustc (overflow checks off): `a - b` that
// underflows wraps modulo 2^64 instead of panicking (`usize_wrapping_sub`). Wrapped values are
// >= 2^53 and lose precision in a JS number, but stay larger than every real column/width, which
// is all the callers compare them against.

import { is_whitespace } from "../../std/char.ts";
import { debug_str, type Debug } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { decode_at, Str, utf8, utf8_width } from "../../std/str.ts";

/** `core::ops::Range<usize>` (`start..end`, end exclusive). Treated as an immutable value. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/** `<Range<usize> as Debug>::fmt`: `start..end` (same with `{:#?}`). */
export const debug_Range: Debug<Range> = (v) => `${v.start}..${v.end}`;

/** `Range::<usize>::is_empty` */
export function range_is_empty(r: Range): boolean {
  return !(r.start < r.end);
}

/** `<str as Debug>::fmt` for a `Str`. */
export const debug_Str: Debug<Str> = (v) => debug_str(v.toString());

/** `<Cow<str> as Debug>::fmt` / `<String as Debug>::fmt` for a JS string. */
export const debug_string: Debug<string> = (v) => debug_str(v);

/** `usize::saturating_sub` */
export function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

/** `a - b` on `usize` with overflow checks off (wraps modulo 2^64; see the header). */
export function usize_wrapping_sub(a: number, b: number): number {
  return a >= b ? a - b : a - b + 2 ** 64;
}

/** `x as usize` for an `isize` (two's complement reinterpretation). */
export function isize_as_usize(x: number): number {
  return x >= 0 ? x : x + 2 ** 64;
}

/** `v[i]` with Rust's bounds-check panic. */
export function index<T>(v: readonly T[], i: number): T {
  if (i >= v.length || i < 0) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** `str::is_char_boundary` (index relative to `s`). */
export function str_is_char_boundary(s: Str, i: number): boolean {
  if (i === 0) return true;
  if (i >= s.len()) return i === s.len();
  return (s.byte(i) & 0xc0) !== 0x80;
}

/** `str::get(start..end)`: `None` when reversed, out of bounds, or not on char boundaries. */
export function str_get(s: Str, start: number, end: number): Str | undefined {
  if (start > end || !str_is_char_boundary(s, start) || !str_is_char_boundary(s, end)) return undefined;
  return s.slice(start, end);
}

/** `str::trim_start` (`char::is_whitespace`). */
export function str_trim_start(s: Str): Str {
  const n = s.len();
  let i = 0;
  while (i < n) {
    if (!is_whitespace(decode_at(s.b, s.lo + i))) break;
    i += utf8_width(s.byte(i));
  }
  return s.slice(i);
}

/** `str::trim_end` (`char::is_whitespace`). */
export function str_trim_end(s: Str): Str {
  let j = s.len();
  while (j > 0) {
    let k = j - 1;
    while (k > 0 && (s.byte(k) & 0xc0) === 0x80) k--;
    if (!is_whitespace(decode_at(s.b, s.lo + k))) break;
    j = k;
  }
  return s.slice(0, j);
}

/** `str::trim` (`char::is_whitespace`). */
export function str_trim(s: Str): Str {
  return str_trim_end(str_trim_start(s));
}

function bytes_of(p: Str | string): Str {
  return typeof p === "string" ? Str.of_bytes(utf8(p)) : p;
}

/** `a == b` for `str`. */
export function str_eq(a: Str, b: Str | string): boolean {
  const q = bytes_of(b);
  if (a.len() !== q.len()) return false;
  for (let i = 0; i < a.len(); i++) if (a.byte(i) !== q.byte(i)) return false;
  return true;
}

/** `str::strip_prefix` with a `&str` pattern. */
export function str_strip_prefix(s: Str, prefix: Str | string): Str | undefined {
  const p = bytes_of(prefix);
  if (p.len() > s.len()) return undefined;
  for (let i = 0; i < p.len(); i++) if (s.byte(i) !== p.byte(i)) return undefined;
  return s.slice(p.len());
}

/** `str::strip_suffix` with a `&str` pattern. */
export function str_strip_suffix(s: Str, suffix: Str | string): Str | undefined {
  const p = bytes_of(suffix);
  const off = s.len() - p.len();
  if (off < 0) return undefined;
  for (let i = 0; i < p.len(); i++) if (s.byte(off + i) !== p.byte(i)) return undefined;
  return s.slice(0, off);
}

/** `str::ends_with` with an ASCII `char` pattern. */
export function str_ends_with_byte(s: Str, b: number): boolean {
  return s.len() > 0 && s.byte(s.len() - 1) === b;
}

/** `s.chars().count()` */
export function str_char_count(s: Str): number {
  let n = 0;
  for (let i = 0; i < s.len(); i++) if ((s.byte(i) & 0xc0) !== 0x80) n++;
  return n;
}

/** `s.char_indices().map(|(i, _)| i).nth(n)` */
export function str_nth_char_index(s: Str, n: number): number | undefined {
  let i = 0;
  let k = 0;
  while (i < s.len()) {
    if (k === n) return i;
    i += utf8_width(s.byte(i));
    k++;
  }
  return undefined;
}

/** `s.split(c)` for an ASCII `char` separator (n separators give n + 1 pieces). */
export function str_split_byte(s: Str, sep: number): Str[] {
  const out: Str[] = [];
  let start = 0;
  for (let i = 0; i < s.len(); i++) {
    if (s.byte(i) === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** `s.matches(c).count()` for an ASCII `char` (also `memchr::memchr_iter(c, s.as_bytes()).count()`). */
export function str_count_byte(s: Str, b: number): number {
  let n = 0;
  for (let i = 0; i < s.len(); i++) if (s.byte(i) === b) n++;
  return n;
}
