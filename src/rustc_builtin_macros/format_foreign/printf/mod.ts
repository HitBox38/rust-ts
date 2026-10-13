// Port of compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs
//
// PORT: the input is a `Str` (byte offsets). The `&'a str` slices stored in a `Format` (`span`,
// `flags`, `length`, `type_`) are converted to `string` where they are produced (the
// rustc_parse_format convention); the tail returned by `parse_next_substitution` stays a `Str`.
import { InnerSpan, debug_InnerSpan } from "../../../rustc_span/lib.ts";
import { is_ascii_digit } from "../../../std/char.ts";
import { type Debug, debug_int, debug_option, debug_str, debug_struct, debug_tuple } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import { StrCursor as Cur } from "../../format_foreign.ts";

/// Represents a single `printf`-style substitution.
export type Substitution =
  /// A formatted output substitution with its internal byte offset.
  | { readonly $: "Format"; _0: Format }
  /// A literal `%%` escape, with its start and end indices.
  | { readonly $: "Escape"; _0: [number, number] };

/** `#[derive(Debug)]` */
export const debug_Substitution: Debug<Substitution> = (v, f) => {
  switch (v.$) {
    case "Format":
      return debug_tuple(f, "Format", [debug_Format(v._0, f)]);
    case "Escape":
      return debug_tuple(f, "Escape", [debug_tuple(f, "", [debug_int(v._0[0], f), debug_int(v._0[1], f)])]);
  }
};

export const Substitution = {
  /** `impl ToString for Substitution<'_>` */
  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:15 to_string
  to_string(self: Substitution): string {
    switch (self.$) {
      case "Format":
        return self._0.span;
      case "Escape":
        return "%%";
    }
  },

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:24 position
  position(self: Substitution): InnerSpan {
    switch (self.$) {
      case "Format":
        return self._0.position;
      case "Escape": {
        const [start, end] = self._0;
        return InnerSpan.new(start, end);
      }
    }
  },

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:31 set_position
  set_position(self: Substitution, start: number, end: number): void {
    switch (self.$) {
      case "Format":
        self._0.position = InnerSpan.new(start, end);
        return;
      case "Escape":
        self._0 = [start, end];
        return;
    }
  },

  /// Translate this substitution into an equivalent Rust formatting directive.
  ///
  /// This ignores cases where the substitution does not have an exact equivalent, or where
  /// the substitution would be unnecessary.
  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:42 translate
  translate(self: Substitution): Result<string, string | undefined> {
    switch (self.$) {
      case "Format":
        return self._0.translate();
      case "Escape":
        return Err(undefined);
    }
  },
};

/// A single `printf`-style formatting directive.
export class Format {
  constructor(
    /// The entire original formatting directive.
    public span: string,
    /// The (1-based) parameter to be converted.
    public parameter: number | undefined,
    /// Formatting flags.
    public flags: string,
    /// Minimum width of the output.
    public width: Num | undefined,
    /// Precision of the conversion.
    public precision: Num | undefined,
    /// Length modifier for the conversion.
    public length: string | undefined,
    /// Type of parameter being converted.
    public type_: string,
    /// Byte offset for the start and end of this formatting directive.
    public position: InnerSpan,
  ) {}

