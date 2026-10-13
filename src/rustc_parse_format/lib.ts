// Port of compiler/rustc_parse_format/src/lib.rs
//! Macro support for format strings
//!
//! These structures are used when parsing format strings for the compiler.
//! Parsing does not happen at runtime: structures of `std::fmt::rt` are
//! generated instead.
//
// Types and derived Debug/Clone are generated into lib.gen.ts (tools/codegen/types.ts, set
// `rustc_parse_format`); `Parser` is hand-written here (`hand` in the set).
//
// PORT: the input (and the snippet) are byte-offset-indexed source text, so they are `Str`
// (PORTING §5). The `&'input str` slices the parser hands out (`Piece::Lit`, `ArgumentNamed`,
// `CountIsName`, `FormatSpec::ty`) are converted to `string` where they are produced; byte offsets
// (`Range<usize>`, `usize` positions) are unchanged.
// PORT: `Range<usize>` is `{ start, end }` (the codegen mapping); upstream never mutates a range
// after it is built, so `.clone()` of a range is the same object.
import { is_id_continue, is_id_start } from "../rustc_lexer/lib.ts";
import { is_whitespace, len_utf8, to_digit } from "../std/char.ts";
import { escape_char } from "../std/fmt.ts";
import { decode_at, Str, utf8_width } from "../std/str.ts";
import { unescape_str } from "../vendor/rustc_literal_escaper/lib.ts";
import * as gen from "./lib.gen.ts";
import { Argument, type Count, type FormatSpec, type ParseError, type ParseMode, type Piece } from "./lib.gen.ts";

export * from "./lib.gen.ts";

// pub use Alignment::*; pub use Count::*; pub use Position::*;
// PORT: glob re-exports of enum variants are not mirrored; use `Alignment.AlignLeft`,
// `{ $: "CountIs", _0 }`, ... (the variants are values of the companions / object literals).

type Range = { start: number; end: number };

function range(start: number, end: number): Range {
  return { start, end };
}

function range_eq(a: Range | undefined, b: Range | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.start === b.start && a.end === b.end;
}

// ---- derive(PartialEq) / derive(Default) (used by upstream code below) ----

/** `#[derive(PartialEq)]` for `Count`. */
export function Count_eq(a: Count, b: Count): boolean {
  if (a.$ !== b.$) return false;
  switch (a.$) {
    case "CountIs":
    case "CountIsParam":
    case "CountIsStar":
      return a._0 === (b as typeof a)._0;
    case "CountIsName":
      return a._0 === (b as typeof a)._0 && range_eq(a._1, (b as typeof a)._1);
    case "CountImplied":
      return true;
  }
}

/** `#[derive(PartialEq)]` for `Position`. */
export function Position_eq(a: Position, b: Position): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

/** `#[derive(PartialEq)]` for `FormatSpec`. */
export function FormatSpec_eq(a: FormatSpec, b: FormatSpec): boolean {
  return (
    a.fill === b.fill &&
    range_eq(a.fill_span, b.fill_span) &&
    a.align === b.align &&
    a.sign === b.sign &&
    a.alternate === b.alternate &&
    a.zero_pad === b.zero_pad &&
    a.debug_hex === b.debug_hex &&
    Count_eq(a.precision, b.precision) &&
    range_eq(a.precision_span, b.precision_span) &&
    Count_eq(a.width, b.width) &&
    range_eq(a.width_span, b.width_span) &&
    a.ty === b.ty &&
    range_eq(a.ty_span, b.ty_span)
  );
}

/** `#[derive(PartialEq)]` for `Argument`. */
export function Argument_eq(a: Argument, b: Argument): boolean {
  return Position_eq(a.position, b.position) && range_eq(a.position_span, b.position_span) && FormatSpec_eq(a.format, b.format);
}

/** `#[derive(PartialEq)]` for `Piece`. */
export function Piece_eq(a: Piece, b: Piece): boolean {
  if (a.$ === "Lit") return b.$ === "Lit" && a._0 === b._0;
  return b.$ === "NextArgument" && Argument_eq(a._0, b._0);
}

/** `FormatSpec::default()` (`#[derive(Default)]`: `Alignment::AlignUnknown` and `Count::CountImplied` are `#[default]`). */
export function FormatSpec_default(): FormatSpec {
  return {
    fill: undefined,
    fill_span: undefined,
    align: "AlignUnknown",
    sign: undefined,
    alternate: false,
    zero_pad: false,
    debug_hex: undefined,
    precision: gen.Count.CountImplied,
    precision_span: undefined,
    width: gen.Count.CountImplied,
    width_span: undefined,
    ty: "",
    ty_span: undefined,
  };
}

declare module "./lib.gen.ts" {
  interface Argument {
    is_identifier(): boolean;
  }
}

