// rust-ts port of src/tools/clippy/clippy_config/src/de.rs (clippy's own `Deserialize` over toml's `DeValue`; plan-m8 D6).
//
// PORT: trait impls are function tables named `<Trait>_for_<Type>` (as `MultiSpan_for_Span`, proc_macro/diagnostic.ts).
// When a type has several impls of one trait that differ by the trait's type parameter, the parameter is named between
// the trait and `for`: `unit` (`()`), `str` (`&'static str`), `slice` (`&'static [U]`). A generic impl is a function
// taking the tables of its bounds (PORTING §5 "Traits": pass function tables when dispatch depends on the type). The
// full list, and the call each `define_Conf!` field needs, is in docs/handoff/clippy-contract-b1.md.
//
// PORT: an `impl Display` return value is its `Display` output, a `string`.
// PORT: `u64`/`i64`/`u128`/`i128` values are `bigint` (a `clippy.toml` value can be any `u64`, PORTING §5); the smaller
// integer types and the floats are `number`. `()` is `null`.

import { type RustcVersion } from "../rustc_ast/attr/version.ts";
import { parse_version } from "../rustc_attr_parsing/attributes/util.ts";
import { Applicability, type Diag, type DiagCtxtHandle } from "../rustc_errors/lib.ts";
import { type IntoDiagMessage } from "../rustc_error_messages/lib.ts";
import { type Session } from "../rustc_session/session.ts";
import { edit_distance } from "../rustc_span/edit_distance.ts";
import { BytePos, Span, type Spanned } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { debug_str } from "../std/fmt.ts";
import { u16_from_str, u32_from_str, u64_from_str, u8_from_str } from "../std/num.ts";
import { unported } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";

// ---- toml 1.1.0 (vendor-toml, plan-m8 §8 wave 42) ------------------------------------------------------------------
// PORT: vendor-toml is not ported yet, and this lane may not create it. These are the items of `toml 1.1.0+spec-1.1.0`
// (with `serde_spanned 1.1.0`) that clippy_config reaches, typed by PORTING's rules so that the vendored crate can supply
// them: structs are objects with their methods (`Spanned::{get_ref, span, as_ref}`, `DeInteger::{as_str, radix}`,
// `DeFloat::as_str`, toml's `Map::{iter, get_key_value}`, `de::Error::{span, message}`), `DeArray`'s `Deref<Target =
// [Spanned<DeValue>]>` is its `items` field, and the `DeValue` enum is a `$`-tagged union whose methods live on its
// companion const. The companion's methods and `DeTable::parse_recoverable` call `unported` until vendor-toml lands; then
// this block becomes imports from src/vendor/toml/ (D4). Nothing here parses TOML. `Range<usize>` is `{ start, end }`.

export interface Range {
  start: number;
  end: number;
}

/** `serde_spanned::Spanned<T>` (not rustc_span's `Spanned`). */
export interface TomlSpanned<T> {
  /// Byte range
  span(): Range;
  /// Get a reference to the inner value
  get_ref(): T;
  /// `impl<T> AsRef<T> for Spanned<T>`
  as_ref(): T;
}

/** `toml::de::DeString<'i>` = `Cow<'i, str>`. */
export type DeString = string;

export interface DeInteger {
  /// [`from_str_radix`][i64::from_str_radix]-compatible representation of an integer
  as_str(): string;
  /// Numeric base of [`DeInteger::as_str`]
  radix(): number;
}

export interface DeFloat {
  /// [`FromStr`][std::str::FromStr]-compatible representation of a float
  as_str(): string;
}

/** `toml::de::DeArray`; `items` is its `Deref` target. */
export interface DeArray {
  readonly items: readonly TomlValue[];
}

/** `toml::de::DeTable<'i>` = `Map<Spanned<DeString<'i>>, Spanned<DeValue<'i>>>` (`preserve_order`: file order). */
export interface DeTable {
  iter(): Iterable<readonly [TomlSpanned<DeString>, TomlValue]>;
  /// `get_key_value::<str>`, through `impl Borrow<str> for Spanned<Cow<'_, str>>`
  get_key_value(key: string): readonly [TomlSpanned<DeString>, TomlValue] | undefined;
}

/** `toml::de::Error` */
export interface TomlDeError {
  span(): Range | undefined;
  message(): string;
}

