// Port of fluent-bundle 0.16.0, src/types/number.rs.
import { debug_bool, debug_f64, debug_int, debug_option, debug_str, debug_struct, type Fmt } from "../../../std/fmt.ts";
import { display_f64 } from "../../../std/fmt.ts";
import { panic, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8_len } from "../../../std/str.ts";
import { PluralOperands } from "../../intl_pluralrules/operands.ts";
import type { FluentArgs } from "../args.ts";
import type { FluentValue } from "./mod.ts";

// #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
export type FluentNumberType = "Cardinal" | "Ordinal";
export const FluentNumberType = {
  Cardinal: "Cardinal",
  Ordinal: "Ordinal",

  /** `#[derive(Default)]` (`#[default] Cardinal`) */
  default(): FluentNumberType {
    return "Cardinal";
  },

  /** `impl From<&str> for FluentNumberType` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:19 from
  from(input: string): FluentNumberType {
    switch (input) {
      case "cardinal":
        return "Cardinal";
      case "ordinal":
        return "Ordinal";
      default:
        return FluentNumberType.default();
    }
  },
} as const;

// #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
export type FluentNumberStyle = "Decimal" | "Currency" | "Percent";
export const FluentNumberStyle = {
  Decimal: "Decimal",
  Currency: "Currency",
  Percent: "Percent",

  /** `#[derive(Default)]` (`#[default] Decimal`) */
  default(): FluentNumberStyle {
    return "Decimal";
  },

  /** `impl From<&str> for FluentNumberStyle` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:37 from
  from(input: string): FluentNumberStyle {
    switch (input) {
      case "decimal":
        return "Decimal";
      case "currency":
        return "Currency";
      case "percent":
        return "Percent";
      default:
        return FluentNumberStyle.default();
    }
  },
} as const;

// #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
export type FluentNumberCurrencyDisplayStyle = "Symbol" | "Code" | "Name";
export const FluentNumberCurrencyDisplayStyle = {
  Symbol: "Symbol",
  Code: "Code",
  Name: "Name",

  /** `#[derive(Default)]` (`#[default] Symbol`) */
  default(): FluentNumberCurrencyDisplayStyle {
    return "Symbol";
  },

  /** `impl From<&str> for FluentNumberCurrencyDisplayStyle` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:56 from
  from(input: string): FluentNumberCurrencyDisplayStyle {
    switch (input) {
      case "symbol":
        return "Symbol";
      case "code":
        return "Code";
      case "name":
        return "Name";
      default:
        return FluentNumberCurrencyDisplayStyle.default();
    }
  },
} as const;

/**
 * PORT: `usize` option values are `number`s. A value that cannot be represented exactly (>= 2^53;
 * only reachable from an f64 >= 2^53 through `as usize`) calls `unported` instead of rounding.
 */
export type usize = number;

// #[derive(Clone, Debug, Eq, Hash, PartialEq)]
export class FluentNumberOptions {
  constructor(
    // PORT: `r#type` → `type` (a property name is fine; derived Debug prints `type`).
    public type: FluentNumberType,
    public style: FluentNumberStyle,
    public currency: string | undefined,
    public currency_display: FluentNumberCurrencyDisplayStyle,
    public use_grouping: boolean,
    public minimum_integer_digits: usize | undefined,
    public minimum_fraction_digits: usize | undefined,
    public maximum_fraction_digits: usize | undefined,
    public minimum_significant_digits: usize | undefined,
    public maximum_significant_digits: usize | undefined,
  ) {}

  /** `impl Default for FluentNumberOptions` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:81 default
  static default(): FluentNumberOptions {
    return new FluentNumberOptions(
      FluentNumberType.default(),
      FluentNumberStyle.default(),
      undefined,
      FluentNumberCurrencyDisplayStyle.default(),
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  }

  // crate: fluent-bundle-0.16.0/src/types/number.rs:98 merge
  merge(opts: FluentArgs): void {
    for (const [key, value] of opts.iter()) {
      if (key === "type" && value.$ === "String") {
        const n = value._0;
        this.type = FluentNumberType.from(n);
      } else if (key === "style" && value.$ === "String") {
        const n = value._0;
        this.style = FluentNumberStyle.from(n);
      } else if (key === "currency" && value.$ === "String") {
        const n = value._0;
        this.currency = n;
      } else if (key === "currencyDisplay" && value.$ === "String") {
        const n = value._0;
        this.currency_display = FluentNumberCurrencyDisplayStyle.from(n);
      } else if (key === "useGrouping" && value.$ === "String") {
        const n = value._0;
        this.use_grouping = n !== "false";
      } else if (key === "minimumIntegerDigits" && value.$ === "Number") {
        const n = value._0;
        this.minimum_integer_digits = FluentNumber.into_usize(n);
      } else if (key === "minimumFractionDigits" && value.$ === "Number") {
        const n = value._0;
        this.minimum_fraction_digits = FluentNumber.into_usize(n);
      } else if (key === "maximumFractionDigits" && value.$ === "Number") {
        const n = value._0;
        this.maximum_fraction_digits = FluentNumber.into_usize(n);
      } else if (key === "minimumSignificantDigits" && value.$ === "Number") {
        const n = value._0;
        this.minimum_significant_digits = FluentNumber.into_usize(n);
      } else if (key === "maximumSignificantDigits" && value.$ === "Number") {
        const n = value._0;
        this.maximum_significant_digits = FluentNumber.into_usize(n);
      } else {
        // _ => {}
      }
    }
  }

  /** `#[derive(Clone)]` */
  clone(): FluentNumberOptions {
    return new FluentNumberOptions(
      this.type,
      this.style,
      this.currency,
      this.currency_display,
      this.use_grouping,
      this.minimum_integer_digits,
      this.minimum_fraction_digits,
      this.maximum_fraction_digits,
      this.minimum_significant_digits,
      this.maximum_significant_digits,
    );
  }

  /** `#[derive(PartialEq)]` */
  eq(other: FluentNumberOptions): boolean {
    return (
      this.type === other.type &&
      this.style === other.style &&
      this.currency === other.currency &&
      this.currency_display === other.currency_display &&
      this.use_grouping === other.use_grouping &&
      this.minimum_integer_digits === other.minimum_integer_digits &&
      this.minimum_fraction_digits === other.minimum_fraction_digits &&
      this.maximum_fraction_digits === other.maximum_fraction_digits &&
      this.minimum_significant_digits === other.minimum_significant_digits &&
      this.maximum_significant_digits === other.maximum_significant_digits
    );
  }
}

/** `#[derive(Debug)]` */
export function debug_FluentNumberOptions(v: FluentNumberOptions, f: Fmt): string {
  const usize_ = (x: usize | undefined) => debug_option(x, f, debug_int);
  return debug_struct(f, "FluentNumberOptions", [
    ["type", v.type],
    ["style", v.style],
    ["currency", debug_option(v.currency, f, (s) => debug_str(s))],
    ["currency_display", v.currency_display],
    ["use_grouping", debug_bool(v.use_grouping, f)],
    ["minimum_integer_digits", usize_(v.minimum_integer_digits)],
    ["minimum_fraction_digits", usize_(v.minimum_fraction_digits)],
    ["maximum_fraction_digits", usize_(v.maximum_fraction_digits)],
    ["minimum_significant_digits", usize_(v.minimum_significant_digits)],
    ["maximum_significant_digits", usize_(v.maximum_significant_digits)],
  ]);
}

/** PORT: the integer and float types of the `from_num!` invocations. */
export type NumTy =
  | "i8" | "i16" | "i32" | "i64" | "i128" | "isize"
  | "u8" | "u16" | "u32" | "u64" | "u128" | "usize"
  | "f32" | "f64";

const INT_BITS: { [K in NumTy]?: [bits: bigint, signed: boolean] } = {
  i8: [8n, true], i16: [16n, true], i32: [32n, true], i64: [64n, true], i128: [128n, true], isize: [64n, true],
  u8: [8n, false], u16: [16n, false], u32: [32n, false], u64: [64n, false], u128: [128n, false], usize: [64n, false],
};

/**
 * PORT: `value as $num` for an f64 `value` (Rust's saturating float→int cast: NaN → 0, truncate
 * toward zero, clamp to the type's range; `as f32` rounds to nearest; `as f64` is the identity).
 * Integers come back as `bigint` (exact for every width), floats as `number`.
 */
function f64_as(value: number, num: NumTy): number | bigint {
  if (num === "f64") return value;
  if (num === "f32") return Math.fround(value);
  const [bits, signed] = INT_BITS[num]!;
  const min = signed ? -(1n << (bits - 1n)) : 0n;
  const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
  if (Number.isNaN(value)) return 0n;
  if (value === Infinity) return max;
  if (value === -Infinity) return min;
  const t = BigInt(Math.trunc(value));
  return t < min ? min : t > max ? max : t;
}

/**
 * PORT: `$num as f64` for every `from_num!` type (`number` for the narrow ones, `number | bigint`
 * for 64/128-bit integers); `Number(bigint)` rounds to nearest, ties to even, like `as f64`.
 */
export type Num = number | bigint;

// #[derive(Clone, Debug, PartialEq)]
export class FluentNumber {
  constructor(
    public value: number,
    public options: FluentNumberOptions,
  ) {}

  // crate: fluent-bundle-0.16.0/src/types/number.rs:144 new
  static new(value: number, options: FluentNumberOptions): FluentNumber {
    return new FluentNumber(value, options);
  }

  // crate: fluent-bundle-0.16.0/src/types/number.rs:148 as_string
  as_string(): string {
    let val = display_f64(this.value);
    const minfd = this.options.minimum_fraction_digits;
    if (minfd !== undefined) {
      const pos = val.indexOf("."); // `find('.')`: `val` is ASCII
      if (pos !== -1) {
        const frac_num = utf8_len(val) - pos - 1;
        const missing = Math.max(minfd - frac_num, 0); // `saturating_sub`
        val = `${val}${str_repeat("0", missing)}`;
      } else {
        val = `${val}.${str_repeat("0", minfd)}`;
      }
    }
    return val;
  }

  /** `impl FromStr for FluentNumber` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:166 from_str
  static from_str(input: string): Result<FluentNumber, ParseFloatError> {
    const r = f64_from_str(input);
    if (r.$ === "Err") return r;
    const n = r._0;
    const pos = input.indexOf("."); // `input.find('.')`: a parsed f64 literal is ASCII
    const mfd = pos === -1 ? undefined : utf8_len(input) - pos - 1;
    const opts = FluentNumberOptions.default();
    opts.minimum_fraction_digits = mfd;
    return Ok(FluentNumber.new(n, opts));
  }

  /** `#[derive(Clone)]` */
  clone(): FluentNumber {
    return new FluentNumber(this.value, this.options.clone());
  }

  /** `#[derive(PartialEq)]` (`value` compares as f64: NaN != NaN, 0.0 == -0.0) */
  eq(other: FluentNumber): boolean {
    return this.value === other.value && this.options.eq(other.options);
  }

  // `from_num!(i8 i16 i32 i64 i128 isize); from_num!(u8 u16 u32 u64 u128 usize); from_num!(f32 f64);`
  // PORT: each macro-generated impl is one fn taking the value (and the target type where it
  // matters); the caller passes the value already in TS form (`Num`).

  /** `impl From<$num> for FluentNumber` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:187 from
  static from_num(n: Num): FluentNumber {
    return new FluentNumber(Number(n), FluentNumberOptions.default());
  }

  /** `impl From<&$num> for FluentNumber` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:195 from
  static from_num_ref(n: Num): FluentNumber {
    return new FluentNumber(Number(n), FluentNumberOptions.default());
  }

  /** `impl From<FluentNumber> for $num` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:203 from
  static into_num(input: FluentNumber, num: NumTy): Num {
    return f64_as(input.value, num);
  }

  /** `impl From<&FluentNumber> for $num` */
  // crate: fluent-bundle-0.16.0/src/types/number.rs:208 from
  static ref_into_num(input: FluentNumber, num: NumTy): Num {
    return f64_as(input.value, num);
  }

  /** `<&FluentNumber as Into<usize>>::into` (the `from_num!(usize)` instance of `ref_into_num`). */
  static into_usize(input: FluentNumber): usize {
    const v = FluentNumber.ref_into_num(input, "usize") as bigint;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
      return unported("fluent_bundle: usize option value >= 2^53 (`f64 as usize`)");
    }
    return Number(v);
  }
}

