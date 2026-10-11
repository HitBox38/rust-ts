//! Low-level Rust lexer.
//!
//! The idea with `rustc_lexer` is to make a reusable library,
//! by separating out pure lexing and rustc-specific concerns, like spans,
//! error reporting, and interning. So, rustc_lexer operates directly on `&str`,
//! produces simple tokens which are a pair of type-tag and a bit of original text,
//! and does not report errors, instead storing them as flags on the token.
//!
//! Tokens produced by this lexer are not yet ready for parsing the Rust syntax.
//! For that see [`rustc_parse::lexer`], which converts this basic token stream
//! into wide tokens used by actual parser.
//!
//! The purpose of this crate is to convert raw sources into a labeled sequence
//! of well-known token types, so building an actual Rust token stream will
//! be easier.
//!
//! The main entity of this crate is the [`TokenKind`] enum which represents common
//! lexeme types.
//!
//! [`rustc_parse::lexer`]: ../rustc_parse/lexer/index.html
import { ch, is_ascii, is_ascii_digit } from "../std/char.ts";
import { debug_bool, debug_char, debug_int, debug_option, debug_struct, type Debug } from "../std/fmt.ts";
import { Err, Ok, ok, type Result } from "../std/result.ts";
import { Str, type Chars } from "../std/str.ts";
import { is_xid_continue, is_xid_start } from "../vendor/unicode_ident/lib.ts";
import { is_emoji_char } from "../vendor/unicode_properties/lib.ts";

// PORT: the const block asserting unicode-properties and unicode-ident agree on the
// Unicode version is enforced by tools/gen-unicode.ts, which generates both tables
// from the same oracle run.
export const UNICODE_VERSION: readonly [number, number, number] = [17, 0, 0];

/// Parsed token.
/// It doesn't contain information about data that has been parsed,
/// only the type of the token and its size.
export class Token {
  constructor(
    public kind: TokenKind,
    public len: number,
  ) {}

  // rustc: compiler/rustc_lexer/src/lib.rs:65 new
  static new(kind: TokenKind, len: number): Token {
    return new Token(kind, len);
  }
}

export const debug_Token: Debug<Token> = (v, f) =>
  debug_struct(f, "Token", [
    ["kind", debug_TokenKind(v.kind, f)],
    ["len", debug_int(v.len, f)],
  ]);

/// Enum representing common lexeme types.
export type TokenKind =
  /// A line comment, e.g. `// comment`.
  | { readonly $: "LineComment"; readonly doc_style: DocStyle | undefined }
  /// A block comment, e.g. `/* block comment */`.
  ///
  /// Block comments can be recursive, so a sequence like `/* /* */`
  /// will not be considered terminated and will result in a parsing error.
  | { readonly $: "BlockComment"; readonly doc_style: DocStyle | undefined; readonly terminated: boolean }
  /// Any whitespace character sequence.
  | { readonly $: "Whitespace" }
  | { readonly $: "Frontmatter"; readonly has_invalid_preceding_whitespace: boolean; readonly invalid_infostring: boolean }
  /// An identifier or keyword, e.g. `ident` or `continue`.
  | { readonly $: "Ident" }
  /// An identifier that is invalid because it contains emoji.
  | { readonly $: "InvalidIdent" }
  /// A raw identifier, e.g. "r#ident".
  | { readonly $: "RawIdent" }
  /// A forced keyword like `k#fn`.
  | { readonly $: "ForcedKeywordIdent" }
  /// An unknown literal prefix, like `foo#`, `foo'`, `foo"`. Excludes
  /// literal prefixes that contain emoji, which are considered "invalid".
  ///
  /// Note that only the
  /// prefix (`foo`) is included in the token, not the separator (which is
  /// lexed as its own distinct token). In Rust 2021 and later, reserved
  /// prefixes are reported as errors; in earlier editions, they result in a
  /// (allowed by default) lint, and are treated as regular identifier
  /// tokens.
  | { readonly $: "UnknownPrefix" }
  /// An unknown prefix in a lifetime, like `'foo#`.
  ///
  /// Like `UnknownPrefix`, only the `'` and prefix are included in the token
  /// and not the separator.
  | { readonly $: "UnknownPrefixLifetime" }
  /// A raw lifetime, e.g. `'r#foo`. In edition < 2021 it will be split into
  /// several tokens: `'r` and `#` and `foo`.
  | { readonly $: "RawLifetime" }
  /// Guarded string literal prefix: `#"` or `##`.
  ///
  /// Used for reserving "guarded strings" (RFC 3598) in edition 2024.
  /// Split into the component tokens on older editions.
  | { readonly $: "GuardedStrPrefix" }
  /// Literals, e.g. `12u8`, `1.0e-40`, `b"123"`. Note that `_` is an invalid
  /// suffix, but may be present here on string and float literals. Users of
  /// this type will need to check for and reject that case.
  ///
  /// See [LiteralKind] for more details.
  | { readonly $: "Literal"; readonly kind: LiteralKind; readonly suffix_start: number }
  /// A lifetime, e.g. `'a`.
  | { readonly $: "Lifetime"; readonly starts_with_number: boolean }
  | { readonly $: "Semi" } /// `;`
  | { readonly $: "Comma" } /// `,`
  | { readonly $: "Dot" } /// `.`
  | { readonly $: "OpenParen" } /// `(`
  | { readonly $: "CloseParen" } /// `)`
  | { readonly $: "OpenBrace" } /// `{`
  | { readonly $: "CloseBrace" } /// `}`
  | { readonly $: "OpenBracket" } /// `[`
  | { readonly $: "CloseBracket" } /// `]`
  | { readonly $: "At" } /// `@`
  | { readonly $: "Pound" } /// `#`
  | { readonly $: "Tilde" } /// `~`
  | { readonly $: "Question" } /// `?`
  | { readonly $: "Colon" } /// `:`
  | { readonly $: "Dollar" } /// `$`
  | { readonly $: "Eq" } /// `=`
  | { readonly $: "Bang" } /// `!`
  | { readonly $: "Lt" } /// `<`
  | { readonly $: "Gt" } /// `>`
  | { readonly $: "Minus" } /// `-`
  | { readonly $: "And" } /// `&`
  | { readonly $: "Or" } /// `|`
  | { readonly $: "Plus" } /// `+`
  | { readonly $: "Star" } /// `*`
  | { readonly $: "Slash" } /// `/`
  | { readonly $: "Caret" } /// `^`
  | { readonly $: "Percent" } /// `%`
  /// Unknown token, not expected by the lexer, e.g. "№"
  | { readonly $: "Unknown" }
  /// End of input.
  | { readonly $: "Eof" };