/// Representation of a TOML value.
export type DeValue =
  | { readonly $: "String"; readonly _0: DeString }
  | { readonly $: "Integer"; readonly _0: DeInteger }
  | { readonly $: "Float"; readonly _0: DeFloat }
  | { readonly $: "Boolean"; readonly _0: boolean }
  | { readonly $: "Datetime"; readonly _0: unknown }
  | { readonly $: "Array"; readonly _0: DeArray }
  | { readonly $: "Table"; readonly _0: DeTable };
export const DeValue = {
  as_integer(_self: DeValue): DeInteger | undefined {
    return unported("vendor-toml: toml::de::DeValue::as_integer");
  },
  as_float(_self: DeValue): DeFloat | undefined {
    return unported("vendor-toml: toml::de::DeValue::as_float");
  },
  as_bool(_self: DeValue): boolean | undefined {
    return unported("vendor-toml: toml::de::DeValue::as_bool");
  },
  as_str(_self: DeValue): string | undefined {
    return unported("vendor-toml: toml::de::DeValue::as_str");
  },
  as_array(_self: DeValue): DeArray | undefined {
    return unported("vendor-toml: toml::de::DeValue::as_array");
  },
  as_table(_self: DeValue): DeTable | undefined {
    return unported("vendor-toml: toml::de::DeValue::as_table");
  },
};
export const DeTable = {
  /// Parse a TOML document, with recovery
  parse_recoverable(_input: string): [TomlSpanned<DeTable>, TomlDeError[]] {
    return unported("vendor-toml: toml::de::DeTable::parse_recoverable");
  },
};
// ---- end of the toml surface ---------------------------------------------------------------------------------------

export type TomlValue = TomlSpanned<DeValue>;

export class DiagCtxt {
  constructor(
    public inner: DiagCtxtHandle,
    public width: number,
    public render_pretty: boolean,
    private offset: number,
  ) {}

  // rustc: src/tools/clippy/clippy_config/src/de.rs:27 new
  static new(sess: Session, offset: number): DiagCtxt {
    const error_format = sess.opts.error_format;
    return new DiagCtxt(
      sess.dcx(),
      sess.diagnostic_width(),
      (() => {
        switch (error_format.$) {
          case "HumanReadable":
            return true;
          case "Json":
            return error_format.pretty;
        }
      })(),
      offset,
    );
  }

  // rustc: src/tools/clippy/clippy_config/src/de.rs:39 make_sp
  make_sp(range: Range): Span {
    return Span.with_root_ctxt(BytePos.from_usize(this.offset + range.start), BytePos.from_usize(this.offset + range.end));
  }

  // rustc: src/tools/clippy/clippy_config/src/de.rs:46 span_err
  span_err(range: Range, msg: IntoDiagMessage): void {
    this.inner.span_err(this.make_sp(range), msg);
  }

  // rustc: src/tools/clippy/clippy_config/src/de.rs:50 span_warn
  span_warn(range: Range, msg: IntoDiagMessage): void {
    this.inner.span_warn(this.make_sp(range), msg);
  }
}

/** `str::make_ascii_lowercase` / `str::to_ascii_lowercase` */
function to_ascii_lowercase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/// Attempts to find the closest matching string from the list. Returns `None`
/// if the edit distance is too large.
// rustc: src/tools/clippy/clippy_config/src/de.rs:57 find_closest_match
export function find_closest_match(s_: string, options: readonly string[]): string | undefined {
  // Don't treat `_` to `-` and case conversions as an edit.
  let s = s_.replaceAll("_", "-");
  s = to_ascii_lowercase(s);
  // `min_by_key` keeps the first of several minima
  let best: [number, string] | undefined;
  for (const option of options) {
    const x = edit_distance(s, to_ascii_lowercase(option), 4);
    if (x === undefined) continue;
    if (best === undefined || x < best[0]) best = [x, option];
  }
  return best?.[1];
}

/** `usize::div_ceil` */
function div_ceil(a: number, b: number): number {
  if (b === 0) throw new RangeError("attempt to divide by zero");
  return Math.floor((a + b - 1) / b);
}

/** `format!("{:width$}", s)`: pads on the right to `width` chars. */
function pad_to(s: string, width: number): string {
  const n = [...s].length;
  return n >= width ? s : s + " ".repeat(width - n);
}