// rustc: compiler/rustc_parse_format/src/lib.rs:58 is_identifier
Argument.prototype.is_identifier = function (this: Argument): boolean {
  return this.position.$ === "ArgumentNamed" && FormatSpec_eq(this.format, FormatSpec_default());
};

export type Position = gen.Position;
export const Position = {
  // rustc: compiler/rustc_parse_format/src/lib.rs:108 index
  index(self: Position): number | undefined {
    switch (self.$) {
      case "ArgumentIs":
      case "ArgumentImplicitlyIs":
        return self._0;
      default:
        return undefined;
    }
  },
};

/// The parser structure for interpreting the input format string. This is
/// modeled as an iterator over `Piece` structures to form a stream of tokens
/// being output.
///
/// This is a recursive-descent parser for the sake of simplicity, and if
/// necessary there's probably lots of room for improvement performance-wise.
export class Parser {
  constructor(
    public mode: ParseMode,
    /// Input to be parsed
    public input: Str,
    /// Tuples of the span in the code snippet (input as written before being unescaped), the pos in input, and the char in input
    public input_vec: [Range, number, number][],
    /// Index into input_vec
    public input_vec_index: number,
    /// Error messages accumulated during parsing
    public errors: ParseError[],
    /// Current position of implicit positional argument pointer
    public curarg: number,
    /// Start and end byte offset of every successfully parsed argument
    public arg_places: Range[],
    /// Span of the last opening brace seen, used for error reporting
    public last_open_brace: Range | undefined,
    /// Whether this formatting string was written directly in the source. This controls whether we
    /// can use spans to refer into it and give better error messages.
    /// N.B: This does _not_ control whether implicit argument captures can be used.
    public is_source_literal: boolean,
    /// Index to the end of the literal snippet
    public end_of_snippet: number,
    /// Start position of the current line.
    public cur_line_start: number,
    /// Start and end byte offset of every line of the format string. Excludes
    /// newline characters and leading whitespace.
    public line_spans: Range[],
  ) {}

  // rustc: compiler/rustc_parse_format/src/lib.rs:233 next
  next(): Piece | undefined {
    const peeked = this.peek();
    if (peeked !== undefined) {
      const [{ start, end }, idx, ch] = peeked;
      switch (ch) {
        case 0x7b /* '{' */: {
          this.input_vec_index += 1;
          const p = this.peek();
          if (p !== undefined && p[2] === 0x7b /* '{' */) {
            const i = p[1];
            this.input_vec_index += 1;
            // double open brace escape: "{{"
            // next state after this is either end-of-input or seen-a-brace
            return { $: "Lit", _0: this.string(i) };
          } else {
            // single open brace
            this.last_open_brace = range(start, end);
            const arg = this.argument();
            this.ws();
            const close = this.consume_pos(0x7d /* '}' */);
            if (close !== undefined) {
              const [close_brace_range] = close;
              if (this.is_source_literal) {
                this.arg_places.push(range(start, close_brace_range.end));
              }
            } else {
              this.missing_closing_brace(arg);
            }

            return { $: "NextArgument", _0: arg };
          }
        }
        case 0x7d /* '}' */: {
          this.input_vec_index += 1;
          const p = this.peek();
          if (p !== undefined && p[2] === 0x7d /* '}' */) {
            const i = p[1];
            this.input_vec_index += 1;
            // double close brace escape: "}}"
            // next state after this is either end-of-input or start
            return { $: "Lit", _0: this.string(i) };
          } else {
            // error: single close brace without corresponding open brace
            this.errors.push({
              description: "unmatched `}` found",
              note: "if you intended to print `}`, you can escape it using `}}`",
              label: "unmatched `}`",
              span: range(start, end),
              secondary_label: undefined,
              suggestion: gen.Suggestion.None,
            });
            return undefined;
          }
        }
        default:
          return { $: "Lit", _0: this.string(idx) };
      }
    } else {
      // end of input
      if (this.is_source_literal) {
        const span = range(this.cur_line_start, this.end_of_snippet);
        const last = this.line_spans[this.line_spans.length - 1];
        if (!range_eq(last, span)) {
          this.line_spans.push(span);
        }
      }
      return undefined;
    }
  }

  /** `Iterator::collect::<Vec<_>>()` (also `by_ref().collect()`: the parser state is kept). */
  collect(): Piece[] {
    const out: Piece[] = [];
    for (let p = this.next(); p !== undefined; p = this.next()) out.push(p);
    return out;
  }

