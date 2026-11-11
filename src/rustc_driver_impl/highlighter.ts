//! This module provides a syntax highlighter for Rust code.
//! It is used by the `rustc --explain` command.
//!
//! The syntax highlighter uses `rustc_lexer`'s `tokenize`
//! function to parse the Rust code into a `Vec` of tokens.
//! The highlighter then highlights the tokens in the `Vec`,
//! and writes the highlighted output to the buffer.
// Port of compiler/rustc_driver_impl/src/highlighter.rs.
// PORT: `code: &str` is indexed by byte (`len_accum`), so it is lexed and sliced as a `Str`. `write!(buf, "{style}..
// {style:#}")` is `Style::render` / `Style::render_reset` (anstyle's `Display for Style`).
import { is_uppercase } from "../std/char.ts";
import type { IoResult } from "../std/io.ts";
import { Ok } from "../std/result.ts";
import { Str } from "../std/str.ts";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../rustc_lexer/lib.ts";
import { AnsiColor, Effects, Style } from "../vendor/anstyle/lib.ts";
import type { VecU8 } from "../vendor/anstream/stream.ts";

const PRIMITIVE_TYPES: readonly string[] = [
  "i8", "i16", "i32", "i64", "i128", "isize", // signed integers
  "u8", "u16", "u32", "u64", "u128", "usize", // unsigned integers
  "f32", "f64", // floating point
  "char", "bool", // others
];

const KEYWORDS: readonly string[] = [
  "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while", "as",
  "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
  "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
  "ref",
];

const STR_LITERAL_COLOR: AnsiColor = AnsiColor.Green;
const OTHER_LITERAL_COLOR: AnsiColor = AnsiColor.BrightRed;
const DERIVE_COLOR: AnsiColor = AnsiColor.BrightRed;
const KEYWORD_COLOR: AnsiColor = AnsiColor.BrightMagenta;
const TYPE_COLOR: AnsiColor = AnsiColor.Yellow;
const FUNCTION_COLOR: AnsiColor = AnsiColor.Blue;
const USE_COLOR: AnsiColor = AnsiColor.BrightMagenta;
const PRIMITIVE_TYPE_COLOR: AnsiColor = AnsiColor.Cyan;

/// Highlight a Rust code string and write the highlighted
/// output to the buffer. It serves as a wrapper around
/// `Highlighter::highlight_rustc_lexer`. It is passed to
/// `write_anstream_buf` in the `lib.rs` file.
// rustc: compiler/rustc_driver_impl/src/highlighter.rs:40 highlight
export function highlight(code: string, buf: VecU8): IoResult<void> {
  const highlighter = Highlighter.default();
  return highlighter.highlight_rustc_lexer(code, buf);
}

/** `Style::new().fg_color(Some(Color::Ansi(c)))` */
function fg(style: Style, c: AnsiColor): Style {
  return Style.fg_color(style, { $: "Ansi", _0: c });
}

/// A syntax highlighter for Rust code
/// It is used by the `rustc --explain` command.
// #[derive(Default)]
export class Highlighter {
  constructor(
    /// Used to track if the previous token was a token
    /// that warrants the next token to be colored differently
    ///
    /// For example, the keyword `fn` requires the next token
    /// (the function name) to be colored differently.
    public prev_was_special: boolean,
    /// Used to track the length of tokens that have been
    /// written so far. This is used to find the original
    /// lexeme for a token from the code string.
    public len_accum: number,
  ) {}

  /** `#[derive(Default)]` */
  static default(): Highlighter {
    return new Highlighter(false, 0);
  }

  /// Create a new highlighter
  // rustc: compiler/rustc_driver_impl/src/highlighter.rs:63 new
  static new(): Highlighter {
    return Highlighter.default();
  }

  /// Highlight a Rust code string and write the highlighted
  /// output to the buffer.
  // rustc: compiler/rustc_driver_impl/src/highlighter.rs:69 highlight_rustc_lexer
  highlight_rustc_lexer(code_: string, buf: VecU8): IoResult<void> {
    // use rustc_lexer::TokenKind;
    const code = Str.from(code_);

    // Remove shebang from code string
    const stripped_idx = strip_shebang(code) ?? 0;
    const stripped_code = code.slice(stripped_idx);
    this.len_accum = stripped_idx;
    const tokens = tokenize(stripped_code, FrontmatterAllowed.No);
    for (const token of tokens) {
      const len = token.len;
      // If the previous token was a special token, and this token is
      // not a whitespace token, then it should be colored differently
      const token_str = code.slice(this.len_accum, this.len_accum + len).toString();
      if (this.prev_was_special) {
        if (token_str !== " ") {
          this.prev_was_special = false;
        }
        const style = fg(Style.new(), AnsiColor.Blue);
        const r = buf.write_fmt([Style.render(style), token_str, Style.render_reset(style)]);
        if (r.$ === "Err") return r;
        this.len_accum += len;
        continue;
      }
      switch (token.kind.$) {
        case "Ident": {
          let style = Style.new();
          // Match if an identifier is a (well-known) keyword
          if (KEYWORDS.includes(token_str)) {
            if (token_str === "fn") {
              this.prev_was_special = true;
            }
            style = fg(style, KEYWORD_COLOR);
          }
          // The `use` keyword is colored differently
          if (token_str === "use") {
            style = fg(style, USE_COLOR);
          }
          // This heuristic test is to detect if the identifier is
          // a function call. If it is, then the function identifier is
          // colored differently.
          if (code.slice(this.len_accum + len).starts_with("(")) {
            style = fg(style, FUNCTION_COLOR);
          }
          // The `derive` keyword is colored differently.
          if (token_str === "derive") {
            style = fg(style, DERIVE_COLOR);
          }
          // This heuristic test is to detect if the identifier is
          // a type. If it is, then the identifier is colored differently.
          const first = token_str.codePointAt(0);
          if (first !== undefined && is_uppercase(first)) {
            style = fg(style, TYPE_COLOR);
          }
          // This if statement is to detect if the identifier is a primitive type.
          if (PRIMITIVE_TYPES.includes(token_str)) {
            style = fg(style, PRIMITIVE_TYPE_COLOR);
          }
          const r = buf.write_fmt([Style.render(style), token_str, Style.render_reset(style)]);
          if (r.$ === "Err") return r;
          break;
        }

        // Color literals
        case "Literal": {
          const kind = token.kind.kind;
          // Strings -> Green
          // Chars -> Green
          // Raw strings -> Green
          // C strings -> Green
          // Byte Strings -> Green
          // Other literals -> Bright Red (Orage-esque)
          let style: Style;
          switch (kind.$) {
            case "Str":
            case "Char":
            case "RawStr":
            case "CStr":
              style = fg(Style.new(), STR_LITERAL_COLOR);
              break;
            default:
              style = fg(Style.new(), OTHER_LITERAL_COLOR);
          }
          const r = buf.write_fmt([Style.render(style), token_str, Style.render_reset(style)]);
          if (r.$ === "Err") return r;
          break;
        }
        default: {
          // All other tokens are dimmed
          const style = Style.effects(fg(Style.new(), AnsiColor.BrightWhite), Effects.DIMMED);
          const r = buf.write_fmt([Style.render(style), token_str, Style.render_reset(style)]);
          if (r.$ === "Err") return r;
        }
      }
      this.len_accum += len;
    }
    return Ok(undefined);
  }
}
