//! This is a bare-bones alternative to the `thousands` crate on crates.io, for
//! printing large numbers in a readable fashion.

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

/**
 * PORT: `format!("{n:.1}")` for an `f64`: the exact decimal value of `n` rounded to one fractional digit, ties to even
 * (core's `float_to_decimal_common_exact` / `flt2dec::to_exact_fixed_str`; checked against the oracle on 0.25, 0.75,
 * 1.25, -0.25, -0.0, 268.25), with the sign of a negative value or `-0.0` kept, `NaN`, `inf`, `-inf`. JS `toFixed`
 * breaks ties upwards, so it is not used. src/std/fmt.ts has no precision formatting; this is the algorithm of
 * rustc_middle ty/context.ts `f64_fixed1` (private there).
 */
export function f64_fixed1(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const m = exp === 0 ? frac : frac | (1n << 52n);
  const e = (exp === 0 ? 1 : exp) - 1075;
  // x * 10 = m * 10 * 2^e, rounded to an integer, ties to even.
  let q: bigint;
  if (e >= 0) {
    q = m * 10n * (1n << BigInt(e));
  } else {
    const num = m * 10n;
    const den = 1n << BigInt(-e);
    q = num / den;
    const r2 = (num % den) * 2n;
    if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
  }
  return `${neg ? "-" : ""}${q / 10n}.${q % 10n}`;
}