/** `#[derive(Debug)]` */
export function debug_FluentNumber(v: FluentNumber, f: Fmt): string {
  return debug_struct(f, "FluentNumber", [
    ["value", debug_f64(v.value, f)],
    ["options", debug_FluentNumberOptions(v.options, f)],
  ]);
}

/** `impl From<FluentNumber> for FluentValue<'_>` */
// crate: fluent-bundle-0.16.0/src/types/number.rs:179 from
export function FluentValue_from_FluentNumber(input: FluentNumber): FluentValue {
  return { $: "Number", _0: input };
}

/** `impl From<$num> for FluentValue<'_>` */
// crate: fluent-bundle-0.16.0/src/types/number.rs:213 from
export function FluentValue_from_num(n: Num): FluentValue {
  return { $: "Number", _0: FluentNumber.from_num(n) };
}

/** `impl From<&$num> for FluentValue<'_>` */
// crate: fluent-bundle-0.16.0/src/types/number.rs:218 from
export function FluentValue_from_num_ref(n: Num): FluentValue {
  return { $: "Number", _0: FluentNumber.from_num_ref(n) };
}

/** `impl From<&FluentNumber> for PluralOperands` */
// crate: fluent-bundle-0.16.0/src/types/number.rs:229 from
export function PluralOperands_from_FluentNumber(input: FluentNumber): PluralOperands {
  // `input.value.try_into()` = `TryFrom<f64>`: `PluralOperands::try_from(&input.to_string())`.
  const r = PluralOperands.try_from_convert(input.value, display_f64);
  if (r.$ === "Err") {
    return panic(`Failed to generate operands out of FluentNumber: ${debug_str(r._0)}`);
  }
  const operands: PluralOperands = r._0;
  const mfd = input.options.minimum_fraction_digits;
  if (mfd !== undefined) {
    if (mfd > operands.v) {
      // PORT: u64/u32 arithmetic wraps (rustc's dist build has overflow checks off).
      const exp = ((mfd % 2 ** 32) - (operands.v % 2 ** 32)) >>> 0; // `mfd as u32 - operands.v as u32`
      operands.f = BigInt.asUintN(64, operands.f * u64_wrapping_pow(10n, exp));
      operands.v = mfd;
    }
  }
  // XXX: Add support for other options.
  return operands;
}

