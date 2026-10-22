// Port of rustc-demangle =0.1.28 `src/v0.rs`. Conventions: see lib.ts.
//
// PORT: `demangle` rejects any input with a non-ASCII byte before parsing it, so `Parser::sym` offsets are
// byte offsets. `u64` values (base-62 integers, disambiguators, lifetime indices, leaf const values) are
// `bigint`s kept in `0..2^64` with the upstream `checked_*` overflow checks; `usize` / `u32` positions,
// lengths and depths are `number`s (an identifier length that does not fit is `Invalid` either way, since
// it runs past the end of the symbol).
// PORT: `parse!(printer, method(args))` is `this.parse((p) => p.method(args))`, which returns either the
// parsed value (`Val`) or the `fmt::Result` the macro returns early with (`Ret`); `invalid!(printer)` is
// `return this.invalid()`. `Printer::print(x: impl Display)` takes the text (`&str`, `char`, integers) or a
// `Display` callback (`Ident`).
// PORT: `HexNibbles::try_parse_str_chars` returns the validated chars as an array instead of a lazy
// iterator (upstream validates the whole iterator before printing any of it).
import { from_u32, to_digit } from "../../std/char.ts";
import { escape_char } from "../../std/fmt.ts";
import { panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { from_utf8 } from "../../std/str.ts";
import { FMT_OK, type FmtError, type FmtResult, type Formatter } from "./lib.ts";

const U64_MAX = (1n << 64n) - 1n;

// Maximum recursion depth when parsing symbols before we just bail out saying
// "this symbol is invalid"
export const MAX_DEPTH = 500;

/// Representation of a demangled symbol name.
export interface Demangle {
  readonly inner: string;
}

export type ParseError =
  /// Symbol doesn't match the expected `v0` grammar.
  | "Invalid"

  /// Parsing the symbol crossed the recursion limit (see `MAX_DEPTH`).
  | "RecursedTooDeep";
export const ParseError = {
  Invalid: "Invalid",
  RecursedTooDeep: "RecursedTooDeep",

  /// Snippet to print when the error is initially encountered.
  // crate: rustc-demangle-0.1.28/src/v0.rs:588 message
  message(self: ParseError): string {
    switch (self) {
      case "Invalid":
        return "{invalid syntax}";
      case "RecursedTooDeep":
        return "{recursion limit reached}";
    }
  },
} as const;

/** `#[derive(Debug)]` */
export const debug_ParseError = (v: ParseError): string => v;

/// De-mangles a Rust symbol into a more readable version
///
/// This function will take a **mangled** symbol and return a value. When printed,
/// the de-mangled version will be written. If the symbol does not look like
/// a mangled symbol, the original value will be written instead.
// crate: rustc-demangle-0.1.28/src/v0.rs:37 demangle
export function demangle(s: string): Result<[Demangle, string], ParseError> {
  // First validate the symbol. If it doesn't look like anything we're
  // expecting, we just print it literally. Note that we must handle non-Rust
  // symbols because we could have any function in the backtrace.
  // PORT: `s.len() > n` with an ASCII prefix of length `n` holds iff there is a char after the prefix.
  let inner: string;
  if (s.length > 2 && s.startsWith("_R")) {
    inner = s.slice(2);
  } else if (s.length > 1 && s.startsWith("R")) {
    // On Windows, dbghelp strips leading underscores, so we accept "R..."
    // form too.
    inner = s.slice(1);
  } else if (s.length > 3 && s.startsWith("__R")) {
    // On OSX, symbols are prefixed with an extra _
    inner = s.slice(3);
  } else {
    return Err("Invalid");
  }

  // Paths always start with uppercase characters.
  const b0 = inner.charCodeAt(0);
  if (!(b0 >= 0x41 && b0 <= 0x5a)) {
    return Err("Invalid");
  }

  // only work with ascii text
  for (let j = 0; j < inner.length; j++) {
    if (inner.charCodeAt(j) & 0xff80) {
      return Err("Invalid");
    }
  }

  // Verify that the symbol is indeed a valid path.
  const try_parse_path = (parser: Parser): Result<Parser, ParseError> => {
    const dummy_printer = new Printer(Ok(parser), undefined, 0);
    const r = dummy_printer.print_path(false);
    if (r.$ === "Err") panic("`fmt::Error`s should be impossible without a `fmt::Formatter`: Error");
    return dummy_printer.parser;
  };
  let parser = new Parser(inner, 0, 0);
  const r = try_parse_path(parser);
  if (r.$ === "Err") return r;
  parser = r._0;

  // Instantiating crate (paths always start with uppercase characters).
  const b = parser.sym.charCodeAt(parser.next);
  if (b >= 0x41 && b <= 0x5a) {
    const r = try_parse_path(parser);
    if (r.$ === "Err") return r;
    parser = r._0;
  }

  return Ok([{ inner }, parser.sym.slice(parser.next)]);
}

// impl<'s> fmt::Display for Demangle<'s>
// crate: rustc-demangle-0.1.28/src/v0.rs:94 fmt
export function fmt_Demangle(self: Demangle, f: Formatter): FmtResult {
  const printer = new Printer(Ok(new Parser(self.inner, 0, 0)), f, 0);
  return printer.print_path(true);
}

class Ident {
  constructor(
    /// ASCII part of the identifier.
    readonly ascii: string,
    /// Punycode insertion codes for Unicode codepoints, if any.
    readonly punycode: string,
  ) {}

  /// Attempt to decode punycode on the stack (allocation-free),
  /// and pass the char slice to the closure, if successful.
  /// This supports up to `SMALL_PUNYCODE_LEN` characters.
  // crate: rustc-demangle-0.1.28/src/v0.rs:121 try_small_punycode_decode
  try_small_punycode_decode<R>(f: (chars: readonly number[]) => R): R | undefined {
    const out: number[] = new Array<number>(SMALL_PUNYCODE_LEN).fill(0);
    let out_len = 0;
    const r = this.punycode_decode((i, c) => {
      // Check there's space left for another character.
      if (out_len >= out.length) return Err(null);

      // Move the characters after the insert position.
      let j = out_len;
      out_len += 1;

      while (j > i) {
        out[j] = out[j - 1]!;
        j -= 1;
      }

      // Insert the new character.
      out[i] = c;

      return Ok(undefined);
    });
    if (r.$ === "Ok") {
      return f(out.slice(0, out_len));
    } else {
      return undefined;
    }
  }

  /// Decode punycode as insertion positions and characters
  /// and pass them to the closure, which can return `Err(())`
  /// to stop the decoding process.
  // PORT: the `usize` state is `bigint` (exact `checked_*` overflow at 2^64).
  // crate: rustc-demangle-0.1.28/src/v0.rs:152 punycode_decode
  punycode_decode(insert: (i: number, c: number) => Result<undefined, null>): Result<undefined, null> {
    const punycode_bytes = this.punycode;
    let pb = 0;
    if (pb >= punycode_bytes.length) {
      return Err(null);
    }

    let len = 0n;

    // Populate initial output from ASCII fragment.
    for (const c of this.ascii) {
      const r = insert(Number(len), c.codePointAt(0)!);
      if (r.$ === "Err") return r;
      len += 1n;
    }

    // Punycode parameters and initial state.
    const base = 36n;
    const t_min = 1n;
    const t_max = 26n;
    const skew = 38n;
    let damp = 700n;
    let bias = 72n;
    let i = 0n;
    let n = 0x80n;

    for (;;) {
      // Read one delta value.
      let delta = 0n;
      let w = 1n;
      let k = 0n;
      for (;;) {
        k += base;
        const sat = k > bias ? k - bias : 0n;
        const mx = sat > t_min ? sat : t_min;
        const t = mx < t_max ? mx : t_max;

        let d: bigint;
        const db = pb < punycode_bytes.length ? punycode_bytes.charCodeAt(pb++) : undefined;
        if (db !== undefined && db >= 0x61 && db <= 0x7a) {
          d = BigInt(db - 0x61);
        } else if (db !== undefined && db >= 0x30 && db <= 0x39) {
          d = BigInt(26 + (db - 0x30));
        } else {
          return Err(null);
        }
        const dw = d * w;
        if (dw > U64_MAX) return Err(null);
        delta = delta + dw;
        if (delta > U64_MAX) return Err(null);
        if (d < t) {
          break;
        }
        w = w * (base - t);
        if (w > U64_MAX) return Err(null);
      }

      // Compute the new insert position and character.
      len += 1n;
      i = i + delta;
      if (i > U64_MAX) return Err(null);
      n = n + i / len;
      if (n > U64_MAX) return Err(null);
      i %= len;

      let c: number;
      if (n <= 0xffff_ffffn) {
        const c_ = from_u32(Number(n));
        if (c_ === undefined) return Err(null);
        c = c_;
      } else {
        return Err(null);
      }

      // Insert the new character and increment the insert position.
      const r = insert(Number(i), c);
      if (r.$ === "Err") return r;
      i += 1n;

      // If there are no more deltas, decoding is complete.
      if (pb >= punycode_bytes.length) {
        return Ok(undefined);
      }

      // Perform bias adaptation.
      delta /= damp;
      damp = 2n;

      delta += delta / len;
      let k2 = 0n;
      while (delta > ((base - t_min) * t_max) / 2n) {
        delta /= base - t_min;
        k2 += base;
      }
      bias = k2 + ((base - t_min + 1n) * delta) / (delta + skew);
    }
  }
}

const SMALL_PUNYCODE_LEN = 128;

// impl<'s> fmt::Display for Ident<'s>
// crate: rustc-demangle-0.1.28/src/v0.rs:241 fmt
function fmt_Ident(self: Ident, f: Formatter): FmtResult {
  const r = self.try_small_punycode_decode((chars) => {
    for (const c of chars) {
      const r = f.write_str(String.fromCodePoint(c));
      if (r.$ === "Err") return r;
    }
    return FMT_OK;
  });
  if (r !== undefined) return r;
  if (self.punycode.length !== 0) {
    let r = f.write_str("punycode{");
    if (r.$ === "Err") return r;

    // Reconstruct a standard Punycode encoding,
    // by using `-` as the separator.
    if (self.ascii.length !== 0) {
      if ((r = f.write_str(self.ascii)).$ === "Err") return r;
      if ((r = f.write_str("-")).$ === "Err") return r;
    }
    if ((r = f.write_str(self.punycode)).$ === "Err") return r;

    return f.write_str("}");
  } else {
    return f.write_str(self.ascii);
  }
}

/// Sequence of lowercase hexadecimal nibbles (`0-9a-f`), used by leaf consts.
class HexNibbles {
  constructor(readonly nibbles: string) {}

  /// Decode an integer value (with the "most significant nibble" first),
  /// returning `None` if it can't fit in an `u64`.
  // FIXME(eddyb) should this "just" use `u128` instead?
  // crate: rustc-demangle-0.1.28/src/v0.rs:277 try_parse_uint
  try_parse_uint(): bigint | undefined {
    let s = 0;
    while (s < this.nibbles.length && this.nibbles[s] === "0") s++;
    const nibbles = this.nibbles.slice(s);

    if (nibbles.length > 16) {
      return undefined;
    }

    let v = 0n;
    for (const nibble of nibbles) {
      v = (v << 4n) | BigInt(to_digit(nibble.charCodeAt(0), 16)!);
    }
    return v;
  }

  /// Decode a UTF-8 byte sequence (with each byte using a pair of nibbles)
  /// into individual `char`s, returning `None` for invalid UTF-8.
  // crate: rustc-demangle-0.1.28/src/v0.rs:293 try_parse_str_chars
  try_parse_str_chars(): number[] | undefined {
    if (this.nibbles.length % 2 !== 0) {
      return undefined;
    }

    // FIXME(eddyb) use `array_chunks` instead, when that becomes stable.
    const all_bytes: number[] = [];
    for (let j = 0; j + 2 <= this.nibbles.length; j += 2) {
      const half = (nibble: number) => to_digit(nibble, 16)!;
      all_bytes.push((half(this.nibbles.charCodeAt(j)) << 4) | half(this.nibbles.charCodeAt(j + 1)));
    }
    let bi = 0;

    // FIXME(eddyb) this `enum` and `fn` should be somewhere in `core`.
    type Utf8FirstByteError = "ContinuationByte" | "TooLong";
    // crate: rustc-demangle-0.1.28/src/v0.rs:321 utf8_len_from_first_byte
    function utf8_len_from_first_byte(byte: number): Result<number, Utf8FirstByteError> {
      if (byte <= 0x7f) return Ok(1);
      if (byte <= 0xbf) return Err("ContinuationByte");
      if (byte <= 0xdf) return Ok(2);
      if (byte <= 0xef) return Ok(3);
      if (byte <= 0xf7) return Ok(4);
      return Err("TooLong");
    }

    // As long as there are any bytes left, there's at least one more
    // UTF-8-encoded `char` to decode (or the possibility of error).
    const chars: number[] = [];
    while (bi < all_bytes.length) {
      const first_byte = all_bytes[bi++]!;
      // Collect the appropriate amount of bytes (up to 4), according
      // to the UTF-8 length implied by the first byte.
      const ul = utf8_len_from_first_byte(first_byte);
      // HACK(eddyb) doing a separate validation iteration like this might be
      // wasteful, but it's easier to avoid starting to print a string literal
      // in the first place, than to abort it mid-string.
      if (ul.$ === "Err") return undefined;
      const utf8_len = ul._0;
      const utf8 = new Uint8Array(utf8_len);
      utf8[0] = first_byte;
      for (let i = 1; i < utf8_len; i++) {
        if (bi >= all_bytes.length) return undefined;
        utf8[i] = all_bytes[bi++]!;
      }

      // Fully validate the UTF-8 sequence.
      const s = from_utf8(utf8);
      if (s.$ === "Err") return undefined;

      // Since we included exactly one UTF-8 sequence, and validation
      // succeeded, `str::chars` should return exactly one `char`.
      const cs = Array.from(s._0);
      if (cs.length === 1) {
        chars.push(cs[0]!.codePointAt(0)!);
      } else {
        unreachable(`str::from_utf8(${String(Array.from(utf8))}) = ${s._0} was expected to have 1 char, but ${cs.length} chars were found`);
      }
    }

    return chars;
  }
}

// crate: rustc-demangle-0.1.28/src/v0.rs:370 basic_type
function basic_type(tag: number): string | undefined {
  switch (String.fromCharCode(tag)) {
    case "b":
      return "bool";
    case "c":
      return "char";
    case "e":
      return "str";
    case "u":
      return "()";
    case "a":
      return "i8";
    case "s":
      return "i16";
    case "l":
      return "i32";
    case "x":
      return "i64";
    case "n":
      return "i128";
    case "i":
      return "isize";
    case "h":
      return "u8";
    case "t":
      return "u16";
    case "m":
      return "u32";
    case "y":
      return "u64";
    case "o":
      return "u128";
    case "j":
      return "usize";
    case "f":
      return "f32";
    case "d":
      return "f64";
    case "z":
      return "!";
    case "p":
      return "_";
    case "v":
      return "...";

    default:
      return undefined;
  }
}

class Parser {
  constructor(
    readonly sym: string,
    public next: number,
    public depth: number,
  ) {}

  // crate: rustc-demangle-0.1.28/src/v0.rs:405 push_depth
  push_depth(): Result<undefined, ParseError> {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      return Err("RecursedTooDeep");
    } else {
      return Ok(undefined);
    }
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:414 pop_depth
  pop_depth(): void {
    this.depth -= 1;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:418 peek
  peek(): number | undefined {
    return this.next < this.sym.length ? this.sym.charCodeAt(this.next) : undefined;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:422 eat
  eat(b: number): boolean {
    if (this.peek() === b) {
      this.next += 1;
      return true;
    } else {
      return false;
    }
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:431 next
  next_(): Result<number, ParseError> {
    const b = this.peek();
    if (b === undefined) return Err("Invalid");
    this.next += 1;
    return Ok(b);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:437 hex_nibbles
  hex_nibbles(): Result<HexNibbles, ParseError> {
    const start = this.next;
    for (;;) {
      const r = this.next_();
      if (r.$ === "Err") return r;
      const b = r._0;
      if ((b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66)) {
        // ok
      } else if (b === 0x5f /* '_' */) {
        break;
      } else {
        return Err("Invalid");
      }
    }
    return Ok(new HexNibbles(this.sym.slice(start, this.next - 1)));
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:451 digit_10
  digit_10(): Result<number, ParseError> {
    const p = this.peek();
    let d: number;
    if (p !== undefined && p >= 0x30 && p <= 0x39) {
      d = p - 0x30;
    } else {
      return Err("Invalid");
    }
    this.next += 1;
    return Ok(d);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:460 digit_62
  digit_62(): Result<number, ParseError> {
    const p = this.peek();
    let d: number;
    if (p !== undefined && p >= 0x30 && p <= 0x39) {
      d = p - 0x30;
    } else if (p !== undefined && p >= 0x61 && p <= 0x7a) {
      d = 10 + (p - 0x61);
    } else if (p !== undefined && p >= 0x41 && p <= 0x5a) {
      d = 10 + 26 + (p - 0x41);
    } else {
      return Err("Invalid");
    }
    this.next += 1;
    return Ok(d);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:471 integer_62
  integer_62(): Result<bigint, ParseError> {
    if (this.eat(0x5f /* '_' */)) {
      return Ok(0n);
    }

    let x = 0n;
    while (!this.eat(0x5f /* '_' */)) {
      const r = this.digit_62();
      if (r.$ === "Err") return r;
      const d = BigInt(r._0);
      x = x * 62n;
      if (x > U64_MAX) return Err("Invalid");
      x = x + d;
      if (x > U64_MAX) return Err("Invalid");
    }
    return x + 1n > U64_MAX ? Err("Invalid") : Ok(x + 1n);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:485 opt_integer_62
  opt_integer_62(tag: number): Result<bigint, ParseError> {
    if (!this.eat(tag)) {
      return Ok(0n);
    }
    const r = this.integer_62();
    if (r.$ === "Err") return r;
    return r._0 + 1n > U64_MAX ? Err("Invalid") : Ok(r._0 + 1n);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:492 disambiguator
  disambiguator(): Result<bigint, ParseError> {
    return this.opt_integer_62(0x73 /* 's' */);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:496 namespace
  namespace(): Result<string | undefined, ParseError> {
    const r = this.next_();
    if (r.$ === "Err") return r;
    const ns = r._0;
    // Special namespaces, like closures and shims.
    if (ns >= 0x41 && ns <= 0x5a) return Ok(String.fromCharCode(ns));

    // Implementation-specific/unspecified namespaces.
    if (ns >= 0x61 && ns <= 0x7a) return Ok(undefined);

    return Err("Invalid");
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:508 backref
  backref(): Result<Parser, ParseError> {
    const s_start = this.next - 1;
    const r = this.integer_62();
    if (r.$ === "Err") return r;
    const i = r._0;
    if (i >= BigInt(s_start)) {
      return Err("Invalid");
    }
    const new_parser = new Parser(this.sym, Number(i), this.depth);
    const p = new_parser.push_depth();
    if (p.$ === "Err") return p;
    return Ok(new_parser);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:523 ident
  ident(): Result<Ident, ParseError> {
    const is_punycode = this.eat(0x75 /* 'u' */);
    const r = this.digit_10();
    if (r.$ === "Err") return r;
    let len = r._0;
    if (len !== 0) {
      for (;;) {
        const d = this.digit_10();
        if (d.$ === "Err") break;
        len = len * 10 + d._0;
        if (!Number.isSafeInteger(len)) return Err("Invalid");
      }
    }

    // Skip past the optional `_` separator.
    this.eat(0x5f /* '_' */);

    const start = this.next;
    this.next = this.next + len;
    if (this.next > this.sym.length) {
      return Err("Invalid");
    }

    const ident = this.sym.slice(start, this.next);

    if (is_punycode) {
      const i = ident.lastIndexOf("_");
      const id = i !== -1 ? new Ident(ident.slice(0, i), ident.slice(i + 1)) : new Ident("", ident);
      if (id.punycode.length === 0) {
        return Err("Invalid");
      }
      return Ok(id);
    } else {
      return Ok(new Ident(ident, ""));
    }
  }
}

/** `parse!`'s outcome: the parsed value, or the `fmt::Result` to return early with. */
type Parsed<T> = { readonly $: "Val"; readonly _0: T } | { readonly $: "Ret"; readonly _0: FmtResult };

/** `impl fmt::Display` arguments of `Printer::print`. */
type Display = string | ((f: Formatter) => FmtResult);

class Printer {
  constructor(
    /// The input parser to demangle from, or `Err` if any (parse) error was
    /// encountered (in order to disallow further likely-incorrect demangling).
    ///
    /// See also the documentation on the `invalid!` and `parse!` macros below.
    public parser: Result<Parser, ParseError>,

    /// The output formatter to demangle to, or `None` while skipping printing.
    public out: Formatter | undefined,

    /// Cumulative number of lifetimes bound by `for<...>` binders ('G'),
    /// anywhere "around" the current entity (e.g. type) being demangled.
    /// This value is not tracked while skipping printing, as it'd be unused.
    ///
    /// See also the documentation on the `Printer::in_binder` method.
    public bound_lifetime_depth: number,
  ) {}

  /// Mark the parser as errored (with `ParseError::Invalid`), print the
  /// appropriate message (see `ParseError::message`) and return early.
  /** `invalid!(self)`: the value the macro returns with. */
  private invalid(): FmtResult {
    const err: ParseError = "Invalid";
    const r = this.print(ParseError.message(err));
    if (r.$ === "Err") return r;
    this.parser = Err(err);
    return FMT_OK;
  }

  /// Call a parser method (if the parser hasn't errored yet),
  /// and mark the parser as errored if it returns `Err`.
  ///
  /// If the parser errored, before or now, this returns early,
  /// from the current function, after printing either:
  /// * for a new error, the appropriate message (see `ParseError::message`)
  /// * for an earlier error, only `?` -  this allows callers to keep printing
  ///   the approximate syntax of the path/type/const, despite having errors,
  ///   e.g. `Vec<[(A, ?); ?]>` instead of `Vec<[(A, ?`
  /** `parse!(self, method(args))` */
  private parse<T>(method: (p: Parser) => Result<T, ParseError>): Parsed<T> {
    const parser = this.parser;
    if (parser.$ === "Ok") {
      const r = method(parser._0);
      if (r.$ === "Ok") {
        return { $: "Val", _0: r._0 };
      } else {
        const err = r._0;
        const p = this.print(ParseError.message(err));
        if (p.$ === "Err") return { $: "Ret", _0: p };
        this.parser = Err(err);
        return { $: "Ret", _0: FMT_OK };
      }
    } else {
      return { $: "Ret", _0: this.print("?") };
    }
  }

  /// Eat the given character from the parser,
  /// returning `false` if the parser errored.
  // crate: rustc-demangle-0.1.28/src/v0.rs:635 eat
  eat(b: number): boolean {
    return this.parser.$ === "Ok" && this.parser._0.eat(b);
  }

  /// Skip printing (i.e. `self.out` will be `None`) for the duration of the
  /// given closure. This should not change parsing behavior, only disable the
  /// output, but there may be optimizations (such as not traversing backrefs).
  // crate: rustc-demangle-0.1.28/src/v0.rs:642 skipping_printing
  skipping_printing(f: (p: Printer) => FmtResult): void {
    const orig_out = this.out;
    this.out = undefined;
    const r = f(this);
    if (r.$ === "Err") panic("`fmt::Error`s should be impossible without a `fmt::Formatter`: Error");
    this.out = orig_out;
  }

  /// Print the target of a backref, using the given closure.
  /// When printing is being skipped, the backref will only be parsed,
  /// ignoring the backref's target completely.
  // crate: rustc-demangle-0.1.28/src/v0.rs:654 print_backref
  print_backref(f: (p: Printer) => FmtResult): FmtResult {
    const bp = this.parse((p) => p.backref());
    if (bp.$ === "Ret") return bp._0;
    const backref_parser = bp._0;

    if (this.out === undefined) {
      return FMT_OK;
    }

    const orig_parser = this.parser;
    this.parser = Ok(backref_parser);
    const r = f(this);
    this.parser = orig_parser;
    return r;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:670 pop_depth
  pop_depth(): void {
    if (this.parser.$ === "Ok") {
      this.parser._0.pop_depth();
    }
  }

  /// Output the given value to `self.out` (using `fmt::Display` formatting),
  /// if printing isn't being skipped.
  // crate: rustc-demangle-0.1.28/src/v0.rs:678 print
  print(x: Display): FmtResult {
    const out = this.out;
    if (out !== undefined) {
      const r = typeof x === "string" ? out.write_str(x) : x(out);
      if (r.$ === "Err") return r;
    }
    return FMT_OK;
  }

  /// Output the given `char`s (escaped using `char::escape_debug`), with the
  /// whole sequence wrapped in quotes, for either a `char` or `&str` literal,
  /// if printing isn't being skipped.
  // crate: rustc-demangle-0.1.28/src/v0.rs:688 print_quoted_escaped_chars
  print_quoted_escaped_chars(quote: number, chars: readonly number[]): FmtResult {
    const out = this.out;
    if (out !== undefined) {
      let r = out.write_str(String.fromCodePoint(quote));
      if (r.$ === "Err") return r;
      for (const c of chars) {
        // Special-case not escaping a single/double quote, when
        // inside the opposite kind of quote.
        if ((quote === 0x27 && c === 0x22) || (quote === 0x22 && c === 0x27)) {
          if ((r = out.write_str(String.fromCodePoint(c))).$ === "Err") return r;
          continue;
        }

        // `for escaped in c.escape_debug() { out.write_char(escaped)?; }`
        for (const escaped of escape_char(c, true, true)) {
          if ((r = out.write_str(escaped)).$ === "Err") return r;
        }
      }
      if ((r = out.write_str(String.fromCodePoint(quote))).$ === "Err") return r;
    }
    return FMT_OK;
  }

  /// Print the lifetime according to the previously decoded index.
  /// An index of `0` always refers to `'_`, but starting with `1`,
  /// indices refer to late-bound lifetimes introduced by a binder.
  // crate: rustc-demangle-0.1.28/src/v0.rs:717 print_lifetime_from_index
  print_lifetime_from_index(lt: bigint): FmtResult {
    // Bound lifetimes aren't tracked when skipping printing.
    if (this.out === undefined) {
      return FMT_OK;
    }

    let r = this.print("'");
    if (r.$ === "Err") return r;
    if (lt === 0n) {
      return this.print("_");
    }
    const depth = BigInt(this.bound_lifetime_depth) - lt;
    if (depth >= 0n) {
      // Try to print lifetimes alphabetically first.
      if (depth < 26n) {
        const c = String.fromCharCode(0x61 + Number(depth));
        return this.print(c);
      } else {
        // Use `'_123` after running out of letters.
        if ((r = this.print("_")).$ === "Err") return r;
        return this.print(String(depth));
      }
    } else {
      return this.invalid();
    }
  }

  /// Optionally enter a binder ('G') for late-bound lifetimes,
  /// printing e.g. `for<'a, 'b> ` before calling the closure,
  /// and make those lifetimes visible to it (via depth level).
  // crate: rustc-demangle-0.1.28/src/v0.rs:746 in_binder
  in_binder(f: (p: Printer) => FmtResult): FmtResult {
    const bl = this.parse((p) => p.opt_integer_62(0x47 /* 'G' */));
    if (bl.$ === "Ret") return bl._0;
    const bound_lifetimes = bl._0;

    // Don't track bound lifetimes when skipping printing.
    if (this.out === undefined) {
      return f(this);
    }

    let r: FmtResult;
    if (bound_lifetimes > 0n) {
      if ((r = this.print("for<")).$ === "Err") return r;
      for (let i = 0n; i < bound_lifetimes; i++) {
        if (i > 0n) {
          if ((r = this.print(", ")).$ === "Err") return r;
        }
        this.bound_lifetime_depth = (this.bound_lifetime_depth + 1) >>> 0;
        if ((r = this.print_lifetime_from_index(1n)).$ === "Err") return r;
      }
      if ((r = this.print("> ")).$ === "Err") return r;
    }

    r = f(this);

    // Restore `bound_lifetime_depth` to the previous value.
    this.bound_lifetime_depth = (this.bound_lifetime_depth - Number(BigInt.asUintN(32, bound_lifetimes))) >>> 0;

    return r;
  }

  /// Print list elements using the given closure and separator,
  /// until the end of the list ('E') is found, or the parser errors.
  /// Returns the number of elements printed.
  // crate: rustc-demangle-0.1.28/src/v0.rs:780 print_sep_list
  print_sep_list(f: (p: Printer) => FmtResult, sep: string): Result<number, FmtError> {
    let i = 0;
    while (this.parser.$ === "Ok" && !this.eat(0x45 /* 'E' */)) {
      if (i > 0) {
        const r = this.print(sep);
        if (r.$ === "Err") return r;
      }
      const r = f(this);
      if (r.$ === "Err") return r;
      i += 1;
    }
    return Ok(i);
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:795 print_path
  print_path(in_value: boolean): FmtResult {
    let r: FmtResult;
    const pd = this.parse((p) => p.push_depth());
    if (pd.$ === "Ret") return pd._0;

    const t = this.parse((p) => p.next_());
    if (t.$ === "Ret") return t._0;
    const tag = t._0;
    switch (String.fromCharCode(tag)) {
      case "C": {
        const d = this.parse((p) => p.disambiguator());
        if (d.$ === "Ret") return d._0;
        const dis = d._0;
        const n = this.parse((p) => p.ident());
        if (n.$ === "Ret") return n._0;
        const name = n._0;

        if ((r = this.print((f) => fmt_Ident(name, f))).$ === "Err") return r;
        const out = this.out;
        if (out !== undefined) {
          if (!out.alternate() && dis !== 0n) {
            if ((r = out.write_str("[")).$ === "Err") return r;
            if ((r = out.write_str(dis.toString(16))).$ === "Err") return r;
            if ((r = out.write_str("]")).$ === "Err") return r;
          }
        }
        break;
      }
      case "N": {
        const nsr = this.parse((p) => p.namespace());
        if (nsr.$ === "Ret") return nsr._0;
        const ns = nsr._0;

        if ((r = this.print_path(in_value)).$ === "Err") return r;

        // HACK(eddyb) if the parser is already marked as having errored,
        // `parse!` below will print a `?` without its preceding `::`
        // (because printing the `::` is skipped in certain conditions,
        // i.e. a lowercase namespace with an empty identifier),
        // so in order to get `::?`, the `::` has to be printed here.
        if (this.parser.$ === "Err") {
          if ((r = this.print("::")).$ === "Err") return r;
        }

        const d = this.parse((p) => p.disambiguator());
        if (d.$ === "Ret") return d._0;
        const dis = d._0;
        const n = this.parse((p) => p.ident());
        if (n.$ === "Ret") return n._0;
        const name = n._0;

        if (ns !== undefined) {
          // Special namespaces, like closures and shims.
          if ((r = this.print("::{")).$ === "Err") return r;
          switch (ns) {
            case "C":
              if ((r = this.print("closure")).$ === "Err") return r;
              break;
            case "S":
              if ((r = this.print("shim")).$ === "Err") return r;
              break;
            default:
              if ((r = this.print(ns)).$ === "Err") return r;
          }
          if (name.ascii.length !== 0 || name.punycode.length !== 0) {
            if ((r = this.print(":")).$ === "Err") return r;
            if ((r = this.print((f) => fmt_Ident(name, f))).$ === "Err") return r;
          }
          if ((r = this.print("#")).$ === "Err") return r;
          if ((r = this.print(String(dis))).$ === "Err") return r;
          if ((r = this.print("}")).$ === "Err") return r;
        } else {
          // Implementation-specific/unspecified namespaces.
          if (name.ascii.length !== 0 || name.punycode.length !== 0) {
            if ((r = this.print("::")).$ === "Err") return r;
            if ((r = this.print((f) => fmt_Ident(name, f))).$ === "Err") return r;
          }
        }
        break;
      }
      case "M":
      case "X":
      case "Y": {
        if (tag !== 0x59 /* 'Y' */) {
          // Ignore the `impl`'s own path.
          const d = this.parse((p) => p.disambiguator());
          if (d.$ === "Ret") return d._0;
          this.skipping_printing((this_) => this_.print_path(false));
        }

        if ((r = this.print("<")).$ === "Err") return r;
        if ((r = this.print_type()).$ === "Err") return r;
        if (tag !== 0x4d /* 'M' */) {
          if ((r = this.print(" as ")).$ === "Err") return r;
          if ((r = this.print_path(false)).$ === "Err") return r;
        }
        if ((r = this.print(">")).$ === "Err") return r;
        break;
      }
      case "I": {
        if ((r = this.print_path(in_value)).$ === "Err") return r;
        if (in_value) {
          if ((r = this.print("::")).$ === "Err") return r;
        }
        if ((r = this.print("<")).$ === "Err") return r;
        const l = this.print_sep_list((p) => p.print_generic_arg(), ", ");
        if (l.$ === "Err") return l;
        if ((r = this.print(">")).$ === "Err") return r;
        break;
      }
      case "B": {
        if ((r = this.print_backref((this_) => this_.print_path(in_value))).$ === "Err") return r;
        break;
      }
      default:
        return this.invalid();
    }

    this.pop_depth();
    return FMT_OK;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:891 print_generic_arg
  print_generic_arg(): FmtResult {
    if (this.eat(0x4c /* 'L' */)) {
      const l = this.parse((p) => p.integer_62());
      if (l.$ === "Ret") return l._0;
      return this.print_lifetime_from_index(l._0);
    } else if (this.eat(0x4b /* 'K' */)) {
      return this.print_const(false);
    } else {
      return this.print_type();
    }
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:902 print_type
  print_type(): FmtResult {
    let r: FmtResult;
    // The splat feature is unstable and its mangling is subject to change
    // FIXME(splat):
    // - for efficiency we might want to use a letter that can't occur in any type, rather than
    //   taking an unused letter
    // - splat isn't implemented for legacy mangling
    if (this.eat(0x77 /* 'w' */)) {
      if ((r = this.print("#[splat] ")).$ === "Err") return r;
    }
    const t = this.parse((p) => p.next_());
    if (t.$ === "Ret") return t._0;
    const tag = t._0;

    const ty = basic_type(tag);
    if (ty !== undefined) {
      return this.print(ty);
    }

    const pd = this.parse((p) => p.push_depth());
    if (pd.$ === "Ret") return pd._0;

    switch (String.fromCharCode(tag)) {
      case "R":
      case "Q": {
        if ((r = this.print("&")).$ === "Err") return r;
        if (this.eat(0x4c /* 'L' */)) {
          const l = this.parse((p) => p.integer_62());
          if (l.$ === "Ret") return l._0;
          const lt = l._0;
          if (lt !== 0n) {
            if ((r = this.print_lifetime_from_index(lt)).$ === "Err") return r;
            if ((r = this.print(" ")).$ === "Err") return r;
          }
        }
        if (tag !== 0x52 /* 'R' */) {
          if ((r = this.print("mut ")).$ === "Err") return r;
        }
        if ((r = this.print_type()).$ === "Err") return r;
        break;
      }

      case "P":
      case "O": {
        if ((r = this.print("*")).$ === "Err") return r;
        if (tag !== 0x50 /* 'P' */) {
          if ((r = this.print("mut ")).$ === "Err") return r;
        } else {
          if ((r = this.print("const ")).$ === "Err") return r;
        }
        if ((r = this.print_type()).$ === "Err") return r;
        break;
      }

      case "A":
      case "S": {
        if ((r = this.print("[")).$ === "Err") return r;
        if ((r = this.print_type()).$ === "Err") return r;
        if (tag === 0x41 /* 'A' */) {
          if ((r = this.print("; ")).$ === "Err") return r;
          if ((r = this.print_const(true)).$ === "Err") return r;
        }
        if ((r = this.print("]")).$ === "Err") return r;
        break;
      }
      case "T": {
        if ((r = this.print("(")).$ === "Err") return r;
        const c = this.print_sep_list((p) => p.print_type(), ", ");
        if (c.$ === "Err") return c;
        const count = c._0;
        if (count === 1) {
          if ((r = this.print(",")).$ === "Err") return r;
        }
        if ((r = this.print(")")).$ === "Err") return r;
        break;
      }
      case "F": {
        r = this.in_binder((this_) => {
          let r: FmtResult;
          const is_unsafe = this_.eat(0x55 /* 'U' */);
          let abi: string | undefined;
          if (this_.eat(0x4b /* 'K' */)) {
            if (this_.eat(0x43 /* 'C' */)) {
              abi = "C";
            } else {
              const a = this_.parse((p) => p.ident());
              if (a.$ === "Ret") return a._0;
              const abi_ = a._0;
              if (abi_.ascii.length === 0 || abi_.punycode.length !== 0) {
                return this_.invalid();
              }
              abi = abi_.ascii;
            }
          } else {
            abi = undefined;
          }

          if (is_unsafe) {
            if ((r = this_.print("unsafe ")).$ === "Err") return r;
          }

          if (abi !== undefined) {
            if ((r = this_.print('extern "')).$ === "Err") return r;

            // If the ABI had any `-`, they were replaced with `_`,
            // so the parts between `_` have to be re-joined with `-`.
            const parts = abi.split("_");
            if ((r = this_.print(parts[0]!)).$ === "Err") return r;
            for (const part of parts.slice(1)) {
              if ((r = this_.print("-")).$ === "Err") return r;
              if ((r = this_.print(part)).$ === "Err") return r;
            }

            if ((r = this_.print('" ')).$ === "Err") return r;
          }

          if ((r = this_.print("fn(")).$ === "Err") return r;
          const l = this_.print_sep_list((p) => p.print_type(), ", ");
          if (l.$ === "Err") return l;
          if ((r = this_.print(")")).$ === "Err") return r;

          if (this_.eat(0x75 /* 'u' */)) {
            // Skip printing the return type if it's 'u', i.e. `()`.
          } else {
            if ((r = this_.print(" -> ")).$ === "Err") return r;
            if ((r = this_.print_type()).$ === "Err") return r;
          }

          return FMT_OK;
        });
        if (r.$ === "Err") return r;
        break;
      }
      case "D": {
        if ((r = this.print("dyn ")).$ === "Err") return r;
        r = this.in_binder((this_) => {
          const l = this_.print_sep_list((p) => p.print_dyn_trait(), " + ");
          if (l.$ === "Err") return l;
          return FMT_OK;
        });
        if (r.$ === "Err") return r;

        if (!this.eat(0x4c /* 'L' */)) {
          return this.invalid();
        }
        const l = this.parse((p) => p.integer_62());
        if (l.$ === "Ret") return l._0;
        const lt = l._0;
        if (lt !== 0n) {
          if ((r = this.print(" + ")).$ === "Err") return r;
          if ((r = this.print_lifetime_from_index(lt)).$ === "Err") return r;
        }
        break;
      }
      case "B": {
        if ((r = this.print_backref((p) => p.print_type())).$ === "Err") return r;
        break;
      }
      case "W": {
        if ((r = this.print_type()).$ === "Err") return r;
        if ((r = this.print(" is ")).$ === "Err") return r;
        if ((r = this.print_pat()).$ === "Err") return r;
        break;
      }
      default: {
        // Go back to the tag, so `print_path` also sees it.
        if (this.parser.$ === "Ok") this.parser._0.next -= 1;
        if ((r = this.print_path(false)).$ === "Err") return r;
      }
    }

    this.pop_depth();
    return FMT_OK;
  }

  /// A trait in a trait object may have some "existential projections"
  /// (i.e. associated type bindings) after it, which should be printed
  /// in the `<...>` of the trait, e.g. `dyn Trait<T, U, Assoc=X>`.
  /// To this end, this method will keep the `<...>` of an 'I' path
  /// open, by omitting the `>`, and return `Ok(true)` in that case.
  // crate: rustc-demangle-0.1.28/src/v0.rs:1050 print_path_maybe_open_generics
  print_path_maybe_open_generics(): Result<boolean, FmtError> {
    let r: FmtResult;
    if (this.eat(0x42 /* 'B' */)) {
      // NOTE(eddyb) the closure may not run if printing is being skipped,
      // but in that case the returned boolean doesn't matter.
      let open = false;
      r = this.print_backref((this_) => {
        const o = this_.print_path_maybe_open_generics();
        if (o.$ === "Err") return o;
        open = o._0;
        return FMT_OK;
      });
      if (r.$ === "Err") return r;
      return Ok(open);
    } else if (this.eat(0x49 /* 'I' */)) {
      if ((r = this.print_path(false)).$ === "Err") return r;
      if ((r = this.print("<")).$ === "Err") return r;
      const l = this.print_sep_list((p) => p.print_generic_arg(), ", ");
      if (l.$ === "Err") return l;
      return Ok(true);
    } else {
      if ((r = this.print_path(false)).$ === "Err") return r;
      return Ok(false);
    }
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:1071 print_dyn_trait
  print_dyn_trait(): FmtResult {
    let r: FmtResult;
    const o = this.print_path_maybe_open_generics();
    if (o.$ === "Err") return o;
    let open = o._0;

    while (this.eat(0x70 /* 'p' */)) {
      if (!open) {
        if ((r = this.print("<")).$ === "Err") return r;
        open = true;
      } else {
        if ((r = this.print(", ")).$ === "Err") return r;
      }

      const n = this.parse((p) => p.ident());
      if (n.$ === "Ret") return n._0;
      const name = n._0;
      if ((r = this.print((f) => fmt_Ident(name, f))).$ === "Err") return r;
      if ((r = this.print(" = ")).$ === "Err") return r;
      if (this.eat(0x4b /* 'K' */)) {
        r = this.print_const(false);
      } else {
        r = this.print_type();
      }
      if (r.$ === "Err") return r;
    }

    if (open) {
      if ((r = this.print(">")).$ === "Err") return r;
    }

    return FMT_OK;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:1099 print_pat
  print_pat(): FmtResult {
    let r: FmtResult;
    const t = this.parse((p) => p.next_());
    if (t.$ === "Ret") return t._0;
    const tag = t._0;

    switch (String.fromCharCode(tag)) {
      case "R": {
        if ((r = this.print_const(false)).$ === "Err") return r;
        if ((r = this.print("..=")).$ === "Err") return r;
        if ((r = this.print_const(false)).$ === "Err") return r;
        break;
      }
      case "O": {
        const pd = this.parse((p) => p.push_depth());
        if (pd.$ === "Ret") return pd._0;
        if ((r = this.print_pat()).$ === "Err") return r;
        while (!this.eat(0x45 /* 'E' */)) {
          // May have reached the end of the string,
          // avoid going into an endless loop.
          if (this.parser.$ === "Err") {
            return this.invalid();
          }
          if ((r = this.print(" | ")).$ === "Err") return r;
          if ((r = this.print_pat()).$ === "Err") return r;
        }
        this.pop_depth();
        break;
      }
      case "N":
        if ((r = this.print("!null")).$ === "Err") return r;
        break;
      default:
        return this.invalid();
    }

    return FMT_OK;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:1129 print_const
  print_const(in_value: boolean): FmtResult {
    let r: FmtResult;
    const t = this.parse((p) => p.next_());
    if (t.$ === "Ret") return t._0;
    const tag = t._0;

    const pd = this.parse((p) => p.push_depth());
    if (pd.$ === "Ret") return pd._0;

    // Only literals (and the names of `const` generic parameters, but they
    // don't get mangled at all), can appear in generic argument position
    // without any disambiguation, all other expressions require braces.
    // To avoid duplicating the mapping between `tag` and what syntax gets
    // used (especially any special-casing), every case that needs braces
    // has to call `open_brace(self)?` (and the closing brace is automatic).
    let opened_brace = false;
    const open_brace_if_outside_expr = (this_: Printer): FmtResult => {
      // If this expression is nested in another, braces aren't required.
      if (in_value) {
        return FMT_OK;
      }

      opened_brace = true;
      return this_.print("{");
    };

    switch (String.fromCharCode(tag)) {
      case "p":
        if ((r = this.print("_")).$ === "Err") return r;
        break;

      // Primitive leaves with hex-encoded values (see `basic_type`).
      case "h":
      case "t":
      case "m":
      case "y":
      case "o":
      case "j":
        if ((r = this.print_const_uint(tag)).$ === "Err") return r;
        break;
      case "a":
      case "s":
      case "l":
      case "x":
      case "n":
      case "i": {
        if (this.eat(0x6e /* 'n' */)) {
          if ((r = this.print("-")).$ === "Err") return r;
        }

        if ((r = this.print_const_uint(tag)).$ === "Err") return r;
        break;
      }
      case "b": {
        const h = this.parse((p) => p.hex_nibbles());
        if (h.$ === "Ret") return h._0;
        const v = h._0.try_parse_uint();
        if (v === 0n) {
          if ((r = this.print("false")).$ === "Err") return r;
        } else if (v === 1n) {
          if ((r = this.print("true")).$ === "Err") return r;
        } else {
          return this.invalid();
        }
        break;
      }
      case "c": {
        const h = this.parse((p) => p.hex_nibbles());
        if (h.$ === "Ret") return h._0;
        const v = h._0.try_parse_uint();
        const valid_char = v !== undefined && v <= 0xffff_ffffn ? from_u32(Number(v)) : undefined;
        if (valid_char !== undefined) {
          if ((r = this.print_quoted_escaped_chars(0x27 /* '\'' */, [valid_char])).$ === "Err") return r;
        } else {
          return this.invalid();
        }
        break;
      }
      case "e": {
        // NOTE(eddyb) a string literal `"..."` has type `&str`, so
        // to get back the type `str`, `*"..."` syntax is needed
        // (even if that may not be valid in Rust itself).
        if ((r = open_brace_if_outside_expr(this)).$ === "Err") return r;
        if ((r = this.print("*")).$ === "Err") return r;

        if ((r = this.print_const_str_literal()).$ === "Err") return r;
        break;
      }

      case "R":
      case "Q": {
        // NOTE(eddyb) this prints `"..."` instead of `&*"..."`, which
        // is what `Re..._` would imply (see comment for `str` above).
        if (tag === 0x52 /* 'R' */ && this.eat(0x65 /* 'e' */)) {
          if ((r = this.print_const_str_literal()).$ === "Err") return r;
        } else {
          if ((r = open_brace_if_outside_expr(this)).$ === "Err") return r;
          if ((r = this.print("&")).$ === "Err") return r;
          if (tag !== 0x52 /* 'R' */) {
            if ((r = this.print("mut ")).$ === "Err") return r;
          }
          if ((r = this.print_const(true)).$ === "Err") return r;
        }
        break;
      }
      case "A": {
        if ((r = open_brace_if_outside_expr(this)).$ === "Err") return r;
        if ((r = this.print("[")).$ === "Err") return r;
        const l = this.print_sep_list((this_) => this_.print_const(true), ", ");
        if (l.$ === "Err") return l;
        if ((r = this.print("]")).$ === "Err") return r;
        break;
      }
      case "T": {
        if ((r = open_brace_if_outside_expr(this)).$ === "Err") return r;
        if ((r = this.print("(")).$ === "Err") return r;
        const c = this.print_sep_list((this_) => this_.print_const(true), ", ");
        if (c.$ === "Err") return c;
        const count = c._0;
        if (count === 1) {
          if ((r = this.print(",")).$ === "Err") return r;
        }
        if ((r = this.print(")")).$ === "Err") return r;
        break;
      }
      case "V": {
        if ((r = open_brace_if_outside_expr(this)).$ === "Err") return r;
        if ((r = this.print_path(true)).$ === "Err") return r;
        const n = this.parse((p) => p.next_());
        if (n.$ === "Ret") return n._0;
        switch (String.fromCharCode(n._0)) {
          case "U":
            break;
          case "T": {
            if ((r = this.print("(")).$ === "Err") return r;
            const l = this.print_sep_list((this_) => this_.print_const(true), ", ");
            if (l.$ === "Err") return l;
            if ((r = this.print(")")).$ === "Err") return r;
            break;
          }
          case "S": {
            if ((r = this.print(" { ")).$ === "Err") return r;
            const l = this.print_sep_list((this_) => {
              let r: FmtResult;
              const d = this_.parse((p) => p.disambiguator());
              if (d.$ === "Ret") return d._0;
              const n = this_.parse((p) => p.ident());
              if (n.$ === "Ret") return n._0;
              const name = n._0;
              if ((r = this_.print((f) => fmt_Ident(name, f))).$ === "Err") return r;
              if ((r = this_.print(": ")).$ === "Err") return r;
              return this_.print_const(true);
            }, ", ");
            if (l.$ === "Err") return l;
            if ((r = this.print(" }")).$ === "Err") return r;
            break;
          }
          default:
            return this.invalid();
        }
        break;
      }
      case "B": {
        if ((r = this.print_backref((this_) => this_.print_const(in_value))).$ === "Err") return r;
        break;
      }
      default:
        return this.invalid();
    }

    if (opened_brace) {
      if ((r = this.print("}")).$ === "Err") return r;
    }

    this.pop_depth();
    return FMT_OK;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:1258 print_const_uint
  print_const_uint(ty_tag: number): FmtResult {
    let r: FmtResult;
    const h = this.parse((p) => p.hex_nibbles());
    if (h.$ === "Ret") return h._0;
    const hex = h._0;

    const v = hex.try_parse_uint();
    if (v !== undefined) {
      if ((r = this.print(String(v))).$ === "Err") return r;
    } else {
      // Print anything that doesn't fit in `u64` verbatim.
      if ((r = this.print("0x")).$ === "Err") return r;
      if ((r = this.print(hex.nibbles)).$ === "Err") return r;
    }

    const out = this.out;
    if (out !== undefined) {
      if (!out.alternate()) {
        const ty = basic_type(ty_tag)!;
        if ((r = this.print(ty)).$ === "Err") return r;
      }
    }

    return FMT_OK;
  }

  // crate: rustc-demangle-0.1.28/src/v0.rs:1281 print_const_str_literal
  print_const_str_literal(): FmtResult {
    const h = this.parse((p) => p.hex_nibbles());
    if (h.$ === "Ret") return h._0;
    const chars = h._0.try_parse_str_chars();
    if (chars !== undefined) {
      return this.print_quoted_escaped_chars(0x22 /* '"' */, chars);
    } else {
      return this.invalid();
    }
  }
}