  /// Creates a new parser for the given unescaped input string and
  /// optional code snippet (the input as written before being unescaped),
  /// where `style` is `Some(nr_hashes)` when the snippet is a raw string with that many hashes.
  /// If the input comes via `println` or `panic`, then it has a newline already appended,
  /// which is reflected in the `appended_newline` parameter.
  // rustc: compiler/rustc_parse_format/src/lib.rs:302 new
  static new(input: Str, style: number | undefined, snippet: Str | undefined, appended_newline: boolean, mode: ParseMode): Parser {
    const quote_offset = style === undefined ? 1 : style + 2;

    let is_source_literal: boolean;
    let end_of_snippet: number;
    let pre_input_vec: [Range, number][];
    if (snippet !== undefined) {
      if (style !== undefined) {
        const nr_hashes = style;
        // snippet is a raw string

        // validate snippet because a proc macro may have
        // respanned it to something completely different (fixes #114865)
        const prefix_len = nr_hashes + 2; // r + hashes + opening "
        const suffix_len = nr_hashes + 1; // closing " + hashes
        const content_end = snippet.len() - suffix_len;
        if (
          snippet.len() >= prefix_len + suffix_len && // is sufficiently long
          snippet.byte(0) === 0x72 /* b'r' */ &&
          all_bytes(snippet, 1, 1 + nr_hashes, 0x23 /* b'#' */) &&
          snippet.byte(1 + nr_hashes) === 0x22 /* b'"' */ &&
          snippet.byte(content_end) === 0x22 /* b'"' */ &&
          all_bytes(snippet, content_end + 1, snippet.len(), 0x23 /* b'#' */)
        ) {
          const snippet_without_quotes = snippet.slice(prefix_len, content_end);
          const input_without_newline = appended_newline ? input.slice(0, input.len() - 1) : input;
          if (str_eq(snippet_without_quotes, input_without_newline)) {
            [is_source_literal, end_of_snippet, pre_input_vec] = [true, snippet.len() - suffix_len, []];
          } else {
            [is_source_literal, end_of_snippet, pre_input_vec] = [false, snippet.len(), []];
          }
        } else {
          [is_source_literal, end_of_snippet, pre_input_vec] = [false, snippet.len(), []];
        }
      } else {
        // snippet is not a raw string
        if (snippet.starts_with('"')) {
          // snippet looks like an ordinary string literal
          // check whether it is the escaped version of input
          const snippet_without_quotes = snippet.slice(1, snippet.len() - 1);
          let [ok, vec]: [boolean, [Range, number][]] = [true, []];
          const chars = input.chars();
          unescape_str(snippet_without_quotes, (r_start, r_end, res) => {
            let c: number | undefined;
            if (res.$ === "Ok" && ok && (c = chars.next()) !== undefined && res._0 === c) {
              vec.push([range(r_start, r_end), res._0]);
            } else {
              ok = false;
              vec = [];
            }
          });
          const last = vec[vec.length - 1];
          const end = last !== undefined ? last[0].end : 0;
          if (ok) {
            if (appended_newline) {
              if (chars.as_str().toString() === "\n") {
                vec.push([range(end, end + 1), 0x0a /* '\n' */]);
                [is_source_literal, end_of_snippet, pre_input_vec] = [true, 1 + end, vec];
              } else {
                [is_source_literal, end_of_snippet, pre_input_vec] = [false, snippet.len(), []];
              }
            } else if (chars.as_str().is_empty()) {
              [is_source_literal, end_of_snippet, pre_input_vec] = [true, 1 + end, vec];
            } else {
              [is_source_literal, end_of_snippet, pre_input_vec] = [false, snippet.len(), []];
            }
          } else {
            [is_source_literal, end_of_snippet, pre_input_vec] = [false, snippet.len(), []];
          }
        } else {
          // snippet is not a raw string and does not start with '"'
          [is_source_literal, end_of_snippet, pre_input_vec] = [false, snippet.len(), []];
        }
      }
    } else {
      // snippet is None
      [is_source_literal, end_of_snippet, pre_input_vec] = [false, input.len() - (appended_newline ? 1 : 0), []];
    }

    const input_vec: [Range, number, number][] = [];
    if (pre_input_vec.length === 0) {
      // Snippet is *not* input before unescaping, so spans pointing at it will be incorrect.
      // This can happen with proc macros that respan generated literals.
      for_each_char_index(input, (idx, c) => {
        const i = idx + quote_offset;
        input_vec.push([range(i, i + len_utf8(c)), idx, c]);
        return true;
      });
    } else {
      // Snippet is input before unescaping
      let k = 0;
      for_each_char_index(input, (i, c) => {
        if (k >= pre_input_vec.length) return false;
        const [r] = pre_input_vec[k++]!;
        input_vec.push([range(r.start + quote_offset, r.end + quote_offset), i, c]);
        return true;
      });
    }

    return new Parser(mode, input, input_vec, 0, [], 0, [], undefined, is_source_literal, end_of_snippet, quote_offset, []);
  }

