// Port of compiler/rustc_expand/src/proc_macro_server.rs
//
// PORT: `trait FromInternal<T>` / `trait ToInternal<T>` have one impl per pair of types; each impl is a table
// named after its pair (`Delimiter_FromInternal.from_internal(..)`, `TokenTree_ToInternal.to_internal(..)`),
// and `FromInternal::from_internal(x)` calls name the impl the type checker would pick. The bridge types come
// from the `proc_macro` library port (src/proc_macro/, `// std:` markers). `Rustc` is a class; the
// `impl server::Server for Rustc` methods sit in its body after `sess` / `psess` (PORTING §8), with the two
// associated fns without `self` (`intern_symbol`, `with_symbol_string`) as statics.

import { ast, token as tk, tokenstream } from "../rustc_ast/lib.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { escape_byte_str_symbol } from "../rustc_ast/util/literal.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import {
  catch_fatal_errors,
  Diag,
  type ErrorGuaranteed,
  Level as RLevel,
  MultiSpan,
  type PResult,
  Sublevel,
} from "../rustc_errors/lib.ts";
import { DiagMessage } from "../rustc_error_messages/lib.ts";
import { is_ident } from "../rustc_lexer/lib.ts";
import { new_parser_from_source_str, parser as rustc_parse_parser, source_str_to_stream } from "../rustc_parse/lib.ts";
import { nfc_normalize, StripTokens } from "../rustc_parse/lexer/mod.ts";
import type { Session } from "../rustc_session/session.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { CrateNum } from "../rustc_span/def_id.ts";
import { debug_SyntaxContext, LocalExpnId } from "../rustc_span/hygiene.ts";
import { stable_source_file_id_key } from "../rustc_span/source_map.ts";
import { BytePos, debug_Span, ErrorGuaranteed as ErrorGuaranteed_, FileName, Span } from "../rustc_span/lib.ts";
import { ByteSymbol, Ident as SpIdent, Symbol, sym } from "../rustc_span/symbol.ts";
import { escape_char, PLAIN } from "../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str, utf8_len } from "../std/str.ts";
import { Delimiter } from "../proc_macro/lib.ts";
import type { Level } from "../proc_macro/diagnostic.ts";
import {
  DelimSpan,
  type Diagnostic,
  type ExpnGlobals,
  IdentKind,
  LitKind,
  type Literal,
  type TokenTree,
} from "../proc_macro/bridge/mod.ts";
import type { Bound, Range, Server } from "../proc_macro/bridge/server.ts";
import type { ExtCtxt } from "./base.ts";
import { AstFragment } from "./expand.ts";

const { TokenKind: TK, Lit, clone_Lit } = tk;
const { DelimSpacing: DelimSpacing_, DelimSpan: AstDelimSpan, TokenStream: TokenStream_, TokenTree: AstTokenTree, clone_TokenTree } =
  tokenstream;
const { Parser } = rustc_parse_parser;
const { exp } = rustc_parse_parser.token_type;

type AstTokenTree = tokenstream.TokenTree;
/** `TokenTree<TokenStream, Span, Symbol>`: the bridge tree with the compiler's own representations. */
type PmTokenTree = TokenTree<TokenStream, Span, Symbol>;

// rustc-trait: compiler/rustc_expand/src/proc_macro_server.rs:26 FromInternal
interface FromInternal<T, Self> {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:27 from_internal
  from_internal(x: T): Self;
}

// rustc-trait: compiler/rustc_expand/src/proc_macro_server.rs:30 ToInternal
interface ToInternal<Self, T> {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:31 to_internal
  to_internal(self: Self): T;
}

/** `impl FromInternal<tk::Delimiter> for Delimiter` */
const Delimiter_FromInternal: FromInternal<tk.Delimiter, Delimiter> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:35 from_internal
  from_internal(delim: tk.Delimiter): Delimiter {
    switch (delim.$) {
      case "Parenthesis":
        return Delimiter.Parenthesis;
      case "Brace":
        return Delimiter.Brace;
      case "Bracket":
        return Delimiter.Bracket;
      case "Invisible":
        return Delimiter.None;
    }
  },
};

/** `impl ToInternal<tk::Delimiter> for Delimiter` */
const Delimiter_ToInternal: ToInternal<Delimiter, tk.Delimiter> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:46 to_internal
  to_internal(self: Delimiter): tk.Delimiter {
    switch (self) {
      case "Parenthesis":
        return tk.Delimiter.Parenthesis;
      case "Brace":
        return tk.Delimiter.Brace;
      case "Bracket":
        return tk.Delimiter.Bracket;
      case "None":
        return { $: "Invisible", _0: tk.InvisibleOrigin.ProcMacro };
    }
  },
};