/// Creates a message listing all possible values suitable for use in `Diag::note`.
// rustc: src/tools/clippy/clippy_config/src/de.rs:69 create_value_list_msg
export function create_value_list_msg(dcx: { readonly width: number; readonly render_pretty: boolean }, values: readonly string[]): string {
  const NOTE_WITH_MSG_LEN = utf8_len("   = note: possible values: ");
  const NOTE_LEN = utf8_len("   = note: ");
  const TBL_SEP = "    ";
  const INLINE_SEP = ", ";

  // Print everything on one line if it will fit and there aren't too many values.
  // e.g. "note: possible values: `value1`, `value2`, `value3`"
  //
  // If there are too many values and the note would exceed the terminal width lay the
  // values out into columns. e.g.
  //    possible values:
  //    value1    value5
  //    value2    value6
  //    value3    value7
  //    value4
  if (values.length <= 8 && NOTE_WITH_MSG_LEN + values.reduce((acc, x) => acc + utf8_len(x) + INLINE_SEP.length + 2, 0) <= dcx.width) {
    return `possible values: ${values.map((x) => `\`${x}\``).join(INLINE_SEP)}`;
  } else if (dcx.render_pretty) {
    // The minimum width a column could possibly have.
    const min_width = values.length === 0 ? 0 : Math.min(...values.map((x) => utf8_len(x)));
    // The number of columns that fit using the minimum width.
    const max_col = Math.floor(Math.max(0, dcx.width - NOTE_WITH_MSG_LEN) / (min_width + TBL_SEP.length));

    // Determine the starting dimensions of the search.
    // `(2..=max_col).try_fold(values.len(), ..)`
    let start_size: { $: "Continue"; _0: number } | { $: "Break"; _0: [number, number] } = { $: "Continue", _0: values.length };
    for (let col_count = 2; col_count <= max_col; col_count++) {
      const row_count = (start_size as { _0: number })._0;
      const needed_rows = div_ceil(values.length, col_count);
      // Only add a new column if it will remove several rows.
      if (needed_rows + 3 <= row_count) {
        start_size = { $: "Continue", _0: needed_rows };
      } else {
        start_size = { $: "Break", _0: [row_count, col_count - 1] };
        break;
      }
    }
    let row_count: number;
    let init_col_count: number;
    switch (start_size.$) {
      // Also handles the case where `max_col < 2`
      case "Continue":
        [row_count, init_col_count] = [start_size._0, max_col];
        break;
      case "Break":
        [row_count, init_col_count] = start_size._0;
        break;
    }

    // The current total width required.
    let total_width = init_col_count * (min_width + TBL_SEP.length) + NOTE_LEN;
    // The current width of each column without the prefix.
    const col_widths: number[] = new Array<number>(init_col_count).fill(min_width);

    // Determine the required width of each column.
    outer: for (;;) {
      // Also handles the case where `max_col` is zero.
      if (col_widths.length <= 1) {
        return `possible values:\n${values.join("\n")}`;
      }
      // `values.chunks(row_count).zip(col_widths.iter_mut())`
      if (row_count === 0) throw new RangeError("chunk size must be non-zero");
      for (let c = 0; c * row_count < values.length && c < col_widths.length; c++) {
        const col_values = values.slice(c * row_count, (c + 1) * row_count);
        for (const value of col_values) {
          if (utf8_len(value) > col_widths[c]!) {
            const delta = utf8_len(value) - col_widths[c]!;
            col_widths[c]! += delta;
            total_width += delta;
            if (total_width > dcx.width) {
              // Remove a column and reset the metrics then retry.
              col_widths.pop();
              row_count = div_ceil(values.length, col_widths.length);
              col_widths.fill(min_width);
              total_width = col_widths.length * (min_width + TBL_SEP.length) + NOTE_LEN;
              continue outer;
            }
          }
        }
      }
      break;
    }

    const rows: string[] = [];
    for (let row = 0; row < row_count; row++) {
      // `(row..values.len()).step_by(row_count).zip(&col_widths)`
      const cells: string[] = [];
      for (let i = row, k = 0; i < values.length && k < col_widths.length; i += row_count, k++) {
        // Don't print trailing whitespace on the right edge.
        const width = i + row_count < values.length ? col_widths[k]! : 0;
        cells.push(pad_to(values[i]!, width));
      }
      rows.push(cells.join(TBL_SEP));
    }
    return `possible values:\n${rows.join("\n")}`;
  } else {
    return `possible values:${values.map((x) => `\n${x}`).join("")}`;
  }
}

/// A type which can be constructed from a default value.
export interface FromDefault<Self, T> {
  /// Creates this value from a default value.
  // rustc: src/tools/clippy/clippy_config/src/de.rs:172 from_default
  from_default(default_: T): Self;
  /// Writes the default value to a string.
  // rustc: src/tools/clippy/clippy_config/src/de.rs:174 display_default
  display_default(default_: T): string;
}

// PORT: `macro_rules! impl_from_default_passthrough` → one table per type, made by `impl_from_default_passthrough`;
// `display_default` is the type's `Display`, given per type.
function impl_from_default_passthrough<T>(display: (v: T) => string): FromDefault<T, T> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:181 from_default
    from_default(default_: T): T {
      return default_;
    },
    // rustc: src/tools/clippy/clippy_config/src/de.rs:185 display_default
    display_default(default_: T): string {
      return display(default_);
    },
  };
}
// impl_from_default_passthrough!(bool, u8, i8, u16, i16, u32, i32, u64, i64, f32, f64);
export const FromDefault_for_bool: FromDefault<boolean, boolean> = impl_from_default_passthrough<boolean>((v) => (v ? "true" : "false"));
export const FromDefault_for_u8: FromDefault<number, number> = impl_from_default_passthrough<number>(String);
export const FromDefault_for_i8: FromDefault<number, number> = impl_from_default_passthrough<number>(String);
export const FromDefault_for_u16: FromDefault<number, number> = impl_from_default_passthrough<number>(String);
export const FromDefault_for_i16: FromDefault<number, number> = impl_from_default_passthrough<number>(String);
export const FromDefault_for_u32: FromDefault<number, number> = impl_from_default_passthrough<number>(String);
export const FromDefault_for_i32: FromDefault<number, number> = impl_from_default_passthrough<number>(String);
export const FromDefault_for_u64: FromDefault<bigint, bigint> = impl_from_default_passthrough<bigint>(String);
export const FromDefault_for_i64: FromDefault<bigint, bigint> = impl_from_default_passthrough<bigint>(String);
// PORT: no `define_Conf!` field is a float, and a float's `Display` (`to_shortest_str`) is not needed until one is;
// `display_default` stops rather than guess at JS's `String(number)`.
export const FromDefault_for_f32: FromDefault<number, number> = impl_from_default_passthrough<number>(() =>
  unported("clippy_config: <f32 as Display>::fmt for FromDefault::display_default"),
);
export const FromDefault_for_f64: FromDefault<number, number> = impl_from_default_passthrough<number>(() =>
  unported("clippy_config: <f64 as Display>::fmt for FromDefault::display_default"),
);

/** `impl<T> FromDefault<()> for Option<T>` */
export const FromDefault_unit_for_Option: FromDefault<undefined, null> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:194 from_default
  from_default(_: null): undefined {
    return undefined;
  },
  // rustc: src/tools/clippy/clippy_config/src/de.rs:197 display_default
  display_default(_: null): string {
    // will cause an error in the metadata collector
    return "";
  },
};

// struct DisplayStr(&'static str);
// rustc: src/tools/clippy/clippy_config/src/de.rs:205 fmt
function fmt_DisplayStr(self: string): string {
  return debug_str(self);
}

/** `impl FromDefault<&'static str> for String` */
export const FromDefault_str_for_String: FromDefault<string, string> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:211 from_default
  from_default(default_: string): string {
    return default_;
  },
  // rustc: src/tools/clippy/clippy_config/src/de.rs:214 display_default
  display_default(default_: string): string {
    return fmt_DisplayStr(default_);
  },
};

