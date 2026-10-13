// Port of compiler/rustc_parse/src/parser/mod.rs
// Types are generated into mod.gen.ts (tools/codegen/types.ts, set `rustc_parse`); `Parser` itself is
// hand-written here (`hand` in the set) so that every parser file can augment it.
//
// PORT: `impl Parser` is spread over the parser files (PORTING §5 "Methods defined in another file").
// - Every method of every file is declared once, in `./decls.ts` (`declare module "./mod.ts"`).
// - Each file assigns its methods onto `Parser.prototype` (this file included, below the class).
// - Associated fns without `self` (`Parser::new` aside) are module-level functions of their file.
//
// PORT: init order. This module must never import a parser extension module (a file with an
// `impl Parser` block: attr, attr_wrapper, nonterminal, diagnostics, expr, ...) at runtime, not even
// through `export ... from`: those modules assign onto `Parser.prototype` when they are evaluated,
// so `Parser` must already exist. Runtime values from them come from their `.gen.ts` modules (enum
// companions, generated classes), whose statics/methods the extension module attaches later.
// `pub mod attr; pub mod asm; pub mod cfg_select;` and the `pub use` re-exports of extension
// modules are therefore not mirrored here: import those modules directly (rustc_parse/lib.ts loads
// all of them, in order).
//
// mod attr; mod attr_wrapper; mod diagnostics; mod expr; mod function; mod generics; mod item;
// mod nonterminal; mod pat; mod path; mod stmt; pub mod token_type; mod ty; pub mod asm; pub mod cfg_select;
import { ast, attr, token, tokenstream } from "../../rustc_ast/lib.ts";
import type { Token, TokenKind, IdentKind, MetaVarKind } from "../../rustc_ast/token.ts";
import type { HasAttrs, HasTokens } from "../../rustc_ast/ast_traits.ts";
import type { Spacing, TokenCursor, TokenTree, TokenStream } from "../../rustc_ast/tokenstream.ts";
import { Case } from "../../rustc_ast/util/case.ts";
import { expr_requires_semi_to_be_stmt } from "../../rustc_ast/util/classify.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { type Diag, type DiagCtxtHandle, FatalError, type PResult } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { is_lowercase, is_uppercase } from "../../std/char.ts";
import { debug_list, debug_str, type Fmt } from "../../std/fmt.ts";
import { assert, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import {
  IncorrectImplRestriction_diagnostic,
  IncorrectMutRestriction_diagnostic,
  IncorrectVisibilityRestriction_diagnostic,
  InvalidLiteralSuffixOnTupleIndex_diagnostic,
  KwBadCase_diagnostic,
  type Case as DiagCase,
  NonStringAbiLiteral_diagnostic,
  TokenDescription,
} from "../diagnostics.ts";
// PORT: init order (see above): `AttrWrapper`'s statics are attached by ./attr_wrapper.ts; this module
// only takes the generated class (typed with the full static surface, type-only import).
import * as attr_wrapper_gen from "./attr_wrapper.gen.ts";
import type { AttrWrapper as AttrWrapperFull, UsePreAttrPos } from "./attr_wrapper.ts";
import type { AttrWrapper } from "./attr_wrapper.ts";
import { PathStyle } from "./path.gen.ts";
import { exp, type ExpKeywordPair, type ExpTokenPair, TokenType, TokenTypeSet, clone_TokenTypeSet } from "./token_type.ts";
import * as gen from "./mod.gen.ts";
import {
  type CaptureState,
  type ClosureSpans,
  clone_CaptureState,
  clone_ClosureSpans,
  type FollowedByType,
  type ParsingRestrictionKind,
  Recovery,
  Restrictions,
} from "./mod.gen.ts";

export * from "./mod.gen.ts";
// pub mod token_type; (no `impl Parser`, safe to re-export)
export * as token_type from "./token_type.ts";
// pub use token_type::{ExpKeywordPair, ExpTokenPair, TokenType};
export { type ExpKeywordPair, type ExpTokenPair, TokenType } from "./token_type.ts";

const AttrWrapperC = attr_wrapper_gen.AttrWrapper as unknown as typeof AttrWrapperFull;

const { TokenKind: TK } = token;

// PORT: `Parser::new` (mod.rs:346) sits in the class body, ahead of mod.rs:295-329 (`SeqSep`, `token_descr`), because the class must declare its constructor (PORTING §8).
export class Parser {
  constructor(
    public psess: ParseSess,
    /// The current token.
    public token: Token,
    /// The spacing for the current token.
    public token_spacing: Spacing,
    /// The previous token.
    public prev_token: Token,
    public capture_cfg: boolean,
    public restrictions: Restrictions,
    public expected_token_types: TokenTypeSet,
    public token_cursor: TokenCursor,
    // The number of calls to `bump`, i.e. the position in the token stream.
    public num_bump_calls: number,
    // During parsing we may sometimes need to "unglue" a glued token into two
    // or three component tokens (e.g. `>>` into `>` and `>`, or `>>=` into `>`
    // and `>` and `=`), so the parser can consume them one at a time. This
    // process bypasses the normal capturing mechanism (e.g. `num_bump_calls`
    // will not be incremented), since the "unglued" tokens due not exist in
    // the original `TokenStream`.
    //
    // If we end up consuming all the component tokens, this is not an issue,
    // because we'll end up capturing the single "glued" token.
    //
    // However, sometimes we may want to capture not all of the original
    // token. For example, capturing the `Vec<u8>` in `Option<Vec<u8>>`
    // requires us to unglue the trailing `>>` token. The `break_last_token`
    // field is used to track these tokens. They get appended to the captured
    // stream when we evaluate a `LazyAttrTokenStream`.
    //
    // This value is always 0, 1, or 2. It can only reach 2 when splitting
    // `>>=` or `<<=`.
    public break_last_token: number,
    /// This field is used to keep track of how many left angle brackets we have seen. This is
    /// required in order to detect extra leading left angle brackets (`<` characters) and error
    /// appropriately.
    ///
    /// See the comments in the `parse_path_segment` function for more details.
    public unmatched_angle_bracket_count: number,
    public angle_bracket_nesting: number,
    /// Keep track of when we're within `<...>` for proper error recovery.
    public parsing_generics: boolean,
    public last_unexpected_token_span: Span | undefined,
    /// If present, this `Parser` is not parsing Rust code but rather a macro call.
    public subparser_name: string | undefined,
    public capture_state: CaptureState,
    /// This allows us to recover when the user forget to add braces around
    /// multiple statements in the closure body.
    public current_closure: ClosureSpans | undefined,
    /// Whether the parser is allowed to do recovery.
    /// This is disabled when parsing macro arguments, see #103534
    // PORT: field `recovery` is `recovery_`: the name clashes with the `pub fn recovery(self, ..)`
    // builder (private field renamed, like `ParseSess::dcx_`).
    public recovery_: Recovery,
    /// Whether we're parsing a function body.
    public in_fn_body: boolean,
    /// Whether we have detected a missing semicolon in function body.
    public fn_body_missing_semi_guar: ErrorGuaranteed | undefined,
  ) {}

  // rustc: compiler/rustc_parse/src/parser/mod.rs:346 new
  static new(psess: ParseSess, stream: TokenStream, subparser_name: string | undefined): Parser {
    // PORT: struct literal with `..` (default field values, `#![feature(default_field_values)]`):
    // the defaults are the field initializers of `struct Parser`.
    const parser = new Parser(
      psess,
      token.Token.dummy(),
      tokenstream.Spacing.Alone,
      token.Token.dummy(),
      false,
      Restrictions.empty(),
      TokenTypeSet.new(),
      tokenstream.TokenCursor.new(stream),
      0,
      0,
      0,
      0,
      false,
      undefined,
      subparser_name,
      {
        capturing: gen.Capturing.No,
        parser_replacements: [],
        inner_attr_parser_ranges: new Map(),
        // PORT: `IntervalSet::new(u32::MAX as usize)` -> `Set` (typemap.parse.json).
        seen_attrs: new Set(),
      },
      undefined,
      Recovery.Allowed,
      false,
      undefined,
    );

    // Make parser point to the first token.
    parser.bump();

    // Change this from 1 back to 0 after the bump. This eases debugging of
    // `Parser::collect_tokens` because 0-indexed token positions are nicer
    // than 1-indexed token positions.
    parser.num_bump_calls = 0;

    return parser;
  }
}

/** `#[derive(Clone)]` */
export function clone_Parser(v: Parser): Parser {
  return new Parser(
    v.psess,
    v.token,
    v.token_spacing,
    v.prev_token,
    v.capture_cfg,
    v.restrictions,
    clone_TokenTypeSet(v.expected_token_types),
    tokenstream.clone_TokenCursor(v.token_cursor),
    v.num_bump_calls,
    v.break_last_token,
    v.unmatched_angle_bracket_count,
    v.angle_bracket_nesting,
    v.parsing_generics,
    v.last_unexpected_token_span,
    v.subparser_name,
    clone_CaptureState(v.capture_state),
    v.current_closure === undefined ? undefined : clone_ClosureSpans(v.current_closure),
    v.recovery_,
    v.in_fn_body,
    v.fn_body_missing_semi_guar,
  );
}

// PORT: statics of the generated `SeqSep` class.
export const SeqSep = gen.SeqSep as typeof gen.SeqSep & {
  trailing_allowed: (sep: ExpTokenPair) => SeqSep;
  none: () => SeqSep;
};
export type SeqSep = gen.SeqSep;

// rustc: compiler/rustc_parse/src/parser/mod.rs:295 trailing_allowed
SeqSep.trailing_allowed = function (sep: ExpTokenPair): SeqSep {
  return new gen.SeqSep(sep, true);
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:299 none
SeqSep.none = function (): SeqSep {
  return new gen.SeqSep(undefined, false);
};

export type Trailing = gen.Trailing;
export const Trailing = {
  ...gen.Trailing,

  // impl From<bool> for Trailing
  // rustc: compiler/rustc_parse/src/parser/mod.rs:324 from
  from(b: boolean): Trailing {
    return b ? gen.Trailing.Yes : gen.Trailing.No;
  },
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:329 token_descr
export function token_descr(token_: Token): string {
  const s = pprust.token_to_string(token_);

  const d = TokenDescription.from_token(token_);
  const kind = token_.kind;
  if (d !== undefined && d.$ === "ReservedIdentifier") return `reserved identifier \`${s}\``;
  if (d !== undefined && d.$ === "Keyword") return `keyword \`${s}\``;
  if (d !== undefined && d.$ === "ReservedKeyword") return `reserved keyword \`${s}\``;
  if (d !== undefined && d.$ === "DocComment") return `doc comment \`${s}\``;
  // Deliberately doesn't print `s`, which is empty.
  if (d !== undefined && d.$ === "MetaVar") return `\`${token.display_MetaVarKind(d._0)}\` metavariable`;
  if (d === undefined && kind.$ === "NtIdent") return `identifier \`${s}\``;
  if (d === undefined && kind.$ === "NtLifetime") return `lifetime \`${s}\``;
  return `\`${s}\``;
}

// ---- impl<'a> Parser<'a> ----
// (`Parser::new`, mod.rs:346, is the static `Parser.new` in the class body above.)

// rustc: compiler/rustc_parse/src/parser/mod.rs:376 recovery
Parser.prototype.recovery = function (this: Parser, recovery: Recovery): Parser {
  this.recovery_ = recovery;
  return this;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:382 with_recovery
Parser.prototype.with_recovery = function <T>(this: Parser, recovery: Recovery, f: (this_: Parser) => T): T {
  const old = this.recovery_;
  this.recovery_ = recovery;
  const res = f(this);
  this.recovery_ = old;
  return res;
};

/// Whether the parser is allowed to recover from broken code.
///
/// If this returns false, recovering broken code into valid code (especially if this recovery does lookahead)
/// is not allowed. All recovery done by the parser must be gated behind this check.
///
/// Technically, this only needs to restrict eager recovery by doing lookahead at more tokens.
/// But making the distinction is very subtle, and simply forbidding all recovery is a lot simpler to uphold.
// rustc: compiler/rustc_parse/src/parser/mod.rs:397 may_recover
Parser.prototype.may_recover = function (this: Parser): boolean {
  return this.recovery_ === Recovery.Allowed;
};

/// Version of [`unexpected`](Parser::unexpected) that "returns" any type in the `Ok`
/// (both those functions never return "Ok", and so can lie like that in the type).
// rustc: compiler/rustc_parse/src/parser/mod.rs:403 unexpected_any
Parser.prototype.unexpected_any = function <T>(this: Parser): PResult<T> {
  const r = this.expect_one_of([], []);
  switch (r.$) {
    case "Err":
      return Err(r._0);
    // We can get `Ok(true)` from `recover_closing_delimiter`
    // which is called in `expected_one_of_not_found`.
    case "Ok":
      return new FatalError().raise();
  }
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:412 unexpected
Parser.prototype.unexpected = function (this: Parser): PResult<undefined> {
  return this.unexpected_any();
};

/// Expects and consumes the token `t`. Signals an error if the next token is not `t`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:417 expect
Parser.prototype.expect = function (this: Parser, exp_: ExpTokenPair): PResult<ast.Recovered> {
  if (this.expected_token_types.is_empty()) {
    if (this.token.eq(exp_.tok)) {
      this.bump();
      return Ok(ast.Recovered.No);
    } else {
      return Err(this.unexpected_err(exp_.tok));
    }
  } else {
    return this.expect_one_of([exp_], []);
  }
};

/// Expect next token to be edible or inedible token. If edible,
/// then consume it; if inedible, then return without consuming
/// anything. Signal a fatal error if next token is unexpected.
// rustc: compiler/rustc_parse/src/parser/mod.rs:433 expect_one_of
Parser.prototype.expect_one_of = function (
  this: Parser,
  edible: readonly ExpTokenPair[],
  inedible: readonly ExpTokenPair[],
): PResult<ast.Recovered> {
  if (edible.some((exp_) => token.TokenKind_eq(exp_.tok, this.token.kind))) {
    this.bump();
    return Ok(ast.Recovered.No);
  } else if (inedible.some((exp_) => token.TokenKind_eq(exp_.tok, this.token.kind))) {
    // leave it in the input
    return Ok(ast.Recovered.No);
  } else if (!this.token.eq(TK.Eof) && this.last_unexpected_token_span === this.token.span) {
    return new FatalError().raise();
  } else {
    const r = this.expected_one_of_not_found(edible, inedible);
    if (r.$ === "Err") return r;
    const error_guaranteed = r._0;
    return Ok({ $: "Yes", _0: error_guaranteed });
  }
};

// Public for rustfmt usage.
// rustc: compiler/rustc_parse/src/parser/mod.rs:455 parse_ident
Parser.prototype.parse_ident = function (this: Parser): PResult<Ident> {
  return this.parse_ident_common(this.may_recover());
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:459 parse_ident_common
Parser.prototype.parse_ident_common = function (this: Parser, recover: boolean): PResult<Ident> {
  const r = this.ident_or_err(recover);
  if (r.$ === "Err") return r;
  const [ident, kind] = r._0;

  if (token.ident_of_kind_is_reserved(ident, kind)) {
    const err = this.expected_ident_found_err();
    if (recover && kind !== token.IdentKind.ForcedKeyword) {
      err.emit();
    } else {
      return Err(err);
    }
  }

  this.bump();

  return Ok(ident);
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:476 ident_or_err
Parser.prototype.ident_or_err = function (this: Parser, recover: boolean): PResult<[Ident, IdentKind]> {
  const ident = this.token.ident();
  if (ident !== undefined) {
    return Ok(ident);
  } else {
    return this.expected_ident_found(recover);
  }
};

/// Checks if the next token is `tok`, and returns `true` if so.
///
/// This method will automatically add `tok` to `expected_token_types` if `tok` is not
/// encountered.
// rustc: compiler/rustc_parse/src/parser/mod.rs:488 check
Parser.prototype.check = function (this: Parser, exp_: ExpTokenPair): boolean {
  const is_present = this.token.eq(exp_.tok);
  if (!is_present) {
    this.expected_token_types.insert(exp_.token_type);
  }
  return is_present;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:498 check_noexpect
Parser.prototype.check_noexpect = function (this: Parser, tok: TokenKind): boolean {
  return this.token.eq(tok);
};

// Check the first token after the delimiter that closes the current
// delimited sequence. (Panics if used in the outermost token stream, which
// has no delimiters.)
//
// Primarily used when `self.token` matches `OpenInvisible(_))`, to look
// ahead through the current metavar expansion.
// rustc: compiler/rustc_parse/src/parser/mod.rs:508 check_noexpect_past_close_delim
Parser.prototype.check_noexpect_past_close_delim = function (this: Parser, tok: TokenKind): boolean {
  const t = this.token_cursor.look_ahead_past_close_delim();
  return t !== undefined && t.$ === "Token" && token.TokenKind_eq(t._0.kind, tok);
};

/// Consumes a token 'tok' if it exists. Returns whether the given token was present.
///
/// the main purpose of this function is to reduce the cluttering of the suggestions list
/// which using the normal eat method could introduce in some cases.
// rustc: compiler/rustc_parse/src/parser/mod.rs:521 eat_noexpect
Parser.prototype.eat_noexpect = function (this: Parser, tok: TokenKind): boolean {
  const is_present = this.check_noexpect(tok);
  if (is_present) {
    this.bump();
  }
  return is_present;
};

/// Consumes a token 'tok' if it exists. Returns whether the given token was present.
// rustc: compiler/rustc_parse/src/parser/mod.rs:532 eat
Parser.prototype.eat = function (this: Parser, exp_: ExpTokenPair): boolean {
  const is_present = this.check(exp_);
  if (is_present) {
    this.bump();
  }
  return is_present;
};

/// If the next token is the given keyword, returns `true` without eating it.
/// An expectation is also added for diagnostics purposes.
// rustc: compiler/rustc_parse/src/parser/mod.rs:544 check_keyword
Parser.prototype.check_keyword = function (this: Parser, exp_: ExpKeywordPair): boolean {
  const is_keyword = this.token.is_keyword(exp_.kw);
  if (!is_keyword) {
    this.expected_token_types.insert(exp_.token_type);
  }
  return is_keyword;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:554 check_keyword_case
Parser.prototype.check_keyword_case = function (this: Parser, exp_: ExpKeywordPair, case_: Case): boolean {
  let ident: Ident | undefined;
  if (this.check_keyword(exp_)) {
    return true;
  } else if (
    case_ === Case.Insensitive &&
    (ident = this.token.non_raw_ident()) !== undefined &&
    // Do an ASCII case-insensitive match, because all keywords are ASCII.
    eq_ignore_ascii_case(ident.as_str(), Symbol.as_str(exp_.kw))
  ) {
    return true;
  } else {
    return false;
  }
};

/// If the next token is the given keyword, eats it and returns `true`.
/// Otherwise, returns `false`. An expectation is also added for diagnostics purposes.
// Public for rustc_builtin_macros and rustfmt usage.
// rustc: compiler/rustc_parse/src/parser/mod.rs:573 eat_keyword
Parser.prototype.eat_keyword = function (this: Parser, exp_: ExpKeywordPair): boolean {
  const is_keyword = this.check_keyword(exp_);
  if (is_keyword) {
    this.bump();
  }
  return is_keyword;
};

/// Eats a keyword, optionally ignoring the case.
/// If the case differs (and is ignored) an error is issued.
/// This is useful for recovery.
// rustc: compiler/rustc_parse/src/parser/mod.rs:586 eat_keyword_case
Parser.prototype.eat_keyword_case = function (this: Parser, exp_: ExpKeywordPair, case_: Case): boolean {
  let ident: Ident | undefined;
  if (this.eat_keyword(exp_)) {
    return true;
  } else if (
    case_ === Case.Insensitive &&
    (ident = this.token.non_raw_ident()) !== undefined &&
    // Do an ASCII case-insensitive match, because all keywords are ASCII.
    eq_ignore_ascii_case(ident.as_str(), Symbol.as_str(exp_.kw))
  ) {
    const kw_ = Symbol.as_str(exp_.kw);
    const is_upper = [...kw_].every((c) => is_uppercase(c.codePointAt(0)!));
    const is_lower = [...kw_].every((c) => is_lowercase(c.codePointAt(0)!));

    let case__: DiagCase;
    if (is_upper && is_lower) {
      return unreachable("internal error: entered unreachable code: keyword that is both fully upper- and fully lowercase");
    } else if (is_upper && !is_lower) {
      case__ = "Upper";
    } else if (!is_upper && is_lower) {
      case__ = "Lower";
    } else {
      case__ = "Mixed";
    }

    this.dcx().emit_err(KwBadCase_diagnostic({ span: ident.span, kw: kw_, case: case__ }));
    this.bump();
    return true;
  } else {
    return false;
  }
};

/// If the next token is the given keyword, eats it and returns `true`.
/// Otherwise, returns `false`. No expectation is added.
// Public for rustc_builtin_macros usage.
// rustc: compiler/rustc_parse/src/parser/mod.rs:620 eat_keyword_noexpect
Parser.prototype.eat_keyword_noexpect = function (this: Parser, kw_: Symbol): boolean {
  const is_keyword = this.token.is_keyword(kw_);
  if (is_keyword) {
    this.bump();
  }
  return is_keyword;
};

/// If the given word is not a keyword, signals an error.
/// If the next token is not the given word, signals an error.
/// Otherwise, eats it.
// rustc: compiler/rustc_parse/src/parser/mod.rs:631 expect_keyword
Parser.prototype.expect_keyword = function (this: Parser, exp_: ExpKeywordPair): PResult<undefined> {
  if (!this.eat_keyword(exp_)) {
    return this.unexpected();
  } else {
    return Ok(undefined);
  }
};

/// Consume a sequence produced by a metavar expansion, if present.
// rustc: compiler/rustc_parse/src/parser/mod.rs:636 eat_metavar_seq
Parser.prototype.eat_metavar_seq = function <T>(
  this: Parser,
  mv_kind: MetaVarKind,
  f: (this_: Parser) => PResult<T>,
): T | undefined {
  return this.eat_metavar_seq_with_matcher((mvk) => token.MetaVarKind_eq(mvk, mv_kind), f);
};

/// A slightly more general form of `eat_metavar_seq`, for use with the
/// `MetaVarKind` variants that have parameters, where an exact match isn't
/// desired.
// rustc: compiler/rustc_parse/src/parser/mod.rs:647 eat_metavar_seq_with_matcher
Parser.prototype.eat_metavar_seq_with_matcher = function <T>(
  this: Parser,
  match_mv_kind: (a0: MetaVarKind) => boolean,
  f: (this_: Parser) => PResult<T>,
): T | undefined {
  const k = this.token.kind;
  if (k.$ === "OpenInvisible" && k._0.$ === "MetaVar" && match_mv_kind(k._0._0)) {
    this.bump();

    // Recovery is disabled when parsing macro arguments, so it must
    // also be disabled when reparsing pasted macro arguments,
    // otherwise we get inconsistent results (e.g. #137874).
    const r = this.with_recovery(Recovery.Forbidden, (this_) => f(this_));

    let res: T;
    switch (r.$) {
      case "Ok":
        res = r._0;
        break;
      case "Err": {
        const err = r._0;
        // This can occur in unusual error cases, e.g. #139445.
        err.delay_as_bug();
        return undefined;
      }
    }

    const k2 = this.token.kind;
    if (k2.$ === "CloseInvisible" && k2._0.$ === "MetaVar" && match_mv_kind(k2._0._0)) {
      this.bump();
      return res;
    } else {
      // This can occur when invalid syntax is passed to a decl macro. E.g. see #139248,
      // where the reparse attempt of an invalid expr consumed the trailing invisible
      // delimiter.
      // PORT: not a `format!`: the literal text (with `{mv_kind:?}`) is the message.
      this.dcx().span_delayed_bug(this.token.span, "no close delim with reparsing {mv_kind:?}");
      return undefined;
    }
  } else {
    return undefined;
  }
};

/// Is the given keyword `kw` followed by a non-reserved identifier?
// rustc: compiler/rustc_parse/src/parser/mod.rs:690 is_kw_followed_by_ident
Parser.prototype.is_kw_followed_by_ident = function (this: Parser, kw_: Symbol): boolean {
  return this.token.is_keyword(kw_) && this.look_ahead(1, (t) => t.is_non_reserved_ident());
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:695 check_or_expected
Parser.prototype.check_or_expected = function (this: Parser, ok: boolean, token_type: TokenType): boolean {
  if (!ok) {
    this.expected_token_types.insert(token_type);
  }
  return ok;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:702 check_ident
Parser.prototype.check_ident = function (this: Parser): boolean {
  return this.check_or_expected(this.token.is_ident(), TokenType.Ident);
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:706 check_path
Parser.prototype.check_path = function (this: Parser): boolean {
  return this.check_or_expected(this.token.is_path_start(), TokenType.Path);
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:710 check_type
Parser.prototype.check_type = function (this: Parser): boolean {
  return this.check_or_expected(this.token.can_begin_type(), TokenType.Type);
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:714 check_const_arg
Parser.prototype.check_const_arg = function (this: Parser): boolean {
  const is_mcg_arg = this.check_or_expected(this.token.can_begin_const_arg(), TokenType.Const);
  const is_mgca_arg = this.is_keyword_ahead(0, [kw.Const]) && this.look_ahead(1, (t) => t.eq(TK.OpenBrace));
  return is_mcg_arg || is_mgca_arg;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:721 check_const_closure
Parser.prototype.check_const_closure = function (this: Parser): boolean {
  // FIXME(#146122): Parse `const async ...`, `const gen ...` & `const async gen ...`
  //                 closures. We already parse `const static async ...` ones etc.

  return (
    this.is_keyword_ahead(0, [kw.Const]) &&
    this.look_ahead(1, (t) => {
      const k = t.uninterpolate().kind;
      switch (k.$) {
        case "Ident":
          return (
            (k._0 === kw.Move || k._0 === kw.Use || k._0 === kw.Static) &&
            (k._1 === token.IdentKind.Normal || k._1 === token.IdentKind.ForcedKeyword)
          );
        case "OrOr":
        case "Or":
          return true;
        default:
          return false;
      }
    })
  );
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:737 check_inline_const
Parser.prototype.check_inline_const = function (this: Parser, dist: number): boolean {
  return (
    this.is_keyword_ahead(dist, [kw.Const]) &&
    this.look_ahead(dist + 1, (t) => {
      const k = t.kind;
      switch (k.$) {
        case "OpenBrace":
          return true;
        case "OpenInvisible":
          return k._0.$ === "MetaVar" && k._0._0.$ === "Block";
        default:
          return false;
      }
    })
  );
};

/// Checks to see if the next token is either `+` or `+=`.
/// Otherwise returns `false`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:749 check_plus
Parser.prototype.check_plus = function (this: Parser): boolean {
  return this.check_or_expected(this.token.is_like_plus(), TokenType.Plus);
};

/// Eats the expected token if it's present possibly breaking
/// compound tokens like multi-character operators in process.
/// Returns `true` if the token was eaten.
// rustc: compiler/rustc_parse/src/parser/mod.rs:756 break_and_eat
Parser.prototype.break_and_eat = function (this: Parser, exp_: ExpTokenPair): boolean {
  if (this.token.eq(exp_.tok)) {
    this.bump();
    return true;
  }
  const r = token.TokenKind.break_two_token_op(this.token.kind, 1);
  if (r !== undefined && token.TokenKind_eq(r[0], exp_.tok)) {
    const [first, second] = r;
    const first_span = this.psess.source_map().start_point(this.token.span);
    const second_span = Span.with_lo(this.token.span, Span.hi(first_span));
    this.token = token.Token.new(first, first_span);
    // Keep track of this token - if we end token capturing now,
    // we'll want to append this token to the captured stream.
    //
    // If we consume any additional tokens, then this token
    // is not needed (we'll capture the entire 'glued' token),
    // and `bump` will set this field to 0.
    this.break_last_token += 1;
    // Use the spacing of the glued token as the spacing of the
    // unglued second token.
    this.bump_with([token.Token.new(second, second_span), this.token_spacing]);
    return true;
  } else {
    this.expected_token_types.insert(exp_.token_type);
    return false;
  }
};

/// Eats `+` possibly breaking tokens like `+=` in process.
// rustc: compiler/rustc_parse/src/parser/mod.rs:786 eat_plus
Parser.prototype.eat_plus = function (this: Parser): boolean {
  return this.break_and_eat(exp.Plus);
};

/// Eats `&` possibly breaking tokens like `&&` in process.
/// Signals an error if `&` is not eaten.
// rustc: compiler/rustc_parse/src/parser/mod.rs:792 expect_and
Parser.prototype.expect_and = function (this: Parser): PResult<undefined> {
  if (this.break_and_eat(exp.And)) {
    return Ok(undefined);
  } else {
    return this.unexpected();
  }
};

/// Eats `|` possibly breaking tokens like `||` in process.
/// Signals an error if `|` was not eaten.
// rustc: compiler/rustc_parse/src/parser/mod.rs:798 expect_or
Parser.prototype.expect_or = function (this: Parser): PResult<undefined> {
  if (this.break_and_eat(exp.Or)) {
    return Ok(undefined);
  } else {
    return this.unexpected();
  }
};

/// Eats `<` possibly breaking tokens like `<<` in process.
// rustc: compiler/rustc_parse/src/parser/mod.rs:803 eat_lt
Parser.prototype.eat_lt = function (this: Parser): boolean {
  const ate = this.break_and_eat(exp.Lt);
  if (ate) {
    // See doc comment for `unmatched_angle_bracket_count`.
    // PORT: `u16` counter (cannot exceed the token count, no wrap in practice).
    this.unmatched_angle_bracket_count += 1;
  }
  return ate;
};

/// Eats `<` possibly breaking tokens like `<<` in process.
/// Signals an error if `<` was not eaten.
// rustc: compiler/rustc_parse/src/parser/mod.rs:815 expect_lt
Parser.prototype.expect_lt = function (this: Parser): PResult<undefined> {
  if (this.eat_lt()) {
    return Ok(undefined);
  } else {
    return this.unexpected();
  }
};

/// Eats `>` possibly breaking tokens like `>>` in process.
/// Signals an error if `>` was not eaten.
// rustc: compiler/rustc_parse/src/parser/mod.rs:821 expect_gt
Parser.prototype.expect_gt = function (this: Parser): PResult<undefined> {
  if (this.break_and_eat(exp.Gt)) {
    // See doc comment for `unmatched_angle_bracket_count`.
    if (this.unmatched_angle_bracket_count > 0) {
      this.unmatched_angle_bracket_count -= 1;
    }
    return Ok(undefined);
  } else {
    return this.unexpected();
  }
};

/// Checks if the next token is contained within `closes`, and returns `true` if so.
// rustc: compiler/rustc_parse/src/parser/mod.rs:835 expect_any_with_type
Parser.prototype.expect_any_with_type = function (
  this: Parser,
  closes_expected: readonly ExpTokenPair[],
  closes_not_expected: readonly TokenKind[],
): boolean {
  return closes_expected.some((close) => this.check(close)) || closes_not_expected.some((k) => this.check_noexpect(k));
};

/// Parses a sequence until the specified delimiters. The function
/// `f` must consume tokens until reaching the next separator or
/// closing bracket.
// rustc: compiler/rustc_parse/src/parser/mod.rs:847 parse_seq_to_before_tokens
Parser.prototype.parse_seq_to_before_tokens = function <T>(
  this: Parser,
  closes_expected: readonly ExpTokenPair[],
  closes_not_expected: readonly TokenKind[],
  sep: SeqSep,
  f: (this_: Parser) => PResult<T>,
): PResult<[T[], Trailing, ast.Recovered]> {
  let first = true;
  let recovered: ast.Recovered = ast.Recovered.No;
  let trailing: Trailing = Trailing.No;
  const v: T[] = [];

  // PORT: the label lets the `Err(e)` arm below `break` the loop from inside the JS `switch`.
  seq_loop: while (!this.expect_any_with_type(closes_expected, closes_not_expected)) {
    if (token.TokenKind.is_close_delim_or_eof(this.token.kind)) {
      break;
    }
    const exp_ = sep.sep;
    if (exp_ !== undefined) {
      if (first) {
        // no separator for the first element
        first = false;
      } else {
        // check for separator
        const r = this.expect(exp_);
        if (r.$ === "Ok" && r._0.$ === "No") {
          this.current_closure = undefined;
        } else if (r.$ === "Ok" && r._0.$ === "Yes") {
          const guar = r._0._0;
          this.current_closure = undefined;
          recovered = { $: "Yes", _0: guar };
          break;
        } else if (r.$ === "Err") {
          const expect_err = r._0;
          const sp = Span.shrink_to_hi(this.prev_token.span);
          const token_str = pprust.token_kind_to_string(exp_.tok);

          // PORT: `match self.current_closure.take() { Some(closure_spans) if .. => .., _ => .. }`
          const closure_spans = this.current_closure;
          this.current_closure = undefined;
          if (closure_spans !== undefined && this.token.eq(TK.Semi)) {
            // Finding a semicolon instead of a comma
            // after a closure body indicates that the
            // closure body may be a block but the user
            // forgot to put braces around its
            // statements.

            const r2 = this.recover_missing_braces_around_closure_body(closure_spans, expect_err);
            if (r2.$ === "Err") return r2;

            continue;
          } else {
            // Attempt to keep parsing if it was a similar separator.
            if (token.TokenKind.similar_tokens(exp_.tok).some((k) => token.TokenKind_eq(k, this.token.kind))) {
              this.bump();
            }
          }

          // If this was a missing `@` in a binding pattern
          // bail with a suggestion
          // https://github.com/rust-lang/rust/issues/72373
          if (this.prev_token.is_ident() && this.token.eq(TK.DotDot)) {
            const msg =
              "if you meant to bind the contents of the rest of the array " +
              `pattern into \`${pprust.token_to_string(this.prev_token)}\`, use \`@\``;
            expect_err
              .with_span_suggestion_verbose(
                Span.until(Span.shrink_to_hi(this.prev_token.span), this.token.span),
                msg,
                " @ ",
                Applicability.MaybeIncorrect,
              )
              .emit();
            break;
          }

          // Attempt to keep parsing if it was an omitted separator.
          // `&raw <expr>` already has a specific suggestion for missing
          // `const`/`mut`, so don't recover `<expr>` as the next element in
          // a comma-separated list.
          if (exp_.token_type === TokenType.Comma && this.is_expected_raw_ref_mut()) {
            return Err(expect_err);
          }
          this.last_unexpected_token_span = undefined;
          const r3 = f(this);
          switch (r3.$) {
            case "Ok": {
              const t = r3._0;
              // Parsed successfully, therefore most probably the code only
              // misses a separator.
              expect_err
                .with_span_suggestion_short(sp, `missing \`${token_str}\``, token_str, Applicability.MaybeIncorrect)
                .emit();

              v.push(t);
              continue;
            }
            case "Err": {
              const e = r3._0;
              // Parsing failed, therefore it must be something more serious
              // than just a missing separator.
              for (const xx of e.deref().children) {
                // Propagate the help message from sub error `e` to main
                // error `expect_err`.
                expect_err.deref_mut().children.push(xx.clone());
              }
              e.cancel();
              if (this.token.eq(TK.Colon)) {
                // We will try to recover in
                // `maybe_recover_struct_lit_bad_delims`.
                return Err(expect_err);
              } else if (closes_expected.length === 1 && closes_expected[0]!.token_type === TokenType.CloseParen) {
                return Err(expect_err);
              } else {
                expect_err.emit();
                break seq_loop;
              }
            }
          }
        }
      }
    }
    if (sep.trailing_sep_allowed && this.expect_any_with_type(closes_expected, closes_not_expected)) {
      trailing = Trailing.Yes;
      break;
    }

    const r = f(this);
    if (r.$ === "Err") return r;
    const t = r._0;
    v.push(t);
  }

  return Ok([v, trailing, recovered]);
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:992 recover_missing_braces_around_closure_body
Parser.prototype.recover_missing_braces_around_closure_body = function (
  this: Parser,
  closure_spans: ClosureSpans,
  expect_err: Diag,
): PResult<undefined> {
  const initial_semicolon = this.token.span;

  while (this.eat(exp.Semi)) {
    const r = this.parse_stmt_without_recovery(false, gen.ForceCollect.No, false);
    if (r.$ === "Err") {
      const e = r._0;
      e.cancel();
    }
  }

  expect_err.primary_message("closure bodies that contain statements must be surrounded by braces");

  const preceding_pipe_span = closure_spans.closing_pipe;
  const following_token_span = this.token.span;

  const first_note = MultiSpan.from_spans([initial_semicolon]);
  first_note.push_span_label(initial_semicolon, "this `;` turns the preceding closure into a statement");
  first_note.push_span_label(closure_spans.body, "this expression is a statement because of the trailing semicolon");
  expect_err.span_note(first_note, "statement found outside of a block");

  const second_note = MultiSpan.from_spans([closure_spans.whole_closure]);
  second_note.push_span_label(closure_spans.whole_closure, "this is the parsed closure...");
  second_note.push_span_label(following_token_span, "...but likely you meant the closure to end here");
  expect_err.span_note(second_note, "the closure body may be incorrectly delimited");

  expect_err.span([preceding_pipe_span, following_token_span]);

  const opening_suggestion_str = " {";
  const closing_suggestion_str = "}";

  expect_err.multipart_suggestion(
    "try adding braces",
    [
      [Span.shrink_to_hi(preceding_pipe_span), opening_suggestion_str],
      [Span.shrink_to_lo(following_token_span), closing_suggestion_str],
    ],
    Applicability.MaybeIncorrect,
  );

  expect_err.emit();

  return Ok(undefined);
};

/// Parses a sequence, not including the delimiters. The function
/// `f` must consume tokens until reaching the next separator or
/// closing bracket.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1052 parse_seq_to_before_end
Parser.prototype.parse_seq_to_before_end = function <T>(
  this: Parser,
  close: ExpTokenPair,
  sep: SeqSep,
  f: (this_: Parser) => PResult<T>,
): PResult<[T[], Trailing, ast.Recovered]> {
  return this.parse_seq_to_before_tokens([close], [], sep, f);
};

/// Parses a sequence, including only the closing delimiter. The function
/// `f` must consume tokens until reaching the next separator or
/// closing bracket.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1064 parse_seq_to_end
Parser.prototype.parse_seq_to_end = function <T>(
  this: Parser,
  close: ExpTokenPair,
  sep: SeqSep,
  f: (this_: Parser) => PResult<T>,
): PResult<[T[], Trailing]> {
  const r = this.parse_seq_to_before_end(close, sep, f);
  if (r.$ === "Err") return r;
  const [val, trailing, recovered] = r._0;
  if (recovered.$ === "No" && !this.eat(close)) {
    this.dcx().span_delayed_bug(this.token.span, "recovered but `parse_seq_to_before_end` did not give us the close token");
  }
  return Ok([val, trailing]);
};

/// Parses a sequence, including both delimiters. The function
/// `f` must consume tokens until reaching the next separator or
/// closing bracket.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1083 parse_unspanned_seq
Parser.prototype.parse_unspanned_seq = function <T>(
  this: Parser,
  open: ExpTokenPair,
  close: ExpTokenPair,
  sep: SeqSep,
  f: (this_: Parser) => PResult<T>,
): PResult<[T[], Trailing]> {
  const r = this.expect(open);
  if (r.$ === "Err") return r;
  return this.parse_seq_to_end(close, sep, f);
};

/// Parses a comma-separated sequence, including both delimiters.
/// The function `f` must consume tokens until reaching the next separator or
/// closing bracket.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1097 parse_delim_comma_seq
Parser.prototype.parse_delim_comma_seq = function <T>(
  this: Parser,
  open: ExpTokenPair,
  close: ExpTokenPair,
  f: (this_: Parser) => PResult<T>,
): PResult<[T[], Trailing]> {
  return this.parse_unspanned_seq(open, close, SeqSep.trailing_allowed(exp.Comma), f);
};

/// Parses a comma-separated sequence delimited by parentheses (e.g. `(x, y)`).
/// The function `f` must consume tokens until reaching the next separator or
/// closing bracket.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1109 parse_paren_comma_seq
Parser.prototype.parse_paren_comma_seq = function <T>(this: Parser, f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing]> {
  return this.parse_delim_comma_seq(exp.OpenParen, exp.CloseParen, f);
};

/// Advance the parser by one token using provided token as the next one.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1117 bump_with
Parser.prototype.bump_with = function (this: Parser, next: [Token, Spacing]): void {
  this.inlined_bump_with(next);
};

/// This always-inlined version should only be used on hot code paths.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1123 inlined_bump_with
Parser.prototype.inlined_bump_with = function (this: Parser, [next_token, next_spacing]: [Token, Spacing]): void {
  // Update the current and previous tokens.
  this.prev_token = this.token;
  this.token = next_token;
  this.token_spacing = next_spacing;

  // Diagnostics.
  this.expected_token_types.clear();
};

/// Advance the parser by one token.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1133 bump
Parser.prototype.bump = function (this: Parser): void {
  // Note: destructuring here would give nicer code, but it was found in #96210 to be slower
  // than `.0`/`.1` access.
  let next = this.token_cursor.inlined_next_and_bump();
  this.num_bump_calls += 1;
  // We got a token from the underlying cursor and no longer need to
  // worry about an unglued token. See `break_and_eat` for more details.
  this.break_last_token = 0;
  if (Span.is_dummy(next[0].span)) {
    // Tweak the location for better diagnostics, but keep syntactic context intact.
    const fallback_span = this.token.span;
    // PORT: `next.0.span = ..` on the (Copy) token: a new `Token` (rustc_ast/token.ts convention).
    next = [token.Token.new(next[0].kind, Span.with_ctxt(fallback_span, Span.ctxt(next[0].span))), next[1]];
  }
  // debug_assert!(!matches!(
  //     next.0.kind,
  //     token::OpenInvisible(origin) | token::CloseInvisible(origin) if origin.skip()
  // ));
  this.inlined_bump_with(next);
};

/// Look-ahead `dist` tokens of `self.token` and get access to that token there.
/// When `dist == 0` then the current token is looked at. `Eof` will be
/// returned if the look-ahead is any distance past the end of the tokens.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1156 look_ahead
Parser.prototype.look_ahead = function <R>(this: Parser, dist: number, looker: (a0: Token) => R): R {
  if (dist === 0) {
    return looker(this.token);
  }

  // Typically around 98% of the `dist > 0` cases have `dist == 1`, so we
  // have a fast special case for that.
  if (dist === 1) {
    // `look_ahead(1)` returns the next token.
    const tree = this.token_cursor.look_ahead(1);
    if (tree !== undefined) {
      // Indexing stayed within the current token tree.
      switch (tree.$) {
        case "Token":
          return looker(tree._0);
        case "Delimited": {
          const dspan = tree._0;
          const delim = tree._2;
          if (!token.Delimiter.skip(delim)) {
            return looker(token.Token.new(token.Delimiter.as_open_token_kind(delim), dspan.open));
          }
          break;
        }
      }
    } else {
      // The tree cursor lookahead went (one) past the end of the
      // current token tree. Try to return a close delimiter.
      const p = this.token_cursor.parent_delim_and_span();
      if (p !== undefined && !token.Delimiter.skip(p[0])) {
        const [delim, span] = p;
        // We are not in the outermost token stream, so we have
        // delimiters. Also, those delimiters are not skipped.
        return looker(token.Token.new(token.Delimiter.as_close_token_kind(delim), span.close));
      }
    }
  }

  // Just clone the token cursor and use `next_and_bump`, skipping delimiters as
  // necessary. Slow but simple.
  const cursor = tokenstream.clone_TokenCursor(this.token_cursor);
  let i = 0;
  let token_ = token.Token.dummy();
  while (i < dist) {
    token_ = cursor.next_and_bump()[0];
    const k = token_.kind;
    if ((k.$ === "OpenInvisible" || k.$ === "CloseInvisible") && token.InvisibleOrigin.skip(k._0)) {
      continue;
    }
    i += 1;
  }
  return looker(token_);
};

/// Like `look_ahead`, but skips over token trees rather than tokens. Useful
/// when looking past possible metavariable pasting sites. Panics if `dist` is zero.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1210 tree_look_ahead
Parser.prototype.tree_look_ahead = function <R>(this: Parser, dist: number, looker: (a0: TokenTree) => R): R | undefined {
  const t = this.token_cursor.look_ahead(dist);
  return t === undefined ? undefined : looker(t);
};

/// Returns whether any of the given keywords are `dist` tokens ahead of the current one.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1219 is_keyword_ahead
Parser.prototype.is_keyword_ahead = function (this: Parser, dist: number, kws: readonly Symbol[]): boolean {
  return this.look_ahead(dist, (t) => kws.some((kw_) => t.is_keyword(kw_)));
};

/// Parses optional coroutine marker: `async`/`gen`/`async gen`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1224 parse_coroutine_marker
Parser.prototype.parse_coroutine_marker = function (this: Parser, case_: Case): ast.CoroutineMarker | undefined {
  const span = this.token_uninterpolated_span();
  let r: [ast.CoroutineKind, Span] | undefined;
  if (this.eat_keyword_case(exp.Async, case_)) {
    // FIXME(gen_blocks): Do we want to unconditionally parse `gen` and then
    // error if edition <= 2024, like we do with async and edition <= 2018?
    if (Span.at_least_rust_2024(this.token_uninterpolated_span()) && this.eat_keyword_case(exp.Gen, case_)) {
      const gen_span = this.prev_token_uninterpolated_span();
      r = [ast.CoroutineKind.AsyncGen, Span.to(span, gen_span)];
    } else {
      r = [ast.CoroutineKind.Async, span];
    }
  } else if (Span.at_least_rust_2024(this.token_uninterpolated_span()) && this.eat_keyword_case(exp.Gen, case_)) {
    r = [ast.CoroutineKind.Gen, span];
  } else {
    r = undefined;
  }
  return r === undefined ? undefined : ast.CoroutineMarker.new(r[0], r[1]);
};

/// Parses fn unsafety: `unsafe`, `safe` or nothing.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1248 parse_safety
Parser.prototype.parse_safety = function (this: Parser, case_: Case): ast.Safety {
  if (this.eat_keyword_case(exp.Unsafe, case_)) {
    return { $: "Unsafe", _0: this.prev_token_uninterpolated_span() };
  } else if (this.eat_keyword_case(exp.Safe, case_)) {
    return { $: "Safe", _0: this.prev_token_uninterpolated_span() };
  } else {
    return ast.Safety.Default;
  }
};

/// Parses constness: `const` or nothing.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1259 parse_constness
Parser.prototype.parse_constness = function (this: Parser, case_: Case): ast.Const {
  return this.parse_constness_(case_, false);
};

/// Parses constness for closures (case sensitive, feature-gated)
// rustc: compiler/rustc_parse/src/parser/mod.rs:1264 parse_closure_constness
Parser.prototype.parse_closure_constness = function (this: Parser): ast.Const {
  const constness = this.parse_constness_(Case.Sensitive, true);
  if (constness.$ === "Yes") {
    const span = constness._0;
    this.psess.gated_spans.gate(sym.const_closures, span);
  }
  return constness;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1272 parse_constness_
Parser.prototype.parse_constness_ = function (this: Parser, case_: Case, is_closure: boolean): ast.Const {
  // Avoid const blocks and const closures to be parsed as const items
  if (
    this.check_const_closure() === is_closure &&
    !this.look_ahead(1, (t) => t.eq(TK.OpenBrace) || t.is_metavar_block()) &&
    this.eat_keyword_case(exp.Const, case_)
  ) {
    return { $: "Yes", _0: this.prev_token_uninterpolated_span() };
  } else {
    return ast.Const.No;
  }
};

/// Parses inline const expressions.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1285 parse_const_block
Parser.prototype.parse_const_block = function (this: Parser, span: Span, pat: boolean): PResult<ast.Expr> {
  const r = this.expect_keyword(exp.Const);
  if (r.$ === "Err") return r;
  const r2 = this.parse_inner_attrs_and_block(undefined);
  if (r2.$ === "Err") return r2;
  const [attrs, blk] = r2._0;
  const anon_const: ast.AnonConst = {
    id: ast.DUMMY_NODE_ID,
    value: this.mk_expr(blk.span, { $: "Block", _0: blk, _1: undefined }),
  };
  const blk_span = anon_const.value.span;
  let kind: ast.ExprKind;
  if (pat) {
    const guar = this.dcx()
      .struct_span_err(blk_span, "const blocks cannot be used as patterns")
      .with_help("use a named `const`-item or an `if`-guard (`x if x == const { ... }`) instead")
      .emit_err();
    kind = { $: "Err", _0: guar };
  } else {
    kind = { $: "ConstBlock", _0: anon_const };
  }
  return Ok(this.mk_expr_with_attrs(Span.to(span, blk_span), kind, attrs));
};

/// Parse nothing or `mut`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1309 parse_mutability
Parser.prototype.parse_mutability = function (this: Parser): ast.Mutability {
  if (this.eat_keyword(exp.Mut)) {
    return ast.Mutability.Mut;
  } else {
    return ast.Mutability.Not;
  }
};

/// Parse nothing or a by-reference mode.
///
/// ```ebnf
/// ByRef = "ref" PinAndMut?
/// ```
// rustc: compiler/rustc_parse/src/parser/mod.rs:1318 parse_byref
Parser.prototype.parse_byref = function (this: Parser): ast.ByRef {
  if (this.eat_keyword(exp.Ref)) {
    const [pinnedness, mutability] = this.parse_pin_and_mut();
    return { $: "Yes", _0: pinnedness, _1: mutability };
  } else {
    return ast.ByRef.No;
  }
};

/// Parse nothing or "explicit" mutability.
///
/// ```ebnf
/// MutOrConst = "mut" | "const"
/// ```
// rustc: compiler/rustc_parse/src/parser/mod.rs:1332 parse_mut_or_const
Parser.prototype.parse_mut_or_const = function (this: Parser): ast.Mutability | undefined {
  if (this.eat_keyword(exp.Mut)) {
    return ast.Mutability.Mut;
  } else if (this.eat_keyword(exp.Const)) {
    return ast.Mutability.Not;
  } else {
    return undefined;
  }
};

/// Parse a field name.
///
/// ```enbf
/// FieldName = IntLit | Ident
/// ```
// rustc: compiler/rustc_parse/src/parser/mod.rs:1347 parse_field_name
Parser.prototype.parse_field_name = function (this: Parser): PResult<Ident> {
  const k = this.token.kind;
  if (k.$ === "Literal" && k._0.kind.$ === "Integer") {
    const { symbol, suffix } = k._0;
    if (suffix !== undefined) {
      this.dcx().emit_err(InvalidLiteralSuffixOnTupleIndex_diagnostic({ span: this.token.span, suffix }));
    }
    this.bump();
    return Ok(Ident.new(symbol, this.prev_token.span));
  } else {
    return this.parse_ident_common(true);
  }
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1363 parse_delim_args
Parser.prototype.parse_delim_args = function (this: Parser): PResult<ast.DelimArgs> {
  const args = this.parse_delim_args_inner();
  if (args !== undefined) {
    return Ok(args);
  } else {
    return this.unexpected_any();
  }
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1371 parse_attr_args
Parser.prototype.parse_attr_args = function (this: Parser): PResult<ast.AttrArgs> {
  const args = this.parse_delim_args_inner();
  if (args !== undefined) {
    return Ok({ $: "Delimited", _0: args });
  } else if (this.eat(exp.Eq)) {
    const eq_span = this.prev_token.span;
    const r = this.parse_expr_force_collect();
    if (r.$ === "Err") return r;
    const expr = r._0;
    return Ok({ $: "Eq", eq_span, expr });
  } else {
    return Ok(ast.AttrArgs.Empty);
  }
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1383 parse_delim_args_inner
Parser.prototype.parse_delim_args_inner = function (this: Parser): ast.DelimArgs | undefined {
  const delimited = this.check(exp.OpenParen) || this.check(exp.OpenBracket) || this.check(exp.OpenBrace);

  if (!delimited) return undefined;
  const tt = this.parse_token_tree();
  if (tt.$ !== "Delimited") {
    return unreachable();
  }
  const dspan = tt._0;
  const delim = tt._2;
  const tokens = tt._3;
  return new ast.DelimArgs(dspan, delim, tokens);
};

/// Parses a single token tree from the input.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1397 parse_token_tree
Parser.prototype.parse_token_tree = function (this: Parser): TokenTree {
  if (token.TokenKind.open_delim(this.token.kind) !== undefined) {
    // Clone the `TokenTree::Delimited` that we are currently
    // within. That's what we are going to return.
    const tree = this.token_cursor.clone_enclosing_delim();
    // debug_assert_matches!(tree, TokenTree::Delimited(..));

    // Advance the token cursor through the entire delimited
    // sequence. After getting the `OpenDelim` we are *within* the
    // delimited sequence, i.e. at depth `d`. After getting the
    // matching `CloseDelim` we are *after* the delimited sequence,
    // i.e. at depth `d - 1`.
    const target_depth = this.token_cursor.depth() - 1;

    if (this.capture_state.capturing === gen.Capturing.No) {
      // We are not capturing tokens, so skip to the end of the
      // delimited sequence. This is a perf win when dealing with
      // declarative macros that pass large `tt` fragments through
      // multiple rules, as seen in the uom-0.37.0 crate.
      this.token_cursor.bump_to_end();
      this.bump();
      // debug_assert_eq!(self.token_cursor.depth(), target_depth);
    } else {
      for (;;) {
        // Advance one token at a time, so `TokenCursor::next_and_bump()`
        // can capture these tokens if necessary.
        this.bump();
        if (this.token_cursor.depth() === target_depth) {
          break;
        }
      }
    }
    // debug_assert!(self.token.kind.close_delim().is_some());

    // Consume close delimiter
    this.bump();
    return tree;
  } else {
    assert(!token.TokenKind.is_close_delim_or_eof(this.token.kind), "assertion failed: !self.token.kind.is_close_delim_or_eof()");
    const prev_spacing = this.token_spacing;
    this.bump();
    // PORT: the `Copy` token is copied into the tree: `clone_Token` (PORTING §8, AST objects).
    return { $: "Token", _0: token.clone_Token(this.prev_token), _1: prev_spacing };
  }
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1442 parse_tokens
Parser.prototype.parse_tokens = function (this: Parser): TokenStream {
  const result: TokenTree[] = [];
  for (;;) {
    if (token.TokenKind.is_close_delim_or_eof(this.token.kind)) {
      break;
    } else {
      result.push(this.parse_token_tree());
    }
  }
  return tokenstream.TokenStream.new(result);
};

/// Evaluates the closure with restrictions in place.
///
/// Afters the closure is evaluated, restrictions are reset.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1457 with_res
Parser.prototype.with_res = function <T>(this: Parser, res: Restrictions, f: (this_: Parser) => T): T {
  const old = this.restrictions;
  this.restrictions = res;
  const res_ = f(this);
  this.restrictions = old;
  return res_;
};

/// Parses `pub` and `pub(in path)` plus shortcuts `pub(crate)` for `pub(in crate)`, `pub(self)`
/// for `pub(in self)` and `pub(super)` for `pub(in super)`.
/// If the following element can't be a tuple (i.e., it's a function definition), then
/// it's not a tuple struct field), and the contents within the parentheses aren't valid,
/// so emit a proper diagnostic.
// Public for rustfmt usage.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1471 parse_visibility
Parser.prototype.parse_visibility = function (this: Parser, fbt: FollowedByType): PResult<ast.Visibility> {
  const vis = this.eat_metavar_seq(token.MetaVarKind.Vis, (this_) => this_.parse_visibility(gen.FollowedByType.Yes));
  if (vis !== undefined) {
    return Ok(vis);
  }

  if (!this.eat_keyword(exp.Pub)) {
    // We need a span for our `Spanned<VisibilityKind>`, but there's inherently no
    // keyword to grab a span from for inherited visibility; an empty span at the
    // beginning of the current token would seem to be the "Schelling span".
    return Ok({ span: Span.shrink_to_lo(this.token.span), kind: ast.VisibilityKind.Inherited });
  }
  const lo = this.prev_token.span;

  if (this.check(exp.OpenParen)) {
    // We don't `self.bump()` the `(` yet because this might be a struct definition where
    // `()` or a tuple might be allowed. For example, `struct Struct(pub (), pub (usize));`.
    // Because of this, we only `bump` the `(` if we're assured it is appropriate to do so
    // by the following tokens.
    if (this.is_keyword_ahead(1, [kw.In])) {
      // Parse `pub(in path)`.
      this.bump(); // `(`
      this.bump(); // `in`
      const r = this.parse_path(PathStyle.Mod); // `path`
      if (r.$ === "Err") return r;
      const path = r._0;
      const r2 = this.expect(exp.CloseParen); // `)`
      if (r2.$ === "Err") return r2;
      const vis: ast.VisibilityKind = { $: "Restricted", path, id: ast.DUMMY_NODE_ID, shorthand: false };
      return Ok({ span: Span.to(lo, this.prev_token.span), kind: vis });
    } else if (
      this.look_ahead(2, (t) => t.eq(TK.CloseParen)) &&
      this.is_keyword_ahead(1, [kw.Crate, kw.Super, kw.SelfLower])
    ) {
      // Parse `pub(crate)`, `pub(self)`, or `pub(super)`.
      this.bump(); // `(`
      const r = this.parse_path(PathStyle.Mod); // `crate`/`super`/`self`
      if (r.$ === "Err") return r;
      const path = r._0;
      const r2 = this.expect(exp.CloseParen); // `)`
      if (r2.$ === "Err") return r2;
      const vis: ast.VisibilityKind = { $: "Restricted", path, id: ast.DUMMY_NODE_ID, shorthand: true };
      return Ok({ span: Span.to(lo, this.prev_token.span), kind: vis });
    } else if (fbt === gen.FollowedByType.No) {
      // Provide this diagnostic if a type cannot follow;
      // in particular, if this is not a tuple struct.
      const r = this.recover_incorrect_vis_restriction();
      if (r.$ === "Err") return r;
      // Emit diagnostic, but continue with public visibility.
    }
  }

  return Ok({ span: lo, kind: ast.VisibilityKind.Public });
};

/// Recovery for e.g. `pub(something) fn ...` or `struct X { pub(something) y: Z }`
// rustc: compiler/rustc_parse/src/parser/mod.rs:1531 recover_incorrect_vis_restriction
Parser.prototype.recover_incorrect_vis_restriction = function (this: Parser): PResult<undefined> {
  this.bump(); // `(`
  const r = this.parse_path(PathStyle.Mod);
  if (r.$ === "Err") return r;
  const path = r._0;
  const r2 = this.expect(exp.CloseParen); // `)`
  if (r2.$ === "Err") return r2;

  const path_str = pprust.path_to_string(path);
  this.dcx().emit_err(IncorrectVisibilityRestriction_diagnostic({ span: path.span, inner_str: path_str }));

  return Ok(undefined);
};

/// Parses an optional `impl` restriction.
/// Enforces the `impl_restriction` feature gate whenever an explicit restriction is encountered.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1545 parse_impl_restriction
Parser.prototype.parse_impl_restriction = function (this: Parser): PResult<ast.ImplRestriction> {
  if (this.eat_keyword(exp.Impl)) {
    const r = this.parse_restriction(gen.ParsingRestrictionKind.Impl);
    if (r.$ === "Err") return r;
    const [kind, span, gated_span] = r._0;
    this.psess.gated_spans.gate(sym.impl_restriction, gated_span);
    return Ok({ kind, span });
  }
  return Ok({ kind: ast.RestrictionKind.Unrestricted, span: Span.shrink_to_lo(this.token.span) });
};

/// Parses an optional `mut` restriction.
/// Enforces the `mut_restriction` feature gate whenever an explicit restriction is encountered.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1559 parse_mut_restriction
Parser.prototype.parse_mut_restriction = function (this: Parser): PResult<ast.MutRestriction> {
  if (this.eat_keyword(exp.Mut)) {
    const r = this.parse_restriction(gen.ParsingRestrictionKind.Mut);
    if (r.$ === "Err") return r;
    const [kind, span, gated_span] = r._0;
    this.psess.gated_spans.gate(sym.mut_restriction, gated_span);
    return Ok({ kind, span });
  }
  return Ok({
    kind: ast.RestrictionKind.Unrestricted,
    // NOTE: this span is later thrown away
    //  as a part of FieldDef size optimization.
    span: Span.shrink_to_lo(this.token.span),
  });
};

/// Parses `impl` or `mut` restrictions.
/// Returns the parsed restriction and its span, as well as the gated span.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1575 parse_restriction
Parser.prototype.parse_restriction = function (
  this: Parser,
  restriction_kind: ParsingRestrictionKind,
): PResult<[ast.RestrictionKind, Span, Span]> {
  const lo = this.prev_token.span;
  // No units or tuples are allowed to follow `impl` or `mut` here, so we can safely bump `(`.
  const r0 = this.expect(exp.OpenParen);
  if (r0.$ === "Err") return r0;
  if (this.eat_keyword(exp.In)) {
    const r = this.parse_path(PathStyle.Mod); // `in path`
    if (r.$ === "Err") return r;
    const path = r._0;
    const r2 = this.expect(exp.CloseParen); // `)`
    if (r2.$ === "Err") return r2;
    const restriction: ast.RestrictionKind = { $: "Restricted", path, id: ast.DUMMY_NODE_ID, shorthand: false };
    const span = Span.to(lo, this.prev_token.span);
    return Ok([restriction, span, span]);
  } else if (
    this.look_ahead(1, (t) => t.eq(TK.CloseParen)) &&
    this.is_keyword_ahead(0, [kw.Crate, kw.Super, kw.SelfLower])
  ) {
    const r = this.parse_path(PathStyle.Mod); // `crate`/`super`/`self`
    if (r.$ === "Err") return r;
    const path = r._0;
    const r2 = this.expect(exp.CloseParen); // `)`
    if (r2.$ === "Err") return r2;
    const restriction: ast.RestrictionKind = { $: "Restricted", path, id: ast.DUMMY_NODE_ID, shorthand: true };
    const span = Span.to(lo, this.prev_token.span);
    return Ok([restriction, span, span]);
  } else {
    // Emit diagnostic, but continue with no restrictions.
    // Recovery for `impl(something) trait` or `mut (something) field`.
    const r = this.parse_path(PathStyle.Mod);
    if (r.$ === "Err") return r;
    const path = r._0;
    const r2 = this.expect(exp.CloseParen); // `)`
    if (r2.$ === "Err") return r2;
    const path_str = pprust.path_to_string(path);
    const end = this.prev_token.span;
    switch (restriction_kind) {
      case "Impl":
        this.dcx().emit_err(IncorrectImplRestriction_diagnostic({ span: path.span, inner_str: path_str }));
        break;
      case "Mut":
        this.dcx().emit_err(IncorrectMutRestriction_diagnostic({ span: path.span, inner_str: path_str }));
        break;
    }
    return Ok([ast.RestrictionKind.Unrestricted, Span.shrink_to_lo(this.token.span), Span.to(lo, end)]);
  }
};

/// Parses `extern string_literal?`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1628 parse_extern
Parser.prototype.parse_extern = function (this: Parser, case_: Case): ast.Extern {
  if (this.eat_keyword_case(exp.Extern, case_)) {
    let extern_span = this.prev_token.span;
    const abi = this.parse_abi();
    if (abi !== undefined) {
      extern_span = Span.to(extern_span, abi.span);
    }
    return ast.Extern.from_abi(abi, extern_span);
  } else {
    return ast.Extern.None;
  }
};

/// Parses a string literal as an ABI spec.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1642 parse_abi
Parser.prototype.parse_abi = function (this: Parser): ast.StrLit | undefined {
  const r = this.parse_str_lit();
  if (r.$ === "Ok") {
    const str_lit = r._0;
    return str_lit;
  }
  const lit = r._0;
  if (lit !== undefined) {
    if (lit.kind.$ === "Err") {
      return undefined;
    } else {
      this.dcx().emit_err(NonStringAbiLiteral_diagnostic({ span: lit.span }));
      return undefined;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1656 collect_tokens_no_attrs
Parser.prototype.collect_tokens_no_attrs = function <R>(
  this: Parser,
  f: (this_: Parser) => PResult<R>,
  R_HasTokens: HasTokens<R>,
  R_HasAttrs: HasAttrs<R>,
): PResult<R> {
  // The only reason to call `collect_tokens_no_attrs` is if you want tokens, so use
  // `ForceCollect::Yes`
  return this.collect_tokens(
    undefined,
    AttrWrapperC.empty(),
    gen.ForceCollect.Yes,
    (this_, _empty_attrs) => {
      const r = f(this_);
      if (r.$ === "Err") return r;
      return Ok([r._0, Trailing.No, "No" as UsePreAttrPos]);
    },
    R_HasTokens,
    R_HasAttrs,
  );
};

/// Checks for `::` or, potentially, `:::` and then look ahead after it.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1668 check_path_sep_and_look_ahead
Parser.prototype.check_path_sep_and_look_ahead = function (this: Parser, looker: (a0: Token) => boolean): boolean {
  if (this.check(exp.PathSep)) {
    if (this.may_recover() && this.look_ahead(1, (t) => t.kind.$ === "Colon")) {
      // debug_assert!(!self.look_ahead(1, &looker), "Looker must not match on colon");
      return this.look_ahead(2, looker);
    } else {
      return this.look_ahead(1, looker);
    }
  } else {
    return false;
  }
};

/// `::{` or `::*`
// rustc: compiler/rustc_parse/src/parser/mod.rs:1682 is_import_coupler
Parser.prototype.is_import_coupler = function (this: Parser): boolean {
  return this.check_path_sep_and_look_ahead((t) => t.kind.$ === "OpenBrace" || t.kind.$ === "Star");
};

// Debug view of the parser's token stream, up to `{lookahead}` tokens.
// Only used when debugging.
// PORT: returns the `fmt::from_fn` closure as a `(f: Fmt) => string`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1689 debug_lookahead
Parser.prototype.debug_lookahead = function (this: Parser, lookahead: number): (f: Fmt) => string {
  return (f: Fmt): string => {
    // or at least, one view of
    const fields: [string, string][] = [];

    // we don't need N spans, but we want at least one, so print all of prev_token
    fields.push(["prev_token", token.debug_Token(this.prev_token, f)]);
    const tokens: TokenKind[] = [];
    for (let i = 0; i < lookahead; i++) {
      const tok = this.look_ahead(i, (tok) => tok.kind);
      const is_eof = token.TokenKind_eq(tok, TK.Eof);
      tokens.push(tok);
      if (is_eof) {
        // Don't look ahead past EOF.
        break;
      }
    }
    fields.push(["tokens", debug_list(f, tokens.map((t) => token.debug_TokenKind(t, f)))]);
    fields.push(["approx_token_stream_pos", String(this.num_bump_calls)]);

    // some fields are interesting for certain values, as they relate to macro parsing
    const subparser = this.subparser_name;
    if (subparser !== undefined) {
      fields.push(["subparser_name", debug_str(subparser)]);
    }
    if (this.recovery_ === Recovery.Forbidden) {
      fields.push(["recovery", this.recovery_]);
    }

    // imply there's "more to know" than this view
    return debug_struct_finish_non_exhaustive(f, "Parser", fields);
  };
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1721 clear_expected_token_types
Parser.prototype.clear_expected_token_types = function (this: Parser): void {
  this.expected_token_types.clear();
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1725 approx_token_stream_pos
Parser.prototype.approx_token_stream_pos = function (this: Parser): number {
  return this.num_bump_calls;
};

/// For interpolated `self.token`, returns a span of the fragment to which
/// the interpolated token refers. For all other tokens this is just a
/// regular span. It is particularly important to use this for identifiers
/// and lifetimes for which spans affect name resolution and edition
/// checks. Note that keywords are also identifiers, so they should use
/// this if they keep spans or perform edition checks.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1735 token_uninterpolated_span
Parser.prototype.token_uninterpolated_span = function (this: Parser): Span {
  const k = this.token.kind;
  switch (k.$) {
    case "NtIdent":
    case "NtLifetime":
      return k._0.span;
    case "OpenInvisible":
      if (k._0.$ === "MetaVar") return this.look_ahead(1, (t) => t.span);
      return this.token.span;
    default:
      return this.token.span;
  }
};

/// Like `token_uninterpolated_span`, but works on `self.prev_token`.
// rustc: compiler/rustc_parse/src/parser/mod.rs:1744 prev_token_uninterpolated_span
Parser.prototype.prev_token_uninterpolated_span = function (this: Parser): Span {
  const k = this.prev_token.kind;
  switch (k.$) {
    case "NtIdent":
    case "NtLifetime":
      return k._0.span;
    case "OpenInvisible":
      if (k._0.$ === "MetaVar") return this.look_ahead(0, (t) => t.span);
      return this.prev_token.span;
    default:
      return this.prev_token.span;
  }
};

// rustc: compiler/rustc_parse/src/parser/mod.rs:1752 missing_semi_from_binop
Parser.prototype.missing_semi_from_binop = function (
  this: Parser,
  kind_desc: string,
  expr: ast.Expr,
  decl_lo: Span | undefined,
): [Span, ErrorGuaranteed] | undefined {
  if (this.token.eq(TK.Semi)) {
    return undefined;
  }
  if (!this.may_recover() || Span.from_expansion(expr.span)) {
    return undefined;
  }
  const sm = this.psess.source_map();
  const ek = expr.kind;
  if (ek.$ === "Binary") {
    const op = ek._0;
    const lhs = ek._1;
    const rhs = ek._2;
    if (
      sm.is_multiline(Span.until(Span.shrink_to_hi(lhs.span), Span.shrink_to_lo(rhs.span))) &&
      (op.node === ast.BinOpKind.Mul || op.node === ast.BinOpKind.BitAnd) &&
      expr_requires_semi_to_be_stmt(rhs)
    ) {
      const lhs_end_span = Span.shrink_to_hi(lhs.span);
      const token_str = token_descr(this.token);
      const err = this.dcx().struct_span_err(lhs_end_span, `expected \`;\`, found ${token_str}`);
      err.span_label(this.token.span, "unexpected token");

      // Use the declaration start if provided, otherwise fall back to lhs_end_span.
      const continuation_start = decl_lo ?? lhs_end_span;
      const continuation_span = Span.until(continuation_start, Span.shrink_to_hi(rhs.span));
      err.span_label(continuation_span, `to finish parsing this ${kind_desc}, expected this to be followed by a \`;\``);
      let op_desc: string;
      switch (op.node) {
        case ast.BinOpKind.BitAnd:
          op_desc = "a bit-and";
          break;
        case ast.BinOpKind.Mul:
          op_desc = "a multiplication";
          break;
        default:
          op_desc = "a binary";
          break;
      }
      const note_spans = MultiSpan.new();
      note_spans.push_span_label(lhs.span, "parsed as the left-hand expression");
      note_spans.push_span_label(rhs.span, "parsed as the right-hand expression");
      note_spans.push_span_label(op.span, `this was parsed as ${op_desc}`);
      err.span_note(note_spans, `the ${kind_desc} was parsed as having ${op_desc} binary expression`);

      err.span_suggestion_verbose(
        lhs_end_span,
        `you may have meant to write a \`;\` to terminate the ${kind_desc} earlier`,
        ";",
        Applicability.MaybeIncorrect,
      );
      return [lhs.span, err.emit_err()];
    }
  }
  return undefined;
};

// ---- local helpers (no upstream fn) ----

/// PORT: `str::eq_ignore_ascii_case` (byte-wise; equal UTF-16 code units <=> equal UTF-8 bytes).
function eq_ignore_ascii_case(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x >= 0x41 && x <= 0x5a) x += 0x20;
    if (y >= 0x41 && y <= 0x5a) y += 0x20;
    if (x !== y) return false;
  }
  return true;
}

/// PORT: `DebugStruct::finish_non_exhaustive` (core::fmt::builders), not in src/std/fmt.ts yet.
function debug_struct_finish_non_exhaustive(f: Fmt, name: string, fields: [string, string][]): string {
  if (f.alternate) {
    let s = name + " {\n";
    for (const [k, v] of fields) s += "    " + k + ": " + v.replaceAll("\n", "\n    ") + ",\n";
    return s + "    ..\n}";
  }
  if (fields.length === 0) return name + " { .. }";
  return name + " { " + fields.map(([k, v]) => `${k}: ${v}`).join(", ") + ", .. }";
}

// Metavar captures of various kinds. The more complex node kinds (e.g. `Item`, `Expr`) store
// tokens in the node itself because those tokens are needed for non-terminal parsing and for other
// reasons (e.g. cfg expansion). Simpler node kinds (e.g. `Block`, `Path`) only need tokens for
// non-terminal parsing so here they store the tokens next to the node, keeping the node size
// smaller.
// (`ParseNtResult`, mod.rs:1818, is generated into mod.gen.ts.)
