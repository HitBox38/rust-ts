// Port of rustc-demangle =0.1.28 `src/legacy.rs`. Conventions: see lib.ts.
//
// PORT: `demangle` rejects any input with a non-ASCII byte before walking it, so the JS string offsets of
// `inner` are byte offsets. Element lengths are `number`s: an overflowing `usize` length (`checked_mul` /
// `checked_add` failing) is `Err(())`, and so is any length that runs past the end of the input, which every
// length >= 2^53 does, so the precision of larger values never matters.
import { from_u32, is_control, to_digit } from "../../std/char.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { FMT_OK, type FmtResult, type Formatter } from "./lib.ts";

/// Representation of a demangled symbol name.
export interface Demangle {
  readonly inner: string;
  /// The number of ::-separated elements in the original name.
  readonly elements: number;
}

const USIZE_MAX = 2 ** 64 - 1;

/// De-mangles a Rust symbol into a more readable version
///
/// All Rust symbols by default are mangled as they contain characters that
/// cannot be represented in all object files. The mangling mechanism is similar
/// to C++'s, but Rust has a few specifics to handle items like lifetimes in
/// symbols.
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

// All Rust symbols are in theory lists of "::"-separated identifiers. Some
// assemblers, however, can't handle these characters in symbol names. To get
// around this, we use C++-style mangling. The mangling method is:
//
// 1. Prefix the symbol with "_ZN"
// 2. For each element of the path, emit the length plus the element
// 3. End the path with "E"
//
// For example, "_ZN4testE" => "test" and "_ZN3foo3barE" => "foo::bar".
//
// We're the ones printing our backtraces, so we can't rely on anything else to
// demangle our symbols. It's *much* nicer to look at demangled symbols, so
// this function is implemented to give us nice pretty output.
//
// Note that this demangler isn't quite as fancy as it could be. We have lots
// of other information in our symbols like hashes, version, type information,
// etc. Additionally, this doesn't handle glue symbols at all.
// crate: rustc-demangle-0.1.28/src/legacy.rs:49 demangle
export function demangle(s: string): Result<[Demangle, string], null> {
  // First validate the symbol. If it doesn't look like anything we're
  // expecting, we just print it literally. Note that we must handle non-Rust
  // symbols because we could have any function in the backtrace.
  let inner: string;
  if (s.startsWith("_ZN")) {
    inner = s.slice(3);
  } else if (s.startsWith("ZN")) {
    // On Windows, dbghelp strips leading underscores, so we accept "ZN...E"
    // form too.
    inner = s.slice(2);
  } else if (s.startsWith("__ZN")) {
    // On OSX, symbols are prefixed with an extra _
    inner = s.slice(4);
  } else {
    return Err(null);
  }

  // only work with ascii text
  for (let j = 0; j < inner.length; j++) {
    if (inner.charCodeAt(j) & 0xff80) {
      return Err(null);
    }
  }

  let elements = 0;
  // `inner.chars()`: `pos` is the offset of the next char
  let pos = 0;
  if (pos >= inner.length) return Err(null);
  let c = inner.charCodeAt(pos++);
  while (c !== 0x45 /* 'E' */) {
    // Decode an identifier element's length.
    if (to_digit(c, 10) === undefined) {
      return Err(null);
    }
    let len = 0;
    let d: number | undefined;
    while ((d = to_digit(c, 10)) !== undefined) {
      if (len > (USIZE_MAX - d) / 10) return Err(null);
      len = len * 10 + d;
      if (pos >= inner.length) return Err(null);
      c = inner.charCodeAt(pos++);
    }

    // `c` already contains the first character of this identifier, skip it and
    // all the other characters of this identifier, to reach the next element.
    for (let k = 0; k < len; k++) {
      if (pos >= inner.length) return Err(null);
      c = inner.charCodeAt(pos++);
    }

    elements += 1;
  }

  return Ok([{ inner, elements }, inner.slice(pos)]);
}

// Rust hashes are hex digits with an `h` prepended.
// crate: rustc-demangle-0.1.28/src/legacy.rs:101 is_rust_hash
function is_rust_hash(s: string): boolean {
  if (!s.startsWith("h")) return false;
  for (const c of s.slice(1)) {
    if (to_digit(c.codePointAt(0)!, 16) === undefined) return false;
  }
  return true;
}

