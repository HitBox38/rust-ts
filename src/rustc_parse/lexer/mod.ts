// Port of compiler/rustc_parse/src/lexer/mod.rs.
//
// PORT: module layout. `mod tokentrees;` adds methods to `Lexer` (tokentrees.ts, an extension
// module per PORTING §5 "Methods defined in another file"); this module must not import it, so
// the crate root (src/rustc_parse/lib.ts) imports `./lexer/mod.ts` and then `./lexer/tokentrees.ts`
// for its side effects. Consumers go through lib.ts (`import { lexer } from ".../rustc_parse/lib.ts"`).
// `mod diagnostics;` is lexer/diagnostics.ts; `mod unicode_chars;` and
// `mod unescape_error_reporting;` belong to the lexer-aux lane (see the pending shims below).
//
// PORT: `debug!` (tracing) calls are dropped: rustc ships with them compiled out of release builds'
// default log level and they have no observable effect.
import { ast, token, type tokenstream } from "../../rustc_ast/lib.ts";
import { TEXT_FLOW_CONTROL_CHARS, contains_text_flow_control_chars } from "../../rustc_ast/util/unicode.ts";
import {
  Applicability,
  type Diag,
  type DiagCtxtHandle,
  E0748,
  E0758,
  E0762,
  E0763,
  E0765,
  E0766,
  E0767,
  type ErrorGuaranteed,
  StashKey,
} from "../../rustc_errors/lib.ts";
import * as rustc_lexer from "../../rustc_lexer/lib.ts";
import { Base, Cursor, type DocStyle, FrontmatterAllowed, type LiteralKind, is_horizontal_whitespace } from "../../rustc_lexer/lib.ts";
import {
  RUST_2021_PREFIXES_INCOMPATIBLE_SYNTAX,
  RUST_2024_GUARDED_STRING_INCOMPATIBLE_SYNTAX,
  TEXT_DIRECTION_CODEPOINT_IN_COMMENT,
  TEXT_DIRECTION_CODEPOINT_IN_LITERAL,
} from "../../rustc_lint_defs/builtin.ts";
import { EscapeError, Mode, check_for_errors } from "../../vendor/rustc_literal_escaper/lib.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { BytePos, debug_Span, Span } from "../../rustc_span/lib.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { len_utf8, to_digit } from "../../std/char.ts";
import { debug_char, debug_option, debug_struct, type Debug } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import { type Result, Err, Ok } from "../../std/result.ts";
import { Str, str_chars_count, str_find_char, str_rfind_char } from "../../std/str.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import * as diagnostics from "../diagnostics.ts";
import { TokenTreeDiagInfo, make_errors_for_mismatched_closing_delims } from "./diagnostics.ts";

type TokenKind = token.TokenKind;
type Token = token.Token;
type Delimiter = token.Delimiter;
type TokenStream = tokenstream.TokenStream;
const { Token } = token;

// ---------------------------------------------------------------------------------------------
// PORT: pending lexer-aux. `mod unicode_chars;` / `mod unescape_error_reporting;` and the
// `unicode-normalization` crate are ported by the lexer-aux lane. Until then these local shims
// stand in for them (same names and signatures); remove them and import the real modules:
//   import * as unicode_chars from "./unicode_chars.ts";
//   import { emit_unescape_error, escaped_char } from "./unescape_error_reporting.ts";
//   nfc_normalize: unicode_normalization `is_nfc_quick` / `IsNormalized` / `.nfc()`.
/** PORT: `std::ops::Range<usize>` of `emit_unescape_error`. */
export interface Range {
  start: number;
  end: number;
}
const unicode_chars = {
  // PORT: pending lexer-aux
  get UNICODE_ARRAY(): readonly (readonly [number, string, string])[] {
    return unported("rustc_parse::lexer::unicode_chars::UNICODE_ARRAY (pending lexer-aux)");
  },
  // PORT: pending lexer-aux
  check_for_substitution(
    _lexer: Lexer,
    _pos: BytePos,
    _ch: number,
    _count: number,
  ): [TokenKind | undefined, diagnostics.TokenSubstitution | undefined] {
    return unported("rustc_parse::lexer::unicode_chars::check_for_substitution (pending lexer-aux)");
  },
};
// PORT: pending lexer-aux
function emit_unescape_error(
  _dcx: DiagCtxtHandle,
  _lit: Str,
  _full_lit_span: Span,
  _err_span: Span,
  _mode: Mode,
  _range: Range,
  _error: EscapeError,
): ErrorGuaranteed | undefined {
  return unported("rustc_parse::lexer::unescape_error_reporting::emit_unescape_error (pending lexer-aux)");
}
// PORT: pending lexer-aux
function escaped_char(_c: number): string {
  return unported("rustc_parse::lexer::unescape_error_reporting::escaped_char (pending lexer-aux)");
}
// PORT: pending lexer-aux. `unicode_normalization::IsNormalized` and `is_nfc_quick`: the crate's
// `quick_check` (unicode-normalization-0.1.25/src/quick_check.rs:24) skips ASCII chars ("For ASCII
// we know it's always allowed and a starter"), so an all-ASCII input is exactly `Yes`; any
// other char needs the crate's tables.
type IsNormalized = "Yes" | "No" | "Maybe";
function is_nfc_quick(s: string): IsNormalized {
  let result: IsNormalized = "Yes";
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) <= 0x7f) continue;
    return unported("unicode_normalization::is_nfc_quick (non-ASCII; pending lexer-aux)");
  }
  return result;
}
// PORT: pending lexer-aux
function nfc(_s: string): string {
  return unported("unicode_normalization::UnicodeNormalization::nfc (pending lexer-aux)");
}

// This type is used a lot. Make sure it doesn't unintentionally get bigger.
//
// This assertion is in this crate, rather than in `rustc_lexer`, because that
// crate cannot depend on `rustc_data_structures`.
// PORT: `static_assert_size!(rustc_lexer::Token, 12)` has no TS equivalent.

const INVISIBLE_CHARACTERS: readonly number[] = [0x200b, 0x200c, 0x2060, 0x2061, 0x2062, 0x00ad, 0x034f, 0x061c];

const C_CR = 0x0d;
const C_NL = 0x0a;
const C_SQUOTE = 0x27;
const C_SLASH = 0x2f;
const C_STAR = 0x2a;
const C_UNDERSCORE = 0x5f;
const C_NBSP = 0x00a0;

/** `#[derive(Clone, Debug)]` */
export interface UnmatchedDelim {
  found_delim: Delimiter | undefined;
  found_span: Span;
  unclosed_span: Span | undefined;
  candidate_span: Span | undefined;
}
export const debug_UnmatchedDelim: Debug<UnmatchedDelim> = (v, f) =>
  debug_struct(f, "UnmatchedDelim", [
    ["found_delim", debug_option(v.found_delim, f, token.debug_Delimiter)],
    ["found_span", debug_Span(v.found_span, f)],
    ["unclosed_span", debug_option(v.unclosed_span, f, debug_Span)],
    ["candidate_span", debug_option(v.candidate_span, f, debug_Span)],
  ]);

