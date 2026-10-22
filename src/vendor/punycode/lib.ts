// Port of punycode =0.4.1 `src/lib.rs` (the version rustc_symbol_mangling's `push_ident` uses; no features).
//
//! Fonctions to decode and encode [RFC-3492 Punycode](https://tools.ietf.org/html/rfc3492).
//
// PORT: `String` / `&str` are JS strings; `char`s are code points (`number`), a `Vec<char>` is a
// `number[]` of code points. `Result<String, ()>` is `Result<string, null>`. `u32` arithmetic is on
// `number`s: every product / sum that could leave `u32` is guarded by the upstream overflow checks.
import { from_u32, is_ascii } from "../../std/char.ts";
import { assert } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";

// crate-skip: punycode-0.4.1/src/bin/test_decode.rs:6 main binary target (not part of the library rustc links)
// crate-skip: punycode-0.4.1/src/bin/test_encode.rs:5 main binary target (not part of the library rustc links)

// See [RFC-3492, section 4](https://tools.ietf.org/html/rfc3492#section-4).
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = 0x2d; // '-'

const U32_MAX = 0xffff_ffff;

/// Decode the string as Punycode. The string should not contain the initial `xn--` and must
/// contain only ASCII characters.
/// # Example
/// ```
/// assert_eq!(
///     punycode::decode("acadmie-franaise-npb1a").unwrap(),
///     "académie-française"
/// );
/// ```
// crate: punycode-0.4.1/src/lib.rs:37 decode
export function decode(input_: string): Result<string, null> {
  // `input.is_ascii()`: every UTF-16 unit of a non-ASCII char is >= 0x80.
  for (let j = 0; j < input_.length; j++) {
    if (input_.charCodeAt(j) >= 0x80) {
      return Err(null);
    }
  }

  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;

  let output: number[];
  let input: string;
  const di = input_.lastIndexOf("-");
  if (di !== -1) {
    output = Array.from(input_.slice(0, di), (c) => c.codePointAt(0)!);
    input = input_.slice(di + 1);
  } else {
    output = [];
    input = input_;
  }

  // `input.chars().peekable()` (ASCII: one unit per char)
  let pos = 0;
  while (pos < input.length) {
    const oldi = i;
    let w = 1;

    for (let k_ = 1; ; k_++) {
      let c: number;
      if (pos < input.length) {
        c = input.charCodeAt(pos++);
      } else {
        return Err(null);
      }

      const k = k_ * BASE;

      const digit = decode_digit(c);

      if (digit === BASE) {
        return Err(null);
      }

      // overflow check
      if (digit > Math.floor((U32_MAX - i) / w)) {
        return Err(null);
      }
      i += digit * w;

      const t = clamped_sub(TMIN, k, bias, TMAX);
      if (digit < t) {
        break;
      }

      // overflow check
      if (BASE > Math.floor((U32_MAX - t) / w)) {
        return Err(null);
      }
      w *= BASE - t;
    }

    const len = output.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);

    const il = Math.floor(i / len);
    // overflow check
    if (n > U32_MAX - il) {
      return Err(null);
    }
    n += il;
    i %= len;

    const c = from_u32(n);
    if (c !== undefined) {
      output.splice(i, 0, c);
    } else {
      return Err(null);
    }

    i += 1;
  }

  return Ok(String.fromCodePoint(...output));
}

/// Encode a string as punycode. The result string will contain only ASCII characters. The result
/// string does not start with `xn--`.
/// # Example
/// ```
/// assert_eq!(
///     punycode::encode("académie-française").unwrap(),
///     "acadmie-franaise-npb1a"
/// );
/// ```
// crate: punycode-0.4.1/src/lib.rs:125 encode
export function encode(input: string): Result<string, null> {
  return encode_slice(Array.from(input, (c) => c.codePointAt(0)!));
}

// crate: punycode-0.4.1/src/lib.rs:129 encode_slice
function encode_slice(input: readonly number[]): Result<string, null> {
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;

  let output = String.fromCodePoint(...input.filter((c) => is_ascii(c)));
  // `output.len() as u32`: ASCII, one byte per unit
  let h = output.length;
  const b = h;

  if (b > 0) {
    output += String.fromCharCode(DELIMITER);
  }

  while (h < input.length) {
    // `*input.iter().filter(|&&c| (c as u32) >= n).min().unwrap() as u32`
    let m: number | undefined;
    for (const c of input) {
      if (c >= n && (m === undefined || c < m)) m = c;
    }
    if (m === undefined) assert(false, "called `Option::unwrap()` on a `None` value");

    if (m - n > Math.floor((U32_MAX - delta) / (h + 1))) {
      return Err(null);
    }
    delta += (m - n) * (h + 1);

    n = m;

    for (const c of input) {
      if (c < n) {
        delta += 1;
      } else if (c === n) {
        let q = delta;

        for (let k_ = 1; ; k_++) {
          const k = k_ * BASE;

          const t = clamped_sub(TMIN, k, bias, TMAX);

          if (q < t) {
            break;
          }

          output += String.fromCharCode(encode_digit(t + ((q - t) % (BASE - t))));

          q = Math.floor((q - t) / (BASE - t));
        }

        output += String.fromCharCode(encode_digit(q));

        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h += 1;
      }
    }

    delta += 1;
    n += 1;
  }

  return Ok(output);
}

// crate: punycode-0.4.1/src/lib.rs:189 adapt
function adapt(delta_: number, numpoint: number, firsttime: boolean): number {
  let delta = firsttime ? Math.floor(delta_ / DAMP) : Math.floor(delta_ / 2);

  delta += Math.floor(delta / numpoint);
  let k = 0;

  while (delta > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }

  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

/// Compute `lhs-rhs`. Result will be clamped in [min, max].
// crate: punycode-0.4.1/src/lib.rs:209 clamped_sub
function clamped_sub(min: number, lhs: number, rhs: number, max: number): number {
  if (min + rhs >= lhs) {
    return min;
  } else if (max + rhs <= lhs) {
    return max;
  } else {
    return lhs - rhs;
  }
}

// crate: punycode-0.4.1/src/lib.rs:220 decode_digit
function decode_digit(c: number): number {
  const cp = c;

  if (c >= 0x30 && c <= 0x39) return cp - 0x30 + 26;
  if (c >= 0x41 && c <= 0x5a) return cp - 0x41;
  if (c >= 0x61 && c <= 0x7a) return cp - 0x61;
  return BASE;
}

// crate: punycode-0.4.1/src/lib.rs:231 encode_digit
function encode_digit(d: number): number {
  const r = (d + 22 + (d < 26 ? 75 : 0)) & 0xff;

  assert((0x30 <= r && r <= 0x39) || (0x61 <= r && r <= 0x7a), `r = ${String.fromCharCode(r)}`);

  return r;
}
