//! This is a bare-bones alternative to the `thousands` crate on crates.io, for
//! printing large numbers in a readable fashion.

import { f64_fixed1 } from "../../std/fmt.ts";

// #[cfg(test)]
// mod tests;   (src/rustc_data_structures/thousands/tests.test.ts)

// rustc: compiler/rustc_data_structures/src/thousands/mod.rs:7 format_with_underscores
/**
 * PORT: exported for `tests.test.ts` (upstream's `mod tests` reaches it through `use super::*`). The callers pass the
 * `format!` output of a number, which is ASCII, so a UTF-16 index is the byte index upstream's `String` uses; `s` is a
 * JS `string` and `s.insert(i, '_')` rebuilds it.
 */
export function format_with_underscores(s: string): string {
  // Ignore a leading '-'.
  const start = s.startsWith("-") ? 1 : 0;

  // Stop after the first non-digit, e.g. '.' or 'e' for floats.
  const rest = s.slice(start);
  let non_digit: number | undefined;
  for (let k = 0; k < rest.length; k++) {
    const c = rest.charCodeAt(k);
    // `char::is_digit(10)`: ASCII '0'..='9'.
    if (!(c >= 0x30 && c <= 0x39)) {
      non_digit = k;
      break;
    }
  }
  const end = non_digit !== undefined ? start + non_digit : s.length;

  // Insert underscores within `start..end`.
  let i = end;
  while (i > start + 3) {
    i -= 3;
    s = s.slice(0, i) + "_" + s.slice(i);
  }
  return s;
}

/// Print a `usize` with underscore separators.
// rustc: compiler/rustc_data_structures/src/thousands/mod.rs:25 usize_with_underscores
export function usize_with_underscores(n: number): string {
  return format_with_underscores(`${n}`);
}

/// Print an `isize` with underscore separators.
// rustc: compiler/rustc_data_structures/src/thousands/mod.rs:30 isize_with_underscores
export function isize_with_underscores(n: number): string {
  return format_with_underscores(`${n}`);
}

/// Print an `f64` with precision 1 (one decimal place) and underscore separators.
// rustc: compiler/rustc_data_structures/src/thousands/mod.rs:35 f64p1_with_underscores
export function f64p1_with_underscores(n: number): string {
  return format_with_underscores(f64_fixed1(n));
}