  /// Peeks at the current position, without incrementing the pointer.
  // rustc: compiler/rustc_parse_format/src/lib.rs:421 peek
  peek(): [Range, number, number] | undefined {
    return this.input_vec[this.input_vec_index];
  }

  /// Peeks at the current position + 1, without incrementing the pointer.
  // rustc: compiler/rustc_parse_format/src/lib.rs:426 peek_ahead
  peek_ahead(): [Range, number, number] | undefined {
    return this.input_vec[this.input_vec_index + 1];
  }

  /// Optionally consumes the specified character. If the character is not at
  /// the current position, then the current iterator isn't moved and `false` is
  /// returned, otherwise the character is consumed and `true` is returned.
  // rustc: compiler/rustc_parse_format/src/lib.rs:433 consume
  consume(c: number): boolean {
    return this.consume_pos(c) !== undefined;
  }

  /// Optionally consumes the specified character. If the character is not at
  /// the current position, then the current iterator isn't moved and `None` is
  /// returned, otherwise the character is consumed and the current position is
  /// returned.
  // rustc: compiler/rustc_parse_format/src/lib.rs:441 consume_pos
  consume_pos(ch: number): [Range, number] | undefined {
    const p = this.peek();
    if (p !== undefined && ch === p[2]) {
      const [r, i] = p;
      this.input_vec_index += 1;
      return [r, i];
    }

    return undefined;
  }

  /// Called if a closing brace was not found.
  // rustc: compiler/rustc_parse_format/src/lib.rs:453 missing_closing_brace
  missing_closing_brace(arg: Argument): void {
    let range_: Range;
    let description: string;
    const p = this.peek();
    if (p !== undefined) {
      const [r, , c] = p;
      [range_, description] = [range(r.start, r.start), "expected `}`, found `" + escape_char(c, true, true) + "`"];
    } else {
      [range_, description] = [
        // point at closing `"`
        range(this.end_of_snippet, this.end_of_snippet),
        "expected `}` but string was terminated",
      ];
    }

    let note: string | undefined;
    let secondary_label: [string, Range] | undefined;
    if (arg.format.fill === 0x7d /* '}' */) {
      const sp = arg.format.fill_span;
      [note, secondary_label] = [
        "the character `}` is interpreted as a fill character because of the `:` that precedes it",
        sp === undefined ? undefined : ["this is not interpreted as a formatting closing brace", sp],
      ];
    } else {
      const sp = this.last_open_brace;
      [note, secondary_label] = [
        "if you intended to print `{`, you can escape it using `{{`",
        sp === undefined ? undefined : ["because of this opening brace", sp],
      ];
    }

    this.errors.push({
      description,
      note,
      label: "expected `}`",
      span: range(range_.start, range_.start),
      secondary_label,
      suggestion: gen.Suggestion.None,
    });

    const p1 = this.peek();
    const p2 = this.peek_ahead();
    if (p1 !== undefined && p2 !== undefined) {
      const c = p1[2];
      const nc = p2[2];
      if (c === 0x3f /* '?' */ && nc === 0x7d /* '}' */) this.missing_colon_before_debug_formatter();
      else if (c === 0x3f /* '?' */) this.suggest_format_debug();
      else if (c === 0x3c /* '<' */ || c === 0x5e /* '^' */ || c === 0x3e /* '>' */) this.suggest_format_align(c);
      else if (c === 0x2c /* ',' */) this.suggest_unsupported_python_numeric_grouping();
      else if (c === 0x3d /* '=' */ && nc === 0x7d /* '}' */) this.suggest_rust_debug_printing_macro();
      else if (c === 0x2b /* '+' */) this.suggest_format_missing_colon_for_sign();
      else this.suggest_positional_arg_instead_of_captured_arg(arg);
    }
  }

  /// Consumes all whitespace characters until the first non-whitespace character
  // rustc: compiler/rustc_parse_format/src/lib.rs:501 ws
  ws(): void {
    const rest_len = this.input_vec.length - this.input_vec_index;
    let step = rest_len;
    for (let k = 0; k < rest_len; k++) {
      if (!is_whitespace(this.input_vec[this.input_vec_index + k]![2])) {
        step = k;
        break;
      }
    }
    this.input_vec_index += step;
  }

  /// Parses all of a string which is to be considered a "raw literal" in a
  /// format string. This is everything outside of the braces.
  // rustc: compiler/rustc_parse_format/src/lib.rs:509 string
  string(start: number): string {
    let p: [Range, number, number] | undefined;
    while ((p = this.peek()) !== undefined) {
      const [r, i, c] = p;
      if (c === 0x7b /* '{' */ || c === 0x7d /* '}' */) {
        return this.input.slice(start, i).toString();
      } else if (c === 0x0a /* '\n' */ && this.is_source_literal) {
        this.input_vec_index += 1;
        this.line_spans.push(range(this.cur_line_start, r.start));
        this.cur_line_start = r.end;
      } else {
        this.input_vec_index += 1;
        if (this.is_source_literal && r.start === this.cur_line_start && is_whitespace(c)) {
          this.cur_line_start = r.end;
        }
      }
    }
    return this.input.slice(start).toString();
  }

