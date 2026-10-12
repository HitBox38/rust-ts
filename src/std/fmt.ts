// core::fmt Debug formatting. A derive(Debug) port is a function `(v, f) => string`
// built from these helpers; output must be byte-identical to rustc's `{:?}` / `{:#?}`.
import { in_table } from "./unicode/mod.ts";
import { DEBUG_ESCAPE_UNICODE } from "./unicode/tables.ts";

export interface Fmt {
  /** `{:#?}` */
  readonly alternate: boolean;
}

export const PLAIN: Fmt = { alternate: false };
export const PRETTY: Fmt = { alternate: true };

export type Debug<T> = (v: T, f: Fmt) => string;

/** PadAdapter: indent every line after the first by 4 spaces. */
function pad(s: string): string {
  return s.replaceAll("\n", "\n    ");
}

/** `f.debug_struct(name).field(..)...finish()`; field values are already formatted with `f`. */
export function debug_struct(f: Fmt, name: string, fields: [string, string][]): string {
  if (fields.length === 0) return name;
  if (f.alternate) {
    let s = name + " {\n";
    for (const [k, v] of fields) s += "    " + k + ": " + pad(v) + ",\n";
    return s + "}";
  }
  return name + " { " + fields.map(([k, v]) => k + ": " + v).join(", ") + " }";
}

/** `f.debug_tuple(name).field(..)...finish()` */
export function debug_tuple(f: Fmt, name: string, fields: string[]): string {
  if (fields.length === 0) return name;
  if (f.alternate) {
    let s = name + "(\n";
    for (const v of fields) s += "    " + pad(v) + ",\n";
    return s + ")";
  }
  // A 1-tuple with an empty name gets a trailing comma: `(x,)`.
  if (fields.length === 1 && name === "") return "(" + fields[0] + ",)";
  return name + "(" + fields.join(", ") + ")";
}

function debug_seq(f: Fmt, open: string, close: string, items: string[]): string {
  if (items.length === 0) return open + close;
  if (f.alternate) {
    let s = open + "\n";
    for (const v of items) s += "    " + pad(v) + ",\n";
    return s + close;
  }
  return open + items.join(", ") + close;
}

export function debug_list(f: Fmt, items: string[]): string {
  return debug_seq(f, "[", "]", items);
}

export function debug_set(f: Fmt, items: string[]): string {
  return debug_seq(f, "{", "}", items);
}

export function debug_map(f: Fmt, entries: [string, string][]): string {
  if (entries.length === 0) return "{}";
  if (f.alternate) {
    let s = "{\n";
    for (const [k, v] of entries) s += "    " + pad(k) + ": " + pad(v) + ",\n";
    return s + "}";
  }
  return "{" + entries.map(([k, v]) => k + ": " + v).join(", ") + "}";
}

export function debug_option<T>(v: T | undefined, f: Fmt, inner: Debug<T>): string {
  return v === undefined ? "None" : debug_tuple(f, "Some", [inner(v, f)]);
}

export function debug_vec<T>(v: readonly T[], f: Fmt, inner: Debug<T>): string {
  return debug_list(
    f,
    v.map((x) => inner(x, f)),
  );
}

export const debug_bool: Debug<boolean> = (v) => (v ? "true" : "false");
export const debug_int: Debug<number | bigint> = (v) => String(v);

/** `char::escape_debug_ext` */
function escape_char(c: number, single_quote: boolean, double_quote: boolean): string {
  switch (c) {
    case 0x00:
      return "\\0";
    case 0x09:
      return "\\t";
    case 0x0a:
      return "\\n";
    case 0x0d:
      return "\\r";
    case 0x5c:
      return "\\\\";
    case 0x22:
      return double_quote ? '\\"' : '"';
    case 0x27:
      return single_quote ? "\\'" : "'";
  }
  if (c >= 0x20 && c < 0x7f) return String.fromCharCode(c);
  if (in_table(DEBUG_ESCAPE_UNICODE, c)) return "\\u{" + c.toString(16) + "}";
  return String.fromCodePoint(c);
}

/** `<str as Debug>::fmt` for a JS string. */
export function debug_str(s: string): string {
  let out = '"';
  for (const ch of s) out += escape_char(ch.codePointAt(0)!, false, true);
  return out + '"';
}

/** `<char as Debug>::fmt` */
export function debug_char(c: number): string {
  return "'" + escape_char(c, true, false) + "'";
}