type UnitTokenKindName =
  | "Whitespace" | "Ident" | "InvalidIdent" | "RawIdent" | "ForcedKeywordIdent" | "UnknownPrefix"
  | "UnknownPrefixLifetime" | "RawLifetime" | "GuardedStrPrefix" | "Semi" | "Comma" | "Dot"
  | "OpenParen" | "CloseParen" | "OpenBrace" | "CloseBrace" | "OpenBracket" | "CloseBracket" | "At"
  | "Pound" | "Tilde" | "Question" | "Colon" | "Dollar" | "Eq" | "Bang" | "Lt" | "Gt" | "Minus" | "And"
  | "Or" | "Plus" | "Star" | "Slash" | "Caret" | "Percent" | "Unknown" | "Eof";

function unit<N extends UnitTokenKindName>($: N): { readonly $: N } {
  return Object.freeze({ $ });
}

/** Unit variants of `TokenKind`, shared (they are `Copy` in Rust). */
export const TokenKind = {
  Whitespace: unit("Whitespace"),
  Ident: unit("Ident"),
  InvalidIdent: unit("InvalidIdent"),
  RawIdent: unit("RawIdent"),
  ForcedKeywordIdent: unit("ForcedKeywordIdent"),
  UnknownPrefix: unit("UnknownPrefix"),
  UnknownPrefixLifetime: unit("UnknownPrefixLifetime"),
  RawLifetime: unit("RawLifetime"),
  GuardedStrPrefix: unit("GuardedStrPrefix"),
  Semi: unit("Semi"),
  Comma: unit("Comma"),
  Dot: unit("Dot"),
  OpenParen: unit("OpenParen"),
  CloseParen: unit("CloseParen"),
  OpenBrace: unit("OpenBrace"),
  CloseBrace: unit("CloseBrace"),
  OpenBracket: unit("OpenBracket"),
  CloseBracket: unit("CloseBracket"),
  At: unit("At"),
  Pound: unit("Pound"),
  Tilde: unit("Tilde"),
  Question: unit("Question"),
  Colon: unit("Colon"),
  Dollar: unit("Dollar"),
  Eq: unit("Eq"),
  Bang: unit("Bang"),
  Lt: unit("Lt"),
  Gt: unit("Gt"),
  Minus: unit("Minus"),
  And: unit("And"),
  Or: unit("Or"),
  Plus: unit("Plus"),
  Star: unit("Star"),
  Slash: unit("Slash"),
  Caret: unit("Caret"),
  Percent: unit("Percent"),
  Unknown: unit("Unknown"),
  Eof: unit("Eof"),
} satisfies Record<UnitTokenKindName, TokenKind>;

export const debug_TokenKind: Debug<TokenKind> = (v, f) => {
  switch (v.$) {
    case "LineComment":
      return debug_struct(f, "LineComment", [["doc_style", debug_option(v.doc_style, f, debug_DocStyle)]]);
    case "BlockComment":
      return debug_struct(f, "BlockComment", [
        ["doc_style", debug_option(v.doc_style, f, debug_DocStyle)],
        ["terminated", debug_bool(v.terminated, f)],
      ]);
    case "Frontmatter":
      return debug_struct(f, "Frontmatter", [
        ["has_invalid_preceding_whitespace", debug_bool(v.has_invalid_preceding_whitespace, f)],
        ["invalid_infostring", debug_bool(v.invalid_infostring, f)],
      ]);
    case "Literal":
      return debug_struct(f, "Literal", [
        ["kind", debug_LiteralKind(v.kind, f)],
        ["suffix_start", debug_int(v.suffix_start, f)],
      ]);
    case "Lifetime":
      return debug_struct(f, "Lifetime", [["starts_with_number", debug_bool(v.starts_with_number, f)]]);
    default:
      return v.$;
  }
};

export type DocStyle = "Outer" | "Inner";
export const DocStyle = { Outer: "Outer", Inner: "Inner" } as const;
export const debug_DocStyle: Debug<DocStyle> = (v) => v;

/// Enum representing the literal types supported by the lexer.
///
/// Note that the suffix is *not* considered when deciding the `LiteralKind` in
/// this type. This means that float literals like `1f32` are classified by this
/// type as `Int`. (Compare against `rustc_ast::token::LitKind` and
/// `rustc_ast::ast::LitKind`).
export type LiteralKind =
  /// `12_u8`, `0o100`, `0b120i99`, `1f32`.
  | { readonly $: "Int"; readonly base: Base; readonly empty_int: boolean }
  /// `12.34f32`, `1e3`, but not `1f32`.
  | { readonly $: "Float"; readonly base: Base; readonly empty_exponent: boolean }
  /// `'a'`, `'\\'`, `'''`, `';`
  | { readonly $: "Char"; readonly terminated: boolean }
  /// `b'a'`, `b'\\'`, `b'''`, `b';`
  | { readonly $: "Byte"; readonly terminated: boolean }
  /// `"abc"`, `"abc`
  | { readonly $: "Str"; readonly terminated: boolean }
  /// `b"abc"`, `b"abc`
  | { readonly $: "ByteStr"; readonly terminated: boolean }
  /// `c"abc"`, `c"abc`
  | { readonly $: "CStr"; readonly terminated: boolean }
  /// `r"abc"`, `r#"abc"#`, `r####"ab"###"c"####`, `r#"a`. `None` indicates
  /// an invalid literal.
  | { readonly $: "RawStr"; readonly n_hashes: number | undefined }
  /// `br"abc"`, `br#"abc"#`, `br####"ab"###"c"####`, `br#"a`. `None`
  /// indicates an invalid literal.
  | { readonly $: "RawByteStr"; readonly n_hashes: number | undefined }
  /// `cr"abc"`, "cr#"abc"#", `cr#"a`. `None` indicates an invalid literal.
  | { readonly $: "RawCStr"; readonly n_hashes: number | undefined };

export const debug_LiteralKind: Debug<LiteralKind> = (v, f) => {
  switch (v.$) {
    case "Int":
      return debug_struct(f, "Int", [
        ["base", debug_Base(v.base, f)],
        ["empty_int", debug_bool(v.empty_int, f)],
      ]);
    case "Float":
      return debug_struct(f, "Float", [
        ["base", debug_Base(v.base, f)],
        ["empty_exponent", debug_bool(v.empty_exponent, f)],
      ]);
    case "Char":
    case "Byte":
    case "Str":
    case "ByteStr":
    case "CStr":
      return debug_struct(f, v.$, [["terminated", debug_bool(v.terminated, f)]]);
    case "RawStr":
    case "RawByteStr":
    case "RawCStr":
      return debug_struct(f, v.$, [["n_hashes", debug_option(v.n_hashes, f, debug_int)]]);
  }
};

