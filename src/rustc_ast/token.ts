// Port of compiler/rustc_ast/src/token.rs
// Types and derived Debug impls are generated into token.gen.ts (tools/codegen/types.ts).
//
// PORT: method placement (PORTING §8).
// - Enum methods live on the companion const, which this module re-defines as
//   `{ ...gen.X, methods }` (safe at init: token.gen.ts is only entered through this module).
// - `Lit` and `Token` are generated classes. Their static fns (`Lit::new`, `Token::new`, ...) are
//   assigned onto the generated class, re-exported here with the extended type.
//   Their `&self` methods are attached to the prototype and declared via `declare module`
//   (PORTING "Methods defined in another file").
// - `pub use TokenKind::*` etc.: callers write `TokenKind.Eq`, `LitKind.Str`, ...
// - Equality: `self.kind == PathSep` against a unit variant is a `$` comparison; the derived
//   `PartialEq` impls used elsewhere are the `<Type>_eq` functions at the end of this file.
// - `Token` is `Copy` upstream. TS `Token`s are shared objects: never mutate one in place that you
//   did not create; constructing a new `Token` is the TS spelling of a copy.
import { type Edition, Edition as EditionC } from "../rustc_span/edition.ts";
import { BytePos, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { display_Symbol, Ident as SpIdent, IdentPrintMode, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { assert, panic, unreachable } from "../std/panic.ts";
import { Case } from "./util/case.ts";
import * as gen from "./token.gen.ts";
import type {
  CommentKind,
  IdentKind as IdentKindT,
  InvisibleOrigin as InvisibleOriginT,
  LitKind as LitKindT,
  MetaVarKind,
  NonterminalKind as NonterminalKindT,
  NtExprKind,
  NtPatKind,
  TokenKind as TokenKindT,
} from "./token.gen.ts";

export * from "./token.gen.ts";

export type DocFragmentKind = gen.DocFragmentKind;
export const DocFragmentKind = {
  // rustc: compiler/rustc_ast/src/token.rs:26 is_sugared
  is_sugared(self: DocFragmentKind): boolean {
    return self.$ === "Sugared";
  },

  /// If it is `Sugared`, it will return its associated `CommentKind`, otherwise it will return
  /// `CommentKind::Line`.
  // rustc: compiler/rustc_ast/src/token.rs:32 comment_kind
  comment_kind(self: DocFragmentKind): CommentKind {
    switch (self.$) {
      case "Sugared":
        return self._0;
      case "Raw":
        return gen.CommentKind.Line;
    }
  },
};

export type InvisibleOrigin = InvisibleOriginT;
export const InvisibleOrigin = {
  ...gen.InvisibleOrigin,

  // Should the parser skip these invisible delimiters? Ideally this function
  // will eventually disappear and no invisible delimiters will be skipped.
  // rustc: compiler/rustc_ast/src/token.rs:60 skip
  skip(self: InvisibleOrigin): boolean {
    switch (self.$) {
      case "MetaVar":
        return false;
      case "ProcMacro":
        return true;
    }
  },
};

// impl fmt::Display for MetaVarKind
// rustc: compiler/rustc_ast/src/token.rs:99 fmt
export function display_MetaVarKind(self: MetaVarKind): string {
  let sym_: Symbol;
  switch (self.$) {
    case "Item":
      sym_ = sym.item;
      break;
    case "Block":
      sym_ = sym.block;
      break;
    case "Stmt":
      sym_ = sym.stmt;
      break;
    case "Pat":
      if ((self._0.$ === "PatParam" && self._0.inferred === true) || self._0.$ === "PatWithOr") {
        sym_ = sym.pat;
      } else {
        // MetaVarKind::Pat(PatParam { inferred: false })
        sym_ = sym.pat_param;
      }
      break;
    case "Expr":
      if ((self.kind.$ === "Expr2021" && self.kind.inferred === true) || self.kind.$ === "Expr") {
        sym_ = sym.expr;
      } else {
        // MetaVarKind::Expr { kind: Expr2021 { inferred: false }, .. }
        sym_ = sym.expr_2021;
      }
      break;
    case "Ty":
      sym_ = sym.ty;
      break;
    case "Ident":
      sym_ = sym.ident;
      break;
    case "Lifetime":
      sym_ = sym.lifetime;
      break;
    case "Literal":
      sym_ = sym.literal;
      break;
    case "Meta":
      sym_ = sym.meta;
      break;
    case "Path":
      sym_ = sym.path;
      break;
    case "Vis":
      sym_ = sym.vis;
      break;
    case "Guard":
      sym_ = sym.guard;
      break;
    case "TT":
      sym_ = sym.tt;
      break;
  }
  return display_Symbol(sym_);
}

export type Delimiter = gen.Delimiter;
export const Delimiter = {
  ...gen.Delimiter,

  // Should the parser skip these delimiters? Only happens for certain kinds
  // of invisible delimiters. Ideally this function will eventually disappear
  // and no invisible delimiters will be skipped.
  // rustc: compiler/rustc_ast/src/token.rs:146 skip
  skip(self: Delimiter): boolean {
    switch (self.$) {
      case "Parenthesis":
      case "Bracket":
      case "Brace":
        return false;
      case "Invisible":
        return InvisibleOrigin.skip(self._0);
    }
  },

  // This exists because `InvisibleOrigin`s should not be compared. It is only used for
  // assertions.
  // rustc: compiler/rustc_ast/src/token.rs:155 eq_ignoring_invisible_origin
  eq_ignoring_invisible_origin(self: Delimiter, other: Delimiter): boolean {
    if (self.$ === "Parenthesis" && other.$ === "Parenthesis") return true;
    if (self.$ === "Brace" && other.$ === "Brace") return true;
    if (self.$ === "Bracket" && other.$ === "Bracket") return true;
    if (self.$ === "Invisible" && other.$ === "Invisible") return true;
    return false;
  },

  // rustc: compiler/rustc_ast/src/token.rs:165 as_open_token_kind
  as_open_token_kind(self: Delimiter): TokenKind {
    switch (self.$) {
      case "Parenthesis":
        return gen.TokenKind.OpenParen;
      case "Brace":
        return gen.TokenKind.OpenBrace;
      case "Bracket":
        return gen.TokenKind.OpenBracket;
      case "Invisible":
        return { $: "OpenInvisible", _0: self._0 };
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:174 as_close_token_kind
  as_close_token_kind(self: Delimiter): TokenKind {
    switch (self.$) {
      case "Parenthesis":
        return gen.TokenKind.CloseParen;
      case "Brace":
        return gen.TokenKind.CloseBrace;
      case "Bracket":
        return gen.TokenKind.CloseBracket;
      case "Invisible":
        return { $: "CloseInvisible", _0: self._0 };
    }
  },
};

declare module "./token.gen.ts" {
  interface Lit {
    is_semantic_float(): boolean;
  }
  interface Token {
    is_range_separator(): boolean;
    is_punct(): boolean;
    is_like_plus(): boolean;
    can_begin_expr(): boolean;
    can_begin_pattern(pat_kind: NtPatKind): boolean;
    can_begin_type(): boolean;
    can_begin_const_arg(): boolean;
    can_begin_item(): boolean;
    is_lit(): boolean;
    can_begin_literal_maybe_minus(): boolean;
    can_begin_string_literal(): boolean;
    uninterpolate(): Token;
    ident(): [SpIdent, IdentKindT] | undefined;
    lifetime(): [SpIdent, IdentKindT] | undefined;
    is_ident(): boolean;
    is_lifetime(): boolean;
    is_ident_named(name: Symbol): boolean;
    is_metavar_expr(): boolean;
    is_metavar_block(): boolean;
    is_mutability(): boolean;
    is_qpath_start(): boolean;
    is_path_start(): boolean;
    is_keyword(kw: Symbol): boolean;
    is_keyword_case(kw: Symbol, case_: Case): boolean;
    is_path_segment_keyword(): boolean;
    is_special_ident(): boolean;
    is_used_keyword(): boolean;
    is_unused_keyword(): boolean;
    is_reserved_ident(): boolean;
    is_non_reserved_ident(): boolean;
    non_reserved_ident(): SpIdent | undefined;
    non_raw_ident(): SpIdent | undefined;
    is_bool_lit(): boolean;
    is_numeric_lit(): boolean;
    is_integer_lit(): boolean;
    is_metavar_seq(): MetaVarKind | undefined;
    glue(joint: Token): Token | undefined;
    eq(rhs: TokenKindT): boolean;
  }
}

export type Lit = gen.Lit;
// PORT: statics of the generated class, attached below in upstream order.
export const Lit = gen.Lit as typeof gen.Lit & {
  "new": (kind: LitKind, symbol: Symbol, suffix: Symbol | undefined) => Lit;
  from_token: (token: Token) => Lit | undefined;
};

// rustc: compiler/rustc_ast/src/token.rs:213 new
Lit.new = function (kind: LitKind, symbol: Symbol, suffix: Symbol | undefined): Lit {
  return new gen.Lit(kind, symbol, suffix);
};

// rustc: compiler/rustc_ast/src/token.rs:219 is_semantic_float
gen.Lit.prototype.is_semantic_float = function (this: Lit): boolean {
  switch (this.kind.$) {
    case "Float":
      return true;
    case "Integer":
      if (this.suffix !== undefined) {
        const sym_ = this.suffix;
        return sym_ === sym.f32 || sym_ === sym.f64;
      } else {
        return false;
      }
    default:
      return false;
  }
};

// rustc: compiler/rustc_ast/src/token.rs:232 from_token
Lit.from_token = function (token: Token): Lit | undefined {
  const kind = token.uninterpolate().kind;
  if (kind.$ === "Ident" && (kind._1 === "Normal" || kind._1 === "ForcedKeyword") && Symbol.is_bool_lit(kind._0)) {
    const name = kind._0;
    return Lit.new(gen.LitKind.Bool, name, undefined);
  }
  if (kind.$ === "Literal") {
    const token_lit = kind._0;
    return token_lit;
  }
  if (
    kind.$ === "OpenInvisible" &&
    kind._0.$ === "MetaVar" &&
    (kind._0._0.$ === "Literal" || kind._0._0.$ === "Expr")
  ) {
    // Unreachable with the current test suite.
    panic("from_token metavar");
  }
  return undefined;
};

// impl fmt::Display for Lit
// rustc: compiler/rustc_ast/src/token.rs:250 fmt
export function display_Lit(self: Lit): string {
  const { kind, symbol, suffix } = self;
  let f = "";
  switch (kind.$) {
    case "Byte":
      f += `b'${display_Symbol(symbol)}'`;
      break;
    case "Char":
      f += `'${display_Symbol(symbol)}'`;
      break;
    case "Str":
      f += `"${display_Symbol(symbol)}"`;
      break;
    case "StrRaw": {
      const delim = "#".repeat(kind._0);
      f += `r${delim}"${display_Symbol(symbol)}"${delim}`;
      break;
    }
    case "ByteStr":
      f += `b"${display_Symbol(symbol)}"`;
      break;
    case "ByteStrRaw": {
      const delim = "#".repeat(kind._0);
      f += `br${delim}"${display_Symbol(symbol)}"${delim}`;
      break;
    }
    case "CStr":
      f += `c"${display_Symbol(symbol)}"`;
      break;
    case "CStrRaw": {
      const delim = "#".repeat(kind._0);
      f += `cr${delim}"${display_Symbol(symbol)}"${delim}`;
      break;
    }
    case "Integer":
    case "Float":
    case "Bool":
    case "Err":
      f += display_Symbol(symbol);
      break;
  }

  if (suffix !== undefined) {
    f += display_Symbol(suffix);
  }

  return f;
}

export type LitKind = LitKindT;
export const LitKind = {
  ...gen.LitKind,

  // rustc: compiler/rustc_ast/src/token.rs:286 article
  article(self: LitKind): string {
    switch (self.$) {
      case "Integer":
      case "Err":
        return "an";
      default:
        return "a";
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:293 descr
  descr(self: LitKind): string {
    switch (self.$) {
      case "Bool":
        return "boolean";
      case "Byte":
        return "byte";
      case "Char":
        return "char";
      case "Integer":
        return "integer";
      case "Float":
        return "float";
      case "Str":
      case "StrRaw":
        return "string";
      case "ByteStr":
      case "ByteStrRaw":
        return "byte string";
      case "CStr":
      case "CStrRaw":
        return "C string";
      case "Err":
        return "error";
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:307 may_have_suffix
  may_have_suffix(self: LitKind): boolean {
    return self.$ === "Integer" || self.$ === "Float" || self.$ === "Err";
  },
};

// rustc: compiler/rustc_ast/src/token.rs:312 ident_can_begin_expr
export function ident_can_begin_expr(name: Symbol, span: Span, kind: IdentKind): boolean {
  // WARNING: Take care when modifying this function! It will change the stable(!) set of
  //          tokens that are allowed to match an `expr` nonterminal which is user observable.

  const ident_token = Token.new({ $: "Ident", _0: name, _1: kind }, span);

  // FIXME: Remove `box` from this list given we officially no longer support box expressions
  //        (#108471) (needs lang FCP as it affects stable macro matching behavior).
  return (
    !ident_token.is_reserved_ident() ||
    ident_token.is_path_segment_keyword() ||
    [
      kw.Async,
      kw.Do,
      kw.Box,
      kw.Break,
      kw.Const,
      kw.Continue,
      kw.False,
      kw.For,
      kw.Gen,
      kw.If,
      kw.Let,
      kw.Loop,
      kw.Match,
      kw.Move,
      kw.Return,
      kw.True,
      kw.Try,
      kw.Unsafe,
      kw.While,
      kw.Yield,
      kw.Safe,
      kw.Static,
    ].includes(name)
  );
}

// rustc: compiler/rustc_ast/src/token.rs:349 ident_can_begin_type
function ident_can_begin_type(name: Symbol, span: Span, kind: IdentKind): boolean {
  // WARNING: Take care when modifying this function! It will change the stable(!) set of
  //          tokens that are allowed to match an `ty` nonterminal which is user observable.

  const ident_token = Token.new({ $: "Ident", _0: name, _1: kind }, span);

  return (
    !ident_token.is_reserved_ident() ||
    ident_token.is_path_segment_keyword() ||
    [kw.Underscore, kw.For, kw.Impl, kw.Fn, kw.Unsafe, kw.Extern, kw.Typeof, kw.Dyn].includes(name)
  );
}

export type IdentKind = IdentKindT;
export const IdentKind = {
  ...gen.IdentKind,

  // rustc: compiler/rustc_ast/src/token.rs:369 to_print_mode_ident
  to_print_mode_ident(self: IdentKind): IdentPrintMode {
    switch (self) {
      case "Normal":
        return IdentPrintMode.Normal;
      case "Raw":
        return IdentPrintMode.RawIdent;
      case "ForcedKeyword":
        return IdentPrintMode.ForcedKeywordIdent;
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:377 to_print_mode_lifetime
  to_print_mode_lifetime(self: IdentKind): IdentPrintMode {
    switch (self) {
      case "Normal":
        return IdentPrintMode.Normal;
      case "Raw":
        return IdentPrintMode.RawLifetime;
      case "ForcedKeyword":
        return unreachable();
    }
  },
};

export type TokenKind = TokenKindT;
export const TokenKind = {
  ...gen.TokenKind,

  // rustc: compiler/rustc_ast/src/token.rs:543 lit
  lit(kind: LitKind, symbol: Symbol, suffix: Symbol | undefined): TokenKind {
    return { $: "Literal", _0: Lit.new(kind, symbol, suffix) };
  },

  /// An approximation to proc-macro-style single-character operators used by
  /// rustc parser. If the operator token can be broken into two tokens, the
  /// first of which has `n` (1 or 2) chars, then this function performs that
  /// operation, otherwise it returns `None`.
  // rustc: compiler/rustc_ast/src/token.rs:551 break_two_token_op
  break_two_token_op(self: TokenKind, n: number): [TokenKind, TokenKind] | undefined {
    assert(n === 1 || n === 2, "assertion failed: n == 1 || n == 2");
    const K = gen.TokenKind;
    switch (self.$) {
      case "Le":
        if (n === 1) return [K.Lt, K.Eq];
        break;
      case "EqEq":
        if (n === 1) return [K.Eq, K.Eq];
        break;
      case "Ne":
        if (n === 1) return [K.Bang, K.Eq];
        break;
      case "Ge":
        if (n === 1) return [K.Gt, K.Eq];
        break;
      case "AndAnd":
        if (n === 1) return [K.And, K.And];
        break;
      case "OrOr":
        if (n === 1) return [K.Or, K.Or];
        break;
      case "Shl":
        if (n === 1) return [K.Lt, K.Lt];
        break;
      case "Shr":
        if (n === 1) return [K.Gt, K.Gt];
        break;
      case "PlusEq":
        if (n === 1) return [K.Plus, K.Eq];
        break;
      case "MinusEq":
        if (n === 1) return [K.Minus, K.Eq];
        break;
      case "StarEq":
        if (n === 1) return [K.Star, K.Eq];
        break;
      case "SlashEq":
        if (n === 1) return [K.Slash, K.Eq];
        break;
      case "PercentEq":
        if (n === 1) return [K.Percent, K.Eq];
        break;
      case "CaretEq":
        if (n === 1) return [K.Caret, K.Eq];
        break;
      case "AndEq":
        if (n === 1) return [K.And, K.Eq];
        break;
      case "OrEq":
        if (n === 1) return [K.Or, K.Eq];
        break;
      case "ShlEq":
        if (n === 1) return [K.Lt, K.Le]; // `<` + `<=`
        if (n === 2) return [K.Shl, K.Eq]; // `<<` + `=`
        break;
      case "ShrEq":
        if (n === 1) return [K.Gt, K.Ge]; // `>` + `>=`
        if (n === 2) return [K.Shr, K.Eq]; // `>>` + `=`
        break;
      case "DotDot":
        if (n === 1) return [K.Dot, K.Dot];
        break;
      case "DotDotDot":
        if (n === 1) return [K.Dot, K.DotDot]; // `.` + `..`
        if (n === 2) return [K.DotDot, K.Dot]; // `..` + `.`
        break;
      case "DotDotEq":
        if (n === 2) return [K.DotDot, K.Eq];
        break;
      case "PathSep":
        if (n === 1) return [K.Colon, K.Colon];
        break;
      case "RArrow":
        if (n === 1) return [K.Minus, K.Gt];
        break;
      case "LArrow":
        if (n === 1) return [K.Lt, K.Minus];
        break;
      case "FatArrow":
        if (n === 1) return [K.Eq, K.Gt];
        break;
    }
    return undefined;
  },

  /// Returns tokens that are likely to be typed accidentally instead of the current token.
  /// Enables better error recovery when the wrong token is found.
  // rustc: compiler/rustc_ast/src/token.rs:588 similar_tokens
  similar_tokens(self: TokenKind): readonly TokenKind[] {
    const K = gen.TokenKind;
    switch (self.$) {
      case "Comma":
        return [K.Dot, K.Lt, K.Semi];
      case "Semi":
        return [K.Colon, K.Comma];
      case "Colon":
        return [K.Semi];
      case "FatArrow":
        return [K.Eq, K.RArrow, K.Ge, K.Gt];
      default:
        return [];
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:598 should_end_const_arg
  should_end_const_arg(self: TokenKind): boolean {
    return self.$ === "Gt" || self.$ === "Ge" || self.$ === "Shr" || self.$ === "ShrEq";
  },

  // rustc: compiler/rustc_ast/src/token.rs:602 is_delim
  is_delim(self: TokenKind): boolean {
    return TokenKind.open_delim(self) !== undefined || TokenKind.close_delim(self) !== undefined;
  },

  // rustc: compiler/rustc_ast/src/token.rs:606 open_delim
  open_delim(self: TokenKind): Delimiter | undefined {
    switch (self.$) {
      case "OpenParen":
        return Delimiter.Parenthesis;
      case "OpenBrace":
        return Delimiter.Brace;
      case "OpenBracket":
        return Delimiter.Bracket;
      case "OpenInvisible":
        return { $: "Invisible", _0: self._0 };
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:616 close_delim
  close_delim(self: TokenKind): Delimiter | undefined {
    switch (self.$) {
      case "CloseParen":
        return Delimiter.Parenthesis;
      case "CloseBrace":
        return Delimiter.Brace;
      case "CloseBracket":
        return Delimiter.Bracket;
      case "CloseInvisible":
        return { $: "Invisible", _0: self._0 };
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:626 is_close_delim_or_eof
  is_close_delim_or_eof(self: TokenKind): boolean {
    switch (self.$) {
      case "CloseParen":
      case "CloseBrace":
      case "CloseBracket":
      case "CloseInvisible":
      case "Eof":
        return true;
      default:
        return false;
    }
  },
};

export type Token = gen.Token;
// PORT: statics of the generated class, attached below in upstream order.
export const Token = gen.Token as typeof gen.Token & {
  "new": (kind: TokenKind, span: Span) => Token;
  dummy: () => Token;
  from_ast_ident: (ident: SpIdent) => Token;
};

// rustc: compiler/rustc_ast/src/token.rs:635 new
Token.new = function (kind: TokenKind, span: Span): Token {
  return new gen.Token(kind, span);
};

/// Some token that will be thrown away later.
// rustc: compiler/rustc_ast/src/token.rs:640 dummy
Token.dummy = function (): Token {
  return Token.new(gen.TokenKind.Question, DUMMY_SP);
};

/// Recovers a `Token` from an `Ident`.
///
/// This creates a raw identifier if necessary.
/// It will never create a forced keyword.
// rustc: compiler/rustc_ast/src/token.rs:648 from_ast_ident
Token.from_ast_ident = function (ident: SpIdent): Token {
  const kind = ident.is_raw_guess() ? IdentKind.Raw : IdentKind.Normal;
  return Token.new({ $: "Ident", _0: ident.name, _1: kind }, ident.span);
};

// rustc: compiler/rustc_ast/src/token.rs:653 is_range_separator
gen.Token.prototype.is_range_separator = function (this: Token): boolean {
  return [gen.TokenKind.DotDot, gen.TokenKind.DotDotDot, gen.TokenKind.DotDotEq].some((k) => TokenKind_eq(k, this.kind));
};

// rustc: compiler/rustc_ast/src/token.rs:657 is_punct
gen.Token.prototype.is_punct = function (this: Token): boolean {
  switch (this.kind.$) {
    case "Eq":
    case "Lt":
    case "Le":
    case "EqEq":
    case "Ne":
    case "Ge":
    case "Gt":
    case "AndAnd":
    case "OrOr":
    case "Bang":
    case "Tilde":
    case "Plus":
    case "Minus":
    case "Star":
    case "Slash":
    case "Percent":
    case "Caret":
    case "And":
    case "Or":
    case "Shl":
    case "Shr":
    case "PlusEq":
    case "MinusEq":
    case "StarEq":
    case "SlashEq":
    case "PercentEq":
    case "CaretEq":
    case "AndEq":
    case "OrEq":
    case "ShlEq":
    case "ShrEq":
    case "At":
    case "Dot":
    case "DotDot":
    case "DotDotDot":
    case "DotDotEq":
    case "Comma":
    case "Semi":
    case "Colon":
    case "PathSep":
    case "RArrow":
    case "LArrow":
    case "FatArrow":
    case "Pound":
    case "Dollar":
    case "Question":
    case "SingleQuote":
      return true;

    case "OpenParen":
    case "CloseParen":
    case "OpenBrace":
    case "CloseBrace":
    case "OpenBracket":
    case "CloseBracket":
    case "OpenInvisible":
    case "CloseInvisible":
    case "Literal":
    case "DocComment":
    case "Ident":
    case "NtIdent":
    case "Lifetime":
    case "NtLifetime":
    case "Eof":
      return false;
  }
};

// rustc: compiler/rustc_ast/src/token.rs:671 is_like_plus
gen.Token.prototype.is_like_plus = function (this: Token): boolean {
  return this.kind.$ === "Plus" || this.kind.$ === "PlusEq";
};

/// Returns `true` if the token can appear at the start of an expression.
// rustc: compiler/rustc_ast/src/token.rs:676 can_begin_expr
gen.Token.prototype.can_begin_expr = function (this: Token): boolean {
  // WARNING: Take care when modifying this function! It will change the stable(!) set of
  //          tokens that are allowed to match an `expr` nonterminal which is user observable.

  const kind = this.uninterpolate().kind;
  switch (kind.$) {
    case "Ident":
      return ident_can_begin_expr(kind._0, this.span, kind._1); // value name or keyword
    case "OpenParen": // tuple
    case "OpenBrace": // block
    case "OpenBracket": // array
    case "Literal": // literal
    case "Bang": // operator not
    case "Minus": // unary minus
    case "Star": // dereference
    case "Or":
    case "OrOr": // closure
    case "And": // reference
    case "AndAnd": // double reference
    // DotDotDot is no longer supported, but we need some way to display the error
    case "DotDot":
    case "DotDotDot":
    case "DotDotEq": // range notation
    case "Lt":
    case "Shl": // associated path
    case "PathSep": // global path
    case "Lifetime": // labeled loop
    case "Pound": // expression attributes
      return true;
    case "OpenInvisible":
      if (
        kind._0.$ === "MetaVar" &&
        (kind._0._0.$ === "Block" || kind._0._0.$ === "Expr" || kind._0._0.$ === "Literal" || kind._0._0.$ === "Path")
      ) {
        return true;
      }
      return false;
    default:
      return false;
  }
};

/// Returns `true` if the token can appear at the start of a pattern.
// rustc: compiler/rustc_ast/src/token.rs:710 can_begin_pattern
gen.Token.prototype.can_begin_pattern = function (this: Token, pat_kind: NtPatKind): boolean {
  // WARNING: Take care when modifying this function! It will change the stable(!) set of
  //          tokens that are allowed to match an `pat` nonterminal which is user observable.

  const kind = this.uninterpolate().kind;
  switch (kind.$) {
    // box, ref, mut, and other identifiers (can stricten)
    case "Ident":
    case "NtIdent":
    case "OpenParen": // tuple pattern
    case "OpenBracket": // slice pattern
    case "And": // reference
    case "Minus": // negative literal
    case "AndAnd": // double reference
    case "Literal": // literal
    case "DotDot": // range pattern (future compat)
    case "DotDotDot": // range pattern (future compat)
    case "PathSep": // path
    case "Lt": // path (UFCS constant)
    case "Shl": // path (double UFCS)
      return true;
    case "Or":
      return pat_kind.$ === "PatWithOr"; // leading vert `|` or-pattern
    case "OpenInvisible": {
      const o = kind._0;
      if (
        o.$ === "MetaVar" &&
        (o._0.$ === "Expr" ||
          o._0.$ === "Literal" ||
          o._0.$ === "Meta" ||
          o._0.$ === "Pat" ||
          o._0.$ === "Path" ||
          o._0.$ === "Ty")
      ) {
        return true;
      }
      return false;
    }
    default:
      return false;
  }
};

/// Returns `true` if the token can appear at the start of a type.
// rustc: compiler/rustc_ast/src/token.rs:742 can_begin_type
gen.Token.prototype.can_begin_type = function (this: Token): boolean {
  // WARNING: Take care when modifying this function! It will change the stable(!) set of
  //          tokens that are allowed to match an `ty` nonterminal which is user observable.

  // FIXME: Arguably, `use` should be included in this list since it can begin bare trait
  //        object types (consider `use<>+` and `use<T> + Trait` for example).

  const kind = this.uninterpolate().kind;
  switch (kind.$) {
    case "Ident":
      return ident_can_begin_type(kind._0, this.span, kind._1); // type name or keyword
    case "OpenParen": // tuple
    case "OpenBracket": // array
    case "Bang": // never
    case "Star": // raw pointer
    case "And": // reference
    case "AndAnd": // double reference
    case "Question": // maybe bound in trait object
    case "Lifetime": // lifetime bound in trait object
    case "Lt":
    case "Shl": // associated path
    case "PathSep": // global path
      return true;
    case "OpenInvisible":
      if (kind._0.$ === "MetaVar" && (kind._0._0.$ === "Ty" || kind._0._0.$ === "Path")) {
        return true;
      }
      return false;
    default:
      return false;
  }
};

/// Returns `true` if the token can appear at the start of a const param.
// rustc: compiler/rustc_ast/src/token.rs:770 can_begin_const_arg
gen.Token.prototype.can_begin_const_arg = function (this: Token): boolean {
  const kind = this.kind;
  switch (kind.$) {
    case "OpenBrace":
    case "Literal":
    case "Minus":
      return true;
    case "Ident":
      if ((kind._1 === "Normal" || kind._1 === "ForcedKeyword") && Symbol.is_bool_lit(kind._0)) return true;
      return false;
    case "OpenInvisible":
      if (
        kind._0.$ === "MetaVar" &&
        (kind._0._0.$ === "Expr" || kind._0._0.$ === "Block" || kind._0._0.$ === "Literal")
      ) {
        return true;
      }
      return false;
    default:
      return false;
  }
};

/// Returns `true` if the token can appear at the start of an item.
// rustc: compiler/rustc_ast/src/token.rs:782 can_begin_item
gen.Token.prototype.can_begin_item = function (this: Token): boolean {
  const kind = this.kind;
  switch (kind.$) {
    case "Ident":
      return [
        kw.Fn,
        kw.Use,
        kw.Struct,
        kw.Enum,
        kw.Pub,
        kw.Trait,
        kw.Extern,
        kw.Impl,
        kw.Unsafe,
        kw.Const,
        kw.Safe,
        kw.Static,
        kw.Union,
        kw.Macro,
        kw.Mod,
        kw.Type,
      ].includes(kind._0);
    default:
      return false;
  }
};

/// Returns `true` if the token is any literal.
// rustc: compiler/rustc_ast/src/token.rs:808 is_lit
gen.Token.prototype.is_lit = function (this: Token): boolean {
  return this.kind.$ === "Literal";
};

/// Returns `true` if the token is any literal, a minus (which can prefix a literal,
/// for example a '-42', or one of the boolean idents).
///
/// In other words, would this token be a valid start of `parse_literal_maybe_minus`?
///
/// Keep this in sync with `Lit::from_token` and `Parser::eat_token_lit`
/// (excluding unary negation).
// rustc: compiler/rustc_ast/src/token.rs:819 can_begin_literal_maybe_minus
gen.Token.prototype.can_begin_literal_maybe_minus = function (this: Token): boolean {
  const kind = this.uninterpolate().kind;
  switch (kind.$) {
    case "Literal":
    case "Minus":
      return true;
    case "Ident":
      if ((kind._1 === "Normal" || kind._1 === "ForcedKeyword") && Symbol.is_bool_lit(kind._0)) return true;
      return false;
    case "OpenInvisible":
      if (kind._0.$ === "MetaVar") {
        const mv_kind = kind._0._0;
        switch (mv_kind.$) {
          case "Literal":
            return true;
          case "Expr":
            return mv_kind.can_begin_literal_maybe_minus;
          default:
            return false;
        }
      }
      return false;
    default:
      return false;
  }
};

// rustc: compiler/rustc_ast/src/token.rs:834 can_begin_string_literal
gen.Token.prototype.can_begin_string_literal = function (this: Token): boolean {
  const kind = this.uninterpolate().kind;
  switch (kind.$) {
    case "Literal":
      return true;
    case "OpenInvisible":
      if (kind._0.$ === "MetaVar") {
        const mv_kind = kind._0._0;
        switch (mv_kind.$) {
          case "Literal":
            return true;
          case "Expr":
            return mv_kind.can_begin_string_literal;
          default:
            return false;
        }
      }
      return false;
    default:
      return false;
  }
};

/// A convenience function for matching on identifiers during parsing.
/// Turns interpolated identifier (`$i: ident`) or lifetime (`$l: lifetime`) token
/// into the regular identifier or lifetime token it refers to,
/// otherwise returns the original token.
// rustc: compiler/rustc_ast/src/token.rs:850 uninterpolate
// PORT: `Cow<'_, Token>` -> `Token`. `Cow::Borrowed(self)` returns `this` itself, `Cow::Owned` a
// new `Token`; callers that need to tell them apart compare the result with `this` (`!==`).
gen.Token.prototype.uninterpolate = function (this: Token): Token {
  const kind = this.kind;
  switch (kind.$) {
    case "NtIdent":
      return Token.new({ $: "Ident", _0: kind._0.name, _1: kind._1 }, kind._0.span);
    case "NtLifetime":
      return Token.new({ $: "Lifetime", _0: kind._0.name, _1: kind._1 }, kind._0.span);
    default:
      return this;
  }
};

/// Returns an identifier if this token is an identifier.
// rustc: compiler/rustc_ast/src/token.rs:862 ident
gen.Token.prototype.ident = function (this: Token): [SpIdent, IdentKind] | undefined {
  // We avoid using `Token::uninterpolate` here because it's slow.
  const kind = this.kind;
  switch (kind.$) {
    case "Ident":
      return [SpIdent.new(kind._0, this.span), kind._1];
    case "NtIdent":
      return [kind._0, kind._1];
    default:
      return undefined;
  }
};

/// Returns a lifetime identifier if this token is a lifetime.
// rustc: compiler/rustc_ast/src/token.rs:873 lifetime
gen.Token.prototype.lifetime = function (this: Token): [SpIdent, IdentKind] | undefined {
  // We avoid using `Token::uninterpolate` here because it's slow.
  const kind = this.kind;
  switch (kind.$) {
    case "Lifetime":
      return [SpIdent.new(kind._0, this.span), kind._1];
    case "NtLifetime":
      return [kind._0, kind._1];
    default:
      return undefined;
  }
};

/// Returns `true` if the token is an identifier.
// rustc: compiler/rustc_ast/src/token.rs:883 is_ident
gen.Token.prototype.is_ident = function (this: Token): boolean {
  return this.ident() !== undefined;
};

/// Returns `true` if the token is a lifetime.
// rustc: compiler/rustc_ast/src/token.rs:888 is_lifetime
gen.Token.prototype.is_lifetime = function (this: Token): boolean {
  return this.lifetime() !== undefined;
};

/// Returns `true` if the token is an identifier whose name is the given
/// string slice.
// rustc: compiler/rustc_ast/src/token.rs:894 is_ident_named
gen.Token.prototype.is_ident_named = function (this: Token, name: Symbol): boolean {
  const r = this.ident();
  return r !== undefined && r[0].name === name;
};

/// Is this a pre-parsed expression dropped into the token stream
/// (which happens while parsing the result of macro expansion)?
// rustc: compiler/rustc_ast/src/token.rs:900 is_metavar_expr
gen.Token.prototype.is_metavar_expr = function (this: Token): boolean {
  const k = this.is_metavar_seq();
  return k !== undefined && (k.$ === "Expr" || k.$ === "Literal" || k.$ === "Path" || k.$ === "Block");
};

/// Are we at a block from a metavar (`$b:block`)?
// rustc: compiler/rustc_ast/src/token.rs:913 is_metavar_block
gen.Token.prototype.is_metavar_block = function (this: Token): boolean {
  const k = this.is_metavar_seq();
  return k !== undefined && k.$ === "Block";
};

/// Returns `true` if the token is either the `mut` or `const` keyword.
// rustc: compiler/rustc_ast/src/token.rs:918 is_mutability
gen.Token.prototype.is_mutability = function (this: Token): boolean {
  return this.is_keyword(kw.Mut) || this.is_keyword(kw.Const);
};

// rustc: compiler/rustc_ast/src/token.rs:922 is_qpath_start
gen.Token.prototype.is_qpath_start = function (this: Token): boolean {
  return this.kind.$ === "Lt" || this.kind.$ === "Shl";
};

// rustc: compiler/rustc_ast/src/token.rs:926 is_path_start
gen.Token.prototype.is_path_start = function (this: Token): boolean {
  const mv = this.is_metavar_seq();
  return (
    this.kind.$ === "PathSep" ||
    this.is_qpath_start() ||
    (mv !== undefined && mv.$ === "Path") ||
    this.is_path_segment_keyword() ||
    this.is_non_reserved_ident()
  );
};

/// Returns `true` if the token is a given keyword, `kw`.
// rustc: compiler/rustc_ast/src/token.rs:935 is_keyword
gen.Token.prototype.is_keyword = function (this: Token, kw: Symbol): boolean {
  const id = this.non_raw_ident();
  return id !== undefined && id.name === kw;
};

/// Returns `true` if the token is a given keyword, `kw` or if `case` is `Insensitive` and this
/// token is an identifier equal to `kw` ignoring the case.
// rustc: compiler/rustc_ast/src/token.rs:941 is_keyword_case
gen.Token.prototype.is_keyword_case = function (this: Token, kw: Symbol, case_: Case): boolean {
  if (this.is_keyword(kw)) return true;
  if (case_ === Case.Insensitive) {
    const id = this.non_raw_ident();
    // Do an ASCII case-insensitive match, because all keywords are ASCII.
    return id !== undefined && eq_ignore_ascii_case(Symbol.as_str(id.name), Symbol.as_str(kw));
  }
  return false;
};

// rustc: compiler/rustc_ast/src/token.rs:950 is_path_segment_keyword
gen.Token.prototype.is_path_segment_keyword = function (this: Token): boolean {
  const id = this.non_raw_ident();
  return id !== undefined && id.is_path_segment_keyword();
};

/// Returns true for reserved identifiers used internally for elided lifetimes,
/// unnamed method parameters, crate root module, error recovery etc.
// rustc: compiler/rustc_ast/src/token.rs:956 is_special_ident
gen.Token.prototype.is_special_ident = function (this: Token): boolean {
  const id = this.non_raw_ident();
  return id !== undefined && id.is_special();
};

/// Returns `true` if the token is a keyword used in the language.
// rustc: compiler/rustc_ast/src/token.rs:961 is_used_keyword
gen.Token.prototype.is_used_keyword = function (this: Token): boolean {
  const id = this.non_raw_ident();
  return id !== undefined && id.is_used_keyword();
};

/// Returns `true` if the token is a keyword reserved for possible future use.
// rustc: compiler/rustc_ast/src/token.rs:966 is_unused_keyword
gen.Token.prototype.is_unused_keyword = function (this: Token): boolean {
  const id = this.non_raw_ident();
  return id !== undefined && id.is_unused_keyword();
};

/// Returns `true` if the token is either a special identifier or a keyword.
// rustc: compiler/rustc_ast/src/token.rs:971 is_reserved_ident
gen.Token.prototype.is_reserved_ident = function (this: Token): boolean {
  const r = this.ident();
  return r !== undefined && ident_of_kind_is_reserved(r[0], r[1]);
};

// rustc: compiler/rustc_ast/src/token.rs:975 is_non_reserved_ident
gen.Token.prototype.is_non_reserved_ident = function (this: Token): boolean {
  return this.non_reserved_ident() !== undefined;
};

// rustc: compiler/rustc_ast/src/token.rs:979 non_reserved_ident
gen.Token.prototype.non_reserved_ident = function (this: Token): SpIdent | undefined {
  const r = this.ident();
  if (r !== undefined && !ident_of_kind_is_reserved(r[0], r[1])) return r[0];
  return undefined;
};

/// If this token is a non-raw identifier, return the identifier in question.
// rustc: compiler/rustc_ast/src/token.rs:984 non_raw_ident
gen.Token.prototype.non_raw_ident = function (this: Token): SpIdent | undefined {
  const r = this.ident();
  if (r !== undefined && (r[1] === "Normal" || r[1] === "ForcedKeyword")) {
    return r[0];
  }
  return undefined;
};

/// Returns `true` if the token is the identifier `true` or `false`.
// rustc: compiler/rustc_ast/src/token.rs:992 is_bool_lit
gen.Token.prototype.is_bool_lit = function (this: Token): boolean {
  const id = this.non_raw_ident();
  return id !== undefined && Symbol.is_bool_lit(id.name);
};

// rustc: compiler/rustc_ast/src/token.rs:996 is_numeric_lit
gen.Token.prototype.is_numeric_lit = function (this: Token): boolean {
  const kind = this.kind;
  return kind.$ === "Literal" && (kind._0.kind.$ === "Integer" || kind._0.kind.$ === "Float");
};

/// Returns `true` if the token is the integer literal.
// rustc: compiler/rustc_ast/src/token.rs:1004 is_integer_lit
gen.Token.prototype.is_integer_lit = function (this: Token): boolean {
  const kind = this.kind;
  return kind.$ === "Literal" && kind._0.kind.$ === "Integer";
};

/// Is this an invisible open delimiter at the start of a token sequence
/// from an expanded metavar?
// rustc: compiler/rustc_ast/src/token.rs:1010 is_metavar_seq
gen.Token.prototype.is_metavar_seq = function (this: Token): MetaVarKind | undefined {
  const kind = this.kind;
  if (kind.$ === "OpenInvisible" && kind._0.$ === "MetaVar") {
    return kind._0._0;
  }
  return undefined;
};

// rustc: compiler/rustc_ast/src/token.rs:1017 glue
gen.Token.prototype.glue = function (this: Token, joint: Token): Token | undefined {
  const K = gen.TokenKind;
  const j = joint.kind;
  let kind: TokenKind;
  switch (this.kind.$) {
    case "Eq":
      if (j.$ === "Eq") kind = K.EqEq;
      else if (j.$ === "Gt") kind = K.FatArrow;
      else return undefined;
      break;

    case "Lt":
      if (j.$ === "Eq") kind = K.Le;
      else if (j.$ === "Lt") kind = K.Shl;
      else if (j.$ === "Le") kind = K.ShlEq;
      else if (j.$ === "Minus") kind = K.LArrow;
      else return undefined;
      break;

    case "Gt":
      if (j.$ === "Eq") kind = K.Ge;
      else if (j.$ === "Gt") kind = K.Shr;
      else if (j.$ === "Ge") kind = K.ShrEq;
      else return undefined;
      break;

    case "Bang":
      if (j.$ === "Eq") kind = K.Ne;
      else return undefined;
      break;

    case "Plus":
      if (j.$ === "Eq") kind = K.PlusEq;
      else return undefined;
      break;

    case "Minus":
      if (j.$ === "Eq") kind = K.MinusEq;
      else if (j.$ === "Gt") kind = K.RArrow;
      else return undefined;
      break;

    case "Star":
      if (j.$ === "Eq") kind = K.StarEq;
      else return undefined;
      break;

    case "Slash":
      if (j.$ === "Eq") kind = K.SlashEq;
      else return undefined;
      break;

    case "Percent":
      if (j.$ === "Eq") kind = K.PercentEq;
      else return undefined;
      break;

    case "Caret":
      if (j.$ === "Eq") kind = K.CaretEq;
      else return undefined;
      break;

    case "And":
      if (j.$ === "Eq") kind = K.AndEq;
      else if (j.$ === "And") kind = K.AndAnd;
      else return undefined;
      break;

    case "Or":
      if (j.$ === "Eq") kind = K.OrEq;
      else if (j.$ === "Or") kind = K.OrOr;
      else return undefined;
      break;

    case "Shl":
      if (j.$ === "Eq") kind = K.ShlEq;
      else return undefined;
      break;

    case "Shr":
      if (j.$ === "Eq") kind = K.ShrEq;
      else return undefined;
      break;

    case "Dot":
      if (j.$ === "Dot") kind = K.DotDot;
      else if (j.$ === "DotDot") kind = K.DotDotDot;
      else return undefined;
      break;

    case "DotDot":
      if (j.$ === "Dot") kind = K.DotDotDot;
      else if (j.$ === "Eq") kind = K.DotDotEq;
      else return undefined;
      break;

    case "Colon":
      if (j.$ === "Colon") kind = K.PathSep;
      else return undefined;
      break;

    case "SingleQuote":
      if (j.$ === "Ident") {
        kind = { $: "Lifetime", _0: Symbol.intern(`'${display_Symbol(j._0)}`), _1: j._1 };
      } else return undefined;
      break;

    case "Le":
    case "EqEq":
    case "Ne":
    case "Ge":
    case "AndAnd":
    case "OrOr":
    case "Tilde":
    case "PlusEq":
    case "MinusEq":
    case "StarEq":
    case "SlashEq":
    case "PercentEq":
    case "CaretEq":
    case "AndEq":
    case "OrEq":
    case "ShlEq":
    case "ShrEq":
    case "At":
    case "DotDotDot":
    case "DotDotEq":
    case "Comma":
    case "Semi":
    case "PathSep":
    case "RArrow":
    case "LArrow":
    case "FatArrow":
    case "Pound":
    case "Dollar":
    case "Question":
    case "OpenParen":
    case "CloseParen":
    case "OpenBrace":
    case "CloseBrace":
    case "OpenBracket":
    case "CloseBracket":
    case "OpenInvisible":
    case "CloseInvisible":
    case "Literal":
    case "Ident":
    case "NtIdent":
    case "Lifetime":
    case "NtLifetime":
    case "DocComment":
    case "Eof": {
      return undefined;
    }
  }

  return Token.new(kind, Span.to(this.span, joint.span));
};

// impl PartialEq<TokenKind> for Token
// rustc: compiler/rustc_ast/src/token.rs:1105 eq
gen.Token.prototype.eq = function (this: Token, rhs: TokenKind): boolean {
  return TokenKind_eq(this.kind, rhs);
};

// rustc: compiler/rustc_ast/src/token.rs:1110 ident_of_kind_is_reserved
export function ident_of_kind_is_reserved(id: SpIdent, kind: IdentKind): boolean {
  switch (kind) {
    case "Normal":
      return id.is_reserved();
    case "Raw":
      return false;
    case "ForcedKeyword":
      return true;
  }
}

export type NonterminalKind = NonterminalKindT;
export const NonterminalKind = {
  ...gen.NonterminalKind,

  /// The `edition` closure is used to get the edition for the given symbol. Doing
  /// `span.edition()` is expensive, so we do it lazily.
  // rustc: compiler/rustc_ast/src/token.rs:1161 from_symbol
  from_symbol(symbol: Symbol, edition: () => Edition): NonterminalKind | undefined {
    const N = gen.NonterminalKind;
    switch (symbol) {
      case sym.item:
        return N.Item;
      case sym.block:
        return N.Block;
      case sym.stmt:
        return N.Stmt;
      case sym.pat:
        if (EditionC.at_least_rust_2021(edition())) {
          return { $: "Pat", _0: gen.NtPatKind.PatWithOr };
        } else {
          return { $: "Pat", _0: { $: "PatParam", inferred: true } };
        }
      case sym.pat_param:
        return { $: "Pat", _0: { $: "PatParam", inferred: false } };
      case sym.expr:
        if (EditionC.at_least_rust_2024(edition())) {
          return { $: "Expr", _0: gen.NtExprKind.Expr };
        } else {
          return { $: "Expr", _0: { $: "Expr2021", inferred: true } };
        }
      case sym.expr_2021:
        return { $: "Expr", _0: { $: "Expr2021", inferred: false } };
      case sym.ty:
        return N.Ty;
      case sym.ident:
        return N.Ident;
      case sym.lifetime:
        return N.Lifetime;
      case sym.literal:
        return N.Literal;
      case sym.meta:
        return N.Meta;
      case sym.path:
        return N.Path;
      case sym.vis:
        return N.Vis;
      case sym.guard:
        return N.Guard;
      case sym.tt:
        return N.TT;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/token.rs:1198 symbol
  symbol(self: NonterminalKind): Symbol {
    switch (self.$) {
      case "Item":
        return sym.item;
      case "Block":
        return sym.block;
      case "Stmt":
        return sym.stmt;
      case "Pat":
        if ((self._0.$ === "PatParam" && self._0.inferred === true) || self._0.$ === "PatWithOr") return sym.pat;
        // NonterminalKind::Pat(PatParam { inferred: false })
        return sym.pat_param;
      case "Expr":
        if ((self._0.$ === "Expr2021" && self._0.inferred === true) || self._0.$ === "Expr") return sym.expr;
        // NonterminalKind::Expr(Expr2021 { inferred: false })
        return sym.expr_2021;
      case "Ty":
        return sym.ty;
      case "Ident":
        return sym.ident;
      case "Lifetime":
        return sym.lifetime;
      case "Literal":
        return sym.literal;
      case "Meta":
        return sym.meta;
      case "Path":
        return sym.path;
      case "Vis":
        return sym.vis;
      case "Guard":
        return sym.guard;
      case "TT":
        return sym.tt;
    }
  },
};

// impl fmt::Display for NonterminalKind
// rustc: compiler/rustc_ast/src/token.rs:1221 fmt
export function display_NonterminalKind(self: NonterminalKind): string {
  return display_Symbol(NonterminalKind.symbol(self));
}

// ---------------------------------------------------------------------------------------------
// Derived `PartialEq` impls (`#[derive(PartialEq)]`) used by the ported code.

/// `str::eq_ignore_ascii_case`
// PORT: per UTF-16 code unit; equal to the per-byte comparison because only ASCII letters fold.
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

/// `#[derive(PartialEq)]`
export function NtPatKind_eq(a: NtPatKind, b: NtPatKind): boolean {
  switch (a.$) {
    case "PatWithOr":
      return b.$ === "PatWithOr";
    case "PatParam":
      return b.$ === "PatParam" && a.inferred === b.inferred;
  }
}

/// `#[derive(PartialEq)]`
export function NtExprKind_eq(a: NtExprKind, b: NtExprKind): boolean {
  switch (a.$) {
    case "Expr":
      return b.$ === "Expr";
    case "Expr2021":
      return b.$ === "Expr2021" && a.inferred === b.inferred;
  }
}

/// `#[derive(PartialEq)]`
export function MetaVarKind_eq(a: MetaVarKind, b: MetaVarKind): boolean {
  switch (a.$) {
    case "Pat":
      return b.$ === "Pat" && NtPatKind_eq(a._0, b._0);
    case "Expr":
      return (
        b.$ === "Expr" &&
        NtExprKind_eq(a.kind, b.kind) &&
        a.can_begin_literal_maybe_minus === b.can_begin_literal_maybe_minus &&
        a.can_begin_string_literal === b.can_begin_string_literal
      );
    case "Ty":
      return b.$ === "Ty" && a.is_path === b.is_path;
    case "Meta":
      return b.$ === "Meta" && a.has_meta_form === b.has_meta_form;
    default:
      return a.$ === b.$;
  }
}

/// `#[derive(PartialEq)]`
export function InvisibleOrigin_eq(a: InvisibleOrigin, b: InvisibleOrigin): boolean {
  switch (a.$) {
    case "MetaVar":
      return b.$ === "MetaVar" && MetaVarKind_eq(a._0, b._0);
    case "ProcMacro":
      return b.$ === "ProcMacro";
  }
}

/// `#[derive(PartialEq)]`
export function Delimiter_eq(a: Delimiter, b: Delimiter): boolean {
  switch (a.$) {
    case "Invisible":
      return b.$ === "Invisible" && InvisibleOrigin_eq(a._0, b._0);
    default:
      return a.$ === b.$;
  }
}

/// `#[derive(PartialEq)]`
export function LitKind_eq(a: LitKind, b: LitKind): boolean {
  switch (a.$) {
    case "StrRaw":
    case "ByteStrRaw":
    case "CStrRaw":
      return b.$ === a.$ && a._0 === b._0;
    case "Err":
      return b.$ === "Err" && a._0 === b._0;
    default:
      return a.$ === b.$;
  }
}

/// `#[derive(PartialEq)]`
export function Lit_eq(a: Lit, b: Lit): boolean {
  return LitKind_eq(a.kind, b.kind) && a.symbol === b.symbol && a.suffix === b.suffix;
}

/// `#[derive(PartialEq)]`
export function TokenKind_eq(a: TokenKind, b: TokenKind): boolean {
  switch (a.$) {
    case "OpenInvisible":
      return b.$ === "OpenInvisible" && InvisibleOrigin_eq(a._0, b._0);
    case "CloseInvisible":
      return b.$ === "CloseInvisible" && InvisibleOrigin_eq(a._0, b._0);
    case "Literal":
      return b.$ === "Literal" && Lit_eq(a._0, b._0);
    case "Ident":
      return b.$ === "Ident" && a._0 === b._0 && a._1 === b._1;
    case "NtIdent":
      return b.$ === "NtIdent" && a._0.eq(b._0) && a._1 === b._1;
    case "Lifetime":
      return b.$ === "Lifetime" && a._0 === b._0 && a._1 === b._1;
    case "NtLifetime":
      return b.$ === "NtLifetime" && a._0.eq(b._0) && a._1 === b._1;
    case "DocComment":
      return b.$ === "DocComment" && a._0 === b._0 && a._1 === b._1 && a._2 === b._2;
    default:
      return a.$ === b.$;
  }
}

/// `#[derive(PartialEq)]`
export function Token_eq(a: Token, b: Token): boolean {
  return TokenKind_eq(a.kind, b.kind) && a.span === b.span;
}

// Some types are used a lot. Make sure they don't unintentionally get bigger.
// PORT: `mod size_asserts` (static_assert_size!) has no TS counterpart.