/** PORT: `u64::pow` with wrapping multiplication (overflow checks off). */
function u64_wrapping_pow(base: bigint, exp: number): bigint {
  let acc = 1n;
  let b = base;
  let e = exp;
  while (e > 0) {
    if (e & 1) acc = BigInt.asUintN(64, acc * b);
    b = BigInt.asUintN(64, b * b);
    e = Math.floor(e / 2);
  }
  return acc;
}

/** PORT: `str::repeat`; a count past what a String can hold is not modelled (allocation failure). */
function str_repeat(s: string, n: usize): string {
  if (n > 0x3fff_ffff) return unported("alloc: String::repeat beyond 2^30 bytes");
  return s.repeat(n);
}

// ---------------------------------------------------------------------------------------------
// PORT: `<f64 as FromStr>::from_str` belongs in src/std. Same port as intl_pluralrules/operands.ts
// (which keeps it private), with the `ParseFloatError` kinds that `FromStr for FluentNumber` returns.
// ---------------------------------------------------------------------------------------------

/** `core::num::ParseFloatError` (`#[derive(Debug)] struct ParseFloatError { kind: FloatErrorKind }`). */
export interface ParseFloatError {
  readonly kind: "Empty" | "Invalid";
}

export function debug_ParseFloatError(v: ParseFloatError, f: Fmt): string {
  return debug_struct(f, "ParseFloatError", [["kind", v.kind]]);
}