// ---------------------------------------------------------------------------------------------
// Float Debug: `impl Debug for f64/f32` = `float_to_general_debug` (library/core/src/fmt/float.rs)
// over `flt2dec` (library/core/src/num/imp/flt2dec). Shortest digits come from the Dragon
// algorithm (`strategy::dragon::format_shortest`, exact bignum arithmetic via BigInt). Upstream
// calls `strategy::grisu::format_shortest`, which is Grisu with a Dragon fallback; Grisu either
// returns Dragon's result or gives up, so Dragon alone is observably identical.
// Formatter flags other than `#` (precision, `+`, width) are not modelled by `Fmt`.
// ---------------------------------------------------------------------------------------------

/** `flt2dec::decoder::Decoded` (mantissas as BigInt). */
interface FltDecoded {
  mant: bigint;
  minus: bigint;
  plus: bigint;
  exp: number;
  inclusive: boolean;
}

/** `flt2dec::decoder::FullDecoded` */
type FullDecoded = { $: "Nan" } | { $: "Infinite" } | { $: "Zero" } | { $: "Finite"; _0: FltDecoded };

/** The `RawFloat` constants that `integer_decode`/`decode` need. */
interface FloatSpec {
  readonly bits: number;
  readonly sig_bits: number;
  readonly exp_bias: number;
  to_bits(v: number): bigint;
  /** `1e-4` and `1e+16` as literals of this type (`already_rounded_value_should_use_exponential`). */
  readonly min_abs: number;
  readonly max_abs: number;
}

const FLOAT_VIEW = new DataView(new ArrayBuffer(8));

const F64_SPEC: FloatSpec = {
  bits: 64,
  sig_bits: 52,
  exp_bias: 1023,
  to_bits(v) {
    FLOAT_VIEW.setFloat64(0, v);
    return FLOAT_VIEW.getBigUint64(0);
  },
  min_abs: 1e-4,
  max_abs: 1e16,
};

const F32_SPEC: FloatSpec = {
  bits: 32,
  sig_bits: 23,
  exp_bias: 127,
  to_bits(v) {
    FLOAT_VIEW.setFloat32(0, v);
    return BigInt(FLOAT_VIEW.getUint32(0));
  },
  min_abs: Math.fround(1e-4),
  max_abs: Math.fround(1e16),
};

/** `RawFloat::integer_decode` (library/core/src/num/imp/traits.rs) -> `[mantissa, exponent, sign]`. */
function integer_decode(spec: FloatSpec, bits: bigint): [bigint, number, number] {
  const sig_mask = (1n << BigInt(spec.sig_bits)) - 1n;
  const exp_mask = ((1n << BigInt(spec.bits - 1)) - 1n) & ~sig_mask;
  const sign = bits >> BigInt(spec.bits - 1) === 0n ? 1 : -1;
  let exponent = Number((bits & exp_mask) >> BigInt(spec.sig_bits));
  const mantissa = exponent === 0 ? (bits & sig_mask) << 1n : (bits & sig_mask) | (1n << BigInt(spec.sig_bits));
  // Exponent bias + mantissa shift
  exponent -= spec.exp_bias + spec.sig_bits;
  return [mantissa, exponent, sign];
}

/** `flt2dec::decoder::decode` -> `[negative, decoded]`. */
function flt_decode(spec: FloatSpec, v: number): [boolean, FullDecoded] {
  const bits = spec.to_bits(v);
  const [mant, exp, sign] = integer_decode(spec, bits);
  const even = (mant & 1n) === 0n;
  const sig_mask = (1n << BigInt(spec.sig_bits)) - 1n;
  const exp_all_ones = (1 << (spec.bits - 1 - spec.sig_bits)) - 1;
  const exp_field = Number(bits >> BigInt(spec.sig_bits)) & exp_all_ones;
  let decoded: FullDecoded;
  // `v.classify()`
  if (exp_field === exp_all_ones) {
    decoded = (bits & sig_mask) !== 0n ? { $: "Nan" } : { $: "Infinite" };
  } else if (exp_field === 0 && (bits & sig_mask) === 0n) {
    decoded = { $: "Zero" };
  } else if (exp_field === 0) {
    // Subnormal. neighbors: (mant - 2, exp) -- (mant, exp) -- (mant + 2, exp)
    // Float::integer_decode always preserves the exponent,
    // so the mantissa is scaled for subnormals.
    decoded = { $: "Finite", _0: { mant, minus: 1n, plus: 1n, exp, inclusive: even } };
  } else {
    // Normal.
    const minnorm_mant = 1n << BigInt(spec.sig_bits);
    if (mant === minnorm_mant) {
      // neighbors: (maxmant, exp - 1) -- (minnormmant, exp) -- (minnormmant + 1, exp)
      // where maxmant = minnormmant * 2 - 1
      decoded = { $: "Finite", _0: { mant: mant << 2n, minus: 1n, plus: 2n, exp: exp - 2, inclusive: even } };
    } else {
      // neighbors: (mant - 1, exp) -- (mant, exp) -- (mant + 1, exp)
      decoded = { $: "Finite", _0: { mant: mant << 1n, minus: 1n, plus: 1n, exp: exp - 1, inclusive: even } };
    }
  }
  return [sign < 0, decoded];
}