/// Which tokens should be stripped before lexing the tokens.
export type StripTokens =
  /// Strip both shebang and frontmatter.
  | "ShebangAndFrontmatter"
  /// Strip the shebang but not frontmatter.
  ///
  /// That means that char sequences looking like frontmatter are simply
  /// interpreted as regular Rust lexemes.
  | "Shebang"
  /// Strip nothing.
  ///
  /// In other words, char sequences looking like a shebang or frontmatter
  /// are simply interpreted as regular Rust lexemes.
  | "Nothing";
export const StripTokens = { ShebangAndFrontmatter: "ShebangAndFrontmatter", Shebang: "Shebang", Nothing: "Nothing" } as const;

// rustc: compiler/rustc_parse/src/lexer/mod.rs:66 lex_token_trees
export function lex_token_trees(
  psess: ParseSess,
  src: Str,
  start_pos: BytePos,
  override_span: Span | undefined,
  strip_tokens: StripTokens,
): Result<TokenStream, Diag[]> {
  switch (strip_tokens) {
    case "Shebang":
    case "ShebangAndFrontmatter": {
      const shebang_len = rustc_lexer.strip_shebang(src);
      if (shebang_len !== undefined) {
        src = src.slice(shebang_len);
        start_pos = BytePos(start_pos + BytePos.from_usize(shebang_len));
      }
      break;
    }
    case "Nothing":
      break;
  }

  let frontmatter_allowed: FrontmatterAllowed;
  switch (strip_tokens) {
    case "ShebangAndFrontmatter":
      frontmatter_allowed = FrontmatterAllowed.Yes;
      break;
    case "Shebang":
    case "Nothing":
      frontmatter_allowed = FrontmatterAllowed.No;
      break;
  }

  const cursor = Cursor.new(src, frontmatter_allowed);
  const lexer = new Lexer(
    psess,
    start_pos,
    start_pos,
    src,
    cursor,
    override_span,
    false,
    undefined,
    Token.dummy(),
    TokenTreeDiagInfo.default(),
  );
  const res = lexer.lex_token_trees(/* is_delimited */ false);

  const unmatched_closing_delims: Diag[] = make_errors_for_mismatched_closing_delims(lexer.diag_info.unmatched_delims, psess);

  switch (res.$) {
    case "Ok": {
      if (unmatched_closing_delims.length === 0) {
        return Ok(res._0[1]);
      } else {
        // Return error if there are unmatched delimiters or unclosed delimiters.
        return Err(unmatched_closing_delims);
      }
    }
    case "Err": {
      // We emit delimiter mismatch errors first, then emit the unclosing delimiter mismatch
      // because the delimiter mismatch is more likely to be the root cause of error
      unmatched_closing_delims.push(res._0);
      return Err(unmatched_closing_delims);
    }
  }
}