  /// Translate this directive into an equivalent Rust formatting directive.
  ///
  /// Returns `Err` in cases where the `printf` directive does not have an exact Rust
  /// equivalent, rather than guessing.
  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:76 translate
  translate(): Result<string, string | undefined> {
    let c_alt = false;
    let c_zero = false;
    let c_left = false;
    let c_plus = false;
    for (const c of this.flags) {
      switch (c) {
        case "#":
          c_alt = true;
          break;
        case "0":
          c_zero = true;
          break;
        case "-":
          c_left = true;
          break;
        case "+":
          c_plus = true;
          break;
        default: {
          return Err(`the flag \`${c}\` is unknown or unsupported`);
        }
      }
    }

    // Has a special form in Rust for numbers.
    let fill: string | undefined = c_zero ? "0" : undefined;

    let align: string | undefined = c_left ? "<" : undefined;

    // Rust doesn't have an equivalent to the `' '` flag.
    const sign: string | undefined = c_plus ? "+" : undefined;

    // Not *quite* the same, depending on the type...
    let alt = c_alt;

    let width: Num | undefined;
    const w = this.width;
    if (w !== undefined && w.$ === "Next") {
      // NOTE: Rust doesn't support this.
      return Err("you have to use a positional or named parameter for the width");
    } else if (w !== undefined && w.$ === "Arg") {
      width = w;
    } else if (w !== undefined && w.$ === "Num") {
      width = w;
    } else {
      width = undefined;
    }

    let precision = this.precision;

    // NOTE: although length *can* have an effect, we can't duplicate the effect in Rust, so
    // we just ignore it.

    let type_: string | undefined, use_zero_fill: boolean, is_int: boolean;
    switch (this.type_) {
      case "d":
      case "i":
      case "u":
        [type_, use_zero_fill, is_int] = [undefined, true, true];
        break;
      case "f":
      case "F":
        [type_, use_zero_fill, is_int] = [undefined, false, false];
        break;
      case "s":
      case "c":
        [type_, use_zero_fill, is_int] = [undefined, false, false];
        break;
      case "e":
      case "E":
        [type_, use_zero_fill, is_int] = [this.type_, true, false];
        break;
      case "x":
      case "X":
      case "o":
        [type_, use_zero_fill, is_int] = [this.type_, true, true];
        break;
      case "p":
        [type_, use_zero_fill, is_int] = [this.type_, false, true];
        break;
      case "g":
        [type_, use_zero_fill, is_int] = ["e", true, false];
        break;
      case "G":
        [type_, use_zero_fill, is_int] = ["E", true, false];
        break;
      default: {
        return Err(`the conversion specifier \`${this.type_}\` is unknown or unsupported`);
      }
    }

    if (is_int && width !== undefined && precision !== undefined) {
      // Rust can't duplicate this insanity.
      return Err("width and precision cannot both be specified for integer conversions");
    } else if (is_int && width === undefined && precision !== undefined) {
      const p = precision;
      [fill, width, precision] = ["0", p, undefined];
    } else if (is_int && precision === undefined) {
      [fill, width, precision] = [fill, width, undefined];
    } else {
      [fill, width, precision] = [fill, width, precision];
    }

    if (this.type_ === "s" && width !== undefined && align === undefined) {
      align = ">";
    }

    let zero_fill: boolean;
    if (fill === "0" && use_zero_fill) {
      [fill, zero_fill] = [undefined, true];
    } else {
      [fill, zero_fill] = [fill, false];
    }

    alt = type_ === "x" || type_ === "X" ? alt : false;

    const has_options =
      fill !== undefined ||
      align !== undefined ||
      sign !== undefined ||
      alt ||
      zero_fill ||
      width !== undefined ||
      precision !== undefined ||
      type_ !== undefined;

    // Initialise with a rough guess.
    // PORT: `String::with_capacity(cap)` has no observable effect; the capacity is not computed.
    const s: MutRef<string> = { value: "" };

    s.value += "{";

    if (this.parameter !== undefined) {
      const arg = this.parameter;
      // `arg.checked_sub(1).ok_or(None)?`
      if (arg === 0) return Err(undefined);
      s.value += String(arg - 1);
    }

    if (has_options) {
      s.value += ":";

      let align_: string | undefined;
      if (fill !== undefined) {
        s.value += fill;
        align_ = align ?? ">";
      } else {
        align_ = align;
      }

      if (align_ !== undefined) {
        s.value += align_;
      }

      if (sign !== undefined) {
        s.value += sign;
      }

      if (alt) {
        s.value += "#";
      }

      if (zero_fill) {
        s.value += "0";
      }

      if (width !== undefined) {
        if (Num.translate(width, s).$ === "Err") return Err(undefined);
      }

      if (precision !== undefined) {
        s.value += ".";
        if (Num.translate(precision, s).$ === "Err") return Err(undefined);
      }

      if (type_ !== undefined) {
        s.value += type_;
      }
    }

    s.value += "}";
    return Ok(s.value);
  }
}

/** `#[derive(Debug)]` */
export const debug_Format: Debug<Format> = (v, f) =>
  debug_struct(f, "Format", [
    ["span", debug_str(v.span)],
    ["parameter", debug_option(v.parameter, f, debug_int)],
    ["flags", debug_str(v.flags)],
    ["width", debug_option(v.width, f, debug_Num)],
    ["precision", debug_option(v.precision, f, debug_Num)],
    ["length", debug_option(v.length, f, (x) => debug_str(x))],
    ["type_", debug_str(v.type_)],
    ["position", debug_InnerSpan(v.position, f)],
  ]);