/** `impl FromInternal<tk::LitKind> for LitKind` */
const LitKind_FromInternal: FromInternal<tk.LitKind, LitKind> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:57 from_internal
  from_internal(kind: tk.LitKind): LitKind {
    switch (kind.$) {
      case "Byte":
        return LitKind.Byte;
      case "Char":
        return LitKind.Char;
      case "Integer":
        return LitKind.Integer;
      case "Float":
        return LitKind.Float;
      case "Str":
        return LitKind.Str;
      case "StrRaw":
        return { $: "StrRaw", _0: kind._0 };
      case "ByteStr":
        return LitKind.ByteStr;
      case "ByteStrRaw":
        return { $: "ByteStrRaw", _0: kind._0 };
      case "CStr":
        return LitKind.CStr;
      case "CStrRaw":
        return { $: "CStrRaw", _0: kind._0 };
      case "Err": {
        // This is the only place a `rustc_proc_macro::bridge::LitKind::ErrWithGuar`
        // is constructed. Note that an `ErrorGuaranteed` is available,
        // as required. See the comment in `to_internal`.
        return LitKind.ErrWithGuar;
      }
      case "Bool":
        return unreachable();
    }
  },
};

/** `impl ToInternal<tk::LitKind> for LitKind` */
const LitKind_ToInternal: ToInternal<LitKind, tk.LitKind> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:81 to_internal
  to_internal(self: LitKind): tk.LitKind {
    switch (self.$) {
      case "Byte":
        return tk.LitKind.Byte;
      case "Char":
        return tk.LitKind.Char;
      case "Integer":
        return tk.LitKind.Integer;
      case "Float":
        return tk.LitKind.Float;
      case "Str":
        return tk.LitKind.Str;
      case "StrRaw":
        return { $: "StrRaw", _0: self._0 };
      case "ByteStr":
        return tk.LitKind.ByteStr;
      case "ByteStrRaw":
        return { $: "ByteStrRaw", _0: self._0 };
      case "CStr":
        return tk.LitKind.CStr;
      case "CStrRaw":
        return { $: "CStrRaw", _0: self._0 };
      case "ErrWithGuar": {
        // This is annoying but valid. `LitKind::ErrWithGuar` would
        // have an `ErrorGuaranteed` except that type isn't available
        // in that crate. So we have to fake one. And we don't want to
        // use a delayed bug because there might be lots of these,
        // which would be expensive.
        // #[allow(deprecated)]
        const guar: ErrorGuaranteed = ErrorGuaranteed_.unchecked_error_guaranteed();
        return { $: "Err", _0: guar };
      }
    }
  },
};

/** `impl FromInternal<tk::IdentKind> for IdentKind` */
const IdentKind_FromInternal: FromInternal<tk.IdentKind, IdentKind> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:108 from_internal
  from_internal(kind: tk.IdentKind): IdentKind {
    switch (kind) {
      case "Normal":
        return IdentKind.Normal;
      case "Raw":
        return IdentKind.Raw;
      case "ForcedKeyword":
        return IdentKind.ForcedKeyword;
    }
  },
};

/** `impl ToInternal<tk::IdentKind> for IdentKind` */
const IdentKind_ToInternal: ToInternal<IdentKind, tk.IdentKind> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:118 to_internal
  to_internal(self: IdentKind): tk.IdentKind {
    switch (self) {
      case "Normal":
        return tk.IdentKind.Normal;
      case "Raw":
        return tk.IdentKind.Raw;
      case "ForcedKeyword":
        return tk.IdentKind.ForcedKeyword;
    }
  },
};