export class Lexer {
  constructor(
    public psess: ParseSess,
    /// Initial position, read-only.
    public start_pos: BytePos,
    /// The absolute offset within the source_map of the current character.
    public pos: BytePos,
    /// Source text to tokenize.
    public src: Str,
    /// Cursor for getting lexer tokens.
    public cursor: Cursor,
    public override_span: Span | undefined,
    /// When a "unknown start of token: \u{a0}" has already been emitted earlier
    /// in this file, it's safe to treat further occurrences of the non-breaking
    /// space character as whitespace.
    public nbsp_is_whitespace: boolean,

    /// Track the `Span` for the leading `'` of the last lifetime. Used for
    /// diagnostics to detect possible typo where `"` was meant.
    public last_lifetime: Span | undefined,

    /// The current token.
    public token: Token,

    public diag_info: TokenTreeDiagInfo,
  ) {}

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:151 dcx
  dcx(): DiagCtxtHandle {
    return this.psess.dcx();
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:155 mk_sp
  mk_sp(lo: BytePos, hi: BytePos): Span {
    return this.override_span ?? Span.with_root_ctxt(lo, hi);
  }

  /// Returns the next token, paired with a bool indicating if the token was
  /// preceded by whitespace.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:161 next_token_from_cursor
  next_token_from_cursor(): [Token, boolean] {
    let preceded_by_whitespace = false;
    let swallow_next_invalid = 0;
    // Skip trivial (whitespace & comments) tokens
    for (;;) {
      const str_before = this.cursor.as_str();
      const token_ = this.cursor.advance_token();
      const start = this.pos;
      this.pos = BytePos(this.pos + token_.len);

      // debug!("next_token: {:?}({:?})", token.kind, self.str_from(start));

      const tk = token_.kind;
      if (
        tk.$ === "Semi" ||
        tk.$ === "LineComment" ||
        tk.$ === "BlockComment" ||
        tk.$ === "CloseParen" ||
        tk.$ === "CloseBrace" ||
        tk.$ === "CloseBracket"
      ) {
        // Heuristic: we assume that it is unlikely we're dealing with an unterminated
        // string surrounded by single quotes.
        this.last_lifetime = undefined;
      }

      // Now "cook" the token, converting the simple `rustc_lexer::TokenKind` enum into a
      // rich `rustc_ast::TokenKind`. This turns strings into interned symbols and runs
      // additional validation.
      let kind: TokenKind;
      switch (tk.$) {
        case "LineComment": {
          // Skip non-doc comments
          const doc_style = tk.doc_style;
          if (doc_style === undefined) {
            this.lint_unicode_text_flow(start);
            preceded_by_whitespace = true;
            continue;
          }

          // Opening delimiter of the length 3 is not included into the symbol.
          const content_start = BytePos(start + 3);
          const content = this.str_from(content_start);
          this.lint_doc_comment_unicode_text_flow(start, content);
          kind = this.cook_doc_comment(content_start, content, "Line", doc_style);
          break;
        }
        case "BlockComment": {
          const terminated = tk.terminated;
          if (!terminated) {
            this.report_unterminated_block_comment(start, tk.doc_style);
          }

          // Skip non-doc comments
          const doc_style = tk.doc_style;
          if (doc_style === undefined) {
            this.lint_unicode_text_flow(start);
            preceded_by_whitespace = true;
            continue;
          }

          // Opening delimiter of the length 3 and closing delimiter of the length 2
          // are not included into the symbol.
          const content_start = BytePos(start + 3);
          const content_end = BytePos(this.pos - (terminated ? 2 : 0));
          const content = this.str_from_to(content_start, content_end);
          this.lint_doc_comment_unicode_text_flow(start, content);
          kind = this.cook_doc_comment(content_start, content, "Block", doc_style);
          break;
        }
        case "Frontmatter": {
          this.validate_frontmatter(start, tk.has_invalid_preceding_whitespace, tk.invalid_infostring);
          preceded_by_whitespace = true;
          continue;
        }
        case "Whitespace": {
          preceded_by_whitespace = true;
          continue;
        }
        case "Ident":
          kind = this.ident(start);
          break;
        case "RawIdent": {
          const sym_ = nfc_normalize(this.str_from(BytePos(start + 2)).toString());
          const span = this.mk_sp(start, this.pos);
          this.psess.symbol_gallery.insert(sym_, span);
          if (!Symbol.can_be_raw(sym_)) {
            this.dcx().emit_err(diagnostics.CannotBeRawIdent_diagnostic({ span, ident: sym_ }));
          }
          this.psess.raw_identifier_spans.push(span);
          kind = { $: "Ident", _0: sym_, _1: "Raw" };
          break;
        }
        case "ForcedKeywordIdent": {
          const span = this.mk_sp(start, this.pos);

          if (Edition.at_least_rust_2021(Span.edition(span))) {
            const sym_ = nfc_normalize(this.str_from(BytePos(start + 2)).toString());
            this.psess.symbol_gallery.insert(sym_, span);
            this.psess.gated_spans.gate(sym.forced_keywords, span);
            kind = { $: "Ident", _0: sym_, _1: "ForcedKeyword" };
          } else {
            // Reset the state so that only the `k` was consumed.
            this.pos = BytePos(start + 1);
            this.cursor = Cursor.new(str_before.slice(1), FrontmatterAllowed.No);

            this.psess.buffer_lint(
              RUST_2021_PREFIXES_INCOMPATIBLE_SYNTAX,
              span,
              ast.CRATE_NODE_ID,
              diagnostics.ReservedPrefixLint_diagnostic({
                subject: "this",
                kind: "forced keyword",
                edition: Edition.Edition2021,
                sugg: Span.shrink_to_hi(this.mk_sp(start, this.pos)),
              }),
            );
            kind = this.ident(start);
          }
          break;
        }
        case "UnknownPrefix": {
          this.report_unknown_prefix(start);
          kind = this.ident(start);
          break;
        }
        case "UnknownPrefixLifetime": {
          this.report_unknown_prefix(start);
          // Include the leading `'` in the real identifier, for macro
          // expansion purposes. See #12512 for the gory details of why
          // this is necessary.
          const lifetime_name = this.str_from(start);
          this.last_lifetime = this.mk_sp(start, BytePos(start + 1));
          const ident = Symbol.intern(lifetime_name.toString());
          kind = { $: "Lifetime", _0: ident, _1: "Normal" };
          break;
        }
        // PORT: the guarded `InvalidIdent if !UNICODE_ARRAY...` arm and the later
        // `Unknown | InvalidIdent` arm share one `case`: when the guard fails, control continues
        // into the `Unknown | InvalidIdent` body, exactly as the next matching arm would. The arms
        // in between match other variants only.
        case "InvalidIdent":
        case "Unknown": {
          if (
            tk.$ === "InvalidIdent" &&
            // Do not recover an identifier with emoji if the codepoint is a confusable
            // with a recoverable substitution token, like `➖`.
            !unicode_chars.UNICODE_ARRAY.some(([c, _, __]) => {
              const sym_ = this.str_from(start);
              return str_chars_count(sym_) === 1 && c === sym_.chars().next()!;
            })
          ) {
            const sym_ = nfc_normalize(this.str_from(start).toString());
            const span = this.mk_sp(start, this.pos);
            let spans = this.psess.bad_unicode_identifiers.get(sym_);
            if (spans === undefined) {
              spans = [];
              this.psess.bad_unicode_identifiers.set(sym_, spans);
            }
            spans.push(span);
            kind = { $: "Ident", _0: sym_, _1: "Normal" };
            break;
          }

          // rustc_lexer::TokenKind::Unknown | rustc_lexer::TokenKind::InvalidIdent => {
          // Don't emit diagnostics for sequences of the same invalid token
          if (swallow_next_invalid > 0) {
            swallow_next_invalid -= 1;
            continue;
          }
          const it = this.str_from_to_end(start).chars();
          const c = it.next()!;
          if (c === C_NBSP) {
            // If an error has already been reported on non-breaking
            // space characters earlier in the file, treat all
            // subsequent occurrences as whitespace.
            if (this.nbsp_is_whitespace) {
              preceded_by_whitespace = true;
              continue;
            }
            this.nbsp_is_whitespace = true;
          }
          let repeats = 0;
          for (let c1 = it.next(); c1 !== undefined && c1 === c; c1 = it.next()) repeats++;
          // FIXME: the lexer could be used to turn the ASCII version of unicode
          // homoglyphs, instead of keeping a table in `check_for_substitution`into the
          // token. Ideally, this should be inside `rustc_lexer`. However, we should
          // first remove compound tokens like `<<` from `rustc_lexer`, and then add
          // fancier error recovery to it, as there will be less overall work to do this
          // way.
          const [token__, sugg] = unicode_chars.check_for_substitution(this, start, c, repeats + 1);
          const span = this.mk_sp(start, BytePos(this.pos + BytePos.from_usize(repeats * len_utf8(c))));
          const escaped = escaped_char(c);
          const null_ = c === 0x00;
          const invisible = INVISIBLE_CHARACTERS.includes(c);
          let repeat: diagnostics.UnknownTokenRepeat | undefined;
          if (repeats > 0) {
            swallow_next_invalid = repeats;
            repeat = { repeats };
          } else {
            repeat = undefined;
          }
          this.dcx().emit_err(
            diagnostics.UnknownTokenStart_diagnostic({ span, escaped, sugg, null: null_, invisible, repeat }),
          );

          if (token__ !== undefined) {
            kind = token__;
          } else {
            preceded_by_whitespace = true;
            continue;
          }
          break;
        }
        // PORT: the guarded `Literal { kind: CStr | RawCStr, .. } if edition < 2021` arm and the
        // general `Literal { kind, suffix_start }` arm share one `case` (guard first, then the
        // general arm); the `GuardedStrPrefix` arm between them matches another variant.
        case "Literal": {
          const lk = tk.kind;
          let span: Span;
          // split up (raw) c string literals to an ident and a string literal when edition <
          // 2021.
          if ((lk.$ === "CStr" || lk.$ === "RawCStr") && ((span = this.mk_sp(start, this.pos)), !Edition.at_least_rust_2021(Span.edition(span)))) {
            let prefix_len: number;
            let kind_: string;
            switch (lk.$) {
              case "CStr":
                [prefix_len, kind_] = [1, "C string literal"];
                break;
              case "RawCStr":
                [prefix_len, kind_] = [2, "raw C string literal"];
                break;
              default:
                unreachable();
            }

            // reset the state so that only the prefix ("c" or "cr") was consumed.
            this.pos = BytePos(start + prefix_len);
            this.cursor = Cursor.new(str_before.slice(prefix_len), FrontmatterAllowed.No);

            this.psess.buffer_lint(
              RUST_2021_PREFIXES_INCOMPATIBLE_SYNTAX,
              span,
              ast.CRATE_NODE_ID,
              diagnostics.ReservedPrefixLint_diagnostic({
                subject: "this",
                kind: kind_,
                edition: Edition.Edition2021,
                sugg: Span.shrink_to_hi(this.mk_sp(start, this.pos)),
              }),
            );

            kind = this.ident(start);
            break;
          }

          // rustc_lexer::TokenKind::Literal { kind, suffix_start } => {
          const suffix_start = BytePos(start + tk.suffix_start);
          const [lit_kind, symbol] = this.cook_lexer_literal(start, suffix_start, lk);
          let suffix: Symbol | undefined;
          if (suffix_start < this.pos) {
            const string = this.str_from(suffix_start);
            if (string.len() === 1 && string.byte(0) === C_UNDERSCORE) {
              this.dcx().emit_err(diagnostics.UnderscoreLiteralSuffix_diagnostic({ span: this.mk_sp(suffix_start, this.pos) }));
              suffix = undefined;
            } else {
              suffix = Symbol.intern(string.toString());
            }
          } else {
            suffix = undefined;
          }
          this.lint_literal_unicode_text_flow(symbol, lit_kind, this.mk_sp(start, this.pos), "literal");
          kind = { $: "Literal", _0: token.Lit.new(lit_kind, symbol, suffix) };
          break;
        }
        case "GuardedStrPrefix":
          kind = this.maybe_report_guarded_str(start, str_before);
          break;
        case "Lifetime": {
          // Include the leading `'` in the real identifier, for macro
          // expansion purposes. See #12512 for the gory details of why
          // this is necessary.
          const lifetime_name = nfc_normalize(this.str_from(start).toString());
          this.last_lifetime = this.mk_sp(start, BytePos(start + 1));
          if (tk.starts_with_number) {
            const span = this.mk_sp(start, this.pos);
            this.dcx().struct_err("lifetimes cannot start with a number").with_span(span).stash(span, StashKey.LifetimeIsChar);
          }
          kind = { $: "Lifetime", _0: lifetime_name, _1: "Normal" };
          break;
        }
        case "RawLifetime": {
          this.last_lifetime = this.mk_sp(start, BytePos(start + 1));

          const ident_start = BytePos(start + 3);
          if (Span.at_least_rust_2021(this.mk_sp(start, ident_start))) {
            // If the raw lifetime is followed by \' then treat it a normal
            // lifetime followed by a \', which is to interpret it as a character
            // literal. In this case, it's always an invalid character literal
            // since the literal must necessarily have >3 characters (r#...) inside
            // of it, which is invalid.
            if (this.cursor.as_str().starts_with("'")) {
              const lit_span = this.mk_sp(start, BytePos(this.pos + 1));
              const contents = this.str_from_to(BytePos(start + 1), this.pos);
              if (
                emit_unescape_error(this.dcx(), contents, lit_span, lit_span, Mode.Char, { start: 0, end: contents.len() }, EscapeError.MoreThanOneChar) ===
                undefined
              ) {
                panic("expected error");
              }
            }

            const span = this.mk_sp(start, this.pos);

            const lifetime_name_without_tick = Symbol.intern(this.str_from(ident_start).toString());
            if (!Symbol.can_be_raw(lifetime_name_without_tick)) {
              this.dcx().emit_err(diagnostics.CannotBeRawLifetime_diagnostic({ span, ident: lifetime_name_without_tick }));
            }

            // Put the `'` back onto the lifetime name.
            let lifetime_name = "'";
            lifetime_name += Symbol.as_str(lifetime_name_without_tick);
            const sym_ = nfc_normalize(lifetime_name);

            // Make sure we mark this as a raw identifier.
            this.psess.raw_identifier_spans.push(span);

            kind = { $: "Lifetime", _0: sym_, _1: "Raw" };
          } else {
            // Reset the state so we just lex the `'r`.
            this.pos = BytePos(start + 2);
            this.cursor = Cursor.new(str_before.slice(2), FrontmatterAllowed.No);

            const prefix_span = this.mk_sp(start, this.pos);
            this.psess.buffer_lint(
              RUST_2021_PREFIXES_INCOMPATIBLE_SYNTAX,
              prefix_span,
              ast.CRATE_NODE_ID,
              diagnostics.ReservedPrefixLint_diagnostic({
                subject: "`r`",
                kind: "prefix",
                edition: Edition.Edition2021,
                sugg: Span.shrink_to_hi(prefix_span),
              }),
            );

            const lifetime_name = nfc_normalize(this.str_from(start).toString());
            kind = { $: "Lifetime", _0: lifetime_name, _1: "Normal" };
          }
          break;
        }
        case "Semi":
          kind = token.TokenKind.Semi;
          break;
        case "Comma":
          kind = token.TokenKind.Comma;
          break;
        case "Dot":
          kind = token.TokenKind.Dot;
          break;
        case "OpenParen":
          kind = token.TokenKind.OpenParen;
          break;
        case "CloseParen":
          kind = token.TokenKind.CloseParen;
          break;
        case "OpenBrace":
          kind = token.TokenKind.OpenBrace;
          break;
        case "CloseBrace":
          kind = token.TokenKind.CloseBrace;
          break;
        case "OpenBracket":
          kind = token.TokenKind.OpenBracket;
          break;
        case "CloseBracket":
          kind = token.TokenKind.CloseBracket;
          break;
        case "At":
          kind = token.TokenKind.At;
          break;
        case "Pound":
          kind = token.TokenKind.Pound;
          break;
        case "Tilde":
          kind = token.TokenKind.Tilde;
          break;
        case "Question":
          kind = token.TokenKind.Question;
          break;
        case "Colon":
          kind = token.TokenKind.Colon;
          break;
        case "Dollar":
          kind = token.TokenKind.Dollar;
          break;
        case "Eq":
          kind = token.TokenKind.Eq;
          break;
        case "Bang":
          kind = token.TokenKind.Bang;
          break;
        case "Lt":
          kind = token.TokenKind.Lt;
          break;
        case "Gt":
          kind = token.TokenKind.Gt;
          break;
        case "Minus":
          kind = token.TokenKind.Minus;
          break;
        case "And":
          kind = token.TokenKind.And;
          break;
        case "Or":
          kind = token.TokenKind.Or;
          break;
        case "Plus":
          kind = token.TokenKind.Plus;
          break;
        case "Star":
          kind = token.TokenKind.Star;
          break;
        case "Slash":
          kind = token.TokenKind.Slash;
          break;
        case "Caret":
          kind = token.TokenKind.Caret;
          break;
        case "Percent":
          kind = token.TokenKind.Percent;
          break;

        case "Eof":
          kind = token.TokenKind.Eof;
          break;
      }
      const span = this.mk_sp(start, this.pos);
      return [Token.new(kind, span), preceded_by_whitespace];
    }
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:523 ident
  ident(start: BytePos): TokenKind {
    const sym_ = nfc_normalize(this.str_from(start).toString());
    const span = this.mk_sp(start, this.pos);
    this.psess.symbol_gallery.insert(sym_, span);
    return { $: "Ident", _0: sym_, _1: "Normal" };
  }

  /// Detect usages of Unicode codepoints changing the direction of the text on screen and loudly
  /// complain about it.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:532 lint_unicode_text_flow
  lint_unicode_text_flow(start: BytePos): void {
    // Opening delimiter of the length 2 is not included into the comment text.
    const content_start = BytePos(start + 2);
    const content = this.str_from(content_start);
    if (contains_text_flow_control_chars(content.toString())) {
      const span = this.mk_sp(start, this.pos);
      this.psess.dyn_buffer_lint(TEXT_DIRECTION_CODEPOINT_IN_COMMENT, span, ast.CRATE_NODE_ID, (dcx, level) => {
        const spans: [number, Span][] = [];
        for (const [i, c] of char_indices(content)) {
          if (TEXT_FLOW_CONTROL_CHARS.includes(c)) {
            const lo = BytePos(Span.lo(span) + 2 + i);
            spans.push([c, Span.with_hi(Span.with_lo(span, lo), BytePos(lo + len_utf8(c)))]);
          }
        }
        const characters: diagnostics.UnicodeCharNoteSub[] = spans.map(([c, span]) => ({
          span,
          c_debug: debug_char(c),
        }));
        const suggestions: diagnostics.UnicodeTextFlowSuggestion | undefined =
          spans.length !== 0 ? { spans: spans.map(([_c, span]) => span) } : undefined;

        return diagnostics.UnicodeTextFlow_into_diag(
          {
            comment_span: span,
            characters,
            suggestions,
            num_codepoints: spans.length,
          },
          dcx,
          level,
        );
      });
    }
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:578 lint_doc_comment_unicode_text_flow
  lint_doc_comment_unicode_text_flow(start: BytePos, content: Str): void {
    if (contains_text_flow_control_chars(content.toString())) {
      this.report_text_direction_codepoint(content, this.mk_sp(start, this.pos), 0, false, true, "doc comment");
    }
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:591 lint_literal_unicode_text_flow
  lint_literal_unicode_text_flow(text: Symbol, lit_kind: token.LitKind, span: Span, label: string): void {
    if (!contains_text_flow_control_chars(Symbol.as_str(text))) {
      return;
    }
    let padding: number;
    let point_at_inner_spans: boolean;
    switch (lit_kind.$) {
      // account for `"` or `'`
      case "Str":
      case "Char":
        [padding, point_at_inner_spans] = [1, true];
        break;
      // account for `c"`
      case "CStr":
        [padding, point_at_inner_spans] = [2, true];
        break;
      // account for `r###"`
      case "StrRaw":
        [padding, point_at_inner_spans] = [lit_kind._0 + 2, true];
        break;
      // account for `cr###"`
      case "CStrRaw":
        [padding, point_at_inner_spans] = [lit_kind._0 + 3, true];
        break;
      // suppress bad literals.
      case "Err":
        return;
      // Be conservative just in case new literals do support these.
      default:
        [padding, point_at_inner_spans] = [0, false];
        break;
    }
    this.report_text_direction_codepoint(Str.from(Symbol.as_str(text)), span, padding, point_at_inner_spans, false, label);
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:625 report_text_direction_codepoint
  report_text_direction_codepoint(
    text: Str,
    span: Span,
    padding: number,
    point_at_inner_spans: boolean,
    is_doc_comment: boolean,
    label: string,
  ): void {
    // Obtain the `Span`s for each of the forbidden chars.
    const spans: [number, Span][] = [];
    for (const [i, c] of char_indices(text)) {
      if (TEXT_FLOW_CONTROL_CHARS.includes(c)) {
        const lo = BytePos(Span.lo(span) + i + padding);
        spans.push([c, Span.with_hi(Span.with_lo(span, lo), BytePos(lo + len_utf8(c)))]);
      }
    }

    const count = spans.length;
    const labels: diagnostics.HiddenUnicodeCodepointsDiagLabels | undefined = point_at_inner_spans
      ? { spans: spans.slice() }
      : undefined;
    const sub: diagnostics.HiddenUnicodeCodepointsDiagSub =
      point_at_inner_spans && spans.length !== 0 ? { $: "Escape", spans } : { $: "NoEscape", spans, is_doc_comment };

    this.psess.buffer_lint(
      TEXT_DIRECTION_CODEPOINT_IN_LITERAL,
      span,
      ast.CRATE_NODE_ID,
      diagnostics.HiddenUnicodeCodepointsDiag_diagnostic({
        label,
        count,
        span_label: span,
        labels,
        sub,
      }),
    );
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:671 validate_frontmatter
  validate_frontmatter(start: BytePos, has_invalid_preceding_whitespace: boolean, invalid_infostring: boolean): void {
    const s = this.str_from(start);
    const real_start = s.find("---")!;
    const frontmatter_opening_pos = BytePos(real_start + start);
    const real_s = s.slice(real_start);
    const within = str_trim_start_matches(real_s, (c) => c === 0x2d /* '-' */);
    const len_opening = real_s.len() - within.len();

    const frontmatter_opening_end_pos = BytePos(frontmatter_opening_pos + len_opening);
    if (has_invalid_preceding_whitespace) {
      const nl = s.slice(0, real_start).rfind("\n");
      const line_start = BytePos((nl === undefined ? 0 : nl + 1) + start);
      const span = this.mk_sp(line_start, frontmatter_opening_end_pos);
      const label_span = this.mk_sp(line_start, frontmatter_opening_pos);
      this.dcx().emit_err(
        diagnostics.FrontmatterInvalidOpeningPrecedingWhitespace_diagnostic({
          span,
          note_span: label_span,
        }),
      );
    }

    const line_end = str_find_char(real_s, C_NL) ?? real_s.len();
    if (invalid_infostring) {
      const span = this.mk_sp(frontmatter_opening_end_pos, BytePos(frontmatter_opening_pos + line_end));
      this.dcx().emit_err(diagnostics.FrontmatterInvalidInfostring_diagnostic({ span }));
    }

    const last_nl = str_rfind_char(real_s, C_NL);
    const last_line_start = last_nl === undefined ? line_end : last_nl + 1;

    const content = real_s.slice(line_end, last_line_start);
    const cr_offset = str_find_char(content, C_CR);
    if (cr_offset !== undefined) {
      const cr_pos = BytePos(start + (real_start + line_end + cr_offset));
      const span = this.mk_sp(cr_pos, BytePos(cr_pos + 1));
      this.dcx().emit_err(diagnostics.BareCrFrontmatter_diagnostic({ span }));
    }

    const last_line = real_s.slice(last_line_start);
    const last_line_trimmed = str_trim_start_matches(last_line, is_horizontal_whitespace);
    const last_line_start_pos = BytePos(frontmatter_opening_pos + last_line_start);

    const frontmatter_span = this.mk_sp(frontmatter_opening_pos, this.pos);
    this.psess.gated_spans.gate(sym.frontmatter, frontmatter_span);

    if (!last_line_trimmed.starts_with("---")) {
      const label_span = this.mk_sp(frontmatter_opening_pos, frontmatter_opening_end_pos);
      this.dcx().emit_err(
        diagnostics.FrontmatterUnclosed_diagnostic({
          span: frontmatter_span,
          note_span: label_span,
        }),
      );
      return;
    }

    if (last_line_trimmed.len() !== last_line.len()) {
      const line_end = BytePos(last_line_start_pos + last_line.len());
      const span = this.mk_sp(last_line_start_pos, line_end);
      const whitespace_end = BytePos(last_line_start_pos + (last_line.len() - last_line_trimmed.len()));
      const label_span = this.mk_sp(last_line_start_pos, whitespace_end);
      this.dcx().emit_err(
        diagnostics.FrontmatterInvalidClosingPrecedingWhitespace_diagnostic({
          span,
          note_span: label_span,
        }),
      );
    }

    const rest = str_trim_start_matches(last_line_trimmed, (c) => c === 0x2d /* '-' */);
    const len_close = last_line_trimmed.len() - rest.len();
    if (len_close !== len_opening) {
      const span = this.mk_sp(frontmatter_opening_pos, this.pos);
      const opening = this.mk_sp(frontmatter_opening_pos, frontmatter_opening_end_pos);
      const last_line_close_pos = BytePos(last_line_start_pos + len_close);
      const close = this.mk_sp(last_line_start_pos, last_line_close_pos);
      this.dcx().emit_err(
        diagnostics.FrontmatterLengthMismatch_diagnostic({
          span,
          opening,
          close,
          len_opening,
          len_close,
        }),
      );
    }

    // Only up to 255 `-`s are allowed in code fences
    if (len_opening > 0xff /* u8::try_from(len_opening).is_err() */) {
      this.dcx().emit_err(diagnostics.FrontmatterTooManyDashes_diagnostic({ len_opening }));
    }

    if (!str_trim_matches(rest, is_horizontal_whitespace).is_empty()) {
      const span = this.mk_sp(last_line_start_pos, this.pos);
      this.dcx().emit_err(diagnostics.FrontmatterExtraCharactersAfterClose_diagnostic({ span }));
    }
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:769 cook_doc_comment
  cook_doc_comment(content_start: BytePos, content: Str, comment_kind: token.CommentKind, doc_style: DocStyle): TokenKind {
    if (str_find_char(content, C_CR) !== undefined) {
      for (const [idx, c] of char_indices(content)) {
        if (c !== C_CR) continue;
        const span = this.mk_sp(BytePos(content_start + idx), BytePos(content_start + idx + 1));
        const block = comment_kind === "Block";
        this.dcx().emit_err(diagnostics.CrDocComment_diagnostic({ span, block }));
      }
    }

    let attr_style: ast.AttrStyle;
    switch (doc_style) {
      case "Outer":
        attr_style = ast.AttrStyle.Outer;
        break;
      case "Inner":
        attr_style = ast.AttrStyle.Inner;
        break;
    }

    return { $: "DocComment", _0: comment_kind, _1: attr_style, _2: Symbol.intern(content.toString()) };
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:795 cook_lexer_literal
  cook_lexer_literal(start: BytePos, end: BytePos, kind: LiteralKind): [token.LitKind, Symbol] {
    switch (kind.$) {
      case "Char": {
        if (!kind.terminated) {
          const err = this.dcx().struct_span_fatal(this.mk_sp(start, end), "unterminated character literal").with_code(E0762);
          const lt_sp = this.last_lifetime;
          if (lt_sp !== undefined) {
            err.multipart_suggestion(
              "if you meant to write a string literal, use double quotes",
              [
                [lt_sp, '"'],
                [this.mk_sp(start, BytePos(start + 1)), '"'],
              ],
              Applicability.MaybeIncorrect,
            );
          }
          err.emit();
        }
        return this.cook_quoted(token.LitKind.Char, Mode.Char, start, end, 1, 1); // ' '
      }
      case "Byte": {
        if (!kind.terminated) {
          this.dcx()
            .struct_span_fatal(this.mk_sp(BytePos(start + 1), end), "unterminated byte constant")
            .with_code(E0763)
            .emit();
        }
        return this.cook_quoted(token.LitKind.Byte, Mode.Byte, start, end, 2, 1); // b' '
      }
      case "Str": {
        if (!kind.terminated) {
          this.dcx().struct_span_fatal(this.mk_sp(start, end), "unterminated double quote string").with_code(E0765).emit();
        }
        return this.cook_quoted(token.LitKind.Str, Mode.Str, start, end, 1, 1); // " "
      }
      case "ByteStr": {
        if (!kind.terminated) {
          this.dcx()
            .struct_span_fatal(this.mk_sp(BytePos(start + 1), end), "unterminated double quote byte string")
            .with_code(E0766)
            .emit();
        }
        return this.cook_quoted(token.LitKind.ByteStr, Mode.ByteStr, start, end, 2, 1);
        // b" "
      }
      case "CStr": {
        if (!kind.terminated) {
          this.dcx().struct_span_fatal(this.mk_sp(BytePos(start + 1), end), "unterminated C string").with_code(E0767).emit();
        }
        return this.cook_quoted(token.LitKind.CStr, Mode.CStr, start, end, 2, 1); // c" "
      }
      case "RawStr": {
        const n_hashes = kind.n_hashes;
        if (n_hashes !== undefined) {
          const n = n_hashes;
          const kind_: token.LitKind = { $: "StrRaw", _0: n_hashes };
          return this.cook_quoted(kind_, Mode.RawStr, start, end, 2 + n, 1 + n);
          // r##" "##
        } else {
          return this.report_raw_str_error(start, 1);
        }
      }
      case "RawByteStr": {
        const n_hashes = kind.n_hashes;
        if (n_hashes !== undefined) {
          const n = n_hashes;
          const kind_: token.LitKind = { $: "ByteStrRaw", _0: n_hashes };
          return this.cook_quoted(kind_, Mode.RawByteStr, start, end, 3 + n, 1 + n);
          // br##" "##
        } else {
          return this.report_raw_str_error(start, 2);
        }
      }
      case "RawCStr": {
        const n_hashes = kind.n_hashes;
        if (n_hashes !== undefined) {
          const n = n_hashes;
          const kind_: token.LitKind = { $: "CStrRaw", _0: n_hashes };
          return this.cook_quoted(kind_, Mode.RawCStr, start, end, 3 + n, 1 + n);
          // cr##" "##
        } else {
          return this.report_raw_str_error(start, 2);
        }
      }
      case "Int": {
        const base = kind.base;
        let kind_: token.LitKind = token.LitKind.Integer;
        if (kind.empty_int) {
          const span = this.mk_sp(start, end);
          const guar = this.dcx().emit_err(diagnostics.NoDigitsLiteral_diagnostic({ span }));
          kind_ = { $: "Err", _0: guar };
        } else if (base === "Binary" || base === "Octal") {
          const base_ = rustc_lexer.Base_discriminant[base];
          const s = this.str_from_to(BytePos(start + 2), end);
          for (const [idx, c] of char_indices(s)) {
            const span = this.mk_sp(
              BytePos(start + BytePos.from_usize(2 + idx)),
              BytePos(start + BytePos.from_usize(2 + idx + len_utf8(c))),
            );
            if (c !== C_UNDERSCORE && to_digit(c, base_) === undefined) {
              const guar = this.dcx().emit_err(diagnostics.InvalidDigitLiteral_diagnostic({ span, base: base_ }));
              kind_ = { $: "Err", _0: guar };
            }
          }
        }
        return [kind_, this.symbol_from_to(start, end)];
      }
      case "Float": {
        let kind_: token.LitKind = token.LitKind.Float;
        if (kind.empty_exponent) {
          const span = this.mk_sp(start, this.pos);
          const guar = this.dcx().emit_err(diagnostics.EmptyExponentFloat_diagnostic({ span }));
          kind_ = { $: "Err", _0: guar };
        }
        let base: string | undefined;
        switch (kind.base) {
          case Base.Hexadecimal:
            base = "hexadecimal";
            break;
          case Base.Octal:
            base = "octal";
            break;
          case Base.Binary:
            base = "binary";
            break;
          default:
            base = undefined;
            break;
        }
        if (base !== undefined) {
          const span = this.mk_sp(start, end);
          const guar = this.dcx().emit_err(diagnostics.FloatLiteralUnsupportedBase_diagnostic({ span, base }));
          kind_ = { $: "Err", _0: guar };
        }
        return [kind_, this.symbol_from_to(start, end)];
      }
    }
  }

  // #[inline]
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:951 src_index
  src_index(pos: BytePos): number {
    return BytePos.to_usize(BytePos(pos - this.start_pos));
  }

  /// Slice of the source text from `start` up to but excluding `self.pos`,
  /// meaning the slice does not include the character `self.ch`.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:957 str_from
  str_from(start: BytePos): Str {
    return this.str_from_to(start, this.pos);
  }

  /// As symbol_from, with an explicit endpoint.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:962 symbol_from_to
  symbol_from_to(start: BytePos, end: BytePos): Symbol {
    // debug!("taking an ident from {:?} to {:?}", start, end);
    return Symbol.intern(this.str_from_to(start, end).toString());
  }

  /// Slice of the source text spanning from `start` up to but excluding `end`.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:968 str_from_to
  str_from_to(start: BytePos, end: BytePos): Str {
    return this.src.slice(this.src_index(start), this.src_index(end));
  }

  /// Slice of the source text spanning from `start` until the end
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:973 str_from_to_end
  str_from_to_end(start: BytePos): Str {
    return this.src.slice(this.src_index(start));
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:977 report_raw_str_error
  report_raw_str_error(start: BytePos, prefix_len: number): never {
    const r = rustc_lexer.validate_raw_str(this.str_from(start), prefix_len);
    if (r.$ === "Err") {
      const e = r._0;
      switch (e.$) {
        case "InvalidStarter":
          return this.report_non_started_raw_string(start, e.bad_char);
        case "NoTerminator":
          return this.report_unterminated_raw_string(start, e.expected, e.possible_terminator_offset, e.found);
        case "TooManyDelimiters":
          return this.report_too_many_hashes(start, e.found);
      }
    }
    return panic("no error found for supposedly invalid raw string literal");
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:991 report_non_started_raw_string
  report_non_started_raw_string(start: BytePos, bad_char: number): never {
    return this.dcx()
      .struct_span_fatal(
        this.mk_sp(start, this.pos),
        `found invalid character; only \`#\` is allowed in raw string delimitation: ${escaped_char(bad_char)}`,
      )
      .emit_fatal();
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:1003 report_unterminated_raw_string
  report_unterminated_raw_string(
    start: BytePos,
    n_hashes: number,
    possible_offset: number | undefined,
    found_terminators: number,
  ): never {
    const err = this.dcx().struct_span_fatal(this.mk_sp(start, start), "unterminated raw string");
    err.code(E0748);
    err.span_label(this.mk_sp(start, start), "unterminated raw string");

    if (n_hashes > 0) {
      err.note(`this raw string should be terminated with \`"${"#".repeat(n_hashes)}\``);
    }

    if (possible_offset !== undefined) {
      const lo = BytePos(start + possible_offset);
      const hi = BytePos(lo + found_terminators);
      const span = this.mk_sp(lo, hi);
      err.span_suggestion_verbose(span, "consider terminating the string here", "#".repeat(n_hashes), Applicability.MaybeIncorrect);
    }

    return err.emit_fatal();
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:1037 report_unterminated_block_comment
  report_unterminated_block_comment(start: BytePos, doc_style: DocStyle | undefined): never {
    const msg = doc_style !== undefined ? "unterminated block doc-comment" : "unterminated block comment";
    const last_bpos = this.pos;
    const err = this.dcx().struct_span_fatal(this.mk_sp(start, last_bpos), msg);
    err.code(E0758);
    const nested_block_comment_open_idxs: number[] = [];
    let last_nested_block_comment_idxs: [number, number] | undefined = undefined;
    const content_chars = [...char_indices(this.str_from(start))];

    for (let k = 0; k < content_chars.length; k++) {
      const [idx, current_char] = content_chars[k]!;
      const peeked = content_chars[k + 1];
      if (peeked !== undefined && peeked[1] === C_STAR && current_char === C_SLASH) {
        nested_block_comment_open_idxs.push(idx);
      } else if (peeked !== undefined && peeked[1] === C_SLASH && current_char === C_STAR) {
        const open_idx = nested_block_comment_open_idxs.pop();
        last_nested_block_comment_idxs = open_idx === undefined ? undefined : [open_idx, idx];
      }
    }

    if (last_nested_block_comment_idxs !== undefined) {
      const [nested_open_idx, nested_close_idx] = last_nested_block_comment_idxs;
      err
        .span_label(this.mk_sp(start, BytePos(start + 2)), msg)
        .span_label(
          this.mk_sp(BytePos(start + nested_open_idx), BytePos(start + nested_open_idx + 2)),
          "...as last nested comment starts here, maybe you want to close this instead?",
        )
        .span_label(
          this.mk_sp(BytePos(start + nested_close_idx), BytePos(start + nested_close_idx + 2)),
          "...and last nested comment terminates here.",
        );
    }

    return err.emit_fatal();
  }

  // RFC 3101 introduced the idea of (reserved) prefixes. As of Rust 2021,
  // using a (unknown) prefix is an error. In earlier editions, however, they
  // only result in a (allowed by default) lint, and are treated as regular
  // identifier tokens.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:1087 report_unknown_prefix
  report_unknown_prefix(start: BytePos): void {
    const prefix_span = this.mk_sp(start, this.pos);
    const prefix = this.str_from_to(start, this.pos).toString();
    const expn_data = SyntaxContext.outer_expn_data(Span.ctxt(prefix_span));

    if (Edition.at_least_rust_2021(expn_data.edition)) {
      // In Rust 2021, this is a hard error.
      let sugg: diagnostics.UnknownPrefixSugg | undefined;
      if (prefix === "rb") {
        sugg = { $: "UseBr", _0: prefix_span };
      } else if (prefix === "rc") {
        sugg = { $: "UseCr", _0: prefix_span };
      } else if (expn_data.is_root()) {
        let start_: Span | undefined;
        let end: Span;
        if (
          this.cursor.first() === C_SQUOTE &&
          (start_ = this.last_lifetime) !== undefined &&
          this.cursor.third() !== C_SQUOTE &&
          ((end = this.mk_sp(this.pos, BytePos(this.pos + 1))), true) &&
          !this.psess.source_map().is_multiline(Span.until(start_, end))
        ) {
          // FIXME: An "unclosed `char`" error will be emitted already in some cases,
          // but it's hard to silence this error while not also silencing important cases
          // too. We should use the error stashing machinery instead.
          sugg = { $: "MeantStr", start: start_, end: end! };
        } else {
          sugg = { $: "Whitespace", _0: Span.shrink_to_hi(prefix_span) };
        }
      } else {
        sugg = undefined;
      }
      this.dcx().emit_err(
        diagnostics.UnknownPrefix_diagnostic({
          span: prefix_span,
          prefix,
          sugg,
        }),
      );
    } else {
      // Before Rust 2021, only emit a lint for migration.
      this.psess.buffer_lint(
        RUST_2021_PREFIXES_INCOMPATIBLE_SYNTAX,
        prefix_span,
        ast.CRATE_NODE_ID,
        diagnostics.ReservedPrefixLint_diagnostic({
          subject: `\`${prefix}\``,
          kind: "prefix",
          edition: Edition.Edition2021,
          sugg: Span.shrink_to_hi(prefix_span),
        }),
      );
    }
  }

  /// Detect guarded string literal syntax
  ///
  /// RFC 3593 reserved this syntax for future use. As of Rust 2024,
  /// using this syntax produces an error. In earlier editions, however, it
  /// only results in an (allowed by default) lint, and is treated as
  /// separate tokens.
  // rustc: compiler/rustc_parse/src/lexer/mod.rs:1144 maybe_report_guarded_str
  maybe_report_guarded_str(start: BytePos, str_before: Str): TokenKind {
    const span = this.mk_sp(start, this.pos);
    const edition2024 = Span.at_least_rust_2024(span);

    const space_pos = BytePos(start + 1);
    const space_span = this.mk_sp(space_pos, space_pos);

    const cursor = Cursor.new(str_before, FrontmatterAllowed.No);

    let is_string: boolean;
    let span_: Span;
    let unterminated: BytePos | undefined;
    const guarded = cursor.guarded_double_quoted_string();
    if (guarded !== undefined) {
      const { n_hashes, terminated, token_len } = guarded;
      const end = BytePos(start + token_len);
      const span = this.mk_sp(start, end);
      const str_start = BytePos(start + n_hashes);

      if (edition2024) {
        this.cursor = cursor;
        this.pos = end;
      }

      const unterminated_ = terminated ? undefined : str_start;

      [is_string, span_, unterminated] = [true, span, unterminated_];
    } else {
      // We should only get here in the `##+` case.
      // debug_assert_eq!(self.str_from_to(start, start + BytePos(2)), "##");

      [is_string, span_, unterminated] = [false, span, undefined];
    }
    if (edition2024) {
      if (unterminated !== undefined) {
        const str_start = unterminated;
        // Only a fatal error if string is unterminated.
        this.dcx().struct_span_fatal(this.mk_sp(str_start, this.pos), "unterminated double quote string").with_code(E0765).emit();
      }

      const sugg: diagnostics.GuardedStringSugg | undefined = Span.from_expansion(span_) ? undefined : { _0: space_span };

      // In Edition 2024 and later, emit a hard error.
      const err = is_string
        ? this.dcx().emit_err(diagnostics.ReservedString_diagnostic({ span: span_, sugg }))
        : this.dcx().emit_err(diagnostics.ReservedMultihash_diagnostic({ span: span_, sugg }));

      return {
        $: "Literal",
        _0: token.Lit.new({ $: "Err", _0: err }, this.symbol_from_to(start, this.pos), undefined),
      };
    } else {
      // Before Rust 2024, only emit a lint for migration.
      this.psess.buffer_lint(
        RUST_2024_GUARDED_STRING_INCOMPATIBLE_SYNTAX,
        span_,
        ast.CRATE_NODE_ID,
        diagnostics.ReservedPrefixLint_diagnostic({
          subject: "this",
          kind: is_string ? "guarded string literal" : "reserved token",
          edition: Edition.Edition2024,
          sugg: space_span,
        }),
      );

      // For backwards compatibility, roll back to after just the first `#`
      // and return the `Pound` token.
      this.pos = BytePos(start + 1);
      this.cursor = Cursor.new(str_before.slice(1), FrontmatterAllowed.No);
      return token.TokenKind.Pound;
    }
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:1227 report_too_many_hashes
  report_too_many_hashes(start: BytePos, num: number): never {
    return this.dcx().emit_fatal(
      diagnostics.TooManyHashes_diagnostic({
        span: this.mk_sp(start, this.pos),
        num,
      }),
    );
  }

  // rustc: compiler/rustc_parse/src/lexer/mod.rs:1234 cook_quoted
  cook_quoted(
    kind: token.LitKind,
    mode: Mode,
    start: BytePos,
    end: BytePos,
    prefix_len: number,
    postfix_len: number,
  ): [token.LitKind, Symbol] {
    const content_start = BytePos(start + prefix_len);
    const content_end = BytePos(end - postfix_len);
    const lit_content = this.str_from_to(content_start, content_end);
    check_for_errors(lit_content, mode, (range_start, range_end, err) => {
      const span_with_quotes = this.mk_sp(start, end);
      const [start_, end_] = [range_start, range_end];
      const lo = BytePos(content_start + start_);
      const hi = BytePos(lo + (end_ - start_));
      const span = this.mk_sp(lo, hi);
      const is_fatal = EscapeError.is_fatal(err);
      const guar = emit_unescape_error(this.dcx(), lit_content, span_with_quotes, span, mode, { start: range_start, end: range_end }, err);
      if (guar !== undefined) {
        assert(is_fatal, "assertion failed: is_fatal");
        kind = { $: "Err", _0: guar };
      }
    });

    // We normally exclude the quotes for the symbol, but for errors we
    // include it because it results in clearer error messages.
    const sym_ = kind.$ !== "Err" ? Symbol.intern(lit_content.toString()) : this.symbol_from_to(start, end);
    return [kind, sym_];
  }
}

// rustc: compiler/rustc_parse/src/lexer/mod.rs:1278 nfc_normalize
export function nfc_normalize(string: string): Symbol {
  // use unicode_normalization::{IsNormalized, UnicodeNormalization, is_nfc_quick};
  switch (is_nfc_quick(string)) {
    case "Yes":
      return Symbol.intern(string);
    default: {
      const normalized_str: string = nfc(string);
      return Symbol.intern(normalized_str);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// PORT: local `str` helpers with Rust semantics (candidates for src/std/str.ts, root-owned).

/** `s.char_indices()` (byte offsets relative to `s`). */
function* char_indices(s: Str): Generator<[number, number]> {
  const chars = s.chars();
  for (let pos = chars.pos, c = chars.next(); c !== undefined; pos = chars.pos, c = chars.next()) {
    yield [pos - s.lo, c];
  }
}

/** `str::trim_start_matches(pred)` */
function str_trim_start_matches(s: Str, pred: (c: number) => boolean): Str {
  const chars = s.chars();
  for (let pos = chars.pos, c = chars.next(); c !== undefined; pos = chars.pos, c = chars.next()) {
    if (!pred(c)) return s.slice(pos - s.lo);
  }
  return s.slice(s.len());
}

/** `str::trim_matches(pred)` */
function str_trim_matches(s: Str, pred: (c: number) => boolean): Str {
  const t = str_trim_start_matches(s, pred);
  let end = 0;
  for (const [i, c] of char_indices(t)) {
    if (!pred(c)) end = i + len_utf8(c);
  }
  return t.slice(0, end);
}