/** `impl<T> FromDefault<()> for Vec<T>` */
export const FromDefault_unit_for_Vec: FromDefault<never[], null> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:220 from_default
  from_default(_: null): never[] {
    return [];
  },
  // rustc: src/tools/clippy/clippy_config/src/de.rs:223 display_default
  display_default(_: null): string {
    return "[]";
  },
};

/** `impl<T, S: Default> FromDefault<()> for HashSet<T, S>` */
export const FromDefault_unit_for_HashSet: FromDefault<Set<never>, null> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:229 from_default
  from_default(_: null): Set<never> {
    return new Set();
  },
  // rustc: src/tools/clippy/clippy_config/src/de.rs:232 display_default
  display_default(_: null): string {
    return "[]";
  },
};

// struct DisplaySlice<T: 'static, U>(&'static [T], PhantomData<U>);
// rustc: src/tools/clippy/clippy_config/src/de.rs:243 fmt
function fmt_DisplaySlice<T, U>(self: readonly T[], u: FromDefault<U, T>): string {
  let f = "[";
  if (self.length > 0) {
    const [head, ...tail] = self;
    f += u.display_default(head!);
    for (const x of tail) {
      f += `, ${u.display_default(x)}`;
    }
  }
  return f + "]";
}

/** `impl<T, U> FromDefault<&'static [U]> for Vec<T> where T: FromDefault<U>` */
export function FromDefault_slice_for_Vec<T, U>(t: FromDefault<T, U>): FromDefault<T[], readonly U[]> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:260 from_default
    from_default(default_: readonly U[]): T[] {
      return default_.map((x) => t.from_default(x));
    },
    // rustc: src/tools/clippy/clippy_config/src/de.rs:263 display_default
    display_default(default_: readonly U[]): string {
      return fmt_DisplaySlice(default_, t);
    },
  };
}