/** `impl FromInternal<TokenStream> for Vec<TokenTree<TokenStream, Span, Symbol>>` */
export const TokenTrees_FromInternal: FromInternal<TokenStream, PmTokenTree[]> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:128 from_internal
  from_internal(stream: TokenStream): PmTokenTree[] {
    // Estimate the capacity as `stream.len()` rounded up to the next power
    // of two to limit the number of required reallocations.
    // PORT: `Vec::with_capacity` (a capacity hint) has no TS counterpart.
    const trees: PmTokenTree[] = [];

    const iter = stream.iter();
    for (let tree = iter.next(); tree !== undefined; tree = iter.next()) {
      let token: tk.Token;
      let joint: boolean;
      const tree_ = clone_TokenTree(tree);
      switch (tree_.$) {
        case "Delimited": {
          const span = tree_._0;
          let delim = tree_._2;
          let stream = tree_._3;
          // In `mk_delimited` we avoid nesting invisible delimited
          // of the same `MetaVarKind`. Here we do the same but
          // ignore the `MetaVarKind` because it is discarded when we
          // convert it to a `Group`.
          for (;;) {
            if (!(delim.$ === "Invisible" && delim._0.$ === "MetaVar")) break;
            if (!(stream.len() === 1)) break;
            const tree = unwrap(stream.get(0));
            if (tree.$ !== "Delimited") break;
            const delim2 = tree._2;
            const stream2 = tree._3;
            if (!(delim2.$ === "Invisible" && delim2._0.$ === "MetaVar")) break;
            delim = tk.clone_Delimiter(delim2);
            stream = tokenstream.clone_TokenStream(stream2);
          }

          trees.push({
            $: "Group",
            _0: {
              delimiter: Delimiter_FromInternal.from_internal(delim),
              stream: stream,
              span: new DelimSpan(span.open, span.close, span.entire()),
            },
          });
          continue;
        }
        case "Token": {
          const spacing = tree_._1;
          // Do not be tempted to check here that the `spacing`
          // values are "correct" w.r.t. the token stream (e.g. that
          // `Spacing::Joint` is actually followed by a `Punct` token
          // tree). Because the problem in #76399 was introduced that
          // way.
          //
          // This is where the `Hidden` in `JointHidden` applies,
          // because the jointness is effectively hidden from proc
          // macros.
          let joint_: boolean;
          switch (spacing) {
            case "Alone":
            case "JointHidden":
              joint_ = false;
              break;
            case "Joint":
              joint_ = true;
              break;
          }
          token = tree_._0;
          joint = joint_;
          break;
        }
      }
      const { kind, span } = token;

      // Split the operator into one or more `Punct`s, one per character.
      // The final one inherits the jointness of the original token. Any
      // before that get `joint = true`.
      const op = (s: string): void => {
        assert(is_ascii(s), "assertion failed: s.is_ascii()");
        for (let i = 0; i < s.length; i++) {
          const ch = s.charCodeAt(i);
          const is_final = i === s.length - 1;
          // Split the token span into single chars. Unless the span
          // is an unusual one, e.g. due to proc macro expansion. We
          // determine this by assuming any span with a length that
          // matches the operator length is a normal one, and any
          // span with a different length is an unusual one.
          let span_: Span;
          if (BytePos.to_usize(BytePos.sub(Span.hi(span), Span.lo(span))) === s.length) {
            const lo = BytePos.add(Span.lo(span), BytePos.from_usize(i));
            const hi = BytePos.add(lo, BytePos.from_usize(1));
            span_ = Span.with_hi(Span.with_lo(span, lo), hi);
          } else {
            span_ = span;
          }
          const joint_ = is_final ? joint : true;
          trees.push({ $: "Punct", _0: { ch, joint: joint_, span: span_ } });
        }
      };

      switch (kind.$) {
        case "Eq":
          op("=");
          break;
        case "Lt":
          op("<");
          break;
        case "Le":
          op("<=");
          break;
        case "EqEq":
          op("==");
          break;
        case "Ne":
          op("!=");
          break;
        case "Ge":
          op(">=");
          break;
        case "Gt":
          op(">");
          break;
        case "AndAnd":
          op("&&");
          break;
        case "OrOr":
          op("||");
          break;
        case "Bang":
          op("!");
          break;
        case "Tilde":
          op("~");
          break;
        case "Plus":
          op("+");
          break;
        case "Minus":
          op("-");
          break;
        case "Star":
          op("*");
          break;
        case "Slash":
          op("/");
          break;
        case "Percent":
          op("%");
          break;
        case "Caret":
          op("^");
          break;
        case "And":
          op("&");
          break;
        case "Or":
          op("|");
          break;
        case "Shl":
          op("<<");
          break;
        case "Shr":
          op(">>");
          break;
        case "PlusEq":
          op("+=");
          break;
        case "MinusEq":
          op("-=");
          break;
        case "StarEq":
          op("*=");
          break;
        case "SlashEq":
          op("/=");
          break;
        case "PercentEq":
          op("%=");
          break;
        case "CaretEq":
          op("^=");
          break;
        case "AndEq":
          op("&=");
          break;
        case "OrEq":
          op("|=");
          break;
        case "ShlEq":
          op("<<=");
          break;
        case "ShrEq":
          op(">>=");
          break;
        case "At":
          op("@");
          break;
        case "Dot":
          op(".");
          break;
        case "DotDot":
          op("..");
          break;
        case "DotDotDot":
          op("...");
          break;
        case "DotDotEq":
          op("..=");
          break;
        case "Comma":
          op(",");
          break;
        case "Semi":
          op(";");
          break;
        case "Colon":
          op(":");
          break;
        case "PathSep":
          op("::");
          break;
        case "RArrow":
          op("->");
          break;
        case "LArrow":
          op("<-");
          break;
        case "FatArrow":
          op("=>");
          break;
        case "Pound":
          op("#");
          break;
        case "Dollar":
          op("$");
          break;
        case "Question":
          op("?");
          break;
        case "SingleQuote":
          op("'");
          break;

        case "Ident": {
          const sym_ = kind._0;
          trees.push({
            $: "Ident",
            _0: {
              sym: sym_,
              kind: IdentKind_FromInternal.from_internal(kind._1),
              span,
            },
          });
          break;
        }
        case "NtIdent": {
          const ident = kind._0;
          trees.push({
            $: "Ident",
            _0: {
              sym: ident.name,
              kind: IdentKind_FromInternal.from_internal(kind._1),
              span: ident.span,
            },
          });
          break;
        }

        case "Lifetime": {
          const name = kind._0;
          const ident = SpIdent.new(name, span).without_first_quote();
          trees.push(
            { $: "Punct", _0: { ch: CH_QUOTE, joint: true, span } },
            {
              $: "Ident",
              _0: {
                sym: ident.name,
                kind: IdentKind_FromInternal.from_internal(kind._1),
                span,
              },
            },
          );
          break;
        }
        case "NtLifetime": {
          const ident = kind._0;
          const stream = TokenStream_.token_alone({ $: "Lifetime", _0: ident.name, _1: kind._1 }, ident.span);
          trees.push({
            $: "Group",
            _0: {
              delimiter: Delimiter.None,
              stream: stream,
              span: DelimSpan.from_single(span),
            },
          });
          break;
        }

        case "Literal": {
          const { kind: kind_, symbol, suffix } = kind._0;
          trees.push({
            $: "Literal",
            _0: {
              kind: LitKind_FromInternal.from_internal(kind_),
              symbol,
              suffix,
              span,
            },
          });
          break;
        }
        case "DocComment": {
          const attr_style = kind._1;
          const data = kind._2;
          let escaped = "";
          for (const ch of Symbol.as_str(data)) {
            escaped += escape_char(ch.codePointAt(0)!, true, true);
          }
          const stream = TokenStream_.from_iter(
            [
              { $: "Ident", _0: sym.doc, _1: tk.IdentKind.Normal } as tk.TokenKind,
              TK.Eq,
              TK.lit(tk.LitKind.Str, Symbol.intern(escaped), undefined),
            ].map((kind) => AstTokenTree.token_alone(kind, span)),
          );
          trees.push({ $: "Punct", _0: { ch: CH_POUND, joint: false, span } });
          if (attr_style === "Inner") {
            trees.push({ $: "Punct", _0: { ch: CH_BANG, joint: false, span } });
          }
          trees.push({
            $: "Group",
            _0: {
              delimiter: Delimiter.Bracket,
              stream: stream,
              span: DelimSpan.from_single(span),
            },
          });
          break;
        }

        case "OpenParen":
        case "CloseParen":
        case "OpenBrace":
        case "CloseBrace":
        case "OpenBracket":
        case "CloseBracket":
        case "OpenInvisible":
        case "CloseInvisible":
        case "Eof":
          return unreachable();
      }
    }
    return trees;
  },
};

