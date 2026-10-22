// Port of rustc-demangle =0.1.28 `src/lib.rs` (the version rustc_symbol_mangling uses; rustc builds it
// with no features: the `std`-only `demangle_line` / `demangle_stream` are not compiled in).
//
//! Demangle Rust compiler symbol names.
//!
//! This crate provides a `demangle` function which will return a `Demangle`
//! sentinel value that can be used to learn about the demangled version of a
//! symbol name. The demangled representation will be the same as the original
//! if it doesn't look like a mangled symbol name.
//!
//! `Demangle` can be formatted with the `Display` trait. The alternate
//! modifier (`#`) can be used to format the symbol name without the
//! trailing hash value.
//!
//! # Examples
//!
//! ```
//! use rustc_demangle::demangle;
//!
//! assert_eq!(demangle("_ZN4testE").to_string(), "test");
//! assert_eq!(demangle("_ZN3foo3barE").to_string(), "foo::bar");
//! assert_eq!(demangle("foo").to_string(), "foo");
//! // With hash
//! assert_eq!(format!("{}", demangle("_ZN3foo17h05af221e174051e9E")), "foo::h05af221e174051e9");
//! // Without hash
//! assert_eq!(format!("{:#}", demangle("_ZN3foo17h05af221e174051e9E")), "foo");
//! ```
//
// PORT: `&str` is a JS string. Symbols are matched / sliced only at positions found by searching for
// ASCII text, and both demanglers reject non-ASCII input before indexing into it, so UTF-16 offsets and
// byte offsets agree wherever they are used; byte lengths that matter (`SizeLimitedFmtAdapter`) use
// `utf8_len`.
// PORT: `core::fmt` as this crate uses it: `fmt::Write` is `FmtWrite` (`write_str` returning `FmtResult`),
// `fmt::Formatter` is `Formatter` (a `FmtWrite` sink plus the `#` flag; no width/precision, which this crate
// never sets), `fmt::Error` is `{ $: "Error" }`. `impl Display for T` is `fmt_T(self, f)`;
// `x.to_string()` / `format!("{}")` / `format!("{:#}")` is `display_Demangle(x, alternate)`.
import { utf8_len } from "../../std/str.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as legacy from "./legacy.ts";
import * as v0 from "./v0.ts";

/** `core::fmt::Error`. */
export type FmtError = { readonly $: "Error" };
/** `core::fmt::Result`. */
export type FmtResult = Result<undefined, FmtError>;
export const FMT_OK: FmtResult = Ok(undefined);
export const FMT_ERR: FmtResult = Err({ $: "Error" });

/** `core::fmt::Write`. */
export interface FmtWrite {
  write_str(s: string): FmtResult;
}

/** `core::fmt::Formatter<'_>`: writes to `sink`, with the `#` flag `alternate_`. */
export class Formatter implements FmtWrite {
  constructor(
    private readonly sink: FmtWrite,
    private readonly alternate_: boolean,
  ) {}

  /** `Formatter::alternate` */
  alternate(): boolean {
    return this.alternate_;
  }

  /** `Formatter::write_str` */
  write_str(s: string): FmtResult {
    return this.sink.write_str(s);
  }
}

/** The `String` sink of `ToString::to_string` / `format!`. */
class StringSink implements FmtWrite {
  buf = "";
  write_str(s: string): FmtResult {
    this.buf += s;
    return FMT_OK;
  }
}

/// Representation of a demangled symbol name.
export interface Demangle {
  readonly style: DemangleStyle | undefined;
  readonly original: string;
  readonly suffix: string;
}

type DemangleStyle = { readonly $: "Legacy"; readonly _0: legacy.Demangle } | { readonly $: "V0"; readonly _0: v0.Demangle };