/** `impl<T, U, S> FromDefault<&'static [U]> for HashSet<T, S> where T: FromDefault<U> + Eq + Hash` */
export function FromDefault_slice_for_HashSet<T, U>(t: FromDefault<T, U>): FromDefault<Set<T>, readonly U[]> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:274 from_default
    from_default(default_: readonly U[]): Set<T> {
      return new Set(default_.map((x) => t.from_default(x)));
    },
    // rustc: src/tools/clippy/clippy_config/src/de.rs:277 display_default
    display_default(default_: readonly U[]): string {
      return fmt_DisplaySlice(default_, t);
    },
  };
}

/// A type which can be deserialized from a toml value.
export interface Deserialize<Self> {
  /// Attempt to deserialize the value. Returns `None` and raises an error on failure.
  // rustc: src/tools/clippy/clippy_config/src/de.rs:285 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): Self | undefined;
}

export const Deserialize_for_bool: Deserialize<boolean> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:289 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): boolean | undefined {
    const x = DeValue.as_bool(value.get_ref());
    if (x === undefined) {
      dcx.span_err(value.span(), "expected a boolean");
      return undefined;
    }
    return x;
  },
};

// PORT: `macro_rules! impl_deserialize_int` → `impl_deserialize_int(<ty>::from_str_radix, MIN, MAX)` per type.
// `from_str_radix` is the std fn where src/std/num.ts has it (the unsigned types up to `u64`, radix 10); any other
// type or radix stops (`unported`) rather than guess. Only `Ok`/`Err` is used.
function impl_deserialize_int<T>(from_str_radix: (s: string, radix: number) => T | undefined, MIN: string, MAX: string): Deserialize<T> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:303 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): T | undefined {
      const x = DeValue.as_integer(value.get_ref());
      if (x === undefined) {
        dcx.span_err(value.span(), "expected an integer");
        return undefined;
      }
      const r = from_str_radix(x.as_str(), x.radix());
      if (r !== undefined) {
        return r;
      }
      dcx.span_err(value.span(), `integer is not within the expected range (${MIN}..${MAX})`);
      return undefined;
    },
  };
}

function from_str_radix_10<T>(ty: string, from_str: (s: string) => { $: "Ok"; _0: T } | { $: "Err" }): (s: string, radix: number) => T | undefined {
  return (s, radix) => {
    if (radix !== 10) return unported(`std: ${ty}::from_str_radix with radix ${radix}`);
    const r = from_str(s);
    return r.$ === "Ok" ? r._0 : undefined;
  };
}
function from_str_radix_unported<T>(ty: string): (s: string, radix: number) => T | undefined {
  return () => unported(`std: ${ty}::from_str_radix`);
}