const CH_QUOTE = 0x27; // b'\''
const CH_POUND = 0x23; // b'#'
const CH_BANG = 0x21; // b'!'

/** `str::is_ascii` */
function is_ascii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

// We use a `SmallVec` because the output size is always one or two `TokenTree`s.
/** `impl ToInternal<SmallVec<[tokenstream::TokenTree; 2]>> for (TokenTree<TokenStream, Span, Symbol>, &mut Rustc<'_, '_>)` */
export const TokenTree_ToInternal: ToInternal<[PmTokenTree, Rustc], AstTokenTree[]> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:335 to_internal
  to_internal(self: [PmTokenTree, Rustc]): AstTokenTree[] {
    // The code below is conservative, using `token_alone`/`Spacing::Alone`
    // in most places. It's hard in general to do better when working at
    // the token level. When the resulting code is pretty-printed by
    // `print_tts` the `space_between` function helps avoid a lot of
    // unnecessary whitespace, so the results aren't too bad.
    const [tree, rustc] = self;
    switch (tree.$) {
      case "Punct": {
        const { ch, joint, span } = tree._0;
        let kind: tk.TokenKind;
        switch (ch) {
          case 0x3d: // b'='
            kind = TK.Eq;
            break;
          case 0x3c: // b'<'
            kind = TK.Lt;
            break;
          case 0x3e: // b'>'
            kind = TK.Gt;
            break;
          case 0x21: // b'!'
            kind = TK.Bang;
            break;
          case 0x7e: // b'~'
            kind = TK.Tilde;
            break;
          case 0x2b: // b'+'
            kind = TK.Plus;
            break;
          case 0x2d: // b'-'
            kind = TK.Minus;
            break;
          case 0x2a: // b'*'
            kind = TK.Star;
            break;
          case 0x2f: // b'/'
            kind = TK.Slash;
            break;
          case 0x25: // b'%'
            kind = TK.Percent;
            break;
          case 0x5e: // b'^'
            kind = TK.Caret;
            break;
          case 0x26: // b'&'
            kind = TK.And;
            break;
          case 0x7c: // b'|'
            kind = TK.Or;
            break;
          case 0x40: // b'@'
            kind = TK.At;
            break;
          case 0x2e: // b'.'
            kind = TK.Dot;
            break;
          case 0x2c: // b','
            kind = TK.Comma;
            break;
          case 0x3b: // b';'
            kind = TK.Semi;
            break;
          case 0x3a: // b':'
            kind = TK.Colon;
            break;
          case 0x23: // b'#'
            kind = TK.Pound;
            break;
          case 0x24: // b'$'
            kind = TK.Dollar;
            break;
          case 0x3f: // b'?'
            kind = TK.Question;
            break;
          case 0x27: // b'\''
            kind = TK.SingleQuote;
            break;
          default:
            return unreachable();
        }
        // We never produce `tk::Spacing::JointHidden` here, which
        // means the pretty-printing of code produced by proc macros is
        // ugly, with lots of whitespace between tokens. This is
        // unavoidable because `proc_macro::Spacing` only applies to
        // `Punct` token trees.
        return [joint ? AstTokenTree.token_joint(kind, span) : AstTokenTree.token_alone(kind, span)];
      }
      case "Group": {
        const { delimiter, stream, span } = tree._0;
        const { open, close } = span;
        return [
          {
            $: "Delimited",
            _0: new AstDelimSpan(open, close),
            _1: DelimSpacing_.new("Alone", "Alone"),
            _2: Delimiter_ToInternal.to_internal(delimiter),
            _3: stream ?? TokenStream_.default(),
          },
        ];
      }
      case "Ident": {
        const { sym: sym_, kind, span } = tree._0;
        rustc.psess().symbol_gallery.insert(sym_, span);
        return [AstTokenTree.token_alone({ $: "Ident", _0: sym_, _1: IdentKind_ToInternal.to_internal(kind) }, span)];
      }
      case "Literal": {
        const { kind, symbol, suffix, span } = tree._0;
        if (kind.$ === "Integer") {
          const stripped = strip_prefix_minus(Symbol.as_str(symbol));
          if (stripped !== undefined) {
            const symbol = Symbol.intern(stripped);
            const integer = TK.lit(tk.LitKind.Integer, symbol, suffix);
            const a = AstTokenTree.token_joint_hidden(TK.Minus, span);
            const b = AstTokenTree.token_alone(integer, span);
            return [a, b];
          }
        }
        if (kind.$ === "Float") {
          const stripped = strip_prefix_minus(Symbol.as_str(symbol));
          if (stripped !== undefined) {
            const symbol = Symbol.intern(stripped);
            const float = TK.lit(tk.LitKind.Float, symbol, suffix);
            const a = AstTokenTree.token_joint_hidden(TK.Minus, span);
            const b = AstTokenTree.token_alone(float, span);
            return [a, b];
          }
        }
        return [AstTokenTree.token_alone(TK.lit(LitKind_ToInternal.to_internal(kind), symbol, suffix), span)];
      }
    }
  },
};