/// De-mangles a Rust symbol into a more readable version
///
/// This function will take a **mangled** symbol and return a value. When printed,
/// the de-mangled version will be written. If the symbol does not look like
/// a mangled symbol, the original value will be written instead.
///
/// # Examples
///
/// ```
/// use rustc_demangle::demangle;
///
/// assert_eq!(demangle("_ZN4testE").to_string(), "test");
/// assert_eq!(demangle("_ZN3foo3barE").to_string(), "foo::bar");
/// assert_eq!(demangle("foo").to_string(), "foo");
/// ```
// crate: rustc-demangle-0.1.28/src/lib.rs:92 demangle
export function demangle(s: string): Demangle {
  // During ThinLTO LLVM may import and rename internal symbols, so strip out
  // those endings first as they're one of the last manglings applied to symbol
  // names.
  const llvm = ".llvm.";
  const i = s.indexOf(llvm);
  if (i !== -1) {
    const candidate = s.slice(i + llvm.length);
    let all_hex = true;
    for (const c of candidate) {
      if (!((c >= "A" && c <= "F") || (c >= "0" && c <= "9") || c === "@")) {
        all_hex = false;
        break;
      }
    }

    if (all_hex) {
      s = s.slice(0, i);
    }
  }

  let suffix = "";
  let style: DemangleStyle | undefined;
  const l = legacy.demangle(s);
  if (l.$ === "Ok") {
    const [d, s_] = l._0;
    suffix = s_;
    style = { $: "Legacy", _0: d };
  } else {
    const r = v0.demangle(s);
    if (r.$ === "Ok") {
      const [d, s_] = r._0;
      suffix = s_;
      style = { $: "V0", _0: d };
    } else {
      // FIXME(eddyb) would it make sense to treat an unknown-validity
      // symbol (e.g. one that errored with `RecursedTooDeep`) as
      // v0-mangled, and have the error show up in the demangling?
      // (that error already gets past this initial check, and therefore
      // will show up in the demangling, if hidden behind a backref)
      style = undefined;
    }
  }

  // Output like LLVM IR adds extra period-delimited words. See if
  // we are in that case and save the trailing words if so.
  if (suffix.length !== 0) {
    if (suffix.startsWith(".") && is_symbol_like(suffix)) {
      // Keep the suffix.
    } else {
      // Reset the suffix and invalidate the demangling.
      suffix = "";
      style = undefined;
    }
  }

  return {
    style,
    original: s,
    suffix,
  };
}

// crate-skip: rustc-demangle-0.1.28/src/lib.rs:149 demangle_line behind the `std` feature (off in rustc)
// crate-skip: rustc-demangle-0.1.28/src/lib.rs:199 demangle_stream behind the `std` feature (off in rustc)

/// Error returned from the `try_demangle` function below when demangling fails.
export interface TryDemangleError {
  readonly _priv: null;
}

/** `#[derive(Debug)]` */
export function debug_TryDemangleError(_v: TryDemangleError): string {
  return "TryDemangleError { _priv: () }";
}

/// The same as `demangle`, except return an `Err` if the string does not appear
/// to be a Rust symbol, rather than "demangling" the given string as a no-op.
///
/// ```
/// extern crate rustc_demangle;
///
/// let not_a_rust_symbol = "la la la";
///
/// // The `try_demangle` function will reject strings which are not Rust symbols.
/// assert!(rustc_demangle::try_demangle(not_a_rust_symbol).is_err());
///
/// // While `demangle` will just pass the non-symbol through as a no-op.
/// assert_eq!(rustc_demangle::demangle(not_a_rust_symbol).as_str(), not_a_rust_symbol);
/// ```
// crate: rustc-demangle-0.1.28/src/lib.rs:237 try_demangle
export function try_demangle(s: string): Result<Demangle, TryDemangleError> {
  const sym = demangle(s);
  if (sym.style !== undefined) {
    return Ok(sym);
  } else {
    return Err({ _priv: null });
  }
}

export const Demangle = {
  /// Returns the underlying string that's being demangled.
  // crate: rustc-demangle-0.1.28/src/lib.rs:248 as_str
  as_str(self: Demangle): string {
    return self.original;
  },
};

// crate: rustc-demangle-0.1.28/src/lib.rs:253 is_symbol_like
function is_symbol_like(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    // Once `char::is_ascii_punctuation` and `char::is_ascii_alphanumeric`
    // have been stable for long enough, use those instead for clarity
    if (!(is_ascii_alphanumeric(c) || is_ascii_punctuation(c))) return false;
  }
  return true;
}