  /// Parses an `Argument` structure, or what's contained within braces inside the format string.
  // rustc: compiler/rustc_parse_format/src/lib.rs:533 argument
  argument(): Argument {
    const start_idx = this.input_vec_index;

    const position_ = this.position();
    this.ws();

    const end_idx = this.input_vec_index;

    let format: FormatSpec;
    switch (this.mode) {
      case "Format":
        format = this.format();
        break;
      case "InlineAsm":
        format = this.inline_asm();
        break;
      case "Diagnostic":
        format = this.diagnostic();
        break;
    }

    // Resolve position after parsing format spec.
    let position: Position;
    if (position_ !== undefined) {
      position = position_;
    } else {
      const i = this.curarg;
      this.curarg += 1;
      position = { $: "ArgumentImplicitlyIs", _0: i };
    }

    const position_span = range(this.input_vec_index2range(start_idx).start, this.input_vec_index2range(end_idx).start);
    return new Argument(position, position_span, format);
  }

  /// Parses a positional argument for a format. This could either be an
  /// integer index of an argument, a named argument, or a blank string.
  /// Returns `Some(parsed_position)` if the position is not implicitly
  /// consuming a macro argument, `None` if it's the case.
  // rustc: compiler/rustc_parse_format/src/lib.rs:563 position
  position(): Position | undefined {
    const i = this.integer();
    if (i !== undefined) {
      return { $: "ArgumentIs", _0: i };
    } else {
      const p = this.peek();
      if (p !== undefined && is_id_start(p[2])) {
        const start = p[0].start;
        const word = this.word();

        // Recover from `r#ident` in format strings.
        let hash: [Range, number, number] | undefined;
        let ahead: [Range, number, number] | undefined;
        if (
          word === "r" &&
          (hash = this.peek()) !== undefined &&
          hash[2] === 0x23 /* '#' */ &&
          (ahead = this.peek_ahead()) !== undefined &&
          is_id_start(ahead[2])
        ) {
          const r = hash[0];
          this.input_vec_index += 1;
          const prefix_end = r.end;
          const word = this.word();
          const prefix_span = range(start, prefix_end);
          const full_span = range(start, this.input_vec_index2range(this.input_vec_index).start);
          this.errors.unshift({
            description: "raw identifiers are not supported",
            note: "identifiers in format strings can be keywords and don't need to be prefixed with `r#`",
            label: "raw identifier used here",
            span: full_span,
            secondary_label: undefined,
            suggestion: { $: "RemoveRawIdent", _0: prefix_span },
          });
          return { $: "ArgumentNamed", _0: word };
        }

        return { $: "ArgumentNamed", _0: word };
      }
      // This is an `ArgumentNext`.
      // Record the fact and do the resolution after parsing the
      // format spec, to make things like `{:.*}` work.
      return undefined;
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:604 input_vec_index2pos
  input_vec_index2pos(index: number): number {
    const e = this.input_vec[index];
    if (e !== undefined) {
      return e[1];
    } else {
      return this.input.len();
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:608 input_vec_index2range
  input_vec_index2range(index: number): Range {
    const e = this.input_vec[index];
    if (e !== undefined) {
      return e[0];
    } else {
      return range(this.end_of_snippet, this.end_of_snippet);
    }
  }

  /// Parses a format specifier at the current position, returning all of the
  /// relevant information in the `FormatSpec` struct.
  // rustc: compiler/rustc_parse_format/src/lib.rs:618 format
  format(): FormatSpec {
    const spec = FormatSpec_default();

    if (!this.consume(0x3a /* ':' */)) {
      return spec;
    }

    // fill character
    {
      const p = this.peek();
      const pa = this.peek_ahead();
      if (p !== undefined && pa !== undefined && (pa[2] === 0x3e /* '>' */ || pa[2] === 0x3c /* '<' */ || pa[2] === 0x5e /* '^' */)) {
        const [r, , c] = p;
        this.input_vec_index += 1;
        spec.fill = c;
        spec.fill_span = r;
      }
    }
    // Alignment
    if (this.consume(0x3c /* '<' */)) {
      spec.align = "AlignLeft";
    } else if (this.consume(0x3e /* '>' */)) {
      spec.align = "AlignRight";
    } else if (this.consume(0x5e /* '^' */)) {
      spec.align = "AlignCenter";
    }
    // Sign flags
    if (this.consume(0x2b /* '+' */)) {
      spec.sign = "Plus";
    } else if (this.consume(0x2d /* '-' */)) {
      spec.sign = "Minus";
    }
    // Alternate marker
    if (this.consume(0x23 /* '#' */)) {
      spec.alternate = true;
    }
    // Width and precision
    let havewidth = false;

    const zero = this.consume_pos(0x30 /* '0' */);
    if (zero !== undefined) {
      const [range_] = zero;
      // small ambiguity with '0$' as a format string. In theory this is a
      // '0' flag and then an ill-formatted format string with just a '$'
      // and no count, but this is better if we instead interpret this as
      // no '0' flag and '0$' as the width instead.
      const dollar = this.consume_pos(0x24 /* '$' */);
      if (dollar !== undefined) {
        const [r] = dollar;
        spec.width = { $: "CountIsParam", _0: 0 };
        spec.width_span = range(range_.start, r.end);
        havewidth = true;
      } else {
        spec.zero_pad = true;
      }
    }

    if (!havewidth) {
      const start_idx = this.input_vec_index;
      spec.width = this.count();
      if (spec.width.$ !== "CountImplied") {
        const end = this.input_vec_index2range(this.input_vec_index).start;
        spec.width_span = range(this.input_vec_index2range(start_idx).start, end);
      }
    }

    const dot = this.consume_pos(0x2e /* '.' */);
    if (dot !== undefined) {
      const [range_] = dot;
      if (this.consume(0x2a /* '*' */)) {
        // Resolve `CountIsNextParam`.
        // We can do this immediately as `position` is resolved later.
        const i = this.curarg;
        this.curarg += 1;
        spec.precision = { $: "CountIsStar", _0: i };
      } else {
        spec.precision = this.count();
      }
      spec.precision_span = range(range_.start, this.input_vec_index2range(this.input_vec_index).start);
    }

    const start_idx = this.input_vec_index;
    // Optional radix followed by the actual format specifier
    let q: [Range, number] | undefined;
    if (this.consume(0x78 /* 'x' */)) {
      if (this.consume(0x3f /* '?' */)) {
        spec.debug_hex = "Lower";
        spec.ty = "?";
      } else {
        spec.ty = "x";
      }
    } else if (this.consume(0x58 /* 'X' */)) {
      if (this.consume(0x3f /* '?' */)) {
        spec.debug_hex = "Upper";
        spec.ty = "?";
      } else {
        spec.ty = "X";
      }
    } else if ((q = this.consume_pos(0x3f /* '?' */)) !== undefined) {
      const [range_] = q;
      spec.ty = "?";
      const p = this.peek();
      if (p !== undefined && (p[2] === 0x23 /* '#' */ || p[2] === 0x78 /* 'x' */ || p[2] === 0x58 /* 'X' */)) {
        const [r, , c] = p;
        const c_s = String.fromCodePoint(c);
        this.errors.unshift({
          description: "expected `}`, found `" + c_s + "`",
          note: undefined,
          label: "expected `'}'`",
          span: r,
          secondary_label: undefined,
          suggestion: { $: "ReorderFormatParameter", _0: range(range_.start, r.end), _1: c_s + "?" },
        });
      }
    } else {
      spec.ty = this.word();
      if (spec.ty !== "") {
        const start = this.input_vec_index2range(start_idx).start;
        const end = this.input_vec_index2range(this.input_vec_index).start;
        spec.ty_span = range(start, end);
      }
    }
    return spec;
  }

  /// Parses an inline assembly template modifier at the current position, returning the modifier
  /// in the `ty` field of the `FormatSpec` struct.
  // rustc: compiler/rustc_parse_format/src/lib.rs:736 inline_asm
  inline_asm(): FormatSpec {
    const spec = FormatSpec_default();

    if (!this.consume(0x3a /* ':' */)) {
      return spec;
    }

    const start_idx = this.input_vec_index;
    spec.ty = this.word();
    if (spec.ty !== "") {
      const start = this.input_vec_index2range(start_idx).start;
      const end = this.input_vec_index2range(this.input_vec_index).start;
      spec.ty_span = range(start, end);
    }

    return spec;
  }

  /// Always returns an empty `FormatSpec`, except for the `ty` and `ty_span` fields.
  // rustc: compiler/rustc_parse_format/src/lib.rs:755 diagnostic
  diagnostic(): FormatSpec {
    const spec = FormatSpec_default();

    const colon = this.consume_pos(0x3a /* ':' */);
    if (colon === undefined) {
      return spec;
    }
    const { start } = colon[0];

    spec.ty = this.string(this.input_vec_index2pos(this.input_vec_index));
    {
      const end = this.input_vec_index2range(this.input_vec_index).start;
      spec.ty_span = range(start, end);
    }
    return spec;
  }

  /// Parses a `Count` parameter at the current position. This does not check
  /// for 'CountIsNextParam' because that is only used in precision, not
  /// width.
  // rustc: compiler/rustc_parse_format/src/lib.rs:773 count
  count(): Count {
    const i = this.integer();
    if (i !== undefined) {
      if (this.consume(0x24 /* '$' */)) {
        return { $: "CountIsParam", _0: i };
      } else {
        return { $: "CountIs", _0: i };
      }
    } else {
      const start_idx = this.input_vec_index;
      const word = this.word();
      let d: [Range, number] | undefined;
      if (word === "") {
        return gen.Count.CountImplied;
      } else if ((d = this.consume_pos(0x24 /* '$' */)) !== undefined) {
        const [r] = d;
        return { $: "CountIsName", _0: word, _1: range(this.input_vec_index2range(start_idx).start, r.start) };
      } else {
        this.input_vec_index = start_idx;
        return gen.Count.CountImplied;
      }
    }
  }

  /// Parses a word starting at the current position. A word is the same as a
  /// Rust identifier or keyword, except that it can't be a bare `_` character.
  // rustc: compiler/rustc_parse_format/src/lib.rs:792 word
  word(): string {
    const index = this.input_vec_index;
    const p = this.peek();
    if (p !== undefined && is_id_start(p[2])) {
      this.input_vec_index += 1;
    } else {
      return "";
    }
    let err_end: number;
    let end: number;
    for (;;) {
      const q = this.peek();
      if (q !== undefined) {
        const [r, i, c] = q;
        if (is_id_continue(c)) {
          this.input_vec_index += 1;
        } else {
          [err_end, end] = [r.start, i];
          break;
        }
      } else {
        [err_end, end] = [this.end_of_snippet, this.input.len()];
        break;
      }
    }

    const word = this.input.slice(this.input_vec_index2pos(index), end).toString();
    if (word === "_") {
      this.errors.push({
        description: "invalid argument name `_`",
        note: "argument name cannot be a single underscore",
        label: "invalid argument name",
        span: range(this.input_vec_index2range(index).start, err_end),
        secondary_label: undefined,
        suggestion: gen.Suggestion.None,
      });
    }
    return word;
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:829 integer
  integer(): number | undefined {
    let cur = 0;
    let found = false;
    let overflow = false;
    const start_index = this.input_vec_index;
    let p: [Range, number, number] | undefined;
    while ((p = this.peek()) !== undefined) {
      const c = p[2];
      const i = to_digit(c, 10);
      if (i !== undefined) {
        this.input_vec_index += 1;
        // PORT: `u16::overflowing_mul` / `overflowing_add`: wrapped value + overflow flag.
        const mul = cur * 10;
        const mul_overflow = mul > 0xffff;
        const add = (mul & 0xffff) + i;
        const add_overflow = add > 0xffff;
        if (mul_overflow || add_overflow) {
          overflow = true;
        }
        cur = add & 0xffff;
        found = true;
      } else {
        break;
      }
    }

    if (overflow) {
      const overflowed_int = this.input.slice(this.input_vec_index2pos(start_index), this.input_vec_index2pos(this.input_vec_index)).toString();
      this.errors.push({
        description: "integer `" + overflowed_int + "` does not fit into the type `u16` whose range is `0..=65535`",
        note: undefined,
        label: "integer out of range for `u16`",
        span: range(this.input_vec_index2range(start_index).start, this.input_vec_index2range(this.input_vec_index).end),
        secondary_label: undefined,
        suggestion: gen.Suggestion.None,
      });
    }

    return found ? cur : undefined;
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:870 suggest_format_debug
  suggest_format_debug(): void {
    // PORT: the tuple `(self.consume_pos('?'), self.consume_pos(':'))` evaluates both.
    const a = this.consume_pos(0x3f /* '?' */);
    const b = this.consume_pos(0x3a /* ':' */);
    if (a !== undefined && b !== undefined) {
      const [range_] = a;
      const word = this.word();
      this.errors.unshift({
        description: "expected format parameter to occur after `:`",
        note: "`?` comes after `:`, try `" + word + ":?` instead",
        label: "expected `?` to occur after `:`",
        span: range_,
        secondary_label: undefined,
        suggestion: gen.Suggestion.None,
      });
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:887 missing_colon_before_debug_formatter
  missing_colon_before_debug_formatter(): void {
    const q = this.consume_pos(0x3f /* '?' */);
    if (q !== undefined) {
      const [range_] = q;
      const span = range_;
      this.errors.unshift({
        description: "expected `}`, found `?`",
        note: "to print `{`, you can escape it using `{{`",
        label: "expected `:` before `?` to format with `Debug`",
        span: range_,
        secondary_label: undefined,
        suggestion: { $: "AddMissingColon", _0: span },
      });
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:904 suggest_rust_debug_printing_macro
  suggest_rust_debug_printing_macro(): void {
    const q = this.consume_pos(0x3d /* '=' */);
    if (q !== undefined) {
      const [range_] = q;
      const sp = this.last_open_brace;
      this.errors.unshift({
        description: "python's f-string debug `=` is not supported in rust, use `dbg(x)` instead",
        note: "to print `{`, you can escape it using `{{`",
        label: "expected `}`",
        span: range_,
        secondary_label: sp === undefined ? undefined : ["because of this opening brace", sp],
        suggestion: gen.Suggestion.UseRustDebugPrintingMacro,
      });
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:925 suggest_format_align
  suggest_format_align(alignment: number): void {
    const q = this.consume_pos(alignment);
    if (q !== undefined) {
      const [range_] = q;
      this.errors.unshift({
        description: "expected alignment specifier after `:` in format string; example: `{:>?}`",
        note: undefined,
        label: "expected `" + String.fromCodePoint(alignment) + "` to occur after `:`",
        span: range_,
        secondary_label: undefined,
        suggestion: gen.Suggestion.None,
      });
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:943 suggest_format_missing_colon_for_sign
  suggest_format_missing_colon_for_sign(): void {
    const q = this.consume_pos(0x2b /* '+' */);
    if (q !== undefined) {
      const [range_] = q;
      this.errors.unshift({
        description: "the `+` sign flag must appear after `:` in a format string",
        note: "`+` comes after `:`, try `{:+}` instead of `{+}`",
        label: "expected `:` before `+` sign flag",
        span: range_,
        secondary_label: undefined,
        suggestion: gen.Suggestion.None,
      });
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:960 suggest_positional_arg_instead_of_captured_arg
  suggest_positional_arg_instead_of_captured_arg(arg: Argument): void {
    // If the argument is not an identifier, it is not a field access.
    if (!arg.is_identifier()) {
      return;
    }

    if (this.consume_pos(0x2e /* '.' */) !== undefined) {
      const field = this.argument();
      // We can only parse simple `foo.bar` field access or `foo.0` tuple index access, any
      // deeper nesting, or another type of expression, like method calls, are not supported
      if (!this.consume(0x7d /* '}' */)) {
        return;
      }
      if (arg.position.$ === "ArgumentNamed") {
        switch (field.position.$) {
          case "ArgumentNamed": {
            this.errors.unshift({
              description: "field access isn't supported",
              note: "consider moving this expression to a local variable and then using the local here instead",
              label: "not supported",
              span: range(arg.position_span.start, field.position_span.end),
              secondary_label: undefined,
              suggestion: gen.Suggestion.UsePositional,
            });
            break;
          }
          case "ArgumentIs": {
            this.errors.unshift({
              description: "tuple index access isn't supported",
              note: "consider moving this expression to a local variable and then using the local here instead",
              label: "not supported",
              span: range(arg.position_span.start, field.position_span.end),
              secondary_label: undefined,
              suggestion: gen.Suggestion.UsePositional,
            });
            break;
          }
          default:
            break;
        }
      }
    }
  }

  // rustc: compiler/rustc_parse_format/src/lib.rs:1015 suggest_unsupported_python_numeric_grouping
  suggest_unsupported_python_numeric_grouping(): void {
    const q = this.consume_pos(0x2c /* ',' */);
    if (q !== undefined) {
      const [range_] = q;
      const sp = this.last_open_brace;
      this.errors.unshift({
        description: "python's numeric grouping `,` is not supported in rust format strings",
        note: "to print `{`, you can escape it using `{{`",
        label: "expected `}`",
        span: range_,
        secondary_label: sp === undefined ? undefined : ["because of this opening brace", sp],
        suggestion: gen.Suggestion.None,
      });
    }
  }
}

// ---- helpers for the constructor (std `str` / slice operations) ----

/** `bytes[a..b].iter().all(|&c| c == byte)` */
function all_bytes(s: Str, a: number, b: number, byte: number): boolean {
  for (let k = a; k < b; k++) if (s.byte(k) !== byte) return false;
  return true;
}

/** `<str as PartialEq>::eq` */
function str_eq(a: Str, b: Str): boolean {
  if (a.len() !== b.len()) return false;
  for (let k = 0; k < a.len(); k++) if (a.byte(k) !== b.byte(k)) return false;
  return true;
}

/** `str::char_indices()`: calls `f(byte_index, char)` until it returns `false`. */
function for_each_char_index(s: Str, f: (idx: number, c: number) => boolean): void {
  let k = 0;
  while (k < s.len()) {
    const c = decode_at(s.b, s.lo + k);
    if (!f(k, c)) return;
    k += utf8_width(s.byte(k));
  }
}

// Assert a reasonable size for `Piece`
// #[cfg(all(test, target_pointer_width = "64"))]
// rustc_index::static_assert_size!(Piece<'_>, 16);