/** `flt2dec::estimator::estimate_scaling_factor` */
function estimate_scaling_factor(mant: bigint, exp: number): number {
  // 2^(nbits-1) < mant <= 2^nbits if mant > 0
  const m1 = mant - 1n;
  const nbits = m1 === 0n ? 0 : m1.toString(2).length;
  // 1292913986 = floor(2^32 * log_10 2)
  // therefore this always underestimates (or is exact), but not much.
  return Number((BigInt(nbits + exp) * 1292913986n) >> 32n);
}

/** `flt2dec::round_up`: returns the extra digit, if any. */
function flt_round_up(d: number[]): number | undefined {
  let i = d.length - 1;
  while (i >= 0 && d[i] === 0x39) i--;
  if (i >= 0) {
    // d[i+1..n] is all nines
    d[i]! += 1;
    d.fill(0x30, i + 1);
    return undefined;
  } else if (d.length === 0) {
    // an empty buffer rounds up (a bit strange but reasonable)
    return 0x31;
  } else {
    // 999..999 rounds to 1000..000 with an increased exponent
    d[0] = 0x31;
    d.fill(0x30, 1);
    return 0x30;
  }
}

/** `flt2dec::strategy::dragon::format_shortest` -> `[digits (ASCII codes), exp]`. */
function dragon_format_shortest(d: FltDecoded): [number[], number] {
  // `a.cmp(&b) < rounding` is `if d.inclusive {a <= b} else {a < b}`
  const lt = (a: bigint, b: bigint): boolean => (d.inclusive ? a <= b : a < b);

  // estimate `k_0` from original inputs satisfying `10^(k_0-1) < high <= 10^(k_0+1)`.
  let k = estimate_scaling_factor(d.mant + d.plus, d.exp);

  // convert `{mant, plus, minus} * 2^exp` into the fractional form.
  let mant = d.mant;
  let minus = d.minus;
  let plus = d.plus;
  let scale = 1n;
  if (d.exp < 0) {
    scale <<= BigInt(-d.exp);
  } else {
    mant <<= BigInt(d.exp);
    minus <<= BigInt(d.exp);
    plus <<= BigInt(d.exp);
  }

  // divide `mant` by `10^k`. now `scale / 10 < mant + plus <= scale * 10`.
  if (k >= 0) {
    scale *= 10n ** BigInt(k);
  } else {
    const p = 10n ** BigInt(-k);
    mant *= p;
    minus *= p;
    plus *= p;
  }

  // fixup when `mant + plus > scale` (or `>=`).
  if (lt(scale, mant + plus)) {
    // equivalent to scaling `scale` by 10
    k += 1;
  } else {
    mant *= 10n;
    minus *= 10n;
    plus *= 10n;
  }

  const buf: number[] = [];
  let down: boolean;
  let up: boolean;
  for (;;) {
    // generate one digit: `d[n] = floor(mant / scale) < 10`.
    const digit = mant / scale;
    mant %= scale;
    buf.push(0x30 + Number(digit));

    // - stop and round `down` (keep digits as is) when `mant < minus` (or `<=`).
    // - stop and round `up` (increase the last digit) when `scale < mant + plus` (or `<=`).
    // - keep generating otherwise.
    down = lt(mant, minus);
    up = lt(scale, mant + plus);
    if (down || up) {
      break;
    } // we have the shortest representation, proceed to the rounding

    // restore the invariants.
    mant *= 10n;
    minus *= 10n;
    plus *= 10n;
  }

  // rounding up happens when
  // i) only the rounding-up condition was triggered, or
  // ii) both conditions were triggered and tie breaking prefers rounding up.
  if (up && (!down || mant * 2n >= scale)) {
    // if rounding up changes the length, the exponent should also change.
    const c = flt_round_up(buf);
    if (c !== undefined) {
      buf.push(c);
      k += 1;
    }
  }

  return [buf, k];
}

const zeros = (n: number): string => "0".repeat(n);
const ascii = (b: number[]): string => String.fromCharCode(...b);