/// A general number used in a `printf` formatting directive.
export type Num =
  // The range of these values is technically bounded by `NL_ARGMAX`... but, at least for GNU
  // libc, it apparently has no real fixed limit. A `u16` is used here on the basis that it
  // is *vanishingly* unlikely that *anyone* is going to try formatting something wider, or
  // with more precision, than 32 thousand positions which is so wide it couldn't possibly fit
  // on a screen.
  /// A specific, fixed value.
  | { readonly $: "Num"; _0: number }
  /// The value is derived from a positional argument.
  | { readonly $: "Arg"; _0: number }
  /// The value is derived from the "next" unconverted argument.
  | { readonly $: "Next" };

/** `#[derive(Debug)]` */
export const debug_Num: Debug<Num> = (v, f) => {
  switch (v.$) {
    case "Num":
      return debug_tuple(f, "Num", [debug_int(v._0, f)]);
    case "Arg":
      return debug_tuple(f, "Arg", [debug_int(v._0, f)]);
    case "Next":
      return "Next";
  }
};

/// PORT: `<u16 as FromStr>::from_str(s).ok()` (radix 10: an optional leading `+`, then digits; overflow
/// and empty input are errors).
function parse_u16(s: string): number | undefined {
  let digits = s;
  if (digits.length === 0) return undefined;
  if (digits[0] === "+" || digits[0] === "-") {
    if (digits.length === 1) return undefined;
    if (digits[0] === "+") digits = digits.slice(1);
  }
  let n = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(i) - 0x30;
    if (d < 0 || d > 9) return undefined;
    n = n * 10 + d;
    if (n > 0xffff) return undefined;
  }
  return n;
}

export const Num = {
  Next: Object.freeze({ $: "Next" as const }),

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:252 from_str
  from_str(s: string, arg: string | undefined): Num | undefined {
    if (arg !== undefined) {
      const n = parse_u16(arg);
      return n === undefined ? undefined : { $: "Arg", _0: n };
    } else if (s === "*") {
      return Num.Next;
    } else {
      const n = parse_u16(s);
      return n === undefined ? undefined : { $: "Num", _0: n };
    }
  },

  /// PORT: `-> std::fmt::Result` is `Result<undefined, undefined>` (`fmt::Error` is a unit struct).
  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:262 translate
  translate(self: Num, s: MutRef<string>): Result<undefined, undefined> {
    switch (self.$) {
      case "Num": {
        const n = self._0;
        s.value += String(n);
        return Ok(undefined);
      }
      case "Arg": {
        // `n.checked_sub(1).ok_or(std::fmt::Error)?`
        if (self._0 === 0) return Err(undefined);
        const n = self._0 - 1;
        s.value += `${n}$`;
        return Ok(undefined);
      }
      case "Next":
        s.value += "*";
        return Ok(undefined);
    }
  },
};

/// Returns an iterator over all substitutions in a given string.
// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:276 iter_subs
export function iter_subs(s: Str, start_pos: number): Substitutions {
  return new Substitutions(s, start_pos);
}

