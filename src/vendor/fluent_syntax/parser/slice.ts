// Port of fluent-syntax-0.12.0/src/parser/slice.rs.
//
// PORT: the trait `Slice<'s>: AsRef<str> + Clone + PartialEq` becomes the interface of its two
// required methods plus two impl tables, `Slice_String` and `Slice_str`. Both impls are over `Str`
// (owned vs borrowed is erased; `String`'s `slice` copies the bytes). rust-ts only instantiates
// `S = &str`, so the parser calls `Slice_str` directly. `trim(&mut self)` returns the new value.
// `AsRef<str>` is the `Str` itself; `PartialEq` is `slice_eq`.

import { Str } from "../../../std/str.ts";

// crate: fluent-syntax-0.12.0/src/parser/slice.rs:3 matches_fluent_ws
export function matches_fluent_ws(c: number): boolean {
  return c === 0x20 /* ' ' */ || c === 0x0d /* '\r' */ || c === 0x0a /* '\n' */;
}

export interface Slice {
  // crate: fluent-syntax-0.12.0/src/parser/slice.rs:8 slice
  slice(self: Str, start: number, end: number): Str;
  // crate: fluent-syntax-0.12.0/src/parser/slice.rs:9 trim
  trim(self: Str): Str;
}

/** PORT: `<S as PartialEq>::eq` for `S = &str` / `String`: byte equality. */
export function slice_eq(a: Str, b: Str): boolean {
  if (a.len() !== b.len()) return false;
  for (let i = 0; i < a.len(); i++) if (a.byte(i) !== b.byte(i)) return false;
  return true;
}

/** PORT: `str::trim_end_matches(matches_fluent_ws)`; fluent whitespace is ASCII, so this works on bytes. */
function trim_end_matches_fluent_ws(s: Str): Str {
  let end = s.len();
  while (end > 0 && matches_fluent_ws(s.byte(end - 1))) end--;
  return s.slice(0, end);
}

export const Slice_String: Slice = {
  // crate: fluent-syntax-0.12.0/src/parser/slice.rs:13 slice
  slice(self: Str, start: number, end: number): Str {
    // PORT: `self[range].to_string()`: the copy owns its bytes.
    const s = self.slice(start, end);
    return Str.of_bytes(s.b.slice(s.lo, s.hi));
  },

  // crate: fluent-syntax-0.12.0/src/parser/slice.rs:17 trim
  trim(self: Str): Str {
    const s = trim_end_matches_fluent_ws(self);
    return Str.of_bytes(s.b.slice(s.lo, s.hi));
  },
};

export const Slice_str: Slice = {
  // crate: fluent-syntax-0.12.0/src/parser/slice.rs:23 slice
  slice(self: Str, start: number, end: number): Str {
    return self.slice(start, end);
  },

  // crate: fluent-syntax-0.12.0/src/parser/slice.rs:27 trim
  trim(self: Str): Str {
    return trim_end_matches_fluent_ws(self);
  },
};