// impl_deserialize_int!(i8, u8, i16, u16, i32, u32, i64, u64, i128, u128);
export const Deserialize_for_i8: Deserialize<number> = impl_deserialize_int(from_str_radix_unported<number>("i8"), "-128", "127");
export const Deserialize_for_u8: Deserialize<number> = impl_deserialize_int(from_str_radix_10("u8", u8_from_str), "0", "255");
export const Deserialize_for_i16: Deserialize<number> = impl_deserialize_int(from_str_radix_unported<number>("i16"), "-32768", "32767");
export const Deserialize_for_u16: Deserialize<number> = impl_deserialize_int(from_str_radix_10("u16", u16_from_str), "0", "65535");
export const Deserialize_for_i32: Deserialize<number> = impl_deserialize_int(
  from_str_radix_unported<number>("i32"),
  "-2147483648",
  "2147483647",
);
export const Deserialize_for_u32: Deserialize<number> = impl_deserialize_int(from_str_radix_10("u32", u32_from_str), "0", "4294967295");
export const Deserialize_for_i64: Deserialize<bigint> = impl_deserialize_int(
  from_str_radix_unported<bigint>("i64"),
  "-9223372036854775808",
  "9223372036854775807",
);
export const Deserialize_for_u64: Deserialize<bigint> = impl_deserialize_int(
  from_str_radix_10("u64", u64_from_str),
  "0",
  "18446744073709551615",
);
export const Deserialize_for_i128: Deserialize<bigint> = impl_deserialize_int(
  from_str_radix_unported<bigint>("i128"),
  "-170141183460469231731687303715884105728",
  "170141183460469231731687303715884105727",
);
export const Deserialize_for_u128: Deserialize<bigint> = impl_deserialize_int(
  from_str_radix_unported<bigint>("u128"),
  "0",
  "340282366920938463463374607431768211455",
);

// PORT: `macro_rules! impl_deserialize_float` → `impl_deserialize_float(<ty>::from_str)`; src/std has no float
// `FromStr` yet, so it stops (`unported`).
function impl_deserialize_float(ty: string): Deserialize<number> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:329 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): number | undefined {
      const x = DeValue.as_float(value.get_ref());
      if (x === undefined) {
        dcx.span_err(value.span(), "expected a number");
        return undefined;
      }
      const r: number | undefined = unported(`std: <${ty} as FromStr>::from_str (${x.as_str()})`);
      if (r !== undefined) {
        return r;
      }
      dcx.span_err(value.span(), "failed to parse number");
      return undefined;
    },
  };
}
// impl_deserialize_float!(f32, f64);
export const Deserialize_for_f32: Deserialize<number> = impl_deserialize_float("f32");
export const Deserialize_for_f64: Deserialize<number> = impl_deserialize_float("f64");

export const Deserialize_for_String: Deserialize<string> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:350 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): string | undefined {
    const x = DeValue.as_str(value.get_ref());
    if (x !== undefined) {
      return x;
    } else {
      dcx.span_err(value.span(), "expected a string");
      return undefined;
    }
  },
};

export const Deserialize_for_Symbol: Deserialize<Symbol> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:361 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): Symbol | undefined {
    const x = DeValue.as_str(value.get_ref());
    if (x !== undefined) {
      return Symbol.intern(x);
    } else {
      dcx.span_err(value.span(), "expected a string");
      return undefined;
    }
  },
};

export const Deserialize_for_RustcVersion: Deserialize<RustcVersion> = {
  // rustc: src/tools/clippy/clippy_config/src/de.rs:372 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): RustcVersion | undefined {
    const x = DeValue.as_str(value.get_ref());
    if (x !== undefined) {
      const v = parse_version(Symbol.intern(x));
      if (v !== undefined) {
        return v;
      } else {
        dcx.span_err(value.span(), "failed to parse rust version");
        return undefined;
      }
    } else {
      dcx.span_err(value.span(), "expected a version string");
      return undefined;
    }
  },
};

/** `impl<T: Deserialize, const N: usize> Deserialize for [T; N]` */
export function Deserialize_for_array<T>(t: Deserialize<T>, N: number): Deserialize<T[]> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:388 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): T[] | undefined {
      const values = DeValue.as_array(value.get_ref());
      if (values !== undefined && values.items.length === N) {
        // `.filter_map(..).collect::<ArrayVec<T, N>>()`
        const out: T[] = [];
        for (const x of values.items) {
          const v = t.deserialize(dcx, x);
          if (v !== undefined) out.push(v);
        }
        // A value's deserialize impl will have already given an error
        // `values.into_inner().ok()`: `Some` only when the `ArrayVec` is full
        return out.length === N ? out : undefined;
      } else {
        // PORT: upstream passes a plain `&str`, not `format!`: the message keeps the literal `{N}`.
        dcx.span_err(value.span(), "expected an array of length `{N}`");
        return undefined;
      }
    },
  };
}