/** `str::strip_prefix('-')` */
function strip_prefix_minus(s: string): string | undefined {
  return s.startsWith("-") ? s.slice(1) : undefined;
}

/** `impl ToInternal<rustc_errors::Level> for Level` */
const Level_ToInternal_Level: ToInternal<Level, RLevel> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:427 to_internal
  to_internal(self: Level): RLevel {
    switch (self) {
      case "Error":
        return RLevel.Error;
      case "Warning":
        return { $: "Warning", _0: undefined };
      case "Note":
        return RLevel.Note;
      case "Help":
        return RLevel.Help;
      default:
        return unreachable(`internal error: entered unreachable code: unknown proc_macro::Level variant: ${self as string}`);
    }
  },
};

/** `impl ToInternal<rustc_errors::Sublevel> for Level` */
const Level_ToInternal_Sublevel: ToInternal<Level, Sublevel> = {
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:439 to_internal
  to_internal(self: Level): Sublevel {
    switch (self) {
      case "Error":
        return Sublevel.Error;
      case "Warning":
        return Sublevel.Warning;
      case "Note":
        return Sublevel.Note;
      case "Help":
        return Sublevel.Help;
      default:
        return unreachable(`internal error: entered unreachable code: unknown proc_macro::Level variant: ${self as string}`);
    }
  },
};

// rustc: compiler/rustc_expand/src/proc_macro_server.rs:450 cancel_diags_into_string
function cancel_diags_into_string(diags: Diag[]): string {
  // PORT: `diags.into_iter().flat_map(Diag::cancel_into_message)` is lazy: `next()` cancels diagnostics up to
  // the first one with a message, `for_each` cancels the rest.
  let i = 0;
  const next = (): string | undefined => {
    while (i < diags.length) {
      const m = diags[i++]!.cancel_into_message();
      if (m !== undefined) return m;
    }
    return undefined;
  };
  const msg = next();
  if (msg === undefined) panic("no diagnostic has a message");
  while (next() !== undefined); // consume iterator to cancel the remaining diagnostics
  return msg;
}