/** `u32::from_str_radix(src, 16).ok()` */
function u32_from_str_radix_16(src: string): number | undefined {
  let digits = src;
  if (digits.length > 1 && (digits[0] === "+" || digits[0] === "-")) {
    if (digits[0] === "-") return undefined;
    digits = digits.slice(1);
  }
  if (digits.length === 0) return undefined;
  let v = 0;
  for (const c of digits) {
    const d = to_digit(c.codePointAt(0)!, 16);
    if (d === undefined) return undefined;
    v = v * 16 + d;
    if (v > 0xffff_ffff) return undefined;
  }
  return v;
}

// impl<'a> fmt::Display for Demangle<'a>
// crate: rustc-demangle-0.1.28/src/legacy.rs:106 fmt
export function fmt_Demangle(self: Demangle, f: Formatter): FmtResult {
  let r: FmtResult;
  // Alright, let's do this.
  let inner = self.inner;
  for (let element = 0; element < self.elements; element++) {
    let rest = inner;
    while (to_digit(unwrap(rest.codePointAt(0)), 10) !== undefined) {
      rest = rest.slice(1);
    }
    const i = Number(inner.slice(0, inner.length - rest.length));
    inner = rest.slice(i);
    rest = rest.slice(0, i);
    // Skip printing the hash if alternate formatting
    // was requested.
    if (f.alternate() && element + 1 === self.elements && is_rust_hash(rest)) {
      break;
    }
    if (element !== 0) {
      if ((r = f.write_str("::")).$ === "Err") return r;
    }
    if (rest.startsWith("_$")) {
      rest = rest.slice(1);
    }
    for (;;) {
      if (rest.startsWith(".")) {
        if (rest[1] === ".") {
          if ((r = f.write_str("::")).$ === "Err") return r;
          rest = rest.slice(2);
        } else {
          if ((r = f.write_str(".")).$ === "Err") return r;
          rest = rest.slice(1);
        }
      } else if (rest.startsWith("$")) {
        const end_ = rest.slice(1).indexOf("$");
        if (end_ === -1) {
          break;
        }
        const end = end_ + 1;
        const escape = rest.slice(1, end);
        const after_escape = rest.slice(end + 1);

        // see src/librustc_codegen_utils/symbol_names/legacy.rs for these mappings
        let unescaped: string;
        switch (escape) {
          case "SP":
            unescaped = "@";
            break;
          case "BP":
            unescaped = "*";
            break;
          case "RF":
            unescaped = "&";
            break;
          case "LT":
            unescaped = "<";
            break;
          case "GT":
            unescaped = ">";
            break;
          case "LP":
            unescaped = "(";
            break;
          case "RP":
            unescaped = ")";
            break;
          case "C":
            unescaped = ",";
            break;

          default: {
            if (escape.startsWith("u")) {
              const digits = escape.slice(1);
              let all_lower_hex = true;
              for (const c of digits) {
                if (!((c >= "0" && c <= "9") || (c >= "a" && c <= "f"))) {
                  all_lower_hex = false;
                  break;
                }
              }
              const n = u32_from_str_radix_16(digits);
              const c = n === undefined ? undefined : from_u32(n);
              if (all_lower_hex && c !== undefined) {
                // FIXME(eddyb) do we need to filter out control codepoints?
                if (!is_control(c)) {
                  if ((r = f.write_str(String.fromCodePoint(c))).$ === "Err") return r;
                  rest = after_escape;
                  continue;
                }
              }
            }
            unescaped = "";
          }
        }
        if (unescaped === "") break;
        if ((r = f.write_str(unescaped)).$ === "Err") return r;
        rest = after_escape;
      } else {
        let i = -1;
        for (let j = 0; j < rest.length; j++) {
          if (rest[j] === "$" || rest[j] === ".") {
            i = j;
            break;
          }
        }
        if (i !== -1) {
          if ((r = f.write_str(rest.slice(0, i))).$ === "Err") return r;
          rest = rest.slice(i);
        } else {
          break;
        }
      }
    }
    if ((r = f.write_str(rest)).$ === "Err") return r;
  }

  return FMT_OK;
}