/** `impl<T: Deserialize> Deserialize for Vec<T>` */
export function Deserialize_for_Vec<T>(t: Deserialize<T>): Deserialize<T[]> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:406 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): T[] | undefined {
      const values = DeValue.as_array(value.get_ref());
      if (values !== undefined) {
        const out: T[] = [];
        for (const x of values.items) {
          const v = t.deserialize(dcx, x);
          if (v !== undefined) out.push(v);
        }
        return out;
      } else {
        dcx.span_err(value.span(), "expected an array");
        return undefined;
      }
    },
  };
}

/** `impl<T, S> Deserialize for HashSet<T, S> where T: Deserialize + Eq + Hash` (keys: primitives or interned handles) */
export function Deserialize_for_HashSet<T>(t: Deserialize<T>): Deserialize<Set<T>> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:421 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): Set<T> | undefined {
      const values = DeValue.as_array(value.as_ref());
      if (values !== undefined) {
        const out = new Set<T>();
        for (const x of values.items) {
          const v = t.deserialize(dcx, x);
          if (v !== undefined) out.add(v);
        }
        return out;
      } else {
        dcx.span_err(value.span(), "expected an array");
        return undefined;
      }
    },
  };
}

/** `impl<T, S> Deserialize for HashMap<T, Span, S> where T: Deserialize + Eq + Hash` */
export function Deserialize_for_HashMap<T>(t: Deserialize<T>): Deserialize<Map<T, Span>> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:436 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): Map<T, Span> | undefined {
      const values = DeValue.as_array(value.as_ref());
      if (values !== undefined) {
        const out = new Map<T, Span>();
        for (const x of values.items) {
          const v = t.deserialize(dcx, x);
          if (v !== undefined) out.set(v, dcx.make_sp(x.span()));
        }
        return out;
      } else {
        dcx.span_err(value.span(), "expected an array");
        return undefined;
      }
    },
  };
}

/** `impl<T: Deserialize> Deserialize for Spanned<T>` (rustc_span's `Spanned`) */
export function Deserialize_for_Spanned<T>(t: Deserialize<T>): Deserialize<Spanned<T>> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:452 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): Spanned<T> | undefined {
      const x = t.deserialize(dcx, value);
      return x === undefined ? undefined : { node: x, span: dcx.make_sp(value.span()) };
    },
  };
}

/// A type which can be deserialized from a toml value with a fallback to a default value.
export interface DeserializeOrDefault<Self, T> {
  /// Attempt to deserialize the value. Returns the default value and raises an error on failure.
  // rustc: src/tools/clippy/clippy_config/src/de.rs:463 deserialize_or_default
  deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: T): Self;
}

/** `impl<T: Deserialize + FromDefault<T>> DeserializeOrDefault<T> for T` */
export function DeserializeOrDefault_for_T<T>(de: Deserialize<T>, fd: FromDefault<T, T>): DeserializeOrDefault<T, T> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:467 deserialize_or_default
    deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: T): T {
      const x = de.deserialize(dcx, value);
      return x !== undefined ? x : fd.from_default(default_);
    },
  };
}

/** `impl<T: Deserialize + Default> DeserializeOrDefault<()> for T`; `default_` is `<T as Default>::default`. */
export function DeserializeOrDefault_unit_for_T<T>(de: Deserialize<T>, default_: () => T): DeserializeOrDefault<T, null> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:473 deserialize_or_default
    deserialize_or_default(dcx: DiagCtxt, value: TomlValue, _: null): T {
      const x = de.deserialize(dcx, value);
      return x !== undefined ? x : default_();
    },
  };
}

/** `impl<T: Deserialize> DeserializeOrDefault<()> for Option<T>` */
export function DeserializeOrDefault_unit_for_Option<T>(de: Deserialize<T>): DeserializeOrDefault<T | undefined, null> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:479 deserialize_or_default
    deserialize_or_default(dcx: DiagCtxt, value: TomlValue, _: null): T | undefined {
      return de.deserialize(dcx, value);
    },
  };
}

/** `C: FromIterator<T> + Extend<T>` for `deserialize_array`: `Vec<T>` or `HashSet<T>`. */
export interface Collect<T, C> {
  from_iter(items: T[]): C;
  extend(c: C, items: Iterable<T>): void;
}
export function Collect_Vec<T>(): Collect<T, T[]> {
  return {
    from_iter: (items) => items,
    extend: (c, items) => {
      for (const x of items) c.push(x);
    },
  };
}
export function Collect_HashSet<T>(): Collect<T, Set<T>> {
  return {
    from_iter: (items) => new Set(items),
    extend: (c, items) => {
      for (const x of items) c.add(x);
    },
  };
}