// Copied from the documentation of `char::is_ascii_alphanumeric`
// crate: rustc-demangle-0.1.28/src/lib.rs:262 is_ascii_alphanumeric
function is_ascii_alphanumeric(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
}

// Copied from the documentation of `char::is_ascii_punctuation`
// crate: rustc-demangle-0.1.28/src/lib.rs:270 is_ascii_punctuation
function is_ascii_punctuation(c: number): boolean {
  return (c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e);
}

// impl<'a> fmt::Display for DemangleStyle<'a>
// crate: rustc-demangle-0.1.28/src/lib.rs:281 fmt
function fmt_DemangleStyle(self: DemangleStyle, f: Formatter): FmtResult {
  switch (self.$) {
    case "Legacy":
      return legacy.fmt_Demangle(self._0, f);
    case "V0":
      return v0.fmt_Demangle(self._0, f);
  }
}

// Maximum size of the symbol that we'll print.
const MAX_SIZE = 1_000_000;

/** `struct SizeLimitExhausted;` */
type SizeLimitExhausted = "SizeLimitExhausted";

class SizeLimitedFmtAdapter implements FmtWrite {
  constructor(
    public remaining: Result<number, SizeLimitExhausted>,
    readonly inner: FmtWrite,
  ) {}

  // crate: rustc-demangle-0.1.28/src/lib.rs:301 write_str
  write_str(s: string): FmtResult {
    if (this.remaining.$ === "Ok") {
      const r = this.remaining._0;
      const len = utf8_len(s);
      this.remaining = r >= len ? Ok(r - len) : Err("SizeLimitExhausted");
    }

    if (this.remaining.$ === "Ok") {
      return this.inner.write_str(s);
    } else {
      return FMT_ERR;
    }
  }
}

// impl<'a> fmt::Display for Demangle<'a>
// crate: rustc-demangle-0.1.28/src/lib.rs:314 fmt
export function fmt_Demangle(self: Demangle, f: Formatter): FmtResult {
  const d = self.style;
  if (d === undefined) {
    const r = f.write_str(self.original);
    if (r.$ === "Err") return r;
  } else {
    const alternate = f.alternate();
    const size_limited_fmt = new SizeLimitedFmtAdapter(Ok(MAX_SIZE), f);
    // `write!(size_limited_fmt, "{:#}", d)` / `write!(size_limited_fmt, "{}", d)`
    const fmt_result = alternate ? fmt_DemangleStyle(d, new Formatter(size_limited_fmt, true)) : fmt_DemangleStyle(d, new Formatter(size_limited_fmt, false));
    const size_limit_result: Result<undefined, SizeLimitExhausted> = size_limited_fmt.remaining.$ === "Ok" ? Ok(undefined) : size_limited_fmt.remaining;

    // Translate a `fmt::Error` generated by `SizeLimitedFmtAdapter`
    // into an error message, instead of propagating it upwards
    // (which could cause panicking from inside e.g. `std::io::print`).
    if (fmt_result.$ === "Err" && size_limit_result.$ === "Err") {
      const r = f.write_str("{size limit reached}");
      if (r.$ === "Err") return r;
    } else {
      if (fmt_result.$ === "Err") return fmt_result;
      if (size_limit_result.$ === "Err") panic("`fmt::Error` from `SizeLimitedFmtAdapter` was discarded: SizeLimitExhausted");
    }
  }
  return f.write_str(self.suffix);
}

// impl<'a> fmt::Debug for Demangle<'a>
// crate: rustc-demangle-0.1.28/src/lib.rs:349 fmt
export function debug_Demangle(self: Demangle, f: Formatter): FmtResult {
  return fmt_Demangle(self, f);
}

/**
 * `demangle.to_string()` / `format!("{}", demangle)` (`alternate = false`) and `format!("{:#}", demangle)`
 * (`alternate = true`). A `fmt::Error` panics as `ToString::to_string` does.
 */
export function display_Demangle(d: Demangle, alternate: boolean): string {
  const sink = new StringSink();
  const r = fmt_Demangle(d, new Formatter(sink, alternate));
  if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
  return sink.buf;
}