/** `flt2dec::digits_to_dec_str` (parts concatenated). */
function digits_to_dec_str(buf: number[], exp: number, frac_digits: number): string {
  if (exp <= 0) {
    const minus_exp = -exp;
    let s = "0." + zeros(minus_exp) + ascii(buf);
    if (frac_digits > buf.length && frac_digits - buf.length > minus_exp) {
      s += zeros(frac_digits - buf.length - minus_exp);
    }
    return s;
  } else if (exp < buf.length) {
    let s = ascii(buf.slice(0, exp)) + "." + ascii(buf.slice(exp));
    if (frac_digits > buf.length - exp) {
      s += zeros(frac_digits - (buf.length - exp));
    }
    return s;
  } else {
    let s = ascii(buf) + zeros(exp - buf.length);
    if (frac_digits > 0) {
      s += "." + zeros(frac_digits);
    }
    return s;
  }
}

/** `flt2dec::digits_to_exp_str` (parts concatenated). */
function digits_to_exp_str(buf: number[], exp: number, frac_digits: number, upper: boolean): string {
  let s = ascii(buf.slice(0, 1));
  const actual_frac_digits = buf.length - 1;
  if (actual_frac_digits > 0 || frac_digits > 0) {
    s += ".";
    if (actual_frac_digits > 0) s += ascii(buf.slice(1));
    if (frac_digits > actual_frac_digits) s += zeros(frac_digits - actual_frac_digits);
  }
  const e = exp - 1;
  if (e < 0) {
    s += (upper ? "E-" : "e-") + String(-e);
  } else {
    s += (upper ? "E" : "e") + String(e);
  }
  return s;
}

/** `flt2dec::determine_sign` for `Sign::Minus` (`Fmt` has no `+` flag). */
function determine_sign(decoded: FullDecoded, negative: boolean): string {
  if (decoded.$ === "Nan") return "";
  return negative ? "-" : "";
}

/** `flt2dec::to_shortest_str` */
function to_shortest_str(spec: FloatSpec, v: number, frac_digits: number): string {
  const [negative, full_decoded] = flt_decode(spec, v);
  const sign = determine_sign(full_decoded, negative);
  switch (full_decoded.$) {
    case "Nan":
      return sign + "NaN";
    case "Infinite":
      return sign + "inf";
    case "Zero":
      return sign + (frac_digits > 0 ? "0." + zeros(frac_digits) : "0");
    case "Finite": {
      const [buf, exp] = dragon_format_shortest(full_decoded._0);
      return sign + digits_to_dec_str(buf, exp, frac_digits);
    }
  }
}

/** `flt2dec::to_shortest_exp_str` */
function to_shortest_exp_str(spec: FloatSpec, v: number, dec_bounds: [number, number], upper: boolean): string {
  const [negative, full_decoded] = flt_decode(spec, v);
  const sign = determine_sign(full_decoded, negative);
  switch (full_decoded.$) {
    case "Nan":
      return sign + "NaN";
    case "Infinite":
      return sign + "inf";
    case "Zero":
      return sign + (dec_bounds[0] <= 0 && 0 < dec_bounds[1] ? "0" : upper ? "0E0" : "0e0");
    case "Finite": {
      const [buf, exp] = dragon_format_shortest(full_decoded._0);
      const vis_exp = exp - 1;
      const in_dec = dec_bounds[0] <= vis_exp && vis_exp < dec_bounds[1];
      return sign + (in_dec ? digits_to_dec_str(buf, exp, 0) : digits_to_exp_str(buf, exp, 0, upper));
    }
  }
}

/** `float_to_general_debug` without precision. */
function float_to_general_debug(spec: FloatSpec, v: number): string {
  // since there is no precision, there will be no rounding
  // `GeneralFormat::already_rounded_value_should_use_exponential`:
  const abs = Math.abs(v);
  if ((abs !== 0 && abs < spec.min_abs) || abs >= spec.max_abs) {
    const upper = false;
    return to_shortest_exp_str(spec, v, [0, 0], upper);
  } else {
    const min_precision = 1;
    return to_shortest_str(spec, v, min_precision);
  }
}

/** `<f64 as Debug>::fmt` */
export const debug_f64: Debug<number> = (v) => float_to_general_debug(F64_SPEC, v);

/** `<f32 as Debug>::fmt`. `v` must hold an `f32` value (`Math.fround(v) === v`). */
export const debug_f32: Debug<number> = (v) => float_to_general_debug(F32_SPEC, v);
/** `<f64 as Display>::fmt` without precision (`float_to_decimal_display` -> `float_to_decimal_common_shortest(.., 0)`). */
export const display_f64 = (v: number): string => to_shortest_str(F64_SPEC, v, 0);