/// `#"abc"#`, `##"a"` (fewer closing), or even `#"a` (unterminated).
///
/// Can capture fewer closing hashes than starting hashes,
/// for more efficient lexing and better backwards diagnostics.
export interface GuardedStr {
  readonly n_hashes: number;
  readonly terminated: boolean;
  readonly token_len: number;
}

export const debug_GuardedStr: Debug<GuardedStr> = (v, f) =>
  debug_struct(f, "GuardedStr", [
    ["n_hashes", debug_int(v.n_hashes, f)],
    ["terminated", debug_bool(v.terminated, f)],
    ["token_len", debug_int(v.token_len, f)],
  ]);

export type RawStrError =
  /// Non `#` characters exist between `r` and `"`, e.g. `r##~"abcde"##`
  | { readonly $: "InvalidStarter"; readonly bad_char: number }
  /// The string was not terminated, e.g. `r###"abcde"##`.
  /// `possible_terminator_offset` is the number of characters after `r` or
  /// `br` where they may have intended to terminate it.
  | { readonly $: "NoTerminator"; readonly expected: number; readonly found: number; readonly possible_terminator_offset: number | undefined }
  /// More than 255 `#`s exist.
  | { readonly $: "TooManyDelimiters"; readonly found: number };

export const debug_RawStrError: Debug<RawStrError> = (v, f) => {
  switch (v.$) {
    case "InvalidStarter":
      return debug_struct(f, "InvalidStarter", [["bad_char", debug_char(v.bad_char)]]);
    case "NoTerminator":
      return debug_struct(f, "NoTerminator", [
        ["expected", debug_int(v.expected, f)],
        ["found", debug_int(v.found, f)],
        ["possible_terminator_offset", debug_option(v.possible_terminator_offset, f, debug_int)],
      ]);
    case "TooManyDelimiters":
      return debug_struct(f, "TooManyDelimiters", [["found", debug_int(v.found, f)]]);
  }
};

/// Base of numeric literal encoding according to its prefix.
export type Base =
  /// Literal starts with "0b".
  | "Binary"
  /// Literal starts with "0o".
  | "Octal"
  /// Literal doesn't contain a prefix.
  | "Decimal"
  /// Literal starts with "0x".
  | "Hexadecimal";
export const Base = { Binary: "Binary", Octal: "Octal", Decimal: "Decimal", Hexadecimal: "Hexadecimal" } as const;
/** `base as u32` */
export const Base_discriminant: Record<Base, number> = { Binary: 2, Octal: 8, Decimal: 10, Hexadecimal: 16 };
export const debug_Base: Debug<Base> = (v) => v;

const C_HASH = ch("#");
const C_DQUOTE = ch('"');
const C_SQUOTE = ch("'");
const C_SLASH = ch("/");
const C_STAR = ch("*");
const C_BANG = ch("!");
const C_BSLASH = ch("\\");
const C_NL = ch("\n");
const C_MINUS = ch("-");
const C_DOT = ch(".");
const C_UNDERSCORE = ch("_");
const C_PLUS = ch("+");
const C_0 = ch("0");
const C_9 = ch("9");
const C_r = ch("r");
const C_e = ch("e");
const C_E = ch("E");
const C_OPEN_BRACKET = ch("[");

/// `rustc` allows files to have a shebang, e.g. "#!/usr/bin/rustrun",
/// but shebang isn't a part of rust syntax.
// rustc: compiler/rustc_lexer/src/lib.rs:287 strip_shebang
export function strip_shebang(input: Str): number | undefined {
  // Shebang must start with `#!` literally, without any preceding whitespace.
  // For simplicity we consider any line starting with `#!` a shebang,
  // regardless of restrictions put on shebangs by specific platforms.
  if (input.starts_with("#!")) {
    const input_tail = input.slice(2);
    // Ok, this is a shebang but if the next non-whitespace token is `[`,
    // then it may be valid Rust code, so consider it Rust code.
    let next_non_whitespace_token: TokenKind | undefined;
    for (const tok of tokenize(input_tail, FrontmatterAllowed.No)) {
      const kind = tok.kind;
      if (
        !(
          kind.$ === "Whitespace" ||
          (kind.$ === "LineComment" && kind.doc_style === undefined) ||
          (kind.$ === "BlockComment" && kind.doc_style === undefined)
        )
      ) {
        next_non_whitespace_token = kind;
        break;
      }
    }
    if (next_non_whitespace_token?.$ !== "OpenBracket") {
      // No other choice than to consider this a shebang.
      let first_line_len = 0;
      for (const line of input_tail.lines()) {
        first_line_len = line.len();
        break;
      }
      return 2 + first_line_len;
    }
  }
  return undefined;
}

/// Validates a raw string literal. Used for getting more information about a
/// problem with a `RawStr`/`RawByteStr` with a `None` field.
// rustc: compiler/rustc_lexer/src/lib.rs:314 validate_raw_str
export function validate_raw_str(input: Str, prefix_len: number): Result<null, RawStrError> {
  // debug_assert!(!input.is_empty());
  const cursor = Cursor.new(input, FrontmatterAllowed.No);
  // Move past the leading `r` or `br`.
  for (let i = 0; i < prefix_len; i++) {
    cursor.bump();
  }
  const r = cursor.raw_double_quoted_string(prefix_len);
  return r.$ === "Ok" ? Ok(null) : r;
}

/// Creates an iterator that produces tokens from the input string.
///
/// When parsing a full Rust document,
/// first [`strip_shebang`] and then allow frontmatters with [`FrontmatterAllowed::Yes`].
///
/// When tokenizing a slice of a document, be sure to disallow frontmatters with [`FrontmatterAllowed::No`]
// rustc: compiler/rustc_lexer/src/lib.rs:330 tokenize
export function* tokenize(input: Str, frontmatter_allowed: FrontmatterAllowed): Generator<Token> {
  const cursor = Cursor.new(input, frontmatter_allowed);
  for (;;) {
    const token = cursor.advance_token();
    if (token.kind.$ === "Eof") return;
    yield token;
  }
}