// rustc: src/tools/clippy/clippy_config/src/de.rs:484 deserialize_array
export function deserialize_array<T, U, C>(
  dcx: DiagCtxt,
  value: TomlValue,
  default_: readonly U[],
  de: Deserialize<T>,
  fd: FromDefault<T, U>,
  c: Collect<T, C>,
): C {
  // lazy: `default.iter().map(|&x| T::from_default(x))`
  const default_iter = (): T[] => default_.map((x) => fd.from_default(x));
  const values = DeValue.as_array(value.as_ref());
  if (values !== undefined) {
    let has_default = false;
    // the `filter` and `filter_map` closures run element by element, so their diagnostics interleave
    const items: T[] = [];
    for (const x of values.items) {
      const s = DeValue.as_str(x.as_ref());
      if (s !== undefined && s === "..") {
        if (has_default) {
          dcx.span_warn(value.span(), "duplicate `..` item");
        }
        has_default = true;
        continue;
      }
      const v = de.deserialize(dcx, x);
      if (v !== undefined) items.push(v);
    }
    const res = c.from_iter(items);
    if (has_default) {
      c.extend(res, default_iter());
    }
    return res;
  } else {
    dcx.span_err(value.span(), "expected an array");
    return c.from_iter(default_iter());
  }
}

/** `impl<T, U> DeserializeOrDefault<&'static [U]> for Vec<T> where T: Deserialize + FromDefault<U>` */
export function DeserializeOrDefault_slice_for_Vec<T, U>(de: Deserialize<T>, fd: FromDefault<T, U>): DeserializeOrDefault<T[], readonly U[]> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:523 deserialize_or_default
    deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: readonly U[]): T[] {
      return deserialize_array(dcx, value, default_, de, fd, Collect_Vec<T>());
    },
  };
}

/** `impl<T, U, S> DeserializeOrDefault<&'static [U]> for HashSet<T, S> where T: Deserialize + FromDefault<U> + Eq + Hash` */
export function DeserializeOrDefault_slice_for_HashSet<T, U>(
  de: Deserialize<T>,
  fd: FromDefault<T, U>,
): DeserializeOrDefault<Set<T>, readonly U[]> {
  return {
    // rustc: src/tools/clippy/clippy_config/src/de.rs:534 deserialize_or_default
    deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: readonly U[]): Set<T> {
      return deserialize_array(dcx, value, default_, de, fd, Collect_HashSet<T>());
    },
  };
}

// PORT: `macro_rules! deserialize_table` (de.rs:539) → `deserialize_table(dcx, table, fields)`: `fields` lists
// `$name: [$name_str, <$ty as Deserialize>]` in the invocation's order, and the result holds each `let mut $name:
// Option<$ty>` slot. Each key overwrites its slot, even with `None`, as the macro does.
export function deserialize_table<R>(
  dcx: DiagCtxt,
  table: DeTable,
  fields: { readonly [K in keyof R]: readonly [string, Deserialize<R[K]>] },
): { [K in keyof R]?: R[K] } {
  const out: { [K in keyof R]?: R[K] } = {};
  const rows = Object.entries(fields) as [string, readonly [string, Deserialize<unknown>]][];
  for (const [key, value] of table.iter()) {
    const k = key.get_ref();
    const row = rows.find(([, [name_str]]) => name_str === k);
    if (row !== undefined) {
      // Duplicate keys are handled by the toml parser
      (out as Record<string, unknown>)[row[0]] = row[1][1].deserialize(dcx, value);
    } else {
      const NAMES: readonly string[] = rows.map(([, [name_str]]) => name_str);
      const sp = dcx.make_sp(key.span());
      const diag: Diag = dcx.inner.struct_span_err(sp, "unknown key");
      const sugg = find_closest_match(key.as_ref(), NAMES);
      if (sugg !== undefined) {
        diag.span_suggestion(sp, "did you mean", sugg, Applicability.MaybeIncorrect);
      }
      diag.note(create_value_list_msg(dcx, NAMES));
      diag.emit();
    }
  }
  return out;
}