/**
 * `<f64 as FromStr>::from_str` = `core::num::imp::dec2flt::dec2flt` (library/core/src/num/imp/
 * dec2flt/mod.rs at the pin). The accepted grammar is ported exactly:
 *   [+-]? ( digits* ('.' digits*)? ([eE] [+-]? digits+)?   with at least one mantissa digit
 *         | "inf" | "infinity" | "nan" (ASCII case-insensitive) )
 * PORT: the value of an accepted decimal string is computed by JS `Number()`, which, like
 * dec2flt, rounds the exact decimal value to the nearest f64 (ties to even).
 */
function f64_from_str(src: string): Result<number, ParseFloatError> {
  let s = src;
  if (s.length === 0) return Err({ kind: "Empty" }); // pfe_empty
  const c = s.charCodeAt(0);
  const negative = c === 0x2d; /* '-' */
  if (c === 0x2d || c === 0x2b /* '+' */) {
    s = s.slice(1);
  }
  if (s.length === 0) {
    return Err({ kind: "Invalid" }); // pfe_invalid
  }

  if (!parse_number(s)) {
    const v = parse_inf_nan(s, negative);
    if (v !== undefined) return Ok(v);
    return Err({ kind: "Invalid" }); // pfe_invalid
  }
  const v = Number(s);
  return Ok(negative ? -v : v);
}

/** `dec2flt::parse::parse_number` (grammar only): true iff `parse_partial_number` consumes all of `s`. */
function parse_number(s: string): boolean {
  const isDigit = (i: number) => i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39;
  let i = 0;
  let n_digits = 0;
  while (isDigit(i)) {
    i++;
    n_digits++;
  }
  if (i < s.length && s[i] === ".") {
    i++;
    while (isDigit(i)) {
      i++;
      n_digits++;
    }
  }
  if (n_digits === 0) return false;
  if (i < s.length && (s[i] === "e" || s[i] === "E")) {
    i++;
    // parse_scientific
    if (i < s.length && (s[i] === "-" || s[i] === "+")) i++;
    if (!isDigit(i)) return false; // `parse_scientific(&mut s)?` → None
    while (isDigit(i)) i++;
  }
  return i === s.length;
}

/** `dec2flt::parse::parse_inf_nan` */
function parse_inf_nan(s: string, negative: boolean): number | undefined {
  // `register &= 0xDFDF..`: ASCII case folding of letters (other bytes cannot match).
  let float: number;
  const u = s.length === 3 || s.length === 8 ? fold(s) : undefined;
  if (u === "INF" || u === "INFINITY") float = Infinity;
  else if (u === "NAN") float = NaN;
  else return undefined;
  return negative ? -float : float;
}

/** `byte & 0xDF` for each byte (non-ASCII → no match). */
function fold(s: string): string | undefined {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i);
    if (b > 0x7f) return undefined;
    out += String.fromCharCode(b & 0xdf);
  }
  return out;
}