/// True if `c` is considered a whitespace according to Rust language definition.
/// See [Rust language reference](https://doc.rust-lang.org/reference/whitespace.html)
/// for definitions of these classes.
// rustc: compiler/rustc_lexer/src/lib.rs:344 is_whitespace
export function is_whitespace(c: number): boolean {
  // This is Pattern_White_Space.
  //
  // Note that this set is stable (ie, it doesn't change with different
  // Unicode versions), so it's ok to just hard-code the values.
  switch (c) {
    // End-of-line characters
    case 0x000a: // line feed (\n)
    case 0x000b: // vertical tab
    case 0x000c: // form feed
    case 0x000d: // carriage return (\r)
    case 0x0085: // next line (from latin1)
    case 0x2028: // LINE SEPARATOR
    case 0x2029: // PARAGRAPH SEPARATOR
    // `Default_Ignorable_Code_Point` characters
    case 0x200e: // LEFT-TO-RIGHT MARK
    case 0x200f: // RIGHT-TO-LEFT MARK
    // Horizontal space characters
    case 0x0009: // tab (\t)
    case 0x0020: // space
      return true;
    default:
      return false;
  }
}

/// True if `c` is considered horizontal whitespace according to Rust language definition.
// rustc: compiler/rustc_lexer/src/lib.rs:372 is_horizontal_whitespace
export function is_horizontal_whitespace(c: number): boolean {
  // This is the horizontal space subset of `Pattern_White_Space` as
  // categorized by UAX #31, Section 4.1.
  //
  // Note that this set is stable (ie, it doesn't change with different
  // Unicode versions), so it's ok to just hard-code the values.
  return c === 0x0009 /* tab (\t) */ || c === 0x0020; /* space */
}

/// True if `c` is valid as a first character of an identifier.
/// See [Rust language reference](https://doc.rust-lang.org/reference/identifiers.html) for
/// a formal definition of valid identifier name.
// rustc: compiler/rustc_lexer/src/lib.rs:390 is_id_start
export function is_id_start(c: number): boolean {
  // This is XID_Start OR '_' (which formally is not a XID_Start).
  return c === C_UNDERSCORE || is_xid_start(c);
}

/// True if `c` is valid as a non-first character of an identifier.
/// See [Rust language reference](https://doc.rust-lang.org/reference/identifiers.html) for
/// a formal definition of valid identifier name.
// rustc: compiler/rustc_lexer/src/lib.rs:398 is_id_continue
export function is_id_continue(c: number): boolean {
  return is_xid_continue(c);
}

/// The passed string is lexically an identifier.
// rustc: compiler/rustc_lexer/src/lib.rs:403 is_ident
export function is_ident(string: string): boolean {
  let first = true;
  for (const s of string) {
    const c = s.codePointAt(0)!;
    if (first ? !is_id_start(c) : !is_id_continue(c)) return false;
    first = false;
  }
  return !first;
}

export type FrontmatterAllowed = "Yes" | "No";
export const FrontmatterAllowed = { Yes: "Yes", No: "No" } as const;

/// Peekable iterator over a char sequence.
///
/// Next characters can be peeked via `first` method,
/// and position can be shifted forward via `bump` method.
export class Cursor {
  // PORT: `prev` only exists under cfg(debug_assertions); rustc ships without it.
  constructor(
    public len_remaining: number,
    /// Iterator over chars. Slightly faster than a &str.
    public chars: Chars,
    public frontmatter_allowed: FrontmatterAllowed,
  ) {}