/// Iterator over substitutions in a string.
export class Substitutions {
  constructor(
    public s: Str,
    public pos: number,
  ) {}

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:288 next
  next(): Substitution | undefined {
    const r = parse_next_substitution(this.s);
    if (r === undefined) return undefined;
    const [sub, tail] = r;
    this.s = tail;
    const { start, end } = Substitution.position(sub);
    Substitution.set_position(sub, start + this.pos, end + this.pos);
    this.pos += end;
    return sub;
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:297 size_hint
  size_hint(): [number, number | undefined] {
    // Substitutions are at least 2 characters long.
    return [0, Math.floor(this.s.len() / 2)];
  }

  *[globalThis.Symbol.iterator](): Generator<Substitution> {
    for (let s = this.next(); s !== undefined; s = this.next()) yield s;
  }
}

type State = "Start" | "Flags" | "Width" | "WidthArg" | "Prec" | "PrecInner" | "Length" | "Type";

/// Parse the next substitution from the input string.
// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:315 parse_next_substitution
export function parse_next_substitution(s: Str): [Substitution, Str] | undefined {
  let at_: Cur;
  {
    const start = s.find("%");
    if (start === undefined) return undefined;
    const c0 = s.slice(start + 1).chars().next();
    if (c0 === undefined) return undefined;
    if (c0 === 0x25 /* '%' */) {
      return [{ $: "Escape", _0: [start, start + 2] }, s.slice(start + 2)];
    }

    at_ = Cur.new_at(s, start);
  }

  // This is meant to be a translation of the following regex:
  //
  // ```regex
  // (?x)
  // ^ %
  // (?: (?Box<parameter> \d+) \$ )?
  // (?Box<flags> [-+ 0\#']* )
  // (?Box<width> \d+ | \* (?: (?Box<widtha> \d+) \$ )? )?
  // (?: \. (?Box<precision> \d+ | \* (?: (?Box<precisiona> \d+) \$ )? ) )?
  // (?Box<length>
  //     # Standard
  //     hh | h | ll | l | L | z | j | t
  //
  //     # Other
  //     | I32 | I64 | I | q
  // )?
  // (?Box<type> . )
  // ```

  // Used to establish the full span at the end.
  const start = at_;
  // The current position within the string.
  const at0 = at_.at_next_cp();
  if (at0 === undefined) return undefined;
  let at = at0;
  // `c` is the next codepoint, `next` is a cursor after it.
  const cn = at.next_cp();
  if (cn === undefined) return undefined;
  let [c, next] = cn;

  // Update `at`, `c`, and `next`, exiting if we're out of input.
  // PORT: `macro_rules! move_to` is a closure returning `false` where the macro's `?` returns `None`.
  const move_to = (cur: Cur): boolean => {
    at = cur;
    const r = at.next_cp();
    if (r === undefined) return false;
    const [c_, next_] = r;
    c = c_;
    next = next_;
    return true;
  };

  // Constructs a result when parsing fails.
  //
  // Note: `move` used to capture copies of the cursors as they are *now*.
  const [fb_start, fb_at, fb_next] = [start.clone(), at.clone(), next.clone()];
  const fallback = (): [Substitution, Str] | undefined => {
    return [
      {
        $: "Format",
        _0: new Format(
          fb_start.slice_between(fb_next)!.toString(),
          undefined,
          "",
          undefined,
          undefined,
          undefined,
          fb_at.slice_between(fb_next)!.toString(),
          InnerSpan.new(fb_start.at, fb_next.at),
        ),
      },
      fb_next.slice_after(),
    ];
  };

  // Next parsing state.
  let state: State = "Start";

  // Sadly, Rust isn't *quite* smart enough to know these *must* be initialised by the end.
  let parameter: number | undefined = undefined;
  let flags: string = "";
  let width: Num | undefined = undefined;
  let precision: Num | undefined = undefined;
  let length: string | undefined = undefined;
  let type_: string = "";
  let end: Cur;

  if (state === "Start") {
    if (c >= 0x31 /* '1' */ && c <= 0x39 /* '9' */) {
      const end = at_next_cp_while(next, is_ascii_digit);
      const r = end.next_cp();
      // Yes, this *is* the parameter.
      if (r !== undefined && r[0] === 0x24 /* '$' */) {
        const end2 = r[1];
        state = "Flags";
        parameter = parse_u16(at.slice_between(end)!.toString());
        if (!move_to(end2)) return undefined;
      }
      // Wait, no, actually, it's the width.
      else if (r !== undefined) {
        state = "Prec";
        parameter = undefined;
        flags = "";
        const num = at.slice_between(end);
        width = num === undefined ? undefined : Num.from_str(num.toString(), undefined);
        if (width === undefined) {
          return fallback();
        }
        if (!move_to(end)) return undefined;
      }
      // It's invalid, is what it is.
      else {
        return fallback();
      }
    } else {
      state = "Flags";
      parameter = undefined;
      if (!move_to(at)) return undefined;
    }
  }

  if (state === "Flags") {
    const end = at_next_cp_while(at, is_flag);
    state = "Width";
    flags = at.slice_between(end)!.toString();
    if (!move_to(end)) return undefined;
  }

  if (state === "Width") {
    if (c === 0x2a /* '*' */) {
      state = "WidthArg";
      if (!move_to(next)) return undefined;
    } else if (c >= 0x31 /* '1' */ && c <= 0x39 /* '9' */) {
      const end = at_next_cp_while(next, is_ascii_digit);
      state = "Prec";
      const num = at.slice_between(end);
      width = num === undefined ? undefined : Num.from_str(num.toString(), undefined);
      if (width === undefined) {
        return fallback();
      }
      if (!move_to(end)) return undefined;
    } else {
      state = "Prec";
      width = undefined;
      if (!move_to(at)) return undefined;
    }
  }

  if (state === "WidthArg") {
    const end = at_next_cp_while(at, is_ascii_digit);
    const r = end.next_cp();
    if (r !== undefined && r[0] === 0x24 /* '$' */) {
      const end2 = r[1];
      state = "Prec";
      width = Num.from_str("", at.slice_between(end)?.toString());
      if (!move_to(end2)) return undefined;
    } else {
      state = "Prec";
      width = Num.Next;
      if (!move_to(end)) return undefined;
    }
  }

  if (state === "Prec") {
    if (c === 0x2e /* '.' */) {
      state = "PrecInner";
      if (!move_to(next)) return undefined;
    } else {
      state = "Length";
      precision = undefined;
      if (!move_to(at)) return undefined;
    }
  }

  if (state === "PrecInner") {
    if (c === 0x2a /* '*' */) {
      const end = at_next_cp_while(next, is_ascii_digit);
      const r = end.next_cp();
      if (r !== undefined && r[0] === 0x24 /* '$' */) {
        const end2 = r[1];
        state = "Length";
        precision = Num.from_str("*", next.slice_between(end)?.toString());
        if (!move_to(end2)) return undefined;
      } else {
        state = "Length";
        precision = Num.Next;
        if (!move_to(end)) return undefined;
      }
    } else if (c >= 0x30 /* '0' */ && c <= 0x39 /* '9' */) {
      const end = at_next_cp_while(next, is_ascii_digit);
      state = "Length";
      const num = at.slice_between(end);
      precision = num === undefined ? undefined : Num.from_str(num.toString(), undefined);
      if (!move_to(end)) return undefined;
    } else {
      return fallback();
    }
  }

  if (state === "Length") {
    const c1_next1 = next.next_cp();
    if ((c === 0x68 /* 'h' */ && c1_next1 !== undefined && c1_next1[0] === 0x68) || (c === 0x6c /* 'l' */ && c1_next1 !== undefined && c1_next1[0] === 0x6c)) {
      const next1 = c1_next1![1];
      state = "Type";
      length = at.slice_between(next1)!.toString();
      if (!move_to(next1)) return undefined;
    } else if (
      c === 0x68 /* 'h' */ ||
      c === 0x6c /* 'l' */ ||
      c === 0x4c /* 'L' */ ||
      c === 0x7a /* 'z' */ ||
      c === 0x6a /* 'j' */ ||
      c === 0x74 /* 't' */ ||
      c === 0x71 /* 'q' */
    ) {
      state = "Type";
      length = at.slice_between(next)!.toString();
      if (!move_to(next)) return undefined;
    } else if (c === 0x49 /* 'I' */) {
      const e1 = next.at_next_cp();
      const e2 = e1 === undefined ? undefined : e1.at_next_cp();
      const end_: [string, Cur] | undefined = e2 === undefined ? undefined : [next.slice_between(e2)!.toString(), e2];
      let end: Cur;
      if (end_ !== undefined && (end_[0] === "32" || end_[0] === "64")) {
        end = end_[1];
      } else {
        end = next;
      }
      state = "Type";
      length = at.slice_between(end)!.toString();
      if (!move_to(end)) return undefined;
    } else {
      state = "Type";
      length = undefined;
      if (!move_to(at)) return undefined;
    }
  }

  if (state === "Type") {
    type_ = at.slice_between(next)!.toString();

    // Don't use `move_to!` here, as we *can* be at the end of the input.
    at = next;
  }

  void c; // to avoid never used value

  end = at;
  const position = InnerSpan.new(start.at, end.at);

  const f = new Format(start.slice_between(end)!.toString(), parameter, flags, width, precision, length, type_, position);
  return [{ $: "Format", _0: f }, end.slice_after()];
}

// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:577 at_next_cp_while
function at_next_cp_while(cur: Cur, pred: (c: number) => boolean): Cur {
  for (;;) {
    const r = cur.next_cp();
    if (r !== undefined && pred(r[0])) {
      cur = r[1];
    } else {
      return cur;
    }
  }
}

// rustc: compiler/rustc_builtin_macros/src/format_foreign/printf/mod.rs:591 is_flag
function is_flag(c: number): boolean {
  return c === 0x30 /* '0' */ || c === 0x2d /* '-' */ || c === 0x2b /* '+' */ || c === 0x20 /* ' ' */ || c === 0x23 /* '#' */ || c === 0x27 /* '\'' */;
}
