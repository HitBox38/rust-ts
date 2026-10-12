// Port of fluent-syntax-0.12.0/src/parser/macros.rs.
//
// PORT: the `macro_rules!` byte accessors become functions taking the parser (`$s`). Their
// expansions index `source.as_ref().as_bytes()` with `<[u8]>::get`, so out-of-range positions
// (including `ptr > length`, which `skip_comment` can produce) yield `None` (`undefined`), never a
// byte past the end of the slice. `get_remaining_bytes!` returns the byte subslice (no char-boundary
// check, as for `&[u8]`).

import type { Parser } from "./core.ts";

/** `get_byte!($s, $idx)` = `$s.source.as_ref().as_bytes().get($idx)` */
export function get_byte(s: Parser, idx: number): number | undefined {
  return idx >= 0 && idx < s.source.len() ? s.source.byte(idx) : undefined;
}

/** `get_current_byte!($s)` = `$s.source.as_ref().as_bytes().get($s.ptr)` */
export function get_current_byte(s: Parser): number | undefined {
  return s.ptr < s.source.len() ? s.source.byte(s.ptr) : undefined;
}

/** `get_remaining_bytes!($s)` = `$s.source.as_ref().as_bytes().get($s.ptr..)` */
export function get_remaining_bytes(s: Parser): Uint8Array | undefined {
  const src = s.source;
  return s.ptr <= src.len() ? src.b.subarray(src.lo + s.ptr, src.hi) : undefined;
}