  // rustc: compiler/rustc_lexer/src/lib.rs:433 new
  static new(input: Str, frontmatter_allowed: FrontmatterAllowed): Cursor {
    return new Cursor(input.len(), input.chars(), frontmatter_allowed);
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:443 as_str
  as_str(): Str {
    return this.chars.as_str();
  }

  /// Returns the last eaten symbol (or `'\0'` in release builds).
  /// (For debug assertions only.)
  // rustc: compiler/rustc_lexer/src/lib.rs:449 prev
  prev(): number {
    return EOF_CHAR;
  }

  /// Peeks the next symbol from the input stream without consuming it.
  /// If requested position doesn't exist, `EOF_CHAR` is returned.
  /// However, getting `EOF_CHAR` doesn't always mean actual end of file,
  /// it should be checked with `is_eof` method.
  // rustc: compiler/rustc_lexer/src/lib.rs:465 first
  first(): number {
    return this.chars.peek(0) ?? EOF_CHAR;
  }

  /// Peeks the second symbol from the input stream without consuming it.
  // rustc: compiler/rustc_lexer/src/lib.rs:471 second
  second(): number {
    return this.chars.peek(1) ?? EOF_CHAR;
  }

  /// Peeks the third symbol from the input stream without consuming it.
  // rustc: compiler/rustc_lexer/src/lib.rs:479 third
  third(): number {
    return this.chars.peek(2) ?? EOF_CHAR;
  }

  /// Checks if there is nothing more to consume.
  // rustc: compiler/rustc_lexer/src/lib.rs:488 is_eof
  is_eof(): boolean {
    return this.chars.rest_len() === 0;
  }

  /// Returns amount of already consumed symbols.
  // rustc: compiler/rustc_lexer/src/lib.rs:493 pos_within_token
  pos_within_token(): number {
    return this.len_remaining - this.chars.rest_len();
  }

  /// Resets the number of bytes consumed to 0.
  // rustc: compiler/rustc_lexer/src/lib.rs:498 reset_pos_within_token
  reset_pos_within_token(): void {
    this.len_remaining = this.chars.rest_len();
  }

  /// Moves to the next character.
  // rustc: compiler/rustc_lexer/src/lib.rs:503 bump
  bump(): number | undefined {
    return this.chars.next();
  }

  /// Moves to a substring by a number of bytes.
  // rustc: compiler/rustc_lexer/src/lib.rs:515 bump_bytes
  bump_bytes(n: number): void {
    this.chars = this.as_str().slice(n).chars();
  }

  /// Eats symbols while predicate returns true or until the end of file is reached.
  // rustc: compiler/rustc_lexer/src/lib.rs:520 eat_while
  eat_while(predicate: (c: number) => boolean): void {
    // It was tried making optimized version of this for eg. line comments, but
    // LLVM can inline all of this and compile it down to fast iteration over bytes.
    while (predicate(this.first()) && !this.is_eof()) {
      this.bump();
    }
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:528 eat_until
  eat_until(byte: number): void {
    const c = this.chars;
    const index = c.b.indexOf(byte, c.pos);
    c.pos = index < 0 || index >= c.end ? c.end : index;
  }

  /// Parses a token from the input string.
  // rustc: compiler/rustc_lexer/src/lib.rs:536 advance_token
  advance_token(): Token {
    const first_char = this.bump();
    if (first_char === undefined) {
      return Token.new(TokenKind.Eof, 0);
    }

    let token_kind: TokenKind;
    const c = first_char;
    if (this.frontmatter_allowed === "Yes" && is_whitespace(c)) {
      let last = first_char;
      while (is_whitespace(this.first())) {
        const c = this.bump();
        if (c === undefined) {
          break;
        }
        last = c;
      }
      // invalid frontmatter opening as whitespace preceding it isn't newline.
      // combine the whitespace and the frontmatter to a single token as we shall
      // error later.
      if (last !== C_NL && this.as_str().starts_with("---")) {
        this.bump();
        token_kind = this.frontmatter(true);
      } else {
        token_kind = TokenKind.Whitespace;
      }
    } else if (c === C_MINUS && this.frontmatter_allowed === "Yes" && this.as_str().starts_with("--")) {
      // happy path
      token_kind = this.frontmatter(false);
    }
    // Slash, comment or block comment.
    else if (c === C_SLASH) {
      const f = this.first();
      token_kind = f === C_SLASH ? this.line_comment() : f === C_STAR ? this.block_comment() : TokenKind.Slash;
    }
    // Whitespace sequence.
    else if (is_whitespace(c)) {
      token_kind = this.whitespace();
    }
    // Raw identifier, raw string literal or identifier.
    else if (c === C_r) {
      const first = this.first();
      if (first === C_HASH && is_id_start(this.second())) {
        this.bump(); // `#`
        this.eat_identifier();
        token_kind = TokenKind.RawIdent;
      } else if (first === C_HASH || first === C_DQUOTE) {
        const res = this.raw_double_quoted_string(1);
        const suffix_start = this.pos_within_token();
        if (res.$ === "Ok") {
          this.eat_literal_suffix();
        }
        const kind: LiteralKind = { $: "RawStr", n_hashes: ok(res) };
        token_kind = { $: "Literal", kind, suffix_start };
      } else {
        token_kind = this.ident_or_unknown_prefix();
      }
    }
    // Forced keyword identifier or identifier.
    else if (c === ch("k")) {
      if (this.first() === C_HASH && is_id_start(this.second())) {
        this.bump(); // `#`
        this.eat_identifier();
        token_kind = TokenKind.ForcedKeywordIdent;
      } else {
        token_kind = this.ident_or_unknown_prefix();
      }
    }
    // Byte literal, byte string literal, raw byte string literal or identifier.
    else if (c === ch("b")) {
      token_kind = this.c_or_byte_string(
        (terminated) => ({ $: "ByteStr", terminated }),
        (n_hashes) => ({ $: "RawByteStr", n_hashes }),
        (terminated) => ({ $: "Byte", terminated }),
      );
    }
    // c-string literal, raw c-string literal or identifier.
    else if (c === ch("c")) {
      token_kind = this.c_or_byte_string(
        (terminated) => ({ $: "CStr", terminated }),
        (n_hashes) => ({ $: "RawCStr", n_hashes }),
        undefined,
      );
    }
    // Identifier (this should be checked after other variant that can
    // start as identifier).
    else if (is_id_start(c)) {
      token_kind = this.ident_or_unknown_prefix();
    }
    // Numeric literal.
    else if (c >= C_0 && c <= C_9) {
      const literal_kind = this.number(c);
      const suffix_start = this.pos_within_token();
      this.eat_literal_suffix();
      token_kind = { $: "Literal", kind: literal_kind, suffix_start };
    }
    // Guarded string literal prefix: `#"` or `##`
    else if (c === C_HASH && (this.first() === C_DQUOTE || this.first() === C_HASH)) {
      this.bump();
      token_kind = TokenKind.GuardedStrPrefix;
    }
    // Lifetime or character literal.
    else if (c === C_SQUOTE) {
      token_kind = this.lifetime_or_char();
    }
    // String literal.
    else if (c === C_DQUOTE) {
      const terminated = this.double_quoted_string();
      const suffix_start = this.pos_within_token();
      if (terminated) {
        this.eat_literal_suffix();
      }
      const kind: LiteralKind = { $: "Str", terminated };
      token_kind = { $: "Literal", kind, suffix_start };
    } else {
      // One-symbol tokens.
      const one = ONE_SYMBOL_TOKENS.get(c);
      if (one !== undefined) {
        token_kind = one;
      }
      // Identifier starting with an emoji. Only lexed for graceful error recovery.
      else if (!is_ascii(c) && is_emoji_char(c)) {
        token_kind = this.invalid_ident();
      } else {
        token_kind = TokenKind.Unknown;
      }
    }
    if (this.frontmatter_allowed === "Yes" && token_kind.$ !== "Whitespace") {
      // stop allowing frontmatters after first non-whitespace token
      this.frontmatter_allowed = FrontmatterAllowed.No;
    }
    const res = Token.new(token_kind, this.pos_within_token());
    this.reset_pos_within_token();
    return res;
  }

  /// Given that one `-` was eaten, eat the rest of the frontmatter.
  // rustc: compiler/rustc_lexer/src/lib.rs:696 frontmatter
  frontmatter(has_invalid_preceding_whitespace: boolean): TokenKind {
    // debug_assert_eq!('-', self.prev());

    const pos = this.pos_within_token();
    this.eat_while((c) => c === C_MINUS);

    // one `-` is eaten by the caller.
    const length_opening = this.pos_within_token() - pos + 1;

    // must be ensured by the caller
    // debug_assert!(length_opening >= 3);

    // whitespace between the opening and the infostring.
    this.eat_while((ch) => ch !== C_NL && is_horizontal_whitespace(ch));

    // copied from `eat_identifier`, but allows `-` and `.` in infostring to allow something like
    // `---Cargo.toml` as a valid opener
    if (is_id_start(this.first())) {
      this.bump();
      this.eat_while((c) => is_id_continue(c) || c === C_MINUS || c === C_DOT);
    }

    this.eat_while((ch) => ch !== C_NL && is_horizontal_whitespace(ch));
    const invalid_infostring = this.first() !== C_NL;

    let found = false;
    const nl_fence_pattern = "\n" + "-".repeat(length_opening);
    const closing = this.as_str().find(nl_fence_pattern);
    if (closing !== undefined) {
      // candidate found
      this.bump_bytes(closing + nl_fence_pattern.length);
      // in case like
      // ---cargo
      // --- blahblah
      // or
      // ---cargo
      // ----
      // combine those stuff into this frontmatter token such that it gets detected later.
      this.eat_until(0x0a);
      found = true;
    }

    if (!found) {
      // recovery strategy: a closing statement might have preceding whitespace/newline
      // but not have enough dashes to properly close. In this case, we eat until there,
      // and report a mismatch in the parser.
      let rest = this.as_str();
      // We can look for a shorter closing (starting with four dashes but closing with three)
      // and other indications that Rust has started and the infostring has ended.
      const dashes = rest.find("\n---");
      let potential_closing =
        // n.b. only in the case where there are dashes, we move the index to the line where
        // the dashes start as we eat to include that line. For other cases those are Rust code
        // and not included in the frontmatter.
        (dashes !== undefined ? dashes + 1 : undefined) ?? rest.find("\nuse ") ?? rest.find("\n//!") ?? rest.find("\n#![");

      if (potential_closing === undefined) {
        // a less fortunate recovery if all else fails which finds any dashes preceded by whitespace
        // on a standalone line. Might be wrong.
        let base_index = 0;
        for (;;) {
          const closing = rest.find("---");
          if (closing === undefined) break;
          const nl = rest.slice(0, closing).rfind("\n");
          const preceding_chars_start = nl === undefined ? 0 : nl + 1;
          let all_ws = true;
          const chars = rest.slice(preceding_chars_start, closing).chars();
          for (let c = chars.next(); c !== undefined; c = chars.next()) {
            if (!is_horizontal_whitespace(c)) {
              all_ws = false;
              break;
            }
          }
          if (all_ws) {
            // candidate found
            potential_closing = closing + base_index;
            break;
          } else {
            rest = rest.slice(closing + 3);
            base_index += closing + 3;
          }
        }
      }

      if (potential_closing !== undefined) {
        // bump to the potential closing, and eat everything on that line.
        this.bump_bytes(potential_closing);
        this.eat_until(0x0a);
      } else {
        // eat everything. this will get reported as an unclosed frontmatter.
        this.eat_while((_) => true);
      }
    }

    return { $: "Frontmatter", has_invalid_preceding_whitespace, invalid_infostring };
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:784 line_comment
  line_comment(): TokenKind {
    // debug_assert!(self.prev() == '/' && self.first() == '/');
    this.bump();

    let doc_style: DocStyle | undefined;
    const first = this.first();
    // `//!` is an inner line doc comment.
    if (first === C_BANG) doc_style = DocStyle.Inner;
    // `////` (more than 3 slashes) is not considered a doc comment.
    else if (first === C_SLASH && this.second() !== C_SLASH) doc_style = DocStyle.Outer;
    else doc_style = undefined;

    this.eat_until(0x0a);
    return { $: "LineComment", doc_style };
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:800 block_comment
  block_comment(): TokenKind {
    // debug_assert!(self.prev() == '/' && self.first() == '*');
    this.bump();

    let doc_style: DocStyle | undefined;
    const first = this.first();
    // `/*!` is an inner block doc comment.
    if (first === C_BANG) doc_style = DocStyle.Inner;
    // `/***` (more than 2 stars) is not considered a doc comment.
    // `/**/` is not considered a doc comment.
    else if (first === C_STAR && !(this.second() === C_STAR || this.second() === C_SLASH)) doc_style = DocStyle.Outer;
    else doc_style = undefined;

    let depth = 1;
    for (let c = this.bump(); c !== undefined; c = this.bump()) {
      if (c === C_SLASH && this.first() === C_STAR) {
        this.bump();
        depth += 1;
      } else if (c === C_STAR && this.first() === C_SLASH) {
        this.bump();
        depth -= 1;
        if (depth === 0) {
          // This block comment is closed, so for a construction like "/* */ */"
          // there will be a successfully parsed block comment "/* */"
          // and " */" will be processed separately.
          break;
        }
      }
    }

    return { $: "BlockComment", doc_style, terminated: depth === 0 };
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:837 whitespace
  whitespace(): TokenKind {
    // debug_assert!(is_whitespace(self.prev()));
    this.eat_while(is_whitespace);
    return TokenKind.Whitespace;
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:843 ident_or_unknown_prefix
  ident_or_unknown_prefix(): TokenKind {
    // debug_assert!(is_id_start(self.prev()));
    // Start is already eaten, eat the rest of identifier.
    this.eat_while(is_id_continue);
    // Known prefixes must have been handled earlier. So if
    // we see a prefix here, it is definitely an unknown prefix.
    const c = this.first();
    if (c === C_HASH || c === C_DQUOTE || c === C_SQUOTE) return TokenKind.UnknownPrefix;
    if (!is_ascii(c) && is_emoji_char(c)) return this.invalid_ident();
    return TokenKind.Ident;
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:856 invalid_ident
  invalid_ident(): TokenKind {
    // Start is already eaten, eat the rest of identifier.
    this.eat_while((c) => {
      const ZERO_WIDTH_JOINER = 0x200d;
      return is_id_continue(c) || (!is_ascii(c) && is_emoji_char(c)) || c === ZERO_WIDTH_JOINER;
    });
    // An invalid identifier followed by '#' or '"' or '\'' could be
    // interpreted as an invalid literal prefix. We don't bother doing that
    // because the treatment of invalid identifiers and invalid prefixes
    // would be the same.
    return TokenKind.InvalidIdent;
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:869 c_or_byte_string
  c_or_byte_string(
    mk_kind: (terminated: boolean) => LiteralKind,
    mk_kind_raw: (n_hashes: number | undefined) => LiteralKind,
    single_quoted: ((terminated: boolean) => LiteralKind) | undefined,
  ): TokenKind {
    const first = this.first();
    const second = this.second();
    if (first === C_SQUOTE && single_quoted !== undefined) {
      this.bump();
      const terminated = this.single_quoted_string();
      const suffix_start = this.pos_within_token();
      if (terminated) {
        this.eat_literal_suffix();
      }
      const kind = single_quoted(terminated);
      return { $: "Literal", kind, suffix_start };
    } else if (first === C_DQUOTE) {
      this.bump();
      const terminated = this.double_quoted_string();
      const suffix_start = this.pos_within_token();
      if (terminated) {
        this.eat_literal_suffix();
      }
      const kind = mk_kind(terminated);
      return { $: "Literal", kind, suffix_start };
    } else if (first === C_r && (second === C_DQUOTE || second === C_HASH)) {
      this.bump();
      const res = this.raw_double_quoted_string(2);
      const suffix_start = this.pos_within_token();
      if (res.$ === "Ok") {
        this.eat_literal_suffix();
      }
      const kind = mk_kind_raw(ok(res));
      return { $: "Literal", kind, suffix_start };
    } else {
      return this.ident_or_unknown_prefix();
    }
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:910 number
  number(first_digit: number): LiteralKind {
    // debug_assert!('0' <= self.prev() && self.prev() <= '9');
    let base: Base = Base.Decimal;
    if (first_digit === C_0) {
      // Attempt to parse encoding base.
      const first = this.first();
      if (first === ch("b")) {
        base = Base.Binary;
        this.bump();
        if (!this.eat_decimal_digits()) {
          return { $: "Int", base, empty_int: true };
        }
      } else if (first === ch("o")) {
        base = Base.Octal;
        this.bump();
        if (!this.eat_decimal_digits()) {
          return { $: "Int", base, empty_int: true };
        }
      } else if (first === ch("x")) {
        base = Base.Hexadecimal;
        this.bump();
        if (!this.eat_hexadecimal_digits()) {
          return { $: "Int", base, empty_int: true };
        }
      }
      // Not a base prefix; consume additional digits.
      else if ((first >= C_0 && first <= C_9) || first === C_UNDERSCORE) {
        this.eat_decimal_digits();
      }
      // Also not a base prefix; nothing more to do here.
      else if (first === C_DOT || first === C_e || first === C_E) {
      }
      // Just a 0.
      else {
        return { $: "Int", base, empty_int: false };
      }
    } else {
      // No base prefix, parse number in the usual way.
      this.eat_decimal_digits();
    }

    const first = this.first();
    // Don't be greedy if this is actually an
    // integer literal followed by field/method access or a range pattern
    // (`0..2` and `12.foo()`)
    if (first === C_DOT && this.second() !== C_DOT && !is_id_start(this.second())) {
      // might have stuff after the ., and if it does, it needs to start
      // with a number
      this.bump();
      let empty_exponent = false;
      if (is_ascii_digit(this.first())) {
        this.eat_decimal_digits();
        const f = this.first();
        if (f === C_e || f === C_E) {
          this.bump();
          empty_exponent = !this.eat_float_exponent();
        }
      }
      return { $: "Float", base, empty_exponent };
    } else if (first === C_e || first === C_E) {
      this.bump();
      const empty_exponent = !this.eat_float_exponent();
      return { $: "Float", base, empty_exponent };
    } else {
      return { $: "Int", base, empty_int: false };
    }
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:983 lifetime_or_char
  lifetime_or_char(): TokenKind {
    // debug_assert!(self.prev() == '\'');

    let can_be_a_lifetime: boolean;
    if (this.second() === C_SQUOTE) {
      // It's surely not a lifetime.
      can_be_a_lifetime = false;
    } else {
      // If the first symbol is valid for identifier, it can be a lifetime.
      // Also check if it's a number for a better error reporting (so '0 will
      // be reported as invalid lifetime and not as unterminated char literal).
      can_be_a_lifetime = is_id_start(this.first()) || is_ascii_digit(this.first());
    }

    if (!can_be_a_lifetime) {
      const terminated = this.single_quoted_string();
      const suffix_start = this.pos_within_token();
      if (terminated) {
        this.eat_literal_suffix();
      }
      const kind: LiteralKind = { $: "Char", terminated };
      return { $: "Literal", kind, suffix_start };
    }

    if (this.first() === C_r && this.second() === C_HASH && is_id_start(this.third())) {
      // Eat "r" and `#`, and identifier start characters.
      this.bump();
      this.bump();
      this.bump();
      this.eat_while(is_id_continue);
      return TokenKind.RawLifetime;
    }

    // Either a lifetime or a character literal with
    // length greater than 1.
    const starts_with_number = is_ascii_digit(this.first());

    // Skip the literal contents.
    // First symbol can be a number (which isn't a valid identifier start),
    // so skip it without any checks.
    this.bump();
    this.eat_while(is_id_continue);

    const first = this.first();
    // Check if after skipping literal contents we've met a closing
    // single quote (which means that user attempted to create a
    // string with single quotes).
    if (first === C_SQUOTE) {
      this.bump();
      const kind: LiteralKind = { $: "Char", terminated: true };
      return { $: "Literal", kind, suffix_start: this.pos_within_token() };
    } else if (first === C_HASH && !starts_with_number) {
      return TokenKind.UnknownPrefixLifetime;
    } else {
      return { $: "Lifetime", starts_with_number };
    }
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:1039 single_quoted_string
  single_quoted_string(): boolean {
    // debug_assert!(self.prev() == '\'');
    // Check if it's a one-symbol literal.
    if (this.second() === C_SQUOTE && this.first() !== C_BSLASH) {
      this.bump();
      this.bump();
      return true;
    }

    // Literal has more than one symbol.

    // Parse until either quotes are terminated or error is detected.
    for (;;) {
      const c = this.first();
      // Quotes are terminated, finish parsing.
      if (c === C_SQUOTE) {
        this.bump();
        return true;
      }
      // Probably beginning of the comment, which we don't want to include
      // to the error report.
      else if (c === C_SLASH) break;
      // Newline without following '\'' means unclosed quote, stop parsing.
      else if (c === C_NL && this.second() !== C_SQUOTE) break;
      // End of file, stop parsing.
      else if (c === EOF_CHAR && this.is_eof()) break;
      // Escaped slash is considered one character, so bump twice.
      else if (c === C_BSLASH) {
        this.bump();
        this.bump();
      }
      // Skip the character.
      else {
        this.bump();
      }
    }
    // String was not terminated.
    return false;
  }

  /// Eats double-quoted string and returns true
  /// if string is terminated.
  // rustc: compiler/rustc_lexer/src/lib.rs:1082 double_quoted_string
  double_quoted_string(): boolean {
    // debug_assert!(self.prev() == '"');
    for (let c = this.bump(); c !== undefined; c = this.bump()) {
      if (c === C_DQUOTE) {
        return true;
      } else if (c === C_BSLASH && (this.first() === C_BSLASH || this.first() === C_DQUOTE)) {
        // Bump again to skip escaped character.
        this.bump();
      }
    }
    // End of file reached.
    return false;
  }

  /// Attempt to lex for a guarded string literal.
  ///
  /// Used by `rustc_parse::lexer` to lex for guarded strings
  /// conditionally based on edition.
  ///
  /// Note: this will not reset the `Cursor` when a
  /// guarded string is not found. It is the caller's
  /// responsibility to do so.
  // rustc: compiler/rustc_lexer/src/lib.rs:1108 guarded_double_quoted_string
  guarded_double_quoted_string(): GuardedStr | undefined {
    // debug_assert!(self.prev() != '#');

    let n_start_hashes = 0;
    while (this.first() === C_HASH) {
      n_start_hashes += 1;
      this.bump();
    }

    if (this.first() !== C_DQUOTE) {
      return undefined;
    }
    this.bump();
    // debug_assert!(self.prev() == '"');

    // Lex the string itself as a normal string literal
    // so we can recover that for older editions later.
    const terminated = this.double_quoted_string();
    if (!terminated) {
      const token_len = this.pos_within_token();
      this.reset_pos_within_token();

      return { n_hashes: n_start_hashes, terminated: false, token_len };
    }

    // Consume closing '#' symbols.
    // Note that this will not consume extra trailing `#` characters:
    // `###"abcde"####` is lexed as a `GuardedStr { n_end_hashes: 3, .. }`
    // followed by a `#` token.
    let n_end_hashes = 0;
    while (this.first() === C_HASH && n_end_hashes < n_start_hashes) {
      n_end_hashes += 1;
      this.bump();
    }

    // Reserved syntax, always an error, so it doesn't matter if
    // `n_start_hashes != n_end_hashes`.

    this.eat_literal_suffix();

    const token_len = this.pos_within_token();
    this.reset_pos_within_token();

    return { n_hashes: n_start_hashes, terminated: true, token_len };
  }

  /// Eats the double-quoted string and returns `n_hashes` and an error if encountered.
  // rustc: compiler/rustc_lexer/src/lib.rs:1155 raw_double_quoted_string
  raw_double_quoted_string(prefix_len: number): Result<number, RawStrError> {
    // Wrap the actual function to handle the error with too many hashes.
    // This way, it eats the whole raw string.
    const r = this.raw_string_unvalidated(prefix_len);
    if (r.$ === "Err") return r;
    const n_hashes = r._0;
    // Only up to 255 `#`s are allowed in raw strings
    if (n_hashes <= 255) {
      return Ok(n_hashes);
    } else {
      return Err({ $: "TooManyDelimiters", found: n_hashes });
    }
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:1166 raw_string_unvalidated
  raw_string_unvalidated(prefix_len: number): Result<number, RawStrError> {
    // debug_assert!(self.prev() == 'r');
    const start_pos = this.pos_within_token();
    let possible_terminator_offset: number | undefined = undefined;
    let max_hashes = 0;

    // Count opening '#' symbols.
    let eaten = 0;
    while (this.first() === C_HASH) {
      eaten += 1;
      this.bump();
    }
    const n_start_hashes = eaten;

    // Check that string is started.
    const c = this.bump();
    if (c !== C_DQUOTE) {
      return Err({ $: "InvalidStarter", bad_char: c ?? EOF_CHAR });
    }

    // Skip the string contents and on each '#' character met, check if this is
    // a raw string termination.
    for (;;) {
      this.eat_until(0x22);

      if (this.is_eof()) {
        return Err({
          $: "NoTerminator",
          expected: n_start_hashes,
          found: max_hashes,
          possible_terminator_offset,
        });
      }

      // Eat closing double quote.
      this.bump();

      // Check that amount of closing '#' symbols
      // is equal to the amount of opening ones.
      // Note that this will not consume extra trailing `#` characters:
      // `r###"abcde"####` is lexed as a `RawStr { n_hashes: 3 }`
      // followed by a `#` token.
      let n_end_hashes = 0;
      while (this.first() === C_HASH && n_end_hashes < n_start_hashes) {
        n_end_hashes += 1;
        this.bump();
      }

      if (n_end_hashes === n_start_hashes) {
        return Ok(n_start_hashes);
      } else if (n_end_hashes > max_hashes) {
        // Keep track of possible terminators to give a hint about
        // where there might be a missing terminator
        possible_terminator_offset = this.pos_within_token() - start_pos - n_end_hashes + prefix_len;
        max_hashes = n_end_hashes;
      }
    }
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:1228 eat_decimal_digits
  eat_decimal_digits(): boolean {
    let has_digits = false;
    for (;;) {
      const c = this.first();
      if (c === C_UNDERSCORE) {
        this.bump();
      } else if (c >= C_0 && c <= C_9) {
        has_digits = true;
        this.bump();
      } else {
        break;
      }
    }
    return has_digits;
  }

  // rustc: compiler/rustc_lexer/src/lib.rs:1245 eat_hexadecimal_digits
  eat_hexadecimal_digits(): boolean {
    let has_digits = false;
    for (;;) {
      const c = this.first();
      if (c === C_UNDERSCORE) {
        this.bump();
      } else if ((c >= C_0 && c <= C_9) || (c >= ch("a") && c <= ch("f")) || (c >= ch("A") && c <= ch("F"))) {
        has_digits = true;
        this.bump();
      } else {
        break;
      }
    }
    return has_digits;
  }

  /// Eats the float exponent. Returns true if at least one digit was met,
  /// and returns false otherwise.
  // rustc: compiler/rustc_lexer/src/lib.rs:1264 eat_float_exponent
  eat_float_exponent(): boolean {
    // debug_assert!(self.prev() == 'e' || self.prev() == 'E');
    if (this.first() === C_MINUS || this.first() === C_PLUS) {
      this.bump();
    }
    return this.eat_decimal_digits();
  }

  // Eats the suffix of the literal, e.g. "u8".
  // rustc: compiler/rustc_lexer/src/lib.rs:1273 eat_literal_suffix
  eat_literal_suffix(): void {
    this.eat_identifier();
  }

  // Eats the identifier. Note: succeeds on `_`, which isn't a valid
  // identifier.
  // rustc: compiler/rustc_lexer/src/lib.rs:1279 eat_identifier
  eat_identifier(): void {
    if (!is_id_start(this.first())) {
      return;
    }
    this.bump();

    this.eat_while(is_id_continue);
  }
}

const EOF_CHAR = 0;

// PORT: the one-symbol arms of `advance_token`'s match, as a lookup table. They are
// checked after every arm that could overlap them (`/`, `#`, `'`, `"`), as in Rust.
const ONE_SYMBOL_TOKENS: ReadonlyMap<number, TokenKind> = new Map<number, TokenKind>([
  [ch(";"), TokenKind.Semi],
  [ch(","), TokenKind.Comma],
  [ch("."), TokenKind.Dot],
  [ch("("), TokenKind.OpenParen],
  [ch(")"), TokenKind.CloseParen],
  [ch("{"), TokenKind.OpenBrace],
  [ch("}"), TokenKind.CloseBrace],
  [C_OPEN_BRACKET, TokenKind.OpenBracket],
  [ch("]"), TokenKind.CloseBracket],
  [ch("@"), TokenKind.At],
  [C_HASH, TokenKind.Pound],
  [ch("~"), TokenKind.Tilde],
  [ch("?"), TokenKind.Question],
  [ch(":"), TokenKind.Colon],
  [ch("$"), TokenKind.Dollar],
  [ch("="), TokenKind.Eq],
  [C_BANG, TokenKind.Bang],
  [ch("<"), TokenKind.Lt],
  [ch(">"), TokenKind.Gt],
  [C_MINUS, TokenKind.Minus],
  [ch("&"), TokenKind.And],
  [ch("|"), TokenKind.Or],
  [C_PLUS, TokenKind.Plus],
  [C_STAR, TokenKind.Star],
  [ch("^"), TokenKind.Caret],
  [ch("%"), TokenKind.Percent],
]);