// rustc-type: compiler/rustc_expand/src/proc_macro_server.rs:457 Rustc
export class Rustc implements Server<TokenStream, Span, Symbol> {
  constructor(
    public ecx: ExtCtxt,
    public def_site: Span,
    public call_site: Span,
    public mixed_site: Span,
    public krate: CrateNum,
    public rebased_spans: Map<number, Span>,
  ) {}

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:467 new
  static new(ecx: ExtCtxt): Rustc {
    const expn_data = LocalExpnId.expn_data(ecx.current_expansion.id);
    // PORT: struct-literal fields are evaluated in source order (def_site, call_site, mixed_site, krate).
    const def_site = ecx.with_def_site_ctxt(expn_data.def_site);
    const call_site = ecx.with_call_site_ctxt(expn_data.call_site);
    const mixed_site = ecx.with_mixed_site_ctxt(expn_data.call_site);
    const krate = unwrap(expn_data.macro_def_id).krate;
    return new Rustc(ecx, def_site, call_site, mixed_site, krate, new Map());
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:479 sess
  sess(): Session {
    return this.ecx.sess;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:483 psess
  psess(): ParseSess {
    return this.ecx.psess();
  }

  // ---- impl server::Server for Rustc<'_, '_> ----
  // type TokenStream = TokenStream;
  // type Span = Span;
  // type Symbol = Symbol;

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:493 globals
  globals(): ExpnGlobals<Span> {
    return {
      def_site: this.def_site,
      call_site: this.call_site,
      mixed_site: this.mixed_site,
    };
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:501 intern_symbol
  static intern_symbol(string: string): Symbol {
    return Symbol.intern(string);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:505 with_symbol_string
  static with_symbol_string(symbol: Symbol, f: (s: string) => void): void {
    f(Symbol.as_str(symbol));
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:509 track_env_var
  track_env_var(var_: string, value: string | undefined): void {
    // PORT: `Session.env_depinfo` is a `Set<string>` of the JSON text of the `(Symbol, Option<Symbol>)` pair's
    // strings, the encoding rustc_interface/passes.ts (`env_var_os`, `write_out_deps`) writes and reads.
    const k = Symbol.intern(var_);
    const v = value === undefined ? undefined : Symbol.intern(value);
    this.ecx.sess.env_depinfo.add(JSON.stringify([Symbol.as_str(k), v === undefined ? null : Symbol.as_str(v)]));
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:517 track_path
  track_path(path: string): void {
    this.ecx.sess.file_depinfo.add(Symbol.intern(path));
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:521 literal_from_str
  literal_from_str(s: string): Result<Literal<Span, Symbol>, string> {
    const name = FileName.proc_macro_source_code(s);

    const caught = catch_fatal_errors(() => new_parser_from_source_str(this.psess(), name, s, StripTokens.Nothing));
    if (caught.$ === "Err") return Err("failed to parse to literal");
    const parsed = caught._0;
    if (parsed.$ === "Err") return Err(cancel_diags_into_string(parsed._0));
    const parser = parsed._0;

    const first_span = Span.data(parser.token.span);
    const minus_present = parser.eat(exp.Minus);

    const lit_span = Span.data(parser.token.span);
    if (parser.token.kind.$ !== "Literal") {
      return Err("not a literal");
    }
    let lit = parser.token.kind._0;

    // Check no comment or whitespace surrounding the (possibly negative)
    // literal, or more tokens after it.
    if (lit_span.hi - first_span.lo !== utf8_len(s)) {
      return Err("comment or whitespace around literal");
    }

    if (minus_present) {
      // If minus is present, check no comment or whitespace in between it
      // and the literal token.
      if (first_span.hi !== lit_span.lo) {
        return Err("comment or whitespace after minus");
      }

      // Check literal is a kind we allow to be negated in a proc macro token.
      switch (lit.kind.$) {
        case "Bool":
        case "Byte":
        case "Char":
        case "Str":
        case "StrRaw":
        case "ByteStr":
        case "ByteStrRaw":
        case "CStr":
        case "CStrRaw":
        case "Err":
          return Err("non-numeric literal may not be negated");
        case "Integer":
        case "Float":
          break;
      }

      // Synthesize a new symbol that includes the minus sign.
      const symbol = Symbol.intern(Str.from(s).slice(0, 1 + utf8_len(Symbol.as_str(lit.symbol))).toString());
      lit = Lit.new(lit.kind, symbol, lit.suffix);
    }
    const { kind, symbol, suffix } = lit;
    return Ok({
      kind: LitKind_FromInternal.from_internal(kind),
      symbol,
      suffix,
      span: this.call_site,
    });
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:581 emit_diagnostic
  emit_diagnostic(diagnostic: Diagnostic<Span>): void {
    const message = DiagMessage.from_String(diagnostic.message);
    const diag = Diag.new(this.psess().dcx(), Level_ToInternal_Level.to_internal(diagnostic.level), message);
    diag.span(MultiSpan.from_spans(diagnostic.spans));
    for (const child of diagnostic.children) {
      diag.sub(Level_ToInternal_Sublevel.to_internal(child.level), child.message, MultiSpan.from_spans(child.spans));
    }
    diag.emit();
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:591 ts_drop
  ts_drop(_stream: TokenStream): void {
    // drop(stream);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:595 ts_clone
  ts_clone(stream: TokenStream): TokenStream {
    return tokenstream.clone_TokenStream(stream);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:599 ts_is_empty
  ts_is_empty(stream: TokenStream): boolean {
    return stream.is_empty();
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:603 ts_from_str
  ts_from_str(src: string): Result<TokenStream, string> {
    const caught = catch_fatal_errors(() =>
      source_str_to_stream(this.psess(), FileName.proc_macro_source_code(src), src, this.call_site),
    );
    if (caught.$ === "Err") return Err("failed to parse to tokenstream");
    const r = caught._0;
    if (r.$ === "Err") return Err(cancel_diags_into_string(r._0));
    return r;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:616 ts_to_string
  ts_to_string(stream: TokenStream): string {
    return pprust.tts_to_string(stream);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:620 ts_expand_expr
  ts_expand_expr(stream: TokenStream): Result<TokenStream, undefined> {
    // Parse the expression from our tokenstream.
    // PORT: the `try { .. }` block: the first `?` failure becomes the block's value.
    const expr_r = ((): PResult<ast.Expr> => {
      const p = Parser.new(this.psess(), tokenstream.clone_TokenStream(stream), "proc_macro expand expr");
      const expr = p.parse_expr();
      if (expr.$ === "Err") return expr;
      if (p.token.kind.$ !== "Eof") {
        const r = p.unexpected();
        if (r.$ === "Err") return r;
      }
      return expr;
    })();
    if (expr_r.$ === "Err") {
      expr_r._0.emit();
      return Err(undefined);
    }
    let expr = expr_r._0;

    // Perform eager expansion on the expression.
    expr = AstFragment.make_expr(this.ecx.expander().fully_expand_fragment({ $: "Expr", _0: expr }));

    // NOTE: For now, limit `expand_expr` to exclusively expand to literals.
    // This may be relaxed in the future.
    // We don't use `TokenStream::from_ast` as the tokenstream currently cannot
    // be recovered in the general case.
    const kind = expr.kind;
    if (kind.$ === "Lit" && kind._0.kind.$ === "Bool") {
      const token_lit = kind._0;
      return Ok(TokenStream_.token_alone({ $: "Ident", _0: token_lit.symbol, _1: tk.IdentKind.Normal }, expr.span));
    } else if (kind.$ === "Lit") {
      const token_lit = kind._0;
      return Ok(TokenStream_.token_alone({ $: "Literal", _0: clone_Lit(token_lit) }, expr.span));
    } else if (kind.$ === "IncludedBytes") {
      const byte_sym = kind._0;
      const lit = Lit.new(tk.LitKind.ByteStr, escape_byte_str_symbol(ByteSymbol.as_byte_str(byte_sym)), undefined);
      return Ok(TokenStream_.token_alone({ $: "Literal", _0: lit }, expr.span));
    } else if (kind.$ === "Unary" && kind._0 === "Neg") {
      const e = kind._1;
      if (e.kind.$ === "Lit") {
        const token_lit = e.kind._0;
        if (token_lit.kind.$ === "Integer" || token_lit.kind.$ === "Float") {
          return Ok(
            TokenStream_.from_iter([
              // FIXME: The span of the `-` token is lost when
              // parsing, so we cannot faithfully recover it here.
              AstTokenTree.token_joint_hidden(TK.Minus, e.span),
              AstTokenTree.token_alone({ $: "Literal", _0: clone_Lit(token_lit) }, e.span),
            ]),
          );
        } else {
          return Err(undefined);
        }
      } else {
        return Err(undefined);
      }
    } else {
      return Err(undefined);
    }
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:678 ts_from_token_tree
  ts_from_token_tree(tree: PmTokenTree): TokenStream {
    return TokenStream_.new([...TokenTree_ToInternal.to_internal([tree, this])]);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:685 ts_concat_trees
  ts_concat_trees(base: TokenStream | undefined, trees: PmTokenTree[]): TokenStream {
    const stream = base ?? TokenStream_.default();
    for (const tree of trees) {
      for (const tt of TokenTree_ToInternal.to_internal([tree, this])) {
        stream.push_tree_with_gluing(tt);
      }
    }
    return stream;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:699 ts_concat_streams
  ts_concat_streams(base: TokenStream | undefined, streams: TokenStream[]): TokenStream {
    const stream = base ?? TokenStream_.default();
    for (const s of streams) {
      stream.push_stream_with_gluing(s);
    }
    return stream;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:711 ts_into_trees
  ts_into_trees(stream: TokenStream): PmTokenTree[] {
    return TokenTrees_FromInternal.from_internal(stream);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:718 span_debug
  span_debug(span: Span): string {
    if (this.ecx.ecfg.span_debug) {
      return debug_Span(span, PLAIN);
    } else {
      return `${debug_SyntaxContext(Span.ctxt(span), PLAIN)} bytes(${Span.lo(span)}..${Span.hi(span)})`;
    }
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:726 span_file
  span_file(span: Span): string {
    return FileName.prefer_remapped_unconditionally(this.psess().source_map().lookup_char_pos(Span.lo(span)).file.name).to_string();
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:736 span_local_file
  span_local_file(span: Span): string | undefined {
    const p = FileName.into_local_path(this.psess().source_map().lookup_char_pos(Span.lo(span)).file.name);
    // PORT: `PathBuf` is a JS string (always UTF-8), so `p.to_str().expect(..)` cannot fail.
    return p === undefined ? undefined : p;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:751 span_parent
  span_parent(span: Span): Span | undefined {
    return Span.parent_callsite(span);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:755 span_source
  span_source(span: Span): Span {
    return Span.source_callsite(span);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:759 span_byte_range
  span_byte_range(span: Span): Range {
    const source_map = this.psess().source_map();

    const relative_start_pos = source_map.lookup_byte_offset(Span.lo(span)).pos;
    const relative_end_pos = source_map.lookup_byte_offset(Span.hi(span)).pos;

    return { start: relative_start_pos, end: relative_end_pos };
  }
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:767 span_start
  span_start(span: Span): Span {
    return Span.shrink_to_lo(span);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:771 span_end
  span_end(span: Span): Span {
    return Span.shrink_to_hi(span);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:775 span_line
  span_line(span: Span): number {
    const loc = this.psess().source_map().lookup_char_pos(Span.lo(span));
    return loc.line;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:780 span_column
  span_column(span: Span): number {
    const loc = this.psess().source_map().lookup_char_pos(Span.lo(span));
    return loc.col + 1;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:785 span_join
  span_join(first: Span, second: Span): Span | undefined {
    const self_loc = this.psess().source_map().lookup_char_pos(Span.lo(first));
    const other_loc = this.psess().source_map().lookup_char_pos(Span.lo(second));

    // PORT: `StableSourceFileId`'s derived `PartialEq` compares its hash; `stable_source_file_id_key` is the
    // canonical key of the hashed fields (the one `SourceMap` indexes files by).
    if (stable_source_file_id_key(self_loc.file.stable_id) !== stable_source_file_id_key(other_loc.file.stable_id)) {
      return undefined;
    }

    return Span.to(first, second);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:796 span_subspan
  span_subspan(span: Span, start_: Bound, end_: Bound): Span | undefined {
    const length = BytePos.to_usize(Span.hi(span)) - BytePos.to_usize(Span.lo(span));

    // PORT: `usize` bounds are JS numbers. `checked_add(1)` only fails at `usize::MAX`, which a number cannot
    // hold exactly; any bound that large fails the `> u32::MAX` check below either way, so the result is the same.
    let start: number;
    switch (start_.$) {
      case "Included":
        start = start_._0;
        break;
      case "Excluded":
        start = start_._0 + 1;
        break;
      case "Unbounded":
        start = 0;
        break;
    }

    let end: number;
    switch (end_.$) {
      case "Included":
        end = end_._0 + 1;
        break;
      case "Excluded":
        end = end_._0;
        break;
      case "Unbounded":
        end = length;
        break;
    }

    // Bounds check the values, preventing addition overflow and OOB spans.
    if (
      start > U32_MAX ||
      end > U32_MAX ||
      U32_MAX - start < BytePos.to_u32(Span.lo(span)) ||
      U32_MAX - end < BytePos.to_u32(Span.lo(span)) ||
      start >= end ||
      end > length
    ) {
      return undefined;
    }

    const new_lo = BytePos.add(Span.lo(span), BytePos.from_usize(start));
    const new_hi = BytePos.add(Span.lo(span), BytePos.from_usize(end));
    return Span.with_hi(Span.with_lo(span, new_lo), new_hi);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:832 span_resolved_at
  span_resolved_at(span: Span, at: Span): Span {
    return Span.with_ctxt(span, Span.ctxt(at));
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:836 span_source_text
  span_source_text(span: Span): string | undefined {
    const r = this.psess().source_map().span_to_snippet(span);
    return r.$ === "Ok" ? r._0.toString() : undefined;
  }

  /// Saves the provided span into the metadata of
  /// *the crate we are currently compiling*, which must
  /// be a proc-macro crate. This id can be passed to
  /// `recover_proc_macro_span` when our current crate
  /// is *run* as a proc-macro.
  ///
  /// Let's suppose that we have two crates - `my_client`
  /// and `my_proc_macro`. The `my_proc_macro` crate
  /// contains a procedural macro `my_macro`, which
  /// is implemented as: `quote! { "hello" }`
  ///
  /// When we *compile* `my_proc_macro`, we will execute
  /// the `quote` proc-macro. This will save the span of
  /// "hello" into the metadata of `my_proc_macro`. As a result,
  /// the body of `my_proc_macro` (after expansion) will end
  /// up containing a call that looks like this:
  /// `proc_macro::Ident::new("hello", proc_macro::Span::recover_proc_macro_span(0))`
  ///
  /// where `0` is the id returned by this function.
  /// When `my_proc_macro` *executes* (during the compilation of `my_client`),
  /// the call to `recover_proc_macro_span` will load the corresponding
  /// span from the metadata of `my_proc_macro` (which we have access to,
  /// since we've loaded `my_proc_macro` from disk in order to execute it).
  /// In this way, we have obtained a span pointing into `my_proc_macro`
  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:864 span_save_span
  span_save_span(span: Span): number {
    return this.sess().save_proc_macro_span(span);
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:868 span_recover_proc_macro_span
  span_recover_proc_macro_span(id: number): Span {
    const [resolver, krate, def_site] = [this.ecx.resolver, this.krate, this.def_site];
    let span = this.rebased_spans.get(id);
    if (span === undefined) {
      // FIXME: `SyntaxContext` for spans from proc macro crates is lost during encoding,
      // replace it with a def-site context until we are encoding it properly.
      span = Span.with_ctxt(resolver.get_proc_macro_quoted_span(krate, id), Span.ctxt(def_site));
      this.rebased_spans.set(id, span);
    }
    return span;
  }

  // rustc: compiler/rustc_expand/src/proc_macro_server.rs:877 symbol_normalize_and_validate_ident
  symbol_normalize_and_validate_ident(string: string): Result<Symbol, undefined> {
    const sym_ = nfc_normalize(string);
    if (is_ident(Symbol.as_str(sym_))) {
      return Ok(sym_);
    } else {
      return Err(undefined);
    }
  }
}

const U32_MAX = 0xffff_ffff;
